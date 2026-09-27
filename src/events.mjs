// events.mjs — THE CALENDAR'S RULES, PURE (POS-207, POS-208).
//
// Keemin, 2026-09-24: residents schedule events on a shared calendar; the
// calendar has an MCP/API shape the site ingests like everything else; an event
// has a time and a place, "like a mark or coordinate". Rei's blueprint
// (events-as-first-class-town-objects) supplies the rest of the law quoted
// here: one accountable host, a standing World place, doors-open / start / end,
// "every surface should derive the same phase from the same event", revisions
// "visible as a revision, never a silent replacement", "one writer and many
// projections".
//
// ── WHAT LIVES HERE, AND WHAT DOES NOT ──────────────────────────────────────
//
// Everything in this file is a function of its arguments: no store, no clock
// of its own, no network. The pen and the reads (src/events-store.mjs) and the
// rebuild (world2/tools/events-rebuild.mjs) all call it, and that is the point.
// `applyEventAct` is the ONE place an act becomes a row, so the row the pen
// writes beside an act and the row a rebuild derives from that act cannot come
// to disagree. `phaseAt` is the ONE place a phase is decided, so no surface
// works out its own.
//
// ── THE SHAPE, DECIDED BY WRIGHT 2026-09-24 (disclosed; the brief § 1–8) ────
//
// The record is the act log (class `event`), the tables are its projection;
// the id is `<host>/<slug>`; the record is UTC; a place is a standing mark with
// an extent or an absolute point; the doors are household's, the read is the
// town's; the RSVP records how a harness would take a wake and never delivers
// one (POS-208 C is a later row).

export const EVENT_CLASS = "event";
export const ACT_HOST = "host";
export const ACT_AMEND = "amend-event";
export const ACT_CANCEL = "cancel-event";
export const ACT_RSVP = "rsvp";
export const ACT_ANNOUNCE = "announce";

// ── THE DIALS, named once ───────────────────────────────────────────────────
//
// EVENT_MAX_DAYS is Wright's dial from the brief ("an event longer than 7 days
// ... a dial, named in the code and in the PR; Keemin can change it"). It is
// measured from `starts` to `ends`: doors may open early, and the length that
// matters to a reader is how long the thing itself runs.
export const EVENT_MAX_DAYS = 7;
// How long an ended event stays on the calendar's `ended` list. The record keeps
// it forever and the one-event read still answers it; this is only the list.
export const ENDED_LIST_DAYS = 7;
export const TITLE_MAX = 120;
export const INVITATION_MAX = 600;
// A host's announcement (POS-227, Keemin 2026-09-26: "announcements per event
// are UNCAPPED, and the text is ≤ 1000 characters").
export const ANNOUNCE_TEXT_MAX = 1000;
// How many announcements one event may carry. Unlimited by the ruling, and a
// DIAL so a cap is a config change and never code: `ANNOUNCE_MAX=<n>` in the
// office's environment, a whole number of at least 1. Unset (or anything that
// is not such a number) is the ruling's default, no cap.
export const ANNOUNCE_MAX_ENV = "ANNOUNCE_MAX";
export function announceMax(env = process.env) {
  const n = Number(String(env?.[ANNOUNCE_MAX_ENV] ?? "").trim());
  return Number.isInteger(n) && n >= 1 ? n : Infinity;
}
// Wakes per event, the resident's own dial (POS-208).
export const BUDGET_DEFAULT = 6;
export const BUDGET_MAX = 60;
export const WEBHOOK_TIMEOUT_MS = 10_000;
export const FELL_BACK_NO_ECHO = "url did not echo the nonce";
// The webhook's secret: 32 random bytes the office mints on the echo (POS-208,
// ruled 2026-09-25). It is shown ONCE, on the receipt of the RSVP that
// registered it, in these words.
export const SECRET_BYTES = 32;
export const SECRET_NOTE = "shown once; not shown again — keep it where your harness can read it: a later row delivers wakes and signs each one with it";
export const HARNESS_REUSED_NOTE = "this webhook is already registered for you: not challenged again, and its secret is not shown again";

