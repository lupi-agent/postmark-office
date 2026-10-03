// ring-derives-box.test.mjs — POS-322 on the door that runs: a mark's box is
// derived from its ring.
//
// Keemin, 2026-10-02: "the deeper fix is that extent should just be derived
// from the ring." kinofire's 16:36Z amend of kinofire/the-gloaming sent its
// 16-point ring with `at` at the ring's top-left corner; the office stored it
// unchecked and the 18:00Z crossing refused the town (postmark#3363).
//
// The bottle carries the world's REAL `tools/geometry.mjs` (copied from the
// WORLD_CLONE beside this office), so the door's ring rule is the lint's own
// `ringMatchesClaim`, not a stand-in.
//
// Legs:
//   1. THE INSTANCE: kinofire's payload (journal 225 seq 12129), replayed as an
//      amend, is written at {-1700,-500}, 1200×1000, ring unchanged; the answer
//      says so in one `outline` line; the composition passes the lint's rule.
//   2. A RING-LESS write is written exactly as sent, with no `outline`.
//   3. A ring with no at/extent at all is a whole sited mark.
//   4. A SET-DOWN (Wright's ruling (a), 10-02): a ringed region set down 50 m
//      east files a canon amend whose ring is the same shape moved 50 m, whose
//      `at` is the new centre, and which passes the lint's rule.
//   5. What the door still refuses, in the lint's own words: a ring that is not
//      a ring, and a parcel ring that does not fill the town's dial.
//
// THE FLIP: take the derivation out of src/world.mjs → leg 1 goes red (the door
// answers the lint's ring = bbox sentence, or writes the corner), leg 4 red.
//
//   WORLD_CLONE=<tree>/world-clone node --test test/ring-derives-box.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import { KINOFIRE_12129 } from "./helpers/kinofire-12129.mjs";

const SOURCE_WORLD = process.env.WORLD_CLONE;
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };

const repo = mkdtempSync(join(tmpdir(), "postmark-322-repo-"));
const scratch = mkdtempSync(join(tmpdir(), "postmark-322-db-"));
after(() => { sweep(repo); sweep(scratch); });

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// ── canon in a bottle ────────────────────────────────────────────────────────
// The gloaming as it stood before kinofire's amend, and one ringed region of
// rei's to set down (box x 100..300, y 100..260 → at {200,180}, 200×160).
const GARDEN_RING = [[100, 100], [300, 120], [280, 260], [120, 240], [100, 100]];
const GARDEN = { id: "rei/the-walled-garden", by: "rei", kind: "sited", tier: "market", household: "rei",
  at: { x: 200, y: 180 }, extent: { w: 200, h: 160 }, points: GARDEN_RING, body: "a walled garden" };
const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 8000, h: 8000 }, body: "the world frame" },
  { id: "kinofire/the-gloaming", by: "kinofire", kind: "sited", tier: "market", household: "kinofire", at: { x: -1700, y: -500 }, extent: { w: 1200, h: 1000 }, body: "a dark forest" },
  GARDEN,
];
const record = (by, kind, body, x, y, w, h) =>
  `---\nkind: ${kind}\nby: ${by}\ndate: 2026-08-01\nat: { x: ${x}, y: ${y} }\nextent: { w: ${w}, h: ${h} }\n---\n\n${body}\n`;

