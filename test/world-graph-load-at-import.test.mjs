// world-graph-load-at-import.test.mjs — a process has the world before its
// import-time dials evaluate (POS-270 lane W 3b, Keemin-ruled 2026-09-30).
//
// voices.mjs computes speech's seven dials when it LOADS. With world.db retired
// the only world there is is the store's snapshot, so world-graph-snapshot.mjs
// loads it at import (a top-level await on its own client), and every module
// that imports it waits. This drives that load end to end: a REAL Postgres
// (embedded-postgres, the schema laid down), a snapshot written by the graph
// pen whose say class declares dials no repo constant matches, and a child
// process — no WORLD2_PG, no rows fixture — that imports voices.mjs through the
// read-only pen (WORLD_GRAPH_PG_URL as snapshot_reader). Its dials must be the
// snapshot's, every one, and its standing must name the role it read as.
//
//   EMBEDDED_PG_DIR=<dir holding embedded-postgres> node --test test/world-graph-load-at-import.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { OFFICE_ROOT } from "./fixture-paths.mjs";
import { startStore } from "./helpers/embedded-store.mjs";

// Seven numbers none of the repo's constants carry, so a fallback cannot pass.
const RECORD = { earshot_m: 137, fade_min: 7, conversation_lull_min: 31, speak_every_s: 16, text_max: 501, hear_max: 21, presence_min: 17 };
const TABLES = {
  meta: [
    { key: "as_of_world", value: "a".repeat(40) }, { key: "as_of_office", value: "b".repeat(40) },
    { key: "as_of_settlement", value: "S9" }, { key: "hydration_status", value: "OK" },
  ],
  nodes: [{ id: "the-town/say", kind: "mark", subkind: "sited", tier: "constitution", by: "the-town", at_x: 0, at_y: 0, extent_w: 1, extent_h: 1,
    props: JSON.stringify({ class: "say", class_version: 1, in_works: 1, dials: RECORD }) }],
  edges: [], events: [], geometryVersions: [], lintFindings: [],
};

let store = null;
before(async () => {
  store = await startStore({ db: "world_graph_import_test" });
  if (store.skip) return;
  const { graphSnapshotFromTables, writeGraphSnapshot } = await import("../world2/tools/graph-ingest.mjs");
  const pen = await store.connect("law_ingester");
  try { await writeGraphSnapshot(pen, graphSnapshotFromTables(TABLES)); } finally { await pen.end(); }
});
after(async () => { if (store && !store.skip) await store.stop(); });

const url = (rel) => pathToFileURL(join(OFFICE_ROOT, rel)).href;
const CHILD = `
const t0 = performance.now();
const v = await import(${JSON.stringify(url("src/voices.mjs"))});
const importMs = Math.round(performance.now() - t0);
const s = await import(${JSON.stringify(url("src/world-graph-snapshot.mjs"))});
console.log(JSON.stringify({
  importMs,
  earshot: v.EARSHOT_M,
  dials: Object.fromEntries(Object.entries(v.SAY_DIALS).map(([k, d]) => [k, { value: d.value, source: d.source }])),
  standing: s.worldGraphStanding(),
}));`;

function child(env) {
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", CHILD],
    { encoding: "utf8", env: { ...process.env, WORLD2_PG: "", WORLD2_PG_URL: "", WORLD_GRAPH_ROWS: "", ...env } });
  return JSON.parse(out.trim().split("\n").at(-1));
}

test("THE DIALS ARE THE SNAPSHOT'S: a process that imports voices.mjs reads the store's world at import, through the read-only pen", (t) => {
  if (store.skip) return t.skip(store.skip);
  const r = child({ WORLD_GRAPH_PG_URL: store.url("snapshot_reader") });
  assert.equal(r.standing.source, "store", `the load at import did not publish: ${JSON.stringify(r.standing)}`);
  assert.equal(r.standing.loaded_at_import.role, "snapshot_reader", "the load must read as the read-only role it was handed");
  assert.equal(r.standing.loaded_at_import.published, true);
  for (const [slot, want] of Object.entries(RECORD))
    assert.equal(r.dials[slot]?.source, "record", `${slot} stood on a constant at import: ${JSON.stringify(r.dials[slot])}`);
  assert.equal(r.earshot, RECORD.earshot_m, "EARSHOT_M is the record's 137, not the repo's 60");
  t.diagnostic(`the load at import: ${r.standing.loaded_at_import.ms} ms for the snapshot's queries; voices.mjs's import ${r.importMs} ms in all`);
});

test("NO STORE, NO WORLD — and the process says so: the dials fall back, disclosed, and the standing names the failed load", (t) => {
  if (store.skip) return t.skip(store.skip);
  const r = child({ WORLD_GRAPH_PG_URL: "postgres://snapshot_reader:x@127.0.0.1:1/nowhere" });
  assert.equal(r.standing.source, "floor");
  assert.match(r.standing.disclosed, /the load at import failed/);
  assert.equal(r.standing.loaded_at_import.published, false);
  assert.ok(Object.values(r.dials).every((d) => d.source !== "record"), "a dial claimed the record with no world to read");
});
