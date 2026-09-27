// next-steps.test.mjs — the doorstep's next-steps block, and the #1940 guard.
//
// THE LAW THESE ASSERT, quoted verbatim from the planted constitutional node
// (`doorstep`, class, 2026-08-19) rather than paraphrased:
//
//   "The morning page the town writes for a reader — their state, their next
//    steps, the day; generated fresh by the town's own hand."
//
// Two clauses do the work here. "THEIR NEXT STEPS" is the field this suite
// proves the office door now carries. "THE TOWN'S OWN HAND" is why the office
// owns almost none of the derivation: every step's sentence comes from the
// town's tools/quest-progress.mjs, imported live from the checkout, the same
// way questBoardFor already imports boardForHandle. The office contributes the
// two facts the town checkout cannot see for itself — the world block and the
// household-apex paper gaps — and nothing else.
//
// THE #1940 GUARD is the other half, and it is mechanical on purpose. A
// checklist may never point at a door that will not open: #1940 was exactly
// that failure (a paper gap naming the retired region door), and prose review
// did not catch it. So every verb the next-steps text names is diffed against
// the office's ACTUAL dispatch tables — the MCP tool list, HOUSEHOLD_DISPATCHABLE,
// and the world apex's DISPATCHABLE — rather than eyeballed.
//
// The town checkout is the same one the office serves from (TOWN_CLONE). This
// suite therefore depends on the town branch being merged FIRST, which is the
// merge order the gold plan sets: town → office → site.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TOOLS } from "../src/mcp.mjs";
import { HOUSEHOLD_DISPATCHABLE, householdDispatchToolFor, paperGapRows, worldSitedFor } from "../src/household-apex.mjs";
import { DISPATCHABLE as WORLD_DISPATCHABLE, dispatchToolFor as worldDispatchToolFor } from "../src/world-apex.mjs";
import { WORLD_WRITE_VERBS } from "../src/bouncer.mjs";
import { nextStepsFor } from "../src/queries.mjs";
import { fixtureDb } from "./fixture.mjs";
import { townClone } from "./fixture-paths.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
// The office's own resolution order, plus the checkout test/quests.test.mjs
// already reads live. A MISSING clone fails loudly rather than skipping: a
// guard that quietly opts out of running is worth less than no guard.
const TOWN = townClone() ?? resolve(ROOT, "town-clone");

const registry = () => {
  const p = join(TOWN, "quest-registry.json");
  assert.ok(existsSync(p),
    `no town checkout at ${TOWN} — set TOWN_CLONE. The office imports the town's quest law live; there is nothing to guard without it.`);
  return JSON.parse(readFileSync(p, "utf8"));
};
const oneTimeRows = () => {
  const rows = registry().quests.filter((q) => q.cadence === "one-time");
  assert.ok(rows.length > 0,
    `the town checkout at ${TOWN} carries no one-time onboarding rows — merge the town branch first (gold plan order: town → office → site)`);
  return rows;
};

// ── the #1940 guard — every named door is a door that opens ─────────────────

const mcpToolNames = new Set(TOOLS.map((t) => t.name));
const householdActTools = new Set(HOUSEHOLD_DISPATCHABLE.map(householdDispatchToolFor));
const worldActTools = new Set(WORLD_DISPATCHABLE.map(worldDispatchToolFor));
const knownVerbs = new Set([...mcpToolNames, ...householdActTools, ...worldActTools, ...WORLD_WRITE_VERBS]);

test("#1940: every verb the next-steps rows name is a verb this office actually dispatches", () => {
  for (const q of oneTimeRows()) {
    if (!q.door) continue;
    assert.ok(knownVerbs.has(q.door.tool),
      `row "${q.id}" names the verb "${q.door.tool}", which no door of this office dispatches — #1940 exactly: a checklist pointing at a door that will not open`);
  }
});

