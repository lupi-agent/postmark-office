// town-bridge.mjs — THE FERRY BRIDGE: the live invoker of the town log's drain.
//
// WAVE 4 OF POS-44, and the piece that makes the other three real. Waves 1-3
// built a log and three classes of row that go into it — joins, paper acts,
// letters — and a drain half for each: planTownDrain/writeTownDrain for joins,
// replayPaperAct for updates, replayLetter for mail. Until this file, NOTHING
// CALLED ANY OF THEM outside a test. Flag-on, the town's rows accumulated and
// the record never moved. This is the caller.
//
// ── WHERE IT RUNS, AND WHY EXACTLY THERE ──────────────────────────────────
//
// Inside the ferry's crossing, as the FIRST step of postmark-ferry.service's
// chain, before `node tools/ferry.mjs`. Three constraints pin it to that slot
// and nowhere else:
//
//   1. BEFORE THE FERRY'S SWEEP, or a letter drained after it would sit in the
//      outbox for a whole extra crossing. The row's own promise to the sender
//      is "it sails at the next crossing" (town-mail.mjs § STANDING), and the
//      sweep is what sailing means. Draining first is what makes that sentence
//      true rather than approximately true.
//   2. AFTER THE UNIT'S `git reset --hard` / `git clean -- WHITE_PAGES` crash
//      recovery, which is the first thing that ExecStart does. Anything this
//      wrote before that pair would be thrown away by it — and, read the other
//      way round, that pair is also what makes a crash INSIDE a drain cost
//      nothing. A join writes files and then commits them, so a death in
//      between leaves untracked cards under WHITE_PAGES (which `clean` removes)
//      and a modified tools/households.json (which `reset --hard` restores).
//      The rows are still pending because the cursor never moved, so the next
//      crossing starts from a clone that looks exactly as it did before.
//   3. UNDER THE UNIT'S EXISTING FLOCK, which the whole chain already holds.
//      The bridge takes no lock of its own — every unit in deploy/ wraps its
//      own ExecStart in `/usr/bin/flock -w 300 …/town.lock` and that is the
//      house idiom; a nested flock on the same path from a child would deadlock
//      against its own parent. What the bridge does instead is CHECK that
//      somebody holds it (§ the lock assertion below), which is the testable
//      form of "hold the town lock" for code that runs inside a lock it did
//      not take.
//
// ── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
//
// IT WRITES NOTHING OF ITS OWN. Every byte that reaches the clone comes from
// the pen lane's own functions, reached through the same two replay seams the
// tests use: `buildJoinFiles`/`planRegistryJoin` for a join, and the DOOR
// ITSELF for an update or a letter, handed in as the `doors` map. This module
// is the first place in the office that assembles that map, which is precisely
// why town-updates.mjs and town-mail.mjs take it as an argument: they stay free
// of the pen, and the invoker owns the wiring. There is no second renderer of
// an ADDRESS card or a letter anywhere in this file, so there is nothing here
// that can drift from what a door writes.
//
// IT IS NOT GATED BY THE WORLD FREEZE, and that is deliberate rather than an
// omission. WORLD_FREEZE pauses GROUND acts; its own bounce says so in the
// sentence a resident reads — "reads stay open and letters sail as ever". Mail,
// paper and households are exactly the half the freeze keeps alive, so a bridge
// that checked it would stop the town for a cutover that was designed not to.
//
// IT DOES NOT DELIVER. A letter becomes an outbox file and stops there; inbox
// placement and the mail-ledger lines are the ferry's alone, because the ledger
// IS the ferry's idempotency key (town-mail.mjs § the three halves). The ferry
// runs immediately after this in the same chain and picks the letter up as an
// ordinary outbox letter.
//
// ── THE ORDER ROWS ARE REPLAYED IN ─────────────────────────────────────────
//
// Joins first, as ONE fold over the whole crossing — planTownDrain is written
// that way on purpose (two joins into one household must each see the other's
// effect on the registry, or both write themselves as the first). Then updates
// and letters IN SEQ ORDER among themselves, because the log is the input tense
// and its order is the only truth about what happened first. A resident who
// edited their card twice gets the second edit last, which is the same rule
// hotestFor keeps at the read side.
//
// ── IDEMPOTENCE, WHICH IS THE PROPERTY THE WHOLE ACT HANGS ON ──────────────
//
// The cursor advances LAST, after the record is durable — town-drain.mjs's own
// law: "a cursor moved before the record is durable is the one ordering that
// can lose a household". The cost of that ordering is the other failure: a
// crash between the commit and the cursor advance leaves rows that have already
// been written down still pending, and the next crossing replays them. So every
// replay path must survive being run twice over the same row:
//
//   · JOINS already do. planTownDrain skips a handle that "already stands in
//     the white pages", and the registry fold is planned against the registry
//     as it now reads.
//   · PAPER ACTS DO NOT EITHER, and this line used to say they did — "the door
//     rewrites the file with the same bytes and penCommit returns null for a
//     diff that is empty". True of the file the door wrote, and the premise it
//     hid is that the file is still that file. #2302 is what happens when it is
//     not: on 2026-08-30 a `update_profile` call carrying empty strings was a
//     documented no-op against a PROFILE.md that did not have those keys; four
//     fields were then hand-added by their owner (the road TOWN_BULLETIN's
//     build-your-profile.md advertises); and the 12:00Z crossing replayed the
//     same "clear" against a file that by then HAD them, deleting all four
//     (63a38162). Rewriting with the same bytes is only harmless when nothing
//     else has written in between, and nothing was checking.
//     So the update branch now carries the same shape the letter branch has
//     always had: the row records what the act ALREADY LANDED — the shas the
//     door's own pen returned, `payload.commits` — and a row whose every sha is
//     an ancestor of the clone's HEAD is `already`, not replayed. The companion
//     half is that a documented no-op writes no row at all (town-updates.mjs §
//     logPaperAct): a call that landed nothing has nothing to settle.
//     TWO LIMITS, STATED. A row logged before this fix carries no `commits`
//     field, and is replayed exactly as before — the guard skips only on a
//     POSITIVE match, never on an absent one, because reading absence as "no
//     commits, therefore nothing to redo" would silently un-settle every row
//     already in the log. And the ancestor question is asked of THIS clone: a
//     sha it has never seen answers "not applied" and the row replays, which is
//     the safe direction.
//   · LETTERS DO NOT, and this is the one place the bridge must think. The pen
//     lane throws 409 "that letter file already exists" on a second write — the
//     right answer for a resident sending the same letter twice, and the wrong
//     one for a drain resuming. So the bridge checks the row's OWN recorded
//     path (`payload.file`, carried by logLetter for exactly this class of
//     reader) and skips a letter already standing in its outbox, naming it
//     `already` rather than pretending it drained. It never catches the door's
//     409 to decide this: a bounce is the door's answer to a caller, and a
//     drain that read its own state out of somebody else's error string would
//     be one refactor away from silently swallowing a real defect.
//
// A letter the ferry has ALREADY DELIVERED in the same window is gone from the
// outbox, so that check would miss it — but the drain and the cursor advance
// both complete before the ferry's sweep begins, so no window exists in which
// that is reachable. It is stated here because the next person to move this
// step later in the chain needs to know what moving it costs.
//
// ── WHAT THE CURSOR OWES, IN ONE LINE ──────────────────────────────────────
//
// It may advance past a row that was SETTLED or a row that was JUDGED, and
// never past a row that was DEFERRED. `settle` is the first, `skipped` is the
// second, `waiting` is the third — and only the third makes a promise, so only
// the third can be broken. Two mechanisms keep it and they compose: the gangway
// FREEZES the cursor over the rows it defers, and § the deferral tripwire
// REFUSES the crossing over any other deferred row rather than walking past it.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { enqueueLetter, penCommit } from "./write.mjs";
import {
  updateAddressBody, updateAddressFields, updateHome, updateProfile, updateWindow,
} from "./edit.mjs";
import {
  pendingRows, townDrainCursor, townJournalHead, townLogEnabled, TOWN_CLASSES,
} from "./town-journal.mjs";
import { advanceTownCursor, drainPenReady, planTownDrain, writeTownDrain } from "./town-drain.mjs";
import { planFirstIdeaSweep, writeFirstIdeaSweep } from "./first-idea-sweep.mjs";
import { replayPaperAct } from "./town-updates.mjs";
import { replayLetter } from "./town-mail.mjs";
import { townLockPath, useFlock } from "./town-lock.mjs";

