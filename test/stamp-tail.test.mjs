// stamp-tail.test.mjs — SNAPSHOT 7 (POS-314): a stamp door holds town_stamps
// plus the ledger's tail, and that equals the town's own fold of the whole file.
//
//   node --test test/stamp-tail.test.mjs
//
// THE GATE (the issue's): `foldBalances`/`foldStaked` over the whole file equal
// town_stamps plus the folded tail. A throwaway town is seeded into a real
// Postgres with its stamp ledger cut at line 1480 (one ballot stake in), then the
// ledger grows to line 2580 on disk with no ingest, so the tail holds more stakes
// and half the 07-27 close's returns. Every account the whole fold knows must
// read the same from the store plus the tail. It's run again after a delta
// ingest carries the head forward. The ledger is the office's pinned town-clone's own,
// cut at a line, as in test/town-index-ingest.test.mjs, so the fixture can't
// decay with the next crossing.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import { startStore } from "./helpers/embedded-store.mjs";
import { ingest } from "../world2/tools/town-index-ingest.mjs";
import { heldFromIndex, lastLedgerLine, ledgerTailAfter } from "../src/stamp-tail.mjs";
import { heldFor } from "../src/stamps-preview.mjs";
import { __setTownIndexPoolForTest } from "../src/town-index-store.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLONE = join(ROOT, "town-clone");
const LEDGER = join(CLONE, "WHITE_PAGES", "stamp-ledger.md");
const hasClone = existsSync(join(CLONE, "tools", "stamp-mint.mjs")) && existsSync(LEDGER);
const NO_CLONE = "no town-clone with tools/stamp-mint.mjs beside the office: the fixture copies the town's own tools and ledger from it";

