// quests.test.mjs — the quest card's data path through the office.
//
// The rule itself lives in the town (tools/quest-progress.mjs, tested there);
// what the office owns is the round trip: hydrate writes today's progress into
// the index, questBoardFor reads it back and joins it against the registry with
// the town's OWN boardForHandle. These tests pin the part that can silently rot
// — the columns. A dropped field here shows up as a card that says 3/5 and
// names nobody, which is exactly the failure the field was added to fix.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { questBoardFor } from "../src/queries.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";

const TOWN = townClone(); // a real checkout — the office imports the town's tool live
const SKIP = !TOWN && NO_TOWN;
const REGISTRY = JSON.stringify({
  version: 1,
  quests: [
    { id: "correspond-send", title: "Reach out", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" },
    { id: "correspond-receive", title: "Be reached", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" },
  ],
});

function dbWith(row, day) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  if (row) {
    db.prepare(`INSERT INTO quest_progress
      (handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.handle, row.send, row.receive, row.house_size, row.house_send, row.house_receive, row.sent_to, row.heard_from);
  }
  return db;
}
const meta = (day) => ({ quest_registry: REGISTRY, quest_day: day });
const q = (board, id) => board.quests.find((x) => x.id === id);

// the office zeroes a stale snapshot across midnight, so tests must use the
// town's own notion of today or they'd read a clean zero and prove nothing.
async function today() {
  const { townDay } = await import(townModuleUrl("tools", "quest-progress.mjs"));
  return townDay();
}

test("counted survives the round trip through the index", { skip: SKIP }, async () => {
  const day = await today();
  const db = dbWith({
    handle: "alice", send: 2, receive: 1, house_size: 1, house_send: 2, house_receive: 1,
    sent_to: JSON.stringify(["bob", "carol"]), heard_from: JSON.stringify(["dave"]),
  }, day);
  const board = await questBoardFor(db, meta(day), "alice", TOWN);
  assert.deepEqual(q(board, "correspond-send").counted, ["bob", "carol"]);
  assert.deepEqual(q(board, "correspond-receive").counted, ["dave"]);
});

test("counted.length always equals progress — the card can't contradict its bar", { skip: SKIP }, async () => {
  const day = await today();
  const db = dbWith({
    handle: "alice", send: 3, receive: 0, house_size: 1, house_send: 3, house_receive: 0,
    sent_to: JSON.stringify(["bob", "carol", "dave"]), heard_from: JSON.stringify([]),
  }, day);
  const board = await questBoardFor(db, meta(day), "alice", TOWN);
  for (const quest of board.quests) {
    assert.equal(quest.counted.length, quest.progress, `${quest.id}: ${quest.counted.length} names for ${quest.progress}/${quest.target}`);
  }
});

test("a pre-field row degrades to [] rather than 500ing", { skip: SKIP }, async () => {
  const day = await today();
  // NULL columns — what a snapshot written before sent_to/heard_from existed looks like
  const db = dbWith({
    handle: "alice", send: 2, receive: 0, house_size: 1, house_send: 2, house_receive: 0,
    sent_to: null, heard_from: null,
  }, day);
  const board = await questBoardFor(db, meta(day), "alice", TOWN);
  assert.equal(q(board, "correspond-send").progress, 2, "the bar still reads");
  assert.deepEqual(q(board, "correspond-send").counted, []);
});

test("malformed JSON in a column degrades to [] rather than 500ing", { skip: SKIP }, async () => {
  const day = await today();
  const db = dbWith({
    handle: "alice", send: 1, receive: 0, house_size: 1, house_send: 1, house_receive: 0,
    sent_to: "{not json", heard_from: '"a string, not an array"',
  }, day);
  const board = await questBoardFor(db, meta(day), "alice", TOWN);
  assert.deepEqual(q(board, "correspond-send").counted, []);
  assert.deepEqual(q(board, "correspond-receive").counted, []);
});

test("a resident absent from the index reads a clean zero with empty lists", { skip: SKIP }, async () => {
  const day = await today();
  const board = await questBoardFor(dbWith(null, day), meta(day), "nobody", TOWN);
  for (const quest of board.quests) {
    assert.equal(quest.progress, 0);
    assert.deepEqual(quest.counted, []);
  }
});

// ── `measured` — the door's own answer to "can this row be counted?" ─────────
//
// BOARD_LAW puts two kinds of row on one board and tells them apart by a TYPE,
// not a field: a countable row's `progress` is a number, an uncounted row's is
// null. So every consumer wrote `typeof q.progress === "number"` for itself, and
// the site's own note says why it had to key on the field rather than an id list
// ("the allow-list again wearing a different name"). A predicate two doors each
// re-derive is a predicate two doors can come to disagree about. The door states
// it now, and these pin what it states.
//
// The registry here carries a THIRD row NO FOLD ON THIS BOARD CAN COUNT, which
// is the whole point: `COUNTABLE_FIELD` names `send` and `receive` and nothing
// else, and `walk-the-world` is settled from the world rather than from either
// fold on this board — so with the world unreadable (see BLIND_WORLD below) it
// attaches a note naming the surface that can answer, and nothing else. That is
// the town's own mechanism, not a shape invented for the test.
//
// ⚑ THAT SENTENCE USED TO READ "the standing join has no fact for it", and it
// stopped being true on 2026-09-14 (#2773): the join settles this row from the
// home's world block now, because a page that filed "not looked" under "still
// to do" was telling placed residents to go and get placed. What makes the row
// an exemplar here is the UNREADABLE world the fixture hands it, not an absence
// in the office — and the fixture says so rather than relying on the box.
//
// ⚑ WHY NOT `first-idea`, which stood here until the w37 continuation ship
// (2026-09-08). Since the standing join, that row is settled from the WORLD
// record whenever `world.db` sits beside the office (`DEFAULT_DB`): with the
// store answering it reads `progress: 0`, measured — so a test that used it as
// the uncounted exemplar went green in a bare worktree and red in the primary
// clone, by nothing but whether a stray `world.db` lay at the repo root. A test
// whose oracle is a file lying about is not a test of the door. The row the
// board genuinely cannot count is the exemplar; `first-idea`'s own measure under
// a real store is pinned in quest-standing.test.mjs, where the store is a
// fixture, not an accident of the checkout.
const MIXED_REGISTRY = JSON.stringify({
  version: 1,
  quests: [
    { id: "correspond-send", title: "Reach out", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" },
    { id: "correspond-receive", title: "Be reached", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" },
    { id: "walk-the-world", title: "Walk the world", cadence: "once", validation: "manual", target: 1, reward: "1 stamp" },
  ],
});
const mixedMeta = (day) => ({ quest_registry: MIXED_REGISTRY, quest_day: day });

// ── THE FIXTURE OWNS ITS WORLD (#2773) ──────────────────────────────────────
//
// `walk-the-world` is this file's exemplar of an UNCOUNTED row, and it earned
// that role because no fold on the board could settle it. One now can: the
// board reads the home's world block and answers `complete` from `sited`. So
// the row is uncounted only where the world cannot be read — and whether the
// world can be read is a fact about the BOX this suite runs on, not about the
// office. Left alone these legs would pass on a machine with no world clone and
// red on one that has it, for a reason that has nothing to do with `measured`.
//
// So the fixture hands the board a world it cannot see, and the exemplar is an
// exemplar again on every box. What these legs are about is unchanged: a row no
// fold can count must SAY so.
//
// ⚑ AND WHAT THE TOWN'S TABLE IS AN ORACLE FOR, now that there are two folds.
// `COUNTABLE_FIELD` is the DAILY fold's table; `measured` is the union of that
// fold and the standing join. The two agree here because this fixture's third
// row is unreadable, and that is a precondition rather than a coincidence — a
// board whose world answered would carry a measured row the town's table does
// not name, correctly.
const BLIND_WORLD = { worldBlock: async () => ({ mark_id: null, x: null, y: null, sited: false, unreadable: true, unreadable_reason: "this fixture has no world" }) };

test("every quest row says whether it is measured — a number is measured, a null is not", { skip: SKIP }, async () => {
  const day = await today();
  const db = dbWith({
    handle: "alice", send: 2, receive: 1, house_size: 1, house_send: 2, house_receive: 1,
    sent_to: JSON.stringify(["bob", "carol"]), heard_from: JSON.stringify(["dave"]),
  }, day);
  const board = await questBoardFor(db, mixedMeta(day), "alice", TOWN, BLIND_WORLD);

  assert.equal(board.quests.length, 3, "the board is every registry row (BOARD_LAW), or this proves nothing");
  assert.equal(q(board, "correspond-send").measured, true);
  assert.equal(q(board, "correspond-receive").measured, true);
  assert.equal(q(board, "walk-the-world").measured, false,
    "the daily fold names no field for this row and the world it is settled from is unreadable here, so no fold on this board can count it and the door must say so");

  // TWO ORACLES, and the second is the one that will still be doing work in six
  // months. Stated plainly because the obvious flip does NOT catch it: replacing
  // the derivation with the id list `["correspond-send", "correspond-receive"]`
  // leaves every assertion in this file green, and it is entitled to — that list
  // IS `COUNTABLE_FIELD`'s key set today, so the two agree by arithmetic and no
  // fixture can pull them apart while the table holds two rows. Claiming
  // otherwise would be a falsifier taking credit for a red it cannot produce.
  //
  // What can be bound is the AGREEMENT ITSELF, against the town's own table
  // rather than a copy of it. `COUNTABLE_FIELD` is exported, so it is imported
  // here and asked directly. The day the town names a third countable row, an
  // office deriving `measured` from a hardcoded pair reds on this line — which
  // is the divergence worth catching, and the only one that exists.
  const { COUNTABLE_FIELD } = await import(townModuleUrl("tools", "quest-progress.mjs"));
  assert.ok(Object.keys(COUNTABLE_FIELD).length, "the town's countable table is empty — this oracle has stopped saying anything");
  for (const quest of board.quests) {
    assert.equal(quest.measured, typeof quest.progress === "number",
      `${quest.id}: the door's answer and the row's own shape disagree`);
    assert.equal(quest.measured, Object.prototype.hasOwnProperty.call(COUNTABLE_FIELD, quest.id),
      `${quest.id}: the door's answer and the TOWN's own COUNTABLE_FIELD disagree`);
  }
});

test("`measured` is ADDITIVE — progress survives, null and all, for the readers that already use it", { skip: SKIP }, async () => {
  // The site's guard reads `q.progress`, the doorstep's next-steps lane rides
  // these rows, and household-stamps maps `q.progress ?? null`. None of them
  // asked for the key to go, and a key removed is a shape change every reader
  // has to survive.
  const day = await today();
  const board = await questBoardFor(dbWith(null, day), mixedMeta(day), "nobody", TOWN, BLIND_WORLD);

  const uncounted = q(board, "walk-the-world");
  assert.ok("progress" in uncounted, "the `progress` key is still on the row");
  assert.equal(uncounted.progress, null, "and it is still null — the shape the site's guard reads");
  assert.equal(uncounted.household.total, null, "the daily cap is a daily fact; inventing 0 is the lie the null exists to avoid");
  assert.deepEqual(uncounted.counted, [], "`counted` still holds correspondents, which is why the field is `measured` and not `counted`");

  const counted = q(board, "correspond-send");
  assert.equal(counted.progress, 0, "a countable row with no entry is a CLEAN ZERO, first-class");
  assert.equal(counted.measured, true, "so zero is measured — `measured` is not `progress > 0`");
});

test("a stale snapshot does not make a countable row unmeasured — the two are different facts", { skip: SKIP }, async () => {
  // The distinction the field is for. A stale index means the office served
  // yesterday's numbers as zero; it does not mean the row cannot be counted.
  // If `measured` ever went false here it would be saying "this kind of quest is
  // unmeasurable" about a row the fold measures perfectly well.
  const day = await today();
  const db = dbWith({
    handle: "alice", send: 4, receive: 0, house_size: 1, house_send: 4, house_receive: 0,
    sent_to: JSON.stringify(["bob", "carol", "dave", "erin"]), heard_from: JSON.stringify([]),
  }, day);
  const board = await questBoardFor(db, mixedMeta("2000-01-01"), "alice", TOWN, BLIND_WORLD);
  assert.equal(q(board, "correspond-send").progress, 0, "the stale snapshot is zeroed");
  assert.equal(q(board, "correspond-send").measured, true, "and it is still a row the fold can count");
  assert.equal(q(board, "walk-the-world").measured, false, "while the uncounted row is unchanged by the staleness");
});

test("a stale snapshot across midnight zeroes the names too, not just the bars", { skip: SKIP }, async () => {
  const day = await today();
  const db = dbWith({
    handle: "alice", send: 4, receive: 0, house_size: 1, house_send: 4, house_receive: 0,
    sent_to: JSON.stringify(["bob", "carol", "dave", "erin"]), heard_from: JSON.stringify([]),
  }, day);
  // meta says the snapshot is from a PREVIOUS town day → the office must not
  // serve yesterday's correspondents as though they counted today
  const board = await questBoardFor(db, meta("2000-01-01"), "alice", TOWN);
  assert.equal(q(board, "correspond-send").progress, 0);
  assert.deepEqual(q(board, "correspond-send").counted, []);
});
