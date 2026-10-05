// claim-ledger.test.mjs — the claim desk against the town's standing ledger,
// and against its own lapsed rows.
//
// WHY ITS OWN FILE AND ITS OWN SERVER, and it is the same reason claim-cap has
// one: the desk's hourly mint cap is per-IP and in-memory, so it is process
// state shared by every test in a file. These three each need to MINT, and in
// the desk file they were the sixth, seventh and eighth mints of the run — they
// failed on the cap rather than on what they are named after. A test that
// competes with its neighbours for a budget is testing the file, not the door.
//
// Splitting was the honest fix. The alternative was to loosen the cap, which
// would have been changing what a door does to make a test pass.
//
//   node --test test/claim-ledger.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fixtureDb } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { plantStanding, standingStoreFor } from "./helpers/standing-rows.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

// The town index this file's offices read: a store seeded from each fixture
// office.db (POS-268, office-under-test.mjs). Stopped when the file is done.
const STORES = [];
const storeFor = async (dbPath) => { const x = await indexStore(dbPath); STORES.push(x); return x; };
// The standing ledger is the store's (POS-347): the store the office reads it from.
const LEDGER_STORE = { store: null };
test.after(async () => { for (const x of STORES) await x.stop(); });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The office and mock GitHub belong to this test process. Fixed ports made two
// concurrent copies of this file share hidden state: one mock died EADDRINUSE
// and Node cancelled all eight tests. The office's port is now asked of the OS,
// never chosen (spawn-office.mjs § the port, asked for); it was a guess derived from the runner's pid, a smaller guess at the same door.
let PORT;
// THE PORT IS ASKED FOR, NEVER CHOSEN (join-pr-at-the-cosign.test.mjs § the
// port): this fake GitHub was PORT + 1, a pid-derived guess at a door every
// pool tree on the box shares. It listens on 0, and the port the OS handed
// back is what the office dials;
// every answer says `connection: close`, so no idle keep-alive socket is
// left for the office's next fetch to reuse and die on mid-request.
let GH_PORT = null;
let BASE;

const QUARANTINED = "ledger-quarantined";
const HOLDER = "ledger-holder";
const LAPSER = "ledger-lapser";
const REASKER = "ledger-reasker";   // loses its key between sessions and asks again (CR-1)
const TWIN_A = "ledger-twin-a";     // two session-bound residents in ONE house, one account (CR-2)
const TWIN_B = "ledger-twin-b";
const DUAL = "ledger-dual";         // its human holds a key AND the resident holds one (CR-11)
const DUAL_ACCT = { id: 6565, login: "dual-keeper" };
const HUMAN_KEY = "statickey";      // the founder's env row, PINNED to DUAL_ACCT, so it mints the human's key
const HOLDER_ACCT = { id: 6161, login: "holder-keeper" };
const LAPSER_ACCT = { id: 6262, login: "lapser-keeper" };
const REASKER_ACCT = { id: 6363, login: "reasker-keeper" };
const TWINS_ACCT = { id: 6464, login: "twins-keeper" };

