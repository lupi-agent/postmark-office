// enter-exit-ledger.mjs — THE ENTER/EXIT LEDGER, DERIVED. One pen, one question.
//
// ── WHAT WENT WRONG, AND IT WAS SILENT FOR TWO DAYS ─────────────────────────
//
// On 2026-08-24 at 19:39:13Z the enter/exit pair stopped spending a git commit
// per act. Under WORLD_SINGLE_LOG the act writes a journal row instead, and the
// row carries its formatted ledger lines verbatim under `payload.lines`. That
// half shipped and works: the record of every crossing since has been kept.
//
// Nothing ever gave those lines to a reader. Both occupancy readers — the
// office's own door and the viewer through it — read the ledger FILE, and the
// file stopped growing at that exact instant. Measured 2026-08-26 on prod:
// `/api/world/dynamic` answered `journal: 39, journal_drained_through: null`,
// so thirty-nine acts sat in the log undrained while the file, prod, and the
// office door all still served the same last line — sable entering
// fabel-of-garrison/the-riverside-arcade at 147.6377, two days stale.
//
// Every enter in between succeeded, was recorded, and showed NOWHERE. A door
// that takes an act, keeps it, and then shows the caller a world in which it
// never happened is worse than a door that refuses: a refusal can be read.
//
// The law this violates is the enter class's own, `the-town/enter` v4,
// constitution tier, quoted verbatim:
//
//     "An entry is one passage written — who crossed, into what, at a
//      threshold you truly stand before; exit writes the next, to the
//      effective parent."
//
// WRITTEN. A passage that is written and cannot be read back is not written.
//
// ── THE SHAPE OF THE FIX ────────────────────────────────────────────────────
//
// The ledger stops being a file anybody appends to and becomes a DERIVED
// artifact, regenerated whole from its two sources every time it is asked for:
//
//   the frozen era   WORLD/enter-exit-ledger-frozen.md — every crossing made
//                    before the cutover, when each act took its own commit.
//                    Frozen with honor, exactly as the walk ledger was on
//                    2026-08-10 when movement moved into the store. Never
//                    appended to again, so it is a fixed input rather than an
//                    accumulating output.
//   the live era     the record's enter/exit acts, in the record's own order,
//                    carrying `payload.lines` verbatim — the exact text the
//                    acting pen formatted. It was the sqlite journal's rows
//                    until POS-194; it is `acts` now, read through the same
//                    row set and order `/world2/occupancy` folds. There is no
//                    sqlite left under this module.
//
//   derived = header + frozen lines + journal lines not already among them
//
// Full regeneration is the point, not append. It is the pattern the founder
// already ruled for `WORLD/containment.json`: thrown away and rebuilt at every
// fold, which is what keeps a derived thing from rotting the way a stored one
// does. It also BACKFILLS by construction — the first time this runs it emits
// every act since the cutover, because they were all still in the log.
//
// NO PEN AT ALL, since #2152 (2026-08-28). This module derives; nothing in this
// office writes the enter/exit files into the world clone any more.
//
// The paragraph above used to say ONE PEN, and it was wrong twice over. Two
// pens were writing: the crossing-save's emit (which ran twice a crossing) and
// `materializeLedgers` in world-drain.mjs (the older append-shaped answer, which
// the note here assumed was safely unwired). Both appended LIVE-ERA passages
// into a file the world repo's law says must equal the frozen era exactly —
// "the world repo has no journal to read — a longer derived file means a hand
// wrote in it" — which turned the world's grammar suite red during passage
// activity, cost the settlement sweep its ability to attribute a failure, and
// refused the whole crossing. Three hand-repairs on world main.
//
// The count that mattered was never one pen versus two. It was that the record
// has a DERIVER and therefore needs no pen: the committed copy is the frozen
// era, the live era is derived at read time, and a file written by anybody is a
// second answer to a question that already has one.
//
// ── THE GRACE WINDOW, AND WHY BOTH NAMES ────────────────────────────────────
//
// "threshold" is retired here: the word is doing four unrelated jobs in this
// town (the ferry's crossing, a water crossing, the inter-town `crossing`
// class, and this act), and `the-threshold` is separately the name of a
// boundary LAW that has nothing to do with walking through a door. The file,
// the door and the viewer's reader all take the enter/exit name.
//
// But the office, the world package and the site's viewer bundle deploy on
// three separate clocks, and a rename that orphans a name-keyed reader is the
// exact defect that had this town walking four times too slow for four days. So
// for a grace window the record answered to both names and the door answered
// under both.
//
// THE TWIN FILE IS GONE (2026-08-28, at the founder's word: "truly useless").
// `WORLD/threshold-ledger.md` is deleted from world main; one committed file
// remains. What survives here is only the READING half, and each piece has its
// own reason:
//
//   LEDGER_OLD in LEDGER_NAMES — journal rows written before the rename name
//     the old path in `payload.ledger`. Dropping it would drop their lines out
//     of the derivation, which is the rename-orphans-a-reader defect again.
//   LEDGER_OLD in `frozenLinesIn`'s fallback — for a clone that predates the
//     split. It cannot fire against a world checkout that has the frozen file.
//   `DEPRECATED_DOOR` and the `/world/threshold-ledger` route — the office's
//     API contract, still asked for by viewer bundles built before the rename.
//     It answers the same derived bytes and names its successor.
//
// None of those writes anything. The deleted file was the only half that could.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { actsQuery } from "./world2-acts.mjs";

