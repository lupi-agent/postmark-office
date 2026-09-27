// usdc-watch.test.mjs — falsifiers for the eye on the intake address.
//
// THE VALIDATION RULE (Keemin, 2026-08-21): every falsifier CITES THE SENTENCE
// OF LAW IT ASSERTS, quoted verbatim in the test itself.
//
// The chain is INJECTED, and the fake chain here HONOURS THE FILTER it is
// handed rather than replaying a canned list. That distinction is the point of
// the wrong-token and wrong-recipient cases: a fake that ignored the filter
// would prove only that our decoder is incurious, when what must be true is
// that the filter we send to Base never asks for those logs at all.
//
// The ledger is REAL: the witnessed case is a receipt written by the TOWN'S OWN
// epoch-close CLI, and the watch reads it back through the town's own
// foldPotReceipts. A hand-rolled ledger scan would be a second copy of the rule.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { INTAKE, USDC, TRANSFER_TOPIC, MIN_CONF, verifyUsdcPayment } from "../src/usdc-witness.mjs";
import { fundVerify } from "../src/fund.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";
import {
  watch, scanRange, reconcile, decodeArrival, ledgerEntries,
  MIN_USD, UNDER_A_DOLLAR, MAX_SPAN,
} from "../tools/usdc-watch.mjs";

const TOWN = townClone();
const ENGINE = TOWN ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const SKIP = !TOWN && NO_TOWN;

// ── a hand-built Base that actually filters ─────────────────────────────────
const pad32 = (a) => "0x" + "0".repeat(24) + String(a).replace(/^0x/, "").toLowerCase();
const usdcHex = (u) => "0x" + BigInt(Math.round(u * 1e6)).toString(16);
const OTHER_TOKEN = "0xdeadbeef00000000000000000000000000000001";
const STRANGER = "0xfeedface00000000000000000000000000000002";
const PAYER = "0xf00dcafe00000000000000000000000000000001";

const HASH_A = "0x" + "a1".repeat(32);
const HASH_B = "0x" + "b2".repeat(32);
const HASH_DUST = "0x" + "d0".repeat(32);

function transfer({ txhash, block, usd, to = INTAKE, token = USDC, from = PAYER, topic = TRANSFER_TOPIC }) {
  return {
    transactionHash: txhash, blockNumber: "0x" + block.toString(16),
    address: token, topics: [topic, pad32(from), pad32(to)], data: usdcHex(usd),
  };
}

/** A Base that honours address + topics + block range, like the real one. */
function chain({ head = 5000, logs = [], throws = false } = {}) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (throws) throw new Error("all RPCs failed: connect ETIMEDOUT");
    if (method === "eth_blockNumber") return "0x" + head.toString(16);
    if (method === "eth_getLogs") {
      const f = params[0];
      const lo = Number(BigInt(f.fromBlock)), hi = Number(BigInt(f.toBlock));
      return logs.filter((l) => {
        const b = Number(BigInt(l.blockNumber));
        if (b < lo || b > hi) return false;
        if (String(l.address).toLowerCase() !== String(f.address).toLowerCase()) return false;
        return (f.topics ?? []).every((want, i) =>
          want == null || String(want).toLowerCase() === String(l.topics[i]).toLowerCase());
      });
    }
    throw new Error(`unexpected rpc ${method}`);
  };
  return { rpc, calls };
}

