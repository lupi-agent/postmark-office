// dynamic-emissions.mjs — speech as an EMISSION, and threads as a query over it.
//
// An emission is a thing that HAPPENS. Its PRESENCE lives in the store under a
// TTL and then it is gone, exactly the way air clears; its OCCURRENCE is an
// event in the crossing log, and that is kept forever. Presence fades;
// occurrence is history (LOGOS/kinds.md).
//
// That one law shapes every function here:
//
//   · `recordEmission` writes a row whose TTL is the sound class's, read from
//     the class mark — the dial is the town's law, not this file's opinion.
//   · `presentEmissions` answers PRESENCE as a QUERY over born_at/ttl, never as
//     a delete. Nothing is removed when it expires.
//   · `pruneEmissions` is the only deleter, and it refuses to touch anything the
//     crossing-save has not already crystallized into the world repo. Presence
//     may be lost; occurrence may not be lost before it is history.
//
// ── ON NOT REIMPLEMENTING THE THREAD DERIVATION ─────────────────────────────
//
// `threadsFrom` runs the office's OWN `clusterVoices` over rows projected out of
// the store. That is deliberate, and it is world-serve.mjs's rule applied one
// layer down: the store supplies the FACTS, the shipped derivation supplies the
// MATHS. A second clustering implementation here would make the parity harness
// measure whether two transcriptions of one algorithm agree — which is not the
// question. The question is whether the store's rows are the same speech the
// voices log holds, and that is falsified by a missing field, not by a missing
// formula.
//
// The spike proved how easy the alternative is to get wrong: reading earshot as
// overlapping circles, dropping the deck rule, or closing threads at the hearing
// TTL instead of the conversation window each produced a believable-looking
// conversations page and a different set of threads.

import { clusterVoices } from "./voices.mjs";
import { getMeta, putMeta, soundMs } from "./dynamic-store.mjs";

export const SOUND = "sound";

const iso = (ms) => new Date(ms).toISOString();

/**
 * The id of one emission: class, instant, source. Deterministic given those
 * three, so the same voice replayed into a fresh store lands on the same id —
 * which is what lets the crossing-save be checked for determinism at all.
 * Collisions (one source, one class, one millisecond) take a numeric suffix.
 */
export function emissionId(db, cls, bornMs, source) {
  const base = `${cls}:${bornMs}:${source}`;
  const taken = db.prepare("SELECT 1 FROM emissions WHERE id = ?");
  if (!taken.get(base)) return base;
  for (let n = 2; n < 1000; n++) if (!taken.get(`${base}:${n}`)) return `${base}:${n}`;
  throw new Error(`cannot mint an emission id for ${base}`);
}

/**
 * Record one emission instance.
 *
 * @param {object} db      an open dynamic store
 * @param {object} voice   { source, spoken_by, text, at (ms), x, y, place, aboard }
 * @param {object} cls     the sound class as `soundClass()` returned it
 *
 * `source` is the thing that EMITTED — for the human lane, the resident the
 * human is stood with, because humans are not entities and do not walk. The
 * human's own label rides in `props.spoken_by`. That is the sound class's human
 * lane exactly: disclosure, never impersonation, and it is also what stops the
 * source pointer dangling on every `human-of-…` voice (the spike's finding).
 */
export function recordEmission(db, voice, cls) {
  const { ttlMs, earshotM } = soundMs(cls);
  const bornMs = voice.at;
  const source = voice.source;
  const id = emissionId(db, voice.class ?? SOUND, bornMs, source);
  const row = {
    id,
    class: voice.class ?? SOUND,
    source,
    x: voice.x,
    y: voice.y,
    born_at: iso(bornMs),
    ttl_expires_at: iso(bornMs + ttlMs),
    props: {
      spoken_by: voice.spoken_by ?? source,
      text: voice.text ?? "",
      // The deck flag, carried until Stage D makes the deck structural. The
      // whole boat is one room even though it moves: two passengers chatting
      // mid-crossing stay in one conversation, and pure geometry shatters that
      // into serial threads (watched happening on the maiden sailing).
      aboard: Boolean(voice.aboard),
      place: voice.place ?? null,
      // Whether a human borrowed this body. Structural, not a string test on
      // the handle: the human lane is the only path where the speaker's label
      // and the emitting body differ.
      human: (voice.spoken_by ?? source) !== source,
      // The law this instance was born under, and where it was read from. An
      // instance carries the version it conformed to; a dial changed tomorrow
      // does not retroactively re-govern what happened today.
      class_version: cls.version,
      radius_m: earshotM,
      ttl_min: cls.dials.hearing_ttl_min,
      dials_from: cls.gate.status === "PRESENT" ? "class-mark" : (cls.gate.status === "PARTIAL" ? "class-mark+office-fallback" : "office-fallback"),
      dials_disclosed: cls.disclosed.length ? cls.disclosed : undefined,
      class_store_as_of: cls.store.as_of_world,
      class_store_fresh: cls.store.fresh,
    },
  };
  db.prepare("INSERT INTO emissions (id, class, source, x, y, born_at, ttl_expires_at, props) VALUES (?,?,?,?,?,?,?,?)")
    .run(row.id, row.class, row.source, row.x, row.y, row.born_at, row.ttl_expires_at, JSON.stringify(row.props));
  return row;
}

