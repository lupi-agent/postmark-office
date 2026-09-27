// stripe-watch-cli.test.mjs — the glue, run for real.
//
// Everything the rule does is pure and has its own falsifiers in
// test/stripe-watch.test.mjs. This file exists because none of that is what the
// box runs: the box runs `node tools/stripe-watch.mjs` with an env file, and the
// path from environment to reader to pages to journal to state has no test at
// all unless the CLI is actually executed. A green suite over a pure core and an
// unrun main is a suite that proves the arithmetic and not the machine.
//
// So Stripe here is a REAL HTTP SERVER on a real port, and the watcher is a real
// child process reading a real env. It records what the request carried, which
// is how the auth-header assertion below can mean anything.

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HANDLE_FIELD } from "../tools/stripe-watch.mjs";
import { tmpdir } from "node:os";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { NO_TOWN, townClone } from "./fixture-paths.mjs";

// execFileSync BLOCKS THE EVENT LOOP, so the in-process fake Stripe below could
// never accept the child's connection and every run died on the fetch timeout.
// The test's own apparatus needed its own falsifier: the first version of this
// file hung for twenty seconds per case and proved nothing about the CLI.
const run = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "tools", "stripe-watch.mjs");
const TOWN = [townClone()].filter(Boolean)
  .find((p) => existsSync(join(p, "tools", "stamp-mint.mjs")));
const SKIP = !TOWN && NO_TOWN;

const KEY = "rk_test_thisisnotarealkey";
const CS = "cs_test_cli111111111111111111111";

// ── WHY THE SHUTDOWN IS REGISTERED AND NOT CALLED (2026-09-05) ──────────────
//
// This file used to hang the whole suite, and the reason was not a wait — it was
// a HANDLE. `server.close()` was called in the middle of each test body, on the
// success path only, so any assertion that threw before that line left a socket
// LISTENING. Node then had a live handle and would not exit: the four tests all
// finished in under a second, the summary printed, and the process sat there
// until something killed it. `--test-timeout` cannot bound that, and correctly
// so — nothing was slow. It is the exit that never comes.
//
// Measured on 2026-09-05 at the train tip: 4 tests, 3 pass, 1 fail, every case
// under 500ms, `duration_ms 149994` — the 150-second bound I put around it, not
// work. The failure that leaked the handle was itself real (the town mint's main
// guard exits 0 in silence under a junction, so no ledger was written and the
// read of it threw ENOENT) — which is the whole shape of the trap: A TEST THAT
// ONLY CLEANS UP WHEN IT PASSES STOPS BEING A TEST THE MOMENT IT FAILS, and
// takes the suite with it.
//
// So the shutdown is registered with the runner the instant the server exists,
// which is the only arrangement that survives a throw. `closeAllConnections`
// goes first because `close()` alone waits out keep-alive sockets, and a
// shutdown that waits is the thing being removed.
//
// This is the same lesson the header above already records once — "the test's
// own apparatus needed its own falsifier" — reached a second time from the other
// side. The apparatus is not exempt from the discipline it exists to apply.
function fakeStripe(sessions, t) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ object: "list", data: sessions, has_more: false }));
  });
  if (t) {
    t.after(() => { server.closeAllConnections?.(); server.close(); });
  }
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done({ server, seen, port: server.address().port })));
}

function seamTown() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const repo = mkdtempSync(join(tmpdir(), "stripe-cli-"));
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
  // the town's own tools, so the CLI's townEngine() finds a real seam
  for (const f of ["stamp-mint.mjs", "epoch-close.mjs"])
    writeFileSync(join(repo, "tools", f), readFileSync(join(TOWN, "tools", f)));
  return { repo, keyFile };
}

