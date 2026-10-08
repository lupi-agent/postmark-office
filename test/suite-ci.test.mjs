// suite-ci.test.mjs — the office suite's CI machinery (POS-417): the plan that
// deals files across shards, the reporter's events, and the verdict that reads
// test/known-failures.json. The workflow (.github/workflows/suite.yml) can only
// be run on GitHub; what it decides is decided here, in suite-lib.mjs, and
// these are the cases that decide it.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listTestFiles, planShards, readEvents, verdict } from "../.github/scripts/suite-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── the plan ────────────────────────────────────────────────────────────────

test("the plan deals every file exactly once, and the same plan on every call", () => {
  const files = listTestFiles(ROOT);
  const a = planShards(files, {}, 8);
  const b = planShards([...files].reverse(), {}, 8);
  assert.deepEqual(a, b, "the plan depends on the order the runner listed the files");
  const dealt = a.flatMap((s) => s.files).sort();
  assert.deepEqual(dealt, files);
  assert.ok(files.includes("test/suite-ci.test.mjs"), "the listing is test/*.test.mjs, this file among them");
});

test("the plan balances by measured seconds: longest first, each to the lightest shard", () => {
  const timings = { "test/a.test.mjs": 100, "test/b.test.mjs": 60, "test/c.test.mjs": 50, "test/d.test.mjs": 10 };
  const plan = planShards(Object.keys(timings), timings, 2);
  // a(100) → 1; b(60) → 2; c(50) → 2, the lighter at 60; d(10) → 1, the lighter at 100
  assert.deepEqual(plan.map((s) => s.files), [["test/a.test.mjs", "test/d.test.mjs"], ["test/b.test.mjs", "test/c.test.mjs"]]);
  assert.deepEqual(plan.map((s) => s.seconds), [110, 110]);
});

test("a file with no timing is dealt at the median, never left out", () => {
  const timings = { "test/a.test.mjs": 30, "test/b.test.mjs": 10, "test/c.test.mjs": 20 };
  const plan = planShards([...Object.keys(timings), "test/new.test.mjs"], timings, 2);
  const all = plan.flatMap((s) => s.files);
  assert.ok(all.includes("test/new.test.mjs"));
  assert.equal(plan.reduce((n, s) => n + s.seconds, 0), 30 + 10 + 20 + 20);
});

test("the plan refuses a shard count that is not a positive integer", () => {
  assert.throws(() => planShards(["test/a.test.mjs"], {}, 0), /positive integer/);
  assert.throws(() => planShards(["test/a.test.mjs"], {}, 2.5), /positive integer/);
});

// ── the reporter's events, read ─────────────────────────────────────────────

