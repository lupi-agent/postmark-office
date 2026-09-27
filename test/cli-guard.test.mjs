// The CLI-guard falsifier — every module with a CLI tail, both faces.
//
// THE CLASS (2026-09-08, found twice in one night, in two lanes). A tool module
// with a CLI tail runs that tail at IMPORT unless guarded; a process.exit() in
// the tail kills the importer, and the whole importing test file vanishes as one
// failing unit ("tests 1, pass 0, fail 1") instead of one red assertion. The
// guard most tools carried — `pathToFileURL(process.argv[1]).href ===
// import.meta.url` — is FALSE when the entry path reaches the file through a
// Windows junction (the ESM loader realpaths the entry; argv[1] is not), so the
// tool exits 0 having done nothing (HQ memory `junctions-defeat-main-guards`,
// 2026-09-05: 33 fixture reds). The office's sound idioms are the basename
// compare (src/world-drain.mjs) and the realpath compare
// (world2/tools/await-clearing.mjs); this lane converted every fragile guard to
// the latter. (The realpath exemplar was world2/tools/dispatcher.mjs until the
// subscription was parked on 2026-09-10 — the idiom outlived the file that
// taught it, and every citation in this repo was repointed with it.)
//
// FACE ONE — the import is inert. For every tool, a small importer
// (test/helpers/cli-guard-importer.mjs) is spawned as the ENTRY and imports the
// tool; it is spawned twice, at its plain path and through a junction so that
// process.argv[1] carries the exact shape the old guards failed on. The proof
// that nothing ran is that stdout is the importer's sentinel line and nothing
// else, and the exit is 0. The import happens in a CHILD so that a regression
// is one legible red here rather than this file vanishing — the shape of the
// vanish is recorded in the lane report, not reproduced by design.
//
// FACE TWO — isMain fires when the tool IS the entry. A guard that is never
// true is a tool that does nothing and exits 0. Each tool is spawned as the
// entry, again plain and through a junction, with the cheapest arguments that
// make its tail speak (a --help, a usage refusal, a missing-file refusal) and
// the test asserts the tail's own words and exit code. Nothing here reaches a
// network, a database, or a file outside a temp dir: every proof stops at the
// tool's first refusal. The junction arm is the one that matters (the atlas
// lane's reviewer, 2026-09-08): by its real path the old guard passes every
// check, and only through a junction does it fall silent — "produced no output
// and exited 0" is the named red, and a grep for the idiom cannot see it.
//
// THE ROSTER IS LIVE. The manifest below is checked against a scan of src/,
// tools/, world2/ and deploy/ for anything carrying an entry guard; a new
// guarded tool that is not listed here fails the roster test, and a listed
// tool that has lost its guard fails it too. The denominator is read from the
// tree, never assumed.

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, unlinkSync, rmSync, rmdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const IMPORTER = "test/helpers/cli-guard-importer.mjs";

// Paths that do not exist at all — the refusals below are all "no X at <path>",
// never a write; the child's cwd is the scratch dir so a tool that did write a
// default file would write it there, and the after() sweeps it.
const SCRATCH = mkdtempSync(join(tmpdir(), "cli-guard-"));
const NOWHERE = join(SCRATCH, "does-not-exist");
const NOWHERE_DB = join(SCRATCH, "does-not-exist.db");
const NOWHERE_OUT = join(SCRATCH, "out.json");

// The junction — a real `mklink /J` on Windows (the shape the 2026-09-05 reds
// arrived through), a directory symlink elsewhere; both are paths the ESM
// loader realpaths away, which is exactly the mismatch under test. Torn down
// with `rmdir` (the link only) — NEVER a recursive delete, which through a
// junction is a delete of the office itself — and the office's file count is
// taken before and after so the teardown is proven, not assumed.
const countFiles = (dir) => {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    if (e.isDirectory()) n += countFiles(join(dir, e.name)); else n += 1;
  }
  return n;
};
const FILES_BEFORE = countFiles(ROOT);
const LINK_DIR = mkdtempSync(join(tmpdir(), "cli-guard-link-"));
const LINK = join(LINK_DIR, "office");
if (process.platform === "win32") {
  const mk = spawnSync("cmd", ["/c", "mklink", "/J", LINK, ROOT], { encoding: "utf8" });
  assert.equal(mk.status, 0, `mklink /J failed: ${mk.stdout}${mk.stderr}`);
} else {
  symlinkSync(ROOT, LINK);
}
assert.equal(realpathSync(LINK), ROOT, "the junction must resolve to the office root");

