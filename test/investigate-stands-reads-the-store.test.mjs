// investigate-stands-reads-the-store.test.mjs — POS-162.
//
// `GET /world/investigate` for a mark that EXISTS carries a `stands` block:
// where a held thing actually is, in the law's own three sources. It used to
// open `dynamic.db` read-only for both halves — the `attachments` table and the
// holding-class `journal`. It reads `acts` now, unconditionally, and the sqlite
// read is gone rather than layered under.
//
// ── WHY IT HAD TO MOVE ──────────────────────────────────────────────────────
//
// The sqlite journal TRUNCATES at every drain (world-drain.mjs § the cursor), so
// a set-down older than the cursor was simply not on the record this door could
// read — and the-town/the-reach says that position "is canon at the next fold
// like any move, never a fall-back to the last place the thing was folded".
// `acts` is never truncated. Same shape as POS-152's act reader, one door over.
//
// ── THE DOOR IS THE SUBJECT, NOT THE DERIVATION ─────────────────────────────
//
// `whereThingStands` is pure and already has its own tests on hand-built rows
// (hold-reach, hold-wirings). Those cannot see the law not being CALLED, and
// they stayed green through every shape of this change. So every case here goes
// through `worldInvestigate` — the real door, on a REAL canon mark, because the
// door folds canon out of WORLD_CLONE and a fixture id would bounce before the
// block was ever reached.
//
// ── THE FLIP, run 2026-09-21 against this branch ────────────────────────────
//
// In `src/world.mjs § thingStandsBlock`, put the sqlite read back — replace
//
//     const [{ standsRowsFromStore }, hold] = await Promise.all([
//       import("./world2-guards.mjs"), import("./world-hold.mjs"),
//     ]);
//     const rows = await standsRowsFromStore(id);
//     if (!rows) return null;
//     const { attachments, journal } = rows;
//
// with the 1.0 road —
//
//     const [{ openDynamicReadOnly }, { readAttachments }, { readJournal }, hold] =
//       await Promise.all([ import("./dynamic-store.mjs"), import("./dynamic-entities.mjs"),
//                           import("./world-journal.mjs"), import("./world-hold.mjs") ]);
//     const dyn = openDynamicReadOnly();
//     if (!dyn) return null;
//     const attachments = readAttachments(dyn);
//     const journal = readJournal(dyn, { cls: "holding" });
//
// — and the store legs red. `flip.sh` beside this lane's paperwork runs it and
// asserts its own match count.
//
// NEEDS `WORLD_CLONE` — the door folds canon from the world repo. Without one
// every case SKIPS and says so rather than passing quietly.
//
// Run: WORLD_CLONE=<a world checkout> node --test test/investigate-stands-reads-the-store.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { holdingAct, legacyAttachmentAct, withActs } from "./stands-store-fixture.mjs";

// A thing that genuinely stands in canon. `hold-wirings.test.mjs` WIRING 3 uses
// the same one for the same reason: the block is only reached for a mark the
// engine can find.
const CANON = "quill-stem/candle-for-the-trail";

let MARK = null;
let WHY = null;
test.before(async () => {
  try {
    if (!process.env.WORLD_CLONE) throw new Error("WORLD_CLONE is unset");
    const { worldMarkById } = await import("../src/world.mjs");
    const { mark } = await worldMarkById(CANON);
    if (!mark) throw new Error(`${CANON} does not stand in this clone's canon`);
    MARK = mark;
  } catch (e) { WHY = String(e?.message ?? e); }
});

const investigate = async (acts) => {
  const { worldInvestigate } = await import("../src/world.mjs");
  let answer = null;
  const client = await withActs(acts, async (c) => { answer = await worldInvestigate({ mark: CANON }); return c; });
  return { answer, client };
};

/** wright holds it — one take, policy `cascade`, nothing after it. */
const HELD = [holdingAct({ id: 101, at: "2026-09-07T21:53:00Z", actor: "wright", action: "take", thing: CANON, holder: "wright" })];