/** The derived record, under its own name. */
export const LEDGER_NEW = "WORLD/enter-exit-ledger.md";

/** The retired name. READ-ONLY since 2026-08-28 — the file is deleted from world
 *  main; this constant survives because journal rows written before the rename
 *  still name it, and the door still answers under it. */
export const LEDGER_OLD = "WORLD/threshold-ledger.md";

/** The pre-cutover era, frozen. A fixed input; never written by this module. */
export const LEDGER_FROZEN = "WORLD/enter-exit-ledger-frozen.md";

/** Every name a journal row may claim its lines belong to. A row written before
 *  the rename names the old path; a row written after names the new one. Both
 *  are the same record, so both are read. */
export const LEDGER_NAMES = Object.freeze([LEDGER_NEW, LEDGER_OLD, LEDGER_FROZEN]);

export const DEPRECATED_DOOR = {
  deprecated: "/world/threshold-ledger",
  use: "/world/enter-exit-ledger",
  why: "\"threshold\" named four unrelated things in this town; \"crossing\" is the ferry's clock. A door and a pair of walking-through-a-door verbs get their own word. This path answers the same bytes until the rename is blessed everywhere, then it goes.",
};

/**
 * THE HEADER LIVES IN THE CLONE, and this is why there is no copy of it here.
 *
 * The world package owns the enter/exit grammar — the row shape, the parser,
 * the formatter — and the office reads all of it out of its clone rather than
 * keeping a second copy, because "the enforcer and the record must agree, and
 * the clone owns both" (world-crossings.mjs). The derived ledger's header is
 * part of that serialization: it names the grammar, the frozen era's path and
 * the grace window. A copy here would be a second home for one text, which is
 * the drift this seam exists to prevent.
 *
 * So it is imported from `tools/enter-exit.mjs` in the clone, falling back to
 * the retired `tools/thresholds.mjs` for the window in which this office is
 * running against a world package that has not taken the rename.
 *
 * ABSENCE IS NAMED, NEVER FILLED. A clone with no grammar module at all does
 * not get an invented header: it gets a header that SAYS the grammar could not
 * be read, so a reader can tell "this town has no entry law here" from "this
 * town's entry law says nothing". The acts below it are still true and still
 * parse; only the prose about them is missing.
 */
const HEADER_ABSENT = `# Enter/exit ledger — the passages

DERIVED. The grammar module could not be read from this office's world clone
(tools/enter-exit.mjs, or the retired tools/thresholds.mjs), so the prose that
normally describes this record is ABSENT rather than invented. The lines below
are the record and are unaffected.
`;

let _header = null;
export async function ledgerHeaderFrom(worldClone) {
  for (const rel of ["enter-exit.mjs", "thresholds.mjs"]) {
    const path = join(worldClone, "tools", rel);
    if (!existsSync(path)) continue;
    try {
      const mod = await import(pathToFileURL(path));
      if (typeof mod.LEDGER_HEADER === "string" && mod.LEDGER_HEADER) return mod.LEDGER_HEADER;
    } catch { /* try the next one */ }
  }
  return HEADER_ABSENT;
}

