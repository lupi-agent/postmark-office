// foyer-shrink.test.mjs — the household door's foyer: identity first, schemas
// on request, a focused pending read, a canonical readback, and a retry key.
//
//   node --test test/foyer-shrink.test.mjs
//
// EVERY FALSIFIER HERE QUOTES THE SENTENCE IT ASSERTS. Where a planted law
// already owns the ground the quote is the mark's own; where the ground is new,
// the quote is the resident's, attributed — a test that paraphrases a law is a
// test of the paraphrase.
//
// ── THE RESIDENT'S NOTES (Hal, of lillith's household, 2026-08-26, after a
//    day of using this door as resident `hal`) ─────────────────────────────
//
//   (1) "Bare household {} should return only identity/authority and a compact
//        capability index: household, handles, tier, visitor status, credential
//        scope, paper gaps, and act/read names."
//
//   (2) "Put full schemas behind an explicit card request — {"cards":["send"]}
//        or {"card":"send"} — rather than returning every act's fields on every
//        identity check."
//
//   (3) "Add a focused pending-mail read, e.g. household { read: "mail", view:
//        "pending", handle: "hal" }, returning exact standing IDs, recipient,
//        thread, written time, sequence, and expected crossing."
//
//   (4) "After do: "send", consider returning a canonical verification read in
//        the receipt: 'verify with household/read mail/view pending' — naming
//        the exact readback path would make recovery mechanical."
//
//   (7) "Give agents an explicit idempotency seam if retries become common:
//        client nonce or content hash, with duplicate refusal returning the
//        original receipt."
//
// ── THE LAWS ALREADY PLANTED THAT THIS WORK STANDS ON ─────────────────────
//
//   `the-town/the-disclosure` (kind: predicated, tier: constitution,
//   2026-08-18), slot `disclosure`, value "refuse or disclose absent inputs;
//   never quietly substitute":
//
//       "An answer given without its inputs must never wear the grammar of an
//       answer that had them."
//
//   OPERATIONS.md § Breaking-change rules (founder-ruled 2026-08-26):
//
//       "The REST and MCP skins may deliberately hold different promises
//       (REST: stable/simple for frozen consumers; MCP: renegotiated per
//       session) — one implementation, two contracts, both pinned by tests."
//
//   src/town-mail.mjs § THE HOT TENSE IS ASYMMETRIC HERE, the mail law:
//
//       "the SENDER sees their pending letter; the RECIPIENT sees nothing at
//       all, until the crossing delivers it."
//
// F5 is the one that guards the founder's actual exposure: the REST bare answer
// is compared BYTE FOR BYTE against a golden captured from the base commit, so
// the shrink cannot reach a frozen consumer without turning this file red.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { fixtureDb } from "./fixture.mjs";
import {
  CARD_TEACH, HOUSEHOLD_DISPATCHABLE, HOUSEHOLD_READS, READING_LAW,
  ACT_SHADOW_READS, assertActCardsReachable,
  capabilityIndex, householdApex,
} from "../src/household-apex.mjs";
import { hotMailBlock, outboxTense, replayLetter, sendLetterAsRow, MAIL_DOOR, NONCE_MAX } from "../src/town-mail.mjs";
import { pendingRows } from "../src/town-journal.mjs";
import { enqueueLetter } from "../src/write.mjs";
import { outboxSettled } from "../src/queries.mjs";

delete process.env.TOWN_PUSH; // nothing here may leave the machine

// THE ANSWERS MUST BE REPRODUCIBLE OR THE GOLDEN IS NOISE. Two inputs vary by
// machine: the world store the card blurbs are quoted from, and the world block
// the paper gaps consult. Both are pinned — the store to a path that does not
// exist (so every blurb falls back to the office's own `inline`, exactly as a
// box with no world does), the block to a fixed object injected through ctx.
process.env.WORLD_STORE_DB = join(tmpdir(), "pm-foyer-no-such-world-store.db");

