// claim-desk.test.mjs — a rolled resident obtains and rotates their own key.
//
// THE QUESTION THE LANE ASKED: can a session-bound agent already in the roll
// hold a town key of its own, without its human relaying a secret to it?
// Before this desk the answer was no, and the measurement is in the lane's
// report: the only mints are the founder's OFFICE_KEYS env row (parsed at boot),
// the browser OAuth dance, POST /keys (which needs a ghId the dance is the only
// source of), and POST /berth (keyless, but it refuses a name the roll already
// holds). vesper, 2026-09-08: "the server I run on holds no key for the town
// yet."
//
// These tests drive the whole arc against a mock GitHub: ask -> co-sign ->
// act -> rotate. The negatives are the load-bearing half — an ask must grant
// NOTHING until the household's own account says yes, and a co-sign by any
// other account must not hand over a key.
//
//   node --test test/claim-desk.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fixtureDb } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

// The town index this file's offices read: a store seeded from each fixture
// office.db (POS-268, office-under-test.mjs). Stopped when the file is done.
const STORES = [];
const storeFor = async (dbPath) => { const x = await indexStore(dbPath); STORES.push(x); return x.env; };
test.after(async () => { for (const x of STORES) await x.stop(); });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The port is asked of the OS, never chosen (spawn-office.mjs § the port,
// asked for); it was the fixed 43881, a door every pool tree on the box shares.
let PORT;
// THE PORT IS ASKED FOR, NEVER CHOSEN (join-pr-at-the-cosign.test.mjs § the
// port): this fake GitHub was fixed at 43882, a door every pool tree on the box shares.
// It listens on 0, and the port the OS handed back is what the office dials;
// every answer says `connection: close`, so no idle keep-alive socket is
// left for the office's next fetch to reuse and die on mid-request.
let GH_PORT = null;
let BASE;
const KEY = "statickey";

// The fixture town's own resident (fixture.mjs seeds `wright`), pinned to the
// account below. `stranger` is an account the record binds to nobody.
const HANDLE = "wright";
// A SECOND HANDLE IN THE SAME HOUSE, seeded below. The stranger case needs a
// claim nobody has co-signed yet: the desk holds one ask per handle, and the
// arc test co-signs HANDLE's — so run the refusal against a handle of its own.
// Without this the co-sign route answers "already co-signed" at its first line
// and the stranger never reaches the check the test is named after: a probe
// aimed at a state the code cannot be in.
const HANDLE2 = "wright-second";
const HANDLE3 = "wright-quarantined";
const HANDLE4 = "wright-fourth";   // untouched until the budget test, which needs one clean mint
const HANDLE5 = "wright-fifth";    // its own account, so quarantining it disturbs nobody else
const FIFTH = { id: 5555, login: "fifth-keeper" };
const OWNER = { id: 999, login: "keeminlee" };
const STRANGER = { id: 4242, login: "someone-else" };

let ghIdentity = OWNER;
let child, tmp, ghServer;

// The key the arc test leaves standing, read by the rotation test. One arc, not
// two: asking twice would rotate the first key away, and the rotation test is
// about what a resident already holds rather than about the desk.
const CLAIM_KEY = { value: null };
const ROTATED_KEY = { value: null };
const CLONE = { path: null };
const OAUTH_DB = { path: null };   // the ledger is re-read from disk per request, so a test can move it

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-claim-"));
  const dbPath = join(tmp, "fixture.db");
  const seed = fixtureDb(dbPath);
  seed.prepare("INSERT INTO residents VALUES (?, ?)").run(HANDLE2, JSON.stringify({
    handle: HANDLE2, is_office: false, last_active: null,
    address: { data: { since: "2026-08-01", joined: "2026-08-01", github: OWNER.login }, body: `# ${HANDLE2}` },
  }));
  seed.prepare("INSERT INTO residents VALUES (?, ?)").run(HANDLE5, JSON.stringify({
    handle: HANDLE5, is_office: false, last_active: null,
    address: { data: { since: "2026-08-01", github: FIFTH.login }, body: `# ${HANDLE5}` },
  }));
  seed.prepare("INSERT INTO residents VALUES (?, ?)").run(HANDLE4, JSON.stringify({
    handle: HANDLE4, is_office: false, last_active: null,
    address: { data: { since: "2026-08-01", github: "fourth-keeper" }, body: `# ${HANDLE4}` },
  }));
  seed.prepare("INSERT INTO residents VALUES (?, ?)").run(HANDLE3, JSON.stringify({
    handle: HANDLE3, is_office: false, last_active: null,
    // A DIFFERENT ACCOUNT ON PURPOSE. householdFor falls back to the residents
    // index's own `github:` line for unpinned handles, so giving this one the
    // owner's login would silently enlarge the household the arc test asserts
    // on — the fixture would be changing the answer to a question it is not
    // about. Standing is per-handle and cares nothing for the household, so
    // the quarantine test works just as well from a house of its own.
    address: { data: { since: "2026-08-01", github: "third-keeper" }, body: `# ${HANDLE3}` },
  }));
  seed.close();
  const IX_ENV = await storeFor(dbPath);
  const clone = join(tmp, "town-clone");
  CLONE.path = clone;
  mkdirSync(join(clone, "tools"), { recursive: true });
  // A THIRD RESIDENT, QUARANTINED. The desk is keyless and so runs before the
  // credentialed standing gate; this is the fixture that proves it applies the
  // ledger itself rather than minting first and refusing later.
  writeFileSync(join(clone, "tools", "standing-ledger.md"),
    `- 2026-09-01 · quarantine · ${HANDLE3} · by: registrar · reason: an open question about who is writing
`);
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({
    [HANDLE]: { login: OWNER.login, id: OWNER.id, pinned: "2026-07-05" },
    [HANDLE2]: { login: OWNER.login, id: OWNER.id, pinned: "2026-08-01" },
    [HANDLE5]: { login: FIFTH.login, id: FIFTH.id, pinned: "2026-08-01" },
  }));

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
      ...process.env, ...IX_ENV,
      OFFICE_KEYS: `${KEY}=keemin:${HANDLE}`,
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

