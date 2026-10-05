// tick-and-ferry-whole-or-nothing.test.mjs — POS-295 A: the tick's mint
// catch-up and the ferry's crossing either land whole or leave nothing.
//
//   node --test --test-timeout=180000 test/tick-and-ferry-whole-or-nothing.test.mjs
//
// ── THE INCIDENT THESE WATCH ────────────────────────────────────────────────
//
// 2026-09-28, 18:37Z: the office tick's welcome pass appended Corey's welcome
// to the town ledger. The verify after it failed on an OLDER committed line
// (Wildcat's, red since 13:59Z), the `&&` chain skipped the commit, and nothing
// put the file back. The town clone stayed dirty until 23:31Z and every office
// write that pulls it refused. The ferry's chain had the same shape: a gate that
// refuses after a write left that step's rows on disk until the next crossing's
// opening `reset --hard`, twelve hours later.
//
// ── WHAT RUNS HERE ──────────────────────────────────────────────────────────
//
// The SHIPPED TEXT of both, not a copy of their logic: `deploy/office-keep.sh` (the keeping half of the tick since POS-268's split)
// read from disk and run whole, and the ferry's `ExecStart` script lifted out of
// `deploy/postmark-ferry.service` the way systemd joins it. The one edit is the
// path: `/srv/postmark-office` becomes a fixture office root (and the ferry's
// `/usr/bin/node` becomes `node`), counted so a moved path fails loudly.
//
// Each run gets its own scratch town: a bare origin plus a clone, never the
// office tree's pinned town-clone and never the box's. The town's tools in it
// are STUBS, and on purpose: what is under test is the shell's control flow
// around them. Each stub keeps the one contract the shell reads from the real
// tool: `stamp-verify` reads the working-tree ledger and exits 1 on a bad line
// (here, any line carrying RED); `stamp-mint --append` and the welcome pass
// append to that file; `ferry.mjs` commits and pushes its own delivery, as the
// real one does (town tools/ferry.mjs, `git: committed`).
//
// Runs under `dash` where it exists (the box's /bin/sh), else `sh`; where
// neither is a real shell the file SKIPS rather than passes.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "postmark-whole-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });

const works = (shell) => spawnSync(shell, ["-c", "true"], { stdio: "ignore" }).status === 0;
const SH = works("dash") ? "dash" : works("sh") ? "sh" : null;
const skip = SH ? false : "no POSIX shell on this machine";
const fwd = (p) => p.replace(/\\/g, "/");

const LEDGER = "WHITE_PAGES/stamp-ledger.md";
const GIT_ENV = {
  GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@postmark.invalid",
  GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@postmark.invalid",
};

