// stripe-watch — the card rail, closed at both ends by rule.
//
// usdc-watch sees and does not witness, and its header is a long argument for
// why that boundary is correct THERE. This file is the other answer, and the
// difference is not appetite — it is that the two facts which forbid
// auto-witnessing on Base are both ABSENT on the card rail. They were checked,
// not assumed:
//
// 1. THE SESSION SAYS WHICH POT. An ERC-20 transfer carries no memo, so a
//    watcher of the intake address is guessing at a stranger's intent. A Stripe
//    checkout session carries `client_reference_id`, and since site main
//    b2260e7a the town's own fund page sets it: the "Pay by card" link is
//    `${STRIPE}?client_reference_id=${pot.pot}`. Nobody types it; the PAGE the
//    payer stood on writes it. A session that does not carry one is not guessed
//    at — it is journalled as `needs-pot` and the report says so by name.
//
// 2. THERE IS NO PAYER PASTE-PATH TO FRONT-RUN. The theft this whole class of
//    watcher risks is consuming a ref's one mint chance before the patron
//    claims it (usdc-watch.mjs: "ref is unique forever: one dollar, one mint
//    chance, a re-recorded receipt bounces", and the ledger has no row kind that
//    reassigns a payer). On Base the patron HAS a paste-path, so the watcher can
//    beat them to it. On the card rail the town's own page says, in its own
//    words: "Step 2 — there isn't one … There is nothing for you to paste. The
//    hash form belongs to the USDC rail — it reads Base directly and cannot see
//    a card payment." A ref of the form `stripe:<session_id>` can therefore be
//    minted by exactly one thing in the whole town, and it is this file. There
//    is no honest claim to front-run.
//
// So the ruling law of this lane — no payment waits on a person; every arrival
// resolves by rule, and only anomalies surface — is buildable here, and this is
// where it is built.
//
// ── HOW ONE SESSION RESOLVES ────────────────────────────────────────────────
//
//   pot   `client_reference_id`, if it names a pot the town posts AND that pot
//         is open (potGate, the /fund door's own gate). Anything else —
//         missing, unknown, draft, closed — journals as `needs-pot`. The first
//         real $10 (2026-08-25) predates the parameter and lands here; every
//         session after b2260e7a carries one, so this queue should approach
//         zero and a rising count is a signal about the page, not the watcher.
//
//   hand  TWO CHANNELS, asked in order, and only a clean answer is a hand.
//
//         FIRST, the session's custom field `handle`, if it EXACTLY names a
//         registered household (the town's own `householdKeys`, the same set
//         the /fund door's guard 3 asks). Unchanged, and first ON PURPOSE:
//         eight logins in the live pins file are also somebody's resident
//         handle today, so a pin channel asked first would let a payer typing
//         their OWN handle pay a stranger's deed.
//
//         SECOND, added 2026-08-27: a GitHub login THE TOWN HAS ALREADY PINNED
//         to a household, in its own reviewed `tools/github-ids.json`, that
//         resolves to exactly ONE current hand. The case that forced it was a
//         real $20 to darko-fund whose payer typed `herzfunke-martina` — their
//         GitHub login, bound by the town's own pins to the single-resident
//         household of `sol-am-lichterfenster`. Filed as a gift, that dollar
//         mints no holo, and the ref's one mint chance is spent forever.
//
//         This is NOT a loosening toward near-matches. A typo is still a gift;
//         the exact-match rule refuses fuzzy names and still does. It is the
//         office declining to discard a binding the town wrote down under
//         review. A PIN NAMES A HOUSEHOLD, NOT A PERSON: where the household
//         holds several hands (17 of 93 pinned logins today, six behind one of
//         them) the pin cannot say which of them paid, and choosing would be
//         the office deciding whose deed grew — so several hands is a gift, and
//         the note says THAT rather than implying a misspelling, because the
//         two are fixed by completely different acts.
//
//         The map is `src/household-logins.mjs`, which projects the town's own
//         `currentHouseholds()` plus its own pins — the same one resolver
//         `tools/world-households-export.mjs` publishes to the World, extracted
//         so there is not a second copy to drift.
//
//         Anything else — absent, misspelled, unpinned, or a login two accounts
//         claim — → the receipt's payer is `outside:stripe` and the dollars
//         count toward the pot without minting holo for anyone. That is not a
//         new rule; it is the already-published one, from the card rail's own
//         warning on the fund page: "a payment the office cannot attach to a
//         hand can still be a gift, but it cannot mint your holo."
//
//         AND IT SAYS SO ON THE ROW. The pin is the only channel that pays a
//         hand the payer did not type, so a resolution through it carries
//         `attributed_via: "login-pin"` and a note naming what was typed, what
//         it became, and on whose authority — because the grace window exists
//         for a person to veto a resolution, and one nobody can see is not
//         reviewable.
//
//         WHY THAT SPELLING. `from:` in the pot-receipt grammar is `(\S+)`, so
//         it will take anything without a space. `outside:stripe` is chosen
//         because a handle can never look like it: `isResidentHandle` admits
//         only `[a-z0-9-]`, so a colon makes the string unmintable as a name.
//         A future reader can therefore tell an unattached gift from an
//         attached one by shape alone, with no list to consult. The town's own
//         close already knows what to do with it — deriveEpochClose resolves a
//         payer that is not a household to holo 0 — the payment is recorded
//         and settled, and it mints nothing, exactly as the founding family
//         grant does.
//
//   when  one full crossing after the session was created. THE GRACE IS THE
//         POINT: while a session is held, the intake journal shows the operator
//         round the typed handle and the resolution it is ABOUT to get, so a
//         payer who typed `jetto-of-starfoge` can be fixed before the one-shot
//         ref is spent. After the window the rule runs and nothing waits.
//
//         An interpretive call, made in the open: "≥1 crossing old" could mean
//         "a crossing boundary has passed" (the town's usual sense — a letter
//         sails on the next boat) or "its age is at least one crossing". Those
//         differ sharply: the boundary reading gives a payment made at 11:59 UTC
//         a grace window of ONE MINUTE, which is not a window at all, and the
//         window is the stated reason the delay exists. So this implements
//         ELAPSED AGE ≥ CROSSING_MS — always at least twelve hours, never less.
//         The clock is the town's own ratified derivation (src/crossings.mjs),
//         not a number typed here.
//
//   cap   the town's own `intakeCheck`, through the /fund door's own
//         `fundGuards`, so D5 ("intake refuses dollars past a pot's posted
//         target, mechanically … except pots explicitly marked uncapped") is
//         one copy of one rule. An over-target arrival journals `over-cap` and
//         is NOT witnessed — the pot's headroom is real money law, and a watcher
//         is the last thing that should be allowed to walk around it.
//
//   again idempotency is the LEDGER's, not the journal's: every tick asks
//         `foldPotReceipts` whether `stripe:<id>` is already a receipt, exactly
//         as usdc-watch's `witnessed` bucket does. The journal remembers what
//         was SEEN; the ledger decides what was DONE. A journal lost to a wiped
//         disk therefore cannot cause a double-witness — it costs the operator
//         their window, and nothing else.
//
// ── WHAT THIS DOES NOT SEE, said out loud ───────────────────────────────────
//
// A REFUND AFTER THE FACT. A session is read once, at `status=complete` and
// `payment_status=paid`. If the founder refunds a card payment later, the
// receipt stands — the ledger is append-only and signature-linked and has no
// row kind that unwitnesses a dollar. Inside the grace window a refund is
// catchable by the operator round, which is one more reason the window is a
// full crossing rather than a boundary. After it, this is a known and accepted
// hole, and the honest place to fix it is the ledger's grammar, which is
// founder-only. The journal records `payment_intent` so any such dollar can be
// traced back to the charge by hand.
//
// TEST-MODE MONEY. A test-mode key returns test sessions that look exactly like
// real ones. A test payment must never become a real ledger row, so
// `livemode: false` is an anomaly (`testmode`), never a witness.
//
// ── THE SETTLED DOLLARS (POS-183, 2026-09-23) ───────────────────────────────
//
// The ledger's `usd:` is a whole number of US dollars. Until this change the
// watcher took it from `session.amount_total` and refused any session whose
// `currency` was not "usd" as `not-usd`, for the founder's hand. Account-level
// Adaptive Pricing is ON (Keemin, 2026-09-21), so Stripe may PRESENT a Payment
// Link in the payer's currency. The session's `currency` and `amount_total`
// are then the PRESENTED ones, in GBP or EUR, and every international payment
// would have landed on the anomaly list instead of on the ledger.
//
// Stripe settles every such payment to the account's currency, and the dollars
// that settled are on the charge's BALANCE TRANSACTION:
// `payment_intent → latest_charge → balance_transaction.amount`, in the
// settlement currency's minor units, GROSS (before Stripe's fee). Gross is what
// `amount_total` has always meant for a dollar session, so a dollar on the
// ledger means the same thing whichever currency the page was shown in.
//
// So, for a session presented in anything but dollars:
//
//   read   the payment intent, with `expand[]=latest_charge.balance_transaction`
//          (`readSettlement`, a second call per non-dollar session only). A
//          dollar session makes no extra call and resolves exactly as before.
//   write  `usd:` from the balance transaction, whole dollars, cents disclosed
//          as they always were. The presented currency and amount ride the
//          witnessed JOURNAL row as a receipt — `presented: { currency, amount }`
//          in Stripe's minor units — and never the ledger row, whose grammar is
//          unchanged.
//   refuse `not-usd` now means the BALANCE TRANSACTION itself is not in dollars,
//          which only an account that stopped settling to dollars can produce.
//          A session whose settlement has not been read (no charge yet, or the
//          read failed) is `unsettled`, and every tick re-reads it.
//
// The settlement is JOURNALLED (on the `seen` row, or on a `settled` row when it
// arrives later), because tools/funding-report.mjs re-decides these rows from
// the journal with no key and no network. A settlement held only in this
// process's memory would give the report and the tick two answers for one
// payment — the report would say "unsettled" over a dollar the tick witnessed.
//
// Usage: node tools/stripe-watch.mjs [--state <state.json>] [--journal <j.jsonl>]
//                                    [--out <report.json>] [--clone <town-clone>]
//                                    [--since <ISO|unix>] [--dry-run] [--json]
//
// Env: STRIPE_KEY   a RESTRICTED, READ-ONLY Stripe key (rk_…) with read
//                   permission on Checkout Sessions and nothing else. It lives
//                   in /etc/postmark-stripe-watch.env (the box convention:
//                   /etc/<unit>.env + systemd EnvironmentFile=, mode 600) and is
//                   never committed.
//      STRIPE_API_VERSION  optional; unset means the account's default version,
//                   which is what the founder's own dashboard shows. Pinning a
//                   version the box cannot verify 400s the whole watcher, so
//                   the default here is "do not pin".
//      STRIPE_API   optional base URL. Unset means Stripe. It exists so the
//                   CLI itself — env to reader to pages to journal to state —
//                   can be driven end to end by a falsifier against a local
//                   server, because everything else in this file is pure and
//                   the glue is the part that has to actually run on the box.
//      plus fund-exec's own: TOWN_CLONE, STAMP_KEY, TOWN_PUSH, BOT_NAME,
//                   BOT_EMAIL, TOWN_TZ, TOWN_LOCK.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { CROSSING_MS } from "../src/crossings.mjs";
import { fundGuards, penRecorder } from "../src/fund.mjs";
import { townLoginHands } from "../src/household-logins.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const STRIPE_API = "https://api.stripe.com/v1";
export const RAIL = "stripe";
// The one spelling for a card dollar nobody claimed. See WHY THAT SPELLING.
export const OUTSIDE_FROM = "outside:stripe";
// The custom field's key on the Stripe payment link, as the founder configures
// it in the console. A field with any other key is not read — a watcher that
// scanned every custom field for something handle-shaped would be guessing.
// The dashboard assigned this key when the founder created the field
// (2026-08-25, label "Your Postmark handle, if you keep house here") and the
// dashboard offers no way to rename it. Read off the live payment link via the
// API, not guessed. If the field is ever recreated with a saner key, this one
// constant is the whole change.
export const HANDLE_FIELD = "description";
// "the ledger records whole dollars, so a payment under $1 cannot be witnessed
// as a receipt" — the /fund door's own floor, quoted rather than re-derived.
export const MIN_USD = 1;
// A cold start reads a bounded window and SAYS SO, rather than paginating the
// account's whole history or silently starting from now. `--since` sweeps back
// further when the operator wants a one-off catch-up.
export const COLDSTART_DAYS = 30;
export const PAGE_LIMIT = 100;
export const MAX_PAGES = 50;

