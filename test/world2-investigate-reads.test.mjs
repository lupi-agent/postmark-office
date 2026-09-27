// world2-investigate-reads.test.mjs — `/world2/investigate?mark=`, held to 1.0's
// OWN engine over the same world, and made unable to go green off the tree
// (POS-104).
//
// ── THE ORACLE IS THE SAME FUNCTION, WHICH IS THE POINT ─────────────────────
//
// `GET /world/investigate` is `verbs.investigate(mark, w, { depth })` where `w`
// is the world folded from `WORLD/world-state.json`. The twin is
// `verbs.investigate(mark, w, { depth })` where `w` is the world assembled from
// `marks` ROWS. One judgment, two sources — so an equality here is about the
// ROWS and never about the engine, and a divergence names the seam rather than
// a difference of opinion between two implementations.
//
// The fixture world below is the SAME world twice: a `world-state.json`-shaped
// object for the oracle, and the `marks` rows a store holds for the same marks.
// `apex-reads.mjs § worldStateFromMarkRows` is the mapping under test.
//
// ── WHY AN EQUALITY ALONE WOULD BE WORTHLESS ────────────────────────────────
//
// A twin that quietly folded `WORLD_CLONE` would answer exactly what 1.0
// answers, and every equality would pass with the port doing nothing. So the
// fixture store carries a mark — `ghost/only-in-the-store` — that stands in NO
// tree: it is in the rows and nowhere else. If the twin's answer cannot see it,
// the twin is not reading the store. The fixture pool also COUNTS what it was
// asked, so a door that opened no `marks` query fails on the count alone.
//
// ── THE FLIP, run 2026-09-17 against commit `976b3de` of this branch ─────────
//
// In `src/world2-serve.mjs`'s `/world2/investigate` arm, point the twin at the
// tree: replace
//
//     const { rows: markRows } = await p.query(apex.MARK_ROWS_SQL);
//     const worldState = apex.worldStateFromMarkRows(markRows);
//
// with the folded tree the 1.0 door reads —
//
//     const worldState = (await import("./world-branches.mjs"))
//       .publishedState(WORLD_CLONE).state;
//
// — and 5 of these 11 go red (the three equalities and the two store legs). The
// one that names the CAUSE rather than a symptom is:
//
//   not ok 5 - THE PLANTED MARK: a mark that stands only in the store is investigable
//     error: |-
//       the twin could not find a mark that exists only in the rows — it is reading a tree
//       404 !== 200
//
// Restore with `git checkout -- src/world2-serve.mjs`.
//
// NEEDS `WORLD_CLONE` — the ENGINE is the world repo's and this office holds no
// vendored copy (`world2-serve.mjs § engine`: "the one open seam of this door").
// Without a clone the door answers 503 by design and these cases say so rather
// than passing quietly.
//
// Run: WORLD_CLONE=<a world checkout> node --test test/world2-investigate-reads.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import * as apex from "../world2/tools/apex-reads.mjs";
// THE FIXTURE RESOLVES THE CLONE THE WAY THE DOOR DOES, or its guards watch a
// different office than the one under test. `world2-serve.mjs § engine` reads
// this constant, NOT `process.env.WORLD_CLONE`, and the constant falls back to
// `<office>/world-clone` (`src/world-store.mjs:305`). So `env -u WORLD_CLONE`
// in a pool tree does not make the office engine-less — it only blinds a
// fixture that reads the raw variable, which is how this file came to have a
// skip guard that opened in a configuration where the door still had an engine.
import { WORLD_CLONE } from "../src/world-store.mjs";

const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://investigate-reads-test/none";
});
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

const { world2Serve } = await import("../src/world2-serve.mjs");

// ── the fixture world, as `marks` rows ──────────────────────────────────────
//
// `markRecordOf` reads `geometry` for at/extent, `data` for tier/class and the
// parent id, `owner` for both `by` and the fold's `household`, and the
// `household` column for `_cred`. The rows below are shaped exactly as `pg`
// hands them over: jsonb as objects, text as strings.
const row = ({ slug, kind = "sited", owner, household = "gh:1", body = "", at = null, extent = null, data = {} }) => ({
  slug, kind, owner, household, body,
  geometry: at ? { at, ...(extent ? { extent } : {}) } : null,
  data, status: "standing", parent: null,
});

