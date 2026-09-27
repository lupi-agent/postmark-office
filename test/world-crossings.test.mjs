// world-crossings.test.mjs — the office's half of enter/exit(mark).
// DEMO SLICE (step 5, jetto/enter-exit-demo). Run: node --test test/world-crossings.test.mjs
//
// What is under test here is exactly the office's OWN half — who is acting, what
// is refused before any law is read, what reaches the pen and what deliberately
// does not. The grammar, the adjudication and the derivation belong to the world
// clone and are tested there (postmark-world tools/thresholds.test.mjs); this
// file leans on the real clone rather than a fake, so a drift between the two
// repos fails here rather than in front of a resident.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { enterViaOffice, exitViaOffice, occupancyViaOffice, CROSSING_TOOLS } from "../src/world-crossings.mjs";
import { DISPATCHABLE, fieldsFor } from "../src/world-apex.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

// The world clone this office is wired to. The suite is honest about the
// dependency rather than mocking it away: no clone, no crossing law, and the
// tests that need one say so instead of passing over an invented world.
// It resolved `join(process.cwd(), "..", "postmark-world")`, which is not one
// directory but a different one in every tree — in a pool tree it named a
// sibling pool slot that does not exist, and all eight cases below read as the
// office's failure rather than the runner's. A cwd-relative fallback is exactly
// as unportable as an absolute one, and a grep for a drive letter cannot see it.
const CLONE = worldClone();
// The grammar module, by whichever name this clone carries it. BOTH, because
// the office and its world clone deploy on separate clocks and this file is a
// name-keyed reader exactly like the code it tests — it broke against a renamed
// clone the first time it met one, which is the defect the fallbacks in
// world-crossings.mjs and crossing-exec.mjs exist to prevent.
const GRAMMAR = CLONE && ["enter-exit.mjs", "thresholds.mjs"].find((n) => existsSync(join(CLONE, "tools", n)));
const HAVE_CLONE = !!GRAMMAR;
const WHY_NOT = CLONE ? `the world clone at ${CLONE} carries no enter-exit/thresholds grammar` : NO_WORLD;

const key = (...handles) => ({ handles: new Set(handles) });
const SHIP = "the-town/the-post-office";
const WHEELHOUSE = "the-town/the-wheelhouse";

/** A whole office, in a closure: the world off the clone's fold, one resident
 *  standing wherever we put her, an in-memory ledger, and a pen that appends to
 *  it. The pen's contract is the exec's — lines in, `within` out. */
async function officeWith({ at = 200, standing = { x: -9, y: 35.5 }, ledger = "" } = {}) { // POS-220: the default standing is INSIDE the post office (its anchor) — a door is entered only from within its extent
  const { readFileSync } = await import("node:fs");
  const worldState = JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  const mod = await import(`file:///${join(CLONE, "tools", GRAMMAR).replace(/\\/g, "/")}`);
  // one name for the parser, whichever era of the module answered
  const thresholds = mod.parseEnterExitLedger ? mod : { ...mod, parseEnterExitLedger: mod.parseThresholdLedger };
  let text = ledger;
  const written = [];
  return {
    text: () => text,
    written,
    deps: {
      world: async () => worldState,
      ledger: async () => text,
      standpointOf: async (who) => ({ ...standing, name: who }),
      now: () => at,
      record: async ({ lines, handle }) => {
        written.push(...lines);
        text += lines.join("\n") + "\n";
        const acts = thresholds.parseEnterExitLedger(text).acts;
        return { lines, within: thresholds.occupancyAt(acts, at).get(handle) ?? [], commit: "deadbeef", pushed: false };
      },
    },
  };
}

// ── the office's own half: who is acting ────────────────────────────────────

test("a key holding several residents must name one", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  await assert.rejects(
    () => enterViaOffice(CLONE, { mark: SHIP }, key("a", "b"), o.deps),
    (e) => e.code === 422 && /which resident/.test(e.defect) && e.choices.length === 2);
});

