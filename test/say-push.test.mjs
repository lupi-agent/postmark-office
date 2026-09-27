// say-push.test.mjs — THE WAITERS (POS-265, the second half), and the say's
// retry key kept in the record.
//
// The laws on trial, from the brief (Linear POS-265, "BRIEF, lane
// jetto-say-push"):
//
//   "agents get a long-poll (world read: say with since and wait:<=25 s returns
//    as soon as a new voice lands in earshot, or empty at the deadline)"
//   "One room state per place, fanned out, never computed per connection.
//    Prove: 50 open waiters cost one room computation per new voice (count it)."
//   "a retry after an office restart returns the first say's receipt and
//    records nothing new"
//
// The count is read off the store's own counters (voices.mjs § room.stats):
// `rooms` is every snapshot built, `heardFrom` every relocation read, `nearby`
// every per-ear presence read. The control beside it is fifty plain listens,
// which is what fifty lingering agents cost before this.
//
//   node --test test/say-push.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");
const { createVoices, EARSHOT_M } = await import("../src/voices.mjs");
const { createSayPush, waitMsOf, WAIT_MAX_S, WAITERS_PER_HANDLE } = await import("../src/say-push.mjs");

const DIR = mkdtempSync(join(tmpdir(), "postmark-say-push-"));
const T0 = Date.UTC(2026, 8, 27, 0, 0, 0);
let logN = 0;

// A store over its own log, a hand clock, hand-placed residents, and counting
// hooks: every structural relocation and every presence read is counted.
function bench(at, { log = null } = {}) {
  const clock = { t: T0 };
  const path = log ?? join(DIR, `voices-${++logN}.jsonl`);
  const counted = { heardFrom: 0, nearby: 0, nearbyMany: 0 };
  const within = (point) => Object.keys(at)
    .filter((h) => Math.hypot(at[h].x - point.x, at[h].y - point.y) <= EARSHOT_M).sort();
  const store = createVoices({
    standpoint: async (handle) => (at[handle] ? { handle, placed: true, x: at[handle].x, y: at[handle].y } : { handle, placed: false }),
    place: async ({ x, y }) => `the ground at ${x},${y}`,
    logPath: path,
    now: () => clock.t,
    // structural hearing on, so the relocation is a real, countable read
    heardFrom: async (v) => { counted.heardFrom += 1; return { x: v.x, y: v.y }; },
    structuralHearing: () => true,
    nearby: async (point) => { counted.nearby += 1; return within(point); },
  });
  const nearbyMany = async (ears) => { counted.nearbyMany += 1; return ears.map(({ at: p }) => within(p)); };
  return { store, clock, path, counted, nearbyMany, within, tick: (ms) => { clock.t += ms; } };
}

// A timer the test drives: the deadline fires when the test says so.
function handTimers() {
  const timers = new Set();
  return {
    setTimer: (fn) => { const t = { fn }; timers.add(t); return t; },
    clearTimer: (t) => { timers.delete(t); },
    fireAll: () => { for (const t of [...timers]) { timers.delete(t); t.fn(); } },
    get count() { return timers.size; },
  };
}

const crowd = (n, { x = 0, y = 0 } = {}) => {
  const at = { speaker: { x, y } };
  for (let i = 0; i < n; i++) at[`ear-${String(i).padStart(2, "0")}`] = { x: x + (i % 10), y: y + Math.floor(i / 10) };
  return at;
};

