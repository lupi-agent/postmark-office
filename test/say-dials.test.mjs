// say-dials.test.mjs — speech's numbers come off the record, and say so.
//
// RULING B (Keemin, 2026-08-22), verbatim: "let's update those dials for
// 'say'... make everything pull the actual numbers from there too. I think the
// predicates should be under the say edge rather than the residue, as we may
// rule future sounds differently."
//
// WHY THIS REFUSES TO RUN ON A FIXTURE ALONE. The slow-walk bug is the standing
// postmortem for this exact seam: `departurePace` asked the store for a class
// named "departure", the class had been renamed "depart", `classDials` answered
// `{}` because absence is neutrality, and every walker in the world moved at a
// quarter of the lawful stride for five days while the tests stayed green. A
// fixture that builds its own nodes answers to whatever name the fixture uses,
// so it can only prove the code agrees with itself. These read the HYDRATED
// STORE — world.db, or WORLD_STORE_DB — and when there is none they SKIP with a
// reason rather than passing on a fallback, because a green test standing on a
// fallback is the bug it is meant to catch.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { CLASS_GATE_C, classDials, classPredicates, dialNode, dialNumber } from "../src/world-classes.mjs";
import { CLASS_ROSTER_GATE_SQL } from "../src/world-store.mjs";
import { NO_WORLD, worldClone } from "./fixture-paths.mjs";
import { hydrateWorldRows, publishWorld, withNoWorld, writeFixtureDb } from "./helpers/world-rows.mjs";

// THE RECORD, AS ROWS (POS-270 lane W 3b). world.db is retired, so the world
// this file reads is the checkout's newest blessing, hydrated to rows and
// published as the world graph snapshot; the SQL cross-checks below ask the
// test's own sqlite, built from the same rows. No checkout, no world: the
// record-reading block skips by name rather than pass on a fallback.
const WORLD_DIR = mkdtempSync(join(tmpdir(), "say-dials-"));
after(() => rmSync(WORLD_DIR, { recursive: true, force: true }));
let DB = null;
if (!NO_WORLD) {
  const rows = hydrateWorldRows({ clone: worldClone(), ref: "blessed", dir: WORLD_DIR });
  publishWorld(rows, "the newest blessing");
  DB = writeFixtureDb(rows, join(WORLD_DIR, "world.db"));
}

// The class name lives beside its reader in voices.mjs, for the same reason
// STRIDE_CLASS_NAME lives beside departurePace — one place to rename, one test
// that fails when the record renames out from under it. voices.mjs reads its
// dials when it loads, so it loads AFTER the world is published.
const { SAY_CLASS_NAME } = await import("../src/voices.mjs");
const haveStore = DB != null;
const storeHasSay = haveStore && (() => {
  try {
    const db = new DatabaseSync(DB, { readOnly: true });
    const row = db.prepare(
      `SELECT 1 AS ok FROM nodes WHERE ${CLASS_ROSTER_GATE_SQL} AND json_extract(props, '$.class') = 'say' LIMIT 1`).get();
    db.close();
    return Boolean(row?.ok);
  } catch { return false; }
})();

// The seven slots speech reads, and the values the RECORD carries for them —
// read here by the test's own SQL over the say class's predicate children, not
// pinned: these numbers are law, and a copy of law in a test is a copy that
// decays (it did: this file asserted fade_min 5 for weeks after the record said
// 15, unseen, because it only ever ran beside a hand-hydrated world.db).
const SLOTS = ["earshot_m", "fade_min", "conversation_lull_min", "speak_every_s", "text_max", "hear_max", "presence_min"];
const EXPECTED = DB == null ? {} : (() => {
  const db = new DatabaseSync(DB, { readOnly: true });
  try {
    const rows = db.prepare(`SELECT json_extract(p.props, '$.slot') AS slot, json_extract(p.props, '$.value') AS value
                                FROM nodes c JOIN edges e ON e.src = c.id AND e.type = 'describes'
                                JOIN nodes p ON p.id = e.dst AND p.subkind = 'predicated'
                               WHERE ${CLASS_GATE_C} AND json_extract(c.props, '$.class') = 'say'`).all();
    return Object.fromEntries(rows.filter((r) => SLOTS.includes(String(r.slot))).map((r) => [String(r.slot), Number(r.value)]));
  } finally { db.close(); }
})();

