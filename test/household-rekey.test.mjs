// household-rekey.test.mjs — ONE KEY PER HOUSEHOLD IN THE STORE (Darko,
// 2026-10-05): world2/tools/household-rekey.mjs re-keys every row to its house's
// live `hh:` key, 068 keeps the ledger, and 069 makes every household column
// refuse any other spelling.
//
// The instance, in miniature (POS-406): a resident's parcel stored under a
// `gh:<id>` spelling and their shrine under the house's `hh:` key. The store's standing
// walk compares `_cred` exactly, so the shrine read `market` on her own parcel,
// and the clearing refused her amend `escrow-absent`.
//
// A real Postgres (test/helpers/embedded-store.mjs): the store's own guards,
// the triggers this tool has to pass, and 069's CHECKs only exist there.
//
//   node --test test/household-rekey.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";
import { applyRekey, rekeyPlan, householdColumns } from "../world2/tools/household-rekey.mjs";
import { computeStanding } from "../world2/tools/standing.mjs";

const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), "..", "world2", "schema");
const SQL_069 = readFileSync(join(SCHEMA, "069_household_one_key.sql"), "utf8");

const OLD_KEY = "gh:1001";
const HOUSE_A = "hh:house-a";

let store, owner;
before(async () => {
  store = await startStore({ db: "one_key" });
  owner = await store.connect("world2_owner");
});
after(async () => { await owner?.end().catch(() => {}); await store?.stop(); });

/** The store as it stood before 069: the one-key CHECKs are not there yet. */
async function beforeOneKey(q) {
  const { rows } = await q.query(
    `SELECT c.relname AS t, k.conname AS name FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      WHERE k.conname LIKE '%\\_one\\_key'`);
  for (const r of rows) await q.query(`ALTER TABLE "${r.t}" DROP CONSTRAINT "${r.name}"`);
}

const box = ({ x, y }, { w, h }) => `((${x + w / 2},${y + h / 2}),(${x - w / 2},${y - h / 2}))`;
let markN = 0;
async function mark(q, { slug, kind = "sited", owner: who, household, at, extent }) {
  const id = `00000000-0000-4000-8000-${String(++markN).padStart(12, "0")}`;
  await q.query(
    `INSERT INTO marks (id, slug, kind, owner, household, geometry, bbox, status, locked_window, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'standing', 1, '{}'::jsonb)`,
    [id, slug, kind, who, household, JSON.stringify({ slug, at, extent }), box(at, extent)]);
  return id;
}

async function seed(q) {
  await beforeOneKey(q);
  await q.query(`INSERT INTO windows (id, opens_at, closes_at, status) VALUES (1, now() - interval '1 day', now(), 'closed')`);
  await q.query(
    `INSERT INTO households (slug, ord, name, accounts, residents, since, declared_by) VALUES
       ('house-a', 0, 'House A', $1::jsonb, '{resident-a}', '2026-09-01', 'test'),
       ('house-b', 1, 'House B', '[]'::jsonb, '{resident-b,resident-c}', '2026-09-01', 'test')`,
    [JSON.stringify([{ login: "a-login", id: 1001 }])]);
  await mark(q, { slug: "the-town/let-there-be-light", owner: "the-town", household: "solo:the-town", at: { x: 0, y: 0 }, extent: { w: 320000, h: 320000 } });
  await mark(q, { slug: "resident-a/the-parcel", kind: "parcel", owner: "resident-a", household: OLD_KEY, at: { x: 100, y: 100 }, extent: { w: 25, h: 25 } });
  await mark(q, { slug: "resident-a/the-shrine", owner: "resident-a", household: HOUSE_A, at: { x: 102, y: 98 }, extent: { w: 3, h: 3 } });
  await mark(q, { slug: "resident-c/the-den", owner: "resident-c", household: "solo:resident-c", at: { x: -500, y: 40 }, extent: { w: 10, h: 12 } });
  // An act and a locked claim in old spellings: the two tables whose guards
  // refuse a household change (002 acts_append_only, 007 claims_update_guard).
  await q.query(
    `INSERT INTO acts (at, crossing, actor, action, class, household) VALUES (now(), 1, 'resident-a', 'leave-mark', 'mark', $1)`, [OLD_KEY]);
  await q.query(
    `INSERT INTO claims (window_id, class, claimant, household, status, slug) VALUES (1, 'sited', 'resident-a', 'solo:a-login', 'locked', 'resident-a/the-shrine')`);
}

const tiers = async (q) => {
  const { rows } = await q.query(
    `SELECT id::text, slug, kind, owner, household, geometry, parent::text, data FROM marks WHERE status = 'standing'`);
  return computeStanding(rows);
};

test("every household column in the store carries 069's one-key CHECK", async () => {
  const fresh = await store.connect("world2_owner", "one_key");
  try {
    const cols = await householdColumns(fresh);
    const { rows } = await fresh.query(`SELECT conname FROM pg_constraint WHERE conname LIKE '%\\_one\\_key'`);
    const have = new Set(rows.map((r) => r.conname));
    const missing = cols.map((c) => `${c.table}_${c.column}_one_key`).filter((n) => !have.has(n));
    assert.deepEqual(missing, [], "a household column without the CHECK: add it to 069's list");
    assert.ok(cols.length >= 15, `the catalogue names ${cols.length} household column(s)`);
  } finally { await fresh.end(); }
});

