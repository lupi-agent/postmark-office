// paypal-watch.test.mjs — falsifiers for the PayPal rail's rule (POS-183 part 2).
//
//   node --test test/paypal-watch.test.mjs
//   PAYPAL_RAIL_TOWN=<town tree carrying `rail: paypal`> node --test test/paypal-watch.test.mjs
//
// The contract is stripe-watch's (the brief: "a receipt names the pot it pays,
// or it is an anomaly for the founder's hand; the payer's typed handle is
// carried, never guessed; whole settled USD only"). In order:
//
//   1. a captured order whose custom_id names an open pot and a household →
//      one witness, to that pot, from that hand; an untyped or unknown handle
//      is a gift under outside:paypal, never a guess;
//   2. a missing or unknown pot → needs-pot; a non-USD payment → not-usd; a
//      refund or reversal → named (refund), never silently dropped; a sandbox
//      payment → testmode unless a dry run allows it; a pending one waits;
//   3. inside the grace window a payment HOLDS with its plan;
//   4. the reader cuts 31-day windows, follows pages, and takes the lowest
//      last_refreshed_datetime as the cursor; a page cap that is hit is loud;
//   5. the same capture twice → one pot-receipt on the ledger, and the second
//      tick answers "already" (a real tick through the town's own epoch-close);
//   6. the CLI refuses to guess which money it reads, refuses sandbox writes,
//      and refuses a town whose grammar has no `rail: paypal`.
//
// 5 needs a town whose grammar carries `rail: paypal` (the town branch
// paypal/rail). Against the office's pinned town-clone it SKIPS and says why in
// its own title; PAYPAL_RAIL_TOWN names a town tree that carries it.
//
// PayPal is INJECTED: the fake answers the query it is handed (the window, the
// page), so an assertion about windows is about the request we send.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { CROSSING_MS } from "../src/crossings.mjs";
import { townLoginHands } from "../src/household-logins.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";
import {
  decide, decodeTransaction, resolveTransaction, listTransactions, parseCustom, customIdFor, main,
  OUTSIDE_FROM, RAIL, CUSTOM_MAX, WINDOW_DAYS,
} from "../tools/paypal-watch.mjs";

const TOWN = [townClone()].filter(Boolean).find((p) => existsSync(join(p, "tools", "stamp-mint.mjs")));
const ENGINE = TOWN ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : null;
const SKIP = !TOWN && NO_TOWN;

// ── a transaction as Transaction Search returns it (PayPal's documented shape) ─
const txn = ({ id, at, value = "10.00", currency = "USD", custom = "keep|paz", code = "T0006", status = "S", ref = null, email = "giver@example.test" }) => ({
  transaction_info: {
    paypal_account_id: "PAYERID123", transaction_id: id, transaction_event_code: code,
    transaction_initiation_date: at, transaction_updated_date: at,
    transaction_amount: { currency_code: currency, value }, transaction_status: status,
    ...(custom == null ? {} : { custom_field: custom }), ...(ref ? { paypal_reference_id: ref } : {}),
  },
  payer_info: { account_id: "PAYERID123", email_address: email },
});

