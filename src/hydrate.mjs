// hydrate.mjs — build the office's read index (SQLite) from a town checkout.
//
// The DB is an INDEX, never the truth: rebuildable byte-for-byte from a clone
// (constitution invariant, gold plan postmark-doors). Every serving response
// carries the commit sha this index was built from (X-Postmark-As-Of).
//
//   node src/hydrate.mjs --town <path-to-postmark-checkout> [--db office.db]

import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readTown } from "../vendor/tools/lib/town.mjs";
import { isResidentHandle } from "./residency.mjs"; // one definition of what a handle is — the door's
import { readProfile } from "./profiles.mjs"; // PROFILE.md postdates the vendored reader — see that file
import { readWindowState } from "./panes.mjs"; // the pane's machine twin — one island parser, two readers
import { SCHEMA } from "./schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const TOWN = resolve(arg("--town", "G:/postmark/repo"));
const DB_PATH = resolve(ROOT, arg("--db", "office.db"));

if (!existsSync(join(TOWN, "WHITE_PAGES"))) {
  console.error(`FATAL: not a town checkout (no WHITE_PAGES): ${TOWN}`);
  process.exit(1);
}

const asOf = execFileSync("git", ["-C", TOWN, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const town = readTown(TOWN);
for (const p of town.problems) console.warn(`WARN (town): ${p}`);

// Rebuild from scratch every run — the index has no state of its own to keep.
if (existsSync(DB_PATH)) rmSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);
db.exec(SCHEMA);

const put = db.prepare("INSERT INTO meta VALUES (?, ?)");
put.run("as_of", asOf);
put.run("town_path", TOWN);
put.run("hydrated_counts", JSON.stringify({
  residents: town.residents.length, letters: town.letters.length,
  threads: town.threads.length, ledger: town.ledger.length,
  bulletin: (town.bulletin ?? []).length,
}));

// office flag: ADDRESS.md `office: true` marks a town office (postmaster,
// illuminator, ...) rather than an ordinary resident. The vendored parser keeps
// the raw frontmatter value ("true"), so normalize once here; defaults false
// cleanly when the key is absent (the live town doesn't carry it yet).
const isOffice = (r) => { const o = r.address?.data?.office; return o === true || o === "true"; };

// The window-state island moved to src/panes.mjs when the freshness ladder gave
// it a second reader (paper-fresh.mjs re-reads a pane the pen has written since
// this hydration ran). Same reader both sides, so there is nothing to drift —
// the move profiles.mjs already made for PROFILE.md.
const windowStateOf = (h) => readWindowState(TOWN, h);

// The history pass (#330 and its follow-up, 2026-07-13): the repo IS the town,
// so its history is town data — served from the town's own door, never via
// GitHub's rate-limited API. One full-repo git log feeds three things:
//   repo_log      — every commit x file, queryable (GET /repo/log): the generic
//                   substrate for activity/recency/growth questions nobody has
//                   named yet. ~3.5k rows; the DB stays a rebuildable index.
//   delivered_at  — per letter file, the commit that first ADDED it (the
//                   ferry's crossing, for inbox mail): the intra-day clock the
//                   day-granular `date` can't give. Log is newest-first, so the
//                   unconditional overwrite leaves the oldest add.
//   last_active   — per resident, the newest commit touching their own pages,
//                   inbox arrivals excluded (that's the ferry acting, not them).
// --no-renames matters: the ferry MOVES letters outbox -> inbox, and rename
// detection would hide the arrival from the A-filter. Times normalized to UTC
// so plain string compares sort correctly alongside bare `date` days.
// Fail-soft: no history -> empty table, null fields, date fallbacks.
const deliveredAt = new Map();
const lastActive = new Map();
const insLog = db.prepare("INSERT INTO repo_log VALUES (?,?,?,?,?,?)");
try {
  const log = execFileSync("git",
    ["-C", TOWN, "-c", "core.quotepath=false", "log", "--no-renames", "--name-status", "--format=~%H%x1f%cI%x1f%an%x1f%s"],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  let c = null;
  let rows = 0;
  for (const line of log.split("\n")) {
    if (line.startsWith("~")) {
      const [sha, when, author, subject] = line.slice(1).split("\x1f");
      try { c = { sha, at: new Date(when).toISOString(), author: author ?? "", subject: subject ?? "" }; }
      catch { c = null; }
    } else if (c && /^[A-Z]\t/.test(line)) {
      const op = line[0];
      const p = line.slice(2);
      insLog.run(c.sha, c.at, c.author, c.subject, op, p);
      rows++;
      if (op === "A" && p.startsWith("WHITE_PAGES/")) deliveredAt.set(p, c.at);
      const m = /^WHITE_PAGES\/([a-z0-9-]+)\//.exec(p);
      if (m && !p.includes("/inbox/") && !lastActive.has(m[1])) lastActive.set(m[1], c.at);
    }
  }
  console.log(`  history: ${rows} file-change rows indexed`);
} catch (e) { console.warn(`WARN: history pass skipped (${e.message.split("\n")[0]})`); }

// WHAT THE OFFICE INDEXES AS A PERSON, decided by the door's own admission
// grammar rather than by a directory listing. The vendored `readTown` enumerates
// WHITE_PAGES with `n !== "TEMPLATE"` — a name list, not a rule — so the second
// non-resident directory the town ever grew (`_archived`, the retirement shelf)
// walked straight through it and became a row here, and from here into every
// reader over this table. The vendor is upstream law and not ours to edit
// (vendor/tools/lib/town.mjs line 2); what the office indexes IS ours.
//
// The skip is REPORTED, never silent: dropping a name quietly is how a town
// loses somebody without anyone noticing (`the-town/the-disclosure` — refuse or
// disclose absent inputs, never quietly substitute). If a real resident ever
// trips this, the line below is how we find out on the next hydration instead
// of from their letter asking where they went.
const insResident = db.prepare("INSERT OR REPLACE INTO residents VALUES (?, ?)");
const notHandles = town.residents.filter((r) => !isResidentHandle(r.handle)).map((r) => r.handle);
for (const r of town.residents.filter((r) => isResidentHandle(r.handle))) insResident.run(r.handle, JSON.stringify({
  ...r, is_office: isOffice(r), window_state: windowStateOf(r.handle),
  last_active: lastActive.get(r.handle) ?? null,
  // The profile bubble. The re-vendored readTown DOES read profiles now
  // (POS-128), so `r.profile` above is a real value — and this line deliberately
  // overrides it, keeping ONE answer for this field in the store. The two agree
  // on 181 of the town's 182 handles; where they differ it is this reader's
  // shape the office's doors and tests are written against. src/profiles.mjs
  // holds the measurement and why that file was not deleted. Absent/malformed
  // reads null; a profile defect never stops a hydration.
  profile: readProfile(TOWN, r.handle),
}));
if (notHandles.length)
  console.log(`  residents: skipped ${notHandles.length} WHITE_PAGES entr${notHandles.length === 1 ? "y" : "ies"} that are not a handle the door could admit — ${notHandles.join(", ")}`);

const insLetter = db.prepare("INSERT OR REPLACE INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)");
let anon = 0;
for (const l of town.letters) {
  const id = l.id || `unidentified-${++anon}`;
  const at = (l.path && deliveredAt.get(l.path)) ?? null;
  insLetter.run(id, l.from ?? null, l.to ?? null, l.date ?? null,
    l.thread ?? null, l.box ?? null, l.owner ?? null, l.path ?? null,
    JSON.stringify(at ? { ...l, delivered_at: at } : l), at);
}

const insThread = db.prepare("INSERT OR REPLACE INTO threads VALUES (?, ?)");
for (const t of town.threads) insThread.run(t.id ?? t.root ?? t.letters?.[0]?.id ?? `t-${Math.abs(hash(JSON.stringify(t)))}`, JSON.stringify(t));

const insBulletin = db.prepare("INSERT OR REPLACE INTO bulletin VALUES (?, ?)");
for (const b of town.bulletin ?? []) insBulletin.run(b.slug, JSON.stringify(b));

const insLedger = db.prepare("INSERT INTO ledger (kind, date, id, from_h, to_h, json) VALUES (?,?,?,?,?,?)");
for (const e of town.ledger) insLedger.run(e.kind, e.date ?? null, e.id ?? null, e.from ?? null, e.to ?? null, JSON.stringify(e));

// Correspondence state — derived with the TOWN'S OWN law (imported live from
// the checkout, like stamps: one source of truth for the rule; HAL's "The
// Doorstep Must Tell the Truth", 2026-07-30 — one derivation, every surface).
// The events feed straight from readTown's parse, adapted by the law's own
// fromTownLedger so the bounce grammar never grows a second reading. Absent
// tool (an older checkout) leaves the table empty and the doorstep says
// correspondence: null honestly — the office NEVER falls back to a private
// second law; that fallback was the July 30 wound itself.
const mailStateTool = join(TOWN, "tools", "mail-state.mjs");
if (existsSync(mailStateTool)) {
  const { pathToFileURL } = await import("node:url");
  const { mailState, fromTownLedger } = await import(pathToFileURL(mailStateTool));
  const ledgerEvents = fromTownLedger(town.ledger);
  const insMailState = db.prepare("INSERT OR REPLACE INTO mail_state (handle, json) VALUES (?, ?)");
  for (const r of town.residents) {
    try { insMailState.run(r.handle, JSON.stringify(mailState({ handle: r.handle, letters: town.letters, ledgerEvents }))); }
    catch (e) { console.warn(`WARN: mail-state failed for ${r.handle} (${String(e?.message ?? e).slice(0, 120)})`); }
  }
  console.log(`  mail-state: derived for ${town.residents.length} residents by the town's own law`);
} else {
  console.warn("WARN: town checkout has no tools/mail-state.mjs — doorsteps will say correspondence: null");
}

// Stamps — folded with the TOWN'S OWN tool (imported live from the checkout,
// never vendored: the ledger grammar and its fold stay one source of truth).
const stampTool = join(TOWN, "tools", "stamp-mint.mjs");
const stampLedger = join(TOWN, "WHITE_PAGES", "stamp-ledger.md");
if (existsSync(stampTool) && existsSync(stampLedger)) {
  const { pathToFileURL } = await import("node:url");
  const { readFileSync } = await import("node:fs");
  const { parseStampLedger, foldBalances, foldMintCount, foldStaked } = await import(pathToFileURL(stampTool));
  const entries = parseStampLedger(readFileSync(stampLedger, "utf8"));
  const bal = foldBalances(entries);
  // the three tenses (quest Phase 1): balance is already LIQUID (a stake moves
  // stamps to the stake:* escrow account, out of it); mint_count is cumulative
  // (the equity number); staked is the open-stake total. liquid/assets derive on
  // read (queries.stampsDetail). Same rows as before — only two columns added.
  const mintCount = foldMintCount(entries);
  const staked = foldStaked(entries);
  const insStamp = db.prepare("INSERT OR REPLACE INTO stamps (handle, balance, mint_count, staked) VALUES (?, ?, ?, ?)");
  for (const [acct, n] of bal) if (acct !== "MINT" && acct !== "BURN") insStamp.run(acct, n, mintCount.get(acct) ?? 0, staked.get(acct) ?? 0);
  put.run("stamps_minted", String(-(bal.get("MINT") ?? 0)));
}

// The funding seam (2026-08-21): pots + holo + receipts + escrow, plus the
// patron roll that is holo joined to the receipt each row's `ref:` names.
// Folded OFFICE-SIDE for now (src/funding.mjs — field-labeled, tolerant of
// segment order) because the town lane lands the concrete grammar in the same
// window this reader ships; when tools/stamp-mint.mjs grows its own funding
// folds, switch to importing them (the stamps precedent above: one source of
// truth for the rule). Invalid rows are STORED, not dropped — the door
// surfaces them by name (refuse or disclose, never quietly substitute).
{
  const { foldFunding, parseLedgerText, readPots } = await import(new URL("./funding.mjs", import.meta.url));
  const invalid = [];
  if (existsSync(stampLedger)) {
    const f = foldFunding(parseLedgerText(readFileSync(stampLedger, "utf8")));
    const insHolo = db.prepare("INSERT INTO funding_holo (party, pot, holo, epoch, date, receipt) VALUES (?,?,?,?,?,?)");
    for (const [party, mints] of f.holoByParty) for (const m of mints) insHolo.run(party, m.pot, m.holo, m.epoch, m.date, m.receipt);
    const insKeeping = db.prepare("INSERT INTO funding_keeping_mint (party, pot, n, epoch, date) VALUES (?,?,?,?,?)");
    for (const [party, rows] of f.keepingByParty) for (const r of rows) insKeeping.run(party, r.pot, r.n, r.epoch, r.date);
    // one insert per rolled row — rollByPot carries every one of them
    // (rollByParty is the same rows keyed the other way, for the pure-fold
    // consumers)
    const insRoll = db.prepare("INSERT INTO funding_roll (patron, pot, usd, date, receipt, holo) VALUES (?,?,?,?,?,?)");
    for (const [pot, rows] of f.rollByPot) for (const r of rows) insRoll.run(r.patron, pot, r.usd, r.date, r.receipt, r.holo);
    const insRcpt = db.prepare("INSERT INTO pot_receipts (pot, rail, usd, date, receipt, payer) VALUES (?,?,?,?,?,?)");
    for (const [pot, rs] of f.receiptsByPot) for (const r of rs) insRcpt.run(pot, r.rail, r.usd, r.date, r.receipt, r.from);
    const insEsc = db.prepare("INSERT INTO pot_escrow (pot, staked) VALUES (?, ?)");
    for (const [pot, n] of f.potEscrow) insEsc.run(pot, n);
    // The same escrow, keyed by who holds it. potEscrowByHandle is the fold's
    // OWN second key — not a re-derivation here — so no netting rule is
    // restated and the per-staker rows cannot drift from the pot total. The
    // fold has already dropped every zero (a closed position is not a stake);
    // `n > 0` is belt-and-braces for a malformed ledger that returned more than
    // it staked, where a negative row would otherwise break the sum-equality
    // this table's whole worth rests on.
    const insStaker = db.prepare("INSERT INTO pot_stakers (pot, handle, staked) VALUES (?,?,?)");
    for (const [handle, mine] of f.potEscrowByHandle) for (const [pot, n] of mine) if (n > 0) insStaker.run(pot, handle, n);
    invalid.push(...f.invalid);
  }
  const potsRead = readPots(TOWN);
  const insPot = db.prepare("INSERT OR REPLACE INTO pots (id, json) VALUES (?, ?)");
  for (const p of potsRead.pots) insPot.run(p.id, JSON.stringify(p.data));
  invalid.push(...potsRead.invalid);
  const insInv = db.prepare("INSERT INTO funding_invalid (row_kind, line, reason) VALUES (?, ?, ?)");
  for (const iv of invalid) insInv.run(iv.row_kind, iv.line, iv.reason);
  if (potsRead.pots.length || invalid.length)
    console.log(`  funding: ${potsRead.pots.length} pots, ${invalid.length} invalid row(s) surfaced`);
}

// Quests — today's per-resident progress (quest gold Phase 2), folded with the
// town's OWN tool (imported live from the checkout, like stamps — one source of
// truth for the rule). Progress is deriveMints filtered to today; the registry
// is stored in meta so the API joins without a second read. The snapshot is a
// stable index of a slow-moving fact: correspondence mints only at crossings, so
// the ~15-min rehydrate cadence keeps it fresh; the API zeroes it if the TOWN_TZ
// day has rolled since this hydrate (quest_day) — see queries.questBoardFor.
const questTool = join(TOWN, "tools", "quest-progress.mjs");
const registryPath = join(TOWN, "quest-registry.json");
if (existsSync(questTool) && existsSync(registryPath)) {
  const { pathToFileURL } = await import("node:url");
  const { readFileSync } = await import("node:fs");
  const questMod = await import(pathToFileURL(questTool));
  const { foldQuestProgress, townDay } = questMod;
  const today = townDay();
  const prog = foldQuestProgress(TOWN, { today });
  const insQ = db.prepare("INSERT OR REPLACE INTO quest_progress (handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const [handle, p] of prog) {
    insQ.run(handle, p.send, p.receive, p.household.size, p.household.send, p.household.receive,
      JSON.stringify(p.sentTo ?? []), JSON.stringify(p.heardFrom ?? []));
  }
  put.run("quest_day", today);
  put.run("quest_registry", readFileSync(registryPath, "utf8"));

  // ── the standing rows: what the record already knew and nobody joined ──────
  //
  // The board's eight non-daily rows have answered `progress: null, complete:
  // null` to every resident since BOARD_LAW widened the board on 2026-09-01 —
  // "this surface did not look" printed beside eight things a 125-day resident
  // had plainly done. The facts were never missing. `onboardingFactsFor` and
  // `foldFriendships` are exported from the SAME town file as `boardForHandle`,
  // and the office already wires the first of them into the doorstep
  // (queries.nextStepsFor) and not into the board. This block is the join.
  //
  // ONE derivation, not a second one: every fact below comes from the town's
  // own exported folds. The office contributes the INDEX, exactly as it does
  // for the daily pair — nothing here re-implements a rule.
  //
  // A checkout too old to export these folds writes no rows at all, and the
  // door then answers the non-daily rows precisely as it did before this seam.
  // ⚑ THE RULES BELOW LIVE IN `src/quest-standing.mjs`, NOT HERE, and that is a
  // review finding rather than a shape I got right. They shipped inline in this
  // file, which is a SCRIPT nothing can import and nothing in the suite runs —
  // six rules watched by no test at all, every one invertible without a red.
  // This block is now the WIRING only: read the town's folds, hand them to the
  // pure reduction, write what comes back.
  if (typeof questMod.onboardingFactsFor === "function" && typeof questMod.foldFriendships === "function") {
    const { onboardingFactsFor, foldFriendships, welcomedHouseholds } = questMod;
    const { parseDeliveries, currentHouseholds } = await import(pathToFileURL(join(TOWN, "tools", "stamp-mint.mjs")));
    const { standingRowsFromTown } = await import("./quest-standing.mjs");

    // `isResidentHandle` is the office's own admission grammar and the reason
    // this iterates it rather than `town.residents` raw: the raw list carries
    // `_archived`, which the daily fold already excludes, so an unfiltered loop
    // wrote a standing row nothing would ever read.
    const handles = town.residents.map((r) => r.handle).filter(isResidentHandle);
    // EVERY town fold ONCE per rehydrate — the deliveries parse this block
    // already shared, and the households roll + welcomed set the welcome row
    // needs, which `onboardingFactsFor` otherwise re-resolves per resident at
    // three ledger parses each. `foldOnboarding` is not the call because it
    // would parse the mail ledger a second time for the same `deliveries`.
    // The rule lives in quest-standing.mjs; this line is the wiring.
    const { rows, friendships } = standingRowsFromTown(
      { parseDeliveries, foldFriendships, currentHouseholds, welcomedHouseholds, onboardingFactsFor },
      TOWN, handles);

    const insS = db.prepare("INSERT OR REPLACE INTO quest_standing (handle, json) VALUES (?, ?)");
    for (const [h, row] of rows) insS.run(h, JSON.stringify(row));
    console.log(`  quests: ${prog.size} progress rows, ${rows.size} standing rows` +
      (friendships.active ? `, ${friendships.pairs.length} friendship pairs` : ", friendship ladder not sealed"));
  }
}

// ── atlas: regions + homes ───────────────────────────────────────────────────
// The town's spatial truth is the judgment ledger PROJECTS/build-the-town/atlas/
// placements.json (the ONLY place placement judgment lives) joined with each
// resident's own HOME/HOME.md + HOME/REGION.md (already parsed by readTown into
// resident.home / resident.region / assets). We mirror town-atlas.mjs's join:
// a region's residents are its holder plus every home the ledger places in it.
// If the ledger isn't in the checkout, we serve nothing rather than invent.
const byHandle = new Map(town.residents.map((r) => [r.handle, r]));
const homeAssets = (r) => (Array.isArray(r?.home?.data?.assets) ? r.home.data.assets : [])
  .map((a) => `WHITE_PAGES/${r.handle}/HOME/${a}`);

const placementsPath = join(TOWN, "PROJECTS", "build-the-town", "atlas", "placements.json");
if (existsSync(placementsPath)) {
  let placements = { facts: [] };
  try { placements = JSON.parse(readFileSync(placementsPath, "utf8")); }
  catch (e) { console.warn(`WARN: placements.json unparseable — regions/homes left empty: ${e.message}`); }
  const facts = Array.isArray(placements.facts) ? placements.facts : [];
  const regionFacts = facts.filter((f) => f.kind === "region");
  const homeFacts = facts.filter((f) => f.kind === "home");
  const regionOfResident = new Map(); // handle -> region id (authoritative placement)
  for (const h of homeFacts) if (h.resident && h.region) regionOfResident.set(h.resident, h.region);

  const insRegion = db.prepare("INSERT OR REPLACE INTO regions VALUES (?, ?, ?)");
  for (const rf of regionFacts) {
    const holder = byHandle.get(rf.holder);
    const name = holder?.region?.data?.region ?? rf.id;
    const residents = [...new Set([rf.holder, ...homeFacts.filter((h) => h.region === rf.id).map((h) => h.resident)])]
      .filter((h) => byHandle.has(h)).sort();
    const images = (Array.isArray(holder?.region?.data?.assets) ? holder.region.data.assets : [])
      .map((a) => `WHITE_PAGES/${rf.holder}/HOME/${a}`);
    // `style` is the founder's own one-line rendering note from REGION.md's
    // frontmatter, and it is here because GET /regions/{slug} serves it: the
    // row already carried every other field that door answers, `body` whole
    // included. Null when the holder wrote no REGION.md (or wrote one without
    // the key) — the same silence the empty `body` keeps for them.
    insRegion.run(rf.id, name, JSON.stringify({
      id: rf.id, name, holder: rf.holder, bearing: rf.bearing, band: rf.band,
      status: rf.status, body: holder?.region?.body ?? "", images, residents,
      style: holder?.region?.data?.style ?? null,
    }));
  }

  const insHome = db.prepare("INSERT OR REPLACE INTO homes VALUES (?, ?, ?)");
  for (const r of town.residents) {
    if (!r.home) continue; // no HOME/HOME.md — reachable at the post office, not a home row
    const region = regionOfResident.get(r.handle) ?? null;
    insHome.run(r.handle, region, JSON.stringify({
      handle: r.handle, title: r.home.data?.title ?? r.handle, region,
      description: r.home.body ?? "", images: homeAssets(r),
    }));
  }
  console.log(`  atlas: ${regionFacts.length} regions, ${town.residents.filter((r) => r.home).length} homes`);
} else {
  console.warn("WARN: no atlas placements.json in checkout — /regions and /homes will be empty.");
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

db.close();
console.log(`hydrated ${DB_PATH}`);
console.log(`  as_of ${asOf.slice(0, 12)} — ${town.residents.length} residents, ${town.letters.length} letters, ${town.threads.length} threads, ${town.ledger.length} ledger entries`);
