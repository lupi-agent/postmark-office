// world-graph-snapshot.mjs — the world graph from the store, held in memory,
// at the newest settlement the graph pen has copied (POS-270, option A,
// Wright-ruled 2026-09-30).
//
// world.db was a file the office opened on every read. The same rows now sit
// in the store as one snapshot per settlement (037/038, written by
// world2/tools/graph-ingest.mjs after the blessed hydration). This file loads
// the newest one ONCE, builds it through the same construction the file used
// (world-store.mjs § graphFromTables), and publishes it by one assignment. A
// reader takes a variable, never a query: the same bargain as law-snapshot.mjs.
//
// ── WHEN IT MOVES ────────────────────────────────────────────────────────────
// The graph changes only when a new settlement is copied in, so a tick asks
// one small question (PIN_SQL: the newest snapshot's key) and loads the rows
// only when that key moved. The main thread polls and announces
// "world-graph"; a read worker loads at boot and again on each announcement.
//
// ── THE FLOOR, NAMED ─────────────────────────────────────────────────────────
// Before the first snapshot lands (a fresh process, an office not pointed at
// the store, or a store the graph pen has never written), `worldGraphSnapshot()`
// is null and each reader stands on its own floor and says so: world.db, the
// old floor, is retired (lane W 3b), and an office not pointed at the store
// refuses to boot unless told to serve no world (server.mjs § THE WORLD GRAPH'S
// SWITCH). `worldGraphStanding()` says which, with the key.

import { readFileSync, statSync } from "node:fs";
import { workerData } from "node:worker_threads";
import { graphFromTables, EDGE_TYPES } from "./world-store.mjs";

/** The newest snapshot's key. Newest by settlement, then by build. */
export const PIN_SQL = `
  SELECT tag_sha, office_sha, settlement, built_at FROM world_graphs
   ORDER BY settlement DESC NULLS LAST, built_at DESC LIMIT 1`;

/** Each table at one key, in the file's own order. */
export const GRAPH_SQLS = Object.freeze({
  meta: `SELECT key, value FROM world_graph_meta WHERE tag_sha = $1 AND office_sha = $2 ORDER BY ord`,
  nodes: `SELECT id, kind, subkind, tier, "by", at_x, at_y, extent_w, extent_h, props FROM world_graph_nodes WHERE tag_sha = $1 AND office_sha = $2 ORDER BY ord`,
  edges: `SELECT seq, src, dst, type, props, born_at FROM world_graph_edges WHERE tag_sha = $1 AND office_sha = $2 ORDER BY seq`,
  events: `SELECT seq, at, actor, type, payload FROM world_graph_events WHERE tag_sha = $1 AND office_sha = $2 ORDER BY at, seq`,
  geometryVersions: `SELECT seq, mark_id, at_x, at_y, extent_w, extent_h, valid_from_iso, valid_to_iso, sha, path, subject, authored_iso, change
                       FROM world_graph_geometry WHERE tag_sha = $1 AND office_sha = $2 ORDER BY mark_id, valid_from_iso, seq`,
  lintFindings: `SELECT lint, verdict, headline, evidence, hydrated_at, as_of_world FROM world_graph_lints WHERE tag_sha = $1 AND office_sha = $2 ORDER BY ord`,
});

/**
 * The store's rows at one key, as world.db's tables. The edge-type registry is
 * not stored: the hydrator writes exactly `EDGE_TYPES` into it, so the
 * constant IS its rows (the parity test holds that).
 */
export async function graphTablesAt(query, { tag_sha, office_sha }) {
  const at = [tag_sha, office_sha];
  const out = {};
  for (const [name, sql] of Object.entries(GRAPH_SQLS)) out[name] = (await query(sql, at)).rows;
  out.edgeTypes = EDGE_TYPES.map(([type, note]) => ({ type, note }));
  return out;
}

const state = { snap: null, key: null, inflight: null, lastError: null, timer: null, rowsRefused: null, atImport: null };

