// town-drain-entrypoint.test.mjs — THE FERRY'S ACTUAL CALLER (POS-158).
//
// ── THE DEFECT THIS EXISTS BECAUSE OF ───────────────────────────────────────
//
// `runTownDrain` became async when the registry became store-of-record. Every
// TEST harness was made async-aware in the same pass. The one PRODUCTION caller
// — `tools/town-drain-run.mjs`, which is what the ferry chain actually runs —
// was not: it read `const report = runTownDrain(...)`, so `report` was a
// Promise, `report.refused` was `undefined`, and `process.exit(0)` fired before
// the crossing had done anything at all.
//
// Measured A/B on a seeded db: before the async change a foreign-class crossing
// wrote four files and exited 1; after it, and before the fix, it wrote nothing,
// printed `{}` and exited 0. The ferry chain is `&&`-joined, so that reads as a
// clean crossing and the mail goes out on top of a record nobody settled.
//
// ── SO THIS SUITE SPAWNS THE TOOL, NOT THE LIBRARY ──────────────────────────
//
// Every other drain suite imports `runTownDrain` and awaits it, which is
// exactly why none of them could see this: they were testing a function the
// ferry does not call. This one runs `node tools/town-drain-run.mjs` as a
// process and reads what an operator reads — the files on disk and `$?`.
//
// It is the general lesson, and it is worth stating where the next person will
// meet it: WHEN A LIBRARY'S SIGNATURE CHANGES, THE SUITE THAT FOLLOWS IT IS NOT
// THE PROOF. The suite is the thing most likely to be updated in the same
// breath and least likely to be the caller that matters. The entrypoint is.
//
// ── NO RECORD, ON PURPOSE ───────────────────────────────────────────────────
//
// The spawned tool cannot reach the store, and that is a fact about this lane
// (it opens no database connection) rather than a limitation of the test. It
// shapes what is asserted, and both assertions still discriminate:
//
//   · A LETTER row drains without the registry — `planTownDrain` defers only
//     join rows when the record is unreachable — so the crossing writes real
//     files and exits 0. The BROKEN caller also exited 0, and wrote NOTHING, so
//     the file assertion is what separates them.
//   · A FOREIGN-CLASS row refuses, and the refusal has to reach `$?`. The
//     broken caller exited 0 there, so the exit code separates them.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { openOauthDb } from "../src/oauth.mjs";
import { fixtureDb } from "./fixture.mjs";
import { appendTownJournal, ensureTownJournal } from "../src/town-journal.mjs";
import { letterDate, outboxRelPath } from "../src/write.mjs";
import { MAIL_ACT } from "../src/town-mail.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(ROOT, "tools", "town-drain-run.mjs");
const temps = [];

function townClone(handles = ["wright", "limen"]) {
  const dir = mkdtempSync(join(tmpdir(), "pos158-entry-"));
  temps.push(dir);
  for (const h of handles) {
    mkdirSync(join(dir, "WHITE_PAGES", h, "outbox"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "inbox"), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"),
      `---\nhandle: ${h}\ngithub: gh-${h}\nsince: 2026-01-01\n---\n\n# ${h}\n`);
  }
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, "tools", "households.json"),
    JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"),
    "# the mail ledger\n\n- 2026-07-01 · a-line · someone → someone\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

/** The read index the doors take, ON DISK — the spawned tool cannot share ours. */
function indexDb() {
  const home = mkdtempSync(join(tmpdir(), "pos158-entry-db-"));
  temps.push(home);
  const path = join(home, "office.db");
  fixtureDb(path).close();
  return path;
}

function seededDb(seed) {
  const home = mkdtempSync(join(tmpdir(), "pos158-entry-odb-"));
  temps.push(home);
  const path = join(home, "oauth.db");
  const o = openOauthDb(path);
  ensureTownJournal(o);
  seed(o);
  o.close();                 // Windows holds the file open otherwise
  return path;
}

/** Run the REAL entrypoint and read what an operator reads. */
function runTool(clone, odbPath, { dbPath = null, args = [] } = {}) {
  const res = { status: 0, stdout: "", stderr: "" };
  try {
    res.stdout = execFileSync(process.execPath,
      [TOOL, "--clone", clone, "--oauth-db", odbPath, "--unlocked", "--json",
        ...(dbPath ? ["--db", dbPath] : []), ...args],
      { encoding: "utf8", env: { ...process.env, TOWN_SINGLE_LOG: "1" } });
  } catch (e) {
    res.status = e.status ?? 1;
    res.stdout = e.stdout ?? "";
    res.stderr = e.stderr ?? "";
  }
  return res;
}

