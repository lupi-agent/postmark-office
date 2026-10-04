// walk-from-the-kept-positions.test.mjs — the walk door starts a new leg from
// the positions projection behind WORLD_POSITIONS, and starts it at the same
// point (POS-302, part 1 of POS-277's positions snapshot).
//
// ── WHAT IS ON TRIAL ────────────────────────────────────────────────────────
//
// `walkViaOffice` read `departuresNow(worldClone)` on every walk, both eras,
// whatever the flag: the one door the projection (POS-264) did not reach. It
// uses the record for one thing, the walker's governing departure
// (`currentDeparture`), evaluated at the instant of the walk (`positionAt`).
// It reads them through `departuresForWalk` now.
//
//   SAME      over a replayed party, for every resident and at instants mid-walk
//             and after arrival, the leg's start (`currentDeparture` +
//             `positionAt` over `departuresForWalk`) with the flag on equals the
//             one with it off.
//   COST      with the flag on and the projection built, the walk's read
//             touches the store ZERO times; with it off, every time.
//   WIRED     `walkViaOffice` reads `departuresForWalk(worldClone)` and no
//             longer `departuresNow(worldClone)`.
//
// ── THE FLIPS (run after the commit; the red lines go in the report) ────────
//
//   1. `departuresForWalk` reads `departuresNow(worldClone)` whatever the flag:
//      COST goes red, SAME stays green.
//   2. `departuresForWalk` answers `[]` when projected: SAME goes red, every
//      walker would start from home.
//
// Run: WORLD_CLONE=<world clone> node --test test/walk-from-the-kept-positions.test.mjs

import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { WORLD_CLONE } from "../src/world-store.mjs";
import { useGuardReader } from "../src/world2-guards.mjs";
import { normalizeRow } from "../src/world-journal.mjs";
import { worldToolModule } from "../src/dynamic-entities.mjs";
import { recordOfMovement } from "../src/position-projection.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FLAGS = ["WORLD_MOVEMENT_V2", "WORLD2_PG", "WORLD2_PG_URL", "WORLD_POSITIONS"];
const was = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));

// ── the fixture store, as `pg` hands acts over ──────────────────────────────
const STORE = [];
let storeReads = 0;
let restoreReader = null;

before(() => {
  process.env.WORLD_MOVEMENT_V2 = "1";
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://walk-kept-positions/none";
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
    id: 80_000 + STORE.length, at: new Date(row.written_at), crossing: String(row.crossing),
    actor: row.actor, action: row.action, payload: JSON.parse(row.payload),
  });
}

// The standpoint suite's party (test/standpoint-from-the-kept-positions): 24
// walks by eight residents, two of them superseding founding-era ledger lines.
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

/** Each resident's leg start, the way `walkViaOffice` derives it. */
async function legStarts(world, walk) {
  const departures = await world.departuresForWalk(WORLD_CLONE);
  const at = walk.fractionalCrossing();
  const out = {};
  for (const h of ASKED) {
    const mine = walk.currentDeparture(departures, h);
    out[h] = mine ? walk.positionAt(mine, at) : null;
  }
  return out;
}

test("SAME: a walk starts where it did, from the kept positions as from the whole record", async (t) => {
  if (needsClone(t)) return;
  const world = await import("../src/world.mjs");
  const walk = await worldToolModule("walk.mjs", { repo: WORLD_CLONE });
  STORE.length = 0;
  mock.timers.enable({ apis: ["Date"], now: B - 1000 });
  let checked = 0, moving = 0;
  try {
    process.env.WORLD_POSITIONS = "1";
    world.positionProjection.invalidate();
    await world.positionProjection.departures();
    for (let i = 0; i < 24; i++) {
      const m = movementAt(i, walk);
      await fileWalk(m);
      world.positionProjection.record(recordOfMovement(m));
      if (i % 6 !== 5) continue;
      for (const dt of [20_000, 45 * 60_000]) {
        mock.timers.setTime(Date.parse(m.at) + dt);
        process.env.WORLD_POSITIONS = "1";
        const on = await legStarts(world, walk);
        delete process.env.WORLD_POSITIONS;
        const off = await legStarts(world, walk);
        assert.deepEqual(on, off, `after act ${i} (${m.actor}) +${dt / 1000}s: the kept positions moved a walk's start`);
        for (const p of Object.values(off)) {
          if (!p) continue;
          checked += 1;
          if (!p.arrived) moving += 1;
        }
      }
    }
  } finally {
    mock.timers.reset();
    delete process.env.WORLD_POSITIONS;
    world.positionProjection.invalidate();
  }
  assert.ok(checked > 40, `only ${checked} leg starts came from a record; the replay is not reaching the walkers`);
  assert.ok(moving > 2, `only ${moving} leg starts were mid-walk; the replay is not exercising the road`);
});

test("COST: with the positions kept, a walk's read touches the store zero times; without, every time", async (t) => {
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
    for (let i = 0; i < 5; i++) await world.departuresForWalk(WORLD_CLONE);
    assert.equal(storeReads, 0, "a walk over the kept positions read the store");

    delete process.env.WORLD_POSITIONS;
    storeReads = 0;
    for (let i = 0; i < 5; i++) await world.departuresForWalk(WORLD_CLONE);
    assert.ok(storeReads >= 5, `the derivation read the store ${storeReads} times for 5 walks; the probe cannot see a per-walk read`);
  } finally {
    mock.timers.reset();
    delete process.env.WORLD_POSITIONS;
    world.positionProjection.invalidate();
  }
});

test("WIRED: walkViaOffice starts its leg from departuresForWalk, never the whole record", () => {
  const src = readFileSync(join(HERE, "..", "src", "world.mjs"), "utf8");
  const start = src.indexOf("export async function walkViaOffice(");
  assert.ok(start > 0, "walkViaOffice is gone from world.mjs");
  const next = src.indexOf("\nexport ", start + 1);
  const body = src.slice(start, next > 0 ? next : undefined);
  assert.match(body, /await departuresForWalk\(worldClone\)/, "the walk door does not read departuresForWalk");
  assert.doesNotMatch(body, /departuresNow\(/, "the walk door reads the whole record again");
});
