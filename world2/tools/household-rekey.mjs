#!/usr/bin/env node
// household-rekey.mjs: ONE KEY PER HOUSEHOLD IN THE STORE (Darko, 2026-10-05).
//
//   node world2/tools/household-rekey.mjs [--pg-url <url>]
//        [--dry-run]          the default: print every table, the old→new key per
//                             household and its row count; write nothing
//        [--apply [--prod]]   re-key them, in one transaction, as world2_owner
//
//   env: --pg-url, or PG* as `w2_pgenv` exports them. --apply refuses a database
//        whose name says neither "lab" nor "scratch" unless --prod is passed too
//        (position-snapshot.mjs's guard).
//
//   EXIT: 0 · nothing left to re-key (dry run) or re-keyed (apply)
//         1 · the dry run found rows to re-key, or a spelling it refuses
//         2 · cannot run (no store, wrong role, no 068 ledger)
//
// ── WHY ──────────────────────────────────────────────────────────────────────
//
// POS-160 RULING 4 left every row in the spelling it was written in and had the
// readers declare a house's whole spelling set (024_household_spellings.sql).
// The writers that do not read through that set compared one spelling exactly,
// and the store said two things about one house. The instance (POS-406): a resident's
// parcel was stored under a `gh:<id>` spelling and their shrines under the
// house's `hh:` key, so the store's standing walk (`_cred` compared exactly)
// read the shrines `market`, and the clearing refused an amend `escrow-absent`.
// Measured 2026-10-05 over the public marks read: 994 of 1,208 standing marks
// carried a gh:/solo: spelling, and 97 homes read `market` in the store and
// `home` in the world. The ruling ends the second spelling: every row is
// re-keyed to the house's one key, and 069_household_one_key.sql refuses any
// other spelling from then on.
//
// ── THE RESOLVER IS THE ONE THE READS ALREADY USE ───────────────────────────
//
// A spelling belongs to a house when the house's own spelling set holds it:
// `src/household-deriver.mjs § houseKeysOf`, the set 024's policies have
// compared against since POS-160, over the registry in THIS store
// (`houseRowsVia`). The live key is the set's first entry. A bare name, with no
// prefix, is asked of `houseKeyOfVia`, the resolver the door files a new row
// with. Nothing here decides what a spelling means; it inverts the set the reads
// already trust.
//
// It REFUSES BY NAME, and writes nothing, when a spelling is held by no house
// (an orphan) or by two (ambiguous). The one spelling it leaves standing is the
// town's own, `solo:the-town` (materialize.mjs § TOWN_HOUSEHOLD_BY_NAME), the
// interim Keemin approved on 2026-09-24 until the town-as-entity sitting.
//
// ── THE APPLY ────────────────────────────────────────────────────────────────
//
// One transaction. The plan is re-read inside it, after the guard triggers are
// disabled (ALTER TABLE takes the table's lock), so a row written between the
// dry run and the apply is re-keyed too, or refuses the apply by name.
//
// THE GUARDS: `claims_update_guard` (007) refuses a household change for every
// role but clearing_job, and `acts_append_only` (002) refuses any edit of an
// act. Both are disabled for this transaction only, by name, and re-enabled
// before COMMIT; the apply refuses to commit if either is still off. Every
// re-key is written to `household_rekeys` (068, append-only): table, column,
// old key, new key, rows, and the row ids, so the old spelling of any row is
// recoverable.
//
// IDEMPOTENT: a second run finds nothing to re-key and writes nothing.
//
// Handles and keys only: no body, no payload, no letter is read or printed.

import pg from "pg";
import { houseRowsVia, houseKeysOf, houseKeyOfVia, __clearHouseCache } from "../../src/household-deriver.mjs";
import { TOWN_HOUSEHOLD_BY_NAME } from "./materialize.mjs";

const LIVE = /^hh:/;

/**
 * The store's guard triggers this tool switches off for its own transaction,
 * by table. A table not named here keeps every trigger it has, so a guard
 * added later refuses this tool until someone names it here on purpose.
 */
export const REKEY_GUARDS = Object.freeze({
  acts: ["acts_append_only"],
  claims: ["claims_update_guard"],
});

/**
 * Every household-bearing column in the store: base tables only (the views
 * read through them), text columns named `household` or `own_household`.
 * Read from the catalogue, so a table added later is re-keyed without an edit.
 */
export async function householdColumns(q) {
  const { rows } = await q.query(
    `SELECT c.table_name AS table, c.column_name AS column
       FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND c.data_type = 'text' AND c.column_name IN ('household', 'own_household')
      ORDER BY 1, 2`);
  return rows;
}

