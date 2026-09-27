// usdc-watch — the town's eye on its own intake address, and its rules.
//
// The /fund door is patron-driven: money moves on Base, and the town learns of
// it only when the patron comes back and pastes the hash. Until they do, the
// town is blind to its own money. This watch closes the SEEING half of that gap
// — it reads Base on a clock and reports every USDC arrival at the intake
// address, whether or not anyone has claimed it.
//
// ── WHAT CHANGED, 2026-08-25: SEEING BECAME RESOLVING ───────────────────────
//
// The argument below (why a watcher may not simply witness what it sees) is
// unchanged and still governs. What changed is that its two premises are now
// FALSIFIABLE PER ARRIVAL instead of true by default, so the arrivals for which
// neither holds resolve by rule and only the rest surface:
//
//   the pot   an ERC-20 transfer carries no memo, so a watcher choosing a pot
//             would be guessing at a stranger's intent with their money. It
//             still would — UNLESS the address itself names the pot.
//             deploy/intake-addresses.json is that map. Today it is empty of
//             pots on purpose: one intake address, two open pots behind it, so
//             every arrival is pot-ambiguous and stays so. When the founder
//             mints a per-pot address, the chain names the pot and the guess
//             disappears rather than being made.
//
//   the hand  witnessing under a placeholder payer permanently destroys the
//             real patron's holo, because "ref is unique forever: one dollar,
//             one mint chance, a re-recorded receipt bounces" and the ledger
//             has no row kind that attaches, corrects, or reassigns a payer.
//             That is still exactly true of an UNKNOWN payer. It is NOT true of
//             a REGISTERED one: the OFFICE-SIDE registry (src/wallet-registry.mjs,
//             box-side and never in the town repo — founder-ruled 2026-08-25)
//             says whose address this is, so the claim the watch "front-runs"
//             would have named the same hand. There is no holo to lose.
//
// Both must hold for one arrival before it is witnessed, and it waits MIN_CONF
// deep AND one full crossing besides. test/usdc-watch.test.mjs still proves the
// theft against the town's own CLI for the placeholder case, because that case
// is still forbidden.
//
// THE ONE LIBERTY AUTO-WITNESS TAKES, named rather than buried: the /fund door
// lets a resident witness a payment under ANY handle they choose — a household
// may fund on someone else's behalf. Auto-witness files it under the wallet's
// own household. The crossing-long grace is what makes that safe to live with:
// a resident who wants a different attribution has a full crossing to use the
// door first, and their paste wins outright, because the door consumes the ref
// and the next tick reads it back as already witnessed.
//
// AND THE ASYMMETRY WITH THE CARD RAIL, which is deliberate. tools/stripe-watch.mjs
// witnesses an unattributable card payment as an outside gift (`outside:stripe`)
// because that rail has no payer paste-path to front-run — the fund page says so
// in its own words: "Step 2 — there isn't one". Base HAS one. So an arrival from
// an unregistered address is NEVER witnessed as a gift here, however clearly the
// address names its pot: doing so would spend the ref of a patron who is about
// to paste. It stays unclaimed, and the sink rule below is the eventual answer.
//
// ── THE SINK RULE (PROPOSED — NOT ENABLED) ──────────────────────────────────
//
// An unclaimed arrival from an unregistered address, older than SINK_AGE_DAYS,
// would witness as an outside gift to the DARKO fund — the donation box is the
// natural home for money nobody claimed, and its own file says "Nothing is ever
// refused at intake." This is IMPLEMENTED AND OFF. It runs only when the
// environment sets USDC_SINK_UNCLAIMED=1, which is the founder's flip and
// nobody else's. Every report lists what the rule WOULD take and states that it
// is off, so the decision is made on real numbers rather than in the abstract.
//
// WHAT IT REPORTS, per run:
//   witnessed   — arrivals whose ref is already a pot-receipt in the ledger.
//   witness     — arrivals resolved fully by rule and recorded this tick.
//   hold        — resolved, but not yet a crossing old; carries the plan.
//   needs_pot   — a registered payer at an address that names no single pot.
//   over_cap    — resolved, but past the pot's posted target (D5).
//   unclaimed   — real money nobody has attached to a hand. The operator's queue.
//   sink        — what the (disabled) sink rule would take, and that it is off.
//   dust        — arrivals under $1, carrying the door's own sentence.
//
// THE CURSOR is a block number, and it only ever advances over blocks that are
// MIN_CONF deep — the same depth the door demands ("confirmations >= MIN_CONF;
// finality is a claim about depth, not existence"). A run that cannot reach Base
// exits loud, reports nothing, and leaves the cursor exactly where it was, so
// the next run re-reads the same range rather than stepping over it.
//
// ── THE CURSOR FINDS; THE JOURNAL REMEMBERS (postmark#2978, POS-134) ────────
//
// The cursor is for finding NEW blocks. It is not, and never was, a memory of
// what is still undecided: it advances to the deepest block a tick could safely
// read, so an arrival inside its twelve-hour grace was held on one tick and
// stood behind the cursor ten minutes later, on the next one — every time, not
// occasionally. `usdc-intake.jsonl` beside the state file is the memory. Every
// tick decides the new scan UNION every journalled arrival the town has not yet
// resolved, whatever the cursor says. Nothing here moves money either way; what
// the orphaning cost was the arrival's place on `arrivals.json`, which is the
// operator's Base queue, and it is why SINK_AGE_DAYS could never come due on an
// ordinary tick. See `unresolvedSeen` below and
// test/usdc-watch-held-behind-cursor.test.mjs for the proof.
//
// Usage: node tools/usdc-watch.mjs [--state <state.json>] [--out <report.json>]
//                                  [--journal <usdc-intake.jsonl>]
//                                  [--clone <town-clone>] [--from <block>]
//                                  [--dry-run] [--json]