// ── a throwaway town with a real, sealed ledger ─────────────────────────────
function seamTown() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const repo = mkdtempSync(join(tmpdir(), "watch-town-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify({ paz: { login: "p", id: 2 }, stan: { login: "s", id: 1 } }));
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n- 2026-06-12 · m-1 · stan → paz · thread: new\n");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(join(repo, "ECONOMY-DIALS.json"), JSON.stringify({
    law_side: { town_issuance: { treasury_handle: "the-town", once_purposes: [] }, keeping: { sigma: 0.5, rho: 0.5, rho_constitutional_ceiling: 0.5 } },
  }));
  writeFileSync(join(repo, "WHITE_PAGES", "pot-keep.json"), JSON.stringify({ pot: "keep", status: "open", beneficiary: "keeper", target_usd_per_epoch: 1000 }));
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  return { repo, keyFile };
}
const entriesOf = (repo) => ENGINE.parseStampLedger(readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
const cliRecorder = ({ repo, keyFile }) => async ({ pot, usd, from, ref }) => {
  execFileSync(process.execPath, [
    join(TOWN, "tools", "epoch-close.mjs"), "--receipt", "--pot", pot, "--rail", "usdc",
    "--usd", String(usd), "--from", from, "--ref", ref, "--date", "2026-08-01",
    "--key", keyFile, "--repo", repo,
  ], { encoding: "utf8", stdio: "pipe" });
  return { line: entriesOf(repo).at(-1)?.raw ?? "", commit: null };
};
const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ════════════════════════════════════════════════════════════════════════════
// THE FILTER — what the watch asks Base for
// ════════════════════════════════════════════════════════════════════════════

test("a wrong-token or wrong-recipient transfer is never even asked for", { skip: SKIP }, async () => {
  // LAW (usdc-witness.mjs, the scope of the check): the witness requires that
  //     the tx "emits a USDC Transfer TO the town's intake address", and refuses
  //     otherwise with "no USDC Transfer to the town's intake address in this tx
  //     (wrong token, wrong recipient, or not a transfer)". A watch that
  //     surfaced arrivals the door would refuse would be inventing money.
  const good = transfer({ txhash: HASH_A, block: 4000, usd: 25 });
  const c = chain({ head: 5000, logs: [
    good,
    transfer({ txhash: HASH_B, block: 4001, usd: 999, token: OTHER_TOKEN }),   // wrong token
    transfer({ txhash: HASH_B, block: 4002, usd: 999, to: STRANGER }),          // wrong recipient
    transfer({ txhash: HASH_B, block: 4003, usd: 999, topic: "0x" + "11".repeat(32) }), // not a Transfer
  ] });

  const found = await scanRange({ rpc: c.rpc, from: 3900, to: 4100 });
  assert.equal(found.length, 1, "only the real arrival survives the filter");
  assert.equal(found[0].txhash, HASH_A);
  assert.equal(found[0].usd, 25);

  // and the filter itself names all three constraints, so the refusing is done
  // by Base rather than by our incuriosity
  const f = c.calls.find((x) => x.method === "eth_getLogs").params[0];
  assert.equal(String(f.address).toLowerCase(), USDC, "the USDC contract, and no other");
  assert.equal(f.topics[0], TRANSFER_TOPIC, "the Transfer topic");
  assert.equal(String(f.topics[2]).toLowerCase(), pad32(INTAKE), "the intake address in the RECIPIENT slot");
});

test("the ref a log yields is the ref the door mints, character for character", { skip: SKIP }, async () => {
  // LAW (stamp-mint.mjs, the pot-receipt grammar): "ref is unique forever: one
  //     dollar, one mint chance, a re-recorded receipt bounces." The watch can
  //     only tell a claimed arrival from an unclaimed one if its ref and the
  //     door's ref are the SAME STRING for the same payment.
  const fromLog = decodeArrival(transfer({ txhash: HASH_A.toUpperCase().replace("0X", "0x"), block: 10, usd: 5 }));
  const w = await verifyUsdcPayment({
    txhash: HASH_A,
    rpc: async (m) => m === "eth_blockNumber" ? "0x" + (1000 + MIN_CONF).toString(16)
      : { status: "0x1", blockNumber: "0x" + (1000).toString(16), logs: [{ address: USDC, topics: [TRANSFER_TOPIC, pad32(PAYER), pad32(INTAKE)], data: usdcHex(5) }] },
  });
  assert.equal(fromLog.receipt_ref, w.receipt_ref);
  assert.equal(w.receipt_ref, `usdc:base:${HASH_A.toLowerCase()}`);
});

// ════════════════════════════════════════════════════════════════════════════
// THE SPLIT — witnessed, unclaimed, dust
// ════════════════════════════════════════════════════════════════════════════

test("a payment under a dollar is set aside with the door's own sentence", { skip: SKIP }, async () => {
  // LAW (fund.mjs, guard 5): "$X is less than a dollar — the ledger records
  //     whole dollars, so a payment under $1 cannot be witnessed as a receipt.
  //     It reached the town and it is not lost — write to the postmaster."
  const town = seamTown();
  const c = chain({ head: 5000, logs: [
    transfer({ txhash: HASH_DUST, block: 4000, usd: 0.5 }),
    transfer({ txhash: HASH_A, block: 4001, usd: 1 }),
  ] });
  const { report } = await watch({ rpc: c.rpc, entries: entriesOf(town.repo), engine: ENGINE, cursor: 3999 });

  assert.equal(report.dust.length, 1);
  assert.equal(report.dust[0].txhash, HASH_DUST);
  assert.equal(report.dust[0].why, UNDER_A_DOLLAR);
  assert.match(report.dust[0].why, /cannot be witnessed as a receipt/);
  // exactly $1 is NOT dust — the floor is "under $1", not "at most $1"
  assert.equal(MIN_USD, 1);
  assert.deepEqual(report.unclaimed.map((u) => u.txhash), [HASH_A]);
});

test("an arrival nobody has claimed is reported as unclaimed, and never as a receipt", { skip: SKIP }, async () => {
  // LAW (the fund page, the card rail's second warning): "a payment the office
  //     cannot attach to a hand can still be a gift, but it cannot mint your holo."
  //     Unclaimed money is a thing the office must SEE; it is not a thing the
  //     watch may record.
  const town = seamTown();
  const before = readFileSync(join(town.repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
  const c = chain({ head: 5000, logs: [transfer({ txhash: HASH_A, block: 4000, usd: 40 })] });

  const { report } = await watch({ rpc: c.rpc, entries: entriesOf(town.repo), engine: ENGINE, cursor: 3999 });
  assert.equal(report.unclaimed.length, 1);
  assert.equal(report.unclaimed[0].usd, 40);
  assert.equal(report.witnessed.length, 0);

  // the ledger is byte-identical: for an UNREGISTERED payer the watch reads and
  // reports, and writes nothing
  assert.equal(readFileSync(join(town.repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8"), before);
  // ⚠ AMENDED 2026-08-25, and the amendment is the finding, not a fix-up. This
  // line read `/never records a receipt/` while the watch recorded nothing at
  // all. It now records exactly one shape — a registered wallet at an address
  // that names a single pot — so the old sentence would have been a false
  // posture on a passing test. The scenario asserted here is unchanged and is
  // the one still forbidden: an unknown payer. The strong assertion above (the
  // ledger did not move) is what actually carries the claim; the posture line
  // is checked for the clause that governs THIS arrival.
  assert.match(report.posture, /Everything else it reads and reports only/);
  assert.match(report.posture, /consume that hash's one mint chance and cost the patron their holo forever/);
});

test("once the patron pastes, the SAME arrival reports as witnessed — the watch is idempotent", { skip: SKIP }, async () => {
  // LAW (harbor-watch.mjs, the posture this file inherits): "This script only
  //     reads and reports — it never writes to any world." Re-running it must
  //     therefore be free: the second run over the same chain discovers nothing
  //     new, it only reads the ledger's answer differently once the ledger moved.
  const town = seamTown();
  const c = chain({ head: 5000, logs: [transfer({ txhash: HASH_A, block: 4000, usd: 40 })] });

  const first = await watch({ rpc: c.rpc, entries: entriesOf(town.repo), engine: ENGINE, cursor: 3999 });
  assert.equal(first.report.unclaimed.length, 1);

  // the patron comes back and pastes — through the real door, the real CLI
  const rec = await fundVerify(town.repo, { txhash: HASH_A, pot: "keep", handle: "paz" }, {
    engine: ENGINE, record: cliRecorder(town),
    verify: () => verifyUsdcPayment({
      txhash: HASH_A,
      rpc: async (m) => m === "eth_blockNumber" ? "0x" + (4000 + MIN_CONF).toString(16)
        : { status: "0x1", blockNumber: "0x" + (4000).toString(16), logs: [{ address: USDC, topics: [TRANSFER_TOPIC, pad32(PAYER), pad32(INTAKE)], data: usdcHex(40) }] },
    }),
  });
  assert.equal(rec.recorded, true);

  // re-run the SAME range: nothing new, and the arrival now carries its receipt
  const second = await watch({ rpc: c.rpc, entries: entriesOf(town.repo), engine: ENGINE, cursor: 3999 });
  assert.equal(second.report.unclaimed.length, 0, "re-running witnesses nothing new");
  assert.equal(second.report.witnessed.length, 1);
  assert.equal(second.report.witnessed[0].pot, "keep");
  assert.equal(second.report.witnessed[0].from, "paz");
  assert.equal(second.report.witnessed[0].usd_recorded, 40);
});

// ════════════════════════════════════════════════════════════════════════════
// THE CURSOR
// ════════════════════════════════════════════════════════════════════════════

test("the cursor never crosses a block that is not buried deep enough", { skip: SKIP }, async () => {
  // LAW (usdc-witness.mjs, check 4): "confirmations >= MIN_CONF (finality is a
  //     claim about depth, not existence)", and the door's refusal: "only N
  //     confirmations (< 12) — call again in a minute; depth is part of the
  //     witness". An arrival the door would refuse for depth must not be
  //     reported, and the cursor must not step over the blocks holding it.
  const town = seamTown();
  const head = 5000;
  const c = chain({ head, logs: [
    transfer({ txhash: HASH_A, block: head - MIN_CONF, usd: 10 }),      // exactly deep enough
    transfer({ txhash: HASH_B, block: head - MIN_CONF + 1, usd: 10 }),  // one block too shallow
  ] });
  const { report, cursor } = await watch({ rpc: c.rpc, entries: entriesOf(town.repo), engine: ENGINE, cursor: head - 100 });

  assert.equal(cursor, head - MIN_CONF, "the cursor stops at the last block MIN_CONF deep");
  assert.deepEqual(report.unclaimed.map((u) => u.txhash), [HASH_A], "the shallow arrival is left for a later tick");

  // and the next tick picks it up once it has settled
  const later = chain({ head: head + MIN_CONF, logs: c.calls && [
    transfer({ txhash: HASH_B, block: head - MIN_CONF + 1, usd: 10 }),
  ] });
  const { report: r2 } = await watch({ rpc: later.rpc, entries: entriesOf(town.repo), engine: ENGINE, cursor });
  assert.deepEqual(r2.unclaimed.map((u) => u.txhash), [HASH_B]);
});

test("an unreachable chain exits loud, reports nothing, and leaves the cursor where it was", { skip: SKIP }, async () => {
  // LAW (usdc-witness.mjs, on an unreadable chain): "NOT a refusal: the payer's
  //     tx may be perfectly good and the town simply cannot see the chain this
  //     minute... Disclose the blindness instead." For a watch, disclosing the
  //     blindness means FAILING — a silent empty report from a blind watcher is
  //     indistinguishable from a quiet day, and the second one is a lie.
  const town = seamTown();
  const c = chain({ throws: true });
  const cursorBefore = 4321;

  const e = await caught(() => watch({ rpc: c.rpc, entries: entriesOf(town.repo), engine: ENGINE, cursor: cursorBefore }));
  assert.ok(e, "it throws rather than returning an empty report");
  assert.match(e.message, /cannot reach Base/);
  assert.match(e.message, /the cursor has not moved/);

  // nothing was scanned: the throw happens before any range is computed
  assert.equal(c.calls.filter((x) => x.method === "eth_getLogs").length, 0);
});

test("a tick with nothing newly settled moves nothing", { skip: SKIP }, async () => {
  // The cursor is only ever advanced over blocks that were actually READ.
  const town = seamTown();
  const head = 5000;
  const c = chain({ head, logs: [] });
  const { report, cursor } = await watch({ rpc: c.rpc, entries: entriesOf(town.repo), engine: ENGINE, cursor: head - MIN_CONF });
  assert.equal(cursor, head - MIN_CONF, "unchanged");
  assert.equal(report.scanned, null);
  assert.equal(c.calls.filter((x) => x.method === "eth_getLogs").length, 0);
});

test("a long catch-up is read in bounded chunks, not one enormous request", { skip: SKIP }, async () => {
  // Public Base RPCs cap an eth_getLogs range; a cold start must not ask for
  // a span no endpoint will answer, and must not silently lose the remainder.
  const town = seamTown();
  const c = chain({ head: 10_000, logs: [transfer({ txhash: HASH_A, block: 9_000, usd: 3 })] });
  const { report, cursor } = await watch({ rpc: c.rpc, entries: entriesOf(town.repo), engine: ENGINE, cursor: 5_000 });

  const spans = c.calls.filter((x) => x.method === "eth_getLogs")
    .map((x) => Number(BigInt(x.params[0].toBlock)) - Number(BigInt(x.params[0].fromBlock)) + 1);
  assert.ok(spans.length > 1, "the range was chunked");
  assert.ok(spans.every((s) => s <= MAX_SPAN), `every chunk is <= ${MAX_SPAN} blocks`);
  // and nothing in the middle was dropped
  assert.deepEqual(report.unclaimed.map((u) => u.txhash), [HASH_A]);
  assert.equal(cursor, 10_000 - MIN_CONF);
});

// ════════════════════════════════════════════════════════════════════════════
// THE RECEIPT FOR WHAT WAS *NOT* BUILT
// ════════════════════════════════════════════════════════════════════════════

test("AUTO-WITNESSING WOULD DESTROY THE PATRON'S HOLO — the reason this watch only reads", { skip: SKIP }, async () => {
  // LAW (stamp-mint.mjs, the pot-receipt grammar, verbatim): "ref is unique
  //     forever: one dollar, one mint chance, a re-recorded receipt bounces."
  //
  // The brief asked for arrivals to be witnessed automatically with no handle,
  // and for a later hash-paste to ATTACH the handle instead of double-witnessing.
  // This test is why that was not built: the first half consumes the hash's one
  // mint chance, and the ledger has no row kind that can perform the second.
  const town = seamTown();
  const record = cliRecorder(town);
  const witness = () => verifyUsdcPayment({
    txhash: HASH_A,
    rpc: async (m) => m === "eth_blockNumber" ? "0x" + (4000 + MIN_CONF).toString(16)
      : { status: "0x1", blockNumber: "0x" + (4000).toString(16), logs: [{ address: USDC, topics: [TRANSFER_TOPIC, pad32(PAYER), pad32(INTAKE)], data: usdcHex(40) }] },
  });

  // a watcher records the arrival under SOME placeholder payer (any value the
  // grammar's `from: (\S+)` accepts — the point does not depend on which)
  const w = await witness();
  await record({ pot: "keep", usd: 40, from: "unattributed", ref: w.receipt_ref });

  // the real patron pastes their hash ten minutes later, through the real door
  const e = await caught(() => fundVerify(town.repo, { txhash: HASH_A, pot: "keep", handle: "paz" }, {
    engine: ENGINE, record, verify: witness,
  }));
  assert.ok(e, "the honest patron is refused");
  assert.equal(e.code, 409);
  assert.match(e.defect, /already recorded/);

  // and their holo is gone for good: the receipt names the placeholder, and the
  // ledger holds no row kind that could ever reassign it
  const ledger = readFileSync(join(town.repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
  assert.match(ledger, /pot-receipt · pot:keep · rail: usdc · usd: 40 · from: unattributed/);
  assert.ok(!/from: paz/.test(ledger), "the patron's name is nowhere on their own dollar");

  // the only rows that mention a payer at all are minted at CLOSE from the
  // receipt's own `from` — so the placeholder would take the holo too
  const kinds = new Set(ENGINE.parseStampLedger(ledger).map((x) => x.kind));
  assert.ok(!kinds.has("pot-receipt-attach"), "there is no attach row kind");
  assert.ok(!kinds.has("pot-receipt-correct"), "and no correction row kind");
});

test("one dollar cannot become two by respelling its hash", { skip: SKIP }, async () => {
  // LAW (stamp-mint.mjs, the pot-receipt grammar, verbatim): "ref is unique
  //     forever: one dollar, one mint chance, a re-recorded receipt bounces."
  //
  // A tx hash is hex and hex has two spellings; TXHASH_RE admits both and the
  // ledger's uniqueness check is an exact string compare. Before the ref was
  // normalised at the point it is minted, pasting 0xab… and then 0xAB… recorded
  // ONE payment TWICE — two receipts, twice the mint, $80 witnessed for $40 of real
  // money. This is the flip that proves the fix can still fail.
  const town = seamTown();
  const record = cliRecorder(town);
  const chainFor = (h) => () => verifyUsdcPayment({
    txhash: h,
    rpc: async (m) => m === "eth_blockNumber" ? "0x" + (4000 + MIN_CONF).toString(16)
      : { status: "0x1", blockNumber: "0x" + (4000).toString(16), logs: [{ address: USDC, topics: [TRANSFER_TOPIC, pad32(PAYER), pad32(INTAKE)], data: usdcHex(40) }] },
  });

  const lower = HASH_A.toLowerCase();
  const upper = "0x" + HASH_A.slice(2).toUpperCase();
  const first = await fundVerify(town.repo, { txhash: lower, pot: "keep", handle: "paz" }, { engine: ENGINE, record, verify: chainFor(lower) });
  assert.equal(first.recorded, true);

  const e = await caught(() => fundVerify(town.repo, { txhash: upper, pot: "keep", handle: "paz" }, { engine: ENGINE, record, verify: chainFor(upper) }));
  assert.ok(e, "the same dollar in a different spelling is refused");
  assert.match(e.defect, /already recorded/);

  const rows = readFileSync(join(town.repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8")
    .split("\n").filter((l) => l.includes("pot-receipt"));
  assert.equal(rows.length, 1, "one payment, one receipt");
});
