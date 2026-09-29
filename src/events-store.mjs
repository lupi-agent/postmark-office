// events-store.mjs — THE CALENDAR'S PEN AND ITS READ (POS-207, POS-208).
//
// The rules are src/events.mjs's, pure. This file is where they meet the
// record: the queries, the transaction, the four household acts, the town's
// post / amend / close / advance for class "event" (POS-288), class "quest"
// (POS-294, the town's own posts; its rules are quests.mjs's) and class "bug"
// (Posts phase 2; its rules are bugs.mjs's), and the calendar read.
//
// ── ONE ACT, ONE TRANSACTION (the pen's R1, src/world2-pen.mjs) ─────────────
//
// Every write here is ONE `officeWrite` transaction: the store is read for
// what the act needs to know (the mark, the event), the act is inserted
// through the pen's own `insertAct`, and the row `applyPostAct` derives from
// that act is written to `posts` or `responses` on the same client. An
// announcement (POS-227) is the one act with no projection row: it is read back
// from `acts` itself (§ announcementsOf). A
// refusal thrown inside rolls the whole thing back, so a refused act leaves the
// acts count exactly where it was.
//
// The one thing done OUTSIDE a transaction is the webhook challenge (POS-208):
// a network call of up to ten seconds does not hold a transaction open. The
// event is read first, the challenge runs, and the write re-reads the event
// before it commits, so an event cancelled during the challenge is refused.
//
// ── THE REFUSAL, AND THE OTHER REFUSAL ──────────────────────────────────────
//
// A rule's refusal (`{ code, defect, hint }`, events.mjs § refuse) passes
// through as itself. Anything else that goes wrong reaching or committing the
// record is the pen's ruled sentence — "the office's record cannot be reached
// — nothing was written, and nothing was lost" — as a 503, never a degrade
// (world2-pen.mjs § THE REFUSAL, D2).

import { officeRead, officeWrite, insertAct, PenUnreachableError } from "./world2-pen.mjs";
import { householdKeyFor } from "./world2-claims.mjs";
import { currentCrossing } from "./crossings.mjs";
import { wakesNote, earpieceEnabled } from "./earpiece.mjs";
import { WORLD_ANCHOR } from "./world-journal.mjs";
import {
  QUEST_CLASS, QUEST_AUTHOR, STATE_OPEN, STATE_CLOSED, questPostId, questEntries, judgeQuestEntry, judgeQuestHand,
  QUEST_NO_AMEND, QUEST_NO_ADVANCE,
} from "./quests.mjs";
import {
  BUG_CLASS, BUG_FINISHED, BUG_LADDER, BUG_STAGES, BUG_HANDS, STATE_REPORTED, stageAmount,
  judgeBugText, judgeBugHand, judgeHandleField, judgeAdvance, BUG_NO_STAKE, BUG_NO_CLOSE,
} from "./bugs.mjs";
import {
  EVENT_CLASS, ACT_POST, ACT_AMEND_POST, ACT_CLOSE, ACT_ADVANCE, ACT_RSVP, ACT_ANNOUNCE, ENDED_LIST_DAYS,
  STATE_CANCELLED, RESPONSE_RSVP, RESPONSE_STANDING,
  BUDGET_DEFAULT, BUDGET_MAX, FELL_BACK_NO_ECHO, SECRET_BYTES, SECRET_NOTE, HARNESS_REUSED_NOTE,
  refuse, mintEventId, judgeInterval, judgePlaceShape, placeFromMarkRow, anchorForPlace,
  judgeText, judgeRsvp, challengeWebhook, harnessPlan, applyPostAct, eventView, calendarFrom, slugFromTitle,
  judgeAnnouncement, announceMax, ANNOUNCE_MAX_ENV,
} from "./events.mjs";

// THE TABLES ARE `posts` AND `responses` since 028 (POS-288): the calendar's
// tables, generalized in place, with events their first class. The old names
// are read-only views for the readers that have not moved (the earpiece, the
// pinned board); nothing here reads or writes them.
const POST_COLUMNS = "id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act";
const READ_HINT = (id) => `town { read: "calendar", args: { event: "${id}" } } — or GET /calendar/${id}`;
const POST_READ_HINT = (id) => `town { read: "event", args: { post: "${id}" } } — or GET /calendar/${id}`;

const isRefusal = (e) => e && typeof e.code === "number" && typeof e.defect === "string";

/**
 * Run one transaction; a rule's refusal is itself, anything else is the pen's
 * 503. `household` declares the acting household's spelling set first
 * (`officeWrite` § R1), which is what 026's row policy on `household_harnesses`
 * compares against: without it the resident's own harness row is invisible and
 * unwritable. The 503 is the pen's FIXED sentence, never the driver's message,
 * so no column value (a secret on a failing row) can ride an error out.
 */
async function write(fn, env, household = null) {
  try {
    return await officeWrite(fn, { env, household });
  } catch (e) {
    if (isRefusal(e)) throw e;
    if (e?.name === "LateCrossingError") throw refuse(409, e.message, "the act was stamped for a window the record will not take; nothing was written");
    const pen = new PenUnreachableError(e);
    throw refuse(503, pen.message,
      "this door's pen is the office's record; when it cannot be reached the door refuses rather than writing anywhere else — the act is safe to try again");
  }
}

async function read(fn, env) {
  try {
    return await officeRead(fn, { env });
  } catch (e) {
    if (isRefusal(e)) throw e;
    throw refuse(503, "the calendar lives in the office's record, and the record cannot be read",
      "nothing is wrong with your call — ask again shortly", { cause: String(e?.message ?? e).slice(0, 160) });
  }
}

/**
 * "Which of your residents" — the household door's standpoint, the rule its
 * paper acts keep (household-apex.mjs § THE STANDPOINT HANDLE): the named
 * handle if it is yours, your only one if you have one, asked by name if you
 * have several.
 */