// ── the town's tools, stubbed to their shell-facing contract ────────────────
const CALLS = `
import { appendFileSync } from "node:fs";
export const call = (name) => { if (process.env.STUB_CALLS) appendFileSync(process.env.STUB_CALLS, name + "\\n"); };
`;
const APPEND = `
import { appendFileSync } from "node:fs";
export const append = (file, rows) => { for (const r of String(rows).split("|")) appendFileSync(file, r + "\\n"); };
`;
const TOWN_TOOLS = {
  "tools/stub-calls.mjs": CALLS,
  "tools/stub-append.mjs": APPEND,
  "tools/stamp-verify.mjs": `
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { call } from "./stub-calls.mjs";
call("verify");
const n = existsSync(process.env.STUB_VERIFY_COUNT) ? Number(readFileSync(process.env.STUB_VERIFY_COUNT, "utf8")) + 1 : 1;
writeFileSync(process.env.STUB_VERIFY_COUNT, String(n));
if (process.env.STUB_VERIFY_HANG === String(n)) {
  writeFileSync(process.env.STUB_HANG_MARK, "hanging");
  await new Promise((r) => setTimeout(r, 8000));
}
const bad = readFileSync("${LEDGER}", "utf8").split("\\n").findIndex((l) => l.includes("RED"));
if (bad !== -1) { console.log("✗ stamp-ledger verification FAILED:\\n  - line " + (bad + 1) + ": RED"); process.exit(1); }
console.log("✓ stamp-ledger verified");
`,
  "tools/stamp-mint.mjs": `
import { call } from "./stub-calls.mjs";
import { append } from "./stub-append.mjs";
call("mint " + process.argv.slice(2).filter((a) => a.startsWith("--") && a !== "--key").join(" "));
if (process.env.STUB_APPEND) append("${LEDGER}", process.env.STUB_APPEND);
`,
  "tools/ferry.mjs": `
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { call } from "./stub-calls.mjs";
call("ferry");
if (process.env.STUB_FERRY_DELIVER) {
  mkdirSync("WHITE_PAGES/inbox", { recursive: true });
  writeFileSync("WHITE_PAGES/inbox/" + process.env.STUB_FERRY_DELIVER + ".md", "a delivered letter\\n");
  execFileSync("git", ["add", "WHITE_PAGES/inbox"]);
  execFileSync("git", ["commit", "-qm", "ferry: crossing"]);
  execFileSync("git", ["push", "-q"]);
}
`,
  "tools/ballot-pass.mjs": `
import { mkdirSync, writeFileSync } from "node:fs";
import { call } from "./stub-calls.mjs";
import { append } from "./stub-append.mjs";
call("ballot");
if (process.env.STUB_BALLOT) {
  append("${LEDGER}", process.env.STUB_BALLOT);
  mkdirSync("WHITE_PAGES/office/outbox", { recursive: true });
  writeFileSync("WHITE_PAGES/office/outbox/ballot-receipt.md", "your ballot was counted\\n");
}
`,
  "tools/quest-progress.mjs": `
import { writeFileSync } from "node:fs";
import { call } from "./stub-calls.mjs";
call("quests");
if (process.env.STUB_QUESTS) writeFileSync("TOWN_BULLETIN/quests.md", process.env.STUB_QUESTS + "\\n");
`,
  "PROJECTS/the-town-seal/seal.mjs": `
import { writeFileSync } from "node:fs";
import { call } from "../../tools/stub-calls.mjs";
call("seal");
if (process.env.STUB_SEAL) writeFileSync("PROJECTS/the-town-seal/seal.json", JSON.stringify({ seal: process.env.STUB_SEAL }) + "\\n");
`,
  "PROJECTS/the-town-seal/verify.mjs": `
import { call } from "../../tools/stub-calls.mjs";
call("seal-verify");
process.exit(Number(process.env.STUB_SEAL_VERIFY_EXIT || 0));
`,
  "TOWN_BULLETIN/quests.md": "quests at the founding\n",
  "PROJECTS/the-town-seal/seal.json": "{\"seal\":\"founding\"}\n",
  "PROJECTS/the-town-seal/the-town-seal.html": "<p>founding</p>\n",
};

// ── the office's side, stubbed where the tick and the ferry call it ─────────
const OFFICE_FILES = {
  "stamp-key.pem": "not a key\n",
  "deploy/settle-pass.mjs": `
import { appendFileSync } from "node:fs";
if (process.env.STUB_CALLS) appendFileSync(process.env.STUB_CALLS, "settle\\n");
process.exit(Number(process.env.STUB_SETTLE_EXIT || 0));
`,
  "deploy/welcome-pass.mjs": `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const town = process.argv[process.argv.indexOf("--town") + 1];
if (process.env.STUB_CALLS) appendFileSync(process.env.STUB_CALLS, "welcome\\n");
if (process.env.STUB_WELCOME) appendFileSync(join(town, "${LEDGER}"), process.env.STUB_WELCOME + "\\n");
if (process.env.STUB_WELCOME_MAKES) {
  const p = join(town, process.env.STUB_WELCOME_MAKES);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, "made by the pass\\n");
}
process.exit(Number(process.env.STUB_WELCOME_EXIT || 0));
`,
  "tools/town-drain-run.mjs": `process.exit(Number(process.env.STUB_DRAIN_EXIT || 0));\n`,
  // POS-347: the standing drain renders the town's standing ledger from the
  // store; this tick has no store, and the drain is non-fatal either way.
  "tools/standing-drain.mjs": `process.exit(0);\n`,
  // POS-353: the gangway drain, the same shape.
  "tools/gangway-drain.mjs": `process.exit(0);\n`,
  "world2/tools/settlements-backfill.mjs": `console.log("0 rows written");\n`,
  "src/hydrate.mjs": `
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[process.argv.indexOf("--db") + 1], "hydrated\\n");
`,
  "src/world-hydrate.mjs": `
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[process.argv.indexOf("--db") + 1], "hydrated\\n");
`,
  // The keeping tick's last step and the witness that it ran past the lock: the
  // hydrates moved to the rehydrate unit in POS-268's split, so office.db is no
  // longer this script's to write.
  "deploy/publish-windows.mjs": `
import { writeFileSync } from "node:fs";
writeFileSync("panes-published", "yes\\n");
`,
};

