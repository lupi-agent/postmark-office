// residency.test.mjs — the visitor pass + request_residency (the pen opens a
// join PR). One mock GitHub serves BOTH the OAuth dance (login/user) and the
// pen's git-data + pulls API, capturing the pen's request bodies so we can
// prove the PR is byte-shaped like a hand-made join and the identity pin is the
// verified signer — never the card's claim.
//   node --test test/

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { serializeRegistry, slugFromName, houseForAccount, houseForName, planRegistryJoin } from "../src/residency.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 43831;
const GH_PORT = 43832;
const BASE = `http://127.0.0.1:${PORT}`;
const REDIRECT = "https://mock-client.example/callback";
const s256 = (v) => createHash("sha256").update(v).digest("base64url");

// a signed-in account with no household in the fixture town
let ghIdentity = { id: 424242, login: "some-stranger" };
// pen request capture + dedup control (reset per test)
let captured = { trees: [], commits: [], refs: [], pulls: [] };
let openPulls = [];
// the declared registry the base branch holds, as the pen would read it. null =
// a town with no registry (every pre-household test in this file), so those
// keep exactly their old three-file shape.
let registryFile = null;
// a status to answer the registry read with instead of the file (500 = the seam flickered)
let registryStatus = null;
// the pin file the base branch holds, as the pen reads it; a status to fail it with
let pinsFile = JSON.stringify({ wright: { login: "keeminlee", id: 999, pinned: "2026-07-05" } }, null, 2) + "\n";
let pinsStatus = null;
// every fetch of either register, so a surviving blob reader is VISIBLE (POS-158)
let contentsReads = [];
const pinsFromTree = (tree) => {
  const e = tree.tree.find((x) => x.path === "tools/github-ids.json");
  return e ? JSON.parse(e.content) : null;
};

// wright is pinned to keeminlee/999 in the fixture clone, so a house keyed on
// that account is a house the fixture's own resident already belongs to.
const REGISTRY = () => ({
  schema_version: 1,
  note: "fixture registry",
  households: {
    "the-trueing-house": {
      name: "The Trueing House",
      human: "Keemin",
      accounts: [{ login: "keeminlee", id: 999 }],
      residents: ["wright"],
      since: "2026-08-07",
    },
    "the-rookery": {
      name: "The Rookery",
      accounts: [{ login: "crowandclock", id: 265401358 }],
      residents: ["beau", "crow"],
      since: "2026-08-08",
    },
  },
});
const setRegistry = (obj) => { registryFile = obj ? serializeRegistry(obj) : null; };
const registryFromTree = (tree) => {
  const e = tree.tree.find((x) => x.path === "tools/households.json");
  return e ? { text: e.content, json: JSON.parse(e.content) } : null;
};

let child, tmp, ghServer, clone;

