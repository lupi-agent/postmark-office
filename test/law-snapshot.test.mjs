// law-snapshot.test.mjs — the class layer's in-memory law, refreshed off the
// request path (POS-270, Wright-ruled 2026-09-27: "snapshot").
//
// The ruling's three conditions, each held here:
//   1. THE FLOOR, NAMED: before a snapshot lands, a class read answers from
//      world.db or its floor, and says so. Never a silent empty law.
//   2. ONE CACHE, ONE RELOAD: `reloadLawSnapshot()` is how a process learns the
//      tag moved.
//   3. THE TAG MOVES: the old snapshot serves until the refresh publishes, then
//      the new law serves, and no read ever waits on the refresh.
//
// Against a REAL Postgres (PGlite), because PIN_SQL and LAW_AT_BLESSING_SQL are
// what is under test as much as the swap.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

import { loadPglite, storeFloor } from "./helpers/pglite-store.mjs";
import { writeLaw } from "../world2/tools/law-ingest.mjs";
import { reloadLawSnapshot, lawSnapshot, lawStanding, resetLawSnapshot, LAW_REFRESH_SQLS } from "../src/law-snapshot.mjs";
import { lawSnapshotFromRows, predicatesOf, predicateNodeOf } from "../src/law-classes.mjs";
import { classRoster, classDials, classPredicates, dialNode, dialNumber, departurePace, resetClassRosterCache, ROSTER_FLOOR } from "../src/world-classes.mjs";

const pglite = await loadPglite();
const NO_WORLD_DB = join(tmpdir(), "law-snapshot-test-no-such-world.db");

const S1 = "1".repeat(40), S2 = "2".repeat(40);
const lawAt = (earshot, pace) => [
  { kind: "class", path: "WORLD/marks/the-town/say/mark.md", key: "say", data: { id: "the-town/say", class: "say", dials: {} } },
  { kind: "class", path: "WORLD/marks/the-town/resident/mark.md", key: "resident", data: { id: "the-town/resident", class: "resident", dials: { pace_km_per_crossing: pace } } },
  { kind: "class", path: "WORLD/marks/the-town/bounty/mark.md", key: "bounty", data: { id: "the-town/bounty", class: "bounty", dials: { ask_max_chars: 150, beta: true } } },
  { kind: "predicate", path: "WORLD/marks/the-town/say/earshot/mark.md", key: "say/earshot_m", data: { class: "say", slot: "earshot_m", value: earshot, id: "the-town/say-earshot" } },
];

async function bless(db, n, sha, rows) {
  await writeLaw(db, { lawSha: sha, rows, identities: [], blessed: true });
  await db.query("INSERT INTO settlements (number, tag_sha, published_at) VALUES ($1, $2, now())", [n, sha]);
}

beforeEach(() => {
  resetLawSnapshot();
  resetClassRosterCache();
  process.env.WORLD_STORE_DB = NO_WORLD_DB;   // world.db ABSENT from disk, for every case here
});

test("THE FLOOR: before a snapshot lands, with world.db absent, the roster stands on its floor and says so", () => {
  assert.equal(lawSnapshot(), null);
  const standing = lawStanding();
  assert.equal(standing.source, "floor");
  assert.match(standing.disclosed, /law snapshot has not loaded/);
  const r = classRoster();
  assert.equal(r.source, "floor");
  assert.deepEqual([...r.roster].sort(), [...ROSTER_FLOOR].sort());
  assert.ok(r.disclosed && /floor/.test(r.disclosed), "a floor read must say it is a floor read");
  const d = dialNumber("say", "earshot_m", 150);
  assert.deepEqual(d, { value: 150, read: false, source: "fallback" }, "a dial with no law answers the caller's constant AND says it did");
  assert.equal(departurePace(), null, "no law, no pace — never an invented one");
});

