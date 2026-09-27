// fund.test.mjs — falsifiers for the /fund door (S3's USDC rail at the seam).
//
// THE VALIDATION RULE (Keemin, 2026-08-21): every falsifier CITES THE SENTENCE
// OF LAW IT ASSERTS, quoted verbatim in the test itself.
//
// The chain is INJECTED. Every on-chain case below is a hand-built Base receipt,
// so the four witness checks can be driven into each of their refusals without a
// network — including the ones that are hard to produce on purpose (a failed tx,
// a shallow block, a transfer to somebody else's address).
//
// The ledger is REAL: these tests build a throwaway town with the town's own
// stamp-mint/epoch-close, and the guards are checked with the town's own
// `intakeCheck` and `foldPotReceipts` imported from that clone. A pre-check that
// paraphrased the law instead of calling it would be exactly the drift the
// alignment pass existed to close.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { WHAT_THIS_BUYS } from "../src/funding.mjs";
import { verifyUsdcPayment, INTAKE, USDC, TRANSFER_TOPIC, MIN_CONF } from "../src/usdc-witness.mjs";
import { fundVerify, fundGuards, intakeDisclosure } from "../src/fund.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";

// The aligned town engine — the same tip the door's parser is pinned to.
const TOWN = townClone();
const ENGINE = TOWN ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const SKIP = !TOWN && NO_TOWN;

// ── a hand-built Base chain ─────────────────────────────────────────────────
const pad32 = (addr) => "0x" + "0".repeat(24) + addr.replace(/^0x/, "").toLowerCase();
const usdcHex = (usd) => "0x" + BigInt(Math.round(usd * 1e6)).toString(16);

function chain({ status = "0x1", block = 1000, head = 1000 + MIN_CONF, logs = null, missing = false, throws = false } = {}) {
  return async (method) => {
    if (throws) throw new Error("all RPCs failed: connect ETIMEDOUT");
    if (method === "eth_blockNumber") return "0x" + head.toString(16);
    if (method === "eth_getTransactionReceipt") {
      if (missing) return null;
      return { status, blockNumber: "0x" + block.toString(16), logs: logs ?? [] };
    }
    throw new Error(`unexpected rpc ${method}`);
  };
}
const transferLog = ({ to = INTAKE, from = "0xf00dcafe00000000000000000000000000000001", usd = 100, token = USDC } = {}) => ({
  address: token,
  topics: [TRANSFER_TOPIC, pad32(from), pad32(to)],
  data: usdcHex(usd),
});
const HASH = "0x" + "a1".repeat(32);
const HASH2 = "0x" + "b2".repeat(32);

// ── a throwaway town with a real, sealed ledger ─────────────────────────────
function seamTown({ pots = {}, gifts = [] } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "pem" });
  const priv = privateKey.export({ type: "pkcs8", format: "pem" });
  const repo = mkdtempSync(join(tmpdir(), "fund-town-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify({
    paz: { login: "p", id: 2 }, stan: { login: "s", id: 1 }, vic: { login: "v", id: 6 },
  }));
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"),
    "# ledger\n\n- 2026-06-12 · m-1 · stan → paz · thread: new\n");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), pub);
  writeFileSync(join(repo, "ECONOMY-DIALS.json"), JSON.stringify({
    law_side: {
      town_issuance: { treasury_handle: "the-town", once_purposes: [] },
      keeping: { sigma: 0.5, rho: 0.5, rho_constitutional_ceiling: 0.5 },
    },
  }));
  for (const [id, meta] of Object.entries(pots)) {
    writeFileSync(join(repo, "WHITE_PAGES", `pot-${id}.json`),
      JSON.stringify({ pot: id, status: "open", beneficiary: "keeper", target_usd_per_epoch: 100, ...meta }));
  }
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, priv);
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  if (gifts.length) {
    ENGINE.appendSigned(repo, gifts.map((g) =>
      ENGINE.giftLine({ date: "2026-07-01", handle: g.handle, n: g.n, slug: "seed", by: "keemin" })), priv);
  }
  return { repo, priv, keyFile };
}
const entriesOf = (repo) =>
  ENGINE.parseStampLedger(readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));