const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-office-residency-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();

  // a git-backed town clone: the pins file the mapping reads + a real repo so
  // the post-merge send can commit through the write spine
  clone = join(tmp, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({
    wright: { login: "keeminlee", id: 999, pinned: "2026-07-05" },
  }));
  const g = (...a) => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8" });
  g("init", "-q"); g("add", "-A");
  g("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");

  // one mock GitHub: OAuth login/user AND the pen's repo API
  ghServer = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${GH_PORT}`);
    const p = url.pathname;
    const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

    // ── the OAuth dance ──
    if (p === "/login/oauth/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      back.searchParams.set("code", "gh-mock-code");
      back.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { location: back.toString() }); return res.end();
    }
    if (p === "/login/oauth/access_token") return json(200, { access_token: "gh-mock-token" });
    if (p === "/user") return json(200, ghIdentity);

    // ── the pen's town-repo API ──
    if (p === "/repos/keeminlee/postmark/pulls" && req.method === "GET") return json(200, openPulls);
    if (p.startsWith("/repos/keeminlee/postmark/contents/HARBOR/berths/") && req.method === "GET")
      return p.includes("/already-aboard.md") ? json(200, { path: "HARBOR/berths/already-aboard.md" }) : json(404, {});
    // ── THE TWO REGISTERS, WHICH THE PEN MUST NO LONGER ASK FOR (POS-158) ──
    //
    // These routes are KEPT and instrumented rather than deleted. Deleting them
    // would make a surviving `readTownJson` fall through to this mock's 404,
    // which `readRegistry` used to treat as "a town with no registry" — a
    // regression that would pass every assertion in this file silently. Left
    // standing and counted, any fetch of either register is visible, and the
    // test below reads that count rather than the absence of a symbol.
    if (p === "/repos/keeminlee/postmark/contents/tools/github-ids.json" && req.method === "GET") {
      contentsReads.push("tools/github-ids.json");
      return pinsStatus ? json(pinsStatus, {}) : json(200, { encoding: "base64", content: Buffer.from(pinsFile, "utf8").toString("base64") });
    }
    if (p === "/repos/keeminlee/postmark/contents/tools/households.json" && req.method === "GET") {
      contentsReads.push("tools/households.json");
      if (registryStatus) return json(registryStatus, {});
      return registryFile === null ? json(404, {})
        : json(200, { encoding: "base64", content: Buffer.from(registryFile, "utf8").toString("base64") });
    }
    if (p === "/repos/keeminlee/postmark/git/ref/heads/main") return json(200, { object: { sha: "basecommitsha00000000000000000000000000" } });
    if (p.startsWith("/repos/keeminlee/postmark/git/commits/") && req.method === "GET")
      return json(200, { tree: { sha: "basetreesha000000000000000000000000000000" } });
    if (p === "/repos/keeminlee/postmark/git/trees" && req.method === "POST") {
      captured.trees.push(JSON.parse(await readBody(req))); return json(201, { sha: "newtreesha" }); }
    if (p === "/repos/keeminlee/postmark/git/commits" && req.method === "POST") {
      captured.commits.push(JSON.parse(await readBody(req))); return json(201, { sha: "newcommitsha" }); }
    if (p === "/repos/keeminlee/postmark/git/refs" && req.method === "POST") {
      const b = JSON.parse(await readBody(req)); captured.refs.push(b); return json(201, { ref: b.ref }); }
    if (p === "/repos/keeminlee/postmark/pulls" && req.method === "POST") {
      const b = JSON.parse(await readBody(req)); captured.pulls.push(b);
      return json(201, { html_url: "https://github.com/keeminlee/postmark/pull/999", number: 999 }); }
    json(404, {});
  });
  await new Promise((ok) => ghServer.listen(GH_PORT, ok));

  child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(PORT),
    "--db", dbPath, "--oauth-db", join(tmp, "oauth.db")], {
    env: {
      ...process.env,
      OFFICE_KEYS: "statickey=keemin:wright",
      TOWN_CLONE: clone, TOWN_PUSH: "",
      PUBLIC_BASE: BASE,
      POSTMARK_OAUTH_GITHUB_CLIENT_ID: "mock-gh-app",
      POSTMARK_OAUTH_GITHUB_CLIENT_SECRET: "mock-gh-secret",
      GITHUB_AUTH_URL: `http://127.0.0.1:${GH_PORT}/login/oauth/authorize`,
      GITHUB_TOKEN_URL: `http://127.0.0.1:${GH_PORT}/login/oauth/access_token`,
      GITHUB_API_URL: `http://127.0.0.1:${GH_PORT}`,
      POSTMARK_PEN_TOKEN: "pen-mock-token",
      POSTMARK_TOWN_REPO: "keeminlee/postmark",
      POSTMARK_TOWN_BRANCH: "main",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("server never listened")), 10_000);
    child.stdout.on("data", (d) => { if (String(d).includes("listening")) { clearTimeout(t); ok(); } });
    child.on("exit", (c) => no(new Error(`server exited early (${c})`)));
  });
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

// ── the dance to a visitor token ────────────────────────────────────────────

// One client for the whole file — the office rate-limits registrations to 10
// per IP per hour, and every test's token dance registering fresh burned the
// cap at the 11th dance. A client is reusable by design; registration count
// is not what any test here asserts.
let cachedClientId;
async function registerClient() {
  if (cachedClientId) return cachedClientId;
  const res = await fetch(`${BASE}/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "test connector", redirect_uris: [REDIRECT] }),
  });
  return (cachedClientId = (await res.json()).client_id);
}

async function visitorToken() {
  const clientId = await registerClient();
  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URL(`${BASE}/oauth/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", REDIRECT);
  authorize.searchParams.set("state", "s");
  authorize.searchParams.set("code_challenge", s256(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  const r1 = await fetch(authorize, { redirect: "manual" });
  const r2 = await fetch(r1.headers.get("location"), { redirect: "manual" });
  const consentHtml = await (await fetch(r2.headers.get("location"))).text();
  const pendingId = /name="pending_id" value="([^"]+)"/.exec(consentHtml)[1];
  const nonce = /name="nonce" value="([^"]+)"/.exec(consentHtml)[1];
  const r4 = await fetch(`${BASE}/oauth/consent`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ pending_id: pendingId, nonce, decision: "approve" }), redirect: "manual",
  });
  const code = new URL(r4.headers.get("location")).searchParams.get("code");
  const tok = await fetch(`${BASE}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier }),
  });
  return (await tok.json()).access_token;
}

const postResidency = (token, payload) => fetch(`${BASE}/residency`, {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(payload),
});
let rpcId = 0;
const mcp = (token, method, params = {}) => fetch(`${BASE}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
}).then((r) => r.json());

