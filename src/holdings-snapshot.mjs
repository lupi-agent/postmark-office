// holdings-snapshot.mjs — who holds what, from the record, held in memory for
// the synchronous readers (POS-269, the hold edge onto acts).
//
// Where the hold lane's pen is flipped and the guards read the record (prod:
// W2_PEN has hold, W2_GUARDS=1), the record of every give, drop and take is
// `acts`, and the door's own holder check already reads it
// (`world2-guards § guardedAttachments`). The sqlite `attachments` edge in
// dynamic.db was written beside it, inside a `BEGIN IMMEDIATE` held across the
// Postgres round trip, only because three readers still asked sqlite: the
// arena's weapon and fold, the apex's portal block, and crossing-save. This
// file is what those readers ask instead, and with it the door stops writing
// the sqlite edge at all.
//
// ── WHY A SNAPSHOT ───────────────────────────────────────────────────────────
// The arena's fold is synchronous and its callers are too (the loot shroud,
// the portal block, the enter wheel). So the rows are read HERE, off the
// request path, and a reader takes a variable, never a query: the same bargain
// as law-snapshot.mjs. The snapshot is the whole town's edge in
// `readAttachments`' shape and order (`born_at`, then `seq`), because that is
// what `holdingsOf` / `liveHolder` fold.
//
// ── WHEN IT MOVES ────────────────────────────────────────────────────────────
// Only this office writes holding acts, and only its main thread (a read worker
// refuses every unsafe door). So the snapshot is loaded once at boot and again
// after each holding act commits. The main thread then announces "holding",
// and each read worker reloads its own copy. No timer: between two holding acts
// the answer cannot move.
//
// ── THE FLOOR, NAMED ─────────────────────────────────────────────────────────
// On an office where `holdEdgeOnActs()` is false, sqlite is still that
// office's record, and `attachmentRows(dyn)` reads it exactly as before. Where
// it is true, before the first load lands (or when it failed), the readers get
// `readAttachments(dyn)` from the sqlite file as it stood when the door stopped
// writing it. That is stale-but-whole rather than empty, and `holdingsStanding()`
// says which source answered.

import { readAttachments } from "./dynamic-entities.mjs";
import { laneFlipped } from "./world2-pen.mjs";
import { guardsFlipped } from "./world2-guards.mjs";

const state = { rows: null, loadedAt: null, lastError: null, inflight: null };

/**
 * Is the holding edge `acts` and only `acts` at this office? The one switch
 * the door and the readers read. Two flags, both prod's (W2_PEN has hold,
 * W2_GUARDS=1), because it takes both: the pen must write the act, and the
 * door's holder check must read it (`guardedAttachments` reads sqlite while
 * W2_GUARDS is off, and that office still needs its sqlite edge written).
 */
export const holdEdgeOnActs = (env = process.env) => laneFlipped("hold", env) && guardsFlipped(env);

async function defaultRead() {
  const { storeAttachmentRows } = await import("./world2-guards.mjs");
  return storeAttachmentRows();
}

/**
 * Load the edge from the record and publish it by one assignment. Concurrent
 * calls share one read. A failure keeps what stood and is recorded; it never
 * throws into a caller.
 */
export function reloadHoldings({ read = defaultRead } = {}) {
  if (state.inflight) return state.inflight;
  state.inflight = (async () => {
    try {
      const rows = await read();
      if (!Array.isArray(rows)) throw new Error("the record answered no attachment rows");
      state.rows = rows;
      state.loadedAt = new Date().toISOString();
      state.lastError = null;
      return { loaded: true, count: rows.length };
    } catch (e) {
      state.lastError = String(e?.message ?? e).slice(0, 160);
      return { loaded: false, error: state.lastError };
    } finally {
      state.inflight = null;
    }
  })();
  return state.inflight;
}

/**
 * The attachment rows a synchronous reader folds. `dyn` is the sqlite handle
 * the caller already holds, or null.
 *
 *   hold lane unflipped      sqlite is the record: `readAttachments(dyn)`
 *   flipped, snapshot loaded the snapshot (the record)
 *   flipped, not yet loaded  sqlite as it stood (the floor), or [] with no file
 */
export function attachmentRows(dyn = null, { env = process.env } = {}) {
  if (holdEdgeOnActs(env) && state.rows) return state.rows;
  return dyn ? readAttachments(dyn) : [];
}

/** Which source a read stood on, for a door or a health line to disclose. */
export function holdingsStanding({ env = process.env } = {}) {
  if (!holdEdgeOnActs(env)) return { source: "sqlite", why: "the hold lane's pen is not flipped here, so dynamic.db is this office's record" };
  if (state.rows) return { source: "acts", count: state.rows.length, loaded_at: state.loadedAt };
  return {
    source: "floor",
    disclosed: `the holdings snapshot has not loaded${state.lastError ? ` (${state.lastError})` : ""}; holdings answer from dynamic.db as it stood when the door stopped writing it`,
  };
}

/** Tests only: forget the snapshot. */
export function resetHoldings() {
  Object.assign(state, { rows: null, loadedAt: null, lastError: null, inflight: null });
}