const outbox = (clone, h) => {
  const d = join(clone, "WHITE_PAGES", h, "outbox");
  return existsSync(d) ? readdirSync(d).sort() : [];
};

test.after(() => { for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

test("THE ENTRYPOINT SETTLES: a letter row becomes real files, and the tool exits 0", () => {
  // CAN-FAIL, and it is the half that catches the exact defect: drop the
  // `await` in `tools/town-drain-run.mjs` and this still exits 0 — because the
  // broken caller always did — but the outbox is EMPTY, because the process
  // ended before the promise ran.
  const clone = townClone();
  const date = letterDate();
  const odbPath = seededDb((o) => {
    appendTownJournal(o, {
      cls: "letter", act: MAIL_ACT, household: "keemin", handle: "wright",
      ghId: "42", ghLogin: "keeminlee",
      payload: {
        args: { from: "wright", to: "limen", title: "a fine hat", thread: "new", body: "limen —\n\nA letter the crossing will materialize." },
        id: `wright-${date}-to-limen-a-fine-hat`,
        file: outboxRelPath("wright", date, "limen", "a-fine-hat"),
      },
    });
  });

  const r = runTool(clone, odbPath, { dbPath: indexDb() });
  assert.equal(r.status, 0, `the tool exited ${r.status}: ${r.stderr.slice(0, 400)}`);
  assert.deepEqual(outbox(clone, "wright").length, 1,
    "the crossing wrote the letter — an un-awaited drain writes nothing and still exits 0");

  const report = JSON.parse(r.stdout);
  assert.equal(report.ran, true, "and the report is an OBJECT, not a promise rendered as `{}`");
  assert.equal(report.counts.letter, 1);
});

test("THE ENTRYPOINT REFUSES: a deferred row reaches `$?` as a 1, and stays pending", () => {
  // THE REFUSAL THIS TOOL REALLY MEETS. A foreign-class row cannot be seeded —
  // `appendTownJournal` refuses one at WRITE time, which is its own tripwire
  // working — so the refusal exercised here is the deferral tripwire, reached
  // exactly as production reaches it: the spawned tool cannot see the record,
  // `planTownDrain` files every join row as waiting, and nothing holds the
  // cursor. The crossing must refuse, write nothing, and leave the row.
  //
  // CAN-FAIL: drop the `await` in `tools/town-drain-run.mjs` and this exits 0,
  // because `refused` read off a Promise is `undefined`. That is the whole
  // defect, and to an `&&`-joined ferry chain a refusal that exits 0 is
  // indistinguishable from a clean crossing.
  const clone = townClone();
  const odbPath = seededDb((o) => {
    appendTownJournal(o, {
      cls: "join", act: "declare-household", household: "newcomers", handle: "newcomer",
      ghId: "777", ghLogin: "newcomer-gh",
      payload: { household: "Newcomers", card: "A newcomer's card." },
    });
  });

  const r = runTool(clone, odbPath, { dbPath: indexDb() });
  assert.equal(r.status, 1, "a refusal is an exit 1, or the ferry chain runs on past it");
  const report = JSON.parse(r.stdout);
  assert.equal(report.ran, false);
  assert.equal(report.refused, "deferred-rows");
  assert.equal(report.cursor, 0, "the cursor did not move — the row is still here");
  assert.equal(existsSync(join(clone, "WHITE_PAGES", "newcomer", "ADDRESS.md")), false,
    "and nobody was settled");
});

test("the report is real JSON with real fields, never a stringified promise", () => {
  // `JSON.stringify(aPromise, null, 2)` is `{}`, which parses, has no fields
  // and asserts nothing. This names the shape so a future un-awaited call
  // cannot pass by being merely parseable.
  const clone = townClone();
  const odbPath = seededDb(() => { /* nothing pending */ });
  const r = runTool(clone, odbPath);
  assert.equal(r.status, 0);
  const report = JSON.parse(r.stdout);
  assert.ok(Object.keys(report).length > 0, "a promise stringifies to `{}` — an empty report is the bug");
  assert.equal(report.ran, true);
  assert.equal(report.note, "nothing pending");
});
