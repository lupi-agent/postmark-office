// doorstep-stakes.test.mjs — the ninth doorstep segment: your marks, the escrow
// behind each, which stand at risk at the next settlement (postmark#2919).
//
// THE FALSIFIER THE ISSUE NAMES: a fixture household with one mark at escrow 0
// → the segment names it FIRST, with the crossing time and the stake envelope;
// flip reds. The fixture below carries the four shapes the sweep tells apart —
// a commons mark at ✦0 (at risk), a commons mark at ✦2 (not), a home-class
// parcel at ✦0 (never swept), a founding mark the registry does not hold at ✦0
// (never swept) — because a predicate that reads only the number would flag two
// of them wrongly and pass a test with one mark in it.
//
// THE FLIPS, run 2026-09-18 against commit `fb36916` of this branch:
//   1. src/doorstep-stakes.mjs § stakesRowsFrom, `cls === "commons" && escrow === 0`
//      → `escrow === 0` (the number alone): 5 of 11 red — the four-shape test
//      ("a home-class parcel at ✦0 is NOT at risk", "founding estate is NOT at
//      risk"), and every test that pins the order, because two more rows became
//      at-risk and sorted ahead.
//   2. the `rows.sort(...)` line removed: 5 of 11 red — "the at-risk mark is
//      FIRST" and every order pin.
//
// The escrow reader is proven the way `docketEscrow` is (test/stake-held.test.mjs):
// a narrow pool stand-in that answers the two statements and throws on any other,
// because there is no lab store — the box's world2_dev IS prod.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { stakesRowsFrom, stakesFor, doorstepStakes, stakeEnvelope, REGISTRY_PATH } from "../src/doorstep-stakes.mjs";
import { nextSettlement, SETTLEMENT_CLOCK } from "../src/world-forecast.mjs";
import { DOORSTEP_SEGMENTS } from "../src/queries.mjs";
import { HOUSEHOLD_READABLE, HOUSEHOLD_READ_ENUM, HOUSEHOLD_READ_FIELDS, HOUSEHOLD_READS } from "../src/household-apex.mjs";
import { fixtureDb } from "./fixture.mjs";

// ── the fixture household ───────────────────────────────────────────────────
const MARKS = [
  { id: "berthillon/chez-antoine", kind: "parcel", by: "berthillon", household: "berthillon", at: { x: 1, y: 1 } },
  { id: "berthillon/cone-coing", kind: "sited", by: "berthillon", household: "berthillon", at: { x: 2, y: 2 } },
  { id: "berthillon/the-orchard-bench", kind: "sited", by: "berthillon", household: "berthillon", at: { x: 3, y: 3 } },
  { id: "berthillon/the-old-lantern", kind: "sited", by: "berthillon", household: "berthillon", at: { x: 4, y: 4 } },
  { id: "someone-else/their-mark", kind: "sited", by: "someone-else", household: "someone-else", at: { x: 9, y: 9 } },
];
const REGISTRY = {
  "berthillon/chez-antoine": { household: "berthillon", path: "WORLD/marks/berthillon/chez-antoine/mark.md", class: "home" },
  "berthillon/cone-coing": { household: "berthillon", path: "WORLD/marks/berthillon/cone-coing/mark.md", class: "commons" },
  "berthillon/the-orchard-bench": { household: "berthillon", path: "WORLD/marks/berthillon/the-orchard-bench/mark.md", class: "commons" },
  // the-old-lantern is founding estate: absent from the registry
  "someone-else/their-mark": { household: "someone-else", path: "WORLD/marks/someone-else/their-mark/mark.md", class: "commons" },
};
const ESCROW = new Map([["berthillon/chez-antoine", 0], ["berthillon/cone-coing", 2], ["berthillon/the-orchard-bench", 0], ["berthillon/the-old-lantern", 0]]);
const HEAD = "276f1d20fbbea5da5e4f50531c5366f4690eb000";
const readers = (over = {}) => ({
  world: async () => ({ state: { marks: MARKS }, ref: "origin/main", sha: "abc" }),
  registry: async (ref) => { assert.equal(ref, "origin/main", "the registry is read at the ref the world was"); return REGISTRY; },
  escrow: async () => ({ townSha: HEAD, byMark: ESCROW, reason: null }),
  now: new Date("2026-09-18T04:10:00Z"),
  ...over,
});

