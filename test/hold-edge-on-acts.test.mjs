// hold-edge-on-acts.test.mjs — the hold edge onto acts (POS-269, lane
// retire-sqlite-world).
//
// Prod runs the hold lane flipped (W2_PEN has hold) AND the guards flipped
// (W2_GUARDS=1): the pen writes the holding act, and the door's holder check
// reads the acts back. In that configuration the sqlite `attachments` edge had
// no reader left but three synchronous ones (the arena, the portal block,
// crossing-save), and writing it cost a `BEGIN IMMEDIATE` on dynamic.db held
// across the Postgres round trip on every give, drop and take. So:
//
//   1. the door writes nothing to dynamic.db, and the act is the edge;
//   2. what serialized the holder check against the write is an in-process
//      queue, and two holds racing for one thing still cannot both win;
//   3. crossing-save reads holdings from the record, never the stale sqlite copy.
//      (The arena and the portal block read a snapshot of it until the arena
//      closed on 2026-09-30; they and the snapshot are gone.)
//
// The record is stood in for by an in-memory `acts` that answers the guard's
// own attachments query (`pgAttachmentsFor`) and that the stub pen appends to.

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmp = mkdtempSync(join(tmpdir(), "postmark-hold-edge-"));
after(() => { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } });

const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL", "W2_PEN", "W2_GUARDS"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
const restoreEnv = () => { for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; } };
const prodFlags = () => Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://hold-edge-test/none", W2_PEN: "hold", W2_GUARDS: "1" });
after(restoreEnv);

const { openDynamic } = await import("../src/dynamic-store.mjs");
const { declareHoldingFlipped, declareHolding } = await import("../src/world-hold.mjs");
const { useGuardReader } = await import("../src/world2-guards.mjs");
const { holdEdgeOnActs } = await import("../src/hold-edge.mjs");

const count = (db, table) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);

// The record: acts rows in the shape the pen writes and `pgAttachmentsFor` reads.
function recordStandIn() {
  const acts = [];
  let t = Date.parse("2026-09-30T04:00:00Z");
  const restore = useGuardReader(async (fn) => fn({
    query: async (sql, params) => {
      if (!/FROM acts WHERE action = ANY/.test(String(sql))) throw new Error(`this stand-in answers the attachments read only: ${String(sql).slice(0, 80)}`);
      const want = new Set(params[0]);
      return { rows: acts.filter((a) => want.has(a.action)).sort((a, b) => (a.at - b.at) || (a.id - b.id)) };
    },
  }));
  // The pen: appends the act the door handed it, after a real await, so two
  // holds that are not serialized both read the record before either lands.
  const pen = async (_db, entry) => {
    await new Promise((r) => setTimeout(r, 15));
    const id = acts.length + 1;
    // `at` is the entry's own stamp, as the real pen writes `acts.at` from the
    // journal row's `written_at` (world2-pen § actsInsert).
    acts.push({ id, at: new Date(entry.writtenAt ?? (t += 1000)), actor: entry.actor, action: entry.action, payload: entry.payload });
    return { seq: null, actId: id, flipped: true };
  };
  return { acts, pen, restore };
}

const deps = (pen) => ({
  witnessStamp: async () => ({ at: { anchor: "the-town/the-quay", dx: 0, dy: 0 }, witnesses: null }),
  resolvedWorldHousehold: () => null,
  currentCrossing: () => 221,
  appendActFlipped: pen,
});

beforeEach(() => { restoreEnv(); });

