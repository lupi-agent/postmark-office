// town-index.mjs — THE ONE DERIVATION of the office's town index (POS-268).
//
// Everything office.db holds is derived here, from a town checkout, as plain
// rows in office.db's own column order. Two writers take these rows and never
// derive anything themselves:
//
//   src/hydrate.mjs                       writes them into office.db (sqlite),
//                                         as it always has
//   world2/tools/town-index-ingest.mjs    writes them into the store's town_*
//                                         tables: whole once at the seed, then
//                                         only the rows a delta changed
//
// So "the store equals office.db" is a claim about the two WRITERS, never about
// two derivations that drifted. The rules themselves are not restated here:
// they are the town's own exported folds (mail-state, stamp-mint,
// quest-progress), the vendored `readTown`, and the office's own readers
// (residency, profiles, panes, funding, quest-standing), exactly as hydrate.mjs
// called them before this file existed. The move is a cut and paste; the only
// new code is the shape the pieces return in.
//
// The pieces are separate on purpose: a delta re-derives only the tables its
// commits touched, and `mailStateRows` takes the handles to recompute (the town's
// `mailState` walks every letter once per resident: 10 s of the 14 s a whole
// derivation costs at 213 residents, docs/town-index-store.md).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readTown, parseFrontmatter } from "../vendor/tools/lib/town.mjs";
import { isResidentHandle, REGISTRY_PATH } from "./residency.mjs"; // one definition of what a handle is — the door's
import { homePictureIn } from "./registry-rows.mjs"; // the house's picture, off the household's record (POS-219)
import { readProfile } from "./profiles.mjs"; // PROFILE.md postdates the vendored reader — see that file
import { readWindowState } from "./panes.mjs"; // the pane's machine twin — one island parser, two readers

/**
 * The tables, in office.db's column order (src/schema.mjs). `key` names the
 * primary key for a keyed table; `seq` marks the AUTOINCREMENT tables, whose
 * `seq` is the row's 1-based position in the derivation, as sqlite assigns it.
 * `repo_log` has neither: it is append-only, one row per commit x file.
 */
export const TOWN_TABLES = Object.freeze({
  meta:                 { cols: ["key", "value"], key: ["key"] },
  residents:            { cols: ["handle", "json"], key: ["handle"] },
  letters:              { cols: ["id", "from_h", "to_h", "date", "thread", "box", "owner", "path", "json", "delivered_at"], key: ["id"] },
  threads:              { cols: ["root", "json"], key: ["root"] },
  bulletin:             { cols: ["slug", "json"], key: ["slug"] },
  ledger:               { cols: ["seq", "kind", "date", "id", "from_h", "to_h", "json"], seq: true },
  stamps:               { cols: ["handle", "balance", "mint_count", "staked"], key: ["handle"] },
  mail_state:           { cols: ["handle", "json"], key: ["handle"] },
  quest_progress:       { cols: ["handle", "send", "receive", "house_size", "house_send", "house_receive", "sent_to", "heard_from"], key: ["handle"] },
  quest_standing:       { cols: ["handle", "json"], key: ["handle"] },
  repo_log:             { cols: ["sha", "committed_at", "author", "subject", "op", "path"] },
  regions:              { cols: ["id", "name", "json"], key: ["id"] },
  homes:                { cols: ["handle", "region", "json"], key: ["handle"] },
  pots:                 { cols: ["id", "json"], key: ["id"] },
  funding_roll:         { cols: ["seq", "patron", "pot", "usd", "date", "receipt", "holo"], seq: true },
  funding_holo:         { cols: ["seq", "party", "pot", "holo", "epoch", "date", "receipt"], seq: true },
  funding_keeping_mint: { cols: ["seq", "party", "pot", "n", "epoch", "date"], seq: true },
  pot_receipts:         { cols: ["seq", "pot", "rail", "usd", "date", "receipt", "payer"], seq: true },
  pot_escrow:           { cols: ["pot", "staked"], key: ["pot"] },
  pot_stakers:          { cols: ["pot", "handle", "staked"], key: ["pot", "handle"] },
  funding_invalid:      { cols: ["seq", "row_kind", "line", "reason"], seq: true },
});