const trash = [];
after(() => { for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

// NOT in `trash`, and the order is the reason: hooks run in registration order,
// so the sweep above would delete this directory while the index below still
// holds its file open — EPERM on Windows, and a green suite that fails to tear
// down is a suite that will fail on someone else's machine for a reason that
// has nothing to do with the door.
const dir = mkdtempSync(join(tmpdir(), "pm-foyer-"));
const dbPath = join(dir, "fixture.db");
fixtureDb(dbPath).close();
const db = new DatabaseSync(dbPath, { readOnly: true });
after(() => { db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const KEY = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };
const LIMEN = { household: "limen-house", handles: new Set(["limen"]), ghId: "43", ghLogin: "limenkeeper" };

/** The world block, frozen: sited, readable, the same on every machine. */
const worldBlock = async () => ({ sited: true, unreadable: false });

/** A town log of its own, with the meta table the cursor reads. */
const logDb = () => {
  const d = new DatabaseSync(":memory:");
  d.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  return d;
};

/** A town clone the envelope pre-flight can scan and the pen can commit into. */
function mailClone() {
  const d = mkdtempSync(join(tmpdir(), "pm-foyer-town-"));
  trash.push(d);
  for (const h of ["wright", "limen"]) {
    mkdirSync(join(d, "WHITE_PAGES", h, "outbox"), { recursive: true });
    mkdirSync(join(d, "WHITE_PAGES", h, "inbox"), { recursive: true });
    writeFileSync(join(d, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n\n# ${h}\n`);
  }
  writeFileSync(join(d, "WHITE_PAGES", "mail-ledger.md"), "# the mail ledger\n\n");
  const git = (...a) => execFileSync("git", ["-C", d, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return d;
}

const flagOn = async (fn) => {
  process.env.TOWN_SINGLE_LOG = "1";
  try { return await fn(); } finally { delete process.env.TOWN_SINGLE_LOG; }
};

// The live tool schemas, so a card read back here carries the same fields the
// real door would put on it rather than an empty set.
const { TOOLS } = await import("../src/mcp.mjs");
const SCHEMAS = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
const REQUIRED = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.required ?? []]));

const ctx = (extra = {}) => ({ db, worldBlock, ...extra });
const letter = (over = {}) => ({ from: "wright", to: "limen", title: "a fine hat", body: "Limen —\n\nA test letter.", ...over });

// ── (1) THE FOYER ───────────────────────────────────────────────────────────

test('F1 · Hal: "Bare household {} should return only identity/authority and a compact capability index" — no act\'s field schema rides the connector\'s bare answer', async () => {
  const bare = await householdApex({}, KEY, ctx({ slim: true }));
  assert.ok(Array.isArray(bare.acts), "the capability index is still an array named `acts`");
  for (const entry of bare.acts)
    assert.deepEqual(Object.keys(entry).sort(), ["act", "fields", "teaches"],
      `the index carries an act, its line, and its field NAMES — nothing else; "${entry.act}" carried ${Object.keys(entry).join("+")}`);
  // ⚠ THE LAW IS ABOUT SCHEMAS, NOT ABOUT A KEY NAMED `fields`. Hal's sentence
  // is "returning every act's fields on every identity check", and what he was
  // reading when he wrote it was every field's TYPE and its paragraph of prose.
  // Field names are an index; types and descriptions are the manual. So this
  // asserts the manual is absent — checked over the whole serialized answer,
  // because a schema moved one key sideways is the same enormous page renamed.
  assert.equal(/"(type|description)"\s*:/.test(JSON.stringify(bare)), false,
    "a field's type or prose anywhere on the bare answer is the thing Hal was reading when he wrote that sentence");
  // and the names are the CARD's names, so the index cannot drift from it.
  // BOTH sides are built with the live tool schemas: an index built without
  // them renders empty fields, and comparing an empty set to a full one would
  // fail for a reason that has nothing to do with the law being asserted.
  const withSchemas = ctx({ slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED });
  const bareS = await householdApex({}, KEY, withSchemas);
  const card = await householdApex({ read: "send" }, KEY, withSchemas);
  assert.deepEqual(
    Object.keys(bareS.acts.find((a) => a.act === "send").fields),
    Object.keys(card.card.fields),
    "the index names exactly the fields the card describes");
});

test("F1b · the connector's affordance buttons survive the shrink — every act still passes the prototype's own gate", async () => {
  // THE GATE, verbatim from ops/mcp-prototype/mcp-proto.js § collectActions:
  //
  //     e.fields && typeof e.fields === "object" && !Array.isArray(e.fields)
  //
  // Wright's fix round asked for `required: [names]`, which does NOT satisfy
  // it — an array is not the object the gate wants, and an entry without
  // `fields` at all mints no button. That is why the index carries a name-only
  // `fields` map instead. Asserted here rather than trusted, AND the quoted
  // line is checked against the prototype file below, so if that gate is ever
  // rewritten this test goes red instead of quietly asserting a dead rule.
  const gate = (e) => Boolean(typeof e.act === "string" && e.act
    && e.fields && typeof e.fields === "object" && !Array.isArray(e.fields));

  const src = readFileSync(join(import.meta.dirname, "..", "ops", "mcp-prototype", "mcp-proto.js"), "utf8");
  assert.ok(src.includes('e.fields && typeof e.fields === "object" && !Array.isArray(e.fields)'),
    "the gate this test replicates has moved — re-read collectActions before trusting the line above");

  const bare = await householdApex({}, KEY, ctx({ slim: true }));
  const passing = bare.acts.filter(gate);
  assert.equal(passing.length, bare.acts.length,
    `every act must mint a button; ${bare.acts.length - passing.length} did not`);
  // the shape that was asked for, proven insufficient — so the deviation is
  // recorded as a fact rather than as a preference
  assert.equal(gate({ act: "send", teaches: "x", required: ["from", "to"] }), false,
    "`required: [names]` alone mints no button — this is why the index carries `fields`");
});

test("F2 · a shrink that loses a verb is not a shrink — the index names every act the door dispatches", async () => {
  const bare = await householdApex({}, KEY, ctx({ slim: true }));
  assert.deepEqual(bare.acts.map((a) => a.act), [...HOUSEHOLD_DISPATCHABLE]);
  // the index is a PROJECTION of the card, so its line can never say something
  // the full card does not: same string, both places.
  const card = await householdApex({ read: "send" }, KEY, ctx({ slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED }));
  assert.equal(bare.acts.find((a) => a.act === "send").teaches, card.card.teaches);
});

test('F3 · Hal: "act/read names" — the read names ride the bare answer too, and the page teaches how to open a card', async () => {
  const bare = await householdApex({}, KEY, ctx({ slim: true }));
  assert.deepEqual(bare.reads, HOUSEHOLD_READS, "the read menu is the door's own table, not a second list");
  assert.equal(bare.abridged, CARD_TEACH);
  assert.match(bare.abridged, /read: "send"/, "the teaching sentence carries the literal call, not a description of it");
  // NO SECOND SPELLING SURVIVES. `card` and `cards` are not keys of this door
  // at all any more — the card is fetched by the act's own name through
  // `read:`, which is the world door's grammar and now this one's.
  assert.equal("cards" in bare, false, "the teaching sentence rides `abridged`");
  assert.equal("card" in bare, false);
  const card = await householdApex({ read: "send" }, KEY, ctx({ slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED }));
  assert.equal(card.card.act, "send", "and the card comes back under `card`, singular, beside the `read` that named it");
});

test("F4 · the identity half is UNTOUCHED by the shrink — tier, household, residents, papers, next, credential all say what the unabridged answer says", async () => {
  const slim = await householdApex({}, KEY, ctx({ slim: true }));
  const full = await householdApex({}, KEY, ctx());
  for (const k of ["tier", "household", "residents", "papers", "next", "credential"])
    assert.deepEqual(slim[k], full[k], `${k} is identity, and identity is what Hal asked to KEEP`);
  assert.equal(slim.reading_law, READING_LAW, "Hal, of this sentence: worth the small token cost");
  assert.equal(full.reading_law, READING_LAW);
});

// ── (5) THE CONTRACT LINE ───────────────────────────────────────────────────

// The golden: the bare answer this door gave at 068eab3, captured through the
// same pinned inputs this file runs everything under. Kept as a file rather
// than as assertions about its shape, because "byte for byte" is the promise
// OPERATIONS makes to a frozen consumer and a shape assertion is a weaker one.
// Regenerated by `node tools/capture-household-golden.mjs`, and ONLY from a
// commit you mean to freeze — re-capturing from this branch would make F5
// assert that the change equals the change. The one in the tree is 068eab3's.
const GOLDEN = join(import.meta.dirname, "golden", "household-bare-rest-shape.json");

// ⚠ THE INPUT THESE ARE CALLED WITH IS THE POINT. Until 2026-08-31 F5 and F7d
// called householdApex through a ctx that OMITTED `schemas` — the exact input
// src/server.mjs:1127 injects on the live GET /household — so the golden was
// blind to every field schema a REST caller actually receives. The profile
// act's `image` and `display_name` put +568 bytes onto the live answer and both
// tests stayed green through it. They now inject the live schemas, so the
// falsifier and the door are looking at the same answer.
const REST = () => ctx({ schemas: SCHEMAS, schemaRequired: REQUIRED });

// THE CEILINGS, and why these two numbers. Founder-ruled 2026-08-31: additive
// fields are not a break, so bytes must not be an equality — but growth must
// stay VISIBLE and BOUNDED rather than unwatched. Measured at c552296 with the
// live schemas injected: REST bare 12,534 bytes, connector bare 4,641.
//
//   REST_CEILING  16,384 (16 KiB) — ~30% over today, which absorbs several more
//                 additive fields of the profile act's size before it trips,
//                 and catches a doubling: a card duplicated onto every act, or
//                 a roster that grew without anyone looking.
//   SLIM_CEILING   8,192 (8 KiB) — deliberately BETWEEN the two measurements.
//                 This is the load-bearing one: if the foyer's abridgement were
//                 ever lost, the connector's bare answer would jump to the
//                 unabridged 12,534 and trip this ceiling immediately. A bound
//                 that could not be crossed by the regression it names would be
//                 decoration.
// POS-207 (2026-09-25, Keemin's go through Wright): raised to 24,576 (24 KiB) on
// this ceiling's own rule, "~30% over today": three calendar act cards took the
// bare answer to 19,353, which no honest trim of three cards brings back under
// 16,384. SLIM_CEILING is untouched and stays the load-bearing bound.
const REST_CEILING = 24_576;
const SLIM_CEILING = 8_192;

test('F5 · OPERATIONS.md: "REST: stable/simple for frozen consumers" — the REST bare answer keeps its SHAPE, every key and the type at it', async () => {
  const { shapeOf } = await import("../tools/capture-household-golden.mjs");
  const full = await householdApex({}, KEY, REST());
  assert.ok(existsSync(GOLDEN), `the golden is the receipt; without it this test proves nothing (${GOLDEN})`);
  assert.deepEqual(shapeOf(full), JSON.parse(readFileSync(GOLDEN, "utf8")),
    "a pane in the wild reads named keys off this answer. A key REMOVED or RETYPED is the break the shape rule names. A key ADDED reddens this too, and is meant to: additive growth is lawful but 'shape changes ship with a PSA' (founder, 2026-08-31), so the golden is regenerated deliberately, with the PSA, rather than drifting quietly — which is exactly what the old byte golden let the profile act do");
  // ⚑ REGENERATED 2026-09-17 FOR POS-83, and named here because a regenerated
  // golden otherwise asserts that the change equals the change. What grew: the
  // stake act's card gained `preview`, the founder's opt-in confirmation step
  // for acts that move stamps (#2814). ADDITIVE and proven so rather than
  // asserted — the capture diff added exactly two keys
  // (`fields/preview/{type,description}`) and removed or retyped none, which is
  // what makes it lawful under the shape rule. PSA for the release notes: "a
  // stamps preview is live — pass preview: true to any stake and read what it
  // would do before it does it."
  //
  // This is the WITNESS the regeneration would otherwise have no room for, and
  // it is positional-independent on purpose: the stake act is found by the one
  // field only it carries, so a reordering of the acts list cannot make it pass
  // by looking at somebody else's card.
  const frozen = JSON.parse(readFileSync(GOLDEN, "utf8"));
  const stakeCard = frozen.acts.find((a) => a.fields && "pot" in a.fields);
  assert.ok(stakeCard, "the stake act is the only one carrying a `pot` field");
  assert.equal(stakeCard.fields.preview?.type, "string",
    "the frozen shape carries the preview field's own type — shapeOf records the TYPE NAME, so a boolean field reads as the string 'boolean' here");
  // …AND THE LIVE DOOR, not only the frozen copy of it. The deepEqual above
  // cannot tell a matched drop-and-regenerate from a door that never changed:
  // lose the field and re-capture, and the golden agrees with the loss. This one
  // reads the answer the door just gave, so it reds on the drop whatever the
  // golden says.
  assert.equal(full.acts.find((a) => a.fields && "pot" in a.fields)?.fields?.preview?.type, "boolean",
    "the live stake card still takes preview — the confirmation step the founder ruled is only live while the card advertises it");
  // ⚑ REGENERATED 2026-09-18 FOR #2921 (POS-106), and named here for the same
  // reason. What grew: the window act's card gained `file_path` — the pane read
  // from a file the town already holds, the way upload_media takes image_path.
  // What went: `html.required`, because html is now ONE OF TWO roads and a card
  // still marking it required would refuse a lawful file_path call. The capture
  // diff, key by key: +2 (`fields/file_path/{type,description}`), −1
  // (`fields/html/required`), 0 retyped. The removal is the one the shape rule
  // names, so it is said out loud rather than folded into "additive": a pane
  // that read `fields.html.required` off this answer now reads undefined, which
  // is the truth of the door. PSA for the release notes: "household do: window
  // takes file_path — hang the pane from a file in your own house instead of
  // re-sending it; html is no longer required, one of the two is."
  const windowCard = frozen.acts.find((a) => a.fields && "blueprint" in a.fields);
  assert.ok(windowCard, "the window act is the only one carrying a `blueprint` field");
  assert.equal(windowCard.fields.file_path?.type, "string");
  assert.equal(windowCard.fields.html?.required, undefined, "the frozen shape no longer marks html required");
  const liveWindow = full.acts.find((a) => a.fields && "blueprint" in a.fields);
  assert.equal(liveWindow?.fields?.file_path?.type, "string", "the live window card takes file_path");
  assert.equal(liveWindow?.fields?.html?.required, undefined, "and the live card does not mark html required — a card that did would refuse the road it advertises");
  // ⚑ REGENERATED 2026-09-24 FOR POS-207 + POS-208 (the calendar), named here
  // for the same reason. What grew: three act cards, `host`, `cancel-event`
  // and `rsvp`, appended to `acts`. The capture diff, key by key: +46, −0,
  // 0 retyped — every added key under the three new entries (each names the
  // acting resident with `handle`, the household door's rule), none on an
  // existing card. PSA for the release notes: "the town has a calendar —
  // household do: host puts an event on it (a title, a place, a start and an
  // end), do: rsvp joins one, and town { read: "calendar" } reads it."
  //
  // The witness is found by the one field only the host card carries (`place`),
  // in the frozen copy AND the live door, so a drop-and-recapture cannot pass.
  const hostFrozen = frozen.acts.find((a) => a.fields && "place" in a.fields);
  assert.equal(hostFrozen?.fields?.ends?.required, "boolean", "the frozen host card marks ends required — an event with no end is refused");
  const hostLive = full.acts.find((a) => a.fields && "place" in a.fields);
  assert.equal(hostLive?.act, "host");
  assert.equal(hostLive?.fields?.ends?.required, true, "the live host card marks ends required");
  // ⚑ REGENERATED 2026-09-26 FOR POS-227 (a host's announcement), named here
  // for the same reason. What grew: one act card, `announce`, appended to
  // `acts`. The capture diff, key by key: +16, −0, 0 retyped — every added key
  // under the one new entry (act, blurb, dispatches_to, teaches, and fields
  // handle / event / text), none on an existing card. PSA for the release
  // notes: "a host can speak to everyone attending — household do: announce
  // (event, text up to 1000 characters); each resident who RSVPed is woken
  // once with it, outside their wake budget, and the calendar shows it."
  //
  // The witness is the one field only the announce card carries (`text` beside
  // `event`), in the frozen copy AND the live door.
  const announceFrozen = frozen.acts.find((a) => a.fields && "text" in a.fields && "event" in a.fields);
  assert.equal(announceFrozen?.fields?.text?.required, "boolean", "the frozen announce card marks text required");
  const announceLive = full.acts.find((a) => a.fields && "text" in a.fields && "event" in a.fields);
  assert.equal(announceLive?.act, "announce");
  assert.equal(announceLive?.fields?.text?.required, true, "the live announce card marks text required");
});

test(`F5c · and the answer stays BOUNDED — REST under ${REST_CEILING}B, the connector's bare answer under ${SLIM_CEILING}B`, async () => {
  const rest = Buffer.byteLength(JSON.stringify(await householdApex({}, KEY, REST())));
  const slim = Buffer.byteLength(JSON.stringify(await householdApex({}, KEY, ctx({ slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED }))));
  assert.ok(rest <= REST_CEILING, `the REST bare answer is ${rest}B, over its ${REST_CEILING}B ceiling — growth is lawful, unbounded growth is not`);
  assert.ok(slim <= SLIM_CEILING, `the connector's bare answer is ${slim}B, over its ${SLIM_CEILING}B ceiling — this is what losing Hal's abridgement looks like`);
  // AND THE CEILINGS MUST STILL MEAN SOMETHING: a bound so far above the
  // measurement that nothing could reach it is not a bound. The slim ceiling in
  // particular has to sit BELOW the unabridged answer, or the regression it
  // exists to catch would pass straight through it.
  assert.ok(slim < rest, "the abridgement is what makes these two numbers different");
  assert.ok(SLIM_CEILING < rest, "the slim ceiling must sit below the unabridged answer or it cannot catch the shrink being lost");
});

test("F5b · and the slim-only keys never leak onto it", async () => {
  const full = await householdApex({}, KEY, ctx());
  for (const k of ["reads", "cards", "abridged"])
    assert.equal(k in full, false, `${k} is the foyer's, and the foyer is the connector skin's`);
  for (const entry of full.acts)
    assert.ok(entry.fields && typeof entry.fields === "object",
      `${entry.act} keeps its full card on REST — ops/mcp-prototype § collectActions is gated on act+fields`);
});

// ── (2) THE CARD, READ BACK BY THE ACT'S OWN NAME ────────────────────
//
// Hal asked for the full schemas to sit behind "an explicit card request". My
// first build minted `card:` / `cards:` for it. The founder caught that as a
// grammar divergence: the WORLD door already resolves an act's card through
// `read:`, and says so in its own words —
//
//   "the full card for any one act (its fields, its dials, the class that
//    grants it, and the terms that would bind it) is one read away:
//    world { read: \"<action>\" }"
//
// — so a second spelling one door over is the `acts`/`actions` alias again,
// which the town retired the week it appeared. `cards:` was the sharper error:
// at the world door that key already means a TRIM DIAL (`cards: "names"`), so
// one word would have named two different operations depending which door you
// stood at. Dropped whole; nothing outside ever coded to it.

test("F6 · an ACT NAME is a read — household { read: \"send\" } answers that act's full card, in the world door's own shape", async () => {
  const full = await householdApex({}, KEY, ctx());
  const r = await householdApex({ read: "send" }, KEY, ctx({ slim: true }));
  assert.equal(r.read, "send", "the answer names what was read, exactly as world { read: <action> } does");
  assert.deepEqual(r.card, full.acts.find((a) => a.act === "send"),
    "the card read back is the card that used to ride the bare page — not a second rendering of it");
  assert.equal(r.reading_law, READING_LAW, "every answer, Hal said, and this is an answer");
  assert.deepEqual(Object.keys(r).sort(), ["card", "read", "reading_law"],
    "and the shape is the world's, key for key");
});

test("F6b · the retired spellings are GONE, not aliased — `card:` and `cards:` resolve nothing", async () => {
  // A deprecation cycle is what you owe a caller who coded to a key. Nothing
  // outside ever did: the spellings were retired BEFORE this branch merged
  // (2026-08-27, 916112b). So the correction is total.
  const withCard = await householdApex({ card: "send" }, KEY, ctx({ slim: true }));
  const withCards = await householdApex({ cards: ["send"] }, KEY, ctx({ slim: true }));
  for (const r of [withCard, withCards]) {
    assert.equal(r.card, undefined, "no card comes back from the retired key");
    assert.equal(r.cards, undefined);
    assert.equal(r.tier, "resident", "an unknown top-level key is simply not a request — the bare read answers");
  }
  const tool = (await import("../src/household-apex.mjs")).HOUSEHOLD_TOOL;
  assert.equal("card" in tool.inputSchema.properties, false, "and the schema no longer advertises them");
  assert.equal("cards" in tool.inputSchema.properties, false);
});

test("F7 · an unknown read bounces naming BOTH namespaces — the reads and the act cards", async () => {
  const r = await householdApex({ read: "nope" }, KEY, ctx({ slim: true }));
  assert.equal(r.error, "bounce");
  assert.equal(r.code, 422);
  assert.deepEqual(r.act_cards, [...HOUSEHOLD_DISPATCHABLE],
    "a caller who guessed wrong is told that act names read too — the menu cannot omit half of what the door serves");
  assert.deepEqual(r.household_reads, HOUSEHOLD_READS);
  assert.match(r.hint, /reads back its own full card/);
});

test("F7b · the FOURTEEN acts that own their name answer their card; the THREE that are also reads keep their read", async () => {
  // ⚠ THE ROUND ASKED FOR A DISJOINTNESS GUARD. It fired on the live door:
  // `address`, `home` and `window` have been both an act and a read since long
  // before this branch, because a read here IS that act's shadow. At the world
  // door the shadow read carries the card too; I tried that and the doorstep
  // bundle's falsifier refused it — a segment must BE the answer of the read it
  // names, and the doorstep composes `window` itself. So the grammar is total
  // for the bare acts and not for three, and this asserts exactly that rather
  // than a tidier sentence that is not true.
  //
  // ⚑ NINE → TEN, 2026-09-02 (#2392): `declare-stance-on` joined the roster as
  // a BARE act — its inbox read is `stances`, a different name, so it does not
  // shadow. The literal is kept rather than derived from the roster's own
  // length, which would assert only that the function can subtract: what this
  // number catches is an act quietly becoming a read (or the reverse), and a
  // census that moves with the thing it counts catches nothing. Update it in
  // the commit that changes the roster, and say why — as this line does.
  //
  // ⚑ TEN → THIRTEEN, 2026-09-24 (POS-207, POS-208): `host`, `cancel-event`
  // and `rsvp` joined as BARE acts. The calendar they fill is read at the TOWN
  // door (`town { read: "calendar" }`), so none of them shadows a household read.
  const { bare, shadowed } = assertActCardsReachable([...HOUSEHOLD_DISPATCHABLE], HOUSEHOLD_READS);
  assert.deepEqual(shadowed, ["address", "home", "window"]);
  //
  // ⚑ THIRTEEN → FOURTEEN, 2026-09-26 (POS-227): `announce` joined as a BARE
  // act; what it says is read on the calendar at the TOWN door, so it shadows
  // no household read.
  assert.equal(bare.length, 14);
  for (const act of bare) {
    const r = await householdApex({ read: act }, KEY, ctx({ slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED }));
    assert.equal(r.error, undefined, `read: "${act}" bounced — an act nobody can read is an act nobody can learn`);
    assert.equal(r.read, act);
    assert.ok(r.card && r.card.act === act, `read: "${act}" came back without its card`);
  }
});

// ── (2b) THE SHADOW READS' PARITY (founder-ruled 2026-08-31) ────────────────
//
// F7c used to assert the OPPOSITE of what follows: that no shadow read carries
// a card. That was the honest state of the door under the 2026-08-26 ruling,
// and the founder reversed it on 2026-08-31 — the card rides BESIDE the thing.
// The law these quote is the world apex's, verbatim from src/world-apex.mjs:
//
//     "read: is every action's shadow … anything you can do, you can read"
//
// and the reading the town door gave it when it built the same thing (618ba69):
// the shadow answers the act's DOMAIN beside its card, not the card alone.

test('F7c · the shadow reads answer the CARD BESIDE THE THING — the world apex: "anything you can do, you can read"', async () => {
  // ALL THREE now, window included — founder-ruled 2026-08-31, after the bundle
  // law was re-strung to say a segment carries the read's DOMAIN.
  for (const what of ACT_SHADOW_READS) {
    const r = await householdApex({ read: what, handle: "wright" }, KEY, ctx({ slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED }));
    assert.equal(r.error, undefined, `read: "${what}" bounced`);
    assert.equal(r.read, what, "the answer names the read it is");
    assert.ok(r.card && typeof r.card === "object", `read: "${what}" lost its card — that is the asymmetry this closed`);
    assert.equal(r.card.act, what, "the card is THIS act's card");
    assert.ok(r[what] && typeof r[what] === "object", `read: "${what}" lost its DOMAIN — a card instead of the thing is the same defect from the other side`);
    assert.equal(r.reading_law, READING_LAW);
    // KEY FOR KEY with the world door's shape, which is what "same grammar"
    // has to mean if it means anything. `of` is the household door's own
    // pre-existing key (whose resident this is) and is additive, not a rename.
    assert.deepEqual(Object.keys(r).sort(), ["card", "of", "read", "reading_law", what].sort(),
      `read: "${what}" answers {read, of, card, ${what}, reading_law} — the world apex's shape`);
  }
});

test("F7c2 · and the DOMAIN is byte-identical to what the read answered before the card arrived — a card that replaces the thing is not parity", async () => {
  // The failure this exists for is subtle and was made once already on this
  // branch: the card REPLACING the shadow read's payload instead of joining it
  // (M36, 2026-08-26). So the domain is compared against the REST answer, which
  // is the same computation with no card on it.
  for (const what of ACT_SHADOW_READS) {
    const rest = await householdApex({ read: what, handle: "wright" }, KEY, ctx({ slim: false, schemas: SCHEMAS, schemaRequired: REQUIRED }));
    const mcp = await householdApex({ read: what, handle: "wright" }, KEY, ctx({ slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED }));
    // ⚠ THE TWO READS RELATE TO THEIR REST ANSWER DIFFERENTLY, and pretending
    // otherwise would make this test assert the wrong thing for one of them.
    // `address` and `home` ALREADY answered an envelope before the parity
    // ({read, of, <domain>}), so their domain is rest[what]. `window` answered
    // the bare thing, so its whole REST answer IS the domain — and note it
    // happens to contain a `window` key of its own, which is exactly the trap a
    // uniform rest[what] would have fallen into.
    const restDomain = what === "window" ? rest : rest[what];
    assert.deepEqual(mcp[what], restDomain, `read: "${what}" — the connector's domain drifted from the frozen one`);
    assert.equal(mcp.of, rest.of ?? mcp.of);
  }
});

test('F7c3 · REST\'s shadow reads are FROZEN — OPERATIONS.md: "REST: stable/simple for frozen consumers; MCP: renegotiated per session"', async () => {
  // GET /household?read=address is a REST answer with a shape carved into
  // somebody's JS. The parity is the connector's renegotiation and must not
  // reach it — so the un-slim answer carries neither of the two new keys.
  for (const what of ACT_SHADOW_READS) {
    const r = await householdApex({ read: what, handle: "wright" }, KEY, ctx({ slim: false, schemas: SCHEMAS, schemaRequired: REQUIRED }));
    if (r.error) continue;
    assert.equal("card" in r, false, `REST read: "${what}" grew a card — that is a frozen consumer's shape moving`);
    assert.equal("reading_law" in r, false, `REST read: "${what}" grew the reading law — same freeze`);
  }
});

test("F7c4 · THE FORK IS RULED — `window` is at parity AND its doorstep segment is the read's DOMAIN, both at once", async () => {
  // ⚠ THIS TEST USED TO ASSERT THE FORK. Until the founder ruled on 2026-08-31
  // it read "THE WINDOW FORK, asserted rather than wished — `window` is a
  // doorstep SEGMENT, so its read is NOT at parity yet", and it asserted that
  // read: "window" carried NO card. It was written to go red the day the ruling
  // landed. The ruling landed; the reminder became the verdict.
  //
  // What was ruled: the bundle's law says a segment carries the read's DOMAIN,
  // not its envelope. So both halves below are true together, which under the
  // old law they could not be — and that simultaneity is the whole point.
  const { INDEX_SEGMENTS } = await import("../src/queries.mjs");
  const { doorstepBundle } = await import("../src/doorstep-bundle.mjs");
  assert.ok(INDEX_SEGMENTS.includes("window"), "window is still a doorstep segment — if it stops being one, this test is testing nothing");

  // HALF ONE: the read is at parity, card beside the thing.
  const r = await householdApex({ read: "window", handle: "wright" }, KEY, ctx({ slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED }));
  assert.ok(r.card && r.card.act === "window", "read: \"window\" carries the window act's card");
  assert.ok(r.window && typeof r.window === "object", "…and the thing, under its own key");

  // HALF TWO: the segment the morning page carries IS that read's domain.
  const meta = { as_of: "fixturesha000000000000000000000000000000" };
  const bctx = { db, key: null, meta, asOf: meta.as_of, canWrite: false, clone: null, pen: null, odb: null, dbPath: null };
  const d = await doorstepBundle("wright", bctx);
  const seg = Object.fromEntries(Object.entries(d.window).filter(([k]) => !["serves", "args"].includes(k)));
  assert.deepEqual(seg, r.window, "the segment is the read's DOMAIN — the envelope is the apex's and the page never sees it");
  assert.equal("card" in seg, false, "and no card reached the morning page");
});

// ── (2c) THE READ ROSTER, ADVERTISED (founder-ruled 2026-08-31) ─────────────

test("F19 · the advertised enum IS the accepted set — every name on it answers, and nothing accepted is left off", async () => {
  const { HOUSEHOLD_READ_ENUM, HOUSEHOLD_TOOL, HOUSEHOLD_READABLE } = await import("../src/household-apex.mjs");
  assert.deepEqual(HOUSEHOLD_TOOL.inputSchema.properties.read?.enum, [...HOUSEHOLD_READ_ENUM],
    "the tool schema advertises the roster itself, not a copy that can drift from it");
  // NOTHING ACCEPTED IS LEFT OFF: every read name and every act name is on it.
  for (const r of HOUSEHOLD_READABLE) assert.ok(HOUSEHOLD_READ_ENUM.includes(r), `read "${r}" is served and unadvertised`);
  for (const a of HOUSEHOLD_DISPATCHABLE) assert.ok(HOUSEHOLD_READ_ENUM.includes(a), `act "${a}" reads back its card and is unadvertised`);
  // AND NOTHING ADVERTISED IS REFUSED: the door answers every name it lists,
  // which is the half an enum usually gets wrong — asked at the live door, not
  // asserted against the same table the enum came from.
  for (const name of HOUSEHOLD_READ_ENUM) {
    const r = await householdApex({ read: name, handle: "wright" }, KEY, ctx({ slim: true, schemas: SCHEMAS, schemaRequired: REQUIRED }));
    assert.notEqual(r?.defect, `"${name}" is not a household read`,
      `the schema advertises read: "${name}" and the door refuses it — an enum that lies is worse than no enum`);
  }
});

test("F19b · the enum carries each name ONCE — three names are both an act and a read at this door", async () => {
  const { HOUSEHOLD_READ_ENUM, HOUSEHOLD_READABLE } = await import("../src/household-apex.mjs");
  assert.equal(HOUSEHOLD_READ_ENUM.length, new Set(HOUSEHOLD_READ_ENUM).size, "a duplicated enum entry is a malformed schema");
  assert.equal(HOUSEHOLD_READ_ENUM.length, HOUSEHOLD_READABLE.length + HOUSEHOLD_DISPATCHABLE.length - ACT_SHADOW_READS.length,
    "the union is deduped by exactly the shadow reads — the town door's flat spread would double them here");
});

test("F19c · THE DRIFT GUARD CAN FAIL — an unadvertised act and a phantom name are both refused", async () => {
  const { assertReadEnumMatchesDoor, HOUSEHOLD_READ_ENUM } = await import("../src/household-apex.mjs");
  assert.equal(assertReadEnumMatchesDoor(HOUSEHOLD_READ_ENUM, HOUSEHOLD_READS, HOUSEHOLD_DISPATCHABLE), true, "the door as it stands");
  // a new act born unadvertised — the exact drift the guard exists for
  assert.throws(() => assertReadEnumMatchesDoor(HOUSEHOLD_READ_ENUM, HOUSEHOLD_READS, [...HOUSEHOLD_DISPATCHABLE, "brand-new-act"]),
    /unadvertised: \[brand-new-act\]/, "an act the enum never learned about must throw at module load, not surprise a caller");
  // and a name advertised that the door would refuse
  assert.throws(() => assertReadEnumMatchesDoor([...HOUSEHOLD_READ_ENUM, "phantom"], HOUSEHOLD_READS, HOUSEHOLD_DISPATCHABLE),
    /advertised but refused: \[phantom\]/, "an enum entry the read branch bounces is the door lying about itself");
});

test("F7c5 · THE MORNING PAGE DID NOT FATTEN — the doorstep bundle is byte-identical to the pre-parity capture, on BOTH skins", async () => {
  // The receipt the whole shape of this change was chosen to earn. The golden
  // was captured at c552296, BEFORE the parity, by tools/capture-doorstep-golden.mjs.
  const GOLD = join(import.meta.dirname, "golden", "doorstep-bundle.json");
  assert.ok(existsSync(GOLD), `the golden is the receipt; without it this test proves nothing (${GOLD})`);
  const { doorstepBundle } = await import("../src/doorstep-bundle.mjs");
  // THE INSTANT IS THE TOOL'S OWN (POS-168). Six leaves of this page are a
  // function of the wall clock, so the golden and the door must be driven at
  // ONE instant or the receipt is red by the next crossing — which is what had
  // been happening. It is imported rather than re-spelled: a second copy of an
  // instant is how a doorstep and a receipt come to name different boats.
  const { GOLDEN_NOW_MS } = await import("../tools/capture-doorstep-golden.mjs");
  // THE FOURTH PINNED INPUT (POS-195, 2026-09-22): the stance credential. The
  // segment reads `claims` through `stance_reader` now, and the capture tool
  // pins the same two lines — one fixture, composed the same way on both sides,
  // which is the same reason the instant above is imported rather than
  // re-spelled.
  const { STANCE_ON, stancePoolFromJournal } = await import("./stance-pool-stub.mjs");
  const { dynamicDbPath } = await import("../src/dynamic-store.mjs");
  Object.assign(process.env, STANCE_ON);
  stancePoolFromJournal(dynamicDbPath());
  const meta = { as_of: "fixturesha000000000000000000000000000000" };
  const bctx = { db, key: null, meta, asOf: meta.as_of, canWrite: false, clone: null, pen: null, odb: null, dbPath: null, nowMs: GOLDEN_NOW_MS };
  const now = { full: await doorstepBundle("wright", bctx), slim: await doorstepBundle("wright", { ...bctx, slim: true }) };
  assert.equal(JSON.stringify(now), readFileSync(GOLD, "utf8"),
    "the morning page moved — every byte here is served on every doorstep, and this design exists to keep that number still");
  // ⚠ THE GOLDEN WAS REGENERATED ONCE, 2026-08-31, and this is the honest note
  // about it. The parity change moved the page by exactly TWO paths —
  // `full.the_bundle` and `slim.the_bundle` — because the bundle LAW SENTENCE
  // is printed on the page and that sentence was re-strung by the same ruling.
  // Nothing else differed (diffed path by path before regenerating).
  //
  // ⚠ AND REGENERATED A SECOND TIME, 2026-09-01, for the civic pointer. Same
  // discipline, same note: the page moved by exactly FOUR paths —
  // `full.civic.read`, `full.civic.note` and their two slim twins — diffed path
  // by path against the previous golden BEFORE the capture, so this assertion
  // is not saying my change equals my change about anything else. The ceiling
  // it exists to hold: 12077 -> 12227 bytes on the full skin (+150, +1.2%),
  // 11370 -> 11520 on the slim. That is a pointer — the five plaque BODIES it
  // points at are ~630 bytes and stayed at `town read: "asks"`, which is the
  // whole reason the block is two strings instead of a page. Hal's foyer bought
  // that 63% and it is not being spent back a field at a time.
  //
  // ⚠ AND REGENERATED A THIRD TIME, 2026-09-17, for the holo-is-liquid ruling
  // ("non-spendable is repealed; the stamps are like any other, but are holo to
  // signify the special source"). Same discipline, same note, and the diff was
  // run leaf by leaf BEFORE the capture: 616 paths before, 616 after, none added
  // and none removed, and exactly FOUR changed — `full.stamps.tenses.teach`,
  // `full.stamps.holo.teach`, `full.stamps.ownership.teach` and
  // `full.stamps.keeping_mint.teach`, the four sentences the ruling repealed.
  // The ceiling it moves: 14690 -> 14995 on the full skin (+305, +2.08%), and
  // the SLIM skin is BYTE-IDENTICAL at 12699 — the connector's morning page did
  // not move at all, because its abridgement already cuts the stamps teaching.
  // The ruling is taught in FULL on the holo section alone (holo's home, the
  // first-mention rule HOLO_EXPANSION already follows); the other three carry
  // only the fact that changed, which is what kept +840 down to +305.
  //
  // ⚠ AND REGENERATED A FOURTH TIME, 2026-09-21 (POS-168), because it had
  // stopped gating anything: it was RED at the baseline of every lane for days
  // and three lanes reported it red-both-sides and untouched. Two ruled
  // segments had landed after the third capture and the page also carried live
  // clock values, so no capture taken at a real instant could survive to the
  // next crossing. The fix was the instrument, not the rule — the door now
  // composes from ONE injectable instant and this case drives it at the
  // capture tool's own `GOLDEN_NOW_MS`, so the byte-exact rule can hold.
  //
  // Same discipline, same note, and the diff was run leaf by leaf BEFORE the
  // capture: 630 paths before, 922 after, NONE REMOVED, and every added path
  // traced to a numbered merged ruling — `stakes`, the ninth segment
  // (postmark#2919, `fb36916`), and `next_crossing` (postmark#2922,
  // `bba0361`). The two changed values outside them are the clock:
  // `rulings.since_crossing` 192 -> 200 and `through_crossing` 194 -> 202, the
  // crossing counter advancing, no shape moved.
  //
  // The ceiling it moves, and every byte of it is accounted for (residual 0):
  //
  //   full  15255 -> 18906 (+3651, +23.93%) = stakes +3423, next_crossing
  //                                            +211, segments[] +9, law +8
  //   slim  12959 -> 16538 (+3579, +27.62%) = stakes +3351, next_crossing
  //                                            +211, segments[] +9, law +8
  //
  // ⚠ CORRECTION (2026-09-21, POS-170) — THE FOUR NUMBERS ABOVE UNDER-REPORT THE
  // GOLDEN THE SAME COMMIT SHIPPED. Measured at `f1f4aa8` itself, that golden is
  // full 18974 and slim 16601, not 18906 / 16538: the prose is 68 and 63 bytes
  // low, 131 in total, and the file has not moved since (`git diff f1f4aa8 HEAD
  // -- test/golden/doorstep-bundle.json` is empty). The ceiling a reader checks
  // was 131 bytes below the ceiling the file actually holds, which is the one
  // failure mode a written-down ceiling has. The before-numbers in the fifth
  // note below are measured from the file, not carried forward from this prose.
  //
  // The slim skin is NOT abridged here the way it is for stamps: `stakes`
  // drops only `rule` and `read_the_rest` and rides the connector whole,
  // because the rows are the report (doorstep-bundle.mjs § the ninth segment).
  // That is the largest single jump this golden has taken, and it is one
  // segment's worth — the next one to arrive gets the same arithmetic printed
  // beside it or this ceiling stops being a number anyone can check.
  //
  // ⚠ AND REGENERATED A FIFTH TIME, 2026-09-21 (POS-170, postmark#3011), for the
  // civic line naming its two lanes. Kogane spent six days in town without ever
  // seeing the Think Tank or the Bounty Board: the pointer named the quarter's
  // READ and neither lane's NAME, and a name is what a resident searches for.
  //
  // Same discipline, same note, and the diff was run leaf by leaf BEFORE the
  // capture: 918 paths before, 918 after, NONE added and NONE removed, and
  // exactly TWO changed — `full.civic.note` and its slim twin. The note itself,
  // nothing else.
  //
  // The ceiling it moves, and every byte of it is accounted for (residual 0):
  //
  //   full  18974 -> 19019 (+45, +0.24%) = civic.note +45
  //   slim  16601 -> 16646 (+45, +0.27%) = civic.note +45
  //
  // The two skins move identically because `civic` is not abridged — it rides
  // the connector whole, the way it has since 2026-09-01. Forty-five bytes is
  // the price of two proper nouns and their read args; the five plaque BODIES
  // are still ~630 bytes behind `town read: "asks"` and did not come aboard.
  //
  // ⚠ AND REGENERATED A SIXTH TIME, 2026-09-24 (POS-138), for the set-down
  // group Keemin ruled into the stances read ("yes, in the same stances read").
  // The diff was run leaf by leaf BEFORE the capture: 924 paths before, 928
  // after, NONE removed and NONE changed; the four added are
  // `full.stances.set_downs_awaiting`, `full.stances.set_downs_unavailable` and
  // their slim twins. The fixture office is not pointed at the holding record,
  // so this page says so rather than showing an empty group as an answer; an
  // office that is pointed at it carries the empty array alone (+24).
  //
  //   full  19051 -> 19179 (+128, +0.67%) = set_downs_awaiting +24, set_downs_unavailable +104
  //   slim  16683 -> 16811 (+128, +0.77%) = set_downs_awaiting +24, set_downs_unavailable +104
  //
  // So the assertion below is the one that actually carries the promise, and it
  // is stated separately so a future regeneration cannot quietly absorb a card:
  assert.equal(JSON.stringify(now).includes('"card"'), false,
    "a card reached the doorstep — a token on every morning page ever served, and the cost this whole design was shaped to avoid");
});

/**
 * Run `fn` with the WALL clock forced to `ms`: `Date.now()` and a bare
 * `new Date()` both answer it, every other `Date` form (including `Date.parse`
 * and `Date.UTC`, inherited statics) is untouched. Restored in a `finally`.
 *
 * Top-level tests in one file run one at a time, so no other case sees the
 * swap — and this is the only instrument that can tell a threaded clock read
 * from an unthreaded one, because both look identical in the source of a
 * function that takes a default.
 */
async function underWallClock(ms, fn) {
  const Real = Date;
  class Frozen extends Real {
    constructor(...a) { if (a.length === 0) { super(ms); return; } super(...a); }
    static now() { return ms; }
  }
  globalThis.Date = Frozen;
  try { return await fn(); } finally { globalThis.Date = Real; }
}

test("F7c5b · THE PAGE READS THE CLOCK IT WAS HANDED — two wall clocks twenty hours apart, one instant, identical bytes", async () => {
  const { doorstepBundle } = await import("../src/doorstep-bundle.mjs");
  const { GOLDEN_NOW_MS } = await import("../tools/capture-doorstep-golden.mjs");
  const meta = { as_of: "fixturesha000000000000000000000000000000" };
  const base = { db, key: null, meta, asOf: meta.as_of, canWrite: false, clone: null, pen: null, odb: null, dbPath: null };
  const compose = (extra) => async () => JSON.stringify({
    full: await doorstepBundle("wright", { ...base, ...extra }),
    slim: await doorstepBundle("wright", { ...base, ...extra, slim: true }),
  });

  // TWENTY HOURS, not the obvious one. The page's windows are six hours wide
  // (crossings 00:00/12:00Z, settlements 06:00/18:00Z), so a one-hour shift
  // stays inside one window about five sixths of the time and the whole case
  // would pass on UNFIXED code most of the day. Twenty hours crosses both a
  // crossing and a settlement from any starting point, so every one of the six
  // clock leaves is obliged to move.
  const T1 = Date.parse("2026-09-21T09:00:00.000Z");
  const T2 = T1 + 20 * 3600 * 1000;

  // THE CONTROL, FIRST, and the leg below means nothing without it: handed NO
  // instant, the two wall clocks must give DIFFERENT pages. If they do not,
  // the swap is not reaching the door and the law leg would be a green over a
  // dead instrument — the exact triumph this lane was written to produce.
  const loose1 = await underWallClock(T1, compose({}));
  const loose2 = await underWallClock(T2, compose({}));
  assert.notEqual(loose1, loose2,
    "the wall-clock swap never reached the door, so the assertion below proves nothing — fix the instrument before believing it");

  // THE LAW: handed one instant, the page is the same under either wall clock.
  const held1 = await underWallClock(T1, compose({ nowMs: GOLDEN_NOW_MS }));
  const held2 = await underWallClock(T2, compose({ nowMs: GOLDEN_NOW_MS }));
  assert.equal(held1, held2,
    "a clock read on the doorstep is not threaded from `nowMs` — thread it, or the golden above goes red at some future hour on a lane that never touched this page");
});

test("F7c5c · THE FATTENING ARM CAN FAIL — the golden is the exact serialisation, so one more byte on the page is one more byte here", async () => {
  const GOLD = join(import.meta.dirname, "golden", "doorstep-bundle.json");
  const gold = readFileSync(GOLD, "utf8");
  // A reformatted golden reds F7c5 on whitespace while saying "the morning
  // page moved" — a true-sounding red about the wrong thing.
  assert.equal(JSON.stringify(JSON.parse(gold)), gold,
    "the golden is not the capture tool's own serialisation — regenerate it with the tool, never by hand or through a formatter");
  const fattened = JSON.parse(gold);
  fattened.full.handle += "x";
  assert.notEqual(JSON.stringify(fattened), gold, "one byte more on the page and the comparison must refuse it");
  assert.equal(JSON.stringify(fattened).length, gold.length + 1,
    "the arm measures BYTES, not shape — if this is not exactly one, F7c5 is not the ceiling it claims to be");
});

test("F7c5d · EVERY CLOCK READ ON THE PAGE IS THREADED — the bare forms are absent from the source", async () => {
  // A source pin, and it is the weaker leg: F7c5b above is the behavioural
  // proof. This one exists because each of these four reads takes a DEFAULTED
  // instant, so a hand that drops the argument gets today's behaviour back
  // with every assertion green until the next capture — the defaulted-parameter
  // silent caller, one file over.
  const SRC = join(import.meta.dirname, "..", "src", "doorstep-bundle.mjs");
  const raw = readFileSync(SRC, "utf8");
  // Comments first: a pin that forbids a token in prose forbids ever
  // explaining the change. Both controls, because a strip that ate nothing and
  // a strip that ate code print the same green.
  const code = raw.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.ok(code.length < raw.length, "the comment strip ate nothing — every pin below is reading prose");
  assert.ok(code.includes("export async function doorstepBundle"), "the comment strip ate code — every pin below is reading a hole");

  for (const [present, absent, what] of [
    [/nextCrossingForDoorstep\(\s*nowMs\s*\)/, /nextCrossingForDoorstep\(\s*\)/, "the header's boat"],
    [/doorstepRulings\([^)]*\bnowMs\b/, /doorstepRulings\(\s*handle\s*,\s*\{\s*key\s*\}\s*\)/, "the rulings segment's crossing cursor"],
    [/doorstepStakes\([^)]*\bnow:\s*new Date\(\s*nowMs\s*\)/, /doorstepStakes\(\s*handle\s*,\s*\{\s*key\s*\}\s*\)/, "the stakes segment's settlement"],
    [/doorstep\(\s*db\s*,\s*handle\s*,\s*asOf\s*,[^;]*\bnowMs\b/, null, "the index's PSA window"],
  ]) {
    assert.match(code, present, `${what} is no longer threaded from the page's one instant`);
    if (absent) assert.ok(!absent.test(code), `${what} is called with no instant somewhere in this file — the default puts the wall clock back`);
  }
});

test("F7d · and the REST bare answer keeps its shape — nothing in this grammar reached a frozen consumer", async () => {
  const { shapeOf } = await import("../tools/capture-household-golden.mjs");
  const full = await householdApex({}, KEY, REST());
  assert.deepEqual(shapeOf(full), JSON.parse(readFileSync(GOLDEN, "utf8")));
});

// ── (3) THE PENDING VIEW ────────────────────────────────────────────────────

test('F8 · Hal: a pending read "returning exact standing IDs, recipient, thread, written time, sequence, and expected crossing"', async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const sent = await sendLetterAsRow(letter({ thread: "new" }), KEY, db, clone, odb);
    const r = await householdApex({ read: "mail", view: "pending", handle: "wright" }, KEY, ctx({ odb, clone, slim: true }));
    assert.equal(r.box, "pending");
    assert.equal(r.total, 1);
    const row = r.standing[0];
    assert.equal(row.letter_id, sent.letter_id, "the exact standing ID");
    assert.equal(row.to, "limen", "recipient");
    assert.equal(row.thread, "new", "thread");
    assert.ok(row.written_at, "written time");
    assert.equal(row.seq, sent.logged.seq, "sequence");
    assert.equal(r.expected_crossing, sent.expected_crossing, "expected crossing");
    odb.close();
  });
});

test("F9 · the pending view is NOT a second tense computer — its ladder is the doorstep's own, called at the same inputs", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    await sendLetterAsRow(letter(), KEY, db, clone, odb);
    const r = await householdApex({ read: "mail", view: "pending", handle: "wright" }, KEY, ctx({ odb, clone, slim: true }));
    assert.deepEqual(r.freshness, outboxTense({
      inOutbox: outboxSettled(db, "wright"), standing: 1,
      settledAsOf: db.prepare("SELECT value FROM meta WHERE key = 'as_of'").get().value,
    }), "one owner: if the mail law's tense vocabulary changes, both surfaces move together");
    assert.deepEqual(r.standing, hotMailBlock(odb, KEY, { handle: "wright" }).standing,
      "and the rows are the doorstep's rows, not a second shaping of them");
    odb.close();
  });
});

