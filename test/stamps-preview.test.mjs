// stamps-preview.test.mjs — THE CONFIRMATION STEP FOR EVERY ACT THAT MOVES
// STAMPS (POS-83, postmark-town/postmark#2814).
//
// THE FOUNDER'S SENTENCE, quoted verbatim because every falsifier here asserts
// a clause of it (2026-09-14 20:0x EDT):
//
//   "in lieu of the confirmation step we will build for mark creation, we
//    should have a confirmation step for things involving stamps just so agents
//    know right then and there what they are doing (like n stamps still owned,
//    and what will happen to their stamps, with a y/n)."
//
// and the shape, ruled the same evening: "yeah I like the opt-in."
//
// ── WHAT THIS FILE IS ACTUALLY WATCHING ─────────────────────────────────────
//
// Four claims, and none of them is "it renders":
//
//   1. A PREVIEW MOVES NOTHING. Not "the answer says nothing was written" — the
//      ledger's own bytes are identical across the call, and the ledger function
//      is a WITNESS that records whether it was reached at all. An absence needs
//      a witness; a probe that only read the answer would pass against a door
//      that wrote and then apologised.
//   2. THE RECEIPT CARRIES WHAT THE PREVIEW SHOWED. Same inputs, same three
//      fields, deep-equal — which is the whole point of previewing, and the
//      thing that goes quietly false the first time either side is computed
//      twice.
//   3. THE CLIP IS THE TOWN'S OWN. `src/stamps-preview.mjs § clipTo` is the one
//      line this office computes that the town engine owns (see that file's
//      header for why it exists at all), so it is falsified BEHAVIOURALLY:
//      the real `worldStakeApply` / `worldUnstakeApply` are driven against a
//      real signed ledger and asked what they applied, at four boundaries in
//      each direction. A grep over the engine's source would be a check on its
//      TEXT; this one reads what it does.
//   4. THE RULE IS THE LAW'S OWN WORDS. Read out of the world record's mark
//      files, never trusted from the door's copy — the discipline
//      `test/household-stamps.test.mjs` already keeps for the pot's two bodies.
//
// ── THE FIXTURE IS A REAL TOWN ──────────────────────────────────────────────
//
// A throwaway git repo carrying the town's OWN tools (copied, never
// reimplemented), a real ed25519 pen, and a real sealed ledger written by the
// town's own `appendSigned`. Every number these tests assert against was folded
// out of that ledger by the town's own folds. A stubbed balance would be
// asserting the fixture.

import test, { after } from "node:test";
import { NO_TOWN, townClone, worldClone } from "./fixture-paths.mjs";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));

// The town checkout the fixture copies its engine out of. Same resolution order
// `test/funding-report.test.mjs` uses, plus the pool path this lane runs on.
const TOWN = [townClone()].filter(Boolean)
  .find((p) => p && existsSync(join(p, "tools", "stamp-mint.mjs")));
const SKIP = !TOWN && NO_TOWN;

const litter = [];
after(() => { for (const d of litter) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } } });

/**
 * A throwaway town: the real tools, a real pen, a real signed ledger.
 * `mints` seeds liquid stamps; `pots` writes pot files the pot door can read.
 */
function townFixture({ mints = [{ handle: "tester", n: 5 }], pots = [] } = {}) {
  const mint = MINT;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const repo = mkdtempSync(join(tmpdir(), "pos83-town-"));
  litter.push(repo);
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  for (const f of ["stamp-mint.mjs", "world-stake.mjs", "ballot.mjs"])
    copyFileSync(join(TOWN, "tools", f), join(repo, "tools", f));
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const keyFile = join(repo, "stamp-key.pem");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  writeFileSync(keyFile, pem);
  for (const p of pots)
    writeFileSync(join(repo, "WHITE_PAGES", `pot-${p.pot}.json`), JSON.stringify({
      status: "open", title: "a need", beneficiary: "keeper", target_usd_per_epoch: 100,
      epoch_cadence: "monthly", received_usd: 0, close: "epoch", ...p,
    }));
  if (mints.length)
    mint.appendSigned(repo, mints.map((m) => mint.giftLine({
      date: m.date ?? "2026-09-01", handle: m.handle, n: m.n, slug: "seed", by: "the-town" })), pem);
  execFileSync("git", ["init", "-q"], { cwd: repo, encoding: "utf8" });
  execFileSync("git", ["add", "-A"], { cwd: repo, encoding: "utf8" });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "fixture"], { cwd: repo, encoding: "utf8" });
  return { repo, keyFile, pem };
}

