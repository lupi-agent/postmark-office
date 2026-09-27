// forecast-sweep-parity.test.mjs — two filters, one rule, and they must not drift.
//
// The forecast bug of 2026-08-19/20 existed because ONE of these two paths
// filtered its stake rows and the other did not:
//
//   world  tools/settlement-sweep.mjs   stakes.filter((s) => markIds.has(s.mark))
//   office src/world-forecast.mjs       (nothing — every row went to the fold)
//
// They fold the same kind of thing for the same reason, so they must agree, and
// the sweep's line is the one the forecast borrowed. The honest fix would be ONE
// filter both import — but they live in DIFFERENT REPOS, and the office reaches
// the world's tools only through a runtime clone it does not build against, so a
// shared module is not available without inventing a package boundary tonight.
//
// So: twin lines, cross-referencing comments in both files, and this — a test
// that fails if either side loses its filter.
//
// It cannot fail a CI that has no world clone, and it says so rather than
// passing quietly: a green from a test that never ran is worse than no test.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { foldableStakeRows } from "../src/world-forecast.mjs";
import { worldClone } from "./fixture-paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OFFICE_SOURCE = readFileSync(join(HERE, "..", "src", "world-forecast.mjs"), "utf8");

// where a world clone might be; the office reads one at runtime from WORLD_CLONE
const WORLD = worldClone();
const sweepCandidate = WORLD && join(WORLD, "tools", "settlement-sweep.mjs");
const sweepPath = sweepCandidate && existsSync(sweepCandidate) ? sweepCandidate : null;

test("THE FORECAST SIDE still filters its rows before folding", () => {
  assert.equal(typeof foldableStakeRows, "function", "the rule is a named, testable thing");
  assert.match(OFFICE_SOURCE, /foldableStakeRows\(rows, published\)/,
    "and the fold call actually uses it — an exported-but-unused rule is not a fix");
  // the defect, in the shape it had: every row straight to the fold
  assert.doesNotMatch(OFFICE_SOURCE, /foldedStateAtRef\(worldClone, ref, \{ stakes: rows \}\)/,
    "the unfiltered fold call is the bug and must not come back");
});

test("THE FORECAST SIDE keeps the cross-reference to the sweep", () => {
  // a twin line without a pointer to its twin is how two copies drift apart
  assert.match(OFFICE_SOURCE, /settlement-sweep/,
    "the office's filter names the sweep it was borrowed from");
});

test("THE SWEEP SIDE still filters its rows before folding", { skip: sweepPath ? false : "no world clone reachable from here — the sweep half of this parity test did NOT run" }, () => {
  const sweep = readFileSync(sweepPath, "utf8");
  assert.match(sweep, /stakes\.filter\(\(stake\) => markIds\.has\(stake\.mark\)\)/,
    `the sweep at ${sweepPath} lost its filter — the forecast's twin is now alone, and a malformed row can refuse a settlement again`);
});

// ── the rule itself, so the parity above is parity about something ──────────
test("the shared rule keeps rows the tree holds and drops the rest", () => {
  const held = new Set(["a/one", "b/two"]);
  const rows = [
    { holder: "a", mark: "a/one", n: 1 },
    { holder: "c", mark: "c/in-transit", n: 3 },
    { holder: "b", mark: "b/two", n: 2 },
  ];
  assert.deepEqual(foldableStakeRows(rows, held).map((r) => r.mark), ["a/one", "b/two"]);
});

test("both sides answer the same way on the row that caused the bug", () => {
  // little-bird's self-stake on their own draft: absent from main, so main's fold
  // must never see it — which is what both filters exist to guarantee
  const row = { holder: "little-bird", mark: "little-bird/a-cold-cup-on-the-long-bench", n: 3 };
  assert.deepEqual(foldableStakeRows([row], new Set(["the-town/the-town-centre"])), [],
    "absent from the tree, so dropped");
  assert.deepEqual(foldableStakeRows([row], new Set([row.mark])), [row],
    "present in the tree — the owner's own branch — so kept, and it folds clean there");
});
