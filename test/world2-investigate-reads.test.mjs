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

// The receipt's three store sources (POS-142 S3 item 4): `settlements`, the
// docket's rows for a slug, and the world-marks head. Defaults are a store
// whose newest settlement S79 closed window 208 and whose docket is empty.
const SETTLEMENTS = [
  { number: 79, tag_sha: "3493e940402acbd9abf90ce0ac04c379ab4ec873", published_at: new Date("2026-09-24T06:00:27Z"), window_id: 208, blessed_at: null },
  { number: 78, tag_sha: "7c616d9c14c20e4dfd45411fc46a2546a1847f46", published_at: new Date("2026-09-23T18:00:37Z"), window_id: 207, blessed_at: null },
];
function fixturePool({ rows = ROWS, law = undefined, claims = [], settlements = SETTLEMENTS, marksHead = null, claimsThrow = false } = {}) {
  const asked = [];
  return {
    asked,
    query: async (sql, params) => {
      asked.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      if (/FROM settlements/i.test(sql)) {
        if (settlements == null) throw new Error("the settlements table will not answer");
        return { rows: settlements };
      }
      if (/FROM claims WHERE slug/i.test(sql)) {
        if (claimsThrow) throw new Error("the docket is down");
        return { rows: claims.filter((c) => c.slug === params[0]) };
      }
      if (/projection_heads WHERE repo = 'world-marks'/i.test(sql)) return { rows: marksHead ? [{ sha: marksHead }] : [] };
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
  const { tree_only, receipt: _r, ...mine } = body;
  assert.deepEqual(mine, oracle("wright/the-trueing-house"));
  assert.ok(tree_only["receipt.crossing · receipt.settlement_sha · receipt.says"],
    "an absent field that says nothing is an absent field nobody can act on");
  assert.ok(!("stands" in tree_only), "stands is wired (POS-142 S3 item 5) and no longer declared tree-only");
});

// ── WHERE THE THING STANDS: 1.0's own block on the twin (POS-142 S3 item 5) ──
//
// `world.mjs § thingStandsBlock` already reads the store for both halves, so
// the twin calls it with the world it assembled from rows and the engine's
// answer. The oracle is the SAME function over the SAME world assembled the
// fold's way: a divergence is about what the twin handed it, never a second
// composition. A holding act is planted through `useGuardReader`
// (stands-store-fixture.mjs), so the block is read off `acts` with no Postgres.

test("A HELD THING: the twin carries `stands`, and it is 1.0's own block over the same world", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const { holdingAct, withActs } = await import("./stands-store-fixture.mjs");
  const { thingStandsBlock } = await import("../src/world.mjs");
  const id = "wright/the-trueing-house";
  const HELD = [holdingAct({ id: 101, at: "2026-09-07T21:53:00Z", actor: "wright", action: "take", thing: id, holder: "wright" })];
  let body, expected, reads = 0;
  await withActs(HELD, async (c) => {
    ({ body } = await investigate(`mark=${id}`, fixturePool()));
    reads = c.reads;
    const world = ENGINE.build.assembleWorld({ worldState: apex.worldStateFromMarkRows(ROWS), skeleton: apex.skeletonFromLawRows(SKELETON_ROWS ?? []) });
    expected = await thingStandsBlock(id, world, oracle(id));
  });
  assert.ok(body.stands, "a holding edge stands in `acts` and the twin carried no block");
  assert.equal(body.stands.source, "holder");
  assert.equal(body.stands.holder, "wright");
  assert.deepEqual(body.stands, expected);
  assert.ok(reads >= 1, "the block was read off the guard reader, i.e. the store");
});

