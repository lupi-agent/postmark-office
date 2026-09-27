// stripe-watch-held-behind-cursor.test.mjs — THE HOLD THE CURSOR FORGOT.
//
//   node --test test/stripe-watch-held-behind-cursor.test.mjs
//
// ── THE FAILURE THIS RETIRES (postmark#2973, 2026-09-19) ────────────────────
//
// Session `stripe:cs_live_a1SNa9Fw…` — $10.28 to `keeping-ec2`, handle typed
// `soren`, paid, created 2026-09-16T01:09Z — has a `seen` row in
// /srv/postmark-stripe/stripe-intake.jsonl at 01:22Z and no `witnessed` row
// three days later. Every tick since reports
//
//   "1 completed session(s) since … · witnessed now: 0 · holding: 0 ·
//    already on the ledger: 1"
//
// and `holding: 0` is printed over a row the journal itself remembers as
// seen-and-unwitnessed. `tools/funding-report.mjs` re-decides the same session
// today as READY TO WITNESS. The report and the watcher disagreed, and the
// report was right.
//
// THE MECHANISM IS ONE LINE OF THE TICK. `main()` lists from `state.cursor` and
// `decide()` returns `max(created)` over that listing. The payer's LATER session
// (soren's $10 to `darko-fund`) shared the listing, so the cursor stepped past
// the held one, and `created[gte]=cursor` never returns it again. The header's
// promise — "the journal remembers what was SEEN; the ledger decides what was
// DONE" — held for dedupe and not for re-decision: nothing re-read the journal.
//
// THE CURSOR IS FOR FINDING NEW SESSIONS, NOT FOR REMEMBERING HELD ONES. Each
// tick now also re-decides every journal row that is `seen` with no `witnessed`
// row, independent of the cursor — which is exactly what `stripeQueue` in
// funding-report.mjs has always done, so the fix makes the two agree rather
// than adding a second rule.
//
// ── WHAT EACH CASE IS FOR ───────────────────────────────────────────────────
//
//   F1  the bug itself: a seen-unwitnessed row older than the cursor, an EMPTY
//       live listing, and the tick must decide it. RED at the train tip.
//   F2  the second lock: a session with a `witnessed` row is not re-decided at
//       all. The ledger's ref-uniqueness would bounce a double-witness, but the
//       watcher must not even try.
//   F3  the non-regression: the cursor still finds new sessions and still
//       advances over them. The bug is a cursor bug; fixing it must not be a
//       second cursor change.
//   F4  the freshness: when a session is in BOTH the live listing and the
//       journal, the LIVE decode wins. A journal row is a snapshot of the
//       session as it was FIRST seen — `payment_status` can still move from
//       unpaid to paid — so a journal row that shadowed the live read would
//       freeze a session at the moment it was worst understood. Green at the
//       tip (there is no journal read at all there); it is a pin on the shape
//       of the fix, and its flip is "let the journal win".

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

import { CROSSING_MS } from "../src/crossings.mjs";
import { HANDLE_FIELD, decodeSession } from "../tools/stripe-watch.mjs";
import { NO_TOWN, townClone } from "./fixture-paths.mjs";
// `unwitnessedSeen` is imported inside F5 rather than here ON PURPOSE. A static
// import of a symbol the train tip does not export is a LOAD error, and a load
// error reds every case in the file for a reason none of them is about — the
// base measurement would then say nothing about F1 at all. Each case must be
// able to fail for its own reason.

// execFileSync blocks the event loop, so the in-process fake Stripe could never
// accept the child's connection — the lesson stripe-watch-cli.test.mjs paid for.
const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "tools", "stripe-watch.mjs");
const TOWN = [townClone()].filter(Boolean)
  .find((p) => existsSync(join(p, "tools", "stamp-mint.mjs")));
const SKIP = !TOWN && NO_TOWN;

const KEY = "rk_test_thisisnotarealkey";
const HELD = "cs_test_held1111111111111111111";
const NEWER = "cs_test_newer222222222222222222";

