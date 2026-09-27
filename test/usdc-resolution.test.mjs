// usdc-resolution.test.mjs — falsifiers for the rules usdc-watch grew when
// seeing became resolving (2026-08-25).
//
// THE VALIDATION RULE (Keemin, 2026-08-21): every falsifier CITES THE SENTENCE
// OF LAW IT ASSERTS, quoted verbatim in the test itself.
//
// The companion file test/usdc-watch.test.mjs still proves the theft this watch
// refuses to commit — an arrival recorded under a placeholder payer destroys the
// real patron's holo forever, against the town's own CLI. Nothing here weakens
// that. What is asserted here is the narrow shape for which its two premises are
// FALSE: an address a household has registered, at an address that names one
// pot. Everything outside that shape must still come out unclaimed, and several
// of these tests exist only to prove it does.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { INTAKE, USDC, TRANSFER_TOPIC, MIN_CONF } from "../src/usdc-witness.mjs";
import { foldRegistry, readWalletRegistry, handleForAddress, registrationLine, DEFAULT_REGISTRY } from "../src/wallet-registry.mjs";
import { CROSSING_MS } from "../src/crossings.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";
import {
  watch, resolveArrivals, decodeArrival, readIntakeMap, intakeAddresses,
  sinkEnabled, SINK_FLAG, SINK_POT, SINK_AGE_DAYS, OUTSIDE_FROM, UNREGISTERED,
} from "../tools/usdc-watch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN = [townClone()].filter(Boolean)
  .find((p) => existsSync(join(p, "tools", "stamp-mint.mjs")));
// Guarded: a top-level await import of a clone that is not there takes the
// whole module down at load, and its cases then neither pass nor fail.
const ENGINE = TOWN ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const SKIP = !TOWN && NO_TOWN;

const pad32 = (a) => "0x" + "0".repeat(24) + String(a).replace(/^0x/, "").toLowerCase();
const usdcHex = (u) => "0x" + BigInt(Math.round(u * 1e6)).toString(16);

const PAZ_WALLET = "0xf00dcafe00000000000000000000000000000001";
const STRANGER_WALLET = "0xfeedface00000000000000000000000000000002";
const POT_A_ADDRESS = "0xaaaa000000000000000000000000000000000001";
const POT_B_ADDRESS = "0xbbbb000000000000000000000000000000000002";

const HASH_A = "0x" + "a1".repeat(32);
const HASH_B = "0x" + "b2".repeat(32);

function transfer({ txhash, block, usd, to = INTAKE, from = PAZ_WALLET, token = USDC, topic = TRANSFER_TOPIC }) {
  return {
    transactionHash: txhash, blockNumber: "0x" + block.toString(16),
    address: token, topics: [topic, pad32(from), pad32(to)], data: usdcHex(usd),
  };
}

/** A Base that honours address + topics (single or OR-array) + block range. */
function chain({ head = 5000, logs = [], blockTs = null } = {}) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "eth_blockNumber") return "0x" + head.toString(16);
    if (method === "eth_getBlockByNumber") {
      if (blockTs == null) throw new Error("no block time available");
      const n = Number(BigInt(params[0]));
      return { timestamp: "0x" + BigInt(Math.floor(blockTs(n) / 1000)).toString(16) };
    }
    if (method === "eth_getLogs") {
      const f = params[0];
      const lo = Number(BigInt(f.fromBlock)), hi = Number(BigInt(f.toBlock));
      return logs.filter((l) => {
        const b = Number(BigInt(l.blockNumber));
        if (b < lo || b > hi) return false;
        if (String(l.address).toLowerCase() !== String(f.address).toLowerCase()) return false;
        return (f.topics ?? []).every((want, i) => {
          if (want == null) return true;
          const got = String(l.topics[i]).toLowerCase();
          return Array.isArray(want) ? want.some((w) => String(w).toLowerCase() === got) : String(want).toLowerCase() === got;
        });
      });
    }
    throw new Error(`unexpected rpc ${method}`);
  };
  return { rpc, calls };
}

