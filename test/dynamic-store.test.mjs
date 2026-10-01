// dynamic-store.test.mjs — the third database, and the class mark it reads its
// law from.
//
// The falsifiers here, each written so it CAN fail:
//
//   the dial follows the mark   a dial is CHANGED in a fixture store and the
//                               office's behaviour has to move with it. This is
//                               the whole claim of "the class mark is the one
//                               home for a constant": if the number were still
//                               being read out of the code, every one of these
//                               would pass with the old value.
//   the gate discloses          a store with no class mark, no dials, or a
//                               FAILED stamp falls back to the office's own
//                               constants AND SAYS SO, per dial. Silence is the
//                               failure the deriver's law exists to prevent.
//   store-canon, not an index   a rebuild of the derivable half leaves the
//                               un-derivable half alone. world.db may be deleted
//                               at any moment; this one may not.
//   the refusal is not an outage a derivation that cannot run leaves every
//                               existing row exactly where it was.
//
//   node --test test/dynamic-store.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  fixtureWorldClone, fixtureWorldDb, mainShaOf, scratchDir,
  crossingStart, DEFAULT_DIALS,
} from "./dynamic-fixture.mjs";
import { NO_WORLD_DB, clearWorld } from "./helpers/world-rows.mjs";

const scratch = scratchDir("store");
const repo = fixtureWorldClone({ label: "store" });
// Best-effort: Windows keeps a sqlite WAL sidecar mapped for a moment after the
// last handle closes, and a temp directory that survives a test run is litter,
// not a finding. Failing the suite on it would report a cleanup as a defect.
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
after(() => { sweep(scratch); sweep(repo); });

const SHA = mainShaOf(repo);
const worldDbPath = join(scratch, "world.db");
const dynPath = join(scratch, "dynamic.db");

process.env.WORLD_CLONE = repo;
// The office reads the world graph snapshot (POS-270 lane W 3a): buildWorld()
// publishes the fixture as one, and world.db's path points nowhere.
process.env.WORLD_STORE_DB = NO_WORLD_DB;
process.env.WORLD_DYNAMIC_DB = dynPath;
delete process.env.WORLD_EMISSIONS;

// Three walkers: one standing still, one who has arrived, one still under way at
// the instant every test asks about. The mid-walk one is load-bearing — a
// derivation that ignored the clock would still get the other two right.
const T0 = crossingStart(100);
const NOW = crossingStart(100) + 6 * 3600 * 1000;   // half a crossing in
const DEPARTURES = [
  { at: new Date(T0).toISOString(), actor: "wright", from: { x: 0, y: 0 }, toward: { x: 0, y: 0 }, crossing: 100, line_no: 1 },
  { at: new Date(T0).toISOString(), actor: "iris", from: { x: 0, y: 0 }, toward: { x: 100, y: 0 }, crossing: 100, to: "the-town/quay", line_no: 2 },
  { at: new Date(T0).toISOString(), actor: "jetto", from: { x: 0, y: 0 }, toward: { x: 30000, y: 0 }, crossing: 100, line_no: 3 },
  // the vessel walks the ledger too, and is never an entity
  { at: new Date(T0).toISOString(), actor: "the-post-office", from: { x: 0, y: 0 }, toward: { x: 500, y: 0 }, crossing: 100, line_no: 4 },
  // wright walks again later — latest wins, and it must be THIS one that governs
  { at: new Date(T0 + 3600_000).toISOString(), actor: "wright", from: { x: 0, y: 0 }, toward: { x: 200, y: 200 }, crossing: 100.0833, line_no: 5 },
];

const buildWorld = (o = {}) => fixtureWorldDb(worldDbPath, { sha: SHA, departures: DEPARTURES, ...o });

const fresh = async () => {
  if (existsSync(dynPath)) rmSync(dynPath, { force: true });
  for (const s of ["-wal", "-shm"]) if (existsSync(dynPath + s)) rmSync(dynPath + s, { force: true });
  const m = await import("../src/dynamic-store.mjs");
  m.resetClassCache();
  return m;
};

beforeEach(async () => {
  buildWorld();
  const { resetClassCache } = await import("../src/dynamic-store.mjs");
  resetClassCache();
});

// ── 1. the class mark is the one home for a constant ─────────────────────────

test("the dials come from the class mark, named as such, per dial", async () => {
  const { soundClass } = await fresh();
  const cls = soundClass({ repo });
  assert.equal(cls.gate.status, "PRESENT");
  assert.deepEqual(cls.dials, DEFAULT_DIALS);
  assert.deepEqual(cls.sources, {
    radius_m: "class-mark", hearing_ttl_min: "class-mark",
    flood_cap: "class-mark", thread_close_min: "class-mark",
  });
  assert.deepEqual(cls.disclosed, []);
  assert.equal(cls.version, 1);
  assert.equal(cls.store.fresh, true, "the fixture store is hydrated at the sha main points at");
});

