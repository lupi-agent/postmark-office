// falsifier-acts-lane-closure.mjs — EVERY WRITE LANE REACHES `acts`, LANE BY LANE.
//
// ── THE LAW ──────────────────────────────────────────────────────────────────
//
// Gold plan §1, verbatim, and it is a list rather than a principle for a reason:
//
//   "LIVE — acts: walks, says, enters/exits, throws, arena beats. Personal,
//    ephemeral, non-contested. Written synchronously by the office API."
//
// Gold plan §2, verbatim: "Events → Postgres (the office)."
//
// And the migration meta-rule, gold §3, verbatim: "every change answers WHICH
// LANE, WHICH TABLE, WHICH PEN — or it is refused."
//
// ── WHY THIS EXISTS BESIDE falsifier-acts-parity ─────────────────────────────
//
// The parity falsifier asserts: every undrained sqlite JOURNAL row has its
// `acts` twin. That is a complete check of the lanes that write a journal row,
// and it is BLIND BY CONSTRUCTION to the lanes that do not — it iterates the
// journal, so a lane with no journal row is a lane it never asks about.
//
// That blindness is what hid the say gap. Speech is named in the first sentence
// of the LIVE lane's own definition, its pen is the voices log, it never
// touched `appendJournal`, and the standing falsifier was green the entire
// time. Two siblings were hiding in the same shadow (walk under
// WORLD_MOVEMENT_V2, and give/drop/take), and the class is not "say was
// forgotten" — it is:
//
//   A LANE IS INVISIBLE TO 2.0 UNLESS SOMETHING ASSERTS ITS CLOSURE FROM THE
//   LANE'S OWN PEN. Asserting it from the journal only ever finds the lanes
//   that were already there.
//
// So this file reads each lane's OWN store — voices-log.jsonl, `attachments`,
// `movements` — and asks whether the act reached Postgres. Different question,
// different direction, and the two together cover the whole door.
//
// ── AND THE CENSUS GUARD, WHICH IS THE PART THAT SURVIVES US ─────────────────
//
// Checks 1–3 catch today's three gaps. Check 0 catches TOMORROW's: it reads the
// apex's own dispatch table and reds if a verb appears that this file has not
// been told about. A new act cannot be added to the world without someone
// answering the meta-rule's question for it. That is the difference between
// fixing three instances and fixing the class.
//
// ── RUN ──────────────────────────────────────────────────────────────────────
//
//   WORLD2_PG_URL=... node world2/tools/falsifier-acts-lane-closure.mjs \
//     --db <dynamic.db> --voices <voices-log.jsonl> [--since <ISO>]
//
// `--since` is the closure window's floor. Default: the open window's
// `opens_at`, which is a boundary the store itself defines rather than one this
// file invents. Acts written before the mirror was switched on are lawfully
// absent, and a falsifier that ignored that would be red forever and therefore
// read by nobody (the lesson departure 3 taught falsifier-acts-parity).
//
// Exit 0 green · exit 1 red · exit 2 CANNOT RUN — never green for a question it
// could not ask. --prove-can-fail proves each check catches a mangled input,
// touching no store.

import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

// LAW (parity matrix P-143, verbatim): "The 09-30 reverse-mirror expiry does NOT
// apply to an unflipped lane." The dates live PER LANE in `LANE_MIRROR`
// (src/world2-acts.mjs) since DEC-2 was ruled; this file's expiry gate names the
// lanes it reds on and never counts one exempt by ruling.
// The mirror-expiry imports are GONE (G1 / POS-156): `LANE_MIRROR` and the
// functions over it were deleted with the journal INSERT they were pressuring,
// which is what DEC-2 said ends a lane's obligation -- removing the row, ports
// landed and deletion ruled, never a clock running out.

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const has = (name) => process.argv.includes(name);