test('F10 · `the-town/the-disclosure`: "An answer given without its inputs must never wear the grammar of an answer that had them" — another sender\'s pending mail is REFUSED, never answered zero', async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    // limen has a letter standing. wright asks about it.
    await sendLetterAsRow({ from: "limen", to: "wright", title: "a reply", body: "hello" }, LIMEN, db, clone, odb);
    assert.equal(pendingRows(odb).length, 1, "there IS something standing — a zero here would be a lie, not an emptiness");
    const r = await householdApex({ read: "mail", view: "pending", handle: "limen" }, KEY, ctx({ odb, clone, slim: true }));
    assert.equal(r.error, "bounce");
    assert.equal(r.code, 403);
    assert.match(r.defect, /not one of your residents/);
    assert.equal(r.total, undefined, "no count, honest or otherwise — the read did not happen");
    odb.close();
  });
});

test("F10b · and a sender with nothing standing is told a true zero, which must not look like the refusal", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const r = await householdApex({ read: "mail", view: "pending", handle: "wright" }, KEY, ctx({ odb, slim: true }));
    assert.equal(r.error, undefined);
    assert.equal(r.total, 0);
    assert.match(r.note, /nothing of yours is standing/);
    odb.close();
  });
});

test('F10d · flag-OFF, "nothing standing" would be true the way a stopped clock is right — so the view REFUSES instead', async () => {
  // No flagOn wrapper: this is an office where a letter is a committed file the
  // moment it conforms, so there is no pending half to read. `hotLetters`
  // answers [] here exactly as it does for a sender with an empty queue, and
  // rendering that as a true zero would wear the grammar of an answer that had
  // looked. `the-town/the-disclosure`, one door over from where it was applied
  // to the window read this morning.
  const odb = logDb();
  const r = await householdApex({ read: "mail", view: "pending", handle: "wright" }, KEY, ctx({ odb, slim: true }));
  assert.equal(r.error, "bounce");
  assert.equal(r.code, 503);
  assert.equal(r.total, undefined, "no count — the question does not apply in this world");
  assert.match(r.hint, /outbox/, "and it names the read that DOES answer here");
  odb.close();
});

