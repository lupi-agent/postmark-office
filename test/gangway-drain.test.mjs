// gangway-drain.test.mjs — the arrivals breaker reaches the settlement road.
//
//   node --test test/gangway-drain.test.mjs
//
// THE DEFECT THIS FILE HOLDS SHUT, in the town's own words. The Registrar's
// audit-era instruments name it as data rather than prose so that
// `node tools/registrar-audit.mjs seams` prints it —
// `GANGWAY_IN_THE_AUDIT_ERA.audit_era_gap`, verbatim:
//
//   "THE AUDIT-ERA DRAIN DOES NOT READ IT. src/town-drain.mjs § planTownDrain
//    (office repo) sorts every pending row into settle/waiting/skipped and
//    never opens HARBOR/GANGWAY.md — so with TOWN_SINGLE_LOG on, a frozen
//    gangway would not stop a crossing from settling rows. The breaker is
//    wired to the lane the pivot retires and not to the lane that replaces it."
//
// And the falsifier it asked for, `OFFICE_SEAM.gangway.falsifier`, verbatim:
//
//   "A crossing with `state: frozen` settles zero rows and advances no cursor;
//    the same crossing with `state: open` settles them. Flip both directions."
//
// THE CURSOR IS THE HALF THAT MATTERS, and it is the half the seam note did not
// know it was asking for. Filing a row under `waiting` is a line in a REPORT;
// runTownDrain advanced the cursor to the last PENDING row whatever pile it
// landed in, so a held join would have been reported as waiting and then walked
// past forever. G4 is that falsifier, and it fails on the reporting half alone.

import "./helpers/drain-pen.mjs"; // #2040: fixtures get a real ledger pen
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { fixtureDb } from "./fixture.mjs";
import { openOauthDb } from "../src/oauth.mjs";
import { appendTownJournal, pendingRows, townDrainCursor } from "../src/town-journal.mjs";
import { GANGWAY_HELD, planTownDrain as REAL_planTownDrain } from "../src/town-drain.mjs";
import { runTownDrain, TOWN_DOORS } from "../src/town-bridge.mjs";
import { MAIL_ACT } from "../src/town-mail.mjs";
import { outboxRelPath } from "../src/write.mjs";
import { REGISTRY_PATH } from "../src/residency.mjs";
import { withRecordFrom } from "./registry-pool-stub.mjs";

// POINTED AT THE RECORD (POS-158). `planTownDrain` reads the town's registry
// from the store now, so this seeds the store from whatever registry the clone
// holds — the same fixture these tests already write. Without it every plan
// here would answer "the record is unreachable" and defer every row, which is
// correct behaviour answering the wrong question.
const planTownDrain = (o, clone, opts) => withRecordFrom(clone, () => REAL_planTownDrain(o, clone, opts));


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
  const dir = tmp("gangway-town");
  for (const h of handles) {
    mkdirSync(join(dir, "WHITE_PAGES", h, "outbox"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "inbox"), { recursive: true });
    mkdirSync(join(dir, "WHITE_PAGES", h, "HOME"), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\ngithub: gh-${h}\nsince: 2026-01-01\n---\n\n# ${h}\n`);
  }
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), "# the mail ledger\n\n- 2026-07-01 · a-line · someone → someone\n");
  writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), "# the stamp ledger\n\n- 2026-08-01 · registry: someone = hh:elsewhere\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

/** HARBOR/GANGWAY.md as the founder writes it — one word the whole town hangs off. */
const setGangway = (clone, state) => {
  mkdirSync(join(clone, "HARBOR"), { recursive: true });
  writeFileSync(join(clone, "HARBOR", "GANGWAY.md"),
    `# the gangway\n\nstate: ${state}\n\nFounder-edited only.\n`);
};

const liveOdb = () => openOauthDb(join(tmp("gangway-odb"), "oauth.db"));

