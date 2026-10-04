// join-pr-at-the-cosign.test.mjs — the add-resident door, where admission is the bind.
//
// RULED (Keemin, 2026-09-29, Household Primary Key reopened): the office decides
// whatever a machine can decide, and a PR exists only when a person has to.
//   · An account the house already lists (or a house this account is founding
//     or naming for itself) is ADMITTED AND BOUND at the door: the card, the
//     pin, the membership and both printed registers in one pen commit, and no
//     PR (src/join-bind.mjs).
//   · An account the house has never listed still opens the held PR.
//   · A record this office cannot read refuses, and writes nothing.
//
// Before this ruling the vouched join opened a PR whose merge bound nothing
// (POS-158's "the membership lands at the crossing" — no path did), and the
// welcome pass paid the unpinned handle's house twice (Wildcat, Scout).
//
// ── HOW THIS RUNS ───────────────────────────────────────────────────────────
//
// In-process, against the REAL `requestResidency` and the REAL locked writer
// (`bindUnderLock`), with the pool stubbed (the POS-187 seam), the pen pointed
// at a mock GitHub in this process, and the town a temp git clone the writer
// commits into. The only thing that stands in is the town lock's subprocess,
// replaced by an in-process call to the same critical section the exec runs.
// `test/residency.test.mjs` keeps the half that is about the HTTP door.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { fixtureDb } from "./fixture.mjs";
import { makePool } from "./registry-pool-stub.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { requestResidency, REGISTRY_PATH, PINS_PATH, serializeRegistry, serializePins } from "../src/residency.mjs";
import { bindUnderLock, BIND_REFUSALS } from "../src/join-bind.mjs";
import { penTransaction } from "../src/write.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";
import { indexStore, testIndex } from "./helpers/office-under-test.mjs";
import { UNREACHABLE_DEFECT } from "../src/index-probe.mjs";

// THE PORT IS ASKED FOR, NEVER CHOSEN (world-apex.test.mjs § the port). This
// was 43943, "checked against every port literal in test/" — and still a lock
// on a door the whole box shares: the file lives in all five pool trees, and on
// 2026-10-01 another lane running it at the same moment took the port, so this
// file's before hook failed and all twenty tests went red together. The fake
// GitHub listens on 0, and the port the OS handed back is what the pen dials.
let GH_PORT = null;
const ENV_ON = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://stub/none" };

// ── the fixture town's registry, as the record holds it ─────────────────────
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
      accounts: [{ login: "rookery-human", id: 777 }],
      residents: ["rook"],
      since: "2026-08-09",
    },
  },
});
const PINS = () => ({ wright: { login: "keeminlee", id: 999, pinned: "2026-07-05" } });

// ── a mock GitHub, exactly as wide as the pen's PR dance ────────────────────
//
// SEVEN CALLS AND NO MORE, and it answers 418 for anything else, so a register
// asked of GitHub (the record answers those) fails loudly.
let captured = { trees: [], commits: [], refs: [], pulls: [] };
let openPulls = [];
let server;

// `connection: close` on every answer: a pooled keep-alive socket the server
// closes between two tests is reused by the next fetch and dies mid-request
// (ECONNRESET, "fetch failed" — the gangway's red, 2026-10-01). One socket per
// call, and there is nothing idle to race.
const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json", connection: "close" });
  res.end(JSON.stringify(body));
};

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = url.pathname;
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      if (req.method === "GET" && p.endsWith("/pulls")) return json(res, 200, openPulls);
      if (req.method === "GET" && /\/git\/ref\/heads\//.test(p)) return json(res, 200, { object: { sha: "basesha" } });
      if (req.method === "GET" && /\/git\/commits\//.test(p)) return json(res, 200, { tree: { sha: "basetree" } });
      if (req.method === "POST" && p.endsWith("/git/trees")) { captured.trees.push(body); return json(res, 201, { sha: "treesha" }); }
      if (req.method === "POST" && p.endsWith("/git/commits")) { captured.commits.push(body); return json(res, 201, { sha: "commitsha" }); }
      if (req.method === "POST" && p.endsWith("/git/refs")) { captured.refs.push(body); return json(res, 201, {}); }
      if (req.method === "POST" && p.endsWith("/pulls")) {
        captured.pulls.push(body);
        return json(res, 201, { html_url: "https://example.invalid/pr/1", number: 1 });
      }
      return json(res, 418, { message: `the pen asked GitHub for ${req.method} ${p}, which the record now answers` });
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  GH_PORT = server.address().port;
});
after(async () => { await new Promise((ok) => server.close(ok)); });

