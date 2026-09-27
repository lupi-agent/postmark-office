// world-ride.test.mjs — THE POST OFFICE AS A PORTAL (postmark-town/postmark#2986).
//
//   node --test test/world-ride.test.mjs
//
// Every test carries the VERBATIM ruling it asserts. Keemin ruled this in
// conversation on 2026-09-19 and the brief quotes him in order; a test that
// quoted the brief's paraphrase would guard the paraphrase.
//
// ── WHAT IS REAL HERE AND WHAT IS A FIXTURE ─────────────────────────────────
//
// The world clone is REAL: the fold, `tools/enter-exit.mjs`, `tools/world-verbs.mjs`
// and `tools/vessel.mjs` are the ones this office deploys against, so a drift
// between the two repos reds here rather than in front of a resident.
//
// THE FIXTURE BECAME THE RECORD on 2026-09-19 at 18:31 EDT — world main
// `6625d737` (PR #113) plants `class: vehicle` on `the-town/the-post-office`,
// the `vehicle` and `ride` class marks, and the Snug mooring on the wheelhouse.
// `vehicleWorld()` below no longer patches anything: it FOLDS THE REAL WORKS
// with the world's own `tools/marks-fold.mjs`, so what these tests run against
// is the town's law rather than this lane's idea of it.
//
// ⚑ AND `WORLD/world-state.json` AT THAT SHA WAS STALE, which is why the fold
// is run here rather than the committed file read. The merged PR changed the
// Works SOURCE (`WORLD/marks/**/mark.md`) and the fold is regenerated at the
// settlement, so at `6625d737` the committed fold still carried the pre-PR
// marks: no `class:` on her, three stops, no `ride` mark.
//
// ⚑ AND THAT STALENESS EXPIRED. The settlement caught the committed fold up at
// world `54a437a7` (2026-09-20), `class: vehicle` landed in the file, and the
// six legs whose control was `plainWorld()` went red — and stayed red on the
// train until POS-191. The control is now DERIVED rather than read; see
// `plainWorld()` below. Nothing in the office regressed and nothing the tests
// assert about the office changed: a record this suite treated as a fixture
// moved, which is what a record does.
//
// ⚑ AND THE STOP LIST IS FOUR, NOT FIVE. Folded off `6625d737`: the wheelhouse
// names `the-town/the-post-office` (her own berth), the Pando landing, the
// Garrison's grove wharf and the Snug mooring. Vermillion's landing and the
// brass-otter mooring are places residents have WALKED to, which is a different
// fact.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CROSSING_MS, anchorOfStop, arrivedNotice, depositAt, doorstepTransport, hasArrived,
  isVehicleStop, rideMillis, rideOrigin, rideRefusal, rideStateFrom, rideViaOffice,
  depositPointFor, ringLegInto, stopAnnotationFor, stopUnderfoot, stopsOfService,
  straightLineM, transportAt, vehicleGroundExtras, vesselIdOf,
} from "../src/world-ride.mjs";
import { VEHICLE_CLASS, crossingLaw, enterViaOffice, exitViaOffice, groundBlockOf, portalEntryFor } from "../src/world-crossings.mjs";
import { spineWithVehicles } from "../src/world-apex.mjs";
import { entriesOfClass, guardsPass, resolveGrants } from "../src/world-grants.mjs";
import { leavingWhileOccupying, vehicleStandpoint, vehicleWithin, worldHasVehicle } from "../src/world-movement.mjs";
import { carriersFrom, inRect } from "../src/world-frames.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

// It resolved `join(process.cwd(), "..", "postmark-world")` — a different
// directory in every tree, and in a pool tree a sibling slot that is not
// there, so every case below SKIPPED while a world clone sat beside the
// office the whole time. A silent skip is not a pass.
const CLONE = worldClone();
const GRAMMAR = CLONE && ["enter-exit.mjs", "thresholds.mjs"].find((n) => existsSync(join(CLONE, "tools", n)));
const HAVE_CLONE = Boolean(GRAMMAR) && existsSync(join(CLONE, "WORLD", "world-state.json"));
const WHY_NOT = CLONE ? `the world clone at ${CLONE} is missing the enter-exit grammar or WORLD/world-state.json` : NO_WORLD;

const SHIP = "the-town/the-post-office";
const WHEELHOUSE = "the-town/the-wheelhouse";
const PANDO = "the-town/the-pando-landing";
const WHARF = "sol-of-garrison/grove-wharf";
const SNUG = "current-the-reader/the-snug-mooring";

const key = (...handles) => ({ handles: new Set(handles) });

// The world's own fold, imported from the clone like every other engine module
// this suite leans on.
const FOLD = HAVE_CLONE ? await import(pathToFileURL(join(CLONE, "tools", "marks-fold.mjs")).href) : null;

/** THE REAL WORKS, folded by the world's own tool. Nothing patched. */
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

/** THE CONTROL every "the law gates the physics" leg needs: this same world
 *  with the vehicle class LIFTED, and nothing else changed.
 *
 *  ⚑ IT USED TO READ THE COMMITTED FOLD — `WORLD/world-state.json` — on the
 *  reasoning that at `6625d737` that file was still pre-PR (no `class:` on her)
 *  and so a real artifact rather than a hand-emptied copy. That reasoning had a
 *  clock in it. The committed fold is REGENERATED AT EVERY SETTLEMENT: world
 *  `54a437a7` (settlement sweep, 2026-09-20) swept `class: vehicle` into it,
 *  the control stopped being a pre-class world, and six legs of this file stood
 *  red from that crossing until POS-191. A live record pinned as a fixture
 *  decays with the next crossing.
 *
 *  So the control is now DEFINED by the one property it needs. `worldHasVehicle`
 *  (src/world-movement.mjs) gates on exactly this: a mark whose `class` is
 *  `vehicle` and which is not itself a class row. Clearing that predicate and
 *  nothing else is what makes these legs a control — one variable between the
 *  two worlds — rather than two unrelated folds compared. It cannot decay,
 *  because it is derived from whatever the world is today. */
function plainWorld() {
  const w = vehicleWorld();
  const carriesTheClass = (m) => String(m?.class ?? "") === VEHICLE_CLASS && m?.kind !== "class" && m?.subkind !== "class";
  return {
    ...w,
    marks: w.marks.map((m) => {
      if (!carriesTheClass(m)) return m;
      const { class: _lifted, ...withoutTheClass } = m;
      return withoutTheClass;
    }),
  };
}

const markIn = (w, id) => w.marks.find((m) => m.id === id) ?? null;

/**
 * A whole office in a closure — the crossings suite's harness, plus the two
 * reads the portal added: this actor's journal rows, and what a class lends.
 */
async function officeWith({ standing = { x: -1380, y: -2543 }, ledger = "", at = 200, nowMs = Date.UTC(2026, 8, 19, 20, 0, 0), world = null, lends = {} } = {}) {
  const worldState = world ?? vehicleWorld();
  const mod = await import(`file:///${join(CLONE, "tools", GRAMMAR).replace(/\\/g, "/")}`);
  const thresholds = mod.parseEnterExitLedger ? mod : { ...mod, parseEnterExitLedger: mod.parseThresholdLedger };
  let text = ledger;
  let clock = nowMs;
  let where = { ...standing };
  const written = [];
  const journal = [];
  const stops = [];
  const deps = {
    world: async () => worldState,
    ledger: async () => text,
    standpointOf: async (who) => ({ ...where, name: who }),
    within: async (who) => [...(thresholds.occupancyAt(thresholds.parseEnterExitLedger(text).acts, at).get(who) ?? [])],
    acts: async (who) => journal.filter((j) => j.actor === who).map(({ actor, ...rest }) => rest),
    lends: async (id) => lends[id] ?? [],
    now: () => at,
    nowMs: () => clock,
    crossing: () => at,
    walking: async () => null,
    stop: async (who, pt, _key, opts) => { stops.push({ who, ...pt, ...(opts?.from ? { from: { x: opts.from.x, y: opts.from.y } } : {}) , ...(opts?.exit === true ? { exit: true } : {}) }); where = { x: pt.x, y: pt.y }; return { ok: true }; },
    record: async (entry) => {
      const { handle, act, lines = [], mark = null, via = null, set_down_at = null, arrived = null, action, object, payload } = entry;
      if (action === "ride") {
        journal.push({ actor: handle, action: "ride", object, payload });
        return { seq: journal.length };
      }
      written.push(...lines);
      text += lines.join("\n") + "\n";
      journal.push({ actor: handle, action: act, object: mark,
        payload: { ...(via ? { via } : {}), ...(set_down_at ? { set_down_at } : {}), ...(arrived == null ? {} : { arrived }) } });
      const acts = thresholds.parseEnterExitLedger(text).acts;
      return { lines, within: thresholds.occupancyAt(acts, at).get(handle) ?? [], commit: "deadbeef", pushed: false, seq: journal.length };
    },
  };
  return {
    deps, written, journal, stops, worldState,
    setClock: (ms) => { clock = ms; },
    standAt: (pt) => { where = { ...pt }; },
    within: (who) => [...(thresholds.occupancyAt(thresholds.parseEnterExitLedger(text).acts, at).get(who) ?? [])],
    text: () => text,
  };
}

