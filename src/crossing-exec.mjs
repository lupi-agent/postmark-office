// crossing-exec.mjs — one crossing, appended, under the caller's flock.
//
// DEMO SLICE (gold plan postmark-world-view-system, step 5 — the enter/exit
// pair, ruled in the 2026-08-18 wind-down and NOT yet planted in LOGOS). This
// file exists on `jetto/enter-exit-demo` and merges nowhere: verbs-before-law
// would break the TDD method, so the pen is written and left standing.
//
// It is walk-exec.mjs's sibling and deliberately its twin, because a crossing
// is the same KIND of fact as a departure: declared once, at the moment it is
// declared, into an append-only public record — and everything after it derives.
// Occupancy is never stored. The `contains` edge with the entity child that R14
// makes a crossing MEAN is derived from these lines by tools/thresholds.mjs, in
// every reader, exactly as position is derived from the walk ledger's.
//
// It appends ONE OR MORE lines and commits: one per link of the chain, because
// deep entry is a chain of crossings and each link is separately adjudicated —
// so a chain that was refused at its third door writes two crossings and a
// refusal, which is precisely what happened and precisely what the record
// should hold.
//
// The grammar travels with the clone (`tools/thresholds.mjs` imported FROM the
// world clone, as walk-exec imports the clone's walk.mjs): the enforcer and the
// record must agree, and the clone owns both.
//
// Env: WORLD_CLONE, TOWN_PUSH=1 to push, BOT_NAME/BOT_EMAIL (penCommit's).
// Exit 0 with { lines, at, within, commit, pushed } or { error }.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { penCommit } from "./write.mjs";
import { singleLogEnabled } from "./dynamic-store.mjs";
import { CLASS_FRAME, appendActFlipped, appendJournal, laneFlipped, settleShadowPens } from "./world-journal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.WORLD_CLONE ?? resolve(HERE, "..", "world-clone");
// THE LEDGER THIS PEN'S LINES BELONG TO. The row carries this path so the
// deriver can find its lines again; the deriver reads the retired name too, so
// rows written by an office that predates the rename are not orphaned by it.
export const LEDGER_NAME = join("WORLD", "enter-exit-ledger.md");
export const LEGACY_LEDGER_NAME = join("WORLD", "threshold-ledger.md");

// THE SHADOW PENS ARE DRAINED BEFORE THIS PROCESS ENDS (2026-08-28). This pen
// writes a journal row and then kills its own process; `mirrorAct` is
// fire-and-forget, so the unawaited INSERT used to die here with the socket and
// every enter/exit went missing from `acts` in silence. See world-journal.mjs
// § THE ESCAPE for the whole argument, including why the wait is capped.
//
// `answer` is async now and every call site sits inside `main`, whose returned
// promise keeps the loop alive until the exit actually runs.
const answer = async (obj) => {
  await settleShadowPens();
  console.log(JSON.stringify(obj));
  process.exit(0);
};
const err = (code, defect, hint) => answer({ error: { code, defect, hint } });

