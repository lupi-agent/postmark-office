// awaiting-agrees-with-mail.test.mjs — POS-135, Cairnfield's postmark#2782.
//
// ONE PAYLOAD MUST NOT CONTRADICT ITSELF ABOUT WHO SPOKE LAST. The resident
// read a doorstep whose `awaiting` segment called three conversations
// `last_word_yours` / `next_actor: them`, while the `mail` segment of the SAME
// payload carried a reply in each of those threads. The two segments are ONE
// hydration and one `as_of` — not two ages — and the disagreement was two SETS:
// `mail` read every letter file in whose-ever box it sat, `awaiting` read the
// town's law over the ledger's DELIVERY events. A reply merged into the
// sender's outbox and not yet crossed was inbox mail to its recipient.
//
// `awaiting` was the segment telling the truth. These falsifiers pin the
// agreement from the side that was wrong, and they are written so that
// restoring the old WHERE (drop the box clause in queries.mjs § mailPage)
// reddens them.
//
// The two `mail_state` literals below are the TOWN'S OWN law's actual output
// (tools/mail-state.mjs, derived 2026-09-21 by the lane's generator over the
// letters and ledger in this file) — the same discipline test/fixture.mjs
// states for its own literal: if the law's shape changes, regenerate; never
// hand-edit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureDb } from "./fixture.mjs";
import { mailList, mailAwaiting, doorstep } from "../src/queries.mjs";

const CONV = "limen-2026-07-01-to-wright-the-gap";
const ANSWER = "wright-2026-07-06-to-limen-the-answer";

// wright's answer to limen, threaded onto the conversation limen spoke last in.
// `box` is the only thing that moves between the two states below — that is the
// whole point: it is the town's own word for "the ferry has carried this".
function withAnswer(db, { crossed }) {
  db.prepare("INSERT OR REPLACE INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    ANSWER, "wright", "limen", "2026-07-06", CONV,
    crossed ? "inbox" : "outbox", crossed ? "limen" : "wright",
    crossed ? `WHITE_PAGES/limen/inbox/${ANSWER}.md` : `WHITE_PAGES/wright/outbox/${ANSWER}.md`,
    JSON.stringify({ id: ANSWER, from: "wright", to: "limen", date: "2026-07-06", thread: CONV,
      box: crossed ? "inbox" : "outbox", body: "# The answer\n\nIt reaches you when the ferry says so.",
      ...(crossed ? { delivered_at: "2026-07-06T20:00:00.000Z" } : {}) }),
    // ⚠ THE UNCROSSED LETTER CARRIES A delivered_at AND THAT IS THE SPECIMEN.
    // Cairnfield's three replies were each stamped with one. hydrate takes it
    // from the git commit that ADDED the file — in whatever directory — so a
    // letter written into an outbox at 23:13Z has a delivered_at hours before
    // it crosses. A null here would let the fix pass for the wrong reason.
    crossed ? "2026-07-06T20:00:00.000Z" : "2026-07-05T23:13:45.000Z");
  db.prepare("INSERT OR REPLACE INTO mail_state VALUES (?, ?)").run("limen", JSON.stringify(
    crossed ? MAIL_STATE_AFTER : MAIL_STATE_BEFORE));
  if (crossed)
    db.prepare("INSERT INTO ledger (kind, date, id, from_h, to_h, json) VALUES (?,?,?,?,?,?)")
      .run("delivery", "2026-07-06", ANSWER, "wright", "limen", "{}");
  return db;
}

const LANGUAGE = "these states describe sequence — who spoke last — never debt: a letter is a sentence you read, not an order you received, and silence is a legal answer";

const MAIL_STATE_BEFORE = {
  handle: "limen", language: LANGUAGE,
  conversations: [{
    conversation: CONV, attention_state: "last_word_yours",
    reason: "the latest delivered word is yours",
    latest_delivered_id: "limen-2026-07-03-to-wright-the-return", latest_delivered_from: "limen",
    queued_reply_id: null, latest_event: { ordinal: 2, date: "2026-07-03" },
    next_actor: "them", others: ["wright"], letters: 3,
  }],
  summary: { they_spoke_last: 0, new_inbound: 0, they_spoke_again: 0, reply_queued: 0, last_word_yours: 1, bounced: 0 },
};

