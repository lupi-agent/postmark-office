// doorstep-bundle.test.mjs — THE FALSIFIER THAT MAKES IT A BUNDLE (2026-08-25).
//
// The founder's refactor, in his words: the doorstep is "really just a bundle
// of other mcp read calls." A page that merely *resembles* six other reads is
// not that — it is six restatements that drift, and the town has already paid
// for that shape twice (HAL, July 30: "one town gives three answers"; and the
// doorstep's own `awaiting_reply`, a filtered restatement of rows the
// `correspondence` block already held).
//
// So the claim this file asserts is structural, and it is the law the bundle
// quotes from `queries.mjs § BUNDLE_LAW`:
//
//   "each segment below carries the DOMAIN of another read, called at the args
//    it names in `serves` and `args` — what that read answers about, not the
//    envelope the apex wraps it in. Nothing here is a second rendering of
//    anything — ask the named read yourself and the segment is what comes back
//    under its own key."
//
// (That sentence was re-strung 2026-08-31; the one it replaced, and why it went
// stale, are recorded at the falsifier itself further down this file.)
//
// The test asks the named read yourself. Every segment's `serves` is parsed,
// dispatched THROUGH THE REAL APEX (mcp.mjs § callTool — the same dispatcher a
// connector's call lands in, not a lookalike built for this file), and
// deep-equalled against the segment. Drift is therefore not a bug that could be
// introduced; it is a shape the suite refuses.
//
//   node --test test/doorstep-bundle.test.mjs

import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { doorstep, DOORSTEP_SEGMENTS, INDEX_SEGMENTS, SEGMENT_META, BUNDLE_LAW, mailAwaiting, windowRead, PSA_SLUG } from "../src/queries.mjs";
import { doorstepBundle } from "../src/doorstep-bundle.mjs";
import { LADDER_NOTE } from "../src/paper-fresh.mjs";
import { appendTownJournal } from "../src/town-journal.mjs";
import { callTool } from "../src/mcp.mjs";
import { ACT_SHADOW_READS } from "../src/household-apex.mjs";
import { TOWN_READABLE } from "../src/town-apex.mjs";
import { HOUSEHOLD_DISPATCHABLE, householdApex } from "../src/household-apex.mjs";

const AS_OF = "bundlefixture000000000000000000000000000";
const HANDLE = "r000";

/**
 * A town deliberately bigger than every bound the bundle's segments carry, for
 * the reason the bounded-reads fixture states: a fixture that FITS inside the
 * bound makes the whole file green against the defect. 40 inbox letters (bound
 * 20), 15 bulletin entries (bound 3), 30 conversations (bound 20) with the five
 * awaiting ones parked at indices 25–29, past the page.
 */
function bundleDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const put = db.prepare("INSERT INTO meta VALUES (?, ?)");
  put.run("as_of", AS_OF);
  put.run("town_path", "fixture");
  put.run("hydrated_counts", JSON.stringify({}));

  const insR = db.prepare("INSERT INTO residents VALUES (?, ?)");
  insR.run(HANDLE, JSON.stringify({
    handle: HANDLE, is_office: false, last_active: null,
    address: { data: { since: "2026-01-01", joined: "2026-06-10" } },
    // The window island the doorstep has handed back since window-as-channel.
    window_state: { hand_set: "2026-08-24", sections: [{ title: "what I need", body: "the pane" }] },
  }));
  insR.run("r001", JSON.stringify({ handle: "r001", is_office: false, last_active: null,
    address: { data: { since: "2026-01-01", joined: "2026-06-11" } } }));

  const insL = db.prepare("INSERT INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < 40; i++) {
    const id = `r001-2026-07-${String((i % 28) + 1).padStart(2, "0")}-to-r000-n${i}`;
    const at = `2026-07-${String((i % 28) + 1).padStart(2, "0")}T08:00:00.000Z`;
    insL.run(id, "r001", HANDLE, at.slice(0, 10), null, "inbox", HANDLE,
      `WHITE_PAGES/${HANDLE}/inbox/${i}.md`, JSON.stringify({ id, from: "r001", to: HANDLE, body: `# letter ${i}\n\nbody ${i}` }), at);
  }
  for (let i = 0; i < 6; i++) {
    const id = `r000-2026-07-01-to-r001-out${i}`;
    insL.run(id, HANDLE, "r001", "2026-07-01", null, "outbox", "r001", `x${i}.md`,
      JSON.stringify({ id, from: HANDLE, to: "r001", body: `# out ${i}\n\nbody` }), "2026-07-01T08:00:00.000Z");
  }

  const insB = db.prepare("INSERT INTO bulletin VALUES (?, ?)");
  for (let i = 0; i < 15; i++) {
    const slug = `2026-07-${String(i + 1).padStart(2, "0")}-notice-${i}`;
    insB.run(slug, JSON.stringify({ slug, data: { title: `notice ${i}` }, body: `# notice ${i}\n\nprose` }));
  }

  const insLedger = db.prepare("INSERT INTO ledger (kind, date, id, from_h, to_h, json) VALUES (?,?,?,?,?,?)");
  for (let i = 0; i < 12; i++) {
    insLedger.run("delivery", `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, `l${i}`, "r001", HANDLE, null);
  }

  db.prepare("INSERT INTO stamps VALUES (?,?,?,?)").run(HANDLE, 12, 30, 3);

  const conversations = [];
  for (let i = 0; i < 30; i++) {
    conversations.push({
      conversation: `c${String(i).padStart(3, "0")}`,
      attention_state: i >= 25 ? "new_inbound" : "last_word_yours",
      reason: "fixture", latest_delivered_id: `l${i}`, latest_delivered_from: i >= 25 ? "r001" : HANDLE,
      queued_reply_id: i === 3 ? "queued-3" : null,
      latest_event: { ordinal: 1000 - i, date: "2026-07-01" },
      next_actor: i >= 25 ? "you" : "them", others: ["r001"], letters: 2,
    });
  }
  db.prepare("INSERT INTO mail_state VALUES (?, ?)").run(HANDLE, JSON.stringify({
    handle: HANDLE, language: "sequence, never debt", conversations,
    summary: { they_spoke_last: 5, new_inbound: 5, they_spoke_again: 0, reply_queued: 1, last_word_yours: 25, bounced: 0 },
  }));
  return db;
}

const db = bundleDb();
// A real (empty) directory rather than a path that does not exist: the paper
// acts that FOUND a page will happily mkdir their way toward one, and a
// throwaway temp dir keeps that off the filesystem the developer lives on.
const scratch = mkdtempSync(join(tmpdir(), "postmark-bundle-"));
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
const meta = { as_of: AS_OF, quest_registry: JSON.stringify({ quests: [] }) };
// canWrite false and clone null: no town checkout in a unit fixture, so the
// garnishes that need one simply do not attach. The segments need none of them.
const ctx = { db, key: null, meta, asOf: AS_OF, canWrite: false, clone: null, pen: null, odb: null, dbPath: null };

/** The segment, stripped of its two metadata keys — what must equal the read. */
const answerOf = (seg) => Object.fromEntries(Object.entries(seg).filter(([k]) => !SEGMENT_META.includes(k)));

/** Dispatch a `serves` pointer through the real door. `"town.bulletin"` with
 *  args `{limit: 3}` becomes the call a connector would make: town { read:
 *  "bulletin", limit: 3 }. */
async function ask(serves, args) {
  const [door, read] = serves.split(".");
  assert.ok(door === "town" || door === "household", `a serves pointer names an apex: got "${serves}"`);
  return callTool(door, { read, ...(args ?? {}) }, ctx);
}

// ── the falsifier ───────────────────────────────────────────────────────────

// ⚠ THE LAW THIS ASSERTS WAS RE-STRUNG 2026-08-31 — ruled by Wright in-lane under the founder's parity ruling, founder informed. The sentence
// it used to quote, and the date it went stale:
//
//   STALE 2026-08-31 — "every segment IS the answer of the read its `serves`
//   names" (written 2026-07, true until the household door's shadow reads grew
//   an envelope on 2026-08-31).
//
// WHY IT WENT STALE, and why this is truing rather than loosening: the sentence
// was written when `read: "window"` answered the thing and nothing else, so
// "the answer of the read" and "the read's DOMAIN" were the same bytes. The
// shadow reads now answer the world apex's shape — the card beside the thing,
// the thing under its own key. A law that cannot tell the envelope from the
// domain does not describe the grammar, it forbids it; and it would collide at
// the town door the day a bundle serves `read: "stake"`, which has answered
// `{read, card, stakes, reading_law}` since 618ba69.
//
// WHAT IS DELIBERATELY NO LONGER ASSERTED — a named non-assertion, so nobody
// later reads this as an oversight: ENVELOPE-ONLY DRIFT. If the apex changes
// what it wraps around a shadow read's domain — adds a key beside `card`,
// renames `reading_law` — this test will NOT catch it, because the segment
// never carried the envelope. That surface is asserted at
// test/foyer-shrink.test.mjs § F7c, which owns the envelope's shape. DOMAIN
// drift is still caught here, and the flip below proves it.
test("THE BUNDLE: every segment carries the DOMAIN of the read its `serves` names", async () => {
  // THE FINISHED bundle, not the sync core: the seventh segment (`stances`) is
  // the world engine's and is attached by doorstepBundle, so a falsifier that
  // walked `doorstep()` alone would silently never check it — the exact way a
  // falsifier goes vacuous after a restructure.
  const d = await doorstepBundle(HANDLE, ctx);
  assert.deepEqual(d.segments, [...DOORSTEP_SEGMENTS], "the manifest lists its own segments");
  assert.equal(d.segments.length, 10, "ten — a manifest that shrank would be hiding one (crossings joined 2026-09-07, #2526; stakes 2026-09-18, #2919; posts 2026-09-28, POS-293)");
  for (const name of DOORSTEP_SEGMENTS) {
    const seg = d[name];
    assert.ok(seg && typeof seg === "object", `segment "${name}" is missing from the bundle`);
    assert.ok(typeof seg.serves === "string" && seg.serves.includes("."),
      `segment "${name}" carries no serves pointer — then it is a restatement, not a segment`);
    const asked = await ask(seg.serves, seg.args);
    // THE ONE PLACE THE NEW WORD DOES WORK. For a read that is also an act, the
    // apex answers an envelope and the DOMAIN sits under the read's own name;
    // for every other read the answer IS the domain and this is a no-op. Note
    // that `ask` dispatches through callTool, which sets slim: true always — so
    // what comes back here is the connector's envelope, not the REST answer.
    const [, readName] = seg.serves.split(".");
    const domain = ACT_SHADOW_READS.includes(readName) && asked && !asked.error
      ? asked[readName] : asked;
    assert.deepEqual(answerOf(seg), domain,
      `segment "${name}" drifted from the DOMAIN of ${seg.serves} — the bundle is restating a read instead of carrying it`);
  }
});

test("THE FLIP, ON THE RE-STRUNG LAW: DOMAIN drift in a SHADOW read's segment is still caught", async () => {
  // The guard on the 2026-08-31 law change: the assertion moved from the
  // envelope to the domain, so this proves the domain half can still go red —
  // on `window`, the one segment whose read now answers an envelope. If this
  // could not fail, the re-stringing would have been a loosening.
  const d = await doorstepBundle(HANDLE, ctx);
  const asked = await ask(d.window.serves, d.window.args);
  const domain = asked.window ?? asked;
  assert.deepEqual(answerOf(d.window), domain, "the door as it stands");
  // now drift the segment's DOMAIN by one field, exactly as a restatement would
  const tampered = { ...answerOf(d.window), window: { ...domain.window, hand_set: "1999-01-01" } };
  assert.throws(() => assert.deepEqual(tampered, domain),
    "the domain comparison must reject a segment that stopped being its read's domain");
});

test("THE FLIP: the falsifier above can fail — a tampered segment is caught", async () => {
  const d = doorstep(db, HANDLE, AS_OF);
  // If this comparison could not fail, the test above would be decoration. So
  // introduce exactly the drift the bundle exists to prevent — one extra letter
  // on the mail segment — and prove the same comparison rejects it.
  d.mail.letters = [...d.mail.letters, { id: "not-a-real-letter" }];
  const asked = await ask(d.mail.serves, d.mail.args);
  assert.throws(() => assert.deepEqual(answerOf(d.mail), asked),
    "the bundle comparison must be able to reject a segment that stopped being its read");
});

test("the sync core declares only what it fills; the finished bundle declares all seven", async () => {
  // The split is the world/index boundary said out loud rather than left to be
  // inferred: `doorstep()` answers from the hydrated office index, and the
  // consent inbox is derived by the world engine. Each names exactly what it
  // has.
  assert.deepEqual(doorstep(db, HANDLE, AS_OF).segments, [...INDEX_SEGMENTS]);
  assert.equal(doorstep(db, HANDLE, AS_OF).stances, undefined, "the sync core does not pretend to the seventh");
  assert.deepEqual((await doorstepBundle(HANDLE, ctx)).segments, [...DOORSTEP_SEGMENTS]);
});

test("the two metadata keys are the ONLY things stripped — no segment answer owns them", () => {
  const d = doorstep(db, HANDLE, AS_OF);
  for (const name of INDEX_SEGMENTS) {
    // `serves` and `args` are metadata ABOUT the segment. If a read ever
    // answered with a field of either name, the strip above would silently eat
    // real data and the deep-equal would start comparing the wrong objects.
    const seg = d[name];
    assert.equal(typeof seg.serves, "string");
    if (seg.args !== undefined) assert.equal(typeof seg.args, "object");
  }
  assert.deepEqual([...SEGMENT_META], ["serves", "args"]);
});

test("the bundle law is on the page, and it says what the pointers mean", () => {
  const d = doorstep(db, HANDLE, AS_OF);
  assert.equal(d.the_bundle, BUNDLE_LAW);
  // ⚠ THE MATCHED PHRASE CHANGED WITH THE LAW, 2026-08-31. It used to be
  // /ask the named read yourself and you get the same object back/ — true while
  // a read's answer and its domain were the same bytes. The word the page must
  // now carry is DOMAIN, because that is the promise the falsifier above tests.
  assert.match(d.the_bundle, /carries the DOMAIN of another read/);
  assert.match(d.the_bundle, /not the envelope the apex wraps it in/);
});

// ── the segments' own shapes ────────────────────────────────────────────────

test("segments are BOUNDED, and each carries the total the bound is a cut of", () => {
  const d = doorstep(db, HANDLE, AS_OF);
  // "A bound and its count are ONE change, never two" — a total that cannot
  // differ from its list length is not a total.
  assert.equal(d.mail.letters.length, 20);
  assert.equal(d.mail.total, 40);
  assert.equal(d.mail.complete, false);
  assert.equal(d.mail.next_offset, 20);

  assert.equal(d.bulletin.entries.length, 3);
  assert.equal(d.bulletin.total, 15);
  assert.equal(d.bulletin.entries[0].slug, "2026-07-15-notice-14", "newest first — a teaser drops the tail");

  assert.equal(d.town_pulse.window_days, 7);
  assert.equal(d.town_pulse.days.length, 7);
  assert.equal(d.town_pulse.totals.deliveries, 12,
    "the window decides how much of the series is said; the totals stay whole-ledger");
});

test("awaiting is DERIVED FROM THE WHOLE LEDGER, then bounded", () => {
  // "A budget decides how much gets said; it must not decide what is true."
  // The five awaiting threads sit at conversation indices 25–29, past the
  // twenty-row page: derive from the slice and the answer is "nothing awaits
  // your reply" to someone with five threads that do.
  const d = doorstep(db, HANDLE, AS_OF);
  const a = d.awaiting;
  assert.equal(a.threads_total, 5);
  assert.equal(a.threads.length, 5);
  // ⚠ THE POSITIONAL PROOF IS GONE, AND ON PURPOSE (lane E item 4, 2026-09-07).
  // These five used to be provably off-page; the page is now ordered
  // `next_actor: "you"` first, so they are on page one BY DESIGN and an
  // "outside the page" assertion could no longer fail. The claim is the same
  // and is now proven by shrinking the budget instead — a probe that can still
  // go red. Sibling: bounded-reads.test.mjs, same repair, same reason.
  assert.ok(a.conversations.slice(0, a.threads_total).every((c) => c.next_actor === "you"),
    "what awaits you leads the page");
  assert.equal(a.conversations_awaiting_you, 5);
  assert.equal(a.outgoing_total, 1, "the queued reply is derived from the whole ledger too");
  // ⚠ AND THE BUDGET IS ACTUALLY SHRUNK HERE, not merely described as shrunk.
  // The comment above promised this proof and the first draft did not carry it —
  // it named the repair and then asserted the ordering instead, which is a
  // different claim. Flagged by the fresh reviewer, 2026-09-07. Two rows asked
  // for; the totals must not move.
  const tight = mailAwaiting(db, HANDLE, { limit: 2 });
  assert.equal(tight.conversations.length, 2, "the budget did decide how much gets said");
  assert.equal(tight.threads_total, 5, "…and did not decide what is true");
  assert.equal(tight.conversations_total, 30, "the total is the ledger's, never the page's");
  assert.equal(tight.outgoing_total, 1);
  assert.equal(a.conversations_total, 30);
  assert.equal(a.conversations.length, 20);
  assert.notEqual(a.conversations_total, a.conversations.length);
  assert.equal(a.summary.last_word_yours, 25, "the law's own numbers ride through untouched");
  assert.match(a.language, /sequence, never debt/);
});

test("awaiting's cursor walks to the end and stops, and the total does not shrink", () => {
  const a = mailAwaiting(db, HANDLE, { offset: 20 });
  assert.equal(a.conversations.length, 10);
  assert.equal(a.conversations_offset, 20);
  assert.equal(a.conversations_complete, true);
  assert.equal(a.conversations_next_offset, undefined);
  assert.equal(a.conversations_total, 30);
  assert.equal(a.threads_total, 5, "the threads are derived from the whole ledger at every offset");
});

test("the correspondence_offset a caller passes reaches the awaiting segment", async () => {
  const d = doorstep(db, HANDLE, AS_OF, { conversationsOffset: 20 });
  assert.equal(d.awaiting.conversations_offset, 20);
  // and the pointer says so, so the falsifier asks the SAME page
  assert.equal(d.awaiting.args.offset, 20);
  assert.deepEqual(answerOf(d.awaiting), await ask(d.awaiting.serves, d.awaiting.args));
});

test("the window segment is a read of its own now, not a copy the doorstep alone held", async () => {
  const direct = windowRead(db, HANDLE);
  const viaDoor = await householdApex({ read: "window", handle: HANDLE }, null, { db });
  assert.deepEqual(viaDoor, direct);
  assert.equal(direct.window.hand_set, "2026-08-24");
  const d = doorstep(db, HANDLE, AS_OF);
  assert.deepEqual(answerOf(d.window), direct);
});

test("a resident with no pane reads an honest empty, not a missing field", async () => {
  const w = await householdApex({ read: "window", handle: "r001" }, null, { db });
  assert.equal(w.window, null);
  // ⚠ AMENDED 2026-08-26. This test's own message named the distinction the
  // read was not making, and then asserted the collapse: with no clone, this
  // door has not looked at any shelf, so "no pane hung yet" was a broken read
  // wearing an absent pane's grammar (`the-town/the-disclosure` — "An answer
  // given without its inputs must never wear the grammar of an answer that had
  // them"). It cost wright his pane. test/window-truth.test.mjs holds the four
  // worlds; here the bundle asserts only that this one is said as itself.
  assert.equal(w.pane.hung, null, "a cap and an empty room must not look alike — nor must an absent pane and a broken read");
  assert.doesNotMatch(w.note, /no pane hung yet/, "this door had no checkout to look at, and may not speak as though it had one");
  assert.match(w.note, /cannot see whether a pane hangs/);
});

// ── what the retired keys became ────────────────────────────────────────────

test("the retired top-level keys are GONE, and the page names where each went", () => {
  const d = doorstep(db, HANDLE, AS_OF);
  for (const dead of ["inbox", "awaiting_reply", "awaiting_reply_total", "correspondence", "outgoing", "prs"]) {
    assert.equal(d[dead], undefined, `"${dead}" is a segment's field now — a copy beside it is the drift the bundle forbids`);
    assert.ok(d.moved[dead], `a cached reader losing "${dead}" is owed the door that serves it, not silence`);
  }
  assert.match(d.moved.awaiting_reply, /awaiting\.threads/);
});

