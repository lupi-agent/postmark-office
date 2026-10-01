// world-store.test.mjs — the tense law, locked, and the FAILED-index guard.
//
// These two are unit tests over the store's own primitives rather than over a
// hydration, deliberately: hydrating takes eight seconds and needs a real world
// clone, and the invariant most likely to regress silently is not "does the
// hydrator run" but "does an as-of read stay as-of". A regression there does
// not throw; it quietly answers a question about 2026-08-08 with today's
// geometry, which is exactly the failure geometry_versions exists to end.
//
// The rows below are the Pando landing's real ones — the seam is the committer
// instant of 2b4b331 ("the Pando landing moves to Porch Hill"), and the two
// departure instants are walk-ledger lines 142 and 250.
//
//   node --test test/world-store.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SCHEMA, geometryIndex, geometryAsOf, rectOfVersion } from "../src/world-store.mjs";
import { graphOf } from "./helpers/world-rows.mjs";

const LANDING = "the-town/the-pando-landing";
const SEAM = "2026-08-09T21:32:24.000Z";
const ROWS = [
  { mark_id: LANDING, at_x: -95430, at_y: -95430, extent_w: 14, extent_h: 40,
    valid_from_iso: "2026-08-07T14:19:47.000Z", valid_to_iso: SEAM, sha: "5062b99", change: "birth" },
  { mark_id: LANDING, at_x: -94570, at_y: -94570, extent_w: 14, extent_h: 40,
    valid_from_iso: SEAM, valid_to_iso: null, sha: "2b4b331", change: "moved" },
];
const index = geometryIndex(ROWS);

test("an instant before the seam reads the geometry that stood then", () => {
  const g = geometryAsOf(index, LANDING, "2026-08-08T22:24:17.811Z");
  assert.equal(g.status, "ok");
  assert.equal(g.version.at_x, -95430);
  assert.equal(g.version.sha, "5062b99");
});

test("an instant hours before the ruling still reads the old geometry — the settled clock, not the intent", () => {
  // The 12:00Z cast-off left from where the ruling would later put the landing,
  // nine hours before the ruling landed. An as-of read must say so; the ledger
  // records what was true at the instant, not what was later decided about it.
  const g = geometryAsOf(index, LANDING, "2026-08-09T12:00:00.000Z");
  assert.equal(g.version.at_x, -95430);
  assert.notEqual(g.version.at_x, -94570);
});

test("an instant at or after the seam reads the new geometry", () => {
  assert.equal(geometryAsOf(index, LANDING, SEAM).version.at_x, -94570);
  assert.equal(geometryAsOf(index, LANDING, "2026-08-10T00:00:00.000Z").version.at_x, -94570);
});

test("before the mark existed is NOT the same answer as no such mark", () => {
  assert.equal(geometryAsOf(index, LANDING, "2026-08-01T00:00:00.000Z").status, "not-yet");
  assert.equal(geometryAsOf(index, "nobody/nowhere", "2026-08-09T12:00:00.000Z").status, "unknown-mark");
  // Both return version:null, and a caller that conflated them would answer
  // "the vessel departed from nowhere near a stop" for a stop that simply had
  // not been recorded yet.
  assert.equal(rectOfVersion(geometryAsOf(index, LANDING, "2026-08-01T00:00:00.000Z").version), null);
});

test("the rect an as-of read hands back is the one the world's geometry wants", () => {
  const r = rectOfVersion(geometryAsOf(index, LANDING, "2026-08-08T22:24:17.811Z").version);
  assert.deepEqual(r, { x: -95430, y: -95430, w: 14, h: 40 });
});

test("an index stamped FAILED refuses to load", () => {
  const dir = mkdtempSync(join(tmpdir(), "postmark-world-store-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "world.db");
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  db.prepare("INSERT INTO meta VALUES (?, ?)").run("hydration_status", "FAILED: empty tables — events (promised by gate walk-ledger)");
  db.close();

  // The refusal lives in the one construction (graphFromTables), which every
  // source of rows passes through: the store's snapshot, or a fixture's.
  assert.throws(() => graphOf(path), /stamped FAILED/);
  assert.doesNotThrow(() => graphOf(path, { allowFailed: true }));
});
