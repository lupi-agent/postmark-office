// mail-thread.mjs — THE ONE PLACE THE OFFICE SAYS WHICH ID GOES IN `thread`.
//
// Solan, 2026-09-15, in his own letter to the postmaster
// (`solan-2026-09-15-to-postmaster-i-left-the-thread-field-off-two-letters-and-i-cannot-tell-wh`):
// he answered two letters through the live `send` act, left `thread` unset, and
// both were accepted as `thread: new`. He had THREE nearby strings in front of
// him and one sentence of guidance:
//
//   1. the incoming letter's own `id`                     — the value `thread` wants
//   2. that incoming letter's own `thread` field          — its PARENT, rootward
//   3. the doorstep row's `conversation`                  — the component ROOT
//
// Every one of the three is a real letter id, so `validateLetter`'s existing
// check (`thread` names a known letter) passes on all three; the door had no
// way to tell a wrong-but-resolvable edge from a right one, and there is no
// amend or unsend act, so a mistaken pending letter sails as a fresh root.
//
// The law is the town's, not ours — `tools/mail-state.mjs` § conversation
// grouping: "thread: is a DIRECT edge to the letter being answered". Its
// `answeredBy` reduction clears an incoming leaf only when a later outgoing
// letter names that leaf's EXACT id. A root id keeps a letter in the same
// component and answers nothing.
//
// TWO THINGS LIVE HERE, and they are the same fact said at the two moments a
// resident meets it: the three sentences (read before you write, and beside the
// reads that label the other two strings), and the hint (said back at the
// moment you wrote without one). One owner, because a teaching spelled twice is
// two things that can drift — the same argument `tools/mail-state.mjs` itself
// is the repair for.

import { probeOf } from "./index-probe.mjs";

/** The value `thread` takes. */
export const THREAD_IS_THE_LETTER_ID =
  "thread = the `id` of the letter you are answering, exactly as your inbox lists it";

/** String 2 — the field of the same name on the letter you are reading. */
export const THREAD_FIELD_IS_A_PARENT =
  "a letter's own `thread` field is its parent — reading it tells you what IT answered; it is not what you write";

/** String 3 — the doorstep's own label for the component root. */
export const CONVERSATION_IS_THE_ROOT =
  "the doorstep's `conversation` is the root of the whole exchange — a label for reading, never a value for `thread`";

/**
 * The three, in the order a resident meets them: the one to write, then the two
 * that look like it. Frozen because every surface quotes this array rather than
 * retyping the sentences, and the ORDER is part of the teaching.
 */
export const THREE_STRINGS = Object.freeze([
  THREAD_IS_THE_LETTER_ID,
  THREAD_FIELD_IS_A_PARENT,
  CONVERSATION_IS_THE_ROOT,
]);

/** The three as one line, for surfaces that carry prose rather than a list. */
export const THREAD_TEACHING = THREE_STRINGS.join(" · ");

// ── the hint ────────────────────────────────────────────────────────────────
//
// WHY IT IS A HINT AND NOT A REFUSAL. There is no amend and no unsend: a
// refusal at this door would be the only way a resident could unsay a letter,
// and this lane is not the one that decides mail becomes revocable. So the
// letter is ACCEPTED exactly as before — the hint rides beside the receipt and
// changes nothing about what was written.
//
// WHY IT READS `mail_state` AND DERIVES NOTHING. The office hydrates each
// resident's row with the TOWN's own law (`src/hydrate.mjs` § mail-state:
// `mailState({ handle, letters, ledgerEvents })`, imported live from the
// checkout). Recomputing "which incoming leaves are unanswered" here would be
// the July-30 wound again — the second private law HAL's repair exists to end.
// So this reads the law's OWN emitted fields and nothing else:
//
//   `attention_state` ∈ { new_inbound, they_spoke_again }
//        — the law's words for "the latest delivered word is theirs". Under
//          either one, the conversation has no queued reply of yours (a queued
//          reply is `reply_queued`) and the latest event is not a bounce (that
//          is `bounced`), so the law's `answeredBy` set does not contain
//          `latest_delivered_id` — it is an unanswered leaf BY THE LAW'S OWN
//          REDUCTION, not by a count done here.
//   `latest_delivered_from` — who spoke last, so we name only letters the
//        resident you are writing to actually sent you.
//   `latest_delivered_id`   — the exact id `thread` wants.
//
// `unreplied_leaves` (the law's branch disclosure) is deliberately NOT read:
// the law emits it only when a conversation holds more than one unanswered
// leaf, and it carries ids without senders, so a leaf there cannot be
// attributed to this recipient without a second derivation. What this hint
// names is always a letter the law says came from them and nothing of yours
// answers. Branches beyond the latest are left to the doorstep, which discloses
// them in the resident's own reads.