test("a failed refresh leaves the floor standing and names why", async () => {
  const r = await reloadLawSnapshot({ query: async () => { throw new Error("connection refused"); } });
  assert.equal(r.changed, false);
  assert.equal(lawSnapshot(), null);
  assert.match(lawStanding().disclosed, /connection refused/);
});

test("with world.db ABSENT, the class layer answers from the store once the snapshot lands", async (t) => {
  if (pglite.reason) return t.skip(pglite.reason);
  const db = await storeFloor(pglite);
  await bless(db, 1, S1, lawAt(60, 12));
  const r = await reloadLawSnapshot({ query: (sql, p) => db.query(sql, p) });
  assert.equal(r.changed, true);
  assert.deepEqual(lawStanding(), { source: "law", settlement: 1, sha: S1, disclosed: null });

  const roster = classRoster();
  assert.equal(roster.source, "law");
  assert.deepEqual([...roster.roster].sort(), ["bounty", "resident", "say"]);
  assert.deepEqual(classPredicates("say"), { earshot_m: 60 });
  assert.deepEqual(dialNumber("say", "earshot_m", 150), { value: 60, read: true, source: "record" });
  assert.equal(dialNode("say", "earshot_m"), "the-town/say-earshot");
  assert.deepEqual(classDials("bounty"), { ask_max_chars: 150, beta: true });
  assert.equal(departurePace(), 12);
  await db.close();
});

test("THE TAG MOVES: the old law serves until the refresh publishes, then the new — no read waits", async (t) => {
  if (pglite.reason) return t.skip(pglite.reason);
  const db = await storeFloor(pglite);
  await bless(db, 1, S1, lawAt(60, 12));
  await reloadLawSnapshot({ query: (sql, p) => db.query(sql, p) });
  assert.equal(dialNumber("say", "earshot_m", 150).value, 60);

  await bless(db, 2, S2, lawAt(90, 15));

  // Hold the refresh at its big query, so there is a window in which the store
  // has the new law and this process has not published it.
  let release;
  const gate = new Promise((r) => { release = r; });
  let heldAtLaw = false;
  const query = async (sql, p) => {
    if (sql === LAW_REFRESH_SQLS.law) { heldAtLaw = true; await gate; }
    return db.query(sql, p);
  };
  const pending = reloadLawSnapshot({ query });
  while (!heldAtLaw) await new Promise((r) => setImmediate(r));

  // Mid-refresh: every read answers the OLD law, whole, and none of them waits.
  let slowest = 0;
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    const v = dialNumber("say", "earshot_m", 150).value;
    const pace = departurePace();
    slowest = Math.max(slowest, performance.now() - t0);
    assert.equal(v, 60, "a read mid-refresh saw the new law before it was published");
    assert.equal(pace, 12, "a read mid-refresh saw half of the new law");
  }
  assert.equal(lawStanding().settlement, 1);
  assert.ok(slowest < 50, `a class read took ${slowest.toFixed(1)} ms mid-refresh — it waited on something`);

  release();
  const r = await pending;
  assert.equal(r.changed, true);
  assert.equal(dialNumber("say", "earshot_m", 150).value, 90);
  assert.equal(departurePace(), 15);
  assert.deepEqual(lawStanding(), { source: "law", settlement: 2, sha: S2, disclosed: null });
  await db.close();
});

test("an unmoved tag costs one small query and loads nothing; a blessing not yet ingested is disclosed", async (t) => {
  if (pglite.reason) return t.skip(pglite.reason);
  const db = await storeFloor(pglite);
  await bless(db, 1, S1, lawAt(60, 12));
  const asked = [];
  const query = (sql, p) => { asked.push(sql === LAW_REFRESH_SQLS.law ? "law" : sql === LAW_REFRESH_SQLS.pin ? "pin" : "other"); return db.query(sql, p); };
  await reloadLawSnapshot({ query });
  asked.length = 0;
  const r = await reloadLawSnapshot({ query });
  assert.equal(r.changed, false);
  assert.deepEqual(asked, ["pin"], "a tick with nothing new must not reload the law");

  // S2 is blessed; its law has not been ingested. The pin stays, and says so.
  await db.query("INSERT INTO settlements (number, tag_sha, published_at) VALUES (2, $1, now())", [S2]);
  await reloadLawSnapshot({ query });
  assert.equal(lawStanding().settlement, 1);
  assert.match(lawStanding().disclosed, /S2 is blessed but its law is not ingested yet/);
  assert.equal(classRoster().disclosed, lawStanding().disclosed, "the roster carries the same disclosure");
  await db.close();
});