/**
 * THE DOORS MAP — tool name to the implementation the drain replays through.
 *
 * The keys are the tool names PAPER_ACTS and MAIL_DOOR already publish, so the
 * table drifting out of step with the acts it serves is a missing key at replay
 * time (named in the report as `no door for <tool>`) rather than a silent skip.
 *
 * `send_letter` is bound to `enqueueLetter` — the FLAG-OFF pen — and that is
 * the point rather than an oversight: the flag chooses whether a letter becomes
 * a row at the door, and the drain is what turns the row into the file the pen
 * would have written. Binding the flag-on door here would make the drain write
 * a row for the row it is draining.
 */
export const TOWN_DOORS = Object.freeze({
  update_address_body: updateAddressBody,
  update_address_fields: updateAddressFields,
  update_home: updateHome,
  update_profile: updateProfile,
  update_window: updateWindow,
  send_letter: enqueueLetter,
});

/**
 * Is somebody holding the town lock?
 *
 * `true` held, `false` free, `null` unknowable here. A NON-BLOCKING flock that
 * SUCCEEDS is the proof of absence: flock's locks are per open-file-description,
 * so a fresh open of the same path conflicts with the parent unit's hold and
 * exits non-zero. Off linux there is no /usr/bin/flock, the office's writes do
 * not serialize through one, and the honest answer is that this cannot be known
 * — which is why `null` is a distinct value and not folded into `false`.
 */
