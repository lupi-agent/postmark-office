// enter-exit-ledger.test.mjs — the passages are DERIVED, and a passage that was
// written can be read back.
//
// ── THE BUG THESE ANSWER TO ─────────────────────────────────────────────────
//
// Since the 2026-08-24 single-log cutover the enter/exit acts write a journal
// row and the ledger FILE stopped growing. Both occupancy readers still read
// the file. Measured on prod 2026-08-26: `/api/world/dynamic` answered
// `journal: 39, journal_drained_through: null` while the file, the box's serving
// clone and the office door all still served the same last line from
// 2026-08-24T19:39:13Z. Every passage in between succeeded, was recorded, and
// showed nowhere.
//
// ── THE LAW, QUOTED ─────────────────────────────────────────────────────────
//
// `the-town/enter`, class, constitution tier, version 4, source LOGOS/classes.md:
//
//     "An entry is one passage written — who crossed, into what, at a threshold
//      you truly stand before; exit writes the next, to the effective parent."
//
// `the-town/consent-at-thresholds`, class, constitution tier, version 1:
//
//     "Presence is free, effect is consented: entry meets the ground's own law,
//      silence welcomes, only the town's pen bars a leaving, refusals name
//      horizons."
//
// The first sentence is what the end-to-end falsifier below asserts: WRITTEN.
// A passage the record holds and no reader can reach is not written, it is
// buried. The second is what the consent-word falsifier asserts: the mark's
// answer is the effect's whole warrant, so a derivation that drops it would
// leave every passage unconsented and every refusal unrecorded.
//
// ── AND WHERE THE LIVE ERA NOW COMES FROM (POS-194, G1 gate 1 of 3) ─────────
//
// This module was the LAST live-era reader of the sqlite journal's enter/exit
// rows — the one STOP that held G1 shut. It reads `acts` now, and the sqlite
// read is DELETED rather than flagged.
//
// So the fixture below seeds A STORE, not a journal, and `dynamic.db` is not
// opened anywhere in this file except by the equality falsifier that exists to
// compare the two sources. Every other test here is green with NO JOURNAL TABLE
// IN EXISTENCE, which is the property G1 needs and the reason the fixture moved
// rather than being taught to write both.
//
// ⚑ WHICH TESTS DISCRIMINATE, said here so nobody reads a page of green as a
// page of guards. Restoring the sqlite read (docs/2026-09-22/rail/pos-194/
// flip.sh) reds E1/E2/E3 (the equality falsifier), S1/S2 (the source pins) and
// every case whose passages exist only in the store — which is all of them,
// because the journal table is never created. The three that would survive a
// restored sqlite read are the PURE halves (`journalLinesIn`,
// `deriveEnterExitLedger`, `frozenLinesIn`): they take rows as arguments and
// have no source at all, which is exactly why the port could not break them.
//
//   node --test test/enter-exit-ledger.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic } from "../src/dynamic-store.mjs";
import { CLASS_FRAME, CLASS_MOVE, readJournal } from "../src/world-journal.mjs";
// ── THE ROWS ARE SEEDED, NOT WRITTEN BY A DOOR (G1 / POS-156) ───────────────
//
// G1 deleted the general journal INSERT; the write path writes the RECORD now.
// What this suite is about is a READER of the sqlite journal, which is live
// code whose retirement is G2's -- so the population it reads is PUT THERE by
// this file, in the office's own row shape. Nothing below claims a door wrote
// these rows. See test/journal-seed.mjs.
import { seedJournalRow } from "./journal-seed.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import {
  LEDGER_NEW, LEDGER_OLD, LEDGER_FROZEN, DEPRECATED_DOOR, ledgerHeaderFrom,
  frozenLinesIn, journalLinesIn, deriveEnterExitLedger,
  enterExitLedgerText, emitEnterExitLedger, servedEnterExitLedger, livePassageRows,
} from "../src/enter-exit-ledger.mjs";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-enterexit-"));
after(() => sweep(scratch));

// The frozen era, as the real one reads: two passages made when each act still
// took its own commit. Verbatim from WORLD/threshold-ledger.md on world main.
const FROZEN_A = "- 2026-08-24T19:39:13.114Z · sable · enters sol-of-garrison/the-protected-grove · at 147.6377 · word neutral";
const FROZEN_B = "- 2026-08-24T19:39:13.114Z · sable · enters fabel-of-garrison/the-riverside-arcade · at 147.6377 · word neutral";
const FROZEN_HEADER = "# Enter/exit ledger — the frozen era\n\nEvery passage made when each act took its own commit.\n\n";

// ── THE RECORD, STUBBED — the store this office is pointed at ───────────────
//
// `world2-acts.mjs` exports `__setPoolForTest` for exactly this, and the stub
// answers the REAL query rather than a string it recognises: it filters on the
// actions the caller passed in `$1`, excludes the founding era the way the
// clause does, and hands `payload` back as an OBJECT, which is what the driver
// does with a `jsonb` column.
//
// IT REFUSES A QUERY IT DOES NOT UNDERSTAND, and that is the point of it. A
// stub that shrugged at an unrecognised SQL string and answered `[]` would let
// "the door serves the passage" pass while the door asked for nothing — and a
// stub that kept answering after the `_ledger` clause was dropped would let the
// founding era double into the live era with every test in this file still
// green.

/** The env that says "this office IS pointed at the record". */
const RECORD_ON = Object.freeze({ WORLD2_PG: "1", WORLD2_PG_URL: "postgres://stub/none" });
/** And the env of an office that is pointed at none. */
const RECORD_OFF = Object.freeze({});

let repo, dbPath, store, n = 0;