test("#1940: every apex act the rows name is in that apex's OWN dispatch table, and names that act's own tool", () => {
  for (const q of oneTimeRows()) {
    if (!q.door?.apex) continue;
    if (q.door.apex === "household") {
      assert.ok(HOUSEHOLD_DISPATCHABLE.includes(q.door.act),
        `row "${q.id}": household { do: "${q.door.act}" } is not a household act — the door would bounce it`);
      assert.equal(householdDispatchToolFor(q.door.act), q.door.tool,
        `row "${q.id}": the household act and the flat verb it is charged as must be the same act`);
    } else if (q.door.apex === "world") {
      assert.ok(WORLD_DISPATCHABLE.includes(q.door.act),
        `row "${q.id}": world { do: "${q.door.act}" } is not a world act — the door would bounce it`);
      assert.equal(worldDispatchToolFor(q.door.act), q.door.tool,
        `row "${q.id}": the world act and the flat verb it is charged as must be the same act`);
    } else {
      assert.fail(`row "${q.id}": apex "${q.door.apex}" is not a door this office has`);
    }
  }
});

test("#1940: a row with NO door of its own says what it awaits — it never borrows one that would refuse", () => {
  for (const q of oneTimeRows()) {
    if (q.door) continue;
    assert.equal(typeof q.awaits, "string");
    assert.ok(q.awaits.length > 0,
      `row "${q.id}" names no door and says nothing about what it waits on — silence here reads as "you forgot to do this"`);
  }
});

test("the guard can see a bad door — a fabricated verb is caught, so the pass above means something", () => {
  const fake = { id: "walk-the-region", door: { apex: "household", act: "region", tool: "update_region" } };
  assert.ok(!knownVerbs.has(fake.door.tool), "update_region is the #1940 verb itself — retired, and still not dispatched");
  assert.ok(!HOUSEHOLD_DISPATCHABLE.includes(fake.door.act), "and `region` is not a household act");
});

// ── "their next steps" — the field the office door now carries ──────────────

const META = () => ({ quest_registry: JSON.stringify(registry()), quest_day: "1970-01-01" });

test("the office's next_steps derives from the TOWN's own tool — every step, its shape", async () => {
  const db = fixtureDb();
  const ns = await nextStepsFor(db, META(), "wright", TOWN);
  assert.ok(ns, `nextStepsFor returned null — the checkout at ${TOWN} has no composeNextSteps; merge the town branch first`);
  assert.ok(Array.isArray(ns.steps));
  assert.match(ns.source, /tools\/quest-progress\.mjs/, "the block names the town tool it derives from");
  for (const s of ns.steps) {
    assert.ok(["onboarding", "paper", "quest"].includes(s.kind), `unknown step kind ${s.kind}`);
    assert.equal(typeof s.id, "string");
    assert.equal(typeof s.what, "string");
    assert.ok(s.door === null || typeof s.door.tool === "string", `${s.id}: a door is a named verb or nothing`);
    assert.ok(s.door || s.awaits, `${s.id}: a step with no door must say what it awaits`);
  }
});

test("every door in a LIVE next_steps answer is dispatchable — the guard, run against real output", async () => {
  const db = fixtureDb();
  const ns = await nextStepsFor(db, META(), "wright", TOWN);
  assert.ok(ns);
  for (const s of ns.steps) {
    if (!s.door) continue;
    assert.ok(knownVerbs.has(s.door.tool), `the live doorstep offered "${s.door.tool}", which no door dispatches`);
  }
});

// Every gap this office can raise, forced to fire at once: a handle the index
// does not know (no home), a clone with no WHITE_PAGES (no window hung), and an
// unsited world. Enumerating them is the point — a gap that fires only in the
// wild cannot be diffed against the town's vocabulary.
async function allPaperGapIds() {
  const bare = mkdtempSync(join(tmpdir(), "no-town-"));
  try {
    const rows = await paperGapRows("nobody-by-this-name", {
      db: fixtureDb(), clone: bare, worldBlock: async () => ({ sited: false }),
    });
    return rows.map((r) => r.id);
  } finally { rmSync(bare, { recursive: true, force: true }); }
}

test("one obligation, one voice: every paper-gap id is one the town's onboarding line owns", async () => {
  const known = new Set(oneTimeRows().map((q) => q.id));
  const ids = await allPaperGapIds();
  assert.ok(ids.length >= 3, "all three gaps fire when forced — otherwise this test proves nothing");
  for (const id of ids) {
    assert.ok(known.has(id),
      `paper gap "${id}" is not a town onboarding row id, so composeNextSteps cannot drop it — it will be spoken TWICE, once in the office's wording and once in the town's. That is HAL's July-30 wound in a new mouth. Either give the gap the town row's id, or add the row.`);
  }
});

