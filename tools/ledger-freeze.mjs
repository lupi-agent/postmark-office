#!/usr/bin/env node
// ledger-freeze.mjs — freeze the walk ledger with honor.
//
//   node tools/ledger-freeze.mjs [--at <iso>] [--world <clone>] [--db <path>]
//                                [--seed] [--set-down-ashore] [--apply]
//                                [--commit] [--json]
//
// THE CONSTITUTIONAL ACT IS NOT THIS TOOL. Dial 4 is ruled — at the movement
// cutover the ledger is frozen with honor: append stops, the file stays forever
// as the founding era's record, a PSA marks the seam, and `STATE/log/` becomes
// the movement record — but the pen that performs it is Keemin's, through
// Wright. This is the machinery that act runs, and it does nothing at all
// without `--apply`.
//
// What a freeze has to be true for, in order:
//
//   1. THE SEAM LINE. One line appended to `WORLD/walk-ledger.md`, in the
//      ledger's own voice, naming the instant and what takes over. It is the
//      last line the file will ever receive, and it says so.
//
//   2. NO WRITER REMAINS. Every codepath that can append to the ledger is
//      found and reported. A frozen file with a live writer is not frozen; it
//      is a file that has not been appended to YET, which is a different and
//      much worse thing to believe. The scan is the falsifier: it names the
//      writers and refuses while any of them can still run unflagged.
//
//   3. NOBODY MOVES ACROSS THE SEAM. The freeze changes the writer, never a
//      position. Every resident's derived position is computed on both sides —
//      the founding era's rules and Stage D's — and any resident the seam would
//      MOVE is named and the freeze REFUSES, because a constitutional act that
//      quietly teleports thirty residents is not a ceremony, it is an accident
//      with a commit message.
//
// THE THIRTY. Run against the town as it stands, check 3 fails, and the reason
// is worth stating because it is the finding this tool exists to surface. The
// 2026-08-09 return sailing was filed as ceremony lines: one walk-ledger line
// per passenger, `to the-town/the-post-office`, walking each of them onto the
// VESSEL'S OWN FOOTPRINT at the quay. Under the founding era's derivation that
// is harmless — nothing ever asked the timetable a question. Under Stage D it is
// not: standing inside her footprint at a cast-off is BOARDING (ENGINE.md, the
// first boarding rule), so the 18:00Z sailing collects all thirty and carries
// them back to Pando, and the next one brings them back, forever. The boat
// yo-yos the town.
//
// This is exactly the case ENGINE.md's SECOND boarding rule exists to prevent —
// "arrival sets you down ashore, OUTSIDE her footprint... without it, arrival
// deposits you exactly where the next departure collects" — and the ceremony pen
// simply did not apply it, because it was writing walks rather than deriving a
// ride. `--set-down-ashore` is the remedy in the rule's own words: at the seam,
// a resident whose last record leaves them standing inside a vessel's footprint
// is set down ashore beside her, exactly where the derivation would have put
// them had the ride been derived instead of written.
//
// It is OPT-IN and it is not this tool's decision to make. It restates thirty
// residents' positions, which is a doctrine call about the founding era's
// record, and the tool's job is to make the choice visible rather than to make
// it. Without the flag the freeze refuses and prints the list.
//
// TWO KEYS TURN AT ONCE, and the second one is not on the command line.
// `--apply` writes the seam line into whatever `WORLD/walk-ledger.md` the
// `--world` (or `WORLD_CLONE`) it was handed points at — and that env var is
// ordinarily set to the LIVE, SHARED world clone, because every other tool in
// this directory wants exactly that. So a single flag on a rehearsal command
// performs a constitutional act against the town's real record. (It did, the
// first time this tool was run; the write was reverted uncommitted, and this
// paragraph is what the receipt bought.)
//
// So the destructive half additionally requires `LEDGER_FREEZE=1` in the
// environment — the same shape as `TOWN_PUSH=1`, and for the same reason: the
// dangerous step should need a deliberate second sentence, in a different
// grammar, that no typo and no shell history can supply by accident. Every
// read-only path runs without it, which is the path a rehearsal wants anyway.
//
// Env: WORLD_CLONE, WORLD_MOVEMENT_V2 (the flag the freeze commits the town to),
//      LEDGER_FREEZE=1 (consent for --apply).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { WORLD_CLONE } from "../src/world-store.mjs";
import { openDynamic, putMeta } from "../src/dynamic-store.mjs";
import { readMovements } from "../src/dynamic-entities.mjs";

