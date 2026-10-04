// birthday-flips.mjs — proof that the birthday lane's falsifiers CAN fail.
//
// Same discipline as the world repo's reached-grants-flips.mjs: break ONE law
// in the SOURCE, run the suite, and require that the test NAMED beside it is
// the one that goes red. A flip that comes back green is reported as an
// apparatus failure, because a green suite under a broken law is a hole.
//
// Run: node tools/birthday-flips.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const GRANTS = "src/world-grants.mjs";
const EMB = "src/embodiment.mjs";
const APEX = "src/world-apex.mjs";
// The encounter fold and the arena door closed on 2026-09-30 (Keemin: the arena
// is not live and will be rebuilt, not ported), and their flips went with them.
const SUITES = {
  [GRANTS]: "test/world-grants.test.mjs",
  [EMB]: "test/embodiment.test.mjs",
  // The apex's own suite is in this runner for ONE reason: it is what caught
  // the ground channel minting poorer entries than the ambient one, and a
  // regression guard nobody has watched fail is a regression guard on trust.
  [APEX]: "test/world-apex.test.mjs",
};

const FLIPS = [
  // ── the calculus ────────────────────────────────────────────────────────
  // ── the seat (founder-ruled 2026-08-29) ─────────────────────────────────

  { name: "seating stops seating — a human in a portal ground gets only the portal's verbs",
    file: GRANTS, catches: "seats them whole",
    edit: (t) => t.replace("  if (!seat) return { ...first, seated: null };", "  if (true) return { ...first, seated: null };") },

  { name: "seating is read off the CANDIDATES — a guest's human is seated in a stranger's garden",
    file: GRANTS, catches: "not seated by a stranger's ground",
    edit: (t) => t.replace("(first.admitted ?? first.entries).filter((e) => e.channel === \"ground\")", "candidates.filter((e) => e.channel === \"ground\")") },

  { name: "an AMBIENT grant seats a human — the seat leaks world-wide",
    file: GRANTS, catches: "seats them whole",
    edit: (t) => t.replace('.filter((e) => e.channel === "ground")', ".filter(() => true)") },

  { name: "the human's own grant is overwritten by the resident's",
    file: GRANTS, catches: "seats them whole",
    edit: (t) => t.replace("    if (!byAction.has(e.action)) byAction.set(e.action, { ...e, via_seat: true });",
                           "    byAction.set(e.action, { ...e, via_seat: true });") },

  { name: "a seat-borrowed act stops saying it was borrowed",
    file: GRANTS, catches: "seats them whole",
    edit: (t) => t.replace("byAction.set(e.action, { ...e, via_seat: true });", "byAction.set(e.action, { ...e });") },

  { name: "the answer stops naming the ground that seated them",
    file: GRANTS, catches: "seats them whole",
    edit: (t) => t.replace("    seated: seat.ground ?? seat.from ?? null,", "    seated: null,") },

  { name: "the seat repeal fires for an UNSEATED human — the fence is gone rather than amended",
    file: EMB, catches: "the seat repeals the exit refusal",
    edit: (t) => t.replace("  if (seated) return { ok: true, seated };", "  return { ok: true, seated };") },

  { name: "the seat stops repealing the exit refusal — the room has no door again",
    file: EMB, catches: "the seat repeals the exit refusal",
    edit: (t) => t.replace("  if (seated) return { ok: true, seated };", "") },

  // ── the silent kind-drop (found live 2026-08-29, the founder's exit) ─────
  { name: "a kind mismatch goes back to being dropped in silence",
    file: GRANTS, catches: "a kind mismatch is REFUSED with a reason",
    edit: (t) => t.replace("      refused.push({ ...e, refused: `this door is ${kindOf(e) === \"resident\" ? \"a resident's\" : `for a ${kindOf(e)}`}, and you are acting as ${kind === \"human\" ? \"a human\" : `a ${kind}`}` });", "") },

  { name: "the kind refusal stops naming which kind the door is for",
    file: GRANTS, catches: "a kind mismatch is REFUSED with a reason",
    edit: (t) => t.replace("refused: `this door is ${kindOf(e) === \"resident\" ? \"a resident's\" : `for a ${kindOf(e)}`}, and you are acting as ${kind === \"human\" ? \"a human\" : `a ${kind}`}`", "refused: `not your door`") },

  { name: "the kind fence stops fencing — a human is admitted through a resident's grant",
    file: GRANTS, catches: "a kind mismatch is REFUSED with a reason",
    edit: (t) => t.replace("    if (kindOf(e) !== String(kind)) {", "    if (false) {") },

  // Retargeted 2026-08-29: the bare `continue` grew a body when the kind
  // mismatch started recording a refusal, and this flip went silently inert —
  // the third such retarget this lane, and the same lesson each time. It now
  // shares its mutation with "the kind fence stops fencing" above; one break,
  // two guards, and they catch it through different assertions on purpose.
  { name: "an absent for: becomes a wildcard (the 914ddc26 widening, in code)",
    file: GRANTS, catches: "a human is not admitted through a resident's grant",
    edit: (t) => t.replace("    if (kindOf(e) !== String(kind)) {", "    if (false) {") },

  { name: "the kind default flips from resident to anybody",
    file: GRANTS, catches: "an absent for: reads as RESIDENT",
    edit: (t) => t.replace('String(entry?.for ?? "resident")', 'String(entry?.for ?? "any")') },

  { name: "a parcel instance stops resolving to the parcel class (the eleven-day gap, restored)",
    file: GRANTS, catches: "a mark with no class: is an instance of the class its KIND names",
    edit: (t) => t.replace('if (kind === "parcel") return "parcel";', "") },

  { name: "a class DECLARATION resolves as an instance of itself",
    file: GRANTS, catches: "a class mark standing in the works is a DECLARATION",
    edit: (t) => t.replace("if (row.declares) return null;", "") },

  { name: "own-ground stops checking the household (every guest's human walks your garden)",
    file: GRANTS, catches: "own-ground reaches the ground's own household",
    edit: (t) => t.replace("if (actorHousehold !== groundHousehold)", "if (false)") },

  { name: "an unread household passes instead of refusing",
    file: GRANTS, catches: "an unread household is a REFUSAL, not a pass",
    edit: (t) => t.replace("if (!actorHousehold || !groundHousehold)", "if (false)") },

  { name: "an unknown scope word is admitted instead of refused",
    file: GRANTS, catches: "a scope word this door does not resolve REFUSES",
    edit: (t) => t.replace("if (scope !== SCOPE_OWN_GROUND)", "if (false)") },

  { name: "the channels reorder — what you are outranks what you carry",
    file: GRANTS, catches: "held outranks ground outranks ambient",
    edit: (t) => t.replace('["held", "ground", "ambient"]', '["ambient", "ground", "held"]') },

  { name: "any hand may hang a verb on an object (the escalation door)",
    file: GRANTS, catches: "only the town's own pen may hang a verb on an object",
    edit: (t) => t.replace('row?.by === "the-town"', "row != null") },

  { name: "the within_class guard stops fencing (the weapon works on the quay)",
    file: GRANTS, catches: "a portal verb cannot be performed outside a portal ground",
    edit: (t) => t.replace("if (want && !spineClasses.includes(want))", "if (false)") },

  { name: "the phase guard stops fencing (loot a boss that is still standing)",
    file: GRANTS, catches: "the phase guard reads the fold's answer",
    edit: (t) => t.replace('if (wantPhase && String(phase ?? "") !== wantPhase)', "if (false)") },

  { name: "the guard grammar refuses a verb that named no precondition",
    file: GRANTS, catches: "a verb with no requires is unfenced",
    edit: (t) => t.replace('if (!requires || typeof requires !== "object") return { ok: true };',
                           'if (!requires || typeof requires !== "object") return { ok: false, why: "no" };') },

  // ── the embodiment fence ────────────────────────────────────────────────
  { name: "the fence is read off a corner instead of the centre",
    file: EMB, catches: "the fence is the mark's own extent, centred on its at",
    edit: (t) => t.replace("{ x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2,", "{ x0: x, x1: x + w, y0: y, y1: y + h,") },

  { name: "the fence stops fencing (a human walks out of the garden and keeps their feet)",
    file: EMB, catches: "a step past the fence is REFUSED",
    edit: (t) => t.replace("if (withinFence(fence, to)) return { ok: true, fence };", "return { ok: true, fence };") },

  { name: "the refusal stops naming which ground",
    file: EMB, catches: "a step past the fence is REFUSED",
    edit: (t) => t.replace("your feet stop at ${ground}'s fence", "your feet stop at the fence") },

  { name: "the door quietly relocates the walker instead of refusing",
    file: EMB, catches: "the refusal does not quietly relocate the walker",
    edit: (t) => t.replace("  return {\n    ok: false,\n    fence,",
      "  return {\n    ok: true,\n    to: { x: Math.min(Math.max(Number(to.x), fence.x0), fence.x1), y: Math.min(Math.max(Number(to.y), fence.y0), fence.y1) },\n    clamped: true,\n    fence,") },

  // ⚠ THE FIRST DRAFT OF THIS FLIP WAS A SYNTAX ERROR, and the runner caught it
  // as a WRONG-CATCH rather than a pass: the file failed to parse, every test
  // went red, and none of them was the one named. A mutation that breaks the
  // parser proves the parser works. Replacing the whole guard keeps it valid.
  { name: "a fenceless ground grants an unbounded embodiment",
    file: EMB, catches: "a ground with no extent is an unreadable embodiment",
    edit: (t) => t.replace("  const fence = fenceOf(groundRow);\n  if (!fence)",
                           "  const fence = fenceOf(groundRow) ?? { x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity };\n  if (!fence)") },

  { name: "exit off the embodying ground is allowed",
    file: EMB, catches: "exit from the embodying ground is refused",
    edit: (t) => t.replace('if (!ground || !target || String(target) !== String(ground)) return { ok: true };', "return { ok: true };") },

  { name: "an embodied human may exit nothing at all, not even their own shed",
    file: EMB, catches: "exit from something else inside the ground is not this rule's business",
    edit: (t) => t.replace('if (!ground || !target || String(target) !== String(ground)) return { ok: true };', "if (!ground) return { ok: true };") },

  // ── the two defects the apex suite found in THIS lane's own code ─────────
  // Kept as flips because both were live, both were mine, and both were caught
  // by a test I did not write. A defect that was only ever found once is a
  // defect nothing is watching for.
  // ⚠ ONE FLIP, NOT TWO, AND THE RUNNER IS WHY.
  //
  // I first wrote these as two flips — one per defect — and BOTH came back
  // green. That is the finding, not a nuisance:
  //
  //   · restoring only the poor-entry builder is invisible, because with the
  //     works clause in place the fixture's class marks are correctly read as
  //     DECLARATIONS, so the ground channel yields no entries there at all and
  //     the builder has nothing to build. The guard cannot reach its subject.
  //   · restoring only the stamp-only declaration test is invisible, because
  //     the ground entries it wrongly conjures up are now RICH — built through
  //     `entriesFrom` — so the four tests see the shape they expect.
  //
  // The defects were only ever JOINTLY visible, which is exactly how they got
  // in: each looks harmless beside the other's correct half. So the flip
  // applies both, and the honest statement of coverage is this — the apex suite
  // guards the CONJUNCTION. The entry-shape property has no independent
  // falsifier, because this fixture's class marks all stand in the works and it
  // therefore cannot produce a ground-granted entry to inspect. A fixture with
  // a classed instance OUTSIDE the works is what that guard needs, and it is
  // named here rather than left for someone to assume exists.
  { name: "the ground channel mints poor entries AND reads declarations as instances (both defects, as they shipped)",
    file: APEX, catches: "fields: the say affordance names the fields the act actually takes",
    edit: (t) => t
      .replace("      for (const e of entriesFrom(row, db)) {",
               "      for (const e of entriesOfClass(row, { channel: \"ground\", ground: groundId, parse: (s) => parseJson(s, null) })) {")
      .replace("         ${WORKS_PATH_SQL}              AS declares,",
               "         json_extract(props, '$.declares') AS declares,") },
];