/**
 * spelling → the house's live key, from every house's own spelling set.
 * `ambiguous` holds spellings two houses both claim; they are never mapped.
 */
export function spellingMap(registry, pins) {
  const houses = registry?.households ?? {};
  const to = new Map();
  const ambiguous = new Map();   // spelling → [live keys]
  for (const slug of Object.keys(houses)) {
    const keys = houseKeysOf(`hh:${slug}`, registry, pins);
    const live = keys[0];
    if (!live) continue;
    for (const k of keys.slice(1)) {
      if (k === live) continue;
      const was = to.get(k);
      if (was && was !== live) { ambiguous.set(k, [...new Set([...(ambiguous.get(k) ?? [was]), live])]); continue; }
      to.set(k, live);
    }
  }
  for (const k of ambiguous.keys()) to.delete(k);
  const liveKeys = new Set(Object.keys(houses).map((s) => `hh:${s}`));
  return { to, ambiguous, liveKeys };
}

/**
 * The plan: every (table, column, old key) that is not a live key, with the
 * key it becomes, or the reason it is refused.
 */
export async function rekeyPlan(q) {
  __clearHouseCache();
  const { registry, pins } = await houseRowsVia(q);
  const { to, ambiguous, liveKeys } = spellingMap(registry, pins);
  if (!liveKeys.size) throw Object.assign(new Error("the store's registry names no household; nothing can be re-keyed against it"), { exit: 2 });
  const moves = [];
  const refused = [];
  const kept = [];
  for (const { table, column } of await householdColumns(q)) {
    const { rows } = await q.query(
      `SELECT "${column}" AS key, count(*)::int AS rows FROM "${table}"
        WHERE "${column}" IS NOT NULL GROUP BY 1 ORDER BY 1`);
    for (const { key, rows: n } of rows) {
      if (liveKeys.has(key)) continue;
      if (key === TOWN_HOUSEHOLD_BY_NAME) { kept.push({ table, column, key, rows: n, why: "the town's interim key (materialize.mjs § TOWN_HOUSEHOLD_BY_NAME)" }); continue; }
      if (ambiguous.has(key)) { refused.push({ table, column, key, rows: n, why: `two houses hold this spelling: ${ambiguous.get(key).join(", ")}` }); continue; }
      // A BARE name (no prefix: an early act's household label) is asked of the
      // door's own resolver, the one `householdKeyFor` files a new row with.
      const live = to.get(key) ?? (key.includes(":") ? null : await houseKeyOfVia(q, key));
      if (!live) { refused.push({ table, column, key, rows: n, why: LIVE.test(key) ? "an hh: key no house is, or was" : "no house holds this spelling" }); continue; }
      moves.push({ table, column, from: key, to: live, rows: n });
    }
  }
  return { moves, refused, kept };
}

/** The plan, as the lines an operator reads: per table, then per household. */
export function planLines({ moves, refused, kept }) {
  const out = [];
  const byTable = new Map();
  for (const m of moves) {
    const k = `${m.table}.${m.column}`;
    byTable.set(k, (byTable.get(k) ?? 0) + m.rows);
  }
  out.push(`re-key: ${moves.reduce((a, m) => a + m.rows, 0)} row(s) in ${byTable.size} column(s), ${new Set(moves.map((m) => m.to)).size} household(s)`);
  for (const [k, n] of byTable) out.push(`  ${k}: ${n}`);
  const byHouse = new Map();
  for (const m of moves) {
    if (!byHouse.has(m.to)) byHouse.set(m.to, []);
    byHouse.get(m.to).push(m);
  }
  for (const [live, ms] of [...byHouse].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    out.push(`${live}`);
    for (const m of ms) out.push(`  ${m.from} → ${live}  ${m.table}.${m.column}: ${m.rows}`);
  }
  for (const r of refused) out.push(`REFUSED ${r.table}.${r.column} ${r.key} (${r.rows} row(s)): ${r.why}`);
  for (const r of kept) out.push(`kept ${r.table}.${r.column} ${r.key} (${r.rows} row(s)): ${r.why}`);
  return out;
}

const triggerEnabled = async (q, table, name) =>
  (await q.query(
    `SELECT t.tgenabled <> 'D' AS on FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = $1 AND t.tgname = $2`, [table, name])).rows[0]?.on ?? null;

const hasIdColumn = async (q, table) =>
  (await q.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id'`,
    [table])).rows.length > 0;

/**
 * Re-key, in one transaction. Returns the plan it applied. Throws, having
 * written nothing, when the plan refuses a spelling or a guard will not
 * re-enable.
 */
