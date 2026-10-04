// town-index-pool-leak.test.mjs — POS-370's falsifier: switch 2's quest board
// never holds a store connection while it waits for another.
//
//   node --test test/town-index-pool-leak.test.mjs      (WORLD_CLONE=<a world clone> for the last two)
//
// 2026-10-04: with TOWN_INDEX_READS=store on prod, nine office_api sessions sat
// "idle in transaction" for 81 and 48 minutes, every one last running the quest
// board's town_quest_progress read, and the office's index reads stalled behind
// them for an hour. The board read its progress row inside the pen's READ ONLY
// transaction and then, still holding it, asked the world whether the
// resident's home stands; with the kept positions on, that world read rebuilds
// the positions projection through officeRead, a SECOND connection from the
// same pool of three. Three boards held all three and waited for a fourth.
//
// Every test here runs the board's doors CONCURRENTLY against a real Postgres
// and a pen pool of prod's size (three), through the branches a board takes (a
// good row, a bent row, no row, the town's board with no resident, a world read
// that throws, a read the store refuses mid-transaction), and asserts:
//   · every read answered, inside a deadline (a drained pool never answers);
//   · the pool has nothing checked out and nobody waiting afterwards;
//   · no session of office_api is idle in a transaction afterwards.
//
// The first test needs only the store and the town clone: its world read is a
// stand-in that asks the pen, as the projection's rebuild does. The last two run
// the REAL world read (WORLD_POSITIONS=1, WORLD_MOVEMENT_V2=1, a world clone),
// in this process and through a spawned office's GET /quests/{h}; without
// WORLD_CLONE they skip and say so.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { copyIndexToStore } from "./helpers/index-to-store.mjs";
import { townClone, townModuleUrl } from "./fixture-paths.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOWN = townClone();
const WORLD = process.env.WORLD_CLONE && existsSync(process.env.WORLD_CLONE) ? process.env.WORLD_CLONE : null;
const NO_WORLD = "WORLD_CLONE names no world clone: the real world read (the positions projection's rebuild) needs one";
const tmp = mkdtempSync(join(tmpdir(), "town-index-pool-leak-"));
const dbPath = join(tmp, "office.db");
const ROUNDS = 4, WIDTH = 12, DEADLINE_MS = 30_000;
let s = null, su = null, skip = TOWN ? false : "no town clone beside the office: the quest board reads the town's own tools from it";
let child = null;

// This process reads the store as a switched office does; the flags the world
// read keys on are read per call, so they are set before anything asks.
const KEEP = Object.fromEntries(["TOWN_INDEX_READS", "WORLD2_PG", "WORLD2_PG_URL", "WORLD_POSITIONS", "WORLD_MOVEMENT_V2"].map((k) => [k, process.env[k]]));

