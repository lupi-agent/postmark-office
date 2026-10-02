// position-snapshot.mjs — THE DEPARTURE RECORD'S SNAPSHOT PER CLEARING, AND THE
// DELTA SINCE (POS-302, the first instance of POS-277).
//
// Keemin, 2026-09-27: "let's aim to have essentially everything snapshotted per
// settlement/clearing, and only live compute the delta between settlement
// snapshots." Every reader of "where is everyone" reduced the WHOLE departure
// record to one record per handle: the positions projection at boot and every
// 60 s, and the 2.0 endpoints (`/world2/positions`, `/world2/present`) on every
// request. This file is the two halves of doing that once per clearing instead:
//
//   buildSnapshot(actRows)   every departure act, both eras, in DEPARTURE_ORDER,
//                            reduced to each handle's governing record (in
//                            `departureRecords`' shape) with its first-appearance
//                            ordinal, plus the per-era census and the cut's key.
//   composeSnapshot(...)     a kept snapshot plus the acts after it, as the list
//                            `governingOf` reduces exactly as it reduces the
//                            whole record, with the census the whole record
//                            would give — or a DISCARD with its reason.
//   snapshotRead(client)     the one read of a snapshot, its recount and delta.
//
// No connection of its own, no transaction, no clock.
//
// ── ERA ONE IS THE STORE'S `_ledger` ROWS (Wright, 2026-10-02) ───────────────
//
// Era one had two owners: the git walk ledger (the projection) and the store's
// `_ledger` rows (the 2.0 endpoints). Git reads are what is being retired, so a
// snapshot holds the store's `_ledger` rows like any other era, and nothing that
// reads a snapshot reads git. The backfill carried only the ledger lines older
// than the journal's first row (the rest were journal rows already), so the
// store's era one equals the git ledger only together with the store's other
// eras; test/era-one-from-the-store.test.mjs holds that, and the writer refuses
// to write a snapshot over a store where it does not hold
// (world2/tools/position-snapshot.mjs § compareEraOne).
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
//   SORTS INSIDE THE SNAPSHOT. The order is (era, instant, id), ruled
//   2026-09-21 (live-reads.mjs § THE INSTANT KEY), so a backfilled act with an
//   early instant and a late id belongs INSIDE the snapshot's span. Every delta
//   row must sort after the snapshot's last key, or the snapshot is discarded.
//
// A discarded snapshot is not an error: the full derivation serves and the read
// says so (Keemin, 2026-10-02: the full derivation wins, disclosed).
//
// ── THE ERA-ORDER OVERLAP IS KEPT, NOT RE-COUNTED ────────────────────────────
//
// The projection discloses `era-order-overlap: N store record(s) predate the
// newest ledger line` (prod: 12 on 2026-10-02, the journal's copies of the
// ledger's last lines). The ledger is frozen and those rows never leave, so the
// writer counts them once against the ledger's newest instant and the snapshot
// keeps both; a read adds the delta's own and says the same number.

import { departureRecords, DEPARTURE_ACTIONS, DEPARTURE_ORDER_SQL, DEPARTURE_ORDER_KEYS } from "../world2/tools/live-reads.mjs";

