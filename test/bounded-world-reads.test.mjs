// bounded-world-reads.test.mjs — falsifiers for the bounded WORLD reads (2026-08-25).
//
// The world lane's half of the bounded-list wave. The town reads' falsifiers
// live in bounded-reads.test.mjs; the laws are the same three, and each test
// below quotes the one it asserts:
//
//   "A bound and its count are ONE change, never two."
//   "A budget decides how much gets said; it must not decide what is true."
//   Bound by MEANING, not by truncation that changes truth.
//
// Every fixture here is deliberately LARGER than the bound it tests — a fixture
// that fits inside the bound would make this file green against the defect.
//
// These are unit falsifiers over the pure shaping functions, deliberately: the
// live class roster and the walkers roll both come from a hydrated world store,
// and a test that could only reach them through one would assert nothing in an
// environment with no store — exactly the environment CI runs in.

import test from "node:test";
import assert from "node:assert/strict";
import { walkersAround, markPage, diagnosticEyes, WORLD_TOOLS } from "../src/world.mjs";
import { fieldsFor, foldLongEnums } from "../src/world-apex.mjs";

test("walkers: bounded BY RADIUS, and the roll is never truncated", () => {
  // Bound by MEANING, not by truncation that changes truth: the roll injection
  // is what closed #1864, so it stays whole and the RENDER gets a radius.
  const roll = [];
  for (let i = 0; i < 132; i++) roll.push({ handle: `w${i}`, x: i * 100, y: 0 });
  const near = walkersAround(roll, { x: 0, y: 0, radiusM: 500, limit: 10 });
  assert.equal(near.count, 6, "0,100,200,300,400,500 metres out");
  assert.equal(near.shown, 6);
  assert.equal(near.capped, false);
  assert.equal(near.beyond_radius, 126);
  assert.equal(near.roll, 132, "THE FALSIFIER: the whole roll stays countable from the answer");
  assert.equal(near.count + near.beyond_radius, near.roll, "nobody is lost between the two numbers");
  assert.deepEqual(near.walkers.map((w) => w.handle), ["w0", "w1", "w2", "w3", "w4", "w5"]);
});

test("walkers: a crowd inside the radius is CAPPED, and says so", () => {
  // "A cap must be visible": a crowded street and an empty one must not read
  // the same way. presentNear's shape, and its lesson.
  const crowd = [];
  for (let i = 0; i < 40; i++) crowd.push({ handle: `w${i}`, x: i, y: 0 });
  const near = walkersAround(crowd, { x: 0, y: 0, radiusM: 500, limit: 10 });
  assert.equal(near.count, 40, "everyone who qualified");
  assert.equal(near.shown, 10, "everyone rendered");
  assert.equal(near.capped, true);
  assert.notEqual(near.count, near.shown, "THE FALSIFIER: the two numbers can and do differ");
  assert.equal(near.beyond_radius, 0, "a cap is not a radius — they are different reasons to say less");
});

test("walkers: the radius note prints the whole roll's PUBLIC path, keyless (postmark#3138)", () => {
  // Marigold fetched https://postmark.town/world/walkers and met nginx's 404:
  // the office is mounted under /api/, and the note printed the office-internal
  // path. A note that names a door must name it the way the public reaches it.
  const near = walkersAround([{ handle: "far", x: 90000, y: 0 }], { x: 0, y: 0, radiusM: 500, limit: 10 });
  assert.ok(near.note.includes("GET https://postmark.town/api/world/walkers"), near.note);
  assert.ok(!near.note.includes("GET /world/walkers"), "the office-internal path 404s at the public domain");
});

test("walkers: an empty street is not a cap", () => {
  const near = walkersAround([{ handle: "far", x: 90000, y: 0 }], { x: 0, y: 0, radiusM: 500, limit: 10 });
  assert.equal(near.count, 0);
  assert.equal(near.capped, false);
  assert.equal(near.beyond_radius, 1, "nobody near you, and one person somewhere — a real state, not an empty read");
});

test("my marks: the page is bounded and every withheld mark is NAMED, not dropped", () => {
  // investigate's discipline: a read that refuses to expand and instead names
  // what it withheld. Nothing becomes unreachable.
  const marks = [];
  for (let i = 0; i < 85; i++) marks.push({ id: `me/mark-${String(i).padStart(3, "0")}`, body: "x".repeat(200) });
  const p = markPage(marks, 0);
  assert.equal(p.page.length, 20);
  assert.equal(p.rest.length, 65);
  assert.equal(p.complete, false);
  assert.equal(p.page.length + p.rest.length, 85,
    "THE FALSIFIER: every mark is either shown or named — none is silently gone");
  const named = new Set([...p.page.map((m) => m.id), ...p.rest]);
  assert.equal(named.size, 85);
  // and walking does not lose the ones you already passed
  const second = markPage(marks, 20);
  assert.equal(second.page[0].id, "me/mark-020");
  assert.equal(second.page.length + second.rest.length, 85);
});

