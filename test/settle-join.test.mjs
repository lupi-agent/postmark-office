// settle-join.test.mjs — the Registrar settles a merged pen join (town #3231).
//
// RULED (Keemin, 2026-09-28): the join PR stays a request; the Registrar
// settles merged pen joins through one narrow office door, which runs
// `joinHousehold` only for a join the pen opened and the Registrar merged, and
// re-checks the vouch against the record at write time.
//
// THE PATH UNDER TEST IS THE REAL ONE: the real door, the real ceremony, the
// real store module over the in-memory pool (`test/registry-pool-stub.mjs`),
// and the real registry drain committing through the real `penCommit` into a
// temp git clone. Only two things stand in: GitHub, which is a mock server the
// pen's own client is pointed at (a suite never reaches GitHub), and the town
// lock's subprocess, which is replaced by an in-process call to the same
// critical section (`settleUnderLock`) the exec runs.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { withRecordFrom, RECORD_ON } from "./registry-pool-stub.mjs";
import { settleJoinAtOffice, settleUnderLock, SETTLE_REFUSALS, PEN_GH_ID, penIdentity, joinOfMergedPR, judgeJoinPR, ledgerKnowsUnbound } from "../src/settle-join.mjs";
import { settlePass } from "../deploy/settle-pass.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";

// THE PORT IS ASKED FOR, NEVER CHOSEN (join-pr-at-the-cosign.test.mjs § the
// port). This was 43947, "checked against every port literal in test/", and
// still a lock on a door the whole box shares: the file lives in all five pool
// trees, and under parallel pool runs on 2026-10-01 it went red 3 of 8 (a 418
// from another tree's stub, a fetch failed, one 300 s hang). The fake GitHub
// listens on 0, and the port the OS handed back is what the pen dials.

// ── a mock GitHub, exactly as wide as the door's and the pass's reads ───────
//
// `pulls` are the town's PRs; `files[n]` a PR's files; `cards[handle]` the
// card at its merge; `users[login]` the account a login resolves to. Anything
// else answers 418, so a read nobody expected fails loudly.
let pulls = [];
let files = {};
let cards = {};
let users = {};
let asked = [];
let server;
before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    asked.push(`${req.method} ${p}${url.search}`);
    const send = (code, body) => { res.writeHead(code, { "content-type": "application/json", connection: "close" }); res.end(JSON.stringify(body)); };
    if (req.method !== "GET") return send(418, {});
    if (p.endsWith("/pulls") && url.searchParams.get("head")) {
      const ref = url.searchParams.get("head").split(":")[1];
      return send(200, pulls.filter((pr) => pr.head.ref === ref));
    }
    if (p.endsWith("/pulls")) {
      const page = Number(url.searchParams.get("page") ?? 1);
      return send(200, page === 1 ? pulls.filter((pr) => pr.state === "closed") : []);
    }
    const f = /\/pulls\/(\d+)\/files$/.exec(p);
    if (f) return files[f[1]] ? send(200, files[f[1]]) : send(404, {});
    const c = /\/contents\/WHITE_PAGES\/([^/]+)\/ADDRESS\.md$/.exec(p);
    if (c) return cards[c[1]] ? send(200, { encoding: "base64", content: Buffer.from(cards[c[1]]).toString("base64") }) : send(404, {});
    const u = /^\/users\/([^/]+)$/.exec(p);
    if (u) return users[u[1]] ? send(200, { login: u[1], id: users[u[1]] }) : send(404, { message: "Not Found" });
    return send(418, {});
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  PEN.apiBase = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((ok) => server.close(ok)); });

// `apiBase` is filled in by before(), once the fake GitHub has its port.
// `connection: close` on every answer above, for the reason join-pr's names:
// a pooled keep-alive socket closed between two tests dies mid-request.
const PEN = { apiBase: null, token: "a-mock-pen-token", owner: "postmark-town", repo: "postmark", baseBranch: "main" };

