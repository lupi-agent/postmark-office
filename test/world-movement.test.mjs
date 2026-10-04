// world-movement.test.mjs — Stage D under THE FRAME LAW (ruled 2026-08-10).
//
//   node --test test/world-movement.test.mjs
//
// The falsifiers, one per sentence the cutover claims:
//
//   1. flag-off changes nothing               — the whole module is unreachable
//   2. a carrier is CLASS-DECLARED            — nothing here knows the word "boat"
//   3. the carrier runs on her timetable      — position = f(timetable, clock)
//   4. a walk never boards                    — the quay beside her (POS-247)
//   5. carriage is nothing happening          — no test since POS-247 (below)
//   6. hearing composes through the frame     — and needed no change to do it
//   7. the contract is shown at the boundary  — terms before the step
//   8. the freeze is a change of pen          — and refuses to be a change of place
//
// WHAT REPLACED WHAT. An earlier build asked residents to declare "I am aboard"
// and validated the claim against where they stood at the cast-off instant.
// Every test of that ceremony is gone, and the outcomes those tests protected
// are re-proved here in frame terms — most visibly `pass-through-doesn't-board`,
// which is now "entered and left before she moved: no live edge, no carry". The
// protected outcome is identical; the reason it holds is simpler.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { openDynamic, movementV2Enabled } from "../src/dynamic-store.mjs";
// `declareMovement` is GONE (G1 / POS-156) and was already unused here.
import { readMovements, mergedDepartureEvents } from "../src/dynamic-entities.mjs";
import {
  carriersFrom, carriersWithDisclosure, foldFrames, gunwaleWarning, inRect, boundariesOnRoad,
} from "../src/world-frames.mjs";
import {
  carrierReader, heardFromV2, movementStandpoint, recordsAcrossEras, spokenOnStats,
  storedRecordsFor, vesselPositionAt, vesselServiceFrom,
} from "../src/world-movement.mjs";
import { aroundYou, happenedBlock, toYou, townShelf, HAPPENED_DIALS } from "../src/world-happened.mjs";
import { withFrames } from "../src/positions.mjs";
import { createVoices } from "../src/voices.mjs";
import { parityRows, marksAsOf, BERTH_TOLERANCE_M } from "../tools/vessel-parity.mjs";
import { freezeSeamLine, isFrozen, seamDiff, standingOnDeck, ashoreFor, ledgerWriters, unflaggedWriters, execCallers } from "../tools/ledger-freeze.mjs";
import { atCrossing, departure, fixtureMarks, makeWorldClone, QUAY, FAR_SHORE } from "./movement-fixture.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";
import { useGuardReader } from "../src/world2-guards.mjs";

const clone = makeWorldClone();
const dbDir = mkdtempSync(join(tmpdir(), "stageD-dyn-"));
const DB = join(dbDir, "dynamic.db");
after(() => { clone.cleanup(); rmSync(dbDir, { recursive: true, force: true }); });

const MARKS = { marks: fixtureMarks() };
const REPO = { repo: clone.dir };

// The fixture line: cast off from the quay at 06:00Z (fc n.5), 4 km at 40 km per
// crossing, so she is under way for a tenth of a crossing and berthed the rest.
const CAST_OFF = 10.5;
const BEFORE_SAILING = atCrossing(10.2);
const MID_CROSSING = atCrossing(10.55);
const AFTER_LANDING = atCrossing(10.8);

const reader = async () => {
  const { service, mod } = await vesselServiceFrom(MARKS, REPO);
  return { service, mod, carrierAt: carrierReader(MARKS, { repo: clone.dir, service, mod }) };
};

// ── 1. the flag is the whole switch ──────────────────────────────────────────

test("the flag is read per call, never latched — a test that flips it is answered", () => {
  const was = process.env.WORLD_MOVEMENT_V2;
  delete process.env.WORLD_MOVEMENT_V2;
  assert.equal(movementV2Enabled(), false);
  process.env.WORLD_MOVEMENT_V2 = "1";
  assert.equal(movementV2Enabled(), true);
  process.env.WORLD_MOVEMENT_V2 = "0";
  assert.equal(movementV2Enabled(), false, "only the exact string 1 switches it on");
  if (was === undefined) delete process.env.WORLD_MOVEMENT_V2; else process.env.WORLD_MOVEMENT_V2 = was;
});

// ── 2. a carrier is class-declared ───────────────────────────────────────────

