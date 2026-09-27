// earpiece-store.mjs — THE EARPIECE'S QUERIES (POS-209, Earpiece C).
//
// The rules are src/earpiece.mjs's, pure. This file is where they meet the
// record, and it is the one place the earpiece's SQL lives: the deliverer
// (world2/tools/earpiece-deliver.mjs) and the resident's read
// (`household { read: "earpiece" }`) both come through it.
//
// ── ONE HOUSEHOLD AT A TIME (026 § THE HARNESS ROW) ─────────────────────────
//
// A resident's harness row and their wakes are readable and writable only in a
// transaction that declared THAT resident's household (`officeWrite`'s R1,
// src/world2-pen.mjs: `app.household_keys` by the transaction-local
// set_config). So the deliverer never asks one cross-household question of
// either table. It reads the calendar and the RSVPs (neither has a row
// policy), groups the RSVPs by household, and opens one transaction per
// household for that household's rows.
//
// NO NETWORK INSIDE A TRANSACTION, the rsvp pen's rule (events-store.mjs §
// the challenge): a household's rows are read in one transaction, the wakes go
// out with none open, and the log rows are written in a second.
//
// ── WHAT THE TAP READS, AND WHY IT IS PUBLIC ────────────────────────────────
//
// Says are `acts` rows of class `voice`, action `say` (world.mjs § voiceEntry,
// the say lane's pen): the town's conversations page reads the same speech
// keylessly, "public the way street conversation is". Walk-ins and walk-outs
// are `acts` rows of class `frame`, action `enter` / `exit`, object the door
// (crossing-exec.mjs); the enter-exit ledger is public record on main. Neither
// query reads `claims` (a draft is a claim) or a letter, so nothing private
// can reach an envelope by this road.

import { officeRead, officeWrite } from "./world2-pen.mjs";
import { householdKeyFor } from "./world2-claims.mjs";
import { composeAnchor } from "./world-journal.mjs";
import { refuse, EVENT_CLASS, ACT_RSVP } from "./events.mjs";
import { standpointHandle, announcementsOf } from "./events-store.mjs";
import { CHARGED, KIND_NEWS, KIND_ANNOUNCEMENT } from "./earpiece.mjs";

const EVENT_COLUMNS = "id, title, host, household, place_mark, place_x, place_y, doors_open, starts, ends, cancelled";
const iso = (v) => (v == null ? null : new Date(v).toISOString());
const eventOf = (r) => ({ ...r, place_x: Number(r.place_x), place_y: Number(r.place_y),
  doors_open: iso(r.doors_open), starts: iso(r.starts), ends: iso(r.ends), cancelled: r.cancelled === true });

/** Every event that has not ended and is not cancelled. The window itself is
 *  the pure rule's to decide (earpiece.mjs § inWindow), not this query's. */
export async function candidateEvents(client, now) {
  const { rows } = await client.query(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE cancelled = false AND ends > $1 ORDER BY starts, id`, [iso(now)]);
  return rows.map(eventOf);
}

/**
 * The announcements the deliverer may owe (POS-227): every `announce` act on an
 * event that has not ended, cancelled or not (an event cancelled after its
 * host spoke still owes the words), numbered per event, plus each resident's
 * FIRST rsvp act on those events, which is what decides who was attending when
 * the host spoke (earpiece.mjs § owedAnnouncement).
 */
export async function announcedFor(client, now) {
  const { rows } = await client.query(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE ends > $1 ORDER BY starts, id`, [iso(now)]);
  const events = rows.map(eventOf);
  const said = await announcementsOf(client, events.map((e) => e.id));
  if (!said.length) return { events: [], announcements: [], firstRsvps: [] };
  const seen = new Map();
  const announcements = said.map((a) => {
    const n = (seen.get(a.event) ?? 0) + 1;
    seen.set(a.event, n);
    return { ...a, n };
  });
  const ids = [...seen.keys()];
  const { rows: rsvpActs } = await client.query(
    "SELECT id, object, actor FROM acts WHERE class = $1 AND action = $2 AND object = ANY($3) ORDER BY id",
    [EVENT_CLASS, ACT_RSVP, ids]);
  const first = new Map();
  for (const r of rsvpActs) {
    const k = `${r.object} ${r.actor}`;
    if (!first.has(k)) first.set(k, { event: r.object, handle: r.actor, act: Number(r.id) });
  }
  return { events: events.filter((e) => seen.has(e.id)), announcements, firstRsvps: [...first.values()] };
}

export async function rsvpsFor(client, eventIds) {
  if (!eventIds.length) return [];
  const { rows } = await client.query(
    "SELECT event, handle, household, harness, budget FROM event_rsvps WHERE event = ANY($1) ORDER BY event, handle", [eventIds]);
  return rows.map((r) => ({ ...r, budget: Number(r.budget) }));
}

