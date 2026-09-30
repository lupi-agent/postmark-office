// pos-261-riders-on-both-reads.test.mjs — the map's walkers read follows the
// ledger the way present does.
//
//   node --test test/pos-261-riders-on-both-reads.test.mjs
//
// THE SPLIT (POS-261). Aboard is occupancy, read off the enter-exit ledger
// (#2986), and `/world/present` applies it through `withVehicleRiders`. The
// walkers door (`/world/walkers`, what the map draws) built its frame map by
// folding each resident's walks instead, and since POS-247 a walk never boards:
// the fold answered the world frame for everyone. So a ledger rider stood at
// the hull on the presence read and on the ground they entered from on the
// walkers read.
//
// Both doors are driven here as the office serves them, over one miniature
// world: the movement fixture's harbour and timetable, the real engine's
// walk/vessel/enter-exit modules, and a frozen enter-exit ledger that puts one
// resident aboard.
//
//   marigold    walked to a point off the harbour, then entered her through the
//               ledger. Aboard: both reads place her at the hull, wherever the
//               hull is now.
//   dom-pidgey  walked from the Snug onto her deck while she lay at the quay,
//               and never entered through the ledger. Ashore: both reads leave
//               him where the walk ended.
//
// CAN-FAIL FLIP: in `world.mjs § walkersInFrames`, hand `withFrames` null in
// place of the riders → the walkers read puts marigold back at her walk's end,
// and the first test goes red.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { fixtureWorldCloneWithEngine, fixtureWorldDb, mainShaOf, scratchDir, crossingStart } from "./dynamic-fixture.mjs";
import { ENGINE_FILES, fixtureMarks } from "./movement-fixture.mjs";

const REAL_CLONE = (await import("../src/world-store.mjs")).WORLD_CLONE;
const scratch = scratchDir("pos261");

const SHIP = "the-town/the-post-office";
const FRAME = "the-town/let-there-be-light";
// Her mark carries `class: vehicle`, as the live world's does since #2986.
const MARKS = [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "let there be light" },
  ...fixtureMarks().map((m) => (m.id === SHIP ? { ...m, class: "vehicle" } : m)),
];

const N = 200;                         // a crossing in the past, so every leg has arrived
const B = crossingStart(N);
const OFF_HARBOUR = { x: 2000, y: 500 };  // nowhere on her route, so the hull never stands here
const SNUG = { x: 60, y: 0 };
const HULL_DECK = { x: 2, y: 3 };      // inside her 10×26 footprint while she lies at the quay (0, 0)
const DEPARTURES = [
  { at: new Date(B).toISOString(), actor: "marigold", from: OFF_HARBOUR, toward: OFF_HARBOUR, crossing: N, line_no: 1 },
  { at: new Date(B).toISOString(), actor: "dom-pidgey", from: SNUG, toward: HULL_DECK, crossing: N, line_no: 2 },
];

const repo = fixtureWorldCloneWithEngine({ label: "pos261", marks: MARKS, departures: DEPARTURES });
// The real engine for the clock, the timetable and the enter/exit grammar; the
// fixture's verbs, with the one export `crossingLaw` asks for.
for (const f of [...ENGINE_FILES, "enter-exit.mjs"]) copyFileSync(join(REAL_CLONE, "tools", f), join(repo, "tools", f));
writeFileSync(join(repo, "tools", "world-verbs.mjs"),
  readFileSync(join(repo, "tools", "world-verbs.mjs"), "utf8") + "\nexport function enter() { return null; }\n");
writeFileSync(join(repo, "WORLD", "enter-exit-ledger-frozen.md"), [
  "# Enter/exit ledger — the frozen era", "",
  `- ${new Date(B + 3600_000).toISOString()} · marigold · enters ${SHIP} · at ${N}.0833 · word neutral`, "",
].join("\n"));
const quiet = { stdio: ["ignore", "pipe", "pipe"] };
execFileSync("git", ["-C", repo, "add", "-A"], quiet);
execFileSync("git", ["-C", repo, "-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "the real engine and one rider"], quiet);

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
after(() => { sweep(scratch); sweep(repo); });

const worldDbPath = join(scratch, "world.db");
const dynPath = join(scratch, "dynamic.db");
process.env.WORLD_CLONE = repo;
process.env.WORLD_STORE_DB = worldDbPath;
process.env.WORLD_DYNAMIC_DB = dynPath;
// Presence reads the position projection (POS-269): the entities table it read
// without one went with dynamic.db.
process.env.WORLD_POSITIONS = "1";
process.env.WORLD_MOVEMENT_V2 = "1";
delete process.env.WORLD_APEX;
delete process.env.WORLD_EMISSIONS;

let world, movement;
before(async () => {
  fixtureWorldDb(worldDbPath, { sha: mainShaOf(repo), departures: DEPARTURES });
  world = await import("../src/world.mjs");
  movement = await import("../src/world-movement.mjs");
  process.env.WORLD_PRESENCE = "1";
});
after(() => { delete process.env.WORLD_PRESENCE; delete process.env.WORLD_MOVEMENT_V2; });

const worldState = () => JSON.parse(readFileSync(join(repo, "WORLD", "world-state.json"), "utf8"));
const bothReads = async () => {
  const walkers = await world.worldWalkers(repo, null);
  const present = await world.worldPresent({});
  const hull = await movement.vesselPositionAt(worldState(), Date.now(), { repo });
  return { walkers: walkers.walkers ?? [], present: present.residents ?? [], hull };
};
const near = (a, b, m = 2) => Math.hypot(a.x - b.x, a.y - b.y) <= m;

test("a ledger rider reads at the hull on both reads", async () => {
  const { walkers, present, hull } = await bothReads();
  assert.ok(hull, "the fixture's timetable answers where she is");
  assert.ok(!near(hull, OFF_HARBOUR, 100), "the hull is nowhere near where marigold walked, so the two answers can be told apart");

  const w = walkers.find((r) => r.handle === "marigold");
  const p = present.find((r) => r.handle === "marigold");
  console.log(`    RECEIPT · hull (${Math.round(hull.x)}, ${Math.round(hull.y)}) · walkers marigold (${Math.round(w?.x)}, ${Math.round(w?.y)}) aboard=${w?.aboard} frame=${w?.frame} · present marigold (${p?.at?.x}, ${p?.at?.y}) aboard=${p?.aboard} frame=${p?.frame}`);
  assert.ok(p, "present names her");
  assert.equal(p.aboard, true, "present reads her aboard");
  assert.ok(near(p.at, hull), "present places her at the hull");
  assert.ok(w, "walkers names her");
  assert.equal(w.aboard, true, "walkers reads her aboard, as present does");
  assert.equal(w.frame, SHIP, "in the vehicle's frame");
  assert.ok(near(w, hull), `walkers places her at the hull, not at her walk's end (${w.x}, ${w.y})`);
});

test("a walk to the hull reads ashore on both reads", async () => {
  const { walkers, present } = await bothReads();
  const w = walkers.find((r) => r.handle === "dom-pidgey");
  const p = present.find((r) => r.handle === "dom-pidgey");
  assert.ok(w && p, "both reads name him");
  assert.ok(!w.aboard, "walkers: a walk never boards");
  assert.ok(!p.aboard, "present: a walk never boards");
  assert.equal(w.frame ?? null, null);
  assert.equal(p.frame ?? null, null);
  assert.ok(near(w, HULL_DECK), "walkers leaves him where the walk ended");
  assert.ok(near(p.at, HULL_DECK), "present leaves him where the walk ended");
});
