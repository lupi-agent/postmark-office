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
// real tool writes — the photograph commits and pushes (penCommit under
// TOWN_PUSH=1), the retirement writes a store row, the escalation files.
//
// The two tools whose own dry runs are trusted here are pinned on their own
// ground: state-log-write's `dryRun` by test/state-log-write.test.mjs W6, and
// retire-unpublished's `--dry-run` by the last test in this file, which runs the
// REAL tool against a port nothing listens on.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(OFFICE, "deploy", "settlement-auto.sh");
const scratch = mkdtempSync(join(tmpdir(), "postmark-dryleg-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });

const has = (cmd) => { try { execFileSync("sh", ["-c", cmd], { stdio: "ignore" }); return true; } catch { return false; } };
const SH_OK = has("sh -c 'true'");
const skip = !SH_OK && "no POSIX sh";

const GIT_ENV = {
  GIT_AUTHOR_NAME: "seed", GIT_AUTHOR_EMAIL: "seed@postmark.invalid",
  GIT_COMMITTER_NAME: "seed", GIT_COMMITTER_EMAIL: "seed@postmark.invalid",
};
const g = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...GIT_ENV },
}).trim();

// Every stub logs `<name> <argv…>` to STUB_LOG, so a test reads which flags the
// crossing actually passed.
const LOGGER = `
import * as stubFs from "node:fs";
const logArgs = (name) => { if (process.env.STUB_LOG) stubFs.appendFileSync(process.env.STUB_LOG, name + " " + process.argv.slice(2).join(" ") + "\\n"); };
const at = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1]; };
const flag = (n) => process.argv.includes(n);
`;

const STUBS = {
  "world2/tools/await-clearing.mjs": `${LOGGER}
logArgs("await-clearing");
process.stdout.write(JSON.stringify({ window: 213, cleared_at: "2026-10-01T05:45:44Z", waited_s: 0 }) + "\\n");
`,
  "world2/tools/state-log-write.mjs": `${LOGGER}
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
logArgs("state-log-write");
const world = at("--world");
if (flag("--check")) { process.stdout.write(JSON.stringify({ window: 213, crossings: [] }) + "\\n"); process.exit(0); }
const windows = [{ crossing: 213, lines: 1 }];
if (flag("--dry-run")) {
  process.stdout.write(JSON.stringify({ window: 213, windows, state_commit: null, dry_run: true, state_note: "dry run — nothing written, nothing committed" }) + "\\n");
  process.exit(0);
}
// penCommit's ceremony, as it runs on the box: commit, and push when TOWN_PUSH=1.
mkdirSync(join(world, "STATE", "log"), { recursive: true });
writeFileSync(join(world, "STATE", "log", "213.journal.jsonl"), JSON.stringify({ seq: 1, at: Date.now() }) + "\\n");
const git = (...a) => execFileSync("git", ["-C", world, ...a], { encoding: "utf8" }).trim();
git("add", "STATE");
git("-c", "user.name=pen", "-c", "user.email=pen@x.invalid", "commit", "-qm", "photograph: windows 213 from the register");
if (process.env.TOWN_PUSH === "1") git("push", "-q", "origin", "main:main");
process.stdout.write(JSON.stringify({ window: 213, windows, state_commit: git("rev-parse", "HEAD") }) + "\\n");
`,
  "world2/tools/fold-input-cli.mjs": `${LOGGER}
logArgs("fold-input-cli");
process.stdout.write(JSON.stringify({ stakes: [{ holder: "alpha", mark: "alpha/one", n: 1, weight: 3, tick: 0 }] }) + "\\n");
`,
  "src/store-writedown.mjs": `${LOGGER}
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
logArgs("store-writedown");
const world = at("--world");
const git = (...a) => execFileSync("git", ["-C", world, ...a], { encoding: "utf8" }).trim();
git("checkout", "-q", "-B", "draft/alpha", "main");
mkdirSync(join(world, "WORLD", "marks", "alpha", "one"), { recursive: true });
writeFileSync(join(world, "WORLD", "marks", "alpha", "one", "mark.md"), "---\\nkind: sited\\nby: alpha\\n---\\n\\none\\n");
git("add", "-A");
git("-c", "user.name=store", "-c", "user.email=s@x.invalid", "commit", "-qm", "store write-down: 1 mark(s) — alpha (window 213)");
git("checkout", "-q", "main");
process.stdout.write(JSON.stringify({ written: 1, marks: 1, households: ["alpha"], as_of: { window: 213 },
  ingest: { storeSha: "abcdef1234", reason: "at-head", behind: 0 }, sketchbooks_cleared: { removed_remote: 0, removed_local: 0 } }) + "\\n");
`,
  "world2/tools/retire-unpublished.mjs": `${LOGGER}
import { appendFileSync, readFileSync } from "node:fs";
logArgs("retire-unpublished");
const sweep = JSON.parse(readFileSync(at("--sweep"), "utf8"));
const slugs = (sweep.unpublished || []).map((r) => r.id);
if (flag("--dry-run")) { process.stdout.write(JSON.stringify({ dry_run: true, would_retire: slugs }) + "\\n"); process.exit(0); }
appendFileSync(process.env.STORE_WRITES, "RETIRED " + slugs.join(",") + "\\n");
process.stdout.write(JSON.stringify({ ran: true, count: slugs.length, retired: slugs.map((slug) => ({ slug })), already_retired: [], absent: [], window: 213 }) + "\\n");
`,
  "deploy/settlement-escalate.mjs": `${LOGGER}
import { appendFileSync } from "node:fs";
logArgs("settlement-escalate");
appendFileSync(process.env.ESCALATIONS, "FILED " + at("--class") + "\\n");
`,
  "tools/world-households-export.mjs": `${LOGGER}
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
logArgs("world-households-export");
mkdirSync(join(at("--world"), "WORLD"), { recursive: true });
writeFileSync(join(at("--world"), "WORLD", "households.json"), JSON.stringify({ alpha: ["alpha"], n: process.env.REGISTRY_N || "1" }) + "\\n");
`,
  "deploy/settlement-registry.mjs": `${LOGGER}
import { copyFileSync } from "node:fs";
import { join } from "node:path";
logArgs("settlement-registry");
copyFileSync(at("--fresh"), join(at("--world"), "WORLD", "households.json"));
process.stdout.write(JSON.stringify({ changed: true, commit_message: "registry: refreshed (fixture)", summary: "1 household (fixture)", verified_at: at("--town-sha") }) + "\\n");
`,
};