export async function applyRekey(q) {
  await q.query("BEGIN");
  try {
    const touched = Object.keys(REKEY_GUARDS);
    for (const table of touched)
      for (const name of REKEY_GUARDS[table])
        if ((await triggerEnabled(q, table, name)) !== null)
          await q.query(`ALTER TABLE "${table}" DISABLE TRIGGER "${name}"`);

    const plan = await rekeyPlan(q);
    if (plan.refused.length) {
      const e = new Error(`refused, nothing written: ${plan.refused.map((r) => `${r.table}.${r.column} ${r.key} (${r.why})`).join("; ")}`);
      e.plan = plan;
      throw e;
    }
    for (const m of plan.moves) {
      const ids = await hasIdColumn(q, m.table);
      const { rows, rowCount } = await q.query(
        `UPDATE "${m.table}" SET "${m.column}" = $2 WHERE "${m.column}" = $1${ids ? " RETURNING id::text AS id" : ""}`,
        [m.from, m.to]);
      await q.query(
        `INSERT INTO household_rekeys (table_name, column_name, from_key, to_key, rows, ids)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [m.table, m.column, m.from, m.to, rowCount, ids ? rows.map((r) => r.id) : null]);
      m.applied = rowCount;
    }

    for (const table of touched)
      for (const name of REKEY_GUARDS[table])
        if ((await triggerEnabled(q, table, name)) !== null)
          await q.query(`ALTER TABLE "${table}" ENABLE TRIGGER "${name}"`);
    for (const table of touched)
      for (const name of REKEY_GUARDS[table])
        if ((await triggerEnabled(q, table, name)) === false)
          throw new Error(`the guard ${table}.${name} is still disabled; refusing to commit`);

    await q.query("COMMIT");
    return plan;
  } catch (e) {
    await q.query("ROLLBACK").catch(() => {});
    throw e;
  }
}

const flag = (name) => process.argv.includes(`--${name}`);
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : null;
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const apply = flag("apply");
  const url = arg("pg-url");
  if (!url && !process.env.PGDATABASE) { console.error("no --pg-url and no PG* environment"); process.exit(2); }
  const dbName = url ? decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) : process.env.PGDATABASE;
  if (apply && !/lab|scratch/i.test(dbName) && !flag("prod")) {
    console.error(`--apply refuses database "${dbName}": its name says neither "lab" nor "scratch". Pass --prod as WELL if this is the box's own store.`);
    process.exit(2);
  }
  const client = url ? new pg.Client({ connectionString: url }) : new pg.Client();
  try { await client.connect(); }
  catch (e) { console.error(`cannot reach ${dbName}: ${String(e?.message ?? e)}`); process.exit(2); }
  let code = 0;
  try {
    if (apply) {
      const { rows: [who] } = await client.query("SELECT current_user AS u, to_regclass('public.household_rekeys') IS NOT NULL AS ledger");
      if (who.u !== "world2_owner") { console.error(`--apply runs as world2_owner (it owns the guard triggers); this connection is ${who.u}`); process.exit(2); }
      if (!who.ledger) { console.error(`no household_rekeys table in ${dbName}: apply world2/schema/068_household_rekeys.sql first`); process.exit(2); }
      let plan;
      try { plan = await applyRekey(client); }
      catch (e) {
        if (e.plan) for (const l of planLines(e.plan)) console.error(l);
        console.error(`household re-key · ${String(e?.message ?? e)}`);
        process.exit(1);
      }
      for (const l of planLines(plan)) console.log(l);
      const after = await rekeyPlan(client);
      console.log(`household re-key · APPLIED ${plan.moves.reduce((a, m) => a + m.applied, 0)} row(s) · left to re-key: ${after.moves.length} · refused: ${after.refused.length}`);
      code = after.moves.length || after.refused.length ? 1 : 0;
    } else {
      await client.query("BEGIN READ ONLY");
      let plan;
      try { plan = await rekeyPlan(client); }
      finally { await client.query("ROLLBACK").catch(() => {}); }
      for (const l of planLines(plan)) console.log(l);
      console.log(`household re-key · DRY RUN · nothing written · ${plan.refused.length ? `${plan.refused.length} spelling(s) refused` : "no spelling refused"}`);
      code = plan.moves.length || plan.refused.length ? 1 : 0;
    }
  } catch (e) {
    console.error(`household re-key · cannot run: ${String(e?.message ?? e)}`);
    code = e?.exit ?? 2;
  } finally {
    await client.end().catch(() => {});
  }
  process.exit(code);
}
