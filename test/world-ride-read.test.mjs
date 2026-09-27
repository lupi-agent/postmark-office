// world-ride-read.test.mjs — `world { read: "ride" }` (POS-169).
//
// ── WHAT EACH HALF OF THIS SUITE CAN AND CANNOT REACH ───────────────────────
//
// Said here rather than left for a reader to infer from which cases exist,
// because a suite whose arms are not all reachable will report the same green
// either way.
//
//   · THROUGH THE READ (`readDomainFor("ride", …)`) — the envelope's key, the
//     ashore arm, the no-standing-resident arm, and the pointer sentence. These
//     run end to end against a real world clone and touch nothing stubbed.
//
//   · THROUGH THE DECISION (`rideBlockFrom`) — the aboard arms: a standing
//     ride, a ride come due, a rider who declared nothing. These CANNOT be
//     reached through the read in a tree with no Postgres: `actsOfActor` reads
//     the store, `actsQuery` answers `null` for "the register was not asked",
//     and that lands as `[]`, so no standing ride can exist for the read to
//     find. Driving the decision directly is what lets those three arms fail.
//     The wiring between them is held by the source-shape pin at the bottom —
//     which is a weaker instrument than a run, and is named as one.
//
// The whole suite needs a world clone for the timetable (the same one
// `world-ride.test.mjs` needs, for the same reason: a hand-built service would
// be prettier inputs than the engine gives). It skips by name without one.
// Run: WORLD_CLONE=<a world checkout> node --test test/world-ride-read.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { rideBlockFrom, stopsOfService, vesselIdOf } from "../src/world-ride.mjs";
import { readDomainFor } from "../src/world-apex.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const CLONE = worldClone();
const HAVE_CLONE = Boolean(CLONE) && existsSync(join(CLONE, "WORLD", "world-state.json"))
  && existsSync(join(CLONE, "tools", "vessel.mjs"));
const WHY_NOT = CLONE ? `the world clone at ${CLONE} is missing WORLD/world-state.json or tools/vessel.mjs` : NO_WORLD;

const SHIP = "the-town/the-post-office";
const WHEELHOUSE = "the-town/the-wheelhouse";
const PANDO = "the-town/the-pando-landing";
const WHARF = "sol-of-garrison/grove-wharf";

const key = (...handles) => ({ handles: new Set(handles) });

const FOLD = HAVE_CLONE ? await import(pathToFileURL(join(CLONE, "tools", "marks-fold.mjs")).href) : null;

/** THE REAL WORKS, folded by the world's own tool — world-ride.test.mjs's fixture. */
let _folded = null;
function vehicleWorld() {
  if (_folded) return _folded;
  const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
  const stakesRaw = read(join(CLONE, "WORLD", "stakes.json"));
  _folded = FOLD.fold({
    marks: FOLD.loadMarks(join(CLONE, "WORLD", "marks")),
    terrain: read(join(CLONE, "WORLD", "terrain.json")),
    stakes: Array.isArray(stakesRaw) ? stakesRaw : (stakesRaw?.stakes ?? []),
    prev: read(join(CLONE, "WORLD", "world-state.json")),
    tick: 0,
    households: read(join(CLONE, "WORLD", "households.json"))?.households ?? null,
  });
  return _folded;
}

/** The vessel service, from the clone's own engine over a given fold. */
let _service = null;
async function serviceOf() {
  if (_service) return _service;
  const vessel = await import(pathToFileURL(join(CLONE, "tools", "vessel.mjs")).href);
  const { services } = vessel.servicesFromFold({ marks: vehicleWorld().marks });
  _service = services.find((s) => s.markId === WHEELHOUSE) ?? services[0] ?? null;
  return _service;
}

/** The acts a rider writes, in the shape `rideStateFrom` folds and the shape
 *  `officeWith`'s own `deps.acts` hands back — `{action, object, payload}`. */
const entered = (via, vessel = SHIP) => ({ action: "enter", object: vessel, payload: { via } });
const rode = (ride, vessel = SHIP) => ({ action: "ride", object: vessel, payload: ride });

/** A declared ride, timed the way `rideViaOffice` times one. */
const declaration = ({ origin, to, at, ms }) => ({
  origin, to, distance_m: 1000, pace_km_per_crossing: 405,
  declared_at: new Date(at).toISOString(),
  arrives_at: new Date(at + ms).toISOString(),
});

