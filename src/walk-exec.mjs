// walk-exec.mjs — one departure, appended, under the caller's flock.
//
// Same shape as leave-exec: the caller wraps this in `flock -w 30 town.lock` so a
// departure can never race a crossing or another write. The office pen is the
// SINGLE writer of the movement ledger, and it writes at verb time — a departure
// is recorded when it is declared, not on the ferry's cadence.
//
// It appends ONE LINE and commits. Nothing else: no arrival record, no en-route
// state, no world-state regeneration — position is derived by every reader from
// (record, clock), so there is nothing else to persist. That is why this exec is
// so much smaller than leave-exec.
//
// The grammar travels with the clone: `tools/walk.mjs` is imported from the
// CLONE, exactly as leave-exec imports the clone's placementParent. The enforcer
// and the record must agree, and the clone owns both.
//
// Env: WORLD_CLONE, TOWN_PUSH=1 to push, BOT_NAME/BOT_EMAIL (penCommit's).
// Exit 0 with { line, at, position, commit, pushed } or { error }.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { penCommit } from "./write.mjs";
import { singleLogEnabled } from "./dynamic-store.mjs";
import { CLASS_MOVE, appendActFlipped, appendJournal, laneFlipped, settleShadowPens } from "./world-journal.mjs";
import { departurePace } from "./world-classes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLONE = process.env.WORLD_CLONE ?? resolve(HERE, "..", "world-clone");
// The repo-relative name rides the journal row so the save knows which public
// ledger the lines belong in without inferring it from the verb.
export const LEDGER_NAME = "WORLD/walk-ledger.md";
const LEDGER = join(CLONE, LEDGER_NAME);

// THE SHADOW PENS ARE DRAINED BEFORE THIS PROCESS ENDS (2026-08-28) — the same
// escape crossing-exec had, and the same fix; world-journal.mjs § THE ESCAPE
// carries the argument. This lane is the FLAG-OFF walk (WORLD_MOVEMENT_V2
// unset), which has not run on dev since movement-v2 shipped — but a pen that
// loses acts when it does run is not made safe by being quiet.
const answer = async (obj) => {
  await settleShadowPens();
  console.log(JSON.stringify(obj));
  process.exit(0);
};
const err = (code, defect, hint) => answer({ error: { code, defect, hint } });

const LEDGER_HEADER = `# Walk ledger

Append-only. One line per DEPARTURE; position is a pure function of the line and
the clock, so nothing en-route is ever written here and no arrival is recorded.
Superseding a walk is a new departure from the derived position — latest wins.
Stopping is a zero-distance departure.

Grammar: \`- <iso> · <handle> · from <x>,<y> · toward <x>,<y> · at <fractional-crossing>[ · within <w>,<h>][ · to <mark-id>]\`

The optional \`within <w>,<h>\` freezes the target's arrival rect; the trailing
\`to <mark-id>\` records what was ASKED FOR. Derivation never re-resolves the id —
the centre and extent are already on the line — so a mark that later moves,
resizes, or retires cannot rewrite where someone walked.
`;