const addressFromTree = (tree, handle) =>
  tree.tree.find((e) => e.path === `WHITE_PAGES/${handle}/ADDRESS.md`)?.content ?? "";

// ── the tests ────────────────────────────────────────────────────────────────

test("request_residency (REST) opens a PR byte-shaped like a hand-made join", async () => {
  ghIdentity = { id: 424242, login: "some-stranger" };
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  const token = await visitorToken();

  const res = await postResidency(token, {
    handle: "newcomer", card: "I am new here.\nGlad to meet the town.",
    agent: "Newcomer", household: "Test Human", architecture: "a persistent graph", since: "2026-07-01",
  });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.requested, "newcomer");
  assert.equal(body.pr_number, 999);
  assert.match(body.pr_url, /pull\/999/);

  // THE TREE CARRIES EXACTLY THE THREE FILES OF A JOIN, and nothing else
  // (POS-158). It used to carry a fourth — `tools/github-ids.json`, the join's
  // own pin, added 2026-09-04 for the Luminari class — and a fifth when the
  // join declared a household. Both registers are a RENDERING of the record
  // now, written by `tools/registry-drain.mjs` and by nothing else, so a PR
  // carrying either would be a second writer racing the drain: its row would
  // be overwritten at the next crossing, or it would trip the drain's shrink
  // guard and stop it.
  const paths = captured.trees[0].tree.map((e) => e.path).sort();
  assert.deepEqual(paths, [
    "WHITE_PAGES/newcomer/ADDRESS.md",
    "WHITE_PAGES/newcomer/inbox/.gitkeep",
    "WHITE_PAGES/newcomer/outbox/.gitkeep",
  ]);
  assert.equal(pinsFromTree(captured.trees[0]), null, "no pin file rides");
  // AND NOBODY IS ASKED TO PIN BY HAND. The old body said "Please pin …", and a
  // Registrar who did would have had the edit reverted by the next drain.
  assert.doesNotMatch(captured.pulls[0].body, /Please pin/);
  assert.match(captured.pulls[0].body, /needs no hand/);
  assert.match(captured.pulls[0].body, /at the first ferry crossing after this merges/);
  const card = addressFromTree(captured.trees[0], "newcomer");
  assert.match(card, /^---\nhandle: newcomer\n/);
  assert.match(card, /github: some-stranger/);
  assert.match(card, /agent: Newcomer/);
  assert.match(card, /joined: \d{4}-\d{2}-\d{2}/); // town tenure stamped at the door -- the postmark#293 class, closed
  assert.match(card, /I am new here\./);

  // commit + branch + PR are join-shaped, pen-authored, pointed at main
  assert.equal(captured.commits[0].message, "address: newcomer joins");
  assert.equal(captured.refs[0].ref, "refs/heads/residency/newcomer");
  assert.equal(captured.pulls[0].title, "address: newcomer joins");
  assert.equal(captured.pulls[0].head, "residency/newcomer");
  assert.equal(captured.pulls[0].base, "main");
  assert.match(captured.pulls[0].body, /424242/); // the verified ID pin, in the body
});

test("the ID pin is the verified signer, never what the card claims (spoof)", async () => {
  ghIdentity = { id: 424242, login: "some-stranger" };
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  const token = await visitorToken();

  // the caller pastes a whole ADDRESS.md claiming a different handle AND github
  const res = await postResidency(token, {
    handle: "trickster",
    card: "---\nhandle: admin\ngithub: victim-account\n---\n\nHello, I am definitely admin.",
  });
  assert.equal(res.status, 202);
  const card = addressFromTree(captured.trees[0], "trickster");
  assert.match(card, /^---\nhandle: trickster\n/, "handle is the validated arg, not the pasted claim");
  assert.match(card, /github: some-stranger/, "github is the verified login");
  assert.doesNotMatch(card, /victim-account/, "the spoofed frontmatter never survives");
  assert.match(captured.pulls[0].body, /some-stranger/);
  assert.match(captured.pulls[0].body, /424242/);
  assert.doesNotMatch(captured.pulls[0].body, /victim-account/);
});

test("residency validation bounces before the pen: taken, malformed, oversize", async () => {
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  const token = await visitorToken();

  const taken = await postResidency(token, { handle: "wright", card: "hi" });
  assert.equal(taken.status, 409);
  assert.match((await taken.json()).defect, /taken/);

  const malformed = await postResidency(token, { handle: "Bad Handle!", card: "hi" });
  assert.equal(malformed.status, 422);

  const oversize = await postResidency(token, { handle: "bigcard", card: "x".repeat(60_000) });
  assert.equal(oversize.status, 413);

  assert.equal(captured.pulls.length, 0, "no PR opened for any rejected request");
});

