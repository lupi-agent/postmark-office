// usdc-watch-held-behind-cursor.test.mjs — THE ARRIVAL THE CURSOR FORGOT.
//
//   node --test test/usdc-watch-held-behind-cursor.test.mjs
//
// ── THE FAILURE THIS RETIRES (postmark#2978, POS-134) ───────────────────────
//
// The Base rail had the card rail's #2973, and had it worse. `watch()` scans
// `from = cursor + 1` and returns `cursor = to`, the deepest block the tick
// could safely read. `resolveArrivals` HOLDS a fresh arrival for its grace
// (`graceMs = CROSSING_MS`, twelve hours). The timer is every ten minutes. So
// tick 1 sees the arrival and holds it, the cursor steps past its block, and
// tick 2 — ten minutes later — scans from the cursor and cannot see it.
//
// Not "when a newer row shares a listing", the way the card rail's was. EVERY
// arrival, on its SECOND tick, always. The two-tick probe at
// docs/2026-09-19/pos-2973/usdc-orphan-probe.mjs reads it out loud:
//
//   TICK 1  cursor -> 1005 {"hold":1, …}
//   TICK 2  cursor -> 1005 {"hold":0, …}
//
// over one arrival that nobody touched in between.
//
// NOTHING HERE MOVES MONEY. This rail only ever SEES — the unit records no
// ledger row and holds no lock. What the orphaning cost was the arrival's place
// on `arrivals.json`, which `tools/funding-report.mjs` reads for the operator's
// Base queue and its anomaly rows; and it is why `SINK_AGE_DAYS = 7` could
// never come due on an ordinary tick, since an arrival is gone from the scan
// long before it is seven days old.
//
// THE CURSOR IS FOR FINDING NEW BLOCKS. THE JOURNAL IS FOR REMEMBERING HELD
// ARRIVALS — the card rail's own sentence, and its answer is the one mirrored
// here: `usdc-intake.jsonl` beside the state file, every seen-and-unresolved
// row decided again each tick whatever the cursor says.
//
// ── WHAT EACH CASE IS FOR ───────────────────────────────────────────────────
//
//   F1a the bug itself, through the QUIET branch — which is the branch the real
//       probe takes, because ten minutes after a tick the safe head has often
//       not moved past the cursor at all. RED at the train tip.
//   F1b the bug itself, through the SCANNING branch — the head has moved on and
//       the scan simply starts past the arrival. RED at the train tip. The two
//       branches are separate lines of code and a fix wired into one of them
//       ships looking fully tested.
//   F2  THE CONTROL. The same two ticks with NO journal still lose it. Green on
//       both sides by construction: it is what makes F1's green mean "the
//       journal did it" rather than "the harness never reproduced anything".
//   F3  the grace comes due behind the cursor: a remembered arrival is
//       WITNESSED into `todo` on a later tick. This is the half the operator
//       actually waits on.
//   F4  SINK_AGE_DAYS is reachable on an ordinary tick — an unregistered
//       arrival eight days old, remembered, sinks with the founder's flag ON.
//       It asserts the flag's default separately so it cannot pass by flipping
//       the rail's posture.
//   F5  an arrival the journal records as WITNESSED is not decided again at
//       all. The ledger's ref-uniqueness would bounce a second write anyway;
//       the watcher must not even try.
//   F6  freshness: an arrival in BOTH the scan and the journal is decided from
//       the LIVE decode. A journal row is a snapshot; letting it win would
//       freeze the arrival at the moment it was worst understood.
//   F7  the non-regression: the cursor is still computed from the scan alone. A
//       journal row must not move it. This is a fix TO a cursor bug.
//   F8  a tick that cannot reach the chain throws before anything is decided,
//       so it returns no rows to journal and no cursor to persist.
//   F9  `unresolvedSeen` is the whole rule, and it is pure.
//   F10 the journal's two functions round-trip on a real file, and a torn line
//       is surfaced rather than thrown.
//   F11 the CLI's wiring, as SOURCE TEXT. Explicitly the weakest case here —
//       see its own comment for what it does and does not prove.
//
// ── WHICH OF THE TWELVE DISCRIMINATE, so twelve green is not read as twelve
//    guards (measured, both flips run one variable at a time) ───────────────
//
//   Flip 1, drop the journal union entirely: reds F1a, F1b, F3, F4, F7 — five.
//   Flip 2, restore the unconditional quiet-branch early return: reds F1a
//   ALONE, which is what that case was written for and is the proof the two
//   halves of this change are separately held.
//
//   F2 and F8 stay green under both ON PURPOSE: F2 is the control (the
//   orphaning is real on either side) and F8 is the throw path, which this
//   change does not touch. F5 and F6 pass trivially when nothing is
//   remembered — they pin the SHAPE of the fix, not the bug, and their own
//   flips would be "let a witnessed row back in" and "let the snapshot win".
//   F9/F10/F11 are the rule, the file and the wiring, and red at the train tip
//   on the symbols not existing rather than on behaviour.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { INTAKE, USDC, TRANSFER_TOPIC, MIN_CONF } from "../src/usdc-witness.mjs";
import { CROSSING_MS } from "../src/crossings.mjs";
import { watch, decodeArrival, SINK_POT, SINK_AGE_DAYS, OUTSIDE_FROM, sinkEnabled } from "../tools/usdc-watch.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";
// `unresolvedSeen`, `journalRef` and the journal's two file functions are
// imported INSIDE the cases that need them, on purpose. A static import of a
// symbol the train tip does not export is a LOAD error, and a load error reds
// every case in this file for a reason none of them is about — the base
// measurement would then say nothing about F1 at all. Each case must be able to
// fail for its own reason. (The card rail's F5 pays for this lesson in words.)

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN = [townClone()].filter(Boolean)
  .find((p) => existsSync(join(p, "tools", "stamp-mint.mjs")));
