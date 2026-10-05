// settlement-source-flip.test.mjs — THE ROLLBACK IS A FLIP, AND HERE IS THE PROOF.
//
//   node --test test/settlement-source-flip.test.mjs
//
// ── WHAT IS UNDER TEST ──────────────────────────────────────────────────────
//
// G1 puts a switch in the crossing: `SETTLEMENT_SOURCE=store` folds from the
// register, `SETTLEMENT_SOURCE=git` takes the original path for one crossing.
// The plan of record calls that switch the rollback — "point the fold back at
// git for that crossing" — and the whole swap is scheduled on the strength of
// it. A rollback nobody has exercised is a comment.
//
// The claim my brief states is that with `git`, "the chain is byte-identical to
// the train's". A literal byte comparison of the two SCRIPTS cannot be the
// instrument: this branch adds lines to the file, so that comparison is false by
// construction and would have to be weakened until it passed. What the sentence
// actually means, and the only thing that matters at 05:45Z, is that the
// rollback crossing DOES THE SAME THINGS. So the instrument here is the sequence
// of external commands each script issues — every `git`, `node` and `npm`
// invocation with its full argument list, in order — captured by putting stub
// wrappers ahead of the real binaries on PATH.
//
// The train's script is read out of git from the current open train: by
// default the newest `origin/train/*` ref by name, or `TRAIN_REF` when release
// tooling deliberately pins one. The baseline follows the train instead of a
// calendar literal, so this instrument cannot decay merely because a week turned.
//
// ── THE CAN-FAIL FLIP ───────────────────────────────────────────────────────
//
// F-flip below is the control. It removes the ghost sweep from an otherwise
// identical git crossing and proves the relation check notices the missing safety
// net. A guard that has never been shown to fail is a green light wired to nothing.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "postmark-srcflip-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });
// THE STORE the crossing's household export renders (POS-350): the export reads
// the registry from the store, never the fixture town's printouts, so each
// crossing re-states the store from the town seed first.
import { registryStoreForTowns } from "./helpers/office-under-test.mjs";
const REG = await registryStoreForTowns({ db: "source_flip_test" });
after(() => REG.stop());


const sh = (cmd, opts = {}) => execFileSync("sh", ["-c", cmd], { encoding: "utf8", ...opts });
const has = (cmd) => { try { execFileSync("sh", ["-c", cmd], { stdio: "ignore" }); return true; } catch { return false; } };

// The harness is POSIX-shell shaped. Where `sh` is not a real shell the tests
// SKIP rather than pass — a silent pass on a box that cannot run the crossing is
// the "check reached for something easier than the behaviour" defect.
const SH_OK = has("sh -c 'true'");

// ── "NEWEST BY NAME" IS NOT A STRING SORT, BECAUSE THE WEEK IS NOT PADDED ────
//
// Trains are named `train/YYYY-wNN` with NO zero padding — `tools/train-week-
// check.mjs` writes `train/${year}-w${open}` straight from the number, and the
// live refs read `2026-w35 · 2026-w35b · 2026-w36 … 2026-w39`. Under git's own
// `--sort=-refname` that ordering breaks the moment a year reaches week 10:
//
//   $ git for-each-ref --sort=-refname 'refs/remotes/origin/train/*'
//   origin/train/2027-w9      ← picked
//   origin/train/2027-w2
//   origin/train/2027-w11     ← the actual open train
//   origin/train/2027-w10
//   origin/train/2027-w1
//
// Which is this file's own defect one layer down: a baseline that goes stale
// because the calendar turned. The week is compared as a NUMBER, the year
// before it, and a re-cut suffix (`w35b`) after it, so the order is the order
// trains actually open in. A ref that does not parse as a train name sorts last
// rather than being dropped — it can still be the only one there is.
export function newestTrainRef(refs) {
  const key = (ref) => {
    const m = /(?:^|\/)(\d{4})-w(\d+)([a-z]*)$/.exec(ref);
    return m ? { ok: 1, year: Number(m[1]), week: Number(m[2]), suffix: m[3] } : { ok: 0, year: 0, week: 0, suffix: "" };
  };
  return [...refs].sort((a, b) => {
    const [x, y] = [key(a), key(b)];
    return (y.ok - x.ok) || (y.year - x.year) || (y.week - x.week) || y.suffix.localeCompare(x.suffix);
  })[0];
}

function openTrainRef() {
  const explicit = String(process.env.TRAIN_REF ?? "").trim();
  if (explicit) return explicit;
  const refs = execFileSync("git", [
    "-C", OFFICE, "for-each-ref",
    "--format=%(refname:short)", "refs/remotes/origin/train/*",
  ], { encoding: "utf8" }).split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (!refs.length) throw new Error("no open train ref under refs/remotes/origin/train/*");
  return newestTrainRef(refs);
}

/** The train's shipping script, read from git so this test cannot drift from it. */
function trainScript() {
  return execFileSync("git", ["-C", OFFICE, "show", `${openTrainRef()}:deploy/settlement-auto.sh`], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  });
}

let runSeq = 0;

/**
 * ONE CROSSING, IN A BOTTLE.
 *
 * A bare origin, a settlement clone with a stub sweep that really commits, a
 * town clone with a stub stake deriver, and stub `git`/`node`/`npm` wrappers
 * that LOG their argv and then exec the real thing. The logging wrapper is what
 * turns "did these two scripts behave the same" into a diff.
 */
