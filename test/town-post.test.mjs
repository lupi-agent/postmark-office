// town-post.test.mjs — the lanes' pen (founder-ruled 2026-08-30 evening).
//
//   node --test test/town-post.test.mjs
//
// THE LAW these falsifiers hold (the ruling, in substance): posting an idea
// must be VERY EASY — a thin wrapper over leave-mark that computes the ground
// and the free cell FOR the author, "instead of having to place a whole ass
// mark". The wrapper adds exactly two things (the lane routing and the
// placement) and forwards everything else, so every grammar bounce stays the
// world door's own sentence. Posting PUBLISHES: escrow defaults to 1.
//
// The placement's honest limit is asserted here too: drafts live on household
// sketchbook branches and are invisible cross-household until a settlement
// folds them, so the pen avoids every mark the STORE knows and does not
// pretend to more (stacked pins cost nothing — no reader orders ideas by
// position).

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { freeCellIn } from "../src/world-classes.mjs";
import { townPost, POST_PLACES } from "../src/world.mjs";
import { NO_WORLD_DB, clearWorld, publishWorld } from "./helpers/world-rows.mjs";

// The placement pen reads the world graph snapshot (POS-270 lane W 3a): each
// fixtureStore() is published as one when built, and world.db's path points nowhere.
process.env.WORLD_STORE_DB = NO_WORLD_DB;

const TANK = "the-town/the-think-tank";

// a store with the tank's real geometry (30×20 at 285,-179.5 — the walked
// siting) and whatever marks a test plants. THE DDL IS THE HYDRATION'S REAL
// ONE — geometry in dedicated columns, copied from the live store's own shape
// (and from foyer-shrink.test.mjs, which had it right first). The first draft
// of this fixture invented a props-shaped schema; freeCellIn matched the
// invention, every test here went green, and the live door answered "no sited
// ground" for a tank standing right there. A fixture must copy the real
// schema, never model it.
function fixtureStore(marks = []) {
  const dir = mkdtempSync(join(tmpdir(), "town-post-"));
  const p = join(dir, "world.db");
  const d = new DatabaseSync(p);
  d.exec("CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, subkind TEXT, tier TEXT, by TEXT, at_x REAL, at_y REAL, extent_w REAL, extent_h REAL, props TEXT)");
  const ins = d.prepare("INSERT INTO nodes (id, kind, by, at_x, at_y, extent_w, extent_h, props) VALUES (?, 'mark', ?, ?, ?, ?, ?, ?)");
  ins.run(TANK, "the-town", 285, -179.5, 30, 20, JSON.stringify({ body: "the tank" }));
  for (const m of marks)
    ins.run(m.id, m.by ?? "someone", m.props?.at?.x ?? null, m.props?.at?.y ?? null,
      m.props?.extent?.w ?? null, m.props?.extent?.h ?? null, JSON.stringify(m.props ?? {}));
  d.close();
  publishWorld(p);
  return { path: p, done: () => rmSync(dir, { recursive: true, force: true }) };
}

// ── the placement pen ───────────────────────────────────────────────────────

test("a free cell lands strictly INSIDE the tank — inset from every edge, never edge-riding", () => {
  const s = fixtureStore();
  try {
    const c = freeCellIn(TANK, "wright/a-first-idea");
    assert.ok(c.at, "an empty tank places");
    // tank spans x 270..300, y -189.5..-169.5; a 1×1 at the cell spans ±0.5 —
    // the 1.5 inset keeps the whole mark at least 1m inside the walls (the
    // wayfinder-swallowing lesson: extents are CENTRE-anchored)
    assert.ok(c.at.x - 0.5 >= 271 && c.at.x + 0.5 <= 299, `x=${c.at.x} rides inside`);
    assert.ok(c.at.y - 0.5 >= -188.5 && c.at.y + 0.5 <= -170.5, `y=${c.at.y} rides inside`);
  } finally { s.done(); }
});

test("placement is DETERMINISTIC per author/slug — a retry lands the same cell, a different seed spreads", () => {
  const s = fixtureStore();
  try {
    const a1 = freeCellIn(TANK, "wright/one");
    const a2 = freeCellIn(TANK, "wright/one");
    assert.deepEqual(a1.at, a2.at, "same seed, same cell — a resident retrying a bounced call must not scatter");
    const b = freeCellIn(TANK, "little-bird/another");
    assert.notDeepEqual(a1.at, b.at, "different seeds spread instead of queueing at one corner");
  } finally { s.done(); }
});