const BIN = {
  // The lock is the box's; one run at a time here, so it only has to succeed.
  flock: "#!/bin/sh\nexit 0\n",
  // The door answers with what the snapshot holds, so the receipt loop ends at once.
  curl: `#!/bin/sh\nprintf 'HTTP/1.1 200 OK\\r\\nX-Postmark-As-Of: %s\\r\\n\\r\\n' "$(git -C "$TOWN_CLONE" rev-parse HEAD)"\n`,
};

let seq = 0;
const write = (root, files) => {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
};

/** A scratch town (bare origin + a clone) and an office root. `ledger` is the committed ledger. */
function fixture(ledger) {
  const root = join(scratch, `run-${++seq}`);
  const origin = join(root, "town.git");
  const seed = join(root, "seed");
  const town = join(root, "town");
  const office = join(root, "office");
  const bin = join(root, "bin");
  const g = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...GIT_ENV } });

  write(seed, { ...TOWN_TOOLS, [LEDGER]: ledger.map((l) => `${l}\n`).join("") });
  // Byte-exact on every platform: a CRLF checkout would read as a dirty clone.
  g("init", "-q", "-b", "main", seed);
  g("-C", seed, "config", "core.autocrlf", "false");
  g("-C", seed, "add", "-A");
  g("-C", seed, "commit", "-qm", "founding");
  g("init", "-q", "--bare", "-b", "main", origin);
  g("-C", seed, "push", "-q", origin, "main");
  g("clone", "-q", "-c", "core.autocrlf=false", origin, town);
  g("-C", town, "config", "user.email", "pen@postmark.invalid");
  g("-C", town, "config", "user.name", "pen");
  write(office, OFFICE_FILES);
  write(bin, BIN);
  return { root, origin, town, office, bin, g };
}

function envFor(fx, extra) {
  return {
    ...process.env,
    ...GIT_ENV,
    PATH: `${fx.bin}${delimiter}${process.env.PATH}`,
    TOWN_CLONE: fwd(fx.town),
    WORLD_CLONE: fwd(fx.town),
    TOWN_LOCK: fwd(join(fx.root, "town.lock")),
    STUB_CALLS: join(fx.root, "calls.txt"),
    STUB_VERIFY_COUNT: join(fx.root, "verify-count.txt"),
    STUB_HANG_MARK: join(fx.root, "hanging"),
    ...extra,
  };
}

/** The shipped tick, with its office root moved into the fixture. */
function tickScript(fx) {
  const text = readFileSync(join(OFFICE, "deploy", "office-keep.sh"), "utf8");
  const hits = text.split("/srv/postmark-office").length - 1;
  assert.ok(hits >= 4, `the tick names /srv/postmark-office ${hits} time(s); the key (x2), the welcome pass and the lock were expected`);
  const out = join(fx.root, "office-keep.sh");
  writeFileSync(out, text.replaceAll("/srv/postmark-office", fwd(fx.office)));
  return out;
}

/** The ferry's ExecStart, joined the way systemd joins it, and its sh -c payload. */
function ferryPayload() {
  const unit = readFileSync(join(OFFICE, "deploy", "postmark-ferry.service"), "utf8");
  const line = unit.replace(/\\\n/g, " ").split("\n").find((l) => l.startsWith("ExecStart="));
  assert.ok(line, "the ferry unit has no ExecStart");
  const m = /\/bin\/sh -c '([^']*)'\s*$/.exec(line);
  assert.ok(m, "the ExecStart is no longer `flock … /bin/sh -c '<script>'`");
  return m[1];
}

function ferryScript(fx) {
  const payload = ferryPayload();
  assert.ok(payload.includes("/srv/postmark-office/tools/town-drain-run.mjs") && payload.includes("/usr/bin/node"),
    "the ferry's drain path moved; the fixture root substitution would miss it");
  return payload.replaceAll("/usr/bin/node", "node").replaceAll("/srv/postmark-office", fwd(fx.office));
}

