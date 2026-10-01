// world-graph-parity.test.mjs — the world graph from the store equals the
// world graph from world.db, node for node and edge for edge (POS-270,
// option A, Wright-ruled 2026-09-30: "Parity is the gate").
//
// ONE SET OF ROWS, TWO SOURCES. A world's rows in a sqlite file (this test's
// own read, `tablesOfFixture`) are copied into a REAL Postgres (PGlite, every
// migration 001..038 laid down) by the graph pen's own writer
// (`writeGraphSnapshot`), and loaded back by the office's snapshot reader
// (`reloadWorldGraph`). Then everything the one construction (`graphFromTables`)
// hands a reader from each is compared:
//
//   the nodes, in order, with every attribute;  the edges, in order, with key,
//   ends and attributes;  the placeholders a dangling edge makes;  meta;
//   the walk ledger;  the geometry versions;  the lint findings;  the edge
//   types;  and the window's whole payload, byte for byte.
//
// Two worlds: a small hand-built one that exercises every table (a dangling
// edge, a lint, a geometry history, events at one instant), and the world
// checkout's newest settlement tag hydrated the way the tick hydrates it.
// The second SKIPS by name when there is no checkout, no tag or no PGlite.
//
//   WORLD_CLONE=<checkout> PGLITE_MODULE_DIR=<dir> node --test test/world-graph-parity.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { worldClone, NO_WORLD, OFFICE_ROOT } from "./fixture-paths.mjs";
import { loadPglite, storeFloor } from "./helpers/pglite-store.mjs";
import { SCHEMA, EDGE_TYPES } from "../src/world-store.mjs";
// The file's side is read by the TEST (POS-270 lane W 3a): the office no longer
// opens world.db, so the rows a hydration wrote are read here and built through
// the same one construction the store's rows pass through.
import { graphOf, tablesOfFixture, writeFixtureDb } from "./helpers/world-rows.mjs";
import { graphSnapshotFromTables, writeGraphSnapshot } from "../world2/tools/graph-ingest.mjs";
import { reloadWorldGraph, resetWorldGraph, worldGraphSnapshot, worldGraphStanding } from "../src/world-graph-snapshot.mjs";

const pglite = await loadPglite();
const dir = mkdtempSync(join(tmpdir(), "graph-parity-"));
after(() => { resetWorldGraph(); try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } });

// ── the comparison ───────────────────────────────────────────────────────────

const nodeList = (g) => { const out = []; g.forEachNode((id, a) => out.push([id, a])); return out; };
const edgeList = (g) => { const out = []; g.forEachEdge((key, a, src, dst) => out.push([key, src, dst, a])); return out; };