/** An act line, as either era of the grammar writes one. Loose on purpose: this
 *  module decides WHICH lines belong, never what they mean — the world package's
 *  parser owns the grammar, and a line this does not understand must survive
 *  into the derived file so that parser can say so out loud. */
const isActLine = (line) => line.startsWith("- ");

const actLinesOf = (text) =>
  String(text ?? "").replace(/\r\n/g, "\n").split("\n").filter(isActLine);

/**
 * THE FROZEN ERA'S LINES.
 *
 * Prefers the frozen file. Falls back to the retired ledger for the window in
 * which this office is running against a world clone that has not yet taken the
 * rename — the office ships on the train and the world rides a blessing, so
 * that window is real and lasts days, not seconds.
 *
 * The fallback is safe against reading this module's OWN OUTPUT back as an
 * input: journal lines are excluded from the archive below, so absorbing them
 * into the fallback source changes nothing about what comes out. The derived
 * text is the same whether or not the previous run's copy is standing there.
 */
export function frozenLinesIn(repo) {
  for (const name of [LEDGER_FROZEN, LEDGER_OLD]) {
    const path = join(repo, name);
    if (!existsSync(path)) continue;
    return { source: name, lines: actLinesOf(readFileSync(path, "utf8")) };
  }
  return { source: null, lines: [] };
}

/**
 * THE LIVE ERA'S LINES — verbatim, in the record's own order.
 *
 * ONE SERIALIZER FOR BOTH PENS, and after POS-194 for both STORES. It reads the
 * row shape `appendJournal` built, which is the shape `insertAct` and
 * `mirrorAct` copy into `acts` unchanged — so moving the source changed which
 * table the rows came out of and nothing at all about the text derived from
 * them. The name keeps the journal's because the SHAPE is the journal's.
 *
 * `payload.lines` is the exact text the acting pen formatted. Carrying it
 * rather than re-deriving it is what makes "the derived record holds the same
 * lines the per-act commits would have" true by construction instead of by two
 * formatters agreeing with each other.
 *
 * Rows are recognized by the ledger they NAME, not by their class or action, so
 * a future act that owes this ledger a line is picked up without this file
 * learning its name.
 */
export function journalLinesIn(rows) {
  const out = [];
  for (const row of rows ?? []) {
    const ledger = String(row?.payload?.ledger ?? "").replace(/\\/g, "/");
    if (!LEDGER_NAMES.includes(ledger)) continue;
    const lines = row?.payload?.lines;
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      const text = String(line);
      if (isActLine(text)) out.push({ seq: Number(row.seq ?? 0), line: text });
    }
  }
  out.sort((a, b) => a.seq - b.seq);
  return out.map((e) => e.line);
}

/**
 * THE DERIVATION. Header, then the frozen era, then the live era.
 *
 * Deduplicated with the LIVE era winning its position: a line that is in both
 * (the transitional case where a previous run's output was read back as the
 * archive) appears once, where the journal puts it. Deterministic over
 * (frozen file, journal rows) and over nothing else.
 */
export function deriveEnterExitLedger({ header, frozen = [], journal = [] } = {}) {
  const live = new Set(journal);
  const body = [...frozen.filter((line) => !live.has(line)), ...dedupe(journal)];
  return `${header ?? HEADER_ABSENT}\n${body.join("\n")}${body.length ? "\n" : ""}`;
}

const dedupe = (lines) => {
  const seen = new Set();
  return lines.filter((line) => (seen.has(line) ? false : (seen.add(line), true)));
};

/** The whole read, from a repo and the journal's rows. Async because the header
 *  is the clone's, not this file's — see `ledgerHeaderFrom`. */
export async function enterExitLedgerText(repo, rows) {
  return deriveEnterExitLedger({
    header: await ledgerHeaderFrom(repo),
    frozen: frozenLinesIn(repo).lines,
    journal: journalLinesIn(rows),
  });
}

