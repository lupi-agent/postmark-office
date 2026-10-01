// migrations-landed-pglite.test.mjs — EVERY PROBE ANSWERS, ON A REAL POSTGRES.
//
//   PGLITE_MODULE_DIR=<dir> node --test test/migrations-landed-pglite.test.mjs
//
// The rehearsal runner decides which of a train's migrations a copy of prod
// lacks by asking each file's probe (world2/tools/migrations-landed.mjs). A
// probe that is true before its file ran makes the runner skip a migration the
// copy needs; one that stays false after makes it re-apply, or fail the
// rehearsal on a file that landed. The guards test only holds that every file
// HAS a probe. This holds that each one ANSWERS: the schema laid down file by
// file in name order (the CI floor's order, 003 skipped), and every probe asked
// after every file.
//
//   · every probe is TRUE once its own file has run, and stays true to the end;
//   · from 028 up — the w41 train's migrations, which the 2026-10-01 rehearsal
//     on the box could not judge — every probe is FALSE until its own file runs.
//     Below 028 a few probes are true early by design (017's is a data question,
//     and an empty table has no object-shaped `source`), and those files are on
//     prod already.
//
// PGlite is Postgres in WASM, not a stub; without it this SKIPS with the reason.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPglite } from "./helpers/pglite-store.mjs";
import { LANDED, schemaOrder } from "../world2/tools/migrations-landed.mjs";

const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), "..", "world2", "schema");
const pglite = await loadPglite();
const STRICT_FROM = "028";
// The roles the migrations GRANT to (helpers/pglite-store.mjs's list).
const ROLES = ["world2_owner", "office_api", "clearing_job", "law_ingester", "snapshot_reader",
  "review_publisher", "earpiece", "stance_reader"];

test("every landed-probe answers: false before its own file (028 up), true after it, and true to the end", { skip: pglite.reason }, async () => {
  const db = new pglite.PGlite({ extensions: pglite.extensions });
  for (const r of ROLES) await db.exec(`CREATE ROLE ${r}`);
  const files = schemaOrder(readdirSync(SCHEMA));
  const probed = files.filter((f) => typeof LANDED[f]?.probe === "string");
  const ask = async (f) => (await db.query(`SELECT (${LANDED[f].probe}) AS landed`)).rows[0].landed === true;

  const strict = probed.filter((f) => f >= STRICT_FROM);
  assert.ok(strict.length >= 8, `expected the w41 train's migrations from ${STRICT_FROM}, found ${strict.join(" ")}`);

  const ran = [];
  for (const f of files) {
    if (LANDED[f]?.skip) continue;
    if (f >= STRICT_FROM) assert.equal(await ask(f), false, `${f}'s probe reads LANDED before ${f} has run — the runner would skip it`);
    await db.exec(readFileSync(join(SCHEMA, f), "utf8"));
    ran.push(f);
    for (const g of ran) {
      if (typeof LANDED[g]?.probe === "string") assert.equal(await ask(g), true, `${g}'s probe reads MISSING after ${f} ran (${g} ran earlier)`);
    }
  }
  assert.deepEqual(ran.filter((f) => LANDED[f]?.probe), probed, "every probed file was laid down");
  await db.close();
});
