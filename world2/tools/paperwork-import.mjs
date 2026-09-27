#!/usr/bin/env node
// paperwork-import.mjs — copy oauth.db's sign-in tables and roles.db into the
// store's 027 tables, and prove every row arrived unchanged (POS-271).
//
//   node world2/tools/paperwork-import.mjs --pg-url <url> --oauth-db <file> --roles-db <file>
//        [--check]     compare only; write nothing
//        [--replace]   empty the eight tables first, in the same transaction
//        [--json]      the receipt as JSON on stdout
//
//   --pg-url is REQUIRED and nothing else is read for it: not WORLD2_PG_URL,
//   not PG*. On the box both of those name prod, and a copy tool that
//   defaulted to them could write prod by accident. Connect as world2_owner:
//   this is a migration step, and office_api cannot TRUNCATE.
//
//   EXIT: 0 every row equal · 1 DRIFT (nothing was committed) · 2 cannot run.
//
// ── WHY A SIGNED-IN AGENT STAYS SIGNED IN ───────────────────────────────────
//
// A session is a row in `tokens`, looked up by the sha256 of the bearer token
// the agent already holds (oauth.mjs § oauthLookup / keyLookup / berthLookup).
// The token is never stored and never re-issued. If the row arrives with the
// same hash, kind, gh id and expiry, the same token resolves to the same
// household. So the proof is equality, row by row and column by column, and
// the copy commits only if it holds. Nothing here mints, rotates or expires.
//
// ── THE ORDER ON A BOX (copy, check, then switch) ───────────────────────────
//
//   1. apply 027 (tables empty)
//   2. stop the writer, so nothing mints or rotates mid-copy
//   3. this tool, then `--check`: 0 or stop
//   4. start the office on the build that reads the store
//
// The files are opened read-only and never changed, so the rollback is to
// start the previous build: it reads oauth.db and roles.db exactly as they
// were. Sessions minted on the store after the switch do not exist in the
// files, so a rollback signs out only those.
//
// Copying without stopping the writer is refused in effect, not by a check: a
// second run over tables that already hold rows would bring back rotated keys
// or drop fresh ones, so without --replace a non-empty table is a refusal.
//
// NOT MOVED: oauth.db's `media` (the media quota ledger) and `town_journal` +
// `meta` (the town log). They are not sign-in, and the brief names sign-in.

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

// sqlite table → store table, and the primary key the rows are matched by.
export const TABLES = Object.freeze([
  { db: "oauth", from: "clients",    to: "oauth_clients",     key: ["client_id"] },
  { db: "oauth", from: "pending",    to: "oauth_pending",     key: ["id"] },
  { db: "oauth", from: "codes",      to: "oauth_codes",       key: ["code"] },
  { db: "oauth", from: "tokens",     to: "oauth_tokens",      key: ["token_hash"] },
  { db: "oauth", from: "berths",     to: "oauth_berths",      key: ["slug"] },
  { db: "oauth", from: "key_claims", to: "oauth_key_claims",  key: ["ask_hash"] },
  { db: "roles", from: "roles",      to: "office_roles",      key: ["subject", "role"] },
  { db: "roles", from: "role_audit", to: "office_role_audit", key: ["id"] },
]);

// One spelling for a value on both sides. node:sqlite gives integers as
// numbers and node-postgres gives int8 as strings, so both become strings;
// null stays null. Text is compared as it is, byte for byte.
const norm = (v) => (v == null ? null : String(v));
const keyOf = (row, key) => JSON.stringify(key.map((k) => norm(row[k])));

/**
 * THE EQUALITY for one table. `columns` are the sqlite table's own columns, so
 * a column the store lacks is a finding, never a silent drop.
 * Returns `{ table, sqlite, store, missing, extra, differ: [sentences] }`.
 */
export function compareTable({ to, key }, columns, sqliteRows, storeRows) {
  const have = new Map(storeRows.map((r) => [keyOf(r, key), r]));
  const want = new Map(sqliteRows.map((r) => [keyOf(r, key), r]));
  const differ = [];
  let missing = 0, extra = 0;
  for (const [k, w] of want) {
    const h = have.get(k);
    if (!h) { missing += 1; differ.push(`${to} ${k}: in the file, not in the store`); continue; }
    for (const c of columns) {
      if (!(c in h)) { differ.push(`${to}.${c}: the store has no such column`); continue; }
      if (norm(h[c]) !== norm(w[c])) differ.push(`${to} ${k}.${c}: file ${JSON.stringify(norm(w[c]))}, store ${JSON.stringify(norm(h[c]))}`);
    }
  }
  for (const k of have.keys()) if (!want.has(k)) { extra += 1; differ.push(`${to} ${k}: in the store, not in the file`); }
  return { table: to, sqlite: sqliteRows.length, store: storeRows.length, missing, extra, differ };
}