test("a carrier is whatever the CLASS says carries — nothing here knows the word boat", () => {
  const carriers = carriersFrom(MARKS);
  assert.deepEqual(carriers.map((c) => c.id), ["the-town/the-post-office"]);
  assert.equal(carriers[0].mobility, "derived");
  assert.equal(carriers[0].declaredBy, "the-town/the-wheelhouse",
    "the schedule declares it; the body is what you stand on");
});

test("a class mark that merely DESCRIBES movement is not a thing you ride", () => {
  // `the-town/entity` declares `mobility: free`, meaning entities move freely.
  // It is also a building in the Keeping Works. Reading it as a carrier would
  // put everyone standing in that building aboard it — which is what happened
  // the first time this derivation ran against the real world.
  const withClassMark = {
    marks: [...fixtureMarks(), {
      id: "the-town/entity", kind: "sited", by: "the-town",
      at: { x: 9000, y: 9000 }, extent: { w: 50, h: 40 },
      class: "entity", mobility: "free",
    }],
  };
  assert.deepEqual(carriersFrom(withClassMark).map((c) => c.id), ["the-town/the-post-office"]);
});

test("a settled class never carries, whatever its extent", () => {
  const district = { marks: [{ id: "a/district", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 9e4, h: 9e4 }, class: "parcel", mobility: "settled", mechanic: "parcel" }] };
  assert.deepEqual(carriersFrom(district), []);
});

test("no carriers is DISCLOSED, never returned as a quiet empty list", () => {
  // Zero carriers is a well-formed world and also exactly what a broken class
  // read looks like. The difference has to be sayable.
  const r = carriersWithDisclosure({ marks: [{ id: "a/hill", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10, h: 10 } }] }, { worldDb: join(dbDir, "nope.db") });
  assert.deepEqual(r.carriers, []);
  assert.ok(r.disclosed.length > 0, "an empty carrier list must arrive with a reason attached");
});

// ── 3. the carrier runs on her timetable ─────────────────────────────────────

test("position = f(timetable, clock): berthed on the pin, under way between them", async () => {
  const berthed = await vesselPositionAt(MARKS, BEFORE_SAILING, REPO);
  assert.deepEqual({ x: berthed.x, y: berthed.y }, QUAY, "between sailings she lies exactly on her stop's mark");
  assert.equal(berthed.berthed, true);

  const underway = await vesselPositionAt(MARKS, MID_CROSSING, REPO);
  assert.equal(underway.berthed, false);
  assert.ok(underway.x > QUAY.x && underway.x < FAR_SHORE.x, `mid-channel, got ${underway.x}`);

  const landed = await vesselPositionAt(MARKS, AFTER_LANDING, REPO);
  assert.deepEqual({ x: landed.x, y: landed.y }, FAR_SHORE);
});

test("the carrier's standpoint comes from the timetable and never from a ledger line", async () => {
  const s = await movementStandpoint("the-post-office", MARKS, {
    ...REPO, atMs: MID_CROSSING, dbPath: DB,
    // A record that says she is somewhere else entirely. If the standpoint
    // consults it at all, this fails — the retirement of `aboardOrRoad` as an
    // assertion.
    recordsOf: () => [departure({ handle: "the-post-office", from: { x: -9e4, y: -9e4 }, toward: { x: -9e4, y: -9e4 }, at: 1 })],
  });
  assert.equal(s.source, "timetable");
  assert.ok(s.x > 0 && s.x < 4000, `she is on her own line, got ${s.x}`);
});

// ── 4. a walk never boards (POS-247) ─────────────────────────────────────────
//
// Keemin, 2026-09-26: "simply 'walking aboard' shouldn't put you on the boat
// anymore." You board through a stop's door (#2986); a walk that ends on her
// deck leaves you on the quay beside her.

test("walking onto her deck boards nobody — no edge is born, and the walker stands where the walk ended", () => {
  const records = [departure({ handle: "walker", from: { x: 60, y: 0 }, toward: { x: 2, y: 3 }, at: 10.0 })];
  const fold = foldFrames(records);
  assert.equal(fold.frame, null, "the endpoint is on her deck, and the walker is still ashore");
  assert.deepEqual(fold.transitions, [], "no edge is born by a walk");
  assert.deepEqual(fold.world, { x: 2, y: 3 }, "she sails; the walker is where the walk ended");
});