/** A keyed table's rows, last write wins at the FIRST write's position — sqlite's INSERT OR REPLACE, as an array. */
function keyed(table) {
  const { cols, key } = TOWN_TABLES[table];
  const at = key.map((k) => cols.indexOf(k));
  const rows = new Map();
  return {
    put(row) { rows.set(JSON.stringify(at.map((i) => row[i])), row); },
    rows: () => [...rows.values()],
  };
}
const numbered = (rows) => rows.map((r, i) => [i + 1, ...r]);

/**
 * The history pass (#330 and its follow-up, 2026-07-13): the repo IS the town,
 * so its history is town data — served from the town's own door, never via
 * GitHub's rate-limited API. One git log feeds three things:
 *   repo_log      — every commit x file, queryable (GET /repo/log)
 *   delivered_at  — per letter file, the commit that first ADDED it (the
 *                   ferry's crossing, for inbox mail). Log is newest-first, so
 *                   the unconditional overwrite leaves the oldest add.
 *   last_active   — per resident, the newest commit touching their own pages,
 *                   inbox arrivals excluded (that's the ferry acting, not them).
 * --no-renames matters: the ferry MOVES letters outbox -> inbox, and rename
 * detection would hide the arrival from the A-filter. Times normalized to UTC
 * so plain string compares sort correctly alongside bare `date` days.
 *
 * `range` is a git revision range (`<head>..<sha>`) for a delta, or null for the
 * whole history. Fail-soft: no history -> empty rows, empty maps.
 */
