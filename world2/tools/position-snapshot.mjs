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
//        [--compare-era-one --world-repo <checkout>]
//                               read-only: the store's `_ledger` rows against the git walk ledger
//                               at the checkout's main, line for line and as governing records
//                               with the store's other eras (POS-302 PR 3); exit 1 on a difference.
//                               It connects as `snapshot_reader` and nothing else (it refuses any
//                               other role) and reads inside BEGIN READ ONLY, rolled back.
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
// (position-snapshot.mjs § ALL_ROWS_SQL), so it may hold acts that landed
// after the window closed. That is exact, not stale: the reader replays only
// the acts after the high-water, and a past read at the close itself takes the
// snapshot before it (world2-guards.mjs § storeDepartureSnapshot).
//
// ── THE FALSIFIER, ON A LIVE STORE ───────────────────────────────────────────
//
// `--verify` reduces every departure act with `governingOf` two ways, the
// whole record and the newest snapshot plus its delta, and compares the two
// answers, and their per-era census, byte for byte, order included. It is
// read-only.
//
// ── ERA ONE IS PROVEN BEFORE A SNAPSHOT IS WRITTEN ───────────────────────────
//
// A snapshot holds era one as the store's `_ledger` rows, and nothing that reads
// it reads git. So the writer runs `compareEraOne` first and REFUSES to write
// over a store whose `_ledger` rows do not answer what the git ledger answers
// (a store never backfilled, or backfilled from another ledger): the office
// then reads the whole record, git included, until the store is put right.

import pg from "pg";
import { buildSnapshot, composeSnapshot, snapshotRead, ALL_ROWS_SQL, DEPARTURE_ACTIONS } from "../../src/position-snapshot.mjs";
import { governingOf } from "../../src/position-projection.mjs";

const NL = "\n";
const flag = (name) => process.argv.includes(`--${name}`);
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}

/** The store era's departure acts alone (no `_ledger`), in DEPARTURE_ORDER. */
const STORE_ERA_ROWS_SQL = ALL_ROWS_SQL.replace("WHERE action = ANY($1)", "WHERE action = ANY($1) AND payload->>'_ledger' IS NULL");

/** The newest closed window, or null. */
export async function newestClosedWindow(q) {
  const { rows: [w] } = await q.query("SELECT id FROM windows WHERE status = 'closed' ORDER BY id DESC LIMIT 1");
  return w ? Number(w.id) : null;
}

/**
 * The frozen walk ledger's newest instant, read as `world.mjs §
 * departuresAcrossEras` reads it: `WORLD/walk-ledger.md` at the checkout's
 * `mainRef` (refs/heads/main, else refs/remotes/origin/main), parsed by the checkout's own walk.mjs, the latest `iso`. Null when the
 * ledger holds no line. Throws when it cannot be read: a snapshot measured
 * against nothing would be discarded by every reader that can read it.
 */
