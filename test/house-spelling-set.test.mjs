// house-spelling-set.test.mjs — the store's ground reads the house, whichever spelling its rows wear (POS-406).
//
// Found by amia-semper's refusal (2026-10-05). Her parcel,
// amia-semper/the-stone-cottage-creek-parcel, is stored `gh:273009068` (the
// town mint's grain for her account); her shrines inside it are stored
// `hh:house-of-harvey`. RULING 4: the store never respells, and a house has a
// SPELLING SET. The standing walk compared the two strings, so her shrines were
// not sovereign in the store, read `market`, and her amend was refused
// escrow-absent at the clearing. The same compare put 21 marks on the notary's
// escrow_unbacked list, which reads the tier the walk writes.
//
// office #288 (the Starling House) gave the walk `houseOf` at the candle, the
// crossing's recompute and the review door. These are the readers it missed:
// the standing-equality falsifier (which re-walks the store and would call
// every corrected tier a divergence) and the parcel-cap tripwire.

import test from "node:test";
import assert from "node:assert/strict";
import { computeStanding, admissionNotes } from "../world2/tools/standing.mjs";
import { escrowAbsentAmong } from "../world2/tools/escrow-presence.mjs";
import { standingFindings, idempotenceFindings } from "../world2/tools/falsifier-standing-equality.mjs";
import { liveHouseOf, houseKeysOf } from "../src/household-deriver.mjs";

// house-of-harvey as the town's tools/households.json holds it (d5b42922).
const REGISTRY = { households: {
  "house-of-harvey": { name: "house-of-harvey", accounts: [{ login: "generalroam-boop", id: 273009068 }],
    residents: ["amia-semper", "scout", "bones"], since: "2026-08-29" },
} };
const PINS = { "amia-semper": { login: "generalroam-boop", id: 273009068, pinned: "2026-08-29" } };
const houseOf = liveHouseOf(REGISTRY, PINS);

// The two rows as the public store read returns them (2026-10-06T01:14Z).
const PARCEL = { id: "p-amia", slug: "amia-semper/the-stone-cottage-creek-parcel", kind: "parcel", owner: "amia-semper",
  household: "gh:273009068", geometry: { at: { x: 3200, y: -2900 }, extent: { w: 25, h: 25 } }, parent: null,
  data: { tier: "home" } };
const SHRINE = { id: "s-amia", slug: "amia-semper/shrine-of-the-pretzel", kind: "sited", owner: "amia-semper",
  household: "hh:house-of-harvey", geometry: { at: { x: 3205, y: -2909 }, extent: { w: 3, h: 3 } }, parent: null,
  data: { tier: "market" } };

test("the spelling set: gh:273009068 is house-of-harvey's, and every spelling answers the house's live key", () => {
  assert.ok(houseKeysOf("hh:house-of-harvey", REGISTRY, PINS).includes("gh:273009068"));
  assert.equal(houseOf("gh:273009068"), "hh:house-of-harvey");
  assert.equal(houseOf("solo:amia-semper"), "hh:house-of-harvey");
  assert.equal(houseOf("hh:house-of-harvey"), "hh:house-of-harvey");
  assert.equal(houseOf("solo:the-town"), "solo:the-town", "the town's interim key is no house's, so it is its own household");
  assert.equal(houseOf("gh:1"), "gh:1", "a spelling no house claims is itself");
});

test("POS-406 · Amia's shrine inside her parcel is home through the house, and the candle does not refuse it", () => {
  const only = new Set([SHRINE.slug]);
  const tiers = computeStanding([PARCEL, SHRINE], { only, houseOf });
  assert.equal(tiers.get(SHRINE.slug), "home", "her parcel is gh:273009068 and her shrine hh:house-of-harvey: one house");
  const verdict = escrowAbsentAmong([{ id: "c-amend", slug: SHRINE.slug }],
    { tiers, escrowByMark: new Map([["someone/else", 1]]), townSha: "abcdef1234" });
  assert.deepEqual(verdict.refused, [], "a ✦0 amend on her own ground is not escrow-absent");
  // the control leg: the string walk is the refusal she got
  assert.equal(computeStanding([PARCEL, SHRINE], { only }).get(SHRINE.slug), "market");
});

test("POS-406 · the town's own marks keep their walk: solo:the-town maps to itself", () => {
  const ground = { id: "t1", slug: "the-town/the-commons-green", kind: "parcel", owner: "the-town", household: "solo:the-town",
    geometry: { at: { x: 0, y: 0 }, extent: { w: 25, h: 25 } }, parent: null, data: {} };
  const bench = { id: "t2", slug: "the-town/a-bench", kind: "sited", owner: "the-town", household: "solo:the-town",
    geometry: { at: { x: 2, y: 2 }, extent: { w: 1, h: 1 } }, parent: null, data: {} };
  const a = computeStanding([ground, bench]), b = computeStanding([ground, bench], { houseOf });
  assert.deepEqual([...b], [...a]);
});

// ── the standing-equality falsifier ─────────────────────────────────────────
// The fold reads her house from WORLD/households.json and says home; the store,
// once the recompute has run through the house, holds home. The falsifier must
// walk the store the way the recompute does, or it convicts the corrected row.
const oracle = {
  records: [{ id: PARCEL.slug, kind: "parcel" }, { id: SHRINE.slug, kind: "sited" }],
  derive: () => ({ tier: "home", household: "hh:house-of-harvey" }),
};
const recomputed = [PARCEL, { ...SHRINE, data: { tier: "home" } }];

test("POS-406 · the standing falsifier walks the store house for house: the recomputed shrine is no finding", () => {
  const { findings, compared } = standingFindings(recomputed, oracle, { houseOf });
  assert.equal(compared, 2);
  assert.deepEqual(findings, []);
  assert.deepEqual(idempotenceFindings(recomputed, { houseOf }), []);
});

test("POS-406 · the falsifier still convicts a store that is wrong about the house", () => {
  // a shrine stored under a stranger's spelling is not on her ground, whatever the fold says
  const stranger = [PARCEL, { ...SHRINE, household: "gh:1", data: { tier: "home" } }];
  const { findings } = standingFindings(stranger, oracle, { houseOf });
  assert.ok(findings.some((f) => /THE WALK disagrees with the fold at amia-semper\/shrine-of-the-pretzel/.test(f)), findings.join("\n"));
});

// ── the parcel-cap tripwire ─────────────────────────────────────────────────
test("POS-406 · the parcel-cap note counts a house's parcels across its spellings", () => {
  const parcel = (n, household) => ({ id: `p${n}`, slug: `amia-semper/parcel-${n}`, kind: "parcel", owner: "amia-semper", household,
    geometry: { at: { x: 4000 + 100 * n, y: 0 }, extent: { w: 25, h: 25 } }, parent: null, data: { date: "2026-09-20" } });
  const rows = [parcel(1, "gh:273009068"), parcel(2, "gh:273009068"), parcel(3, "hh:house-of-harvey"), parcel(4, "hh:house-of-harvey")];
  const notes = admissionNotes(rows, { houseOf });
  assert.ok(notes.some((n) => /household hh:house-of-harvey holds 4 standing parcels/.test(n)), notes.join("\n"));
});
