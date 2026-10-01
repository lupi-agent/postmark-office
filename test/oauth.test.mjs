// oauth.test.mjs — the full GitHub-sign-in dance against a mock GitHub.
// A scripted MCP-shaped client: register → authorize (PKCE) → GitHub round
// trip → consent → code → token → authenticated request. Plus the negatives:
// PKCE mismatch, unknown GitHub account (warm bounce), 401 discovery header,
// static-key regression, refresh rotation.
//   node --test test/

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The port is asked of the OS, never chosen (spawn-office.mjs § the port,
// asked for); it was the fixed 43821, a door every pool tree on the box shares.
let PORT;
// THE PORT IS ASKED FOR, NEVER CHOSEN (join-pr-at-the-cosign.test.mjs § the
// port): this fake GitHub was fixed at 43822, a door every pool tree on the box shares.
// It listens on 0, and the port the OS handed back is what the office dials;
// every answer says `connection: close`, so no idle keep-alive socket is
// left for the office's next fetch to reuse and die on mid-request.
let GH_PORT = null;
let BASE;
const KEY = "statickey";
// A SECOND STATIC ROW, PINNED. `OFFICE_KEYS` entries may carry `#<gh_id>`
// (server.mjs § KEYS, the founder's ruling 2026-08-26), and that changes what
// the row can do — which the lane's report got wrong and the reviewer caught by
// minting a working key from one.
const PINNED_KEY = "staticpinned";

// what the mock GitHub says the signed-in user is (flipped per test)
let ghIdentity = { id: 999, login: "keeminlee" };

let child, tmp, ghServer;

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-oauth-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();

  // a minimal town clone: just the pins file the household mapping reads
  const clone = join(tmp, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({
    wright: { login: "keeminlee", id: 999, pinned: "2026-07-05" },
  }));

  // mock GitHub: authorize redirects straight back; token + user are canned
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
    "--db", dbPath, "--oauth-db", join(tmp, "oauth.db")], {
    env: {
      ...process.env, WORLD_GRAPH_NONE: "1",
      OFFICE_KEYS: `${KEY}=keemin:wright;${PINNED_KEY}=keemin#999:wright`,
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

// ── dance helper: everything up to holding an auth code ──────────────────────

const REDIRECT = "https://mock-client.example/callback";
const s256 = (v) => createHash("sha256").update(v).digest("base64url");

// REGISTERED ONCE, SHARED. The office rate-limits /oauth/register to ten per
// IP per hour (oauth.mjs § regLimited, in-memory), and this file spent seven of
// them registering a fresh client per test before the manual-finish tests
// (#2764, below) needed three more and hit the eleventh: a 429 that reads
// exactly like a defect in the door. A client is a redirect set, not a session;
// every dance below works against the same one.
let redirectClientId = null;
async function registerClient() {
  if (redirectClientId) return redirectClientId;
  const res = await fetch(`${BASE}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "test connector", redirect_uris: [REDIRECT] }),
  });
  assert.equal(res.status, 201);
  redirectClientId = (await res.json()).client_id;
  return redirectClientId;
}

async function danceToCode(clientId, verifier) {
  const authorize = new URL(`${BASE}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", REDIRECT);
  authorize.searchParams.set("state", "client-state-xyz");
  authorize.searchParams.set("code_challenge", s256(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");

  const r1 = await fetch(authorize, { redirect: "manual" });
  assert.equal(r1.status, 302, "authorize should bounce to GitHub");
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  assert.equal(r2.status, 302, "mock GitHub should bounce back to the office");
  const r3 = await fetch(r2.headers.get("location"));
  const consentHtml = await r3.text();
  if (r3.status !== 200 || !consentHtml.includes("Authorize")) return { page: consentHtml, status: r3.status };

  const pendingId = /name="pending_id" value="([^"]+)"/.exec(consentHtml)[1];
  const nonce = /name="nonce" value="([^"]+)"/.exec(consentHtml)[1];
  const r4 = await fetch(`${BASE}/oauth/consent`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending_id: pendingId, nonce, decision: "approve" }),
    redirect: "manual",
  });
  assert.equal(r4.status, 302, "consent should bounce back to the client");
  const back = new URL(r4.headers.get("location"));
  assert.equal(back.searchParams.get("state"), "client-state-xyz", "client state must round-trip");
  return { code: back.searchParams.get("code"), consentHtml };
}