// The world root: every containment chain ends here.
const ROOT = row({ slug: "the-town/let-there-be-light", owner: "the-town", household: "solo:the-town",
  body: "the world's own ground", at: { x: 0, y: 0 }, extent: { w: 320000, h: 320000 },
  data: { tier: "constitution" } });
const HOUSE = row({ slug: "wright/the-trueing-house", owner: "wright", household: "gh:67605380",
  body: "a house that stands in the record", at: { x: 100, y: 100 }, extent: { w: 12, h: 12 },
  data: { tier: "market" } });
// ⚑ THE PLANTED MARK. In the rows, in no tree, in no clone, in no fold. Its only
// existence is the fixture store's.
const GHOST = row({ slug: "ghost/only-in-the-store", owner: "ghost", household: "solo:ghost",
  body: "a mark that stands in the store and nowhere else", at: { x: 104, y: 104 }, extent: { w: 2, h: 2 },
  data: { tier: "market" } });

const ROWS = [ROOT, HOUSE, GHOST];

// ── the fixture LAW ─────────────────────────────────────────────────────────
//
// ⚑ THE TERRAIN IS NOT OPTIONAL. `assembleWorld` builds the heightfield before
// any verb runs and dereferences `skeleton.features`, `skeleton.light` and
// `skeleton.elevation.fog_ceiling_m` unguarded — so a null skeleton is a
// TypeError inside the engine, not a thinner world. This test found that in the
// door's first cut; the door now pins the law and refuses without one.
//
// The rows are the TOWN'S OWN skeleton, split by top-level key exactly as
// `law-ingest` stores it and `skeletonFromLawRows` reassembles it. Inventing a
// terrain here would make both sides agree about a world that does not exist.
const LAW_SHA = "a23a8d174776db4d325631a3b9ecf9380cecb722";
let SKELETON_ROWS = null;
// THE REFUSAL TEST'S SKELETON CANNOT COME FROM THE CLONE, BECAUSE THE ABSENT
// CLONE IS WHAT IT IS TESTING. The door asks for a non-null terrain (`:722`)
// BEFORE it reaches the engine (`:727`), so a fixture whose skeleton is also
// keyed on WORLD_CLONE makes the engine arm unreachable in the one
// configuration where this test runs — it refuses `carries no skeleton` and the
// arm it names is never touched. The fallback is used ONLY when the clone is
// absent, and the only test that runs then is this refusal, which has no oracle
// to disagree with: it needs a terrain that EXISTS, never a terrain that is
// right. Every equality test skips without the engine, so the town's own
// skeleton remains the only one any comparison ever sees.
//
// ITS LIMIT, SAID OUT LOUD: this fallback is reached only on a run with NO
// world clone resolvable at all — not merely `env -u WORLD_CLONE`, which still
// finds `<office>/world-clone`. Every pool tree and the box carry that clone, so
// this guard is exercised in CI-without-a-clone and nowhere else; everywhere
// else the test skips because the door really does have an engine. That is the
// same silent-skip class POS-131 handed up, and it is named here rather than
// discovered later. One row is enough because `skeletonFromLawRows` returns
// null only for an EMPTY list (`test/world2-apex-reads.test.mjs:250` pins
// exactly that), and where this fallback is reached the door refuses at
// `engine()` before `assembleWorld` ever dereferences the terrain — so a
// minimal skeleton is never asked to be a real one. It would be asked, and
// would throw on `elevation.fog_ceiling_m`, if it ever met a LIVE engine; the
// guard above keeps the fixture and the door reading one clone so it cannot.
const FALLBACK_SKELETON = [
  { kind: "skeleton", key: "light", path: "WORLD/skeleton.json", data: { from: "NE" } },
];
before(async () => {
  try {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const doc = JSON.parse(readFileSync(join(WORLD_CLONE, "WORLD", "skeleton.json"), "utf8"));
    SKELETON_ROWS = Object.entries(doc).map(([key, data]) => ({ kind: "skeleton", key, path: "WORLD/skeleton.json", data }));
  } catch { SKELETON_ROWS = FALLBACK_SKELETON; }
});

