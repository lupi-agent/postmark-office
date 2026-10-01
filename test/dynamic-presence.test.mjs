// dynamic-presence.test.mjs — residents revealed to one another.
//
// The falsifiers:
//
//   flag off        orient and open-your-eyes answer exactly what they answered
//                   before presence existed, asserted by deep-equality against a
//                   run with the flag unset — and the tool descriptions are
//                   byte-identical to the ones on the previous commit.
//   fresh, not      positions are DERIVED AT THE INSTANT ASKED from the
//   photographed    projection's governing departures. A walker whose record
//                   says the boundary must have moved by the time the question
//                   is asked, or the layer is serving a photograph.
//   the vessel      a passenger reads `aboard`; the boat herself is never a
//                   resident in the list.
//   the town's      a resident is described in the same words a hill is — the
//   own words       engine's own 16-point rose and named distance bands.
//   disclosure      a read handed no projection is named, not smoothed; the
//                   projection's own disclosure rides through. (The entities
//                   table these tests once seeded went with dynamic.db, POS-269.)
//
//   node --test test/dynamic-presence.test.mjs

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";

import {
  fixtureWorldCloneWithEngine, fixtureWorldDb, mainShaOf, scratchDir, crossingStart,
} from "./dynamic-fixture.mjs";
import { NO_WORLD_DB } from "./helpers/world-rows.mjs";

const scratch = scratchDir("presence");
const FRAME = "the-town/let-there-be-light";
const MARKS = [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "let there be light" },
  { id: "the-town/town-square", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 400, h: 400 }, body: "the square" },
];
const worldDbPath = join(scratch, "world.db");

process.env.WORLD_STORE_DB = NO_WORLD_DB;   // the world is the published fixture (POS-270 lane W 3a), never the file
delete process.env.WORLD_PRESENCE;
delete process.env.WORLD_EMISSIONS;

const N = 400;
const B = crossingStart(N);
const ASK = B + 6 * 3600 * 1000;     // half a crossing after the departures were filed

// wright stands still at the origin and iris 30 m east of him — the room. jetto
// walks east from well outside it at the default 15 km/crossing. hal is 12 km
// away. The vessel sails from the quay and vermillion sails with her — same
// instant, same destination, same pace, which is the whole of the aboard test.
const SAIL = { at: new Date(B).toISOString(), from: { x: -5000, y: 0 }, toward: { x: -20000, y: 0 }, crossing: N, pace: 40 };
const DEPARTURES = [
  { at: new Date(B).toISOString(), actor: "wright", from: { x: 0, y: 0 }, toward: { x: 0, y: 0 }, crossing: N, line_no: 1 },
  { at: new Date(B).toISOString(), actor: "iris", from: { x: 30, y: 0 }, toward: { x: 30, y: 0 }, crossing: N, line_no: 2 },
  { at: new Date(B).toISOString(), actor: "jetto", from: { x: 2000, y: 0 }, toward: { x: 62000, y: 0 }, crossing: N, line_no: 3 },
  { at: new Date(B).toISOString(), actor: "hal", from: { x: 9000, y: 9000 }, toward: { x: 9000, y: 9000 }, crossing: N, line_no: 4 },
  { ...SAIL, actor: "the-post-office", line_no: 5 },
  { ...SAIL, actor: "vermillion", line_no: 6 },
];

// The ledger file carries them: the projection reads the record, as the office does.
const repo = fixtureWorldCloneWithEngine({ label: "presence", marks: MARKS, departures: DEPARTURES });
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
after(() => { sweep(scratch); sweep(repo); });
const SHA = mainShaOf(repo);
process.env.WORLD_CLONE = repo;

const buildWorld = (o = {}) => fixtureWorldDb(worldDbPath, { sha: SHA, departures: DEPARTURES, ...o });
let presence, entities, world;
before(async () => {
  presence = await import("../src/dynamic-presence.mjs");
  entities = await import("../src/dynamic-entities.mjs");
  world = await import("../src/world.mjs");
});

beforeEach(() => {
  buildWorld();
  delete process.env.WORLD_PRESENCE;
  delete process.env.WORLD_POSITIONS;
});