const PEN = () => ({
  apiBase: `http://127.0.0.1:${GH_PORT}`,
  token: "a-mock-pen-token", owner: "postmark-town", repo: "postmark", baseBranch: "main",
});

const db = fixtureDb();
// The doors below run in this process and read their town index from a store
// seeded from this fixture (POS-268, office-under-test.mjs).
const IX = await indexStore(db);
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });

// ── the town, as a temp git clone holding the two printed registers ────────
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();
const clones = [];
function town(registry, pins) {
  const dir = mkdtempSync(join(tmpdir(), "join-bind-"));
  clones.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), serializeRegistry(registry));
  writeFileSync(join(dir, PINS_PATH), serializePins(pins));
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "false");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "seed");
  return dir;
}
after(() => { for (const d of clones) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

// The lock's child, in-process: the exec calls exactly this.
let binds = 0;
const inProcess = (payload, { clone }) => { binds += 1; return bindUnderLock({ ...payload, clone, db, date: "2026-09-29" }); };

/** Run one `request_residency` against a record seeded with the fixture town. */
async function ask(args, key, { registry = REGISTRY(), pins = PINS(), pool = null, record = true } = {}) {
  captured = { trees: [], commits: [], refs: [], pulls: [] };
  openPulls = [];
  binds = 0;
  const clone = town(registry, pins);
  const head = git(clone, "rev-parse", "HEAD");
  const p = pool ?? makePool(rowsFromRegistry(registry, pins));
  __setPoolForTest(p);
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  if (record) Object.assign(process.env, ENV_ON);
  else { delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; }
  try {
    const out = await requestResidency(args, key, db, PEN(), { clone, bind: inProcess });
    return { out, pool: p, clone, head };
  } catch (err) {
    return { err, pool: p, clone, head };
  } finally {
    __setPoolForTest(null);
    if (was.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
    if (was.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
  }
}

const HOUSE_KEY = { ghId: 999, ghLogin: "keeminlee", handles: new Set(["wright"]) };
const STRANGER = { ghId: 424242, ghLogin: "some-stranger", handles: new Set() };

const paths = () => captured.trees[0].tree.map((e) => e.path).sort();
const cardFor = (handle) =>
  captured.trees[0].tree.find((e) => e.path === `WHITE_PAGES/${handle}/ADDRESS.md`).content;
const cardIn = (clone, handle) => readFileSync(join(clone, "WHITE_PAGES", handle, "ADDRESS.md"), "utf8");
const committed = (clone) => git(clone, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort();
const house = (pool, slug) => pool.state.households.find((h) => h.slug === slug);
const pinOf = (pool, handle) => pool.state.pins.find((p) => p.handle === handle);

// ── ADMISSION IS THE BIND ───────────────────────────────────────────────────

test("an account already on the house is admitted and bound: pin + membership in the store, ONE commit, no PR", async () => {
  const { out, err, pool, clone, head } = await ask({ handle: "tulip", card: "Second agent of this house.", agent: "Tulip" }, HOUSE_KEY);
  assert.equal(err, undefined, err?.hint);
  assert.equal(out.admitted, "tulip");
  assert.equal(out.address, "WHITE_PAGES/tulip/ADDRESS.md");
  assert.equal(out.pr_url, undefined, "no PR link: nothing waits on a person");
  assert.deepEqual(out.household, { slug: "the-trueing-house", name: "The Trueing House", action: "appended", lane: "bound at admission" });

  assert.equal(captured.pulls.length, 0, "no PR was opened");
  assert.equal(captured.trees.length, 0, "and nothing was written through the pen's PR dance");

  const pin = pinOf(pool, "tulip");
  assert.ok(pin, "the pin is a row in the store");
  assert.equal(String(pin.gh_id), "999", "bound to the VERIFIED id");
  assert.deepEqual(house(pool, "the-trueing-house").residents, ["wright", "tulip"], "and the membership");

  assert.notEqual(git(clone, "rev-parse", "HEAD"), head);
  assert.equal(git(clone, "rev-list", "--count", `${head}..HEAD`), "1", "exactly one commit");
  assert.equal(out.commit, git(clone, "rev-parse", "HEAD"));
  assert.deepEqual(committed(clone), [
    PINS_PATH, REGISTRY_PATH,
    "WHITE_PAGES/tulip/ADDRESS.md", "WHITE_PAGES/tulip/inbox/.gitkeep", "WHITE_PAGES/tulip/outbox/.gitkeep",
  ].sort(), "the one commit holds the address and both printed files");
  assert.equal(JSON.parse(readFileSync(join(clone, PINS_PATH), "utf8")).tulip.id, 999);
  assert.deepEqual(JSON.parse(readFileSync(join(clone, REGISTRY_PATH), "utf8")).households["the-trueing-house"].residents, ["wright", "tulip"]);
  assert.equal(git(clone, "status", "--porcelain"), "", "nothing left behind");
});

test("the card is written by the office: verified github, the house's own nameplate, the caller's prose", async () => {
  const { out, clone } = await ask({
    handle: "second-hand", household: "the-trueing-house",
    card: "---\nhandle: admin\ngithub: victim-account\n---\n\nHello, I live here.",
  }, HOUSE_KEY);
  assert.equal(out.admitted, "second-hand");
  const card = cardIn(clone, "second-hand");
  assert.match(card, /^---\nhandle: second-hand\n/, "the handle is the validated arg, not the pasted claim");
  assert.match(card, /github: keeminlee/, "github is the verified login");
  assert.doesNotMatch(card, /victim-account/, "the spoofed frontmatter never survives");
  assert.match(card, /household: The Trueing House/, "the house's own nameplate, not the slug the caller typed");
  assert.match(card, /joined: \d{4}-\d{2}-\d{2}/);
  assert.match(card, /Hello, I live here\./);
});

test("a join that FOUNDS a house mints it and binds its first resident in the same act", async () => {
  const { out, pool, clone } = await ask(
    { handle: "newhouse-first", card: "we are new here", household: "A Brand New House" }, STRANGER);
  assert.equal(out.admitted, "newhouse-first");
  assert.equal(out.household.action, "created");
  const row = house(pool, "a-brand-new-house");
  assert.ok(row, "the house row is in the record");
  assert.deepEqual(row.accounts, [{ login: "some-stranger", id: 424242 }]);
  assert.deepEqual(row.residents, ["newhouse-first"], "and its first resident is in it — nothing waits on a merge");
  assert.equal(String(pinOf(pool, "newhouse-first")?.gh_id), "424242");
  assert.ok(committed(clone).includes("WHITE_PAGES/newhouse-first/ADDRESS.md"));
  assert.equal(captured.pulls.length, 0);
});

test("a nameless join by an unknown account founds a house of one, keyed by the login, and binds", async () => {
  const { out, pool, clone } = await ask({ handle: "lonely", card: "just me" }, STRANGER);
  assert.equal(out.household.slug, "some-stranger");
  const row = house(pool, "some-stranger");
  assert.ok(row);
  assert.equal(row.name, null, "no name is written — the card reads `(unstated — ask them)`");
  assert.deepEqual(row.residents, ["lonely"]);
  assert.match(cardIn(clone, "lonely"), /household: \(unstated — ask them\)/);
});

test("an undeclared house declaring itself is SEEDED WHOLE, and the joining handle is bound with it", async () => {
  const reg = REGISTRY();
  delete reg.households["the-trueing-house"];     // wright's account now holds no house
  const { out, pool } = await ask(
    { handle: "sibling", card: "the second of us", household: "Trueing" }, HOUSE_KEY, { registry: reg });
  assert.equal(out.household.action, "created");
  assert.equal(out.household.slug, "trueing");
  assert.deepEqual(house(pool, "trueing").residents, ["wright", "sibling"],
    "the plan's own answer, [...siblings, handle], in one act");
});

// ── WHAT THE DOOR STILL DECIDES ─────────────────────────────────────────────

test("a household cannot add residents to somebody else's house", async () => {
  const { err, pool } = await ask({ handle: "interloper", card: "hi", household: "The Rookery" }, HOUSE_KEY);
  assert.equal(err?.code, 409);
  assert.match(err.defect, /already belongs to "the-trueing-house"/);
  assert.equal(captured.pulls.length, 0, "no PR opened across houses");
  assert.equal(pool.state.writes.households + pool.state.writes.pins, 0);
});

test("a taken handle is refused inside the lock too — the race between the door and the writer", async () => {
  // The door's `validateResidencyRequest` reads the office index; the writer
  // reads the clone after its pull. A card that landed between the two is
  // taken, and the writer is the one that decides.
  const reg = REGISTRY();
  const clonePins = PINS();
  const pool = makePool(rowsFromRegistry(reg, clonePins));
  const racing = (payload, { clone }) => {
    mkdirSync(join(clone, "WHITE_PAGES", "tulip"), { recursive: true });
    writeFileSync(join(clone, "WHITE_PAGES", "tulip", "ADDRESS.md"), "---\nhandle: tulip\n---\n");
    return inProcess(payload, { clone });
  };
  captured = { trees: [], commits: [], refs: [], pulls: [] };
  const clone = town(reg, clonePins);
  __setPoolForTest(pool);
  Object.assign(process.env, ENV_ON);
  try {
    await assert.rejects(
      () => requestResidency({ handle: "tulip", card: "hello" }, HOUSE_KEY, db, PEN(), { clone, bind: racing }),
      (e) => e.code === 409 && /taken/.test(e.defect) && /white pages/.test(e.hint));
  } finally {
    __setPoolForTest(null);
    delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL;
  }
  assert.equal(pool.state.writes.households + pool.state.writes.pins, 0, "nothing reached the record");
  assert.equal(captured.pulls.length, 0);
});

test("a house founded between the door's read and the writer's is refused, and no PR is opened", async () => {
  // The door plans `created` for a stranger naming a new house; by the time
  // the writer reads the record, somebody else founded it. Under the lock the
  // stranger is asking into a house that has never listed them, which is a
  // person's call — so the writer refuses and the caller asks again.
  const after = {
    ...REGISTRY(),
    households: { ...REGISTRY().households, "a-late-house": {
      name: "A Late House", accounts: [{ login: "first-mover", id: 6 }], residents: [], since: "2026-09-22",
    } },
  };
  const before = makePool(rowsFromRegistry(REGISTRY(), PINS()));
  const later = makePool(rowsFromRegistry(after, PINS()));
  let householdReads = 0;
  const pool = {
    state: later.state,
    async query(text, params) {
      if (/FROM households/.test(text)) {
        householdReads += 1;
        return (householdReads === 1 ? before : later).query(text, params);
      }
      return later.query(text, params);
    },
  };
  const { err } = await ask({ handle: "latecomer", card: "hi", household: "A Late House" },
    { ghId: 5, ghLogin: "someone-else", handles: new Set() }, { pool });
  assert.ok(householdReads >= 2, "the race actually happened — the writer read after the door did");
  assert.equal(err?.code, BIND_REFUSALS.MOVED.code);
  assert.equal(err.defect, BIND_REFUSALS.MOVED.defect);
  assert.equal(later.state.writes.households + later.state.writes.pins, 0);
  assert.equal(captured.pulls.length, 0, "and no PR was opened declaring a house that already stands");
});

// ── THE HELD PR (an account the house has never listed) ────────────────────

test("cold B2: a new account claiming an existing house is HELD — the PR, three files, the HOLD sentence", async () => {
  const { out, pool, clone, head } = await ask(
    { handle: "fledgling", card: "I belong to the Rookery.", household: "The Rookery", agent: "Fledgling" }, STRANGER);
  assert.equal(out.requested, "fledgling");
  assert.match(out.pr_url, /example\.invalid/);
  assert.equal(out.household.lane, "held for a sibling's vouch");
  assert.equal(out.household.action, "appended");
  assert.equal(binds, 0, "the writer was never called");

  assert.deepEqual(paths(), [
    "WHITE_PAGES/fledgling/ADDRESS.md",
    "WHITE_PAGES/fledgling/inbox/.gitkeep",
    "WHITE_PAGES/fledgling/outbox/.gitkeep",
  ], "the card and its mailboxes, and no register");
  assert.equal(captured.commits[0].message, "address: fledgling joins");
  assert.equal(captured.refs[0].ref, "refs/heads/residency/fledgling");
  assert.equal(captured.pulls[0].head, "residency/fledgling");
  assert.equal(captured.pulls[0].base, "main");

  const body = captured.pulls[0].body;
  assert.match(body, /HOLD, please/);
  assert.match(body, /never the BELONGING/);
  assert.match(body, /identity pin is not in this PR and needs no hand:\s*`fledgling`\s*binds to id\s*`424242`/,
    "the sentence the town's witness reads (`deferredBindingJudgment`) still parses");
  assert.doesNotMatch(body, /Please pin/);
  assert.doesNotMatch(body, /first ferry crossing|households\.json/, "no bind is promised at a crossing, and no file edit");
  assert.match(cardFor("fledgling"), /github: some-stranger/);
  assert.match(cardFor("fledgling"), /household: The Rookery/);

  assert.equal(pool.state.writes.households + pool.state.writes.pins, 0,
    "NOTHING is written for a held join — the account has not been vouched for");
  assert.equal(git(clone, "rev-parse", "HEAD"), head, "and nothing reached the town clone");
});

test("a held join already waiting in a PR is refused politely, and no second PR opens", async () => {
  captured = { trees: [], commits: [], refs: [], pulls: [] };
  const pool = makePool(rowsFromRegistry(REGISTRY(), PINS()));
  __setPoolForTest(pool);
  Object.assign(process.env, ENV_ON);
  openPulls = [{ head: { ref: "residency/dupe" }, title: "address: dupe joins", html_url: "https://example.invalid/pr/500" }];
  try {
    await assert.rejects(
      () => requestResidency({ handle: "dupe", card: "again", household: "The Rookery" }, STRANGER, db, PEN(), { bind: inProcess }),
      (e) => e.code === 409 && /pr\/500/.test(e.hint));
  } finally {
    __setPoolForTest(null);
    delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL;
    openPulls = [];
  }
  assert.equal(captured.pulls.length, 0);
});

test("the pen never asks GitHub for either register", async () => {
  // The mock answers 418 for anything it does not expect, so a register read
  // through GitHub would make the whole ask throw rather than pass quietly.
  const { out } = await ask({ handle: "fledgling", card: "hello", household: "The Rookery" }, STRANGER);
  assert.ok(out.pr_url, "the ask completed, so nothing hit the 418");
});

// ── THE RECORD UNREACHABLE ──────────────────────────────────────────────────

test("the store unreachable REFUSES by name — no PR, no bind, nothing in the clone", async () => {
  for (const [args, key] of [
    [{ handle: "tulip", card: "hello" }, HOUSE_KEY],                                       // would have been bound
    [{ handle: "fledgling", card: "hello", household: "The Rookery" }, STRANGER],           // would have been held
    [{ handle: "luminous", card: "hi", household: "Some House" }, STRANGER],                // would have founded
  ]) {
    const { out, err, pool, clone, head } = await ask(args, key, { record: false });
    assert.equal(out, undefined, `${args.handle}: no answer but the refusal`);
    assert.equal(err?.code, BIND_REFUSALS.NO_RECORD.code);
    assert.equal(err.defect, BIND_REFUSALS.NO_RECORD.defect);
    assert.match(err.hint, /Try again/);
    assert.equal(captured.pulls.length + captured.trees.length, 0, `${args.handle}: no PR`);
    assert.equal(binds, 0, `${args.handle}: the writer was never reached`);
    assert.equal(pool.state.writes.households + pool.state.writes.pins, 0);
    assert.equal(git(clone, "rev-parse", "HEAD"), head, `${args.handle}: nothing reached the clone`);
    assert.equal(git(clone, "status", "--porcelain"), "");
  }
});

test("the writer itself refuses an unreachable record and leaves the clone as it found it", async () => {
  const clone = town(REGISTRY(), PINS());
  const head = git(clone, "rev-parse", "HEAD");
  delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL;
  await assert.rejects(
    () => bindUnderLock({ args: { handle: "tulip", card: "hello" }, key: { ghId: 999, ghLogin: "keeminlee", handles: ["wright"] }, clone, db, date: "2026-09-29" }),
    (e) => e.code === BIND_REFUSALS.NO_RECORD.code && e.defect === BIND_REFUSALS.NO_RECORD.defect);
  assert.equal(git(clone, "rev-parse", "HEAD"), head);
  assert.equal(existsSync(join(clone, "WHITE_PAGES", "tulip")), false);
});

test("the exec under the town lock answers ONE JSON line, and an unreachable record is a refusal, not a trip", async () => {
  const { execUnderTownLock } = await import("../src/town-lock.mjs");
  const clone = town(REGISTRY(), PINS());
  const env = { ...process.env, TOWN_CLONE: clone };
  delete env.WORLD2_PG; delete env.WORLD2_PG_URL; delete env.TOWN_PUSH;
  const dir = mkdtempSync(join(tmpdir(), "join-bind-db-"));
  clones.push(dir);
  const dbPath = join(dir, "office.db");
  fixtureDb(dbPath).close();
  const out = await execUnderTownLock(join(import.meta.dirname, "..", "src", "join-bind-exec.mjs"),
    JSON.stringify({ args: { handle: "tulip", card: "hello" }, key: { ghId: 999, ghLogin: "keeminlee", handles: ["wright"] }, dbPath }), env);
  const lines = out.trim().split("\n");
  assert.equal(lines.length, 1);
  // Switched, the exec reads its index from the store before the record, and a
  // store it cannot reach is the store's 503 by name (POS-268, as ruled for the
  // deletion: "record unreachable" becomes "store unreachable"). The old mode
  // still answers the record's own refusal.
  if (testIndex() === "store") {
    const err = JSON.parse(lines[0]).error;
    assert.equal(err.code, 503);
    assert.equal(err.defect, UNREACHABLE_DEFECT);
  } else assert.deepEqual(JSON.parse(lines[0]).error, {
    code: BIND_REFUSALS.NO_RECORD.code, field: null, defect: BIND_REFUSALS.NO_RECORD.defect, hint: BIND_REFUSALS.NO_RECORD.hint,
  });
});

// ── THE GANGWAY ─────────────────────────────────────────────────────────────

test("a frozen gangway boards a household member and the berth names their house", async () => {
  // The gangway's own words, ruled 2026-08-06: "the freeze counts handles — a
  // new handle inside an existing credential household boards the ship like any
  // other arrival". A passenger is not a resident, so no register is touched;
  // the berth simply remembers which house it will come ashore into.
  const dir = mkdtempSync(join(tmpdir(), "pos158-gangway-"));
  mkdirSync(join(dir, "HARBOR"), { recursive: true });
  writeFileSync(join(dir, "HARBOR", "GANGWAY.md"), "state: frozen" + String.fromCharCode(10));
  const wasClone = process.env.TOWN_CLONE;
  process.env.TOWN_CLONE = dir;
  try {
    const { out, pool } = await ask({ handle: "hearth-second", card: "I'll wait aboard.", agent: "Hearth" }, HOUSE_KEY);
    assert.equal(out.boarded, "hearth-second");
    assert.equal(out.household.slug, "the-trueing-house");
    assert.match(out.household.action, /declared at disembarkation/);
    assert.equal(binds, 0, "a berth is never bound");

    assert.deepEqual(captured.trees[0].tree.map((e) => e.path), ["HARBOR/berths/hearth-second.md"],
      "one berth file — no register is written from the water");
    assert.match(captured.trees[0].tree[0].content, /household: The Trueing House/,
      "the berth names the house in the HOUSE's words, not the caller's");
    assert.equal(pool.state.writes.households, 0, "and a berth mints nothing: a passenger is not a resident");
    assert.equal(pool.state.writes.pins, 0);
    assert.equal(captured.pulls[0].head, "boarding/hearth-second");
  } finally {
    if (wasClone === undefined) delete process.env.TOWN_CLONE; else process.env.TOWN_CLONE = wasClone;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

test("a frozen gangway mints NOTHING, even for an account with no house at all", async () => {
  // SYBIL 1a (review 3/6): a FRESH account is what plans `created`, so it is the
  // one that exercises a mint running past the breaker.
  const dir = mkdtempSync(join(tmpdir(), "pos158-gangway-fresh-"));
  mkdirSync(join(dir, "HARBOR"), { recursive: true });
  writeFileSync(join(dir, "HARBOR", "GANGWAY.md"), "state: frozen" + String.fromCharCode(10));
  const wasClone = process.env.TOWN_CLONE;
  process.env.TOWN_CLONE = dir;
  try {
    const { out, pool } = await ask(
      { handle: "fresh-passenger", card: "nobody here yet", household: "A Wholly New House" }, STRANGER);
    assert.equal(out.boarded, "fresh-passenger", "it boarded, as a frozen gangway requires");
    assert.equal(pool.state.writes.households, 0,
      "and NO household row was written — a passenger is not a resident");
    assert.equal(pool.state.households.some((h) => h.slug === "a-wholly-new-house"), false);
    assert.equal(pool.state.writes.pins, 0);
    assert.deepEqual(captured.trees[0].tree.map((e) => e.path), ["HARBOR/berths/fresh-passenger.md"],
      "one berth file and nothing else");
  } finally {
    if (wasClone === undefined) delete process.env.TOWN_CLONE; else process.env.TOWN_CLONE = wasClone;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

// ── A PROVISIONAL HOUSE CHOOSES ITS KEY AT THIS DOOR (POS-197) ──────────────

const QUIET_HUMAN = { ghId: 770000123, ghLogin: "a-quiet-human", handles: new Set(["fernwood"]) };
const WITH_A_PROVISIONAL_HOUSE = () => {
  const reg = REGISTRY();
  reg.households.fernwood = {
    name: "Fernwood's household",
    accounts: [{ login: "a-quiet-human", id: 770000123 }],
    residents: ["fernwood"],
    since: "2026-08-14",
    declared_by: "the POS-159 backfill",
    provisional: true,
  };
  return reg;
};

test("a provisional house's human naming a real house RENAMES it and binds the resident into it", async () => {
  const { out, pool, clone } = await ask(
    { handle: "fernwood-two", card: "the second of us", household: "Fernwood Hollow" }, QUIET_HUMAN,
    { registry: WITH_A_PROVISIONAL_HOUSE() });

  assert.equal(out.household.action, "chosen");
  assert.equal(out.household.slug, "fernwood-hollow");
  assert.equal(out.household.formerly, "fernwood");
  assert.equal(house(pool, "fernwood"), undefined, "no row under the borrowed key");
  const row = house(pool, "fernwood-hollow");
  assert.ok(row, "the house stands under the key it chose");
  assert.deepEqual(row.formerly, ["fernwood"], "the borrowed key is kept in `formerly`");
  assert.equal(row.provisional, false);
  assert.equal(row.name, "Fernwood Hollow");
  assert.deepEqual(row.residents, ["fernwood", "fernwood-two"], "and the resident is in it, in the same act");
  assert.equal(pool.state.households.length, 3, "renamed, never a second house");
  assert.equal(String(pinOf(pool, "fernwood-two")?.gh_id), "770000123");

  assert.match(cardIn(clone, "fernwood-two"), /household: Fernwood Hollow/, "the card reads the chosen name");
  assert.match(out.note, /provisional key "fernwood"/, "and the resident is told, in words");
  assert.equal(captured.pulls.length, 0);
});

test("a provisional house's human who types NOTHING has not chosen — appended and bound, nothing renamed", async () => {
  const { out, pool } = await ask(
    { handle: "fernwood-two", card: "the second of us" }, QUIET_HUMAN, { registry: WITH_A_PROVISIONAL_HOUSE() });
  assert.equal(out.household.action, "appended");
  assert.equal(out.household.slug, "fernwood");
  assert.equal(house(pool, "fernwood").provisional, true);
  assert.deepEqual(house(pool, "fernwood").residents, ["fernwood", "fernwood-two"]);
});

test("a SECOND choice meets the ceremony's CHOSEN refusal as this door's 409 — nothing bound, no PR", async () => {
  const { REFUSALS } = await import("../src/ceremony.mjs");
  const reg = WITH_A_PROVISIONAL_HOUSE();
  const { provisional: _p, ...chosen } = reg.households.fernwood;
  delete reg.households.fernwood;
  reg.households["fernwood-hollow"] = { ...chosen, name: "Fernwood Hollow", formerly: ["fernwood"] };

  const { err, pool, clone, head } = await ask(
    { handle: "fernwood-three", card: "hi", household: "Somewhere Else Entirely" }, QUIET_HUMAN, { registry: reg });
  assert.equal(err?.code, REFUSALS.CHOSEN.code);
  assert.equal(err.defect, REFUSALS.CHOSEN.defect);
  assert.equal(err.hint, REFUSALS.CHOSEN.hint);
  assert.equal(captured.pulls.length, 0, "no PR");
  assert.equal(pinOf(pool, "fernwood-three"), undefined, "no pin");
  assert.equal(git(clone, "rev-parse", "HEAD"), head, "no commit");
});

// ── A PUSH THAT DID NOT LAND, THEN A RETRY (Wright's review of #254) ────────
//
// The store rows land before the commit. When the push cannot land, the pen's
// transaction puts the clone back, and the pin and the membership stay in the
// store. The same account asking again must FINISH the act, not meet its own
// pin as "taken"; any other account asking for the handle is still refused.
//
// The failure is real: the town has a bare origin whose pre-receive hook
// refuses, so `penCommit`'s push loop gives up and the exec's shape (the pen's
// transaction around `bindUnderLock`, a refusal as an answer) puts it back.

const viaExec = (payload, { clone }) => penTransaction(clone, async () => {
  try { return await bindUnderLock({ ...payload, clone, db, date: "2026-09-29" }); }
  catch (e) {
    if (typeof e?.code !== "number") throw e;
    return { error: { code: e.code, field: e.field ?? null, defect: e.defect, hint: e.hint } };
  }
}).then((r) => {
  if (r?.error) throw Object.assign(new Error(r.error.defect), r.error);
  return r;
});

test("a push that did not land leaves the pin in the store; the same account's retry lands, another account is refused", async () => {
  const clone = town(REGISTRY(), PINS());
  const origin = mkdtempSync(join(tmpdir(), "join-bind-origin-"));
  clones.push(origin);
  execFileSync("git", ["init", "-q", "--bare", origin]);
  git(clone, "branch", "-M", "main");
  git(clone, "remote", "add", "origin", origin);
  git(clone, "push", "-q", "-u", "origin", "main");
  const hook = join(origin, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\necho refused by the fixture >&2\nexit 1\n");

  const pool = makePool(rowsFromRegistry(REGISTRY(), PINS()));
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL, push: process.env.TOWN_PUSH };
  __setPoolForTest(pool);
  Object.assign(process.env, ENV_ON, { TOWN_PUSH: "1" });
  const askAs = (key) => requestResidency({ handle: "tulip", card: "Second agent of this house." }, key, db, PEN(), { clone, bind: viaExec });
  try {
    const head = git(clone, "rev-parse", "HEAD");
    await assert.rejects(() => askAs(HOUSE_KEY), (e) => e.code === 503 && /did not take this write/.test(e.defect));
    assert.equal(String(pinOf(pool, "tulip")?.gh_id), "999", "the stranded state: the pin is in the store");
    assert.equal(git(clone, "rev-parse", "HEAD"), head, "and the clone was put back");
    assert.equal(existsSync(join(clone, "WHITE_PAGES", "tulip")), false, "with no card");

    await assert.rejects(() => askAs(STRANGER), (e) => e.code === 409 && /taken/.test(e.defect),
      "another account asking for the handle is refused");

    rmSync(hook);
    const out = await askAs(HOUSE_KEY);
    assert.equal(out.admitted, "tulip", "the same account's retry finishes the act");
    assert.equal(git(origin, "rev-parse", "main"), out.commit, "and it landed on the town");
    assert.ok(committed(clone).includes("WHITE_PAGES/tulip/ADDRESS.md"));
    assert.deepEqual(house(pool, "the-trueing-house").residents, ["wright", "tulip"]);
  } finally {
    __setPoolForTest(null);
    for (const [k, v] of [["WORLD2_PG", was.pg], ["WORLD2_PG_URL", was.url], ["TOWN_PUSH", was.push]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
