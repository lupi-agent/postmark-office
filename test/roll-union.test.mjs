// roll-union.test.mjs — step 10: the office learns to ask about everyone, and
// the household door learns to await the answer it already asked for.
//
// Both halves serve law already on the record; the clauses are cited by id
// rather than restated, because a test that paraphrases a node is a second copy
// of the constitution:
//
//   the-town/the-standing-porch  (resident class) — "the quay, when the record
//       places them nowhere else." The engine answers that correctly as of world
//       fd965b7c. This suite is about the office ASKING about the residents it
//       answers for.
//   the-town/the-disclosure      (logos) — "refuse or disclose absent inputs;
//       never quietly substitute." Both halves lean on it: a walkers answer
//       given no roll says so, and a degraded world read must never be dressed
//       up as a resident's missing paperwork.
//
// Written before the fix and red against office main ac2b43f5.

import test from "node:test";
import assert from "node:assert/strict";

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { positionRoster, everyonePlaced } from "../src/positions.mjs";
import { paperGaps, householdStanding } from "../src/household-apex.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── A · the roll union ──────────────────────────────────────────────────────

const QUAY_ID = "the-town/the-quay";
const world = {
  households: { "rook-of-garrison": "the-garrison", "sol-of-garrison": "the-garrison" },
  marks: [{ id: QUAY_ID, by: "the-town", household: "the-town", kind: "sited", at: { x: 1390, y: 5665 } }],
  parcels: [{ id: "sol-of-garrison/the-heart-house-parcel", household: "sol-of-garrison", at: { x: -1375, y: -2550 }, extent: { w: 25, h: 25 } }],
};
const departures = [{
  iso: "2026-08-17T00:00:00.000Z", handle: "dylan", era: "store",
  from: { x: 0, y: 0 }, toward: { x: 100, y: 100 }, at: 130, targetExtent: null, targetMarkId: null, pace: null,
}];
// Three residents the old roster could never contain: no walk, no ground.
const ROLL = ["dylan", "sol-of-garrison", "adam-rhys", "athena", "beau"];

test("A1: the roster unions the town roll — a resident with no walk and no ground is asked about", () => {
  const roster = positionRoster({ departures, world, roll: ROLL });
  for (const h of ["adam-rhys", "athena", "beau"]) {
    assert.ok(roster.includes(h),
      `${h} has neither a walk record nor a parcel, so the old union could not contain them — that is the 28`);
  }
});

test("A2: it is a UNION, not a replacement — walk and parcel handles survive untouched", () => {
  const before = positionRoster({ departures, world });
  const after = positionRoster({ departures, world, roll: ROLL });
  for (const h of before) assert.ok(after.includes(h), `${h} was in the roster before the roll and must remain`);
  // and the roll adds only what it should
  assert.deepEqual([...new Set(after)].filter((h) => !before.includes(h)).sort(), ["adam-rhys", "athena", "beau"]);
});

test("A3: an empty roll changes nothing — the old behaviour is the floor, not a regression", () => {
  assert.deepEqual(positionRoster({ departures, world, roll: [] }), positionRoster({ departures, world }));
  assert.deepEqual(positionRoster({ departures, world, roll: null }), positionRoster({ departures, world }));
});

// The engine lives in the WORLD CLONE, not node_modules — the office imports it
// by path at runtime, so a test that wants it must resolve it the same way.
// A checkout without one SKIPS VISIBLY: `return` would have been a probe that
// cannot fail, reporting green while measuring nothing.
async function engineWhereIs(t) {
  const roots = [process.env.WORLD_CLONE, join(ROOT, "..", "postmark-world"),
    join(ROOT, "..", "..", "postmark-world"), join(ROOT, "world-clone")].filter(Boolean);
  for (const r of roots) {
    const f = join(r, "tools", "where-is.mjs");
    if (existsSync(f)) return import(pathToFileURL(f).href);
  }
  t.skip(`no world clone found (looked in ${roots.join(", ")}) — set WORLD_CLONE to bind A4`);
  return null;
}