import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { baseRpc, INTAKE, USDC, TRANSFER_TOPIC, MIN_CONF } from "../src/usdc-witness.mjs";
import { readWalletRegistry, handleForAddress } from "../src/wallet-registry.mjs";
import { CROSSING_MS } from "../src/crossings.mjs";
import { fundGuards, penRecorder } from "../src/fund.mjs";
import { readIntakeMap, intakeAddresses } from "../src/intake-map.mjs";
import { readJournal as readUsdcJournal, appendJournal as appendUsdcJournal } from "./stripe-watch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// Public Base RPCs cap an eth_getLogs range; 800 blocks is well inside every
// one of the three the witness falls back across, and Base's ~2s blocks make
// that ~27 minutes of chain per call — comfortably more than the 10-minute
// timer needs on an ordinary run.
export const MAX_SPAN = 800;
// A cold start (or a box that was down) should catch up, not stampede: one run
// reads at most ~24h of chain and leaves the rest for the next tick.
export const MAX_CATCHUP = 43_200;
// "a payment under $1 cannot be witnessed as a receipt" — the door's own floor,
// quoted rather than re-derived, because the watch must call dust exactly what
// the door would have called it.
export const MIN_USD = 1;
export const UNDER_A_DOLLAR =
  "the ledger records whole dollars, so a payment under $1 cannot be witnessed as a receipt. It reached the town and it is not lost — write to the postmaster.";
export const RAIL = "usdc";
// The same spelling law as the card rail's: a handle is `[a-z0-9-]` only, so a
// colon makes this string unmintable as a name and an unattached gift is legible
// by shape with no list to consult.
export const OUTSIDE_FROM = "outside:usdc";

// ── WHERE THIS RAIL'S STATE LIVES, owned HERE (postmark#2972) ───────────────
//
// The sibling of the card rail's twin, and named by the same issue. On
// 2026-09-19 the funding report printed "usdc-watch · never · ⚠ has never run"
// while `systemctl list-timers` showed the timer at 13:50:17Z that day: the
// report carried its own default of <office>/.usdc-watch-state.json and the
// unit writes /srv/postmark-usdc/state.json. Two files answering "when did this
// rail last tick" is one file too many, and the one the report chose was the
// one nobody writes.
//
// ONE OWNER, AND IT IS THE FILE THAT WRITES THE STATE — the CLI default below
// is this same constant, so the tool and the constant cannot disagree, and
// deploy/postmark-usdc-watch.service's `--state` is now agreement rather than
// instruction. Off the box the path does not exist and `readState` answers {},
// which is the honest answer: off the box there is no live tick.
export const STATE_PATH = "/srv/postmark-usdc/state.json";
// The arrivals report has always been written beside the state — `--out` in the
// same unit line — so the report derives it from here rather than typing a
// fourth literal.
export const REPORT_NAME = "arrivals.json";
// The journal lives beside the state too, derived rather than typed — the same
// place and the same idiom as the card rail's `stripe-intake.jsonl`.
export const USDC_JOURNAL_NAME = "usdc-intake.jsonl";
export const USDC_JOURNAL_PATH = join(dirname(STATE_PATH), USDC_JOURNAL_NAME);

// ── the journal: the same two functions the card rail already owns ──────────
//
// `readJournal`/`appendJournal` in tools/stripe-watch.mjs are JSONL file IO and
// nothing else — a path in, rows out, a torn line surfaced as `{malformed}`.
// They carry no Stripe field and no rail rule, so a third copy here would be a
// third thing to keep in step for no gain. Imported and re-exported under this
// rail's own names, the way this file already re-exports readIntakeMap: one
// function, two callers, one answer. `tools/stripe-watch.mjs` is not modified.
export { readUsdcJournal, appendUsdcJournal };