test("one obligation, one voice: composeNextSteps drops the overlap rather than appending it", async () => {
  const db = fixtureDb();
  const ns = await nextStepsFor(db, META(), "wright", TOWN);
  assert.ok(ns);
  const byId = new Map();
  for (const s of ns.steps) byId.set(s.id, (byId.get(s.id) ?? 0) + 1);
  for (const [id, n] of byId) assert.equal(n, 1, `"${id}" appears ${n} times on a live doorstep`);
  // and directly, with the overlap forced: the town's composer must keep the
  // onboarding voice and drop the paper one.
  const tools = await import(pathToFileURL(join(TOWN, "tools", "quest-progress.mjs")).href);
  const onboarding = tools.onboardingBoard(registry(), { card: false, home: false, window: false, sent: false, received: false }, "ada", { worldSited: false });
  const { steps } = tools.composeNextSteps({
    onboarding,
    paperRows: (await allPaperGapIds()).map((id) => ({ id, text: `the office's own wording for ${id}` })),
  });
  for (const id of await allPaperGapIds()) {
    const voices = steps.filter((s) => s.id === id);
    assert.equal(voices.length, 1, `"${id}" is spoken ${voices.length} times`);
    assert.equal(voices[0].kind, "onboarding", `"${id}" must be spoken by the town's row, not the office's gap`);
  }
});

test("paperGapRows keeps the sentences paperGaps has always returned", async () => {
  const db = fixtureDb();
  const { paperGaps } = await import("../src/household-apex.mjs");
  const rows = await paperGapRows("limen", { db, clone: TOWN });
  const flat = await paperGaps("limen", { db, clone: TOWN });
  assert.deepEqual(rows.map((r) => r.text), flat, "the id-carrying shape and the sentence shape are the same list");
  for (const r of rows) assert.match(r.id, /^[a-z][a-z0-9-]*$/, "every gap knows what it is a gap in");
});

test("an unreadable world is null, never a quiet false — the disclosure guard", async () => {
  const sited = await worldSitedFor("nobody-by-this-name", { worldBlock: async () => ({ sited: false, unreadable: true }) });
  assert.equal(sited, null, "a degraded read is unknown, not unplaced");
  assert.equal(await worldSitedFor("x", { worldBlock: async () => ({ sited: false }) }), false);
  assert.equal(await worldSitedFor("x", { worldBlock: async () => ({ sited: true }) }), true);
  assert.equal(await worldSitedFor("x", { worldBlock: async () => { throw new Error("world down"); } }), null,
    "a throwing world read is unknown too — never an implicit no");
});

// ── the 08-15 gate — "not theirs to be seen by" ─────────────────────────────
//
// THE RULING THESE ASSERT, quoted verbatim (Keemin, 2026-08-15, the grouping
// that put the paper gaps on the doorstep in the first place):
//
//   "the gaps are yours to see, not theirs to be seen by"
//
// settling_in has been gated on that sentence since the day it landed. The
// next-steps block carries the same class of fact, so its GAP-SHAPED half rides
// the same gate: a read of a doorstep the caller's key does not act for carries
// what the PUBLIC bundle at postmark.town/data/doorstep/<handle>.md carries —
// the town's quest-registry rows — and not the two things that page cannot see:
// the office's paper gaps, and whether the resident's home is sited in the
// world. Match the static page's line; never exceed it.
//
// The gate is a SKIP, not a filter. These tests prove that with a counting
// worldBlock: on a foreign read the office must not so much as look the fact up.

const countingWorld = (verdict) => {
  const spy = { calls: 0 };
  spy.block = async (h) => { spy.calls++; return verdict; };
  return spy;
};

test('08-15: a foreign read never even LOOKS UP the gaps — "not theirs to be seen by"', async () => {
  const db = fixtureDb();
  const spy = countingWorld({ sited: false });
  const ns = await nextStepsFor(db, META(), "wright", TOWN, { own: false, worldBlock: spy.block });
  assert.ok(ns, "the block still rides — what the public page shows is not a secret");
  assert.equal(spy.calls, 0,
    "a stranger's read must not consult the world record at all; a fact never looked up cannot leak through a later refactor of a filter");
  assert.ok(!ns.steps.some((s) => s.id === "walk-the-world"),
    "world-siting is gap-shaped and the static page cannot see it — so a foreign office read must not either");
  assert.ok(!ns.steps.some((s) => s.kind === "paper"),
    "and no household-apex paper gap rides a foreign read");
  assert.match(ns.withheld ?? "", /yours to see, not theirs to be seen by/,
    "the withholding is disclosed and cites the ruling, rather than silently shrinking the list");
});