test("CHANGE A DIAL IN THE STORE AND THE OFFICE FOLLOWS IT — the falsifier", async () => {
  const { soundClass, soundMs, resetClassCache } = await fresh();
  const before = soundMs(soundClass({ repo }));
  assert.equal(before.earshotM, 60);
  assert.equal(before.ttlMs, 5 * 60_000);
  assert.equal(before.closeMs, 30 * 60_000);

  // The town rules a louder voice and a shorter memory. Nothing in the office
  // changes; only the class mark does.
  buildWorld({ dials: { radius_m: 250, hearing_ttl_min: 2, flood_cap: 3, thread_close_min: 7 }, classVersion: 2 });
  resetClassCache();

  const after = soundMs(soundClass({ repo }));
  assert.equal(after.earshotM, 250, "earshot must be the class mark's, not the code's 60");
  assert.equal(after.ttlMs, 2 * 60_000);
  assert.equal(after.closeMs, 7 * 60_000);
  assert.equal(after.floodCap, 3);
  assert.equal(soundClass({ repo }).version, 2);
  // …and the office notices that its own constants now disagree with the law.
  const drift = soundClass({ repo }).drift.map((d) => d.dial).sort();
  assert.deepEqual(drift, ["flood_cap", "hearing_ttl_min", "radius_m", "thread_close_min"]);
});

test("a partial class mark hands over what it declares and DISCLOSES the rest", async () => {
  const { soundClass, resetClassCache } = await fresh();
  buildWorld({ dials: { radius_m: 90 } });
  resetClassCache();
  const cls = soundClass({ repo });
  assert.equal(cls.gate.status, "PARTIAL");
  assert.equal(cls.dials.radius_m, 90, "the declared dial governs");
  assert.equal(cls.dials.flood_cap, DEFAULT_DIALS.flood_cap, "the undeclared one falls back");
  assert.equal(cls.sources.radius_m, "class-mark");
  assert.equal(cls.sources.flood_cap, "code-fallback");
  assert.deepEqual(cls.disclosed.sort(), ["flood_cap", "hearing_ttl_min", "thread_close_min"]);
});

test("no class mark, no dials, a FAILED store, no store at all — each falls back and NAMES why", async () => {
  const { soundClass, resetClassCache } = await fresh();
  const reasons = [];

  for (const [label, opts] of [
    ["class-mark-absent", { withSoundClass: false }],
    ["class-dials-absent", { dials: null }],
    ["store-failed", { status: "FAILED: empty tables — nodes" }],
  ]) {
    rmSync(worldDbPath, { force: true });
    clearWorld();
    buildWorld(opts);
    resetClassCache();
    const cls = soundClass({ repo });
    reasons.push([label, cls.gate.reason]);
    assert.deepEqual(cls.dials, DEFAULT_DIALS, `${label}: the office's own constants stand in`);
    assert.deepEqual(cls.disclosed.sort(), Object.keys(DEFAULT_DIALS).sort(), `${label}: every dial is disclosed`);
  }
  rmSync(worldDbPath, { force: true });
  clearWorld();
  resetClassCache();
  const gone = soundClass({ repo });
  reasons.push(["no-store", gone.gate.reason]);
  assert.deepEqual(gone.dials, DEFAULT_DIALS);

  assert.deepEqual(reasons, [
    ["class-mark-absent", "class-mark-absent"],
    ["class-dials-absent", "class-dials-absent"],
    // A failed hydration is never published (the store is never given a failed
    // snapshot), so what the office sees after one is NO world, said as such.
    ["store-failed", "store-absent"],
    ["no-store", "store-absent"],
  ], "every fallback says which input was missing — no silent substitution anywhere");
});

test("a STALE store still hands over the class mark's dials, and discloses the staleness", async () => {
  const { soundClass, resetClassCache } = await fresh();
  buildWorld({ sha: "f".repeat(40), dials: { ...DEFAULT_DIALS, radius_m: 111 } });
  resetClassCache();
  const cls = soundClass({ repo });
  // Deliberately NOT Stage 1's rule. A dial has no fold to match byte-for-byte,
  // and the alternative to a slightly old class mark is a strictly older copy of
  // the same number with no commit attached at all.
  assert.equal(cls.dials.radius_m, 111, "the town's law governs even one commit behind");
  assert.equal(cls.sources.radius_m, "class-mark");
  assert.equal(cls.store.fresh, false, "and the staleness is on the surface, not hidden");
});

// ── 2. the store itself ──────────────────────────────────────────────────────

test("the schema is created once and a foreign schema version REFUSES rather than migrating", async () => {
  const { openDynamic, putMeta } = await fresh();
  const db = openDynamic(dynPath);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='schema_version'").get().value, "1");
  putMeta(db, "schema_version", "99");
  db.close();
  assert.throws(() => openDynamic(dynPath), /schema 99/,
    "this file holds state nothing else holds; opening it under the wrong schema is how it gets lost silently");
});

test("the flag is off by default and is read per call, never latched", async () => {
  const { emissionsEnabled } = await fresh();
  assert.equal(emissionsEnabled(), false);
  process.env.WORLD_EMISSIONS = "1";
  assert.equal(emissionsEnabled(), true);
  delete process.env.WORLD_EMISSIONS;
  assert.equal(emissionsEnabled(), false);
});