export async function ledgerNewestIso(worldRepo) {
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { parseWalkLedger } = await import(pathToFileURL(join(worldRepo, "tools", "walk.mjs")).href);
  // The ref the office reads it at (world.mjs § walkLedgerAtMain), so the writer
  // and the reader can never measure against two different mains.
  const { mainRef, readAtRef } = await import("../../src/world-branches.mjs");
  const text = readAtRef(worldRepo, mainRef(worldRepo), "WORLD/walk-ledger.md");
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
  const { rows: acts } = await client.query(ALL_ROWS_SQL, [DEPARTURE_ACTIONS]);
  const snap = buildSnapshot(acts, { ledgerNewestIso: ledgerIso });
  const h = snap.header;
  await client.query("BEGIN");
  try {
    const ins = await client.query(
      `INSERT INTO position_snapshots (window_id, hw_id, hw_count, last_key, eras, max_iso, ledger_newest_iso, overlap_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (window_id) DO NOTHING`,
      [windowId, h.hw_id, h.hw_count, h.last_key, h.eras, h.max_iso, h.ledger_newest_iso, h.overlap_count]);
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
 * The newest snapshot plus its delta against the whole record, both eras, as
 * the 2.0 endpoints read them (no instant cut).
 * Answers `{ verdict: "EQUAL" | "DIFFERENT" | "DISCARDED" | "NONE", window, reason? }`.
 */
export async function verifySnapshot(client) {
  const snap = await snapshotRead(client);
  if (!snap) return { verdict: "NONE", window: null };
  const got = composeSnapshot(snap);
  if (got.discard) return { verdict: "DISCARDED", window: snap.window, reason: got.discard };
  const { departureRecords } = await import("./live-reads.mjs");
  const { rows: all } = await client.query(ALL_ROWS_SQL, [DEPARTURE_ACTIONS]);
  const whole = departureRecords(all);
  const same = reduced(got.records) === reduced(whole.records) && JSON.stringify(got.eras) === JSON.stringify(whole.eras);
  return { verdict: same ? "EQUAL" : "DIFFERENT", window: snap.window, delta: got.snapshot.delta };
}

/**
 * ERA ONE, THE STORE AGAINST GIT (POS-302 PR 3). Read-only. Answers
 * `{ verdict: "EQUAL" | "DIFFERENT", carried, git, lines: [...], governing: [...] }`,
 * `lines` naming each carried line that differs from its git line and
 * `governing` each handle whose governing record or place moves when the store's
 * `_ledger` rows stand in for the git ledger beside the store's other eras.
 */
export async function compareEraOne(client, { worldRepo }) {
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { mainRef, readAtRef } = await import("../../src/world-branches.mjs");
  const live = await import("./live-reads.mjs");
  const { parseWalkLedger } = await import(pathToFileURL(join(worldRepo, "tools", "walk.mjs")).href);
  // At the office's own ref (world.mjs § walkLedgerAtMain), as ledgerNewestIso reads it.
  const git = parseWalkLedger(readAtRef(worldRepo, mainRef(worldRepo), "WORLD/walk-ledger.md")).departures;
  const { rows: ledgerActs } = await client.query(
    `SELECT id, at, crossing, actor, action, payload FROM acts
      WHERE action = ANY($1) AND payload->>'_ledger' IS NOT NULL ${live.DEPARTURE_ORDER_SQL}`, [DEPARTURE_ACTIONS]);
  const stored = live.departureRecords(ledgerActs).records.map(live.ledgerRecordOf);
  const { rows: rest } = await client.query(STORE_ERA_ROWS_SQL, [DEPARTURE_ACTIONS]);
  const others = await recordsOf(rest);
  const lines = [];
  for (let i = 0; i < stored.length; i++) {
    if (JSON.stringify(stored[i]) !== JSON.stringify(git[i])) lines.push({ at: i + 1, git: git[i] ?? null, store: stored[i] });
  }
  const a = [...governingOf([...git, ...others])], b = [...governingOf([...stored, ...others])];
  const governing = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) governing.push({ place: i, git: a[i] ?? null, store: b[i] ?? null });
  }
  return { verdict: lines.length || governing.length ? "DIFFERENT" : "EQUAL", carried: stored.length, git: git.length, lines, governing };
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
    // 053 is needed to write or verify a snapshot, never to compare era one:
    // the compare reads only `acts` and the git ledger, and runs on prod before
    // 053 lands (Wright's box run, 2026-10-02 10:59 EDT, refused here).
    const has053 = async () => (await client.query("SELECT to_regclass('position_snapshots') IS NOT NULL AS ok")).rows[0]?.ok;
    if (!flag("compare-era-one") && !(await has053())) { console.error(`no \`position_snapshots\` table in ${dbName}: apply world2/schema/053_position_snapshots.sql first`); process.exit(2); }
    if (flag("compare-era-one")) {
      const repo = arg("world-repo");
      if (!repo) { console.error("--compare-era-one needs --world-repo <checkout>"); process.exit(2); }
      // Read-only by role AND by transaction (Wright, 2026-10-02): the one role
      // that writes nothing, and a transaction Postgres holds read-only.
      const { rows: [who] } = await client.query("SELECT current_user AS u");
      if (who.u !== "snapshot_reader") { console.error(`--compare-era-one connects as snapshot_reader only; this connection is ${who.u}`); process.exit(2); }
      await client.query("BEGIN READ ONLY");
      let c;
      try { c = await compareEraOne(client, { worldRepo: repo }); }
      finally { await client.query("ROLLBACK").catch(() => {}); }
      console.log(`era one · ${c.verdict} · ${c.carried} _ledger row(s) against ${c.git} git line(s) · ${c.lines.length} line(s) differ · ${c.governing.length} governing place(s) differ`);
      if (c.verdict !== "EQUAL") console.log(JSON.stringify({ lines: c.lines.slice(0, 20), governing: c.governing.slice(0, 20) }, null, 2));
      code = c.verdict === "EQUAL" ? 0 : 1;
    } else if (verify) {
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
      const era1 = await compareEraOne(client, { worldRepo: repo });
      if (era1.verdict !== "EQUAL") {
        console.error(`positions snapshot · REFUSED · the store's era one (${era1.carried} _ledger row(s)) does not answer what the git ledger (${era1.git} line(s)) answers: ${era1.lines.length} line(s), ${era1.governing.length} governing place(s) differ — nothing written; --compare-era-one prints them`);
        process.exit(1);
      }
      if (apply) {
        const w = await writeSnapshot(client, windowId, { ledgerNewestIso: ledgerIso });
        console.log(w.wrote
          ? `positions snapshot · window ${windowId} written: ${w.handles} handle(s) over ${w.header.hw_count} act(s), high-water ${w.header.hw_id}`
          : `positions snapshot · window ${windowId} already kept (high-water ${w.header.hw_id}, ${w.header.hw_count} act(s)); nothing written`);
      } else {
        const { rows: acts } = await client.query(ALL_ROWS_SQL, [DEPARTURE_ACTIONS]);
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
