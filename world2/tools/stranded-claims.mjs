#!/usr/bin/env node
// stranded-claims.mjs — THE CLAIMS PENDING IN A CLOSED WINDOW, counted (POS-404,
// postmark-office#349). Read only.
//
//   WORLD2_PG_URL=postgres://snapshot_reader:…@localhost/world2_dev \
//     node world2/tools/stranded-claims.mjs [--json]
//
// EXIT CODES: 0 none stranded · 1 STRANDED, each one listed · 2 cannot run.
//
// THE CLASS. Before the candle's lock (candle-lock.mjs), a claim filed while the
// clearing held window N waited on the clearing's row lock and then wrote into N
// after N had closed. A pending claim in a window that is not open is judged by
// no clearing (each clearing reads only its own window) and shown on no docket
// (the view hides closed windows), so nothing else in the store would ever say it
// is there. This lists them.
//
// `after_clearing` says whether the claim was submitted after its window's
// clearing (`submitted_at > cleared_at`). True is #349's signature. False is a
// pending row the clearing should have seen, which is a different cause and wants
// its own look before any repair.
//
// THE REPAIR IS NOT HERE. Ending a stranded row and putting its act back on the
// docket are prod writes, and an operator's (`redocket-refused.mjs` refuses an act
// whose row is still pending, so it does not do this as it stands). `act_id` is
// printed so that step can name each act.
//
// The read runs inside `BEGIN READ ONLY`: Postgres itself refuses a write, whatever
// role the URL names.

import { realpathSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";

export const STRANDED_SQL = `
  SELECT c.id::text, c.window_id, w.status AS window_status, c.claimant, c.class,
         c.geometry->>'slug' AS slug, c.data->>'_act_id' AS act_id,
         c.submitted_at, w.cleared_at,
         (w.cleared_at IS NOT NULL AND c.submitted_at > w.cleared_at) AS after_clearing
    FROM claims c JOIN windows w ON w.id = c.window_id
   WHERE c.status = 'pending' AND w.status <> 'open'
   ORDER BY c.window_id, c.submitted_at, c.id`;

/** The stranded claims, on a client the caller connected. Read only. */
export async function strandedClaims(client) {
  await client.query("BEGIN READ ONLY");
  try {
    const { rows } = await client.query(STRANDED_SQL);
    return rows;
  } finally {
    await client.query("ROLLBACK");
  }
}

const iso = (t) => (t == null ? "∅" : new Date(t).toISOString());

export function strandedLines(rows) {
  if (!rows.length) return ["0 claims pending in a closed window"];
  return [
    `${rows.length} claim(s) pending in a window that is not open — judged by no clearing, on no docket:`,
    ...rows.map((r) =>
      `  ${r.id} · window ${r.window_id} (${r.window_status}) · ${r.claimant} · ${r.class} · ${r.slug ?? "∅"} · act ${r.act_id ?? "∅"}` +
      ` · submitted ${iso(r.submitted_at)} · cleared ${iso(r.cleared_at)}${r.after_clearing ? " · AFTER its clearing (#349)" : ""}`),
  ];
}

async function main() {
  if (!process.env.WORLD2_PG_URL) { console.error("WORLD2_PG_URL missing"); process.exit(2); }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
  try { await client.connect(); } catch (e) { console.error(`CANNOT RUN · ${e.message}`); process.exit(2); }
  let rows;
  try { rows = await strandedClaims(client); } catch (e) { console.error(`CANNOT RUN · ${e.message}`); process.exit(2); } finally { await client.end(); }
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
  else for (const line of strandedLines(rows)) console.log(line);
  process.exit(rows.length ? 1 : 0);
}

// The realpath guard (test/cli-guard.test.mjs): argv[1] through a junction is not
// the module's URL, and a tail that never fires exits 0 having checked nothing.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(2); });
}
