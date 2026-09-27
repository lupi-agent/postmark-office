// leave-mark-drafts-and-docket.test.mjs — R3: two lists, two labels, and a
// resident's own mark is theirs.
//
// THE FINDING, verbatim, from the 2026-09-06 05:53 EDT resident walk:
//
//   "TAX — my 'drafts' are mostly not mine. `read: "leave-mark"` reports
//    `household: keeminlee, branch: draft/keeminlee, drafts: 18` — and 15 of
//    the 18 are by berthillon …, current-the-reader …, and histor-reeves ….
//    Those are other households. Either the public docket's pending claims are
//    being shown to me under the word 'drafts' with my household's branch name
//    on them (a wrong label on a right list), or I am reading other households'
//    sketchbooks (which the bulletin says are private). A resident cannot tell
//    which, and the difference matters."
//
// and, on the same read, in the same sitting:
//
//   "PAPER CUT — `yours: false` on my own mark in the backed list, beside
//    `holder: "wright"`. The stake knows it is mine; the row says it is not."
//
// ── THE LAW THE LABELS COME FROM ───────────────────────────────────────────
//
// `world2/schema/007_private_drafts.sql`, the row policy, one sentence:
//
//   CREATE POLICY claims_read ON claims FOR SELECT
//     USING (status <> 'draft' OR household = current_setting('app.household', true));
//
// A draft is private to its household; EVERY OTHER STATUS IS PUBLIC, by design
// — "the docket is fully public and this migration does not touch that". So the
// two words are not a naming preference, they are the two sides of that line,
// and a read that puts them under one word is telling a resident that a thing
// the whole town can see is their private compose space.
//
// The pure halves are tested here directly. `overlayShape`'s dropped fields are
// what made the split impossible, so the first test asserts they arrive.

import test from "node:test";
import assert from "node:assert/strict";

import { markPage } from "../src/world.mjs";
import { backedRow } from "../src/world-stake.mjs";
import { pgDraftsForKey, LIVE_STATUSES } from "../world2/tools/guard-reads.mjs";

// ── the store's own two statuses, and that the door can still see them ──────

test("LIVE_STATUSES is exactly the two sides of 007's line — private and public", () => {
  assert.deepEqual([...LIVE_STATUSES], ["draft", "pending"],
    "the overlay reads both, and 007's policy makes only the first private");
});

/** A `claims` row as `LIVE_CLAIM_SELECT` returns it. */
const row = (over = {}) => ({
  id: "00000000-0000-0000-0000-000000000001",
  slug: "wright/a-thing", class: "mark", claimant: "wright", household: "gh:67605380",
  status: "draft", body: "a thing", geometry: { slug: "a-thing", at: { x: 1, y: 2 } },
  stake: 0, data: JSON.stringify({ by: "wright", kind: "thing" }), submitted_at: "2026-09-06T19:13:13Z",
  ...over,
});

/** A pg client stub that answers the two queries `pgDraftsForKey` makes. */
function stubClient(rows) {
  return {
    sql: [],
    async query(text, params) {
      this.sql.push({ text, params });
      // BOTH session settings (POS-160 RULING 4). `app.household` is the one
      // current spelling; `app.household_keys` is the set 024's four draft
      // policies compare against, and `assertHouseholdDeclared` refuses a guard
      // read on a connection that declared only the first. This fixture's house
      // wears one spelling, so its set is one long.
      if (/current_setting/.test(text)) return { rows: [{ declared: "gh:67605380", keys: ["gh:67605380"] }] };
      if (/FROM acts/.test(text)) return { rows: [] };
      return { rows };
    },
  };
}

test("THE FIELD THAT MAKES THE SPLIT POSSIBLE: claim_status and household reach the door", async () => {
  const client = stubClient([
    row({ id: "00000000-0000-0000-0000-00000000000a", slug: "wright/a-draft", status: "draft" }),
    row({ id: "00000000-0000-0000-0000-00000000000b", slug: "wright/a-staked-thing", status: "pending", stake: 1 }),
  ]);
  const { marks } = await pgDraftsForKey(client, { household: "gh:67605380" });

  const byId = new Map(marks.map((m) => [m.id, m]));
  assert.equal(byId.get("wright/a-draft").claim_status, "draft",
    "liveMarkOf has always put this on the record; overlayShape dropped it one function before the door");
  assert.equal(byId.get("wright/a-staked-thing").claim_status, "pending");
  assert.equal(byId.get("wright/a-draft").household, "gh:67605380",
    "and whose it is, so a reader can check the label rather than trust it");

  // The delta's own word is UNCHANGED — this is additive, not a rename.
  assert.equal(byId.get("wright/a-draft").status, "added");
  assert.equal(byId.get("wright/a-staked-thing").status, "added");
});

test("RED CONTROL: the two rows are indistinguishable WITHOUT claim_status", async () => {
  const client = stubClient([
    row({ slug: "wright/a-draft", status: "draft" }),
    row({ id: "00000000-0000-0000-0000-00000000000b", slug: "wright/a-staked-thing", status: "pending", stake: 1 }),
  ]);
  const { marks } = await pgDraftsForKey(client, { household: "gh:67605380" });
  const stripped = marks.map(({ claim_status, household, ...rest }) => rest);
  assert.deepEqual(
    new Set(stripped.map((m) => m.status)), new Set(["added"]),
    "one word for both — this is the eighteen rows the walk could not tell apart");
});

