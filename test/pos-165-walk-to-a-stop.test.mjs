// pos-165-walk-to-a-stop.test.mjs — A RESIDENT CAN WALK TO A STOP THE BOAT'S
// TIMETABLE NAMES (POS-165, Keemin-ruled on Kogane's letter of 2026-09-20).
//
// THE RULING: "a mark that any vessel's timetable names as a stop is a
// destination, whatever its tier. The furniture refusal stays for furniture no
// timetable names."
//
// ── WHY THIS SUITE EXISTS AT ALL ────────────────────────────────────────────
//
// `grep -l "furniture, not a destination\|WALK_EXCLUDED_TIERS" test/` at the
// train tip `bcdede7` returns NOTHING. The constitution refusal — a live 422 on
// the one door residents are taught to use — has never had a test. So this is
// not a regression net around an exemption; it is the first assertion the rule
// has ever had, and it has to carry the refusal as well as the admission.
//
// ── THE HARNESS, AND WHY IT IS NOT THE ONE THE REPO SAYS DOES NOT EXIST ─────
//
// `test/arena.test.mjs:1680` says "`walkViaOffice` HAS NO HARNESS … which is
// why nothing in this repo drives it". That was true when it was written and is
// not true now: `test/world-pool.test.mjs` drives the real door against a
// synthetic git-backed world, including the mark-target refusal path (its
// parcel bounce, L323). This suite is that bottle again, built here rather than
// bolted onto world-pool's — that fixture is shared by the pool-concurrency
// tests, and widening it to carry a timetable would put this lane's blast
// radius inside somebody else's receipts.
//
// ── THE FOUR LEGS, AND WHAT EACH ONE CAN FAIL FOR ──────────────────────────
//
//   1. ADMITTED — the constitution mark the timetable names walks, and the
//      answer is the same one a coordinate walk to its ground gives.
//   2. STILL REFUSED — a constitution mark with the SAME geometry that the
//      timetable does NOT name bounces with today's words, quoted verbatim.
//      Leg 1 without leg 2 would pass just as well if the tier check had simply
//      been deleted.
//   3. NO SERVICE — the world's timetable mark loses `mechanic: timetable`, and
//      THE SAME ID that leg 1 admitted bounces with the same exact words. One
//      id, two worlds, two answers: that is the rule stated as an experiment.
//   4. THE PREMISE, ON THE REAL ENGINE — the live world clone's own
//      `tools/vessel.mjs`, over the live fold, really does name a
//      constitution-tiered mark as a stop. Legs 1-3 run against a stub
//      `servicesFromFold`; a stub cannot make leg 4 pass, and leg 4 cannot make
//      legs 1-3 pass.
//
//   node --test test/pos-165-walk-to-a-stop.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const repo = mkdtempSync(join(tmpdir(), "pos165-world-"));
const pool = mkdtempSync(join(tmpdir(), "pos165-pool-"));
after(() => rmSync(repo, { recursive: true, force: true }));
after(() => rmSync(pool, { recursive: true, force: true }));

const git = (...args) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// ── the three marks, and the whole point is that two of them are identical ──
//
// POST_OFFICE and LAMP_POST are the SAME KIND, the SAME TIER and the SAME
// EXTENT, 40 m apart. The only thing that differs between them is whether the
// wheelhouse's timetable names them. If the build ever stops reading the
// timetable and starts reading anything else about the mark, these two stop
// being distinguishable and leg 1 or leg 2 goes red.
const POST_OFFICE = "the-town/the-post-office";
const LAMP_POST = "the-town/the-lamp-post";
const TWIN = "finn/the-twin-post";
const WHEELHOUSE = "the-town/the-wheelhouse";

const sitedMark = (id, tier, at, extra = {}) => {
  const [by, slug] = id.split("/");
  return {
    id, by, household: by, kind: "sited", tier, at, extent: { w: 9, h: 26 },
    body: `${slug} stands here`, ...extra,
  };
};

const marksFor = ({ timetable = true } = {}) => [
  sitedMark(POST_OFFICE, "constitution", { x: 100, y: 200 }),
  sitedMark(LAMP_POST, "constitution", { x: 140, y: 200 }),
  sitedMark(TWIN, "market", { x: 180, y: 200 }),
  // The timetable's own mark. Its `mechanic` is what leg 3 removes — the same
  // field the real `servicesFromFold` gates on (world-clone/tools/vessel.mjs
  // L102), not a flag invented for the test.
  {
    ...sitedMark(WHEELHOUSE, "constitution", { x: 60, y: 200 }),
    ...(timetable ? { mechanic: "timetable" } : {}),
    timetable: {
      vessel: POST_OFFICE,
      stops: [
        { mark: POST_OFFICE, departs: ["00:00Z"] },
        { mark: TWIN, departs: ["06:00Z"] },
      ],
    },
  },
];

const stateWith = (opts) => JSON.stringify({
  tick: 0, dials: {}, parcels: [], determined: {}, vague: [], rivalries: [],
  portfolios: {}, terrain_weight: {}, errors: [], marks: marksFor(opts),
});