test("a handle the key does not hold is refused before any law is read", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  await assert.rejects(
    () => enterViaOffice(CLONE, { mark: SHIP, handle: "stranger" }, key("postmaster"), o.deps),
    (e) => e.code === 403);
  assert.equal(o.written.length, 0, "and nothing reached the pen");
});

test("enter with no mark named is a bounce, not a guess", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  await assert.rejects(
    () => enterViaOffice(CLONE, {}, key("postmaster"), o.deps),
    (e) => e.code === 422 && /enter what/.test(e.defect));
});

test("exit with nothing to step out of refuses with a reason", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  await assert.rejects(
    () => exitViaOffice(CLONE, {}, key("postmaster"), o.deps),
    (e) => e.code === 422 && /not within anything/.test(e.defect));
});

test("an office whose clone carries no enter/exit law says so by name", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  await assert.rejects(
    () => enterViaOffice(join(CLONE, "no-such-clone"), { mark: SHIP }, key("postmaster"), o.deps),
    (e) => e.code === 501 && /carries no enter\/exit law/.test(e.defect));
});

// ── the acts, against the real clone ────────────────────────────────────────

test("a door with terms shows them and records NOTHING", { skip: "awaits entry-law instances on main — the demo seeded aboard-terms on the ship; planting them for real is a founder content act, not the merge's (mechanism covered by tools/thresholds.test.mjs world-side)" }, async () => {
  const o = await officeWith();
  const answer = await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster" }, key("postmaster"), o.deps);
  assert.equal(answer.awaiting.mark, SHIP);
  assert.equal(answer.terms.some((t) => t.edge === "aboard"), true, "the aboard edge is read at the threshold");
  assert.equal(o.written.some((l) => l.includes(SHIP)), false,
    "withholding your word is declining to author the act, not being refused — nothing about HER reached the record");
  // …and the links she crossed on the way to that door did land, because they
  // happened. The chain stops at the threshold that asked; it does not rewind.
  assert.ok(o.written.length >= 1 && o.written.every((l) => / · enters /.test(l)));
});

test("accepting the terms crosses the whole chain and the pen sees every link", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  const answer = await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), o.deps);
  assert.ok(answer.entered.includes(SHIP));
  assert.deepEqual(answer.within.slice(-1), [SHIP], "the innermost thing she is within is the boat");
  assert.equal(o.written.length, answer.entered.length, "one row per link actually crossed");
  // BOTH SPELLINGS of the ferry field: the row is the clone's writer's, not this
  // test's, and this clone may carry either era of the grammar.
  assert.ok(o.written.every((l) => /· enters .+ · (?:ferry|at) \d+\.\d{4} · word (welcomed|neutral)$/.test(l)),
    "and each row stamps the mark's own word as it stood");
  assert.equal(answer.ledger.commit, "deadbeef");
});

test("opposed is a refusal at the threshold, and the refusal is IN the record", { skip: "awaits an opposed entry law on main (the demo's wheelhouse fixture; same founder act as above)" }, async () => {
  const o = await officeWith();
  const answer = await enterViaOffice(CLONE, { mark: WHEELHOUSE, handle: "postmaster", accept: true }, key("postmaster"), o.deps);
  assert.equal(answer.refused.word, "opposed");
  assert.equal(answer.stranded_at, WHEELHOUSE);
  assert.equal(answer.within.includes(WHEELHOUSE), false, "she is not inside it");
  assert.ok(answer.within.includes(SHIP), "and she IS aboard the boat she crossed on the way — stranded at THAT door");
  assert.ok(o.written.some((l) => l.includes(WHEELHOUSE) && l.endsWith("word opposed")),
    "being turned away is a fact about the town and belongs in the record");
  assert.match(answer.note, /standing at that door/);
});

test("exit truncates the chain and names the scope it restores to", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), o.deps);
  const answer = await exitViaOffice(CLONE, { handle: "postmaster" }, key("postmaster"), o.deps);
  assert.equal(answer.target, SHIP, "a bare exit steps out of the innermost thing you are in");
  assert.equal(answer.within.includes(SHIP), false);
  assert.ok(answer.into, "and says where you now stand");
});