const columnsOf = (sdb, table) => sdb.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

/**
 * Copy (unless `check`) and compare, inside ONE transaction that commits only
 * when every table is equal. `client` is a connected node-postgres client.
 */
export async function importPaperwork(client, files, { check = false, replace = false } = {}) {
  const sdbs = { oauth: new DatabaseSync(files.oauth, { readOnly: true }), roles: new DatabaseSync(files.roles, { readOnly: true }) };
  const results = [];
  let committed = false;
  await client.query("BEGIN");
  try {
    if (!check) {
      const counts = await Promise.all(TABLES.map(async (t) =>
        [t.to, Number((await client.query(`SELECT count(*) AS n FROM ${t.to}`)).rows[0].n)]));
      const occupied = counts.filter(([, n]) => n > 0);
      if (occupied.length && !replace)
        throw Object.assign(new Error(`the store already holds rows (${occupied.map(([t, n]) => `${t} ${n}`).join(", ")}); a second copy would bring back rotated keys or drop fresh ones. Stop the writer and pass --replace, or run --check`), { exit: 2 });
      if (replace) await client.query(`TRUNCATE ${TABLES.map((t) => t.to).join(", ")}`);
    }
    for (const t of TABLES) {
      const sdb = sdbs[t.db];
      const columns = columnsOf(sdb, t.from);
      if (!columns.length) throw Object.assign(new Error(`${files[t.db]} has no table ${t.from}`), { exit: 2 });
      const rows = sdb.prepare(`SELECT * FROM ${t.from}`).all();
      if (!check) {
        const list = columns.join(", ");
        const marks = columns.map((_, i) => `$${i + 1}`).join(", ");
        const override = t.to === "office_role_audit" ? " OVERRIDING SYSTEM VALUE" : "";
        for (const r of rows)
          await client.query(`INSERT INTO ${t.to} (${list})${override} VALUES (${marks})`, columns.map((c) => r[c] ?? null));
      }
      const stored = (await client.query(`SELECT * FROM ${t.to}`)).rows;
      results.push(compareTable(t, columns, rows, stored));
    }
    if (!check)
      await client.query("SELECT setval('office_role_audit_id_seq', GREATEST((SELECT COALESCE(max(id), 0) FROM office_role_audit), 1), (SELECT count(*) > 0 FROM office_role_audit))");
    const equal = results.every((r) => r.differ.length === 0);
    if (equal && !check) { await client.query("COMMIT"); committed = true; }
    else await client.query("ROLLBACK");
    return { equal, committed, check, tables: results };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* the transaction is already gone */ }
    throw e;
  } finally {
    for (const s of Object.values(sdbs)) try { s.close(); } catch { /* read-only; nothing to lose */ }
  }
}

if (process.argv[1]?.endsWith("paperwork-import.mjs")) {
  const argv = process.argv.slice(2);
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const flag = (name) => argv.includes(name);
  const url = opt("--pg-url"), oauth = opt("--oauth-db"), roles = opt("--roles-db");
  const die = (msg) => { console.error(msg); process.exit(2); };
  if (!url) die("--pg-url is required, and nothing else is read for it (WORLD2_PG_URL and PG* name prod on the box)");
  if (!oauth || !existsSync(oauth)) die(`--oauth-db: no file at ${oauth}`);
  if (!roles || !existsSync(roles)) die(`--roles-db: no file at ${roles}`);
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  let out;
  try {
    await client.connect();
    out = await importPaperwork(client, { oauth, roles }, { check: flag("--check"), replace: flag("--replace") });
  } catch (e) {
    await client.end().catch(() => {});
    die(`cannot run: ${e.message}`);
  }
  await client.end();
  if (flag("--json")) console.log(JSON.stringify(out, null, 2));
  else {
    for (const t of out.tables)
      console.log(`${t.differ.length ? "DRIFT" : "equal"}  ${t.table.padEnd(18)} file ${t.sqlite}  store ${t.store}${t.differ.length ? `  (${t.differ.length} findings)` : ""}`);
    for (const t of out.tables) for (const d of t.differ.slice(0, 20)) console.log(`  ${d}`);
    console.log(out.check ? "checked; nothing written" : out.committed ? "copied and committed" : "DRIFT: rolled back, nothing committed");
  }
  process.exit(out.equal ? 0 : 1);
}
