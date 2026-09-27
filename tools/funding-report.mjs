// funding-report — the whole funding state of the town, in one read.
//
// THIS IS STAGE A, and Stage A is the whole of what is meant to be adopted
// today. It is ONE COMMAND, read-only: no timer, no daemon, no unit, no stored
// state, nothing that can drift while nobody is looking. It reads Stripe live,
// the chain through whatever the existing watch last wrote, and the ledger
// through the town's own fold — then prints, for every payment it can resolve
// by rule, the exact one-line command that witnesses it.
//
// So the founder's work is: run one command, read one page, paste one line per
// payment. That is the whole of Stage A, and everything the timers in Stage B
// would automate is already decided HERE — the rules are the same functions.
// Stage B removes the paste, not the thinking.
//
// TURNING STAGE A OFF is not running it. There is no residue: it writes no
// state, installs nothing, and the town behaves exactly as it does today
// whether or not this file is ever executed.
//
// THE TEST THIS FILE IS BUILT AGAINST (the founder's, 2026-08-25): he should be
// able to read this in sixty seconds and have ZERO matching work — only vetoes.
// So the shape is: what needs a person FIRST, whether the machines are alive
// SECOND, and the books THIRD. A report that opened with the books would be a
// report you have to search for the thing that is wrong.
//
// It is a READ. No network, no key, no pen. Everything comes from three places
// that already exist:
//
//   the ledger   WHITE_PAGES/stamp-ledger.md, folded through src/funding.mjs —
//                the same fold the office's own funding reads use, so this
//                report and the doors can never disagree about a row.
//   the pots     WHITE_PAGES/pot-*.json, through the same reader, so a
//                malformed pot file is surfaced here by its own name.
//   the watchers the two rails' on-disk state and journals. usdc-watch writes a
//                report; stripe-watch writes an append-only intake journal, and
//                its unresolved rows are re-decided HERE by the same pure
//                function the watcher uses — never by a second copy of the rule.
//
// A DEAD WATCHER IS THE LOUDEST ANOMALY THERE IS, which is why the rails' health
// is above the books rather than in a footnote. Every other line in this report
// is a claim about money the town has SEEN; if a rail has not ticked, the town
// is not seeing, and the quiet queue is a lie rather than an all-clear. Same
// shape as usdc-watch's own refusal to report an empty day when it is blind.
//
// Usage: node tools/funding-report.mjs [--clone <town-clone>] [--out <report.md>]
//                                      [--stripe-state <f>] [--stripe-journal <f>]
//                                      [--usdc-state <f>] [--usdc-report <f>]

import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { foldFunding, readPots, parseLedgerText, TREASURY_POT } from "../src/funding.mjs";
import { readWalletRegistry } from "../src/wallet-registry.mjs";
import { townLoginHands } from "../src/household-logins.mjs";
// the town day, from the one place that owns it — a receipt's date is the
// town's clock and never the operator's laptop's
import { townDay } from "../src/ops.mjs";
import { readIntakeMap, SINK_RULE, STATE_PATH as USDC_STATE, REPORT_NAME as USDC_REPORT_NAME } from "./usdc-watch.mjs";
import {
  resolveSession, decodeSession, listCompleteSessions, stripeReader, readJournal, readState, COLDSTART_DAYS,
  readSettlements, withSettlement, foldSettlements,
  STATE_PATH as STRIPE_STATE, JOURNAL_PATH as STRIPE_JOURNAL,
} from "./stripe-watch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// How long a rail may go quiet before the report calls it out. The usdc timer
// is every 10 minutes and the stripe timer every 15, so an hour is four to six
// missed ticks — comfortably past a jittered start or one bad RPC, and well
// short of a crossing.
export const STALE_MINUTES = 60;

const usd = (n) => "$" + Number(n).toLocaleString("en-US");
// A session's own amount in the currency it was PRESENTED in. A dollar session
// reads exactly as before; a foreign one is never printed with a dollar sign.
const presentedAmount = (s) => (s.currency && s.currency !== "usd"
  ? `${((s.amount_total ?? 0) / 100).toFixed(2)} ${s.currency.toUpperCase()}`
  : usd((s.amount_total ?? 0) / 100));
