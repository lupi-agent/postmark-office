// rsvp-wakes-note.test.mjs — what an RSVP's receipt says about its wakes
// (Keemin 2026-09-27: "make sure the rsvp form via office and site convey this
// stuff clearly so we don't mislead residents and humans").

import test from "node:test";
import assert from "node:assert/strict";
import { mailSailings, wakesNote } from "../src/earpiece.mjs";

// Friday's Office Hours: one hour between the 12:00 and 00:00 crossings.
const HOUR = { starts: "2026-10-02T20:00:00.000Z", ends: "2026-10-02T21:00:00.000Z" };
// Doors at 11:00, over the noon crossing, ending at 13:30.
const ACROSS = { doors_open: "2026-10-02T11:00:00.000Z", starts: "2026-10-02T11:30:00.000Z", ends: "2026-10-02T13:30:00.000Z" };

test("mail · an event between two crossings sails one letter, after it ends", () => {
  assert.deepEqual(mailSailings(HOUR), ["2026-10-03T00:00:00.000Z"]);
  const n = wakesNote({ kind: "mail", event: HOUR, enabled: true });
  assert.match(n, /one letter, sailing 2026-10-03 00:00 UTC, after it has ended/);
  assert.match(n, /RSVP with a webhook/);
});

test("mail · an event across a crossing names every sailing, from the doors", () => {
  assert.deepEqual(mailSailings(ACROSS), ["2026-10-02T12:00:00.000Z", "2026-10-03T00:00:00.000Z"]);
  assert.match(wakesNote({ kind: "mail", event: ACROSS, enabled: true }), /sail 2026-10-02 12:00 UTC, 2026-10-03 00:00 UTC/);
});

test("mail · an event ending ON a crossing sails its last letter on that crossing", () => {
  assert.deepEqual(mailSailings({ starts: "2026-10-02T23:00:00.000Z", ends: "2026-10-03T00:00:00.000Z" }), ["2026-10-03T00:00:00.000Z"]);
});

test("webhook · the live one: the window, the five minutes, the secret", () => {
  const n = wakesNote({ kind: "webhook", event: ACROSS, enabled: true });
  assert.match(n, /woken live while the doors are open \(2026-10-02 11:00 UTC to 2026-10-02 13:30 UTC\)/);
  assert.match(n, /at most once every 5 minutes/);
  assert.doesNotMatch(n, /letter/);
});

test("letta · says it is mail for now, and why", () => {
  const n = wakesNote({ kind: "letta", event: HOUR, enabled: true });
  assert.match(n, /no Letta client yet \(POS-210\), so a Letta RSVP is woken by mail/);
  assert.match(n, /one letter, sailing/);
});

test("the switch · off says so first, on says nothing about it", () => {
  assert.match(wakesNote({ kind: "webhook", event: HOUR, enabled: false }), /^The earpiece is switched off in this office right now/);
  assert.doesNotMatch(wakesNote({ kind: "webhook", event: HOUR, enabled: true }), /switched off/);
});

test("announcements · every note says they come too, outside the budget", () => {
  for (const kind of ["mail", "webhook", "letta"])
    assert.match(wakesNote({ kind, event: HOUR, enabled: true }), /announcements reach you the same way and do not count against your budget/);
});
