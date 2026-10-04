// index-to-store.mjs — copy an office.db (a DatabaseSync handle) into the
// store's town_* tables, the way the town-index ingest writes them: every
// column, the row's digest, and repo_log's `n` (a commit's files in rowid
// order). Test-only: it lets a reader's equality test seed the store from the
// very office.db its twin reads, so the two answers can only differ by the
// readers.

import { TOWN_TABLES } from "../../src/town-index.mjs";
import { digestOf } from "../../world2/tools/town-index-ingest.mjs";

export async function copyIndexToStore(client, db) {
  for (const [name, { cols }] of Object.entries(TOWN_TABLES)) {
    await client.query(`DELETE FROM town_${name}`);
    const rows = db.prepare(`SELECT ${cols.join(", ")} FROM ${name} ORDER BY rowid`).all().map((r) => cols.map((c) => r[c] ?? null));
    let sha = null, n = 0;
    for (const row of rows) {
      const extra = name === "repo_log" ? [(row[0] === sha ? ++n : ((sha = row[0]), (n = 1)))] : [digestOf(row)];
      const vals = [...row, ...extra];
      const all = [...cols, name === "repo_log" ? "n" : "digest"];
      await client.query(`INSERT INTO town_${name} (${all.join(", ")}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")})`, vals);
    }
  }
}
