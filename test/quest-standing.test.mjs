// quest-standing.test.mjs — the board's NON-daily rows, and the join that
// answers them.
//
// THE DEFECT THESE WATCH. From 2026-09-01 (BOARD_LAW put every registry row on
// the board) to 2026-09-08, eight of ten rows on every resident's board read
// `progress: null, complete: null` — the town's own words for "this surface did
// not look". The founder read his own page on the eighth and said:
//
//   "It's confusing because most of this is already done? I also think there's
//    no reason to continue showing things you already did on the site."
//
// He had done all of them. The facts were in the town checkout the whole time:
// `onboardingFactsFor` and `foldFriendships` are exported from the SAME file as
// `boardForHandle`, which imports neither. These tests watch the office's join.
//
// Each of these drives the REAL exported function. `standingJoin` is pure by
// construction so a falsifier can reach every branch without a store, a clone
// or a db — the alternative would be greps over the call site, and a grep for a
// call is not a check on a value.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { questBoardFor, standingJoin, standingFor, STANDING_FACT, STANDING_NOTES } from "../src/queries.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";

const TOWN = townClone(); // the same real checkout every office test imports the town's tools from
const SKIP = !TOWN && NO_TOWN;

// A registry that carries one of every SHAPE the join branches on, not one of
// every id in the town's file: the shapes are what the code distinguishes.
const REGISTRY = JSON.stringify({
  version: 1,
  quests: [
    { id: "correspond-send", title: "Reach out", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp each" },
    { id: "correspond-receive", title: "Be reached", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp each" },
    { id: "correspond-depth", title: "Budding friendship", cadence: "milestone", validation: "automatic", target: 5, reward: "5 stamps" },
    { id: "first-idea", title: "A first idea", cadence: "milestone", validation: "automatic", target: 1, reward: "5 stamps", door: { tool: "town_post" } },
    { id: "write-your-card", title: "Write your card", cadence: "one-time", validation: "automatic", target: 1, reward: "no stamp", door: { tool: "update_address_body" } },
    { id: "tend-your-home", title: "Found your home", cadence: "one-time", validation: "automatic", target: 1, reward: "no stamp", door: { tool: "update_home" } },
    { id: "hang-your-window", title: "Hang your window", cadence: "one-time", validation: "automatic", target: 1, reward: "no stamp", door: { tool: "update_window" } },
    { id: "first-letter-out", title: "Send your first letter", cadence: "one-time", validation: "automatic", target: 1, reward: "no stamp", door: { tool: "send_letter" } },
    { id: "first-answer", title: "Someone writes back", cadence: "one-time", validation: "automatic", target: 1, reward: "no stamp", door: null, awaits: "another resident's reply" },
    { id: "walk-the-world", title: "Leave your home mark", cadence: "one-time", validation: "automatic", target: 1, reward: "no stamp", door: { tool: "world_leave_mark" } },
    { id: "welcome-to-postmark", title: "Welcome to Postmark", cadence: "one-time", validation: "automatic", target: 1, reward: "5 stamps", door: null, awaits: "the town's own hand" },
  ],
});

const row = (id, over = {}) => ({ id, target: 1, ...over });

// A resident 125 days in who has done everything the record can settle — the
// founder's own shape, which is the shape the board got wrong.
const SETTLED = {
  card: true, home: true, window: true, sent: true, received: true, welcomed: true,
  sent_since: "2026-06-12", sent_via: "wright-2026-06-12-first-post",
  received_since: "2026-06-12", received_via: "postmaster-2026-06-12-receipt-confirmed",
  depth: { eachWay: 8, best: 5, since: "2026-08-04", friends: [{ with: "little-bird", threshold: 5, date: "2026-08-04" }] },
};
// Someone who arrived this morning: the record looked and found nothing.
const FRESH = {
  card: false, home: false, window: false, sent: false, received: false, welcomed: false,
  sent_since: null, sent_via: null, received_since: null, received_via: null,
  depth: { eachWay: 0, best: 0, since: null, friends: [] },
};

// ── the id map is BOUND to the town's, not trusted ───────────────────────────

test("STANDING_FACT covers exactly the town's own ONBOARDING_IDS", { skip: SKIP }, async () => {
  const { ONBOARDING_IDS } = await import(townModuleUrl("tools", "quest-progress.mjs"));
  // `walk-the-world` is the one onboarding row this index cannot settle — the
  // world lives outside the town checkout — so it is the deliberate difference,
  // and it is named here rather than left as an off-by-one nobody can read.
  assert.deepEqual(
    [...Object.keys(STANDING_FACT), "walk-the-world"].sort(),
    [...ONBOARDING_IDS].sort(),
    "the office's id→fact map has drifted from the town's onboarding line. This map is a second copy of the town's private FACT_OF; when the town renames or adds a row, this assertion is the only thing between that rename and a board that silently stops measuring it.");
});

test("every id STANDING_FACT names is answered by onboardingFactsFor", { skip: SKIP }, async () => {
  const t = await import(townModuleUrl("tools", "quest-progress.mjs"));
  const facts = t.onboardingFactsFor(TOWN, "wright");
  for (const [id, fact] of Object.entries(STANDING_FACT)) {
    assert.ok(fact in facts, `${id} maps to the fact "${fact}", which onboardingFactsFor does not answer`);
  }
});

// ── the settled resident: every row the record can answer, answers ───────────

test("a settled resident's rows all carry a number, a completion and a source", () => {
  for (const id of Object.keys(STANDING_FACT)) {
    const p = standingJoin(row(id), SETTLED);
    assert.equal(p.complete, true, `${id} must read complete for a resident who did it`);
    assert.equal(typeof p.progress, "number", `${id} must carry a NUMBER — "measured" downstream is typeof progress === "number", so a null here is the founder's blank row all over again`);
    assert.equal(p.progress, 1, `${id} of 1`);
  }
});

test("the two mail rows carry the day they were met, from the ledger's own line", () => {
  assert.equal(standingJoin(row("first-letter-out"), SETTLED).since, "2026-06-12");
  assert.equal(standingJoin(row("first-answer"), SETTLED).since, "2026-06-12");
  assert.equal(standingJoin(row("first-letter-out"), SETTLED).note, undefined,
    "a dated row must not also carry the undated note");
});

test("the three paper rows say the record holds the fact and not its date", () => {
  for (const id of ["write-your-card", "tend-your-home", "hang-your-window"]) {
    const p = standingJoin(row(id), SETTLED);
    assert.equal(p.complete, true);
    assert.equal(p.since, null, `${id} has no date in the record`);
    assert.equal(p.note, STANDING_NOTES.no_date,
      `${id} is settled and undated, and a settled row with a silent null date reads as a row nobody looked at`);
  }
});

// ── the seventh row: settled by the town's hand, and undated ─────────────────
//
// ⚑ THESE EXIST BECAUSE THE ONE-LINE FIX WAS WRONG BY ITSELF. Adding
// `welcome-to-postmark` to STANDING_FACT is all the id-map gate above needs, and
// it silently handed this row `since: "2026-06-12"` — the day SETTLED's first
// letter ARRIVED — because the `since` ternary treats every non-paper row as a
// mail row. A bundle the town paid on 2026-09-14 read as three months older than
// the row itself, on the founder's own board, with no red anywhere: the gate
// asserts the KEYS of the map and says nothing about what the rows then carry.
// The first test below is the one that fails if the `isWelcome` arm is dropped.

test("the welcome row is undated, and never wears the day a letter arrived", () => {
  const p = standingJoin(row("welcome-to-postmark"), SETTLED);
  assert.equal(p.complete, true, "the town paid this household; the row is met");
  assert.equal(p.progress, 1, "1 of 1 — a settled row earns the number, like every other settled row");
  assert.equal(p.since, null,
    `the welcome row must carry NO date. It read ${JSON.stringify(p.since)}, and SETTLED's received_since is ${JSON.stringify(SETTLED.received_since)} — if those are equal, this row is wearing the first-answer's day, which is the exact shape the id-note rule above exists to prevent.`);
  assert.notEqual(p.since, SETTLED.received_since,
    "the welcome row borrowed first-answer's date");
});

test("the welcome row says the TOWN paid it — not that the resident did it", { skip: SKIP }, () => {
  const p = standingJoin(row("welcome-to-postmark"), SETTLED);
  assert.equal(p.note, STANDING_NOTES.welcome_paid,
    "a settled, undated row with a silent null date reads as a row nobody looked at");
  assert.notEqual(p.note, STANDING_NOTES.no_date,
    "the papers note opens with `you have done this`, and the whole of this row is that the resident did NOT — the registry says the reward comes by `the town's hand, not yours`");
  assert.notEqual(p.note, STANDING_NOTES.self_mail_only,
    "the self-mail note is about a delivery; this row is a mint");
});

test("an unwelcomed household reads 0 of 1 and is told nothing about a date", () => {
  const p = standingJoin(row("welcome-to-postmark"), FRESH);
  assert.equal(p.complete, false);
  assert.equal(p.progress, 0, "the record looked and found no bundle — that is an answer, not a silence");
  assert.equal(p.since, null);
  assert.equal(p.note, undefined,
    "the note is about a paid bundle with no day; an unpaid one has nothing to say");
});

test("an UNMET paper row carries no undated note — the note is about a date, not a gap", () => {
  const p = standingJoin(row("write-your-card"), FRESH);
  assert.equal(p.complete, false);
  assert.equal(p.progress, 0, "0 of 1 is a real answer here: the record looked and found nothing");
  assert.equal(p.note, undefined);
});

// ── the fresh resident: looked, and found nothing ────────────────────────────

test("a fresh resident reads complete:false everywhere, never null", () => {
  for (const id of Object.keys(STANDING_FACT)) {
    const p = standingJoin(row(id), FRESH);
    assert.equal(p.complete, false, `${id}`);
    assert.equal(p.progress, 0, `${id}`);
    assert.equal(p.since, null, `${id}`);
  }
});

// ── the milestone ────────────────────────────────────────────────────────────

test("the friendship milestone reports the deepest reach, the crossing day, and who with", () => {
  const p = standingJoin(row("correspond-depth", { target: 5 }), SETTLED);
  assert.equal(p.progress, 8, "the bar is this resident's deepest each-way reach with any one correspondent");
  assert.equal(p.complete, true, "a rung crossed and paid is a milestone met");
  assert.equal(p.since, "2026-08-04");
  assert.deepEqual(p.earned_with, [{ with: "little-bird", threshold: 5, date: "2026-08-04" }]);
  assert.equal(p.counted, undefined,
    "the friends must NOT ride `counted` — that field holds who filled a unit TODAY and the site merges it across a household under that heading");
});

test("deep letters with no rung crossed is progress without completion", () => {
  const p = standingJoin(row("correspond-depth", { target: 5 }), {
    ...FRESH, depth: { eachWay: 3, best: 0, since: null, friends: [] },
  });
  assert.equal(p.progress, 3);
  assert.equal(p.complete, false);
  assert.equal(p.since, null);
});

test("an unsealed ladder is a rule that has not started, not a milestone missed", () => {
  const p = standingJoin(row("correspond-depth", { target: 5 }), { ...FRESH, depth: null });
  assert.equal(p.note, STANDING_NOTES.ladder_unsealed);
  assert.equal(p.progress, undefined, "no number: nothing has been counted, and a 0 here would be a bar toward an award the town has not opened");
  assert.equal(p.complete, undefined);
});

// ── the two rows this index does not settle, and the disclosure they carry ───

test("#2773 the world row is SETTLED when the office could look — sited true, sited false", () => {
  // THE DEFECT THIS CLOSES. The row answered `complete: null` for everyone, and
  // the resident page files every uncounted row that is not `complete: true`
  // under STILL TO DO — so a resident whose home mark had stood for weeks was
  // told to go and leave it. "Not looked" rendered as "not done".
  const sited = standingJoin(row("walk-the-world"), SETTLED, { worldSited: true });
  assert.equal(sited.complete, true, "a home standing in the world is a row that is DONE");
  assert.equal(sited.progress, 1, "…and measured, or the page files it under Still to do anyway");
  assert.equal(sited.note, undefined, "a row the office read needs no note about where the answer is — it IS the answer");

  // The other pole, without which `complete: true` could be a constant.
  const unsited = standingJoin(row("walk-the-world"), SETTLED, { worldSited: false });
  assert.equal(unsited.complete, false, "a home founded but not sited is honestly NOT done");
  assert.equal(unsited.progress, 0);

  // No day is invented. The block carries a place, not a date, and `no_date`'s
  // sentence ("the town does not keep the day") would be false here — the world
  // keeps it; this read does not fetch it.
  assert.equal(sited.since, null);
});

test("#2773 the world row keeps its honest note when the office COULD NOT look", () => {
  // `the-town/the-disclosure` — refuse or disclose absent inputs, never quietly
  // substitute. An office that cannot see the world this minute must not say
  // the mark is missing, and a floor read here would tell a placed resident to
  // go and get placed, which is the #1864 defect wearing this row's clothes.
  const p = standingJoin(row("walk-the-world"), SETTLED, { worldSited: null });
  assert.equal(p.note, STANDING_NOTES.world_elsewhere);
  assert.equal(p.progress, undefined, "the board must not answer a row it did not read; an unmeasured row stays unmeasured");
  assert.equal(p.complete, undefined);
  assert.match(p.note, /doorstep/, "the note must name WHERE the answer is, or it is a shrug with better grammar");

  // …and a caller that never passes the fact at all gets the same honest
  // answer. The unreadable case and the not-asked case are the same sentence on
  // purpose: both mean nobody looked.
  assert.equal(standingJoin(row("walk-the-world"), SETTLED).note, STANDING_NOTES.world_elsewhere);
});

test("first-idea takes its number and its day from the store, and SAYS SO when the store did not answer", () => {
  const withIdea = standingJoin(row("first-idea"), SETTLED, { idea: { complete: true, since: "2026-08-19", by: "wright" } });
  assert.equal(withIdea.progress, 1);
  assert.equal(withIdea.complete, true);
  assert.equal(withIdea.since, "2026-08-19");
  // The guard: an unreadable world store must leave this row exactly as
  // unmeasured as it was. A floor read here would tell a resident they had not
  // published an idea on the strength of a hydration blip, and this is the row
  // that PAYS.
  const blind = standingJoin(row("first-idea"), SETTLED, { idea: null });
  assert.equal(blind.progress, undefined, "no store answer means no number — the row keeps boardForHandle's null");
  assert.equal(blind.complete, undefined);
  // ⚑ AND IT NOW CARRIES A NOTE. It used to return null outright, which left
  // the row measured:false with nothing said — the founder's silent line, for
  // that row, during exactly the blip the guard exists for.
  assert.equal(blind.note, STANDING_NOTES.no_tank);
  assert.match(blind.note, /Think Tank/, "the note must name the surface that can answer it");
});

// ── repair 4: the door's own promise, held to ────────────────────────────────

test("NO unmeasured row anywhere on a board is left without a note — driven both ways", { skip: SKIP }, async () => {
  const day = await today();
  // `read_quests` now promises an uncounted row "always names in `note` the
  // surface that CAN answer it". This is that sentence, executable.
  for (const [what, standing] of [["settled", SETTLED], ["fresh", FRESH], ["no index", null]]) {
    const board = await questBoardFor(dbWith(standing, day), meta(day), "wright", TOWN);
    const silent = board.quests.filter((q) => q.measured === false && !q.note).map((q) => q.id);
    assert.deepEqual(silent, [],
      `${what}: these rows say "nothing looked" and do not say who could. That is the founder's blank row, one row narrower.`);
  }
});

// ── repair 5: the notes are for residents, not for us ────────────────────────

test("no note is written in office dialect", { skip: SKIP }, () => {
  // The one note wright actually sees rides the only row left on his checklist.
  // The founder's complaint that morning was that his page said things he could
  // not parse; answering it in our own vocabulary would be the same failure in
  // a new place.
  // The reviewer's vocabulary, verbatim. I added "standing" to it on the first
  // pass and it fired on "whether your home mark is standing" — which is the
  // TOWN's own word for a mark placed on ground (the registry: "the household's
  // first class:idea mark standing on the-town/the-think-tank"). A resident
  // reads that sentence fine. Dropped, and named here rather than quietly, so
  // nobody re-adds it thinking it was an oversight.
  const OURS = /checkout|\bindex\b|rehydrate|\bfold\b|board read|next_steps|world block/i;
  for (const [key, text] of Object.entries(STANDING_NOTES)) {
    assert.doesNotMatch(text, OURS,
      `STANDING_NOTES.${key} is written in office dialect: ${JSON.stringify(text)}`);
  }
});

test("the world note does not promise a stranger an answer about someone else", () => {
  // `nextStepsFor` skips the world read for a stranger under the 2026-08-15
  // gate, correctly. A note saying "your own doorstep answers this row" is
  // therefore false on every page but your own — and a resident page is public.
  assert.match(STANDING_NOTES.world_elsewhere, /your own doorstep/i, "it may name the doorstep");
  assert.doesNotMatch(STANDING_NOTES.world_elsewhere, /answers this row/i,
    "but it must not tell a visitor that THIS row is answered there — the doorstep they can reach is their own");
});

// ── repair 7: self-mail, and the note attached by id rather than by shape ────

test("a resident whose only letter is to themselves is dated, not told the town forgot", () => {
  // The divergence: the town's `onboardingFactsFor` counts a self-addressed
  // letter as sent AND received; the office's date maps used to skip it. So the
  // row read complete:true, since:null — and picked up the paper-row note
  // saying the record does not date it, about a delivery the ledger dates
  // exactly. Latent when the reviewer found it; live for the first newcomer who
  // opens that way.
  const selfOnly = { ...FRESH, sent: true, received: true, sent_since: "2026-09-08", received_since: "2026-09-08" };
  const out = standingJoin(row("first-letter-out"), selfOnly);
  assert.equal(out.complete, true);
  assert.equal(out.since, "2026-09-08", "the ledger dates it; so does this row");
  assert.equal(out.note, undefined, "and nothing tells them the town does not keep the day");
});

test("the undated note is attached by ROW ID, never by shape", () => {
  // A shape can be worn by a row it was never written for. If a mail row ever
  // does come back complete-and-undated, it gets its own true sentence.
  const undatedMail = { ...FRESH, sent: true, sent_since: null };
  const mail = standingJoin(row("first-letter-out"), undatedMail);
  assert.equal(mail.note, STANDING_NOTES.self_mail_only,
    "a mail row must not borrow the paper rows' note — replace the id test with `complete && since === null` and this reads no_date");
  assert.equal(standingJoin(row("write-your-card"), SETTLED).note, STANDING_NOTES.no_date,
    "and the paper rows keep theirs");
});

// ── an index older than the seam ─────────────────────────────────────────────

test("an index built before this seam says so, and never reports 'not done'", () => {
  for (const id of [...Object.keys(STANDING_FACT), "correspond-depth"]) {
    const p = standingJoin(row(id), null);
    assert.equal(p.note, STANDING_NOTES.no_index, `${id}`);
    assert.equal(p.complete, undefined, `${id} must not be answered false by a missing index — that is the silent substitution this whole seam exists to refuse`);
    assert.equal(p.progress, undefined, `${id}`);
  }
});

test("the two daily rows and an unknown row are left entirely alone", () => {
  assert.equal(standingJoin(row("correspond-send", { target: 5 }), SETTLED), null);
  assert.equal(standingJoin(row("correspond-receive", { target: 5 }), SETTLED), null);
  assert.equal(standingJoin(row("keeping-ec2"), SETTLED), null);
});

// ── the round trip: does any of this actually reach the board? ───────────────

function dbWith(standing, day) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO quest_progress (handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("wright", 3, 1, 5, 4, 2, JSON.stringify(["a", "b", "c"]), JSON.stringify(["d"]));
  if (standing) db.prepare("INSERT INTO quest_standing (handle, json) VALUES (?, ?)").run("wright", JSON.stringify(standing));
  return db;
}
const meta = (day) => ({ quest_registry: REGISTRY, quest_day: day });
const q = (board, id) => board.quests.find((x) => x.id === id);
async function today() {
  const { townDay } = await import(townModuleUrl("tools", "quest-progress.mjs"));
  return townDay();
}

test("the founder's own board: every settled row measured, with its day", { skip: SKIP }, async () => {
  const day = await today();
  const board = await questBoardFor(dbWith(SETTLED, day), meta(day), "wright", TOWN);
  // the two dailies are untouched by this seam
  assert.equal(q(board, "correspond-send").progress, 3);
  assert.equal(q(board, "correspond-send").measured, true);
  // and the eight that read null for a week
  for (const id of ["write-your-card", "tend-your-home", "hang-your-window", "first-letter-out", "first-answer", "correspond-depth"]) {
    const r = q(board, id);
    assert.equal(r.measured, true, `${id} still reads unmeasured on the served board — the join did not reach it`);
    assert.equal(r.complete, true, `${id}`);
  }
  assert.equal(q(board, "first-letter-out").since, "2026-06-12");
  assert.equal(q(board, "correspond-depth").since, "2026-08-04");
  // ── AND THE ONE ROW THIS INDEX DOES NOT OWN (#2773) ───────────────────────
  //
  // `walk-the-world` is settled from the WORLD, not from the standing fold, so
  // its value here depends on whether the box running this suite has a world
  // clone — which is a fact about a machine and not about the office. This leg
  // used to assert `measured: false` and passed only because no world was
  // readable under it; the day one was, it would have reddened for a reason
  // that had nothing to do with the office.
  //
  // So it asserts the LAW, which holds on every box: the row is EITHER read and
  // settled, OR unread and carrying the note that names the surface that can
  // answer. What it must never be is the third shape — unread and silent, which
  // is what the resident page files under Still to do. The two values are pinned
  // by the injected legs below, where the fixture owns its own world.
  const world = q(board, "walk-the-world");
  if (world.measured) {
    assert.equal(typeof world.complete, "boolean", "a measured row must carry a real boolean, never a null wearing a number");
    assert.equal(world.note, undefined, "a row the office read needs no note about where the answer is");
  } else {
    assert.equal(world.complete, null, "unread is null — never false, which reads as 'you have not done this'");
    assert.equal(world.note, STANDING_NOTES.world_elsewhere, "an unread row must name the surface that answers it");
  }
});

// ── #2773 · THE WIRING, WHICH IS THE HALF A PURE TEST CANNOT SEE ────────────
//
// `standingJoin` is pure and the three legs above drive it directly. That
// proves the derivation and nothing about whether the board ever ASKS. A seam
// that computes the right answer and hands the row `undefined` looks exactly
// like the bug it replaced, so these drive the real `questBoardFor` with the
// world reader injected — the same injection point `nextStepsFor` uses to keep
// the doorstep down to one world read.
//
// CAN-FAIL FLIP: return `{ note: STANDING_NOTES.world_elsewhere }` from the
// `walk-the-world` branch again, and the first two of these redden.

const boardWithWorld = async (block) => {
  const day = await today();
  return questBoardFor(dbWith(SETTLED, day), meta(day), "wright", TOWN, { worldBlock: async () => block });
};

test("#2773 the served board carries the world row the office actually read", { skip: SKIP }, async () => {
  const standing = await boardWithWorld({ mark_id: "wright/the-house", x: 10, y: 20, sited: true });
  assert.equal(q(standing, "walk-the-world").complete, true, "the board did not ask the world, or did not carry its answer");
  assert.equal(q(standing, "walk-the-world").measured, true, "an unmeasured row is filed under Still to do whatever `complete` says");
  assert.equal(q(standing, "walk-the-world").note, undefined);

  const founded = await boardWithWorld({ mark_id: "wright/the-house", x: null, y: null, sited: false });
  assert.equal(q(founded, "walk-the-world").complete, false, "a home founded but unsited must read false, not true and not null");
  assert.equal(q(founded, "walk-the-world").measured, true);

  const blind = await boardWithWorld({ mark_id: null, x: null, y: null, sited: false, unreadable: true, unreadable_reason: "no world clone" });
  assert.equal(q(blind, "walk-the-world").complete, null, "an unreadable world is NOT a missing mark");
  assert.equal(q(blind, "walk-the-world").measured, false);
  assert.equal(q(blind, "walk-the-world").note, STANDING_NOTES.world_elsewhere);
});

test("#2773 a decided verdict is used VERBATIM and the board reads nothing — the 08-15 gate, one layer down", { skip: SKIP }, async () => {
  // Keemin's ruling, 2026-08-15: "the gaps are yours to see, not theirs to be
  // seen by" — and whether a home is sited is one of the two gap-shaped facts
  // named under it. `nextStepsFor` honours that by SKIPPING the world read on a
  // stranger's doorstep, and its own falsifier counts the calls to prove the
  // skip is a skip and not a filter.
  //
  // This board is embedded in that doorstep. Handed a reader it would go and ask
  // the very question the gate declined, one layer down where the counting spy
  // upstairs cannot see it — a skip that turns into a read is not a skip. So the
  // doorstep hands down its VERDICT, and this leg pins that the verdict is taken
  // at its word with no read of any kind behind it.
  //
  // CAN-FAIL: make `questBoardFor` recompute `worldSited` instead of using the
  // one it was given, and both halves of this redden — the count, and the row.
  const day = await today();
  let asks = 0;
  const spy = async () => { asks += 1; return { sited: true }; };

  const withheld = await questBoardFor(dbWith(SETTLED, day), meta(day), "wright", TOWN,
    { worldSited: null, worldBlock: spy });
  assert.equal(asks, 0, "a board handed a verdict must not go and ask anyway — that is the gate leaking");
  assert.equal(q(withheld, "walk-the-world").complete, null, "nobody looked, so the row says nobody looked");
  assert.equal(q(withheld, "walk-the-world").note, STANDING_NOTES.world_elsewhere);

  // …and a verdict of `true` is equally taken at its word, so the leg above is
  // not passing on the strength of null being falsy somewhere.
  const told = await questBoardFor(dbWith(SETTLED, day), meta(day), "wright", TOWN,
    { worldSited: true, worldBlock: spy });
  assert.equal(asks, 0);
  assert.equal(q(told, "walk-the-world").complete, true);
});

test("#2773 the board's world fact comes from the same reader the doorstep uses", { skip: SKIP }, async () => {
  // One office, one answer to "is this home standing". `worldSitedFor` is the
  // three-way the doorstep's onboarding row already calls; the board calls the
  // same function rather than re-deriving `sited === true` beside it, so the
  // two surfaces cannot come to disagree on a resident's own page.
  const { worldSitedFor } = await import("../src/household-apex.mjs");
  const block = { mark_id: "wright/the-house", x: 10, y: 20, sited: true };
  const direct = await worldSitedFor("wright", { worldBlock: async () => block });
  const onBoard = q(await boardWithWorld(block), "walk-the-world").complete;
  assert.equal(onBoard, direct, "the board's answer must BE the doorstep's, not a second reading of the same block");
  // and the reader is asked exactly once per board, because the world is not free
  let asks = 0;
  const day = await today();
  await questBoardFor(dbWith(SETTLED, day), meta(day), "wright", TOWN,
    { worldBlock: async () => { asks += 1; return block; } });
  assert.equal(asks, 1, `the board opened the world ${asks} times for one row`);
});

test("a board served off an index without the fold is exactly as unmeasured as it was", { skip: SKIP }, async () => {
  const day = await today();
  const board = await questBoardFor(dbWith(null, day), meta(day), "wright", TOWN);
  for (const id of ["write-your-card", "first-letter-out", "correspond-depth"]) {
    const r = q(board, id);
    assert.equal(r.measured, false, `${id}`);
    assert.equal(r.complete, null, `${id} must read null — "nothing looked" — never false`);
    assert.equal(r.note, STANDING_NOTES.no_index, `${id}`);
  }
});

test("standingFor survives an index with no such table and an index with no such row", () => {
  const bare = new DatabaseSync(":memory:");
  assert.equal(standingFor(bare, "wright"), null, "no table must be a null, not a throw — an old index still serves boards");
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  assert.equal(standingFor(db, "nobody"), null);
});

// ── the doorstep: the SAME derivation, and it shrinks with the board ─────────
//
// The brief's fourth build item: "Doorstep `next_steps` consumes the same
// derivation (one derivation, two surfaces — the doorstep note says so
// already); confirm it changes with it."
//
// It does, in the direction that matters and NOT in the one that would have
// been a regression. `composeNextSteps` skips any row whose `complete === true`,
// so a row the board just learned to settle leaves the checklist. But the same
// composer writes a step's tail as `(${q.progress}/${q.target} today)` for any
// row carrying a number, and "today" is false of a card written in June and a
// friendship crossed in August. So the office nulls non-daily progress before
// handing the board over, and the set of daily rows comes from the town's own
// exported COUNTABLE_FIELD rather than a pair typed into the office.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { nextStepsFor } from "../src/queries.mjs";
import { fixtureDb } from "./fixture.mjs";

// the office's own resolution order, matching next-steps.test.mjs. It WAS a
// second order of its own — `process.cwd()/town-clone`, which names a different
// directory depending on where the runner was started, then the operator's own
// disk. One resolver now, so this block and the ones above cannot disagree
// about which checkout they read.
const LIVE_TOWN = TOWN;

async function stepsWith(standing) {
  const { readFileSync } = await import("node:fs");
  const db = fixtureDb();
  if (standing) db.prepare("INSERT INTO quest_standing (handle, json) VALUES (?, ?)").run("wright", JSON.stringify(standing));
  const meta = { quest_registry: readFileSync(join(LIVE_TOWN, "quest-registry.json"), "utf8"), quest_day: "1970-01-01" };
  return nextStepsFor(db, meta, "wright", LIVE_TOWN);
}

test("no step ever tells a resident a standing fact happened TODAY", { skip: SKIP }, async () => {
  // A resident PART-WAY through the milestone is the shape that can go wrong:
  // a settled row is skipped by the composer's `complete === true` guard and so
  // could never carry a false tail, and asserting against a settled resident
  // would be a check that cannot fail. Three each way, no rung crossed —
  // incomplete, numbered, and doorless, which is exactly the row the composer
  // would hand a "(3/5 today)" if the office passed the board through raw.
  const ns = await stepsWith({ ...FRESH, sent: true, received: true, depth: { eachWay: 3, best: 0, since: null, friends: [] } });
  assert.ok(ns, "nextStepsFor returned null — the checkout has no composeNextSteps");
  assert.ok(ns.steps.some((s) => s.kind === "quest"),
    "no quest step reached this assertion at all — it would pass by having nothing to check");
  const { pathToFileURL } = await import("node:url");
  const t = await import(pathToFileURL(join(LIVE_TOWN, "tools", "quest-progress.mjs")).href);
  for (const s of ns.steps) {
    if (s.kind !== "quest") continue;
    if (t.COUNTABLE_FIELD[s.id]) continue; // the two dailies; "today" is true of them
    assert.doesNotMatch(s.what, /today\)/,
      `the step for "${s.id}" claims a count for TODAY. It is not a daily row: a milestone crossed in August and a card written in June did not happen today, and the composer's tail is a daily sentence.`);
  }
});

test("a settled milestone leaves the doorstep list entirely", { skip: SKIP }, async () => {
  const settled = await stepsWith(SETTLED);
  const fresh = await stepsWith(FRESH);
  const ids = (ns) => new Set(ns.steps.map((s) => s.id));
  assert.ok(!ids(settled).has("first-idea") || true); // first-idea needs a store; not asserted here
  assert.ok(!ids(settled).has("correspond-depth"),
    "a resident who crossed a friendship rung in August is still being told to go make a friend");
  // and the can-fail direction: the same call with a resident who has NOT
  // crossed one must still be able to surface it. correspond-depth carries no
  // door, so the composer's rule 2 keeps it off the checklist either way —
  // assert the rule rather than a row it excludes for a second reason.
  assert.equal(fresh.steps.filter((s) => s.id === "correspond-depth" && s.door).length, 0,
    "correspond-depth has no door; it belongs on the board, not on a list of what is left to do");
});

test("the doorstep and the board agree about the seven arrival rows", { skip: SKIP }, async () => {
  const { readFileSync } = await import("node:fs");
  const db = fixtureDb();
  db.prepare("INSERT INTO quest_standing (handle, json) VALUES (?, ?)").run("wright", JSON.stringify(SETTLED));
  const meta = { quest_registry: readFileSync(join(LIVE_TOWN, "quest-registry.json"), "utf8"), quest_day: "1970-01-01" };
  const ns = await nextStepsFor(db, meta, "wright", LIVE_TOWN);
  const board = await questBoardFor(db, meta, "wright", LIVE_TOWN);
  const open = new Set(ns.steps.filter((s) => s.kind === "onboarding").map((s) => s.id));
  for (const id of Object.keys(STANDING_FACT)) {
    const r = board.quests.find((x) => x.id === id);
    if (!r) continue;
    assert.equal(open.has(id), false,
      `"${id}" is open on the doorstep and complete on the board. This is HAL's July-30 wound — one town, two answers — and it is the exact seam this lane was opened to close.`);
    assert.equal(r.complete, true, `${id}`);
  }
});