const ledgerPathOf = (repo) => join(repo, "WHITE_PAGES", "stamp-ledger.md");
const ledgerBytes = (repo) => (existsSync(ledgerPathOf(repo)) ? readFileSync(ledgerPathOf(repo)) : Buffer.alloc(0));

// ────────────────────────────────────────────────────────────────────────────
// TOWN_CLONE is read at MODULE LOAD by src/world-stake.mjs, so the fixture is
// built and the variable set BEFORE the doors are imported. (`heldFor` itself
// takes the clone as a parameter for exactly this reason; the DOOR's constant is
// older than this lane and not its to move.)
// ────────────────────────────────────────────────────────────────────────────
// Guarded: a top-level await import of a clone that is not there takes the
// whole module down at load, and its cases then neither pass nor fail.
const MINT = TOWN ? await import(pathToFileURL(join(TOWN, "tools", "stamp-mint.mjs"))) : null;
const BOOT = TOWN ? townFixture({ mints: [{ handle: "tester", n: 5 }, { handle: "poorer", n: 1 }],
  pots: [{ pot: "keep" }, { pot: "shut", status: "closed" }] }) : null;
if (BOOT) process.env.TOWN_CLONE = BOOT.repo;

const { clipTo, heldFor, stampsBlock, toConfirm, RULE_MARK, STAKE_MARK_BODY, STAKE_MARK_MARK, NOTHING_MOVED } =
  await import("../src/stamps-preview.mjs");
const { worldStakeViaOffice, worldUnstakeViaOffice, WORLD_STAKE_TOOLS, markStakeBlock } =
  await import("../src/world-stake.mjs");
const { TOWN_STAKE_TOOLS } = await import("../src/town-stake.mjs");
const { potStakeViaOffice, POT_RULE, POT_STAKEABLE_BODY, POT_STAKEABLE_SLOT } =
  await import("../src/household-stamps.mjs");

const KEY = { household: "testers", handles: new Set(["tester"]) };

/** The ledger move the exec makes, made in-process: the town's own engine, the
 *  fixture's own pen, a real append. Everything `world-stake-exec.mjs` does
 *  except the flock and the git commit — so the numbers the block is built from
 *  are the engine's, not a stub's. `calls` is the witness. */
function realLedger(fx) {
  const calls = [];
  const fn = async (payload) => {
    calls.push(payload);
    const ws = await import(pathToFileURL(join(fx.repo, "tools", "world-stake.mjs")));
    try {
      return payload.verb === "unstake"
        ? ws.worldUnstakeApply(fx.repo, payload, fx.pem)
        : ws.worldStakeApply(fx.repo, { ...payload, via: payload.via ?? "api" }, fx.pem);
    } catch (e) { return { error: "bounce", code: e.code, defect: e.defect, hint: e.hint }; }
  };
  fn.calls = calls;
  return fn;
}

// THE DOOR, WIRED TO THIS FIXTURE. `held` is injected for the reason the door
// makes it injectable: `TOWN_CLONE` is fixed at MODULE LOAD, so without it every
// test in this file would be asserting against whichever ledger the process
// happened to boot with — and the clip case, the founder's own case, is only
// reachable against a balance the test controls. A probe that cannot choose its
// own preconditions is asserting the fixture.
const openDoor = (fx, over = {}) => ({
  exists: async () => ({ known: true, exists: true, record: null }),
  promote: async () => ({ promoted: false }),
  standing: async () => ({ known: true, found: true, retired: false }),
  ledger: realLedger(fx),
  held: (handle) => heldFor(fx.repo, handle),
  ...over,
});

// ════════════════════════════════════════════════════════════════════════════
// 1 · THE CLIP IS THE TOWN'S OWN — driven against the real engine
// ════════════════════════════════════════════════════════════════════════════

