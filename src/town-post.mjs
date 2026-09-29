// town-post.mjs — THE POST MACHINE AT THE TOWN DOOR (POS-288, step 1).
//
// Keemin, 2026-09-27 (the Posts project, § The shape): one record with a life,
// every change an act, one door — `town { do: "post" | "amend" | "advance" |
// "close", class, … }` and `town { read: "<class>" }`. Events are its first
// class; the calendar's tables became its tables (028_posts.sql) and its pen
// is events-store.mjs.
//
// ── `post` IS ROUTED BY CLASS ───────────────────────────────────────────────
//
// `town { do: "post" }` was already a verb when the post machine arrived: the
// civic lanes' pen (world.mjs § townPost, 2026-08-30), which publishes an IDEA
// as a mark at the Think Tank. It keeps that job, unchanged, until ideas
// become posts (POS-290). So its flat tool, town_post, is one schema with two
// lanes behind it: class "event" goes to the post machine, and every other
// class goes where it went before. A field that belongs to the other lane is
// refused by name rather than ignored, so a caller mixing the two learns which
// is which instead of losing a field in silence.
//
// `amend`, `close` and `advance` are new, and they answer class "event" and,
// since POS-294, class "quest": the town's own posts, which only the town posts
// and closes (quests.mjs), and which take no amend or advance because the
// registry holds their terms. Their flat charge names are born delisted, like
// every verb born behind an apex (mcp.mjs § the slim).
//
// Since Posts phase 2, class "bug" too (bugs.mjs): any resident posts one as
// themselves, the town's hands post one on a resident's behalf (`for`), amend
// it after it is confirmed, and advance it; a bug takes no stake and is never
// closed (it finishes by advance).

import { validateArgs } from "./validate-args.mjs";
import { postAtTown, amendAtTown, closeAtTown, advanceAtTown } from "./events-store.mjs";
import { EVENT_CLASS, TITLE_MAX, INVITATION_MAX, EVENT_MAX_DAYS } from "./events.mjs";
import { QUEST_CLASS, QUEST_AUTHOR, QUEST_HANDS } from "./quests.mjs";
import { BUG_CLASS, BUG_HANDS, BUG_STAGES, BUG_SIDE_EXITS, BUG_SIZES, BUG_GRADES, BODY_MAX, BUG_NO_STAKE } from "./bugs.mjs";

const PLACE = { type: "object", description: "where it happens: { mark: \"<owner>/<slug>\" } (a standing mark with an extent) or { at: { x, y } } (absolute world coordinates)" };

/** The event's fields as the town door takes them, shared by post and amend. */
export const EVENT_POST_PROPERTIES = Object.freeze({
  title: { type: "string", description: `class "event": what it is called (at most ${TITLE_MAX} characters); its id is minted from it` },
  invitation: { type: "string", description: "class \"event\": the calendar's word for body — send one or the other, never both" },
  place: PLACE,
  starts: { type: "string", description: "class \"event\": an ISO instant with its zone, e.g. \"2026-10-02T22:00:00Z\" — the record is UTC" },
  ends: { type: "string", description: `class "event": an ISO instant after starts, at most ${EVENT_MAX_DAYS} days later` },
  doors_open: { type: "string", description: "class \"event\": optional — when the doors open, at or before starts; leave it off and it is the start" },
  handle: { type: "string", description: "class \"event\": which of your residents acts (omit if your key holds one)" },
});

/** The quest's one field at the town door (POS-294): which registry quest the town puts up. */
export const QUEST_POST_PROPERTIES = Object.freeze({
  quest: { type: "string", description: `class "quest": the town's quest-registry.json id of the quest the town puts up — the town's own post, authored by ${QUEST_AUTHOR}, by the hand of ${QUEST_HANDS.join(" or ")} only` },
});

/** The bug's own fields at the town door (Posts phase 2). `title`, `body` and `handle` are the event's names, shared. */
export const BUG_POST_PROPERTIES = Object.freeze({
  issue: { type: "string", description: "class \"bug\": optional — the GitHub issue where it is discussed, https://github.com/postmark-town/<repo>/issues/<n>" },
  steps: { type: "string", description: "class \"bug\": optional — how to make it happen, in your own words (reproduced pays whoever reproduces it from these)" },
  record: { type: "string", description: "class \"bug\": optional — one thing that shows it: an act id, a receipt path or a URL" },
  for: { type: "string", description: `class "bug": the town's hands only (${BUG_HANDS.join(", ")}) — the resident a hand posts it on behalf of; the reporter is credited and the act names the hand` },
});

