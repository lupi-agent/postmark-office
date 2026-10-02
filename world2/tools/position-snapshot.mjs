#!/usr/bin/env node
// position-snapshot.mjs — the positions projection's snapshot, kept once per
// clearing (POS-302; 053_position_snapshots.sql).
//
//   node world2/tools/position-snapshot.mjs
//        [--dry-run]            the default: build the newest closed window's snapshot, print it, write nothing
//        [--apply [--prod]]     write it, if that window has none (one transaction)
//        --world-repo <checkout>  where the frozen walk ledger is read (its main), for the
//                               era-order overlap the snapshot keeps; required to write
//        [--verify]             the newest snapshot plus the acts since, against the whole record; exit 1 on a difference
//        [--quiet]              the one receipt line only (the tick's mode)
//
//   env: WORLD2_PG_URL (the office's own connection, `office_api`, the pen 053
//        grants INSERT to), or PG* as `w2_pgenv` exports them, or --pg-url.
//        The dry run and the verify need only SELECT.
//
//   EXIT: 0 · 1 under --verify, a DIFFERENCE or a discarded snapshot · 2 cannot
//         run (no store, no table, no closed window).
//
// ── WHEN, AND BY WHOM (Wright, 2026-10-02, POS-302) ──────────────────────────
//
// The keep tick (deploy/office-keep.sh), after window N has closed, as
// `office_api`: the 049 mark_carried precedent. Never inside the clearing: a
// failed snapshot must never roll back or block a clearing. The tick writes the
// newest closed window's snapshot if it has none, so one tick after each
// clearing it exists, and a tick that finds it present writes nothing.
//
// The snapshot is cut at its own high-water, read in ONE statement
// (position-snapshot.mjs § STORE_ERA_ROWS_SQL), so it may hold acts that landed
// after the window closed. That is exact, not stale: the reader replays only
// the acts after the high-water, and a past read at the close itself takes the
// snapshot before it (world2-guards.mjs § storeDepartureSnapshot).
//
// ── THE FALSIFIER, ON A LIVE STORE ───────────────────────────────────────────
//
// `--verify` reduces the store era with `governingOf` two ways, the whole
// record and the newest snapshot plus its delta, and compares the two byte for
// byte, order included. It is read-only.

import pg from "pg";
import { buildSnapshot, composeSnapshot, ledgerMsOf, STORE_ERA_ROWS_SQL, RECOUNT_AND_DELTA_SQL, DEPARTURE_ACTIONS } from "../../src/position-snapshot.mjs";
import { governingOf } from "../../src/position-projection.mjs";

const NL = "\n";
const flag = (name) => process.argv.includes(`--${name}`);
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}

/** The newest closed window, or null. */
export async function newestClosedWindow(q) {
  const { rows: [w] } = await q.query("SELECT id FROM windows WHERE status = 'closed' ORDER BY id DESC LIMIT 1");
  return w ? Number(w.id) : null;
}

/**
 * The frozen walk ledger's newest instant, read as `world.mjs §
 * departuresAcrossEras` reads it: `WORLD/walk-ledger.md` at the checkout's
 * main, parsed by the checkout's own walk.mjs, the latest `iso`. Null when the
 * ledger holds no line. Throws when it cannot be read: a snapshot measured
 * against nothing would be discarded by every reader that can read it.
 */
export async function ledgerNewestIso(worldRepo) {
  const { execFileSync } = await import("node:child_process");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { parseWalkLedger } = await import(pathToFileURL(join(worldRepo, "tools", "walk.mjs")).href);
  const text = execFileSync("git", ["-C", worldRepo, "show", "main:WORLD/walk-ledger.md"], { encoding: "utf8" });
  const newest = parseWalkLedger(text).departures.reduce((m, d) => Math.max(m, Date.parse(d.iso) || 0), 0);
  return newest ? new Date(newest).toISOString() : null;
}

/**
 * Write window `windowId`'s snapshot if it has none. Answers `{ wrote, window,
 * header, handles }`. `client` is a connected pg client holding INSERT on 053's
 * tables. One transaction: the header and its rows land together or not at all.
 */
