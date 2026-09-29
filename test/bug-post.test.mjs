// bug-post.test.mjs — the bug class on the post machine (Posts phase 2, first slice).
//
//   node --test test/bug-post.test.mjs
//
// The gate, in its order (the brief, 2026-09-29):
//
//   1. a resident posts a bug as themselves; a non-hand's advance is refused by
//      name and writes nothing; a hand's advance to confirmed records the stage
//      with the reporter credited;
//   2. a stake on a bug is refused by name — at post, and at the stake door;
//   3. the town's hands post on a resident's behalf (`for`): the reporter is
//      credited and the act names the hand; nobody else may;
//   4. the reporter amends until confirmed, the hands after; only what changed
//      is recorded;
//   5. the advance's law: forward only, a skip pays nothing, credit from
//      reproduced on, a size at fixed, a grade at briefed, a duplicate names a
//      standing bug, side exits only early, a finished bug moves no further,
//      and a bug is never closed;
//   6. the posts read answers class "bug" with its finished states, and the
//      rebuild folds the bug acts back into exactly the rows the pen wrote;
//   7. (Wright's review of #257) `for` and `credit` must name a resident in
//      the office's residents index, refused by name and writing nothing; an
//      office that cannot read its index refuses rather than guessing;
//   8. (POS-298, the critter) an advance to fixed carries the critter its fixer
//      named, refused by name without it and on any other stage; the post
//      keeps it with named_by = the fix's credit, as plain text, and the
//      rebuild folds it.
//
// ⚑ THE STORE IS A JS STUB (`acts-pen-stub.mjs`), as in quest-posts.test.mjs:
// this proves which acts and rows the pen writes and what the reads make of
// them, nothing about Postgres.
//
// THE FLIPS (NOTES.md in the lane folder holds the red lines): make
// judgeBugHand accept any handle and 1 goes red; drop the residents-index
// check from judgeHandleField and 7 goes red; the critter's four flips are in
// the bug-critter lane's NOTES.md.

import test from "node:test";
import assert from "node:assert/strict";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";

Object.assign(process.env, RECORD_ON);
const { postAtTown, amendAtTown, advanceAtTown, closeAtTown } = await import("../src/events-store.mjs");
const { postsAtOffice } = await import("../src/town-posts.mjs");
const { townPostEvent } = await import("../src/town-post.mjs");
const { townStake } = await import("../src/town-stake.mjs");
const { compareRebuild, dryRun } = await import("../world2/tools/events-rebuild.mjs");
const { BUG_FINISHED } = await import("../src/bugs.mjs");
const { foldPostActs } = await import("../src/events.mjs");

// The real clock: the pen refuses a row stamped for a window older than the open one.
const NOW = Date.now();

const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const ERRANT = { household: "errant", handles: new Set(["errant"]) };
const FINN = { household: "finn", handles: new Set(["finn"]) };

const HOUSES = [{ slug: "the-harbor", ord: 1, residents: ["errant", "ada"] }];
// The office's residents index (the door reads it from office.db; see mcp.mjs § rollOf).
const ROLL = new Set(["wright", "keemin", "errant", "ada", "finn"]);