// ── the agent's half: keyless, one POST, no human ────────────────────────────

// `from`: the caller's address as the office sees it (clientIp reads the last
// x-forwarded-for hop). The desk's mint cap is five keys an hour per address
// and this file's own address spends all five; a test that must mint beyond
// them names an address of its own rather than loosening the cap.
const ask = (handle, from = null) => fetch(`${BASE}/keys/claim`, {
  method: "POST", headers: { "content-type": "application/json", ...(from ? { "x-forwarded-for": from } : {}) },
  body: JSON.stringify({ handle }),
});

const me = (key) => fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${key}` } });

// The ask is handed back ONCE, inside the link. A caller that needs the bare
// secret reads it out of the link the same way the human's browser would —
// which is also a small proof that the link is the only thing carrying it.
const askOf = (receipt) => new URL(receipt.cosign_url).searchParams.get("ask");

// ── the human's half: one click in a browser they already own ────────────────
// Drives the real co-sign route end to end through the mock GitHub, exactly as
// a person's browser would: the link -> GitHub -> the office's consent screen
// -> the approve button.

async function cosign(ask, as = OWNER) {
  ghIdentity = as;
  const r1 = await fetch(`${BASE}/oauth/claim-cosign?ask=${encodeURIComponent(ask)}`, { redirect: "manual" });
  if (r1.status !== 302) return { status: r1.status, html: await r1.text() };
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  assert.equal(r2.status, 302, "mock GitHub should bounce back to the office");
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

// ─────────────────────────────────────────────────────────────────────────────

// THREE TESTS MOVED OUT to test/claim-ledger.test.mjs — the standing ledger at
// the mint, the ledger-inheritance of a claim key, and the lapsed ask. Each of
// them MINTS, and in this file they were the sixth, seventh and eighth mints of
// the run, so they failed on the desk's hourly cap rather than on what they are
// named after. The cap is per-IP and in-memory, which makes it process state
// shared by a whole file. Splitting was the honest fix; loosening the cap would
// have been changing what a door does to make a test pass.

test("THE ARC: a rolled resident asks, its human co-signs once, and the agent's OWN key acts", async () => {
  const asked = await ask(HANDLE);
  assert.equal(asked.status, 201);
  const body = await asked.json();
  assert.match(body.key, /^pmc_/, "a claim carries its own prefix");
  assert.equal(body.claiming, HANDLE);
  assert.match(body.cosign_url, /\/oauth\/claim-cosign\?ask=/);

  // THE LOAD-BEARING NEGATIVE: an ask is not a credential. Before the co-sign
  // this key must open nothing at all — not the town, not a voice, nothing.
  assert.equal((await me(body.key)).status, 401, "an un-co-signed claim grants nothing");

  assert.match(body.fingerprint, /^[A-Za-z0-9_-]{8}$/, "the receipt carries a fingerprint the human can compare");
  assert.equal(body.ask, undefined, "the secret is handed back once, inside the link, and nowhere else");
  assert.ok(!body.cosign_url.includes(HANDLE), "and the link never carries the public handle");
  const arcAsk = askOf(body);
  assert.ok(arcAsk && arcAsk.length > 20, "the link carries a secret worth guessing at");

  const signed = await cosign(arcAsk);
  assert.equal(signed.status, 200, "the co-sign lands");
  assert.match(signed.consentHtml, new RegExp(body.fingerprint), "the human is shown the same fingerprint");

  // The same key the agent minted for itself. Nothing was handed over.
  const who = await me(body.key);
  assert.equal(who.status, 200, "after the co-sign the agent's own key acts");
  const id = await who.json();
  assert.equal(id.household, OWNER.login);
  assert.deepEqual(id.handles.slice().sort(), [HANDLE, HANDLE2].sort());
  assert.equal(id.key_kind, "claim");

  // THE DISCLOSURE (the 08-29 seat ruling): the answer says whose hand it is in.
  assert.equal(id.held_by, "resident", "the identity read discloses the key is the resident's own");
  assert.equal(id.claimed_handle, HANDLE);
  assert.deepEqual(id.cosigned_by, { login: OWNER.login, id: OWNER.id });

  // and it can actually do the household's work, not merely identify itself
  assert.equal((await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${body.key}` } })).status, 200);

  CLAIM_KEY.value = body.key;
});

