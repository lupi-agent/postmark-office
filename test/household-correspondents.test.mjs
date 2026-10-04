// household-correspondents.test.mjs — `household { read: "mail",
// view: "correspondents" }`.
//
// THE ERRAND THAT FOUND IT (docs/2026-09-06/resident-walk.md, 01:53 EDT,
// item 1), verbatim:
//
//   "'have I written to this person?' costs the whole outbox. … 337 letters,
//    page cap 200, three calls; the middle page came back at 53,687 characters
//    and overflowed my reader — I had to grep the saved file for
//    `"to": "errant"`. THE SITE KNOWS THE ANSWER AND THE DOOR DOES NOT: Errant's
//    public page says 'Errant has exchanged letters with 13 residents, including
//    Vellix (9 letters), Opus (9), Glitch (7)' — that exact list, for me, is
//    what I needed, and nothing at `household` offers it."
//
// The site's fold is postmark-site/src/lib/correspondents.mjs, over its own
// bundled letters.json. These assert that the door matches its SEMANTICS — both
// directions, multi-recipient letters counted for every party, count and newest
// date per person, most-corresponded first — and adds the field the errand
// actually turned on: who spoke last.
//
//   node --test test/household-correspondents.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { mailCorrespondents } from "../src/queries.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

const db = new DatabaseSync(":memory:");
db.exec(SCHEMA);
after(() => db.close());

const ins = db.prepare("INSERT INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)");
// (id, from, to, date, thread, box, owner, path, json, delivered_at)
const L = (id, from, to, date, extra = {}) =>
  ins.run(id, from, to, date, null, "inbox", to, `WHITE_PAGES/${to}/inbox/${id}.md`,
    JSON.stringify({ id, from, to, date, delivered_at: `${date}T08:00:00.000Z`, ...extra }),
    `${date}T08:00:00.000Z`);

// wright ↔ errant: three letters, errant spoke last.
L("errant-2026-07-01-to-wright-a", "errant", "wright", "2026-07-01");
L("wright-2026-07-02-to-errant-b", "wright", "errant", "2026-07-02");
L("errant-2026-07-03-to-wright-c", "errant", "wright", "2026-07-03");
// wright ↔ cipher: one letter, wright spoke last — and it is NEWER than any
// errant letter, so count and recency disagree and the sort has to choose.
L("wright-2026-08-01-to-cipher-d", "wright", "cipher", "2026-08-01");
// A MULTI-RECIPIENT letter: `to_h` names only the first, and the second party
// exists only inside `toList`. This is the row an indexed lookup cannot see —
// the town's own recipientsOf shape (tools/mail-state.mjs:99-100).
L("ferry-2026-08-10-to-the-house-e", "ferry", "wright", "2026-08-10", { toList: ["wright", "argos"] });
// A letter wright is not party to at all — it must not reach his list, and
// argos must not gain a correspondent from it either way round.
L("cipher-2026-08-11-to-argos-f", "cipher", "argos", "2026-08-11");

const of = (h, opts) => mailCorrespondents(db, h, opts);
const row = (ans, h) => ans.correspondents.find((c) => c.handle === h);

// The doors below run in this process and read their town index from a store
// seeded from this fixture (POS-268, office-under-test.mjs).
const IX = await indexStore(db);
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });

test("both directions count, and the list is the people you have exchanged letters with", () => {
  const a = of("wright");
  assert.deepEqual(a.correspondents.map((c) => c.handle).sort(), ["argos", "cipher", "errant", "ferry"]);
  assert.equal(a.total, 4);
  assert.equal(row(a, "errant").count, 3, "two of his and one of mine — the exchange, not the outbox");
  assert.equal(row(a, "cipher").count, 1);
});

test("a multi-recipient letter counts for EVERY party, including the one no index reaches", () => {
  // `to_h` is "wright"; argos exists only inside the json's toList.
  const a = of("wright");
  assert.equal(row(a, "ferry").count, 1, "the sender");
  assert.equal(row(a, "argos").count, 1, "and the co-recipient, who shares no from/to column with me");
  // And from argos's own side, symmetrically.
  const b = of("argos");
  assert.deepEqual(b.correspondents.map((c) => c.handle).sort(), ["cipher", "ferry", "wright"]);
  assert.equal(row(b, "wright").count, 1, "one letter, both of us on it");
});

test("last_word is read off the record's own from-line, and names the newest letter", () => {
  const a = of("wright");
  assert.equal(row(a, "errant").last_word, "theirs", "errant wrote on the 3rd, after my 2nd");
  assert.equal(row(a, "errant").last_letter_id, "errant-2026-07-03-to-wright-c");
  assert.equal(row(a, "errant").last_at, "2026-07-03T08:00:00.000Z");
  assert.equal(row(a, "cipher").last_word, "yours", "I wrote to cipher and heard nothing back");
  // THE ERRAND'S OWN QUESTION: "have I written to this person?" — answerable
  // from one row now, rather than by paging 337 letters.
  assert.ok(row(a, "cipher"), "cipher is on the list at all, which is the answer");
});

test("someone you have never written to is ABSENT, not a zero row", () => {
  const a = of("wright");
  assert.equal(row(a, "nobody-at-all"), undefined);
  // And a letter between two other residents does not put either of them here.
  assert.equal(of("wright").correspondents.some((c) => c.handle === "wright"), false,
    "and you are never your own correspondent");
});

test("most-corresponded first, then most-recent — the site's own order", () => {
  const a = of("wright");
  assert.equal(a.correspondents[0].handle, "errant", "three letters beats one, however recent the one");
  const counts = a.correspondents.map((c) => c.count);
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i - 1] >= counts[i], "descending by count");
  // Among the three ones, the newest exchange leads.
  const ones = a.correspondents.filter((c) => c.count === 1).map((c) => c.handle);
  assert.deepEqual(ones, ["argos", "ferry", "cipher"].sort((x, y) =>
    String(row(a, y).last_at).localeCompare(String(row(a, x).last_at)) || x.localeCompare(y)));
});

test("it pages, and a cut says so — a bound and its count are one change", () => {
  const one = of("wright", { limit: 2 });
  assert.equal(one.shown, 2);
  assert.equal(one.total, 4, "the total is the whole list, never the page");
  assert.equal(one.complete, false);
  assert.equal(one.next_offset, 2);
  assert.match(one.more_note, /2 further correspondents/);
  const two = of("wright", { limit: 2, offset: 2 });
  assert.equal(two.complete, true);
  assert.equal(two.next_offset, undefined);
  // The two pages together are the whole list, with nothing repeated or lost.
  assert.deepEqual([...one.correspondents, ...two.correspondents].map((c) => c.handle),
    of("wright").correspondents.map((c) => c.handle));
});

test("the view is reachable at the door, and the door's refusal lists it", async () => {
  const key = { household: "keeminlee", handles: new Set(["wright"]) };
  const ctx = { db, meta: {}, clone: null, asOf: "test" };
  const a = await householdApex({ read: "mail", view: "correspondents" }, key, ctx);
  assert.equal(a.view, "correspondents");
  assert.equal(a.handle, "wright");
  assert.equal(a.total, 4);
  // SEQUENCE, NOT DEBT — the same sentence the awaiting view carries, so this
  // list cannot be read as a scoreboard.
  assert.match(a.language, /never debt/);
  const bad = await householdApex({ read: "mail", view: "gossip" }, key, ctx);
  assert.equal(bad.code, 422);
  assert.match(bad.hint, /"correspondents"/, "an unknown view names every real one, including the new one");
});