/** The vessel service, from the clone's own engine over a given fold. */
async function serviceOf(worldState) {
  const vessel = await import(`file:///${join(CLONE, "tools", "vessel.mjs").replace(/\\/g, "/")}`);
  const { services } = vessel.servicesFromFold({ marks: worldState.marks });
  return services.find((s) => s.markId === WHEELHOUSE) ?? services[0] ?? null;
}

// ── the arithmetic, asserted LONGHAND ────────────────────────────────────────

test("the ride's clock is the same half-day the walk ledger is quoted against", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const walk = await import(`file:///${join(CLONE, "tools", "walk.mjs").replace(/\\/g, "/")}`);
  assert.equal(CROSSING_MS, walk.CROSSING_MS,
    "world-ride.mjs keeps its own copy of the crossing period so it can stay pure; if the clone's ever changes, this is the line that says so");
  assert.equal(CROSSING_MS, 43_200_000);
});

test("arrives_at is the straight line over the timetable's own pace — computed longhand, not by calling the implementation", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // Keemin, ruling 3: "they can take it to their destination at Post Office
  // speed as if it was going directly there".
  const w = vehicleWorld();
  const service = await serviceOf(w);
  assert.equal(service.pace, 405, "the pace is READ from the wheelhouse — one owner, and this is the number it owns");

  const a = markIn(w, SHIP).at, b = markIn(w, PANDO).at;
  // longhand, so a wrong formula in the module cannot make this agree with it
  const dx = b.x - a.x, dy = b.y - a.y;
  const expectedM = Math.sqrt(dx * dx + dy * dy);
  const expectedMs = (expectedM / (405 * 1000)) * 43_200_000;

  // `Math.hypot` and `sqrt(dx^2+dy^2)` differ in the last bit — which is the
  // point of computing it the other way here rather than calling the module.
  assert.ok(Math.abs(straightLineM(a, b) - expectedM) < 1e-6, `${straightLineM(a, b)} vs ${expectedM}`);
  assert.ok(Math.abs(rideMillis(expectedM, 405) - expectedMs) < 1e-6);
  // and the figure the brief quotes for this leg: ~135 km, ~4 h
  assert.ok(Math.abs(expectedM / 1000 - 133.8) < 0.5, `the Pando leg measures ${(expectedM / 1000).toFixed(1)} km`);
  assert.ok(Math.abs(expectedMs / 3_600_000 - 3.96) < 0.05, `the Pando leg times at ${(expectedMs / 3_600_000).toFixed(2)} h`);
});

test("the Snug leg is the arithmetic over a PINNED pair of anchors, not whatever the fold says today", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // ⚑ THIS LEG USED TO SAY THE BRIEF WAS WRONG, AND IT WAS THE RECORD THAT WAS.
  // The brief's § 2 says "quay → the Snug mooring ≈ 4.9 km ≈ 9 min". Written off
  // world main 5beca99a, the fold put the Snug mooring at (-708, 9950) — 9,939 m
  // from her berth, ~17.7 min at pace 405 — and this leg pinned that, on the
  // reasoning that a number in a brief is what a later reader takes for the
  // record. The 9,939 m was itself the defect: world `a7c866f1` (2026-09-20,
  // "the Snug mooring comes home") records that the 09-14 amendment wrote the
  // ABSOLUTE point (-358, 4972) into a PARENT-RELATIVE field, so the mooring
  // resolved ~5 km out to sea from S71 until the repair. With `at: {-8, -6}`
  // against the harbour it folds to (-358, 4972) — 4,949 m, 8.8 min, which is
  // the brief's figure after all.
  //
  // A SYNTHETIC RECORD, so this cannot decay a second time: the two anchors are
  // COPIED here off world `a7c866f1`, folded 2026-09-22, and the arithmetic is
  // asserted against the copy. No live path, no date. The live fold is read in
  // this file's stop-set and transport legs; what this one owns is the sum.
  const RECORD = Object.freeze({           // world a7c866f1 · folded 2026-09-22
    ship: Object.freeze({ x: -9, y: 35.5 }),   // the-town/the-post-office
    snug: Object.freeze({ x: -358, y: 4972 }), // current-the-reader/the-snug-mooring
  });
  const d = straightLineM(RECORD.ship, RECORD.snug);
  assert.ok(Math.abs(d - 4948.8) < 0.5, `the Snug leg measures ${Math.round(d)} m`);
  assert.ok(Math.abs(rideMillis(d, 405) / 60000 - 8.8) < 0.05,
    `the Snug leg times at ${(rideMillis(d, 405) / 60000).toFixed(2)} min`);
});

// ── the stop set ─────────────────────────────────────────────────────────────

test("the stop set is the timetable's, and it names the vessel's own berth", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  assert.deepEqual(stopsOfService(service).map((s) => s.markId), [SHIP, PANDO, WHARF, SNUG]);
  assert.equal(vesselIdOf(service), SHIP);
  assert.ok(isVehicleStop(WHARF, service));
  assert.ok(isVehicleStop(SHIP, service), "her own berth IS on the published word; what it is not is a destination");
  assert.ok(!isVehicleStop("the-town/the-lochan", service));
});

// ── ENTER: a stop is a door into the vehicle ─────────────────────────────────

test("a stop is a door into the vehicle, and the mark you named is what the reach is measured at", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // Keemin, ruling 2: "every Post Office stop mark … acts as a Portal into the
  // Post Office, which (as portals do) has different physical rules than usual."
  const o = await officeWith({ standing: { x: -1380, y: -2543 } }); // ON the grove wharf
  const service = await serviceOf(o.worldState);
  const portal = portalEntryFor(WHARF, o.worldState, service);
  assert.deepEqual({ vessel: portal.vessel, stop: portal.stop }, { vessel: SHIP, stop: WHARF });

  const terms = await enterViaOffice(CLONE, { mark: WHARF, handle: "rider" }, key("rider"), o.deps);
  assert.equal(terms.target, SHIP, "you are shown the VESSEL's terms, not the wharf's — that is the portal");
  assert.equal(terms.via, WHARF);
  assert.ok(terms.awaiting, "her entry law declares an `aboard` counter-edge, so the first call is the terms");
  assert.deepEqual(o.written, [], "and nothing reached the pen");

  const went = await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  assert.deepEqual(went.entered, [SHIP]);
  assert.deepEqual(went.within, [SHIP]);
  assert.equal(went.via, WHARF);
  assert.equal(o.written.length, 1, "ONE enter row — the brief's own words, and the reason the portal crossing does not run the chain");
  assert.match(o.written[0], /rider · enters the-town\/the-post-office/);
});

test("the portal crossing writes ONE row where the geometric chain would have written THREE", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // The measurement this design rests on. `enterExitPlan` computes the Post
  // Office's chain as town-centre → quay-reach → the-post-office, so running a
  // portal entry through `verbs.enter` would have put a resident standing on the
  // Garrison's wharf inside the town centre, five kilometres from any of it.
  const verbs = await import(`file:///${join(CLONE, "tools", "world-verbs.mjs").replace(/\\/g, "/")}`);
  const w = vehicleWorld();
  const plan = verbs.enterExitPlan({ x: -1380, y: -2543 }, SHIP, w, { occupancy: new Map(), handle: "rider" });
  assert.deepEqual(plan.chain, ["the-town/the-town-centre", "the-town/the-quay-reach", SHIP],
    "if this ever becomes one link on its own, the portal's single-link adjudication can be reconsidered");

  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  assert.deepEqual(o.within("rider"), [SHIP],
    "a rider is inside HER and nothing else — not the town centre they have never been within 5 km of");
});

test("a door is still entered from within its reach, and the refusal names the STOP", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith({ standing: { x: 0, y: 0 } }); // the Origin, nowhere near the wharf
  await assert.rejects(
    () => enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps),
    (e) => e.code === 409 && e.defect.includes(WHARF) && e.walk?.mark === WHARF);
  assert.deepEqual(o.written, [], "nothing was recorded");
});

test("a stop is a door only where the vehicle class stands — the law gates the physics", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // In a world with no `class: vehicle` anywhere, the portal does not exist and
  // the wharf is an ordinary mark. That is what let this office ship ahead of
  // the Keeping Works half — and it is still the property the gate rests on, so
  // it is asserted against a world built to lack the class rather than against
  // whichever world happens to lack it this week.
  const plain = plainWorld();
  const service = await serviceOf(plain);
  assert.equal(portalEntryFor(WHARF, plain, service), null);
  assert.equal(worldHasVehicle(plain), false);
  assert.equal(worldHasVehicle(vehicleWorld()), true);
});

