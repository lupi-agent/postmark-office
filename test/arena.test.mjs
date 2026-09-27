// arena.test.mjs — THE DOOR, asserted against the founder's own rulings.
//
// Every test carries the verbatim law sentence it asserts. A brief is lossy
// compression of a sitting; the gated document is not, and a test that quotes
// my paraphrase of a ruling guards my paraphrase.
//
// ── WHAT THESE FALSIFY THAT encounter.test.mjs DOES NOT ─────────────────────
//
// `encounter.test.mjs` proves the FOLD: given rows, the wheel and the dice and
// the hit points come out right. It proved that on 2026-08-26 while the module
// was imported by nothing in `src/` — so every one of its 22 tests was green
// over a function the office never called. A LAW WITH NO DOOR BEHIND IT PASSES
// ITS OWN TESTS PERFECTLY.
//
// These tests are about the door: that the five verbs dispatch at all, that the
// wheel's refusal reaches a caller BY NAME, that a crossing joins, that a
// timeout resolves at a door touch, that the weapon's bonus is stamped and read
// back, and that the antechamber refuses a fight it has nobody for. They drive
// `arenaActViaOffice` against real stores, because the thing under test is
// precisely the wiring between the law and the door.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ARENA_VERBS, CLASS_ARENA_ACT, arenaGroundAt, adversaryIn, looseIn,
  dialsFromRecord, arenaRows, encounterOn, arenaActViaOffice, inWheel, publicState,
  joinOnCrossing, leaveOnCrossing,
  // the birthday amendments' own readers (2026-08-29)
  arrivalOnGround, BEATS_TAIL, cockpitPortal, entryPointInto, groundAtPoint,
  lootHiddenReason, lootShroudedIn, snapTo, spawnPointFor, walkMinStepOf, weaponInHand,
} from "../src/arena.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";
import { actingBlocked } from "../src/world-apex.mjs";
import { openDynamic } from "../src/dynamic-store.mjs";
import { SCHEMA } from "../src/world-store.mjs";

const here = dirname(fileURLToPath(import.meta.url));

// ── the world in a bottle ───────────────────────────────────────────────────
//
// Hand-filled with the SAME marks the world record carries (WORLD/marks/…),
// because what is under test is the door over a store — never the hydrator's
// derivation, which has its own tests. The dials below are transcribed from the
// real marks; a world-repo falsifier asserts the record matches.

const CELLAR = "the-town/the-cellar-door";
const VAULT = "the-town/the-candle-vault";
const CAKE = "the-town/the-unlit-cake";
const LIGHTER = "the-town/the-good-lighter";
const WICK = "the-town/the-wick-end";

const props = (o) => JSON.stringify(o);