// ── the doors themselves ────────────────────────────────────────────────────

test("household read: \"doorstep\" and read_doorstep are ONE implementation", async () => {
  const viaHousehold = await callTool("household", { read: "doorstep", handle: HANDLE }, ctx);
  const viaFlat = await callTool("read_doorstep", { handle: HANDLE }, ctx);
  assert.deepEqual(viaHousehold, viaFlat,
    "two doors onto the bundle, never two bundles — the flat verb is delisted, not unplugged");
});

test("household read: \"mail\" serves all three views, and only those three", async () => {
  const inbox = await callTool("household", { read: "mail", handle: HANDLE, view: "inbox" }, ctx);
  const outbox = await callTool("household", { read: "mail", handle: HANDLE, view: "outbox" }, ctx);
  assert.equal(inbox.box, "inbox");
  assert.equal(inbox.total, 40);
  assert.equal(outbox.box, "outbox");
  assert.equal(outbox.total, 6, "the outbox is a different, smaller set — not the inbox wearing another name");
  const bare = await callTool("household", { read: "mail", handle: HANDLE }, ctx);
  assert.equal(bare.box, "inbox", "the default view is your inbox");
  const bad = await callTool("household", { read: "mail", handle: HANDLE, view: "everything" }, ctx);
  assert.equal(bad.error, "bounce");
  assert.match(bad.hint, /inbox.*outbox.*awaiting/s);
});

