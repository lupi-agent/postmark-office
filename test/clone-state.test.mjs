// clone-state — a dirty clone barks, a clean one is quiet.
//
// 2026-09-28: the office tick's mint catch-up appended a signed line to the town
// clone's WHITE_PAGES/stamp-ledger.md, its stamp-verify refused, and the line
// stayed uncommitted. Every office write that pulls the clone refused with
// "cannot pull with rebase: You have unstaged changes" from 18:37Z to 23:3xZ,
// thirty times, and a resident said so before any instrument did.
//
// Every falsifier here reads a REAL git clone in a temp dir through the real
// reader (tools/clone-state.mjs), then judges it the two ways the box does:
// site-sentinel's town_clone probe and the roll-call's clone row.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync, utimesSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCloneState, judgeDirt, parsePorcelainZ, DIRTY_GRACE_MS, MINUTE } from "../tools/clone-state.mjs";
import { classifyClone } from "../tools/site-sentinel.mjs";
import { loadManifest, classifyDirtyClone, rollcall, ALARM_DIRTY_CLONE, OK } from "../tools/box-rollcall.mjs";

const LEDGER = "WHITE_PAGES/stamp-ledger.md";
const git = (cwd, ...args) =>
  execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", ...args], { encoding: "utf8" }).trim();

/** An origin and a clone of it, with the town's ledger and gitignore committed. */
function townPair() {
  const dir = mkdtempSync(join(tmpdir(), "clone-state-"));
  const origin = join(dir, "origin.git");
  const clone = join(dir, "town-clone");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, clone], { stdio: "ignore" });
  git(clone, "checkout", "-q", "-b", "main");
  execFileSync("git", ["-C", clone, "config", "core.autocrlf", "false"]);
  // The town's own ignore line for the office's session lock — the file the
  // office legitimately keeps beside the town's tree.
  writeFileSync(join(clone, ".gitignore"), ".office-session.lock\n");
  execFileSync("git", ["-C", clone, "config", "user.name", "t"]);
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, LEDGER), "MINT → wildcat · 5 · for: welcome:login:commander-and-chief\n");
  git(clone, "add", ".");
  git(clone, "commit", "-qm", "seed");
  git(clone, "push", "-q", "-u", "origin", "main");
  return { dir, origin, clone };
}

const NOW = Date.parse("2026-09-28T18:50:00Z");
const age = (file, ms) => { const t = new Date(NOW - ms); utimesSync(file, t, t); };

/** The incident's own shape: one signed line appended, never committed. */
function strandLine(clone, ageMs = 13 * MINUTE) {
  const f = join(clone, LEDGER);
  appendFileSync(f, "MINT → corey · 5 · for: welcome:gh:100140260\n");
  age(f, ageMs);
}

const ROW = loadManifest().clones.find((r) => r.id === "town-clone");
const sentinelOn = (state, seen = null, nowMs = NOW) =>
  classifyClone({ state, seen, nowMs, behindAfterMs: 25 * MINUTE, label: "the office's town clone" });
const rowOn = (state) => classifyDirtyClone({ ...ROW, path: state.path }, { clones: { [ROW.id]: state } }, NOW);

// ── the brief's four falsifiers ─────────────────────────────────────────────

test("FALSIFIER 1: a clone with a modified tracked file BARKS, and names the file and how long", () => {
  const { clone } = townPair();
  strandLine(clone);
  const state = readCloneState(clone, { remoteTip: git(clone, "rev-parse", "HEAD") });

  const s = sentinelOn(state);
  assert.equal(s.verdict, "DOWN");
  assert.match(s.reason, /WHITE_PAGES\/stamp-ledger\.md \(M\)/, "the bark must name the file");
  assert.match(s.reason, /13m ago/, "and say how long it has been dirty, from the file's mtime");
  assert.match(s.reason, /git pull --rebase/);
  assert.deepEqual(s.detail.files, [LEDGER]);

  const r = rowOn(state);
  assert.equal(r.verdict, ALARM_DIRTY_CLONE);
  assert.match(r.reason, /stamp-ledger\.md/);
});