const session = (over = {}) => ({
  id: CS, object: "checkout.session", status: "complete", payment_status: "paid", livemode: true,
  created: Math.floor(Date.now() / 1000) - 60, amount_total: 1000, currency: "usd",
  client_reference_id: "keep", customer_details: { email: "cli@example.test" },
  // key mirrors the LIVE payment link's field (dashboard-assigned "description",
  // read off the API 2026-08-25) — the fixture must speak the key reality speaks,
  // and HANDLE_FIELD is imported below so this cannot silently diverge again.
  custom_fields: [{ key: HANDLE_FIELD, type: "text", text: { value: "paz" } }],
  payment_intent: "pi_cli", ...over,
});

test("the CLI runs end to end: env → reader → pages → journal → state, and writes no ledger row", { skip: SKIP }, async (t) => {
  // ONE session object, fed and then asserted against. `session()` derives
  // `created` from `Date.now()` at second resolution, so calling it a second
  // time at assert time asks a different question of the clock — and the answer
  // differs whenever the run crosses a second boundary.
  const fed = session();
  const { seen, port } = await fakeStripe([fed], t);
  const town = seamTown();
  const state = join(town.repo, "state.json");
  const journal = join(town.repo, "intake.jsonl");
  const ledger = join(town.repo, "WHITE_PAGES", "stamp-ledger.md");
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", town.keyFile, "--repo", town.repo], { encoding: "utf8" });
  const before = readFileSync(ledger, "utf8");

  const { stdout: out } = await run(process.execPath, [
    CLI, "--dry-run", "--json", "--clone", town.repo, "--state", state, "--journal", journal,
  ], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, STRIPE_KEY: KEY, STRIPE_API: `http://127.0.0.1:${port}/v1`, TOWN_CLONE: "" },
  });

  const report = JSON.parse(out);
  assert.equal(report.sessions, 1);
  // the session is a minute old, so it is HELD — and the held row carries the
  // plan, which is the operator's whole window
  assert.equal(report.holding, 1);
  assert.equal(report.hold[0].plan.pot, "keep");
  assert.equal(report.hold[0].plan.from, "paz");

  // THE AUTH HEADER ACTUALLY WENT. A watcher that forgot it would 401 on the box
  // and there would be nothing in this suite to notice.
  assert.equal(seen[0].auth, `Bearer ${KEY}`);
  assert.match(seen[0].url, /status=complete/);
  assert.match(seen[0].url, /created%5Bgte%5D=/);

  // the journal is real, append-only, and holds what the operator needs
  const rows = readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "seen");
  assert.equal(rows[0].session, CS);
  assert.equal(rows[0].email, "cli@example.test");
  assert.equal(rows[0].handle_typed, "paz");

  // the cursor advanced, and the ledger did not move
  assert.equal(JSON.parse(readFileSync(state, "utf8")).cursor, fed.created);
  assert.equal(readFileSync(ledger, "utf8"), before);
});

test("a second run journals the SAME session once — the journal is append-only, not append-again", { skip: SKIP }, async (t) => {
  const { port } = await fakeStripe([session()], t);
  const town = seamTown();
  const state = join(town.repo, "state.json");
  const journal = join(town.repo, "intake.jsonl");
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", town.keyFile, "--repo", town.repo], { encoding: "utf8" });
  const env = { ...process.env, STRIPE_KEY: KEY, STRIPE_API: `http://127.0.0.1:${port}/v1`, TOWN_CLONE: "" };
  const args = [CLI, "--dry-run", "--json", "--clone", town.repo, "--state", state, "--journal", journal];

  await run(process.execPath, args, { encoding: "utf8", env });
  await run(process.execPath, args, { encoding: "utf8", env });

  const rows = readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.filter((r) => r.kind === "seen").length, 1, "the boundary second is re-read and the session is re-seen, but journalled once");
});