test("occupancy is derived, public, and carries entity children only", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const o = await officeWith();
  await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), o.deps);
  const read = await occupancyViaOffice(CLONE, {}, { ...o.deps, now: () => 200 });
  assert.ok(read.occupants[SHIP].includes("postmaster"));
  assert.equal(read.edges.every((e) => e.childKind === "entity"), true);
  assert.equal(read.edges.every((e) => e.class === "contains"), true, "R14: no new edge class");
  assert.equal(read.unrecognized, 0);
});

// ── the table ───────────────────────────────────────────────────────────────

test("the dispatch table holds the pair, and the fields come from their own schemas", () => {
  assert.ok(DISPATCHABLE.includes("enter") && DISPATCHABLE.includes("exit"),
    "L6 reads this list — an action the law exposes and the table does not hold is a door with no room behind it");
  assert.ok(fieldsFor("enter").mark, "enter takes a mark");
  assert.ok(fieldsFor("enter").accept, "and the explicit word");
  assert.equal(fieldsFor("enter").handle, undefined, "minus the standpoint, exactly as every other act");
  assert.equal(CROSSING_TOOLS.every((t) => t.inputSchema.additionalProperties === false), true,
    "closed schemas: an unknown field bounces by name");
});

// ── the reach law (founder-ruled 2026-08-27, option A of the R15 collision) ──

test("a door is entered from within its reach — entry from afar is refused with directions, and nothing reaches the pen", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // "You can enter things when you aren't even there" — the first dev walk's
  // finding. The bundled walk the world's crossingPlan assumed is performed by
  // nobody (R15: the office never writes a walk), so before this guard, entry
  // from anywhere landed as occupancy with no presence. The ruling: at the
  // door means within the TARGET's extent or within 60 m of its anchor
  // (re-ruled 2026-09-11 — it used to be the first uncrossed link, which is the
  // outer wall, not the door); farther is a 409 carrying the walk-to
  // coordinates, not a deed.
  const o = await officeWith({ standing: { x: 90000, y: 90000 } });
  await assert.rejects(
    () => enterViaOffice(CLONE, { mark: SHIP }, key("postmaster"), o.deps),
    (e) => e.code === 409 && /not at that door/.test(e.defect) && /Walk to \(/.test(e.hint ?? e.resolves ?? ""),
    "a caller ~127 km away must be refused with directions");
  assert.equal(o.written.length, 0, "and nothing reached the pen — a refusal at the door writes no crossing");
});

test("...and every such refusal carries the plan's bundled WALK as a field, not only in its sentence", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // A page that parsed "Walk to (563, -294.5)" out of the hint to find a machine
  // fact would be the prose-scraping class this office keeps a museum of. The
  // object rides the bounce so the button never reads the sentence.
  const o = await officeWith({ standing: { x: 90000, y: 90000 } });
  const e = await enterViaOffice(CLONE, { mark: SHIP }, key("postmaster"), o.deps).then(() => null, (err) => err);
  assert.ok(e && e.code === 409);
  assert.equal(e.walk?.mark, SHIP);
  assert.ok(Number.isFinite(e.walk?.to?.x) && Number.isFinite(e.walk?.to?.y), "with real coordinates, never a shape with holes");
  assert.equal(o.written.length, 0);
});

test("...and standing INSIDE the target still admits — within its extent is at the door", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // The default fixture standing is the one every chain falsifier above enters
  // from; if this test reddens, the guard has started refusing a walker who is
  // standing at the door, and every chain law above it is standing on a corpse.
  const o = await officeWith();
  const answer = await enterViaOffice(CLONE, { mark: SHIP, accept: true }, key("postmaster"), o.deps);
  assert.ok((answer.entered ?? []).length > 0 || answer.already, "the in-reach entry must land (or already be within)");
});