// ── the sink rule: implemented, and OFF ─────────────────────────────────────
export const SINK_FLAG = "USDC_SINK_UNCLAIMED";
export const SINK_POT = "darko-fund";
export const SINK_AGE_DAYS = 7;
export const SINK_RULE =
  `an unclaimed arrival from an unregistered address, older than ${SINK_AGE_DAYS} days, is witnessed as an outside gift to the ${SINK_POT} pot — the donation box is the natural home for money nobody claimed. PROPOSED, NOT ENABLED: it runs only when ${SINK_FLAG}=1 is set on the unit, which is the founder's flip.`;
/** OFF unless the environment says otherwise, and the default is the law. */
export const sinkEnabled = (env = process.env) => env[SINK_FLAG] === "1";

const pad32 = (addr) => "0x" + "0".repeat(24) + String(addr).replace(/^0x/, "").toLowerCase();
const hexOf = (n) => "0x" + BigInt(n).toString(16);
const lower = (a) => String(a).toLowerCase();

// ── which pot an address names ─────────────────────────────────────
//
// MOVED to src/intake-map.mjs, 2026-08-25, and re-exported here so every
// existing caller and falsifier reads exactly as it did. The map was born in
// this file because the watch was the only thing that needed it; the /fund door
// needs it too now — to accept a payment at a pot's own address and to publish
// that address in the pot's money moment — and a door and a watch that each
// parse the same file are two things that can disagree about where a stranger's
// money went. One function, two callers, one answer.
export { INTAKE_MAP_FILE, readIntakeMap, intakeAddresses } from "../src/intake-map.mjs";

/**
 * One USDC Transfer log to an intake address, read the way the witness reads
 * it — same topic layout, same 6 decimals, same lowercase spelling — so a ref
 * derived here is character-identical to the ref the door mints.
 */
export function decodeArrival(log) {
  const txhash = String(log.transactionHash).toLowerCase();
  return {
    txhash,
    block: Number(log.blockNumber),
    from_address: "0x" + String(log.topics[1]).slice(-40),
    // WHICH intake address it landed on — the only thing on an ERC-20 transfer
    // that can ever name a pot. Read off the recipient topic rather than
    // remembered from the filter, so a multi-address scan cannot mislabel one.
    to_address: "0x" + String(log.topics[2] ?? "").slice(-40),
    usd: Number(BigInt(log.data)) / 1e6,
    // the SAME string usdc-witness.mjs builds — see its ref-normalisation note
    receipt_ref: `usdc:base:${txhash}`,
  };
}

/**
 * Every USDC Transfer to `intake` in [from, to], read in MAX_SPAN chunks.
 *
 * The filter is the token contract AND the Transfer topic AND the recipient
 * slot, which is the same triple the witness checks a receipt's logs for. A
 * wrong-token transfer never matches `address`; a transfer to somebody else
 * never matches topic[2]; a non-transfer never matches topic[0]. The chain does
 * the refusing, so nothing irrelevant is ever decoded.
 *
 * `intake` may be one address or several. Several go in the recipient slot as
 * an array, which is that slot's own OR — one request, not one per address, and
 * still no widening of what is asked for.
 */
export async function scanRange({ rpc = baseRpc, intake = INTAKE, usdcToken = USDC, from, to, maxSpan = MAX_SPAN }) {
  const out = [];
  const recipients = Array.isArray(intake) ? intake.map(pad32) : pad32(intake);
  for (let lo = BigInt(from); lo <= BigInt(to); lo += BigInt(maxSpan)) {
    const hi = (lo + BigInt(maxSpan) - 1n) > BigInt(to) ? BigInt(to) : lo + BigInt(maxSpan) - 1n;
    const logs = await rpc("eth_getLogs", [{
      address: usdcToken,
      topics: [TRANSFER_TOPIC, null, recipients],
      fromBlock: hexOf(lo),
      toBlock: hexOf(hi),
    }]);
    for (const l of logs ?? []) out.push(decodeArrival(l));
  }
  // ledger order is block order; ties broken by hash so a re-run of the same
  // range reports the same sequence on any machine
  out.sort((a, b) => a.block - b.block || a.txhash.localeCompare(b.txhash));
  return out;
}

/**
 * When each of these blocks was mined, best effort.
 *
 * SWALLOWING THE ERROR IS THE CONSERVATIVE DIRECTION and that is the whole
 * reason it is allowed here: an arrival whose age is unknown can never be
 * witnessed (the grace cannot be shown to have passed) and can never be swept
 * by the sink (the age cannot be shown to have passed). An unreadable timestamp
 * therefore costs the town a resolution, never a wrong one. Contrast the head
 * read in `watch`, which throws — being blind about WHETHER there was money is
 * a lie, being blind about WHEN is a delay.
 */
export async function blockTimes({ rpc, blocks }) {
  const out = new Map();
  for (const b of new Set(blocks)) {
    try {
      const blk = await rpc("eth_getBlockByNumber", [hexOf(b), false]);
      const ts = blk?.timestamp == null ? null : Number(BigInt(blk.timestamp)) * 1000;
      out.set(b, Number.isFinite(ts) ? ts : null);
    } catch { out.set(b, null); }
  }
  return out;
}

