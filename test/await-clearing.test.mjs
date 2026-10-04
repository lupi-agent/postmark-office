// await-clearing.test.mjs — THE ORDER INVERTS AT THE SWAP (G1 lane 3).
//
//   node --test test/await-clearing.test.mjs
//
// In the git era the settlement and the candle were independent: the sweep
// committed at :45:32 and the clearing locked window 177's docket at :45:44, so
// the fold ran BEFORE the clearing and did not care. After G1 the fold's input
// IS the clearing's output, so the crossing has to wait.
//
// The whole decision is in one pure function, and it is pure for a reason that
// matters more than usual here: the impure half is a sleep loop, and a sleep
// loop is the one thing a test cannot exercise honestly. So the loop does
// nothing but call this and sleep, and this is what is falsified.
//
// THE TWO WRONG CONDITIONS ARE TESTED AS WELL AS THE RIGHT ONE, because both are
// more obvious than the right one and either would ship silently:
//   "the most recently closed window" — returns the PREVIOUS crossing's docket
//     when the clearing has not run, so the wait waits for nothing.
//   "the currently open window has closed" — waits twelve hours when the
//     clearing already ran before the tool was reached.

// ── AND THE OPERATOR DOOR (postmark#2786, ruled 2026-09-14) ──────────────────
//
// The four falsifiers at the foot of this file watch `--by-hand`, the second
// door: the newest CLOSED window that is still UNFOLDED, for the operator whose
// previous crossing published nothing. The first of them is the one that matters
// most and it watches the OLD path — the timer's refusal, byte for byte —
// because a second door is only safe while the first is untouched.

import test from "node:test";
import assert from "node:assert/strict";

import {
  clearingDidNotRunDetail, docketFor, newestClosedDocket, newestWindow, nothingUnblessedDetail, nothingUnfoldedDetail,
  toMs, unblessedDocket, unfoldedDocket,
} from "../world2/tools/await-clearing.mjs";

const CROSSING_START = "2026-09-08T17:45:00Z";

/** The box's real shape: window 177 closes at :45:44, seconds after the crossing starts. */
const WINDOWS = [
  { id: 178, status: "open", cleared_at: null, town_sha: null },
  { id: 177, status: "closed", cleared_at: "2026-09-08 17:45:44.650035+00", town_sha: "723005e5" },
  { id: 176, status: "closed", cleared_at: "2026-09-08 05:45:44.368460+00", town_sha: "2a681e6c" },
  { id: 175, status: "closed", cleared_at: "2026-09-07 17:45:46.226505+00", town_sha: "a1bab20b" },
];

test("the docket is the window that closed at or after THIS crossing's start", () => {
  const d = docketFor(WINDOWS, CROSSING_START);
  assert.equal(d.window, 177);
  assert.equal(d.town_sha, "723005e5");
});

test("a clearing that has not run yet answers NULL — the wait waits", () => {
  // The state a crossing sees when it arrives before the candle: 177 is still
  // open, and the newest CLOSED window is the previous crossing's.
  const notYet = [
    { id: 177, status: "open", cleared_at: null },
    { id: 176, status: "closed", cleared_at: "2026-09-08 05:45:44.368460+00" },
  ];
  assert.equal(docketFor(notYet, CROSSING_START), null,
    "the most recently closed window is 176, which belongs to the previous crossing — answering with it is the "
    + "defect this exists to prevent, because the fold would publish nothing and look like a quiet day");
});

test("a docket cleared BEFORE this crossing started is not this crossing's", () => {
  const stale = [{ id: 176, status: "closed", cleared_at: "2026-09-08T05:45:44.368460+00" }];
  assert.equal(docketFor(stale, CROSSING_START), null);
});

test("the clearing having already run is NOT a wait — the docket is found at once", () => {
  // The other wrong condition: "wait for the currently open window to close"
  // would wait for 178, which closes twelve hours from now. The crossing's own
  // start instant separates the two cases with no timing heuristic.
  const alreadyRan = [
    { id: 178, status: "open", cleared_at: null },
    { id: 177, status: "closed", cleared_at: "2026-09-08 17:45:44.650035+00" },
  ];
  const d = docketFor(alreadyRan, CROSSING_START);
  assert.equal(d.window, 177, "the docket is the closed one, not the open one");
});