/** wright took it and then set it down 1850 m west and 2650 m north of the origin. */
const SET_DOWN = [
  holdingAct({ id: 201, at: "2026-09-07T21:53:00Z", actor: "wright", action: "take", thing: CANON, holder: "wright" }),
  holdingAct({ id: 202, at: "2026-09-07T22:10:00Z", actor: "wright", action: "drop", thing: CANON, holder: null,
    anchor: null, dx: -1850, dy: -2650 }),
];

// ═════════════════════════════════════════════════════════════════════════════
// 1 · THE THREE ANSWERS, through the real door
// ═════════════════════════════════════════════════════════════════════════════

test("A HELD THING: the holder answer comes out of `acts`, in whereThingStands' own words", async (t) => {
  if (!MARK) return t.skip(`no canon mark: ${WHY}`);
  const { answer } = await investigate(HELD);
  assert.ok(!answer.error, `the focus bounced: ${answer.defect}`);
  assert.ok(answer.stands, "the store holds a holding edge for this thing and the door did not see it");
  assert.equal(answer.stands.source, "holder");
  assert.equal(answer.stands.holder, "wright");
  assert.match(String(answer.stands.says), /rides its holder/);
});

test("A THING SET DOWN: the set-down answer carries THE ANCHOR, which lives in three columns and never in the payload", async (t) => {
  if (!MARK) return t.skip(`no canon mark: ${WHY}`);
  const { answer } = await investigate(SET_DOWN);
  assert.ok(answer.stands, "a drop stands on the record and the door answered no block at all");
  assert.equal(answer.stands.source, "set-down",
    "the latest row is a `drop` (policy `detach`), so nobody holds it and the set-down outranks the fold");
  assert.deepEqual(answer.stands.where, { x: -1850, y: -2650 },
    "the witnessed line is `at_anchor/at_dx/at_dy` on the act — a port reading `payload.at` would answer the FOLD here and look right");
  assert.equal(answer.stands.set_down_by, "wright");
  assert.equal(answer.stands.act_seq, 202, "the receipt names the act's own line in the record that answered");
  // AND `at` IS UNTOUCHED. The block sits BESIDE canon's own answer.
  assert.deepEqual(answer.at, MARK.at ?? answer.at,
    "canon's own `at` must not be rewritten by the derived read");
});

