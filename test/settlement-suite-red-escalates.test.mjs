// settlement-suite-red-escalates.test.mjs — THE WIRING, not the module.
//
//   node --test test/settlement-suite-red-escalates.test.mjs
//
// ── WHY THIS EXISTS BESIDE test/settlement-escalate.test.mjs ────────────────
//
// That file proves the escalator: given a receipt it composes the right issue,
// gates the wrong receipt, caps its own list. It proves nothing at all about
// whether `deploy/settlement-auto.sh` ever CALLS it.
//
// Measured, on the reviewer's flip of PR #55: delete a call site and every
// other suite stays GREEN. The logic is proven and the wiring is not, which is
// the same shape as the 2026-09-14 instance itself — an escalator that existed,
// was correct, and was never reached. A future edit to the sweep script could
// drop a call with nothing anywhere going red.
//
// So this runs THE REAL SCRIPT. Not a stub of it, not a grep for the line: a
// whole crossing in a bottle, driven to each of its exits, asserting what each
// one said and whether it escalated.
//
// ── THE GATE SPLIT (founder-ruled 2026-09-16) ───────────────────────────────
//
// "A failed settlement should be a crisis." The crossing REFUSES only for harm
// — the world's `tools/harm-gate.mjs`, run after the sweep and before the push
// — and the grammar suite runs AFTER the push as a checker whose red is a
// warning: an issue on the first occurrence, `suite.red` on the receipt, and
// nothing held. Four exits are driven here: harm named; the gate could not run;
// a red suite after a published crossing; and the green control.
//
// The fixture world answers the harm gate with a STUB, and that is the point of
// a wiring test: the gate's own truth is proven in the world repo
// (`tools/harm-gate.test.mjs`, nine falsifiers over a real tree); this bottle
// asks only whether the script calls it, reads its exit, and says the right
// words to the right escalation before it exits.
//
// ── THE BOTTLE, AND WHY IT IS ITS OWN ──────────────────────────────────────
//
// It is the shape of test/settlement-source-flip.test.mjs's harness, minus
// everything that file needs and this one does not: no logging `git`/`npm`/
// `node` wrappers and no command log, because the question here is not which
// commands were issued but whether one line of output appeared.
//
// ── AND IT CANNOT REACH GITHUB ────────────────────────────────────────────
//
// The observable is the escalator's ISSUE-WANTED line, which it prints when it
// finds no credential. `SETTLEMENT_ESCALATE_CRED` is pointed at a path inside
// the scratch dir that is never created, so the no-credential path is taken on
// EVERY box. Without that pin this test would pass on a laptop and POST to the
// town repo on the box, where `/srv/postmark-office/.git-credentials` is exactly
// where the escalator expects it.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(OFFICE, "deploy", "settlement-auto.sh");
const scratch = mkdtempSync(join(tmpdir(), "postmark-suitered-"));

const has = (cmd) => { try { execFileSync("sh", ["-c", cmd], { stdio: "ignore" }); return true; } catch { return false; } };
// POSIX-shell shaped, like the harness it is drawn from. Where `sh` is not a
// real shell this SKIPS rather than passes: a silent green on a box that cannot
// run a crossing is the check-reached-for-something-easier defect.
const SH_OK = has("sh -c 'true'");

// ── THE SCRIPT'S OWN LITTER, PUT BACK ──────────────────────────────────────
//
// `settlement-auto.sh` copies a red suite log to
// `$OFFICE_ROOT/settlement-last-suite.log` — deliberately, it is where the
// deploy docs tell an operator to look — and `$OFFICE_ROOT` has to be this
// checkout, because the script runs tools out of it by absolute path. So the
// file lands in the working tree, untracked and not ignored.
//
// It is RESTORED, not merely deleted: on a box that already holds a real one
// from a real red crossing, a test that removed it would destroy the evidence
// an operator was about to read.
const LITTER = join(OFFICE, "settlement-last-suite.log");
// THE STORE the crossing's household export renders (POS-350): the export reads
// the registry from the store, never the fixture town's printouts, so each
// crossing re-states the store from the town seed first.
import { registryStoreForTowns } from "./helpers/office-under-test.mjs";
const REG = await registryStoreForTowns({ db: "suite_red_test" });
after(() => REG.stop());

let litterBefore = null;
before(() => { try { litterBefore = existsSync(LITTER) ? readFileSync(LITTER) : null; } catch { litterBefore = null; } });
after(() => {
  try {
    if (litterBefore === null) rmSync(LITTER, { force: true });
    else writeFileSync(LITTER, litterBefore);
  } catch { /* nothing this test can do about it, and it must not fail the run */ }
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ }
});

