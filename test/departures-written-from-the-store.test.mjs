// departures-written-from-the-store.test.mjs — POS-196, G1 gate 3 of 3: the
// world repo's departure record, rendered from `acts` instead of from the
// reverse-mirror copy in `dynamic.db/movements`.
//
// ── WHAT IS ON TRIAL ────────────────────────────────────────────────────────
//
// `STATE/log/<N>.jsonl` is the world repo's departure record and the only live
// source its three readers have. `tools/crossing-save.mjs` writes it today from
// `dynamic.db/movements` — measured read-only in the world clone at
// `origin/main` @ `17fa4195`: 2,857 of its 2,870 departure lines carry
// `"source":"dynamic.db/movements"`, the other 13 are era one. G1 removes that
// mirror, so the record needs a store-backed writer or it stops.
//
// `src/world-movement.mjs § storedDepartureEvents` is that renderer, built on
// POS-154's one road (`storedDepartures` → `world2-guards § storeDepartureRows`
// → `live-reads § departureRecords`). This file is its falsifier.
//
// ── THE SUBJECT IS THE REAL RECORD, NOT A RECORD I WROTE ────────────────────
//
// `test/fixtures/pos196-window-204-departures.jsonl` is the 24 departure lines
// of world crossing 204, copied byte for byte out of the clone at `origin/main`
// with nothing edited. The acts behind them are built FROM those same lines, in
// `world.mjs § walkEntry`'s exact payload shape — five keys, `{from, toward,
// pace, within, to}` — because a fixture generous enough to carry fields the
// live pen does not write would prove the renderer equal to a store nobody
// runs. Every field the register genuinely lacks is lacking here too.
//
// ── AND THE VERDICT IS SCOPED TO WHAT IS READ ───────────────────────────────
//
// Finding 4, measured read-only in the world clone: `tools/movement-records.mjs
// § storeRecords` keeps `ev.type === "departure"` and takes `at`, `actor` and
// `payload.{from,toward,crossing,within,to,pace}`. `boarding-flip-disclosure.mjs`
// and `position-seed-manifest.mjs` inherit that through `storeRecords` rather
// than opening the directory themselves. Nothing in that repo reads `seq`,
// `declared_by`, `note` or `source`. So byte-equality is judged on
// `RECORD_READ_FIELDS` — a record is equal when no reader of it can tell.
//
// ── THE STOP ────────────────────────────────────────────────────────────────
//
// `at` has no source in the register, and `at` is the first field every world
// reader reads. The two tests under § THE STOP name the cause rather than
// simulating the symptom, and either half fails on its own.

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  DEPARTURE_GAPS, RECORD_READ_FIELDS, departureEventOf, storedDepartureEvents,
} from "../src/world-movement.mjs";
import {
  checkDepartureWindow, compareDepartureLine, gapClassOf, pairDepartures, storeEraLines,
} from "../tools/crossing-save.mjs";
import { normalizeRow } from "../src/world-journal.mjs";
import { useGuardReader } from "../src/world2-guards.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// POS-198 drives the live act builder here rather than describing it (see
// § THE POST-CHANGE FIXTURE). `src/world.mjs` reads WORLD_CLONE at module load;
// the door is never called, so any readable path will do when one is unset.
process.env.WORLD_CLONE ??= HERE;
const { walkEntry } = await import("../src/world.mjs");
const FIXTURE = join(HERE, "fixtures", "pos196-window-204-departures.jsonl");

/** The record as the world holds it: 24 lines of crossing 204, untouched. */
const RECORD = readFileSync(FIXTURE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

// The renderer asks `world2Enabled()` before it asks the road anything, so an
// office with no register spends no socket finding that out. These two are the
// price of reaching the renderer at all, and § NOT POINTED AT A REGISTER is the
// case that proves the refusal.
const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => { process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = "postgres://pos196/none"; });
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