function crossing(label, script, { env = {}, perturb = null, plant = null, reuse = null } = {}) {
  // `reuse` runs a SECOND crossing in a root a previous one left behind, which is
  // the only way to test what one crossing leaves for the next. Everything below
  // is skipped and the existing world, town and stubs are used as they stand.
  if (reuse) return runCrossing(reuse, script, { env, perturb });
  const root = join(scratch, `${label}-${++runSeq}`);
  const bin = join(root, "bin");
  const origin = join(root, "world.git");
  const sweepClone = join(root, "sweep");
  const townOrigin = join(root, "town.git");
  const townClone = join(root, "town");
  const seed = join(root, "seed");
  const log = join(root, "commands.log");
  const harbor = join(root, "harbor");
  mkdirSync(bin, { recursive: true });
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

  // ── the world: canon on main, one sketchbook, a sweep that publishes ───────
  mkdirSync(join(seed, "WORLD", "marks", "alpha", "published-note"), { recursive: true });
  mkdirSync(join(seed, "tools"), { recursive: true });
  writeFileSync(join(seed, "WORLD", "marks", "alpha", "published-note", "mark.md"),
    "---\nkind: sited\nby: alpha\ndate: 2026-08-01\n---\n\nalpha published this\n");
  // A sweep stub that behaves like the real one where this script touches it: it
  // reads --stakes, commits to main, and prints a six-channel report.
  writeFileSync(join(seed, "tools", "settlement-sweep.mjs"), `
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
const at = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const stakes = JSON.parse(readFileSync(at("--stakes"), "utf8"));
const repo = process.cwd();
const drafts = execFileSync("git", ["-C", repo, "for-each-ref", "--format=%(refname:short)", "refs/heads/draft/", "refs/remotes/origin/draft/"], { encoding: "utf8" })
  .split("\\n").map((l) => l.trim()).filter(Boolean);
// WHAT THE SWEEP SAW, recorded outside the repo so a test can assert on it.
// This is the instrument for the rollback ghost: the question is not what the
// crossing published, it is which sketchbooks reached the fold at all.
writeFileSync(process.env.SWEEP_SAW_OUT, JSON.stringify(drafts.map((d) => d.replace(/^origin\\//, ""))));
const p = join(repo, "WORLD", "swept.txt");
mkdirSync(dirname(p), { recursive: true });
writeFileSync(p, String(drafts.length) + " sketchbook(s) seen; " + stakes.length + " stake row(s)\\n");
execFileSync("git", ["-C", repo, "add", "-A"]);
execFileSync("git", ["-C", repo, "commit", "-qm", "settlement: sweep 1 published"], { env: { ...process.env, GIT_AUTHOR_NAME: "sweep", GIT_AUTHOR_EMAIL: "s@x.invalid", GIT_COMMITTER_NAME: "sweep", GIT_COMMITTER_EMAIL: "s@x.invalid", GIT_AUTHOR_DATE: "2026-09-08T00:00:00Z", GIT_COMMITTER_DATE: "2026-09-08T00:00:00Z" } });
process.stdout.write(JSON.stringify({
  published: ["alpha/one"], unpublished: [], left_drafted: [], withdrawn: [], quarantined: [], dropped: [], rebased: drafts,
  surveyed: { branches: drafts.length, delta_rows: drafts.length, escrow_backed_deltas: 0 },
  sketchbooks_seen: drafts,
}) + "\\n");
`);
  // the harm gate (2026-09-16) is the crossing's refusing gate; a fixture world that
  // carries none is a crossing that cannot gate and refuses, so the bottle answers it
  writeFileSync(join(seed, "tools", "harm-gate.mjs"),
    'process.stdout.write(JSON.stringify({ ok: true, base: "HEAD", before: 1, after: 1, checks: [] }) + "\\n");\n');
  writeFileSync(join(seed, "package.json"), JSON.stringify({ name: "world-fixture", scripts: { test: "node -e \"\"", "test:candle": "node -e \"\"" } }));
  g(".", "init", "-q", "-b", "main", seed);
  g(seed, "config", "user.email", "seed@postmark.invalid");
  g(seed, "config", "user.name", "seed");
  g(seed, "add", "-A");
  g(seed, "commit", "-qm", "canon");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { stdio: "ignore" });
  g(seed, "remote", "add", "origin", origin);
  g(seed, "push", "-q", "origin", "main");
  // One git-era sketchbook on origin — the input the git path folds and the
  // store path must not.
  g(seed, "branch", "draft/alpha", "main");
  g(seed, "push", "-q", "origin", "draft/alpha");
  execFileSync("git", ["clone", "-q", origin, sweepClone], { stdio: "ignore" });
  execFileSync("git", ["-C", sweepClone, "config", "user.email", "sweep@postmark.invalid"], { stdio: "ignore" });
  execFileSync("git", ["-C", sweepClone, "config", "user.name", "sweep"], { stdio: "ignore" });

  // ── the town: a stake deriver AND a household resolver, at a pinned sha ────
  //
  // The resolver arrived 2026-09-09 with the registry refresh. The crossing now
  // derives `WORLD/households.json` from the town at the top of every crossing
  // and REFUSES when it cannot — deliberately, because folding under a registry
  // nobody can vouch for is a wrong publication and a silent one. So a fixture
  // town with no resolver is a town no crossing can cross, and every test in
  // this file would refuse before reaching the behaviour it names.
  //
  // `stamp-mint.mjs` is injected as a fixture module, which is the pattern
  // `src/household-logins.mjs` blesses in its own header: "`engine` is injected
  // — the town's own stamp-mint module — so a falsifier hands in a fixture
  // engine rather than a real town."
  const townSeed = join(root, "town-seed");
  mkdirSync(join(townSeed, "tools"), { recursive: true });
  writeFileSync(join(townSeed, "tools", "world-stake.mjs"),
    'process.stdout.write(JSON.stringify([{ holder: "alpha", mark: "alpha/one", n: 1, weight: 3, tick: 0 }]) + "\\n");\n');
  writeFileSync(join(townSeed, "tools", "github-ids.json"),
    `${JSON.stringify({ alpha: { login: "alpha-hub", id: 1 } }, null, 2)}\n`);
  writeFileSync(join(townSeed, "tools", "stamp-mint.mjs"), `
import { readFileSync } from "node:fs";
import { join } from "node:path";
export function currentHouseholds(clone) {
  const pins = JSON.parse(readFileSync(join(clone, "tools", "github-ids.json"), "utf8"));
  return new Map(Object.entries(pins).map(([handle, rec]) => [handle, { key: "gh:" + rec.id }]));
}
`);
  g(".", "init", "-q", "-b", "main", townSeed);
  g(townSeed, "config", "user.email", "seed@postmark.invalid");
  g(townSeed, "config", "user.name", "seed");
  g(townSeed, "add", "-A");
  g(townSeed, "commit", "-qm", "town");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", townOrigin], { stdio: "ignore" });
  g(townSeed, "remote", "add", "origin", townOrigin);
  g(townSeed, "push", "-q", "origin", "main");
  execFileSync("git", ["clone", "-q", townOrigin, townClone], { stdio: "ignore" });

  // ── the logging stubs ──────────────────────────────────────────────────────
  //
  // Each wrapper appends its full argv to one log and then execs the real
  // binary. That log IS the instrument: two scripts that issue the same
  // commands in the same order did the same thing, whatever their source bytes.
  const realOf = (name) => sh(`command -v ${name}`).trim().split("\n")[0];
  for (const name of ["git", "npm"]) {
    const real = realOf(name);
    writeFileSync(join(bin, name),
      `#!/bin/sh\nprintf '%s' "${name}" >> "$CMDLOG"\nfor a in "$@"; do printf ' %s' "$a" >> "$CMDLOG"; done\nprintf '\\n' >> "$CMDLOG"\nexec "${real}" "$@"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  // `node` is logged but its `-e` bodies are elided: they embed absolute temp
  // paths that differ between two runs by construction, and comparing those
  // would make every run differ for a reason that says nothing about behaviour.
  const realNode = realOf("node");
  writeFileSync(join(bin, "node"),
    `#!/bin/sh\nprintf 'node' >> "$CMDLOG"\nskip=0\nfor a in "$@"; do\n  if [ "$skip" = "1" ]; then skip=0; printf ' <inline>' >> "$CMDLOG"; continue; fi\n  case "$a" in\n    -e) skip=1; printf ' -e' >> "$CMDLOG" ;;\n    /*|*/*) printf ' %s' "$(basename "$a")" >> "$CMDLOG" ;;\n    *) printf ' %s' "$a" >> "$CMDLOG" ;;\n  esac\ndone\nprintf '\\n' >> "$CMDLOG"\nexec "${realNode}" "$@"\n`);
  chmodSync(join(bin, "node"), 0o755);

  // The starting REF STATE, varied by the caller. `F-git`'s perturbation varies
  // a command and always starts from a clean clone, which is exactly why it
  // cannot see the rollback ghost; this hook is the other axis.
  if (plant) plant(root);

  return runCrossing(root, script, { env, perturb });
}

/** The run itself, factored out so a second crossing can reuse a first one's root. */
function runCrossing(root, script, { env = {}, perturb = null } = {}) {
  const sweepClone = join(root, "sweep");
  const townClone = join(root, "town");
  const origin = join(root, "world.git");
  const bin = join(root, "bin");
  const log = join(root, "commands.log");
  const harbor = join(root, "harbor");
  try { rmSync(log, { force: true }); } catch { /* first run */ }

  const scriptPath = join(root, "settlement-auto.sh");
  writeFileSync(scriptPath, perturb ? perturb(script) : script);

  REG.seedFromSync(join(root, "town-seed"));
  const res = spawnSync("sh", [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CMDLOG: log,
      OFFICE_ROOT: OFFICE,
      TOWN_CLONE: townClone,
      WORLD_CLONE: sweepClone,
      SETTLEMENT_CLONE: sweepClone,
      SETTLEMENT_REPORT: join(harbor, "settlement-auto.json"),
      SETTLEMENT_HISTORY: join(harbor, "settlement-auto-history.jsonl"),
      // Set so the retry wrapper does not re-exec the script: the retry is
      // proven by its own falsifier (test/settlement-retry.test.mjs) and a
      // re-exec here would double every line of the command log.
      SETTLEMENT_ATTEMPT: "1",
      WORLD_SINGLE_LOG: "1",
      WORLD_DYNAMIC_DB: join(root, "dynamic.db"),
      SWEEP_SAW_OUT: join(root, "sweep-saw.json"),
      ...REG.env,
      // the store path reaches the candle now (POS-350); this fixture lights none
      SETTLEMENT_CLEARING_WAIT_S: "1",
      ...env,
    },
  });

  let receipt = null;
  try { receipt = JSON.parse(readFileSync(join(harbor, "settlement-auto.json"), "utf8")); } catch { /* none written */ }
  let commands = [];
  try { commands = readFileSync(log, "utf8").split("\n").filter(Boolean); } catch { /* none run */ }

  return { root, sweepClone, origin, res, receipt, commands };
}