const argOf = (name, fallback = null) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : fallback; };
const rawFlag = (name) => process.argv.includes(name);

/** The consent gate: `--apply` needs `LEDGER_FREEZE=1` beside it, nothing else does. */
export const freezeConsented = () => process.env.LEDGER_FREEZE === "1";
const flag = (name) => (name === "--apply" ? rawFlag(name) && freezeConsented() : rawFlag(name));

const CLONE = resolve(argOf("--world", process.env.WORLD_CLONE ?? WORLD_CLONE));
const OFFICE_SRC = resolve(join(import.meta.dirname, "..", "src"));
const OFFICE_TOOLS = resolve(import.meta.dirname);
const DB_PATH = argOf("--db", null);
const JSON_OUT = flag("--json");

export const LEDGER_PATH = "WORLD/walk-ledger.md";

// ── 1. the seam line ─────────────────────────────────────────────────────────
//
// The ledger's own grammar is `- <iso> · <handle> · …` and the seam is NOT a
// departure, so it is not spelled as one: a line that parsed as a movement would
// be read as one by every tool that reads this file, forever. It is prose, in
// the ledger's voice, and `parseWalkLedger` ignores it exactly as it ignores the
// header — which is the property the freeze test checks rather than assumes.
export const freezeSeamLine = (iso) => [
  "",
  `## Frozen — ${iso}`,
  "",
  "The founding era's movement record ends here. Every line above stands: this",
  "file is the town's first way of knowing where anyone was, and it keeps that",
  "office forever. Nothing further is appended.",
  "",
  "Movement is recorded from this instant in `STATE/log/<crossing>.jsonl`, saved",
  "at every crossing, and positions derive from the store between saves. A",
  "position derived from a line above is still derived the same way, by the same",
  "arithmetic, against the geometry of its own instant — the seam changes the",
  "pen, never the past.",
  "",
].join("\n");

/** Is this ledger already frozen? The heading is the marker, and it is idempotent. */
export const isFrozen = (text) => /^##\s+Frozen\s+—\s+/m.test(String(text ?? ""));

// ── 2. no writer remains ─────────────────────────────────────────────────────
//
// Grep, not trust. Every module that can put a line into this file is found by
// what it actually does — writes the path, formats a departure, or runs the pen
// that does — and reported with the flag that stands between it and the file.
// A writer with no flag in front of it is a REFUSAL: the freeze is a promise
// about a file, and a promise with a live writer behind it is a wish.
const WRITER_SIGNS = [
  [/walk-ledger\.md/, "names the ledger file"],
  [/formatDeparture\s*\(/, "formats a ledger departure line"],
  [/appendFileSync|appendFile\b/, "appends to a file"],
];

// THE FREEZE PEN IS NOT A WRITER TO REFUSE. This file appends the seam line, so
// it matches its own scan — and naming itself as a blocker would make the freeze
// permanently impossible, which is the funniest possible way to fail. It is
// named here rather than filtered by accident, because "the one write that must
// remain" is a fact worth stating out loud.
const FREEZE_PEN = "ledger-freeze.mjs";

export function ledgerWriters(dirs = [OFFICE_SRC, OFFICE_TOOLS]) {
  const found = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".mjs") || f === FREEZE_PEN) continue;
      const text = readFileSync(join(dir, f), "utf8");
      const hits = WRITER_SIGNS.filter(([re]) => re.test(text)).map(([, why]) => why);
      if (!hits.length) continue;
      // A file that merely READS the ledger names it too — that is most of them,
      // and it is not a writer. A writer both names it and can put bytes into a
      // file, or it goes through the one exec that does.
      const writes = /appendFileSync|appendFile\b|writeFileSync/.test(text) && /walk-ledger\.md|formatDeparture\s*\(/.test(text);
      if (!writes) continue;
      found.push({
        file: `${dir.endsWith("src") ? "src" : "tools"}/${f}`,
        why: hits,
        // The gate in front of it, if any. `walk-exec.mjs` is the pen; the door
        // that runs it (`world.mjs`) is what the flag actually stands in front
        // of, so both are reported and the door's flag covers the pen.
        gated_by: /WORLD_MOVEMENT_V2|movementV2Enabled/.test(text) ? "WORLD_MOVEMENT_V2" : null,
      });
    }
  }
  return found;
}