const tmp = mkdtempSync(join(tmpdir(), "stamp-tail-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// ── the tail reader, on files ────────────────────────────────────────────────

const file = (name, text) => { const p = join(tmp, name); writeFileSync(p, text); return p; };
const TIP = "- 2026-09-02 · MINT → ada · 1 · for: x (sent) · sig: AAA";

test("the tail starts after the tip line, read backwards from the end, through any window size", () => {
  const head = Array.from({ length: 400 }, (_, i) => `- 2026-09-01 · MINT → bex · 1 · for: y${i} (sent) · sig: B${i}`).join("\n");
  const p = file("a.md", `# Stamp ledger\n\n${head}\n${TIP}\n- after one\n- after two\n`);
  for (const chunk of [8, 64, 1024, 1 << 20])
    assert.equal(ledgerTailAfter(p, TIP, { chunk }), "- after one\n- after two\n", `chunk ${chunk}`);
  assert.equal(ledgerTailAfter(file("b.md", `${TIP}\n`), TIP), "", "a tip that is the last line leaves an empty tail");
  assert.equal(ledgerTailAfter(file("c.md", `${TIP}`), TIP), "", "no trailing newline");
  assert.equal(ledgerTailAfter(file("d.md", `x\r\n${TIP}\r\n- after\r\n`), TIP), "- after\r\n", "CRLF");
  assert.equal(ledgerTailAfter(file("e.md", `${TIP}\n- after\n`), TIP, { chunk: 4 }), "- after\n", "the tip starts the file");
});

test("the tail reader answers null for what it can't vouch for: no tip, a missing tip, a tip that is only part of a line", () => {
  const p = file("f.md", `- one\n${TIP} · more\nx${TIP}\n- two\n`);
  assert.equal(ledgerTailAfter(p, ""), null);
  assert.equal(ledgerTailAfter(p, "- 2026-01-01 · not here"), null);
  assert.equal(ledgerTailAfter(p, TIP), null, "neither occurrence is the whole line");
  assert.equal(ledgerTailAfter(join(tmp, "absent.md"), TIP), null);
});

test("lastLedgerLine is parseStampLedger's last raw entry, on the live ledger", async (t) => {
  if (!hasClone) return t.skip(NO_CLONE);
  const mint = await import(pathToFileURL(join(CLONE, "tools", "stamp-mint.mjs")).href);
  const want = mint.parseStampLedger(readFileSync(LEDGER, "utf8")).at(-1).raw;
  assert.equal(lastLedgerLine(LEDGER), want);
  assert.equal(lastLedgerLine(file("g.md", "# Stamp ledger\n\n- a\n- b\n\n")), "- b");
  assert.equal(lastLedgerLine(file("h.md", "# nothing yet\n")), "");
});

// ── the gate, on a real Postgres ─────────────────────────────────────────────

const town = join(tmp, "town");
const put = (p, text) => { mkdirSync(dirname(join(town, p)), { recursive: true }); writeFileSync(join(town, p), text); };
const git = (...a) => execFileSync("git", ["-C", town, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const commit = (msg) => { git("add", "-A"); git("-c", "user.name=Postmark Pen", "-c", "user.email=pen@test.invalid", "commit", "-q", "--allow-empty", "-m", msg); return git("rev-parse", "HEAD").trim(); };
const stampLines = hasClone ? readFileSync(LEDGER, "utf8").split("\n") : [];
const stampLedgerTo = (n) => stampLines.slice(0, n).join("\n") + "\n";
const SEED_AT = 1480, GROW_TO = 2580, BEHIND = 1000;
const address = (h) => `---\nhandle: ${h}\nagent: ${h}\ngithub: fixture\nsince: 2026-05-12\n---\n\n# ${h}\n`;

let store = null, skip = hasClone ? false : NO_CLONE, c = null, reader = null, mint = null;
before(async () => {
  if (skip) return;
  store = await startStore({ db: "stamp_tail_test" });
  c = await store.connect("law_ingester");
  reader = await store.connect("office_api");
  mint = await import(pathToFileURL(join(CLONE, "tools", "stamp-mint.mjs")).href);
  cpSync(join(CLONE, "tools"), join(town, "tools"), { recursive: true });
  cpSync(join(CLONE, "quest-registry.json"), join(town, "quest-registry.json"));
  for (const h of ["ada", "bex"]) put(`WHITE_PAGES/${h}/ADDRESS.md`, address(h));
  put("WHITE_PAGES/mail-ledger.md", "# Mail ledger\n\n");
  put("WHITE_PAGES/stamp-ledger.md", stampLedgerTo(SEED_AT));
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  const seed = commit("the town at its seed");
  await ingest(c, { townRepo: town, sha: seed, seed: true });
});
after(async () => {
  __setTownIndexPoolForTest(null);
  for (const x of [c, reader]) if (x) await x.end().catch(() => {});
  if (store?.stop) await store.stop();
});

/** Every account the whole file's fold knows, against the store plus the tail. */
async function assertGate(label) {
  const entries = mint.parseStampLedger(readFileSync(join(town, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
  const bal = mint.foldBalances(entries), st = mint.foldStaked(entries);
  const accounts = [...new Set([...bal.keys(), ...st.keys()])].filter((a) => a !== "MINT" && a !== "BURN" && !a.startsWith("stake:"));
  assert.ok(accounts.length > 5, `${label}: the cut ledger names accounts to compare (${accounts.length})`);
  assert.ok(accounts.some((a) => (st.get(a) ?? 0) > 0), `${label}: some account has stamps staked, so the staked fold is compared too`);
  for (const h of accounts) {
    const got = await heldFromIndex(reader, town, h, { engine: mint });
    assert.deepEqual(got, { liquid: bal.get(h) ?? 0, staked: st.get(h) ?? 0 }, `${label}: ${h}`);
  }
}

test("THE GATE: town_stamps plus the tail equals the whole fold, before and after a delta ingest", async (t) => {
  if (skip) return t.skip(skip);
  const tip = (await reader.query("SELECT value FROM town_meta WHERE key = 'stamps_tip'")).rows[0]?.value;
  assert.equal(tip, mint.parseStampLedger(stampLedgerTo(SEED_AT)).at(-1).raw, "the seed keeps its ledger's last line as the tip");

  put("WHITE_PAGES/stamp-ledger.md", stampLedgerTo(GROW_TO));     // the ledger grows; no ingest yet
  await assertGate("1,100 lines past the head");

  const sha = commit("mint: crossing pass");
  await ingest(c, { townRepo: town, sha });
  const moved = (await reader.query("SELECT value FROM town_meta WHERE key = 'stamps_tip'")).rows[0]?.value;
  assert.equal(moved, mint.parseStampLedger(stampLedgerTo(GROW_TO)).at(-1).raw, "the delta carries the tip to its own last line");
  await assertGate("at the head");
});

test("a ledger whose past isn't the head's has no tail, so the door folds the whole file", async (t) => {
  if (skip) return t.skip(skip);
  const real = readFileSync(join(town, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
  try {
    put("WHITE_PAGES/stamp-ledger.md", stampLedgerTo(BEHIND));     // a clone behind the ingest's
    assert.equal(await heldFromIndex(reader, town, "ada", { engine: mint }), null);
  } finally { put("WHITE_PAGES/stamp-ledger.md", real); }
});

test("heldFor reads the store when the town index is on it, and the whole file when it is not", async (t) => {
  if (skip) return t.skip(skip);
  const entries = mint.parseStampLedger(readFileSync(join(town, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
  const h = [...mint.foldBalances(entries).keys()].find((a) => a !== "MINT" && a !== "BURN" && !a.startsWith("stake:"));
  const whole = { liquid: mint.foldBalances(entries).get(h) ?? 0, staked: mint.foldStaked(entries).get(h) ?? 0 };
  // PLANT a row the file can't have: only a read of the store can see it.
  const row = (await c.query("SELECT handle, balance, mint_count, staked, digest FROM town_stamps WHERE handle = $1", [h])).rows[0];
  await c.query("DELETE FROM town_stamps WHERE handle = $1", [h]);
  await c.query("INSERT INTO town_stamps (handle, balance, mint_count, staked, digest) VALUES ($1, $2, $3, $4, $5)",
    [h, row.balance + 1000, row.mint_count, row.staked, row.digest]);
  __setTownIndexPoolForTest({ connect: async () => ({ query: (...a) => reader.query(...a), release() {} }) });
  try {
    assert.deepEqual(await heldFor(town, h, { env: { TOWN_INDEX_READS: "store" } }), { ...whole, liquid: whole.liquid + 1000 }, "the planted row is read");
    assert.deepEqual(await heldFor(town, h, { env: {} }), whole, "switch off: the whole file, as before");
  } finally {
    __setTownIndexPoolForTest(null);
    await c.query("DELETE FROM town_stamps WHERE handle = $1", [h]);
    await c.query("INSERT INTO town_stamps (handle, balance, mint_count, staked, digest) VALUES ($1, $2, $3, $4, $5)",
      [h, row.balance, row.mint_count, row.staked, row.digest]);
  }
});
