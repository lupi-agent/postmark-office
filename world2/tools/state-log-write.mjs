#!/usr/bin/env node
// state-log-write.mjs — THE WRITER, AND THE CHECK. What puts the photograph on
// main once the drain is gone, and the reason it commits rather than leaving
// files behind.
//
// ── WHAT POS-155 MEASURED FIRST, AND IT CHANGED THE LANE ─────────────────────
//
// The lane opened on the premise that `STATE/log/<N>.journal.jsonl` is "still
// being written" and that G1 is what threatens it. Measured on world
// `origin/main` at `17fa4195` (2026-09-22), both halves of that are wrong, and
// the correction is the reason this file gained a `--check`:
//
//   `STATE/log` holds TWO FAMILIES with two pens, two grammars and two readers.
//
//     `<c>.journal.jsonl`  the DRAIN's act journal — this module's file.
//                          Last written 2026-09-11 05:45:06Z (`4d491498`,
//                          "drain: journal windows 181 … 182.2538"). 610 files,
//                          1,486 lines, 19 act types. DARK FOR ELEVEN DAYS: the
//                          store path runs no drain, so the swap already turned
//                          this off. G1 is not the threat; G1 already happened.
//
//     `<N>.jsonl`          `tools/crossing-save.mjs`'s entity/event snapshot,
//                          committed a couple of minutes after each ferry
//                          crossing (205 at 12:02:36Z, 204 at 00:04:38Z) and alive
//                          (`17fa4195`, "crossing-save 205"). Its meta carries
//                          `covers_from` / `covers_to` / `complete`; its types
//                          are `departure`, `attachment`, `emission`. A
//                          DIFFERENT FILE that happens to share a directory.
//
//   The three world-repo readers this lane was pointed at read the SECOND
//   family, not this one. All three funnel through `tools/movement-records.mjs
//   § storeRecords`, which globs `*.jsonl` — so it opens both — and then keeps
//   only `ev.type === "departure"`, a type no journal line has ever carried
//   across all 1,486 of them (the 19 are enter, exit, walk, say, amend, strike,
//   cast, leave-mark, join, leave, pass, lift, loot, take, drop, give, guard,
//   withdraw, declare-stance-on). `boarding-flip-disclosure.mjs` and
//   `position-seed-manifest.mjs` inherit that through `storeRecords` rather
//   than reading the directory themselves.
//
// The line grammar still stays the journal's, for the drain's own reason — the
// merge-by-seq in `writeJournalWindow` — but the argument for it is reuse of
// the pen, not a reader that would break.
//
// ── AND THE CANDLE WINDOW IS NOT THE FERRY CROSSING ──────────────────────────
//
// The crossing step knows `$DOCKET_WINDOW`: the CANDLE window it just closed.
// That number is not this file's key, and the two intervals do not coincide.
//
//   the candle window N   tiles 12h forward from window 150's close.
//                         `018_settlements.sql`: "S47 (2026-08-26T05:45:16Z)
//                         closed window 150 to the second"; "window 194 locked
//                         at 2026-09-17T05:45:45.550Z". 194 − 150 = 44, and
//                         2026-08-26T05:45Z + 44 × 12h = 2026-09-17T05:45Z — a
//                         rigid tile, because `clearing-job.mjs:488` opens
//                         window N+1 at window N's RECORDED close plus twelve
//                         hours, not at the instant the clearing happened to
//                         run.
//
//   the ferry crossing N  runs [epoch + N·12h, epoch + (N+1)·12h) from
//                         `src/crossings.mjs § CROSSING_EPOCH_UTC` —
//                         00:00/12:00Z. `acts.crossing` is THIS clock:
//                         `currentCrossing()` for a door act, the UNFLOORED
//                         `fractionalCrossing()` for a walk, which is why the
//                         town holds `182.journal.jsonl` beside
//                         `182.2538.journal.jsonl`.
//
// So candle window 204 is [2026-09-21T17:45Z, 2026-09-22T05:45Z) while ferry
// crossing 204 is [2026-09-22T00:00Z, 2026-09-22T12:00Z): the window straddles
// TWO crossings and is offset from both by 5.75 hours. One window's acts land
// in two journal files, and neither file is finished until the next settlement
// writes into it.
//
// That is not a defect to repair — it is exactly what the drain did, and it is
// why `writeJournalWindow` MERGES BY SEQ instead of overwriting. The 2026-09-11
// drain wrote `181.journal.jsonl` a SECOND time, adding the rows the 2026-09-10
// drain's horizon had not yet reached.
//
// So `--window N` may not be handed to `stateLogFromStore` as a crossing value,
// and the file for window N is not `N.journal.jsonl`. The rule this file holds
// instead is § WINDOW_BOUNDARY, stated from the window's own number with no
// clock read anywhere in this process.
//
// ── MY REVIEWER'S FINDING, AND IT WAS RIGHT ──────────────────────────────────
//
// Lap 1 shipped the derivation and a proposed wiring diff, and did NOT ship a
// writer — I said so and treated it as lane 3's half. My reviewer's first pass
// answered that plainly: in the store era nothing writes the photograph at all,
// so the derivation had no caller and the swap would still have gone dark.
//
// The diff I proposed was worse than absent. It wrote the windows into the
// SWEEP CLONE'S WORKING TREE and left them uncommitted, on the reasoning that
// "committing STATE is the settlement pass's act". Two things are wrong with
// that and either one refuses a crossing:
//
//   1. `settlement-sweep.mjs:892` classifies the tree before it does anything —
//      `worktreeDirt` runs `git status --porcelain --untracked-files=all`, so an
//      UNTRACKED `STATE/log/<N>.journal.jsonl` is REAL dirt, and `:893` throws
//      `settlement sweep needs a clean checkout`. My diff would have made every
//      store crossing refuse at the clean-check, by name, for a file the diff
//      itself had just written.
//
//   2. The sentence I cited says the opposite of what the deployment does.
//      `world-drain.mjs`'s note — "committing it is the settlement pass's act,
//      or pass --commit-state" — describes the DEFAULT-OFF flag. The deployed
//      chain overrides it: `deploy/settlement-auto.sh:621` says `--commit-state`
//      "is required, not optional". So on prod the drain commits STATE itself,
//      and I quoted its off-by-default caveat as though it were the practice.
//
// So the writer commits, exactly where the drain committed, by the drain's own
// pen. Nothing is left in the tree for the sweep to trip on.
//
// ── WHAT IT WILL NOT DO ──────────────────────────────────────────────────────
//
// It refuses a window the drain already photographed (`MERGE_HAZARD`): the
// register's seq is a different numbering, so re-deriving an already-written
// window ADDS a second copy of every line rather than replacing them. The
// drain's last file is `182.2538.journal.jsonl`, so every crossing value ABOVE
// 182.2538 is this pen's to own and everything at or below it is the drain's.
//
// It refuses off `main`, like the drain did, and for the drain's reason: STATE
// lives on main and the clone's checkout belongs to whoever else is using it.
//
// It writes through `world-drain.writeJournalWindow` — not a second serializer.
// That function owns the merge-by-seq and the write-through-temp-and-rename, and
// a reimplementation here is how the two would come to disagree about what a
// half-written window looks like.
//
//   WORLD2_PG_URL=… node world2/tools/state-log-write.mjs \
//     --world /path/to/sweep-clone --windows 178,178.0412 --last-drained 177.418 \
//     [--as-of-world <sha>] [--dry-run] [--json]
//
//   WORLD2_PG_URL=… node world2/tools/state-log-write.mjs \
//     --world /path/to/sweep-clone --window 204 --check      # the candle window
//   WORLD2_PG_URL=… node world2/tools/state-log-write.mjs \
//     --world /path/to/sweep-clone --window 204 --write

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { writeJournalWindow } from "../../src/world-drain.mjs";
import { compareWindow, metaFor, stateLogFromStore, windowBytes } from "../../src/state-log-from-store.mjs";
import { householdNamerFor } from "./state-log-rederive.mjs";

