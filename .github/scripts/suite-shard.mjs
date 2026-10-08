#!/usr/bin/env node
// suite-shard.mjs — run one shard of the office suite (POS-417). Workflow
// machinery for .github/workflows/suite.yml, not an office tool.
//
//   node .github/scripts/suite-shard.mjs --plan 8                       print the plan, run nothing
//   node .github/scripts/suite-shard.mjs --shard 3 --of 8 --jobs 4 --out suite-out
//
// Each of the shard's files runs in its own `node --test` process (the same
// isolation `npm test` gives every file), up to --jobs at once, with the TAP
// reporter and suite-reporter.mjs side by side. A file's wall time and exit
// code come from here, so the next plan is balanced by what the file cost and
// a file that crashed is told apart from one that passed.
//
// Writes <out>/shard-<i>.json, <out>/tap/<file>.tap, <out>/events/<file>.jsonl
// and <out>/stderr/<file>.txt. Exits 0 once every file has run, whatever they
// said: the summary job is the verdict, and it reads every shard. Exits 2 only
// when the shard itself cannot run.

import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { listTestFiles, planShards } from "./suite-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const TIMINGS = join(ROOT, ".github", "suite", "timings.json");
const KNOWN = join(ROOT, "test", "known-failures.json");
const REPORTER = pathToFileURL(join(HERE, "suite-reporter.mjs")).href;
// A test's own cap is --test-timeout (npm test's 180 s). A FILE's cap is this:
// past it the file is killed and reads as crashed, never as passed.
const FILE_CAP_MS = 25 * 60 * 1000;

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1];
};
const die = (msg) => { console.error(`suite-shard: ${msg}`); process.exit(2); };

const timings = existsSync(TIMINGS) ? JSON.parse(readFileSync(TIMINGS, "utf8")) : {};
const files = listTestFiles(ROOT);

const planOnly = arg("plan", null);
if (planOnly !== null) {
  const plan = planShards(files, timings, Number(planOnly));
  for (const s of plan) console.log(`shard ${s.shard}: ${String(s.files.length).padStart(3)} files · ${String(s.seconds).padStart(7)} s planned`);
  console.log(`${files.length} files in ${plan.length} shards; ${files.filter((f) => !(timings[f] > 0)).length} have no timing (dealt at the median)`);
  process.exit(0);
}

const shard = Number(arg("shard"));
const of = Number(arg("of"));
const jobs = Number(arg("jobs", "4"));
const out = resolve(arg("out", "suite-out"));
if (!Number.isInteger(shard) || !Number.isInteger(of) || shard < 1 || shard > of) die("usage: --shard <i> --of <n> [--jobs <k>] [--out <dir>]");
if (!Number.isInteger(jobs) || jobs < 1) die(`--jobs must be a positive integer, got ${arg("jobs")}`);

const mine = planShards(files, timings, of)[shard - 1].files;
if (!mine.length) die(`shard ${shard} of ${of} was dealt no files (${files.length} in the suite)`);
for (const d of ["tap", "events", "stderr"]) mkdirSync(join(out, d), { recursive: true });

const stem = (f) => basename(f, ".test.mjs");
const record = { shard, of, jobs, node: process.version, started_at: new Date().toISOString(), files: {} };

function runOne(file, suffix = "") {
  return new Promise((done) => {
    const s = stem(file) + suffix;
    const errFd = openSync(join(out, "stderr", `${s}.txt`), "w");
    const t0 = Date.now();
    const child = spawn(process.execPath, [
      "--test", "--test-timeout=180000",
      "--test-reporter=tap", `--test-reporter-destination=${join(out, "tap", `${s}.tap`)}`,
      `--test-reporter=${REPORTER}`, `--test-reporter-destination=${join(out, "events", `${s}.jsonl`)}`,
      file,
    ], { cwd: ROOT, stdio: ["ignore", "ignore", errFd] });
    const cap = setTimeout(() => child.kill("SIGKILL"), FILE_CAP_MS);
    child.on("exit", (code, signal) => {
      clearTimeout(cap);
      closeSync(errFd);
      const seconds = (Date.now() - t0) / 1000;
      done({ exit: code ?? 128, signal: signal ?? null, seconds: Math.round(seconds * 10) / 10 });
    });
  });
}

let next = 0;
let finished = 0;
async function lane() {
  while (next < mine.length) {
    const file = mine[next++];
    const r = (record.files[file] = await runOne(file));
    finished++;
    console.log(`[${String(finished).padStart(3)}/${mine.length}] ${file} · ${r.seconds} s · exit ${r.exit}${r.signal ? ` (${r.signal})` : ""}`);
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, mine.length) }, lane));

// THE ONE RETRY. A file in which a `flaky` row of test/known-failures.json
// went red runs once more, whole, after every other file (so it is not run
// under the same contention), into <stem>.retry.*. The summary reads it: green
// on the retry is a flake, red again is a red. Nothing else is ever retried.
const flaky = new Set(JSON.parse(readFileSync(KNOWN, "utf8")).failures.filter((r) => r.flaky).map((r) => `${r.file}\u0000${r.name}`));
for (const file of mine) {
  const ev = join(out, "events", `${stem(file)}.jsonl`);
  if (!existsSync(ev)) continue;
  const redFlaky = readFileSync(ev, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.outcome === "fail" && flaky.has(`${file}\u0000${e.name}`)).map((e) => e.name);
  if (!redFlaky.length) continue;
  const r = await runOne(file, ".retry");
  record.files[file].retry = r;
  console.log(`[retry] ${file} · flaky red: ${redFlaky.join(" | ")} · retry ${r.seconds} s · exit ${r.exit}`);
}

record.finished_at = new Date().toISOString();
writeFileSync(join(out, `shard-${shard}.json`), JSON.stringify(record, null, 2) + "\n");
console.log(`shard ${shard} of ${of}: ${mine.length} files run, ${Object.values(record.files).filter((r) => r.exit !== 0).length} exited non-zero`);