test.after(() => {
  if (process.platform === "win32") {
    const rm = spawnSync("cmd", ["/c", "rmdir", LINK], { encoding: "utf8" });
    assert.equal(rm.status, 0, `rmdir of the junction failed: ${rm.stdout}${rm.stderr}`);
  } else {
    unlinkSync(LINK);
  }
  rmdirSync(LINK_DIR); // non-recursive on purpose: loud if the link were somehow still inside
  rmSync(SCRATCH, { recursive: true, force: true }); // the tools' cwd and refusal paths — holds no link
  assert.equal(countFiles(ROOT), FILES_BEFORE, "the office's file count changed across the run — a tool wrote into the tree, or the teardown reached through the junction");
});

// ── the roster ───────────────────────────────────────────────────────────────
// file → how to make the tail speak without touching anything real.
//   args:   argv after the script
//   env:    overrides (undefined = delete the key from the child's env)
//   code:   expected exit code
//   needle: a substring the tail's own words must contain (stdout+stderr)
const NO_PG = { WORLD2_PG_URL: undefined, WORLD2_PG: undefined, WORLD2_CLEARING_URL: undefined, WORLD2_OFFICE_URL: undefined, PGDATABASE: undefined, PGUSER: undefined };
const ROSTER = {
  // src/
  "src/dynamic-store.mjs": { args: [], env: { WORLD_DYNAMIC_DB: NOWHERE_DB, WORLD_STORE_DB: NOWHERE_DB }, code: 0, needle: '"present": false' },
  "src/pot-stake-exec.mjs": { args: ["{}"], env: { STAMP_KEY: NOWHERE, TOWN_CLONE: NOWHERE }, code: 0, needle: "not-yet-open" },
  "src/store-writedown.mjs": { args: [], env: NO_PG, code: 2, needle: "--input <fold-input.json> is required" },
  "src/world-drain.mjs": { args: ["--at", "not-a-date"], code: 2, needle: "unparseable --at" },
  "src/world-lints.mjs": { args: ["--db", NOWHERE_DB], code: 1, needle: "" },
  "src/world-serve.mjs": { args: [], env: { WORLD_STORE_DB: NOWHERE_DB, WORLD_CLONE: NOWHERE }, code: 0, needle: "{" },
  // KNOWN RED ON ANY HYDRATED TREE, and the env key that used to sit here was a
  // lie about why. `world-store.mjs`'s tail calls `loadWorldGraph()` with no
  // argument, so it reads `DEFAULT_DB` (`OFFICE_ROOT/world.db`) and never looks
  // at WORLD_STORE_DB — the key its three siblings do read. The proof therefore
  // exits 1 only where no `world.db` has ever been hydrated; on the box and on
  // G:/Postmark/repo-clones/wright/office (world.db, hydration_status OK, 1406 nodes) it exits 0
  // and this goes red. It cannot be fixed from the roster: making it honest
  // needs either a second expected code here or the tail reading a path, and
  // both are additions this train is not for. Left named rather than papered
  // over, and the env key removed because it claimed a control that is not real.
  "src/world-store.mjs": { args: [], code: 1, needle: "" },
  // tools/
  "tools/backfill-home-shelf.mjs": { args: ["--manifest", NOWHERE], code: 2, needle: "no manifest at" },
  "tools/media-thumbnails-backfill.mjs": { args: ["--from-record", NOWHERE], code: 2, needle: "no record at" },
  "tools/box-rollcall.mjs": { args: ["--manifest", NOWHERE], code: 2, needle: "the roll-call itself could not run" },
  // POS-216: refuses on a missing town clone before reading or writing anything
  "tools/ops-activity.mjs": { args: ["--town", NOWHERE], env: NO_PG, code: 2, needle: "no town clone at" },
  "tools/capture-doorstep-golden.mjs": { args: [], code: 0, needle: "{" },
  "tools/capture-household-golden.mjs": { args: [], code: 0, needle: "{" },
  "tools/crossing-replay-check.mjs": { args: ["--db", NOWHERE_DB, "--world", NOWHERE], code: 2, needle: "GATE REFUSED" },
  "tools/crossing-save.mjs": { args: ["--world", NOWHERE], code: 1, needle: "GATE REFUSED world-clone" },
  "tools/dynamic-rebuild.mjs": { args: ["--at", "not-a-date"], code: 2, needle: "unparseable --at" },
  "tools/funding-report.mjs": { args: ["--clone", NOWHERE, "--out", NOWHERE_OUT], code: 0, needle: "" },
  "tools/harbor-watch.mjs": { args: [], code: 2, needle: "usage: harbor-watch.mjs" },
  "tools/hydrate-equivalence.mjs": { args: ["--a", NOWHERE, "--b", `${NOWHERE}-b`], code: 2, needle: "not a world checkout:" },
  "tools/ledger-freeze.mjs": { args: ["--at", "not-a-date"], code: 2, needle: "unparseable --at" },
  // POS-178. A safe entry proof for a tool that WRITES THE WHITE PAGES: a clone
  // that is not a town checkout, so it refuses before it reads a berth, plans a
  // settlement or reaches the pen. --apply is not passed and could not write
  // anyway; the dry run is the default and the refusal comes first.
  // POS-187's two. Both refuse on USAGE with no flag, which is before either
  // reads the town clone, opens a Postgres connection or writes anything — the
  // same "stops at the tool's first refusal" shape as the rest of this roster.
  // NO_PG on top of that, so a regression that reached for a connection fails
  // on the connection rather than quietly finding one.
  // POS-159's third, on the same shape and for the same reason it matters
  // MORE here than anywhere: a backfill whose entry guard is defeated by a
  // junction exits 0 having read no roll and written no row, which is
  // indistinguishable from the correct answer on today's town (0 planned).
  "tools/registry-backfill.mjs": { args: [], env: NO_PG, code: 1, needle: "pass exactly one of --dry-run or --apply" },
  "tools/registry-drain.mjs": { args: [], env: NO_PG, code: 1, needle: "pass exactly one of --check, --apply or --ingest-missing" },
  "tools/registry-seed.mjs": { args: [], env: NO_PG, code: 1, needle: "pass exactly one of --dry-run or --apply" },
  // POS-193 (fix-forward, 2026-09-23): the baseline tool refuses at its first gate
  // when the named tip cannot be resolved — before any gh call and before the
  // suite runs. #170 merged on the new test file alone and the roster went red.
  "tools/suite-baseline.mjs": { args: ["--tip", "0000000"], code: 2, needle: "cannot resolve 0000000 to a full sha here" },
  "tools/settle-anchored-berths.mjs": { args: ["--clone", NOWHERE], code: 1, needle: "not a town checkout" },
  "tools/site-sentinel.mjs": { args: ["--now", "not-a-date", "--dry-run", "--state", NOWHERE_OUT, "--out", NOWHERE_OUT], env: { SENTINEL_DISCORD_WEBHOOK: undefined }, code: 1, needle: "site-sentinel" },
  "tools/stripe-watch.mjs": { args: ["--clone", NOWHERE], code: 1, needle: "no town clone with the funding seam" },
  "tools/thread-parity.mjs": { args: ["--log", NOWHERE, "--db", NOWHERE_DB, "--json"], code: 2, needle: "voices-log" },
  "tools/train-week-check.mjs": { args: [], code: 2, needle: "usage: node tools/train-week-check.mjs" },
  "tools/usdc-watch.mjs": { args: ["--clone", NOWHERE], code: 1, needle: "no town clone with the funding seam" },
  "tools/vessel-parity.mjs": { args: ["--world", NOWHERE, "--db", NOWHERE_DB], code: 9, needle: "vessel-parity tripped" },
  "tools/world-gexf.mjs": { args: ["--db", NOWHERE_DB, "--out", NOWHERE_OUT], code: 1, needle: "" },
  // deploy/
  "deploy/publish-windows.mjs": { args: [], code: 2, needle: "usage: node deploy/publish-windows.mjs" },
  "deploy/settlement-classify.mjs": { args: [], code: 0, needle: '"class"' },
  "deploy/settlement-escalate.mjs": { args: ["--dry-run", "--credentials", NOWHERE], code: 0, needle: "" },
  // --recurring answers with an exit code and no words, by design (settlement-auto.sh reads it
  // as a POSIX `if`); exit 1 against a never-true guard's 0 is the whole proof here.
  "deploy/settlement-history.mjs": { args: ["--recurring", "3", "--history", NOWHERE], code: 1, needle: "", silent: true },
  // A safe entry proof for a tool that SIGNS: no --town, so it refuses before it
  // reads a plan, spawns a mint or touches a key. The needle is that refusal.
  "deploy/welcome-pass.mjs": { args: [], code: 1, needle: "--town <town-clone> is required" },
  // world2/tools/
  // No --world-repo: stops on usage before any git read or Postgres connect (POS-212).
  "world2/tools/adopt-solo.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: adopt-solo.mjs" },
  "world2/tools/await-clearing.mjs": { args: [], env: NO_PG, code: 2, needle: "--since <iso8601> is required" },
  // No --sqlite: stops on usage before any sqlite open or Postgres connect (POS-154).
  "world2/tools/backfill-departures.mjs": { args: [], env: NO_PG, code: 2, needle: "--sqlite <dynamic.db> is required" },
  "world2/tools/backfill-register.mjs": { args: [], env: NO_PG, code: 2, needle: "--class must be one of" },
  "world2/tools/escrow-ingest.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: escrow-ingest.mjs --town-repo <checkout>" },
  "world2/tools/falsifier-conversations-equality.mjs": { args: [], env: NO_PG, code: 2, needle: "--voices-log <path> is required" },
  "world2/tools/fold-input-cli.mjs": { args: [], env: NO_PG, code: 2, needle: "--world-sha <sha> is required" },
  "world2/tools/falsifier-pen-flip.mjs": { args: ["--help"], env: NO_PG, code: 0, needle: "usage" },
  "world2/tools/falsifier-projection-equality.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: falsifier-projection-equality.mjs" },
  "world2/tools/falsifier-review-closure.mjs": { args: [], env: NO_PG, code: 2, needle: "WORLD2_PG_URL missing" },
  "world2/tools/law-ingest.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: law-ingest.mjs" },
  "world2/tools/ledger-backfill.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: WORLD2_PG_URL=" },
  // No --world-repo: stops on usage before any git or Postgres (POS-142).
  "world2/tools/marks-ingest.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: marks-ingest.mjs" },
  "world2/tools/pointer-ingest.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: pointer-ingest.mjs --world-repo" },
  "world2/tools/replay-ingest.mjs": { args: ["--help"], env: NO_PG, code: 0, needle: "usage: replay-ingest.mjs" },
  // No --tree: stops on usage before any git read or Postgres connect (POS-242).
  "world2/tools/rehearse.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: rehearse.mjs" },
  "world2/tools/retire-unpublished.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: retire-unpublished.mjs" },
  // The calendar's rebuild (POS-207): no --dry-run, so it refuses before it
  // opens any connection — it has no write mode at all.
  "world2/tools/events-rebuild.mjs": { args: [], env: NO_PG, code: 2, needle: "only --dry-run exists" },
  // The earpiece's deliverer (POS-209): bare, it is usage and opens nothing —
  // the timer passes --run, and even then W2_EARPIECE=1 gates every read.
  "world2/tools/earpiece-deliver.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: earpiece-deliver.mjs --run" },
  "world2/tools/review-rule.mjs": { args: [], env: NO_PG, code: 2, needle: "review-rule.mjs: which claim?" },
  "world2/tools/roll-ingest.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: roll-ingest.mjs" },
  "world2/tools/seed-import.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: seed-import.mjs" },
  // No --world-repo: stops on usage before any git or Postgres (postmark#2897).
  "world2/tools/settlements-backfill.mjs": { args: [], env: NO_PG, code: 2, needle: "--world-repo <checkout> is required" },
  "world2/tools/snapshot-export.mjs": { args: ["--help"], env: NO_PG, code: 2, needle: "usage:" },
  "world2/tools/stamp-ingest.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: stamp-ingest.mjs" },
  "world2/tools/state-log-rederive.mjs": { args: [], env: { ...NO_PG, WORLD2_PG_URL: "postgres://nobody@localhost/not_scratch" }, code: 2, needle: "REFUSED · WORLD2_PG_URL must name" },
  // POS-155 gave this tool a second door (`--window <N>`, a candle window) beside
  // the exact-crossing `--windows`, so its no-args sentence names both. The
  // needle moved with the sentence, which is this roster working: the CLI was
  // restructured, the guard went red, and the new words had to be chosen rather
  // than arrived at.
  "world2/tools/state-log-write.mjs": { args: [], env: NO_PG, code: 2, needle: "--world <checkout> is required, and one of --window" },
  // A safe entry proof for a tool that WRITES to the live world store: no flag,
  // so it stops on usage. The store is opened lazily precisely so this refusal
  // never reaches Postgres — NO_PG below would make a connection fail anyway,
  // but the tool must not have tried.
  "world2/tools/window-reanchor.mjs": { args: [], env: NO_PG, code: 2, needle: "usage: window-reanchor.mjs --dry-run | --apply" },
};