test("A THING NEVER HELD: no block at all — absent, not present-and-empty", async (t) => {
  if (!MARK) return t.skip(`no canon mark: ${WHY}`);
  const { answer } = await investigate([
    // A holding record that knows OTHER things. The door must not answer about
    // this one off somebody else's edge — the shape a whole-record read plus a
    // dropped filter would produce.
    holdingAct({ id: 301, at: "2026-09-07T21:53:00Z", actor: "rei", action: "take",
      thing: "rei/a-different-thing-entirely", holder: "rei" }),
  ]);
  assert.ok(!answer.error, `the focus bounced: ${answer.defect}`);
  assert.equal(answer.stands, undefined,
    "a mark nobody has ever held must answer byte-for-byte what it answered before this block existed");
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · THE DOOR READ THE STORE — the leg an equality cannot supply
// ═════════════════════════════════════════════════════════════════════════════

test("THE QUERY COUNT: the door asked `acts` twice — a sqlite-reading door asks it none", async (t) => {
  if (!MARK) return t.skip(`no canon mark: ${WHY}`);
  const { client } = await investigate(HELD);
  const reads = client.asked.filter((a) => /FROM acts/i.test(a.sql));
  assert.equal(reads.length, 2,
    `the door made ${reads.length} acts reads; the holder half and the set-down half are two, and a door back on sqlite makes zero`);
  assert.ok(reads.some((a) => /action = ANY\(\$1\)/i.test(a.sql)), "the holder half");
  assert.ok(reads.some((a) => /class = \$1/i.test(a.sql)), "the set-down half");
});

test("ONE READ: both halves ride a single `reading()`, so the two answers are one snapshot", async (t) => {
  if (!MARK) return t.skip(`no canon mark: ${WHY}`);
  const { client } = await investigate(SET_DOWN);
  // WHAT THIS CAN AND CANNOT SEE, said rather than implied. `useGuardReader`
  // replaces `officeRead` WHOLE, so no `BEGIN READ ONLY` ever reaches a fixture
  // client and an assertion about one here would be measuring the fixture. What
  // the seam does see is how many times the door asked for a client, and
  // `officeRead` opens one transaction per ask: one is one snapshot, two are two
  // with the town free to hand the thing on between them.
  assert.equal(client.reads, 1,
    `the door took the read road ${client.reads} times; the holder half and the set-down half must share one`);
  assert.equal(client.asked.filter((a) => /FROM acts/i.test(a.sql)).length, 2,
    "and it really did make both reads on that one road — one read would pass the count above vacuously");
});

test("THE READ-ONLY ROAD: `standsRowsFromStore` goes through `officeRead`, whose transaction Postgres holds to READ ONLY", async () => {
  // DEC-4 — a read worker holds no writable handle — is STRUCTURAL here rather
  // than asserted, and the pin is a SOURCE pin because the enforcement lives in
  // Postgres and not in any answer this office can produce. Weaker than a
  // behavioural leg, and named as such: what proves the door reads the store at
  // all is the query count above, which is behavioural.
  const { readFileSync } = await import("node:fs");
  const guards = readFileSync(new URL("../src/world2-guards.mjs", import.meta.url), "utf8");
  assert.match(guards, /readerOverride \?\? officeRead/,
    "the one road `standsRowsFromStore` takes has been renamed — this pin no longer names anything");
  const pen = readFileSync(new URL("../src/world2-pen.mjs", import.meta.url), "utf8");
  const at = pen.indexOf("export async function officeRead(");
  assert.ok(at > 0, "officeRead has moved");
  assert.ok(pen.slice(at, at + 400).includes("BEGIN READ ONLY"),
    "officeRead stopped declaring its transaction read-only, and every reader on that road inherited the change");
});

test("THE ORDER IS `(at, id)`, NOT THE INSERT ORDER — a later drop wins over an earlier one", async (t) => {
  if (!MARK) return t.skip(`no canon mark: ${WHY}`);
  // The rows arrive with the LATER act first, the way a store returns them when
  // nothing orders the read. `journal_seq` is null on a flipped lane's rows and
  // is the trap a port inherits from the column's name; the ruled order is D6's.
  const { answer } = await investigate([
    holdingAct({ id: 402, at: "2026-09-07T23:00:00Z", actor: "wright", action: "drop", thing: CANON, holder: null, dx: 10, dy: 20 }),
    holdingAct({ id: 401, at: "2026-09-07T22:00:00Z", actor: "wright", action: "drop", thing: CANON, holder: null, dx: 99, dy: 99 }),
    holdingAct({ id: 400, at: "2026-09-07T21:00:00Z", actor: "wright", action: "take", thing: CANON, holder: "wright" }),
  ]);
  assert.ok(answer.stands, "the record holds two drops and the door answered no block");
  assert.deepEqual(answer.stands.where, { x: 10, y: 20 },
    "latest wins by `at`, so the 23:00 drop stands and the 22:00 one does not");
  assert.equal(answer.stands.act_seq, 402);
});

test("THE FROZEN ERA IS READ TOO: a `legacy:attachment` holder answers, so the seed record is not invisible to this door", async (t) => {
  if (!MARK) return t.skip(`no canon mark: ${WHY}`);
  const { answer } = await investigate([
    legacyAttachmentAct({ id: 501, at: "2026-06-01T10:00:00Z", actor: "ethan-thorne", thing: CANON, policy: "cascade", seq: 41 }),
  ]);
  assert.ok(answer.stands, "every holding the town has on record predates the live pen; a port blind to the frozen era sees none of it");
  assert.equal(answer.stands.source, "holder");
  assert.equal(answer.stands.holder, "ethan-thorne");
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · WHAT AN UNREADABLE RECORD ANSWERS — the `dyn == null` parity
// ═════════════════════════════════════════════════════════════════════════════

test("THE REGISTER WAS NOT ASKED: an office with no store answers no block, exactly as an absent `dynamic.db` did", async (t) => {
  if (!MARK) return t.skip(`no canon mark: ${WHY}`);
  const prev = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  delete process.env.WORLD2_PG;
  delete process.env.WORLD2_PG_URL;
  try {
    const { worldInvestigate } = await import("../src/world.mjs");
    const answer = await worldInvestigate({ mark: CANON });
    assert.ok(!answer.error, `the focus bounced: ${answer.defect}`);
    assert.equal(answer.stands, undefined,
      "an unreadable record is an ABSENT block — a present one would be a claim about where a thing stands, made by an office that could not look");
  } finally {
    for (const [k, v] of [["WORLD2_PG", prev.pg], ["WORLD2_PG_URL", prev.url]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test("A RECORD THAT WILL NOT ANSWER: the throw becomes an absent block and never a bounce", async (t) => {
  if (!MARK) return t.skip(`no canon mark: ${WHY}`);
  const guards = await import("../src/world2-guards.mjs");
  const prev = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://stands-store-fixture/unreachable";
  const restore = guards.useGuardReader(() => { throw new Error("the office's record cannot be reached"); });
  try {
    const { worldInvestigate } = await import("../src/world.mjs");
    const answer = await worldInvestigate({ mark: CANON });
    assert.ok(!answer.error,
      "a holder read that could not run must not cost a resident the whole focus — the block is the only thing that goes");
    assert.equal(answer.stands, undefined);
  } finally {
    restore();
    for (const [k, v] of [["WORLD2_PG", prev.pg], ["WORLD2_PG_URL", prev.url]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 4 · THE SQLITE READ IS GONE, not layered under
// ═════════════════════════════════════════════════════════════════════════════

test("THE SOURCE PIN: `thingStandsBlock` opens no dynamic store and imports no sqlite reader", async (t) => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/world.mjs", import.meta.url), "utf8");
  const start = src.indexOf("async function thingStandsBlock(");
  assert.ok(start > 0, "thingStandsBlock has been renamed or removed — this pin no longer names anything");
  // The function body, to the next top-level declaration.
  const rest = src.slice(start);
  const end = rest.search(/\r?\n\}\r?\n/);
  assert.ok(end > 0, "could not bound the function body — the pin would otherwise read the whole file");
  // COMMENTS OUT FIRST, AND THIS PIN CAUGHT ITSELF. Its first cut reddened on
  // the function's own PROSE: the header explains what the sqlite road WAS and
  // names `openDynamicReadOnly` doing it. A pin that forbids a token in a
  // comment forbids ever explaining the change, which is not what this one
  // means — it means no CALL survives.
  const body = rest.slice(0, end)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ");

  // WEAKER THAN A BEHAVIOURAL ASSERTION, AND SAID SO. The cases above prove the
  // store is READ; this one proves the sqlite road is not still there beneath
  // it, which no answer can show — a fallback under a working store is silent by
  // construction until the store is the thing that fails.
  for (const gone of ["openDynamicReadOnly", "readAttachments", "readJournal", "dynamic-store.mjs", "dyn?.close()"]) {
    assert.ok(!body.includes(gone),
      `\`${gone}\` survives inside thingStandsBlock — replace the reader, never layer one under it`);
  }
  assert.ok(body.includes("standsRowsFromStore"), "and the store road is the one that is there");
  // CAN-FAIL CONTROL: the pin must be reading a real body, not an empty string.
  assert.ok(body.length > 400, `the bounded body is ${body.length} characters — this pin is asserting about nothing`);
  assert.ok(body.includes("whereThingStands"),
    "and it is the RIGHT body: the derivation the block calls survives the strip, so comments went and code did not");
});
