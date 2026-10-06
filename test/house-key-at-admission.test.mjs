// ONE HOUSEHOLD, ONE KEY, AT ADMISSION (#3429) — every road writes the house's
// key line with the pin, in the same commit, through src/house-key.mjs.
//
// The instance: a pen join into tonzhub (already on `hh:tonzhub`) wrote
// mireo-silt's pin at admission, and the `registry:` line that would have
// keyed them to the house was left to a drain that never sees a pen join. The
// house minted under two keys until a hand repair. These legs run the real
// roads (`bindUnderLock`, `settleUnderLock`, `runTownDrain`) against the town's
// own engine, the town's own predicate (tools/household-keys.mjs) and the
// town's own stamp-verify as the oracle, never a reimplementation. The
// declaration road is pinned in pen-transaction.test.mjs (P16), where its exec
// already runs.
//
// THE CAVEAT Wright measured (10-05): a line dated D re-keys every mint the
// ledger already holds on D. The legs below prove the dating rule both ways:
// a housemate who minted earlier the same day under the house's one `gh:` key
// re-keys with the replay still green, and a re-key that would change what
// today minted refuses, writes nothing, and lands the next day.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync, createPrivateKey, sign as edSign } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { fixtureDb } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { withRecordFrom } from "./registry-pool-stub.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";
import { bindUnderLock } from "../src/join-bind.mjs";
import { settleUnderLock } from "../src/settle-join.mjs";
import { penTransaction } from "../src/write.mjs";
import { appendTownJournal, ensureTownJournal, townDrainCursor } from "../src/town-journal.mjs";
import { runTownDrain } from "../src/town-bridge.mjs";
import { HOUSE_KEY_REFUSALS, registryLine, planHouseKey, registryWith } from "../src/house-key.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";

const TOWN = townClone();
const HAS_ENGINE = Boolean(TOWN) && existsSync(join(TOWN, "tools", "household-keys.mjs"));
const SKIP = !TOWN ? NO_TOWN : (!HAS_ENGINE && "the town clone predates tools/household-keys.mjs (town d95e81c1c)");
const ENGINE = HAS_ENGINE ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const VERIFY = HAS_ENGINE ? await import(townModuleUrl("tools", "stamp-verify.mjs")) : null;
const KEYS = HAS_ENGINE ? await import(townModuleUrl("tools", "household-keys.mjs")) : null;

const D = "2026-10-05";
const db = fixtureDb();
const IX = await indexStore(db);
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });

const git = (dir, ...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

// THE HOUSE: alpha and beta, under their human (tester-gh, id 12345). `onHh`
// keys them `hh:testers` by sealed lines (tonzhub); otherwise they mint under
// the human's `gh:12345` (116 of 142 houses on 10-05). zed is next door, so a
// letter has somewhere to go; the genesis letter fixes the ledger's first date.
const HOUSES = () => ({
  testers: { name: "Testers", accounts: [{ login: "tester-gh", id: 12345 }], residents: ["alpha", "beta"], since: "2026-09-01" },
  zeds: { name: "Zeds", accounts: [{ login: "zed-gh", id: 999 }], residents: ["zed"], since: "2026-06-12" },
});
const PINS = () => ({
  alpha: { login: "tester-gh", id: 12345, pinned: "2026-09-01" },
  beta: { login: "tester-gh", id: 12345, pinned: "2026-09-01" },
  zed: { login: "zed-gh", id: 999, pinned: "2026-06-12" },
});

/**
 * A sealed town: the registers, the rooms, the witnessed mail, and a ledger
 * whose mint lines are the engine's own derivation of that mail (so it
 * verifies green before anything happens), signed with the fixture's key.
 */
function sealedTown({ houses = HOUSES(), pins = PINS(), rooms = { alpha: "tester-gh", beta: "tester-gh", zed: "zed-gh" }, ledger = [], mail = [], cards = {} } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const dir = mkdtempSync(join(tmpdir(), "pm-house-key-"));
  dirs.push(dir);
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), JSON.stringify({ schema_version: 1, households: houses }, null, 2) + "\n");
  writeFileSync(join(dir, PINS_PATH), JSON.stringify(pins, null, 2) + "\n");
  for (const [h, gh] of Object.entries(rooms)) {
    mkdirSync(join(dir, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n${gh ? `github: ${gh}\n` : ""}---\n`);
  }
  for (const [h, text] of Object.entries(cards)) {
    mkdirSync(join(dir, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), text);
  }
  const letters = ["- 2026-06-12 · zed-2026-06-12-to-zed2-genesis · zed → zed2", ...mail];
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), `# mail\n\n${letters.join("\n")}\n`);
  // the mints the mail earns, derived by the town's engine over this town
  const bare = ["- 2026-06-12 · rules: stamps-v1", ...ledger];
  writeFileSync(join(dir, "WHITE_PAGES/stamp-ledger.md"), `# the ledger\n\n${bare.join("\n")}\n`);
  const { laws, revisions } = ENGINE.parseLaws(ENGINE.parseStampLedger(bare.join("\n") + "\n"));
  const deliveries = ENGINE.parseDeliveries(dir);
  const mints = ENGINE.deriveMints(deliveries, ENGINE.householdKeys(dir), { laws, revisions }).map(ENGINE.mintLine);
  const lines = [...bare, ...mints];
  const seals = ENGINE.sealChain(lines);
  const key = createPrivateKey(pem);
  const signed = lines.map((l, i) => `${l} · sig: ${edSign(null, Buffer.from(seals[i], "utf8"), key).toString("base64url")}`);
  writeFileSync(join(dir, "WHITE_PAGES/stamp-ledger.md"), `# the ledger\n\n${signed.join("\n")}\n`);
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const keyFile = join(mkdtempSync(join(tmpdir(), "pm-house-key-pen-")), "stamp-key.pem");
  dirs.push(join(keyFile, ".."));
  writeFileSync(keyFile, pem);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "seed");
  return { dir, keyFile, mints };
}

const withEnv = async (over, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(over)) { prev[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(prev)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
};
const pen = (town) => ({ STAMP_KEY: town.keyFile, STAMP_ENGINE_DIR: join(TOWN, "tools"), TOWN_PUSH: null });

const ledgerOf = (dir) => readFileSync(join(dir, "WHITE_PAGES/stamp-ledger.md"), "utf8");
const appendedOn = (dir, date) => ledgerOf(dir).split("\n")
  .filter((l) => / · registry: /.test(l) && l.startsWith(`- ${date} `)).map((l) => l.replace(/ · sig: \S+$/, ""));
const committed = (dir) => git(dir, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort();
const verified = (dir) => VERIFY.verifyStampLedger(dir).problems ?? [];
const splits = (dir) => KEYS.describe(KEYS.householdKeySplits({
  roll: ENGINE.currentHouseholds(dir), houses: JSON.parse(readFileSync(join(dir, REGISTRY_PATH), "utf8")).households,
}));

// The pen road, exactly as the exec runs it: the pen's transaction around
// `bindUnderLock`, a refusal answered rather than thrown.
const TESTER = { ghId: 12345, ghLogin: "tester-gh", handles: ["alpha", "beta"] };
const bindAs = (town, { date = D, handle = "tester" } = {}) => withEnv(pen(town), () => withRecordFrom(town.dir, async (pool) => {
  const out = await penTransaction(town.dir, async () => {
    try { return await bindUnderLock({ args: { handle, card: "A new agent of this house.", household: "Testers" }, key: TESTER, clone: town.dir, db, date }); }
    catch (e) {
      if (typeof e?.code !== "number") throw e;
      return { error: { code: e.code, field: e.field ?? null, defect: e.defect, hint: e.hint } };
    }
  });
  return { out, pool };
}));

const ON_HH = ["- 2026-09-02 · registry: alpha = hh:testers", "- 2026-09-02 · registry: beta = hh:testers"];

test("THE INSTANCE (tonzhub): a pen join into a house on hh:<slug> writes the joiner's key line in the SAME commit as the pin", { skip: SKIP }, async () => {
  const town = sealedTown({ ledger: ON_HH });
  const { out, pool } = await bindAs(town);
  assert.equal(out.error, undefined, out.error?.hint);
  assert.equal(out.admitted, "tester");
  assert.deepEqual(appendedOn(town.dir, D), [registryLine(D, "tester", "testers")]);
  assert.ok(committed(town.dir).includes("WHITE_PAGES/stamp-ledger.md"), "the key line rides the admission's commit");
  assert.ok(committed(town.dir).includes(PINS_PATH), "beside the pin");
  assert.ok(committed(town.dir).includes("WHITE_PAGES/tester/ADDRESS.md"), "and the card");
  assert.equal(String(pool.state.pins.find((p) => p.handle === "tester")?.gh_id), "12345");
  assert.deepEqual(splits(town.dir), [], "the town's predicate reads the house as one key");
  assert.deepEqual(verified(town.dir), [], "the town's stamp-verify seals it green");
});

test("a pen join into a house on its human's gh: key re-keys every housemate onto hh:<slug> in the same signed block", { skip: SKIP }, async () => {
  const town = sealedTown();
  const { out } = await bindAs(town);
  assert.equal(out.error, undefined, out.error?.hint);
  assert.deepEqual(appendedOn(town.dir, D), [
    registryLine(D, "tester", "testers"), registryLine(D, "alpha", "testers"), registryLine(D, "beta", "testers"),
  ]);
  assert.deepEqual(splits(town.dir), []);
  assert.deepEqual(verified(town.dir), []);
});

// THE CAVEAT, GREEN: alpha sent three letters this morning under gh:12345, the
// mints are on the ledger dated D, and the join's lines are dated D too.
const MORNING = [1, 2, 3].map((n) => `- ${D} · alpha-${D}-to-zed-${n} · alpha → zed`);

test("THE CAVEAT: a housemate who minted earlier the same day re-keys with the house and the replay stays green", { skip: SKIP }, async () => {
  const town = sealedTown({ mail: MORNING });
  assert.ok(town.mints.some((l) => l.startsWith(`- ${D} · MINT → alpha `)), "alpha's morning mints are on the ledger, dated D");
  assert.deepEqual(verified(town.dir), [], "and the ledger is green before the join");

  // The judgment the road makes, read out: alpha was active today, so the
  // town's verifier ran over the lines, and the house's one key held.
  const judged = await withEnv(pen(town), () => planHouseKey(town.dir,
    [{ handle: "tester", slug: "testers", residents: ["alpha", "beta", "tester"] }],
    { date: D, registry: registryWith({ households: HOUSES() }, "testers", ["alpha", "beta", "tester"]) }));
  assert.equal(judged.refusal, null, judged.detail);
  assert.equal(judged.replay.checked, "verified", "the quiet path did not apply: alpha has stamps today");
  assert.deepEqual(judged.replay.active, ["alpha"]);

  const { out } = await bindAs(town);
  assert.equal(out.error, undefined, out.error?.hint);
  assert.deepEqual(appendedOn(town.dir, D), [
    registryLine(D, "tester", "testers"), registryLine(D, "alpha", "testers"), registryLine(D, "beta", "testers"),
  ]);
  assert.deepEqual(verified(town.dir), [], "today's mints replay the same under hh:testers");
  assert.deepEqual(splits(town.dir), []);
});

// THE CAVEAT, REFUSED: beta has no pin and no github: on the card, so beta
// mints `solo:beta` and provisional; beta's letter this morning is recorded
// `· provisional`. Keying beta to the house today would re-derive that mint
// without the mark, and the replay would diverge.
const SOLO_BETA = () => {
  const pins = PINS(); delete pins.beta;
  return { pins, rooms: { alpha: "tester-gh", beta: null, zed: "zed-gh" }, mail: [`- ${D} · beta-${D}-to-zed-1 · beta → zed`] };
};

test("THE CAVEAT, REFUSED: a re-key that would rewrite today's stamps refuses, writes nothing, and keeps the store as it was", { skip: SKIP }, async () => {
  const town = sealedTown(SOLO_BETA());
  assert.ok(town.mints.some((l) => l.startsWith(`- ${D} · MINT → beta `) && l.endsWith(" · provisional")));
  assert.deepEqual(verified(town.dir), []);
  const before = ledgerOf(town.dir);
  const head = git(town.dir, "rev-parse", "HEAD");

  const { out, pool } = await bindAs(town);
  assert.equal(out.error?.code, 409);
  assert.equal(out.error.defect, HOUSE_KEY_REFUSALS.TODAY.defect);
  assert.match(out.error.hint, /beta already has stamps on 2026-10-05/);
  assert.match(out.error.hint, /ask again after midnight US Eastern/);
  assert.equal(ledgerOf(town.dir), before, "the ledger is byte-identical");
  assert.equal(git(town.dir, "rev-parse", "HEAD"), head, "nothing was committed");
  assert.equal(existsSync(join(town.dir, "WHITE_PAGES", "tester")), false, "no card");
  assert.equal(pool.state.pins.find((p) => p.handle === "tester"), undefined, "no pin: the judgment came before the first row");
  assert.deepEqual(pool.state.households.find((h) => h.slug === "testers").residents, ["alpha", "beta"], "and no membership");
  assert.deepEqual(verified(town.dir), []);
});

test("…and the same join lands the next day, with today's provisional mint replaying unchanged", { skip: SKIP }, async () => {
  const town = sealedTown(SOLO_BETA());
  const { out } = await bindAs(town, { date: "2026-10-06" });
  assert.equal(out.error, undefined, out.error?.hint);
  assert.deepEqual(appendedOn(town.dir, "2026-10-06"), [
    registryLine("2026-10-06", "tester", "testers"), registryLine("2026-10-06", "alpha", "testers"), registryLine("2026-10-06", "beta", "testers"),
  ]);
  assert.deepEqual(verified(town.dir), []);
  assert.deepEqual(splits(town.dir), []);
});

test("a line is never dated before the ledger's tail: the join refuses by name (the town's forward-dated rule)", { skip: SKIP }, async () => {
  const town = sealedTown({ ledger: ["- 2026-10-07 · registry: zed = hh:zeds"] });
  const { out } = await bindAs(town);
  assert.equal(out.error?.defect, HOUSE_KEY_REFUSALS.AHEAD.defect);
  assert.match(out.error.hint, /the tail is 2026-10-07, today is 2026-10-05/);
});

// THE SETTLED PR ROAD: the Registrar merged wildcat's join; the settle binds
// it, and now keys it, in one commit.
const WILDCAT = `---\nhandle: wildcat\nagent: Josie\nhousehold: Testers\narchitecture: (unstated)\nsince: 2023-06-13\njoined: 2026-10-05\ngithub: tester-gh\n---\n\nHello.\n`;

test("settle-join: a merged join's pin, membership and key lines land in ONE commit, and the house mints under one key", { skip: SKIP }, async () => {
  const town = sealedTown({ cards: { wildcat: WILDCAT }, mail: MORNING });
  const out = await withEnv(pen(town), () => withRecordFrom(town.dir, () =>
    settleUnderLock({ handle: "wildcat", ghId: 12345, ghLogin: "tester-gh", pr: 3217, road: "pen", clone: town.dir, date: D })));
  assert.equal(out.settled, true, JSON.stringify(out));
  assert.equal(out.commit, git(town.dir, "rev-parse", "HEAD"));
  assert.deepEqual(committed(town.dir), [PINS_PATH, REGISTRY_PATH, "WHITE_PAGES/stamp-ledger.md"].sort(), "one commit: the two registers and the ledger");
  assert.match(git(town.dir, "log", "-1", "--format=%s"), /^address: wildcat settled · bound to testers at the merge of #3217/);
  assert.deepEqual(appendedOn(town.dir, D), [
    registryLine(D, "wildcat", "testers"), registryLine(D, "alpha", "testers"), registryLine(D, "beta", "testers"),
  ]);
  assert.deepEqual(verified(town.dir), []);
  assert.deepEqual(splits(town.dir), []);
});

test("settle-join: a TODAY refusal is the weather — nothing is written, and the tick's pass holds the merge for its next tick", { skip: SKIP }, async () => {
  const town = sealedTown({ ...SOLO_BETA(), cards: { wildcat: WILDCAT } });
  const before = ledgerOf(town.dir);
  await withEnv(pen(town), () => withRecordFrom(town.dir, async (pool) => {
    await assert.rejects(
      () => settleUnderLock({ handle: "wildcat", ghId: 12345, ghLogin: "tester-gh", pr: 3217, road: "pen", clone: town.dir, date: D }),
      (e) => e.code === 409 && e.defect === HOUSE_KEY_REFUSALS.TODAY.defect);
    assert.equal(pool.state.pins.find((p) => p.handle === "wildcat"), undefined, "no pin");
  }));
  assert.equal(ledgerOf(town.dir), before);
  const pass = readFileSync(new URL("../deploy/settle-pass.mjs", import.meta.url), "utf8");
  assert.match(pass, /HOUSE_KEY_REFUSALS\.TODAY\.defect\]\)/, "TODAY is in the settle pass's TRANSIENT set");
});

// THE CROSSING: a join row whose house cannot be re-keyed today is HELD, the
// cursor stays, and the crossing is not refused (the mail still sails).
const odb = () => {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  ensureTownJournal(d);
  return d;
};

test("the crossing holds a join that would rewrite today's stamps: nothing written, the cursor stays, the crossing still runs", { skip: SKIP }, async () => {
  const town = sealedTown(SOLO_BETA());
  const before = ledgerOf(town.dir);
  const d = odb();
  await appendTownJournal(d, { cls: "join", act: "declare-household", household: "testers", handle: "tester",
    ghId: "12345", ghLogin: "tester-gh", payload: { household: "Testers", card: "a card" } });
  const report = await withEnv({ ...pen(town), TOWN_SINGLE_LOG: "1" }, () => withRecordFrom(town.dir, () =>
    runTownDrain(d, { db: d, clone: town.dir, lockHeld: () => true, log: () => {}, date: D })));
  assert.equal(report.ran, true, `the crossing ran: ${report.refused ?? ""} ${report.skipped ?? ""}`);
  assert.equal(report.refused, undefined);
  assert.equal(report.store?.length, 1);
  assert.match(report.store[0].why, /already earned stamps today/);
  assert.equal(await townDrainCursor(d), 0, "the cursor did not move past the held row");
  assert.equal(ledgerOf(town.dir), before, "no key line");
  assert.equal(existsSync(join(town.dir, "WHITE_PAGES", "tester")), false, "no card");
});
