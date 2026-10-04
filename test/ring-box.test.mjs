// ring-box.test.mjs — POS-322: a mark's box is derived from its ring, and the
// store's bbox is the same arithmetic.
//
// THE INSTANCE: kinofire's 10-02 16:36Z amend of kinofire/the-gloaming
// (STATE/log/225.journal.jsonl seq 12129) sent at {-2300,-1000}, extent
// 1200×1000 and a 16-point ring spanning x -2300..-1100, y -1000..0. The world
// reads `at` as the centre; the 18:00Z crossing refused the town over it.
//
// Legs:
//   1. ringBox(kinofire's ring) = at {-1700,-500}, extent 1200×1000.
//   2. PARITY: ring-box's arithmetic is the world lint's (`tools/geometry.mjs`
//      from the WORLD_CLONE beside this office). Over every ringed mark in the
//      clone's canon: ringBox satisfies ringMatchesClaim, and ringAgrees
//      answers what ringMatchesClaim answers on the canon claim and on the
//      claim moved 1 m.
//   3. THE STORE: the docket pen (`claimTxFromJournal`) files kinofire's row
//      with geometry at {-1700,-500} and bbox ((-2300,-1000),(-1100,0)), and
//      the stored composition passes the lint's ring rule.
//   4. A RING-LESS ROW is filed exactly as sent: geometry and bbox unchanged.
//
//   WORLD_CLONE=<tree>/world-clone node --test test/ring-box.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { ringBox, ringAgrees, ringOf, ringMovedTo } from "../src/ring-box.mjs";
import { claimTxFromJournal } from "../src/world2-claims.mjs";
import { boxOf } from "../world2/tools/seed-import.mjs";
import { KINOFIRE_12129 } from "./helpers/kinofire-12129.mjs";


const WORLD_CLONE = process.env.WORLD_CLONE;
const geomPath = WORLD_CLONE ? join(WORLD_CLONE, "tools", "geometry.mjs") : null;
const haveWorld = !!(geomPath && existsSync(geomPath));
const geom = haveWorld ? await import(pathToFileURL(geomPath)) : null;

// ── LEG 1 ────────────────────────────────────────────────────────────────────
test("ringBox: kinofire's 10-02 ring is centred at {-1700,-500}, 1200×1000", () => {
  assert.deepEqual(ringBox(KINOFIRE_12129.points), { at: { x: -1700, y: -500 }, extent: { w: 1200, h: 1000 } });
  assert.equal(ringAgrees(KINOFIRE_12129, KINOFIRE_12129.points), false, "the at kinofire sent is the corner, not the centre");
  assert.equal(ringAgrees({ at: { x: -1700, y: -500 }, extent: { w: 1200, h: 1000 } }, KINOFIRE_12129.points), true);
});

test("ringOf refuses what the world would not honour; ringMovedTo keeps the shape", () => {
  assert.equal(ringOf("x1,y1 x2,y2"), null);
  assert.equal(ringOf([[0, 0], [1, 1]]), null, "fewer than 3 vertices");
  assert.equal(ringOf([[0, 0], [1, "1"], [2, 2]]), null, "a vertex that is not two numbers");
  assert.ok(ringOf([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }]));
  const moved = ringMovedTo(KINOFIRE_12129.points, { x: -1650, y: -500 });
  assert.deepEqual(moved, KINOFIRE_12129.points.map(([x, y]) => [x + 50, y]));
});

// ── LEG 2 · parity with the world lint ───────────────────────────────────────
test("PARITY: ring-box's arithmetic is the lint's, over every ringed mark in canon", { skip: !haveWorld && "no WORLD_CLONE" }, () => {
  const state = JSON.parse(readFileSync(join(WORLD_CLONE, "WORLD", "world-state.json"), "utf8"));
  const ringed = (state.marks ?? []).filter((m) => Array.isArray(m.points));
  assert.ok(ringed.length >= 10, `the clone's canon carries ringed marks (got ${ringed.length})`);
  for (const m of ringed) {
    const box = ringBox(m.points);
    assert.equal(geom.ringMatchesClaim({ ...box, points: m.points }), true, `${m.id}: the derived box passes the lint's rule`);
    assert.equal(ringAgrees(m, m.points), geom.ringMatchesClaim(m), `${m.id}: ringAgrees answers as the lint does on canon`);
    const off = { ...m, at: { x: m.at.x + 1, y: m.at.y } };
    assert.equal(ringAgrees(off, m.points), geom.ringMatchesClaim(off), `${m.id}: and on the claim moved 1 m`);
  }
  assert.equal(geom.ringMatchesClaim(KINOFIRE_12129), false, "the lint refuses what kinofire sent");
  assert.equal(geom.ringMatchesClaim({ ...KINOFIRE_12129, ...ringBox(KINOFIRE_12129.points) }), true, "and passes the derived box");
});

// ── the docket pen, on a client that records what it was asked ──────────────
function recordingClient() {
  const asked = [];
  return {
    asked,
    async query(sql, params = []) {
      const q = String(sql).replace(/\s+/g, " ").trim();
      asked.push({ q, params });
      if (/^SELECT id FROM windows/i.test(q)) return { rows: [{ id: 226 }], rowCount: 1 };
      if (/^INSERT INTO claims/i.test(q)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    inserted() {
      const ins = asked.find((a) => /^INSERT INTO claims/i.test(a.q));
      return ins ? { geometry: JSON.parse(ins.params[5]), bbox: ins.params[6] } : null;
    },
  };
}
const rowOf = (payload, action = "amend") => ({ class: "mark", action, actor: payload.by, object: `${payload.by}/${payload.slug}`, payload: JSON.stringify(payload) });

// ── LEG 3 · the store ────────────────────────────────────────────────────────
test("THE STORE: kinofire's row is filed centred, and the bbox column is the ring's box", async () => {
  const c = recordingClient();
  await claimTxFromJournal(c, rowOf(KINOFIRE_12129), 12129, { household: "commander-and-chief" });
  const got = c.inserted();
  assert.ok(got, "a claim was inserted");
  console.log(`    RECEIPT · stored geometry at=${JSON.stringify(got.geometry.at)} extent=${JSON.stringify(got.geometry.extent)} bbox=${got.bbox}`);
  assert.deepEqual(got.geometry.at, { x: -1700, y: -500 });
  assert.deepEqual(got.geometry.extent, { w: 1200, h: 1000 });
  assert.deepEqual(got.geometry.points, KINOFIRE_12129.points, "the ring is stored exactly as sent");
  assert.equal(got.bbox, "((-2300,-1000),(-1100,0))");
  if (geom) {
    const composed = { kind: "sited", at: got.geometry.at, extent: got.geometry.extent, points: got.geometry.points };
    assert.ok(geom.polygonOf(composed), "the lint's ring-shape check passes");
    assert.equal(geom.ringMatchesClaim(composed), true, "the lint's ring = bbox check passes (SCHEMA v2)");
  }
});

// ── LEG 4 · a ring-less row is untouched ─────────────────────────────────────
test("A RING-LESS ROW is filed exactly as sent", async () => {
  const { points: _p, ...plain } = KINOFIRE_12129;
  const c = recordingClient();
  await claimTxFromJournal(c, rowOf(plain), 12130, { household: "commander-and-chief" });
  const got = c.inserted();
  assert.equal(JSON.stringify(got.geometry), JSON.stringify({ slug: "kinofire/the-gloaming", at: plain.at, extent: plain.extent }));
  assert.equal(got.bbox, boxOf(plain.at, plain.extent));
});