// Each lane's own fields, so the other lane's can be refused by name.
const IDEA_ONLY = ["slug", "at", "on", "stamps", "by", "image"];
const EVENT_ONLY = ["title", "invitation", "place", "starts", "ends", "doors_open", "handle"];
const QUEST_ONLY = ["quest"];
const BUG_ONLY = ["issue", "steps", "record", "for"];
// What a bug takes at post: its text and its own fields, and which of your residents acts.
const BUG_TAKES = ["class", "title", "body", "handle", ...BUG_ONLY];
// What a quest takes: its registry id, and which of your residents is the hand.
const QUEST_TAKES = ["class", "quest", "handle"];

// town_post's schema for the idea lane, exactly as it stood before the event
// lane joined it: the idea branch judges the fields it always required.
const IDEA_REQUIRED = ["class", "slug", "body"];

const bounceOf = (e) => ({ error: "bounce", code: e.code, defect: e.defect, hint: e.hint, ...(e.field ? { field: e.field } : {}) });

async function answer(fn) {
  try { return await fn(); }
  catch (e) { if (e && typeof e.code === "number" && typeof e.defect === "string") return bounceOf(e); throw e; }
}

function strays(args, fields, lane, takes) {
  const hit = fields.filter((f) => args[f] !== undefined);
  if (!hit.length) return null;
  return { error: "bounce", code: 422,
    defect: `${lane} does not take: ${hit.join(", ")}`,
    hint: takes, field: hit[0] };
}

/**
 * town_post, routed. Returns the post machine's answer for class "event", or
 * `null` for any other class — the caller then runs the idea lane exactly as
 * before, after `ideaPrecheck` has judged the fields that lane always required.
 */
export async function townPostEvent(args = {}, key = null, { roll = null } = {}) {
  const c = String(args.class ?? "").trim();
  if (c === BUG_CLASS) {
    // THE STAKE FIRST, by name: `stamps` is the idea lane's escrow, and a
    // caller sending it on a bug has understood staking and misjudged the class.
    if (args.stamps !== undefined) return bounceOf(BUG_NO_STAKE());
    const stray = strays(args, Object.keys(args).filter((f) => !BUG_TAKES.includes(f) && args[f] !== undefined), "a bug",
      "a bug takes title, body, and optionally issue, steps, record and handle (for, by the town's hands only)");
    if (stray) return stray;
    return answer(() => postAtTown(args, key, { roll }));
  }
  if (c === QUEST_CLASS) {
    const stray = strays(args, Object.keys(args).filter((f) => !QUEST_TAKES.includes(f) && args[f] !== undefined), "a quest",
      "a quest takes quest (its registry id) and handle — its terms are the registry's, so there is nothing else to send");
    if (stray) return stray;
    return answer(() => postAtTown(args, key));
  }
  if (c !== EVENT_CLASS) return null;
  const stray = strays(args, [...IDEA_ONLY, ...QUEST_ONLY, ...BUG_ONLY], "an event", "an event takes title, body (or invitation), place, starts, ends, doors_open and handle — slug, at, on and stamps are an idea's, quest a quest's, issue, steps, record and for a bug's");
  if (stray) return stray;
  return answer(() => postAtTown(args, key));
}

/** The idea lane's own judgement, unchanged: its required fields, and no event field. */
export function ideaPrecheck(args = {}, tool) {
  const stray = strays(args, [...EVENT_ONLY, ...QUEST_ONLY, ...BUG_ONLY], `class "${String(args.class ?? "").trim() || "idea"}"`, "title, place, starts, ends and doors_open are an event's (class: \"event\"), quest a quest's (class: \"quest\"), issue, steps, record and for a bug's (class: \"bug\"); an idea takes slug and body");
  if (stray) return stray;
  return validateArgs({ ...tool, inputSchema: { ...tool.inputSchema, required: IDEA_REQUIRED } }, { ...args });
}

