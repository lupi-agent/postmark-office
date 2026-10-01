// rehydrate-world-store.test.mjs — the tick writes the world graph snapshot, and
// only that (POS-270 lane W; world.db retired in 3b), and a miss never fails it.
//
// deploy/office-rehydrate.sh runs ONE world hydration with ONE output,
// --to-store, connecting as the law pen through deploy/world2-lib.sh §
// w2_pgenv. What is under test is the shell's control flow around it:
//
//   0   written                 → said plainly
//   1   refused / store missed  → the office keeps the snapshot it has, said loudly
//   no credentials              → no hydration at all, said loudly
//
// and in every case no world.db is written.
//
// The SHIPPED script and the SHIPPED lib run against stubbed hydrators, a
// stubbed flock and a stubbed door (the harness of
// tick-and-ferry-whole-or-nothing.test.mjs). Runs under `dash` where it exists
// (the box's /bin/sh), else `sh`; where neither is a real shell, or there is no
// bash for the lib, the file SKIPS rather than passes.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "postmark-rehydrate-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });

const works = (shell) => spawnSync(shell, ["-c", "true"], { stdio: "ignore" }).status === 0;
const SH = works("dash") ? "dash" : works("sh") ? "sh" : null;
const skip = !SH ? "no POSIX shell on this machine" : !works("bash") ? "no bash for deploy/world2-lib.sh" : false;
const fwd = (p) => p.replace(/\\/g, "/");
const GIT_ENV = {
  GIT_AUTHOR_NAME: "fixture", GIT_AUTHOR_EMAIL: "fixture@postmark.invalid",
  GIT_COMMITTER_NAME: "fixture", GIT_COMMITTER_EMAIL: "fixture@postmark.invalid",
};

// The hydrators' shell-facing contract: write the --db file, record the call,
// exit with what the case asks. A world stub handed --db would write it; the
// tick must never hand it one.
const OFFICE_FILES = {
  "src/hydrate.mjs": `
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[process.argv.indexOf("--db") + 1], "office hydrated\\n");
`,
  "src/world-hydrate.mjs": `
import { appendFileSync, writeFileSync } from "node:fs";
appendFileSync(process.env.STUB_CALLS, "world-hydrate " + process.argv.slice(2).join(" ") + " as=" + (process.env.PGUSER ?? "-") + "\\n");
if (process.argv.includes("--db")) writeFileSync(process.argv[process.argv.indexOf("--db") + 1], "world hydrated\\n");
process.exit(Number(process.env.STUB_WORLD_EXIT || 0));
`,
};
const BIN = {
  flock: "#!/bin/sh\nexit 0\n",
  curl: `#!/bin/sh\nprintf 'HTTP/1.1 200 OK\\r\\nX-Postmark-As-Of: %s\\r\\n\\r\\n' "$(git -C "$TOWN_CLONE" rev-parse HEAD)"\n`,
};

let seq = 0;
function fixture() {
  const root = join(scratch, `run-${++seq}`);
  const town = join(root, "town");
  const office = join(root, "office");
  const bin = join(root, "bin");
  const write = (base, files) => { for (const [rel, body] of Object.entries(files)) { mkdirSync(dirname(join(base, rel)), { recursive: true }); writeFileSync(join(base, rel), body); } };
  write(town, { "README.md": "a town\n" });
  const g = (...a) => execFileSync("git", a, { stdio: "ignore", env: { ...process.env, ...GIT_ENV } });
  g("init", "-q", "-b", "main", town);
  g("-C", town, "add", "-A");
  g("-C", town, "commit", "-qm", "founding");
  write(office, OFFICE_FILES);
  write(office, { "deploy/world2-lib.sh": readFileSync(join(OFFICE, "deploy", "world2-lib.sh"), "utf8") });
  write(bin, BIN);
  return { root, town, office, bin };
}

function rehydrate(fx, extra) {
  const script = join(fx.root, "office-rehydrate.sh");
  writeFileSync(script, readFileSync(join(OFFICE, "deploy", "office-rehydrate.sh"), "utf8"));
  const env = {
    ...process.env, ...GIT_ENV,
    PATH: `${fx.bin}${delimiter}${process.env.PATH}`,
    TOWN_CLONE: fwd(fx.town), WORLD_CLONE: fwd(fx.town),
    TOWN_LOCK: fwd(join(fx.root, "town.lock")),
    STUB_CALLS: join(fx.root, "calls.txt"),
    WORLD2_ENV_FILE: join(fx.root, "no-such-world2.env"),   // the lib reads the env first, the file only as a fallback
    PG_LAW_INGESTER_PASSWORD: "s3cret",
    ...extra,
  };
  for (const [k, v] of Object.entries(extra ?? {})) if (v === undefined) delete env[k];
  const r = spawnSync(SH, [script], { cwd: fx.office, env, encoding: "utf8", timeout: 120000 });
  const calls = existsSync(env.STUB_CALLS) ? readFileSync(env.STUB_CALLS, "utf8") : "";
  return { ...r, calls, worldDb: existsSync(join(fx.office, "world.db")) || existsSync(join(fx.office, "world.db.new")) };
}

test("0 · ONE hydration writes the store, as the law pen, and no world.db", { skip }, () => {
  const fx = fixture();
  const r = rehydrate(fx, { STUB_WORLD_EXIT: "0" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls.trim().split("\n").length, 1, "one world hydration, not two");
  assert.match(r.calls, /--ref blessed --to-store as=law_ingester/, "the store write is asked for, and connects as the law pen");
  assert.doesNotMatch(r.calls, /--db/, "world.db is retired; the tick must not ask for one");
  assert.equal(r.worldDb, false);
  assert.match(r.stdout, /the world graph snapshot written to the store/);
});

test("1 · a refused hydration or a store miss leaves the office on the snapshot it has, and the journal says so loudly", { skip }, () => {
  const fx = fixture();
  const r = rehydrate(fx, { STUB_WORLD_EXIT: "1" });
  assert.equal(r.status, 0, "a world miss must never fail the tick");
  assert.match(r.stderr, /WORLD STORE NOT WRITTEN \(non-fatal, exit 1\)/);
  assert.equal(r.worldDb, false);
});

test("no credentials · no hydration is attempted, and the journal names the missing credential", { skip }, () => {
  const fx = fixture();
  const r = rehydrate(fx, { STUB_WORLD_EXIT: "0", PG_LAW_INGESTER_PASSWORD: undefined });
  assert.equal(r.status, 0);
  assert.equal(r.calls.includes("world-hydrate"), false, "a hydration ran with no credential to write what it built");
  assert.match(r.stderr, /WORLD STORE NOT WRITTEN \(non-fatal\) — the law pen's credential is unreadable/);
  assert.equal(r.worldDb, false);
});
