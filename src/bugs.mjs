// bugs.mjs — THE BUG CLASS OF THE POST MACHINE (Posts phase 2, first slice), pure.
//
// Keemin, 2026-09-29 (the Posts project, § Ruled for phase 2): "Bugs pay the
// flat ladder, with no staking … it feels odd to wait for stakers for a clearly
// broken thing that just needs fixing, and ideally every bug gets fixed
// anyway." The first slice is the bug class plus a mint Wright reviews before
// it writes.
//
// ── THE LIFECYCLE ───────────────────────────────────────────────────────────
//
//   reported → confirmed → reproduced → diagnosed → briefed → fixed → shipped
//
// with two side exits from reported or confirmed: `duplicate` (naming the post
// it duplicates, `of`) and `not-a-bug`. Finished: shipped, duplicate, not-a-bug.
//
// Any resident posts a bug as themselves. The town's hands (BUG_HANDS) move it,
// and may also post one on a resident's behalf (`for`), crediting the reporter.
// An advance may jump forward; a stage it skips pays nothing.
//
// ── THE ADVANCE RECORDS; IT MINTS NOTHING ───────────────────────────────────
//
// Each advance act names the stage and whom it credits (`credit`), and at
// `briefed` the grade, at `fixed` the size and the critter the fixer named
// (POS-298; kept as fields.critter with fields.named_by). What a stage pays is the ladder
// below, and it is paid by a separate, reviewed pass (tools/bug-stage-plan.mjs)
// that reads these acts, so a door call never moves money. The town's own
// ledger holds the ladder again at verify (its stamp-mint.mjs § the stage
// grammar), so an amount this file and the town disagree on reds the verifier.
//
// ── NO STAKE ────────────────────────────────────────────────────────────────
//
// A bug takes no stake, at post and at the stake door alike, refused by name
// (BUG_NO_STAKE), with the ruling's reason in the refusal.

import { refuse, TITLE_MAX, INVITATION_MAX } from "./events.mjs";

export const BUG_CLASS = "bug";

export const STATE_REPORTED = "reported";
export const STATE_CONFIRMED = "confirmed";
export const STATE_REPRODUCED = "reproduced";
export const STATE_DIAGNOSED = "diagnosed";
export const STATE_BRIEFED = "briefed";
export const STATE_FIXED = "fixed";
export const STATE_SHIPPED = "shipped";
export const STATE_DUPLICATE = "duplicate";
export const STATE_NOT_A_BUG = "not-a-bug";

/** The main line, in order. An advance moves forward along it and may skip. */
export const BUG_STAGES = Object.freeze([STATE_REPORTED, STATE_CONFIRMED, STATE_REPRODUCED, STATE_DIAGNOSED,
  STATE_BRIEFED, STATE_FIXED, STATE_SHIPPED]);
/** The side exits, and the states they leave from. */
export const BUG_SIDE_EXITS = Object.freeze([STATE_DUPLICATE, STATE_NOT_A_BUG]);
export const SIDE_EXIT_FROM = Object.freeze([STATE_REPORTED, STATE_CONFIRMED]);
/** Every state, and the ones a bug is finished in (the Posts project: "every class declares its finished states"). */
export const BUG_STATES = Object.freeze([...BUG_STAGES, ...BUG_SIDE_EXITS]);
export const BUG_FINISHED = Object.freeze([STATE_SHIPPED, STATE_DUPLICATE, STATE_NOT_A_BUG]);

// WHOSE HANDS MOVE A BUG (the brief, 2026-09-29). `bugcatcher` is the Bug
// Catcher meep, prepared in parallel. Widening it is a ruling, not a default.
export const BUG_HANDS = Object.freeze(["wright", "keemin", "bugcatcher"]);

export const BUG_SIZES = Object.freeze(["S", "M", "L"]);
export const BUG_GRADES = Object.freeze(["light", "heavy"]);