test("her own berth is not a portal into herself", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  assert.equal(portalEntryFor(SHIP, w, service), null,
    "entering her while standing on her is the ordinary chain crossing it has always been");
});

// ── the ground block (§ 5) ───────────────────────────────────────────────────

test("a class that LENDS answers its body and its roster at the threshold — terms call and crossing both", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // Keemin, ruling 10: "some kind of message be given to an agent upon
  // enter-verb into the Post Office (or any Portal for that matter) that
  // concisely explains the 'rules' of that portal space."
  const o = await officeWith({ lends: { [SHIP]: ["ride"] } });
  const terms = await enterViaOffice(CLONE, { mark: WHARF, handle: "rider" }, key("rider"), o.deps);
  assert.equal(terms.ground.class, VEHICLE_CLASS);
  assert.deepEqual(terms.ground.lends, ["ride"]);
  assert.ok(terms.ground.rules, "`rules` IS the class mark's own body — edit the law and the door follows");
  assert.equal(terms.ground.your_origin, null, "nobody has entered yet, so an origin — a RIDE's concept — is still null");
  // POS-161: the law that used to stand here read "with no origin the minutes
  // are null rather than invented". Invented was never the alternative — the
  // stop being KNOCKED at is where the rider is standing, and the block now
  // measures from it and names it.
  assert.equal(terms.ground.measured_from, WHARF,
    "with no origin the numbers are taken from the stop being knocked at, and the block says which");
  const stopAt = Object.fromEntries(stopsOfService(await serviceOf(vehicleWorld())).map((s) => [s.markId, s.at]));
  const pandoM = Math.round(Math.hypot(stopAt[PANDO].x - stopAt[WHARF].x, stopAt[PANDO].y - stopAt[WHARF].y));
  assert.ok(pandoM > 1000, "the fixture's own premise: the landing and the wharf are two different places");
  const pando = terms.ground.stops.find((s) => s.mark === PANDO);
  assert.equal(pando.distance_m, pandoM,
    "the straight line WHARF -> PANDO out of the fixture's own timetable, rounded");
  assert.ok(pando.ride_minutes > 0, "and a ride time a rider deciding whether to board can actually read");
  assert.equal(terms.ground.stops.some((s) => s.mark === WHARF), false,
    "you cannot ride to the stop you are knocking at");

  const went = await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  assert.equal(went.ground.class, VEHICLE_CLASS, "the block rides the ACCEPTING call too, not only the terms");
  assert.deepEqual(went.ground.lends, ["ride"]);
});

test("the ground block is general: no roster, no block — and it is ABSENT rather than empty", () => {
  assert.equal(groundBlockOf({ classMark: { class: "parcel", body: "a parcel" }, lends: [] }), null);
  assert.equal(groundBlockOf({ classMark: null, lends: ["ride"] }), null);
  const b = groundBlockOf({ classMark: { class: "arena", body: "a ring" }, lends: ["strike", "strike", "guard"] });
  assert.deepEqual(b.lends, ["strike", "guard"], "one entry per verb, whatever the roster's shape");
  assert.equal(b.class, "arena");
});

// ── RIDE ─────────────────────────────────────────────────────────────────────

test("ride names a destination from aboard, and writes ONE journal act with the brief's payload", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // Keemin, ruling 7: "have the journal write the act as 'ride' not 'board'".
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const r = await rideViaOffice(CLONE, { to: PANDO, handle: "rider" }, key("rider"), o.deps);

  const w = o.worldState;
  const dx = markIn(w, PANDO).at.x - markIn(w, WHARF).at.x;
  const dy = markIn(w, PANDO).at.y - markIn(w, WHARF).at.y;
  const expectedM = Math.round(Math.sqrt(dx * dx + dy * dy));
  assert.equal(r.ride.origin, WHARF, "measured from the door you came in by, not from the hull");
  assert.equal(r.ride.to, PANDO);
  assert.equal(r.ride.distance_m, expectedM);
  assert.equal(r.ride.pace_km_per_crossing, 405);
  // THE ROW MUST BE RE-DERIVABLE FROM ITS OWN PUBLISHED INPUTS. This is the
  // assertion that caught the 24 ms disagreement: the timer had been computed
  // from the unrounded line while `distance_m` published the rounded one, so a
  // reader recomputing the arrival from the row got a different instant than the
  // row carried.
  assert.equal(Date.parse(r.ride.arrives_at) - Date.parse(r.ride.declared_at),
    Math.round((r.ride.distance_m / (r.ride.pace_km_per_crossing * 1000)) * 43_200_000),
    "arrives_at must be exactly what the row's own distance and pace say it is");

  const rides = o.journal.filter((j) => j.action === "ride");
  assert.equal(rides.length, 1);
  assert.equal(rides[0].object, SHIP, "the act is performed ON the vehicle; the destination rides the payload");
  assert.deepEqual(Object.keys(rides[0].payload).sort(),
    ["arrives_at", "declared_at", "distance_m", "origin", "pace_km_per_crossing", "to"],
    "exactly the six fields the brief names — the summary sentence rides `effect`, the column the log already keeps one in");
});

test("ride off a vehicle's ground is refused, and the refusal names the class", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  await assert.rejects(
    () => rideViaOffice(CLONE, { to: PANDO, handle: "rider" }, key("rider"), o.deps),
    (e) => e.code === 422 && /not aboard/.test(e.defect) && e.hint.includes(WHARF));
});

test("the three refusals a destination can earn, each its own sentence", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const service = await serviceOf(vehicleWorld());
  assert.match(rideRefusal({ to: "", service }).defect, /ride where/);
  assert.match(rideRefusal({ to: "the-town/the-lochan", service }).defect, /not a stop/);
  // ⚑ HER OWN ID IS A VALID DESTINATION (Wright-ruled 2026-09-19). The draft
  // refused it, on the reading that a vehicle cannot be a place; the ruling is
  // that on this ring she is both — the quay stop IS her own mark, and a ride
  // from the wharf to `the-town/the-post-office` is the ride home.
  assert.equal(rideRefusal({ to: SHIP, origin: WHARF, service }), null,
    "the ride home must not be refused");
  assert.match(rideRefusal({ to: SHIP, origin: SHIP, service }).defect, /already bound from/,
    "and the ONE refusal left applies to her exactly as to any other stop");
  assert.match(rideRefusal({ to: PANDO, origin: PANDO, service }).defect, /already bound from/);
  assert.equal(rideRefusal({ to: PANDO, origin: WHARF, service }), null);
});

// ── THE ORIGIN RULE (ruling 9) ───────────────────────────────────────────────

test("a re-ride BEFORE arrival measures from the entry stop, and the time already spent is gone", () => {
  // Keemin, ruling 9, verbatim: "if a resident … redeclares a different
  // destination while on board, the Post Office computes the new time from their
  // initial entry stop if they haven't 'arrived' yet".
  const t0 = Date.UTC(2026, 8, 19, 20, 0, 0);
  const standing = { to: PANDO, origin: WHARF, arrives_at: new Date(t0 + 4 * 3600_000).toISOString() };
  const o = rideOrigin({ entryStop: WHARF, standingRide: standing, nowMs: t0 + 3.9 * 3600_000 });
  assert.deepEqual(o, { stop: WHARF, because: "entry" },
    "3.9 hours in and a minute from arriving, the origin is STILL the wharf — there are no intermediate points in a lobby");
});

test("a re-ride AFTER arrival measures from where the ride landed you", () => {
  // "…and from their exit stop if they have."
  const t0 = Date.UTC(2026, 8, 19, 20, 0, 0);
  const standing = { to: PANDO, origin: WHARF, arrives_at: new Date(t0).toISOString() };
  assert.deepEqual(rideOrigin({ entryStop: WHARF, standingRide: standing, nowMs: t0 }), { stop: PANDO, because: "arrived" },
    "at the exact instant it comes due, it has come due — `now >= arrives_at`");
  assert.deepEqual(rideOrigin({ entryStop: WHARF, standingRide: standing, nowMs: t0 - 1 }), { stop: WHARF, because: "entry" });
});

test("the origin rule end to end: the second ride's distance changes only after the first has come due", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const first = await rideViaOffice(CLONE, { to: PANDO, handle: "rider" }, key("rider"), o.deps);

  // before it comes due
  o.setClock(Date.parse(first.ride.arrives_at) - 1000);
  const early = await rideViaOffice(CLONE, { to: SNUG, handle: "rider" }, key("rider"), o.deps);
  assert.equal(early.ride.origin, WHARF);
  assert.equal(early.origin_because, "entry");
  assert.ok(early.replaced, "the latest ride wins, and the answer says what it replaced");

  // after THAT one comes due
  o.setClock(Date.parse(early.ride.arrives_at) + 1000);
  const late = await rideViaOffice(CLONE, { to: PANDO, handle: "rider" }, key("rider"), o.deps);
  assert.equal(late.ride.origin, SNUG, "you are at the Snug's door now, you simply have not stepped through it");
  assert.equal(late.origin_because, "arrived");
  assert.notEqual(late.ride.distance_m, first.ride.distance_m,
    "and the distance is genuinely a different leg — a test that only read `origin` would pass on a cosmetic change");
});