const run = (fx, argv, extra) => spawnSync(SH, argv, { cwd: fx.office, env: envFor(fx, extra), encoding: "utf8", timeout: 120000 });

/**
 * Run under a wrapper that signals the whole process group with TERM once the
 * verify stub says it is hanging — systemd stopping the unit kills its cgroup
 * the same way. The wrapper traps TERM itself so it lives to report.
 */
function runKilled(fx, argv, extra) {
  const quoted = argv.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const mark = fwd(join(fx.root, "hanging"));
  const wrapper = `${SH} ${quoted} & p=$!; trap 'echo wrapper-saw-term' TERM; `
    + `n=0; while [ ! -f '${mark}' ] && [ $n -lt 600 ]; do sleep 0.1; n=$((n+1)); done; `
    + `sleep 0.3; kill -TERM 0; wait $p; echo "rc=$?"`;
  return spawnSync(SH, ["-c", wrapper], {
    cwd: fx.office, env: envFor(fx, extra), encoding: "utf8", timeout: 120000,
    detached: process.platform !== "win32",
  });
}

const status = (fx) => fx.g("-C", fx.town, "status", "--porcelain", "--untracked-files=all").trim();
const tracked = (fx) => fx.g("-C", fx.town, "status", "--porcelain", "--untracked-files=no").trim();
const head = (fx) => fx.g("-C", fx.town, "rev-parse", "HEAD").trim();
const originHead = (fx) => fx.g("-C", fx.origin, "rev-parse", "main").trim();
const ledgerAt = (fx) => readFileSync(join(fx.town, LEDGER), "utf8");
const calls = (fx) => existsSync(join(fx.root, "calls.txt")) ? readFileSync(join(fx.root, "calls.txt"), "utf8").trim().split("\n") : [];

// ═════════════════════════════════════════════════════════════════════════════
// THE TICK
// ═════════════════════════════════════════════════════════════════════════════