// The pen's own body, the shape `src/residency.mjs § joinBody` writes.
const penBody = (login, id) =>
  `Josie asks for an address in the town — opened by the office pen on their behalf.\n\n**Verified via GitHub sign-in:** \`@${login}\` (immutable id \`${id}\`). The identity pin comes from *this verified ID*.`;

const penPR = ({ n = 3217, handle = "wildcat", merged = true, author = PEN_GH_ID, body = penBody("commander-and-chief", 334016343) } = {}) => ({
  number: n, state: merged ? "closed" : "open", merged_at: merged ? "2026-09-28T06:16:01Z" : null, updated_at: "2026-09-28T06:16:01Z",
  merge_commit_sha: `merge${n}`,
  user: { id: author, login: author === PEN_GH_ID ? "postmark-pen" : "someone" },
  head: { ref: `residency/${handle}` }, body,
});

// A hand-written join: anyone's PR adding one address, from any branch.
const handPR = ({ n = 3239, handle = "vesper", author = { id: 334016343, login: "commander-and-chief" }, ref = `add-${handle}`, merged_at = "2026-09-29T10:00:00Z" } = {}) => ({
  number: n, state: "closed", merged_at, updated_at: merged_at, merge_commit_sha: `merge${n}`,
  user: author, head: { ref }, body: "hello, town",
});
const joinFiles = (handle) => [
  { filename: `WHITE_PAGES/${handle}/ADDRESS.md`, status: "added" },
  { filename: `WHITE_PAGES/${handle}/inbox/.gitkeep`, status: "added" },
];

// ── the town, as a temp git clone ───────────────────────────────────────────
const HOUSEHOLDS = () => ({
  schema_version: 1,
  households: {
    "house-of-many-doors": {
      name: "house-of-many-doors",
      accounts: [{ login: "commander-and-chief", id: 334016343 }],
      residents: ["kinofire"],
      since: "2026-09-25",
    },
    starforge: {
      name: "Starforge",
      accounts: [{ login: "keeminlee", id: 67605380 }],
      residents: ["registrar", "wright"],
      since: "2026-07-05",
    },
  },
});
const PINS = () => ({
  kinofire: { login: "commander-and-chief", id: 334016343, pinned: "2026-09-25" },
  registrar: { login: "keeminlee", id: 67605380, pinned: "2026-09-10" },
  wright: { login: "keeminlee", id: 67605380, pinned: "2026-07-18" },
});
const card = (handle, household, github = "commander-and-chief") =>
  `---\nhandle: ${handle}\nagent: Josie\nhousehold: ${household}\narchitecture: (unstated)\nsince: 2023-06-13\njoined: 2026-09-27\ngithub: ${github}\n---\n\nHello.\n`;

const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();

// A card is a house name, or `{ house, github }` for one whose github: is not the fixture human's.
function town({ households = HOUSEHOLDS(), pins = PINS(), cards = { wildcat: "house-of-many-doors" }, ledger = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "settle-join-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), JSON.stringify(households, null, 2) + "\n");
  writeFileSync(join(dir, PINS_PATH), JSON.stringify(pins, null, 2) + "\n");
  for (const [h, house] of Object.entries(cards)) {
    mkdirSync(join(dir, "WHITE_PAGES", h), { recursive: true });
    const c = typeof house === "string" ? { house } : house;
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), card(h, c.house, c.github));
  }
  if (ledger) writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), ledger);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed");
  return dir;
}

const REGISTRAR = { household: "keeminlee", handles: new Set(["registrar", "wright"]), ghId: 67605380, ghLogin: "keeminlee" };
const RESIDENT = { household: "commander-and-chief", handles: new Set(["kinofire"]), ghId: 334016343, ghLogin: "commander-and-chief" };

// The lock's child, in-process: the exec calls exactly this.
const inProcess = (payload, { clone, env }) => settleUnderLock({ ...payload, clone, env, date: "2026-09-28" });