test("two windows closing while it waited: the EARLIEST qualifying one wins", () => {
  // Taking the latest would silently skip a crossing's worth of record, and it
  // would do it on exactly the slow night when the wait mattered.
  const twoClosed = [
    { id: 179, status: "open", cleared_at: null },
    { id: 178, status: "closed", cleared_at: "2026-09-08T17:52:00Z" },
    { id: 177, status: "closed", cleared_at: "2026-09-08T17:45:44Z" },
  ];
  assert.equal(docketFor(twoClosed, CROSSING_START).window, 177);
});

test("a closed window with no cleared_at is not a locked docket", () => {
  // `status='closed'` without `cleared_at` is a window mid-transition. Reading it
  // as locked would fold a docket the candle has not finished writing.
  const halfway = [{ id: 177, status: "closed", cleared_at: null }];
  assert.equal(docketFor(halfway, CROSSING_START), null);
});

test("every timestamp shape this can be handed reads as the same instant", () => {
  // ── A CORRECTION I OWE, BECAUSE I NEARLY WROTE A FINDING THAT WAS NOT ONE ──
  //
  // The first version of this test asserted that `Date.parse` FAILS on the box's
  // own output and that `toMs` was repairing a live defect. It is not. Measured:
  //
  //   psql's text form  `2026-09-08 17:45:44.650035+00`  → parses (V8's lenient
  //                                                        non-ISO path)
  //   the `pg` driver   a JS `Date` for a timestamptz    → parses
  //   `2026-09-08T17:45:44.650035+00`                     → NaN
  //
  // The third is the one that fails, and it is the one I INVENTED: I typed a `T`
  // into a fixture I had described to myself as "the box's output pasted
  // verbatim", and then read the resulting red as the box's defect. It is not a
  // shape the store produces on either path.
  //
  // `toMs` stays, because a two-digit offset is a real ISO-8601 shape that
  // arrives from JSON round trips and other tools, and because normalizing three
  // inputs to one instant is cheaper than reasoning about V8's lenient parser at
  // 05:45Z. But it is DEFENSIVE, not a repair, and this comment says so rather
  // than letting the next reader inherit my wrong version.
  const target = Date.parse("2026-09-08T17:45:44.650Z");
  assert.equal(toMs("2026-09-08 17:45:44.650+00"), target, "psql's text form");
  assert.equal(toMs("2026-09-08T17:45:44.650+00"), target, "the same with a T, which the bare parse cannot read");
  assert.equal(toMs("2026-09-08T17:45:44.650Z"), target, "plain ISO");
  assert.equal(toMs(new Date(target)), target, "and the Date the pg driver actually hands back");
  assert.ok(Number.isNaN(toMs("not-a-time")), "something genuinely unreadable stays unreadable");
});

test("an unparseable --since REFUSES rather than defaulting to the epoch", () => {
  // A `since` that parses as NaN would make every comparison false, or — with a
  // fallback to 0 — make every window qualify. Both are silent; the first waits
  // forever and the second folds the oldest docket in the store.
  assert.throws(() => docketFor(WINDOWS, "not-a-time"), /unparseable/);
});

// ── THE OPERATOR DOOR · `--by-hand` (postmark#2786) ──────────────────────────
//
// THE INSTANCE, AS A FIXTURE. On 2026-09-14 window 188 closed at 05:45Z holding
// 29 locked claims whose crossing refused on a world test; the test was fixed
// and merged by 09:1x; two reruns at 13:21Z and 13:26Z refused
// `clearing-did-not-run` because nothing had cleared since 13:21Z and nothing
// would until 17:45Z. THE SHAPE is the instance's; the shas and claim ids are
// this fixture's own and are not claimed to be the store's — a fixture that
// borrowed live values would decay at the next crossing.
const BY_HAND_START = "2026-09-14T13:21:00Z";

