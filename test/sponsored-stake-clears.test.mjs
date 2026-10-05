// sponsored-stake-clears.test.mjs — A STAKE IS JUDGED FROM ITS OWN RECORD (POS-411).
//
//   EMBEDDED_PG_DIR=<dir holding embedded-postgres> node --test test/sponsored-stake-clears.test.mjs
//
// THE INSTANCE. Window 231 (18:00Z 2026-10-05) refused
// `special-delibry/the-starling-house-mailbox` (claim b7b786f1) with
// `insufficient-stamps: staked 1, liquid 0 at town d418a8ae`. Lyra
// (`wayward-archivist`) had staked 1 on it, the ledger had moved her stamp, and
// the window's own escrow_projection held `wayward-archivist · 1` on the mark.
// The same window refused three lu-yu claims, `staked 3, liquid 0`: two of them
// were each backed by a stamp lu-yu had already moved into escrow, and the third
// had no stake line at all.
//
// THE CAUSE. Step 3 summed `claims.stake` per CLAIMANT and asked
// `stamp_projection` for the claimant's LIQUID balance. The promotion writes the
// number the staker asked onto the AUTHOR's claim (`promoteDraftOnStake`,
// `stake = GREATEST(stake, n)`), and a stake the ledger already moved has left
// liquid for escrow. So the author was judged for stamps somebody else spent,
// and a stake already in escrow was counted against the liquid it had left.
//
// THE RIG. A real Postgres (test/helpers/embedded-store.mjs) with the whole
// schema; the promotion driven in-process through the door's own function under
// `office_api`; the escrow and balances seeded as stamp-ingest projects the
// ledger lines; and the real `clearing-job.mjs` run as a child under the
// `clearing_job` pen, as revive-a-retired-mark.test.mjs does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");

const TOWN_SHA = "d".repeat(40);
const LAW_SHA = "l".repeat(40);
const OPEN = 231;

const store = await startStore({ db: "sponsored_stake_test" });
const skip = store.skip ?? false;

/**
 * Windows 230 closed and 231 open; two households: `house` (special-delibry and
 * lyra, the instance's household) and `other` (neth); lu-yu housed alone.
 * `balances` is stamp_projection at the window's town sha, AFTER the ledger's
 * stake lines (liquid: what a stake moved is in escrow, not here).
 */
async function seed({ balances = {}, escrow = [] } = {}) {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE escrow_projection, stamp_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [OPEN - 1, OPEN]) {
      const opens = new Date(Date.UTC(2026, 9, 4, 18) + (id - (OPEN - 1)) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === OPEN ? "open" : "closed", id === OPEN ? null : opens]);
    }
    await c.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now())", [LAW_SHA, TOWN_SHA]);
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by)
       VALUES ('house', 0, 'The House', ARRAY['special-delibry','lyra'], '2026-08-01', 'lyra'),
              ('other', 1, 'Other', ARRAY['neth'], '2026-08-01', 'neth'),
              ('yu', 2, 'Yu', ARRAY['lu-yu'], '2026-08-01', 'lu-yu')`);
    await c.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned)
       VALUES ('special-delibry', 'special-delibry', 201, '2026-08-01'), ('lyra', 'lyra', 202, '2026-08-01'),
              ('neth', 'neth', 203, '2026-08-01'), ('lu-yu', 'lu-yu', 204, '2026-08-01')`);
    for (const [handle, balance] of Object.entries(balances))
      await c.query("INSERT INTO stamp_projection (town_sha, handle, household, balance) VALUES ($1, $2, $3, $4)",
        [TOWN_SHA, handle, null, balance]);
    for (const { mark, holder, household, own, n } of escrow)
      await c.query(
        `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
         VALUES ($1, $2, $3, $4, $5, $6, 1)`, [TOWN_SHA, mark, holder, household, own, n]);
  } finally { await c.end(); }
}

