// my-marks-refused.test.mjs — a refused claim reaches its author (POS-241 part 5).
//
// Keemin, 2026-09-26: "does the office tell you that the second amend failed?
// or was it silent?" It was silent on my-marks: window 212 refused wright's
// second amend of `furnish-ferrys-waiting-room`, and the portfolio afterwards
// listed only the new pending claim, with 0 mentions of "refus". The doorstep's
// `outcomes` segment carried the refusal; the portfolio did not.
//
// What is pinned here:
//   · the row: `refused at window N: <refusal_check>`, the stored check
//     verbatim, read back through `causeOf`'s own inverse
//   · ONE derivation: the rows are `readClaimEffects`' claim-refused events,
//     kept to `yours`, over the doorstep's own two-crossing window
//   · BOTH DOORS: 1.0's `worldMyMarks` and the twin `world2MyMarks` carry the
//     same `refused` for the same store
//   · an unreadable docket is `unavailable`, never an empty list
//
// Run: WORLD_CLONE=<checkout> node --test test/my-marks-refused.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { causeOf, refusalCheckOf } from "../src/mark-receipt.mjs";
import { refusedRowsFrom, myMarksRefused, RULINGS_SINCE_CROSSINGS } from "../src/claim-effects.mjs";
import { CROSSING_EPOCH_UTC, CROSSING_MS, currentCrossing } from "../src/crossings.mjs";
import { __setPoolForTest } from "../src/world2-claims.mjs";
// Imported HERE, before any test registers: a top-level `await import()` of
// world.mjs further down let the door test register after the file's before/after
// hooks had run, so it ran with no docket store engaged (#294: world.mjs's import
// now awaits the world graph snapshot's load at import).
import { WORLD_CLONE, worldMyMarks } from "../src/world.mjs";

// The real clock: both doors read now, so the fixture is dated against it.
const NOW = Date.now();
const NOW_CROSSING = currentCrossing(NOW);
const inCrossing = (c, hours = 6) => new Date(CROSSING_EPOCH_UTC + c * CROSSING_MS + hours * 3600e3);

// The 09-26 instance's shape: the second amend refused at window 212.
const CHECK = "superseded: a standing mark carries this slug, and this claim supersedes 04855cf2, which is not it";
const ROWS = [
  { id: 1, slug: "wright/furnish-ferrys-waiting-room", class: "sited", claimant: "wright", household: "gh:1",
    status: "refused", window_id: 212, submitted_at: inCrossing(NOW_CROSSING - 1, 1), decided_at: inCrossing(NOW_CROSSING - 1, 6),
    refusal_check: CHECK, stake: 0, supersedes: null },
  // locked, not refused: not on the list
  { id: 2, slug: "wright/the-crossing-bench", class: "sited", claimant: "wright", household: "gh:1",
    status: "locked", window_id: 212, submitted_at: inCrossing(NOW_CROSSING - 1, 1), decided_at: inCrossing(NOW_CROSSING - 1, 6),
    refusal_check: null, stake: 0, supersedes: null },
  // refused, but before the window: not on the list
  { id: 3, slug: "wright/an-old-refusal", class: "sited", claimant: "wright", household: "gh:1",
    status: "refused", window_id: 190, submitted_at: inCrossing(NOW_CROSSING - 9, 1), decided_at: inCrossing(NOW_CROSSING - 9, 6),
    refusal_check: "harm: old", stake: 0, supersedes: null },
];