copyFileSync(join(SOURCE_WORLD, "tools", "geometry.mjs"), (mkdirSync(join(repo, "tools"), { recursive: true }), join(repo, "tools", "geometry.mjs")));
put("tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function homeOf() { return { ...NOWHERE }; }
export function whereIs() { return { ...NOWHERE }; }
export function publicResidents() { return []; }
`);
put("tools/world-verbs.mjs", `
export function containmentChain() { return []; }
export function orient() { return { seen: [] }; }
export function investigate() { return null; }
`);
put("tools/marks-fold.mjs", `
export function loadMarks() { return []; }
export const PARCEL_EXTENT_M = 25;
export const PARCEL_CLAIM_CAP = 3;
export const PARCEL_CAP_LAW_DATE = "2026-07-30";
export function marksContain(outer, inner) {
  if (!outer?.at || !outer?.extent || !inner?.at) return false;
  return Math.abs(inner.at.x - outer.at.x) <= outer.extent.w / 2 && Math.abs(inner.at.y - outer.at.y) <= outer.extent.h / 2;
}
export const WORLD_ROOT_SLUG = "let-there-be-light";
export const worldRootOf = (marks) => marks.find((m) => m.slug === WORLD_ROOT_SLUG) ?? null;
export function placementParent() { return null; }
export function containmentParents(marks) { return { parent: new Map(marks.map((m) => [m.id, null])), rootId: null }; }
`);
put("seeding/manifest.json", JSON.stringify({ homes: [] }));
put("WORLD/households.json", JSON.stringify({ households: { kinofire: "gh:1", rei: "gh:2", parceller: "gh:3" } }));
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: PUBLISHED, parcels: [],
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));
put("WORLD/marks/let-there-be-light/mark.md", record("the-town", "sited", "the world frame", 0, 0, 8000, 8000));
put("WORLD/marks/kinofire/the-gloaming/mark.md", record("kinofire", "sited", "a dark forest", -1700, -500, 1200, 1000));
put("WORLD/marks/rei/the-walled-garden/mark.md", record("rei", "sited", "a walled garden", 200, 180, 200, 160));

git("init", "-q", "-b", "main");
git("config", "user.email", "test@postmark.town");
git("config", "user.name", "POS-322 falsifier");
git("add", "-A");
git("commit", "-qm", "canon: the gloaming before kinofire's amend, and one ringed garden");

process.env.WORLD_CLONE = repo;
process.env.WORLD_SINGLE_LOG = "1";
process.env.WORLD_DYNAMIC_DB = join(scratch, "dynamic.db");
process.env.W2_GUARDS = "";
process.env.W2_PEN = "";
process.env.TOWN_PUSH = "";

const { installActsPen, uninstallActsPen, RECORD_ON } = await import("./acts-pen-stub.mjs");
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
const pen = installActsPen();
after(() => { uninstallActsPen(); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

const geom = await import(pathToFileURL(join(repo, "tools", "geometry.mjs")));
const keyFor = (household, ...handles) => ({ household, handles: new Set(handles) });
const KINO = keyFor("commander-and-chief", "kinofire");
const REI = keyFor("reihouse", "rei");
const PARCELLER = keyFor("parcelhouse", "parceller");

async function leave(payload, key, opts) {
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  try { return { ok: true, ...(await leaveMarkViaOffice(repo, payload, key, opts)) }; }
  catch (e) { return { ok: false, code: e?.code, defect: e?.defect ?? e?.message, hint: e?.hint }; }
}

/** The declaration the door wrote for `id`, as the record holds it (the act's own payload). */
function written(id) {
  const acts = pen.rows().filter((r) => r.object === id || r.payload?.object === id);
  const last = acts.at(-1);
  if (!last) return null;
  const p = typeof last.payload === "string" ? JSON.parse(last.payload) : last.payload;
  return p?.payload ?? p;
}

// What the door was sent, less the fields it stamps itself.
const kinofireAmend = () => {
  const { date: _d, put_forward: _p, ...sent } = KINOFIRE_12129;
  return { ...sent, amend: true };
};

// ── LEG 1 · THE INSTANCE ─────────────────────────────────────────────────────
test("THE INSTANCE: kinofire's 10-02 amend, replayed, is written centred at {-1700,-500}, 1200×1000", async () => {
  const out = await leave(kinofireAmend(), KINO);
  console.log(`    RECEIPT · ${out.ok ? `OK id=${out.id} outline="${out.outline}"` : `${out.code} "${out.defect}"`}`);
  assert.equal(out.ok, true, `the amend goes forward, never refused: ${JSON.stringify(out)}`);
  const w = written("kinofire/the-gloaming");
  assert.ok(w, "the record holds the declaration");
  assert.deepEqual(w.at, { x: -1700, y: -500 }, "at is the ring's box centre");
  assert.deepEqual(w.extent, { w: 1200, h: 1000 }, "extent is the ring's box");
  assert.deepEqual(w.points, KINOFIRE_12129.points, "the ring is kept exactly as sent");
  assert.match(out.outline, /^at\/extent derived from your outline: at \{-1700,-500\}, extent 1200×1000 \(you sent at \{-2300,-1000\}, extent 1200×1000\)$/);
  const composed = { kind: "sited", at: w.at, extent: w.extent, points: w.points };
  assert.ok(geom.polygonOf(composed), "the lint's ring-shape check passes");
  assert.equal(geom.ringMatchesClaim(composed), true, "the lint's ring = bbox check passes: this composition settles green");
});

// ── LEG 2 · A RING-LESS WRITE ────────────────────────────────────────────────
test("A RING-LESS write is written exactly as sent, and says nothing about an outline", async () => {
  const sent = { slug: "a-lantern", kind: "sited", by: "kinofire", at: { x: -2300, y: -1000 }, extent: { w: 3, h: 2 }, body: "a lantern at the forest's corner" };
  const out = await leave(sent, KINO);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal("outline" in out, false);
  const w = written("kinofire/a-lantern");
  assert.equal(JSON.stringify(w.at), JSON.stringify(sent.at));
  assert.equal(JSON.stringify(w.extent), JSON.stringify(sent.extent));
  assert.equal("points" in w, false, "no ring key appears");
  console.log(`    RECEIPT · ring-less declaration ${JSON.stringify({ ...w, date: "<stamped>" })}`);
});

// ── LEG 3 · the outline alone ────────────────────────────────────────────────
test("A ring with no at/extent at all is a whole sited mark", async () => {
  const out = await leave({ slug: "a-clearing", kind: "sited", by: "kinofire", points: [[0, 0], [40, 0], [40, 30], [0, 30]], body: "a clearing" }, KINO);
  assert.equal(out.ok, true, JSON.stringify(out));
  const w = written("kinofire/a-clearing");
  assert.deepEqual([w.at, w.extent], [{ x: 20, y: 15 }, { w: 40, h: 30 }]);
  assert.equal(out.outline, "at/extent derived from your outline: at {20,15}, extent 40×30");
});

// ── LEG 4 · A SET-DOWN MOVES THE RING (Wright's ruling (a)) ──────────────────
test("A SET-DOWN of a ringed region 50 m east files the same ring moved 50 m, centred on the standpoint", async () => {
  const { fileAuthorsAmend } = await import("../src/world-hold.mjs");
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  const stood = { x: 250, y: 180 };
  const amend = await fileAuthorsAmend({
    thing: GARDEN.id, stood, key: REI, actor: "rei", actId: "act-322", writtenAt: "2026-10-03T00:00:00Z",
    deps: { mark: { ...GARDEN }, leave: (payload, k, opts) => leaveMarkViaOffice(repo, payload, k, opts) },
  });
  console.log(`    RECEIPT · set-down amend ${JSON.stringify(amend).slice(0, 300)}`);
  assert.equal(amend.filed, true, `the canon amend is filed: ${JSON.stringify(amend)}`);
  const w = written(GARDEN.id);
  assert.deepEqual(w.points, GARDEN_RING.map(([x, y]) => [x + 50, y]), "the same shape, moved 50 m east");
  assert.deepEqual(w.at, stood, "at is the new centre: where the dropper stood");
  assert.deepEqual(w.extent, GARDEN.extent, "the box keeps its size");
  assert.equal(geom.ringMatchesClaim({ kind: "sited", at: w.at, extent: w.extent, points: w.points }), true, "and it passes the lint's rule");
});

// ── LEG 5 · what the door still refuses, in the lint's words ─────────────────
test("A ring that is not a ring is refused with the lint's sentence", async () => {
  const out = await leave({ slug: "a-line", kind: "sited", by: "kinofire", points: [[0, 0], [10, 0]], body: "a line" }, KINO);
  assert.equal(out.ok, false);
  assert.equal(out.code, 422);
  assert.equal(out.defect, 'points: must be a ring of ≥3 vertices ([[x,y],…] or "x1,y1 x2,y2 …")');
});

test("A parcel ring that does not fill the town's 25×25 is refused with the lint's ring = bbox sentence", async () => {
  const out = await leave({ slug: "a-plot", kind: "parcel", by: "parceller", at: { x: 500, y: 500 }, points: [[480, 480], [520, 480], [520, 520]], body: "a plot" }, PARCELLER);
  assert.equal(out.ok, false, JSON.stringify(out));
  assert.equal(out.code, 422);
  assert.equal(out.defect, "the points: ring's bounding box must equal the mark's at/extent claim — the claim IS the ring's bbox (SCHEMA v2)");
});
