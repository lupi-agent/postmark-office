#!/usr/bin/env node
// world-snapshot.mjs — THE CLEARING'S SNAPSHOT, CHECKED (POS-357; 054_world_snapshots.sql).
//
//   node world2/tools/world-snapshot.mjs --verify
//        [--window <N>]            the snapshot of window N (default: the newest)
//        [--world-repo <checkout>] also fold it: the world's own fold over the snapshot,
//                                  against the fold of the store's standing rows (and against
//                                  the cached fold, when world_snapshot_folds holds one)
//        [--pg-url <url>]          else WORLD2_PG_URL
//
//   Read-only, inside BEGIN READ ONLY, rolled back. Any role that can SELECT the
//   four tables (054 grants office_api, clearing_job, law_ingester, snapshot_reader).
//
//   EXIT: 0 sound · 1 a DIFFERENCE (each named) · 2 cannot run (no store, no 054, no snapshot)
//
// WHAT IT CHECKS, in order, every one naming what it found:
//   1. THE DIGESTS (src/world-snapshot.mjs § checkSnapshot): each version hashes to
//      its digest, the list to its marks_digest, the header to its digest. A
//      second computation in JS of what the seal computed in SQL.
//   2. THE STORE (§ compareToStore), for the NEWEST snapshot: every standing mark in
//      the store is in the snapshot with the same bytes. A dropped mark reds and is
//      named by slug. Exact right after the clearing; the review lane,
//      marks-ingest and retire-unpublished write `marks` between clearings, so a
//      later run that differs says whether the store has moved since (a review
//      ruling on the open window, or a world-marks ingest after the seal).
//   3. THE FOLD, with --world-repo: the world's `fold` at the snapshot's world_sha
//      (else the checkout's blessed ref, said so) over the snapshot's versions,
//      against the same fold over the store's standing rows read the office's way
//      (`marksFromRows` with the real uuids), and against a cached fold if one is
//      kept. The first difference is named by mark id and key.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  snapshotHeader, snapshotRows, standingRowsNow, checkSnapshot, compareToStore,
  foldOfSnapshot, snapshotFoldInputs, foldDifference,
} from "../../src/world-snapshot.mjs";

const flag = (name) => process.argv.includes(`--${name}`);
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}

if (!flag("verify")) {
  console.error("usage: world-snapshot.mjs --verify [--window <N>] [--world-repo <checkout>] [--pg-url <url>]");
  process.exit(2);
}
const url = arg("pg-url") ?? process.env.WORLD2_PG_URL;
if (!url) { console.error("no store: pass --pg-url or set WORLD2_PG_URL"); process.exit(2); }
const windowArg = arg("window");
const worldRepo = arg("world-repo");

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: url });
await client.connect();

let exit = 0;
const red = (line) => { exit = 1; console.log(`  ✗ ${line}`); };
const ok = (line) => console.log(`  ✓ ${line}`);