export function standpointHandle(fields, key) {
  const held = [...(key?.handles ?? [])];
  const named = String(fields?.handle ?? "").trim();
  if (named) {
    if (!held.includes(named)) throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${held.join(", ") || "no resident"}`);
    return named;
  }
  if (held.length === 1) return held[0];
  if (!held.length) throw refuse(403, "hosting and RSVPing are a resident's acts", "your key holds no resident — declare a household first");
  throw refuse(422, "which of your residents?", `your key acts for ${held.join(", ")} — name one with handle:`, { your_residents: held });
}

const isoOrNull = (v) => (v == null ? null : new Date(v).toISOString());
const numOrNull = (v) => (v == null ? null : Number(v));
const rowOf = (r) => (r ? { ...r, place_x: numOrNull(r.place_x), place_y: numOrNull(r.place_y), revised: Number(r.revised),
  starts: isoOrNull(r.starts), ends: isoOrNull(r.ends),
  fields: typeof r.fields === "string" ? JSON.parse(r.fields) : { ...(r.fields ?? {}) } } : null);
const doorsOf = (row) => row.fields?.doors_open ?? row.starts;

async function eventRow(client, id) {
  const { rows } = await client.query(`SELECT ${POST_COLUMNS} FROM posts WHERE id = $1 AND class = $2`, [id, EVENT_CLASS]);
  return rowOf(rows[0]);
}
async function rsvpHandles(client, id) {
  const { rows } = await client.query("SELECT handle FROM responses WHERE post = $1 AND kind = $2 ORDER BY handle", [id, RESPONSE_RSVP]);
  return rows.map((r) => r.handle);
}
/**
 * The host's announcements for these events, oldest first: the `announce` acts
 * themselves, `{ act, event, at, text }`. There is no table of them; the act
 * log is the record (§ the header), and the notary's public export already
 * carries every act, so reading them here widens nothing.
 */
export async function announcementsOf(client, ids) {
  if (!ids.length) return [];
  const { rows } = await client.query(
    "SELECT id, object, at, payload FROM acts WHERE class = $1 AND action = $2 AND object = ANY($3) ORDER BY id",
    [EVENT_CLASS, ACT_ANNOUNCE, ids]);
  return rows.map((r) => {
    const p = typeof r.payload === "string" ? JSON.parse(r.payload) : (r.payload ?? {});
    return { act: Number(r.id), event: r.object, at: new Date(r.at).toISOString(), text: String(p.text ?? "") };
  });
}
const announcementsByEvent = (list) => {
  const m = new Map();
  for (const a of list) m.set(a.event, [...(m.get(a.event) ?? []), a]);
  return m;
};

async function placeFor(client, shape) {
  if (shape.at) return { mark: null, name: null, x: shape.at.x, y: shape.at.y };
  const { rows } = await client.query("SELECT slug, status, kind, geometry FROM marks WHERE slug = $1", [shape.mark]);
  return placeFromMarkRow(rows[0] ?? null, shape.mark);
}

function actRow({ action, actor, event, payload, place, now }) {
  const at = anchorForPlace(place, WORLD_ANCHOR);
  return {
    written_at: new Date(now).toISOString(), crossing: currentCrossing(now),
    actor, action, object: event,
    at_anchor: at.anchor, at_dx: at.dx, at_dy: at.dy, witnesses: null,
    class: EVENT_CLASS, payload: JSON.stringify(payload),
    effect: null, household: actor,   // insertAct resolves the household from the actor's handle
  };
}

const placeOfRow = (r) => ({ mark: r.place_mark, x: r.place_x, y: r.place_y });

async function insertPost(client, r) {
  await client.query(
    `INSERT INTO posts (${POST_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [r.id, r.class, r.title, r.body, r.author, r.household, r.place_mark, r.place_x, r.place_y,
     r.starts, r.ends, r.state, JSON.stringify(r.fields ?? {}), r.revised, r.posted_act, r.last_act]);
}
async function updatePost(client, r) {
  await client.query(
    `UPDATE posts SET title = $2, body = $3, place_mark = $4, place_x = $5, place_y = $6,
            starts = $7, ends = $8, state = $9, fields = $10, revised = $11, last_act = $12
      WHERE id = $1`,
    [r.id, r.title, r.body, r.place_mark, r.place_x, r.place_y,
     r.starts, r.ends, r.state, JSON.stringify(r.fields ?? {}), r.revised, r.last_act]);
}

/** May this resident change this event? Anyone in the host's household. */
async function mayChange(client, prev, handle) {
  const hh = await householdKeyFor(client, handle);
  if (prev.author !== handle && (prev.household == null || prev.household !== hh))
    throw refuse(403, `"${prev.id}" is not yours to change`, `its host is ${prev.author}; only the host's household may amend or cancel it`);
}

// ── THE ONE PEN (POS-288) ───────────────────────────────────────────────────
//
// Both doors write through the three functions below: the household's
// `host` / `cancel-event` (the calendar's own verbs, kept for one release at
// least with their receipts unchanged) and the town's `post` / `amend` /
// `close` with class: "event". What differs between the doors is only the
// NAMES a caller reads back — the household calls the text `invitation`, the
// town calls it `body` — and the receipt's sentence. `door` says which.

const LEGACY_NAME = { body: "invitation" };
const namesFor = (door, list) => (door === "household" ? list.map((k) => LEGACY_NAME[k] ?? k) : list);

/** Put an event on the calendar: one `post` act, one `posts` row. */
async function postEvent(handle, input, { now, env, door }) {
  const text = judgeText({ title: input.title, body: input.body }, { bodyField: door === "household" ? "invitation" : "body" });
  const interval = judgeInterval(input, now);
  const shape = judgePlaceShape(input.place);
  return write(async (client) => {
    const place = await placeFor(client, shape);
    const { rows: held } = await client.query(
      "SELECT id, state, ends FROM posts WHERE id LIKE $1", [`${handle}/%`]);
    const taken = new Map(held.map((r) => [r.id, { cancelled: r.state === STATE_CANCELLED, ends: isoOrNull(r.ends) }]));
    const id = mintEventId(handle, text.title, (i) => taken.get(i) ?? null, now);
    const payload = { post: id, class: EVENT_CLASS, title: text.title, body: text.body,
      place: { mark: place.mark, x: place.x, y: place.y }, starts: interval.starts, ends: interval.ends,
      fields: { doors_open: interval.doors_open } };
    const actId = await insertAct(client, actRow({ action: ACT_POST, actor: handle, event: id, payload, place, now }));
    const household = await householdKeyFor(client, handle);
    const row = applyPostAct({ posts: new Map(), responses: new Map() },
      { id: actId, action: ACT_POST, actor: handle, object: id, payload, household });
    await insertPost(client, row);
    const where = `${place.mark ?? "a point"} (${place.x}, ${place.y}), ${interval.starts} to ${interval.ends}`;
    return door === "household"
      ? { event: eventView(row, [], now), act_id: actId, receipt: `hosted: ${id}, at ${where}`, read: READ_HINT(id) }
      : { post: eventView(row, [], now), act_id: actId, receipt: `posted: ${id} (an event), at ${where}`, read: POST_READ_HINT(id) };
  }, env);
}

// The amendment's fields, in the order its `changed` list names them.
const AMENDABLE = ["title", "body", "place", "doors_open", "starts", "ends"];

/** Amend an event: one `amend` act carrying ONLY the fields that change. */
async function amendEvent(handle, id, input, { now, env, door }) {
  const bodyField = door === "household" ? "invitation" : "body";
  const text = judgeText({ title: input.title, body: input.body }, { partial: true, bodyField });
  const shape = input.place !== undefined ? judgePlaceShape(input.place) : null;
  return write(async (client) => {
    const prev = await eventRow(client, id);
    if (!prev) throw refuse(404, `no event "${id}"`, "ids are <host>/<slug>, as the calendar names them — leave event: off to host a new one");
    await mayChange(client, prev, handle);
    if (prev.state === STATE_CANCELLED) throw refuse(409, `"${id}" was cancelled`, "a cancelled event is not amended — host a new one");
    if (Date.parse(prev.ends) <= now) throw refuse(409, `"${id}" has ended`, "an ended event is not amended — host a new one");
    // THE DOORS STAY WHERE THEY STAND unless they are sent (Keemin through
    // Wright, 2026-09-28, POS-288 D5). An amendment that moves `starts` used
    // to reset `doors_open` to the new start, changing a field it was not
    // sent. Now the kept doors must still open at or before the new start, or
    // the amendment is refused and asks for them.
    const keptDoors = doorsOf(prev);
    if (input.doors_open === undefined && input.starts !== undefined) {
      const s = judgeInterval({ starts: input.starts, ends: input.ends ?? prev.ends }, now).starts;
      if (Date.parse(keptDoors) > Date.parse(s))
        throw refuse(422, "the doors would open after the new start",
          `doors_open stands at ${keptDoors}, after the new starts (${s}) — send doors_open too, at or before starts`, { field: "doors_open" });
    }
    const interval = judgeInterval({
      doors_open: input.doors_open !== undefined ? input.doors_open : keptDoors,
      starts: input.starts ?? prev.starts, ends: input.ends ?? prev.ends }, now);
    const place = shape ? await placeFor(client, shape) : placeOfRow(prev);
    const now_ = { title: text.title ?? prev.title, body: text.body ?? prev.body, place,
      doors_open: interval.doors_open, starts: interval.starts, ends: interval.ends };
    const was = { title: prev.title, body: prev.body, place: placeOfRow(prev), doors_open: keptDoors, starts: prev.starts, ends: prev.ends };
    const same = (k) => (k === "place"
      ? now_.place.mark === was.place.mark && now_.place.x === was.place.x && now_.place.y === was.place.y
      : now_[k] === was[k]);
    const changed = AMENDABLE.filter((k) => !same(k));
    if (!changed.length) throw refuse(422, "nothing to amend", `every field you sent already stands on "${id}"`);
    const payload = { post: id, changed };
    for (const k of changed) {
      if (k === "doors_open") payload.fields = { doors_open: now_.doors_open };
      else if (k === "place") payload.place = { mark: place.mark, x: place.x, y: place.y };
      else payload[k] = now_[k];
    }
    const actId = await insertAct(client, actRow({ action: ACT_AMEND_POST, actor: handle, event: id, payload, place, now }));
    const row = applyPostAct({ posts: new Map([[id, prev]]), responses: new Map() },
      { id: actId, action: ACT_AMEND_POST, actor: handle, object: id, payload, household: prev.household });
    await updatePost(client, row);
    const view = eventView(row, await rsvpHandles(client, id), now, await announcementsOf(client, [id]));
    const amended = namesFor(door, changed);
    return door === "household"
      ? { event: view, act_id: actId, amended,
          receipt: `amended: ${id} (${amended.join(", ")}) — revision ${row.revised}, visible on the calendar as one`, read: READ_HINT(id) }
      : { post: view, act_id: actId, amended,
          receipt: `amended: ${id} (${amended.join(", ")}) — revision ${row.revised}; only these fields changed, and the act log keeps every revision`, read: POST_READ_HINT(id) };
  }, env);
}

/** Close an event: one `close` act; it stands on the calendar as cancelled. */
async function closeEvent(handle, id, { now, env, door }) {
  return write(async (client) => {
    const prev = await eventRow(client, id);
    if (!prev) throw refuse(404, `no event "${id}"`, "ids are <host>/<slug>, as the calendar names them");
    await mayChange(client, prev, handle);
    if (prev.state === STATE_CANCELLED) throw refuse(409, `"${id}" is already cancelled`, "nothing to do");
    if (Date.parse(prev.ends) <= now) throw refuse(409, `"${id}" has ended`, "an ended event is not cancelled — it happened");
    const payload = { post: id, state: STATE_CANCELLED };
    const actId = await insertAct(client, actRow({ action: ACT_CLOSE, actor: handle, event: id, payload, place: placeOfRow(prev), now }));
    const row = applyPostAct({ posts: new Map([[id, prev]]), responses: new Map() },
      { id: actId, action: ACT_CLOSE, actor: handle, object: id, payload, household: prev.household });
    await updatePost(client, row);
    const view = eventView(row, await rsvpHandles(client, id), now, await announcementsOf(client, [id]));
    return door === "household"
      ? { event: view, act_id: actId, receipt: `cancelled: ${id} — it stays on the calendar, marked cancelled, and its id is not reused`, read: READ_HINT(id) }
      : { post: view, act_id: actId, state: STATE_CANCELLED,
          receipt: `closed: ${id} — an event closes as cancelled; it stays on the calendar, marked cancelled, and its id is not reused`, read: POST_READ_HINT(id) };
  }, env);
}

// ── host, and host with `event` (the amendment) · the household door ────────

export async function hostAtOffice(fields, key, { now = Date.now(), env = process.env } = {}) {
  const handle = standpointHandle(fields, key);
  const input = { title: fields.title, body: fields.invitation, place: fields.place,
    doors_open: fields.doors_open, starts: fields.starts, ends: fields.ends };
  if (fields.event != null && String(fields.event).trim() !== "")
    return amendEvent(handle, String(fields.event).trim(), input, { now, env, door: "household" });
  return postEvent(handle, input, { now, env, door: "household" });
}

// ── cancel-event · the household door ───────────────────────────────────────

export async function cancelAtOffice(fields, key, { now = Date.now(), env = process.env } = {}) {
  const handle = standpointHandle(fields, key);
  const id = String(fields.event ?? "").trim();
  if (!id) throw refuse(422, "which event?", 'event: "<host>/<slug>", as the calendar names it', { field: "event" });
  return closeEvent(handle, id, { now, env, door: "household" });
}

// ── the town door: post · amend · close · advance (POS-288, POS-294) ───────
//
// `town { do: "post" | "amend" | "close" | "advance", args: { class, … } }`.
// These answer class "event", class "quest" and class "bug"; town-post.mjs
// routes every other class where it went before (an idea is still a mark at
// the Think Tank until POS-290).

const POST_MACHINE_CLASSES = [EVENT_CLASS, QUEST_CLASS, BUG_CLASS];

function judgeClass(fields, { required }) {
  const c = fields.class == null ? "" : String(fields.class).trim();
  if (!c && required) throw refuse(422, "post needs a class", 'class: "event" puts it on the calendar; class: "quest" is the town\'s own; class: "bug" reports something broken', { field: "class" });
  if (c && !POST_MACHINE_CLASSES.includes(c)) throw refuse(422, `this act answers class "event", "quest" or "bug", not "${c}"`, "the post machine's classes join it one by one", { field: "class" });
  return c || null;
}
function postId(fields) {
  const id = String(fields.post ?? "").trim();
  if (!id) throw refuse(422, "which post?", 'post: "<author>/<slug>", as town { read: "posts" } names it', { field: "post" });
  return id;
}
/** `invitation` is the calendar's word for the body; it is taken as one, never beside it. */
function bodyOf(fields) {
  if (fields.body !== undefined && fields.invitation !== undefined)
    throw refuse(422, "body and invitation are the same field", "send one — body is the post's word, invitation the calendar's", { field: "body" });
  return fields.body !== undefined ? fields.body : fields.invitation;
}

/**
 * The class of the post an act names, when the caller did not send one. Only
 * "is it a quest" and "is it a bug" are asked: every other post goes the event
 * path, which answers its own "no event", exactly as it did before they joined.
 */
async function classOf(fields, id, env) {
  const c = judgeClass(fields, { required: false });
  if (c) return c;
  return read(async (client) => ((await questRow(client, id)) ? QUEST_CLASS
    : (await bugRow(client, id)) ? BUG_CLASS : EVENT_CLASS), env);
}

export async function postAtTown(fields, key, { now = Date.now(), env = process.env, registry = undefined, roll = null } = {}) {
  const cls = judgeClass(fields, { required: true });
  if (cls === QUEST_CLASS) return postQuest(fields, key, { now, env, registry });
  if (cls === BUG_CLASS) return postBug(fields, key, { now, env, roll });
  const handle = standpointHandle(fields, key);
  return postEvent(handle, { title: fields.title, body: bodyOf(fields), place: fields.place,
    doors_open: fields.doors_open, starts: fields.starts, ends: fields.ends }, { now, env, door: "town" });
}

export async function amendAtTown(fields, key, { now = Date.now(), env = process.env } = {}) {
  const id = postId(fields);
  const cls = await classOf(fields, id, env);
  if (cls === QUEST_CLASS) throw QUEST_NO_AMEND();
  if (cls === BUG_CLASS) return amendBug(fields, key, id, { now, env });
  const handle = standpointHandle(fields, key);
  return amendEvent(handle, id, { title: fields.title, body: bodyOf(fields), place: fields.place,
    doors_open: fields.doors_open, starts: fields.starts, ends: fields.ends }, { now, env, door: "town" });
}

export async function closeAtTown(fields, key, { now = Date.now(), env = process.env } = {}) {
  const id = postId(fields);
  const cls = await classOf(fields, id, env);
  if (cls === QUEST_CLASS) return closeQuest(fields, key, id, { now, env });
  if (cls === BUG_CLASS) throw BUG_NO_CLOSE(id);
  const handle = standpointHandle(fields, key);
  return closeEvent(handle, id, { now, env, door: "town" });
}

/**
 * `advance` moves a post along its class's lifecycle. An event has no such
 * move: its phases (announced · doors-open · underway · ended) follow its
 * clock, and its only act-made state beyond announced is cancelled, which is
 * `close`. A quest's one move is `close` too. A bug is the class that
 * advances (bugs.mjs), by the town's hands.
 */
export async function advanceAtTown(fields, key, { now = Date.now(), env = process.env, roll = null } = {}) {
  const id = postId(fields);
  const cls = await classOf(fields, id, env);
  if (cls === QUEST_CLASS) throw QUEST_NO_ADVANCE();
  if (cls === BUG_CLASS) return advanceBug(fields, key, id, { now, env, roll });
  standpointHandle(fields, key);
  throw refuse(422, "an event's phases follow its clock",
    "announced, doors-open, underway and ended are read from its times — amend them to move it; close it to cancel it", { field: "to" });
}

// ── the quest class (POS-294): the town posts and closes, the act names the hand
//
// The act is the pen's: `actor` is postmark-pen, so the one fold makes the
// row's author the pen and its household the pen's (hh:the-town) with no
// special case, and `payload.hand` is the resident whose key did it. A quest
// has no place and no span, so the act is anchorless, like an enter or an exit.

async function questRow(client, id) {
  const { rows } = await client.query(`SELECT ${POST_COLUMNS} FROM posts WHERE id = $1 AND class = $2`, [id, QUEST_CLASS]);
  return rowOf(rows[0]);
}

function questActRow({ action, object, payload, now }) {
  return {
    written_at: new Date(now).toISOString(), crossing: currentCrossing(now),
    actor: QUEST_AUTHOR, action, object,
    at_anchor: null, at_dx: null, at_dy: null, witnesses: null,
    class: QUEST_CLASS, payload: JSON.stringify(payload),
    effect: null, household: QUEST_AUTHOR,   // insertAct resolves the pen's house
  };
}

const questReadHint = (id) => `town { read: "posts", args: { class: "quest", post: "${id}" } } — or GET /posts/${id}`;
const questAnswer = (row) => ({ id: row.id, class: QUEST_CLASS, author: row.author, household: row.household ?? null, state: row.state, fields: row.fields });

/** Put a registry quest up as the town's post: one `post` act, one `posts` row. */
async function postQuest(fields, key, { now, env, registry }) {
  const hand = judgeQuestHand(fields, key);
  let reg = registry;
  if (reg === undefined) reg = (await import("./town-posts.mjs")).questRegistryAtOffice();
  const entry = judgeQuestEntry(reg, fields.quest);
  const id = questPostId(entry.id);
  return write(async (client) => {
    const prev = await questRow(client, id);
    if (prev) throw refuse(409, `"${id}" is already posted`, `it stands ${prev.state}; a quest is posted once, and its id is never reused`, { post: id });
    const payload = { post: id, class: QUEST_CLASS, title: String(entry.title ?? entry.id), body: String(entry.source ?? ""),
      state: STATE_OPEN, fields: { quest: entry.id }, hand };
    const actId = await insertAct(client, questActRow({ action: ACT_POST, object: id, payload, now }));
    const household = await householdKeyFor(client, QUEST_AUTHOR);
    const row = applyPostAct({ posts: new Map(), responses: new Map() },
      { id: actId, action: ACT_POST, actor: QUEST_AUTHOR, object: id, payload, household });
    await insertPost(client, row);
    return { post: questAnswer(row), act_id: actId, hand,
      receipt: `posted: ${id} (a quest), the town's post by ${hand}'s hand; its terms are the registry's "${entry.id}"`,
      read: questReadHint(id) };
  }, env);
}

/** Close a town quest: one `close` act naming the hand; it stays, marked closed. */
async function closeQuest(fields, key, id, { now, env }) {
  const hand = judgeQuestHand(fields, key);
  return write(async (client) => {
    const prev = await questRow(client, id);
    if (!prev) throw refuse(404, `no quest "${id}"`, 'town { read: "posts", args: { class: "quest" } } lists them');
    if (prev.state === STATE_CLOSED) throw refuse(409, `"${id}" is already closed`, "nothing to do");
    const payload = { post: id, state: STATE_CLOSED, hand };
    const actId = await insertAct(client, questActRow({ action: ACT_CLOSE, object: id, payload, now }));
    const row = applyPostAct({ posts: new Map([[id, prev]]), responses: new Map() },
      { id: actId, action: ACT_CLOSE, actor: QUEST_AUTHOR, object: id, payload, household: prev.household });
    await updatePost(client, row);
    return { post: questAnswer(row), act_id: actId, hand, state: STATE_CLOSED,
      receipt: `closed: ${id} by ${hand}'s hand; a closed quest stays on the record, marked closed, and its id is never reused`,
      read: questReadHint(id) };
  }, env);
}

/**
 * THE SEEDING, run once by the town (world2/tools/quests-post.mjs): every
 * registry quest that is not yet a post is posted by the named hand, through
 * the same pen as the door. A quest already posted, open or closed, is left
 * alone, so a second run posts nothing. `dryRun` reads and writes nothing.
 */
export async function seedQuestPosts({ hand, registry, now = Date.now(), env = process.env, dryRun = false }) {
  const key = { handles: new Set([hand]) };
  judgeQuestHand({ handle: hand }, key);
  if (!registry) throw refuse(503, "the quest registry could not be read", "nothing was written");
  const posted = await read(async (client) => {
    const { rows } = await client.query("SELECT id, state FROM posts WHERE class = $1 ORDER BY id", [QUEST_CLASS]);
    return new Map(rows.map((r) => [r.id, r.state]));
  }, env);
  const out = { hand, posted: [], already: [], would_post: [] };
  for (const q of questEntries(registry)) {
    const id = questPostId(q.id);
    if (posted.has(id)) { out.already.push(id); continue; }
    if (dryRun) { out.would_post.push(id); continue; }
    const r = await postQuest({ class: QUEST_CLASS, quest: q.id, handle: hand }, key, { now, env, registry });
    out.posted.push({ id, act_id: r.act_id });
  }
  return out;
}

// ── the bug class (Posts phase 2): any resident posts, the town's hands move it
//
// A bug's acts are anchorless, like a quest's: it has no place and no span. The
// act's actor is who did it. A post names its reporter as the actor (so the one
// fold makes them the author and their household the post's), and when a hand
// put it up on their behalf the payload names the hand. An amend or an advance
// names its own actor; an advance, and an amend by anyone but the reporter,
// also carries `hand` in the payload, so every act a hand made says so in the
// same field.

async function bugRow(client, id) {
  const { rows } = await client.query(`SELECT ${POST_COLUMNS} FROM posts WHERE id = $1 AND class = $2`, [id, BUG_CLASS]);
  return rowOf(rows[0]);
}

function bugActRow({ action, actor, object, payload, now }) {
  return {
    written_at: new Date(now).toISOString(), crossing: currentCrossing(now),
    actor, action, object,
    at_anchor: null, at_dx: null, at_dy: null, witnesses: null,
    class: BUG_CLASS, payload: JSON.stringify(payload),
    effect: null, household: actor,   // insertAct resolves the actor's house
  };
}

const bugReadHint = (id) => `town { read: "posts", args: { class: "bug", post: "${id}" } } — or GET /posts/${id}?class=bug`;
const bugAnswer = (row) => ({ id: row.id, class: BUG_CLASS, title: row.title, body: row.body, author: row.author,
  household: row.household ?? null, state: row.state, fields: row.fields });

/** The id a new bug takes: `<reporter>/<slug>` from its title, never reused (`-2`, `-3`, … while held). */
function mintBugId(reporter, title, held) {
  const slug = slugFromTitle(title);
  if (!slug) throw refuse(422, "the title mints no id", "a bug's id is <reporter>/<slug>, and the slug comes from the title's letters and digits — give the title at least one", { field: "title" });
  const base = `${reporter}/${slug}`;
  if (!held.has(base)) return base;
  for (let n = 2; n < 1000; n++) if (!held.has(`${base}-${n}`)) return `${base}-${n}`;
  throw refuse(409, `"${base}" has been used too many times`, "give this bug a different title");
}

/** Post a bug: one `post` act, one `posts` row, reported. */
async function postBug(fields, key, { now, env, roll }) {
  if (fields.stamps !== undefined) throw BUG_NO_STAKE();
  let reporter;
  let hand = null;
  if (fields.for !== undefined) {
    hand = judgeBugHand(fields, key, { act: "post a bug on a resident's behalf" });
    reporter = judgeHandleField("for", fields.for, roll);
  } else {
    reporter = standpointHandle(fields, key);
  }
  const text = judgeBugText({ title: fields.title, body: fields.body, issue: fields.issue, steps: fields.steps, record: fields.record });
  return write(async (client) => {
    const { rows } = await client.query("SELECT id, state, ends FROM posts WHERE id LIKE $1", [`${reporter}/%`]);
    const id = mintBugId(reporter, text.title, new Set(rows.map((r) => r.id)));
    const payload = { post: id, class: BUG_CLASS, title: text.title, body: text.body, state: STATE_REPORTED,
      fields: text.fields, ...(hand ? { hand } : {}) };
    const actId = await insertAct(client, bugActRow({ action: ACT_POST, actor: reporter, object: id, payload, now }));
    const household = await householdKeyFor(client, reporter);
    const row = applyPostAct({ posts: new Map(), responses: new Map() },
      { id: actId, action: ACT_POST, actor: reporter, object: id, payload, household });
    await insertPost(client, row);
    return { post: bugAnswer(row), act_id: actId, ...(hand ? { hand } : {}),
      receipt: `posted: ${id} (a bug), reported by ${reporter}${hand ? `, put up by ${hand}'s hand` : ""}. `
        + `The town's hands (${BUG_HANDS.join(", ")}) confirm it; each stage then pays the flat ladder to whoever did it (${reporter} is credited at confirmed), `
        + "paid by a reviewed pass, never by the act itself. A bug takes no stake.",
      read: bugReadHint(id) };
  }, env);
}

/**
 * Amend a bug: its reporter until it is confirmed, the hands after. Only what
 * changes is recorded. `issue` is amendable too (Wright's ruling on #257): a
 * discussion opened after the post has to be linkable.
 */
async function amendBug(fields, key, id, { now, env }) {
  if (fields.stamps !== undefined) throw BUG_NO_STAKE(id);
  const acting = standpointHandle(fields, key);
  const text = judgeBugText({ title: fields.title, body: fields.body, issue: fields.issue, steps: fields.steps, record: fields.record }, { partial: true });
  return write(async (client) => {
    const prev = await bugRow(client, id);
    if (!prev) throw refuse(404, `no bug "${id}"`, 'town { read: "posts", args: { class: "bug" } } lists them');
    const isHand = BUG_HANDS.includes(acting);
    // A finished bug takes one amendment only: a hand linking its discussion (issue), at any stage.
    const onlyIssue = Object.keys(text.fields).length === 1 && text.fields.issue !== undefined && text.title === undefined && text.body === undefined;
    if (BUG_FINISHED.includes(prev.state) && !(isHand && onlyIssue))
      throw refuse(409, `"${id}" is finished (${prev.state})`, `a finished bug is not amended — post a new one if it came back; the town's hands may still link its issue`);
    if (!isHand && acting !== prev.author)
      throw refuse(403, `"${id}" is not yours to amend`, `its reporter is ${prev.author}; after them, only the town's hands (${BUG_HANDS.join(", ")}) amend a bug`);
    if (!isHand && prev.state !== STATE_REPORTED)
      throw refuse(409, `"${id}" is ${prev.state}, so only the town's hands amend it now`,
        `a reporter amends until the bug is confirmed; tell ${BUG_HANDS.join(", ")} what changed, by letter`);
    const now_ = { title: text.title ?? prev.title, body: text.body ?? prev.body, ...prev.fields, ...text.fields };
    const was = { title: prev.title, body: prev.body, ...prev.fields };
    const changed = ["title", "body", "issue", "steps", "record"].filter((k) => k in now_ && now_[k] !== was[k]);
    if (!changed.length) throw refuse(422, "nothing to amend", `every field you sent already stands on "${id}"`);
    const payload = { post: id, changed };
    for (const k of changed) {
      if (k === "title" || k === "body") payload[k] = now_[k];
      else (payload.fields ??= {})[k] = now_[k];
    }
    if (acting !== prev.author) payload.hand = acting;
    const actId = await insertAct(client, bugActRow({ action: ACT_AMEND_POST, actor: acting, object: id, payload, now }));
    const row = applyPostAct({ posts: new Map([[id, prev]]), responses: new Map() },
      { id: actId, action: ACT_AMEND_POST, actor: acting, object: id, payload, household: prev.household });
    await updatePost(client, row);
    return { post: bugAnswer(row), act_id: actId, amended: changed,
      receipt: `amended: ${id} (${changed.join(", ")}) — revision ${row.revised}; only these fields changed, and the act log keeps every revision`,
      read: bugReadHint(id) };
  }, env);
}

/** Advance a bug: one `advance` act by a town hand, naming the stage and whom it credits. It mints nothing. */
async function advanceBug(fields, key, id, { now, env, roll }) {
  if (fields.stamps !== undefined) throw BUG_NO_STAKE(id);
  const hand = judgeBugHand(fields, key, { act: "advance a bug" });
  return write(async (client) => {
    const prev = await bugRow(client, id);
    if (!prev) throw refuse(404, `no bug "${id}"`, 'town { read: "posts", args: { class: "bug" } } lists them');
    const j = judgeAdvance(fields, prev, roll);
    if (j.of && !(await bugRow(client, j.of)))
      throw refuse(404, `no bug "${j.of}" to be a duplicate of`, 'of: a standing bug post — town { read: "posts", args: { class: "bug" } } lists them', { field: "of" });
    // The critter's namer is the fix's credit, kept beside the name so the post says who named it.
    const set = { ...(j.size ? { size: j.size } : {}), ...(j.critter ? { critter: j.critter, named_by: j.credit } : {}),
      ...(j.grade ? { grade: j.grade } : {}), ...(j.of ? { of: j.of } : {}) };
    const payload = { post: id, from: prev.state, to: j.to, ...(j.credit ? { credit: j.credit } : {}),
      ...(Object.keys(set).length ? { fields: set } : {}), hand };
    const actId = await insertAct(client, bugActRow({ action: ACT_ADVANCE, actor: hand, object: id, payload, now }));
    const row = applyPostAct({ posts: new Map([[id, prev]]), responses: new Map() },
      { id: actId, action: ACT_ADVANCE, actor: hand, object: id, payload, household: prev.household });
    await updatePost(client, row);
    const from = BUG_STAGES.indexOf(prev.state);
    const at = BUG_STAGES.indexOf(j.to);
    const skipped = at > from ? BUG_STAGES.slice(from + 1, at).filter((s) => BUG_LADDER[s]) : [];
    const n = stageAmount(j.to, j);
    const pays = BUG_LADDER[j.to]
      ? `the ladder owes ${j.credit} ${n} stamps for ${j.to}, paid by the reviewed stage pass (not by this act), subject to the town's meep law and, at confirmed, three paid reports per household a week`
      : `${j.to} pays nothing`;
    return { post: bugAnswer(row), act_id: actId, hand, stage: j.to, ...(j.credit ? { credit: j.credit } : {}), stamps: n,
      ...(j.critter ? { critter: j.critter } : {}),
      receipt: `advanced: ${id} ${prev.state} → ${j.to} by ${hand}'s hand; ${pays}${skipped.length ? `; skipped ${skipped.join(", ")}, and a skipped stage pays nothing` : ""}${j.critter ? `; its critter is "${j.critter}", named by ${j.credit}` : ""}`,
      read: bugReadHint(id) };
  }, env);
}

/** Is this id a bug post? For the stake door's refusal; a store that cannot be read answers no. */
export async function isBugPost(id, { env = process.env } = {}) {
  try { return Boolean(await officeRead((client) => bugRow(client, String(id)), { env })); }
  catch { return false; }
}

// ── rsvp (POS-208 B) ────────────────────────────────────────────────────────

function standingOrRefuse(prev, id, now) {
  if (!prev) throw refuse(404, `no event "${id}"`, "ids are <host>/<slug>, as the calendar names them");
  if (prev.state === STATE_CANCELLED) throw refuse(409, `"${id}" was cancelled`, "there is nothing to RSVP to");
  if (Date.parse(prev.ends) <= now) throw refuse(409, `"${id}" has ended`, "there is nothing to RSVP to");
}

export async function rsvpAtOffice(fields, key, { now = Date.now(), env = process.env, fetchImpl = globalThis.fetch, nonce = null, mintSecret = null } = {}) {
  const handle = standpointHandle(fields, key);
  const id = String(fields.event ?? "").trim();
  if (!id) throw refuse(422, "which event?", 'event: "<host>/<slug>", as the calendar names it', { field: "event" });
  const judged = judgeRsvp(fields);

  // The household's spelling set is declared on every transaction below, so the
  // row policy on `household_harnesses` shows this resident's own row and no
  // other. The event is read BEFORE the challenge: no URL is called for an
  // event that does not stand, and none is called twice for one registration.
  const household = await read((c) => householdKeyFor(c, handle), env);
  const before = await write(async (client) => {
    const ev = await eventRow(client, id);
    standingOrRefuse(ev, id, now);
    return harnessRow(client, handle);
  }, env, household);

  let harness = judged.harness;
  let plan = harnessPlan(before, harness);
  let fell_back = null;
  let secret = null;
  if (plan === "register" && harness.kind === "webhook") {
    const { randomBytes } = await import("node:crypto");
    const n = nonce ?? randomBytes(16).toString("hex");
    const ch = await challengeWebhook(harness.address, n, { fetchImpl });
    if (!ch.echoed) { fell_back = FELL_BACK_NO_ECHO; harness = { kind: "mail", address: null }; plan = "none"; }
    else secret = mintSecret ? mintSecret() : randomBytes(SECRET_BYTES).toString("hex");
  }

  return write(async (client) => {
    const prev = await eventRow(client, id);
    standingOrRefuse(prev, id, now);
    // THE ACT CARRIES NO ADDRESS AND NO SECRET. `acts` leaves the box through
    // the notary's public export; a webhook url and its
    // secret are the resident's, and live only on their harness row
    // (026_events.sql § THE HARNESS ROW).
    const payload = { event: id, harness: harness.kind, budget: judged.budget, ...(fell_back ? { fell_back } : {}) };
    const actId = await insertAct(client, actRow({ action: ACT_RSVP, actor: handle, event: id, payload, place: placeOfRow(prev), now }));
    if (plan === "register") await registerHarness(client, { handle, household, kind: harness.kind, address: harness.address, secret, now });
    const row = applyPostAct({ posts: new Map(), responses: new Map() },
      { id: actId, action: ACT_RSVP, actor: handle, object: id, payload, household });
    await client.query(
      `INSERT INTO responses (post, handle, household, kind, state, fields, act)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (post, handle, kind) DO UPDATE SET household = EXCLUDED.household, state = EXCLUDED.state,
         fields = EXCLUDED.fields, act = EXCLUDED.act`,
      [row.post, row.handle, row.household, RESPONSE_RSVP, RESPONSE_STANDING, JSON.stringify(row.fields), row.act]);
    const kind = row.fields.harness;
    const budget = row.fields.budget;
    // Mail is not offered (2026-09-27): a non-webhook RSVP is the guest list,
    // and its receipt names no harness.
    const shownHarness = kind === "webhook" ? { kind: "webhook", url: harness.address } : null;
    return {
      event: id, handle, act_id: actId,
      harness: shownHarness,
      ...(fell_back ? { fell_back } : {}),
      ...(secret ? { secret, secret_note: SECRET_NOTE } : {}),
      ...(plan === "reuse" && kind === "webhook" ? { harness_note: HARNESS_REUSED_NOTE } : {}),
      budget,
      ...(kind === "webhook" ? { budget_note: `at most ${budget} wake${budget === 1 ? "" : "s"} for this event (default ${BUDGET_DEFAULT}, most ${BUDGET_MAX}), sent only while its doors are open` } : {}),
      wakes_note: wakesNote({ kind, event: legacyEvent(prev), enabled: earpieceEnabled(env) }),
      receipt: fell_back
        ? `RSVPed to ${id}: the webhook was not registered (${fell_back}), so you are on the guest list with no wakes`
        : kind === "webhook" ? `RSVPed to ${id}, with an experimental webhook` : `RSVPed to ${id}: you are on the guest list`,
      read: READ_HINT(id),
    };
  }, env, household);
}

/** A `posts` row in the calendar's 026 names, for the readers that still speak them (the earpiece's notes). */
function legacyEvent(row) {
  return { id: row.id, title: row.title, invitation: row.body, host: row.author, household: row.household,
    place_mark: row.place_mark, place_x: row.place_x, place_y: row.place_y,
    doors_open: doorsOf(row), starts: row.starts, ends: row.ends, revised: row.revised,
    cancelled: row.state === STATE_CANCELLED };
}

// ── announce (POS-227) ──────────────────────────────────────────────────────
//
// The HOST speaks to everyone attending. Only the host: not their household,
// which may amend and cancel, because an announcement is a voice and the
// voice is the one accountable resident's (the event's `host`). From the
// event's creation until it ends; never on a cancelled one. Uncapped unless
// the office sets ANNOUNCE_MAX. The earpiece delivers it (earpiece.mjs §
// THE ANNOUNCEMENT); this act only records it.

export async function announceAtOffice(fields, key, { now = Date.now(), env = process.env } = {}) {
  const handle = standpointHandle(fields, key);
  const id = String(fields.event ?? "").trim();
  if (!id) throw refuse(422, "which event?", 'event: "<host>/<slug>", as the calendar names it', { field: "event" });
  const text = judgeAnnouncement(fields.text);
  const max = announceMax(env);
  return write(async (client) => {
    const prev = await eventRow(client, id);
    if (!prev) throw refuse(404, `no event "${id}"`, "ids are <host>/<slug>, as the calendar names them");
    if (prev.author !== handle)
      throw refuse(403, `only the host announces on "${id}"`, `its host is ${prev.author}; ${handle} may say something at its place instead`);
    if (prev.state === STATE_CANCELLED) throw refuse(409, `"${id}" was cancelled`, "a cancelled event takes no announcements");
    if (Date.parse(prev.ends) <= now) throw refuse(409, `"${id}" has ended`, "an ended event takes no announcements");
    const before = await announcementsOf(client, [id]);
    if (before.length >= max)
      throw refuse(409, `"${id}" already carries ${before.length} announcement${before.length === 1 ? "" : "s"}, the most this office allows`, `the office's ${ANNOUNCE_MAX_ENV} dial is ${max}`);
    const payload = { event: id, text };
    const actId = await insertAct(client, actRow({ action: ACT_ANNOUNCE, actor: handle, event: id, payload, place: placeOfRow(prev), now }));
    const attending = (await rsvpHandles(client, id)).filter((h) => h !== handle);
    const n = before.length + 1;
    return {
      event: id, handle, act_id: actId,
      announcement: { n, at: new Date(now).toISOString(), text },
      receipt: `announced on ${id} (announcement ${n}): the earpiece wakes the ${attending.length} resident${attending.length === 1 ? "" : "s"} who RSVPed, each once, outside their wake budget`,
      read: READ_HINT(id),
    };
  }, env);
}

// ── the resident's harness row (POS-208, 026 § THE HARNESS ROW) ─────────────
//
// Read and written ONLY inside a transaction that declared the household's
// spelling set (`write(…, household)` above); the row policy answers nothing
// otherwise. The secret is SELECTed by nobody here: whether a registration
// matches is a question about kind and address, and the one reader that will
// need the secret is the wake delivery (POS-208 C, not built).
async function harnessRow(client, handle) {
  const { rows } = await client.query("SELECT kind, address FROM household_harnesses WHERE handle = $1", [handle]);
  return rows[0] ?? null;
}

async function registerHarness(client, { handle, household, kind, address, secret, now }) {
  const at = new Date(now).toISOString();
  await client.query(
    `INSERT INTO household_harnesses (handle, household, kind, address, secret, registered_at, rotated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NULL)
     ON CONFLICT (handle) DO UPDATE SET household = EXCLUDED.household, kind = EXCLUDED.kind,
       address = EXCLUDED.address, secret = EXCLUDED.secret, rotated_at = EXCLUDED.registered_at`,
    [handle, household, kind, address, secret, at]);
}

// ── the calendar read ───────────────────────────────────────────────────────

/**
 * `town { read: "calendar" }` — the whole calendar, or one event with `event`.
 * `town { read: "event" }` is the same read (POS-288: a class's read is its
 * posts, and the calendar is the event class's), and there the one event is
 * named `post`; either name opens it.
 */
export async function calendarAtOffice(fields = {}, { now = Date.now(), env = process.env } = {}) {
  const id = String(fields?.event ?? fields?.post ?? "").trim();
  return read(async (client) => {
    if (id) {
      const row = await eventRow(client, id);
      if (!row) throw refuse(404, `no event "${id}"`, 'ids are <host>/<slug> — town { read: "calendar" } lists them');
      return { as_of: new Date(now).toISOString(), event: eventView(row, await rsvpHandles(client, id), now, await announcementsOf(client, [id])) };
    }
    const since = new Date(now - ENDED_LIST_DAYS * 86_400_000).toISOString();
    const { rows } = await client.query(`SELECT ${POST_COLUMNS} FROM posts WHERE class = $1 AND ends > $2 ORDER BY starts, id`, [EVENT_CLASS, since]);
    const events = rows.map(rowOf);
    const byEvent = new Map();
    if (events.length) {
      const { rows: rs } = await client.query(
        "SELECT post, handle FROM responses WHERE post = ANY($1) AND kind = $2 ORDER BY post, handle", [events.map((e) => e.id), RESPONSE_RSVP]);
      for (const r of rs) byEvent.set(r.post, [...(byEvent.get(r.post) ?? []), r.handle]);
    }
    return calendarFrom(events, byEvent, now, announcementsByEvent(await announcementsOf(client, events.map((e) => e.id))));
  }, env);
}

/** Every act of one post class (the event's by default), oldest first — what the rebuild folds. */
export async function eventActs(client, cls = EVENT_CLASS) {
  const { rows } = await client.query(
    "SELECT id, actor, action, object, payload, household FROM acts WHERE class = $1 ORDER BY id", [cls]);
  return rows;
}