async function settle(clone, key = REGISTRAR, handle = "wildcat") {
  asked = [];
  return withRecordFrom(clone, async (pool) => {
    try {
      const out = await settleJoinAtOffice({ handle }, key, { pen: PEN, clone, env: RECORD_ON, run: inProcess });
      return { out, pool };
    } catch (e) {
      return { err: e, pool };
    }
  });
}

// ── the falsifiers ──────────────────────────────────────────────────────────

test("a merged pen join with a vouched account settles: the pin and the membership in the record, both files rendered", async () => {
  pulls = [penPR()];
  const clone = town();
  const before = git(clone, "rev-parse", "HEAD");
  const { out, err, pool } = await settle(clone);
  assert.equal(err, undefined, err?.hint);
  assert.equal(out.settled, true);
  assert.deepEqual(out.pin, { handle: "wildcat", login: "commander-and-chief", gh_id: 334016343, pinned: "2026-09-28" });
  assert.deepEqual(out.house, { slug: "house-of-many-doors", name: "house-of-many-doors" });
  assert.equal(out.pr, 3217);

  const pin = pool.state.pins.find((p) => p.handle === "wildcat");
  assert.ok(pin, "the pin is a row in the record");
  assert.equal(String(pin.gh_id), "334016343");
  assert.deepEqual(pool.state.households.find((h) => h.slug === "house-of-many-doors").residents, ["kinofire", "wildcat"]);

  const pins = JSON.parse(readFileSync(join(clone, PINS_PATH), "utf8"));
  assert.equal(pins.wildcat.id, 334016343, "tools/github-ids.json is re-rendered with the pin");
  const reg = JSON.parse(readFileSync(join(clone, REGISTRY_PATH), "utf8"));
  assert.deepEqual(reg.households["house-of-many-doors"].residents, ["kinofire", "wildcat"], "tools/households.json is re-rendered with the membership");

  assert.notEqual(git(clone, "rev-parse", "HEAD"), before, "the drain made a commit");
  assert.equal(out.commit, git(clone, "rev-parse", "HEAD"));
  assert.deepEqual(git(clone, "show", "--name-only", "--format=", "HEAD").split("\n").sort(), [PINS_PATH, REGISTRY_PATH].sort(),
    "ONE pen commit carrying both files and nothing else");
  assert.equal(git(clone, "status", "--porcelain"), "", "nothing left unstaged");
});

test("a hand-written PR whose card names another account refuses — it is keyed by its AUTHOR's id", async () => {
  // Until 2026-09-29 any non-pen PR refused as "not the pen's". A hand-written
  // join is now settled too, keyed by its author, so this PR — opened by id
  // 424242, card saying github: commander-and-chief (id 334016343) — is refused
  // for the reason that matters: the card is somebody else's account.
  pulls = [penPR({ author: 424242 })];
  files = { 3217: joinFiles("wildcat") };
  cards = { wildcat: card("wildcat", "house-of-many-doors") };
  users = { "commander-and-chief": 334016343 };
  const clone = town();
  const { err, pool } = await settle(clone);
  assert.equal(err?.defect, SETTLE_REFUSALS.CARD_NOT_AUTHOR.defect);
  assert.match(err.hint, /id 334016343.*id 424242/);
  assert.equal(pool.state.writes.pins + pool.state.writes.households, 0);
});

test("an unmerged PR refuses", async () => {
  pulls = [penPR({ merged: false })];
  const clone = town();
  const { err, pool } = await settle(clone);
  assert.equal(err?.defect, SETTLE_REFUSALS.NOT_MERGED.defect);
  assert.equal(pool.state.writes.pins + pool.state.writes.households, 0);
});