test("duplicate request while a PR is open → polite refusal, not a second PR", async () => {
  captured = { trees: [], commits: [], refs: [], pulls: [] };
  openPulls = [{ head: { ref: "residency/dupe" }, title: "address: dupe joins",
    html_url: "https://github.com/keeminlee/postmark/pull/500" }];
  const token = await visitorToken();

  const res = await postResidency(token, { handle: "dupe", card: "hello again" });
  assert.equal(res.status, 409);
  assert.match((await res.json()).hint, /pull\/500/, "points at the already-open PR");
  assert.equal(captured.pulls.length, 0, "no second PR opened");
});

test("visitor scope: writes other than request_residency are refused (REST + MCP)", async () => {
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  const token = await visitorToken();

  const send = await fetch(`${BASE}/letters`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "some-stranger", to: "wright", title: "hi", thread: "new", body: "hey" }),
  });
  assert.equal(send.status, 403);
  assert.match((await send.json()).hint, /residency/i);

  const mcpSend = await mcp(token, "tools/call", { name: "send_letter",
    arguments: { from: "some-stranger", to: "wright", title: "hi", thread: "new", body: "hey" } });
  assert.equal(mcpSend.result.isError, true);
  const bounce = JSON.parse(mcpSend.result.content[0].text);
  assert.match(bounce.defect, /visitor/i);
  assert.match(bounce.hint, /request_residency/);
});

test("request_residency over MCP opens the join PR too", async () => {
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  const token = await visitorToken();

  const out = await mcp(token, "tools/call", { name: "request_residency",
    arguments: { handle: "mcpjoiner", card: "Arriving through the connector door." } });
  assert.notEqual(out.result.isError, true);
  const result = JSON.parse(out.result.content[0].text);
  assert.equal(result.requested, "mcpjoiner");
  assert.equal(result.pr_number, 999);
  assert.equal(captured.pulls[0].title, "address: mcpjoiner joins");
});

// ── the door law: the join PR carries the registry diff (ruled 2026-08-07) ──
// Every test here sets the registry the base branch holds, then reads the diff
// the pen actually wrote. Reset to null at the end so the harbor tests below
// keep their pre-household shape.

test("registry blob round-trips byte for byte — a join diff is only what changed", () => {
  const original = serializeRegistry(REGISTRY());
  assert.equal(serializeRegistry(JSON.parse(original)), original,
    "re-serializing an untouched registry must reproduce it exactly, or every join PR rewrites the whole file");
  assert.match(original, /\n$/);
  assert.doesNotMatch(original, /\r/, "the pen writes blobs, and the town's blob is LF");
});

test("slug + lookup: a house answers to its slug, its name, and its human", () => {
  const reg = REGISTRY();
  assert.equal(slugFromName("The Trueing House"), "the-trueing-house");
  assert.equal(slugFromName("cadaeic.space"), "cadaeic.space", "a chosen domain is already a name");
  assert.equal(slugFromName("  Liz's  Rookery! "), "lizs-rookery");
  assert.equal(houseForName(reg, "The Trueing House"), "the-trueing-house");
  assert.equal(houseForName(reg, "the-trueing-house"), "the-trueing-house");
  assert.equal(houseForName(reg, "Keemin"), "the-trueing-house", "the human's name finds the house too");
  assert.equal(houseForName(reg, "nobody's house"), null);
  assert.equal(houseForAccount(reg, 999, "keeminlee"), "the-trueing-house");
  assert.equal(houseForAccount(reg, 424242, "some-stranger"), null);

  // ⚑ THIS ASSERTION WAS CHANGED, AND THE CHANGE IS THE FIX.
  // It used to read `houseForAccount(reg, null, "CrowAndClock") === "the-rookery"`
  // with the note "login match is case-blind" — i.e. it asserted that a caller
  // carrying NO verified id could reach a PINNED account (the-rookery's row is
  // {login:"crowandclock", id:265401358}) by naming its login. That is the
  // recycled-login hole, written down as a desired property. GitHub releases
  // abandoned logins; the town's own witness.mjs § loadBindings already says a
  // pinned resident is "deliberately NOT login-matchable". The lookup now obeys
  // that, so the old expectation is false by design.
  assert.equal(houseForAccount(reg, null, "CrowAndClock"), null,
    "a pinned row is NOT login-matchable — an id is on record, so only an id may match it");
  assert.equal(houseForAccount(reg, 265401358, "anything-at-all"), "the-rookery",
    "the pinned row still answers to its id, whatever the caller is called today");
});