// A recorder that writes through the TOWN'S OWN CLI — the same enforcer
// fund-exec drives in production, minus the flock and the git ceremony.
const cliRecorder = ({ repo, keyFile }) => async ({ pot, usd, from, ref }) => {
  execFileSync(process.execPath, [
    join(TOWN, "tools", "epoch-close.mjs"), "--receipt",
    "--pot", pot, "--rail", "usdc", "--usd", String(usd),
    "--from", from, "--ref", ref, "--date", "2026-08-01",
    "--key", keyFile, "--repo", repo,
  ], { encoding: "utf8", stdio: "pipe" });
  return { line: entriesOf(repo).at(-1)?.raw ?? "", commit: null };
};

const call = (town, body, opts) => fundVerify(town.repo, body, { engine: ENGINE, ...opts });
const caught = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ── THE WITNESS — its four checks, each driven into its refusal ─────────────

test("the witness verifies exactly four things, and each one can refuse", { skip: SKIP }, async () => {
  // LAW (verify-usdc-payment.mjs, the operator's tool, ported): "this tool
  //      verifies exactly four things and names what it cannot see — 1. the tx
  //      exists on Base and SUCCEEDED (status 0x1), 2. it emits a USDC Transfer
  //      TO the town's intake address, 3. the amount, read from the log (6
  //      decimals), 4. confirmations >= MIN_CONF".
  const good = await verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 83.93 })] }) });
  assert.equal(good.verified, true);
  assert.equal(good.usd, 83.93, "the amount is read from the log at 6 decimals");
  assert.equal(good.receipt_ref, `usdc:base:${HASH}`);
  assert.equal(good.confirmations, MIN_CONF);
  assert.match(good.cannot_see, /which pot was meant/, "and it confesses what it cannot see");

  // 1 — no such tx
  assert.match((await verifyUsdcPayment({ txhash: HASH, rpc: chain({ missing: true }) })).refused,
    /no such transaction on Base/);
  // 1 — a failed tx moves nothing
  assert.match((await verifyUsdcPayment({ txhash: HASH, rpc: chain({ status: "0x0", logs: [transferLog()] }) })).refused,
    /FAILED \(status != 1\)/);
  // 2 — THE FOREIGN RECIPIENT: a real USDC transfer, to somebody else
  const foreign = await verifyUsdcPayment({
    txhash: HASH,
    rpc: chain({ logs: [transferLog({ to: "0xdeadbeef00000000000000000000000000000009" })] }),
  });
  assert.equal(foreign.verified, false);
  assert.match(foreign.refused, /no USDC Transfer to the town's intake address/);
  // 2 — right recipient, wrong token
  assert.match((await verifyUsdcPayment({
    txhash: HASH, rpc: chain({ logs: [transferLog({ token: "0x1111111111111111111111111111111111111111" })] }),
  })).refused, /wrong token, wrong recipient, or not a transfer/);
  // 4 — depth is part of the witness
  assert.match((await verifyUsdcPayment({
    txhash: HASH, rpc: chain({ block: 1000, head: 1005, logs: [transferLog()] }),
  })).refused, /only 5 confirmations \(< 12\)/);
  // not a hash at all
  assert.match((await verifyUsdcPayment({ txhash: "0xnope" })).refused, /not a transaction hash/);
});

test("an unreachable chain is DISCLOSED, never refused — a refusal would call a real payment fake", { skip: SKIP }, async () => {
  // LAW `the-town/the-disclosure`: refuse or disclose absent inputs, never
  //     quietly substitute. A payment the town cannot SEE is not a payment that
  //     did not happen, and telling a patron otherwise is the one lie this door
  //     could tell about real money.
  const out = await verifyUsdcPayment({ txhash: HASH, rpc: chain({ throws: true }) });
  assert.equal(out.verified, false);
  assert.equal(out.unreadable, true, "unreadable is a THIRD answer, distinct from refused");
  assert.match(out.refused, /this says nothing about your payment/);
});

// ── THE DOOR — the happy path, and the three bounces ────────────────────────