/**
 * Split what the chain showed against what the ledger already holds.
 *
 * `engine` is the town's own stamp-mint module — foldPotReceipts is the single
 * copy of "which refs are already receipts", exactly as fund.mjs uses it. A
 * hand-rolled scan of the ledger text here would be a second copy of the rule,
 * and the one that drifts is the one nobody rereads.
 */
export function reconcile({ arrivals, entries, engine, minUsd = MIN_USD }) {
  const { receipts } = engine.foldPotReceipts(entries);
  const byRef = new Map(receipts.map((r) => [String(r.ref).toLowerCase(), r]));

  const witnessed = [], unclaimed = [], dust = [];
  for (const a of arrivals) {
    const prior = byRef.get(a.receipt_ref);
    if (prior) { witnessed.push({ ...a, pot: prior.pot, from: prior.from, date: prior.date, usd_recorded: prior.usd }); continue; }
    if (a.usd < minUsd) { dust.push({ ...a, why: UNDER_A_DOLLAR }); continue; }
    unclaimed.push(a);
  }
  return { witnessed, unclaimed, dust };
}

export const NEEDS_POT_LETTER = (a, handle) =>
  `Your $${Math.floor(a.usd)} reached the town on ${a.txhash} and we can see it is yours — but the town has one intake address serving more than one pot, so the chain cannot tell us WHICH need you meant to fund. Reply with the pot (or witness it yourself from that pot's own /fund/ page) and it files immediately; nothing is lost while it waits.`;

export const UNREGISTERED =
  "no household has registered this address with the office, so the town cannot say whose dollar this is. Witnessing it under a placeholder would spend the ref's one mint chance and cost the real patron their holo forever — this arrival waits for their paste, or for the sink rule.";

/**
 * The rule, applied to what the ledger has not already claimed. Pure: no
 * network, no writes, no clock of its own.
 *
 * Arrivals must already carry `ts` (block time in ms) where it is known;
 * `ts == null` means the age is unknown, which can only hold an arrival back.
 */
export function resolveArrivals({
  arrivals, entries, engine, clone, potFor, handleFor,
  now = Date.now(), graceMs = CROSSING_MS, sink = false, sinkAgeDays = SINK_AGE_DAYS,
}) {
  const witness = [], hold = [], needs_pot = [], over_cap = [], unclaimed = [], sinkable = [];
  const sinkAgeMs = sinkAgeDays * 86_400_000;

  for (const a of arrivals) {
    const handle = handleFor(a.from_address);
    const whole = Math.floor(a.usd);
    const cents = Number((a.usd - whole).toFixed(6));

    if (!handle) {
      const age = a.ts == null ? null : now - a.ts;
      const old = age != null && age >= sinkAgeMs;
      const row = { ...a, why: UNREGISTERED, age_days: age == null ? null : Math.floor(age / 86_400_000) };
      if (!old) { unclaimed.push(row); continue; }
      // Old enough for the sink. Whether it MOVES is the flag's business.
      if (!sink) { sinkable.push({ ...row, sink_would: `witness as an outside gift (${OUTSIDE_FROM}) to pot ${SINK_POT}`, sink_rule: SINK_RULE, sink_enabled: false }); unclaimed.push(row); continue; }
      const g = fundGuards({ engine, entries, clone, pot: SINK_POT, handle: OUTSIDE_FROM, usd: whole, receiptRef: a.receipt_ref });
      if (!g.ok) { over_cap.push({ ...a, pot: SINK_POT, from: OUTSIDE_FROM, usd: whole, why: g.defect, hint: g.hint ?? null }); continue; }
      witness.push({ ...a, pot: SINK_POT, from: OUTSIDE_FROM, usd: whole, rail: RAIL, ref: a.receipt_ref, attributed: false, via: "the sink rule" });
      continue;
    }

    const pot = potFor(a.to_address);
    if (!pot) { needs_pot.push({ ...a, handle, why: `the address ${a.to_address} serves more than one open pot, so the chain does not name one`, letter: NEEDS_POT_LETTER(a, handle) }); continue; }

    const g = fundGuards({ engine, entries, clone, pot, handle, usd: whole, receiptRef: a.receipt_ref });
    if (!g.ok) { over_cap.push({ ...a, pot, from: handle, usd: whole, why: g.defect, hint: g.hint ?? null }); continue; }

    const plan = {
      pot, from: handle, usd: whole, rail: RAIL, ref: a.receipt_ref, attributed: true,
      ...(cents > 0 ? { cents_note: `$${a.usd} arrived; the ledger records whole dollars, so $${whole} is witnessed and the remaining $${cents.toFixed(2)} is money the town holds that priced nothing.` } : {}),
    };
    // Unknown age holds, never witnesses: the grace cannot be shown to have run.
    if (a.ts == null) { hold.push({ ...a, plan, witnesses_after: null, why: "the block's timestamp could not be read, so the grace window cannot be shown to have passed" }); continue; }
    const witnessAt = a.ts + graceMs;
    if (now < witnessAt) { hold.push({ ...a, plan, witnesses_after: new Date(witnessAt).toISOString() }); continue; }
    witness.push({ ...a, ...plan });
  }

  return { witness, hold, needs_pot, over_cap, unclaimed, sink: sinkable };
}

