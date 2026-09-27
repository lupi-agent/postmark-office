// Falsifiers for the LAW PEN'S OWN CLOCK — postmark#2893, founder-ruled
// 2026-09-19 ("split for now is good").
//
// ── WHAT IS BEING HELD, AND WHY IT IS WORTH A SUITE ─────────────────────────
// `deploy/world2-ingest.sh` carries both projection pens: `law-ingest` (the
// rulebook → law_projection + identities) and `stamp-ingest` (the ledger →
// stamp_projection). Its unit, postmark-world2-ingest.timer, is PARKED at the
// founder's word of 2026-08-31 — and the law pen is the only writer of
// law_projection anywhere in the office, so the park froze the rulebook copy:
// a23a8d17 (09-05) → one hand-run to 1688a5af (09-17) → 37 commits behind world
// main by 09-19. The split gives the law pen its own unit, and the split IS the
// mode argument. One copy of each pen; one script; a word on the command line.
//
// That makes the dispatch the load-bearing line in the change. If `law` ever
// runs the stamp pen too, this lane silently re-adopts the rail the founder
// parked — and it would do so while every surface still said PARKED, which is
// the exact failure shape #2893 is about.
//
// ── THREE ARMS, INCREASING IN STRENGTH ──────────────────────────────────────
//   1. STATIC   — parse the shipped `case` block; assert each arm's flags and
//                 that the unknown-mode arm refuses. Needs nothing but the file.
//   2. UNIT     — read the shipped .service/.timer: ExecStart names the mode,
//                 the timer keeps the parked poll's marks, and the parked
//                 unit's own files are NOT rewritten to carry a mode.
//   3. EXECUTED — run the WHOLE shipped script under bash against a stubbed
//                 tree: a stub `node` on PATH that logs its argv, a stub
//                 refresh-clone that prints a 40-char sha, and the PG password
//                 handed in through the environment (w2_secret reads the env
//                 first, so no credential file is opened). This is the only arm
//                 that proves which PEN FILE was invoked rather than which
//                 variable was set.
//
// bash is not a dependency the rest of this suite has, so arm 3 SKIPS with its
// reason printed when bash is absent — never silently, and never by weakening
// arms 1 and 2.
//
// THE FLIP, run before this file was committed: collapse the dispatch so every
// mode sets RUN_LAW=1 and RUN_STAMPS=1 (the pre-split behaviour). Arms 1 and 3
// go red; arm 2 stays green, which is correct and is why arm 3 exists.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, chmodSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOY = join(ROOT, "deploy");
const SCRIPT = join(DEPLOY, "world2-ingest.sh");
const SOURCE = readFileSync(SCRIPT, "utf8");

/**
 * The mode `case … esac`, sliced out of the shipped file by its own opening
 * words rather than by line number — a line number goes stale the first time
 * somebody adds a comment above it, and a test that then slices the wrong
 * region passes for the wrong reason.
 */
function modeBlock(source = SOURCE) {
  const start = source.indexOf('case "${1:-both}" in');
  assert.notEqual(start, -1,
    'the shipped script no longer opens its mode dispatch with `case "${1:-both}" in` — ' +
    "this test is slicing a region that has moved, and its greens would mean nothing");
  const end = source.indexOf("\nesac", start);
  assert.notEqual(end, -1, "the mode dispatch has no closing `esac` after it");
  return source.slice(start, end + "\nesac".length);
}

/** The `RUN_LAW`/`RUN_STAMPS`/`STATE` a named arm sets. */
function armOf(name, block = modeBlock()) {
  const line = block.split("\n").find((l) => l.trim().startsWith(`${name})`));
  assert.ok(line, `the mode dispatch has no \`${name})\` arm any more`);
  const num = (key) => {
    const m = new RegExp(`${key}=(\\d+)`).exec(line);
    assert.ok(m, `the \`${name})\` arm no longer sets ${key}: ${line.trim()}`);
    return Number(m[1]);
  };
  const state = /STATE=([\w.-]+)/.exec(line);
  assert.ok(state, `the \`${name})\` arm names no STATE file: ${line.trim()}`);
  return { law: num("RUN_LAW"), stamps: num("RUN_STAMPS"), state: state[1] };
}