test("PARITY: clipTo returns exactly what the town's own stake engine applies, at every boundary", { skip: SKIP }, async () => {
  // LAW (tools/world-stake.mjs:220, verbatim): `const applied = Math.min(n, balance);`
  // — asserted by DRIVING it, never by reading it. This is the one line
  // src/stamps-preview.mjs admits to computing office-side; the warrant is here.
  for (const { seed, ask, what } of [
    { seed: 5, ask: 3, what: "under the balance" },
    { seed: 5, ask: 5, what: "exactly the balance" },
    { seed: 5, ask: 9, what: "over the balance — the clip case the founder's sentence is about" },
    { seed: 0, ask: 2, what: "an empty balance" },
  ]) {
    const fx = townFixture({ mints: seed ? [{ handle: "tester", n: seed }] : [] });
    const ws = await import(pathToFileURL(join(fx.repo, "tools", "world-stake.mjs")));
    const before = ws.worldStakeState(fx.repo).balances.get("tester") ?? 0;
    assert.equal(before, seed, `${what}: the fixture's own ledger says what we seeded`);
    const engine = ws.worldStakeApply(fx.repo, { handle: "tester", mark: "tester/m", n: ask, via: "api", date: "2026-09-02" }, fx.pem);
    assert.equal(clipTo(ask, before).applied, engine.applied, `${what}: the office's clip and the town's engine must agree`);
    assert.equal(clipTo(ask, before).clipped, engine.clipped, `${what}: and agree about whether it clipped`);
  }
});

test("PARITY: clipTo returns exactly what the town's own UNSTAKE engine applies — the ceiling is the position, not the balance", { skip: SKIP }, async () => {
  // LAW (tools/world-stake.mjs:250, verbatim): `const applied = Math.min(n, open);`
  // and the engine's own sentence for why it is a different ceiling: "you can
  // never take out more than you put in, and never another resident's stamps."
  const fx = townFixture({ mints: [{ handle: "tester", n: 9 }] });
  const ws = await import(pathToFileURL(join(fx.repo, "tools", "world-stake.mjs")));
  ws.worldStakeApply(fx.repo, { handle: "tester", mark: "tester/m", n: 4, via: "api", date: "2026-09-02" }, fx.pem);
  for (const ask of [2, 4, 7]) {
    const open = ws.markPosition(fx.repo, "tester/m", "tester");
    const engine = ws.worldUnstakeApply(fx.repo, { handle: "tester", mark: "tester/m", n: ask, date: "2026-09-03" }, fx.pem);
    assert.equal(clipTo(ask, open).applied, engine.applied, `asking ✦${ask} against a position of ✦${open}`);
    // and it is NOT the balance: the resident is holding liquid stamps the whole
    // time, so a clip against the wrong ceiling would pass an easier test
    const liquid = ws.worldStakeState(fx.repo).balances.get("tester") ?? 0;
    if (ask > open) assert.notEqual(clipTo(ask, liquid).applied, engine.applied,
      "a clip against liquid would have answered differently here — the ceilings are genuinely different");
  }
});

test("heldFor folds the TOWN's own ledger, both tenses, and moves when the ledger moves", { skip: SKIP }, async () => {
  const fx = townFixture({ mints: [{ handle: "tester", n: 7 }] });
  assert.deepEqual(await heldFor(fx.repo, "tester"), { liquid: 7, staked: 0 });
  const ws = await import(pathToFileURL(join(fx.repo, "tools", "world-stake.mjs")));
  ws.worldStakeApply(fx.repo, { handle: "tester", mark: "tester/m", n: 3, via: "api", date: "2026-09-02" }, fx.pem);
  // the three-tenses invariant, asserted rather than assumed: a stake moves
  // stamps ACROSS, it does not destroy them
  const after = await heldFor(fx.repo, "tester");
  assert.deepEqual(after, { liquid: 4, staked: 3 });
  assert.equal(after.liquid + after.staked, 7, "assets = liquid + staked");
});

test("heldFor says so rather than answering zero when there is no ledger to fold", async () => {
  // A door that quietly answered `{liquid: 0}` for an unreadable clone would be
  // telling a resident holding ✦40 that they hold nothing — the failure this
  // whole block exists to stop, dressed as an answer.
  const nowhere = mkdtempSync(join(tmpdir(), "pos83-empty-"));
  litter.push(nowhere);
  const held = await heldFor(nowhere, "tester");
  assert.equal(held.liquid, 0);
  assert.match(held.unread, /could not be read|no town clone/i);
});

// ════════════════════════════════════════════════════════════════════════════
// 2 · THE BLOCK'S OWN ARITHMETIC
// ════════════════════════════════════════════════════════════════════════════