// The world the twin hands over is load-bearing here and nowhere in the held
// case: a set-down anchored on a mark stands at that mark's CENTRE plus the
// offset, and the centre is read off the world the block is given. A twin that
// handed it no world (or a different one) would answer a different `where`.
test("A THING SET DOWN ON A MARK: `where` is the anchor's centre in the twin's own world, as on 1.0", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const { holdingAct, withActs } = await import("./stands-store-fixture.mjs");
  const { thingStandsBlock } = await import("../src/world.mjs");
  const id = "wright/the-trueing-house";
  const SET_DOWN = [
    holdingAct({ id: 201, at: "2026-09-07T21:53:00Z", actor: "wright", action: "take", thing: id, holder: "wright" }),
    holdingAct({ id: 202, at: "2026-09-07T22:10:00Z", actor: "wright", action: "drop", thing: id, holder: null,
      anchor: HOUSE.slug, dx: 5, dy: 7 }),
  ];
  let body, expected;
  await withActs(SET_DOWN, async () => {
    ({ body } = await investigate(`mark=${id}`, fixturePool()));
    const world = ENGINE.build.assembleWorld({ worldState: apex.worldStateFromMarkRows(ROWS), skeleton: apex.skeletonFromLawRows(SKELETON_ROWS ?? []) });
    expected = await thingStandsBlock(id, world, oracle(id));
  });
  assert.ok(body.stands, "a set-down stands in `acts` and the twin carried no block");
  assert.equal(body.stands.source, "set-down");
  assert.deepEqual(body.stands.where, { x: 105, y: 107 }, "the anchor is the house, centred at (100, 100)");
  assert.deepEqual(body.stands, expected);
});

// ── THE RECEIPT FROM ROWS (POS-142 S3 item 4, option A) ──────────────────────
//
// The twin hands 1.0's own `receiptFrom` the store's records. These cases pin
// what it hands over: the docket's rows, whether the mark is CARRIED (standing
// AND not locked beyond the newest settled window), the newest settlement, and
// the head that names `read_at`. The derivation is 1.0's, so the oracle is
// `receiptFrom` over the same records.

const claimRow = ({ slug, status, window_id, refusal_check = null }) => ({
  id: `c-${slug}-${window_id}`, slug, class: "sited", claimant: slug.split("/")[0], household: "gh:1",
  status, window_id, submitted_at: new Date("2026-09-24T01:00:00Z"), decided_at: new Date("2026-09-24T06:00:00Z"),
  refusal_check, stake: 1, supersedes: null,
});

test("RECEIPT · a carried mark: published, the docket read, and the three unrecorded fields declared, never derived", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const { receiptFrom } = await import("../src/mark-receipt.mjs");
  const id = "wright/the-trueing-house";
  const claims = [claimRow({ slug: id, status: "locked", window_id: 200 })];
  const { code, body } = await investigate(`mark=${id}`, fixturePool({ claims }));
  assert.equal(code, 200);
  assert.equal(body.receipt.status, "published", "locked at 200, and S79 closed 208: carried");
  assert.equal(body.receipt.crossing, null, "which settlement carried it is not in the store, so it is not answered");
  assert.equal(body.receipt.settlement_sha, null);
  assert.match(body.receipt.says, /not recorded in the store/);
  const oneOf = receiptFrom({ id, canon: { id }, claims, settlement: null, site_pin: null });
  for (const k of ["id", "window", "site_pin", "cause", "cause_row", "clock", "sources", "status"])
    assert.deepEqual(body.receipt[k], oneOf[k], `receipt.${k} is receiptFrom's own`);
  assert.match(body.tree_only["receipt.crossing · receipt.settlement_sha · receipt.says"], /3 agree \/ 5 differ \/ 14 underivable/);
  assert.ok(body.tree_only["receipt.disclosed · receipt.qualified"]);
});

test("RECEIPT · locked beyond the newest settled window: LOCKED, not published, with the newest settlement's number", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const id = "wright/the-trueing-house";
  const { body } = await investigate(`mark=${id}`, fixturePool({ claims: [claimRow({ slug: id, status: "locked", window_id: 210 })] }));
  assert.equal(body.receipt.status, "locked", "the clearing materialized it into marks, and no settlement has carried window 210");
  assert.deepEqual(body.receipt.sources, ["claims"], "canon is not claimed for a mark no settlement carried — 1.0's own sources for a locked mark");
  assert.equal(body.receipt.crossing.n, 79);
  assert.equal(body.receipt.window, 210);
  assert.ok(body.tree_only["receipt.crossing.sha · receipt.crossing.date · receipt.settlement_sha"],
    "git's short sha and committer zone are declared; the number is compared");
});

