// gangway-store.test.mjs — the gangway is a store row, the founder pulls it
// through one office act, and HARBOR/GANGWAY.md is its export (POS-353).
//
//   node --test test/gangway-store.test.mjs
//
//   BACKFILL   the first drain adopts the file's state (source git); the file
//              then already says what the store says.
//   READ       every reader's one read: no rows and no record are "open"; the
//              newest row decides; an unreadable record is a named 503.
//   THE DOOR   the founder's act appends a row and renders the file's state
//              and since in one commit, keeping the prose; asking for the state
//              it is already in is refused and writes nothing.
//   GIT IN     a founder commit with a (state, since) the store never held is
//              adopted; a stale rendering (a pair it has held) is overwritten.
//   THE GATE   only a key whose verified id holds the principal role may call
//              it, and to anyone else the act does not exist.
//   APPEND     062's trigger refuses UPDATE and DELETE.
//
// THE FLIP (after the commit): adoptFromGit adopts whenever the file differs
// from the newest row (no pair check) — STALE goes red: the old rendering is
// adopted as a new freeze.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { startStore } from "./helpers/embedded-store.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { gangwayState, GANGWAY_PATH, GANGWAY_UNREADABLE, renderGangwayFile } from "../src/gangway.mjs";
import { drainGangway, checkGangway } from "../tools/gangway-drain.mjs";
import { gangwayUnderLock, judgeGangwayFields, callerMayGangway } from "../src/gangway-door.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { openPaper } from "../src/paperwork.mjs";
import { rolesSchema, grantRole } from "../src/roles.mjs";

const store = await startStore({ db: "gangway_store_test" });
process.env.WORLD2_PG = "1";
process.env.WORLD2_PG_URL = store.url("office_api");
delete process.env.TOWN_PUSH;