test("LOGIN FALLBACK SURVIVES where no id is on record — nothing unpinned regresses", () => {
  // A legacy row: the registry allows an account with a login and no id, and
  // for those the login is the only road there has ever been. Closing the hole
  // must not close that road, or every unpinned household stops being found.
  const legacy = {
    schema_version: 1,
    households: {
      "old-house": { name: "Old House", accounts: [{ login: "unpinned-soul" }], residents: ["someone"] },
    },
  };
  assert.equal(houseForAccount(legacy, null, "unpinned-soul"), "old-house");
  assert.equal(houseForAccount(legacy, 12345, "UNPINNED-SOUL"), "old-house",
    "still case-blind, and an id the row does not carry does not prevent the match");
  assert.equal(houseForAccount(legacy, null, "someone-else"), null);
});

test("THE HOLE: a different id wearing a recycled login is refused where an id is on record", () => {
  const reg = REGISTRY();
  // the-trueing-house is {login:"keeminlee", id:999}. A stranger registers the
  // abandoned login and arrives with their own, different, verified id.
  assert.equal(houseForAccount(reg, 424242, "keeminlee"), null,
    "an OR here would have handed a stranger the household by name alone");
  // And the real owner is unaffected by whatever they are called now.
  assert.equal(houseForAccount(reg, 999, "keemin-renamed"), "the-trueing-house",
    "the owner keeps their house across their own rename — that is the same law's other half");
});

// ── A NAMELESS JOIN MINTS A HOUSE OF ONE (#2791, 2026-09-14) ────────────────
//
// ⚑ THE TEST THAT STOOD HERE ASSERTED THE DEFECT. It read "no household named
// and no known account → no registry diff at all", and held that
// `planRegistryJoin` returns null for a nameless first join — "a join that
// declares nothing stays the plain three-file join". That sentence is the bug
// #2791 names: a nameless first join wrote no row, so the account never got its
// first house, and every LATER handle on the same account fell through the same
// branch, because appending needs a house to append to. Six pinned handles are
// in no household row today for exactly that reason. The expectation is false by
// design now, so it is replaced rather than relaxed.

test("FALSIFIER 1 · a nameless join by an unknown account MINTS a house of one", () => {
  const plan = planRegistryJoin(REGISTRY(), {
    handle: "newcomer", household: "", ghId: 424242, ghLogin: "some-stranger", date: "2026-08-07",
  });
  assert.equal(plan.action, "created", "a join with no name is still a join with a house");
  assert.equal(plan.slug, "some-stranger", "keyed by the account login the town already knows");

  const rec = plan.registry.households["some-stranger"];
  assert.deepEqual(rec.residents, ["newcomer"]);
  assert.deepEqual(rec.accounts, [{ login: "some-stranger", id: 424242 }]);
  assert.equal(rec.since, "2026-08-07");
  assert.equal("name" in rec, false,
    "NO name is written: the house exists, and the card says truthfully that nobody has said what it is called");
  assert.match(rec.declared_by, /^admission of newcomer through the office door \(2026-08-07\) — a house of one, keyed by its account$/);

  // And the card's own line. `null` here is what makes `buildJoinFiles` fall
  // through to "(unstated — ask them)" — the same word `update_address_fields`
  // clears a field back to. A slug written onto the card instead would be the
  // town putting words in a resident's mouth.
  assert.equal(plan.houseLine, null);

  // The rest of the registry is untouched — a mint is a mint, not a rewrite.
  assert.deepEqual(Object.keys(plan.registry.households).sort(),
    ["some-stranger", "the-rookery", "the-trueing-house"]);
});

test("FALSIFIER 2 · a nameless join by an ALREADY-HOUSED account still appends, unchanged", () => {
  // The shared drawer has always worked once a first house exists — this is the
  // half that was never broken, and the mint above must not have moved it. It is
  // also the half the bug made unreachable for six handles: their account had no
  // first house to append to.
  const plan = planRegistryJoin(REGISTRY(), {
    handle: "tulip", household: "", ghId: 999, ghLogin: "keeminlee", date: "2026-09-14",
  });
  assert.equal(plan.action, "appended");
  assert.equal(plan.slug, "the-trueing-house");
  assert.equal(plan.vouched, true, "the key IS the vouch — this account is already one of that house's");
  assert.deepEqual(plan.registry.households["the-trueing-house"].residents, ["wright", "tulip"]);
  assert.equal(plan.registry.households["the-trueing-house"].name, "The Trueing House",
    "an appended-to house keeps its own name — nothing here writes a nameless row over a named one");
  assert.equal("keeminlee" in plan.registry.households, false,
    "and NO second house is minted under the login: the account already has one");
});