// ── the tests ─────────────────────────────────────────────────────────────────

test("discovery: protected-resource + AS metadata, both well-known forms", async () => {
  for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
    const r = await fetch(`${BASE}${p}`);
    assert.equal(r.status, 200);
    assert.ok((await r.json()).authorization_servers.length === 1);
  }
  const as = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json();
  assert.equal(as.token_endpoint, `${BASE}/oauth/token`);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);
});

test("401 carries the RFC 9728 discovery header", async () => {
  // Reads are public now; the discovery header rides the write challenge instead.
  const r = await fetch(`${BASE}/letters`, { method: "POST", body: "{}" });
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate") ?? "", /resource_metadata=/);
});

test("full dance: register → GitHub → consent → code → token → /town 200", async () => {
  ghIdentity = { id: 999, login: "keeminlee" };
  const clientId = await registerClient();
  const verifier = randomBytes(32).toString("base64url");
  const { code, consentHtml } = await danceToCode(clientId, verifier);
  assert.ok(code, "should hold an auth code");
  assert.match(consentHtml, /wright/, "consent page names the handles at stake");

  const tok = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: REDIRECT, code_verifier: verifier }),
  });
  assert.equal(tok.status, 200);
  const grant = await tok.json();
  assert.ok(grant.access_token && grant.refresh_token);

  const town = await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${grant.access_token}` } });
  assert.equal(town.status, 200, "OAuth token opens the door");

  // GET /me — the signed-in household reads its own identity (the login island's key)
  const me = await (await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${grant.access_token}` } })).json();
  assert.deepEqual(me, { household: "keeminlee", handles: ["wright"], visitor: false,
    verified_github: { login: "keeminlee", id: 999 }, key_kind: "oauth", principal: false });

  // refresh rotates: old refresh dies, new pair works
  const ref = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: grant.refresh_token }),
  });
  assert.equal(ref.status, 200);
  const grant2 = await ref.json();
  const replay = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: grant.refresh_token }),
  });
  assert.equal(replay.status, 400, "rotated refresh token must be dead");
  const town2 = await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${grant2.access_token}` } });
  assert.equal(town2.status, 200);
});

test("PKCE mismatch → invalid_grant, and the code is burned", async () => {
  ghIdentity = { id: 999, login: "keeminlee" };
  const clientId = await registerClient();
  const { code } = await danceToCode(clientId, randomBytes(32).toString("base64url"));
  const bad = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: REDIRECT, code_verifier: "wrong-verifier-entirely" }),
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, "invalid_grant");
  // single use even on failure
  const again = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: REDIRECT, code_verifier: "anything" }),
  });
  assert.equal((await again.json()).error_description, "code unknown or expired");
});

test("no-household GitHub sign-in → a visitor pass: reads work, send is a warm bounce", async () => {
  ghIdentity = { id: 424242, login: "some-stranger" };
  const clientId = await registerClient();
  const verifier = randomBytes(32).toString("base64url");
  const { code, consentHtml } = await danceToCode(clientId, verifier);
  assert.ok(code, "a no-household account completes the dance and holds a code");
  assert.match(consentHtml, /visitor pass/i, "the consent screen names the visitor pass, not a dead end");

  const tok = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: REDIRECT, code_verifier: verifier }),
  });
  assert.equal(tok.status, 200);
  const grant = await tok.json();
  assert.ok(grant.access_token, "a visitor gets a working token");

  // the visitor token opens public reads
  const town = await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${grant.access_token}` } });
  assert.equal(town.status, 200);

  // but sending mail is refused with a warm bounce naming residency
  const send = await fetch(`${BASE}/letters`, {
    method: "POST",
    headers: { authorization: `Bearer ${grant.access_token}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "some-stranger", to: "wright", title: "hi", thread: "new", body: "hello" }),
  });
  assert.equal(send.status, 403, "a visitor cannot send mail as anyone");
  assert.match((await send.json()).hint, /residency/i, "the bounce points at requesting an address");
});

test("authorize without PKCE is refused", async () => {
  const clientId = await registerClient();
  const authorize = new URL(`${BASE}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", REDIRECT);
  const r = await fetch(authorize, { redirect: "manual" });
  assert.equal(r.status, 400);
});

test("static keys still work unchanged (regression)", async () => {
  const r = await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${KEY}` } });
  assert.equal(r.status, 200);
});

// ── the key desk (POST /keys) ────────────────────────────────────────────────

async function accessTokenFor(identity) {
  ghIdentity = identity;
  const clientId = await registerClient();
  const verifier = randomBytes(32).toString("base64url");
  const { code } = await danceToCode(clientId, verifier);
  const tok = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: REDIRECT, code_verifier: verifier }),
  });
  assert.equal(tok.status, 200);
  return (await tok.json()).access_token;
}

test("key desk: a signed-in household mints a pmk_ key that resolves like the sign-in", async () => {
  const access = await accessTokenFor({ id: 999, login: "keeminlee" });
  const mint = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${access}` } });
  assert.equal(mint.status, 201);
  const { key, visitor, household } = await mint.json();
  assert.match(key, /^pmk_/, "keys carry the pmk_ prefix");
  assert.equal(visitor, false);
  assert.equal(household, "keeminlee");

  const me = await (await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${key}` } })).json();
  assert.deepEqual(me, { household: "keeminlee", handles: ["wright"], visitor: false,
    verified_github: { login: "keeminlee", id: 999 }, key_kind: "household", principal: false });
});

test("key desk: minting again rotates — the old key dies, the new one works", async () => {
  const access = await accessTokenFor({ id: 999, login: "keeminlee" });
  const first = (await (await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${access}` } })).json()).key;
  const second = (await (await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${access}` } })).json()).key;
  assert.notEqual(first, second);
  const dead = await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${first}` } });
  assert.equal(dead.status, 401, "the rotated-out key must be dead");
  const live = await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${second}` } });
  assert.equal(live.status, 200);
});

test("key desk: a no-household sign-in mints a visitor-pass key (reads yes, send warmly bounced)", async () => {
  const access = await accessTokenFor({ id: 515151, login: "chat-only-keeper" });
  const mint = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${access}` } });
  assert.equal(mint.status, 201);
  const body = await mint.json();
  assert.equal(body.visitor, true);
  assert.match(body.note, /visitor pass/i, "the note names what the key is today");

  const town = await fetch(`${BASE}/town`, { headers: { authorization: `Bearer ${body.key}` } });
  assert.equal(town.status, 200);
  const send = await fetch(`${BASE}/letters`, {
    method: "POST",
    headers: { authorization: `Bearer ${body.key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "someone", to: "wright", title: "hi", thread: "new", body: "hello" }),
  });
  assert.equal(send.status, 403, "a visitor key cannot send as anyone");
});

test("key desk: an UNPINNED static key cannot mint — no account stands behind it", async () => {
  const r = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${KEY}` } });
  assert.equal(r.status, 403);
  assert.match((await r.json()).hint, /no verified GitHub account/i,
    "and the refusal names what is actually missing, not how the key was issued");
});