test("PROD'S FLAGS: take, give, drop — the acts are the edge and dynamic.db gets NO attachments row", async () => {
  prodFlags();
  assert.equal(holdEdgeOnActs(), true, "W2_PEN=hold with W2_GUARDS=1 puts the edge on acts");
  const rec = recordStandIn();
  const db = openDynamic(join(tmp, "prod-flags.db"));
  try {
    const a = await declareHoldingFlipped({ db, thing: "maker/stool", actor: "alpha", deps: deps(rec.pen) });
    // AWAITED BEFORE THE ANSWER: the stand-in pen lands its act only after a
    // real wait, so a door that answered on a fire-and-forget write would be
    // answering with the record still empty. With sqlite gone, that is a lost holding.
    assert.equal(rec.acts.length, 1, "the door answered before its act was in the record");
    assert.equal(a.seq, 1, "the receipt names the committed act's id");
    const b = await declareHoldingFlipped({ db, thing: "maker/stool", to: "beta", actor: "alpha", deps: deps(rec.pen) });
    const c = await declareHoldingFlipped({ db, thing: "maker/stool", actor: "beta", deps: deps(rec.pen) });
    assert.deepEqual([a.did, b.did, c.did], ["take", "give", "drop"], "each face is read off the RECORD's holder");
    assert.deepEqual([a.holder, b.holder, c.holder], ["alpha", "beta", null]);
    assert.equal(rec.acts.length, 3, "three acts in the record");
    assert.equal(count(db, "attachments"), 0, "the sqlite edge was written — the door still writes dynamic.db on prod's flags");
  } finally { db.close(); rec.restore(); }
});

