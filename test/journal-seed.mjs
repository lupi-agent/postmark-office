// journal-seed.mjs — put rows in the sqlite `journal` table, for the suites
// whose SUBJECT is a reader of it.
//
// NOT A TEST FILE. The suite glob is `test/*.test.mjs`, so this is a helper and
// not a roster entry.
//
// ── WHY THIS EXISTS, AND WHY IT IS NOT SCAFFOLDING (G1 / POS-156) ───────────
//
// G1 deleted the general journal INSERT. `appendJournal` writes the RECORD now,
// so a suite that built its population by calling it no longer puts anything in
// this table — and two things still READ it:
//
//   · `src/world-drain.mjs` — the drain and its photograph. Its retirement is
//     G2's, and `world2-acts.mjs` schedules it there in its own words ("its
//     replacement exists (state-log-from-store.mjs); the retirement is G2's").
//     Until then it is live code with live behaviour and it is owed tests.
//   · `src/arena.mjs` — the fold, over the rows `appendArenaRow` still writes.
//     Exempt by ruling (DEC-1/P-143).
//
// ⚑ THIS IS A SEEDER, NOT A PEN, AND THE DIFFERENCE IS THE POINT. A test-only
// writer into a table the office no longer writes would be scaffolding that
// READS AS COVERAGE — a suite green over a path nothing exercises. So this
// helper says what it is at the top of every file that imports it: the rows are
// PUT THERE, by the test, because the test is about the reader. Nothing here
// claims a door wrote them, and no suite may use this to assert that one did.
//
// ⚑ THE ROW SHAPE IS `normalizeRow`'S, imported rather than restated. The whole
// reason the office has one normalizer is that a second spelling of a row
// drifts field by field until two eras disagree in a way that still parses
// (`world-journal.mjs § normalizeRow`). A fixture with its own shape would
// prove the drain reads a row nobody writes.
//
// For the arena's own rows, use `appendArenaRow` instead — that IS the live pen
// for that class, and a suite about the arena should exercise it.

import { normalizeRow } from "../src/world-journal.mjs";

const ROW_COLUMNS = "crossing, actor, action, object, at_anchor, at_dx, at_dy, witnesses, class, payload, effect, household, written_at";

/**
 * One row into `journal`, in the office's own row shape. Returns `{ seq, ...row }`
 * — the same answer the deleted INSERT gave, because the readers under test
 * take the seq as their cursor.
 */
export function seedJournalRow(db, entry = {}) {
  const row = normalizeRow(entry);
  const res = db.prepare(
    `INSERT INTO journal (${ROW_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.crossing, row.actor, row.action, row.object,
    row.at_anchor, row.at_dx, row.at_dy,
    row.witnesses, row.class, row.payload, row.effect,
    row.household, row.written_at);
  return { seq: Number(res.lastInsertRowid), ...row };
}
