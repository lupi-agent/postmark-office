// households.mjs — the household block for identity-shaped responses.
//
// Ruling 2026-08-07 (1 human = 1 household): wherever a surface answers "who
// are you" or "stamps associated with you", HOUSEHOLD is the primary column
// over resident. This module is the office's one resolver for that block.
//
// Shape, per handle:
//   { key,                    the house's key: `hh:<slug>`, or `solo:<handle>` for a handle no house holds
//     slug,                   the house's slug, null for a handle no house holds
//     human,                  the house's human-facing name, null if the row names none
//     residents }             the handles the house lists (sorted), or [handle] alone
//
// ── IT READS THE STORE (POS-342, w42 "Everything Reads the Store") ──────────
//
// Darko's ruling, 2026-10-04: git can be written to, the store reads git, the
// store is the record, and every reader reads the store. This module used to
// answer from the TOWN CLONE: the stamp ledger's `currentHouseholds` (the
// economy's key, folded over the sealed `registry:` lines) plus the printed
// `tools/households.json`. Both are copies; the registry's one writer is the
// ceremony (src/ceremony.mjs) into `households`/`household_pins` (019), and the
// files are printed from those rows by tools/registry-drain.mjs. So a housemate
// bound in the store and not yet drained was "not of this household" at the
// hold door, which is the exact gap the inventory named (B1).
//
// The walk is the deriver's (`household-deriver.mjs § resolveHouse`, POS-160),
// over the rows `loadRegistryRows` reads, so this answers "which house NOW" the
// same way every store-side resolver does. "Which key did this handle's mail
// mint under on a date" is a different question with a date in it; it stays
// the sealed ledger's (POS-341), and nothing here answers it.
//
// ── ASYNC AT THE CALLER, SYNC IN THE LADDER ─────────────────────────────────
//
// The store read is async, and several readers ask it inside a synchronous
// ladder (`world-hold.mjs § sameHousehold`, `setDownAnswer`) that falsifiers
// drive with an injected function. So the read is split in two:
// `householdLookup()` reads the rows ONCE and hands back a synchronous
// `(handle) => block` over them; `householdOf(handle)` is the one-shot form.
// A caller that asks many times per request takes the lookup at its own async
// edge and passes it down, exactly as the ladders were already handed one.
//
// ── NULL IS "COULD NOT LOOK" ────────────────────────────────────────────────
//
// `householdLookup()` answers null when the office is not pointed at the record
// (or the read failed): the block is garnish and the ladders already degrade
// on an absent resolver ("handle-only", and they say so). A read that DID look
// and found no house for a handle answers the solo block, which is a fact
// ("this handle is a household of one"), not a guess about a house.
//
// No memo across calls, on purpose: the registry is three small reads, the
// office runs several processes and a ceremony writes in only one of them, so
// a per-process fold would answer with the town from before the ceremony in
// every other process for as long as it lived.

import { loadRegistryRows } from "./registry-store.mjs";
import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";
import { resolveHouse, keyOfSlug } from "./household-deriver.mjs";

/**
 * The synchronous `(handle) => block` over one registry read. PURE.
 *
 * @param registry `{ households: { slug: rec } }`, as `registryFromRows` gives it.
 * @param pins     `{ handle: { login, id, … } }`, as `pinsFromRows` gives it.
 */
export function householdLookupOf(registry, pins = {}) {
  const houses = registry?.households ?? {};
  const memo = new Map();
  return (handle) => {
    if (handle == null || handle === "") return null;
    const h = String(handle);
    if (memo.has(h)) return memo.get(h);
    const { slug } = resolveHouse(h, registry, pins);
    const rec = slug ? houses[slug] ?? {} : null;
    const block = slug
      ? { key: keyOfSlug(slug), slug, human: rec.human ?? null, residents: [...(rec.residents ?? [])].map(String).sort() }
      : { key: `solo:${h}`, slug: null, human: null, residents: [h] };
    memo.set(h, block);
    return block;
  };
}