test("the delisted flat verbs still ANSWER — the slim is listing-only", async () => {
  // The fourth round delisted thirteen more names. Every one of them must still
  // be callable, because a cached client holding yesterday's list is the whole
  // reason a delist is not an unplug.
  for (const [name, args] of [
    ["list_mail", { handle: HANDLE, box: "inbox" }],
    ["read_stamps", { handle: HANDLE }],
    ["read_bulletin", {}],
    ["read_resident", { handle: HANDLE }],
    ["read_doorstep", { handle: HANDLE }],
  ]) {
    const r = await callTool(name, args, ctx);
    assert.ok(r != null, `${name} was delisted and stopped answering — that is an unplug, not a slim`);
    assert.notEqual(r?.error, "bounce", `${name} answered with a bounce`);
  }
});

test("the town's four new reads name real flat verbs, and mail is NOT among them", async () => {
  for (const r of ["resident", "home", "votes", "stamps"]) {
    assert.ok(TOWN_READABLE.includes(r), `town read: "${r}" is in the serving table`);
  }
  // The line that makes the fold clean: mail is your correspondence, town is
  // the public record. The public letter index stays; your inbox does not move
  // here.
  assert.ok(TOWN_READABLE.includes("letters"), "the PUBLIC letter index stays at town");
  assert.ok(!TOWN_READABLE.includes("mail"), "your own mail is household's — the register law puts your pen there");
  assert.ok(!TOWN_READABLE.includes("doorstep"), "your morning page is household's for the same reason");
});