/**
 * THE ONE I/O SEAM over the record, so the door and the save read the same rows
 * by the same route.
 *
 * ── IT READS `acts`, NOT THE JOURNAL (POS-194, G1 gate 1 of 3) ─────────────
 *
 * This was the LAST live-era reader of the sqlite journal's enter/exit rows, and
 * it is the reason G1 could not land: `src/world2-acts.mjs` said so in its own
 * words — "deleting this row's mirror today still costs the town its occupancy.
 * The row stays; POS-156 is where it goes." It has gone here. There is no
 * sqlite open left under this function and no flag over it; a switch would be
 * the office keeping two answers to one question.
 *
 * ⚑ THE ROW SET AND THE ORDER ARE THE OCCUPANCY DOOR'S OWN, imported from
 * `live-reads.mjs` rather than spelled again here. `/world2/occupancy` reads
 * `PASSAGE_ACTIONS` in `PASSAGE_ORDER_SQL` order, and two readers of one record
 * asking two different questions is how the town learns to trust neither.
 *
 * ⚑ THE FOUNDING ERA IS EXCLUDED — `payload->>'_ledger' IS NULL`, the clause
 * `storeDepartureRows` carries for the same reason. `PASSAGE_ACTIONS` matches
 * the 155 backfilled crossings of the frozen ledger too, and the frozen era
 * ALREADY reaches this derivation by another road: `frozenLinesIn` reads it out
 * of the clone's own file. Returning those rows here would hand `deriveEnter-
 * ExitLedger` the founding era twice — and the de-dupe could not save it,
 * because the live set wins its POSITION, so 155 crossings would silently
 * migrate out of their place in the archive and into the live era's tail.
 *
 * ⚑ ONE SERIALIZER, AND IT IS `journalLinesIn`. The lines are carried VERBATIM
 * in `payload.lines`, exactly as the pen formatted them, and both pens put that
 * payload in `acts` unchanged (`insertAct`, `mirrorAct`). So the port moves the
 * row SOURCE and nothing else: the text below this line is derived by the same
 * function, from the same field, as it was on the journal.
 *
 * ⚑ WHY NOT `passageRecords`, WHICH IS THE FOLD ITSELF — measured, and it is a
 * STOP rather than a preference. `passageOf` reads `lines[0]`, ONE line per
 * act; a chained enter writes one act carrying one line per mark crossed
 * (`world-verbs.mjs § enter` pushes a `formatEnterExit` per link) and this
 * suite pins that all of them reach the served record. The fold also REFUSES a
 * line that does not match its vendored grammar, where this record's law is the
 * opposite — "a line this does not understand must survive into the derived
 * file so that parser can say so out loud". The fold is right for occupancy and
 * wrong for the archive, and asking it for the archive would lose lines nobody
 * would ever look for.
 *
 * Feature-detected and fail-soft, both deliberately, and unchanged by the port.
 * An office pointed at no record must still serve the frozen era rather than
 * 500, and `actsQuery` answers `null` for exactly that — "not asked" against
 * "asked, and the answer is none".
 *
 * ABSENCE IS NAMED, NEVER FILLED — and this is the one place in this module
 * where getting that wrong would rebuild the very bug it exists to remove. An
 * unreachable record and an empty one produce the SAME derived text: the record
 * as of the cutover. One of those is the truth and the other is a two-day-stale
 * fossil served as though it were current, which is exactly what prod did from
 * 2026-08-24 to 2026-08-26 with nothing anywhere saying so.
 *
 * So a failure comes back as a SENTENCE beside the rows rather than as an empty
 * array. The caller still gets a usable answer; it simply cannot mistake "nobody
 * has crossed a door since the cutover" for "I could not read the log".
 *
 * (Caught by running this against a copy of prod's own store, 2026-08-26: a
 * mis-resolved path made the read throw, and the draft answered 155 acts with a
 * straight face.)
 *
 * ⚑ RENAMED from `liveJournalRows`, which named a source it no longer has. No
 * caller outside this module and its suite ever held the old name.
 */