const INSTANCE = [
  { id: 189, status: "open", cleared_at: null, town_sha: null },
  { id: 188, status: "closed", cleared_at: "2026-09-14 05:45:44.112907+00", town_sha: "f1f1f1f1" },
  { id: 187, status: "closed", cleared_at: "2026-09-13 17:45:44.906311+00", town_sha: "e0e0e0e0" },
];

/** The notary's read (`canon-locks.mjs § UNMATERIALIZED_SELECT`): locked, no mark. */
const lockedUnmaterialized = (windowId, n) => Array.from({ length: n }, (_, i) => ({
  claim_id: String(windowId * 100 + i), window_id: windowId,
  claimant: `resident-${i}`, slug: `resident-${i}/a-mark`,
}));

const INSTANCE_UNFOLDED = lockedUnmaterialized(188, 29);

test("FALSIFIER 1 · the timer's path is UNCHANGED — the instance still refuses, in the same words", () => {
  // THE ONE THAT MATTERS MOST. The operator door is only safe while the guard it
  // stands beside is untouched: relaxing "cleared at or after this crossing's
  // start" is exactly how the 2026-08-26 starving crossing gets published under a
  // fresh receipt. So the day's own state — 188 closed at 05:45Z, unfolded, 189
  // open, a crossing starting at 13:21Z — is asserted to refuse, and the refusal
  // is asserted BYTE FOR BYTE rather than by a regex over a word or two, because
  // a message the operator reads at 13:21Z is the whole of what tells them which
  // door they are standing at.
  assert.equal(docketFor(INSTANCE, BY_HAND_START), null,
    "nothing cleared at or after 13:21Z — the timer must still wait, and then refuse");

  assert.equal(
    clearingDidNotRunDetail({ waitedS: 240, since: BY_HAND_START, newest: newestWindow(INSTANCE) }),
    "waited 240s and no window cleared at or after this crossing's start (2026-09-14T13:21:00Z). "
    + "The newest window is 189 (open, cleared_at null). "
    + "The candle has not locked this crossing's docket, so there is no delta to fold. Folding the previous "
    + "window again would publish nothing and look like a quiet crossing, which is the 2026-08-26 starving "
    + "shape with better paperwork.");
});

test("FALSIFIER 2 · --by-hand takes the UNFOLDED docket, and takes it because it is unfolded", () => {
  // ARM ONE — the instance. Window 188 is the one holding 29 locked claims the
  // world carries no mark for, and it is what an operator at 13:21Z should be
  // handed.
  const d = unfoldedDocket(INSTANCE, INSTANCE_UNFOLDED);
  assert.equal(d.window, 188);
  assert.equal(d.by_hand, true, "a by-hand publication must never be mistaken for a scheduled one");
  assert.equal(d.town_sha, "f1f1f1f1");
  assert.equal(d.cleared_at, "2026-09-14 05:45:44.112907+00");

  // ARM TWO — AND THE FIRST ARM ALONE CANNOT FAIL. On the instance, 188 is both
  // the newest closed window AND the unfolded one, so "take the newest closed
  // window" and "take the newest UNFOLDED window" agree there, and a door that
  // ignored the notary's read entirely would pass arm one. Here they disagree:
  // 188 is published, 187 is not. The unfolded one wins.
  const olderIsTheUnfoldedOne = unfoldedDocket(INSTANCE, lockedUnmaterialized(187, 2));
  assert.equal(olderIsTheUnfoldedOne.window, 187,
    "the choice is unfoldedness, not recency — 188 is newer and has nothing left to publish");
});

test("FALSIFIER 3 · --by-hand REFUSES a world that is already published, and names where the town is", () => {
  // A by-hand sweep with nothing unfolded is not an error and not a success: it
  // is the answer "the world already carries this". Publishing a second copy of
  // a published window under a fresh receipt is the starving shape reached by the
  // other door.
  assert.equal(unfoldedDocket(INSTANCE, []), null);

  assert.equal(
    nothingUnfoldedDetail({ newest: newestWindow(INSTANCE) }),
    "no closed window still holds a locked claim with no materialized mark, so there is nothing for a "
    + "by-hand sweep to publish. "
    + "The newest window is 189 (open, cleared_at null). "
    + "Every closed window's claims are already materialized: the record this run would publish is the record "
    + "the world already carries. Claims filed since the last close belong to the OPEN window, and closing that "
    + "window early is the candle's act, not this one's.");
});