const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(n);

/**
 * THE FILE'S OWN FINGERPRINT, twelve hex, on every receipt line.
 *
 * Over the BYTES and not over the derived lines, because the point of it is to
 * answer "is what is on disk now what was on disk last run" without a diff —
 * and a hash of the derivation would answer a question about the register
 * instead, which is the substitution that makes a freshness stamp name a source
 * it did not come from. On a `--write` it is read back from the file after the
 * write, so it is the pen's output and not the pen's intention.
 */
export const shaOf = (bytes) => createHash("sha256").update(bytes ?? "", "utf8").digest("hex").slice(0, 12);

/**
 * THE BOUNDARY, STATED FROM THE WINDOW'S OWN NUMBER.
 *
 * Written as a sentence a caller can print, because a rule that lives only in a
 * SQL string is a rule nobody can quote back at the run that broke it. The
 * `--check` and `--write` receipts both carry it.
 */
export const WINDOW_BOUNDARY =
  "candle window N's acts are the `acts` rows whose `at` falls in the window's OWN recorded "
  + "half-open interval (opens_at, closes_at], read from the `windows` row with id = N — never "
  + "from any clock this process reads. Their FILES are named by each row's own `acts.crossing` "
  + "value, the ferry clock, because that is the drain's grouping and the photograph's key; one "
  + "window therefore writes into two journal files and `writeJournalWindow` merges by seq.";