// ── a throwaway town with a real, sealed ledger (stripe-watch.test.mjs's shape) ─
function seamTown({ tools = TOWN, pots = { keep: 1000 } } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const repo = mkdtempSync(join(tmpdir(), "paypal-town-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify({ paz: { login: "p", id: 2 }, stan: { login: "s", id: 1 } }));
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n- 2026-06-12 · m-1 · stan → paz · thread: new\n");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(join(repo, "ECONOMY-DIALS.json"), JSON.stringify({
    law_side: { town_issuance: { treasury_handle: "the-town", once_purposes: [] }, keeping: { sigma: 0.5, rho: 0.5, rho_constitutional_ceiling: 0.5 } } }));
  for (const [id, target] of Object.entries(pots))
    writeFileSync(join(repo, "WHITE_PAGES", `pot-${id}.json`), JSON.stringify({ pot: id, status: "open", beneficiary: "keeper", target_usd_per_epoch: target, epoch_cadence: "monthly", received_usd: 0 }));
  writeFileSync(join(repo, "WHITE_PAGES", "pot-shut.json"), JSON.stringify({ pot: "shut", status: "draft", beneficiary: null, target_usd_per_epoch: 100, epoch_cadence: "monthly", received_usd: 0 }));
  for (const f of ["stamp-mint.mjs", "epoch-close.mjs", "stamp-verify.mjs"]) writeFileSync(join(repo, "tools", f), readFileSync(join(tools, "tools", f)));
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  execFileSync(process.execPath, [join(repo, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  return { repo, keyFile };
}

const NOW = Date.parse("2026-09-29T20:00:00Z");
const DUE = "2026-09-27T12:00:00Z";            // two days old: past the grace
const FRESH = "2026-09-29T19:00:00Z";          // an hour old: inside it
function tick(transactions, { live = true, allowSandbox = false, town } = {}) {
  const entries = ENGINE.parseStampLedger(readFileSync(join(town.repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8"));
  return decide({ transactions, live, engine: ENGINE, entries, clone: town.repo, households: ENGINE.householdKeys(town.repo),
    loginHands: townLoginHands(town.repo, ENGINE), now: NOW, allowSandbox });
}

// ── 1 ───────────────────────────────────────────────────────────────────────

test("1 · a captured order naming an open pot and a household → one witness, to that pot, from that hand", { skip: SKIP }, () => {
  const town = seamTown();
  const { report, todo } = tick([txn({ id: "8MC585209K746392H", at: DUE, value: "25.00", custom: "keep|paz" })], { town });
  assert.equal(todo.length, 1);
  const w = todo[0];
  assert.deepEqual([w.pot, w.from, w.usd, w.rail, w.ref, w.attributed], ["keep", "paz", 25, RAIL, "paypal:8MC585209K746392H", true]);
  assert.equal(report.anomalies, 0);
  assert.ok(!("email" in (w.plan ?? {})) && !JSON.stringify({ pot: w.pot, from: w.from, usd: w.usd, ref: w.ref }).includes("@"), "the email never rides the row that reaches the ledger");
});

test("1 · an untyped or unknown handle is a gift under outside:paypal, never a guess; cents are disclosed", { skip: SKIP }, () => {
  const town = seamTown();
  const { todo } = tick([
    txn({ id: "GIFTNOHANDLE00001", at: DUE, value: "10.50", custom: "keep|" }),
    txn({ id: "GIFTTYPO000000002", at: DUE, value: "10.00", custom: "keep|pzz" }),
  ], { town });
  assert.deepEqual(todo.map((w) => [w.from, w.attributed, w.usd]), [[OUTSIDE_FROM, false, 10], [OUTSIDE_FROM, false, 10]]);
  assert.equal(OUTSIDE_FROM, "outside:paypal");
  assert.match(todo[0].gift_note, /no handle was given, so these dollars are witnessed as a gift under outside:paypal/);
  assert.match(todo[0].cents_note, /\$10\.50 arrived; .* remaining \$0\.50/);
  assert.match(todo[1].gift_note, /"pzz" is not a household the town knows/);
});

test("1 · custom_id is `<pot>|<handle>`, trimmed and bounded, and parses back", () => {
  assert.equal(customIdFor("darko-fund", "  paz  "), "darko-fund|paz");
  assert.equal(customIdFor("darko-fund", ""), "darko-fund|");
  assert.equal(customIdFor("keep", "x".repeat(300)).length, CUSTOM_MAX);
  assert.deepEqual(parseCustom("darko-fund|paz"), { pot: "darko-fund", handle: "paz" });
  assert.deepEqual(parseCustom("darko-fund|"), { pot: "darko-fund", handle: null });
  assert.deepEqual(parseCustom("darko-fund"), { pot: "darko-fund", handle: null });
  assert.deepEqual(parseCustom(null), { pot: null, handle: null });
  assert.deepEqual(parseCustom("keep|a|b"), { pot: "keep", handle: "a|b" }, "only the first bar splits");
});

// ── 2 ───────────────────────────────────────────────────────────────────────

test("2 · a missing pot or a pot the town does not hold open → needs-pot; a non-USD payment → not-usd", { skip: SKIP }, () => {
  const town = seamTown();
  const { report, todo } = tick([
    txn({ id: "NOPOT000000000001", at: DUE, custom: null }),
    txn({ id: "UNKNOWNPOT0000002", at: DUE, custom: "no-such-pot|paz" }),
    txn({ id: "DRAFTPOT000000003", at: DUE, custom: "shut|paz" }),
    txn({ id: "EUROS000000000004", at: DUE, value: "18.40", currency: "EUR" }),
  ], { town });
  assert.equal(todo.length, 0, "nothing is witnessed");
  const by = new Map(report.anomaly.map((a) => [a.txn, a]));
  assert.equal(by.get("NOPOT000000000001").anomaly, "needs-pot");
  assert.match(by.get("NOPOT000000000001").why, /names no pot/);
  assert.equal(by.get("UNKNOWNPOT0000002").anomaly, "needs-pot");
  assert.match(by.get("UNKNOWNPOT0000002").why, /no pot named "no-such-pot"/);
  assert.equal(by.get("DRAFTPOT000000003").anomaly, "needs-pot");
  assert.equal(by.get("EUROS000000000004").anomaly, "not-usd");
  assert.match(by.get("EUROS000000000004").why, /18\.40 EUR, not US dollars/);
});

test("2 · a refund or reversal is named, never dropped; a sandbox payment is testmode; a pending one waits; a fee decides nothing", { skip: SKIP }, () => {
  const town = seamTown();
  const { report, todo } = tick([
    txn({ id: "REFUND00000000001", at: DUE, code: "T1107", value: "-25.00", ref: "8MC585209K746392H" }),
    txn({ id: "PENDING0000000002", at: DUE, status: "P" }),
    txn({ id: "FEE00000000000003", at: DUE, code: "T0400" }),
  ], { town });
  const by = new Map(report.anomaly.map((a) => [a.txn, a]));
  assert.equal(by.get("REFUND00000000001").anomaly, "refund");
  assert.match(by.get("REFUND00000000001").why, /reverses or refunds 8MC585209K746392H/);
  assert.equal(by.get("PENDING0000000002").anomaly, "unpaid");
  assert.equal(report.skipped, 1, "the fee is journalled as not a payment, not decided");
  assert.equal(todo.length, 0);

  const sandbox = tick([txn({ id: "SANDBOX0000000001", at: DUE })], { town, live: false });
  assert.equal(sandbox.report.anomaly[0].anomaly, "testmode");
  const allowed = tick([txn({ id: "SANDBOX0000000001", at: DUE })], { town, live: false, allowSandbox: true });
  assert.equal(allowed.todo.length, 1, "a dry run may be allowed to decide sandbox money, to show the row it would write");
});

// ── 3 ───────────────────────────────────────────────────────────────────────

test("3 · inside the grace window a payment HOLDS, carrying the plan the operator can still fix", { skip: SKIP }, () => {
  const town = seamTown();
  const { report, todo } = tick([txn({ id: "FRESH000000000001", at: FRESH, custom: "keep|pzz" })], { town });
  assert.equal(todo.length, 0);
  assert.equal(report.hold.length, 1);
  const h = report.hold[0];
  assert.deepEqual([h.plan.pot, h.plan.from, h.plan.handle_typed], ["keep", OUTSIDE_FROM, "pzz"]);
  assert.equal(h.witnesses_after, new Date(Date.parse(FRESH) + CROSSING_MS).toISOString());
});

// ── 4 ───────────────────────────────────────────────────────────────────────

function fakePaypal({ transactions = [], perPage = 2, refreshed = "2026-09-29T17:00:00Z" } = {}) {
  const calls = [];
  const paypal = async (path, params) => {
    calls.push({ path, params });
    assert.equal(path, "/v1/reporting/transactions");
    const a = Date.parse(params.start_date), b = Date.parse(params.end_date);
    assert.ok(b - a <= WINDOW_DAYS * 86_400_000, "a query never spans more than 31 days");
    const inWin = transactions.filter((t) => { const at = Date.parse(t.transaction_info.transaction_initiation_date); return at >= a && at <= b; });
    const page = Number(params.page);
    return { transaction_details: inWin.slice((page - 1) * perPage, page * perPage), total_pages: Math.max(1, Math.ceil(inWin.length / perPage)), last_refreshed_datetime: refreshed, page };
  };
  return { paypal, calls };
}

test("4 · the reader cuts 31-day windows, follows every page, dedupes, and takes PayPal's own index time as the cursor", async () => {
  const at = (d) => `2026-${d}T12:00:00Z`;
  const { paypal, calls } = fakePaypal({ transactions: [
    txn({ id: "A", at: at("08-05") }), txn({ id: "B", at: at("08-06") }), txn({ id: "C", at: at("08-07") }),
    txn({ id: "D", at: at("09-20") }), txn({ id: "E", at: at("09-21") }),
  ] });
  const out = await listTransactions({ paypal, startMs: Date.parse("2026-08-01T00:00:00Z"), endMs: Date.parse("2026-09-29T00:00:00Z"), pageSize: 2 });
  assert.deepEqual(out.rows.map((t) => t.transaction_info.transaction_id), ["A", "B", "C", "D", "E"]);
  assert.ok(calls.length >= 3, "two windows, and the first one's second page");
  assert.equal(new Set(calls.map((c) => c.params.start_date)).size, 2);
  assert.equal(new Date(out.last_refreshed).toISOString(), "2026-09-29T17:00:00.000Z");
  // the cursor is the index's time, not the newest payment seen
  const d = decide({ transactions: [], lastRefreshed: out.last_refreshed, live: true, engine: { foldPotReceipts: () => ({ receipts: [] }) }, entries: [], clone: null, households: new Set(), now: NOW });
  assert.equal(new Date(d.cursor).toISOString(), "2026-09-29T17:00:00.000Z");
});

test("4 · a page cap that is hit is a loud refusal, never a silent truncation", async () => {
  const many = Array.from({ length: 7 }, (_, i) => txn({ id: `P${i}`, at: `2026-09-2${i}T12:00:00Z` }));
  const { paypal } = fakePaypal({ transactions: many, perPage: 2 });
  await assert.rejects(listTransactions({ paypal, startMs: Date.parse("2026-09-15T00:00:00Z"), endMs: Date.parse("2026-09-29T00:00:00Z"), pageSize: 2, maxPages: 2 }),
    /stopped after 2 pages .* nothing was decided from a partial read/);
});

// ── 5 · the same capture twice, through the town's own epoch-close ──────────

const RAIL_TOWN = [process.env.PAYPAL_RAIL_TOWN, TOWN].filter(Boolean)
  .find((p) => existsSync(join(p, "tools", "stamp-mint.mjs")) && readFileSync(join(p, "tools", "stamp-mint.mjs"), "utf8").includes("'paypal'"));

function fetchFor(transactions) {
  return async (url, init = {}) => {
    const u = new URL(url);
    const body = u.pathname === "/v1/oauth2/token"
      ? { access_token: "not-a-real-token", expires_in: 3600 }
      : { transaction_details: transactions.filter((t) => { const at = Date.parse(t.transaction_info.transaction_initiation_date); return at >= Date.parse(u.searchParams.get("start_date")) && at <= Date.parse(u.searchParams.get("end_date")); }), total_pages: 1, last_refreshed_datetime: "2026-09-29T19:30:00Z" };
    return { ok: true, status: 200, json: async () => body };
  };
}

test("5 · the same capture twice → ONE pot-receipt on the ledger; the second tick answers already",
  { skip: RAIL_TOWN ? false : "no town with `rail: paypal` in its grammar yet (the town branch paypal/rail); set PAYPAL_RAIL_TOWN to a town tree that carries it" },
  async () => {
    const town = seamTown({ tools: RAIL_TOWN });
    const git = (...a) => execFileSync("git", ["-C", town.repo, ...a], { encoding: "utf8" });
    git("init", "-q"); git("add", "-A"); git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed");
    const state = join(town.repo, "state.json");
    const journal = join(town.repo, "intake.jsonl");
    const fed = [txn({ id: "5O190127TN364715T", at: DUE, value: "25.00", custom: "keep|paz" })];
    const env = { PAYPAL_CLIENT_ID: "id", PAYPAL_SECRET: "secret", PAYPAL_ENV: "live" };
    const saved = { STAMP_KEY: process.env.STAMP_KEY, TOWN_PUSH: process.env.TOWN_PUSH };
    Object.assign(process.env, { STAMP_KEY: town.keyFile, TOWN_PUSH: "" });
    try {
      const out1 = [];
      const a = await main(["--clone", town.repo, "--state", state, "--journal", journal], { fetchImpl: fetchFor(fed), env, now: NOW, log: (s) => out1.push(s), err: (s) => out1.push(`ERR ${s}`) });
      assert.equal(a, 0, out1.join("\n"));
      const rows = readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l));
      const w = rows.find((r) => r.kind === "witnessed");
      assert.ok(w, `the tick witnessed it (journal: ${rows.map((r) => `${r.kind}${r.defect ? `: ${r.defect}` : ""}`).join(" | ")})`);
      const ledger = () => readFileSync(join(town.repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8").split("\n").filter((l) => l.includes("ref: paypal:5O190127TN364715T"));
      assert.equal(ledger().length, 1);
      assert.match(ledger()[0], /pot-receipt · pot:keep · rail: paypal · usd: 25 · from: paz · ref: paypal:5O190127TN364715T/);

      // The second tick RE-READS the same capture (a sweep from before it), so the
      // answer is the LEDGER's dedupe, not the cursor having moved past it.
      const out2 = [];
      const b = await main(["--clone", town.repo, "--state", state, "--journal", journal, "--json", "--since", "2026-09-20T00:00:00Z"], { fetchImpl: fetchFor(fed), env, now: NOW, log: (s) => out2.push(s), err: (s) => out2.push(`ERR ${s}`) });
      assert.equal(b, 0, out2.join("\n"));
      const second = JSON.parse(out2.join("\n"));
      assert.deepEqual(second.already.map((x) => [x.txn, x.pot, x.from, x.usd_recorded]), [["5O190127TN364715T", "keep", "paz", 25]]);
      assert.equal(second.witnessed_now, 0);
      assert.equal(ledger().length, 1, "the same capture was written twice");
      const verify = execFileSync(process.execPath, [join(town.repo, "tools", "stamp-verify.mjs"), "--repo", town.repo], { encoding: "utf8" });
      assert.match(verify, /verifies/);
    } finally {
      for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
      rmSync(town.repo, { recursive: true, force: true, maxRetries: 3 });
    }
  });

// ── 6 ───────────────────────────────────────────────────────────────────────

test("6 · the CLI refuses to guess which money it reads, refuses sandbox writes, and refuses a town with no `rail: paypal`", { skip: SKIP }, async () => {
  const town = seamTown();
  const say = async (argv, env) => { const out = []; const code = await main(argv, { fetchImpl: fetchFor([]), env, now: NOW, log: (s) => out.push(s), err: (s) => out.push(s) }); return { code, out: out.join("\n") }; };
  const base = ["--clone", town.repo, "--state", join(town.repo, "s.json"), "--journal", join(town.repo, "j.jsonl")];
  const guess = await say(base, { PAYPAL_CLIENT_ID: "id", PAYPAL_SECRET: "s" });
  assert.equal(guess.code, 1);
  assert.match(guess.out, /PAYPAL_ENV must be live or sandbox/);
  const writes = await say([...base, "--allow-sandbox"], { PAYPAL_CLIENT_ID: "id", PAYPAL_SECRET: "s", PAYPAL_ENV: "sandbox" });
  assert.equal(writes.code, 1);
  assert.match(writes.out, /--allow-sandbox is for a --dry-run only/);
  if (!ENGINE.KEEPING_RAILS?.includes("paypal")) {
    const old = await say([...base, "--dry-run"], { PAYPAL_CLIENT_ID: "id", PAYPAL_SECRET: "s", PAYPAL_ENV: "live" });
    assert.equal(old.code, 1);
    assert.match(old.out, /has no `rail: paypal` in its grammar yet/);
  }
  const noKey = await say([...base, "--dry-run"], { PAYPAL_ENV: "live" });
  assert.equal(noKey.code, 1);
  assert.ok(/PAYPAL_CLIENT_ID|rail: paypal/.test(noKey.out), noKey.out);
});

test("decode: the transaction's own fields, the email kept for the journal only", () => {
  const s = decodeTransaction(txn({ id: "X1", at: DUE, value: "12.34", custom: "keep|paz" }), { live: true });
  assert.deepEqual([s.txn, s.receipt_ref, s.amount_cents, s.currency, s.pot_named, s.handle_typed, s.status, s.event_code, s.live],
    ["X1", "paypal:X1", 1234, "usd", "keep", "paz", "S", "T0006", true]);
  assert.equal(s.email, "giver@example.test");
  const r = resolveTransaction({ ...s, txn: "" }, { engine: { foldPotReceipts: () => ({ receipts: [] }) }, entries: [], now: NOW });
  assert.equal(r.anomaly, "malformed");
});
