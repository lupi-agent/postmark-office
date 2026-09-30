// sqlite-txn-watch.mjs — a preload (`node --import`) that watches every write a
// process makes through node:sqlite and records, per database file, how many
// statements ran OUTSIDE a transaction and how many COMMITs there were. Written
// to SQLITE_TXN_WATCH_OUT as JSON when the process exits. Test-only: it is how
// test/hydrate-one-transaction.test.mjs sees the rebuild's transaction from the
// outside, by what the database was asked to do rather than by reading source.

import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

const seen = new Map(); // db location -> { run, outside, commits }
const prepare = DatabaseSync.prototype.prepare;
const exec = DatabaseSync.prototype.exec;
const tally = (db) => {
  const k = db.location() ?? ":memory:";
  if (!seen.has(k)) seen.set(k, { run: 0, outside: 0, commits: 0 });
  return seen.get(k);
};
DatabaseSync.prototype.prepare = function (sql, ...rest) {
  const stmt = prepare.call(this, sql, ...rest);
  if (!/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(sql)) return stmt;
  const db = this;
  const run = stmt.run.bind(stmt);
  stmt.run = (...args) => { const t = tally(db); t.run++; if (!db.isTransaction) t.outside++; return run(...args); };
  return stmt;
};
DatabaseSync.prototype.exec = function (sql, ...rest) {
  if (/^\s*COMMIT\b/i.test(sql)) tally(this).commits++;
  return exec.call(this, sql, ...rest);
};
process.on("exit", () => {
  if (process.env.SQLITE_TXN_WATCH_OUT) writeFileSync(process.env.SQLITE_TXN_WATCH_OUT, JSON.stringify(Object.fromEntries(seen)));
});