test("THE DISCLOSURE SURVIVES THE ROTATION THE RECEIPT ASKS FOR", async () => {
  // The door's whole point is that the record says whose hand the key is in.
  // It used to say so until the resident did the one thing the receipt urges —
  // rotate — and then /me went quiet and the public witness answered null, one
  // call later. The custody rides the credential now, not the ask.
  const claimKey = CLAIM_KEY.value;
  assert.ok(claimKey, "the arc left a live key");

  const rotated = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${claimKey}` } });
  assert.equal(rotated.status, 201);
  const pmk = (await rotated.json()).key;

  const id = await (await me(pmk)).json();
  assert.equal(id.held_by, "resident", "the identity read still says whose hand it is in");
  assert.equal(id.claimed_handle, HANDLE);
  assert.deepEqual(id.cosigned_by, { login: OWNER.login, id: OWNER.id });

  const witness = (await (await fetch(`${BASE}/keys/claim?handle=${HANDLE}`)).json()).claim;
  assert.ok(witness, "the public witness did not go null on rotation");
  assert.equal(witness.cosigned, true);
  assert.equal(witness.held_by, "the resident");
  assert.deepEqual(witness.cosigned_by, { login: OWNER.login, id: OWNER.id });

  // and it holds across a SECOND rotation, so this is a carried fact and not a
  // one-hop copy
  const again = (await (await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${pmk}` } })).json()).key;
  const id2 = await (await me(again)).json();
  assert.equal(id2.held_by, "resident", "custody survives every rotation, not just the first");
  ROTATED_KEY.value = again;
});