function seamTown({ wallets = {}, pots = { "pot-a": 1000, "pot-b": 1000 } } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const repo = mkdtempSync(join(tmpdir(), "usdc-town-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify({ paz: { login: "p", id: 2 }, stan: { login: "s", id: 1 } }));
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n- 2026-06-12 · m-1 · stan → paz · thread: new\n");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(join(repo, "ECONOMY-DIALS.json"), JSON.stringify({
    law_side: { town_issuance: { treasury_handle: "the-town", once_purposes: [] }, keeping: { sigma: 0.5, rho: 0.5, rho_constitutional_ceiling: 0.5 } },
  }));
  for (const [id, target] of Object.entries(pots))
    writeFileSync(join(repo, "WHITE_PAGES", `pot-${id}.json`), JSON.stringify({ pot: id, status: "open", beneficiary: "keeper", target_usd_per_epoch: target, epoch_cadence: "monthly", received_usd: 0 }));
  writeFileSync(join(repo, "WHITE_PAGES", `pot-${SINK_POT}.json`), JSON.stringify({ pot: SINK_POT, status: "open", beneficiary: "keeper", target_usd_per_epoch: null, epoch_cadence: "monthly", received_usd: 0, uncapped: true, close: "elastic", min_close_usd: 5 }));
  // Households the registry may name. NOTHING wallet-shaped is written into the
  // town repo — founder-ruled 2026-08-25; the registry is office-side.
  for (const handle of Object.keys(wallets)) mkdirSync(join(repo, "WHITE_PAGES", handle), { recursive: true });
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  return { repo, keyFile };
}

const ledgerText = (repo) => readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const entriesOf = (repo) => ENGINE.parseStampLedger(ledgerText(repo));
// One line of the office-side registration journal, exactly as the operator's
// pen writes it today and as the future `register-wallet` door act will append it.
const reg = (handle, address, over = {}) => JSON.stringify({ at: "2026-08-26T00:00:00Z", act: "register", handle, chain: "base", address, by: "operator-pen", ...over });
const HH = new Set(["paz", "stan"]);

// ════════════════════════════════════════════════════════════════════════════
// THE REGISTRY — whose address is this
// ════════════════════════════════════════════════════════════════════════════

