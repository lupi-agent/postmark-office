// join-pr-at-the-cosign.test.mjs — the join-PR lane, under the new law (POS-158).
//
// RULED (Keemin, 2026-09-22, on this lane's STOP report): on the join-PR path
// the HOUSE is minted at the co-sign — which for `request_residency` is the
// request itself, since the verb refuses without a verified GitHub account —
// and the MEMBERSHIP lands at admission, which on this lane is the office's
// first sight of the Registrar's merge (the crossing). The PR carries the card
// and NO registry diff.
//
// ── WHY THESE TESTS LEFT `test/residency.test.mjs` ─────────────────────────
//
// That suite drives a SPAWNED office over real HTTP, and the office it spawns
// cannot reach the record: the store is Postgres, and this lane touches no
// database. Before POS-158 that did not matter, because the registry arrived
// through the mock GitHub like everything else. Now the registry IS the record,
// so every assertion about what the door decides — the house-line lint, the
// cross-house refusal, pre-vouched versus cold-B2 — would have been testing the
// degraded path instead of the law.
//
// So they moved in-process. `requestResidency` is called directly, with the
// pool stubbed (the POS-187 seam) and a pen pointed at a mock GitHub in this
// same process. Nothing is weakened: every assertion that used to ride the HTTP
// suite is here, against the REAL function, plus the ones HTTP could never make
// — that the house row landed in the record, and which rows did not.
//
// `test/residency.test.mjs` keeps the half that is genuinely about the door:
// the PR's shape over real HTTP, the dedup, the gangway, and the ruled
// behaviour when the record is unreachable.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fixtureDb } from "./fixture.mjs";
import { makePool } from "./registry-pool-stub.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { requestResidency } from "../src/residency.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";

// 43943 — CHOSEN, NOT GUESSED. The first pick, 43861, was already
// `test/hot-reload.test.mjs`'s and `test/read-worker.test.mjs`'s, and the suite
// runs eight files at a time: the collision showed up in one full run and not
// the next, which is exactly how a port clash presents. Checked against every
// port literal in `test/` before this line was written.
const GH_PORT = 43943;
const ENV_ON = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://stub/none" };

// ── the fixture town's registry, as the record holds it ─────────────────────
// The same two houses `test/residency.test.mjs` has always used, so a reader
// comparing the two files is comparing like with like.
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
// SEVEN CALLS AND NO MORE. The registry and the pin file used to be read
// through this API too (`readTownJson`); they are read from the record now, so
// a request for either arriving here would be a regression — and the handler
// answers 418 for anything it does not expect, so such a request fails loudly
// rather than falling through to a 404 the pen shrugs at.
let captured = { trees: [], commits: [], refs: [], pulls: [] };
let openPulls = [];
let server;

const json = (res, code, body) => {
  res.writeHead(code, { "content-type": "application/json" });
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
      // THE REGISTRY MUST NOT BE ASKED FOR HERE ANY MORE.
      return json(res, 418, { message: `the pen asked GitHub for ${req.method} ${p}, which the record now answers` });
    });
  });
  await new Promise((ok) => server.listen(GH_PORT, "127.0.0.1", ok));
});
after(async () => { await new Promise((ok) => server.close(ok)); });

const PEN = () => ({
  apiBase: `http://127.0.0.1:${GH_PORT}`,
  token: "a-mock-pen-token", owner: "postmark-town", repo: "postmark", baseBranch: "main",
});

const db = fixtureDb();

