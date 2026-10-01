// world-graph-rows-seam.test.mjs — the test fixture seam answers only under
// node --test (POS-270 lane W 3a, Keemin-ruled 2026-09-30).
//
// A test's world is rows: published in process (publishWorldGraphForTest) or
// handed to a spawned office as WORLD_GRAPH_ROWS. Both are fixtures, so an
// office outside the test runner must refuse them BY NAME and stand on the
// store, or a stray env line could become prod's world. Each case runs in a
// child process, with and without NODE_TEST_CONTEXT, so the guard is driven
// rather than read.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { OFFICE_ROOT } from "./fixture-paths.mjs";

const dir = mkdtempSync(join(tmpdir(), "rows-seam-"));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const ROWS = join(dir, "rows.json");
writeFileSync(ROWS, JSON.stringify({
  meta: [{ key: "hydration_status", value: "OK" }, { key: "as_of_world", value: "f00dcafe" }],
  nodes: [{ id: "the-town/well", kind: "mark", subkind: "sited", tier: "constitution", by: "the-town", at_x: 0, at_y: 0, extent_w: 1, extent_h: 1, props: "{}" }],
  edges: [], events: [], geometryVersions: [], lintFindings: [],
}));
const SNAPSHOT = pathToFileURL(join(OFFICE_ROOT, "src", "world-graph-snapshot.mjs")).href;

/** What a fresh process sees, with the test context present or absent. */
function child(code, { inTest, rows = null }) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.WORLD_GRAPH_ROWS;
  if (inTest) env.NODE_TEST_CONTEXT = "child-v8";
  if (rows) env.WORLD_GRAPH_ROWS = rows;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env }));
}
const STANDING = `const m = await import(${JSON.stringify(SNAPSHOT)});
  console.log(JSON.stringify({ loaded: Boolean(m.worldGraphSnapshot()), nodes: m.worldGraphSnapshot()?.graph?.order ?? null, standing: m.worldGraphStanding() }));`;

test("WORLD_GRAPH_ROWS loads under node --test — the fixture a spawned office stands on", () => {
  const r = child(STANDING, { inTest: true, rows: ROWS });
  assert.equal(r.loaded, true, JSON.stringify(r.standing));
  assert.equal(r.nodes, 1);
});

test("WORLD_GRAPH_ROWS outside node --test is REFUSED BY NAME, and no world is published from it", () => {
  const r = child(STANDING, { inTest: false, rows: ROWS });
  assert.equal(r.loaded, false, "a rows fixture became the world outside the test runner");
  assert.match(r.standing.disclosed, /WORLD_GRAPH_ROWS is a test fixture and is refused outside node --test/);
});

test("publishWorldGraphForTest throws outside node --test", () => {
  const code = `const m = await import(${JSON.stringify(SNAPSHOT)});
    let threw = null;
    try { m.publishWorldGraphForTest({ meta: [], nodes: [], edges: [], events: [], geometryVersions: [], lintFindings: [] }); } catch (e) { threw = e.message; }
    console.log(JSON.stringify({ threw, loaded: Boolean(m.worldGraphSnapshot()) }));`;
  const out = child(code, { inTest: false });
  assert.match(String(out.threw), /answers only under node --test/);
  assert.equal(out.loaded, false);
  const inside = child(code, { inTest: true });
  assert.equal(inside.threw, null, "the seam refused inside the test runner, where it is the whole point");
  assert.equal(inside.loaded, true);
});