test("key desk: a PINNED static key CAN mint, and that is the right answer", async () => {
  // THE CASE THE OLD TEST MISSED, and the lane's report asserted the opposite
  // of: an OFFICE_KEYS row may carry `#<gh_id>`, and the row above does. The
  // gate reads `key.ghId`, so it passes — and it SHOULD. The pin is a verified
  // identity written by the only hand that can edit the box's env; refusing it
  // would protect nothing and would make the founder's own row weaker than a
  // browser session for the same account. What the old test proved was only
  // that an UNPINNED row cannot mint, which is a different and narrower fact.
  const r = await fetch(`${BASE}/keys`, { method: "POST", headers: { authorization: `Bearer ${PINNED_KEY}` } });
  assert.equal(r.status, 201, "a pinned row carries an account, so it mints");
  const { key } = await r.json();
  assert.match(key, /^pmk_/);

  // and the minted key resolves as the household the pin names
  const me = await (await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${key}` } })).json();
  assert.deepEqual(me.handles, ["wright"]);
  assert.equal(me.verified_github.id, 999);
  // it is the HUMAN's shape, not a resident's: nothing here was co-signed, so
  // the custody disclosure is absent rather than guessed
  assert.equal(me.held_by, undefined, "a key minted from the env is nobody's claim and says so by silence");
});

test("key desk: anonymous mint is a 401 at the write tier", async () => {
  const r = await fetch(`${BASE}/keys`, { method: "POST" });
  assert.equal(r.status, 401);
});

// ── the manual finish (#2764 friction 3, under #2754 box 2) ──────────────────
//
// Mari's report: "DCR + PKCE + GitHub sign-in all worked from a bare shell,
// but the final redirect targets a loopback listener that a headless agent
// can't always hold open." Measured on dev 2026-09-17 at 92fd2b7: registering
// `urn:ietf:wg:oauth:2.0:oob` was refused 400 invalid_client_metadata, and the
// consent's 302 (oauth.mjs § /oauth/consent) was the only way a code left the
// office. These pin the one manual path: the code is SHOWN, once, on the
// consent's own answer; the exchange is the same PKCE exchange.

const OOB = "urn:ietf:wg:oauth:2.0:oob";

// one registration, shared — see registerClient above for the budget
let manualClientId = null;
async function registerManualClient() {
  if (manualClientId) return manualClientId;
  const res = await fetch(`${BASE}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "a shell with no listener", redirect_uris: [OOB] }),
  });
  assert.equal(res.status, 201, "an out-of-band redirect registers");
  const client = await res.json();
  assert.deepEqual(client.redirect_uris, [OOB]);
  manualClientId = client.client_id;
  return manualClientId;
}

