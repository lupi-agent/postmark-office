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
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
test("THE OUTPUTS: --no-db writes no world.db, and the rows it emits carry the counts it reports", (t) => {
  if (NO_WORLD) return t.skip(NO_WORLD);
  const dir = mkdtempSync(join(tmpdir(), "hydrator-rows-"));
  // A FIXED, EMPTY OFFICE, so the two hydrations read the same office. The
  // graph's code half is parsed from the office tree, and under a full suite
  // other tests write files into this tree between two runs (the cli-guard
  // lesson), which moved the code counts and reddened this leg (2026-09-30).
  const office = join(dir, "office");
  mkdirSync(office);
  // A PRIVATE WORLD CACHE. The materialised tree lives under tmpdir() and is
  // pruned to five shas by whichever hydration runs next; under a full suite
  // another test pruned this one mid-read (tools/ and the walk ledger vanished
  // from the first run, 2026-09-30). Its own tmp root, its own cache.
  const privateTmp = { TMP: dir, TEMP: dir, TMPDIR: dir };
  try {
    const run = (args) => JSON.parse(execFileSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"), "--world", CLONE, "--office", office, "--no-gexf", "--no-lints", "--json", ...args],
      { encoding: "utf8", env: { ...process.env, ...privateTmp }, stdio: ["ignore", "pipe", "ignore"] }));
    const rowsPath = join(dir, "rows.json");
    const out = run(["--no-db", "--rows-out", rowsPath]);
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".db")), [], "the hydration wrote a world.db");
    assert.equal(Object.hasOwn(out, "db"), false, "the run reported a world.db it was not asked for");
    // The rows are what the store's snapshot and a test's fixture are made of:
    // their own meta carries the counts the run reported, stamped OK.
    const rows = JSON.parse(readFileSync(rowsPath, "utf8"));
    const meta = Object.fromEntries(rows.meta.map((r) => [r.key, r.value]));
    assert.deepStrictEqual(JSON.parse(meta.counts), out.counts, "the counts in the rows are not the counts reported");
    assert.equal(meta.hydration_status, "OK");
    assert.equal(rows.nodes.length, out.counts.nodes_total, "the rows hold the nodes the run counted");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--db IS REFUSED BY NAME: world.db is retired, and a caller still asking for one is told where the world went", () => {
  const dir = mkdtempSync(join(tmpdir(), "hydrator-db-refused-"));
  try {
    const r = spawnSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"), "--db", join(dir, "world.db")], { encoding: "utf8" });
    assert.equal(r.status, 2, `exit ${r.status}: ${r.stderr}`);
    assert.match(r.stderr, /world.db is retired .* --to-store .* --rows-out/);
    assert.equal(existsSync(join(dir, "world.db")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("A STORE MISS EXITS 1 and says so: with world.db retired there is no file to fall back on (the rows, if asked for, are still written)", (t) => {
  if (NO_WORLD) return t.skip(NO_WORLD);
  const dir = mkdtempSync(join(tmpdir(), "hydrator-store-miss-"));
  try {
    // A store that refuses the connection at once (port 1): the write fails
    // after the rows are built, which is the case the tick must survive.
    const env = { ...process.env, TMP: dir, TEMP: dir, TMPDIR: dir, PGHOST: "127.0.0.1", PGPORT: "1", PGUSER: "law_ingester", PGDATABASE: "nowhere", PGPASSWORD: "x", PGCONNECT_TIMEOUT: "3" };
    // The real office tree, so the snapshot carries an office sha and the miss
    // is the connection itself.
    const hydrate = (args) => spawnSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"), "--world", CLONE, "--office", OFFICE_ROOT, "--no-gexf", "--no-lints", "--to-store", ...args], { encoding: "utf8", env });
    const rows = join(dir, "rows.json");
    const r = hydrate(["--rows-out", rows]);
    assert.equal(r.status, 1, `exit ${r.status}: ${r.stderr.slice(-300)}`);
    assert.match(r.stderr, /the graph snapshot was NOT written to the store/);
    assert.equal(existsSync(rows), true, "the rows were asked for, and are written before the store is tried");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("AN OFFICE PLACED BY THE RELEASE TRAIN (no .git, a release.json) keys its rows by the receipt's sha", (t) => {
  if (NO_WORLD) return t.skip(NO_WORLD);
  const dir = mkdtempSync(join(tmpdir(), "hydrator-release-office-"));
  const office = join(dir, "office");
  mkdirSync(office);
  // The receipt the train ships beside the code (src/release.mjs).
  const SHA = "ab".repeat(20);
  writeFileSync(join(office, "release.json"), JSON.stringify({ tag: "release/2026-w41", sha: SHA, deployed_at: "2026-10-04T00:00:00Z" }));
  try {
    const rows = join(dir, "rows.json");
    execFileSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"), "--world", CLONE, "--office", office, "--no-gexf", "--no-lints", "--rows-out", rows],
      { stdio: "ignore", env: { ...process.env, TMP: dir, TEMP: dir, TMPDIR: dir } });
    const meta = Object.fromEntries(JSON.parse(readFileSync(rows, "utf8")).meta.map((r) => [r.key, r.value]));
    assert.equal(meta.as_of_office, SHA, "an office the train placed must key the snapshot by the commit it is running");
    const gates = JSON.parse(meta.gates);
    assert.equal(gates.find((g) => g.gate === "office-release")?.status, "PRESENT");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
