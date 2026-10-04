// one-world-per-hearing.test.mjs — ONE ROOM, ONE WORLD (Wright's shape A, 2026-10-01).
//
// A hearing snapshot (voices.mjs § snapshot, one per say) asks the structural
// hook where every audible voice is heard from. The hook used to resolve the
// world for EVERY voice — world() → publishedState → blessed() → refStamp, six
// statSyncs each — and under the endurance run's 80 agents that was 52.6% of the
// office's thread (docs/2026-10-02/rail/endurance-294/RECEIPT.md § Where the
// thread went). Now the snapshot hands every voice the same `room`, and the hook
// resolves the world once per room. The memo's freshness is untouched: a new
// snapshot is a new room, so a ref that moves is seen by the next say.
//
// The laws on trial:
//   1. every voice in one snapshot is heard through ONE room; the next snapshot
//      gets another (no stub world needed);
//   2. over N voices, the real hook asks world() once per say, not N times;
//   3. what a say hears is identical with the room and without it, on the real
//      world: two stores, the same voices and clock, one hook keeping the room and
//      one dropping it. (A deck voice is not among them: in today's world clone no
//      sampled instant puts a voice on the ferry's deck — heardFromV2 answers null
//      at all of them — so the deck path stays position-projection.test.mjs's,
//      over fixture marks; the room does not change heardFromV2.)
//
//   node --test test/one-world-per-hearing.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { createVoices, EARSHOT_M } = await import("../src/voices.mjs");
const { WORLD_CLONE, projectedHeardFrom, __worldAsksForTest } = await import("../src/world.mjs");
const { publishedState } = await import("../src/world-branches.mjs");
const { vesselPositionAt } = await import("../src/world-movement.mjs");
const { CROSSING_EPOCH_UTC, CROSSING_MS, currentCrossing } = await import("../src/crossings.mjs");

const DIR = mkdtempSync(join(tmpdir(), "postmark-one-world-"));
let logN = 0;

// A store over its own log and a hand clock, residents placed by hand, with
// whatever structural hook the case hands it.
function bench(at, heardFrom, t0) {
  const clock = { t: t0 };
  const store = createVoices({
    standpoint: async (handle) => (at[handle] ? { handle, placed: true, x: at[handle].x, y: at[handle].y } : { handle, placed: false }),
    place: async ({ x, y }) => `the ground at ${x},${y}`,
    logPath: join(DIR, `voices-${++logN}.jsonl`),
    now: () => clock.t,
    heardFrom,
    structuralHearing: () => true,
    nearby: async (point) => Object.keys(at).filter((h) => Math.hypot(at[h].x - point.x, at[h].y - point.y) <= EARSHOT_M).sort(),
  });
  return { store, clock, tick: (ms) => { clock.t += ms; } };
}

test("ONE ROOM PER SNAPSHOT: every voice a say hears is asked through the same room, and the next say gets a new one", async () => {
  const at = { a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, c: { x: 0, y: 4 }, d: { x: 5, y: 5 } };
  const calls = [];
  const b = bench(at, async (v, t, room) => { calls.push({ handle: v.handle, room }); return null; }, Date.UTC(2026, 9, 1, 9));
  for (const h of ["a", "b", "c"]) { await b.store.say(h, `${h} speaks`); b.tick(1_000); }
  calls.length = 0;
  await b.store.say("d", "who is here?");
  const first = calls.splice(0);
  assert.ok(first.length >= 4, `the say heard ${first.length} voices — the room had nothing to share`);
  assert.equal(new Set(first.map((c) => c.room)).size, 1, "every voice of one say was asked through ONE room");
  assert.equal(typeof first[0].room, "object");
  b.tick(60_000);   // past the store's one-voice-per-interval rule: a bounced say builds no room
  await b.store.say("a", "and again");
  const second = calls.splice(0);
  assert.equal(new Set(second.map((c) => c.room)).size, 1);
  assert.notEqual(second[0].room, first[0].room, "a new say is a new room — what the last one resolved is not carried over");
});

// ── the real hook, over the real world ───────────────────────────────────────

const HAVE = existsSync(join(WORLD_CLONE, "WORLD", "world-state.json"));
const SKIP = HAVE ? false : `needs a world clone at ${WORLD_CLONE}`;