// ── EXIT: the deposit rule ───────────────────────────────────────────────────

test("exit BEFORE the timer sets you down at the stop you came in through", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // Keemin, ruling 8: "If the resident tries to exit before, they simply exit to
  // the stop they were at when they boarded."
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const r = await rideViaOffice(CLONE, { to: PANDO, handle: "rider" }, key("rider"), o.deps);
  o.setClock(Date.parse(r.ride.arrives_at) - 60_000);

  const out = await exitViaOffice(CLONE, { mark: SHIP, handle: "rider" }, key("rider"), o.deps);
  assert.equal(out.set_down.at, WHARF);
  assert.equal(out.set_down.arrived, false);
  assert.ok(out.ride_abandoned, "and the answer says the ride was not wasted so much as not waited for");
  assert.deepEqual(o.within("rider"), []);

  const anchor = anchorOfStop(WHARF, await serviceOf(o.worldState));
  assert.deepEqual(o.stops.at(-1), { who: "rider", x: anchor.x, y: anchor.y, from: { x: anchor.x, y: anchor.y } },
    "the deposit is a ZERO-LENGTH DEPARTURE through the walk act — never a second pen — and it SAYS its origin: "
    + "the movement record still has this body at the stop it boarded at, so a leg that took `from` off the record "
    + "would be a road from the boarding stop to the landing (12.5 km on dev's first walk, 2026-09-20), not a set-down");
});

test("exit AT OR AFTER the timer sets you down at the destination", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const r = await rideViaOffice(CLONE, { to: SNUG, handle: "rider" }, key("rider"), o.deps);
  o.setClock(Date.parse(r.ride.arrives_at));

  const out = await exitViaOffice(CLONE, { mark: SHIP, handle: "rider" }, key("rider"), o.deps);
  assert.equal(out.set_down.at, SNUG);
  assert.equal(out.set_down.arrived, true);
  const anchor = anchorOfStop(SNUG, await serviceOf(o.worldState));
  assert.deepEqual({ x: o.stops.at(-1).x, y: o.stops.at(-1).y }, { x: anchor.x, y: anchor.y },
    "the deposit point is the stop mark's own anchor — you stand ON the mooring");
  assert.deepEqual(o.stops.at(-1).from, { x: anchor.x, y: anchor.y },
    "and the leg's origin is that same anchor — a set-down at the landing, not a walk to it from the wharf");
});

// == postmark#3019 . THE DEPOSIT LEAVES THE REACH IT WAS BOARDED FROM ==
//
// dom-pidgey boarded her at the quay the ORDINARY way — walking to her hull at
// (-9, 35.5) and entering — which crosses the geometric chain and files them
// within `the-town/the-town-centre` and `the-town/the-quay-reach` as well as
// the hull. The vessel exit removes only the hull; the deposit then walks 9.9 km
// to the Snug, which carries them out of BOTH rooms, and DEC-5 refused it: "you
// are within the-town/the-quay-reach — this walk would carry you out of it
// without leaving". The exit was already on the ledger, so the rider was left
// out of the boat with no ground — `set_down.recorded: false`, standpoint at
// the Origin, and every door afterwards disagreeing about where they were.
//
// The deposit IS the leaving of whatever the boarding stop stood within, so it
// says so to the walk door in the door's own grammar (DEC-5's `exit: true`, the
// documented route for a caller who is within a room). The walk door keeps the
// judgement about WHAT is left — `leavingWhileOccupying` is its predicate and
// there is no second copy of it here.
test("#3019: a deposit that would carry the rider out of rooms they boarded from DECLARES the leaving", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const w = vehicleWorld();
  const po = markIn(w, SHIP);
  // Standing on her hull at the quay — inside the-quay-reach, which is inside
  // the-town-centre. This is the reporter's own boarding, not a constructed one.
  const o = await officeWith({ standing: { x: po.at.x, y: po.at.y } });
  await enterViaOffice(CLONE, { mark: SHIP, handle: "dom", accept: true }, key("dom"), o.deps);
  assert.deepEqual(o.within("dom"), ["the-town/the-town-centre", "the-town/the-quay-reach", SHIP],
    "the ordinary entry crosses the whole chain — this test is measuring nothing if the rider is only within the hull");

  const r = await rideViaOffice(CLONE, { to: SNUG, handle: "dom" }, key("dom"), o.deps);
  o.setClock(Date.parse(r.ride.arrives_at));
  const out = await exitViaOffice(CLONE, { mark: SHIP, handle: "dom" }, key("dom"), o.deps);

  assert.equal(out.set_down.at, SNUG);
  assert.equal(out.set_down.arrived, true);
  assert.deepEqual(o.within("dom"), ["the-town/the-town-centre", "the-town/the-quay-reach"],
    "the vessel exit removes the hull and leaves the rooms standing — that remainder is the whole cause of #3019");
  assert.equal(o.stops.at(-1).exit, true,
    "the deposit carries DEC-5's `exit: true`, so the walk door exits those rooms under the ledger's own discipline "
    + "before setting the rider down — without it the walk is refused 409 AFTER the exit is already written, which is "
    + "the stuck state dom-pidgey is in on prod (postmark#3019)");

  // ── TWO ROOMS MEANS TWO `exits` LINES, and that is asserted rather than
  // assumed (Wright, 2026-09-20: "the test's fixture should carry both … so the
  // two exits lines are asserted, not one").
  //
  // The exits themselves are written by the WALK door, and `deps.stop` here is a
  // fake, so this suite cannot observe the ledger rows. What it CAN do is ask
  // the walk door's own pure predicate — the same `leavingWhileOccupying` the
  // door calls, over the same remainder and the same deposit point — how many
  // marks this deposit leaves. Two, both named, and NEITHER a vehicle, which is
  // why `allVehicles` cannot spare the refusal and the flag is load-bearing.
  const law = await crossingLaw(CLONE);
  const byId = new Map((w.marks ?? []).map((m) => [m.id, m]));
  const stop = o.stops.at(-1);
  const leaving = leavingWhileOccupying(o.within("dom"), { x: stop.x, y: stop.y },
    (pt, id) => { const m = byId.get(id); return m ? law.verbs.pointWithinMark(pt, m) : null; });
  assert.deepEqual(leaving, ["the-town/the-quay-reach", "the-town/the-town-centre"],
    "the deposit leaves BOTH rooms, innermost outward — so the walk door writes an `exits` line for each, "
    + "which is exactly the pair dom-pidgey had to write by hand at 14:55:01 and 14:55:02");
  assert.equal(leaving.filter((id) => String(byId.get(id)?.class ?? "") === VEHICLE_CLASS).length, 0,
    "and neither is a vehicle, so the `allVehicles` narrowing cannot spare this walk the refusal — "
    + "without the flag DEC-5 bounces it, which is the defect");
});

// THE HALF NO BEHAVIOURAL TEST IN THIS SUITE CAN REACH, pinned because a flip
// proved it (2026-09-20). Removing `src/world-apex.mjs`'s forwarding line and
// running this whole file is GREEN 49/49: the harness supplies its own `stop`,
// so `crossingDeps()` is never on the path. A fix wired at the crossings end and
// dropped at the apex end would therefore ship looking fully tested, and the
// defect would come straight back on prod while the suite said nothing.
//
// This is a SOURCE pin and it is weaker than a behavioural one — it proves the
// line exists, not that the door honours it. What proves the whole chain is the
// dev rehearsal (2026-09-20 18:37Z): `recorded: true` where the same walk
// answered `recorded: false` eight minutes earlier on the base. The pin exists
// so a later hand cannot delete the wiring in silence between rehearsals.
test("#3019: the apex forwards `exit` to the walk door — the wiring no fake `stop` can exercise", () => {
  const src = readFileSync(new URL("../src/world-apex.mjs", import.meta.url), "utf8");
  assert.ok(/opts\?\.exit\s*===\s*true\s*\?\s*\{\s*exit:\s*true\s*\}/.test(src),
    "crossingDeps().stop must forward `opts.exit` into walkViaOffice's payload, and only when true. "
    + "Without this line the deposit declares its leaving to nobody: the crossings half passes the flag, "
    + "the walk door never sees it, DEC-5 refuses the deposit, and #3019 is back with every test green.");
});