test("the happy path: a witnessed payment lands as a real pot-receipt row", { skip: SKIP }, async () => {
  // LAW § 10: "Mint-at-entry, never at spend: a dollar mints (or doesn't)
  //           exactly once, when it crosses the seam."
  const town = seamTown({ pots: { ec2: { target_usd_per_epoch: 150 } }, gifts: [{ handle: "paz", n: 10 }] });
  const rec = await call(town, { txhash: HASH, pot: "ec2", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 100 })] }) }),
    record: cliRecorder(town),
  });
  assert.equal(rec.verified, true);
  assert.equal(rec.recorded, true);
  assert.equal(rec.usd_recorded, 100);
  assert.equal(rec.receipt_ref, `usdc:base:${HASH}`);
  assert.equal(rec.headroom_after, 50, "$100 of a $150 need leaves $50");
  assert.equal(rec.caption, "a record of contribution, not a promise of profit");
  // AMENDED 2026-09-17 (the founder: "holo does anything a normal stamp can;
  // staking vs voting is a nondistiction"). It read /ownership and memory,
  // never voice/ -- the repealed law, on the live door at the money moment.
  assert.equal(rec.what_this_buys, WHAT_THIS_BUYS,
    "the verify receipt serves the one disclosure, never a second copy of it");

  // the row is REAL: the town's own classifier reads it, and the ledger verifies
  const rows = entriesOf(town.repo).map((e) => ENGINE.classifyEntry(e.canonical));
  const receipt = rows.find((c) => c.kind === "pot-receipt");
  assert.ok(receipt, "a pot-receipt row is in the sealed ledger");
  assert.deepEqual(
    { pot: receipt.pot, usd: receipt.usd, from: receipt.from, ref: receipt.ref, rail: receipt.rail },
    { pot: "ec2", usd: 100, from: "paz", ref: `usdc:base:${HASH}`, rail: "usdc" },
  );
  const { verifyStampLedger } = TOWN ? await import(townModuleUrl("tools", "stamp-verify.mjs")) : {};
  assert.equal(verifyStampLedger(town.repo).ok, true, "and the whole ledger still verifies");
});

test("the same hash twice BOUNCES — one dollar, one mint chance", { skip: SKIP }, async () => {
  // LAW § 10: "Mint-at-entry, never at spend: a dollar mints (or doesn't)
  //           exactly once, when it crosses the seam."
  // ECONOMY-DIALS law_side.keeping._exclusions: "a receipt ref is unique
  //           forever (one dollar, one mint chance)."
  const town = seamTown({ pots: { ec2: { target_usd_per_epoch: 500 } }, gifts: [{ handle: "paz", n: 10 }] });
  const verify = () => verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 50 })] }) });
  const record = cliRecorder(town);

  const first = await call(town, { txhash: HASH, pot: "ec2", handle: "paz" }, { verify, record });
  assert.equal(first.recorded, true);

  // (a) the DOOR's pre-check gives the patron a sentence
  const e = await caught(() => call(town, { txhash: HASH, pot: "ec2", handle: "paz" }, { verify, record }));
  assert.ok(e, "a second submission of the same hash must not record");
  assert.equal(e.code, 409);
  assert.match(e.defect, /already recorded/);
  assert.match(e.hint, /one dollar, one mint chance/);
  assert.match(e.hint, /nothing was lost by submitting again/, "and it reassures rather than scolds");

  // (b) the LEDGER is the enforcer behind it — the door's pre-check is not the
  // only guard. Drive the town CLI directly, past the door entirely.
  assert.throws(
    () => execFileSync(process.execPath, [
      join(TOWN, "tools", "epoch-close.mjs"), "--receipt", "--pot", "ec2", "--rail", "usdc",
      "--usd", "50", "--from", "paz", "--ref", `usdc:base:${HASH}`, "--date", "2026-08-02",
      "--key", town.keyFile, "--repo", town.repo,
    ], { encoding: "utf8", stdio: "pipe" }),
    (err) => /already recorded/.test(String(err.stderr)),
    "the town's own CLI refuses the duplicate even with the door bypassed");

  // exactly one receipt for that ref, in the end
  const refs = entriesOf(town.repo).map((x) => ENGINE.classifyEntry(x.canonical))
    .filter((c) => c.kind === "pot-receipt" && c.ref === `usdc:base:${HASH}`);
  assert.equal(refs.length, 1);
});