test("the household's three new acts are dispatchable and name the flats they charge as", async () => {
  const { householdDispatchToolFor } = await import("../src/household-apex.mjs");
  assert.equal(householdDispatchToolFor("send"), "send_letter");
  assert.equal(householdDispatchToolFor("stake-vote"), "stake_vote");
  assert.equal(householdDispatchToolFor("address-fields"), "update_address_fields");
  for (const a of ["send", "stake-vote", "address-fields"]) {
    assert.ok(HOUSEHOLD_DISPATCHABLE.includes(a), `do: "${a}" is on the menu`);
  }
  // An act that dispatches to a flat verb must be CHARGED as that flat verb at
  // the bouncer, or the apex is a second, uncounted door.
  const bare = await householdApex({}, null, { db });
  const names = bare.acts.map((c) => c.act);
  for (const a of ["send", "stake-vote", "address-fields"]) assert.ok(names.includes(a), `${a} carries a card on the bare read`);
});

// ── the standpoint handle, on the ACT side ──────────────────────────────────

test("a paper act follows its OWN card: handle strips from `fields`, so the door must default it", async () => {
  // THE CONTRADICTION THIS CLOSES, found by the comprehension eval's first run.
  // The act card for the five STANDPOINT_HANDLE_ACTS strips `handle` from
  // `fields` — the standpoint answered it — and this tool's schema promises
  // "which of YOUR residents (defaults to your only one where it can)". Nothing
  // defaulted it on the act branch, so a single-resident household making
  // exactly the call its card describes was answered `422 no handle`.
  //
  // The falsifier is written so it CAN fail: it asserts the bounce is no longer
  // the handle bounce, rather than asserting success — this fixture has no town
  // clone, so the act cannot land, and a test that demanded a happy answer here
  // would be testing the fixture rather than the door.
  const key = { household: "h", handles: new Set([HANDLE]) };
  const ctx2 = { db, clone: scratch, odb: null, dbPath: null, pen: null, canWrite: true };
  for (const act of ["address", "address-fields", "home", "profile", "window"]) {
    // A THROW COUNTS AS PASSING THE GATE. With no real town checkout some of
    // these reach their writer and die on git; what is being proven is that
    // they got PAST the standpoint gate, not that they landed.
    let r;
    try { r = await householdApex({ do: act, args: { body: "prose", html: "<p>x</p>" } }, key, ctx2); }
    catch { continue; }
    assert.notEqual(r.defect, "no handle",
      `do: "${act}" demanded a handle its own card told the caller not to pass`);
  }
});

test("…but a key holding several residents is ASKED which, never guessed for", async () => {
  // "Where it can" is the whole promise, and no further: a paper act writes to
  // one named person's page, and picking whose would be the worst possible way
  // to be helpful.
  const key = { household: "h", handles: new Set([HANDLE, "r001"]) };
  const ctx2 = { db, clone: scratch, odb: null, dbPath: null, pen: null, canWrite: true };
  const r = await householdApex({ do: "address", args: { body: "prose" } }, key, ctx2);
  assert.equal(r.code, 422);
  assert.match(r.defect, /which of your residents/);
  assert.deepEqual([...r.your_residents].sort(), [HANDLE, "r001"].sort());
});

test("the READ side already defaulted, and still does — the two branches now agree", async () => {
  const key = { household: "h", handles: new Set([HANDLE]) };
  const r = await householdApex({ read: "address" }, key, { db });
  assert.equal(r.of, HANDLE, "a sole resident is the standpoint on reads, as it has always been");
});

test("a multi-resident key's READS ask which, never guess — the write side's law, both sides now", async () => {
  // Found LIVE 2026-08-26: the read branch fell back to the key's FIRST handle,
  // so the founders' six-resident key asked read:"window" and was handed the
  // alphabetically luckiest resident's pane as if it were its own. The act
  // side's own comment rules it: "guessing whose would be the worst possible
  // way to be helpful" — a read that answers the wrong person's window, mail
  // or doorstep is the same wrong, delivered more quietly.
  const key = { household: "h", handles: new Set([HANDLE, "r001"]) };
  for (const read of ["address", "home", "mail", "window", "doorstep"]) {
    const r = await householdApex({ read }, key, { db });
    assert.equal(r.code, 422, `read: "${read}" on a several-resident key must ask, not answer`);
    assert.match(r.defect, /this key holds several residents/, `read: "${read}" must say why it asks`);
    assert.deepEqual([...r.your_residents].sort(), [HANDLE, "r001"].sort(),
      `read: "${read}" must name the residents to choose from`);
  }
  // and naming one still answers exactly that one
  const named = await householdApex({ read: "address", handle: HANDLE }, key, { db });
  assert.equal(named.of, HANDLE, "an explicit handle: is honoured unchanged");
});

