// stamp-mint-run.test.mjs — the mint decides from the store and writes what the
// town's own --append writes, byte for byte (POS-341, Q4).
//
//   node --test test/stamp-mint-run.test.mjs
//
// Two copies of one fixture town, built from the pinned town-clone's own files:
// every room and its ADDRESS, the pins, the first 3,000 lines of the live mail
// ledger, and the first 200 canonicals of the live stamp ledger RE-SIGNED under a
// throwaway key (the live key never leaves the box). Copy A runs the town's
// `tools/stamp-mint.mjs --append`. Copy B runs world2/tools/stamp-mint-run.mjs
// against a real Postgres holding B's pins, rooms, mail lines and chain. The two
// ledgers must be byte-equal, the store must hold B's export line for line, and
// a second pass must find nothing owed. The runner must read the STORE: a pin
// missing from the store changes what it owes.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";
import { mintInputsVia, writeMintInputs } from "../src/mint-inputs.mjs";
import { stampLinesVia, syncStampLinesVia, verifyStampLinesVia } from "../src/stamp-lines.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLONE = join(ROOT, "town-clone");
const hasClone = existsSync(join(CLONE, "tools", "stamp-mint.mjs")) && existsSync(join(CLONE, "WHITE_PAGES", "stamp-ledger.md"));
const skip = hasClone ? false : "no town-clone beside the office: the fixture is built from its files";
const MAIL_LINES = 3000, STAMP_LINES = 200;

const tmp = mkdtempSync(join(tmpdir(), "stamp-mint-run-"));
const A = join(tmp, "a"), B = join(tmp, "b");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PRIV = privateKey.export({ type: "pkcs8", format: "pem" });
const keyFile = join(tmp, "key.pem");
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

