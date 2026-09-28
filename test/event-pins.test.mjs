// POS-281: the pinned board reads the calendar. The rules are pure
// (src/event-pins.mjs); the read is driven through an injected pen so no
// record is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PIN_MAX, PINS_TTL_MS, pinsAt, publicPin, boardLines, boardAt, readPins, refreshPins, pinSnapshot, setPinSnapshot, untilText,
} from "../src/event-pins.mjs";

const T = Date.parse("2026-10-03T22:00:00Z");
const MIN = 60_000;
const iso = (t) => new Date(t).toISOString();

// The world engine's containment, reduced to a rectangle: a point is in a mark
// when it is inside the mark's extent around its centre.
const within = (p, m) => Math.abs(p.x - m.at.x) <= m.extent.w / 2 && Math.abs(p.y - m.at.y) <= m.extent.h / 2;

function ev(slug, { starts = T, ends = T + 120 * MIN, doors_open = null, cancelled = false, mark = `host/${slug}-hall`, x = 0, y = 0, point = false, announcements = [] } = {}) {
  const place_mark = point ? null : mark;
  return {
    id: `host/${slug}`, title: slug.toUpperCase(), invitation: `come to ${slug}`, host: "host",
    place_mark, place_x: x, place_y: y, doors_open: iso(doors_open ?? starts), starts: iso(starts), ends: iso(ends), cancelled,
    announcements,
    place: point ? { mark: null, name: null, x, y, shape: null }
      : { mark: place_mark, name: place_mark.split("/")[1], x, y, shape: { id: place_mark, at: { x, y }, extent: { w: 100, h: 100 } } },
  };
}

test("an event pins from its start, never at doors-open, and leaves at its end", () => {
  const e = ev("party", { doors_open: T - 30 * MIN });
  assert.deepEqual(pinsAt([e], T - 1), [], "the doors are open but it is not NOW yet");
  assert.equal(pinsAt([e], T).length, 1, "pinned at the start");
  assert.equal(pinsAt([e], T + 120 * MIN - 1).length, 1, "still up one millisecond before the end");
  assert.deepEqual(pinsAt([e], T + 120 * MIN), [], "gone at the end");
});

test("a cancelled event is never pinned", () => {
  assert.deepEqual(pinsAt([ev("party", { cancelled: true })], T + MIN), []);
});

test(`at most ${PIN_MAX} pin at once, soonest-ending first`, () => {
  const four = [ev("d", { ends: T + 40 * MIN }), ev("a", { ends: T + 10 * MIN }), ev("c", { ends: T + 30 * MIN }), ev("b", { ends: T + 20 * MIN })];
  assert.deepEqual(pinsAt(four, T + MIN).map((e) => e.id), ["host/a", "host/b", "host/c"]);
  assert.deepEqual(pinsAt(four, T + 15 * MIN).map((e) => e.id), ["host/b", "host/c", "host/d"], "a slot frees when the soonest ends");
});

test("a pin says NOW at <place>: <title>, until <time>, and carries the host's announcements newest first", () => {
  const e = ev("party", { announcements: [
    { at: iso(T + 5 * MIN), text: "the band is on" },
    { at: iso(T + 40 * MIN), text: "last call" },
  ] });
  const p = publicPin(e, T + 50 * MIN);
  assert.equal(p.title, "NOW at party-hall: PARTY, until 00:00Z");
  assert.equal(p.place, "party-hall");
  assert.equal(p.mark, "host/party-hall");
  assert.deepEqual(p.at, { x: 0, y: 0 });
  assert.equal(p.text, "come to party", "the invitation is the pin's text");
  assert.equal(p.until, iso(T + 120 * MIN));
  assert.deepEqual(p.announcements.map((a) => a.text), ["last call", "the band is on"]);
  assert.deepEqual(boardLines(e, T + 50 * MIN), [
    "📌 NOW at party-hall: PARTY, until 00:00Z",
    "📌 host, 22:40Z: last call",
    "📌 host, 22:05Z: the band is on",
  ]);
});

test("a point event names its point, and a far end names its day", () => {
  const e = ev("picnic", { point: true, x: 120.4, y: -64.6, ends: T + 3 * 86_400_000 });
  assert.equal(publicPin(e, T).title, "NOW at (120, -65): PICNIC, until 2026-10-06 22:00Z");
  assert.equal(untilText(T + 60 * MIN, T), "23:00Z");
});

test("near is the place mark's own extent: 1 m outside it hears nothing, even at 51 m from the centre", () => {
  const e = ev("party", { x: 1000, y: 1000 });
  assert.ok(boardAt(1000, 1000, [e], T, { withinFn: within }), "at the centre");
  assert.ok(boardAt(1050, 1000, [e], T, { withinFn: within }), "on the extent's edge");
  assert.equal(boardAt(1051, 1000, [e], T, { withinFn: within }), null, "1 m outside the extent, well inside earshot of the anchor");
  assert.equal(boardAt(1000, 1000, [e], T, { withinFn: null }), null, "no containment law, no answer: a mark's place is not guessed");
});

