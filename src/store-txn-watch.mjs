// store-txn-watch.mjs — does any office connection sit idle inside a
// transaction? Asked of the store once a minute, written where the roll-call
// reads it (POS-370).
//
// On 2026-10-04 the office stalled for an hour behind nine `office_api`
// sessions idle in transaction, and nothing on the box said so: the CPU was
// quiet, the doors simply never answered, and a resident reported it on Discord.
// This is the instrument that would have said so in the first minute.
//
//   telemetry/store-txn-<port>.json, rewritten every minute:
//     calm_at       the last minute the watcher could ask the store AND no
//                   session of the office's role was idle in a transaction for
//                   STUCK_AFTER_S seconds or more. The roll-call's row reads
//                   this, with a 5-minute allowance: "idle in transaction for
//                   5 minutes = ALARM".
//     last_minute   that minute's answer: the stuck sessions (pid, which pool
//                   and worker by application_name, how long idle, the last
//                   statement) and the role's sessions counted by state
//     worst_24h     the most stuck sessions seen in one minute today
//
// WHY A SESSION MUST BE IDLE FOR 5 s TO COUNT. Every transaction is "idle in
// transaction" for the moment between two of its statements, so a sample under
// load can catch a healthy one. A read that the office keeps short never idles
// for whole seconds; the incident's sessions idled for an hour.
//
// WHY ITS OWN CONNECTION, NOT A POOL'S. The failure this watches for is a pool
// with nothing left to give. The watcher opens one connection a minute, asks,
// and closes it, so a drained pool cannot blind it; and a minute it cannot ask
// is not calm, so a store it cannot reach also reads as the alarm.
//
// The file is named by port, like loop-lag's. A read worker writes nothing: it
// shares the writer's telemetry folder, and the writer's one connection sees
// every session of the role (pg_stat_activity shows a role its own sessions'
// state and statement, across every process logged in as it).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { IN_READ_WORKER } from "./read-workers.mjs";
import { world2Enabled } from "./world2-acts.mjs";

export const STUCK_AFTER_S = 5;
export const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const KEEP_MINUTES = 60;
const SHOWN = 10; // stuck sessions written per minute; the count is always whole

/** The role's sessions idle in a transaction for `stuckAfterS` seconds or more, and every session counted by state. */
export const STUCK_SQL = `
  SELECT pid, application_name, state,
         floor(EXTRACT(EPOCH FROM now() - state_change))::int AS idle_s,
         floor(EXTRACT(EPOCH FROM now() - xact_start))::int AS xact_s,
         left(query, 200) AS query
    FROM pg_stat_activity
   WHERE usename = current_user AND pid <> pg_backend_pid()
     AND state IN ('idle in transaction', 'idle in transaction (aborted)')
     AND now() - state_change >= make_interval(secs => $1)
   ORDER BY state_change`;
export const STATES_SQL = `
  SELECT coalesce(state, 'unknown') AS state, count(*)::int AS n
    FROM pg_stat_activity
   WHERE usename = current_user AND pid <> pg_backend_pid()
   GROUP BY 1 ORDER BY 1`;

/**
 * One look, on a client the caller connected: `{ stuck: [...], sessions: { state: n } }`.
 * Exported so a test can ask it of a real store.
 */
export async function lookOnce(client, { stuckAfterS = STUCK_AFTER_S } = {}) {
  const stuck = (await client.query(STUCK_SQL, [stuckAfterS])).rows;
  const sessions = Object.fromEntries((await client.query(STATES_SQL)).rows.map((r) => [r.state, r.n]));
  return { stuck, sessions };
}

