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
//   3. the synchronous readers fold the record through `attachmentRows`, never
//      the stale sqlite copy, once the snapshot has loaded.
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
const { attachmentRows, holdEdgeOnActs, holdingsStanding, reloadHoldings, resetHoldings } = await import("../src/holdings-snapshot.mjs");

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

const deps = (pen, moved) => ({
  witnessStamp: async () => ({ at: { anchor: "the-town/the-quay", dx: 0, dy: 0 }, witnesses: null }),
  resolvedWorldHousehold: () => null,
  currentCrossing: () => 221,
  appendActFlipped: pen,
  holdingsMoved: () => { moved.n += 1; },
});

beforeEach(() => { resetHoldings(); restoreEnv(); });

test("PROD'S FLAGS: take, give, drop — the acts are the edge and dynamic.db gets NO attachments row", async () => {
  prodFlags();
  assert.equal(holdEdgeOnActs(), true, "W2_PEN=hold with W2_GUARDS=1 puts the edge on acts");
  const rec = recordStandIn();
  const db = openDynamic(join(tmp, "prod-flags.db"));
  const moved = { n: 0 };
  try {
    const a = await declareHoldingFlipped({ db, thing: "maker/stool", actor: "alpha", deps: deps(rec.pen, moved) });
    // AWAITED BEFORE THE ANSWER: the stand-in pen lands its act only after a
    // real wait, so a door that answered on a fire-and-forget write would be
    // answering with the record still empty. With sqlite gone, that is a lost holding.
    assert.equal(rec.acts.length, 1, "the door answered before its act was in the record");
    assert.equal(a.seq, 1, "the receipt names the committed act's id");
    const b = await declareHoldingFlipped({ db, thing: "maker/stool", to: "beta", actor: "alpha", deps: deps(rec.pen, moved) });
    const c = await declareHoldingFlipped({ db, thing: "maker/stool", actor: "beta", deps: deps(rec.pen, moved) });
    assert.deepEqual([a.did, b.did, c.did], ["take", "give", "drop"], "each face is read off the RECORD's holder");
    assert.deepEqual([a.holder, b.holder, c.holder], ["alpha", "beta", null]);
    assert.equal(rec.acts.length, 3, "three acts in the record");
    assert.equal(count(db, "attachments"), 0, "the sqlite edge was written — the door still writes dynamic.db on prod's flags");
    assert.equal(moved.n, 3, "each committed act moves the holdings snapshot");
  } finally { db.close(); rec.restore(); }
});