test("an account the house never listed refuses — a person's call", async () => {
  pulls = [penPR({ body: penBody("a-stranger", 777777) })];
  const clone = town();
  const head = git(clone, "rev-parse", "HEAD");
  const { err, pool } = await settle(clone);
  assert.equal(err?.defect, SETTLE_REFUSALS.NOT_VOUCHED.defect);
  assert.match(err.hint, /id 777777/);
  assert.equal(pool.state.writes.pins + pool.state.writes.households, 0, "nothing reached the record");
  assert.equal(git(clone, "rev-parse", "HEAD"), head, "and nothing reached the town");
});

// A refusal names the act it was asked; compare everything else.
const strip = (r) => { const { defect, hint, ...rest } = r; return { ...rest, defect: defect.replace(/"[^"]*"/, "<act>"), hint }; };

test("a caller not on the list refuses, answered exactly as an act the door has never heard of", async () => {
  pulls = [penPR()];
  asked = [];
  const r = await householdApex({ do: "settle-join", args: { handle: "wildcat" } }, RESIDENT, {});
  const never = await householdApex({ do: "no-such-act", args: { handle: "wildcat" } }, RESIDENT, {});
  assert.equal(r.error, "bounce");
  assert.deepEqual(strip(r), strip(never), "the unlisted door does not advertise itself, even in a refusal");
  assert.doesNotMatch(JSON.stringify(r), /registrar|Registrar|settle a merged/);
  assert.deepEqual(asked, [], "and GitHub was not asked");

  const read = await householdApex({ read: "settle-join" }, REGISTRAR, {});
  const readNever = await householdApex({ read: "no-such-act" }, REGISTRAR, {});
  assert.deepEqual(strip(read), strip(readNever), "read: of the name is refused as any unknown read, even for a caller");
});

test("the door is unlisted: in no enum, no act index, no read roster", async () => {
  const m = await import("../src/household-apex.mjs");
  assert.equal(m.HOUSEHOLD_DISPATCHABLE.includes("settle-join"), false);
  assert.equal(m.HOUSEHOLD_READ_ENUM.includes("settle-join"), false);
  assert.doesNotMatch(JSON.stringify(m.HOUSEHOLD_TOOL), /settle-join/);
  assert.doesNotMatch(m.HOUSEHOLD_DESCRIPTION, /settle-join/);
});

test("a caller on the list reaches the door through the apex, with its fields judged", async () => {
  const clone = town();
  await withRecordFrom(clone, async () => {
    asked = [];
    const r = await householdApex({ do: "settle-join", args: { handle: "kinofire" } }, REGISTRAR, { pen: PEN, clone });
    assert.equal(r.did, "settle-join");
    assert.equal(r.result?.already_settled, true, JSON.stringify(r));
    assert.equal(r.card, undefined, "an unlisted act carries no card");
    assert.deepEqual(asked, [], "a pinned handle is answered from the record, without GitHub");
    const bad = await householdApex({ do: "settle-join", args: { handle: "kinofire", bogus: 1 } }, REGISTRAR, { pen: PEN, clone });
    assert.equal(bad.error, "bounce");
    assert.match(JSON.stringify(bad), /bogus/, "an unknown field is refused by name, like every act's");
  });
});

test("a second call answers 'already settled' and writes nothing", async () => {
  pulls = [penPR()];
  const clone = town();
  const first = await settle(clone);
  assert.equal(first.out?.settled, true, first.err?.hint);
  const head = git(clone, "rev-parse", "HEAD");

  // The next call reads the record the first one wrote: the files now hold the pin.
  const { out, err, pool } = await settle(clone);
  assert.equal(err, undefined, err?.hint);
  assert.equal(out.already_settled, true);
  assert.equal(out.settled, false);
  assert.equal(out.pin.gh_id, 334016343);
  assert.deepEqual(out.house, { slug: "house-of-many-doors", name: "house-of-many-doors" });
  assert.equal(pool.state.writes.pins + pool.state.writes.households, 0, "no second write");
  assert.equal(git(clone, "rev-parse", "HEAD"), head, "no second commit");
  assert.deepEqual(asked, [], "and GitHub was not asked");
});

// ── the rest of the refusals, each by name ──────────────────────────────────

test("a PR body with no verified-identity block refuses", async () => {
  pulls = [penPR({ body: "no identity here" })];
  const { err } = await settle(town());
  assert.equal(err?.defect, SETTLE_REFUSALS.NO_IDENTITY.defect);
});

test("no join PR at all refuses", async () => {
  pulls = [];
  const { err } = await settle(town());
  assert.equal(err?.defect, SETTLE_REFUSALS.NO_PR.defect);
});

test("a handle with no ADDRESS on town main refuses", async () => {
  pulls = [penPR()];
  const { err } = await settle(town({ cards: {} }));
  assert.equal(err?.defect, SETTLE_REFUSALS.NO_ADDRESS.defect);
});

test("a card naming no house in the record refuses", async () => {
  pulls = [penPR()];
  const { err } = await settle(town({ cards: { wildcat: "a-house-nobody-declared" } }));
  assert.equal(err?.defect, SETTLE_REFUSALS.NO_HOUSE.defect);
});

test("the identity parse is the witness's: id and login from the pen's block", () => {
  assert.deepEqual(penIdentity(penBody("commander-and-chief", 334016343)), { ghId: 334016343, ghLogin: "commander-and-chief" });
  assert.equal(penIdentity("immutable id 5 but no login line"), null);
});

test("the exec under the town lock answers ONE JSON line, and an unreachable record is a refusal, not a trip", async () => {
  const { execUnderTownLock } = await import("../src/town-lock.mjs");
  const clone = town();
  const env = { ...process.env, TOWN_CLONE: clone };
  delete env.WORLD2_PG; delete env.WORLD2_PG_URL; delete env.TOWN_PUSH;
  const out = await execUnderTownLock(join(import.meta.dirname, "..", "src", "settle-join-exec.mjs"),
    JSON.stringify({ handle: "wildcat", ghId: 334016343, ghLogin: "commander-and-chief", pr: 3217 }), env);
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]).error, {
    code: SETTLE_REFUSALS.NO_RECORD.code, defect: SETTLE_REFUSALS.NO_RECORD.defect, hint: SETTLE_REFUSALS.NO_RECORD.hint,
  });
});