/** A window this store does not hold is a refusal, not an empty answer. */
export const NO_SUCH_WINDOW =
  "the `windows` table holds no row with this id, so the window has no recorded boundary and "
  + "there is nothing to derive it from but a clock — which is the mis-count this rule exists to "
  + "prevent";

/**
 * THE WINDOW'S OWN EDGES, AND THE CROSSING VALUES INSIDE THEM.
 *
 * Two reads, in this order and no other:
 *
 *   1. the `windows` row, BY ID. Its `opens_at`/`closes_at` are the boundary.
 *      A missing row refuses (`NO_SUCH_WINDOW`) rather than falling back to
 *      arithmetic on the number, because the arithmetic would be a clock in
 *      disguise: window 151's `opens_at` was REPAIRED by hand
 *      (`005_candle_tiling.sql`), so the tile is a recorded fact and not a
 *      formula, and a formula would have been wrong about exactly one window
 *      and right about every other — the worst shape a boundary can have.
 *
 *   2. the DISTINCT `acts.crossing` values inside that interval, ascending.
 *      One file each, which is the drain's grouping verbatim (`planDrain`:
 *      "Grouped by the row's OWN crossing").
 *
 * `(opens_at, closes_at]` — half-open at the bottom, closed at the top — is the
 * notary's own grouping (`snapshot-export.mjs`, "(previous closed, N]") and it
 * is what makes the tiling a partition: window N's close IS window N+1's open,
 * so a row landing exactly on the boundary instant belongs to N and to nothing
 * else. An inclusive bottom would file it twice.
 */
export async function windowCrossings(client, windowId) {
  const id = Number(windowId);
  if (!Number.isInteger(id)) {
    throw new Error(`windowCrossings needs a candle window id (an integer), got ${JSON.stringify(windowId)}`);
  }
  const { rows: ws } = await client.query(
    "SELECT id, opens_at, closes_at FROM windows WHERE id = $1", [id]);
  if (!ws.length) return { window: id, refused: "no-such-window", detail: `window ${id} — ${NO_SUCH_WINDOW}` };
  const { opens_at, closes_at } = ws[0];

  const { rows } = await client.query(
    "SELECT DISTINCT crossing FROM acts"
    + " WHERE crossing IS NOT NULL AND at > $1 AND at <= $2"
    + " ORDER BY crossing", [opens_at, closes_at]);

  return {
    window: id,
    opens_at,
    closes_at,
    // Numbers, not the driver's `numeric` strings: `stateLogFromStore` refuses
    // anything `Number.isFinite` says is not a crossing value, and a string
    // that looks like one is the shape that passes here and fails three frames
    // down inside a crossing.
    crossings: rows.map((r) => Number(r.crossing)),
    boundary: WINDOW_BOUNDARY,
  };
}

/**
 * WRITE ONE CROSSING'S PHOTOGRAPH INTO A WORLD CHECKOUT, AND COMMIT IT.
 *
 * `windows` are EXACT crossing values, not integers — the drain grouped by
 * `row.crossing` verbatim, which is why the town holds `177.journal.jsonl`
 * beside `177.0872.journal.jsonl`, and this reproduces that grouping.
 *
 * Returns the same shape whether or not it committed, so a caller reading the
 * report cannot tell "wrote nothing" from "wrote and committed" by accident:
 * `state_commit` is null in exactly one case and `windows` says why.
 */
