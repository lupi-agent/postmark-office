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
//      rebuild folds the bug acts back into exactly the rows the pen wrote.
//
// ⚑ THE STORE IS A JS STUB (`acts-pen-stub.mjs`), as in quest-posts.test.mjs:
// this proves which acts and rows the pen writes and what the reads make of
// them, nothing about Postgres.
//
// THE FLIP (NOTES.md in the lane folder holds the red line): make
// judgeBugHand accept any handle and 1 goes red.

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

// The real clock: the pen refuses a row stamped for a window older than the open one.
const NOW = Date.now();

const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const ERRANT = { household: "errant", handles: new Set(["errant"]) };
const FINN = { household: "finn", handles: new Set(["finn"]) };

const HOUSES = [{ slug: "the-harbor", ord: 1, residents: ["errant", "ada"] }];

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
  const r = await postAtTown({ ...BUG, steps: "Open it, close it, open it again.", record: "act 4171" }, ERRANT, { now: NOW });
  assert.equal(r.post.id, ID);
  assert.deepEqual([r.post.class, r.post.author, r.post.household, r.post.state], ["bug", "errant", "hh:the-harbor", "reported"]);
  assert.deepEqual(r.post.fields, { steps: "Open it, close it, open it again.", record: "act 4171" });
  assert.match(r.receipt, /posted: errant\/the-door-sticks \(a bug\), reported by errant\./);
  assert.match(r.receipt, /A bug takes no stake/);
  const [posted] = pen.rows();
  assert.deepEqual([posted.class, posted.action, posted.actor, posted.object], ["bug", "post", "errant", ID]);

  const before = pen.rows().length;
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed" }, FINN, { now: NOW }), 403, /only the town's hands advance a bug/);
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed" }, ERRANT, { now: NOW }), 403, /only the town's hands advance a bug/);
  assert.equal(pen.rows().length, before, "a refused advance wrote an act");
  assert.equal(posts.get(ID).state, "reported");

  const a = await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW });
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

  await postAtTown(BUG, ERRANT, { now: NOW });
  // The stake door: a bug is not a mark, and the refusal says it is a bug, by name.
  const staked = await townStake({ mark: ID, stamps: 2 }, FINN);
  assert.equal(staked.error, "bounce");
  assert.equal(staked.code, 422);
  assert.match(staked.defect, /"errant\/the-door-sticks" is a bug, and a bug takes no stake/);
  assert.equal(staked.class, "bug");
  // …and a mark the town does not hold that is NOT a bug still gets the lane guard's own answer
  const stray = await townStake({ mark: "errant/no-such-thing", stamps: 2 }, FINN);
  assert.notEqual(stray.class, "bug");
  await refusedWith(amendAtTown({ post: ID, stamps: 1 }, ERRANT, { now: NOW }), 422, /takes no stake/);
  await refusedWith(advanceAtTown({ post: ID, to: "confirmed", stamps: 1 }, WRIGHT, { now: NOW }), 422, /takes no stake/);
  assert.equal(pen.rows().length, 1);
});

// ── 3 ───────────────────────────────────────────────────────────────────────

test("3 · a hand posts on a resident's behalf: the reporter is the author and is credited, the act names the hand; a non-hand's `for` is refused", async () => {
  const { pen } = setup();
  const r = await postAtTown({ ...BUG, for: "ada" }, WRIGHT, { now: NOW });
  assert.equal(r.post.id, "ada/the-door-sticks");
  assert.deepEqual([r.post.author, r.post.household, r.hand], ["ada", "hh:the-harbor", "wright"]);
  assert.match(r.receipt, /reported by ada, put up by wright's hand/);
  const act = pen.rows().at(-1);
  assert.equal(act.actor, "ada");
  assert.equal(JSON.parse(act.payload).hand, "wright");
  const a = await advanceAtTown({ post: "ada/the-door-sticks", to: "confirmed" }, WRIGHT, { now: NOW });
  assert.equal(a.credit, "ada", "confirmed credits the reporter, not the hand that put it up");

  await refusedWith(postAtTown({ ...BUG, for: "ada" }, ERRANT, { now: NOW }), 403, /only the town's hands post a bug on a resident's behalf/);
  await refusedWith(postAtTown({ ...BUG, for: "Not A Handle" }, WRIGHT, { now: NOW }), 422, /for names a resident by handle/);
  // a second bug with the same title takes the next id; ids are never reused
  const again = await postAtTown({ ...BUG, for: "ada" }, WRIGHT, { now: NOW });
  assert.equal(again.post.id, "ada/the-door-sticks-2");
});

// ── 4 ───────────────────────────────────────────────────────────────────────

test("4 · the reporter amends until confirmed and the hands after; only the changed fields are recorded", async () => {
  const { pen, posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW });
  const am = await amendAtTown({ post: ID, steps: "Open, close, open.", title: BUG.title }, ERRANT, { now: NOW });
  assert.deepEqual(am.amended, ["steps"], "the unchanged title is not recorded");
  assert.deepEqual(JSON.parse(pen.rows().at(-1).payload), { post: ID, changed: ["steps"], fields: { steps: "Open, close, open." } });
  await refusedWith(amendAtTown({ post: ID, title: "mine now" }, FINN, { now: NOW }), 403, /not yours to amend/);
  await refusedWith(amendAtTown({ post: ID, issue: "https://github.com/postmark-town/postmark/issues/1" }, ERRANT, { now: NOW }), 422, /issue is set when it is posted/);
  await refusedWith(amendAtTown({ post: ID, body: "x".repeat(601) }, ERRANT, { now: NOW }), 422, /at most 600 characters/);
  await refusedWith(amendAtTown({ post: ID, steps: "Open, close, open." }, ERRANT, { now: NOW }), 422, /nothing to amend/);

  await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW });
  await refusedWith(amendAtTown({ post: ID, title: "The door sticks, twice" }, ERRANT, { now: NOW }), 409, /only the town's hands amend it now/);
  const byHand = await amendAtTown({ post: ID, record: "https://postmark.town/api/release" }, WRIGHT, { now: NOW });
  assert.deepEqual(byHand.amended, ["record"]);
  assert.equal(JSON.parse(pen.rows().at(-1).payload).hand, "wright");
  assert.equal(posts.get(ID).fields.record, "https://postmark.town/api/release");
  assert.equal(posts.get(ID).fields.steps, "Open, close, open.", "an amend of one field left the other standing");
});