test("FALSIFIER 4 · --by-hand NEVER takes the open window", () => {
  // Claims filed since the last close sit in the OPEN window, and they are the
  // tempting thing to reach for at 13:21Z — an operator who wants "everything
  // filed so far" is one flag away from asking this tool to fold a window the
  // candle has not locked. Closing a window early is a different act with a
  // different pen (`clearing-job.mjs --window N`) and was ruled out of this
  // door's scope.
  //
  // THE FIXTURE PUTS THE ONLY UNFOLDED CLAIMS IN THE OPEN WINDOW and leaves
  // every closed window published, so the sole lawful answer is the refusal.
  assert.equal(unfoldedDocket(INSTANCE, lockedUnmaterialized(189, 4)), null,
    "189 is open — its docket is not locked, and an unlocked docket is nobody's to fold");

  // ── AND THE STATUS GUARD IS PROVED ON ITS OWN (reviewer, 2026-09-14) ───────
  //
  // THE ARM ABOVE DOES NOT PROVE WHAT IT CLAIMS, and this is the correction.
  // Window 189 there carries `cleared_at: null`, so it is refused by the
  // finite-instant filter two lines later, not by `status === "closed"` — drop
  // the status test alone and that arm stays green. A guard nothing exercises is
  // a guard that can be deleted by accident, and this one's own comment calls it
  // law: the open window "is never any sweep's to take".
  //
  // So here is the shape that reaches the status test and nothing else: an open
  // window carrying BOTH a `cleared_at` and the only unfolded claims. The store
  // does not produce it — the candle writes `cleared_at` in the same act that
  // closes the window — and that is the point. What a guard is for is the row
  // that should not exist: a half-applied migration, a repair typed by hand at
  // 05:52Z, a fixture somebody wrote from memory. The status is the law, so the
  // status decides, and a stamp on an open window buys nothing.
  const openWithAStamp = [
    { id: 189, status: "open", cleared_at: "2026-09-14 13:30:00.000000+00", town_sha: "d0d0d0d0" },
    { id: 188, status: "closed", cleared_at: "2026-09-14 05:45:44.112907+00", town_sha: "f1f1f1f1" },
  ];
  assert.equal(unfoldedDocket(openWithAStamp, lockedUnmaterialized(189, 3)), null,
    "an OPEN window is refused by its status alone, however cleared it looks — and 188, the only closed "
    + "window here, has nothing left to publish, so the answer is the refusal and not a fallback");

  // And a closed window that never finished its transition is not a docket
  // either, by the same rule the timer's path already holds. This is the other
  // half of the pair: there the status passes and the instant refuses.
  const halfway = [{ id: 189, status: "closed", cleared_at: null, town_sha: null }];
  assert.equal(unfoldedDocket(halfway, lockedUnmaterialized(189, 4)), null);
});

// ── AND THE SHADOW'S QUESTION (2026-09-25) ──────────────────────────────────
//
// `--rehearse` asks for the newest CLOSED window — the only one `foldDelta`
// will fold — because the shadow runs between crossings, where the timer's
// question has no answer and, on a healthy day, neither has the operator's.

test("--rehearse takes the newest closed window by id, whether or not it is folded", () => {
  const windows = [
    { id: 211, status: "open", cleared_at: null, town_sha: null },
    { id: 210, status: "closed", cleared_at: "2026-09-25 05:45:40.1+00", town_sha: "3a0df340" },
    { id: 209, status: "closed", cleared_at: "2026-09-24 17:45:41.2+00", town_sha: "f7e0f595" },
  ];
  assert.deepEqual(newestClosedDocket(windows),
    { window: 210, cleared_at: "2026-09-25 05:45:40.1+00", town_sha: "3a0df340", rehearsal: true });
  // The timer, asked the same store at the shadow's hour, has no answer — which
  // is why the shadow cannot borrow its question.
  assert.equal(docketFor(windows, "2026-09-25T10:23:00Z"), null);
});