test("THE REGISTRY IS OFFICE-SIDE — nothing wallet-shaped may ever appear in the town repo", { skip: SKIP }, () => {
  // FOUNDER RULING, 2026-08-25: "what if I don't want wallet information in the
  //     town repo?" An earlier draft of this lane put it at
  //     WHITE_PAGES/<handle>/wallet.json. This test is what stops that returning:
  //     it fails if any household folder grows a wallet file, and it fails if the
  //     module's default path is anywhere inside a town clone.
  const town = seamTown({ wallets: { paz: null } });
  const stray = [];
  for (const d of readdirSync(join(town.repo, "WHITE_PAGES"), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of readdirSync(join(town.repo, "WHITE_PAGES", d.name)))
      if (/wallet/i.test(f)) stray.push(`${d.name}/${f}`);
  }
  assert.deepEqual(stray, [], "no household folder carries anything wallet-shaped");
  assert.ok(!/WHITE_PAGES/.test(DEFAULT_REGISTRY), "the default registry path is not inside a town clone");
  assert.match(DEFAULT_REGISTRY, /^\/srv\//, "it is a box-side state file");
  // and it is not inside /srv/postmark-office either: that is a live git checkout
  // the deploy pulls into, and the repo's own .gitignore note records what happens
  // to untracked state that lives there — it waits "to be swept into a commit by
  // `git add -A`". A wallet registry is the last thing that should be one careless
  // add away from a public repo.
  assert.ok(!DEFAULT_REGISTRY.startsWith("/srv/postmark-office"), "and not inside the office's own git checkout");
});

test("a registered address names its household, and case never matters", { skip: SKIP }, () => {
  const { byAddress, invalid } = foldRegistry(reg("paz", PAZ_WALLET), { households: HH });
  assert.deepEqual(invalid, []);
  assert.equal(handleForAddress(byAddress, PAZ_WALLET), "paz");
  assert.equal(handleForAddress(byAddress, PAZ_WALLET.toUpperCase().replace("0X", "0x")), "paz", "the chain's own spelling and a registration's are the same address");
  assert.equal(handleForAddress(byAddress, STRANGER_WALLET), null);
});

test("THE JOURNAL SHAPE IS THE MIGRATION-FREE ONE: the operator's line and the door's future line are the same line", { skip: SKIP }, () => {
  // The follow-up is an authenticated `household do: "register-wallet"` act that
  // appends an office journal row which materializes into this store. That is
  // WHY this is an append-only journal and not an object the operator edits: an
  // object would need read-modify-write under a lock from the door, and the
  // door's row would then differ in shape from the operator's — a migration.
  const byPen = reg("paz", PAZ_WALLET, { by: "operator-pen" });
  const byDoor = registrationLine({ handle: "paz", address: PAZ_WALLET, by: "door:register-wallet", at: "2026-08-26T00:00:00Z" });
  assert.deepEqual(Object.keys(JSON.parse(byPen)).sort(), Object.keys(JSON.parse(byDoor)).sort(), "same fields");
  const a = foldRegistry(byPen, { households: HH }), b = foldRegistry(byDoor, { households: HH });
  assert.deepEqual([...a.byAddress], [...b.byAddress]);
  assert.equal(JSON.parse(byDoor).by, "door:register-wallet", "and provenance is preserved, not flattened");
});

test("a revoke is an APPEND, never an edit — a lost wallet costs one line and no history", { skip: SKIP }, () => {
  const journal = [reg("paz", PAZ_WALLET), JSON.stringify({ at: "2026-08-27T00:00:00Z", act: "revoke", address: PAZ_WALLET, by: "operator-pen" })].join("\n");
  const { byAddress, invalid, rows } = foldRegistry(journal, { households: HH });
  assert.deepEqual(invalid, []);
  assert.equal(handleForAddress(byAddress, PAZ_WALLET), null, "the address no longer resolves");
  assert.equal(rows.length, 2, "and both acts are still on the record");
  const back = foldRegistry(journal + "\n" + reg("paz", PAZ_WALLET, { at: "2026-08-28T00:00:00Z" }), { households: HH });
  assert.equal(handleForAddress(back.byAddress, PAZ_WALLET), "paz");
});

test("an address with live claims from two households resolves to NOBODY, and both are surfaced", { skip: SKIP }, () => {
  // LAW (src/usdc-witness.mjs, what the witness cannot see, verbatim): "which
  //     pot the payer meant, whose household the payer keeps, and whether this
  //     hash was already recorded. Those three are the LEDGER's to hold".
  //     A registry that guessed between two claimants would answer the second
  //     question by coin-flip, on somebody's real money.
  const { byAddress, invalid } = foldRegistry([reg("paz", PAZ_WALLET), reg("stan", PAZ_WALLET)].join("\n"), { households: HH });
  assert.equal(handleForAddress(byAddress, PAZ_WALLET), null, "it resolves to nobody");
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].reason, /live claims from 2 households \(paz, stan\)/);
  assert.match(invalid[0].reason, /Append a `revoke` for the wrong one/);
});

