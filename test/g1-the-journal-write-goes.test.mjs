// g1-the-journal-write-goes.test.mjs — G1's own falsifier: the general journal
// INSERT is gone, and the write refuses. (The arena's narrow named INSERT went
// when the arena closed, 2026-09-30, so world-journal.mjs now carries none.)
//
// POS-156. This is the test the deletion is proved by, and `tools/pos156-flip-
// the-insert.sh` is the proof that it can fail: that script restores the INSERT
// into `appendJournal`, asserts its own match count, and requires this suite to
// red.
//
// WHAT IS ASSERTED, and why each one is here:
//
//   the door writes NO journal row   behavioural, through a real sqlite store
//                                    and the in-memory record. The whole claim
//                                    of G1 in one assertion.
//   the write REFUSES                RULING 3: a door whose act cannot reach the
//                                    record answers 503, never 200 over a lost
//                                    act. Asserted with the record unreachable.
//   the source carries no INSERT     a pin, because the behavioural test above
//                                    would still pass if the INSERT came back
//                                    behind a flag nobody set in this suite.
//
//   node --test test/g1-the-journal-write-goes.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { appendJournal, normalizeRow, readJournal, CLASS_ARENA_ACT, CLASS_FRAME, CLASS_MARK } from "../src/world-journal.mjs";
import { currentCrossing } from "../src/crossings.mjs";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";

