// fund-holder.mjs — WHOSE NAME A PAYMENT GOES IN: the signed-in account's household,
// and the one resident who holds its stamps (POS-317, Keemin 2026-10-02).
//
// Keemin's 09-21 direction (docs/2026-09-21/design-notes/pos-157-fund-attribution-
// addendum.md) and his rulings of 2026-10-02: a payment credits the HOUSEHOLD, not
// a resident; a signed-in payer sees their household's name and types nothing; a
// signed-out payer is an outside gift.
//
// ── THE REFERENCE IS THE ACCOUNT, NEVER A SLUG ──────────────────────────────
//
// The page mints the signed-in account's GitHub id into each rail's own
// reference: Stripe `<pot>_g<id>`, PayPal `<pot>|g<id>`, the USDC form's
// `household: g<id>`. Not the household slug: four slugs carry a dot (Stripe's
// reference takes only letters, digits, `-` and `_`) and one is 858 characters
// (Stripe allows 200, PayPal 127). An account id is short, stable, and is the
// key the registry already binds households by (households.json § accounts).
//
// ── `from:` STAYS A RESIDENT HANDLE ─────────────────────────────────────────
//
// Measured before building (docs/2026-10-02/rail/fund-household/measure-from.out):
// the town's close reads a pot-receipt's `from:` as a HANDLE. `isResident(from)`
// asks the white pages, `hhKey(from)` finds the household for the ρ cap and the
// self-stake exclusion, and the holo row puts the stamps on that account. A slug
// there would mint nothing, or pay a resident whose handle happens to equal it.
// So the household is resolved to ONE resident, and `from:` names that handle.
// The credit is still the household's: the close caps and excludes by household.
//
// ── WHICH RESIDENT: ONE FUNCTION, ONE RULE (open with Keemin) ───────────────
//
// For a household with several residents, `holderOf` picks the holder. The
// default is the join bundle's own FIRST RESIDENT rule, the town's
// (tools/stamp-mint.mjs --welcome-plan): the earliest `pinned` date in
// tools/github-ids.json among the house's residents, ties alphabetical, a
// resident with no pin after every pinned one; meeps are skipped (they stay
// outside the currency). Keemin may instead rule that the household chooses
// (one dropdown); `choose` is the seam for that, and every caller (the Stripe
// and PayPal watchers, the /fund door, GET /me for the page) asks this one
// function, so the page always shows the name the watcher will credit.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** `g<id>`: an account reference, as every rail carries it. */
export const ACCOUNT_REF_RE = /^g([1-9]\d{0,19})$/;
export const accountRef = (ghId) => `g${String(ghId)}`;
/** The GitHub id in an account reference, or null. */
export function parseAccountRef(s) {
  const m = ACCOUNT_REF_RE.exec(String(s ?? "").trim());
  return m ? m[1] : null;
}

/** Each rail's separator between the pot and the payer part of its reference. */
export const REF_SEP = Object.freeze({ stripe: "_", paypal: "|" });

/**
 * A rail's reference, read: `{ pot, account, typed }`. `account` is the GitHub id
 * when the payer part is `g<id>`; `typed` is any other payer part (PayPal's older
 * `<pot>|<handle>` orders), trimmed or null. A bare `<pot>` has neither.
 */
export function parseFundRef(ref, rail) {
  if (ref == null || String(ref).trim() === "") return { pot: null, account: null, typed: null };
  const s = String(ref);
  const sep = REF_SEP[rail];
  if (!sep) throw new Error(`no reference shape for rail "${rail}"`);
  const i = s.indexOf(sep);
  const pot = (i === -1 ? s : s.slice(0, i)).trim() || null;
  const rest = i === -1 ? "" : s.slice(i + 1).trim();
  const account = parseAccountRef(rest);
  return { pot, account, typed: account || !rest ? null : rest };
}

/** A rail's reference for a pot and, when signed in, the account. */
export function fundRefFor(pot, ghId, rail) {
  const sep = REF_SEP[rail];
  if (!sep) throw new Error(`no reference shape for rail "${rail}"`);
  return ghId == null || ghId === "" ? String(pot) : `${pot}${sep}${accountRef(ghId)}`;
}

// ── the registry, read from the town clone ──────────────────────────────────

let cache = null;
/** `{ houses, pins }` from the town clone's tools/households.json and tools/github-ids.json, cached on their stamps. */
export function readFundRegistry(clone) {
  const files = ["households.json", "github-ids.json"].map((f) => join(clone, "tools", f));
  let stamp;
  try { stamp = files.map((f) => { const st = statSync(f); return `${f}|${st.mtimeMs}|${st.size}`; }).join(";"); }
  catch { return null; }
  if (cache?.stamp === stamp) return cache.value;
  try {
    const houses = JSON.parse(readFileSync(files[0], "utf8"))?.households ?? {};
    const pins = JSON.parse(readFileSync(files[1], "utf8")) ?? {};
    cache = { stamp, value: { houses, pins } };
    return cache.value;
  } catch { return null; }
}