/**
 * The projection as the office keeps it — both eras' governing departures,
 * built AT THE BOUNDARY. The miniature ledger grammar has no pace clause, so the
 * two sailings carry theirs the way the store's era does: on the record.
 */
const SAILORS = new Set(["the-post-office", "vermillion"]);
const seed = async (at = B) => {
  const derived = await world.departuresAcrossEras(repo, { atMs: at });
  const departures = derived.departures.map((d) => SAILORS.has(d.handle) ? { ...d, pace: SAIL.pace } : d);
  return { ...derived, departures, built_at: new Date(at).toISOString() };
};

// ── 1. positions are derived at the ask, not read off the row ────────────────

test("a walker's position is DERIVED at the instant asked, not served from the stored column", async () => {
  const projected = await seed(B);   // built at the boundary: jetto's record is his departure, not a place
  const kept = projected.departures.find((d) => d.handle === "jetto");
  assert.equal(Math.round(kept.from.x), 2000, "the record is the departure, as filed at the boundary");

  const r = await presence.near({ x: 0, y: 0, radiusM: 100000, repo, atMs: ASK, projected });
  const jetto = r.residents.find((p) => p.handle === "jetto");
  assert.equal(jetto.at.x, 9500, "half a crossing at 15 km/crossing is 7500 m further on — the answer moved with the clock");
  assert.equal(jetto.moving, true);
  assert.equal(r.evaluated_at, new Date(ASK).toISOString());
  assert.equal(r.as_of, new Date(B).toISOString(), "and both clocks are named: when the record was read, when it was evaluated");
});

// ── 2. near(): radius, order, cap, self ──────────────────────────────────────

test("near() answers who is within the radius, nearest first, in the town's own words", async () => {
  const projected = await seed(B);
  const r = await presence.near({ x: 0, y: 0, radiusM: 500, repo, projected, atMs: B });
  assert.deepEqual(r.residents.map((p) => p.handle), ["wright", "iris"], "hal is 12 km away and jetto has not moved yet");

  const iris = r.residents[1];
  assert.equal(iris.distance_m, 30);
  assert.equal(iris.bearing, "E", "the engine's own 16-point rose — 30 m east of the origin is E");
  assert.equal(iris.band, "close by", "and the engine's own named band, the same one a mark 30 m away gets");
  assert.equal(iris.standing, true);
  assert.equal(iris.moving, false);
  assert.equal(iris.aboard, false);
});

test("near() excludes whoever asked — you are not your own audience", async () => {
  const projected = await seed(B);
  const r = await presence.near({ x: 0, y: 0, radiusM: 500, exclude: ["wright"], repo, projected, atMs: B });
  assert.deepEqual(r.residents.map((p) => p.handle), ["iris"]);
});

test("the cap is a rendering decision and says so — a short list is not an empty room", async () => {
  const projected = await seed(B);
  const r = await presence.near({ x: 0, y: 0, radiusM: 500, limit: 1, repo, projected, atMs: B });
  assert.equal(r.count, 2, "two are actually there");
  assert.equal(r.shown, 1);
  assert.equal(r.capped, true);
  assert.deepEqual(r.residents.map((p) => p.handle), ["wright"], "and the one shown is the nearest");
});

test("place words ride when a place function is injected, and are absent when it is not", async () => {
  const projected = await seed(B);
  const bare = await presence.near({ x: 0, y: 0, radiusM: 500, repo, projected, atMs: B });
  assert.equal(bare.residents[0].place, undefined);

  const dressed = await presence.near({
    x: 0, y: 0, radiusM: 500, repo, projected, atMs: B,
    place: async ({ x, y }) => `a fixture place at ${Math.round(x)},${Math.round(y)}`,
  });
  assert.equal(dressed.residents[1].place, "a fixture place at 30,0");
});

// ── 3. the vessel ────────────────────────────────────────────────────────────

test("a passenger reads aboard, and the vessel herself is never a resident", async () => {
  const projected = await seed(B);
  const r = await presence.near({ x: -20000, y: 0, radiusM: 100000, repo, projected, atMs: B + 3600_000 });
  const handles = r.residents.map((p) => p.handle);
  assert.equal(handles.includes("the-post-office"), false, "she is a mark that moves, not a resident");

  const v = r.residents.find((p) => p.handle === "vermillion");
  assert.equal(v.aboard, true, "same instant, same destination, same paced stride — she is on the water, not on a road");
  assert.equal(v.moving, true);

  const j = r.residents.find((p) => p.handle === "jetto");
  assert.equal(j.aboard, false, "a walker on his own leg is not aboard anything");
});