// Guarded: a top-level await import of a clone that is not there takes the
// whole module down at load, and its cases then neither pass nor fail.
const ENGINE = TOWN ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const SKIP = !TOWN && NO_TOWN;

const pad32 = (a) => "0x" + "0".repeat(24) + String(a).replace(/^0x/, "").toLowerCase();
const usdcHex = (u) => "0x" + BigInt(Math.round(u * 1e6)).toString(16);

const PAYER = "0xf00dcafe00000000000000000000000000000001";
const STRANGER = "0xfeedface00000000000000000000000000000002";
const POT_A = "0xaaaa000000000000000000000000000000000001";

const HASH_HELD = "0x" + "a1".repeat(32);
const HASH_NEW = "0x" + "b2".repeat(32);

const ARRIVAL_BLOCK = 1_000;
// The head ten minutes after the arrival settled: deep enough to be read, and
// the cursor lands exactly on it, which is what strands the arrival.
const HEAD_1 = ARRIVAL_BLOCK + MIN_CONF + 5;
// Base mines every ~2s, so ten more minutes is ~300 blocks further on.
const HEAD_2 = HEAD_1 + 300;

function transfer({ txhash, block, usd, to = POT_A, from = PAYER, token = USDC, topic = TRANSFER_TOPIC }) {
  return {
    transactionHash: txhash, blockNumber: "0x" + block.toString(16),
    address: token, topics: [topic, pad32(from), pad32(to)], data: usdcHex(usd),
  };
}

/** A Base that honours address + topics (single or OR-array) + block range. */
function chain({ head, logs = [], blockTs = null, throws = false } = {}) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (throws) throw new Error("all RPCs failed: connect ECONNREFUSED");
    if (method === "eth_blockNumber") return "0x" + head.toString(16);
    if (method === "eth_getBlockByNumber") {
      if (blockTs == null) throw new Error("no block time available");
      return { timestamp: "0x" + BigInt(Math.floor(blockTs(Number(BigInt(params[0]))) / 1000)).toString(16) };
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

function seamTown() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const repo = mkdtempSync(join(tmpdir(), "usdc-held-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify({ paz: { login: "p", id: 2 }, stan: { login: "s", id: 1 } }));
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n- 2026-06-12 · m-1 · stan → paz · thread: new\n");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(join(repo, "ECONOMY-DIALS.json"), JSON.stringify({
    law_side: { town_issuance: { treasury_handle: "the-town", once_purposes: [] }, keeping: { sigma: 0.5, rho: 0.5, rho_constitutional_ceiling: 0.5 } },
  }));
  writeFileSync(join(repo, "WHITE_PAGES", "pot-pot-a.json"), JSON.stringify({ pot: "pot-a", status: "open", beneficiary: "keeper", target_usd_per_epoch: 1000, epoch_cadence: "monthly", received_usd: 0 }));
  writeFileSync(join(repo, "WHITE_PAGES", `pot-${SINK_POT}.json`), JSON.stringify({ pot: SINK_POT, status: "open", beneficiary: "keeper", target_usd_per_epoch: null, epoch_cadence: "monthly", received_usd: 0, uncapped: true, close: "elastic", min_close_usd: 5 }));
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  return { repo, keyFile };
}

