// registry-backfill.mjs — EVERY HOUSEHOLD IN THE ROLL GETS EXACTLY ONE ROW, PURE.
//
// RULED (Keemin, 2026-09-22, POS-159): a house that never declared gets a
// PROVISIONAL key from its FIRST resident's HANDLE — handles are already unique
// slugs — and chooses its real one ONCE, at the human's first co-sign
// (`src/ceremony.mjs § THE CHOOSE-ONCE PATH`). The provisional key then lands in
// `formerly` rather than vanishing, `provisional` goes false, and from that
// moment the key is immutable like everyone else's.
//
// This module is the DECISION and nothing else — no database, no clock, no
// filesystem, no network, no git. `tools/registry-backfill.mjs` reads the roll
// off a town checkout and the registry out of the store, hands both to
// `planBackfill`, and either prints the plan or writes it. Splitting it here is
// what lets the rule be falsified against the town's REAL 118 houses and its
// REAL 188 residents without a Postgres anywhere.
//
// ── WHAT THE PLAN IS TODAY: NOTHING, AND THAT IS THE MEASUREMENT ────────────
//
// Measured 2026-09-22 against town `origin/main` 1cd13ff57 and the registry
// fixture (which `cmp` says IS the town's two files at that tip):
//
//     residents on the roll                                        188
//     resolved to a standing house by account                      188
//     listed in that same house's `residents` array                188
//     resolved by NEITHER account nor display name                   0
//     rows this planner plans                                        0
//
// The 09-21 note's "3 of 119" does not reproduce. By DISPLAY NAME alone the
// count would be 24 — 24 residents state a `household:` label `houseForName`
// cannot find, because their house is declared under a different slug. That gap
// is the whole reason this planner reads more than one road, and it is why the
// falsifier for the rule runs on a SYNTHETIC roll: a planner that planned
// nothing at all would pass the real-roll assertion, and a probe that cannot
// fail is not a probe. `test/registry-backfill.test.mjs` asserts both, and pins
// the real-roll answer to the measured NAMES as well as the measured count, so
// a roll that grows a provisional house reds rather than drifts.
//
// ── THREE ROADS TO A HOUSE, AND WHY THE THIRD IS HERE ───────────────────────
//
// The brief named two, and they are the office's own deciders — `houseForAccount`
// (immutable GitHub id first, login only where the row carries no id) and
// `houseForName` (slug, `name` and `human`, all through one slugger). This
// planner reads a THIRD: the house's own `residents` array.
//
// Not for today's answer — all three agree on all 188 — but for IDEMPOTENCE,
// which is the property `--apply` is judged on. A row this tool writes carries
// its residents and its first resident's account. The account road re-finds it
// on the second run, but ONLY for a resident who has a pin; a resident with no
// pin would be planned into a second house on every run forever. The residents
// array re-finds them whether or not anybody is pinned, so a second `--apply`
// plans zero by construction rather than by luck.
//
// ── ONE ROW PER HOUSE, NOT PER RESIDENT ─────────────────────────────────────
//
// Residents are grouped by the house they CLAIM — the card's `household:` line,
// normalised through the same slugger the office's own `houseForName` uses, so
// "Sydney Kitts" and "sydney-kitts" are one house and not two. A card that
// states no household at all is a house of ONE, keyed by its own handle; two
// such cards are two houses, because nothing on either card says otherwise and
// guessing that two silent residents live together is how a backfill invents a
// household nobody asked for.

import { registryFromRows, pinsFromRows } from "./registry-rows.mjs";
import { houseForAccount, houseForName, slugFromName } from "./residency.mjs";
import { slugIsWellFormed } from "./ceremony.mjs";

/** The provenance sentence every backfilled row carries. Stated once. */
export const BACKFILL_DECLARED_BY =
  "the POS-159 backfill: this house stands in the roll and had no row. Its key is PROVISIONAL, "
  + "taken from its first resident's handle, and it is chosen for good at the human's first co-sign.";

/** What a provisional house is called until its humans say otherwise. */
export const provisionalName = (agent, handle) =>
  String(agent ?? "").trim()
    ? String(agent).trim() + "'s household"
    : String(handle) + "'s household";

