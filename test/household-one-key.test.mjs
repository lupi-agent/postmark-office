// ONE HOUSEHOLD, ONE MINT KEY (Darko, 2026-10-04) — the drain's writer and its
// refusal, through the real pipe.
//
// The instance: a join into an existing house wrote ONE `registry:` line, for
// the joiner, so the residents already there kept their human's `gh:` key and
// the house minted as two households with two daily caps (nine houses on
// 2026-10-04; Kev's minted 10 sends on 10-03). These legs run the real
// planTownDrain / writeTownDrain / runTownDrain, the town's own engine, the
// town's own predicate (tools/household-keys.mjs) and the town's stamp-verify as
// the oracle — never a reimplementation (the drain-signs.test.mjs precedent).

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync, createPrivateKey, sign as edSign } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { appendTownJournal, ensureTownJournal, townDrainCursor } from "../src/town-journal.mjs";
import { planTownDrain, writeTownDrain, registryLine } from "../src/town-drain.mjs";
import { runTownDrain } from "../src/town-bridge.mjs";
import { REGISTRY_PATH } from "../src/residency.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";
import { withRecordFrom } from "./registry-pool-stub.mjs";

const TOWN = townClone();
// The predicate is the town's, so the clone must carry it (town d95e81c1c+).
const HAS_PREDICATE = Boolean(TOWN) && existsSync(join(TOWN, "tools", "household-keys.mjs"));
const VERIFY = HAS_PREDICATE ? await import(townModuleUrl("tools", "stamp-verify.mjs")) : null;
const ENGINE = HAS_PREDICATE ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const KEYS = HAS_PREDICATE ? await import(townModuleUrl("tools", "household-keys.mjs")) : null;
const SKIP = !TOWN ? NO_TOWN : (!HAS_PREDICATE && "the town clone predates tools/household-keys.mjs (town d95e81c1c)");

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

