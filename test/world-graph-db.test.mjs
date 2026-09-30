// world-graph-db.test.mjs — every question the office asks world.db, answered
// from the store's graph snapshot, held equal to the SQL (POS-270, lane W 2).
//
// ONE WORLD, TWO ANSWERERS. The checkout's newest settlement tag is hydrated
// into a world.db the way the tick does it. Every statement with a registered
// twin is then asked of BOTH — the real SQL against the file, and the twin
// against the same rows read as a snapshot — with a battery of arguments (every
// node id, id sets from empty to all, every class name, and names nothing has),
// and the answers must be identical: every row, every column, in order.
//
// The census: a twin nothing asked is a twin nobody proved, so every registered
// statement must be exercised here, and the test fails naming any that was not.
//
// Then the door itself: with the snapshot loaded (PGlite), `openStore()` answers
// from the store, never the file, and the actions it gathers are the file's.
//
//   WORLD_CLONE=<checkout> PGLITE_MODULE_DIR=<dir> node --test test/world-graph-db.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { worldClone, NO_WORLD, OFFICE_ROOT } from "./fixture-paths.mjs";
import { loadPglite, storeFloor } from "./helpers/pglite-store.mjs";
import { readWorldDbTables } from "../src/world-store.mjs";
import { graphDb, twinnedStatements } from "../src/world-graph-db.mjs";
// The modules that register twins, loaded so their statements are in the census.
import "../src/world-apex.mjs";
import "../src/portal-ground.mjs";
import "../src/world-frames.mjs";

const pglite = await loadPglite();
const CLONE = NO_WORLD ? null : worldClone();

function newestBlessing(repo) {
  const lines = execFileSync("git", ["-C", repo, "for-each-ref", "--format=%(refname:short) %(*objectname) %(objectname)", "refs/tags/settlement/"], { encoding: "utf8" })
    .split("\n").filter(Boolean).map((l) => { const [tag, peeled, obj] = l.split(" "); return { tag, n: Number(/S(\d+)$/.exec(tag)?.[1]), sha: peeled || obj }; })
    .filter((x) => Number.isFinite(x.n)).sort((a, b) => b.n - a.n);
  return lines[0] ?? null;
}
const why = NO_WORLD || (newestBlessing(CLONE) ? null : `the world checkout at ${CLONE} carries no settlement/S<n> tag`);

let dir, file, tables;
before(() => {
  if (why) return;
  dir = mkdtempSync(join(tmpdir(), "graph-db-"));
  file = join(dir, "world.db");
  execFileSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"), "--world", CLONE, "--ref", newestBlessing(CLONE).sha, "--db", file, "--no-gexf"],
    { stdio: "ignore", env: { ...process.env, WORLD_STORE_DB: file } });
  tables = readWorldDbTables(file);
});
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

// What each statement takes, read off its own text.
const argKind = (sql) => /json_extract\(props, '\$\.class'\) IN \(SELECT value FROM json_each\(\?\)\)/.test(sql) ? "names"
  : /id IN \(SELECT value FROM json_each\(\?\)\)/.test(sql) ? "ids"
    : /id = \?/.test(sql) ? "id" : "none";

test("EVERY TWIN IS ITS SQL: row for row, column for column, in order, over the whole blessed world", (t) => {
  if (why) return t.skip(why);
  const sqlite = new DatabaseSync(file, { readOnly: true });
  const store = graphDb(tables);
  try {
    const ids = tables.nodes.map((n) => n.id);
    const classes = [...new Set(tables.nodes.map((n) => { try { return JSON.parse(n.props)?.class; } catch { return null; } }).filter((c) => typeof c === "string"))];
    // Deterministic samples: every 7th id, every 3rd, the first 40, a mixed set with ids nothing has.
    const every = (k, off = 0) => ids.filter((_, i) => i % k === off);
    const ARGS = {
      none: [[]],
      id: [...ids, "no/such-mark", ""].map((id) => [id]),
      ids: [[], ids, every(7), every(3, 1), ids.slice(0, 40), [...every(11), "no/such-mark", "the-town/also-missing"]].map((s) => [JSON.stringify(s)]),
      names: [[], classes, classes.slice(0, 3), [...classes.slice(-2), "no-such-class"]].map((s) => [JSON.stringify(s)]),
    };
    const plain = (rows) => JSON.stringify(rows.map((r) => ({ ...r })));
    const asked = new Set();
    const diffs = [];
    for (const sql of twinnedStatements()) {
      const kind = argKind(sql);
      for (const args of ARGS[kind]) {
        const want = plain(sqlite.prepare(sql).all(...args));
        const got = plain(store.prepare(sql).all(...args));
        asked.add(sql);
        if (want !== got) { diffs.push({ sql: sql.slice(0, 90), args: JSON.stringify(args).slice(0, 80), want: want.slice(0, 200), got: got.slice(0, 200) }); break; }
      }
    }
    assert.deepEqual(diffs, [], "a twin answered differently from its SQL");
    const unasked = twinnedStatements().filter((s) => !asked.has(s));
    assert.deepEqual(unasked, [], "a registered twin was never asked, so it was never proved");
    t.diagnostic(`${asked.size} statements, each asked over ${ids.length} ids / ${classes.length} class names`);
  } finally { sqlite.close(); }
});