test("#3019: a boarding from open ground carries NO `exit` — the flag is the remainder's, not the deposit's", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // Grove Wharf is a stop standing inside no room, and the portal crossing files
  // ONE row. Nothing is left behind by the exit, so the deposit declares nothing
  // and the call is byte-identical to w39.1's. This is the half that says the
  // flag is conditional on what the rider remains within rather than always-on.
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const r = await rideViaOffice(CLONE, { to: SNUG, handle: "rider" }, key("rider"), o.deps);
  o.setClock(Date.parse(r.ride.arrives_at));
  await exitViaOffice(CLONE, { mark: SHIP, handle: "rider" }, key("rider"), o.deps);

  assert.deepEqual(o.within("rider"), [], "nothing remains, so there is nothing to declare");
  assert.equal(Object.prototype.hasOwnProperty.call(o.stops.at(-1), "exit"), false,
    "no `exit` key at all on the stop call — a deposit from open ground is unchanged by this fix");
});

test("the exit's journal row carries set_down_at and arrived as FIELDS", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const r = await rideViaOffice(CLONE, { to: SNUG, handle: "rider" }, key("rider"), o.deps);
  o.setClock(Date.parse(r.ride.arrives_at));
  await exitViaOffice(CLONE, { mark: SHIP, handle: "rider" }, key("rider"), o.deps);
  const row = o.journal.filter((j) => j.action === "exit").at(-1);
  assert.equal(row.object, SHIP);
  assert.deepEqual(row.payload, { set_down_at: SNUG, arrived: true });
});

test("exiting with no ride and no `via` writes NO deposit — the crossing made before the portal existed still reads", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // A resident who boarded the old way (standing on her at the quay) carries no
  // entry stop, so the deposit rule declines to move them rather than setting
  // them down somewhere they cannot prove they came from.
  const mod = await import(`file:///${join(CLONE, "tools", GRAMMAR).replace(/\\/g, "/")}`);
  const line = mod.formatEnterExit({ handle: "oldhand", act: "enters", mark: SHIP, at: 199, word: "welcomed" });
  const o = await officeWith({ ledger: `${line}\n` });
  const out = await exitViaOffice(CLONE, { mark: SHIP, handle: "oldhand" }, key("oldhand"), o.deps);
  assert.equal(out.set_down, undefined);
  assert.deepEqual(o.stops, [], "no departure was written for them at all");
});

test("the deposit rule, pure and both ways", () => {
  const t0 = Date.UTC(2026, 8, 19, 20, 0, 0);
  const ride = { to: PANDO, origin: WHARF, arrives_at: new Date(t0).toISOString() };
  assert.deepEqual(depositAt({ entryStop: WHARF, standingRide: ride, nowMs: t0 }), { stop: PANDO, arrived: true });
  assert.deepEqual(depositAt({ entryStop: WHARF, standingRide: ride, nowMs: t0 - 1 }), { stop: WHARF, arrived: false });
  assert.deepEqual(depositAt({ entryStop: WHARF, standingRide: null, nowMs: t0 }), { stop: WHARF, arrived: false });
  assert.deepEqual(depositAt({ entryStop: null, standingRide: null, nowMs: t0 }), { stop: null, arrived: false });
});

// ── POSITION ABOARD ──────────────────────────────────────────────────────────

test("a rider's standpoint is the HULL's, and it tracks her along her ring — never the destination", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // Keemin, ruling 3 + ruling 6: "wherever a resident boards … as if it was going
  // directly there" and "we need the residents sitting still in a Post Office
  // interior". Both mean: no interpolation toward the destination.
  const w = vehicleWorld();
  const vessel = await import(`file:///${join(CLONE, "tools", "vessel.mjs").replace(/\\/g, "/")}`);
  const walkMod = await import(`file:///${join(CLONE, "tools", "walk.mjs").replace(/\\/g, "/")}`);
  const service = await serviceOf(w);

  // ⚑ "NEVER AT THE DESTINATION" IS THE WRONG PROBE, and the first run of this
  // file proved it: the Pando landing IS one of her berths, so at 12:00Z a rider
  // bound for Pando is standing exactly on Pando — legitimately, because her
  // hull is there. The property that actually distinguishes interpolation from
  // no-interpolation is the test below: the standpoint does not depend on the
  // ride at all.
  const seen = new Set();
  let moved = 0;
  // A whole day of her ring, sampled — she is a derived body, so this drives her
  // along a real path rather than asserting one point.
  for (let i = 0; i <= 24; i++) {
    const atMs = Date.UTC(2026, 8, 19, 0, 0, 0) + i * 3600_000;
    const hull = vessel.vesselPositionAt(service, walkMod.fractionalCrossing(atMs));
    const stand = await vehicleStandpoint("rider", w, { repo: CLONE, atMs, stack: [SHIP] });
    assert.ok(stand, "occupancy says aboard, so there is a standpoint");
    assert.equal(stand.x, hull.x);
    assert.equal(stand.y, hull.y);
    assert.equal(stand.aboard, true);
    assert.equal(stand.moving, false, "the rider sits still; the HULL is what may be under way");
    assert.equal(stand.frame, SHIP);
    const k = `${stand.x},${stand.y}`;
    if (!seen.has(k)) { seen.add(k); moved++; }
  }
  assert.ok(moved > 1, `the hull actually moved across the samples (${moved} distinct points) — a frozen boat would make every assertion above vacuous`);
});

test("the standpoint does not depend on the ride — the one property interpolation would break", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // This is the discriminating assertion for "no interpolation toward the
  // destination". A position that leaned on the ride would differ between a
  // rider bound for Pando, a rider bound for the Snug, and a rider bound
  // nowhere; a position that is the hull's cannot.
  const w = vehicleWorld();
  const t0 = Date.UTC(2026, 8, 19, 20, 0, 0);
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const atMs = t0 + i * 1800_000;
    const stand = await vehicleStandpoint("rider", w, { repo: CLONE, atMs, stack: [SHIP] });
    pts.push({ atMs, x: stand.x, y: stand.y });
  }
  assert.ok(new Set(pts.map((p) => `${p.x},${p.y}`)).size > 1,
    "the hull moved across these samples, so a drifting rider would have been visible");
  // `vehicleStandpoint` takes no ride and cannot: there is no argument by which
  // a destination could reach it. Asserted as a fact about the signature so a
  // future hand cannot quietly add one.
  assert.equal(vehicleStandpoint.length, 2, "vehicleStandpoint(handle, worldState, opts) — a third positional would be a destination sneaking in");
  const opts = { repo: CLONE, atMs: t0, stack: [SHIP] };
  const a = await vehicleStandpoint("rider", w, opts);
  const b = await vehicleStandpoint("rider", w, { ...opts, ride: { to: PANDO, arrives_at: new Date(t0 + 1).toISOString() } });
  assert.deepEqual({ x: b.x, y: b.y }, { x: a.x, y: a.y },
    "handing it a ride changes nothing, because nothing reads one");
});

test("the vehicle a stack puts you in is the innermost one, and an ordinary stack puts you in none", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const w = vehicleWorld();
  assert.equal(vehicleWithin([SHIP], w), SHIP);
  assert.equal(vehicleWithin(["the-town/the-town-centre", "the-town/the-quay-reach"], w), null);
  assert.equal(vehicleWithin([], w), null);
  assert.equal(vehicleWithin([SHIP], plainWorld()), null, "no class line, no vehicle — the law gates the physics");
});

test("the grant spine gains vehicles ONLY — a non-vehicle occupancy adds nothing", () => {
  const classOf = (id) => (id === SHIP ? VEHICLE_CLASS : "parcel");
  assert.deepEqual(spineWithVehicles(["the-town/the-quay-reach"], [SHIP], classOf),
    ["the-town/the-quay-reach", SHIP]);
  assert.deepEqual(spineWithVehicles(["the-town/the-quay-reach"], ["rei/the-looking-room"], classOf),
    ["the-town/the-quay-reach"],
    "DEC-5 already makes occupancy a subset of geometry for an ordinary mark; a stale row must not hand anybody a ground's verbs");
  assert.deepEqual(spineWithVehicles([SHIP], [SHIP], classOf), [SHIP], "and it never duplicates");
});

// ── THE ARRIVED NOTICE (§ 6) ─────────────────────────────────────────────────

test("the arrived notice is present exactly when now >= arrives_at, and absent once the ride is gone", () => {
  // Keemin, ruling 9: "We should also have an 'arrived' notification waiting for
  // residents." Derived: a replay at the same instant says the same thing.
  const t0 = Date.UTC(2026, 8, 19, 20, 0, 0);
  const ride = { to: SNUG, origin: WHARF, arrives_at: new Date(t0).toISOString() };
  assert.equal(arrivedNotice(ride, t0 - 1), null);
  const n = arrivedNotice(ride, t0);
  assert.equal(n.at, SNUG);
  assert.equal(n.since, ride.arrives_at);
  assert.match(n.note, /exit sets you down there/);
  assert.equal(arrivedNotice(ride, t0 + 86_400_000).note, n.note, "a replay far later says the same thing — nothing is marked read");
  assert.equal(arrivedNotice(null, t0), null, "and an exit ends it by ending the ride");
  assert.equal(hasArrived(ride, t0), true);
  assert.equal(hasArrived({ to: SNUG }, t0), false, "a ride with no arrives_at has not arrived; it is not an error");
});

