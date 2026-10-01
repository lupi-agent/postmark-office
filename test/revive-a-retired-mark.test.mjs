// revive-a-retired-mark.test.mjs — A RETIRED ROW NEVER HOLDS A NAME (POS-241 phase 1, part 1).
//
//   EMBEDDED_PG_DIR=<dir holding embedded-postgres> node --test test/revive-a-retired-mark.test.mjs
//
// THE INSTANCE. At 06:00Z 2026-09-26 window 212 held a claim re-leaving
// `mari/first-night-garland`, a slug still carried by her RETIRED row (withdrawn
// 09-25, retired at window 211). Step 1 of the clearing asked only about STANDING
// rows, step 6 INSERTed a second row under the slug, `marks.slug` is UNIQUE across
// every status — `marks_slug_key` — and the whole window rolled back: no S83.
//
// THE RULING (Keemin, 2026-09-26, docs/2026-09-26/design-notes/pos-241-one-id-for-life.md
// § Rulings 3–4 and the clarification): a mark keeps one id for life. A leave-mark
// or an amend on the author's OWN retired slug revives that row — the same id,
// standing again, the new claim's record — ruled at the clearing like a new mark.
// There is only ever one row for a slug, so the slug stays unique.
//
// THE RIG. A real Postgres (test/helpers/embedded-store.mjs) with the whole
// schema, and the real `clearing-job.mjs` run as a child under the `clearing_job`
// pen, because the job connects at import and the failure is a constraint only
// Postgres raises. No stub can stand in for `marks_slug_key`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");

const RETIRED_ID = "d09fb94d-035f-4ef9-9204-368bc0c1c96c"; // the garland's retired row, as on prod
const SLUG = "mari/first-night-garland";
const TOWN_SHA = "t".repeat(40);
const LAW_SHA = "l".repeat(40);

const store = await startStore({ db: "revive_test" });
const skip = store.skip ?? false;

/** One fresh store state per test: windows 209–211 closed, 212 open, mari housed, the garland retired at 211. */
async function seed({ retiredOwner = "mari" } = {}) {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [209, 210, 211, 212]) {
      const opens = new Date(Date.UTC(2026, 8, 24, 18) + (id - 209) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === 212 ? "open" : "closed", id === 212 ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by)
       VALUES ('mari', 0, 'Mari', ARRAY['mari'], '2026-08-01', 'mari'),
              ('other', 1, 'Other', ARRAY['other'], '2026-08-01', 'other')`);
    await c.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned)
       VALUES ('mari', 'mari', 101, '2026-08-01'), ('other', 'other', 102, '2026-08-01')`);
    const geometry = (at) => JSON.stringify({ slug: SLUG, at, extent: { w: 2, h: 2 } });
    // The row's first life: locked at 209, retired at 211.
    await c.query(
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, retired_window, data)
       VALUES ($1, $2, 'sited', $3, $4, 'A garland over the door.', $5, box(point(10,10), point(12,12)),
               'retired', 209, 211, '{"tier":"commons"}')`,
      [RETIRED_ID, SLUG, retiredOwner, `hh:${retiredOwner}`, geometry({ x: 10, y: 10 })]);
    // The re-leave: mari leaves it again, at the Snug, in the open window.
    const { rows: [claim] } = await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
       VALUES (212, 'sited', 'mari', 'mari', 'pending', 'A garland, again, at the Snug.', $1,
               box(point(40,40), point(42,42)), 0, '{"date":"2026-09-26"}', $2)
       RETURNING id::text`,
      [geometry({ x: 40, y: 40 }), SLUG]);
    // Somebody's stamps behind it, so step 5.5's commons gate passes and the test reads the slug alone.
    await c.query(
      `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
       VALUES ($1, $2, 'mari', 'hh:mari', 'hh:mari', 1, 1)`, [TOWN_SHA, SLUG]);
    return claim.id;
  } finally { await c.end(); }
}

function clear(windowId = 212) {
  const r = spawnSync(process.execPath, [JOB, "--window", String(windowId)], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WORLD2_CLEARING_URL: store.url("clearing_job") },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

async function read(sql, args = []) {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, args)).rows; } finally { await c.end(); }
}