export async function writeSnapshot(client, windowId, { ledgerNewestIso: ledgerIso = null } = {}) {
  const { rows: [have] } = await client.query("SELECT hw_id, hw_count FROM position_snapshots WHERE window_id = $1", [windowId]);
  if (have) return { wrote: false, window: windowId, header: { hw_id: Number(have.hw_id), hw_count: Number(have.hw_count) }, handles: null };
  const { rows: acts } = await client.query(STORE_ERA_ROWS_SQL, [DEPARTURE_ACTIONS]);
  const snap = buildSnapshot(acts, { ledgerNewestIso: ledgerIso });
  const h = snap.header;
  await client.query("BEGIN");
  try {
    const ins = await client.query(
      `INSERT INTO position_snapshots (window_id, hw_id, hw_count, last_at, last_id, max_iso, ledger_newest_iso, overlap_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (window_id) DO NOTHING`,
      [windowId, h.hw_id, h.hw_count, h.last_at, h.last_id, h.max_iso, h.ledger_newest_iso, h.overlap_count]);
    if (ins.rowCount === 1) {
      for (const r of snap.rows) {
        await client.query(
          "INSERT INTO position_snapshot_rows (window_id, handle, first_ordinal, record) VALUES ($1, $2, $3, $4)",
          [windowId, r.handle, r.first_ordinal, r.record]);
      }
    }
    await client.query("COMMIT");
    return { wrote: ins.rowCount === 1, window: windowId, header: h, handles: snap.rows.length };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

/** The governing map, as `[[handle, record], …]` JSON — order included. */
const reduced = (records) => JSON.stringify([...governingOf(records)]);

/**
 * The newest snapshot plus its delta against the whole record, store era only.
 * Answers `{ verdict: "EQUAL" | "DIFFERENT" | "DISCARDED" | "NONE", window, reason? }`.
 */
export async function verifySnapshot(client, { atMs = Date.now() } = {}) {
  const { rows: [header] } = await client.query(
    `SELECT window_id, hw_id, hw_count, last_at, last_id, max_iso, ledger_newest_iso, overlap_count FROM position_snapshots
      WHERE max_iso IS NULL OR max_iso::timestamptz <= $1 ORDER BY window_id DESC LIMIT 1`, [new Date(atMs).toISOString()]);
  if (!header) return { verdict: "NONE", window: null };
  const { rows } = await client.query(
    "SELECT handle, first_ordinal, record FROM position_snapshot_rows WHERE window_id = $1 ORDER BY first_ordinal", [header.window_id]);
  const { rows: since } = await client.query(RECOUNT_AND_DELTA_SQL, [DEPARTURE_ACTIONS, String(header.hw_id)]);
  const { rows: all } = await client.query(STORE_ERA_ROWS_SQL, [DEPARTURE_ACTIONS]);
  const window = Number(header.window_id);
  const got = composeSnapshot({
    window,
    header: { hw_id: Number(header.hw_id), hw_count: Number(header.hw_count), last_at: header.last_at instanceof Date ? header.last_at.toISOString() : header.last_at,
              last_id: header.last_id == null ? null : Number(header.last_id), max_iso: header.max_iso,
              ledger_newest_iso: header.ledger_newest_iso, overlap_count: Number(header.overlap_count) },
    rows, recount: since[0]?.recount ?? null, delta: since.filter((r) => r.id != null).map(({ recount, ...r }) => r),
  }, { atMs, newestLedgerMs: ledgerMsOf(header.ledger_newest_iso) });
  if (got.discard) return { verdict: "DISCARDED", window, reason: got.discard };
  // The whole record, cut at the instant as `storedDepartures` cuts it, and
  // reduced by the same `governingOf`: the comparison is of the two answers.
  const wholeRecords = (await recordsOf(all)).filter((r) => Date.parse(r.iso) <= atMs);
  return reduced(got.records) === reduced(wholeRecords)
    ? { verdict: "EQUAL", window, delta: got.snapshot.delta }
    : { verdict: "DIFFERENT", window, delta: got.snapshot.delta };
}

/** Every store-era record in `storedDepartures`' shape, in order. */
async function recordsOf(acts) {
  const { departureRecords } = await import("./live-reads.mjs");
  const { storedShapeOf } = await import("../../src/world-movement.mjs");
  return departureRecords(acts).records.map((r) => storedShapeOf(r));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const apply = flag("apply"), verify = flag("verify"), quiet = flag("quiet");
  if (apply && verify) { console.error("--apply and --verify are two different questions; ask one"); process.exit(2); }
  const url = arg("pg-url") ?? (process.env.PGUSER ? null : process.env.WORLD2_PG_URL);
  if (!url && !process.env.PGDATABASE) {
    console.error("no --pg-url, no PG* environment, and no WORLD2_PG_URL (the office's own connection is the pen 053 grants)");
    process.exit(2);
  }
  const dbName = url ? decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) : process.env.PGDATABASE;
  if (apply && !/lab|scratch/i.test(dbName) && !flag("prod")) {
    console.error(`--apply refuses database "${dbName}": its name says neither "lab" nor "scratch". Pass --prod as WELL if this is the box's own store.`);
    process.exit(2);
  }
  const client = url ? new pg.Client({ connectionString: url }) : new pg.Client();
  try { await client.connect(); }
  catch (e) { console.error(`cannot reach ${dbName}: ${String(e?.message ?? e)}`); process.exit(2); }
  let code = 0;
  try {
    const { rows: [has] } = await client.query("SELECT to_regclass('position_snapshots') IS NOT NULL AS ok");
    if (!has.ok) { console.error(`no \`position_snapshots\` table in ${dbName}: apply world2/schema/053_position_snapshots.sql first`); process.exit(2); }
    if (verify) {
      const v = await verifySnapshot(client);
      console.log(`positions snapshot · verify · ${v.verdict}${v.window != null ? ` · window ${v.window}` : ""}${v.delta != null ? ` + ${v.delta} act(s)` : ""}${v.reason ? ` · ${v.reason}` : ""}`);
      code = v.verdict === "EQUAL" || v.verdict === "NONE" ? 0 : 1;
    } else {
      const windowId = await newestClosedWindow(client);
      if (windowId == null) { console.error(`${dbName} holds no closed window yet: nothing to snapshot`); process.exit(2); }
      const repo = arg("world-repo");
      if (!repo) { console.error("--world-repo <checkout> is required: the snapshot keeps the era-order overlap against its frozen walk ledger"); process.exit(2); }
      let ledgerIso;
      try { ledgerIso = await ledgerNewestIso(repo); }
      catch (e) { console.error(`the walk ledger at ${repo} cannot be read (${String(e?.message ?? e).slice(0, 160)}): nothing written`); process.exit(2); }
      if (apply) {
        const w = await writeSnapshot(client, windowId, { ledgerNewestIso: ledgerIso });
        console.log(w.wrote
          ? `positions snapshot · window ${windowId} written: ${w.handles} handle(s) over ${w.header.hw_count} act(s), high-water ${w.header.hw_id}`
          : `positions snapshot · window ${windowId} already kept (high-water ${w.header.hw_id}, ${w.header.hw_count} act(s)); nothing written`);
      } else {
        const { rows: acts } = await client.query(STORE_ERA_ROWS_SQL, [DEPARTURE_ACTIONS]);
        const snap = buildSnapshot(acts, { ledgerNewestIso: ledgerIso });
        console.log(`positions snapshot · dry-run · window ${windowId} would hold ${snap.rows.length} handle(s) over ${snap.header.hw_count} act(s), high-water ${snap.header.hw_id}`);
        if (!quiet) console.log(JSON.stringify(snap.header, null, 2));
      }
    }
  } catch (e) {
    console.error(`positions snapshot · FAILED · ${String(e?.message ?? e).slice(0, 300)}`);
    code = 2;
  } finally {
    await client.end().catch(() => {});
  }
  process.exit(code);
}
