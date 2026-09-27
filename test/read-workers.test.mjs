// read-workers.test.mjs — POS-266's two falsifiers, against real workers.
//
//   § 1  A WRITE, THEN AN IMMEDIATE READ ON A WORKER, SEES THE WRITE. The walk
//        door's own call (`world.mjs § recordMoved`) runs on this thread, and
//        the very next /world/walkers, answered by each worker, must place the
//        walker where the write put her. The workers never walked: the only way
//        they can know is the announcement.
//   § 2  KILL A WORKER AND THE OFFICE KEEPS ANSWERING. A read held by a worker
//        that dies is answered by another; reads after the death are answered;
//        the dead worker is respawned, a new thread in its slot.
//
// The workers are the pool the server starts (read-workers.mjs § startReadPool)
// running the real server module as read-role offices; this file plays the
// main thread's part, handing them requests the way server.mjs's dispatch does.
//
// THE FLIPS: delete `onAnnounce("position", …)` in world.mjs and § 1 goes red;
// delete the in-flight hand-over in `startReadPool`'s exit handler and § 2's
// first leg answers 503; delete the respawn and its last leg times out.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { startReadPool, workerTakes } from "../src/read-workers.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const haveClone = existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"));

let tmp, pool;
const FLAGS = { WORLD_POSITIONS: "1", WORLD_MOVEMENT_V2: "1", WORLD_PRESENCE: "1" };
const was = Object.fromEntries(Object.keys(FLAGS).map((k) => [k, process.env[k]]));

/** Hand one GET to the pool, the way server.mjs does, and collect the answer. */
function read(url) {
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(`${url} was never answered`)), 180_000);
    const res = {
      writableEnded: false, destroyed: false, status: null, headers: null,
      writeHead(status, _reason, headers) { this.status = status; this.headers = headers; return this; },
      end(buf) { this.writableEnded = true; clearTimeout(t); ok({ status: this.status, headers: this.headers, body: Buffer.from(buf ?? "").toString("utf8") }); },
    };
    const req = { method: "GET", url, headers: { host: "localhost" }, socket: { remoteAddress: "127.0.0.1" } };
    if (!pool.forward(req, res)) { clearTimeout(t); no(new Error("no worker was ready")); }
  });
}

const until = async (what, fn, ms = 90_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`timed out waiting for ${what}`);
};

before(async () => {
  if (!haveClone) return;
  Object.assign(process.env, FLAGS);
  tmp = mkdtempSync(join(tmpdir(), "postmark-read-workers-"));
  fixtureDb(join(tmp, "fixture.db")).close();
  // A read-role office refuses to boot without the writer's two stores (see
  // server.mjs § OAUTH_DB_PATH), so they are made here the way the writer makes them.
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  openDynamic(join(tmp, "dynamic.db")).close();
  const { openOauthDb } = await import("../src/oauth.mjs");
  openOauthDb(join(tmp, "oauth.db")).close();
  pool = startReadPool({
    size: 2,
    entry: new URL("../src/server.mjs", import.meta.url),
    argv: ["--port", "0", "--db", join(tmp, "fixture.db"), "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")],
    env: { ...process.env, WORLD_DYNAMIC_DB: join(tmp, "dynamic.db"), TOWN_CLONE: join(ROOT, "town-clone") },
    log: { error: () => {} },
  });
  await until("both workers to be ready", () => pool.disclose().ready === 2);
});

after(async () => {
  if (pool) await pool.close();
  for (const [k, v] of Object.entries(was)) if (v == null) delete process.env[k]; else process.env[k] = v;
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("§ 1 a walk on the main thread is seen by the very next read on every worker", { skip: !haveClone && `needs the world clone at ${WORLD_CLONE}` }, async () => {
  const HANDLE = "read-worker-falsifier";
  const at = { x: 1234, y: -567 };
  const find = (r) => JSON.parse(r.body).walkers.find((w) => w.handle === HANDLE);

  // Both workers answer once first, so each has built its projection: a record
  // that reaches an unbuilt projection is left to its rebuild, which reads the
  // store, and this file has none — the announcement must be the only road.
  const warm = await Promise.all([read("/world/walkers"), read("/world/walkers")]);
  assert.deepEqual(warm.map((r) => r.headers["X-PM-Reader"]).sort(), ["worker-0", "worker-1"], "the two reads did not reach both workers");
  for (const r of warm) {
    assert.equal(r.status, 200);
    assert.equal(find(r), undefined, "the walker stands somewhere before she walked — the test proves nothing");
  }

  const { recordMoved } = await import("../src/world.mjs");
  const { worldToolModule } = await import("../src/dynamic-entities.mjs");
  const walk = await worldToolModule("walk.mjs", { repo: WORLD_CLONE });
  const now = Date.now();
  recordMoved({
    actor: HANDLE, from: at, toward: at, crossing: walk.fractionalCrossing(now), at: new Date(now).toISOString(),
    within: null, toMark: null, declaredBy: HANDLE, pace: null,
  });

  // IMMEDIATELY: no wait between the write and the reads.
  const after = await Promise.all([read("/world/walkers"), read("/world/walkers")]);
  assert.deepEqual(after.map((r) => r.headers["X-PM-Reader"]).sort(), ["worker-0", "worker-1"]);
  for (const r of after) {
    const w = find(r);
    assert.ok(w, `${r.headers["X-PM-Reader"]} answered without the walk the main thread just wrote`);
    assert.equal(w.x, at.x);
    assert.equal(w.y, at.y);
  }
});

test("§ 2 a killed worker's read is answered by another, the office keeps answering, and the slot is respawned", { skip: !haveClone && `needs the world clone at ${WORLD_CLONE}` }, async () => {
  const before = pool.threads();
  assert.ok(before.every((id) => id != null), "a worker was not up before the kill");

  // A read handed to worker 0 (both idle, so the first pick is slot 0), and
  // worker 0 killed before it can answer. /world/settlements, because it is
  // the slowest read the office has (a git child per settlement tag), so the
  // kill lands while it is still being read.
  const held = read("/world/settlements");
  const killed = pool.kill(0);
  const r = await held;
  await killed;
  assert.equal(r.status, 200, `the read the dead worker held was not answered (${r.status}: ${r.body.slice(0, 120)})`);
  assert.equal(r.headers["X-PM-Reader"], "worker-1");

  // While slot 0 is down, the office still answers.
  for (let i = 0; i < 3; i++) {
    const again = await read("/world/skeleton");
    assert.equal(again.status, 200);
  }

  // And slot 0 comes back as a new thread.
  await until("slot 0 to be respawned", () => pool.threads()[0] != null);
  const now = pool.threads();
  assert.notEqual(now[0], before[0], "slot 0 is the same thread — it was never killed");
  assert.equal(now[1], before[1]);
});

test("the dispatch rule: GETs go to workers except the main thread's RAM reads; writes, /mcp and the OAuth dance never do", () => {
  assert.equal(workerTakes("GET", "/world/walkers"), true);
  assert.equal(workerTakes("GET", "/world/conversations"), false);
  assert.equal(workerTakes("GET", "/world/dynamic"), false);
  assert.equal(workerTakes("GET", "/household"), false);
  assert.equal(workerTakes("POST", "/world/walks"), false);
  assert.equal(workerTakes("GET", "/mcp"), false);
  assert.equal(workerTakes("GET", "/oauth/authorize"), false);
});
