// ring-wins-standpoint.test.mjs — AN ARRIVED WALKER STANDS WHERE THE ROAD ENDED.
//
//   WORLD_CLONE=<a world clone> node --test test/ring-wins-standpoint.test.mjs
//
// Founder-ruled 2026-09-11, beside "ring wins everywhere". The office half of
// that ruling is one line in `world-movement.mjs § movementStandpoint`, and this
// is the bug it closes, measured on wright's own case:
//
//   wright walked to wright/the-trueing-terrace. The rim arrival ended at
//   (1022.3, -1669) — the box's near edge, which by the terrace's 12-point ring
//   is his neighbour's field. `positionAt` says he is there. The STANDPOINT said
//   he was at (967, -2450.5), the terrace's anchor, 783 m away, because
//   `foldFrames` sets `local = endWorld` for anyone ashore and `endWorld` is the
//   record's `toward` — a rim walk's `toward` being the mark's centre.
//
//   The enter door measures from the standpoint. So it let him through a door he
//   was nowhere near: `enterExitPlan` saw a walker already inside the target,
//   never set `walk`, and the reach check had nothing to run on.
//
// THE LAW THE REACH CHECK QUOTES, verbatim from `world-crossings.mjs`: "A DOOR
// IS ENTERED FROM WITHIN ITS REACH (founder-ruled 2026-08-27, option A of the
// R15 collision — found on the first dev walk: 'you can enter things when you
// aren't even there')." The rule said "from its DOORSTEP" until 2026-09-11,
// when the founder took that word back for the resident's own front step.
//
// AND A WALK TO HER DECK IS NOT ABOARD (POS-247, Keemin 2026-09-26: "simply
// 'walking aboard' shouldn't put you on the boat anymore"): the standpoint of
// someone whose walk ended on her deck is the road's end, the quay she left.
// The composition aboard a carrier is proved in world-movement.test.mjs.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { movementStandpoint } from "../src/world-movement.mjs";
import { enterViaOffice } from "../src/world-crossings.mjs";
import { atCrossing, departure, fixtureMarks, makeWorldClone, QUAY } from "./movement-fixture.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";
import { pathToFileURL } from "node:url";

const clone = makeWorldClone();
const dbDir = mkdtempSync(join(tmpdir(), "ringwins-dyn-"));
const DB = join(dbDir, "dynamic.db");
after(() => { clone.cleanup(); rmSync(dbDir, { recursive: true, force: true }); });

// ── wright's case, from WORLD/world-state.json @ 0dce31ce ────────────────────
const TERRACE = {
  id: "wright/the-trueing-terrace", kind: "sited", by: "wright", tier: "market",
  at: { x: 967, y: -2450.5 }, extent: { w: 1834, h: 1563 },
  points: [[1884, -2400], [1568, -1876], [1109, -1809], [681, -1669], [291, -1817], [50, -2214],
           [55, -2607], [247, -2951], [668, -3226], [1211, -3232], [1643, -3025], [1884, -2625]],
};
const GARDENS = {
  id: "rei/the-lanternseed-gardens", kind: "sited", by: "rei", tier: "market",
  at: { x: 1338, y: -994.5 }, extent: { w: 1854, h: 1637 },
  points: [[2265, -1001], [2025, -439], [1554, -176], [1084, -199], [691, -465], [432, -821],
           [411, -1197], [619, -1558], [1100, -1805], [1555, -1813], [2019, -1562], [2238, -1193]],
};

// TWO WALKS, TWO NUMBERS, AND THEY ARE NOT THE SAME WALK — measured, because
// conflating them would make every assertion below about the wrong subject.
//
//   FROM        wright's last start in WORLD/walk-ledger.md (2026-08-10). A rim
//               walk to the terrace FROM HERE derives BOX_ARRIVAL by the box and
//               RING_ARRIVAL by the ring; both are checked against the world's
//               own arithmetic in the first test rather than trusted as typed.
//   DEV_ARRIVAL where wright's 2026-09-11 walk on dev actually landed, from a
//               start this repo does not carry. It is the enter door's case, and
//               it is 783 m from the anchor where the ledger start's is 843.
const FROM = { x: -34.5, y: 35.5 };
const BOX_ARRIVAL = { x: 652.2, y: -1669 };      // the box's near edge, on this road
const RING_ARRIVAL = { x: 656.4, y: -1679.4 };   // the ring's, 1 m inside it (walk.mjs § walkTargetFor)
const DEV_ARRIVAL = { x: 1022.3, y: -1669 };     // the incident: outside the terrace, inside the gardens