export const PHASES = Object.freeze(["announced", "doors-open", "underway", "ended"]);
export const HARNESS_KINDS = Object.freeze(["letta", "webhook", "mail"]);

const DAY_MS = 86_400_000;

// The bounce vocabulary the household apex catches: `{ code, defect, hint }` on
// an Error (household-apex.mjs § the act's catch turns it into the answer).
export function refuse(code, defect, hint, extra = {}) {
  return Object.assign(new Error(defect), { code, defect, hint, ...extra });
}

// ── THE ID ──────────────────────────────────────────────────────────────────
//
// MEASURED: a mark does not mint its slug from a title. `world_leave_mark`
// takes the slug from the caller and judges it (world.mjs: "slug must be
// kebab-case ... lowercase letters, digits, single hyphens"). The office's one
// title-to-slug minting is the letter's (write.mjs § slugify). So an event's
// slug is minted from its title with that letter's rule, and the result obeys
// the mark's rule, so an event id reads like a mark id.
export const EVENT_ID_RE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
// A MARK id is judged more loosely than an event's: a handle may carry a dot
// (`victor-b.-rose-e.` is a live one), and a mark's owner is a handle.
export const MARK_ID_RE = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/;
export function slugFromTitle(title) {
  return String(title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
}

/**
 * The id a new event takes. "Unique while standing; a cancelled event keeps its
 * id" — so an id is never reused. A title whose id is held by an event that has
 * ended or been cancelled takes the next free `-2`, `-3`, ...; one held by an
 * event still standing is refused, because that is almost always a host meaning
 * to amend.
 */
export function mintEventId(host, title, taken, now) {
  const slug = slugFromTitle(title);
  if (!slug) throw refuse(422, "the title mints no id", "an event's id is <host>/<slug>, and the slug comes from the title's letters and digits — give the title at least one");
  const base = `${host}/${slug}`;
  const held = taken(base);
  if (!held) return base;
  if (!held.cancelled && Date.parse(held.ends) > now)
    throw refuse(409, `you already host "${base}"`, `to change it, host with event: "${base}" and the fields that change — or give this one a different title`, { event: base });
  for (let n = 2; n < 1000; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
  throw refuse(409, `"${base}" has been used too many times`, "give this event a different title");
}

// ── TIME ────────────────────────────────────────────────────────────────────
//
// An instant must SAY its zone (a trailing Z or a ±hh:mm offset). A bare local
// time is refused rather than read in the office's zone, because the record is
// UTC and a guess about the host's clock would be written into it.
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
function instant(name, v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const t = Date.parse(s);
  if (!ISO_WITH_ZONE.test(s) || !Number.isFinite(t))
    throw refuse(422, `${name} is not an instant`, `${name} is an ISO instant with its zone, e.g. "2026-09-26T22:00:00Z" — the record is UTC`, { field: name });
  return new Date(t).toISOString();
}

/** Judge an interval. Returns ISO strings; throws the refusal by name. */
export function judgeInterval({ doors_open, starts, ends }, now) {
  const s = instant("starts", starts);
  const e = instant("ends", ends);
  if (!s) throw refuse(422, "an event needs a start", "starts: an ISO instant", { field: "starts" });
  if (!e) throw refuse(422, "an event needs an end", "ends: an ISO instant — an event with no end is not one the town can say is over", { field: "ends" });
  const d = instant("doors_open", doors_open) ?? s;
  const [tS, tE, tD] = [Date.parse(s), Date.parse(e), Date.parse(d)];
  if (tE <= tS) throw refuse(422, "an event ends after it starts", `ends (${e}) is not after starts (${s})`, { field: "ends" });
  if (tD > tS) throw refuse(422, "the doors open before the start, or at it", `doors_open (${d}) is after starts (${s}) — leave it off and it is the start`, { field: "doors_open" });
  if (tE <= now) throw refuse(422, "that event has already ended", `ends (${e}) is in the past`, { field: "ends" });
  if (tE - tS > EVENT_MAX_DAYS * DAY_MS)
    throw refuse(422, `an event runs at most ${EVENT_MAX_DAYS} days`, `this one runs ${((tE - tS) / DAY_MS).toFixed(1)} days from starts to ends — a longer thing is several events`, { field: "ends" });
  return { doors_open: d, starts: s, ends: e };
}

/** The ONE phase decision. `announced | doors-open | underway | ended`. */
export function phaseAt({ doors_open, starts, ends }, now) {
  const [tD, tS, tE] = [Date.parse(doors_open ?? starts), Date.parse(starts), Date.parse(ends)];
  if (now >= tE) return "ended";
  if (now >= tS) return "underway";
  if (now >= tD) return "doors-open";
  return "announced";
}

// ── PLACE ───────────────────────────────────────────────────────────────────

/** Judge the SHAPE of `place`: exactly one of `{ mark }` or `{ at: { x, y } }`. */
export function judgePlaceShape(place) {
  const hint = 'place is { mark: "<owner>/<slug>" } (a standing mark) or { at: { x, y } } (absolute world coordinates)';
  if (place == null) throw refuse(422, "an event needs a place", hint, { field: "place" });
  if (typeof place !== "object" || Array.isArray(place)) throw refuse(422, "place must be an object", hint, { field: "place" });
  const keys = Object.keys(place);
  const extra = keys.filter((k) => k !== "mark" && k !== "at");
  if (extra.length) throw refuse(422, `place does not take: ${extra.join(", ")}`, hint, { field: "place" });
  if ("mark" in place && "at" in place) throw refuse(422, "a place is a mark or a point, not both", hint, { field: "place" });
  if ("mark" in place) {
    const id = String(place.mark ?? "").trim();
    if (!MARK_ID_RE.test(id)) throw refuse(422, "place.mark is a mark id", `ids are <owner>/<slug> — got "${id}"`, { field: "place" });
    return { mark: id };
  }
  if ("at" in place) {
    const x = Number(place.at?.x), y = Number(place.at?.y);
    if (place.at?.x == null || place.at?.y == null || !Number.isFinite(x) || !Number.isFinite(y))
      throw refuse(422, "place.at needs x and y", "absolute world coordinates, numbers — { at: { x: 120, y: 64 } }", { field: "place" });
    return { at: { x, y } };
  }
  throw refuse(422, "an event needs a place", hint, { field: "place" });
}

/**
 * A mark row as a place. The row is the store's `marks` row for the slug, of
 * ANY status, or null. A draft is not in `marks` at all (it is a claim), so it
 * is refused in the same words as a mark that does not exist — which is also
 * what keeps a private draft from being confirmed to exist by this door.
 *
 * MEASURED: a mark carries no `name` (its `data` keys are date, tier, image,
 * source, ... on every row of test/fixtures/world2-mark-render.json). The fold
 * calls the leaf of the id the mark's `slug`, and the telling titles a mark from
 * it, so the place's `name` is that leaf.
 */
export function placeFromMarkRow(row, id) {
  if (!row) throw refuse(422, `no standing mark "${id}"`, 'a place is a mark standing in the world — a draft stands nowhere yet — or a point: place: { at: { x, y } }', { field: "place" });
  if (row.status !== "standing") throw refuse(422, `"${id}" is retired`, "a retired mark is not a place any more — name a standing one, or a point", { field: "place" });
  const g = typeof row.geometry === "string" ? JSON.parse(row.geometry) : row.geometry;
  const w = Number(g?.extent?.w), h = Number(g?.extent?.h);
  const x = Number(g?.at?.x), y = Number(g?.at?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(w > 0) || !(h > 0))
    throw refuse(422, `"${id}" has no extent`, "an event's mark must be somewhere a gathering can stand — a mark with an extent — or name a point: place: { at: { x, y } }", { field: "place" });
  return { mark: id, name: markName(id), x, y };
}

export const markName = (id) => (id ? String(id).split("/").slice(1).join("/") : null);

/**
 * The act's `at` columns for an event's place — "an anchor and an offset, never
 * a bare x,y" (001 on `acts.at_anchor`). MEASURED: a walk's act writes no `at`
 * at all (walk-exec.mjs puts `at: null` and carries `toward` in the payload), so
 * there is no walk anchoring to copy. The journal's own rule is used instead
 * (world-journal.mjs § anchorAt): a mark anchors to itself at offset 0,0 (its
 * `at` is its centre), and a bare point anchors to the world with the point as
 * its offset. The payload keeps the absolute point either way.
 */
export function anchorForPlace(place, worldAnchor) {
  if (place.mark) return { anchor: place.mark, dx: 0, dy: 0 };
  return { anchor: worldAnchor, dx: place.x, dy: place.y };
}

// ── THE HOST ACT'S FIELDS ───────────────────────────────────────────────────

export function judgeText({ title, invitation }, { partial = false } = {}) {
  const out = {};
  if (title !== undefined || !partial) {
    const t = String(title ?? "").trim();
    if (!t) throw refuse(422, "an event needs a title", "title: what the event is called", { field: "title" });
    if (t.length > TITLE_MAX) throw refuse(422, `a title is at most ${TITLE_MAX} characters`, `this one is ${t.length}`, { field: "title" });
    out.title = t;
  }
  if (invitation !== undefined) {
    if (invitation !== null && typeof invitation !== "string") throw refuse(422, "invitation is text", "a short invitation, in your own words", { field: "invitation" });
    const i = String(invitation ?? "").trim();
    if (i.length > INVITATION_MAX) throw refuse(422, `an invitation is at most ${INVITATION_MAX} characters`, `this one is ${i.length}`, { field: "invitation" });
    out.invitation = i;
  } else if (!partial) out.invitation = "";
  return out;
}

// ── THE ANNOUNCEMENT (POS-227) ──────────────────────────────────────────────

/** Judge an announcement's text. Returns it trimmed; throws the refusal by name. */
export function judgeAnnouncement(text) {
  if (text != null && typeof text !== "string") throw refuse(422, "an announcement is text", "text: what you say to everyone attending, in your own words", { field: "text" });
  const t = String(text ?? "").trim();
  if (!t) throw refuse(422, "an announcement needs text", "text: what you say to everyone attending", { field: "text" });
  if (t.length > ANNOUNCE_TEXT_MAX) throw refuse(422, `an announcement is at most ${ANNOUNCE_TEXT_MAX} characters`, `this one is ${t.length}`, { field: "text" });
  return t;
}

// ── THE RSVP (POS-208 B) ────────────────────────────────────────────────────

// The literal hosts a challenge is never sent to: this box and the networks
// behind it. A name that RESOLVES to one of these is not caught here (that is a
// resolver-level guard, named in the lane's report as not built).
const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[::1?\]|\[f[cd][0-9a-f:]*\]|\[fe80:[0-9a-f:]*\])$/i;
const CONVERSATION_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/** Judge `harness` and `budget`. Returns `{ harness: { kind, address }, budget }`. */
export function judgeRsvp({ harness, budget }) {
  let b = BUDGET_DEFAULT;
  if (budget !== undefined && budget !== null) {
    const n = Number(budget);
    if (!Number.isInteger(n) || n < 1 || n > BUDGET_MAX)
      throw refuse(422, `budget is a whole number of wakes, 1 to ${BUDGET_MAX}`, `the most this event may wake your harness; leave it off for ${BUDGET_DEFAULT}`, { field: "budget" });
    b = n;
  }
  const h = harness ?? { kind: "mail" };
  if (typeof h !== "object" || Array.isArray(h)) throw refuse(422, "harness must be an object", 'harness: { kind: "mail" } | { kind: "letta", conversation } | { kind: "webhook", url }', { field: "harness" });
  const kind = String(h.kind ?? "").trim();
  if (!HARNESS_KINDS.includes(kind)) throw refuse(422, `harness.kind is one of: ${HARNESS_KINDS.join(", ")}`, "mail needs nothing (the ferry carries it); letta names a conversation; webhook names a url", { field: "harness" });
  const allowed = { mail: [], letta: ["conversation"], webhook: ["url"] }[kind];
  const extra = Object.keys(h).filter((k) => k !== "kind" && !allowed.includes(k));
  if (extra.length) throw refuse(422, `a ${kind} harness does not take: ${extra.join(", ")}`, allowed.length ? `it takes: ${allowed.join(", ")}` : "it takes nothing but its kind", { field: "harness" });
  if (kind === "mail") return { harness: { kind, address: null }, budget: b };
  if (kind === "letta") {
    const c = String(h.conversation ?? "").trim();
    if (!CONVERSATION_RE.test(c)) throw refuse(422, "a letta harness names its conversation", "conversation: the id your Letta conversation already has — letters, digits, . _ : -", { field: "harness" });
    return { harness: { kind, address: c }, budget: b };
  }
  let u;
  try { u = new URL(String(h.url ?? "")); } catch { throw refuse(422, "a webhook harness names its url", "url: an https:// address that echoes the nonce it is sent", { field: "harness" }); }
  if (u.protocol !== "https:") throw refuse(422, "a webhook url is https", `got ${u.protocol}//`, { field: "harness" });
  if (u.username || u.password) throw refuse(422, "a webhook url carries no credentials", "a secret in a url is a secret in every log it passes through", { field: "harness" });
  if (PRIVATE_HOST.test(u.hostname)) throw refuse(422, "the office does not call a private address", `${u.hostname} is this box or a network behind it`, { field: "harness" });
  return { harness: { kind, address: u.toString() }, budget: b };
}

/**
 * The challenge: POST `{ nonce }` once, with a timeout; registered only if the
 * body echoes the nonce — either the bare nonce as the body, or `{ "nonce": … }`.
 * A redirect is not an echo (it is followed nowhere). Never throws.
 */
export async function challengeWebhook(url, nonce, { fetchImpl = globalThis.fetch, timeoutMs = WEBHOOK_TIMEOUT_MS } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce }), redirect: "manual", signal: ac.signal });
    if (!res || res.status < 200 || res.status >= 300) return { echoed: false, why: `answered ${res?.status ?? "nothing"}` };
    const text = String(await res.text()).slice(0, 4096).trim();
    if (text === nonce) return { echoed: true };
    try { if (JSON.parse(text)?.nonce === nonce) return { echoed: true }; } catch { /* not JSON */ }
    return { echoed: false, why: "the body did not carry the nonce" };
  } catch (e) {
    return { echoed: false, why: ac.signal.aborted ? `no answer within ${timeoutMs / 1000} s` : String(e?.message ?? e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

// ── THE RESIDENT'S HARNESS ROW (POS-208, ruled 2026-09-25) ───────────────────
//
// One private `household_harnesses` row per RESIDENT, not per RSVP (026 §
// THE HARNESS ROW). `harnessPlan` is the one decision about it, pure:
//
//   none      a mail RSVP. Stores nothing, and leaves any row as it stands.
//   reuse     the row already holds this kind and this address. No challenge,
//             and no secret on the receipt.
//   register  no row, or a different address or kind. A webhook is challenged
//             first; a letta conversation is recorded as it is.
//
// `existing` is the row the household's own transaction can see, or null.
export function harnessPlan(existing, harness) {
  if (harness.kind === "mail") return "none";
  if (existing && existing.kind === harness.kind && existing.address === harness.address) return "reuse";
  return "register";
}

// ── THE ONE WAY AN ACT BECOMES A ROW ────────────────────────────────────────
//
// `state` is `{ events: Map<id,row>, rsvps: Map<"event handle",row> }`, table-
// shaped (the columns of 026_events.sql). `act` is an `acts` row: `id`,
// `action`, `actor`, `object`, `payload`, `household`. Every column of both
// tables comes from the act, so a rebuild restores every one of them. An RSVP's
// address and secret live on the resident's harness row, which no act carries
// and no rebuild touches (026 § THE HARNESS ROW).
//
// It mutates `state` and returns the row it wrote, so the pen can write exactly
// that row and the rebuild can fold a whole log with the same call.
export const rsvpKey = (event, handle) => `${event} ${handle}`;

export function applyEventAct(state, act) {
  const p = typeof act.payload === "string" ? JSON.parse(act.payload) : (act.payload ?? {});
  const id = String(act.object ?? p.event);
  const actId = Number(act.id);
  if (act.action === ACT_HOST || act.action === ACT_AMEND) {
    const prev = state.events.get(id);
    const row = {
      id, title: p.title, invitation: p.invitation ?? "",
      host: prev?.host ?? act.actor, household: prev?.household ?? act.household ?? null,
      place_mark: p.place?.mark ?? null, place_x: Number(p.place?.x), place_y: Number(p.place?.y),
      doors_open: p.doors_open, starts: p.starts, ends: p.ends,
      revised: act.action === ACT_AMEND ? (prev?.revised ?? 0) + 1 : 0,
      cancelled: prev?.cancelled ?? false,
      hosted_act: prev?.hosted_act ?? actId, last_act: actId,
    };
    state.events.set(id, row);
    return row;
  }
  if (act.action === ACT_CANCEL) {
    const prev = state.events.get(id);
    if (!prev) return null;
    const row = { ...prev, cancelled: true, last_act: actId };
    state.events.set(id, row);
    return row;
  }
  if (act.action === ACT_RSVP) {
    const row = {
      event: id, handle: act.actor, household: act.household ?? null,
      harness: p.harness, budget: Number(p.budget),
      fell_back: p.fell_back ?? null, act: actId,
    };
    state.rsvps.set(rsvpKey(id, act.actor), row);
    return row;
  }
  // An `announce` act changes no row: the announcement IS the act, and the
  // calendar read and the earpiece read it from `acts` (events-store.mjs §
  // announcementsOf). So the rebuild has nothing to restore for it.
  return null;
}

/** Fold a whole log (ordered by id) into the two tables. The rebuild. */
export function foldEventActs(acts) {
  const state = { events: new Map(), rsvps: new Map() };
  for (const a of acts) applyEventAct(state, a);
  return state;
}

// ── THE PUBLIC VIEW ─────────────────────────────────────────────────────────

const iso = (v) => (v == null ? null : new Date(v).toISOString());

/**
 * One event as the calendar read answers it. `rsvpHandles` is the handles that
 * RSVPed, and nothing else: the public read never carries a harness, a url, a
 * secret or a budget (the brief § 6).
 */
export function eventView(row, rsvpHandles, now, announcements = []) {
  const doors_open = iso(row.doors_open), starts = iso(row.starts), ends = iso(row.ends);
  const residents = [...rsvpHandles].sort();
  return {
    id: row.id,
    title: row.title,
    invitation: row.invitation ?? "",
    host: row.host,
    household: row.household ?? null,
    place: { mark: row.place_mark ?? null, name: markName(row.place_mark), x: Number(row.place_x), y: Number(row.place_y) },
    doors_open, starts, ends,
    phase: phaseAt({ doors_open, starts, ends }, now),
    starts_in_s: Math.round((Date.parse(starts) - now) / 1000),
    ends_in_s: Math.round((Date.parse(ends) - now) / 1000),
    rsvps: { total: residents.length, residents },
    revised: Number(row.revised ?? 0),
    cancelled: row.cancelled === true,
    // The host's announcements, oldest first. Resident text in its own field,
    // never folded into a sentence of the office's (the reading law).
    announcements: announcements.map((a) => ({ at: iso(a.at), text: a.text })),
  };
}

/** The whole calendar: `{ as_of, now, coming, ended, total }`. */
export function calendarFrom(rows, rsvpsByEvent, now, announcementsByEvent = new Map()) {
  const views = rows.map((r) => eventView(r, rsvpsByEvent.get(r.id) ?? [], now, announcementsByEvent.get(r.id) ?? []));
  const byStart = (a, b) => Date.parse(a.starts) - Date.parse(b.starts) || a.id.localeCompare(b.id);
  const current = views.filter((v) => v.phase === "doors-open" || v.phase === "underway").sort(byStart);
  const coming = views.filter((v) => v.phase === "announced").sort(byStart);
  const ended = views.filter((v) => v.phase === "ended" && now - Date.parse(v.ends) <= ENDED_LIST_DAYS * DAY_MS)
    .sort((a, b) => Date.parse(b.ends) - Date.parse(a.ends) || a.id.localeCompare(b.id));
  return { as_of: new Date(now).toISOString(), now: current, coming, ended, total: current.length + coming.length + ended.length };
}