test("F10c · a view the door does not serve still bounces, and the menu it prints names pending", async () => {
  const r = await householdApex({ read: "mail", view: "sideways", handle: "wright" }, KEY, ctx({ slim: true }));
  assert.equal(r.code, 422);
  assert.match(r.hint, /"pending"/, "the menu comes from the door — a refusal may not omit a view it serves");
});

// ── (4) THE READBACK ────────────────────────────────────────────────────────

test('F11 · Hal: "naming the exact readback path would make recovery mechanical" — the send receipt carries the call AND the letter\'s own id', async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const r = await householdApex({ do: "send", args: letter() }, KEY, ctx({ odb, clone, canWrite: true, slim: true }));
    assert.ok(r.verify, "the receipt names its own readback");
    assert.match(r.verify, /read: "mail"/);
    assert.match(r.verify, /view: "pending"/);
    assert.ok(r.verify.includes(r.result.letter_id),
      "the sentence carries the id, so a caller recovering from a dropped connection has the whole call and not a template");
    odb.close();
  });
});

test("F11b · and it rides the connector skin alone — a REST receipt is the receipt it was", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const r = await householdApex({ do: "send", args: letter() }, KEY, ctx({ odb, clone, canWrite: true }));
    assert.equal(r.verify, undefined, "REST: stable/simple for frozen consumers");
    assert.ok(r.result.letter_id);
    odb.close();
  });
});