/** Run one `request_residency` against a record seeded with the fixture town. */
async function ask(args, key, { registry = REGISTRY(), pins = PINS() } = {}) {
  captured = { trees: [], commits: [], refs: [], pulls: [] };
  openPulls = [];
  const pool = makePool(rowsFromRegistry(registry, pins));
  __setPoolForTest(pool);
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  Object.assign(process.env, ENV_ON);
  try {
    const out = await requestResidency(args, key, db, PEN());
    return { out, pool };
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

// ── THE PR'S SHAPE ──────────────────────────────────────────────────────────

test("the PR carries the card and NO registry diff — three files, never five", async () => {
  const { out } = await ask({ handle: "tulip", card: "Second agent of this house.", agent: "Tulip" }, HOUSE_KEY);
  assert.equal(out.requested, "tulip");
  assert.deepEqual(paths(), [
    "WHITE_PAGES/tulip/ADDRESS.md",
    "WHITE_PAGES/tulip/inbox/.gitkeep",
    "WHITE_PAGES/tulip/outbox/.gitkeep",
  ]);
});

test("the body asks nobody to pin, because a hand-edited pin would be reverted", async () => {
  await ask({ handle: "tulip", card: "hello" }, HOUSE_KEY);
  const body = captured.pulls[0].body;
  assert.doesNotMatch(body, /Please pin/i, "the old ask is gone");
  assert.match(body, /needs no hand/, "and it says why");
  assert.match(body, /re-rendered from that record/);
});

// ── THE HOUSE, AT THE CO-SIGN ───────────────────────────────────────────────

test("a join that FOUNDS a house mints the house row at the co-sign, before the PR", async () => {
  const { out, pool } = await ask(
    { handle: "newhouse-first", card: "we are new here", household: "A Brand New House" }, STRANGER);
  assert.equal(out.requested, "newhouse-first");
  const row = pool.state.households.find((h) => h.slug === "a-brand-new-house");
  assert.ok(row, "the house row is in the record");
  assert.deepEqual(row.accounts, [{ login: "some-stranger", id: 424242 }]);
  assert.deepEqual(row.residents, [],
    "and it stands EMPTY — the membership is admission, and admission on this lane is the merge");
  assert.equal(pool.state.pins.some((p) => p.handle === "newhouse-first"), false,
    "no pin either: the pin is the membership's half");
  assert.deepEqual(paths(), [
    "WHITE_PAGES/newhouse-first/ADDRESS.md",
    "WHITE_PAGES/newhouse-first/inbox/.gitkeep",
    "WHITE_PAGES/newhouse-first/outbox/.gitkeep",
  ], "and still no registry diff in the PR");
});

test("a join that APPENDS to a standing house mints nothing — a key is minted once", async () => {
  const { out, pool } = await ask({ handle: "tulip", card: "hello" }, HOUSE_KEY);
  assert.equal(pool.state.writes.households, 0, "no house row was written");
  assert.equal(pool.state.writes.pins, 0);
  assert.deepEqual(out.household, {
    slug: "the-trueing-house", name: "The Trueing House", action: "appended", lane: "pre-vouched",
  });
  assert.deepEqual(pool.state.households.find((h) => h.slug === "the-trueing-house").residents, ["wright"],
    "the house's residents are untouched until the crossing that follows the merge");
});

test("a nameless join by an unknown account founds a house of one, keyed by the login", async () => {
  const { out, pool } = await ask({ handle: "lonely", card: "just me" }, STRANGER);
  assert.equal(out.household.slug, "some-stranger");
  const row = pool.state.households.find((h) => h.slug === "some-stranger");
  assert.ok(row);
  assert.equal(row.name, null, "no name is written — the card reads `(unstated — ask them)`");
});

// ── WHAT THE DOOR STILL DECIDES ─────────────────────────────────────────────

test("the caller's household line never overrides the house's own nameplate", async () => {
  await ask({ handle: "second-hand", card: "hello", household: "the-trueing-house" }, HOUSE_KEY);
  assert.match(cardFor("second-hand"), /household: The Trueing House/,
    "the slug the caller typed is answered with the entry's own display name — the town's lint compares them");
});

test("a household cannot add residents to somebody else's house", async () => {
  await assert.rejects(
    () => ask({ handle: "interloper", card: "hi", household: "The Rookery" }, HOUSE_KEY),
    (e) => e.code === 409 && /already belongs to "the-trueing-house"/.test(e.defect));
  assert.equal(captured.pulls.length, 0, "no PR opened across houses");
});

test("cold B2: a new account claiming an existing house is HELD, and the PR says so", async () => {
  const { out, pool } = await ask(
    { handle: "fledgling", card: "I belong to the Rookery.", household: "The Rookery" }, STRANGER);
  assert.equal(out.household.lane, "held for a sibling's vouch");
  assert.equal(out.household.action, "appended");
  assert.match(captured.pulls[0].body, /HOLD, please/);
  assert.match(captured.pulls[0].body, /never the BELONGING/);
  assert.equal(pool.state.writes.households, 0,
    "and NOTHING is minted for a held join — the account has not been vouched for");
});

test("pre-vouched: the house's own key gets the full-authority sentence", async () => {
  await ask({ handle: "tulip", card: "hello" }, HOUSE_KEY);
  assert.match(captured.pulls[0].body, /pre-vouched/i);
  assert.match(captured.pulls[0].body, /already one of that house's accounts/i);
});

test("a taken slug REFUSES the ask — the race between the door's read and its write", async () => {
  // THE BRANCH IS A RACE GUARD AND THE TEST HAS TO RACE IT. `planRegistryJoin`
  // resolves a named join through `houseForName`, which matches on the slug as
  // well as the nameplate — so a house already on the roll comes back as
  // `appended` and the mint is never reached. The only road to `TAKEN` is the
  // one it was written for: the house is founded BETWEEN the door's read and
  // the mint's, by the other door or by a sibling a second earlier.
  //
  // So the pool answers the first `households` read without the house and every
  // read after it with the house present. Anything less than that would be a
  // test asserting an unreachable branch, which is a test that cannot fail for
  // the reason it names.
  captured = { trees: [], commits: [], refs: [], pulls: [] };
  openPulls = [];
  const after = {
    ...REGISTRY(),
    households: { ...REGISTRY().households, "a-late-house": {
      name: "A Late House", accounts: [{ login: "first-mover", id: 6 }], residents: [], since: "2026-09-22",
    } },
  };
  const before = makePool(rowsFromRegistry(REGISTRY(), PINS()));
  const later = makePool(rowsFromRegistry(after, PINS()));
  let householdReads = 0;
  __setPoolForTest({
    async query(text, params) {
      if (/FROM households/.test(text)) {
        householdReads += 1;
        return (householdReads === 1 ? before : later).query(text, params);
      }
      return later.query(text, params);
    },
  });
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  Object.assign(process.env, ENV_ON);
  try {
    await assert.rejects(
      () => requestResidency({ handle: "latecomer", card: "hi", household: "A Late House" },
        { ghId: 5, ghLogin: "someone-else", handles: new Set() }, db, PEN()),
      (e) => e.code === 409);
    assert.ok(householdReads >= 2, "the race actually happened — the mint read after the door did");
    assert.equal(captured.pulls.length, 0, "and no PR was opened declaring a house that already stands");
  } finally {
    __setPoolForTest(null);
    if (was.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
    if (was.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
  }
});

// ── THE RECORD IS NEVER ASKED OF GITHUB ─────────────────────────────────────

test("the pen never asks GitHub for either register", async () => {
  // The mock answers 418 for anything it does not expect, so a surviving
  // `readTownJson` would make the whole ask throw rather than pass quietly.
  const { out } = await ask({ handle: "tulip", card: "hello" }, HOUSE_KEY);
  assert.ok(out.pr_url, "the ask completed, so nothing hit the 418");
});

// ── THE GANGWAY ─────────────────────────────────────────────────────────────

test("a frozen gangway boards a household member and the berth names their house", async () => {
  // The gangway's own words, ruled 2026-08-06: "the freeze counts handles — a
  // new handle inside an existing credential household boards the ship like any
  // other arrival". A passenger is not a resident, so no register is touched;
  // the berth simply remembers which house it will come ashore into.
  //
  // Moved here from `test/residency.test.mjs` with POS-158: the house's own
  // nameplate is read from the record, and that suite's spawned office cannot
  // reach one.
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
  // SYBIL 1a, and the test that missed it (review 3/6). The version above drives
  // with `HOUSE_KEY` — an account that already holds a house — so
  // `planRegistryJoin` answers `appended`, the mint is never reached, and
  // `writes.households = 0` for a reason that has nothing to do with the
  // gangway. It passed for the wrong reason.
  //
  // A FRESH ACCOUNT is what exercises the hole: `planRegistryJoin` answers
  // `created`, the mint IS reached, and before the fix a berth walked away with
  // a `households` row while the answer said "recorded on the berth, declared
  // at disembarkation". The gangway is the town's breaker on arrivals; a mint
  // that runs past it is the breaker on the old pipe.
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

// ── ONE HUMAN, ONE HOUSEHOLD ────────────────────────────────────────────────

test("an undeclared house declaring itself is SEEDED WHOLE — one human, one household", async () => {
  // RESTORED (review 5/6, ruled by Wright). This falsifier was deleted with the
  // six that moved out of `test/residency.test.mjs`, and it should not have
  // been: it had behaviour behind it that no other test watched.
  //
  // `planRegistryJoin` computes `residents: [...siblings, handle]` — the
  // handles this account already acts for are the same house by definition —
  // but `requestResidency` minted with `residents: []` and the crossing's
  // `joinHousehold` then added only the one joining handle. A two-handle
  // account founded a house the record said held one resident, and nothing
  // said so. RULED: the record agrees with the plan.
  //
  // The seam the original could not reach is the one asserted here: the ROW, in
  // the record, at the moment the door mints it.
  const reg = REGISTRY();
  delete reg.households["the-trueing-house"];     // wright's account now holds no house
  const key = { ghId: 999, ghLogin: "keeminlee", handles: new Set(["wright"]) };

  const { out, pool } = await ask(
    { handle: "sibling", card: "the second of us", household: "Trueing" }, key, { registry: reg });

  assert.equal(out.household.action, "created");
  assert.equal(out.household.slug, "trueing");

  const row = pool.state.households.find((h) => h.slug === "trueing");
  assert.ok(row, "the house is in the record");
  assert.deepEqual(row.residents, ["wright"],
    "seeded whole: the handle already bound to this account is in the house at founding");
  assert.equal(row.residents.includes("sibling"), false,
    "and the JOINING handle is not — its admission is the Registrar's merge, and `joinHousehold` adds it at the crossing that follows");

  // the two calls compose to the plan's own answer
  const { joinHousehold } = await import("../src/ceremony.mjs");
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  __setPoolForTest(pool);
  Object.assign(process.env, ENV_ON);
  try {
    await joinHousehold({ slug: "trueing", handle: "sibling", coSign: { ghId: 999, ghLogin: "keeminlee" },
      pinnedOn: "2026-09-22", drain: async () => ({ ran: true, changed: [] }) });
  } finally {
    __setPoolForTest(null);
    if (was.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
    if (was.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
  }
  assert.deepEqual(pool.state.households.find((h) => h.slug === "trueing").residents, ["wright", "sibling"],
    "the end state IS the plan's `[...siblings, handle]`");

  assert.match(captured.pulls[0].body, /seeded whole/, "and the Registrar is told, in the body");
});

// ── A PROVISIONAL HOUSE CHOOSES ITS KEY AT THIS DOOR (POS-197) ──────────────
//
// POS-159 built the choose-once rename and measured that no door reached it.
// On this path the house row is written at the co-sign, before the PR opens
// (Keemin, 2026-09-22, POS-158 STOP 1), so the choice is made here too: the
// request is the co-sign, `planRegistryJoin` answers `chosen`, and
// `requestResidency` routes it to the ceremony's rename.

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

test("a provisional house's human naming a real house RENAMES it at the co-sign, and the card names the choice", async () => {
  const { out, pool } = await ask(
    { handle: "fernwood-two", card: "the second of us", household: "Fernwood Hollow" }, QUIET_HUMAN,
    { registry: WITH_A_PROVISIONAL_HOUSE() });

  assert.equal(out.household.action, "chosen");
  assert.equal(out.household.slug, "fernwood-hollow");
  assert.equal(out.household.formerly, "fernwood");
  assert.equal(pool.state.households.find((h) => h.slug === "fernwood"), undefined, "no row under the borrowed key");
  const row = pool.state.households.find((h) => h.slug === "fernwood-hollow");
  assert.ok(row, "the house stands under the key it chose");
  assert.deepEqual(row.formerly, ["fernwood"], "the borrowed key is kept in `formerly`");
  assert.equal(row.provisional, false);
  assert.equal(row.name, "Fernwood Hollow");
  assert.deepEqual(row.residents, ["fernwood"], "the membership is still the crossing's — nobody admitted early");
  assert.equal(pool.state.households.length, 3, "renamed, never a second house");
  assert.equal(pool.state.pins.some((p) => p.handle === "fernwood-two"), false, "no pin at the door");

  assert.match(cardFor("fernwood-two"), /household: Fernwood Hollow/, "the card reads the chosen name");
  assert.match(captured.pulls[0].body, /the house chose its key/);
  assert.match(out.note, /provisional key "fernwood"/, "and the resident is told, in words");
});

test("a provisional house's human who types NOTHING has not chosen — appended, nothing renamed", async () => {
  const { out, pool } = await ask(
    { handle: "fernwood-two", card: "the second of us" }, QUIET_HUMAN, { registry: WITH_A_PROVISIONAL_HOUSE() });
  assert.equal(out.household.action, "appended");
  assert.equal(out.household.slug, "fernwood");
  assert.equal(pool.state.writes.households, 0, "no house row was written");
  assert.equal(pool.state.households.find((h) => h.slug === "fernwood").provisional, true);
});

test("a SECOND choice meets the ceremony's CHOSEN refusal as this door's 409 — and no PR opens", async () => {
  const { REFUSALS } = await import("../src/ceremony.mjs");
  const reg = WITH_A_PROVISIONAL_HOUSE();
  const { provisional: _p, ...chosen } = reg.households.fernwood;
  delete reg.households.fernwood;
  reg.households["fernwood-hollow"] = { ...chosen, name: "Fernwood Hollow", formerly: ["fernwood"] };

  await assert.rejects(
    () => ask({ handle: "fernwood-three", card: "hi", household: "Somewhere Else Entirely" }, QUIET_HUMAN, { registry: reg }),
    (e) => e.code === REFUSALS.CHOSEN.code && e.defect === REFUSALS.CHOSEN.defect && e.hint === REFUSALS.CHOSEN.hint);
  assert.equal(captured.pulls.length, 0, "the refusal comes before the PR");
});
