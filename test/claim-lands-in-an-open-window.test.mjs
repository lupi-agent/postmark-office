// claim-lands-in-an-open-window.test.mjs — A CLAIM MADE WHILE THE CLEARING RUNS IS
// JUDGED (POS-404, postmark-office#349).
//
//   node --test test/claim-lands-in-an-open-window.test.mjs
//
// THE RACE. The door read the open window with no lock. While the clearing held
// window N (`SELECT … FOR UPDATE`), the door still saw N as open, its INSERT's
// foreign-key check waited on the clearing's row lock, and once the clearing
// committed the claim went into N, which was now closed. The clearing had read
// its pending list before the claim existed, the next clearing reads only its own
// window, and the docket view hides closed windows: pending for good, never
// judged. The stake's promotion had it wider, because a draft put forward in the
// window it was composed in moves no `window_id`, so no key check waits at all.
//
// THE RIG. A real Postgres with the whole schema; the door's own
// `claimTxFromJournal` / `promoteDraftOnStake` as `office_api`, and the real
// `clearing-job.mjs` as `clearing_job`. The clearing is held mid-judgement by a
// row lock on the one claim it is judging, taken by this test as the owner; each
// step waits on `pg_locks` (visible to every role) rather than on a clock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");

const HELD_ID = "04855cf2-0000-4000-8000-000000000404";
const TOWN_SHA = "t".repeat(40);
const LAW_SHA = "l".repeat(40);

const store = await startStore({ db: "open_window_test" });
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
    await c.query("INSERT INTO stamp_projection (town_sha, handle, household, balance) VALUES ($1, 'wright', 'hh:wright', 5)", [TOWN_SHA]);
    // The claim the clearing is judging when the door arrives: the test holds its row.
    await c.query(
      `INSERT INTO claims (id, window_id, class, claimant, household, status, body, geometry, bbox, stake, slug)
       VALUES ($1, 212, 'sited', 'wright', 'hh:wright', 'pending', 'A bench.', $2, box(point(5,5), point(7,7)), 0, 'wright/a-bench')`,
      [HELD_ID, JSON.stringify({ slug: "wright/a-bench", at: { x: 5, y: 5 }, extent: { w: 2, h: 2 } })]);
  } finally { await c.end(); }
}

const leaveMark = (slug, { put_forward = true } = {}) => ({
  // A journal row as the door writes one (world-journal's shape).
  action: "leave-mark", actor: "wright", object: `wright/${slug}`, class: "mark", crossing: 212, at: new Date().toISOString(),
  payload: JSON.stringify({ slug, by: "wright", kind: "sited", body: "A lamp.",
    at: { x: 50, y: 50 }, extent: { w: 2, h: 2 }, put_forward }),
});

async function read(sql, args = []) {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
}

/** Resolves once `n` lock requests on the server are waiting (ungranted). */
async function waiting(n, { timeoutMs = 60_000 } = {}) {
  const c = await store.connect("world2_owner");
  try {
    for (const until = Date.now() + timeoutMs; Date.now() < until;) {
      const { rows: [r] } = await c.query("SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted");
      if (r.n >= n) return r.n;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    throw new Error(`fewer than ${n} lock waits after ${timeoutMs} ms`);
  } finally { await c.end(); }
}

/** The real clearing, as `clearing_job`, in the background. */
function clearing(windowId = 212) {
  const child = spawn(process.execPath, [JOB, "--window", String(windowId)], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  return new Promise((ok) => child.on("close", (code) => ok({ code, out })));
}

/** Holds the clearing mid-judgement: a row lock on the claim it is about to rule. */
async function holdTheClaim() {
  const t = await store.connect("world2_owner");
  await t.query("BEGIN");
  await t.query("SELECT id FROM claims WHERE id = $1 FOR UPDATE", [HELD_ID]);
  return { release: async () => { await t.query("ROLLBACK"); await t.end(); } };
}

async function withDoor(fn) {
  const mod = await import("../src/world2-claims.mjs");
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: store.url("office_api"), max: 3 });
  mod.__setPoolForTest(pool);
  try { return await fn(mod, pool); } finally { mod.__setPoolForTest(null); await pool.end(); }
}

async function file(mod, pool, row, seq, { inside = null } = {}) {
  const household = await mod.householdKeyFor(pool, "wright");
  return mod.withHousehold(pool, household, async (c) => {
    await mod.claimTxFromJournal(c, row, seq, { household });
    if (inside) await inside();
  });
}

const where = (slug) => read(
  `SELECT c.status, c.window_id, w.status AS window_status
     FROM claims c JOIN windows w ON w.id = c.window_id WHERE c.slug = $1`, [slug]);