// ── (7) THE IDEMPOTENCY SEAM ────────────────────────────────────────────────

test('F12 · Hal: "duplicate refusal returning the original receipt" — the same nonce twice writes ONE row and hands back the FIRST letter\'s receipt', async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const args = letter({ nonce: "retry-abc" });
    const first = await householdApex({ do: "send", args }, KEY, ctx({ odb, clone, canWrite: true, slim: true }));
    const second = await householdApex({ do: "send", args }, KEY, ctx({ odb, clone, canWrite: true, slim: true }));
    assert.equal(pendingRows(odb).length, 1, "NOTHING WAS WRITTEN TWICE — this is the whole seam");
    assert.equal(second.result.duplicate, true);
    assert.equal(second.result.letter_id, first.result.letter_id, "the ORIGINAL receipt, not a new one");
    assert.equal(second.result.logged.seq, first.result.logged.seq);
    assert.equal(second.result.nonce, "retry-abc");
    odb.close();
  });
});

test("F12b · a DIFFERENT nonce from the same sender is a different letter — the seam refuses duplicates, not sends", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    await householdApex({ do: "send", args: letter({ nonce: "one" }) }, KEY, ctx({ odb, clone, canWrite: true, slim: true }));
    await householdApex({ do: "send", args: letter({ title: "a second hat", nonce: "two" }) }, KEY, ctx({ odb, clone, canWrite: true, slim: true }));
    assert.equal(pendingRows(odb).length, 2);
    odb.close();
  });
});