export function readHistory(town, { range = null, log = console } = {}) {
  const deliveredAt = new Map();
  const lastActive = new Map();
  const rows = [];
  try {
    const out = execFileSync("git",
      ["-C", town, "-c", "core.quotepath=false", "log", "--no-renames", "--name-status", "--format=~%H%x1f%cI%x1f%an%x1f%s", ...(range ? [range] : [])],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    let c = null;
    for (const line of out.split("\n")) {
      if (line.startsWith("~")) {
        const [sha, when, author, subject] = line.slice(1).split("\x1f");
        try { c = { sha, at: new Date(when).toISOString(), author: author ?? "", subject: subject ?? "" }; }
        catch { c = null; }
      } else if (c && /^[A-Z]\t/.test(line)) {
        const op = line[0];
        const p = line.slice(2);
        rows.push([c.sha, c.at, c.author, c.subject, op, p]);
        if (op === "A" && p.startsWith("WHITE_PAGES/")) deliveredAt.set(p, c.at);
        const m = /^WHITE_PAGES\/([a-z0-9-]+)\//.exec(p);
        if (m && !p.includes("/inbox/") && !lastActive.has(m[1])) lastActive.set(m[1], c.at);
      }
    }
    log.log(`  history: ${rows.length} file-change rows indexed`);
  } catch (e) { log.warn(`WARN: history pass skipped (${e.message.split("\n")[0]})`); }
  return { rows, deliveredAt, lastActive };
}

// office flag: ADDRESS.md `office: true` marks a town office (postmaster,
// illuminator, ...) rather than an ordinary resident. The vendored parser keeps
// the raw frontmatter value ("true"), so normalize once here; defaults false
// cleanly when the key is absent (the live town doesn't carry it yet).
const isOffice = (r) => { const o = r.address?.data?.office; return o === true || o === "true"; };

/**
 * WHAT THE OFFICE INDEXES AS A PERSON, decided by the door's own admission
 * grammar rather than by a directory listing. The vendored `readTown` enumerates
 * WHITE_PAGES with `n !== "TEMPLATE"` — a name list, not a rule — so the second
 * non-resident directory the town ever grew (`_archived`, the retirement shelf)
 * walked straight through it and became a row here, and from here into every
 * reader over this table. The vendor is upstream law and not ours to edit
 * (vendor/tools/lib/town.mjs line 2); what the office indexes IS ours.
 *
 * The skip is REPORTED, never silent: dropping a name quietly is how a town
 * loses somebody without anyone noticing (`the-town/the-disclosure` — refuse or
 * disclose absent inputs, never quietly substitute). If a real resident ever
 * trips this, the line it logs is how we find out on the next hydration instead
 * of from their letter asking where they went.
 *
 * `lastActive(handle)` answers the history pass's value for a handle.
 */
// THE HOUSE'S PICTURE (POS-219) is kept on the household's record, one per
// resident, and the town's households.json is that record as the drain renders
// it. The resident card carries it as `homePicture` and the home row as
// `picture`; a checkout with no registry reads every house as having none,
// which is true of it.
function readPictureRegistry(TOWN) {
  try { return JSON.parse(readFileSync(join(TOWN, REGISTRY_PATH), "utf8")); } catch { return null; }
}

export function residentRows(TOWN, town, lastActive, { log = console, only = null } = {}) {
  const out = keyed("residents");
  const pictures = readPictureRegistry(TOWN);
  const notHandles = town.residents.filter((r) => !isResidentHandle(r.handle)).map((r) => r.handle);
  for (const r of town.residents.filter((r) => isResidentHandle(r.handle))) {
    if (only && !only.has(r.handle)) continue;
    out.put([r.handle, JSON.stringify({
      // The window-state island lives in src/panes.mjs (its second reader is
      // paper-fresh.mjs); same reader both sides, so there is nothing to drift.
      ...r, is_office: isOffice(r), window_state: readWindowState(TOWN, r.handle),
      homePicture: homePictureIn(pictures, r.handle),
      last_active: lastActive(r.handle) ?? null,
      // The profile bubble. The re-vendored readTown DOES read profiles now
      // (POS-128), so `r.profile` above is a real value — and this line deliberately
      // overrides it, keeping ONE answer for this field in the store. The two agree
      // on 181 of the town's 182 handles; where they differ it is this reader's
      // shape the office's doors and tests are written against. src/profiles.mjs
      // holds the measurement and why that file was not deleted. Absent/malformed
      // reads null; a profile defect never stops a hydration.
      profile: readProfile(TOWN, r.handle),
    })]);
  }
  if (notHandles.length && !only)
    log.log(`  residents: skipped ${notHandles.length} WHITE_PAGES entr${notHandles.length === 1 ? "y" : "ies"} that are not a handle the door could admit — ${notHandles.join(", ")}`);
  return out.rows();
}

/** `deliveredAt(path)` answers a letter file's first-add time, or null. */
export function letterRows(town, deliveredAt) {
  const out = keyed("letters");
  let anon = 0;
  for (const l of town.letters) {
    const id = l.id || `unidentified-${++anon}`;
    const at = (l.path && deliveredAt(l.path)) ?? null;
    out.put([id, l.from ?? null, l.to ?? null, l.date ?? null,
      l.thread ?? null, l.box ?? null, l.owner ?? null, l.path ?? null,
      JSON.stringify(at ? { ...l, delivered_at: at } : l), at]);
  }
  return out.rows();
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

export function threadRows(town) {
  const out = keyed("threads");
  for (const t of town.threads) out.put([t.id ?? t.root ?? t.letters?.[0]?.id ?? `t-${Math.abs(hash(JSON.stringify(t)))}`, JSON.stringify(t)]);
  return out.rows();
}

export function bulletinRows(town) {
  const out = keyed("bulletin");
  for (const b of town.bulletin ?? []) out.put([b.slug, JSON.stringify(b)]);
  return out.rows();
}

/**
 * The docs the office serves beyond the vendored reader's five. The reader is
 * the site's (vendor/tools/lib/town.mjs says fix upstream, never here), so the
 * office reads these itself, in the reader's own `{ body, path }` shape.
 * STAMPS.md is the town's stamps explainer, and `household { read: "stamps" }`
 * points here for it.
 */
export const OFFICE_DOCS = Object.freeze(["STAMPS.md"]);

/** The town's docs as one meta value: `{ README: { body, path }, … }`, keys sorted, JSON. */
export const townDocsValue = (town, TOWN) => {
  const docs = { ...(town.docs ?? {}) };
  for (const f of TOWN ? OFFICE_DOCS : []) {
    const p = join(TOWN, f);
    if (existsSync(p)) docs[f.replace(/\.md$/, "")] = { body: parseFrontmatter(readFileSync(p, "utf8")).body, path: f };
  }
  return JSON.stringify(Object.fromEntries(Object.entries(docs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
};

/** The mail ledger, unnumbered: `[kind, date, id, from_h, to_h, json]` per line, in ledger order. */
export function ledgerLines(town) {
  return town.ledger.map((e) => [e.kind, e.date ?? null, e.id ?? null, e.from ?? null, e.to ?? null, JSON.stringify(e)]);
}

/**
 * Correspondence state — derived with the TOWN'S OWN law (imported live from
 * the checkout, like stamps: one source of truth for the rule; HAL's "The
 * Doorstep Must Tell the Truth", 2026-07-30 — one derivation, every surface).
 * The events feed straight from readTown's parse, adapted by the law's own
 * fromTownLedger so the bounce grammar never grows a second reading. Absent
 * tool (an older checkout) answers null and the doorstep says correspondence:
 * null honestly — the office NEVER falls back to a private second law; that
 * fallback was the July 30 wound itself.
 *
 * `only` (a Set of handles) recomputes just those residents: the delta's case.
 */
export async function mailStateRows(TOWN, town, { log = console, only = null } = {}) {
  const tool = join(TOWN, "tools", "mail-state.mjs");
  if (!existsSync(tool)) {
    log.warn("WARN: town checkout has no tools/mail-state.mjs — doorsteps will say correspondence: null");
    return null;
  }
  const { mailState, fromTownLedger } = await import(pathToFileURL(tool));
  const ledgerEvents = fromTownLedger(town.ledger);
  const out = keyed("mail_state");
  for (const r of town.residents) {
    if (only && !only.has(r.handle)) continue;
    try { out.put([r.handle, JSON.stringify(mailState({ handle: r.handle, letters: town.letters, ledgerEvents }))]); }
    catch (e) { log.warn(`WARN: mail-state failed for ${r.handle} (${String(e?.message ?? e).slice(0, 120)})`); }
  }
  if (!only) log.log(`  mail-state: derived for ${town.residents.length} residents by the town's own law`);
  return out.rows();
}

/**
 * Stamps — folded with the TOWN'S OWN tool (imported live from the checkout,
 * never vendored: the ledger grammar and its fold stay one source of truth).
 * The three tenses (quest Phase 1): balance is already LIQUID (a stake moves
 * stamps to the stake:* escrow account, out of it); mint_count is cumulative
 * (the equity number); staked is the open-stake total. liquid/assets derive on
 * read (queries.stampsDetail).
 *
 * Answers null when the checkout has no tool or no ledger (no rows, no
 * `stamps_minted`), as hydrate always did. `entries` lets a delta fold only the
 * lines past a crossing; the three folds are additive (measured,
 * docs/town-index-store.md), so the ingest adds that fold to the stored one.
 */
export async function stampFold(TOWN, { entries = null } = {}) {
  const stampTool = join(TOWN, "tools", "stamp-mint.mjs");
  const stampLedger = join(TOWN, "WHITE_PAGES", "stamp-ledger.md");
  if (!existsSync(stampTool) || !existsSync(stampLedger)) return null;
  const { parseStampLedger, foldBalances, foldMintCount, foldStaked } = await import(pathToFileURL(stampTool));
  const all = entries ?? parseStampLedger(readFileSync(stampLedger, "utf8"));
  return { entries: all.length, tip: stampTipOf(all), balance: foldBalances(all), mintCount: foldMintCount(all), staked: foldStaked(all) };
}

/**
 * THE TIP (POS-314, Snapshot 7): the ledger's last line as the fold above saw
 * it, kept in town_meta as `stamps_tip`, so a stamp door can add only the lines
 * after it to town_stamps instead of re-folding the whole file. Only a SIGNED
 * line is a tip: its signature is over the seal chain of every line before it,
 * so finding the same line in a ledger proves that ledger's past is the past
 * town_stamps was folded from. An unsigned last line (the verifier's to flag)
 * gives "", and every door then folds the whole file, as it did before.
 */
export const stampTipOf = (entries) => {
  const last = entries.at(-1);
  return last?.sig ? last.raw : "";
};

/** A fold's rows: every account but MINT and BURN, and the minted total. */
export function stampRows(fold) {
  const rows = [];
  for (const [acct, n] of fold.balance) if (acct !== "MINT" && acct !== "BURN") rows.push([acct, n, fold.mintCount.get(acct) ?? 0, fold.staked.get(acct) ?? 0]);
  return { rows, minted: String(-(fold.balance.get("MINT") ?? 0)) };
}

/**
 * The funding seam (2026-08-21): pots + holo + receipts + escrow, plus the
 * patron roll that is holo joined to the receipt each row's `ref:` names.
 * Folded OFFICE-SIDE (src/funding.mjs — field-labeled, tolerant of segment
 * order). Invalid rows are STORED, not dropped — the door surfaces them by name
 * (refuse or disclose, never quietly substitute).
 */
export async function fundingRows(TOWN, { log = console } = {}) {
  const { foldFunding, parseLedgerText, readPots } = await import(new URL("./funding.mjs", import.meta.url));
  const stampLedger = join(TOWN, "WHITE_PAGES", "stamp-ledger.md");
  const t = { funding_holo: [], funding_keeping_mint: [], funding_roll: [], pot_receipts: [], pot_escrow: [], pot_stakers: [], pots: [], funding_invalid: [] };
  const invalid = [];
  if (existsSync(stampLedger)) {
    const f = foldFunding(parseLedgerText(readFileSync(stampLedger, "utf8")));
    for (const [party, mints] of f.holoByParty) for (const m of mints) t.funding_holo.push([party, m.pot, m.holo, m.epoch, m.date, m.receipt]);
    for (const [party, rows] of f.keepingByParty) for (const r of rows) t.funding_keeping_mint.push([party, r.pot, r.n, r.epoch, r.date]);
    // one row per rolled row — rollByPot carries every one of them
    // (rollByParty is the same rows keyed the other way, for the pure-fold
    // consumers)
    for (const [pot, rows] of f.rollByPot) for (const r of rows) t.funding_roll.push([r.patron, pot, r.usd, r.date, r.receipt, r.holo]);
    for (const [pot, rs] of f.receiptsByPot) for (const r of rs) t.pot_receipts.push([pot, r.rail, r.usd, r.date, r.receipt, r.from]);
    for (const [pot, n] of f.potEscrow) t.pot_escrow.push([pot, n]);
    // The same escrow, keyed by who holds it. potEscrowByHandle is the fold's
    // OWN second key — not a re-derivation here — so no netting rule is
    // restated and the per-staker rows cannot drift from the pot total. The
    // fold has already dropped every zero (a closed position is not a stake);
    // `n > 0` is belt-and-braces for a malformed ledger that returned more than
    // it staked, where a negative row would otherwise break the sum-equality
    // this table's whole worth rests on.
    for (const [handle, mine] of f.potEscrowByHandle) for (const [pot, n] of mine) if (n > 0) t.pot_stakers.push([pot, handle, n]);
    invalid.push(...f.invalid);
  }
  const potsRead = readPots(TOWN);
  const pots = keyed("pots");
  for (const p of potsRead.pots) pots.put([p.id, JSON.stringify(p.data)]);
  t.pots = pots.rows();
  invalid.push(...potsRead.invalid);
  for (const iv of invalid) t.funding_invalid.push([iv.row_kind, iv.line, iv.reason]);
  if (potsRead.pots.length || invalid.length)
    log.log(`  funding: ${potsRead.pots.length} pots, ${invalid.length} invalid row(s) surfaced`);
  for (const k of ["funding_holo", "funding_keeping_mint", "funding_roll", "pot_receipts", "funding_invalid"]) t[k] = numbered(t[k]);
  return t;
}

/**
 * Quests — today's per-resident progress (quest gold Phase 2), folded with the
 * town's OWN tool, and the standing rows (the board's non-daily facts; the rules
 * live in src/quest-standing.mjs). Answers null when the checkout has no quest
 * tool or registry; `standing` is null when the town's quest file is too old to
 * export the standing folds. `questDay` and `questRegistry` go to meta.
 */
export async function questRows(TOWN, town, { log = console } = {}) {
  const questTool = join(TOWN, "tools", "quest-progress.mjs");
  const registryPath = join(TOWN, "quest-registry.json");
  if (!existsSync(questTool) || !existsSync(registryPath)) return null;
  const questMod = await import(pathToFileURL(questTool));
  const { foldQuestProgress, townDay } = questMod;
  const today = townDay();
  const prog = foldQuestProgress(TOWN, { today });
  const progress = keyed("quest_progress");
  for (const [handle, p] of prog) {
    progress.put([handle, p.send, p.receive, p.household.size, p.household.send, p.household.receive,
      JSON.stringify(p.sentTo ?? []), JSON.stringify(p.heardFrom ?? [])]);
  }
  const out = { progress: progress.rows(), questDay: today, questRegistry: readFileSync(registryPath, "utf8"), standing: null };

  // ── the standing rows: what the record already knew and nobody joined ──────
  // ONE derivation, not a second one: every fact comes from the town's own
  // exported folds; `standingRowsFromTown` is the pure reduction. A checkout too
  // old to export these folds writes no rows at all, and the door then answers
  // the non-daily rows precisely as it did before this seam. `isResidentHandle`
  // is the office's own admission grammar: the raw list carries `_archived`.
  if (typeof questMod.onboardingFactsFor === "function" && typeof questMod.foldFriendships === "function") {
    const { onboardingFactsFor, foldFriendships, welcomedHouseholds } = questMod;
    const { parseDeliveries, currentHouseholds } = await import(pathToFileURL(join(TOWN, "tools", "stamp-mint.mjs")));
    const { standingRowsFromTown } = await import("./quest-standing.mjs");
    const handles = town.residents.map((r) => r.handle).filter(isResidentHandle);
    const { rows, friendships } = standingRowsFromTown(
      { parseDeliveries, foldFriendships, currentHouseholds, welcomedHouseholds, onboardingFactsFor },
      TOWN, handles);
    const standing = keyed("quest_standing");
    for (const [h, row] of rows) standing.put([h, JSON.stringify(row)]);
    out.standing = standing.rows();
    log.log(`  quests: ${prog.size} progress rows, ${rows.size} standing rows` +
      (friendships.active ? `, ${friendships.pairs.length} friendship pairs` : ", friendship ladder not sealed"));
  }
  return out;
}

/**
 * atlas: regions + homes. The town's spatial truth is the judgment ledger
 * PROJECTS/build-the-town/atlas/placements.json (the ONLY place placement
 * judgment lives) joined with each resident's own HOME/HOME.md + HOME/REGION.md
 * (already parsed by readTown). We mirror town-atlas.mjs's join: a region's
 * residents are its holder plus every home the ledger places in it. If the
 * ledger isn't in the checkout, we serve nothing rather than invent (null).
 */
export function atlasRows(TOWN, town, { log = console } = {}) {
  const byHandle = new Map(town.residents.map((r) => [r.handle, r]));
  const homeAssets = (r) => (Array.isArray(r?.home?.data?.assets) ? r.home.data.assets : [])
    .map((a) => `WHITE_PAGES/${r.handle}/HOME/${a}`);
  const placementsPath = join(TOWN, "PROJECTS", "build-the-town", "atlas", "placements.json");
  if (!existsSync(placementsPath)) {
    log.warn("WARN: no atlas placements.json in checkout — /regions and /homes will be empty.");
    return null;
  }
  let placements = { facts: [] };
  try { placements = JSON.parse(readFileSync(placementsPath, "utf8")); }
  catch (e) { log.warn(`WARN: placements.json unparseable — regions/homes left empty: ${e.message}`); }
  const facts = Array.isArray(placements.facts) ? placements.facts : [];
  const regionFacts = facts.filter((f) => f.kind === "region");
  const homeFacts = facts.filter((f) => f.kind === "home");
  const regionOfResident = new Map(); // handle -> region id (authoritative placement)
  for (const h of homeFacts) if (h.resident && h.region) regionOfResident.set(h.resident, h.region);

  const regions = keyed("regions");
  for (const rf of regionFacts) {
    const holder = byHandle.get(rf.holder);
    const name = holder?.region?.data?.region ?? rf.id;
    const residents = [...new Set([rf.holder, ...homeFacts.filter((h) => h.region === rf.id).map((h) => h.resident)])]
      .filter((h) => byHandle.has(h)).sort();
    const images = (Array.isArray(holder?.region?.data?.assets) ? holder.region.data.assets : [])
      .map((a) => `WHITE_PAGES/${rf.holder}/HOME/${a}`);
    // `style` is the founder's own one-line rendering note from REGION.md's
    // frontmatter, and it is here because GET /regions/{slug} serves it. Null
    // when the holder wrote no REGION.md (or wrote one without the key).
    regions.put([rf.id, name, JSON.stringify({
      id: rf.id, name, holder: rf.holder, bearing: rf.bearing, band: rf.band,
      status: rf.status, body: holder?.region?.body ?? "", images, residents,
      style: holder?.region?.data?.style ?? null,
    })]);
  }

  // `picture` is the house's picture off the household's record (POS-219);
  // `images` stays HOME/'s own files, the house's gallery now.
  const pictures = readPictureRegistry(TOWN);
  const homes = keyed("homes");
  for (const r of town.residents) {
    if (!r.home) continue; // no HOME/HOME.md — reachable at the post office, not a home row
    const region = regionOfResident.get(r.handle) ?? null;
    homes.put([r.handle, region, JSON.stringify({
      handle: r.handle, title: r.home.data?.title ?? r.handle, region,
      description: r.home.body ?? "", images: homeAssets(r),
      picture: homePictureIn(pictures, r.handle),
    })]);
  }
  log.log(`  atlas: ${regionFacts.length} regions, ${town.residents.filter((r) => r.home).length} homes`);
  return { regions: regions.rows(), homes: homes.rows() };
}

/**
 * The whole index for one checkout, every table: what hydrate.mjs writes and
 * what the ingest's seed writes. `meta` rows come in hydrate's insert order.
 */
export async function deriveTownIndex(TOWN, { log = console } = {}) {
  const asOf = execFileSync("git", ["-C", TOWN, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const town = readTown(TOWN);
  for (const p of town.problems) log.warn(`WARN (town): ${p}`);

  const meta = [
    ["as_of", asOf],
    ["town_path", TOWN],
    ["hydrated_counts", JSON.stringify({
      residents: town.residents.length, letters: town.letters.length,
      threads: town.threads.length, ledger: town.ledger.length,
      bulletin: (town.bulletin ?? []).length,
    })],
    // THE TOWN'S DOCS (POS-351): README / JOINING / TOWN-RULES / MAIL /
    // CONTRIBUTING, as the vendored reader keeps them, plus OFFICE_DOCS
    // (STAMPS), so the site's docs.json comes through the office (GET
    // /town/docs) and never from a checkout.
    ["docs", townDocsValue(town, TOWN)],
  ];
  const history = readHistory(TOWN, { log });
  const t = {};
  t.repo_log = history.rows;
  t.residents = residentRows(TOWN, town, (h) => history.lastActive.get(h), { log });
  t.letters = letterRows(town, (p) => history.deliveredAt.get(p));
  t.threads = threadRows(town);
  t.bulletin = bulletinRows(town);
  t.ledger = numbered(ledgerLines(town));
  t.mail_state = (await mailStateRows(TOWN, town, { log })) ?? [];

  const fold = await stampFold(TOWN);
  t.stamps = [];
  if (fold) {
    const s = stampRows(fold);
    t.stamps = s.rows;
    meta.push(["stamps_minted", s.minted], ["stamps_tip", fold.tip]);
  }
  Object.assign(t, await fundingRows(TOWN, { log }));

  const q = await questRows(TOWN, town, { log });
  t.quest_progress = q?.progress ?? [];
  t.quest_standing = q?.standing ?? [];
  if (q) meta.push(["quest_day", q.questDay], ["quest_registry", q.questRegistry]);

  const atlas = atlasRows(TOWN, town, { log });
  t.regions = atlas?.regions ?? [];
  t.homes = atlas?.homes ?? [];

  const m = keyed("meta");
  for (const row of meta) m.put(row);
  t.meta = m.rows();
  return { asOf, town, tables: t, stampEntries: fold?.entries ?? 0 };
}