test("a payment past the pot's posted need BOUNCES, and the bounce names the headroom (D5)", { skip: SKIP }, async () => {
  // LAW D5 (Keemin, 2026-08-21): "intake refuses dollars past a pot's posted
  //         target, mechanically (recording tool / door bounce), except pots
  //         explicitly marked uncapped. Conversion's cap-at-1 stays as backstop."
  const town = seamTown({ pots: { lamp: { target_usd_per_epoch: 100 } }, gifts: [{ handle: "paz", n: 10 }] });
  const record = cliRecorder(town);

  await call(town, { txhash: HASH, pot: "lamp", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 60 })] }) }),
    record,
  });

  const e = await caught(() => call(town, { txhash: HASH2, pot: "lamp", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH2, rpc: chain({ logs: [transferLog({ usd: 60 })] }) }),
    record,
  }));
  assert.ok(e, "$60 onto a $100 pot already holding $60 must not record");
  assert.equal(e.code, 409);
  assert.match(e.defect, /past pot "lamp"'s posted target/);
  assert.match(e.defect, /only \$40 more can be taken/, "the refusal names the remaining headroom");
  assert.match(e.hint, /this pot can still take \$40/, "and the hint tells the patron what WOULD work");

  // exactly the headroom is welcome
  const ok = await call(town, { txhash: HASH2, pot: "lamp", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH2, rpc: chain({ logs: [transferLog({ usd: 40 })] }) }),
    record,
  });
  assert.equal(ok.usd_recorded, 40);
  assert.equal(ok.headroom_after, 0);
});

test("a pot marked uncapped is D5's own exception — a standing box takes what arrives", { skip: SKIP }, async () => {
  // LAW D5: "... except pots explicitly marked uncapped."
  const town = seamTown({ pots: { box: { target_usd_per_epoch: null, uncapped: true } }, gifts: [{ handle: "paz", n: 10 }] });
  const rec = await call(town, { txhash: HASH, pot: "box", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 5000 })] }) }),
    record: cliRecorder(town),
  });
  assert.equal(rec.usd_recorded, 5000);
  assert.equal(rec.headroom_after, null, "an uncapped pot posts no headroom, because it posts no need");
});

// ── the guards that answer BEFORE the chain is consulted ────────────────────

test("the door refuses an unknown pot, a stranger, and the treasury — before touching the chain", { skip: SKIP }, async () => {
  // LAW § 8: a payer earns holo "only as a town household"; and the reserved
  //     `treasury` pot "takes direct-to-town receipts, never stakes or closes".
  const town = seamTown({ pots: { ec2: {} }, gifts: [{ handle: "paz", n: 10 }] });
  let consulted = 0;
  const verify = async () => { consulted++; return { verified: true, usd: 10, txhash: HASH, receipt_ref: "x" }; };

  const ghost = await caught(() => call(town, { txhash: HASH, pot: "no-such-pot", handle: "paz" }, { verify, record: cliRecorder(town) }));
  assert.equal(ghost.code, 404);
  assert.match(ghost.defect, /no pot named "no-such-pot"/);

  const stranger = await caught(() => call(town, { txhash: HASH, pot: "ec2", handle: "mallory" }, { verify, record: cliRecorder(town) }));
  assert.equal(stranger.code, 404);
  assert.match(stranger.defect, /no resident named "mallory"/);
  assert.match(stranger.hint, /recorded by hand/, "a stranger's dollars are still welcome — by another route");

  const town2 = await caught(() => call(town, { txhash: HASH, pot: "treasury", handle: "paz" }, { verify, record: cliRecorder(town) }));
  assert.equal(town2.code, 422);
  assert.match(town2.defect, /not a pot/);

  assert.equal(consulted, 0, "none of these needed the chain — the patron learns the answer first");
});

test("a draft pot takes no dollars — opening one is the founder's word", { skip: SKIP }, async () => {
  const town = seamTown({ pots: { draft: { status: "draft" } }, gifts: [{ handle: "paz", n: 10 }] });
  const g = fundGuards({
    engine: ENGINE, entries: entriesOf(town.repo), clone: town.repo,
    pot: "draft", handle: "paz", usd: 10, receiptRef: "usdc:base:x",
  });
  assert.equal(g.ok, false);
  assert.equal(g.code, 409);
  assert.match(g.defect, /is draft, not open/);
});