test("F12c · a nonce cannot be probed across households — limen spending wright's nonce writes limen's own letter", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    await sendLetterAsRow(letter({ nonce: "shared-word" }), KEY, db, clone, odb);
    const r = await sendLetterAsRow({ from: "limen", to: "wright", title: "hers", body: "hi", nonce: "shared-word" }, LIMEN, db, clone, odb);
    assert.equal(r.duplicate, undefined, "the axis the lookup runs along never carries another household's rows");
    assert.equal(pendingRows(odb).length, 2);
    odb.close();
  });
});

test("F12d · THE DRAIN CANNOT TRIP ON THE NONCE — the replay lane's door is enqueueLetter, which never consults the log", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const sent = await sendLetterAsRow(letter({ nonce: "drain-me" }), KEY, db, clone, odb);
    const row = pendingRows(odb)[0];
    assert.equal(row.payload.args.nonce, "drain-me", "the row stores the caller's arguments verbatim, nonce included");
    const out = replayLetter(row, { doors: { [MAIL_DOOR]: enqueueLetter }, db, clone });
    assert.equal(out.skipped, undefined);
    assert.equal(out.result.letter_id, sent.letter_id);
    // The receipt that could only exist if the replay actually wrote: the file
    // the row itself named, on disk. A nonce check inside the replay lane would
    // have found this row's own still-pending self and skipped, and the outbox
    // would be empty.
    assert.deepEqual(readdirSync(join(clone, "WHITE_PAGES", "wright", "outbox")), [basename(row.payload.file)]);
    odb.close();
  });
});

