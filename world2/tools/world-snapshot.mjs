#!/usr/bin/env node
// world-snapshot.mjs — THE CLEARING'S SNAPSHOT, CHECKED (POS-357, POS-410;
// 054_world_snapshots.sql, 064_snapshot_register.sql).
//
//   node world2/tools/world-snapshot.mjs --verify
//        [--window <N>]              the snapshot of window N (default: the newest)
//        [--world-repo <checkout>]   derive its World: the world's engine at the snapshot's
//                                    law_sha, over the snapshot's SOURCES (below)
//        [--town-repo <checkout>]    a town checkout AT the snapshot's town_sha: the stakes
//                                    replayed from that ledger (else the store's
//                                    escrow_projection at that sha, said so)
//        [--published <world-state.json>]  compare the derived World with a published one
//        [--pg-url <url>]            else WORLD2_PG_URL
//
//   Read-only, inside BEGIN READ ONLY, rolled back. Any role that can SELECT the
//   snapshot tables (office_api, clearing_job, law_ingester, snapshot_reader).
//
//   EXIT: 0 sound · 1 a DIFFERENCE (each named) · 2 cannot run (no store, no 054, no snapshot)
//
// WHAT IT CHECKS, in order, every one naming what it found:
//   1. THE DIGESTS (src/world-snapshot.mjs § checkSnapshot): each mark and register
//      version hashes to its digest, each list to its digest, the header to its
//      digest. A second computation in JS of what the seal computed in SQL.
//   2. THE STORE (§ compareToStore), for the NEWEST snapshot: every standing mark and
//      every register row in the store is in the snapshot with the same bytes. A
//      dropped one reds and is named. Exact right after the clearing; the review
//      lane, marks-ingest, retire-unpublished and the registry's own doors write
//      between clearings, so a later run that differs says whether the store has
//      moved since.
//   3. THE WORLD, with --world-repo, DERIVED FROM THE SNAPSHOT'S SOURCES ALONE
//      (POS-410, Darko 2026-10-05): the marks' versions, the register at the seal,
//      the ledger position, the law and terrain at law_sha, and the marks in the
//      order derived from their filings (src/world-filing-order.mjs). The git
//      reads are at law_sha: the engine's code, the freeze manifest and the tree's
//      filings. Then, for the newest snapshot, the same fold over the store's own
//      standing rows (the office's read, real uuids), and against a cached fold
//      and a --published file. Folds are compared VALUE-EQUAL, as canonical JSON
//      (keys sorted, every array in order; Wright, 2026-10-05). jsonb keeps no key
//      order, so a key order is never a difference, and an array order always is.
//      A difference names its first key, and says when only an order differs.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  snapshotHeader, snapshotRows, snapshotRegisterRows, standingRowsNow, registerRowsNow,
  checkSnapshot, compareToStore, foldOfSnapshot, snapshotFoldInputs, foldDifference, foldComparison,
} from "../../src/world-snapshot.mjs";

const flag = (name) => process.argv.includes(`--${name}`);
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
}

if (!flag("verify")) {
  console.error("usage: world-snapshot.mjs --verify [--window <N>] [--world-repo <checkout>] [--town-repo <checkout at town_sha>] [--published <world-state.json>] [--pg-url <url>]");
  process.exit(2);
}
const url = arg("pg-url") ?? process.env.WORLD2_PG_URL;
if (!url) { console.error("no store: pass --pg-url or set WORLD2_PG_URL"); process.exit(2); }
const windowArg = arg("window");
const worldRepo = arg("world-repo");
const townRepo = arg("town-repo");
const publishedPath = arg("published");

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: url });
await client.connect();

let exit = 0;
const red = (line) => { exit = 1; console.log(`  ✗ ${line}`); };
const ok = (line) => console.log(`  ✓ ${line}`);

/**
 * Two folds, compared canonically. On a difference: the keys whose values differ
 * (the first difference named), and apart from them the keys that differ only in
 * ARRAY ORDER, which the fold reads (it is first-in-order-wins).
 */
function compareFolds(label, a, b) {
  const c = foldComparison(a, b);
  if (!c.orderOnly.length && !c.values.length) { ok(`${label}: VALUE-EQUAL (canonical JSON: keys sorted, every array in order; ${c.equal.length} keys)`); return; }
  if (c.values.length) red(`${label}: VALUES differ in ${c.values.join(", ")} (first: ${foldDifference(a, b) ?? c.values[0]})`);
  if (c.orderOnly.length) red(`${label}: the same values in another ORDER in ${c.orderOnly.join(", ")}${c.values.length ? "" : " — nothing else differs"}`);
}