let ghIdentity = HOLDER_ACCT;
let child, tmp, ghServer;
const CLONE = { path: null };
const OAUTH_DB = { path: null };

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-claim-ledger-"));
  const dbPath = join(tmp, "fixture.db");
  const seed = fixtureDb(dbPath);
  const resident = (handle, login) => seed.prepare("INSERT INTO residents VALUES (?, ?)").run(handle, JSON.stringify({
    handle, is_office: false, last_active: null,
    address: { data: { since: "2026-08-01", github: login }, body: `# ${handle}` },
  }));
  resident(QUARANTINED, "quarantined-keeper");
  resident(HOLDER, HOLDER_ACCT.login);
  resident(LAPSER, LAPSER_ACCT.login);
  resident(REASKER, REASKER_ACCT.login);
  resident(TWIN_A, TWINS_ACCT.login);
  resident(TWIN_B, TWINS_ACCT.login);
  resident(DUAL, DUAL_ACCT.login);
  seed.close();
  const IX = await storeFor(dbPath);
  const IX_ENV = IX.env;
  const LEDGER = await standingStoreFor(IX);
  STORES.push(LEDGER);
  LEDGER_STORE.store = LEDGER.store;

  const clone = (CLONE.path = join(tmp, "town-clone"));
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({
    [HOLDER]: { login: HOLDER_ACCT.login, id: HOLDER_ACCT.id, pinned: "2026-08-01" },
    [LAPSER]: { login: LAPSER_ACCT.login, id: LAPSER_ACCT.id, pinned: "2026-08-01" },
    [REASKER]: { login: REASKER_ACCT.login, id: REASKER_ACCT.id, pinned: "2026-08-01" },
    [TWIN_A]: { login: TWINS_ACCT.login, id: TWINS_ACCT.id, pinned: "2026-08-01" },
    [TWIN_B]: { login: TWINS_ACCT.login, id: TWINS_ACCT.id, pinned: "2026-08-01" },
    [DUAL]: { login: DUAL_ACCT.login, id: DUAL_ACCT.id, pinned: "2026-08-01" },
  }));
  await plantStanding(LEDGER.store,
    `- 2026-09-01 · quarantine · ${QUARANTINED} · by: registrar · reason: an open question about who is writing`);

  ghServer = createServer((req, res) => {
    res.setHeader("connection", "close");
    const url = new URL(req.url, `http://127.0.0.1:${GH_PORT}`);
    if (url.pathname === "/login/oauth/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", "gh-mock-code");
      back.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/login/oauth/access_token") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ access_token: "gh-mock-token" }));
    }
    if (url.pathname === "/user") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(ghIdentity));
    }
    res.writeHead(404); res.end();
  });
  await new Promise((ok) => ghServer.listen(0, "127.0.0.1", ok));
  GH_PORT = ghServer.address().port;

  ({ child, port: PORT } = await bootOnFreePort((port) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(port),
    "--db", dbPath, "--oauth-db", (OAUTH_DB.path = join(tmp, "oauth.db"))], {
    env: {
      ...process.env, WORLD_GRAPH_NONE: "1", ...IX_ENV,
      // PINNED (`#<gh_id>`), so the row carries a verified account and mints
      // at the key desk — the founder's ruling of 2026-08-26, and lap 3's
      // correction: a pinned env row CAN mint. That is how this file holds a
      // human's key beside a resident's without a browser.
      OFFICE_KEYS: `${HUMAN_KEY}=keemin#${DUAL_ACCT.id}:${DUAL}`,
      TOWN_CLONE: clone, TOWN_PUSH: "",
      PUBLIC_BASE: `http://127.0.0.1:${port}`,
      POSTMARK_OAUTH_GITHUB_CLIENT_ID: "mock-gh-app",
      POSTMARK_OAUTH_GITHUB_CLIENT_SECRET: "mock-gh-secret",
      GITHUB_AUTH_URL: `http://127.0.0.1:${GH_PORT}/login/oauth/authorize`,
      GITHUB_TOKEN_URL: `http://127.0.0.1:${GH_PORT}/login/oauth/access_token`,
      GITHUB_API_URL: `http://127.0.0.1:${GH_PORT}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })));
  // The wait is spawn-office.mjs § awaitListening, inside bootOnFreePort: it
  // names the fault it was handed rather than reporting a timeout.
  BASE = `http://127.0.0.1:${PORT}`;
});

after(async () => {
  ghServer?.close();
  if (child && child.exitCode === null) {
    const gone = new Promise((ok) => child.on("exit", ok));
    child.kill();
    await gone;
  }
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// `from` is the caller's address as the office sees it (clientIp trusts the
// last x-forwarded-for hop, which is how it reads a caller behind nginx). The
// desk's mint cap is five keys an hour PER ADDRESS, and this file now mints
// more than five; a test that shares the file's address is testing the cap
// rather than what it is named after — the reason these tests left the desk
// file in the first place. Each test that mints names its own address.
const ask = (handle, from = null) => fetch(`${BASE}/keys/claim`, {
  method: "POST", headers: { "content-type": "application/json", ...(from ? { "x-forwarded-for": from } : {}) },
  body: JSON.stringify({ handle }),
});
const me = (key) => fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${key}` } });
const askOf = (receipt) => new URL(receipt.cosign_url).searchParams.get("ask");

async function cosign(askSecret, as) {
  ghIdentity = as;
  const r1 = await fetch(`${BASE}/oauth/claim-cosign?ask=${encodeURIComponent(askSecret)}`, { redirect: "manual" });
  if (r1.status !== 302) return { status: r1.status, html: await r1.text() };
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  const r3 = await fetch(r2.headers.get("location"));
  const consentHtml = await r3.text();
  if (r3.status !== 200) return { status: r3.status, html: consentHtml };
  const pendingId = /name="pending_id" value="([^"]+)"/.exec(consentHtml)?.[1];
  const nonce = /name="nonce" value="([^"]+)"/.exec(consentHtml)?.[1];
  assert.ok(pendingId && nonce, "the consent screen carries a pending id and a nonce");
  const r4 = await fetch(`${BASE}/oauth/consent`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending_id: pendingId, nonce, decision: "approve" }),
  });
  return { status: r4.status, html: await r4.text(), consentHtml };
}

test("THE STANDING LEDGER REACHES THE MINT: a quarantined resident is refused, in the ledger's own words", async () => {
  const r = await ask(QUARANTINED);
  assert.equal(r.status, 403, "the key desk is shut to a suspended resident");
  const b = await r.json();
  assert.match(b.defect, /quarantined/i);
  assert.match(b.defect, new RegExp(QUARANTINED), "the refusal names who");
  // the ledger's OWN sentence, not one this door invented
  assert.match(b.hint, /2026-09-01/, "the refusal carries the dated act");
  assert.match(b.hint, /an open question about who is writing/, "and the recorded reason");

  const state = await (await fetch(`${BASE}/keys/claim?handle=${QUARANTINED}`)).json();
  assert.equal(state.claim, null, "a refused ask leaves no claim behind");
});

test("A CLAIM KEY IS NOT A WAY ROUND THE LEDGER: quarantine a resident and their own key stops writing", async () => {
  // Claimed from READING standingBounce — that it takes key.handles and is
  // credential-shape blind, so a claim key is suspended exactly like any other.
  // Verifying a claim and watching it are two acts and only the second is a
  // test, so: watch it.
  const claim = await (await ask(HOLDER)).json();
  assert.equal((await cosign(askOf(claim), HOLDER_ACCT)).status, 200);
  assert.equal((await me(claim.key)).status, 200, "live before the ledger moves");

  try {
    // The ledger is the store's (POS-347), read on every request, so the town
    // can suspend someone mid-session and the doors know at the next call.
    await plantStanding(LEDGER_STORE.store,
      `- 2026-09-08 · quarantine · ${HOLDER} · by: registrar · reason: a question raised after the key was issued`);

    // reads are untouched — the ledger's own law: "a suspension the resident
    // cannot read is a deletion the town will not admit to"
    assert.equal((await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${claim.key}` } })).status, 200,
      "a quarantined resident can still read the whole town");

    // and the write door this lane cares about most: minting again
    const rotate = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${claim.key}` } });
    assert.equal(rotate.status, 403, "a suspended resident cannot rotate into a fresh key either");
    assert.match((await rotate.json()).defect, /quarantined/i);
  } finally {
    await plantStanding(LEDGER_STORE.store,
      `- 2026-09-08 · lift · ${HOLDER} · by: registrar · reason: the question was answered`);
  }

  // lifted by a lift row: the gate is derived, never cached
  assert.equal((await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${claim.key}` } })).status, 201,
    "and the moment the ledger says otherwise, the door opens again");
});