// THE FLAT LADDER (Everyone Builds v2, "really well calibrated", Keemin
// 2026-09-26; stands as ruled 2026-09-27 and 2026-09-29). `by` names the field
// that picks the amount; a stage with no `by` pays one amount. shipped and the
// side exits pay nothing and credit no one.
export const BUG_LADDER = Object.freeze({
  [STATE_CONFIRMED]: Object.freeze({ n: 2 }),
  [STATE_REPRODUCED]: Object.freeze({ n: 3 }),
  [STATE_DIAGNOSED]: Object.freeze({ n: 5 }),
  [STATE_BRIEFED]: Object.freeze({ by: "grade", n: Object.freeze({ light: 10, heavy: 5 }) }),
  [STATE_FIXED]: Object.freeze({ by: "size", n: Object.freeze({ S: 10, M: 25, L: 50 }) }),
});
/** The stages that pay, in lifecycle order. */
export const PAID_STAGES = Object.freeze(BUG_STAGES.filter((s) => BUG_LADDER[s]));

/** Three paid `confirmed` stages per household per week; later stages are uncapped (ruled 2026-09-27). */
export const CONFIRMED_CAP = 3;

/** What a stage pays, given the advance's own fields; 0 for a stage that pays nothing. */
export function stageAmount(stage, { size = null, grade = null } = {}) {
  const rung = BUG_LADDER[stage];
  if (!rung) return 0;
  if (!rung.by) return rung.n;
  return rung.n[rung.by === "size" ? size : grade] ?? 0;
}

// ── the text a bug carries ──────────────────────────────────────────────────

export const BODY_MAX = INVITATION_MAX;   // "an idea is a title plus a body of up to 600 characters" — a bug's the same
export const STEPS_MAX = 2000;
export const RECORD_MAX = 300;
/** A GitHub issue on the town's own org (the brief: `github.com/postmark-town/*`). */
export const ISSUE_RE = /^https:\/\/github\.com\/postmark-town\/[A-Za-z0-9._-]+\/issues\/\d+$/;
/** A handle as the town spells one: lowercase, digits, `-`, and the `.` some live handles carry. */
export const BUG_HANDLE_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/;

/**
 * The critter (POS-298, Keemin 2026-09-29): every caught bug becomes a small
 * critter for the town's jar, and the resident credited with the fix names it.
 * The town's hands record the name on the advance to fixed. It is text, never
 * HTML (the reading law): stored and returned exactly as sent, so whoever
 * paints it escapes it. It pays nothing; the ladder reads size and grade only.
 */
export const CRITTER_MAX = 40;
export const CRITTER_NAMER = "the resident who fixes a bug names it";
const CRITTER_HOW = `critter: "<name>", 1–${CRITTER_MAX} characters on one line — ${CRITTER_NAMER}, and tells the town's hands (${BUG_HANDS.join(", ")}) in the PR or the issue`;

export function judgeCritter(v) {
  if (v === undefined) throw refuse(422, `fixed needs a critter: ${CRITTER_NAMER}`, CRITTER_HOW, { field: "critter" });
  if (typeof v !== "string") throw refuse(422, "critter is text", CRITTER_HOW, { field: "critter" });
  const s = v.trim();
  if (!s) throw refuse(422, "critter is empty", CRITTER_HOW, { field: "critter" });
  if (/[\r\n]/.test(s)) throw refuse(422, "critter is one line", CRITTER_HOW, { field: "critter" });
  const n = [...s].length;
  if (n > CRITTER_MAX) throw refuse(422, `critter is at most ${CRITTER_MAX} characters`, `this one is ${n}`, { field: "critter" });
  return s;
}

/** The fields a bug's reporter may send and amend, beside title and body. */
export const BUG_FIELDS = Object.freeze(["issue", "steps", "record"]);

function oneLine(name, v, max) {
  if (typeof v !== "string") throw refuse(422, `${name} is text`, `${name}: one line of text`, { field: name });
  const s = v.trim();
  if (!s) throw refuse(422, `${name} is empty`, `leave ${name} off rather than sending it empty`, { field: name });
  if (s.length > max) throw refuse(422, `${name} is at most ${max} characters`, `this one is ${s.length}`, { field: name });
  if (/[\r\n]/.test(s)) throw refuse(422, `${name} is one line`, `${name} names one thing: an act id, a receipt path or a URL`, { field: name });
  return s;
}

/**
 * Judge a bug's text. `partial` is the amendment: only what was sent is judged
 * and returned. Returns `{ title?, body?, fields: { issue?, steps?, record? } }`.
 */