// The say path's dual-write (emissionFromVoice) is gone with the store
// (POS-269): the say's act is the emission, and the crossing-save renders its
// lines from the acts (src/save-emissions.mjs). What remains here are readers
// over a store a caller already holds — the shadow-era falsifiers' oracles.

// ── reads ────────────────────────────────────────────────────────────────────

/** Every emission row in a window, oldest first. Occurrence, not presence — expired rows included. */
export function emissionsBetween(db, fromIso, toIso, { cls = null } = {}) {
  const sql = cls
    ? "SELECT * FROM emissions WHERE class = ? AND born_at >= ? AND born_at < ? ORDER BY born_at, id"
    : "SELECT * FROM emissions WHERE born_at >= ? AND born_at < ? ORDER BY born_at, id";
  const rows = cls ? db.prepare(sql).all(cls, fromIso, toIso) : db.prepare(sql).all(fromIso, toIso);
  return rows.map(inflate);
}

/** Every emission row, oldest first. */
export function allEmissions(db, { cls = null } = {}) {
  const rows = cls
    ? db.prepare("SELECT * FROM emissions WHERE class = ? ORDER BY born_at, id").all(cls)
    : db.prepare("SELECT * FROM emissions ORDER BY born_at, id").all();
  return rows.map(inflate);
}

/**
 * PRESENCE at an instant — the emissions still hanging in the air.
 *
 * A query, never a delete. The row survives its own TTL because the occurrence
 * has to reach a crossing log before it may be dropped; what expires is the
 * ANSWER, which is what "presence fades" actually means.
 */
export function presentEmissions(db, atMs = Date.now(), { cls = SOUND } = {}) {
  const now = iso(atMs);
  return db.prepare(
    "SELECT * FROM emissions WHERE class = ? AND born_at <= ? AND ttl_expires_at > ? ORDER BY born_at, id")
    .all(cls, now, now).map(inflate);
}

function inflate(r) {
  let props = {};
  try { props = JSON.parse(r.props ?? "{}") ?? {}; } catch { props = {}; }
  return { ...r, props };
}

/**
 * An emission row in the shape `clusterVoices` reads. The projection, and the
 * only place the store's column names meet the derivation's field names.
 */
export const emissionToVoice = (e) => ({
  id: e.id,
  handle: e.props.spoken_by ?? e.source,
  source: e.source,
  text: e.props.text ?? "",
  at: Date.parse(e.born_at),
  x: e.x,
  y: e.y,
  place: e.props.place ?? null,
  aboard: Boolean(e.props.aboard),
});

/**
 * Threads, derived from emissions. Nothing stores a thread — a conversation is
 * a query over overlapping sound, and this is the query.
 *
 * The dials are the sound class's: `radius_m` for earshot, `thread_close_min`
 * for the window. `thread_close_min` and not `hearing_ttl_min`, deliberately —
 * they are two clocks for two questions, and collapsing them doubles the thread
 * count (the spike measured it: 30 threads became 62).
 */
export function threadsFrom(emissions, cls) {
  const { earshotM, closeMs } = soundMs(cls);
  return clusterVoices(emissions.map(emissionToVoice), { earshotM, fadeMs: closeMs });
}

/** A partition of ids — the comparable shape. Ordering and naming cannot hide a disagreement in this. */
export const partitionOf = (clusters, keyOf = (v) => v.id) =>
  new Set(clusters.map((c) => c.voices.map(keyOf).sort().join(" ")));

// ── the prune ────────────────────────────────────────────────────────────────

/**
 * Drop emissions whose presence has faded AND whose occurrence is already
 * history in the world repo.
 *
 * `meta.logged_through` is written by `tools/crossing-save.mjs` when a save
 * commits. Without it nothing is pruned at all — which is the correct failure:
 * an office whose crossing-save has never run keeps growing rather than quietly
 * dropping speech nobody wrote down. `keepMs` is a courtesy margin so a save
 * running at the boundary never races a row into the gap.
 */
export function pruneEmissions(db, { atMs = Date.now(), keepMs = 0 } = {}) {
  const loggedThrough = getMeta(db, "logged_through");
  if (!loggedThrough)
    return { pruned: 0, refused: "no-crossing-save-yet: occurrence has never been crystallized, so nothing may be dropped" };
  const horizon = iso(Math.min(Date.parse(loggedThrough), atMs - keepMs));
  const now = iso(atMs);
  const doomed = db.prepare("SELECT COUNT(*) c FROM emissions WHERE ttl_expires_at <= ? AND born_at < ?").get(now, horizon).c;
  db.prepare("DELETE FROM emissions WHERE ttl_expires_at <= ? AND born_at < ?").run(now, horizon);
  putMeta(db, "pruned_through", horizon);
  putMeta(db, "pruned_at", now);
  return { pruned: doomed, horizon, logged_through: loggedThrough };
}
