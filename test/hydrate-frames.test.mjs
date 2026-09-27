// hydrate-frames.test.mjs — the office meets the relative tree (SCHEMA v3).
//
//   node --test test/hydrate-frames.test.mjs
//
// The world repo proved 318/318 marks compose to exactly the position the old
// tree stated. This is the office-side twin of that proof, and it exists because
// the office has a SECOND reader of mark geometry that does not go through
// `loadMarks`: the geometry-history walk reads blobs at old commits with
// `parseRecord`, which hands back a record exactly as it is spelled. On a
// relative tree that spelling is an offset from the parent's centre.
//
// The receipt, run against the held `stageD/coords` branch on 2026-08-10:
//
//   BEFORE  604 marks agree · geometry_versions 390 → 671 · 281 marks report
//           "open version disagrees with the tree at as_of"
//   AFTER   604 marks agree · 390 versions vs 390, every field · 0 problems
//
// The 281 is the whole finding: node positions were never at risk, because the
// world's own loader composes and the office imports it at a ref. Only the
// history was, and it failed LOUDLY — the store's own self-check caught it,
// which is the gate law paying for itself.
//
// The two hydration cases need the coords worktree and take about fifteen
// seconds; they skip by name where it is absent. The comparator's own falsifier
// does not, and runs everywhere.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { compareStores, diffMaps, hydrateInto, mergeBase, readMarkGeometry, readVersions } from "../tools/hydrate-equivalence.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";

// A relative-coords checkout is a dev artifact no live clone provides, so it
// is named by env var and by nothing else; the two skips below are the whole
// mechanism, and a path to a retired worktree on one PC added nothing to them.
const COORDS = process.env.STAGE_D_COORDS_WORKTREE ?? null;

// THE HYDRATOR INSISTS A WORLD CLONE IS ITS OWN GIT TOPLEVEL, and it is right to:
// `git -C <dir> rev-parse HEAD` happily answers from an ancestor repo, which
// would stamp an index with a sha that has nothing to do with what it indexed.
// A dev worktree commonly reaches its clone through a junction or symlink, and
// through one the toplevel resolves to the TARGET while the path does not — so
// the gate refuses a clone that is perfectly good. Resolving the link before
// handing the path over is the fix; skipping would have hidden the falsifier
// behind a filesystem detail.
const realDir = (p) => { try { return realpathSync(p); } catch { return p; } };

const declaresRelative = (dir) => {
  try {
    const root = join(dir, "WORLD", "marks", "let-there-be-light", "mark.md");
    return existsSync(root) && /^coords:\s*relative\s*$/m.test(readFileSync(root, "utf8"));
  } catch { return false; }
};

test("a relative tree and its absolute twin hydrate to the same world", { timeout: 120_000 }, async (t) => {
  if (!existsSync(join(WORLD_CLONE, "WORLD", "marks"))) return t.skip(`no world clone at ${WORLD_CLONE}`);
  if (!COORDS || !existsSync(join(COORDS, "WORLD", "marks"))) return t.skip(`no relative-coords checkout (set STAGE_D_COORDS_WORKTREE)`);
  if (!declaresRelative(COORDS)) return t.skip(`${COORDS} does not declare \`coords: relative\` on its root — nothing to compare`);

  // ONE WORLD, TWO FRAMES — so main is pinned to the instant the relative branch
  // last agreed with it. Comparing today's main against a branch cut weeks ago
  // subtracts the town's own history (ten commits of walks and settlements) and
  // calls the difference a frame bug, which is exactly what happened the first
  // time main advanced under this test.
  const base = mergeBase(realDir(WORLD_CLONE), "main", "stageD/coords");
  if (!base) return t.skip("no merge-base between main and stageD/coords — cannot compare one world");

  const tmp = mkdtempSync(join(tmpdir(), "frames-"));
  try {
    const a = hydrateInto(realDir(WORLD_CLONE), join(tmp, "absolute.db"), { ref: base });
    const b = hydrateInto(realDir(COORDS), join(tmp, "relative.db"));
    const r = compareStores(a, b);

    assert.equal(r.mark_differences.length, 0,
      `every mark's world position must survive the frame change: ${JSON.stringify(r.mark_differences.slice(0, 5))}`);
    assert.ok(r.marks.positioned > 300, `the comparison must actually cover the tree, got ${r.marks.positioned} positioned marks`);

    // The half that was broken, and the reason this test exists.
    assert.equal(r.version_differences.length, 0,
      `geometry versions must be world positions in both trees: ${JSON.stringify(r.version_differences.slice(0, 5))}`);
    assert.equal(r.versions.a, r.versions.b,
      "an uncomposed history invents a 'moved' version for every nested mark at the migration commit");
    assert.equal(r.geometry_history_problems.b, 0,
      "the store's own self-check — does the open version agree with the tree at as_of — must pass on the relative tree");
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test("RED CONTROL: the comparator catches a bent row — the check can fail", () => {
  const A = new Map([["a/one", { at_x: 10, at_y: 20, extent_w: 1, extent_h: 1 }]]);
  const B = new Map([["a/one", { at_x: 10.5, at_y: 20, extent_w: 1, extent_h: 1 }]]);
  const d = diffMaps(A, B, ["at_x", "at_y", "extent_w", "extent_h"], "mark");
  assert.equal(d.length, 1);
  assert.deepEqual(d[0], { mark: "a/one", field: "at_x", a: 10, b: 10.5 });

  // A half-metre is the smallest lie worth catching, and it does. So is absence.
  assert.equal(diffMaps(A, new Map(), ["at_x"], "mark").length, 1);
  assert.equal(diffMaps(new Map(), B, ["at_x"], "mark").length, 1);
  assert.equal(diffMaps(A, A, ["at_x", "at_y"], "mark").length, 0);
});

test("the store readers name what they read, so a comparison cannot silently cover nothing", { timeout: 60_000 }, async (t) => {
  const db = process.env.WORLD_STORE_DB ?? join(import.meta.dirname, "..", "world.db");
  if (!existsSync(db)) return t.skip(`no hydrated store at ${db}`);
  const { DatabaseSync } = await import("node:sqlite");
  const h = new DatabaseSync(db, { readOnly: true });
  try {
    assert.ok(readMarkGeometry(h).size > 0, "a store with no marks would make every equivalence check vacuously true");
    assert.ok(readVersions(h).size > 0, "and so would one with no geometry versions");
  } finally { h.close(); }
});
