// world2-rehearsal-guards.test.mjs — the rehearsal copy never touches prod (POS-242).
//
// `world2_dev` IS prod's store (office AGENTS.md). Two tools now create, drop
// and write a database beside it, and each carries a name guard. These are the
// guards, held from outside:
//
//   deploy/world2-rehearsal-copy.sh — DROPS its target. Refuses a target that
//     does not name `rehearsal`, and one equal to its source. Held by sourcing the
//     script (its guard is a function; sourcing defines and returns) and by
//     running it: the refusal must come before any `sudo`, so it is run here
//     where there is no Postgres and no sudo to reach — a guard that ran after the
//     first psql would fail here with psql's words, not its own.
//
//   world2/tools/rehearse.mjs — refuses a URL or name that names `world2_dev`, or
//     does not name `rehearsal`. Held as a function and as the CLI: the URL points
//     at a host that does not exist, so a runner that tried to connect would die
//     with a connection error instead of the refusal asserted here.
//
//   world2/tools/migrations-landed.mjs — every schema file has a probe or a named
//     skip. A migration with neither makes the runner stop with `no-probe`, which
//     is correct at the box and a red here, where it is cheap.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rehearsalTargetRefusal, asPen, clearingRefusal } from "../world2/tools/rehearse.mjs";
import { LANDED, schemaOrder } from "../world2/tools/migrations-landed.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COPY = join(ROOT, "deploy/world2-rehearsal-copy.sh");
const RUNNER = join(ROOT, "world2/tools/rehearse.mjs");

const bashOk = (() => { try { execFileSync("bash", ["-c", "exit 0"], { stdio: "ignore" }); return true; } catch { return false; } })();
const bash = (script, args = []) => spawnSync("bash", ["-c", script, "guard", ...args], { encoding: "utf8", env: { PATH: process.env.PATH } });

test("the runner refuses world2_dev by name, by URL path and by URL parameter", () => {
  for (const t of [
    "world2_dev",
    "postgres://rehearsal_runner:pw@127.0.0.1:5432/world2_dev",
    "postgresql://clearing_job:pw@localhost/world2_dev?sslmode=disable",
    "postgres://rehearsal_runner:pw@127.0.0.1:5432/world2_rehearsal?dbname=world2_dev",
    "world2_dev_rehearsal",
  ]) assert.match(rehearsalTargetRefusal(t) ?? "", /world2_dev, which is PROD/, t);
});

test("the runner refuses any database that does not name rehearsal, and one it cannot read", () => {
  assert.match(rehearsalTargetRefusal("world2") ?? "", /does not name 'rehearsal'/);
  assert.match(rehearsalTargetRefusal("postgres://u:p@h/world2_restore_test") ?? "", /does not name 'rehearsal'/);
  assert.match(rehearsalTargetRefusal("postgres://u:p@h/") ?? "", /names no database/);
  assert.match(rehearsalTargetRefusal("world2_rehearsal; DROP") ?? "", /plain identifier/);
  assert.equal(rehearsalTargetRefusal(""), "no target named");
});

test("the runner admits the copy", () => {
  assert.equal(rehearsalTargetRefusal("world2_rehearsal"), null);
  assert.equal(rehearsalTargetRefusal("postgres://rehearsal_runner:a%40b@127.0.0.1:5432/world2_rehearsal"), null);
});

test("the CLI refuses a world2_dev URL before it connects (exit 2, its own words)", () => {
  const r = spawnSync(process.execPath, [RUNNER, "--tree", ROOT, "--town-repo", ROOT,
    "--url", "postgres://rehearsal_runner:pw@no-such-host.invalid:5432/world2_dev"],
    { encoding: "utf8", env: { PATH: process.env.PATH }, timeout: 30_000 });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /^REFUSED: it names world2_dev/m);
});

test("a pen rides the URL's options, and the password is untouched", () => {
  const u = new URL(asPen("postgres://rehearsal_runner:a%40b@127.0.0.1:5432/world2_rehearsal", "clearing_job"));
  assert.equal(u.searchParams.get("options"), "-c role=clearing_job");
  assert.equal(decodeURIComponent(u.password), "a@b");
  assert.equal(u.pathname, "/world2_rehearsal");
});

test("a clearing that dies on a constraint is reported by the constraint's name (window 212's shape)", () => {
  const out = 'CLEARING FAILED window 212: duplicate key value violates unique constraint "marks_slug_key" — nothing moved (one transaction, gold §1: "…")';
  assert.equal(clearingRefusal(out).reason, "marks_slug_key");
  assert.equal(clearingRefusal("CLEARING FAILED window 9: window 9 is not open (already cleared, or never opened) — nothing moved").reason,
    "window 9 is not open (already cleared, or never opened)");
  // The w40 rehearsal's own crash (2026-09-26): a stack, then Node's banner last.
  const crash = "node:internal/modules/esm/resolve:275\n    throw new ERR_MODULE_NOT_FOUND(\n    ^\n\n" +
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/t/vendor/town.mjs' imported from /t/world2/tools/roll-ingest.mjs\n" +
    "    at finalizeResolution (node:internal/modules/esm/resolve:275:11)\n\nNode.js v22.22.1\n";
  assert.match(clearingRefusal(crash).reason, /^Error \[ERR_MODULE_NOT_FOUND\]: Cannot find module '\/t\/vendor\/town\.mjs'/);
});

test("every schema file has a landed-probe or a named skip, and no probe names a file that is gone", () => {
  const files = schemaOrder(readdirSync(join(ROOT, "world2/schema")));
  assert.ok(files.length >= 24, `expected the schema directory, found ${files.length} files`);
  for (const f of files) {
    const e = LANDED[f];
    assert.ok(e && (typeof e.probe === "string" || typeof e.skip === "string"), `${f} has no probe in migrations-landed.mjs`);
  }
  for (const f of Object.keys(LANDED)) assert.ok(files.includes(f), `migrations-landed.mjs names ${f}, which is not in world2/schema`);
});

test("the copy script's guard refuses a target without 'rehearsal', and one equal to the source", (t) => {
  if (!bashOk) return t.skip("bash is not on PATH here");
  const ok = (target, source) => bash(`. "$1"; rehearsal_target_ok "$2" "$3"`, [COPY, target, source]);
  assert.equal(ok("world2_rehearsal", "world2_dev").status, 0);
  const prod = ok("world2_dev", "world2_dev");
  assert.notEqual(prod.status, 0);
  assert.match(prod.stderr, /does not name 'rehearsal'/);
  assert.notEqual(ok("world2_scratch", "world2_dev").status, 0);
  const same = ok("world2_rehearsal", "world2_rehearsal");
  assert.notEqual(same.status, 0);
  assert.match(same.stderr, /equals source/);
  assert.notEqual(ok("world2_rehearsal;x", "world2_dev").status, 0);
  assert.match(ok("world2_dev_rehearsal", "world2_dev").stderr, /names world2_dev, which is PROD/);
});

test("the copy script, run against world2_dev, refuses with exit 2 before any sudo", (t) => {
  if (!bashOk) return t.skip("bash is not on PATH here");
  const r = spawnSync("bash", [COPY, "--target", "world2_dev"], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /refused: target 'world2_dev' does not name 'rehearsal'/);
  assert.doesNotMatch(r.stderr + r.stdout, /sudo|psql/);
});