test("08-15: your OWN read carries the gaps — the gate withholds from strangers, not from you", async () => {
  const db = fixtureDb();
  const spy = countingWorld({ sited: false });
  const ns = await nextStepsFor(db, META(), "wright", TOWN, { own: true, worldBlock: spy.block });
  assert.ok(ns);
  assert.ok(spy.calls > 0, "your own door does read the world for you");
  assert.ok(ns.steps.some((s) => s.id === "walk-the-world"),
    "an unsited resident reading their OWN doorstep is told to go walk their ground");
  assert.equal(ns.withheld, undefined, "nothing is withheld from you on your own doorstep");
});

test("08-15: the two reads differ ONLY by the gap-shaped rows — the gate is narrow", async () => {
  const db = fixtureDb();
  const mine = await nextStepsFor(db, META(), "wright", TOWN, { own: true, worldBlock: countingWorld({ sited: false }).block });
  const theirs = await nextStepsFor(db, META(), "wright", TOWN, { own: false, worldBlock: countingWorld({ sited: false }).block });
  const ids = (ns) => ns.steps.map((s) => s.id);
  const gapShaped = new Set(["walk-the-world"]);
  assert.deepEqual(ids(theirs), ids(mine).filter((id) => !gapShaped.has(id)),
    "a stranger loses the gap rows and NOTHING else — the onboarding line and the daily quests are the public page's own content");
  assert.ok(ids(theirs).length > 0, "…and a foreign read is not emptied out; it is the static page's line, which is the point");
});

test("08-15: the gate defaults CLOSED — a caller that forgets to say whose door it is gets the stranger's answer", async () => {
  const db = fixtureDb();
  const spy = countingWorld({ sited: false });
  const ns = await nextStepsFor(db, META(), "wright", TOWN, { worldBlock: spy.block });
  assert.equal(spy.calls, 0, "no `own` flag means not yours — the safe default is the one that discloses less");
  assert.ok(ns.withheld, "and it says so");
});

test("the block never throws — an unreadable handle costs the doorstep nothing", async () => {
  const db = fixtureDb();
  // The two doors attach this as a garnish; a rejected promise there would take
  // a whole doorstep down over a checklist. Every failure mode must be a value.
  const ns = await nextStepsFor(db, META(), "nobody-by-this-name", TOWN);
  assert.ok(ns === null || Array.isArray(ns.steps), "a value, never a rejection");
  const noRegistry = await nextStepsFor(db, {}, "wright", TOWN);
  assert.ok(noRegistry === null || noRegistry.steps.length === 0,
    "an index with no quest_registry in meta yields nothing to do, not a crash");
});

test("the town tool is imported once per process — one office, one checkout", async () => {
  // questTools caches the imported module: the office serves exactly one town
  // clone for its life, and re-resolving per request would be a filesystem hit
  // on every doorstep. Worth pinning, because it also means the "checkout too
  // old to carry the fold" degradation is decided at the FIRST import of the
  // process and cannot be exercised after one has succeeded — the null path in
  // nextStepsFor is a boot-time guarantee, not a per-call one.
  const { questBoardFor } = await import("../src/queries.mjs");
  const db = fixtureDb();
  const a = await questBoardFor(db, META(), "wright", TOWN);
  const b = await questBoardFor(db, META(), "wright", join(TOWN, "no-such-checkout"));
  assert.deepEqual(a.quests.map((q) => q.id), b.quests.map((q) => q.id),
    "the second call answers from the cached module, not from the bogus path");
});

// Guards the import wiring itself: the town module must be reachable from the
// checkout path the office is pointed at, by the same URL scheme the office uses.
test("the town's quest-progress.mjs is importable from the clone the office serves", async () => {
  const mod = await import(pathToFileURL(join(TOWN, "tools", "quest-progress.mjs")).href);
  for (const fn of ["composeNextSteps", "onboardingBoard", "onboardingFactsFor", "boardForHandle", "townDay"]) {
    assert.equal(typeof mod[fn], "function", `the town tool must export ${fn} — the office imports it live`);
  }
});