const entriesOf = (repo) => ENGINE.parseStampLedger(readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));

const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const MINED = NOW - 3_600_000;              // one hour ago — well inside the grace
const DUE = MINED + CROSSING_MS + 60_000;   // a minute past the grace

/**
 * The journal row the CLI writes for an arrival it decided, built from the log
 * the test itself minted rather than from a tick's return value — so a tip that
 * returns no `seen` at all fails F1 on F1's own assertion instead of on a
 * TypeError about a field that is not there yet.
 */
const seenRow = (log, { ts = MINED, at = "2026-09-20T12:00:00.000Z" } = {}) =>
  ({ kind: "seen", at, ...decodeArrival(log), ts });

/** One tick, with everything this rail's `watch()` needs and nothing else. */
const tick = ({ rpc, town, cursor, journal, now = NOW, sink = false, wallets = [[PAYER, "paz"]] }) =>
  watch({
    rpc, intake: [POT_A], entries: entriesOf(town.repo), engine: ENGINE, clone: town.repo,
    cursor, potMap: new Map([[POT_A, "pot-a"]]), wallets: new Map(wallets), now, sink,
    ...(journal === undefined ? {} : { journal }),
  });

const HELD_LOG = transfer({ txhash: HASH_HELD, block: ARRIVAL_BLOCK, usd: 10 });

// ════════════════════════════════════════════════════════════════════════════
// F1 — THE BUG, IN BOTH OF ITS BRANCHES
// ════════════════════════════════════════════════════════════════════════════

test("F1a · the QUIET branch: nothing new settled, and the held arrival is STILL held", { skip: SKIP }, async () => {
  const town = seamTown();
  const c1 = chain({ head: HEAD_1, logs: [HELD_LOG], blockTs: () => MINED });
  const t1 = await tick({ rpc: c1.rpc, town, cursor: null, journal: [] });

  // Tick 1 is the tip's own behaviour and is not what this file is about.
  assert.equal(t1.report.hold.length, 1, "tick 1 holds it: it is inside the twelve-hour grace");
  assert.equal(t1.cursor, HEAD_1 - MIN_CONF, "and the cursor has stepped onto the arrival's own depth");
  assert.ok(t1.cursor >= ARRIVAL_BLOCK, "which is at or past the block the arrival is in — that is the whole mechanism");

  // Ten minutes later. The safe head has not moved, so `from > safeHead` and
  // the tick takes the quiet branch — which is exactly what the live probe did.
  const c2 = chain({ head: HEAD_1, logs: [HELD_LOG], blockTs: () => MINED });
  const t2 = await tick({ rpc: c2.rpc, town, cursor: t1.cursor, journal: [seenRow(HELD_LOG)] });

  assert.equal(t2.report.scanned, null, "the tick really is the quiet one — no blocks were read");
  assert.equal(t2.report.arrivals, 0, "and the scan count stays honest: the chain returned nothing");
  // THE BUG, ASSERTED. At the train tip this is the line that reds.
  assert.equal(t2.report.hold.length, 1, "the journal remembers it, so it is still held rather than gone");
  assert.equal(t2.report.hold[0].txhash, HASH_HELD);
  assert.equal(t2.report.hold[0].plan.pot, "pot-a");
  assert.equal(t2.report.hold[0].plan.from, "paz");
  assert.equal(t2.report.rechecked, 1, "and the tick SAYS it re-read the journal, so the two reads stay tellable apart");
  assert.equal(t2.cursor, t1.cursor, "a quiet tick still moves the cursor over nothing");
});