// ── THE DOOR CHECKED IS THE ONE YOU NAMED (founder-ruled 2026-09-11) ──────
//
// illuminator's case, reproduced. On prod at 2026-09-12T00:04:21Z, standing
// inside `the-town/the-town-centre` and 1.7 km from the parcel, illuminator
// entered BOTH `the-town/the-town-centre` and
// `illuminator/the-looking-room-parcel` in one act — both rows are in the live
// `GET /api/world/enter-exit-ledger`. The founder: "that's terrible."
//
// The cause was arithmetic, not adjudication: the reach was measured to
// `answer.links[0]`, the OUTERMOST un-held link, which on this town is a
// 2 092 × 1 745 m square. Standing anywhere inside the town admitted you to
// anything inside the town. The measure is now the TARGET.
//
// CAN-FAIL FLIP: put `answer.links[0]` back in `world-crossings.mjs` and this
// test goes green-to-red by ADMITTING — `entered` comes back with two ids and
// the pen takes two rows, exactly the prod ledger's shape.

const PARCEL = "illuminator/the-looking-room-parcel";
// Inside the town centre (it spans x -1100…992, y -952…793) and 1 721 m from
// the parcel's anchor — the standpoint class illuminator was in.
const DEEP_IN_TOWN_FAR_FROM_PARCEL = { x: -1100, y: 150 };

test("illuminator's case: inside the outer link but 1.7 km from the mark you named is REFUSED, and nothing is recorded",
  { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const { readFileSync } = await import("node:fs");
  const world = JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  const { pathToFileURL } = await import("node:url");
  const mod = await import(pathToFileURL(join(CLONE, "tools", "world-verbs.mjs")));

  // The premise, measured rather than assumed: he really is inside the outer
  // link, and the outer link really is the first one the old code reached for.
  const outer = world.marks.find((m) => m.id === "the-town/the-town-centre");
  assert.equal(mod.pointWithinMark(DEEP_IN_TOWN_FAR_FROM_PARCEL, outer), true,
    "the whole point of this case is that the OLD check passed — he is inside the town centre");
  const plan = mod.enterExitPlan(DEEP_IN_TOWN_FAR_FROM_PARCEL, PARCEL, world, {});
  assert.equal(plan.links[0], "the-town/the-town-centre", "and that is the link the old measure used");
  assert.equal(plan.chain.at(-1), PARCEL);

  const o = await officeWith({ standing: DEEP_IN_TOWN_FAR_FROM_PARCEL });
  const e = await enterViaOffice(CLONE, { mark: PARCEL, handle: "illuminator", accept: true },
    key("illuminator"), o.deps).then(() => null, (err) => err);

  assert.ok(e, "1.7 km from the parcel is not at the parcel's door");
  assert.equal(e.code, 409);
  assert.ok(e.defect.includes(PARCEL), `the refusal names the TARGET: ${e.defect}`);
  assert.doesNotMatch(e.defect, /the-town\/the-town-centre/,
    "and not the outer wall he happened to be standing inside");
  assert.match(e.defect, /~1721 m/, "with the distance to the mark he named");
  assert.match(e.hint, /Walk to \(563, -294\.5\)/, "and the parcel's own coordinates to walk to");
  assert.equal(o.written.length, 0, "nothing reached the pen — neither row of the prod ledger's pair");

  // THE WALK AS A FIELD, for the page's "walk there and enter" button
  // (founder-agreed 2026-09-11). It sends `walk { mark_id, enter_on_arrival:
  // true }` and reads `walk.mark` off this body — never the sentence.
  // CAN-FAIL: drop the `{ walk: answer.walk }` extra in world-crossings.mjs and
  // these three redden on undefined.
  const parcel = world.marks.find((m) => m.id === PARCEL);
  assert.equal(e.walk?.mark, PARCEL, "the refusal hands back the mark the button must name");
  assert.deepEqual(e.walk?.to, { x: parcel.at.x, y: parcel.at.y }, "…and the target's own anchor to walk to");
  assert.deepEqual(e.walk, plan.walk,
    "it is the PLAN's own walk object, not a second one rebuilt at this door — a second copy of the destination is a second answer to \"where is that door\"");
});

