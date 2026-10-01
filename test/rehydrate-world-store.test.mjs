// rehydrate-world-store.test.mjs — the tick writes the world graph snapshot too,
// and a failed store write never fails the swap (POS-270 lane W, Wright-ruled
// 2026-09-30).
//
// deploy/office-rehydrate.sh runs ONE world hydration with two outputs:
// world.db.new (the file the office reads today) and --to-store (the graph
// snapshot it reads once lane W 3b deletes the file's opener). The store write
// connects as the law pen through deploy/world2-lib.sh § w2_pgenv. What is under
// test is the shell's control flow around the hydrator's exit:
//
//   0   both written            → world.db swapped in, said plainly
//   3   file good, store not    → world.db swapped in ANYWAY, said loudly
//   1   refused / FAILED        → world.db stays at its last good build
//   no credentials              → the file alone, no --to-store, said loudly
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
// exit with what the case asks. The world stub writes its file BEFORE a
// non-zero exit, as the real one does on both a FAILED stamp and a store miss.
const OFFICE_FILES = {
  "src/hydrate.mjs": `
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[process.argv.indexOf("--db") + 1], "office hydrated\\n");
`,
  "src/world-hydrate.mjs": `
import { appendFileSync, writeFileSync } from "node:fs";
appendFileSync(process.env.STUB_CALLS, "world-hydrate " + process.argv.slice(2).join(" ") + " as=" + (process.env.PGUSER ?? "-") + "\\n");
writeFileSync(process.argv[process.argv.indexOf("--db") + 1], "world hydrated\\n");
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
  write(office, { "world.db": "last good world\n" });
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
  return { ...r, calls, world: readFileSync(join(fx.office, "world.db"), "utf8") };
}

test("0 · ONE hydration writes the file AND the store, as the law pen, and the file is swapped in", { skip }, () => {
  const fx = fixture();
  const r = rehydrate(fx, { STUB_WORLD_EXIT: "0" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls.trim().split("\n").length, 1, "one world hydration, not two");
  assert.match(r.calls, /--ref blessed --db world\.db\.new --to-store as=law_ingester/, "the store write is asked for, and connects as the law pen");
  assert.equal(r.world, "world hydrated\n");
  assert.match(r.stdout, /world\.db swapped and the world graph snapshot written to the store/);
});

test("3 · the store write failed and the file is good: the swap STILL happens, and the journal says so loudly", { skip }, () => {
  const fx = fixture();
  const r = rehydrate(fx, { STUB_WORLD_EXIT: "3" });
  assert.equal(r.status, 0, "a store miss must never fail the tick");
  assert.equal(r.world, "world hydrated\n", "the good file was held back because the store failed");
  assert.match(r.stderr, /WORLD STORE NOT WRITTEN \(non-fatal\)/);
});

test("1 · a refused or FAILED hydration leaves world.db at its last good build", { skip }, () => {
  const fx = fixture();
  const r = rehydrate(fx, { STUB_WORLD_EXIT: "1" });
  assert.equal(r.status, 0, "a world failure must never fail the tick");
  assert.equal(r.world, "last good world\n", "a FAILED build was swapped in");
  assert.match(r.stderr, /world hydrate FAILED \(non-fatal, exit 1\)/);
});

test("no credentials · the file alone, without --to-store, and the journal says the store was not written", { skip }, () => {
  const fx = fixture();
  const r = rehydrate(fx, { STUB_WORLD_EXIT: "0", PG_LAW_INGESTER_PASSWORD: undefined });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.calls, /--to-store/, "a store write was attempted with no credential to make it");
  assert.equal(r.world, "world hydrated\n", "the file must still be built and swapped");
  assert.match(r.stderr, /credentials are unreadable/);
  assert.match(r.stderr, /WORLD STORE NOT WRITTEN \(non-fatal\)/);
});
