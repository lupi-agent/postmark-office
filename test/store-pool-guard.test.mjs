// store-pool-guard.test.mjs — the guard POS-370 puts on every office pool, on a
// real Postgres: a nested pen ask is refused by name, a pool with nothing to
// give refuses in WORLD2_PG_ACQUIRE_MS instead of hanging, the server ends a
// transaction left idle (and the office survives it), and the watcher sees a
// session idle in transaction.
//
//   node --test test/store-pool-guard.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { startStore } from "./helpers/embedded-store.mjs";
import {
  storePoolOptions, acquireMs, idleTxMs, ACQUIRE_MS_DEFAULT, IDLE_TX_MS_DEFAULT,
  NestedStoreError, StoreAcquireTimeout, penHeld,
} from "../src/store-pool.mjs";
import { createStoreTxnWatch, lookOnce } from "../src/store-txn-watch.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "store-pool-guard-"));
let s = null, skip = false;
const KEEP = Object.fromEntries(["WORLD2_PG", "WORLD2_PG_URL", "WORLD2_PG_ACQUIRE_MS", "WORLD2_PG_IDLE_TX_MS"].map((k) => [k, process.env[k]]));
const restore = () => { for (const [k, v] of Object.entries(KEEP)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

before(async () => {
  s = await startStore({ db: "pool_guard" });
  if (s.skip) { skip = s.skip; return; }
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
});

after(async () => {
  const pen = await import("../src/world2-pen.mjs");
  pen.__setPoolForTest(null);
  if (s?.stop) await s.stop();
  restore();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A pen pool built exactly as the office builds it, from this env, handed to the pen. */
async function penFrom(env) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool(storePoolOptions({ ...process.env, ...env }, { name: "pen", max: 3 }));
  pool.on("error", () => {});
  const pen = await import("../src/world2-pen.mjs");
  pen.__setPoolForTest(pool);
  return { pool, pen, held: () => pool.totalCount - pool.idleCount, async done() { pen.__setPoolForTest(null); await pool.end().catch(() => {}); } };
}

test("the pool options: the acquire timeout and the idle-transaction limit default, and the env sets them", () => {
  assert.equal(acquireMs({}), ACQUIRE_MS_DEFAULT);
  assert.equal(idleTxMs({}), IDLE_TX_MS_DEFAULT);
  assert.equal(acquireMs({ WORLD2_PG_ACQUIRE_MS: "2500" }), 2500);
  assert.equal(idleTxMs({ WORLD2_PG_IDLE_TX_MS: "0" }), 0, "0 is a real value (no limit)");
  assert.equal(acquireMs({ WORLD2_PG_ACQUIRE_MS: "soon" }), ACQUIRE_MS_DEFAULT, "an unreadable value is the default");
  const o = storePoolOptions({ WORLD2_PG_URL: "postgres://x" }, { name: "pen", max: 3 });
  assert.equal(o.connectionString, "postgres://x");
  assert.equal(o.max, 3);
  assert.equal(o.connectionTimeoutMillis, ACQUIRE_MS_DEFAULT);
  assert.equal(o.idle_in_transaction_session_timeout, IDLE_TX_MS_DEFAULT);
  assert.match(o.application_name, /^postmark-office:pen:t\d+$/);
});

test("every office pool is built with the options: no bare new pg.Pool left in src", () => {
  // the pen, the acts and stance pools, claims, serve and paperwork: a pool
  // built without the options would hang where the others refuse
  for (const f of ["world2-pen.mjs", "world2-acts.mjs", "world2-claims.mjs", "world2-serve.mjs", "paperwork.mjs"]) {
    // code lines only: a comment may quote the bare constructor it warns about
    const code = readFileSync(join(ROOT, "src", f), "utf8").split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    const pools = code.match(/new pg\.Pool\(([^)]*\)?)/g) ?? [];
    assert.ok(pools.length > 0, `${f} builds a pool`);
    for (const p of pools) assert.match(p, /storePoolOptions\(/, `${f}: ${p}`);
  }
});

test("a pen connection reaches the store with the server-side idle-transaction limit and its pool's name", async (t) => {
  if (skip) return t.skip(skip);
  const pen = await penFrom({});
  try {
    const got = await pen.pen.officeRead(async (c) => ({
      idle: (await c.query("SHOW idle_in_transaction_session_timeout")).rows[0].idle_in_transaction_session_timeout,
      app: (await c.query("SELECT current_setting('application_name') AS a")).rows[0].a,
    }));
    assert.equal(got.idle, "30s");
    assert.match(got.app, /^postmark-office:pen:t\d+$/);
  } finally { await pen.done(); }
});

test("a call that holds a pen connection and asks for another is refused at once, by name, and gives its own back", async (t) => {
  if (skip) return t.skip(skip);
  const pen = await penFrom({});
  try {
    const started = Date.now();
    await assert.rejects(pen.pen.officeRead(async () => pen.pen.officeRead(async (c) => c.query("SELECT 1"))),
      (e) => e instanceof NestedStoreError && /officeRead asked the store's pen for a connection while this call already holds one \(officeRead\)/.test(e.message));
    await assert.rejects(pen.pen.officeRead(async () => pen.pen.officeWrite(async (c) => c.query("SELECT 1"))), NestedStoreError);
    await assert.rejects(pen.pen.officeWrite(async () => pen.pen.officeRead(async (c) => c.query("SELECT 1"))), NestedStoreError);
    assert.ok(Date.now() - started < 5000, "refused, not waited out");
    assert.equal(pen.held(), 0, "the outer connection came back");
    assert.equal(penHeld(), null, "nothing is marked held after");
    // two requests at once are two chains: neither is refused
    const both = await Promise.all([1, 2].map((n) => pen.pen.officeRead(async (c) => (await c.query("SELECT $1::int AS n", [n])).rows[0].n)));
    assert.deepEqual(both, [1, 2]);
    // work a read started and did not await is not holding once the read is done
    let later = null;
    await pen.pen.officeRead(async () => { later = (async () => { await sleep(50); return pen.pen.officeRead(async (c) => (await c.query("SELECT 7 AS n")).rows[0].n); })(); });
    assert.equal(await later, 7);
    assert.equal(pen.held(), 0);
  } finally { await pen.done(); }
});

test("a pool with nothing to give refuses within the acquire timeout, naming the pool, instead of waiting", async (t) => {
  if (skip) return t.skip(skip);
  const pen = await penFrom({ WORLD2_PG_ACQUIRE_MS: "400" });
  try {
    let open;
    const gate = new Promise((ok) => { open = ok; });
    const holders = [1, 2, 3].map(() => pen.pen.officeRead(async (c) => { await c.query("SELECT 1"); await gate; return "held"; }));
    await sleep(200);
    assert.equal(pen.held(), 3);
    const started = Date.now();
    await assert.rejects(pen.pen.officeRead(async (c) => c.query("SELECT 1")),
      (e) => e instanceof StoreAcquireTimeout && /the store's pen pool had no free connection within 400 ms \(it holds 3\)/.test(e.message));
    const waited = Date.now() - started;
    assert.ok(waited >= 300 && waited < 3000, `refused after ${waited} ms`);
    open();
    assert.deepEqual(await Promise.all(holders), ["held", "held", "held"]);
    assert.equal(pen.held(), 0);
  } finally { await pen.done(); }
});

test("a transaction left idle is ended by the server; the call fails, the office lives, and the pool serves the next call", async (t) => {
  if (skip) return t.skip(skip);
  const pen = await penFrom({ WORLD2_PG_IDLE_TX_MS: "300" });
  try {
    await assert.rejects(pen.pen.officeRead(async (c) => { await c.query("SELECT 1"); await sleep(1200); return (await c.query("SELECT 2")).rows; }));
    assert.equal(pen.held(), 0, "the ended connection is not held");
    assert.equal(await pen.pen.officeRead(async (c) => (await c.query("SELECT 3 AS n")).rows[0].n), 3, "the next call is served");
  } finally { await pen.done(); }
});

test("the watcher sees an office_api session idle in transaction, and not once it commits", async (t) => {
  if (skip) return t.skip(skip);
  const stuck = await s.connect("office_api");
  const looker = await s.connect("office_api");
  try {
    await stuck.query("BEGIN READ ONLY");
    await stuck.query("SELECT 'the progress read' AS q");
    await sleep(1300);
    const seen = await lookOnce(looker, { stuckAfterS: 1 });
    assert.equal(seen.stuck.length, 1, JSON.stringify(seen));
    assert.match(seen.stuck[0].query, /the progress read/);
    assert.ok(seen.stuck[0].idle_s >= 1);
    assert.ok((seen.sessions["idle in transaction"] ?? 0) >= 1);
    await stuck.query("COMMIT");
    assert.equal((await lookOnce(looker, { stuckAfterS: 1 })).stuck.length, 0);
  } finally { await stuck.end(); await looker.end(); }
});

test("calm_at moves only on a minute the store answered with nothing stuck", async () => {
  let t0 = Date.parse("2026-10-04T19:30:00Z");
  const answers = [
    { stuck: [], sessions: { idle: 3 } },
    { stuck: [{ pid: 1, idle_s: 61, query: "SELECT … town_quest_progress" }], sessions: { "idle in transaction": 1 } },
    new Error("connect ECONNREFUSED"),
    { stuck: [], sessions: {} },
  ];
  const file = join(tmp, "store-txn-0.json");
  const w = createStoreTxnWatch({ file, now: () => t0, look: async () => { const a = answers.shift(); if (a instanceof Error) throw a; return a; } });
  await w.tick();
  assert.equal(w.read().calm_at, "2026-10-04T19:30:00.000Z");
  t0 += 60_000; await w.tick();
  assert.equal(w.read().calm_at, "2026-10-04T19:30:00.000Z", "a stuck minute is not calm");
  assert.equal(w.read().last_minute.stuck, 1);
  assert.equal(w.read().worst_24h.stuck, 1);
  t0 += 60_000; await w.tick();
  assert.equal(w.read().calm_at, "2026-10-04T19:30:00.000Z", "a minute it could not ask is not calm");
  assert.equal(w.read().last_minute.looked, false);
  t0 += 60_000; await w.tick();
  assert.equal(w.read().calm_at, "2026-10-04T19:33:00.000Z");
  // a restart carries the last calm minute; it does not make the store calm by itself
  const again = createStoreTxnWatch({ file, now: () => t0, look: async () => ({ stuck: [{ pid: 2 }], sessions: {} }) });
  assert.equal(again.read().calm_at, "2026-10-04T19:33:00.000Z");
});

test("the roll-call watches the file: office_api idle in transaction for 5 minutes is an alarm", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "deploy", "box-rollcall-manifest.json"), "utf8"));
  const row = manifest.units.find((r) => r.heartbeat?.path === "/srv/postmark-office/telemetry/store-txn-4380.json");
  assert.ok(row, "a roll-call row reads the watcher's file");
  assert.equal(row.unit, "postmark-office.service");
  assert.equal(row.heartbeat.kind, "state_file");
  assert.equal(row.heartbeat.stamp_field, "calm_at");
  assert.equal(row.heartbeat.stale_after_minutes, 5);
});