test("the arrived notice ends when the exit does — the fold, end to end", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const r = await rideViaOffice(CLONE, { to: SNUG, handle: "rider" }, key("rider"), o.deps);
  const after = Date.parse(r.ride.arrives_at) + 1;

  let state = rideStateFrom(await o.deps.acts("rider"), { vesselId: SHIP });
  assert.ok(arrivedNotice(state.standingRide, after));

  o.setClock(after);
  await exitViaOffice(CLONE, { mark: SHIP, handle: "rider" }, key("rider"), o.deps);
  state = rideStateFrom(await o.deps.acts("rider"), { vesselId: SHIP });
  assert.equal(state.standingRide, null);
  assert.equal(state.entryStop, null);
  assert.equal(arrivedNotice(state.standingRide, after), null);
});

test("the ride fold: enter sets the door, ride replaces, exit clears — and other vessels are not this one", () => {
  const acts = [
    { action: "enter", object: SHIP, payload: { via: WHARF } },
    { action: "ride", object: SHIP, payload: { to: PANDO, origin: WHARF, arrives_at: "2026-09-19T22:00:00.000Z" } },
    { action: "ride", object: "the-town/some-other-cart", payload: { to: "elsewhere", origin: "x" } },
    { action: "ride", object: SHIP, payload: { to: SNUG, origin: WHARF, arrives_at: "2026-09-19T21:00:00.000Z" } },
  ];
  const s = rideStateFrom(acts, { vesselId: SHIP });
  assert.equal(s.entryStop, WHARF);
  assert.equal(s.standingRide.to, SNUG, "latest ride wins");
  const after = rideStateFrom([...acts, { action: "exit", object: SHIP, payload: {} }], { vesselId: SHIP });
  assert.deepEqual(after, { entryStop: null, standingRide: null });
});

// ── VISIBILITY (§ 11) ────────────────────────────────────────────────────────

test("a resident standing at a wharf is TOLD what the wharf is for", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  const t = transportAt(WHARF, service, w);
  assert.match(t.line, /the-town\/the-post-office calls here/);
  assert.match(t.line, /enter sol-of-garrison\/grove-wharf to board her/);
  assert.ok(t.ride_to.some((r) => r.mark === PANDO && r.ride_minutes > 0));
  assert.ok(t.ride_to.some((r) => r.mark === SHIP), "her own berth IS somewhere to ride to — the ride home");
  assert.ok(!t.ride_to.some((r) => r.mark === WHARF), "but not the stop you are standing on");
  assert.equal(transportAt("the-town/the-lochan", service, w), null, "and away from a stop there is no line at all");
  assert.equal(transportAt(WHARF, service, plainWorld()), null, "nor in a world whose law has not planted the class");
});

test("the transport line is offered at the ENTER door's reach, not the stop-answers' 25 m", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  const anchor = markIn(w, WHARF).at;
  assert.equal(stopUnderfoot({ x: anchor.x, y: anchor.y }, service, w), WHARF);
  assert.equal(stopUnderfoot({ x: anchor.x + 40, y: anchor.y }, service, w), WHARF,
    "40 m out the enter door would admit them, so the sentence has to reach them too");
  assert.equal(stopUnderfoot({ x: anchor.x + 500, y: anchor.y }, service, w), null);
  // ⚑ `stopUnderfoot` makes NO class promise — it answers "which stop are you
  // standing at", and a stop is a stop whatever the Keeping Works says. The
  // vehicle gate lives one level up, in `transportAt`, which is where a caller
  // asks "is there anything to tell them". Asserted so the division stays
  // deliberate rather than becoming a hole somebody plugs in the wrong file.
  assert.equal(stopUnderfoot({ x: anchor.x, y: anchor.y }, service, plainWorld()), WHARF);
  assert.equal(transportAt(WHARF, service, plainWorld()), null, "and the gate is HERE");
});

test("the doorstep's standing line names her, her stops, and the nearest one to you", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  const d = doorstepTransport(service, { x: -1380, y: -2500 }, w);
  assert.equal(d.vehicle, SHIP);
  assert.equal(d.stops, 4, "all four, her own berth included: it is a door you can stand at AND a place you can ride to, so counting three would be the doorstep disagreeing with the door");
  assert.equal(d.nearest.mark, WHARF);
  assert.match(d.line, /Enter a stop to board/);
  assert.equal(doorstepTransport(service, null, w).nearest, undefined, "with no standpoint there is no nearest, and none is invented");
  assert.equal(doorstepTransport(service, { x: 0, y: 0 }, plainWorld()), null);
});

test("a stop mark's card carries a derived annotation, and nothing is written on the resident's mooring", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  assert.match(stopAnnotationFor(SNUG, service, w), /a the-town\/the-post-office stop/);
  assert.equal(stopAnnotationFor(SHIP, service, w), null);
  assert.equal(stopAnnotationFor("the-town/the-lochan", service, w), null);
  assert.equal(markIn(w, SNUG).transport, undefined, "the mark itself carries nothing — the sentence is derived at the read");
});

test("the ground block's vehicle extras name the stops with the minutes from YOUR origin", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  const fromWharf = vehicleGroundExtras({ service, entryStop: WHARF });
  const fromSnug = vehicleGroundExtras({ service, entryStop: SNUG });
  assert.equal(fromWharf.your_origin, WHARF);
  assert.equal(fromSnug.your_origin, SNUG);
  const a = fromWharf.stops.find((s) => s.mark === PANDO).ride_minutes;
  const b = fromSnug.stops.find((s) => s.mark === PANDO).ride_minutes;
  assert.notEqual(a, b, "the minutes are measured from where YOU are, not from her berth");
  assert.equal(fromWharf.standing_ride, null);
});

// == THE BOARDING ANSWER, WITH NO ORIGIN (POS-161) ============================
//
// Pure-function legs, so the failure can be expressed without an office
// standing behind it: no entry stop, no standing ride, one knocked stop.

test("with NO origin the block measures from the stop being knocked at, and names it", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const service = await serviceOf(vehicleWorld());
  const g = vehicleGroundExtras({ service, entryStop: null, standingRide: null, knockedAt: WHARF });
  assert.equal(g.your_origin, null, "an origin is a RIDE's concept, and nobody has entered");
  assert.equal(g.measured_from, WHARF, "an instrument must say which thing it measured");
  const stopAt = Object.fromEntries(stopsOfService(service).map((s) => [s.markId, s.at]));
  for (const to of [SHIP, PANDO, SNUG]) {
    const row = g.stops.find((s) => s.mark === to);
    const d = Math.round(Math.hypot(stopAt[to].x - stopAt[WHARF].x, stopAt[to].y - stopAt[WHARF].y));
    assert.ok(d > 0, `the fixture's premise: ${to} and the wharf are two different places`);
    assert.equal(row.distance_m, d, `${to} is ${d} m from the wharf, off the fixture's own timetable`);
    assert.ok(Number.isFinite(row.ride_minutes) && row.ride_minutes > 0,
      `${to} is offered with ${row.ride_minutes} min, not a null a rider cannot decide on`);
  }
  assert.equal(g.stops.some((s) => s.mark === WHARF), false, "you cannot ride to the stop you are knocking at");
  assert.deepEqual(g.stops.map((s) => s.mark).slice().sort(), [SHIP, PANDO, SNUG].slice().sort(),
    "and every OTHER stop is still offered");
});

test("a mark that is not a stop measures nothing — the nulls stay, and measured_from says so", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // Her wheelhouse CARRIES the timetable and is not on it. Knocking somewhere
  // that is not a stop keeps exactly today's answer rather than inventing an
  // anchor for it.
  const service = await serviceOf(vehicleWorld());
  assert.equal(isVehicleStop(WHEELHOUSE, service), false,
    "the fixture's premise: the wheelhouse is not one of her stops");
  const g = vehicleGroundExtras({ service, entryStop: null, standingRide: null, knockedAt: WHEELHOUSE });
  assert.equal(g.measured_from, null, "nothing was measured, so the field names nothing");
  assert.equal(g.your_origin, null);
  assert.deepEqual(g.stops.map((s) => s.mark).slice().sort(), [SHIP, PANDO, WHARF, SNUG].slice().sort(),
    "every stop is still listed — a mark that measures nothing filters nothing out");
  for (const s of g.stops) assert.equal(s.distance_m, null, `${s.mark} has no distance to give`);
  for (const s of g.stops) assert.equal(s.ride_minutes, null, `${s.mark} has no minutes to give`);
  // And the call that passes NOTHING — every caller that does not know a
  // knocked stop, the apex's `can_ride_to` among them — is what it always was.
  const bare = vehicleGroundExtras({ service });
  assert.deepEqual(bare.stops, g.stops);
  assert.equal(bare.measured_from, null);
  assert.equal(bare.your_origin, null);
});

