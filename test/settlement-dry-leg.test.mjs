// settlement-dry-leg.test.mjs — SETTLEMENT_DRY=1 RUNS THE CROSSING AND WRITES NOTHING (POS-242).
//
//   node --test test/settlement-dry-leg.test.mjs
//
// ── WHAT IS UNDER TEST ──────────────────────────────────────────────────────
//
// The rehearsal copy could clear a window but not cross it, because after the
// harm gate the crossing published unconditionally. The dry leg is the same
// script to the same receipt with every write that leaves the run withheld and
// named. Each withheld writer has one test below, and each test is paired with
// a CONTROL crossing in the same bottle with DRY unset, which shows the writer
// is live there. A "nothing was written" that was never shown to be something
// that COULD be written is a gate wired to nothing.
//
// ── THE BOTTLE ──────────────────────────────────────────────────────────────
//
// The store path cannot run in `settlement-source-flip.test.mjs`'s fixture (it
// refuses for want of a store), so this one points OFFICE_ROOT at a fixture
// office: the receipt, the history, the surveyed reading and the retry are the
// REAL files, copied; the store tools, the registry pair and the escalation are
// stubs that log their argv and, when not told to be dry, WRITE the way the
// real tool writes — the photograph is the REAL writer and commits through the
// real penCommit, the retirement writes a store row, the escalation files.
//
// The two tools whose own dry runs are trusted here are pinned on their own
// ground: state-log-write's `dryRun` by test/state-log-write.test.mjs W6, and
// retire-unpublished's `--dry-run` by the last test in this file, which runs the
// REAL tool against a port nothing listens on.


import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OFFICE, SH_OK, scratch, g, bottle, cross } from "./helpers/settlement-bottle.mjs";

const skip = !SH_OK && "no POSIX sh";

const argvOf = (run, name) => run.stubs.filter((l) => l.startsWith(`${name} `));
const why = (run) => `exit ${run.res.status}\n${run.res.stderr}`;

// ── the control: every writer below is LIVE in this bottle ──────────────────

test("CONTROL · without DRY the bottle's crossing writes through every door the dry leg withholds", { skip }, () => {
  const b = bottle();
  const run = cross(b);
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.receipt.status, "published");
  assert.notEqual(run.after, run.before, "origin moved: main was pushed");
  assert.match(g(b.origin, "log", "--format=%s", "main"), /photograph: windows 213/, "the photograph landed on origin");
  assert.match(run.storeWrites ?? "", /RETIRED alpha\/old/, "the store was written");
  assert.match(run.escalations ?? "", /FILED suite-warning/, "a person was told");
  assert.ok(run.history && run.history.trim().length, "the history log took a line");
  assert.ok(existsSync(join(b.office, "settlement-last-suite.log")), "the suite log was kept in the office");
  assert.match(g(run.sweep, "config", "--local", "--get", "credential.helper"), /\.git-credentials/, "the live clone holds the pen's credential");
  assert.equal(run.receipt.dry, false, "and every receipt says whether it was dry");
  assert.deepEqual(run.receipt.withheld, []);
  assert.ok(argvOf(run, "await-clearing").every((l) => !l.includes("--rehearse")), "the timer's question");
});

// ── the dry leg ─────────────────────────────────────────────────────────────

test("D1 · DRY crosses to a full receipt and nothing reaches origin — no push, no tag", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.after, run.before, "every ref on origin, tags included, is as it was");
  assert.equal(run.receipt.status, "published", "the crossing's own word for what it would have done");
  assert.equal(run.receipt.dry, true);
  assert.match(run.receipt.detail, /^DRY RUN, nothing written — 1 published/);
  assert.ok(run.receipt.withheld.some((l) => /^world main's push: [0-9a-f]{40} over origin\/main [0-9a-f]{40}$/.test(l)),
    `main's push is named: ${JSON.stringify(run.receipt.withheld)}`);
  assert.notEqual(g(run.sweep, "rev-parse", "main"), g(b.origin, "rev-parse", "main"), "the fold DID run: local main is ahead");
  assert.match(run.res.stdout, /DRY — would publish/);
});

test("D2 · DRY renders the photograph and does not commit or push it", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  const argv = argvOf(run, "state-log-write");
  assert.equal(argv.length, 1, "the photograph step still runs");
  assert.match(argv[0], /--write --dry-run/);
  assert.doesNotMatch(g(run.sweep, "log", "--format=%s", "main"), /photograph:/, "nothing committed");
  assert.ok(run.receipt.withheld.some((l) => l.startsWith("the photograph's commit and push (STATE/log, window 213)")));
});

test("D3 · DRY names the store's retirement and writes no store row", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.storeWrites, null, "the store was not written");
  assert.match(argvOf(run, "retire-unpublished")[0] ?? "", /--dry-run/);
  assert.deepEqual(run.receipt.retired,
    { ran: false, dry_run: true, would_retire: ["alpha/old"], reason: "dry run — the store was not written" });
  assert.ok(run.receipt.withheld.includes("the store's retirement: 1 mark(s) (alpha/old)"));
});

test("D4 · DRY tells nobody: no escalation runs, and the receipt names the one it withheld", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.escalations, null, "the escalation tool never ran");
  assert.equal(argvOf(run, "settlement-escalate").length, 0);
  assert.ok(run.receipt.withheld.includes("escalation: suite-warning"), JSON.stringify(run.receipt.withheld));
  assert.equal(run.receipt.suite.red, true, "the checker still ran and its red is on the receipt");
});