test("THE QUEUE: two takes racing for one thing — one wins, the other is refused by name, never two holders", async () => {
  prodFlags();
  const rec = recordStandIn();
  const db = openDynamic(join(tmp, "race.db"));
  try {
    const results = await Promise.allSettled([
      declareHoldingFlipped({ db, thing: "maker/lamp", actor: "alpha", deps: deps(rec.pen) }),
      declareHoldingFlipped({ db, thing: "maker/lamp", actor: "beta", deps: deps(rec.pen) }),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    assert.equal(won.length, 1, `exactly one take may stand; got ${won.length} (acts: ${rec.acts.map((x) => `${x.actor}:${x.action}`).join(", ")})`);
    assert.equal(lost[0].reason.code, 403, "the second hand is refused with the door's own 403");
    assert.match(lost[0].reason.defect, /alpha is holding maker\/lamp/);
    assert.equal(rec.acts.length, 1, "one act in the record");
  } finally { db.close(); rec.restore(); }
});

test("W2_GUARDS OFF: the flipped pen refuses by name — there is no sqlite edge left to read or write (POS-269)", async () => {
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://hold-edge-test/none", W2_PEN: "hold" });
  delete process.env.W2_GUARDS;
  assert.equal(holdEdgeOnActs(), false);
  const rec = recordStandIn();
  try {
    await assert.rejects(declareHoldingFlipped({ db: null, thing: "maker/cup", actor: "alpha", deps: deps(rec.pen) }),
      (e) => e.code === 503 && /holding things needs the hold lane's record/.test(e.message));
    assert.equal(rec.acts.length, 0, "and nothing reached the record");
  } finally { rec.restore(); }
});

test("CROSSING-SAVE: the save's attachments are the record's; off the hold lane it refuses by name; a record that will not answer is thrown, never a file", async () => {
  const { attachmentsForSave, RecordPreconditionError } = await import("../tools/crossing-save.mjs");
  const record = [{ seq: null, entity: "beta", target: "maker/stool", policy: "cascade", declared_by: "alpha", born_at: "2026-09-30T04:00:02.000Z" }];
  assert.deepEqual((await attachmentsForSave({ onActs: true, read: async () => record, fixture: null })).map((r) => r.entity), ["beta"]);
  await assert.rejects(attachmentsForSave({ onActs: false, read: async () => record, fixture: null }),
    (e) => e instanceof RecordPreconditionError && /the hold lane must be flipped/.test(e.message), "off the hold lane there is no record of holdings, and dynamic.db no longer stands in");
  await assert.rejects(attachmentsForSave({ onActs: true, read: async () => { throw new Error("connection refused"); }, fixture: null }), /connection refused/);
});

// ── ONE THREAD (Wright's condition 1 on (a)) ────────────────────────────────
// The holding queue is in-process, so it only serializes holds that all run on
// the main thread. Two walls, each held here: the router sends no hold write to
// a worker, and a hold that reached a worker anyway refuses before it reads.

test("ONE THREAD, THE ROUTER: every hold write stays on the main thread (REST, MCP, apex do:), and a read still goes to a worker", async () => {
  const { workerTakes, mcpWorkerTakes } = await import("../src/read-workers.mjs");
  const call = (name, args) => [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }];
  assert.equal(workerTakes("POST", "/world/hold"), false, "POST /world/hold was routed to a worker");
  assert.equal(workerTakes("POST", "/world/apex"), false, "POST /world/apex (do: give|drop|take) was routed to a worker");
  assert.equal(mcpWorkerTakes(call("world_hold", { thing: "maker/stool" })), false, "the MCP world_hold call was routed to a worker");
  for (const act of ["give", "drop", "take"])
    assert.equal(mcpWorkerTakes(call("world", { do: act, args: { thing: "maker/stool" } })), false, `the MCP world do:${act} was routed to a worker`);
  // the can-fail control: the router does hand reads to workers
  assert.equal(mcpWorkerTakes(call("world", { read: "orient" })), true, "a bare world read should go to a worker (the control)");
  assert.equal(workerTakes("GET", "/world/orient"), true, "GET /world/orient should go to a worker (the control)");
});

test("ONE THREAD, THE SECOND WALL: a hold that reaches a read worker refuses before it reads or writes anything", async () => {
  const { Worker } = await import("node:worker_threads");
  const { writeFileSync } = await import("node:fs");
  const { pathToFileURL } = await import("node:url");
  const hold = pathToFileURL(join(import.meta.dirname, "..", "src", "world-hold.mjs")).href;
  const script = join(tmp, "hold-in-worker.mjs");
  writeFileSync(script, `
    import { parentPort } from "node:worker_threads";
    const { declareHoldingFlipped } = await import(${JSON.stringify(hold)});
    let pens = 0;
    try {
      await declareHoldingFlipped({ db: null, thing: "maker/stool", actor: "alpha", deps: {
        onActs: true, appendActFlipped: async () => { pens++; return { actId: 1 }; },
        witnessStamp: async () => ({ at: null, witnesses: null }), resolvedWorldHousehold: () => null,
        currentCrossing: () => 1 } });
      parentPort.postMessage({ refused: false, pens });
    } catch (e) { parentPort.postMessage({ refused: true, message: String(e?.message ?? e), pens }); }
  `);
  const out = await new Promise((resolve, reject) => {
    const w = new Worker(script, { workerData: { readWorker: true, slot: 0 } });
    w.once("message", (m) => { resolve(m); w.terminate(); });
    w.once("error", reject);
  });
  assert.equal(out.refused, true, `a hold ran inside a read worker: ${JSON.stringify(out)}`);
  assert.match(out.message, /main thread only/);
  assert.equal(out.pens, 0, "the pen must not be tried from a worker");
});

// ── CROSSING-SAVE, BYTE PARITY (Wright's condition 3 on (a)) — RETIRED ──────
// This ran the door with BOTH stores written (the guards-off arm wrote the
// sqlite edge, the stand-in pen the act) and held the save built from each
// byte-equal, differing in `seq` alone. It was the gate for moving the save's
// holdings onto acts, and it passed there. The guards-off arm it needed is
// gone with dynamic.db (POS-269), so there is no second source to compare;
// the save reads the record only (the CROSSING-SAVE test above).

test("NO SQLITE AT THE DOOR: on prod's flags the holdings read opens no dynamic.db — a store that is not a database is never touched", async () => {
  prodFlags();
  const rec = recordStandIn();
  const { writeFileSync } = await import("node:fs");
  const garbage = join(tmp, "not-a-database.db");
  writeFileSync(garbage, "this is not a sqlite file, and any open of it throws\n");
  const was = process.env.WORLD_DYNAMIC_DB;
  process.env.WORLD_DYNAMIC_DB = garbage;
  try {
    await rec.pen(null, { actor: "alpha", action: "take", payload: { thing: "maker/stool", holder: "alpha", policy: "cascade" }, writtenAt: "2026-09-30T05:00:00.000Z" });
    const { callHoldTool } = await import("../src/world-hold.mjs");
    const r = await callHoldTool("world_holdings", { handle: "alpha" }, { handles: new Set(["alpha"]) });
    assert.equal(r.error, undefined, `the read failed: ${JSON.stringify(r).slice(0, 200)}`);
    assert.equal(r.count, 1, "alpha's holding comes from the record");
    assert.deepEqual(r.holding.map((h) => h.thing), ["maker/stool"]);
  } finally {
    if (was === undefined) delete process.env.WORLD_DYNAMIC_DB; else process.env.WORLD_DYNAMIC_DB = was;
    rec.restore();
  }
});