export async function writeStateLog(client, {
  world,
  windows,
  upto = null,
  asOfWorld = null,
  lastDrainedWindow = null,
  dryRun = false,
  commit = true,
  git = null,
} = {}) {
  const repo = resolve(world);
  if (!existsSync(join(repo, "WORLD"))) {
    return { refused: "world-clone", detail: `no WORLD/ under ${repo} — this is not a world checkout` };
  }
  const run = git ?? (await import("node:child_process")).execFileSync;
  const g = (...args) => String(run("git", ["-C", repo, ...args], { encoding: "utf8" })).trim();

  // The drain's own precondition, kept: STATE lives on main, and a writer that
  // switched branches to commit would be exactly the checkout this ladder
  // retires.
  const branch = g("branch", "--show-current");
  if (commit && branch !== "main") {
    return { refused: "not-on-main", detail: `the clone stands on "${branch}", not main — STATE is main's` };
  }

  const namer = householdNamerFor(repo);
  const STATE = join(repo, "STATE");
  const written = [];
  for (const w of windows) {
    const out = await stateLogFromStore(client, {
      window: w, upto, asOfWorld, householdNameFor: namer, lastDrainedWindow,
    });
    if (dryRun) {
      written.push({ crossing: out.crossing, lines: out.lines.length, wrote: [], dry_run: true,
        unnamed_households: out.unnamed_households });
      continue;
    }
    // `writeJournalWindow` is the drain's, and that reuse is the point: it owns
    // the merge-by-seq and the temp-file rename, so an interrupted write here
    // converges the same way an interrupted drain did.
    const w2 = writeJournalWindow(STATE, out.crossing, out.lines, { asOfWorld });
    written.push({ crossing: out.crossing, lines: out.lines.length, wrote: w2.wrote,
      // READ BACK FROM DISK, after the write. `writeJournalWindow` MERGES, so
      // the file may hold more lines than this run derived — an earlier
      // window's rows in the same crossing's file. A sha over `out.lines`
      // would therefore name bytes that are not the ones on disk, which is the
      // whole failure mode of a stamp that reports its input instead of its
      // output.
      sha: existsSync(w2.logPath) ? shaOf(readFileSync(w2.logPath, "utf8")) : null,
      file_lines: existsSync(w2.logPath)
        ? readFileSync(w2.logPath, "utf8").split("\n").filter((s) => s.trim()).length : 0,
      unnamed_households: out.unnamed_households });
  }

  if (dryRun || !commit) {
    return { windows: written, state_commit: null, dry_run: !!dryRun,
      state_note: dryRun ? "dry run — nothing written, nothing committed" : "written to the working set only, by the caller's request" };
  }

  // COMMITTED, BY THE DRAIN'S PEN, BEFORE THE SWEEP RUNS.
  //
  // Not left in the tree. `settlement-sweep.mjs:892` classifies the working tree
  // before it does anything and `:893` refuses on any real dirt, and an
  // untracked STATE file is real (`--untracked-files=all`). A writer that left
  // its output uncommitted would refuse the very crossing it is part of.
  const { penCommit } = await import("../../src/write.mjs");
  const message = `photograph: windows ${written.map((w) => w.crossing).join(", ")} from the register`;
  const state_commit = penCommit(repo, [STATE], message);
  return {
    windows: written,
    state_commit,
    state_note: state_commit ? null : "nothing to commit: STATE is unchanged",
  };
}

// ── THE CANDLE WINDOW'S ROUND: ONE WINDOW, ITS OWN CROSSINGS ─────────────────

/**
 * The four classes a difference can be in, and only the first three are known.
 *
 * `state-log-from-store.mjs § THE THREE THINGS THE REGISTER CANNOT GIVE BACK`
 * measured them; this names them so a `--check` line can be read at a glance by
 * somebody who has not read that header. A difference that is NOT one of the
 * three is `unexplained`, and that word is the whole point of the check: a
 * known gap is a cost the town already accepted, and anything else is a finding.
 */
