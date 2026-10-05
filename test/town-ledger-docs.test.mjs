// town-ledger-docs.test.mjs — the town's mail ledger and its docs come through
// the office (POS-351): GET /town/ledger and GET /town/docs, from the town
// index, on the store and on office.db alike.
//
//   node --test test/town-ledger-docs.test.mjs
//
//   THE SAME OBJECTS   every ledger entry the office serves is the vendored
//                      reader's own object (the one the site's ledger.json
//                      always held), in ledger order; the docs are its docs.
//   BOTH ROADS         the store (the ingest's seed) and office.db (hydrate)
//                      answer the same body.
//   THE DELTA          a new delivery line and an edited README reach the
//                      store through the ingest's delta, not only its seed.
//
// THE FLIP (after the commit): drop the `docs` meta row from the delta ingest
// — THE DELTA goes red (the README edit never reaches the store).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { indexStoreFromTown } from "./helpers/office-under-test.mjs";
import { readTown } from "../vendor/tools/lib/town.mjs";
import { townLedger as ledgerFromStore, townDocs as docsFromStore } from "../src/town-index-store.mjs";
import { townLedger as ledgerFromDb, townDocs as docsFromDb } from "../src/queries.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const trash = [];
const stores = [];
after(async () => {
  for (const s of stores) await s.stop();
  for (const d of trash) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const LEDGER_HEAD = "# Mail ledger\n\nAppend-only record.\n\n";
const L1 = "- 2026-06-12 · wright-2026-06-12-first-post · wright → postmaster\n";
const L2 = "- 2026-06-13 · rei-2026-06-13-welcome-aion · rei → aion-solare · thread: new\n";
const L3 = "- 2026-06-14 · aion-solare-2026-06-14-thanks · aion-solare → rei\n";

function town() {
  const dir = mkdtempSync(join(tmpdir(), "pm-ledger-docs-"));
  trash.push(dir);
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), LEDGER_HEAD + L1 + L2);
  writeFileSync(join(dir, "README.md"), "# Postmark\n\nA town for agents.\n");
  writeFileSync(join(dir, "JOINING.md"), "---\ntitle: joining\n---\n\n# Joining\n\nDeclare a house.\n");
  writeFileSync(join(dir, "TOWN-RULES.md"), "# Town rules\n\nBe kind.\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("config", "core.autocrlf", "false"); git("add", "-A");
  git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

async function storeRead(s, fn) {
  const c = await s.store.connect("office_api");
  try { return await fn(c); } finally { await c.end(); }
}

test("THE SAME OBJECTS, BOTH ROADS: the store and office.db serve the vendored reader's ledger and docs", async (t) => {
  const dir = town();
  const want = readTown(dir);
  const s = await indexStoreFromTown(dir, { db: "ledger_docs_seed" });
  if (!s.store) return t.skip("the suite's index is forced to office.db");
  stores.push(s);

  const ledger = await storeRead(s, ledgerFromStore);
  assert.deepEqual(ledger.entries, JSON.parse(JSON.stringify(want.ledger)), "every entry is the reader's own object, in ledger order");
  assert.equal(ledger.total, 2);
  assert.match(ledger.as_of, /^[0-9a-f]{40}$/);
  const docs = await storeRead(s, docsFromStore);
  assert.deepEqual(docs.docs, JSON.parse(JSON.stringify(want.docs)));
  assert.deepEqual(Object.keys(docs.docs), ["JOINING", "README", "TOWN-RULES"]);
  assert.equal(docs.docs.JOINING.body.includes("title: joining"), false, "the frontmatter is the reader's to strip");

  // office.db, the way the rehydrate tick builds it
  const dbPath = join(dir, "..", `office-${Date.now()}.db`);
  trash.push(dbPath);
  const h = spawnSync(process.execPath, [join(ROOT, "src", "hydrate.mjs"), "--town", dir, "--db", dbPath], { encoding: "utf8" });
  assert.equal(h.status, 0, h.stderr);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.deepEqual(ledgerFromDb(db), ledger, "office.db answers the store's body, as_of included");
    assert.deepEqual(docsFromDb(db), docs);
  } finally { db.close(); }
});

test("THE DELTA: a new delivery and an edited README reach the store through the ingest's delta", async (t) => {
  const dir = town();
  const s = await indexStoreFromTown(dir, { db: "ledger_docs_delta" });
  if (!s.store) return t.skip("the suite's index is forced to office.db");
  stores.push(s);
  appendFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), L3);
  writeFileSync(join(dir, "README.md"), "# Postmark\n\nA town for agents, revised.\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("add", "-A");
  git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "a crossing");
  const sha = git("rev-parse", "HEAD").trim();

  const { ingest } = await import("../world2/tools/town-index-ingest.mjs");
  const w = await s.store.connect("law_ingester");
  try { await ingest(w, { townRepo: dir, sha }); } finally { await w.end(); }

  const ledger = await storeRead(s, ledgerFromStore);
  assert.equal(ledger.total, 3);
  assert.equal(ledger.entries.at(-1).id, "aion-solare-2026-06-14-thanks");
  assert.equal(ledger.as_of, sha);
  const docs = await storeRead(s, docsFromStore);
  assert.match(docs.docs.README.body, /revised/, "the docs moved with the town, not only at the seed");
});

test("an index that predates the docs key answers an empty docs object, never a throw", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); INSERT INTO meta VALUES ('as_of', 'abc')");
  assert.deepEqual(docsFromDb(db), { as_of: "abc", docs: {} });
});
