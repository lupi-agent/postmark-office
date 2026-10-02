// position-snapshot.mjs — THE POSITIONS PROJECTION'S SNAPSHOT PER CLEARING, AND
// THE DELTA SINCE (POS-302, the first instance of POS-277).
//
// Keemin, 2026-09-27: "let's aim to have essentially everything snapshotted per
// settlement/clearing, and only live compute the delta between settlement
// snapshots." The positions projection reduced the WHOLE departure record to
// one record per handle at boot and every 60 s. This file is the two halves of
// doing that once per clearing instead:
//
//   buildSnapshot(actRows)   the store era's departure acts, in DEPARTURE_ORDER,
//                            reduced to each handle's governing record with its
//                            first-appearance ordinal, plus the cut's key.
//   composeSnapshot(...)     a kept snapshot plus the acts after it, as the
//                            list `governingOf` reduces exactly as it reduces
//                            the whole record — or a DISCARD with its reason.
//
// No connection, no transaction, no clock: the store half is
// `world2-guards.mjs § storeDepartureSnapshot` (the read) and
// `world2/tools/position-snapshot.mjs` (the write).
//
// ── WHY IT IS EXACT (and the two cases where it would not be) ────────────────
//
// `governingOf` keeps each handle's LAST record at its FIRST position. The
// snapshot keeps both per handle, so replaying its records in ordinal order and
// then the delta in order lands every handle at the same place with the same
// record — PROVIDED the delta is everything after the snapshot in the record's
// own order. Two things break that, and each is checked, never assumed:
//
//   LATE UNDER A LOWER ID. `acts.id` is drawn before the row commits, so a row
//   can appear under an id the snapshot already passed. The count at id <= hw
//   moves, and the snapshot is discarded.
//   SORTS INSIDE THE SNAPSHOT. The order is (instant, id), ruled 2026-09-21
//   (live-reads.mjs § THE INSTANT KEY), so a backfilled act with an early
//   instant and a late id belongs INSIDE the snapshot's span. Appending it would
//   hand its actor the wrong governing leg. Every delta row must sort after the
//   snapshot's last key, or the snapshot is discarded.
//
// A discarded snapshot is not an error: the full derivation serves and the read
// says so (Keemin, 2026-10-02: the full derivation wins, disclosed).
//
// ── THE ERA-ORDER OVERLAP IS KEPT, NOT RE-COUNTED ────────────────────────────
//
// The whole record discloses `era-order-overlap: N store record(s) predate the
// newest ledger line`, and prod has such records (12 on 2026-10-02). The ledger
// is frozen and those rows never leave, so the count is a fixed fact at write
// time: the snapshot keeps `overlap_count` and the ledger instant it was
// measured against (`ledger_newest_iso`). A read adds the delta's own
// overlapping records and says the same sentence with the same number. Only if
// the ledger's newest line has moved since (it should not; it is frozen) is the
// snapshot discarded.
//
// The frozen era-one ledger is not here. `world.mjs § departuresAcrossEras`
// merges it at read, ledger first, as it always has.

import { departureRecords, DEPARTURE_ACTIONS, DEPARTURE_ORDER_SQL } from "../world2/tools/live-reads.mjs";
import { storedShapeOf } from "./world-movement.mjs";

/** The store era's departure acts — `storeDepartureRows`' own predicate, so the snapshot and the record read one set. */
export const STORE_ERA = `action = ANY($1) AND payload->>'_ledger' IS NULL`;
export const STORE_ERA_ROWS_SQL =
  `SELECT id, at, crossing, actor, action, payload FROM acts WHERE ${STORE_ERA} ${DEPARTURE_ORDER_SQL}`;
/**
 * The recount at id <= hw AND the acts after hw, in ONE statement. Under READ
 * COMMITTED each statement reads its own view, so a row committing between a
 * separate recount and delta, under an id at or below hw, would be in neither.
 * One statement is one view. Every row carries the recount; with no delta the
 * one row carries it alone (`id` null). The lateral is named `acts` so
 * DEPARTURE_ORDER_SQL's own keys order the outer read.
 */
export const RECOUNT_AND_DELTA_SQL =
  `SELECT c.n AS recount, acts.id, acts.at, acts.crossing, acts.actor, acts.action, acts.payload
     FROM (SELECT count(*)::int AS n FROM acts WHERE ${STORE_ERA} AND id <= $2) c
     LEFT JOIN LATERAL (SELECT id, at, crossing, actor, action, payload FROM acts
                         WHERE ${STORE_ERA} AND id > $2) acts ON true
   ${DEPARTURE_ORDER_SQL}`;
export { DEPARTURE_ACTIONS };

const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));

/** Records in `storedDepartures`' shape, refusing an unreadable instant by name as it does. */
function shaped(actRows) {
  const { records } = departureRecords(actRows);
  return records.map((r) => {
    if (!Number.isFinite(Date.parse(r.iso)))
      throw new Error(`a departure record carries an unreadable instant: ${String(r.iso).slice(0, 60)}`);
    return storedShapeOf(r);
  });
}