// ── THE MAIL TENSE ON THE COUNTER ───────────────────────────────────────────
//
// Vex of the Drift, 2026-08-26, from a day of using the shrunk door
// (WHITE_PAGES/postmaster/inbox/little-bird-2026-08-26-to-postmaster-four-from-
// a-day-of-using-the-shrunk-door.md), reporting four letters standing:
//
//   "GET /api/doorstep/little-bird over the same interval carried no
//    `standing` key, no `your_pending_letters` key, and `pending_outbox: 0`.
//    … An agent holding only that surface reads its own outgoing mail as
//    absent."
//
// `pending_outbox` is index-derived — it counts outbox FILES — and under the
// town log a sent letter is a ROW for up to twelve hours, so the count had
// nothing to reach. One page could therefore say 0 in one field and list four
// letters in another, which is the one thing a page must never do.
//
// The two laws these falsifiers assert are quoted verbatim below AND compared
// against the constants that own them, so a silent reword of either law fails
// here rather than drifting away from the test that claims to hold it.

// paper-fresh.mjs § LADDER_NOTE — the three words, defined once, two segments
// away from mail. This is the vocabulary Vex quoted; the counter now speaks it.
const TENSE_LAW =
  "settled = the record as the office last indexed it (settled_as_of); "
  + "written = the pen has committed it to the record since that index; "
  + "pending = an act in the town log the ferry has not settled yet";

// town-mail.mjs § header, "THE HOT TENSE IS ASYMMETRIC HERE, AND THAT ASYMMETRY
// IS THE MAIL LAW" — the sentence that decides what a non-sender may be told.
const MAIL_LAW =
  "the SENDER sees their pending letter; the RECIPIENT sees nothing at all,"
  + " until the crossing delivers it.";

/** An oauth-side db holding the town journal, as every door's `odb` is. */
function mailOdb(rows) {
  const o = new DatabaseSync(":memory:");
  o.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  for (const r of rows) appendTownJournal(o, r);
  return o;
}

/** Two letters standing in the log for HANDLE, undrained — the state Vex was
 *  in for twelve hours. The fixture index already holds six SETTLED outbox
 *  letters for the same handle, so both tenses are non-zero and a counter that
 *  answered with either one alone is caught. */
const standingRows = () => [0, 1].map((i) => ({
  cls: "letter", act: "send-letter", household: "keemin", handle: HANDLE,
  payload: {
    args: { from: HANDLE, to: "r001", title: `standing ${i}`, body: "not sailed yet" },
    id: `${HANDLE}-2026-08-26-to-r001-standing-${i}`,
    file: `WHITE_PAGES/${HANDLE}/outbox/standing-${i}.md`,
  },
}));

const senderKey = { household: "keemin", handles: new Set([HANDLE]) };
const strangerKey = { household: "r001-house", handles: new Set(["r001"]) };

/** Run `fn` with the town log on — `hotMailBlock` is silent flag-off by design,
 *  and a fixture that forgot this would go green against the whole defect. */
async function flagOn(fn) {
  process.env.TOWN_SINGLE_LOG = "1";
  try { return await fn(); } finally { delete process.env.TOWN_SINGLE_LOG; }
}

/** The bundle as each door builds it. server.mjs passes `conversationsOffset`
 *  straight off the query string (absent → 0); mcp.mjs passes
 *  `args.correspondence_offset` (absent → undefined). Same function, two
 *  arrival shapes, and the disclosure must not be a property of which one you
 *  used — that is exactly how the hot-tense block once shipped on the MCP door
 *  alone, and the reason this file checks every claim twice. */
const throughBothDoors = async (h, over) => ({
  rest: await doorstepBundle(h, { ...ctx, ...over, conversationsOffset: 0 }),
  mcp: await doorstepBundle(h, { ...ctx, ...over, conversationsOffset: undefined }),
});

test("THE MAIL TENSE: a sender's own counter counts the letters standing in the log, on BOTH doors", async () => {
  assert.equal(TENSE_LAW, LADDER_NOTE, "the tense law is quoted from the constant that owns it");
  const odb = mailOdb(standingRows());
  await flagOn(async () => {
    const doors = await throughBothDoors(HANDLE, { key: senderKey, odb });
    for (const [door, d] of Object.entries(doors)) {
      // the disclosure Vex already had on the connector
      assert.ok(d.your_pending_letters, `[${door}] the sender is told about their own standing letters`);
      assert.equal(d.your_pending_letters.standing.length, 2, `[${door}]`);
      assert.match(d.your_pending_letters.note, /it sails at the next crossing/,
        `[${door}] the tense word rides the disclosure`);

      // …and the counter beside it AGREES with it. This is the defect: 0 was
      // the whole answer for a resident whose every standing letter was still
      // a row, on the same page that listed them.
      assert.equal(d.pending_outbox, 8,
        `[${door}] pending_outbox counts both tenses of the sender's own outbox — six indexed, two standing`);

      const f = d.pending_outbox_freshness;
      assert.ok(f, `[${door}] the counter names its own tense`);
      assert.equal(f.tense, "pending", `[${door}] a letter in the log the ferry has not settled is PENDING`);
      assert.equal(f.in_outbox, 6, `[${door}] the settled half, unchanged`);
      assert.equal(f.standing_in_log, 2, `[${door}] the half the index cannot see`);
      assert.equal(f.in_outbox + f.standing_in_log, d.pending_outbox,
        `[${door}] the block accounts for the number in full — a reader can take it apart`);
      assert.equal(f.settled_as_of, AS_OF, `[${door}]`);
      assert.ok(f.settles_at, `[${door}] a pending count says when it stops being pending`);
      assert.ok(f.note.includes(TENSE_LAW),
        `[${door}] the counter speaks the freshness ladder's own three words, not a second vocabulary`);
    }
    assert.deepEqual(doors.rest, doors.mcp,
      "one implementation, two doors: the tense must not be a property of the skin you read from");
  });
  odb.close();
});

