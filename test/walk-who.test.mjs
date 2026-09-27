// walk-who.test.mjs — `world { read: "walk", args: { who } }`: one resident,
// found on the WHOLE roll (postmark#3138, Marigold looking for dom-pidgey).
//
//   node --test test/walk-who.test.mjs
//
// Marigold's issue: "a resident with no marks and an unpinned home is otherwise
// unfindable in the world." The roll always placed dom-pidgey; what was missing
// was a read that answers "where is this one resident". The walk shadow's
// radius is the wrong bound for that question, so `who` reads the same rows the
// radius is drawn from, and says which of two reasons a resident is absent.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// No world clone: the walkers door answers an empty roll, so the driven test
// below exercises the two absent sentences through the production shadow.
process.env.WORLD_CLONE = join(mkdtempSync(join(tmpdir(), "postmark-walk-who-")), "no-world-clone");

// The live row, as GET https://postmark.town/api/world/walkers served it on
// 2026-09-25. Pinned as the shape the door publishes, not as a claim about
// where dom-pidgey stands today.
const ROLL = [
  { handle: "wright", x: -8, y: 21.5, source: "walk", moving: false, toward: null, remaining_m: 0, eta_crossings: 0, mark_id: null },
  { handle: "dom-pidgey", x: 60, y: 40, source: "walk", moving: false, toward: null, remaining_m: 0, eta_crossings: 0, mark_id: null },
  { handle: "far-walker", x: 90000, y: 0, source: "walk", moving: true, toward: { x: 90500, y: 0 }, remaining_m: 500, eta_crossings: 1, mark_id: "far-walker/a-bench" },
];

test("who: a resident on the roll answers their row, however far from you", async () => {
  const { whoOnRoll } = await import("../src/world.mjs");
  assert.deepEqual(whoOnRoll(ROLL, "dom-pidgey", ["wright", "dom-pidgey"]),
    { who: { handle: "dom-pidgey", x: 60, y: 40, mark_id: null, moving: false, toward: null } });
  // 90 km off is outside every radius, and it is still the answer to "where is"
  const far = whoOnRoll(ROLL, "far-walker", null).who;
  assert.deepEqual(far, { handle: "far-walker", x: 90000, y: 0, mark_id: "far-walker/a-bench", moving: true, toward: { x: 90500, y: 0 } });
  // spelled the way a person types it
  assert.equal(whoOnRoll(ROLL, " @Dom-Pidgey ", null).who.handle, "dom-pidgey");
});

test("who: the two reasons to be absent are two different sentences", async () => {
  const { whoOnRoll } = await import("../src/world.mjs");
  const notOut = whoOnRoll(ROLL, "quiet-one", ["wright", "quiet-one"]);
  assert.equal(notOut.who, null);
  assert.match(notOut.who_note, /^quiet-one lives here but is not out/);
  const nobody = whoOnRoll(ROLL, "no-such-one", ["wright", "dom-pidgey"]);
  assert.equal(nobody.who, null);
  assert.match(nobody.who_note, /^there is no resident "no-such-one"/);
  assert.notEqual(notOut.who_note.replace("quiet-one", "X"), nobody.who_note.replace("no-such-one", "X"),
    "not out and not a resident are different facts and must not read alike");
  // no roll held: the office cannot tell the two apart, and says so
  assert.match(whoOnRoll(ROLL, "someone", null).who_note, /could not read the town roll/);
});

test("who: the walk shadow's domain carries it beside the near block, never replacing it", async () => {
  const { walkDomain } = await import("../src/world-apex.mjs");
  const answer = { at: "2026-09-25T13:00:00.000Z", walkers: ROLL };
  const oriented = { standpoint: { x: 0, y: 0, handle: "wright" } };
  const roll = ["wright", "dom-pidgey", "far-walker", "quiet-one"];
  const found = walkDomain(answer, { who: "dom-pidgey" }, oriented, roll);
  assert.deepEqual(found.who, { handle: "dom-pidgey", x: 60, y: 40, mark_id: null, moving: false, toward: null });
  assert.equal(found.walkers.roll, 3, "the near block is still the walk shadow's domain");
  assert.match(walkDomain(answer, { who: "quiet-one" }, oriented, roll).who_note, /^quiet-one lives here but is not out/);
  assert.match(walkDomain(answer, { who: "no-such-one" }, oriented, roll).who_note, /^there is no resident "no-such-one"/);
  const bare = walkDomain(answer, {}, oriented, roll);
  assert.equal("who" in bare, false, "a walk read that asked for nobody grows no who key");
});

test("who: the production shadow reaches it — driven through readDomainFor, where the roll cannot be read", async () => {
  // No world clone here, so the walkers door answers an error. A `who` that
  // was asked must say the roll was unreadable, not vanish from the answer.
  const { readDomainFor } = await import("../src/world-apex.mjs");
  const oriented = { standpoint: { x: 0, y: 0, handle: "wright" } };
  const key = { handles: new Set(["wright"]) };
  const d = await readDomainFor("walk", { who: "dom-pidgey" }, key, oriented, { roll: ["wright", "dom-pidgey"] });
  assert.equal(d.who, null);
  assert.match(d.who_note, /walkers roll could not be read/);
  const bare = await readDomainFor("walk", {}, key, oriented, { roll: ["wright"] });
  assert.equal("who" in bare, false);
});

test("who: the walk read's envelope declares it, and still refuses a field it does not take", async () => {
  const { WORLD_READ_FIELDS } = await import("../src/world-apex.mjs");
  const { validateReadArgs } = await import("../src/validate-args.mjs");
  const judge = (fields) => validateReadArgs({ read: "walk", tool: 'world { read: "walk" }',
    properties: WORLD_READ_FIELDS.walk, fields, exempt: ["handle"] });
  assert.equal(judge({ who: "dom-pidgey" }), null);
  assert.ok(judge({ whom: "dom-pidgey" })?.defect, "an unknown field still bounces by name");
});