test("50 OPEN WAITERS COST ONE ROOM PER NEW VOICE — and all fifty hear it", async () => {
  const b = bench(crowd(50));
  const timers = handTimers();
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  await b.store.say("speaker", "the room opens");
  const since = b.clock.t;
  b.tick(20_000);
  const ears = Object.keys(crowd(50)).filter((h) => h !== "speaker");
  const answers = ears.map((h) => push.wait(h, { since, waitMs: 25_000 }));
  await new Promise((r) => setImmediate(r));
  assert.equal(push.open, 50, "fifty ears are open");

  const before = { ...b.store.room.stats };
  const heardBefore = b.counted.heardFrom;
  const nearbyBefore = b.counted.nearby;
  await b.store.say("speaker", "can everyone hear me?");
  await push.settled();
  const got = await Promise.all(answers);

  // the count, which is the whole claim
  const rooms = b.store.room.stats.rooms - before.rooms;
  assert.equal(rooms, 2, `one room for the speaker's own reply and ONE for the fifty waiters — got ${rooms}`);
  assert.equal(push.stats.fanouts, 1, "one fan-out for the voice");
  // two audible voices, relocated once each per room — never once per ear
  assert.equal(b.counted.heardFrom - heardBefore, 2 * 2, "relocations scale with rooms × voices, not with waiters");
  assert.equal(b.counted.nearbyMany, 1, "who is here BY POSITION is read once for all fifty ears");
  assert.equal(b.counted.nearby - nearbyBefore, 1, "the only per-ear presence read is the speaker's own reply");
  // and every ear heard it
  for (const r of got) {
    assert.equal(r.voices.length, 1, "each waiter carries exactly the new voice");
    assert.equal(r.voices[0].said, "can everyone hear me?");
    assert.ok(Number.isFinite(r.waited_ms));
  }
  assert.equal(push.open, 0, "every ear answered and closed");
  assert.equal(timers.count, 0, "every deadline was cleared");
});

test("THE CONTROL: fifty plain listens cost fifty rooms (what lingering cost before the push)", async () => {
  const b = bench(crowd(50));
  await b.store.say("speaker", "the room opens");
  const since = b.clock.t;
  b.tick(20_000);
  await b.store.say("speaker", "can everyone hear me?");
  const before = b.store.room.stats.rooms;
  const ears = Object.keys(crowd(50)).filter((h) => h !== "speaker");
  for (const h of ears) await b.store.hear(h, { since });
  assert.equal(b.store.room.stats.rooms - before, 50);
});

test("a woken waiter's answer IS the say's own delta — byte for byte what a listen at that instant answers", async () => {
  const at = { speaker: { x: 0, y: 0 }, ear: { x: 10, y: 0 }, twin: { x: 10, y: 0 } };
  const b = bench(at);
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  await b.store.say("speaker", "first");
  const since = b.clock.t;
  // both ears carry the same delta memory: the reply that handed out `since`
  await b.store.hear("ear", {}); await b.store.hear("twin", {});
  b.tick(20_000);
  const waiting = push.wait("ear", { since: (await b.store.hear("ear", {})).latest, waitMs: 25_000 });
  const twinSince = (await b.store.hear("twin", {})).latest;
  await b.store.say("speaker", "second");
  await push.settled();
  const woke = await waiting;
  const listened = await b.store.hear("twin", { since: twinSince });
  const { waited_ms, ...body } = woke;
  assert.deepEqual(body, listened);
  assert.ok(since <= woke.latest);
});

test("an ear out of earshot is not woken, and its deadline answers empty with the cursor unmoved", async () => {
  const b = bench({ speaker: { x: 0, y: 0 }, far: { x: 0, y: EARSHOT_M + 50 } });
  const timers = handTimers();
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const since = b.clock.t;
  const waiting = push.wait("far", { since, waitMs: 25_000 });
  await new Promise((r) => setImmediate(r));
  b.tick(1000); // newer than the cursor: only the distance keeps it out
  await b.store.say("speaker", "you cannot hear this");
  await push.settled();
  assert.equal(push.open, 1, "the far ear is still waiting");
  timers.fireAll();
  const r = await waiting;
  assert.deepEqual(r.voices, []);
  assert.equal(r.latest, since, "the cursor has not moved");
  assert.equal(r.spoke, false);
  assert.match(r.note, /nothing new within earshot in 25s/);
  assert.equal(push.stats.timed_out, 1);
});

test("voices landing in the same turn share one fan-out", async () => {
  const b = bench({ a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, ear: { x: 10, y: 0 } });
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  const since = b.clock.t;
  const waiting = push.wait("ear", { since, waitMs: 25_000 });
  await new Promise((r) => setImmediate(r));
  b.tick(1000);
  await Promise.all([b.store.say("a", "one"), b.store.say("b", "two")]);
  await push.settled();
  const r = await waiting;
  assert.equal(push.stats.fanouts, 1);
  assert.deepEqual(r.voices.map((v) => v.said), ["one", "two"]);
});