/** Who can still reach the pen with the flag ON. The freeze's actual question. */
export function unflaggedWriters(writers, callers) {
  return writers.filter((wr) => {
    if (wr.gated_by) return false;
    // A pen nobody can call with the flag on is frozen by its caller. The caller
    // scan is passed in rather than re-derived so the test can hand it a fixture.
    return !(callers ?? []).some((c) => c.calls === wr.file && c.gated_by);
  });
}

/** Which modules run which exec, and whether they are behind the flag. */
export function execCallers(dir = OFFICE_SRC) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".mjs")) continue;
    const text = readFileSync(join(dir, f), "utf8");
    for (const m of text.matchAll(/join\(HERE,\s*"([a-z0-9-]+\.mjs)"\)/g)) {
      out.push({
        file: `src/${f}`, calls: `src/${m[1]}`,
        gated_by: /movementV2Enabled\(\)/.test(text) ? "WORLD_MOVEMENT_V2" : null,
      });
    }
  }
  return out;
}

// ── 3. nobody moves across the seam ──────────────────────────────────────────

/**
 * Every resident's derived position under BOTH eras, at one instant.
 *
 * `before` is the founding era's arithmetic — `walk.positionAt`, the ledger
 * alone, no timetable consulted. `after` is Stage D's — `vessel.positionAt`,
 * the same record read with the schedule running. A resident whose two answers
 * differ is a resident the seam would move, and the freeze names them.
 *
 * ⚑ THIS SEAM IS AGREEMENT-BLIND, AND SILENTLY SO. The world's
 * `positionAt(departure, instant, service, agreements)` takes a fourth
 * argument; the call below passes three, and `main()` passes none either, so
 * the default empty list governs every read this instrument makes. Under the
 * agreement law (Keemin, 2026-08-11; world commit 64e66ed7, "boarding is
 * declared, never inferred") an empty list means NOBODY RIDES — so today this
 * function's "0 residents moved" is the true answer, because the office holds
 * no passenger agreements at all: `declareAttachment` admits only
 * cascade|detach, and the boarding verb lands with the vessel work.
 *
 * The day that verb ships, this stops being true and nothing here will say so.
 * The seam will keep reporting "0 residents moved" while residents are being
 * carried, and no test will red, because the blindness is in the call and not
 * in the arithmetic. BEFORE the boarding verb ships, `seamDiff` must take an
 * `agreementsOf` reader and pass its rows as the fourth argument — here and at
 * `main()`. The office test that guards this pins the refusal, not the carry:
 * see `the freeze names who the seam would move` in test/world-movement.test.mjs.
 */
export function seamDiff({ departures, service, walk, vessel, atFc, toleranceM = 1 }) {
  const handles = [...new Set(departures.map((d) => d.handle))];
  const moved = [];
  for (const handle of handles) {
    // THE VESSEL IS NOT A RESIDENT AND HER MOVE IS NOT A FINDING. She is a mark
    // that moves, her position is f(timetable, clock) on both sides of the seam,
    // and reading her own ledger line as a passenger's — which is what happens
    // if she is left in this list — makes her a stowaway on herself.
    if (service && handle === service.vessel.handle) continue;
    const d = walk.currentDeparture(departures, handle);
    if (!d) continue;
    const before = walk.positionAt(d, atFc);
    const after = service ? vessel.positionAt(d, atFc, service) : before;
    if (!before || !after) continue;
    const m = Math.hypot(before.x - after.x, before.y - after.y);
    if (m > toleranceM) moved.push({
      handle,
      before: { x: before.x, y: before.y },
      after: { x: after.x, y: after.y },
      metres: Math.round(m),
      why: after.ashoreAt ? `collected by a scheduled cast-off and set down at ${after.ashoreAt}` : (after.aboard ? `aboard ${after.aboard}` : "the schedule reads this record differently"),
    });
  }
  return moved;
}

