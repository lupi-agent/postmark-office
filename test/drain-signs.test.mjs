// THE DRAIN SIGNS WHAT IT WRITES (#2040) — falsifiers through the real pipe.
//
// The law (town tools/stamp-mint.mjs § SEAL + SIGNATURE, quoted verbatim):
//   "seal_n = sha256(seal_{n-1} + canonical(line_n))"
//   "sig_n  = ed25519.sign(utf8(seal_n))"
//   "Signing the running seal means every signature binds the entire prefix."
//
// Three unsigned registry lines reached the live ledger before this file
// existed (zeno 08-27, errant 08-28×2 — each a hand-repair), because every
// falsifier upstream supplied the signature the writer never made. So these
// legs run the REAL channel end to end: the real planTownDrain/writeTownDrain,
// the real town engine (imported by path, the fund.test.mjs precedent), and
// the town's own stamp-verify as the oracle — never a reimplementation.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { appendTownJournal, ensureTownJournal, townDrainCursor } from "../src/town-journal.mjs";
import { planTownDrain, writeTownDrain } from "../src/town-drain.mjs";
import { runTownDrain } from "../src/town-bridge.mjs";
import { REGISTRY_PATH } from "../src/residency.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";

const TOWN = townClone();
// The town's own verifier and mint, imported live. CONDITIONALLY, because a
// top-level await import of a clone that is not there takes the whole module
// down at load and its cases neither pass nor fail — they vanish.
const VERIFY = TOWN ? await import(townModuleUrl("tools", "stamp-verify.mjs")) : null;
const ENGINE = TOWN ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const SKIP = !TOWN && NO_TOWN;
import { createPrivateKey, sign as edSign } from "node:crypto";
import { withRecordFrom } from "./registry-pool-stub.mjs";

const odb = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  ensureTownJournal(db);
  return db;
};
const joinRow = (over = {}) => ({
  cls: "join", act: "declare-household", household: "testers", handle: "tester",
  ghId: "12345", ghLogin: "tester-gh", payload: { household: "Testers", card: "a card" }, ...over,
});

function sealedTown() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const dir = mkdtempSync(join(tmpdir(), "pm-drainsigns-"));
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  // a ledger opened the way the verifier demands — the genesis rules line,
  // sealed with the fixture's own key so the drain's line is entry 2
  const opening = "- 2026-06-12 · rules: stamps-v1";
  const seal = ENGINE.sealChain([opening])[0];
  const sig = edSign(null, Buffer.from(seal, "utf8"), createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" }))).toString("base64url");
  writeFileSync(join(dir, "WHITE_PAGES/stamp-ledger.md"), `# the ledger\n\n${opening} · sig: ${sig}\n`);
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const keyFile = join(dir, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  return { dir, keyFile };
}

const withEnv = async (over, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(over)) { prev[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  // AWAITED SINCE POS-158: the drain is async, and a `finally` that restored the
  // environment while the drain was still running would pull STAMP_KEY out from
  // under the signing subprocess.
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(prev)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
};

test("GREEN, the real pipe: a drained join appends a registry line the town's own verifier seals green", { skip: SKIP }, async () => {
  const { dir, keyFile } = sealedTown();
  const db = odb();
  appendTownJournal(db, joinRow());
  await withEnv({ STAMP_KEY: keyFile, STAMP_ENGINE_DIR: join(TOWN, "tools") }, () => withRecordFrom(dir, async () => {
    const plan = await planTownDrain(db, dir, { date: "2026-08-29" });
    const touched = await writeTownDrain(dir, plan, { date: "2026-08-29" });
    assert.ok(touched.includes("WHITE_PAGES/stamp-ledger.md"), "the ledger was appended");
  }));
  const text = readFileSync(join(dir, "WHITE_PAGES/stamp-ledger.md"), "utf8");
  assert.match(text, /registry: tester = hh:testers · sig: [A-Za-z0-9_-]{60,}/, "the line carries a base64url sig");
  const v = VERIFY.verifyStampLedger(dir);
  assert.equal((v.problems ?? []).length, 0, `the town's own verifier seals it green: ${JSON.stringify(v.problems)}`);
  rmSync(dir, { recursive: true, force: true });
});

test("CAN-FAIL: a mangled sig on the drain's line turns the town's verifier red — the oracle sees this line", { skip: SKIP }, async () => {
  const { dir, keyFile } = sealedTown();
  const db = odb();
  appendTownJournal(db, joinRow());
  await withEnv({ STAMP_KEY: keyFile, STAMP_ENGINE_DIR: join(TOWN, "tools") }, () => withRecordFrom(dir, async () => {
    await writeTownDrain(dir, await planTownDrain(db, dir, { date: "2026-08-29" }), { date: "2026-08-29" });
  }));
  const p = join(dir, "WHITE_PAGES/stamp-ledger.md");
  // Mangle the DRAIN's line deliberately and deterministically: a fixed wrong
  // sig of valid base64url shape (the first draft replaced one char with "X",
  // which is a no-op whenever the real char already IS "X" — a flaky mangle is
  // a can-fail proof that sometimes proves nothing).
  writeFileSync(p, readFileSync(p, "utf8").replace(
    /(registry: tester = hh:testers · sig: )[A-Za-z0-9_-]+/, `$1${"A".repeat(86)}`));
  const v = VERIFY.verifyStampLedger(dir);
  assert.ok((v.problems ?? []).length > 0, "a wrong signature is refused, not tolerated");
  rmSync(dir, { recursive: true, force: true });
});

test("REFUSE, never degrade: with the pen key absent the crossing writes NOTHING and every row stays queued", { skip: SKIP }, async () => {
  const { dir } = sealedTown();
  const db = odb();
  appendTownJournal(db, joinRow());
  const before = readFileSync(join(dir, "WHITE_PAGES/stamp-ledger.md"), "utf8");
  const report = await withEnv({ TOWN_SINGLE_LOG: "1", STAMP_KEY: join(dir, "no-such-key.pem"), STAMP_ENGINE_DIR: join(TOWN, "tools") }, () =>
    withRecordFrom(dir, () => runTownDrain(db, { db, clone: dir, lockHeld: () => true, log: () => {} })));
  assert.equal(report.refused, "ledger-pen-not-ready", "the crossing refuses by name");
  assert.equal(readFileSync(join(dir, "WHITE_PAGES/stamp-ledger.md"), "utf8"), before, "the ledger is byte-identical");
  assert.equal(townDrainCursor(db), 0, "the cursor did not move — every row is still here");
  rmSync(dir, { recursive: true, force: true });
});