test("F1b · the SCANNING branch: the head has moved on, and the held arrival is STILL held", { skip: SKIP }, async () => {
  const town = seamTown();
  const c1 = chain({ head: HEAD_1, logs: [HELD_LOG], blockTs: () => MINED });
  const t1 = await tick({ rpc: c1.rpc, town, cursor: null, journal: [] });
  assert.equal(t1.report.hold.length, 1);

  // Ten minutes and ~300 blocks later, with nothing new in them. The scan runs
  // for real and starts past the arrival's block.
  const c2 = chain({ head: HEAD_2, logs: [HELD_LOG], blockTs: () => MINED });
  const t2 = await tick({ rpc: c2.rpc, town, cursor: t1.cursor, journal: [seenRow(HELD_LOG)] });

  assert.deepEqual(t2.report.scanned, { from: t1.cursor + 1, to: HEAD_2 - MIN_CONF }, "it scanned, and it scanned past the arrival");
  assert.ok(t2.report.scanned.from > ARRIVAL_BLOCK, "the arrival's block is behind the range — the chain was never asked about it");
  assert.equal(t2.report.arrivals, 0, "so the scan itself found nothing, and says so");
  // THE BUG, ASSERTED. RED at the train tip.
  assert.equal(t2.report.hold.length, 1, "and the journal is what keeps it on the report");
  assert.equal(t2.report.hold[0].txhash, HASH_HELD);
  assert.equal(t2.report.rechecked, 1);
  assert.equal(t2.cursor, HEAD_2 - MIN_CONF, "the cursor still follows the chain");
});

test("F2 · THE CONTROL — the same two ticks with NO journal lose it, on both sides of the fix", { skip: SKIP }, async () => {
  // Without this, F1 going green would be indistinguishable from a harness that
  // never reproduced anything. This is the assertion that can only pass while
  // the orphaning is real, and it must pass at the tip AND after the fix.
  const town = seamTown();
  const c1 = chain({ head: HEAD_1, logs: [HELD_LOG], blockTs: () => MINED });
  const t1 = await tick({ rpc: c1.rpc, town, cursor: null, journal: [] });
  assert.equal(t1.report.hold.length, 1, "seen once");

  const c2 = chain({ head: HEAD_2, logs: [HELD_LOG], blockTs: () => MINED });
  const t2 = await tick({ rpc: c2.rpc, town, cursor: t1.cursor, journal: [] });
  assert.equal(t2.report.hold.length, 0, "and gone on the second tick — the cursor alone remembers nothing");
  assert.equal(t2.report.witness.length, 0);
  assert.equal(t2.report.unclaimed.length, 0);
  assert.equal(t2.report.witnessed.length, 0, "not hiding in another bucket either: the arrival is simply not in the tick");
});

// ════════════════════════════════════════════════════════════════════════════
// F3/F4 — WHAT THE MEMORY IS FOR: the rules that need time to come due
// ════════════════════════════════════════════════════════════════════════════

test("F3 · the grace comes due BEHIND the cursor: a remembered arrival is witnessed into `todo`", { skip: SKIP }, async () => {
  const town = seamTown();
  const c = chain({ head: HEAD_2, logs: [HELD_LOG], blockTs: () => MINED });
  const t = await tick({ rpc: c.rpc, town, cursor: HEAD_1 - MIN_CONF, journal: [seenRow(HELD_LOG)], now: DUE });

  assert.equal(t.report.arrivals, 0, "the chain did not return it — this tick only knows it from the journal");
  assert.equal(t.report.hold.length, 0, "its twelve hours are up");
  assert.equal(t.todo.length, 1, "so the tick hands it to the caller to record");
  assert.equal(t.todo[0].ref, `usdc:base:${HASH_HELD}`);
  assert.equal(t.todo[0].pot, "pot-a");
  assert.equal(t.todo[0].from, "paz");
  assert.equal(t.todo[0].usd, 10);
  assert.equal(t.report.rechecked, 1);
});

