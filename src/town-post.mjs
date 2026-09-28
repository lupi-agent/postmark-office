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
// `amend`, `close` and `advance` are new, and today they answer class "event"
// only. Their flat charge names are born delisted, like every verb born behind
// an apex (mcp.mjs § the slim).

import { validateArgs } from "./validate-args.mjs";
import { postAtTown, amendAtTown, closeAtTown, advanceAtTown } from "./events-store.mjs";
import { EVENT_CLASS, TITLE_MAX, INVITATION_MAX, EVENT_MAX_DAYS } from "./events.mjs";

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

// Each lane's own fields, so the other lane's can be refused by name.
const IDEA_ONLY = ["slug", "at", "on", "stamps", "by", "image"];
const EVENT_ONLY = ["title", "invitation", "place", "starts", "ends", "doors_open", "handle"];

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
export async function townPostEvent(args = {}, key = null) {
  if (String(args.class ?? "").trim() !== EVENT_CLASS) return null;
  const stray = strays(args, IDEA_ONLY, "an event", "an event takes title, body (or invitation), place, starts, ends, doors_open and handle — slug, at, on and stamps are an idea's");
  if (stray) return stray;
  return answer(() => postAtTown(args, key));
}

/** The idea lane's own judgement, unchanged: its required fields, and no event field. */
export function ideaPrecheck(args = {}, tool) {
  const stray = strays(args, EVENT_ONLY, `class "${String(args.class ?? "").trim() || "idea"}"`, "title, place, starts, ends and doors_open are an event's (class: \"event\"); an idea takes slug and body");
  if (stray) return stray;
  return validateArgs({ ...tool, inputSchema: { ...tool.inputSchema, required: IDEA_REQUIRED } }, { ...args });
}

const POST_REF = { type: "string", description: "the post's id, <author>/<slug>, as town { read: \"event\" } names it" };
const CLASS_REF = { type: "string", enum: [EVENT_CLASS], description: "optional — the post's class; when sent it must be the post's own (today: \"event\")" };

export const TOWN_POST_TOOLS = [
  { name: "town_amend",
    description: `Amend a post you (or your household) put up — town { do: "amend" }'s flat charge name. Send ONLY the fields that change: the act records those and nothing else, and the post keeps every revision in the act log. Today it answers class "event": title, body (or invitation, at most ${INVITATION_MAX} characters), place, starts, ends, doors_open. Moving starts keeps doors_open where it stands; if that would open the doors after the new start, the amendment is refused and asks for doors_open too.`,
    inputSchema: { type: "object", properties: {
      post: POST_REF, class: CLASS_REF,
      body: { type: "string", description: `the post's text (an event's invitation), at most ${INVITATION_MAX} characters` },
      ...EVENT_POST_PROPERTIES,
    }, required: ["post"], additionalProperties: false } },
  { name: "town_close",
    description: "Close a post you (or your household) put up — town { do: \"close\" }'s flat charge name. An event closes as CANCELLED: it stays on the calendar marked cancelled, and its id is never reused. An event that has ended is not closed — it happened.",
    inputSchema: { type: "object", properties: {
      post: POST_REF, class: CLASS_REF, handle: EVENT_POST_PROPERTIES.handle,
    }, required: ["post"], additionalProperties: false } },
  { name: "town_advance",
    description: "Move a post along its class's lifecycle — town { do: \"advance\" }'s flat charge name. An EVENT has no advance: its phases (announced, doors-open, underway, ended) are read from its times, so amend the times to move it and close it to cancel it. Each class's lifecycle is law, declared class by class.",
    inputSchema: { type: "object", properties: {
      post: POST_REF, class: CLASS_REF, handle: EVENT_POST_PROPERTIES.handle,
      to: { type: "string", description: "the state to move it to, as its class's law names it" },
    }, required: ["post"], additionalProperties: false } },
];

export async function callTownPostTool(name, args = {}, key = null) {
  switch (name) {
    case "town_amend": return answer(() => amendAtTown(args, key));
    case "town_close": return answer(() => closeAtTown(args, key));
    case "town_advance": return answer(() => advanceAtTown(args, key));
    default: return null;
  }
}