// A crossing's middle instant (the ferry under way), a few crossings back so the
// world's timetable has it, and a voice spoken exactly where she is then.
async function aboard() {
  const W = publishedState(WORLD_CLONE).state;
  const n = currentCrossing() - 2;
  const spoken = CROSSING_EPOCH_UTC + (n + 0.52) * CROSSING_MS;
  const boat = await vesselPositionAt(W, spoken, { repo: WORLD_CLONE });
  return { spoken, heard: spoken + 3 * 60_000, boat };
}

test("ONE WORLD PER ROOM: over N voices the hook asks world() once with a room, and N times without one", { skip: SKIP }, async () => {
  const { spoken, heard, boat } = await aboard();
  const voices = [
    { handle: "deck", at: spoken, x: boat?.x ?? 0, y: boat?.y ?? 0, text: "on her deck" },
    ...Array.from({ length: 5 }, (_, i) => ({ handle: `shore-${i}`, at: spoken + i * 1000, x: 2500 + i * 7, y: 400 - i * 5, text: "ashore" })),
  ];
  const room = {};
  let before = __worldAsksForTest();
  for (const v of voices) await projectedHeardFrom(v, heard, room);
  assert.equal(__worldAsksForTest() - before, 1, "one room, one world");
  before = __worldAsksForTest();
  for (const v of voices) await projectedHeardFrom(v, heard);
  assert.equal(__worldAsksForTest() - before, voices.length, "no room: the world is asked per voice, as before");
});

test("A SAY ASKS THE WORLD ONCE: the real hook inside a voices store, over N audible voices", { skip: SKIP }, async () => {
  const at = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`ear-${i}`, { x: 2500 + i, y: 400 }]));
  let asksInHook = 0;
  const hook = async (v, t, room) => {
    const before = __worldAsksForTest();
    try { return await projectedHeardFrom(v, t, room); } finally { asksInHook += __worldAsksForTest() - before; }
  };
  const b = bench(at, hook, Date.now() - 60_000);
  for (const h of Object.keys(at)) { await b.store.say(h, `${h} speaks`); b.tick(500); }
  asksInHook = 0;
  b.tick(60_000);   // past the rate limit, so the counted say is not bounced
  const before = b.store.room.stats.heardFrom;
  await b.store.say("ear-0", "one more");
  const voicesHeard = b.store.room.stats.heardFrom - before;
  assert.ok(voicesHeard >= 8, `the say heard ${voicesHeard} voices`);
  assert.equal(asksInHook, 1, `${voicesHeard} voices heard, and the world was asked ${asksInHook} times — one say, one world`);
});

test("THE SAME HEARING, THROUGH A SAY: two stores, one keeping the room and one dropping it, hear the same room", { skip: SKIP }, async () => {
  const { spoken, heard, boat } = await aboard();
  assert.ok(boat, "the world's ferry has a position at the instant asked");
  // The speakers stand where their voices land: one where the ferry is as she
  // sails, one on the quay, the rest ashore within earshot of the listener.
  const at = { deck: { x: boat.x, y: boat.y }, quay: { x: 0, y: 0 }, listener: { x: 2500, y: 400 } };
  for (let i = 0; i < 4; i++) at[`shore-${i}`] = { x: 2500 + i * 9, y: 400 };
  const keep = bench(at, (v, t, room) => projectedHeardFrom(v, t, room), spoken);
  const drop = bench(at, (v, t) => projectedHeardFrom(v, t), spoken);   // the hook as it was: a world per voice
  for (const b of [keep, drop]) {
    for (const h of ["deck", "quay", "shore-0", "shore-1", "shore-2", "shore-3"]) { await b.store.say(h, `${h} speaks`); b.tick(1_000); }
    b.clock.t = heard;
  }
  const [a, z] = [await keep.store.say("listener", "what can I hear?"), await drop.store.say("listener", "what can I hear?")];
  assert.ok(!a.error && !z.error, JSON.stringify(a.error ?? z.error));
  const heardOf = (r) => JSON.stringify(r).match(/"said":/g)?.length ?? 0;
  assert.ok(heardOf(a) >= 3, `the listener heard ${heardOf(a)} voices — the equality would hold over an empty room`);
  assert.deepEqual(a, z, "the same say, the same room, the same answer — with one world or one per voice");
});