test("AN UNKNOWN QUESTION IS REFUSED BY NAME, never answered by a guess", (t) => {
  if (why) return t.skip(why);
  const store = graphDb(tables);
  assert.throws(() => store.prepare("SELECT * FROM nodes WHERE kind = 'code'"), /no twin for this statement, and will not guess/);
});

test("THE DOOR: with the snapshot loaded and world.db absent, openStore() answers from the store, and the gathered actions are the file's", async (t) => {
  if (why) return t.skip(why);
  if (pglite.reason) return t.skip(pglite.reason);
  const { graphSnapshotFromTables, writeGraphSnapshot } = await import("../world2/tools/graph-ingest.mjs");
  const { reloadWorldGraph, resetWorldGraph } = await import("../src/world-graph-snapshot.mjs");
  const { openStore, gatherActions, gatherGroundActions } = await import("../src/world-apex.mjs");
  const db = await storeFloor(pglite);
  const was = process.env.WORLD_STORE_DB;
  try {
    await writeGraphSnapshot(db, graphSnapshotFromTables(tables));
    resetWorldGraph();
    await reloadWorldGraph({ query: (sql, p) => db.query(sql, p) });
    process.env.WORLD_STORE_DB = join(dir, "no-such-world.db");
    const store = openStore();
    assert.equal(store.db?.source, "store", `openStore did not answer from the store: ${store.unavailable ?? ""}`);
    assert.equal(store.meta.as_of_world, tables.meta.find((m) => m.key === "as_of_world").value);
    const fileDb = new DatabaseSync(file, { readOnly: true });
    try {
      const spines = [[], tables.nodes.slice(0, 60).map((n) => n.id), tables.nodes.filter((n) => n.kind === "mark").slice(200, 260).map((n) => n.id)];
      for (const spineIds of spines) {
        assert.deepStrictEqual(JSON.stringify(gatherActions(store.db, { spineIds })), JSON.stringify(gatherActions(fileDb, { spineIds })), "the ambient channel differs");
        assert.deepStrictEqual(JSON.stringify(gatherGroundActions(store.db, { spineIds })), JSON.stringify(gatherGroundActions(fileDb, { spineIds })), "the ground channel differs");
      }
    } finally { fileDb.close(); }
    // 2(b): the frame law's class read, from the store, equal to the file's.
    const { classFieldsFromStore, resetClassFieldsCache } = await import("../src/world-frames.mjs");
    resetClassFieldsCache();
    const fromStore = classFieldsFromStore();
    resetClassFieldsCache();
    const fromFile = classFieldsFromStore({ worldDb: file });
    assert.equal(fromStore.gate.status, "PRESENT");
    assert.match(fromStore.gate.detail, /the store's graph snapshot/, "the class read did not come from the store");
    assert.deepStrictEqual([...fromStore.fields], [...fromFile.fields], "the class fields from the store differ from the file's");
    assert.ok(fromStore.fields.size > 0);
  } finally {
    if (was === undefined) delete process.env.WORLD_STORE_DB; else process.env.WORLD_STORE_DB = was;
    resetWorldGraph();
    await db.close();
  }
});

test("THE WALK'S GROUND LOOKUP asks the snapshot's handle first (2b), world.db only as the floor", () => {
  const code = readFileSync(join(OFFICE_ROOT, "src", "world.mjs"), "utf8");
  assert.match(code, /db = snap\?\.tables \? graphDb\(snap\.tables\) : new DatabaseSync\(path, \{ readOnly: true \}\);/,
    "the walk desk opens world.db for its portal-ground lookup even when the snapshot has loaded");
});