test("A LAPSED ASK DOES NOT BRICK THE HANDLE, and no refusal leaks the office's internals", async () => {
  // The handle used to be the ask table's primary key and the desk never swept,
  // so a lapsed ask sat in the table and the re-ask died on a UNIQUE constraint
  // — 500ing, with SQLite's own words in the hint, at a keyless caller, while
  // three surfaces promised the handle was free.
  const first = await ask(LAPSER);
  assert.equal(first.status, 201);
  const firstAsk = askOf(await first.json());

  // expire it where it lies, the way a day passing would
  const odb = new DatabaseSync(OAUTH_DB.path);
  odb.prepare("UPDATE key_claims SET expires = 1 WHERE cosigned_gh_id IS NULL").run();
  odb.close();

  const again = await ask(LAPSER);
  assert.equal(again.status, 201, "the handle is free again, with no oauth request needed to unstick it");
  const body = await again.json();

  // THE SWEEP IS ASSERTED HERE, on the desk's own call, and NOT later in the
  // file. That ordering is the whole point: sweep() also runs inside every
  // /oauth/* route, so an assertion placed after the co-sign check below would
  // pass whether or not the DESK ever swept — cleared by an unrelated request,
  // which is the reviewer's repair-1 root cause reappearing inside my own test.
  // An instrument placed one call too late measures the wrong sweep.
  {
    const check = new DatabaseSync(OAUTH_DB.path);
    try {
      const lapsed = check.prepare(
        "SELECT COUNT(*) AS n FROM key_claims WHERE expires < ? AND cosigned_gh_id IS NULL"
      ).get(Math.floor(Date.now() / 1000));
      assert.equal(lapsed.n, 0,
        "the lapsed row is deleted by the desk itself, not merely ignored — hygiene with no reader is a table that only grows");
    } finally { check.close(); }
  }
  assert.notEqual(askOf(body), firstAsk, "a fresh ask, not the lapsed one revived");
  assert.ok(!JSON.stringify(body).toLowerCase().includes("constraint"), "no internal text anywhere in the answer");

  // and the lapsed link is dead rather than merely superseded
  assert.equal((await fetch(`${BASE}/oauth/claim-cosign?ask=${encodeURIComponent(firstAsk)}`, { redirect: "manual" })).status, 404,
    "the lapsed ask's own link names nothing");
});

