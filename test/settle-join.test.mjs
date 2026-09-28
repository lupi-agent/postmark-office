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
import { settleJoinAtOffice, settleUnderLock, SETTLE_REFUSALS, PEN_GH_ID, penIdentity } from "../src/settle-join.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";

// 43947 — checked against every port literal in test/ before this line.
const GH_PORT = 43947;

// ── a mock GitHub, exactly as wide as the door's one read ───────────────────
let pulls = [];
let asked = [];
let server;
before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    asked.push(`${req.method} ${url.pathname}${url.search}`);
    res.writeHead(req.method === "GET" && url.pathname.endsWith("/pulls") ? 200 : 418, { "content-type": "application/json" });
    if (req.method !== "GET" || !url.pathname.endsWith("/pulls")) return res.end("{}");
    const head = url.searchParams.get("head") ?? "";
    const ref = head.split(":")[1];
    res.end(JSON.stringify(pulls.filter((p) => p.head.ref === ref)));
  });
  await new Promise((ok) => server.listen(GH_PORT, "127.0.0.1", ok));
});
after(async () => { await new Promise((ok) => server.close(ok)); });

const PEN = { apiBase: `http://127.0.0.1:${GH_PORT}`, token: "a-mock-pen-token", owner: "postmark-town", repo: "postmark", baseBranch: "main" };

// The pen's own body, the shape `src/residency.mjs § joinBody` writes.
const penBody = (login, id) =>
  `Josie asks for an address in the town — opened by the office pen on their behalf.\n\n**Verified via GitHub sign-in:** \`@${login}\` (immutable id \`${id}\`). The identity pin comes from *this verified ID*.`;

const penPR = ({ n = 3217, handle = "wildcat", merged = true, author = PEN_GH_ID, body = penBody("commander-and-chief", 334016343) } = {}) => ({
  number: n, state: merged ? "closed" : "open", merged_at: merged ? "2026-09-28T06:16:01Z" : null,
  user: { id: author, login: author === PEN_GH_ID ? "postmark-pen" : "someone" },
  head: { ref: `residency/${handle}` }, body,
});

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
const card = (handle, household) =>
  `---\nhandle: ${handle}\nagent: Josie\nhousehold: ${household}\narchitecture: (unstated)\nsince: 2023-06-13\njoined: 2026-09-27\ngithub: commander-and-chief\n---\n\nHello.\n`;

const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();

function town({ households = HOUSEHOLDS(), pins = PINS(), cards = { wildcat: "house-of-many-doors" } } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "settle-join-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), JSON.stringify(households, null, 2) + "\n");
  writeFileSync(join(dir, PINS_PATH), JSON.stringify(pins, null, 2) + "\n");
  for (const [h, house] of Object.entries(cards)) {
    mkdirSync(join(dir, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), card(h, house));
  }
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

test("a non-pen PR refuses", async () => {
  pulls = [penPR({ author: 424242 })];
  const clone = town();
  const { err, pool } = await settle(clone);
  assert.equal(err?.defect, SETTLE_REFUSALS.NOT_PEN.defect);
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