test("the witness is public: GET /keys/claim names who co-signed and when", async () => {
  const r = await fetch(`${BASE}/keys/claim?handle=${HANDLE}`);
  assert.equal(r.status, 200);
  const { claim } = await r.json();
  assert.equal(claim.cosigned, true);
  assert.equal(claim.held_by, "the resident");
  assert.deepEqual(claim.cosigned_by, { login: OWNER.login, id: OWNER.id });
  assert.ok(claim.cosigned_at, "the co-sign is dated on the record");
  // no secret ever appears on a public read
  assert.ok(!JSON.stringify(claim).includes("pmc_"), "the public witness carries no key material");
});

test("ROTATION IS THE RESIDENT'S OWN ACT: the claim key rotates itself, and the old one dies", async () => {
  // This is the half that already worked before the desk existed and was
  // watched by nothing: keyLookup spreads ghId onto a household key, and the
  // key desk asks only for a ghId. Proven here so it cannot regress silently.
  // mint a household key from the live key — no browser in this call at all
  const claimKey = ROTATED_KEY.value;
  assert.ok(claimKey, "the disclosure test ran first and left a live key");
  const rotated = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${claimKey}` } });
  assert.equal(rotated.status, 201, "a resident rotates their own key with no human present");
  const { key: pmk } = await rotated.json();
  assert.match(pmk, /^pmk_/);
  assert.equal((await me(pmk)).status, 200, "the new key acts");

  // rotate again, from the new key: the old one must be dead
  const again = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${pmk}` } });
  assert.equal(again.status, 201);
  const { key: pmk2 } = await again.json();
  assert.equal((await me(pmk)).status, 401, "rotation kills the key it replaced");
  assert.equal((await me(pmk2)).status, 200);

  // the rotated household key replaces the one before it
  assert.equal((await me(claimKey)).status, 401, "rotation kills the key it replaces, whatever shape it wore");
  // and the ORIGINAL pmc_ from the arc is long dead, which is the two-shape half
  assert.equal((await me(CLAIM_KEY.value)).status, 401, "the claim shape is spent once rotated away from");
});

test("a handle the roll does not hold is refused, and told where to actually go", async () => {
  const r = await ask("nobody-of-nowhere");
  assert.equal(r.status, 404);
  const b = await r.json();
  assert.match(b.defect, /not a resident/i);
  assert.match(b.hint, /\/berth|\/households/, "the refusal names the doors that DO admit an arrival");
});

test("A CO-SIGN BY ANY OTHER ACCOUNT HANDS OVER NOTHING", async () => {
  const asked = await ask(HANDLE2);
  assert.equal(asked.status, 201, "a fresh, un-co-signed claim to try the refusal against");
  const fresh = await asked.json();
  const strangersTarget = fresh.key;
  const freshAsk = askOf(fresh);

  // THE LINK CANNOT BE BUILT FROM PUBLIC INFORMATION. This is the takeover the
  // reviewer walked: the co-sign URL used to be the handle, so anyone could
  // construct it and have the household's own account grant a stranger's ask.
  const byHandle = await fetch(`${BASE}/oauth/claim-cosign?handle=${HANDLE2}`, { redirect: "manual" });
  assert.equal(byHandle.status, 404, "a link built from the public handle names no ask");
  const byGuess = await fetch(`${BASE}/oauth/claim-cosign?ask=not-a-real-secret`, { redirect: "manual" });
  assert.equal(byGuess.status, 404, "and a guessed secret names none either");

  // A stranger signing in must be told no BEFORE any button exists.
  const r = await cosign(freshAsk, STRANGER);
  assert.equal(r.status, 403, "an account the record does not bind to this handle is refused");
  assert.match(r.html, /does not\s+bind|Not this household/i);
  assert.ok(!/name="pending_id"/.test(r.html), "no approve button is even offered to the wrong account");

  // and the key the refusal was aimed at is still worth nothing
  assert.equal((await me(strangersTarget)).status, 401, "a refused co-sign leaves the claim granting nothing");

  // the household's OWN account still can — the refusal is about who, not a dead claim
  assert.equal((await cosign(freshAsk, OWNER)).status, 200);
  assert.equal((await me(strangersTarget)).status, 200, "the right account's co-sign still lands");
});