test("a voice already newer than the cursor answers the wait at once; nothing newer costs no room", async () => {
  const b = bench({ speaker: { x: 0, y: 0 }, ear: { x: 10, y: 0 } });
  const timers = handTimers();
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const before = b.clock.t - 1;
  await b.store.say("speaker", "already said");
  const r = await push.wait("ear", { since: before, waitMs: 25_000 });
  assert.equal(r.voices[0].said, "already said");
  const rooms = b.store.room.stats.rooms;
  const quiet = push.wait("ear", { since: b.clock.t, waitMs: 25_000 });
  await new Promise((res) => setImmediate(res));
  assert.equal(b.store.room.stats.rooms, rooms, "an arrival with nothing newer than its cursor reads no room");
  timers.fireAll();
  assert.deepEqual((await quiet).voices, []);
});

test("THE STREAM: the room first, then a delta per voice in earshot, the cursor advancing; close stops it", async () => {
  const b = bench({ speaker: { x: 0, y: 0 }, page: { x: 10, y: 0 } });
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  await b.store.say("speaker", "before the page opened");
  const events = [];
  const s = await push.stream("page", {}, (r) => events.push(r));
  assert.equal(events.length, 1, "the room, on connect");
  assert.equal(events[0].voices[0].said, "before the page opened");
  b.tick(20_000);
  await b.store.say("speaker", "while it listens");
  await push.settled();
  assert.equal(events.length, 2);
  assert.deepEqual(events[1].voices.map((v) => v.said), ["while it listens"], "a delta: only the new voice");
  b.tick(20_000);
  await b.store.say("speaker", "and again");
  await push.settled();
  assert.deepEqual(events[2].voices.map((v) => v.said), ["and again"], "the cursor advanced with the last event");
  s.close();
  b.tick(20_000);
  await b.store.say("speaker", "after it closed");
  await push.settled();
  assert.equal(events.length, 3, "a closed stream hears nothing");
  assert.equal(push.open, 0);
});

