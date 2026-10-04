// graph-ingest.mjs — world.db's rows into the store's graph snapshot, one
// settlement at a time (037/038, POS-270; Wright-ruled 2026-09-30, option A).
//
//   node world2/tools/graph-ingest.mjs --db <world.db> [--keep 4] [--dry-run] [--json]
//     PGHOST/PGDATABASE/PGUSER(=law_ingester)/PGPASSWORD, as law-ingest.mjs.
//
// Run after the blessed hydration (`world-hydrate.mjs --ref blessed`). It reads
// the hydrated file's tables with the office's own reader
// (world-store.mjs § readWorldDbTables, the same rows `loadWorldGraph` builds
// from) and writes them, unchanged, as ONE snapshot keyed by (as_of_world,
// as_of_office), in one transaction: an existing snapshot at that key is
// replaced whole, and only the newest `--keep` snapshots stay.
//
// THE HYDRATOR WRITES THE SNAPSHOT ITSELF NOW (world-hydrate.mjs --to-store,
// POS-270 lane W item 1), from the rows it built, through
// `writeGraphSnapshot` below. This CLI's --db path is the manual one, for a
// world.db that already exists.
//
// A FAILED-stamped hydration is refused, never copied. A snapshot of a store
// that said it was broken would be a broken store with a better address.

import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readWorldDbTables } from "../../src/world-store.mjs";

/** The snapshot's key and the rows beneath it, from world.db's tables. */
export function graphSnapshotFromTables(tables) {
  const meta = Object.fromEntries(tables.meta.map((r) => [r.key, r.value]));
  const status = String(meta.hydration_status ?? "");
  if (status !== "OK") throw new Error(`the world store is stamped "${status || "(none)"}" — only an OK hydration is copied into the store`);
  const tagSha = meta.as_of_world || null;
  const officeSha = meta.as_of_office || null;
  if (!tagSha) throw new Error("the world store names no as_of_world — no settlement to key the snapshot by");
  if (!officeSha) throw new Error("the world store names no as_of_office — the code nodes' source is unknown, and it is half the key");
  const n = /^S(\d+)$/.exec(String(meta.as_of_settlement ?? ""))?.[1];
  return { tagSha, officeSha, settlement: n == null ? null : Number(n), tables };
}

// The columns each table carries, in world.db's own order. `ord` is written
// for the tables whose file order is their rowid (text primary keys), so the
// store hands them back in the order the graph was built in.
const COLUMNS = {
  world_graph_meta: ["ord", "key", "value"],
  world_graph_nodes: ["ord", "id", "kind", "subkind", "tier", "by", "at_x", "at_y", "extent_w", "extent_h", "props"],
  world_graph_edges: ["seq", "src", "dst", "type", "props", "born_at"],
  world_graph_geometry: ["seq", "mark_id", "at_x", "at_y", "extent_w", "extent_h", "valid_from_iso", "valid_to_iso", "sha", "path", "subject", "authored_iso", "change"],
  world_graph_lints: ["ord", "lint", "verdict", "headline", "evidence", "hydrated_at", "as_of_world"],
  world_graph_events: ["seq", "at", "actor", "type", "payload"],
};
const SOURCE = {
  world_graph_meta: "meta", world_graph_nodes: "nodes", world_graph_edges: "edges",
  world_graph_geometry: "geometryVersions", world_graph_lints: "lintFindings", world_graph_events: "events",
};

/** Rows for one table, `ord` filled from the file's order. */
function rowsFor(table, tables) {
  return tables[SOURCE[table]].map((r, i) => COLUMNS[table].map((c) => (c === "ord" ? i : r[c] ?? null)));
}

/**
 * Write one snapshot, replacing any at its key, and keep the newest `keep`.
 * `client.query(sql, params)`: a pg client or PGlite. The caller's client is
 * put in ONE transaction here.
 */