describe("the say dials, read off the live world store", { skip: storeHasSay ? false : `no world checkout carrying the-town/say at its newest blessing (${NO_WORLD || "the record lacks it"}) — skipping rather than passing on a fallback, which is the bug this file exists to catch` }, () => {
  test("every one of speech's seven numbers reads from the record", () => {
    assert.deepEqual(Object.keys(EXPECTED).sort(), [...SLOTS].sort(), "the record does not carry all seven of speech's slots");
    const preds = classPredicates(SAY_CLASS_NAME);
    for (const [slot, want] of Object.entries(EXPECTED)) {
      const d = dialNumber(SAY_CLASS_NAME, slot, -1, { min: 0 });
      assert.equal(d.source, "record", `${slot} fell back to a constant — the record did not answer`);
      assert.equal(d.read, true, `${slot} did not read`);
      assert.equal(d.value, want, `${slot} read ${d.value}, the node declares ${want}`);
      assert.ok(Object.hasOwn(preds, slot), `${slot} is not among the say edge's predicates`);
    }
  });

  test("the module's exported constants ARE the record's numbers, in the module's own units", async () => {
    const v = await import("../src/voices.mjs");
    assert.equal(v.EARSHOT_M, EXPECTED.earshot_m);
    assert.equal(v.FADE_MS, EXPECTED.fade_min * 60_000);
    assert.equal(v.CLOSE_MS, EXPECTED.conversation_lull_min * 60_000);
    assert.equal(v.SPEAK_EVERY_MS, EXPECTED.speak_every_s * 1000);
    assert.equal(v.PRESENCE_MS, EXPECTED.presence_min * 60_000);
    assert.equal(v.TEXT_MAX, EXPECTED.text_max);
    assert.equal(v.HEAR_MAX, EXPECTED.hear_max);
    // and the honest half: nothing fell back, so there is nothing to disclose
    assert.equal(v.sayDialsDisclosure(), null,
      "a dial fell back to this repo's old constant — the disclosure must never be silent about that");
    for (const [slot, d] of Object.entries(v.SAY_DIALS)) {
      assert.equal(d.source, "record", `${slot} is standing on a fallback`);
    }
  });

  // ── the id a surface PUBLISHES must be one the record carries ──────────────
  //
  // `PRESENCE_DIAL_NODE` is where a surface sends a resident to read the law
  // that governed a presence_min answer. It used to be built from the class
  // name and the lookup key — `the-town/say/presence_min` — which is wrong
  // three ways at once: no world id has two slashes, a dial is a SIBLING of its
  // class, and the record spells the name with a hyphen where the key uses an
  // underscore. Its falsifier compared the published string to the same string
  // typed again, so it locked the error in instead of catching it. This
  // resolves the published id AGAINST THE RECORD, in the one file that refuses
  // to run on a fixture — because a fixture answers to whatever name the
  // fixture used, which is the same circularity that let the wrong id ship.
  //
  // ⚑ ITS FIRST PUBLISHER WAS `available`, and that derived is parked
  // (2026-09-10, the founder's word; world#19 reverted, office half on
  // `wright/parked-proposals-office`). The export and this falsifier both STAY:
  // the id-resolution bug they exist for is a property of how a dial node is
  // NAMED, not of who happened to publish it first, and the next surface to
  // send a reader to presence_min would otherwise rediscover it. The test's
  // name no longer claims a publisher that does not exist.
  test("the presence_min dial node this office publishes is one the record actually carries", async () => {
    const { PRESENCE_DIAL_NODE } = await import("../src/voices.mjs");
    assert.notEqual(PRESENCE_DIAL_NODE, null,
      "the store carries the-town/say, so it must be able to name where presence_min stands");

    const db = new DatabaseSync(DB, { readOnly: true });
    const row = db.prepare("SELECT json_extract(props, '$.slot') AS slot FROM nodes WHERE id = ?")
      .get(PRESENCE_DIAL_NODE);
    db.close();
    assert.ok(row, `the published id "${PRESENCE_DIAL_NODE}" is not a node in the record — a reader sent there finds nothing`);
    assert.equal(String(row.slot), "presence_min",
      "and the node it names must be the one that carries THIS slot, not merely some node that exists");

    // The grammar, said out loud: a world id is `<by>/<name>` and nothing
    // deeper. The old string had two slashes and would fail here on its shape
    // alone, before any lookup.
    assert.equal(PRESENCE_DIAL_NODE.split("/").length, 2,
      `world ids are flat — "${PRESENCE_DIAL_NODE}" is not an id, it is a path`);
  });

  test("a slot the record does not carry names no node — the read cannot invent one", () => {
    assert.equal(dialNode(SAY_CLASS_NAME, "a-dial-no-record-carries"), null,
      "absence answers null; a plausible id would send a reader somewhere that does not exist and look authoritative doing it");
  });

  test("the class this reader asks for is the class the record declares (the departure→depart guard)", () => {
    const db = new DatabaseSync(DB, { readOnly: true });
    const names = db.prepare(
      `SELECT json_extract(props, '$.class') AS c FROM nodes WHERE ${CLASS_ROSTER_GATE_SQL}`).all().map((r) => String(r.c));
    db.close();
    assert.ok(names.includes(SAY_CLASS_NAME),
      `SAY_CLASS_NAME is "${SAY_CLASS_NAME}", which the record does not declare — this is the rename that slowed the town, caught at the name instead of in the street`);
  });
});