// NARROWED by POS-70 §5 (ruled 2026-09-24): the five paper acts take the nonce
// now, over the town-log rows they already write (test/one-contract.test.mjs
// drives it through both doors). What still refuses it by name is every act
// with no town-log receipt to hand back — the world acts (until
// 027_act_nonce.sql), and household acts like the ballot stake.
test("F12e · a nonce on an act with no town-log receipt still bounces by name — the exemption is send and the five paper acts", async () => {
  const clone = mailClone();
  const r = await householdApex({ do: "stake-vote", args: { from: "wright", topic: "t", candidate: "c", stamps: 1, nonce: "x" } }, KEY,
    ctx({ clone, canWrite: true, slim: true, schemas: { stake_vote: { from: {}, topic: {}, candidate: {}, stamps: {} } } }));
  assert.equal(r.error, "bounce");
  assert.match(r.defect, /nonce/);
});

test('F13 · flag-off, the nonce is DISCLOSED as unhonoured rather than quietly accepted — "never quietly substitute"', async () => {
  const odb = logDb();
  const clone = mailClone();
  const r = await householdApex({ do: "send", args: letter({ nonce: "no-log-here" }) }, KEY,
    ctx({ odb, clone, canWrite: true, slim: true }));
  assert.equal(r.result.nonce_honoured, false, "an office with no log cannot remember a nonce, and says so");
  assert.match(r.result.nonce_note, /letter's id/, "and it names the guard that IS holding");
  assert.ok(r.result.commit, "the letter really was written — flag-off it is a file the moment it conforms");
  odb.close();
});

test("F13b · and a send with NO nonce is byte-for-byte the receipt it always was", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const r = await sendLetterAsRow(letter(), KEY, db, clone, odb);
    // THE CLAIM IS ABOUT NONCES, and it is asserted directly so it can fail on
    // its own — the key list below is a shape guard, and a shape guard cannot
    // stand in for the claim it sits beside.
    assert.deepEqual(Object.keys(r).filter((k) => /nonce|idempotent|duplicate/.test(k)), [],
      "a caller who passed no nonce is told nothing about nonces");
    // AND THE SHAPE IS STILL PINNED, so the receipt cannot fatten unnoticed —
    // the sibling concern F7c5 holds for the morning page. `office_bookkeeping`
    // joined 2026-09-07 (lane E item 7b): `commit: null` and `pushed: false` sat
    // beside `standing` on every successful send and read as failure to anyone
    // who has used git (walk #2, 2026-09-06, item 4). Neither field could be
    // dropped — flag-off the same receipt carries a real sha, and a caller
    // comparing the two must see the difference rather than infer it from an
    // absent key — so one sentence was added that says whose question they
    // answer. The list moves by hand, and this comment is why.
    // `next_crossing` joined 2026-09-18 (postmark#2922, Pica): the boat's
    // number, when it sails, how many minutes off, and the sentence — beside
    // `expected_crossing`, which stays because frozen consumers read it. One
    // boat, two spellings; test/next-crossing.test.mjs holds them equal.
    assert.deepEqual(Object.keys(r),
      ["letter_id", "commit", "standing", "expected_crossing", "next_crossing", "logged", "pushed", "office_bookkeeping"],
      "the receipt's shape is pinned; a key added without a reason reds here");
    odb.close();
  });
});