test("A HANDLE THE TOWN DOES NOT KNOW IS REFUSED — the hole the relocation opened, closed", { skip: SKIP }, () => {
  // While the registry lived in the town repo the handle was a household BY
  // CONSTRUCTION: it was the folder's own name. Off the town repo nothing
  // guarantees it, and a receipt witnessed under a non-household handle is
  // treated as an OUTSIDE PATRON at the close — deriveEpochClose, verbatim: "An
  // outside patron (the founding family grant) resolves to neither and lands as
  // gift, holo 0. The resident's own holo would be quietly lost. So the fold checks.
  const { byAddress, invalid } = foldRegistry(reg("not-a-resident", PAZ_WALLET), { households: HH });
  assert.equal(byAddress.size, 0);
  assert.match(invalid[0].reason, /is not a household the town knows/);
  assert.match(invalid[0].reason, /quietly cost that resident their holo/);
  assert.equal(foldRegistry(reg("paz", PAZ_WALLET), { households: HH }).byAddress.size, 1);
});

test("a malformed registration is DISCLOSED rather than dropped", { skip: SKIP }, () => {
  // LAW (src/funding.mjs, verbatim): "Malformed rows are SURFACED, never
  //     silently rendered or silently dropped … refuse or disclose, never
  //     quietly substitute." A household that thinks it registered and did not
  //     would otherwise wait forever for a witness that never comes.
  const journal = [
    reg("paz", "not-an-address"),
    reg("stan", STRANGER_WALLET, { chain: "ethereum" }),
    "{ not json",
    JSON.stringify({ at: "x", act: "consider", address: STRANGER_WALLET }),
  ].join("\n");
  const { byAddress, invalid } = foldRegistry(journal, { households: HH });
  assert.equal(byAddress.size, 0);
  assert.equal(invalid.length, 4, "every bad line is named, none folded away");
  assert.ok(invalid.some((i) => /is not an address/.test(i.reason)));
  assert.ok(invalid.some((i) => /reads no other chain/.test(i.reason)));
  assert.ok(invalid.some((i) => /unparseable JSON/.test(i.reason)));
  assert.ok(invalid.some((i) => /is not one of register, revoke/.test(i.reason)));
});

test("an absent registry is an empty registry, not an error — and it says it is absent", { skip: SKIP }, () => {
  const r = readWalletRegistry(join(tmpdir(), "no-such-registry-" + Date.now() + ".jsonl"));
  assert.equal(r.present, false);
  assert.equal(r.byAddress.size, 0);
  assert.deepEqual(r.invalid, []);
});

// ════════════════════════════════════════════════════════════════════════════
// THE POT — which need did this address mean
// ════════════════════════════════════════════════════════════════════════════

test("the shipped intake map never names the SHARED address, whatever else it maps", { skip: SKIP }, () => {
  // WHAT THIS ASSERTS, and what it deliberately stopped asserting.
  //
  // Until 2026-08-25 this read `map.size === 0` — a snapshot of a world with no
  // per-pot addresses in it. The founder minted keeping-ec2's address that day
  // and the snapshot went red, having caught nothing: it was a fact about
  // today, not a law, and the law it was standing in for is narrower and does
  // not expire. deploy/intake-addresses.json states it in its own `_never`,
  // quoted verbatim:
  //
  //   "Do NOT map the shared intake address to a pot to make the queue go away.
  //    That would make the office decide where a stranger's money went, which
  //    is the one judgement this whole lane refuses to make."
  //
  // So: mapping a NEW address to a pot is the founder's ordinary act and must
  // not fail here. Mapping the SHARED one is the forbidden act, and does.
  const { map, invalid } = readIntakeMap();
  assert.deepEqual(invalid, [], "the shipped file parses");
  assert.equal(map.get(INTAKE), undefined, "the shared intake names no pot — `_never`");
  // and the scan ALWAYS covers the standing intake, whatever the map holds, so
  // neither an empty map nor a full one can make the watch blind to the address
  // every published surface has pointed at since the rail opened
  assert.ok(intakeAddresses(map).includes(INTAKE), "the standing intake is always scanned");
  assert.deepEqual(intakeAddresses(new Map()), [INTAKE], "an empty map scans the standing address alone");
  assert.deepEqual(intakeAddresses(new Map([[POT_A_ADDRESS, "pot-a"]])), [INTAKE, POT_A_ADDRESS]);
});