// ── the scan: which files carry an entry guard at all ────────────────────────
const GUARD_RE = /process\.argv\[1\]/;
function* walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "viewer" || e === "schema") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(mjs|js|cjs)$/.test(e)) yield p;
  }
}
// Raw source, comments included: a comment that only mentions argv[1] is a rare
// false positive that fails loudly (and is fixed by rewording it); a comment
// stripper that misreads a `/*` inside a string silently drops a real guard,
// which is the worse failure and the one the first draft of this scan had.
const guarded = [];
for (const dir of ["src", "tools", "world2", "deploy"]) {
  for (const p of walk(join(ROOT, dir))) {
    if (GUARD_RE.test(readFileSync(p, "utf8"))) guarded.push(relative(ROOT, p).replace(/\\/g, "/"));
  }
}

test("cli-guard roster: every module carrying an entry guard is on the roster, and nothing on the roster has lost its guard", () => {
  const listed = Object.keys(ROSTER).sort();
  const found = guarded.sort();
  assert.deepEqual(found, listed,
    `roster drift — add the new tool with a safe entry proof, or a listed tool no longer reads process.argv[1]:\n` +
    `  guarded but unlisted: ${found.filter((f) => !listed.includes(f)).join(", ") || "—"}\n` +
    `  listed but unguarded: ${listed.filter((f) => !found.includes(f)).join(", ") || "—"}`);
});

