// pos-247-walk-aboard.test.mjs — walking to the hull no longer boards.
//
//   node --test test/pos-247-walk-aboard.test.mjs
//
// Keemin, 2026-09-26: "simply 'walking aboard' shouldn't put you on the boat
// anymore." #2986 ruled that you board through a stop's door and that aboard is
// occupancy, read off the enter-exit ledger. The walk fold kept an older rule:
// "the walk is the consent; the edge is the record of it".
//
// THE INSTANCE. dom-pidgey rode to the Snug Jetty and exited through the
// ledger at 16:45:15Z. At 16:46:31Z his agent walked from the Snug toward the
// hull at (−9, 35), where she berths at the Town Centre. The fold judged the
// endpoint inside her footprint at arrival and put him aboard
// (`provenance: "walked"`). So `present` and `walkers` said aboard, mid-crossing,
// while every ride door said ashore.
//
// The sequence is replayed in the movement fixture's harbour: the Snug is a
// point 60 m off her quay, and the hull berths at the quay (0, 0) with a 10×26
// footprint. The set-down is the zero-length departure the exit writes, and the
// walk ends on her deck. The coordinates are the fixture's, and the order of
// acts is his.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { foldFrames } from "../src/world-frames.mjs";
import { carriersFrom, carrierReader, movementStandpoint, vesselPositionAt, vesselServiceFrom } from "../src/world-movement.mjs";
import { withFrames } from "../src/positions.mjs";
import { withVehicleRiders } from "../src/dynamic-presence.mjs";
import { atCrossing, departure, fixtureMarks, makeWorldClone, QUAY } from "./movement-fixture.mjs";

const clone = makeWorldClone();
const dbDir = mkdtempSync(join(tmpdir(), "pos247-dyn-"));
const DB = join(dbDir, "dynamic.db");
after(() => { clone.cleanup(); rmSync(dbDir, { recursive: true, force: true }); });

const SHIP = "the-town/the-post-office";
// Her mark carries `class: vehicle`, as the live world's does since #2986.
const MARKS = { marks: fixtureMarks().map((m) => (m.id === SHIP ? { ...m, class: "vehicle" } : m)) };
const REPO = { repo: clone.dir };

const SNUG = { x: 60, y: 0 };          // the stop he was set down at, clear of her
const HULL_DECK = { x: 2, y: 3 };      // inside her footprint while she lies at the quay
const MID_CROSSING = atCrossing(10.55);

// dom-pidgey's own order: set down at the stop (the exit's zero-length
// departure), then a walk from there toward her hull while she lies berthed.
const DOM = [
  departure({ handle: "dom-pidgey", from: SNUG, toward: SNUG, at: 10.1 }),
  departure({ handle: "dom-pidgey", from: SNUG, toward: HULL_DECK, at: 10.2 }),
];

async function foldOf(records, atMs) {
  const { service, mod, walk } = await vesselServiceFrom(MARKS, REPO);
  const carrierAt = carrierReader(MARKS, { repo: clone.dir, service, mod });
  return foldFrames(records, { carriers: carriersFrom(MARKS), carrierAt, walk, atMs });
}

// The frame map the doors build: one entry per resident the fold puts in a frame.
const frameMap = (entries) => new Map(entries.filter(([, f]) => f.frame));

const rowAt = (handle, p) => ({ handle, x: p.x, y: p.y, source: "walk", moving: false, remaining_m: 0, eta_crossings: 0 });

test("the fixture is the instance: his walk ends on her deck, and she then sails", async () => {
  const berthed = await vesselPositionAt(MARKS, atCrossing(10.3), REPO);
  assert.equal(berthed.berthed, true, "she lies at the quay when his walk arrives");
  const under = await vesselPositionAt(MARKS, MID_CROSSING, REPO);
  assert.equal(under.berthed, false, "and is under way when the town is asked");
  assert.ok(Math.abs(HULL_DECK.x - QUAY.x) <= 5 && Math.abs(HULL_DECK.y - QUAY.y) <= 13, "the endpoint is inside her 10×26 footprint");
});

test("dom-pidgey's sequence folds ASHORE: the walk ends on the quay beside her, never aboard", async () => {
  const fold = await foldOf(DOM, MID_CROSSING);
  assert.equal(fold.frame, null, "a walk toward her hull does not board");
  assert.deepEqual(fold.transitions, [], "no frame edge is born");
  assert.deepEqual(fold.world, HULL_DECK, "he stands where the walk ended; she sailed without him");
  assert.notEqual(fold.provenance, "carried");
});

test("the walkers door reads him ashore — the fold's frame map is empty and the row stands", async () => {
  const fold = await foldOf(DOM, MID_CROSSING);
  const rows = withFrames([rowAt("dom-pidgey", HULL_DECK)], frameMap([["dom-pidgey", fold]]));
  assert.equal(rows[0].aboard, undefined, "no aboard flag");
  assert.deepEqual({ x: rows[0].x, y: rows[0].y }, HULL_DECK, "not relocated to her mid-crossing position");
});

test("present reads him ashore — the riders overlay has no occupancy for him, so nothing puts him aboard", async () => {
  const fold = await foldOf(DOM, MID_CROSSING);
  // He exited through the ledger: occupancy holds no stack for him.
  const frames = await withVehicleRiders(frameMap([["dom-pidgey", fold]]), { world: MARKS, ...REPO, atMs: MID_CROSSING, occupancy: new Map() });
  assert.equal(frames?.get("dom-pidgey"), undefined);
  const rows = withFrames([rowAt("dom-pidgey", HULL_DECK)], frames);
  assert.equal(rows[0].aboard, undefined);
  assert.deepEqual({ x: rows[0].x, y: rows[0].y }, HULL_DECK);
});

test("his standpoint reads ashore too — the doors that measure from it see the quay", async () => {
  const here = await movementStandpoint("dom-pidgey", MARKS, { ...REPO, atMs: MID_CROSSING, dbPath: DB, recordsOf: async () => DOM });
  assert.equal(here.aboard, false);
  assert.equal(here.frame, null);
  assert.deepEqual({ x: here.x, y: here.y }, HULL_DECK);
});

test("a LEDGER rider still reads aboard at the hull — the overwrite stands", async () => {
  // She entered through a stop. Her last walk ended at that stop, far from the
  // hull, and a stale fold entry is handed in too: the ledger must win over both.
  const stale = { frame: null, world: SNUG };
  const frames = await withVehicleRiders(new Map([["marigold", stale]]), {
    world: MARKS, ...REPO, atMs: MID_CROSSING, occupancy: new Map([["marigold", [SHIP]]]),
  });
  const hull = await vesselPositionAt(MARKS, MID_CROSSING, REPO);
  const f = frames.get("marigold");
  assert.equal(f.frame, SHIP);
  assert.deepEqual(f.world, { x: hull.x, y: hull.y }, "at the hull, wherever she is");
  assert.equal(f.provenance, "carried", "she is under way");
  const rows = withFrames([rowAt("marigold", SNUG), rowAt("dom-pidgey", HULL_DECK)], frames);
  assert.equal(rows[0].aboard, true);
  assert.deepEqual({ x: rows[0].x, y: rows[0].y }, { x: hull.x, y: hull.y });
  assert.equal(rows[1].aboard, undefined, "and the walker beside her is still ashore");
});