/**
 * The command log with every run-specific path removed, so two runs of the same
 * behaviour compare equal. Temp roots, mktemp dirs and shas are all per-run.
 */
function normalize(commands, root) {
  return commands.map((line) => line
    .replaceAll(root.replaceAll("\\", "/"), "<root>")
    .replaceAll(root, "<root>")
    .replace(/\/tmp\/[^\s]*/g, "<tmp>")
    .replace(/[A-Za-z]:[\\/][^\s]*[Tt]emp[\\/][^\s]*/g, "<tmp>")
    .replace(/\b[0-9a-f]{40}\b/g, "<sha>")
    .replace(/\b[0-9a-f]{7,12}\b/g, "<sha>")
    // Path separators last, and on both sequences equally: on Windows the
    // wrappers log `<root>\sweep` where the script's own literals read
    // `<root>/sweep`, so a pattern written either way matches only on one
    // platform. Normalizing here keeps the comparison and the patterns on one
    // spelling instead of doubling every regex.
    .replace(/\\/g, "/"));
}

const GHOST_SWEEP_SENTINEL = /^git -C <root>\/sweep rev-parse main\^\{tree\}$/;
const ghostSweepPresent = (commands, root) =>
  normalize(commands, root).some((c) => GHOST_SWEEP_SENTINEL.test(c));

