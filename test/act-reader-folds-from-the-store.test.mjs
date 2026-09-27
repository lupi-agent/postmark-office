// act-reader-folds-from-the-store.test.mjs — POS-152.
//
//   node --test test/act-reader-folds-from-the-store.test.mjs
//
// `world-apex.mjs § actsOfActor` is the ONE input of `rideStateFrom`, and it
// used to open the sqlite journal. The journal is truncated at the drain, so an
// `enter` older than the drain cursor was simply not there — and a rider whose
// entry had been drained away was set down NOWHERE on exit, because the deposit
// rule (rightly) refuses to move somebody who cannot prove where they came from.
//
// `acts` is never truncated. These tests are about that difference, and each one
// is built so it can express the failure rather than merely fail to regress:
//
//   F1  the pure fold, both populations — the STORE's rows (entry present) set
//       the rider down at the stop they came in through; the JOURNAL's rows for
//       the same rider, post-drain, set them down nowhere. F1 is what makes the
//       defect a sentence. It passes on main too, and says so: it is the
//       statement of the problem, not the proof of the fix.
//   F2  `crossingDeps().acts` asks the STORE — one query, the acts table, the
//       ruled replay order, and the three columns the fold consumes. REDS ON
//       MAIN, where the function opens sqlite and never reaches a pool at all.
//   F3  a drained rider, end to end through the deps the office hands the
//       crossing: the entry is in the store and NOT in sqlite, and the fold
//       still names the stop. REDS ON MAIN.
//   F4  the store's own shapes, which main never had to survive: `payload` is
//       `jsonb`, so the driver hands back a PARSED OBJECT. Main's reader calls
//       `JSON.parse` on its column; handed an object it answers `{}` for every
//       row and every ride vanishes. REDS ON MAIN.
//   F5  the fail-safe, kept exactly: a store that cannot be opened answers with
//       no history, and the deposit rule then declines to move the rider.
//       NON-REGRESSION, not discriminating — the sqlite reader satisfied this
//       too, which is the point: the promise survives the change of source.
//   F6  ORDER BY `journal_seq` would be the tempting spelling and it is wrong —
//       under the pen flip that column is NULL for the whole flipped era.
//       Measured on prod 2026-09-21: 486 of 606 `frame` rows carry none.
//   F7  the sqlite read is GONE, not layered under a fallback (the brief's "one
//       question, one owner"). A source pin, and labelled as the weaker kind:
//       F2/F3 are what prove the chain.
//
// ⚑ THE CONTROL EVERY IDENTITY CLAIM HERE CARRIES: an assertion that two
// derived lists match says the same sentence when both are empty. Where this
// file compares populations it asserts non-emptiness in the same breath.
//
// ⚑ WHICH OF THESE DISCRIMINATE, measured rather than asserted. Restoring the
// sqlite read (the flip, docs/2026-09-20/everything-reads-the-store/pos-152/
// flip.sh) reds EIGHT of the eleven: F2, F3, F4, F4b, F4c, F6, F6b, F7. The
// three that stay green — F1, F5, F5b — are the statement of the problem and
// the fail-safe that survives the change, and they are non-regression by
// construction. Said here so nobody reads eleven green as eleven guards.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { depositAt, rideStateFrom } from "../src/world-ride.mjs";
import { crossingDeps } from "../src/world-apex.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";

const SHIP = "the-town/the-post-office";
const WHARF = "sol-of-garrison/grove-wharf";
const SNUG = "current-the-reader/the-snug-mooring";
const SOURCE = readFileSync(new URL("../src/world-apex.mjs", import.meta.url), "utf8");

/** The acts one rider wrote across a ride, in the order the record holds them. */
const RIDER_ACTS = [
  { action: "enter", object: SHIP, payload: { via: WHARF } },
  { action: "ride", object: SHIP, payload: { to: SNUG, origin: WHARF, arrives_at: "2026-09-20T21:40:17.346Z" } },
];

/** A store row as Postgres hands it over — `payload` is `jsonb`, so an OBJECT. */
const storeRow = (a) => ({ action: a.action, object: a.object, payload: a.payload });