/** One assignment: a reader sees the old graph or the new one. */
function publish(tables, pin, key, source) {
  const built = graphFromTables(tables, { source });
  // `tables` rides along for the readers that ask the graph questions in
  // SQL's shape (world-graph-db.mjs § graphDb): one set of rows, two views.
  state.snap = { ...built, tables, pin };
  state.key = key;
  state.lastError = null;
}

// ── THE TEST FIXTURE SEAM (POS-270 lane W 3a, Keemin-ruled 2026-09-30) ──────
//
// A test's world comes from rows, never from a world.db: in process it
// publishes them (`publishWorldGraphForTest`), and an office it spawns reads
// them from WORLD_GRAPH_ROWS (a JSON file of world.db's tables by name, which
// `world-hydrate.mjs --rows-out` writes). Both answer only under `node --test`
// (NODE_TEST_CONTEXT): an office pointed at a rows file anywhere else refuses
// it by name and stands on the store, so a fixture can never become prod's world.
const inNodeTest = () => Boolean(process.env.NODE_TEST_CONTEXT);
const testPin = (tables) => ({
  tag_sha: tables.meta?.find((m) => m.key === "as_of_world")?.value ?? "test-rows",
  office_sha: "test-rows",
  settlement: null,
});

/** Tests only: publish these rows as the world graph snapshot. */
export function publishWorldGraphForTest(tables, { label = "test rows" } = {}) {
  if (!inNodeTest()) throw new Error("publishWorldGraphForTest is a test seam and answers only under node --test");
  const t = { ...tables, edgeTypes: tables.edgeTypes ?? EDGE_TYPES.map(([type, note]) => ({ type, note })) };
  publish(t, testPin(t), `test:${label}:${Date.now()}:${Math.random()}`, label);
}

/** True when this process stands on a test's rows (WORLD_GRAPH_ROWS under node --test). */
export const rowsFixtureActive = (env = process.env) => Boolean(env.WORLD_GRAPH_ROWS) && Boolean(env.NODE_TEST_CONTEXT);

/**
 * WORLD_GRAPH_ROWS, read once per change of the file. True when this process
 * stands on a test's rows; false when there are none, AND when they are
 * refused — a refused fixture must leave the store's load to run, or an office
 * with a stray WORLD_GRAPH_ROWS would publish no world at all. The refusal is
 * kept in its own field, so it stays disclosed after the store has published
 * (publish() clears lastError).
 */
function loadRowsFixture() {
  const path = process.env.WORLD_GRAPH_ROWS;
  if (!path) return false;
  if (!inNodeTest()) { state.rowsRefused = `WORLD_GRAPH_ROWS is a test fixture and is refused outside node --test (${path})`; return false; }
  try {
    const st = statSync(path);
    const key = `rows:${path}:${st.mtimeMs}:${st.size}`;
    if (state.snap && state.key === key) return true;
    const tables = JSON.parse(readFileSync(path, "utf8"));
    const t = { ...tables, edgeTypes: tables.edgeTypes ?? EDGE_TYPES.map(([type, note]) => ({ type, note })) };
    publish(t, testPin(t), key, `WORLD_GRAPH_ROWS ${path}`);
  } catch (e) { state.lastError = `WORLD_GRAPH_ROWS would not load: ${String(e?.message ?? e).slice(0, 160)}`; }
  return true;
}
// At import, synchronously, so an office spawned on a fixture answers its first read from it.
loadRowsFixture();

/** The published snapshot (`graphFromTables`' shape plus `tables` and `pin`), or null. Synchronous. */
export const worldGraphSnapshot = () => state.snap;

/** Which source the graph readers stand on, for a door or a health line. */
export function worldGraphStanding() {
  const s = state.snap;
  const refused = state.rowsRefused ? { refused: state.rowsRefused } : {};
  // How this process came to stand where it stands: the load at import, with
  // the role it read as and what it cost (null where none was tried).
  const atImport = state.atImport ? { loaded_at_import: state.atImport } : {};
  if (s) return { source: "store", settlement: s.pin.settlement, tag_sha: s.pin.tag_sha, office_sha: s.pin.office_sha, ...refused, ...atImport };
  return {
    source: "floor",
    disclosed: `the world graph snapshot has not loaded${state.lastError ? ` (${state.lastError})` : ""}${state.rowsRefused ? ` (${state.rowsRefused})` : ""}; graph reads stand on their floors, each saying so`,
    ...refused, ...atImport,
  };
}

