// event-pins.mjs — THE PINNED BOARD READS THE CALENDAR (POS-281).
//
// The board used to be a list typed into world.mjs (NOTICES: the return from
// the Pando, DARKO's birthday, the Snug's opening), one deploy per notice. It
// is now the calendar: while an event is on, from its `starts` to its `ends`,
// it is pinned, and its host's announcements pin under it for the same window.
// A gathering is an event with announcements; nobody types a notice any more.
//
// ── THE THREE DEFAULTS (Wright's, 2026-09-28, for Keemin to overrule) ────────
//
//   near   standing within the place mark's own extent — the test a door uses
//          since POS-220, and the one the earpiece already asks (earpiece.mjs
//          § atPlace). A bare-point event has no extent, so it is the say
//          lane's earshot around the point, as the earpiece has it.
//   when   from `starts`, never before: doors-open is not yet "NOW".
//   howmany at most PIN_MAX at once, soonest-ending first.
//
// ── ONE READ A MINUTE, NOT ONE PER REPLY ────────────────────────────────────
//
// The board rides every world reply that has a place (world.mjs §
// withNoticeBoard), and those are the hottest path the office has. So the
// replies never touch the record: they read a snapshot, and the snapshot is
// re-read at most once a PINS_TTL_MS, in the background, by whichever reply
// first finds it stale; each read worker keeps its own (read-workers.mjs §
// the caches). The snapshot holds every event that is on or will start within
// the next two TTLs, and each reply judges `starts <= t < ends` at its own
// instant, so a pin appears and leaves on the minute. A new announcement, or an
// event hosted to start at once, reaches the board within one TTL.
//
// An office with no record (tests, a dev box with no store) reads nothing and
// pins nothing; it does not dial (world2-pen.mjs § pool).

import { markName } from "./events.mjs";
import { placeOf, atPlace } from "./earpiece.mjs";
import { EARSHOT_M } from "./voices.mjs";

export const PIN_MAX = 3;
export const PINS_TTL_MS = 60_000;

const ms = (v) => (typeof v === "number" ? v : Date.parse(v));

/** "02:30Z" today; "2026-09-29 02:30Z" when the end is more than a day off. */
export function untilText(ends, now) {
  const iso = new Date(ms(ends)).toISOString();
  return ms(ends) - now <= 86_400_000 ? `${iso.slice(11, 16)}Z` : `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z`;
}

/** "21:40Z": when an announcement was made. */
export const clockText = (v) => `${new Date(ms(v)).toISOString().slice(11, 16)}Z`;

/** The place as a line says it: the mark's name, or the point. */
export function placeText(event) {
  return markName(event.place_mark) ?? `(${Math.round(Number(event.place_x))}, ${Math.round(Number(event.place_y))})`;
}

/** Is this event on at `t`? From its start to its end, never cancelled. */
export function onAt(event, t) {
  return event.cancelled !== true && ms(event.starts) <= t && t < ms(event.ends);
}

/**
 * The board at `t`: the events on, soonest-ending first, at most `max`.
 * `events` are rows (events-store.mjs § rowOf) each carrying `announcements`
 * (oldest first, as the act log has them) and `place` (earpiece.mjs § placeOf).
 */
export function pinsAt(events, t, { max = PIN_MAX } = {}) {
  return events.filter((e) => onAt(e, t))
    .sort((a, b) => ms(a.ends) - ms(b.ends) || String(a.id).localeCompare(String(b.id)))
    .slice(0, max);
}

/**
 * One pin as the conversations payload and the town shelf carry it. The
 * notices' old public shape (id, place, at, title, text) is kept so their
 * readers keep reading; `text` is the host's invitation. The host's own words
 * stay in their own fields, newest first, never folded into the office's.
 */
export function publicPin(e, t) {
  return {
    id: e.id,
    event: e.id,
    place: placeText(e),
    ...(e.place_mark ? { mark: e.place_mark } : {}),
    at: { x: Number(e.place_x), y: Number(e.place_y) },
    title: `NOW at ${placeText(e)}: ${e.title}, until ${untilText(e.ends, t)}`,
    text: e.invitation ?? "",
    host: e.host,
    until: new Date(ms(e.ends)).toISOString(),
    announcements: [...(e.announcements ?? [])].reverse().map((a) => ({ at: a.at, text: a.text })),
  };
}