const seedJoin = (o, handle = "newcomer") => appendTownJournal(o, {
  cls: "join", act: "declare-household", household: handle, handle,
  ghId: "777", ghLogin: `${handle}-gh`,
  payload: { household: handle, card: `${handle}'s card.` },
});
const seedUpdate = (o) => appendTownJournal(o, {
  cls: "update", act: "home", household: "keemin", handle: "wright",
  ghId: "42", ghLogin: "keeminlee",
  payload: { args: { handle: "wright", body: "A home written by the drain." } },
});
const seedLetter = (o, { from = "wright", to = "limen", date = "2026-08-24", slug = "a-fine-hat" } = {}) =>
  appendTownJournal(o, {
    cls: "letter", act: MAIL_ACT, household: "keemin", handle: from,
    ghId: "42", ghLogin: "keeminlee",
    payload: {
      args: { from, to, title: "a fine hat", thread: "new", body: `${to} —\n\nA letter the drain will materialize.` },
      id: `${from}-${date}-to-${to}-${slug}`, file: outboxRelPath(from, date, to, slug),
    },
  });

const db = fixtureDb();
const HELD = () => true;
const silent = () => {};
// POINTED AT THE RECORD, AND AWAITED (POS-158). A crossing reads the town's
// registry from the store and writes its membership rows there, so the helper
// seeds the store from whatever registry the clone already holds — the same
// fixture these tests were already writing — and awaits the drain. Without it
// every crossing here would answer "the record is unreachable" and defer every
// row, which is correct behaviour answering the wrong question.
const run = (o, over = {}) => withRecordFrom(over.clone, () => runTownDrain(o, { db, doors: TOWN_DOORS, lockHeld: HELD, log: silent, ...over }));
// ASYNC-AWARE SINCE POS-158. `return fn()` handed back a promise and the
// `finally` then cleared the flag while the work was still running — a teardown
// racing the thing it tears down, which fails somewhere else entirely.
const flagOn = async (fn) => {
  process.env.TOWN_SINGLE_LOG = "1";
  try { return await fn(); } finally { delete process.env.TOWN_SINGLE_LOG; }
};
const ashore = (clone, h) => existsSync(join(clone, "WHITE_PAGES", h, "ADDRESS.md"));

test.after(dropAll);

// ═══════════════════════════════════════════════════════════════════════════
// G1-G3 · THE GANGWAY, AT THE PLANNER — the pile a held row lands in
// ═══════════════════════════════════════════════════════════════════════════

test("G1 · FROZEN: every join row is filed WAITING, and the reason names the gangway", async () => {
  const clone = townClone();
  const o = liveOdb();
  try {
    seedJoin(o, "newcomer");
    seedJoin(o, "second-arrival");
    setGangway(clone, "frozen");

    const plan = await planTownDrain(o, clone, { date: "2026-08-24" });

    assert.deepEqual(plan.settle, [], "a frozen gangway settles nothing — the valve is on the pipe");
    assert.deepEqual(plan.plans, [], "…so there is no registry diff to write either");
    assert.deepEqual(plan.waiting.map((w) => w.row.handle), ["newcomer", "second-arrival"]);
    assert.deepEqual(plan.gangway, { state: "frozen", held: 2 });

    // OFFICE_SEAM.gangway.how, verbatim: "Do not send them to `skipped` —
    // skipped rows are judged and done."
    assert.deepEqual(plan.skipped, [],
      "waiting is the pile that means 'not yet, and nothing is lost'; skipped is the pile that means judged and done");

    // A STATED THRESHOLD, never a silent wait — the tier line's own rule,
    // which this reason is written to match.
    assert.equal(plan.waiting[0].why, GANGWAY_HELD("frozen"));
    assert.match(plan.waiting[0].why, /HARBOR\/GANGWAY\.md/, "the row names the file a resident can go read");
    assert.match(plan.waiting[0].why, /nothing is lost by waiting/);
  } finally { o.close(); }
});

test("G2 · THE FLIP: the same rows, the same clone, `state: open` — they settle", async () => {
  const clone = townClone();
  const o = liveOdb();
  try {
    seedJoin(o, "newcomer");
    setGangway(clone, "frozen");
    assert.deepEqual((await planTownDrain(o, clone, { date: "2026-08-24" })).settle, [], "frozen: nothing");

    setGangway(clone, "open");
    const open = await planTownDrain(o, clone, { date: "2026-08-24" });
    assert.deepEqual(open.settle.map((r) => r.handle), ["newcomer"],
      "the same crossing with `state: open` settles them — flip both directions");
    assert.deepEqual(open.waiting, []);
    assert.deepEqual(open.gangway, { state: "open", held: 0 });
    assert.equal(open.plans.length, 1, "and the registry diff comes back with it");
  } finally { o.close(); }
});

