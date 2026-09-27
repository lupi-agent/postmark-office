#!/usr/bin/env node
// town-drain-run.mjs — the ferry's call into the town-log drain.
//
//   node tools/town-drain-run.mjs [--clone PATH] [--db PATH] [--oauth-db PATH]
//                                 [--date YYYY-MM-DD] [--dry-run] [--unlocked]
//                                 [--json]
//
// THE ENTRYPOINT AND NOTHING ELSE. Every decision lives in src/town-bridge.mjs;
// this file resolves paths, opens two databases, calls once, prints, and exits.
// The split is the same one crossing-save.mjs and world-drain.mjs keep — a tool
// that also held policy would be a second place to read the drain's law.
//
// WHERE THIS IS CALLED FROM: postmark-ferry.service, as the FIRST step of the
// crossing chain, inside the flock the unit already holds and after its
// reset/clean crash recovery. See src/town-bridge.mjs § where it runs for why
// all three of those are load-bearing rather than convenient.
//
// EXIT CODES, because the ferry chain is `&&`-joined and this runs before the
// mail sweep:
//
//   0  drained, or nothing to drain, or the flag is off (the no-op case)
//   1  REFUSED — the lock was not held, or the log holds a class this drain
//      cannot settle. Nothing was written and the cursor did not move. Exiting
//      non-zero holds the rest of the crossing on purpose: a refusal means the
//      office does not understand its own log, and delivering mail on top of
//      that would be building on a floor nobody has checked.
//   2  a bad argument
//
// A THROW IS NOT AN EXIT CODE HERE. It propagates, systemd records it, and the
// chain stops — same outcome as 1, louder. The drain has no failure it should
// absorb: the town log's whole promise is that a row is either settled or still
// pending, and a swallowed error is the one state that is neither.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { openOauthDb } from "../src/oauth.mjs";
import { runTownDrain } from "../src/town-bridge.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(n);

const CLONE = resolve(argOf("--clone", process.env.TOWN_CLONE ?? join(ROOT, "town-clone")));
const DB_PATH = resolve(argOf("--db", join(ROOT, "office.db")));
const ODB_PATH = resolve(argOf("--oauth-db", join(ROOT, "oauth.db")));
const DATE = argOf("--date", null);

if (DATE && !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error(`unparseable --date: ${DATE} (want YYYY-MM-DD)`);
  process.exit(2);
}

// The read index the doors take. Read-only would be wrong — validateLetter and
// the paper doors only read it, but opening it read-only would make a future
// door that writes fail here and nowhere else, which is a trap rather than a
// safeguard. Missing is fine and common on a fresh box: the doors that need it
// bounce in their own vocabulary.
const db = existsSync(DB_PATH) ? new DatabaseSync(DB_PATH) : null;
const odb = openOauthDb(ODB_PATH);

// ── AWAITED, AND THE EXIT MOVED OUT OF THE `try` (POS-158) ─────────────────
//
// `runTownDrain` became async when the registry became store-of-record: the
// planner reads the record and the writer writes rows to it. This call did not
// follow, and the failure was silent in the worst way a crossing can be —
// `report` was a PROMISE, `report.refused` was `undefined`, and the process
// exited 0 having written nothing. Measured A/B on a seeded db: before the
// async change a foreign-class crossing wrote four files and exited 1; after
// it, and before this line, it wrote nothing, printed `{}` and exited 0. A
// ferry chain is `&&`-joined, so that reads as a clean crossing and the mail
// goes out on top of a record nobody settled.
//
// THE EXIT ALSO MOVED. `process.exit()` does not unwind, so the `finally` below
// never ran and both handles were closed by process teardown instead of by this
// file. That was invisible while the call was synchronous and would have been a
// held sqlite lock on Windows the moment anything awaited between them.
let code = 0;
try {
  const report = await runTownDrain(odb, {
    db, clone: CLONE, date: DATE,
    dryRun: flag("--dry-run"),
    requireLock: !flag("--unlocked"),
  });
  if (flag("--json")) console.log(JSON.stringify(report, null, 2));
  code = report.refused ? 1 : 0;
} finally {
  try { odb.close(); } catch { /* already gone */ }
  try { db?.close(); } catch { /* already gone */ }
}
process.exit(code);