async function assertParity(worldDb, { officeSha = null } = {}) {
  const db = await storeFloor(pglite);
  try {
    const snap = graphSnapshotFromTables(tablesOfFixture(worldDb));
    if (officeSha) assert.equal(snap.officeSha, officeSha);
    await writeGraphSnapshot(db, snap);
    resetWorldGraph();
    const r = await reloadWorldGraph({ query: (sql, p) => db.query(sql, p) });
    assert.equal(r.changed, true, `the snapshot did not load: ${JSON.stringify(r.standing)}`);
    const fromStore = worldGraphSnapshot();
    const fromFile = graphOf(worldDb, { label: worldDb });

    const [sn, fn] = [nodeList(fromStore.graph), nodeList(fromFile.graph)];
    assert.equal(sn.length, fn.length, "node count");
    for (let i = 0; i < fn.length; i++) assert.deepStrictEqual(sn[i], fn[i], `node ${i} (${fn[i][0]}) differs`);
    const [se, fe] = [edgeList(fromStore.graph), edgeList(fromFile.graph)];
    assert.equal(se.length, fe.length, "edge count");
    for (let i = 0; i < fe.length; i++) assert.deepStrictEqual(se[i], fe[i], `edge ${i} (${fe[i][0]}) differs`);

    // node:sqlite hands back null-prototype rows; the VALUES are what is compared.
    const plain = (rows) => rows.map((r) => ({ ...r }));
    assert.deepStrictEqual(fromStore.placeholders, fromFile.placeholders, "placeholders");
    assert.deepStrictEqual(fromStore.meta, fromFile.meta, "meta");
    assert.deepStrictEqual(Object.keys(fromStore.meta), Object.keys(fromFile.meta), "meta's key order");
    assert.deepStrictEqual(plain(fromStore.events), plain(fromFile.events), "events (the walk ledger)");
    assert.deepStrictEqual(plain(fromStore.geometryVersions), plain(fromFile.geometryVersions), "geometry versions");
    assert.deepStrictEqual(plain(fromStore.lintFindings), plain(fromFile.lintFindings), "lint findings");
    assert.deepStrictEqual(plain(fromStore.edgeTypes), plain(fromFile.edgeTypes), "edge types (the constant must be the file's registry)");
    for (const k of ["counts", "anomalies", "anomalyDetail", "gates"]) assert.deepStrictEqual(fromStore[k], fromFile[k], k);

    // The window's payload, whole: the one reader that serialises props.
    const { worldGraphPayloadFrom, resetGraphCache } = await import("../src/world-graph.mjs");
    resetGraphCache();
    // `store` says where the graph came from (the file's bytes and mtime, or the
    // snapshot's key) and is the one field that differs by source; every other
    // byte must be the same.
    const st = statSync(worldDb);
    const filePayload = worldGraphPayloadFrom(fromFile, { bytes: st.size, mtime: new Date(st.mtimeMs).toISOString() });
    const storePayload = worldGraphPayloadFrom(fromStore);
    assert.equal(storePayload.store.source, "store");
    assert.equal(storePayload.store.tag_sha, fromFile.meta.as_of_world);
    assert.equal(typeof filePayload.store.bytes, "number");
    const bytes = (p) => JSON.stringify({ ...p, store: null });
    assert.equal(bytes(storePayload), bytes(filePayload), "the window's payload from the store is not byte-equal to the payload from world.db");
    return { nodes: fn.length, edges: fe.length, events: fromFile.events.length, geometry: fromFile.geometryVersions.length, lints: fromFile.lintFindings.length };
  } finally { await db.close(); }
}

// ── world 1: hand-built, every table ─────────────────────────────────────────

