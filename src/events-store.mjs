// events-store.mjs — THE CALENDAR'S PEN AND ITS READ (POS-207, POS-208).
//
// The rules are src/events.mjs's, pure. This file is where they meet the
// record: the queries, the transaction, and the four household acts plus the
// town's calendar read.
//
// ── ONE ACT, ONE TRANSACTION (the pen's R1, src/world2-pen.mjs) ─────────────
//
// Every write here is ONE `officeWrite` transaction: the store is read for
// what the act needs to know (the mark, the event), the act is inserted
// through the pen's own `insertAct`, and the row `applyEventAct` derives from
// that act is written to `events` or `event_rsvps` on the same client. An
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
import { WORLD_ANCHOR } from "./world-journal.mjs";
import {
  EVENT_CLASS, ACT_HOST, ACT_AMEND, ACT_CANCEL, ACT_RSVP, ACT_ANNOUNCE, ENDED_LIST_DAYS,
  BUDGET_DEFAULT, BUDGET_MAX, FELL_BACK_NO_ECHO, SECRET_BYTES, SECRET_NOTE, HARNESS_REUSED_NOTE,
  refuse, mintEventId, judgeInterval, judgePlaceShape, placeFromMarkRow, anchorForPlace,
  judgeText, judgeRsvp, challengeWebhook, harnessPlan, applyEventAct, eventView, calendarFrom,
  judgeAnnouncement, announceMax, ANNOUNCE_MAX_ENV,
} from "./events.mjs";

const EVENT_COLUMNS = "id, title, invitation, host, household, place_mark, place_x, place_y, doors_open, starts, ends, revised, cancelled, hosted_act, last_act";
const READ_HINT = (id) => `town { read: "calendar", args: { event: "${id}" } } — or GET /calendar/${id}`;

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

const rowOf = (r) => (r ? { ...r, place_x: Number(r.place_x), place_y: Number(r.place_y), revised: Number(r.revised),
  doors_open: new Date(r.doors_open).toISOString(), starts: new Date(r.starts).toISOString(), ends: new Date(r.ends).toISOString() } : null);