/** One registry read -> the synchronous lookup, or null when the store could not be asked. */
export async function householdLookup(env = process.env) {
  let rows;
  try { rows = await loadRegistryRows(env); } catch (e) { warnOnce(e); return null; }
  if (rows === null) return null;
  return householdLookupOf(registryFromRows(rows), pinsFromRows(rows));
}

/** The block for one handle, from the store; null when the store could not be asked. */
export async function householdOf(handle, env = process.env) {
  const lookup = await householdLookup(env);
  return lookup ? lookup(handle) : null;
}

/**
 * The resident card's `household`, added at the door (the card's composer is
 * synchronous and shared with the store's twin). Garnish-shaped: a store that
 * cannot be asked leaves the card as it was, and never 500s a read.
 */
export async function withHouseholdBlock(card, handle, env = process.env) {
  if (!card) return card;
  try { const hh = await householdOf(handle, env); if (hh) card.household = hh; } catch { /* garnish only */ }
  return card;
}

/** `{ handle: block }` for every handle, or null when no block could be read (the `/me` and `whoami` garnish). */
export async function householdsFor(handles = [], env = process.env) {
  const list = [...(handles ?? [])];
  if (!list.length) return null;
  const lookup = await householdLookup(env);
  if (!lookup) return null;
  return Object.fromEntries(list.map((h) => [h, lookup(h)]));
}

/**
 * The household's HUMAN, as the town's record names them.
 *
 * ONE DERIVATION, TWO CALLERS. `worldSayHuman` has owned this label since
 * 2026-08-08 — `human-of-<household slug>`, the town's declared slug when the
 * registry has one and the first handle otherwise, "NEVER the GitHub login
 * (the office does not name people)". The apex now needs the SAME name, because
 * an embodied act has to be handed the hand it is recorded under, and a second
 * derivation there would be a second answer to a settled question — the drift
 * the quote law exists to kill. So the derivation moved here, where household
 * identity already lives, and both doors read it.
 *
 * The prefix is reserved town-wide on purpose: `residency.mjs` and
 * `declare.mjs` each refuse a resident handle wearing it, precisely so this
 * label can never collide with somebody's own voice.
 *
 * Null when there is no handle to name a household after — never a guessed
 * default, for the same reason `humanTokenUrl` returns null rather than
 * somebody else's face.
 *
 * `lookup` is the caller's own `householdLookup()` when it already holds one;
 * otherwise this reads the store once.
 */
export async function humanHandFor(handles = [], lookup = undefined) {
  const list = [...handles].filter(Boolean).map(String);
  if (!list.length) return null;
  const of = lookup === undefined ? await householdLookup() : lookup;
  let slug = null;
  for (const h of list) {
    try { const hh = of?.(h); if (hh?.slug) { slug = hh.slug; break; } } catch { /* garnish only */ }
  }
  return `human-of-${slug ?? list[0]}`;
}

/**
 * The household a resident's OWN key would carry, from the store's pins.
 *
 * POS-233: a placer places a resident's first parcel as the resident's own act,
 * so the act must land under the household the resident's key names — and a
 * signed-in key names it by the GitHub login (`oauth.mjs § householdFor`, whose
 * pins are authoritative: "Pinned immutable IDs win"). This reads the same pin
 * that function matches, in the other direction, from the same record
 * (`household_pins`, POS-343).
 *
 * Null for a handle with no pin, AND when the store could not be asked: the
 * office then cannot say which household the act belongs under, and the caller
 * refuses rather than guessing.
 */
export async function pinnedLoginOf(handle, env = process.env) {
  try {
    const rows = await loadRegistryRows(env);
    if (rows === null) return null;
    const login = pinsFromRows(rows)?.[handle]?.login;
    return login ? String(login) : null;
  } catch { return null; }
}

let warned = false;
function warnOnce(e) {
  if (!warned) { warned = true; console.warn("households: the store's registry could not be read:", e?.message); }
}