// ── WHERE THIS RAIL'S STATE LIVES, owned HERE (postmark#2972) ───────────────
//
// On 2026-09-19 `tools/funding-report.mjs` told the operator the card rail had
// not ticked in 33,573 minutes — three weeks — while the timer was ticking every
// fifteen and the journal carried witnessed rows from that morning. Two files
// answered "when did this rail last tick": this watcher writes
// /srv/postmark-stripe/state.json (the path its unit passes), and the report
// carried its own default of <office>/.stripe-watch-state.json, last written
// 2026-08-27 and never again. The report read the one nobody writes.
//
// The report's own header says a rail that has not ticked makes every queue
// below it a lie — so the false ⚠ was not cosmetic: read literally it said the
// town had been blind to cards for three weeks, and it trains the reader to
// skim the warning that will matter the day a watcher really dies.
//
// ONE OWNER, AND IT IS THE FILE THAT WRITES THE STATE. The report imports these
// rather than keeping a twin. This is also the CLI's own default, because a
// constant that disagrees with the default beside it is the same two answers
// again in one file — deploy/postmark-stripe-watch.service still passes
// `--state` explicitly, which is now agreement rather than instruction, and
// test/funding-report.test.mjs pins the two against each other so they cannot
// drift apart a second time.
//
// Off the box this path does not exist. `readState` answers {} for a file that
// is not there, which is the honest answer — off the box there IS no live tick
// — and an operator with their own state file passes `--state`.
export const STATE_PATH = "/srv/postmark-stripe/state.json";
// The journal has always lived beside the state, derived rather than typed
// (see `main()` below, which keeps deriving it from whatever `--state` says).
export const JOURNAL_NAME = "stripe-intake.jsonl";
export const JOURNAL_PATH = join(dirname(STATE_PATH), JOURNAL_NAME);