/** Every departure act, both eras — what the 2.0 endpoints read, and what a snapshot reduces. */
export const ALL_ERAS = `action = ANY($1)`;
export const ALL_ROWS_SQL =
  `SELECT id, at, crossing, actor, action, payload FROM acts WHERE ${ALL_ERAS} ${DEPARTURE_ORDER_SQL}`;
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
     FROM (SELECT count(*)::int AS n FROM acts WHERE ${ALL_ERAS} AND id <= $2) c
     LEFT JOIN LATERAL (SELECT id, at, crossing, actor, action, payload FROM acts
                         WHERE ${ALL_ERAS} AND id > $2) acts ON true
   ${DEPARTURE_ORDER_SQL}`;
export { DEPARTURE_ACTIONS };

const isLedger = (r) => r.era === "ledger";

/** A row's place in DEPARTURE_ORDER, as the order's own keys read it. */
export const keyOf = (row) => DEPARTURE_ORDER_KEYS.map((k) => {
  const v = k.of(row);
  return v instanceof Date ? v.getTime() : typeof v === "string" ? Date.parse(v) : v;
});

/** Postgres' ASC order over the key tuple (NULLs last, as `ORDER BY` puts them). */
function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (x == null) return 1;
    if (y == null) return -1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** `departureRecords` over the rows, refusing an unreadable store-era instant by name as `storedDepartures` does. */
function recordsOf(actRows) {
  const got = departureRecords(actRows);
  for (const r of got.records) {
    if (!isLedger(r) && !Number.isFinite(Date.parse(r.iso)))
      throw new Error(`a departure record carries an unreadable instant: ${String(r.iso).slice(0, 60)}`);
  }
  return got;
}

/** The ledger instant as `departuresAcrossEras` holds it: no ledger is 0. */
export const ledgerMsOf = (iso) => (iso == null ? 0 : Date.parse(iso) || 0);

/** `departuresAcrossEras`' own count: store records older than the ledger's newest line. */
const overlapOf = (records, newestLedgerMs) =>
  records.filter((r) => !isLedger(r) && (Date.parse(r.iso) || 0) < newestLedgerMs).length;

/** The per-era census, `departureCensus`' shape and key order, summed. */
function sumEras(a, b) {
  const out = { ...a };
  for (const [k, n] of Object.entries(b)) out[k] = (out[k] ?? 0) + n;
  return out;
}

/**
 * The snapshot of `actRows` (ALL_ROWS_SQL's answer, read in one statement so the
 * rows and their count are one set). `ledgerNewestIso` is the frozen ledger's
 * newest instant, measured as `departuresAcrossEras` measures it (null for none).
 *
 * Returns `{ header: { hw_id, hw_count, last_key, max_iso, eras,
 * ledger_newest_iso, overlap_count }, rows: [{ handle, first_ordinal, record }] }`:
 * `record` the JSON text of the governing record in `departureRecords`' shape,
 * `eras` the JSON text of the census (text, so its key order survives), and
 * `max_iso` the newest STORE-era instant (era one is never cut by an instant).
 */
export function buildSnapshot(actRows = [], { ledgerNewestIso = null } = {}) {
  const { records, eras } = recordsOf(actRows);
  const governing = new Map();   // handle -> { first_ordinal, record }
  let maxIso = null;
  for (const r of records) {
    const prior = governing.get(r.handle);
    governing.set(r.handle, { first_ordinal: prior ? prior.first_ordinal : governing.size, record: r });
    if (!isLedger(r) && (maxIso == null || Date.parse(r.iso) > Date.parse(maxIso))) maxIso = r.iso;
  }
  const last = actRows.at(-1) ?? null;
  return {
    header: {
      hw_id: actRows.reduce((m, r) => Math.max(m, Number(r.id)), 0),
      hw_count: actRows.length,
      last_key: last ? JSON.stringify(keyOf(last)) : null,
      max_iso: maxIso,
      eras: JSON.stringify(eras),
      ledger_newest_iso: ledgerNewestIso,
      overlap_count: overlapOf(records, ledgerMsOf(ledgerNewestIso)),
    },
    rows: [...governing].map(([handle, g]) => ({ handle, first_ordinal: g.first_ordinal, record: JSON.stringify(g.record) })),
  };
}

/**
 * A kept snapshot plus the acts after it.
 *
 * `snap` is `snapshotRead`'s answer: `{ window, header, rows, recount, delta }`.
 * `atMs`, when given, cuts the STORE era by instant (the projection's cut,
 * `storedDepartures`'); null takes the whole delta (the 2.0 endpoints, which
 * evaluate every record at the instant asked and cut nothing).
 *
 * Answers `{ records, eras, store_records, overlap, snapshot: { window, delta } }`
 * — `records` being every handle's governing record in first-appearance order,
 * then the delta's records, all in `departureRecords`' shape; `eras` the census
 * the whole record would give; `overlap` the count the whole record's
 * `era-order-overlap` would say — or `{ discard: <reason> }`.
 */
export function composeSnapshot(snap, { atMs = null } = {}) {
  const { window, header, rows, recount, delta = [] } = snap;
  if (Number(recount) !== Number(header.hw_count))
    return { discard: `a departure act committed under an id at or below the snapshot's high-water (${header.hw_id}) after window ${window}'s snapshot was taken (count ${recount}, kept ${header.hw_count})` };
  if (atMs != null && header.max_iso != null && Date.parse(header.max_iso) > atMs)
    return { discard: `window ${window}'s snapshot holds a record after the instant asked (${header.max_iso})` };
  const lastKey = header.last_key == null ? null : JSON.parse(header.last_key);
  const inside = lastKey && delta.find((r) => compareKeys(keyOf(r), lastKey) <= 0);
  if (inside)
    return { discard: `act ${inside.id} sorts inside window ${window}'s snapshot (its place ${JSON.stringify(keyOf(inside))} is not after the snapshot's last, ${header.last_key})` };
  const kept = [...rows].sort((a, b) => a.first_ordinal - b.first_ordinal).map((r) => JSON.parse(r.record));
  const got = recordsOf(delta);
  const since = atMs == null ? got.records : got.records.filter((r) => isLedger(r) || Date.parse(r.iso) <= atMs);
  const eras = sumEras(JSON.parse(header.eras), atMs == null ? got.eras : censusOf(since));
  const ledgerKept = JSON.parse(header.eras).ledger ?? 0;
  return {
    records: [...kept, ...since],
    eras,
    store_records: Number(header.hw_count) - ledgerKept + since.filter((r) => !isLedger(r)).length,
    overlap: Number(header.overlap_count) + overlapOf(since, ledgerMsOf(header.ledger_newest_iso)),
    snapshot: { window, delta: since.length },
  };
}