test("...and from the parcel's own reach the chain still enters the outer links first",
  { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // Nothing is lost by measuring at the target: `enterExitPlan` says it in its
  // own comment — "walking to the target's own ground puts you inside every
  // link at once, since the target sits within all of them". So the fix is
  // strictly a TIGHTENING; the lawful entry it used to allow still lands, and
  // it still lands as a CHAIN. CAN-FAIL: drop the outer links from the chain
  // and `entered` stops carrying the town centre.
  const { readFileSync } = await import("node:fs");
  const world = JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  const parcel = world.marks.find((m) => m.id === PARCEL);
  const o = await officeWith({ standing: { x: parcel.at.x, y: parcel.at.y } });
  const answer = await enterViaOffice(CLONE, { mark: PARCEL, handle: "illuminator", accept: true },
    key("illuminator"), o.deps);
  assert.ok(answer.entered.includes(PARCEL), "the mark he named");
  assert.ok(answer.entered.includes("the-town/the-town-centre"),
    "and the outer link on the way in — deep entry is never a teleport");
  assert.equal(o.written.length, answer.entered.length, "one row per link actually crossed");
});

test("the door is the EXTENT: half a metre inside its edge admits, one metre outside refuses — no earshot enter (POS-220)",
  { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  // Keemin, 2026-09-25: "remove the earshot enter, so must be within extent".
  // Until then a 60 m reach from the ANCHOR admitted a resident 3 m outside the
  // taproom (postmaster from the mooring). CAN-FAIL: restore the reach leg
  // (drop earshotM: 0 in world-crossings.mjs) and the second assertion reddens.
  const { readFileSync } = await import("node:fs");
  const world = JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  const po = world.marks.find((m) => m.id === SHIP);
  const edge = po.at.x + po.extent.w / 2;

  const inside = await officeWith({ standing: { x: edge - 0.5, y: po.at.y } });
  const admitted = await enterViaOffice(CLONE, { mark: SHIP, accept: true }, key("postmaster"), inside.deps);
  assert.ok((admitted.entered ?? []).length > 0 || admitted.already, "half a metre inside the edge is at its door");

  const outside = await officeWith({ standing: { x: edge + 1, y: po.at.y } });
  const e = await enterViaOffice(CLONE, { mark: SHIP, accept: true }, key("postmaster"), outside.deps)
    .then(() => null, (err) => err);
  assert.ok(e && e.code === 409, "one metre outside the edge is not — the 60 m reach is gone");
  assert.equal(outside.written.length, 0);
});

test("no refusal this door speaks calls the margin a DOORSTEP — the resident's word stays the resident's",
  async () => {
  // Founder, 2026-09-11: "doorstep means something else." A doorstep here is a
  // resident's front step and their morning read (`read_doorstep`,
  // `household { read: "doorstep" }`, `DOORSTEP_SEGMENTS`); it was also the
  // name of a geometric margin in this file's bounce. CAN-FAIL: restore the old
  // hint sentence and this reddens on the source, which is the only place a
  // sentence nobody currently triggers can be caught.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/world-crossings.mjs", import.meta.url), "utf8");
  const sentences = [...src.matchAll(/bounce\((\d{3}),([\s\S]*?)\);/g)].map((m) => m[0]);
  assert.ok(sentences.length >= 3, "the bounces are found at all");
  for (const b of sentences) {
    assert.doesNotMatch(b, /doorstep/i, `a bounce still says "doorstep": ${b.slice(0, 120)}`);
  }
  assert.match(src, /a door is entered from within its extent/, "and the rule says the word it means");
});


// ── the reach's number, read off the record (lane-h, the-town/the-reach) ──
//
// The 60 that stood in this door as a literal is now `EARSHOT_M` — the say
// edge's own dial, off the world store, through the one reader that already
// reads it. The comment beside the literal always CALLED it that ("EARSHOT_M
// (60, the town's own being-part-of-a-scene number)"); a name that does not
// read its record is a falsifier that cannot fail, and the town could have
// moved its own number with this door going on refusing at the old one.
//
// ⚑ THE ±1 m BOUNDARY IS OBSERVABLE AT THIS DOOR NOW, and it was not before.
// While the measure was to the FIRST UNCROSSED LINK, that link was
// `the-town/the-town-centre` for every mark on this clone — a mark so large
// that any point within 60 m of its anchor is inside its extent, so the
// containment leg short-circuited and the margin leg could not be seen from
// here at all. Measuring at the TARGET (founder, 2026-09-11) puts a 9 × 26 m
// post office on the other end of the tape, and the margin is the only leg
// that can admit a walker standing beside it. So the boundary is asserted
// here, at the door, as well as on `standsWithin` in test/hold-reach.test.mjs.

