// law-snapshot.mjs — the class layer's ONE in-memory copy of the law, at the
// newest blessing, refreshed off the request path (POS-270, Wright-ruled
// 2026-09-27: "snapshot").
//
// The class readers in world-classes.mjs are synchronous and have callers all
// over the office (the doorstep, say, hold, walk). They stay synchronous: they
// read `lawSnapshot()`, which is a variable, never a query. The query runs HERE,
// on a timer, and a new snapshot is PUBLISHED by one assignment once it is whole
// — so a request never waits on Postgres, and a request that lands mid-refresh
// is answered by the snapshot before it, complete.
//
// ── WHEN IT REFRESHES ────────────────────────────────────────────────────────
// "When the tag changes": every tick asks one cheap question — the newest
// settlement number, and the newest one whose law the pen has ingested
// (PIN_SQL). Only when that pair moves does the whole law come over
// (LAW_AT_BLESSING_SQL, law-classes.mjs). Between blessings a tick is two
// index lookups.
//
// ── THE FLOOR, NAMED (the ruling's first condition) ──────────────────────────
// Before the first snapshot lands, or on an office with no store engaged,
// `lawSnapshot()` is null and the class readers answer exactly as they did
// before this file: from world.db when there is one, and from their own floor
// when there is not — ROSTER_FLOOR for the roster (disclosed in `disclosed`),
// the caller's fallback for `dialNumber` (`read: false`, `source: "fallback"`).
// `lawStanding()` says which of the three a read stood on, with the sha, so a
// door can disclose it. Never an empty law passed off as a read one.
//
// ── ONE CACHE PER PROCESS (the ruling's second condition) ────────────────────
// `reloadLawSnapshot()` is the one way to make THIS process learn the tag
// moved. The timer calls it; a read worker (POS-266) calls it too, or runs its
// own timer — each process holds its own copy and learns on its own.

import { LAW_AT_BLESSING_SQL, lawSnapshotFromRows } from "./law-classes.mjs";

// The pair that says "the law to serve has moved". Both halves matter: a new
// settlement whose law is not ingested moves `newest` (the disclosure changes),
// and the law pen catching up moves `pinned` (the law itself changes).
export const PIN_SQL = `
  SELECT (SELECT max(number) FROM settlements) AS newest,
         (SELECT s.number FROM settlements s
           WHERE EXISTS (SELECT 1 FROM law_projection l WHERE l.law_sha = s.tag_sha)
           ORDER BY s.number DESC LIMIT 1) AS pinned`;

/** The two statements a refresh sends, by name — so a test can tell them apart. */
export const LAW_REFRESH_SQLS = Object.freeze({ pin: PIN_SQL, law: LAW_AT_BLESSING_SQL });

const state = {
  snap: null,          // the published snapshot, or null (the floor)
  key: null,           // "newest/pinned" the published snapshot answers
  inflight: null,      // the refresh in progress, if any — never awaited by a read
  lastError: null,     // the last refresh's failure, for the health line
  timer: null,
};

/** The published snapshot, or null. Synchronous; never queries. */
export const lawSnapshot = () => state.snap;

/**
 * Where the class layer is standing right now, for a door to disclose:
 * `{ source: "law", settlement, sha, disclosed }` once a snapshot is published,
 * `{ source: "floor", disclosed }` before (the readers then fall back to
 * the world graph snapshot, or their floors).
 */
export function lawStanding() {
  const s = state.snap;
  if (s) return { source: "law", settlement: s.pin.settlement, sha: s.pin.sha, disclosed: s.disclosed };
  return {
    source: "floor",
    disclosed: state.lastError
      ? `the law snapshot has not loaded (${state.lastError}) — class reads answer from the world graph snapshot where it has loaded, else from their floors`
      : "the law snapshot has not loaded yet — class reads answer from the world graph snapshot where it has loaded, else from their floors",
  };
}

async function defaultQuery(sql, params) {
  const { world2ServeEnabled, world2Pool } = await import("./world2-serve.mjs");
  if (!world2ServeEnabled()) throw new Error("the world 2.0 store is not engaged at this office (WORLD2_PG/WORLD2_PG_URL)");
  return (await world2Pool()).query(sql, params);
}

/**
 * Ask the store whether the law to serve moved, and if so load it and PUBLISH it.
 * Resolves to `{ changed, standing }`. Concurrent calls share one refresh. A
 * failure keeps the published snapshot (stale-but-whole beats none) and is
 * recorded for `lawStanding()`; it never throws into a caller.
 *
 * `query(sql, params)` → `{ rows }` — the pg pool by default; a test hands in
 * PGlite.
 */
export function reloadLawSnapshot({ query = defaultQuery, force = false } = {}) {
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    try {
      const pin = (await query(PIN_SQL)).rows[0] ?? {};
      const key = `${pin.newest ?? "-"}/${pin.pinned ?? "-"}`;
      if (!force && state.snap && key === state.key) { state.lastError = null; return { changed: false, standing: lawStanding() }; }
      const next = lawSnapshotFromRows((await query(LAW_AT_BLESSING_SQL)).rows);
      // THE PUBLISH. One assignment: a reader sees the old snapshot or the new
      // one, never a half-built map. A store with no ingested blessing publishes
      // nothing and leaves whatever stood (null on a fresh process: the floor).
      if (next) { state.snap = next; state.key = key; }
      state.lastError = next ? null : "the store holds no settlement whose law is ingested";
      return { changed: !!next, standing: lawStanding() };
    } catch (e) {
      state.lastError = String(e?.message ?? e).slice(0, 160);
      return { changed: false, standing: lawStanding() };
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
}

/**
 * Start the refresher: one load now, then a tick every `intervalMs`. The timer
 * is unref'd — it never holds a process open. Idempotent.
 *
 * `onChange(standing)` runs after a tick that PUBLISHED a new snapshot, and
 * only then. The office's main thread hands in `announce("law")`, so its read
 * workers (POS-266) reload the moment the tag moves rather than a tick later.
 * A worker runs no timer of its own: it loads once at boot
 * (`reloadLawSnapshot()`), then on each announcement.
 */
export function startLawRefresher({ intervalMs = Number(process.env.LAW_REFRESH_MS ?? 60_000), query, onChange = null } = {}) {
  if (state.timer) return;
  const tick = async () => {
    const r = await reloadLawSnapshot({ query });
    if (r.changed && onChange) { try { onChange(r.standing); } catch { /* a listener that throws does not stop the timer */ } }
  };
  tick();
  state.timer = setInterval(tick, intervalMs);
  state.timer.unref?.();
}

/** Tests only: forget everything, stop the timer. */
export function resetLawSnapshot() {
  if (state.timer) clearInterval(state.timer);
  Object.assign(state, { snap: null, key: null, inflight: null, lastError: null, timer: null });
}