// A Stripe that ROUTES: the listing at /v1/checkout/sessions, and one payment
// intent at /v1/payment_intents/<id>, answered expanded only when the request
// asked for the expansion — so the assertion on what the CLI sent means
// something. Shut down the same way as fakeStripe, for the same reason.
function routedStripe({ sessions, intents }, t) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader("content-type", "application/json");
    const u = new URL(req.url, "http://x");
    const m = u.pathname.match(/^\/v1\/payment_intents\/([^/]+)$/);
    if (m) {
      const pi = intents[decodeURIComponent(m[1])];
      if (!pi) { res.statusCode = 404; return res.end(JSON.stringify({ error: { message: "No such payment_intent" } })); }
      const expanded = u.searchParams.get("expand[]") === "latest_charge.balance_transaction";
      return res.end(JSON.stringify(expanded ? pi : { ...pi, latest_charge: pi.latest_charge.id }));
    }
    res.end(JSON.stringify({ object: "list", data: sessions, has_more: false }));
  });
  if (t) t.after(() => { server.closeAllConnections?.(); server.close(); });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done({ server, seen, port: server.address().port })));
}

test("POS-183 · the CLI reads a EUR session's SETTLED dollars off its balance transaction and journals the settlement", { skip: SKIP }, async (t) => {
  // LAW (tools/stripe-watch.mjs, the header, verbatim): "`usd:` from the
  //     balance transaction, whole dollars, cents disclosed as they always
  //     were." Driven through the entrypoint the box runs, not the pure core.
  const due = Math.floor(Date.now() / 1000) - 2 * 86_400;
  const fed = session({ created: due, amount_total: 1840, currency: "eur", payment_intent: "pi_eur" });
  const intents = { pi_eur: { id: "pi_eur", object: "payment_intent", latest_charge: { id: "ch_eur", object: "charge", balance_transaction: { id: "txn_eur", object: "balance_transaction", amount: 2013, currency: "usd" } } } };
  const { seen, port } = await routedStripe({ sessions: [fed], intents }, t);
  const town = seamTown();
  const state = join(town.repo, "state.json");
  const journal = join(town.repo, "intake.jsonl");
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", town.keyFile, "--repo", town.repo], { encoding: "utf8" });

  const { stdout } = await run(process.execPath, [
    CLI, "--dry-run", "--json", "--clone", town.repo, "--state", state, "--journal", journal,
  ], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, STRIPE_KEY: KEY, STRIPE_API: `http://127.0.0.1:${port}/v1`, TOWN_CLONE: "" },
  });
  const report = JSON.parse(stdout);

  const read = seen.find((s) => s.url.startsWith("/v1/payment_intents/pi_eur"));
  assert.ok(read, "the CLI asked Stripe for the payment intent");
  assert.match(read.url, /expand%5B%5D=latest_charge\.balance_transaction/, "with the expansion down to the balance transaction");
  assert.equal(read.auth, `Bearer ${KEY}`);

  assert.equal(report.anomalies, 0, "no longer `not-usd` for the founder's hand");
  assert.equal(report.witness.length, 1);
  assert.equal(report.witness[0].usd, 20, "the settled whole dollars");
  assert.deepEqual(report.witness[0].presented, { currency: "eur", amount: 1840 });

  const rows = readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "seen");
  assert.deepEqual(rows[0].settled, { balance_transaction: "txn_eur", currency: "usd", amount: 2013 },
    "the settlement is journalled, so the funding report reads the same dollars with no key");

  // THE BOUNDARY SECOND, again: the cursor is inclusive, so the next tick
  // re-lists this session. Its settlement is remembered, not re-read.
  const reads = () => seen.filter((s) => s.url.startsWith("/v1/payment_intents/")).length;
  assert.equal(reads(), 1);
  const { stdout: again } = await run(process.execPath, [
    CLI, "--dry-run", "--json", "--clone", town.repo, "--state", state, "--journal", journal,
  ], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, STRIPE_KEY: KEY, STRIPE_API: `http://127.0.0.1:${port}/v1`, TOWN_CLONE: "" },
  });
  assert.equal(JSON.parse(again).witness[0].usd, 20, "decided from the remembered settlement");
  assert.equal(reads(), 1, "a settlement the journal already holds is never asked for twice");
  assert.equal(readFileSync(journal, "utf8").trim().split("\n").length, 1, "and nothing new is journalled");
});