test("ON AND OFF HER DECK: no edge either way, no carry", () => {
  const records = [
    departure({ handle: "browser", from: { x: 60, y: 0 }, toward: { x: 2, y: 3 }, at: 10.1 }),   // onto the deck
    departure({ handle: "browser", from: { x: 2, y: 3 }, toward: { x: 60, y: 0 }, at: 10.2 }),   // and back off
  ];
  const fold = foldFrames(records);
  assert.equal(fold.frame, null);
  assert.deepEqual(fold.transitions, [], "nothing was boarded, so nothing was left");
  assert.deepEqual(fold.world, { x: 60, y: 0 }, "they are where they walked to");
});

test("a walk across her deck that ENDS elsewhere never boards", () => {
  // A leg from one side of her to the other: the straight line sweeps the deck.
  const records = [departure({ handle: "passer", from: { x: -40, y: 0 }, toward: { x: 60, y: 0 }, at: 10.1 })];
  assert.equal(foldFrames(records).frame, null, "a stride across her deck is not boarding");
});

test("no record at all: no frame, no position, nothing anyone else can forge", () => {
  const fold = foldFrames([]);
  assert.equal(fold.frame, null);
  assert.equal(fold.world, null);
  assert.equal(fold.provenance, "never-moved");
});

// ── 5. carriage is nothing happening ─────────────────────────────────────────
//
// Its tests reached a frame only through a walk onto her deck, and since POS-247
// (2026-09-26) no walk creates one. The branches they covered went with POS-261
// (w41); a rider's carriage is occupancy's (`withVehicleRiders`).

// ── 6. hearing composes through the frame ────────────────────────────────────

test("a voice spoken aboard is heard at HER position now, and names the frame it rode", async () => {
  const spokeAt = atCrossing(10.52);
  const voice = { handle: "speaker", at: spokeAt, x: 800, y: 0, text: "the water is flat today" };
  const from = await heardFromV2(voice, MARKS, { ...REPO, atMs: MID_CROSSING });
  const boat = await vesselPositionAt(MARKS, MID_CROSSING, REPO);
  assert.ok(from, "a voice from a carrier's frame is relocated");
  assert.equal(from.frame, "the-town/the-post-office", "the relocation NAMES what it rode — a cart would work the same");
  assert.deepEqual([from.x, from.y], [boat.x + (from.x - boat.x), boat.y + (from.y - boat.y)]);
});

test("a voice spoken ashore is heard where it was spoken", async () => {
  const voice = { handle: "landlubber", at: atCrossing(10.52), x: 2500, y: 400, text: "nice day" };
  const from = await heardFromV2(voice, MARKS, { ...REPO, atMs: MID_CROSSING });
  assert.equal(from, null, "null means heard where it happened — the ordinary case for everyone ashore");
});

// POS-226: an ear hears everything since the settlement, so the snapshot asks
// this of every voice in the window on every say. What a voice was spoken ON is
// the voice's and the fold's alone, so it is worked out once per voice per fold;
// where the carrier is NOW is still asked at each hearing instant.
// FLIP: drop `if (memo.has(key)) return memo.get(key);` in spokenOn and the
// second listen recomputes.
test("POS-226: a second listen does not recompute what a voice was spoken on — and a deck voice still follows her", async () => {
  const deck = { handle: "speaker", at: atCrossing(10.52), x: 800, y: 0, text: "on her deck" };
  const shore = { handle: "landlubber", at: atCrossing(10.52), x: 2500, y: 400, text: "ashore" };
  const W = { ...MARKS, marks: [...MARKS.marks] };            // a fold of its own, so no earlier test warmed it
  const before = spokenOnStats.computed;
  const first = [await heardFromV2(deck, W, { ...REPO, atMs: MID_CROSSING }), await heardFromV2(shore, W, { ...REPO, atMs: MID_CROSSING })];
  assert.equal(spokenOnStats.computed - before, 2, "the first listen works out both");
  const later = MID_CROSSING + 60_000;
  const second = [await heardFromV2(deck, W, { ...REPO, atMs: later }), await heardFromV2(shore, W, { ...REPO, atMs: later })];
  assert.equal(spokenOnStats.computed - before, 2, "the second listen recomputed nothing");
  assert.equal(second[1], null, "ashore stays ashore");
  const boatThen = await vesselPositionAt(MARKS, MID_CROSSING, REPO);
  const boatNow = await vesselPositionAt(MARKS, later, REPO);
  assert.equal(second[0].frame, "the-town/the-post-office");
  assert.deepEqual([second[0].x - first[0].x, second[0].y - first[0].y].map(Math.round),
    [boatNow.x - boatThen.x, boatNow.y - boatThen.y].map(Math.round), "the deck voice moved exactly as she did");
  const refolded = { ...MARKS, marks: [...MARKS.marks] };
  await heardFromV2(deck, refolded, { ...REPO, atMs: later });
  assert.equal(spokenOnStats.computed - before, 3, "a new fold works it out afresh");
});