// ── 5 ───────────────────────────────────────────────────────────────────────

test("5 · the advance's law: forward only, a skip pays nothing, credit from reproduced on, size at fixed, grade at briefed", async () => {
  const { pen, posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW });
  await refusedWith(advanceAtTown({ post: ID, to: "reproduced" }, WRIGHT, { now: NOW }), 422, /reproduced names whom it credits/);
  await refusedWith(advanceAtTown({ post: ID, to: "fixed", credit: "finn" }, WRIGHT, { now: NOW }), 422, /fixed needs a size/);
  await refusedWith(advanceAtTown({ post: ID, to: "briefed", credit: "finn", size: "M" }, WRIGHT, { now: NOW }), 422, /size is fixed's/);
  await refusedWith(advanceAtTown({ post: ID, to: "briefed", credit: "finn" }, WRIGHT, { now: NOW }), 422, /briefed needs a grade/);
  await refusedWith(advanceAtTown({ post: ID, to: "shipped", credit: "finn" }, WRIGHT, { now: NOW }), 422, /shipped pays nothing and credits no one/);
  await refusedWith(advanceAtTown({ post: ID, to: "reported" }, WRIGHT, { now: NOW }), 422, /not a stage a bug advances to/);
  await refusedWith(advanceAtTown({ post: ID, to: "wontfix" }, WRIGHT, { now: NOW }), 422, /not a stage a bug advances to/);

  // a jump: reported → diagnosed pays diagnosed only, and says what it skipped
  const jump = await advanceAtTown({ post: ID, to: "diagnosed", credit: "finn" }, WRIGHT, { now: NOW });
  assert.equal(jump.stamps, 5);
  assert.match(jump.receipt, /skipped confirmed, reproduced, and a skipped stage pays nothing/);
  await refusedWith(advanceAtTown({ post: ID, to: "reproduced", credit: "finn" }, WRIGHT, { now: NOW }), 409, /already stands diagnosed/);
  await refusedWith(advanceAtTown({ post: ID, to: "not-a-bug" }, WRIGHT, { now: NOW }), 409, /leaves as not-a-bug only from reported or confirmed/);

  const brief = await advanceAtTown({ post: ID, to: "briefed", credit: "finn", grade: "heavy" }, WRIGHT, { now: NOW });
  assert.equal(brief.stamps, 5, "a heavy revision pays 5");
  const fix = await advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "M" }, WRIGHT, { now: NOW });
  assert.equal(fix.stamps, 25);
  assert.deepEqual(posts.get(ID).fields, { grade: "heavy", size: "M" });
  const ship = await advanceAtTown({ post: ID, to: "shipped" }, WRIGHT, { now: NOW });
  assert.equal(ship.stamps, 0);
  assert.match(ship.receipt, /shipped pays nothing/);
  await refusedWith(advanceAtTown({ post: ID, to: "shipped" }, WRIGHT, { now: NOW }), 409, /is finished \(shipped\)/);
  await refusedWith(amendAtTown({ post: ID, title: "x" }, WRIGHT, { now: NOW }), 409, /is finished/);
  await refusedWith(closeAtTown({ post: ID }, WRIGHT, { now: NOW }), 422, /a bug is not closed/);
  assert.equal(pen.rows().filter((r) => r.action === "advance").length, 4);
});