// ── READ ONCE PER PASSAGE, NOT ONCE PER CALL (POS-272) ──────────────────────
//
// Every say pays this read: `residentStandpoint`'s aboard-by-occupancy branch
// folds occupancy out of the served ledger, and the crossing doors ask again.
// The rows change only when a passage lands, so the read is kept under the
// passage set's HIGH-WATER MARK — `max(id)` and `count(*)` over exactly the
// rows the read returns — and re-read when either moves.
//
// THE COUNT IS THE EXACT HALF. `acts` is append-only (the `acts_append_only`
// trigger refuses UPDATE and DELETE), so the row set changes only by growing
// and the count moves with every change. `max(id)` alone would miss a passage
// whose identity was drawn before a later one but committed after it: the
// later id is already the maximum when the earlier row appears.
//
// Scoped to the passage rows, not to every act: keyed on the whole table, each
// say (the commonest act by far) would throw the memo away.
//
// A mark that cannot be read is no memo, never a stale answer: the full read
// runs as before, and its own failure is still named below.
let _passages = null;   // { mark, rows }

/** Forget the kept passages — for suites that swap the record under the office. */
export function __forgetPassages() { _passages = null; }

async function passageMark(live, env) {
  const got = await actsQuery(
    `SELECT max(id) AS hw, count(*) AS n FROM acts
      WHERE action = ANY($1) AND payload->>'_ledger' IS NULL`,
    [live.PASSAGE_ACTIONS], env);
  const r = got?.[0];
  if (!r || r.n == null) return null;
  return `${env.WORLD2_PG_URL}|${r.hw ?? "none"}|${r.n}`;
}

export async function livePassageRows({ env = process.env } = {}) {
  try {
    const live = await import("../world2/tools/live-reads.mjs");
    let mark = null;
    try { mark = await passageMark(live, env); } catch { mark = null; }
    if (mark && _passages?.mark === mark) return { rows: _passages.rows, unread: null };
    const rows = await actsQuery(
      `SELECT id, at, crossing, actor, action, payload FROM acts
        WHERE action = ANY($1) AND payload->>'_ledger' IS NULL ${live.PASSAGE_ORDER_SQL}`,
      [live.PASSAGE_ACTIONS], env);
    if (rows == null)
      return { rows: [], unread: "this office is pointed at no record (WORLD2_PG) — the passages live in `acts`, so nothing since the FROZEN ERA ONLY could be read" };
    // ASSERTED, NEVER ASSUMED — the trap is silent: an unordered read returns
    // rows, in an order, with no symptom a caller could see, and this record's
    // whole meaning is its sequence. Driven by the clause's OWN keys, so it can
    // only ever assert the order the query actually asked for.
    live.assertDepartureOrder(rows, live.PASSAGE_ORDER_KEYS);
    // The row shape `journalLinesIn` reads, and `acts.id` standing in for `seq`.
    // They are the same ORDER and never the same number: the mirror inserts in
    // journal order and the flipped pen writes `acts` first, so id ascends with
    // seq under both pens — while `journal_seq` is NULL on every flipped row and
    // would sort the live era's newest crossings to the front of it.
    const out = rows.map((r) => ({ seq: Number(r.id), payload: r.payload }));
    // Kept under the mark read BEFORE the rows: a passage landing between the
    // two reads is in these rows and moves the next mark, so the next call
    // reads again rather than keeping an answer older than its key.
    _passages = mark ? { mark, rows: out } : null;
    return { rows: out, unread: null };
  } catch (e) {
    return { rows: [], unread: `the passage record could not be read (${String(e?.message ?? e).slice(0, 160)}) — everything below is the FROZEN ERA ONLY, and any passage made since is missing from this answer rather than absent from the town` };
  }
}

/**
 * THE DOOR'S ANSWER — the derived text plus the sentence saying where it came
 * from. Both ledger routes hand back this same object, because two doors
 * answering the same question with two shapes is how a caller learns to trust
 * one of them.
 */