/**
 * The key a house borrows, and the one it borrows when that is taken.
 *
 * The handle first, because a handle is already a unique, lawful, path-safe
 * slug that its resident answers to. Handle-plus-household second, because it
 * is the one fallback still obviously ABOUT that resident — measured over
 * today's roll, 3 of 188 handles already hold a registry slug
 * (`elias-returning`, `mari`, `moth`) and none of their fallbacks collides.
 *
 * A third collision is NOT resolved by a counter. A key ending in a number is
 * one nobody can read and nobody chose, and the honest answer at that point is
 * that a person looks — so the planner records a REFUSAL against that house and
 * `--apply` stops on it.
 */
export const provisionalSlugs = (handle) => [String(handle), String(handle) + "-household"];

// THE FIRST RESIDENT IS THE EARLIEST `joined`, and the tie is broken by handle
// rather than left to the sort's stability, because the slug the whole house
// carries is read off this one entry. A card with no `joined` sorts LAST: it
// cannot be shown to be earliest, and a house keyed off an unknown date is a
// key chosen by an accident of parsing.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const LAST = "￿";

export function byJoined(residents) {
  return [...residents].sort((a, b) =>
    cmp(a.joined || LAST, b.joined || LAST) || cmp(a.handle, b.handle));
}

/**
 * The plan: one row per house in the roll that the registry does not hold.
 *
 * `roll`         `[{ handle, agent, household, joined, pin: { login, id } | null }]`
 *                — one entry per resident with an ADDRESS card. `household` is
 *                the card's own `household:` line, or null when it states none.
 * `registryRows` the store's rows (`{ meta, households, pins }`), as
 *                `loadRegistryRows` hands them back.
 *
 * Returns `{ houses, counts, refusals, resolved }`:
 *
 *   houses     one entry per row to write, ready for `insertHousehold` and
 *              `upsertPin` (see `rowForHouse` below).
 *   counts     `{ residents, resolved, planned, pins }`.
 *   refusals   `[{ house, why }]` — a house the planner will NOT write, and the
 *              sentence saying why. A non-empty list stops `--apply`.
 *   resolved   `[{ handle, slug, road }]` — every resident the registry already
 *              holds, and WHICH road found them. This is not decoration: it is
 *              how a reader checks that "0 planned" means "everybody has a row"
 *              rather than "the roll failed to load".
 */
