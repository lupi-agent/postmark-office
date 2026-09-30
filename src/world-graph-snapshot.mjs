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
// is null and each reader answers exactly as it did before: from world.db
// where there is one. `worldGraphStanding()` says which, with the key.

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

const state = { snap: null, key: null, inflight: null, lastError: null, timer: null };

/** The published snapshot (`loadWorldGraph`'s shape plus `pin`), or null. Synchronous. */
export const worldGraphSnapshot = () => state.snap;

/** Which source the graph readers stand on, for a door or a health line. */
export function worldGraphStanding() {
  const s = state.snap;
  if (s) return { source: "store", settlement: s.pin.settlement, tag_sha: s.pin.tag_sha, office_sha: s.pin.office_sha };
  return {
    source: "floor",
    disclosed: `the world graph snapshot has not loaded${state.lastError ? ` (${state.lastError})` : ""}; graph reads answer from world.db where there is one`,
  };
}

async function defaultQuery(sql, params) {
  const { world2ServeEnabled, world2Pool } = await import("./world2-serve.mjs");
  if (!world2ServeEnabled()) throw new Error("the world 2.0 store is not engaged at this office (WORLD2_PG/WORLD2_PG_URL)");
  return (await world2Pool()).query(sql, params);
}

/**
 * Ask whether a newer snapshot has been copied in, and if so load it and
 * PUBLISH it. Concurrent calls share one refresh. A failure keeps what stood.
 * Resolves `{ changed, standing }`; never throws into a caller.
 */
export function reloadWorldGraph({ query = defaultQuery, force = false } = {}) {
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    try {
      const pin = (await query(PIN_SQL)).rows[0] ?? null;
      if (!pin) { state.lastError = "the store holds no world graph snapshot yet"; return { changed: false, standing: worldGraphStanding() }; }
      const key = `${pin.tag_sha}/${pin.office_sha}`;
      if (!force && state.snap && key === state.key) { state.lastError = null; return { changed: false, standing: worldGraphStanding() }; }
      const tables = await graphTablesAt(query, pin);
      const built = graphFromTables(tables, { source: `world_graphs@S${pin.settlement ?? "?"}:${pin.tag_sha}` });
      // THE PUBLISH. One assignment: a reader sees the old graph or the new one.
      state.snap = { ...built, pin: { tag_sha: pin.tag_sha, office_sha: pin.office_sha, settlement: pin.settlement } };
      state.key = key;
      state.lastError = null;
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

/** Tests only: forget everything, stop the timer. */
export function resetWorldGraph() {
  if (state.timer) clearInterval(state.timer);
  Object.assign(state, { snap: null, key: null, inflight: null, lastError: null, timer: null });
}
