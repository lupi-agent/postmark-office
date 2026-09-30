// hydrate.mjs — build the office's read index (SQLite) from a town checkout.
//
// The DB is an INDEX, never the truth: rebuildable byte-for-byte from a clone
// (constitution invariant, gold plan postmark-doors). Every serving response
// carries the commit sha this index was built from (X-Postmark-As-Of).
//
//   node src/hydrate.mjs --town <path-to-postmark-checkout> [--db office.db]
//
// Since POS-268 this file only WRITES. Every row comes from
// `deriveTownIndex` (src/town-index.mjs), the one derivation the store's
// town-index ingest writes from too; the rules and their reasons live there.
// It retires when the last office.db reader has moved to the store
// (docs/town-index-store.md).

import { DatabaseSync } from "node:sqlite";
import { existsSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA } from "./schema.mjs";
import { deriveTownIndex, TOWN_TABLES } from "./town-index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const TOWN = resolve(arg("--town", "G:/postmark/repo"));
const DB_PATH = resolve(ROOT, arg("--db", "office.db"));

if (!existsSync(join(TOWN, "WHITE_PAGES"))) {
  console.error(`FATAL: not a town checkout (no WHITE_PAGES): ${TOWN}`);
  process.exit(1);
}

const { asOf, town, tables } = await deriveTownIndex(TOWN);

// Rebuild from scratch every run — the index has no state of its own to keep.
if (existsSync(DB_PATH)) rmSync(DB_PATH);
const db = new DatabaseSync(DB_PATH);
db.exec(SCHEMA);

for (const [name, { cols, seq }] of Object.entries(TOWN_TABLES)) {
  // An AUTOINCREMENT table's seq is its row's position, which the derivation
  // numbered in insert order: sqlite assigns the same numbers.
  const c = seq ? cols.slice(1) : cols;
  const ins = db.prepare(`INSERT INTO ${name} (${c.join(", ")}) VALUES (${c.map(() => "?").join(", ")})`);
  for (const row of tables[name]) ins.run(...(seq ? row.slice(1) : row));
}

db.close();
console.log(`hydrated ${DB_PATH}`);
console.log(`  as_of ${asOf.slice(0, 12)} — ${town.residents.length} residents, ${town.letters.length} letters, ${town.threads.length} threads, ${town.ledger.length} ledger entries`);