// ⚑ THE ANSWER MOVED, THE ASKING DID NOT (#2900, ruled 2026-09-17: "Agreed with
// the Origin"). This test was written to hold the thing this suite is about —
// that the office ASKS about residents it could not place — and it pinned the
// answer it got at the time, the engine's porch. The founder has since ruled
// that a groundless resident stands at the ORIGIN everywhere the office answers,
// so the office corrects the porch at `everyonePlaced` (src/positions.mjs).
//
// What this file exists to prove is unchanged and still asserted below: the
// three residents with no walk and no ground APPEAR. Where they appear is the
// half that moved. The engine's own answer is asserted here too, in the same
// test, so this can never go green by the correction having quietly become the
// engine's opinion — the office overrides a porch it can still read.
test("A4: through the door, the unplaced APPEAR, and they stand at the Origin (#2900) over an engine that still says porch", async (t) => {
  const where = await engineWhereIs(t);
  if (!where) return;
  const rows = everyonePlaced({ world, departures, at: 135, where, roll: ROLL });
  const byHandle = Object.fromEntries(rows.map((r) => [r.handle, r]));
  for (const h of ["adam-rhys", "athena", "beau"]) {
    assert.ok(byHandle[h], `${h} must appear at all — absence with nothing disclosing it is the defect`);
    assert.deepEqual({ x: byHandle[h].x, y: byHandle[h].y }, { x: 0, y: 0 },
      "a groundless resident stands at the Origin, everywhere the office answers");
    assert.equal(byHandle[h].source, "origin");
    assert.equal(byHandle[h].mark_id, null, "the Origin is the grid's corner, not a mark to borrow");
    assert.equal(byHandle[h].placeholder, true, "and the row says it is a default, not a place they chose");
  }
  // THE ENGINE IS UNTOUCHED, and this is the line that proves the office is
  // overriding rather than agreeing. the-town/the-standing-porch is still world
  // law and the-town/the-quay is still a mark at (1390, 5665).
  assert.equal(where.whereIs("adam-rhys", { world, departures, at: 135 }).source, "quay");
  assert.equal(where.whereIs("adam-rhys", { world, departures, at: 135 }).mark_id, QUAY_ID);
  // the union did not disturb the rows that already worked
  assert.equal(byHandle["sol-of-garrison"].source, "parcel");
  assert.equal(byHandle["dylan"].source, "walk");
});

// ── B · the household-apex await ────────────────────────────────────────────
//
// `worldBlockForHandle` is async. Both call sites took its Promise as a value:
// `.sited` read undefined, so the "not yet sited" gap could never fire, and the
// standing serialized `"world": {}`. The seam below is an injection point rather
// than a stub of the module — the production default stays the real function.

const sited = async () => ({ mark_id: "x/y", x: 1, y: 2, sited: true });
const unsited = async () => ({ mark_id: null, x: null, y: null, sited: false });
const unreadable = async () => ({ mark_id: null, x: null, y: null, sited: false,
  unreadable: true, unreadable_reason: "the office cannot read the world right now (test)" });

// `n` leads and `json` follows on purpose: this one stub answers every query
// the standing walks, and `resident()` now also asks the letters table for a
// COUNT (the address card's mail bound, 2026-08-25), which it reads
// positionally as Object.values(row)[0]. The resident row is read by NAME.
const db = { prepare: () => ({ get: () => ({ n: 0, json: JSON.stringify({}) }), all: () => [] }) };
const ctx = (worldBlock) => ({ db: null, clone: null, worldBlock });

test("B1: the gap FIRES for a genuinely unsited home — it has never once fired in production", async () => {
  const gaps = await paperGaps("someone", ctx(unsited));
  assert.ok(gaps.some((g) => /not yet sited/i.test(g)),
    "sited:false is the whole condition; an un-awaited Promise made it unreachable");
});

test("B2: the gap does NOT fire for a sited home", async () => {
  const gaps = await paperGaps("someone", ctx(sited));
  assert.ok(!gaps.some((g) => /not yet sited/i.test(g)));
});

test("B3: THE DISCLOSURE GUARD — a degraded read must not be dressed as missing paperwork (the-town/the-disclosure)", async () => {
  const gaps = await paperGaps("someone", ctx(unreadable));
  assert.ok(!gaps.some((g) => /not yet sited/i.test(g)),
    "an unreadable engine also answers sited:false — telling a placed resident to go walk their ground is #1864 in a new mouth");
});

test("B4: the standing's world block is a real object, not a serialized Promise", async () => {
  const s = await householdStanding({ household: "h", handles: new Set(["someone"]) },
    { db, clone: null, worldBlock: sited });
  const block = s.papers?.someone?.world;
  assert.ok(block, "the standing promised a world block");
  assert.equal(typeof block.then, "undefined", "a Promise here serializes as {} — the household door's empty object");
  assert.equal(block.sited, true);
  assert.equal(JSON.stringify(block) !== "{}", true);
});

// ── A5 · the door the report came through ───────────────────────────────────
//
// `world { handle, read: "walk" }` is the read Keith ran in #1864, and it does
// NOT go through /world/walkers — it goes through the apex's read shadow
// (`world-apex.mjs` readDomainFor case "walk" → callWorldTool("world_walkers")).
// A fix that reached the HTTP door and not this one would have left the
// reporter's own surface exactly as it was, which is the version of "done" that
// gets found in the field instead of in review.