export function judgeBugText(input, { partial = false } = {}) {
  const out = { fields: {} };
  if (input.title !== undefined || !partial) {
    const t = typeof input.title === "string" ? input.title.trim() : "";
    if (!t) throw refuse(422, "a bug needs a title", "title: what is broken, in a few words", { field: "title" });
    if (t.length > TITLE_MAX) throw refuse(422, `a title is at most ${TITLE_MAX} characters`, `this one is ${t.length}`, { field: "title" });
    out.title = t;
  }
  if (input.body !== undefined || !partial) {
    const b = typeof input.body === "string" ? input.body.trim() : "";
    if (!b) throw refuse(422, "a bug needs a body", `body: what you saw and what you expected, at most ${BODY_MAX} characters`, { field: "body" });
    if (b.length > BODY_MAX) throw refuse(422, `a bug's body is at most ${BODY_MAX} characters`, `this one is ${b.length} — put the steps in steps:, and link the discussion with issue:`, { field: "body" });
    out.body = b;
  }
  if (input.issue !== undefined) {
    const s = typeof input.issue === "string" ? input.issue.trim() : "";
    if (!ISSUE_RE.test(s))
      throw refuse(422, "issue is a GitHub issue on the town's own repos", "issue: \"https://github.com/postmark-town/<repo>/issues/<n>\"", { field: "issue" });
    out.fields.issue = s;
  }
  if (input.steps !== undefined) {
    if (typeof input.steps !== "string" || !input.steps.trim()) throw refuse(422, "steps is text", "steps: how to make it happen, in your own words", { field: "steps" });
    const s = input.steps.trim();
    if (s.length > STEPS_MAX) throw refuse(422, `steps is at most ${STEPS_MAX} characters`, `this one is ${s.length}`, { field: "steps" });
    out.fields.steps = s;
  }
  if (input.record !== undefined) out.fields.record = oneLine("record", input.record, RECORD_MAX);
  return out;
}

/**
 * A handle named in `for` or `credit`: the town's spelling, AND a resident
 * standing in the office's residents index (Wright's review of #257: a handle
 * that is no one records, and the town's --stage-mint later dies on it with
 * "no WHITE_PAGES room"). `roll` is that index's handles; when the office
 * cannot read it, the act refuses rather than guessing.
 */
export function judgeHandleField(name, v, roll) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!BUG_HANDLE_RE.test(s)) throw refuse(422, `${name} names a resident by handle`, `${name}: "<handle>", as the town's white pages spell it`, { field: name });
  if (!roll) throw refuse(503, `the office cannot read its residents index, so it cannot check "${s}"`, "nothing was written — ask again shortly", { field: name });
  if (!roll.has(s)) throw refuse(422, `"${s}" is not a resident here`, `${name}: the resident's handle as the white pages spell it — town { read: "residents" } lists them`, { field: name });
  return s;
}

/**
 * The hand: the caller's resident, who must be one of BUG_HANDS. The same rule
 * as the quest's (quests.mjs § judgeQuestHand): the named handle if it is
 * yours, your only one, or the one of yours that is a hand.
 */
export function judgeBugHand(fields, key, { act }) {
  const held = [...(key?.handles ?? [])];
  const named = typeof fields?.handle === "string" ? fields.handle.trim() : "";
  if (named && !held.includes(named)) throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${held.join(", ") || "no resident"}`);
  const hand = named || (held.length === 1 ? held[0] : held.find((h) => BUG_HANDS.includes(h)) ?? "");
  if (!hand || !BUG_HANDS.includes(hand))
    throw refuse(403, `only the town's hands ${act}`,
      `a bug is moved along its life by ${BUG_HANDS.join(", ")}; anyone may post one as themselves with town { do: "post", args: { class: "bug", title, body } }`);
  return hand;
}

/**
 * Judge an advance against the post's current state. Returns the payload's
 * judged parts: `{ to, credit, size?, critter?, grade?, of? }`. `reporter` is the post's
 * author, the credit a `confirmed` defaults to.
 */
