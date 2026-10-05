// standing-doors.test.mjs — the doors learn standing.
//
//   node --test test/standing-doors.test.mjs
//
// THE DEFECT THIS FILE HOLDS SHUT, in the town's own words. The Registrar's
// audit power binds the PR lane and nothing else; `OFFICE_SEAM.doors.what`,
// verbatim:
//
//   "The MCP write doors do not consult standing. A quarantined resident can
//    still send_letter, update_home, update_window, stake_vote, world_note —
//    every door the town has."
//
// AND THE HALF THAT IS THE LAW RATHER THAN THE WIRING, `OFFICE_SEAM.doors.how`:
//
//   "Reads stay open: standing suspends WRITING, never READING — a quarantined
//    resident must be able to read the reason, their own pages, and their mail."
//
// Every falsifier below that ends `…and the read passes` is asserting that
// sentence and not a convenience: a suspension the resident cannot read is a
// deletion the town will not admit to.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { openOauthDb } from "../src/oauth.mjs";
import { REGISTRY_PATH } from "../src/residency.mjs";
import {
  bounceSentence, foldStanding, isSuspended, standingBounce, standingOf,
  STANDING_LEDGER_PATH,
} from "../src/standing.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { townApex } from "../src/town-apex.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { plantStanding, resetStanding } from "./helpers/standing-rows.mjs";

// THE LEDGER IS A STORE TABLE (POS-347, 060_standing_acts.sql). The in-process
// tests below read standing through the office's one pool, so this process is
// pointed at a store of its own before anything asks; each test starts from a
// clean ledger. The spawned office (S7) reads its index store, and the rows are
// planted there.
const STANDING = await startStore({ db: "standing_doors" });
process.env.WORLD2_PG = "1";
process.env.WORLD2_PG_URL = STANDING.url("office_api");
test.after(async () => {
  const { __setPoolForTest } = await import("../src/world2-acts.mjs");
  __setPoolForTest(null);
  await STANDING.stop();
});

// The town index this file's offices read: a store seeded from each fixture
// office.db (POS-268, office-under-test.mjs). Stopped when the file is done.
const STORES = [];
const storeFor = async (dbPath) => { const x = await indexStore(dbPath); STORES.push(x); return x; };
test.after(async () => { for (const x of STORES) await x.stop(); });

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
delete process.env.TOWN_PUSH; // nothing here may leave the machine

// ── fixtures ────────────────────────────────────────────────────────────────

const trash = [];
const tmp = (tag) => { const d = mkdtempSync(join(tmpdir(), `pm-${tag}-`)); trash.push(d); return d; };
const dropAll = () => {
  for (const d of trash.splice(0)) {
    // A leftover temp directory is not a failing falsifier. On Windows a sqlite
    // handle can outlive the process that held it by a beat.
    try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* the OS will */ }
  }
};