try {
  await client.query("BEGIN READ ONLY");
  const { rows: [has] } = await client.query("SELECT to_regclass('public.world_snapshots') IS NOT NULL AS ok");
  if (!has.ok) throw new Error("054_world_snapshots.sql is not applied on this store");

  const header = await snapshotHeader(client, windowArg != null ? { window: Number(windowArg) } : {});
  if (!header) throw new Error(windowArg != null ? `no snapshot for window ${windowArg}` : "no snapshot in this store yet");
  const newest = await snapshotHeader(client);
  const isNewest = newest && newest.id === header.id;
  console.log(`snapshot ${header.id} · window ${header.window_id ?? "∅"} · ${header.marks} mark(s) · digest ${header.digest.slice(0, 12)} · taken ${new Date(header.taken_at).toISOString()}${isNewest ? " (the newest)" : ""}`);
  console.log(`  law ${header.law_sha?.slice(0, 12) ?? "∅"} · town ${header.town_sha?.slice(0, 12) ?? "∅"} · world ${header.world_sha?.slice(0, 12) ?? "∅"} · register ${header.register_digest?.slice(0, 12) ?? "∅ (sealed before 064)"}`);

  // 1 · the digests
  const rows = await snapshotRows(client, header.marks_digest);
  const registerRows = header.register_digest ? await snapshotRegisterRows(client, header.register_digest) : null;
  const problems = checkSnapshot(header, rows, registerRows);
  if (problems.length) for (const p of problems) red(`digest: ${p}`);
  else ok(`digests: ${rows.length} mark version(s), ${registerRows?.length ?? 0} register row(s), both lists and the header hash to what they say`);

  // 2 · the store, for the newest snapshot
  if (!isNewest) {
    console.log(`  · store: not compared — snapshot ${newest.id} (window ${newest.window_id ?? "∅"}) is newer, and the store has moved past this one`);
  } else {
    const now = await standingRowsNow(client);
    const { dropped, extra, changed } = compareToStore(rows, now);
    let moved = dropped.length + extra.length + changed.length;
    if (!moved) ok(`store: the ${now.length} standing mark(s) are the snapshot's, byte for byte`);
    for (const s of dropped) red(`store: DROPPED ${s} — standing in the store, absent from the snapshot`);
    for (const s of extra) red(`store: EXTRA ${s} — in the snapshot, not standing in the store`);
    for (const s of changed) red(`store: CHANGED ${s} — the store's row is not the snapshot's version`);
    if (registerRows) {
      const regNow = await registerRowsNow(client);
      const r = compareToStore(registerRows.map((x) => ({ slug: x.key, digest: x.digest })), regNow.map((x) => ({ slug: x.key, digest: x.digest })));
      const n = r.dropped.length + r.extra.length + r.changed.length;
      moved += n;
      if (!n) ok(`register: the ${regNow.length} register row(s) are the snapshot's, byte for byte`);
      for (const k of r.dropped) red(`register: DROPPED ${k} — in the store's register, absent from the snapshot`);
      for (const k of r.extra) red(`register: EXTRA ${k} — in the snapshot, not in the store's register`);
      for (const k of r.changed) red(`register: CHANGED ${k} — the store's row is not the snapshot's version`);
    }
    if (moved) {
      const since = [];
      const { rows: [open] } = await client.query(
        "SELECT id, receipts FROM windows WHERE id > $1 ORDER BY id LIMIT 1", [header.window_id ?? 0]);
      if (Array.isArray(open?.receipts?.review_rulings) && open.receipts.review_rulings.length)
        since.push(`window ${open.id} carries ${open.receipts.review_rulings.length} review ruling(s)`);
      const { rows: [wm] } = await client.query("SELECT ingested_at FROM projection_heads WHERE repo = 'world-marks'");
      if (wm?.ingested_at && new Date(wm.ingested_at) > new Date(header.taken_at)) since.push(`world-marks was ingested at ${new Date(wm.ingested_at).toISOString()}, after the seal`);
      console.log(since.length
        ? `  · the store HAS moved since the seal (${since.join("; ")}), so a difference may be that movement and not the seal`
        : "  · nothing the office records about marks moved since the seal (a register change is a door's act and is not recorded here)");
    }
  }

  // 3 · the World, from the sources
  if (worldRepo) {
    if (!header.law_sha) throw new Error("the snapshot names no law sha, so there is no engine to derive its World with");
    const { materializeAtRef } = await import("../../src/world-branches.mjs");
    const tools = materializeAtRef(worldRepo, header.law_sha, "tools");
    const { fold } = await import(pathToFileURL(join(tools, "tools", "marks-fold.mjs")).href);
    const { filingAt, inFilingOrder } = await import("../../src/world-filing-order.mjs");
    const filing = filingAt(worldRepo, header.law_sha);
    const { state: derived, stakesSource, householdsSource } = await foldOfSnapshot(client, header, { fold, townRepo, filing });
    console.log(`  · world: derived from the snapshot's sources — the engine, class marks and terrain at law ${header.law_sha.slice(0, 12)}; stakes ${stakesSource}; households ${householdsSource}; the marks in their filing order (${filing.frozen.size} frozen, ${filing.filed.size} filed at that sha, the rest by the write-down's rule)`);
    if (isNewest) {
      const { marksFromRows } = await import("../../src/world2-fold.mjs");
      const { rows: storeRows } = await client.query(
        "SELECT id, slug, kind, owner, household, body, geometry, status, locked_window, parent, data FROM marks WHERE status = 'standing' ORDER BY slug");
      const inputs = await snapshotFoldInputs(client, header, { townRepo });
      const storeFold = fold({ marks: inFilingOrder(marksFromRows(storeRows, inputs.lawRows), filing), terrain: inputs.terrain, stakes: inputs.stakes, households: inputs.households });
      compareFolds("world vs the store rows' fold", derived, storeFold);
    }
    const { rows: [cached] } = await client.query("SELECT state FROM world_snapshot_folds WHERE digest = $1", [header.digest]);
    if (cached) compareFolds(`world vs the cached fold of ${header.digest.slice(0, 12)}`, derived, JSON.parse(cached.state));
    else console.log("  · world: no cached fold kept for this digest (built by the office on first read, POS-359)");
    if (publishedPath) compareFolds(`world vs the published ${publishedPath}`, derived, JSON.parse(readFileSync(publishedPath, "utf8")));
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