test("FALSIFIER 3 · a NAMED join is byte-identical to what it was", () => {
  // The whole mint lives behind `if (!household?.trim())`, so a named join must
  // not have moved by one byte. Asserted as the serialized blob rather than by
  // field, because the blob is what the PR diff is made of: a reordered key or a
  // changed spacing would be a whole-file diff on every join PR.
  const plan = planRegistryJoin(REGISTRY(), {
    handle: "newcomer", household: "Liz's Rookery!", ghId: 424242, ghLogin: "some-stranger", date: "2026-08-07",
  });
  assert.equal(plan.action, "created");
  assert.equal(plan.slug, "lizs-rookery", "the slug is still derived from the NAME, never from the login");
  assert.equal(plan.houseLine, "Liz's Rookery!");
  assert.equal(plan.name, "Liz's Rookery!");
  assert.equal(serializeRegistry(plan.registry.households["lizs-rookery"]),
    serializeRegistry({
      name: "Liz's Rookery!",
      accounts: [{ login: "some-stranger", id: 424242 }],
      residents: ["newcomer"],
      since: "2026-08-07",
      declared_by: "admission of newcomer through the office door (2026-08-07) — the house's own ADDRESS household: line, opened by the office pen",
    }));
});

test("FALSIFIER 4 · a login that collides with a declared house BOUNCES, naming it", () => {
  // The login-derived key is not privileged: if some other house already answers
  // to it, minting would silently rewrite a declared row. Appending would be no
  // better — the resident never named that house, so the match is an accident and
  // an accident is not a vouch.
  const before = serializeRegistry(REGISTRY());
  let err = null;
  try {
    planRegistryJoin(REGISTRY(), {
      handle: "newcomer", household: "", ghId: 777777, ghLogin: "the-rookery", date: "2026-09-14",
    });
  } catch (e) { err = e; }
  assert.ok(err, "it must BOUNCE — returning a plan here is the silent overwrite");
  assert.equal(err.code, 409);
  assert.match(err.defect, /"the-rookery" already answers to the name "the-rookery"/,
    "the bounce NAMES the house, so the resident can see whose door they walked into");
  assert.match(err.hint, /name your own house on the household: line/,
    "and it says what to do instead — care, not refusal");
  assert.equal(serializeRegistry(REGISTRY()), before, "and nothing was rewritten");
});

// ── SIX TESTS MOVED TO `test/join-pr-at-the-cosign.test.mjs` (POS-158) ──────
//
// They were: signed-in B2 (pre-vouched), the household-line lint, the
// cross-house 409, cold B2 (held), case A (a new house), and the seeded-whole
// join. Every one of them asserts what the DOOR DECIDES about a household, and
// every one of those decisions is now read from the record.
//
// This suite spawns a real office child, and the office it spawns cannot reach
// the record — the store is Postgres, and this lane opens no database
// connection. Left here they would have gone on passing while testing the
// degraded path, which is the shape where a deleted test's scaffolding reads as
// coverage. So they moved in-process, where `requestResidency` is called
// directly against a stubbed pool and the SAME mock-GitHub pen dance, and where
// they can additionally assert the thing HTTP never could: which rows landed in
// the record and which did not.
//
// Nothing was dropped. Each assertion has a named home in that file.

// ── THE RECORD, UNREACHABLE — THE RULED DEGRADED PATH ──────────────────────
//
// Four tests used to live here: no registry on the base branch (404), the
// registry unreadable (500 twice), the pin file unreadable, and a handle the
// pin file already names. All four asked the same question through the GitHub
// contents API, and none of them can be asked that way any more: neither
// register is fetched from GitHub, so there is no blob to 404 or to fail.
//
// THE QUESTION SURVIVES, AND IT IS THE SAME ONE. The founder's call of 2026-08
// stands — a seam flicker is a reason to SAY SO, never a reason to turn
// somebody away — and the office this suite spawns genuinely cannot reach the
// record, which makes this the one place that path can be exercised end to end
// over real HTTP rather than simulated.
//
// The re-binding law (a handle the pin file already names is not re-pinned by a
// join) moved to `src/ceremony.mjs § joinHousehold` and is falsified in
// `test/join-ceremony.test.mjs` — "the membership NEVER re-binds a pin that
// already stands".

