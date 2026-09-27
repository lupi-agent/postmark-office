// standpoint-from-the-kept-positions.test.mjs — `residentStandpoint` answers
// from the positions projection behind WORLD_POSITIONS, and answers the same
// (POS-272).
//
// ── WHAT IS ON TRIAL ────────────────────────────────────────────────────────
//
// Every say paid one full derivation for the speaker (`world-apex.mjs §
// standpointOf`, `walking`): `departuresAcrossEras` read both eras of the
// record, and `movementStandpoint` read the store's departures a second time.
// With the flag on, the standpoint reads the projection's governing records
// and passes `storeRecordsOf: async () => []`.
//
//   SAME      over a replayed party, for every resident and at instants mid-walk
//             and after arrival, the standpoint with the flag on equals the
//             standpoint with it off, through both arms: the frame fold (a
//             world with a timetable carrier) and the interim `whereIs`
//             derivation (a world without one).
//   COST      with the flag on and the projection built, a standpoint reads the
//             store ZERO times; with it off, it reads it on every call.
//
// ── THE FLIPS (run after the commit; the red lines go in the report) ────────
//
//   1. `residentStandpoint` reads `departuresNow(WORLD_CLONE)` whatever the
//      flag: COST goes red (the store is read per call), SAME stays green.
//   2. `residentStandpoint` hands the projected arm no records (`departures =
//      []` when projected): SAME goes red, every walker reads at home or at
//      the Origin.
//
// Run: WORLD_CLONE=<world clone> node --test test/standpoint-from-the-kept-positions.test.mjs

import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { WORLD_CLONE } from "../src/world-store.mjs";
import { useGuardReader } from "../src/world2-guards.mjs";
import { normalizeRow } from "../src/world-journal.mjs";
import { worldToolModule } from "../src/dynamic-entities.mjs";
import { recordOfMovement } from "../src/position-projection.mjs";
import { fixtureMarks } from "./movement-fixture.mjs";

const FLAGS = ["WORLD_MOVEMENT_V2", "WORLD2_PG", "WORLD2_PG_URL", "WORLD_POSITIONS"];
const was = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));

// ── the fixture store, as `pg` hands acts over ──────────────────────────────
const STORE = [];
let storeReads = 0;
let restoreReader = null;

before(() => {
  process.env.WORLD_MOVEMENT_V2 = "1";
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://standpoint-kept-positions/none";
  delete process.env.WORLD_POSITIONS;
  restoreReader = useGuardReader(async (fn) => fn({
    query: async (sql, params) => {
      if (!/FROM acts/i.test(String(sql))) return { rows: [] };
      storeReads += 1;
      const actions = params?.[0] ?? [];
      return { rows: STORE.filter((r) => actions.includes(r.action)) };
    },
  }));
});
after(() => {
  restoreReader?.();
  for (const k of FLAGS) if (was[k] == null) delete process.env[k]; else process.env[k] = was[k];
});

const haveClone = existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"));
const needsClone = (t) => (haveClone ? false : (t.skip(`needs the world clone at ${WORLD_CLONE}`), true));

async function fileWalk(movement) {
  const { walkEntry } = await import("../src/world.mjs");
  const row = normalizeRow(walkEntry({
    crossing: movement.crossing, who: movement.actor, targetMarkId: movement.toMark,
    stampAt: null, witnesses: null, from: movement.from, toward: movement.toward,
    pace: movement.pace, targetExtent: movement.within, household: null,
    writtenAt: movement.at, declaredBy: movement.actor,
  }));
  STORE.push({
    id: 70_000 + STORE.length, at: new Date(row.written_at), crossing: String(row.crossing),
    actor: row.actor, action: row.action, payload: JSON.parse(row.payload),
  });
}

// Twenty-four walks by eight residents (the POS-264 replay's shape): `wright`
// and `rei` have founding-era ledger lines these supersede, `home-body` holds
// ground and walks off it, the rest first move in era two. `still-one` holds
// ground and never walks; `porch-sitter` has neither.
const B = Date.parse("2026-09-26T12:00:00.000Z");
const WHO = ["wright", "rei", "home-body", "new-a", "new-b", "new-c", "new-d", "new-e"];
const ASKED = [...WHO, "still-one", "porch-sitter"];
function movementAt(i, walk) {
  const actor = WHO[(i * 5) % WHO.length];
  const atMs = B + i * 90_000;
  const from = { x: 100 * (i % 7), y: -80 * (i % 5) };
  const toward = i % 4 === 0 ? { ...from } : { x: from.x + 40 + 37 * i, y: from.y - 25 * (i % 3) };
  return {
    actor, from, toward, crossing: walk.fractionalCrossing(atMs), at: new Date(atMs).toISOString(),
    within: i % 3 === 0 ? { w: 20, h: 12 } : null, toMark: i % 3 === 0 ? `the-town/stop-${i}` : null,
    pace: i % 5 === 0 ? 40 : null,
  };
}

