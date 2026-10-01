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
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { worldClone, NO_WORLD, OFFICE_ROOT } from "./fixture-paths.mjs";
import { loadPglite, storeFloor } from "./helpers/pglite-store.mjs";
import { CLASS_ROSTER_GATE_SQL } from "../src/world-store.mjs";
import { publishWorld, tablesOfFixture, writeFixtureDb } from "./helpers/world-rows.mjs";
import { graphDb, twinnedStatements } from "../src/world-graph-db.mjs";
// The modules that register twins, loaded so their statements are in the census.
import "../src/world-apex.mjs";
import "../src/portal-ground.mjs";
import "../src/world-frames.mjs";
import "../src/world-classes.mjs";
import "../src/dynamic-store.mjs";
import "../src/dynamic-entities.mjs";

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
  // The hydration's ROWS (--rows-out), and the SQL's file built from them here:
  // the office never opens a world.db (POS-270 lane W 3a); only this test's own
  // handle asks the statements of one, to hold each twin to its SQL.
  const rows = join(dir, "rows.json");
  execFileSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"), "--world", CLONE, "--ref", newestBlessing(CLONE).sha, "--no-db", "--rows-out", rows, "--no-gexf"],
    { stdio: "ignore", env: { ...process.env, TMP: dir, TEMP: dir, TMPDIR: dir } });   // its own tmp root: the shared world cache is pruned by other hydrations
  tables = JSON.parse(readFileSync(rows, "utf8"));
  writeFixtureDb(tables, file);
});
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

// What each statement takes, read off its own text.
const argKind = (sql) => {
  const marks = (sql.match(/\?/g) ?? []).length;
  if (marks === 0) return "none";
  if (/json_extract\(props, '\$\.class'\) IN \(SELECT value FROM json_each\(\?\)\)/.test(sql)) return "names";
  if (/id IN \(SELECT value FROM json_each\(\?\)\)/.test(sql)) return "ids";
  if (marks === 2) return "classSlot";
  if (/props, '\$\.class'\) = \?/.test(sql)) return "name";
  return "id";
};