function handBuiltWorldDb(path) {
  const db = new DatabaseSync(path);
  try {
    db.exec(SCHEMA);
    const meta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
    // Inserted in a deliberately non-alphabetical order: the store must hand
    // meta back in the FILE's order, not sorted by key.
    for (const [k, v] of [["hydration_status", "BUILDING"], ["as_of_world", "a".repeat(40)], ["as_of_office", "b".repeat(40)],
      ["as_of_settlement", "S12"], ["counts", JSON.stringify({ nodes_total: 4 })], ["gates", "[]"], ["hydration_status", "OK"]]) meta.run(k, v);
    const node = db.prepare("INSERT OR REPLACE INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?)");
    // Out of id order, so the graph's order is the file's and not the key's.
    node.run("the-town/zed", "mark", "sited", "constitution", "the-town", 10.25, -3.5, 4, 2, JSON.stringify({ zeta: 1, alpha: { b: 2, a: 1 } }));
    node.run("the-town/alpha", "mark", "sited", "neighborhood", "the-town", -0.1, 0.2, null, null, JSON.stringify({ slug: "alpha" }));
    node.run("code:src/server.mjs", "code", "module", null, null, null, null, null, null, "{}");
    node.run("the-town/cls", "class", "class", "constitution", "the-town", null, null, null, null, JSON.stringify({ class: "cls", dials: { k: 1 } }));
    const edge = db.prepare("INSERT INTO edges (src, dst, type, props, born_at) VALUES (?,?,?,?,?)");
    edge.run("the-town/zed", "the-town/alpha", "contains", JSON.stringify({ geometry_ok: true, z: 0, a: 1 }), null);
    edge.run("code:src/server.mjs", "code:src/missing.mjs", "imports", "{}", null);          // dangling: a placeholder
    edge.run("the-town/alpha", "the-town/nowhere", "stop-of", JSON.stringify({ vessel: "x" }), "2026-09-01T00:00:00Z");
    for (const [t, n] of EDGE_TYPES) db.prepare("INSERT OR REPLACE INTO edge_type_registry VALUES (?, ?)").run(t, n);
    const ev = db.prepare("INSERT INTO events (at, actor, type, payload) VALUES (?,?,?,?)");
    ev.run("2026-09-02T00:00:00Z", "beta", "departure", JSON.stringify({ from: { x: 0, y: 0 }, toward: { x: 1, y: 1 } }));
    ev.run("2026-09-01T00:00:00Z", "alpha", "departure", JSON.stringify({ from: { x: 0, y: 0 }, toward: { x: 2, y: 2 } }));
    ev.run("2026-09-01T00:00:00Z", "gamma", "departure", "{}");                                 // a tie on `at`
    const g = db.prepare("INSERT INTO geometry_versions (mark_id, at_x, at_y, extent_w, extent_h, valid_from_iso, valid_to_iso, sha, path, subject, authored_iso, change) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    g.run("the-town/zed", 1, 1, 4, 2, "2026-08-01T00:00:00Z", "2026-08-20T00:00:00Z", "c".repeat(40), "WORLD/marks/zed/mark.md", "birth", "2026-08-01T00:00:00Z", "birth");
    g.run("the-town/zed", 10.25, -3.5, 4, 2, "2026-08-20T00:00:00Z", null, "d".repeat(40), "WORLD/marks/zed/mark.md", "moved", "2026-08-20T00:00:00Z", "moved");
    const l = db.prepare("INSERT OR REPLACE INTO lint_findings (lint, verdict, headline, evidence, hydrated_at, as_of_world) VALUES (?,?,?,?,?,?)");
    l.run("L7", "RED", "seven", JSON.stringify([{ hit: 1 }]), "2026-09-30T00:00:00Z", "a".repeat(40));
    l.run("L1", "GREEN", "one", "[]", "2026-09-30T00:00:00Z", "a".repeat(40));
  } finally { db.close(); }
  return path;
}

test("PARITY, hand-built: every table, a dangling edge, ties and file order — the store's graph IS the file's", async (t) => {
  if (pglite.reason) return t.skip(pglite.reason);
  const n = await assertParity(handBuiltWorldDb(join(dir, "hand.db")), { officeSha: "b".repeat(40) });
  assert.deepEqual(n, { nodes: 6, edges: 3, events: 3, geometry: 2, lints: 2 }, "4 nodes and the 2 placeholders the dangling edges make");
  assert.equal(worldGraphStanding().source, "store");
  assert.equal(worldGraphStanding().settlement, 12);
});

test("THE PEN REFUSES a FAILED hydration, and one with no office sha — never a broken store with a better address", () => {
  const failed = join(dir, "failed.db");
  handBuiltWorldDb(failed);
  const db = new DatabaseSync(failed);
  db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run("hydration_status", "FAILED: empty tables — nodes");
  db.close();
  assert.throws(() => graphSnapshotFromTables(tablesOfFixture(failed)), /stamped "FAILED/);
  const noOffice = join(dir, "no-office.db");
  handBuiltWorldDb(noOffice);
  const db2 = new DatabaseSync(noOffice);
  db2.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run("as_of_office", "");
  db2.close();
  assert.throws(() => graphSnapshotFromTables(tablesOfFixture(noOffice)), /as_of_office/);
});

// ── world 2: the checkout's newest blessing, hydrated as the tick does ──────

function newestBlessing(repo) {
  const lines = execFileSync("git", ["-C", repo, "for-each-ref", "--format=%(refname:short) %(*objectname) %(objectname)", "refs/tags/settlement/"], { encoding: "utf8" })
    .split("\n").filter(Boolean).map((l) => {
      const [tag, peeled, obj] = l.split(" ");
      return { tag, n: Number(/S(\d+)$/.exec(tag)?.[1]), sha: peeled || obj };
    }).filter((x) => Number.isFinite(x.n));
  lines.sort((a, b) => b.n - a.n);
  return lines[0] ?? null;
}

const CLONE = NO_WORLD ? null : worldClone();
const whyNotBlessed = NO_WORLD || pglite.reason || (newestBlessing(CLONE) ? null : `the world checkout at ${CLONE} carries no settlement/S<n> tag`);
let blessedDb = null, blessing = null;
before(() => {
  if (whyNotBlessed) return;
  blessing = newestBlessing(CLONE);
  blessedDb = join(dir, "blessed.db");
  execFileSync(process.execPath, [join(OFFICE_ROOT, "src", "world-hydrate.mjs"),
    "--world", CLONE, "--ref", blessing.sha, "--no-db", "--rows-out", `${blessedDb}.rows.json`, "--no-gexf"],
  { stdio: "ignore", env: { ...process.env, TMP: dir, TEMP: dir, TMPDIR: dir } });
  writeFixtureDb(`${blessedDb}.rows.json`, blessedDb);
});

test("PARITY at the checkout's newest settlement: node for node and edge for edge, lints and all", async (t) => {
  if (whyNotBlessed) return t.skip(whyNotBlessed);
  const n = await assertParity(blessedDb);
  t.diagnostic(`S${blessing.n} ${blessing.sha.slice(0, 12)}: ${JSON.stringify(n)}`);
  assert.ok(n.nodes > 0 && n.edges > 0, "a blessed world with no graph is not a parity");
});

test("THE READERS: with world.db ABSENT, the window and the served snapshot answer from the store once it loads; before, they say the file is missing", async (t) => {
  if (pglite.reason) return t.skip(pglite.reason);
  const prev = process.env.WORLD_STORE_DB;
  process.env.WORLD_STORE_DB = join(dir, "no-such-world.db");
  const { worldGraphPayload, resetGraphCache } = await import("../src/world-graph.mjs");
  const { storeSnapshot, resetStoreSnapshot, worldStoreHealth } = await import("../src/world-serve.mjs");
  const db = await storeFloor(pglite);
  try {
    resetWorldGraph(); resetGraphCache(); resetStoreSnapshot();
    // The floor: no snapshot, no file — the readers say so rather than invent a world.
    assert.match(String(worldGraphPayload().error), /no world store/);
    assert.match(String(storeSnapshot().error), /no world store/);
    // The store: one snapshot copied in and loaded.
    await writeGraphSnapshot(db, graphSnapshotFromTables(tablesOfFixture(handBuiltWorldDb(join(dir, "readers.db")))));
    await reloadWorldGraph({ query: (sql, p) => db.query(sql, p) });
    const payload = worldGraphPayload();
    assert.equal(payload.error, undefined, `the window did not answer from the store: ${JSON.stringify(payload).slice(0, 160)}`);
    assert.deepEqual(payload.store, { source: "store", settlement: 12, tag_sha: "a".repeat(40), office_sha: "b".repeat(40) });
    assert.equal(payload.counts.nodes, 6);
    const snap = storeSnapshot();
    assert.equal(snap.error, undefined, `the served snapshot did not answer from the store: ${snap.error}`);
    assert.equal(snap.graph.order, 6);
    assert.equal(snap.source.source, "store");
    assert.equal(storeSnapshot(), snap, "an unmoved snapshot is the same served object (no reload per read)");
    assert.equal(worldStoreHealth().db.source.tag_sha, "a".repeat(40), "the health line names the store's key");
  } finally {
    if (prev == null) delete process.env.WORLD_STORE_DB; else process.env.WORLD_STORE_DB = prev;
    resetWorldGraph(); resetGraphCache(); resetStoreSnapshot();
    await db.close();
  }
});

test("THE LINTS over the store's snapshot answer what they answer over world.db, at the newest settlement", async (t) => {
  if (whyNotBlessed) return t.skip(whyNotBlessed);
  const { runLints } = await import("../src/world-lints.mjs");
  const db = await storeFloor(pglite);
  try {
    await writeGraphSnapshot(db, graphSnapshotFromTables(tablesOfFixture(blessedDb)));
    resetWorldGraph();
    await reloadWorldGraph({ query: (sql, p) => db.query(sql, p) });
    const fromFile = await runLints({ store: graphOf(blessedDb) });
    const fromStore = await runLints({ store: worldGraphSnapshot() });
    const verdicts = (r) => r.lints.map((l) => [l.id, l.verdict, l.headline, JSON.stringify(l.evidence ?? null)]);
    assert.deepStrictEqual(verdicts(fromStore), verdicts(fromFile));
  } finally { await db.close(); }
});
