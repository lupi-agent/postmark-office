// world-serve.test.mjs — Stage 1's serving flag: the guard, the shadow, and the
// promise that both flags off changes nothing.
//
// Four falsifiers, and each one is written so it CAN fail:
//
//   flags off      the store db is replaced with garbage and the office does not
//                  notice. If any code path touched the store it would throw or
//                  move a counter; both are asserted.
//   the shadow     a discrepancy is INJECTED into the store (a naming mark given
//                  a different value) and the shadow is required to catch it,
//                  log it with both hashes, and still serve the fold's answer.
//   ruling 9       a key whose household has a draft branch must never reach the
//                  store. The store callback is a spy that throws if called.
//   staleness      a store hydrated at a sha main no longer points at falls
//                  through, named, rather than serving a world one commit old.
//
// A real world clone and a hand-built world.db, both thrown away after: the
// hydrator takes eight seconds and needs the town's own history, and none of
// what is tested here is about hydration.
//
//   node --test test/world-serve.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

// ── the fixture world ────────────────────────────────────────────────────────

const repo = mkdtempSync(join(tmpdir(), "postmark-world-serve-"));
after(() => rmSync(repo, { recursive: true, force: true }));
const dbPath = join(repo, "fixture-world.db");
const logPath = join(repo, "shadow.jsonl");

process.env.WORLD_CLONE = repo;
// The world is the rows (test/helpers/world-rows.mjs, POS-270 lane W 3a):
// buildStore() publishes the fixture as the world graph snapshot, and world.db's
// path points nowhere, so no read here can stand on the file.
process.env.WORLD_STORE_DB = join(repo, "no-world-db-here.db");
process.env.WORLD_STORE_SHADOW_LOG = logPath;
delete process.env.WORLD_STORE_READS;
delete process.env.WORLD_STORE_SHADOW;

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

const FRAME = "the-town/let-there-be-light";   // world.mjs's WORLD_FRAME — the spine drops it
const MARKS = [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "let there be light" },
  { id: "the-town/town-square", by: "the-town", kind: "sited", tier: "constitution", at: { x: 100, y: 100 }, extent: { w: 200, h: 200 }, body: "the square" },
  { id: "alpha/well", by: "alpha", kind: "sited", tier: "market", at: { x: 100, y: 100 }, extent: { w: 20, h: 20 }, body: "a well" },
  { id: "alpha/well-name", by: "alpha", kind: "naming", tier: "market", parent: "alpha/well", value: "The Old Well", body: "a name cut into the rim" },
  { id: "the-town/lone-cairn", by: "the-town", kind: "sited", tier: "market", at: { x: 4000, y: 4000 }, extent: { w: 10, h: 10 }, body: "a cairn" },
  // the ring-carrying mark: the store keeps only its VERTEX COUNT, so every
  // point inside its bbox is one the store may not answer about
  { id: "the-town/the-pond", by: "the-town", kind: "sited", tier: "constitution", at: { x: -2000, y: -2000 }, extent: { w: 400, h: 400 }, body: "water", points: [[-2200, -2200], [-1800, -2200], [-1800, -1800], [-2200, -1800]] },
  // two marks sharing one centre — a parcel and the house on it, the ordinary
  // arrangement that makes the nearest-mark fallback a coin toss
  { id: "beta/hearth-parcel", by: "beta", kind: "parcel", tier: "market", at: { x: 9000, y: 9000 }, extent: { w: 25, h: 25 }, body: "beta's ground" },
  { id: "beta/hearth", by: "beta", kind: "sited", tier: "market", at: { x: 9000, y: 9000 }, extent: { w: 6, h: 6 }, body: "beta's house" },
];

put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: MARKS, parcels: [], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [] }));
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("seeding/manifest.json", JSON.stringify({ homes: [] }));