test("F4 · SINK_AGE_DAYS is reachable on an ordinary tick, because the arrival is still in the tick", { skip: SKIP }, async () => {
  // The rule's own default is asserted first, so this case can never pass by
  // having quietly flipped the rail's posture rather than by remembering a row.
  assert.equal(sinkEnabled({}), false, "the sink rule is OFF unless the founder's flag says otherwise");

  const town = seamTown();
  const log = transfer({ txhash: HASH_HELD, block: ARRIVAL_BLOCK, usd: 25, from: STRANGER });
  const old = NOW - (SINK_AGE_DAYS + 1) * 86_400_000;
  const c = chain({ head: HEAD_2, logs: [log], blockTs: () => old });
  // Nobody has registered the stranger's address, which is what makes it sinkable.
  const journal = [seenRow(log, { ts: old })];

  const off = await tick({ rpc: c.rpc, town, cursor: HEAD_1 - MIN_CONF, journal, sink: false });
  assert.equal(off.report.arrivals, 0, "again: only the journal knows about it");
  assert.equal(off.report.sink.length, 1, "with the flag OFF it is LISTED as what the rule would take");
  assert.equal(off.report.sink[0].sink_enabled, false);
  assert.equal(off.report.unclaimed.length, 1, "and it is still left unclaimed");
  assert.equal(off.todo.length, 0, "nothing is handed to the caller to record");

  const on = await tick({ rpc: c.rpc, town, cursor: HEAD_1 - MIN_CONF, journal, sink: true });
  assert.equal(on.todo.length, 1, "with the flag ON the rule finally runs — which is what makes the OFF assertion mean something");
  assert.equal(on.todo[0].pot, SINK_POT);
  assert.equal(on.todo[0].from, OUTSIDE_FROM);
});

// ════════════════════════════════════════════════════════════════════════════
// F5/F6/F7 — the shape of the fix
// ════════════════════════════════════════════════════════════════════════════

test("F5 · an arrival the journal records as WITNESSED is not decided again at all", { skip: SKIP }, async () => {
  const { unresolvedSeen } = await import("../tools/usdc-watch.mjs");
  const town = seamTown();
  const rows = [
    seenRow(HELD_LOG),
    { kind: "witnessed", at: "2026-09-20T13:00:00.000Z", txhash: HASH_HELD, ref: `usdc:base:${HASH_HELD}`, pot: "pot-a", from: "paz", usd: 10 },
  ];
  const c = chain({ head: HEAD_2, logs: [HELD_LOG], blockTs: () => MINED });
  const t = await tick({ rpc: c.rpc, town, cursor: HEAD_1 - MIN_CONF, journal: unresolvedSeen(rows), now: DUE });

  assert.equal(t.report.rechecked, 0, "the watcher does not even TRY an arrival it already witnessed");
  assert.equal(t.todo.length, 0);
  assert.equal(t.report.hold.length, 0);
  assert.equal(t.report.unclaimed.length, 0);
  assert.equal(t.report.witnessed.length, 0, "and it is not smuggled in under another bucket");
});

test("F6 · an arrival in BOTH the scan and the journal is decided from the LIVE decode", { skip: SKIP }, async () => {
  // The journal remembers it as $10. The chain says $10 too — it must, because a
  // confirmed transfer is immutable. What the snapshot COULD get wrong is
  // everything derived beside it, so the test plants a wrong amount in the
  // journal and proves the live read is the one that answers.
  const town = seamTown();
  const stale = { ...seenRow(HELD_LOG), usd: 999, from_address: STRANGER };
  const c = chain({ head: ARRIVAL_BLOCK + MIN_CONF + 5, logs: [HELD_LOG], blockTs: () => MINED });
  const t = await tick({ rpc: c.rpc, town, cursor: ARRIVAL_BLOCK - 1, journal: [stale] });

  assert.equal(t.report.arrivals, 1, "the scan returned it");
  assert.equal(t.report.rechecked, 0, "so there was nothing behind the cursor to re-decide");
  assert.equal(t.report.hold.length, 1, "decided once, not twice");
  assert.equal(t.report.hold[0].usd, 10, "and from the live decode, not the stale snapshot");
  assert.equal(t.report.hold[0].plan.from, "paz", "the live payer, not the one the snapshot claimed");
});