/** The declared household an account belongs to (households.json § accounts[].id), or null. */
export function houseForAccount(ghId, houses) {
  const id = Number(ghId);
  if (!Number.isFinite(id)) return null;
  for (const [slug, rec] of Object.entries(houses ?? {}))
    if ((rec?.accounts ?? []).some((a) => Number(a?.id) === id)) return slug;
  return null;
}

/** The town's FIRST RESIDENT rule: earliest `pinned`, ties alphabetical, unpinned last. */
export function firstResident(residents, pins) {
  const pinnedOf = (h) => (pins?.[h] && typeof pins[h] === "object" && typeof pins[h].pinned === "string" ? pins[h].pinned : null);
  return residents.slice().sort((a, b) => {
    const pa = pinnedOf(a), pb = pinnedOf(b);
    if (pa && pb && pa !== pb) return pa < pb ? -1 : 1;
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;
    return a.localeCompare(b);
  })[0] ?? null;
}
export const RULE_FIRST_RESIDENT = "first-resident";

/**
 * THE HOLDER: the one resident of a household whose handle a payment's `from:`
 * names. `{ household, name, handle, residents, rule }`, or null when the house
 * holds no resident who can receive stamps. `choose(residents, pins)` is the
 * rule; the default is the join bundle's first resident.
 */
export function holderOf(slug, { houses, pins, isMeep = () => false, choose = firstResident, rule = RULE_FIRST_RESIDENT } = {}) {
  const rec = houses?.[slug];
  if (!rec) return null;
  const residents = [...new Set((rec.residents ?? []).map(String))].filter((h) => !isMeep(h)).sort();
  const handle = residents.length ? choose(residents, pins) : null;
  if (!handle) return null;
  return { household: slug, name: rec.name ?? slug, handle, residents, rule };
}

/** An account's holder, end to end: account → household → resident. Null for an account no household holds. */
export function fundHolder(ghId, { registry, isMeep = () => false, choose, rule } = {}) {
  if (!registry) return null;
  const slug = houseForAccount(ghId, registry.houses);
  return slug ? holderOf(slug, { houses: registry.houses, pins: registry.pins, isMeep, ...(choose ? { choose, rule } : {}) }) : null;
}

/**
 * The resolution a watcher records for an account reference: the holder, or a
 * gift. `outside` is the rail's own unattached spelling. The note says, on the
 * row, which account it was, which household it named and by which rule the
 * holder was chosen, so the grace window can review it.
 */
export function resolveAccount(ghId, { registry, isMeep, outside }) {
  const h = fundHolder(ghId, { registry, isMeep });
  if (!h)
    return { attributed: false, from: outside, via: null, gift_note: `the payment names account ${accountRef(ghId)}, which no household holds, so these dollars are witnessed as a gift under ${outside} and mint no holo.` };
  return {
    attributed: true, from: h.handle, via: "household", household: h.household,
    household_note: `paid in the name of the household ${h.name} (account ${accountRef(ghId)}); its stamps are held by ${h.handle}${h.residents.length > 1 ? `, its ${h.rule === RULE_FIRST_RESIDENT ? "first resident" : `holder by ${h.rule}`} among ${h.residents.join(", ")}` : ""}.`,
  };
}

/** The town's meep law at a date, from its own ledger and its own checker (the engine is the town's stamp-mint). */
export function meepLawOf(engine, entries, date) {
  try { const { laws } = engine.parseLaws(entries); const m = engine.meepChecker(laws); return (h) => m(h, date); }
  catch { return () => false; }
}

// ── the holder at the office: what GET /me shows the fund page ──────────────
//
// The page names the household a payment will be in ("for <household name>"),
// so it must ask the same function the watchers do. The meep law is the town's
// own, read from its ledger through its own checker, cached on the ledger's
// stamp (the ledger is ~3 MB; /me is asked on every signed-in page).
let meepCache = null;
async function meepLawAtOffice(clone) {
  const { existsSync, readFileSync: rf } = await import("node:fs");
  const { pathToFileURL } = await import("node:url");
  const ledger = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  const tool = join(clone, "tools", "stamp-mint.mjs");
  if (!existsSync(ledger) || !existsSync(tool)) return () => false;
  const st = statSync(ledger);
  const key = `${ledger}|${st.mtimeMs}|${st.size}`;
  if (meepCache?.key === key) return meepCache.isMeep;
  const engine = await import(pathToFileURL(tool).href);
  const entries = engine.parseStampLedger(rf(ledger, "utf8"));
  const isMeep = meepLawOf(engine, entries, new Date().toISOString().slice(0, 10));
  meepCache = { key, isMeep };
  return isMeep;
}

/** `{ household, name, handle, residents, rule }` for a signed-in account, or null. */
export async function fundHolderAtOffice(clone, ghId) {
  if (ghId == null) return null;
  const registry = readFundRegistry(clone);
  if (!registry) return null;
  return fundHolder(ghId, { registry, isMeep: await meepLawAtOffice(clone) });
}