// ── the world in a bottle ───────────────────────────────────────────────────
put("WORLD/marks/let-there-be-light/mark.md",
  "---\nkind: sited\nby: the-town\ntier: market\ndate: 2026-09-21\nat: { x: 0, y: 0 }\nextent: { w: 4, h: 4 }\n---\n\nthe public frame\n");
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", stateWith({ timetable: true }));
put("seeding/manifest.json", JSON.stringify({ homes: [] }));
put("tools/mark-lint.mjs", "process.exit(0);\n");
put("tools/world-build.mjs", `
export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }
`);
put("tools/world-verbs.mjs", `
export function orient(_state, world) { return { seen: world.marks.map((m) => m.id) }; }
export function openYourEyes() { return { fov: { carried: [], far: [], counts: {} }, radial: { byBearing: {}, counts: {} }, tell: () => "" }; }
export function investigate(id, world) { return world.marks.find((m) => m.id === id) ?? null; }
`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function householdOf(handle) { return handle; }
export function parcelFor() { return null; }
export function homeOf() { return { ...NOWHERE }; }
export function whereIs() { return { ...NOWHERE }; }
`);
put("tools/walk.mjs", `
export function fractionalCrossing() { return 100.5; }
export function formatDeparture({ handle, from, toward, at }) {
  return \`- 2026-09-21T00:00:00.000Z · \${handle} · from \${from.x},\${from.y} · toward \${toward.x},\${toward.y} · at \${at}\`;
}
export function parseWalkLedger(text) {
  const departures = String(text ?? "").split(/\\r?\\n/).filter((l) => l.startsWith("- ")).map((line) => {
    const handle = line.split(" · ")[1];
    const m = line.match(/toward (-?[\\d.]+),(-?[\\d.]+)/);
    return { handle, line, toward: { x: Number(m?.[1] ?? 0), y: Number(m?.[2] ?? 0) } };
  });
  return { departures, unrecognized: [] };
}
export function currentDeparture(departures, handle) {
  return departures.filter((d) => d.handle === handle).pop() ?? null;
}
export function positionAt(departure) {
  const at = departure?.toward ?? { x: 0, y: 0 };
  return { x: at.x, y: at.y, legM: 0, etaCrossings: 0, standing: true, arrived: true, remainingM: 0 };
}
`);
// The vessel stub, in the REAL module's shape: it gates on \`mechanic ===
// "timetable"\` exactly as world-clone/tools/vessel.mjs L102 does, and it
// resolves each stop's anchor out of the fold the same way. That is what makes
// leg 3's edit — dropping one field — a real change of world rather than a
// switch the fixture invented for itself.
put("tools/vessel.mjs", `
export function servicesFromFold(state) {
  const byId = new Map((state?.marks ?? []).map((m) => [m.id, m]));
  const services = [], errors = [];
  for (const mark of state?.marks ?? []) {
    if (mark.mechanic !== "timetable") continue;
    const tt = mark.timetable ?? {};
    const vesselMark = byId.get(tt.vessel);
    if (!vesselMark) { errors.push({ mark: mark.id, error: "vessel names no mark in the fold" }); continue; }
    const stops = (tt.stops ?? []).map((s) => {
      const m = byId.get(s.mark);
      return m ? { markId: m.id, at: { x: m.at.x, y: m.at.y }, extent: m.extent ?? null, departs: s.departs ?? [] } : null;
    }).filter(Boolean);
    services.push({
      timetableMarkId: mark.id,
      vessel: { markId: vesselMark.id, handle: vesselMark.id.split("/")[1] },
      stops, pace_km_per_crossing: 405,
    });
  }
  return { services, errors };
}
export function vesselPositionAt() { return null; }
export function ashoreOf() { return null; }
`);
put("tools/water.mjs", "export function crossingsOnSegment() { return []; }\n");
put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function pointInRect(px, py, r) { return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2; }
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
export const contains = (outer, inner) => overlapArea(outer, inner) >= 0.99 * inner.w * inner.h;
export const marksContain = (outer, inner) => contains(rect(outer), rect(inner));
`);
put("tools/marks-fold.mjs", `
export function loadMarks() { return []; }
export function fold() { return { marks: [] }; }
export function placementParent() { return null; }
export function marksContain() { return false; }
`);

git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main");

process.env.WORLD_CLONE = repo;
process.env.WORLD_POOL_DIR = pool;
process.env.WORLD_POOL_SIZE = "2";
const { walkViaOffice } = await import("../src/world.mjs");

const houseA = { household: "house-a", handles: new Set(["alpha"]) };

/** Today's refusal, quoted rather than described — if the words move, these
 *  reds name the move. */
const REFUSAL = (id) => `"${id}" is constitution — the town's own furniture, not a destination`;
const REFUSAL_HINT = "walk to a market or sovereign mark, or give coordinates";

// ── leg 1: the stop the timetable names is a destination ────────────────────

test("a walk to the constitution mark the timetable names is ADMITTED, and lands on its ground", async () => {
  const walk = await walkViaOffice(repo, { handle: "alpha", mark_id: POST_OFFICE }, houseA);

  assert.equal(walk.mark_id, POST_OFFICE, "the door took the mark as the target");
  assert.match(String(walk.toward_is), /the-town\/the-post-office/,
    "the answer names the stop it walked to");
  assert.ok(walk.ledger?.commit, "the departure was recorded, the same as any other walk");

  // THE SAME AS A COORDINATE WALK TO IT — the brief's own yardstick. Kogane's
  // workaround was a 71,340-character mark read to dig out these two numbers
  // and then this call; the point of the rule is that the id gets her the same
  // answer without the dig.
  const byCoords = await walkViaOffice(repo, { handle: "alpha", x: 100, y: 200 }, houseA);
  assert.deepEqual(walk.toward, byCoords.toward,
    "walking to the stop by id did not land where walking to its ground by coordinates lands");

  // …and the same as walking to a market mark of identical geometry: the tier
  // is no longer part of the answer for a mark the timetable names.
  const twin = await walkViaOffice(repo, { handle: "alpha", mark_id: TWIN }, houseA);
  assert.equal(typeof walk.leg_m, typeof twin.leg_m);
  assert.equal(walk.provenance, twin.provenance,
    "the admitted constitution walk and an ordinary market walk answered with different provenance");
});

// ── leg 2: furniture no timetable names still bounces, verbatim ─────────────

test("a walk to a constitution mark NO timetable names still bounces with today's exact words", async () => {
  await assert.rejects(
    () => walkViaOffice(repo, { handle: "alpha", mark_id: LAMP_POST }, houseA),
    (e) => {
      assert.equal(e.code, 422);
      assert.equal(e.defect, REFUSAL(LAMP_POST),
        "the refusal's words changed — this is the sentence residents have been reading");
      assert.equal(e.hint, REFUSAL_HINT, "the refusal's hint changed");
      return true;
    });
});

// ── leg 3: one id, two worlds ───────────────────────────────────────────────

test("with no vessel service in the world, the SAME id bounces exactly as it did before the rule", async () => {
  // The world moves: the wheelhouse keeps its timetable and loses the mechanic
  // that runs it. `world()` is cached per ref and checks the SHA, so a commit is
  // what makes this a different world rather than a poked cache.
  writeFileSync(join(repo, "WORLD", "world-state.json"), stateWith({ timetable: false }));
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "the schedule nothing runs");

  await assert.rejects(
    () => walkViaOffice(repo, { handle: "alpha", mark_id: POST_OFFICE }, houseA),
    (e) => {
      assert.equal(e.code, 422);
      assert.equal(e.defect, REFUSAL(POST_OFFICE),
        "a world with no vessel service admitted a constitution mark — the exemption is not reading the timetable");
      assert.equal(e.hint, REFUSAL_HINT);
      return true;
    });

  // The control the empty answer needs: the market mark still walks in this
  // same world, so leg 3's red would be the exemption and not a broken bottle.
  const twin = await walkViaOffice(repo, { handle: "alpha", mark_id: TWIN }, houseA);
  assert.equal(twin.mark_id, TWIN, "the bottle stopped walking altogether — leg 3 proves nothing");
});