test("a claim filed while the clearing holds the window lands in the next, open window, and stands on the docket", { skip }, async () => {
  await seed();
  await withDoor(async (mod, pool) => {
    const hold = await holdTheClaim();
    const cleared = clearing();
    await waiting(1); // the clearing holds window 212 and waits on the held claim
    const filed = file(mod, pool, leaveMark("a-lamp"), 1);
    // The door either waits behind the clearing or finishes; both are read below.
    await Promise.race([filed, waiting(2)]);
    await hold.release();
    const run = await cleared;
    assert.equal(run.code, 0, run.out);
    await filed;
  });
  const [lamp] = await where("wright/a-lamp");
  const docket = await read("SELECT window_id FROM docket WHERE geometry->>'slug' = 'wright/a-lamp'");
  // Base, 2026-10-05: {"status":"pending","window_id":212,"window_status":"closed"} and an empty docket.
  assert.deepEqual(lamp, { status: "pending", window_id: 213, window_status: "open" }, JSON.stringify(lamp));
  assert.deepEqual(docket, [{ window_id: 213 }], "the docket shows it");
  const [held] = await where("wright/a-bench");
  assert.equal(held.status, "locked", "the clearing judged what it was judging");
});

test("a draft put forward by a stake while the clearing holds its window lands in the next, open window", { skip }, async () => {
  await seed();
  await withDoor(async (mod, pool) => {
    // Composed in 212, so the promotion moves no window_id unless the door re-reads it.
    await file(mod, pool, leaveMark("a-rug", { put_forward: false }), 1);
    const hold = await holdTheClaim();
    const cleared = clearing();
    await waiting(1);
    const env = { WORLD2_CANDLE: "1", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") };
    const staked = mod.promoteDraftOnStake({ actor: "wright", householdName: "wright", slug: "wright/a-rug", stamps: 1 }, env);
    await Promise.race([staked, waiting(2)]);
    await hold.release();
    const run = await cleared;
    assert.equal(run.code, 0, run.out);
    const out = await staked;
    assert.equal(out.promoted, true);
    assert.equal(out.window, 213, "the stake names the window the claim joined");
  });
  const [rug] = await where("wright/a-rug");
  // Base, 2026-10-05: {"status":"pending","window_id":212,"window_status":"closed"}: the door never waited.
  assert.deepEqual(rug, { status: "pending", window_id: 213, window_status: "open" }, JSON.stringify(rug));
});

test("a claim already filing when the clearing starts is judged by that clearing (the clearing waits, nothing deadlocks)", { skip }, async () => {
  await seed();
  await withDoor(async (mod, pool) => {
    let open, written;
    const gate = new Promise((ok) => { open = ok; });
    const wrote = new Promise((ok) => { written = ok; });
    const filed = file(mod, pool, leaveMark("a-lamp"), 1, { inside: async () => { written(); await gate; } });
    await wrote; // the door's transaction is open, its claim written, not committed
    const cleared = clearing();
    await waiting(1); // the clearing waits for the door
    open();
    await filed;
    const run = await cleared;
    assert.equal(run.code, 0, run.out);
  });
  const [lamp] = await where("wright/a-lamp");
  assert.deepEqual(lamp, { status: "locked", window_id: 212, window_status: "closed" }, JSON.stringify(lamp));
  const marks = await read("SELECT slug, locked_window FROM marks WHERE slug = 'wright/a-lamp'");
  assert.deepEqual(marks, [{ slug: "wright/a-lamp", locked_window: 212 }]);
});

test("stranded-claims lists a claim pending in a closed window, read only, as snapshot_reader", { skip }, async () => {
  await seed();
  const own = await store.connect("world2_owner");
  try {
    // #349's shape, written by hand: pending in 211 (closed), submitted after 211 cleared.
    await own.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, stake, slug, submitted_at, data)
       VALUES (211, 'sited', 'wright', 'hh:wright', 'pending', 'A gate.', '{"slug":"wright/a-gate"}', 0, 'wright/a-gate',
               (SELECT cleared_at FROM windows WHERE id = 211) + interval '2 seconds', '{"_act_id":"9001"}')`);
  } finally { await own.end(); }
  const { strandedClaims, strandedLines } = await import("../world2/tools/stranded-claims.mjs");
  const reader = await store.connect("snapshot_reader");
  let rows;
  try { rows = await strandedClaims(reader); } finally { await reader.end(); }
  // The pending claim in the open window 212 is not stranded; the one in 211 is.
  assert.deepEqual(rows.map((r) => [r.slug, r.window_id, r.window_status, r.act_id, r.after_clearing]),
    [["wright/a-gate", 211, "closed", "9001", true]]);
  assert.match(strandedLines(rows).join("\n"), /^1 claim\(s\) pending in a window that is not open[\s\S]*AFTER its clearing \(#349\)/);

  const cli = (env) => new Promise((ok) => {
    const child = spawn(process.execPath, [join(ROOT, "world2", "tools", "stranded-claims.mjs")], {
      cwd: ROOT, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env } });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => ok({ code, out }));
  });
  const red = await cli({ WORLD2_PG_URL: store.url("snapshot_reader") });
  assert.equal(red.code, 1, red.out);
  assert.match(red.out, /wright\/a-gate · act 9001/);
  // 007 never deletes a row the docket carried; retracted, it is no longer pending.
  await read("UPDATE claims SET status = 'retracted', decided_at = now() WHERE slug = 'wright/a-gate'");
  const green = await cli({ WORLD2_PG_URL: store.url("snapshot_reader") });
  assert.equal(green.code, 0, green.out);
  assert.match(green.out, /^0 claims pending in a closed window/);
});

test.after(async () => { if (!skip) await store.stop(); });