// ── ARM 1: the shipped dispatch, read ───────────────────────────────────────

test("STATIC: `law` runs the law pen and not the ledger pen", () => {
  const arm = armOf("law");
  assert.equal(arm.law, 1, "the law mode would not run the law pen");
  assert.equal(arm.stamps, 0,
    "the law mode would ALSO run stamp-ingest — that re-adopts the rail the founder parked " +
    "on 2026-08-31, on a unit whose every surface still says PARKED (postmark#2893)");
});

test("STATIC: `stamps` runs the ledger pen and not the law pen", () => {
  const arm = armOf("stamps");
  assert.equal(arm.law, 0);
  assert.equal(arm.stamps, 1);
});

test("STATIC: no argument is both pens — today's behaviour, unchanged", () => {
  const arm = armOf("both");
  assert.equal(arm.law, 1);
  assert.equal(arm.stamps, 1);
  assert.equal(arm.state, "ingest.json",
    "the no-argument run stopped writing the state file it has always written; " +
    "the parked unit's ExecStart takes no argument and this is its receipt");
  assert.match(modeBlock(), /case "\$\{1:-both\}" in/,
    "the dispatch's default stopped being `both` — a bare run would change behaviour");
});

test("STATIC: each mode writes its OWN state file", () => {
  // Not tidiness. A roll-call heartbeat must be able to say which thing it
  // measured: one shared path would let the law row go green on a run that was
  // not the law pen's, race two units on the same `mv -f`, and overwrite the
  // parked rail's 2026-09-17 receipt every fifteen minutes.
  const files = ["law", "stamps", "both"].map((m) => armOf(m).state);
  assert.equal(new Set(files).size, 3, `two modes share a state file: ${files.join(", ")}`);
  assert.equal(armOf("law").state, "ingest-law.json",
    "the law mode's state file is the path box-rollcall-manifest.json's law row reads as its heartbeat");
});

test("STATIC: an unknown mode REFUSES with exit 2 rather than defaulting to both", () => {
  const block = modeBlock();
  const star = block.split("\n").find((l) => l.trim().startsWith("*)"));
  assert.ok(star, "the mode dispatch has no `*)` arm — an unknown word would fall through silently");
  assert.match(star, /exit 2/,
    "an unknown mode does not exit 2. This is the carry check: a box whose ops copy PREDATES " +
    "the mode argument ignores `law` and runs BOTH pens, and `world2-ingest.sh nonsense` " +
    "returning 2 is how an operator proves the carry landed (DEPLOY.md § Install)");
});

// ── ARM 2: the shipped units ────────────────────────────────────────────────

test("UNIT: the law unit's ExecStart names the law mode", () => {
  const unit = readFileSync(join(DEPLOY, "postmark-world2-law-ingest.service"), "utf8");
  const exec = unit.split("\n").find((l) => l.startsWith("ExecStart="));
  assert.ok(exec, "the law unit has no ExecStart");
  assert.match(exec, /world2-ingest\.sh law$/,
    `the law unit does not pass \`law\` to the script, so it runs BOTH pens: ${exec}`);
});

test("UNIT: the law timer keeps the parked poll's marks", () => {
  const timer = readFileSync(join(DEPLOY, "postmark-world2-law-ingest.timer"), "utf8");
  assert.match(timer, /^OnCalendar=\*-\*-\* \*:04,19,34,49:00 UTC$/m,
    "the law timer moved off :04/:19/:34/:49 — those marks are deliberately clear of the " +
    ":07/:22/:37/:52 that office-rehydrate and stripe-watch occupy, and a new cadence here " +
    "would be a second decision riding along with a ruling that was only about the split");
  assert.match(timer, /^Persistent=false$/m);
});