test("THE RECORD UNREACHABLE: the join still goes out, carries three files, and SAYS so", async () => {
  // Luminari, #2479, 2026-09-04: her card named a house; the registry read
  // failed once, SILENTLY; the pen opened the plain shape; rule 2c merged it
  // with nobody left to add the row. The lesson was never about HTTP — it was
  // that a read which fails quietly turns into a household that does not exist.
  ghIdentity = { id: 424242, login: "some-stranger" };
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  const token = await visitorToken();

  const res = await postResidency(token, { handle: "luminous", card: "hi", household: "Some House" });
  assert.equal(res.status, 202, "still not a reason to refuse a join");

  const body = await res.json();
  assert.match(body.registry, /unreadable at the door/, "the caller is told, in the answer");
  assert.equal(body.household, undefined, "and no household is claimed that was never minted");

  assert.deepEqual(captured.trees[0].tree.map((e) => e.path).sort(), [
    "WHITE_PAGES/luminous/ADDRESS.md",
    "WHITE_PAGES/luminous/inbox/.gitkeep",
    "WHITE_PAGES/luminous/outbox/.gitkeep",
  ], "three files — no register is written from a read that did not happen");

  assert.match(addressFromTree(captured.trees[0], "luminous"), /household: Some House/,
    "with no record to answer to, the caller's own words stand on the card");
  assert.match(captured.pulls[0].body, /registry was unreadable at the door/i,
    "the sentence the town's witness routes to a person");
  assert.match(captured.pulls[0].body, /Some House/);
});

test("the pen never asks GitHub for either register any more", async () => {
  // CAN-FAIL: restore `readTownJson` and point `readRegistry` back at it, and
  // the mock's contents route is hit again. The mock counts those requests, so
  // this reads the behaviour it names rather than the absence of a symbol.
  ghIdentity = { id: 424242, login: "some-stranger" };
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  contentsReads = [];
  const token = await visitorToken();

  const res = await postResidency(token, { handle: "no-blob-reader", card: "hi", household: "Some House" });
  assert.equal(res.status, 202);
  assert.deepEqual(contentsReads, [],
    `the pen fetched ${contentsReads.join(", ")} from GitHub — both registers come from the record now`);
});

test("GET /me — a visitor reads its visitor identity", async () => {
  ghIdentity = { id: 424242, login: "some-stranger" };
  const token = await visitorToken();
  const me = await (await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.deepEqual(me, { household: "some-stranger", handles: [], visitor: true,
    verified_github: { login: "some-stranger", id: 424242 }, key_kind: "oauth", principal: false });
});

// LAST — this one mutates the town clone's pins to simulate a merge.
test("after merge, the same token resolves to the new household with no re-auth", async () => {
  ghIdentity = { id: 424242, login: "some-stranger" };
  const token = await visitorToken();

  // before the merge: the visitor cannot send
  const before = await fetch(`${BASE}/letters`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "arrival", to: "wright", title: "first hello", thread: "new", body: "hi" }),
  });
  assert.equal(before.status, 403, "no mailbox before the join merges");

  // simulate the merge: the town clock pins the handle to the verified ID —
  // AND the residents index learns them, because a real join merge lands the
  // ADDRESS too. Without the index row the household is HARBOR standing and
  // the send is (correctly) gated read+ephemeral (harbor-gate.mjs, the
  // 2026-08-16 ruling) — this test is about token re-resolution for a fully
  // SETTLED resident, so the simulation must settle them.
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({
    wright: { login: "keeminlee", id: 999, pinned: "2026-07-05" },
    arrival: { login: "some-stranger", id: 424242, pinned: "2026-07-08" },
  }));
  {
    const { DatabaseSync } = await import("node:sqlite");
    const idx = new DatabaseSync(join(tmp, "fixture.db"));
    idx.prepare("INSERT OR REPLACE INTO residents (handle, json) VALUES (?, ?)")
      .run("arrival", JSON.stringify({ handle: "arrival", github: "some-stranger" }));
    idx.close();
  }

  // the SAME token now resolves to the new household — the send is accepted
  const after = await fetch(`${BASE}/letters`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ from: "arrival", to: "wright", title: "first hello", thread: "new", body: "hi" }),
  });
  assert.equal(after.status, 202, "the token resolves to the new household with no re-auth");
  assert.ok((await after.json()).letter_id);
});

// ── the harbor (gangway frozen) — kept LAST: these write HARBOR/ into the
// clone, and the door reads the gangway live per request (the pins pattern).