/** A town clone with the rooms the doors write into, under git so the pen can commit. */
function townClone({ handles = ["wright", "limen"] } = {}) {
  const dir = tmp("standing-town");
  for (const h of handles) {
    mkdirSync(join(dir, "WHITE_PAGES", h, "outbox"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "inbox"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "HOME"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "WINDOW"), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\ngithub: gh-${h}\nsince: 2026-01-01\n---\n\n# ${h}\n`);
    writeFileSync(join(dir, "WHITE_PAGES", h, "PROFILE.md"), `---\nhandle: ${h}\ncolor: "#334455"\n---\n\nprofile body\n`);
  }
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), "# the mail ledger\n\n- 2026-07-01 · a-line · someone → someone\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

const db = fixtureDb();

test.after(dropAll);

// ═══════════════════════════════════════════════════════════════════════════
// S1-S3 · THE FOLD — history in, geography out
// ═══════════════════════════════════════════════════════════════════════════

const LEDGER = (...lines) => `# standing-ledger\n\n${lines.join("\n")}\n`;
const Q = (h, date = "2026-08-24", reason = "three arrivals in one hour from one unpinned account") =>
  `- ${date} · quarantine · ${h} · by: registrar · reason: ${reason}`;
const LIFT = (h, date = "2026-08-25", reason = "answered at the audit round") =>
  `- ${date} · lift · ${h} · by: registrar · reason: ${reason}`;
const REVOKE = (h, date = "2026-08-26", word = "this one does not stay", reason = "the pattern did not stop") =>
  `- ${date} · revoke · ${h} · by: registrar · founder-word: ${word} · reason: ${reason}`;

test("S1 · THE FOLD: file order is the append order, and the last act on a handle wins", () => {
  const { standing } = foldStanding(LEDGER(Q("alpha"), Q("beta"), LIFT("alpha"), REVOKE("beta")));

  assert.equal(standing.get("alpha").state, "clear", "a lift clears");
  assert.equal(standing.get("beta").state, "revoked", "and the stronger act stands last");
  assert.equal(standing.get("nobody"), undefined, "never mentioned is not a state, it is silence");

  assert.equal(isSuspended(standing.get("alpha")), false);
  assert.equal(isSuspended(standing.get("beta")), true);
  assert.equal(isSuspended(standing.get("nobody")), false,
    "`clear` and 'never mentioned' are both open — the doors are shut only by an act");
});

test("S2 · A MALFORMED ACT IS NEVER SKIPPED IN SILENCE", () => {
  // The town's own reasoning: "This is a ledger about whether people are
  // allowed to speak; a malformed row here could be a quarantine nobody can
  // see." The `·` in a middle field is the exact defect planAct refuses.
  const bad = "- 2026-08-24 · quarantine · gamma · by: registrar · with · dots · reason: nope";
  const { standing, unparsed } = foldStanding(LEDGER(Q("alpha"), bad));
  assert.deepEqual(unparsed, [bad]);
  assert.equal(standing.get("gamma"), undefined, "it did not silently become a quarantine…");
  assert.equal(standing.get("alpha").state, "quarantined", "…and it did not stop the fold either");
});

test("S3 · THE HONEST SENTENCE says what, when, whose hand, why — and how it ends", async () => {
  await resetStanding(STANDING);
  await plantStanding(STANDING, Q("wright"));
  const rec = await standingOf("wright");
  const said = bounceSentence(rec, { handle: "wright" });

  assert.match(said, /`wright` is quarantined as of 2026-08-24/, "WHAT and WHEN");
  assert.match(said, /by registrar/, "WHOSE HAND");
  assert.match(said, /three arrivals in one hour from one unpinned account/,
    "the REASON in the words that were actually written down, not a paraphrase");
  assert.match(said, /It is reversible and it is meant to be reversed/, "HOW IT ENDS — the point of the four");
  assert.match(said, /deletes nothing/, "…and that nothing was taken away");
  assert.match(said, new RegExp(STANDING_LEDGER_PATH.replace("/", "\\/")),
    "the act is a dated line anyone can go read");

  // A quarantine that reads as permanent is a revocation wearing a softer word,
  // so the revoked sentence must read differently — and carry the founder's own
  // sentence, quoted.
  await plantStanding(STANDING, REVOKE("wright"));
  const gone = bounceSentence(await standingOf("wright"), { handle: "wright" });
  assert.match(gone, /was revoked on 2026-08-26/);
  assert.match(gone, /"this one does not stay"/, "the founder's word, verbatim");
  assert.match(gone, /lifted only on the founder's word/, "how THIS one ends, which is not the same road");
});

test("S4 · NO ROWS IS THE ORDINARY CASE: an empty ledger, everyone in good standing", async () => {
  await resetStanding(STANDING);
  assert.equal(await standingOf("wright"), null);
  assert.equal(await standingBounce({ handles: new Set(["wright"]) }), null,
    "no rows means nobody has ever been suspended, which is a fine state for a town to be in");
  assert.equal(await standingBounce({ handles: new Set(["wright"]) }, {}), null,
    "and an office not pointed at a record at all has no record anyone could be suspended in");
});

test("S4b · AN UNREADABLE RECORD IS NOT GOOD STANDING: the write is refused with a 503 that wrote nothing", async () => {
  // The old road read a missing FILE as "nobody suspended". A store that is
  // pointed at and cannot answer is a different fact, and reading it as clear
  // would let a quarantine lapse every time a connection dropped.
  const { __setPoolForTest } = await import("../src/world2-acts.mjs");
  __setPoolForTest({ query: async () => { throw new Error("connection refused"); } });
  try {
    const b = await standingBounce({ handles: new Set(["wright"]) });
    assert.equal(b?.code, 503, "refused, never waved through");
    assert.match(b.hint, /nothing was written/);
    await assert.rejects(standingOf("wright"), /connection refused/, "the key desk's read throws for its door to dress");
  } finally { __setPoolForTest(null); }
});

test("S5 · A CALLER WITH NO HANDLES PASSES: visitors and berths meet their own gates", async () => {
  await resetStanding(STANDING);
  await plantStanding(STANDING, Q("wright"));
  assert.equal(await standingBounce({ handles: new Set() }), null);
  assert.equal(await standingBounce({ visitor: true }), null);
  assert.equal(await standingBounce(null), null);

  const bounced = await standingBounce({ handles: new Set(["wright"]) });
  assert.equal(bounced.code, 403);
  assert.equal(bounced.handle, "wright");
  assert.equal(bounced.standing, "quarantined");
  assert.match(bounced.defect, /`wright` is quarantined/);
});

// ═══════════════════════════════════════════════════════════════════════════
// S6 · THE HOUSEHOLD APEX — the act branch bounces, the read branch does not
// ═══════════════════════════════════════════════════════════════════════════

test("S6 · THE APEX: `do:` bounces for a quarantined resident, `read:` and the bare call do not", async () => {
  const clone = townClone();
  const key = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };
  const ctx = { db, clone, odb: null, dbPath: null, pen: null };
  await resetStanding(STANDING);

  const before = await householdApex({ do: "home", args: { handle: "wright", body: "hello" } }, key, ctx);
  assert.notEqual(before?.code, 403, "clean standing: the act is judged on its own merits, whatever they are");

  await plantStanding(STANDING, Q("wright"));

  const act = await householdApex({ do: "home", args: { handle: "wright", body: "hello" } }, key, ctx);
  assert.equal(act.error, "bounce");
  assert.equal(act.code, 403);
  assert.match(act.hint, /It is reversible and it is meant to be reversed/);

  // READS ARE NEVER SUSPENDED — "a suspension the resident can't read is a
  // deletion the town won't admit to."
  const bare = await householdApex({}, key, ctx);
  assert.notEqual(bare?.code, 403, "the bare call is a read and stays open");
  const read = await householdApex({ read: "address" }, key, ctx);
  assert.notEqual(read?.code, 403, "and so does `read:` — the reason is one of the things they are reading");

  // …and a lift, with no restart, reopens it: the store is read per call.
  await plantStanding(STANDING, LIFT("wright"));
  const after = await householdApex({ do: "home", args: { handle: "wright", body: "hello" } }, key, ctx);
  assert.notEqual(after?.code, 403, "a Registrar's lift lands at the next call — no pull, no office restart");
});

test("S6b · THE TOWN APEX holds its own gate — and now it has an act to hold it over", async () => {
  // THE HOLE THIS CLOSES. mcp.mjs gates every write-shaped call in one line,
  // and `writeShaped` resolved `world { do: }` and `household { do: }` but not
  // `town { do: }` — so the town apex's one act, declare-household, dispatched
  // straight past it to the same flat verb the gated door refuses. Same act,
  // two doors, two answers: the paper seam's defect wearing a different hat.
  // (`writeShaped` learnt `town` on 2026-08-31, when its stated reason for not
  // doing so — the declare_household exemption — turned out to have expired the
  // day the act moved. The apex keeps its own gate anyway: two gates that agree
  // is the household door's shape, and this one covers the in-process callers
  // that never pass through mcp.mjs's ladder.)
  const clone = townClone();
  const key = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };
  const dispatched = [];
  // The REAL schema map, not an empty one (2026-09-11): the town apex's read
  // branch now validates `args:` against the flat tool's own field list, and a
  // caller handing it no map is answered as the wiring defect it is. The gate
  // this test is about is unaffected either way; the map is what lets the two
  // reads at the bottom still dispatch.
  const { TOOLS } = await import("../src/mcp.mjs");
  const ctx = { clone, schemas: Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}])),
    schemaRequired: {}, call: (tool, fields) => { dispatched.push(tool); return { ok: tool, fields }; } };

  await resetStanding(STANDING);
  await plantStanding(STANDING, Q("wright"));

  // 2026-08-30: declare-household MOVED home to household { do: "declare" } —
  // the town's roster went empty and this test lost its teeth, with the note
  // that it would grow them back "when the stake gesture lands and the roster
  // refills". IT LANDED, 2026-08-31, and the teeth are the two blocks below.
  // A moved act still dispatches nothing, whatever the caller's standing:
  const act = await townApex({ do: "declare-household", args: { household: "Another", handle: "another", card: "x" } }, key, ctx);
  assert.equal(act.code, 422, "an act not on the roster is refused before any gate is even consulted");
  assert.match(act.hint, /household \{ do: "declare" \}/, "the bounce walks the caller to the door that holds the pen");
  assert.deepEqual(dispatched, [], "and the flat verb was never reached");

  // ── THE TEETH, GROWN BACK ─────────────────────────────────────────────────
  //
  // `wright` is quarantined in the ledger written above. The town's roster now
  // holds three durable acts, and every one of them must meet the standing gate
  // AT THIS DOOR — not because mcp.mjs would also catch it (it would, since
  // 2026-08-31), but because the apex is dispatched from callers that never
  // reach that ladder, and a suspended resident staking real stamps through the
  // quiet path is the exact shape of the hole this file exists to close.
  for (const [what, args] of [
    ["post", { class: "idea", slug: "s", body: "b" }],
    ["stake", { mark: "wright/a-newcomers-first-hour", stamps: 1 }],
    ["unstake", { mark: "wright/a-newcomers-first-hour", stamps: 1 }],
  ]) {
    const r = await townApex({ do: what, args }, key, ctx);
    assert.equal(r.code, 403, `a quarantined resident's ${what} is refused by STANDING, not by argument shape`);
    assert.deepEqual(dispatched, [], `…and ${what} reached no flat verb — the escrow machinery was never touched`);
  }

  // READS ARE NEVER SUSPENDED — the bare call and `read:` stay open here too,
  // the stake shadow included: the reason for the suspension is one of the
  // things a suspended resident is reading, and so is what the town is backing.
  assert.notEqual((await townApex({}, key, ctx))?.code, 403, "the bare call is a read");
  await townApex({ read: "town" }, key, ctx);
  assert.deepEqual(dispatched, ["read_town"], "…and a `read:` dispatches as it always did");
  await townApex({ read: "stake", args: { mark: "wright/a-newcomers-first-hour" } }, key, ctx);
  assert.deepEqual(dispatched, ["read_town", "town_stake_read"], "…the act's shadow included");

  // …and a lift reopens the acts, live, with no restart — the same property S6a
  // asserts for the household door, now asserted for the third one.
  await plantStanding(STANDING, LIFT("wright"));
  const after = await townApex({ do: "stake", args: { mark: "wright/a-newcomers-first-hour", stamps: 1 } }, key, ctx);
  assert.notEqual(after?.code, 403, "a Registrar's lift lands at the next call — no pull, no office restart");
  assert.equal(dispatched.at(-1), "town_stake", "…and the act reaches its flat verb the moment standing returns");
});