test("THE CONSENT SCREEN'S CHECK IS THE HANDLE, NOT MERELY A HOUSEHOLD: an account that keeps a house but not THIS resident is refused before any button", async () => {
  // THE GAP THE FLIP FOUND (the second reviewer's CR-10): reducing the consent
  // screen's check to "does this account keep any household" stayed green,
  // because the only wrong account this file ever sent to the screen kept NO
  // household. The approval re-checks the handle and claimLookup's binding is
  // watched, so the key would still act as nothing — but the screen would
  // have shown the wrong household a Grant button and then a "Granted" page
  // for a key that does nothing, which is a lie told to the one person the
  // door asks to be careful. fifth-keeper keeps wright-fifth and not wright.
  const asked = await ask(HANDLE, "10.9.10.1");
  assert.equal(asked.status, 201, "a fresh ask on the arc's handle, from its own address");
  const fresh = await asked.json();

  const r = await cosign(askOf(fresh), FIFTH);
  // AT THE SCREEN, NOT AT THE BUTTON. The helper only carries `consentHtml`
  // when the screen rendered and it went on to press Grant — and the approval
  // re-checks the handle, so a screen that let the wrong account through
  // would STILL answer 403 one step later. Asserting the status alone would
  // pass with the screen's check gone (the flip found exactly that); the
  // claim is that the refusal comes before any button exists.
  assert.equal(r.consentHtml, undefined, "refused at the consent screen itself — no Grant button was ever rendered, so none was pressed");
  assert.equal(r.status, 403, "an account that keeps a household but not this handle is refused at the screen");
  assert.ok(!/name="pending_id"/.test(r.html), "no Grant button is rendered for it");
  assert.match(r.html, /does not\s+bind/i, "and it is told the record does not bind this handle to it");
  assert.match(r.html, new RegExp(`That account keeps: ${HANDLE5}`), "and which household it does keep");

  assert.equal((await me(fresh.key)).status, 401, "the ask it was aimed at grants nothing");
});

test("A NAME CANNOT BE OCCUPIED: many asks may stand, and only the one your human opens becomes a key", async () => {
  // The old rule held the handle against a second ask, which read as hygiene
  // and WAS the attack: the ask is keyless, so the first could be a stranger's
  // and the real resident was then refused in their own name. Both stand now,
  // each carrying its own secret; neither grants anything.
  const mine = await (await ask(HANDLE4)).json();
  const strangers = await (await ask(HANDLE4)).json();
  assert.notEqual(askOf(mine), askOf(strangers), "two asks, two secrets");
  assert.notEqual(mine.fingerprint, strangers.fingerprint);
  assert.equal((await me(mine.key)).status, 401, "neither grants anything while standing");
  assert.equal((await me(strangers.key)).status, 401);

  const witness = (await (await fetch(`${BASE}/keys/claim?handle=${HANDLE4}`)).json()).claim;
  assert.equal(witness.cosigned, false);
  assert.equal(witness.asks_standing, 2, "the public read says how many are waiting, and names none of them");
  assert.ok(!JSON.stringify(witness).includes(askOf(mine)), "and leaks no secret");

  // the human opens MINE. Theirs must never become anything afterwards.
  assert.equal((await cosign(askOf(mine), { id: 4444, login: "fourth-keeper" })).status, 200);
  assert.equal((await me(mine.key)).status, 200, "the ask that was granted is live");
  assert.equal((await me(strangers.key)).status, 401, "the ask that was not is dead, and stays dead");
  assert.equal((await fetch(`${BASE}/oauth/claim-cosign?ask=${encodeURIComponent(askOf(strangers))}`, { redirect: "manual" })).status, 404,
    "granting one retires the rest — the loser's link names nothing now");
});