test("my marks: a shelf shorter than the page is complete, and withholds nothing", () => {
  const p = markPage([{ id: "me/only" }], 0);
  assert.equal(p.page.length, 1);
  assert.equal(p.rest.length, 0);
  assert.equal(p.complete, true);
});

test("the action card folds a registry-length enum into a count and a pointer", () => {
  // A registry-length enum is a READ of its own, not a field annotation: 129
  // class names, 2 KB, riding every orientation read whether or not the caller
  // was leaving a mark.
  //
  // Asserted against a SYNTHETIC roster, not the live one: `classNames()` reads
  // the world store, and CI has none hydrated, so a test routed through
  // `fieldsFor` would find a short enum, decline to fold, and pass while
  // proving nothing — the vacuous-assertion trap in a new costume.
  const long = Array.from({ length: 129 }, (_, i) => `class-${i}`);
  const props = {
    class: { type: "string", enum: long, description: "classed marks" },
    status: { type: "string", enum: ["open", "done"], description: "open or done" },
    slug: { type: "string", description: "no enum at all" },
  };
  const out = foldLongEnums(props);
  assert.ok(out.class, "the field itself stays — only the list behind it folds");
  assert.equal(out.class.enum, undefined, "the 129-name list is not on the card");
  assert.equal(out.class.enum_count, 129, "the count is what the card carries instead");
  assert.match(out.class.enum_note, /129 values/);
  assert.equal(out.class.type, "string", "everything else about the field is untouched");
  assert.equal(out.class.description, "classed marks");
  // A SHORT enum is left exactly alone — folding a two-value enum would cost a
  // reader the answer and save nothing.
  assert.deepEqual(out.status.enum, ["open", "done"]);
  assert.deepEqual(out.slug, props.slug);
  assert.ok(JSON.stringify(out).length < JSON.stringify(props).length);
  // AND THE CONTRACT HALF: the flat tool's own schema keeps the whole list, so
  // tools/list still advertises exactly what the runtime accepts. A card is
  // documentation; a schema is a contract, and only the card folds.
  const flat = WORLD_TOOLS.find((t) => t.name === "world_leave_mark");
  assert.ok(Array.isArray(flat.inputSchema.properties.class.enum),
    "THE FALSIFIER: fold the schema too and this goes red — a schema promising a smaller world than the runtime accepts is the defect this enum was written to prevent");
});

test("fieldsFor routes the card through the fold", () => {
  // The wiring, asserted separately from the folding: whatever the live roster
  // holds, no field on a card may carry an enum longer than the fold threshold.
  for (const action of ["leave-mark", "walk", "say"]) {
    for (const [name, spec] of Object.entries(fieldsFor(action))) {
      assert.ok(!Array.isArray(spec?.enum) || spec.enum.length <= 12,
        `${action}.${name} carries an unfolded ${spec?.enum?.length}-value enum on its card`);
    }
  }
});

test("the diagnostic eye references fov rather than restating it", () => {
  // Verified before it was written: radial.byBearing held byte-identical rows
  // to fov's, at three standpoints. So the organisation stays and the bodies
  // become ids — a reference replacing a restatement, not a bound cutting a
  // list. Nothing here has to be fetched: every id resolves in the same answer.
  const row = (id) => ({ id, kind: "sited", body: "x".repeat(300), at: { x: 1, y: 2 }, distM: 10 });
  const full = {
    fov: { carried: [row("a/one"), row("a/two")], far: [row("a/three")] },
    radial: { counts: { visible: 3 }, byBearing: {
      ESE: { "across the way": [row("a/one"), row("a/two")] },
      NW: { "far off": [row("a/three")] },
    } },
  };
  const out = diagnosticEyes(full);
  assert.deepEqual(out.radial.byBearing.ESE["across the way"], { count: 2, ids: ["a/one", "a/two"] });
  assert.deepEqual(out.radial.byBearing.NW["far off"], { count: 1, ids: ["a/three"] });
  assert.deepEqual(out.fov, full.fov, "fov is untouched — it is where the rows live");
  assert.match(out.radial.byBearing_note, /3 duplicate rows/);
  assert.ok(JSON.stringify(out).length < JSON.stringify(full).length, "the restatement is what was costing bytes");
  // every id the radial block names still resolves inside the same answer
  const have = new Set([...out.fov.carried, ...out.fov.far].map((o) => o.id));
  for (const bands of Object.values(out.radial.byBearing)) {
    for (const band of Object.values(bands)) {
      for (const id of band.ids) assert.ok(have.has(id), `${id} must still resolve in fov`);
    }
  }
});

test("the diagnostic eye leaves an answer with no radial block exactly as it found it", () => {
  const bare = { fov: { carried: [] }, telling: "quiet" };
  assert.deepEqual(diagnosticEyes(bare), bare);
});