// The receipt of a foreign presentment, where the operator reads it (POS-183).
const settledNote = (p) => `presented as ${(p.presented.amount / 100).toFixed(2)} ${p.presented.currency.toUpperCase()}; it settled to ${usd(p.settled.amount / 100)} (balance transaction \`${p.settled.balance_transaction}\`), and the ledger records the settled dollars.`;

/**
 * ONE SESSION'S AMOUNT, in the report's one voice.
 *
 * A decoded session carries TWO amounts since postmark#3183 and they are not
 * interchangeable: `amount_total`/`currency` is the PRESENTMENT pair — what the
 * payer saw, in the payer's own money — and `usd_total` is the SETTLED dollars
 * the rule computed from the charge's balance transaction, which is what the
 * town will actually record.
 *
 * This page printed `$` in front of `amount_total / 100` unconditionally, which
 * was the report's own half of the Adaptive-Pricing defect: a £20 payment read
 * as "$20.00" on the operator's screen, off by whatever the pound was worth
 * that morning, on the one table whose entire job is to be checked by eye
 * before the ref is spent. The rule now converts; the page must not un-convert.
 */
const sessionAmount = (r) => {
  const settled = r?.usd_total == null ? null : usd(r.usd_total);
  const foreign = r?.currency && String(r.currency).toLowerCase() !== "usd";
  // Never behind a "$": this number is not dollars and the cell must not imply
  // it is. A `not-usd` anomaly has no settled amount at all, so for that row
  // this is the ONLY number there is, and it is the honest one to show.
  const presented = foreign ? `${((r.amount_total ?? 0) / 100).toFixed(2)} ${String(r.currency).toUpperCase()}` : null;
  if (settled && presented) return `${settled} (paid ${presented})`;
  return settled ?? presented ?? usd((r?.amount_total ?? 0) / 100);
};

// ── the one-command manual witness (STAGE A's whole write path) ─────────────
// It is not a new tool. It is the SAME recorder the /fund door and both watchers
// use — src/fund-exec.mjs shelling the town's own `epoch-close.mjs --receipt`,
// which enforces ref-uniqueness and the D5 intake cap itself. The report decides
// nothing here that the timers would decide differently; it just prints the line.
//
// The flock is not decoration: the ferry and the crossing take town.lock
// exclusively, and a receipt appended underneath one of them is how a crossing
// gets stranded. A pasted command has no office around it to take the lock, so
// the lock is IN the command.
export const TOWN_LOCK = "/srv/postmark-office/town.lock";
export const OFFICE_DIR = "/srv/postmark-office";

export function witnessCommand({ pot, usd: n, from, ref, rail, date, lock = TOWN_LOCK, office = OFFICE_DIR }) {
  const payload = JSON.stringify({ pot, usd: n, from, ref, rail, date, via: "the operator by hand" });
  // Single-quoted in the shell, so the JSON's double quotes ride free. A single
  // quote anywhere in the payload would end the quoting and hand the rest of the
  // line to the shell — it cannot happen for pots, handles, refs and dates, which
  // are all [a-z0-9:.-].
  //
  // IT HAPPENED IMMEDIATELY, in the one field I wrote myself: `via` said "the
  // operator's hand" and this guard refused to print a single command until the
  // apostrophe came out. That is the whole argument for the guard — the unsafe
  // character never comes from the data you were worried about.
  if (payload.includes("'")) throw new Error(`refusing to print an unquotable command: ${payload}`);
  return `flock -w 30 ${lock} node ${office}/src/fund-exec.mjs '${payload}'`;
}
const ago = (iso, now) => {
  const t = Date.parse(iso ?? "");
  if (!Number.isFinite(t)) return null;
  return Math.round((now - t) / 60_000);
};

/**
 * The state of one rail's watcher: has it run, and how long ago.
 * `null` for last_run means it has never run, which is a different and worse
 * answer than "it ran a while ago" — say so rather than folding them together.
 */
export function railHealth(name, state, { now = Date.now(), staleMinutes = STALE_MINUTES } = {}) {
  const last = state?.last_run ?? null;
  const mins = ago(last, now);
  if (last == null) return { rail: name, ok: false, last_run: null, note: "has never run — no state file, or the timer was never enabled" };
  if (mins == null) return { rail: name, ok: false, last_run: last, note: "its state file carries an unreadable last_run" };
  if (mins > staleMinutes) return { rail: name, ok: false, last_run: last, minutes_ago: mins, note: `last ticked ${mins} minutes ago — the town has not looked at this rail since, so a quiet queue here proves nothing` };
  return { rail: name, ok: true, last_run: last, minutes_ago: mins, note: `ticking (${mins} min ago)` };
}