function worldDb(guestHp = 20) {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const ins = db.prepare(
    `INSERT INTO nodes (id, by, kind, subkind, at_x, at_y, extent_w, extent_h, props)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  // The class marks — the law layer.
  //
  // ⚑ `kind: "mark"`, `subkind: "class"` — THE SHAPE THE HYDRATOR ACTUALLY
  // WRITES, verified against a real `world.db` rather than assumed. The first
  // version of this fixture wrote `kind: "class"` in the COLUMN and `kind:
  // "class"` in props, which is how a mark FILE spells it — and the query under
  // test read props too, so the two agreed and every dial assertion passed
  // while the same query found nothing against the live store. A fixture that
  // writes the shape the code expects proves only that they agree with each
  // other. This one is transcribed from what the hydrator produced.
  const cls = (name, dials, extra = {}) => ins.run(
    `the-town/${name}`, "the-town", "mark", "class", null, null, null, null,
    props({ class: name, tier: "constitution", dials, ...extra }));
  cls("strike", { to_hit_die: 20, damage_die: 6, beats_ac: 8, ends_turn: true });
  cls("cast", { to_hit_die: 20, damage_die: 10, beats_ac: 11, ends_turn: true });
  cls("guard", { halves_next_hit: true, ends_turn: true });
  cls("lift", { restores_to: 8, ends_turn: true });
  cls("loot", { ends_turn: false });
  cls("arena", { turn_timeout_s: 600, initiative_die: 20, guest_hp: guestHp, lift_to: 8 });
  cls("portal-ground", {});

  // the instances — the two rooms, the adversary, the weapon, the loot.
  ins.run(CELLAR, "the-town", "mark", "sited", 1097, -785, 5, 5,
    props({ class: "portal-ground", dials: { guest_hp: 20 }, body: "A door in the west wall of a house that has no cellar." }));
  // ⚑ TWO DIALS THE RECORD DID NOT CARRY BEFORE 2026-08-29, and they are here
  // because the fold now DISCLOSES their absence. `walk_min_step` is the
  // vault's own stride (LOGOS § The portal ground) and `persistent` is the
  // cake's (LOGOS § Downed, not dead). Both are transcribed the way the real
  // marks must carry them, and the disclosure test below is what will notice if
  // the marks are staged without them.
  ins.run(VAULT, "the-town", "mark", "sited", 1097, -783.5, 3, 2,
    props({ class: "arena", dials: { turn_timeout_s: 600, initiative_die: 20, guest_hp: guestHp, lift_to: 8, walk_min_step: 0.25, spawn: { x: 1097, y: -784.25 } },
            body: "Past the inner door the candles go up in tiers until you cannot see the top of them." }));
  ins.run(CAKE, "the-town", "mark", "sited", 1097, -783.5, 1.5, 1,
    props({ class: "adversary", dials: { hp: 60, hits_for: 5, to_hit_die: 20, damage_die: 8, initiative_bonus: 2, persistent: false },
            body: "Nine tiers, four hundred candles, not one ever lit." }));
  ins.run(LIGHTER, "the-town", "mark", "sited", 1095.5, -784, 0.2, 0.2,
    props({ class: "thing", held_grant: [{ action: "strike", residue: "the-town/strike", bonus: 3, says: "a flame that has never once gone out on the way over" }],
            body: "A brass lighter with somebody else's initials worn off it." }));
  ins.run(WICK, "the-town", "mark", "sited", 1098, -783, 0.1, 0.1,
    props({ class: "thing", loot: true, body: "One burnt wick end, saved." }));
  // ⚑ THE TIER COLUMN, SET ON THE THINGS ONLY (2026-08-29). The insert above
  // never touched it, so every row read `tier: null` — which nothing noticed
  // until a `nearby` entry had to be BUILT from one of these rows and came out
  // as the single entry in the list with no tier. The real marks carry `market`;
  // this is the fixture catching up with the record, and it is set by UPDATE
  // rather than by widening the shared insert so the class rows above keep
  // reading exactly as they did.
  const setTier = db.prepare("UPDATE nodes SET tier = ? WHERE id = ?");
  setTier.run("market", LIGHTER);
  setTier.run("market", WICK);
  return db;
}

/**
 * A throwaway dynamic store, and the env the door reads it through.
 *
 * `guestHp` exists so the downed tests do not have to WAIT FOR BAD LUCK. A
 * test that loops until the dice down somebody is measuring luck; with a
 * one-hit arena the first landed blow downs a hand, and the assertions below
 * additionally REFUSE to pass when the precondition was not reached.
 */
function bottle({ guestHp = 20 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bde-arena-"));
  const prevDb = process.env.WORLD_DYNAMIC_DB;
  const prevLog = process.env.WORLD_SINGLE_LOG;
  process.env.WORLD_DYNAMIC_DB = join(dir, "dynamic.db");
  process.env.WORLD_SINGLE_LOG = "1";
  const db = worldDb(guestHp);
  const dyn = openDynamic();
  return {
    db, dyn, dir,
    close() {
      try { dyn.close(); } catch { /* already gone */ }
      try { db.close(); } catch { /* already gone */ }
      if (prevDb === undefined) delete process.env.WORLD_DYNAMIC_DB; else process.env.WORLD_DYNAMIC_DB = prevDb;
      if (prevLog === undefined) delete process.env.WORLD_SINGLE_LOG; else process.env.WORLD_SINGLE_LOG = prevLog;
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds it a beat */ }
    },
  };
}

/** The spine a caller standing in the vault is on — outermost first, as the
 *  apex builds it: the vault nests inside the cellar door. */
const IN_VAULT = [CELLAR, VAULT];
const IN_ANTECHAMBER = [CELLAR];

/** `deps` as apexDo assembles them, minus the parts the door does not read.
 *  `db` is BORROWED exactly as the apex borrows it — the door must not close a
 *  handle it did not open, and an earlier version did, which killed the store
 *  under this fixture after the first act. */
// ⚑ `nowMs` IS THE REAL CLOCK ON PURPOSE, and the first version pinned it to a
// fixed 2026-08-29. Rows are stamped `written_at` with the actual current time,
// so a pinned instant two days in the future put EVERY act an eternity past the
// 600-second turn dial: the timeout fired on every single call, passed whoever
// held the wheel, and handed the caller their turn. Two tests then passed for
// entirely the wrong reason — the out-of-turn test never got its refusal
// because the timeout had already cleared the way, and the timeout test would
// have passed against a door that had no timeout logic at all. An apparatus
// fault, not a code defect, and exactly the shape that survives a green suite.
// The timeout test supplies its own far-future instant explicitly.
const deps = (b, who, extra = {}) => ({
  db: b.db,
  spineIds: IN_VAULT, handle: who, household: null, crossing: 120.5,
  witnessStamp: null, nowMs: Date.now(),
  ...extra,
});

const act = (b, who, action, extra = {}, dep = {}) =>
  arenaActViaOffice(null, { __action: action, ...extra }, null, deps(b, who, dep));

const state = (b, spine = IN_VAULT) => encounterOn(b.db, b.dyn, arenaGroundAt(b.db, spine));

/**
 * Play until a hand goes down, bounded.
 *
 * Two hands, so that when one is downed the OTHER can still be refused or lift
 * — a single-hand room wipes the instant it falls and there is nothing left to
 * assert about being down. Guards on the wipe for the same reason: after a
 * reset nobody is downed any more.
 */
async function driveUntilDowned(b, cap = 60) {
  for (let i = 0; i < cap; i += 1) {
    const s = state(b);
    if ((s.downed ?? []).length) return s;
    const turn = s.wheel?.turn;
    if (!turn || turn === CAKE) { await act(b, "darko", "guard").catch(() => {}); continue; }
    // Keep a second hand in the room so a single fall is not a room wipe.
    if (!inWheel(s, "rei")) { await act(b, "rei", "guard").catch(() => {}); continue; }
    await act(b, turn, "guard").catch(() => {});
  }
  return state(b);
}

// ── ruling 2 · TWO SPACES ───────────────────────────────────────────────────

test("the two spaces are distinct places, and the door names which one you are in", () => {
  // The founder's ruling, 2026-08-26: an antechamber (gather, read the rules of
  // the place, form up) and the arena/dungeon proper.
  // LOGOS/classes.md § The arena: "An arena extends portal-ground: same lent
  // verbs, same fence, plus a wheel."
  const b = bottle();
  try {
    const outer = arenaGroundAt(b.db, IN_ANTECHAMBER);
    const inner = arenaGroundAt(b.db, IN_VAULT);
    assert.equal(outer.space, "antechamber");
    assert.equal(outer.keeps_wheel, false, "the antechamber must not keep a wheel — it is where you form up");
    assert.equal(inner.space, "arena");
    assert.equal(inner.keeps_wheel, true);
    // and the INNER one wins when you are inside both, which is the whole
    // reason the vault nests in the cellar door: a caller in the arena is also
    // in a portal-ground, and resolving to the outer one would put the fight in
    // the waiting room.
    assert.equal(inner.ground, VAULT);
  } finally { b.close(); }
});

test("the antechamber refuses a fight it has nobody for, and says which room to go to", () => {
  // Design call (2). LOGOS § The portal ground: the adversary is "a mark class
  // whose instances carry `hp` and `hits_for` as their own UNSEALED dials, so
  // two adversaries differ by what the record says about each".
  // With no adversary sited on the ground there is no such record — and the
  // fold's own FLOOR would otherwise invent a sixty-point one out of a missing
  // dial, which is a fight against a thing the record does not contain.
  const b = bottle();
  try {
    assert.equal(adversaryIn(b.db, arenaGroundAt(b.db, IN_ANTECHAMBER)), null,
      "nothing stands in the antechamber — if this ever finds one, the fixture drifted");
    assert.equal(adversaryIn(b.db, arenaGroundAt(b.db, IN_VAULT)).id, CAKE);
  } finally { b.close(); }
});

test("striking in the antechamber is refused BY NAME, not folded against a phantom", async () => {
  const b = bottle();
  try {
    await assert.rejects(
      () => act(b, "darko", "strike", {}, { spineIds: IN_ANTECHAMBER }),
      (e) => {
        assert.equal(e.code, 422);
        assert.match(e.defect, /nothing in .* to strike/);
        assert.match(e.hint, /antechamber/);
        return true;
      });
  } finally { b.close(); }
});

// ── ruling 1 · TURN-BASED, AND THE REFUSAL NAMES THE TURN ───────────────────

test("an act out of turn is QUEUED at the door, and the answer names whose turn it is", async () => {
  // LOGOS/classes.md § The arena, verbatim:
  //   "The wheel gates every act, and movement with them. While an encounter is
  //    live, an arena affords its verbs — and walking — only to whoever the
  //    wheel is on. Hostiles hold real slots and take real turns. An act out of
  //    turn is refused NAMING WHOSE TURN IT IS, because 'no' without a name is
  //    a door that will be tried again immediately."
  //
  // THE ONE THAT MATTERS MOST IN THIS FILE. The fold has refused out-of-turn
  // acts since 2026-08-26 by dropping them into `ignored` — where nobody could
  // see them, because no door read the fold. This asserts the refusal reaches a
  // CALLER, with a NAME in it.
  const b = bottle();
  try {
    // three hands and the cake, all in the wheel
    await act(b, "darko", "guard");
    await act(b, "rei", "guard").catch(() => {});
    const s = state(b);
    const turn = s.wheel.turn;
    assert.ok(turn, "the wheel must be on somebody for this test to discriminate");
    const notTurn = (s.wheel.order.map((o) => o.who)).find((w) => w !== turn && w !== CAKE);
    if (!notTurn) return; // single-hand wheel: nothing to be out of turn about
    // ⚠ SUPERSEDED IN PLACE, 2026-08-29. This asserted a 409 naming the turn.
    // The founder replaced the refusal with a QUEUE — "let agents QUEUE their
    // actions ... instead of bouncing and saying it's not your turn" — so the
    // door now TAKES the act and holds it. What this test was really for
    // survives and is asserted below: the out-of-turn act reaches the caller
    // with an answer that NAMES whose turn it is, rather than vanishing into
    // `ignored` where no door could see it. The name was always the point; the
    // refusal was only how it used to be carried.
    const r = await act(b, notTurn, "strike");
    assert.ok(r.queued, "the door refused instead of queueing — the founder's ask is that it takes the act");
    assert.equal(r.queued.whose_turn, turn,
      "the queued answer does not name whose turn it is — a hand told only 'held' has learned nothing about when");
    assert.equal(r.queued.act, "strike");
    assert.ok(String(r.queued.you_are).length, "nor where they stand in the order");
    assert.equal(r.beat, undefined, "the queued act RESOLVED — queueing must not become acting out of turn");

    // AND IT IS ONE SLOT: a second act REPLACES the first rather than banking.
    const again = await act(b, notTurn, "guard");
    assert.ok(again.queued, "the requeue was refused");
    const held = state(b).queued.filter((q) => q.who === notTurn);
    assert.equal(held.length, 1, "the hand is holding two acts — one slot per hand, and a requeue replaces");
    assert.equal(held[0].act, "guard", "the LAST queued act must be the one held; the first is replaced, not kept");
  } finally { b.close(); }
});

test("the five verbs DISPATCH — none of them answers 501", async () => {
  // ⚑ THE REGRESSION THIS FILE EXISTS FOR. `world-apex.mjs` answers
  //   "\"<action>\" is afforded here but this office has no handler for it"
  // for any afforded action with no DISPATCH row, and that is what all five
  // arena verbs answered from the day their class marks were planted until
  // 2026-08-27. The class marks granted them; lint L6 reported the gap; the
  // fold sat there complete and uncalled.
  const src = readFileSync(join(here, "..", "src", "world-apex.mjs"), "utf8");
  for (const verb of ARENA_VERBS)
    assert.match(src, new RegExp(`ARENA_VERBS`),
      `the dispatch table must carry ${verb} — a granted verb with no handler is a 501 the resident cannot fix`);
  const { DISPATCHABLE } = await import("../src/world-apex.mjs");
  for (const verb of ARENA_VERBS)
    assert.ok(DISPATCHABLE.includes(verb), `${verb} is granted by a class mark and must be dispatchable — it answered 501 before this`);
});

test("a roll rides the answer, so a player can check the throw", async () => {
  // LOGOS § The witnessed roll: "The value rides the answer AND the row, so a
  // telling can show the throw."
  const b = bottle();
  try {
    const r = await act(b, "darko", "strike");
    assert.ok(Array.isArray(r.rolls) && r.rolls.length, "a strike with no roll on the answer is a throw nobody can check");
    for (const roll of r.rolls) {
      // The page's shape (`rollsFrom`): `value` and `die`, not the fold's
      // `rolled` and `of`. Both are on the answer — the card under `rolls`, the
      // fold's own rows under `rolls_raw` — and this asserts the card, because
      // the card is the one a reader is handed.
      assert.ok(roll.value >= 1, "a face below 1 is not a die");
      assert.match(String(roll.die), /^d\d+$/);
      assert.equal(roll.total, roll.value + roll.modifier, "a throw whose total is not its face plus its modifier is not checkable");
    }
    assert.ok(Array.isArray(r.rolls_raw) && r.rolls_raw.length, "the fold's own throws must stay readable beside the card");
  } finally { b.close(); }
});

// ── ruling 6 · OPEN DOOR ────────────────────────────────────────────────────

test("a mid-fight joiner lands IN the initiative order, at the bottom, next round", async () => {
  // LOGOS § The arena, verbatim:
  //   "Initiative is rolled at the open and appended at the boundary. Crossing
  //    the inner threshold rolls you in; a late arrival joins at the BOTTOM of
  //    the order at the next round boundary, never mid-round, because an order
  //    that can change under a hand mid-round is an order nobody can read."
  // The founder's ruling: anyone can walk in whenever — no party-forming gate.
  const b = bottle();
  try {
    await act(b, "darko", "guard");
    const before = state(b);
    assert.ok(inWheel(before, "darko"));
    assert.equal(inWheel(before, "latecomer"), false);

    const r = await act(b, "latecomer", "guard").catch((e) => e);
    const after = state(b);
    assert.ok(inWheel(after, "latecomer"),
      "a hand who walked in and acted must be IN the order — an open door that leaves you off the wheel is a party-forming gate wearing a different hat");
    const order = after.wheel.order.map((o) => o.who);
    assert.ok(order.includes("latecomer"));
    const late = after.wheel.order.find((o) => o.who === "latecomer");
    assert.ok(late.joined_round >= 1);
    void r;
  } finally { b.close(); }
});

test("crossing the inner threshold IS joining, and walking out stops the counting", () => {
  // `the-town/crossing-is-joining`, and LOGOS § The arena: "Walking out drops
  // you from the wheel — the exit law holds mid-fight, and the arena simply
  // stops counting you. No jails."
  const b = bottle();
  try {
    const joined = joinOnCrossing(b.db, b.dyn, IN_VAULT, "darko");
    assert.ok(joined, "crossing into an arena must write a join — that is what the class mark's own name says");
    assert.equal(joined.ground, VAULT);
    assert.ok(inWheel(state(b), "darko"));

    // and an ORDINARY portal ground writes nothing: only a wheel-keeping ground
    // has anything to join.
    assert.equal(joinOnCrossing(b.db, b.dyn, IN_ANTECHAMBER, "rei"), null);

    const left = leaveOnCrossing(b.db, b.dyn, IN_VAULT, "darko");
    assert.ok(left, "walking out must write a leave");
    assert.equal(inWheel(state(b), "darko"), false, "the wheel must stop counting a hand who walked out — no jails");
  } finally { b.close(); }
});

// ── ruling 7 · DOWNED, NOT DEAD ─────────────────────────────────────────────

test("at zero a hand is DOWNED and still in the order — never removed", async () => {
  // LOGOS/classes.md § Downed, not dead, verbatim:
  //   "At zero you are DOWN, and down is not gone. You lose your acts, the
  //    wheel skips you, and what you were holding drops loose where you stand."
  // The discriminating leg is the SECOND clause: a fold that deleted the hand
  // would also "skip" it, and every turn-order assertion would still pass.
  // ⚑ A ONE-HIT ARENA, AND AN ASSERTED PRECONDITION. The first version of this
  // test looped hoping the dice would down somebody and `return`ed quietly when
  // they did not — so it PASSED WITHOUT ASSERTING ANYTHING, and the flip runner
  // proved it: deleting the downed check left this test green. A test that
  // cannot reach its guard must go RED, never quietly pass, and a test that
  // waits on luck is measuring luck.
  const b = bottle({ guestHp: 1 });
  try {
    let s = await driveUntilDowned(b);
    assert.ok((s.downed ?? []).length,
      "the fixture never produced a downed hand, so this test asserted nothing — that is a failure of the test, not a pass of the code");
    const who = s.downed[0];
    assert.ok(s.wheel.order.some((o) => o.who === who),
      "a downed hand must still stand IN the order — removing them would pass every skip test and quietly make this permadeath");
    assert.equal(s.wheel.order.find((o) => o.who === who).downed, true);
    assert.equal(s.hands[who].hp, 0);
    assert.equal(s.hands[who].downed, true);
  } finally { b.close(); }
});

test("a downed hand is refused for BEING DOWN, not for it being someone else's turn", async () => {
  // The order of the two refusals is the whole usefulness of the first one. A
  // downed hand is skipped by the wheel, so "it is someone else's turn" is TRUE
  // for them and will be true forever — a reader acting on it waits for a turn
  // that is never coming. Being down is the reason; whose turn it is, is a
  // symptom of it.
  const b = bottle({ guestHp: 1 });
  try {
    const s = await driveUntilDowned(b);
    assert.ok((s.downed ?? []).length,
      "the fixture never produced a downed hand, so this test asserted nothing");
    const who = s.downed[0];
    await assert.rejects(
      () => act(b, who, "strike"),
      (e) => {
        assert.equal(e.downed, true);
        assert.match(e.defect, /is down — someone has to lift you/,
          "the refusal must name BEING DOWN; naming the turn instead sends them to wait for a turn that never comes");
        return true;
      });
  } finally { b.close(); }
});

// ── ruling 8 · THE MAGIC WEAPON ─────────────────────────────────────────────

test("the weapon's grant is read off the RECORD, with its bonus, and the town's pen hung it there", () => {
  // LOGOS § The three channels: the held-grant "lives on the OBJECT … and it is
  // set down with the object: pick it up and the door opens, drop it and the
  // door closes." Its custody is AUTHORSHIP — `by: the-town` — because atom 11
  // says tier is never asserted and a held thing has no ground.
  const b = bottle();
  try {
    const loose = looseIn(b.db, arenaGroundAt(b.db, IN_VAULT).row);
    const lighter = loose.find((l) => l.thing === LIGHTER);
    assert.ok(lighter, "the good lighter must be lying in the vault — it is the ruling's own pickable-up weapon");
    const grant = lighter.grants.find((g) => g.action === "strike");
    assert.ok(grant, "the weapon must grant a STRIKE — that is the whole ruling: take it, then strike WITH it");
    assert.equal(grant.bonus, 3, "the bonus is the record's number, not the office's");
  } finally { b.close(); }
});

test("a strike WITHOUT the weapon carries no bonus, and the stamp is what proves it", async () => {
  // The discriminating leg for design call (3): the bonus is STAMPED into the
  // act at write time and read back off the row, never looked up live. A test
  // that only checked the with-weapon case would pass against an office that
  // always added 3.
  const b = bottle();
  try {
    const r = await act(b, "darko", "strike");
    assert.equal(r.with, undefined, "nobody is holding the lighter, so no bonus may be stamped");
    const rows = arenaRows(b.dyn, VAULT);
    const mine = rows.find((x) => Number(x.seq) === Number(r.seq));
    assert.equal(mine.payload.with, undefined, "an unarmed strike must carry no `with` on its row");
  } finally { b.close(); }
});

test("loot is REFUSED while the adversary is still standing", async () => {
  // `the-town/loot` declares its own precondition on the record:
  //   requires: {"within_class": "portal-ground", "phase": "spent"}
  // LOGOS § The derived: "Guards are deriveds in gate position: a verb or slot
  // may name a derived and a required value as its precondition."
  //
  // ⚑ THIS FALSIFIER DID NOT EXIST UNTIL THE FLIP RUNNER SAID SO. Deleting the
  // phase check left the whole suite green — twenty other tests and not one of
  // them looked at loot's precondition. The runner reported a hole, which is
  // the only reason this is a test rather than a live way to empty a room
  // before anyone has fought in it.
  const b = bottle();
  try {
    await act(b, "darko", "guard");           // open the fight; the cake stands
    const s = state(b);
    assert.equal(s.phase, "afoot", "the cake must still be standing for this test to discriminate");
    await assert.rejects(
      () => act(b, "darko", "loot", { object: WICK }),
      (e) => {
        assert.equal(e.code, 409);
        assert.match(e.defect, /loot is not open yet/);
        assert.match(e.hint, /still standing/);
        return true;
      });
  } finally { b.close(); }
});

// ── ruling 5 · SCRIPTED AND REPLAYABLE ──────────────────────────────────────

test("the creatures are driven by the act that ends a turn — no daemon, no ticker", async () => {
  // LOGOS § The arena, verbatim:
  //   "Hostile turns are resolved by the act that ends a player's turn, in the
  //    same handling, until the wheel reaches a player again. There is no
  //    daemon and no ticker: the duet is the event loop."
  const b = bottle();
  try {
    await act(b, "darko", "guard");
    let sawHostileDriven = false;
    for (let i = 0; i < 12; i += 1) {
      const s = state(b);
      const turn = s.wheel?.turn;
      if (!turn) break;
      if (turn === CAKE) {
        assert.fail("the wheel came to rest ON the creature — the door must drive it within the same handling, or the fight stops until somebody pokes it");
      }
      const r = await act(b, turn, "guard").catch(() => null);
      if (r?.then?.length) { sawHostileDriven = true; break; }
    }
    assert.ok(sawHostileDriven,
      "no creature turn was ever driven by a player's act — that is the daemon-shaped hole the duet clause forbids");
  } finally { b.close(); }
});

test("the whole fight is a FOLD over rows — nothing about it is stored", async () => {
  // LOGOS § The portal ground: "Its state is a fold, never a store. Whatever a
  // portal ground's encounter is made of … is derived from that ground's own
  // rows in the log. Nothing about an encounter is written down except the
  // acts."
  const b = bottle();
  try {
    await act(b, "darko", "strike");
    await act(b, "darko", "guard").catch(() => {});
    const a = publicState(state(b));
    const again = publicState(state(b));
    assert.deepEqual(a, again, "two reads of an unchanged log must derive the same fight");
    // and the only thing on disk is ACTS: every journal row is one of the
    // vocabulary's words, never a hit-point total or a turn cursor.
    const words = new Set(["join", "leave", "pass", "strike", "cast", "guard", "lift", "loot"]);
    for (const r of arenaRows(b.dyn, VAULT))
      assert.ok(words.has(r.action), `"${r.action}" is on the log and is not an act — a stored derived is the private grammar atom 1 refuses`);
  } finally { b.close(); }
});

test("two arenas share one journal and must not share one fight", async () => {
  // Design call (1) read from the other side: one arena is one wheel, and the
  // scoping that makes that true is `payload.ground` on every row. Without it a
  // second room's acts fold into the first one's fight, and the bug would only
  // ever appear on the day the town had two arenas.
  const b = bottle();
  try {
    await act(b, "darko", "guard");
    assert.ok(arenaRows(b.dyn, VAULT).length > 0);
    assert.equal(arenaRows(b.dyn, "the-town/some-other-arena").length, 0,
      "another ground's fold must see none of this room's rows");
    for (const r of arenaRows(b.dyn, VAULT))
      assert.equal(r.payload.ground, VAULT, "every arena row must name its ground, or two rooms become one fight");
  } finally { b.close(); }
});

// ── the dials come off the record ───────────────────────────────────────────

test("every dial the fold reads comes off a mark, and the INSTANCE outranks its class", () => {
  // LOGOS § The portal ground: the adversary's dials are "their own UNSEALED
  // dials, so two adversaries differ by what the record says about each and not
  // by a branch in code".
  const b = bottle();
  try {
    const place = arenaGroundAt(b.db, IN_VAULT);
    const d = dialsFromRecord(b.db, { groundRow: place.row, adversaryRow: adversaryIn(b.db, place.row) });
    assert.equal(d.strike.damage_die, 6, "strike's damage die is the-town/strike's own dial");
    assert.equal(d.cast.beats_ac, 11);
    assert.equal(d.adversary.hp, 60, "the cake's hit points are the CAKE's dial, not a constant in the office");
    assert.equal(d.adversary.initiative_bonus, 2);
    assert.equal(d.arena.turn_timeout_s, 600);
    // The fold must then stand on NO floor — a disclosed floor here would mean
    // the record is missing a number the law says it carries.
    const s = encounterOn(b.db, b.dyn, place);
    assert.equal(s.dials_missing, undefined,
      `the fold stood on its floor for: ${(s.dials_missing ?? []).join("; ")} — every one of those is a dial the record should have carried`);
  } finally { b.close(); }
});

// ── the timeout ─────────────────────────────────────────────────────────────

test("an absent hand's turn resolves as a STRIKE at the next door touch, by anyone", async () => {
  // ⚑ SUPERSEDED IN PLACE (founder-called, 2026-08-29, mid-party): this test
  // asserted the timeout resolved as a PASS, quoting LOGOS § The arena as it
  // then stood. The founder's ruling at the party: "have them STRIKE at the end
  // of the timer" — a timed-out turn swings, so the room's pace stops depending
  // on who wandered off. The clauses that SURVIVE from the old law are still
  // asserted here: the timeout is a dial, it resolves at the next door touch by
  // anyone, never by a process watching a clock, and the act belongs to the
  // absent hand. Only the resolving verb changed: pass → strike, rolled by the
  // fold from the row like any chosen swing, payload kind "timeout" so the
  // record never pretends the hand chose it.
  const b = bottle();
  try {
    await act(b, "darko", "guard");
    await act(b, "rei", "guard").catch(() => {});
    const s = state(b);
    const turn = s.wheel?.turn;
    if (!turn || turn === CAKE) return;
    const other = s.wheel.order.map((o) => o.who).find((w) => w !== turn && w !== CAKE);
    if (!other) return;
    // Somebody arrives two hours later — well past the 600s dial. Supplied
    // EXPLICITLY, because the shared fixture now runs on the real clock so that
    // no other test gets a timeout it did not ask for.
    const late = Date.now() + 2 * 3600 * 1000;
    const r = await act(b, other, "guard", {}, { nowMs: late }).catch((e) => e);
    const timerRows = arenaRows(b.dyn, VAULT).filter((x) => x.payload?.kind === "timeout");
    assert.ok(timerRows.length >= 1,
      "an hour past a ten-minute dial, the arriving hand's own door touch must resolve the absent turn");
    assert.equal(timerRows[0].action, "strike",
      "the timer swings — a timed-out turn resolves as a strike, not a pass");
    assert.equal(timerRows[0].actor, turn, "the swing belongs to the hand who was absent, not to whoever noticed");
    // And the fold rolls it like any chosen swing: the beat carries a real
    // to-hit, proving it resolved as a strike rather than merely being spelled
    // like one.
    const after = state(b);
    const beat = (after.beats ?? []).find((bt) => bt.actor === turn && bt.act === "strike");
    assert.ok(beat && Number.isFinite(beat.to_hit),
      "the fold must roll the timer's swing — a strike beat with a to-hit, not a silent skip");
    void r;
  } finally { b.close(); }
});

test("nothing in the door reads a wall clock of its own — the instant is the caller's", () => {
  // The second-clock objection LOGOS pays in § The portal ground: "the one dial
  // that names a duration (`turn_timeout`) resolves AT THE NEXT DOOR TOUCH and
  // never on its own, so no process anywhere is watching a clock on the town's
  // behalf." A `setInterval` or a bare `Date.now()` inside the timeout path
  // would BE that process.
  const src = readFileSync(join(here, "..", "src", "arena.mjs"), "utf8");
  // ⚑ CODE ONLY, and the sibling guard in encounter.test.mjs already learned
  // this the same way: "a comment that documents the boundary is the opposite of
  // crossing it, and the first version of this probe could not tell the two
  // apart." This one still could not, until `spawnPointFor` earned a note
  // explaining why a HASH is admissible where `crypto.randomUUID` is not — a
  // sentence that exists to keep the ban and was read as breaking it.
  //
  // JSDoc lines start with `*`, so they are stripped with the `//` ones.
  const body = src.split("\n")
    .filter((l) => { const c = l.trim(); return !c.startsWith("//") && !c.startsWith("*") && !c.startsWith("/*"); })
    .join("\n");
  for (const banned of ["setInterval", "setTimeout", "Math.random", "crypto.randomUUID"])
    assert.ok(!body.includes(banned),
      `${banned} in the arena door is the ticker the duet clause forbids (or the unwitnessed randomness atom 8 forbids)`);
  // `nowMs` must arrive as a parameter, never be read here.
  assert.match(src, /nowMs = Date\.now\(\)/,
    "the instant must be a DEFAULTED PARAMETER the caller supplies — a clock read inside the fold path is a second clock");
});

// ── the site's contracts, answered in the site's own words ──────────────────

test("the door speaks the exact shapes the cockpit reads — id, down, boolean loose", async () => {
  // ⚑ EVERY ONE OF THESE FAILS SILENTLY WHEN IT IS WRONG, which is why they are
  // asserted by NAME rather than trusted. `portalOf` returns null for a portal
  // with no `id`, and `mountsHere` then returns false, so the entire cockpit
  // never mounts — no error, a blank page, a green build. `encounterOf` reads
  // `down`, not `downed`, so the wrong spelling shows a downed hand as upright.
  // `looseThings` filters `m.loose === true`, so an OBJECT there is falsy and
  // every dropped weapon stops being drawn. I shipped the wrong shape of all
  // three first, and found them by reading the consumer rather than by any test
  // I had written.
  const { cockpitPortal, cockpitEncounter, cockpitRolls } = await import("../src/arena.mjs");
  const b = bottle();
  try {
    const place = arenaGroundAt(b.db, IN_VAULT);
    const p = cockpitPortal(place);
    assert.equal(typeof p.id, "string", "portalOf returns null without a string `id` — and then nothing mounts");
    assert.equal(p.id, VAULT);
    assert.equal(p.space, "arena", "spaceOf reads standpoint.portal.space");

    await act(b, "darko", "guard");
    const e = cockpitEncounter(state(b), "darko");
    assert.ok(e && Array.isArray(e.order) && e.order.length, "encounterOf treats an empty order as NO encounter");
    assert.equal(typeof e.id, "string");
    for (const row of e.order) {
      assert.equal(typeof row.id, "string", "an order row without a string id renders as '?'");
      assert.ok(["resident", "human", "creature"].includes(row.kind), `"${row.kind}" is not one of the page's three kinds`);
      assert.equal(typeof row.down, "boolean", "the page reads `down`, not `downed`");
    }
    const cake = e.order.find((o) => o.id === CAKE);
    assert.equal(cake.kind, "creature", "the adversary must render as a creature, not a resident");
    assert.ok(e.order.find((o) => o.id === "darko")?.you, "the caller's own row must be marked `you`");

    // ── EVERY HUMAN IS A HUMAN, not only the reader's own (2026-08-29) ───────
    //
    // Asked while answering "will party guests see each other's humans?". The
    // kind was computed against the CALLER's hand alone, so at a party with
    // several humans on the wheel each reader got their own row right and
    // everyone else's human labelled `resident` — a row whose id literally
    // reads `human-of-<somebody>` wearing the kind of a thing it is not.
    const wheel = {
      ground: VAULT, wheel: { round: 1, turn: "human-of-darko", order: [
        { who: "human-of-darko", kind: "player", initiative: 12 },
        { who: "human-of-keeminlee", kind: "player", initiative: 9 },
        { who: "rei", kind: "player", initiative: 7 },
        { who: CAKE, kind: "hostile", initiative: 14 },
      ] }, hands: {},
    };
    // read as darko's human: their OWN row and the OTHER guest's must both be human
    const seen = cockpitEncounter(wheel, "human-of-darko", { human: "human-of-darko" });
    const kindOfRow = (id) => seen.order.find((o) => o.id === id)?.kind;
    assert.equal(kindOfRow("human-of-darko"), "human", "the reader's own human must render as a human");
    assert.equal(kindOfRow("human-of-keeminlee"), "human",
      "another guest's human rendered as a RESIDENT — at a party with several humans every reader is right about themselves and wrong about everyone else");
    assert.equal(kindOfRow("rei"), "resident", "and an actual resident must not be swept up as a human");
    assert.equal(kindOfRow(CAKE), "creature", "nor the adversary");
    // `you` is still the reader's own row and only theirs — the same input
    // answers two different questions, and conflating them is the original bug.
    assert.ok(seen.order.find((o) => o.id === "human-of-darko")?.you, "the reader's own row is still marked `you`");
    assert.equal(seen.order.find((o) => o.id === "human-of-keeminlee")?.you, undefined,
      "another guest's human was marked as the reader's own row");

    const r = cockpitRolls([{ of: "d20", rolled: 20, for: "to-hit" }], { modifier: 0 });
    assert.equal(r[0].faces, 20, "rollsFrom derives faces from `die` only when `faces` is absent — send it");
    assert.equal(r[0].total, 20);
    assert.equal(r[0].crit, true, "a natural maximum on the to-hit die is the door's crit rule, and the door must SAY it");
  } finally { b.close(); }
});

test("a dropped thing is marked loose with a BOOLEAN, beside the facts about the fall", async () => {
  const { withLoose } = await import("../src/world-apex.mjs");
  const nearby = [{ id: LIGHTER, at: { x: 1095.5, y: -784 }, by: "the-town" }];
  const withIt = withLoose(nearby, { state: { dropped: [{ thing: LIGHTER, by: "darko", at_seq: 9 }] } });
  assert.equal(withIt[0].loose, true, "looseThings filters `m.loose === true` — an object here is falsy and nothing is drawn");
  assert.equal(withIt[0].dropped_by, "darko");
  // and a thing nobody dropped is untouched — `loose` must not appear at all.
  const untouched = withLoose(nearby, { state: { dropped: [] } });
  assert.equal("loose" in untouched[0], false, "a thing that never fell must not be marked loose");
});

// ── ruling 3 · CLASS-LEVEL LAW, AND HUMAN IS AN ACT-AS OPTION ───────────────

test("the ACT-AS roster always offers Human, and says why when it may not act", async () => {
  // The founder's ruling, 2026-08-26: "abilities live at the CLASS level ('Act
  // As' a class), and 'Human' is one of the Act-As options — this is the bridge
  // for parcel-embodied humans."
  //
  // ⚑ ALWAYS OFFERED, SOMETIMES REFUSED. An absent option teaches nothing: a
  // player who never sees the Human face cannot learn that embodiment exists.
  // And the field names are the SITE's (`kind`, `allowed`) — `actorsFor`
  // returns the door's roster UNTOUCHED, so a made-up spelling renders as a row
  // of blank faces with no error anywhere.
  const { actorRoster, humanTokenUrl } = await import("../src/human-actor.mjs");

  const off = actorRoster({ residents: ["rei", "wright"], humanGrants: [], humanHandle: "keeminlee" });
  const human = off.find((a) => a.kind === "human");
  assert.ok(human, "the Human face must be offered even where it cannot act");
  assert.equal(human.allowed, false);
  assert.match(human.reason, /embodied only where a ground's class grants it/);
  assert.equal(off.filter((a) => a.kind === "resident").length, 2);
  for (const a of off) assert.equal(typeof a.label, "string", "a face with no label renders blank");

  const on = actorRoster({ residents: ["rei"], humanGrants: ["strike", "guard"], humanHandle: "keeminlee" });
  const embodied = on.find((a) => a.kind === "human");
  assert.equal(embodied.allowed, true, "a ground that grants a human its verbs must light the Human face");
  assert.equal(embodied.stance, "embodied-human");
  assert.deepEqual(embodied.grants, ["strike", "guard"]);
});

test("the human token is a configurable SLOT, and never a guessed default", async () => {
  // The brief's own words: "a token/profile image slot per embodied human,
  // file-path-configurable". The founder's token is staged locally and is not
  // this office's to hold; what the office owes is a place for one.
  const { humanTokenUrl, HUMAN_TOKEN_DIR } = await import("../src/human-actor.mjs");
  assert.equal(humanTokenUrl("keeminlee", { dir: "/tokens" }), "/tokens/keeminlee-token.png");
  assert.equal(humanTokenUrl("keeminlee", { token: "/explicit/darko.png", dir: "/tokens" }), "/explicit/darko.png",
    "an explicit path is never second-guessed");
  assert.equal(humanTokenUrl(null), null,
    "with no handle to name a file after, a token must be ABSENT — a guessed default would put somebody else's face on a person");
  assert.equal(typeof HUMAN_TOKEN_DIR(), "string");
});

// ── ruling 10 · MCP-FIRST ───────────────────────────────────────────────────

test("every verb the door dispatches publishes a schema the site can read", async () => {
  // The founder's standing law: the site is a human surface derived from the
  // MCP door verbs. A verb that dispatches but publishes no schema is a door
  // the UI has to guess at — which is UI-first wearing an MCP hat.
  const { ARENA_TOOLS } = await import("../src/arena.mjs");
  const named = new Set(ARENA_TOOLS.map((t) => t.name));
  for (const verb of ARENA_VERBS)
    assert.ok(named.has(`world_${verb}`), `${verb} dispatches but publishes no schema — the site would have to guess its fields`);
  for (const t of ARENA_TOOLS) {
    assert.ok(t.description.length > 40, `${t.name} needs a description a resident can act on`);
    assert.equal(t.inputSchema.additionalProperties, false, `${t.name} must refuse unknown fields BY NAME`);
  }
});

// ── the wipe carries an actor, like every beat ──────────────────────────────

test("every beat carries a string actor — including the wipe, the most interesting beat in the fight", async () => {
  // Found in play, 2026-08-27: the wipe beat shipped without an actor, so any
  // consumer mapping `beat.actor` crashed on exactly the beat a spectator most
  // wants to render. The wipe's actor is the adversary whose blow ended the
  // attempt. One hand alone cannot win (the dials are a party's), so a solo
  // room wipes within the cap or this test fails loudly rather than looping.
  const b = bottle();
  try {
    let s = state(b);
    for (let i = 0; i < 200 && !(s.attempts > 0); i += 1) {
      const turn = s.wheel?.turn;
      await act(b, turn && turn !== CAKE ? turn : "darko", "strike").catch(() => {});
      s = state(b);
    }
    assert.ok(s.attempts > 0, "a solo room must wipe within the cap — if it stopped wiping, the dials moved and this fixture needs re-truing");
    const wipes = s.beats.filter((x) => x.act === "wipe");
    assert.ok(wipes.length > 0, "an attempt ended but no wipe beat was kept — the journal lost the most interesting beat");
    for (const beat of s.beats) {
      assert.equal(typeof beat.actor, "string",
        `beat "${beat.act}" (seq ${beat.seq}) carries no string actor — a consumer mapping beat.actor crashes on it`);
    }
  } finally { b.close(); }
});

// ── THE OWN HAND, inside the portal (2026-08-27) ────────────────────────────
//
// LOGOS § The portal ground, verbatim: "The verbs carry `for: human` entries
// beside the resident ones, so a guest's human plays inside the portal without
// any claim outside it." A human who PLAYS and whose blows land under somebody
// else's name is not playing — and until tonight that is exactly what happened:
// the apex passed `as_human: true` and NOTHING in src/ read it, so every
// embodied act was appended with `actor: <the resident>`.
//
// This door can honour the hand where the walk door cannot, and the reason is
// the class's own: "its state is a fold, never a store." An arena act needs no
// body in the world — the wheel and the hit points are derived from this
// ground's own rows — so the hand is a string in the log, and the log already
// carries non-resident hands with real standing (`openAgainst` writes the
// adversary's mark id, and hostiles "hold real slots and take real turns").

const HUMAN = "human-of-pando-house";

test("an embodied human's act is recorded under the HUMAN's hand, never the resident's", async () => {
  const b = bottle();
  try {
    // The apex hands down the human's own label; `deps.handle` still carries the
    // resident whose standpoint was gathered, exactly as it does on every call.
    await act(b, "darko", "guard", { as_human: HUMAN });
    const rows = arenaRows(b.dyn, VAULT);
    const mine = rows.filter((r) => r.actor === HUMAN);
    assert.ok(mine.length > 0, "the human's act reached the log under their own hand");
    assert.ok(mine.some((r) => r.action === "guard"), "including the act itself, not only the join");
    // THE VIOLATION, asserted as an ABSENCE. This is the whole point: not that
    // the human appears, but that the resident does NOT — a fix that wrote both
    // would still have put darko's name on a step darko did not take.
    assert.equal(rows.some((r) => r.actor === "darko"), false,
      "the resident's name must appear nowhere in an act their human took");
  } finally { b.close(); }
});

test("and the same act WITHOUT a human's hand still records under the resident", async () => {
  // The discriminating leg. Without it, the assertion above passes just as well
  // against a door that had stopped recording residents at all — and the
  // ordinary resident act is the overwhelmingly common one.
  const b = bottle();
  try {
    await act(b, "darko", "guard");
    const rows = arenaRows(b.dyn, VAULT);
    assert.ok(rows.some((r) => r.actor === "darko"), "an ordinary act is still the resident's own");
    assert.equal(rows.some((r) => r.actor === HUMAN), false, "and no human is invented for it");
  } finally { b.close(); }
});

test("the human holds a real slot on the wheel, beside the hostile that already does", async () => {
  // "Hostiles hold real slots and take real turns" (the founder, 2026-08-26) is
  // the precedent this fix stands on: the wheel is already a fold over
  // free-string actors, so a human on it is the same shape and not a new one.
  // If the hand were recorded on the act row but the wheel still keyed on the
  // resident, the fight would be ordered around somebody who is not playing.
  const b = bottle();
  try {
    await act(b, "darko", "guard", { as_human: HUMAN });
    const s = state(b);
    assert.equal(inWheel(s, HUMAN), true, "the human is in the wheel under their own hand");
    assert.equal(inWheel(s, "darko"), false, "and the resident, who did not act, is not");
    assert.ok((s.wheel?.order ?? []).some((j) => j.kind === "hostile"),
      "the hostile still takes its slot — the human joins an ordinary wheel, not a special one");
  } finally { b.close(); }
});

test("the open is asked on EVERY door touch, so a room that gained its adversary late still opens", async () => {
  // ⚑ THE FOUNDER'S OWN BROWSER, 2026-08-28. rei stood in the candle vault at
  // round 4, the cake read 51 of 60, and no swing ever came back. The wheel
  // held ONE row.
  //
  // LOGOS § The arena: "Hostiles hold real slots and take real turns", and
  // "Initiative is rolled at the open." `openAgainst` is the only writer that
  // ever puts a creature on the wheel — and it used to be reachable only from
  // inside the branch that joins a hand who is not yet in the wheel. So a hand
  // who joined a ground with nothing standing on it was joined for good, and
  // the open became unreachable on that ground forever after.
  //
  // That is exactly how the dungeon was staged: the props were re-sited into
  // their rooms AFTER rei had already walked in. This test stages it the same
  // way — join an empty vault, site the adversary, act again.
  const b = bottle();
  try {
    // the room, with nothing standing in it yet
    b.db.prepare("DELETE FROM nodes WHERE id = ?").run(CAKE);
    assert.equal(adversaryIn(b.db, arenaGroundAt(b.db, IN_VAULT)), null,
      "precondition: the vault has no adversary at the moment the hand joins");
    await act(b, "rei", "guard");
    const before = state(b);
    assert.equal(inWheel(before, "rei"), true, "the hand joined the empty room");
    assert.equal(before.encounter_live, false, "and nothing is live, because nothing stands against them");

    // the adversary is sited afterwards — the stage's own order of events
    b.db.prepare(
      `INSERT INTO nodes (id, by, kind, subkind, at_x, at_y, extent_w, extent_h, props)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      CAKE, "the-town", "mark", "sited", 1097, -783.5, 1.5, 1,
      props({ class: "adversary", dials: { hp: 60, hits_for: 5, to_hit_die: 20, damage_die: 8, initiative_bonus: 2 },
              body: "Nine tiers, four hundred candles, not one ever lit." }));
    assert.equal(adversaryIn(b.db, arenaGroundAt(b.db, IN_VAULT)).id, CAKE,
      "precondition: the cake now stands in the vault");

    // one more door touch by the hand who is ALREADY in the wheel
    await act(b, "rei", "guard").catch(() => {});
    const after = state(b);
    assert.ok((after.wheel?.order ?? []).some((j) => j.kind === "hostile"),
      "the cake takes its slot at the next door touch, not only at somebody's first join");
    assert.equal(after.encounter_live, true,
      "and the encounter is LIVE — without this the turn gate never engages and every act sails through unrefused");
  } finally { b.close(); }
});

test("the read does not gate a hand the act would have joined", async () => {
  // ⚑ FOUND LIVE 2026-08-28, playing the dungeon in a browser. rei left the
  // wheel while still standing on the arena ground. The creature then held the
  // turn — it was the only row left — and the read answered `acting_blocked`
  // for every verb, so the bar greyed out whole and the room looked dead.
  //
  // The act would have worked the entire time. `arenaActViaOffice` joins a
  // caller who is not in the wheel (step 3) BEFORE it judges them by it (step
  // 5), because "anyone can walk in whenever" is the ruling. The read mirrored
  // the gate and not the join, so this half of the door was stricter than the
  // half that acts — and a reader cannot be expected to click a button the door
  // has just told them is refused.
  const b = bottle();
  try {
    await act(b, "rei", "guard");
    leaveOnCrossing(b.db, b.dyn, IN_VAULT, "rei");
    const s = state(b);
    assert.equal(inWheel(s, "rei"), false, "precondition: rei has left the wheel");
    assert.equal(s.encounter_live, true, "precondition: the fight is still live without them");
    assert.equal(actingBlocked(s, "rei"), null,
      "a hand who is not in the wheel is not waiting for it — the act would join them first");
    // the discriminating leg: someone who IS in the wheel and not on turn is
    // still gated, in the gate's own words
    const held = s.wheel?.turn;
    if (held && held !== CAKE) {
      assert.equal(actingBlocked(s, CAKE)?.acting_blocked?.whose_turn, held,
        "and a row that IS in the order still gets the wheel's refusal by name");
    }
  } finally { b.close(); }
});

test("a creature holding the wheel does not block a hand — the act is what resolves it", async () => {
  // ⚑ THE FOUNDER'S OWN QUESTION, 2026-08-28: "I also tried striking and it's
  // just stuck now? like when does the cake take its turn?" It takes it when
  // you act.
  //
  // LOGOS § The arena: "Hostile turns are resolved by the act that ends a
  // player's turn, in the same handling, until the wheel reaches a player
  // again. There is no daemon and no ticker: the duet is the event loop."
  //
  // arenaActViaOffice drives every due hostile turn (step 4) before the gate
  // judges anyone (step 5), so a caller told "it is the creature's turn" is
  // being refused for the one thing that would have moved the fight. The bar
  // greyed itself out and waited for a turn nothing was ever going to take.
  const b = bottle();
  try {
    // ASKED OF THE FUNCTION DIRECTLY, and that is a deliberate choice rather
    // than a shortcut. The wheel comes to rest on a creature only through a
    // particular history — the last hand leaves, the rounds run on with nobody
    // to hand the turn to, and someone crosses back in to find it holding the
    // wheel (seen live 2026-08-28). Staging that through the door means driving
    // the fold to a specific turnsTaken, which tests the fold's arithmetic
    // rather than this rule. `actingBlocked` is a pure function of a state and
    // a name, so it is asked as one.
    const wheel = (turn, order) => ({ encounter_live: true, downed: [], wheel: { turn, order } });
    const creatureOnTurn = wheel(CAKE, [
      { who: CAKE, kind: "hostile" },
      { who: "rei", kind: "player" },
    ]);
    assert.equal(actingBlocked(creatureOnTurn, "rei"), null,
      "a creature's turn does not block a hand — the hand's act is what drives it");

    // THE DISCRIMINATING LEG. Without it this passes just as well against a
    // door that stopped gating altogether, and the gate is the law: "An act out
    // of turn is refused NAMING WHOSE TURN IT IS."
    const playerOnTurn = wheel("darko", [
      { who: "darko", kind: "player" },
      { who: "rei", kind: "player" },
    ]);
    assert.equal(actingBlocked(playerOnTurn, "rei")?.acting_blocked?.whose_turn, "darko",
      "another HAND's turn still blocks, by name — nothing here drives a person");

    // and the name reported past a creature is the hand the gate will really
    // judge against, not the creature the wheel happens to be resting on
    const past = wheel(CAKE, [
      { who: CAKE, kind: "hostile" },
      { who: "darko", kind: "player" },
      { who: "rei", kind: "player" },
    ]);
    assert.equal(actingBlocked(past, "rei")?.acting_blocked?.whose_turn, "darko",
      "the turn reported is the one after the duet resolves, which is the one the gate will judge");

    // the act itself, through the real door, so the rule above is a promise the
    // door keeps rather than a claim about a literal
    await act(b, "rei", "guard");
    const s = state(b);
    if (s.wheel?.turn === "rei") {
      const r = await act(b, "rei", "strike", { object: CAKE });
      assert.equal(r.did, "strike", "and an unblocked hand's act is one the door takes");
    }
  } finally { b.close(); }
});

// ── THE BIRTHDAY AMENDMENTS (founder-ruled 2026-08-29) ──────────────────────
//
// Five rulings taken at the birthday sitting, each amending its LOGOS clause
// BEFORE any of this was written. The clauses are quoted verbatim beside the
// assertions, out of LOGOS/classes.md as amended — never out of the brief that
// carried them here, which is lossy compression of a sitting.

test("the wheel gates ARENA verbs only — an ordinary verb is never refused for whose turn it is", async () => {
  // LOGOS § The arena, verbatim:
  //   "The wheel gates this ground's ARENA verbs, and nothing else. While an
  //    encounter is live, an arena affords `strike`, `cast`, `guard`, `lift` and
  //    `pass` only to whoever the wheel is on. … The ordinary verbs of the town
  //    are not the wheel's business: walk, say, stake, unstake, give, take and
  //    every other verb a resident holds anywhere flow UNGATED inside a live
  //    encounter, exactly as they do outside one."
  const b = bottle();
  try {
    await act(b, "darko", "guard");
    await act(b, "rei", "guard").catch(() => {});
    const s = state(b);
    assert.ok(s.encounter_live, "the setup never opened a fight — nothing would be gated either way");
    const outOfTurn = ["darko", "rei"].find((h) => h !== s.wheel.turn);
    assert.ok(outOfTurn, "the setup left nobody out of turn");

    // THE PRECONDITION LEG: the wheel really is standing in this hand's way.
    // Without it every assertion below passes against a door with no gate.
    //
    // ⚠ AMENDED 2026-08-29 with the queue — the arena verb is HELD out of turn
    // rather than refused. The precondition is unchanged in substance: the door
    // still treats this hand's arena act differently from an ordinary verb, and
    // until it does, the ordinary-verb legs below discriminate nothing.
    const gated = await act(b, outOfTurn, "strike", { object: CAKE });
    assert.ok(gated?.queued, "an out-of-turn STRIKE was neither held nor refused — until the wheel does something with it, the legs below discriminate nothing");
    assert.equal(gated.queued.whose_turn, s.wheel.turn, "and the queued answer names whose turn it is");

    // THE RULING: an ordinary verb reaching this door is refused for being the
    // WRONG VERB FOR THIS GROUND, never for the wheel. 422, not 409 — a
    // different refusal entirely, which is the point: the wheel is never asked.
    for (const ordinary of ["walk", "say", "stake", "take"]) {
      const e = await act(b, outOfTurn, ordinary).then(() => null, (err) => err);
      assert.ok(e, `"${ordinary}" was accepted by the arena door, which lends five verbs and not that one`);
      assert.equal(e.code, 422,
        `"${ordinary}" was refused ${e.code} ("${e.defect}") mid-fight — the wheel is gating a verb that is not its business`);
      assert.doesNotMatch(String(e.defect), /turn/,
        `"${ordinary}" was refused by the wheel ("${e.defect}"), and the amended clause says the ordinary verbs flow ungated`);
    }
  } finally { b.close(); }
});

test("the read's half names WHAT is gated — acting_blocked carries the arena verbs and nothing wider", () => {
  // LOGOS § The arena: "The wheel gates this ground's ARENA verbs, and nothing
  // else." And § Downed, not dead: "Down stops your ARENA acts, not your voice:
  // a downed hand still speaks, still walks, still holds and hands things over."
  //
  // ⚑ THIS FIELD IS THE RULING'S WHOLE LIVE SURFACE. The `do:` gate never held
  // walk or say — the arena door refuses anything that is not an arena verb
  // before the wheel is consulted at all. What actually stopped the founder
  // moving mid-party is a page reading `acting_blocked` and greying its whole
  // bar, because until this amendment that is what the law said.
  const wheelState = (turn, order, downed = []) => ({
    encounter_live: true, downed,
    wheel: { turn, round: 1, order: order.map((o) => ({ ...o, initiative: 10 })) },
  });
  const blocked = actingBlocked(
    wheelState("darko", [{ who: "darko", kind: "player" }, { who: "rei", kind: "player" }]), "rei");
  assert.deepEqual(blocked?.acting_blocked?.gates, [...ARENA_VERBS],
    "the turn refusal does not name what it gates — a reader with no list can only grey everything");
  assert.match(String(blocked.acting_blocked.hint), /walk/,
    "the hint must say the ordinary verbs are unaffected, for the reader who has sentences and no field");

  const down = actingBlocked(
    wheelState("rei", [{ who: "darko", kind: "player" }, { who: "rei", kind: "player" }], ["darko"]), "darko");
  assert.equal(down?.acting_blocked?.downed, true, "the setup did not produce the downed refusal");
  assert.deepEqual(down.acting_blocked.gates, [...ARENA_VERBS],
    "being down gates more than the arena verbs — down stops your acts, not your voice");
});

test("loot is not in the room until the room is spent — and then it is", () => {
  // LOGOS § The portal ground, verbatim:
  //   "A thing whose mark declares `loot` is NEITHER VISIBLE NOR TAKEABLE while
  //    the encounter on its ground is afoot: it is absent from that ground's
  //    loose things, absent from what a standpoint says stands nearby, and a
  //    `take` or a `give` aimed at it is refused with a sentence that explains
  //    itself rather than a bounce that reads like a fault. At `spent` it
  //    appears, and from that moment it is an ordinary thing under the ordinary
  //    law above. A weapon lying on the floor is loose WITHOUT being loot."
  const b = bottle();
  try {
    const ground = arenaGroundAt(b.db, IN_VAULT).row;

    // AFOOT: the wick end is out of the answer entirely — not flagged, ABSENT.
    const afoot = looseIn(b.db, ground, { phase: "afoot" });
    assert.equal(afoot.find((l) => l.thing === WICK), undefined,
      "the loot was lying in the room before the cake was beaten — which is the founder's own complaint, word for word");
    assert.ok(afoot.find((l) => l.thing === LIGHTER),
      "the lighter vanished with the loot — a weapon is loose WITHOUT being loot, and hiding it takes the fight's own tool away");

    // SPENT: it appears, an ordinary thing.
    assert.ok(looseIn(b.db, ground, { phase: "spent" }).find((l) => l.thing === WICK)?.loot,
      "the loot never appeared at spent — the shroud is a delay, not a deletion");

    // ── THE FIELDS AN INJECTED ENTRY IS BUILT FROM, off the real record ─────
    //
    // ⚑ ASSERTED HERE BECAUSE THE INJECTION'S OWN TEST CANNOT SEE THEM. That
    // test hands `withLoose` rows it built itself, so it proves what the
    // injection does with a row and never what the READER puts in one — the
    // flip that swapped `subkind` for `class` in `looseIn` stayed green against
    // it. This is the store's own answer.
    const lighter = looseIn(b.db, ground, { phase: "afoot" }).find((l) => l.thing === LIGHTER);
    assert.equal(lighter.kind, "sited",
      "the row says `thing` where `nearby` carries `sited` — that is the mark's CLASS in the field that holds its KIND, and an injected entry would be the one row in the list spelling it differently");
    assert.deepEqual(lighter.extent, { w: 0.2, h: 0.2 },
      "the row carries no extent — an injected entry would be the one floor item with no size");
    assert.equal(lighter.tier, "market", "the row carries no tier, which every other `nearby` entry has");

    // THE LIST THE STANDPOINT SUBTRACTS — the other half of "absent from what a
    // standpoint says stands nearby".
    assert.deepEqual(lootShroudedIn(b.db, ground, "afoot"), [WICK],
      "the shroud list does not name the wick end — the standpoint has nothing to subtract");
    assert.deepEqual(lootShroudedIn(b.db, ground, "spent"), [],
      "the shroud outlived the fight");
  } finally { b.close(); }
});

test("a standpoint's `nearby` drops shrouded loot, and keeps everything else it always kept", async () => {
  // LOGOS § The portal ground: loot is "absent from what a standpoint says
  // stands nearby". A FILTER, not a flag — a page that has the id can draw the
  // thing, and a thing drawn in the room is a thing "already sitting in the
  // room before you even beat the cake".
  const { withLoose } = await import("../src/world-apex.mjs");
  const nearby = [{ id: WICK }, { id: LIGHTER }, { id: CAKE }];
  const hidden = withLoose(nearby, { shrouded: [WICK], floor: [], state: { dropped: [{ thing: LIGHTER, by: "darko", at_seq: 9 }] } });
  assert.deepEqual(hidden.map((o) => o.id), [LIGHTER, CAKE],
    "the shrouded loot survived into `nearby` — the site draws what the door hands it");
  assert.equal(hidden.find((o) => o.id === LIGHTER)?.loose, true,
    "the dropped weapon lost its `loose: true` — the shroud ate an answer it was only supposed to pass through");
  const open = withLoose(nearby, { shrouded: [], floor: [], state: { dropped: [] } });
  assert.deepEqual(open.map((o) => o.id), [WICK, LIGHTER, CAKE],
    "an unshrouded room lost something — with no loot held back this must be what it always was");
});

test("take and give of shrouded loot are refused with a sentence that explains itself", () => {
  // LOGOS § The portal ground: "a `take` or a `give` aimed at it is refused
  // with a sentence that explains itself rather than a bounce that reads like a
  // fault." Asserted on `lootHiddenReason` — the answer the hold door refuses
  // FROM — because the door itself opens the live world store, and what is
  // under test is the law's reading of a room rather than that plumbing.
  const b = bottle();
  try {
    const afoot = lootHiddenReason(b.db, b.dyn, WICK);
    assert.ok(afoot, "the wick end could be taken while the cake was still standing");
    assert.equal(afoot.ground, VAULT, "the refusal must name the room whose loot it is");
    assert.equal(afoot.adversary, CAKE, "and what is still standing in it, or the sentence explains nothing");

    // THE WEAPON IS NOT LOOT — the leg that stops "refuse everything on an
    // arena floor" from passing this test.
    assert.equal(lootHiddenReason(b.db, b.dyn, LIGHTER), null,
      "the good lighter was refused — a weapon is loose without being loot, and the fight is meant to be fought with it");
    assert.equal(lootHiddenReason(b.db, b.dyn, "the-town/nothing-of-the-sort"), null,
      "a thing the record does not carry was treated as shrouded loot");
  } finally { b.close(); }
});

test("the weapon says WHICH ACT it augments, read off the grant's own entry", async () => {
  // Site-pinned 2026-08-29 (bday-cockpit, ruled by Wright): two of this room's
  // acts state damage and only one is helped by what is held, so without this a
  // page has to invent the act's name to know where to render the bonus.
  //
  // ⚑ THE VALUE IS THE GRANT'S OWN WORD, never a constant. The office already
  // looks for `action === "strike"` when it resolves a weapon, so a hardcoded
  // "strike" here would agree with today's record and be wrong the first time a
  // thing grants `cast` — and nothing would notice, because it would still
  // match. Read from the entry.
  //
  // ⚠ THE WORD IS `augments`, AND `for` IS THE TRAP IT WAS RENAMED OUT OF
  // (Wright, 2026-08-29). LOGOS § The three channels: "`for:` is the actor kind
  // (absent means resident)" — and `heldEntries` sets exactly that sense on the
  // entry this value is read FROM, so `for` would have meant actor-kind on the
  // record and act-name in the answer two paces apart. Renamed rather than
  // registered, by the register's own rule: young, cheap, actively harmful.
  //
  // The absence of `for` is asserted below, because a homonym that comes back
  // through a merge is a homonym nobody notices twice.
  const { declareAttachment } = await import("../src/dynamic-entities.mjs");
  const b = bottle();
  try {
    declareAttachment(b.dyn, { entity: "darko", target: LIGHTER, declaredBy: "darko" });
    const held = weaponInHand(b.db, "darko");
    assert.ok(held, "darko is not holding the lighter — the setup failed and nothing below discriminates");
    assert.equal(held.bonus, 3, "the bonus is the record's number");
    assert.equal(held.augments, "strike",
      "the weapon does not say which act its bonus helps — the page must invent the act name to place the bonus, and then the claim is the site's rather than the record's");
    assert.equal("for" in held, false,
      "`for` is back on the weapon — it means the ACTOR KIND on the grant entry this value is read from, and the rename exists so a reader never meets both senses");
    assert.equal(weaponInHand(b.db, "rei"), null, "an empty-handed hand was handed somebody else's weapon");

    // AND IT RIDES THE HAND'S OWN ANSWER, which is where the page reads it.
    await act(b, "darko", "guard");
    const hand = state(b).hands.darko;
    assert.equal(hand.weapon?.augments, "strike",
      "the act rode the weapon reader but not the hand's answer — `encounter_detail.hands[who].weapon.augments` is the consumer's path");
    assert.equal("for" in (hand.weapon ?? {}), false, "and the retired spelling does not ride along beside the new one");
    assert.equal(hand.weapon?.thing, LIGHTER, "and the hand's answer names the thing itself");
  } finally { b.close(); }
});

test("the encounter answer carries a CAPPED tail of beats, and says where the tail ends", async () => {
  // Requested by the site lane 2026-08-29. Without beats, a combat log can only
  // infer other hands' lines from hit-point deltas in the receiving voice — "rei
  // takes 7" — and can never say WHO struck. That is a page re-deriving what the
  // fold already knows, which is the same shape as a second arithmetic beside
  // the engine's.
  //
  // LOGOS § Downed, not dead: "the journal keeps the failed attempt as history."
  // A beat is the fight's own record, so nothing here is anybody's private
  // business; the original objection to publishing them was LENGTH, and length
  // is answered with a cap rather than with silence.
  //
  // The cap is asserted on SYNTHETIC beats because `publicState` is a pure
  // function of a state and the cap is arithmetic over an array — driving a real
  // fight long enough to overflow it would be measuring the dice. The real door
  // is driven below for the half that is about the door.
  const many = Array.from({ length: BEATS_TAIL * 2 }, (_, i) => ({ seq: i + 1, actor: "darko", act: "strike", round: 1 }));
  const pub = publicState({ phase: "afoot", beats: many });
  assert.equal(pub.beats_tail.length, BEATS_TAIL,
    `the answer carried ${pub.beats_tail.length} of ${many.length} beats — an answer that grows with the length of the party is not bounded`);
  assert.deepEqual(pub.beats_tail, many.slice(-BEATS_TAIL),
    "the tail is not the LAST beats — a combat log reading it would render the opening of the fight forever");
  // NO LATEST-SEQ FIELD (Wright's ruling with bday-rail, 2026-08-29): the
  // consumer derives its watermark as the max seq in the window, so a separate
  // field would be a second way to learn one fact. Asserted as an ABSENCE
  // because a field quietly reappearing is how one contract becomes two.
  assert.equal("beats_through" in pub, false,
    "a latest-seq field is back — the consumer derives its watermark from the window, and two ways to learn one fact is how a contract forks");
  assert.equal(pub.beats_total, many.length,
    "the answer does not say how much it withheld, so a reader cannot tell a full history from a truncated one");
  assert.equal("beats_tail" in publicState({ phase: "afoot", beats: [] }), false,
    "a fight with no beats answered with an empty tail instead of no tail — a reader must not have to tell those apart");

  // AND THROUGH THE REAL DOOR: the tail arrives, and it names who struck, which
  // is the whole request.
  const b = bottle();
  try {
    await act(b, "darko", "guard");
    await act(b, "darko", "strike", { object: CAKE }).catch(() => {});
    const live = publicState(state(b));
    assert.ok(live.beats_tail?.length, "a live fight's answer carried no beats at all");
    assert.ok(live.beats_tail.every((x) => "seq" in x), "a beat with no seq cannot be deduped against");
    assert.ok(live.beats_tail.some((x) => x.actor),
      "no beat in the tail names its actor — the page is back to guessing who struck from hit-point deltas");
  } finally { b.close(); }
});

test("`loose:` keeps BOTH halves its own doc promises — the record's and the fold's", async () => {
  // src/world-apex.mjs § withLoose, its own words since the day it was written:
  //   "A thing is loose when the record sites it here and nobody is holding it,
  //    OR when the fold says somebody DROPPED it going down."
  //
  // Only the second half ever ran. The good lighter — sited on the vault floor,
  // held by nobody, and the whole point of the weapon ruling — never carried
  // `loose: true`, so a page drawing floor items off `nearby[].loose === true`
  // could not draw it. Found by the site lane walking into it, 2026-08-29.
  //
  // It matters twice tonight: the loot amendment's payoff is "at `spent` it
  // appears", and a thing that appears with no `loose` flag appears on no floor
  // anybody draws.
  const { withLoose } = await import("../src/world-apex.mjs");
  const nearby = [{ id: WICK }, { id: LIGHTER }, { id: CAKE }];
  // `floor` is ROWS since 2026-08-29, not ids — the entries have to be
  // buildable, because `withLoose` now injects the ones salience never ranked.
  const FLOOR_LIGHTER = { thing: LIGHTER, by: "the-town", at: { x: 1095.5, y: -784 },
                          extent: { w: 0.2, h: 0.2 }, kind: "sited", tier: "market", body: "A brass lighter." };

  // THE RECORD'S HALF: sited here, unheld, nothing dropped by anyone.
  const byRecord = withLoose(nearby, { shrouded: [WICK], floor: [FLOOR_LIGHTER], state: { dropped: [] } });
  assert.equal(byRecord.find((o) => o.id === LIGHTER)?.loose, true,
    "a thing the record sites on this floor with nobody holding it is not marked loose — the first half of the doc's own sentence");
  assert.equal(byRecord.find((o) => o.id === CAKE)?.loose, undefined,
    "the adversary was marked as lying loose on the floor — `loose` is for things a hand could pick up");

  // THE FOLD'S HALF still carries the fight's facts beside the boolean.
  const byFold = withLoose(nearby, { shrouded: [WICK], floor: [], state: { dropped: [{ thing: LIGHTER, by: "darko", at_seq: 9 }] } });
  assert.equal(byFold.find((o) => o.id === LIGHTER)?.dropped_by, "darko",
    "a weapon dropped in the fight lost who dropped it — the fold's half must keep its own facts");

  // A HELD THING IS NOT LOOSE. Without this leg, "mark everything sited here"
  // passes — and a sword in somebody's hand would be drawn lying on the floor.
  const heldByHand = withLoose(nearby, { shrouded: [WICK], floor: [], state: { dropped: [] } });
  assert.equal(heldByHand.find((o) => o.id === LIGHTER)?.loose, undefined,
    "a thing somebody is holding was drawn on the floor");
});

test("the floor rides `nearby` even when salience never ranked it — and the shroud still outranks the floor", async () => {
  // LOGOS § The portal ground, verbatim (2026-08-29):
  //   "Inside a portal ground the floor is not the world's business, it is the
  //    GROUND's: whatever lies loose there rides the standpoint's answer whether
  //    or not salience would have chosen it, because a room whose furniture of
  //    play is invisible is a room nobody can play in."
  //   "The shroud outranks it. Loot the encounter is still holding back is
  //    absent either way; lying on the floor never overrides being hidden, and
  //    the two clauses meet in that order."
  //
  // ⚑ THIS IS THE TEST THE LAST ROUND DID NOT HAVE, and its absence is why the
  // marking fix shipped over an empty floor. Every falsifier for `withLoose`
  // handed it a `nearby` that ALREADY CONTAINED the thing — so all of them
  // proved the marking and none of them could see that the live `nearby` never
  // carries a 0.2 m lighter at all. `nearby` is the eyes' salience ranking under
  // a budget of about thirteen, and it ranks by how much of a thing there is to
  // see, so the floor loses to every building in the district.
  //
  // The apparatus here is the crowd: `nearby` carries only big marks, exactly
  // as the live door answered when a spectator stood ON the lighter and got
  // thirteen entries without it.
  const { withLoose } = await import("../src/world-apex.mjs");
  const crowd = Array.from({ length: 13 }, (_, i) => ({ id: `the-town/a-large-house-${i}`, at: { x: 1000 + i, y: -800 }, kind: "sited" }));
  const floorRow = (id, extra = {}) => ({ thing: id, by: "the-town", at: { x: 1096, y: -784 },
                                          extent: { w: 0.2, h: 0.2 }, kind: "sited", tier: "market", body: "on the floor", ...extra });

  // AFOOT: the lighter is injected; the shrouded wick end is not.
  const afoot = withLoose(crowd, {
    shrouded: [WICK],
    floor: [floorRow(LIGHTER), floorRow(WICK)],
    state: { dropped: [] },
  }, { standpoint: { x: 1097, y: -783.5 } });

  const lighter = afoot.find((o) => o.id === LIGHTER);
  assert.ok(lighter, "the lighter is not in `nearby` at all — salience never ranked it and nothing put it back, so the floor the site draws is empty");
  assert.equal(lighter.loose, true, "and it rode in without the flag the site filters on");
  assert.equal(lighter.at.x, 1096, "the injected entry lost its position — a floor item with no `at` cannot be drawn anywhere");
  assert.equal(lighter.kind, "sited",
    "the injected entry says `thing` where every other entry says `sited` — that is the mark's CLASS in the field that carries its KIND");
  assert.equal(lighter.via, "floor",
    "the injected entry does not say where it came from — a reader counting `nearby` against the eyes' budget is owed the reason");
  assert.equal(lighter.distance_m, 1.1,
    "the injected entry carries no distance from a standpoint that has one — a consumer sorting by distance puts it nowhere");
  assert.equal("bearing" in lighter, false,
    "a bearing was invented here — that convention belongs to the engine's field of view, and a second implementation is a second answer");

  assert.equal(afoot.find((o) => o.id === WICK), undefined,
    "shrouded loot was INJECTED — being on the floor must never override being hidden, and the injection is the one path that could smuggle it in");

  // SPENT: the shroud lifts and the same reader hands the prize over.
  const spent = withLoose(crowd, { shrouded: [], floor: [floorRow(LIGHTER), floorRow(WICK)], state: { dropped: [] } },
    { standpoint: { x: 1097, y: -783.5 } });
  assert.equal(spent.find((o) => o.id === WICK)?.loose, true,
    "at spent the loot never appeared — the shroud is a delay, not a deletion, and the injection is what makes the appearance visible");

  // NO DOUBLE ENTRY. A thing salience DID rank must not arrive twice.
  const ranked = withLoose([...crowd, { id: LIGHTER, at: { x: 1096, y: -784 }, kind: "sited", bearing: "NE" }],
    { shrouded: [], floor: [floorRow(LIGHTER)], state: { dropped: [] } }, { standpoint: { x: 1097, y: -783.5 } });
  assert.equal(ranked.filter((o) => o.id === LIGHTER).length, 1,
    "the lighter arrived twice — a thing salience ranked must be MARKED, not injected beside itself");
  assert.equal(ranked.find((o) => o.id === LIGHTER).bearing, "NE",
    "the ranked entry was replaced by the injected one, losing the engine's own bearing — marking must win where both exist");

  // AND OUTSIDE A PORTAL NOTHING CHANGES: no portal, no injection, no marking.
  assert.deepEqual(withLoose(crowd, null), crowd,
    "a standpoint outside any portal ground had its `nearby` touched — every ordinary read in the town must be byte-identical");
});

test("...and the HOLD DOOR itself refuses it — the guard is wired, not merely written", async () => {
  // LOGOS § The portal ground: "a `take` or a `give` aimed at it is refused with
  // a sentence that explains itself rather than a bounce that reads like a
  // fault."
  //
  // ⚑ THE LEG ABOVE ASSERTS THE LAW; THIS ONE ASSERTS THE WIRE. `lootHiddenReason`
  // can be perfect while `callHoldTool` never calls it, which is the shape
  // src/arena.mjs's own header names — a function existing is not a function
  // running, and this whole module exists because of one instance of it. So the
  // real door is driven, against a real world store on disk, with the same
  // marks the fixture carries.
  const dir = mkdtempSync(join(tmpdir(), "bde-hold-"));
  const prev = { store: process.env.WORLD_STORE_DB, dyn: process.env.WORLD_DYNAMIC_DB, log: process.env.WORLD_SINGLE_LOG,
                 mv2: process.env.WORLD_MOVEMENT_V2 };
  const storePath = join(dir, "world.db");
  // Declared out here so the `finally` can undo them whatever throws inside.
  let restoreGuardReader = null, restorePgEnv = null;
  try {
    // the same bottle, written to disk where `storeDbPath()` will find it
    const disk = new DatabaseSync(storePath);
    disk.exec(SCHEMA);
    disk.prepare("INSERT INTO meta VALUES (?, ?)").run("hydration_status", "OK");
    const src = worldDb();
    for (const r of src.prepare("SELECT * FROM nodes").all()) {
      const cols = Object.keys(r);
      disk.prepare(`INSERT INTO nodes (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
        .run(...cols.map((c) => r[c]));
    }
    src.close(); disk.close();
    process.env.WORLD_STORE_DB = storePath;
    process.env.WORLD_DYNAMIC_DB = join(dir, "dynamic.db");
    process.env.WORLD_SINGLE_LOG = "1";
    // Dev's own condition, and the one a placed hand needs: with movement-v2
    // off, `departuresAcrossEras` reads the frozen ledger ALONE and a position
    // written to the store is invisible (src/world.mjs § departuresAcrossEras).
    // Dev has run this flag since movement-v2 shipped; the office comment at
    // world.mjs § THE WALK GAP says so in as many words.
    process.env.WORLD_MOVEMENT_V2 = "1";

    const { callHoldTool } = await import("../src/world-hold.mjs");
    const key = { handles: new Set(["darko"]) };

    // ⛔ DARKO HAS TO BE STANDING IN THE ROOM, and until 2026-09-07 he did not
    // have to be. `the-town/the-reach` (world #21, founder-ruled) makes a take a
    // threshold act, and without this placement this test drove the door from
    // darko's HOME — 6,466 m from the vault — and took the vault's loot from
    // there. The take succeeded, which is what this test was proving, and it
    // should not have: a hand who has not entered the room is not in the fight.
    // The placement is the one `spawnOnEnter` writes for a real entrant, in the
    // same words: a zero-length departure to where the ground sets them down.
    //
    // POS-154: the placement used to be `declareMovement` into `dynamic.db`.
    // `storedDepartures` reads `acts` now and no longer opens that file, so a
    // movements row places nobody — this test went red on the distance check
    // ("you are not standing where the-town/the-good-lighter stands") with every
    // assertion below still correct. The same zero-length departure is filed as
    // the ACT the movement-store pen writes, through the reader seam.
    //
    // ⚑ THE STUB THROWS ON EVERY OTHER QUERY, deliberately. This office has no
    // `WORLD2_PG` of its own, so before this lane the guard reads here refused
    // and the hold path took its own degraded answers. Answering `[]` instead
    // would hand `readHoldEffects` a readable-but-empty record where it used to
    // get `{ readable: false }`, which is a different door — so only the
    // departure query is answered and the rest refuse exactly as they did.
    const prevPg = { on: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
    process.env.WORLD2_PG = "1";
    process.env.WORLD2_PG_URL = "postgres://arena-test/none";
    const { useGuardReader } = await import("../src/world2-guards.mjs");
    const spot = { x: 1082, y: -792.4 }; // the vault floor, beside the loot
    restoreGuardReader = useGuardReader(async (fn) => fn({
      query: async (sql, params) => {
        if (!/FROM acts/i.test(String(sql)) || !String(sql).includes("_ledger")) {
          throw new Error("this fixture answers the departure query only");
        }
        const actions = params?.[0] ?? [];
        if (!actions.includes("walk")) return { rows: [] };
        // ⚑ THE INSTANT IS IN THE PAST, and it has to be. `storedDepartures`
        // cuts on the record's own `iso` against the `atMs` the door captured
        // BEFORE it asked — so an act stamped `new Date()` inside the stub is
        // stamped after the cut and is dropped, silently, leaving darko
        // unplaced and this test red on the distance check for a reason that
        // has nothing to do with what it asserts.
        return { rows: [{
          id: 1, at: new Date(Date.now() - 60_000), crossing: "0", actor: "darko", action: "walk",
          payload: { from: spot, toward: spot, within: null, to: VAULT, pace: 0, declared_by: "darko" },
        }] };
      },
    }));
    restorePgEnv = () => {
      if (prevPg.on == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = prevPg.on;
      if (prevPg.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = prevPg.url;
    };

    const refused = await callHoldTool("world_hold", { thing: WICK }, key).then(() => null, (e) => e);
    assert.ok(refused, "the hold door took the wick end while the cake was still standing — the guard is written but not wired");
    assert.equal(refused.code, 409, `the refusal came back ${refused.code}, and a thing that is simply not there yet is not a 4xx about the caller`);
    assert.match(String(refused.hint), /not in the room until the room is spent/,
      "the refusal does not explain itself — a bounce a resident cannot read is a bounce that reads like a fault");
    assert.match(String(refused.hint), new RegExp(CAKE.split("/").pop()),
      "the refusal does not name what is still standing");

    // THE DISCRIMINATING LEG: the weapon goes through the same door, unrefused.
    // Without it a guard that refused every take would pass everything above.
    const took = await callHoldTool("world_hold", { thing: LIGHTER }, key);
    assert.ok(took, "the good lighter was refused by the shroud — the fight is meant to be fought with it");

    // ── AND A HELD THING IS NOT ON THE FLOOR ────────────────────────────────
    //
    // `portalBlockAt` is where `loose:` learns what the RECORD sites here, and
    // it must subtract what somebody is holding. Driven here rather than in the
    // `withLoose` unit test because that test is handed its list — it can never
    // catch the reader that BUILDS the list getting it wrong, which is what the
    // flip runner found. darko is holding the lighter as of the line above.
    const { portalBlockAt, openStore } = await import("../src/world-apex.mjs");
    const store = openStore();
    try {
      const portal = portalBlockAt(store.db, IN_VAULT);
      assert.ok(portal, "no portal block at the vault — the legs below would prove nothing");
      const onFloor = (portal.floor ?? []).map((t) => String(t.thing));
      assert.equal(onFloor.includes(LIGHTER), false,
        "a thing in darko's hands is still listed as lying on the floor — the site would draw it twice, once in the hand and once underfoot");
      assert.equal(portal.shrouded.includes(WICK), true,
        "the shroud list lost the wick end while the cake is still standing");
      assert.equal(onFloor.includes(WICK), false,
        "shrouded loot leaked into the floor list — the two readers disagree about the same room");
      // ROWS, NOT IDS — the injection has to be able to BUILD a nearby entry
      // from this, so a list of bare ids is the shape that could not.
      for (const row of portal.floor ?? [])
        assert.ok(row.at && Number.isFinite(row.at.x),
          `the floor row for ${row.thing} carries no position — an injected entry with no \`at\` cannot be drawn`);
    } finally { try { store.db?.close(); } catch { /* already gone */ } }
  } finally {
    if (restoreGuardReader) restoreGuardReader();
    if (restorePgEnv) restorePgEnv();
    for (const [k, v] of [["WORLD_STORE_DB", prev.store], ["WORLD_DYNAMIC_DB", prev.dyn], ["WORLD_SINGLE_LOG", prev.log], ["WORLD_MOVEMENT_V2", prev.mv2]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds it a beat */ }
  }
});

test("crossing into the vault stands you at its door-side edge, never inside the cake", async () => {
  // LOGOS § The arena, verbatim:
  //   "An entrant into a wheel-keeping ground is placed where the ground was
  //    entered from — the point on its boundary the crossing came through — and
  //    never within an adversary's own extent. Where that edge point falls
  //    inside one, the placement steps back OUT along the way in until it is
  //    clear, by arithmetic every reader repeats identically."
  //
  // The vault is 3 x 2 at (1097, -783.5) and the cake is 1.5 x 1 dead in the
  // middle of it — so a walk to the room's CENTRE lands a token inside the
  // adversary, which is the founder's complaint word for word.
  //
  // ⚑ THE ARRIVAL MATH IS THE CLONE'S OWN, imported here exactly as the walk
  // desk imports it. A test that re-implemented the slab test would be checking
  // the office against a second arrival truth, which is the drift the world
  // repo exports `targetEntryT` to prevent.
  const { targetEntryT } = await import(pathToFileURL(join(WORLD_CLONE, "tools", "walk.mjs")));
  const b = bottle();
  try {
    const place = arenaGroundAt(b.db, IN_VAULT);
    const cake = adversaryIn(b.db, place);
    assert.ok(cake, "the setup has nothing standing in the vault");
    const inCake = (p) => p.x >= 1096.25 && p.x <= 1097.75 && p.y >= -784 && p.y <= -783;
    assert.ok(inCake({ x: 1097, y: -783.5 }),
      "the fixture's cake does not cover the vault's centre — this test's whole premise is that overlap");

    for (const from of [{ x: 1097, y: -790 }, { x: 1090, y: -783.5 }, { x: 1104, y: -783.5 }, { x: 1097, y: -776 }]) {
      const p = entryPointInto(from, place.row, cake, { entryT: targetEntryT, step: 0.25 });
      assert.ok(p, `no placement computed for an entrant from ${from.x},${from.y}`);
      assert.ok(!inCake(p), `an entrant from ${from.x},${from.y} was set down at ${p.x},${p.y} — inside the cake`);
      assert.ok(p.x >= 1095.5 && p.x <= 1098.5 && p.y >= -784.5 && p.y <= -782.5,
        `an entrant from ${from.x},${from.y} was set down at ${p.x},${p.y} — outside the vault entirely`);
    }

    // ── THE STEP-CLEAR, EXERCISED ───────────────────────────────────────────
    //
    // ⚑ THE FIXTURE'S OWN CAKE NEVER TOUCHES A WALL, so every placement above
    // is already clear on its first try and NONE of them walks the back-off
    // loop. Found by the flip runner: deleting the loop outright left the suite
    // green, which is a hole and not a pass. This is an adversary wedged across
    // the whole south wall — the degenerate room the clause was written for.
    const wedged = { ...cake, at_x: 1097, at_y: -784, extent_w: 3, extent_h: 1 };   // spans the vault's south edge
    const naive = entryPointInto({ x: 1097, y: -790 }, place.row, null, { entryT: targetEntryT, step: 0.25 });
    const inWedged = (p) => p.x >= 1095.5 && p.x <= 1098.5 && p.y >= -784.5 && p.y <= -783.5;
    assert.ok(inWedged(naive),
      `the wedged adversary does not cover the door-side edge (${naive.x},${naive.y}) — this leg would prove nothing`);
    const clear = entryPointInto({ x: 1097, y: -790 }, place.row, wedged, { entryT: targetEntryT, step: 0.25 });
    assert.ok(!inWedged(clear),
      `an entrant was set down at ${clear.x},${clear.y} — inside an adversary wedged across the doorway`);
    assert.equal(clear.backed_off, true, "the placement did not report that it had to step clear");
    // It steps back along the way IN, so a doorway an adversary fills entirely
    // leaves the entrant AT the threshold rather than inside the thing. That is
    // the clause's own words ("steps back OUT along the way in until it is
    // clear") and it is the honest answer: there is nowhere in this room to
    // stand that is not inside the cake.
    assert.ok(clear.y < -784.5, "the step-clear moved sideways or not at all — it must retreat along the way in");

    // DETERMINISTIC: the same crossing lands on the same tile, forever.
    const twice = [1, 2].map(() => entryPointInto({ x: 1097, y: -790 }, place.row, cake, { entryT: targetEntryT, step: 0.25 }));
    assert.deepEqual(twice[0], twice[1], "two readers of one crossing put the walker in two places");

    // ⚑ A WALKER ALREADY INSIDE IS NOT CROSSING IN. Without this guard the room
    // freezes: every step across the floor would be answered with the step's
    // own start point, and the founder's other ruling tonight was for FINER
    // movement inside this exact room.
    assert.equal(entryPointInto({ x: 1096, y: -784 }, place.row, cake, { entryT: targetEntryT, step: 0.25 }), null,
      "a hand already standing in the vault was re-placed at the door — that is a room nobody can move in");
  } finally { b.close(); }
});

test("a ground sets its entrants down at its own spawn — jittered apart, inside its own fence, and only where declared", () => {
  // The cure for a bug reproduced live 2026-08-29: a hand entered the
  // candle-vault while their body stood ~16 m outside its fence. Entry was
  // adjudicated — occupancy written, "entered" reported — and the wheel never
  // seated them: no join beat, no initiative, NO ERROR. The wheel reads the
  // GEOMETRIC containment spine (`containmentChain`: marks whose footprint
  // contains your point) and entry moves nobody, so inside-by-record and
  // outside-by-geometry are both true at once and only one of them is consulted.
  //
  // Placing the entrant makes the two answers agree. The dial is the GROUND's,
  // on `walk_min_step`'s precedent — never a room's name in the office.
  const b = bottle();
  try {
    const vault = arenaGroundAt(b.db, IN_VAULT);
    const antechamber = arenaGroundAt(b.db, IN_ANTECHAMBER);
    const inVault = (p) => p.x >= 1095.5 && p.x <= 1098.5 && p.y >= -784.5 && p.y <= -782.5;

    // (1) AN ENTRANT IS PLACED, and inside the fence — which is the predicate
    // the join reads. A spawn that landed outside would reproduce the bug.
    const one = spawnPointFor(b.db, vault, { who: "darko", crossing: 155.5 });
    assert.ok(one?.at, "the vault declares a spawn and none was computed — every entrant keeps landing wherever they happened to stand");
    assert.ok(inVault(one.at), `an entrant was placed at ${one.at.x},${one.at.y} — outside the vault, which is the bug this cures wearing a fix's clothes`);

    // (2) TWO ENTRANTS DO NOT STACK.
    const two = spawnPointFor(b.db, vault, { who: "rei", crossing: 155.5 });
    assert.ok(inVault(two.at), "the second entrant landed outside the fence");
    assert.notDeepEqual(one.at, two.at,
      "two entrants were set down on the same tile — at a party they stack into one token and nobody can tell who is who");

    // ...and the jitter is WITNESSED, not random: the same hand at the same
    // crossing lands on the same tile, or the record cannot defend a placement
    // it can never reproduce.
    assert.deepEqual(spawnPointFor(b.db, vault, { who: "darko", crossing: 155.5 }).at, one.at,
      "the same hand landed somewhere else on a second read — that is Math.random wearing a placement");
    assert.notDeepEqual(spawnPointFor(b.db, vault, { who: "darko", crossing: 156.5 }).at, one.at,
      "the crossing does not move the spot — then a room's whole party lands on one tile every night");

    // ...AND THE JITTER CANNOT CARRY ANYBODY OUT. The vault's own 0.25 m jitter
    // is far too small to reach its fence, so the clamp is never exercised by
    // the real dial and shipped untested — the flip runner said so. A spawn in
    // the CORNER with a metre of jitter is the case that reaches it, and a room
    // whose spawn sits near a wall is the ordinary case, not a contrived one.
    const corner = { ...vault, row: { ...vault.row,
      dials: JSON.stringify({ walk_min_step: 0.25, spawn: { x: 1095.5, y: -784.5 }, spawn_jitter_m: 1 }) } };
    for (const hand of ["darko", "rei", "keeminlee", "limen", "meep"]) {
      const p = spawnPointFor(b.db, corner, { who: hand, crossing: 155.5 });
      assert.ok(inVault(p.at),
        `a corner spawn with a metre of jitter put ${hand} at ${p.at.x},${p.at.y} — outside the fence, which is the bug this cures`);
    }

    // (3) THE CONTROL: a ground that declares no spawn places nobody. Without
    // this leg, "always place at the ground's centre" passes everything above
    // and quietly teleports every entrant in the town.
    assert.equal(spawnPointFor(b.db, antechamber, { who: "darko", crossing: 155.5 }), null,
      "the cellar door placed an entrant it never asked to place — a ground that has said nothing must behave exactly as it does today");
  } finally { b.close(); }
});

test("a spawn outside its own ground is refused, not honoured", () => {
  // ⚑ THE GUARD THAT EXISTS BECAUSE THE FIRST ESTIMATE WAS WRONG. The founder's
  // own first reading of the vault's floor was a point outside the vault's
  // extent. Honouring it would teleport every entrant OUT of the room they had
  // just walked into — and the symptom would be identical to the bug being
  // fixed: entered by the record, standing outside the fence, never seated.
  //
  // So a mis-measured dial is disclosed and ignored, leaving today's behaviour,
  // rather than being trusted because it was written down.
  const b = bottle();
  try {
    const vault = arenaGroundAt(b.db, IN_VAULT);
    const wrong = { ...vault, row: { ...vault.row, dials: JSON.stringify({ walk_min_step: 0.25, spawn: { x: 1083, y: -791.4 } }) } };
    const r = spawnPointFor(b.db, wrong, { who: "darko", crossing: 155.5 });
    assert.equal(r?.at, null, "a spawn outside the ground was honoured — every entrant is now placed outside the room they entered");
    assert.match(String(r?.refused ?? ""), /outside its own extent/,
      "and it was dropped in silence, so nobody staging the mark learns the number is wrong");
  } finally { b.close(); }
});

test("a ground may set its own stride, and a ground that has not said so says nothing", () => {
  // LOGOS § The portal ground, verbatim:
  //   "`walk_min_step` is a dial on the ground's own mark, in metres: within
  //    that ground a walk is validated and snapped at that granularity instead
  //    of the town's whole-metre step. Absent … the town-wide step governs and
  //    nothing anywhere changes."
  //   "The dial rides the ground's answer at the door, so a reader drawing that
  //    floor can draw the grid the door will actually accept."
  const b = bottle();
  try {
    const vault = arenaGroundAt(b.db, IN_VAULT);
    const antechamber = arenaGroundAt(b.db, IN_ANTECHAMBER);
    assert.equal(vault.walk_min_step, 0.25, "the vault's stride is the VAULT's dial, not a constant in the office");
    assert.equal(walkMinStepOf(b.db, vault), 0.25, "and the reader disagrees with the place it built");

    // ABSENT, NOT NULL, at the door — the cellar door declares no stride.
    assert.equal(antechamber.walk_min_step, null, "the antechamber invented a stride it never declared");
    assert.equal("walk_min_step" in cockpitPortal(antechamber), false,
      "a ground that has said nothing about its stride answered `walk_min_step: null` — a key that is always there teaches a reader to test its value");
    assert.equal(cockpitPortal(vault).walk_min_step, 0.25,
      "the vault's answer does not carry its stride — a client left to guess the granularity would be inventing law");

    // THE SNAP IS A LATTICE, and it is the same lattice in every reader.
    assert.equal(snapTo(1097.31, 0.25), 1097.25);
    assert.equal(snapTo(1097.4, 0.25), 1097.5);
    assert.equal(snapTo(1097.3, 1), 1097, "the town's whole-metre step is no longer a whole metre");
    // ⚑ THE DUST VALUE IS CHOSEN, NOT ASSUMED. `1097.3` snapped to 0.1 comes
    // out exact even without the correction, so the first version of this line
    // asserted nothing — the flip that removes the correction stayed green.
    // `-784.3` is a real vault coordinate and it is one of the values that does
    // produce dust: Math.round(-784.3 / 0.1) * 0.1 is -784.3000000000001.
    assert.equal(String(snapTo(-784.3, 0.1)), "-784.3",
      "the snap left float dust on the coordinate — -784.3000000000001 is a number that will fail an equality nobody expected to be fragile");
  } finally { b.close(); }
});

test("the walk desk's decision: a room's stride snaps the destination, and crossing in places the entrant", async () => {
  // Both of tonight's walk rulings, asserted where the WALK DESK applies them.
  //
  // LOGOS § The portal ground: "within that ground a walk is validated and
  // snapped at that granularity instead of the town's whole-metre step. Absent
  // … the town-wide step governs and nothing anywhere changes."
  // LOGOS § The arena: "An entrant into a wheel-keeping ground is placed where
  // the ground was entered from … and never within an adversary's own extent."
  //
  // ⚑ `walkViaOffice` HAS NO HARNESS — it wants a world clone, a world store, a
  // dynamic store and a resident before it runs a line, which is why nothing in
  // this repo drives it. So the decision it applies lives in `arrivalOnGround`
  // and is asserted here; what stays in the desk is a store read and three
  // assignments. Law that only a live box could falsify is law nobody falsifies.
  const { targetEntryT } = await import(pathToFileURL(join(WORLD_CLONE, "tools", "walk.mjs")));
  const b = bottle();
  try {
    const vault = arenaGroundAt(b.db, IN_VAULT);
    const antechamber = arenaGroundAt(b.db, IN_ANTECHAMBER);
    const cake = adversaryIn(b.db, vault);
    const opts = { entryT: targetEntryT };

    // ── THE STRIDE, for a hand already standing inside (no placement) ────────
    const inside = { from: { x: 1096, y: -784 }, toward: { x: 1097.31, y: -783.11 }, targetFrom: "coordinates" };
    const stepped = arrivalOnGround(inside, vault, cake, opts);
    assert.deepEqual(stepped?.toward, { x: 1097.25, y: -783 },
      "a step across the vault floor was not snapped to the vault's own 0.25 m stride");
    assert.equal(stepped.placed, undefined,
      "a hand already in the room was PLACED at the door — the room would be unwalkable");
    assert.match(String(stepped.targetFrom), /0\.25 m step/,
      "the answer does not say the destination was snapped — a resident who asked for one point and got another is owed the reason");

    // ── THE PLACEMENT, for a hand crossing in ───────────────────────────────
    const crossing = { from: { x: 1097, y: -790 }, toward: { x: 1097, y: -783.5 }, targetFrom: "the-town/the-candle-vault" };
    const placed = arrivalOnGround(crossing, vault, cake, opts);
    assert.equal(placed?.placed, true, "a crossing into the vault was not placed at all");
    assert.equal(placed.targetExtent, null,
      "the frozen rect survived the placement — a rim arrival would put the walker back wherever the extent says, not where the ruling says");
    assert.ok(!(placed.toward.x >= 1096.25 && placed.toward.x <= 1097.75
                && placed.toward.y >= -784 && placed.toward.y <= -783),
      `an entrant was set down at ${placed.toward.x},${placed.toward.y} — inside the cake, which is the founder's complaint verbatim`);
    assert.match(String(placed.targetFrom), /door-side edge/,
      "the answer does not say where the walker was actually set down");

    // ── A GROUND THAT SAID NOTHING CHANGES NOTHING ──────────────────────────
    // The antechamber declares no stride and keeps no wheel. This is the leg
    // that holds "nothing changes anywhere that doesn't declare it" — without
    // it, the two rulings above are indistinguishable from a town-wide re-cut.
    const ordinary = { from: { x: 1090, y: -790 }, toward: { x: 1097.31, y: -785.07 }, targetFrom: "coordinates" };
    assert.equal(arrivalOnGround(ordinary, antechamber, null, opts), null,
      "the antechamber snapped or placed a walk it never declared a word about");
    assert.equal(arrivalOnGround(ordinary, null, null, opts), null,
      "a walk to ordinary ground was touched — every ground in the town that is not a portal must be untouched by this");

    // and the desk finds the vault from a bare coordinate, which is what a
    // click-to-walk grid sends
    assert.equal(groundAtPoint(b.db, { x: 1097, y: -783.5 })?.ground, VAULT,
      "a point inside the vault did not resolve to the vault — a clicked step would be governed by the wrong floor");
    assert.equal(groundAtPoint(b.db, { x: 1200, y: -700 }), null,
      "a point out in the town resolved to a portal ground");
  } finally { b.close(); }
});

// ── THE AFFORDANCE SET ACROSS THE ENCOUNTER LIFECYCLE ───────────────────────
//
// Founder-reported at the board, 2026-08-29: a human went down, was lifted, and
// came back with STRIKE gone from the bar — walk/say/guard/cast/enter/exit lit,
// lift correctly disabled, strike absent entirely.
//
// ⚑ WHAT THIS FILE COULD NOT REPRODUCE, and the absence is the finding. Against
// the record as it stands — `the-town/arena`'s roster, which pairs every verb
// with a `for: human` entry, and the five verb residues, where strike, guard and
// cast carry the IDENTICAL guard `{within_class: portal-ground}` — the gather
// yields strike to a seated human in every combination: holding the weapon and
// empty-handed, before the fall and after the lift. Strike is indistinguishable
// from guard and cast at every layer the office reads.
//
// So the office is exonerated against the readable record, and the loss is
// data-side (a dev-stage roster differing from the record) or site-side. What
// this test can do is PIN THE PROPERTY, so that if the office ever becomes the
// answer, it is this that goes red rather than a party.
//
// THE PROPERTY: the affordance set does not depend on the encounter. Going down,
// being lifted, dropping a weapon and standing back up change the WHEEL and
// change nothing about which verbs the record grants you where you stand.

test("the verb set is invariant across down and lift — the whole set, not only strike", async () => {
  const { gatherActions, gatherGroundActions, gatherHeldActions } = await import("../src/world-apex.mjs");
  const { resolveForActor } = await import("../src/world-grants.mjs");
  const { foldEncounter, HOSTILE } = await import("../src/encounter.mjs");

  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const ins = db.prepare(`INSERT INTO nodes (id,by,kind,subkind,tier,at_x,at_y,extent_w,extent_h,props) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const P = (o) => JSON.stringify(o);
  // ⚑ THE ARENA'S ROSTER, VERBATIM FROM THE RECORD (proto/birthday, the arena
  // class mark). Transcribed rather than invented, because a fixture that
  // writes the shape the code expects proves only that they agree — and the
  // whole question here is whether the RECORD's shape reaches a human.
  const ARENA_ACTIONS = [
    { action: "strike", residue: "the-town/strike" }, { action: "strike", for: "human", residue: "the-town/strike" },
    { action: "guard", residue: "the-town/guard" }, { action: "guard", for: "human", residue: "the-town/guard" },
    { action: "cast", residue: "the-town/cast" }, { action: "cast", for: "human", residue: "the-town/cast" },
    { action: "lift", residue: "the-town/lift" }, { action: "lift", for: "human", residue: "the-town/lift" },
    { action: "loot", residue: "the-town/loot" }, { action: "loot", for: "human", residue: "the-town/loot" },
  ];
  ins.run("the-town/resident", "the-town", "mark", "class", "constitution", null, null, null, null,
    P({ class: "resident", in_works: true, ambient: true, actions: [
      { action: "say", residue: "the-town/say" }, { action: "walk", residue: "the-town/depart" },
      { action: "enter", residue: "the-town/enter" }, { action: "exit", residue: "the-town/enter" }] }));
  ins.run("the-town/arena", "the-town", "mark", "class", "constitution", null, null, null, null,
    P({ class: "arena", in_works: true, extends: "portal-ground", actions: ARENA_ACTIONS }));
  ins.run(VAULT, "the-town", "mark", "sited", "market", 1097, -783.5, 3, 2, P({ class: "arena" }));
  ins.run(LIGHTER, "the-town", "mark", "sited", "market", 1095.5, -784, 0.2, 0.2,
    P({ class: "thing", held_grant: [{ action: "strike", residue: "the-town/strike", bonus: 3 }] }));

  const spineIds = [VAULT];
  // ⚑ THE SHAPE THIS RETURNS IS "action:channel", NOT the bare verb, and the
  // flip runner is why. Comparing bare names could not see a strike that
  // CHANGED CHANNELS — and the channel is the whole mechanism the founder's
  // report would have had if the office were the answer: a strike reaching a
  // human through the HELD weapon instead of the ground vanishes the instant
  // the fall drops it. Two flips broke exactly that and both stayed green
  // against a name-only comparison.
  const setFor = (kind, holding) => {
    const amb = gatherActions(db, { spineIds, reachIds: [] });
    const ground = gatherGroundActions(db, { spineIds, reachIds: [] });
    const held = gatherHeldActions(db, holding);
    return resolveForActor([...held.entries, ...ground.entries, ...amb.entries], { kind, spineIds })
      .entries.map((e) => `${e.action}:${e.channel}${e.via_seat ? ":via_seat" : ""}`).sort();
  };

  // THE LIFECYCLE IS REAL: the fold is driven to a genuine down and a genuine
  // lift, and both states are asserted — otherwise "the set did not change"
  // would be true of a fight that never happened.
  let seq = 0;
  const t0 = Date.parse("2026-08-29T19:00:00Z");
  const row = (actor, action, n, extra = {}) => ({ seq: ++seq, actor, action, written_at: new Date(t0 + n * 1000).toISOString(), ...extra });
  const boss = (action, n, object) => row(CAKE, action, n, { object, payload: { kind: HOSTILE } });
  const D = { strike: { to_hit_die: 20, damage_die: 6, beats_ac: 1 }, cast: { to_hit_die: 20, damage_die: 10, beats_ac: 11 },
              guard: { halves_next_hit: true }, lift: { restores_to: 8 },
              adversary: { hp: 400, to_hit_die: 20, damage_die: 20, initiative_bonus: 2, persistent: false },
              arena: { guest_hp: 12, initiative_die: 20, turn_timeout_s: 600, lift_to: 8 } };
  const HUMAN = "human-of-starforge";
  const acc = [row(HUMAN, "join", 0), row("wright", "join", 1), boss("join", 2)];

  // ⚑ AN ABSOLUTE SET, NOT ONLY A STABLE ONE. Invariance alone is satisfied by
  // a bug that breaks all three stages equally — a flip that unseated the human
  // outright left walk/say/enter/exit missing at every stage and the deepEqual
  // below passed happily. So what the set IS gets pinned here, once, and the
  // stages are compared against it.
  const before = setFor("human", [LIGHTER]);
  assert.deepEqual(before, [
    "cast:ground", "enter:ambient:via_seat", "exit:ambient:via_seat", "guard:ground",
    "lift:ground", "loot:ground", "say:ambient:via_seat", "strike:ground", "walk:ambient:via_seat",
  ], `a seated human's verb set is not what the record grants (got: ${before.join(", ")}) — the five arena verbs from the GROUND, the resident's four through the seat`);
  assert.ok(before.includes("strike:ground"),
    "strike must reach a human from the GROUND — a strike that arrives through the held weapon is a strike the fall takes away, which is the founder's report exactly");

  let s = foldEncounter(acc, { dials: D }), n = 10;
  while (!s.downed.includes(HUMAN) && n < 120) {
    const t = s.wheel.turn;
    if (!t) break;
    acc.push(t === CAKE ? boss("strike", n, HUMAN) : row(t, "guard", n));
    n += 1; s = foldEncounter(acc, { dials: D });
  }
  assert.ok(s.downed.includes(HUMAN), "the setup never put the human down — this test would prove nothing");
  const whileDown = setFor("human", [LIGHTER]);

  acc.push(row("wright", "lift", n, { object: HUMAN }));
  s = foldEncounter(acc, { dials: D });
  assert.ok(!s.downed.includes(HUMAN), "the setup never lifted them back up — the second half is the founder's own case");
  const afterLift = setFor("human", [LIGHTER]);

  // THE PROPERTY, all three stages, the WHOLE set — not only strike, because the
  // founder hit this path live and any other post-lift loss bites at the party.
  assert.deepEqual(whileDown, before,
    `the verb set moved while the human was DOWN (${before.join(", ")} -> ${whileDown.join(", ")}) — the affordance calculus must not read the encounter`);
  assert.deepEqual(afterLift, before,
    `the verb set moved after the LIFT (${before.join(", ")} -> ${afterLift.join(", ")}) — this is the founder's bug, and it is now in the office`);
  assert.ok(afterLift.includes("strike:ground"),
    "STRIKE is gone after a lift (or arrives by another channel) — the founder's exact report, reproduced in the office");

  // AND EMPTY-HANDED TOO: the weapon drops when you go down, so a set that
  // depended on holding it would lose strike at exactly this moment. Strike
  // reaches a human through the GROUND, and the ground does not care what
  // fell out of their hands.
  assert.deepEqual(setFor("human", []), before,
    "the verb set depends on what the human is HOLDING — going down drops the weapon, so that dependency is the bug wearing a different cause");
});