/** A look on a connection of its own: connect, ask, close. Never a pool's. */
export function storeLook(env = process.env, { stuckAfterS = STUCK_AFTER_S, timeoutMs = 5000 } = {}) {
  return async () => {
    const { default: pg } = await import("pg");
    const client = new pg.Client({
      connectionString: env.WORLD2_PG_URL, connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs,
      application_name: "postmark-office:store-txn-watch",
    });
    client.on("error", () => { /* the look's own connection; its failure is the minute's answer */ });
    try {
      await client.connect();
      return await lookOnce(client, { stuckAfterS });
    } finally {
      await client.end().catch(() => {});
    }
  };
}

/** The port this process serves, parsed the way server.mjs parses it. */
function portFromArgv(argv = process.argv) {
  const i = argv.indexOf("--port");
  return i >= 0 && argv[i + 1] ? argv[i + 1] : "4380";
}

export function stateFileFor(port) {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "telemetry", `store-txn-${port}.json`);
}

/**
 * The instrument. `look` answers `{ stuck, sessions }` or throws; `now` and
 * `look` are injectable so a test can drive minutes without waiting them.
 */
export function createStoreTxnWatch({ file = null, look = null, now = Date.now, stuckAfterS = STUCK_AFTER_S } = {}) {
  const startedAt = now();
  const minutes = [];
  let calmAt = null;
  let worst = null;

  // What the last process knew: a restart frees every connection, so it does
  // not by itself make the store calm. calm_at carries until this process has a
  // calm minute of its own.
  if (file) {
    try {
      const prev = JSON.parse(readFileSync(file, "utf8"));
      if (prev?.calm_at && Number.isFinite(Date.parse(prev.calm_at))) calmAt = prev.calm_at;
      if (prev?.worst_24h?.at && startedAt - Date.parse(prev.worst_24h.at) < DAY_MS) worst = prev.worst_24h;
    } catch { /* no file yet, or unreadable: start empty */ }
  }

  async function tick() {
    const at = new Date(now()).toISOString();
    let row;
    try {
      const got = await look();
      row = { at, looked: true, stuck: got.stuck.length, stuck_sessions: got.stuck.slice(0, SHOWN), sessions: got.sessions };
    } catch (e) {
      row = { at, looked: false, error: String(e?.message ?? e).slice(0, 200) };
    }
    if (row.looked && row.stuck === 0) calmAt = at;
    minutes.push(row);
    if (minutes.length > KEEP_MINUTES) minutes.shift();
    if (worst && Date.parse(at) - Date.parse(worst.at) >= DAY_MS) worst = null;
    if (row.looked && row.stuck > 0 && (!worst || row.stuck > worst.stuck)) worst = { at, stuck: row.stuck, stuck_sessions: row.stuck_sessions };
    write();
    return row;
  }

  function read() {
    return {
      stuck_after_s: stuckAfterS,
      judged_on: `a minute is calm when the store answered and no session of the office's role had been idle inside a transaction for ${stuckAfterS} s or more`,
      started_at: new Date(startedAt).toISOString(),
      calm_at: calmAt,
      last_minute: minutes.at(-1) ?? null,
      worst_24h: worst,
      minutes: [...minutes],
    };
  }

  function write() {
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(read(), null, 1) + "\n");
      renameSync(tmp, file);
    } catch { /* an instrument must never take down a door */ }
  }

  return { tick, read, write };
}

// The office's own instance: the writer only, and only when it is pointed at a
// store (an office with no store has no transactions to watch, and must not
// dial one). First written at the first minute, like loop-lag's, so a process
// that lives less than a minute (every suite that imports server.mjs) writes
// nothing and asks nothing. An office on port 0 (a suite's, the OS picks the
// port) is never a box's, and writes nothing either.
const watching = !IN_READ_WORKER && world2Enabled() && portFromArgv() !== "0";
export const storeTxnWatch = createStoreTxnWatch({
  file: watching ? stateFileFor(portFromArgv()) : null,
  look: watching ? storeLook() : async () => { throw new Error("this office is not pointed at a store"); },
});
if (watching) setInterval(() => { storeTxnWatch.tick().catch(() => {}); }, MINUTE_MS).unref();