function fixturePool({ rows = ROWS, law = undefined } = {}) {
  const asked = [];
  return {
    asked,
    query: async (sql, params) => {
      asked.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      if (/FROM windows/i.test(sql)) return { rows: /status = 'open'/.test(sql) ? [] : [{ id: 194, law_sha: LAW_SHA }] };
      if (/FROM projection_heads/i.test(sql)) return { rows: [{ sha: LAW_SHA }] };
      if (/FROM law_projection/i.test(sql)) return { rows: law === undefined ? (SKELETON_ROWS ?? []) : law };
      if (/FROM marks/i.test(sql)) return { rows };
      return { rows: [] };
    },
  };
}

const investigate = (qs, pool) => world2Serve("/world2/investigate", new URLSearchParams(qs), { p: pool });

// ── the oracle: 1.0's engine over the SAME world ────────────────────────────
//
// Loaded the way the door loads it, so a clone whose tools cannot be read makes
// the oracle unavailable rather than making it silently different. `_engine`
// inside the door caches; this is a separate handle on the same modules.
let ENGINE = null;
let ENGINE_WHY = null;
before(async () => {
  try {
    const branches = await import("../src/world-branches.mjs");
    const { pathToFileURL } = await import("node:url");
    const { join } = await import("node:path");
    const clone = WORLD_CLONE;
    if (!clone) throw new Error("WORLD_CLONE is unset");
    const dir = branches.materializeAtRef(clone, branches.freshestMainRef(clone), "tools");
    const at = (f) => import(pathToFileURL(join(dir, "tools", f)).href);
    const [verbs, build] = await Promise.all([at("world-verbs.mjs"), at("world-build.mjs")]);
    ENGINE = { verbs, build };
  } catch (e) { ENGINE_WHY = String(e?.message ?? e); }
});

/** 1.0's answer for one mark, over the fixture world assembled the fold's way. */
const oracle = (mark, { depth = 1, rows = ROWS } = {}) => {
  const worldState = apex.worldStateFromMarkRows(rows);
  const world = ENGINE.build.assembleWorld({ worldState, skeleton: apex.skeletonFromLawRows(SKELETON_ROWS ?? []) });
  return ENGINE.verbs.investigate(String(mark), world, { depth });
};

// ═════════════════════════════════════════════════════════════════════════════
// THE ENGINE IS EITHER HERE OR THE DOOR SAYS SO
// ═════════════════════════════════════════════════════════════════════════════

test("with no engine the door REFUSES 503 rather than composing a judgment of its own", async (t) => {
  if (ENGINE) return t.skip("an engine is available — the refusal path is exercised where it is not");
  const { code, body } = await investigate("mark=wright/the-trueing-house", fixturePool());
  assert.equal(code, 503);
  assert.match(body.defect, /engine cannot be read/);
});

// ═════════════════════════════════════════════════════════════════════════════
// 1 · THE EQUALITY — same engine, one world, two sources
// ═════════════════════════════════════════════════════════════════════════════

test("the twin's answer is field-for-field 1.0's own, minus the named tree-only block", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const { code, body } = await investigate("mark=wright/the-trueing-house", fixturePool());
  assert.equal(code, 200);
  const { tree_only, ...mine } = body;
  assert.deepEqual(mine, oracle("wright/the-trueing-house"));
  assert.ok(tree_only["receipt.crossing · receipt.settlement_sha · receipt.published_at"],
    "an absent field that says nothing is an absent field nobody can act on");
  assert.ok(tree_only.stands);
});

test("`depth` reaches the engine — the door does not silently answer depth 1 to every ask", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  // The 1.0 route lost a lane to exactly this class on its portfolio twin: a
  // parameter the handler dropped, so every request answered page zero. The
  // check is that the door's answer TRACKS the oracle at the depth asked, not
  // that the two depths differ (a fixture where they happen not to would make
  // that assertion silent).
  const three = await investigate("mark=wright/the-trueing-house&depth=3", fixturePool());
  const { tree_only: _t, ...mine } = three.body;
  assert.deepEqual(mine, oracle("wright/the-trueing-house", { depth: 3 }));
});