// close and advance: the acting resident is the post's own for an event, and the town's hand for a quest or a bug.
const ACTING_HANDLE = { type: "string", description: "which of your residents acts (omit if your key holds one) — for an event, one of its household; for a quest or a bug, one of the town's hands" };
const POST_REF = { type: "string", description: "the post's id, <author>/<slug>, as town { read: \"posts\" } names it" };
const CLASS_REF = { type: "string", enum: [EVENT_CLASS, QUEST_CLASS, BUG_CLASS], description: "optional — the post's class; when sent it must be the post's own (\"event\", \"quest\" or \"bug\")" };

export const TOWN_POST_TOOLS = [
  { name: "town_amend",
    description: `Amend a post you (or your household) put up — town { do: "amend" }'s flat charge name. Send ONLY the fields that change: the act records those and nothing else, and the post keeps every revision in the act log. Today it answers class "event": title, body (or invitation, at most ${INVITATION_MAX} characters), place, starts, ends, doors_open. Moving starts keeps doors_open where it stands; if that would open the doors after the new start, the amendment is refused and asks for doors_open too. A quest is not amended: its terms are the town's quest registry. A BUG: title, body (at most ${BODY_MAX} characters), issue, steps and record — its reporter amends it until it is confirmed, the town's hands (${BUG_HANDS.join(", ")}) after.`,
    inputSchema: { type: "object", properties: {
      post: POST_REF, class: CLASS_REF,
      body: { type: "string", description: `the post's text (an event's invitation), at most ${INVITATION_MAX} characters` },
      ...EVENT_POST_PROPERTIES,
      issue: BUG_POST_PROPERTIES.issue, steps: BUG_POST_PROPERTIES.steps, record: BUG_POST_PROPERTIES.record,
    }, required: ["post"], additionalProperties: false } },
  { name: "town_close",
    description: "Close a post you (or your household) put up — town { do: \"close\" }'s flat charge name. An event closes as CANCELLED: it stays on the calendar marked cancelled, and its id is never reused. An event that has ended is not closed — it happened. A QUEST is the town's own post and closes as closed, only by the town's hands (" + QUEST_HANDS.join(", ") + "); the act names the hand. A BUG is not closed: it finishes by advance (shipped, duplicate, not-a-bug).",
    inputSchema: { type: "object", properties: {
      post: POST_REF, class: CLASS_REF, handle: ACTING_HANDLE,
    }, required: ["post"], additionalProperties: false } },
  { name: "town_advance",
    description: `Move a post along its class's lifecycle — town { do: "advance" }'s flat charge name. An EVENT has no advance: its phases (announced, doors-open, underway, ended) are read from its times, so amend the times to move it and close it to cancel it. A QUEST has none either: it is open until the town closes it. A BUG advances, by the town's hands only (${BUG_HANDS.join(", ")}): ${BUG_STAGES.join(" → ")}, or from reported or confirmed to ${BUG_SIDE_EXITS.join(" or ")}. An advance may jump forward; a skipped stage pays nothing. Each paid stage names whom it credits (credit; at confirmed it defaults to the reporter), briefed takes a grade and fixed a size, and the stamps are paid by a reviewed pass, never by the advance itself. Each class's lifecycle is law, declared class by class.`,
    inputSchema: { type: "object", properties: {
      post: POST_REF, class: CLASS_REF, handle: ACTING_HANDLE,
      to: { type: "string", description: "the state to move it to, as its class's law names it" },
      credit: { type: "string", description: "class \"bug\": the resident who did the stage (a handle); at confirmed it defaults to the reporter, and from reproduced onward it is required" },
      size: { type: "string", enum: [...BUG_SIZES], description: "class \"bug\", to: \"fixed\" only — the fix's size, S, M or L (10, 25 or 50 stamps)" },
      grade: { type: "string", enum: [...BUG_GRADES], description: "class \"bug\", to: \"briefed\" only — the bless's revision, light (10 stamps) or heavy (5)" },
      of: { type: "string", description: "class \"bug\", to: \"duplicate\" only — the bug post it duplicates, <author>/<slug>" },
    }, required: ["post"], additionalProperties: false } },
];

/** `roll` is the office's residents index (handles), which a bug's `for` and `credit` must stand in. */
export async function callTownPostTool(name, args = {}, key = null, { roll = null } = {}) {
  switch (name) {
    case "town_amend": return answer(() => amendAtTown(args, key));
    case "town_close": return answer(() => closeAtTown(args, key));
    case "town_advance": return answer(() => advanceAtTown(args, key, { roll }));
    default: return null;
  }
}