test("FALSIFIER 2: a clean clone is quiet", () => {
  const { clone } = townPair();
  const state = readCloneState(clone, { remoteTip: git(clone, "rev-parse", "HEAD") });
  assert.equal(sentinelOn(state).verdict, "OK");
  assert.match(sentinelOn(state).reason, /clean and at the town's main/);
  assert.equal(rowOn(state).verdict, OK);
});

test("FALSIFIER 3: an untracked, gitignored file is quiet — and so is an untracked one the town does not ignore", () => {
  const { clone } = townPair();
  writeFileSync(join(clone, ".office-session.lock"), "pid 4009644\n");
  age(join(clone, ".office-session.lock"), 3 * 60 * MINUTE);
  writeFileSync(join(clone, "WHITE_PAGES", "stray-letter.md"), "an untracked file blocks no pull\n");
  age(join(clone, "WHITE_PAGES", "stray-letter.md"), 3 * 60 * MINUTE);
  const state = readCloneState(clone, { remoteTip: git(clone, "rev-parse", "HEAD") });
  assert.deepEqual(state.dirty, [], "untracked files are never read");
  assert.equal(sentinelOn(state).verdict, "OK");
  assert.equal(rowOn(state).verdict, OK);
});

test("FALSIFIER 4: the roll-call row goes ALARM on the dirty clone and OK on the clean one, through rollcall() itself", () => {
  const m = loadManifest();
  const { clone } = townPair();
  const judge = () => {
    const snap = { discovered: [], units: {}, services: {}, files: {}, custody: {}, clones: { [ROW.id]: readCloneState(clone) } };
    const res = rollcall({ ...m, units: [], custody: [], trees: undefined, clones: [{ ...ROW, path: clone }] }, snap, NOW);
    return res.rows.find((r) => r.unit === `clone:${ROW.id}`);
  };
  const clean = judge();
  assert.equal(clean.verdict, OK);
  assert.match(clean.reason, /level with origin\/main/);

  strandLine(clone);
  const dirty = judge();
  assert.equal(dirty.verdict, ALARM_DIRTY_CLONE);
  assert.match(dirty.reason, /stamp-ledger\.md/);
});

// ── the edges the four do not reach ─────────────────────────────────────────

test("a tracked change younger than the grace is a write in flight, not dirt", () => {
  const { clone } = townPair();
  strandLine(clone, 20 * 1000);
  const state = readCloneState(clone, { remoteTip: git(clone, "rev-parse", "HEAD") });
  const s = sentinelOn(state);
  assert.equal(s.verdict, "OK");
  assert.match(s.reason, /a write in flight/);
  assert.equal(rowOn(state).verdict, OK);
  // and one second past the grace it barks
  age(join(clone, LEDGER), DIRTY_GRACE_MS + 1000);
  assert.equal(sentinelOn(readCloneState(clone, { remoteTip: state.head })).verdict, "DOWN");
});

test("a STAGED change and a deleted tracked file are dirt too — the deletion's age is unknown and never excused", () => {
  const { clone } = townPair();
  strandLine(clone);
  git(clone, "add", LEDGER);
  assert.equal(sentinelOn(readCloneState(clone, { remoteTip: "x" })).verdict, "DOWN", "staged-but-uncommitted still refuses a pull");

  const { clone: c2 } = townPair();
  rmSync(join(c2, ".gitignore"));
  const s = sentinelOn(readCloneState(c2, { remoteTip: "x" }));
  assert.equal(s.verdict, "DOWN");
  assert.match(s.reason, /unknown time/);
});

test("reading the clone never writes its index — the watcher must not take the lock a write's `git add` needs", () => {
  const { clone } = townPair();
  // A stat-only change (same bytes, new mtime) is exactly what makes a plain
  // `git status` refresh and REWRITE .git/index.
  age(join(clone, LEDGER), 60 * MINUTE);
  const index = join(clone, ".git", "index");
  const before = { bytes: readFileSync(index), mtime: statSync(index).mtimeMs };
  const state = readCloneState(clone, { remoteTip: git(clone, "rev-parse", "HEAD") });
  assert.deepEqual(state.dirty, [], "same bytes is not a change");
  assert.equal(statSync(index).mtimeMs, before.mtime, "the reader rewrote .git/index");
  assert.deepEqual(readFileSync(index), before.bytes);
});

test("behind the town past the pull window is STALE, inside it is OK, and the clock is the divergence's", () => {
  const { origin, clone, dir } = townPair();
  const tip0 = git(clone, "rev-parse", "HEAD");
  // someone else lands a commit on the town
  const other = join(dir, "other");
  execFileSync("git", ["clone", "-q", origin, other], { stdio: "ignore" });
  writeFileSync(join(other, "WHITE_PAGES", "new.md"), "x\n");
  git(other, "add", ".");
  git(other, "commit", "-qm", "merge");
  git(other, "push", "-q", "origin", "HEAD:main");
  const tip1 = git(other, "rev-parse", "HEAD");

  const state = readCloneState(clone, { remoteTip: tip1 });
  assert.equal(state.against_remote, "behind", "the clone does not even hold the new tip");
  const first = sentinelOn(state, null, NOW);
  assert.equal(first.verdict, "OK", "a divergence first seen now cannot be stale yet");
  const later = sentinelOn(state, first.seen, NOW + 26 * MINUTE);
  assert.equal(later.verdict, "STALE");
  assert.match(later.reason, /behind the town's main for 26m/);
  assert.equal(state.head, tip0);
});

test("AHEAD — a local-only signed row the pen never landed — is named as that, both ways", () => {
  const { clone } = townPair();
  const tip = git(clone, "rev-parse", "HEAD");
  appendFileSync(join(clone, LEDGER), "STAKE …\n");
  git(clone, "commit", "-qam", "stake (push lost the race)");
  const state = readCloneState(clone, { remoteTip: tip });
  assert.equal(state.against_remote, "ahead");
  const first = sentinelOn(state, null, NOW);
  const later = sentinelOn(state, first.seen, NOW + 30 * MINUTE);
  assert.equal(later.verdict, "STALE");
  assert.match(later.reason, /never landed/);
  const r = rowOn(state);
  assert.equal(r.verdict, ALARM_DIRTY_CLONE);
  assert.match(r.reason, /1 commit\(s\) ahead of origin\/main/);
});

test("a clone that is not there, or that git cannot read, is never reported clean", () => {
  const missing = readCloneState(join(tmpdir(), "no-such-clone-" + Date.now()));
  assert.equal(missing.exists, false);
  assert.equal(sentinelOn(missing).verdict, "UNKNOWN");
  assert.equal(rowOn(missing).verdict, ALARM_DIRTY_CLONE);

  const notGit = mkdtempSync(join(tmpdir(), "not-a-clone-"));
  const unread = readCloneState(notGit, { git: () => { const e = new Error("x"); e.stderr = "fatal: detected dubious ownership in repository"; throw e; } });
  assert.equal(unread.readable, false);
  assert.match(sentinelOn(unread).reason, /dubious ownership/);
  assert.equal(rowOn(unread).verdict, ALARM_DIRTY_CLONE);
});

test("parsePorcelainZ keeps a rename's source out of the path list and survives spaces", () => {
  const out = "R  new name.md\0old name.md\0 M WHITE_PAGES/stamp-ledger.md\0";
  assert.deepEqual(parsePorcelainZ(out), [
    { xy: "R ", path: "new name.md", from: "old name.md" },
    { xy: " M", path: "WHITE_PAGES/stamp-ledger.md" },
  ]);
  assert.deepEqual(judgeDirt({ dirty: [] }, { nowMs: NOW }), { dirty: false });
});

test("the manifest refuses a clone row that cannot say what breaks", () => {
  const dir = mkdtempSync(join(tmpdir(), "rollcall-clone-"));
  const p = join(dir, "m.json");
  const m = JSON.parse(readFileSync(new URL("../deploy/box-rollcall-manifest.json", import.meta.url), "utf8"));
  writeFileSync(p, JSON.stringify({ ...m, clones: [{ id: "x", path: "/x", activation_owner: "W" }] }));
  assert.throws(() => loadManifest(p), /does not say what breaks when the clone is dirty/);
  writeFileSync(p, JSON.stringify({ ...m, clones: [{ id: "x", path: "/x", why: "w" }] }));
  assert.throws(() => loadManifest(p), /names no activation_owner/);
});