/**
 * One record line → the `acts` row its own walk would have written.
 *
 * ⚑ `payload` IS `walkEntry`'s FIVE KEYS AND NOT ONE MORE. `declared_by`,
 * `note` and the movements rowid are not in it because they are not in the
 * live pen's act either (`world.mjs § walkEntry`) nor in POS-154's backfill
 * (`world2/tools/backfill-departures.mjs § departureRowFrom` SELECTs
 * `declared_by, note` and drops both). Adding them here would be the fixture
 * agreeing with a store that does not exist.
 *
 * ⚑ `at` IS THE RECORD'S OWN INSTANT, which is the BEST case and not today's:
 * see § THE STOP. Holding the best case here is what makes the rest of the
 * equality meaningful — everything else is shown equal on the assumption that
 * the instant is solved, so the instant is the only thing left in the way.
 */
const actFor = (line, id) => ({
  id,
  at: new Date(line.at),
  crossing: String(line.payload.crossing),
  actor: line.actor,
  action: "walk",
  payload: {
    from: line.payload.from,
    toward: line.payload.toward,
    pace: line.payload.pace ?? null,
    within: line.payload.within ?? null,
    to: line.payload.to ?? null,
  },
});

/** The register, answering the departure query the way `pg` would. */
function fixtureRegister(rows) {
  const asked = [];
  return {
    asked,
    query: async (sql, params) => {
      const flat = String(sql).replace(/\s+/g, " ").trim();
      asked.push({ sql: flat, params });
      if (!/FROM acts/i.test(flat)) return { rows: [] };
      const actions = params?.[0] ?? [];
      let out = rows.filter((r) => actions.includes(r.action));
      if (/_ledger' IS NULL/i.test(flat)) out = out.filter((r) => r.payload?._ledger == null);
      // DEPARTURE_ORDER_SQL, in the fixture's own terms: era, then the instant
      // inside the non-ledger era, then the id. `assertDepartureOrder` runs
      // inside the reader and refuses anything else, so a fixture sorting on
      // the id alone would fail the reader rather than test it.
      const era = (r) => (r.payload?._ledger ? 0 : 1);
      const inst = (r) => (r.payload?._ledger ? 0 : new Date(r.at).getTime());
      return { rows: [...out].sort((a, b) => era(a) - era(b) || inst(a) - inst(b) || a.id - b.id) };
    },
  };
}

let restore = null;
const install = (store) => { restore = useGuardReader(async (fn) => fn(store)); return store; };
afterEach(() => { if (restore) { restore(); restore = null; } });

const ACTS = RECORD.map((l, i) => actFor(l, 9000 + i));
const WINDOW_TO = Date.parse("2026-09-22T12:00:00.000Z");

// ═════════════════════════════════════════════════════════════════════════════
// THE POST-CHANGE FIXTURE (POS-198)
// ═════════════════════════════════════════════════════════════════════════════
//
// `actFor` above is the PRE-CHANGE photograph and it stays exactly as POS-196
// left it: five payload keys, and `at` handed in as the best case the register
// could not actually reach. Its tests are unchanged, because the history of
// this lane is part of what it proved.
//
// This one is the act as the office NOW writes it — built by calling
// `world.mjs § walkEntry` and `world-journal.mjs § normalizeRow`, the two real
// writers, and reading back what they produced. No shape is described here, so
// none can drift from the shape the door writes: if `walkEntry` stops carrying
// the instant, these fixtures stop carrying it too and the equality reds. That
// is the difference between a fixture built AFTER the change and a fixture
// built to AGREE with it.
//
// The record line supplies the declaration — its instant, its declarer, its
// note — exactly as a resident's walk would have supplied them to the door.
const postChangeActFor = (line, id) => {
  const p = line.payload;
  const entry = walkEntry({
    crossing: p.crossing, who: line.actor, targetMarkId: p.to,
    stampAt: { anchor: null, dx: null, dy: null }, witnesses: null,
    from: p.from, toward: p.toward, pace: p.pace ?? null,
    targetExtent: p.within ?? null, household: null,
    writtenAt: line.at,                 // ⚑ the departure's OWN instant, carried
    declaredBy: p.declared_by, note: p.note ?? null,
  });
  const row = normalizeRow(entry);      // the real write path, not a summary of it
  return {
    id,
    at: new Date(row.written_at),       // `written_at` IS `acts.at`
    crossing: String(row.crossing),     // `pg` hands numeric back as TEXT
    actor: row.actor,
    action: row.action,
    payload: JSON.parse(row.payload),
  };
};

const POST_CHANGE_ACTS = RECORD.map((l, i) => postChangeActFor(l, 9000 + i));

/** The renderer's lines, in the `<N>.jsonl` line shape `buildSave` writes. */
async function renderedLines() {
  const { events, absent } = await storedDepartureEvents({ atMs: WINDOW_TO });
  assert.equal(absent, null, "a readable register discloses nothing");
  return events.map((e) => ({
    at: e.at, type: "departure", actor: e.actor, seq: e.seq,
    payload: typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload,
  }));
}

// ═════════════════════════════════════════════════════════════════════════════
// THE EQUALITY FALSIFIER
// ═════════════════════════════════════════════════════════════════════════════

test("the fixture is the real record and nothing was tidied on the way in", () => {
  assert.equal(RECORD.length, 24, "crossing 204 holds 24 departures in the clone at 17fa4195");
  for (const l of RECORD) {
    assert.equal(l.type, "departure");
    assert.equal(l.payload.source, "dynamic.db/movements",
      "every line of this window was written from the reverse-mirror copy — that is the premise of the lane");
    assert.deepEqual(Object.keys(l), ["at", "type", "actor", "seq", "payload"],
      "finding 1's top-key grammar, in its order");
    assert.deepEqual(Object.keys(l.payload),
      ["from", "toward", "crossing", "within", "to", "pace", "declared_by", "source"],
      "finding 1's payload grammar, in its order");
  }
});

test("EQUALITY: every field the world repo reads is byte-equal, rendered from the register", async () => {
  const store = install(fixtureRegister(ACTS));
  const lines = await renderedLines();
  assert.ok(store.asked.length >= 1, "the renderer asked the register no question — it is not reading the store");
  assert.equal(lines.length, RECORD.length, "the register renders one line per record line");

  const { paired, onlyInFile, onlyInDerived } = pairDepartures(RECORD, lines);
  assert.equal(onlyInFile.length, 0, "a record line the register could not answer for");
  assert.equal(onlyInDerived.length, 0, "a register line the record does not hold");
  assert.equal(paired.length, 24);

  for (const p of paired) {
    const read = compareDepartureLine(p.file, p.derived).filter((c) => c.read);
    assert.deepEqual(read, [], `${p.key} differs on a field the world reads`);
  }
});

test("EQUALITY: `source` is the ONE allowed diff, and every other gap is named", async () => {
  install(fixtureRegister(ACTS));
  const lines = await renderedLines();
  const { paired } = pairDepartures(RECORD, lines);

  const classes = new Set();
  for (const p of paired) for (const c of compareDepartureLine(p.file, p.derived)) classes.add(gapClassOf(c));

  assert.equal(classes.has("unexplained"), false, "a difference in no named class is a finding, never a shrug");
  assert.equal(classes.has("source"), true, "the stamp moves from dynamic.db/movements to acts");
  assert.equal(classes.has("seq"), true, "the movements rowid has no store source; the act id stands in");
  // `declared_by` and `note` are gaps in the GRAMMAR (the register holds
  // neither) and happen not to differ in THIS window, because every one of its
  // 24 lines was declared by its own actor and none carries a note. They are
  // asserted as facts about the window rather than left implied — a window
  // where they DID differ would be a different measurement, not a failure here.
  for (const l of RECORD) {
    assert.equal(l.payload.declared_by, l.actor, "window 204 has no delegated walk");
    assert.equal("note" in l.payload, false, "window 204 carries no note");
  }
  assert.equal(classes.has("declared_by"), false);
  assert.equal(classes.has("note"), false);

  assert.deepEqual([...classes].sort(), ["seq", "source"],
    "with the instant solved, exactly two fields differ and both are named");
});

// ── the same equality, over acts the office now really writes (POS-198) ─────

test("POST-CHANGE EQUALITY: acts built by the LIVE writers read byte-equal on all nine fields", async () => {
  const store = install(fixtureRegister(POST_CHANGE_ACTS));
  const lines = await renderedLines();
  assert.ok(store.asked.length >= 1, "the renderer asked the register no question — it is not reading the store");
  assert.equal(lines.length, RECORD.length);

  const { paired, onlyInFile, onlyInDerived } = pairDepartures(RECORD, lines);
  assert.equal(onlyInFile.length, 0, "a record line the live writers could not answer for");
  assert.equal(onlyInDerived.length, 0, "a register line the record does not hold");
  assert.equal(paired.length, 24);

  for (const p of paired) {
    const read = compareDepartureLine(p.file, p.derived).filter((c) => c.read);
    assert.deepEqual(read, [], `${p.key} differs on a field the world reads`);
  }

  // Nine fields, named rather than counted, so a reader of this test knows what
  // "byte-equal" was judged on: finding 4's read set, which is pinned in code.
  assert.deepEqual([...RECORD_READ_FIELDS].sort(),
    ["actor", "at", "payload.crossing", "payload.from", "payload.pace", "payload.to",
     "payload.toward", "payload.within", "type"].sort(),
    "the read set moved — the equality above is judged on a different question than the one POS-196 asked");
  assert.equal(RECORD_READ_FIELDS.length, 9);
});

test("POST-CHANGE: `source` is still the one allowed diff, and the INSTANT is no longer among them", async () => {
  install(fixtureRegister(POST_CHANGE_ACTS));
  const lines = await renderedLines();
  const { paired } = pairDepartures(RECORD, lines);

  const classes = new Set();
  for (const p of paired) for (const c of compareDepartureLine(p.file, p.derived)) classes.add(gapClassOf(c));

  assert.equal(classes.has("at"), false,
    "THE STOP, CLOSED: the act carries the departure's own instant, so the field every world reader reads first no longer differs");
  assert.equal(classes.has("unexplained"), false, "a difference in no named class is a finding, never a shrug");
  assert.deepEqual([...classes].sort(), ["seq", "source"],
    "exactly the two gaps that have no store source, and nothing else");
});

test("POST-CHANGE: the instant is the RECORD's, and it came through `writtenAt` rather than a clock", () => {
  // The claim is equality with the record, line for line — not that the acts
  // were stamped recently. A fixture stamped at build time would pass a
  // "looks like an instant" test and fail the world.
  for (let i = 0; i < RECORD.length; i++) {
    assert.equal(POST_CHANGE_ACTS[i].at.toISOString(), RECORD[i].at,
      "the act's instant is not the departure's — `walkEntry` has stopped carrying `writtenAt`");
  }
  const built = Date.now();
  assert.ok(POST_CHANGE_ACTS.every((a) => a.at.getTime() < built - 1000),
    "an act stamped at fixture-build time is this suite measuring its own clock, which is the thing POS-196 refused to do");
});

test("POST-CHANGE: `declared_by` and `note` are in the act now, which is what made them gaps", () => {
  // They are not in `RECORD_READ_FIELDS`, so they do not move the equality
  // above. They were named as GAPS because the register could not hold them at
  // all; it can now, and the renderer is free to read them when its lane says so.
  for (let i = 0; i < RECORD.length; i++) {
    assert.equal(POST_CHANGE_ACTS[i].payload.declared_by, RECORD[i].payload.declared_by,
      "window 204's own declarer did not survive into the act");
    assert.equal("note" in POST_CHANGE_ACTS[i].payload, "note" in RECORD[i].payload,
      "`note` is conditional on both sides or the grammars disagree");
  }
  assert.equal(POST_CHANGE_ACTS.every((a) => "declared_by" in a.payload), true);
});

test("THE PRE-CHANGE FIXTURE IS UNTOUCHED — history keeps its photograph", () => {
  // POS-196's fixture carried five payload keys and no instant of its own.
  // POS-198 must not retouch it: what that lane measured is only meaningful
  // against the office it measured.
  for (const a of ACTS) {
    assert.deepEqual(Object.keys(a.payload), ["from", "toward", "pace", "within", "to"],
      "the pre-change fixture grew a key — it is no longer the act POS-196 weighed");
  }
  assert.equal(ACTS.length, 24);
  // And the two fixtures differ in exactly the way the change did.
  assert.deepEqual(Object.keys(POST_CHANGE_ACTS[0].payload).slice(0, 5), Object.keys(ACTS[0].payload),
    "the live act's first five keys are still POS-196's five, in its order");
  assert.ok(Object.keys(POST_CHANGE_ACTS[0].payload).length > 5,
    "and the live act carries more, which is the change");
});

test("CONTROL: the equality can fail — one mangled read field is caught and named", async () => {
  install(fixtureRegister(ACTS));
  const lines = await renderedLines();
  const { paired } = pairDepartures(RECORD, lines);

  // A probe that cannot fail is an act. Move one walker one metre.
  const victim = paired[0];
  const bent = { ...victim.derived, payload: { ...victim.derived.payload, toward: { x: victim.derived.payload.toward.x + 1, y: victim.derived.payload.toward.y } } };
  const causes = compareDepartureLine(victim.file, bent);
  const read = causes.filter((c) => c.read);
  assert.equal(read.length, 1, "exactly the bent field is caught");
  assert.equal(read[0].field, "payload.toward");
  assert.equal(gapClassOf(read[0]), "unexplained", "a read field has no named gap — every difference in one is a finding");
});

test("CONTROL: a line only the register holds is UNEXPLAINED, never quietly dropped", async () => {
  // The planted walk: in the register, in no file. An answer short by exactly
  // the rows nobody looks for is the one outcome neither store may produce.
  const ghost = {
    id: 9999, at: new Date("2026-09-22T06:00:00.000Z"), crossing: "204.5",
    actor: "ghost-walker", action: "walk",
    payload: { from: { x: 0, y: 0 }, toward: { x: 10, y: 10 }, pace: 60, within: null, to: null },
  };
  install(fixtureRegister([...ACTS, ghost]));
  const lines = await renderedLines();
  const { onlyInDerived } = pairDepartures(RECORD, lines);
  assert.equal(onlyInDerived.length, 1);
  assert.equal(onlyInDerived[0].actor, "ghost-walker");
});

test("the renderer writes finding 1's grammar, key order included", async () => {
  install(fixtureRegister(ACTS));
  const lines = await renderedLines();
  for (const l of lines) {
    assert.deepEqual(Object.keys(l.payload),
      ["from", "toward", "crossing", "within", "to", "pace", "declared_by", "source"],
      "key ORDER is part of the bytes and the record has carried one order across all 2,870 of its lines");
    assert.equal(l.payload.source, "acts");
    assert.equal(l.type, "departure");
  }
});

test("era one is not rendered here — the caller already holds it", async () => {
  // `world.mjs § departuresAcrossEras` and `crossing-save`'s own
  // `readDepartureEvents` both bring the frozen ledger from the world clone.
  // Returning it from the register too would hand `mergedDepartureEvents` one
  // departure twice under two era tags, where latest-wins picks whichever
  // sorted last — a different resident's governing leg, silently.
  const ledgerAct = {
    id: 1001, at: new Date("2026-06-20T12:00:00.000Z"), crossing: "16.5",
    actor: "founding-walker", action: "legacy:departure",
    payload: { _ledger: "walk-ledger.md", handle: "founding-walker", iso: "2026-06-20T12:00:00.000Z", from: { x: 1, y: 1 }, toward: { x: 2, y: 2 }, at: 16.5, line: "founding-walker walked" },
  };
  install(fixtureRegister([ledgerAct, ...ACTS]));
  const lines = await renderedLines();
  assert.equal(lines.some((l) => l.actor === "founding-walker"), false,
    "the founding era arrives by the clone, and only by the clone");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE STOP — the register holds no departure instant
// ═════════════════════════════════════════════════════════════════════════════
//
// Both halves name the CAUSE. Simulating the drift with a hand-picked offset
// would be a probe relying on a number I chose, which proves nothing about the
// office.

// ⚑ CAUSE 1 IS CLOSED (POS-198, 2026-09-22), AND THIS TEST NOW SAYS SO.
//
// POS-196 wrote it as "if this ever passes, the act has learned the departure's
// own instant and the STOP is closed". It has. `world.mjs § walkEntry` carries
// `writtenAt`, and `walkViaOffice` reads the declaration clock ONCE and hands
// the same string to `dynamic.db/movements` and to the act.
//
// So the test keeps the same subject and splits into the two claims that are
// true now: the instant is carried when there IS one, and the mirror's clock
// is still the answer when there is not. Deleting it would take the cause's
// name off the record; leaving it asserting the old behaviour would be the
// suite disagreeing with the office.
test("CAUSE 1, CLOSED: an act with a declared instant is stamped with THAT, not the mirror's clock", () => {
  const departedAt = "2026-09-22T00:14:40.194Z";
  const row = normalizeRow({
    crossing: 204.02035324074075, actor: "neth", action: "walk", object: null,
    at: { anchor: null, dx: null, dy: null }, witnesses: null, cls: "move",
    payload: { from: { x: 1306, y: 2093.5 }, toward: { x: 1329, y: 2083 }, pace: 60, within: { w: 4, h: 4 }, to: "neth/little-free-library" },
    effect: "the walk is declared; the record receives it at the save",
    writtenAt: departedAt,
  });

  assert.equal(row.written_at, departedAt,
    "the declared instant did not reach `written_at` — and `written_at` is the `acts.at` every world reader of a departure reads first");
  assert.equal(Object.prototype.hasOwnProperty.call(row.payload ? JSON.parse(row.payload) : {}, "at"), false,
    "the instant is a COLUMN, not a payload key — the record's own grammar has no key for it");
});

test("THE FALLBACK STANDS: an act class with NO declared instant still gets the mirror's clock", () => {
  // The fallback is not a leftover; it is the only honest answer for a class
  // that does not know when it happened. `ride` (world-apex.mjs), `mark`
  // (world.mjs), `stance` (world-stance.mjs) and the crossing's own rows
  // (crossing-exec.mjs) all reach `normalizeRow` with no `writtenAt`. Closing
  // the STOP for `move` must not leave any of them unstamped.
  const before = Date.now();
  const row = normalizeRow({
    crossing: 204.5, actor: "alpha", action: "ride", object: "the-town/the-post-office",
    at: null, witnesses: null, cls: "ride",
    payload: { boarded: 204.0 }, effect: "aboard",
  });
  const after = Date.now();

  const stamped = Date.parse(row.written_at);
  assert.ok(stamped >= before && stamped <= after,
    "a class with no instant of its own must still be stamped, and stamped at normalize time");
});

test("STOP (cause 2): the act's `crossing` is a DIFFERENT clock read and does not reconstruct the instant", () => {
  // The register's other instant-shaped column. `world.mjs § walkViaOffice`
  // computes `fractionalCrossing()` once, hands it to both pens, and only then
  // does `declareMovement` read the wall clock for `movements.at` — so the two
  // are separated by whatever the door did in between.
  //
  // Measured on this window's own 24 lines, with the world's own constants.
  const CROSSING_EPOCH_UTC = Date.UTC(2026, 5, 12);
  const CROSSING_MS = 12 * 3600 * 1000;
  const deltas = RECORD.map((l) => Math.round(CROSSING_EPOCH_UTC + l.payload.crossing * CROSSING_MS) - Date.parse(l.at));

  assert.equal(deltas.filter((d) => d === 0).length, 0,
    "not one of the 24 reconstructs exactly — if this ever fails, the crossing has become the instant and cause 2 is closed");
  assert.ok(Math.max(...deltas.map(Math.abs)) > 1,
    "and the miss is larger than a rounding of the float");
});

test("the STOP is written down where a reader of the check will find it", () => {
  assert.match(DEPARTURE_GAPS.at, /^STOP:at/, "the instant is the one gap ranked as a STOP");
  assert.match(DEPARTURE_GAPS.seq, /^gap:seq/);
  assert.match(DEPARTURE_GAPS.declared_by, /^gap:declared_by/);
  assert.match(DEPARTURE_GAPS.note, /^gap:note/);
  assert.match(DEPARTURE_GAPS.source, /^gap:source/);
  assert.equal(RECORD_READ_FIELDS.includes("at"), true,
    "and `at` is in the read set, which is why it is a STOP and not a gap");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE CHECK'S OWN MANNERS
// ═════════════════════════════════════════════════════════════════════════════

test("NOT POINTED AT A REGISTER is disclosed, never rendered as an empty record", async () => {
  const pg = process.env.WORLD2_PG;
  delete process.env.WORLD2_PG;
  try {
    const { events, absent } = await storedDepartureEvents({ atMs: WINDOW_TO });
    assert.deepEqual(events, []);
    assert.match(String(absent), /not pointed at the record/,
      "an office with no register must not be readable as a town where nobody has walked");
  } finally { process.env.WORLD2_PG = pg; }
});

test("an unreachable register is disclosed, and the renderer never throws", async () => {
  install({ query: async () => { throw new Error("connection refused"); } });
  const { events, absent } = await storedDepartureEvents({ atMs: WINDOW_TO });
  assert.deepEqual(events, []);
  assert.ok(absent && /connection refused|record cannot be reached/.test(absent),
    "the cause is carried, not swallowed");
});

test("era one lines on disk are not the store's half and are counted, not compared", () => {
  // Windows 118 and 119 hold 13 lines with `line_no` and no `source`: the
  // hydrated ledger, written through `read.events`. They are outside this
  // record's half and pairing them against the register would report 13
  // orphans in a window that is perfectly correct.
  const eraOne = { at: "2026-08-10T04:20:13.309Z", type: "departure", actor: "postmaster", seq: 305, payload: { from: { x: 0, y: 0 }, toward: { x: 1, y: 1 }, crossing: 118.3614, within: null, to: null, pace: null, line_no: 318 } };
  const kept = storeEraLines([eraOne, ...RECORD]);
  assert.equal(kept.length, RECORD.length, "era one is filtered out by its own missing stamp");
  assert.equal(kept.some((l) => l.payload.line_no != null), false);
});

// ── `--check` END TO END, over the real file on disk ────────────────────────
//
// The block above drives the pure halves. This drives the instrument Wright
// runs on the box: the real 24-line window and its real meta, read off a disk,
// cut at the file's own horizon, compared against a register.

const CROSSING_MS = 12 * 3600 * 1000;
const CROSSING_204_START = Date.UTC(2026, 5, 12) + 204 * CROSSING_MS;

/** A STATE/ holding the real crossing-204 record and its real meta. */
function stateDirWithWindow204() {
  const dir = mkdtempSync(join(tmpdir(), "pos196-"));
  mkdirSync(join(dir, "log"), { recursive: true });
  writeFileSync(join(dir, "log", "204.jsonl"), readFileSync(FIXTURE, "utf8"), "utf8");
  writeFileSync(join(dir, "log", "204.meta.json"), readFileSync(join(HERE, "fixtures", "pos196-window-204.meta.json"), "utf8"), "utf8");
  return dir;
}

test("--check: the real window 204 against a register that holds the same walks", async () => {
  const dir = stateDirWithWindow204();
  try {
    install(fixtureRegister(ACTS));
    const out = await checkDepartureWindow({
      crossing: 204, stateDir: dir, crossingStartMs: CROSSING_204_START, crossingMs: CROSSING_MS,
    });
    assert.equal(out.refused, undefined, `the check refused: ${out.detail}`);
    assert.match(out.horizon, /the file's own meta/, "both sides are cut at the file's declared window");
    assert.equal(out.file_lines, 24);
    assert.equal(out.derived_lines, 24);
    assert.equal(out.paired, 24);
    assert.equal(out.only_in_file, 0);
    assert.equal(out.only_in_register, 0);
    assert.equal(out.ledger_era, 0);
    assert.equal(out.read_equal, true, `the read fields differ: ${out.first_difference}`);
    assert.deepEqual(Object.keys(out.classes).sort(), ["seq", "source"],
      "with the instant solved, the leftovers are the two named gaps and nothing else");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--check: a drifted instant is caught, and it is the line the verdict leads with", async () => {
  // THE STOP, seen through the instrument. The offset is the SHAPE the mirror
  // writes (the act is stamped after the resident declared, never before —
  // `backfill-departures.mjs § PAIR_TOLERANCE_MS`), and the claim under test is
  // the instrument's, not the offset's: does `--check` catch a departure whose
  // recorded instant moved, and does it say so first?
  const dir = stateDirWithWindow204();
  try {
    const drifted = ACTS.map((a) => ({ ...a, at: new Date(a.at.getTime() + 900) }));
    install(fixtureRegister(drifted));
    const out = await checkDepartureWindow({
      crossing: 204, stateDir: dir, crossingStartMs: CROSSING_204_START, crossingMs: CROSSING_MS,
    });
    assert.equal(out.paired, 24, "the pairing key survives the drift, which is why the drift is visible at all");
    assert.equal(out.read_equal, false, "a moved instant is a difference on a field the world reads");
    assert.equal(out.classes.at, 24, "on every line of the window");
    assert.match(String(out.first_difference), /^.*· STOP:at/,
      "the STOP outranks the two accepted gaps in the one line a reader gets");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--check: an empty window is not clean, and a missing file is refused by name", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pos196-"));
  try {
    mkdirSync(join(dir, "log"), { recursive: true });
    install(fixtureRegister(ACTS));
    const missing = await checkDepartureWindow({
      crossing: 204, stateDir: dir, crossingStartMs: CROSSING_204_START, crossingMs: CROSSING_MS,
    });
    assert.equal(missing.refused, "no-file", "a dark crossing is named, never read as agreement");

    writeFileSync(join(dir, "log", "300.jsonl"), "", "utf8");
    const empty = await checkDepartureWindow({
      crossing: 300, stateDir: dir, crossingStartMs: Date.UTC(2026, 5, 12) + 300 * CROSSING_MS, crossingMs: CROSSING_MS,
    });
    assert.match(String(empty.note), /nothing to compare/,
      "green having looked at nothing is the starving-crossing shape one layer down");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the check pairs on (actor, crossing) — the one key neither side is measuring", () => {
  // `at` and `seq` are the quantities under measurement, so pairing on either
  // would report every line as two orphans and drown the real disagreements.
  // `crossing` is safe because ONE variable fills it on both sides.
  const shifted = RECORD.map((l, i) => ({ ...l, at: new Date(Date.parse(l.at) + 900).toISOString(), seq: 50000 + i }));
  const { paired, onlyInFile, onlyInDerived } = pairDepartures(RECORD, shifted);
  assert.equal(paired.length, RECORD.length, "the pairing survives the two gaps it was built to survive");
  assert.equal(onlyInFile.length, 0);
  assert.equal(onlyInDerived.length, 0);
  const causes = compareDepartureLine(paired[0].file, paired[0].derived);
  assert.equal(causes.some((c) => c.field === "at" && c.read), true, "and the drift is still REPORTED, on a read field");
});