// DELIBERATELY A MONTH IN THE PAST, and this is load-bearing. Every case below
// passes `nowMs` explicitly, so the instant's VALUE changes no assertion — what
// it changes is whether the un-threaded defect can be caught. A composition
// that reads the real clock behind your back agrees with a `nowMs` sitting in
// today's window and disagrees with one outside it, so an instant near now
// would hide exactly the bug the threading fixed, and only some hours of the
// day. A ride that came due a month ago is past for any clock this suite is
// ever run under.
const T0 = Date.UTC(2026, 7, 21, 12, 0, 0);
const HOUR = 3_600_000;

// ── THROUGH THE READ ────────────────────────────────────────────────────────

test("the ride's domain rides under `ride` and NEVER under `result`", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // `result` is the ACT branch's envelope (world-apex.mjs § apexAct,
  // `{ ...done, result }`), where it means what the act performed returned. The
  // read branch spreads its domain under the domain's own name — say → `heard`,
  // walk → `walkers`. This is the line that stops one word meaning two things
  // at one door, and it is asserted as the WHOLE key set, not as a presence:
  // a `result` added beside `ride` would pass a presence check.
  const out = await readDomainFor("ride", {}, key("wright"),
    { standpoint: { handle: "wright", stance: "embodied", x: -9, y: 35.5 } }, {});
  assert.deepEqual(Object.keys(out), ["ride"],
    "the read contributes exactly one named key to `{read, card, ...domain, reading_law}`");
});

test("ashore, the read says no ride stands AND says the way aboard", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // The reachable ashore case is someone standing BESIDE her, because `ride` is
  // granted through the spine or through reach — a resident away from her never
  // reaches this function at all. So what they are owed is not the word "none".
  const out = await readDomainFor("ride", {}, key("wright"),
    { standpoint: { handle: "wright", stance: "embodied", x: -9, y: 35.5 } }, {});
  const r = out.ride;
  assert.equal(r.vehicle, null);
  assert.equal(r.ride, null);
  assert.deepEqual(r.can_ride_to, []);
  assert.match(r.note, /no ride stands/);
  assert.match(r.note, new RegExp(SHIP.replace("/", "\\/")), "the vessel is named, not implied");
  for (const stop of [PANDO, WHARF])
    assert.ok(r.note.includes(stop), `${stop} is a door in and the note names it`);
});

test("a read with nobody standing is UNREADABLE, and does not spell like ashore", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // The defect this shape exists to prevent: `vehicleFrameExtras` answers `{}`
  // for ashore, for a non-vehicle frame, and for anything that threw. A door
  // that answers the same bytes for "no ride stands" and "this office could not
  // read your ride" cannot be trusted about either.
  const out = await readDomainFor("ride", {}, key(), { standpoint: { stance: "nobody" } }, {});
  assert.ok(out.ride.unreadable, "a read it could not take says so");
  assert.equal(out.ride.note, undefined, "and never borrows the ashore arm's sentence");
  assert.equal(out.ride.vehicle, undefined, "nor its fields — the two shapes share only the pointer");
  assert.equal(out.ride.ride, undefined);
});

test("the pointer to the home block rides EVERY shape, and is shorter than the sentence it replaced", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // ROLLOVER 13: no new doorstep transport segment — the notice is already on
  // /api/homes → world.transport (world.mjs § doorstepTransportFor), so this is
  // a pointer and not a second home. "Tighten, never lengthen" is the brief's
  // own instruction and this is the line that holds it.
  const REPLACED = `no shadow read is wired for "ride" yet — its card above is the law that stands`;
  const ashore = await readDomainFor("ride", {}, key("wright"),
    { standpoint: { handle: "wright", stance: "embodied", x: -9, y: 35.5 } }, {});
  const nobody = await readDomainFor("ride", {}, key(), { standpoint: { stance: "nobody" } }, {});
  for (const [what, r] of [["ashore", ashore.ride], ["unreadable", nobody.ride]]) {
    assert.match(r.also_at, /\/api\/homes/, `${what} names the door`);
    assert.match(r.also_at, /world\.transport/, `${what} names the field on it`);
    assert.ok(r.also_at.length < REPLACED.length,
      `${what}: the pointer is ${r.also_at.length} chars against the replaced sentence's ${REPLACED.length}`);
  }
  assert.equal(ashore.ride.also_at, nobody.ride.also_at, "one sentence, not one per arm");
});

