// REFS FROM GIT'S OWN FILES, CONTENT BY COMMIT (the Snug night, 2026-09-27).
// readAtRef caches content by (sha, path) and resolves named refs from git's
// files. The one way that could go wrong is serving a file from before the ref
// moved; these tests move the ref and ask again in the same breath.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readAtRef, readJsonAtRef, refExists, refShaFromDisk } from "../src/world-branches.mjs";

function repoWith() {
  const dir = mkdtempSync(join(tmpdir(), "refmemo-"));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t"); g("config", "user.name", "t");
  const commit = (body) => { writeFileSync(join(dir, "state.json"), JSON.stringify(body)); g("add", "."); g("commit", "-q", "-m", "c"); return g("rev-parse", "HEAD"); };
  return { dir, g, commit };
}

test("a moved branch is read fresh, never from the cache (loose ref)", () => {
  const { dir, commit } = repoWith();
  try {
    const a = commit({ v: 1 });
    assert.equal(refShaFromDisk(dir, "refs/heads/main"), a);
    assert.deepEqual(readJsonAtRef(dir, "refs/heads/main", "state.json"), { v: 1 });
    assert.deepEqual(readJsonAtRef(dir, "refs/heads/main", "state.json"), { v: 1 }, "the cached read agrees");
    commit({ v: 2 });
    assert.deepEqual(readJsonAtRef(dir, "refs/heads/main", "state.json"), { v: 2 }, "after the ref moved, the new content");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("packed refs resolve, and a move after packing is read fresh", () => {
  const { dir, g, commit } = repoWith();
  try {
    const a = commit({ v: 1 });
    g("pack-refs", "--all");
    assert.equal(refShaFromDisk(dir, "refs/heads/main"), a, "resolved from packed-refs");
    assert.equal(readAtRef(dir, "refs/heads/main", "state.json"), JSON.stringify({ v: 1 }));
    commit({ v: 3 });
    assert.equal(readAtRef(dir, "refs/heads/main", "state.json"), JSON.stringify({ v: 3 }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("refExists: a missing ref is false, a branch is true, a sha resolves", () => {
  const { dir, commit } = repoWith();
  try {
    const a = commit({ v: 1 });
    assert.equal(refExists(dir, "refs/heads/nope"), false);
    assert.equal(refExists(dir, "refs/remotes/origin/main"), false);
    assert.equal(refExists(dir, "refs/heads/main"), true);
    assert.equal(readAtRef(dir, a, "state.json"), JSON.stringify({ v: 1 }), "a bare sha reads through");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