/** A sited mark on the commons, as the pen files it: `<by>/<slug>`, its geometry and box. */
async function file({ by, slug, x, status = "pending", stake = 0, household }) {
  const c = await store.connect("world2_owner");
  try {
    const id = `${by}/${slug}`;
    const { rows: [row] } = await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
       VALUES ($1, 'sited', $2, $3, $4, 'a mark on the commons', $5, box(point($6, $6), point($6 + 1, $6 + 1)), $7,
               '{"date":"2026-10-05"}', $8)
       RETURNING id::text`,
      [OPEN, by, household, status, JSON.stringify({ slug: id, at: { x, y: x }, extent: { w: 1, h: 1 } }), x, stake, id]);
    return row.id;
  } finally { await c.end(); }
}

function clear(windowId = OPEN) {
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

const outcome = async (id) => (await read("SELECT status, refusal_check FROM claims WHERE id = $1", [id]))[0];

// ── THE INSTANCE: a housemate's stake puts the author's draft forward ────────

test("SAME HOUSEHOLD · Lyra's stake puts special-delibry's draft forward, and the clearing locks it on her escrow", { skip }, async () => {
  await seed({
    // After the ledger line `wayward-archivist → stake:world-mark/… · 1`: the
    // author never held a stamp, and Lyra's one is in escrow now.
    balances: { "special-delibry": 0, lyra: 29 },
    // The instance's town spelled the author's household apart from Lyra's
    // (no house-key line yet), so the escrow row carries two households.
    escrow: [{ mark: "special-delibry/the-starling-house-mailbox", holder: "lyra", household: "hh:house", own: "gh:201", n: 1 }],
  });
  const draft = await file({ by: "special-delibry", slug: "the-starling-house-mailbox", x: 10, status: "draft", household: "hh:house" });

  // THE DOOR'S OWN WRITE: the stake door promotes as `actor: by` (the author) in
  // the STAKER's household, with the number the staker asked.
  const { promoteDraftOnStake, __setPoolForTest } = await import("../src/world2-claims.mjs");
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: store.url("office_api"), max: 1 });
  __setPoolForTest(pool);
  try {
    const env = { WORLD2_CANDLE: "1", WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") };
    const out = await promoteDraftOnStake({ actor: "special-delibry", householdName: "lyra", slug: "special-delibry/the-starling-house-mailbox", stamps: 1 }, env);
    assert.equal(out.promoted, true, "a housemate's stake reaches the draft through the row policy");
  } finally { __setPoolForTest(null); await pool.end(); }

  const [row] = await read("SELECT claimant, stake, status FROM claims WHERE id = $1", [draft]);
  assert.deepEqual(row, { claimant: "special-delibry", stake: 1, status: "pending" },
    "the measured premise: the claim carries the sponsor's stake under the AUTHOR's name, and nothing on it names Lyra");

  const run = clear();
  assert.equal(run.code, 0, run.out);
  const o = await outcome(draft);
  assert.equal(o.status, "locked",
    `Lyra's stamp is in escrow on this mark, so the mark is backed — the author's liquid is not the question (${o.refusal_check})`);
});

test("CROSS HOUSEHOLD · neth put his own last stamp forward and Lyra added two; the clearing locks it on the escrow", { skip }, async () => {
  await seed({
    balances: { neth: 0, lyra: 28 },
    escrow: [
      { mark: "neth/a-bench-by-the-quay", holder: "neth", household: "hh:other", own: "hh:other", n: 1 },
      { mark: "neth/a-bench-by-the-quay", holder: "lyra", household: "hh:house", own: "hh:other", n: 2 },
    ],
  });
  // Put forward with neth's own stake of 1. Lyra's later stake joined the
  // pending claim on the docket, which moves the ledger and never the row.
  const id = await file({ by: "neth", slug: "a-bench-by-the-quay", x: 20, stake: 1, household: "hh:other" });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  const o = await outcome(id);
  assert.equal(o.status, "locked",
    `three stamps stand in escrow behind it; a stake the ledger already moved is backed (${o.refusal_check})`);
});

// ── lu-yu's three: two the same bug, one genuinely unfunded ──────────────────

test("LU-YU · two claims backed by stamps already in escrow lock; the one the ledger never moved is refused", { skip }, async () => {
  await seed({
    // lu-yu held 2 (two welcome mints), staked 1 on each of two marks, and had
    // nothing left for the third: no ledger line, no escrow row.
    balances: { "lu-yu": 0 },
    escrow: [
      { mark: "lu-yu/yu-tai", holder: "lu-yu", household: "hh:yu", own: "hh:yu", n: 1 },
      { mark: "lu-yu/call-it-yu-tai", holder: "lu-yu", household: "hh:yu", own: "hh:yu", n: 1 },
    ],
  });
  const a = await file({ by: "lu-yu", slug: "yu-tai", x: 30, stake: 1, household: "hh:yu" });
  const b = await file({ by: "lu-yu", slug: "call-it-yu-tai", x: 32, stake: 1, household: "hh:yu" });
  const datum = await file({ by: "lu-yu", slug: "yu-tai-datum", x: 34, stake: 1, household: "hh:yu" });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  assert.equal((await outcome(a)).status, "locked", "its stamp is in escrow");
  assert.equal((await outcome(b)).status, "locked", "its stamp is in escrow");
  const d = await outcome(datum);
  assert.equal(d.status, "refused", "nothing moved for this one, and lu-yu has no liquid to back it");
  assert.match(d.refusal_check, /^insufficient-stamps: /, "the same check name, so the receipt still answers `unbacked`");
  assert.match(d.refusal_check, /staked 1, held 0, liquid 0 at town dddddddd$/,
    "the sentence names only the stake that is not in escrow, and the liquid it was judged against");
});

test("A STAKE NOT YET IN THE LEDGER is still judged against the claimant's liquid, summed over their window", { skip }, async () => {
  // The pinned town read can precede a stake's ledger line. Then nothing is in
  // escrow, and liquid is the question, exactly as before: lyra holds 1 and has
  // asked 1 on each of two marks, so both are short together.
  await seed({
    balances: { lyra: 1 },
    escrow: [{ mark: "lyra/elsewhere", holder: "lyra", household: "hh:house", own: "hh:house", n: 5 }],
  });
  const a = await file({ by: "lyra", slug: "a-lamp", x: 40, stake: 1, household: "hh:house" });
  const b = await file({ by: "lyra", slug: "a-gate", x: 42, stake: 1, household: "hh:house" });
  const run = clear();
  assert.equal(run.code, 0, run.out);
  for (const id of [a, b]) {
    const o = await outcome(id);
    assert.equal(o.status, "refused");
    assert.equal(o.refusal_check, `insufficient-stamps: staked 2, held 0, liquid 1 at town dddddddd`,
      "escrow on ANOTHER mark backs nothing here: escrow is per mark");
  }
});

// ── the gate, pure ───────────────────────────────────────────────────────────

test("unbackedStakesAmong · escrow backs its own mark, the rest is judged against the claimant's liquid", async () => {
  const { unbackedStakesAmong } = await import("../world2/tools/escrow-presence.mjs");
  const claims = [
    { id: 1, slug: "a/one", claimant: "a", stake: 1 },   // backed by a sponsor
    { id: 2, slug: "a/two", claimant: "a", stake: 3 },   // 1 held, 2 short
    { id: 3, slug: "b/three", claimant: "b", stake: 2 }, // nothing held, b can cover it
    { id: 4, slug: "c/four", claimant: "c", stake: 0 },  // nothing asked
  ];
  const escrowByMark = new Map([["a/one", 1], ["a/two", 1]]);
  const liquidOf = new Map([["a", 1], ["b", 2]]);
  const v = unbackedStakesAmong(claims, { escrowByMark, liquidOf, townSha: "f".repeat(40) });
  assert.deepEqual(v.refused, [{ id: 2, slug: "a/two", check: "insufficient-stamps: staked 3, held 1, liquid 1 at town ffffffff" }]);
});

test("unbackedStakesAmong · an escrow that cannot be read is not zero escrow: every stake asks liquid, and it says so", async () => {
  const { unbackedStakesAmong } = await import("../world2/tools/escrow-presence.mjs");
  const v = unbackedStakesAmong([{ id: 1, slug: "a/one", claimant: "a", stake: 1 }],
    { escrowByMark: null, liquidOf: new Map([["a", 1]]), townSha: "f".repeat(40) });
  assert.deepEqual(v.refused, [], "the old rule exactly: liquid 1 covers a stake of 1");
  assert.equal(v.escrowUnread, true, "and the caller is told the escrow was not read");
});

test.after(async () => { if (!skip) await store.stop(); });