test("can_ride_to lists the quay from every stop but the quay itself", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // Wright's review, verbatim: the ground block's `can_ride_to` must list the
  // quay "from every stop but the quay itself". Driven over all four stops
  // rather than one, because a filter that happened to be right at the wharf and
  // wrong at the Snug would pass a single-origin check.
  const service = await serviceOf(vehicleWorld());
  const all = [SHIP, PANDO, WHARF, SNUG];
  for (const origin of all) {
    const listed = vehicleGroundExtras({ service, entryStop: origin }).stops.map((x) => x.mark);
    assert.deepEqual(listed.slice().sort(), all.filter((x) => x !== origin).sort(),
      `from ${origin} the block offers ${listed.join(", ")}`);
    assert.equal(listed.includes(origin), false, "the stop you are bound FROM is the one refusal, and the list says so");
    if (origin !== SHIP)
      assert.ok(listed.includes(SHIP), `the ride home is missing from ${origin}`);
  }
  // And every offered leg carries a real number, so "listed" is not the same as
  // "offered with nothing behind it".
  for (const x of vehicleGroundExtras({ service, entryStop: WHARF }).stops)
    assert.ok(Number.isFinite(x.distance_m) && Number.isFinite(x.ride_minutes) && x.ride_minutes > 0,
      `${x.mark} is offered with ${x.distance_m} m / ${x.ride_minutes} min`);
});

// == THE RIDE HOME, AND WHERE IT SETS YOU DOWN (Wright-ruled 2026-09-19) ==

test("her own berth is a destination, and the ride home is timed like any other leg", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith({ standing: { x: -1380, y: -2543 } });   // the grove wharf
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const r = await rideViaOffice(CLONE, { to: SHIP, handle: "rider" }, key("rider"), o.deps);
  assert.equal(r.ride.to, SHIP);
  assert.equal(r.ride.origin, WHARF);
  // Wright's measured leg for this ring: wharf -> quay 2.9 km.
  assert.ok(Math.abs(r.ride.distance_m / 1000 - 2.9) < 0.1, `wharf -> quay measured ${r.ride.distance_m} m`);
  assert.ok(Math.abs(r.minutes - 5) <= 1, `~5 min, measured ${r.minutes}`);
});

test("THE ONE STOP WHOSE ANCHOR IS THE WRONG ANSWER: exiting at the quay sets you down ASHORE, outside her footprint", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // Her anchor lies INSIDE her own footprint, so depositing there would put a
  // rider back in the hull they just left. `tools/vessel.mjs § ashoreOf` is the
  // old anti-conveyor landing, reused rather than a second offset invented here.
  const w = vehicleWorld();
  const o = await officeWith({ standing: { x: -1380, y: -2543 } });
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  const r = await rideViaOffice(CLONE, { to: SHIP, handle: "rider" }, key("rider"), o.deps);
  o.setClock(Date.parse(r.ride.arrives_at));
  const out = await exitViaOffice(CLONE, { mark: SHIP, handle: "rider" }, key("rider"), o.deps);

  assert.equal(out.set_down.at, SHIP);
  assert.equal(out.set_down.arrived, true);

  // ⛑ THE FOOTPRINT IS THE WORLD'S OWN, NOT A RECT BUILT HERE. Wright named
  // `footprintOf(service, QUAY)` in the review, and he is right that it has to
  // be that one: a copy of the rect arithmetic in this file would agree with the
  // engine the day it was written and disagree the first time either moved, and
  // the whole claim of this test is that a point is OUTSIDE a shape the engine
  // defines. `inRect` is likewise the office's own shared predicate.
  const service = await serviceOf(w);
  const vessel = await import(pathToFileURL(join(CLONE, "tools", "vessel.mjs")).href);
  const po = markIn(w, SHIP);
  const hull = vessel.footprintOf(service, po.at);

  assert.equal(inRect({ x: out.set_down.x, y: out.set_down.y }, hull), false,
    `set down at (${out.set_down.x}, ${out.set_down.y}), inside her ${hull.w}x${hull.h} footprint at (${hull.x}, ${hull.y})`);
  // THE POSITIVE CONTROL: her ANCHOR -- what every other stop deposits on -- IS
  // inside it, so this test can tell the fix from the bug rather than merely
  // observing that some point exists.
  assert.equal(inRect(po.at, hull), true,
    "her anchor is inside her own footprint -- that is the whole reason this stop is special, and if it ever stops being true this test is measuring nothing");
  assert.deepEqual(o.stops.at(-1), { who: "rider", x: out.set_down.x, y: out.set_down.y, from: { x: out.set_down.x, y: out.set_down.y } },
    "the ashore point is BOTH ends of the set-down — a zero-length departure there, not a walk to it");
});

test("the quay's deposit point is derived from the RING, so it does not wobble with the clock", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const w = vehicleWorld();
  const service = await serviceOf(w);
  const vessel = await import(pathToFileURL(join(CLONE, "tools", "vessel.mjs")).href);
  const walkMod = await import(pathToFileURL(join(CLONE, "tools", "walk.mjs")).href);

  const leg = ringLegInto(SHIP, service);
  assert.equal(leg.from.markId, SNUG, "the leg into the quay comes from the Snug mooring -- the ring, in the timetable's own order");
  const mine = depositPointFor(SHIP, service, { ashore: vessel.ashoreOf });

  // Every REAL sailing that arrives at the quay over two days, and they must all
  // agree with the ring-derived point.
  const fc = walkMod.fractionalCrossing(Date.UTC(2026, 8, 20, 12, 0, 0));
  const arrivals = vessel.sailingsBetween(service, fc - 2, fc + 2).filter((l) => l.to.markId === SHIP);
  assert.ok(arrivals.length >= 2, `only ${arrivals.length} arrivals at the quay in the window -- widen it rather than trusting one`);
  for (const l of arrivals)
    assert.deepEqual(vessel.ashoreOf(service, l), mine, "a real arrival disagrees with the ring-derived deposit");

  // And every OTHER stop still deposits on its own anchor, as the brief says.
  for (const id of [PANDO, WHARF, SNUG])
    assert.deepEqual(depositPointFor(id, service, { ashore: vessel.ashoreOf }), anchorOfStop(id, service));

  // With no `ashore` injected the quay answers NULL rather than her anchor: a
  // deposit this office cannot compute is one it declines to make.
  assert.equal(depositPointFor(SHIP, service, {}), null);
});

test("boarding her at the quay the ordinary way still names the door you came through", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // `vehicle/stops-are-doors` includes herself, and the quay stop IS her own
  // mark -- so a resident who enters her the way the town has always entered her
  // must be able to ride out. Without the `via`, they would be the one resident
  // who could not.
  const w = vehicleWorld();
  const po = markIn(w, SHIP);
  const o = await officeWith({ standing: { x: po.at.x, y: po.at.y } });
  const went = await enterViaOffice(CLONE, { mark: SHIP, handle: "quayside", accept: true }, key("quayside"), o.deps);
  assert.ok(went.entered.includes(SHIP));
  const entered = o.journal.filter((j) => j.action === "enter").at(-1);
  assert.equal(entered.payload.via, SHIP, "the door she came through is her own berth");
  const r = await rideViaOffice(CLONE, { to: SNUG, handle: "quayside" }, key("quayside"), o.deps);
  assert.equal(r.ride.origin, SHIP, "and the origin rule has something to measure from");
});

// == SEAM RULE 4 . the class row carriersFrom must treat as a no-op ==