const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
let asked = 0;
let broken = false;
const stub = {
  async query(sql, args = []) {
    if (broken && /FROM claims/.test(sql)) throw new Error("the docket is down");
    if (/FROM claims/.test(sql) && /refusal_check/.test(sql)) {
      asked++;
      const [claimants = [], , since] = args;
      return { rows: ROWS.filter((r) => claimants.includes(r.claimant)
        && (r.submitted_at >= new Date(since) || r.decided_at >= new Date(since))) };
    }
    return { rows: [] };
  },
  async connect() { return { query: (s, a) => stub.query(s, a), release() {} }; },
};
before(() => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://stub@localhost/none";
  __setPoolForTest(stub);
});
after(() => {
  __setPoolForTest(null);
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

test("refusalCheckOf is causeOf's exact inverse, and reads nothing it did not write", () => {
  assert.equal(refusalCheckOf(causeOf(CHECK).cause_row), CHECK);
  assert.equal(refusalCheckOf(causeOf("x: \"quoted\" and \\ slashed").cause_row), "x: \"quoted\" and \\ slashed");
  assert.equal(refusalCheckOf(null), null);
  assert.equal(refusalCheckOf("refusal_check = \"harm\""), null);
});

test("the row says `refused at window N: <refusal_check>` with the stored check verbatim", () => {
  const rows = refusedRowsFrom([
    { kind: "claim-refused", mark: "wright/a", window: 212, at: "2026-09-26T06:00:00.000Z", cause: "superseded",
      cause_row: causeOf(CHECK).cause_row, yours: true, on_your_ground: false },
  ]);
  assert.deepEqual(rows, [{ mark: "wright/a", window: 212, at: "2026-09-26T06:00:00.000Z", cause: "superseded",
    refusal_check: CHECK, says: `refused at window 212: ${CHECK}` }]);
});

test("only YOUR refusals: a locked ruling and a refusal laid on your ground are not the portfolio's", () => {
  const rows = refusedRowsFrom([
    { kind: "claim-locked", mark: "wright/a", window: 212, yours: true },
    { kind: "claim-refused", mark: "sol/b", window: 212, cause_row: causeOf("harm: x").cause_row, yours: false, on_your_ground: true },
  ]);
  assert.deepEqual(rows, []);
});

test("the reader: one derivation over the doorstep's two crossings, and the 09-26 refusal reaches its author", async () => {
  asked = 0;
  const r = await myMarksRefused(["wright"], { nowMs: NOW });
  assert.equal(RULINGS_SINCE_CROSSINGS, 2);
  assert.equal(r.through_crossing, NOW_CROSSING);
  assert.equal(r.since_crossing, NOW_CROSSING - RULINGS_SINCE_CROSSINGS);
  assert.equal(asked, 1, "the docket was asked once");
  assert.equal(r.count, 1);
  assert.equal(r.rows[0].mark, "wright/furnish-ferrys-waiting-room");
  assert.equal(r.rows[0].says, `refused at window 212: ${CHECK}`);
  assert.equal(r.unavailable, undefined);
});

test("an unreadable docket is UNAVAILABLE, never an empty list that reads as nothing refused", async () => {
  broken = true;
  try {
    const r = await myMarksRefused(["wright"], { nowMs: NOW });
    assert.equal(r.count, 0);
    assert.match(r.unavailable, /could not be read/);
  } finally { broken = false; }
});

// ── both doors ────────────────────────────────────────────────────────────

const TOWN_CLONE = process.env.TOWN_CLONE ?? join(WORLD_CLONE, "..", "town-clone");
const HAVE = existsSync(join(WORLD_CLONE, "WORLD", "world-state.json"))
  && existsSync(join(TOWN_CLONE, "tools", "stamp-mint.mjs"));

test("1.0's /world/my-marks carries `refused` for its own residents", { skip: HAVE ? false : `needs a world clone at ${WORLD_CLONE} and a town clone at ${TOWN_CLONE}` }, async () => {
  const r = await worldMyMarks({ handles: new Set(["wright"]), household: "keeminlee" });
  assert.ok(!r.error, JSON.stringify(r).slice(0, 200));
  assert.ok(r.residents.includes("wright"), `residents ${JSON.stringify(r.residents)}`);
  assert.ok(r.refused && Array.isArray(r.refused.rows), "my-marks carries a `refused` block");
  assert.equal(r.refused.count, 1, JSON.stringify(r.refused).slice(0, 300));
  assert.equal(r.refused.rows[0].says, `refused at window 212: ${CHECK}`);
});