const ASHORE = {
  marks: [{ id: "the-town/the-quay", at: { x: -35, y: 12 }, extent: { w: 20, h: 20 } }],
  parcels: [{ id: "home-body/ground", household: "home-body", at: { x: 500, y: 500 }, extent: { w: 30, h: 30 } },
            { id: "still-one/ground", household: "still-one", at: { x: 640, y: -220 }, extent: { w: 30, h: 30 } }],
  households: {},
};
// The same town with a timetable carrier, so `movementStandpoint` answers
// (the frame fold) rather than returning null to the interim derivation.
const WITH_CARRIER = { ...ASHORE, marks: fixtureMarks() };

async function standpoints(world, fold) {
  const out = {};
  for (const h of ASKED) out[h] = await world.residentStandpoint(h, fold);
  return out;
}

test("SAME: the standpoint over the kept positions equals the derivation, act by act, both arms", async (t) => {
  if (needsClone(t)) return;
  const world = await import("../src/world.mjs");
  const walk = await worldToolModule("walk.mjs", { repo: WORLD_CLONE });
  STORE.length = 0;
  mock.timers.enable({ apis: ["Date"], now: B - 1000 });
  let checked = 0, folded = 0, moving = 0;
  try {
    process.env.WORLD_POSITIONS = "1";
    world.positionProjection.invalidate();
    // Born before the party and kept by in-step records, rebuilt from the store
    // whenever the clock ages it out, exactly as the office's own is.
    await world.positionProjection.departures();
    for (let i = 0; i < 24; i++) {
      const m = movementAt(i, walk);
      await fileWalk(m);
      world.positionProjection.record(recordOfMovement(m));
      // Compared every sixth act: the derivation re-reads git and the store per
      // call, and every act is kept in step whether it is compared or not.
      if (i % 6 !== 5) continue;
      for (const dt of [20_000, 45 * 60_000]) {
        mock.timers.setTime(Date.parse(m.at) + dt);
        for (const fold of [ASHORE, WITH_CARRIER]) {
          process.env.WORLD_POSITIONS = "1";
          const on = await standpoints(world, fold);
          delete process.env.WORLD_POSITIONS;
          const off = await standpoints(world, fold);
          assert.deepEqual(on, off, `after act ${i} (${m.actor}) +${dt / 1000}s: the kept positions moved someone`);
          for (const s of Object.values(off)) {
            checked += 1;
            if (s.provenance) folded += 1;   // only the frame fold answers with a provenance
            if (s.moving) moving += 1;
          }
        }
      }
    }
  } finally {
    mock.timers.reset();
    delete process.env.WORLD_POSITIONS;
    world.positionProjection.invalidate();
  }
  assert.ok(folded > 20, `the frame fold answered only ${folded} times; the carrier world is not reaching movementStandpoint`);
  assert.ok(moving > 2, `only ${moving} standpoints were mid-walk; the replay is not exercising the road`);
  assert.equal(checked, 4 * 2 * 2 * ASKED.length);
});

test("COST: with the positions kept, a standpoint reads the store zero times; without, every time", async (t) => {
  if (needsClone(t)) return;
  const world = await import("../src/world.mjs");
  const walk = await worldToolModule("walk.mjs", { repo: WORLD_CLONE });
  if (!STORE.length) for (let i = 0; i < 24; i++) await fileWalk(movementAt(i, walk));
  mock.timers.enable({ apis: ["Date"], now: B + 45 * 60_000 });
  try {
    process.env.WORLD_POSITIONS = "1";
    world.positionProjection.invalidate();
    await world.positionProjection.departures();
    storeReads = 0;
    for (const fold of [ASHORE, WITH_CARRIER]) for (const h of ASKED) await world.residentStandpoint(h, fold);
    assert.equal(storeReads, 0, "a standpoint over the kept positions read the store");

    delete process.env.WORLD_POSITIONS;
    storeReads = 0;
    for (const h of ASKED) await world.residentStandpoint(h, WITH_CARRIER);
    assert.ok(storeReads >= ASKED.length, `the derivation read the store ${storeReads} times for ${ASKED.length} standpoints; the probe cannot see a per-call read`);
  } finally {
    mock.timers.reset();
    delete process.env.WORLD_POSITIONS;
    world.positionProjection.invalidate();
  }
});