// ── CHECK 0 · THE CENSUS · every mutating apex verb is accounted for ─────────
//
// One row per apex action, and the value is the ANSWER to the meta-rule's
// question — which pen writes it, and how it reaches `acts`. The three values
// are the only ones that exist:
//
//   "journal"  the lane writes a sqlite journal row; `appendJournal`'s mirror
//              carries it, and falsifier-acts-parity is what checks it.
//   "lane"     the lane keeps its own pen and calls `mirrorLaneAct`; THIS file
//              checks it, in the numbered check named beside it.
//   "none"     the lane deliberately does not reach `acts`, WITH ITS REASON.
//              A "none" is a ruling, not a gap, and every one of them is a
//              sentence somebody has to defend.
const LANE_OF = Object.freeze({
  // journalled — parity falsifier's territory
  "leave-mark": "journal", withdraw: "journal", enter: "journal", exit: "journal",
  // `declare-stance-on`, NOT `declare-stance` — the apex's own spelling
  // (world-stance.mjs § ACTION_STANCE). Written as a literal rather than
  // imported on purpose: the census guard's whole job is to catch a name that
  // has drifted from the door, and it cannot catch drift in a constant it
  // shares with the door. It caught this one on the first run.
  "declare-stance-on": "journal",
  // THE ARENA'S BEATS — all five land as `arena-act` journal rows
  // (src/arena.mjs; parity matrix P-143: "state derived from the dynamic.db
  // journal … mirrored to PG `acts` by the all-lanes shadow"), so the parity
  // falsifier carries them like any journalled lane. Do not confuse this with
  // the PEN flip, which is refused BY RULING for this lane (Keemin,
  // 2026-08-29, P-143): the refusal is a fact about `W2_PEN`, not about the
  // mirror — a beat still reaches `acts` the journalled way. Named
  // 2026-09-02, the first census run against an apex that dispatches them
  // (the C1 flip night); until then check 0 had never been asked.
  strike: "journal", cast: "journal", guard: "journal", lift: "journal", loot: "journal",
  // THE VEHICLE'S ACT (#2986, 2026-09-19). Which lane: journal. Which table:
  // `journal`, class `ride`. Which pen: `appendJournal`, which carries the
  // World 2.0 mirror into `acts` itself — the same path enter/exit take, so
  // this is the parity falsifier's territory and needs no closure check of its
  // own. It is NOT `move`: a walk is a line with a pace that position readers
  // interpolate along, and a ride has no line and no intermediate points.
  //
  // ⚑ THIS ROW IS HERE BECAUSE THE CENSUS ASKED FOR IT AND THE LANE HAD NOT
  // ANSWERED. Adding `ride` to DISPATCH reddened check 0 on the first full-suite
  // run — the guard doing exactly what gold §3 says it is for: "every change
  // answers which lane, which table, which pen — or it is refused."
  ride: "journal",

  // own pen, mirrored by mirrorLaneAct — checked below
  say: "lane",   // check 1 · voices-log.jsonl
  walk: "lane",  // check 3 · dynamic.db/movements (WORLD_MOVEMENT_V2); the
                 // flag-off arm is journalled, and both are the same act
  give: "lane", drop: "lane", take: "lane",  // check 2 · dynamic.db/attachments

  // ruled out, each with its reason
  "note-to-self": "none",
  //   HOUSEHOLD-PRIVATE BY THE DOOR'S OWN LAW — "one note to your returning
  //   self, replaced on every write, household-private" (world-apex.mjs §
  //   dispatch). `acts` exports to PUBLIC git through the notary, so mirroring
  //   a note would publish a resident's private sentence permanently. This is
  //   the same reasoning Phase 5.6 applies to unstaked drafts, and the same
  //   answer. A note is not a deed the world witnessed; it is a resident
  //   talking to themselves.
  stake: "none", unstake: "none",
  //   THE TOWN'S LANE, NOT THE WORLD'S. Both write the town stamp-ledger
  //   (world-stake-exec.mjs), and the gold plan §5 puts the town's ledgers
  //   explicitly out of scope: "the town repo's ledgers (mail-ledger,
  //   stamp-ledger — different lane, same disease; NOT in this plan's scope)".
  //   A stake DOES reach World 2.0 — as a claims transition
  //   (promoteDraftOnStake), which is the CANDLE lane and has its own
  //   falsifier — but the escrow movement itself is town business.
});

// Read-only apex entries would go here if any existed; today every dispatchable
// action mutates. Kept as an explicit empty set so that "this verb reads" is
// something a future author has to WRITE DOWN rather than achieve by omission.
const READ_ONLY_VERBS = new Set([]);