test("F-git · SETTLEMENT_SOURCE=git matches the open train and runs the ghost sweep", { skip: !SH_OK && "no POSIX sh" }, () => {
  const train = crossing("train", trainScript());
  const branch = crossing("branch", readFileSync(join(OFFICE, "deploy", "settlement-auto.sh"), "utf8"),
    { env: { SETTLEMENT_SOURCE: "git" } });

  assert.equal(train.res.status, 0, `the train's chain must complete in the fixture: ${train.res.stderr}`);
  assert.equal(branch.res.status, 0, `the rollback crossing must complete: ${branch.res.stderr}`);
  assert.ok(train.commands.length > 20,
    `the fixture must actually exercise the chain, not exit early; got ${train.commands.length} commands`);

  // ── THE BASELINE MOVES WITH THE OPEN TRAIN; THE RELATION DOES NOT ────────
  //
  // This used to compare against a calendar-pinned train from before repair 1,
  // so the ghost sweep was expected to appear in `added`. The moment that repair
  // itself reached the next train, the baseline contained it too and the control
  // decayed. The command diff still guards both directions against undeclared
  // drift; the safety relation is asserted independently below, where a week
  // turning cannot make it disappear.
  const trainCmds = normalize(train.commands, train.root);
  const branchCmds = normalize(branch.commands, branch.root);

  // ── THE REGISTRY REFRESH, NAMED COMMAND BY COMMAND (2026-09-09) ───────────
  //
  // The current checkout re-derives `WORLD/households.json` before the fold.
  // If that behaviour is ahead of the open train, these patterns name the allowed
  // delta rather than loosening the comparison. Once the train catches up the list
  // is inert, while the direct presence assertion below still guards the behaviour.
  //
  // `git rev-parse main` appears because the quiet-pass test now asks the SWEEP
  // whether it published, not `main` — the refresh can move main before the fold
  // and a registry-only crossing must still report `quiet`.
  //
  // WRITTEN FROM THE LOG, NOT FROM THE SCRIPT. The `node` wrapper rewrites any
  // path-shaped argument to its basename, so the export's invocation arrives
  // here as `--town town --world registry` and not as the paths the script
  // passes. The first draft of this list guessed the latter and six commands
  // came back unexplained, which is the assertion below doing its job.
  const REGISTRY_REFRESH = [
    /^node world-households-export\.mjs --town town --world registry$/,
    /^node settlement-registry\.mjs --fresh households\.json --world <root>\/sweep --town-sha <sha>$/,
    /^node -e <inline> registry\.json$/,
    /^node -e <inline> registry\.json .*$/,
    /^git -C <root>\/sweep add -- WORLD\/households\.json$/,
    /^git -C <root>\/sweep -c user\.name=the settlement sweep \(box\) -c user\.email=postmark-settlement@users\.noreply\.github\.com commit -q -F <tmp>$/,
    /^git -C <root>\/sweep rev-parse HEAD$/,
    /^git -C <root>\/sweep rev-parse main$/,
  ];

  const GHOST_SWEEP = [
    /^git -C <root>\/sweep rev-parse main\^\{tree\}$/,
    /^git -C <root>\/sweep for-each-ref --format=%\(refname:short\) refs\/heads\/draft\/\*$/,
    /^git -C <root>\/sweep rev-parse --verify -q refs\/remotes\/origin\/draft\//,
    /^git -C <root>\/sweep log -1 --format=%s refs\/heads\/draft\//,
    /^git -C <root>\/sweep rev-parse refs\/heads\/draft\/.*\^\{tree\}$/,
    /^git -C <root>\/sweep update-ref -d refs\/heads\/draft\//,
  ];
  // The collide branch's own commands (`rev-parse refs/remotes/origin/draft/…`
  // and `branch -qf`) are deliberately NOT listed. They do not fire on a clean
  // clone, so they are not "added" here — and `branch -qf` is already something
  // the sync loop issues, so admitting it as a ghost-sweep pattern would let a
  // genuine unexplained one through. F-collide covers that path; this list stays
  // narrow, which is what makes it worth having.

  // ── A COMMAND THAT GREW A FLAG IS NOT A COMMAND THAT MOVED ────────────────
  //
  // The branch hands the sweep `--town-sha`, the registry-freshness pin. That is
  // one ARGUMENT added to a command the train already issues, so the raw multiset
  // difference reports it twice over: the train's spelling as missing and the
  // branch's as added. Reporting it as "the rollback dropped a command" would be
  // false, and the assertion below would have to be weakened to swallow it.
  //
  // So the substitution is declared, as a PAIR, and both halves must match or it
  // is not one: a branch line that matches the second pattern cancels exactly one
  // train line matching the first. Anything else is still missing or added.
  const SUBSTITUTIONS = [
    [/^node settlement-sweep\.mjs --stakes stakes\.json --json$/,
     /^node settlement-sweep\.mjs --stakes stakes\.json --registry-verified-at <sha> --json$/],
  ];

  // Multiset difference both ways, so a reordering or a dropped duplicate shows.
  const minus = (a, b) => { const c = [...b]; return a.filter((x) => { const i = c.indexOf(x); if (i === -1) return true; c.splice(i, 1); return false; }); };
  let missing = minus(trainCmds, branchCmds);
  let added = minus(branchCmds, trainCmds);
  for (const [was, now] of SUBSTITUTIONS) {
    const iWas = missing.findIndex((c) => was.test(c));
    const iNow = added.findIndex((c) => now.test(c));
    if (iWas !== -1 && iNow !== -1) { missing.splice(iWas, 1); added.splice(iNow, 1); }
  }

  assert.deepEqual(missing, [],
    "the rollback must issue every command the train's chain issues — anything missing here is behaviour the "
    + "rollback silently dropped, and the rollback is the hatch reached for when the store path has already gone wrong");

  // POS-352 (2026-10-04): the crossing records its receipt in the store
  // (crossing_receipts, 061) right after it writes the file. Bookkeeping beside
  // the crossing, declared here by name like the two repairs above.
  const CROSSING_RECEIPT = [
    /^node crossing-receipt\.mjs --receipt <root>\/harbor\/settlement-auto\.json --attempt .*$/,
  ];

  const explained = [...GHOST_SWEEP, ...REGISTRY_REFRESH, ...CROSSING_RECEIPT];
  const unexplained = added.filter((c) => !explained.some((re) => re.test(c)));
  assert.deepEqual(unexplained, [],
    "every command the rollback adds must belong to the ghost sweep (repair 1), the registry refresh "
    + `(2026-09-09) or the crossing receipt's record (POS-352). An addition this test cannot name is a change to the crossing nobody declared: ${JSON.stringify(unexplained)}`);
  // Presence is asserted on the crossing itself, never inferred from `added`.
  // Once a repair reaches the open train it correctly vanishes from the delta, but
  // the git-source path must still run it and the store-source path must not.
  assert.ok(ghostSweepPresent(branch.commands, branch.root),
    "and the ghost sweep must actually run, or repair 1 is not in this tree");
  assert.ok(branchCmds.some((c) => REGISTRY_REFRESH.some((re) => re.test(c))),
    "and the registry refresh must actually run — a crossing that folds on whatever WORLD/households.json "
    + "world main happens to carry is the state this whole step exists to end");

  assert.equal(branch.receipt.status, train.receipt.status);
  assert.equal(branch.receipt.source, "git", "and it says which path it took");
});