test("an absent dial falls back, and NEVER pretends it read", () => {
  const d = dialNumber(SAY_CLASS_NAME, "a-dial-no-record-carries", 4242, { min: 0 });
  assert.equal(d.value, 4242);
  assert.equal(d.read, false);
  assert.equal(d.source, "fallback");
});

test("no world names no dial node — and that is the SAME condition as the fallback", async () => {
  await withNoWorld(() => {
    assert.equal(dialNode(SAY_CLASS_NAME, "presence_min"), null);
    assert.equal(dialNumber(SAY_CLASS_NAME, "presence_min", 15).source, "fallback",
      "the two must agree: a surface carrying both says one thing — we are on a constant, and there is no node to point you at");
  });
});

test("no world falls back for every dial, and the disclosure names them", async () => {
  const d = await withNoWorld(() => dialNumber(SAY_CLASS_NAME, "earshot_m", 999));
  assert.equal(d.source, "fallback", "a world that has not loaded must not answer as the record");
  assert.equal(d.value, 999);
});

test("classDials keeps its old meaning — frontmatter only, predicates are their own question", () => {
  // Every dial is a predicate does not say every predicate is a dial: say's
  // `clocks` clause and doorstep's `psa-fold` clause are law, not knobs, and a
  // dials map that carried them would let a sentence answer to a number's name.
  const frontmatter = classDials(SAY_CLASS_NAME);
  assert.equal(Object.hasOwn(frontmatter, "earshot_m"), false,
    "classDials must not have grown a predicate reader — that is classPredicates' question");
});

test("CLASS_GATE_PARITY: the aliased gate in world-classes carries the roster gate's every clause", async () => {
  // world-classes.mjs spells the roster gate a second time against the `c`
  // alias. It used to spell the POSITION clause a second time too, by hand,
  // because deriving it by string surgery would have rewritten a bare `props`.
  // The freeze re-key (2026-08-25) killed that copy: `worksClause(alias)` takes
  // its alias, so both readers now run the SAME implementation of "standing in
  // the Keeping Works". The four remaining clauses are still spelled twice, so
  // they are still compared here: if the roster gate grows a fifth condition,
  // this goes red instead of the read going narrow.
  const { CLASS_GATE_C } = await import("../src/world-classes.mjs");
  const norm = (s) => s.replace(/\bc\./g, "").replace(/\s+/g, " ").trim();
  assert.equal(norm(CLASS_GATE_C), norm(CLASS_ROSTER_GATE_SQL),
    "the aliased gate and CLASS_ROSTER_GATE_SQL have drifted — one of them is now reading a different set of class marks");
});

test("CLASS_GATE_PARITY: the position clause is SHARED, not hand-copied (the freeze re-key)", async () => {
  // The bite this closes: two copies of a security boundary, and only one of
  // them re-keyed when the law moved. "A mark's directory is its historical
  // filing: it carries no claim" — so a hand-written path substring anywhere in
  // the class gates is the pre-freeze law surviving in a second file.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/world-classes.mjs", import.meta.url), "utf8");
  const gate = /export const CLASS_GATE_C = `([\s\S]*?)`;/.exec(src)?.[1];
  assert.ok(gate, "CLASS_GATE_C not found — did the aliased gate move?");
  assert.match(gate, /\$\{worksClause\("c"\)\}/,
    "the aliased gate must interpolate the shared worksClause, not spell the position clause itself");
  assert.doesNotMatch(gate, /the-keeping-works/,
    "a literal '/the-keeping-works/' in the aliased gate is the hand-copy come back — the freeze re-keyed position off the path");
});