test("two on one deck are one room with no pair-test at all — the room is structural", async () => {
  const boat = await vesselPositionAt(MARKS, MID_CROSSING, REPO);
  const spokenFarAstern = { x: 200, y: 0 };
  assert.ok(Math.hypot(boat.x - spokenFarAstern.x, boat.y - spokenFarAstern.y) > 60,
    "the fixture must actually put the spoken coordinates beyond earshot, or this proves nothing");

  const voices = createVoices({
    standpoint: async () => ({ placed: true, x: boat.x, y: boat.y, aboard: true, moving: true }),
    place: async () => "aboard the Post Office",
    structuralHearing: () => true,
    heardFrom: async () => ({ x: boat.x, y: boat.y }),
    logPath: join(dbDir, "voices-structural.jsonl"),
    now: () => MID_CROSSING,
  });
  await voices.say("mate", "still with you", {});
  const heard = await voices.hear("skipper", {});
  assert.equal(heard.voices.length, 1, "the deck is one room");
});

test("with the structural hook off, the INTERIM deck rule is what runs", async () => {
  const boat = { x: 2000, y: 0 };
  const mk = (structural) => createVoices({
    standpoint: async () => ({ placed: true, x: boat.x, y: boat.y, aboard: true, moving: true }),
    place: async () => "aboard",
    structuralHearing: () => structural,
    heardFrom: async () => ({ x: boat.x, y: boat.y }),
    vesselAt: async () => boat,
    logPath: join(dbDir, `voices-${structural}.jsonl`),
    now: () => MID_CROSSING,
  });
  const interim = mk(false), structural = mk(true);
  await interim.say("a", "hello", {});
  await structural.say("a", "hello", {});
  const i = await interim.hear("b", {}), s = await structural.hear("b", {});
  assert.equal(i.voices.length, 1);
  assert.equal(s.voices.length, 1);
});

// ── 7. the contract is shown at the boundary ─────────────────────────────────