test("the enter refusal reports the distance the SHARED reach measured, not one of its own", { skip: !HAVE_CLONE && WHY_NOT }, async () => {
  const { readFileSync } = await import("node:fs");
  const { standsWithin } = await import("../src/reach.mjs");
  const world = JSON.parse(readFileSync(join(CLONE, "WORLD", "world-state.json"), "utf8"));
  const standing = { x: 90000, y: 90000 };
  const o = await officeWith({ standing });
  const e = await enterViaOffice(CLONE, { mark: SHIP }, key("postmaster"), o.deps).then(() => null, (err) => err);
  assert.ok(e, "127 km out is not at the door");
  // The same question, asked here of the TARGET, must produce the same metre.
  // If the door ever grew a second measurement this diverges.
  const target = world.marks.find((m) => m.id === SHIP);
  const reach = standsWithin(standing, target);
  assert.equal(reach.stands, false);
  assert.match(e.defect, new RegExp(`~${reach.distance_round} m`),
    "the refusal names the shared reach's own number");
  assert.ok(e.defect.includes(SHIP),
    "and it names the mark the caller asked for, not the outer wall around it");
});

test("THE WALK FIELD SURVIVES EVERY DOOR THAT REBUILDS THIS BOUNCE", async () => {
  // NAME THE READER OF WHAT THE FIX INTRODUCES. The field is added at the enter
  // door, but the door the world page's button actually calls is the apex
  // (`POST /api/world/apex` with `{do: "enter", …}`), and BOTH the apex act
  // branch and the flat `world_*` path REBUILD the bounce from hand-picked
  // fields rather than passing it through. Before this lane those lists named
  // `choices` and nothing else, so a `walk` added below would have been dropped
  // at exactly the door that needed it — a value nothing can read, which is the
  // quiet failure this office keeps a museum of.
  //
  // ⚑ WHAT THIS PROVES AND WHAT IT DOES NOT. It reads the two rebuild sites'
  // source, not their behaviour: driving `do: "enter"` end to end needs the
  // live world store, the walk ledger and the crossing exec, which this file
  // deliberately does not stand up. So it catches the defect it is written for
  // — a rebuild site that forgets the field — and it does not prove the wire.
  // CAN-FAIL: drop `walk` from either list and the matching assertion reddens.
  const { readFileSync } = await import("node:fs");
  const sites = [
    ["src/world-apex.mjs", /return \{ \.\.\.bounce\(e\.code, e\.defect, e\.hint,[\s\S]{0,400}?\), \.\.\.done \};/],
    ["src/mcp.mjs", /if \(e\.code\) return \{ error: "bounce", code: e\.code,[\s\S]{0,400}?\};/],
  ];
  for (const [file, re] of sites) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const m = src.match(re);
    assert.ok(m, `${file}: the bounce-rebuild site was not found — this check has stopped reading anything`);
    assert.match(m[0], /e\.walk \? \{ walk: e\.walk \}/,
      `${file} rebuilds the bounce and does not carry \`walk\` — the page's "walk there and enter" button reads it off that body`);
    assert.match(m[0], /e\.choices \? \{ choices: e\.choices \}/,
      `${file} stopped carrying \`choices\` — the multi-resident bounce needs it and this list is shared`);
  }
});