test("a registered payer at an address that names no single pot is HELD as needs-pot, with a letter", { skip: SKIP }, async () => {
  // LAW (tools/epoch-close.mjs --receipt, verbatim): `no pot file
  //     WHITE_PAGES/pot-${pot}.json — a receipt needs the pot it pays`.
  //     Knowing WHOSE dollar it is does not tell the town WHICH need it meant.
  const town = seamTown({ wallets: { paz: null } });
  const now = 2_000_000_000_000;
  const a = { ...decodeArrival(transfer({ txhash: HASH_A, block: 100, usd: 40 })), ts: now - CROSSING_MS * 2 };
  const r = resolveArrivals({
    arrivals: [a], entries: entriesOf(town.repo), engine: ENGINE, clone: town.repo,
    potFor: () => null, handleFor: () => "paz", now,
  });
  assert.equal(r.witness.length, 0, "it is not witnessed");
  assert.equal(r.needs_pot.length, 1);
  assert.equal(r.needs_pot[0].handle, "paz");
  assert.match(r.needs_pot[0].letter, /the chain cannot tell us WHICH need you meant to fund/);
  assert.match(r.needs_pot[0].letter, /nothing is lost while it waits/);
});

test("a mapped address names its pot, and the map is read off the RECIPIENT topic, never remembered from the filter", { skip: SKIP }, async () => {
  const town = seamTown({ wallets: { paz: null } });
  const now = 2_000_000_000_000;
  const potMap = new Map([[POT_A_ADDRESS, "pot-a"], [POT_B_ADDRESS, "pot-b"]]);
  const logs = [
    transfer({ txhash: HASH_A, block: 100, usd: 40, to: POT_A_ADDRESS }),
    transfer({ txhash: HASH_B, block: 101, usd: 25, to: POT_B_ADDRESS }),
  ];
  // decodeArrival must distinguish them from ONE multi-address scan
  assert.equal(decodeArrival(logs[0]).to_address, POT_A_ADDRESS);
  assert.equal(decodeArrival(logs[1]).to_address, POT_B_ADDRESS);

  const c = chain({ head: 5000, logs, blockTs: () => now - CROSSING_MS * 2 });
  const { report, todo } = await watch({
    rpc: c.rpc, intake: intakeAddresses(potMap), entries: entriesOf(town.repo), engine: ENGINE,
    clone: town.repo, cursor: 99, potMap, wallets: new Map([[PAZ_WALLET, "paz"]]), now,
  });
  assert.deepEqual(todo.map((w) => [w.pot, w.usd, w.from]), [["pot-a", 40, "paz"], ["pot-b", 25, "paz"]]);
  assert.equal(report.needs_pot.length, 0);
  // one request, with the recipient slot carrying every address as its own OR
  const f = c.calls.find((x) => x.method === "eth_getLogs").params[0];
  assert.ok(Array.isArray(f.topics[2]), "the recipient slot is the OR, not three separate scans");
  assert.equal(f.topics[2].length, 3);
});

// ════════════════════════════════════════════════════════════════════════════
// THE ASYMMETRY WITH THE CARD RAIL — the part that must NOT be symmetric
// ════════════════════════════════════════════════════════════════════════════