export async function servedEnterExitLedger(repo, { env = process.env } = {}) {
  const frozen = frozenLinesIn(repo);
  const { rows, unread } = await livePassageRows({ env });
  const live = journalLinesIn(rows);
  const ledger = deriveEnterExitLedger({ header: await ledgerHeaderFrom(repo), frozen: frozen.lines, journal: live });
  return {
    ledger,
    bytes: ledger.length,
    acts: ledger.split("\n").filter(isActLine).length,
    derived: {
      from: [frozen.source ?? "(no frozen era in this clone)", "the record's enter/exit acts (`acts`)"],
      frozen_acts: frozen.lines.length,
      // `journal_acts` AND `journal_unread` KEEP THEIR NAMES, though the source
      // moved to `acts` (POS-194). They are the door's API, and
      // `world2/tools/ab-compare.mjs` reads `derived.journal_acts` with a `?? 0`
      // that would answer a confident zero to a rename — the orphaned
      // name-keyed reader this module's own header is a museum of. The count
      // means what it always meant: the live era's acts, whoever holds them.
      journal_acts: live.length,
      // Present ONLY when there is one, so a caller can neither miss it nor have
      // to infer it from a count that reads plausibly either way. An unreadable
      // journal and an empty one derive the SAME text — the record as of the
      // cutover — and one of those is the truth while the other is the fossil
      // being served as though it were current. That is the whole bug.
      ...(unread ? { journal_unread: unread, incomplete: true } : {}),
    },
    source: "derived live — the frozen era from the office's own world clone, the passages since from the record's `acts`",
  };
}

/**
 * EMIT. The derived text to the paths the caller NAMES.
 *
 * ── NOTHING IN THIS OFFICE CALLS THIS ANY MORE (#2152) ──────────────────────
 *
 * It used to default to writing both ledger paths, and the crossing-save called
 * it on every save. That was one of the two pens that baked live-era passages
 * into a committed file the world repo's own law says must equal the frozen era
 * exactly, quoted verbatim from `tools/enter-exit-record.test.mjs` over there:
 *
 *     "the world repo has no journal to read — a longer derived file means a
 *      hand wrote in it"
 *
 * Each append turned the world's grammar suite red, which cost the settlement
 * sweep its isolation and refused the whole crossing. Three hand-repairs on
 * world main before the pens were named. So: the crossing-save's call is gone,
 * the drain filters these ledgers out explicitly, and
 * `test/enter-exit-ledger.test.mjs` pins that no pen in `src/` or `tools/`
 * reaches this function again.
 *
 * `paths` IS REQUIRED, and that is the point of the change rather than
 * tidiness. A writer with a default destination is a writer somebody wires up
 * without deciding where it writes — which is exactly how the default that
 * included the now-deleted `WORLD/threshold-ledger.md` outlived the twin it
 * wrote to. What remains is a derivation-and-write the falsifiers drive
 * directly, where every call says on its own line what file it is making.
 *
 * ── THE FOLD WAITS FOR THE RECORD'S NEW SHAPE ──────────────────────────────
 *
 * It writes NOTHING until the frozen era exists as its own file: a repo holding
 * only the single pre-rename file is not a repo this derivation can write into
 * without minting a record beside the commit that is about to create it.
 *
 * NOTHING IS LOST BY NOT WRITING. The DOOR derives on every read — the frozen
 * era from the clone, the live era from the journal — so the town reads a
 * complete record whether or not any file was ever emitted. That was true
 * before this function was unwired and it is why unwiring it was safe.
 */
export async function emitEnterExitLedger(repo, rows, { paths } = {}) {
  if (!Array.isArray(paths) || !paths.length)
    throw new TypeError("emitEnterExitLedger writes only where it is told: pass { paths: [...] } (#2152 — this writer has no default destination)");
  if (!existsSync(join(repo, LEDGER_FROZEN)))
    return {
      text: null, wrote: [], acts: 0,
      held: `this clone has no ${LEDGER_FROZEN} — the world half of the rename has not been blessed here yet, so the fold writes nothing rather than minting a record beside the commit that is about to create it. The door still derives; nothing is lost, and the first save after the blessing carries every line.`,
    };
  const text = await enterExitLedgerText(repo, rows);
  const wrote = [];
  for (const name of paths) {
    const path = join(repo, name);
    const prev = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (prev === text) { wrote.push({ ledger: name, written: false, unchanged: true }); continue; }
    writeFileSync(path, text, "utf8");
    wrote.push({ ledger: name, written: true, bytes: text.length });
  }
  return { text, wrote, acts: text.split("\n").filter(isActLine).length, held: null };
}