test("the enter door and the hold door ask ONE function — the reach is not copied", async () => {
  // `the-town/the-reach`: a take stands within a thing's extent "exactly as an
  // entry stands at a threshold you truly stand before". "Exactly as" is only
  // true while it is the same function, and this is the assertion that notices
  // if somebody writes the second copy.
  const { readFileSync } = await import("node:fs");
  const crossings = readFileSync(new URL("../src/world-crossings.mjs", import.meta.url), "utf8");
  const hold = readFileSync(new URL("../src/world-hold.mjs", import.meta.url), "utf8");
  assert.match(crossings, /standsWithin\(/, "the enter door calls the shared reach");
  assert.match(hold, /standsWithin\(/, "and so does the hold door");
  assert.doesNotMatch(crossings, /const EARSHOT_M = \d/, "the literal must not come back");
  assert.doesNotMatch(hold, /const EARSHOT_M = \d/);
});

// ── entering ends the walk (Keemin-ruled 2026-09-12; postmark-town/postmark #2685) ──
//
// sophia's ghost occupancy, reproduced twice by her: start a walk, enter a
// building while the walk carries you through its footprint, and the walk keeps
// going — carries you back outside without an exit — while the ledger says you
// are within. The office's half of the fix: after the entry is recorded, a walk
// still live at that instant is stopped where the body stands, through the
// door's own walk act (a zero-length departure is the walk ledger's "stand
// here"). `walking` reads the body, `stop` writes the departure; both are deps.

test("ENTERING ENDS THE WALK: carried through the footprint mid-walk, the entry is recorded and then the walk is stopped where the body stands", async () => {
  if (!HAVE_CLONE) return;
  const o = await officeWith();
  const stops = [];
  const deps = {
    ...o.deps,
    walking: async () => ({ live: true, x: -30, y: 40 }),
    stop: async (who, here, k) => { stops.push({ who, here, k }); return { position: { ...here, arrived: true, standing: true } }; },
  };
  const answer = await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), deps);
  assert.ok(answer.entered.length, "the entry itself is recorded — it is the act the resident asked for");
  assert.equal(stops.length, 1, "exactly one stop, after the entry");
  assert.deepEqual(stops[0].here, { x: -30, y: 40 }, "the stop is where the body stood at the instant of the entry — never the door's centre, never home");
  assert.equal(stops[0].who, "postmaster");
  assert.equal(answer.walk_ended?.recorded, true);
  assert.deepEqual(answer.walk_ended.at, { x: -30, y: 40 });
});

test("a standing resident's entry writes no stop — there is no walk to end", async () => {
  if (!HAVE_CLONE) return;
  const o = await officeWith();
  const stops = [];
  const deps = { ...o.deps, walking: async () => ({ live: false, x: -30, y: 40 }), stop: async (...a) => { stops.push(a); } };
  const answer = await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), deps);
  assert.ok(answer.entered.length);
  assert.equal(stops.length, 0);
  assert.equal(answer.walk_ended, undefined);
});

test("an entry that records nothing ends no walk — refused from beyond reach, the body keeps walking", async () => {
  if (!HAVE_CLONE) return;
  // (the ship carries no entry terms on main yet — the awaiting case is skipped
  // above for the same reason — so the recording-nothing case here is the 409:
  // a walker far from the door, still walking, is refused and nothing is written)
  const o = await officeWith({ standing: { x: 5000, y: 5000 } });
  const stops = [];
  const deps = { ...o.deps, walking: async () => ({ live: true, x: 5000, y: 5000 }), stop: async (...a) => { stops.push(a); } };
  const e = await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), deps).then(() => null, (err) => err);
  assert.equal(e?.code, 409, "refused at the door — you are not at it");
  assert.equal(o.written.length, 0, "nothing recorded");
  assert.equal(stops.length, 0, "no entry, no stop — the walk that is carrying her is hers to finish");
});

test("a stop that fails to write is reported on the answer, never swallowed — that silence would be the ghost", async () => {
  if (!HAVE_CLONE) return;
  const o = await officeWith();
  const deps = { ...o.deps, walking: async () => ({ live: true, x: -30, y: 40 }), stop: async () => { const e = new Error("the town lock is busy"); e.defect = "the town lock is busy"; throw e; } };
  const answer = await enterViaOffice(CLONE, { mark: SHIP, handle: "postmaster", accept: true }, key("postmaster"), deps);
  assert.ok(answer.entered.length, "the entry still stands");
  assert.equal(answer.walk_ended?.recorded, false);
  assert.match(answer.walk_ended.error, /town lock is busy/);
});
