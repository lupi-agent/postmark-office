// awaiting-threads-walk-offset.test.mjs — the threads list walks on the offset
// its own note names.
//
// THE BUG (lupi, bug post lupi/awaiting-threads-note-recommends-offset-but-offset-repeats-p):
// a resident with 24 threads where the other side spoke last saw 20 of them and
// the note "the whole ledger walks with offset:". Called again with offset: 20,
// the view served the SAME 20 threads and the same note: the slice ignored the
// offset, only `conversations` moved. The oldest four were reachable by `limit`
// alone, and the note pointed away from it.
//
//   node --test test/awaiting-threads-walk-offset.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mailAwaitingOf } from "../src/queries.mjs";

// 24 conversations awaiting the resident, then 6 where the last word is theirs,
// newest first, the shape tools/mail-state.mjs emits.
function law(awaiting, quiet = 6) {
  const conversations = [];
  for (let i = 0; i < awaiting; i++) conversations.push({
    conversation: `c-${String(i).padStart(2, "0")}`, attention_state: "they_spoke_again", next_actor: "you",
    latest_delivered_from: `n${i}`, latest_delivered_id: `n${i}-letter`, latest_event: { date: "2026-10-01" },
  });
  for (let i = 0; i < quiet; i++) conversations.push({
    conversation: `q-${i}`, attention_state: "last_word_yours", next_actor: "them",
    latest_delivered_from: "me", latest_delivered_id: `me-${i}`, latest_event: { date: "2026-09-01" },
  });
  return { conversations, summary: {} };
}

const ids = (v) => v.threads.map((t) => t.thread_of);

test("offset moves the threads page, so following the note reaches every thread", () => {
  const L = law(24);
  const p1 = mailAwaitingOf(L, "2026-10-06", "me", { limit: 20 });
  assert.equal(p1.threads_total, 24);
  assert.equal(p1.threads.length, 20);
  assert.equal(p1.threads_complete, false);
  assert.equal(p1.threads_next_offset, 20);
  assert.match(p1.threads_more_note, /4 further threads .* offset: 20/);

  const p2 = mailAwaitingOf(L, "2026-10-06", "me", { limit: 20, offset: p1.threads_next_offset });
  assert.equal(p2.threads_offset, 20);
  assert.deepEqual(ids(p2), ["c-20", "c-21", "c-22", "c-23"], "page two must be the four the first page left out");
  assert.equal(ids(p1).filter((x) => ids(p2).includes(x)).length, 0, "no thread served twice");
  assert.equal(p2.threads_complete, true);
  assert.equal(p2.threads_next_offset, undefined);
  assert.equal(p2.threads_more_note, undefined);

  // The walk covers the whole set exactly once.
  assert.deepEqual([...ids(p1), ...ids(p2)].sort(), L.conversations.slice(0, 24).map((c) => c.conversation).sort());
});

test("the note says which slice it is, not 'the most recent' on a later page", () => {
  const p2 = mailAwaitingOf(law(24), "2026-10-06", "me", { limit: 20, offset: 20 });
  assert.match(p2.threads_note, /^threads 21–24 of 24 /);
});

test("a whole list answers no cursor and no note, as before", () => {
  const v = mailAwaitingOf(law(5), "2026-10-06", "me", {});
  assert.equal(v.threads.length, 5);
  assert.equal(v.threads_complete, true);
  // Not even a zero cursor: a whole list is the common morning, and the doorstep
  // must not grow a byte for it (foyer-shrink.test.mjs § F7c5).
  for (const k of ["threads_offset", "threads_note", "threads_next_offset", "threads_more_note"]) assert.equal(v[k], undefined, k);
});

test("an offset past the end serves an empty page, never wraps", () => {
  const v = mailAwaitingOf(law(24), "2026-10-06", "me", { limit: 20, offset: 500 });
  assert.equal(v.threads.length, 0);
  assert.equal(v.threads_offset, 24);
  assert.equal(v.threads_complete, true);
});