async function storeQuery(sql, params) {
  const { world2ServeEnabled, world2Pool } = await import("./world2-serve.mjs");
  if (!world2ServeEnabled()) throw new Error("the world 2.0 store is not engaged at this office (WORLD2_PG/WORLD2_PG_URL)");
  return (await world2Pool()).query(sql, params);
}

// What a reload asks when no query is handed in: the store. A child process
// can stand a stub in for it (__setDefaultQueryForTest), so the path an office
// actually takes — the fixture check, then the store — is driven end to end,
// including outside node --test, where the fixture must be refused.
let defaultQuery = storeQuery;
/** Tests only (node --test, the publish seam's one rule): what an argument-less reload asks; null puts the store back. */
export function __setDefaultQueryForTest(fn) {
  if (!inNodeTest()) throw new Error("__setDefaultQueryForTest is a test seam and answers only under node --test");
  defaultQuery = fn ?? storeQuery;
}

/**
 * Ask whether a newer snapshot has been copied in, and if so load it and
 * PUBLISH it. Concurrent calls share one refresh. A failure keeps what stood.
 * Resolves `{ changed, standing }`; never throws into a caller.
 */
export function reloadWorldGraph({ query = defaultQuery, force = false } = {}) {
  if (query === defaultQuery && loadRowsFixture()) return Promise.resolve({ changed: false, standing: worldGraphStanding() });
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    try {
      const pin = (await query(PIN_SQL)).rows[0] ?? null;
      if (!pin) { state.lastError = "the store holds no world graph snapshot yet"; return { changed: false, standing: worldGraphStanding() }; }
      const key = `${pin.tag_sha}/${pin.office_sha}`;
      if (!force && state.snap && key === state.key) { state.lastError = null; return { changed: false, standing: worldGraphStanding() }; }
      const tables = await graphTablesAt(query, pin);
      publish(tables, { tag_sha: pin.tag_sha, office_sha: pin.office_sha, settlement: pin.settlement }, key,
        `world_graphs@S${pin.settlement ?? "?"}:${pin.tag_sha}`);
      return { changed: true, standing: worldGraphStanding() };
    } catch (e) {
      state.lastError = String(e?.message ?? e).slice(0, 160);
      return { changed: false, standing: worldGraphStanding() };
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
}

/**
 * The main thread's refresher: one load now, then a tick every `intervalMs`.
 * `onChange` runs after a tick that published a new snapshot, and only then.
 */
export function startWorldGraphRefresher({ intervalMs = Number(process.env.WORLD_GRAPH_REFRESH_MS ?? 60_000), query, onChange = null } = {}) {
  if (state.timer) return;
  const tick = async () => {
    const r = await reloadWorldGraph({ query });
    if (r.changed && onChange) { try { onChange(r.standing); } catch { /* a listener that throws does not stop the timer */ } }
  };
  tick();
  state.timer = setInterval(tick, intervalMs);
  state.timer.unref?.();
}

/**
 * The world graph for a command-line tool: a hydration's rows (`--rows <file>`,
 * what `world-hydrate.mjs --rows-out` writes), or the store's newest snapshot.
 * world.db, the tools' old default, is retired (POS-270 lane W 3b). Resolves
 * `{ loaded, source }`, or `{ error }` naming why there is no world.
 */
export async function worldGraphForTool({ rows = null } = {}) {
  if (rows) {
    try {
      const tables = JSON.parse(readFileSync(rows, "utf8"));
      const t = { ...tables, edgeTypes: tables.edgeTypes ?? EDGE_TYPES.map(([type, note]) => ({ type, note })) };
      return { loaded: { ...graphFromTables(t, { source: rows }), tables: t }, source: rows };
    } catch (e) { return { error: `the rows at ${rows} would not load: ${String(e?.message ?? e).slice(0, 160)}` }; }
  }
  await reloadWorldGraph();
  const snap = worldGraphSnapshot();
  return snap ? { loaded: snap, source: `the store's snapshot (S${snap.pin.settlement ?? "?"} ${String(snap.pin.tag_sha).slice(0, 12)})` }
    : { error: worldGraphStanding().disclosed };
}

/** Tests only: forget everything, stop the timer. */
export function resetWorldGraph() {
  if (state.timer) clearInterval(state.timer);
  Object.assign(state, { snap: null, key: null, inflight: null, lastError: null, timer: null, rowsRefused: null, atImport: null });
}

// ── THE LOAD AT IMPORT (POS-270 lane W 3b, Keemin-ruled 2026-09-30) ──────────
//
// world.db was a file every process could open the moment it needed it, and
// some read it the moment they LOADED: voices.mjs computes speech's seven dials
// at import, and child processes read before any refresher could tick — the
// walk pen's pace (walk-exec), the crossing save's ledger and sound dial, the
// earpiece's earshot. So the snapshot loads HERE, as this module evaluates,
// and every module that imports it (directly or through world-graph-db) waits
// for it: a top-level await. This module's own static imports reach nothing
// that imports it back (world-store.mjs only), so the await cannot close a
// cycle; world2-serve.mjs, the office's pool, would — it reaches this module
// through world-classes — so this load opens its OWN client.
//
// THE PEN IS A READER. WORLD_GRAPH_PG_URL names a read-only role
// (snapshot_reader: SELECT on every table, 037/038 included, writes nothing).
// Where it is not set, the office's own WORLD2_PG_URL is used — the role the
// main thread's refresher already reads with — and the standing names the role
// either way. Never the law pen: that is the tick's credential, not a reader's.
//
// SOFT, AND NEVER SILENT. A connection that does not come in 2s, or a query
// that does not answer in 2s, leaves the process on its floor; the standing
// says so (loaded_at_import), and so does one line on stderr naming the
// process. Not tried at all: a test's rows (already published above), or an
// office told to serve no world (WORLD_GRAPH_NONE=1).
const graphPgUrl = (env = process.env) => env.WORLD_GRAPH_PG_URL
  || (env.WORLD2_PG === "1" && env.WORLD2_PG_URL ? env.WORLD2_PG_URL : null);   // world2-serve.mjs § world2ServeEnabled, spelled here for the cycle above
const roleOf = (url) => { try { return decodeURIComponent(new URL(url).username) || "(no role named)"; } catch { return "(an unparseable url)"; } };
const processName = () => `${String(process.argv[1] ?? "node").split(/[\\/]/).pop()}${workerData?.readWorker ? ` (read worker ${workerData.slot})` : ""}`;

async function loadAtImport(url) {
  const t0 = performance.now();
  const role = roleOf(url);
  const via = process.env.WORLD_GRAPH_PG_URL ? "WORLD_GRAPH_PG_URL" : "WORLD2_PG_URL (WORLD_GRAPH_PG_URL unset: the office's own role)";
  let client = null;
  try {
    const { default: pg } = await import("pg");
    client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2000, query_timeout: 2000 });
    await client.connect();
    await reloadWorldGraph({ query: (sql, params) => client.query(sql, params) });
  } catch (e) {
    state.lastError = `the load at import failed: ${String(e?.message ?? e).slice(0, 140)}`;
  } finally {
    try { await client?.end(); } catch { /* the connection is already gone */ }
  }
  state.atImport = { role, via, ms: Math.round(performance.now() - t0), published: Boolean(state.snap) };
}

if (!state.snap && process.env.WORLD_GRAPH_NONE !== "1") {
  const url = graphPgUrl();
  if (url) await loadAtImport(url);
  // The one boot line. Under node --test a floor is the ordinary state of a
  // fixture-less test and its standing already says so; anywhere else, and in
  // any process that TRIED the store, the floor is announced.
  if (!state.snap && (url || !inNodeTest()))
    console.error(`[world-graph] ${processName()} stands on its floor, not the world: ${worldGraphStanding().disclosed}`);
}