test("tick · control: a green ledger gets the pass's rows committed and pushed, and the clone ends clean", { skip }, () => {
  const fx = fixture(["row 1", "row 2"]);
  const r = run(fx, [tickScript(fx)], { STUB_APPEND: "mint row 3", STUB_WELCOME: "welcome row 4" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(status(fx), "", "the clone ends clean");
  const shown = fx.g("-C", fx.origin, "show", `main:${LEDGER}`);
  assert.match(shown, /mint row 3\nwelcome row 4\n$/, "both rows reached origin");
  assert.deepEqual(calls(fx), ["settle", "verify", "mint --append", "welcome", "verify"], "the joins settle first; a verify before the write and one after it");
  assert.doesNotMatch(r.stderr, /ROLLED BACK|catch-up OFF|FAILED/);
  assert.ok(existsSync(join(fx.office, "panes-published")), "the tick went on to publish the panes");
});

test("tick · a ledger that arrives red gets nothing appended, and the journal says the catch-up is off", { skip }, () => {
  const fx = fixture(["row 1", "Wildcat's line, RED since 13:59Z"]);
  const before = ledgerAt(fx);
  const at = head(fx);
  const r = run(fx, [tickScript(fx)], { STUB_APPEND: "mint row 3", STUB_WELCOME: "Corey's welcome" });
  assert.equal(r.status, 0, `the tick itself carries on: ${r.stderr}`);
  assert.deepEqual(calls(fx), ["settle", "verify"], "neither the mint nor the welcome pass ran onto a red ledger");
  assert.equal(ledgerAt(fx), before, "not one byte appended");
  assert.equal(status(fx), "", "the clone is as clean as it arrived");
  assert.equal(head(fx), at);
  assert.match(r.stderr, /mint catch-up OFF — the ledger arrived red/, "the journal names why the catch-up is off");
  assert.ok(existsSync(join(fx.office, "panes-published")), "the tick's real work still ran");
});

test("tick · a verify that fails after the write restores the ledger and removes what the pass created, and nothing else", { skip }, () => {
  const fx = fixture(["row 1", "row 2"]);
  // A resident's untracked file that was there before the tick: not the pass's to remove.
  mkdirSync(join(fx.town, "WHITE_PAGES", "someone"), { recursive: true });
  writeFileSync(join(fx.town, "WHITE_PAGES", "someone", "draft.md"), "a draft that predates the tick\n");
  const before = ledgerAt(fx);
  const at = head(fx);
  const pushed = originHead(fx);
  const r = run(fx, [tickScript(fx)], {
    STUB_APPEND: "mint row 3", STUB_WELCOME: "a welcome the verify refuses: RED",
    STUB_WELCOME_MAKES: "WHITE_PAGES/made-by-the-pass.md",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls(fx), ["settle", "verify", "mint --append", "welcome", "verify"]);
  assert.equal(tracked(fx), "", "no tracked file left modified: every pull and pen write can proceed");
  assert.equal(ledgerAt(fx), before, "the ledger is back to its arrival bytes");
  assert.equal(existsSync(join(fx.town, "WHITE_PAGES", "made-by-the-pass.md")), false, "the path the pass created is gone");
  assert.equal(readFileSync(join(fx.town, "WHITE_PAGES", "someone", "draft.md"), "utf8"), "a draft that predates the tick\n",
    "an untracked file that was there before the pass is left alone");
  assert.equal(head(fx), at, "no commit");
  assert.equal(originHead(fx), pushed, "no push");
  assert.match(r.stderr, /mint catch-up ROLLED BACK/);
  assert.match(r.stderr, /mint catch-up FAILED \(non-fatal\)/);
});

test("tick · a tick killed during the post-write verify restores the ledger too", { skip }, () => {
  const fx = fixture(["row 1", "row 2"]);
  const before = ledgerAt(fx);
  const r = runKilled(fx, [tickScript(fx)], { STUB_APPEND: "mint row 3", STUB_WELCOME: "welcome row 4", STUB_VERIFY_HANG: "2" });
  assert.ok(existsSync(join(fx.root, "hanging")), `the kill never happened: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout, /rc=(143|130|129)/, `the tick died of the signal: ${r.stdout}`);
  assert.equal(ledgerAt(fx), before, `the killed tick's rows are gone: ${r.stdout} ${r.stderr}`);
  assert.match(r.stderr, /mint catch-up ROLLED BACK/, "the trap says what it did");
  assert.equal(status(fx), "", "and the clone is clean");
});

test("tick · a quiet tick (nothing owed) costs one verify, as before", { skip }, () => {
  const fx = fixture(["row 1"]);
  const r = run(fx, [tickScript(fx)], {});
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(calls(fx), ["settle", "verify", "mint --append", "welcome"],
    "the arrival check already read these bytes; a second verify would lengthen every tick's lock hold for nothing");
  assert.equal(status(fx), "");
});

test("tick · merged joins settle BEFORE the join-bundle pass, and a failed settle stops nothing", { skip }, () => {
  // THE ORDER IS THE WHOLE FIX (Keemin, 2026-09-29). A handle bound before the
  // welcome pass is paid under its GitHub id; one bound after it is paid under
  // its card username, and binding it then puts two welcome lines in one house
  // (Wildcat, 2026-09-28). Read from the calls the shipped tick makes, not its text.
  const fx = fixture(["row 1"]);
  const r = run(fx, [tickScript(fx)], { STUB_WELCOME: "welcome row 2", STUB_SETTLE_EXIT: "1" });
  assert.equal(r.status, 0, r.stderr);
  const seen = calls(fx);
  assert.ok(seen.indexOf("settle") !== -1 && seen.indexOf("settle") < seen.indexOf("welcome"),
    `the settle pass runs before the welcome pass: ${seen.join(", ")}`);
  assert.equal(seen.filter((c) => c === "settle").length, 1, "once per tick");
  assert.match(r.stderr, /settle pass FAILED \(non-fatal\)/, "a settle that fails says so");
  assert.match(fx.g("-C", fx.origin, "show", `main:${LEDGER}`), /welcome row 2\n$/, "and the welcome still ran and landed");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE FERRY
// ═════════════════════════════════════════════════════════════════════════════

test("ferry · the unit's script survives systemd's reading of it", () => {
  const payload = ferryPayload();
  assert.doesNotMatch(payload, /%/, "systemd expands % specifiers in ExecStart before sh sees them");
  assert.doesNotMatch(payload, /#/, "the continuation lines join into ONE line: a # would comment out the rest of the chain");
  assert.doesNotMatch(payload, /\$\{/, "systemd substitutes ${VAR} inside a word, from its own environment");
  const trap = payload.indexOf("trap undo EXIT");
  assert.ok(trap !== -1, "the ferry carries no EXIT trap");
  assert.ok(trap < payload.indexOf("town-drain-run.mjs") && trap < payload.indexOf("node tools/ferry.mjs"),
    "the trap is armed before the first write");
  assert.ok(payload.indexOf("reset --hard -q HEAD", trap) !== -1, "the opening reset/clean pair stays as the backstop");
});

test("ferry · control: a green crossing commits every pass and ends clean, with no rollback", { skip }, () => {
  const fx = fixture(["row 1"]);
  const r = run(fx, ["-c", ferryScript(fx)], {
    STUB_FERRY_DELIVER: "letter-1", STUB_APPEND: "mint row 2", STUB_BALLOT: "ballot row 3",
    STUB_QUESTS: "quests moved", STUB_SEAL: "resealed",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(status(fx), "");
  assert.equal(head(fx), originHead(fx), "everything pushed");
  const log = fx.g("-C", fx.town, "log", "--format=%s", "-6").trim().split("\n");
  assert.deepEqual(log.slice(0, 5), ["seal: re-seal at the crossing", "quests: crossing leaderboard", "ballot: crossing pass", "mint: crossing pass", "ferry: crossing"]);
  assert.doesNotMatch(r.stderr, /a gate refused/);
});

test("ferry · a red verify after the mint leaves the clone at its last commit, and the delivery stays", { skip }, () => {
  const fx = fixture(["row 1"]);
  const r = run(fx, ["-c", ferryScript(fx)], { STUB_FERRY_DELIVER: "letter-1", STUB_APPEND: "mint row 2 RED" });
  assert.notEqual(r.status, 0, "the refusal is still loud: the unit fails");
  assert.equal(status(fx), "", "no mint row left on disk");
  assert.equal(fx.g("-C", fx.town, "log", "--format=%s", "-1").trim(), "ferry: crossing", "the committed delivery stays");
  assert.equal(ledgerAt(fx), "row 1\n");
  assert.match(r.stderr, /\[ferry\] a gate refused \(exit 1\)/);
});

test("ferry · a red verify after the ballot pass removes the receipt it created and keeps the mint commit", { skip }, () => {
  const fx = fixture(["row 1"]);
  const r = run(fx, ["-c", ferryScript(fx)], { STUB_APPEND: "mint row 2", STUB_BALLOT: "ballot row 3 RED" });
  assert.notEqual(r.status, 0);
  assert.equal(status(fx), "", "no ballot row and no receipt left behind");
  assert.equal(existsSync(join(fx.town, "WHITE_PAGES", "office", "outbox", "ballot-receipt.md")), false);
  assert.equal(fx.g("-C", fx.town, "log", "--format=%s", "-1").trim(), "mint: crossing pass");
  assert.equal(ledgerAt(fx), "row 1\nmint row 2\n");
});

test("ferry · a refusing seal verify puts the re-seal back", { skip }, () => {
  const fx = fixture(["row 1"]);
  const r = run(fx, ["-c", ferryScript(fx)], { STUB_SEAL: "a bad seal", STUB_SEAL_VERIFY_EXIT: "1" });
  assert.notEqual(r.status, 0);
  assert.equal(status(fx), "");
  assert.equal(readFileSync(join(fx.town, "PROJECTS", "the-town-seal", "seal.json"), "utf8"), "{\"seal\":\"founding\"}\n");
});

test("ferry · a crossing stopped mid-pass restores too", { skip }, () => {
  const fx = fixture(["row 1"]);
  const r = runKilled(fx, ["-c", ferryScript(fx)], { STUB_APPEND: "mint row 2", STUB_VERIFY_HANG: "1" });
  assert.ok(existsSync(join(fx.root, "hanging")), `the kill never happened: ${r.stdout} ${r.stderr}`);
  assert.match(r.stdout, /rc=(143|130|129)/, `the crossing died of the signal: ${r.stdout}`);
  assert.equal(status(fx), "", `the stopped crossing's mint row is gone: ${r.stderr}`);
  assert.match(r.stderr, /\[ferry\] a gate refused \(exit (143|130|129)\)/, "the trap says what it did");
  assert.equal(ledgerAt(fx), "row 1\n");
});
