// walkers-read-the-store.test.mjs — `storedDepartures` reads the RECORD, and the
// four doors that stand on it keep answering what they answered (POS-154, the
// walker half of Everything Reads the Store).
//
// ── WHAT IS ON TRIAL ────────────────────────────────────────────────────────
//
// `world-movement.mjs § storedDepartures` opened `dynamic.db` and folded the
// `movements` table. It reads `acts` under `DEPARTURE_ACTIONS` now, through the
// read worker's one road, and the sqlite open is GONE rather than kept under a
// flag — one question, one owner. Everything downstream is unchanged in what it
// reads: `GET /world/orient`, `/world/present`, `/world/walkers`, the say door's
// earshot, and `framesByHandle`'s frame overlay.
//
// ── WHY A FIXTURE STORE AND NOT A REAL ONE ──────────────────────────────────
//
// `useGuardReader` installs a stand-in for `officeRead` — the seam
// `test/world2-guard-doors.test.mjs` already uses, and the reason is the same:
// the port's own equality falsifier needs Postgres, a world checkout and a
// scratch database, so it can only ever run on the box; the BEHAVIOUR of the
// reader has to be provable anywhere or it is proven once and never again.
//
// ⚑ THE SEAM REPLACES THE ROAD, SO IT CANNOT SEE THE ROAD. A test driving
// `useGuardReader` proves what the reader does with rows; it cannot prove the
// rows arrived inside `officeRead`'s `BEGIN READ ONLY` on one pooled connection,
// because that is exactly the thing it stood in for. That claim is pinned as
// SOURCE TEXT below instead of asserted behaviourally, and the distinction is
// deliberate (POS-162's finding, verbatim: a test seam that replaces a road
// cannot see what the road does).
//
// ── THE PLANTED WALK ────────────────────────────────────────────────────────
//
// Every equality here would pass with the reader doing nothing if the fixture
// merely agreed with a tree. So the fixture store carries a walk — `ghost-walker`
// — that stands in NO ledger, NO clone and NO sqlite: its only existence is the
// rows. If the answer cannot see it, the reader is not reading the store.
//
// ── THE FLIP (run before the commit; the red line is in the PR body) ─────────
//
// In `src/world-movement.mjs § storedDepartures`, restore the sqlite read:
// replace the `storeDepartureRows()` call with the old
// `openDynamic(path, { readOnly: true })` + `readMovements(h, { until: atMs })`
// fold. Every case below that names the store goes red, and the one that names
// the CAUSE rather than a symptom is THE PLANTED WALK: a walk that exists only
// in the record is not returned, because the reader went back to a file.
//
// Run: node --test test/walkers-read-the-store.test.mjs

import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { storedDepartures, storedRecordsFor, recordsAcrossEras } from "../src/world-movement.mjs";
import { useGuardReader } from "../src/world2-guards.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";

const restoreEnvFlag = (was) => {
  if (was === undefined) delete process.env.WORLD_MOVEMENT_V2; else process.env.WORLD_MOVEMENT_V2 = was;
};

// The read asks `world2Enabled()` before it asks the road anything — an office
// with no record configured spends no socket discovering that. So these two are
// the price of reaching the reader at all, and the case that does NOT set them
// is the one that proves the refusal.
const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => { process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = "postgres://walkers-read-the-store/none"; });
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

// ── the fixture record ──────────────────────────────────────────────────────
//
// Shaped as `pg` hands rows over: `at` a Date, `crossing` TEXT (numeric arrives
// as a string), `payload` an object. Anything else here would make both sides
// agree about a store nobody runs.

const T = (iso) => new Date(iso);

/** ERA 5 — the movement-store pen: the movements row's own columns, one level up. */
const storeAct = ({ id, actor, at, crossing, from, toward, within = null, to = null, pace = null }) => ({
  id, at: T(at), crossing: String(crossing), actor, action: "walk",
  payload: { from, toward, within, to, pace, declared_by: actor, source: "dynamic.db/movements" },
});

/** ERA 2 — the world journal's departure row, the departure one level down. */
const journalAct = ({ id, actor, at, crossing, from, toward }) => ({
  id, at: T(at), crossing: String(crossing), actor, action: "legacy:departure",
  payload: { at, actor, type: "departure", payload: { from, toward, crossing, within: null, to: null, pace: null } },
});

