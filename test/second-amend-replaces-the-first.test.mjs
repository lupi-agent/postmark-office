// second-amend-replaces-the-first.test.mjs — ONE PENDING CLAIM PER MARK PER WINDOW (POS-241 phase 1, part 2).
//
//   EMBEDDED_PG_DIR=<dir holding embedded-postgres> node --test test/second-amend-replaces-the-first.test.mjs
//
// THE INSTANCE. Window 212 (2026-09-26) held two amends of the standing mark
// `wright/furnish-ferrys-waiting-room`. The door chained the second to the first
// (`supersedes` = the prior PENDING claim); the clearing's step 1 compared that to
// the standing mark's id — "a standing mark carries this slug, and this claim
// supersedes <prior>, which is not it" — and step 2 refused the first as
// superseded. NEITHER applied.
//
// THE RULING (Keemin, 2026-09-26, ruling 1): "a second amend in one window
// replaces the first". The newer pending amend retracts the older at filing
// (reason `replaced`) and supersedes the standing mark directly.
//
// THE RIG. A real Postgres with the whole schema; the door's own
// `claimTxFromJournal` inside `withHousehold` as `office_api` (so 007's
// transition guard and 024's row policies rule on the retraction), and the real
// `clearing-job.mjs` as `clearing_job`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");

const MARK_ID = "04855cf2-0000-4000-8000-000000000212";
const SLUG = "wright/furnish-ferrys-waiting-room";
const TOWN_SHA = "t".repeat(40);
const LAW_SHA = "l".repeat(40);

const store = await startStore({ db: "amend_test" });
const skip = store.skip ?? false;