/** Stand a stub pool up for one case, and always take it down again. */
async function withStore(rowsFor, fn) {
  const seen = [];
  const had = { flag: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://stub/none";
  __setPoolForTest({ async query(text, params) { seen.push({ text, params }); return { rows: rowsFor(text, params) }; } });
  try { return await fn(seen); } finally {
    __setPoolForTest(null);
    if (had.flag === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = had.flag;
    if (had.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = had.url;
  }
}

// ── F1 · THE DEFECT, AS A SENTENCE ──────────────────────────────────────────

test("F1 · the two populations are not the same answer: the store sets the rider down, the drained journal sets them nowhere", () => {
  // The store's rows: the whole ride, because `acts` is never truncated.
  const fromStore = rideStateFrom(RIDER_ACTS, { vesselId: SHIP });
  // The journal's rows AFTER a drain that swallowed the entry: the ride survived
  // (it was written later), the `enter` did not.
  const drained = RIDER_ACTS.slice(1);
  const fromDrainedJournal = rideStateFrom(drained, { vesselId: SHIP });

  // The control is over the two INPUT populations, not over the fold's answer —
  // a fold returns an object, and `.length` on one is `undefined`, which is a
  // control that cannot fail dressed as one that can. (This assertion is here
  // because the first version of it was exactly that, and the run said so.)
  assert.ok(RIDER_ACTS.length > 0 && drained.length > 0 && RIDER_ACTS.length > drained.length,
    "control: both populations are non-empty and the drained one is genuinely smaller");
  assert.equal(fromStore.entryStop, WHARF);
  assert.equal(fromDrainedJournal.entryStop, null, "the drained journal cannot name the door they came in by");

  const t = Date.parse("2026-09-20T21:40:17.346Z") - 1; // before the ride comes due
  assert.deepEqual(depositAt({ ...fromStore, nowMs: t }), { stop: WHARF, arrived: false },
    "the store's rows set them back down at the stop they came in through");
  assert.deepEqual(depositAt({ ...fromDrainedJournal, nowMs: t }), { stop: null, arrived: false },
    "the drained journal's rows set them down NOWHERE — safe, and a passage written and not read back");
});

// ── F2 · THE READ ASKS THE STORE ────────────────────────────────────────────

test("F2 · crossingDeps().acts asks the acts table, in the ruled replay order, for the columns the fold consumes", async () => {
  await withStore(() => RIDER_ACTS.map(storeRow), async (seen) => {
    const acts = await crossingDeps().acts("rider");

    assert.equal(seen.length, 1, "one query, not one per row and not a second pool");
    assert.match(seen[0].text, /FROM acts\b/, "the store's acts table — the record, not the window onto it");
    assert.match(seen[0].text, /WHERE actor = \$1/, "filtered in the database, not in node");
    assert.deepEqual(seen[0].params, ["rider"]);

    // EVERY COLUMN THE FOLD CONSUMES IS SELECTED. Spying the query's shape says
    // nothing about what the rows CONTAIN — dropping `payload` from the SELECT
    // would leave a shape assertion green while every ride answered null.
    for (const col of ["action", "object", "payload"]) {
      assert.match(seen[0].text, new RegExp(`\\b${col}\\b`), `the fold reads ${col}, so the query must select it`);
    }

    assert.ok(acts.length > 0, "control: the stub actually answered");
    assert.equal(rideStateFrom(acts, { vesselId: SHIP }).entryStop, WHARF);
  });
});

// ── F3 · THE DRAINED RIDER, THROUGH THE OFFICE'S OWN DEPS ───────────────────

test("F3 · a rider whose enter is in the store and NOT in sqlite is still set down at the right stop", async () => {
  // This is the brief's falsifier. The store holds the whole ride; the sqlite
  // journal is not consulted at all, which is what makes the drain irrelevant.
  await withStore(() => RIDER_ACTS.map(storeRow), async () => {
    const acts = await crossingDeps().acts("drained-rider");
    const state = rideStateFrom(acts, { vesselId: SHIP });
    const t = Date.parse("2026-09-20T21:40:17.346Z");
    assert.equal(state.entryStop, WHARF, "the entry the drain would have eaten");
    assert.deepEqual(depositAt({ ...state, nowMs: t }), { stop: SNUG, arrived: true },
      "and the ride having come due, the exit sets them down at its destination");
  });
});

// ── F4 · THE STORE'S OWN SHAPE ──────────────────────────────────────────────

test("F4 · `payload` arrives PARSED, because the column is jsonb — a JSON.parse on it would empty every ride", async () => {
  await withStore(() => RIDER_ACTS.map(storeRow), async () => {
    const acts = await crossingDeps().acts("rider");
    assert.equal(typeof acts[0].payload, "object", "the driver hands back an object, not a string");
    assert.equal(acts[0].payload.via, WHARF, "and the field the fold reads survived the crossing into this function");
    assert.equal(acts[1].payload.to, SNUG);
  });
});

test("F4b · a text `payload` column still folds — a store migrated the other way must not answer {} for every ride", async () => {
  await withStore(() => RIDER_ACTS.map((a) => ({ ...storeRow(a), payload: JSON.stringify(a.payload) })), async () => {
    const acts = await crossingDeps().acts("rider");
    assert.equal(acts[0].payload.via, WHARF);
    assert.equal(rideStateFrom(acts, { vesselId: SHIP }).entryStop, WHARF);
  });
});

test("F4c · a null payload folds to {} and never to null — `rideStateFrom` reads fields off it", async () => {
  await withStore(() => [{ action: "enter", object: SHIP, payload: null }], async () => {
    const acts = await crossingDeps().acts("rider");
    assert.deepEqual(acts[0].payload, {});
    assert.equal(rideStateFrom(acts, { vesselId: SHIP }).entryStop, null, "no `via` is no entry stop, not a crash");
  });
});

// ── F5 · THE FAIL-SAFE, KEPT EXACTLY ────────────────────────────────────────

test("F5 · a store that is not configured answers with NO HISTORY, and the deposit rule declines to move the rider", async () => {
  const had = { flag: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  delete process.env.WORLD2_PG;
  delete process.env.WORLD2_PG_URL;
  let reached = false;
  __setPoolForTest({ async query() { reached = true; return { rows: [] }; } });
  try {
    const acts = await crossingDeps().acts("rider");
    assert.deepEqual(acts, [], "no history");
    assert.equal(reached, false, "and the pool was never reached — a read port must not talk to a store it was not configured to have");
    assert.deepEqual(depositAt({ ...rideStateFrom(acts, { vesselId: SHIP }), nowMs: Date.now() }),
      { stop: null, arrived: false }, "so the rider is left exactly where they are");
  } finally {
    __setPoolForTest(null);
    if (had.flag === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = had.flag;
    if (had.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = had.url;
  }
});

test("F5b · a store that THROWS answers with no history too — never a crash at the door", async () => {
  await withStore(() => { throw new Error("ECONNREFUSED"); }, async () => {
    assert.deepEqual(await crossingDeps().acts("rider"), []);
  });
});

// ── F6 · THE ORDERING COLUMN ────────────────────────────────────────────────

test("F6 · the order is the ruled replay order and NOT journal_seq, which is null for the whole flipped era", async () => {
  await withStore(() => RIDER_ACTS.map(storeRow), async (seen) => {
    // THE CALL COMES FIRST. Reading the spy without making it is how this test
    // failed on its own first run: an empty `seen` is not a query with the wrong
    // order, it is no measurement at all.
    await crossingDeps().acts("rider");
    assert.equal(seen.length, 1, "control: a query was actually issued");
    const text = seen[0].text;
    assert.match(text, /ORDER BY\s+at,\s*id\b/,
      "D6 ruled replay order is (at, id); `id` alone carries no meaning a reader may lean on, because two lanes' queues interleave it");
    assert.doesNotMatch(text, /ORDER BY[^;]*journal_seq/,
      "under W2_PEN the act is written to Postgres FIRST and the sqlite row after, so there is no seq to carry — "
      + "486 of prod's 606 `frame` rows hold NULL there (measured 2026-09-21), and ordering by it heaps the flipped era");
  });
});

test("F6b · the fold's answer follows the order the STORE returns, not the order a caller hoped for", async () => {
  // The exit clears the entry stop; a reader that sorted these two the other way
  // would answer "still aboard, entered at the wharf" for somebody who has left.
  const ordered = [...RIDER_ACTS, { action: "exit", object: SHIP, payload: {} }];
  await withStore(() => ordered.map(storeRow), async () => {
    const acts = await crossingDeps().acts("rider");
    assert.equal(acts.length, 3, "control: all three rows came back");
    assert.deepEqual(rideStateFrom(acts, { vesselId: SHIP }), { entryStop: null, standingRide: null });
  });
});

// ── F7 · THE SQLITE READ IS GONE, NOT LAYERED UNDERNEATH ────────────────────

test("F7 · actsOfActor holds no sqlite read and no fallback under the store — one question, one owner", () => {
  // A SOURCE pin, and weaker than F2/F3 by construction: it reads the file's
  // text rather than the behaviour. F2 and F3 are what prove the chain; this
  // exists because a fallback re-added underneath them would leave both green.
  const start = SOURCE.indexOf("async function actsOfActor");
  assert.ok(start > 0, "control: the function is still named this");
  const body = SOURCE.slice(start, SOURCE.indexOf("\n}", start));
  assert.doesNotMatch(body, /openDynamicRead|FROM journal|sqlite_master/,
    "the sqlite read is deleted, not kept as a fallback under the store");
  assert.match(body, /actsQuery/, "and the one reader it has is the store's");
});
