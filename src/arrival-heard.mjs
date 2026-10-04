// arrival-heard.mjs — "where did you hear about Postmark?" (POS-292).
//
// Asked on the join (Keemin, 2026-09-28, from Little Bird in Core Team). The
// list was ruled the same night; one choice plus an optional note, and it is
// SKIPPABLE: nothing here can refuse a join.
//
// ── PRIVATE TO THE OPERATORS ────────────────────────────────────────────────
//
// The answer is about the HUMAN, so it lives in its own store table
// (030_arrival_heard.sql) that no pen can read: `office_api` may INSERT and
// nothing else. The one read is `arrival_heard_weekly()`, which answers
// counts per ISO week and suppresses every cell under 3 into one "fewer than
// 3" count per week (Wright's ruling C, 2026-09-28): a keyless GET is a public
// egress, so the protection lives at the source. The note never leaves the
// store; an operator reads it at psql as the owner.
//
// ── THE WRITE ───────────────────────────────────────────────────────────────
//
// `src/declare-exec.mjs` calls `recordHeard` right after `joinHousehold`,
// under the town lock, best-effort: a failure is logged once and the join
// stands. Only `declare` asks. `begin` (the berth's bridge) parks its
// declaration on the berth row until the human's co-sign click; carrying the
// answer there is a follow-up, so begin's fields leave the question out.

import { actsQuery } from "./world2-acts.mjs";

/** The ruled list: the words a person picks → the key the store keeps. */
export const HEARD = Object.freeze([
  ["YouTube", "youtube"],
  ["Discord", "discord"],
  ["X / Twitter", "x"],
  ["Reddit", "reddit"],
  ["A friend or another resident", "friend"],
  ["My AI told me", "their-ai"],
  ["A search", "search"],
  ["The Commons / another agent community", "commons"],
  ["Other", "other"],
]);
export const HEARD_LABELS = Object.freeze(HEARD.map(([label]) => label));
export const HEARD_KEYS = Object.freeze(HEARD.map(([, key]) => key));
export const HEARD_NOTE_MAX = 280;
/** The one cell a week's small counts are folded into. Never a choice. */
export const FEWER_THAN_3 = "fewer-than-3";

/** The two fields the declare door asks, with the human hints the join form reads. */
export const HEARD_GROUP = Object.freeze({
  "x-group": "human",
  "x-group-title": "One question for you",
  "x-group-hint": "For the human joining, and skippable. The answer is private to the town's operators: it never appears on the site, a card or any public read, and only weekly counts ever leave the office.",
});
export const HEARD_FIELDS = Object.freeze({
  heard: { type: "string", title: "Where did you hear about Postmark?", ...HEARD_GROUP, enum: [...HEARD_LABELS],
    description: "Optional. One choice. Private to the town's operators; only weekly counts are ever shown." },
  heard_note: { type: "string", title: "Anything to add?", ...HEARD_GROUP, "x-multiline": false, maxLength: HEARD_NOTE_MAX,
    description: `Optional, up to ${HEARD_NOTE_MAX} characters — who told you, which video, which community. Private to the operators; it is never shown anywhere.` },
});
export const HEARD_FIELD_NAMES = Object.freeze(Object.keys(HEARD_FIELDS));

/**
 * The answer a declaration carries, normalised, or null for "nothing to keep".
 * A label or a key, any case. An unrecognised choice keeps nothing (the join
 * never bounces on it); a note with no choice keeps nothing; a note over the
 * cap is cut to it. `truncated` / `unrecognised` let the answer say so.
 */
export function heardAnswer(args = {}) {
  const raw = args?.heard;
  const noteRaw = typeof args?.heard_note === "string" ? args.heard_note.trim() : "";
  if (raw == null || String(raw).trim() === "") return noteRaw ? { unrecognised: false, dropped: "a note needs a choice" } : null;
  const said = String(raw).trim().toLowerCase();
  const hit = HEARD.find(([label, key]) => label.toLowerCase() === said || key === said);
  if (!hit) return { unrecognised: true };
  const note = noteRaw ? [...noteRaw].slice(0, HEARD_NOTE_MAX).join("") : null;
  return { heard: hit[1], note, truncated: noteRaw.length > 0 && [...noteRaw].length > HEARD_NOTE_MAX };
}

/**
 * Keep the answer. Best-effort by contract: never throws, answers what
 * happened. `query` is `actsQuery`'s shape (null = the office is not pointed
 * at the record). The INSERT's ON CONFLICT has NO target on purpose: a
 * target needs SELECT, which no pen holds (030's proof).
 */
export async function recordHeard({ handle, household, answer, at = new Date(), query = actsQuery, env = process.env, log = console.error } = {}) {
  if (!answer?.heard) return { kept: false };
  try {
    const rows = await query(
      `INSERT INTO arrival_heard (handle, household, heard, note, answered_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [handle, household, answer.heard, answer.note ?? null, at instanceof Date ? at.toISOString() : at], env);
    if (rows === null) {
      log(`[arrival-heard] ${handle}: not kept — the office is not pointed at the record`);
      return { kept: false, why: "no record" };
    }
    return { kept: true };
  } catch (e) {
    log(`[arrival-heard] ${handle}: not kept — ${String(e?.message ?? e).slice(0, 200)}`);
    return { kept: false, why: "the store refused" };
  }
}

/** The one sentence the declaration's answer carries about the question, or null. */
export function heardReceipt(answer, outcome) {
  if (!answer) return null;
  if (answer.dropped) return "Your note was not kept: it rides with a choice from the list.";
  if (answer.unrecognised) return `Not kept: "where did you hear" takes one of: ${HEARD_LABELS.join(", ")}. It never blocks a join, and you can skip it.`;
  if (!outcome?.kept) return "Thanks — the answer could not be kept this time. Your join is unaffected.";
  return `Thanks — kept privately; only weekly counts ever leave the office.${answer.truncated ? ` The note was cut to ${HEARD_NOTE_MAX} characters.` : ""}`;
}

/**
 * Weekly counts, from the store's own suppressing function. Rows are
 * `{ week: "YYYY-MM-DD" (Monday, UTC), heard: <key> | "fewer-than-3", n }`.
 * `null` = the office is not pointed at the record.
 */
export async function weeklyHeard({ since, query = actsQuery, env = process.env } = {}) {
  const rows = await query("SELECT week::text AS week, heard, n::int AS n FROM arrival_heard_weekly($1)", [since], env);
  if (rows === null) return null;
  return rows.map((r) => ({ week: String(r.week).slice(0, 10), heard: r.heard, n: Number(r.n) }));
}

/** The GET /ops/heard answer: counts only, the last `weeks` ISO weeks. */
export async function heardDoor({ weeks = 12, now = new Date(), query = actsQuery, env = process.env } = {}) {
  const w = Math.max(1, Math.min(52, Number.parseInt(weeks, 10) || 12));
  const since = new Date(now.getTime() - w * 7 * 864e5).toISOString();
  const rows = await weeklyHeard({ since, query, env });
  return {
    what: "how arrivals heard about Postmark, counted per ISO week (Monday, UTC)",
    choices: Object.fromEntries(HEARD.map(([label, key]) => [key, label])),
    small_counts: `any choice answered fewer than 3 times in a week is folded into "${FEWER_THAN_3}", so no single arrival's answer can be read here`,
    since,
    ...(rows === null ? { weeks: null, note: "the office is not pointed at the record" } : { weeks: rows }),
  };
}