test("UNIT: the PARKED poll's own files are untouched — it still takes no argument", () => {
  // The ruling was "split", not "re-shape the parked unit". If this ever reds,
  // somebody edited the rail the founder parked while fixing the one he didn't.
  const parked = readFileSync(join(DEPLOY, "postmark-world2-ingest.service"), "utf8");
  const exec = parked.split("\n").find((l) => l.startsWith("ExecStart="));
  assert.match(exec, /world2-ingest\.sh$/,
    `the parked unit's ExecStart grew an argument: ${exec}`);
});

test("UNIT: the roll-call's law row reads the law pen's own state file", () => {
  const manifest = JSON.parse(readFileSync(join(DEPLOY, "box-rollcall-manifest.json"), "utf8"));
  const row = manifest.units.find((r) => r.unit === "postmark-world2-law-ingest.timer");
  assert.ok(row, "box-rollcall-manifest.json has no row for the law pen's timer — the checker " +
    "globs the box and would report ALARM-unmanifested for it");
  assert.equal(row.stage, "live");
  assert.equal(row.heartbeat.path, `/srv/world2-lab/state/${armOf("law").state}`,
    "the law row's heartbeat and the law mode's state file have drifted apart — the roll-call " +
    "would be watching a path nothing writes, which reads as ALARM forever or green forever " +
    "depending on which file it landed on");
  const parked = manifest.units.find((r) => r.unit === "postmark-world2-ingest.timer");
  assert.equal(parked.stage, "parked", "the split must not un-park the original unit");
  assert.notEqual(parked.heartbeat, row.heartbeat);
});

// ── ARM 3: the shipped script, executed ─────────────────────────────────────

/**
 * Run the WHOLE shipped script against a stubbed tree and return the pen files
 * it invoked, in order, plus its exit code and the state files it wrote.
 */
function runShipped(mode) {
  const dir = mkdtempSync(join(tmpdir(), "w2-ingest-modes-"));
  const ops = join(dir, "ops"), bin = join(dir, "bin"), lab = join(dir, "lab");
  for (const d of [ops, bin, lab, join(lab, "state"), join(dir, "office")]) mkdirSync(d, { recursive: true });

  // The shipped script and the library it sources, verbatim.
  for (const f of ["world2-ingest.sh", "world2-lib.sh"]) {
    writeFileSync(join(ops, f), readFileSync(join(DEPLOY, f)));
  }
  // A refresh-clone that always succeeds, printing a 40-char sha on its last line.
  const SHA = "0".repeat(40);
  writeFileSync(join(ops, "world2-refresh-clone.sh"), `#!/bin/bash\necho ${SHA}\n`);
  // A `node` that records which pen it was asked to run and exits 0 — the pen
  // that did not really run. A `--blessed` run is logged with its flag, so the
  // law mode's two law-ingest runs can be told apart (POS-270).
  const log = join(dir, "calls.log");
  writeFileSync(join(bin, "node"), `#!/bin/bash\ncase " $* " in *" --blessed "*) printf '%s --blessed\\n' "$1" ;; *) printf '%s\\n' "$1" ;; esac >> ${JSON.stringify(log)}\necho stubbed-pen-ok\nexit 0\n`);
  for (const f of ["world2-refresh-clone.sh", "world2-ingest.sh", "world2-lib.sh"]) chmodSync(join(ops, f), 0o755);
  chmodSync(join(bin, "node"), 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    WORLD2_LAB: lab,
    WORLD2_OFFICE: join(dir, "office"),
    // w2_secret reads the environment BEFORE the credential file, so nothing
    // here opens /etc/postmark-world2-dev.env. That is deliberate: a test that
    // needed a real secret would be a test nobody could run.
    WORLD2_ENV_FILE: join(dir, "no-such-env-file"),
    PG_LAW_INGESTER_PASSWORD: "stub-not-a-secret",
    WORLD2_DB: "stubdb",
  };

  let code = 0;
  try {
    execFileSync("bash", [join(ops, "world2-ingest.sh"), ...(mode ? [mode] : [])], { env, stdio: "pipe" });
  } catch (err) {
    code = err.status ?? 1;
  }
  const pens = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
  const state = JSON.parse(readFileSync(join(lab, "state", mode === "law" ? "ingest-law.json"
    : mode === "stamps" ? "ingest-stamps.json" : "ingest.json"), "utf8"));
  rmSync(dir, { recursive: true, force: true });
  return { code, pens, state };
}