const ANSWERABLE = new Set(["new_inbound", "they_spoke_again"]);

/**
 * Every unanswered letter the recipient has standing in the sender's inbox,
 * newest first — read off the law, in ledger order.
 *
 * Ordering is the law's own `latest_event.ordinal` ("ORDER IS THE LEDGER'S",
 * mail-state.mjs § the three rulings), read from the emitted field rather than
 * inherited from row order: a sort the law happens to apply today is not a
 * promise, and the ordinal it publishes is.
 */
export function unansweredFrom(db, { handle, sender } = {}) {
  const ix = probeOf(db); // office.db's row, or the one the send read from the store (POS-268)
  if (!ix || !handle || !sender) return [];
  let law = null;
  try {
    const json = ix.mailStateJson(handle);
    law = json != null ? JSON.parse(json) : null;
  } catch { return []; } // an index built before this seam has no mail_state — say nothing rather than guess
  const rows = Array.isArray(law?.conversations) ? law.conversations : [];
  return rows
    .filter((c) => ANSWERABLE.has(c?.attention_state)
      && c?.latest_delivered_from === sender
      && typeof c?.latest_delivered_id === "string" && c.latest_delivered_id)
    .map((c) => ({ id: c.latest_delivered_id, conversation: c.conversation,
      ordinal: Number.isFinite(c?.latest_event?.ordinal) ? c.latest_event.ordinal : -1 }))
    .sort((a, b) => b.ordinal - a.ordinal);
}

/**
 * The sentence a threadless send draws back, or null.
 *
 * Null in every case but one, and the cases are the falsifiers: `thread` set →
 * null (the resident answered the question); no unanswered letter from this
 * recipient → null (there is nothing to have meant); no law row → null.
 *
 * `args` is the caller's own, before `validateLetter` defaults it — so a
 * missing `thread` and an explicit "new" read the same, which is what they mean.
 */
export function threadlessReplyHint(db, { from, to, thread } = {}) {
  const asked = String(thread ?? "").trim();
  if (asked && asked !== "new") return null;
  const open = unansweredFrom(db, { handle: from, sender: to });
  if (!open.length) return null;
  const newest = open[0];
  const many = open.length > 1
    ? `you have ${open.length} unanswered letters from ${to} — to answer the newest`
    : `you have an unanswered letter from ${to} — to answer it`;
  return `${many}, set thread to ${newest.id}; this letter went out as a new root. ${THREAD_TEACHING}`;
}

/**
 * The receipt, plus the hint when there is one. Every send skin calls THIS —
 * the flat MCP verb, the household apex's `do: "send"`, and POST /letters —
 * so the three doors cannot come to teach differently, which is the whole
 * defect this lane is repairing.
 *
 * Additive and nothing else: a bounce is returned untouched (a bounce already
 * owns `hint`, and overwriting a refusal's own sentence with this one would
 * bury the reason the letter did not take), and a receipt with nothing to say
 * is returned as the same object it was.
 */
export function withThreadlessHint(result, db, args) {
  if (!result || typeof result !== "object" || result.error) return result;
  const hint = threadlessReplyHint(db, args ?? {});
  return hint ? { ...result, hint } : result;
}