test("cli-guard roster: no two roster tools share a basename (the basename idiom's one blind spot)", () => {
  const names = Object.keys(ROSTER).map((f) => f.split("/").pop());
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  assert.deepEqual(dup, [], `basename collisions on the roster: ${dup.join(", ")}`);
});

// ── the spawns ───────────────────────────────────────────────────────────────
function childEnv(overrides = {}) {
  const env = { ...process.env };
  for (const [k, v] of Object.entries(overrides)) { if (v === undefined) delete env[k]; else env[k] = v; }
  return env;
}
function run(script, args, env, label) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: SCRATCH, env, encoding: "utf8", timeout: 90_000 });
  const detail = `\n  [${label}] ${script} ${args.join(" ")}\n  exit=${r.status} signal=${r.signal}${r.error ? ` error=${r.error.message}` : ""}\n  stdout: ${r.stdout.slice(0, 600)}\n  stderr: ${r.stderr.slice(0, 600)}`;
  assert.equal(r.error, undefined, `spawn failed / timed out${detail}`);
  return { ...r, detail };
}

for (const [file, proof] of Object.entries(ROSTER)) {
  test(`cli-guard: ${file}`, () => {
    const env = childEnv(proof.env);
    const shapes = [["plain", ROOT], ["junction", LINK]];

    // FACE ONE — inert on import, argv[1] plain and junction-shaped.
    for (const [shape, base] of shapes) {
      const r = run(join(base, IMPORTER), [join(base, file)], env, `import via ${shape}`);
      assert.equal(r.status, 0, `import of ${file} did not leave the importer alive (the tail fired)${r.detail}`);
      assert.match(r.stdout, /^IMPORT-INERT \d+ms\n$/, `stdout is not only the importer's sentinel — the tail wrote something${r.detail}`);
    }

    // FACE TWO — isMain fires when the tool is the entry, plain and through the junction.
    for (const [shape, base] of shapes) {
      const r = run(join(base, file), proof.args, env, `entry via ${shape}`);
      const said = r.stdout + r.stderr;
      assert.equal(r.status, proof.code, `exit code — a guard that is never true exits 0 with nothing said${r.detail}`);
      assert.ok(said.includes(proof.needle), `the tail's own words are missing (wanted ${JSON.stringify(proof.needle)})${r.detail}`);
      if (!proof.silent) assert.ok(said.trim().length > 0, `the tool said nothing at all — the guard did not fire${r.detail}`);
    }
  });
}