test("aboard ends when the sailing does — a passenger set down ashore is standing on ground", async () => {
  const projected = await seed(B);
  // 20 km at 40 km/crossing lands well inside one crossing
  const r = await presence.near({ x: -20000, y: 0, radiusM: 1000, repo, projected, atMs: B + 11 * 3600_000 });
  const v = r.residents.find((p) => p.handle === "vermillion");
  assert.equal(v.moving, false);
  assert.equal(v.aboard, false, "the deck holds until the landing, and not one instant after");
});

// ── 4. everyone() ────────────────────────────────────────────────────────────

test("everyone() is ONE list — arrived and standing are the same state, learned differently", async () => {
  const projected = await seed(B);
  const r = await presence.everyone({ repo, projected, atMs: ASK });
  assert.deepEqual(r.residents.map((p) => p.handle).sort(), ["hal", "iris", "jetto", "vermillion", "wright"]);
  assert.equal(r.count, 5);
  assert.equal(r.residents.find((p) => p.handle === "jetto").remaining_m, 52500);
  assert.equal(r.residents.find((p) => p.handle === "hal").remaining_m, undefined, "a person at rest carries no remainder");
});

// ── 5. the gates ─────────────────────────────────────────────────────────────

test("no projection, or a projection that disclosed a gap — each is named, never smoothed", async () => {
  const gone = await presence.near({ x: 0, y: 0, repo });
  assert.equal(gone.error, "presence-needs-projection");
  assert.match(gone.detail, /dynamic\.db, which it read without one, is retired/);

  const projected = { ...(await seed(B)), disclosed: ["store-unreadable: a fixture gap"] };
  const r = await presence.near({ x: 0, y: 0, radiusM: 500, repo, atMs: B, projected });
  assert.ok(r.disclosed.includes("store-unreadable: a fixture gap"), "the projection's own disclosure rides through");
  assert.equal(r.residents.length, 2, "and it still answers — a disclosed gap is not a refusal");
});

// ── 6. flag off ──────────────────────────────────────────────────────────────

test("flag off — presentNear returns null on its first line and the store is never opened", async () => {
  const projected = await seed(B);
  assert.equal(await presence.presentNear({ x: 0, y: 0 }, { repo, projected }), null);

  process.env.WORLD_PRESENCE = "1";
  const blind = await presence.presentNear({ x: 0, y: 0 }, { repo });
  assert.equal(blind.unavailable, "presence-needs-projection", "and with the flag ON a read with no projection is a named absence, never a throw");
  const broken = await presence.presentNear({ x: 0, y: 0 }, { repo, projected: { get departures() { throw new Error("torn"); } } });
  assert.equal(broken.unavailable, "presence-derivation-failed", "nor is a projection that trips");
});

test("flag off — orient and open-your-eyes answer exactly what they answered before presence existed", async () => {
  process.env.WORLD_POSITIONS = "1";   // presence reads only the kept projection (POS-269)
  const { worldOrient, worldEyes } = await import("../src/world.mjs");
  const at = { x: 10, y: 10 };

  const orientOff = await worldOrient(at, null);
  const eyesOff = await worldEyes(at, null);
  assert.equal("present" in orientOff, false);
  assert.equal("residents" in eyesOff, false);
  assert.equal(eyesOff.telling, "You are standing in the fixture.", "the engine's telling, untouched");

  process.env.WORLD_PRESENCE = "1";
  const orientOn = await worldOrient(at, null);
  const eyesOn = await worldEyes(at, null);
  delete process.env.WORLD_PRESENCE;

  assert.ok(orientOn.present, "with the flag on the section appears");
  assert.deepEqual(orientOn.present.residents.map((r) => r.handle), ["wright", "iris"]);
  assert.deepEqual({ ...orientOn, present: undefined }, { ...orientOff, present: undefined },
    "and NOTHING ELSE in the answer moved");

  assert.ok(eyesOn.telling.startsWith("You are standing in the fixture."), "the engine's prose is left as the engine rendered it");
  assert.match(eyesOn.telling, /Who is about \(within 500 m\):/);
  assert.match(eyesOn.telling, /· 14 m NW — wright/);
  assert.deepEqual(eyesOn.residents.map((g) => g.band), ["close by"], "grouped by the engine's own bands, nearest first");

  const orientAgain = await worldOrient(at, null);
  delete process.env.WORLD_POSITIONS;
  assert.deepEqual(orientAgain, orientOff, "and turning it back off restores the old answer exactly");
});

