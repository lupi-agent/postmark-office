#!/usr/bin/env node
// suite-summary.mjs — the one verdict over every shard of the office suite
// (POS-417). Workflow machinery for .github/workflows/suite.yml, not an office tool.
//
//   node .github/scripts/suite-summary.mjs --in <dir> --of 8 [--timings-out <file>]
//
// <dir> holds every shard's upload (shard-<i>.json, events/, tap/). The rules
// are suite-lib.mjs § verdict: a red off test/known-failures.json fails the run,
// and so does a listed test that passed, a listed test that no longer exists, a
// file that crashed, and a shard that never reported. The totals are printed
// with their denominator, and written to $GITHUB_STEP_SUMMARY when it is set.
// --timings-out writes this run's per-file seconds, the next plan's input.
//
// Exits 0 on a sound run, 1 on a failed verdict, 2 when it cannot read its input.

import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listTestFiles, readEvents, timingsOf, verdict } from "./suite-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KNOWN = join(ROOT, "test", "known-failures.json");

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1];
};
const die = (msg) => { console.error(`suite-summary: ${msg}`); process.exit(2); };

const dir = arg("in");
const of = Number(arg("of"));
if (!dir || !Number.isInteger(of) || of < 1) die("usage: --in <dir> --of <n> [--timings-out <file>]");
if (!existsSync(dir)) die(`no shard results at ${dir}`);

const known = JSON.parse(readFileSync(KNOWN, "utf8")).failures;
if (!Array.isArray(known)) die(`${KNOWN} has no "failures" array`);

const planned = listTestFiles(ROOT);
const reported = [];
const results = {};
let node = null;
for (const name of readdirSync(dir).filter((n) => /^shard-\d+\.json$/.test(n)).sort()) {
  const rec = JSON.parse(readFileSync(join(dir, name), "utf8"));
  reported.push(rec.shard);
  node ??= rec.node;
  for (const [file, r] of Object.entries(rec.files)) {
    const ev = join(dir, "events", `${basename(file, ".test.mjs")}.jsonl`);
    const lines = existsSync(ev)
      ? readFileSync(ev, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
      : [];
    results[file] = { ...r, ...readEvents(lines, file) };
    if (r.retry) {
      const rev = join(dir, "events", `${basename(file, ".test.mjs")}.retry.jsonl`);
      const rlines = existsSync(rev) ? readFileSync(rev, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
      const { ran, reds } = readEvents(rlines, file);
      results[file].retry = { ran, reds };
    }
  }
}

const v = verdict({ planned, results, known, shards: { planned: of, reported } });
const t = v.totals;
const knownRed = v.listed.filter((r) => r.outcome.startsWith("red")).length;
const head = `${v.ok ? "GREEN" : "RED"} · ${t.reds} reds (${knownRed} on the known list, ${t.reds - knownRed} not) in ${t.tests} tests across ${t.files} of ${planned.length} files in ${reported.length} of ${of} shards · ` +
  `pass ${t.pass} · skipped ${t.skipped} · todo ${t.todo} · cancelled ${t.cancelled} · suites ${t.suites} · node ${node ?? "?"}`;

const md = [];
md.push(`## The office suite: ${head}`, "");
if (v.problems.length) {
  md.push(`### What fails the run (${v.problems.length})`, "");
  for (const p of v.problems) md.push(`- **${p.kind}** · \`${p.file ?? "-"}\`${p.name ? ` · ${p.name}` : ""} · ${p.detail}`);
  md.push("");
}
md.push(`### Known failures (${v.listed.length} of ${known.length} rows matched)`, "");
for (const r of v.listed) md.push(`- ${r.outcome} · \`${r.file}\` · ${r.name} · ${r.reason} (${r.owner}, ${r.date})`);
md.push("");
const skipReasons = new Map();
for (const [file, r] of Object.entries(results))
  for (const s of r.skips) {
    const k = `${file} · ${s.reason}`;
    skipReasons.set(k, (skipReasons.get(k) ?? 0) + 1);
  }
md.push(`### Skipped, by file and reason (${t.skipped})`, "");
for (const [k, n] of [...skipReasons].sort()) md.push(`- ${n} × ${k}`);
md.push("");
const slow = Object.entries(results).sort((a, b) => b[1].seconds - a[1].seconds).slice(0, 10);
md.push("### The ten slowest files", "");
for (const [f, r] of slow) md.push(`- ${r.seconds} s · \`${f}\``);

const text = md.join("\n") + "\n";
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);

const timingsOut = arg("timings-out");
if (timingsOut) writeFileSync(timingsOut, JSON.stringify(timingsOf(results), null, 2) + "\n");

process.exit(v.ok ? 0 : 1);
