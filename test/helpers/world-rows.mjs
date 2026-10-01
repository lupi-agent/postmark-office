// world-rows.mjs — a test's world, as rows (POS-270 lane W 3a).
//
// world.db is leaving the office (3b deletes its opener), so no test may stand
// on the file. A test still BUILDS its world however it likes — a hydration
// (`world-hydrate.mjs --rows-out`), or a crafted sqlite fixture in world.db's
// schema — and then hands the office the ROWS:
//
//   in process   publishWorld(source)        → the world graph snapshot
//   a subprocess rowsEnv(source, dir)        → { WORLD_GRAPH_ROWS, WORLD_STORE_DB: <nowhere> }
//
// and points WORLD_STORE_DB at a path that does not exist (NO_WORLD_DB), so a
// reader that still reached for the file would find nothing and the test would
// say so. `source` is a tables object, a rows JSON file, or a sqlite fixture.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { publishWorldGraphForTest, resetWorldGraph, worldGraphSnapshot } from "../../src/world-graph-snapshot.mjs";
import { graphFromTables, SCHEMA } from "../../src/world-store.mjs";

/** Where no world.db is, ever: the file floor answers nothing from here. */
export const NO_WORLD_DB = join(tmpdir(), "pm-test-no-world-db-here.db");

/** A sqlite fixture's tables, in the order world.db's own reader gave them. */
export function tablesOfFixture(dbPath) {
  if (!existsSync(dbPath)) throw new Error(`no world fixture at ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const all = (sql) => db.prepare(sql).all().map((r) => ({ ...r }));
    const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t));
    return {
      meta: has("meta") ? all("SELECT key, value FROM meta") : [],
      nodes: has("nodes") ? all("SELECT * FROM nodes") : [],
      edges: has("edges") ? all("SELECT * FROM edges ORDER BY seq") : [],
      events: has("events") ? all("SELECT seq, at, actor, type, payload FROM events ORDER BY at") : [],
      geometryVersions: has("geometry_versions") ? all("SELECT * FROM geometry_versions ORDER BY mark_id, valid_from_iso") : [],
      edgeTypes: has("edge_type_registry") ? all("SELECT type, note FROM edge_type_registry") : undefined,
      lintFindings: has("lint_findings") ? all("SELECT * FROM lint_findings") : [],
    };
  } finally { db.close(); }
}

/** Tables from any source: a tables object, a rows JSON file, or a sqlite fixture. */
export function tablesOf(source) {
  if (source && typeof source === "object") return source;
  if (String(source).endsWith(".json")) return JSON.parse(readFileSync(source, "utf8"));
  return tablesOfFixture(source);
}

/** Publish a world in this process, as the store's snapshot would be. */
export function publishWorld(source, label = "test world") {
  publishWorldGraphForTest(tablesOf(source), { label });
}

/** The env an office subprocess needs to stand on these rows (and never a file). */
export function rowsEnv(source, dir) {
  const path = join(dir, `world-rows-${process.pid}-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify(tablesOf(source)));
  return { WORLD_GRAPH_ROWS: path, WORLD_STORE_DB: NO_WORLD_DB };
}

/** The graph and its companions from rows, through the one construction every reader uses. */
export function graphOf(source, { label = "test world", allowFailed = false } = {}) {
  return graphFromTables(tablesOf(source), { source: label, allowFailed });
}

/** Run fn with this world published, then put back whatever stood before. */
export async function withWorld(source, fn, label = "test world") {
  const prev = worldGraphSnapshot();
  publishWorld(source, label);
  try { return await fn(); }
  finally { if (prev) publishWorldGraphForTest(prev.tables, { label: "restored" }); else resetWorldGraph(); }
}

/** Run fn with NO world graph at all (the floor), then put back what stood. */
export async function withNoWorld(fn) {
  const prev = worldGraphSnapshot();
  resetWorldGraph();
  try { return await fn(); }
  finally { if (prev) publishWorldGraphForTest(prev.tables, { label: "restored" }); }
}

/** No world graph at all, from here on (the "no store" cases). */
export const clearWorld = () => resetWorldGraph();

/**
 * world.db's tables written as a sqlite file, for a test that holds the SQL
 * itself to account (world-graph-db.test: every twin equal to its statement).
 * The office never opens it; only the test's own handle does.
 */
export function writeFixtureDb(source, path) {
  const t = tablesOf(source);
  const db = new DatabaseSync(path);
  try {
    db.exec(SCHEMA);
    db.exec("BEGIN");
    const meta = db.prepare("INSERT INTO meta VALUES (?, ?)");
    for (const r of t.meta) meta.run(r.key, r.value);
    const node = db.prepare("INSERT INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?)");
    for (const r of t.nodes) node.run(r.id, r.kind, r.subkind, r.tier, r.by, r.at_x, r.at_y, r.extent_w, r.extent_h, r.props);
    const edge = db.prepare("INSERT INTO edges (seq, src, dst, type, props, born_at) VALUES (?,?,?,?,?,?)");
    for (const r of t.edges) edge.run(r.seq, r.src, r.dst, r.type, r.props, r.born_at);
    const ev = db.prepare("INSERT INTO events (seq, at, actor, type, payload) VALUES (?,?,?,?,?)");
    for (const r of [...t.events].sort((a, b) => a.seq - b.seq)) ev.run(r.seq, r.at, r.actor, r.type, r.payload);
    const type = db.prepare("INSERT INTO edge_type_registry VALUES (?, ?)");
    for (const r of t.edgeTypes ?? []) type.run(r.type, r.note);
    const geom = db.prepare("INSERT INTO geometry_versions (seq, mark_id, at_x, at_y, extent_w, extent_h, valid_from_iso, valid_to_iso, sha, path, subject, authored_iso, change) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const r of [...t.geometryVersions].sort((a, b) => a.seq - b.seq))
      geom.run(r.seq, r.mark_id, r.at_x, r.at_y, r.extent_w, r.extent_h, r.valid_from_iso, r.valid_to_iso, r.sha, r.path, r.subject, r.authored_iso, r.change);
    const lint = db.prepare("INSERT INTO lint_findings (lint, verdict, headline, evidence, hydrated_at, as_of_world) VALUES (?,?,?,?,?,?)");
    for (const r of t.lintFindings) lint.run(r.lint, r.verdict, r.headline, r.evidence, r.hydrated_at, r.as_of_world);
    db.exec("COMMIT");
  } finally { db.close(); }
  return path;
}
