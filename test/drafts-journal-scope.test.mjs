// drafts-journal-scope.test.mjs — READER CONFIGURATION (3), tested rather than
// assumed: `WORLD_SINGLE_LOG=1` with the guards off, which reads the SQLITE
// journal and which nobody had traced.
//
// ── THE HYPOTHESIS I WAS HANDED ────────────────────────────────────────────
//
// The re-reviewer's lead, and it is a good one: `world-journal.mjs §
// draftsForKey` scopes the journal half through
//
//     readJournal(db, { household: resolvedWorldHousehold(key), cls: CLASS_MARK })
//
// where `resolvedWorldHousehold` returns `key.household` VERBATIM — the
// `draft/<household>` branch component — while `pgLiveMarks` scopes against
// Postgres `claims.household`, resolved through `identities` into `gh:<id>` or
// `solo:<handle>`. Two columns, two stores, two vocabularies for one word, and
// **sqlite has no RLS at all** — so on this path the WHERE clause is the only
// net there has ever been.
//
// The prod dump is consistent with a resolver whose miss path invents
// `solo:<handle>` from whichever handle it is handed: `identities` holds NO row
// for berthillon / current-the-reader / histor-reeves, berthillon's claims carry
// TWO keys for one handle (`solo:berthillon` ×8, `solo:devadavisson` ×9), and
// histor-reeves is `solo:kristinashoultz-wq` — a fourth spelling.
//
// ── WHAT THIS FILE FOUND ───────────────────────────────────────────────────
//
// The hypothesis does not hold, and I could not make it red. Reported as a
// NEGATIVE RESULT with the probes that produced it, because "I could not make
// it red" is only worth anything if the attempts are on the page — and because
// the conductor asked for exactly this if the reader was not there.
//
// The journal half is scoped by its own column, and the ONE state that would
// drop the filter (`readJournal`'s `if (household)`) is unreachable from this
// door: a null household bounces in `draftDeltaForKey` two lines earlier and
// `draftsForKey` returns that bounce before the journal is opened.
//
// ── AND THE STRUCTURAL FACT BOTH READER TABLES MISS ────────────────────────
//
// `draftDeltaForKey` is the FIRST CALL IN BOTH ENTRY POINTS:
//
//   guards ON   world2-guards.mjs:258   const gitDelta = branches.draftDeltaForKey(repo, key)
//   guards OFF  world-journal.mjs:1082  const gitDelta = draftDeltaForKey(repo, key)
//
// and both return `{ ...gitDelta, marks: <union> }`. **There is no flag that
// turns the git half off.** So the stale-base leak proved in
// `drafts-leak-stale-base.test.mjs` runs in ALL THREE configurations, and
// configuration (2) cannot be excluded by a flag — which is what the two reader
// tables (mine and the reviewer's) both did, from opposite directions.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readJournal, CLASS_MARK, ACTION_LEAVE } from "../src/world-journal.mjs";
// ── THE ROWS ARE SEEDED, NOT WRITTEN BY A DOOR (G1 / POS-156) ───────────────
//
// G1 deleted the general journal INSERT; the write path writes the RECORD now.
// What this suite is about is a READER of the sqlite journal, which is live
// code whose retirement is G2's -- so the population it reads is PUT THERE by
// this file, in the office's own row shape. Nothing below claims a door wrote
// these rows. See test/journal-seed.mjs.
import { seedJournalRow } from "./journal-seed.mjs";
import { openDynamic } from "../src/dynamic-store.mjs";
import { resolvedWorldHousehold } from "../src/world-branches.mjs";

