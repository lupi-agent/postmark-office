// reach-dial.test.mjs — THE REACH'S NUMBER COMES OFF THE RECORD, AND THIS CAN FAIL.
//
// Conductor's directive, 2026-09-07 21:28 EDT: "the 60 m doorstep must be read
// off the record (dialNumber), not the literal you found."
//
// ⚑ WHY THIS IS ITS OWN FILE AND ITS OWN PROCESS. `voices.mjs` reads the say
// dials ONCE, at module load (`SAY_DIALS = readSayDials()`), from whatever
// `storeDbPath()` resolves to then. So a test that proves the record is read has
// to set `WORLD_STORE_DB` BEFORE the first import of that module — which means
// before `reach.mjs`, `world-hold.mjs` or anything else pulls it in. `node
// --test` gives each file its own process, so this file gets a clean registry
// and every import below is dynamic and deliberate.
//
// ⚑ WHY THE EXISTING TEST WAS NOT ENOUGH, and I found this while checking the
// directive rather than after a reviewer did. `test/hold-reach.test.mjs` asserts
// `standsWithin(...).earshot_m === EARSHOT_M` — an IDENTITY. It passes exactly
// as happily if `EARSHOT_M` is a literal 60 as if it is the town's own dial: it
// compares the published number to the same number imported again. That is the
// falsifier-that-cannot-fail this whole lane has been carrying as its lesson,
// sitting in the lane's own suite. The pairing below is what makes it fail: a
// record declaring 137 must move the door to 137, and a record declaring
// nothing must fall back AND SAY SO.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const TMP = mkdtempSync(join(tmpdir(), "reach-dial-"));
// The residue class this house keeps a list of: a fixture without an after()
// leaves a temp directory behind on every run. Named by the reviewer.
test.after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* windows holds it a beat */ } });

const THE_RECORD_SAYS = 137; // not 60, and not a round number anybody would type by habit

test("THE DOOR'S REACH IS THE RECORD'S NUMBER — 137 in the store is 137 at the door", async () => {
  const { SCHEMA } = await import("../src/world-store.mjs");
  const path = join(TMP, "world.db");
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  db.prepare("INSERT INTO meta VALUES (?, ?)").run("hydration_status", "OK");
  db.prepare("INSERT INTO meta VALUES (?, ?)").run("as_of_world", "f00dcafe");
  db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("the-town/say", "mark", "sited", "constitution", "the-town", 0, 0, 50, 40, JSON.stringify({
      class: "say", class_version: 1,
      path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/say/mark.md",
      dials: { earshot_m: THE_RECORD_SAYS },
    }));
  db.close();

  // The record is the world graph snapshot (POS-270 lane W 3a): published from
  // these rows before the chain's first import, and world.db's path points nowhere.
  const { NO_WORLD_DB, publishWorld } = await import("./helpers/world-rows.mjs");
  publishWorld(path);
  process.env.WORLD_STORE_DB = NO_WORLD_DB;
  // FIRST import of the chain, with the env already set — voices.mjs reads here.
  const { EARSHOT_M, standsWithin, withinArmsLength, reachDisclosure } = await import("../src/reach.mjs");

  assert.equal(EARSHOT_M, THE_RECORD_SAYS,
    "the reach is standing on a number this repo typed, not the number the town keeps — a name that does not read its record is a falsifier that cannot fail");
  assert.equal(reachDisclosure(), null, "the record answered, so there is nothing to disclose");

  // AND THE DOOR MOVES WITH IT, which is the half that matters. One metre either
  // side of the RECORD's number, not of 60.
  const mark = { id: "a/b", at: { x: 0, y: 0 }, extent: { w: 1, h: 1 } };
  assert.equal(standsWithin({ x: THE_RECORD_SAYS - 1, y: 0 }, mark).stands, true,
    `${THE_RECORD_SAYS - 1} m is inside the record's own doorstep`);
  assert.equal(standsWithin({ x: THE_RECORD_SAYS + 1, y: 0 }, mark).stands, false,
    `${THE_RECORD_SAYS + 1} m is outside it`);

  // THE DISCRIMINATING PAIR: at the old literal, the door must now ADMIT — 60 is
  // well inside 137. If this line ever fails, the number went back to being typed.
  assert.equal(standsWithin({ x: 60, y: 0 }, mark).stands, true,
    "60 m was refused under a record that says 137 — the literal is back");
  assert.equal(withinArmsLength({ x: 0, y: 0 }, { x: 100, y: 0 }).stands, true,
    "the give's reach must move with the same dial as the take's");
  assert.equal(withinArmsLength({ x: 0, y: 0 }, { x: 200, y: 0 }).stands, false);
});

test("a READ record discloses nothing — silence is the good case, and only here", async () => {
  // ⛔ RETITLED. This was called "an ABSENT record falls back and SAYS SO" and
  // asserted `reachDisclosure() === null`, which is the record having been
  // READ — it proved the opposite of its own name. The reviewer caught it in
  // the file written to close exactly the class of a check whose title claims
  // more than the check does. The absent half is asserted below, on the dial's
  // own flag, which is what actually decides the sentence.
  const { reachDisclosure, EARSHOT_M } = await import("../src/reach.mjs");
  assert.equal(typeof EARSHOT_M, "number");
  assert.equal(reachDisclosure(), null, "this process read the record, so there is nothing to disclose");
});

test("AN ABSENT RECORD falls back to this repo's number and says the sentence a resident would meet", async () => {
  // The other half, driven rather than described. `dialNumber` is the one
  // reader behind `SAY_DIALS`, so pointing it at a store that does not exist
  // is exactly the condition an un-hydrated office is in — and the value it
  // falls back to must be the repo's 60, not the 137 this process read.
  const { dialNumber } = await import("../src/world-classes.mjs");
  const { withNoWorld } = await import("./helpers/world-rows.mjs");
  const fell = await withNoWorld(() => dialNumber("say", "earshot_m", 60, { min: 0 }));
  assert.equal(fell.read, false, "an absent store must not report itself as read");
  assert.equal(fell.source, "fallback");
  assert.equal(fell.value, 60, "and the fallback is this repo's own constant, not the record's 137");

  // The sentence itself, PRODUCED rather than read out of the source. The first
  // draft asserted on `reachDisclosure.toString()`, which is a check on the
  // code's text and not on its behaviour — a flip that made the function return
  // null unconditionally left it green. The dial is a parameter now, so the
  // branch a resident meets is the branch under test.
  const { reachDisclosure } = await import("../src/reach.mjs");
  const said = reachDisclosure(fell);
  assert.ok(said, "an office standing on the repo's constant must SAY so; silence here is the defect");
  assert.match(said, /built-in 60 m/);
  assert.match(said, /npm run hydrate:world/, "a disclosure a resident cannot act on only looks honest");
  assert.equal(reachDisclosure({ read: true, value: 60, source: "record" }), null,
    "and a dial that WAS read discloses nothing — both sides of the branch, in one process");

  // And this process's own dial is still the record's, so the two conditions
  // are held apart rather than blurred.
  const { SAY_DIALS } = await import("../src/voices.mjs");
  assert.equal(SAY_DIALS.earshot_m.read, true);
  assert.equal(SAY_DIALS.earshot_m.source, "record");
  assert.equal(SAY_DIALS.earshot_m.value, THE_RECORD_SAYS,
    "the dial this process read is the one the store declared");
});