test("THE CENTS: whole dollars are recorded, the remainder is disclosed, sub-dollar is refused", { skip: SKIP }, async () => {
  // The ledger's receipt grammar is `usd: [1-9]\d*` — whole dollars. USDC is not.
  // This is the v0 answer and it is FLAGGED, not ruled: record the floor, say
  // out loud what the cents did, and never silently swallow either.
  const town = seamTown({ pots: { ec2: { target_usd_per_epoch: 150 } }, gifts: [{ handle: "paz", n: 10 }] });
  const rec = await call(town, { txhash: HASH, pot: "ec2", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 83.93 })] }) }),
    record: cliRecorder(town),
  });
  assert.equal(rec.usd_witnessed, 83.93, "the witness keeps the true amount");
  assert.equal(rec.usd_recorded, 83, "the ledger takes the whole dollars");
  assert.match(rec.cents_note, /\$0\.93 is money the town holds that priced nothing/);
  assert.match(rec.cents_note, /Nothing is lost and nothing is hidden/);

  const dust = await caught(() => call(town, { txhash: HASH2, pot: "ec2", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH2, rpc: chain({ logs: [transferLog({ usd: 0.4 })] }) }),
    record: cliRecorder(town),
  }));
  assert.equal(dust.code, 422);
  assert.match(dust.defect, /less than a dollar/);
  assert.match(dust.hint, /it is not lost/, "even a refusal about dust tells the patron where their money went");
});

test("every answer this door gives carries the two sentences the money moment owes", { skip: SKIP }, async () => {
  // Keemin's word (seam night): every holo surface carries "a record of
  // contribution, not a promise of profit"; and the scope-extension's second
  // line for money surfaces.
  const town = seamTown({ pots: { ec2: {} }, gifts: [{ handle: "paz", n: 10 }] });
  const rec = await call(town, { txhash: HASH, pot: "ec2", handle: "paz" }, {
    verify: () => verifyUsdcPayment({ txhash: HASH, rpc: chain({ logs: [transferLog({ usd: 10 })] }) }),
    record: cliRecorder(town),
  });
  assert.equal(rec.caption, "a record of contribution, not a promise of profit");
  assert.equal(rec.what_this_buys, WHAT_THIS_BUYS,
    "and so does the recorded path -- one sentence, one home, two callers");
});

// ════════════════════════════════════════════════════════════════════════════
// THE POT'S OWN ADDRESS — the chain names the need (2026-08-25)
// ════════════════════════════════════════════════════════════════════════════
//
// The founder minted keeping-ec2 its own intake address, so a payer can now say
// which pot they meant with the only thing an ERC-20 transfer carries: the
// recipient. These drive a hand-built map rather than the shipped file, because
// what is asserted is the RULE, not today's roster.

const POT_ADDRESS = "0x182085453b5bc2c8cf4cd6f712102cc3dc485fca";
const OTHER_POT_ADDRESS = "0xc0ffee0000000000000000000000000000000002";
const MAP = new Map([[POT_ADDRESS, "ec2"], [OTHER_POT_ADDRESS, "soup"]]);