test("--rehearse never takes the open window, nor a closed one with no cleared_at", () => {
  assert.equal(newestClosedDocket([{ id: 211, status: "open", cleared_at: "2026-09-25 13:00:00+00" }]), null);
  assert.equal(newestClosedDocket([{ id: 210, status: "closed", cleared_at: null }]), null);
  assert.equal(newestClosedDocket([]), null);
});

// ── THE OPERATOR DOOR SINCE THE STORE CUTOVER (Darko, 2026-10-04) ────────────
//
// THE INSTANCE: window 228 was cleared by hand at 12:13Z with 10 claims locked
// AND materialized (the clearing materializes in the same transaction since the
// cutover), the newest blessed settlement (S92) had folded window 224, and the
// by-hand sweep refused `nothing-unfolded` because `unfoldedDocket` asks for a
// locked claim with no mark row, which no longer exists after any clearing.
const CUTOVER = [
  { id: 229, status: "open", cleared_at: null, town_sha: null },
  { id: 228, status: "closed", cleared_at: "2026-10-04 12:13:40.149382+00", town_sha: "fd711d67" },
  { id: 227, status: "closed", cleared_at: "2026-10-03 18:00:21.076361+00", town_sha: "a71c3cfd" },
  { id: 224, status: "closed", cleared_at: "2026-10-02 06:00:20.000000+00", town_sha: "c0c0c0c0" },
];

test("CUTOVER 1 · the instance: every claim materialized, so the old predicate answers null — and the new one takes 228", () => {
  // The old door, against the store-era shape (no unmaterialized rows): null.
  assert.equal(unfoldedDocket(CUTOVER, []), null, "the git-era predicate is dead after any successful clearing");
  // The new door: the newest closed window newer than the newest blessed settlement's window.
  const d = unblessedDocket(CUTOVER, 224);
  assert.equal(d.window, 228);
  assert.equal(d.by_hand, true, "a by-hand publication must never be mistaken for a scheduled one");
});

test("CUTOVER 2 · a window already folded into a blessed settlement is refused, with words naming both", () => {
  assert.equal(unblessedDocket(CUTOVER, 228), null);
  assert.equal(
    nothingUnblessedDetail({ newest: newestWindow(CUTOVER), lastBlessedWindow: 228 }),
    "every closed window is already folded into a blessed settlement (the newest blessed settlement folded window 228), "
    + "so there is nothing for a by-hand sweep to publish. "
    + "The newest window is 229 (open, cleared_at null). "
    + "Claims filed since the last close belong to the OPEN window; close it with the candle first "
    + "(postmark-world2-clearing.service), then run this again.");
});

test("CUTOVER 3 · it never takes the open window, nor a closed one mid-transition", () => {
  assert.equal(unblessedDocket([{ id: 229, status: "open", cleared_at: null }], 224), null);
  assert.equal(unblessedDocket([{ id: 228, status: "closed", cleared_at: null }], 224), null,
    "a closed window with no cleared_at is mid-transition");
});

test("CUTOVER 4 · no settlement yet takes the newest closed window", () => {
  assert.equal(unblessedDocket(CUTOVER, null).window, 228);
});

test("CUTOVER 5 · the CLI's by-hand branch asks the blessed record, not the unmaterialized one", async () => {
  // The branch is DB-bound, so its wiring is held by its source: the by-hand door
  // must call unblessedDocket over `settlements`, and must not fall back to the
  // git-era predicate that left it dead from the cutover to 2026-10-04.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../world2/tools/await-clearing.mjs", import.meta.url), "utf8");
  const branch = src.slice(src.indexOf("} else if (byHand) {"), src.indexOf("} else {", src.indexOf("} else if (byHand) {")));
  assert.match(branch, /unblessedDocket\(rows, lastBlessedWindow\)/);
  assert.match(branch, /FROM settlements/);
  assert.doesNotMatch(branch, /UNMATERIALIZED_SELECT/);
});