test("RECEIPT · settlements unreadable: a standing mark locked at its newest claim is UNDECIDABLE, never published (Wright's #305 review)", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const id = "wright/the-trueing-house";
  const claims = [claimRow({ slug: id, status: "locked", window_id: 200 })];
  const unreadable = (await investigate(`mark=${id}`, fixturePool({ claims, settlements: null }))).body;
  assert.notEqual(unreadable.receipt.status, "published", "carried is proven, never assumed");
  assert.deepEqual(unreadable.receipt.settlements, { readable: false, reason: "the settlements table could not be read" });
  assert.match(unreadable.receipt.says, /cannot be told/);
  // a table that names no closed window is the same absence of proof
  const windowless = (await investigate(`mark=${id}`, fixturePool({ claims, settlements: SETTLEMENTS.map((s) => ({ ...s, window_id: null })) }))).body;
  assert.notEqual(windowless.receipt.status, "published");
  assert.equal(windowless.receipt.settlements.readable, true);
  // and a mark with no locked claim needs no proof: it stands, it is published
  const seed = (await investigate(`mark=${id}`, fixturePool({ settlements: null }))).body;
  assert.equal(seed.receipt.status, "published");
  assert.ok(!("settlements" in seed.receipt));
});

test("RECEIPT · on the docket and not in the rows: answered with its tense, never bounced like a typo (1.0's own branch)", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const id = "wright/a-pending-shed";
  const { code, body } = await investigate(`mark=${id}`, fixturePool({ claims: [claimRow({ slug: id, status: "refused", window_id: 208, refusal_check: "harm: overlaps" })] }));
  assert.equal(code, 200);
  assert.equal(body.standing, false);
  assert.equal(body.receipt.status, "refused");
  assert.equal(body.note, body.receipt.says);
  assert.match(body.receipt.says, /refused at window 208/);
});

test("RECEIPT · never seen: 404 with the receipt that says so", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const { code, body } = await investigate("mark=nobody/never-was", fixturePool());
  assert.equal(code, 404);
  assert.equal(body.receipt.status, "never-was");
});

test("RECEIPT · read_at is named by the settlement whose tag the world-marks head IS, and absent when none is", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const id = "wright/the-trueing-house";
  const named = (await investigate(`mark=${id}`, fixturePool({ marksHead: SETTLEMENTS[0].tag_sha }))).body;
  assert.deepEqual(named.receipt.read_at, { ref: "refs/tags/settlement/S79", sha: SETTLEMENTS[0].tag_sha });
  const unnamed = (await investigate(`mark=${id}`, fixturePool({ marksHead: "f".repeat(40) }))).body;
  assert.ok(!("read_at" in unnamed.receipt), "a head no settlement names gets no guessed ref");
});

test("RECEIPT · an unreadable docket is DISCLOSED, never read as an empty one", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const { body } = await investigate("mark=wright/the-trueing-house", fixturePool({ claimsThrow: true }));
  assert.equal(body.receipt.docket?.readable, false);
  assert.ok(!body.receipt.sources.includes("claims"));
});

test("A THING NEVER HELD: no `stands` on the twin, absent rather than present-and-empty, as on 1.0", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const { withActs } = await import("./stands-store-fixture.mjs");
  let body;
  await withActs([], async () => { ({ body } = await investigate("mark=wright/the-trueing-house", fixturePool())); });
  assert.ok(!("stands" in body));
});

test("`depth` reaches the engine — the door does not silently answer depth 1 to every ask", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  // The 1.0 route lost a lane to exactly this class on its portfolio twin: a
  // parameter the handler dropped, so every request answered page zero. The
  // check is that the door's answer TRACKS the oracle at the depth asked, not
  // that the two depths differ (a fixture where they happen not to would make
  // that assertion silent).
  const three = await investigate("mark=wright/the-trueing-house&depth=3", fixturePool());
  const { tree_only: _t, receipt: _r, ...mine } = three.body;
  assert.deepEqual(mine, oracle("wright/the-trueing-house", { depth: 3 }));
});

test("a bad depth falls to 1 rather than poisoning the engine with NaN", async (t) => {
  if (!ENGINE) return t.skip(`no world engine: ${ENGINE_WHY}`);
  const { body } = await investigate("mark=wright/the-trueing-house&depth=banana", fixturePool());
  const { tree_only: _t, receipt: _r, ...mine } = body;
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