export const GAP_CLASSES = Object.freeze({
  seq: "gap:seq — no store source; acts.journal_seq is null and this is the register's own id",
  at: "gap:deferred — the private-draft deferral; the register holds the putting-forward instant",
  payload: "gap:key-order — jsonb does not preserve payload key order; the values are equal",
  absent: "absent — no file on disk; the archive is dark for this crossing",
  unexplained: "UNEXPLAINED — not one of the three named gaps",
});

/** Which class a `compareWindow` cause falls in. Anything unrecognised is a finding, never a shrug. */
export function gapClassOf(cause) {
  if (cause.field === "seq" && cause.cause.startsWith("no store source")) return "seq";
  if (cause.field === "at" && cause.cause.startsWith("the private-draft deferral")) return "at";
  if (cause.field === "payload" && cause.cause.startsWith("payload key ORDER only")) return "payload";
  return "unexplained";
}

/**
 * CHECK ONE CANDLE WINDOW AGAINST WHAT IS ON DISK.
 *
 * For each crossing value inside the window, render it from the register and
 * compare with `<stateDir>/log/<crossing>.journal.jsonl` and its meta.
 *
 * THE HORIZON IS APPLIED TO BOTH SIDES, and it has to be. The derivation is
 * capped at the window's `closes_at`; the FILE is not, because the next
 * settlement will have written its later rows into the same file. Comparing an
 * uncapped file against a capped derivation would report every one of those
 * later rows as `onlyInFile` — a screenful of false findings on any window but
 * the newest. So the on-disk lines are filtered to the same horizon, and the
 * number dropped is REPORTED (`beyond_horizon`) rather than quietly discarded:
 * a filter nobody can see is a filter that will one day hide a real row.
 *
 * `byte_equal` is the strict question — are the file's bytes exactly what the
 * derivation alone renders — and it is what decides the exit code. `classes` is
 * the readable answer for when it is false.
 */