test("POS-183 · a real tick WITNESSES the settled dollars: the ledger row says 20, the journal row carries `presented`", { skip: SKIP }, async (t) => {
  // No --dry-run: the whole path the box runs, through penRecorder, fund-exec
  // and the town's own epoch-close, into a throwaway git town. TOWN_PUSH is
  // unset, so nothing leaves the temp directory.
  const due = Math.floor(Date.now() / 1000) - 2 * 86_400;
  const fed = session({ created: due, amount_total: 1840, currency: "eur", payment_intent: "pi_eur" });
  const intents = { pi_eur: { id: "pi_eur", object: "payment_intent", latest_charge: { id: "ch_eur", object: "charge", balance_transaction: { id: "txn_eur", object: "balance_transaction", amount: 2013, currency: "usd" } } } };
  const { port } = await routedStripe({ sessions: [fed], intents }, t);
  const town = seamTown();
  const state = join(town.repo, "state.json");
  const journal = join(town.repo, "intake.jsonl");
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", town.keyFile, "--repo", town.repo], { encoding: "utf8" });
  const git = (...a) => execFileSync("git", ["-C", town.repo, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed");

  await run(process.execPath, [CLI, "--json", "--clone", town.repo, "--state", state, "--journal", journal], {
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, STRIPE_KEY: KEY, STRIPE_API: `http://127.0.0.1:${port}/v1`, TOWN_CLONE: "", STAMP_KEY: town.keyFile, TOWN_PUSH: "" },
  });

  const rows = readFileSync(journal, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const w = rows.find((r) => r.kind === "witnessed");
  assert.ok(w, `the tick witnessed it (journal: ${rows.map((r) => r.kind).join(", ")}${rows.find((r) => r.kind === "refused")?.defect ? ` — ${rows.find((r) => r.kind === "refused").defect}` : ""})`);
  assert.equal(w.usd, 20);
  assert.deepEqual(w.presented, { currency: "eur", amount: 1840 });
  assert.deepEqual(w.settled, { balance_transaction: "txn_eur", currency: "usd", amount: 2013 });
  assert.match(w.line, /usd: 20\b/, "the ledger line the town signed carries the settled dollars");
  const ledger = readFileSync(join(town.repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
  assert.ok(ledger.includes(`stripe:${CS}`));
  assert.ok(!/eur|1840/i.test(ledger), "the presentment never reaches the public ledger");
});

test("no key is a loud refusal, not a quiet empty tick", { skip: SKIP }, async () => {
  const town = seamTown();
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", town.keyFile, "--repo", town.repo], { encoding: "utf8" });
  let err = null;
  try {
    await run(process.execPath, [CLI, "--dry-run", "--clone", town.repo, "--state", join(town.repo, "s.json")], {
      encoding: "utf8", env: { ...process.env, STRIPE_KEY: "", TOWN_CLONE: "" },
    });
  } catch (e) { err = e; }
  assert.ok(err, "it exits non-zero");
  assert.match(String(err.stderr), /no STRIPE_KEY/);
});

test("no town clone with the funding seam is a loud refusal too", { skip: SKIP }, async () => {
  const bare = mkdtempSync(join(tmpdir(), "no-seam-"));
  let err = null;
  try {
    await run(process.execPath, [CLI, "--dry-run", "--clone", bare, "--state", join(bare, "s.json")], {
      encoding: "utf8", env: { ...process.env, STRIPE_KEY: KEY, TOWN_CLONE: "" },
    });
  } catch (e) { err = e; }
  assert.ok(err);
  assert.match(String(err.stderr), /no town clone with the funding seam/);
  assert.match(String(err.stderr), /never its own parse/);
});