const iso = (unixSeconds) => new Date(unixSeconds * 1000).toISOString();

// ── the Stripe read ─────────────────────────────────────────────────────────
// Injected as `stripe` everywhere below, so a falsifier drives an account that
// does not exist — the same shape usdc-watch injects `rpc`.

export function stripeReader({ key, api = STRIPE_API, apiVersion = null, fetchImpl = fetch, timeoutMs = 20_000 }) {
  if (!key) throw new Error("stripe-watch has no STRIPE_KEY — a read-only restricted key is the whole credential, and there is no default");
  return async (path, params = {}) => {
    const u = new URL(api + path);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
    const r = await fetchImpl(u.toString(), {
      headers: {
        authorization: `Bearer ${key}`,
        ...(apiVersion ? { "stripe-version": apiVersion } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      // Stripe's own message is the useful one; keep it verbatim and bounded.
      const msg = j?.error?.message ?? `HTTP ${r.status}`;
      throw new Error(`Stripe refused the read (${r.status}): ${String(msg).slice(0, 200)}`);
    }
    return j;
  };
}

/**
 * Every COMPLETED checkout session created at or after `createdGte`, oldest
 * first, followed across pages.
 *
 * `created[gte]` is INCLUSIVE and the cursor stores a `created` we have already
 * seen, so the boundary second is re-read on every tick. That is deliberate:
 * two sessions can share a second, and a `gt` cursor would drop the sibling.
 * Re-reading is free because the journal dedupes on session id and the ledger
 * dedupes on ref.
 */
export async function listCompleteSessions({ stripe, createdGte, limit = PAGE_LIMIT, maxPages = MAX_PAGES }) {
  const out = [];
  let startingAfter = null;
  let exhausted = false;
  for (let page = 0; ; page++) {
    // The page cap exists so a runaway cannot hammer Stripe. It must never
    // become a silent truncation: a watcher that quietly stopped reading would
    // report a clean tick while sessions it never saw sat unwitnessed, which is
    // the same lie as an empty report from a blind watcher. Loud, and the
    // cursor stays where it was.
    if (page >= maxPages) { exhausted = true; break; }
    const res = await stripe("/checkout/sessions", {
      limit,
      status: "complete",
      "created[gte]": createdGte,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    const data = res?.data ?? [];
    out.push(...data);
    if (!res?.has_more || data.length === 0) break;
    startingAfter = data.at(-1).id;
  }
  if (exhausted)
    throw new Error(`stripe-watch stopped after ${maxPages} pages (${out.length} sessions) and Stripe still had more — nothing was decided from a partial read. Sweep the backlog with a later --since, then let the timer resume.`);
  // Stripe lists newest-first; the ledger's order is arrival order.
  out.sort((a, b) => a.created - b.created || String(a.id).localeCompare(String(b.id)));
  return out;
}

/**
 * One session, decoded to the fields the rule reads and nothing else.
 *
 * The email is decoded because the OPERATOR needs it to write to a payer whose
 * handle did not resolve — it belongs in the journal, which is a private
 * operator surface, and NEVER in a ledger row, which is public forever.
 */
export function decodeSession(s) {
  const fields = Array.isArray(s?.custom_fields) ? s.custom_fields : [];
  const f = fields.find((x) => x?.key === HANDLE_FIELD);
  // Stripe types a custom field as text | numeric | dropdown; the handle field
  // is text, but read whichever value is present rather than assuming, so a
  // console change to a dropdown of handles keeps working.
  const typed = f?.text?.value ?? f?.dropdown?.value ?? f?.numeric?.value ?? null;
  return {
    session: String(s?.id ?? ""),
    receipt_ref: `${RAIL}:${String(s?.id ?? "")}`,
    created: Number(s?.created ?? 0),
    created_at: s?.created ? iso(Number(s.created)) : null,
    amount_total: Number(s?.amount_total ?? 0),
    currency: String(s?.currency ?? "").toLowerCase(),
    client_reference_id: s?.client_reference_id ?? null,
    handle_typed: typed == null ? null : String(typed).trim(),
    email: s?.customer_details?.email ?? null,
    payment_status: String(s?.payment_status ?? ""),
    livemode: s?.livemode === true,
    payment_intent: typeof s?.payment_intent === "string" ? s.payment_intent : (s?.payment_intent?.id ?? null),
    // Present only when the listing itself was expanded down to the balance
    // transaction. Absent, not null, otherwise, so a dollar session decodes to
    // exactly the row it always did.
    ...(settlementOf(s?.payment_intent) ? { settled: settlementOf(s.payment_intent) } : {}),
  };
}

// ── the settled dollars (see THE SETTLED DOLLARS in the header) ─────────────

/**
 * The settlement a payment intent carries, if its charge's balance transaction
 * is expanded. Pure. The one reading of that shape: `decodeSession` asks it of
 * an expanded listing and `readSettlement` asks it of a retrieved intent.
 */
export function settlementOf(pi) {
  const bt = pi && typeof pi === "object" ? pi.latest_charge?.balance_transaction : null;
  if (!bt || typeof bt !== "object" || bt.currency == null || !Number.isFinite(Number(bt.amount))) return null;
  return { balance_transaction: String(bt.id ?? ""), currency: String(bt.currency).toLowerCase(), amount: Number(bt.amount) };
}

/** A decoded session whose dollars must come from its balance transaction. */
export const needsSettlement = (s) =>
  !!s && s.currency !== "usd" && !s.settled && !!s.payment_intent && s.payment_status === "paid";

export const SETTLEMENT_EXPAND = "latest_charge.balance_transaction";

/** One payment intent's settlement, read from Stripe. null = no balance transaction yet. */
export async function readSettlement({ stripe, paymentIntent }) {
  const pi = await stripe(`/payment_intents/${encodeURIComponent(paymentIntent)}`, { "expand[]": SETTLEMENT_EXPAND });
  return settlementOf(pi);
}

/**
 * The settlements for every decoded row that needs one, keyed by session id.
 * A read that fails is an ANSWER, not a crash: it maps to `{ error }`, the rule
 * names it as `unsettled`, and the next tick tries again. One foreign card must
 * not stop the dollar sessions behind it.
 */
export async function readSettlements({ stripe, rows }) {
  const out = new Map();
  for (const s of rows ?? []) {
    if (!needsSettlement(s) || out.has(s.session)) continue;
    try {
      const settled = await readSettlement({ stripe, paymentIntent: s.payment_intent });
      out.set(s.session, settled ?? { error: "the charge has no balance transaction yet" });
    } catch (e) {
      out.set(s.session, { error: String(e?.message ?? e).slice(0, 200) });
    }
  }
  return out;
}

/** A decoded row with its settlement applied, if one was read and it has none. */
export function withSettlement(s, settlements) {
  if (!s || s.settled || !settlements?.has(s.session)) return s;
  const got = settlements.get(s.session);
  return got.error ? { ...s, settle_error: got.error } : { ...s, settled: got };
}

/**
 * The journal with every `settled` row folded onto its session's `seen` row.
 * Pure. A settlement read after the session was first journalled is appended
 * as its own row (the journal is append-only), so every reader of `seen` rows
 * — this watcher and tools/funding-report.mjs alike — reads through this.
 */
export function foldSettlements(rows) {
  const settled = new Map();
  for (const r of rows ?? []) if (r?.kind === "settled" && r.session && r.settled) settled.set(r.session, r.settled);
  if (!settled.size) return rows ?? [];
  return (rows ?? []).map((r) => (r?.kind === "seen" && !r.settled && settled.has(r.session) ? { ...r, settled: settled.get(r.session) } : r));
}

// ── the rule ────────────────────────────────────────────────────────────────

const anomaly = (kind, why, rule, resolves) => ({ disposition: "anomaly", anomaly: kind, why, rule, resolves });

/**
 * What happens to ONE decoded session, given the ledger, the town, and the
 * clock. Pure: no network, no filesystem writes, no clock of its own.
 *
 * Returns one of
 *   { disposition: "already", … }  the ref is a receipt; nothing to do
 *   { disposition: "hold",    … }  inside the grace window, carrying the PLAN
 *   { disposition: "witness", … }  the row to write
 *   { disposition: "anomaly", … }  named, with the rule and what resolves it
 *
 * A HELD session carries its provisional resolution, not just "wait". That is
 * the whole value of the window: the operator round must be able to read "this
 * will file to darko-fund as an outside gift because `jetto-of-starfoge` is not
 * a household" and fix it, rather than learning after the ref is spent.
 */
export function resolveSession(s, { engine, entries, clone, households, loginHands = null, now = Date.now(), graceMs = CROSSING_MS, minUsd = MIN_USD, allowTestmode = false }) {
  const { receipts } = engine.foldPotReceipts(entries);
  const prior = receipts.find((r) => String(r.ref) === s.receipt_ref);
  if (prior) return { disposition: "already", ...s, pot: prior.pot, from: prior.from, date: prior.date, usd_recorded: prior.usd };

  if (!s.session) return { ...s, ...anomaly("malformed", "the session carries no id, so it has no ref", "a receipt's ref is its identity", "nothing — this is a bug in the reader or an unrecognised payload") };
  if (!allowTestmode && !s.livemode)
    return { ...s, ...anomaly("testmode", "this is a TEST-MODE session", "a test payment must never become a real ledger row", "nothing — test money stays test money; if this is unexpected the box is holding a test key") };
  if (s.payment_status !== "paid")
    return { ...s, ...anomaly("unpaid", `payment_status is "${s.payment_status}", not "paid"`, "a receipt witnesses a payment that was actually made", "Stripe, when the payment settles — the next tick re-reads it") };
  // THE DOLLARS. A dollar session's are its own amount_total. Any other
  // session's are the ones Stripe SETTLED, off the balance transaction — never
  // a rate the town computes. See THE SETTLED DOLLARS in the header.
  let minor = s.amount_total;
  let presented = null;
  if (s.currency !== "usd") {
    const shown = `${(s.amount_total / 100).toFixed(2)} ${s.currency.toUpperCase()}`;
    const rule = "the pot-receipt grammar's `usd:` is a whole number of US dollars; a payment presented in another currency is recorded at the dollars Stripe SETTLED it to (its charge's balance transaction), never at a rate the town computes";
    if (!s.settled) {
      const why = s.settle_error
        ? `this session was presented in ${shown}, and reading what it settled to in dollars failed: ${s.settle_error}`
        : s.payment_intent
          ? `this session was presented in ${shown}, and what it settled to in dollars has not been read yet`
          : `this session was presented in ${shown} and carries no payment_intent, so there is no charge to read its settled dollars from`;
      return { ...s, ...anomaly("unsettled", why, rule, s.payment_intent ? "Stripe, when the charge's balance transaction exists — every tick re-reads it" : "the founder, by hand — there is no charge behind this session to read") };
    }
    if (s.settled.currency !== "usd")
      return { ...s, ...anomaly("not-usd", `this payment settled in ${s.settled.currency.toUpperCase()} (balance transaction ${s.settled.balance_transaction}), not in US dollars, and the ledger records dollars`, rule, "the founder, by hand — the account itself did not settle to dollars, and there is no rate anywhere in the town to convert it") };
    minor = s.settled.amount;
    presented = { currency: s.currency, amount: s.amount_total };
  }

  const usdTotal = minor / 100;
  const whole = Math.floor(usdTotal);
  const cents = Number((usdTotal - whole).toFixed(2));
  if (whole < minUsd)
    return { ...s, usd_total: usdTotal, ...anomaly("under-a-dollar", `$${usdTotal.toFixed(2)} is less than a dollar`, "the ledger records whole dollars, so a payment under $1 cannot be witnessed as a receipt. It reached the town and it is not lost", "nothing mechanical — it is a gift the ledger has no row for") };

  // THE POT. `client_reference_id` or nothing — never a guess, and never a
  // default. A watcher that fell back to "the only open pot" would be choosing
  // where a stranger's money goes on the day a second pot opens.
  const named = s.client_reference_id == null ? null : String(s.client_reference_id).trim();
  if (!named)
    return { ...s, usd_total: usdTotal, usd: whole, ...anomaly("needs-pot", "the session names no pot (no client_reference_id)", "\"a receipt needs the pot it pays\" — tools/epoch-close.mjs, on refusing a receipt with no pot file behind it", "the founder, by hand: record it against the pot the payer meant. Sessions created after site main b2260e7a carry the pot automatically, so this queue should approach zero") };

  const gate = potGateOf(engine, clone, named);
  if (!gate.ok)
    return { ...s, usd_total: usdTotal, usd: whole, pot_named: named, ...anomaly("needs-pot", gate.defect, "\"a receipt needs the pot it pays\" — a draft or closed pot takes no dollars", "the founder: open the pot, or record the dollars against the pot the payer meant. The next tick re-reads it") };

  // THE HAND. Two channels, asked in order; anything else is a gift.
  const typed = s.handle_typed || null;
  const hand = resolveHand(typed, households, loginHands);
  const { attributed, from } = hand;

  // THE CAP, through the /fund door's own guards so D5 is one copy of one rule.
  const g = fundGuards({ engine, entries, clone, pot: named, handle: from, usd: whole, receiptRef: s.receipt_ref });
  if (!g.ok)
    return {
      ...s, usd_total: usdTotal, usd: whole, pot: named, from,
      ...anomaly("over-cap", g.defect, "D5 (Keemin, 2026-08-21): \"intake refuses dollars past a pot's posted target, mechanically (recording tool / door bounce), except pots explicitly marked uncapped\"", g.hint ?? "the next epoch opens fresh"),
    };

  const plan = {
    pot: named,
    from,
    usd: whole,
    rail: RAIL,
    ref: s.receipt_ref,
    attributed,
    ...(hand.via ? { attributed_via: hand.via } : {}),
    ...(hand.pin_note ? { pin_note: hand.pin_note } : {}),
    handle_typed: typed,
    // The receipt of a foreign presentment. Journal-only: record() takes pot,
    // usd, from and ref, so nothing here can reach the ledger row.
    ...(presented ? { presented, settled: s.settled } : {}),
    ...(cents > 0 ? {
      cents_note: `$${usdTotal.toFixed(2)} arrived; the ledger records whole dollars, so $${whole} is witnessed against the pot and the remaining $${cents.toFixed(2)} is money the town holds that priced nothing.`,
    } : {}),
    ...(attributed ? {} : { gift_note: hand.gift_note }),
  };

  const witnessAt = s.created * 1000 + graceMs;
  if (now < witnessAt)
    return { ...s, disposition: "hold", usd_total: usdTotal, plan, witnesses_after: new Date(witnessAt).toISOString() };

  return { ...s, disposition: "witness", usd_total: usdTotal, ...plan };
}

/**
 * WHOSE DOLLAR THIS IS — two channels, asked in order, pure.
 *
 * 1. THE HANDLE. An exact match against the town's registered households, the
 *    same set the /fund door's guard 3 asks. Unchanged, and it is asked FIRST
 *    and keeps its precedence: eight logins in the live pins file are also
 *    somebody's resident handle today, so if the pin channel went first, typing
 *    your own handle could pay a stranger's deed.
 *
 * 2. THE PIN. A GitHub login the TOWN HAS ALREADY BOUND to a household, in its
 *    own reviewed pins file, resolving to exactly one current hand. This is not
 *    a fuzzy match and not a search for the nearest name — the exact-match rule
 *    refuses those and still does. It is the office declining to throw away a
 *    binding the town wrote down under review. The map is built by the town's
 *    own resolver through src/household-logins.mjs, never a second one.
 *
 *    ONE HAND OR NO HAND. A pin names a HOUSEHOLD. Where that household holds
 *    several hands — 17 of 93 pinned logins today, six behind one of them — the
 *    pin cannot say which person paid, and choosing would be the office
 *    deciding whose deed grew. Several hands is a gift, and the note says so in
 *    those words rather than as a misspelling, because the two are fixed by
 *    completely different acts.
 *
 * Anything else — a typo, an unpinned login, a stranger, a login two accounts
 * claim — is a gift under OUTSIDE_FROM exactly as before. Every gift carries
 * the sentence the fund page already published: a payment the office cannot
 * attach to a hand can still be a gift, but it cannot mint your holo.
 *
 * WHY THE NOTE MATTERS AS MUCH AS THE RULE. This is the only channel that pays
 * a hand the payer did not type. The grace window exists so a person can veto a
 * resolution before the ref is spent, and a resolution nobody can see is not
 * reviewable — so an attribution through the pin says, on the row itself, which
 * string was typed, which hand it became, and on what authority.
 */
export function resolveHand(typed, households, loginHands = null) {
  const gift = (why) => ({ attributed: false, from: OUTSIDE_FROM, via: null, gift_note: why });

  if (typed != null && households?.has(typed))
    return { attributed: true, from: typed, via: "handle" };

  if (typed == null)
    return gift(`no handle was given, so these dollars are witnessed as a gift under ${OUTSIDE_FROM} and mint no holo.`);

  const pin = loginHands?.get?.(typed.toLowerCase()) ?? null;

  if (pin && pin.hands.length === 1) {
    const from = pin.hands[0];
    return {
      attributed: true,
      from,
      via: "login-pin",
      pin_note: `"${typed}" is not a resident handle — it is the GitHub login the town's own pins bind to household ${pin.key}, whose one hand is ${from}. The town's own verified pin is the hand — attributed, not guessed.`,
    };
  }

  if (pin && pin.hands.length > 1)
    return gift(`"${typed}" is a GitHub login the town has pinned, but it names the household ${pin.key}, which holds ${pin.hands.length} hands (${pin.hands.join(", ")}) — a pin names a household and cannot say which of them paid. These dollars are witnessed as a gift under ${OUTSIDE_FROM} and mint no holo; a hand among them can be credited by the founder, by hand, while the ref is unspent. A payment the office cannot attach to a hand can still be a gift, but it cannot mint your holo.`);

  return gift(`"${typed}" is not a household the town knows, so these dollars are witnessed as a gift under ${OUTSIDE_FROM} and mint no holo. A payment the office cannot attach to a hand can still be a gift, but it cannot mint your holo.`);
}

// potGate lives in fund.mjs and takes the engine; wrapped here only so a
// falsifier can hand in an engine whose potFile is a fixture.
function potGateOf(engine, clone, pot) {
  const meta = engine.potFile(clone, pot);
  if (!meta) return { ok: false, defect: `no pot named "${pot}"` };
  if (meta.status && meta.status !== "open") return { ok: false, defect: `pot "${pot}" is ${meta.status}, not open` };
  return { ok: true, meta };
}

/**
 * THE ROWS THE CURSOR FORGOT — every session the journal remembers as SEEN and
 * has never recorded as WITNESSED.
 *
 * ── WHY THIS EXISTS (postmark#2973, 2026-09-19) ────────────────────────────
 *
 * A held session is journalled `seen` and decided again on the next tick only
 * while the live listing still returns it — and the listing starts at the
 * cursor, which `decide` moves to the NEWEST session it was shown. So the
 * moment a newer session shares a listing with a held one, the held one falls
 * behind the cursor and `created[gte]` never returns it again. soren's $10.28
 * to `keeping-ec2` sat that way for three days while every tick printed
 * "holding: 0" over it, because nothing re-read the journal.
 *
 * THE CURSOR IS FOR FINDING NEW SESSIONS. THE JOURNAL IS FOR REMEMBERING HELD
 * ONES. The header above already promised half of that — "the journal remembers
 * what was SEEN; the ledger decides what was DONE" — and it was true of dedupe
 * and false of re-decision. This is the other half.
 *
 * `tools/funding-report.mjs § stripeQueue` has decided from exactly this set
 * since it was written, which is why the report re-read soren's session as
 * Ready to witness on the third day while the watcher could not see it at all.
 * Nothing changes for that reader: this makes the tick agree with it rather
 * than adding a second rule beside it.
 *
 * A `refused` row STAYS in the set. A refusal spends nothing — the ref is
 * unspent and the code that wrote the row says so in those words ("the next
 * tick tries again") — so a refusal is a delay, not a verdict.
 *
 * A `witnessed` row drops OUT, and that is the point of asking the journal
 * rather than only the ledger. `resolveSession` would answer `already` for it
 * and the ledger's ref-uniqueness would bounce a second write regardless; the
 * watcher must not even try.
 *
 * Pure, and takes raw journal rows so a torn line costs nothing.
 */
export function unwitnessedSeen(rows) {
  const seen = new Map();
  const witnessed = new Set();
  for (const r of rows ?? []) {
    if (!r || !r.session) continue;
    if (r.kind === "seen") { if (!seen.has(r.session)) seen.set(r.session, r); }
    else if (r.kind === "witnessed") witnessed.add(r.session);
  }
  for (const id of witnessed) seen.delete(id);
  return [...seen.values()];
}

/**
 * One tick, decided and NOT performed.
 *
 * Returns { report, cursor, todo } and writes nothing — the caller records and
 * persists, so a falsifier can run the whole tick and prove no ledger row was
 * written. `todo` is the ordered list of witnesses to perform.
 *
 * TWO READS, ONE DECISION. `sessions` is the live listing from the cursor;
 * `journal` is `unwitnessedSeen(...)` — the rows the cursor has left behind.
 * THE LIVE READ WINS where both carry the same session, because a journal row
 * is a snapshot of the session as it was FIRST seen and `payment_status` can
 * still move from unpaid to paid. Letting the snapshot win would freeze a
 * session at the moment it was worst understood — the same shape of failure
 * one layer down.
 *
 * THE CURSOR IS COMPUTED FROM THE LIVE LISTING ALONE, deliberately: it means
 * "what Stripe has shown us", and this is a fix TO a cursor bug, so it must not
 * quietly be a second change to what the cursor means.
 */
export function decide({ sessions, journal = [], settlements = null, engine, entries, clone, households, loginHands = null, now = Date.now(), graceMs = CROSSING_MS, minUsd = MIN_USD, allowTestmode = false, cursor = null }) {
  // `settlements` is `readSettlements(...)`'s map, read by the caller so this
  // stays pure. Applied to live and journal rows alike; a row that already
  // carries its settlement keeps it.
  const live = sessions.map(decodeSession).map((s) => withSettlement(s, settlements));
  journal = journal.map((r) => withSettlement(r, settlements));
  const maxCreated = live.reduce((a, s) => Math.max(a, s.created), cursor ?? 0);

  const byId = new Map(live.map((s) => [s.session, s]));
  let rechecked = 0;
  for (const row of journal) {
    if (!row?.session || byId.has(row.session)) continue;
    // `kind` and `at` are the JOURNAL's fields, not the session's, and
    // resolveSession spreads whatever it is handed into the row the operator
    // reads. Strip them so a re-decided row is shaped like a freshly decoded
    // one and no reader has to learn a second shape.
    const { kind: _kind, at: _at, ...s } = row;
    byId.set(s.session, s);
    rechecked += 1;
  }
  const decoded = [...byId.values()].sort((a, b) => a.created - b.created || String(a.session).localeCompare(String(b.session)));

  const buckets = { already: [], hold: [], witness: [], anomaly: [] };
  for (const s of decoded) {
    const r = resolveSession(s, { engine, entries, clone, households, loginHands, now, graceMs, minUsd, allowTestmode });
    buckets[r.disposition].push(r);
  }
  return {
    report: {
      generated_at: new Date(now).toISOString(),
      rail: RAIL,
      read_from: cursor == null ? null : iso(cursor),
      // WHAT STRIPE RETURNED, and nothing else. The CLI's headline sentence is
      // "N completed session(s) since <cursor>", and a count inflated by journal
      // rows would read as a Stripe read that never happened. The journal's
      // contribution is `rechecked`, on its own line, in its own words.
      sessions: live.length,
      rechecked,
      grace: `one crossing (${graceMs / 3_600_000}h) after the session was created`,
      witnessed_now: buckets.witness.length,
      holding: buckets.hold.length,
      anomalies: buckets.anomaly.length,
      hold: buckets.hold,
      witness: buckets.witness,
      anomaly: buckets.anomaly,
      already: buckets.already.map((a) => ({ session: a.session, pot: a.pot, from: a.from, usd_recorded: a.usd_recorded, date: a.date })),
      posture: "every card payment resolves by rule: the pot comes from the session's own client_reference_id, the hand from its `handle` field matched against the town's registry, and an unmatched hand is a gift rather than a guess. Only the anomaly list waits on a person. The cursor finds new sessions; the journal's seen-and-unwitnessed rows are re-decided every tick whatever the cursor says, so a held session cannot be orphaned behind it.",
    },
    todo: buckets.witness,
    cursor: maxCreated || null,
  };
}

// ── the journal (append-only, operator-facing, never public) ─────────────────
// The window the grace exists to open. It holds the typed handle and the payer
// email — neither of which may ever reach a ledger row — so the operator round
// can catch a typo while the ref is still unspent.

export function readJournal(p) {
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return { malformed: l.slice(0, 200) }; }
  });
}

export function appendJournal(p, rows) {
  if (!rows.length) return;
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

// A settlement worth journalling: a read that succeeded. Errors are not facts.
const settledOnly = (session, settlements) => {
  const got = settlements?.get(session);
  return got && !got.error ? { settled: got } : {};
};

/**
 * The journal row for one witnessed payment. Exported so a falsifier can read
 * its shape without a pen. A payment presented in another currency carries
 * `presented` (currency + amount in Stripe's minor units) and `settled` (the
 * balance transaction the dollars came from); a dollar payment's row is
 * exactly the row it always was.
 */
export function witnessedRow(w, out, at = new Date().toISOString()) {
  return {
    kind: "witnessed", at, session: w.session, ref: w.ref, pot: w.pot, from: w.from, usd: w.usd,
    attributed: w.attributed, handle_typed: w.handle_typed,
    ...(w.presented ? { presented: w.presented, settled: w.settled } : {}),
    line: out?.line ?? null, commit: out?.commit ?? null,
  };
}

export const readState = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; } };
export function writeState(p, state) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2) + "\n");
}