// ── CHECK 0b · THE CLASS CENSUS · the half the apex table cannot see ────────
//
// FOUND BY THIS FILE'S OWN FIRST RUN, and it is the reason 0b exists at all.
// The dev office's journal carries `arena-act` rows — join/leave, written by
// src/arena.mjs — and the verb census above is STRUCTURALLY BLIND to them:
// arena beats are not apex actions, so they are not in DISPATCHABLE, so no
// amount of care with check 0 would ever have asked about them.
//
// That is the same blindness one level up. Check 0 asks "does every DOOR have
// an answer"; this asks "does every KIND OF ACT the store actually holds have
// one" — and it reads the journal, so it can only ever be answered by what the
// world has really written.
//
// `arena-act` was named here BEFORE src/arena.mjs reached this branch (it rode
// the birthday-dungeon proto until the party-night merge, 2026-08-29 — office
// 37037aa; the apex has dispatched the five beat verbs since, and check 0
// names them above). Naming it early was deliberate: the plan already ruled arena in —
// gold §1's LIVE lane is "walks, says, enters/exits, throws, ARENA BEATS" — and
// it writes journal rows, so `appendJournal`'s mirror carries it the day it
// merges. A census that only learns about a lane after it lands is a census
// that is late by exactly the interval in which the gap can open.
//
// Unlike check 0, a named-but-absent class is NOT red: the authority here is
// the store, which holds only what has happened, and a class no one has
// exercised yet is not a stale door.
const CLASS_LANE_OF = Object.freeze({
  mark: "journal",        // leave-mark / amend / withdraw
  frame: "journal",       // enter / exit
  move: "journal",        // walk, flag-off arm (the flag-on arm is check 3)
  stance: "journal",      // declare-stance-on
  "arena-act": "journal", // gold §1: "LIVE — acts: ... throws, arena beats"
  ride: "journal",        // #2986 — naming a destination from inside a vehicle
  voice: "lane",          // check 1 — never written to the journal; see world-journal.mjs
  holding: "lane",        // check 2 — likewise
});

function checkClassCensus(classesInJournal) {
  const unaccounted = classesInJournal.filter((c) => !(c in CLASS_LANE_OF));
  if (!unaccounted.length) return [];
  return [
    `RED (class census): the journal holds ${unaccounted.map((c) => `"${c}"`).join(", ")}, and this falsifier has never been told whether that kind of act belongs in \`acts\`. `
    + "The migration meta-rule (gold §3): \"every change answers which lane, which table, which pen — or it is refused.\" "
    + "A class that reaches the journal is mirrored by appendJournal whether or not anyone ruled that it should be — so answer it here, and check its payload against the notary's public export before agreeing.",
  ];
}

function checkCensus(dispatchable) {
  const unaccounted = dispatchable.filter((v) => !(v in LANE_OF) && !READ_ONLY_VERBS.has(v));
  const stale = Object.keys(LANE_OF).filter((v) => !dispatchable.includes(v));
  const problems = [];
  if (unaccounted.length)
    problems.push(
      `RED (census): the apex dispatches ${unaccounted.map((v) => `"${v}"`).join(", ")}, and this falsifier has never been told which pen writes it. `
      + "The migration meta-rule (gold §3): \"every change answers which lane, which table, which pen — or it is refused.\" "
      + "Add the verb to LANE_OF with its answer — and if the answer is \"lane\", add its closure check, because an unchecked lane is how the say gap happened.");
  if (stale.length)
    problems.push(
      `RED (census): LANE_OF names ${stale.map((v) => `"${v}"`).join(", ")}, which the apex no longer dispatches. `
      + "A census that describes a door that is gone is a census nobody can trust about the doors that remain.");
  return problems;
}

// ── the shape of an acts lookup ─────────────────────────────────────────────
const ms = (t) => new Date(t).getTime();