test("a bad depth falls to 1 rather than poisoning the engine with NaN", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const { body } = await investigate("mark=wright/the-trueing-house&depth=banana", fixturePool());
  const { tree_only: _t, ...mine } = body;
  assert.deepEqual(mine, oracle("wright/the-trueing-house", { depth: 1 }));
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · THE DOOR READ THE STORE — the leg an equality cannot supply
// ═════════════════════════════════════════════════════════════════════════════

test("THE PLANTED MARK: a mark that stands only in the store is investigable", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const { code, body } = await investigate("mark=ghost/only-in-the-store", fixturePool());
  assert.equal(code, 200, "the twin could not find a mark that exists only in the rows — it is reading a tree");
  assert.equal(body.id, "ghost/only-in-the-store");
  assert.equal(body.body, "a mark that stands in the store and nowhere else");
});

test("THE QUERY COUNT: the door opened `marks` — a tree-reading door opens none", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const p = fixturePool();
  await investigate("mark=wright/the-trueing-house", p);
  const markAsks = p.asked.filter((a) => /FROM marks/i.test(a.sql));
  assert.equal(markAsks.length, 1);
  assert.equal(markAsks[0].sql, apex.MARK_ROWS_SQL.replace(/\s+/g, " ").trim());
});

test("withdrawing the planted mark from the store withdraws it from the answer", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const p = fixturePool({ rows: ROWS.filter((r) => r.slug !== "ghost/only-in-the-store") });
  const { code } = await investigate("mark=ghost/only-in-the-store", p);
  assert.equal(code, 404, "the store decides what exists; a door answering about a row it no longer holds is reading elsewhere");
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · THE REFUSALS
// ═════════════════════════════════════════════════════════════════════════════

test("no mark bounces 422", async () => {
  const { code, body } = await investigate("", fixturePool());
  assert.equal(code, 422);
  assert.equal(body.defect, "which mark?");
});

test("A SKELETON-LESS LAW REFUSES 503 — the terrain is assembled before any mark is judged", async () => {
  // This is the branch the door's first cut did not have, and the reason it
  // needed one is measured rather than argued: `assembleWorld` dereferences
  // `skeleton.features` unguarded, so a law with no skeleton is a TypeError
  // inside the engine. A 500 from a stack trace and a 503 that names the cause
  // are the same outage to an operator and different work to a reader.
  const { code, body } = await investigate("mark=wright/the-trueing-house", fixturePool({ law: [] }));
  assert.equal(code, 503);
  assert.match(body.defect, /carries no skeleton/);
});

test("the door pins ONE law and never `max(law_sha)` — the pin is asked for by sha", async () => {
  const p = fixturePool();
  await investigate("mark=wright/the-trueing-house", p);
  const lawAsks = p.asked.filter((a) => /FROM law_projection/i.test(a.sql));
  assert.equal(lawAsks.length, 1);
  assert.equal(lawAsks[0].params[0], LAW_SHA,
    "a law read that did not name its sha would compare two different laws and call the difference a divergence");
});

test("a missing mark is 404 and CARRIES THE ENGINE'S OWN SENTENCE", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  // ⚑ THE MISS IS `r.error`, NOT `!r`. The engine answers a missing mark with a
  // TRUTHY object, so a `!r` test never fires — 1.0 shipped that dead branch for
  // months and a lane was spent finding it. This case is the guard that the
  // port did not inherit the bug along with the shape, and the engine's own
  // sentence is kept because it distinguishes a mark from a TERRAIN feature,
  // which the office's wording does not.
  const { code, body } = await investigate("mark=nobody/never-was", fixturePool());
  assert.equal(code, 404);
  assert.equal(body.defect, 'no mark "nobody/never-was"');
  assert.ok(body.engine, "the engine's sentence was swallowed — the office's bounce cannot say 'terrain'");
});
