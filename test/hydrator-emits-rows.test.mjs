// hydrator-emits-rows.test.mjs — the hydrator builds its rows in memory and
// writes each output from them (POS-270, lane W item 1).
//
//   the order     the rows keep sqlite's own order: INSERT OR REPLACE moves a
//                 replaced row to the END (a rowid table), an append numbers
//                 1, 2, 3 — so the store and the file hold one order
//   the counts    the counts stamped in meta equal the SQL they replaced, on a
//                 table with ties, nulls and in-works marks: every count and
//                 every group equal. Among TIED counts the order of a group map's
//                 keys is sqlite's own (measured: not key order) and the rows put
//                 them in key order; the file and the store are both written from
//                 the rows, so they never disagree with each other.
//   the outputs   --no-db writes no world.db, and its counts equal the file's
//
// The whole-world proof, sqlite-built vs rows-built at S87, every table row for
// row: docs/2026-09-30/rail/hydrator-emits-rows/parity-S87.txt.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SCHEMA } from "../src/world-store.mjs";
import { createGraphRows, graphTablesOf, graphCounts } from "../src/world-graph-rows.mjs";
import { worldClone, NO_WORLD, OFFICE_ROOT } from "./fixture-paths.mjs";

// One set of nodes and edges, written both ways: through the collector, and
// through the SQL statements the hydrator used to run.
const NODES = [
  ["the-town/a", "mark", "sited", "constitution", "the-town", 1, 2, 3, 4, JSON.stringify({ in_works: 1 })],
  ["code:src/x.mjs", "code", "module", null, null, null, null, null, null, "{}"],
  ["the-town/b", "mark", "sited", null, "b", 5, 6, 1, 1, JSON.stringify({ in_works: true })],
  ["the-town/c", "mark", "parcel", "market", "c", 7, 8, 1, 1, "{}"],
  ["the-town/cls", "class", "class", "constitution", "the-town", null, null, null, null, "{}"],
  ["the-town/a", "mark", "sited", "neighborhood", "the-town", 9, 9, 3, 4, "{}"],   // a REPLACE: moves to the end
  ["the-town/d", "mark", null, null, "d", 1, 1, 1, 1, "{}"],
];
const EDGES = [["a", "b", "contains"], ["b", "c", "describes"], ["c", "a", "contains"], ["x", "y", "imports"], ["y", "z", "describes"]];

function viaSql() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const n = db.prepare("INSERT OR REPLACE INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (const r of NODES) n.run(...r);
  const e = db.prepare("INSERT INTO edges (src, dst, type, props, born_at) VALUES (?,?,?,?,?)");
  for (const [s, d, t] of EDGES) e.run(s, d, t, "{}", null);
  return db;
}
function viaRows() {
  const T = createGraphRows();
  for (const [id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props] of NODES)
    T.nodes.put({ id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props });
  for (const [src, dst, type] of EDGES) T.edges.push({ src, dst, type, props: "{}", born_at: null });
  return T;
}

test("THE ORDER: a REPLACE moves the row to the end, as sqlite's rowid table does; appends number 1, 2, 3", () => {
  const db = viaSql();
  try {
    const sqlNodes = db.prepare("SELECT * FROM nodes").all().map((r) => ({ ...r }));
    const sqlEdges = db.prepare("SELECT * FROM edges ORDER BY seq").all().map((r) => ({ ...r }));
    const t = graphTablesOf(viaRows());
    assert.deepStrictEqual(t.nodes, sqlNodes, "the rows' node order is not the file's");
    assert.equal(t.nodes.at(-2).id, "the-town/a", "the replaced row did not move to the end");
    assert.deepStrictEqual(t.edges, sqlEdges);
  } finally { db.close(); }
});

test("THE COUNTS: equal to the SQL they replaced — every count, every group, the nulls and the in-works marks", () => {
  const db = viaSql();
  try {
    const rows = (sql) => db.prepare(sql).all();
    const sql = {
      nodes_total: rows("SELECT COUNT(*) c FROM nodes")[0].c,
      nodes_by_kind: Object.fromEntries(rows("SELECT kind, COUNT(*) c FROM nodes GROUP BY kind ORDER BY c DESC").map((r) => [r.kind, r.c])),
      marks_by_subkind: Object.fromEntries(rows("SELECT subkind, COUNT(*) c FROM nodes WHERE kind='mark' GROUP BY subkind ORDER BY c DESC").map((r) => [r.subkind, r.c])),
      marks_by_tier: Object.fromEntries(rows("SELECT COALESCE(tier,'(none)') t, COUNT(*) c FROM nodes WHERE kind='mark' GROUP BY t ORDER BY c DESC").map((r) => [r.t, r.c])),
      edges_total: rows("SELECT COUNT(*) c FROM edges")[0].c,
      edges_by_type: Object.fromEntries(rows("SELECT type, COUNT(*) c FROM edges GROUP BY type ORDER BY c DESC").map((r) => [r.type, r.c])),
      events_total: rows("SELECT COUNT(*) c FROM events")[0].c,
      edge_types_registered: rows("SELECT COUNT(*) c FROM edge_type_registry")[0].c,
      marks_in_the_keeping_works: rows("SELECT COUNT(*) c FROM nodes WHERE kind='mark' AND json_extract(props,'$.in_works') = 1")[0].c,
    };
    const got = graphCounts(viaRows());
    assert.deepStrictEqual(got, sql);
    // and among UNTIED counts the order is the SQL's too (the ORDER BY c DESC)
    for (const k of ["nodes_by_kind", "marks_by_subkind", "edges_by_type"]) {
      const counts = (o) => Object.values(o);
      assert.deepStrictEqual(counts(got[k]), counts(sql[k]), `${k}: the groups are not in count order`);
    }
  } finally { db.close(); }
});

const CLONE = NO_WORLD ? null : worldClone();
test("THE OUTPUTS: --no-db writes no world.db, and its counts are the file's", (t) => {
  if (NO_WORLD) return t.skip(NO_WORLD);
  const dir = mkdtempSync(join(tmpdir(), "hydrator-rows-"));
  try {
    const run = (args) => JSON.parse(execFileSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"), "--world", CLONE, "--no-gexf", "--no-lints", "--json", ...args],
      { encoding: "utf8", env: { ...process.env, WORLD_STORE_DB: join(dir, "unused.db") }, stdio: ["ignore", "pipe", "ignore"] }));
    const withFile = run(["--db", join(dir, "world.db")]);
    const without = run(["--no-db", "--db", join(dir, "absent.db")]);
    assert.equal(existsSync(join(dir, "world.db")), true);
    assert.equal(existsSync(join(dir, "absent.db")), false, "--no-db wrote a world.db");
    assert.equal(without.db, null);
    assert.deepStrictEqual(without.counts, withFile.counts, "the rows-only hydration counted a different world");
    const db = new DatabaseSync(join(dir, "world.db"), { readOnly: true });
    try {
      const meta = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'counts'").get().value);
      assert.deepStrictEqual(meta, withFile.counts, "the counts in the file are not the counts reported");
      assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'hydration_status'").get().value, "OK");
    } finally { db.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