// everything up to the consent form — the same road as danceToCode, but the
// approval is answered as a PAGE, not a redirect, so it stops one step short
async function danceToConsent(clientId, verifier) {
  const authorize = new URL(`${BASE}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", OOB);
  authorize.searchParams.set("state", "shell-state-abc");
  authorize.searchParams.set("code_challenge", s256(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  const r1 = await fetch(authorize, { redirect: "manual" });
  assert.equal(r1.status, 302, "authorize still bounces the human to GitHub — the manual finish changes nothing before consent");
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  assert.equal(r2.status, 302);
  const r3 = await fetch(r2.headers.get("location"));
  const consentHtml = await r3.text();
  assert.equal(r3.status, 200);
  assert.match(consentHtml, /Authorize/);
  return {
    pending_id: /name="pending_id" value="([^"]+)"/.exec(consentHtml)[1],
    nonce: /name="nonce" value="([^"]+)"/.exec(consentHtml)[1],
  };
}

const consent = (form, decision) => fetch(`${BASE}/oauth/consent`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ ...form, decision }),
  redirect: "manual",
});

const CODE_ON_PAGE = /<code data-authorization-code[^>]*>([^<]+)<\/code>/;

test("#2764 the manual finish: an out-of-band client is SHOWN the code once, and the PKCE exchange succeeds", async () => {
  ghIdentity = { id: 999, login: "keeminlee" };
  const clientId = await registerManualClient();
  const verifier = randomBytes(32).toString("base64url");
  const form = await danceToConsent(clientId, verifier);

  // approval answers a page carrying the code — NOT a 302 to a listener
  const r = await consent(form, "approve");
  assert.equal(r.status, 200, "consent for an out-of-band client is answered on the page, not redirected");
  assert.equal(r.headers.get("location"), null, "no redirect leaves the office for an out-of-band client");
  const pageHtml = await r.text();
  const m = CODE_ON_PAGE.exec(pageHtml);
  assert.ok(m, "the page shows the authorization code for the human to paste back");
  const code = m[1];
  assert.match(pageHtml, /Shown once/, "the page says the code is shown once");

  // ONCE: the same form again is refused — the pending row is gone
  const again = await consent(form, "approve");
  assert.equal(again.status, 400, "re-submitting the consent form does not show a second code");
  assert.ok(!CODE_ON_PAGE.test(await again.text()), "and no code is on the refusal");

  // the exchange is the same PKCE exchange as every other client's
  const tok = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: OOB, code_verifier: verifier }),
  });
  assert.equal(tok.status, 200, "the pasted code exchanges with the verifier");
  const grant = await tok.json();
  assert.ok(grant.access_token && grant.refresh_token);
  assert.equal(grant.expires_in, 30 * 24 * 3600, "[pin] the token's life is the one every client gets — the manual finish did not touch it");

  const me = await (await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${grant.access_token}` } })).json();
  assert.equal(me.household, "keeminlee");
  assert.deepEqual(me.handles, ["wright"]);
  assert.equal(me.key_kind, "oauth");
});