// ── (7b) THE RACE · the half no sequential test can reach ───────────────────
//
// Wright's fix round, 2026-08-26. The seam I shipped first was
// `read the log → await the envelope pre-flight → write`, and two calls with
// one nonce arriving together both passed the read before either wrote. I found
// it by reading, not by testing, and the reason is written into F15b below:
// every falsifier I had called the door, waited, and called again.
//
// PROVEN REACHABLE BEFORE IT WAS FIXED, not assumed: two overlapping calls
// through the unfixed body wrote TWO rows carrying ONE letter id (seq 1 and
// seq 2). The flip harness reds F15 by removing the in-flight map, which is the
// same defect installed the same way.

test("F15 · TWO CALLS AT ONCE, one nonce: exactly ONE letter is written, and the loser gets the winner's receipt", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const args = letter({ nonce: "race-1" });
    // Promise.all, not await-then-await: both calls must be in flight together,
    // which is the whole condition under test.
    const [a, b] = await Promise.all([
      sendLetterAsRow(args, KEY, db, clone, odb),
      sendLetterAsRow(args, KEY, db, clone, odb),
    ]);
    assert.equal(pendingRows(odb).length, 1,
      "two overlapping calls wrote two letters — the seam is a sequence, not a seam");
    assert.equal(a.letter_id, b.letter_id, "one letter, so one id");
    assert.equal(a.logged.seq, b.logged.seq, "and one row, so one seq");
    assert.equal([a.duplicate, b.duplicate].filter(Boolean).length, 1,
      "exactly one of the two is the duplicate — not both, and not neither");
  });
});

test("F15b · and it holds at five — the map is a gate, not a two-caller special case", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    const args = letter({ nonce: "race-5" });
    const out = await Promise.all([1, 2, 3, 4, 5].map(() => sendLetterAsRow(args, KEY, db, clone, odb)));
    assert.equal(pendingRows(odb).length, 1);
    assert.equal(out.filter((r) => r.duplicate).length, 4);
    assert.equal(new Set(out.map((r) => r.letter_id)).size, 1, "all five hold the same letter");
  });
});

test("F15c · a first call that BOUNCES spends no nonce — the waiter tries honestly rather than inheriting a failure", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    // `to` names nobody, so the first call throws inside the fence. A waiter
    // that treated a throw as "already spent" would refuse a letter that was
    // never written, which is the opposite of the seam's promise.
    const doomed = letter({ to: "nobody-here", nonce: "bounce-1" });
    const results = await Promise.allSettled([
      sendLetterAsRow(doomed, KEY, db, clone, odb),
      sendLetterAsRow(doomed, KEY, db, clone, odb),
    ]);
    assert.equal(results.filter((r) => r.status === "rejected").length, 2,
      "both are refused, and neither is handed a duplicate receipt for a letter that does not exist");
    assert.equal(pendingRows(odb).length, 0, "and nothing was written");
    // the nonce is not burned: a good letter carrying it still goes
    const ok = await sendLetterAsRow(letter({ nonce: "bounce-1" }), KEY, db, clone, odb);
    assert.equal(ok.duplicate, undefined);
    assert.equal(pendingRows(odb).length, 1);
  });
});

test("F16 · an over-long nonce is REFUSED, never trimmed — two nonces cut to one prefix would become one key", async () => {
  await flagOn(async () => {
    const odb = logDb();
    const clone = mailClone();
    await assert.rejects(
      () => sendLetterAsRow(letter({ nonce: "x".repeat(NONCE_MAX + 1) }), KEY, db, clone, odb),
      (e) => e.code === 422 && /nonce must be under/.test(e.defect),
      "a nonce past the cap bounces by name");
    assert.equal(pendingRows(odb).length, 0, "and writes nothing on the way out");
    // exactly at the cap still goes
    const ok = await sendLetterAsRow(letter({ nonce: "y".repeat(NONCE_MAX) }), KEY, db, clone, odb);
    assert.equal(ok.letter_id, "wright-" + ok.letter_id.split("-").slice(1).join("-"));
    assert.equal(pendingRows(odb).length, 1, "the cap is a bound, not an off-by-one");
  });
});

// ── (9) THE ROSTER GENERATOR'S FLOOR GUARD ─────────────────────────────────
//
// Wright's fix round: "the rendered roster can never silently present the
// fallback as the live enum."
//
// `world-classes.mjs § classRoster` already tells the truth — it returns
// `source: "floor"` and a `disclosed` sentence when the world store cannot be
// read. `classNames()` drops that sentence, and the doc generator rendered the
// two-name floor into docs/MCP-ROSTER.md as if it were the ~130-name live enum.
// The door disclosed; the renderer did not.

const ROSTER_TOOL = join(import.meta.dirname, "..", "tools", "mcp-roster.mjs");
const runRoster = (env, args = []) => spawnSync(process.execPath, [ROSTER_TOOL, ...args],
  { encoding: "utf8", env: { ...process.env, ...env } });

/** A world store the roster gate accepts: constitution-tier town marks in the works. */
function goodWorldStore() {
  const p = join(mkdtempSync(join(tmpdir(), "pm-foyer-world-")), "world.db");
  trash.push(join(p, ".."));
  const d = new DatabaseSync(p);
  d.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, subkind TEXT, tier TEXT, by TEXT, at_x REAL, at_y REAL, extent_w REAL, extent_h REAL, props TEXT);");
  d.prepare("INSERT INTO meta VALUES ('hydration_status','OK')").run();
  const ins = d.prepare("INSERT INTO nodes (id, kind, tier, by, props) VALUES (?, 'mark', 'constitution', 'the-town', ?)");
  for (const c of ["parcel", "letter", "window", "resident"])
    ins.run(`the-town/${c}`, JSON.stringify({ class: c, in_works: true, path: `WORLD/marks/the-town/the-keeping-works/${c}/mark.md` }));
  d.close();
  return p;
}

test("F17 · a FLOOR roster refuses to render — nothing is written and the exit code says so", () => {
  const outFile = join(mkdtempSync(join(tmpdir(), "pm-foyer-roster-")), "OUT.md");
  trash.push(join(outFile, ".."));
  const r = runRoster({ WORLD_STORE_DB: join(tmpdir(), "pm-foyer-no-such-world-store.db") }, ["--out", outFile]);
  assert.equal(r.status, 1, "a doc build that cannot see the record must fail loudly, not publish a smaller truth");
  assert.match(r.stderr, /REFUSING TO WRITE/);
  assert.match(r.stderr, /standing on its floor/, "and it repeats the door's own disclosure rather than inventing one");
  assert.equal(existsSync(outFile), false, "nothing was written");
});

test("F17b · --allow-floor renders, but the page itself carries the disclosure — the fallback is never presented as the live enum", () => {
  const outFile = join(mkdtempSync(join(tmpdir(), "pm-foyer-roster-")), "OUT.md");
  trash.push(join(outFile, ".."));
  const r = runRoster({ WORLD_STORE_DB: join(tmpdir(), "pm-foyer-no-such-world-store.db") }, ["--out", outFile, "--allow-floor"]);
  assert.equal(r.status, 0);
  const page = readFileSync(outFile, "utf8");
  assert.match(page, /is NOT the live roster/, "a reader of the artifact learns what the generator knew");
  assert.match(page, /standing on its floor/);
});

test("F17c · a GOOD store renders with NO warning — the stamp is a disclosure, not decoration", () => {
  const outFile = join(mkdtempSync(join(tmpdir(), "pm-foyer-roster-")), "OUT.md");
  trash.push(join(outFile, ".."));
  const r = runRoster({ WORLD_STORE_DB: goodWorldStore() }, ["--out", outFile]);
  assert.equal(r.status, 0, "a readable store renders without the flag");
  const page = readFileSync(outFile, "utf8");
  assert.equal(/is NOT the live roster/.test(page), false, "a page that always warned would be a page nobody reads the warning on");
  assert.match(page, /`parcel`/, "and the classes it renders are the store's own");
});

// ── the index's own honesty ────────────────────────────────────────────────

test("F14 · the capability index is generated from the acts table, so it cannot name an act the door will not dispatch", () => {
  assert.deepEqual(capabilityIndex().map((a) => a.act), [...HOUSEHOLD_DISPATCHABLE]);
  for (const { teaches } of capabilityIndex()) assert.ok(teaches && teaches.length > 10);
});