export function townLockHeld({ flock = useFlock(), path = townLockPath() } = {}) {
  if (!flock) return null;
  const r = spawnSync("/usr/bin/flock", ["-n", path, "true"], { stdio: "ignore" });
  if (r.error) return null;
  return r.status !== 0;
}

/**
 * Is this sha already behind the clone's HEAD? (#2302 — the update resume key.)
 *
 * `merge-base --is-ancestor` is the same question penCommit asks of origin/main
 * after a push, in the same words, and it is asked here rather than in
 * town-updates.mjs for the reason that module states about itself: it never
 * imports the pen and never learns what a clone is. The bridge is where the
 * clone lives.
 *
 * FALSE ON ANY DOUBT, and that asymmetry is the whole safety of the guard. A
 * missing git, an unreadable clone, a sha this clone has never heard of — every
 * one of them answers "not applied", and the row replays exactly as it did
 * before the fix. The guard can therefore cost a redundant replay (which is
 * what the drain already did every crossing) and can never cost a lost act.
 * `spawnSync` rather than execFileSync for the same reason: a non-zero exit is
 * an answer here, not an exception to catch and interpret.
 */
export function isAncestorOfHead(clone, sha) {
  if (!clone || typeof sha !== "string" || !/^[0-9a-f]{7,64}$/i.test(sha)) return false;
  const r = spawnSync("git", ["-C", clone, "merge-base", "--is-ancestor", sha, "HEAD"], { stdio: "ignore" });
  return !r.error && r.status === 0;
}

