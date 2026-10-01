// home-bounce-carries-the-card.test.mjs — the bounce carries the instructions
// for the thing it says you do not have (postmark-town/postmark#2889, kogane's
// third item).
//
// THE DEFECT AS REPORTED. "An act's card stands behind the thing it teaches you
// to make." `household { read: "home" }` is `do: "home"`'s shadow and answers
// the card beside the page — so the one caller who most needs the instructions,
// the one with no home page, was the only caller who could not reach them: the
// 404 took the card down with the page.
//
// MEASURED BEFORE BUILDING, on the MCP skin against the fixture town:
//
//     read:"home" handle:"wright"          → {read, of, card, home, reading_law}
//     read:"home" handle:"nobody-home-xyz" → {error, code, defect, hint}
//
// WHAT IS UNDER TEST is that relation, not any wording: a card exists for the
// SAME read whether or not the page does. The `hint` may be rewritten freely.
//
// THE REST SKIN IS PART OF THE CONTRACT, not an omission. `shadowReadAnswer`
// gates the card on `slim` because the card rides the MCP envelope and REST is
// "stable/simple for frozen consumers"; a card appearing on a REST 404 would
// move bytes on a surface the door deliberately keeps still. So the bounce is
// gated the same way, and the REST half is asserted to be untouched.
//
//   node --test test/home-bounce-carries-the-card.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { householdApex } from "../src/household-apex.mjs";
import { fixtureDb } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

const dir = mkdtempSync(join(tmpdir(), "postmark-home-bounce-"));
const dbPath = join(dir, "fixture.db");
fixtureDb(dbPath).close();
// The doors below run in this process and read their town index from a store
// seeded from this fixture (POS-268, office-under-test.mjs).
const IX = await indexStore(dbPath);
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });
const db = new DatabaseSync(dbPath, { readOnly: true });
after(() => { db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const keyFor = (handle) => ({ household: "keemin", handles: new Set([handle]) });
const read = (handle, extra = {}) =>
  householdApex({ read: "home", handle }, keyFor(handle),
    { db, clone: null, dbPath, schemas: {}, schemaRequired: {}, ...extra });

// The fixture town's `wright` holds a home page; nobody else invented here does.
const WITH_PAGE = "wright";
const NO_PAGE = "nobody-home-xyz";

test("FALSIFIER — the 404 for a missing home page carries the card that makes one", async () => {
  const bounced = await read(NO_PAGE, { slim: true });

  // it is still a bounce, and still says the same thing
  assert.equal(bounced.error, "bounce");
  assert.equal(bounced.code, 404);
  assert.match(bounced.defect, /no home page/);

  // THE RED LINE. Before this repair the object held exactly
  // {error, code, defect, hint} — the act's own card was unreachable from the
  // one answer whose reader has not performed the act.
  assert.ok(bounced.card, "the bounce must carry the act's card — it is the instructions for the thing it says you lack");
  assert.equal(bounced.card.act, "home");
  assert.equal(bounced.card.dispatches_to, "update_home");
  assert.ok(typeof bounced.card.teaches === "string" && bounced.card.teaches.length > 0);
});

test("the card on the bounce is the SAME card the successful read carries", async () => {
  const [ok, bounced] = await Promise.all([read(WITH_PAGE, { slim: true }), read(NO_PAGE, { slim: true })]);

  // ANTI-VACUITY FIRST: the success path must really be carrying a card, or the
  // comparison below would be two absences agreeing with each other.
  assert.ok(ok.card, "the success path carries a card — if this ever stops being true the test below means nothing");
  assert.equal(ok.read, "home");

  // One card for one act. Two derivations of "what does `do: home` take" is the
  // drift this office keeps a museum of, so the bounce asks the same builder.
  assert.deepEqual(bounced.card, ok.card);
  assert.equal(bounced.reading_law, ok.reading_law);
});

test("the REST skin is untouched — no card on either side, exactly as before", async () => {
  const ok = await read(WITH_PAGE);          // no slim: the REST shape
  const bounced = await read(NO_PAGE);

  assert.equal(ok.card, undefined, "REST answers the domain, not the envelope — the card has never ridden here");
  assert.equal(bounced.card, undefined, "and a REST bounce must not start carrying one");
  assert.deepEqual(Object.keys(bounced).sort(), ["code", "defect", "error", "hint"]);
});

test("a card that cannot be built leaves the bounce a plain bounce, never a 500", async () => {
  // The class store is a garnish on a refusal. `read: "address"` is the sibling
  // shadow read one line up in the same door and is deliberately NOT given the
  // card by this change (one item, one fix) — it stands here as the control that
  // the change is scoped, and as proof the bounce shape survives without a card.
  const address = await householdApex({ read: "address", handle: NO_PAGE }, keyFor(NO_PAGE),
    { db, clone: null, dbPath, slim: true, schemas: {}, schemaRequired: {} });

  assert.equal(address.error, "bounce");
  assert.equal(address.code, 404);
  assert.equal(address.card, undefined,
    "the sibling read is named on #2889 and left alone — if it grows a card, that was a deliberate second item, not this one");
});