function bashAvailable() {
  try { execFileSync("bash", ["-c", "exit 0"], { stdio: "ignore" }); return true; }
  catch { return false; }
}

test("EXECUTED: `law` invokes law-ingest.mjs and never stamp-ingest.mjs", (t) => {
  if (!bashAvailable()) {
    t.skip("bash is not on PATH here, so the shipped script cannot be executed — the static " +
      "arms above still bound the dispatch, but nothing here proves which pen file runs");
    return;
  }
  const { code, pens, state } = runShipped("law");
  assert.equal(code, 0, "the law mode did not exit 0 against a stubbed tree where both pens succeed");
  assert.deepEqual(pens, ["world2/tools/law-ingest.mjs", "world2/tools/law-ingest.mjs --blessed"],
    `the law mode invoked ${pens.length} pen(s): ${pens.join(", ")} — anything but law-ingest (main, then ` +
    "the blessed sha) re-adopts the rail the founder parked on 2026-08-31 or drops the office's blessed law");
  assert.equal(state.mode, "law");
  assert.equal(state.law.sha, "0".repeat(40));
  assert.equal(state.law_blessed.sha, "0".repeat(40), "the blessed run's receipt is missing from the law state");
  assert.equal(state.stamp, undefined,
    "the law mode's state carries a `stamp` line for a pen that did not run — a zero-exit line " +
    "that reads like a receipt is worse than no line");
});

test("EXECUTED: `stamps` invokes stamp-ingest.mjs and never law-ingest.mjs", (t) => {
  if (!bashAvailable()) { t.skip("bash is not on PATH here"); return; }
  const { code, pens, state } = runShipped("stamps");
  assert.equal(code, 0);
  assert.deepEqual(pens, ["world2/tools/stamp-ingest.mjs"]);
  assert.equal(state.mode, "stamps");
  assert.equal(state.law, undefined);
});

test("EXECUTED: no argument invokes both pens, law first — the parked unit's behaviour, unchanged", (t) => {
  if (!bashAvailable()) { t.skip("bash is not on PATH here"); return; }
  const { code, pens, state } = runShipped(null);
  assert.equal(code, 0);
  assert.deepEqual(pens, ["world2/tools/law-ingest.mjs", "world2/tools/stamp-ingest.mjs"],
    "a bare run stopped being both pens in that order — that is the ExecStart the PARKED unit " +
    "still carries, and the day it is resumed it must do what its row says it does");
  assert.equal(state.mode, "both");
  assert.equal(state.status, "ok");
  assert.ok(state.law && state.stamp, "a bare run's state lost a pen's line");
  assert.equal(state.law_blessed, undefined, "the parked unit's bare run grew a blessed pass it never had");
});

test("EXECUTED: an unknown mode exits 2 and writes no state at all", (t) => {
  if (!bashAvailable()) { t.skip("bash is not on PATH here"); return; }
  // Deliberately not through runShipped: the point is that NOTHING is written,
  // so there is no state file to read back.
  const dir = mkdtempSync(join(tmpdir(), "w2-ingest-badmode-"));
  mkdirSync(join(dir, "lab", "state"), { recursive: true });
  writeFileSync(join(dir, "world2-lib.sh"), readFileSync(join(DEPLOY, "world2-lib.sh")));
  writeFileSync(join(dir, "world2-ingest.sh"), readFileSync(join(DEPLOY, "world2-ingest.sh")));
  let code = 0, stderr = "";
  try {
    execFileSync("bash", [join(dir, "world2-ingest.sh"), "stamp"], {
      env: { ...process.env, WORLD2_LAB: join(dir, "lab") }, stdio: "pipe",
    });
  } catch (err) { code = err.status ?? 1; stderr = String(err.stderr ?? ""); }
  assert.equal(code, 2, "an unknown mode did not exit 2 — `stamp` is the singular somebody will type");
  assert.match(stderr, /usage: world2-ingest\.sh \[law\|stamps\|both\]/);
  rmSync(dir, { recursive: true, force: true });
});