// THE TOWN'S DAY, NOT THE WIRE'S (found live 2026-08-30 ~20:22 EDT, the gift
// blackout): this was `utcDate` — `toISOString().slice(0, 10)` — so the 00:00Z
// crossing (8 PM in town) stamped its registry lines with TOMORROW's date
// while the same crossing's mint lines carried the town day. The append-only
// forward-dated gate then refused every town-dated writer (gifts first) for
// the four hours until midnight ET, and the join's household binding read as
// effective a day after the resident actually arrived. Every other dated
// writer in this repo derives the day from TOWN_TZ (ops.townDay, declare,
// residency, the mint engine itself); the drain now speaks the same clock.
// `ms` stays injectable so the falsifier can stand AT the boundary instant.
const townDayOf = (ms) => new Intl.DateTimeFormat("en-CA",
  { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(new Date(ms));

/**
 * The one honest line a drain leaves behind, whatever it did.
 *
 * `bounced=` appears ONLY when it is non-zero, and that asymmetry is the point:
 * a quiet crossing must read as quiet at a glance, so the day a letter fails to
 * replay is the day this line grows a word an operator has never seen on it.
 */
export const drainLine = (r) =>
  `[town-drain] ${r.ran ? `date=${r.date} joins=${r.counts.join} updates=${r.counts.update} letters=${r.counts.letter}`
    + ` head=${r.head} cursor=${r.cursor} commit=${r.commit ?? "none"}`
    + (r.gangway_held ? ` GANGWAY=${r.gangway}(${r.gangway_held} held, cursor still)` : "")
    + (r.bounced ? ` BOUNCED=${r.bounced}` : "")
    + (r.refused ? ` REFUSED=${r.refused}` : "")
    : `skipped — ${r.skipped}`} took=${r.took_ms}ms`;

/**
 * Drain the town log into the record. One crossing, one call.
 *
 * `odb` holds the log (the office's oauth.db), `db` is the read index the doors
 * take, `clone` is the town clone the pen writes into. Returns a report; throws
 * only on something the drain genuinely cannot survive, because the ferry chain
 * is `&&`-joined and a throw here holds the mail.
 */
// ASYNC SINCE POS-158, and the reason is one line deeper: the registry is
// store-of-record, so `planTownDrain` reads the record and `writeTownDrain`
// writes rows to it. Neither can be synchronous any more, and a drain that
// pretended to be would be handing its caller a promise dressed as a report.
// Every caller awaits; the ferry chain is `&&`-joined shell and is unaffected.
export async function runTownDrain(odb, {
  db = null, clone, doors = TOWN_DOORS, date = null, now = Date.now(),
  // `lockHeld` is injectable so the refusal below is a branch a falsifier can
  // actually reach: /usr/bin/flock exists on the box and on nothing else, so a
  // test that could only observe the linux answer would be asserting the
  // platform rather than the guard.
  requireLock = true, lockHeld = townLockHeld, dryRun = false, log = console.error,
} = {}) {
  const t0 = Date.now();
  const done = (r) => { const out = { ...r, took_ms: Date.now() - t0 }; log?.(drainLine(out)); return out; };

  // ── the flag ─────────────────────────────────────────────────────────────
  // A NO-OP THAT SAYS SO. The bridge ships live on a box where the flag is off,
  // and a step that printed nothing would be indistinguishable from a step that
  // silently failed to run — which is the state this whole cutover exists to
  // stop being possible.
  if (!townLogEnabled())
    return done({ ran: false, skipped: "TOWN_SINGLE_LOG is off — the doors write the record directly and there is no log to drain", drained: 0 });
  if (!clone) return done({ ran: false, skipped: "no town clone configured — nothing to drain into", drained: 0 });

  // ── the lock assertion ───────────────────────────────────────────────────
  // Everything below writes the town clone. Running it unserialized is the
  // class of race the walk ledger lost 17 public lines to; refusing is cheap
  // and a wrong answer here is loud rather than silent.
  if (requireLock && !dryRun && lockHeld() === false)
    return done({ ran: false, refused: "unlocked", drained: 0,
      skipped: `nothing holds ${townLockPath()} — the drain writes the town clone and must run under the ferry's flock, as every unit in deploy/ does` });

  const stamp = date ?? townDayOf(now);
  const rows = pendingRows(odb);

  // ── THE TRIPWIRE, EXTENDED TO THE INVOKER ────────────────────────────────
  //
  // appendTownJournal already refuses a class this log does not own, and
  // world-journal.mjs refuses one that it does. Both guard the WRITE. This
  // guards the READ, and it is not redundant: a row can reach this table
  // without passing that door — a hand-run migration, a restored backup, a
  // future class added to the schema before its drain half exists. The invoker
  // is the last reader before a cursor moves past a row forever, so a class it
  // has no replay for must stop the whole run rather than be skipped. Skipping
  // would advance the cursor past a row nothing drained, which is the one
  // outcome the two-tables ruling was made to prevent.
  const foreign = rows.filter((r) => !TOWN_CLASSES.has(r.cls));
  if (foreign.length)
    return done({ ran: false, refused: "foreign-class", drained: 0,
      skipped: `the town log holds ${[...TOWN_CLASSES].join(", ")} rows and this drain has a replay for each —`
        + ` rows ${foreign.map((r) => `${r.seq}:${r.cls}`).join(", ")} belong to no class it can settle.`
        + ` Nothing was written and the cursor did not move: every row is still here.`,
      foreign: foreign.map((r) => ({ seq: r.seq, cls: r.cls, act: r.act })) });

  const counts = { join: 0, update: 0, letter: 0 };
  for (const r of rows) counts[r.cls] += 1;
  const head = rows.length ? rows[rows.length - 1].seq : townDrainCursor(odb);

  if (!rows.length)
    return done({ ran: true, date: stamp, drained: 0, counts, head, cursor: townDrainCursor(odb),
      commit: null, settled: [], waiting: [], skipped_rows: [], updates: [], letters: [],
      remaining: 0, note: "nothing pending" });

  // ── the joins, folded once over the whole crossing ───────────────────────
  const plan = await planTownDrain(odb, clone, { date: stamp });
  // planTownDrain computes its head over the SAME pending read, so a mismatch
  // means the log moved under us — which, under the lock, cannot happen. It is
  // asserted rather than assumed because the cursor is about to be set from it.
  if (plan.head !== head)
    throw new Error(`the town log moved during the drain: the invoker read head ${head}, the join plan read ${plan.head} — the cursor is set from this and must not be guessed`);

  // ── THE GANGWAY HOLDS THE CURSOR, NOT JUST THE ROWS ──────────────────────
  //
  // planTownDrain now reads HARBOR/GANGWAY.md and files every join row under
  // `waiting` while the gangway is up (see its § the gangway reaches the
  // settlement road). That is half the fix. The other half is here, and without
  // it the first half is worse than nothing: `waiting` is a pile in a REPORT,
  // and this function advances the cursor to `head` — the last PENDING row —
  // regardless of which pile a row landed in. A held join would be reported as
  // waiting and then walked past forever, which is losing a household while
  // printing the word that promises you did not.
  //
  // So while the gangway holds at least one join row, the cursor does not move
  // at all. The rows stay pending, and the crossing after the gangway lowers
  // settles them in their own order, off the same log.
  //
  // WHAT THAT COSTS, stated because the next person to touch this needs it.
  // Letters and paper acts on the same crossing still drain (the scope call —
  // the gangway is the arrivals breaker), and with the cursor held they are
  // read again on the next crossing. Paper acts replay to the same bytes and
  // penCommit returns null for an empty diff. A letter whose outbox file still
  // stands is caught by the resume check below (`already`). A letter the ferry
  // has ALREADY DELIVERED is the one that is not: its outbox file is gone, so
  // the drain writes it again — and the FERRY bounces it, because dedupe is
  // rebuilt from WHITE_PAGES/mail-ledger.md at every crossing and `classify`
  // answers "duplicate id". Bounced, never delivered twice. That is a backstop
  // and not a design: the clean fix is per-row settlement rather than one
  // scalar cursor, which is a bigger change than a breaker deserved.
  const gangwayHold = plan.gangway.held > 0;
  const gangwayFields = gangwayHold
    ? { gangway: plan.gangway.state, gangway_held: plan.gangway.held }
    : {};

  // ── THE DEFERRAL TRIPWIRE ────────────────────────────────────────────────
  //
  // ONE INVARIANT, AND IT IS THE ONLY THING THE CURSOR OWES ANYBODY: the cursor
  // may advance past a row that was SETTLED or a row that was JUDGED, and never
  // past a row that was DEFERRED. The three piles are exactly that distinction
  // — `settle` drained, `skipped` judged and done ("not a settling act", "no
  // handle", "already stands in the white pages"), `waiting` deferred — and it
  // is `waiting` alone that makes a promise the cursor can break. Passing a
  // deferred row does not merely drop it: it drops it while the report prints
  // the word that says it was kept, and the tier line's own deferral says out
  // loud to the resident "nothing about your standing expires."
  //
  // The gangway is exempt because it already keeps that promise a stronger way
  // — its rows are deferred AND the cursor is frozen for them — so the rule is
  // "deferred with nothing holding the cursor", not "deferred".
  //
  // IT CANNOT FIRE FROM A DOOR TODAY, AND THAT IS WHY IT IS CHEAP RATHER THAN
  // WHY IT IS POINTLESS. The only other deferral is the tier line, which files
  // a row with no verified GitHub id and no co-sign — and no live door can
  // write one. Both join doors carry the identity fence in the same function as
  // their append and above it (declare.mjs § 11 — the anchor, throwing 403
  // "declaring a household needs a GitHub-verified sign-in"; residency.mjs §
  // requestResidency, the same). Every credential shape either carries `ghId`
  // or is refused there: OAuth tokens and household keys always carry it, an
  // un-cosigned berth key carries none and is bounced, a cosigned berth upgrades
  // in place to its human's id, and a static OFFICE_KEYS entry has no GitHub
  // identity at all. Nor does the berth arc open a window: `household do:
  // "begin"` PARKS the declaration on the berth row and writes no journal row
  // ("nothing is executed until the click"), and the co-sign runs the parked
  // declaration under the human's just-verified identity, so the row is born
  // anchored. Verified over real HTTP against the live doors, 2026-08-24: berth
  // boards, begins, and tries both join doors — zero rows written, zero
  // unanchored.
  //
  // So this guards the same class the foreign-class tripwire above guards, in
  // the same shape and for its own stated reason: "a hand-run migration, a
  // restored backup, a future class added to the schema before its drain half
  // exists" — plus the one it does not name, a future door that relaxes the
  // fence. It REFUSES rather than passing over, and refusing holds the ferry's
  // `&&`-joined chain on purpose, for that tripwire's own reason: a refusal
  // means the office does not understand its own log, and delivering mail on
  // top of that is building on a floor nobody has checked.
  //
  // A --dry-run reaches this before its own branch and answers the refusal
  // instead, which is the honest answer to "what would this crossing do": it
  // would refuse. The dry-run marker rides along so a caller keying on it still
  // knows nothing was ever going to be written either way.
  const stranded = gangwayHold ? [] : plan.waiting;
  if (stranded.length)
    return done({ ran: false, refused: "deferred-rows", drained: 0, counts, head,
      ...(dryRun ? { dry_run: true } : {}),
      cursor: townDrainCursor(odb), commit: null,
      // THE MESSAGE CARRIES THE REASONS, NOT JUST THE SEQS. This refusal stops
      // the crossing and therefore the mail, so it is the one line an operator
      // reads at whatever hour it fires — and a row named only by number tells
      // them a crossing broke without telling them what to do about it. Each
      // deferred row rides out with the pile's own `why`, VERBATIM: the tier
      // line's threshold is the sentence a resident was told, and an operator
      // reading a paraphrase of it would be debugging a different town.
      skipped: `the join plan defers ${stranded.length} row(s) to a later crossing and nothing is holding the cursor,`
        + ` so advancing it would walk past them and they would never be read again.`
        + ` Nothing was written and the cursor did not move: every row is still here.`
        + ` The rows, each with the reason it was deferred for — `
        + stranded.map(({ row, why }) => `${row.seq}:${row.handle ?? "(no handle)"} — ${why}`).join(" · ")
        + `. A deferral the cursor does not honour is a row dropped under a sentence promising it was kept.`,
      // the whole plan rides out, so an operator (or a --dry-run) sees what the
      // crossing would have done rather than only what stopped it
      settled: plan.settle.map((r) => r.handle),
      waiting: stranded.map(({ row, why }) => ({ seq: row.seq, handle: row.handle, why })),
      skipped_rows: plan.skipped.filter(({ row }) => row.cls === "join").map(({ row, why }) => ({ seq: row.seq, handle: row.handle, why })),
      updates: [], letters: [], remaining: rows.length });

  if (dryRun)
    return done({ ran: true, dry_run: true, date: stamp, drained: 0, counts, head,
      cursor: townDrainCursor(odb), commit: null, ...gangwayFields,
      settled: plan.settle.map((r) => r.handle), waiting: plan.waiting.map(({ row, why }) => ({ seq: row.seq, handle: row.handle, why })),
      skipped_rows: plan.skipped.filter(({ row }) => row.cls === "join").map(({ row, why }) => ({ seq: row.seq, handle: row.handle, why })),
      updates: [], letters: [], remaining: rows.length });

  // THE PEN GATE (#2040): a settle that would append a registry line refuses
  // BEFORE writing when the ledger pen cannot sign it. Refuse, never degrade —
  // an unsigned registry line is not a lesser record, it is a red the whole
  // ledger wears at the next verify, and it has cost three hand-repairs.
  // Rows stay queued, the cursor does not move, and the crossing says why.
  if (plan.plans.length) {
    const pen = drainPenReady(clone);
    if (!pen.ready)
      return done({ ran: false, refused: "ledger-pen-not-ready", drained: 0, counts, head,
        cursor: townDrainCursor(odb), ...gangwayFields,
        skipped: `the drain would append ${plan.plans.length} registry line(s) and cannot sign them — ${pen.why}. `
          + `Nothing was written and the cursor did not move: every row is still here. (#2040)`,
        settled: [], waiting: plan.settle.map((r) => ({ handle: r.handle, why: "pen not ready" })),
        updates: [], letters: [], remaining: rows.length });
  }

  const touched = await writeTownDrain(clone, plan, { date: stamp });

  // A DRAIN THAT REFUSED TO RENDER MUST NOT READ AS A QUIET CROSSING (POS-158).
  // The settled rows are in the RECORD either way — that is the durable half,
  // and the cursor is right to move past them. What can fail is the RENDERING:
  // `drainRegistry` refuses rather than shrink the registry, so if the town's
  // files hold a house the record does not, this crossing writes its rows and
  // leaves the two files un-re-rendered. That is a state a person has to clear
  // (`registry-drain --ingest-missing --reason "…"`), so it rides the report
  // rather than sitting in a return value nobody prints.
  const registryRefused = touched.refused ?? null;
  if (registryRefused) log(`drain: the registry did not re-render — ${registryRefused}`);

  // ── THE STALLED ROWS HOLD THE CURSOR (POS-158, review 2/6) ───────────
  //
  // A membership write that could not reach the record defers its row rather
  // than throwing, because a membership write must never block the town
  // (`src/town-drain.mjs` § THE RECORD FIRST, THE CARDS SECOND) — the ferry
  // chain is `&&`-joined, and a throw here stopped the mail.
  //
  // Deferring is only half of that, and the gangway's own paragraph above says
  // why the other half is not optional: `waiting` is a pile in a REPORT, and
  // this function advances the cursor to the last PENDING row regardless of
  // which pile a row landed in. A stalled row walked past is a household lost
  // while the report prints the word that promises it was kept. So the cursor
  // does not move at all while any row stalled, exactly as it does not while
  // the gangway holds one.
  const stalledRows = touched.stalled ?? [];
  if (stalledRows.length)
    log(`drain: ${stalledRows.length} row(s) could not reach the record and are still pending — the cursor is held`);

  // The join files are the only bytes the bridge itself put on disk, so they
  // are the only ones it commits. Every door below commits its own work through
  // the same pen — one commit per act, exactly as that act would have made had
  // the flag been off, which is what keeps the drain's history readable as the
  // history it replaced.
  const commit = touched.length
    ? penCommit(clone, touched.map((rel) => join(clone, rel)),
      `drain: ${plan.plans.length} settled into the town record (town log seq ≤ ${head})`)
    : null;

  // ── updates and letters, in seq order ────────────────────────────────────
  //
  // A REPLAY THAT BOUNCES IS RECORDED AND PASSED OVER — it does not stop the
  // crossing, and the choice is not obvious, so here is the whole reasoning.
  //
  // The door already judged this act when it wrote the row (validateLetter at
  // sendLetterAsRow, the paper doors' own fences), so a bounce here means the
  // town changed between the writing and the boat — a recipient who left, a
  // handle that stopped being one of yours. Rare, and possible.
  //
  // The two alternatives are both worse. Letting the throw out would leave the
  // cursor unmoved, which is correct for the row and catastrophic for the town:
  // the ferry chain is `&&`-joined, so ONE bad row would hold every crossing
  // after it, forever, and the mail would simply stop. Passing over silently
  // would be the drain deciding on its own that somebody's letter did not
  // happen.
  //
  // Recording it is safe HERE and would not be safe in the world drain, and the
  // difference is one line of SQL: the world's drain TRUNCATES (`DELETE FROM
  // journal WHERE seq <= head`), so a row it passes over is gone. This log is
  // never truncated — the cursor is the only thing that moves — so a bounced
  // row is still sitting in `town_journal` afterwards, with its seq, its
  // arguments and its defect written into this report. Nothing is lost; an
  // operator is told, and the boat sails.
  const updates = [], letters = [];
  let bounced = 0;
  const bounce = (e) => {
    bounced += 1;
    return { bounced: e?.defect ?? String(e?.message ?? e), code: e?.code ?? null };
  };

  for (const row of rows) {
    if (row.cls === "update") {
      // the resume check — see § idempotence in this file's header
      const applied = row.payload?.commits;
      if (Array.isArray(applied) && applied.length && applied.every((sha) => isAncestorOfHead(clone, sha))) {
        updates.push({ seq: row.seq, act: row.act, handle: row.handle, already: true, commits: applied });
        continue;
      }
      let entry;
      try {
        const out = replayPaperAct(row, { doors, db, clone });
        entry = out.skipped ? { skipped: out.skipped } : { commit: out.result?.commit ?? null };
      } catch (e) { entry = bounce(e); }
      updates.push({ seq: row.seq, act: row.act, handle: row.handle, ...entry });
      continue;
    }
    if (row.cls !== "letter") continue;
    const file = row.payload?.file ?? null;
    const id = row.payload?.id ?? null;
    // the resume check — see § idempotence in this file's header
    if (file && existsSync(join(clone, file))) {
      letters.push({ seq: row.seq, id, file, already: true });
      continue;
    }
    let entry;
    try {
      const out = replayLetter(row, { doors, db, clone });
      entry = out.skipped ? { skipped: out.skipped } : { commit: out.result?.commit ?? null };
    } catch (e) { entry = bounce(e); }
    letters.push({ seq: row.seq, id, file, ...entry });
  }

  // ── the first-idea sweep (the Think Tank, 2026-08-30) ────────────────────
  // Rides every crossing beside the join drain: a household's first published
  // idea mark earns its witnessed 5 (once, ever — idempotent by ledger, so a
  // re-run costs nothing; the engine of the town clone answers every law
  // question, and a clone whose engine predates the rule no-ops by name). The
  // pen gate mirrors the join half's with one difference in temper: a quest
  // mint held by an unready pen SKIPS with a name and the mail still sails —
  // refusing the whole crossing is the join half's duty, never this rider's.
  let firstIdea = null;
  try {
    const ideaPen = drainPenReady(clone);
    if (!ideaPen.ready) firstIdea = { ran: false, skipped: `pen not ready — ${ideaPen.why}` };
    else {
      const ideaPlan = planFirstIdeaSweep(clone, { date: stamp });
      if (ideaPlan.refused) firstIdea = { ran: false, skipped: ideaPlan.refused };
      else {
        const ideaTouched = writeFirstIdeaSweep(clone, ideaPlan);
        if (ideaTouched.length)
          penCommit(clone, ideaTouched.map((rel) => join(clone, rel)),
            `first-idea: ${ideaPlan.mints.length} household(s) paid for their first published idea (the Think Tank)`);
        firstIdea = { ran: true, minted: ideaPlan.mints.map((m) => ({ handle: m.handle, mark: m.mark })),
          skipped_ideas: ideaPlan.skipped, note: ideaPlan.note ?? null };
      }
    }
  } catch (e) {
    // A sweep that dies must not hold the mail — record and sail (the bounced-
    // replay reasoning above; every candidate is re-derived from the world and
    // the ledger next crossing, so passing over loses nothing).
    firstIdea = { ran: false, error: String(e?.message ?? e) };
  }

  // ── the cursor, LAST — and not at all while the gangway holds a row ──────
  if (!gangwayHold && !stalledRows.length) advanceTownCursor(odb, head);

  return done({
    ran: true, date: stamp, drained: rows.length, counts, head,
    cursor: townDrainCursor(odb), commit, first_idea: firstIdea, ...gangwayFields,
    ...(registryRefused ? { registry_refused: registryRefused } : {}),
    ...(stalledRows.length ? { store: stalledRows.map(({ row, why }) => ({ seq: row.seq, handle: row.handle, why })) } : {}),
    settled: plan.plans.map(({ row }) => row.handle),
    waiting: plan.waiting.map(({ row, why }) => ({ seq: row.seq, handle: row.handle, why })),
    // JOIN ROWS ONLY. planTownDrain reads the WHOLE pending log and files every
    // row it is not itself going to settle under "not a settling act: <act>" —
    // true from where it stands, and a lie in this report, where an update and a
    // letter row have their own replay and did in fact drain. Reporting them as
    // skipped would tell an operator that mail had been dropped on a crossing
    // that delivered it.
    skipped_rows: plan.skipped
      .filter(({ row }) => row.cls === "join")
      .map(({ row, why }) => ({ seq: row.seq, handle: row.handle, why })),
    updates, letters, bounced,
    // FROM THE CURSOR, NOT FROM `head`. The two are the same integer on every
    // crossing that advances, and they part company on one that does not: a
    // held crossing leaves rows at or below `head` still pending, and counting
    // from `head` would report `remaining: 0` over three joins that are still
    // sitting there.
    remaining: Math.max(0, townJournalHead(odb) - townDrainCursor(odb)),
  });
}