export function planBackfill(roll, registryRows, { declaredBy = BACKFILL_DECLARED_BY } = {}) {
  const rows = registryRows ?? { meta: {}, households: [], pins: [] };
  const registry = registryFromRows(rows);
  const standingPins = pinsFromRows(rows);
  const taken = new Set(Object.keys(registry.households ?? {}));

  // the third road, built once: handle -> the house that lists it
  const listedIn = new Map();
  for (const [slug, rec] of Object.entries(registry.households ?? {}))
    for (const h of rec.residents ?? []) if (!listedIn.has(h)) listedIn.set(h, slug);

  const resolved = [];
  const homeless = [];
  for (const r of roll ?? []) {
    const byAccount = r.pin ? houseForAccount(registry, r.pin.id, r.pin.login) : null;
    const byName = r.household ? houseForName(registry, r.household) : null;
    const byResidents = listedIn.get(r.handle) ?? null;
    const slug = byAccount ?? byName ?? byResidents;
    if (slug) resolved.push({ handle: r.handle, slug, road: byAccount ? "account" : byName ? "name" : "residents" });
    else homeless.push(r);
  }

  // ONE HOUSE PER CLAIMED LABEL. The label is normalised through the office's
  // own slugger so that the grouping and `houseForName` cannot disagree about
  // what counts as the same house. A card with no label is its own house.
  const groups = new Map();
  for (const r of homeless) {
    const label = r.household ? slugFromName(r.household) : null;
    const key = label ? "name:" + label : "handle:" + r.handle;
    if (!groups.has(key)) groups.set(key, { claimed: r.household ?? null, residents: [] });
    groups.get(key).residents.push(r);
  }

  // THE GROUPS ARE WALKED IN A STATED ORDER, not in whatever order the roll
  // arrived. Two houses can contend for one fallback key, and which of them
  // gets it must not depend on the order a directory listing came back in — so
  // the walk is by each group's own first-resident handle, and the plan for a
  // given roll is the same plan every time it is computed.
  const ordered = [...groups.values()]
    .map((g) => ({ ...g, residents: byJoined(g.residents) }))
    .sort((a, b) => cmp(a.residents[0].handle, b.residents[0].handle));

  const houses = [];
  const refusals = [];
  const claimedHere = new Set();

  for (const g of ordered) {
    const first = g.residents[0];
    const label = g.claimed
      ? JSON.stringify(g.claimed)
      : first.handle + " (the card states no household)";

    const candidates = provisionalSlugs(first.handle);
    const lawful = candidates.filter((c) => slugIsWellFormed(c));
    if (!lawful.length) {
      refusals.push({
        house: label,
        why: "neither " + candidates[0] + " nor " + candidates[1] + " is a lawful household key"
          + " (lowercase letters, digits and single hyphens, 2-40) — this house's first resident"
          + " cannot lend it one, and a person has to choose",
      });
      continue;
    }
    const free = lawful.find((c) => !taken.has(c) && !claimedHere.has(c));
    if (!free) {
      refusals.push({
        house: label,
        why: "every key this house can borrow is taken (" + lawful.join(", ") + ") — the planner"
          + " does not invent a counter, because a key nobody chose and nobody can read is worse"
          + " than a stop",
      });
      continue;
    }
    claimedHere.add(free);

    // The accounts are every DISTINCT pin the group's residents hold, first
    // resident first. A house whose residents share a human has one; a house
    // where two humans co-sign has two, which is a shape the live registry
    // already wears (121 accounts over 118 houses).
    const accounts = [];
    for (const r of g.residents) {
      if (!r.pin) continue;
      if (accounts.some((a) => String(a.id) === String(r.pin.id))) continue;
      accounts.push({ login: r.pin.login, id: r.pin.id });
    }

    houses.push({
      slug: free,
      provisionalFrom: first.handle,
      fallback: free !== candidates[0],
      claimed: g.claimed ?? null,
      name: provisionalName(first.agent, first.handle),
      since: first.joined ?? first.since ?? null,
      declared_by: declaredBy,
      firstResident: first.handle,
      residents: g.residents.map((r) => r.handle),
      accounts,
      // Only the pins the registry does NOT already hold. A pin that stands is
      // an identity on record, and re-binding one is a human ceremony — the
      // same rule `joinHousehold` keeps (src/ceremony.mjs § THE PIN IS NEVER
      // RE-BOUND HERE), kept here rather than restated at the writer.
      pins: g.residents
        .filter((r) => r.pin && !standingPins[r.handle])
        .map((r) => ({ handle: r.handle, login: r.pin.login, gh_id: r.pin.id, pinned: r.joined ?? null })),
    });
  }

  return {
    houses,
    refusals,
    resolved,
    counts: {
      residents: (roll ?? []).length,
      resolved: resolved.length,
      planned: houses.length,
      pins: houses.reduce((n, h) => n + h.pins.length, 0),
    },
  };
}

/**
 * The row a planned house writes, in the store's own shape.
 *
 * `ord` is ABSENT on purpose: `insertHousehold` assigns the place inside the
 * INSERT, and a caller that could choose one is the caller that raced
 * (`src/registry-store.mjs` § A NEW HOUSE TAKES ITS PLACE FROM THE DATABASE).
 *
 * `human` and `member_of` are NULL because nobody has said otherwise. A
 * backfill states what the roll holds; it does not guess a human's name onto a
 * public file, and the town's own card renders an unstated name as
 * "(unstated — ask them)" rather than as a blank.
 */
export const rowForHouse = (h) => ({
  slug: h.slug,
  name: h.name,
  human: null,
  accounts: h.accounts,
  residents: h.residents,
  since: h.since,
  member_of: null,
  declared_by: h.declared_by,
  formerly: [],
  provisional: true,
});