/** The town's ledger entries, through the town's own parser. */
export function ledgerEntries(clone, engine) {
  const p = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  return existsSync(p) ? engine.parseStampLedger(readFileSync(p, "utf8")) : [];
}

export async function townEngine(clone) {
  const mint = join(clone, "tools", "stamp-mint.mjs");
  if (!existsSync(mint)) return null;
  const m = await import(pathToFileURL(mint));
  return typeof m.foldPotReceipts === "function" && typeof m.parseStampLedger === "function" ? m : null;
}

export const readState = (p) => {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
};

export function writeState(p, state) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + "\n");
}

/**
 * The shape EVERY report has, including the quiet one. One shape means one
 * reader; the posture is said on every report and not only when there is
 * something unclaimed, because the boundary is the design.
 */
function emptyReport({ now, intake, minConf, graceMs, sink }) {
  return {
    generated_at: new Date(now).toISOString(),
    intake: Array.isArray(intake) ? intake : [intake],
    head: null,
    safe_head: null,
    min_confirmations: minConf,
    scanned: null,
    arrivals: 0,
    // What the JOURNAL contributed, on its own line and never folded into
    // `arrivals` — that number is what the chain returned, and inflating it
    // would make the tick's own headline read as a scan that never happened.
    rechecked: 0,
    witnessed: [], dust: [], witness: [], hold: [], needs_pot: [], over_cap: [], unclaimed: [], sink: [],
    sink_enabled: sink,
    sink_rule: SINK_RULE,
    grace: `one crossing (${graceMs / 3_600_000}h) after the block was mined`,
    posture: "this watch records exactly one thing: an arrival from an address a household has REGISTERED, at an address that names a single pot, MIN_CONF deep and a crossing old. Everything else it reads and reports only. The chain cannot say which pot an unmapped address meant, and a receipt recorded under a placeholder would consume that hash's one mint chance and cost the patron their holo forever. The cursor finds new blocks; the journal's seen-and-unresolved arrivals are decided again every tick whatever the cursor says, so an arrival inside its grace cannot be orphaned behind it.",
  };
}

/**
 * A journal row's identity, which is the ref the LEDGER dedupes on.
 *
 * A `seen` row is a whole decoded arrival, so it spells it `receipt_ref`; a
 * `witnessed`/`refused` row is written by `main()` from a plan, so it spells
 * the same string `ref`. Two names for one key is the sort of thing that reads
 * as working and silently remembers nothing, so it is resolved in one place.
 */
export const journalRef = (r) => r?.receipt_ref ?? r?.ref ?? null;

/**
 * THE ROWS THE CURSOR FORGOT — every arrival the journal remembers as SEEN and
 * has never recorded as WITNESSED.
 *
 * ── WHY THIS EXISTS (postmark#2978, POS-134) ───────────────────────────────
 *
 * The exact sibling of the card rail's #2973, and the Base rail had it worse.
 * `watch()` scans `from = cursor + 1` and the cursor moves to the deepest block
 * this tick could safely read — so an arrival inside its twelve-hour grace is
 * held on tick 1 and is BEHIND the cursor ten minutes later, on tick 2, every
 * time. Not "when a newer row shares a listing": always. A two-tick probe
 * (docs/2026-09-19/pos-2973/usdc-orphan-probe.mjs) reads
 * `hold: 1` then `hold: 0` over the same untouched arrival.
 *
 * THE CURSOR IS FOR FINDING NEW BLOCKS. THE JOURNAL IS FOR REMEMBERING HELD
 * ARRIVALS. Nothing here moves money: this rail only ever SEES, and what the
 * orphaning cost was the arrival's place on `arrivals.json` — which is the
 * operator's Base queue in `tools/funding-report.mjs`, and the only way
 * `SINK_AGE_DAYS` could ever come due on an ordinary tick.
 *
 * A `refused` row STAYS in the set, exactly as on the card rail, and for the
 * reason `main()` already writes down in those words: the ref is unspent, so
 * the next tick tries again. A `witnessed` row drops OUT — the ledger would
 * bounce a second write regardless, and the watcher must not even try.
 *
 * Pure, and takes raw journal rows so a torn line costs nothing.
 */