const trash = [];
after(async () => {
  __setPoolForTest(null);
  await store.stop();
  for (const d of trash) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const FILE = (state, since) => `---\nstate: ${state}\nsince: ${since}\nruled_by: founder\n---\n\n# The gangway\n\n**The gangway is down and it stays down.** The founder's prose.\n`;

function townClone(text) {
  const dir = mkdtempSync(join(tmpdir(), "pm-gangway-"));
  trash.push(dir);
  mkdirSync(join(dir, "HARBOR"), { recursive: true });
  if (text !== null) writeFileSync(join(dir, GANGWAY_PATH), text);
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "--allow-empty", "-m", "fixture");
  return dir;
}
const readFile = (dir) => readFileSync(join(dir, GANGWAY_PATH), "utf8");
const capture = () => { const made = []; const fn = (c, p, m) => { made.push(m); return `sha${made.length}`; }; fn.made = made; return fn; };
async function reset() {
  const c = await store.connect("world2_owner");
  try { await c.query("TRUNCATE gangway_acts"); } finally { await c.end(); }
}
async function rows() {
  const c = await store.connect("office_api");
  try { return (await c.query("SELECT state, since, by_who, source FROM gangway_acts ORDER BY id")).rows; } finally { await c.end(); }
}

test("READ: no rows and no record are open; the newest row decides; an unreadable record is a named 503", async () => {
  await reset();
  assert.equal(await gangwayState(), "open", "a town that never raised it");
  assert.equal(await gangwayState({}), "open", "and an office with no record has no freeze");
  const c = await store.connect("office_api");
  try { await c.query("INSERT INTO gangway_acts (state, since, by_who, source) VALUES ('frozen', '2026-10-04', 'founder', 'door')"); }
  finally { await c.end(); }
  assert.equal(await gangwayState(), "frozen");
  __setPoolForTest({ query: async () => { throw new Error("connection refused"); } });
  try { await assert.rejects(gangwayState(), (e) => e.code === 503 && e.defect === GANGWAY_UNREADABLE.defect); }
  finally { __setPoolForTest(null); }
});

test("BACKFILL: the first drain adopts the file's state, and the file already says it", async () => {
  await reset();
  const clone = townClone(FILE("open", "2026-08-21"));
  const commit = capture();
  const r = await drainGangway({ clone, commit });
  assert.equal(r.adopted?.state, "open");
  assert.equal(r.changed, false);
  assert.deepEqual(await rows(), [{ state: "open", since: "2026-08-21", by_who: "git", source: "git" }]);
  assert.equal((await checkGangway({ clone })).equal, true);
});

test("THE DOOR: the founder's act appends, renders state and since in one commit, keeps the prose; a no-op is refused", async () => {
  await reset();
  const clone = townClone(FILE("open", "2026-08-21"));
  const commit = capture();
  const drain = (o) => drainGangway({ ...o, commit });
  const act = judgeGangwayFields({ state: "frozen", reason: "a flood of arrivals from one account" }, { date: "2026-10-05" });
  const out = await gangwayUnderLock({ act, actorGhId: 42, clone, drain });
  assert.equal(out.state, "frozen");
  assert.equal(out.previous, "open");
  assert.equal(commit.made.length, 1);
  assert.equal(readFile(clone), FILE("frozen", "2026-10-05"), "only the state and since lines moved; the prose is the founder's");
  assert.equal(await gangwayState(), "frozen", "every arrival road reads it at its next call");
  await assert.rejects(gangwayUnderLock({ act, actorGhId: 42, clone, drain }), (e) => e.code === 409);
  assert.equal((await rows()).length, 2, "the file's own state, then the door's — and no no-op row");
  assert.throws(() => judgeGangwayFields({ state: "shut", reason: "x" }), (e) => e.code === 422);
  assert.throws(() => judgeGangwayFields({ state: "open", reason: "  " }), (e) => e.code === 422);
});

test("GIT IN / STALE: a new (state, since) committed by the founder is adopted; an old rendering is overwritten", async () => {
  await reset();
  const clone = townClone(FILE("open", "2026-08-21"));
  await drainGangway({ clone, commit: capture() });
  // the founder raises it by commit, as he always could
  writeFileSync(join(clone, GANGWAY_PATH), FILE("frozen", "2026-10-06"));
  const r = await drainGangway({ clone, commit: capture() });
  assert.equal(r.adopted?.state, "frozen");
  assert.equal(await gangwayState(), "frozen");
  // STALE: the file goes back to a pair the store has already held — that is an
  // old rendering, never a new act, and the newest row is drawn over it
  writeFileSync(join(clone, GANGWAY_PATH), FILE("open", "2026-08-21"));
  const commit = capture();
  const s = await drainGangway({ clone, commit });
  assert.equal(s.adopted, null);
  assert.equal(s.changed, true);
  assert.equal(readFile(clone), FILE("frozen", "2026-10-06"));
  assert.equal(await gangwayState(), "frozen");
});

test("THE GATE: the principal role, read from the registry; to anyone else the act does not exist", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pm-gangway-roles-"));
  trash.push(dir);
  const rdb = await openPaper(join(dir, "roles.db"), { schema: rolesSchema });
  const founder = { household: "keemin", handles: new Set(["wright"]), ghId: 67605380, ghLogin: "keeminlee" };
  const stranger = { household: "limen-house", handles: new Set(["limen"]), ghId: 7 };
  try {
    assert.equal(await callerMayGangway(founder, { rdb }), false, "no role row, no lever — whatever the env says");
    await grantRole(rdb, { subject: founder.ghId, role: "principal", actor: "test" });
    assert.equal(await callerMayGangway(founder, { rdb }), true);
    assert.equal(await callerMayGangway(stranger, { rdb }), false);
    assert.equal(await callerMayGangway({ handles: new Set(["wright"]) }, { rdb }), false, "a static key with no id never is");

    const ctx = { db: null, clone: null, odb: null, dbPath: null, pen: null, rdb };
    const asked = await householdApex({ do: "gangway", args: { state: "frozen", reason: "x" } }, stranger, ctx);
    const never = await householdApex({ do: "no-such-act-anywhere", args: {} }, stranger, ctx);
    assert.equal(asked.code, never.code, "the same answer a name the door has never heard of gets");
  } finally { rdb.close?.(); }
});

test("APPEND: 062's trigger refuses UPDATE and DELETE, the owner included", async () => {
  for (const role of ["office_api", "world2_owner"]) {
    const c = await store.connect(role);
    try {
      await assert.rejects(c.query("UPDATE gangway_acts SET state = 'open'"), /./);
      await assert.rejects(c.query("DELETE FROM gangway_acts"), /./);
    } finally { await c.end(); }
  }
});

test("the render writes a file that has no frontmatter yet, and keeps its words", () => {
  const out = renderGangwayFile("# The gangway\n\nprose\n", { state: "open", since: "2026-10-05" });
  assert.equal(out, "---\nstate: open\nsince: 2026-10-05\nruled_by: founder\n---\n\n# The gangway\n\nprose\n");
});