test("the block takes from liquid and gives to staked — and an unstake goes the other way", () => {
  const held = { liquid: 10, staked: 4 };
  const s = stampsBlock({ held, moves: 3, requested: 3, direction: "stake", rule: RULE_MARK });
  assert.deepEqual(s.you_hold, { liquid: 10, staked: 4 });
  assert.deepEqual(s.after, { liquid: 7, staked: 7 }, "a stake moves stamps across, never away");
  assert.equal(s.this_act.stamps, 3);
  assert.equal(s.you_hold.liquid + s.you_hold.staked, s.after.liquid + s.after.staked, "nothing is created or destroyed by a stake");

  const u = stampsBlock({ held, moves: 3, requested: 3, direction: "unstake", rule: RULE_MARK });
  assert.deepEqual(u.after, { liquid: 13, staked: 1 }, "an unstake brings them home");
});

test("a clip is STATED as a clip, with both numbers in the sentence", () => {
  const b = stampsBlock({ held: { liquid: 1, staked: 0 }, moves: 1, requested: 3, direction: "stake", rule: RULE_MARK });
  assert.equal(b.this_act.stamps, 1, "what moves is what moves");
  assert.equal(b.this_act.requested, 3, "…and what was asked is still on the answer");
  assert.equal(b.this_act.clipped, true);
  assert.match(b.this_act.clip, /✦3/);
  assert.match(b.this_act.clip, /✦1/);
  // an unclipped act carries no clip furniture at all — an always-present
  // `clipped: false` reads as a warning that never fires
  const clean = stampsBlock({ held: { liquid: 9, staked: 0 }, moves: 3, requested: 3, direction: "stake", rule: RULE_MARK });
  assert.equal("clipped" in clean.this_act, false);
  assert.equal("clip" in clean.this_act, false);
});

test("to_confirm is the y of the y/n, and the n is said out loud — and it rides ONLY when given", () => {
  const withIt = stampsBlock({ held: { liquid: 5, staked: 0 }, moves: 1, requested: 1, direction: "stake",
    rule: RULE_MARK, to_confirm: toConfirm('world { do: "stake" }') });
  assert.match(withIt.to_confirm, /without preview: true/);
  assert.match(withIt.to_confirm, /Not calling is the no/,
    "the founder asked for a y/n — an unstated n is a caller left wondering whether silence is consent");
  const withoutIt = stampsBlock({ held: { liquid: 5, staked: 0 }, moves: 1, requested: 1, direction: "stake", rule: RULE_MARK });
  assert.equal("to_confirm" in withoutIt, false);
});

// ════════════════════════════════════════════════════════════════════════════
// 3 · A PREVIEW MOVES NOTHING — and the absence has a witness
// ════════════════════════════════════════════════════════════════════════════

test("A PREVIEW OF A MARK STAKE WRITES NOTHING: the ledger is byte-identical and the ledger was never reached", { skip: SKIP }, async () => {
  const fx = townFixture({ mints: [{ handle: "tester", n: 5 }] });
  process.env.TOWN_CLONE = fx.repo;
  const deps = openDoor(fx);
  const before = ledgerBytes(fx.repo);
  const answer = await worldStakeViaOffice({ mark: "tester/m", stamps: 3, preview: true }, KEY, deps);
  assert.equal(answer.preview, true);
  assert.equal(answer.error, undefined, JSON.stringify(answer));
  // THE WITNESS. "Nothing was written" is an absence, and an absence needs one:
  // a probe that read only the answer would pass against a door that wrote and
  // then said it had not.
  assert.equal(deps.ledger.calls.length, 0, "the preview must never reach the ledger at all");
  assert.ok(before.equals(ledgerBytes(fx.repo)), "the sealed ledger's own bytes, unchanged");
  assert.match(answer.nothing_written, /no escrow moved/);
});

test("A PREVIEW OF AN UNSTAKE WRITES NOTHING, and reads the position it would draw from", { skip: SKIP }, async () => {
  const fx = townFixture({ mints: [{ handle: "tester", n: 6 }] });
  process.env.TOWN_CLONE = fx.repo;
  const ws = await import(pathToFileURL(join(fx.repo, "tools", "world-stake.mjs")));
  ws.worldStakeApply(fx.repo, { handle: "tester", mark: "tester/m", n: 4, via: "api", date: "2026-09-02" }, fx.pem);
  const ledger = realLedger(fx);
  const before = ledgerBytes(fx.repo);
  const answer = await worldUnstakeViaOffice({ mark: "tester/m", stamps: 2, preview: true }, KEY,
    { ledger, held: (h) => heldFor(fx.repo, h), position: async () => ws.markPosition(fx.repo, "tester/m", "tester") });
  assert.equal(answer.preview, true);
  assert.equal(answer.position, 4, "the open position is named, because it is the ceiling");
  assert.equal(ledger.calls.length, 0);
  assert.ok(before.equals(ledgerBytes(fx.repo)));
  assert.deepEqual(answer.stamps.you_hold, { liquid: 2, staked: 4 });
  assert.deepEqual(answer.stamps.after, { liquid: 4, staked: 2 }, "two come home");
});