// ── the posts table, in memory, answering exactly the queries asked ─────────
function bugTables() {
  const posts = new Map();
  const PC = ["id", "class", "title", "body", "author", "household", "place_mark", "place_x", "place_y",
    "starts", "ends", "state", "fields", "revised", "posted_act", "last_act"];
  const asJson = (v) => (typeof v === "string" ? JSON.parse(v) : v);
  const copy = (r) => ({ ...r, fields: { ...r.fields } });
  const byClass = (cls) => [...posts.values()].filter((r) => r.class === cls).sort((a, b) => a.id.localeCompare(b.id)).map(copy);
  const also = [
    [/^INSERT INTO posts/i, (q, p) => {
      if (posts.has(p[0])) throw new Error(`duplicate key value violates unique constraint "posts_pkey"`);
      const r = Object.fromEntries(PC.map((k, i) => [k, p[i]]));
      r.fields = asJson(r.fields);
      posts.set(p[0], r);
      return { rows: [], rowCount: 1 };
    }],
    [/^UPDATE posts SET/i, (q, p) => {
      const r = posts.get(p[0]);
      Object.assign(r, { title: p[1], body: p[2], place_mark: p[3], place_x: p[4], place_y: p[5],
        starts: p[6], ends: p[7], state: p[8], fields: asJson(p[9]), revised: p[10], last_act: p[11] });
      return { rows: [], rowCount: 1 };
    }],
    [/FROM posts WHERE id = \$1 AND class = \$2$/i, (q, p) => {
      const r = posts.get(p[0]);
      const hit = r && r.class === p[1];
      return { rows: hit ? [copy(r)] : [], rowCount: hit ? 1 : 0 };
    }],
    [/^SELECT id, state, ends FROM posts WHERE id LIKE \$1$/i, (q, p) => {
      const pre = p[0].replace(/%$/, "");
      const rows = [...posts.values()].filter((r) => r.id.startsWith(pre)).map((r) => ({ id: r.id, state: r.state, ends: r.ends }));
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT id, class, title, author, household, starts, ends, fields, state, last_act FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => {
      const rows = byClass(p[0]);
      return { rows, rowCount: rows.length };
    }],
    [/^SELECT post, handle, state FROM responses WHERE post = ANY\(\$1\) ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
    [/^SELECT \* FROM posts WHERE class = \$1 ORDER BY id$/i, (q, p) => { const rows = byClass(p[0]); return { rows, rowCount: rows.length }; }],
    [/^SELECT \* FROM responses WHERE kind = \$1 ORDER BY post, handle$/i, () => ({ rows: [], rowCount: 0 })],
  ];
  return { posts, also };
}

function setup() {
  const t = bugTables();
  const pen = installActsPen({ households: HOUSES, also: t.also });
  return { ...t, pen };
}
test.afterEach(() => uninstallActsPen());

async function refusedWith(p, code, re) {
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code} ${e.defect}`); if (re) assert.match(`${e.defect} ${e.hint}`, re); return true; });
}

const BUG = { class: "bug", title: "The door sticks", body: "The front door of the post office does not open on the second try." };
const ID = "errant/the-door-sticks";

// ── 1 ───────────────────────────────────────────────────────────────────────

test("1 · a resident posts a bug as themselves; a non-hand's advance is refused by name and writes nothing; a hand's advance to confirmed credits the reporter", async () => {
  const { pen, posts } = setup();
  const r = await postAtTown({ ...BUG, steps: "Open it, close it, open it again.", record: "act 4171" }, ERRANT, { now: NOW, roll: ROLL });
  assert.equal(r.post.id, ID);
  assert.deepEqual([r.post.class, r.post.author, r.post.household, r.post.state], ["bug", "errant", "hh:the-harbor", "reported"]);
  assert.deepEqual(r.post.fields, { steps: "Open it, close it, open it again.", record: "act 4171" });
  assert.match(r.receipt, /posted: errant\/the-door-sticks \(a bug\), reported by errant\./);
  assert.match(r.receipt, /A bug takes no stake/);
  const [posted] = pen.rows();
  assert.deepEqual([posted.class, posted.action, posted.actor, posted.object], ["bug", "post", "errant", ID]);

  const before = pen.rows().length;
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed" }, FINN, { now: NOW, roll: ROLL }), 403, /only the town's hands advance a bug/);
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed" }, ERRANT, { now: NOW, roll: ROLL }), 403, /only the town's hands advance a bug/);
  assert.equal(pen.rows().length, before, "a refused advance wrote an act");
  assert.equal(posts.get(ID).state, "reported");

  const a = await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.deepEqual([a.stage, a.credit, a.hand, a.stamps], ["confirmed", "errant", "wright", 2]);
  assert.match(a.receipt, /advanced: errant\/the-door-sticks reported → confirmed by wright's hand; the ladder owes errant 2 stamps for confirmed, paid by the reviewed stage pass \(not by this act\)/);
  const adv = pen.rows().at(-1);
  assert.deepEqual([adv.class, adv.action, adv.actor, adv.object], ["bug", "advance", "wright", ID]);
  assert.deepEqual(JSON.parse(adv.payload), { post: ID, from: "reported", to: "confirmed", credit: "errant", hand: "wright" });
  assert.equal(posts.get(ID).state, "confirmed");
  assert.equal(posts.get(ID).author, "errant", "the advance moved the stage, not the authorship");
});

// ── 2 ───────────────────────────────────────────────────────────────────────

test("2 · a stake on a bug is refused by name — at post, at the stake door, and on the other acts", async () => {
  const { pen } = setup();
  const atPost = await townPostEvent({ ...BUG, stamps: 3 }, ERRANT);
  assert.equal(atPost.error, "bounce");
  assert.equal(atPost.code, 422);
  assert.match(atPost.defect, /a bug takes no stake/);
  assert.match(atPost.hint, /it feels odd to wait for stakers for a clearly broken thing/);
  assert.equal(pen.rows().length, 0, "a refused post wrote an act");

  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  // The stake door: a bug is not a mark, and the refusal says it is a bug, by name.
  const staked = await townStake({ mark: ID, stamps: 2 }, FINN);
  assert.equal(staked.error, "bounce");
  assert.equal(staked.code, 422);
  assert.match(staked.defect, /"errant\/the-door-sticks" is a bug, and a bug takes no stake/);
  assert.equal(staked.class, "bug");
  // …and a mark the town does not hold that is NOT a bug still gets the lane guard's own answer
  const stray = await townStake({ mark: "errant/no-such-thing", stamps: 2 }, FINN);
  assert.notEqual(stray.class, "bug");
  await refusedWith(amendAtTown({ post: ID, stamps: 1 }, ERRANT, { now: NOW, roll: ROLL }), 422, /takes no stake/);
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed", stamps: 1 }, WRIGHT, { now: NOW, roll: ROLL }), 422, /takes no stake/);
  assert.equal(pen.rows().length, 1);
});

// ── 3 ───────────────────────────────────────────────────────────────────────

test("3 · a hand posts on a resident's behalf: the reporter is the author and is credited, the act names the hand; a non-hand's `for` is refused", async () => {
  const { pen } = setup();
  const r = await postAtTown({ ...BUG, for: "ada" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(r.post.id, "ada/the-door-sticks");
  assert.deepEqual([r.post.author, r.post.household, r.hand], ["ada", "hh:the-harbor", "wright"]);
  assert.match(r.receipt, /reported by ada, put up by wright's hand/);
  const act = pen.rows().at(-1);
  assert.equal(act.actor, "ada");
  assert.equal(JSON.parse(act.payload).hand, "wright");
  const a = await advanceAtTown({ post: "ada/the-door-sticks", to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(a.credit, "ada", "confirmed credits the reporter, not the hand that put it up");

  await refusedWith(postAtTown({ ...BUG, for: "ada" }, ERRANT, { now: NOW, roll: ROLL }), 403, /only the town's hands post a bug on a resident's behalf/);
  await refusedWith(postAtTown({ ...BUG, for: "Not A Handle" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /for names a resident by handle/);
  // a second bug with the same title takes the next id; ids are never reused
  const again = await postAtTown({ ...BUG, for: "ada" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(again.post.id, "ada/the-door-sticks-2");
});

// ── 4 ───────────────────────────────────────────────────────────────────────

test("4 · the reporter amends until confirmed and the hands after; only the changed fields are recorded", async () => {
  const { pen, posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  const am = await amendAtTown({ post: ID, steps: "Open, close, open.", title: BUG.title }, ERRANT, { now: NOW, roll: ROLL });
  assert.deepEqual(am.amended, ["steps"], "the unchanged title is not recorded");
  assert.deepEqual(JSON.parse(pen.rows().at(-1).payload), { post: ID, changed: ["steps"], fields: { steps: "Open, close, open." } });
  await refusedWith(amendAtTown({ post: ID, title: "mine now" }, FINN, { now: NOW, roll: ROLL }), 403, /not yours to amend/);
  // issue is amendable (Wright's ruling on #257): the reporter links a discussion opened after the post
  const linked = await amendAtTown({ post: ID, issue: "https://github.com/postmark-town/postmark/issues/1" }, ERRANT, { now: NOW, roll: ROLL });
  assert.deepEqual(linked.amended, ["issue"]);
  assert.deepEqual(JSON.parse(pen.rows().at(-1).payload).fields, { issue: "https://github.com/postmark-town/postmark/issues/1" });
  await refusedWith(amendAtTown({ post: ID, issue: "https://example.com/x" }, ERRANT, { now: NOW, roll: ROLL }), 422, /GitHub issue on the town's own repos/);
  await refusedWith(amendAtTown({ post: ID, body: "x".repeat(601) }, ERRANT, { now: NOW, roll: ROLL }), 422, /at most 600 characters/);
  await refusedWith(amendAtTown({ post: ID, steps: "Open, close, open." }, ERRANT, { now: NOW, roll: ROLL }), 422, /nothing to amend/);

  await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  await refusedWith(amendAtTown({ post: ID, title: "The door sticks, twice" }, ERRANT, { now: NOW, roll: ROLL }), 409, /only the town's hands amend it now/);
  const byHand = await amendAtTown({ post: ID, record: "https://postmark.town/api/release" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.deepEqual(byHand.amended, ["record"]);
  assert.equal(JSON.parse(pen.rows().at(-1).payload).hand, "wright");
  assert.equal(posts.get(ID).fields.record, "https://postmark.town/api/release");
  assert.equal(posts.get(ID).fields.steps, "Open, close, open.", "an amend of one field left the other standing");
});

// ── 5 ───────────────────────────────────────────────────────────────────────

test("5 · the advance's law: forward only, a skip pays nothing, credit from reproduced on, size at fixed, grade at briefed", async () => {
  const { pen, posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  await refusedWith(advanceAtTown({ post: ID, to: "reproduced" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /reproduced names whom it credits/);
  await refusedWith(advanceAtTown({ post: ID, to: "fixed", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /fixed needs a size/);
  await refusedWith(advanceAtTown({ post: ID, to: "briefed", credit: "finn", size: "M" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /size is fixed's/);
  await refusedWith(advanceAtTown({ post: ID, to: "briefed", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /briefed needs a grade/);
  await refusedWith(advanceAtTown({ post: ID, to: "shipped", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /shipped pays nothing and credits no one/);
  await refusedWith(advanceAtTown({ post: ID, to: "reported" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /not a stage a bug advances to/);
  await refusedWith(advanceAtTown({ post: ID, to: "wontfix" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /not a stage a bug advances to/);

  // a jump: reported → diagnosed pays diagnosed only, and says what it skipped
  const jump = await advanceAtTown({ post: ID, to: "diagnosed", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(jump.stamps, 5);
  assert.match(jump.receipt, /skipped confirmed, reproduced, and a skipped stage pays nothing/);
  await refusedWith(advanceAtTown({ post: ID, to: "reproduced", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL }), 409, /already stands diagnosed/);
  await refusedWith(advanceAtTown({ post: ID, to: "not-a-bug" }, WRIGHT, { now: NOW, roll: ROLL }), 409, /leaves as not-a-bug only from reported or confirmed/);

  const brief = await advanceAtTown({ post: ID, to: "briefed", credit: "finn", grade: "heavy" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(brief.stamps, 5, "a heavy revision pays 5");
  const fix = await advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "M", critter: "Hinge Nibbler" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(fix.stamps, 25);
  assert.deepEqual(posts.get(ID).fields, { grade: "heavy", size: "M", critter: "Hinge Nibbler", named_by: "finn" });
  const ship = await advanceAtTown({ post: ID, to: "shipped" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(ship.stamps, 0);
  assert.match(ship.receipt, /shipped pays nothing/);
  await refusedWith(advanceAtTown({ post: ID, to: "shipped" }, WRIGHT, { now: NOW, roll: ROLL }), 409, /is finished \(shipped\)/);
  await refusedWith(amendAtTown({ post: ID, title: "x" }, WRIGHT, { now: NOW, roll: ROLL }), 409, /is finished/);
  // …but a hand may still link its issue, at any stage
  const late = await amendAtTown({ post: ID, issue: "https://github.com/postmark-town/postmark-office/issues/256" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.deepEqual(late.amended, ["issue"]);
  assert.equal(posts.get(ID).fields.issue, "https://github.com/postmark-town/postmark-office/issues/256");
  await refusedWith(closeAtTown({ post: ID }, WRIGHT, { now: NOW, roll: ROLL }), 422, /a bug is not closed/);
  assert.equal(pen.rows().filter((r) => r.action === "advance").length, 4);
  // the reporter may not link it after confirmed
  await refusedWith(amendAtTown({ post: ID, issue: "https://github.com/postmark-town/postmark/issues/2" }, ERRANT, { now: NOW, roll: ROLL }), 409, /is finished/);
});

test("5 · a duplicate names a standing bug that is not itself; not-a-bug leaves from confirmed", async () => {
  const { posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  await postAtTown({ ...BUG, title: "The door sticks again" }, FINN, { now: NOW, roll: ROLL });
  const dup = "finn/the-door-sticks-again";
  await refusedWith(advanceAtTown({ post: dup, to: "duplicate" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /names the bug it duplicates/);
  await refusedWith(advanceAtTown({ post: dup, to: "duplicate", of: dup }, WRIGHT, { now: NOW, roll: ROLL }), 422, /not a duplicate of itself/);
  await refusedWith(advanceAtTown({ post: dup, to: "duplicate", of: "finn/nothing" }, WRIGHT, { now: NOW, roll: ROLL }), 404, /no bug "finn\/nothing"/);
  await refusedWith(advanceAtTown({ post: dup, to: "confirmed", of: ID }, WRIGHT, { now: NOW, roll: ROLL }), 422, /of is duplicate's/);
  const d = await advanceAtTown({ post: dup, to: "duplicate", of: ID }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(d.stamps, 0);
  assert.deepEqual([posts.get(dup).state, posts.get(dup).fields.of], ["duplicate", ID]);
  await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "not-a-bug" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(posts.get(ID).state, "not-a-bug");
});

test("5 · a bug's text is judged: title and body required, body ≤ 600, issue on the town's own repos", async () => {
  setup();
  await refusedWith(postAtTown({ class: "bug", body: "x" }, ERRANT, { now: NOW, roll: ROLL }), 422, /a bug needs a title/);
  await refusedWith(postAtTown({ class: "bug", title: "x" }, ERRANT, { now: NOW, roll: ROLL }), 422, /a bug needs a body/);
  await refusedWith(postAtTown({ ...BUG, body: "y".repeat(601) }, ERRANT, { now: NOW, roll: ROLL }), 422, /a bug's body is at most 600 characters/);
  await refusedWith(postAtTown({ ...BUG, issue: "https://github.com/someone-else/postmark/issues/1" }, ERRANT, { now: NOW, roll: ROLL }), 422, /GitHub issue on the town's own repos/);
  const ok = await postAtTown({ ...BUG, issue: "https://github.com/postmark-town/postmark-office/issues/256" }, ERRANT, { now: NOW, roll: ROLL });
  assert.equal(ok.post.fields.issue, "https://github.com/postmark-town/postmark-office/issues/256");
  // a stray field of another lane is refused by name at the door
  const stray = await townPostEvent({ ...BUG, starts: "2026-10-01T00:00:00Z" }, ERRANT);
  assert.match(stray.defect, /a bug does not take: starts/);
});

// ── 6 ───────────────────────────────────────────────────────────────────────

test("6 · the posts read answers class bug with its finished states; the rebuild folds the bug acts into exactly the rows the pen wrote", async () => {
  const { pen } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  await postAtTown({ ...BUG, for: "ada" }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  await amendAtTown({ post: ID, steps: "Twice." }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "S", critter: "Stickle" }, WRIGHT, { now: NOW, roll: ROLL });

  const r = await postsAtOffice({ class: "bug" }, { now: NOW, roll: ROLL });
  assert.deepEqual(r.finished, [...BUG_FINISHED]);
  assert.deepEqual(r.finished, ["shipped", "duplicate", "not-a-bug"]);
  assert.equal(r.total, 2);
  const one = r.posts.find((p) => p.id === ID);
  assert.deepEqual([one.class, one.state, one.author, one.latest.act], ["bug", "fixed", "errant", "advance"]);
  assert.deepEqual(one.fields, { steps: "Twice.", size: "S", critter: "Stickle", named_by: "finn" });
  const single = await postsAtOffice({ class: "bug", post: "ada/the-door-sticks" }, { now: NOW, roll: ROLL });
  assert.equal(single.post.state, "reported");

  const out = await dryRun(pen);
  assert.equal(out.equal, true, out.drift.join("\n"));
  assert.deepEqual([out.counts.bug_acts, out.counts.bugs], [5, 2]);
  // and the equality can fail: a row the acts do not derive is drift
  const acts = pen.rows().filter((a) => a.class === "bug").map((a) => ({ ...a, payload: JSON.parse(a.payload) }));
  const drifted = compareRebuild({ posts: [{ id: "errant/ghost", class: "bug", title: "", body: "", author: "errant", state: "reported", fields: {}, revised: 0, posted_act: 1, last_act: 1 }], responses: [] }, acts);
  assert.equal(drifted.equal, false);
});

// ── 7 ───────────────────────────────────────────────────────────────────────

test("7 · for and credit name a resident in the office's residents index, or are refused by name and write nothing; no index, no guess", async () => {
  const { pen, posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  const before = pen.rows().length;
  await refusedWith(postAtTown({ ...BUG, for: "tpyo" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /"tpyo" is not a resident here/);
  await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW, roll: ROLL });
  await refusedWith(advanceAtTown({ post: ID, to: "reproduced", credit: "tpyo" }, WRIGHT, { now: NOW, roll: ROLL }), 422, /"tpyo" is not a resident here/);
  assert.equal(pen.rows().length, before + 1, "a refused for or credit wrote an act");
  assert.equal(posts.get(ID).state, "confirmed");
  // an office that cannot read its residents index refuses; it never records an unchecked handle
  await refusedWith(advanceAtTown({ post: ID, to: "reproduced", credit: "finn" }, WRIGHT, { now: NOW, roll: null }), 503, /cannot read its residents index/);
  await refusedWith(postAtTown({ ...BUG, for: "ada" }, WRIGHT, { now: NOW }), 503, /cannot read its residents index/);
  // confirmed's default credit is the reporter, who posted it, so it needs no index
  const ok = await advanceAtTown({ post: ID, to: "reproduced", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(ok.credit, "finn");
});

// ── 8 ───────────────────────────────────────────────────────────────────────

/** Walk the door-sticks bug up to briefed, crediting finn; returns nothing. */
async function toBriefed() {
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "diagnosed", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "briefed", credit: "finn", grade: "light" }, WRIGHT, { now: NOW, roll: ROLL });
}

test("8 · an advance to fixed without a critter is refused by name, says who names it and how, and writes nothing", async () => {
  const { pen, posts } = setup();
  await toBriefed();
  const before = pen.rows().length;
  await refusedWith(advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "M" }, WRIGHT, { now: NOW, roll: ROLL }), 422,
    /fixed needs a critter: the resident who fixes a bug names it .*critter: "<name>", 1–40 characters on one line — the fixer chooses it and tells the town's hands \(wright, keemin, bugcatcher\) in the PR or the issue/);
  for (const bad of ["", "   ", 7, "Hinge\nNibbler", "x".repeat(41)])
    await refusedWith(advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "M", critter: bad }, WRIGHT, { now: NOW, roll: ROLL }), 422, /critter is/);
  assert.equal(pen.rows().length, before, "a refused fixed wrote an act");
  assert.equal(posts.get(ID).state, "briefed");
  // 40 characters is a name; the count is characters, not UTF-16 units
  const ok = await advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "M", critter: "🐛".repeat(40) }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(ok.critter, "🐛".repeat(40));
});

test("8 · critter on any stage but fixed is refused by name", async () => {
  const { pen, posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW, roll: ROLL });
  await postAtTown({ ...BUG, title: "The door sticks again" }, FINN, { now: NOW, roll: ROLL });
  const before = pen.rows().length;
  const WHY = /critter is fixed's: the resident who fixes a bug names it .*only an advance to fixed takes critter/;
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed", critter: "Nib" }, WRIGHT, { now: NOW, roll: ROLL }), 422, WHY);
  for (const [to, more] of [["reproduced", {}], ["diagnosed", {}], ["briefed", { grade: "light" }]])
    await refusedWith(advanceAtTown({ post: ID, to, credit: "finn", critter: "Nib", ...more }, WRIGHT, { now: NOW, roll: ROLL }), 422, WHY);
  await refusedWith(advanceAtTown({ post: ID, to: "not-a-bug", critter: "Nib" }, WRIGHT, { now: NOW, roll: ROLL }), 422, WHY);
  await refusedWith(advanceAtTown({ post: "finn/the-door-sticks-again", to: "duplicate", of: ID, critter: "Nib" }, WRIGHT, { now: NOW, roll: ROLL }), 422, WHY);
  assert.equal(pen.rows().length, before);
  await advanceAtTown({ post: ID, to: "diagnosed", credit: "finn" }, WRIGHT, { now: NOW, roll: ROLL });
  await advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "S", critter: "Nib" }, WRIGHT, { now: NOW, roll: ROLL });
  await refusedWith(advanceAtTown({ post: ID, to: "shipped", critter: "Nib" }, WRIGHT, { now: NOW, roll: ROLL }), 422, WHY);
  assert.equal(posts.get(ID).state, "fixed");
});

test("8 · a fixed bug's posts read carries critter and named_by (the fixer's credit), and the rebuild folds them", async () => {
  const { pen, posts } = setup();
  await toBriefed();
  const fix = await advanceAtTown({ post: ID, to: "fixed", credit: "ada", size: "L", critter: "  Hinge Nibbler  " }, WRIGHT, { now: NOW, roll: ROLL });
  assert.deepEqual([fix.critter, fix.credit, fix.stamps], ["Hinge Nibbler", "ada", 50]);
  assert.match(fix.receipt, /; its critter is "Hinge Nibbler", named by ada$/);
  assert.deepEqual(JSON.parse(pen.rows().at(-1).payload),
    { post: ID, from: "briefed", to: "fixed", credit: "ada", fields: { size: "L", critter: "Hinge Nibbler", named_by: "ada" }, hand: "wright" });
  assert.deepEqual([posts.get(ID).fields.critter, posts.get(ID).fields.named_by], ["Hinge Nibbler", "ada"]);

  const one = (await postsAtOffice({ class: "bug", post: ID }, { now: NOW, roll: ROLL })).post;
  assert.deepEqual([one.state, one.fields.critter, one.fields.named_by], ["fixed", "Hinge Nibbler", "ada"]);
  const all = (await postsAtOffice({ class: "bug" }, { now: NOW, roll: ROLL })).posts.find((p) => p.id === ID);
  assert.deepEqual([all.fields.critter, all.fields.named_by], ["Hinge Nibbler", "ada"]);
  // shipping it keeps the name
  await advanceAtTown({ post: ID, to: "shipped" }, WRIGHT, { now: NOW, roll: ROLL });
  assert.deepEqual([posts.get(ID).fields.critter, posts.get(ID).fields.named_by], ["Hinge Nibbler", "ada"]);

  // the rebuild: the acts alone derive the name and its namer, and the table agrees
  const acts = pen.rows().filter((a) => a.class === "bug").map((a) => ({ ...a, payload: JSON.parse(a.payload) }));
  const rebuilt = foldPostActs(acts).posts.get(ID);
  assert.deepEqual([rebuilt.fields.critter, rebuilt.fields.named_by], ["Hinge Nibbler", "ada"]);
  const out = await dryRun(pen);
  assert.equal(out.equal, true, out.drift.join("\n"));
  // …and a stored row that lost the name is drift
  const lost = { ...posts.get(ID), fields: { ...posts.get(ID).fields } };
  delete lost.fields.critter;
  const drifted = compareRebuild({ posts: [lost], responses: [] }, acts);
  assert.equal(drifted.equal, false);
  assert.match(drifted.drift.join("\n"), /fields: stored .* the acts derive .*"critter":"Hinge Nibbler"/);
});

test("8 · a name with markup is stored and returned as plain text, exactly as sent", async () => {
  const { pen, posts } = setup();
  await toBriefed();
  const NAME = `<b>Bitey</b> & <img src=x onerror="1">`;
  assert.ok([...NAME].length <= 40);
  const fix = await advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "M", critter: NAME }, WRIGHT, { now: NOW, roll: ROLL });
  assert.equal(fix.critter, NAME);
  assert.equal(JSON.parse(pen.rows().at(-1).payload).fields.critter, NAME, "the act keeps the characters, not an escaped or stripped copy");
  assert.equal(posts.get(ID).fields.critter, NAME);
  const one = (await postsAtOffice({ class: "bug", post: ID }, { now: NOW, roll: ROLL })).post;
  assert.equal(one.fields.critter, NAME);
  assert.equal(typeof one.fields.critter, "string");
});