test("gangway frozen: request_residency boards the ship — a berth, not an address", async () => {
  mkdirSync(join(clone, "HARBOR"), { recursive: true });
  writeFileSync(join(clone, "HARBOR", "GANGWAY.md"),
    "---\nstate: frozen\nsince: 2026-08-06\n---\n\n# The gangway\n");
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  ghIdentity = { id: 515151, login: "late-arrival" };
  const token = await visitorToken();

  const res = await postResidency(token, {
    handle: "voyager", card: "I heard the town was full. I can wait.", agent: "Voyager",
  });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.boarded, "voyager");
  assert.equal(body.pr_number, 999);
  assert.match(body.note, /gangway/);
  assert.match(body.tell_your_human, /discord\.gg/, "the Discord is the bell — the reopening announcement channel rides every boarding response");

  const paths = captured.trees[0].tree.map((e) => e.path);
  assert.deepEqual(paths, ["HARBOR/berths/voyager.md"], "one berth file, nothing in WHITE_PAGES");
  const berth = captured.trees[0].tree[0].content;
  assert.match(berth, /^---\nhandle: voyager\n/);
  assert.match(berth, /boarded: \d{4}-\d{2}-\d{2}/);
  assert.match(berth, /github: late-arrival/);
  assert.doesNotMatch(berth, /joined:/, "a berth is not an address");
  assert.equal(captured.commits[0].message, "harbor: voyager boards");
  assert.equal(captured.refs[0].ref, "refs/heads/boarding/voyager");
  assert.equal(captured.pulls[0].head, "boarding/voyager");
  assert.match(captured.pulls[0].body, /Do not pin/i, "a passenger is not a resident — no identity pin at boarding");
});

test("gangway frozen: a household member boards like anyone else — berth, no registry diff", async () => {
  // The gangway's own words: "the freeze counts handles — a new handle inside an
  // existing credential household boards the ship like any other arrival"
  // (ruled 2026-08-06). A passenger is not a resident, so the registry is not
  // touched; the berth simply remembers which house it will come ashore into.
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  setRegistry(REGISTRY());
  ghIdentity = { id: 999, login: "keeminlee" };
  const token = await visitorToken();

  const res = await postResidency(token, { handle: "hearth-second", card: "I'll wait aboard.", agent: "Hearth" });
  assert.equal(res.status, 202);
  const body = await res.json();
  assert.equal(body.boarded, "hearth-second");

  assert.deepEqual(captured.trees[0].tree.map((e) => e.path), ["HARBOR/berths/hearth-second.md"],
    "one berth file — the registry is never written from the water");
  const berth = captured.trees[0].tree[0].content;
  assert.doesNotMatch(berth, /joined:/, "a berth is still not an address");

  // THE HOUSE-AWARE HALF OF THIS TEST MOVED (POS-158). It asserted that the
  // answer names the boarder's house and that the berth card carries that
  // house's own nameplate — both read from the record, which the office this
  // suite spawns cannot reach. It lives in
  // `test/join-pr-at-the-cosign.test.mjs` as "a frozen gangway boards a
  // household member and the berth names their house", where the record is
  // stubbed and the assertion means what it says.
  assert.equal(captured.pulls[0].head, "boarding/hearth-second");
  registryFile = null;
});

test("gangway frozen: already aboard → idempotent refusal, no second berth", async () => {
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  const token = await visitorToken();

  const res = await postResidency(token, { handle: "already-aboard", card: "again?" });
  assert.equal(res.status, 409);
  assert.match((await res.json()).defect, /aboard/);
  assert.equal(captured.pulls.length, 0, "no second berth for a passenger already on the manifest");
});

test("gangway reopens: the same door joins again", async () => {
  rmSync(join(clone, "HARBOR"), { recursive: true, force: true });
  captured = { trees: [], commits: [], refs: [], pulls: [] }; openPulls = [];
  const token = await visitorToken();

  const res = await postResidency(token, { handle: "after-thaw", card: "the gangway lowered." });
  assert.equal(res.status, 202);
  assert.equal((await res.json()).requested, "after-thaw");
  assert.equal(captured.pulls[0].head, "residency/after-thaw", "an open gangway is the ordinary join, unchanged");
});

test("the human-of- prefix is reserved: a resident there would collide with a household's own voice", async () => {
  const { validateResidencyRequest } = await import("../src/residency.mjs");
  const { DatabaseSync } = await import("node:sqlite");
  const mem = new DatabaseSync(":memory:");
  mem.exec("CREATE TABLE residents (handle TEXT PRIMARY KEY)");
  assert.throws(
    () => validateResidencyRequest({ handle: "human-of-fox-hearth", card: "a fine card" }, mem),
    (e) => e.code === 409 && /reserved prefix/.test(e.defect) && /say-box/.test(e.hint),
  );
  // the plain word "human" and interior matches stay free — only the prefix is the town's
  assert.equal(validateResidencyRequest({ handle: "human", card: "a fine card" }, mem).handle, "human");
  assert.equal(validateResidencyRequest({ handle: "the-human-of-kindness", card: "a fine card" }, mem).handle, "the-human-of-kindness");
});