test("a re-leave of the author's own retired slug clears the window and revives the SAME row", { skip }, async () => {
  const claimId = await seed();
  const run = clear();
  assert.equal(run.code, 0, `the clearing must run — on 09-26 it rolled back on marks_slug_key:\n${run.out}`);
  assert.doesNotMatch(run.out, /marks_slug_key/);

  const marks = await read("SELECT id::text, status, locked_window, retired_window, owner, body, geometry FROM marks WHERE slug = $1", [SLUG]);
  assert.equal(marks.length, 1, "one row for the slug, ever — the slug stays unique because there is only one row");
  const [m] = marks;
  assert.equal(m.id, RETIRED_ID, "the SAME id: a mark keeps one id for life (ruling 4)");
  assert.equal(m.status, "standing");
  assert.equal(m.locked_window, 212, "this version of the record was ruled at window 212");
  assert.equal(m.retired_window, null, "a standing row carries no retirement");
  assert.equal(m.body, "A garland, again, at the Snug.", "the new claim's record, not the old one");
  assert.deepEqual(m.geometry.at, { x: 40, y: 40 });

  const [claim] = await read("SELECT status, refusal_check FROM claims WHERE id = $1", [claimId]);
  assert.equal(claim.status, "locked", claim.refusal_check ?? "");

  // THE HISTORY STAYS READABLE. The row now says what is true today; the window
  // that revived it says what it overwrote, so the retirement at 211 is not lost.
  const [w] = await read("SELECT status, receipts FROM windows WHERE id = 212");
  assert.equal(w.status, "closed");
  assert.deepEqual(w.receipts.revived, [{ slug: SLUG, id: RETIRED_ID, retired_window: 211, locked_window_before: 209 }]);
  const [old] = await read("SELECT count(*)::int AS n FROM claims WHERE slug = $1", [SLUG]);
  assert.equal(old.n, 1, "the claim rows are untouched: the re-leave is its own locked claim");
});

test("a retired slug held by ANOTHER resident's row refuses the claim by name, and the window still clears", { skip }, async () => {
  const claimId = await seed({ retiredOwner: "other" });
  const run = clear();
  assert.equal(run.code, 0, `one claim must never roll a whole window back:\n${run.out}`);
  const [claim] = await read("SELECT status, refusal_check FROM claims WHERE id = $1", [claimId]);
  assert.equal(claim.status, "refused");
  assert.match(claim.refusal_check, /^duplicate: a retired mark of other carries this slug/);
  const [m] = await read("SELECT id::text, status, owner FROM marks WHERE slug = $1", [SLUG]);
  assert.deepEqual(m, { id: RETIRED_ID, status: "retired", owner: "other" }, "another's retired row is not revived for you");
  const [w] = await read("SELECT status, receipts FROM windows WHERE id = 212");
  assert.equal(w.status, "closed");
  assert.equal(w.receipts.revived, undefined, "nothing revived, so the receipt carries no revived list");
});

// ── THE WITHDRAW HALF: a withdraw of a retired mark is refused by name ───────
//
// Read through the door's own store question (`markStandingStatus`, the stake
// door's reader) against the same Postgres, so the three states are the store's
// answers and not a hand-built object: retired with a re-leave on the docket,
// retired with nothing pending, and standing again after the revive.

test("a withdraw of a retired mark is refused by name, and only while nothing revives it", { skip }, async () => {
  const { markStandingStatus, withdrawRetiredRefusal, __setPoolForTest } = await import("../src/world2-claims.mjs");
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: store.url("office_api"), max: 1 });
  __setPoolForTest(pool);
  const env = { WORLD2_CANDLE: "1", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") };
  const ask = async () => withdrawRetiredRefusal(SLUG, await markStandingStatus({ slug: SLUG }, env));
  try {
    const claimId = await seed();
    assert.equal(await ask(), null, "a re-leave pending on the open docket is not 'already retired' — withdraw retracts it");

    const c = await store.connect("world2_owner");
    try { await c.query("UPDATE claims SET status = 'retracted', decided_at = now() WHERE id = $1", [claimId]); }
    finally { await c.end(); }
    assert.deepEqual(await ask(), {
      code: 409, defect: `"${SLUG}" is already retired at window 211`,
      hint: "there is nothing standing to withdraw — leave it again to bring it back: the same mark, the same id, ruled at the next crossing",
    });

    await seed();
    assert.equal(clear().code, 0);
    assert.equal(await ask(), null, "revived, it stands: a withdraw of it is an ordinary withdraw");
  } finally {
    __setPoolForTest(null);
    await pool.end();
  }
});

test("the withdraw door asks the store before it says 'no mark in your world'", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(ROOT, "src", "world.mjs"), "utf8");
  const arm = src.slice(src.indexOf("async function journalWithdraw"), src.indexOf("no mark \"${id}\" in your world"));
  assert.match(arm, /withdrawRetiredRefusal\(id, await markStandingStatus\(\{ slug: id \}\)/,
    "the 404 arm consults the retired-mark refusal first");
  assert.match(arm, /if \(retired\) throw bounce\(retired\.code, retired\.defect, retired\.hint\)/);
});

test.after(async () => { if (!skip) await store.stop(); });