// The real files the crossing composes its receipt and its history with.
const REAL = ["deploy/settlement-receipt.mjs", "deploy/surveyed-reading.mjs", "deploy/refused-marks.mjs",
  "deploy/settlement-history.mjs", "deploy/settlement-retry.sh"];

let seq = 0;

/**
 * ONE STORE CROSSING, IN A BOTTLE. `quiet` makes the sweep publish nothing (the
 * registry-only crossing, whose push is publish_main's other caller); `harm`
 * makes the harm gate name a mark; `suiteRed` reddens the post-push checker.
 */
function bottle({ quiet = false, harm = false, suiteRed = true } = {}) {
  const root = join(scratch, `b${++seq}`);
  const office = join(root, "office");
  mkdirSync(join(root, "harbor"), { recursive: true });
  for (const f of REAL) {
    mkdirSync(dirname(join(office, f)), { recursive: true });
    copyFileSync(join(OFFICE, f), join(office, f));
  }
  for (const [f, src] of Object.entries(STUBS)) {
    mkdirSync(dirname(join(office, f)), { recursive: true });
    writeFileSync(join(office, f), src);
  }

  // the world: canon on main, a sweep that commits, a harm gate, a checker suite
  const seed = join(root, "world-seed");
  mkdirSync(join(seed, "tools"), { recursive: true });
  mkdirSync(join(seed, "WORLD", "marks", "alpha", "old"), { recursive: true });
  writeFileSync(join(seed, "WORLD", "marks", "alpha", "old", "mark.md"), "---\nkind: sited\nby: alpha\n---\n\nold\n");
  writeFileSync(join(seed, "tools", "settlement-sweep.mjs"), `
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const repo = process.cwd();
const quiet = ${JSON.stringify(quiet)};
if (!quiet) {
  writeFileSync(join(repo, "WORLD", "swept.txt"), "swept\\n");
  execFileSync("git", ["-C", repo, "add", "-A"]);
  execFileSync("git", ["-C", repo, "-c", "user.name=sweep", "-c", "user.email=s@x.invalid", "commit", "-qm", "settlement: sweep 1 published"]);
}
process.stdout.write(JSON.stringify({
  published: quiet ? [] : ["alpha/one"], unpublished: quiet ? [] : [{ id: "alpha/old" }],
  left_drafted: [], withdrawn: [], quarantined: [], dropped: [], rebased: [],
  surveyed: { branches: 1, delta_rows: 1, escrow_backed_deltas: 1 },
}) + "\\n");
`);
  writeFileSync(join(seed, "tools", "harm-gate.mjs"), harm
    ? 'process.stdout.write(JSON.stringify({ ok: false, checks: [{ name: "moved", ok: false, count: 1, rows: ["alpha/one: moved with no act"] }] }) + "\\n"); process.exit(1);\n'
    : 'process.stdout.write(JSON.stringify({ ok: true, checks: [] }) + "\\n");\n');
  writeFileSync(join(seed, "package.json"), JSON.stringify({ name: "world-fixture", scripts: {
    "test:candle": suiteRed ? "node -e \"console.log('not ok 1 - a fixture red'); process.exit(1)\"" : "node -e \"\"",
  } }));
  execFileSync("git", ["init", "-q", "-b", "main", seed], { stdio: "ignore" });
  g(seed, "add", "-A");
  g(seed, "commit", "-qm", "canon");
  const origin = join(root, "world.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "ignore" });
  g(seed, "push", "-q", origin, "main");
  // The office's world clone is only where the crossing reads origin's URL.
  const worldClone = join(root, "world-clone");
  execFileSync("git", ["clone", "-q", origin, worldClone], { stdio: "ignore" });

  // the town: a fetchable origin; the registry stubs do not read it
  const townSeed = join(root, "town-seed");
  mkdirSync(townSeed, { recursive: true });
  writeFileSync(join(townSeed, "README.md"), "town\n");
  execFileSync("git", ["init", "-q", "-b", "main", townSeed], { stdio: "ignore" });
  g(townSeed, "add", "-A");
  g(townSeed, "commit", "-qm", "town");
  const townOrigin = join(root, "town.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", townOrigin], { stdio: "ignore" });
  g(townSeed, "push", "-q", townOrigin, "main");
  const townClone = join(root, "town");
  execFileSync("git", ["clone", "-q", townOrigin, townClone], { stdio: "ignore" });

  return { root, office, origin, worldClone, townClone };
}