test("D4b · a harm refusal under DRY is a full refusal receipt whose escalation is named, not filed", { skip }, () => {
  const b = bottle({ harm: true });
  const control = cross(b, { REGISTRY_N: "2" });
  assert.equal(control.res.status, 1);
  assert.match(control.escalations ?? "", /FILED harm/, "control: harm reaches a person");
  // Its own registry content, so the dry crossing has a registry commit of its
  // own to withhold whatever the control left on origin.
  const run = cross(b, { SETTLEMENT_DRY: "1", REGISTRY_N: "3" });
  assert.equal(run.res.status, 1, why(run));
  assert.equal(run.receipt.status, "refused");
  assert.match(run.receipt.detail, /^DRY RUN, nothing written — HARM NAMED/);
  assert.equal(run.escalations, null);
  assert.ok(run.receipt.withheld.includes("escalation: harm"), JSON.stringify(run.receipt.withheld));
});

test("D5 · DRY writes no history line — the roll-call's log never sees a rehearsal", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.history, null);
});

test("D6 · DRY keeps the suite log beside its own receipt, never in the office", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(existsSync(join(b.office, "settlement-last-suite.log")), false);
  assert.ok(existsSync(run.files.report.replace(/\.json$/, "-suite.log")));
  assert.equal(run.receipt.suite.log, `receipt-${run.files.report.match(/receipt-(\d+)\.json$/)[1]}-suite.log`);
});

test("D7 · a clone the dry leg makes holds no push credential", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  const helper = spawnSync("git", ["-C", run.sweep, "config", "--local", "--get", "credential.helper"], { encoding: "utf8" });
  assert.equal(helper.stdout.trim(), "", "no credential helper on the dry clone");
});

test("D8 · DRY asks the shadow's question: the newest closed window", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  assert.match(argvOf(run, "await-clearing")[0] ?? "", /--rehearse/);
  const byHand = cross(b, { SETTLEMENT_DRY: "1", SETTLEMENT_BY_HAND: "1" });
  assert.match(argvOf(byHand, "await-clearing")[0] ?? "", /--by-hand/, "by hand, it rehearses the operator's door");
  assert.doesNotMatch(argvOf(byHand, "await-clearing")[0] ?? "", /--rehearse/);
});

test("D9 · a registry-only crossing under DRY withholds main's push too (publish_main's other caller)", { skip }, () => {
  const b = bottle({ quiet: true, suiteRed: false });
  const control = cross(b, { REGISTRY_N: "2" });
  assert.equal(control.res.status, 0, why(control));
  assert.equal(control.receipt.status, "quiet");
  assert.notEqual(control.after, control.before, "control: the registry commit was pushed");
  const run = cross(b, { SETTLEMENT_DRY: "1", REGISTRY_N: "3" });
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.receipt.status, "quiet");
  assert.equal(run.after, run.before);
  assert.ok(run.receipt.withheld.some((l) => l.startsWith("world main's push: ")));
});

// ── what DRY refuses ────────────────────────────────────────────────────────

test("R1 · DRY refuses the git source — its drain writes before anything can be withheld", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1", SETTLEMENT_SOURCE: "git" });
  assert.equal(run.res.status, 1);
  assert.match(run.res.stderr, /rehearses the store crossing only/);
  assert.equal(run.after, run.before);
  assert.equal(run.receipt, null);
});

test("R2 · DRY refuses the public receipt: no SETTLEMENT_REPORT, or one under /srv/postmark-harbor", { skip }, () => {
  const b = bottle();
  const none = cross(b, { SETTLEMENT_DRY: "1", SETTLEMENT_REPORT: "" });
  assert.equal(none.res.status, 1);
  assert.match(none.res.stderr, /needs its own SETTLEMENT_REPORT/);
  const harbor = cross(b, { SETTLEMENT_DRY: "1", SETTLEMENT_REPORT: "/srv/postmark-harbor/settlement-auto.json" });
  assert.equal(harbor.res.status, 1);
  assert.match(harbor.res.stderr, /will not write a receipt under \/srv\/postmark-harbor/);
  assert.equal(harbor.after, harbor.before);
});

test("R3 · DRY refuses the live clone", { skip }, () => {
  const b = bottle();
  const unset = cross(b, { SETTLEMENT_DRY: "1", SETTLEMENT_CLONE: "" });
  assert.equal(unset.res.status, 1);
  assert.match(unset.res.stderr, /needs its own SETTLEMENT_CLONE/);
  const live = cross(b, { SETTLEMENT_DRY: "1", SETTLEMENT_CLONE: `${b.office}/settlement-clone` });
  assert.equal(live.res.status, 1);
  assert.match(live.res.stderr, /needs its own SETTLEMENT_CLONE/);
});

test("R4 · an unrecognised SETTLEMENT_DRY refuses rather than guessing", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "yes" });
  assert.equal(run.res.status, 1);
  assert.match(run.res.stderr, /SETTLEMENT_DRY="yes" is not `0` or `1`/);
  assert.equal(run.after, run.before);
});

// ── the real retire tool's dry run, on its own ground ───────────────────────

test("T1 · the REAL retire-unpublished --dry-run names its marks and opens no connection", () => {
  const dir = mkdtempSync(join(scratch, "retire-"));
  const sweepPath = join(dir, "sweep.json");
  writeFileSync(sweepPath, JSON.stringify({ unpublished: [{ id: "alpha/old" }, { id: "beta/gone" }] }));
  // Nothing listens on port 1: a tool that connected would fail, not print.
  const r = spawnSync(process.execPath, [join(OFFICE, "world2", "tools", "retire-unpublished.mjs"), "--sweep", sweepPath, "--dry-run"], {
    encoding: "utf8", env: { ...process.env, WORLD2_CLEARING_URL: "postgres://nobody@127.0.0.1:1/world2_rehearsal" }, timeout: 30_000,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { dry_run: true, would_retire: ["alpha/old", "beta/gone"] });
});