async function seed() {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE acts, stamp_projection, escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [210, 211, 212]) {
      const opens = new Date(Date.UTC(2026, 8, 25, 6) + (id - 210) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === 212 ? "open" : "closed", id === 212 ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by)
                   VALUES ('wright', 0, 'Wright', ARRAY['wright'], '2026-08-01', 'wright')`);
    await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('wright', 'wright', 201, '2026-08-01')`);
    // The mark's id is the claim that locked it (001: `claims.supersedes` REFERENCES claims).
    await c.query(
      `INSERT INTO claims (id, window_id, class, claimant, household, status, body, geometry, bbox, stake, slug, decided_at)
       VALUES ($1, 210, 'sited', 'wright', 'wright', 'locked', 'A bench.', $3, box(point(5,5), point(7,7)), 0, $2, now())`,
      [MARK_ID, SLUG, JSON.stringify({ slug: SLUG, at: { x: 5, y: 5 }, extent: { w: 2, h: 2 } })]);
    await c.query(
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
       VALUES ($1, $2, 'sited', 'wright', 'hh:wright', 'A bench.', $3, box(point(5,5), point(7,7)), 'standing', 210, '{"tier":"commons"}')`,
      [MARK_ID, SLUG, JSON.stringify({ slug: SLUG, at: { x: 5, y: 5 }, extent: { w: 2, h: 2 } })]);
    await c.query("INSERT INTO stamp_projection (town_sha, handle, household, balance) VALUES ($1, 'wright', 'hh:wright', 5)", [TOWN_SHA]);
    await c.query(
      `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
       VALUES ($1, $2, 'wright', 'hh:wright', 'hh:wright', 1, 1)`, [TOWN_SHA, SLUG]);
  } finally { await c.end(); }
}

/** One act through the door's own candle arm, in a household transaction, as office_api. */
async function file(mod, pool, { body, seq, put_forward = true, stamps }) {
  const row = {
    // A journal row as the door writes one (world-journal's shape), on the store's open window.
    action: "amend", actor: "wright", object: SLUG, class: "mark", crossing: 212, at: new Date().toISOString(),
    payload: JSON.stringify({ slug: "furnish-ferrys-waiting-room", by: "wright", kind: "sited", body,
      at: { x: 5, y: 5 }, extent: { w: 2, h: 2 }, put_forward, ...(stamps == null ? {} : { stamps }) }),
  };
  // The key the door files under is the registry's own spelling (`householdKeyFor`), never the handle.
  const household = await mod.householdKeyFor(pool, "wright");
  await mod.withHousehold(pool, household, (c) => mod.claimTxFromJournal(c, row, seq, { household }));
}

function clear() {
  const r = spawnSync(process.execPath, [JOB, "--window", "212"], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

async function read(sql, args = []) {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
}

async function withDoor(fn) {
  const mod = await import("../src/world2-claims.mjs");
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: store.url("office_api"), max: 2 });
  mod.__setPoolForTest(pool);
  try { return await fn(mod, pool); } finally { mod.__setPoolForTest(null); await pool.end(); }
}

test("two amends of a standing mark in one window: the second locks, the first reads retracted/replaced", { skip }, async () => {
  await seed();
  await withDoor(async (mod, pool) => {
    await file(mod, pool, { body: "A bench and a lamp.", seq: 1 });
    await file(mod, pool, { body: "A bench, a lamp, and a rug.", seq: 2 });
  });
  const claims = await read(
    "SELECT body, status, refusal_check, supersedes::text FROM claims WHERE slug = $1 AND window_id = 212 ORDER BY submitted_at", [SLUG]);
  assert.equal(claims.length, 2);
  assert.deepEqual(claims.map((c) => c.status), ["retracted", "pending"], "replaced at filing, before any clearing");
  assert.match(claims[0].refusal_check, /^replaced: /);
  assert.equal(claims[1].supersedes, MARK_ID, "the second supersedes the STANDING mark directly");

  const run = clear();
  assert.equal(run.code, 0, run.out);
  const after = await read("SELECT body, status, refusal_check FROM claims WHERE slug = $1 AND window_id = 212 ORDER BY submitted_at", [SLUG]);
  assert.deepEqual(after.map((c) => c.status), ["retracted", "locked"],
    `on 09-26 both were refused: ${after.map((c) => c.refusal_check).join(" | ")}`);
  const [m] = await read("SELECT id::text, body, locked_window FROM marks WHERE slug = $1", [SLUG]);
  assert.deepEqual(m, { id: MARK_ID, body: "A bench, a lamp, and a rug.", locked_window: 212 }, "the resident's latest word is the mark");
  const [w] = await read("SELECT status, receipts->'six_count' AS six FROM windows WHERE id = 212");
  assert.equal(w.status, "closed", "the clearing never rolls back");
  assert.equal(w.six.retracted_before_close, 1);
});

test("a draft amend put forward by a stake replaces the pending amend too", { skip }, async () => {
  await seed();
  await withDoor(async (mod, pool) => {
    await file(mod, pool, { body: "A bench and a lamp.", seq: 1 });
    await file(mod, pool, { body: "A bench under the window.", seq: 2, put_forward: false });
    const env = { WORLD2_CANDLE: "1", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") };
    const out = await mod.promoteDraftOnStake({ actor: "wright", householdName: "wright", slug: SLUG, stamps: 1 }, env);
    assert.equal(out.promoted, true);
  });
  const claims = await read("SELECT body, status, refusal_check FROM claims WHERE slug = $1 AND window_id = 212 ORDER BY submitted_at", [SLUG]);
  assert.deepEqual(claims.map((c) => [c.body, c.status]),
    [["A bench and a lamp.", "retracted"], ["A bench under the window.", "pending"]]);
  assert.match(claims[0].refusal_check, /^replaced: /);
  assert.equal(clear().code, 0);
  const ruled = await read("SELECT status, refusal_check FROM claims WHERE slug = $1 AND window_id = 212 ORDER BY submitted_at", [SLUG]);
  assert.deepEqual(ruled.map((c) => c.status), ["retracted", "locked"], JSON.stringify(ruled));
  const [m] = await read("SELECT body FROM marks WHERE slug = $1", [SLUG]);
  assert.equal(m.body, "A bench under the window.");
});

test("a private draft replaces nothing: the pending amend still stands on the docket", { skip }, async () => {
  await seed();
  await withDoor(async (mod, pool) => {
    await file(mod, pool, { body: "A bench and a lamp.", seq: 1 });
    await file(mod, pool, { body: "Thinking about a rug.", seq: 2, put_forward: false });
  });
  const rows = await read("SELECT status FROM claims WHERE slug = $1 AND window_id = 212 ORDER BY submitted_at", [SLUG]);
  assert.deepEqual(rows.map((r) => r.status), ["pending", "draft"]);
});

test.after(async () => { if (!skip) await store.stop(); });