export async function checkStateLog(client, {
  world,
  stateDir = null,
  window,
  asOfWorld = null,
  lastDrainedWindow = null,
} = {}) {
  const repo = resolve(world);
  if (!existsSync(join(repo, "WORLD"))) {
    return { refused: "world-clone", detail: `no WORLD/ under ${repo} — this is not a world checkout` };
  }
  const STATE = stateDir ? resolve(stateDir) : join(repo, "STATE");
  const namer = householdNamerFor(repo);

  const w = await windowCrossings(client, window);
  if (w.refused) return w;

  const crossings = [];
  for (const c of w.crossings) {
    const out = await stateLogFromStore(client, {
      window: c, upto: w.closes_at, asOfWorld, householdNameFor: namer, lastDrainedWindow,
    });
    const logPath = join(STATE, "log", `${out.crossing}.journal.jsonl`);
    const metaPath = join(STATE, "log", `${out.crossing}.journal.meta.json`);

    if (!existsSync(logPath)) {
      crossings.push({
        crossing: out.crossing, derived_lines: out.lines.length, byte_equal: false,
        classes: { absent: 1 }, first_difference: GAP_CLASSES.absent, path: logPath,
        unnamed_households: out.unnamed_households,
      });
      continue;
    }

    const onDiskBytes = readFileSync(logPath, "utf8");
    const derivedBytes = windowBytes(out.lines);
    const byteEqual = onDiskBytes === derivedBytes
      && existsSync(metaPath)
      && readFileSync(metaPath, "utf8") === `${JSON.stringify(metaFor(out.crossing, out.lines, { asOfWorld }), null, 2)}\n`;

    // Parsed, horizon-filtered, and compared line for line. A line the file
    // holds that this cannot parse is counted rather than dropped — the drain's
    // own tolerance (`writeJournalWindow` skips an unreadable line when it
    // merges), made visible here because a check that silently ignores a line
    // is how a corrupt file reads clean.
    const fileLines = [];
    let unparsed = 0, beyondHorizon = 0;
    const horizon = Date.parse(w.closes_at instanceof Date ? w.closes_at.toISOString() : String(w.closes_at));
    for (const raw of onDiskBytes.split("\n")) {
      if (!raw.trim()) continue;
      let l;
      try { l = JSON.parse(raw); } catch { unparsed++; continue; }
      if (Date.parse(l.at) > horizon) { beyondHorizon++; continue; }
      fileLines.push(l);
    }

    // AN UNEXPLAINED DIFFERENCE OUTRANKS A KNOWN GAP IN `first_difference`, and
    // this is not a nicety. The `seq` gap is on EVERY line of every window by
    // construction, so "the first difference in order" is `seq` essentially
    // always — and the one line a reader needs, the one the register and the
    // file genuinely disagree about, would be buried under a class the town
    // already accepted. The first version of this reported literally-first and
    // the control test caught it: a mangled `class` field came back announced
    // as `gap:seq`. A summary line that leads with the known cost and hides the
    // finding is an instrument measuring the wrong thing while looking fine.
    const cmp = compareWindow(fileLines, out.lines);
    const classes = {};
    let firstKnown = null, firstUnexplained = null;
    const note = (k, text) => {
      classes[k] = (classes[k] ?? 0) + 1;
      if (k === "unexplained") { if (!firstUnexplained) firstUnexplained = text; }
      else if (!firstKnown) firstKnown = text;
    };
    for (const d of cmp.differing) {
      for (const c2 of d.causes) {
        const k = gapClassOf(c2);
        note(k, `${d.key} · ${GAP_CLASSES[k]} · field ${c2.field}`);
      }
    }
    for (const l of cmp.onlyInFile) {
      note("unexplained", `seq ${l.seq} (${l.actor} ${l.type}) · ${GAP_CLASSES.unexplained} · in the file, not in the register`);
    }
    for (const l of cmp.onlyInDerived) {
      note("unexplained", `seq ${l.seq} (${l.actor} ${l.type}) · ${GAP_CLASSES.unexplained} · in the register, not in the file`);
    }
    for (let i = 0; i < unparsed; i++) {
      note("unexplained", `a line the file holds that is not JSON · ${GAP_CLASSES.unexplained}`);
    }
    let first = firstUnexplained ?? firstKnown;
    if (!byteEqual && !first) first = "the lines pair exactly; the bytes differ — the meta, or a trailing newline";

    crossings.push({
      crossing: out.crossing, derived_lines: out.lines.length, file_lines: fileLines.length,
      beyond_horizon: beyondHorizon, unparsed, byte_equal: byteEqual,
      equal: cmp.equal, classes, first_difference: first, path: logPath,
      // BOTH SHAS, side by side. Equal is the one-glance answer; unequal names
      // which two things differ without making a reader hold a diff in their
      // head. `derived_sha` is over what this window alone renders, so on a
      // file two settlements have written it is expected to differ — the
      // classes are what say whether that difference is a cost or a finding.
      sha: shaOf(onDiskBytes), derived_sha: shaOf(derivedBytes),
      unnamed_households: out.unnamed_households,
    });
  }

  const clean = crossings.length > 0 && crossings.every((c) => c.byte_equal);
  return {
    window: w.window, opens_at: w.opens_at, closes_at: w.closes_at,
    boundary: WINDOW_BOUNDARY, crossings, clean,
    // An empty window is CLEAN-less rather than clean: nothing was compared, so
    // nothing was shown, and a check that answers "green, I looked at nothing"
    // is the starving-crossing shape one layer down.
    note: crossings.length ? null : "the window holds no acts — nothing to compare, which is not the same as clean",
  };
}

/**
 * WRITE ONE CANDLE WINDOW, whichever crossing files it lands in.
 *
 * The crossing step's entry point. Resolves the window's own crossings and
 * hands them to `writeStateLog` with the window's close as the horizon, so a
 * row belonging to the NEXT window is never pulled into this one's commit.
 */
export async function writeStateLogForWindow(client, { window, ...rest } = {}) {
  const w = await windowCrossings(client, window);
  if (w.refused) return w;
  if (!w.crossings.length) {
    return { window: w.window, windows: [], state_commit: null, boundary: WINDOW_BOUNDARY,
      state_note: "the window holds no acts — nothing to photograph" };
  }
  // THE WINDOW'S OWN VALUES WIN, AND THE SPREAD ORDER IS WHAT MAKES THAT TRUE.
  // Written `{ windows, upto, ...rest }` a caller passing `upto` would silently
  // override the window's close and pull the NEXT window's rows into this
  // commit — the boundary defeated by an argument, which is the one thing this
  // door exists to prevent. `rest` goes first so it cannot reach them.
  const out = await writeStateLog(client, { ...rest, windows: w.crossings, upto: w.closes_at });
  return { window: w.window, opens_at: w.opens_at, closes_at: w.closes_at, boundary: WINDOW_BOUNDARY, ...out };
}