test("a mechanic-less, extent-less `vehicle` class row is a NO-OP in carriersFrom -- not a crash, not a phantom carrier", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // Wright flagged this when the world half landed: `the-town/vehicle` now
  // declares `mobility: derived` with no `mechanic:` and no extent, and
  // `world-frames.mjs § carriersFrom` reads mobility off CLASS marks and finds
  // the body through MECHANIC_BODY. Measured here rather than reasoned about.
  const w = vehicleWorld();
  // The store's own projection, as `classFieldsFromStore` would hand it over.
  const classFields = new Map([
    ["the-town/vehicle", { class: VEHICLE_CLASS, mobility: "derived" }],
    [SHIP, { class: VEHICLE_CLASS, mobility: null }],
    [WHEELHOUSE, { class: "timetable", mobility: null }],
    ["the-town/timetable", { class: "timetable", mobility: "derived" }],
  ]);
  let carriers, threw = null;
  try { carriers = carriersFrom(w, { classFields }); } catch (e) { threw = String(e?.message ?? e); }
  assert.equal(threw, null, `carriersFrom threw on the new class rows: ${threw}`);

  const ids = carriers.map((c) => c.id);
  assert.ok(!ids.includes("the-town/vehicle"),
    "the CLASS MARK became a carrier -- a bare class declares what its instances do without doing it itself, and it has no extent to have an inside");
  assert.deepEqual(ids, [SHIP],
    "exactly one carrier, and she reaches it through the WHEELHOUSE's `mechanic: timetable` as she always has -- the class row adds nobody");
  assert.equal(carriers[0].declaredBy, WHEELHOUSE,
    "declared by the wheelhouse, not by `the-town/vehicle`: the new class row changed no carrier's provenance");

  // THE POSITIVE CONTROL, so this is not a test that passes on an empty read:
  // drop the timetable class's mobility and the ONE carrier disappears.
  const without = carriersFrom(w, { classFields: new Map([...classFields].filter(([k]) => k !== "the-town/timetable")) });
  assert.deepEqual(without.map((c) => c.id), [], "the probe can print a different answer");
});

// ── "FROM HERE YOU CAN: … RIDE" (§ 11 item 4) ────────────────────────────────

test("the vehicle's roster lends `ride` through the GROUND channel, and the guard fences it to her", () => {
  // § 11 item 4 says this line is FREE — "the existing affordance sentence, no
  // new code" — and free is a claim, not a fact, so here is the fact. The apex
  // builds that sentence from `entries.map((e) => e.action)` at
  // world-apex.mjs § the warm bounce, and `entries` is what the calculus below
  // returns. Nothing in this lane writes the sentence; this is what puts `ride`
  // into it.
  const vehicleClass = { id: "the-town/vehicle", class: VEHICLE_CLASS,
    actions: JSON.stringify([{ action: "ride", residue: "the-town/ride" }]) };
  const candidates = entriesOfClass(vehicleClass, { channel: "ground", ground: SHIP });
  const { entries } = resolveGrants(candidates, { kind: "resident" });
  assert.deepEqual(entries.map((e) => e.action), ["ride"]);
  assert.equal(entries[0].ground, SHIP, "the door names the ground that opened it");

  // And the residue's own gate, which is what stops `ride` following a resident
  // ashore: `the-town/ride` carries requires: {"within_class":"vehicle"}.
  const requires = { within_class: VEHICLE_CLASS };
  assert.deepEqual(guardsPass(requires, { spineClasses: [VEHICLE_CLASS] }), { ok: true });
  const off = guardsPass(requires, { spineClasses: ["parcel"] });
  assert.equal(off.ok, false);
  assert.match(off.why, /within a vehicle/, "the refusal names the CLASS, which is the sentence a resident reads");
});

test("a human is not lent `ride` — the roster carries no `for: human` entry", () => {
  // Brief § 10 item 3: "ride for humans: NO for w39 (humans are parcels-only
  // since 08-30; not reopened here)." The fence is the record's, not a list.
  const vehicleClass = { id: "the-town/vehicle", class: VEHICLE_CLASS,
    actions: JSON.stringify([{ action: "ride", residue: "the-town/ride" }]) };
  const candidates = entriesOfClass(vehicleClass, { channel: "ground", ground: SHIP });
  const asHuman = resolveGrants(candidates, { kind: "human" });
  assert.deepEqual(asHuman.entries, []);
  assert.equal(asHuman.refused.length, 1, "and they are TOLD, rather than left to infer it from an absence");
  assert.match(String(asHuman.refused[0].refused), /resident/);
});

test("the composed transport block: a vehicle world answers at a wharf, the real world answers nothing", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const { transportBlock } = await import("../src/world.mjs");
  const wharf = { x: -1380, y: -2543 };
  const t = await transportBlock(vehicleWorld(), wharf);
  assert.equal(t.stop, WHARF);
  assert.match(t.line, /calls here/);
  // ⚑ NOT THE ORIGIN. (0,0) is 36.6 m from her quay berth — inside the enter
  // door's reach — so since her berth became a stop it is emphatically NOT
  // "away from a stop", and the first run against the real tree said so.
  assert.equal(await transportBlock(vehicleWorld(), { x: 20000, y: 20000 }), null, "away from every stop, nothing");
  // THE POSITIVE CONTROL'S OPPOSITE: in a world where no mark carries
  // `class: vehicle`, `world_orient` and `world_open_your_eyes` at this exact
  // point answer with NO `transport` key at all. That is the correct answer and
  // it is why this office half could ship ahead of the Keeping Works half.
  assert.equal(await transportBlock(plainWorld(), wharf), null);
});

test("the transport line rides the NARRATIVE eyes shape, not only the diagnostic one", () => {
  // A visibility line that appeared only under `diagnostic: true` would be the
  // invisibility § 11 exists to close — and the first draft of this lane had
  // exactly that defect, which is why this reads the source rather than trusting
  // the diff. world.mjs's own ruling one screen above: "`diagnostic` is a
  // DIAGNOSTIC. Nothing the town's pages run is allowed to depend on it."
  const src = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
  const sites = [
    ["orient", "  return { standpoint: { ...at, stance: choice.stance }, crossing: { n: crossing, derivation: CROSSING_DERIVATION }, note, primer,"],
    ["eyes · diagnostic", "  const full = {"],
    ["eyes · narrative", "    stance: choice.stance, telling, objects,"],
  ];
  for (const [name, needle] of sites) {
    const i = src.indexOf(needle);
    assert.notEqual(i, -1, `the ${name} return site moved — re-aim this check, do not delete it`);
    const window = src.slice(i, i + 900);
    assert.ok(window.includes("...(transport ? { transport } : {})"),
      `${name} does not carry the transport line`);
  }
});

// ── ZERO CHANGE TO WALKS (§ 8 item 4) ────────────────────────────────────────

test("the movements table's schema is untouched — column for column", async () => {
  // Ruling 6 in the schema: "a ride is not a movement row". The falsifier is the
  // DDL itself rather than an argument about it.
  const src = readFileSync(new URL("../src/dynamic-store.mjs", import.meta.url), "utf8");
  const block = src.slice(src.indexOf("CREATE TABLE IF NOT EXISTS movements"));
  const ddl = block.slice(0, block.indexOf(");") + 2);
  assert.ok(ddl.length > 50, "the movements DDL could not be located — this check must be re-aimed, not deleted");
  for (const col of ["actor", "at", "from_x", "from_y", "toward_x", "toward_y", "crossing",
                     "within_w", "within_h", "to_mark", "pace", "declared_by", "note"])
    assert.ok(new RegExp(`\\b${col}\\b`).test(ddl), `movements lost its ${col} column`);
  assert.ok(!/ride|vehicle|arrives_at|via\b/.test(ddl),
    "a ride reached the movements table — it is a journal act and it has no line, no pace of its own and no interpolation");
});

test("no ride row was ever written as a movement", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: WHARF, handle: "rider", accept: true }, key("rider"), o.deps);
  await rideViaOffice(CLONE, { to: PANDO, handle: "rider" }, key("rider"), o.deps);
  assert.deepEqual(o.stops, [], "declaring a destination moves nobody and writes no departure");
  assert.equal(o.journal.filter((j) => j.action === "ride").length, 1);
});

// ── ORIENT KNOWS THE DECK (#2986, the dev walk 2026-09-20) ────────────────────
//
// `standCoords` in world.mjs takes a resident's derived standpoint only when its
// `source` is one of DERIVED_SOURCES; anything else falls back to their ground.
// The aboard-by-occupancy standpoint (`vehicleStandpoint`) answers `source:
// "vehicle"`. On dev, 2026-09-20 12:1xZ, wright stood aboard the Post Office at
// the hull by the presence door and `world_orient` answered "your ground
// (wright/the-trueing-house-parcel)" — the set had walk/timetable/attachment and
// not the word the new standpoint uses. Two files, one contract: this pins both
// halves to the same word, so dropping either side reddens here.
test("orient's derived set names the source the vehicle standpoint answers — a rider aboard is not answered with their house", () => {
  const worldSrc = readFileSync(join(process.cwd(), "src", "world.mjs"), "utf8");
  const moveSrc = readFileSync(join(process.cwd(), "src", "world-movement.mjs"), "utf8");
  const setLine = worldSrc.match(/const DERIVED_SOURCES = new Set\(\[([^\]]*)\]\);/);
  assert.ok(setLine, "world.mjs declares DERIVED_SOURCES as a Set literal");
  const named = [...setLine[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  const answered = moveSrc.match(/source: "vehicle"/);
  assert.ok(answered, "vehicleStandpoint answers source: \"vehicle\"");
  assert.ok(named.includes("vehicle"), `DERIVED_SOURCES names ${JSON.stringify(named)} — "vehicle" is missing, so orient would answer a rider aboard with their house`);
});
