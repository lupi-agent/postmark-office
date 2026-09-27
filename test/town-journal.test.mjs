// town-journal.test.mjs — POS-44 slice 1: joins as journal rows, and the drain
// that settles them at the ferry's crossing.
//
//   node --test test/town-journal.test.mjs
//
// Every falsifier here quotes the law it asserts. The epic's four design-ins are
// the acceptance rows, and three of them are testable at this layer; the fourth
// (eyes move from gate to audit) is a lane change, not a code path.

import "./helpers/drain-pen.mjs"; // #2040: fixtures get a real ledger pen
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  appendTownJournal, pendingHandles, pendingRows, readTownJournal, rowIsSettleable,
  townJournalHead, townDrainCursor, TOWN_DRAIN_CURSOR, SETTLE_THRESHOLD, townLogEnabled,
} from "../src/town-journal.mjs";
import { appendJournal, CLASS_MARK } from "../src/world-journal.mjs";
// ── THE ROWS ARE SEEDED, NOT WRITTEN BY A DOOR (G1 / POS-156) ───────────────
//
// G1 deleted the general journal INSERT; the write path writes the RECORD now.
// This suite's subject is the TWO-TABLE separation -- that the world's drain
// cannot reach the town's rows -- so the world-side row it needs is PUT THERE
// by this file, in the office's own row shape. See test/journal-seed.mjs.
import { seedJournalRow } from "./journal-seed.mjs";
import { DYNAMIC_SCHEMA } from "../src/dynamic-store.mjs";

// The world journal's own DDL, lifted from the store's schema rather than
// retyped — a hand-copied table in a test is a second definition of the shape
// the code under test writes into.
const WORLD_JOURNAL_DDL = /CREATE TABLE IF NOT EXISTS journal[\s\S]*?\);/.exec(DYNAMIC_SCHEMA)[0];
import { planTownDrain as REAL_planTownDrain, writeTownDrain as REAL_writeTownDrain, registryLine, advanceTownCursor } from "../src/town-drain.mjs";
import { buildJoinFiles, REGISTRY_PATH } from "../src/residency.mjs";
import { handleTaken } from "../src/declare.mjs";

import { withRecordFrom } from "./registry-pool-stub.mjs";

// ── POINTED AT THE RECORD (POS-158) ────────────────────────────────────────
//
// The registry is store-of-record, so `planTownDrain` reads it and
// `writeTownDrain` writes membership rows into it. These two wrappers seed the
// store from whatever registry the clone already holds — the same fixture each
// test below was already writing — so every assertion in this file keeps
// meaning what it meant. Without them every crossing here would answer "the
// record is unreachable" and defer every row: correct behaviour, answering a
// question this suite is not asking.
//
// EACH CALL GETS A FRESH POOL SEEDED FROM THE CLONE, and that is sound rather
// than lucky: nothing writes the clone between a plan and its write, so the
// store the writer sees is the store the planner saw.
const planTownDrain = (o, clone, opts) => withRecordFrom(clone, () => REAL_planTownDrain(o, clone, opts));
const writeTownDrain = (clone, plan, opts) => withRecordFrom(clone, () => REAL_writeTownDrain(clone, plan, opts));