const makePool = (state) => ({
  async query(text, params = []) {
    if (!/FROM acts\b/.test(text))
      throw new Error(`the stub was handed a query that is not the passage read: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
    if (!/payload->>'_ledger' IS NULL/.test(text))
      throw new Error("the passage read no longer excludes the founding era — the frozen 155 would double into the live era and migrate out of the archive's own order");
    if (!/ORDER BY/.test(text))
      throw new Error("the passage read asked for no order — this record's whole meaning is its sequence");
    const want = new Set(params[0] ?? []);
    const rows = state.acts
      .filter((r) => want.has(r.action) && r.payload?._ledger == null)
      .sort((a, b) => Number(a.id) - Number(b.id));
    return { rows: rows.map((r) => ({ ...r, payload: structuredClone(r.payload) })) };
  },
});

beforeEach(() => {
  repo = join(scratch, `w${++n}`);
  mkdirSync(join(repo, "WORLD"), { recursive: true });
  writeFileSync(join(repo, LEDGER_FROZEN), `${FROZEN_HEADER}${FROZEN_A}\n${FROZEN_B}\n`);
  // THE JOURNAL TABLE IS NEVER CREATED in this fixture. This path names a db
  // that does not exist, and the only tests that open it are the equality
  // falsifier's — which builds its own, compares the two sources, and then
  // takes the sqlite side away. Anything else here needing it is a regression.
  dbPath = join(scratch, `dyn-${n}.db`);
  store = { acts: [] };
  __setPoolForTest(makePool(store));
});
after(() => { __setPoolForTest(null); });

// The world clone this office is wired to. The grammar module and the derived
// ledger's header travel with it, so the tests that need either say so rather
// than passing over an invented world.
const WORLD_CLONE_FOR_TEST = process.env.WORLD_CLONE ?? join(process.cwd(), "..", "postmark-world");
const GRAMMAR = ["tools/enter-exit.mjs", "tools/thresholds.mjs"]
  .find((rel) => existsSync(join(WORLD_CLONE_FOR_TEST, rel)));

/** A passage act exactly as `crossing-exec.mjs`'s payload reaches `acts` — the
 *  same action, the same `payload.ledger + payload.lines`. Copied from the pen
 *  rather than invented, so a change to the pen that this no longer matches is
 *  a change somebody has to come here and make; and BOTH pens put that payload
 *  into the store byte-unchanged (`insertAct` under the flip, `mirrorAct` under
 *  the shim), which is the whole reason the port moved a source and not a
 *  serializer. `id` is assigned by the record, as a serial is. */
const passageRow = ({ handle, lines, act = "enter", at = 147.9, seq = 1, ledger = LEDGER_NEW }) => {
  const row = {
    id: store.acts.length + 1, at: `2026-08-26T2${seq}:00:00.000Z`, crossing: String(at),
    actor: handle, action: act, object: "the-town/the-post-office",
    payload: { ledger, lines, summary: `${act}s the post office` },
  };
  store.acts.push(row);
  return row;
};

/** A non-passage act — the store's answer must not depend on it being absent. */
const otherAct = ({ action, actor, payload }) =>
  store.acts.push({ id: store.acts.length + 1, at: "2026-08-26T20:09:00.000Z", crossing: "151.3", actor, action, object: null, payload });

/** The live era's rows, through the module's own road into the record. */
const rows = async () => (await livePassageRows({ env: RECORD_ON })).rows;
const acts = (text) => text.split("\n").filter((l) => l.startsWith("- "));

// ── THE KILLER: an act performed appears in the served record ───────────────

test("END TO END — a passage written through the pen appears in the served ledger", async () => {
  // "An entry is one passage written" — `the-town/enter` v4.
  //
  // THIS IS THE ONE THAT WOULD HAVE CAUGHT THE TWO-DAY BUG, and it is built to
  // fail: point the deriver at the file instead of the journal and this goes
  // red, because the file has never heard of this line. Run red against the
  // fossil-serving code before trusting it green here.
  const line = "- 2026-08-26T21:58:23.712Z · wright · enters wright/the-trueing-house · ferry 151.4826 · word neutral";
  passageRow({ handle: "wright", lines: [line] });

  const served = (await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger;
  assert.ok(served.includes(line),
    "the door served a world in which this passage never happened — which is the whole defect");
});

test("END TO END — and the frozen era is still there beside it", async () => {
  const line = "- 2026-08-26T21:58:23.712Z · wright · enters wright/the-trueing-house · ferry 151.4826 · word neutral";
  passageRow({ handle: "wright", lines: [line] });
  const served = (await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger;
  assert.ok(served.includes(FROZEN_A) && served.includes(FROZEN_B),
    "deriving the live era must not cost the record its history");
  assert.deepEqual(acts(served), [FROZEN_A, FROZEN_B, line],
    "frozen first, live after, in seq order");
});

test("END TO END — several acts of one chain keep the pen's own order", async () => {
  const chain = [
    "- 2026-08-26T22:00:00.000Z · keith · enters keith/the-shard-house · ferry 151.5 · word neutral",
    "- 2026-08-26T22:00:00.000Z · keith · enters keith/the-garage · ferry 151.5 · word neutral",
  ];
  passageRow({ handle: "keith", lines: chain, seq: 1 });
  passageRow({ handle: "keith", lines: ["- 2026-08-26T22:05:00.000Z · keith · exits keith/the-garage · ferry 151.51"], act: "exit", seq: 2 });
  assert.deepEqual(acts((await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger).slice(2),
    [...chain, "- 2026-08-26T22:05:00.000Z · keith · exits keith/the-garage · ferry 151.51"],
    "a chain writes one row with several lines, and the exit that answers it comes after");
});

// ── THE REGENERATION ────────────────────────────────────────────────────────

test("REGENERATES WHOLE — delete the derived file, derive again, byte for byte", async () => {
  passageRow({ handle: "little-m-of-garrison", lines: ["- 2026-08-26T20:00:00.000Z · little-m-of-garrison · enters vermillion/pando-peak-library-shelf · ferry 151.2 · word neutral"] });

  const first = await emitEnterExitLedger(repo, await rows(), { paths: [LEDGER_NEW] });
  const onDisk = readFileSync(join(repo, LEDGER_NEW), "utf8");
  assert.equal(onDisk, first.text);

  unlinkSync(join(repo, LEDGER_NEW));
  assert.equal(existsSync(join(repo, LEDGER_NEW)), false, "gone, so the second derivation cannot be reading the first");

  const again = await emitEnterExitLedger(repo, await rows(), { paths: [LEDGER_NEW] });
  assert.equal(readFileSync(join(repo, LEDGER_NEW), "utf8"), onDisk,
    "byte for byte — a derived artifact that cannot be rebuilt from its sources is a stored one wearing a derivation's clothes");
  assert.equal(again.text, first.text);
});

test("REGENERATES WHOLE — and it is the same after the third and fourth run", async () => {
  passageRow({ handle: "sable", lines: ["- 2026-08-26T20:10:00.000Z · sable · exits fabel-of-garrison/the-riverside-arcade · ferry 151.21"] });
  const texts = [];
  for (const _ of [1, 2, 3, 4]) texts.push((await emitEnterExitLedger(repo, await rows(), { paths: [LEDGER_NEW] })).text);
  assert.equal(new Set(texts).size, 1, "idempotent: emitting twice must not double a line");
  assert.equal(acts(texts[0]).length, 3, "two frozen, one live — not two frozen and four live");
});

test("REGENERATES WHOLE — a file already holding these bytes is not rewritten", async () => {
  passageRow({ handle: "sable", lines: ["- 2026-08-26T20:10:00.000Z · sable · exits x/y · ferry 151.21"] });
  await emitEnterExitLedger(repo, await rows(), { paths: [LEDGER_NEW] });
  const second = await emitEnterExitLedger(repo, await rows(), { paths: [LEDGER_NEW] });
  assert.deepEqual(second.wrote.map((w) => w.written), [false],
    "a derivation that changed nothing must rewrite nothing");
});

// ── THE BACKFILL ────────────────────────────────────────────────────────────

test("THE BACKFILL — the gap heals on the first derivation, with nobody replaying anything", async () => {
  // The two-day gap, in miniature: the acts were in the log the whole time, so
  // the first run of the deriver is the backfill. Nothing replays, nothing is
  // re-signed, nothing is invented — the lines were already written.
  const gap = [
    "- 2026-08-25T01:00:00.000Z · keith · enters keith/the-garage · ferry 148.1 · word neutral",
    "- 2026-08-25T12:00:00.000Z · little-m-of-garrison · exits sol-of-garrison/the-protected-grove · ferry 149.2",
    "- 2026-08-26T02:00:00.000Z · darko · enters the-town/the-post-office · ferry 150.3 · word welcomed",
    "- 2026-08-26T21:58:23.712Z · wright · enters wright/the-trueing-house · ferry 151.4 · word neutral",
  ];
  gap.forEach((line, i) => passageRow({ handle: line.split(" · ")[1], lines: [line], seq: i + 1 }));

  const served = await servedEnterExitLedger(repo, { env: RECORD_ON });
  assert.deepEqual(acts(served.ledger), [FROZEN_A, FROZEN_B, ...gap]);
  assert.equal(served.derived.frozen_acts, 2);
  assert.equal(served.derived.journal_acts, 4);
});

// ── THE CONSENT WORD ────────────────────────────────────────────────────────

test("THE CONSENT WORD survives the derivation, verbatim, for all three answers", async () => {
  // "Presence is free, effect is consented: entry meets the ground's own law,
  //  silence welcomes, only the town's pen bars a leaving, refusals name
  //  horizons." — `the-town/consent-at-thresholds` v1.
  //
  // The ledger IS the consent law's receipts. The mark's answer is stamped on
  // the row as it stood at the passage, so a derivation that dropped or
  // normalized it would re-adjudicate history — and an `opposed` that came out
  // the other side as a bare entry would turn a refusal into an entry.
  const words = [
    "- 2026-08-26T20:00:00.000Z · a · enters the-town/the-post-office · ferry 151.1 · word welcomed",
    "- 2026-08-26T20:01:00.000Z · b · enters the-town/the-wheelhouse · ferry 151.11 · word neutral",
    "- 2026-08-26T20:02:00.000Z · c · enters the-town/the-vault · ferry 151.12 · word opposed",
  ];
  words.forEach((line, i) => passageRow({ handle: line.split(" · ")[1], lines: [line], seq: i + 1 }));

  const served = (await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger;
  for (const word of ["welcomed", "neutral", "opposed"])
    assert.ok(served.includes(` · word ${word}`), `the "${word}" answer did not survive the derivation`);
  assert.deepEqual(acts(served).slice(2), words, "verbatim — not re-formatted, not re-adjudicated");
});

test("THE CONSENT WORD — an exits row still carries none, because it needs nobody's answer", async () => {
  const exit = "- 2026-08-26T20:03:00.000Z · a · exits the-town/the-post-office · ferry 151.13";
  passageRow({ handle: "a", lines: [exit], act: "exit" });
  assert.ok((await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger.includes(exit));
  assert.ok(!(await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger.split("\n").some((l) => l.includes("exits") && l.includes("word")),
    "nullifying your own side of an edge you authored needs nobody's answer");
});

// ── THE FERRY FIELD ─────────────────────────────────────────────────────────

test("THE FERRY FIELD — both eras of the grammar survive side by side", async () => {
  // History is not editable: rows written before 2026-08-26 say `at <n>`, rows
  // written after say `ferry <n>`, and the derived record carries both exactly
  // as they were written. The parser that reads them lives in the world package
  // and accepts both; this only has to not touch them.
  const modern = "- 2026-08-26T20:04:00.000Z · a · enters the-town/the-post-office · ferry 151.14 · word neutral";
  passageRow({ handle: "a", lines: [modern] });
  const served = (await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger;
  assert.ok(served.includes(" · at 147.6377 · "), "the frozen era still says `at`");
  assert.ok(served.includes(" · ferry 151.14 · "), "the live era says `ferry`");
});

test("THE FERRY FIELD — the header comes from the CLONE, and names what the number is", { skip: GRAMMAR ? false : `no world clone at ${WORLD_CLONE_FOR_TEST}` }, async () => {
  // ONE HOME FOR THE SERIALIZATION. The header is the world package's, read out
  // of the clone exactly as the grammar is, so this office cannot drift a second
  // copy of it. A field whose meaning lives only in somebody's head is the thing
  // being fixed.
  const header = await ledgerHeaderFrom(WORLD_CLONE_FOR_TEST);
  assert.ok(header.includes("`ferry` is the FERRY's fractional crossing"),
    "the clone's header does not name the ferry field");
});

test("THE HEADER — a clone with no grammar module gets a NAMED absence, not an invention", async () => {
  const bare = join(scratch, `nogrammar-${n}`);
  mkdirSync(join(bare, "WORLD"), { recursive: true });
  const header = await ledgerHeaderFrom(bare);
  assert.match(header, /could not be read/, "absence is named, never filled");
  assert.ok(!header.includes("`ferry` is the FERRY's"), "and it does not invent the prose it could not read");
});

// ── THE GRACE WINDOW ────────────────────────────────────────────────────────

// ── THE TWO PENS, REMOVED (#2152) ───────────────────────────────────────────
//
// This block replaces "THE GRACE WINDOW — both paths get the same bytes", which
// asserted that the emitter wrote the twin alongside the new name. The twin is
// deleted from world main at the founder's word and the emitter has no
// production caller at all: the committed copy of the record is the frozen era
// by the world repo's own law, quoted verbatim from
// `tools/enter-exit-record.test.mjs` over there —
//
//     "the world repo has no journal to read — a longer derived file means a
//      hand wrote in it"
//
// — and every passage since the cutover is served by the DERIVATION, which the
// tests above cover. Two office pens went on appending live-era lines into that
// committed file anyway; each append turned the world's grammar suite red, cost
// the settlement sweep its isolation, and refused the whole crossing.

test("NO PEN — nothing in src/ or tools/ calls the writer any more", async () => {
  // THE SOURCE PIN, and it reads the bytes rather than the wiring, because the
  // wiring is what was wrong: `tools/crossing-save.mjs` imported this function
  // and called it on every save, twice a crossing, and nothing anywhere said
  // that it must not.
  const { readdirSync } = await import("node:fs");
  const root = join(import.meta.dirname, "..");
  const offenders = [];
  for (const dir of ["src", "tools"]) {
    for (const file of readdirSync(join(root, dir))) {
      if (!file.endsWith(".mjs")) continue;
      if (dir === "src" && file === "enter-exit-ledger.mjs") continue;   // the writer's own home
      const text = readFileSync(join(root, dir, file), "utf8");
      if (/\bemitEnterExitLedger\s*\(/.test(text)) offenders.push(`${dir}/${file}`);
    }
  }
  assert.deepEqual(offenders, [],
    `these pens write the passage record and must not: ${offenders.join(", ")} (#2152)`);
});

test("NO PEN — the source pin can fail, shown against the line that used to sit in crossing-save", () => {
  // THE CAN-FAIL FLIP. A scan that finds nothing proves nothing unless it can
  // recognise the call it was written to catch. This is the exact line removed
  // from `tools/crossing-save.mjs`.
  const removedLine = "  const ledgers = await emitEnterExitLedger(CLONE, readJournal(db));";
  assert.equal(/\bemitEnterExitLedger\s*\(/.test(removedLine), true,
    "the detector cannot see the call it exists to find");
});

test("NO DEFAULT DESTINATION — the writer refuses to guess where it writes", async () => {
  // The default used to be BOTH ledger paths, which is how the twin outlived
  // every decision to retire it: nobody had to name the file to keep writing it.
  // A writer that refuses is a writer whose destinations are all in the diff.
  await assert.rejects(async () => emitEnterExitLedger(repo, await rows()), /no default destination/);
  await assert.rejects(async () => emitEnterExitLedger(repo, await rows(), { paths: [] }), /no default destination/);
  assert.equal(existsSync(join(repo, LEDGER_NEW)), false, "and it wrote nothing on its way out");
});

test("THE GRACE WINDOW — a row that named the retired ledger is still read", async () => {
  // Rows written by an office that predates the rename name the old path. They
  // are the same record and they are not lost to a rename.
  const line = "- 2026-08-26T20:06:00.000Z · a · enters x/y · at 151.16 · word neutral";
  passageRow({ handle: "a", lines: [line], ledger: LEDGER_OLD });
  assert.ok((await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger.includes(line),
    "a rename that orphans a name-keyed reader is the exact defect this repo keeps paying for");
});

test("THE GRACE WINDOW — the retired door names its successor in its own answer", async () => {
  assert.equal(DEPRECATED_DOOR.deprecated, "/world/threshold-ledger");
  assert.equal(DEPRECATED_DOOR.use, "/world/enter-exit-ledger");
  assert.ok(DEPRECATED_DOOR.why.length > 40, "a deprecation with no reason is a deprecation nobody acts on");
});

test("THE GRACE WINDOW — a clone that has not taken the rename still derives", async () => {
  // The office ships on the train, the world package rides a blessing. In
  // between, the office is running against a clone whose only ledger is the
  // retired name. It must still serve the frozen era plus the journal.
  const old = join(scratch, `pre-rename-${n}`);
  mkdirSync(join(old, "WORLD"), { recursive: true });
  writeFileSync(join(old, LEDGER_OLD), `${FROZEN_HEADER}${FROZEN_A}\n${FROZEN_B}\n`);
  passageRow({ handle: "a", lines: ["- 2026-08-26T20:07:00.000Z · a · enters x/y · ferry 151.17 · word neutral"] });

  const served = await servedEnterExitLedger(old, { env: RECORD_ON });
  assert.equal(served.derived.frozen_acts, 2, "the retired ledger stood in for the frozen era");
  assert.equal(served.derived.journal_acts, 1);
  assert.equal(acts(served.ledger).length, 3);
});

test("THE FOLD WAITS — a clone without the frozen era gets NOTHING written into it", async () => {
  // THE SEQUENCING GATE. The office rides the train; the world commit that
  // splits the record into frozen + derived rides a blessing. In the window
  // between, a fold that wrote would MINT the new file on world main and rewrite
  // the old one's header — both of which the unmerged world commit also does.
  // Two pens on the same two paths is a merge conflict produced by a save nobody
  // was watching.
  const pre = join(scratch, `prerename-${n}`);
  mkdirSync(join(pre, "WORLD"), { recursive: true });
  writeFileSync(join(pre, LEDGER_OLD), `${FROZEN_HEADER}${FROZEN_A}
${FROZEN_B}
`);
  const before = readFileSync(join(pre, LEDGER_OLD), "utf8");
  passageRow({ handle: "a", lines: ["- 2026-08-26T20:20:00.000Z · a · enters x/y · ferry 151.2 · word neutral"] });

  const out = await emitEnterExitLedger(pre, await rows(), { paths: [LEDGER_NEW] });
  assert.deepEqual(out.wrote, [], "nothing may be written into a clone the world half has not reached");
  assert.match(out.held, /has not been blessed here yet/, "and holding must be SAID, not silent");
  assert.equal(existsSync(join(pre, LEDGER_NEW)), false, "the new name must not be minted beside the commit about to create it");
  assert.equal(readFileSync(join(pre, LEDGER_OLD), "utf8"), before, "and the old one is byte-untouched");
});

test("THE FOLD WAITS — but the DOOR does not, which is what heals prod", async () => {
  // The gate is safe rather than a deferral precisely because these are separate
  // readers. The viewer asks the office before it asks the staged file, so the
  // derived answer reaches a resident the moment this office deploys — with no
  // world commit, no blessing and no file written anywhere.
  const pre = join(scratch, `prerename-door-${n}`);
  mkdirSync(join(pre, "WORLD"), { recursive: true });
  writeFileSync(join(pre, LEDGER_OLD), `${FROZEN_HEADER}${FROZEN_A}
${FROZEN_B}
`);
  const line = "- 2026-08-26T20:21:00.000Z · a · enters x/y · ferry 151.21 · word neutral";
  passageRow({ handle: "a", lines: [line] });

  const served = await servedEnterExitLedger(pre, { env: RECORD_ON });
  assert.ok(served.ledger.includes(line), "the door must derive even where the fold holds");
  assert.equal(served.derived.journal_acts, 1);
});

test("THE GRACE WINDOW — the emitted retired file is never read back as the archive", async () => {
  // The shape that could have compounded: the deriver WRITES the retired path,
  // and `frozenLinesIn` will FALL BACK to that same path when there is no frozen
  // file. Journal lines absorbed into the archive, then appended again, growing
  // by one pass per save.
  //
  // Two things stop it, and both are asserted here rather than argued. The fold
  // does not run at all without the frozen file, so the fallback and the write
  // never coexist; and even where they did, the frozen half excludes any line
  // the journal already carries, so the output is identical every pass.
  const both = join(scratch, `absorb-${n}`);
  mkdirSync(join(both, "WORLD"), { recursive: true });
  writeFileSync(join(both, LEDGER_FROZEN), `${FROZEN_HEADER}${FROZEN_A}\n${FROZEN_B}\n`);
  writeFileSync(join(both, LEDGER_OLD), `${FROZEN_HEADER}${FROZEN_A}\n${FROZEN_B}\n`);
  passageRow({ handle: "a", lines: ["- 2026-08-26T20:08:00.000Z · a · enters x/y · ferry 151.18 · word neutral"] });

  const one = (await emitEnterExitLedger(both, await rows(), { paths: [LEDGER_NEW] })).text;
  const two = (await emitEnterExitLedger(both, await rows(), { paths: [LEDGER_NEW] })).text;
  const three = (await emitEnterExitLedger(both, await rows(), { paths: [LEDGER_NEW] })).text;
  assert.equal(one, two);
  assert.equal(two, three);
  assert.equal(acts(three).length, 3, "three acts after three runs, not three then four then five");

  // and the deriver's own frozen source stayed the frozen file, never its output
  assert.equal(frozenLinesIn(both).source, LEDGER_FROZEN);
});

// ── WHAT IS NOT THIS LEDGER'S ───────────────────────────────────────────────

test("a walk row is not a passage — the walk ledger's lines stay out", async () => {
  otherAct({
    action: "walk", actor: "rei",
    payload: { ledger: "WORLD/walk-ledger.md", lines: ["- 2026-08-26T20:09:00.000Z · rei · from 0,0 · toward 5,5 · at 151.3"] },
  });
  passageRow({ handle: "rei", lines: ["- 2026-08-26T20:10:00.000Z · rei · enters rei/the-lanternstep-house · ferry 151.31 · word neutral"], seq: 2 });
  const served = (await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger;
  assert.ok(!served.includes("toward 5,5"),
    "walking is not entering: a walk never appears here, and a passage never moves anyone");
  assert.equal(acts(served).length, 3);
});

test("a row carrying no lines contributes none", async () => {
  otherAct({ action: "enter", actor: "a", payload: { ledger: LEDGER_NEW } });
  assert.equal(acts((await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger).length, 2, "the frozen era, and nothing else");
});

test("an office pointed at no record at all still serves the frozen era rather than 500", async () => {
  const served = await servedEnterExitLedger(repo, { env: RECORD_OFF });
  assert.equal(acts(served.ledger).length, 2);
  assert.equal(served.derived.journal_acts, 0);
});

test("AN UNREADABLE RECORD IS NAMED — it must not come back looking like an empty one", async () => {
  // THE BUG'S OWN SHAPE, guarded against in the fix and carried through the
  // port unchanged. An unreachable record and an empty one derive the SAME
  // text: the record as of the cutover. One is the truth; the other is a fossil
  // served as though it were current, which is precisely what prod did for two
  // days with nothing anywhere saying so.
  //
  // Found by running the deriver against a copy of prod's own store: a
  // mis-resolved path made the read throw and the first draft answered 155 acts
  // with a straight face. The path is a pool now and the failure mode is the
  // same one, which is why this test outlived the source it was written for.
  __setPoolForTest({ async query() { throw new Error('relation "acts" does not exist'); } });
  const broken = await servedEnterExitLedger(repo, { env: RECORD_ON });
  assert.equal(broken.derived.incomplete, true, "a reading that could not reach the record must say so");
  assert.match(broken.derived.journal_unread, /FROZEN ERA ONLY/);
  assert.match(broken.derived.journal_unread, /acts/, "and it must name what it could not read, not merely that it failed");

  // and the true-empty case must NOT be labelled incomplete, or the label means
  // nothing and every reader learns to ignore it. A record that ANSWERS and
  // holds no passages is the real empty; a record that will not answer is
  // unreadable, and the two are different answers.
  __setPoolForTest(makePool(store));   // the record answers now, and holds nothing
  const empty = await servedEnterExitLedger(repo, { env: RECORD_ON });
  assert.equal(empty.derived.incomplete, undefined, "an empty record is a real answer, not a failure");
  assert.equal(empty.derived.journal_unread, undefined);
  assert.equal(empty.ledger, broken.ledger, "the two derive the same bytes — which is exactly why the sentence is the whole difference");
});

test("AN OFFICE POINTED AT NO RECORD says which absence it is, and it is not the other one", async () => {
  // Three absences, three sentences: not pointed at a record, pointed at one
  // that will not answer, pointed at one that is empty. `actsQuery` answers
  // `null` for the first and `[]` for the third, which is the distinction the
  // module's fail-soft is built on — "not asked" against "asked, and none".
  const off = await servedEnterExitLedger(repo, { env: RECORD_OFF });
  assert.equal(off.derived.incomplete, true);
  assert.match(off.derived.journal_unread, /WORLD2_PG/, "an office with no record configured must say THAT, not blame the store");

  __setPoolForTest({ async query() { throw new Error("connection refused"); } });
  const unreachable = await servedEnterExitLedger(repo, { env: RECORD_ON });
  assert.equal(unreachable.derived.incomplete, true);
  assert.ok(!unreachable.derived.journal_unread.includes("WORLD2_PG"),
    "a record that refused the connection is a different fact from an office that was never pointed at one");
  __setPoolForTest(makePool(store));
});

test("THE ORDER IS ASSERTED, NEVER ASSUMED — a record handing back scrambled rows is a NAMED absence", async () => {
  // The silent trap this guard exists for: an unordered read returns rows, in
  // an order, with no symptom a caller could see — and this record's whole
  // meaning is its sequence. A scrambled archive served with a straight face is
  // the two-day fossil wearing a different hat.
  passageRow({ handle: "a", lines: ["- 2026-08-26T20:30:00.000Z · a · enters x/y · ferry 151.3 · word neutral"], seq: 1 });
  passageRow({ handle: "b", lines: ["- 2026-08-26T20:31:00.000Z · b · enters x/z · ferry 151.31 · word neutral"], seq: 2 });
  const honest = makePool(store);
  __setPoolForTest({ async query(t, params) { const { rows } = await honest.query(t, params); return { rows: rows.reverse() }; } });

  const served = await servedEnterExitLedger(repo, { env: RECORD_ON });
  assert.equal(served.derived.incomplete, true, "a read that came back out of order must say so rather than serve it");
  assert.equal(acts(served.ledger).length, 2, "and it falls back to the frozen era rather than to a scrambled one");
  __setPoolForTest(makePool(store));
});

test("a clone with no ledger at all is an empty record, named as one", async () => {
  const bare = join(scratch, `bare-${n}`);
  mkdirSync(join(bare, "WORLD"), { recursive: true });
  const served = await servedEnterExitLedger(bare, { env: RECORD_ON });
  assert.equal(served.derived.frozen_acts, 0);
  assert.match(served.derived.from[0], /no frozen era/);
});

// ── THE PURE HALVES ─────────────────────────────────────────────────────────

test("journalLinesIn reads rows by the ledger they NAME, not by their class", async () => {
  const shaped = [
    { seq: 3, payload: { ledger: LEDGER_NEW, lines: ["- c"] } },
    { seq: 1, payload: { ledger: "WORLD/threshold-ledger.md", lines: ["- a"] } },
    { seq: 2, payload: { ledger: "WORLD\\enter-exit-ledger.md", lines: ["- b"] } },   // a windows path
    { seq: 4, payload: { ledger: "WORLD/walk-ledger.md", lines: ["- z"] } },
  ];
  assert.deepEqual(journalLinesIn(shaped), ["- a", "- b", "- c"], "seq order, and the walk ledger's is not ours");
});

test("deriveEnterExitLedger is a pure function of its two sources", async () => {
  const a = deriveEnterExitLedger({ frozen: ["- f1", "- f2"], journal: ["- j1"] });
  const b = deriveEnterExitLedger({ frozen: ["- f1", "- f2"], journal: ["- j1"] });
  assert.equal(a, b);
  assert.deepEqual(acts(a), ["- f1", "- f2", "- j1"]);
});

test("frozenLinesIn prefers the frozen file over the retired one", async () => {
  writeFileSync(join(repo, LEDGER_OLD), `${FROZEN_HEADER}- not the frozen era\n`);
  assert.equal(frozenLinesIn(repo).source, LEDGER_FROZEN);
  assert.deepEqual(frozenLinesIn(repo).lines, [FROZEN_A, FROZEN_B]);
});

test("enterExitLedgerText and the door's answer are the same bytes", async () => {
  passageRow({ handle: "a", lines: ["- 2026-08-26T20:12:00.000Z · a · enters x/y · ferry 151.19 · word neutral"] });
  assert.equal(await enterExitLedgerText(repo, await rows()), (await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger,
    "one deriver, or two doors answer the same question differently");
});


// ── END TO END THROUGH THE REAL PEN ─────────────────────────────────────────
//
// The layer above drives a row shaped like the pen's. This one runs the PEN, as
// its own process, exactly as the office runs it — so a change to crossing-exec
// that stopped naming this ledger fails here.
//
// ⚑ THE PEN'S ROW REACHES THE RECORD BY THE MIRROR'S OWN ROAD, and that is what
// makes this case STRONGER after the port rather than weaker. The pen runs in
// its own process, so a stub pool in this one cannot reach it; what this can do
// is take the journal row the pen actually wrote and carry its payload into the
// store exactly as `mirrorAct` does — `guarded.payload`, byte-unchanged. So it
// now asserts the whole chain the office runs: the pen formats the lines, the
// mirror carries the payload, the door derives from `acts`. A pen that stopped
// putting the ledger name or the lines in its payload reds here, at the hop.
//
// ⚑ AND IT KEEPS ITS OWN SQLITE FILE. The fixture's `dbPath` names a db that is
// never created; this is the one case in the file that needs a journal, because
// running the real pen is the point of it.
//
// Needs a world clone for the grammar module; says so instead of passing over
// an invented world.

const withPenDb = (path, fn) => { const db = openDynamic(path); try { return fn(db); } finally { db.close(); } };

test("END TO END through the real pen — crossing-exec writes, the mirror carries, the door serves", { skip: GRAMMAR ? false : `no world clone at ${WORLD_CLONE_FOR_TEST} — the grammar module travels with it` }, async () => {
  const clone = join(scratch, `pen-${n}`);
  mkdirSync(join(clone, "WORLD"), { recursive: true });
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, LEDGER_FROZEN), `${FROZEN_HEADER}${FROZEN_A}\n${FROZEN_B}\n`);
  cpSync(join(WORLD_CLONE_FOR_TEST, GRAMMAR), join(clone, GRAMMAR));

  const penDb = join(scratch, `pen-db-${n}.db`);
  const line = "- 2026-08-26T22:30:00.000Z · wright · enters wright/the-trueing-house · ferry 151.6 · word neutral";
  const out = execFileSync(process.execPath, [
    join(process.cwd(), "src", "crossing-exec.mjs"),
    JSON.stringify({ handle: "wright", act: "enter", at: 151.6, lines: [line], summary: "enters the trueing house" }),
  ], { encoding: "utf8", env: { ...process.env, WORLD_CLONE: clone, WORLD_DYNAMIC_DB: penDb, WORLD_SINGLE_LOG: "1" } });

  // ── AFTER G1 THE REAL PEN NEEDS A REAL RECORD (POS-156, RULING 3) ────────
  //
  // This used to assert the whole chain: the pen writes a journal row, the
  // mirror carries its payload into `acts`, the door derives from `acts`. The
  // middle hop is gone — the pen writes the record DIRECTLY now — and the pen
  // runs here as a SUBPROCESS, which the in-memory record
  // (`test/acts-pen-stub.mjs`) cannot reach. A store for it would mean a live
  // Postgres, which this suite does not have and must not require.
  //
  // So what is asserted end to end is the new truth, and it is worth asserting:
  // an office pointed at no record REFUSES the crossing and writes nothing
  // anywhere. The claim this test used to carry NAMES ITS NEW HOME rather than
  // being dropped — "the door derives the passage from the payload in `acts`"
  // is THE EQUALITY FALSIFIER below, which writes one payload into both records
  // and compares the bytes, then takes the sqlite side away.
  const answer = JSON.parse(out.trim().split("\n").at(-1));
  assert.equal(answer.error?.code, 503,
    "an office pointed at no record must REFUSE a crossing, not answer 200 over an act no store holds");
  assert.match(String(answer.error?.hint), /the office's record/,
    "and the refusal names the record as the thing that could not be reached");

  const written = withPenDb(penDb, (db) => readJournal(db));
  assert.deepEqual(written, [],
    "and NOTHING reached the sqlite journal either — G1 deleted that INSERT, so a refused crossing has no consolation copy");

  assert.equal(readFileSync(join(clone, LEDGER_FROZEN), "utf8"), `${FROZEN_HEADER}${FROZEN_A}\n${FROZEN_B}\n`,
    "the committed record is exactly as it was — a refusal leaves the world where it stood");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE EQUALITY FALSIFIER — the two records answer the same, then one is removed
// ═════════════════════════════════════════════════════════════════════════════
//
// POS-194's gate. The port is only safe if the store's rows derive the SAME
// BYTES the journal's did, so the fixture below is written into BOTH records
// from one payload and the two answers are compared — the old source through
// `enterExitLedgerText` (which still takes its rows as an argument, so it is
// the deriver with the journal still handed to it), the new source through the
// door. Then the sqlite side is TAKEN AWAY and the answer must not move.
//
// ⚑ THE FIXTURE CARRIES THE CHAINED ACT ON PURPOSE. `world-verbs.mjs § enter`
// pushes one formatted line per mark of a chain, so ONE act can hold several
// lines — and that is the measured reason this port reads `payload.lines`
// through `journalLinesIn` rather than folding through `live-reads § passageOf`,
// which reads `lines[0]` and would drop the rest of every chain. Take the chain
// out of this fixture and the equality would hold for the wrong reason.

/** One payload, written into both records, so a difference cannot be a typo. */
const EQUALITY_FIXTURE = [
  { handle: "sable", act: "enter", at: 151.40, ledger: LEDGER_NEW,
    lines: ["- 2026-09-22T10:00:00.000Z · sable · enters sol-of-garrison/the-protected-grove · ferry 151.4 · word welcomed"] },
  { handle: "keith", act: "enter", at: 151.41, ledger: LEDGER_NEW,
    lines: ["- 2026-09-22T10:01:00.000Z · keith · enters keith/the-shard-house · ferry 151.41 · word neutral",
            "- 2026-09-22T10:01:00.000Z · keith · enters keith/the-garage · ferry 151.41 · word neutral"] },
  { handle: "keith", act: "exit", at: 151.42, ledger: LEDGER_NEW,
    lines: ["- 2026-09-22T10:02:00.000Z · keith · exits keith/the-garage · ferry 151.42"] },
  { handle: "darko", act: "enter", at: 151.43, ledger: LEDGER_OLD,
    lines: ["- 2026-09-22T10:03:00.000Z · darko · enters the-town/the-vault · ferry 151.43 · word opposed"] },
];

const FIXTURE_LINES = EQUALITY_FIXTURE.flatMap((f) => f.lines);

/** Write the fixture into the sqlite journal AND the store, from one payload. */
function seedBothRecords(db) {
  EQUALITY_FIXTURE.forEach((f, i) => {
    const payload = { ledger: f.ledger, lines: f.lines, summary: `${f.act}s` };
    seedJournalRow(db, {
      crossing: f.at, actor: f.handle, action: f.act, object: "the-town/the-post-office",
      cls: CLASS_FRAME, at: null, witnesses: null, payload,
      effect: "the crossing is declared; the record receives it at the save",
      writtenAt: `2026-09-22T10:0${i}:00.000Z`,
    });
    store.acts.push({
      id: i + 1, at: `2026-09-22T10:0${i}:00.000Z`, crossing: String(f.at),
      actor: f.handle, action: f.act, object: "the-town/the-post-office",
      payload: structuredClone(payload),
    });
  });
}

test("E1 · THE EQUALITY — the journal's rows and the record's rows derive the same bytes", async () => {
  const eqDb = join(scratch, `equality-${n}.db`);
  const db = openDynamic(eqDb);
  try {
    seedBothRecords(db);
    const fromJournal = await enterExitLedgerText(repo, readJournal(db));
    const fromRecord = (await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger;

    // THE CONTROL EVERY IDENTITY CLAIM NEEDS: two empty answers are equal too.
    assert.equal(readJournal(db).length, EQUALITY_FIXTURE.length, "control: the journal holds the fixture");
    assert.equal(store.acts.length, EQUALITY_FIXTURE.length, "control: the record holds the fixture");
    assert.equal(acts(fromRecord).length, 2 + FIXTURE_LINES.length,
      "control: the answer holds the frozen era AND every line of the fixture, chain included");

    assert.equal(fromRecord, fromJournal,
      "the two records must derive one archive, byte for byte — otherwise the port moved the answer and not just the source");
  } finally { db.close(); }
});

test("E2 · THE REMOVAL — the sqlite side goes and the answer does not move", async () => {
  const eqDb = join(scratch, `equality-gone-${n}.db`);
  const db = openDynamic(eqDb);
  let before;
  try {
    seedBothRecords(db);
    before = (await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger;
    assert.equal(before, await enterExitLedgerText(repo, readJournal(db)), "control: the two agreed before the removal");
    db.exec("DROP TABLE journal");
    assert.throws(() => readJournal(db), /journal/i, "control: the sqlite side is genuinely gone, not merely empty");
  } finally { db.close(); }

  const after = (await servedEnterExitLedger(repo, { env: RECORD_ON })).ledger;
  assert.equal(after, before,
    "the answer moved when the journal went — the sqlite read is meant to be DELETED from this path, never fallen back to");
  assert.equal(acts(after).length, 2 + FIXTURE_LINES.length);
  for (const line of FIXTURE_LINES)
    assert.ok(after.includes(line), `the journal's absence cost the archive a line: ${line}`);
});

test("E3 · THE FROZEN ERA IS UNCHANGED by any of it", async () => {
  const eqDb = join(scratch, `equality-frozen-${n}.db`);
  const db = openDynamic(eqDb);
  try { seedBothRecords(db); } finally { db.close(); }
  const served = await servedEnterExitLedger(repo, { env: RECORD_ON });
  assert.equal(served.derived.frozen_acts, 2);
  assert.deepEqual(acts(served.ledger).slice(0, 2), [FROZEN_A, FROZEN_B],
    "the archive's own two lines, in their own place, ahead of every live one");
  assert.equal(readFileSync(join(repo, LEDGER_FROZEN), "utf8"), `${FROZEN_HEADER}${FROZEN_A}\n${FROZEN_B}\n`,
    "and the file they come out of is byte-untouched");
});

test("E4 · THE FOUNDING ERA IN `acts` NEVER DOUBLES THE ARCHIVE", async () => {
  // `ledger-backfill.mjs` put the 155 frozen crossings into `acts` as
  // `legacy:enter` / `legacy:exit` carrying `payload._ledger`. They are the SAME
  // passages `frozenLinesIn` reads out of the clone's file — so a read that
  // returned them would hand the deriver the founding era twice, and the live
  // set wins its POSITION, which would silently migrate 155 crossings out of the
  // archive's own order and into the live era's tail.
  store.acts.push({
    id: 1, at: "2026-08-24T19:39:13.114Z", crossing: "147.6377", actor: "sable",
    action: "legacy:enter", object: "sol-of-garrison/the-protected-grove",
    payload: { _ledger: LEDGER_FROZEN, line: FROZEN_A, act: "enters", mark: "sol-of-garrison/the-protected-grove", handle: "sable", at: 147.6377 },
  });
  const live = "- 2026-09-22T11:00:00.000Z · a · enters x/y · ferry 151.5 · word neutral";
  passageRow({ handle: "a", lines: [live], seq: 2 });

  const served = await servedEnterExitLedger(repo, { env: RECORD_ON });
  assert.equal(served.derived.journal_acts, 1, "the founding era is not the live era");
  assert.deepEqual(acts(served.ledger), [FROZEN_A, FROZEN_B, live],
    "two frozen in their own order, then the live one — never the frozen line a second time at the end");
});

// ── THE SOURCE PINS (the weaker kind, and labelled as such) ─────────────────

test("S1 · the sqlite read is DELETED from this module, not layered under a fallback", async () => {
  // Weaker than E1/E2, which prove the chain. This says the old road is gone
  // rather than merely unused — "one question, one owner", and a fallback under
  // the store read would be the office keeping two answers again.
  const source = readFileSync(new URL("../src/enter-exit-ledger.mjs", import.meta.url), "utf8");
  const code = source.split("\n").filter((l) => !/^\s*(\*|\/\/)/.test(l)).join("\n");
  for (const forbidden of ["readJournal", "openDynamic", "dynamic-store", "world-journal"])
    assert.ok(!code.includes(forbidden),
      `${forbidden} still reaches the passage read from src/enter-exit-ledger.mjs`);
});

test("S1b · the source pin can fail, shown against the line the port removed", () => {
  // THE CAN-FAIL FLIP. A scan that finds nothing proves nothing unless it can
  // recognise the call it was written to catch. This is the exact line deleted
  // from `liveJournalRows`.
  const removedLine = "    return { rows: readJournal(db), unread: null };";
  const code = [removedLine].filter((l) => !/^\s*(\*|\/\/)/.test(l)).join("\n");
  assert.equal(code.includes("readJournal"), true, "the detector cannot see the call it exists to find");
});

test("S2 · the port takes NO FLAG — one right answer, and no switch to it", async () => {
  const source = readFileSync(new URL("../src/enter-exit-ledger.mjs", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function livePassageRows"));
  for (const flag of ["WORLD_SINGLE_LOG", "W2_GUARDS", "W2_PEN"])
    assert.ok(!body.includes(flag),
      `${flag} decides this read — a switch here is the office keeping two answers to one question`);
});
