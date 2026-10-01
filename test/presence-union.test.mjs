// presence-union.test.mjs — `present` sees the whole town, not half of it.
//
// Issue #7 §1, the one finding that cost something. `world_walkers` has always
// answered from a UNION of two sources — a resident's walk record, and their
// parcel for anyone who has never walked. `present` was built from the walk
// ledger alone, so twenty-one placed residents were invisible to it. A resident
// walked 473 m to visit finn, stood on finn's porch, read `count: 0`, concluded
// they were out, and opened a letter with "You aren't home." finn was three
// metres away and drawn at home on the town's own map the whole time.
//
// The falsifiers, each one red against the code before this file existed:
//
//   the porch      standing on a never-walked resident's own ground, `present`
//                  counts them — through orient, through the apex verb, and
//                  through the standalone /world/present door.
//   the waystation the walk half still works, at the derived position, and the
//                  474 m neighbour is in the same answer.
//   once, walking  a resident holding BOTH a parcel and a walk record appears
//                  exactly once, at the walk-derived position. Latest wins.
//   no split-brain `world_walkers` and `present` name the same residents. That
//                  is the actual invariant; the three above are its symptoms.
//
//   node --test test/presence-union.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import {
  fixtureWorldCloneWithEngine, fixtureWorldDb, mainShaOf, scratchDir, crossingStart,
} from "./dynamic-fixture.mjs";
import { NO_WORLD_DB } from "./helpers/world-rows.mjs";
import { rmSync } from "node:fs";

const scratch = scratchDir("union");

// The world as issue #7 met it, in miniature and at its own coordinates.
//
//   finn        holds ground at 1725,3900 and has NEVER WALKED. The whole town
//               can see him; before this fix `present` could not.
//   jetto       holds ground at the quay AND has a walk record 474 m from finn.
//               Two sources, one resident: he must appear once, at the walk.
//   hal         a walker with no parcel at all — the half that already worked,
//               kept so a fix to the ground half cannot quietly cost it.
const FRAME = "the-town/let-there-be-light";
const MARKS = [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "let there be light" },
  { id: "finn/the-still-reach-parcel", by: "finn", household: "finn", kind: "parcel", tier: "market", at: { x: 1725, y: 3900 }, extent: { w: 25, h: 25 }, body: "the ground the Still Reach stands on" },
  { id: "finn/the-porch", by: "finn", household: "finn", kind: "sited", tier: "market", at: { x: 1729, y: 3900 }, extent: { w: 3, h: 2 }, body: "a porch faces east" },
];
const PARCELS = [
  { id: "finn/the-still-reach-parcel", household: "finn", at: { x: 1725, y: 3900 }, extent: { w: 25, h: 25 } },
  { id: "jetto/the-quay-parcel", household: "jetto", at: { x: 0, y: 0 }, extent: { w: 25, h: 25 } },
];

// The clone is built AFTER the departures below, so the ledger file and the
// world.db events are the same two records; see `DEPARTURES`.
const N = 400;
const B = crossingStart(N);
// Zero-length departures: both are standing exactly where their record puts
// them, so nothing in these assertions depends on how far the clock has run.
const DEPARTURES = [
  { at: new Date(B).toISOString(), actor: "jetto", from: { x: 1503, y: 4319 }, toward: { x: 1503, y: 4319 }, crossing: N, line_no: 1 },
  { at: new Date(B).toISOString(), actor: "hal", from: { x: 9000, y: 9000 }, toward: { x: 9000, y: 9000 }, crossing: N, line_no: 2 },
];

const repo = fixtureWorldCloneWithEngine({ label: "union", marks: MARKS, parcels: PARCELS, departures: DEPARTURES });
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
after(() => { sweep(scratch); sweep(repo); });

const SHA = mainShaOf(repo);
const worldDbPath = join(scratch, "world.db");
const dynPath = join(scratch, "dynamic.db");

process.env.WORLD_CLONE = repo;
process.env.WORLD_STORE_DB = NO_WORLD_DB;   // the world is the published fixture (POS-270 lane W 3a), never the file
process.env.WORLD_DYNAMIC_DB = dynPath;
// Presence reads the position projection (POS-269): the entities table it read
// without one went with dynamic.db.
process.env.WORLD_POSITIONS = "1";
delete process.env.WORLD_APEX;
delete process.env.WORLD_EMISSIONS;

const PORCH = { x: 1728.4, y: 3901 };        // where the visitor stood: 3.5 m from finn's ground
const WAYSTATION = { x: 1503, y: 4319 };     // jetto's walk-derived position, 474 m from finn

let world, apex;
before(async () => {
  fixtureWorldDb(worldDbPath, { sha: SHA, departures: DEPARTURES });
  world = await import("../src/world.mjs");
  apex = await import("../src/world-apex.mjs");
  process.env.WORLD_PRESENCE = "1";
});
after(() => { delete process.env.WORLD_PRESENCE; delete process.env.WORLD_APEX; });

const named = (present, handle) => (present?.residents ?? []).find((r) => r.handle === handle);

// ── the porch · a resident who has never walked is still standing there ──────

