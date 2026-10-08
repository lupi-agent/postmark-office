// suite-lib.mjs — the office suite in CI (POS-417): the plan, the reading of a
// shard's events, and the verdict. Pure functions over plain data, so
// test/suite-ci.test.mjs can drive every branch without a runner. Workflow
// machinery for .github/workflows/suite.yml, not an office tool.
//
// THE PLAN. Every test/*.test.mjs, sorted, dealt across N shards by each file's
// measured seconds (.github/suite/timings.json): longest first, each to the
// shard with the least time so far. A file with no timing (new, or never run in
// CI) is dealt at the median, so a new file never lands unplanned. Every shard
// computes the same plan from the same committed inputs, so no job hands file
// lists to another.
//
// THE VERDICT. A red is a leaf: a test that failed for its own reason, not a
// parent that failed because a subtest did. The run fails on
//   · a red that is not on test/known-failures.json (a new red);
//   · a listed test that passed (the list shrinks: delete its row), unless the
//     row is `flaky`. A flaky test that reds is run again once (its whole
//     file, by the shard): green on the retry is a flake and allowed, red twice
//     is a red and fails the run;
//   · a listed test that did not run at all (renamed or deleted: the row is stale);
//   · a planned file with no result, or a file that exited non-zero with no red
//     of its own (it crashed, or was killed: its tests vanished, they did not pass);
//   · a shard that reported nothing.
// Everything it counts is printed with its denominator.

import { readdirSync } from "node:fs";
import { join } from "node:path";

/** The suite's files, as `npm test` globs them: test/*.test.mjs, sorted. */
export function listTestFiles(root) {
  return readdirSync(join(root, "test"))
    .filter((n) => n.endsWith(".test.mjs"))
    .sort()
    .map((n) => `test/${n}`);
}

const median = (xs) => {
  if (!xs.length) return 1;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Deal `files` across `n` shards by `timings` ({ file: seconds }).
 * Returns [{ shard: 1..n, files: [...], seconds }], each shard's files sorted.
 */
export function planShards(files, timings, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`shard count must be a positive integer, got ${n}`);
  const known = files.map((f) => timings[f]).filter((s) => typeof s === "number" && s > 0);
  const fallback = median(known);
  const cost = (f) => (typeof timings[f] === "number" && timings[f] > 0 ? timings[f] : fallback);
  const shards = Array.from({ length: n }, (_, i) => ({ shard: i + 1, files: [], seconds: 0 }));
  // longest first; ties by name, so the plan is the same on every runner
  const order = [...files].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : a > b ? 1 : 0));
  for (const f of order) {
    const s = shards.reduce((lo, x) => (x.seconds < lo.seconds ? x : lo));
    s.files.push(f);
    s.seconds += cost(f);
  }
  for (const s of shards) { s.files.sort(); s.seconds = Math.round(s.seconds * 10) / 10; }
  return shards;
}

/**
 * Read one file's reporter events (suite-reporter.mjs JSON lines) into its
 * counts and its leaf reds. `type: "suite"` events (describe) are not tests,
 * as node's own `# tests` count leaves them out. A failure node reports for
 * the FILE (it would not load, a top-level hook threw) carries the file's
 * absolute path as its name, which differs per checkout; given `file`, that
 * name is read as the file's repo path, so a row can name it.
 */
export function readEvents(lines, file = null) {
  const own = (name) => (file && String(name).replaceAll("\\", "/").endsWith(`/${file}`) ? file : name);
  const counts = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0, suites: 0 };
  const reds = [];
  const skips = [];
  const ran = [];
  for (const raw of lines) {
    const e = { ...raw, name: own(raw.name) };
    if (e.type === "suite") { counts.suites++; continue; }
    counts.tests++;
    ran.push(e.name);
    if (e.outcome === "pass") {
      if (e.skip) { counts.skipped++; skips.push({ name: e.name, reason: e.skip }); }
      else if (e.todo) counts.todo++;
      else counts.pass++;
    } else if (e.outcome === "fail") {
      if (e.todo) { counts.todo++; continue; }
      if (e.failureType === "cancelledByParent") { counts.cancelled++; continue; }
      counts.fail++;
      // a parent that failed only because a subtest did is not a red of its own
      if (e.failureType !== "subtestsFailed") reds.push({ name: e.name, failureType: e.failureType ?? null, error: e.error ?? null });
    }
  }
  return { counts, reds, skips, ran };
}