const scratch = mkdtempSync(join(tmpdir(), "pos156-g1-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } });

// The journal table as `dynamic.db` declares it — enough columns for the one
// INSERT that is left, and no more. A fixture generous enough to accept a row
// the office does not write would flatter a deletion that had not happened.
const freshDb = () => {
  const db = new DatabaseSync(join(scratch, `g1-${Math.random().toString(36).slice(2)}.db`));
  db.exec(`CREATE TABLE journal (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    crossing REAL, actor TEXT, action TEXT, object TEXT,
    at_anchor TEXT, at_dx REAL, at_dy REAL, witnesses TEXT,
    class TEXT, payload TEXT, effect TEXT, household TEXT, written_at TEXT)`);
  return db;
};

let pen;
const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL, late: process.env.W2_LATE_ARRIVAL };
beforeEach(() => {
  process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
  process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
  pen = installActsPen();
});
after(() => {
  uninstallActsPen();
  for (const [k, v] of [["WORLD2_PG", was.pg], ["WORLD2_PG_URL", was.url], ["W2_LATE_ARRIVAL", was.late]])
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

const frameRow = () => ({
  crossing: currentCrossing(), actor: "wright", action: "enter", object: "the-town/town-square",
  cls: CLASS_FRAME, at: null, witnesses: null,
  payload: { ledger: "WORLD/enter-exit-ledger.md", lines: ["- a crossing"] },
  effect: "the crossing is declared",
});

// ── 1. THE DELETION ──────────────────────────────────────────────────────────

test("THE WRITE GOES TO THE RECORD AND NOWHERE ELSE — no journal row, for any class but the arena's", async () => {
  const db = freshDb();
  try {
    const r = await appendJournal(db, frameRow());

    assert.equal(pen.rows().length, 1, "the act is in the record");
    assert.equal(r.actId, 1, "and the caller's receipt is the record's own id");
    assert.equal(r.seq, null, "there is no sqlite line to name");
    assert.equal(r.record, "acts");

    // THE ASSERTION G1 IS. A row here is the reverse mirror returning.
    assert.deepEqual(readJournal(db), [],
      "a journal row was written — G1 deleted that INSERT, and a copy that came back is the split brain returning");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM journal").get().c, 0);
  } finally { db.close(); }
});

test("…and the same holds for a mark, which is the class whose body must never take a second copy", async () => {
  const db = freshDb();
  try {
    await appendJournal(db, {
      crossing: currentCrossing(), actor: "alpha", household: "alpha",
      action: "leave-mark", object: "alpha/a-sketch", cls: CLASS_MARK, at: null, witnesses: null,
      payload: { by: "alpha", slug: "a-sketch", kind: "sited", body: "a sentence nobody else has read" },
      effect: "a draft stands",
    });
    assert.equal(db.prepare("SELECT COUNT(*) c FROM journal").get().c, 0,
      "a mark's BODY landed in a second store — `acts` is the table that leaves the box and this would be a third copy of a private sentence");
  } finally { db.close(); }
});

// ── 3. THE WRITE REFUSES (RULING 3) ──────────────────────────────────────────

test("AN UNREACHABLE RECORD IS A REFUSAL, not a 200 over an act no store holds", async () => {
  uninstallActsPen();              // the office is pointed at a record it cannot reach
  const db = freshDb();
  try {
    let refused = null;
    try { await appendJournal(db, frameRow()); } catch (e) { refused = e; }

    assert.equal(refused?.name, "PenUnreachableError",
      "the write resolved with no record behind it — that is a door telling a resident their act happened when no store holds it");
    assert.equal(refused.code, 503);
    assert.match(refused.message, /nothing was written, and nothing was lost/);
    assert.equal(db.prepare("SELECT COUNT(*) c FROM journal").get().c, 0,
      "and there is no consolation copy — a refused act left nothing anywhere, which is the sentence the refusal makes");
  } finally { db.close(); }
});

test("A STORE THAT THROWS AT WRITE TIME leaves the record UNCHANGED, not merely empty", async () => {
  // The sharper half of the refusal, and the one RULING 3 names: "NO row exists
  // anywhere (sqlite absent, acts unchanged)". The test above proves the
  // refusal with no record at all; this one proves it against a record that is
  // THERE, already holds rows, and fails on the write — which is the state a
  // real outage leaves and the only one in which "unchanged" says more than
  // "empty".
  const db = freshDb();
  try {
    // One good act first, so there is something the refusal could damage.
    await appendJournal(db, frameRow());
    const before = pen.rows();
    assert.equal(before.length, 1, "control: the record holds one act before the failure");

    // Now the store throws on the INSERT and on nothing else — the transaction
    // frame still answers, so what is proven is a failed WRITE rather than an
    // unreachable pool.
    const failing = installActsPen({ failOn: (q) => /^INSERT INTO acts/i.test(q) });
    for (const r of before) failing.seedAct(r);

    let refused = null;
    try { await appendJournal(db, frameRow()); } catch (e) { refused = e; }

    assert.equal(refused?.name, "PenUnreachableError",
      "a write that threw resolved anyway — the door would answer 200 over an act the record refused");
    assert.equal(refused.code, 503);
    assert.deepEqual(failing.rows(), before,
      "the record MOVED under a refused write — unchanged is the claim, and it is stronger than empty");
    assert.equal(failing.state.rolledBack, 1, "and the transaction rolled back rather than being abandoned open");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM journal").get().c, 0,
      "and no consolation copy reached sqlite either");
  } finally { db.close(); }
});

// ── 4. THE SOURCE ────────────────────────────────────────────────────────────
//
// A pin, because the behavioural tests above would still pass if the INSERT
// came back behind a condition this suite does not exercise. The flip script
// puts it back unconditionally, so it reds test 1 as well — two ways to catch
// the same return, which is what makes this a falsifier rather than a sentinel.

test("PIN: `world-journal.mjs` carries NO `INSERT INTO journal` (G1 took the general one; the arena's closed with it)", () => {
  const text = readFileSync(new URL("../src/world-journal.mjs", import.meta.url), "utf8");
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const inserts = code.match(/INSERT INTO journal/g) ?? [];
  assert.equal(inserts.length, 0,
    `there are ${inserts.length} journal INSERTs in world-journal.mjs; G1 took the general one and the arena's closed on 2026-09-30`);

  const general = code.slice(code.indexOf("export async function appendJournal"), code.indexOf("export async function appendActFlipped"));
  assert.ok(general.length > 200, "appendJournal was not found — this pin is reading the wrong region");
  assert.equal(/INSERT INTO journal/.test(general), false,
    "`appendJournal` writes a journal row again — that is the INSERT G1 deleted");
  assert.match(general, /penWrite/, "and it no longer awaits the record");
});

test("PIN: `normalizeRow` is still the one row shape, and both writers take it", () => {
  // The normalizer survives the deletion on purpose: the record's row, the
  // arena's archived rows and every fixture read one shape. A second spelling is how two
  // eras come to disagree in a way that still parses (this file's own lesson).
  const row = normalizeRow({ actor: "wright", action: "strike", cls: CLASS_ARENA_ACT, at: null });
  assert.equal(row.class, CLASS_ARENA_ACT);
  assert.equal(typeof row.written_at, "string", "a row that cannot say when is a row that cannot be checked");
  assert.ok("at_anchor" in row && "at_dx" in row && "at_dy" in row,
    "the witnessed line is three columns on both sides of the seam, and has never been a payload key");
});