test("A RE-ASK AFTER A ROTATION RETIRES THE KEY THAT WAS LOST: a fresh grant leaves ONE live resident key", async () => {
  // THE ROAD VESPER ACTUALLY WALKS. A session-bound agent whose memory is a
  // repository does not carry a secret across sessions; when the key is gone
  // it does not rotate (it holds nothing to rotate with) — it asks again. At
  // the second reviewer's pin, the grant retired every other ASK on the handle
  // and touched no `tokens` row, so the earlier rotated `pmk_` stayed live with
  // no road to kill it: not the resident's (they lost it), not the human's
  // (their rotation is scoped away from it, correctly), not a new grant. The
  // lane's own rule — rotation must reach every shape the thing can wear —
  // applied to the grant, which is a rotation seen from the far end.
  const from = "10.9.1.1";
  const first = await (await ask(REASKER, from)).json();
  assert.equal((await cosign(askOf(first), REASKER_ACCT)).status, 200, "the first grant lands");
  assert.equal((await me(first.key)).status, 200);

  // the resident rotates into a pmk_, as the receipt tells them to
  const rotated = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${first.key}` } });
  assert.equal(rotated.status, 201);
  const lost = (await rotated.json()).key;
  assert.equal((await me(lost)).status, 200, "the rotated key is live — this is the one the next session will not have");
  const oldWitness = (await (await fetch(`${BASE}/keys/claim?handle=${REASKER}`)).json()).claim;
  assert.equal(oldWitness.cosigned, true);

  // a new session: nothing in hand, so it asks again, and the human grants it
  const second = await (await ask(REASKER, from)).json();
  assert.equal((await cosign(askOf(second), REASKER_ACCT)).status, 200, "the second grant lands");
  assert.equal((await me(second.key)).status, 200, "the new key acts");

  // THE CLAIM: the key that was lost is dead, not merely forgotten
  assert.equal((await me(lost)).status, 401,
    "the earlier resident key is retired by the grant — otherwise a lost key outlives every act meant to replace it");

  // and the store holds one resident credential for the handle, not two
  const check = new DatabaseSync(OAUTH_DB.path);
  try {
    const held = check.prepare(
      "SELECT COUNT(*) AS n FROM tokens WHERE kind = 'household' AND held_by = 'resident' AND claimed_handle = ?"
    ).get(REASKER);
    const claims = check.prepare("SELECT COUNT(*) AS n FROM key_claims WHERE handle = ? AND cosigned_gh_id IS NOT NULL").get(REASKER);
    assert.equal(held.n + claims.n, 1, "one live resident credential per resident, across both shapes");
  } finally { check.close(); }

  // and the public witness now speaks of the NEW grant rather than the old
  // token's date — it reads the credential first, and the old credential is gone
  const witness = (await (await fetch(`${BASE}/keys/claim?handle=${REASKER}`)).json()).claim;
  assert.equal(witness.cosigned, true);
  assert.ok(Date.parse(witness.cosigned_at) >= Date.parse(oldWitness.cosigned_at),
    "the witness dates the grant that stands, not the one that was replaced");
});

test("TWO RESIDENTS IN ONE HOUSE EACH HOLD THEIR OWN KEY: one's rotation is not the other's", async () => {
  // The grant is per handle; the rotation was per account. A house with two
  // session-bound agents anchored to one GitHub account could be granted two
  // keys and could not keep them: either one's rotation ran a DELETE across
  // every resident-held row for the account, and every claim the account had
  // co-signed. Driven by the second reviewer (P2 § 6b). The custody object
  // already names the handle, which is the grain a resident's rotation is at.
  const from = "10.9.2.1";
  const a = await (await ask(TWIN_A, from)).json();
  const b = await (await ask(TWIN_B, from)).json();
  assert.equal((await cosign(askOf(a), TWINS_ACCT)).status, 200);
  assert.equal((await cosign(askOf(b), TWINS_ACCT)).status, 200, "granting the second does not disturb the first (CR-1 is per handle too)");
  assert.equal((await me(a.key)).status, 200, "A's claim key is live after B's grant");
  assert.equal((await me(b.key)).status, 200);

  // A rotates
  const ra = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${a.key}` } });
  assert.equal(ra.status, 201);
  const aKey = (await ra.json()).key;
  assert.equal((await me(a.key)).status, 401, "A's own old key dies — rotation still rotates");
  assert.equal((await me(b.key)).status, 200, "B's claim key survives A's rotation — it was never A's to spend");

  // B rotates, from a claim key, and then rotates again from the pmk_
  const rb = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${b.key}` } });
  assert.equal(rb.status, 201);
  const bKey = (await rb.json()).key;
  assert.equal((await me(aKey)).status, 200, "A's rotated key survives B's rotation");
  const rb2 = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${bKey}` } });
  assert.equal(rb2.status, 201);
  assert.equal((await me(bKey)).status, 401, "and B's rotation still kills B's own previous key");
  assert.equal((await me(aKey)).status, 200, "A's key survives B's second rotation too");

  // each identity read still says which resident's hand
  const idA = await (await me(aKey)).json();
  assert.equal(idA.held_by, "resident");
  assert.equal(idA.claimed_handle, TWIN_A);
  assert.deepEqual(idA.handles.slice().sort(), [TWIN_A, TWIN_B].sort(), "the key acts as the whole house — custody is per resident, authority is per household");
});