// The movement module needs a world that runs a service, or it answers null and
// says nothing at all — so wright's two marks ride the carrier fixture's town.
const MARKS = { marks: [...fixtureMarks(), TERRACE, GARDENS] };
const REPO = { repo: clone.dir };
const NOW = atCrossing(40);                       // long after every leg below has landed

// ── 1. the standpoint ────────────────────────────────────────────────────────

test("AN ARRIVED WALKER ASHORE STANDS WHERE THE ROAD ENDED, not at the mark's anchor", async () => {
  // The record as the walk desk wrote it before the ruling: toward the anchor,
  // with the BOX frozen beside it, so the rim arrival lands on the box's edge.
  const rec = departure({
    handle: "wright", from: FROM, toward: { x: TERRACE.at.x, y: TERRACE.at.y },
    at: 20, within: { w: TERRACE.extent.w, h: TERRACE.extent.h }, to: TERRACE.id, pace: 60,
  });
  const here = await movementStandpoint("wright", MARKS, {
    ...REPO, atMs: NOW, dbPath: DB, recordsOf: async () => [rec],
  });
  assert.ok(here?.placed, "the standpoint answers at all");
  assert.equal(here.moving, false, "the leg is long finished");
  assert.equal(here.aboard, false, "ashore — there is no frame to compose through");

  // The number is DERIVED, never typed: the world's own positionAt decides where
  // this record ends, and the standpoint must agree with it to the metre.
  const { positionAt } = await import(pathToFileURL(join(WORLD_CLONE, "tools", "walk.mjs")));
  const road = positionAt(rec, 9999);
  assert.equal(road.arrived, true);
  assert.deepEqual({ x: road.x, y: road.y }, BOX_ARRIVAL, "the fixture's road ends where this test says");

  assert.deepEqual({ x: here.x, y: here.y }, BOX_ARRIVAL,
    "the standpoint IS the road's end — one answer to 'where is wright', not two");
  // THE ASSERTION THE RULING REDUCES TO: it is no longer the anchor.
  assert.notDeepEqual({ x: here.x, y: here.y }, { x: TERRACE.at.x, y: TERRACE.at.y },
    "and NOT the mark's anchor, which is what the frame used to answer");
  assert.equal(Math.round(Math.hypot(here.x - TERRACE.at.x, here.y - TERRACE.at.y)), 843,
    "the two answers were 843 m apart on this road — the size of the bug");

  // The frame still owns WHICH thing you are attached to. It just owns no point.
  assert.equal(here.frame, null);
  assert.equal(here.mark_id, TERRACE.id, "the record still says what he walked to");
});

test("A WALK ONTO HER DECK LEAVES HIM ON THE QUAY — she sails without him (POS-247)", async () => {
  // Step onto her deck at the quay before the 06:00Z cast-off, then ask after
  // she has sailed. Walking aboard no longer boards: the answer is the quay.
  const rec = departure({ handle: "rook", from: { x: -50, y: 0 }, toward: { ...QUAY }, at: 10.2 });
  const here = await movementStandpoint("rook", MARKS, {
    ...REPO, atMs: atCrossing(10.8), dbPath: DB, recordsOf: async () => [rec],
  });
  assert.ok(here?.placed);
  assert.equal(here.aboard, false, "a walk is not a stop's door");
  assert.equal(here.frame, null);
  assert.deepEqual({ x: here.x, y: here.y }, { x: QUAY.x, y: QUAY.y }, "he is at the road's end, on the quay");
});

// ── 2. the enter door ────────────────────────────────────────────────────────

// The enter door reads its LAW from a real world clone — `tools/enter-exit.mjs`
// and `tools/world-verbs.mjs`, which the carrier fixture's three-file clone does
// not carry. It is pointed at the office's own WORLD_CLONE for that reason, and
// the adjudication it runs is the town's, not a restatement.
const enterFrom = (point) => enterViaOffice(WORLD_CLONE, { mark: TERRACE.id, handle: "wright" },
  { handles: new Set(["wright"]) }, {
    world: async () => MARKS,
    ledger: async () => "",                       // nobody has entered anything
    standpointOf: async () => ({ ...point }),
    record: async () => ({ within: [TERRACE.id], commit: null, lines: [] }),
    now: () => atCrossing(40) / 43200000,
  });