/** ERA 1 — the frozen ledger, backfilled. Era one reaches the doors by another road. */
const ledgerAct = ({ id, handle, at, crossing, from, toward, iso }) => ({
  id, at: T(at), crossing: String(crossing), actor: handle, action: "legacy:departure",
  payload: { _ledger: "walk-ledger.md", handle, iso, from, toward, at: crossing, line: `${handle} walked` },
});

const HERE = { x: 100, y: 100 };
const THERE = { x: 400, y: 400 };
const YONDER = { x: 900, y: 900 };

// ⚑ THE PLANTED WALK. In the rows, in no ledger, in no clone, in no sqlite.
const GHOST = storeAct({ id: 5001, actor: "ghost-walker", at: "2026-09-10T10:00:00.000Z",
  crossing: 120.5, from: HERE, toward: THERE });

// A walk whose only shape is the JOURNAL envelope — the era the sqlite journal
// truncates at every drain (`world-drain.mjs`). Present in `acts`, long gone
// from any file a cursor could still reach: the brief's third falsifier.
const DRAINED = journalAct({ id: 4001, actor: "long-walker", at: "2026-08-15T04:00:00.000Z",
  crossing: 64.25, from: HERE, toward: YONDER });

const LEDGER = ledgerAct({ id: 1001, handle: "founding-walker", at: "2026-06-20T12:00:00.000Z",
  crossing: 16.5, iso: "2026-06-20T12:00:00.000Z", from: HERE, toward: THERE });

const ROWS = [LEDGER, DRAINED, GHOST];

/**
 * A client that answers the departure query and COUNTS what it was asked, so a
 * reader that opened no query fails on the count alone.
 *
 * `rows` are filtered here the way the SQL filters them, because the equality on
 * trial is the reader's, not Postgres's: a fixture that answered every query with
 * every row would hide a missing WHERE clause.
 */