test("F-flip · removing the ghost sweep makes the relation fail", { skip: !SH_OK && "no POSIX sh" }, () => {
  // The control removes the exact safety net F-git requires. If this no
  // longer goes dark, the relation check has stopped measuring its own claim.
  const train = crossing("flip-train", trainScript());
  const perturbed = crossing("flip-branch", readFileSync(join(OFFICE, "deploy", "settlement-auto.sh"), "utf8"), {
    env: { SETTLEMENT_SOURCE: "git" },
    // Remove the ghost sweep itself: this control falsifies the relation F-git asserts.
    perturb: (s) => s.replace(
      'GHOSTS=0\nKEPT_UNDELIVERED=0\nRESETS=0\nif [ "$SOURCE" = "git" ]; then',
      'GHOSTS=0\nKEPT_UNDELIVERED=0\nRESETS=0\nif false; then',
    ),
  });
  assert.equal(ghostSweepPresent(train.commands, train.root), true,
    "the open train must exercise the ghost sweep in git mode");
  assert.equal(ghostSweepPresent(perturbed.commands, perturbed.root), false,
    "the can-fail control must go red when the ghost sweep is removed");
});

test("F-store · the store path fetches no sketchbook and pushes no draft branch", { skip: !SH_OK && "no POSIX sh" }, () => {
  // The store crossing cannot complete in this fixture — lane 2's entry point
  // does not exist, so `world2/tools/fold-input.mjs` refuses. That refusal IS
  // the assertion here: it must happen, it must be named, and the commands
  // issued before it must contain no sketchbook fetch.
  // AMENDED 2026-10-05 (POS-350): the crossing's household export reads the
  // registry from the STORE, so this suite's crossings hold a store read, and
  // the store path now gets as far as the candle — which this fixture never
  // lights. It refuses there, by name; the wait is shortened so the refusal
  // arrives in a second, not the box's four minutes.
  const store = crossing("store", readFileSync(join(OFFICE, "deploy", "settlement-auto.sh"), "utf8"),
    { env: { SETTLEMENT_SOURCE: "store", SETTLEMENT_CLEARING_WAIT_S: "1" } });

  assert.equal(ghostSweepPresent(store.commands, store.root), false,
    "the store-source chain must not run the rollback ghost sweep");

  const fetches = store.commands.filter((c) => c.includes("fetch"));
  assert.ok(fetches.length > 0, "the crossing still fetches");
  assert.ok(
    fetches.every((c) => !c.includes("refs/heads/*:refs/remotes/origin/*")),
    `the store path must not fetch every ref: ${JSON.stringify(fetches)}`,
  );
  assert.ok(
    fetches.some((c) => c.includes("+refs/heads/main:refs/remotes/origin/main")),
    "it fetches main and only main",
  );
  assert.ok(
    !store.commands.some((c) => /push .*draft\//.test(c)),
    "no draft branch is pushed on the store path",
  );
  assert.ok(
    !store.commands.some((c) => c.includes("world-drain.mjs")),
    "the drain does not run on the store path",
  );

  assert.equal(store.res.status, 1, "with no store entry point the crossing must refuse, not publish");
  assert.equal(store.receipt.status, "refused");
  assert.equal(store.receipt.source, "store", "and the refusal says which path refused");
  assert.match(store.receipt.detail, /entry-point-absent|no-store-credential|clearing-did-not-run/,
    "the refusal names its own reason so the operator is not sent to the wrong repair");
});

// ── F-ghost · THE ROLLBACK'S GHOST (repair 1) ────────────────────────────────
//
// The reviewer's finding, and it points the dangerous way: the store path
// deletes every draft ref before it writes; the git path deleted nothing; and
// the sweep's `draftBranches` returns EVERY local draft ref. So a
// `SETTLEMENT_SOURCE=git` crossing folded the sketchbooks the previous store
// crossing left — 57 of them at S63 — under a receipt saying `source: git`. The
// rollback is the hatch you reach for when the store path has already gone
// wrong, which is exactly when its leftovers are worst.
//
// `F-git` could not see this: both its runs start from a clean clone, and its
// perturbation control varies a command, never the starting ref state. So this
// test varies the starting ref state and nothing else.

/** Put a leftover local sketchbook in the clone before the crossing runs. */
function plantLeftover(root, { branch, subject }) {
  const sweep = join(root, "sweep");
  const g = (...a) => execFileSync("git", ["-C", sweep, ...a], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "store", GIT_AUTHOR_EMAIL: "s@x.invalid",
      GIT_COMMITTER_NAME: "store", GIT_COMMITTER_EMAIL: "s@x.invalid",
      GIT_AUTHOR_DATE: "2026-09-08T00:00:00Z", GIT_COMMITTER_DATE: "2026-09-08T00:00:00Z",
    },
  });
  const main = g("rev-parse", "main").trim();
  const blob = execFileSync("git", ["-C", sweep, "hash-object", "-w", "--stdin"],
    { input: "---\nkind: sited\nby: ghost\ndate: 2026-09-08\n---\n\na leftover\n", encoding: "utf8" }).trim();
  const idx = join(root, `idx-${branch.replace(/\W/g, "")}`);
  execFileSync("git", ["-C", sweep, "read-tree", main], { env: { ...process.env, GIT_INDEX_FILE: idx }, stdio: "ignore" });
  execFileSync("git", ["-C", sweep, "update-index", "--add", "--cacheinfo", `100644,${blob},WORLD/marks/ghost/left-behind/mark.md`],
    { env: { ...process.env, GIT_INDEX_FILE: idx }, stdio: "ignore" });
  const tree = execFileSync("git", ["-C", sweep, "write-tree"], { env: { ...process.env, GIT_INDEX_FILE: idx }, encoding: "utf8" }).trim();
  const c = g("commit-tree", tree, "-p", main, "-m", subject).trim();
  g("update-ref", `refs/heads/${branch}`, c);
  return c;
}