// The engine, in miniature — the same shapes the real tools/ export, because the
// office imports these from the clone and this test is about the SERVING layer,
// not about geometry. `containmentChain` mirrors world-verbs.mjs: containing
// marks sorted by extent area, nested outward, root-first, and a `points:` ring
// wins over the bbox where one exists.
put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function pointInRect(px, py, r) { return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2; }
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
export const contains = (outer, inner) => overlapArea(outer, inner) >= 0.99 * inner.w * inner.h;
export const polygonOf = (m) => (Array.isArray(m?.points) && m.points.length >= 3 ? m.points.map((p) => ({ x: p[0], y: p[1] })) : null);
export function pointInPolygon(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
`);
put("tools/world-verbs.mjs", `
import { rect, contains, pointInRect, polygonOf, pointInPolygon } from "./geometry.mjs";
const area = (m) => (m.extent?.w ?? 1) * (m.extent?.h ?? 1);
const within = (pos, m) => { const ring = polygonOf(m); return ring ? pointInPolygon(pos.x, pos.y, ring) : pointInRect(pos.x, pos.y, rect(m)); };
export function containmentChain(pos, marks) {
  const containing = marks
    .filter((m) => m.at && (m.kind === "sited" || m.kind === "parcel") && within(pos, m))
    .sort((a, b) => area(a) - area(b));
  const nest = [];
  for (const m of containing) if (!nest.length || contains(rect(m), rect(nest[nest.length - 1]))) nest.push(m);
  return nest.reverse().map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body, extentM: Math.max(m.extent?.w ?? 0, m.extent?.h ?? 0) }));
}
export function orient() { return {}; }
export function openYourEyes() { return { fov: {}, radial: {}, tell: () => "" }; }
export function investigate() { return null; }
`);
put("tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function homeOf() { return NOWHERE; }
export function whereIs() { return NOWHERE; }
export function publicResidents() { return []; }
`);

