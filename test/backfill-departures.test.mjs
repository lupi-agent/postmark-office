// backfill-departures.test.mjs — the four-day hole's filler, over a fixture
// movement store and a fixture pool of acts (POS-154).
//
// Every test asserts against the law it is derived from, named here so a reader
// can check the assertion rather than trust it:
//
//   world.mjs § walkEntry            the ONE row shape for a walk act,
//                                    "whichever pen records it" — `within` and
//                                    `to`, the movement store's own column
//                                    names, and no sixth spelling.
//   live-reads.mjs § era 5           `p.from && p.toward && !p.lines &&
//                                    !p._ledger` — the movement-store era, which
//                                    a `_backfill` key must not disturb.
//   live-reads.mjs § DEPARTURE_ORDER_SQL / governingDepartures
//                                    "the governing departure per handle" is the
//                                    LAST row in append order — so an appended
//                                    row outranks every act already filed.
//   001_tables.sql § acts            `id bigint GENERATED ALWAYS AS IDENTITY` —
//                                    there is no id to slot a backfill into.
//   017_source_underscore.sql        the underscore is the town's word for a key
//                                    the store owns.
//
// NO POSTGRES AND NO SNAPSHOT. Every case drives the tool's pure half against a
// sqlite store this file builds and an array of acts it writes out, so the suite
// runs in any pool tree on any machine. The run against the real 2026-09-21
// snapshot is the lane's own falsifier and its receipt is in the day doc.
//
//   node --test test/backfill-departures.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const {
  readMovementRows, departureRowFrom, departureRowsFrom, planFrom,
  matchOf, disagreementsOf, displacedActors, orderClauseCarriesInstant,
  WALK_ACTION, WALK_CLASS, WALK_EFFECT, PAIR_TOLERANCE_MS,
} = await import("../world2/tools/backfill-departures.mjs");
const live = await import("../world2/tools/live-reads.mjs");

// ── the fixture store ────────────────────────────────────────────────────────

const LO = "2026-08-27T09:57:00.374Z";   // the last seeded act's instant
const HI = "2026-08-31T03:35:20.069Z";   // the first mirrored act's instant

const MOVES = [
  // seq, actor, at, from, toward, crossing, within, to_mark, pace
  [770, "fabel", "2026-08-26T10:00:00.000Z", -10, -20, -30, -40, 152.1, null, null, null, 60],   // before the window
  [773, "fabel", LO, -1500, -2300, -1380, -2543, 152.82917256944444, null, null, "sol/the-heart-house", 60], // ON the lower bound
  [774, "domovoi", "2026-08-27T16:44:25.856Z", 100, 100, 200, 200, 153.39503958333333, null, null, null, 60],
  [800, "vellix", "2026-08-29T02:00:00.000Z", 5, 5, 15, 15, 156.1, 25, 25, "vellix/the-porch", 60],
  [900, "cipher", "2026-08-30T08:00:00.000Z", 0, 0, 40, 40, 158.4, null, null, null, null],
  [1212, "little-bird", "2026-08-31T03:35:19.161Z", 255, 95, -329, 260, 160.29905092592594, null, null, null, 60], // pairs with the first mirrored act
  [1300, "domovoi", "2026-09-02T09:00:00.000Z", 1, 1, 2, 2, 164.2, null, null, null, 60],        // after the window
];

function fixtureStore() {
  const dir = mkdtempSync(join(tmpdir(), "pos154b-"));
  const path = join(dir, "dynamic.db");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE movements (
    seq INTEGER PRIMARY KEY, actor TEXT, at TEXT, from_x REAL, from_y REAL,
    toward_x REAL, toward_y REAL, crossing REAL, within_w REAL, within_h REAL,
    to_mark TEXT, pace REAL, declared_by TEXT, note TEXT)`);
  const ins = db.prepare(`INSERT INTO movements
    (seq, actor, at, from_x, from_y, toward_x, toward_y, crossing, within_w, within_h, to_mark, pace, declared_by, note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const m of MOVES) ins.run(...m, m[1], null);
  db.close();
  return { dir, path };
}

