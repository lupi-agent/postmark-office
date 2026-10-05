// ride-read-names-the-rider.test.mjs — the ride read asks about the resident
// the read names (postmark-town/postmark#3394, POS-333).
//
// ── THE SIGHTING ────────────────────────────────────────────────────────────
//
// Kogane, aboard the Post Office, timed it to the second: `read: walk` said
// "aboard the-town/the-post-office, under way on her timetable"; `read: ride`,
// 25 s later, said "no ride stands — you are not aboard"; and `do: ride` 12 s
// after that answered `aboard: true`. Her key carries two residents (keith and
// kogane, one household), so every call named `handle: "kogane"`.
//
// ── THE CAUSE, MEASURED ─────────────────────────────────────────────────────
//
// Not geometry. All three readers decide "aboard" from the same occupancy (the
// enter-exit ledger): the walk read's standpoint through `residentStandpoint`'s
// aboard-by-occupancy branch, the act through `rideDeps().within`. What differed
// was WHOSE occupancy. `rideDomain` took `oriented.standpoint.handle`, a field
// orient's standpoint never carries, and fell back to the key's FIRST handle.
// For a two-resident key that is a different resident from the one named, so
// the read answered about keith while the walk and the act answered about
// kogane.
//
// ── THE RIG ─────────────────────────────────────────────────────────────────
//
// The real world clone (the vessel, her timetable, the ledger grammar) and a
// record that answers the two passage queries the ledger asks, holding one
// live passage: kogane enters her. Nothing on the read path is stubbed above
// the record. Her hull's position is the real clock's, so whether she is under
// way or alongside right now is whatever the timetable says, and the
// assertions do not depend on it: aboard is occupancy, never where the hull is.
//
// Run: WORLD_CLONE=<a world checkout> node --test test/ride-read-names-the-rider.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const CLONE = worldClone();
const HAVE_CLONE = Boolean(CLONE) && existsSync(join(CLONE, "WORLD", "world-state.json"))
  && existsSync(join(CLONE, "tools", "vessel.mjs")) && existsSync(join(CLONE, "tools", "enter-exit.mjs"));
const WHY_NOT = CLONE ? `the world clone at ${CLONE} is missing world-state.json, tools/vessel.mjs or tools/enter-exit.mjs` : NO_WORLD;

const SHIP = "the-town/the-post-office";
const RECORD_ON = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://ride-read-names-the-rider/none" };
const saved = Object.fromEntries(Object.keys(RECORD_ON).map((k) => [k, process.env[k]]));
for (const [k, v] of Object.entries(RECORD_ON)) process.env[k] = v;

const { worldOrient } = await import("../src/world.mjs");
const { readDomainFor, rideDeps, crossingDeps } = await import("../src/world-apex.mjs");
const { __setPoolForTest } = await import("../src/world2-acts.mjs");
const { __forgetPassages } = await import("../src/enter-exit-ledger.mjs");

after(() => {
  __setPoolForTest(null); __forgetPassages();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

// THE KEY ORDER IS THE SIGHTING'S: the resident who is NOT aboard comes first,
// so a reader that takes the key's first handle answers about the wrong one.
const KEY = { handles: new Set(["keith", "kogane"]) };

/** A record holding these passage acts, answering the two questions the ledger
 *  asks it (read-once-per-change.test.mjs § recordOf's shape). Anything else
 *  throws, so a new question cannot pass unseen. */
function recordOf(acts) {
  return { async query(sql, params) {
    const text = String(sql).replace(/\s+/g, " ");
    const want = new Set(params?.[0] ?? []);
    const rows = acts.filter((a) => want.has(a.action));
    if (/max\(id\) AS hw, count\(\*\) AS n FROM acts/.test(text))
      return { rows: [{ hw: rows.length ? String(Math.max(...rows.map((r) => r.id))) : null, n: String(rows.length) }] };
    if (/SELECT id, at, crossing, actor, action, payload FROM acts/.test(text) && /ORDER BY/.test(text))
      return { rows: [...rows].sort((a, b) => a.id - b.id).map((r) => ({ ...r, payload: structuredClone(r.payload) })) };
    throw new Error(`the record was asked something it does not answer: ${text.slice(0, 160)}`);
  } };
}

/** Kogane enters the vessel one crossing ago, in the ledger's own grammar. */
async function koganeAboard() {
  const grammar = await import(pathToFileURL(join(CLONE, "tools", "enter-exit.mjs")).href);
  const at = Math.floor(crossingDeps().now()) - 1;
  const line = grammar.formatEnterExit({ handle: "kogane", act: "enters", mark: SHIP, at, word: "neutral" });
  __forgetPassages();
  __setPoolForTest(recordOf([{
    id: 1, at: new Date(Date.now() - 3_600_000), crossing: at, actor: "kogane", action: "enter",
    payload: { ledger: "WORLD/enter-exit-ledger.md", lines: [line] },
  }]));
}

/** The three readers of "is this resident aboard", each through its own door. */
async function threeReaders(handle) {
  const oriented = await worldOrient({ handle }, KEY);
  assert.equal(oriented?.error, undefined, `orient answered: ${JSON.stringify(oriented).slice(0, 200)}`);
  const walk = String(oriented.standpoint?.from ?? "").startsWith(`aboard ${SHIP}`);
  const { ride } = await readDomainFor("ride", { handle }, KEY, oriented, {});
  assert.equal(ride.unreadable, undefined, `the ride read could not read: ${ride.unreadable}`);
  const read = ride.vehicle === SHIP;
  const act = (await rideDeps().within(handle)).includes(SHIP); // rideViaOffice's own gate
  return { walk, read, act, ride };
}

test("aboard, named on a two-resident key: the walk read, the ride read and the act all say aboard", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  await koganeAboard();
  const r = await threeReaders("kogane");
  assert.equal(r.act, true, "the act's occupancy puts kogane inside her (the rig holds)");
  assert.equal(r.walk, true, "the walk read's standpoint says aboard");
  assert.equal(r.read, true, `the ride read said: ${r.ride.note ?? JSON.stringify(r.ride).slice(0, 200)}`);
  assert.equal(r.ride.note?.includes?.("no ride stands") ?? false, false, "and never the ashore sentence");
});

test("off the boat, named on the same key: all three say not aboard", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  await koganeAboard();
  const r = await threeReaders("keith");
  assert.deepEqual({ walk: r.walk, read: r.read, act: r.act }, { walk: false, read: false, act: false });
  assert.match(r.ride.note, /no ride stands/);
});

test("a one-resident key needs no name, and the read still finds its rider", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  await koganeAboard();
  const solo = { handles: new Set(["kogane"]) };
  const oriented = await worldOrient({}, solo);
  const { ride } = await readDomainFor("ride", {}, solo, oriented, {});
  assert.equal(ride.vehicle, SHIP, `the read said: ${ride.note ?? JSON.stringify(ride).slice(0, 200)}`);
});