export async function writeGraphSnapshot(client, snap, { keep = 4, batch = 400 } = {}) {
  const { tagSha, officeSha, settlement, tables } = snap;
  await client.query("BEGIN");
  try {
    await client.query("DELETE FROM world_graphs WHERE tag_sha = $1 AND office_sha = $2", [tagSha, officeSha]);
    await client.query("INSERT INTO world_graphs (tag_sha, office_sha, settlement) VALUES ($1, $2, $3)", [tagSha, officeSha, settlement]);
    const counts = {};
    for (const table of Object.keys(COLUMNS)) {
      const cols = ["tag_sha", "office_sha", ...COLUMNS[table]];
      const rows = rowsFor(table, tables);
      counts[table] = rows.length;
      for (let i = 0; i < rows.length; i += batch) {
        const chunk = rows.slice(i, i + batch);
        const params = [];
        const values = chunk.map((r) => {
          const row = [tagSha, officeSha, ...r];
          const at = params.length;
          params.push(...row);
          return `(${row.map((_, j) => `$${at + j + 1}`).join(", ")})`;
        });
        await client.query(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES ${values.join(", ")}`, params);
      }
    }
    // The kept few: the newest by settlement, then by build. CASCADE takes the rows.
    const { rows: stale } = await client.query(
      `SELECT tag_sha, office_sha FROM world_graphs
        ORDER BY settlement DESC NULLS LAST, built_at DESC OFFSET $1`, [keep]);
    for (const s of stale) await client.query("DELETE FROM world_graphs WHERE tag_sha = $1 AND office_sha = $2", [s.tag_sha, s.office_sha]);
    await client.query("COMMIT");
    return { tag_sha: tagSha, office_sha: officeSha, settlement, counts, dropped: stale.length };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* the connection is gone; nothing committed */ }
    throw e;
  }
}

/**
 * The newest snapshot's lint verdicts, for the hydrator's delta when there is no
 * file to compare against. `{ as_of_world, hydrated_at, findings }` in the shape
 * the hydrator reads off an old world.db, or null with no snapshot.
 */
export async function previousGraphLints(client) {
  const { rows: [pin] } = await client.query(
    `SELECT tag_sha, office_sha FROM world_graphs ORDER BY settlement DESC NULLS LAST, built_at DESC LIMIT 1`);
  if (!pin) return null;
  const at = [pin.tag_sha, pin.office_sha];
  const meta = Object.fromEntries((await client.query(
    "SELECT key, value FROM world_graph_meta WHERE tag_sha = $1 AND office_sha = $2 AND key IN ('as_of_world', 'hydrated_at')", at)).rows.map((r) => [r.key, r.value]));
  const findings = (await client.query(
    "SELECT lint, verdict, headline FROM world_graph_lints WHERE tag_sha = $1 AND office_sha = $2 ORDER BY ord", at)).rows;
  return { as_of_world: meta.as_of_world ?? null, hydrated_at: meta.hydrated_at ?? null, findings };
}

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };
const flag = (name) => process.argv.includes(name);

async function main() {
  const dbPath = argOf("--db");
  if (!dbPath) {
    console.error("usage: graph-ingest.mjs --db <world.db> [--keep 4] [--dry-run] [--json]");
    process.exit(2);
  }
  const snap = graphSnapshotFromTables(readWorldDbTables(dbPath));
  const census = Object.fromEntries(Object.entries(SOURCE).map(([t, k]) => [t, snap.tables[k].length]));
  if (flag("--dry-run")) {
    const out = { dry_run: true, tag_sha: snap.tagSha, office_sha: snap.officeSha, settlement: snap.settlement, counts: census };
    console.log(flag("--json") ? JSON.stringify(out, null, 2) : `dry-run · S${snap.settlement ?? "?"} ${snap.tagSha.slice(0, 12)} · office ${snap.officeSha.slice(0, 12)}\n  ${JSON.stringify(census)}`);
    return;
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client();               // PGHOST/PGDATABASE/PGUSER/PGPASSWORD
  await client.connect();
  let out;
  try { out = await writeGraphSnapshot(client, snap, { keep: Number(argOf("--keep") ?? 4) }); }
  finally { await client.end(); }
  console.log(flag("--json") ? JSON.stringify(out, null, 2)
    : `ingested the world graph · S${out.settlement ?? "?"} ${out.tag_sha.slice(0, 12)} · office ${out.office_sha.slice(0, 12)}\n  ${JSON.stringify(out.counts)} · dropped ${out.dropped}`);
}

// The entry guard, as law-ingest.mjs's (the junction lesson).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
}