test("A PREVIEW OF A POT STAKE WRITES NOTHING — and it is the exec's own clip that judged it", { skip: SKIP }, async () => {
  const fx = townFixture({ mints: [{ handle: "tester", n: 5 }], pots: [{ pot: "keep" }] });
  const before = ledgerBytes(fx.repo);
  const answer = await potStakeViaOffice(fx.repo, { from: "tester", pot: "keep", stamps: 2, preview: true }, KEY);
  assert.equal(answer.preview, true);
  assert.equal(answer.error, undefined, JSON.stringify(answer));
  assert.ok(before.equals(ledgerBytes(fx.repo)), "the sealed ledger's own bytes, unchanged");
  assert.equal("commit" in answer, false, "nothing was committed, so no commit rides");
  assert.deepEqual(answer.stamps.you_hold, { liquid: 5, staked: 0 });
  assert.deepEqual(answer.stamps.after, { liquid: 3, staked: 2 });
  // and the consent payload is there, in the planted mark's own words
  assert.equal(answer.stamps.this_act.rule, POT_STAKEABLE_BODY);
  assert.equal(answer.mode.says.length > 0, true);
});

// ════════════════════════════════════════════════════════════════════════════
// 4 · THE RECEIPT CARRIES WHAT THE PREVIEW SHOWED
// ════════════════════════════════════════════════════════════════════════════

test("THE IDENTICAL BLOCK: the real stake's receipt carries the numbers the preview showed for the same call", { skip: SKIP }, async () => {
  const fx = townFixture({ mints: [{ handle: "tester", n: 5 }] });
  process.env.TOWN_CLONE = fx.repo;
  const args = { mark: "tester/m", stamps: 3 };
  const preview = await worldStakeViaOffice({ ...args, preview: true }, KEY, openDoor(fx));
  const receipt = await worldStakeViaOffice({ ...args }, KEY, openDoor(fx));
  assert.equal(receipt.error, undefined, JSON.stringify(receipt));
  assert.deepEqual(receipt.stamps.you_hold, preview.stamps.you_hold);
  assert.deepEqual(receipt.stamps.this_act, preview.stamps.this_act);
  assert.deepEqual(receipt.stamps.after, preview.stamps.after);
  // …and the receipt's numbers are TRUE of the world the act left behind
  assert.deepEqual(await heldFor(fx.repo, "tester"), receipt.stamps.after,
    "the block's `after` is not a promise — it is what the ledger now says");
  // `to_confirm` is the one field that is preview-only, and its absence is
  // asserted rather than left unstated (src/stamps-preview.mjs § the block).
  assert.equal("to_confirm" in preview.stamps, true);
  assert.equal("to_confirm" in receipt.stamps, false, "a receipt telling its reader how to confirm invites a second act");
});