test("G3 · ABSENT HARBOR IS OPEN: a clone with no gangway file behaves exactly as before", async () => {
  const clone = townClone(); // no HARBOR/ at all
  const o = liveOdb();
  try {
    seedJoin(o, "newcomer");
    const plan = await planTownDrain(o, clone, { date: "2026-08-24" });
    assert.deepEqual(plan.settle.map((r) => r.handle), ["newcomer"],
      "residency.mjs § gangwayState: absent file = open — a town with no HARBOR has no freeze");
    assert.deepEqual(plan.gangway, { state: "open", held: 0 });
  } finally { o.close(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// G4-G6 · THE GANGWAY, AT THE CROSSING — the cursor is the half that matters
// ═══════════════════════════════════════════════════════════════════════════

test("G4 · THE CURSOR DOES NOT MOVE: a held join is still pending after the crossing", async () => {
  const clone = townClone();
  const o = liveOdb();
  try {
    await flagOn(async () => {
      seedJoin(o, "newcomer");
      setGangway(clone, "frozen");

      const r = await run(o, { clone, date: "2026-08-24" });

      assert.equal(r.ran, true);
      assert.deepEqual(r.settled, [], "settles zero rows…");
      assert.equal(townDrainCursor(o), 0, "…and advances no cursor");
      assert.equal(r.cursor, 0, "the report says so in the same breath");
      assert.equal(ashore(clone, "newcomer"), false, "nobody came ashore through a raised gangway");

      // THE DEFECT THIS FALSIFIER HOLDS SHUT. `waiting` is a pile in a REPORT.
      // Without the cursor half, the row would be reported as waiting and then
      // walked past forever — losing a household while printing the word that
      // promises you did not.
      assert.equal(pendingRows(o).length, 1,
        "the row is still in the log, which is the only thing that makes `waiting` mean what it says");

      assert.equal(r.gangway, "frozen");
      assert.equal(r.gangway_held, 1);
      assert.equal(r.remaining, 1, "remaining counts from the CURSOR, not from head — 0 here would be a lie");
    });
  } finally { o.close(); }
});

test("G5 · AND THE CROSSING AFTER THE GANGWAY LOWERS SETTLES THEM", async () => {
  const clone = townClone();
  const o = liveOdb();
  try {
    await flagOn(async () => {
      seedJoin(o, "newcomer");
      setGangway(clone, "frozen");
      await run(o, { clone, date: "2026-08-24" });
      assert.equal(ashore(clone, "newcomer"), false);

      setGangway(clone, "open");
      const r = await run(o, { clone, date: "2026-08-25" });

      assert.deepEqual(r.settled, ["newcomer"], "the freeze was a pause, not a refusal");
      assert.equal(ashore(clone, "newcomer"), true);
      assert.equal(r.gangway, undefined, "an open crossing says nothing about the gangway — a quiet crossing reads as quiet");
      assert.equal(townDrainCursor(o), r.head, "and the cursor catches up");
      assert.deepEqual(pendingRows(o), []);
    });
  } finally { o.close(); }
});

test("G6 · JOINS ONLY, AND THAT IS THE SCOPE CALL: a frozen crossing still carries the mail", async () => {
  const clone = townClone();
  const o = liveOdb();
  try {
    await flagOn(async () => {
      seedJoin(o, "newcomer");
      seedUpdate(o);
      seedLetter(o);
      setGangway(clone, "frozen");

      const r = await run(o, { clone, date: "2026-08-24" });

      // The gangway is the ARRIVALS breaker. Mail and paper have their own
      // controls, and a one-word file that quietly stopped the town's letters
      // would be a second, undeclared policy.
      assert.equal(r.updates.length, 1);
      assert.equal(r.updates[0].skipped, undefined, "a paper act drains through a raised gangway");
      assert.match(readFileSync(join(clone, "WHITE_PAGES", "wright", "HOME", "HOME.md"), "utf8"),
        /A home written by the drain\./);
      assert.equal(r.letters.length, 1);
      assert.equal(r.letters[0].skipped, undefined, "and so does a letter");

      // …and the join is still held, and the cursor with it
      assert.deepEqual(r.settled, []);
      assert.equal(ashore(clone, "newcomer"), false);
      assert.equal(townDrainCursor(o), 0);
    });
  } finally { o.close(); }
});