// ── HAND-WRITTEN JOINS (Keemin, 2026-09-29) ─────────────────────────────────
//
// Keyed by the PR author's GitHub id (the API's `user.id`, never the card), and
// the card's `github:` must resolve to that same id. Driven through the same
// composition the tick's pass runs: `joinOfMergedPR`, then `settleUnderLock`.

async function byHand(clone, pr) {
  asked = [];
  return withRecordFrom(clone, async (pool) => {
    try {
      const found = await joinOfMergedPR(PEN, pr);
      const out = await settleUnderLock({ ...found, clone, env: RECORD_ON, date: "2026-09-29" });
      return { out, pool };
    } catch (e) {
      return { err: e, pool };
    }
  });
}

test("a merged hand-written PR from an account already on a house settles into that house", async () => {
  const pr = handPR();
  files = { 3239: joinFiles("vesper") };
  cards = { vesper: card("vesper", "(unstated — ask them)") };
  users = { "commander-and-chief": 334016343 };
  const clone = town({ cards: { vesper: "(unstated — ask them)" } });
  const { out, err, pool } = await byHand(clone, pr);
  assert.equal(err, undefined, err?.hint);
  assert.equal(out.settled, true);
  assert.equal(out.road, "hand");
  assert.deepEqual(out.house, { slug: "house-of-many-doors", name: "house-of-many-doors" }, "the account's own house");
  assert.equal(String(pool.state.pins.find((p) => p.handle === "vesper")?.gh_id), "334016343", "bound to the AUTHOR's id");
  assert.deepEqual(pool.state.households.find((h) => h.slug === "house-of-many-doors").residents, ["kinofire", "vesper"]);
  assert.equal(JSON.parse(readFileSync(join(clone, PINS_PATH), "utf8")).vesper.id, 334016343, "and printed");
});

