// paypal-watch — the PayPal rail, closed at both ends by rule (POS-183 part 2).
//
// The third money rail, for givers whose banks balk at a foreign USD card
// charge from an unfamiliar US merchant: PayPal is where they already hold a
// balance. It is tools/stripe-watch.mjs's contract on a second rail, and that
// file's header is the argument. What holds here, checked rather than assumed:
//
// 1. THE ORDER SAYS WHICH POT. The town's own fund page creates the PayPal
//    order with `purchase_units[0].custom_id = "<pot>|<handle>"`. PayPal
//    carries it onto the capture and into Transaction Search as `custom_field`.
//    Nobody types the pot; the PAGE the giver stood on writes it. A payment
//    that carries no pot, or a pot the town does not hold open, is journalled
//    `needs-pot` for the founder's hand, never guessed at.
//
// 2. THE HAND IS TYPED, NEVER GUESSED. The handle after the `|` is the text the
//    giver typed in the same field the card path uses, trimmed. It resolves
//    through stripe-watch's own `resolveHand` (the exact-handle channel, then
//    the town's reviewed login pins), so one rule serves both rails. Anything
//    else is a gift under `outside:paypal`, which mints no holo.
//
// 3. THERE IS NO PAYER PASTE-PATH. `paypal:<transaction id>` is a ref only this
//    file mints, so there is no honest claim to front-run.
//
// ── THE WITNESS: TRANSACTION SEARCH, POLLED ─────────────────────────────────
//
// Measured on the sandbox app 2026-09-29 (G:/Starstory/docs/2026-09-29/rail/
// paypal/probe-witness.out): the capture webhook needs a public office
// endpoint and a subscription; Transaction Search (`GET /v1/reporting/
// transactions`) needs neither and matches this family's polling shape, but it
// answered 403 until the app's "Transaction search" feature is enabled (the
// founder's step). This reader is written to PayPal's documented response and
// proven against fixtures; its live-sandbox run waits on that feature.
//
// THE LAG. PayPal's own words: transactions "can take a maximum of three hours
// to appear" in search. So the cursor is NOT the newest transaction seen. It is
// the response's own `last_refreshed_datetime`: everything before it is in the
// index, and the next tick reads from there. A payment that appears late is
// therefore never behind the cursor. Re-reading the boundary is free, because
// the journal dedupes on transaction id and the ledger on ref.
//
// ── HOW ONE TRANSACTION RESOLVES ────────────────────────────────────────────
//
//   kind   a payment (event code T0006, PayPal Checkout; T0000–T0099, the
//          payment family) is decided. A reversal or refund (T11xx) is NEVER
//          dropped: it is the anomaly `refund`, naming the transaction it
//          reverses, for the founder's hand. The ledger has no row that
//          unwitnesses a dollar (stripe-watch § A REFUND AFTER THE FACT). Any
//          other code (fees, conversions, holds) is journalled as `not-a-gift`
//          and decides nothing.
//   paid   `transaction_status` S (success). P pending waits (`unpaid`, re-read
//          every tick); D denied, V reversed and F partially refunded are named.
//   usd    the transaction's own `transaction_amount`, which for an order the
//          page created in USD is USD. Anything else is `not-usd`, for the
//          founder: the town has no rate anywhere.
//   whole  whole dollars only; the cents are disclosed, as on the card rail.
//   pot    `custom_field` before the `|`, gated by the /fund door's own potGate.
//   cap    the /fund door's own fundGuards (D5), one copy of one rule.
//   when   one full crossing after the payment, as on the card rail: the grace
//          lets the operator round catch a mistyped handle before the one-shot
//          ref is spent.
//   again  the LEDGER decides: `foldPotReceipts` already holds `paypal:<id>`.
//
// SANDBOX MONEY. Sandbox transactions look exactly like live ones. The watcher
// knows which API it is reading (PAYPAL_ENV), and a sandbox transaction is the
// anomaly `testmode`, never a witness, unless the run is a --dry-run with
// --allow-sandbox (the lane's end-to-end proof, which writes nothing).
//
// Usage: node tools/paypal-watch.mjs [--state <state.json>] [--journal <j.jsonl>]
//                                    [--out <report.json>] [--clone <town-clone>]
//                                    [--since <ISO>] [--dry-run] [--allow-sandbox] [--json]
//                                    [--credentials <paypal-*.json>]
//
// Env: PAYPAL_CLIENT_ID, PAYPAL_SECRET  the app's REST credentials. On the box
//                   they live in /etc/postmark-paypal-watch.env (mode 600, the
//                   box convention); never committed. `--credentials <file>`
//                   reads the same pair from a { env, client_id, secret } file
//                   in-process, for a hand run; nothing from it is printed.
//      PAYPAL_ENV   live | sandbox. Required: a watcher that guessed which
//                   money it was reading would be guessing about the ledger.
//      PAYPAL_API   optional base URL, so the CLI can be driven end to end by a
//                   falsifier against a local server.
//      plus fund-exec's own: TOWN_CLONE, STAMP_KEY, TOWN_PUSH, BOT_NAME,
//                   BOT_EMAIL, TOWN_TZ, TOWN_LOCK.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { CROSSING_MS } from "../src/crossings.mjs";
import { fundGuards, penRecorder } from "../src/fund.mjs";
import { townLoginHands } from "../src/household-logins.mjs";
import { resolveHand, potGateOf, townEngine, ledgerEntries, readJournal, appendJournal, readState, writeState, MIN_USD } from "./stripe-watch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const PAYPAL_API = Object.freeze({ live: "https://api-m.paypal.com", sandbox: "https://api-m.sandbox.paypal.com" });
export const RAIL = "paypal";
export const OUTSIDE_FROM = "outside:paypal";
/** The separator the fund page writes between the pot and the typed handle in custom_id. */
export const CUSTOM_SEP = "|";
/** custom_id's own bound (PayPal: at most 127 characters). */
export const CUSTOM_MAX = 127;
export const COLDSTART_DAYS = 30;
/** Transaction Search answers at most 31 days per query; each window is cut to this. */
export const WINDOW_DAYS = 31;
export const PAGE_SIZE = 500;
export const MAX_PAGES = 50;
/** The lag PayPal states for Transaction Search: "a maximum of three hours". */
export const SEARCH_LAG_HOURS = 3;