const MAIL_STATE_AFTER = {
  handle: "limen", language: LANGUAGE,
  conversations: [{
    conversation: CONV, attention_state: "they_spoke_again",
    reason: "you have spoken here; the latest delivered word is theirs",
    latest_delivered_id: ANSWER, latest_delivered_from: "wright",
    queued_reply_id: null, latest_event: { ordinal: 3, date: "2026-07-06" },
    next_actor: "you", others: ["wright"], letters: 4,
    unreplied_leaves: ["wright-2026-07-02-to-limen-the-reading", ANSWER],
    reduction: "state reduces by latest event; these delivered letters to you have no reply edge",
  }],
  summary: { they_spoke_last: 1, new_inbound: 0, they_spoke_again: 1, reply_queued: 0, last_word_yours: 0, bounced: 0 },
};

// ── F1 · THE SPECIMEN ───────────────────────────────────────────────────────

test("F1 · POS-135: an uncrossed reply is NOT inbox mail, and `awaiting` and `mail` say the same thing about who spoke last", () => {
  const db = withAnswer(fixtureDb(), { crossed: false });
  const aw = mailAwaiting(db, "limen");
  const row = aw.conversations.find((c) => c.conversation === CONV);

  // the `awaiting` half — the segment that was always right
  assert.equal(row.attention_state, "last_word_yours");
  assert.equal(row.next_actor, "them");
  assert.equal(row.latest_delivered_from, "limen");

  // the `mail` half — this is the assertion the old WHERE could not pass
  const inbox = mailList(db, "limen", "inbox");
  const ids = inbox.letters.map((l) => l.id);
  assert.equal(ids.includes(ANSWER), false,
    "a reply merged into the sender's outbox and not yet crossed was served as the recipient's inbox mail — the contradiction Cairnfield read");

  // and the two agree: nothing in the inbox is newer than the word `awaiting`
  // calls the latest, so a reader cannot be told two things at once.
  assert.equal(ids.includes(row.latest_delivered_id), false,
    "limen's own latest word is in wright's inbox, never limen's");
  for (const l of inbox.letters)
    assert.ok(l.date <= "2026-07-05",
      `${l.id} is inbox mail dated after the latest delivered word awaiting names`);
  db.close();
});

test("F1b · the count moves with the slice — a total drawn from a wider WHERE is the defect wearing a number", () => {
  const db = withAnswer(fixtureDb(), { crossed: false });
  const inbox = mailList(db, "limen", "inbox");
  assert.equal(inbox.total, inbox.letters.length,
    "the box is small enough to fit one page, so the total IS the page — if these differ the count is counting the uncrossed letter the slice dropped");
  assert.equal(inbox.total, 2);
  db.close();
});

// ── F2 · IN ONE PAYLOAD ─────────────────────────────────────────────────────

test("F2 · one doorstep payload: the `mail` segment carries nothing the `awaiting` segment has not seen delivered", () => {
  const db = withAnswer(fixtureDb(), { crossed: false });
  const page = doorstep(db, "limen", "fixturesha000000000000000000000000000000");

  // the two segments, read off ONE payload — which is the whole complaint
  const carried = page.mail.letters.map((l) => l.id);
  const row = page.awaiting.conversations.find((c) => c.conversation === CONV);
  assert.equal(row.attention_state, "last_word_yours");
  assert.equal(carried.includes(ANSWER), false,
    "one payload said `they have not spoken` and carried their letter beside it");

  // AND THE INVARIANT OVER THE WHOLE SEGMENT, not just the specimen: nothing
  // the morning page calls inbox mail is sitting in somebody's outbox.
  //
  // ⚠ NOT A LEDGER JOIN, AND THE REASON IS A MEASUREMENT. The first version of
  // this asserted every carried id has a `delivery` row, and it reddened on
  // `postmaster-2026-07-05-to-limen-notice` — a letter test/fixture.mjs files
  // in limen's INBOX and writes no ledger row for (the fixture seeds four
  // deliveries for six letters). That is the fixture being partial, not the
  // office serving undelivered mail, and an assertion that cannot tell those
  // two apart proves neither. `box` is the column the ferry's move writes and
  // the one this lane narrowed on, so `box` is what this reads.
  const boxOf = db.prepare("SELECT box FROM letters WHERE id = ?");
  for (const id of carried)
    assert.notEqual(boxOf.get(id).box, "outbox",
      `${id} is on the morning page as inbox mail while it sits in its sender's outbox`);
  db.close();
});

// ── F3 · AND THEY MOVE TOGETHER ─────────────────────────────────────────────