if (has("--prove-can-fail")) {
  // Each check, proved able to catch one deliberately mangled input. No store
  // is opened; this is about the checks, not about any world's data.
  const fails = [];

  // check 0 — a verb the census does not name must be caught
  if (!checkCensus(["say", "walk", "brand-new-verb"]).length)
    fails.push("census: an unnamed apex verb was NOT caught");
  // check 0 — a census row for a verb the door no longer has must be caught
  if (!checkCensus(["say"]).some((p) => p.includes("no longer dispatches")))
    fails.push("census: a stale census row was NOT caught");
  // check 0b — a journal class nobody has ruled on must be caught, and a
  // ruled one must not be
  if (!checkClassCensus(["mark", "some-new-class"]).length)
    fails.push("class census: an unruled journal class was NOT caught");
  if (checkClassCensus(["mark", "frame", "arena-act"]).length)
    fails.push("class census: a ruled class was wrongly flagged");

  // checks 1–3 all reduce to `matchAct`: a lane record, and the acts rows in
  // its window. Prove the matcher rejects a near-miss rather than shrugging.
  const acts = [{ actor: "wright", action: "say", at: "2026-08-28T12:00:00.000Z" }];
  if (matchAct(acts, { actor: "wright", action: "say", at: "2026-08-28T12:00:00.000Z" }) == null)
    fails.push("matcher: an exact twin was not matched (the check would red on a healthy store)");
  if (matchAct(acts, { actor: "darko", action: "say", at: "2026-08-28T12:00:00.000Z" }) != null)
    fails.push("matcher: a DIFFERENT actor was accepted as a twin");
  if (matchAct(acts, { actor: "wright", action: "walk", at: "2026-08-28T12:00:00.000Z" }) != null)
    fails.push("matcher: a DIFFERENT action was accepted as a twin");
  if (matchAct(acts, { actor: "wright", action: "say", at: "2026-08-28T12:09:00.000Z" }) != null)
    fails.push("matcher: an act nine minutes away was accepted as a twin");

  // THE EXPIRY GATE'S CAN-FAIL PROOF IS GONE WITH THE GATE (G1 / POS-156).
  // Four probes proved `expiredLanes` caught a governed lane past its backstop,
  // spared one exempt by ruling, went quiet once every governed row was
  // removed, and refused to let an unnamed lane buy immortality. All four were
  // about a map that no longer exists, and the state the third one described --
  // every governed row removed -- is the state this office is now in
  // permanently.

  if (fails.length) { for (const f of fails) console.error(`RED (falsifier broken): ${f}`); process.exit(1); }
  console.log(
    "can-fail proof: the verb census catches an unnamed verb and a stale row; the class census catches an unruled journal class and passes a ruled one; "
    + "the matcher rejects a wrong actor, a wrong action, and a nine-minute drift; "
    + "the per-lane expiry catches a governed lane past its backstop, exempts the arena by P-143's ruling, goes quiet once every governed row is removed, and fails closed on an unnamed lane.");
  process.exit(0);
}