try {
  await client.query("BEGIN READ ONLY");
  const { rows: [has] } = await client.query("SELECT to_regclass('public.world_snapshots') IS NOT NULL AS ok");
  if (!has.ok) throw new Error("054_world_snapshots.sql is not applied on this store");

  const header = await snapshotHeader(client, windowArg != null ? { window: Number(windowArg) } : {});
  if (!header) throw new Error(windowArg != null ? `no snapshot for window ${windowArg}` : "no snapshot in this store yet");
  const newest = await snapshotHeader(client);
  const isNewest = newest && newest.id === header.id;
  console.log(`snapshot ${header.id} · window ${header.window_id ?? "∅"} · ${header.marks} mark(s) · digest ${header.digest.slice(0, 12)} · taken ${new Date(header.taken_at).toISOString()}${isNewest ? " (the newest)" : ""}`);
  console.log(`  law ${header.law_sha?.slice(0, 12) ?? "∅"} · town ${header.town_sha?.slice(0, 12) ?? "∅"} · world ${header.world_sha?.slice(0, 12) ?? "∅"}`);

  // 1 · the digests
  const rows = await snapshotRows(client, header.marks_digest);
  const problems = checkSnapshot(header, rows);
  if (problems.length) for (const p of problems) red(`digest: ${p}`);
  else ok(`digests: ${rows.length} version(s), the list and the header all hash to what they say`);

  // 2 · the store, for the newest snapshot
  if (!isNewest) {
    console.log(`  · store: not compared — snapshot ${newest.id} (window ${newest.window_id ?? "∅"}) is newer, and the store has moved past this one`);
  } else {
    const now = await standingRowsNow(client);
    const { dropped, extra, changed } = compareToStore(rows, now);
    if (!dropped.length && !extra.length && !changed.length) ok(`store: the ${now.length} standing mark(s) are the snapshot's, byte for byte`);
    else {
      for (const s of dropped) red(`store: DROPPED ${s} — standing in the store, absent from the snapshot`);
      for (const s of extra) red(`store: EXTRA ${s} — in the snapshot, not standing in the store`);
      for (const s of changed) red(`store: CHANGED ${s} — the store's row is not the snapshot's version`);
      const moved = [];
      const { rows: [open] } = await client.query(
        "SELECT id, receipts FROM windows WHERE id > $1 ORDER BY id LIMIT 1", [header.window_id ?? 0]);
      if (Array.isArray(open?.receipts?.review_rulings) && open.receipts.review_rulings.length)
        moved.push(`window ${open.id} carries ${open.receipts.review_rulings.length} review ruling(s)`);
      const { rows: [wm] } = await client.query("SELECT ingested_at FROM projection_heads WHERE repo = 'world-marks'");
      if (wm?.ingested_at && new Date(wm.ingested_at) > new Date(header.taken_at)) moved.push(`world-marks was ingested at ${new Date(wm.ingested_at).toISOString()}, after the seal`);
      console.log(moved.length
        ? `  · the store HAS moved since the seal (${moved.join("; ")}), so a difference may be that movement and not the seal`
        : "  · nothing the office records moved the store since the seal: these differences are the seal's");
    }
  }

  // 3 · the fold
  if (worldRepo) {
    const { blessed, materializeAtRef, readJsonAtRef } = await import("../../src/world-branches.mjs");
    let ref = header.world_sha;
    let said = `the snapshot's world ${ref?.slice(0, 12)}`;
    try { if (!ref) throw new Error("none named"); readJsonAtRef(worldRepo, ref, "WORLD/skeleton.json"); }
    catch { ref = blessed(worldRepo).ref; said = `the checkout's blessed ref ${ref} (the snapshot's world ${header.world_sha?.slice(0, 12) ?? "∅"} is not in it)`; }
    const tools = materializeAtRef(worldRepo, ref, "tools");
    const { fold } = await import(pathToFileURL(join(tools, "tools", "marks-fold.mjs")).href);
    const terrain = readJsonAtRef(worldRepo, ref, "WORLD/skeleton.json");
    let households = null;
    try { households = readJsonAtRef(worldRepo, ref, "WORLD/households.json")?.households ?? null; } catch { households = null; }
    console.log(`  · fold: the engine, terrain and households at ${said}`);

    const snapFold = await foldOfSnapshot(client, header, { fold, terrain, households });
    if (isNewest) {
      const { marksFromRows } = await import("../../src/world2-fold.mjs");
      const { rows: storeRows } = await client.query(
        "SELECT id, slug, kind, owner, household, body, geometry, status, locked_window, parent, data FROM marks WHERE status = 'standing' ORDER BY slug");
      const { lawRows, stakes } = await snapshotFoldInputs(client, header);
      const storeFold = fold({ marks: marksFromRows(storeRows, lawRows), terrain, stakes, households });
      const diff = foldDifference(snapFold, storeFold);
      if (diff) red(`fold: the snapshot's fold and the store rows' fold differ — ${diff}`);
      else ok(`fold: the snapshot's fold equals the store rows' fold (${snapFold.marks?.length ?? 0} records)`);
    }
    const { rows: [cached] } = await client.query("SELECT state FROM world_snapshot_folds WHERE digest = $1", [header.digest]);
    if (cached) {
      const diff = foldDifference(snapFold, JSON.parse(cached.state));
      if (diff) red(`fold: the cached fold of ${header.digest.slice(0, 12)} is not the snapshot's fold — ${diff}`);
      else ok("fold: the cached fold equals the snapshot's fold");
    } else console.log("  · fold: no cached fold kept for this digest (built by the office on first read, POS-359)");
  }

  console.log(exit ? "VERIFY: DIFFERENCE" : "VERIFY: SOUND");
} catch (e) {
  console.error(`world-snapshot: ${e?.message ?? e}`);
  exit = 2;
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
process.exit(exit);