const odb = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  // the WORLD's table, so the two-tables falsifier can run the world drain's own
  // truncate against it. The town's table is created by ensureTownJournal.
  db.exec(WORLD_JOURNAL_DDL);
  return db;
};
const row = (over = {}) => ({
  act: "declare-household", household: "testers", handle: "tester",
  ghId: "12345", ghLogin: "tester-gh", payload: { household: "Testers", card: "a card" }, ...over,
});
function townClone() {
  const dir = mkdtempSync(join(tmpdir(), "pm-towndrain-"));
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  mkdirSync(join(dir, "tools"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n");
  writeFileSync(join(dir, "WHITE_PAGES/stamp-ledger.md"), "# the ledger\n\n- 2026-08-01 · registry: someone = hh:elsewhere\n");
  return dir;
}

// ── THE SEAM THIS SLICE WAS RULED ON ────────────────────────────────────────
//
// The ruling, 2026-08-24: "the-atomic-drain's law is one log, one consumer."
// The world drain's truncate is `DELETE FROM journal WHERE seq <= plan.head`
// with head = MAX(seq) over the WHOLE table — it reads its own class and
// deletes everything. Two tables is what makes the collision structurally
// impossible rather than a filter discipline every future class re-litigates.
test("TWO LOGS: the town's rows live in their own table, untouched by the world's head", () => {
  const db = odb();
  const seq = appendTownJournal(db, row());
  seedJournalRow(db, { actor: "wright", action: "leave-mark", cls: CLASS_MARK, household: "wright" });

  // the world's head knows nothing of the town's rows, and vice versa
  const worldHead = Number(db.prepare("SELECT MAX(seq) s FROM journal").get()?.s ?? 0);
  assert.equal(worldHead, 1, "the world log numbers its own rows");
  assert.equal(townJournalHead(db), seq, "…and the town log numbers its own");

  // the world drain's own move, run verbatim against a table that is not its own
  db.prepare("DELETE FROM journal WHERE seq <= ?").run(worldHead);
  assert.equal(pendingRows(db).length, 1,
    "a world truncate must not reach the town's rows — this is the entire reason for two tables");
});

// `assert.rejects`, NOT `assert.throws`: `appendJournal` is async since the
// store became the write (G1), so the tripwire's throw arrives as a rejection.
// Same call, same message, same claim -- a tripwire nobody tests stops tripping.
test("THE TRIPWIRE: a join row aimed at the world log bounces at write time", async () => {
  const db = odb();
  await assert.rejects(() => appendJournal(db, { actor: "x", action: "declare", cls: "join", household: "h" }),
    /"join" is the town log's class, not the world's/,
    "a row in the wrong log is a bug; bouncing costs a stack trace, being eaten at truncate time costs somebody their household");
  // and the reverse fence
  // the list grows with TOWN_CLASSES — "letter" joined in wave 3, and this
  // ledger line is paid in the same commit that added it.
  assert.throws(() => appendTownJournal(db, { cls: CLASS_MARK, act: "leave-mark", household: "h" }),
    /the town log holds join, update, letter rows/);
});

// ── DESIGN-IN 1: pending-name uniqueness ────────────────────────────────────
// Verbatim: "Pending-name uniqueness: the handle-free check reads un-drained
// journal rows too (two joins in one epoch must not collide at the drain)".
test("PENDING NAMES: a handle claimed by an un-drained row is not free", () => {
  const db = odb();
  appendTownJournal(db, row({ handle: "wanted" }));
  const held = pendingHandles(db);
  assert.ok(held.has("wanted"), "the name is spoken for from the moment it is claimed");
  assert.equal(held.get("wanted").household, "testers");

  // and the door's own check sees it — the fourth register beside the index,
  // the manifest and the declared registry
  process.env.TOWN_SINGLE_LOG = "1";
  try {
    const taken = handleTaken("wanted", { db: null, registry: { households: {} }, clone: null, odb: db });
    assert.match(String(taken), /a join already in this epoch/,
      "the three older registers are projections of the RECORD, and the record has not been written yet");
    assert.equal(handleTaken("unclaimed", { db: null, registry: { households: {} }, clone: null, odb: db }), null);
  } finally { delete process.env.TOWN_SINGLE_LOG; }
});

test("…and flag-off the fourth register is not consulted at all", () => {
  const db = odb();
  appendTownJournal(db, row({ handle: "wanted" }));
  delete process.env.TOWN_SINGLE_LOG;
  assert.equal(townLogEnabled(), false);
  assert.equal(handleTaken("wanted", { db: null, registry: { households: {} }, clone: null, odb: db }), null,
    "flag-off, every door behaves exactly as it did — the row exists and changes nothing");
});

// ── DESIGN-IN 3: registry writes are APPENDS ────────────────────────────────
// Verbatim: "Registry writes are APPENDS: dated ledger registry: lines + row
// additions in the drain commit, never restatements (replay stays green)". The
// tulip lesson: identity-over-time is recomputed from the lines in order, so
// restating one rewrites history the signatures were taken over.
test("APPENDS ONLY: the drain adds a dated registry line and never rewrites one", async () => {
  const db = odb(); const clone = townClone();
  appendTownJournal(db, row({ handle: "newcomer" }));
  const before = readFileSync(join(clone, "WHITE_PAGES/stamp-ledger.md"), "utf8");

  const plan = await planTownDrain(db, clone, { date: "2026-08-24" });
  await writeTownDrain(clone, plan, { date: "2026-08-24" });
  const after = readFileSync(join(clone, "WHITE_PAGES/stamp-ledger.md"), "utf8");

  assert.ok(after.startsWith(before.replace(/\s*$/, "\n")),
    "every prior line survives byte-for-byte — a retroactive edit turns the replay red");
  assert.ok(after.includes(registryLine("2026-08-24", "newcomer", "testers")),
    "…and the new line is appended, dated");
  assert.equal(after.split("registry:").length - 1, 2, "exactly one line was added");
});

// ── the drain writes what the PEN would have written ────────────────────────
test("EQUIVALENCE: the drain's files are the pen lane's own function, not a second copy", async () => {
  const db = odb(); const clone = townClone();
  appendTownJournal(db, row({ handle: "twin", payload: { household: "Testers", card: "the very same card" } }));
  const plan = await planTownDrain(db, clone, { date: "2026-08-24" });
  await writeTownDrain(clone, plan, { date: "2026-08-24" });

  const expected = buildJoinFiles({ handle: "twin", card: "the very same card", household: "Testers", ghLogin: "tester-gh" });
  for (const f of expected) {
    assert.ok(existsSync(join(clone, f.path)), `${f.path} was written`);
    assert.equal(readFileSync(join(clone, f.path), "utf8"), f.content,
      `${f.path} must be byte-identical to what the pen lane writes — the drain is a second CALLER of one function, never a second implementation`);
  }
  assert.equal(existsSync(join(clone, "WHITE_PAGES/twin/inbox/.gitkeep")), true, "both gitkeeps");
  assert.equal(existsSync(join(clone, "WHITE_PAGES/twin/outbox/.gitkeep")), true);
  const registry = JSON.parse(readFileSync(join(clone, REGISTRY_PATH), "utf8"));
  assert.ok(Object.keys(registry.households).length > 0, "and the households row landed in the same crossing");
});

// ── THE TIER LINE ───────────────────────────────────────────────────────────
// The founder, 2026-08-24: "full automation for both berth and joins (on our
// side, their side still needs a GitHub auth or co-sign)."
test("THE TIER LINE: only a verified id or a co-sign settles; the rest WAIT, and are told", async () => {
  const db = odb(); const clone = townClone();
  appendTownJournal(db, row({ handle: "verified", ghId: "999" }));
  appendTownJournal(db, row({ handle: "cosigned", ghId: null, cosignedGhId: "777" }));
  appendTownJournal(db, row({ handle: "unanchored", ghId: null, ghLogin: null }));

  const plan = await planTownDrain(db, clone, { date: "2026-08-24" });
  assert.deepEqual(plan.settle.map((r) => r.handle).sort(), ["cosigned", "verified"],
    "a verified GitHub id OR a human co-sign — the registry invariants hang off that pin");
  assert.deepEqual(plan.waiting.map((w) => w.row.handle), ["unanchored"]);
  assert.equal(plan.waiting[0].why, SETTLE_THRESHOLD, "a STATED threshold, never a silent wait");
  assert.match(SETTLE_THRESHOLD, /full berth life/,
    "an unverified household stands at the harbor indefinitely, and nothing about its standing expires");

  await writeTownDrain(clone, plan, { date: "2026-08-24" });
  assert.equal(existsSync(join(clone, "WHITE_PAGES/unanchored/ADDRESS.md")), false,
    "the unanchored row is not settled — and it is not dropped either; it stays in the log");
  assert.equal(pendingRows(db).some((r) => r.handle === "unanchored"), true);
});

// ── DESIGN-IN 5 (the standing constraint) ───────────────────────────────────
test("GROUND IS NOT TOUCHED: settling mints an address and a registry row, never a parcel", async () => {
  const db = odb(); const clone = townClone();
  appendTownJournal(db, row({ handle: "grounded" }));
  const plan = await planTownDrain(db, clone, { date: "2026-08-24" });
  const touched = await writeTownDrain(clone, plan, { date: "2026-08-24" });
  for (const path of touched) {
    assert.equal(/WORLD\/|parcel|marks\//.test(path), false,
      `${path}: a join has never implied a parcel — ground is the world's, on the world's own cadence`);
  }
  assert.deepEqual(
    touched.filter((p) => p.startsWith("WHITE_PAGES/grounded")).sort(),
    ["WHITE_PAGES/grounded/ADDRESS.md", "WHITE_PAGES/grounded/inbox/.gitkeep", "WHITE_PAGES/grounded/outbox/.gitkeep"]);
});

// ── the cursor ──────────────────────────────────────────────────────────────
test("THE CURSOR IS THE TOWN'S OWN, and moves only after the record is durable", async () => {
  const db = odb(); const clone = townClone();
  appendTownJournal(db, row({ handle: "first" }));
  const plan = await planTownDrain(db, clone, { date: "2026-08-24" });
  await writeTownDrain(clone, plan, { date: "2026-08-24" });
  assert.equal(townDrainCursor(db), 0,
    "writeTownDrain must NOT advance it — a cursor moved before the commit is the one ordering that can lose a household");
  // AND IT CANNOT, which is stronger than must-not: writeTownDrain is handed a
  // clone and a plan and never the database, so there is no handle for it to
  // advance a cursor with. The flip for this law could not be written — every
  // attempt had to smuggle a db in from outside the signature, which is the
  // guarantee showing itself rather than a gap in the test.
  // THE REAL FUNCTION, NOT THIS FILE'S WRAPPER. `writeTownDrain` above is a
  // record-pointing wrapper (§ POINTED AT THE RECORD), and asserting a shape
  // against it would be asserting this suite's own scaffolding — which is the
  // exact class where a test's scaffolding reads as coverage.
  assert.equal(REAL_writeTownDrain.length, 3, "writeTownDrain(clone, plan, { date }) — no db parameter");
  assert.equal(/odb/.test(REAL_writeTownDrain.toString()), false, "…and no db reached from its body");
  advanceTownCursor(db, plan.head);
  assert.equal(townDrainCursor(db), plan.head);
  assert.deepEqual(pendingRows(db), [], "and the drained row is no longer pending");
  assert.notEqual(TOWN_DRAIN_CURSOR, "journal_drained_through", "never the world's key");
});

test("ONE NAME, ONE CROSSING: a second row for a settled name does not write twice", async () => {
  const db = odb(); const clone = townClone();
  appendTownJournal(db, row({ handle: "dupe" }));
  appendTownJournal(db, row({ handle: "dupe", household: "others" }));
  const plan = await planTownDrain(db, clone, { date: "2026-08-24" });
  assert.equal(plan.settle.length, 1, "the door holds the name; the drain checks anyway, because 'unreachable' is what a drain must not assume about its input");
  assert.match(plan.skipped[0].why, /claimed earlier in this same crossing/);
});
