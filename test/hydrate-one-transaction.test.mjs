// hydrate-one-transaction.test.mjs — the office.db rebuild is ONE transaction
// (hotfix #267, carried onto the refactored hydrate.mjs, POS-268).
//
//   node --test test/hydrate-one-transaction.test.mjs
//
// Every INSERT used to autocommit, one fsync per row: 10m45s for the live town
// against 16s in one transaction. This runs the real src/hydrate.mjs over a
// throwaway town with a preload (helpers/sqlite-txn-watch.mjs) that records, for
// each database the process writes, how many writes ran outside a transaction
// and how many COMMITs there were. The rebuild's answer must be: every write
// inside, exactly one COMMIT. Take the BEGIN out and every row counts as outside.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(join(tmpdir(), "hydrate-one-txn-"));
after(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

test("the rebuild writes every row inside one transaction, and commits once", () => {
  const town = join(tmp, "town");
  const put = (p, text) => { mkdirSync(dirname(join(town, p)), { recursive: true }); writeFileSync(join(town, p), text); };
  for (const h of ["ada", "bex"]) put(`WHITE_PAGES/${h}/ADDRESS.md`, `---\nhandle: ${h}\nsince: 2026-05-12\n---\n\n# ${h}\n`);
  put("WHITE_PAGES/ada/inbox/bex-2026-09-01-to-ada-hi.md", "---\nid: bex-2026-09-01-to-ada-hi\nfrom: bex\nto: ada\ndate: 2026-09-01\n---\n\nHi.\n");
  put("WHITE_PAGES/mail-ledger.md", "# Mail ledger\n\n- 2026-09-01 · bex-2026-09-01-to-ada-hi · bex → ada\n");
  put("TOWN_BULLETIN/welcome.md", "---\ntitle: welcome\n---\n\nHello.\n");
  const git = (...a) => execFileSync("git", ["-C", town, ...a], { stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");

  const dbPath = join(tmp, "office.db");
  const out = join(tmp, "watch.json");
  execFileSync(process.execPath, ["--import", pathToFileURL(join(ROOT, "test", "helpers", "sqlite-txn-watch.mjs")).href,
    join(ROOT, "src", "hydrate.mjs"), "--town", town, "--db", dbPath],
    { env: { ...process.env, SQLITE_TXN_WATCH_OUT: out }, stdio: ["ignore", "pipe", "pipe"] });

  const watched = JSON.parse(readFileSync(out, "utf8"));
  const key = Object.keys(watched).find((k) => resolve(k) === resolve(dbPath));
  assert.ok(key, `the watch saw the rebuild's database (saw: ${Object.keys(watched).join(", ")})`);
  const t = watched[key];
  assert.ok(t.run >= 10, `the fixture wrote rows, or this proves nothing (${t.run} writes)`);
  assert.equal(t.outside, 0, `${t.outside} of ${t.run} writes ran outside a transaction: each one is its own commit and its own fsync`);
  assert.equal(t.commits, 1, "one COMMIT, at the end");
});