test("5 · a duplicate names a standing bug that is not itself; not-a-bug leaves from confirmed", async () => {
  const { posts } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW });
  await postAtTown({ ...BUG, title: "The door sticks again" }, FINN, { now: NOW });
  const dup = "finn/the-door-sticks-again";
  await refusedWith(advanceAtTown({ post: dup, to: "duplicate" }, WRIGHT, { now: NOW }), 422, /names the bug it duplicates/);
  await refusedWith(advanceAtTown({ post: dup, to: "duplicate", of: dup }, WRIGHT, { now: NOW }), 422, /not a duplicate of itself/);
  await refusedWith(advanceAtTown({ post: dup, to: "duplicate", of: "finn/nothing" }, WRIGHT, { now: NOW }), 404, /no bug "finn\/nothing"/);
  await refusedWith(advanceAtTown({ post: dup, to: "confirmed", of: ID }, WRIGHT, { now: NOW }), 422, /of is duplicate's/);
  const d = await advanceAtTown({ post: dup, to: "duplicate", of: ID }, WRIGHT, { now: NOW });
  assert.equal(d.stamps, 0);
  assert.deepEqual([posts.get(dup).state, posts.get(dup).fields.of], ["duplicate", ID]);
  await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW });
  await advanceAtTown({ post: ID, to: "not-a-bug" }, WRIGHT, { now: NOW });
  assert.equal(posts.get(ID).state, "not-a-bug");
});

test("5 · a bug's text is judged: title and body required, body ≤ 600, issue on the town's own repos", async () => {
  setup();
  await refusedWith(postAtTown({ class: "bug", body: "x" }, ERRANT, { now: NOW }), 422, /a bug needs a title/);
  await refusedWith(postAtTown({ class: "bug", title: "x" }, ERRANT, { now: NOW }), 422, /a bug needs a body/);
  await refusedWith(postAtTown({ ...BUG, body: "y".repeat(601) }, ERRANT, { now: NOW }), 422, /a bug's body is at most 600 characters/);
  await refusedWith(postAtTown({ ...BUG, issue: "https://github.com/someone-else/postmark/issues/1" }, ERRANT, { now: NOW }), 422, /GitHub issue on the town's own repos/);
  const ok = await postAtTown({ ...BUG, issue: "https://github.com/postmark-town/postmark-office/issues/256" }, ERRANT, { now: NOW });
  assert.equal(ok.post.fields.issue, "https://github.com/postmark-town/postmark-office/issues/256");
  // a stray field of another lane is refused by name at the door
  const stray = await townPostEvent({ ...BUG, starts: "2026-10-01T00:00:00Z" }, ERRANT);
  assert.match(stray.defect, /a bug does not take: starts/);
});

// ── 6 ───────────────────────────────────────────────────────────────────────

test("6 · the posts read answers class bug with its finished states; the rebuild folds the bug acts into exactly the rows the pen wrote", async () => {
  const { pen } = setup();
  await postAtTown(BUG, ERRANT, { now: NOW });
  await postAtTown({ ...BUG, for: "ada" }, WRIGHT, { now: NOW });
  await advanceAtTown({ post: ID, to: "confirmed" }, WRIGHT, { now: NOW });
  await amendAtTown({ post: ID, steps: "Twice." }, WRIGHT, { now: NOW });
  await advanceAtTown({ post: ID, to: "fixed", credit: "finn", size: "S" }, WRIGHT, { now: NOW });

  const r = await postsAtOffice({ class: "bug" }, { now: NOW });
  assert.deepEqual(r.finished, [...BUG_FINISHED]);
  assert.deepEqual(r.finished, ["shipped", "duplicate", "not-a-bug"]);
  assert.equal(r.total, 2);
  const one = r.posts.find((p) => p.id === ID);
  assert.deepEqual([one.class, one.state, one.author, one.latest.act], ["bug", "fixed", "errant", "advance"]);
  assert.deepEqual(one.fields, { steps: "Twice.", size: "S" });
  const single = await postsAtOffice({ class: "bug", post: "ada/the-door-sticks" }, { now: NOW });
  assert.equal(single.post.state, "reported");

  const out = await dryRun(pen);
  assert.equal(out.equal, true, out.drift.join("\n"));
  assert.deepEqual([out.counts.bug_acts, out.counts.bugs], [5, 2]);
  // and the equality can fail: a row the acts do not derive is drift
  const acts = pen.rows().filter((a) => a.class === "bug").map((a) => ({ ...a, payload: JSON.parse(a.payload) }));
  const drifted = compareRebuild({ posts: [{ id: "errant/ghost", class: "bug", title: "", body: "", author: "errant", state: "reported", fields: {}, revised: 0, posted_act: 1, last_act: 1 }], responses: [] }, acts);
  assert.equal(drifted.equal, false);
});
