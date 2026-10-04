// pen-flip-hold-say.test.mjs — LANES TWO AND FOUR OF THE PEN FLIP (W2_PEN=hold,
// W2_PEN=say; runbook C2/C4, wired 2026-09-03).
//
// Every test quotes the law it asserts, verbatim:
//
//   DESIGN-pen-flip.md §3 (ruled 2026-08-29)  "for a flipped lane Postgres
//                                              commits first and is awaited;
//                                              sqlite receives the row AFTER,
//                                              as the reverse mirror (D3)"
//   D2, the ruled refusal                      "the office's record cannot be
//                                              reached — nothing was written,
//                                              and nothing was lost"
//   R2's forbidden state (runbook §5 NO-GO)    "a sqlite row present after a
//                                              refused write … 1.0's pen
//                                              holding a row the resident was
//                                              told did not happen"
//   runbook §5, per lane                       "wire the lane's call site to
//                                              appendActFlipped … then add the
//                                              lane name to W2_PEN. A flag is
//                                              necessary and not sufficient."
//
// The hold lane's 1.0 pen is `attachments`; the say lane's is the voices log.
// Each test below asks the one question R2 asks: after a refused write, is
// there a row in the 1.0 pen? Zero, or the flip lied.
//
//   node --test test/pen-flip-hold-say.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmp = mkdtempSync(join(tmpdir(), "postmark-penflip-"));
after(() => { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } });

// A pen nothing listens on: port 1. `penWrite` wraps the failure (connect
// refused, or the pg import itself absent on a box without it) in
// PenUnreachableError either way — the consent-door test measured both.
const DEAD_PEN = "postgres://nobody:wrong@127.0.0.1:1/refused";
const unflip = () => { delete process.env.W2_PEN; delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; };
unflip();
after(unflip);

const { openDynamic } = await import("../src/dynamic-store.mjs");
const { declareHoldingFlipped, declareHolding, holdingEntry } = await import("../src/world-hold.mjs");
const { createVoices } = await import("../src/voices.mjs");

// THE CROSSING IS BORROWED, NOT THE SUBJECT: nothing here asserts what
// happened at a named window, so the acts are stamped with the window open
// when this file runs, through the guard's own currentCrossing (the #302
// lesson: a pinned crossing decays the moment the town crosses past it).
const { currentCrossing } = await import("../src/crossings.mjs");
const OPEN = currentCrossing();

// The door's real dependencies reach into the world store; these stand in for
// them so the ordering is on trial and nothing else is.
const stubDeps = (over = {}) => ({
  witnessStamp: async () => ({ at: { anchor: "the-town/the-quay", dx: 0, dy: 0 }, witnesses: null }),
  resolvedWorldHousehold: () => null,
  currentCrossing: () => OPEN,
  ...over,
});
const count = (db, table) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);

// ── C2 · hold ────────────────────────────────────────────────────────────────

// THE FLIPPED HOLD HAS NO SQLITE ARM (POS-269). These three ran the flipped pen
// with the guards off, so the holder check read dynamic.db's edge and the pen's
// reverse mirror wrote its journal. Both went with the file: the hold acts are
// the edge, read through the guards. So each test now hands the holder check
// the record (a guard reader over a list of acts), and R2's question — after a
// refused write, is there a row? — is asked of that record.
const { useGuardReader } = await import("../src/world2-guards.mjs");
const onRecord = (acts) => useGuardReader(async (fn) => fn({
  query: async (sql, params) => {
    if (!/FROM acts WHERE action = ANY/.test(String(sql))) throw new Error(`this stand-in answers the holder read only: ${String(sql).slice(0, 80)}`);
    const want = new Set(params[0]);
    return { rows: acts.filter((x) => want.has(x.action)) };
  },
}));
const onActs = (over = {}) => stubDeps({ onActs: true, ...over });

test("HOLD, FLIPPED, PEN UNREACHABLE: the door refuses with the ruled sentence and NOTHING is written", async () => {
  process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = DEAD_PEN; process.env.W2_PEN = "hold";
  const acts = [];
  const unread = onRecord(acts);
  try {
    let refused = null;
    try { await declareHoldingFlipped({ db: null, thing: "maker/thing", actor: "alpha", deps: onActs() }); }
    catch (err) { refused = err; }
    assert.ok(refused, "an unreachable pen must refuse");
    assert.equal(refused.code, 503, `expected the ruled 503, got ${JSON.stringify({ code: refused.code, message: refused.message }).slice(0, 200)}`);
    assert.match(refused.message, /nothing was written, and nothing was lost/);
    assert.match(refused.hint, /W2_PEN=hold/);
    // R2's forbidden state, asked of the record:
    assert.equal(acts.length, 0, "a refused take left a holding act — the record holds a row the resident was told did not happen");
  } finally { unread(); unflip(); }
});

test("HOLD, FLIPPED, PEN COMMITS: the act is the record, in the one row shape, and the answer names it", async () => {
  process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = DEAD_PEN; process.env.W2_PEN = "hold";
  const acts = [];
  const unread = onRecord(acts);
  try {
    const seen = [];
    const penned = async (_db, entry) => { seen.push(entry); return { seq: null, actId: 4242, flipped: true }; };
    const did = await declareHoldingFlipped({ db: null, thing: "maker/thing", actor: "alpha", deps: onActs({ appendActFlipped: penned }) });
    assert.equal(did.did, "take");
    assert.equal(did.holder, "alpha");
    assert.equal(did.log, "acts", "a flipped lane's answer says which store is the record");
    assert.equal(did.seq, 4242, "and names the act by its id");
    assert.equal(seen.length, 1, "one act handed to the pen");
    const shape = holdingEntry(did, { crossing: OPEN, at: seen[0].at, witnesses: null, cls: "holding", household: null });
    assert.deepEqual(seen[0].payload, shape.payload);
    assert.equal(seen[0].action, shape.action);
    assert.equal(seen[0].writtenAt, shape.writtenAt);
  } finally { unread(); unflip(); }
});