test("THE REACH HOLDS: from where wright actually landed, the terrace's door REFUSES and names the distance", async () => {
  const e = await enterFrom(DEV_ARRIVAL).then(() => null, (err) => err);
  assert.ok(e, "the door refused rather than admitting him");
  assert.equal(e.code, 409);
  assert.match(e.defect, /you are not at that door/);
  assert.match(e.defect, new RegExp(TERRACE.id.replace("/", "\\/")));
  assert.match(e.defect, /~783 m/, "the refusal quotes the measured distance, not a rounded guess");
  assert.match(e.hint, /a door is entered from within its extent/,
    "the rule's own words — the geometric margin stopped borrowing the resident's 'doorstep' on 2026-09-11");
  assert.match(e.hint, /nothing was recorded/);
});

test("FROM THE RING'S ARRIVAL HE ENTERS — the ruling's other half, landing", async () => {
  const out = await enterFrom(RING_ARRIVAL);
  assert.deepEqual(out.entered, [TERRACE.id], "he is standing on the terrace, so the door opens");
  assert.equal(out.refused ?? null, null);
  assert.equal(out.handle, "wright");
});

test("THE ANCHOR ENTERS TOO — which is exactly why the standpoint had to stop answering it", async () => {
  // Not a bug in the door. The door was told he was standing in the middle of
  // the terrace; `enterExitPlan` correctly saw no threshold left to cross and
  // set no `walk`, so the reach check had nothing to run on. The defect was
  // upstream, in which point the standpoint handed over.
  const out = await enterFrom({ x: TERRACE.at.x, y: TERRACE.at.y });
  assert.equal(out.entered.length + (out.already ? 1 : 0) > 0, true,
    "from the anchor the door lets him in and never measures a margin");
});

// ── 3. the two halves, wired together ────────────────────────────────────────
//
// The refusal above is fed an INJECTED standpoint, which is right for pinning
// the door's own grammar but cannot catch a regression in `movementStandpoint`.
// This case runs the real derivation into the real door, so restoring the
// frame-origin line turns THIS red — which is the flip the ruling is checked by.
//
// The record is reconstructed to land on wright's dev arrival: a rim walk to the
// terrace's anchor from due north-east of it, with the box frozen beside it, as
// every mark-targeted departure was written before the ruling. The test derives
// the arrival rather than trusting it.
test("END TO END: the real standpoint feeds the real door, and the door refuses", async () => {
  const rec = departure({
    handle: "wright", from: { x: 1142.9, y: 35.5 }, toward: { x: TERRACE.at.x, y: TERRACE.at.y },
    at: 20, within: { w: TERRACE.extent.w, h: TERRACE.extent.h }, to: TERRACE.id, pace: 60,
  });
  const { positionAt } = await import(pathToFileURL(join(WORLD_CLONE, "tools", "walk.mjs")));
  const road = positionAt(rec, 9999);
  assert.deepEqual({ x: road.x, y: road.y }, DEV_ARRIVAL,
    "this record reproduces the dev arrival — the subject is wright's own case");

  const standpointOf = async (h) => {
    const s = await movementStandpoint(h, MARKS, { ...REPO, atMs: NOW, dbPath: DB, recordsOf: async () => [rec] });
    return { x: s.x, y: s.y };
  };
  const e = await enterViaOffice(WORLD_CLONE, { mark: TERRACE.id, handle: "wright" },
    { handles: new Set(["wright"]) }, {
      world: async () => MARKS, ledger: async () => "", standpointOf,
      record: async () => ({ within: [], commit: null, lines: [] }),
      now: () => NOW / 43200000,
    }).then(() => null, (err) => err);

  assert.ok(e, "the door refused — he is 783 m from the terrace's anchor and not on its ring");
  assert.equal(e.code, 409);
  assert.match(e.defect, /you are not at that door/);
  assert.match(e.defect, /~783 m/);
});