/** A RED grammar suite: two `not ok` lines on stdout and a non-zero exit. */
const RED_SUITE_RUNNER = [
  "console.log('TAP version 13');",
  "console.log('not ok 12 - the-town/pledges names a mark canon does not carry');",
  "console.log('not ok 40 - a household line the register has no row for');",
  "process.exit(1);",
].join("");

const SWEEP_STUB = `
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
const at = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const stakes = JSON.parse(readFileSync(at("--stakes"), "utf8"));
const repo = process.cwd();
const p = join(repo, "WORLD", "swept.txt");
mkdirSync(dirname(p), { recursive: true });
writeFileSync(p, "swept; " + stakes.length + " stake row(s)\\n");
execFileSync("git", ["-C", repo, "add", "-A"]);
execFileSync("git", ["-C", repo, "commit", "-qm", "settlement: sweep 1 published"], { env: { ...process.env, GIT_AUTHOR_NAME: "sweep", GIT_AUTHOR_EMAIL: "s@x.invalid", GIT_COMMITTER_NAME: "sweep", GIT_COMMITTER_EMAIL: "s@x.invalid" } });
process.stdout.write(JSON.stringify({
  published: ["alpha/one"], unpublished: [], left_drafted: [], withdrawn: [], quarantined: [], dropped: [], rebased: [],
  surveyed: { branches: 0, delta_rows: 0, escrow_backed_deltas: 0 },
}) + "\\n");
`;

/**
 * The harm gate, as the fixture world answers it. `HARM_GATE_SAYS` drives the
 * exit the script has to read: `ok` (0, no harm), `harm` (1, a report naming a
 * mark), `cannot` (2, no report — the gate could not run). Its stdout is the
 * report the script keeps and the receipt carries.
 */
const HARM_GATE_STUB = `
const says = process.env.HARM_GATE_SAYS ?? "ok";
if (says === "cannot") { console.error("harm-gate: could not gate: no WORLD/world-state.json — the fold did not run"); process.exit(2); }
const moved = says === "harm";
const checks = [
  { name: "lint", ok: true, count: 0, rows: [] },
  { name: "moved", ok: !moved, count: moved ? 1 : 0, rows: moved ? ["alpha/one: 10,10 -> 900,900 (no act names it)"] : [] },
  { name: "lost", ok: true, count: 0, rows: [] },
  { name: "escrow", ok: true, count: 0, rows: [], note: "fold stamps 1" },
  { name: "parcels", ok: true, count: 0, rows: [], note: "0 standing parcel(s)" },
];
process.stdout.write(JSON.stringify({ ok: !moved, base: "HEAD~1", before: 1, after: 1, checks }) + "\\n");
process.exit(moved ? 1 : 0);
`;

const STAMP_MINT_STUB = `
import { readFileSync } from "node:fs";
import { join } from "node:path";
export function currentHouseholds(clone) {
  const pins = JSON.parse(readFileSync(join(clone, "tools", "github-ids.json"), "utf8"));
  return new Map(Object.entries(pins).map(([handle, rec]) => [handle, { key: "gh:" + rec.id }]));
}
`;

let runSeq = 0;

/**
 * ONE CROSSING, IN A BOTTLE.
 *
 * The world carries canon, a sweep stub that really commits, and the harm-gate
 * stub; the town carries a stake deriver and the household resolver the
 * crossing refuses without (the registry refresh, 2026-09-09). The world's
 * `test:candle` is red or green as the case asks.
 */