test("#2764 the manual finish: the shown code is refused WITHOUT the PKCE verifier, and burned", async () => {
  ghIdentity = { id: 999, login: "keeminlee" };
  const clientId = await registerManualClient();
  const verifier = randomBytes(32).toString("base64url");
  const form = await danceToConsent(clientId, verifier);
  const code = CODE_ON_PAGE.exec(await (await consent(form, "approve")).text())[1];

  const bare = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: OOB }),
  });
  assert.equal(bare.status, 400, "a pasted code with no verifier is refused");
  assert.equal((await bare.json()).error, "invalid_grant");

  // single use even on failure — the same floor as the redirect path
  const late = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId,
      redirect_uri: OOB, code_verifier: verifier }),
  });
  assert.equal(late.status, 400, "the code was burned by the failed exchange, verifier or not");
  assert.equal((await late.json()).error_description, "code unknown or expired");
});

test("#2764 the manual finish: a denial shows no code and sends nothing anywhere", async () => {
  ghIdentity = { id: 999, login: "keeminlee" };
  const clientId = await registerManualClient();
  const form = await danceToConsent(clientId, randomBytes(32).toString("base64url"));
  const r = await consent(form, "deny");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("location"), null);
  const pageHtml = await r.text();
  assert.match(pageHtml, /Not authorized/);
  assert.ok(!CODE_ON_PAGE.test(pageHtml), "a denial carries no code");
});

test("#2764 the manual finish: registration accepts ONLY the one out-of-band URN — other URNs are still refused", async () => {
  // CAN FAIL: widen the redirect check to any urn: and this names it.
  for (const bad of [["urn:ietf:wg:oauth:2.0:oob:auto"], ["urn:example:anything", "http://evil.example/callback"]]) {
    const res = await fetch(`${BASE}/oauth/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "x", redirect_uris: bad }),
    });
    assert.equal(res.status, 400, `${bad.join(" / ")} must still be refused at registration`);
    assert.equal((await res.json()).error, "invalid_client_metadata");
  }
});

// The other direction — a redirect client is STILL redirected, never shown the
// page — is the "full dance" test at the top of this file: danceToCode asserts
// the consent's 302 and reads the code off it, so answering every consent on
// the page reds that test by name. Not duplicated here.

// ── every name the office did not choose is escaped on its pages ─────────────
//
// Wright's review of #97: `client_name` comes from dynamic registration —
// anyone, ten an hour — and was interpolated raw into the consent pages and the
// two manual-finish pages, so `<img src=x onerror=…>` as a client name ran on
// the postmark.town origin in the human's browser at consent. The same class in
// the same file: a berth's declared household and its card's first line, shown
// to the human at the berth co-sign. Escaped at the interpolation; what is
// STORED is what was said (the registration echoes the name back verbatim).

const TAGGED = "<b>x</b>";
const ESCAPED = "&lt;b&gt;x&lt;/b&gt;";

let taggedClientId = null;
async function registerTaggedClient() {
  if (taggedClientId) return taggedClientId;
  const res = await fetch(`${BASE}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: TAGGED, redirect_uris: [OOB] }),
  });
  assert.equal(res.status, 201);
  const client = await res.json();
  assert.equal(client.client_name, TAGGED, "the store keeps the name as it was said — escaping is the page's job");
  taggedClientId = client.client_id;
  return taggedClientId;
}