test("a hand-written PR whose card names a house its author is not on is refused, and nothing is written", async () => {
  const pr = handPR({ author: { id: 777777, login: "a-stranger" } });
  files = { 3239: joinFiles("vesper") };
  cards = { vesper: card("vesper", "house-of-many-doors", "a-stranger") };
  users = { "a-stranger": 777777 };
  const clone = town({ cards: { vesper: { house: "house-of-many-doors", github: "a-stranger" } } });
  const head = git(clone, "rev-parse", "HEAD");
  const { err, pool } = await byHand(clone, pr);
  assert.equal(err?.defect, SETTLE_REFUSALS.OTHER_HOUSE.defect);
  assert.match(err.hint, /house-of-many-doors/);
  assert.equal(pool.state.writes.pins + pool.state.writes.households, 0, "nothing reached the record");
  assert.equal(git(clone, "rev-parse", "HEAD"), head, "and nothing reached the town");
});

test("an unknown account whose card names no existing house gets a house minted, as the pen road does", async () => {
  const pr = handPR({ author: { id: 555555, login: "new-human" } });
  files = { 3239: joinFiles("vesper") };
  cards = { vesper: card("vesper", "A Fresh Hearth", "new-human") };
  users = { "new-human": 555555 };
  const clone = town({ cards: { vesper: { house: "A Fresh Hearth", github: "new-human" } } });
  const { out, err, pool } = await byHand(clone, pr);
  assert.equal(err, undefined, err?.hint);
  assert.deepEqual(out.house, { slug: "a-fresh-hearth", name: "A Fresh Hearth" });
  const row = pool.state.households.find((h) => h.slug === "a-fresh-hearth");
  assert.deepEqual(row.accounts, [{ login: "new-human", id: 555555 }]);
  assert.deepEqual(row.residents, ["vesper"]);
  assert.equal(String(pool.state.pins.find((p) => p.handle === "vesper")?.gh_id), "555555");
});

test("a PR that is not a single-address join is not a join", () => {
  const pr = handPR();
  for (const bad of [
    [...joinFiles("vesper"), { filename: "tools/github-ids.json", status: "modified" }],
    [...joinFiles("vesper"), ...joinFiles("other")],
    [{ filename: "WHITE_PAGES/vesper/outbox/letter.md", status: "added" }],
    [{ filename: "WHITE_PAGES/vesper/ADDRESS.md", status: "modified" }],
  ]) assert.throws(() => judgeJoinPR(pr, bad), (e) => e.defect === SETTLE_REFUSALS.NOT_A_JOIN.defect, JSON.stringify(bad));
  assert.deepEqual(judgeJoinPR(pr, joinFiles("vesper")), { handle: "vesper", road: "hand", ghId: 334016343, ghLogin: "commander-and-chief" });
});

// ── THE LEDGER GUARD ────────────────────────────────────────────────────────

const MINTED_LEDGER = "- 2026-09-28 · MINT → wildcat · 5 · for: welcome:login:commander-and-chief · by: the-town · sig: x\n";

test("a handle the ledger already knows unbound is never bound here — the Wildcat red", async () => {
  pulls = [penPR()];
  const clone = town({ ledger: MINTED_LEDGER });
  const head = git(clone, "rev-parse", "HEAD");
  const { err, pool } = await settle(clone);
  assert.equal(err?.defect, SETTLE_REFUSALS.MINTED.defect);
  assert.equal(pool.state.writes.pins + pool.state.writes.households, 0);
  assert.equal(git(clone, "rev-parse", "HEAD"), head);
});