// ── the CLI ──────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith("state-log-write.mjs")) {
  const url = process.env.WORLD2_PG_URL ?? "";
  const world = argOf("--world", null);
  const raw = argOf("--windows", null);
  const one = argOf("--window", null);
  const check = flag("--check");
  const write = flag("--write");

  // THE NO-ARGS LINE NAMES EVERYTHING REQUIRED, not the first thing missing.
  // `test/cli-guard.test.mjs`'s roster pins this sentence, and it pins it
  // because a misinvoked tool that answers with one requirement at a time makes
  // an operator discover the command line one failed run at a time.
  if (!world) {
    console.error("--world <checkout> is required, and one of --window <N> (a candle window) or --windows <a,b,c> (exact crossing values)");
    process.exit(2);
  }
  if (check && write) { console.error("--check and --write are two different acts; pass one"); process.exit(2); }
  if (!raw && one == null) { console.error("--windows <a,b,c> (exact crossing values) or --window <N> (a candle window) is required"); process.exit(2); }
  if (raw && one != null) { console.error("--windows and --window name the boundary two different ways; pass one"); process.exit(2); }

  // THE WHOLE COMMAND LINE IS JUDGED BEFORE A CONNECTION IS OPENED.
  //
  // These two lived inside the `try`, AFTER `client.connect()`, and that is a
  // defect rather than an ordering preference: `--window 204.5` on the box
  // would open a connection to PROD and only then discover it had been handed
  // something that is not a window id. It also reported the wrong thing — the
  // connect failed first on a scratch machine, so an argument error came back
  // as exit 1 with a connection message, and the operator is sent to the wrong
  // repair. A tool decides whether it can do the work before it reaches for
  // the register.
  const window = one == null ? null : Number(one);
  if (one != null && !Number.isInteger(window)) {
    console.error(`--window ${one} is not a candle window id — an integer from the \`windows\` table, not a crossing value (those are --windows)`);
    process.exit(2);
  }
  const windows = raw == null ? null : raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  if (raw != null && !windows.length) { console.error(`--windows ${raw} names no finite crossing value`); process.exit(2); }

  const lastDrained = argOf("--last-drained", null);
  if (lastDrained != null && !Number.isFinite(Number(lastDrained))) {
    console.error(`--last-drained ${lastDrained} is not a crossing value — an unreadable one would silently disarm MERGE_HAZARD`);
    process.exit(2);
  }
  const lastDrainedWindow = lastDrained == null ? null : Number(lastDrained);
  const asOfWorld = argOf("--as-of-world", null);

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    let out;
    if (one != null) {
      out = check
        ? await checkStateLog(client, { world, stateDir: argOf("--state-dir", null), window, asOfWorld, lastDrainedWindow })
        : await writeStateLogForWindow(client, { world, window, asOfWorld, lastDrainedWindow, dryRun: flag("--dry-run") });
    } else {
      out = await writeStateLog(client, {
        world, windows,
        upto: argOf("--upto", null),
        asOfWorld,
        lastDrainedWindow,
        dryRun: flag("--dry-run"),
      });
    }
    console.log(JSON.stringify(out, null, 2));
    // A CHECK'S EXIT CODE IS ITS VERDICT, not its health. `clean` false is a
    // real answer that ran correctly, and the crossing step is what decides
    // whether that answer may stop a crossing — it does not, this week.
    if (out.refused) process.exit(1);
    process.exit(check ? (out.clean ? 0 : 1) : 0);
  } catch (e) {
    // A refusal from `MERGE_HAZARD` is a legitimate answer, not a crash — it
    // arrives as a throw from the derivation and must exit non-zero with its
    // sentence intact rather than a stack trace the calling shell cannot read.
    console.log(JSON.stringify({ refused: "derivation", detail: String(e.message) }, null, 2));
    process.exit(1);
  } finally { await client.end(); }
}