test("EVERY TWIN IS ITS SQL: row for row, column for column, in order, over the whole blessed world", (t) => {
  if (why) return t.skip(why);
  const sqlite = new DatabaseSync(file, { readOnly: true });
  const store = graphDb(tables);
  try {
    const ids = tables.nodes.map((n) => n.id);
    const classes = [...new Set(tables.nodes.map((n) => { try { return JSON.parse(n.props)?.class; } catch { return null; } }).filter((c) => typeof c === "string"))];
    // Deterministic samples: every 7th id, every 3rd, the first 40, a mixed set with ids nothing has.
    const every = (k, off = 0) => ids.filter((_, i) => i % k === off);
    const slots = [...new Set(tables.nodes.map((n) => { try { return JSON.parse(n.props)?.slot; } catch { return null; } }).filter((x) => typeof x === "string"))];
    const ARGS = {
      name: [...classes, "no-such-class"].map((c) => [c]),
      classSlot: [...classes.flatMap((c) => slots.slice(0, 12).map((sl) => [c, sl])), ["no-such-class", "no-such-slot"]],
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
    t.diagnostic(`${asked.size} statements, each asked over ${ids.length} ids / ${classes.length} class names / ${slots.length} slots`);
  } finally { sqlite.close(); }
});

// The blessed world may not hold every shape a twin must get right, so a copy of
// it is seeded with the edges the record can reach but S<n> happens not to: a
// town class mark with no works placement (its roster gate is NULL, not 0), and
// a closed bounty filed before an open one (the board sorts open first).
test("THE SEEDED WORLD: a NULL roster gate and a closed bounty, each twin still its SQL", (t) => {
  if (why) return t.skip(why);
  const seeded = join(dir, "seeded.db");
  copyFileSync(file, seeded);
  const w = new DatabaseSync(seeded);
  const SEEDS = [
    ["the-town/seed-unplaced-class", "mark", "declared", "constitution", "the-town", { class: "seed-unplaced", body: "no works placement" }],
    ["the-town/the-bounty-board/a-closed-seed", "mark", "declared", "resident", "seed-household", { class: "bounty", status: "closed", ask: "a", reward: 1, body: "closed" }],
    ["the-town/the-bounty-board/z-open-seed", "mark", "declared", "resident", "seed-household", { class: "bounty", ask: "z", reward: 2, body: "open" }],
  ];
  try {
    for (const [id, kind, subkind, tier, by, props] of SEEDS)
      w.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, props) VALUES (?, ?, ?, ?, ?, ?)").run(id, kind, subkind, tier, by, JSON.stringify(props));
    for (const [id] of SEEDS.slice(1))
      w.prepare("INSERT INTO edges (src, dst, type) VALUES ('the-town/the-bounty-board', ?, 'contains')").run(id);
  } finally { w.close(); }
  const sqlite = new DatabaseSync(seeded, { readOnly: true });
  const store = graphDb(tablesOfFixture(seeded));
  try {
    const plain = (rows) => JSON.stringify(rows.map((r) => ({ ...r })));
    const gate = plain(sqlite.prepare(`SELECT (${CLASS_ROSTER_GATE_SQL}) AS g FROM nodes WHERE id = ?`).all(SEEDS[0][0]));
    assert.equal(gate, '[{"g":null}]', "the seed no longer reaches the NULL gate, so this leg proves nothing");
    const board = sqlite.prepare("SELECT count(*) AS n FROM edges WHERE src = 'the-town/the-bounty-board' AND type = 'contains'").get().n;
    assert.ok(board >= 2, "the seeded bounties are not on the board");
    const ask = [[]].concat(SEEDS.map(([id]) => [id]));
    for (const sql of twinnedStatements()) {
      const kind = argKind(sql);
      if (kind !== "none" && kind !== "id") continue;
      for (const args of kind === "none" ? [[]] : ask.slice(1))
        assert.equal(plain(store.prepare(sql).all(...args)), plain(sqlite.prepare(sql).all(...args)), `over the seeded world, a twin answered differently: ${sql.slice(0, 90)} ${JSON.stringify(args)}`);
    }
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
    // 2(b): the frame law's class read, from the store, equal to the file's rows
    // (published as a snapshot of their own: the reader has no file to open).
    const { classFieldsFromStore, resetClassFieldsCache } = await import("../src/world-frames.mjs");
    resetClassFieldsCache();
    const fromStore = classFieldsFromStore();
    publishWorld(file, "the file's rows");
    resetClassFieldsCache();
    const fromFile = classFieldsFromStore();
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

test("2(c) THE READERS, from the store: world-classes' readers, the sound class and the walk ledger answer what the file's rows answer", async (t) => {
  if (why) return t.skip(why);
  if (pglite.reason) return t.skip(pglite.reason);
  const { graphSnapshotFromTables, writeGraphSnapshot } = await import("../world2/tools/graph-ingest.mjs");
  const { reloadWorldGraph, resetWorldGraph } = await import("../src/world-graph-snapshot.mjs");
  const wc = await import("../src/world-classes.mjs");
  const { soundClass, resetClassCache } = await import("../src/dynamic-store.mjs");
  const { readDepartureEvents } = await import("../src/dynamic-entities.mjs");
  const { resetLawSnapshot } = await import("../src/law-snapshot.mjs");
  const db = await storeFloor(pglite);
  const was = process.env.WORLD_STORE_DB;
  try {
    resetLawSnapshot();   // the class layer's law snapshot must not answer first here: this is the world graph half
    process.env.WORLD_STORE_DB = join(dir, "no-such-world.db");
    // Every reader asked twice, by the same code: over the FILE's rows (read by
    // SQL, published as a snapshot) and over the STORE's (written to Postgres by
    // graph-ingest and loaded back). Equal answers mean the store's copy is the
    // file's, row for row, as every reader sees it.
    const places = tables.nodes.filter((n) => n.at_x != null && n.extent_w > 6).slice(0, 8).map((n) => n.id);
    const ids = tables.nodes.slice(0, 200).map((n) => n.id).concat(["no/such"]);
    const classes = ["say", "resident", "sound", "bounty", "no-such-class"];
    const answers = () => {
      wc.resetClassRosterCache();
      resetClassCache();
      const roster = wc.classRoster();
      return {
        roster, rosterNames: [...roster.roster].sort(),
        ideasTank: wc.ideasTank(), civicQuarter: wc.civicQuarter(), bountyBoard: wc.bountyBoard(),
        markClass: ids.map((id) => wc.markClass(id)),
        freeCellIn: places.map((p) => wc.freeCellIn(p, "seed")),
        classDials: classes.map((c) => wc.classDials(c)),
        classPredicates: classes.map((c) => wc.classPredicates(c)),
        soundClass: soundClass(),
        departures: readDepartureEvents(),
      };
    };
    publishWorld(tablesOfFixture(file), "the file's rows");
    const F = answers();
    await writeGraphSnapshot(db, graphSnapshotFromTables(tables));
    resetWorldGraph();
    await reloadWorldGraph({ query: (sql, p) => db.query(sql, p) });
    const S = answers();
    assert.equal(S.roster.source, "store");
    const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => (k === "path" || k === "detail" || k === "source_label" ? undefined : v)));
    for (const k of Object.keys(S).filter((k) => k !== "roster" && k !== "soundClass" && k !== "departures"))
      assert.deepStrictEqual(strip(S[k]), strip(F[k]), `${k}: the store's answer differs from the file's rows'`);
    assert.deepStrictEqual(strip({ ...S.soundClass, store: undefined }), strip({ ...F.soundClass, store: undefined }), "soundClass: the store's answer differs from the file's rows'");
    assert.equal(S.departures.refused, undefined, JSON.stringify(S.departures.refused ?? null));
    assert.deepStrictEqual(S.departures.events, F.departures.events, "readDepartureEvents: the store's events differ from the file's rows'");
    assert.equal(S.departures.as_of_world, F.departures.as_of_world);
    assert.ok(S.roster.roster.size > 0 && S.departures.events.length > 0, "the proof read an empty world");
  } finally {
    if (was === undefined) delete process.env.WORLD_STORE_DB; else process.env.WORLD_STORE_DB = was;
    resetWorldGraph();
    await db.close();
  }
});
