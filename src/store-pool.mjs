// store-pool.mjs — how every office pool on the store is built, and the one
// rule a held store connection keeps (POS-370).
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
//
// 2026-10-04, 16:52Z: switch 2 (TOWN_INDEX_READS=store) went live and the office
// stalled for about an hour. At 19:33Z nine `office_api` sessions sat "idle in
// transaction" for 81 and 48 minutes, every one last running the quest board's
// `town_quest_progress` read, with no lock waits and the CPU at 9%. Nine is
// three read workers times the pen's pool of three: every connection the office
// had was checked out, and every later index read waited for one forever.
//
// Nothing leaked in the sense of a missing release. The quest board read its
// progress row inside the pen's READ ONLY transaction and then, still holding
// it, asked the world whether the resident's home stands. With the kept
// positions on (WORLD_POSITIONS=1, WORLD_MOVEMENT_V2=1) that read rebuilds the
// positions projection once a minute, and the rebuild reads the clearing's
// snapshot through `officeRead`: a SECOND connection from the SAME pool of
// three. Three boards in one worker hold all three connections and wait on a
// rebuild that waits for a fourth. It never comes, and the rebuild is shared, so
// every standpoint read in that worker waits on it too.
//
// Three things here keep that from being able to stall the town again:
//
//   · ONE PEN CONNECTION PER CALL CHAIN. A call that holds a pen connection and
//     asks the pen for another is refused at once, by name (NestedStoreError),
//     instead of waiting for a connection its own chain is keeping busy. The
//     marker is an AsyncLocalStorage, so "the same chain" is exact: two requests
//     in flight are two chains, and a request's own awaited work is one.
//
//   · AN ACQUIRE TIMEOUT. A request that cannot get a connection fails in
//     WORLD2_PG_ACQUIRE_MS (default 10 s) with a sentence naming the pool, never
//     hangs. pg-pool's connectionTimeoutMillis bounds the wait in its queue as
//     well as the dial.
//
//   · THE SERVER ENDS AN IDLE TRANSACTION. Every pool asks for
//     idle_in_transaction_session_timeout (WORLD2_PG_IDLE_TX_MS, default 30 s)
//     as a startup parameter, so a transaction left open by any future mistake
//     is closed by Postgres and its connection comes back. DEPLOY.md § POS-370
//     sets the same on the roles, for every other client that logs in as them.

import { AsyncLocalStorage } from "node:async_hooks";
import { threadId } from "node:worker_threads";

export const ACQUIRE_MS_DEFAULT = 10_000;
export const IDLE_TX_MS_DEFAULT = 30_000;

// A number of milliseconds from the env, or the default. 0 is a real value
// (pg reads it as "no limit"), so it is kept; anything unreadable is the default.
const msFrom = (raw, fallback) => {
  if (raw == null || String(raw).trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
export const acquireMs = (env = process.env) => msFrom(env.WORLD2_PG_ACQUIRE_MS, ACQUIRE_MS_DEFAULT);
export const idleTxMs = (env = process.env) => msFrom(env.WORLD2_PG_IDLE_TX_MS, IDLE_TX_MS_DEFAULT);

/**
 * The options every office pool on the store is built with. `name` lands in
 * pg_stat_activity as application_name (`postmark-office:<name>:t<thread>`), so
 * a stuck session says which pool and which worker holds it.
 */
export function storePoolOptions(env = process.env, { name, max, connectionString = env.WORLD2_PG_URL, ...rest } = {}) {
  return {
    connectionString,
    max,
    connectionTimeoutMillis: acquireMs(env),
    idle_in_transaction_session_timeout: idleTxMs(env),
    application_name: `postmark-office:${name}:t${threadId}`,
    ...rest,
  };
}

/** A pool that names its idle-client errors instead of taking the process down with them. */
export function watchPoolErrors(pool, name) {
  pool.on("error", (e) => console.error(`[store-pool ${name}] an idle connection failed: ${String(e?.message ?? e).slice(0, 200)}`));
  return pool;
}

/** Thrown when a pool had no connection to give within the acquire timeout. */
export class StoreAcquireTimeout extends Error {
  constructor(name, max, ms, cause) {
    super(`the store's ${name} pool had no free connection within ${ms} ms (it holds ${max}): the office is answering slowly or a connection is held; this request was refused rather than left waiting`);
    this.name = "StoreAcquireTimeout";
    this.code = "store-acquire-timeout";
    this.pool = name;
    this.cause = cause;
  }
}

const isAcquireTimeout = (e) => /timeout exceeded when trying to connect/i.test(String(e?.message ?? ""));

/** `pool.connect()`, with pg-pool's timeout turned into a sentence that names the pool. */
export async function acquire(pool, name) {
  try { return await pool.connect(); }
  catch (e) {
    if (isAcquireTimeout(e)) throw new StoreAcquireTimeout(name, pool.options?.max ?? "?", pool.options?.connectionTimeoutMillis ?? "?", e);
    throw e;
  }
}

// ── ONE PEN CONNECTION PER CALL CHAIN ────────────────────────────────────────

const holding = new AsyncLocalStorage();

/** Thrown when a call that holds a pen connection asks the pen for another. */
export class NestedStoreError extends Error {
  constructor(asked, held) {
    super(`${asked} asked the store's pen for a connection while this call already holds one (${held}): the pen's pool is small, and a call waiting on a second connection while holding the first is how three readers stall the office (POS-370). Read what the transaction needs, let it go, then do the rest.`);
    this.name = "NestedStoreError";
    this.code = "nested-store";
    this.asked = asked;
    this.held = held;
  }
}

/** Who holds a pen connection on this call chain right now, or null. */
export function penHeld() {
  const h = holding.getStore();
  return h && h.open ? h.by : null;
}

/** Refuse, by name, a pen ask from a chain that already holds a pen connection. */
export function refuseNested(asked) {
  const held = penHeld();
  if (held) throw new NestedStoreError(asked, held);
}

/**
 * Run `fn(client)` on a connection of the pen's pool, marked as held for this
 * call chain, and give it back on every path.
 *
 * `fn` owns the transaction (BEGIN, COMMIT, ROLLBACK). What this owns:
 *   · the nested refusal, before anything is asked of the pool;
 *   · an error listener for the time the connection is out, because pg emits a
 *     server-ended session (the idle-transaction timeout) as an 'error' event,
 *     and an unheard 'error' event is a crashed process;
 *   · the release, with `discard` when fn says the connection cannot be trusted
 *     (a ROLLBACK that failed may leave it inside a transaction, and a
 *     connection handed back mid-transaction is the next caller's leak).
 *
 * The mark is closed in `finally`, so work fn started and did not await does
 * not count as holding once the connection is back.
 */
export async function onPenClient(pool, by, fn) {
  refuseNested(by);
  const client = await acquire(pool, "pen");
  const mark = { by, open: true };
  let discard = false;
  const heard = (e) => {
    discard = true;
    console.error(`[store-pool pen] a held connection failed (${by}): ${String(e?.message ?? e).slice(0, 200)}`);
  };
  client.on("error", heard);
  try {
    return await holding.run(mark, () => fn(client, () => { discard = true; }));
  } finally {
    mark.open = false;
    client.removeListener("error", heard);
    client.release(discard ? true : undefined);
  }
}