/** The tap's raw rows for one event's place over (since, until]. */
export async function tapRows(client, event, since, until) {
  const markRow = event.place_mark
    ? (await client.query("SELECT slug, geometry FROM marks WHERE slug = $1", [event.place_mark])).rows[0] ?? null
    : null;
  const { rows: voiceActs } = await client.query(
    `SELECT actor, at, at_anchor, at_dx, at_dy, payload FROM acts
      WHERE class = 'voice' AND action = 'say' AND at > $1 AND at <= $2 ORDER BY at, id`, [since, until]);
  const anchors = [...new Set(voiceActs.map((a) => a.at_anchor).filter(Boolean))];
  const centres = new Map();
  if (anchors.length) {
    const { rows } = await client.query("SELECT slug, geometry FROM marks WHERE slug = ANY($1)", [anchors]);
    for (const r of rows) {
      const g = typeof r.geometry === "string" ? JSON.parse(r.geometry) : r.geometry;
      if (g?.at) centres.set(r.slug, { x: Number(g.at.x), y: Number(g.at.y) });
    }
  }
  const frameActs = event.place_mark
    ? (await client.query(
      `SELECT actor, action, object, at FROM acts
        WHERE class = 'frame' AND object = $1 AND action IN ('enter', 'exit') AND at > $2 AND at <= $3 ORDER BY at, id`,
      [event.place_mark, since, until])).rows
    : [];
  return { markRow, voiceActs, frameActs, compose: (p) => composeAnchor(p, (id) => centres.get(id) ?? null) };
}

// ── the household's own rows ────────────────────────────────────────────────

/** The resident's CURRENT harness, secret included: the one reader of it. */
export async function harnessOf(client, handle) {
  const { rows } = await client.query("SELECT kind, address, secret FROM household_harnesses WHERE handle = $1", [handle]);
  return rows[0] ?? null;
}

export async function wakesOf(client, event, handle) {
  const { rows } = await client.query(
    "SELECT id, kind, announcement, harness, wake_n, sent_at, status, detail, budget_left FROM earpiece_wakes WHERE event = $1 AND handle = $2 ORDER BY id DESC",
    [event, handle]);
  return rows.map((r) => ({ ...r, announcement: r.announcement == null ? null : Number(r.announcement), sent_at: iso(r.sent_at) }));
}

export async function logWake(client, w) {
  await client.query(
    `INSERT INTO earpiece_wakes (event, handle, household, harness, wake_n, sent_at, status, detail, budget_left, kind, announcement)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [w.event, w.handle, w.household, w.harness, w.wake_n, w.sent_at, w.status, w.detail ?? null, w.budget_left,
     w.kind ?? KIND_NEWS, w.announcement ?? null]);
}

// ── the store the deliverer drives ──────────────────────────────────────────

/**
 * The deliverer's port onto the record. `household(key, fn)` runs `fn` with
 * the household's own rows in ONE transaction that declared that household;
 * everything else is an ordinary read.
 */
export function pgStore({ env = process.env } = {}) {
  return {
    candidates: (now) => officeRead((c) => candidateEvents(c, now), { env }),
    rsvps: (ids) => officeRead((c) => rsvpsFor(c, ids), { env }),
    announced: (now) => officeRead((c) => announcedFor(c, now), { env }),
    tap: (event, since, until) => officeRead((c) => tapRows(c, event, since, until), { env }),
    household: (key, fn) => officeWrite((c) => fn({
      harness: (handle) => harnessOf(c, handle),
      wakes: (event, handle) => wakesOf(c, event, handle),
      log: (w) => logWake(c, w),
    }), { env, household: key }),
  };
}

// ── household { read: "earpiece" } ──────────────────────────────────────────

/**
 * The resident's own wakes for one event, newest first, with what is left of
 * the budget. Read inside the resident's household transaction, so the row
 * policy is what keeps it theirs.
 */
export async function earpieceAtOffice(fields, key, { env = process.env } = {}) {
  const handle = standpointHandle(fields, key);
  const event = String(fields?.event ?? "").trim();
  if (!event) throw refuse(422, "which event?", 'event: "<host>/<slug>", as the calendar names it', { field: "event" });
  try {
    const household = await officeRead((c) => householdKeyFor(c, handle), { env });
    return await officeWrite(async (c) => {
      const { rows: rs } = await c.query("SELECT harness, budget FROM event_rsvps WHERE event = $1 AND handle = $2", [event, handle]);
      if (!rs.length) throw refuse(404, `${handle} has not RSVPed to "${event}"`, 'household { do: "rsvp", args: { event } } — and town { read: "calendar" } names the events');
      const wakes = await wakesOf(c, event, handle);
      const budget = Number(rs[0].budget);
      const used = wakes.filter((w) => w.kind !== KIND_ANNOUNCEMENT && CHARGED.includes(w.status)).length;
      return {
        event, handle, harness: rs[0].harness, budget, budget_left: Math.max(0, budget - used),
        wakes: wakes.map((w) => ({ kind: w.kind ?? KIND_NEWS, wake_n: w.wake_n, sent_at: w.sent_at, status: w.status, harness: w.harness,
          budget_left: w.budget_left, ...(w.detail ? { detail: w.detail } : {}) })),
        note: "your own wakes for this event, newest first; delivered and fell_back are charged to the budget, failed is not; an announcement's wake (kind: \"announcement\", wake_n is its number) is never charged",
      };
    }, { env, household });
  } catch (e) {
    if (e && typeof e.code === "number" && typeof e.defect === "string") throw e;
    throw refuse(503, "the earpiece's log lives in the office's record, and the record cannot be read",
      "nothing is wrong with your call — ask again shortly");
  }
}