// ── 3. entities: the walk-ledger derivation ──────────────────────────────────

// The entities TABLE went with dynamic.db (POS-269): nothing reads it, and the
// save derives entities from the record at its own clock. What these tests
// held of the derivation still holds, and is asked of the derivation itself —
// `readDepartureEvents` (the ledger out of the store, with its gates and its
// freshness) and `deriveEntities` (the pure half). The table's own tests (no
// parent column, a refused refresh leaves the rows, dynamic:rebuild) retired
// with it.

const derive = async () => {
  const { readDepartureEvents, deriveEntities, walkModule } = await import("../src/dynamic-entities.mjs");
  const read = readDepartureEvents({ repo });
  return { read, rows: read.refused ? null : deriveEntities(read.events, NOW, await walkModule({ repo })) };
};

test("entities derive from the ledger: latest wins, the vessel is not one, and the record travels", async () => {
  await fresh();
  const { read, rows } = await derive();
  assert.equal(read.refused, undefined);

  assert.deepEqual(rows.map((e) => e.handle), ["iris", "jetto", "wright"],
    "the-post-office walks the ledger and is never an entity");

  const wright = rows.find((e) => e.handle === "wright");
  assert.deepEqual(wright.provenance.departure.toward, { x: 200, y: 200 },
    "LATEST WINS — the second departure governs, and the first is not blended with it");

  const jetto = rows.find((e) => e.handle === "jetto");
  assert.equal(jetto.provenance.arrived, false, "30 km at 15 km/crossing is still under way half a crossing in");
  assert.ok(jetto.x > 0 && jetto.x < 30000, `mid-walk position should be on the leg, got ${jetto.x}`);
  assert.ok(jetto.provenance.departure.from && jetto.provenance.departure.toward,
    "the derivation's INPUT rides with its output — coordinates alone cannot be carried to another clock");
  assert.equal(jetto.derived_at, new Date(NOW).toISOString(), "and so does the instant it was evaluated at");
});

test("a store whose ledger gate is absent, or no store at all, REFUSES by name — an empty table by absence is not a still town", async () => {
  await fresh();
  // the store's own walk-ledger gate was ABSENT: its events table is empty by
  // absence, not by stillness, and deriving from that would empty the town
  buildWorld({ departures: [], ledgerGate: "ABSENT" });
  assert.equal((await derive()).read.refused.gate, "walk-ledger");

  rmSync(worldDbPath, { force: true });
  clearWorld();
  assert.equal((await derive()).read.refused.gate, "world-store");
});

test("a commit that did not touch the ledger is NOT stale — freshness is about the ledger, not about main", async () => {
  await fresh();
  const { execFileSync } = await import("node:child_process");

  // Exactly what the crossing-save's own commit does: advance main without
  // touching a single departure. Checking sha equality here would report the
  // store stale forever and make every save rewrite itself to say so.
  writeFileSync(join(repo, "STATE-ish.txt"), "a commit that is not movement\n");
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  g("add", "-A");
  g("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "not a departure");

  const { read } = await derive();
  assert.equal(read.refused, undefined);
  assert.equal(read.fresh, true, "the walk ledger has not moved, so nothing about this derivation is behind");
  assert.deepEqual(read.disclosed, []);

  g("reset", "--hard", "-q", "HEAD~1");
});

test("a ledger that HAS moved discloses rather than refusing — missing movement is not wrong movement", async () => {
  await fresh();
  buildWorld({ sha: "a".repeat(40) });
  const { read, rows } = await derive();
  assert.equal(read.refused, undefined);
  assert.equal(rows.length, 3, "and it still derives");
  assert.equal(read.fresh, false);
  assert.match(read.disclosed[0], /walk-ledger-moved/);
});

test("a dynamic store is not deleted and rebuilt like world.db — the health surface says which it is", async () => {
  await fresh();
  const { dynamicHealth, openDynamic } = await import("../src/dynamic-store.mjs");
  openDynamic(dynPath).close();

  const h = dynamicHealth({ repo });
  assert.equal(h.enabled, false);
  assert.equal(h.db.present, true);
  assert.equal(h.db.logged_through, null, "nothing has been crystallized yet, and the panel says so");
  assert.equal(h.sound_class.gate.status, "PRESENT");
  assert.deepEqual(h.sound_class.disclosed_fallbacks, []);
});

test("a world that will not load discloses instead of throwing", async () => {
  const { soundClass, resetClassCache } = await fresh();
  // Rows the one construction refuses are never published: what stands is NO
  // world, and speech must still work.
  writeFileSync(worldDbPath, "this is not a database");
  clearWorld();
  resetClassCache();
  const cls = soundClass({ repo });
  assert.equal(cls.gate.status, "ABSENT");
  assert.equal(cls.gate.reason, "store-absent");
  assert.deepEqual(cls.dials, DEFAULT_DIALS, "speech must not be able to fail because an index is corrupt");
});