// The first version of this test recovered the "before presence" text with
// `git show HEAD:src/world.mjs` and parsed the `description: "` literal out of
// it. That worked exactly until it was committed: the getter it was testing
// replaced the literal it was parsing, so HEAD stopped containing the shape,
// the parser walked into the next tool's field, and the check died on its own
// landing. A test that can only pass before its own commit is not a test.
//
// The durable form asserts the COMPOSITION against the exported base text: off
// is exactly the base, on is exactly base + disclosure, and the base carries no
// presence language of its own. It can still fail three ways — an unconditional
// concatenation, a disclosure edited into the base, and a getter that forgets
// the flag — and none of them depend on where HEAD is.
test("the presence disclosure rides the flag on both doors, and is byte-identical off", async () => {
  const { WORLD_TOOLS, PRESENCE_DISCLOSURE, ORIENT_DESCRIPTION, EYES_DESCRIPTION } = await import("../src/world.mjs");

  for (const [name, base] of [["world_orient", ORIENT_DESCRIPTION], ["world_open_your_eyes", EYES_DESCRIPTION]]) {
    const tool = WORLD_TOOLS.find((t) => t.name === name);
    assert.equal(tool.description, base,
      `${name}: with the flag off the door says exactly what it said before presence existed`);
    assert.equal(/presence|standing near you|who is about/i.test(base), false,
      `${name}: the base text must carry no presence language — the flag is the only thing that adds it`);
    process.env.WORLD_PRESENCE = "1";
    assert.equal(tool.description, base + PRESENCE_DISCLOSURE);
    delete process.env.WORLD_PRESENCE;
    assert.equal(tool.description, base, `${name}: and it goes away again`);
  }
  assert.match(PRESENCE_DISCLOSURE, /Presence is public and always has been/);
});

// ── 7. the standalone door ───────────────────────────────────────────────────

test("GET /world/present 404s when presence is off — 'nobody about' must not look like 'not switched on'", async () => {
  const { worldPresent } = await import("../src/world.mjs");
  const off = await worldPresent({ x: "0", y: "0" });
  assert.equal(off.error, "bounce");
  assert.equal(off.code, 404);

  process.env.WORLD_PRESENCE = "1";
  process.env.WORLD_POSITIONS = "1";
  const near = await worldPresent({ x: "0", y: "0" });
  assert.deepEqual(near.residents.map((r) => r.handle), ["wright", "iris"]);
  const all = await worldPresent({});
  assert.equal(all.count, 5, "bare, it answers the world-wide list");
  const bad = await worldPresent({ x: "not-a-number" });
  assert.equal(bad.code, 422);
  delete process.env.WORLD_PRESENCE;
  delete process.env.WORLD_POSITIONS;
});

// ── 8. one rule, one home ────────────────────────────────────────────────────

test("the aboard test has exactly one implementation, and both readers use it", async () => {
  const sail = { iso: "2026-08-08T18:00:00.000Z", pace: 40, toward: { x: -20000, y: 0 } };
  assert.equal(entities.ridesTheVessel({ ...sail }, { ...sail }), true);
  assert.equal(entities.ridesTheVessel({ ...sail, iso: "2026-08-08T18:00:01.000Z" }, { ...sail }), false, "a different instant is a different journey");
  assert.equal(entities.ridesTheVessel({ ...sail, pace: 15 }, { ...sail }), false, "a walker who happens to share a destination is on the road");
  assert.equal(entities.ridesTheVessel({ ...sail, pace: null }, { ...sail, pace: null }), false, "no pace, no sailing");
  assert.equal(entities.ridesTheVessel(null, { ...sail }), false);
  assert.equal(entities.ridesTheVessel({ ...sail }, null), false, "no vessel on the ledger means nobody is aboard anything");
});