let store, owner, ingester, office, engine, runner;
before(async () => {
  if (skip) return;
  engine = await import(pathToFileURL(join(CLONE, "tools", "stamp-mint.mjs")).href);
  // the fixture town
  cpSync(join(CLONE, "tools"), join(A, "tools"), { recursive: true });
  writeFileSync(join(A, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(keyFile, PRIV);
  for (const e of readdirSync(join(CLONE, "WHITE_PAGES"), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    mkdirSync(join(A, "WHITE_PAGES", e.name), { recursive: true });
    const addr = join(CLONE, "WHITE_PAGES", e.name, "ADDRESS.md");
    if (existsSync(addr)) cpSync(addr, join(A, "WHITE_PAGES", e.name, "ADDRESS.md"));
  }
  const mail = readFileSync(join(CLONE, "WHITE_PAGES", "mail-ledger.md"), "utf8").replace(/\r\n/g, "\n").split("\n").filter((l) => l.startsWith("- ")).slice(0, MAIL_LINES);
  writeFileSync(join(A, "WHITE_PAGES", "mail-ledger.md"), `# Mail ledger\n\n${mail.join("\n")}\n`);
  const canon = engine.parseStampLedger(readFileSync(join(CLONE, "WHITE_PAGES", "stamp-ledger.md"), "utf8")).slice(0, STAMP_LINES).map((e) => e.canonical);
  engine.appendSigned(A, canon, PRIV);
  git(A, "init", "-q"); git(A, "config", "core.autocrlf", "false");
  git(A, "add", "-A"); git(A, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "the fixture town");
  cpSync(A, B, { recursive: true });

  // B's inputs, in a real store
  store = await startStore({ db: "stamp_mint_run" });
  owner = await store.connect("world2_owner");
  ingester = await store.connect("law_ingester");
  office = await store.connect("office_api");
  const rows = rowsFromRegistry(null, JSON.parse(readFileSync(join(B, "tools", "github-ids.json"), "utf8")));
  for (const p of rows.pins)
    await owner.query(`INSERT INTO household_pins (handle, login, gh_id, pinned, renamed, note, retired, renamed_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.handle, p.login ?? "", p.gh_id, p.pinned ?? null, p.renamed ?? null, p.note ?? null, p.retired ?? null, p.renamed_to ?? null]);
  await ingester.query("BEGIN"); await writeMintInputs(ingester, B); await ingester.query("COMMIT");
  await office.query("BEGIN"); await syncStampLinesVia(office, B, { engine }); await office.query("COMMIT");
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), TOWN_PUSH: "" });
  runner = await import("../world2/tools/stamp-mint-run.mjs");
});
after(async () => {
  for (const c of [owner, ingester, office]) if (c) await c.end().catch(() => {});
  if (store?.stop) await store.stop();
  rmSync(tmp, { recursive: true, force: true });
});

test("the runner, deciding from the store, writes the ledger the town's --append writes, byte for byte", async (t) => {
  if (skip) return t.skip(skip);
  const cli = execFileSync(process.execPath, [join(A, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", A], { encoding: "utf8" });
  const out = await runner.mintFromStore(B, { keyPem: PRIV });
  console.log(`# town: ${cli.trim()}\n# runner: ${out.summary}`);
  assert.ok(out.appended > 0, "the fixture owes lines");
  const a = readFileSync(join(A, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
  const b = readFileSync(join(B, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
  assert.equal(b, a, "the two ledgers are byte-equal");
  assert.ok(out.commit && git(B, "log", "-1", "--format=%s").trim() === "mint: crossing pass", "the runner committed the export");
  const v = await verifyStampLinesVia(office, B, { engine });
  assert.deepEqual(v.problems, [], "the store holds the export line for line, its chain verified");
});

test("a second pass owes nothing", async (t) => {
  if (skip) return t.skip(skip);
  const out = await runner.mintFromStore(B, { keyPem: PRIV });
  assert.equal(out.appended, 0);
});

test("it reads the store: the store's key base moved changes what it owes", async (t) => {
  if (skip) return t.skip(skip);
  // Against the ledger BEFORE the pass, so there is something owed to compare.
  const all = await stampLinesVia(office);
  const entries = all.slice(0, STAMP_LINES);
  const inputs = await mintInputsVia(office);
  const real = runner.owedFromStore(engine, { entries, ...inputs });
  // A room with no pin and no ADDRESS login mints `· provisional`; give the store
  // a pin for one such sender and its lines lose the marker.
  const senders = new Set(inputs.mailLines.map((l) => / · (\S+) → /.exec(l)?.[1]).filter(Boolean));
  const solo = [...inputs.rooms.entries()].find(([h, login]) => !login && !(h in inputs.pins) && senders.has(h));
  const pins = solo ? { ...inputs.pins, [solo[0]]: { login: "fixture", id: 999999999 } } : null;
  // Failing that, two handles sharing one account are one house with one cap:
  // drop one pin and the house splits, two caps.
  const byId = new Map();
  for (const [h, rec] of Object.entries(inputs.pins)) if (rec?.id && senders.has(h)) byId.set(rec.id, [...(byId.get(rec.id) ?? []), h]);
  const shared = [...byId.values()].find((hs) => hs.length > 1);
  const split = shared ? Object.fromEntries(Object.entries(inputs.pins).filter(([h]) => h !== shared[0])) : null;
  const moved = runner.owedFromStore(engine, { entries, ...inputs, pins: pins ?? split });
  assert.ok(pins || split, "the fixture has a solo sender or a shared account to move");
  assert.notDeepEqual(moved.lines, real.lines, `the store's key base moved (${solo ? `${solo[0]} pinned` : `${shared[0]} unpinned from a shared account`}), and the mint owes differently`);
});

test("an empty input is a refusal by name, and the export is left as it arrived", async (t) => {
  if (skip) return t.skip(skip);
  const C = join(tmp, "c");
  cpSync(A, C, { recursive: true });
  writeFileSync(join(C, "WHITE_PAGES", "mail-ledger.md"), readFileSync(join(C, "WHITE_PAGES", "mail-ledger.md"), "utf8") + "- 2099-01-01 · x · a → b · thread: new\n");
  const before = readFileSync(join(C, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
  await owner.query("DELETE FROM town_rooms");
  try {
    await assert.rejects(runner.mintFromStore(C, { keyPem: PRIV }), /town_rooms is empty/);
    assert.equal(readFileSync(join(C, "WHITE_PAGES", "stamp-ledger.md"), "utf8"), before);
  } finally {
    await ingester.query("BEGIN"); await writeMintInputs(ingester, B); await ingester.query("COMMIT");
  }
});