// ═══════════════════════════════════════════════════════════════════════════
// S7 · BOTH SKINS, OVER REAL HTTP — the whole progression on one server
// ═══════════════════════════════════════════════════════════════════════════

test("S7 · REST AND MCP: writes bounce, reads pass, lift reopens, revoke shuts again", async () => {
  const work = tmp("seam-srv");
  const clone = townClone();
  let child;
  try {
    const dbPath = join(work, "fixture.db");
    fixtureDb(dbPath).close();
    const IX = await storeFor(dbPath);
    const IX_ENV = { ...IX.env };
    // The spawned office reads standing from its own store; with the suite's
    // index forced back to office.db (OFFICE_TEST_INDEX=office) it has none, so
    // it reads the in-process ledger store instead.
    const LEDGER_STORE = IX.store ?? STANDING;
    if (!IX.store) Object.assign(IX_ENV, { WORLD2_PG: "1", WORLD2_PG_URL: STANDING.url("office_api") });
    await resetStanding(LEDGER_STORE);
    const odbPath = join(work, "oauth.db");
    openOauthDb(odbPath).close();

    // The port is asked of the OS, never chosen (spawn-office.mjs § the port,
    // asked for); it was the fixed 43917, a door every pool tree on the box shares.
    let PORT;
    let BASE;
    const KEY = "standingkey";
    ({ child, port: PORT } = await bootOnFreePort((port) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(port), "--db", dbPath, "--oauth-db", odbPath], {
      env: {
        ...process.env, WORLD_GRAPH_NONE: "1", ...IX_ENV, OFFICE_KEYS: `${KEY}=keemin:wright`,
        TOWN_CLONE: clone, WORLD_CLONE: join(work, "no-world"), VOICES_LOG: join(work, "voices.jsonl"), TOWN_PUSH: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    })));
    BASE = `http://127.0.0.1:${PORT}`;
    const auth = { authorization: `Bearer ${KEY}`, "content-type": "application/json" };

    const patch = (body) => fetch(`${BASE}/profile/wright`, { method: "PATCH", headers: auth, body: JSON.stringify(body) });
    const rpc = (name, args) => fetch(`${BASE}/mcp`, {
      method: "POST", headers: auth,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    }).then((r) => r.json()).then((j) => ({
      isError: Boolean(j.result?.isError),
      text: j.result?.content?.[0]?.text ?? "",
    }));

    // ── an empty ledger · BYTE-IDENTICAL ──────────────────────────────────
    // The office that has never heard of standing and the office that has,
    // over a town nobody was ever suspended in, must be the same office.
    assert.equal((await patch({ bio: "written with nobody suspended" })).status, 200,
      "no ledger: a write lands exactly as it always did");
    assert.equal((await rpc("update_profile", { handle: "wright", bio: "and through MCP too" })).isError, false);

    // ── quarantined · WRITES BOUNCE ON BOTH SKINS ─────────────────────────
    await plantStanding(LEDGER_STORE, Q("wright"));

    const restBounce = await patch({ bio: "this must not land" });
    assert.equal(restBounce.status, 403, "REST: a quarantined resident's write is refused");
    const restBody = await restBounce.json();
    assert.match(restBody.defect, /`wright` is quarantined/);
    assert.match(restBody.hint, /three arrivals in one hour from one unpinned account/, "the reason rides out");
    assert.match(restBody.hint, /the Registrar reviews it at the next audit round/, "and so does how it ends");

    const mcpBounce = await rpc("send_letter", { from: "wright", to: "limen", title: "nope", body: "nope" });
    assert.equal(mcpBounce.isError, true, "MCP: the same act, the same answer");
    assert.match(mcpBounce.text, /`wright` is quarantined/);
    assert.match(mcpBounce.text, /It is reversible and it is meant to be reversed/);

    // …and the bio never changed, on either skin
    assert.doesNotMatch(readFileSync(join(clone, "WHITE_PAGES", "wright", "PROFILE.md"), "utf8"),
      /this must not land/, "a bounce is a bounce — nothing reached the record");

    // ── quarantined · READS PASS ON BOTH SKINS ────────────────────────────
    assert.equal((await fetch(`${BASE}/residents/wright`, { headers: auth })).status, 200,
      "REST read: their own page stays readable");
    assert.equal((await fetch(`${BASE}/mail/wright`, { headers: auth })).status, 200,
      "REST read: their own mail stays readable");
    assert.equal((await rpc("read_town", {})).isError, false, "MCP read: the town stays readable");
    assert.equal((await rpc("read_resident", { handle: "wright" })).isError, false,
      "MCP read: and so does the resident the act was about");
    assert.equal((await rpc("whoami", {})).isError, false,
      "whoami is a read of your OWN identity, and a suspended resident is still somebody");

    // ── lifted · IT REOPENS, WITH NO RESTART ──────────────────────────────
    await plantStanding(LEDGER_STORE, LIFT("wright"));
    assert.equal((await patch({ bio: "lifted, and writing again" })).status, 200,
      "the store is read per call: a lift lands at the next write");
    assert.equal((await rpc("update_profile", { handle: "wright", bio: "lifted on MCP too" })).isError, false);

    // ── revoked · IT SHUTS AGAIN, AND SAYS SO DIFFERENTLY ─────────────────
    await plantStanding(LEDGER_STORE, REVOKE("wright"));
    const revoked = await patch({ bio: "must not land either" });
    assert.equal(revoked.status, 403);
    const revokedBody = await revoked.json();
    assert.match(revokedBody.defect, /residency is revoked/);
    assert.match(revokedBody.hint, /"this one does not stay"/, "the founder's word travels to the door");
    assert.match(revokedBody.hint, /lifted only on the founder's word/);
    assert.equal((await fetch(`${BASE}/residents/wright`, { headers: auth })).status, 200,
      "and even revoked, the pages stand and stay readable — nothing was deleted");
  } finally {
    if (child && child.exitCode === null) {
      const gone = new Promise((ok) => child.on("exit", ok));
      child.kill();
      await gone; // Windows: the db stays locked until the child is truly down
    }
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