test("the re-key: every old spelling becomes its house's one key, through the guards, with a ledger, and the shrine stands home", async () => {
  await seed(owner);
  assert.equal((await tiers(owner)).get("resident-a/the-shrine"), "market",
    "before: the parcel's gh: spelling is not the shrine's hh: key, so the walk reads the shrine market (the instance)");

  const plan = await rekeyPlan(owner);
  assert.deepEqual(plan.refused, []);
  const moves = plan.moves.map((m) => `${m.table}.${m.column} ${m.from} -> ${m.to} x${m.rows}`).sort();
  assert.deepEqual(moves, [
    `acts.household ${OLD_KEY} -> ${HOUSE_A} x1`,
    `claims.household solo:a-login -> ${HOUSE_A} x1`,
    `marks.household ${OLD_KEY} -> ${HOUSE_A} x1`,
    "marks.household solo:resident-c -> hh:house-b x1",
  ]);
  assert.deepEqual(plan.kept.map((k) => `${k.table}.${k.column} ${k.key}`), ["marks.household solo:the-town"],
    "the town's interim key stands, by name");

  await applyRekey(owner);

  const { rows: left } = await owner.query(
    `SELECT 'marks' AS t, household FROM marks WHERE household NOT LIKE 'hh:%' AND household <> 'solo:the-town'
     UNION ALL SELECT 'acts', household FROM acts WHERE household NOT LIKE 'hh:%'
     UNION ALL SELECT 'claims', household FROM claims WHERE household NOT LIKE 'hh:%'`);
  assert.deepEqual(left, [], "no row is left in another spelling");
  assert.equal((await tiers(owner)).get("resident-a/the-shrine"), "home",
    "after: one key, so the shrine stands on its own household's parcel");

  const { rows: ledger } = await owner.query(`SELECT table_name, from_key, to_key, rows, ids FROM household_rekeys ORDER BY id`);
  assert.equal(ledger.length, 4, "one ledger row per (table, column, old key)");
  assert.ok(ledger.every((r) => r.rows === 1 && Array.isArray(r.ids) && r.ids.length === 1), "with the row ids, so the old spelling of each row is recoverable");

  const { rows: guards } = await owner.query(
    `SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN ('acts_append_only', 'claims_update_guard') ORDER BY 1`);
  assert.deepEqual(guards.map((g) => `${g.tgname}:${g.tgenabled}`), ["acts_append_only:O", "claims_update_guard:O"],
    "both guards are back on after the apply");
  await assert.rejects(owner.query(`UPDATE acts SET household = 'hh:x'`), /append-only/, "and the act guard holds again");

  const again = await rekeyPlan(owner);
  assert.deepEqual(again.moves, [], "idempotent: a second run finds nothing to re-key");
  await applyRekey(owner);
  assert.equal((await owner.query(`SELECT count(*)::int AS n FROM household_rekeys`)).rows[0].n, 4, "and writes nothing");

  // 069 lands now, and from here on the store refuses a second spelling itself.
  await owner.query(SQL_069);
  await assert.rejects(
    mark(owner, { slug: "resident-a/a-second-spelling", owner: "resident-a", household: OLD_KEY, at: { x: 104, y: 104 }, extent: { w: 1, h: 1 } }),
    /marks_household_one_key/, "a gh: spelling is refused at the write");
  await mark(owner, { slug: "the-town/a-town-mark", owner: "the-town", household: "solo:the-town", at: { x: 5, y: 5 }, extent: { w: 1, h: 1 } });
});

test("a spelling no house holds refuses the apply by name, and nothing is written; 069 refuses to land over it", async () => {
  const q = await store.connect("world2_owner");
  try {
    await beforeOneKey(q);
    await mark(q, { slug: "nobody/a-stray", owner: "nobody", household: "solo:nobody", at: { x: 900, y: 900 }, extent: { w: 2, h: 2 } });
    await mark(q, { slug: "resident-b/a-late-row", owner: "resident-b", household: "solo:resident-b", at: { x: 950, y: 950 }, extent: { w: 2, h: 2 } });
    const before = (await q.query(`SELECT count(*)::int AS n FROM household_rekeys`)).rows[0].n;
    await assert.rejects(applyRekey(q), /refused, nothing written: marks\.household solo:nobody \(no house holds this spelling\)/);
    assert.equal((await q.query(`SELECT household FROM marks WHERE slug = 'resident-b/a-late-row'`)).rows[0].household, "solo:resident-b",
      "the refusal took the whole apply with it: the resolvable row is untouched too");
    assert.equal((await q.query(`SELECT count(*)::int AS n FROM household_rekeys`)).rows[0].n, before);
    const { rows: guards } = await q.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('acts_append_only', 'claims_update_guard') AND tgenabled = 'O'`);
    assert.equal(guards[0].n, 2, "and the guards are on: the rollback took the DISABLE with it");
    await assert.rejects(q.query(SQL_069), /069 refuses: .*marks\.household: 2;/);
  } finally { await q.end(); }
});