function fixtureStore({ rows = ROWS, throws = null } = {}) {
  const asked = [];
  return {
    asked,
    query: async (sql, params) => {
      const flat = String(sql).replace(/\s+/g, " ").trim();
      asked.push({ sql: flat, params });
      if (throws) throw throws;
      if (!/FROM acts/i.test(flat)) return { rows: [] };
      const actions = params?.[0] ?? [];
      let out = rows.filter((r) => actions.includes(r.action));
      // `payload->>'_ledger' IS NULL` — the clause that keeps era one from
      // arriving twice. A fixture that ignored it would make the doubling case
      // below green against a reader that never wrote it.
      if (/_ledger' IS NULL/i.test(flat)) out = out.filter((r) => r.payload?._ledger == null);
      // DEPARTURE_ORDER_SQL: ledger-sourced first, then id ascending inside each era.
      return { rows: [...out].sort((a, b) =>
        (Number(a.payload?._ledger == null) - Number(b.payload?._ledger == null)) || (a.id - b.id)) };
    },
  };
}

let restore = null;
const install = (store) => { restore = useGuardReader(async (fn) => fn(store)); return store; };
afterEach(() => { if (restore) { restore(); restore = null; } });

// ═════════════════════════════════════════════════════════════════════════════
// THE PLANTED WALK — the case that names the cause
// ═════════════════════════════════════════════════════════════════════════════

test("THE PLANTED WALK: a departure that exists only in the record reaches the doors", async () => {
  const store = install(fixtureStore());
  const { records, absent } = await storedDepartures({ atMs: Date.parse("2026-09-21T00:00:00Z") });
  assert.equal(absent, null, "a readable record discloses nothing");
  assert.ok(store.asked.length >= 1, "the reader asked the record no question at all — it is not reading the store");
  const ghost = records.find((r) => r.handle === "ghost-walker");
  assert.ok(ghost, "the walk that stands only in the record was not returned — the reader is reading a file");
  assert.deepEqual(ghost.toward, THERE);
});

test("A WALK OLDER THAN ANY DRAIN CURSOR is still placed", async () => {
  // The journal envelope is the shape `world-drain.mjs` truncates out of the
  // sqlite journal at every drain. `acts` is never truncated, so this row is
  // exactly the one the old reader could lose and this one cannot.
  install(fixtureStore());
  const mine = await storedRecordsFor("long-walker", { atMs: Date.parse("2026-09-21T00:00:00Z") });
  assert.equal(mine.length, 1, "a drained-era departure went missing from the answer");
  assert.deepEqual(mine[0].toward, YONDER);
  assert.equal(mine[0].at, 64.25, "the crossing rides the journal payload, not the act row");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE SHAPE — what the four callers read, unchanged
// ═════════════════════════════════════════════════════════════════════════════

test("the record's row becomes 1.0's own vocabulary, and `source` is stamped on every one", async () => {
  install(fixtureStore());
  const { records } = await storedDepartures({ atMs: Date.parse("2026-09-21T00:00:00Z") });
  assert.ok(records.length > 0, "nothing came back — this case would pass over an empty answer");
  for (const r of records) {
    // `source: "store"` IS LOAD-BEARING and is the field the port could most
    // easily drop: `recordsAcrossEras` maps era one with
    // `era: r.source === "store" ? "store" : "ledger"`, `dedupeRecords` keys on
    // `era`, and `dynamic-presence.mjs` puts `era: "store"` in front of a
    // resident off exactly this value.
    assert.equal(r.source, "store", `a record reached a caller without its source: ${JSON.stringify(r)}`);
    assert.deepEqual(Object.keys(r).sort(),
      ["at", "from", "handle", "iso", "pace", "source", "targetExtent", "targetMarkId", "toward"],
      "the record carries a field 1.0 never read, or is missing one it does");
  }
});

test("the port's own bookkeeping does not leak into the record", async () => {
  // `departureRecords` adds `line`, `era` and `act_id`. `era` is the trap: the
  // name COLLIDES with the era `recordsAcrossEras` stamps and carries a different
  // vocabulary (`journal`/`movement-store` against `store`/`ledger`), so a
  // pass-through would quietly re-key `dedupeRecords`.
  install(fixtureStore());
  const { records } = await storedDepartures({ atMs: Date.parse("2026-09-21T00:00:00Z") });
  for (const r of records) {
    assert.equal("era" in r, false, "the port's era label reached the merge and will re-key the dedupe");
    assert.equal("act_id" in r, false);
    assert.equal("line" in r, false);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ERA ONE ARRIVES ONCE — the widening the query must not be
// ═════════════════════════════════════════════════════════════════════════════

test("the founding era is NOT returned by the store read, because it arrives by another road", async () => {
  install(fixtureStore());
  const { records } = await storedDepartures({ atMs: Date.parse("2026-09-21T00:00:00Z") });
  assert.equal(records.some((r) => r.handle === "founding-walker"), false,
    "a `_ledger` act came back from the store read — era one now reaches the merge twice");
});

test("and the merge therefore holds ONE copy of a founding leg, not two", async () => {
  install(fixtureStore());
  const { records } = await storedDepartures({ atMs: Date.parse("2026-09-21T00:00:00Z") });
  // Era one as the doors inject it: `parseWalkLedger`'s output, no `source`.
  const era1 = [{ iso: "2026-06-20T12:00:00.000Z", handle: "founding-walker", from: HERE, toward: THERE, at: 16.5 }];
  const merged = recordsAcrossEras(era1, records.filter((r) => r.handle === "founding-walker"));
  assert.equal(merged.length, 1, "the founding leg is in the merged list twice — which re-decides who governs");
  assert.equal(merged[0].era, "ledger");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE CUT IS ON THE RECORD'S OWN INSTANT
// ═════════════════════════════════════════════════════════════════════════════

test("`atMs` cuts on the record's derived instant, and the cut can go both ways", async () => {
  install(fixtureStore());
  const before_ = await storedDepartures({ atMs: Date.parse("2026-09-01T00:00:00Z") });
  const after_ = await storedDepartures({ atMs: Date.parse("2026-09-21T00:00:00Z") });
  const names = (r) => r.records.map((x) => x.handle).sort();
  // A cut that filtered NOTHING would make both sides equal, which is the way a
  // cut-shaped assertion passes while measuring nothing.
  assert.deepEqual(names(before_), ["long-walker"], "the cut let a later walk through");
  assert.deepEqual(names(after_), ["ghost-walker", "long-walker"], "the cut swallowed a walk it should have kept");
  assert.notDeepEqual(names(before_), names(after_), "the two instants answered the same list — the cut is inert");
});

// ═════════════════════════════════════════════════════════════════════════════
// A RECORD THAT CANNOT BE READ IS DISCLOSED, NEVER SILENT
// ═════════════════════════════════════════════════════════════════════════════

test("a store that refuses answers `absent` with its reason, and never throws", async () => {
  install(fixtureStore({ throws: new Error("the record is not reachable from here") }));
  const read = await storedDepartures({ atMs: Date.now() });
  assert.deepEqual(read.records, [], "a refusing record handed back records anyway");
  assert.ok(read.absent, "a refusing record answered a silent empty list — indistinguishable from a town that never walked");
  assert.match(read.absent, /not reachable/, `the reason was swallowed: ${read.absent}`);
});

test("an office pointed at no record says so, rather than reporting a quiet town", async () => {
  const pg = process.env.WORLD2_PG;
  delete process.env.WORLD2_PG;
  try {
    const read = await storedDepartures({ atMs: Date.now() });
    assert.deepEqual(read.records, []);
    // The ruled outer sentence is the same for every refusal, so the CAUSE is
    // what makes this disclosure worth printing — an operator reading
    // "cannot be reached" alone would go and look at the pool.
    assert.match(String(read.absent), /cannot be reached/,
      "an unconfigured office answered an empty list with no reason attached");
    assert.match(String(read.absent), /WORLD2_PG/,
      `the cause was swallowed by the ruled sentence: ${read.absent}`);
  } finally { process.env.WORLD2_PG = pg; }
});

test("rows out of the record's append order REFUSE by name rather than answering a wrong governing leg", async () => {
  // The 44-handle trap: `ORDER BY id` alone puts the oldest era last. The order
  // guard is what makes that a refusal instead of a silently wrong answer, and
  // it must survive the port — so the fixture hands the rows back unsorted.
  const store = fixtureStore();
  const unsorted = {
    asked: store.asked,
    query: async (sql, params) => {
      const { rows } = await store.query(sql, params);
      return { rows: [...rows].reverse() };
    },
  };
  install(unsorted);
  const read = await storedDepartures({ atMs: Date.parse("2026-09-21T00:00:00Z") });
  assert.deepEqual(read.records, []);
  // ⚑ THE GUARD HAS THREE SENTENCES, ONE PER ORDER KEY, and this enumerated two
  // of them. `world2/tools/live-reads.mjs § orderViolation` speaks in the broken
  // key's own words: "append order" for `era`, "instant-ascending" for `instant`,
  // "id-ascending" for `id`. The `instant` key was added by `76d36b9` (POS-154,
  // 2026-09-21, "a departure's order is its INSTANT, never its insertion id"),
  // on a branch beside the one that wrote this file (`fb80fca`, same day) — the
  // two merged into the train and neither side re-read the other's assertion,
  // so from that merge this leg called a CORRECT refusal a wrong answer. The
  // guard never stopped refusing by name; the enumeration was short by one.
  // The exact `instant` wording is pinned in test/backfill-departures.test.mjs.
  assert.match(String(read.absent), /append order|instant-ascending|id-ascending/,
    `an out-of-order read answered normally: ${read.absent}`);
  assert.match(String(read.absent), /act \d+/,
    `the refusal named no act, so an operator cannot go and look at one: ${read.absent}`);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE DOOR ITSELF — `/world/walkers` places a walker the record alone knows
// ═════════════════════════════════════════════════════════════════════════════
//
// Everything above proves what the READER does. These drive the public door end
// to end over the real clone's engine, because "the reader returned a row" and
// "the town's map draws a person there" are two claims, and only the second is
// the one a resident sees.

test("THE DOOR: `/world/walkers` places a walker whose only record is the store", async (t) => {
  if (!WORLD_CLONE || !existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"))) {
    return t.skip("no world clone on this machine — the door needs the engine, and a silent pass here would read as coverage");
  }
  const was = process.env.WORLD_MOVEMENT_V2;
  process.env.WORLD_MOVEMENT_V2 = "1";
  install(fixtureStore());
  try {
    const { worldWalkers } = await import("../src/world.mjs");
    const r = await worldWalkers(WORLD_CLONE);
    const ghost = r.walkers.find((w) => w.handle === "ghost-walker");
    assert.ok(ghost, "the door did not place a walker the record alone knows about");
    assert.deepEqual({ x: ghost.x, y: ghost.y }, THERE,
      "the door placed him, but not where his own record put him");
  } finally { restoreEnvFlag(was); }
});

test("THE DOOR, CONTROL: with the record unreachable he is gone, and the door still answers", async (t) => {
  if (!WORLD_CLONE || !existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"))) {
    return t.skip("no world clone on this machine");
  }
  // Without this, the case above could be green off the clone's own ledger — a
  // door that places everybody would place him too. Same door, same instant, one
  // thing changed: the record refuses.
  const was = process.env.WORLD_MOVEMENT_V2;
  process.env.WORLD_MOVEMENT_V2 = "1";
  install(fixtureStore({ throws: new Error("the record is not reachable from here") }));
  try {
    const { worldWalkers } = await import("../src/world.mjs");
    const r = await worldWalkers(WORLD_CLONE);
    assert.equal(r.walkers.some((w) => w.handle === "ghost-walker"), false,
      "he is on the map with no record behind him — the case above proves nothing");
    assert.ok(r.walkers.length > 0,
      "an unreachable record emptied the whole door — era one must still answer");
  } finally { restoreEnvFlag(was); }
});

// ═════════════════════════════════════════════════════════════════════════════
// THE SOURCE PINS — claims a seam that replaces the road cannot make
// ═════════════════════════════════════════════════════════════════════════════
//
// Each reads the file, so each is a claim about what SHIPS. They are pinned here
// rather than asserted behaviourally because the `useGuardReader` seam stands in
// for the road itself, and a deleted sqlite open leaves no behaviour to probe.

// ⚑ THE PINS READ CODE, NOT PROSE. Each of these deletions leaves a comment
// BEHIND that names the thing deleted — `framesByHandle`'s explains why it no
// longer opens the store, and names `openDynamicReadOnly` to do it. A pin
// grepping the raw text would then fail on the explanation of its own success,
// which is a pin measuring the wrong thing. Comments are stripped first.
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const code = (text) => text.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

test("PIN: `storedDepartures` opens no sqlite store, and reaches the record through the read worker's one road", () => {
  const text = src("world-movement.mjs");
  const fn = code(text.slice(text.indexOf("export async function storedDepartures"),
    text.indexOf("export async function storedRecordsFor")));
  assert.ok(fn.length > 100, "the function moved — this pin is reading the wrong region");
  assert.equal(/openDynamic\(|dynamicDbPath\(|readMovements\(/.test(fn), false,
    "a sqlite open survived in `storedDepartures` — the port kept a second answer to one question");
  assert.match(fn, /storeDepartureRows/, "the reader no longer reaches the record through the guards wire");
});

test("PIN: and the module imports none of the sqlite helpers it used to", () => {
  // The imports are the receipt the function body cannot give: a module that
  // still holds `openDynamic` is one edit away from opening the store again.
  const head = code(src("world-movement.mjs").split("\n").slice(0, 60).join("\n"));
  assert.equal(/openDynamic|dynamicDbPath|readMovements|node:fs/.test(head), false,
    `a sqlite helper is still imported into world-movement.mjs:\n${head}`);
});

test("PIN: the departure read goes through `reading`, not a pool of its own", () => {
  const text = src("world2-guards.mjs");
  const fn = text.slice(text.indexOf("export async function storeDepartureRows"));
  const body = code(fn.slice(0, fn.indexOf("\n}")));
  assert.ok(body.length > 50, "the wire moved — this pin is reading the wrong region");
  assert.match(body, /reading\(/, "the departure read opened a road of its own beside the read worker's");
  assert.equal(/new pg\.Pool|[^a-zA-Z]pool\(/.test(body), false, "a second pool was opened for this read");
  assert.match(body, /_ledger' IS NULL/, "the founding era is no longer excluded — it will reach the merge twice");
});

test("PIN: `framesByHandle` no longer opens the dynamic store", () => {
  const text = src("world.mjs");
  const fn = text.slice(text.indexOf("async function framesByHandle"));
  const body = code(fn.slice(0, fn.indexOf("\n}\n")));
  assert.ok(body.length > 100, "the function moved — this pin is reading the wrong region");
  assert.equal(/openDynamicReadOnly\(|store\.close\(\)/.test(body), false,
    `the frame map still opens sqlite — its only reason to was the departure read:\n${body}`);
});