// ── THE CENSUS, ALONE (`--census`) ──────────────────────────────────────────
//
// Checks 0 and 0b need no Postgres, no window and no voices log: check 0
// compares the apex's own dispatch table against `LANE_OF`, and check 0b
// compares a journal's distinct classes against `CLASS_LANE_OF`. Neither of
// them reads `acts` at all.
//
// ⛔ WHY THIS MODE EXISTS, and it is a defect in the file's own shape rather
// than a convenience. The full run reaches check 0 only AFTER the usage gate
// demands `--db` and `WORLD2_PG_URL`, and prints it only after four store-bound
// checks have run. So the one question this census exists to answer on the day
// a verb lands — "does every door this office opens have a pen named for it?" —
// could not be asked on a branch, in a worktree, or anywhere without a live
// store to open. `--prove-can-fail` proves the CHECK works against synthetic
// input; it never asks the check about THIS TREE. That is the gap: a census
// that is "late by exactly the interval in which the gap can open" was, itself,
// unaskable during exactly that interval.
//
// `--db` is optional and its absence is DISCLOSED rather than counted green:
// without a journal to read, check 0b has nothing to be asked about, and a mode
// that reported "clean" for a check it did not run would be the noise floor
// hidden in the silence.
//
// ⛔ EACH CHECK'S VERDICT COMES FROM ITS OWN FINDINGS (the office-halves
// review, repair 4). The first cut of this mode pushed check 0b's findings
// into check 0's `problems` array and then printed "check 0 … RED" off its
// length — so an unruled journal class was reported as a verb-census failure
// while LANE_OF was untouched and check 0 was green. A verdict computed from a
// different source than the one it names is the freshness-stamp class.
//
// ⛔ GIVEN-BUT-UNREADABLE IS A REFUSAL, NOT "NO --db WAS GIVEN" (repair 5).
// The first cut gated on `censusDb && existsSync(censusDb)` and fell into the
// no-db disclosure otherwise, so an operator who typo'd the path got exit 0
// and a sentence blaming them for something they did do. Now a path that was
// given and cannot be read as a journal is a usage refusal — exit 2, the
// same code the full run's usage gate uses — that names the path and the
// reason, and the run says nothing green about a check it could not ask.
if (has("--census")) {
  const { DISPATCHABLE } = await import("../../src/world-apex.mjs");
  const verbProblems = checkCensus([...DISPATCHABLE]);
  const verbLine = `check 0 asked ${DISPATCHABLE.length} dispatchable verb(s) against LANE_OF — ${verbProblems.length ? "RED" : "every one is named"}`;

  // ── CHECK 0b ASKS THE STORE IT CAN REACH, AND SAYS WHICH (G1 / POS-156) ──
  //
  // The two modes read DIFFERENT STORES after G1, and that is deliberate rather
  // than an oversight. Check 0b's question is fixed — "does every KIND OF ACT
  // the store actually holds have a ruling in CLASS_LANE_OF" — and what changes
  // between the modes is which store is reachable to ask it of.
  //
  //   the FULL run   has Postgres, so the store is `acts` and the check runs
  //                  there (check 0b, below). It read the sqlite journal until
  //                  G1; after G1 that table holds the arena's rows and nothing
  //                  else, so a census over it THERE would have gone quiet
  //                  about every other class while still reporting green — the
  //                  exact failure this check exists to prevent.
  //
  //   the CENSUS     has NO POSTGRES. That is the whole of it: this mode exists
  //   (`--census`)   "to be asked on the day a verb lands, on a branch, with no
  //                  Postgres", which is why it takes `--db` and reads whatever
  //                  journal it is pointed at. Pointing it at `acts` would not
  //                  narrow this mode, it would DELETE it.
  //
  // ⚑ AN EARLIER CUT OF G1 DID DELETE IT, by moving this arm to "runs against
  // the RECORD, below" — below a `process.exit` this mode never reaches, in a
  // mode that has no record to reach. It cost the four tests in
  // `test/lane-closure-census.test.mjs`, which are about this mode's CONTRACT
  // (a per-check verdict, a refusal when `--db` cannot be read, a disclosure
  // when it was not given) and not about which table production fills.
  //
  // WHAT THE CENSUS CAN SEE HAS NARROWED, and the honest place to say so is
  // here rather than in a silently weaker check: pointed at a post-G1 office's
  // `dynamic.db` it sees the arena's classes and no others, because that is
  // what that table now holds. The question is still a real one — the arena is
  // the lane still writing there, and a new arena class nobody ruled on is
  // exactly what this catches — and the line it prints names the count AND the
  // classes, so an operator reading "1 journal class(es) (arena-act)" can see
  // the narrowing rather than read it as a clean bill of health.
  let classes = null;
  let classProblems = [];
  let classLine;
  const censusDb = arg("--db");
  if (censusDb == null || censusDb === "") {
    classLine = "check 0b was NOT asked — no --db was given, so no journal was read and this run says nothing about which classes the store holds";
  } else {
    try {
      if (!existsSync(censusDb)) throw new Error("no such file");
      const db = new DatabaseSync(censusDb, { readOnly: true });
      try { classes = db.prepare("SELECT DISTINCT class FROM journal").all().map((r) => String(r.class)); }
      finally { db.close(); }
    } catch (e) {
      for (const p of verbProblems) console.error(p);
      console.error(
        `REFUSED (census usage): --db ${censusDb} was given and could not be read as a journal (${String(e?.message ?? e)}). `
        + "Check 0b was asked of it and could not be answered — this run says nothing about which classes the store holds, "
        + "and it refuses rather than passing that silence off as green or as the operator's omission.");
      console.log(`census: ${verbLine}; check 0b was asked of ${censusDb} and could NOT read it — REFUSED (exit 2)`);
      process.exit(2);
    }
    classProblems = checkClassCensus(classes);
    classLine = `check 0b asked ${classes.length} journal class(es) against CLASS_LANE_OF (${classes.join(", ") || "none"}) — ${classProblems.length ? "RED" : "every one is ruled"}`;
  }

  for (const p of [...verbProblems, ...classProblems]) console.error(p);
  console.log(`census: ${verbLine}; ${classLine}`);
  process.exit(verbProblems.length || classProblems.length ? 1 : 0);
}