/**
 * Every funding anomaly the town is carrying, from every source, each with the
 * rule that governs it and what will resolve it.
 *
 * `resolves` is deliberately a sentence and not a date: most of these are
 * resolved by a RULE on the next tick (a pot opening, a payment settling) and
 * only the genuinely human ones say so. The founder's veto list is exactly the
 * rows whose `resolves` names a person.
 */
export function anomalies({ fold, potsInvalid, stripe, usdcReport, walletInvalid, mapInvalid }) {
  const out = [];
  const add = (source, kind, what, rule, resolves) => out.push({ source, kind, what, rule, resolves });

  for (const r of fold.invalid)
    add("ledger", r.row_kind, r.line, r.reason, "the founder — a row already in the sealed ledger cannot be edited; it is surfaced so it is never rendered as if it were good");
  for (const r of potsInvalid)
    add("pots", r.row_kind, r.line, r.reason, "a PR against the town repo fixing the pot file");
  for (const r of walletInvalid)
    add("wallets", r.row_kind, r.line, r.reason, "the household, by PR — until then the address resolves to nobody and its arrivals stay unclaimed");
  for (const r of mapInvalid)
    add("intake-map", r.row_kind, r.line, r.reason, "a fix to deploy/intake-addresses.json in the office repo");

  for (const a of stripe.anomaly)
    add("stripe", a.anomaly, `${a.session} · ${presentedAmount(a)}${a.email ? ` · ${a.email}` : ""}`, a.why, a.resolves);
  for (const n of usdcReport?.needs_pot ?? [])
    add("usdc", "needs-pot", `${n.txhash} · ${usd(n.usd)} · ${n.handle}`, n.why, "the payer names the pot (or witnesses it from that pot's own /fund/ page), or the founder mints a per-pot intake address and deploy/intake-addresses.json names it");
  for (const o of usdcReport?.over_cap ?? [])
    add("usdc", "over-cap", `${o.txhash} · ${usd(o.usd)} → ${o.pot}`, o.why, o.hint ?? "the next epoch opens fresh");
  for (const u of usdcReport?.unclaimed ?? [])
    add("usdc", "unclaimed", `${u.txhash} · ${usd(u.usd)} · from ${u.from_address}${u.age_days == null ? "" : ` · ${u.age_days}d old`}`, u.why, `the patron pastes their hash at /fund/, or the household's address is registered with the OFFICE (the box-side registry; never the town repo). The sink rule would eventually take it — it is OFF: ${SINK_RULE}`);

  return out;
}

/**
 * Every unwitnessed payment the rules already resolved, each with its command.
 *
 * STAGE A HAS NO TIMER, so it also has no grace window: a session nothing will
 * ever witness automatically must not be hidden behind a clock. Both the ripe
 * and the still-fresh ones are listed, and the fresh ones say so — because in
 * Stage A the operator IS the typo window, and the window only helps if the
 * thing waiting in it is on the page.
 */
export function readyToWitness({ stripe, usdcReport, date }) {
  const out = [];
  const add = (rail, plan, extra) => out.push({
    rail, ...plan, ...extra,
    command: witnessCommand({ pot: plan.pot, usd: plan.usd, from: plan.from, ref: plan.ref, rail, date }),
  });
  for (const w of stripe.witness ?? []) add("stripe", w, { session: w.session, fresh: false, handle_typed: w.handle_typed ?? null, email: w.email ?? null, ...(w.presented ? { note: settledNote(w) } : {}) });
  for (const h of stripe.hold ?? []) add("stripe", h.plan, { session: h.session, fresh: true, handle_typed: h.plan.handle_typed ?? null, email: h.email ?? null, note: `created recently — Stage B would hold this one to let a mistyped handle be caught. In Stage A you are that window: check the typed handle before pasting.${h.plan.presented ? ` ${settledNote(h.plan)}` : ""}` });
  for (const w of usdcReport?.witness ?? []) add("usdc", w, { txhash: w.txhash, fresh: false });
  for (const h of usdcReport?.hold ?? []) add("usdc", h.plan, { txhash: h.txhash, fresh: true, note: "recent — check it before pasting." });
  return out;
}