/** `departureCensus` over records, in `departureRecords`' own key order. */
function censusOf(records) {
  const eras = { ledger: 0, journal: 0, "journal-line": 0, live: 0, "movement-store": 0 };
  for (const r of records) eras[r.era] = (eras[r.era] ?? 0) + 1;
  return eras;
}

/**
 * THE ONE READ of a snapshot, its recount and its delta, on `client`.
 *
 * `atMs` picks the newest snapshot whose newest store-era record is at or
 * before it (a snapshot is taken on the keep tick after its window closed and
 * can hold acts that landed after the close, so a read at the close takes the
 * snapshot before it); null picks the newest. Null when 053 is not applied or
 * no snapshot qualifies.
 */
export async function snapshotRead(client, { atMs = null } = {}) {
  const { rows: [has] } = await client.query("SELECT to_regclass('position_snapshots') IS NOT NULL AS ok");
  if (!has?.ok) return null;
  const { rows: [header] } = await client.query(
    `SELECT window_id, hw_id, hw_count, last_key, max_iso, eras, ledger_newest_iso, overlap_count FROM position_snapshots
      WHERE $1::timestamptz IS NULL OR max_iso IS NULL OR max_iso::timestamptz <= $1::timestamptz
      ORDER BY window_id DESC LIMIT 1`, [atMs == null ? null : new Date(atMs).toISOString()]);
  if (!header) return null;
  const hw = String(header.hw_id);
  const { rows } = await client.query(
    "SELECT handle, first_ordinal, record FROM position_snapshot_rows WHERE window_id = $1 ORDER BY first_ordinal", [header.window_id]);
  const { rows: since } = await client.query(RECOUNT_AND_DELTA_SQL, [DEPARTURE_ACTIONS, hw]);
  return {
    window: Number(header.window_id),
    header: {
      hw_id: Number(header.hw_id), hw_count: Number(header.hw_count), last_key: header.last_key,
      max_iso: header.max_iso, eras: header.eras,
      ledger_newest_iso: header.ledger_newest_iso, overlap_count: Number(header.overlap_count),
    },
    rows,
    recount: since[0]?.recount ?? null,
    delta: since.filter((r) => r.id != null).map(({ recount, ...r }) => r),
  };
}
