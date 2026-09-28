// position-projection.test.mjs — the projection equals the derivation (POS-264).
//
// ── WHAT IS ON TRIAL ────────────────────────────────────────────────────────
//
// `src/position-projection.mjs` keeps ONE departure per resident — the
// governing one — where every door used to re-read both eras of the record.
// The claim is that nothing a door says changes, because the engine itself
// reads nothing but the governing record (`walk.mjs § currentDeparture`, the
// last record for a handle; `where-is.mjs § whereIs`, that record or the fold).
//
// So the falsifier is a REPLAY. Acts are built one at a time with the live
// `walkEntry`, filed into a fixture store exactly as `normalizeRow` writes them
// and `pg` hands them back, and after every one:
//
//   RECORD      the projection, kept current only by `record(recordOfMovement)`
//               in the same step, holds byte for byte what a fresh derivation
//               (`departuresAcrossEras` over the real ledger + the store) folds to.
//   PLACED      `everyonePlaced` over the projection equals `everyonePlaced`
//               over the whole record, at instants mid-walk and after arrival.
//   PRESENCE    `positionsAt` reading the projection equals `positionsAt`
//               reading the entities table + the store.
//   HEARING     `heardFromV2` over the governing record with no store read
//               equals `heardFromV2` over both eras, per voice.
//   NEAR        the grid's `near` equals a scan of every row, at instants that
//               carry a walker across cells and into arrival.
//   DOOR        `/world/walkers` answers the same with the flag on as off,
//               at an instant with walkers on the road and again after they
//               have arrived.
//   KEPT        (POS-284) the placement kept per epoch answers what
//               `everyonePlaced` answers at every instant, having placed the
//               whole town once and only the walkers after; `positionsAt` over
//               it answers what it answers without it.
//
// ── THE FLIP (run after the commit; the red line goes in the report) ─────────
//
// In `src/position-projection.mjs § governingOf`, keep each handle's FIRST
// record instead of its last (`if (!out.has(d.handle)) out.set(...)`). RECORD,
// PLACED, PRESENCE and DOOR go red: a resident who walked twice is answered from
// the leg they superseded. HEARING stays green under that flip, and that is the
// POS-247 fact it pins rather than a gap: no walk record can frame a voice, so
// which record the fold is handed cannot move one.
//
// POS-284's flip: in `createPlacement § rows`, return the kept rows without
// re-placing the drifting (`if (!k.drifting.size) return out;` →
// `return out;`). KEPT and the DOOR's second instant go red: a walker is
// answered where they stood when the town was first placed.
//
// Run: WORLD_CLONE=<world clone> node --test test/position-projection.test.mjs