/**
 * Re-decide every known Stripe session the ledger has not claimed, through the
 * WATCHER'S OWN pure resolver — one copy of the rule, so this report and the
 * tick that may later act on it cannot disagree.
 *
 * `journal` is either the live-read sessions (Stage A) or the watcher's journal
 * rows (Stage B). They are the same shape by construction: the journal stores
 * exactly what `decodeSession` produced.
 */
export function stripeQueue({ journal, engine, entries, clone, households, loginHands = null, now }) {
  const seen = new Map();
  for (const r of journal) if (r.kind === "seen" && r.session) seen.set(r.session, r);
  const buckets = { hold: [], witness: [], anomaly: [], already: [] };
  for (const s of seen.values()) {
    const r = resolveSession(s, { engine, entries, clone, households, loginHands, now });
    buckets[r.disposition].push(r);
  }
  return buckets;
}

// ── the render ──────────────────────────────────────────────────────────────

export function render({ now, pots, potsInvalid, fold, rails, anomalyRows, stripe, usdcReport, registry, ready = [] }) {
  const L = [];
  const p = (s = "") => L.push(s);

  p(`# Postmark funding — the whole state`);
  p();
  p(`_Generated ${new Date(now).toISOString()}. Everything below is derived from the signed ledger, the pot files, and the two rail watchers' own state — nothing is stored for this report and nothing here was matched by hand._`);
  p();

  // 1 · the founder's actual work: paste one line per payment
  p(`## Ready to witness — one command each`);
  p();
  if (!ready.length) {
    p(`Nothing waiting. Every payment the rules could resolve is already on the ledger.`);
  } else {
    p(`Each line below records one payment through the office's own recorder — the same \`fund-exec\` the /fund door uses, shelling the town's own \`epoch-close --receipt\`, which enforces ref-uniqueness and the pot cap itself. Paste and run from \`${OFFICE_DIR}\`. Re-running one is safe: the ledger refuses a ref it already holds.`);
    p();
    for (const r of ready) {
      p(`**${usd(r.usd)} → \`${r.pot}\` as ${r.attributed === false ? `_${r.from}_ (gift, no holo)` : `**${r.from}**`}** · ${r.rail} · \`${r.session ?? r.txhash}\`${r.fresh ? " · ⏱ recent" : ""}`);
      if (r.handle_typed != null && r.attributed === false) p(`  <br/>typed \`${r.handle_typed}\`${r.email ? ` · ${r.email}` : ""} — not a household, so this files as a gift and mints no holo.`);
      // A PIN RESOLUTION PAYS A HAND THE PAYER DID NOT TYPE, so the row has to
      // say so where a person will actually read it. Carrying the disclosure on
      // the plan and never printing it would put the one resolution most worth a
      // second look on the page looking exactly like a handle typed correctly.
      if (r.attributed_via === "login-pin" && r.pin_note) p(`  <br/>${r.pin_note}`);
      if (r.note) p(`  <br/>${r.note}`);
      p();
      p("```sh");
      p(r.command);
      p("```");
      p();
    }
  }
  p();

  // 2 · what needs a judgement
  p(`## Needs a person`);
  p();
  if (!anomalyRows.length) {
    p(`Nothing. Every dollar the town has seen is attached to a pot and a hand (or to a pot and an honest gift), by rule.`);
  } else {
    p(`| # | source | what | why | what resolves it |`);
    p(`|---|---|---|---|---|`);
    anomalyRows.forEach((a, i) => p(`| ${i + 1} | ${a.source} · ${a.kind} | ${cell(a.what)} | ${cell(a.rule)} | ${cell(a.resolves)} |`));
  }
  p();

  // 2 · are the machines alive
  p(`## The rails`);
  p();
  p(`| rail | last tick | state |`);
  p(`|---|---|---|`);
  for (const r of rails) p(`| ${r.rail} | ${r.last_run ?? "never"} | ${r.ok ? "✓ " : "⚠ "}${cell(r.note)} |`);
  p();
  if (rails.some((r) => !r.ok))
    p(`> ⚠ A rail that has not ticked is not a quiet rail. Every queue below is a claim about money the town has **seen**; while a watcher is down, an empty queue proves nothing.`);
  p();
  p(`Registered wallets: **${registry.addresses}** address(es)${registry.present ? "" : " — _no registry file yet_"} at \`${registry.path}\` (office-side; never the town repo). Intake addresses naming a pot: **${registry.mapped_pots}**.`);
  if (registry.mapped_pots === 0)
    p(`> The town has one intake address serving more than one open pot, so the chain cannot name a pot for a USDC arrival and every one of them stays pot-ambiguous. Minting a per-pot address and listing it in \`deploy/intake-addresses.json\` is what closes that queue mechanically.`);
  p();
  if (stripe.hold.length) {
    p(`### Card payments in the grace window`);
    p();
    p(`_These become receipts automatically when the window closes. This is the moment to catch a mistyped handle — after it, the ref is spent forever._`);
    p();
    p(`| session | amount | files to | as | typed | email | witnesses after |`);
    p(`|---|---|---|---|---|---|---|`);
    for (const h of stripe.hold)
      p(`| \`${h.session}\` | ${sessionAmount(h)} | ${h.plan.pot} | ${h.plan.attributed ? `**${h.plan.from}**` : `_${h.plan.from}_ (gift, no holo)`} | ${h.plan.handle_typed ?? "—"} | ${h.email ?? "—"} | ${h.witnesses_after} |`);
    p();
    // The table already shows "as" beside "typed", so a pin resolution is
    // VISIBLE here — but two differing cells read like a defect unless the page
    // says why they differ. This is the row a person is most likely to want to
    // veto, and the window exists for exactly that.
    if (stripe.hold.some((h) => h.plan?.attributed_via === "login-pin")) {
      p(`_Where **as** differs from **typed**, the payment was resolved through the town's own GitHub pin: the typed string is a login the pins bind to one household holding one hand. That is a record the town already keeps under review, not a guess — and it is the one resolution worth a second look, because it pays a hand the payer did not type._`);
      p();
    }
  }

  // 3 · the books
  p(`## The pots`);
  p();
  for (const pot of pots) {
    const d = pot.data;
    const receipts = fold.receiptsByPot.get(pot.id) ?? [];
    const roll = fold.rollByPot.get(pot.id) ?? [];
    const settledRefs = new Set(roll.map((x) => x.receipt));
    const open = receipts.filter((r) => !settledRefs.has(r.receipt));
    const received = open.reduce((a, r) => a + r.usd, 0);
    const target = d.target_usd_per_epoch;
    const escrow = fold.potEscrow.get(pot.id) ?? 0;

    p(`### ${d.title ?? pot.id} \`${pot.id}\``);
    p();
    p(`- status **${d.status}**${pot.close ? ` · close word **${pot.close}**${pot.min_close_usd ? ` (floor ${usd(pot.min_close_usd)})` : ""}` : ""}${d.first_close ? ` · first close ${d.first_close}` : ""}`);
    p(`- posted need: ${target == null ? `_none — ${pot.close === "elastic" ? "elastic: the need is whatever arrived" : "no target"}_` : `${usd(target)} per ${d.epoch_cadence ?? "epoch"}`}`);
    p(`- witnessed this epoch (receipts no close has settled): **${usd(received)}**${target != null ? ` — ${Math.min(100, Math.round((received / target) * 100))}% of the posted need` : ""}`);
    p(`- the pot file's \`received_usd\` says ${usd(d.received_usd ?? 0)}. ${d.received_usd === received ? "The two clocks agree." : "**The two clocks differ** — the ledger's rows are authoritative; the file is display and is refreshed by the recording tool."}`);
    p(`- stamps escrowed on this pot: **${escrow}**`);
    p();
    if (receipts.length) {
      p(`| date | rail | from | usd | ref | settled |`);
      p(`|---|---|---|---|---|---|`);
      for (const r of receipts) p(`| ${r.date} | ${r.rail} | ${payerCell(r)} | ${usd(r.usd)} | \`${r.receipt}\` | ${settledRefs.has(r.receipt) ? "yes" : "—"} |`);
      p();
    } else {
      p(`_No receipts yet._`);
      p();
    }
    if (roll.length) {
      p(`Patron roll: ${roll.map((x) => `${x.patron} ${x.usd == null ? "$?" : usd(x.usd)} (holo ${x.holo})`).join(" · ")}`);
      p();
    }
  }
  if (potsInvalid.length) {
    p(`### Pot files that will not read`);
    p();
    for (const r of potsInvalid) p(`- \`${r.line}\` — ${r.reason}`);
    p();
  }

  // the treasury's own line: it has no pot file by law, so it would otherwise
  // be invisible in a report keyed on pot files.
  const tRec = fold.receiptsByPot.get(TREASURY_POT) ?? [];
  if (tRec.length) {
    p(`### \`${TREASURY_POT}\` — the reserved direct-to-town line`);
    p();
    p(`_Direct-to-town receipts only; no file, no stakes, no close, and each one settles with holo 0._`);
    p();
    p(`| date | rail | from | usd | ref |`);
    p(`|---|---|---|---|---|`);
    for (const r of tRec) p(`| ${r.date} | ${r.rail} | ${payerCell(r)} | ${usd(r.usd)} | \`${r.receipt}\` |`);
    p();
  }

  // A correction the town's rule REFUSED changes no hand, and the close mints
  // by the uncorrected one — so it is named here rather than dropped, exactly
  // as the town's own fold names it.
  const refused = (fold.corrections ?? []).filter((c) => !c.applied);
  if (refused.length) {
    p(`### Corrections that did not apply`);
    p();
    for (const c of refused) p(`- \`${c.ref}\` — ${c.refused === "stale-from" ? `the correction says from **${c.says}**, the receipt reads **${c.receipt}**; the hand stays ${c.receipt}` : "no receipt carries this ref"} (${c.correction.date} · ${c.correction.reason} · by ${c.correction.by})`);
    p();
  }

  p(`## Escrow, by household`);
  p();
  if (!fold.potEscrowByHandle.size) {
    p(`_Nothing staked on any pot._`);
  } else {
    p(`| household | pot | stamps staked |`);
    p(`|---|---|---|`);
    for (const [h, m] of [...fold.potEscrowByHandle].sort((a, b) => a[0].localeCompare(b[0])))
      for (const [pot, n] of [...m].sort((a, b) => a[0].localeCompare(b[0]))) p(`| ${h} | ${pot} | ${n} |`);
  }
  p();

  if (usdcReport?.sink?.length) {
    p(`## The sink rule (OFF)`);
    p();
    p(SINK_RULE);
    p();
    p(`${usdcReport.sink.length} arrival(s) would be taken by it today, totalling ${usd(usdcReport.sink.reduce((a, s) => a + Math.floor(s.usd), 0))}.`);
    p();
  }

  return L.join("\n") + "\n";
}