async function eventRow(client, id) {
  const { rows } = await client.query(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1`, [id]);
  return rowOf(rows[0]);
}
async function rsvpHandles(client, id) {
  const { rows } = await client.query("SELECT handle FROM event_rsvps WHERE event = $1 ORDER BY handle", [id]);
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

async function insertEvent(client, r) {
  await client.query(
    `INSERT INTO events (${EVENT_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [r.id, r.title, r.invitation, r.host, r.household, r.place_mark, r.place_x, r.place_y,
     r.doors_open, r.starts, r.ends, r.revised, r.cancelled, r.hosted_act, r.last_act]);
}
async function updateEvent(client, r) {
  await client.query(
    `UPDATE events SET title = $2, invitation = $3, place_mark = $4, place_x = $5, place_y = $6,
            doors_open = $7, starts = $8, ends = $9, revised = $10, cancelled = $11, last_act = $12
      WHERE id = $1`,
    [r.id, r.title, r.invitation, r.place_mark, r.place_x, r.place_y,
     r.doors_open, r.starts, r.ends, r.revised, r.cancelled, r.last_act]);
}

/** May this resident change this event? Anyone in the host's household. */
async function mayChange(client, prev, handle) {
  const hh = await householdKeyFor(client, handle);
  if (prev.host !== handle && (prev.household == null || prev.household !== hh))
    throw refuse(403, `"${prev.id}" is not yours to change`, `its host is ${prev.host}; only the host's household may amend or cancel it`);
}

function hostPayload(r) {
  return { event: r.id, title: r.title, invitation: r.invitation,
    place: { mark: r.place_mark, x: r.place_x, y: r.place_y },
    doors_open: r.doors_open, starts: r.starts, ends: r.ends };
}

// ── host, and host with `event` (the amendment) ─────────────────────────────

export async function hostAtOffice(fields, key, { now = Date.now(), env = process.env } = {}) {
  const handle = standpointHandle(fields, key);
  if (fields.event != null && String(fields.event).trim() !== "") return amendAtOffice(fields, handle, { now, env });
  const text = judgeText(fields);
  const interval = judgeInterval(fields, now);
  const shape = judgePlaceShape(fields.place);
  return write(async (client) => {
    const place = await placeFor(client, shape);
    const { rows: held } = await client.query(
      "SELECT id, cancelled, ends FROM events WHERE id LIKE $1", [`${handle}/%`]);
    const taken = new Map(held.map((r) => [r.id, { cancelled: r.cancelled === true, ends: new Date(r.ends).toISOString() }]));
    const id = mintEventId(handle, text.title, (i) => taken.get(i) ?? null, now);
    const payload = { event: id, ...text, place: { mark: place.mark, x: place.x, y: place.y }, ...interval };
    const actId = await insertAct(client, actRow({ action: ACT_HOST, actor: handle, event: id, payload, place, now }));
    const household = await householdKeyFor(client, handle);
    const row = applyEventAct({ events: new Map(), rsvps: new Map() },
      { id: actId, action: ACT_HOST, actor: handle, object: id, payload, household });
    await insertEvent(client, row);
    return {
      event: eventView(row, [], now), act_id: actId,
      receipt: `hosted: ${id}, at ${place.mark ?? "a point"} (${place.x}, ${place.y}), ${interval.starts} to ${interval.ends}`,
      read: READ_HINT(id),
    };
  }, env);
}

async function amendAtOffice(fields, handle, { now, env }) {
  const id = String(fields.event).trim();
  const text = judgeText(fields, { partial: true });
  const shape = fields.place !== undefined ? judgePlaceShape(fields.place) : null;
  return write(async (client) => {
    const prev = await eventRow(client, id);
    if (!prev) throw refuse(404, `no event "${id}"`, "ids are <host>/<slug>, as the calendar names them — leave event: off to host a new one");
    await mayChange(client, prev, handle);
    if (prev.cancelled) throw refuse(409, `"${id}" was cancelled`, "a cancelled event is not amended — host a new one");
    if (Date.parse(prev.ends) <= now) throw refuse(409, `"${id}" has ended`, "an ended event is not amended — host a new one");
    const interval = judgeInterval({
      doors_open: fields.doors_open !== undefined ? fields.doors_open : (fields.starts !== undefined ? undefined : prev.doors_open),
      starts: fields.starts ?? prev.starts, ends: fields.ends ?? prev.ends }, now);
    const place = shape ? await placeFor(client, shape) : { mark: prev.place_mark, x: prev.place_x, y: prev.place_y };
    const next = { ...prev, ...text, place_mark: place.mark, place_x: place.x, place_y: place.y, ...interval };
    const changed = ["title", "invitation", "place_mark", "place_x", "place_y", "doors_open", "starts", "ends"]
      .filter((k) => next[k] !== prev[k]);
    if (!changed.length) throw refuse(422, "nothing to amend", `every field you sent already stands on "${id}"`);
    const payload = { ...hostPayload(next), changed: [...new Set(changed.map((k) => (k.startsWith("place_") ? "place" : k)))] };
    const actId = await insertAct(client, actRow({ action: ACT_AMEND, actor: handle, event: id, payload, place, now }));
    const row = applyEventAct({ events: new Map([[id, prev]]), rsvps: new Map() },
      { id: actId, action: ACT_AMEND, actor: handle, object: id, payload, household: prev.household });
    await updateEvent(client, row);
    return {
      event: eventView(row, await rsvpHandles(client, id), now, await announcementsOf(client, [id])), act_id: actId, amended: payload.changed,
      receipt: `amended: ${id} (${payload.changed.join(", ")}) — revision ${row.revised}, visible on the calendar as one`,
      read: READ_HINT(id),
    };
  }, env);
}

// ── cancel-event ────────────────────────────────────────────────────────────

export async function cancelAtOffice(fields, key, { now = Date.now(), env = process.env } = {}) {
  const handle = standpointHandle(fields, key);
  const id = String(fields.event ?? "").trim();
  if (!id) throw refuse(422, "which event?", 'event: "<host>/<slug>", as the calendar names it', { field: "event" });
  return write(async (client) => {
    const prev = await eventRow(client, id);
    if (!prev) throw refuse(404, `no event "${id}"`, "ids are <host>/<slug>, as the calendar names them");
    await mayChange(client, prev, handle);
    if (prev.cancelled) throw refuse(409, `"${id}" is already cancelled`, "nothing to do");
    if (Date.parse(prev.ends) <= now) throw refuse(409, `"${id}" has ended`, "an ended event is not cancelled — it happened");
    const payload = { event: id };
    const place = { mark: prev.place_mark, x: prev.place_x, y: prev.place_y };
    const actId = await insertAct(client, actRow({ action: ACT_CANCEL, actor: handle, event: id, payload, place, now }));
    const row = applyEventAct({ events: new Map([[id, prev]]), rsvps: new Map() },
      { id: actId, action: ACT_CANCEL, actor: handle, object: id, payload, household: prev.household });
    await updateEvent(client, row);
    return {
      event: eventView(row, await rsvpHandles(client, id), now, await announcementsOf(client, [id])), act_id: actId,
      receipt: `cancelled: ${id} — it stays on the calendar, marked cancelled, and its id is not reused`,
      read: READ_HINT(id),
    };
  }, env);
}

// ── rsvp (POS-208 B) ────────────────────────────────────────────────────────

function standingOrRefuse(prev, id, now) {
  if (!prev) throw refuse(404, `no event "${id}"`, "ids are <host>/<slug>, as the calendar names them");
  if (prev.cancelled) throw refuse(409, `"${id}" was cancelled`, "there is nothing to RSVP to");
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
    // the notary's public export; a webhook url, a Letta conversation and a
    // webhook's secret are the resident's, and live only on their harness row
    // (026_events.sql § THE HARNESS ROW).
    const payload = { event: id, harness: harness.kind, budget: judged.budget, ...(fell_back ? { fell_back } : {}) };
    const place = { mark: prev.place_mark, x: prev.place_x, y: prev.place_y };
    const actId = await insertAct(client, actRow({ action: ACT_RSVP, actor: handle, event: id, payload, place, now }));
    if (plan === "register") await registerHarness(client, { handle, household, kind: harness.kind, address: harness.address, secret, now });
    const row = applyEventAct({ events: new Map(), rsvps: new Map() },
      { id: actId, action: ACT_RSVP, actor: handle, object: id, payload, household });
    await client.query(
      `INSERT INTO event_rsvps (event, handle, household, harness, budget, fell_back, act)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (event, handle) DO UPDATE SET household = EXCLUDED.household, harness = EXCLUDED.harness,
         budget = EXCLUDED.budget, fell_back = EXCLUDED.fell_back, act = EXCLUDED.act`,
      [row.event, row.handle, row.household, row.harness, row.budget, row.fell_back, row.act]);
    const shownHarness = { kind: row.harness,
      ...(row.harness === "letta" ? { conversation: harness.address } : {}),
      ...(row.harness === "webhook" ? { url: harness.address } : {}) };
    return {
      event: id, handle, act_id: actId,
      harness: shownHarness,
      ...(fell_back ? { fell_back } : {}),
      ...(secret ? { secret, secret_note: SECRET_NOTE } : {}),
      ...(plan === "reuse" && row.harness === "webhook" ? { harness_note: HARNESS_REUSED_NOTE } : {}),
      budget: row.budget,
      budget_note: `at most ${row.budget} wake${row.budget === 1 ? "" : "s"} for this event (default ${BUDGET_DEFAULT}, most ${BUDGET_MAX}); the earpiece sends them while the event's doors are open, when the office has it switched on`,
      receipt: fell_back
        ? `RSVPed to ${id} by mail: ${fell_back}, so the ferry carries it`
        : `RSVPed to ${id} by ${row.harness}`,
      read: READ_HINT(id),
    };
  }, env, household);
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
    if (prev.host !== handle)
      throw refuse(403, `only the host announces on "${id}"`, `its host is ${prev.host}; ${handle} may say something at its place instead`);
    if (prev.cancelled) throw refuse(409, `"${id}" was cancelled`, "a cancelled event takes no announcements");
    if (Date.parse(prev.ends) <= now) throw refuse(409, `"${id}" has ended`, "an ended event takes no announcements");
    const before = await announcementsOf(client, [id]);
    if (before.length >= max)
      throw refuse(409, `"${id}" already carries ${before.length} announcement${before.length === 1 ? "" : "s"}, the most this office allows`, `the office's ${ANNOUNCE_MAX_ENV} dial is ${max}`);
    const payload = { event: id, text };
    const place = { mark: prev.place_mark, x: prev.place_x, y: prev.place_y };
    const actId = await insertAct(client, actRow({ action: ACT_ANNOUNCE, actor: handle, event: id, payload, place, now }));
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

/** `town { read: "calendar" }` — the whole calendar, or one event with `event`. */
export async function calendarAtOffice(fields = {}, { now = Date.now(), env = process.env } = {}) {
  const id = String(fields?.event ?? "").trim();
  return read(async (client) => {
    if (id) {
      const row = await eventRow(client, id);
      if (!row) throw refuse(404, `no event "${id}"`, 'ids are <host>/<slug> — town { read: "calendar" } lists them');
      return { as_of: new Date(now).toISOString(), event: eventView(row, await rsvpHandles(client, id), now, await announcementsOf(client, [id])) };
    }
    const since = new Date(now - ENDED_LIST_DAYS * 86_400_000).toISOString();
    const { rows } = await client.query(`SELECT ${EVENT_COLUMNS} FROM events WHERE ends > $1 ORDER BY starts, id`, [since]);
    const events = rows.map(rowOf);
    const byEvent = new Map();
    if (events.length) {
      const { rows: rs } = await client.query(
        "SELECT event, handle FROM event_rsvps WHERE event = ANY($1) ORDER BY event, handle", [events.map((e) => e.id)]);
      for (const r of rs) byEvent.set(r.event, [...(byEvent.get(r.event) ?? []), r.handle]);
    }
    return calendarFrom(events, byEvent, now, announcementsByEvent(await announcementsOf(client, events.map((e) => e.id))));
  }, env);
}

/** Every event act, oldest first — what the rebuild folds. */
export async function eventActs(client) {
  const { rows } = await client.query(
    "SELECT id, actor, action, object, payload, household FROM acts WHERE class = $1 ORDER BY id", [EVENT_CLASS]);
  return rows;
}