test("F-ghost · a rollback crossing does NOT fold the store's leftover sketchbooks", { skip: !SH_OK && "no POSIX sh" }, () => {
  const script = readFileSync(join(OFFICE, "deploy", "settlement-auto.sh"), "utf8");
  const run = crossing("ghost", script, {
    env: { SETTLEMENT_SOURCE: "git" },
    plant: (root) => plantLeftover(root, {
      branch: "draft/ghosthousehold",
      subject: "store write-down: 3 mark(s) — solo:ghosthousehold (window 178)",
    }),
  });

  assert.equal(run.res.status, 0, `the crossing must complete: ${run.res.stderr}`);
  const seen = JSON.parse(readFileSync(join(run.root, "sweep-saw.json"), "utf8"));
  assert.ok(
    !seen.includes("draft/ghosthousehold"),
    `the sweep must not see the store's leftover; it saw ${JSON.stringify(seen)}`,
  );
  assert.equal(run.receipt.sketchbook_ghosts, 1, "and the receipt counts what it swept up");
  assert.match(run.res.stderr, /a store crossing's leftover sketchbook/);
});

test("F-ghost-control · an UNDELIVERED first drain is kept, not swept", { skip: !SH_OK && "no POSIX sh" }, () => {
  // The control that stops repair 1 from becoming the defect the sync loop
  // exists to prevent. A household drained for the first time whose delivery
  // push failed has its ONLY copy in a twin-less local ref, with its journal
  // rows already truncated. "Delete every twin-less local" would destroy it.
  const script = readFileSync(join(OFFICE, "deploy", "settlement-auto.sh"), "utf8");
  const run = crossing("ghost-keep", script, {
    env: { SETTLEMENT_SOURCE: "git" },
    plant: (root) => plantLeftover(root, {
      branch: "draft/firstdrain",
      subject: "drain: 2 declared, 0 withdrawn — firstdrain (journal seq ≤ 91)",
    }),
  });

  assert.equal(run.res.status, 0, `the crossing must complete: ${run.res.stderr}`);
  const seen = JSON.parse(readFileSync(join(run.root, "sweep-saw.json"), "utf8"));
  assert.ok(
    seen.includes("draft/firstdrain"),
    `an undelivered drain must still reach the sweep; it saw ${JSON.stringify(seen)}`,
  );
  assert.equal(run.receipt.sketchbook_ghosts, 0);
  assert.equal(run.receipt.sketchbook_kept_undelivered, 1, "and the receipt says one was kept, which is its own alarm");
  assert.match(run.res.stderr, /treating it as an undelivered drain/);
});

test("F-store-cleanup · a store crossing leaves no local draft ref behind, even when it refuses", { skip: !SH_OK && "no POSIX sh" }, () => {
  // The other half of repair 1: the store path cleans up on the TRAP, so it runs
  // on every exit including a refusal. The crossing whose leftovers matter most
  // is the one that failed, because that is the one after which somebody reaches
  // for the rollback.
  const script = readFileSync(join(OFFICE, "deploy", "settlement-auto.sh"), "utf8");
  const run = crossing("store-clean", script, {
    env: { SETTLEMENT_SOURCE: "store" },
    plant: (root) => plantLeftover(root, {
      branch: "draft/leftover",
      subject: "store write-down: 1 mark(s) — solo:leftover (window 177)",
    }),
  });

  assert.equal(run.res.status, 1, "with no store entry point the crossing refuses");
  const left = execFileSync("git", ["-C", join(run.root, "sweep"), "for-each-ref", "--format=%(refname)", "refs/heads/draft/"],
    { encoding: "utf8" }).trim();
  assert.equal(left, "", `a refused store crossing must still leave no draft ref; found ${JSON.stringify(left)}`);
});

test("F-sequence · a REAL store crossing followed by a git crossing leaves zero local-only drafts in the survey", { skip: !SH_OK && "no POSIX sh" }, () => {
  // THE REVIEWER'S OWN FALSIFIER, run as the sequence rather than as a planted
  // stand-in. F-ghost plants a synthetic leftover; this one lets a store
  // crossing actually run in the clone and then asks the next git crossing what
  // the sweep saw. It is the stronger shape because nothing about the leftover
  // is invented by the test.
  const script = readFileSync(join(OFFICE, "deploy", "settlement-auto.sh"), "utf8");

  const store = crossing("seq", script, { env: { SETTLEMENT_SOURCE: "store" } });
  assert.equal(store.res.status, 1, "the store crossing refuses in the fixture — there is no store to read");

  const git1 = crossing(null, script, { reuse: store.root, env: { SETTLEMENT_SOURCE: "git" } });
  assert.equal(git1.res.status, 0, `the rollback crossing must complete: ${git1.res.stderr}`);

  const seen = JSON.parse(readFileSync(join(store.root, "sweep-saw.json"), "utf8"));
  const originDrafts = execFileSync("git", ["-C", join(store.root, "sweep"), "for-each-ref",
    "--format=%(refname:short)", "refs/remotes/origin/draft/"], { encoding: "utf8" })
    .split(/\r?\n/).map((l) => l.trim().replace(/^origin\//, "")).filter(Boolean);

  const localOnly = seen.filter((b) => !originDrafts.includes(b));
  assert.deepEqual(localOnly, [],
    `no sketchbook without an origin twin may reach the fold on a rollback; the sweep saw ${JSON.stringify(seen)} `
    + `against origin's ${JSON.stringify(originDrafts)}`);
});

test("F-collide · a store-written local whose name COLLIDES with an origin draft is reset, not pushed", { skip: !SH_OK && "no POSIX sh" }, () => {
  // The residual hole, closed rather than documented. A store-written local with
  // an origin twin skipped the ghost sweep entirely and fell through to the sync
  // loop, which asks only about ancestry — so if origin's draft were an ancestor
  // of main, the store branch (built FROM main) would be AHEAD of it, be classed
  // "undelivered drain", be kept, and be PUSHED by the lease loop. A store render
  // into a git-era sketchbook, on origin.
  //
  // Unreachable on today's world and measured, not assumed: 0 of the 40 origin
  // drafts are ancestors of main at S63. Reachable the first time a fully merged
  // draft is left standing on origin — a green-week merge, or G2's cleanup. This
  // fixture builds that world on purpose, because a test that can only pass is
  // not a test.
  const script = readFileSync(join(OFFICE, "deploy", "settlement-auto.sh"), "utf8");
  // ── THE ASSERTION THAT ACTUALLY SEPARATES THE TWO WORLDS ──────────────────
  //
  // The first version of this test asserted `local === twin` after the crossing,
  // and that is VACUOUS: it is true whether the repair reset the local DOWN to
  // origin's sha or the defect pushed the local UP to origin. Both make them
  // equal. Removing only the reset left this test green; it reddened only when
  // the whole branch went, and then on a stderr regex — a log line, not state.
  //
  // The question is which direction they were made equal in, so the instrument
  // is ORIGIN'S OWN SHA, captured before the crossing: if the repair works,
  // origin still holds the git-era sketchbook it started with; if the defect
  // runs, origin has been moved to the store's render.
  let originBefore = null;
  const run = crossing("collide", script, {
    env: { SETTLEMENT_SOURCE: "git" },
    plant: (root) => {
      // `draft/alpha` HAS an origin twin in this fixture, and the twin is an
      // ancestor of main. A store crossing then wrote over the local name.
      plantLeftover(root, {
        branch: "draft/alpha",
        subject: "store write-down: 2 mark(s) — solo:alpha (window 178)",
      });
      originBefore = execFileSync("git", ["-C", join(root, "world.git"), "rev-parse", "refs/heads/draft/alpha"],
        { encoding: "utf8" }).trim();
    },
  });

  assert.equal(run.res.status, 0, `the crossing must complete: ${run.res.stderr}`);
  const originAfter = execFileSync("git", ["-C", join(run.root, "world.git"), "rev-parse", "refs/heads/draft/alpha"],
    { encoding: "utf8" }).trim();
  assert.equal(originAfter, originBefore,
    "ORIGIN must still hold the git-era sketchbook it started with. If this moved, the store's render was PUSHED up "
    + "into a git-era sketchbook — which is the whole defect, and which also makes local and origin equal, so comparing "
    + "them to each other proves nothing");

  const sweep = join(run.root, "sweep");
  const local = execFileSync("git", ["-C", sweep, "rev-parse", "refs/heads/draft/alpha"], { encoding: "utf8" }).trim();
  assert.equal(local, originBefore,
    "and the local was reset DOWN to that same pre-crossing sha — resetting rather than deleting, because the twin is "
    + "the git era's and has to survive");

  assert.equal(run.receipt.sketchbook_resets, 1, "counted as a RESET");
  assert.equal(run.receipt.sketchbook_ghosts, 0,
    "and NOT as a ghost: a ghost is a leftover deleted, a reset is a scratch taken off a twin that survives, and one "
    + "number for both would hide whichever was smaller");
});

test("F-default · with NO env at all the chain takes the GIT path — the swap is never a default", { skip: !SH_OK && "no POSIX sh" }, () => {
  // The deploy condition. This shipped as `:-store` for eight laps, so the first
  // office tag to land on the box would have flipped the 05:45Z crossing to the
  // store path by default — with the preconditions unsettled, or refusing loudly
  // for want of a store credential, which is a dark crossing either way. Nobody
  // would have decided that. They would have discovered it.
  //
  // Asserted on BEHAVIOUR rather than on the literal, because a test that greps
  // the script for `:-git` would pass over a second assignment further down.
  const script = readFileSync(join(OFFICE, "deploy", "settlement-auto.sh"), "utf8");
  const run = crossing("default", script, {});   // no SETTLEMENT_SOURCE at all

  assert.equal(run.res.status, 0, `an un-armed box must cross exactly as it does today: ${run.res.stderr}`);
  assert.equal(run.receipt.source, "git", "the receipt says which path it took, and it must say git");
  assert.equal(run.receipt.store.ran, false, "the store step did not run");
  assert.ok(
    run.commands.some((c) => c.includes("world-drain.mjs")),
    "and the drain DID run — this is the today-path, unchanged, not merely a store path that declined",
  );
});

test("F-armed · SETTLEMENT_SOURCE=store is what arms it, and nothing else", { skip: !SH_OK && "no POSIX sh" }, () => {
  // The control for F-default. Without it, F-default passes for a script that
  // can no longer reach the store path at all.
  const script = readFileSync(join(OFFICE, "deploy", "settlement-auto.sh"), "utf8");
  const run = crossing("armed", script, { env: { SETTLEMENT_SOURCE: "store" } });
  assert.equal(run.receipt.source, "store");
  assert.ok(
    !run.commands.some((c) => c.includes("world-drain.mjs")),
    "the drain does not run on the store path",
  );
});

test("F-mode · an unrecognised SETTLEMENT_SOURCE refuses rather than defaulting", { skip: !SH_OK && "no POSIX sh" }, () => {
  // A typo taking the git path silently would publish a git fold under whatever
  // the receipt claimed. This is the cheapest guard in the lane and the one
  // whose absence is hardest to notice.
  const bad = crossing("mode", readFileSync(join(OFFICE, "deploy", "settlement-auto.sh"), "utf8"),
    { env: { SETTLEMENT_SOURCE: "stroe" } });
  assert.equal(bad.res.status, 1);
  assert.match(bad.res.stderr, /is not `store` or `git`/);
  assert.ok(!bad.commands.some((c) => c.includes("world-drain.mjs")),
    "it refuses before touching anything");
});

// ── F-newest · THE DERIVATION ITSELF, ON THE WEEK IT WOULD HAVE DECAYED ──────
//
// The rest of this file reads the open train out of git. That derivation is the
// one thing here no crossing fixture can falsify, because today's refs (w35…w39)
// happen to order correctly under any comparator. This test hands it the refs a
// January does: it needs no repo, no shell, and no crossing, and it is the only
// place the "newest train" claim is actually measured.
test("F-newest · the open train is the newest by WEEK, not by string — the 2027-w9-beats-w11 decay", () => {
  // Verified against git itself: `for-each-ref --sort=-refname` returns this set
  // as w9, w2, w11, w10, w1 — the stale baseline first.
  assert.equal(
    newestTrainRef([
      "origin/train/2027-w1", "origin/train/2027-w2", "origin/train/2027-w9",
      "origin/train/2027-w10", "origin/train/2027-w11",
    ]),
    "origin/train/2027-w11",
    "week 11 is open; a string sort picks week 9 and this instrument goes back to comparing against a stale train",
  );

  // The year outranks the week, or the first train of a new year loses to the
  // last of the old one.
  assert.equal(
    newestTrainRef(["origin/train/2026-w52", "origin/train/2027-w1"]),
    "origin/train/2027-w1",
  );

  // A re-cut train is newer than the week it re-cuts. `2026-w35b` is a real ref
  // in this repo, so this is the live shape, not a hypothetical one.
  assert.equal(
    newestTrainRef(["origin/train/2026-w35", "origin/train/2026-w35b"]),
    "origin/train/2026-w35b",
  );

  // Today's actual refs still resolve the way they did before this repair.
  assert.equal(
    newestTrainRef([
      "origin/train/2026-w35", "origin/train/2026-w35b", "origin/train/2026-w36",
      "origin/train/2026-w37", "origin/train/2026-w38", "origin/train/2026-w39",
    ]),
    "origin/train/2026-w39",
  );

  // A name this cannot parse is sorted last rather than dropped — it can still
  // be the only ref there is, and an unusable answer beats no answer at all.
  assert.equal(newestTrainRef(["origin/train/hotfix"]), "origin/train/hotfix");
  assert.equal(
    newestTrainRef(["origin/train/hotfix", "origin/train/2026-w39"]),
    "origin/train/2026-w39",
  );
});
