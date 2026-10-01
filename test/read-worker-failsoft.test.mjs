// read-worker-failsoft.test.mjs — office #236: a read worker that cannot start
// costs the office its cores, never its life.
//
//   § 1  AN OFFICE WITH WORKERS ON AND NO dynamic.db STARTS. Every worker
//        refuses to boot (server.mjs § refuseBoot), the office stays up,
//        answers GET /world/present from its own thread (no X-PM-Reader), and
//        its log names each worker and the cause.
//   § 2  WITH dynamic.db PRESENT, THE SAME READ GOES TO A WORKER (the header
//        names it), and nothing is logged as given up.
//
// THE FLIP: put `process.exit(78)` back for a worker in `refuseBoot` (drop the
// `if (IN_READ_WORKER) throw` line) and § 1's office dies while its workers
// boot, so the read never gets an answer.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const haveClone = existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"));
const WORKERS = 2;

let tmp;
before(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-worker-failsoft-"));
  fixtureDb(join(tmp, "fixture.db")).close();
});
after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

/** Boot a real office (on a port the OS picks) with WORKERS read workers against `dynamicDb`; hand `fn` its base URL and its logs. */
async function withOffice(dynamicDb, fn) {
  const proc = spawn(process.execPath, [
    join(ROOT, "src", "server.mjs"), "--port", "0",
    "--db", join(tmp, "fixture.db"), "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db"),
  ], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", OFFICE_READ_WORKERS: String(WORKERS), WORLD_DYNAMIC_DB: dynamicDb,
      WORLD_POSITIONS: "1", WORLD_MOVEMENT_V2: "1", WORLD_PRESENCE: "1", TOWN_CLONE: join(ROOT, "town-clone") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = { out: "", err: "", exit: null };
  proc.stdout.on("data", (d) => { logs.out += String(d); });
  proc.stderr.on("data", (d) => { logs.err += String(d); });
  const gone = new Promise((ok) => proc.on("exit", (code, signal) => { logs.exit = { code, signal }; ok(); }));
  try {
    for (let i = 0; i < 300 && !logs.out.includes("listening") && !logs.exit; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(logs.out.includes("listening"), `the office never listened: ${JSON.stringify(logs.exit)} ${logs.err.slice(-400)}`);
    await fn(`http://127.0.0.1:${logs.out.match(/listening on :(\d+)/)[1]}`, logs);
  } finally {
    proc.kill();
    await gone;
  }
}

/** Poll /release until the pool has settled: every slot ready, or every slot given up. */
async function settled(base, logs) {
  let pool = null;
  for (let i = 0; i < 300; i++) {
    assert.equal(logs.exit, null, `the office exited while its workers booted: ${JSON.stringify(logs.exit)} ${logs.err.slice(-400)}`);
    pool = (await (await fetch(`${base}/release`)).json()).read_workers;
    if (pool?.ready === WORKERS || pool?.down?.every((d) => d != null)) return pool;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.fail(`the pool never settled: ${JSON.stringify(pool)}`);
}

test("§ 1 no dynamic.db: the office starts, answers /world/present itself, and logs why the workers are off", { skip: !haveClone && `needs the world clone at ${WORLD_CLONE}` }, async () => {
  const absent = join(tmp, "no-such-dir", "dynamic.db");
  await withOffice(absent, async (base, logs) => {
    const pool = await settled(base, logs);
    assert.equal(pool.ready, 0);
    assert.equal(pool.stopped, true, "every slot was given up, so the pool says it is stopped");
    for (const d of pool.down) assert.match(d, /needs an existing dynamic store/, "the pool reports each slot's cause");
    const r = await fetch(`${base}/world/present`);
    const body = await r.text();
    assert.equal(r.status, 200, body.slice(0, 200));
    assert.equal(r.headers.get("x-pm-reader"), null, "a worker answered, but none could start");
    for (let slot = 0; slot < WORKERS; slot++)
      assert.match(logs.err, new RegExp(`\\[read-workers\\] worker ${slot} could not start, three times running \\(--role read needs an existing dynamic store`),
        `the log does not name worker ${slot} and its cause:\n${logs.err.slice(-800)}`);
    assert.match(logs.err, /no worker is left, the main thread answers every read/);
    assert.equal(logs.exit, null, "the office is still running");
    assert.equal(existsSync(absent), false, "and no worker created the store it was missing");
  });
});

test("§ 2 with dynamic.db present, /world/present still goes to a worker", { skip: !haveClone && `needs the world clone at ${WORLD_CLONE}` }, async () => {
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  const present = join(tmp, "dynamic.db");
  openDynamic(present).close();
  await withOffice(present, async (base, logs) => {
    const pool = await settled(base, logs);
    assert.equal(pool.ready, WORKERS);
    assert.deepEqual(pool.down, new Array(WORKERS).fill(null));
    const r = await fetch(`${base}/world/present`);
    const body = await r.text();
    assert.equal(r.status, 200, body.slice(0, 200));
    assert.match(r.headers.get("x-pm-reader") ?? "", /^worker-\d$/, "the read stayed on the main thread with workers ready");
    assert.doesNotMatch(logs.err, /\[read-workers\]/, "a worker was logged as failing with its store present");
  });
});