test("THE QUEUE: two takes racing for one thing — one wins, the other is refused by name, never two holders", async () => {
  prodFlags();
  const rec = recordStandIn();
  const db = openDynamic(join(tmp, "race.db"));
  try {
    const moved = { n: 0 };
    const results = await Promise.allSettled([
      declareHoldingFlipped({ db, thing: "maker/lamp", actor: "alpha", deps: deps(rec.pen, moved) }),
      declareHoldingFlipped({ db, thing: "maker/lamp", actor: "beta", deps: deps(rec.pen, moved) }),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    assert.equal(won.length, 1, `exactly one take may stand; got ${won.length} (acts: ${rec.acts.map((x) => `${x.actor}:${x.action}`).join(", ")})`);
    assert.equal(lost[0].reason.code, 403, "the second hand is refused with the door's own 403");
    assert.match(lost[0].reason.defect, /alpha is holding maker\/lamp/);
    assert.equal(rec.acts.length, 1, "one act in the record");
  } finally { db.close(); rec.restore(); }
});

test("W2_GUARDS OFF: the holder check still reads sqlite, so the sqlite edge is still written (and the pen still first)", async () => {
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://hold-edge-test/none", W2_PEN: "hold" });
  delete process.env.W2_GUARDS;
  assert.equal(holdEdgeOnActs(), false);
  const rec = recordStandIn();
  const db = openDynamic(join(tmp, "guards-off.db"));
  try {
    const did = await declareHoldingFlipped({ db, thing: "maker/cup", actor: "alpha", deps: deps(rec.pen, { n: 0 }) });
    assert.equal(did.holder, "alpha");
    assert.equal(count(db, "attachments"), 1, "with the guards on sqlite, that office's edge must still be written");
  } finally { db.close(); rec.restore(); }
});

test("THE READERS: on prod's flags the arena and the portal fold the record's snapshot, not dynamic.db's stale copy", async () => {
  const db = openDynamic(join(tmp, "readers.db"));
  try {
    // dynamic.db as it stood when the door stopped writing it: alpha holds the stool.
    declareHolding({ db, thing: "maker/stool", actor: "alpha", dials: {} });
    prodFlags();
    assert.equal(holdingsStanding().source, "floor", "before the load, the floor is named");
    assert.deepEqual(attachmentRows(db).map((r) => r.entity), ["alpha"], "the floor is the sqlite file as it stood");
    // The record since: alpha gave it to beta.
    const loaded = await reloadHoldings({ read: async () => [
      { seq: null, entity: "alpha", target: "maker/stool", policy: "cascade", declared_by: "alpha", born_at: "2026-09-30T04:00:01.000Z" },
      { seq: null, entity: "beta", target: "maker/stool", policy: "cascade", declared_by: "alpha", born_at: "2026-09-30T04:00:02.000Z" },
    ] });
    assert.deepEqual(loaded, { loaded: true, count: 2 });
    assert.deepEqual(attachmentRows(db).map((r) => r.entity), ["alpha", "beta"], "the readers must fold the record once it has loaded");
    assert.equal(holdingsStanding().source, "acts");
    // Unflipped, sqlite is that office's record and the snapshot is never asked.
    restoreEnv();
    delete process.env.W2_PEN; delete process.env.W2_GUARDS;
    assert.deepEqual(attachmentRows(db).map((r) => r.entity), ["alpha"]);
  } finally { db.close(); }
});

test("CROSSING-SAVE: on prod's flags the save's attachments come from the record; a record that will not answer is thrown, never the file", async () => {
  const { attachmentsForSave } = await import("../tools/crossing-save.mjs");
  const db = openDynamic(join(tmp, "save.db"));
  try {
    declareHolding({ db, thing: "maker/stool", actor: "alpha", dials: {} });
    const record = [{ seq: null, entity: "beta", target: "maker/stool", policy: "cascade", declared_by: "alpha", born_at: "2026-09-30T04:00:02.000Z" }];
    assert.deepEqual((await attachmentsForSave(db, { onActs: true, read: async () => record })).map((r) => r.entity), ["beta"]);
    assert.deepEqual((await attachmentsForSave(db, { onActs: false, read: async () => record })).map((r) => r.entity), ["alpha"]);
    await assert.rejects(attachmentsForSave(db, { onActs: true, read: async () => { throw new Error("connection refused"); } }), /connection refused/);
  } finally { db.close(); }
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
        currentCrossing: () => 1, holdingsMoved: () => {} } });
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

// ── CROSSING-SAVE, BYTE PARITY (Wright's condition 3 on (a)) ────────────────
// One run of the door with BOTH stores written (the guards-off arm writes the
// sqlite edge inside its transaction and the stand-in pen writes the act), so
// the two sources hold the same holdings at the same instants. Then the save is
// built from each, and the bytes compared.

test("CROSSING-SAVE PARITY: the snapshot from acts is byte-equal to the snapshot from dynamic.db; the log lines differ in `seq` alone", async () => {
  prodFlags();
  const rec = recordStandIn();
  const db = openDynamic(join(tmp, "parity.db"));
  try {
    const both = { ...deps(rec.pen, { n: 0 }), onActs: false };
    await declareHoldingFlipped({ db, thing: "maker/stool", actor: "alpha", deps: both });
    await declareHoldingFlipped({ db, thing: "maker/stool", to: "beta", actor: "alpha", deps: both });
    await declareHoldingFlipped({ db, thing: "maker/lamp", actor: "beta", deps: both });
    await declareHoldingFlipped({ db, thing: "maker/stool", actor: "beta", deps: both });
    const { readAttachments } = await import("../src/dynamic-entities.mjs");
    const { storeAttachmentRows } = await import("../src/world2-guards.mjs");
    const { buildSave, stableJson } = await import("../tools/crossing-save.mjs");
    const fromSqlite = readAttachments(db);
    const fromActs = await storeAttachmentRows();
    assert.equal(fromSqlite.length, 4);
    assert.equal(fromActs.length, 4);
    const at = (rows) => rows.map((r) => Date.parse(r.born_at));
    const lo = Math.min(...at(fromSqlite)) - 1, hi = Math.max(...at(fromSqlite)) + 1;
    const save = (attachments) => buildSave({ crossing: 221, boundaryMs: hi, fromMs: lo, toMs: hi, crossingMs: 43_200_000,
      events: [], attachments, emissions: [], walk: null, asOfWorld: "0".repeat(40) });
    const s = save(fromSqlite), a = save(fromActs);
    assert.equal(stableJson(a.snapshot), stableJson(s.snapshot), "the snapshot written from acts is not byte-equal to the one written from dynamic.db");
    // THE KNOWN DIFFERENCE, asserted exactly so any other one is red: a log
    // line carries `seq`, which is a sqlite rowid, and a live act has none.
    assert.equal(a.lines.length, s.lines.length);
    assert.deepEqual(a.lines.map((l) => ({ ...l, seq: undefined })), s.lines.map((l) => ({ ...l, seq: undefined })), "the log lines differ in more than seq");
    assert.deepEqual(s.lines.map((l) => l.seq), [1, 2, 3, 4]);
    assert.deepEqual(a.lines.map((l) => l.seq), [null, null, null, null]);
    if (process.env.PARITY_OUT) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(process.env.PARITY_OUT, "save-from-sqlite.json"), stableJson(s));
      writeFileSync(join(process.env.PARITY_OUT, "save-from-acts.json"), stableJson(a));
    }
  } finally { db.close(); rec.restore(); }
});