test("an unwired read still answers the old sentence — this lane wired ONE action", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // The non-regression leg. If the ride case had been written as a widening of
  // `default:` rather than a case beside it, this is what would say so.
  const out = await readDomainFor("not-an-action", {}, key("wright"),
    { standpoint: { handle: "wright", stance: "embodied", x: -9, y: 35.5 } }, {});
  assert.match(out.domain.unavailable, /no shadow read is wired for "not-an-action" yet/);
  assert.equal(out.ride, undefined);
});

// ── THROUGH THE DECISION ────────────────────────────────────────────────────

test("a rider aboard with a standing ride: the declaration stands, nothing has arrived", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const service = await serviceOf();
  const ride = declaration({ origin: WHARF, to: PANDO, at: T0, ms: 4 * HOUR });
  const b = rideBlockFrom({ vesselId: SHIP, service, acts: [entered(WHARF), rode(ride)], nowMs: T0 + HOUR });

  assert.equal(b.vehicle, SHIP);
  assert.equal(b.entered_via, WHARF, "the door you came in by is a machine fact, read off the enter row's `via`");
  assert.deepEqual(b.ride, ride, "the standing ride is the row, not a rendering of it");
  assert.equal(b.arrived, undefined, "three hours short of arriving is ABSENT, never present-and-empty");
  assert.match(b.how_to_leave, new RegExp(`sets you down at ${WHARF.replace("/", "\\/")}`));
  assert.match(b.how_to_leave, /no ride of yours has come due/);
});

test("a ride that has come due: the notice appears and the exit moves", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const service = await serviceOf();
  const ride = declaration({ origin: WHARF, to: PANDO, at: T0, ms: 4 * HOUR });
  const b = rideBlockFrom({ vesselId: SHIP, service, acts: [entered(WHARF), rode(ride)], nowMs: T0 + 4 * HOUR });

  assert.equal(b.arrived.at, PANDO);
  assert.equal(b.arrived.since, ride.arrives_at);
  assert.match(b.arrived.note, /You have arrived at/);
  assert.match(b.how_to_leave, new RegExp(`sets you down at ${PANDO.replace("/", "\\/")}`));
  assert.match(b.how_to_leave, /your ride has come due/);
});

test("aboard having declared nothing: entered, with no ride and no notice", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const service = await serviceOf();
  const b = rideBlockFrom({ vesselId: SHIP, service, acts: [entered(WHARF)], nowMs: T0 });
  assert.equal(b.entered_via, WHARF);
  assert.equal(b.ride, null, "null, because the block always carries the field and today it is empty");
  assert.equal(b.arrived, undefined);
  assert.match(b.how_to_leave, new RegExp(`sets you down at ${WHARF.replace("/", "\\/")}`));
  assert.ok(b.can_ride_to.length > 0, "and the stops she could take you to are on the answer");
  assert.ok(!b.can_ride_to.some((s) => s.mark === WHARF), "every stop BUT the one the numbers are measured from");
});

test("aboard with no entry stop the office can prove: the exit refuses to move you", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // The drained-enter case the deposit rule was written for: safe, and it must
  // SAY it is being safe rather than name a stop it cannot prove.
  const service = await serviceOf();
  const b = rideBlockFrom({ vesselId: SHIP, service, acts: [{ action: "enter", object: SHIP, payload: {} }], nowMs: T0 });
  assert.equal(b.entered_via, null);
  assert.match(b.how_to_leave, /steps you out of her where she is/);
  assert.match(b.how_to_leave, /cannot say which stop you came in through/);
});