export async function townEngine(clone) {
  const mint = join(clone, "tools", "stamp-mint.mjs");
  if (!existsSync(mint)) return null;
  const m = await import(pathToFileURL(mint));
  const needs = ["foldPotReceipts", "parseStampLedger", "potFile", "keepingDial", "intakeCheck", "householdKeys"];
  return needs.every((k) => typeof m[k] === "function") ? m : null;
}

export function ledgerEntries(clone, engine) {
  const p = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  return existsSync(p) ? engine.parseStampLedger(readFileSync(p, "utf8")) : [];
}

// ── the CLI ─────────────────────────────────────────────────────────────────

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
}

const sinceUnix = (v) => {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n > 1_000_000_000) return Math.floor(n);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
};

async function main() {
  const clone = arg("clone", process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone"));
  const statePath = arg("state", STATE_PATH);
  const journalPath = arg("journal", join(dirname(statePath), JOURNAL_NAME));
  const outPath = arg("out", null);
  const dryRun = process.argv.includes("--dry-run");

  const engine = await townEngine(clone);
  if (!engine) {
    console.error(`FATAL: no town clone with the funding seam at ${clone} — the watch reads the ledger through the town's own fold, never its own parse`);
    process.exit(1);
  }

  const stripe = stripeReader({
    key: process.env.STRIPE_KEY,
    apiVersion: process.env.STRIPE_API_VERSION ?? null,
    api: process.env.STRIPE_API || STRIPE_API,
  });

  const state = readState(statePath);
  const explicit = sinceUnix(arg("since", null));
  const coldFloor = Math.floor(Date.now() / 1000) - COLDSTART_DAYS * 86_400;
  const cursor = explicit ?? state.cursor ?? coldFloor;
  const coldStart = explicit == null && state.cursor == null;

  const sessions = await listCompleteSessions({ stripe, createdGte: cursor });

  const entries = ledgerEntries(clone, engine);
  const households = engine.householdKeys(clone);
  // The second channel's map, derived by the town's own resolver. Built here
  // and handed down so the rule stays pure and a falsifier can withhold it.
  const loginHands = townLoginHands(clone, engine);

  // THE SECOND READ. The journal is read ONCE here and used twice: to re-decide
  // the rows the cursor has left behind (#2973), and immediately below to
  // decide which of this listing's sessions are new enough to journal. One read
  // because two reads of an append-only file inside one tick can disagree, and
  // a dedupe set that disagrees with the re-decide set is a double-witness.
  const journalRows = foldSettlements(readJournal(journalPath));
  const behind = unwitnessedSeen(journalRows);

  // THE THIRD READ, for non-dollar sessions only: what each one SETTLED to.
  // Asked of the live listing and of the journal's rows alike, because a row
  // the cursor has left behind is decided from the journal and needs its
  // dollars just the same. A dollar session is never asked about, and neither
  // is one the journal already holds a settlement for: a balance transaction's
  // amount never changes once written (a refund is a transaction of its own),
  // so the boundary second's re-read costs no second call.
  const remembered = new Map(journalRows.filter((r) => r.kind === "seen" && r.settled).map((r) => [r.session, r.settled]));
  const settlements = await readSettlements({
    stripe,
    rows: [...sessions.map(decodeSession), ...behind].map((s) => (remembered.has(s.session) ? { ...s, settled: remembered.get(s.session) } : s)),
  });
  for (const [session, settled] of remembered) if (!settlements.has(session)) settlements.set(session, settled);

  const { report, todo, cursor: next } = decide({
    sessions, journal: behind, settlements, engine, entries, clone, households, loginHands, cursor,
  });
  if (coldStart) report.coldstart = `no cursor: this run read only the last ${COLDSTART_DAYS} days. A session older than ${iso(coldFloor)} was NOT read — sweep it with --since.`;

  // journal every session not already known, plus every disposition this tick
  const known = new Map(journalRows.filter((r) => r.kind === "seen").map((r) => [r.session, r]));
  // A new session is journalled WITH its settlement when one was read (never
  // with a failed read's error — that is this tick's weather, not a fact about
  // the payment). A known session whose settlement arrives only now gets a
  // `settled` row, because the journal is append-only and the report reads it.
  const seenRows = sessions.map(decodeSession)
    .filter((s) => !known.has(s.session))
    .map((s) => ({ kind: "seen", at: report.generated_at, ...s, ...settledOnly(s.session, settlements) }));
  const lateSettled = [...known.values()]
    .filter((r) => !r.settled && settledOnly(r.session, settlements).settled)
    .map((r) => ({ kind: "settled", at: report.generated_at, session: r.session, ...settledOnly(r.session, settlements) }));
  appendJournal(journalPath, [...seenRows, ...lateSettled]);

  const written = [];
  if (!dryRun && todo.length) {
    const { execUnderTownLock, lockTimedOut, LOCK_BUSY } = await import("../src/town-lock.mjs");
    const { townDay } = await import("../src/ops.mjs");
    const record = penRecorder(clone, {
      execUnderTownLock, lockTimedOut, LOCK_BUSY, townDay,
      execPath: join(HERE, "..", "src", "fund-exec.mjs"),
      rail: RAIL, via: "stripe-watch",
    });
    for (const w of todo) {
      try {
        const out = await record({ pot: w.pot, usd: w.usd, from: w.from, ref: w.ref });
        written.push(witnessedRow(w, out));
      } catch (e) {
        // A refusal is an answer, not a crash: journal it and keep going, so one
        // bad session cannot hold up the queue behind it. The ref is unspent,
        // so the next tick tries again.
        written.push({ kind: "refused", at: new Date().toISOString(), session: w.session, ref: w.ref, pot: w.pot, from: w.from, usd: w.usd, code: e?.code ?? null, defect: e?.defect ?? String(e?.message ?? e).slice(0, 200), hint: e?.hint ?? null });
      }
    }
    appendJournal(journalPath, written);
  }
  report.written = written;

  writeState(statePath, { ...state, cursor: next ?? cursor, last_run: report.generated_at });
  if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n"); }

  if (process.argv.includes("--json")) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log(`stripe-watch · ${report.sessions} completed session(s) since ${report.read_from ?? "the cold-start floor"}`);
  // Printed only when there were any, and named as a SECOND read rather than
  // folded into the headline — the line above is about what Stripe returned,
  // and an operator who cannot tell the two reads apart cannot tell a quiet
  // account from a cursor that has run away from a held session.
  if (report.rechecked) console.log(`  plus ${report.rechecked} seen-and-unwitnessed session(s) re-decided from the journal, behind the cursor`);
  if (report.coldstart) console.log(`  ${report.coldstart}`);
  console.log(`  witnessed now: ${written.filter((w) => w.kind === "witnessed").length}   holding: ${report.holding}   already on the ledger: ${report.already.length}   anomalies: ${report.anomalies}`);
  for (const h of report.hold)
    console.log(`  HOLD   ${h.session}  $${h.plan.usd} → ${h.plan.pot}  as ${h.plan.from}${h.plan.attributed ? "" : `  (typed: ${h.plan.handle_typed ?? "—"}${h.email ? `, ${h.email}` : ""})`}  witnesses after ${h.witnesses_after}`);
  for (const a of report.anomaly)
    console.log(`  ${a.anomaly.toUpperCase().padEnd(14)} ${a.session}  ${a.why}\n                 rule: ${a.rule}\n                 resolves: ${a.resolves}`);
  for (const w of written)
    console.log(`  ${w.kind === "witnessed" ? "WITNESSED" : "REFUSED  "} ${w.session}  $${w.usd} → ${w.pot}  as ${w.from}${w.defect ? `  — ${w.defect}` : ""}`);
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