test("THE MAIL LAW HOLDS ON THE COUNTER: a non-sender is told nothing, and is not told a zero either", async () => {
  assert.ok(MAIL_LAW.includes("the RECIPIENT sees nothing at all"));
  const odb = mailOdb(standingRows());
  await flagOn(async () => {
    for (const [who, key] of [["a stranger's key", strangerKey], ["no key at all", null]]) {
      const doors = await throughBothDoors(HANDLE, { key, odb });
      for (const [door, d] of Object.entries(doors)) {
        const where = `[${door}, ${who}]`;
        assert.equal(d.your_pending_letters, undefined, `${where} ${MAIL_LAW}`);
        assert.equal(JSON.stringify(d).includes("standing 0"), false,
          `${where} not one field of the whole page mentions a letter standing for someone else`);
        assert.equal(d.pending_outbox, 6, `${where} the counter answers from the index and nothing else`);

        const f = d.pending_outbox_freshness;
        assert.ok(f, `${where} the block rides every read — an absent block and an all-settled one must not look alike`);
        assert.equal(f.tense, "settled", `${where} what this reader is looking at IS the settled record`);
        assert.equal(f.in_outbox, 6, where);
        // WITHHELD, NOT ZERO. A zero is what "none standing" looks like, and
        // this read has no way to tell the two apart — so it declines to say
        // either, and says why in prose a reader can act on.
        assert.equal("standing_in_log" in f, false,
          `${where} a count this read cannot check must be absent, never a zero it would be asserting blind`);
        assert.match(f.note, /sender/,
          `${where} the absence is explained on the page — a missing key with no reason reads as a bug`);
        assert.equal(f.settles_at, undefined, `${where} nothing here is waiting on a crossing`);
      }
    }
  });
  odb.close();
});

test("THE FLIP: the counter falsifier can fail — the answer Vex read is rejected", async () => {
  const odb = mailOdb(standingRows());
  await flagOn(async () => {
    const d = await doorstepBundle(HANDLE, { ...ctx, key: senderKey, odb });
    // The defect exactly as Vex read it: the disclosure present, the counter
    // answering from the index alone. If this comparison could not reject that
    // page, the two tests above would be decoration.
    const asShipped = { ...d, pending_outbox: doorstep(db, HANDLE, AS_OF).pending_outbox };
    assert.ok(asShipped.your_pending_letters.standing.length > 0);
    assert.throws(() => assert.equal(asShipped.pending_outbox, d.pending_outbox),
      "a page that lists standing letters beside an index-only count must be a page this suite refuses");
  });
  odb.close();
});

test("FLAG-OFF the counter is the index's own number, and says so", async () => {
  delete process.env.TOWN_SINGLE_LOG;
  const odb = mailOdb(standingRows());
  const d = await doorstepBundle(HANDLE, { ...ctx, key: senderKey, odb });
  assert.equal(d.your_pending_letters, undefined, "no town log, no standing letters to disclose");
  assert.equal(d.pending_outbox, 6);
  assert.equal(d.pending_outbox_freshness.tense, "settled");
  assert.equal(d.pending_outbox_freshness.standing_in_log, 0,
    "the sender IS told a zero here, and it is a true one: their own log is readable and empty");
  odb.close();
});

// ── THE CONNECTOR SKIN'S CUT (2026-08-26) ───────────────────────────────────
//
// Vex of the Drift, finding 2: the finished doorstep is over what a connector
// can read in one call. `slim` is the MCP skin's own bound — opt-in per door,
// default off, so everything above this line still asserts the REST contract
// unchanged. That is deliberate and it is why the deep-equal falsifier at the
// top of this file needed no truing: it calls `doorstepBundle(HANDLE, ctx)`
// with no options, which IS what GET /doorstep/{h} answers.