// A sealed town: the genesis rules line plus any registry lines, signed with
// the fixture's own key; `houses` is the record; `pins` and `rooms` give the
// residents their base keys (a pin is `gh:<id>`).
function sealedTown({ houses = {}, pins = {}, rooms = [], ledger = [] } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const dir = mkdtempSync(join(tmpdir(), "pm-onekey-"));
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), JSON.stringify({ schema_version: 1, households: houses }, null, 2) + "\n");
  writeFileSync(join(dir, "tools", "github-ids.json"), JSON.stringify(pins));
  for (const h of rooms) {
    mkdirSync(join(dir, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n`);
  }
  const lines = ["- 2026-06-12 · rules: stamps-v1", ...ledger];
  const seals = ENGINE.sealChain(lines);
  const key = createPrivateKey(pem);
  const signed = lines.map((l, i) => `${l} · sig: ${edSign(null, Buffer.from(seals[i], "utf8"), key).toString("base64url")}`);
  writeFileSync(join(dir, "WHITE_PAGES/stamp-ledger.md"), `# the ledger\n\n${signed.join("\n")}\n`);
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const keyFile = join(dir, "stamp-key.pem");
  writeFileSync(keyFile, pem);
  return { dir, keyFile };
}

const withEnv = async (over, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(over)) { prev[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(prev)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
};

const appended = (dir) => readFileSync(join(dir, "WHITE_PAGES/stamp-ledger.md"), "utf8")
  .split("\n").filter((l) => / · registry: /.test(l) && /2026-10-04/.test(l))
  .map((l) => l.replace(/ · sig: \S+$/, ""));

// Kev's house, in miniature: two residents on their human's gh: key.
const SPLIT_PRONE = () => ({
  houses: { testers: { name: "Testers", accounts: [{ login: "tester-gh", id: 12345 }], residents: ["alpha", "beta"] } },
  pins: { alpha: { id: 12345 }, beta: { id: 12345 } },
  rooms: ["alpha", "beta"],
});

async function drainOnce(town, rows, opts = {}) {
  const db = odb();
  for (const r of rows) await appendTownJournal(db, r);
  return withEnv({ STAMP_KEY: town.keyFile, STAMP_ENGINE_DIR: join(TOWN, "tools") }, () => withRecordFrom(town.dir, async () => {
    if (opts.run) return { db, report: await runTownDrain(db, { db, clone: town.dir, lockHeld: () => true, log: () => {}, ...opts.run }) };
    const plan = await planTownDrain(db, town.dir, { date: "2026-10-04" });
    await writeTownDrain(town.dir, plan, { date: "2026-10-04" });
    return { db };
  }));
}

test("THE INSTANCE: a joiner into a house whose residents are on gh:<id> writes lines for ALL of them, and the house mints under one key", { skip: SKIP }, async () => {
  const town = sealedTown(SPLIT_PRONE());
  await drainOnce(town, [joinRow()]);
  assert.deepEqual(appended(town.dir), [
    registryLine("2026-10-04", "tester", "testers"),
    registryLine("2026-10-04", "alpha", "testers"),
    registryLine("2026-10-04", "beta", "testers"),
  ]);
  assert.deepEqual(VERIFY.verifyStampLedger(town.dir).problems ?? [], [], "the town's own verifier seals the block green");
  // and the town's predicate reads the house as one key
  const roll = ENGINE.currentHouseholds(town.dir);
  const houses = JSON.parse(readFileSync(join(town.dir, REGISTRY_PATH), "utf8")).households;
  assert.deepEqual(KEYS.describe(KEYS.householdKeySplits({ roll, houses })), []);
  rmSync(town.dir, { recursive: true, force: true });
});

test("a joiner into a house already on hh:<slug> writes only its own line", { skip: SKIP }, async () => {
  const town = sealedTown({ ...SPLIT_PRONE(), ledger: [
    "- 2026-09-01 · registry: alpha = hh:testers", "- 2026-09-01 · registry: beta = hh:testers"] });
  await drainOnce(town, [joinRow()]);
  assert.deepEqual(appended(town.dir), [registryLine("2026-10-04", "tester", "testers")]);
  assert.deepEqual(VERIFY.verifyStampLedger(town.dir).problems ?? [], []);
  rmSync(town.dir, { recursive: true, force: true });
});

test("the first resident of a new house writes only its own line", { skip: SKIP }, async () => {
  const town = sealedTown();
  await drainOnce(town, [joinRow()]);
  assert.deepEqual(appended(town.dir), [registryLine("2026-10-04", "tester", "testers")]);
  assert.deepEqual(VERIFY.verifyStampLedger(town.dir).problems ?? [], []);
  rmSync(town.dir, { recursive: true, force: true });
});

test("two joins into one gh: house in one crossing re-key each housemate ONCE", { skip: SKIP }, async () => {
  const town = sealedTown(SPLIT_PRONE());
  await drainOnce(town, [joinRow(), joinRow({ handle: "tester2", payload: { household: "Testers", card: "b" } })]);
  assert.deepEqual(appended(town.dir), [
    registryLine("2026-10-04", "tester", "testers"),
    registryLine("2026-10-04", "alpha", "testers"),
    registryLine("2026-10-04", "beta", "testers"),
    registryLine("2026-10-04", "tester2", "testers"),
  ]);
  assert.deepEqual(VERIFY.verifyStampLedger(town.dir).problems ?? [], []);
  rmSync(town.dir, { recursive: true, force: true });
});

// THE REFUSAL AT WRITE TIME. The planner is injected as the OLD one-line writer
// (the joiner alone), which is exactly the crossing that split nine houses.
const joinerOnly = (plans, { date, keys }) => {
  const now = new Map(keys);
  const lines = plans.map(({ row, plan: p }) => {
    const slug = p?.slug ?? row.household;
    now.set(row.handle, `hh:${slug}`);
    return { seq: row.seq, handle: row.handle, key: `hh:${slug}`, line: registryLine(date, row.handle, slug) };
  });
  return { lines, keys: now };
};

test("REFUSE, never fix silently: a crossing that would split a house writes NOTHING, holds the cursor, and names the house and its keys", { skip: SKIP }, async () => {
  const town = sealedTown(SPLIT_PRONE());
  const before = readFileSync(join(town.dir, "WHITE_PAGES/stamp-ledger.md"), "utf8");
  const { db, report } = await withEnv({ TOWN_SINGLE_LOG: "1" }, () =>
    drainOnce(town, [joinRow()], { run: { planLines: joinerOnly } }));
  assert.equal(report.refused, "household-split", "the crossing refuses by name");
  assert.match(report.skipped, /testers mints under 2 keys: gh:12345 \(alpha, beta\) · hh:testers \(tester\)/);
  assert.match(report.skipped, /Nothing was written and the cursor did not move/);
  assert.equal(readFileSync(join(town.dir, "WHITE_PAGES/stamp-ledger.md"), "utf8"), before, "the ledger is byte-identical");
  assert.ok(!existsSync(join(town.dir, "WHITE_PAGES", "tester")), "no card was written");
  assert.equal(await townDrainCursor(db), 0, "the cursor did not move: every row is still here");
  rmSync(town.dir, { recursive: true, force: true });
});

test("the same crossing through the real planner lands, and the house mints under one key", { skip: SKIP }, async () => {
  const town = sealedTown(SPLIT_PRONE());
  // runTownDrain commits what it writes, so this clone is a repository
  const git = (...a) => execFileSync("git", ["-C", town.dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdio: "pipe" });
  git("init", "-q"); git("add", "-A"); git("commit", "-qm", "seed");
  const { report } = await withEnv({ TOWN_SINGLE_LOG: "1" }, () => drainOnce(town, [joinRow()], { run: {} }));
  assert.ok(!report.refused, `the crossing did not refuse: ${report.refused} ${report.skipped ?? ""}`);
  assert.deepEqual(appended(town.dir).length, 3);
  assert.deepEqual(VERIFY.verifyStampLedger(town.dir).problems ?? [], []);
  rmSync(town.dir, { recursive: true, force: true });
});