async function main() {
  const p = JSON.parse(process.argv[2] ?? "{}");
  if (!existsSync(join(CLONE, "WORLD"))) return err(409, "not-yet-open", "the office has no world clone");

  const { formatDeparture, parseWalkLedger, positionAt, fractionalCrossing } =
    await import(pathToFileURL(join(CLONE, "tools", "walk.mjs")));

  // The walk ledger is PUBLIC record on main. The pens share this clone and a
  // draft exec may have left the checkout on a household branch — the
  // wandering-pen incident (2026-07-30) stranded 17 public ledger lines on
  // draft/jennuhh. Stand on main explicitly before touching the ledger.
  try { execFileSync("git", ["-C", CLONE, "switch", "-q", "main"], { encoding: "utf8" }); }
  catch (e) { return err(500, "the world clone would not stand on main", String(e?.message ?? e).slice(0, 160)); }
  if (process.env.TOWN_PUSH === "1")
    try { execFileSync("git", ["-C", CLONE, "pull", "--rebase", "-q"], { encoding: "utf8" }); } catch { /* offline/behind — serve local */ }

  for (const k of ["handle", "from", "toward"]) if (!p[k]) return err(422, `missing ${k}`, "the door fills these in; this exec is not a public surface");

  const at = Number.isFinite(p.at) ? p.at : fractionalCrossing();

  // The stride is LAW ON THE RECORD (decision 008b, 2026-08-16): the departure
  // class's own dial, read at act time and stamped on the leg — amending the
  // mark changes future departures only; no in-flight walker ever re-derives.
  // Fallback is LOUD (dial_fallback in the answer) and falls to the clone's
  // pre-008b constant via an unstamped line — never a silent second law.
  // Sanity bounds are interim until the dial registry lands (the params
  // migration); the record owns the value, this guards only absurdity.
  // one owner: departurePace (world-classes) — this inline copy asking
  // "departure" was the second body of the 2026-08-21 slow-walk bug.
  const pace = departurePace();
  const dialFallback = pace == null;

  const line = formatDeparture({
    handle: p.handle, from: p.from, toward: p.toward, at,
    targetExtent: p.targetExtent ?? null,
    targetMarkId: p.targetMarkId ?? null,
    pace,
  });

  // Read the ledger as it stands. Both lanes need it: the git lane appends to
  // it, and the journal lane derives this walk's position from it WITHOUT
  // writing, because a walk's position is a function of the ledger plus this
  // line whether or not the line is on disk yet.
  const prev = existsSync(LEDGER) ? readFileSync(LEDGER, "utf8") : LEDGER_HEADER;
  const sep = prev.endsWith("\n") ? "" : "\n";
  const withThisWalk = `${prev}${sep}${line}\n`;

  // ── SETTLE AT THE SAVE (ruled 2026-08-22; built behind WORLD_SINGLE_LOG) ───
  //
  // "walks + enter-exit should settle at the save, not per-act to git main."
  //
  // Every walk used to spend one commit on main. Under the flag the line goes
  // into the journal — carried VERBATIM, so the save appends exactly what this
  // pen formatted rather than re-deriving it — and the record receives it at the
  // save with everything else.
  //
  // The DERIVATION IS UNCHANGED, deliberately: the answer's `position` is parsed
  // from the same ledger text either way, one copy of which happens not to be on
  // disk yet. A second position derivation for the journal lane is exactly the
  // split-brain this office keeps a museum of.
  if (singleLogEnabled()) {
    const { departures: dep, unrecognized: unrec } = parseWalkLedger(withThisWalk);
    const mine = dep.filter((d) => d.handle === p.handle).pop();
    let seq = null;
    const entry = {
      crossing: at, actor: p.handle, action: "walk", object: p.targetMarkId ?? null,
      cls: CLASS_MOVE, at: null, witnesses: null,
      payload: { ledger: LEDGER_NAME, lines: [line], toward: p.toward, pace },
      effect: "the walk is declared; the record receives it at the save",
    };
    {
      // LANE THREE OF THE PEN FLIP on the flag-off arm (W2_PEN=walk; runbook C3):
      // here the journal IS the 1.0 pen, so appendActFlipped's own ordering —
      // Postgres first, awaited, the journal row after — is the whole shape.
      // An unreachable pen is the ruled refusal and nothing was written.
      // ── BOTH ARMS REFUSE NOW (G1 / POS-156, RULING 3) ───────────────────
      //
      // The unflipped arm was `appendJournal(db, entry).seq` — a sqlite row
      // written here and a Postgres copy queued behind it. The sqlite row is
      // gone, so that call awaits the record and throws exactly as the flipped
      // one does, and this door's refusal is one sentence for both. It names no
      // flag: `W2_PEN` decides which function writes, not whether the record is
      // the record.
      try {
        const row = laneFlipped("walk")
          ? await appendActFlipped(null, entry)
          : await appendJournal(null, entry);
        seq = row.actId;   // the record's own sequence; there is no sqlite rowid left
      } catch (e) {
        if (e?.name === "PenUnreachableError")
          return err(503, e.message, "this door's pen is the office's record; when it cannot be reached the door refuses rather than writing anywhere else — you are exactly where you were, and the walk is safe to declare again");
        throw e;
      }
    }
    return answer({ line, at, position: positionAt(mine, at), commit: null, pushed: false, push_error: null,
                    pace, ...(dialFallback ? { dial_fallback: true } : {}),
                    log: "acts", seq,
                    settles: "at the save — this walk spends no commit of its own (WORLD_SINGLE_LOG)",
                    ledger_lines: dep.length, ledger_unrecognized: unrec.length });
  }

  // Append. Read-then-write of a file only this pen writes, under the caller's
  // flock — the append-only line is what keeps this safe without a merge.
  writeFileSync(LEDGER, withThisWalk, "utf8");

  const { departures, unrecognized } = parseWalkLedger(readFileSync(LEDGER, "utf8"));
  const mine = departures.filter((d) => d.handle === p.handle).pop();
  const position = positionAt(mine, at);

  const commit = penCommit(CLONE, [LEDGER],
    `walk: ${p.handle} departs for ${Math.round(p.toward.x)},${Math.round(p.toward.y)}${p.targetMarkId ? ` (${p.targetMarkId})` : ""} (via world_walk)`);

  let pushed = false, push_error = null;
  if (process.env.TOWN_PUSH === "1" && commit) {
    try { execFileSync("git", ["-C", CLONE, "push", "-q", "origin", "main"], { encoding: "utf8" }); pushed = true; }
    catch (e) { push_error = String(e?.message ?? e).slice(0, 200); }
  }

  return answer({ line, at, position, commit, pushed, push_error,
           pace, ...(dialFallback ? { dial_fallback: true } : {}),
           ledger_lines: departures.length,
           ledger_unrecognized: unrecognized.length });
}

main().catch((e) => err(500, "the walk pen tripped", String(e?.message ?? e).slice(0, 300)));