test("GET /keys/claim on a handle nobody claimed answers null rather than inventing one", async () => {
  const r = await fetch(`${BASE}/keys/claim?handle=nobody-of-nowhere`);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).claim, null);
});

test("THE MINT CAP COUNTS KEYS, NOT KNOCKS: refusals do not spend a resident's hourly budget", async () => {
  // The cap is five mints an hour from one address. Six refusals in a row here
  // would exhaust it if being told no cost a slot — which is what the berth
  // shape this was modelled on does, and what this desk did until the lane's
  // own standing falsifier ran sixth and got a 429 instead of the 403 it
  // names. A resident who mistypes their own address should not lose their
  // afternoon to it.
  for (let i = 0; i < 6; i++) {
    const r = await ask(`no-such-resident-${i}`);
    assert.equal(r.status, 404, "each of these mints nothing");
  }
  const good = await ask(HANDLE4);
  assert.equal(good.status, 201, "a real ask still lands after six refusals");
  assert.match((await good.json()).key, /^pmc_/);
});


test("THE REMEDY NAMES A DOOR A KEYLESS CALLER CAN ACTUALLY REACH", async () => {
  // The sentence this watches used to say "Write to the Registrar" — to an
  // agent that by construction holds nothing. It was a closed loop: sending
  // mail needs the very credential the reader is there to obtain. This lane's
  // own recurring class, in prose instead of code — a remedy named without
  // checking the reader can reach it.
  //
  // So the test does two things. It proves the CLOSED LOOP is real rather than
  // asserting it from memory, and it holds the sentence to a road that is open.
  const join = await fetch(`${BASE}/join`);
  assert.equal(join.status, 200, "the arrival page is the one read an agent reaches with nothing");
  const limit = (await join.json()).a_key_of_your_own.if_nobody_can_co_sign;

  // 1. the doors the old advice implied, measured keyless, right now
  const mail = await fetch(`${BASE}/letters`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: HANDLE, to: "wright", title: "hi", thread: "new", body: "hello" }),
  });
  assert.equal(mail.status, 401, "a keyless caller cannot write to any office — this is why the old sentence was a closed loop");
  const berth = await fetch(`${BASE}/berth`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: HANDLE }),
  });
  assert.equal(berth.status, 409, "and cannot board in their own name either");

  // 2. the sentence must not send them down either of those
  assert.ok(!/write to the registrar/i.test(limit),
    "the sentence must not name a mail door a keyless caller cannot open");

  // 3. it must name the road that needs no key: the register's fenced fields
  //    change by pull request on the town repo, which takes a git push
  assert.match(limit, /pull request/i, "it names the road that does not need a key");
  assert.match(limit, /github/i, "and the fenced field the road is about");

  // 4. and the ordinary door it points at IS reachable without a credential —
  //    driven, not assumed. A handle the roll does not hold answers 404, which
  //    is a refusal by the desk rather than by the credential tier, and it
  //    mints nothing so it spends none of this file's budget.
  const desk = await fetch(`${BASE}/keys/claim`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: "nobody-at-all-lives-here" }),
  });
  // THE ASSERTION IS "NOT THE CREDENTIAL TIER", and deliberately not an exact
  // code. 401 is the tier that turns away a caller for having nothing; 404 (the
  // roll does not hold that handle) and 429 (this address has knocked enough)
  // are both the DESK's own answers, past that tier, and which one you get
  // depends on how many keyless calls the tests above happened to make. Pinning
  // this to 404 made it depend on the file's budget rather than on the door —
  // the same order-coupling this file removed elsewhere, reintroduced by an
  // assertion that was decoration rather than the claim.
  assert.notEqual(desk.status, 401,
    "the claim desk answers a caller who holds nothing — that is the whole point of it");
  assert.ok([404, 429].includes(desk.status), `an answer from the desk itself, got ${desk.status}`);
});
