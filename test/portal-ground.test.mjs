// portal-ground.test.mjs — the portal ground's own law, which outlived the arena
// (Keemin closed the arena 2026-09-30; the rooms it was played in are still
// walked: the candle vault "keeps the proof", the cellar door keeps you
// silverware-small at "a stride is a quarter-metre").
//
//   the stride   `walk_min_step` snaps a walk's destination inside the ground,
//                and a ground that declares none snaps nothing
//   the spawn    a ground with `spawn` sets its entrants down inside its own
//                fence, witnessed-jittered, and a spawn outside it is refused
//   the door     `standpoint.portal` carries the room, its space and its stride
//   no fight     no ground keeps a wheel
//
// Ported from the arena suite's portal-ground tests (office train/2026-w41
// before the arena closed), with the fight taken out. The fixture's rooms are
// the town's own shapes: every one is class `portal-ground`, as on the record.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SCHEMA } from "../src/world-store.mjs";
import { cockpitPortal, groundAt, groundAtPoint, snapTo, spawnPointFor, strideOnGround, walkMinStepOf } from "../src/portal-ground.mjs";

const CELLAR = "the-town/the-cellar-door";
const VAULT = "the-town/the-candle-vault";
const ARENA_ROOM = "the-town/an-old-arena";
const PARLOR = "the-town/the-lanternstep-parlor";
// One-room spines: which room a MULTI-room spine answers is the live tie rule,
// restored as it was and put to Wright separately (see portal-ground.mjs § groundAt).
const IN_VAULT = [VAULT];
const IN_ANTECHAMBER = [CELLAR];

function worldDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const ins = db.prepare(`INSERT INTO nodes (id, by, kind, subkind, at_x, at_y, extent_w, extent_h, props) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run("the-town/portal-ground", "the-town", "mark", "class", null, null, null, null, JSON.stringify({ class: "portal-ground", dials: {} }));
  // The parlor first, as the record orders them: it is the one the old
  // class-only rule answered for every hand inside it, the vault's included.
  ins.run(PARLOR, "the-town", "mark", "sited", 1100, -785, 10, 6,
    JSON.stringify({ class: "portal-ground", dials: { guest_hp: 20 }, body: "The Lanternstep parlor — lamplight the color of late honey." }));
  ins.run(CELLAR, "the-town", "mark", "sited", 1097, -785, 5, 5,
    JSON.stringify({ class: "portal-ground", dials: { guest_hp: 20 }, body: "A door in the west wall of a house that has no cellar." }));
  ins.run(VAULT, "the-town", "mark", "sited", 1097, -783.5, 3, 2,
    JSON.stringify({ class: "portal-ground", dials: { walk_min_step: 0.25, spawn: { x: 1097, y: -784.25 } },
      body: "Past the inner door the candles go up in tiers until you cannot see the top of them." }));
  ins.run(ARENA_ROOM, "the-town", "mark", "sited", 1200, -700, 4, 4, JSON.stringify({ class: "arena", dials: {} }));
  return db;
}

test("THE STRIDE: a ground may set its own, and a ground that has not said so says nothing", () => {
  const db = worldDb();
  try {
    const vault = groundAt(db, IN_VAULT), antechamber = groundAt(db, IN_ANTECHAMBER);
    assert.equal(vault.ground, VAULT);
    assert.equal(vault.walk_min_step, 0.25, "the vault's stride is the VAULT's dial");
    assert.equal(walkMinStepOf(db, vault), 0.25);
    assert.equal(antechamber.walk_min_step, null, "the cellar door invented a stride it never declared");
    assert.equal(snapTo(1097.31, 0.25), 1097.25);
    assert.equal(snapTo(1097.4, 0.25), 1097.5);
    assert.equal(snapTo(1097.3, 1), 1097);
    assert.equal(String(snapTo(-784.3, 0.1)), "-784.3", "the snap left float dust on the coordinate");
  } finally { db.close(); }
});

test("THE WALK: a step on the vault floor snaps to its 0.25 m stride and says so; a ground with no stride, or no ground, changes nothing", () => {
  const db = worldDb();
  try {
    const vault = groundAt(db, IN_VAULT);
    const stepped = strideOnGround({ toward: { x: 1097.31, y: -783.11 }, targetFrom: "coordinates" }, vault);
    assert.deepEqual(stepped?.toward, { x: 1097.25, y: -783 }, "a step across the vault floor was not snapped to its 0.25 m stride");
    assert.match(String(stepped.targetFrom), /0\.25 m step/, "the answer does not say the destination was snapped");
    assert.equal(strideOnGround({ toward: { x: 1097.25, y: -783 }, targetFrom: "x" }, vault), null, "a point already on the lattice is not re-said");
    assert.equal(strideOnGround({ toward: { x: 1097.31, y: -785.07 } }, groundAt(db, IN_ANTECHAMBER)), null, "the cellar door snapped a walk it never declared a word about");
    assert.equal(strideOnGround({ toward: { x: 1097.31, y: -785.07 } }, null), null, "a walk to ordinary ground was touched");
    assert.equal(groundAtPoint(db, { x: 1097, y: -783.5 })?.ground, VAULT, "a point inside the vault did not resolve to the vault");
    assert.equal(groundAtPoint(db, { x: 1300, y: -600 }), null, "a point out in the town resolved to a portal ground");
  } finally { db.close(); }
});

test("THE SPAWN: inside its own fence, two entrants apart, the same hand the same tile, and only where declared", () => {
  const db = worldDb();
  try {
    const vault = groundAt(db, IN_VAULT);
    const inVault = (p) => p.x >= 1095.5 && p.x <= 1098.5 && p.y >= -784.5 && p.y <= -782.5;
    const one = spawnPointFor(db, vault, { who: "darko", crossing: 155.5 });
    assert.ok(one?.at && inVault(one.at), `an entrant was placed at ${JSON.stringify(one?.at)} — outside the vault`);
    const two = spawnPointFor(db, vault, { who: "rei", crossing: 155.5 });
    assert.ok(inVault(two.at));
    assert.notDeepEqual(one.at, two.at, "two entrants were set down on the same tile");
    assert.deepEqual(spawnPointFor(db, vault, { who: "darko", crossing: 155.5 }).at, one.at, "the same hand landed somewhere else on a second read");
    const corner = { ...vault, row: { ...vault.row, dials: JSON.stringify({ walk_min_step: 0.25, spawn: { x: 1095.5, y: -784.5 }, spawn_jitter_m: 1 }) } };
    for (const hand of ["darko", "rei", "keeminlee", "limen", "meep"])
      assert.ok(inVault(spawnPointFor(db, corner, { who: hand, crossing: 155.5 }).at), `a corner spawn put ${hand} outside the fence`);
    assert.equal(spawnPointFor(db, groundAt(db, IN_ANTECHAMBER), { who: "darko", crossing: 155.5 }), null, "the cellar door placed an entrant it never asked to place");
    const wrong = { ...vault, row: { ...vault.row, dials: JSON.stringify({ spawn: { x: 1083, y: -791.4 } }) } };
    const r = spawnPointFor(db, wrong, { who: "darko", crossing: 155.5 });
    assert.equal(r?.at, null, "a spawn outside the ground was honoured");
    assert.match(String(r?.refused ?? ""), /outside its own extent/);
  } finally { db.close(); }
});

test("THE DOOR: standpoint.portal names the room, its space and its stride (absent when undeclared), and no ground keeps a wheel", () => {
  const db = worldDb();
  try {
    const vault = cockpitPortal(groundAt(db, IN_VAULT));
    assert.equal(vault.id, VAULT, "the cockpit reads `id`, never `ground`");
    assert.equal(vault.space, "antechamber");
    assert.equal(vault.walk_min_step, 0.25, "the vault's answer does not carry its stride — a client would be guessing the grid");
    assert.match(vault.body, /candles go up in tiers/);
    assert.equal(vault.keeps_wheel, false);
    const cellar = cockpitPortal(groundAt(db, IN_ANTECHAMBER));
    assert.equal("walk_min_step" in cellar, false, "a ground that has said nothing about its stride answered with a key");
    const oldArena = groundAt(db, [ARENA_ROOM]);
    assert.equal(oldArena.space, "arena");
    assert.equal(oldArena.keeps_wheel, false, "a ground kept a wheel — the arena is closed");
    assert.equal(cockpitPortal(null), null);
  } finally { db.close(); }
});

test("THE WIRING: the walk desk snaps by the ground, the read carries standpoint.portal, and an enter is set down at the spawn", () => {
  const code = (f) => readFileSync(join(import.meta.dirname, "..", "src", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const world = code("world.mjs"), apex = code("world-apex.mjs");
  assert.match(world, /strideOnGround\(\{ toward, targetFrom \}, groundHere\(targetMarkId, toward\)\)/, "the walk desk no longer asks the ground for its stride");
  assert.match(apex, /portal = groundAt\(store\.db, spineIds\);/, "the read no longer finds the portal ground it stands in");
  assert.match(apex, /\.\.\.\(portal \? \{ portal: cockpitPortal\(portal\) \} : \{\}\)/, "the standpoint no longer carries `portal`");
  assert.match(apex, /if \(action === "enter" && !result\?\.error\) \{\s*const placed = await spawnOnEnter\(/, "an enter is no longer set down at the ground's spawn");
});

test("INNERMOST FIRST (Keemin, 2026-09-30): a hand in the vault is told the vault, with its stride; a hand in the parlor outside it, the parlor", () => {
  const db = worldDb();
  try {
    // The spines as the apex builds them, outermost first. On the record all
    // three rooms are `portal-ground`, which is what the class-only rule could
    // not separate.
    const inVault = groundAt(db, [PARLOR, CELLAR, VAULT]);
    assert.equal(inVault.ground, VAULT, `a hand in the vault was told it stood in ${inVault.ground}`);
    assert.equal(cockpitPortal(inVault).walk_min_step, 0.25, "standpoint.portal for a hand in the vault does not carry the vault's 0.25 m stride");
    assert.equal(groundAt(db, [PARLOR, CELLAR]).ground, CELLAR, "a hand in the cellar door, outside the vault, is in the cellar door");
    const inParlor = groundAt(db, [PARLOR]);
    assert.equal(inParlor.ground, PARLOR, "a hand in the parlor outside the vault is in the parlor");
    assert.equal("walk_min_step" in cockpitPortal(inParlor), false, "the parlor declares no stride");
  } finally { db.close(); }
});