// ── the split itself, as `worldMyMarks` performs it ─────────────────────────
//
// The predicate is one line in `world.mjs`; it is asserted here on the same
// shapes the door hands it, so a change to it goes red in a test that names
// the law rather than only in a door test that needs a clone.

const split = (live) => ({
  drafts: live.filter((m) => m.claim_status !== "pending"),
  docket: live.filter((m) => m.claim_status === "pending"),
});

test("a PENDING claim files under docket — public, and never under the private word", () => {
  const { drafts, docket } = split([{ id: "a", claim_status: "pending" }]);
  assert.equal(drafts.length, 0, "a thing the whole town can read is not a compose space");
  assert.equal(docket.length, 1);
});

test("a DRAFT claim files under drafts", () => {
  const { drafts, docket } = split([{ id: "a", claim_status: "draft" }]);
  assert.equal(drafts.length, 1);
  assert.equal(docket.length, 0);
});

test("a SKETCHBOOK row — no claim status at all — is private, so it files under drafts", () => {
  // GUARD 2's own header: dropping the sketchbook half "would make a resident's
  // existing work vanish from their own overlay on the day the guard flipped".
  const { drafts, docket } = split([{ id: "a" }]);
  assert.equal(drafts.length, 1, "a row the docket has never held cannot be on the docket");
  assert.equal(docket.length, 0);
});

test("the walk's eighteen: three private and fifteen public separate cleanly", () => {
  const live = [
    ...Array.from({ length: 3 }, (_, i) => ({ id: `wright/mine-${i}`, claim_status: "draft" })),
    ...Array.from({ length: 15 }, (_, i) => ({ id: `other/theirs-${i}`, claim_status: "pending" })),
  ];
  const { drafts, docket } = split(live);
  assert.equal(drafts.length, 3);
  assert.equal(docket.length, 15);
  assert.ok(drafts.every((m) => m.id.startsWith("wright/")),
    "nothing that is not the caller's own private work may carry the private word");
});

// ── the counts and the page still agree ────────────────────────────────────

// ── `yours` on your own mark (the walk's paper cut) ────────────────────────

const MINE = (h) => h === "wright" || h === "rei";
const STAKE = { mark: "wright/the-flip-day-plumb-line", holder: "wright", n: 1, weight: 1 };

test("THE PAPER CUT, ended: a staked mark canon has not published yet is still YOURS", () => {
  // `mark: null` is the whole case — the walk's mark had not crossed, so
  // published canon held no row for it.
  const r = backedRow(STAKE, { mark: null, belongs: MINE });
  assert.equal(r.yours, true, 'the walk read `yours: false` here, beside `holder: "wright"`');
  assert.equal(r.by, "wright", "the author is in the id — <by>/<slug>, 006's path identity");
  assert.equal(r.stamps, 1);
});

test("and the four nulls SAY they are unread, instead of reading as an empty mark", () => {
  const r = backedRow(STAKE, { mark: null, belongs: MINE });
  assert.deepEqual([r.kind, r.tier, r.body], [null, null, null]);
  assert.match(r.unread, /neither published canon nor your own live layer/);
});

test("a mark the live layer DOES hold fills its fields and carries no `unread`", () => {
  const mark = { id: STAKE.mark, by: "wright", kind: "thing", tier: "market", body: "a plumb line" };
  const r = backedRow(STAKE, { mark, belongs: MINE });
  assert.equal(r.body, "a plumb line");
  assert.equal(r.unread, undefined);
  assert.equal(r.yours, true);
});

test("somebody ELSE's mark that you have staked is NOT yours — the word still means what it meant", () => {
  const r = backedRow({ mark: "ethan-thorne/the-joinery", holder: "wright", n: 2, weight: 2 },
    { mark: null, belongs: MINE });
  assert.equal(r.yours, false, "backing a neighbour's mark is not owning it");
  assert.equal(r.by, "ethan-thorne");
  assert.equal(r.holder, "wright", "you hold the stamps; they hold the mark");
});

test("a malformed id yields by: null and yours: false — never a guessed owner", () => {
  const r = backedRow({ mark: "", holder: "wright", n: 1 }, { mark: null, belongs: MINE });
  assert.equal(r.by, null);
  assert.equal(r.yours, false);
});

test("COUNT FIRST, SLICE AFTER survives the fourth list", () => {
  const docket = Array.from({ length: 25 }, (_, i) => ({ id: `x/m${i}` }));
  const counts = { docket: docket.length };
  const k = markPage(docket, 0);
  assert.equal(counts.docket, 25, "the count is the whole of what you own");
  assert.equal(k.page.length, 20, "the page is bounded");
  assert.equal(k.rest.length, 5, "and the rest are NAMED, not dropped");
  assert.equal(k.complete, false);
});