test("standing on a never-walked resident's own ground, orient counts them", async () => {
  const r = await world.worldOrient({ ...PORCH }, null);
  assert.ok(!r.error, JSON.stringify(r));
  assert.ok(r.present, "presence is on, so the section is there");
  assert.ok(r.present.count >= 1, `count was ${r.present.count} standing on finn's own ground`);
  const finn = named(r.present, "finn");
  assert.ok(finn, "finn was invisible from three metres away — the letter that opened 'You aren't home'");
  assert.equal(finn.source, "parcel", "and the answer says how it knows: his ground, not a walk");
  assert.equal(finn.distance_m, 4, "3.5 m, rounded — the porch is his own");
  assert.equal(finn.moving, false);
});

test("the apex verb reads the same answer — it is orient's `present`, not a second one", async () => {
  process.env.WORLD_APEX = "1";
  try {
    const r = await apex.worldApex({ ...PORCH }, null);
    assert.ok(!r.error, JSON.stringify(r));
    assert.ok(named(r.present, "finn"), "the apex's `present` still could not see him");
  } finally { delete process.env.WORLD_APEX; }
});

test("GET /world/present answers over the union too — bare and by point", async () => {
  const here = await world.worldPresent({ x: String(PORCH.x), y: String(PORCH.y) });
  assert.ok(named(here, "finn"), "the standalone door still read the walk ledger alone");

  const all = await world.worldPresent({});
  assert.deepEqual(all.residents.map((r) => r.handle).sort(), ["finn", "hal", "jetto"],
    "the world-wide list is everyone placed, however the world learned where they are");
  assert.equal(named(all, "hal").source, "walk");
  assert.equal(named(all, "finn").source, "parcel");
});

// ── the waystation · the walk half is untouched ─────────────────────────────

test("the walk-derived position still answers, and the 474 m neighbour is in it", async () => {
  const r = await world.worldOrient({ ...WAYSTATION }, null);
  const jetto = named(r.present, "jetto");
  assert.ok(jetto, "the walker vanished — the ground half was bought with the walk half");
  assert.equal(jetto.source, "walk");
  assert.deepEqual(jetto.at, { x: 1503, y: 4319 });

  const finn = named(r.present, "finn");
  assert.ok(finn, "finn is 474 m off inside a 500 m radius and was still not counted");
  assert.equal(finn.distance_m, 474, "the exact distance from issue #7's own repro table");

  assert.equal(named(r.present, "hal"), undefined, "hal is 12 km away and stays outside the radius");
});

// ── once · two sources, one resident, latest wins ───────────────────────────

test("a resident holding BOTH a parcel and a walk record appears once, at the walk", async () => {
  const all = await world.worldPresent({});
  const rows = all.residents.filter((r) => r.handle === "jetto");
  assert.equal(rows.length, 1, "jetto was counted twice — once for his ground and once for his road");
  assert.deepEqual(rows[0].at, { x: 1503, y: 4319 }, "the walk is the resident's own latest statement about themselves");
  assert.equal(rows[0].source, "walk");

  // …and he is NOT at the ground he still holds
  const atTheQuay = await world.worldPresent({ x: "0", y: "0" });
  assert.equal(named(atTheQuay, "jetto"), undefined, "his parcel answered over his walk");
});

// ── the invariant the three above are symptoms of ───────────────────────────

test("world_walkers and present name the same residents — one derivation, two doors", async () => {
  const walkers = await world.worldWalkers(repo, null);
  const present = await world.worldPresent({});
  const fromWalkers = walkers.walkers.map((w) => w.handle).sort();
  const fromPresence = present.residents.map((r) => r.handle).sort();
  assert.deepEqual(fromPresence, fromWalkers,
    "the two doors disagree about who is in the world, which is the split-brain this fix closed");

  // and they agree about WHERE, not merely about who
  for (const w of walkers.walkers) {
    const p = named(present, w.handle);
    assert.deepEqual(p.at, { x: Math.round(w.x), y: Math.round(w.y) }, w.handle);
    assert.equal(p.source, w.source, `${w.handle}: the two doors disagree about how they know`);
  }
});

// ── the gap, when it cannot be closed, is named rather than silent ──────────

test("a presence read handed no fold says which half it is answering", async () => {
  const presence = await import("../src/dynamic-presence.mjs");
  const projected = { ...(await world.departuresAcrossEras(repo, { atMs: B })), built_at: new Date(B).toISOString() };
  const blind = await presence.everyone({ repo, atMs: B, projected });   // no `world`
  assert.deepEqual(blind.residents.map((r) => r.handle).sort(), ["hal", "jetto"],
    "with no fold there is no ground half — which is exactly what must be disclosed");
  assert.ok((blind.disclosed ?? []).some((d) => d.startsWith("ground-not-read:")),
    "the walk-only answer passed itself off as the whole town");
});

test("a presence read handed no PROJECTION has no presence to give, and says why (POS-269)", async () => {
  const presence = await import("../src/dynamic-presence.mjs");
  const r = await presence.everyone({ dbPath: dynPath, repo, atMs: B });
  assert.equal(r.error, "presence-needs-projection");
  assert.match(r.detail, /dynamic\.db, which it read without one, is retired/);
});