/**
 * Who is standing inside a vessel's footprint right now — the cause of every
 * entry in `seamDiff`, and the thing `--set-down-ashore` resolves.
 */
export function standingOnDeck({ departures, service, walk, vessel, geometry, atFc }) {
  if (!service) return [];
  const v = vessel.vesselPositionAt(service, atFc);
  if (!v) return [];
  const foot = vessel.footprintOf(service, { x: v.x, y: v.y });
  const out = [];
  for (const handle of [...new Set(departures.map((d) => d.handle))]) {
    if (handle === service.vessel.handle) continue;
    const d = walk.currentDeparture(departures, handle);
    if (!d) continue;
    const p = walk.positionAt(d, atFc);
    if (!p?.arrived) continue;
    if (geometry.pointInRect(p.x, p.y, foot)) out.push({ handle, at: { x: p.x, y: p.y } });
  }
  return { residents: out, footprint: foot, vessel_at: { x: v.x, y: v.y }, berthed: Boolean(v.berthed), sailing: v.sailing ?? null };
}

/**
 * Where the second boarding rule would have set them down.
 *
 * `ashoreOf` is the world's own function and it takes the sailing that BROUGHT
 * them — so the sailing to hand it is the last one that has actually ARRIVED,
 * not merely the last one that has departed. The difference is the whole answer:
 * asked at a cast-off instant, `lastSailingAtOrBefore` returns the leg just
 * beginning, and stepping ashore from a voyage that has not happened yet puts
 * thirty residents on the far side of the world. (Caught the first time this
 * tool was run: it offered to set the quay's deck down beside Pando.)
 *
 * The remedy is not a new number. It is the number the derivation would have
 * produced had the ride been derived rather than written.
 */
export function ashoreFor({ service, vessel, atFc }) {
  const arrived = vessel.sailingsBetween(service, atFc - 2 * vessel.DAY_CROSSINGS, atFc)
    .filter((s) => s.arriveFc <= atFc);
  const sailing = arrived.at(-1) ?? null;
  return sailing ? { ...vessel.ashoreOf(service, sailing), from_sailing: { departFc: sailing.departFc, to: sailing.to.markId } } : null;
}

// ── the run ──────────────────────────────────────────────────────────────────