test("concurrent reloads share one refresh", async (t) => {
  if (pglite.reason) return t.skip(pglite.reason);
  const db = await storeFloor(pglite);
  await bless(db, 1, S1, lawAt(60, 12));
  let pins = 0;
  const query = (sql, p) => { if (sql === LAW_REFRESH_SQLS.pin) pins++; return db.query(sql, p); };
  const [a, b] = [reloadLawSnapshot({ query }), reloadLawSnapshot({ query })];
  assert.equal(a, b, "two callers must get the same in-flight refresh");
  await a;
  assert.equal(pins, 1);
  await db.close();
});

test("two children naming one slot: the value is the LAST in the loader's order, the node the FIRST — world.db's own answer", () => {
  // world.db: classPredicates loops the join and keeps the last; dialNode takes
  // `LIMIT 1`, the first. The rows arrive sorted by KEY from Postgres, which is
  // neither order, so `ord` (the loader's) is what decides.
  const row = (id, value, ord) => ({ number: 1, tag_sha: S1, newest: 1, kind: "predicate", key: `vehicle/aboard/${id}`, data: { class: "vehicle", slot: "aboard", value, id, ord } });
  const snap = lawSnapshotFromRows([
    { number: 1, tag_sha: S1, newest: 1, kind: "class", key: "vehicle", data: { class: "vehicle" } },
    row("the-town/z-first", "first", 3), row("the-town/a-second", "second", 9),
  ]);
  assert.deepEqual(predicatesOf(snap, "vehicle"), { aboard: "second" });
  assert.equal(predicateNodeOf(snap, "vehicle", "aboard"), "the-town/z-first");
});

test("a caller naming a world.db still reads THAT file, snapshot or not", async (t) => {
  if (pglite.reason) return t.skip(pglite.reason);
  const db = await storeFloor(pglite);
  await bless(db, 1, S1, lawAt(60, 12));
  await reloadLawSnapshot({ query: (sql, p) => db.query(sql, p) });
  const r = classRoster({ worldDb: NO_WORLD_DB });
  assert.equal(r.source, "floor", "an explicit worldDb is the fixture seam; the snapshot must not answer for it");
  await db.close();
});

test("THE HOOK REACHES THE WORKERS: the refresher calls onChange once per published move, never on an unmoved tick", async (t) => {
  if (pglite.reason) return t.skip(pglite.reason);
  const { startLawRefresher } = await import("../src/law-snapshot.mjs");
  const db = await storeFloor(pglite);
  await bless(db, 1, S1, lawAt(60, 12));
  const told = [];
  let ticks = 0;
  const query = (sql, p) => { if (sql === LAW_REFRESH_SQLS.pin) ticks++; return db.query(sql, p); };
  startLawRefresher({ intervalMs: 20, query, onChange: (standing) => told.push(standing.settlement) });
  const until = async (pred) => { for (let i = 0; i < 200 && !pred(); i++) await new Promise((r) => setTimeout(r, 10)); };
  await until(() => told.length === 1);
  assert.deepEqual(told, [1], "the first publish announces");
  const at = ticks;
  await until(() => ticks >= at + 3);
  assert.deepEqual(told, [1], "an unmoved tag announces nothing");
  await bless(db, 2, S2, lawAt(90, 12));
  await until(() => told.length === 2);
  assert.deepEqual(told, [1, 2], "the blessing moved, so the workers are told");
  resetLawSnapshot();
  await db.close();
});