test("F7 · the cursor is still computed from the SCAN alone — a journal row cannot move it", { skip: SKIP }, async () => {
  // This is a fix TO a cursor bug; it must not quietly also be a second change
  // to what the cursor means.
  const town = seamTown();
  const c = chain({ head: HEAD_2, logs: [], blockTs: () => MINED });
  const t = await tick({ rpc: c.rpc, town, cursor: HEAD_1 - MIN_CONF, journal: [seenRow(HELD_LOG)] });

  assert.equal(t.cursor, HEAD_2 - MIN_CONF, "the cursor follows the chain's safe head and nothing else");
  assert.equal(t.report.rechecked, 1, "though a journal row was decided this tick");
  assert.equal(t.report.arrivals, 0, "and the scan count is the chain's number, never inflated by the journal");

  // and a NEW arrival is still found the ordinary way
  const fresh = transfer({ txhash: HASH_NEW, block: HEAD_2 - MIN_CONF - 1, usd: 40 });
  const c2 = chain({ head: HEAD_2, logs: [fresh], blockTs: () => MINED });
  const t2 = await tick({ rpc: c2.rpc, town, cursor: HEAD_1 - MIN_CONF, journal: [] });
  assert.equal(t2.report.arrivals, 1, "the scan is still how new arrivals arrive");
  assert.equal(t2.report.hold[0].txhash, HASH_NEW);
});

// ════════════════════════════════════════════════════════════════════════════
// F8/F9/F10/F11 — the throw, the rule, the file, and the wiring
// ════════════════════════════════════════════════════════════════════════════

test("F8 · a tick that cannot reach the chain returns nothing to journal and no cursor to persist", { skip: SKIP }, async () => {
  const town = seamTown();
  const c = chain({ head: HEAD_2, throws: true });
  let thrown = null;
  try {
    await tick({ rpc: c.rpc, town, cursor: HEAD_1 - MIN_CONF, journal: [seenRow(HELD_LOG)] });
  } catch (e) { thrown = e; }

  assert.ok(thrown, "it throws rather than reporting a quiet day it cannot see");
  assert.match(thrown.message, /the cursor has not moved/);
  assert.equal(c.calls.length, 1, "and it threw on the head read, before any block was asked for");
  // There is therefore no `seen` and no `cursor` in the caller's hands at all:
  // the append and the state write in `main()` are both downstream of this
  // await, so a throw appends nothing and moves nothing. F11 pins that order.
});

test("F9 · unresolvedSeen is the whole rule, and it is pure", { skip: SKIP }, async () => {
  const { unresolvedSeen, journalRef } = await import("../tools/usdc-watch.mjs");
  assert.equal(typeof unresolvedSeen, "function", "the tick's journal rule is exported, so it can be read and tested on its own");

  const ref = (h) => `usdc:base:0x${h}`;
  const rows = [
    { kind: "seen", receipt_ref: ref("aa"), usd: 1 },
    { kind: "seen", receipt_ref: ref("bb"), usd: 2 },
    // The written rows spell the key `ref`, not `receipt_ref`. If those two
    // names ever stop resolving to one key, a witnessed arrival is decided
    // forever and nothing in the report looks wrong.
    { kind: "witnessed", ref: ref("aa") },
    { kind: "seen", receipt_ref: ref("bb"), usd: 99 },   // a boundary seen twice
    { kind: "refused", ref: ref("cc") },
    { kind: "seen", receipt_ref: ref("cc"), usd: 3 },
    { malformed: "a torn line is not an arrival" },
  ];
  assert.deepEqual(unresolvedSeen(rows).map((r) => r.receipt_ref), [ref("bb"), ref("cc")],
    "witnessed drops out; a REFUSED one stays, because its ref is unspent and the next tick tries again");
  assert.equal(unresolvedSeen(rows).find((r) => r.receipt_ref === ref("bb")).usd, 2, "the FIRST sighting wins, so a re-seen row cannot rewrite itself");
  assert.deepEqual(unresolvedSeen([]), []);
  assert.deepEqual(unresolvedSeen(undefined), []);
  assert.equal(journalRef({ ref: "x" }), "x");
  assert.equal(journalRef({ receipt_ref: "y", ref: "x" }), "y", "an arrival's own spelling wins where a row carries both");
  assert.equal(journalRef({}), null);
});