test("an UNREGISTERED payer is never witnessed, however clearly the address names its pot", { skip: SKIP }, async () => {
  // LAW (tools/usdc-watch.mjs's own receipt, and the ledger's grammar it quotes,
  //     verbatim): "ref is unique forever: one dollar, one mint chance, a
  //     re-recorded receipt bounces" — so witnessing an unknown payer's arrival
  //     as an outside gift would spend the ref of a patron who is about to paste
  //     their hash at /fund/. stripe-watch DOES witness an unattributable card
  //     payment as a gift, and may, because that rail has no paste-path to
  //     front-run ("Step 2 — there isn't one"). Base has one. This test is the
  //     asymmetry.
  const town = seamTown();
  const now = 2_000_000_000_000;
  const before = ledgerText(town.repo);
  const a = { ...decodeArrival(transfer({ txhash: HASH_A, block: 100, usd: 40, to: POT_A_ADDRESS, from: STRANGER_WALLET })), ts: now - CROSSING_MS * 2 };
  const r = resolveArrivals({
    arrivals: [a], entries: entriesOf(town.repo), engine: ENGINE, clone: town.repo,
    potFor: () => "pot-a", handleFor: () => null, now,
  });
  assert.equal(r.witness.length, 0);
  assert.equal(r.unclaimed.length, 1);
  assert.match(r.unclaimed[0].why, /Witnessing it under a placeholder would spend the ref's one mint chance/);
  assert.equal(r.unclaimed[0].why, UNREGISTERED);
  assert.equal(ledgerText(town.repo), before);
});

// ════════════════════════════════════════════════════════════════════════════
// THE GRACE, AND THE DEPTH
// ════════════════════════════════════════════════════════════════════════════

test("a registered arrival younger than one crossing is HELD, and one exactly a crossing old is witnessed", { skip: SKIP }, async () => {
  const town = seamTown({ wallets: { paz: null } });
  const now = 2_000_000_000_000;
  const mk = (ts) => ({ ...decodeArrival(transfer({ txhash: HASH_A, block: 100, usd: 40, to: POT_A_ADDRESS })), ts });
  const args = { entries: entriesOf(town.repo), engine: ENGINE, clone: town.repo, potFor: () => "pot-a", handleFor: () => "paz", now };

  const young = resolveArrivals({ arrivals: [mk(now - CROSSING_MS + 1)], ...args });
  assert.equal(young.hold.length, 1);
  assert.equal(young.witness.length, 0);
  assert.equal(young.hold[0].plan.from, "paz", "the hold already knows the plan it is about to run");

  const ripe = resolveArrivals({ arrivals: [mk(now - CROSSING_MS)], ...args });
  assert.equal(ripe.witness.length, 1);
});

test("an arrival whose block time cannot be read is HELD, never witnessed and never swept", { skip: SKIP }, async () => {
  // Swallowing the timestamp error is only defensible in the conservative
  // direction: an unknown age must not be able to satisfy a deadline. This is
  // that claim, made testable.
  const town = seamTown({ wallets: { paz: null } });
  const now = 2_000_000_000_000;
  const c = chain({ head: 5000, logs: [transfer({ txhash: HASH_A, block: 100, usd: 40, to: POT_A_ADDRESS })], blockTs: null });
  const { report, todo } = await watch({
    rpc: c.rpc, intake: [POT_A_ADDRESS], entries: entriesOf(town.repo), engine: ENGINE, clone: town.repo,
    cursor: 99, potMap: new Map([[POT_A_ADDRESS, "pot-a"]]), wallets: new Map([[PAZ_WALLET, "paz"]]), now,
  });
  assert.equal(todo.length, 0);
  assert.equal(report.hold.length, 1);
  assert.match(report.hold[0].why, /the grace window cannot be shown to have passed/);
  assert.equal(report.hold[0].witnesses_after, null);
});

test("depth still governs: an arrival shallower than MIN_CONF is not even read, so it cannot be witnessed", { skip: SKIP }, async () => {
  // LAW (src/usdc-witness.mjs, check 4, verbatim): "confirmations >= MIN_CONF
  //     (finality is a claim about depth, not existence)".
  const town = seamTown({ wallets: { paz: null } });
  const now = 2_000_000_000_000;
  const head = 5000;
  const c = chain({ head, logs: [transfer({ txhash: HASH_A, block: head - MIN_CONF + 1, usd: 40, to: POT_A_ADDRESS })], blockTs: () => now - CROSSING_MS * 2 });
  const { report, todo, cursor } = await watch({
    rpc: c.rpc, intake: [POT_A_ADDRESS], entries: entriesOf(town.repo), engine: ENGINE, clone: town.repo,
    cursor: head - 100, potMap: new Map([[POT_A_ADDRESS, "pot-a"]]), wallets: new Map([[PAZ_WALLET, "paz"]]), now,
  });
  assert.equal(todo.length, 0, "a crossing old is not enough if it is not deep enough");
  assert.equal(report.arrivals, 0);
  assert.equal(cursor, head - MIN_CONF);
});

// ════════════════════════════════════════════════════════════════════════════
// THE CAP
// ════════════════════════════════════════════════════════════════════════════

test("a fully resolved arrival past the pot's posted target bounces to over-cap rather than witnessing", { skip: SKIP }, async () => {
  // LAW (D5, Keemin 2026-08-21, verbatim): "intake refuses dollars past a pot's
  //     posted target, mechanically (recording tool / door bounce), except pots
  //     explicitly marked uncapped."
  const town = seamTown({ wallets: { paz: null }, pots: { "pot-a": 10 } });
  const now = 2_000_000_000_000;
  const a = { ...decodeArrival(transfer({ txhash: HASH_A, block: 100, usd: 40, to: POT_A_ADDRESS })), ts: now - CROSSING_MS * 2 };
  const r = resolveArrivals({
    arrivals: [a], entries: entriesOf(town.repo), engine: ENGINE, clone: town.repo,
    potFor: () => "pot-a", handleFor: () => "paz", now,
  });
  assert.equal(r.witness.length, 0);
  assert.equal(r.over_cap.length, 1);
  assert.match(r.over_cap[0].why, /past pot "pot-a"'s posted target/);
  assert.match(r.over_cap[0].hint, /can still take \$10 this epoch/);
});

// ════════════════════════════════════════════════════════════════════════════
// THE SINK RULE — implemented, and OFF
// ════════════════════════════════════════════════════════════════════════════

test("THE SINK RULE IS OFF BY DEFAULT, and this test fails if anybody flips the default", { skip: SKIP }, () => {
  // The brief that proposed it said so in its own words: "implement behind a
  // config flag default OFF, founder flips it". The default is the law here,
  // so it is asserted directly rather than inferred from behaviour.
  assert.equal(sinkEnabled({}), false, "an empty environment sinks nothing");
  assert.equal(sinkEnabled({ [SINK_FLAG]: "0" }), false);
  assert.equal(sinkEnabled({ [SINK_FLAG]: "true" }), false, "only the exact flip counts");
  assert.equal(sinkEnabled(), false, "and the real process environment is not carrying it either");
  // …and the check is not vacuous: the flip DOES work when it is set.
  assert.equal(sinkEnabled({ [SINK_FLAG]: "1" }), true);
});

test("with the flag off, an old unclaimed arrival is LISTED as sink-eligible and still left unclaimed", { skip: SKIP }, async () => {
  const town = seamTown();
  const now = 2_000_000_000_000;
  const before = ledgerText(town.repo);
  const a = { ...decodeArrival(transfer({ txhash: HASH_A, block: 100, usd: 40, from: STRANGER_WALLET })), ts: now - (SINK_AGE_DAYS + 1) * 86_400_000 };
  const r = resolveArrivals({
    arrivals: [a], entries: entriesOf(town.repo), engine: ENGINE, clone: town.repo,
    potFor: () => null, handleFor: () => null, now, sink: false,
  });
  assert.equal(r.witness.length, 0, "nothing moved");
  assert.equal(r.sink.length, 1, "but the founder can see what the rule would take");
  assert.equal(r.sink[0].sink_enabled, false);
  assert.match(r.sink[0].sink_would, new RegExp(`outside:usdc.*${SINK_POT}`));
  assert.equal(r.unclaimed.length, 1, "and it is still in the operator's queue meanwhile");
  assert.equal(ledgerText(town.repo), before);
});

test("with the flag ON the rule runs, which is what makes the OFF assertion mean something", { skip: SKIP }, async () => {
  const town = seamTown();
  const now = 2_000_000_000_000;
  const a = { ...decodeArrival(transfer({ txhash: HASH_A, block: 100, usd: 40, from: STRANGER_WALLET })), ts: now - (SINK_AGE_DAYS + 1) * 86_400_000 };
  const r = resolveArrivals({
    arrivals: [a], entries: entriesOf(town.repo), engine: ENGINE, clone: town.repo,
    potFor: () => null, handleFor: () => null, now, sink: true,
  });
  assert.equal(r.witness.length, 1);
  assert.equal(r.witness[0].pot, SINK_POT);
  assert.equal(r.witness[0].from, OUTSIDE_FROM);
  assert.equal(r.witness[0].attributed, false);
});

test("a young unclaimed arrival is never sink-eligible, flag or no flag", { skip: SKIP }, async () => {
  const town = seamTown();
  const now = 2_000_000_000_000;
  const args = { entries: entriesOf(town.repo), engine: ENGINE, clone: town.repo, potFor: () => null, handleFor: () => null, now };
  const a = { ...decodeArrival(transfer({ txhash: HASH_A, block: 100, usd: 40, from: STRANGER_WALLET })), ts: now - (SINK_AGE_DAYS - 1) * 86_400_000 };
  assert.equal(resolveArrivals({ arrivals: [a], ...args, sink: false }).sink.length, 0);
  assert.equal(resolveArrivals({ arrivals: [a], ...args, sink: true }).witness.length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// THE WHOLE TICK STILL WRITES NOTHING
// ════════════════════════════════════════════════════════════════════════════

test("a quiet tick answers in the SAME SHAPE as a busy one — the commonest tick is not a degraded report", { skip: SKIP }, async () => {
  // A degraded shape is a second shape, and every reader of the first has to
  // learn about it the hard way. The quiet branch once dropped `intake`,
  // `generated_at` and the posture, and the CLI's very first line threw on the
  // commonest tick there is: an empty ten minutes.
  const town = seamTown();
  const now = 2_000_000_000_000;
  const head = 5000;
  const c = chain({ head, logs: [] });
  const quiet = await watch({ rpc: c.rpc, entries: entriesOf(town.repo), engine: ENGINE, clone: town.repo, cursor: head - MIN_CONF, now });
  const busy = await watch({ rpc: chain({ head, logs: [transfer({ txhash: HASH_A, block: 100, usd: 40 })], blockTs: () => now }).rpc, entries: entriesOf(town.repo), engine: ENGINE, clone: town.repo, cursor: 99, now });
  assert.deepEqual(Object.keys(quiet.report).sort(), Object.keys(busy.report).sort());
  assert.deepEqual(quiet.report.intake, [INTAKE], "and it still says which address it was watching");
  assert.equal(quiet.report.scanned, null);
  assert.equal(quiet.cursor, head - MIN_CONF, "unchanged");
});

test("watch() decides and records nothing — the caller is the only thing that can write", { skip: SKIP }, async () => {
  const town = seamTown({ wallets: { paz: null } });
  const now = 2_000_000_000_000;
  const before = ledgerText(town.repo);
  const c = chain({ head: 5000, logs: [transfer({ txhash: HASH_A, block: 100, usd: 40, to: POT_A_ADDRESS })], blockTs: () => now - CROSSING_MS * 2 });
  const { todo } = await watch({
    rpc: c.rpc, intake: [POT_A_ADDRESS], entries: entriesOf(town.repo), engine: ENGINE, clone: town.repo,
    cursor: 99, potMap: new Map([[POT_A_ADDRESS, "pot-a"]]), wallets: new Map([[PAZ_WALLET, "paz"]]), now,
  });
  assert.equal(todo.length, 1, "it decided to witness");
  assert.equal(ledgerText(town.repo), before, "and wrote nothing doing it");
});