test("THE IDENTICAL BLOCK, THE POT DOOR: preview then act, same numbers, and the ledger really moved", { skip: SKIP }, async () => {
  const fx = townFixture({ mints: [{ handle: "tester", n: 5 }], pots: [{ pot: "keep" }] });
  const args = { from: "tester", pot: "keep", stamps: 2 };
  const preview = await potStakeViaOffice(fx.repo, { ...args, preview: true }, KEY);
  // THE REAL ACT, THROUGH THE REAL EXEC. The subprocess reads its pen out of
  // STAMP_KEY and commits with penCommit, so the fixture hands it its own pen and
  // its own git identity — a skipped probe is not a passing probe, and the
  // identical-block claim is the one claim that has to cross the subprocess.
  const env = { STAMP_KEY: process.env.STAMP_KEY, BOT_NAME: process.env.BOT_NAME, BOT_EMAIL: process.env.BOT_EMAIL, TOWN_PUSH: process.env.TOWN_PUSH };
  process.env.STAMP_KEY = fx.keyFile;
  process.env.BOT_NAME = "t"; process.env.BOT_EMAIL = "t@t"; delete process.env.TOWN_PUSH;
  let receipt;
  try { receipt = await potStakeViaOffice(fx.repo, { ...args }, KEY, { channel: null }); }
  finally { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  assert.equal(receipt.error, undefined, `the pot act must really run: ${JSON.stringify(receipt)}`);
  assert.ok(receipt.commit, "the exec committed the sealed ledger, which is what makes this the real act");
  assert.deepEqual(receipt.stamps.you_hold, preview.stamps.you_hold);
  assert.deepEqual(receipt.stamps.this_act, preview.stamps.this_act);
  assert.deepEqual(receipt.stamps.after, preview.stamps.after);
  assert.deepEqual(await heldFor(fx.repo, "tester"), receipt.stamps.after);
});

test("THE CLIP CASE previews the CLIPPED number, and the receipt agrees with it", { skip: SKIP }, async () => {
  // The founder's own case: an agent asks for more than it holds, and the point
  // of asking first is to be told so BEFORE the ledger says it in past tense.
  const fx = townFixture({ mints: [{ handle: "tester", n: 1 }] });
  process.env.TOWN_CLONE = fx.repo;
  const args = { mark: "tester/m", stamps: 4 };
  const preview = await worldStakeViaOffice({ ...args, preview: true }, KEY, openDoor(fx));
  assert.equal(preview.stamps.this_act.stamps, 1, "what moves is ✦1, not the ✦4 that was asked");
  assert.equal(preview.stamps.this_act.requested, 4);
  assert.deepEqual(preview.stamps.after, { liquid: 0, staked: 1 });
  const receipt = await worldStakeViaOffice({ ...args }, KEY, openDoor(fx));
  assert.deepEqual(receipt.stamps.this_act, preview.stamps.this_act);
  assert.deepEqual(receipt.stamps.after, preview.stamps.after);
  assert.deepEqual(await heldFor(fx.repo, "tester"), { liquid: 0, staked: 1 });
});

// ════════════════════════════════════════════════════════════════════════════
// 5 · A PREVIEW OF A REFUSED ACT SHOWS THE REFUSAL, AND NO BLOCK
// ════════════════════════════════════════════════════════════════════════════

test("a preview of a stake on a RETIRED mark shows the refusal — defect and hint — and carries no block", { skip: SKIP }, async () => {
  const fx = townFixture({ mints: [{ handle: "tester", n: 5 }] });
  process.env.TOWN_CLONE = fx.repo;
  const deps = openDoor(fx, { standing: async () => ({ known: true, found: true, retired: true }) });
  const answer = await worldStakeViaOffice({ mark: "tester/m", stamps: 3, preview: true }, KEY, deps);
  assert.equal(answer.error, "bounce");
  assert.equal(answer.code, 422);
  assert.match(answer.defect, /is not standing/);
  assert.ok(answer.hint.length > 0, "a refusal with no hint teaches nothing");
  assert.equal("stamps" in answer, false, "a refused act moves nothing, so there is nothing to show a block about");
  assert.equal(deps.ledger.calls.length, 0);
});

test("a preview of a stake on a mark you cannot see is the SAME 404 the act gives, before any block is built", { skip: SKIP }, async () => {
  const fx = townFixture({ mints: [{ handle: "tester", n: 5 }] });
  process.env.TOWN_CLONE = fx.repo;
  const deps = openDoor(fx, { exists: async () => ({ known: true, exists: false }) });
  const answer = await worldStakeViaOffice({ mark: "tester/nowhere", stamps: 3, preview: true }, KEY, deps);
  assert.equal(answer.code, 404);
  assert.equal("stamps" in answer, false);
  assert.equal(deps.ledger.calls.length, 0);
});

test("a preview of a pot that is not open is refused by the exec's OWN clip, not by a second rule here", { skip: SKIP }, async () => {
  const fx = townFixture({ mints: [{ handle: "tester", n: 5 }], pots: [{ pot: "shut", status: "closed" }] });
  const answer = await potStakeViaOffice(fx.repo, { from: "tester", pot: "shut", stamps: 2, preview: true }, KEY);
  assert.equal(answer.error, "bounce");
  assert.equal(answer.code, 409);
  assert.match(answer.defect, /not open/);
  assert.equal("stamps" in answer, false);
  // and the refusal is the exec's own sentence — proof it is one rule, not two
  const { clipPotStake, potStakeInputs } = await import("../src/pot-stake-exec.mjs");
  const { state, pots } = await potStakeInputs(fx.repo);
  const direct = clipPotStake({ state, pots, handle: "tester", pot: "shut", n: 2, date: "2026-09-02" });
  assert.equal(answer.defect, direct.error.defect, "the door speaks the clip's own words, never a paraphrase");
  assert.equal(answer.hint, direct.error.hint);
});

test("a preview of a pot that does not exist names the pots that do — the clip's own hint", { skip: SKIP }, async () => {
  const fx = townFixture({ mints: [{ handle: "tester", n: 5 }], pots: [{ pot: "keep" }] });
  const answer = await potStakeViaOffice(fx.repo, { from: "tester", pot: "ghost", stamps: 2, preview: true }, KEY);
  assert.equal(answer.code, 404);
  assert.match(answer.hint, /keep/);
  assert.equal("stamps" in answer, false);
});

// ════════════════════════════════════════════════════════════════════════════
// 6 · THE RULE IS THE LAW'S OWN WORDS
// ════════════════════════════════════════════════════════════════════════════

test("the rule the block quotes is the world record's own text, read from the mark file", () => {
  // THE QUOTE LAW: "every new act plants its residue class mark first and the
  // door quotes it, never its own prose." So this reads the MARK FILE, not the
  // door's copy of it. Skipped, never faked, when no world checkout is at hand:
  // a green tick that proved nothing would be worse than an honest absence.
  const roots = [worldClone()].filter(Boolean);
  const rel = "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-edge/stake/stake-mark/mark.md";
  let text = null;
  for (const root of roots) { if (!root) continue; try { text = readFileSync(join(root, rel), "utf8"); break; } catch { /* next */ } }
  if (text == null) { console.log("      ↳ no world checkout on this box — the verbatim check did not run"); return; }
  const prose = text.slice(text.indexOf("---", 3) + 3).trim();
  assert.ok(prose.includes(STAKE_MARK_BODY),
    `the door's copy of ${rel} is a paraphrase:\n  door:   ${STAKE_MARK_BODY}\n  record: ${prose.slice(0, 200)}`);
  assert.equal(RULE_MARK.says, STAKE_MARK_BODY);
  assert.equal(RULE_MARK.mark, STAKE_MARK_MARK);
  // the id is citable: a reader can go and find the sentence
  assert.match(text, /class: stake-mark/);
});

test("the block names WHICH law it quoted, on both the mark door and the pot door", { skip: SKIP }, async () => {
  const fx = townFixture({ mints: [{ handle: "tester", n: 5 }], pots: [{ pot: "keep" }] });
  process.env.TOWN_CLONE = fx.repo;
  const mark = await worldStakeViaOffice({ mark: "tester/m", stamps: 1, preview: true }, KEY, openDoor(fx));
  assert.equal(mark.stamps.this_act.law, "the-town/stake-mark");
  assert.equal(mark.stamps.this_act.rule, STAKE_MARK_BODY);
  const pot = await potStakeViaOffice(fx.repo, { from: "tester", pot: "keep", stamps: 1, preview: true }, KEY);
  assert.equal(pot.stamps.this_act.law, POT_STAKEABLE_SLOT);
  assert.equal(pot.stamps.this_act.rule, POT_STAKEABLE_BODY);
  assert.equal(POT_RULE.says, POT_STAKEABLE_BODY, "the pot's rule is assembled from the door's own constants, never restated");
});

// ════════════════════════════════════════════════════════════════════════════
// 7 · CROSS-DOOR GRAMMAR — one field, one shape, every door
// ════════════════════════════════════════════════════════════════════════════

test("every stamp-moving card declares `preview`, and declares it as an opt-in boolean", async () => {
  const cards = [
    ...WORLD_STAKE_TOOLS.filter((t) => t.name === "world_stake" || t.name === "world_unstake"),
    ...TOWN_STAKE_TOOLS.filter((t) => t.name === "town_stake" || t.name === "town_unstake"),
  ];
  assert.equal(cards.length, 4, "four cards, or this list has drifted from the doors");
  for (const c of cards) {
    const p = c.inputSchema.properties.preview;
    assert.ok(p, `${c.name} moves stamps and must take preview — the unknown-field validator refuses what a card does not declare`);
    assert.equal(p.type, "boolean");
    assert.equal(c.inputSchema.required.includes("preview"), false,
      `${c.name}: the founder ruled OPT-IN — a required preview is the forced two-step he refused`);
    assert.match(p.description, /MOVE NOTHING|move nothing/, `${c.name}'s card must say the preview writes nothing`);
  }
  // the apex-only pot stake has no flat card to borrow from, so its own schema
  // carries it — and that is the one a validator would otherwise refuse by name
  const { householdApex } = await import("../src/household-apex.mjs");
  const answer = await householdApex({}, KEY, { db: null, schemas: {}, schemaRequired: {} });
  const stake = answer.acts.find((a) => a.act === "stake");
  assert.equal(stake.fields.preview.type, "boolean");
  assert.equal(stake.fields.preview.required, undefined);
});

test("THE BLOCK IS THE SAME SHAPE AT EVERY DOOR — the same four keys, whatever is being staked", { skip: SKIP }, async () => {
  const fx = townFixture({ mints: [{ handle: "tester", n: 5 }], pots: [{ pot: "keep" }] });
  process.env.TOWN_CLONE = fx.repo;
  const ws = await import(pathToFileURL(join(fx.repo, "tools", "world-stake.mjs")));
  ws.worldStakeApply(fx.repo, { handle: "tester", mark: "tester/m", n: 2, via: "api", date: "2026-09-02" }, fx.pem);
  const blocks = {
    world_stake: (await worldStakeViaOffice({ mark: "tester/m", stamps: 1, preview: true }, KEY, openDoor(fx))).stamps,
    world_unstake: (await worldUnstakeViaOffice({ mark: "tester/m", stamps: 1, preview: true }, KEY,
      { ledger: realLedger(fx), held: (h) => heldFor(fx.repo, h), position: async () => ws.markPosition(fx.repo, "tester/m", "tester") })).stamps,
    household_stake: (await potStakeViaOffice(fx.repo, { from: "tester", pot: "keep", stamps: 1, preview: true }, KEY)).stamps,
    leave_mark_inline: await markStakeBlock({ handle: "tester", stamps: 1, clone: fx.repo, to_confirm: toConfirm("x") }),
  };
  const shape = ["you_hold", "this_act", "after", "to_confirm"];
  for (const [door, b] of Object.entries(blocks)) {
    assert.deepEqual(Object.keys(b), shape, `${door}: one grammar on every door, so an agent learns it once`);
    assert.deepEqual(Object.keys(b.you_hold), ["liquid", "staked"], `${door}: what you hold is two numbers everywhere`);
    assert.deepEqual(Object.keys(b.after), ["liquid", "staked"], `${door}: and so is what you hold after`);
    assert.ok(b.this_act.rule.length > 0 && b.this_act.law.length > 0, `${door}: the rule and the law that carries it`);
  }
  // the inline stake on leave-mark is the world stake, so it must show the world
  // stake's own numbers for the same resident
  assert.deepEqual(blocks.leave_mark_inline.you_hold, blocks.world_stake.you_hold,
    "the inline stake is the stake door's act, asked of the stake door's own owner");
});

test("the preview is OPT-IN: without it the doors answer exactly as they did, and nothing named preview rides", { skip: SKIP }, async () => {
  // The founder refused a forced two-step, and the cheapest way for one to grow
  // back is a door that starts previewing when it is not asked to.
  const fx = townFixture({ mints: [{ handle: "tester", n: 5 }] });
  process.env.TOWN_CLONE = fx.repo;
  for (const args of [{ mark: "tester/m", stamps: 2 }, { mark: "tester/m", stamps: 2, preview: false }]) {
    const answer = await worldStakeViaOffice(args, KEY, openDoor(fx));
    assert.equal(answer.preview, undefined, "a real act never wears the preview's word");
    assert.equal("to_confirm" in answer.stamps, false);
    assert.equal(answer.applied, 2, "and it really moved");
  }
  assert.deepEqual(await heldFor(fx.repo, "tester"), { liquid: 1, staked: 4 }, "two acts, four stamps across");
});

test("NOTHING_MOVED is the sentence a preview signs off with, and it names the ledger", () => {
  assert.match(NOTHING_MOVED, /no escrow moved/);
  assert.match(NOTHING_MOVED, /without preview: true/);
});