async function main() {
  const p = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(join(CLONE, "WORLD"))) return err(409, "not-yet-open", "the office has no world clone");
  // The git lane (flag off) appends to whichever ledger this clone actually
  // keeps, so a pre-rename clone is not forked into two records.
  const LEDGER = existsSync(join(CLONE, LEDGER_NAME)) || !existsSync(join(CLONE, LEGACY_LEDGER_NAME))
    ? join(CLONE, LEDGER_NAME)
    : join(CLONE, LEGACY_LEDGER_NAME);

  // BOTH MODULE NAMES, for the window in which this office and its world clone
  // are on different sides of the `thresholds.mjs` → `enter-exit.mjs` rename.
  // A pen that cannot read a clone one pull behind refuses every passage in the
  // town for the length of that gap.
  const law = await import(pathToFileURL(join(CLONE, "tools", "enter-exit.mjs")))
    .catch(() => import(pathToFileURL(join(CLONE, "tools", "thresholds.mjs"))))
    .catch(() => null);
  if (!law) return err(501, "this world clone has no enter/exit grammar",
    "tools/enter-exit.mjs (or the retired tools/thresholds.mjs) is the pair's record law and it travels with the clone — a clone without it cannot be entered");
  const { occupancyAt, LEDGER_HEADER } = law;
  const parseEnterExitLedger = law.parseEnterExitLedger ?? law.parseThresholdLedger;

  if (!Array.isArray(p.lines) || !p.lines.length) return err(422, "no crossing to record", "the door fills these in; this exec is not a public surface");
  if (!p.handle) return err(422, "missing handle", "the door fills these in; this exec is not a public surface");

  // ── SETTLE AT THE SAVE (ruled 2026-08-22; built behind WORLD_SINGLE_LOG) ───
  //
  // "walks + enter-exit should settle at the save, not per-act to git main."
  //
  // Every crossing used to spend one commit on main. Under the flag the lines go
  // into the journal — VERBATIM, so the save appends exactly what this pen
  // formatted — and the record receives them at the save. The occupancy answer
  // is derived from the same ledger text either way; one copy of it simply is
  // not on disk yet.
  //
  // AND THE CHECKOUT STAYS WHERE IT IS. The `switch -q main` below exists
  // because this pen writes a file into the working tree and the clone is shared
  // (the 2026-07-30 wandering-pen incident: 17 public ledger lines stranded on
  // draft/jennuhh). Writing nothing, this lane needs no checkout at all — which
  // is the same machinery §2 retires everywhere else, gone from one more door.
  const prevJ = existsSync(LEDGER) ? readFileSync(LEDGER, "utf8") : LEDGER_HEADER;
  if (singleLogEnabled()) {
    const sepJ = prevJ.endsWith("\n") ? "" : "\n";
    const { acts: actsJ, unrecognized: unrecJ } = parseEnterExitLedger(`${prevJ}${sepJ}${p.lines.join("\n")}\n`);
    let seq = null;
    const entry = {
      crossing: p.at, actor: p.handle, action: p.act ?? "enter", object: p.mark ?? null,
      cls: CLASS_FRAME, at: null, witnesses: null,
      payload: {
        ledger: LEDGER_NAME.replace(/\\/g, "/"), lines: p.lines, summary: p.summary,
        // ── THE PORTAL'S THREE FIELDS (#2986, 2026-09-19) ──────────────────
        // `via` is which door of a vehicle you came in by; `set_down_at` and
        // `arrived` are where an exit put you and whether the ride had come due.
        // They are FIELDS and not prose because the deposit rule reads them back
        // — a door that had to parse its own summary sentence to find a machine
        // fact is the class this office keeps a museum of. Spread conditionally
        // so a crossing that is not a portal's writes the payload it always
        // wrote, byte for byte.
        ...(p.via ? { via: String(p.via) } : {}),
        ...(p.set_down_at ? { set_down_at: String(p.set_down_at) } : {}),
        ...(p.arrived == null ? {} : { arrived: Boolean(p.arrived) }),
      },
      effect: "the crossing is declared; the record receives it at the save",
    };
    {
      // LANE FIVE OF THE PEN FLIP (W2_PEN=frame; runbook C5, 2026-09-03 — after
      // DEC-5 was ruled: occupancy implies geometry, never the reverse). Under
      // WORLD_SINGLE_LOG the journal IS the frame lane's 1.0 pen, so
      // appendActFlipped's own ordering — Postgres first, awaited, the journal
      // row after — is the whole shape. An unreachable pen is the ruled refusal
      // and nothing was written: the resident is exactly where they were.
      // ── BOTH ARMS REFUSE NOW (G1 / POS-156, RULING 3) ───────────────────
      //
      // The unflipped arm was `appendJournal(db, entry).seq` — a sqlite row
      // written here and a Postgres copy queued behind it. The sqlite row is
      // gone, so that call awaits the record and throws exactly as the flipped
      // one does, and this door's refusal is one sentence for both. It names no
      // flag: `W2_PEN` decides which function writes, not whether the record is
      // the record, and a 503 that blamed an unset variable would send an
      // operator to the wrong place.
      try {
        const row = laneFlipped("frame")
          ? await appendActFlipped(null, entry)
          : await appendJournal(null, entry);
        // `seq` IS THE ACT'S ID NOW. There is no sqlite rowid to answer with;
        // the record's own sequence is the one sequence left.
        seq = row.actId;
      } catch (e) {
        if (e?.name === "PenUnreachableError")
          return err(503, e.message, "this door's pen is the office's record; when it cannot be reached the door refuses rather than writing anywhere else — you are exactly where you were, and the crossing is safe to declare again");
        throw e;
      }
    }
    return answer({ lines: p.lines, at: p.at, within: occupancyAt(actsJ, p.at).get(p.handle) ?? [],
                    commit: null, pushed: false, push_error: null, log: "acts", seq,
                    settles: "at the save — this crossing spends no commit of its own (WORLD_SINGLE_LOG)",
                    ledger_lines: actsJ.length, ledger_unrecognized: unrecJ.length });
  }

  // ── A THIRD PEN, DORMANT — READ THIS BEFORE TURNING THE FLAG OFF (#2152) ──
  //
  // Everything below writes a passage line into the committed ledger and commits
  // it, per act. That is the PRE-FLAG lane, and prod has run WORLD_SINGLE_LOG=1
  // since 2026-08-24, so it has not executed since.
  //
  // It must not execute again as written. The record is DERIVED now — the
  // committed copy is the frozen era, the live era comes from the journal at
  // read time — and the world repo's falsifier refuses a longer file: "the world
  // repo has no journal to read — a longer derived file means a hand wrote in
  // it". Two office pens that did exactly this were removed on 2026-08-28 (the
  // crossing-save's emit, and the drain's routing) after three hand-repairs on
  // world main. This one survives only because the flag it sits behind is on.
  //
  // Left standing rather than cut because cutting it is a decision about what
  // the flag-off lane MEANS with no file to write to, and World 2.0's database
  // migration answers that question. Turning WORLD_SINGLE_LOG off before then
  // re-plants the bug.
  //
  // The threshold ledger is PUBLIC record on main, exactly as the walk ledger
  // is — and for exactly the reason walk-exec stands on main explicitly: the
  // pens share this clone and a draft exec may have left the checkout on a
  // household branch. (2026-07-30, the wandering-pen incident: 17 public ledger
  // lines stranded on draft/jennuhh.)
  try { execFileSync("git", ["-C", CLONE, "switch", "-q", "main"], { encoding: "utf8" }); }
  catch (e) { return err(500, "the world clone would not stand on main", String(e?.message ?? e).slice(0, 160)); }
  if (process.env.TOWN_PUSH === "1")
    try { execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" }); } catch { /* offline/behind — serve local */ }

  const prev = existsSync(LEDGER) ? readFileSync(LEDGER, "utf8") : LEDGER_HEADER;
  const sep = prev.endsWith("\n") ? "" : "\n";
  writeFileSync(LEDGER, `${prev}${sep}${p.lines.join("\n")}\n`, "utf8");

  const { acts, unrecognized } = parseEnterExitLedger(readFileSync(LEDGER, "utf8"));
  const within = occupancyAt(acts, p.at).get(p.handle) ?? [];

  const what = p.lines.length === 1 ? p.summary : `${p.summary} (${p.lines.length} crossings)`;
  const commit = penCommit(CLONE, [LEDGER], `crossing: ${p.handle} ${what} (via world_${p.act ?? "enter"})`);

  let pushed = false, push_error = null;
  if (process.env.TOWN_PUSH === "1" && commit) {
    try { execFileSync("git", ["-C", CLONE, "push", "-q", "origin", "main"], { encoding: "utf8" }); pushed = true; }
    catch (e) { push_error = String(e?.message ?? e).slice(0, 200); }
  }

  return answer({ lines: p.lines, at: p.at, within, commit, pushed, push_error,
           ledger_lines: acts.length, ledger_unrecognized: unrecognized.length });
}

// A push that cannot land (penCommit's NOT_LANDED, POS-296) is answered in its own
// words: penCommit has already taken the line back out of the ledger and unmade
// the commit, so the resident is exactly where they were and may declare again.
main().catch((e) => e?.pen
  ? err(e.code, e.defect, e.hint)
  : err(500, "the crossing pen tripped", String(e?.message ?? e).slice(0, 300)));