// The shutdown is registered the instant the server exists, never called on the
// success path only: a test that cleans up only when it passes stops being a
// test the moment it fails, and takes the suite with it.
function fakeStripe(sessions, t) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ object: "list", data: sessions, has_more: false }));
  });
  if (t) t.after(() => { server.closeAllConnections?.(); server.close(); });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done({ server, seen, port: server.address().port })));
}

function seamTown() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const repo = mkdtempSync(join(tmpdir(), "stripe-held-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify({ paz: { login: "p", id: 2 } }));
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n- 2026-06-12 · m-1 · paz → paz · thread: new\n");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(join(repo, "ECONOMY-DIALS.json"), JSON.stringify({
    law_side: { town_issuance: { treasury_handle: "the-town", once_purposes: [] }, keeping: { sigma: 0.5, rho: 0.5, rho_constitutional_ceiling: 0.5 } },
  }));
  writeFileSync(join(repo, "WHITE_PAGES", "pot-keep.json"), JSON.stringify({ pot: "keep", status: "open", beneficiary: "keeper", target_usd_per_epoch: 1000, epoch_cadence: "monthly", received_usd: 0 }));
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  for (const f of ["stamp-mint.mjs", "epoch-close.mjs"])
    writeFileSync(join(repo, "tools", f), readFileSync(join(TOWN, "tools", f)));
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  return { repo, keyFile };
}

// Old enough that the twelve-hour grace has passed — a held session that has
// come due is the only kind the cursor can strand where it matters.
const DUE = Math.floor((Date.now() - 2 * CROSSING_MS) / 1000);

const session = (over = {}) => ({
  id: HELD, object: "checkout.session", status: "complete", payment_status: "paid", livemode: true,
  created: DUE, amount_total: 1028, currency: "usd",
  client_reference_id: "keep", customer_details: { email: "held@example.test" },
  custom_fields: [{ key: HANDLE_FIELD, type: "text", text: { value: "paz" } }],
  payment_intent: "pi_held", ...over,
});

const seenRow = (raw, at = "2026-09-16T01:22:00Z") => ({ kind: "seen", at, ...decodeSession(raw) });

/** A town, a journal, a state file, and a fake Stripe — one tick's worth. */
async function tick({ live = [], journal = [], cursor, t }) {
  const { port, seen } = await fakeStripe(live, t);
  const town = seamTown();
  const statePath = join(town.repo, "state.json");
  const journalPath = join(town.repo, "intake.jsonl");
  writeFileSync(statePath, JSON.stringify({ cursor, last_run: "2026-09-18T15:26:07.000Z" }, null, 2) + "\n");
  if (journal.length) writeFileSync(journalPath, journal.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const { stdout } = await run(process.execPath, [
    CLI, "--dry-run", "--json", "--clone", town.repo, "--state", statePath, "--journal", journalPath,
  ], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, STRIPE_KEY: KEY, STRIPE_API: `http://127.0.0.1:${port}/v1`, TOWN_CLONE: "" },
  });
  return { report: JSON.parse(stdout), state: JSON.parse(readFileSync(statePath, "utf8")), seen, town, statePath, journalPath };
}

test("F1 · a seen-unwitnessed row BEHIND the cursor is decided, though the live listing is empty", { skip: SKIP }, async (t) => {
  const raw = session();
  const { report } = await tick({ live: [], journal: [seenRow(raw)], cursor: DUE + 3600, t });

  // The live listing really was empty, and the sentence the CLI prints about it
  // stays true: `sessions` counts what Stripe returned, not what the journal
  // remembered. A fix that inflated this number would make the tick's own
  // headline read as a second Stripe read that never happened.
  assert.equal(report.sessions, 0, "the live listing is empty — the cursor stands past the held session");

  // THE BUG, ASSERTED FIRST. At the train tip this is the line that reds, and it
  // is the issue's own sentence: the journal remembers the row, the ledger has
  // never seen it, and the tick decides nothing.
  assert.equal(report.witness.length, 1, "it has come due, so the tick witnesses it rather than leaving it forever");
  assert.equal(report.witness[0].session, HELD);
  assert.equal(report.witness[0].pot, "keep");
  assert.equal(report.witness[0].from, "paz");
  assert.equal(report.holding, 0, "it is past its grace; `holding: 0` is now true rather than blind");
  assert.equal(report.rechecked, 1, "and the tick SAYS it re-read the journal, so the operator can tell the two reads apart");
});