test("A5: the apex read path carries a roll through to the walkers tool (the #1864 door)", async () => {
  const { default: apexSrc } = await import("node:fs").then((fs) => ({
    default: fs.readFileSync(join(ROOT, "src", "world-apex.mjs"), "utf8"),
  }));
  // The chain, asserted on the source rather than by standing up an office:
  // ctx must reach readDomainFor, and readDomainFor must pass it to the tool.
  assert.match(apexSrc, /export async function worldApex\(args = \{\}, key = null, ctx = \{\}\)/,
    "the apex must accept a ctx to have anything to pass");
  assert.match(apexSrc, /readDomainFor\(action, fields, key, oriented, ctx\)/,
    "and must actually hand it down — a ctx accepted and dropped is worse than none");
  // NB: the argument object nests braces, so a `{[^}]*}` pattern cannot match it
  // — that was this probe's first bug, and the code was right both times.
  assert.match(apexSrc, /await callWorldTool\(tool, .*, key, ctx\);/,
    "and the shadow must pass it to the tool, which is the last hop before world_walkers");

  const worldSrc = await import("node:fs").then((fs) => fs.readFileSync(join(ROOT, "src", "world.mjs"), "utf8"));
  assert.match(worldSrc, /case "world_walkers": return worldWalkers\(WORLD_CLONE, null, \{ roll: ctx\?\.roll \?\? null \}\)/,
    "and world_walkers must read the roll off the ctx it is finally given");

  // The three doors that hold a roll all read it from ONE named function.
  const serverSrc = await import("node:fs").then((fs) => fs.readFileSync(join(ROOT, "src", "server.mjs"), "utf8"));
  // BY DOOR, not by count. This assertion was a magic `3` and went red the
  // moment a fourth door was correctly wired — a test that has to be edited
  // every time the code gets MORE right is measuring the wrong thing.
  for (const [door, pattern] of [
    ["/world/walkers", /worldWalkers\(WORLD_CLONE, null, \{ roll: townRoll\(\) \}\)/],
    ["/world/present", /worldPresent\(args, \{ roll: townRoll\(\) \}\)/],
    ["apex GET", /return worldApex\(args, key, \{ roll: townRoll\(\) \}\)/],
    ["apex POST", /await worldApex\(payload, key, \{ roll: townRoll\(\) \}\)/],
  ]) assert.match(serverSrc, pattern, `${door} must read the roll from the one named reader`);
  assert.match(serverSrc, /function townRoll\(\)/, "one reader, no second resolver");
});

// ── A6 · the two doors must ask the SAME question ───────────────────────────
//
// The near-miss this test exists for: I wired the roll into the walkers door
// and not into the presence layer. Both call `everyonePlaced`, and
// presence-union.test.mjs holds the invariant "world_walkers and present name
// the same residents — one derivation, two doors". That test did NOT catch it,
// because it calls worldWalkers with no roll, so both doors were narrow
// together and agreed. In PRODUCTION the server passes a roll to one and not
// the other, and the two would have disagreed about the population of the world
// — issue #7's split-brain, reintroduced by the fix for a different half of it.
//
// A functional version needs a live dynamic store and a real repo; this asserts
// the wiring symmetry instead, which is the property that actually broke.

test("A6: every everyonePlaced caller that can hold a roll passes one — the doors stay symmetric", async () => {
  const fs = await import("node:fs");
  const read = (f) => fs.readFileSync(join(ROOT, "src", f), "utf8");

  // Both composers accept and forward it.
  // POS-284 adds `only` after the roll (a kept placement re-placing its walkers).
  assert.match(read("positions.mjs"), /export function everyonePlaced\(\{ world = null, departures = \[\], at, where = null, roll = \[\](, only = null)? \} = \{\}\)/);
  // POS-284: the presence layer calls `place`, which is `everyonePlaced` or the
  // office's kept placement of it; the roll rides either way.
  assert.match(read("dynamic-presence.mjs"), /const place = projected && placed \? placed : everyonePlaced;/);
  assert.match(read("dynamic-presence.mjs"), /place\(\{ world, departures, at, where, roll \}\)/,
    "the presence layer must hand the roll down, or `present` sees a smaller town than `walkers`");

  // And the chain that feeds it is threaded end to end.
  const dp = read("dynamic-presence.mjs");
  for (const hop of [/export function positionsAt\([^)]*roll = \[\][^)]*\)/s,
                     /async function readPresence\(\{[^}]*roll = \[\][^}]*\}/s,
                     // POS-269: readPresence hands the projection-only read the roll…
                     /return projectedPresence\(\{[^}]*roll[^}]*\}\)/s,
                     // …and that read hands it to positionsAt beside the projection.
                     /positionsAt\(null, atMs, w, vesselFromProjection\(departures\),\s*\{ world, where: whereMod, frames, stored: null, roll, projected: departures, placed \}\)/s])
    assert.match(dp, hop, "a roll accepted at one hop and dropped at the next is worse than none");

  // The server gives BOTH doors the same reader.
  const server = read("server.mjs");
  assert.match(server, /worldWalkers\(WORLD_CLONE, null, \{ roll: townRoll\(\) \}\)/);
  assert.match(server, /worldPresent\(args, \{ roll: townRoll\(\) \}\)/,
    "walkers with a roll and present without it is the divergence this test is named for");
});