test("A HUMAN'S KEY AND THEIR RESIDENT'S KEY STAND TOGETHER: neither rotation kills the other's", async () => {
  // THE TEST THAT DID NOT EXIST (the second reviewer's CR-11). Repair 4 scoped
  // the rotation by whose hand the key is in, and the lap-2 table said the
  // unscoped flip reddened three tests; at a489dcef it reddened none — no test
  // ever held a human key and a resident key at once, so "a resident's
  // rotation does not kill their human's key" was asserted by a probe and by
  // nothing that could fail. This holds both.
  const from = "10.9.3.1";

  // the human mints THEIR key from the founder's pinned row — no browser
  const hm = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${HUMAN_KEY}` } });
  assert.equal(hm.status, 201, "a pinned env row mints (lap 3's correction)");
  const human1 = (await hm.json()).key;
  const whoH = await (await me(human1)).json();
  assert.equal(whoH.held_by, undefined, "the human's key carries no custody disclosure — nothing was co-signed");

  // the resident asks, and the same account grants it
  const asked = await (await ask(DUAL, from)).json();
  assert.equal((await cosign(askOf(asked), DUAL_ACCT)).status, 200);
  assert.equal((await me(asked.key)).status, 200);
  assert.equal((await me(human1)).status, 200, "the grant did not touch the human's key");

  // THE RESIDENT ROTATES: their claim key dies, their human's key does not
  const rr = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${asked.key}` } });
  assert.equal(rr.status, 201);
  const resident1 = (await rr.json()).key;
  assert.equal((await me(asked.key)).status, 401, "the resident's own old key dies");
  assert.equal((await me(human1)).status, 200,
    "the HUMAN's key survives the resident's rotation — the consent screen promised there was nothing for them to lose");
  const whoR = await (await me(resident1)).json();
  assert.equal(whoR.held_by, "resident");
  assert.equal(whoR.claimed_handle, DUAL);

  // THE HUMAN ROTATES: their old key dies, the resident's does not
  const hr = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${human1}` } });
  assert.equal(hr.status, 201);
  const human2 = (await hr.json()).key;
  assert.equal((await me(human1)).status, 401, "the human's rotation still rotates");
  assert.equal((await me(human2)).status, 200);
  assert.equal((await me(resident1)).status, 200,
    "the RESIDENT's key survives the human's rotation — the two hands hold two keys");

  // and the store agrees: one row per hand for this account
  const check = new DatabaseSync(OAUTH_DB.path);
  try {
    const rows = check.prepare(
      "SELECT held_by, COUNT(*) AS n FROM tokens WHERE kind = 'household' AND gh_id = ? GROUP BY held_by ORDER BY held_by"
    ).all(DUAL_ACCT.id);
    assert.deepEqual(rows.map((r) => [r.held_by, r.n]), [[null, 1], ["resident", 1]], "one human-held row, one resident-held row");
  } finally { check.close(); }
});

// LAST IN THE FILE ON PURPOSE: it breaks the office's ask table to reach a code
// path nothing else can, and nothing after it could ask again.
test("THE 500 IS THE OFFICE'S OWN SENTENCE, never SQLite's, to a caller who presented nothing", async () => {
  // The desk's catch used to answer `String(e.message)` — so a keyless caller
  // got "UNIQUE constraint failed: key_claims.handle", the schema named to a
  // stranger. The flip that restores that line stayed GREEN, because with the
  // primary key fixed there is no longer a natural way to make the desk throw:
  // the guard had no reachable case and therefore no watcher. This makes one.
  const odb = new DatabaseSync(OAUTH_DB.path);
  odb.exec("DROP TABLE key_claims");
  odb.close();

  const r = await ask(LAPSER);
  assert.equal(r.status, 500, "the desk trips");
  const b = await r.json();
  assert.equal(b.defect, "the key desk tripped");
  const whole = JSON.stringify(b).toLowerCase();
  for (const leak of ["sqlite", "no such table", "key_claims", "constraint", "prepare", "syntax"])
    assert.ok(!whole.includes(leak), `the answer must not carry "${leak}" to a keyless caller`);
  assert.match(b.hint, /inside the office, not in your ask/, "and it tells them whose fault it is");
  // THE REMEDY MUST BE ONE THE READER CAN REACH (the second reviewer's CR-9,
  // lap 3's own finding one door over). This hint ended "write to the
  // Registrar" — said to a keyless caller who just got a 500 from the keyless
  // door. Mail needs the credential they came for; the sentence was a closed
  // loop, the same one lap 3 removed from the arrival page and the receipt.
  assert.ok(!/write to the registrar/i.test(b.hint), "the hint must not name a mail door a keyless caller cannot open");
  assert.match(b.hint, /nothing you need to send anyone/, "and it says so — the office's fault is the office's to read");
});

// AFTER THE ONE ABOVE, and for the same reason: it takes the lane's own
// migration back out from under the live office, which nothing after it could
// survive either.
test("ONE KEYLESS GET DOES NOT KILL THE OFFICE: the witness on an unmigrated key store answers 500 and the process lives", async () => {
  // The second reviewer booted the train's READ WORKER against a key store the
  // writer had not yet migrated and sent one keyless GET /keys/claim: the
  // worker exited 1 (`ERR_SQLITE_ERROR` from claimState's SELECT on
  // tokens.held_by) and every request after it was ECONNREFUSED. The GET branch
  // had no catch, the POST did, and the office has no process-level handler.
  //
  // This branch has no read worker to boot, and a writer boot migrates the
  // store, so the reachable shape here is the reviewer's fault reproduced
  // from the other side: the office is up, and the column its SELECT names is
  // taken away — the same statement, the same error, the same missing catch.
  const odb = new DatabaseSync(OAUTH_DB.path);
  odb.exec("ALTER TABLE tokens DROP COLUMN held_by");
  odb.close();

  const r = await fetch(`${BASE}/keys/claim?handle=${REASKER}`);
  assert.equal(r.status, 500, "the witness trips rather than answering nonsense");
  const b = await r.json();
  assert.equal(b.defect, "the key desk tripped");
  const whole = JSON.stringify(b).toLowerCase();
  for (const leak of ["sqlite", "no such column", "held_by", "tokens", "prepare", "syntax"])
    assert.ok(!whole.includes(leak), `the answer must not carry "${leak}" to a keyless caller`);
  assert.ok(!/write to the registrar/i.test(b.hint), "the GET's hint names no mail door either (CR-9)");

  // THE CLAIM: the process is still there. A worker that answers 500 is one an
  // operator can see; one that exits on a stranger's GET is not.
  assert.equal(child.exitCode, null, "the office did not exit");
  const alive = await fetch(`${BASE}/join`);
  assert.equal(alive.status, 200, "and it still answers the next caller");
});