async function main() {
  const atIso = argOf("--at", null) ?? new Date().toISOString();
  const atMs = Date.parse(atIso);
  if (!Number.isFinite(atMs)) { console.error(`unparseable --at: ${atIso}`); process.exit(2); }

  const ledgerFile = join(CLONE, LEDGER_PATH);
  if (!existsSync(ledgerFile)) { console.error(`no ledger at ${ledgerFile}`); process.exit(1); }
  const ledgerText = readFileSync(ledgerFile, "utf8");

  const T = (f) => import(pathToFileURL(join(CLONE, "tools", f)).href);
  const [walk, vessel, geometry, fold] = await Promise.all([T("walk.mjs"), T("vessel.mjs"), T("geometry.mjs"), T("marks-fold.mjs")]);
  const marks = fold.loadMarks(join(CLONE, "WORLD", "marks"));
  const service = vessel.servicesFromFold({ marks }).services[0] ?? null;
  const { departures } = walk.parseWalkLedger(ledgerText);
  const atFc = walk.fractionalCrossing(atMs);

  const writers = ledgerWriters();
  const callers = execCallers();
  const open = unflaggedWriters(writers, callers);
  const moved = seamDiff({ departures, service, walk, vessel, atFc });
  const deck = standingOnDeck({ departures, service, walk, vessel, geometry, atFc });
  const ashore = service ? ashoreFor({ service, vessel, atFc }) : null;

  const report = {
    at: atIso, at_crossing: atFc, world: CLONE,
    already_frozen: isFrozen(ledgerText),
    ledger: { lines: ledgerText.split("\n").filter((l) => l.startsWith("- ")).length, departures: departures.length, residents: new Set(departures.map((d) => d.handle)).size },
    service: service ? { mark: service.markId, vessel: service.vessel.markId, stops: service.stops.map((s) => s.markId) } : null,
    writers, writers_still_open: open,
    seam: {
      residents_moved: moved.length,
      moved: moved.slice(0, 50),
      standing_on_deck: deck.residents?.length ?? 0,
      deck_footprint: deck.footprint ?? null,
      would_be_set_down_at: ashore,
    },
  };

  const blockers = [];
  if (open.length) blockers.push(`${open.length} ledger writer(s) are not behind WORLD_MOVEMENT_V2: ${open.map((w) => w.file).join(", ")}`);
  if (moved.length && !flag("--set-down-ashore")) blockers.push(`${moved.length} resident(s) would MOVE across the seam — rerun with --set-down-ashore to apply ENGINE.md's second boarding rule to the ${deck.residents?.length ?? 0} standing inside her footprint, or resolve them by hand first`);
  report.blockers = blockers;
  report.would_freeze = blockers.length === 0;

  // The remedy, written as ordinary declared movements: a zero-distance
  // departure at the ashore point, which is the ledger's own idiom for "standing
  // here" and the store's too. Nothing bespoke, nothing that needs a reader to
  // learn a new shape — the seam produces records the same functions read.
  let seeded = null;
  // Who gets set down: everyone the seam would MOVE, not merely whoever stands
  // inside her footprint at this instant. The rehearsal ran while she was
  // berthed, when the two sets were identical; at a freeze taken while she is
  // UNDER WAY the deck is empty mid-ocean and the moved set is the real list —
  // keying on the deck alone left 27 residents deriving as carried to Pando
  // (caught live at the landing, hal at -56629,-56601).
  const setDown = new Map();
  for (const r of deck.residents ?? []) setDown.set(r.handle, r);
  for (const m of moved) if (m.handle && !setDown.has(m.handle)) setDown.set(m.handle, { handle: m.handle });
  if (flag("--apply") && flag("--set-down-ashore") && ashore && setDown.size) {
    // ── THE SET-DOWN'S PEN IS GONE, AND THIS REFUSES RATHER THAN NO-OPS ───
    //
    // This wrote a zero-length departure per set-down resident into
    // `dynamic.db/movements`. G1 (POS-156) deleted that pen: nothing reads the
    // table live any more (`storedDepartures` moved to `acts` in POS-154, the
    // entity derivation and the `<N>.jsonl` half in POS-156 part 0), so rows
    // written here would be placements no reader would ever see.
    //
    // It REFUSES by name instead of quietly writing nowhere, because the two
    // are indistinguishable from the report otherwise -- `seeded: {set_down:
    // 27}` over a table nobody reads is the worst of the three outcomes. The
    // freeze itself already happened (2026-08-10) and this arm is a one-off
    // whose event has passed; if it is ever needed again it writes the record
    // through `walkEntry` + `appendJournal`, the way `world-apex.mjs §
    // spawnOnEnter` does since G1.
    const db = openDynamic(DB_PATH ?? undefined);
    try {
      const already = new Set(readMovements(db).map((m) => `${m.actor}|${m.at}`));
      const owed = [...setDown.values()].filter((r) => !already.has(`${r.handle}|${atIso}`));
      report.seeded = null;
      report.set_down_refused = owed.length === 0
        ? "nothing owed — every resident in the set-down set already has a departure at this instant"
        : `REFUSED: ${owed.length} resident(s) would need a set-down departure, and G1 (POS-156) deleted the `
          + "`dynamic.db/movements` pen this arm wrote through. Rows written there now would be placements no "
          + "reader sees. Port this arm to the record (`walkEntry` + `appendJournal`, as world-apex.mjs § "
          + "spawnOnEnter does) before running it again.";
      if (owed.length) { console.error(report.set_down_refused); }
      else { putMeta(db, "ledger_frozen_at", atIso); putMeta(db, "ledger_freeze_set_down", "0"); }
    } finally { db.close(); }
  }

  if (flag("--apply") && !report.would_freeze && !(flag("--set-down-ashore") && seeded)) {
    report.applied = false;
    report.refused = "the freeze refuses while a blocker stands";
  } else if (flag("--apply")) {
    if (isFrozen(ledgerText)) { report.applied = false; report.refused = "already frozen — the seam line is idempotent and is not written twice"; }
    else {
      writeFileSync(ledgerFile, `${ledgerText.replace(/\s*$/, "\n")}${freezeSeamLine(atIso)}`, "utf8");
      report.applied = true;
      if (flag("--commit")) {
        execFileSync("git", ["-C", CLONE, "add", LEDGER_PATH], { encoding: "utf8" });
        execFileSync("git", ["-C", CLONE, "commit", "-q", "-m",
          `the walk ledger is frozen with honor — ${atIso}\n\nThe founding era's movement record closes. STATE/log/ takes over.\nRuled: dial 4 of the world-graph proposal, 2026-08-09.`], { encoding: "utf8" });
        report.commit = execFileSync("git", ["-C", CLONE, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      }
    }
  } else {
    report.applied = false;
    report.dry_run = rawFlag("--apply") && !freezeConsented()
      ? `--apply was passed but LEDGER_FREEZE=1 was not set — nothing was written to ${ledgerFile}. The freeze is a constitutional act and needs the second key.`
      : "nothing was written — pass --apply (with LEDGER_FREEZE=1) to perform the freeze";
  }

  if (JSON_OUT) { console.log(JSON.stringify(report, null, 2)); return report; }
  console.log(`ledger-freeze · ${atIso} (crossing ${atFc.toFixed(4)})`);
  console.log(`  ledger    ${report.ledger.lines} lines · ${report.ledger.departures} departures · ${report.ledger.residents} residents${report.already_frozen ? " · ALREADY FROZEN" : ""}`);
  console.log(`  writers   ${writers.length} found${writers.length ? `: ${writers.map((w) => `${w.file}${w.gated_by ? ` [${w.gated_by}]` : " [UNGATED]"}`).join(", ")}` : ""}`);
  console.log(`  seam      ${moved.length} resident(s) would move · ${deck.residents?.length ?? 0} standing inside her footprint`);
  if (ashore) console.log(`  ashore    the second boarding rule would set them down at ${ashore.x},${ashore.y}`);
  for (const m of moved.slice(0, 5)) console.log(`    · ${m.handle}  ${m.before.x},${m.before.y} → ${m.after.x},${m.after.y}  (${m.metres} m — ${m.why})`);
  if (moved.length > 5) console.log(`    · …and ${moved.length - 5} more`);
  for (const b of blockers) console.log(`  BLOCKER   ${b}`);
  if (seeded) console.log(`  set down  ${seeded.set_down} resident(s) declared standing at ${seeded.at.x},${seeded.at.y}`);
  if (report.dry_run) console.log(`  dry run   ${report.dry_run}`);
  if (report.refused) console.log(`  refused   ${report.refused}`);
  const verdict = report.applied ? "FROZEN"
    : report.already_frozen ? "ALREADY FROZEN — the seam line is written once"
      : report.would_freeze ? "ready — pass --apply with LEDGER_FREEZE=1" : "REFUSED";
  console.log(`  verdict   ${verdict}${report.commit ? ` · ${report.commit.slice(0, 12)}` : ""}`);
  return report;
}

if (process.argv[1]?.endsWith("ledger-freeze.mjs")) {
  main().catch((e) => { console.error(`ledger-freeze tripped: ${String(e?.stack ?? e)}`); process.exit(9); });
}