function crossing(label, env = {}, { redSuite = true, gate = true } = {}) {
  const root = join(scratch, `${label}-${++runSeq}`);
  const seed = join(root, "seed");
  const origin = join(root, "world.git");
  const sweepClone = join(root, "sweep");
  const townSeed = join(root, "town-seed");
  const townOrigin = join(root, "town.git");
  const townClone = join(root, "town");
  const harbor = join(root, "harbor");
  mkdirSync(harbor, { recursive: true });

  const g = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "seed", GIT_AUTHOR_EMAIL: "seed@postmark.invalid",
      GIT_COMMITTER_NAME: "seed", GIT_COMMITTER_EMAIL: "seed@postmark.invalid",
      GIT_AUTHOR_DATE: "2026-08-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-08-01T00:00:00Z",
    },
  });

  // ── the world ────────────────────────────────────────────────────────
  mkdirSync(join(seed, "WORLD", "marks", "alpha", "published-note"), { recursive: true });
  mkdirSync(join(seed, "tools"), { recursive: true });
  writeFileSync(join(seed, "WORLD", "marks", "alpha", "published-note", "mark.md"),
    "---\nkind: sited\nby: alpha\ndate: 2026-08-01\n---\n\nalpha published this\n");
  writeFileSync(join(seed, "tools", "settlement-sweep.mjs"), SWEEP_STUB);
  if (gate) writeFileSync(join(seed, "tools", "harm-gate.mjs"), HARM_GATE_STUB);
  writeFileSync(join(seed, "package.json"), JSON.stringify({
    name: "world-fixture",
    // Both names, one runner: since postmark#2790 the crossing asks the world for
    // `test:candle`, and a fixture that answers only `test` reads as a RED suite
    // (missing script).
    scripts: (() => { const run = redSuite ? `node -e ${JSON.stringify(RED_SUITE_RUNNER)}` : 'node -e ""'; return { test: run, "test:candle": run }; })(),
  }));
  g(".", "init", "-q", "-b", "main", seed);
  g(seed, "config", "user.email", "seed@postmark.invalid");
  g(seed, "config", "user.name", "seed");
  g(seed, "add", "-A");
  g(seed, "commit", "-qm", "canon");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "ignore" });
  g(seed, "remote", "add", "origin", origin);
  g(seed, "push", "-q", "origin", "main");
  g(seed, "branch", "draft/alpha", "main");
  g(seed, "push", "-q", "origin", "draft/alpha");
  execFileSync("git", ["clone", "-q", origin, sweepClone], { stdio: "ignore" });
  execFileSync("git", ["-C", sweepClone, "config", "user.email", "sweep@postmark.invalid"], { stdio: "ignore" });
  execFileSync("git", ["-C", sweepClone, "config", "user.name", "sweep"], { stdio: "ignore" });

  // ── the town ────────────────────────────────────────────────────────
  mkdirSync(join(townSeed, "tools"), { recursive: true });
  writeFileSync(join(townSeed, "tools", "world-stake.mjs"),
    'process.stdout.write(JSON.stringify([{ holder: "alpha", mark: "alpha/one", n: 1, weight: 3, tick: 0 }]) + "\\n");\n');
  writeFileSync(join(townSeed, "tools", "github-ids.json"),
    `${JSON.stringify({ alpha: { login: "alpha-hub", id: 1 } }, null, 2)}\n`);
  writeFileSync(join(townSeed, "tools", "stamp-mint.mjs"), STAMP_MINT_STUB);
  g(".", "init", "-q", "-b", "main", townSeed);
  g(townSeed, "config", "user.email", "seed@postmark.invalid");
  g(townSeed, "config", "user.name", "seed");
  g(townSeed, "add", "-A");
  g(townSeed, "commit", "-qm", "town");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", townOrigin], { stdio: "ignore" });
  g(townSeed, "remote", "add", "origin", townOrigin);
  g(townSeed, "push", "-q", "origin", "main");
  execFileSync("git", ["clone", "-q", townOrigin, townClone], { stdio: "ignore" });

  REG.seedFromSync(townSeed);
  const res = spawnSync("sh", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      OFFICE_ROOT: OFFICE,
      TOWN_CLONE: townClone,
      WORLD_CLONE: sweepClone,
      SETTLEMENT_CLONE: sweepClone,
      SETTLEMENT_REPORT: join(harbor, "settlement-auto.json"),
      SETTLEMENT_HISTORY: join(harbor, "settlement-auto-history.jsonl"),
      // So the retry wrapper does not re-exec the script; the retry has its own
      // falsifier (test/settlement-retry.test.mjs).
      SETTLEMENT_ATTEMPT: "1",
      WORLD_SINGLE_LOG: "1",
      WORLD_DYNAMIC_DB: join(root, "dynamic.db"),
      SWEEP_SAW_OUT: join(root, "sweep-saw.json"),
      // § AND IT CANNOT REACH GITHUB, above.
      SETTLEMENT_ESCALATE_CRED: join(root, "no-such-credential-file"),
      ...REG.env,
      ...env,
    },
  });

  let receipt = null;
  try { receipt = JSON.parse(readFileSync(join(harbor, "settlement-auto.json"), "utf8")); } catch { /* none written */ }
  return { root, res, receipt, escalations: res.stderr.match(/\[settlement-escalate\][^\n]*/g) ?? [] };
}

/** The whole observable, in one place: did the call site fire, and for which class. */
const escalatedAs = (run) => run.escalations.join("\n").match(/ISSUE-WANTED title: settlement (?:refusal|warning): (\S+)/)?.[1] ?? null;