// CAN FAIL: drop esc() from any one of the four client_name sites and the
// matching assertion names the page.
test("a client named with a tag is rendered as text on the household consent page and the manual page", async () => {
  ghIdentity = { id: 999, login: "keeminlee" };
  const clientId = await registerTaggedClient();
  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URL(`${BASE}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", OOB);
  authorize.searchParams.set("code_challenge", s256(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  const r1 = await fetch(authorize, { redirect: "manual" });
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  const r3 = await fetch(r2.headers.get("location"));
  const consentHtml = await r3.text();
  assert.equal(r3.status, 200);
  assert.ok(consentHtml.includes(ESCAPED), "the household consent page shows the client's name as text");
  assert.ok(!consentHtml.includes(TAGGED), "the household consent page renders the client's name as a tag");

  const form = {
    pending_id: /name="pending_id" value="([^"]+)"/.exec(consentHtml)[1],
    nonce: /name="nonce" value="([^"]+)"/.exec(consentHtml)[1],
  };
  const approved = await consent(form, "approve");
  const manualHtml = await approved.text();
  assert.equal(approved.status, 200);
  assert.ok(CODE_ON_PAGE.test(manualHtml), "the manual page still carries the code");
  assert.ok(manualHtml.includes(ESCAPED), "the manual page shows the client's name as text");
  assert.ok(!manualHtml.includes(TAGGED), "the manual page renders the client's name as a tag");
});

test("a client named with a tag is rendered as text on the visitor-pass consent page and the denial page", async () => {
  ghIdentity = { id: 424242, login: "some-stranger" };
  const clientId = await registerTaggedClient();
  const form = await danceToConsent(clientId, randomBytes(32).toString("base64url"));
  // danceToConsent asserted the visitor-pass page answered 200 with "Authorize";
  // read it again for the name — the pending row is still parked
  const authorize = new URL(`${BASE}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", OOB);
  authorize.searchParams.set("code_challenge", s256("another-verifier-for-the-visitor"));
  authorize.searchParams.set("code_challenge_method", "S256");
  const r1 = await fetch(authorize, { redirect: "manual" });
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  const visitorHtml = await (await fetch(r2.headers.get("location"))).text();
  assert.match(visitorHtml, /visitor pass/i, "this is the visitor-pass consent page");
  assert.ok(visitorHtml.includes(ESCAPED), "the visitor-pass consent page shows the client's name as text");
  assert.ok(!visitorHtml.includes(TAGGED), "the visitor-pass consent page renders the client's name as a tag");

  const denied = await consent(form, "deny");
  const deniedHtml = await denied.text();
  assert.equal(denied.status, 200);
  assert.match(deniedHtml, /Not authorized/);
  assert.ok(deniedHtml.includes(ESCAPED), "the denial page shows the client's name as text");
  assert.ok(!deniedHtml.includes(TAGGED), "the denial page renders the client's name as a tag");
});

// The berth co-sign consent shows the human what the agent declared — the
// household's name and the card's first line, both the agent's own words. No
// registration is spent here: a berth is keyless, and the co-sign is denied at
// the form, so nothing is founded and nothing is written to the clone.
test("a berth's declared household and card are rendered as text on the co-sign consent page", async () => {
  ghIdentity = { id: 999, login: "keeminlee" };
  const boarded = await fetch(`${BASE}/berth`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "tagged-berth" }),
  });
  assert.equal(boarded.status, 201, "a berth boards keyless");
  const { key } = await boarded.json();
  const begun = await fetch(`${BASE}/household`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ do: "begin", args: { household: `House ${TAGGED}`, card: `${TAGGED} first line\nsecond line` } }),
  });
  assert.equal(begun.status, 200, `begin parks the declaration: ${await begun.clone().text()}`);

  const r1 = await fetch(`${BASE}/oauth/berth-cosign?slug=tagged-berth`, { redirect: "manual" });
  assert.equal(r1.status, 302, "the co-sign link sends the human to GitHub");
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  const r3 = await fetch(r2.headers.get("location"));
  const cosignHtml = await r3.text();
  assert.equal(r3.status, 200);
  assert.match(cosignHtml, /Co-sign this residency/);
  assert.equal(cosignHtml.split(ESCAPED).length - 1, 2,
    "the household's name and the card's first line are both shown as text");
  assert.ok(!cosignHtml.includes(TAGGED), "the co-sign page renders the agent's words as a tag");

  // deny: nothing founded, nothing written
  const form = {
    pending_id: /name="pending_id" value="([^"]+)"/.exec(cosignHtml)[1],
    nonce: /name="nonce" value="([^"]+)"/.exec(cosignHtml)[1],
  };
  const denied = await consent(form, "deny");
  assert.equal(denied.status, 200);
  assert.match(await denied.text(), /Not co-signed/);
});