/** Every ref on the bare origin, tags included: what "nothing left the run" is measured on. */
const originRefs = (origin) => g(origin, "for-each-ref", "--format=%(refname) %(objectname)");

function cross(b, env = {}) {
  const sweep = join(b.root, `sweep-${++seq}`);
  const files = {
    stubLog: join(b.root, `stubs-${seq}.log`),
    storeWrites: join(b.root, `store-writes-${seq}.log`),
    escalations: join(b.root, `escalations-${seq}.log`),
    report: join(b.root, "harbor", `receipt-${seq}.json`),
  };
  const before = originRefs(b.origin);
  const res = spawnSync("sh", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...GIT_ENV,
      OFFICE_ROOT: b.office,
      TOWN_CLONE: b.townClone,
      WORLD_CLONE: b.worldClone,
      SETTLEMENT_CLONE: sweep,
      SETTLEMENT_REPORT: files.report,
      SETTLEMENT_SOURCE: "store",
      STATE_LOG_SOURCE: "store",
      // As on the box: /etc/postmark-office.env carries TOWN_PUSH=1, which is
      // what makes the photograph's penCommit a push.
      TOWN_PUSH: "1",
      // The retire step runs only with a pen. Nothing listens on port 1.
      WORLD2_CLEARING_URL: "postgres://nobody@127.0.0.1:1/world2_rehearsal",
      // One attempt: the retry is settlement-retry.test.mjs's.
      SETTLEMENT_ATTEMPT: "1",
      STUB_LOG: files.stubLog,
      STORE_WRITES: files.storeWrites,
      ESCALATIONS: files.escalations,
      ...env,
    },
  });
  const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
  let receipt = null;
  try { receipt = JSON.parse(read(files.report)); } catch { /* none */ }
  return {
    res, receipt, sweep, files, before, after: originRefs(b.origin),
    stubs: (read(files.stubLog) ?? "").split("\n").filter(Boolean),
    storeWrites: read(files.storeWrites),
    escalations: read(files.escalations),
    history: read(files.report.replace(/\.json$/, "-history.jsonl")),
  };
}

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
  // Its own registry content: the refused control above has already put its
  // registry commit on origin (the photograph pushes main before the gate).
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