import { test, before, after, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { WORLD_CLONE } from "../src/world-store.mjs";
import { useGuardReader } from "../src/world2-guards.mjs";
import { normalizeRow } from "../src/world-journal.mjs";
import { worldToolModule } from "../src/dynamic-entities.mjs";
import { openDynamic } from "../src/dynamic-store.mjs";
import { positionsAt } from "../src/dynamic-presence.mjs";
import { everyonePlaced } from "../src/positions.mjs";
import { heardFromV2 } from "../src/world-movement.mjs";
import {
  createPlacement, createPositionGrid, createPositionProjection, governingOf, recordOfMovement,
} from "../src/position-projection.mjs";
import { atCrossing, departure, fixtureMarks, makeWorldClone } from "./movement-fixture.mjs";

const FLAGS = ["WORLD_MOVEMENT_V2", "WORLD2_PG", "WORLD2_PG_URL", "WORLD_POSITIONS"];
const was = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
before(() => {
  process.env.WORLD_MOVEMENT_V2 = "1";
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://position-projection/none";
  delete process.env.WORLD_POSITIONS;
});
after(() => { for (const k of FLAGS) if (was[k] == null) delete process.env[k]; else process.env[k] = was[k]; });

const haveClone = existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"));
const needsClone = (t) => (haveClone ? false : (t.skip(`needs the world clone at ${WORLD_CLONE}`), true));

// ── the fixture store: acts as `pg` hands them over ──────────────────────────

const STORE = [];
let restore = null;
const install = () => {
  restore = useGuardReader(async (fn) => fn({
    query: async (sql, params) => {
      if (!/FROM acts/i.test(String(sql))) return { rows: [] };
      const actions = params?.[0] ?? [];
      return { rows: STORE.filter((r) => actions.includes(r.action)) };
    },
  }));
};
afterEach(() => { if (restore) { restore(); restore = null; } });

/** One walk act, built by the live builder and filed the way the pen files it. */
async function fileWalk(movement) {
  const { walkEntry } = await import("../src/world.mjs");
  const row = normalizeRow(walkEntry({
    crossing: movement.crossing, who: movement.actor, targetMarkId: movement.toMark,
    stampAt: null, witnesses: null, from: movement.from, toward: movement.toward,
    pace: movement.pace, targetExtent: movement.within, household: null,
    writtenAt: movement.at, declaredBy: movement.actor,
  }));
  STORE.push({
    id: 50_000 + STORE.length, at: new Date(row.written_at), crossing: String(row.crossing),
    actor: row.actor, action: row.action, payload: JSON.parse(row.payload),
  });
}

// ── the replay ───────────────────────────────────────────────────────────────
//
// Twenty-four walks by eight residents. `wright` and `rei` have founding-era
// ledger lines their walks here supersede; `home-body` holds ground and walks
// off it; the rest first move in era two. Legs are short and long, with and
// without a target extent, at the town's pace and at a vessel's.
const B = Date.parse("2026-09-26T12:00:00.000Z");
const WHO = ["wright", "rei", "home-body", "new-a", "new-b", "new-c", "new-d", "new-e"];
function movementAt(i, walk) {
  const actor = WHO[(i * 5) % WHO.length];
  const atMs = B + i * 90_000;
  const from = { x: 100 * (i % 7), y: -80 * (i % 5) };
  const toward = i % 4 === 0 ? { ...from } : { x: from.x + 40 + 37 * i, y: from.y - 25 * (i % 3) };
  return {
    actor, from, toward, crossing: walk.fractionalCrossing(atMs), at: new Date(atMs).toISOString(),
    within: i % 3 === 0 ? { w: 20, h: 12 } : null, toMark: i % 3 === 0 ? `the-town/stop-${i}` : null,
    declaredBy: actor, pace: i % 5 === 0 ? 40 : null,
  };
}

const WORLD = {
  marks: [{ id: "the-town/the-quay", at: { x: -35, y: 12 }, extent: { w: 20, h: 20 } }],
  parcels: [{ id: "home-body/ground", household: "home-body", at: { x: 500, y: 500 }, extent: { w: 30, h: 30 } },
            { id: "still-one/ground", household: "still-one", at: { x: 640, y: -220 }, extent: { w: 30, h: 30 } }],
  households: {},
};
const ROLL = ["porch-sitter"];

test("RECORD + PLACED: the projection, kept by in-step records alone, equals the derivation after every act", async (t) => {
  if (needsClone(t)) return;
  install();
  STORE.length = 0;
  const { departuresAcrossEras } = await import("../src/world.mjs");
  const walk = await worldToolModule("walk.mjs", { repo: WORLD_CLONE });
  const where = await worldToolModule("where-is.mjs", { repo: WORLD_CLONE });
  const LATE = B + 48 * 3600_000;

  // Born once, from the derivation; never rebuilt again during the replay.
  const projection = createPositionProjection({
    rebuild: (atMs) => departuresAcrossEras(WORLD_CLONE, { atMs }), maxAgeMs: Infinity,
  });
  await projection.departures();

  for (let i = 0; i < 24; i++) {
    const m = movementAt(i, walk);
    await fileWalk(m);
    assert.equal(projection.record(recordOfMovement(m)), true, "a built projection takes the record");

    const derived = await departuresAcrossEras(WORLD_CLONE, { atMs: LATE });
    assert.deepEqual(await projection.departures(), [...governingOf(derived.departures).values()],
      `after act ${i} (${m.actor}) the projection is not what the record folds to`);

    for (const atMs of [Date.parse(m.at) + 20_000, Date.parse(m.at) + 3600_000, LATE]) {
      const at = walk.fractionalCrossing(atMs);
      assert.deepEqual(
        everyonePlaced({ world: WORLD, departures: await projection.departures(), at, where, roll: ROLL }),
        everyonePlaced({ world: WORLD, departures: derived.departures, at, where, roll: ROLL }),
        `after act ${i}, at ${new Date(atMs).toISOString()}: the projection places someone the record does not`);
    }
  }
  // The replay must actually have superseded something, or PLACED is vacuous.
  const derived = await departuresAcrossEras(WORLD_CLONE, { atMs: LATE });
  assert.ok(derived.departures.length > governingOf(derived.departures).size + 20,
    "the record should hold many superseded legs — the fold has nothing to prove otherwise");
});

test("a walk recorded while a rebuild is reading is not lost to it", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const p = createPositionProjection({
    rebuild: async () => { await gate; return { departures: [{ handle: "a", iso: "1" }], disclosed: [], eras: ["store"] }; },
  });
  const reading = p.departures();
  p.record({ handle: "a", iso: "2" });   // written after the rebuild began reading
  release();
  await reading;
  assert.deepEqual(await p.departures(), [{ handle: "a", iso: "2" }]);
});