test("F10 · the journal round-trips on a real file, and a torn line is surfaced rather than thrown", { skip: SKIP }, async () => {
  const { readUsdcJournal, appendUsdcJournal, USDC_JOURNAL_NAME, USDC_JOURNAL_PATH, STATE_PATH } =
    await import("../tools/usdc-watch.mjs");

  assert.equal(USDC_JOURNAL_NAME, "usdc-intake.jsonl");
  // `join` is the card rail's own idiom for this pair and it writes a
  // backslash on Windows, where nothing but a test ever reads the constant —
  // on the box the separator is the one in the literal. Normalised for the
  // comparison exactly as test/watch-state-one-owner.test.mjs already does.
  const slash = (p) => p.replace(/\\/g, "/");
  assert.equal(slash(dirname(USDC_JOURNAL_PATH)), dirname(STATE_PATH),
    "the journal lives in the same directory as the cursor it belongs to, derived rather than typed");
  assert.equal(slash(USDC_JOURNAL_PATH), `${dirname(STATE_PATH)}/${USDC_JOURNAL_NAME}`);

  const dir = mkdtempSync(join(tmpdir(), "usdc-journal-"));
  const p = join(dir, USDC_JOURNAL_NAME);
  assert.deepEqual(readUsdcJournal(p), [], "a journal that does not exist yet is an empty one, not an error");

  appendUsdcJournal(p, [{ kind: "seen", receipt_ref: "usdc:base:0xaa" }]);
  appendUsdcJournal(p, []);   // a tick with nothing new writes nothing
  appendUsdcJournal(p, [{ kind: "witnessed", ref: "usdc:base:0xaa" }]);
  assert.deepEqual(readUsdcJournal(p).map((r) => r.kind), ["seen", "witnessed"], "append-only, in order, across ticks");

  writeFileSync(p, readFileSync(p, "utf8") + "{not json\n");
  const rows = readUsdcJournal(p);
  assert.equal(rows.length, 3);
  assert.match(rows[2].malformed, /not json/, "a torn line is handed back as one, so it cannot take the tick down with it");
});

test("F11 · the CLI appends what the tick saw AFTER the tick and BEFORE the cursor moves", { skip: SKIP }, () => {
  // ── THE WEAKEST CASE IN THIS FILE, DELIBERATELY ─────────────────────────
  // `main()` cannot be driven here: the CLI's only chain is `baseRpc`, whose
  // three endpoints are hardcoded in src/usdc-witness.mjs with no injection
  // point, and this lane does not reach the live chain. So the wiring is pinned
  // as SOURCE TEXT. What that proves: the three statements are in this order in
  // the file today, and a later hand that reorders them reddens this line.
  // What it does NOT prove: that the order behaves. What DOES prove the
  // behaviour is F8 (the tick throws before returning anything, so neither of
  // the two statements below can have run) plus F10 (the append and the read
  // are real file IO over a real file). Read the three together.
  const src = readFileSync(join(HERE, "..", "tools", "usdc-watch.mjs"), "utf8");
  const main = src.slice(src.indexOf("async function main()"));

  const tickAt = main.indexOf("await watch({");
  const readAt = main.indexOf("readUsdcJournal(journalPath)");
  const appendAt = main.indexOf("appendUsdcJournal(journalPath, seen");
  const stateAt = main.indexOf("writeState(statePath");
  for (const [name, i] of [["the tick", tickAt], ["the journal read", readAt], ["the append", appendAt], ["the state write", stateAt]])
    assert.ok(i > -1, `${name} is in main() at all`);

  assert.ok(readAt < tickAt, "the journal is read BEFORE the tick, because the tick decides from it");
  assert.ok(tickAt < appendAt, "nothing is appended until the tick has come back — a tick that throws appends nothing");
  assert.ok(appendAt < stateAt, "and the cursor moves LAST, so a crash between them costs a repeated read, never a forgotten arrival");
  assert.equal(main.indexOf("readUsdcJournal(journalPath)", readAt + 1), -1,
    "the journal is read exactly ONCE per tick: two reads of an append-only file inside one tick can disagree");
});