const scratch = mkdtempSync(join(tmpdir(), "postmark-journal-scope-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } });

const dbPath = join(scratch, "dynamic.db");
const db = openDynamic(dbPath);
after(() => { try { db.close(); } catch { /* already gone */ } });

const leave = (household, actor, id) => seedJournalRow(db, {
  crossing: 174, actor, action: ACTION_LEAVE, object: id, cls: CLASS_MARK,
  payload: { by: actor, slug: String(id).split("/")[1], kind: "thing", body: "a mark" },
  household,
});

// Two households in one journal, spelled the way the office key spells them —
// the `draft/<household>` branch component, which is what `appendJournal` is
// handed and what `readJournal` filters on.
leave("keeminlee", "wright", "wright/the-flip-day-plumb-line");
leave("keeminlee", "rei", "rei/the-garden-notebook-tin");
leave("devadavisson", "current-the-reader", "current-the-reader/the-decks");
leave("devadavisson", "current-the-reader", "current-the-reader/the-toucan-poster");
leave("devadavisson", "berthillon", "berthillon/pistache-cone-for-julian");

const idsFor = (household) =>
  readJournal(db, { household, cls: CLASS_MARK }).map((r) => r.object).sort();

test("RED CONTROL: the journal really holds two households' marks", () => {
  const all = readJournal(db, { cls: CLASS_MARK }).map((r) => r.object);
  assert.equal(all.length, 5, "if the fixture held one household, every leg below would pass vacuously");
  assert.ok(all.includes("current-the-reader/the-decks"));
  assert.ok(all.includes("wright/the-flip-day-plumb-line"));
});

test("the journal half IS scoped by its own column — no cross-household row comes back", () => {
  assert.deepEqual(idsFor("keeminlee"), ["rei/the-garden-notebook-tin", "wright/the-flip-day-plumb-line"]);
  assert.deepEqual(idsFor("devadavisson"), [
    "berthillon/pistache-cone-for-julian",
    "current-the-reader/the-decks",
    "current-the-reader/the-toucan-poster",
  ]);
});

test("A COARSE SPELLING DOES NOT WIDEN IT EITHER — the match is exact, not a prefix", () => {
  // The grain hypothesis: a key whose household is coarser than the rows'.
  // sqlite `=` is exact, so a coarser or finer spelling matches NOTHING rather
  // than matching MORE — the failure direction is empty, not wide.
  assert.deepEqual(idsFor("deva"), []);
  assert.deepEqual(idsFor("devadavisson-commons"), []);
  assert.deepEqual(idsFor("solo:devadavisson"), [],
    "the Postgres vocabulary against the sqlite column matches nothing — the two namespaces do not silently overlap, they simply miss");
});

test("THE ONE STATE THAT DROPS THE FILTER, and why this door cannot reach it", () => {
  // `readJournal`'s guard is `if (household) { where.push("household = ?") }`,
  // so a FALSY household returns the whole town. That is real, and it is the
  // shape the leak would need.
  assert.equal(readJournal(db, { cls: CLASS_MARK }).length, 5,
    "with no household the journal answers town-wide — this is the state the door must never reach");

  // And it cannot be reached through `draftsForKey`: every key that resolves to
  // a falsy household bounces in `draftDeltaForKey` first, and `draftsForKey`
  // returns that bounce before the journal is opened
  // (`world-journal.mjs:1082-1083`).
  for (const key of [
    null,
    {},
    { household: "", handles: new Set(["wright"]) },
    { household: "keeminlee", handles: new Set() },
    { household: "keeminlee", handles: new Set(["wright"]), visitor: true },
    { household: "../etc", handles: new Set(["wright"]) },
  ]) {
    assert.equal(resolvedWorldHousehold(key), null,
      `${JSON.stringify(key)} must resolve to null — and a null household bounces the delta before the journal is read`);
  }
});

test("NEGATIVE RESULT, stated: configuration (3) is not the reader", () => {
  // Everything above is the evidence for one sentence, and the sentence is a
  // negative — so it says what would change it.
  const mine = idsFor("keeminlee");
  assert.ok(!mine.some((id) => id.startsWith("current-the-reader/") || id.startsWith("berthillon/")),
    "if this ever fails, configuration (3) IS the reader and this file becomes the reproduction");
});