test("the guard reads the sealed line: a handle sealed to THIS id may be bound, one sealed elsewhere may not", () => {
  const clone = town({ ledger: MINTED_LEDGER + "- 2026-09-29 · registry: wildcat = gh:334016343 · sig: y\n" });
  assert.equal(ledgerKnowsUnbound(clone, "wildcat", 334016343), false, "sealed to this id");
  assert.equal(ledgerKnowsUnbound(clone, "wildcat", 999), true, "sealed to another id");
  assert.equal(ledgerKnowsUnbound(clone, "someone-new", 1), false, "no ledger lines at all");
  assert.equal(ledgerKnowsUnbound(town(), "wildcat", 334016343), false, "no ledger file");
});

// ── THE TICK'S PASS ─────────────────────────────────────────────────────────

const PASS_NOW = new Date("2026-09-29T00:00:00Z");
async function pass(clone, cursorPath) {
  asked = [];
  const lines = [];
  const out = await withRecordFrom(clone, () =>
    settlePass({ town: clone, cursorPath, pen: PEN, env: RECORD_ON, now: PASS_NOW, log: (l) => lines.push(l) }));
  return { out, lines };
}

test("the pass settles every merged join it finds, and a second run is a no-op", async () => {
  pulls = [penPR(), handPR()];
  files = { 3239: joinFiles("vesper") };
  cards = { vesper: card("vesper", "house-of-many-doors") };
  users = { "commander-and-chief": 334016343 };
  const clone = town({ cards: { wildcat: "house-of-many-doors", vesper: "house-of-many-doors" } });
  const cursorPath = join(mkdtempSync(join(tmpdir(), "settle-cursor-")), "cursor");

  const first = await pass(clone, cursorPath);
  assert.deepEqual(first.out.settled, ["wildcat", "vesper"], first.lines.join("\n"));
  const pins = JSON.parse(readFileSync(join(clone, PINS_PATH), "utf8"));
  assert.equal(pins.wildcat.id, 334016343);
  assert.equal(pins.vesper.id, 334016343);
  assert.equal(readFileSync(cursorPath, "utf8").trim(), "2026-09-29T10:00:01.000Z", "the cursor moved past the last merge");

  const head = git(clone, "rev-parse", "HEAD");
  const second = await pass(clone, cursorPath);
  assert.deepEqual([second.out.settled, second.out.refused, second.out.skipped], [[], [], []], "nothing merged since");
  assert.equal(git(clone, "rev-parse", "HEAD"), head, "no commit");

  // Even with the cursor lost, a pinned handle is only ever "already settled".
  writeFileSync(cursorPath, "2026-09-01T00:00:00Z\n");
  const third = await pass(clone, cursorPath);
  assert.deepEqual(third.out.settled, []);
  assert.deepEqual(third.out.skipped.sort(), ["vesper", "wildcat"]);
  assert.equal(git(clone, "rev-parse", "HEAD"), head, "still no commit");
  assert.equal(asked.some((a) => a.includes("/pulls/3217/")), false, "the pen's pinned join cost no call past the listing");
});

test("a refusal is logged and passed; a GitHub failure holds the cursor for the next tick", async () => {
  pulls = [penPR({ body: penBody("a-stranger", 777777) }), handPR()];
  files = { 3239: joinFiles("vesper") };
  cards = {};                                   // the card read fails: GitHub's weather
  users = {};
  const clone = town({ cards: { wildcat: "house-of-many-doors", vesper: "house-of-many-doors" } });
  const cursorPath = join(mkdtempSync(join(tmpdir(), "settle-cursor-")), "cursor");
  const { out, lines } = await pass(clone, cursorPath);
  assert.deepEqual(out.refused, [3217], "the pen join from an account the house never listed is refused");
  assert.match(lines.join("\n"), /#3217 wildcat REFUSED — the house has never listed this account/);
  assert.deepEqual(out.settled, []);
  assert.equal(out.cursor, "2026-09-29T10:00:00Z", "held at the merge GitHub could not answer for");
  assert.equal(readFileSync(cursorPath, "utf8").trim(), "2026-09-29T10:00:00Z");
});
