// presence-projection-parity.test.mjs — presence off dynamic.db, held equal (POS-269).
//
// Under WORLD_POSITIONS=1 a presence read is handed the position projection and
// now reads ONLY it: no entities table, and the vessel's sailing line taken from
// her governing record in the projection instead of `meta.vessel_departure`.
// Presence is what residents see, so the gate was EQUALITY: the three presence
// answers — who is near, the witness stamp's "who saw", and the say's
// listeners — held equal to the entities-table answers at instants before,
// during and after a sailing (#280). The entities table went with dynamic.db
// (POS-269), so that side of the equality has nothing left to read; the
// parity's standing half is `position-projection.test.mjs § PRESENCE`
// (positionsAt over the projection equals positionsAt over the ledger's
// governing legs plus the store). What stays here is what made the parity
// non-vacuous: the passenger aboard, the late one not, the vessel no resident,
// and a projection-only read that opens no store.
//
//   node --test test/presence-projection-parity.test.mjs

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

import { fixtureWorldCloneWithEngine, fixtureWorldDb, mainShaOf, scratchDir, crossingStart } from "./dynamic-fixture.mjs";

const scratch = scratchDir("presence-parity");
const FRAME = "the-town/let-there-be-light";
const MARKS = [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "let there be light" },
  { id: "the-town/town-square", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 400, h: 400 }, body: "the square" },
];
const repo = fixtureWorldCloneWithEngine({ label: "presence-parity", marks: MARKS });
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
after(() => { sweep(scratch); sweep(repo); });

const SHA = mainShaOf(repo);
const worldDbPath = join(scratch, "world.db");
const dynPath = join(scratch, "dynamic.db");
process.env.WORLD_CLONE = repo;
process.env.WORLD_STORE_DB = worldDbPath;
process.env.WORLD_DYNAMIC_DB = dynPath;
delete process.env.WORLD_PRESENCE;

const N = 400;
const B = crossingStart(N);
const HOUR = 3600_000;
// The room at the origin, a walker leaving it, one far away, the vessel sailing
// from the quay with a passenger who departed with her, and one who set off
// down the same line a minute EARLIER and is NOT aboard (a different instant).
const SAIL = { at: new Date(B).toISOString(), from: { x: -5000, y: 0 }, toward: { x: -20000, y: 0 }, crossing: N, pace: 40 };
const DEPARTURES = [
  { at: new Date(B).toISOString(), actor: "wright", from: { x: 0, y: 0 }, toward: { x: 0, y: 0 }, crossing: N, line_no: 1 },
  { at: new Date(B).toISOString(), actor: "iris", from: { x: 30, y: 0 }, toward: { x: 30, y: 0 }, crossing: N, line_no: 2 },
  { at: new Date(B).toISOString(), actor: "jetto", from: { x: 2000, y: 0 }, toward: { x: 62000, y: 0 }, crossing: N, line_no: 3 },
  { at: new Date(B).toISOString(), actor: "hal", from: { x: 9000, y: 9000 }, toward: { x: 9000, y: 9000 }, crossing: N, line_no: 4 },
  { ...SAIL, actor: "the-post-office", line_no: 5 },
  { ...SAIL, actor: "vermillion", line_no: 6 },
  { ...SAIL, at: new Date(B - 60_000).toISOString(), actor: "early-eli", line_no: 7 },
];

let presence, entities;
before(async () => {
  presence = await import("../src/dynamic-presence.mjs");
  entities = await import("../src/dynamic-entities.mjs");
});
beforeEach(() => { fixtureWorldDb(worldDbPath, { sha: SHA, departures: DEPARTURES }); });

/** The projection as its rebuild holds it: the governing record per handle, in walk shape, vessel included. */
const projection = (departures = DEPARTURES) => ({
  departures: departures.map((d) => {
    const dep = entities.departureFromEvent({ at: d.at, actor: d.actor, payload: { from: d.from, toward: d.toward, crossing: d.crossing, pace: d.pace ?? null } });
    return { handle: d.actor, iso: dep.iso, ...entities.toWalkRecord(dep) };
  }),
  built_at: new Date(B).toISOString(), disclosed: [], epoch: 1,
});

test("the parity is not vacuous: mid-sailing a passenger reads aboard and the late one does not, and the vessel is no resident", async () => {
  const r = await presence.near({ x: -20000, y: 0, radiusM: 100000, dbPath: dynPath, repo, atMs: B + HOUR, projected: projection() });
  const by = Object.fromEntries(r.residents.map((p) => [p.handle, p]));
  assert.equal(by.vermillion.aboard, true);
  assert.equal(by["early-eli"].aboard, false, "a minute early is a different sailing");
  assert.equal("the-post-office" in by, false);
});

test("THE PROJECTION-ONLY READ OPENS NO STORE: it answers, says its as_of is the projection's, and no dynamic.db appears", async () => {
  const r = await presence.near({ x: 0, y: 0, radiusM: 500, dbPath: dynPath, repo, atMs: B, projected: projection() });
  assert.equal(r.error, undefined, JSON.stringify(r));
  assert.deepEqual(r.residents.map((p) => p.handle), ["wright", "iris"]);
  assert.equal(r.as_of, new Date(B).toISOString());
  assert.equal(existsSync(dynPath), false, "and it did not create one");
});