before(async () => {
  if (skip) return;
  s = await startStore({ db: "pool_leak" });
  if (s.skip) { skip = s.skip; return; }
  const { townDay } = await import(townModuleUrl("tools", "quest-progress.mjs"));
  const db = fixtureDb(dbPath);
  const put = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  put.run("quest_registry", readFileSync(join(TOWN, "quest-registry.json"), "utf8"));
  put.run("quest_day", townDay());
  const qp = db.prepare("INSERT INTO quest_progress (handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  qp.run("wright", 2, 1, 1, 2, 1, JSON.stringify(["limen"]), JSON.stringify(["limen"]));
  qp.run("limen", 0, 3, 2, 1, 3, "not json", null); // a bent row degrades to no names
  db.prepare("INSERT INTO quest_standing VALUES (?, ?)").run("wright", JSON.stringify({ facts: { address: true }, since: {} }));
  db.prepare("INSERT INTO pots VALUES (?, ?)").run("darko-fund", JSON.stringify({ title: "Darko's fund", beneficiary: "keeminlee", target_usd_per_epoch: 100, status: "open", close: "epoch" }));
  const w = await s.connect("law_ingester");
  await copyIndexToStore(w, db);
  await w.end();
  db.close();
  su = await s.connect("postgres", "postgres");
  Object.assign(process.env, { TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
});

after(async () => {
  if (child && child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  // a drained pool's sessions are ended here, so a failing run still exits
  if (su) { await su.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'office_api'").catch(() => {}); await su.end().catch(() => {}); }
  if (s?.stop) await s.stop();
  for (const [k, v] of Object.entries(KEEP)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** End every office_api session (a drained pool's, from a test that failed before this one). */
async function endStuck() {
  await su.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'office_api' AND state LIKE 'idle in transaction%'");
}

/** office_api's sessions idle inside a transaction, as the store sees them. */
async function idleInTransaction() {
  const { rows } = await su.query(
    "SELECT pid, application_name, left(query, 120) AS query FROM pg_stat_activity WHERE usename = 'office_api' AND state LIKE 'idle in transaction%'");
  return rows;
}

/** A pen pool of prod's size, handed to the pen, and what it holds. A failed test's stuck sessions are ended first, so each test's count is its own. */
async function prodSizedPen() {
  await endStuck();
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 3 });
  pool.on("error", () => {});
  const pen = await import("../src/world2-pen.mjs");
  pen.__setPoolForTest(pool);
  return {
    pool, officeRead: pen.officeRead,
    held: () => ({ out: pool.totalCount - pool.idleCount, waiting: pool.waitingCount }),
    // a drained pool's end() waits for connections that never come back; the
    // store's sessions are ended in after(), so this waits only a moment
    async done() { pen.__setPoolForTest(null); await Promise.race([pool.end().catch(() => {}), new Promise((ok) => setTimeout(ok, 2000))]); },
  };
}

/**
 * Every read settled before the deadline, or the test fails naming how many
 * never answered and what the pool and the store held at that moment.
 */
async function allAnswer(label, reads, pen) {
  let timer;
  const settled = Promise.allSettled(reads);
  const late = new Promise((ok) => { timer = setTimeout(() => ok("late"), DEADLINE_MS); });
  const got = await Promise.race([settled, late]);
  clearTimeout(timer);
  if (got === "late") {
    const stuck = await idleInTransaction();
    assert.fail(`${label}: reads were still waiting after ${DEADLINE_MS} ms; the pool held ${JSON.stringify(pen.held())} and the store had ${stuck.length} office_api session(s) idle in transaction (${stuck.map((r) => r.query).join(" | ")})`);
  }
  return got;
}

async function nothingHeld(label, pen) {
  assert.deepEqual(pen.held(), { out: 0, waiting: 0 }, `${label}: the pool still holds connections`);
  assert.deepEqual(await idleInTransaction(), [], `${label}: office_api sessions are idle in transaction`);
}

test("the household quest board, many at once, through every branch, with a world read that asks the pen: every read answers and nothing is held after", async (t) => {
  if (skip) return t.skip(skip);
  const pen = await prodSizedPen();
  try {
    const { storeIndexPooled } = await import("../src/town-index-store.mjs");
    const ix = storeIndexPooled(TOWN);
    // the stand-in for the kept positions' rebuild: it asks the pen, then answers
    const asksThePen = async () => { await pen.officeRead((c) => c.query("SELECT 1")); return { sited: true }; };
    const throws = async () => { throw new Error("the world cannot be read this minute"); };
    for (let round = 0; round < ROUNDS; round++) {
      const reads = [];
      for (let i = 0; i < WIDTH; i++) {
        const branch = i % 6;
        if (branch === 0) reads.push(ix.questBoard("wright", { worldBlock: asksThePen }));
        if (branch === 1) reads.push(ix.questBoard("limen", { worldBlock: asksThePen }));
        if (branch === 2) reads.push(ix.questBoard("nobody", { worldBlock: asksThePen }));
        if (branch === 3) reads.push(ix.questBoard(null));
        if (branch === 4) reads.push(ix.questBoard("wright", { worldBlock: throws }));
        if (branch === 5) reads.push(ix.questBoard("bent handle", { worldBlock: asksThePen })); // the store refuses the read inside the transaction: the ROLLBACK path
      }
      const got = await allAnswer(`round ${round}`, reads, pen);
      got.forEach((r, i) => {
        if (i % 6 === 5) assert.equal(r.status, "rejected", "a read the store refuses is the reader's own error");
        else assert.equal(r.status, "fulfilled", `read ${i} (branch ${i % 6}): ${r.reason?.message ?? ""}`);
      });
      await nothingHeld(`round ${round}`, pen);
    }
  } finally { await pen.done(); }
});

test("the REAL world read (kept positions on): the household board and read_quests, many at once, answer and hold nothing after", async (t) => {
  if (skip) return t.skip(skip);
  if (!WORLD) return t.skip(NO_WORLD);
  Object.assign(process.env, { WORLD_POSITIONS: "1", WORLD_MOVEMENT_V2: "1" });
  const pen = await prodSizedPen();
  try {
    const world = await import("../src/world.mjs");
    const { storeIndexPooled } = await import("../src/town-index-store.mjs");
    const { callTool } = await import("../src/mcp.mjs");
    const ix = storeIndexPooled(TOWN);
    for (let round = 0; round < 2; round++) {
      world.positionProjection.invalidate(); // the minute the projection is due its rebuild
      const reads = [];
      for (let i = 0; i < WIDTH; i++) {
        if (i % 2) reads.push(ix.questBoard(i % 4 === 1 ? "wright" : "limen"));
        else reads.push(callTool("read_quests", { handle: "wright" }, { clone: TOWN }));
      }
      const got = await allAnswer(`real world, round ${round}`, reads, pen);
      got.forEach((r, i) => assert.equal(r.status, "fulfilled", `read ${i}: ${r.reason?.message ?? ""}`));
      await nothingHeld(`real world, round ${round}`, pen);
    }
  } finally {
    await pen.done();
    delete process.env.WORLD_POSITIONS; delete process.env.WORLD_MOVEMENT_V2;
  }
});

test("a spawned office with switch 2 and the kept positions on answers GET /quests/{h} many at once, and leaves no session idle in transaction", async (t) => {
  if (skip) return t.skip(skip);
  if (!WORLD) return t.skip(NO_WORLD);
  await endStuck();
  child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
    "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, TOWN_CLONE: TOWN, WORLD_CLONE: WORLD, VOICES_LOG: join(tmp, "voices.jsonl"),
      TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"), OFFICE_READ_WORKERS: "0",
      TOWN_INDEX_READS: "store", WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api"),
      WORLD_POSITIONS: "1", WORLD_MOVEMENT_V2: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errText = "";
  child.stderr.on("data", (d) => { errText += String(d); });
  const base = await new Promise((ok, no) => {
    const tm = setTimeout(() => no(new Error(`the office never listened: ${errText.slice(-400)}`)), 30_000);
    child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) { clearTimeout(tm); ok(`http://127.0.0.1:${m[1]}`); } });
    child.on("exit", (c) => no(new Error(`the office exited early (${c}): ${errText.slice(-400)}`)));
  });
  const held = () => ({ out: "(another process)", waiting: "(another process)" });
  for (let round = 0; round < 1; round++) { // the office's first burst finds the projection due its rebuild
    const reads = [];
    for (let i = 0; i < WIDTH; i++) {
      const who = ["wright", "limen", "nobody"][i % 3];
      reads.push(fetch(`${base}/quests/${who}`, { signal: AbortSignal.timeout(DEADLINE_MS + 15_000) }).then(async (r) => ({ status: r.status, body: await r.text() })));
    }
    const got = await allAnswer(`GET /quests, round ${round}`, reads, { held });
    got.forEach((r, i) => {
      assert.equal(r.status, "fulfilled", `GET ${i}: ${r.reason?.message ?? ""}`);
      assert.equal(r.value.status, 200, `GET ${i}: ${r.value.body.slice(0, 200)}`);
    });
    assert.deepEqual(await idleInTransaction(), [], `GET /quests, round ${round}: office_api sessions are idle in transaction`);
  }
});