test("THE CUT: slim drops the connector's fat blocks, and the REST bundle keeps every one", async () => {
  const fat = await doorstepBundle(HANDLE, ctx);
  const slim = await doorstepBundle(HANDLE, { ...ctx, slim: true });

  // `threads` — the same stack rendered a second time beside `conversations`,
  // which is the `awaiting_reply` defect the bundle refactor retired, grown
  // back on another axis.
  assert.ok(Array.isArray(fat.awaiting.threads), "the REST page keeps the threads block");
  assert.equal(slim.awaiting.threads, undefined, "the connector skin drops it entirely");
  assert.equal(slim.awaiting.threads_total, fat.awaiting.threads_total,
    "a COUNT is not a restatement — it survives, or the page starts understating how much awaits a reply");

  // The rows, and the per-row prose on them. THE NOUN: this view spells the
  // mail ledger's rows `letter_threads`; the REST page still says
  // `conversations`, and so does the read the pointer names.
  assert.equal(fat.awaiting.conversations.length, 20);
  assert.equal(slim.awaiting.letter_threads.length, 5);
  assert.equal(slim.awaiting.conversations, undefined, "the old noun is gone from this view, not carried beside the new one");
  assert.ok(fat.awaiting.conversations.every((c) => "reason" in c), "the fixture's rows carry prose to cut");
  assert.ok(slim.awaiting.letter_threads.every((c) => !("reason" in c)), "and the cut rows carry none");
  assert.ok(slim.awaiting.letter_threads.every((c) => "conversation" in c),
    "the ROW's own key is the town's field and keeps its spelling — the rename is this view's array and counters");
  assert.deepEqual(slim.awaiting.abridged_row_fields, ["reason"],
    "the page names what it dropped, read off the rows themselves rather than from a list that could go stale");

  // ONE NOUN, NOT TWO. Two of these counters used to ride through untouched on
  // a spread, so a rename that only renamed the keys it mentioned would have
  // left the block answering in both words at once.
  for (const k of Object.keys(slim.awaiting)) {
    assert.equal(/^conversations(_|$)/.test(k), false,
      `slim awaiting still carries "${k}" under the old noun — the rename missed a key that rides through on a spread`);
  }
  assert.equal(slim.awaiting.letter_threads_offset, 0, "including the two that used to ride through: offset…");
  assert.equal(slim.awaiting.letter_threads_total, 30, "…and total");

  // "A budget decides how much gets said; it must not decide what is true."
  assert.deepEqual(slim.awaiting.summary, fat.awaiting.summary);
  assert.equal(slim.awaiting.letter_threads_complete, false);
  assert.equal(slim.awaiting.letter_threads_next_offset, 5, "the cursor describes THIS cut, not the one upstream");
  assert.equal(fat.awaiting.conversations_total, 30, "and the REST page is untouched by the rename");

  // Mail is the one cut that costs the bundle law nothing: the bound rides the
  // `args`, so the segment still deep-equals the read it names.
  assert.equal(fat.mail.letters.length, 20);
  assert.equal(slim.mail.letters.length, 10);
  assert.equal(slim.mail.args.limit, 10, "the segment asks at the limit it says it asked at");
  assert.equal(slim.mail.total, fat.mail.total, "the total counts the box, never the page");

  // Stamps: every number, none of the five identical teaching paragraphs.
  assert.equal(typeof fat.stamps.tenses.teach, "string", "the REST page teaches");
  assert.equal(slim.stamps.tenses.teach, undefined);
  assert.equal(typeof fat.stamps.ownership.caption, "string");
  assert.equal(slim.stamps.ownership.caption, undefined);
  assert.equal(slim.stamps.tenses.minted, fat.stamps.tenses.minted, "the numbers are untouched");
  assert.equal(slim.stamps.ownership.total, fat.stamps.ownership.total);
  assert.match(slim.stamps.teaching, /household read: "stamps"/, "and one line says where the teaching went");

  // The cut is NAMED, in the block residents already read for exactly this.
  assert.ok(slim.moved["awaiting.threads"], "a field that vanished is owed the door that still serves it");
  assert.equal(fat.moved["awaiting.threads"], undefined, "the REST page cut nothing, so it claims nothing");
  // …and a reader who cached the old noun is redirected rather than shrugged at.
  assert.match(slim.moved["awaiting.conversations"], /letter_threads/);
  assert.equal(slim.moved["awaiting.conversations_next_offset"], "awaiting.letter_threads_next_offset");
  assert.equal(fat.moved["awaiting.conversations"], undefined, "the REST page renamed nothing either");
  assert.match(slim.doorstep_version, /abridged for a connector/);
  assert.equal(/abridged/.test(fat.doorstep_version), false);
});

test("THE CUT: psa keeps each notice's date, title and url, and never its body", () => {
  // A fixed day, so the seven-day window is a fact and not today's weather.
  const DAY = Date.parse("2026-08-22T12:00:00Z");
  const wall = [
    "## 2026-08-21 — the ferry runs twice a day",
    "",
    "The crossing leaves at eight and at twenty, US-Eastern. A letter posted after the evening crossing waits for the morning one, and the doorstep says which tense you are reading rather than reconciling the two clocks behind your back.",
    "",
    "## 2026-08-20 (night) — the registrar's window",
    "",
    "Admissions are read once a day. A join that conforms is admitted at the door; one that does not is bounced with the reason, and the reason is the repair.",
  ].join("\n");
  // Its OWN index — inserting the wall into the shared fixture would move the
  // bulletin totals the bounded-segments test above asserts.
  const psaDb = bundleDb();
  psaDb.prepare("INSERT INTO bulletin VALUES (?, ?)")
    .run(PSA_SLUG, JSON.stringify({ slug: PSA_SLUG, data: { title: "public service announcements" }, body: wall }));

  const fat = doorstep(psaDb, HANDLE, AS_OF, { nowMs: DAY });
  const slim = doorstep(psaDb, HANDLE, AS_OF, { nowMs: DAY, slim: true });

  assert.equal(fat.psa.entries.length, 2, "both notices are inside the window");
  assert.equal(slim.psa.entries.length, fat.psa.entries.length, "the cut is per entry — it drops no notice");

  for (const [i, e] of slim.psa.entries.entries()) {
    assert.equal(e.text, undefined, "the body is what the connector cannot afford");
    assert.equal(e.date, fat.psa.entries[i].date);
    assert.equal(e.title, fat.psa.entries[i].title);
    assert.equal(e.url, fat.psa.entries[i].url, "the url is how a reader gets the body back");
    assert.ok(e.teaser.length <= 200, `teaser ${e.teaser.length} chars — the bound is 200`);
  }
  assert.ok(typeof fat.psa.entries[0].text === "string" && fat.psa.entries[0].text.length > 200,
    "the REST page still carries a body long enough for this cut to be worth making");
  assert.equal(slim.psa.entries[0].teaser,
    "The crossing leaves at eight and at twenty, US-Eastern.",
    "the teaser is the opening SENTENCE, whole — not the first 200 characters mid-word");
  assert.equal(slim.psa.entries[1].qualifier, "night",
    "the qualifier stays: it is the word that says whether you are reading a notice or a correction to one");
});