test("THE WIRING · HARM NAMED refuses, exits 1, and escalates `harm` with the gate's own rows", { skip: !SH_OK && "no POSIX sh" }, () => {
  const run = crossing("harm", { HARM_GATE_SAYS: "harm" }, { redSuite: false });

  assert.equal(run.res.status, 1, `harm publishes nothing and exits 1: ${run.res.stderr.slice(-800)}`);
  assert.match(run.res.stderr, /HARM NAMED/, "the bottle never reached the harm exit, so this proves nothing about it");
  assert.equal(escalatedAs(run), "harm",
    "the harm exit reached `exit 1` with NO escalation — a crisis that reaches nobody");
  assert.equal(run.receipt?.status, "refused");
  assert.equal(run.receipt?.harm?.ok, false, "the receipt carries the gate's report");
  assert.deepEqual(run.receipt?.harm?.checks?.find((c) => c.name === "moved")?.rows, ["alpha/one: 10,10 -> 900,900 (no act names it)"],
    "and the mark it named, verbatim");
  const body = run.escalations.join("\n") + run.res.stderr;
  assert.match(body, /alpha\/one: 10,10 -> 900,900/, "the issue names the mark — the whole reason a person can act on it");
  assert.doesNotMatch(run.res.stderr, /SUITE WARNING/, "no checker ran: nothing published, nothing to check");
});

test("THE WIRING · a gate that COULD NOT RUN refuses too, says so, and escalates `harm` — never a pass", { skip: !SH_OK && "no POSIX sh" }, () => {
  const run = crossing("cannot", { HARM_GATE_SAYS: "cannot" }, { redSuite: false });

  assert.equal(run.res.status, 1, `a gate that could not run publishes nothing and exits 1: ${run.res.stderr.slice(-800)}`);
  assert.match(run.res.stderr, /HARM GATE COULD NOT GATE/);
  assert.equal(escalatedAs(run), "harm");
  assert.equal(run.receipt?.status, "refused");
  assert.equal(run.receipt?.harm, null, "no report to carry — the receipt says null, not a fabricated verdict");
  assert.match(run.receipt?.detail ?? "", /could not gate/);
});

test("THE WIRING · a world with NO harm gate at its sha refuses rather than publishing ungated", { skip: !SH_OK && "no POSIX sh" }, () => {
  const run = crossing("nogate", {}, { redSuite: false, gate: false });

  assert.equal(run.res.status, 1, run.res.stderr.slice(-800));
  assert.match(run.res.stderr, /no tools\/harm-gate\.mjs at this world sha/);
  assert.equal(escalatedAs(run), "harm");
  assert.equal(run.receipt?.status, "refused");
});

test("THE WIRING · a RED suite after the push is a WARNING: the town publishes, exits 0, `suite.red` on the receipt, `suite-warning` escalated with the reds", { skip: !SH_OK && "no POSIX sh" }, () => {
  const run = crossing("warning", { HARM_GATE_SAYS: "ok" }, { redSuite: true });

  assert.equal(run.res.status, 0, `a red checker holds nothing: ${run.res.stderr.slice(-800)}`);
  assert.match(run.res.stderr, /SUITE WARNING/, "the bottle never reached the checker's red arm");
  assert.doesNotMatch(run.res.stderr, /SUITE RED, UNATTRIBUTABLE|publishing nothing/, "the old refusing exits are gone, not renamed");
  assert.equal(run.receipt?.status, "published");
  assert.equal(run.receipt?.suite?.red, true);
  assert.deepEqual(run.receipt?.suite?.reds, [
    "not ok 12 - the-town/pledges names a mark canon does not carry",
    "not ok 40 - a household line the register has no row for",
  ], "the receipt carries the reds themselves, not a count");
  assert.equal(escalatedAs(run), "suite-warning",
    "the checker's red reached the exit with NO escalation — a warning nobody hears is the 2026-09-14 shape again");
  const body = run.escalations.join("\n") + run.res.stderr;
  assert.match(body, /not ok 12 - the-town\/pledges names a mark canon does not carry/);
  assert.match(body, /THE TOWN IS PUBLISHED/, "the issue must say the town published — a warning read as a refusal sends a person to rerun a crossing that landed");
  assert.equal(existsSync(LITTER), true, "the red log is copied where the deploy docs say to look");
});

test("THE CONTROL · no harm and a GREEN suite publishes, exits 0, and escalates nothing", { skip: !SH_OK && "no POSIX sh" }, () => {
  // Without this, the assertions above are satisfied by a script that escalates
  // on every crossing — which would bury the queue exactly as filing a fresh
  // issue per crossing would.
  const run = crossing("green", { HARM_GATE_SAYS: "ok" }, { redSuite: false });

  assert.equal(run.res.status, 0, run.res.stderr.slice(-800));
  assert.match(run.res.stderr, /harm gate: NO HARM/);
  assert.doesNotMatch(run.res.stderr, /SUITE WARNING|HARM NAMED/);
  assert.equal(run.receipt?.status, "published");
  assert.equal(run.receipt?.harm?.ok, true, "the receipt carries the gate's report on a clean crossing too — `ok: true` is the receipt that it RAN");
  assert.equal(run.receipt?.suite?.red, false, "and the checker's — `red: false` is the receipt that it ran");
  assert.deepEqual(run.escalations, [],
    "a clean crossing escalated anyway — an alarm that always fires is an alarm nobody reads");
});