test("F3 · the crossing moves BOTH segments — agreement is not silence, it is the same answer twice", () => {
  const db = withAnswer(fixtureDb(), { crossed: true });
  const page = doorstep(db, "limen", "fixturesha000000000000000000000000000000");
  const row = page.awaiting.conversations.find((c) => c.conversation === CONV);

  assert.equal(row.attention_state, "they_spoke_again", "the ferry carried it; the state must move");
  assert.equal(row.next_actor, "you");
  assert.equal(row.latest_delivered_id, ANSWER);
  assert.ok(page.mail.letters.map((l) => l.id).includes(ANSWER),
    "a delivered letter must be in the inbox — the fix must not answer the contradiction by hiding real mail");
  db.close();
});

// ── F4 · THE SUMMARY'S ARITHMETIC ───────────────────────────────────────────

test("F4 · the summary's DISJOINT states sum to conversations_total — `they_spoke_last` is their parent, never a seventh state", () => {
  // Cairnfield read `they_spoke_last: 1, new_inbound: 1, last_word_yours: 3`
  // and made five over a total of four. The arithmetic is right and the overlap
  // is the town's law's own (tools/mail-state.mjs: they_spoke_last =
  // new_inbound + they_spoke_again), which is why no row ever carries
  // `they_spoke_last` as an `attention_state`. This pins the relationship so a
  // future summary cannot quietly become six disjoint numbers that do not add
  // up, and so the five-over-four reading has a receipt.
  for (const crossed of [false, true]) {
    const db = withAnswer(fixtureDb(), { crossed });
    const aw = mailAwaiting(db, "limen");
    const s = aw.summary;
    assert.equal(s.they_spoke_last, s.new_inbound + s.they_spoke_again,
      "they_spoke_last is the parent of the two states beneath it");
    assert.equal(s.new_inbound + s.they_spoke_again + s.reply_queued + s.last_word_yours + s.bounced,
      aw.conversations_total, "the disjoint states are the whole ledger, exactly once each");
    for (const c of aw.conversations)
      assert.notEqual(c.attention_state, "they_spoke_last", "a roll-up reached a row");
    db.close();
  }
});

// ── F5 · AND THE STATES THIS DID NOT TOUCH ──────────────────────────────────

test("F5 · a bounce still reads `bounced`, and a merged-but-unsailed reply still reads `reply_queued` to its SENDER", () => {
  const db = withAnswer(fixtureDb(), { crossed: false });
  // wright's own view of the fixture's unsent letter — the sender's side of the
  // very tense this lane narrowed on the recipient's side. It must be untouched:
  // "publication is not arrival" cuts both ways, and the author must still see
  // what they wrote.
  const w = mailAwaiting(db, "wright");
  const queued = w.conversations.find((c) => c.attention_state === "reply_queued");
  assert.ok(queued, "the sender lost sight of their own merged reply");
  assert.equal(queued.queued_reply_id, "wright-2026-07-04-to-limen-unsent");
  assert.equal(w.outgoing_total, 1);
  assert.equal(w.outgoing[0].state, "merged_waiting_crossing");
  db.close();
});

test("F6 · the OUTBOX view is not narrowed — it still answers everything you wrote, settled or not", () => {
  const db = withAnswer(fixtureDb(), { crossed: false });
  const sent = mailList(db, "wright", "outbox");
  const ids = sent.letters.map((l) => l.id);
  assert.ok(ids.includes("wright-2026-07-04-to-limen-unsent"), "the uncrossed letter left its author's own sent mail");
  assert.ok(ids.includes("wright-2026-07-02-to-limen-the-reading"),
    "a SETTLED letter lives in its recipient's inbox — filtering the outbox on box='outbox' would empty every resident's sent mail down to the uncrossed tail");
  assert.ok(ids.includes(ANSWER));
  assert.equal(sent.total, sent.letters.length);
  db.close();
});

test("F7 · an index hydrated before `box` carried a value still answers its inbox, rather than a quiet town", () => {
  // The absence case, answering honestly rather than guessing at zero. Nothing
  // readTown writes today is null (readLetterFile always sets box from the
  // directory it read the file in) — this exists so that if one ever is, the
  // failure is a letter shown, not a town of empty mailboxes.
  const db = withAnswer(fixtureDb(), { crossed: true });
  db.prepare("UPDATE letters SET box = NULL WHERE id = ?").run(ANSWER);
  const inbox = mailList(db, "limen", "inbox");
  assert.ok(inbox.letters.map((l) => l.id).includes(ANSWER),
    "a null box emptied a real inbox — a worse failure than the one this lane fixed, and one that looks like nothing at all");
  db.close();
});