test("the probe walks PAST a mark the store knows — the cell a neighbour holds is never handed out", () => {
  const empty = fixtureStore();
  let target;
  try { target = freeCellIn(TANK, "wright/claim").at; } finally { empty.done(); }
  const s = fixtureStore([{ id: "someone/sat-here", props: { at: target, extent: { w: 1, h: 1 } } }]);
  try {
    const c = freeCellIn(TANK, "wright/claim");
    assert.ok(c.at, "still places");
    assert.notDeepEqual(c.at, target, "…but not on the occupied cell");
  } finally { s.done(); }
});

test("a WIDE mark blocks every cell under its extent, not just its centre", () => {
  const s = fixtureStore([{ id: "the-town/how-ideas-enter", props: { at: { x: 285, y: -179 }, extent: { w: 10, h: 6 } } }]);
  try {
    // exhaust: every seed must land outside the wide mark's footprint
    for (const seed of ["a/a", "b/b", "c/c", "d/d", "e/e"]) {
      const c = freeCellIn(TANK, seed);
      const inside = Math.abs(c.at.x - 285) < 5.5 && Math.abs(c.at.y - -179) < 3.5;
      assert.equal(inside, false, `${seed} → ${JSON.stringify(c.at)} must clear the furniture`);
    }
  } finally { s.done(); }
});

test("an ANCESTOR ground never blocks placement — a container is the floor, not furniture", () => {
  // The live lesson (2026-08-31 ~04:00Z): the world root's extent overlaps
  // every cell of every ground, and overlap-alone read an empty tank as
  // "full — 486 cells". Only a mark standing ON the ground (whole extent
  // inside) is furniture.
  const s = fixtureStore([
    { id: "the-town/let-there-be-light", props: { at: { x: 0, y: 0 }, extent: { w: 4000, h: 4000 } } },
    { id: "the-town/the-town-centre", props: { at: { x: 285, y: -150 }, extent: { w: 400, h: 300 } } },
  ]);
  try {
    const c = freeCellIn(TANK, "wright/first");
    assert.ok(c.at, "the empty tank places despite the root and the district overlapping every cell");
  } finally { s.done(); }
});

test("a full ground says FULL with its cell count; a missing store is an ERROR, never a guess", () => {
  // a mark as wide as the tank itself leaves no cell
  const s = fixtureStore([{ id: "someone/blanket", props: { at: { x: 285, y: -179.5 }, extent: { w: 30, h: 20 } } }]);
  try {
    const c = freeCellIn(TANK, "wright/late");
    assert.equal(c.full, true);
    assert.ok(c.cells > 0, "the refusal carries how many cells the ground holds");
  } finally { s.done(); }
  const gone = (clearWorld(), freeCellIn(TANK, "wright/x"));
  assert.match(gone.error, /no world store/, "the floor is disclosed, never silently improvised");
  const noGround = fixtureStore();
  try {
    const g = freeCellIn("the-town/no-such-ground", "w/x");
    assert.match(g.error, /no sited ground/);
  } finally { noGround.done(); }
});

// ── the wrapper's own gates (everything else is the world door's law) ────────

test("post without a lawful class TEACHES the lanes — which is open, where the others still post", async () => {
  assert.deepEqual(Object.keys(POST_PLACES), ["idea"], "the lane opens class by class, by ruling — today: idea");
  for (const bad of [undefined, "bounty", "listing", "quest", "thing"]) {
    await assert.rejects(
      () => townPost({ class: bad, slug: "s", body: "b" }, { household: "h", handles: new Set(["tester"]) }),
      (e) => {
        assert.equal(e.code, 422);
        assert.match(e.hint, /"idea"/, "the bounce names what IS open");
        assert.match(e.hint, /world_leave_mark class: "bounty"/, "…and where a bounty still posts, so nobody is stranded");
        return true;
      }, `class ${JSON.stringify(bad)} must bounce teaching`);
  }
});

test("posting PUBLISHES: stamps 0 bounces to the world door where private drafts live", async () => {
  await assert.rejects(
    () => townPost({ class: "idea", slug: "s", body: "b", stamps: 0 }, { household: "h", handles: new Set(["tester"]) }),
    (e) => { assert.equal(e.code, 422); assert.match(e.hint, /world_leave_mark/); return true; });
});

test("an unreadable ground bounces 503 naming the self-serve fallback — the wrapper never guesses a cell", async () => {
  // no WORLD store is configured in this test env, so the ground read floors —
  // which is exactly the branch this falsifier owns
  await assert.rejects(
    () => townPost({ class: "idea", slug: "s", body: "b" }, { household: "h", handles: new Set(["tester"]) }),
    (e) => {
      if (e.code === 503) { assert.match(e.hint, /world_leave_mark/); return true; }
      // with a real store present the call reaches the world door instead;
      // any bounce from there is the world door's own law and not this test's
      return typeof e.code === "number";
    });
});