git("init", "--quiet", "--initial-branch=main");
git("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "fixture world");
const MAIN_SHA = git("rev-parse", "refs/heads/main").trim();

// a household sketchbook, for the ruling-9 guard
git("branch", "draft/house-a", "main");

// ── the store, hand-built ────────────────────────────────────────────────────
// Same SCHEMA the hydrator writes, filled by hand: what is under test is the
// serving layer's behaviour over a store, not the hydrator's derivation.

const { SCHEMA } = await import("../src/world-store.mjs");
const W = await import("./helpers/world-rows.mjs");

function buildStore({ sha = MAIN_SHA, marks = MARKS, status = "OK" } = {}) {
  if (existsSync(dbPath)) rmSync(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  meta.run("as_of_world", sha);
  meta.run("as_of_office", "");
  meta.run("hydrated_at", new Date().toISOString());
  meta.run("hydration_status", status);
  meta.run("world_path", repo);
  meta.run("counts", JSON.stringify({ nodes_total: marks.length }));
  const node = db.prepare("INSERT OR REPLACE INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?)");
  const edge = db.prepare("INSERT INTO edges (src, dst, type, props, born_at) VALUES (?,?,?,?,?)");
  for (const m of marks) {
    node.run(m.id, "mark", m.kind, m.tier ?? null, m.by ?? null,
      m.at?.x ?? null, m.at?.y ?? null, m.extent?.w ?? null, m.extent?.h ?? null,
      JSON.stringify({
        slug: m.id.split("/").at(-1), body: m.body ?? "", slot: m.slot ?? null, value: m.value ?? null,
        points: Array.isArray(m.points) ? m.points.length : null,
        parent_dir_mark: m.parent ?? null, explicit_parent: null, far: null,
      }));
  }
  // the containment edges the graph queries walk (markSpine / fanUp)
  edge.run(FRAME, "the-town/town-square", "contains", "{}", null);
  edge.run("the-town/town-square", "alpha/well", "contains", "{}", null);
  edge.run("alpha/well", "alpha/well-name", "describes", "{}", null);
  db.close();
  // The store never holds a FAILED snapshot (world-hydrate.mjs): a failed
  // hydration leaves no graph to stand on, which is what the readers see.
  if (status === "OK") W.publishWorld(dbPath); else W.clearWorld();
}
buildStore();

// ── the code under test ──────────────────────────────────────────────────────

const serve = await import("../src/world-serve.mjs");
const { placeWords } = await import("../src/world.mjs");

const off = () => { delete process.env.WORLD_STORE_READS; delete process.env.WORLD_STORE_SHADOW; };
const shadowOnly = () => { delete process.env.WORLD_STORE_READS; process.env.WORLD_STORE_SHADOW = "1"; };
const serveOnly = () => { process.env.WORLD_STORE_READS = "1"; delete process.env.WORLD_STORE_SHADOW; };
const both = () => { process.env.WORLD_STORE_READS = "1"; process.env.WORLD_STORE_SHADOW = "1"; };

beforeEach(() => {
  off();
  serve.resetStoreCounters();
  serve.resetStoreSnapshot();
  if (existsSync(logPath)) rmSync(logPath);
});

const logLines = () => (existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

// ── 1. both flags off: the store is never opened ─────────────────────────────

test("flags off — a corrupt store changes nothing and is never opened", async () => {
  const good = await placeWords({ x: 100, y: 100 });
  assert.equal(good, "The Old Well, Town Square");

  // Replace the store with bytes no sqlite can open. If any read path touched
  // it, this would throw or fall through — both are visible below.
  writeFileSync(dbPath, "this is not a database");
  W.clearWorld();   // the store unreadable: no graph to stand on
  serve.resetStoreSnapshot();

  assert.equal(await placeWords({ x: 101, y: 101 }), "The Old Well, Town Square");
  assert.equal(await placeWords({ x: 4001, y: 4001 }), "Lone Cairn");
  assert.equal(await placeWords({ x: 50000, y: 50000 }), "open ground");

  const c = serve.storeCounters();
  assert.equal(c.reads, 0, "flags off must not count a read");
  assert.equal(c.served_from_store, 0);
  assert.equal(c.served_from_fold, 0, "flags off does not even record a fall-through — the harness returns before it");
  assert.equal(serve.storeMode(), "off");
  buildStore();
  serve.resetStoreSnapshot();
});

test("flags off — servedRead returns the fold without consulting the store callback", async () => {
  let consulted = false;
  const answer = await serve.servedRead("probe", {
    repo, key: null,
    fold: () => "the fold",
    store: () => { consulted = true; return "the store"; },
  });
  assert.equal(answer, "the fold");
  assert.equal(consulted, false);
  assert.deepEqual(serve.storeCounters().reads, 0);
});

// ── 2. the modes ─────────────────────────────────────────────────────────────

test("serve mode answers from the store", async () => {
  serveOnly();
  const answer = await serve.servedRead("probe", { repo, key: null, fold: () => "the fold", store: () => "the store" });
  assert.equal(answer, "the store");
  assert.equal(serve.storeCounters().served_from_store, 1);
  assert.equal(serve.storeCounters().compared, 0, "serve alone compares nothing — that is what graduating means");
});

test("shadow mode serves the FOLD while comparing both", async () => {
  shadowOnly();
  const answer = await serve.servedRead("probe", { repo, key: null, fold: () => "same", store: () => "same" });
  assert.equal(answer, "same");
  const c = serve.storeCounters();
  assert.equal(c.served_from_fold, 1);
  assert.equal(c.served_from_store, 0);
  assert.equal(c.compared, 1);
  assert.equal(c.agreed, 1);
  assert.equal(c.diffs, 0);
});

test("both flags: the store answers and the fold verifies", async () => {
  both();
  const answer = await serve.servedRead("probe", { repo, key: null, fold: () => "fold", store: () => "store" });
  assert.equal(answer, "store");
  const c = serve.storeCounters();
  assert.equal(c.served_from_store, 1);
  assert.equal(c.diffs, 1, "and the disagreement is still caught");
});

// ── 3. the shadow catches an injected discrepancy ────────────────────────────

test("shadow catches an INJECTED store discrepancy, logs it, and still serves the fold", async () => {
  // The store now says the well is named something else. Nothing else changes:
  // same sha, same marks, same everything the guard checks.
  buildStore({ marks: MARKS.map((m) => (m.id === "alpha/well-name" ? { ...m, value: "The Wrong Well" } : m)) });
  serve.resetStoreSnapshot();
  shadowOnly();

  const words = await placeWords({ x: 102, y: 102 });
  assert.equal(words, "The Old Well, Town Square", "the resident still hears the fold's answer — shadow changes nothing they can see");

  const c = serve.storeCounters();
  assert.equal(c.compared, 1);
  assert.equal(c.diffs, 1);
  assert.equal(c.agreed, 0);

  const [line] = logLines();
  assert.ok(line, "a diff must reach the log");
  assert.equal(line.read, "place_words");
  assert.equal(line.route, "placeWords");
  assert.deepEqual(line.query, { x: 102, y: 102 });
  assert.equal(line.as_of_world, MAIN_SHA);
  assert.equal(line.main_sha, MAIN_SHA);
  assert.notEqual(line.fold_hash, line.store_hash);
  assert.match(line.diff.fold, /The Old Well/);
  assert.match(line.diff.store, /The Wrong Well/);

  buildStore();
  serve.resetStoreSnapshot();
});

test("shadow agrees when the store holds the same world — the check can pass as well as fail", async () => {
  shadowOnly();
  const words = await placeWords({ x: 103, y: 103 });
  assert.equal(words, "The Old Well, Town Square");
  const c = serve.storeCounters();
  assert.equal(c.compared, 1);
  assert.equal(c.agreed, 1);
  assert.equal(c.diffs, 0);
  assert.deepEqual(logLines(), []);
});

test("identical diffs are logged once and counted every time", async () => {
  buildStore({ marks: MARKS.map((m) => (m.id === "alpha/well-name" ? { ...m, value: "The Wrong Well" } : m)) });
  serve.resetStoreSnapshot();
  shadowOnly();
  for (const x of [92, 94, 96, 98]) await placeWords({ x, y: 100 });   // four points inside the well, four sightings of one wrong name
  assert.equal(serve.storeCounters().diffs, 4);
  assert.equal(logLines().length, 1, "one finding, four sightings");
  buildStore();
  serve.resetStoreSnapshot();
});

// ── 4. ruling 9: a draft read never reaches the store ────────────────────────

test("ruling 9 — a household with a draft branch is never served from the store", () => {
  const key = { household: "house-a", handles: new Set(["alpha"]) };
  const gate = serve.eligibility({ key, repo });
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "draft-branch");
  assert.match(gate.draft_ref, /draft\/house-a/);
});

test("ruling 9 — in SERVE mode the store callback is not even invoked for a draft key", async () => {
  serveOnly();
  const key = { household: "house-a", handles: new Set(["alpha"]) };
  const answer = await serve.servedRead("probe", {
    repo, key,
    fold: () => "the household's own sketchbook",
    store: () => { throw new Error("the store must never answer a draft read"); },
  });
  assert.equal(answer, "the household's own sketchbook");
  assert.equal(serve.storeCounters().fall_through["draft-branch"], 1);
  assert.equal(serve.storeCounters().served_from_store, 0);
});

test("ruling 9 — nor in SHADOW mode: a draft read has nothing in the store to diff against", async () => {
  shadowOnly();
  const key = { household: "house-a", handles: new Set(["alpha"]) };
  await serve.servedRead("probe", {
    repo, key,
    fold: () => "sketchbook",
    store: () => { throw new Error("the store must never answer a draft read"); },
  });
  assert.equal(serve.storeCounters().compared, 0);
  assert.equal(serve.storeCounters().fall_through["draft-branch"], 1);
});

test("a household with NO draft branch reads published main, and is eligible", () => {
  const key = { household: "house-with-no-sketchbook", handles: new Set(["beta"]) };
  const gate = serve.eligibility({ key, repo });
  assert.equal(gate.ok, true, "eligibility follows the fold's own ref choice, not the presence of a household");
});

test("a visitor key is eligible — an unresolved caller folds published main", () => {
  assert.equal(serve.eligibility({ key: { household: "house-a", visitor: true, handles: new Set() }, repo }).ok, true);
});

// ── 5. freshness, availability, refusal ──────────────────────────────────────

test("a store hydrated at another sha falls through, named", async () => {
  buildStore({ sha: "0".repeat(40) });
  serve.resetStoreSnapshot();
  both();
  const answer = await serve.servedRead("probe", { repo, key: null, fold: () => "fold", store: () => "store" });
  assert.equal(answer, "fold");
  const c = serve.storeCounters();
  assert.equal(c.fall_through["store-stale"], 1);
  assert.equal(c.compared, 0, "a stale store's disagreement is staleness, not a finding — counting it as a diff would drown the real ones");
  buildStore();
  serve.resetStoreSnapshot();
});

test("a FAILED-stamped store is unavailable, not silently empty", async () => {
  buildStore({ status: "FAILED: empty tables — nodes (promised by gate world-clone)" });
  serve.resetStoreSnapshot();
  serveOnly();
  const answer = await serve.servedRead("probe", { repo, key: null, fold: () => "fold", store: () => "store" });
  assert.equal(answer, "fold");
  assert.equal(serve.storeCounters().fall_through["store-unavailable"], 1);
  buildStore();
  serve.resetStoreSnapshot();
});

test("a missing store falls through rather than throwing", async () => {
  rmSync(dbPath);
  W.clearWorld();
  serve.resetStoreSnapshot();
  serveOnly();
  assert.equal(await serve.servedRead("probe", { repo, key: null, fold: () => "fold", store: () => "store" }), "fold");
  assert.equal(serve.storeCounters().fall_through["store-unavailable"], 1);
  buildStore();
  serve.resetStoreSnapshot();
});

test("a store query that throws falls through and says so", async () => {
  serveOnly();
  assert.equal(await serve.servedRead("probe", { repo, key: null, fold: () => "fold", store: () => { throw new Error("boom"); } }), "fold");
  assert.equal(serve.storeCounters().fall_through["store-threw"], 1);
});

test("cannotAnswer is a fall-through with a reason, never a wrong answer", async () => {
  serveOnly();
  const answer = await serve.servedRead("probe", { repo, key: null, fold: () => "fold", store: () => serve.cannotAnswer("some-named-reason") });
  assert.equal(answer, "fold");
  assert.equal(serve.storeCounters().fall_through["cannot-answer"], 1);
  assert.equal(serve.storeCounters().cannot_answer["some-named-reason"], 1);
});

// ── 6. what the store may not answer about a point ───────────────────────────

test("a point inside a ring-carrying mark's bbox is refused — the store holds the vertex COUNT, not the ring", async () => {
  serveOnly();
  const words = await placeWords({ x: -2000, y: -2000 });
  assert.equal(words, "the Pond", "the resident's answer is unchanged — it came from the fold");
  assert.equal(serve.storeCounters().cannot_answer["irregular-shape-in-play"], 1);
  assert.equal(serve.storeCounters().served_from_store, 0);
});

test("equidistant marks refuse the nearest-mark fallback — its tie-break is iteration order", async () => {
  serveOnly();
  // (9000, 8000) contains nothing, and beta's house and its parcel share a
  // centre, so "the nearest sited mark" has two right answers and today's code
  // keeps whichever the list happened to hold first.
  const words = await placeWords({ x: 9000, y: 8000 });
  assert.equal(serve.storeCounters().cannot_answer["nearest-tie"], 1);
  assert.ok(words === "open ground" || words.startsWith("near "), `unexpected place words: ${words}`);
});

test("but a tie away from the fallback does not refuse — the guard guards what it is guarding", async () => {
  serveOnly();
  // inside the square: the spine answers, so the fallback never runs and the
  // coin toss beta's twin marks would cause is irrelevant.
  assert.equal(await placeWords({ x: 120, y: 120 }), "Town Square");
  assert.equal(serve.storeCounters().served_from_store, 1);
  assert.equal(serve.storeCounters().cannot_answer["nearest-tie"], undefined);
});

test("serve mode answers place words from the store, byte-for-byte the fold's answer", async () => {
  const foldAnswer = await placeWords({ x: 104, y: 104 });
  serveOnly();
  const storeAnswer = await placeWords({ x: 105, y: 105 });   // same cell as 104 after rounding? no — distinct cache cells
  assert.equal(storeAnswer, foldAnswer);
  assert.equal(serve.storeCounters().served_from_store, 1);
});

// ── 7. the projection and the graph-only queries ─────────────────────────────

test("the projection gives `parent` only to describing marks — the fold's field, the fold's meaning", () => {
  const snap = serve.storeSnapshot();
  assert.equal(snap.error, undefined);
  const naming = snap.marks.find((m) => m.id === "alpha/well-name");
  const sited = snap.marks.find((m) => m.id === "alpha/well");
  assert.equal(naming.parent, "alpha/well");
  assert.equal(sited.parent, null, "a geometric mark's directory parent is store-only knowledge and must not wear the fold's field name");
});

test("markRecord answers the record, never the fold's settled-stake outputs", () => {
  const rec = serve.markRecord(serve.storeSnapshot(), "alpha/well");
  assert.equal(rec.kind, "sited");
  assert.deepEqual(rec.at, { x: 100, y: 100 });
  assert.equal(rec.stamps, undefined);
  assert.equal(rec.weight, undefined);
  assert.equal(serve.markRecord(serve.storeSnapshot(), "nobody/nowhere"), null);
});

test("markSpine and fanUp answer from the contains edges — questions the fold cannot answer at all", () => {
  const snap = serve.storeSnapshot();
  assert.deepEqual(serve.markSpine(snap, "alpha/well"), ["the-town/town-square", FRAME]);
  assert.equal(serve.fanUp(snap, "the-town/town-square"), 1);
  assert.equal(serve.fanUp(snap, FRAME), 2);
  assert.equal(serve.fanUp(snap, "alpha/well"), 0);
});

// ── 8. the operator's surface ────────────────────────────────────────────────

test("the health surface names the mode, the shas, and whether the store is fresh", async () => {
  shadowOnly();
  await placeWords({ x: 130, y: 130 });
  const h = serve.worldStoreHealth({ repo });
  assert.equal(h.mode, "shadow");
  assert.equal(h.db.present, true);
  assert.equal(h.db.as_of_world, MAIN_SHA);
  assert.equal(h.main.sha, MAIN_SHA);
  // `fresh` moved to the blessed block (postmark#2934): the gate compares the
  // store to what the read tier serves; this fixture has no settlement tag, so
  // the blessing IS main and the panel says so
  assert.equal(h.blessed.sha, MAIN_SHA);
  assert.equal(h.blessed.source, "main");
  assert.equal(h.blessed.fresh, true);
  assert.equal(h.main.ahead_of_blessed, false);
  assert.equal(h.counters.compared, 1);
  assert.equal(h.db.ring_carrying_marks, 1);
  assert.equal(h.shadow_log.path, logPath);
});

test("the health surface reports a stale store as not fresh", () => {
  buildStore({ sha: "f".repeat(40) });
  serve.resetStoreSnapshot();
  const h = serve.worldStoreHealth({ repo });
  assert.equal(h.blessed.fresh, false);
  assert.equal(h.db.as_of_world, "f".repeat(40));
  buildStore();
  serve.resetStoreSnapshot();
});

// ── 9. the cache the serve path would otherwise strand ───────────────────────

test("a rehydration invalidates the place-word cache in serve mode", async () => {
  serveOnly();
  // (100,100) is inside the well; its answer is cached under this snapshot.
  assert.equal(await placeWords({ x: 100, y: 100 }), "The Old Well, Town Square");
  // The store advances and the well is renamed. In serve mode `world()` never
  // runs, and the SAME CELL is asked again — so nothing but the store's own
  // epoch can invalidate what is cached there.
  buildStore({ marks: MARKS.map((m) => (m.id === "alpha/well-name" ? { ...m, value: "The Renamed Well" } : m)) });
  serve.resetStoreSnapshot();
  assert.equal(await placeWords({ x: 100, y: 100 }), "The Renamed Well, Town Square",
    "a cache hit returns before the harness — only the store's epoch can retire it");
  buildStore();
  serve.resetStoreSnapshot();
});

test("publishedMainSha follows the DESCENDANT when local main and origin/main disagree", () => {
  // A fresh repo, because the resolver caches WHICH refs exist per repo path
  // and every other test here runs against a clone with no origin refs at all.
  // The two-pens case (2026-08-17): the keeper's PC pushes straight to GitHub
  // while the box's local main only moves at settlements — the as-of bar read
  // that lag backwards and called the store BEHIND a two-hour-stale "main".
  const two = mkdtempSync(join(tmpdir(), "pm-two-pens-"));
  const g = (...args) => execFileSync("git", ["-C", two, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  writeFileSync(join(two, "a.txt"), "one");
  g("init", "--quiet", "--initial-branch=main");
  g("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "one");
  const older = g("rev-parse", "refs/heads/main").trim();
  writeFileSync(join(two, "a.txt"), "two");
  g("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "two");
  const newer = g("rev-parse", "refs/heads/main").trim();

  // the keeper's pen pushed straight to GitHub: origin/main AHEAD of local
  g("update-ref", "refs/remotes/origin/main", newer);
  g("update-ref", "refs/heads/main", older);
  assert.equal(serve.publishedMainSha(two), newer, "origin ahead: the tick's fetch knows a truth local main does not");

  // a settlement mid-push: local main AHEAD of origin
  g("update-ref", "refs/heads/main", newer);
  g("update-ref", "refs/remotes/origin/main", older);
  assert.equal(serve.publishedMainSha(two), newer, "local ahead: the settlement's line is published truth in flight");

  rmSync(two, { recursive: true, force: true });
});