/** The 📌 lines one pin puts on a reply: the event, then its announcements, newest first. */
export function boardLines(e, t) {
  const p = publicPin(e, t);
  return [`📌 ${p.title}`, ...p.announcements.map((a) => `📌 ${e.host}, ${clockText(a.at)}: ${a.text}`)];
}

/**
 * The board for someone standing at (x, y): every pin whose place they stand
 * in, or null. `withinFn` is the world engine's containment (world.mjs §
 * pointWithinMarkFn); without it a mark's place cannot be judged and is "no".
 */
export function boardAt(x, y, events, t, { withinFn = null, earshotM = EARSHOT_M, max = PIN_MAX } = {}) {
  const lines = [];
  for (const e of pinsAt(events, t, { max })) {
    if (atPlace({ x, y }, e.place ?? placeOf(e), { withinFn, earshotM }) === true) lines.push(...boardLines(e, t));
  }
  return lines.length ? lines : null;
}

// ── THE SNAPSHOT ────────────────────────────────────────────────────────────

const snap = { events: [], withinFn: null, read_at: -Infinity };
let inflight = null;

/**
 * Read the events on or starting soon, their announcements and their marks'
 * shapes, once. Injected pieces are for tests; the office passes none.
 */
export async function readPins({ now = Date.now(), env = process.env, officeRead = null, announcementsOf = null, withinFn = undefined } = {}) {
  const pen = officeRead ?? (await import("./world2-pen.mjs")).officeRead;
  const ann = announcementsOf ?? (await import("./events-store.mjs")).announcementsOf;
  const events = await pen(async (client) => {
    const { rows } = await client.query(
      "SELECT id, title, invitation, host, place_mark, place_x, place_y, starts, ends, cancelled FROM events WHERE NOT cancelled AND ends > $1 AND starts <= $2 ORDER BY ends, id",
      [new Date(now).toISOString(), new Date(now + 2 * PINS_TTL_MS).toISOString()]);
    if (!rows.length) return [];
    const marks = [...new Set(rows.map((r) => r.place_mark).filter(Boolean))];
    const shapes = new Map();
    if (marks.length) {
      const { rows: ms_ } = await client.query("SELECT slug, geometry FROM marks WHERE slug = ANY($1)", [marks]);
      for (const m of ms_) shapes.set(m.slug, m);
    }
    const byEvent = new Map();
    for (const a of await ann(client, rows.map((r) => r.id))) byEvent.set(a.event, [...(byEvent.get(a.event) ?? []), a]);
    return rows.map((r) => {
      const e = { ...r, place_x: Number(r.place_x), place_y: Number(r.place_y),
        starts: new Date(r.starts).toISOString(), ends: new Date(r.ends).toISOString(), announcements: byEvent.get(r.id) ?? [] };
      return { ...e, place: placeOf(e, shapes.get(r.place_mark) ?? null) };
    });
  }, { env });
  const within = withinFn !== undefined ? withinFn : await (await import("./world.mjs")).pointWithinMarkFn().catch(() => null);
  return { events, withinFn: within };
}

/** Re-read the snapshot now (single flight). A failed read keeps the last one. */
export function refreshPins(opts = {}) {
  if (inflight) return inflight;
  const now = opts.now ?? Date.now();
  snap.read_at = now; // a failing record is asked once a TTL, not once a reply
  inflight = readPins({ ...opts, now })
    .then(({ events, withinFn }) => { snap.events = events; snap.withinFn = withinFn; })
    .catch(() => { /* no record, or it could not be read: the last board stands */ })
    .finally(() => { inflight = null; });
  return inflight;
}

/** The snapshot as a reply reads it; a stale one starts a background re-read. */
export function pinSnapshot(t = Date.now()) {
  if (t - snap.read_at >= PINS_TTL_MS) refreshPins({ now: t });
  return snap;
}

/** Tests only: put a board in place without a record. */
export function setPinSnapshot(events, withinFn = null, readAt = Date.now()) {
  snap.events = events; snap.withinFn = withinFn; snap.read_at = readAt;
}