test("F2 · a session the journal already recorded as witnessed is not re-decided at all", { skip: SKIP }, async (t) => {
  const raw = session();
  const journal = [
    seenRow(raw),
    { kind: "witnessed", at: "2026-09-16T13:22:00Z", session: HELD, ref: `stripe:${HELD}`, pot: "keep", from: "paz", usd: 10 },
  ];
  const { report } = await tick({ live: [], journal, cursor: DUE + 3600, t });

  // The BEHAVIOUR first — true at the train tip too, because nothing there
  // reads the journal at all. This case is a pin on the fix's shape, not a
  // reproduction of the bug, and it reds at the tip only on the last line.
  assert.equal(report.witness.length, 0);
  // and not smuggled in under another bucket either
  assert.equal(report.holding, 0);
  assert.equal(report.anomalies, 0);
  assert.equal(report.already.length, 0);
  assert.equal(report.rechecked, 0, "the watcher does not even TRY a session it already witnessed");
});

test("F3 · the cursor still finds NEW sessions and still advances over them", { skip: SKIP }, async (t) => {
  const fresh = session({ id: NEWER, created: DUE + 7200, payment_intent: "pi_newer" });
  const { report, state, seen } = await tick({ live: [fresh], journal: [], cursor: DUE, t });

  assert.equal(report.sessions, 1, "the listing is still the way new sessions arrive");
  assert.match(seen[0].url, /created%5Bgte%5D=/, "and it is still asked for from the cursor");
  assert.equal(state.cursor, fresh.created, "the cursor still steps to the newest session Stripe showed");
  assert.equal(report.witness.length, 1);
  assert.equal(report.witness[0].session, NEWER);
});

test("F4 · a session in BOTH the listing and the journal is decided from the LIVE read, not the snapshot", { skip: SKIP }, async (t) => {
  // The journal remembers it as it was first seen — unpaid. Stripe says paid
  // now. A journal row that won here would freeze every session at the moment
  // it was worst understood, which is the bug this file retires, one layer down.
  const raw = session();
  const stale = seenRow({ ...raw, payment_status: "unpaid" });
  const { report } = await tick({ live: [raw], journal: [stale], cursor: DUE - 1, t });

  assert.equal(report.sessions, 1);
  assert.equal(report.anomalies, 0, "the stale `unpaid` snapshot did not shadow the live `paid`");
  assert.equal(report.witness.length, 1);
  assert.equal(report.witness[0].payment_status, "paid");
  assert.equal(report.rechecked, 0, "the live listing already carries it — there is nothing to re-decide");
});

test("F5 · unwitnessedSeen is the whole rule, and it is pure", { skip: SKIP }, async () => {
  const { unwitnessedSeen } = await import("../tools/stripe-watch.mjs");
  assert.equal(typeof unwitnessedSeen, "function", "the tick's journal rule is exported, so it can be read and tested on its own");
  const rows = [
    { kind: "seen", session: "a" },
    { kind: "seen", session: "b" },
    { kind: "witnessed", session: "a" },
    { kind: "seen", session: "b" },       // a re-seen boundary second, journalled once elsewhere
    { kind: "refused", session: "c" },
    { kind: "seen", session: "c" },
    { malformed: "a torn line is not a session" },
  ];
  assert.deepEqual(unwitnessedSeen(rows).map((r) => r.session), ["b", "c"],
    "witnessed drops out; a REFUSED one stays, because its ref is unspent and the next tick tries again");
  assert.deepEqual(unwitnessedSeen([]), []);
});
