// settlement-bottle.mjs — ONE STORE CROSSING, IN A BOTTLE (POS-242).
//
// Moved out of test/settlement-dry-leg.test.mjs so the rehearsal runner's own
// test (world2-rehearsal-dry.test.mjs) drives the same bottle: a fixture office
// whose receipt, history, surveyed reading, retry and settlement-auto.sh are the
// REAL files, and whose store tools, registry pair and escalation are stubs that
// log their argv and write the way the real tool writes when not told to be dry.
// That file's header says why each stub is shaped as it is.

import { after } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(OFFICE, "deploy", "settlement-auto.sh");
export const scratch = mkdtempSync(join(tmpdir(), "postmark-dryleg-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });

const has = (cmd) => { try { execFileSync("sh", ["-c", cmd], { stdio: "ignore" }); return true; } catch { return false; } };
export const SH_OK = has("sh -c 'true'");

export const GIT_ENV = {
  GIT_AUTHOR_NAME: "seed", GIT_AUTHOR_EMAIL: "seed@postmark.invalid",
  GIT_COMMITTER_NAME: "seed", GIT_COMMITTER_EMAIL: "seed@postmark.invalid",
};
export const g = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], {
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
const REAL = ["deploy/settlement-auto.sh", "deploy/settlement-receipt.mjs", "deploy/surveyed-reading.mjs", "deploy/refused-marks.mjs",
  "deploy/settlement-history.mjs", "deploy/settlement-retry.sh"];

let seq = 0;

/**
 * ONE STORE CROSSING, IN A BOTTLE. `quiet` makes the sweep publish nothing (the
 * registry-only crossing, whose push is publish_main's other caller); `harm`
 * makes the harm gate name a mark; `suiteRed` reddens the post-push checker.
 */
export function bottle({ quiet = false, harm = false, suiteRed = true } = {}) {
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
export const originRefs = (origin) => g(origin, "for-each-ref", "--format=%(refname) %(objectname)");

export function cross(b, env = {}) {
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