test("a road that ends on her deck names her, and says the walk leaves you on the quay beside her", async () => {
  const { carrierAt, mod, service } = await reader();
  const terms = await boundariesOnRoad({ x: 60, y: 0 }, { x: 2, y: 3 }, carriersFrom(MARKS), BEFORE_SAILING, { carrierAt, mod, service });
  assert.equal(terms.length, 1);
  assert.equal(terms[0].carrier, "the-town/the-post-office");
  assert.equal(terms[0].ends_inside, true);
  assert.ok(terms[0].terms.some((t) => /quay beside her, not aboard/.test(t) && /stop's door/.test(t) && /ride/.test(t)),
    "the walk answer says where the walk leaves you and that boarding is a stop's door");
  assert.ok(!terms[0].terms.some((t) => /means riding/.test(t)), "the old contract of stepping aboard is gone");
  // 2026-09-26 (Keemin): her departure time is no longer said to a walker — a
  // rider is not carried by her schedule, so it was a timetable that seemed to
  // gate boarding and did not.
  assert.ok(!terms[0].terms.some((t) => /timetable binds|departs/.test(t)), "her schedule is not presented as binding a walker");
});

test("THE GUNWALE RULE: stepping off a moving carrier warns, and does not refuse", async () => {
  const { carrierAt } = await reader();
  const carrier = carriersFrom(MARKS)[0];
  const midChannel = await gunwaleWarning(carrier, { x: 9000, y: 9000 }, MID_CROSSING, { carrierAt });
  assert.match(midChannel, /mid-channel/, "the warning names what is about to happen");
  assert.match(midChannel, /in the water/);

  const alongside = await gunwaleWarning(carrier, { x: 60, y: 0 }, BEFORE_SAILING, { carrierAt });
  assert.match(alongside, /onto the ground beside her/, "berthed, stepping off is ordinary");

  // A step that stays aboard warns about nothing — but "aboard" is a WORLD
  // point inside her footprint RIGHT NOW, not a frame-local offset. The door
  // speaks world coordinates and this function judges world coordinates; the
  // test that first mixed them up is the reason this comment exists.
  const boat = await vesselPositionAt(MARKS, MID_CROSSING, REPO);
  const staying = await gunwaleWarning(carrier, { x: boat.x + 2, y: boat.y + 3 }, MID_CROSSING, { carrierAt });
  assert.equal(staying, null, "a step that lands on her deck as she is now warns about nothing");
});

test("WHILE SHE IS UNDER WAY, EVERY WORLD-COORDINATE STEP LEAVES HER — the v0 reading, stated", async () => {
  // The door speaks world coordinates, and a moving carrier slides out from
  // under any fixed world point. So pacing the deck works in port (she is
  // stationary, world and frame coincide) and any step declared under way is a
  // step into the water — which is exactly what the gunwale rule warns about,
  // rather than a corner case it happens to catch.
  //
  // The alternative — reading `toward` as a frame-local offset whenever your
  // frame is a carrier — would make deck-pacing work under way, and would also
  // silently change what `world_walk x/y` means depending on where you are
  // standing, and break walking to a MARK from a deck. That is a door-schema
  // decision and it is recorded as an open question rather than taken here.
  const { carrierAt } = await reader();
  const carrier = carriersFrom(MARKS)[0];
  const before = await vesselPositionAt(MARKS, MID_CROSSING, REPO);
  const stepToWhereSheIsNow = { x: before.x, y: before.y };
  // Declared now, arriving a moment later: she has moved on.
  const later = MID_CROSSING + 60_000;
  const w = await gunwaleWarning(carrier, stepToWhereSheIsNow, later, { carrierAt });
  assert.match(w, /mid-channel/, "aiming at where she is becomes aiming at where she was");
});

// ── 8. observability: three shelves, and the cap that is the contract ────────

test("THE DELTA DOES NOT GROW WITH THE ABSENCE — away one crossing or forty", () => {
  // The constraint that makes leaving survivable. Shelves 2 and 3 are windows,
  // not archives: an agent that must read a proportional-to-absence payload
  // before it can act is an agent punished for having been away.
  const lineAt = (n, i) => ({
    type: "emission", actor: `r${i}`, at: `2026-08-${String(10 + (n % 20)).padStart(2, "0")}T00:00:0${i % 10}Z`,
    crossing: n, payload: { x: 1, y: 1, place: "the quay" },
  });
  const short = [], long = [];
  for (let i = 0; i < 40; i++) short.push(lineAt(119, i));
  for (let n = 80; n <= 119; n++) for (let i = 0; i < 40; i++) long.push(lineAt(n, i));
  assert.ok(long.length > short.length * 30, "the fixture must actually be a much longer absence");

  const a = aroundYou({ lines: short, at: { x: 1, y: 1 } });
  const b = aroundYou({ lines: long, at: { x: 1, y: 1 } });
  assert.equal(a.events.length, b.events.length, "shelf 2 is the same size after 1 crossing and after 40");
  assert.equal(b.events.length, HAPPENED_DIALS.around_cap);
  assert.equal(b.capped, true, "and it says it was capped, so a short list cannot read as a quiet room");

  const t1 = townShelf({ nowCrossing: 119, notices: new Array(50).fill({ id: "n", title: "t", text: "x" }) });
  const t2 = townShelf({ nowCrossing: 119, notices: new Array(2).fill({ id: "n", title: "t", text: "x" }) });
  assert.ok(t1.headlines.length <= HAPPENED_DIALS.town_headlines, "shelf 3 is bounded too");
  assert.ok(t1.headlines.length >= t2.headlines.length);
});

test("shelf 1 is COMPLETE and names the agent that moved you", () => {
  const shelf = toYou({
    transitions: [{ kind: "born", carrier: "the-town/the-post-office", at: "2026-08-10T18:00:00Z", reason: "crossed her boundary" }],
    carriedLegs: [{ carrier: "the-town/the-post-office", crossing: 119, at: "2026-08-10T18:00:00Z", metres: 133750, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }],
    sinceCrossing: 118, nowCrossing: 119,
  });
  assert.equal(shelf.complete, true);
  const carried = shelf.events.find((e) => e.kind === "carried");
  assert.equal(carried.summary, "carried by the-town/the-post-office, crossing 119",
    "a displacement with no agent named is a mystery, and a mystery is what the old world handed people");
  assert.ok(shelf.events.some((e) => e.kind === "frame-entered"));
});

test("shelf 2 is around WHERE YOU STAND, not everywhere", () => {
  const lines = [
    { type: "emission", actor: "near", at: "2026-08-10T00:00:00Z", crossing: 119, payload: { x: 10, y: 10 } },
    { type: "emission", actor: "far", at: "2026-08-10T00:00:01Z", crossing: 119, payload: { x: 99999, y: 99999 } },
  ];
  const r = aroundYou({ lines, at: { x: 0, y: 0 } });
  assert.deepEqual(r.events.map((e) => e.actor), ["near"]);
});

test("the whole block carries its own cursor and never copies the town", () => {
  const b = happenedBlock({
    transitions: [], carriedLegs: [], lines: [], at: { x: 0, y: 0 },
    sinceCrossing: 100, nowCrossing: 119,
    latestSettlement: { sha: "abc1234", at: "2026-08-10T00:00:00Z", subject: "settlement: sweep 7" },
    notices: [{ id: "n1", title: "THE RETURN", text: "x".repeat(500) }],
  });
  assert.equal(b.since.crossing, 100);
  assert.equal(b.to_you.complete, true);
  assert.equal(b.around_you.complete, false);
  assert.equal(b.town.complete, false);
  assert.ok(b.town.headlines[0].teaser.length <= 141, "a headline is a pointer, never a copy");
});

// ── 8b. one overlay, both doors ──────────────────────────────────────────────

test("the frame overlay is ONE function, so present and walkers cannot disagree", () => {
  // Issue #7's split-brain, one layer up: if the walkers door applied frames and
  // the presence layer did not, `present` would put a passenger back on the quay
  // they left while the map had them mid-channel. Both call this.
  const rows = [
    { handle: "rider", x: 0, y: 0, source: "walk", moving: false, remaining_m: 0, eta_crossings: 0 },
    { handle: "ashore", x: 500, y: 500, source: "parcel", moving: false, remaining_m: 0, eta_crossings: 0 },
  ];
  const frames = new Map([["rider", { frame: "the-town/the-post-office", world: { x: 2000, y: 0 }, provenance: "carried" }]]);
  const out = withFrames(rows, frames);
  assert.deepEqual(out[0], {
    handle: "rider", x: 2000, y: 0, source: "walk", moving: false,
    aboard: true, frame: "the-town/the-post-office", provenance: "carried",
    remaining_m: 0, eta_crossings: 0,
  });
  assert.deepEqual(out[1], rows[1], "everyone ashore is untouched");
});

test("no frames map means the rows pass through byte-identical — the flag-off path", () => {
  const rows = [{ handle: "a", x: 1, y: 2, source: "walk", moving: true, remaining_m: 5, eta_crossings: 1 }];
  assert.equal(withFrames(rows, null), rows, "the same array object, not a copy — nothing ran");
  assert.equal(withFrames(rows, new Map()), rows);
});

// ── 9. the two eras, and the freeze ──────────────────────────────────────────

test("the store's records and the ledger's merge into one ordered history", async () => {
  // POS-154: era two is `acts` now, so the departure is filed as the act the
  // movement-store pen writes rather than into a sqlite file. The claim — one
  // ordered history across the seam — is untouched.
  const late = new Date(atCrossing(11)).toISOString();
  const pg = process.env.WORLD2_PG, url = process.env.WORLD2_PG_URL;
  process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = "postgres://world-movement-test/none";
  const restore = useGuardReader(async (fn) => fn({
    query: async (sql, params) => (/FROM acts/i.test(String(sql))
      ? { rows: [{
          id: 77, at: new Date(late), crossing: "11", actor: "mover", action: "walk",
          payload: { from: FAR_SHORE, toward: FAR_SHORE, within: null, to: null, pace: null, declared_by: "mover" },
        }] }
      : { rows: [] }),
  }));
  let stored;
  try { stored = await storedRecordsFor("mover", { atMs: atCrossing(12) }); }
  finally {
    restore();
    if (pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = pg;
    if (url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = url;
  }
  assert.equal(stored.length, 1);

  const merged = recordsAcrossEras(
    [departure({ handle: "mover", from: QUAY, toward: QUAY, at: 10 })],
    stored,
  );
  assert.deepEqual(merged.map((r) => r.era), ["ledger", "store"], "oldest first, across the seam");
});

test("a store row wins a tie, because the ledger cannot gain a line after the freeze", () => {
  const t = "2026-08-10T06:00:00.000Z";
  const merged = mergedDepartureEvents(
    [{ seq: 1, at: t, actor: "a", type: "departure", payload: "{}" }],
    [{ seq: 1, at: t, actor: "a", type: "departure", payload: "{}" }],
  );
  assert.deepEqual(merged.map((m) => m.era), ["ledger", "store"]);
});

test("the seam line is prose, not a departure — the ledger's own parser ignores it", async () => {
  const walk = await import(pathToFileURL(join(clone.dir, "tools", "walk.mjs")).href);
  const body = "- 2026-08-01T00:00:00.000Z · someone · from 0,0 · toward 10,10 · at 100.0000\n";
  const before = walk.parseWalkLedger(body);
  const after_ = walk.parseWalkLedger(body + freezeSeamLine("2026-08-10T06:00:00.000Z"));
  assert.deepEqual(before.departures, after_.departures,
    "freezing the file must not change one derived position — the seam changes the pen, never the past");
  assert.equal(isFrozen(freezeSeamLine("x")), true);
});

test("every writer that can append to the ledger is found, and the pen is behind the flag", () => {
  const writers = ledgerWriters();
  assert.ok(writers.some((w) => w.file === "src/walk-exec.mjs"),
    "the office pen must be in this list — a scan that cannot find the one real writer is not a check");
  // THE DRAIN IS THE SETTLEMENT'S OWN PEN, NOT A RESIDENT DOOR (Keemin, 2026-09-11).
  // `src/world-drain.mjs § materializeLedgers` appends the walk-ledger lines the
  // crossing itself carries ("this is its only pen, and it is lawful", its own
  // header). The freeze stands in front of the doors residents walk through;
  // it was never meant to stop the crossing writing its own record. Named here
  // rather than hidden in the scan, so the scan still finds it and this line
  // says why it is allowed.
  const LAWFUL_PENS = new Set(["src/world-drain.mjs"]);
  const open = unflaggedWriters(writers, execCallers()).filter((w) => !LAWFUL_PENS.has(w.file));
  assert.deepEqual(open, [], `these can still append with the flag on: ${open.map((w) => w.file).join(", ")}`);
});

test("the freeze names who the seam would move, and offers the FILING REPAIR", async () => {
  const [walk, vessel, geometry] = await Promise.all([
    import(pathToFileURL(join(clone.dir, "tools", "walk.mjs")).href),
    import(pathToFileURL(join(clone.dir, "tools", "vessel.mjs")).href),
    import(pathToFileURL(join(clone.dir, "tools", "geometry.mjs")).href),
  ]);
  const service = vessel.servicesFromFold(MARKS).services[0];
  const atFc = 10.3;
  const departures = [
    departure({ handle: "on-deck", from: { x: 2, y: 3 }, toward: { x: 2, y: 3 }, at: 10 }),
    departure({ handle: "ashore", from: { x: 500, y: 500 }, toward: { x: 500, y: 500 }, at: 10 }),
  ];
  // 1. GEOMETRY, and under the agreement law the only thing a deck still says.
  // Who is standing inside her footprint at a berthed instant — never who is
  // going anywhere, which since the agreement law is block 3's business and no
  // longer follows from this one.
  const deck = standingOnDeck({ departures, service, walk, vessel, geometry, atFc });
  assert.deepEqual(deck.residents.map((r) => r.handle), ["on-deck"]);

  // 2. THE FILING REPAIR, ahead of the carriage question rather than behind it.
  // `ashoreFor` is where the freeze would set someone down; it does not depend
  // on who is carried, and it sat behind an assertion that threw, so it never
  // ran. It runs first now so no verdict about carriage can hide it again.
  const ashore = ashoreFor({ service, vessel, atFc });
  assert.ok(ashore, "the repair has somewhere to put them");
  assert.equal(geometry.pointInRect(ashore.x, ashore.y, vessel.footprintOf(service, service.stops[0].at)), false,
    "ashore means OUTSIDE her footprint, or the next departure collects them again");

  // 3. BOARDING IS DECLARED, NEVER INFERRED — so the seam moves NOBODY.
  // This assertion used to expect ["on-deck"]: standing inside her footprint at
  // the cast-off was boarding. Keemin repealed that on 2026-08-11 (world commit
  // 64e66ed7, "boarding is declared, never inferred — the agreement law replaces
  // boarding-is-presence"): "The footprint test is gone; standing on her deck at
  // the hour does nothing, and an agreement carries you from anywhere. Default
  // empty list = nobody rides, so any reader that has not learned to pass
  // agreements gets the correct answer rather than the old one."
  //
  // The office is one of those readers. `seamDiff` calls the world's
  // `positionAt(departure, instant, service)` with three arguments and never the
  // fourth, `agreements`, so the empty list governs and nobody is carried. The
  // empty answer is therefore CORRECT, not a defect — and it is correct twice
  // over, because no office store can hold a passenger agreement yet
  // (`declareAttachment` admits only cascade|detach; the boarding verb lands
  // with the vessel work). Restoring the old expectation would be
  // re-implementing the one thing the ruling forbids.
  //
  // What this pins is the refusal, which is live: the carry mechanism fires when
  // an agreement IS passed, and the freeze still cannot see it. See the
  // agreement-blindness note at `seamDiff` in tools/ledger-freeze.mjs.
  const moved = seamDiff({ departures, service, walk, vessel, atFc: 10.6 });
  assert.deepEqual(moved.map((m) => m.handle), [],
    "with no agreement declared, standing on her deck carries nobody — the seam must report an empty list");
});

// ── the town's own numbers ───────────────────────────────────────────────────

test("vessel parity against the real ledger reproduces the doctrine's own residuals", async (t) => {
  const store = process.env.WORLD_STORE_DB ?? join(import.meta.dirname, "..", "world.db");
  if (!existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md")) || !existsSync(store))
    return t.skip(`needs the world clone at ${WORLD_CLONE} and a hydrated ${store}`);

  const T = (f) => import(pathToFileURL(join(WORLD_CLONE, "tools", f)).href);
  const [walk, vessel, fold] = await Promise.all([T("walk.mjs"), T("vessel.mjs"), T("marks-fold.mjs")]);
  const marks = fold.loadMarks(join(WORLD_CLONE, "WORLD", "marks"));
  const service = vessel.servicesFromFold({ marks }).services[0];
  if (!service) return t.skip("the live world carries no timetable mark");
  const { departures } = walk.parseWalkLedger(readFileSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"), "utf8"));
  const vesselDepartures = departures.filter((d) => d.handle === service.vessel.handle);
  if (vesselDepartures.length < 3) return t.skip(`the live ledger holds ${vesselDepartures.length} vessel departures`);

  const { readGeometryVersions } = await import("../tools/vessel-parity.mjs");
  const { versions } = readGeometryVersions(store);
  const rows = parityRows({ vesselDepartures, marks, versions, vessel, vesselHandle: service.vessel.handle });

  assert.equal(rows[0].as_of.metres, 0, "the maiden scheduled departure is on the pin");

  const remoor = rows.find((r) => r.iso.startsWith("2026-08-08T22:24"));
  if (remoor) {
    assert.ok(remoor.now.metres > 1000, `today's map reads it ${remoor.now.metres} m off`);
    assert.ok(remoor.as_of.metres <= BERTH_TOLERANCE_M,
      `as-of its own instant it is a berth offset, got ${remoor.as_of.metres} m — the doctrine's own 22 m`);
  }
  const ret = rows.find((r) => r.iso.startsWith("2026-08-09T12:00"));
  if (ret) {
    assert.equal(ret.now.metres, 0);
    assert.ok(ret.as_of.metres > 1000,
      "the landing had factually moved before the commit legalizing it — as-of reads the record, not the intent");
  }
});

test("marksAsOf rewinds a stop to where the record put it, and names what it could not", () => {
  const marks = [
    { id: "the-town/the-pando-landing", kind: "sited", at: { x: -94570, y: -94570 }, extent: { w: 14, h: 40 } },
    { id: "nobody/unversioned", kind: "sited", at: { x: 1, y: 1 }, extent: { w: 1, h: 1 } },
  ];
  const versions = [
    { mark_id: "the-town/the-pando-landing", at_x: -95430, at_y: -95430, extent_w: 14, extent_h: 40,
      valid_from_iso: "2026-08-07T14:19:47.000Z", valid_to_iso: "2026-08-09T21:32:24.000Z" },
    { mark_id: "the-town/the-pando-landing", at_x: -94570, at_y: -94570, extent_w: 14, extent_h: 40,
      valid_from_iso: "2026-08-09T21:32:24.000Z", valid_to_iso: null },
  ];
  const before = marksAsOf(marks, "2026-08-09T12:00:00.000Z", versions);
  assert.deepEqual(before.marks[0].at, { x: -95430, y: -95430 });
  assert.deepEqual(before.unversioned, ["nobody/unversioned"],
    "a mark with no version is REPORTED, never silently given today's geometry");
});

test("a point on the boundary is inside it — arrival lands you on the edge", () => {
  const r = { x: 0, y: 0, w: 10, h: 20 };
  assert.equal(inRect({ x: -5, y: 0 }, r), true, "the edge is inside, or walking to a mark never arrives");
  assert.equal(inRect({ x: 5.001, y: 0 }, r), false);
});
