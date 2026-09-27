// rsvp-wakes-note.test.mjs — what an RSVP's receipt says it will do
// (Keemin 2026-09-27: "make sure the rsvp form via office and site convey this
// stuff clearly so we don't mislead residents and humans"; then "can we just
// have it not show up in the office and site as an option for now?" — mail
// and Letta are not offered, the webhook is experimental).

import test from "node:test";
import assert from "node:assert/strict";
import { wakesNote } from "../src/earpiece.mjs";

// Friday's Office Hours: one hour between the 12:00 and 00:00 crossings.
const HOUR = { starts: "2026-10-02T20:00:00.000Z", ends: "2026-10-02T21:00:00.000Z" };
// Doors at 11:00, over the noon crossing, ending at 13:30.
const ACROSS = { doors_open: "2026-10-02T11:00:00.000Z", starts: "2026-10-02T11:30:00.000Z", ends: "2026-10-02T13:30:00.000Z" };

test("no webhook · the guest list: nothing is sent, come to the place, and no letter is promised", () => {
  for (const kind of ["mail", "letta", undefined]) {
    const n = wakesNote({ kind, event: HOUR, enabled: true });
    assert.match(n, /^You are on the guest list\. Nothing is sent to you/);
    assert.match(n, /come to the place while the doors are open \(2026-10-02 20:00 UTC to 2026-10-02 21:00 UTC\)/);
    assert.doesNotMatch(n, /letter|mail|Letta|crossing/i);
  }
});

test("webhook · experimental, live: the window from the doors, the five minutes, the secret", () => {
  const n = wakesNote({ kind: "webhook", event: ACROSS, enabled: true });
  assert.match(n, /^EXPERIMENTAL: your webhook is woken live while the doors are open \(2026-10-02 11:00 UTC to 2026-10-02 13:30 UTC\)/);
  assert.match(n, /at most once every 5 minutes/);
  assert.match(n, /announcements reach it too and do not count against your budget/);
  assert.doesNotMatch(n, /letter/);
});

test("the switch · off says so first for a webhook; the guest list has nothing to switch", () => {
  assert.match(wakesNote({ kind: "webhook", event: HOUR, enabled: false }), /^The earpiece is switched off in this office right now/);
  assert.doesNotMatch(wakesNote({ kind: "webhook", event: HOUR, enabled: true }), /switched off/);
  assert.doesNotMatch(wakesNote({ kind: "mail", event: HOUR, enabled: false }), /switched off/);
});