test("ONE INSTANT drives all three clock reads — the arrival, the exit, and the stop list", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // THE CARRY THIS CASE HOLDS: where this block was composed before, the three
  // clock reads underneath took `Date.now()` SEPARATELY — `arrivedNotice`,
  // `depositAt`, and `vehicleGroundExtras`'s own default — so a block assembled
  // across a ride's own arrival could say two things about one moment. `nowMs`
  // is one parameter now, and this is the case that can fail if it is ever
  // un-threaded: at one millisecond either side of `arrives_at`, ALL THREE
  // answers move together.
  const service = await serviceOf();
  const ride = declaration({ origin: WHARF, to: PANDO, at: T0, ms: 4 * HOUR });
  const acts = [entered(WHARF), rode(ride)];
  const due = Date.parse(ride.arrives_at);

  const before = rideBlockFrom({ vesselId: SHIP, service, acts, nowMs: due - 1 });
  const after = rideBlockFrom({ vesselId: SHIP, service, acts, nowMs: due });

  assert.equal(before.arrived, undefined, "1: the notice");
  assert.ok(after.arrived, "1: the notice");

  assert.match(before.how_to_leave, new RegExp(WHARF.replace("/", "\\/")), "2: the exit");
  assert.match(after.how_to_leave, new RegExp(PANDO.replace("/", "\\/")), "2: the exit");

  // 3: the stop list is filtered on `measured_from`, which `rideOrigin` moves to
  // the destination once the ride has come due. So the destination LEAVES the
  // list and the entry stop RE-ENTERS it — on the same instant, or the three
  // reads are not the same read.
  const marks = (b) => b.can_ride_to.map((s) => s.mark);
  assert.ok(marks(before).includes(PANDO) && !marks(before).includes(WHARF), "3: the stop list, before");
  assert.ok(marks(after).includes(WHARF) && !marks(after).includes(PANDO), "3: the stop list, after");
});

test("the CONTROL: one millisecond is the only difference, and the rest of the block does not move", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // The case above would pass equally well if `rideBlockFrom` returned a
  // different object wholesale on either side of the instant. This is the leg
  // that says only the clock-driven fields moved — and it can stay green while
  // that one fails, which is what makes it a control and not a second pin.
  const service = await serviceOf();
  const ride = declaration({ origin: WHARF, to: PANDO, at: T0, ms: 4 * HOUR });
  const acts = [entered(WHARF), rode(ride)];
  const due = Date.parse(ride.arrives_at);
  const before = rideBlockFrom({ vesselId: SHIP, service, acts, nowMs: due - 1 });
  const after = rideBlockFrom({ vesselId: SHIP, service, acts, nowMs: due });

  assert.equal(before.vehicle, after.vehicle);
  assert.equal(before.entered_via, after.entered_via);
  assert.deepEqual(before.ride, after.ride, "the declaration itself is a row and a clock does not edit it");
  assert.equal(before.can_ride_to.length, after.can_ride_to.length, "the same stop count, a different one held out");
});

test("no service: the block still answers, without a stop list it cannot compute", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // An office that cannot read the timetable must not answer an EMPTY stop list
  // — "she goes nowhere" and "I could not read where she goes" are two facts.
  const b = rideBlockFrom({ vesselId: SHIP, service: null, acts: [entered(WHARF)], nowMs: T0 });
  assert.equal(b.vehicle, SHIP);
  assert.equal(b.entered_via, WHARF);
  assert.equal(b.can_ride_to, undefined, "absent, not empty");
});

// ── THE WIRING, pinned on source shape ──────────────────────────────────────

test("ONE OWNER for the block: both readers call it, neither re-composes it", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // A SOURCE PIN, and weaker than a run — named as one. What it holds is the
  // thing a run in this tree cannot: that the frame block and the read compose
  // the SAME block, so a field added for one reader cannot go missing for the
  // other. The composition's own fields are asserted to exist in exactly one
  // file.
  const apex = readFileSync(new URL("../src/world-apex.mjs", import.meta.url), "utf8");
  const ride = readFileSync(new URL("../src/world-ride.mjs", import.meta.url), "utf8");

  const calls = apex.match(/rideBlockFrom\(\{/g) ?? [];
  assert.equal(calls.length, 2, "two gatherers — `vehicleFrameExtras` and `rideDomain` — and no third composition");

  assert.equal((ride.match(/entered_via:/g) ?? []).length, 1, "the block is composed in one place");
  assert.equal((apex.match(/entered_via:/g) ?? []).length, 0, "and it is not this file any more");

  // And the read is a CASE, not a widening of the unwired default.
  assert.match(apex, /case "ride":\s*\n\s*return \{ ride: await rideDomain\(oriented, key\) \};/);
  assert.ok(!/result: await rideDomain/.test(apex), "the act branch's envelope key never reaches the read branch");
});