test("the witness reports WHICH address a tx paid, and the pot that address names", { skip: SKIP }, async () => {
  // LAW (deploy/intake-addresses.json, verbatim): "WHICH POT A USDC ARRIVAL
  //     PAYS, read off the address it landed on. An ERC-20 transfer carries no
  //     memo, so the ONLY way the chain can name a pot is for the pot to have
  //     its own intake address."
  const own = await verifyUsdcPayment({
    txhash: HASH, potMap: MAP,
    rpc: chain({ logs: [transferLog({ to: POT_ADDRESS, usd: 50 })] }),
  });
  assert.equal(own.verified, true, "a pot's own address is a town intake address");
  assert.equal(own.to, POT_ADDRESS, "`to` is the address the tx actually paid, not the parameter echoed back");
  assert.equal(own.to_pot, "ec2", "and the map names the pot");

  // The shared address still verifies, and names NO pot — which is a real
  // answer, not a missing field.
  const shared = await verifyUsdcPayment({
    txhash: HASH, potMap: MAP,
    rpc: chain({ logs: [transferLog({ to: INTAKE, usd: 50 })] }),
  });
  assert.equal(shared.verified, true);
  assert.equal(shared.to, INTAKE);
  assert.equal(shared.to_pot, null, "the shared address names no pot, so the chain said nothing about the need");

  // A stranger's address is still foreign, map or no map.
  const foreign = await verifyUsdcPayment({
    txhash: HASH, potMap: MAP,
    rpc: chain({ logs: [transferLog({ to: "0xdeadbeef00000000000000000000000000000009" })] }),
  });
  assert.equal(foreign.verified, false);
  assert.match(foreign.refused, /no USDC Transfer to the town's intake address/);
});

test("a tx paying TWO town intake addresses is refused, not resolved in favour of either", { skip: SKIP }, async () => {
  // LAW `the-town/the-disclosure`: refuse or disclose absent inputs, never
  //     quietly substitute. Two of the town's addresses paid in one tx is two
  //     different answers to "which pot did you mean", and choosing between
  //     them would cost the payer a witnessed payment on a pot they did not
  //     name — which the ledger has no row kind to undo.
  const both = await verifyUsdcPayment({
    txhash: HASH, potMap: MAP,
    rpc: chain({ logs: [transferLog({ to: POT_ADDRESS, usd: 10 }), transferLog({ to: INTAKE, usd: 10 })] }),
  });
  assert.equal(both.verified, false);
  assert.match(both.refused, /paid 2 different town intake addresses/);
  assert.match(both.refused, /it will not choose/);
});

test("THE GRANDFATHER RULE: a claim on a mapped pot still verifies against the SHARED address", { skip: SKIP }, async () => {
  // LAW (deploy/intake-addresses.json `_never`, verbatim): "Do NOT map the
  //     shared intake address to a pot to make the queue go away. That would
  //     make the office decide where a stranger's money went, which is the one
  //     judgement this whole lane refuses to make."
  //
  // The shared address stays unmapped, so it names no pot — and a payer who
  // followed yesterday's published instructions paid it. The town published
  // that address for keeping up to the moment the pot's own was minted;
  // refusing it now would strand an honest payer for following the town's own
  // word. So the accepted set for a claim naming pot P is P's own mapped
  // address UNION the standing shared intake.
  const town = seamTown({ pots: { ec2: {} }, gifts: [{ handle: "paz", n: 10 }] });
  const rec = await call(town, { txhash: HASH, pot: "ec2", handle: "paz" }, {
    potMap: MAP,
    verify: (a) => verifyUsdcPayment({ ...a, rpc: chain({ logs: [transferLog({ to: INTAKE, usd: 10 })] }) }),
    record: cliRecorder(town),
  });
  assert.equal(rec.recorded, true, "yesterday's instructions still work");
  assert.equal(rec.to, INTAKE);
  assert.equal(rec.to_pot, null, "the claim is the only thing naming the pot, and it is enough");

  // and the pot's OWN address verifies for the same claim
  const town2 = seamTown({ pots: { ec2: {} }, gifts: [{ handle: "paz", n: 10 }] });
  const own = await call(town2, { txhash: HASH2, pot: "ec2", handle: "paz" }, {
    potMap: MAP,
    verify: (a) => verifyUsdcPayment({ ...a, rpc: chain({ logs: [transferLog({ to: POT_ADDRESS, usd: 10 })] }) }),
    record: cliRecorder(town2),
  });
  assert.equal(own.recorded, true);
  assert.equal(own.to, POT_ADDRESS);
  assert.equal(own.to_pot, "ec2", "the chain named the pot, and it agreed with the claim");
});

test("THE CROSS CASE: paying pot A's address while claiming pot B bounces by name", { skip: SKIP }, async () => {
  // LAW (deploy/intake-addresses.json, verbatim): "From that moment the chain
  //     itself names the pot". The grandfather union is deliberately NOT
  //     symmetric — no published instruction ever pointed a soup-payer at ec2's
  //     address, so this is a real disagreement between two things that both
  //     spoke, and the door names it rather than resolving it. It is not
  //     silently corrected to the chain's answer either: the payer may have
  //     paid the wrong address OR typed the wrong pot, and the town does not
  //     know which.
  const town = seamTown({ pots: { ec2: {}, soup: {} }, gifts: [{ handle: "paz", n: 10 }] });
  const e = await caught(() => call(town, { txhash: HASH, pot: "soup", handle: "paz" }, {
    potMap: MAP,
    verify: (a) => verifyUsdcPayment({ ...a, rpc: chain({ logs: [transferLog({ to: POT_ADDRESS, usd: 10 })] }) }),
    record: cliRecorder(town),
  }));
  assert.equal(e.code, 422);
  assert.match(e.defect, /the address you paid names a different pot/);
  assert.match(e.defect, /is pot "ec2"'s own intake address/, "the chain's answer is named");
  assert.match(e.defect, /the claim says pot "soup"/, "and so is the claim's");
  assert.match(e.hint, /nothing was recorded and nothing was lost/);
  // and NOTHING reached the ledger
  assert.equal(entriesOf(town.repo).filter((x) => /receipt/.test(x.raw ?? "")).length, 0,
    "a bounced cross-claim writes no row");
});

test("the money moment publishes the POT'S address, derived from the map and hardcoded nowhere", { skip: SKIP }, async () => {
  // LAW (deploy/intake-addresses.json `_how_to_use_it`, verbatim): "When the
  //     founder mints a per-pot intake address, add one row per pot here (and
  //     only then)."
  //
  // "and only then" is the half this asserts: the address exists in the map and
  // in NO other source file, so minting the next one stays a one-file act.
  assert.equal(intakeDisclosure("ec2", { map: MAP }).address, POT_ADDRESS, "a mapped pot shows its own");
  assert.equal(intakeDisclosure("darko-fund", { map: MAP }).address, INTAKE, "an unmapped pot keeps the standing intake");
  assert.equal(intakeDisclosure(null, { map: MAP }).address, INTAKE, "and no pot named at all is the standing intake");
  assert.equal(intakeDisclosure("ec2", { map: MAP }).pot, "ec2", "the answer says which pot it is for");

  // every other word of the §10 disclosure is the SAME single copy
  const a = intakeDisclosure("ec2", { map: MAP });
  const b = intakeDisclosure("darko-fund", { map: MAP });
  for (const k of ["network", "token", "min_confirmations", "whole_dollars", "recovery", "caption", "what_this_buys", "verify"])
    assert.equal(a[k], b[k], `${k} is one copy, not one per pot`);
});

test("a pot the map names TWICE publishes NO address — never a guessed one", { skip: SKIP }, () => {
  // LAW `the-town/the-disclosure`: refuse or disclose absent inputs, never
  //     quietly substitute. Two addresses for one pot cannot happen from the
  //     file's own instructions ("add one row per pot here"), which is exactly
  //     why picking between them would be the wrong answer if it ever did — on
  //     the one surface where substituting is money gone.
  const doubled = new Map([[POT_ADDRESS, "ec2"], [OTHER_POT_ADDRESS, "ec2"]]);
  const d = intakeDisclosure("ec2", { map: doubled });
  assert.equal(d.address, null, "no address at all");
  assert.match(d.why, /names more than one address/);
  assert.match(d.why, /it will not choose between them/);
  // and the disclosures still ride along — a refusal is still a money surface
  assert.equal(d.caption, "a record of contribution, not a promise of profit");
});

test("THE ADDRESS LIVES IN THE MAP AND NOWHERE ELSE in the office's source", { skip: SKIP }, () => {
  // LAW (deploy/intake-addresses.json `_how_to_use_it`, verbatim): "add one row
  //     per pot here (and only then)". A second copy of a per-pot address in a
  //     source file is a second place that can drift, on the surface where
  //     drift is a patron's money sent to nobody.
  //
  // The standing INTAKE is exempt: it is declared in src/usdc-witness.mjs by
  // design and predates the map entirely.
  const root = new URL("../", import.meta.url);
  const hits = [];
  const walk = (dir) => {
    for (const ent of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      const rel = `${dir}${ent.name}`;
      if (ent.isDirectory()) { walk(`${rel}/`); continue; }
      if (!/\.mjs$/.test(ent.name)) continue;
      const text = readFileSync(new URL(rel, root), "utf8");
      for (const m of text.match(/0x[0-9a-fA-F]{40}/g) ?? [])
        if (m.toLowerCase() === POT_ADDRESS) hits.push(rel);
    }
  };
  walk("src/");
  walk("tools/");
  assert.deepEqual(hits, [], "no per-pot address is hardcoded in src/ or tools/ — the map is the only home");
});