export function judgeAdvance(fields, prev, roll) {
  const to = typeof fields?.to === "string" ? fields.to.trim() : "";
  if (!to) throw refuse(422, "advance to which stage?", `to: one of ${BUG_STATES.filter((s) => s !== STATE_REPORTED).join(", ")}`, { field: "to" });
  if (!BUG_STATES.includes(to) || to === STATE_REPORTED)
    throw refuse(422, `"${to}" is not a stage a bug advances to`, `to: one of ${BUG_STATES.filter((s) => s !== STATE_REPORTED).join(", ")}`, { field: "to" });
  const from = prev.state;
  if (BUG_FINISHED.includes(from))
    throw refuse(409, `"${prev.id}" is finished (${from})`, "a finished bug moves no further; post a new one if it came back");
  if (BUG_SIDE_EXITS.includes(to)) {
    if (!SIDE_EXIT_FROM.includes(from))
      throw refuse(409, `a bug leaves as ${to} only from ${SIDE_EXIT_FROM.join(" or ")}`, `"${prev.id}" stands ${from}; move it forward along ${BUG_STAGES.join(" → ")}`, { field: "to" });
  } else if (BUG_STAGES.indexOf(to) <= BUG_STAGES.indexOf(from)) {
    throw refuse(409, `"${prev.id}" already stands ${from}`, `an advance moves forward: ${BUG_STAGES.slice(BUG_STAGES.indexOf(from) + 1).join(", ")}`, { field: "to" });
  }
  const out = { to };
  const paid = Boolean(BUG_LADDER[to]);
  if (fields.credit !== undefined && !paid)
    throw refuse(422, `${to} pays nothing and credits no one`, "leave credit off", { field: "credit" });
  if (paid) {
    if (fields.credit !== undefined) out.credit = judgeHandleField("credit", fields.credit, roll);
    else if (to === STATE_CONFIRMED) out.credit = prev.author;
    else throw refuse(422, `${to} names whom it credits`, `credit: "<handle>" — the resident who did the stage (from reproduced onward it is always named)`, { field: "credit" });
  }
  if (fields.size !== undefined && to !== STATE_FIXED) throw refuse(422, "size is fixed's", "only an advance to fixed takes size (S, M or L)", { field: "size" });
  if (fields.grade !== undefined && to !== STATE_BRIEFED) throw refuse(422, "grade is briefed's", "only an advance to briefed takes grade (light or heavy)", { field: "grade" });
  if (fields.critter !== undefined && to !== STATE_FIXED) throw refuse(422, `critter is fixed's: ${CRITTER_NAMER}`, "only an advance to fixed takes critter", { field: "critter" });
  if (to === STATE_FIXED) {
    if (!BUG_SIZES.includes(fields.size)) throw refuse(422, "fixed needs a size", `size: one of ${BUG_SIZES.join(", ")} — it picks the stamps (${BUG_SIZES.map((s) => `${s} ${BUG_LADDER.fixed.n[s]}`).join(", ")})`, { field: "size" });
    out.size = fields.size;
    out.critter = judgeCritter(fields.critter);
  }
  if (to === STATE_BRIEFED) {
    if (!BUG_GRADES.includes(fields.grade)) throw refuse(422, "briefed needs a grade", `grade: ${BUG_GRADES.join(" or ")} — the bless's revision (${BUG_GRADES.map((g) => `${g} ${BUG_LADDER.briefed.n[g]}`).join(", ")})`, { field: "grade" });
    out.grade = fields.grade;
  }
  if (fields.of !== undefined && to !== STATE_DUPLICATE) throw refuse(422, "of is duplicate's", "only an advance to duplicate names the post it duplicates", { field: "of" });
  if (to === STATE_DUPLICATE) {
    const of = typeof fields.of === "string" ? fields.of.trim() : "";
    if (!of) throw refuse(422, "a duplicate names the bug it duplicates", "of: \"<author>/<slug>\", the standing bug post", { field: "of" });
    if (of === prev.id) throw refuse(422, "a bug is not a duplicate of itself", "of: the other bug post", { field: "of" });
    out.of = of;
  }
  return out;
}

// ── the refusals for what a bug does not take ───────────────────────────────

export const NO_STAKE_REASON = "Keemin, 2026-09-29: \"it feels odd to wait for stakers for a clearly broken thing that just needs fixing, and ideally every bug gets fixed anyway\"";
export const BUG_NO_STAKE = (id = null) => refuse(422, id ? `"${id}" is a bug, and a bug takes no stake` : "a bug takes no stake",
  `a bug's stages pay the flat ladder, so there is nothing to back — ${NO_STAKE_REASON}. Help it along instead: steps, a record, or the fix`);
export const BUG_NO_CLOSE = (id) => refuse(422, `"${id}" is a bug, and a bug is not closed`,
  `it finishes by advance: town { do: "advance", args: { post, to: "shipped" | "duplicate" | "not-a-bug" } }, by the town's hands (${BUG_HANDS.join(", ")})`);
