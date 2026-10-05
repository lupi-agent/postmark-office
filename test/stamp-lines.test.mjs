// stamp-lines.test.mjs — the stamp ledger's chain in the store (POS-341, Q1), on a real Postgres.
//
//   node --test test/stamp-lines.test.mjs
//
// The writer records only lines whose signature verifies over the recomputed
// seal, past the store's last row, and refuses (writing nothing) on a forged
// line, an unsigned line, a changed past or an export shorter than the store.
// The verifier walks the store's whole chain and holds the export to it byte
// for byte. The pen's commit and the store's rows land together or not at all.
// The ledgers here are signed by the town's own engine under a throwaway key.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";
import { stampedCommit, syncStampLinesVia, verifyStampLinesVia } from "../src/stamp-lines.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLONE = join(ROOT, "town-clone");
const skip = existsSync(join(CLONE, "tools", "stamp-mint.mjs")) ? false : "no town-clone beside the office: the town's engine signs the fixtures";
const LEDGER = join("WHITE_PAGES", "stamp-ledger.md");

const tmp = mkdtempSync(join(tmpdir(), "stamp-lines-"));
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PRIV = privateKey.export({ type: "pkcs8", format: "pem" });
const PUB = publicKey.export({ type: "spki", format: "pem" });
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let n = 0;
const line = (i) => `- 2026-07-0${1 + (i % 9)} · rules: stamps-v1-${i}`;

let engine, store, office, owner;
/** A town with `count` signed lines, as a git repo whose origin is a bare repo beside it. */
function town(count) {
  const dir = join(tmp, `town-${++n}`);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(dir, "tools", "stamp-pubkey.pem"), PUB);
  engine.appendSigned(dir, Array.from({ length: count }, (_, i) => line(i)), PRIV);
  git(dir, "init", "-q", "-b", "main"); git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A"); git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed");
  const origin = `${dir}.git`;
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  git(dir, "remote", "add", "origin", origin); git(dir, "push", "-q", "-u", "origin", "main");
  return dir;
}
const held = async () => Number((await office.query("SELECT count(*) n FROM stamp_lines")).rows[0].n);
const sync = async (dir) => { await office.query("BEGIN"); try { const r = await syncStampLinesVia(office, dir, { engine }); await office.query("COMMIT"); return r; } catch (e) { await office.query("ROLLBACK"); throw e; } };
const reset = () => owner.query("DELETE FROM stamp_lines");

before(async () => {
  if (skip) return;
  engine = await import(pathToFileURL(join(CLONE, "tools", "stamp-mint.mjs")).href);
  store = await startStore({ db: "stamp_lines_test" });
  office = await store.connect("office_api");
  owner = await store.connect("world2_owner");
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), STAMP_LINES: "store", TOWN_PUSH: "1",
    BOT_NAME: "postmark-office[bot]", BOT_EMAIL: "office@postmark.invalid" });
});
after(async () => {
  for (const c of [office, owner]) if (c) await c.end().catch(() => {});
  if (store?.stop) await store.stop();
  rmSync(tmp, { recursive: true, force: true });
});

test("the writer records every signed line once, and only what is new", async (t) => {
  if (skip) return t.skip(skip);
  await reset();
  const dir = town(5);
  assert.deepEqual(await sync(dir), { held: 0, inserted: 5 });
  assert.deepEqual(await sync(dir), { held: 5, inserted: 0 }, "a second sync records nothing");
  engine.appendSigned(dir, [line(5), line(6)], PRIV);
  assert.deepEqual(await sync(dir), { held: 5, inserted: 2 });
  const v = await verifyStampLinesVia(office, dir, { engine });
  assert.deepEqual(v.problems, []);
  assert.equal(v.held, 7);
});

test("the writer refuses, writing nothing: a forged line, an unsigned line, a changed past, a shorter export", async (t) => {
  if (skip) return t.skip(skip);
  await reset();
  const dir = town(4);
  await sync(dir);
  const path = join(dir, LEDGER);
  const good = readFileSync(path, "utf8");

  engine.appendSigned(dir, [line(4)], PRIV);
  writeFileSync(path, readFileSync(path, "utf8").replace(line(4), line(4).replace("rules", "ruled")));
  await assert.rejects(sync(dir), /signature does not verify/, "a canonical edited under its old signature");
  assert.equal(await held(), 4);

  writeFileSync(path, good + `${line(9)}\n`);
  await assert.rejects(sync(dir), /UNSIGNED/);
  assert.equal(await held(), 4);

  const other = town(4); // the same canonicals with line 2 changed, re-signed whole: valid, and not the store's past
  const lines = engine.parseStampLedger(readFileSync(join(other, LEDGER), "utf8")).map((e) => e.canonical);
  lines[1] = "- 2026-07-02 · rules: a-different-past";
  rmSync(join(other, LEDGER)); engine.appendSigned(other, lines, PRIV);
  await assert.rejects(sync(other), /past changed/);
  assert.equal(await held(), 4);

  const short = town(2);
  await assert.rejects(sync(short), /export lost lines/);
  assert.equal(await held(), 4);
  writeFileSync(path, good);
});

test("the verifier says when the store is behind its export, and when the export lost a line", async (t) => {
  if (skip) return t.skip(skip);
  await reset();
  const dir = town(3);
  await sync(dir);
  engine.appendSigned(dir, [line(3)], PRIV);
  const behind = await verifyStampLinesVia(office, dir, { engine });
  assert.equal(behind.ok, false);
  assert.match(behind.problems.join("\n"), /past the store's 3/);
  const path = join(dir, LEDGER);
  writeFileSync(path, readFileSync(path, "utf8").split("\n").filter((l) => !l.includes("stamps-v1-3")).join("\n"));
  await sync(dir);
  writeFileSync(path, readFileSync(path, "utf8").split("\n").filter((l) => !l.includes("stamps-v1-2")).join("\n"));
  const lost = await verifyStampLinesVia(office, dir, { engine });
  assert.equal(lost.ok, false);
  assert.match(lost.problems.join("\n"), /differs from the store's|missing from the export/);
});

test("THE PEN'S TRANSACTION: a commit that lands records its lines; one git refuses records nothing", async (t) => {
  if (skip) return t.skip(skip);
  await reset();
  const dir = town(3);
  await sync(dir);
  engine.appendSigned(dir, [line(3)], PRIV);
  const commit = await stampedCommit(dir, [join(dir, LEDGER)], "stake: a test line", { engine });
  assert.ok(commit, "the commit landed");
  assert.equal(git(dir, "rev-parse", "HEAD").trim(), git(`${dir}.git`, "rev-parse", "main").trim(), "and reached origin");
  assert.equal(await held(), 4, "its line is recorded");

  engine.appendSigned(dir, [line(4)], PRIV);
  git(dir, "remote", "set-url", "origin", join(tmp, "no-such-origin.git"));
  await assert.rejects(stampedCommit(dir, [join(dir, LEDGER)], "stake: one that cannot land", { engine }));
  assert.equal(await held(), 4, "the store rolled back with the commit: nothing recorded");
  assert.equal(git(dir, "log", "-1", "--format=%s").trim(), "stake: a test line", "and the pen unmade its unlanded commit");
});

test("with the switch off it is the plain pen commit and the store is not touched", async (t) => {
  if (skip) return t.skip(skip);
  await reset();
  const dir = town(2);
  engine.appendSigned(dir, [line(2)], PRIV);
  const commit = await stampedCommit(dir, [join(dir, LEDGER)], "stake: switch off", { env: { ...process.env, STAMP_LINES: "" } });
  assert.ok(commit);
  assert.equal(await held(), 0);
});