test("HOLD, FLIPPED, THE DOOR ITSELF REFUSES (give what you do not hold): the pen is never tried and nothing is written", async () => {
  process.env.WORLD2_PG = "1"; process.env.WORLD2_PG_URL = DEAD_PEN; process.env.W2_PEN = "hold";
  // beta holds it, on the record; alpha tries to give it away — the door's own
  // 403, before any pen.
  const acts = [{ id: 1, at: new Date("2026-09-30T04:00:00Z"), actor: "beta", action: "take",
    payload: { thing: "maker/thing", holder: "beta", previous_holder: null, made_by: "maker", policy: "cascade" } }];
  const unread = onRecord(acts);
  try {
    let tried = 0;
    let refused = null;
    try { await declareHoldingFlipped({ db: null, thing: "maker/thing", to: "gamma", actor: "alpha", deps: onActs({ appendActFlipped: async () => { tried++; return { seq: 1 }; } }) }); }
    catch (err) { refused = err; }
    assert.equal(refused?.code, 403, "giving a thing someone else holds is the door's own 403");
    assert.equal(tried, 0, "the pen must not be tried for an act the door refused");
    assert.equal(acts.length, 1, "beta's take, and nothing else");
  } finally { unread(); unflip(); }
});

test("HOLD, OFF THE HOLD LANE: the flipped pen refuses by name before it reads or writes anything (dynamic.db no longer stands in)", async () => {
  let tried = 0, refused = null;
  try { await declareHoldingFlipped({ db: null, thing: "maker/thing", actor: "alpha", deps: stubDeps({ onActs: false, appendActFlipped: async () => { tried++; return { seq: 1 }; } }) }); }
  catch (err) { refused = err; }
  assert.equal(refused?.code, 503);
  assert.match(refused.message, /holding things needs the hold lane's record/);
  assert.equal(tried, 0);
});

test("HOLD, THE ADJUDICATOR ALONE: declareHolding, the pure library the door calls, still adjudicates a hand-built store with no pen in sight (not the door: the door has no unflipped pen since POS-269)", () => {
  unflip();
  const db = openDynamic(join(tmp, "hold-unflipped.db"));
  try {
    const did = declareHolding({ db, thing: "maker/thing", actor: "alpha", dials: {} });
    assert.equal(did.did, "take");
    assert.equal(did.log, undefined, "an unflipped answer carries no record claim");
    assert.equal(count(db, "attachments"), 1);
  } finally { db.close(); }
});

// ── C4 · say ─────────────────────────────────────────────────────────────────

const voicesAt = (logPath, hooks) => createVoices({
  standpoint: async (h) => ({ handle: h, placed: true, x: 10, y: 20, aboard: false, moving: false }),
  place: async () => "the quay",
  logPath,
  ...hooks,
});

test("SAY, THE PEN REFUSES: beforeSpoke's bounce IS the answer, and the voice was never spoken — no log line, no listener, no presence", async () => {
  const log = join(tmp, "say-refused.jsonl");
  let listened = 0;
  const v = voicesAt(log, {
    beforeSpoke: async () => ({ error: "bounce", defect: "the office's record cannot be reached — nothing was written, and nothing was lost", hint: "W2_PEN=say" }),
    onSpoke: () => { listened++; },
  });
  const r = await v.say("alpha", "is anyone there");
  assert.equal(r.error, "bounce");
  assert.match(r.defect, /nothing was written/);
  assert.equal(existsSync(log), false, "a refused voice reached the 1.0 pen (the voices log)");
  assert.equal(listened, 0, "a refused voice reached a listener (the emission / the mirror)");
  assert.equal(v._voices().length, 0, "a refused voice is in the in-memory window");
  assert.equal(v.lastPresent(["alpha"]), null, "a refused voice touched presence");
});

test("SAY, THE PEN COMMITS: the pen runs BEFORE the log line, and sees an empty log when it does (Postgres first, sqlite after)", async () => {
  const log = join(tmp, "say-committed.jsonl");
  const order = [];
  const v = voicesAt(log, {
    beforeSpoke: async (voice, spoken) => {
      order.push(`pen:${existsSync(log) ? "log-already-written" : "log-empty"}`);
      assert.equal(voice.handle, "alpha");
      assert.equal(voice.text, "is anyone there");
      assert.equal(voice.x, 10);
      assert.equal(spoken.standAs, "alpha");
      return null;
    },
    onSpoke: () => { order.push("listener"); },
  });
  const r = await v.say("alpha", "is anyone there");
  assert.equal(r.spoke, true);
  assert.deepEqual(order, ["pen:log-empty", "listener"], "the pen must commit before the 1.0 pen is written, and the listeners fire after both");
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 1);
});

test("SAY, UNFLIPPED: with no beforeSpoke the say path is what it was (the can-fail control)", async () => {
  const log = join(tmp, "say-unflipped.jsonl");
  let listened = 0;
  const v = voicesAt(log, { onSpoke: () => { listened++; } });
  const r = await v.say("alpha", "hello");
  assert.equal(r.spoke, true);
  assert.equal(listened, 1);
  assert.equal(existsSync(log), true);
});