test("THE FALSIFIER · the one mark at ✦0 is named FIRST, with the settlement's time and the stake envelope", async () => {
  const seg = await stakesFor(["berthillon"], readers());
  assert.equal(seg.rows[0].mark, "berthillon/the-orchard-bench", "the at-risk mark is FIRST");
  assert.equal(seg.rows[0].at_risk, true);
  assert.equal(seg.rows[0].escrow, 0);
  assert.equal(seg.rows[0].class, "commons");
  assert.equal(seg.rows[0].act, stakeEnvelope("berthillon/the-orchard-bench"));
  assert.equal(seg.rows[0].act, 'world { do: "stake", args: { mark: "berthillon/the-orchard-bench", stamps: 1 } }');
  assert.equal(seg.next_settlement.at, "2026-09-18T06:00:00.000Z", "the first settlement after now — the sweep's clock, 06:00/18:00Z");
  assert.equal(seg.next_settlement.at, nextSettlement(new Date("2026-09-18T04:10:00Z")));
  assert.equal(seg.clock, SETTLEMENT_CLOCK);
  assert.match(seg.clock, /not the ferry's 00:00\/12:00Z crossing/, "the segment says which clock it reads");
  assert.equal(seg.at_risk, 1);
  assert.equal(seg.count, 4, "every published mark of the handle, not only the at-risk ones");
  assert.equal(seg.escrow_at_town_sha, HEAD, "the freshness stamp names its own source");
});

test("the sweep's other three shapes are NOT at risk: a commons mark with stamps, a home-class parcel at ✦0, founding estate at ✦0", async () => {
  const seg = await stakesFor(["berthillon"], readers());
  const by = Object.fromEntries(seg.rows.map((r) => [r.mark, r]));
  assert.equal(by["berthillon/cone-coing"].at_risk, false, "✦2 behind it");
  assert.equal(by["berthillon/cone-coing"].escrow, 2);
  assert.equal(by["berthillon/chez-antoine"].at_risk, false, "a home-class parcel at ✦0 is NOT at risk — the sweep never takes a home row");
  assert.equal(by["berthillon/chez-antoine"].class, "home");
  assert.equal(by["berthillon/the-old-lantern"].at_risk, false, "founding estate is NOT at risk — absent from the registry, it stays published");
  assert.equal(by["berthillon/the-old-lantern"].class, null);
  for (const r of seg.rows) if (!r.at_risk) assert.equal(r.act, undefined, "the act rides only an at-risk row");
  assert.deepEqual(seg.rows.map((r) => r.mark),
    ["berthillon/the-orchard-bench", "berthillon/chez-antoine", "berthillon/cone-coing", "berthillon/the-old-lantern"],
    "at-risk first, then by id");
  assert.ok(!seg.rows.some((r) => r.mark.startsWith("someone-else/")), "another resident's marks are not on this page");
});

test("the rows are pure over (handles, marks, registry, byMark) — the same four inputs the sweep reads", () => {
  const rows = stakesRowsFrom({ handles: ["berthillon"], marks: MARKS, registry: REGISTRY, byMark: ESCROW });
  assert.equal(rows.length, 4);
  assert.equal(rows[0].mark, "berthillon/the-orchard-bench");
  // a mark the projection has no row for reads ✦0 — that is `escrowAbsentAmong`'s own reading of the Map
  const sparse = stakesRowsFrom({ handles: ["berthillon"], marks: MARKS, registry: REGISTRY, byMark: new Map([["berthillon/cone-coing", 2]]) });
  assert.equal(sparse.find((r) => r.mark === "berthillon/the-orchard-bench").escrow, 0);
  assert.equal(sparse.find((r) => r.mark === "berthillon/the-orchard-bench").at_risk, true);
});

test("THE TWO ABSENCES · a projection that REFUSED lists the marks with escrow null and at_risk null under an `unavailable` line — never ✦0", async () => {
  const seg = await stakesFor(["berthillon"], readers({ escrow: async () => ({ townSha: HEAD, byMark: null, reason: "escrow_projection cannot answer at town 276f1d20 (migration 014 not applied, or this sha not ingested) — what stands behind these marks is unknown, not zero" }) }));
  assert.match(seg.unavailable, /unknown, not zero/);
  assert.equal(seg.at_risk, null, "not measured is not zero");
  assert.equal(seg.count, 4, "what you hold is still listed");
  for (const r of seg.rows) { assert.equal(r.escrow, null); assert.equal(r.at_risk, null); assert.equal(r.act, undefined); }
  assert.equal(seg.note, undefined, "no 'nothing at risk' sentence on an unmeasured page");
  // and a reader that THROWS is the same absence, disclosed
  const thrown = await stakesFor(["berthillon"], readers({ escrow: async () => { throw new Error("connection refused"); } }));
  assert.match(thrown.unavailable, /could not be read \(connection refused\)/);
  assert.equal(thrown.at_risk, null);
});

test("an office with no docket store configured says so, through the doorstep's own reader", async () => {
  const saved = { PG: process.env.WORLD2_PG, URL: process.env.WORLD2_PG_URL };
  delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL;
  try {
    const seg = await doorstepStakes("berthillon", { world: readers().world, registry: readers().registry });
    assert.match(seg.unavailable, /keeps no docket store/);
    assert.equal(seg.count, 4);
    assert.equal(seg.at_risk, null);
  } finally {
    if (saved.PG !== undefined) process.env.WORLD2_PG = saved.PG;
    if (saved.URL !== undefined) process.env.WORLD2_PG_URL = saved.URL;
  }
});

test("a quiet page says so, and an empty one points at the portfolio", async () => {
  const quiet = await stakesFor(["berthillon"], readers({ escrow: async () => ({ townSha: HEAD, byMark: new Map([["berthillon/the-orchard-bench", 1], ["berthillon/cone-coing", 2]]), reason: null }) }));
  assert.equal(quiet.at_risk, 0);
  assert.match(quiet.note, /nothing of yours is at risk at the next settlement/);
  const empty = await stakesFor(["nobody"], readers());
  assert.equal(empty.count, 0);
  assert.match(empty.note, /no published mark of yours stands on world main/);
  assert.match(empty.read_the_rest, /world \{ read: "leave-mark" \}/, "the portfolio's own grammar");
});

test("scope is the stances/rulings grammar: a named handle is one resident, bare is the whole house the key holds", async () => {
  const marks = [...MARKS, { id: "antoine/the-cellar", kind: "sited", by: "antoine", household: "berthillon" }];
  const reg = { ...REGISTRY, "antoine/the-cellar": { household: "berthillon", path: "x", class: "commons" } };
  const r = readers({ world: async () => ({ state: { marks }, ref: "origin/main" }), registry: async () => reg });
  const key = { household: "deva-commons", handles: new Set(["berthillon", "antoine"]) };
  const house = await doorstepStakes(null, { key, ...r });
  assert.equal(house.count, 5);
  assert.equal(house.rows[0].mark, "antoine/the-cellar", "no projection row → ✦0 → at risk, and first");
  const one = await doorstepStakes("berthillon", { key, ...r });
  assert.equal(one.count, 4);
});

test("the world record unreadable is a disclosed absence, not an empty page", async () => {
  const seg = await stakesFor(["berthillon"], readers({ world: async () => { throw new Error("no clone"); } }));
  assert.match(seg.unavailable, /the world record could not be read \(no clone\)/);
  assert.equal(seg.count, 0);
  assert.equal(seg.at_risk, null);
  assert.equal(seg.next_settlement.at, "2026-09-18T06:00:00.000Z", "the clock still answers");
});

// ── the escrow reader, wired to the store the candle reads ──────────────────
// A pool stand-in for the two statements `docketEscrow` issues — the shape
// test/stake-held.test.mjs uses. Throws on anything else.
const escrowPool = ({ head = HEAD, rows = null }) => ({
  async query(text, params) {
    const t = String(text).replace(/\s+/g, " ").trim();
    if (/FROM projection_heads WHERE repo = 'town'/.test(t)) return { rows: head ? [{ sha: head }] : [] };
    if (/to_regclass\('public\.escrow_projection'\)/.test(t)) return { rows: [{ ok: rows !== "no-table" }] };
    if (/FROM escrow_projection WHERE town_sha = \$1/.test(t)) {
      assert.equal(params[0], head, "the projection is read AT the town head — the sha the next crossing judges on");
      return { rows: rows === "no-table" ? [] : (rows ?? []) };
    }
    throw new Error(`escrowPool: unmodelled statement — "${t.slice(0, 90)}"`);
  },
});

test("the segment's escrow is `escrow_projection` at projection_heads['town'], through the candle's own reader", async () => {
  const { escrowAtTownHead } = await import("../src/world2-serve.mjs");
  const p = escrowPool({ rows: [{ mark: "berthillon/cone-coing", n: 2 }, { mark: "berthillon/the-orchard-bench", n: 0 }] });
  const seg = await stakesFor(["berthillon"], readers({ escrow: () => escrowAtTownHead({ p }) }));
  assert.equal(seg.escrow_at_town_sha, HEAD);
  assert.equal(seg.rows[0].mark, "berthillon/the-orchard-bench");
  assert.equal(seg.rows[0].escrow, 0);
  assert.equal(seg.rows.find((r) => r.mark === "berthillon/cone-coing").escrow, 2);
  // no head ingested → refused, disclosed
  const noHead = await stakesFor(["berthillon"], readers({ escrow: () => escrowAtTownHead({ p: escrowPool({ head: null }) }) }));
  assert.match(noHead.unavailable, /no town sha is ingested/);
  assert.equal(noHead.at_risk, null);
});

// ── the doors ───────────────────────────────────────────────────────────────

test("the manifest names ten, `stakes` is the ninth, and `household read: \"stakes\"` is a real door — advertised, accepted, fielded", () => {
  // ten since 2026-09-28: `posts` (POS-293) joined after it
  assert.equal(DOORSTEP_SEGMENTS.length, 10);
  assert.equal(DOORSTEP_SEGMENTS.at(8), "stakes");
  assert.ok(HOUSEHOLD_READABLE.includes("stakes"), "the door accepts it");
  assert.ok(HOUSEHOLD_READ_ENUM.includes("stakes"), "and the tool schema advertises it");
  assert.deepEqual(HOUSEHOLD_READ_FIELDS.stakes, {}, "it takes no field but the standpoint handle");
  assert.match(HOUSEHOLD_READS.stakes, /Not the pot stake/, "the gloss keeps it apart from do: \"stake\" and read: \"stamps\"");
  assert.equal(REGISTRY_PATH, "WORLD/settlement-publications.json", "the sweep's own file");
});

test("the finished doorstep carries the segment, always — serves, args, and the domain — on both skins", async () => {
  const { doorstepBundle } = await import("../src/doorstep-bundle.mjs");
  const dir = mkdtempSync(join(tmpdir(), "pm-stakes-"));
  const dbPath = join(dir, "fixture.db");
  fixtureDb(dbPath).close();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const meta = { as_of: "fixturesha000000000000000000000000000000" };
    const ctx = { db, key: null, meta, asOf: meta.as_of, canWrite: false, clone: null, pen: null, odb: null, dbPath: null };
    for (const slim of [false, true]) {
      const d = await doorstepBundle("wright", { ...ctx, slim });
      assert.ok(d.segments.includes("stakes"));
      assert.equal(d.stakes.serves, "household.stakes");
      assert.deepEqual(d.stakes.args, { handle: "wright" });
      assert.ok(Array.isArray(d.stakes.rows));
      assert.ok(typeof d.stakes.next_settlement?.at === "string");
      assert.ok("at_risk" in d.stakes);
      assert.equal(d.stakes.clock, SETTLEMENT_CLOCK, "the clock — a disclosure — rides both skins");
      if (slim) {
        // THE CONNECTOR SKIN CUTS THE TEACHING, the stances idiom: the rule and
        // the pointers are dropped, the door is named, the cut is said.
        assert.equal(d.stakes.rule, undefined, "no `rule` on this skin at all");
        assert.equal(d.stakes.read_the_rest, undefined);
        assert.match(d.stakes.teach_at, /household \{ read: "stakes" \}/);
        assert.match(d.stakes.abridged, /drops `rule` and `read_the_rest`/);
      } else {
        assert.match(d.stakes.rule, /commons needs escrow > 0/, "REST answers the read whole — the bundle law");
        assert.equal(d.stakes.teach_at, undefined);
      }
    }
  } finally { db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