test("a handle holds a few open ears, not a crowd", async () => {
  const b = bench({ ear: { x: 0, y: 0 } });
  const timers = handTimers();
  const push = createSayPush({ voices: b.store, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  const open = [];
  for (let i = 0; i < WAITERS_PER_HANDLE; i++) open.push(push.wait("ear", { since: b.clock.t, waitMs: 25_000 }));
  await new Promise((r) => setImmediate(r));
  const refused = await push.wait("ear", { since: b.clock.t, waitMs: 25_000 });
  assert.equal(refused.error, "bounce");
  assert.match(refused.defect, /already has 4 open ears/);
  timers.fireAll();
  await Promise.all(open);
});

test("wait is refused, never trimmed: over the cap, without since, with text", () => {
  assert.equal(waitMsOf({}).waitMs, null, "absent is a plain listen");
  assert.equal(waitMsOf({ wait: 25, since: 1 }).waitMs, 25_000);
  assert.match(waitMsOf({ wait: WAIT_MAX_S + 1, since: 1 }).bounce.defect, /at most 25/);
  assert.match(waitMsOf({ wait: 0, since: 1 }).bounce.defect, /above 0/);
  assert.match(waitMsOf({ wait: 5 }).bounce.defect, /wait needs since/);
  assert.match(waitMsOf({ wait: 5, since: 1, text: "hi" }).bounce.defect, /a wait is a listen/);
});

// ── THE RETRY KEY, KEPT IN THE RECORD ────────────────────────────────────────

test("POS-265 durable nonce: after a restart the record answers the retry — the first say's receipt, and no second voice", async () => {
  const at = { caelan: { x: 0, y: 0 } };
  const record = new Map(); // "<handle> <nonce>" -> at: the acts column, standing in
  const pen = async (voice, spoken) => { if (spoken?.nonce) record.set(`${voice.handle} ${spoken.nonce}`, voice.at); return null; };
  const spentNonce = async (handle, nonce, sinceMs) => { const t = record.get(`${handle} ${nonce}`); return t != null && t >= sinceMs ? t : null; };
  const log = join(DIR, "durable.jsonl");
  const clock = { t: T0 };
  const office = () => createVoices({
    standpoint: async (h) => ({ handle: h, placed: true, ...at[h] }),
    logPath: log, now: () => clock.t, beforeSpoke: pen, spentNonce, nonceKept: async () => true,
  });
  const first = await office().say("caelan", "an entrance", { nonce: "enter-1" });
  assert.equal(first.spoke, true);
  assert.match(first.idempotent, /kept on this voice's act/);
  clock.t += 3 * 60_000;                   // the brownout: three minutes, and a restart
  const again = await office().say("caelan", "an entrance", { nonce: "enter-1" });
  assert.equal(again.duplicate, true, "the record remembered what the process forgot");
  assert.equal(again.spoken_at, new Date(T0).toISOString());
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 1, "one voice in the log, not two");
});

test("THE CONTROL: with no record to ask, the restarted office speaks the retry again (the gap 027 closes)", async () => {
  const log = join(DIR, "no-record.jsonl");
  const clock = { t: T0 };
  const office = () => createVoices({
    standpoint: async (h) => ({ handle: h, placed: true, x: 0, y: 0 }),
    logPath: log, now: () => clock.t,
  });
  const first = await office().say("caelan", "an entrance", { nonce: "enter-1" });
  assert.match(first.idempotent, /while this office stays up/);
  clock.t += 3 * 60_000;
  const again = await office().say("caelan", "an entrance", { nonce: "enter-1" });
  assert.equal(again.duplicate, undefined);
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 2);
});

test("a record lookup that trips is a miss, never a refused voice", async () => {
  const log = join(DIR, "tripping.jsonl");
  const store = createVoices({
    standpoint: async (h) => ({ handle: h, placed: true, x: 0, y: 0 }),
    logPath: log, now: () => T0,
    spentNonce: async () => { throw new Error("the store tripped"); },
  });
  const r = await store.say("caelan", "still heard", { nonce: "n" });
  assert.equal(r.spoke, true);
});

test("the nonce rides to the pen and the listener beside the voice, and never into the voices log", async () => {
  const log = join(DIR, "carried.jsonl");
  const seen = [];
  const store = createVoices({
    standpoint: async (h) => ({ handle: h, placed: true, x: 0, y: 0 }),
    logPath: log, now: () => T0,
    beforeSpoke: async (v, spoken) => { seen.push(["pen", spoken.nonce]); return null; },
    onSpoke: (v, spoken) => seen.push(["listener", spoken.nonce]),
  });
  await store.say("caelan", "keyed", { nonce: "n-1" });
  await store.say("rei", "unkeyed");
  assert.deepEqual(seen, [["pen", "n-1"], ["listener", "n-1"], ["pen", undefined], ["listener", undefined]]);
  assert.ok(!readFileSync(log, "utf8").includes("n-1"), "the voices log's ruled shape carries no nonce");
});

// ── THE WIRE: Server-Sent Events ─────────────────────────────────────────────

const { serveSayStream } = await import("../src/say-push.mjs");
const { EventEmitter } = await import("node:events");
const fakeRes = () => {
  const res = new EventEmitter();
  res.head = null; res.body = "";
  res.writeHead = (code, headers) => { res.head = { code, headers }; };
  res.write = (s) => { res.body += s; return true; };
  return res;
};

test("the stream's wire: headers on the first event, `event: room` frames, a bounce written before any event, close on disconnect", async () => {
  const b = bench({ speaker: { x: 0, y: 0 }, page: { x: 10, y: 0 } });
  const push = createSayPush({ voices: b.store, nearbyMany: b.nearbyMany });
  await b.store.say("speaker", "hello, page");
  const req = new EventEmitter();
  const res = fakeRes();
  await serveSayStream(req, res, (send) => push.stream("page", {}, send), { beatMs: 60_000, onBounce: () => assert.fail("no bounce expected") });
  assert.equal(res.head.code, 200);
  assert.match(res.head.headers["content-type"], /^text\/event-stream/);
  const [frame] = res.body.split("\n\n");
  assert.match(frame, /^event: room\ndata: /);
  assert.equal(JSON.parse(frame.slice(frame.indexOf("data: ") + 6)).voices[0].said, "hello, page");
  assert.equal(push.open, 1);
  req.emit("close");
  assert.equal(push.open, 0, "a closed connection is a closed ear");

  const refusedRes = fakeRes();
  let refusal = null;
  await serveSayStream(new EventEmitter(), refusedRes, (send) => push.stream("nobody", {}, send), { onBounce: (r) => { refusal = r; } });
  assert.equal(refusal.error, "bounce");
  assert.equal(refusedRes.head, null, "a refusal is written as JSON by the door, before any event");
});