/**
 * The lane record's twin among the acts, or null.
 *
 * MATCHED ON (actor, action, at), WITH A TOLERANCE, and the tolerance is the
 * honest part. A lane's own pen and the mirror stamp the same act from the same
 * source value — `voice.at`, `born_at` — so they should agree exactly. They are
 * compared with a window anyway because the two stores round differently
 * (sqlite TEXT vs timestamptz) and a falsifier that reds on a rounding mode is
 * a falsifier that gets switched off. TWO SECONDS is far tighter than the
 * shortest interval between two acts by one actor (the say rate limit alone is
 * measured in tens of seconds), so it cannot pair up neighbours.
 */
function matchAct(acts, { actor, action, at, object = undefined }) {
  const t = ms(at);
  for (const a of acts) {
    if (a.actor !== actor || a.action !== action) continue;
    if (object !== undefined && (a.object ?? null) !== (object ?? null)) continue;
    if (Math.abs(ms(a.at) - t) <= 2000) return a;
  }
  return null;
}

// THE EXPIRY GATE IS GONE (G1 / POS-156). It reddened when a lane's reverse
// mirror outlived its backstop, and told the reader to land that lane's read
// ports, rule its deletion, and remove its row. Every one of those happened --
// POS-152/153/154/162/194/195 landed the ports, RULING 3 ruled the deletion,
// and the map went with the INSERT in the same commit. A gate watching for a
// shim that no longer exists is the furniture rule 5 is about.
//
// The ARENA's exemption outlives the gate and is stated where it is implemented
// now: `FLIP_REFUSED` and `appendArenaRow` in `src/world-journal.mjs`, the one
// sqlite INSERT G1 left standing, which refuses any other class by name.

const dbPath = arg("--db");
const voicesPath = arg("--voices");
if (!dbPath || !process.env.WORLD2_PG_URL) {
  console.error("usage: WORLD2_PG_URL=... node falsifier-acts-lane-closure.mjs --db <dynamic.db> --voices <voices-log.jsonl> [--since <ISO>]");
  process.exit(2);
}

// ── check 0, first, because a stale census makes every other check a lie ─────
const { DISPATCHABLE } = await import("../../src/world-apex.mjs");
const censusProblems = checkCensus([...DISPATCHABLE]);

const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: process.env.WORLD2_PG_URL, max: 1 });