export const STATE_PATH = "/srv/postmark-paypal/state.json";
export const JOURNAL_NAME = "paypal-intake.jsonl";
export const JOURNAL_PATH = join(dirname(STATE_PATH), JOURNAL_NAME);

// ── the custom_id the page writes, and reads back here ──────────────────────

/** The fund page's custom_id for a pot and a typed handle: `<pot>|<handle>`, bounded. Pure; the site writes the same. */
export function customIdFor(pot, handle) {
  const h = String(handle ?? "").trim();
  return `${pot}${CUSTOM_SEP}${h}`.slice(0, CUSTOM_MAX);
}

/** `{ pot, handle }` from a custom_field: the pot before the first `|`, the typed handle after it (empty is none). */
export function parseCustom(field) {
  if (field == null || String(field).trim() === "") return { pot: null, handle: null };
  const s = String(field);
  const i = s.indexOf(CUSTOM_SEP);
  const pot = (i === -1 ? s : s.slice(0, i)).trim() || null;
  const handle = i === -1 ? null : (s.slice(i + 1).trim() || null);
  return { pot, handle };
}

// ── the PayPal read ─────────────────────────────────────────────────────────
// Injected as `paypal` everywhere below, so a falsifier drives an account that
// does not exist.

export function paypalReader({ clientId, secret, api, fetchImpl = fetch, timeoutMs = 20_000 }) {
  if (!clientId || !secret) throw new Error("paypal-watch has no PAYPAL_CLIENT_ID / PAYPAL_SECRET — the app's REST pair is the whole credential, and there is no default");
  if (!api) throw new Error("paypal-watch has no API base — set PAYPAL_ENV to live or sandbox");
  let token = null;
  let tokenUntil = 0;
  const auth = async () => {
    if (token && Date.now() < tokenUntil) return token;
    const r = await fetchImpl(`${api}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.access_token) throw new Error(`PayPal refused the token (${r.status}): ${String(j?.error_description ?? j?.error ?? "").slice(0, 200)}`);
    token = j.access_token;
    tokenUntil = Date.now() + Math.max(0, Number(j.expires_in ?? 0) - 60) * 1000;
    return token;
  };
  return async (path, params = {}) => {
    const u = new URL(api + path);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
    const r = await fetchImpl(u.toString(), { headers: { authorization: `Bearer ${await auth()}` }, signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`PayPal refused the read (${r.status}${j?.name ? ` ${j.name}` : ""}): ${String(j?.message ?? "").slice(0, 200)}`);
    return j;
  };
}

const isoZ = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Every transaction from `startMs` to `endMs`, across 31-day windows and pages,
 * with the index's own `last_refreshed_datetime` (the lowest across windows, so
 * the cursor never passes a window PayPal has not finished indexing).
 * A page cap that is hit is loud, never a silent truncation.
 */
export async function listTransactions({ paypal, startMs, endMs, pageSize = PAGE_SIZE, maxPages = MAX_PAGES }) {
  const rows = [];
  let refreshed = null;
  for (let a = startMs; a < endMs; a += WINDOW_DAYS * 86_400_000) {
    const b = Math.min(endMs, a + WINDOW_DAYS * 86_400_000);
    for (let page = 1; ; page++) {
      if (page > maxPages)
        throw new Error(`paypal-watch stopped after ${maxPages} pages in the window from ${isoZ(a)} and PayPal still had more — nothing was decided from a partial read. Sweep with a later --since, then let the timer resume.`);
      const res = await paypal("/v1/reporting/transactions", { start_date: isoZ(a), end_date: isoZ(b), fields: "all", page_size: pageSize, page });
      rows.push(...(res?.transaction_details ?? []));
      if (res?.last_refreshed_datetime) {
        const t = Date.parse(res.last_refreshed_datetime);
        if (Number.isFinite(t)) refreshed = refreshed == null ? t : Math.min(refreshed, t);
      }
      if (!res?.total_pages || page >= Number(res.total_pages)) break;
    }
  }
  const seen = new Set();
  const out = [];
  for (const t of rows) {
    const id = t?.transaction_info?.transaction_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(t);
  }
  out.sort((x, y) => Date.parse(x.transaction_info.transaction_initiation_date) - Date.parse(y.transaction_info.transaction_initiation_date)
    || String(x.transaction_info.transaction_id).localeCompare(String(y.transaction_info.transaction_id)));
  return { rows: out, last_refreshed: refreshed };
}

/**
 * One transaction, decoded to the fields the rule reads and nothing else. The
 * payer's email is decoded for the OPERATOR's journal only (to write to a payer
 * whose handle did not resolve) and never reaches a ledger row.
 */
export function decodeTransaction(t, { live }) {
  const i = t?.transaction_info ?? {};
  const amt = i.transaction_amount ?? {};
  const { pot, handle } = parseCustom(i.custom_field);
  const value = Number(amt.value);
  return {
    txn: String(i.transaction_id ?? ""),
    receipt_ref: `${RAIL}:${String(i.transaction_id ?? "")}`,
    created_at: i.transaction_initiation_date ?? null,
    created: Date.parse(i.transaction_initiation_date ?? "") || 0,
    event_code: String(i.transaction_event_code ?? ""),
    status: String(i.transaction_status ?? ""),
    currency: String(amt.currency_code ?? "").toLowerCase(),
    amount_cents: Number.isFinite(value) ? Math.round(value * 100) : null,
    reference: i.paypal_reference_id ?? null,
    custom_field: i.custom_field ?? null,
    pot_named: pot,
    handle_typed: handle,
    email: t?.payer_info?.email_address ?? null,
    live: live === true,
  };
}

// ── the rule ────────────────────────────────────────────────────────────────

const anomaly = (kind, why, rule, resolves) => ({ disposition: "anomaly", anomaly: kind, why, rule, resolves });
const isPayment = (code) => /^T00\d\d$/.test(code);
const isReversal = (code) => /^T11\d\d$/.test(code) || /^T12\d\d$/.test(code);
const STATUS_WORD = { P: "pending", D: "denied", V: "reversed", F: "partially refunded" };

/**
 * What happens to ONE decoded transaction. Pure: no network, no writes, no clock of its own.
 * Returns one of already | skip | hold | witness | anomaly, as stripe-watch's resolveSession does.
 */
export function resolveTransaction(s, { engine, entries, clone, households, loginHands = null, now = Date.now(), graceMs = CROSSING_MS, minUsd = MIN_USD, allowSandbox = false }) {
  const { receipts } = engine.foldPotReceipts(entries);
  const prior = receipts.find((r) => String(r.ref) === s.receipt_ref);
  if (prior) return { disposition: "already", ...s, pot: prior.pot, from: prior.from, date: prior.date, usd_recorded: prior.usd };

  if (!s.txn) return { ...s, ...anomaly("malformed", "the transaction carries no id, so it has no ref", "a receipt's ref is its identity", "nothing — this is a bug in the reader or an unrecognised payload") };
  // A REVERSAL IS NAMED, NEVER DROPPED. The ledger has no row that unwitnesses a dollar.
  if (isReversal(s.event_code))
    return { ...s, ...anomaly("refund", `transaction ${s.txn} (${s.event_code}) reverses or refunds ${s.reference ?? "a payment PayPal did not name"}`,
      "the ledger is append-only and has no row kind that unwitnesses a dollar; a receipt for the original payment stands",
      "the founder, by hand — inside the grace window the original is still unspent and can be left unwitnessed; after it, the ledger's grammar is the only honest fix") };
  if (!isPayment(s.event_code)) return { disposition: "skip", ...s, why: `event code ${s.event_code} is not a payment (fees, conversions and holds decide nothing)` };
  if (!allowSandbox && !s.live)
    return { ...s, ...anomaly("testmode", "this is a SANDBOX transaction", "sandbox money must never become a real ledger row", "nothing — if this is unexpected the box is reading the sandbox API") };
  if (s.status !== "S")
    return { ...s, ...anomaly(s.status === "P" ? "unpaid" : "not-paid", `transaction_status is "${s.status}"${STATUS_WORD[s.status] ? ` (${STATUS_WORD[s.status]})` : ""}, not "S"`,
      "a receipt witnesses a payment that was actually made", s.status === "P" ? "PayPal, when it settles — the next tick re-reads it" : "the founder, by hand") };
  if (s.currency !== "usd")
    return { ...s, ...anomaly("not-usd", `this payment is ${s.amount_cents == null ? "an unreadable amount" : (s.amount_cents / 100).toFixed(2)} ${s.currency.toUpperCase() || "(no currency)"}, not US dollars`,
      "the pot-receipt grammar's `usd:` is a whole number of US dollars, and the town has no rate anywhere to convert it", "the founder, by hand") };
  if (s.amount_cents == null || s.amount_cents <= 0)
    return { ...s, ...anomaly("malformed", "the transaction amount is not a positive number", "a receipt records the dollars that arrived", "nothing — an unrecognised payload") };

  const usdTotal = s.amount_cents / 100;
  const whole = Math.floor(usdTotal);
  const cents = Number((usdTotal - whole).toFixed(2));
  if (whole < minUsd)
    return { ...s, usd_total: usdTotal, ...anomaly("under-a-dollar", `$${usdTotal.toFixed(2)} is less than a dollar`, "the ledger records whole dollars, so a payment under $1 cannot be witnessed as a receipt. It reached the town and it is not lost", "nothing mechanical — it is a gift the ledger has no row for") };

  if (!s.pot_named)
    return { ...s, usd_total: usdTotal, usd: whole, ...anomaly("needs-pot", "the payment names no pot (no custom_id from the fund page)", "\"a receipt needs the pot it pays\" — tools/epoch-close.mjs", "the founder, by hand: record it against the pot the giver meant") };
  const gate = potGateOf(engine, clone, s.pot_named);
  if (!gate.ok)
    return { ...s, usd_total: usdTotal, usd: whole, ...anomaly("needs-pot", gate.defect, "\"a receipt needs the pot it pays\" — a draft or closed pot takes no dollars", "the founder: open the pot, or record the dollars against the pot the giver meant. The next tick re-reads it") };

  const hand = resolveHand(s.handle_typed, households, loginHands, OUTSIDE_FROM);
  const { attributed, from } = hand;
  const g = fundGuards({ engine, entries, clone, pot: s.pot_named, handle: from, usd: whole, receiptRef: s.receipt_ref });
  if (!g.ok)
    return { ...s, usd_total: usdTotal, usd: whole, pot: s.pot_named, from,
      ...anomaly("over-cap", g.defect, "D5 (Keemin, 2026-08-21): \"intake refuses dollars past a pot's posted target, mechanically (recording tool / door bounce), except pots explicitly marked uncapped\"", g.hint ?? "the next epoch opens fresh") };

  const plan = {
    pot: s.pot_named, from, usd: whole, rail: RAIL, ref: s.receipt_ref, attributed,
    ...(hand.via ? { attributed_via: hand.via } : {}),
    ...(hand.pin_note ? { pin_note: hand.pin_note } : {}),
    handle_typed: s.handle_typed,
    ...(cents > 0 ? { cents_note: `$${usdTotal.toFixed(2)} arrived; the ledger records whole dollars, so $${whole} is witnessed against the pot and the remaining $${cents.toFixed(2)} is money the town holds that priced nothing.` } : {}),
    ...(attributed ? {} : { gift_note: hand.gift_note }),
  };
  const witnessAt = s.created + graceMs;
  if (now < witnessAt) return { ...s, disposition: "hold", usd_total: usdTotal, plan, witnesses_after: new Date(witnessAt).toISOString() };
  return { ...s, disposition: "witness", usd_total: usdTotal, ...plan };
}

/** Every transaction the journal has SEEN and never WITNESSED (stripe-watch § unwitnessedSeen, on `txn`). */
export function unwitnessedSeen(rows) {
  const seen = new Map();
  const witnessed = new Set();
  for (const r of rows ?? []) {
    if (!r || !r.txn) continue;
    if (r.kind === "seen") { if (!seen.has(r.txn)) seen.set(r.txn, r); }
    else if (r.kind === "witnessed") witnessed.add(r.txn);
  }
  for (const id of witnessed) seen.delete(id);
  return [...seen.values()];
}

/** One tick, decided and NOT performed: { report, todo, cursor }. The live read wins over the journal's snapshot. */
export function decide({ transactions, lastRefreshed = null, journal = [], live, engine, entries, clone, households, loginHands = null, now = Date.now(), graceMs = CROSSING_MS, allowSandbox = false, cursor = null }) {
  const fresh = transactions.map((t) => decodeTransaction(t, { live }));
  const byId = new Map(fresh.map((s) => [s.txn, s]));
  let rechecked = 0;
  for (const row of journal) {
    if (!row?.txn || byId.has(row.txn)) continue;
    const { kind: _k, at: _a, ...s } = row;
    byId.set(s.txn, s);
    rechecked += 1;
  }
  const decoded = [...byId.values()].sort((a, b) => a.created - b.created || a.txn.localeCompare(b.txn));
  const buckets = { already: [], skip: [], hold: [], witness: [], anomaly: [] };
  for (const s of decoded) {
    const r = resolveTransaction(s, { engine, entries, clone, households, loginHands, now, graceMs, allowSandbox });
    buckets[r.disposition].push(r);
  }
  return {
    report: {
      generated_at: new Date(now).toISOString(),
      rail: RAIL,
      api: live ? "live" : "sandbox",
      read_from: cursor == null ? null : new Date(cursor).toISOString(),
      indexed_through: lastRefreshed == null ? null : new Date(lastRefreshed).toISOString(),
      lag: `Transaction Search lags up to ${SEARCH_LAG_HOURS}h; the cursor advances to what PayPal says it has indexed, never to the newest payment seen`,
      transactions: fresh.length,
      rechecked,
      grace: `one crossing (${graceMs / 3_600_000}h) after the payment`,
      witnessed_now: buckets.witness.length,
      holding: buckets.hold.length,
      anomalies: buckets.anomaly.length,
      skipped: buckets.skip.length,
      hold: buckets.hold,
      witness: buckets.witness,
      anomaly: buckets.anomaly,
      already: buckets.already.map((a) => ({ txn: a.txn, pot: a.pot, from: a.from, usd_recorded: a.usd_recorded, date: a.date })),
      posture: "every PayPal payment resolves by rule: the pot from the order's own custom_id (written by the fund page), the hand from the handle typed after it matched against the town's registry, and an unmatched hand is a gift rather than a guess. Refunds and reversals are named, never dropped. Only the anomaly list waits on a person.",
    },
    todo: buckets.witness,
    cursor: lastRefreshed ?? cursor,
  };
}

/** The journal row for one witnessed payment. */
export function witnessedRow(w, out, at = new Date().toISOString()) {
  return { kind: "witnessed", at, txn: w.txn, ref: w.ref, pot: w.pot, from: w.from, usd: w.usd,
    attributed: w.attributed, handle_typed: w.handle_typed, line: out?.line ?? null, commit: out?.commit ?? null };
}

// ── the CLI ─────────────────────────────────────────────────────────────────

const arg = (argv, name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};

/** The credential pair and which money it reads: env first, or a { env, client_id, secret } file, never printed. */
export function credentialsFrom(argv, env = process.env) {
  const file = arg(argv, "credentials");
  if (file) {
    const j = JSON.parse(readFileSync(file, "utf8"));
    return { clientId: j.client_id, secret: j.secret, which: j.env };
  }
  return { clientId: env.PAYPAL_CLIENT_ID, secret: env.PAYPAL_SECRET, which: env.PAYPAL_ENV };
}

export async function main(argv = process.argv.slice(2), { fetchImpl = fetch, log = console.log, err = console.error, env = process.env, now = Date.now() } = {}) {
  const clone = arg(argv, "clone", env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone"));
  const statePath = arg(argv, "state", STATE_PATH);
  const journalPath = arg(argv, "journal", join(dirname(statePath), JOURNAL_NAME));
  const outPath = arg(argv, "out", null);
  const dryRun = argv.includes("--dry-run");
  const allowSandbox = argv.includes("--allow-sandbox");

  const { clientId, secret, which } = credentialsFrom(argv, env);
  if (which !== "live" && which !== "sandbox") { err("paypal-watch: PAYPAL_ENV must be live or sandbox — a watcher that guessed which money it reads would be guessing about the ledger"); return 1; }
  if (allowSandbox && !dryRun) { err("paypal-watch: --allow-sandbox is for a --dry-run only — sandbox money never becomes a ledger row"); return 1; }
  const engine = await townEngine(clone);
  if (!engine) { err(`paypal-watch: no town clone with the funding seam at ${clone}`); return 1; }
  if (!engine.KEEPING_RAILS?.includes?.(RAIL)) { err(`paypal-watch: the town at ${clone} has no \`rail: paypal\` in its grammar yet — nothing could be recorded`); return 1; }

  let paypal;
  try { paypal = paypalReader({ clientId, secret, api: env.PAYPAL_API || PAYPAL_API[which], fetchImpl }); }
  catch (e) { err(String(e.message)); return 1; }

  const state = readState(statePath);
  const since = arg(argv, "since", null);
  const coldFloor = now - COLDSTART_DAYS * 86_400_000;
  const cursor = (since ? Date.parse(since) : null) ?? (state.cursor ? Date.parse(state.cursor) : null) ?? coldFloor;
  const coldStart = !since && !state.cursor;

  let listed;
  try { listed = await listTransactions({ paypal, startMs: cursor, endMs: now }); }
  catch (e) { err(`paypal-watch: ${e.message}`); return 1; }

  const entries = ledgerEntries(clone, engine);
  const households = engine.householdKeys(clone);
  const loginHands = townLoginHands(clone, engine);
  const journalRows = readJournal(journalPath);
  const behind = unwitnessedSeen(journalRows);

  const { report, todo, cursor: next } = decide({
    transactions: listed.rows, lastRefreshed: listed.last_refreshed, journal: behind, live: which === "live",
    engine, entries, clone, households, loginHands, now, allowSandbox, cursor,
  });
  if (coldStart) report.coldstart = `no cursor: this run read only the last ${COLDSTART_DAYS} days.`;
  report.dry_run = dryRun;

  if (!dryRun) {
    const known = new Set(journalRows.filter((r) => r.kind === "seen").map((r) => r.txn));
    appendJournal(journalPath, listed.rows.map((t) => decodeTransaction(t, { live: which === "live" }))
      .filter((s) => !known.has(s.txn)).map((s) => ({ kind: "seen", at: report.generated_at, ...s })));
  }

  const written = [];
  if (!dryRun && todo.length) {
    const { execUnderTownLock, lockTimedOut, LOCK_BUSY } = await import("../src/town-lock.mjs");
    const { townDay } = await import("../src/ops.mjs");
    const record = penRecorder(clone, { execUnderTownLock, lockTimedOut, LOCK_BUSY, townDay,
      execPath: join(HERE, "..", "src", "fund-exec.mjs"), rail: RAIL, via: "paypal-watch" });
    for (const w of todo) {
      try { written.push(witnessedRow(w, await record({ pot: w.pot, usd: w.usd, from: w.from, ref: w.ref }))); }
      catch (e) { written.push({ kind: "refused", at: new Date().toISOString(), txn: w.txn, ref: w.ref, pot: w.pot, from: w.from, usd: w.usd, code: e?.code ?? null, defect: e?.defect ?? String(e?.message ?? e).slice(0, 200), hint: e?.hint ?? null }); }
    }
    appendJournal(journalPath, written);
  }
  report.written = written;
  // A dry run moves nothing, the cursor included.
  if (!dryRun) writeState(statePath, { ...state, cursor: next == null ? state.cursor ?? null : new Date(next).toISOString(), last_run: report.generated_at });
  if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n"); }

  if (argv.includes("--json")) { log(JSON.stringify(report, null, 2)); return 0; }
  log(`paypal-watch · ${report.api} · ${report.transactions} transaction(s) from ${report.read_from ?? "the cold-start floor"}, indexed through ${report.indexed_through ?? "(PayPal did not say)"}${dryRun ? " · DRY RUN: nothing written" : ""}`);
  if (report.rechecked) log(`  plus ${report.rechecked} seen-and-unwitnessed payment(s) re-decided from the journal`);
  if (report.coldstart) log(`  ${report.coldstart}`);
  log(`  ${dryRun ? "would witness" : "witnessed now"}: ${dryRun ? report.witness.length : written.filter((w) => w.kind === "witnessed").length}   holding: ${report.holding}   already on the ledger: ${report.already.length}   anomalies: ${report.anomalies}   not payments: ${report.skipped}`);
  for (const w of dryRun ? report.witness : [])
    log(`  WOULD WITNESS ${w.txn}  $${w.usd} → ${w.pot}  as ${w.from}   (the row: pot-receipt · pot:${w.pot} · rail: ${RAIL} · usd: ${w.usd} · from: ${w.from} · ref: ${w.ref})`);
  for (const h of report.hold)
    log(`  HOLD   ${h.txn}  $${h.plan.usd} → ${h.plan.pot}  as ${h.plan.from}${h.plan.attributed ? "" : `  (typed: ${h.plan.handle_typed ?? "—"})`}  witnesses after ${h.witnesses_after}`);
  for (const a of report.anomaly)
    log(`  ${a.anomaly.toUpperCase().padEnd(14)} ${a.txn}  ${a.why}\n                 rule: ${a.rule}\n                 resolves: ${a.resolves}`);
  for (const w of written)
    log(`  ${w.kind === "witnessed" ? "WITNESSED" : "REFUSED  "} ${w.txn}  $${w.usd} → ${w.pot}  as ${w.from}${w.defect ? `  — ${w.defect}` : ""}`);
  return 0;
}

// ── entry guard (the realpath compare: stripe-watch.mjs § entry guard) ──────
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exitCode = await main();