export function unresolvedSeen(rows) {
  const seen = new Map();
  const witnessed = new Set();
  for (const r of rows ?? []) {
    const ref = journalRef(r);
    if (!ref) continue;
    if (r.kind === "seen") { if (!seen.has(ref)) seen.set(ref, r); }
    else if (r.kind === "witnessed") witnessed.add(ref);
  }
  for (const ref of witnessed) seen.delete(ref);
  return [...seen.values()];
}

/**
 * One tick.
 *
 * Returns { report, cursor, todo, seen } and NEVER writes: the caller persists
 * and records, so a falsifier can run the whole tick and prove the cursor did
 * not move and the ledger did not grow. Throws when the chain is unreadable —
 * loudly, because a silent empty report from a blind watcher is
 * indistinguishable from a quiet day, and the second one is a lie.
 *
 * TWO READS, ONE DECISION. `journal` is `unresolvedSeen(...)` — the arrivals
 * the cursor has left behind. THE LIVE SCAN WINS where both carry the same ref:
 * a confirmed block's contents never change, but the decode this tick actually
 * read is the one that is not a copy. A remembered row's `ts` is kept (a
 * block's timestamp is immutable, so re-reading it is a call for nothing) and a
 * remembered `ts: null` is retried, because that null was an RPC that failed,
 * not a fact about the block.
 *
 * THE CURSOR IS STILL COMPUTED FROM THE SCAN ALONE, deliberately: it means
 * "which blocks this town has read", and this is a fix TO a cursor bug, so it
 * must not quietly also be a change to what the cursor means.
 *
 * `seen` is the rows to journal, shaped and ordered; the CALLER owns the dedupe
 * against the file, because the file is what it read and this function did not.
 */
export async function watch({
  rpc = baseRpc,
  intake = INTAKE,
  usdcToken = USDC,
  entries,
  engine,
  clone = null,
  cursor = null,
  minConf = MIN_CONF,
  minUsd = MIN_USD,
  maxSpan = MAX_SPAN,
  maxCatchup = MAX_CATCHUP,
  potMap = new Map(),
  wallets = new Map(),
  now = Date.now(),
  graceMs = CROSSING_MS,
  sink = false,
  journal = [],
} = {}) {
  let head;
  try {
    head = Number(BigInt(await rpc("eth_blockNumber", [])));
  } catch (e) {
    // the cursor is the caller's and it is untouched: this throws before any of
    // it is computed, so a chain the town cannot reach costs it nothing but a tick
    throw new Error(`the town cannot reach Base right now (${String(e.message ?? e).slice(0, 160)}) — nothing was read, and the cursor has not moved`);
  }

  // Only blocks buried at least minConf deep are ever crossed. The door refuses
  // a shallower witness ("depth is part of the witness"), so a watch that
  // reported shallower arrivals would be reporting money the door would refuse.
  const safeHead = head - minConf;
  const from = cursor == null ? Math.max(0, safeHead - maxSpan + 1) : cursor + 1;

  // nothing has settled since the last tick — not an error, and not a reason
  // to move the cursor forward over blocks that were never read.
  const quiet = safeHead < from;

  if (quiet && journal.length === 0) {
    // It carries the SAME KEYS as a full report, deliberately: the quiet branch
    // used to drop `intake`, `generated_at` and the posture, so the CLI's very
    // first line (`report.intake.join`) threw on the commonest tick there is —
    // an empty ten minutes. A degraded shape is a second shape, and every
    // reader of the first one has to learn about it the hard way.
    //
    // A QUIET TICK STILL OWES THE JOURNAL ITS DECISION, which is why this
    // return is now conditional on there being nothing to decide. Returning an
    // empty report over a journal with rows in it would write `arrivals.json`
    // with nothing on it and drop every remembered arrival — the exact failure
    // this journal exists to end, reached through the quietest branch there is,
    // where nobody would think to look for it. With an empty journal the path
    // below is unchanged, and so is every caller that never passes one.
    return { report: { ...emptyReport({ now, intake, minConf, graceMs, sink }), head, safe_head: safeHead }, cursor, todo: [], seen: [] };
  }

  const to = quiet ? cursor : Math.min(safeHead, from + maxCatchup - 1);
  const arrivals = quiet ? [] : await scanRange({ rpc, intake, usdcToken, from, to, maxSpan });

  // THE SECOND READ. Everything the journal remembers that this scan did not
  // return — the live decode wins on a collision, so a remembered snapshot can
  // never shadow a block the town just read.
  const scanned = new Set(arrivals.map((a) => a.receipt_ref));
  const remembered = [];
  for (const row of journal) {
    const ref = journalRef(row);
    if (!ref || scanned.has(ref)) continue;
    // `kind` and `at` are the JOURNAL's fields, not the arrival's, and every
    // bucket below spreads whatever it is handed into the row an operator
    // reads. Strip them so a re-decided arrival is shaped like a freshly
    // decoded one and no reader has to learn a second shape.
    const { kind: _kind, at: _at, ...arrival } = row;
    remembered.push(arrival);
  }
  const rechecked = remembered.length;

  const all = [...arrivals, ...remembered]
    .sort((a, b) => a.block - b.block || String(a.txhash).localeCompare(String(b.txhash)));
  const split = reconcile({ arrivals: all, entries, engine, minUsd });

  // Ages, best effort, only for what the ledger has not already claimed — and
  // only for the ones whose age this tick does not already hold.
  const needTimes = split.unclaimed.filter((a) => a.ts == null);
  const times = needTimes.length ? await blockTimes({ rpc, blocks: needTimes.map((a) => a.block) }) : new Map();
  const aged = split.unclaimed.map((a) => (a.ts == null ? { ...a, ts: times.get(a.block) ?? null } : a));

  const rules = resolveArrivals({
    arrivals: aged, entries, engine, clone,
    potFor: (addr) => potMap.get(lower(addr)) ?? null,
    handleFor: (addr) => handleForAddress(wallets, addr),
    now, graceMs, sink,
  });

  const generated_at = new Date(now).toISOString();
  return {
    report: {
      ...emptyReport({ now, intake, minConf, graceMs, sink }),
      head,
      safe_head: safeHead,
      scanned: quiet ? null : { from, to },
      arrivals: arrivals.length,
      rechecked,
      witnessed: split.witnessed,
      dust: split.dust,
      ...rules,
    },
    cursor: to,
    todo: rules.witness,
    // Every arrival this tick decided by rule — the ones whose answer the town
    // can still change, which is exactly the set that can be orphaned. A dust
    // row and a row already on the ledger are left out on purpose: a confirmed
    // transfer's amount and its ref are immutable, so neither can ever become
    // something else, and remembering them would grow the file and the report
    // forever with rows that have no next answer.
    seen: aged.map((a) => ({ kind: "seen", at: generated_at, ...a })),
  };
}