test("PRESENCE: positionsAt over the projection equals positionsAt over the entities table + the store", async (t) => {
  if (needsClone(t)) return;
  install();
  const { departuresAcrossEras } = await import("../src/world.mjs");
  const walk = await worldToolModule("walk.mjs", { repo: WORLD_CLONE });
  const where = await worldToolModule("where-is.mjs", { repo: WORLD_CLONE });
  if (!STORE.length) for (let i = 0; i < 24; i++) await fileWalk(movementAt(i, walk));

  const LATE = B + 48 * 3600_000;
  const derived = await departuresAcrossEras(WORLD_CLONE, { atMs: LATE });
  const ledger = derived.departures.filter((d) => d.source !== "store");
  const stored = derived.departures.filter((d) => d.source === "store");

  // The entities table as a refresh leaves it: each ledger resident's governing
  // leg, in the store's column names.
  const dir = mkdtempSync(join(tmpdir(), "positions-presence-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = openDynamic(join(dir, "dynamic.db"));
  const put = db.prepare("INSERT INTO entities (handle, x, y, derived_at, provenance) VALUES (?, ?, ?, ?, ?)");
  for (const [handle, d] of governingOf(ledger)) {
    put.run(handle, d.toward.x, d.toward.y, new Date(B).toISOString(), JSON.stringify({ departure: {
      iso: d.iso, from: d.from, toward: d.toward, at: d.at, within: d.targetExtent, to: d.targetMarkId, pace: d.pace } }));
  }
  const projected = [...governingOf(derived.departures).values()];
  // KEPT, through the presence layer: the hook the office hands it.
  const kept = createPlacement();
  const placed = (args) => kept.rows({ key: "one-epoch", at: args.at, place: (only, at) => everyonePlaced({ ...args, at, only }) });
  for (const atMs of [B + 30_000, B + 20 * 60_000, LATE]) {
    const table = positionsAt(db, atMs, walk, null, { world: WORLD, where, stored, roll: ROLL });
    assert.deepEqual(
      positionsAt(db, atMs, walk, null, { world: WORLD, where, projected, roll: ROLL }),
      table,
      `at ${new Date(atMs).toISOString()}: presence over the projection disagrees with presence over the table`);
    assert.deepEqual(
      positionsAt(db, atMs, walk, null, { world: WORLD, where, projected, roll: ROLL, placed }),
      table,
      `at ${new Date(atMs).toISOString()}: presence over the kept placement disagrees with presence over the table`);
  }
  db.close();
});

test("KEPT: the placement answers what everyonePlaced answers at every instant, placing the town once", async (t) => {
  if (needsClone(t)) return;
  install();
  const { departuresAcrossEras } = await import("../src/world.mjs");
  const walk = await worldToolModule("walk.mjs", { repo: WORLD_CLONE });
  const where = await worldToolModule("where-is.mjs", { repo: WORLD_CLONE });
  if (!STORE.length) for (let i = 0; i < 24; i++) await fileWalk(movementAt(i, walk));
  const LATE = B + 48 * 3600_000;
  const departures = [...governingOf((await departuresAcrossEras(WORLD_CLONE, { atMs: LATE })).departures).values()];

  const asked = [];
  const kept = createPlacement();
  const rows = (key, at) => kept.rows({ key, at, place: (only, a) => {
    asked.push(only ? [...only] : null);
    return everyonePlaced({ world: WORLD, departures, at: a, where, roll: ROLL, only });
  } });

  // From the first leg's start to long after the last arrival, a minute apart
  // where walkers are on the road.
  const instants = [];
  for (let ms = B; ms <= B + 40 * 60_000; ms += 60_000) instants.push(ms);
  instants.push(B + 3600_000, LATE);
  let moving = 0;
  for (const atMs of instants) {
    const at = walk.fractionalCrossing(atMs);
    const want = everyonePlaced({ world: WORLD, departures, at, where, roll: ROLL });
    moving += want.filter((r) => r.moving).length;
    assert.deepEqual(rows("epoch-1", at), want, `at ${new Date(atMs).toISOString()} the kept placement disagrees with the derivation`);
  }
  assert.ok(moving > 10, "nobody was on the road at the instants asked — the drifting path is not exercised");
  assert.equal(asked.filter((a) => a === null).length, 1, "the whole town is placed once per key");
  const total = everyonePlaced({ world: WORLD, departures, at: walk.fractionalCrossing(B), where, roll: ROLL }).length;
  assert.ok(asked.slice(1).every((a) => a.length < total), "after the first answer only the walking are placed again");
  assert.deepEqual(kept.census(), [{ rows: total, drifting: 0 }], "everyone has arrived by LATE and is kept");

  // A new key (a recorded walk moves the epoch) places the town afresh.
  rows("epoch-2", walk.fractionalCrossing(LATE));
  assert.equal(asked.filter((a) => a === null).length, 2);
});

test("HEARING: heardFromV2 over the governing record, no store read, equals heardFromV2 over both eras", async () => {
  const clone = makeWorldClone();
  try {
    const W = { marks: fixtureMarks() };
    const REPO = { repo: clone.dir };
    STORE.length = 0;
    install();
    // The speaker's history: walked to the quay, then onto the far shore after
    // speaking. The store carries the later leg; the ledger half the earlier.
    const early = departure({ handle: "speaker", from: { x: 60, y: 0 }, toward: { x: 2, y: 3 }, at: 10.0 });
    const late = departure({ handle: "speaker", from: { x: 2, y: 3 }, toward: { x: 3900, y: 0 }, at: 10.6 });
    await fileWalk({ actor: "speaker", from: late.from, toward: late.toward, crossing: late.at, at: late.iso, within: null, toMark: null, pace: null });
    const full = [early, { ...late, source: "store" }];
    const governing = [...governingOf(full).values()];
    const voices = [
      { handle: "speaker", at: atCrossing(10.52), x: 800, y: 0, text: "on her deck, under way" },
      { handle: "speaker", at: atCrossing(10.52), x: 2500, y: 400, text: "ashore" },
      { handle: "speaker", at: atCrossing(10.7), x: 2100, y: 0, text: "after the second leg" },
      { handle: "nobody-walked", at: atCrossing(10.53), x: 810, y: 1, text: "a stranger on deck" },
    ];
    let differing = 0;
    for (const v of voices) {
      for (const atMs of [atCrossing(10.55), atCrossing(10.8)]) {
        const derived = await heardFromV2(v, W, { ...REPO, atMs,
          recordsOf: async (h) => full.filter((d) => d.handle === h) });
        const projected = await heardFromV2(v, W, { ...REPO, atMs,
          recordsOf: async (h) => governing.filter((d) => d.handle === h), storeRecordsOf: async () => [] });
        assert.deepEqual(projected, derived, `"${v.text}" heard at ${atMs}: the projection moved the voice`);
        if (derived) differing += 1;
      }
    }
    assert.ok(differing > 0, "no voice was relocated at all — the fixture proves nothing about the deck");
  } finally { clone.cleanup(); }
});

test("NEAR: the grid answers what a scan of every row answers, as walkers cross cells and arrive", async () => {
  // Rows from a tiny clock-driven world: two walkers on long legs, a crowd at
  // rest straddling cell edges, one carried.
  const legs = {
    walker: { from: { x: -300, y: 0 }, toward: { x: 300, y: 0 }, t0: 0, t1: 600 },
    diag: { from: { x: 0, y: -200 }, toward: { x: 130, y: 130 }, t0: 100, t1: 400 },
  };
  const still = Array.from({ length: 40 }, (_, i) => ({ handle: `still-${String(i).padStart(2, "0")}`, x: (i % 8) * 31 - 124, y: Math.floor(i / 8) * 29 - 64 }));
  const rowAt = (handle, t) => {
    const L = legs[handle];
    if (L) {
      const f = Math.max(0, Math.min(1, (t - L.t0) / (L.t1 - L.t0)));
      return { handle, x: L.from.x + (L.toward.x - L.from.x) * f, y: L.from.y + (L.toward.y - L.from.y) * f, moving: f < 1 };
    }
    if (handle === "rider") return { handle, x: t / 3, y: 40, moving: false };
    return { ...still.find((s) => s.handle === handle), moving: false };
  };
  const all = ["walker", "diag", "rider", ...still.map((s) => s.handle)];
  const rowsFor = async (handles, t) => (handles ?? all).map((h) => rowAt(h, t));
  const grid = await createPositionGrid({ rowsFor, frames: new Map([["rider", {}]]) }).build(0);
  const scan = (p, r, t) => all.map((h) => rowAt(h, t))
    .map((row) => ({ ...row, distance_m: Math.round(Math.hypot(row.x - p.x, row.y - p.y)) }))
    .filter((row) => Math.hypot(row.x - p.x, row.y - p.y) <= r)
    .sort((a, b) => a.distance_m - b.distance_m || (a.handle < b.handle ? -1 : 1));
  let checked = 0;
  for (const t of [0, 50, 200, 399, 400, 599, 600, 900]) {
    for (const p of [{ x: 0, y: 0 }, { x: 63.9, y: -64 }, { x: 128, y: 128 }, { x: 250, y: 0 }, { x: -200, y: -60 }]) {
      for (const r of [15, 60, 64, 150]) {
        const want = scan(p, r, t);
        assert.deepEqual(await grid.near(p, r, t), want, `near(${p.x},${p.y}, ${r}) at t=${t}`);
        checked += want.length;
      }
    }
  }
  assert.ok(checked > 200, "the probes found almost nobody — they are not exercising the grid");
  assert.equal(grid.census().drifting, 1, "both walkers have arrived and joined the grid; only the rider still drifts");
});

test("DOOR: /world/walkers answers the same with the projection on as off", async (t) => {
  if (needsClone(t)) return;
  install();
  const world = await import("../src/world.mjs");
  if (!STORE.length) {
    const walk = await worldToolModule("walk.mjs", { repo: WORLD_CLONE });
    for (let i = 0; i < 24; i++) await fileWalk(movementAt(i, walk));
  }
  mock.timers.enable({ apis: ["Date"], now: B + 45 * 60_000 });
  try {
    delete process.env.WORLD_POSITIONS;
    const off = await world.worldWalkers(WORLD_CLONE, null, { roll: ROLL });
    process.env.WORLD_POSITIONS = "1";
    world.positionProjection.invalidate();
    const on = await world.worldWalkers(WORLD_CLONE, null, { roll: ROLL });
    assert.ok(off.walkers.length > 20, "the door answered almost nobody — the comparison is vacuous");
    assert.ok(off.walkers.some((w) => w.moving), "nobody is on the road — the kept placement's re-placing is not exercised");
    assert.deepEqual(on, off);

    // THE SECOND INSTANT, same epoch (POS-284): the kept placement must move
    // the walkers it kept, and hold the ones who have arrived.
    mock.timers.setTime(B + 50 * 60_000);
    const later = await world.worldWalkers(WORLD_CLONE, null, { roll: ROLL });
    delete process.env.WORLD_POSITIONS;
    const laterOff = await world.worldWalkers(WORLD_CLONE, null, { roll: ROLL });
    assert.notDeepEqual(laterOff.walkers, off.walkers, "nobody moved in five minutes — the second instant proves nothing");
    assert.deepEqual(later, laterOff);
  } finally {
    mock.timers.reset();
    delete process.env.WORLD_POSITIONS;
    world.positionProjection.invalidate();
  }
});
