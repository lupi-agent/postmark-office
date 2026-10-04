// pglite-store.mjs — a REAL Postgres for the store's tests, when one is to hand.
//
// PGlite is Postgres compiled to WASM: the same parser, planner, jsonb and
// triggers as the box's server, in-process. It is not a stub, which matters
// here — "a round trip through a JS stub is not a round trip through Postgres"
// (jsonb sorts keys; triggers refuse UPDATEs). The office does NOT depend on it:
// it is found at PGLITE_MODULE_DIR (a directory whose node_modules holds
// @electric-sql/pglite) or as a bare import, and a test that needs it SKIPS
// with the reason when it is absent — never silently, never by weakening what
// it would have asserted.
//
//   PGLITE_MODULE_DIR=/path/to/scratch node --test test/<file>.test.mjs
//
// `storeFloor` lays down the same floor CI's guard-falsifier job does
// (.github/scripts/guard-falsifier-floor.sh): every world2/schema/[0-9]*.sql in
// name order, 003 skipped. The roles the box makes by hand are made first,
// because the migrations GRANT to them and 023 refuses without its role.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "world2", "schema");

// The roles the migrations name. Created bare: PGlite runs every statement as
// its superuser, so these exist only to be GRANTed to.
const ROLES = ["world2_owner", "office_api", "clearing_job", "law_ingester", "snapshot_reader",
  "review_publisher", "earpiece", "stance_reader"];

async function importPglite(sub = "") {
  const spec = `@electric-sql/pglite${sub}`;
  const dir = process.env.PGLITE_MODULE_DIR;
  if (dir) {
    const req = createRequire(join(dir, "noop.js"));
    return import(pathToFileURL(req.resolve(spec)).href);
  }
  return import(spec);
}

/**
 * `{ PGlite, extensions }`, or `{ reason }` when PGlite is not installed. The
 * reason is what the skip prints.
 */
export async function loadPglite() {
  try {
    const { PGlite } = await importPglite();
    const { btree_gist } = await importPglite("/contrib/btree_gist");
    return { PGlite, extensions: { btree_gist } };
  } catch (e) {
    const where = process.env.PGLITE_MODULE_DIR
      ? `PGLITE_MODULE_DIR=${process.env.PGLITE_MODULE_DIR}${existsSync(process.env.PGLITE_MODULE_DIR) ? "" : " (no such directory)"}`
      : "no PGLITE_MODULE_DIR and no @electric-sql/pglite in node_modules";
    return { reason: `PGlite is not installed here (${where}: ${String(e?.message ?? e).split("\n")[0]}) — a real Postgres is the only thing this test would believe, so it does not run` };
  }
}

/** A fresh in-memory store with every migration applied. */
export async function storeFloor(pglite) {
  const db = new pglite.PGlite({ extensions: pglite.extensions });
  for (const r of ROLES) await db.exec(`CREATE ROLE ${r}`);
  for (const f of readdirSync(SCHEMA).filter((n) => /^\d.*\.sql$/.test(n)).sort()) {
    if (f.startsWith("003_")) continue;
    await db.exec(readFileSync(join(SCHEMA, f), "utf8"));
  }
  return db;
}