const suite = (file) => {
  try {
    execFileSync(process.execPath, ["--test", SUITES[file]], { cwd: root, encoding: "utf8", stdio: "pipe" });
    return { green: true, out: "" };
  } catch (e) { return { green: false, out: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
};

for (const f of new Set(Object.values(SUITES))) { /* keep the map honest */ }
const controls = Object.keys(SUITES).map((f) => [f, suite(f)]);
for (const [f, r] of controls) {
  if (!r.green) { console.error(`APPARATUS: ${SUITES[f]} is not green before any flip — nothing below would mean anything.`); console.error(r.out.slice(0, 2000)); process.exit(1); }
}
console.log("control · both suites green before any flip\n");

let failures = 0;
for (const f of FLIPS) {
  const path = join(root, f.file);
  const original = readFileSync(path, "utf8");
  // Line endings normalised before the edit — see arena-flips.mjs for the full
  // note. Short version: a multi-line flip string is written with a newline, a
  // CRLF checkout holds a carriage return too, the match silently fails, and the
  // runner says "the edit changed nothing" without saying which kind of nothing.
  // The same flip was red in one worktree and inert in another over identical
  // source. The tree is restored from `original` below either way.
  const source = original.includes("\r\n") ? original.split("\r\n").join("\n") : original;
  const mutated = f.edit(source);
  if (mutated === source) { console.log(`APPARATUS  ${f.name}\n           the edit changed nothing — this flip proves nothing`); failures += 1; continue; }
  writeFileSync(path, mutated);
  const r = suite(f.file);
  writeFileSync(path, original);

  if (r.green) { console.log(`APPARATUS  ${f.name}\n           law broken, suite stayed GREEN — a hole, not a pass`); failures += 1; }
  else if (!r.out.includes(f.catches)) { console.log(`WRONG-CATCH ${f.name}\n            red, but not at "${f.catches}"`); failures += 1; }
  else console.log(`RED  ${f.name}\n     caught by: ${f.catches}`);
}

for (const f of Object.keys(SUITES)) {
  const r = suite(f);
  if (!r.green) { console.log(`\nrestore · ${SUITES[f]} is RED — THE TREE IS STILL MUTATED`); failures += 1; }
}
console.log(`\n${FLIPS.length - failures}/${FLIPS.length} flips flipped red at the assertion that names them.`);
process.exit(failures ? 1 : 0);