/**
 * The snapshot of `actRows` (STORE_ERA_ROWS_SQL's answer, read in one
 * statement so the rows and their count are one set).
 *
 * `ledgerNewestIso` is the frozen ledger's newest instant, measured as
 * `departuresAcrossEras` measures it (null for no ledger).
 *
 * Returns `{ header: { hw_id, hw_count, last_at, last_id, max_iso,
 * ledger_newest_iso, overlap_count }, rows: [{ handle, first_ordinal, record }] }`,
 * `record` being the JSON text of the governing record.
 */
export function buildSnapshot(actRows = [], { ledgerNewestIso = null } = {}) {
  const records = shaped(actRows);
  const governing = new Map();   // handle -> { first_ordinal, record }
  let maxIso = null;
  for (const r of records) {
    const prior = governing.get(r.handle);
    governing.set(r.handle, { first_ordinal: prior ? prior.first_ordinal : governing.size, record: r });
    if (maxIso == null || Date.parse(r.iso) > Date.parse(maxIso)) maxIso = r.iso;
  }
  const last = actRows.at(-1) ?? null;
  return {
    header: {
      hw_id: actRows.reduce((m, r) => Math.max(m, Number(r.id)), 0),
      hw_count: actRows.length,
      last_at: last ? new Date(ms(last.at)).toISOString() : null,
      last_id: last ? Number(last.id) : null,
      max_iso: maxIso,
      ledger_newest_iso: ledgerNewestIso,
      overlap_count: overlapOf(records, ledgerMsOf(ledgerNewestIso)),
    },
    rows: [...governing].map(([handle, g]) => ({ handle, first_ordinal: g.first_ordinal, record: JSON.stringify(g.record) })),
  };
}

/** The ledger instant as `departuresAcrossEras` holds it: no ledger is 0. */
export const ledgerMsOf = (iso) => (iso == null ? 0 : Date.parse(iso) || 0);

/** `departuresAcrossEras`' own count: store records older than the ledger's newest line. */
const overlapOf = (records, newestLedgerMs) => records.filter((r) => (Date.parse(r.iso) || 0) < newestLedgerMs).length;

/** Does act row `r` sort after the key (lastAt, lastId) in DEPARTURE_ORDER's store era? */
function sortsAfter(r, lastAt, lastId) {
  if (lastAt == null) return true;
  const a = ms(r.at), b = ms(lastAt);
  return a > b || (a === b && Number(r.id) > Number(lastId));
}

/**
 * A kept snapshot plus the acts after it, as of `atMs`.
 *
 * `snap` is `storeDepartureSnapshot`'s answer: `{ window, header, rows,
 * recount, delta }`, where `recount` is the count at id <= hw and `delta` the
 * acts after hw in DEPARTURE_ORDER.
 *
 * `newestLedgerMs` is the frozen ledger's newest instant as the reader holds it
 * now; it must be the one the snapshot was measured against.
 *
 * Answers `{ records, store_records, overlap, snapshot: { window, delta } }`, the
 * records being every handle's governing record in first-appearance order
 * followed by the delta's records, and `overlap` the count the whole record's
 * `era-order-overlap` would say — or `{ discard: <reason> }`.
 */
export function composeSnapshot(snap, { atMs = Date.now(), newestLedgerMs = 0 } = {}) {
  const { window, header, rows, recount, delta = [] } = snap;
  if (ledgerMsOf(header.ledger_newest_iso) !== newestLedgerMs)
    return { discard: `the frozen ledger's newest line moved since window ${window}'s snapshot was taken (${header.ledger_newest_iso ?? "no ledger"} then, ${newestLedgerMs ? new Date(newestLedgerMs).toISOString() : "no ledger"} now)` };
  if (Number(recount) !== Number(header.hw_count))
    return { discard: `a departure act committed under an id at or below the snapshot's high-water (${header.hw_id}) after window ${window}'s snapshot was taken (count ${recount}, kept ${header.hw_count})` };
  if (header.max_iso != null && Date.parse(header.max_iso) > atMs)
    return { discard: `window ${window}'s snapshot holds a record after the instant asked (${header.max_iso})` };
  const inside = delta.find((r) => !sortsAfter(r, header.last_at, header.last_id));
  if (inside)
    return { discard: `act ${inside.id} sorts inside window ${window}'s snapshot (its instant ${new Date(ms(inside.at)).toISOString()} is not after the snapshot's last, act ${header.last_id} at ${header.last_at})` };
  const kept = [...rows].sort((a, b) => a.first_ordinal - b.first_ordinal).map((r) => JSON.parse(r.record));
  const since = shaped(delta).filter((r) => Date.parse(r.iso) <= atMs);
  return {
    records: [...kept, ...since],
    store_records: Number(header.hw_count) + since.length,
    overlap: Number(header.overlap_count) + overlapOf(since, newestLedgerMs),
    snapshot: { window, delta: since.length },
  };
}