// ── leg 4: the premise, on the real engine and the real fold ────────────────

const CLONE = process.env.WORLD_CLONE_REAL ?? join(process.cwd(), "world-clone");
const HAVE_CLONE = existsSync(join(CLONE, "WORLD", "world-state.json"))
  && existsSync(join(CLONE, "tools", "vessel.mjs"));

test("the LIVE world's own timetable really does name a constitution-tiered mark", { skip: HAVE_CLONE ? false : "no world clone beside this office" }, async () => {
  const vessel = await import(pathToFileURL(join(CLONE, "tools", "vessel.mjs")).href);
  const { isVehicleStop } = await import("../src/world-ride.mjs");
  const fold = JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  const { services } = vessel.servicesFromFold({ marks: fold.marks });

  assert.ok(services.length >= 1, "the live fold names no vessel service at all");
  const byId = new Map(fold.marks.map((m) => [m.id, m]));

  // The claim, stated as the thing it is: SOMEWHERE in this world a published
  // timetable names a mark the walk verb used to refuse. Not "the post office
  // specifically" — the rule is about the relation, and pinning the id would
  // red this leg the day the town moves a stop.
  const refusedStops = services.flatMap((s) => s.stops.map((st) => byId.get(st.markId)))
    .filter((m) => m && m.tier === "constitution");
  assert.ok(refusedStops.length >= 1,
    "no stop on any live timetable carries the tier the walk verb refuses — POS-165's instance is gone from the world");

  for (const m of refusedStops) {
    assert.equal(m.kind, "sited", `${m.id} is a stop the walk verb refuses for its TIER, so it must be sited for the exemption to reach it`);
    assert.ok(Number.isFinite(m.at?.x) && Number.isFinite(m.at?.y), `${m.id} has no place on the map`);
    assert.ok(isVehicleStop(m.id, services.find((s) => s.stops.some((st) => st.markId === m.id))),
      `${m.id} is on a timetable but the predicate the door uses does not see it`);
  }
});