/** Ascending compare with SQL's NULL-is-a-tie, for sorting a pool the way the clause does. */
const cmp = (a, b) => (a == null || b == null ? 0 : a < b ? -1 : a > b ? 1 : 0);

/** An act as the mirror files one — the shape `/world2/walks` selects. */
const act = (id, { at, actor, crossing, from, toward, pace = 60, within = null, to = null, extra = {} }) => ({
  id, at: new Date(at), crossing: String(crossing), actor, action: "walk",
  payload: { from, toward, pace, within, to, ...extra },
});

// ── the derivation ───────────────────────────────────────────────────────────

test("the window is OPEN at both ends — each bound instant is an event the store already filed", () => {
  const { dir, path } = fixtureStore();
  try {
    const open = readMovementRows(path, { from: LO, to: HI });
    assert.equal(open.length, 4, "seq 774, 800, 900, 1212 — not the row ON the lower bound, not the two outside");
    assert.ok(!open.some((r) => r.at === LO), "the row at the lower bound is the last seeded act, already in `acts`");
    assert.ok(!open.some((r) => r.at === HI), "nothing sits on the upper bound");
    assert.deepEqual(open.map((r) => r.seq), [774, 800, 900, 1212], "the store's own order: at, then seq");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a derived row is walkEntry's shape, field for field, beside a mirrored act", () => {
  const { dir, path } = fixtureStore();
  try {
    const rows = departureRowsFrom(readMovementRows(path, { from: LO, to: HI }));
    const r = rows.find((x) => x.seq === 800);
    // world.mjs § walkEntry: crossing, actor, action "walk", object, cls CLASS_MOVE,
    // payload {from, toward, pace, within, to}, effect.
    assert.equal(r.action, WALK_ACTION);
    assert.equal(r.class, WALK_CLASS);
    assert.equal(r.effect, WALK_EFFECT);
    assert.equal(r.actor, "vellix");
    assert.equal(r.object, "vellix/the-porch", "the target rides `object`, as walkEntry puts it");
    assert.equal(r.crossing, 156.1, "the crossing rides the ACT ROW, not the payload");
    assert.deepEqual(r.payload.from, { x: 5, y: 5 });
    assert.deepEqual(r.payload.toward, { x: 15, y: 15 });
    assert.deepEqual(r.payload.within, { w: 25, h: 25 }, "within_w/within_h → `within`, the store's column names");
    assert.equal(r.payload.to, "vellix/the-porch");
    assert.equal(r.payload.pace, 60);
    // The five read keys, in walkEntry's own order, before the store's own keys.
    assert.deepEqual(Object.keys(r.payload).slice(0, 5), ["from", "toward", "pace", "within", "to"]);
    // The three the movement row cannot carry — NULL, never invented.
    assert.equal(r.at_anchor, null);
    assert.equal(r.at_dx, null);
    assert.equal(r.at_dy, null);
    assert.equal(r.witnesses, null);
    assert.equal(r.household, null);
    assert.equal(r.journal_seq, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the two keys the SELECT always asked for (POS-198, 2026-09-22) ──────────
//
// `readMovementRows` has SELECTed `declared_by, note` since this tool was
// written and `departureRowFrom` dropped both on the floor. POS-196 found it by
// reading the record rather than the code: "SELECTs the column and drops it".
// The 28 lines in the world's record that carry either are the 2026-08-10
// `ledger-freeze` one-off — a backfill that could not hold them could not
// reproduce them.

/** A movements row, in `readMovementRows`' own column shape. */
const moveRow = (over = {}) => ({
  seq: 801, actor: "vellix", at: "2026-08-29T02:00:00.000Z",
  from_x: 5, from_y: 5, toward_x: 15, toward_y: 15, crossing: 156.1,
  within_w: null, within_h: null, to_mark: null, pace: 60,
  declared_by: "vellix", note: null, ...over,
});

test("a DELEGATED backfilled walk carries its declarer, and a self-declared one says its own name", () => {
  const delegated = departureRowFrom(moveRow({ declared_by: "the-town" }));
  assert.equal(delegated.payload.declared_by, "the-town",
    "the freeze's own 28 lines are exactly the rows this column exists for");
  assert.equal(delegated.actor, "vellix", "the actor is still whose feet moved");

  const own = departureRowFrom(moveRow());
  assert.equal(own.payload.declared_by, "vellix");

  // `readMovements` coalesces to the actor rather than writing a null, and a
  // backfilled act must spell a self-declared walk the same way a live one does
  // or the two eras disagree in a way that still parses.
  const bare = departureRowFrom(moveRow({ declared_by: null }));
  assert.equal(bare.payload.declared_by, "vellix", "a null declarer is the actor, never a null on the record");
});

test("a backfilled `note` is carried, and CONDITIONAL — no note writes no key", () => {
  const noted = departureRowFrom(moveRow({ note: "carried by the freeze" }));
  assert.equal(noted.payload.note, "carried by the freeze");

  const plain = departureRowFrom(moveRow());
  assert.equal("note" in plain.payload, false,
    "28 of the record's 2,870 lines carry a note; a null key on the rest would be this tool disagreeing with the grammar it fills");
});

test("the two new keys do not disturb the era-5 arm, and the `_backfill` keys still follow them", () => {
  const r = departureRowFrom(moveRow({ declared_by: "the-town", note: "n" }));
  const p = r.payload;
  // live-reads.mjs § era 5: `p.from && p.toward && !p.lines && !p._ledger`.
  assert.ok(p.from && p.toward && !p.lines && !p._ledger,
    "a backfilled row stopped matching the movement-store era and would be REFUSED BY NAME by every reader of it");
  assert.deepEqual(Object.keys(p),
    ["from", "toward", "pace", "within", "to", "declared_by", "note", "_backfill", "_backfill_seq", "_backfill_source"],
    "walkEntry's five, then the record's two, then the store's own underscored three");
});

test("a null within is null, not the Origin — and a paceless walk keeps its null", () => {
  const { dir, path } = fixtureStore();
  try {
    const r = departureRowsFrom(readMovementRows(path, { from: LO, to: HI })).find((x) => x.seq === 900);
    assert.equal(r.payload.within, null);
    assert.equal(r.payload.to, null);
    assert.equal(r.object, null);
    assert.equal(r.payload.pace, null, "a null pace is the visible sign the dial was unreadable; 0 would be a claim");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a movement with no crossing is refused by name, never filed as crossing zero", () => {
  assert.throws(
    () => departureRowFrom({ seq: 5, actor: "x", at: LO, crossing: null, from_x: 0, from_y: 0, toward_x: 1, toward_y: 1 }),
    /seq 5 carries no crossing/,
    "live-reads era 5: a null crossing would read as the founding instant and govern from the beginning of the world");
});

test("the backfilled row still reads as the movement-store era, and its record is the movement's own", () => {
  const { dir, path } = fixtureStore();
  try {
    const r = departureRowsFrom(readMovementRows(path, { from: LO, to: HI })).find((x) => x.seq === 800);
    const read = live.departureRecordOf({ id: 99, at: new Date(r.at), crossing: String(r.crossing), actor: r.actor, action: r.action, payload: r.payload });
    assert.ok(!read.refused, `the reader must not refuse it: ${read.reason ?? ""}`);
    assert.equal(read.era, "movement-store", "the two _backfill keys must not flip the era detection");
    assert.equal(read.record.handle, "vellix");
    assert.equal(read.record.at, 156.1);
    assert.deepEqual(read.record.targetExtent, { w: 25, h: 25 });
    assert.equal(read.record.targetMarkId, "vellix/the-porch");
    assert.equal(read.record.iso, r.at, "the act row's instant is what the door reports as the departure's");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the plan ─────────────────────────────────────────────────────────────────

test("over an empty pool the plan is the whole window, all new", () => {
  const { dir, path } = fixtureStore();
  try {
    const plan = planFrom(departureRowsFrom(readMovementRows(path, { from: LO, to: HI })), []);
    assert.equal(plan.length, 4);
    assert.equal(plan.filter((r) => r.state === "new").length, 4);
    assert.equal(plan.filter((r) => r.state !== "new").length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a second run over a pool that holds them plans ZERO — the seq is the key", () => {
  const { dir, path } = fixtureStore();
  try {
    const derived = departureRowsFrom(readMovementRows(path, { from: LO, to: HI }));
    const pool = derived.map((r, i) => act(500 + i, {
      at: r.at, actor: r.actor, crossing: r.crossing,
      from: r.payload.from, toward: r.payload.toward, pace: r.payload.pace,
      within: r.payload.within, to: r.payload.to,
      extra: { _backfill: r.payload._backfill, _backfill_seq: r.payload._backfill_seq },
    }));
    const plan = planFrom(derived, pool);
    assert.equal(plan.filter((r) => r.state === "new").length, 0, "a re-run writes nothing");
    assert.equal(plan.filter((r) => r.state === "present").length, 4);
    assert.ok(plan.every((r) => r.matched_by === "seq"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the row the MIRROR already wrote is caught by the instant pair, not by a seq it never carried", () => {
  const { dir, path } = fixtureStore();
  try {
    const derived = departureRowsFrom(readMovementRows(path, { from: LO, to: HI }));
    const lb = derived.find((r) => r.seq === 1212);
    // act 2941 as prod holds it: same walk, stamped 908 ms later by the mirror, no _backfill key.
    const pool = [act(2941, { at: HI, actor: "little-bird", crossing: 160.29905092592594, from: { x: 255, y: 95 }, toward: { x: -329, y: 260 }, pace: 60 })];
    const m = matchOf(lb, pool);
    assert.ok(m, "without the pair match the open window would file a duplicate of the first mirrored act");
    assert.equal(m.by, "pair");
    assert.ok(Math.abs(Date.parse(HI) - Date.parse(lb.at)) < PAIR_TOLERANCE_MS);
    const plan = planFrom(derived, pool);
    assert.equal(plan.filter((r) => r.state === "new").length, 3, "438-shaped: the window less the row the mirror already filed");
    assert.equal(plan.find((r) => r.seq === 1212).state, "present");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("one act stands for ONE walk — two movements INSIDE the tolerance do not both claim it", () => {
  // `stella-letta`'s real cadence, seq 656 → 657: 462 ms apart, well inside the
  // 2,000 ms pair window. 341 same-actor pairs in the store are this close, so
  // the tolerance alone cannot separate them and the one-to-one consumption is
  // the only thing that can. A gap WIDER than the tolerance would be separated
  // by the tolerance and would test nothing here.
  const derived = [
    departureRowFrom({ seq: 656, actor: "stella-letta", at: "2026-08-25T11:00:59.721Z", from_x: 0, from_y: 0, toward_x: 1, toward_y: 1, crossing: 148.5, pace: 60 }),
    departureRowFrom({ seq: 657, actor: "stella-letta", at: "2026-08-25T11:01:00.183Z", from_x: 1, from_y: 1, toward_x: 2, toward_y: 2, crossing: 148.5, pace: 60 }),
  ];
  assert.ok(Date.parse(derived[1].at) - Date.parse(derived[0].at) < PAIR_TOLERANCE_MS,
    "the two walks must be closer together than the tolerance, or this case is not the case");
  // The store holds only the FIRST of the two, stamped 779 ms after it — which
  // is 317 ms after the SECOND, so both walks reach it and only the consumption
  // can decide. An act stamped between them would be separated by the one-sided
  // window instead, and would test that guard rather than this one.
  const pool = [act(4001, { at: "2026-08-25T11:01:00.500Z", actor: "stella-letta", crossing: 148.5, from: { x: 0, y: 0 }, toward: { x: 1, y: 1 } })];
  assert.equal(matchOf(derived[1], pool)?.by, "pair",
    "without the consumption the second walk reaches the first walk's act — which is the defect");
  const plan = planFrom(derived, pool);
  assert.equal(plan[0].state, "present", "the walk the act was written for");
  assert.equal(plan[0].have_id, 4001);
  assert.equal(plan[1].state, "new", "the second walk is MISSING and must be planned, not swallowed by its neighbour's act");
  assert.equal(plan[1].have_id, undefined);
});

test("when one act is contended by two walks the plan REFUSES rather than writing past it", () => {
  // The same contention with the act belonging to the SECOND walk: the first
  // claims it in store order, disagrees with it, and the whole apply refuses.
  // A wrong guess here is a CONFLICT a person reads, never a duplicate filed in
  // silence — which is the direction a backfill must fail in.
  const derived = [
    departureRowFrom({ seq: 656, actor: "stella-letta", at: "2026-08-25T11:00:59.721Z", from_x: 0, from_y: 0, toward_x: 1, toward_y: 1, crossing: 148.5, pace: 60 }),
    departureRowFrom({ seq: 657, actor: "stella-letta", at: "2026-08-25T11:01:00.183Z", from_x: 1, from_y: 1, toward_x: 2, toward_y: 2, crossing: 148.5, pace: 60 }),
  ];
  const pool = [act(4002, { at: "2026-08-25T11:01:00.500Z", actor: "stella-letta", crossing: 148.5, from: { x: 1, y: 1 }, toward: { x: 2, y: 2 } })];
  const plan = planFrom(derived, pool);
  assert.equal(plan[0].state, "CONFLICT");
  assert.deepEqual(plan[0].drift, ["from", "toward"]);
  assert.equal(plan[1].state, "new");
});

test("the pair window is one-sided — an act stamped BEFORE a movement is a different walk", () => {
  const d = departureRowFrom({ seq: 20, actor: "nyx", at: "2026-08-29T02:00:02.000Z", from_x: 0, from_y: 0, toward_x: 1, toward_y: 1, crossing: 156.1, pace: 60 });
  const earlier = [act(4100, { at: "2026-08-29T02:00:01.000Z", actor: "nyx", crossing: 156.1, from: { x: 0, y: 0 }, toward: { x: 1, y: 1 } })];
  assert.equal(matchOf(d, earlier), null, "the mirror writes after the declaration; it cannot have stamped this one a second early");
  const later = [act(4101, { at: "2026-08-29T02:00:02.908Z", actor: "nyx", crossing: 156.1, from: { x: 0, y: 0 }, toward: { x: 1, y: 1 } })];
  assert.equal(matchOf(d, later).by, "pair");
  assert.equal(matchOf(d, later).lag_ms, 908, "the measured mirror lag, and the reason the tolerance is 2 s and not 5");
  const tooLate = [act(4102, { at: "2026-08-29T02:00:04.500Z", actor: "nyx", crossing: 156.1, from: { x: 0, y: 0 }, toward: { x: 1, y: 1 } })];
  assert.equal(matchOf(d, tooLate), null);
});

test("a planted disagreeing row is refused BY SEQ, and the disagreement is named", () => {
  const { dir, path } = fixtureStore();
  try {
    const derived = departureRowsFrom(readMovementRows(path, { from: LO, to: HI }));
    const r = derived.find((x) => x.seq === 800);
    const pool = [act(777, {
      at: r.at, actor: r.actor, crossing: r.crossing,
      from: r.payload.from, toward: { x: 999, y: 999 }, pace: r.payload.pace,
      within: r.payload.within, to: r.payload.to,
      extra: { _backfill: r.payload._backfill, _backfill_seq: 800 },
    })];
    const plan = planFrom(derived, pool);
    const bad = plan.find((x) => x.seq === 800);
    assert.equal(bad.state, "CONFLICT");
    assert.equal(bad.have_id, 777);
    assert.deepEqual(bad.drift, ["toward"]);
    assert.deepEqual(disagreementsOf(r, pool[0]), ["toward"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("disagreement is read on the fields a DEPARTURE READER reads, and on no others", () => {
  const { dir, path } = fixtureStore();
  try {
    const r = departureRowsFrom(readMovementRows(path, { from: LO, to: HI })).find((x) => x.seq === 800);
    const same = act(1, { at: r.at, actor: r.actor, crossing: r.crossing, from: r.payload.from, toward: r.payload.toward, pace: r.payload.pace, within: r.payload.within, to: r.payload.to });
    assert.deepEqual(disagreementsOf(r, same), [], "a mirrored row carrying witnesses and a household is not in disagreement with a backfilled one");
    assert.deepEqual(disagreementsOf(r, { ...same, crossing: "156.2" }), ["crossing"]);
    assert.deepEqual(disagreementsOf(r, { ...same, payload: { ...same.payload, within: null } }), ["within"]);
    assert.deepEqual(disagreementsOf(r, { ...same, payload: { ...same.payload, pace: 30 } }), ["pace"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the ordering gate ────────────────────────────────────────────────────────

test("an appended row outranks a later act, and displacedActors counts exactly who", () => {
  const { dir, path } = fixtureStore();
  try {
    const derived = departureRowsFrom(readMovementRows(path, { from: LO, to: HI }));
    const plan = planFrom(derived, []);
    const later = [
      act(3000, { at: "2026-09-02T09:00:00.000Z", actor: "domovoi", crossing: 164.2, from: { x: 1, y: 1 }, toward: { x: 2, y: 2 } }),
      act(3001, { at: "2026-09-19T09:00:00.000Z", actor: "little-bird", crossing: 190.1, from: { x: 3, y: 3 }, toward: { x: 4, y: 4 } }),
    ];
    const d = displacedActors(plan, later);
    assert.deepEqual(d.map((x) => x.actor), ["domovoi", "little-bird"], "vellix and cipher have nothing later — they are the residents the backfill is FOR");
    assert.equal(d.find((x) => x.actor === "little-bird").latest, "2026-09-19T09:00:00.000Z");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("THE RULING — a backfilled row files where it HAPPENED, and the later walk still governs", () => {
  const { dir, path } = fixtureStore();
  try {
    const derived = departureRowsFrom(readMovementRows(path, { from: LO, to: HI }));
    const fresh = planFrom(derived, []).filter((r) => r.state === "new");
    const later = [
      act(3000, { at: "2026-09-02T09:00:00.000Z", actor: "domovoi", crossing: 164.2, from: { x: 1, y: 1 }, toward: { x: 2, y: 2 } }),
      act(3001, { at: "2026-09-19T09:00:00.000Z", actor: "little-bird", crossing: 190.1, from: { x: 3, y: 3 }, toward: { x: 4, y: 4 } }),
    ];
    // Appended: ids 9000+, above every act already filed — which is the only
    // thing `GENERATED ALWAYS AS IDENTITY` will give a backfill.
    const appended = fresh.map((r, i) => act(9000 + i, {
      at: r.at, actor: r.actor, crossing: r.crossing, from: r.payload.from, toward: r.payload.toward,
      pace: r.payload.pace, within: r.payload.within, to: r.payload.to,
      extra: { _backfill: r.payload._backfill, _backfill_seq: r.payload._backfill_seq },
    }));
    // The store returns them in the CLAUSE's order, which is what the door gets.
    const ordered = [...later, ...appended].sort((a, b) =>
      live.DEPARTURE_ORDER_KEYS.reduce((acc, k) => acc || cmp(k.of(a), k.of(b)), 0));
    const gov = live.governingDepartures(live.departureRecords(ordered).records);
    assert.equal(gov.get("domovoi").iso, "2026-09-02T09:00:00.000Z",
      "the September walk governs: the 08-27 row files at its own instant, not last");
    assert.equal(gov.get("little-bird").iso, "2026-09-19T09:00:00.000Z");
    // And the residents the fill is FOR gain their leg.
    assert.equal(gov.get("cipher").iso, "2026-08-30T08:00:00.000Z");
    assert.equal(gov.get("vellix").iso, "2026-08-29T02:00:00.000Z");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the guard is driven by the same keys as the clause — it cannot bless an order the query never asked for", () => {
  assert.deepEqual(live.DEPARTURE_ORDER_KEYS.map((k) => k.name), ["era", "instant", "id"]);
  assert.equal(live.DEPARTURE_ORDER_SQL, `ORDER BY ${live.DEPARTURE_ORDER_KEYS.map((k) => k.sql).join(", ")}`,
    "the clause is BUILT from the keys — a second copy is how a guard comes to bless the wrong order");
  const a = act(10, { at: "2026-08-29T02:00:00.000Z", actor: "w", crossing: 156.1, from: { x: 0, y: 0 }, toward: { x: 1, y: 1 } });
  const b = act(11, { at: "2026-08-28T02:00:00.000Z", actor: "w", crossing: 155.1, from: { x: 0, y: 0 }, toward: { x: 1, y: 1 } });
  // id-ascending but instant-DESCENDING: the old guard passed this, and it is
  // exactly the shape an appended backfill takes.
  assert.throws(() => live.departureRecords([a, b]), /not instant-ascending within the non-ledger era/);
  assert.doesNotThrow(() => live.departureRecords([b, a]));
});

test("the ledger era keeps its file order — the 08-08 sailing is not re-sorted by instant", () => {
  const ledger = (id, iso, at) => ({
    id, at: new Date(iso), crossing: null, actor: "w", action: "legacy:departure",
    payload: { _ledger: "WORLD/walk-ledger.md", iso, handle: "w", from: { x: 0, y: 0 }, toward: { x: id, y: 0 }, at,
      line: `- ${iso} · w · from 0,0 · toward ${id},0 · at ${at}` },
  });
  // The sailing: the 18:00 line was APPENDED after the 18:16 walk.
  const rows = [ledger(1, "2026-08-08T18:16:00.000Z", 120), ledger(2, "2026-08-08T18:00:00.000Z", 121)];
  assert.doesNotThrow(() => live.departureRecords(rows), "the instant key must not reach this era");
  const gov = live.governingDepartures(live.departureRecords(rows).records);
  assert.equal(gov.get("w").toward.x, 2, "the later-APPENDED ledger line still governs");
});

test("the passage read does NOT inherit the departure ruling", () => {
  assert.deepEqual(live.PASSAGE_ORDER_KEYS.map((k) => k.name), ["era", "id"]);
  assert.equal(live.PASSAGE_ORDER_SQL, "ORDER BY ((payload->>'_ledger') IS NULL), acts.id",
    "byte-for-byte the clause the passage read has always carried — passages were not measured and were not ruled");
  assert.notEqual(live.PASSAGE_ORDER_SQL, live.DEPARTURE_ORDER_SQL);
});

test("the gate reads the clause the doors use, not a flag — and the shipped clause OPENS it", () => {
  // The clause as ruled 2026-09-21. The gate passes on it, which is what lets
  // the apply run at all.
  assert.equal(live.DEPARTURE_ORDER_SQL,
    "ORDER BY ((payload->>'_ledger') IS NULL), (CASE WHEN payload->>'_ledger' IS NULL THEN acts.at END), acts.id");
  assert.equal(orderClauseCarriesInstant(live.DEPARTURE_ORDER_SQL), true,
    "the shipped clause places a backfilled row by its instant, so the apply may run");
  // The negative control: the clause as it stood before the ruling. The gate is
  // the standing falsifier against a revert — put this back and the apply refuses.
  assert.equal(orderClauseCarriesInstant("ORDER BY ((payload->>'_ledger') IS NULL), acts.id"), false);
  assert.equal(orderClauseCarriesInstant("ORDER BY at, acts.id"), true);
  // And it is not fooled by the word inside a quoted literal.
  assert.equal(orderClauseCarriesInstant("ORDER BY ((payload->>'at_anchor') IS NULL), acts.id"), false);
});