// ── the CLI ─────────────────────────────────────────────────────────────────

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
}

async function main() {
  const clone = arg("clone", process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone"));
  const statePath = arg("state", STATE_PATH);
  // Derived from whatever `--state` says, the way the card rail's is, so the
  // journal cannot end up in a different directory from the cursor it belongs to.
  const journalPath = arg("journal", join(dirname(statePath), USDC_JOURNAL_NAME));
  const outPath = arg("out", null);
  const dryRun = process.argv.includes("--dry-run");

  const engine = await townEngine(clone);
  if (!engine) {
    console.error(`FATAL: no town clone with the funding seam at ${clone} — the watch reads the ledger through the town's own fold, never its own parse`);
    process.exit(1);
  }

  const state = readState(statePath);
  const from = arg("from", null);
  const cursor = from != null ? Number(from) - 1 : (state.cursor ?? null);

  const { map: potMap, invalid: mapInvalid } = readIntakeMap();
  const households = typeof engine.householdKeys === "function" ? engine.householdKeys(clone) : null;
  const { byAddress: wallets, invalid: walletInvalid, path: registryPath, present: registryPresent } = readWalletRegistry(undefined, { households });

  // THE SECOND READ, taken ONCE here and used twice: to re-decide the arrivals
  // the cursor has left behind, and immediately below to decide which of this
  // tick's arrivals are new enough to journal. One read, because two reads of
  // an append-only file inside one tick can disagree, and a dedupe set that
  // disagrees with the re-decide set writes the same arrival down twice.
  const journalRows = readUsdcJournal(journalPath);
  const { report, cursor: next, todo, seen } = await watch({
    entries: ledgerEntries(clone, engine),
    engine,
    clone,
    cursor,
    intake: intakeAddresses(potMap),
    potMap,
    wallets,
    sink: sinkEnabled(),
    journal: unresolvedSeen(journalRows),
  });
  report.registry = { path: registryPath, present: registryPresent, addresses: wallets.size, mapped_pots: potMap.size };
  report.invalid = [...mapInvalid, ...walletInvalid];
  report.journal = journalPath;

  // THE TICK SUCCEEDED, so what it saw is written down — after the tick and
  // BEFORE the cursor moves. A tick that threw never reached this line, so it
  // appends nothing and moves nothing, which is the same rule the cursor has
  // always had ("nothing was read, and the cursor has not moved") applied to
  // the thing that now remembers for it. A `--dry-run` still journals: seeing
  // is not recording, and the card rail draws the line in the same place.
  const known = new Set(journalRows.filter((r) => r.kind === "seen").map(journalRef));
  appendUsdcJournal(journalPath, seen.filter((r) => !known.has(journalRef(r))));

  const written = [];
  if (!dryRun && todo.length) {
    const { execUnderTownLock, lockTimedOut, LOCK_BUSY } = await import("../src/town-lock.mjs");
    const { townDay } = await import("../src/ops.mjs");
    const record = penRecorder(clone, {
      execUnderTownLock, lockTimedOut, LOCK_BUSY, townDay,
      execPath: join(HERE, "..", "src", "fund-exec.mjs"),
      rail: RAIL, via: "usdc-watch",
    });
    for (const w of todo) {
      try {
        const out = await record({ pot: w.pot, usd: w.usd, from: w.from, ref: w.ref });
        written.push({ kind: "witnessed", at: new Date().toISOString(), txhash: w.txhash, ref: w.ref, pot: w.pot, from: w.from, usd: w.usd, line: out?.line ?? null, commit: out?.commit ?? null });
      } catch (e) {
        // A refusal is an answer, not a crash: report it and keep going. The ref
        // is unspent, so the next tick tries again.
        written.push({ kind: "refused", at: new Date().toISOString(), txhash: w.txhash, ref: w.ref, pot: w.pot, from: w.from, usd: w.usd, code: e?.code ?? null, defect: e?.defect ?? String(e?.message ?? e).slice(0, 200) });
      }
    }
    // Journalled for the same reason the card rail journals its outcomes: a
    // `witnessed` row is what retires an arrival from the remembered set, and a
    // `refused` row deliberately does NOT — its ref is unspent, so the next
    // tick tries again, which is what the catch above already says in words.
    appendUsdcJournal(journalPath, written);
  }
  report.written = written;

  writeState(statePath, { ...state, cursor: next, last_run: new Date().toISOString(), last_head: report.head });
  if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n"); }

  if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 2)); return; }

  const { witnessed, unclaimed, dust, hold, needs_pot, over_cap, scanned } = report;
  console.log(`usdc-watch · intake ${report.intake.join(", ")}`);
  console.log(scanned ? `blocks ${scanned.from}–${scanned.to} (head ${report.head}, ${report.min_confirmations} deep)` : `nothing settled since the last tick (head ${report.head})`);
  // Printed only when there were any, and named as a SECOND read rather than
  // folded into the line above — that line is about which blocks were read, and
  // an operator who cannot tell the two reads apart cannot tell a quiet chain
  // from a cursor that has run away from an arrival still inside its grace.
  if (report.rechecked) console.log(`  plus ${report.rechecked} seen-and-unresolved arrival(s) decided again from the journal, behind the cursor`);
  console.log(`  registry: ${report.registry.present ? `${report.registry.addresses} address(es)` : "ABSENT"} at ${report.registry.path}; ${report.registry.mapped_pots} pot address(es) mapped`);
  console.log(`  witnessed: ${witnessed.length}   recorded now: ${written.filter((w) => w.kind === "witnessed").length}   holding: ${hold.length}   needs-pot: ${needs_pot.length}   over-cap: ${over_cap.length}   unclaimed: ${unclaimed.length}   under $1: ${dust.length}`);
  for (const h of hold)
    console.log(`  HOLD       $${h.plan.usd}  ${h.txhash}  → ${h.plan.pot} as ${h.plan.from}${h.witnesses_after ? `  after ${h.witnesses_after}` : `  (${h.why})`}`);
  for (const n of needs_pot)
    console.log(`  NEEDS-POT  $${n.usd}  ${n.txhash}  from ${n.handle} — ${n.why}\n             letter: ${n.letter}`);
  for (const o of over_cap)
    console.log(`  OVER-CAP   $${o.usd}  ${o.txhash}  → ${o.pot} — ${o.why}`);
  for (const u of unclaimed)
    console.log(`  UNCLAIMED  $${u.usd}  ${u.txhash}  block ${u.block}  from ${u.from_address}${u.age_days == null ? "" : `  (${u.age_days}d old)`}`);
  if (report.sink.length)
    console.log(`  SINK (OFF, ${report.sink.length} eligible): ${SINK_RULE}`);
  for (const d of dust)
    console.log(`  under $1   $${d.usd}  ${d.txhash} — ${d.why}`);
  for (const w of written)
    console.log(`  ${w.kind === "witnessed" ? "RECORDED" : "REFUSED "}  $${w.usd} → ${w.pot} as ${w.from}${w.defect ? ` — ${w.defect}` : ""}`);
  for (const i of report.invalid)
    console.log(`  INVALID    ${i.line} — ${i.reason}`);
}

// ── entry guard ──────────────────────────────────────────────────────────────
// The junction lesson (2026-09-05, HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry path reaches this file through a Windows junction — the ESM loader
// realpaths the entry, argv[1] is not — so the tool exits 0 having done nothing.
// Compare real paths (world2/tools/await-clearing.mjs's idiom); the URL compare is
// only the fallback for an argv[1] that cannot be realpath'd. The office's
// test/cli-guard.test.mjs imports this file and spawns it through a junction.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  main().catch((e) => { console.error(`FATAL: ${e.message ?? e}`); process.exit(1); });
}