test("THE REPORTER, END TO END: a leaf red is a red, a parent failed by its subtest is not, and a skip keeps its reason", () => {
  const dir = mkdtempSync(join(tmpdir(), "suite-ci-"));
  try {
    const file = join(dir, "sample.test.mjs");
    writeFileSync(file, [
      `import test, { describe } from "node:test";`,
      `test("a pass", () => {});`,
      `test("a skip", { skip: "no box here" }, () => {});`,
      `test("a todo", { todo: true }, () => { throw new Error("x"); });`,
      `test("a red", () => { throw new Error("the first line\\nnot this one"); });`,
      `test("a parent", async (t) => { await t.test("child red", () => { throw new Error("boom"); }); await t.test("child ok", () => {}); });`,
      `describe("a suite", () => { test("in suite", () => {}); });`,
    ].join("\n"));
    const events = join(dir, "events.jsonl");
    const reporter = pathToFileURL(join(ROOT, ".github", "scripts", "suite-reporter.mjs")).href;
    // a child that inherits NODE_TEST_CONTEXT thinks it is inside this run and runs nothing
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ["--test", `--test-reporter=${reporter}`, `--test-reporter-destination=${events}`, file], { encoding: "utf8", env });
    assert.equal(r.status, 1, r.stderr);
    const read = readEvents(readFileSync(events, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
    assert.deepEqual(read.reds.map((x) => x.name), ["a red", "child red"]);
    assert.equal(read.reds[0].error, "the first line");
    assert.deepEqual(read.skips, [{ name: "a skip", reason: "no box here" }]);
    // node's own count: 8 tests (the parent and its two children among them), 1 suite;
    // 3 + 3 + 1 + 1 = 8, the parent counted among the fails as node counts it
    assert.deepEqual(read.counts, { tests: 8, pass: 3, fail: 3, skipped: 1, todo: 1, cancelled: 0, suites: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failure node names by the file's absolute path is read as the file's repo path, on either separator", () => {
  const fail = (name) => ({ name, nesting: 0, type: "test", outcome: "fail", failureType: "testCodeFailure", error: "test timed out" });
  const posix = readEvents([fail("/home/runner/work/office/office/test/x.test.mjs")], "test/x.test.mjs");
  const win = readEvents([fail("G:\\Postmark\\pool\\office-14\\test\\x.test.mjs")], "test/x.test.mjs");
  assert.deepEqual(posix.reds.map((r) => r.name), ["test/x.test.mjs"]);
  assert.deepEqual(win.reds.map((r) => r.name), ["test/x.test.mjs"]);
  // a test that merely mentions another path keeps its own name
  assert.deepEqual(readEvents([fail("reads test/y.test.mjs")], "test/x.test.mjs").reds.map((r) => r.name), ["reads test/y.test.mjs"]);
});

// ── the verdict ─────────────────────────────────────────────────────────────

const counts = (o = {}) => ({ tests: 2, pass: 2, fail: 0, skipped: 0, todo: 0, cancelled: 0, suites: 0, ...o });
const green = (names = ["x"]) => ({ exit: 0, seconds: 1, counts: counts(), reds: [], skips: [], ran: names });
const red = (name, others = []) => ({ exit: 1, seconds: 1, counts: counts({ pass: 1, fail: 1 }), reds: [{ name, failureType: "testCodeFailure", error: "no" }], skips: [], ran: [name, ...others] });
const row = (file, name, extra = {}) => ({ file, name, reason: "r", owner: "o", date: "2026-10-07", ...extra });
const kinds = (v) => v.problems.map((p) => p.kind).sort();

test("a clean run is GREEN, and its totals carry the denominator", () => {
  const v = verdict({ planned: ["test/a.test.mjs", "test/b.test.mjs"], results: { "test/a.test.mjs": green(), "test/b.test.mjs": green() }, known: [], shards: { planned: 2, reported: [1, 2] } });
  assert.equal(v.ok, true);
  assert.equal(v.totals.files, 2);
  assert.equal(v.totals.tests, 4);
});

test("A NEW RED fails the run, and a listed red does not", () => {
  const results = { "test/a.test.mjs": red("listed one"), "test/b.test.mjs": red("new one") };
  const v = verdict({ planned: Object.keys(results), results, known: [row("test/a.test.mjs", "listed one")] });
  assert.equal(v.ok, false);
  assert.deepEqual(v.problems.map((p) => [p.kind, p.name]), [["new-red", "new one"]]);
  assert.deepEqual(v.listed.map((r) => [r.name, r.outcome]), [["listed one", "red"]]);
});

test("the same name in another file is another test: a row keys on file AND name", () => {
  const results = { "test/a.test.mjs": green(["same"]), "test/b.test.mjs": red("same") };
  const v = verdict({ planned: Object.keys(results), results, known: [row("test/a.test.mjs", "same")] });
  assert.deepEqual(kinds(v), ["listed-now-passes", "new-red"]);
});

test("A LISTED TEST THAT PASSES fails the run, so the list shrinks; a flaky row may pass", () => {
  const results = { "test/a.test.mjs": green(["fixed", "flaky one"]) };
  const v = verdict({ planned: Object.keys(results), results, known: [row("test/a.test.mjs", "fixed"), row("test/a.test.mjs", "flaky one", { flaky: true })] });
  assert.deepEqual(v.problems.map((p) => [p.kind, p.name]), [["listed-now-passes", "fixed"]]);
  assert.deepEqual(v.listed.map((r) => r.outcome), ["green (flaky, allowed)"]);
});

test("A FLAKY ROW THAT REDS is judged by its one retry: green on the retry is a flake, red again is a red", () => {
  const flakyRow = row("test/a.test.mjs", "cold", { flaky: true });
  const v = (retry) => verdict({ planned: ["test/a.test.mjs"], results: { "test/a.test.mjs": { ...red("cold"), retry } }, known: [flakyRow] });
  const passed = v({ ran: ["cold"], reds: [] });
  assert.equal(passed.ok, true);
  assert.deepEqual(passed.listed.map((r) => r.outcome), ["flake: red, then green on its retry"]);
  const twice = v({ ran: ["cold"], reds: [{ name: "cold" }] });
  assert.deepEqual(kinds(twice), ["flaky-red-twice"]);
  assert.deepEqual(twice.listed.map((r) => r.outcome), ["red twice (a flaky row, so the run fails)"], "still counted as on the list");
  const crashed = v({ ran: [], reds: [] });
  assert.deepEqual(kinds(crashed), ["flaky-red-twice"], "a retry that never ran the test proves nothing");
  // only the flaky row's own name is read off the retry: a non-flaky red in the same file stays a red
  const mixed = verdict({ planned: ["test/a.test.mjs"], results: { "test/a.test.mjs": { ...red("cold", ["other"]), reds: [{ name: "cold" }, { name: "other" }], retry: { ran: ["cold", "other"], reds: [] } } }, known: [flakyRow] });
  assert.deepEqual(mixed.problems.map((p) => [p.kind, p.name]), [["new-red", "other"]]);
});

test("a listed test that no longer runs, or whose file is gone, is a stale row and fails the run", () => {
  const results = { "test/a.test.mjs": green(["renamed"]) };
  const v = verdict({ planned: Object.keys(results), results, known: [row("test/a.test.mjs", "old name"), row("test/gone.test.mjs", "anything")] });
  assert.deepEqual(kinds(v), ["listed-not-run", "listed-not-run"]);
});

test("a file that exited non-zero with no red of its own CRASHED, and that fails the run", () => {
  const results = { "test/a.test.mjs": { ...green([]), exit: 137, counts: counts({ tests: 0, pass: 0 }) } };
  const v = verdict({ planned: Object.keys(results), results, known: [] });
  assert.deepEqual(kinds(v), ["file-crashed"]);
});

test("a planned file with no result, and a shard that never reported, each fail the run", () => {
  const v = verdict({ planned: ["test/a.test.mjs", "test/b.test.mjs"], results: { "test/a.test.mjs": green() }, known: [], shards: { planned: 2, reported: [1] } });
  assert.deepEqual(kinds(v), ["file-missing", "shard-missing"]);
});

test("the committed known-failures list is well formed: every row names its file, test, reason, owner and date", () => {
  const { failures } = JSON.parse(readFileSync(join(ROOT, "test", "known-failures.json"), "utf8"));
  assert.ok(Array.isArray(failures));
  const files = new Set(listTestFiles(ROOT));
  const seen = new Set();
  for (const r of failures) {
    for (const k of ["file", "name", "reason", "owner", "date"]) assert.ok(typeof r[k] === "string" && r[k].trim(), `a row without ${k}: ${JSON.stringify(r)}`);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(files.has(r.file), `${r.file} is not a suite file`);
    const k = `${r.file}\u0000${r.name}`;
    assert.ok(!seen.has(k), `a row twice: ${r.file} · ${r.name}`);
    seen.add(k);
  }
});