// a table cell may not carry a raw pipe or newline, and truncating a reason
// silently is how a report starts lying about why something is stuck
const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

// ── the CLI ─────────────────────────────────────────────────────────────────

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : dflt;
}

// Who paid, as the close reads it: a founder pot-correction row re-hands a
// receipt (src/funding.mjs § THE HAND, CORRECTED), and the cell says so beside
// the hand the rail first recorded.
const payerCell = (r) => (r.corrected_from ? `**${r.from}** (corrected from ${r.corrected_from}, ${r.correction.date} · ${r.correction.reason})${r.correction.after_close ? " · after its close" : ""}` : r.from);

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

async function main() {
  const clone = arg("clone", process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone"));
  const now = Date.now();

  const ledgerPath = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  const entries = existsSync(ledgerPath) ? parseLedgerText(readFileSync(ledgerPath, "utf8")) : [];
  const fold = foldFunding(entries);
  const { pots, invalid: potsInvalid } = readPots(clone);

  const mint = join(clone, "tools", "stamp-mint.mjs");
  const engine = existsSync(mint) ? await import(pathToFileURL(mint)) : null;
  const households = engine ? engine.householdKeys(clone) : null;
  // THE SECOND CHANNEL, threaded HERE and not only in the watcher, on purpose.
  // This report and the tick that may later act on it call the same pure
  // resolver so they cannot disagree — but a resolver only answers what it was
  // handed. Withhold this map here and Stage A prints "a gift" over the exact
  // payment Stage B would witness to a hand: one rule, two answers, and the
  // operator reading the report is the last to know.
  const loginHands = engine ? townLoginHands(clone, engine) : null;

  const { byAddress, invalid: walletInvalid, path: registryPath, present: registryPresent } =
    readWalletRegistry(arg("wallet-registry", undefined), { households });
  const { map, invalid: mapInvalid } = readIntakeMap();

  // THE PATHS COME FROM THE FILES THAT WRITE THEM (#2972). A default typed here
  // is a second answer to "where does this rail keep its state", and the one
  // this file used to carry had been dead since 2026-08-27 while the rail
  // ticked every fifteen minutes. Each watcher exports its own; nothing in this
  // file names one.
  const usdcState = readState(arg("usdc-state", USDC_STATE));
  const usdcReport = readJson(arg("usdc-report", join(dirname(USDC_STATE), USDC_REPORT_NAME)));

  // ── THE CARD RAIL, READ LIVE (this is what makes Stage A stateless) ────────
  // With a key, the report asks Stripe itself: no cursor, no journal, nothing
  // stored, nothing to go stale. Without one, it falls back to the Stage-B
  // watcher's journal if that exists, and if neither is available it SAYS the
  // rail is unread rather than showing an empty queue — an unread rail and a
  // quiet rail are different answers and only one of them is good news.
  let stripe = { hold: [], witness: [], anomaly: [], already: [] };
  let stripeRail = { rail: "stripe (live read)", ok: false, last_run: null, note: "no STRIPE_KEY in the environment and no watcher journal on disk — the card rail was NOT read, so nothing below is a claim about card payments" };
  const journalPath = arg("stripe-journal", STRIPE_JOURNAL);
  const decided = (sessions) => stripeQueue({ journal: sessions, engine, entries, clone, households, loginHands, now });

  if (engine && process.env.STRIPE_KEY) {
    const days = Number(arg("days", COLDSTART_DAYS));
    try {
      const reader = stripeReader({
        key: process.env.STRIPE_KEY,
        apiVersion: process.env.STRIPE_API_VERSION ?? null,
        api: process.env.STRIPE_API || undefined,
      });
      const sessions = await listCompleteSessions({
        stripe: reader,
        createdGte: Math.floor(now / 1000) - days * 86_400,
      });
      // A session presented in another currency is decided from the dollars it
      // SETTLED to, read here exactly as the watcher reads them (POS-183), so
      // this page and the tick name the same dollars.
      const rows = sessions.map(decodeSession);
      const settlements = await readSettlements({ stripe: reader, rows });
      stripe = decided(rows.map((x) => ({ ...withSettlement(x, settlements), kind: "seen" })));
      stripeRail = { rail: "stripe (live read)", ok: true, last_run: new Date(now).toISOString(), note: `read live just now — ${sessions.length} completed session(s) in the last ${days} days` };
    } catch (e) {
      // A read that failed is LOUD. Reporting an empty card queue because Stripe
      // refused us is the same lie as a blind watcher reporting a quiet day.
      stripeRail = { rail: "stripe (live read)", ok: false, last_run: null, note: `the live read FAILED (${String(e?.message ?? e).slice(0, 160)}) — the card rail was NOT read` };
    }
  } else if (engine && existsSync(journalPath)) {
    // foldSettlements: a settlement the watcher read after it first journalled
    // the session rides its own `settled` row, and must reach the seen row here
    // or this page calls "unsettled" a dollar the tick has witnessed.
    stripe = decided(foldSettlements(readJournal(journalPath)).filter((r) => r.kind === "seen"));
    const st = readState(arg("stripe-state", STRIPE_STATE));
    stripeRail = railHealth("stripe-watch (journal)", st, { now });
  }

  const rails = [stripeRail, railHealth("usdc-watch", usdcState, { now })];
  const anomalyRows = anomalies({ fold, potsInvalid, stripe, usdcReport, walletInvalid, mapInvalid });
  const ready = readyToWitness({ stripe, usdcReport, date: townDay() });

  const md = render({
    now, pots, potsInvalid, fold, rails, anomalyRows, stripe, usdcReport, ready,
    registry: { addresses: byAddress.size, path: registryPath, present: registryPresent, mapped_pots: map.size },
  });

  const outPath = arg("out", null);
  if (outPath) { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, md); }
  else process.stdout.write(md);
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
  main().catch((e) => { console.error(`FATAL: ${e.stack ?? e}`); process.exit(1); });
}