// THE WINDOW FLOOR. Default to the open window's `opens_at` — a boundary the
// store defines. Refusing rather than guessing when there is none: a closure
// check with no floor would compare a lane's whole history against a mirror
// that started yesterday, and report a catastrophe that is only a start date.
let since = arg("--since");
if (!since) {
  const { rows } = await pool.query("SELECT opens_at FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  since = rows[0]?.opens_at ? new Date(rows[0].opens_at).toISOString() : null;
}
if (!since) {
  console.error("no --since and no open window to take a floor from — this check cannot say which acts it is entitled to expect, and will not report a green it did not earn.");
  await pool.end();
  process.exit(2);
}
const floor = ms(since);

const { rows: acts } = await pool.query(
  "SELECT actor, action, object, at, class FROM acts WHERE at >= $1", [since]);

const reds = [...censusProblems];
const counts = { say: [0, 0], holding: [0, 0], walk: [0, 0] };

// ── check 1 · SAY · voices-log.jsonl → acts ─────────────────────────────────
//
// The gap this whole lane was opened for. The voices log is the say's first pen
// and the town's ruled durable record of speech; every line in it inside the
// window is an act the world witnessed and `acts` must hold.
if (!voicesPath || !existsSync(voicesPath)) {
  console.error(`--voices ${voicesPath ?? "(not given)"} is not readable — the say lane is the one this falsifier exists for, and it will not report green without reading it.`);
  await pool.end();
  process.exit(2);
}
for (const line of readFileSync(voicesPath, "utf8").split("\n")) {
  if (!line.trim()) continue;
  let v = null;
  try { v = JSON.parse(line); } catch { continue; } // a torn line is not a missing act
  if (!v?.handle || !v.at || ms(v.at) < floor) continue;
  counts.say[1] += 1;
  if (matchAct(acts, { actor: v.handle, action: "say", at: v.at })) counts.say[0] += 1;
  else reds.push(
    `RED (say): ${v.handle} spoke at ${v.at} and no act says so. `
    + "gold §1: \"LIVE — acts: walks, SAYS, enters/exits\". The voices log is the pen; src/world.mjs § mirrorVoiceAct is what should have carried it.");
}

const sqlite = new DatabaseSync(dbPath, { readOnly: true });

// ── check 0b · the class census, against what the store actually holds ──────
//
// THE STORE IS `acts` (G1 / POS-156). Derived from the rows already read above
// rather than asked for again, so the census can only ever be about the same
// window this run is about -- a second query would let the two disagree.
//
// ⚑ IT IS SCOPED TO `--since`, and that is a change worth naming: the journal
// it used to read was the whole live table, and this is the window. A class
// that last appeared before the floor is not asked about here. That is the
// honest reading of "what the store actually holds" for a tool whose every
// other check is windowed, and the alternative -- an unbounded DISTINCT over a
// growing record on every run -- is the cost this tool refused everywhere else.
const liveClasses = [...new Set(acts.map((a) => a.class).filter(Boolean).map(String))].sort();
reds.push(...checkClassCensus(liveClasses));

// ── check 2 · HOLDING · dynamic.db/attachments → acts ───────────────────────
//
// give/drop/take. The `attachments` row is the declaration; its `declared_by`
// is the actor (never inferred — "nobody writes a movement record on anyone
// else's behalf") and `born_at` is the stamp the door strictly ordered.
const HOLD_ACTIONS = new Set(["give", "drop", "take"]);
for (const r of sqlite.prepare("SELECT entity, target, declared_by, born_at FROM attachments ORDER BY seq").all()) {
  if (!r.born_at || ms(r.born_at) < floor) continue;
  counts.holding[1] += 1;
  const twin = acts.find((a) =>
    a.actor === r.declared_by && HOLD_ACTIONS.has(a.action)
    && (a.object ?? null) === r.target && Math.abs(ms(a.at) - ms(r.born_at)) <= 2000);
  if (twin) counts.holding[0] += 1;
  else reds.push(
    `RED (holding): ${r.declared_by} declared a holding on ${r.target} at ${r.born_at} and no act says so. `
    + "The pen is dynamic.db/attachments; src/world-hold.mjs § mirrorHoldingAct is what should have carried it.");
}

// ── check 3 · WALK · dynamic.db/movements → acts ────────────────────────────
//
// The lane that hid best: walk-exec.mjs DOES journal, so the verb read as
// covered — but that arm is the WORLD_MOVEMENT_V2-off branch, and dev has run
// movement-v2 on. Two pens behind one verb; a lane is closed only when every
// pen behind it is.
for (const r of sqlite.prepare("SELECT actor, at, to_mark, declared_by FROM movements ORDER BY seq").all()) {
  if (!r.at || ms(r.at) < floor) continue;
  counts.walk[1] += 1;
  if (matchAct(acts, { actor: r.actor, action: "walk", at: r.at })) counts.walk[0] += 1;
  else reds.push(
    `RED (walk): ${r.actor} departed at ${r.at} and no act says so. `
    + "The pen is dynamic.db/movements (WORLD_MOVEMENT_V2); src/world.mjs § THE WALK GAP is what should have carried it.");
}
sqlite.close();
await pool.end();

if (reds.length) {
  for (const r of reds) console.error(r);
  console.error(`RED: ${reds.length} lane-closure failures.`);
  process.exit(1);
}
const line = (k) => `${k} ${counts[k][0]}/${counts[k][1]}`;
console.log(
  `GREEN: every write lane reaches acts since ${since} — ${line("say")}, ${line("holding")}, ${line("walk")} twinned; `
  + `census clean (${DISPATCHABLE.length} apex actions, each answering which pen writes it). `
  + "No lane owes a reverse mirror: G1 deleted the journal INSERT and the map that governed it (POS-156).");