const key = (file, name) => `${file}\u0000${name}`;

/**
 * The verdict over a whole run.
 *   planned:  [file]                          every file some shard was dealt
 *   results:  { file: { exit, seconds, counts, reds, skips, ran, retry? } }
 *             retry: { ran, reds } from the file's one re-run, when a flaky row red
 *   known:    [{ file, name, reason, owner, date, flaky? }]
 *   shards:   { planned: n, reported: [shard numbers that uploaded] }
 * Returns { ok, totals, problems: [{ kind, file, name?, detail }], listed: [...] }.
 */
export function verdict({ planned, results, known, shards }) {
  const problems = [];
  const totals = { files: 0, tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0, suites: 0, reds: 0 };
  const redKeys = new Map();
  const ranKeys = new Set();

  if (shards) {
    for (let i = 1; i <= shards.planned; i++)
      if (!shards.reported.includes(i)) problems.push({ kind: "shard-missing", file: null, detail: `shard ${i} of ${shards.planned} reported nothing` });
  }

  for (const file of planned) {
    const r = results[file];
    if (!r) { problems.push({ kind: "file-missing", file, detail: "planned, but no result came back" }); continue; }
    totals.files++;
    for (const k of Object.keys(r.counts)) totals[k] += r.counts[k];
    for (const n of r.ran ?? []) ranKeys.add(key(file, n));
    for (const red of r.reds) { redKeys.set(key(file, red.name), { file, ...red }); ranKeys.add(key(file, red.name)); }
    if (r.exit !== 0 && r.reds.length === 0)
      problems.push({ kind: "file-crashed", file, detail: `exited ${r.exit} with no red of its own (${r.counts.tests} tests reported)` });
  }
  totals.reds = redKeys.size;

  const listed = [];
  const knownKeys = new Set();
  for (const row of known) {
    const k = key(row.file, row.name);
    knownKeys.add(k);
    if (!planned.includes(row.file)) {
      problems.push({ kind: "listed-not-run", file: row.file, name: row.name, detail: "its file is not in the suite: delete the row" });
      continue;
    }
    if (!results[row.file]) continue; // file-missing already says so
    if (redKeys.has(k) && row.flaky) {
      const retry = results[row.file].retry;
      if (!retry) { listed.push({ ...row, outcome: "red (flaky, not retried)" }); continue; }
      if (retry.reds.some((x) => x.name === row.name)) {
        problems.push({ kind: "flaky-red-twice", file: row.file, name: row.name, detail: "red, and red again on its one retry: that is a red, not a flake" });
        listed.push({ ...row, outcome: "red twice (a flaky row, so the run fails)" });
        continue;
      }
      if (!retry.ran.includes(row.name)) {
        problems.push({ kind: "flaky-red-twice", file: row.file, name: row.name, detail: "red, and its retry never ran it (the file crashed on the retry)" });
        continue;
      }
      listed.push({ ...row, outcome: "flake: red, then green on its retry" });
      continue;
    }
    if (redKeys.has(k)) { listed.push({ ...row, outcome: "red" }); continue; }
    if (!ranKeys.has(k)) {
      problems.push({ kind: "listed-not-run", file: row.file, name: row.name, detail: "no test by this name ran: renamed or deleted, so the row is stale" });
      continue;
    }
    if (row.flaky) { listed.push({ ...row, outcome: "green (flaky, allowed)" }); continue; }
    problems.push({ kind: "listed-now-passes", file: row.file, name: row.name, detail: "listed as known-red and it passed: delete its row" });
  }
  for (const [k, red] of redKeys)
    if (!knownKeys.has(k)) problems.push({ kind: "new-red", file: red.file, name: red.name, detail: red.error ?? red.failureType ?? "failed" });

  return { ok: problems.length === 0, totals, problems, listed };
}

/** A fresh timings map from a run's results: { file: seconds }, sorted by file. */
export function timingsOf(results) {
  const out = {};
  for (const f of Object.keys(results).sort()) {
    const s = results[f].seconds;
    if (typeof s === "number") out[f] = Math.round(s * 10) / 10;
  }
  return out;
}