test("a point event is the say lane's earshot around the point", () => {
  const e = ev("picnic", { point: true, x: 0, y: 0 });
  assert.ok(boardAt(60, 0, [e], T, { withinFn: within, earshotM: 60 }));
  assert.equal(boardAt(61, 0, [e], T, { withinFn: within, earshotM: 60 }), null);
});

test("standing in two events' places hears both, each with its own announcements", () => {
  const a = ev("a", { ends: T + 10 * MIN, announcements: [{ at: iso(T), text: "hello" }] });
  const b = ev("b", { ends: T + 20 * MIN });
  assert.deepEqual(boardAt(0, 0, [b, a], T + MIN, { withinFn: within }), [
    "📌 NOW at a-hall: A, until 22:10Z", "📌 host, 22:00Z: hello", "📌 NOW at b-hall: B, until 22:20Z",
  ]);
});

// ── the read ────────────────────────────────────────────────────────────────

function stubPen(eventsRows, markRows) {
  const asked = [];
  const officeRead = async (fn) => fn({
    async query(sql, params) {
      asked.push({ sql, params });
      if (/FROM events/.test(sql)) return { rows: eventsRows };
      if (/FROM marks/.test(sql)) return { rows: markRows };
      throw new Error(`unexpected query: ${sql}`);
    },
  });
  return { officeRead, asked };
}

test("the read takes the events on or starting within two TTLs, with their marks' shapes and announcements", async () => {
  const rows = [{ id: "host/party", title: "PARTY", invitation: "", host: "host", place_mark: "host/hall", place_x: "10", place_y: "20",
    starts: new Date(T), ends: new Date(T + 60 * MIN), cancelled: false }];
  const marks = [{ slug: "host/hall", geometry: JSON.stringify({ at: { x: 10, y: 20 }, extent: { w: 40, h: 40 } }) }];
  const { officeRead, asked } = stubPen(rows, marks);
  const announcementsOf = async (_c, ids) => ids.map((event) => ({ event, at: iso(T), text: "welcome" }));
  const { events, withinFn } = await readPins({ now: T, officeRead, announcementsOf, withinFn: within });
  assert.equal(withinFn, within);
  assert.deepEqual(asked[0].params, [iso(T), iso(T + 2 * PINS_TTL_MS)]);
  assert.match(asked[0].sql, /NOT cancelled/);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].place.shape, { id: "host/hall", at: { x: 10, y: 20 }, extent: { w: 40, h: 40 } });
  assert.equal(events[0].place_x, 10, "numbers, not the driver's strings");
  assert.equal(events[0].starts, iso(T));
  assert.deepEqual(events[0].announcements.map((a) => a.text), ["welcome"]);
  assert.ok(boardAt(10, 20, events, T, { withinFn }), "and the board reads what the read returned");
});

test("the snapshot is re-read once a TTL, and a failed read keeps the last board", async () => {
  const e = ev("party");
  setPinSnapshot([e], within, T);
  assert.equal(pinSnapshot(T + PINS_TTL_MS - 1).events.length, 1, "fresh: no re-read");
  const failing = { officeRead: async () => { throw new Error("the record is down"); }, announcementsOf: async () => [], withinFn: within };
  await refreshPins({ now: T + PINS_TTL_MS, ...failing });
  assert.deepEqual(pinSnapshot(T + PINS_TTL_MS + 1).events.map((x) => x.id), ["host/party"], "the last board stands");
  setPinSnapshot([], null, -Infinity);
});

test("the conversations payload's `pinned` and a say reply's board read the same snapshot", async () => {
  const { worldConversations, withNoticeBoard } = await import("../src/world.mjs");
  const now = Date.now();
  const e = ev("party", { starts: now - MIN, ends: now + 60 * MIN, x: 500, y: 500 });
  setPinSnapshot([e], within, now);
  try {
    const pinned = worldConversations().pinned;
    assert.deepEqual(pinned.map((p) => p.id), ["host/party"]);
    assert.match(pinned[0].title, /^NOW at party-hall: PARTY, until \d\d:\d\dZ$/);
    assert.match(withNoticeBoard({ where: { x: 500, y: 500 } }).notice_board[0], /^📌 NOW at party-hall: PARTY/);
    assert.ok(!("notice_board" in withNoticeBoard({ where: { x: 0, y: 0 } })), "and only at the place");
  } finally {
    setPinSnapshot([], null, -Infinity);
  }
});
