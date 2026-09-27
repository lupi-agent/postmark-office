// arena.mjs — THE DOOR the fold has been waiting for.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// `src/encounter.mjs` landed 2026-08-26 complete and proven: the wheel, the
// witnessed roll, the fold, the NPC driver, 22 falsifiers, 44/44 flips red. It
// was imported by NOTHING in `src/`. Only its own test file ever called it.
//
// That is the whole gap this module closes, and it is a class of gap worth
// naming rather than quietly filling: A FUNCTION EXISTING IS NOT A FUNCTION
// RUNNING. The five arena verbs were granted by class marks on the record, so
// `gatherActions` afforded them and the read showed them — and then `apexDo`
// reached `DISPATCH[action]`, found nothing, and answered 501 by name. Law with
// no door behind it. Lint L6 exists to catch exactly this, and it was catching
// it: the 501's own hint says "the machinery is not written yet."
//
// This is the machinery. It is the CALLER: it folds a ground's rows, refuses on
// the wheel by name, appends the act, and drives the creature turns — the four
// jobs the fold's own header named as "the next piece."
//
// ── THE LAW THIS IMPLEMENTS ─────────────────────────────────────────────────
//
// LOGOS/classes.md § The arena, verbatim:
//
//   "The wheel gates every act, and movement with them. While an encounter is
//    live, an arena affords its verbs — and walking — only to whoever the wheel
//    is on. Hostiles hold real slots and take real turns. An act out of turn is
//    refused NAMING WHOSE TURN IT IS, because 'no' without a name is a door
//    that will be tried again immediately."
//
//   "Hostile turns are resolved by the act that ends a player's turn, in the
//    same handling, until the wheel reaches a player again. There is no daemon
//    and no ticker: the duet is the event loop."
//
//   "An absent hand cannot freeze the room. `turn_timeout` is a dial on the
//    arena; once it has expired, that hand's turn resolves as a pass at the
//    next door touch — by anyone."
//
// § Downed, not dead: "At zero you are DOWN, and down is not gone."
// `the-town/crossing-is-joining`: crossing in is joining the fight.
//
// ── THE THREE DESIGN CALLS I MADE, FLAGGED RATHER THAN BURIED ───────────────
//
// (1) ONE ARENA IS ONE WHEEL. The founder asked for an encounter "multiple
//     concurrent parties can play." Read against § The arena's own threshold
//     terms — "if one is already under way you join at the bottom of the order
//     at the next round" — concurrency means EVERYONE IN THE ROOM IS IN THE
//     SAME FIGHT, not that the room forks a private copy per party. Per-party
//     instancing would need a law that says how a room has two states at once,
//     and no such law is written. The open door and the shared wheel are the
//     same clause read twice.
//
// (2) NO ADVERSARY ON THE GROUND MEANS THE FIGHT VERBS REFUSE, BY NAME. The
//     antechamber (`the-cellar-door`) is a portal-ground, so its class affords
//     strike/cast/guard exactly as the arena does — and it contains nothing to
//     hit. Left alone, `foldEncounter` would stand on its `adversary.hp` FLOOR
//     and invent a sixty-point phantom out of a missing dial. So the door asks
//     the record for an adversary standing inside the ground first, and refuses
//     when there is none. A fight against a thing the record does not contain
//     is precisely the private grammar atom 1 refuses.
//
// (3) THE WEAPON IS STAMPED INTO THE ACT, NOT LOOKED UP AT READ TIME. The fold
//     asks `weaponOf(actor, seq)` — "what were they holding AT THAT ROW". The
//     hold table answers only what they are holding NOW, and a fold that reads
//     a live table is a fold whose past changes when someone drops something.
//     That is the roll's own problem and it takes the roll's own answer: the
//     door stamps `payload.with` at write time and the fold reads it back off
//     the row. Witnessed, never recomputed. ⚑ The one case still resolved live
//     is the DROP on going down — a hostile's row cannot carry its victim's
//     inventory — and it is named in `weaponReader` rather than left to be
//     found.
//
// PURE-ADJACENT: this module owns the door's sequencing and the record's
// queries. It holds no law the fold holds and no arithmetic at all.

import { createHash } from "node:crypto";
import { foldEncounter, pendingHostileTurns, hostileAct, timedOut, TURN_ENDING, WHEEL_GATED } from "./encounter.mjs";
import { appendArenaRow, readJournal, CLASS_ARENA_ACT } from "./world-journal.mjs";
import { openDynamic, openDynamicReadOnly, singleLogEnabled } from "./dynamic-store.mjs";
import { readAttachments } from "./dynamic-entities.mjs";
import { holdingsOf } from "./world-hold.mjs";
import { worldFreezeBounce } from "./freeze.mjs";
import { heldEntries } from "./world-grants.mjs";

/** The journal class an arena act rides. NOT a town class — `appendJournal`'s
 *  tripwire refuses those, and an arena act is world-side by construction. */
// The row class, declared in `world-journal.mjs` beside the one sqlite INSERT
// G1 left standing (`appendArenaRow` refuses every other class by name) and
// re-exported here, where the arena's own readers look for it.
export { CLASS_ARENA_ACT };

/** The five verbs a portal ground lends. The order is the class marks' own. */
export const ARENA_VERBS = Object.freeze(["strike", "cast", "guard", "lift", "loot"]);

/** The two classes that keep a wheel-bearing ground, innermost first. An arena
 *  IS a portal-ground (`extends: portal-ground`), so the arena wins a tie. */
export const GROUND_CLASSES = Object.freeze(["arena", "portal-ground"]);

const bounce = (code, defect, hint, extra = {}) => {
  const e = new Error(defect);
  Object.assign(e, { code, defect, hint, ...extra });
  return e;
};

const parseJson = (s, fallback = null) => {
  if (s == null) return fallback;
  if (typeof s === "object") return s;
  try { return JSON.parse(s); } catch { return fallback; }
};

// ── the record's questions ──────────────────────────────────────────────────

const GROUND_ROWS = `SELECT id, by,
         json_extract(props, '$.class')  AS class,
         json_extract(props, '$.dials')  AS dials,
         json_extract(props, '$.body')   AS body,
         at_x, at_y, extent_w, extent_h
       FROM nodes WHERE id IN (SELECT value FROM json_each(?))`;

// ⚑ `subkind = 'class'` IS A COLUMN, AND ASKING props FOR IT FINDS NOTHING —
// silently. The first version of this query tested `json_extract(props,
// '$.kind') = 'class'`, which is how a mark FILE spells it and is not how the
// hydrator STORES it: `kind` becomes the column `mark` and the file's `kind:
// class` lands in the column `subkind`. So the query matched zero rows against
// the real store, every verb dial came back missing, and `dial()` fell back to
// its FLOOR — whose numbers happen to equal the record's, so the fight played
// correctly while reading none of the law. The only tell was `dials_missing` in
// an answer nobody was looking at.
//
// It passed its own test because THE FIXTURE WROTE THE SHAPE THE QUERY EXPECTED.
// A fixture that agrees with the code proves only that they agree.
const CLASS_DIALS = `SELECT id,
         json_extract(props, '$.class') AS class,
         json_extract(props, '$.dials') AS dials
       FROM nodes WHERE json_extract(props, '$.class') IN (SELECT value FROM json_each(?))
         AND subkind = 'class'`;

// An adversary is a SITED INSTANCE standing inside the ground, never a class
// declaration. `by` is not constrained here: whose adversary it is, is the
// record's business and the fold reads its dials either way.
const ADVERSARY_IN = `SELECT id, by,
         json_extract(props, '$.class') AS class,
         json_extract(props, '$.dials') AS dials,
         json_extract(props, '$.body')  AS body,
         at_x, at_y, extent_w, extent_h
       FROM nodes
       WHERE json_extract(props, '$.class') = 'adversary'
         AND at_x IS NOT NULL AND at_y IS NOT NULL`;

// `subkind` and `tier` ride along for the INJECTION (2026-08-29): a floor thing
// that never made the eyes' salience cut has to be handed to `nearby` as an
// entry of the same shape everything else there has, and those are two of the
// fields that shape carries. Reading them here rather than in a second query is
// the same rule the rest of this file keeps — one question of the record per
// answer.
const LOOSE_IN = `SELECT id, by, subkind, tier,
         json_extract(props, '$.class')       AS class,
         json_extract(props, '$.loot')        AS loot,
         json_extract(props, '$.held_grant')  AS held_grant,
         json_extract(props, '$.body')        AS body,
         at_x, at_y, extent_w, extent_h
       FROM nodes
       WHERE json_extract(props, '$.class') = 'thing'
         AND at_x IS NOT NULL AND at_y IS NOT NULL`;

const within = (row, g) => {
  const x = Number(row?.at_x), y = Number(row?.at_y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !g) return false;
  const gx = Number(g.at_x), gy = Number(g.at_y);
  const gw = Number(g.extent_w), gh = Number(g.extent_h);
  if (![gx, gy, gw, gh].every(Number.isFinite)) return false;
  return x >= gx - gw / 2 && x <= gx + gw / 2 && y >= gy - gh / 2 && y <= gy + gh / 2;
};

/**
 * The wheel-bearing ground the caller is standing in, innermost first.
 *
 * `spineIds` is the containment chain the apex already computed — this asks no
 * geometry of its own beyond "is that adversary inside this fence", because a
 * second containment answer beside the engine's is the drift this office keeps
 * nailing shut.
 *
 * Returns the ARENA when one is on the spine and the portal-ground otherwise,
 * so a caller in the candle-vault (which nests inside the cellar-door) gets the
 * vault and a caller in the antechamber gets the antechamber. `space` is the
 * word the site's cockpit reads to tell the two rooms apart.
 */
export function arenaGroundAt(db, spineIds = []) {
  if (!db || !spineIds.length) return null;
  let rows = [];
  try { rows = db.prepare(GROUND_ROWS).all(JSON.stringify([...new Set(spineIds.filter(Boolean))])); }
  catch { return null; }
  const byClass = new Map(rows.map((r) => [String(r.class ?? ""), r]));
  for (const cls of GROUND_CLASSES) {
    const row = byClass.get(cls);
    if (!row) continue;
    const place = {
      ground: row.id,
      row,
      class: cls,
      // THE SITE'S OWN WORD, and it is the ruling's word too: "an antechamber
      // (gather, read the rules of the place, form up) and the arena proper".
      space: cls === "arena" ? "arena" : "antechamber",
      keeps_wheel: cls === "arena",
      body: String(row.body ?? ""),
    };
    // The ground's own stride rides the place from the moment the place exists,
    // so every reader of a place — the door, the standpoint, the walk desk —
    // reads one answer. Computing it a second time somewhere else is how two
    // grids end up drawn over one floor.
    place.walk_min_step = walkMinStepOf(db, place);
    return place;
  }
  return null;
}

/**
 * The adversary standing inside this ground, or null. See design call (2).
 *
 * ⚑ TAKES THE PLACE, NOT ITS ROW, AND THE DIFFERENCE IS THE TWO-SPACES RULING.
 * The arena NESTS INSIDE the antechamber — that is how a caller in the vault
 * gets `strike` at all, since strike is fenced to `portal-ground` and the vault
 * supplies `arena`. But nesting means the adversary is geometrically inside
 * BOTH rooms, so a containment-only answer hands the antechamber the same cake
 * the arena has, and a guest could fight the thing from the waiting room
 * without ever going in. The founder's two spaces would be one space with a
 * decorative wall.
 *
 * A FIGHT LIVES IN AN ARENA. `keeps_wheel` is the whole distinction between the
 * two rooms and it is the right question here: a ground with no wheel has no
 * encounter, so it has no adversary, whatever is standing in its footprint.
 */
export function adversaryIn(db, place) {
  if (!db || !place) return null;
  // Tolerate a bare row for the geometry-only callers, but a row cannot keep a
  // wheel, so an explicit place is what unlocks a fight.
  const row = place.row ?? place;
  if (place.row && !place.keeps_wheel) return null;
  let rows = [];
  try { rows = db.prepare(ADVERSARY_IN).all(); } catch { return null; }
  return rows.find((r) => within(r, row)) ?? null;
}

/** Is this row's `loot` column the record's yes? The column arrives as 1, true
 *  or "true" depending on how the mark spelled it and what the hydrator did
 *  with it, and all three mean the same thing. */
const isLoot = (r) => r?.loot === 1 || r?.loot === true || r?.loot === "true";

/**
 * The loose things lying on this ground — what a `take` could pick up, and what
 * the site draws where it fell. `loot: true` marks the ones the loot verb
 * opens; a weapon is loose without being loot.
 *
 * ⚑ LOOT IS NOT IN THE ROOM UNTIL THE ROOM IS SPENT (founder-ruled 2026-08-29).
 * LOGOS § The portal ground: "A thing whose mark declares `loot` is NEITHER
 * VISIBLE NOR TAKEABLE while the encounter on its ground is afoot: it is absent
 * from that ground's loose things, absent from what a standpoint says stands
 * nearby, and a `take` or a `give` aimed at it is refused with a sentence that
 * explains itself rather than a bounce that reads like a fault. At `spent` it
 * appears, and from that moment it is an ordinary thing under the ordinary law
 * above."
 *
 * THE PHASE IS PASSED IN, NEVER READ HERE, for the same reason `weaponOf` is
 * injected: this function knows the record's geometry and nothing about a
 * fight. A caller who does not know the phase is told nothing about the loot,
 * which is the safe direction — the shroud's whole job is to not leak the prize
 * — and `{ all: true }` is the deliberate way past it, for the tools that must
 * see the room whole (the reset in `tools/arena-play.mjs` is the only one).
 */
export function looseIn(db, groundRow, { phase = null, all = false } = {}) {
  if (!db || !groundRow) return [];
  let rows = [];
  try { rows = db.prepare(LOOSE_IN).all(); } catch { return []; }
  const open = all || phase === "spent";
  return rows.filter((r) => within(r, groundRow) && (open || !isLoot(r))).map((r) => ({
    thing: r.id,
    by: r.by,
    loot: isLoot(r),
    grants: heldEntries({ ...r, held_grant: parseJson(r.held_grant, null) }, { parse: (v) => v })
      .map((e) => ({ action: e.action, bonus: e.bonus ?? null, says: e.says ?? null })),
    at: { x: Number(r.at_x), y: Number(r.at_y) },
    body: String(r.body ?? ""),
    // The record's own words for what this thing IS, carried so a caller that
    // must hand it to `nearby` does not have to ask the store a second time.
    // `kind` is the mark's subkind ("sited") — the same word `nearby` carries —
    // and NOT `class` ("thing"), which is a different question with a similar
    // answer shape. Getting those two crossed puts the word "thing" where every
    // other entry says "sited".
    kind: r.subkind ?? null,
    tier: r.tier ?? null,
    extent: Number.isFinite(Number(r.extent_w)) && Number.isFinite(Number(r.extent_h))
      ? { w: Number(r.extent_w), h: Number(r.extent_h) } : null,
  }));
}

// Every wheel-bearing ground on the record, for the readers that arrive holding
// a THING and have to find the room it is standing in — the reverse of
// `arenaGroundAt`, which arrives holding a containment spine. It asks the same
// two columns the spine query asks and answers with the same rows, so a ground
// found this way and a ground found that way are one ground.
const GROUNDS_ALL = `SELECT id, by,
         json_extract(props, '$.class')  AS class,
         json_extract(props, '$.dials')  AS dials,
         json_extract(props, '$.body')   AS body,
         at_x, at_y, extent_w, extent_h
       FROM nodes
       WHERE json_extract(props, '$.class') IN ('arena', 'portal-ground')
         AND at_x IS NOT NULL AND at_y IS NOT NULL`;

const placeOf = (row) => ({
  ground: row.id, row, class: String(row.class),
  space: String(row.class) === "arena" ? "arena" : "antechamber",
  keeps_wheel: String(row.class) === "arena",
  body: String(row.body ?? ""),
});

/**
 * The wheel-bearing ground a POINT falls in, innermost first — `arenaGroundAt`
 * for a caller holding a coordinate instead of a containment spine.
 *
 * The walk desk needs this and the standpoint does not: a click on a floor is a
 * pair of numbers, and the ground whose stride governs that step is the ground
 * the numbers land in. `GROUND_CLASSES` order is kept, so a point inside both
 * the vault and the antechamber that contains it resolves to the vault, exactly
 * as a spine would.
 */
export function groundAtPoint(db, point) {
  if (!db || !point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
  let rows = [];
  try { rows = db.prepare(GROUNDS_ALL).all(); } catch { return null; }
  const p = { at_x: Number(point.x), at_y: Number(point.y) };
  for (const cls of GROUND_CLASSES) {
    const row = rows.find((r) => String(r.class) === cls && within(p, r));
    if (!row) continue;
    const place = placeOf(row);
    place.walk_min_step = walkMinStepOf(db, place);
    return place;
  }
  return null;
}

/**
 * The loot this ground is still holding back — the ids no reader may be shown.
 *
 * LOGOS § The portal ground: a loot thing "is absent from that ground's loose
 * things, absent from what a standpoint says stands nearby". `looseIn` honours
 * the first half by simply not returning them; the standpoint's `nearby` is
 * assembled by the world read long before this module sees it, so the second
 * half needs the LIST — what to subtract — rather than a filtered answer.
 */
export function lootShroudedIn(db, groundRow, phase = null) {
  if (!db || !groundRow || phase === "spent") return [];
  try {
    return db.prepare(LOOSE_IN).all()
      .filter((r) => within(r, groundRow) && isLoot(r))
      .map((r) => String(r.id));
  } catch { return []; }
}

/**
 * Why this thing may not be handled yet, or null — the take/give half of the
 * shroud, asked by a door that holds a thing id and nothing else.
 *
 * Arrives at the ground from the THING's position rather than from a caller's
 * spine, because a `give` is refused for what the OBJECT is, not for where the
 * actor happens to be standing: handing the wick end to somebody from the
 * antechamber is the same act as pocketing it from inside the vault.
 *
 * Only an ARENA shrouds. A portal ground with no wheel keeps no encounter, so
 * it has no phase to be afoot in, and a loot-flagged thing lying in one is an
 * ordinary thing — the same reasoning `adversaryIn` stands on.
 */
export function lootHiddenReason(db, dyn, thingId) {
  if (!db || !dyn || !thingId) return null;
  let thing = null;
  try { thing = db.prepare(LOOSE_IN).all().find((r) => String(r.id) === String(thingId)) ?? null; }
  catch { return null; }
  if (!thing || !isLoot(thing)) return null;
  let grounds = [];
  try { grounds = db.prepare(GROUNDS_ALL).all(); } catch { return null; }
  for (const row of grounds) {
    if (String(row.class) !== "arena" || !within(thing, row)) continue;
    const place = placeOf(row);
    let state = null;
    try { state = encounterOn(db, dyn, place); } catch { state = null; }
    if (state?.phase === "spent") continue;
    return { ground: place.ground, phase: state?.phase ?? "afoot",
             adversary: state?.adversary?.id ?? null,
             standing: state?.adversary ? `${state.adversary.hp} of ${state.adversary.of}` : null };
  }
  return null;
}

/**
 * THE GROUND'S OWN STRIDE, in metres — `walk_min_step`, or null where the
 * ground has not declared one.
 *
 * LOGOS § The portal ground (founder-asked 2026-08-29): "`walk_min_step` is a
 * dial on the ground's own mark, in metres: within that ground a walk is
 * validated and snapped at that granularity instead of the town's whole-metre
 * step. Absent — which is every ground in the town on the day this is written —
 * the town-wide step governs and nothing anywhere changes."
 *
 * NULL, NOT 1, IS THE ANSWER FOR AN UNDECLARED GROUND, and the difference is
 * the whole safety of this change. A floor of 1 here would make every ground in
 * the town start snapping walks to whole metres — which is not what the town
 * does today, so "the default is 1" would have been a town-wide re-cut of the
 * walk wearing a per-ground dial's clothes. Null means "this ground says
 * nothing", and the walk desk then does exactly what it did yesterday.
 *
 * The instance outranks its class, the same order `dialsFromRecord` keeps: a
 * room may be finer than the class of rooms it belongs to.
 */
export function walkMinStepOf(db, place) {
  if (!place) return null;
  const read = (d) => {
    const v = parseJson(d, null)?.walk_min_step;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const own = read(place.row?.dials ?? place.dials);
  if (own != null) return own;
  if (!db) return null;
  try {
    const cls = place.class ?? place.row?.class;
    const row = db.prepare(CLASS_DIALS).all(JSON.stringify([String(cls ?? "")]))[0];
    return row ? read(row.dials) : null;
  } catch { return null; }
}

// ── the placement ───────────────────────────────────────────────────────────

const rectOf = (r) => {
  const x = Number(r?.at_x), y = Number(r?.at_y);
  const w = Math.abs(Number(r?.extent_w)), h = Math.abs(Number(r?.extent_h));
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h, x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
};
const inRect = (p, r) => !!r && p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

/**
 * A metre snapped to a lattice of `step`, with the float dust taken off.
 *
 * `Math.round(1097.3 / 0.1) * 0.1` is 1097.3000000000002, and a coordinate that
 * differs from itself in the twelfth decimal is a coordinate that will one day
 * fail an equality nobody expected to be fragile. Six places is well past any
 * step a floor will ever declare and well short of where doubles get vague.
 */
export const snapTo = (v, step) => {
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(Number(v))) return Number(v);
  return Number((Math.round(Number(v) / s) * s).toFixed(6));
};

/**
 * WHERE A CROSSING SETS YOU DOWN — the door-side edge, clear of the adversary.
 *
 * LOGOS § The arena (founder-ruled 2026-08-29): "An entrant into a wheel-keeping
 * ground is placed where the ground was entered from — the point on its boundary
 * the crossing came through — and never within an adversary's own extent. Where
 * that edge point falls inside one, the placement steps back OUT along the way
 * in until it is clear, by arithmetic every reader repeats identically."
 *
 * ⚑ THE ARRIVAL MATH IS INJECTED, NEVER RE-IMPLEMENTED. `entryT` is the world
 * clone's own `targetEntryT` — the same function the walk derivation and the
 * viewer's drawn leg both stop at. An office copy of the slab test would be a
 * SECOND arrival truth, and the world repo's own note on that function says why
 * it is exported at all: "the dotted line and the derivation stop at the same
 * point — one arrival truth, never a second." With no `entryT` in hand this
 * answers null and the caller keeps doing exactly what it did before.
 *
 * The walk back is in whole `step`s along the way in, and every point it
 * considers is snapped first, so the answer is a lattice point either way and
 * two readers cannot land a hair apart. `from` is outside the ground, hence
 * outside the adversary (an adversary stands INSIDE its arena), so the loop has
 * an end even in the degenerate room where the cake is wedged against the door.
 */
export function entryPointInto(from, groundRow, adversaryRow = null, { entryT, step = 0.1 } = {}) {
  if (typeof entryT !== "function" || !from) return null;
  const g = rectOf(groundRow);
  if (!g) return null;
  // ⚑ A WALKER ALREADY INSIDE IS NOT CROSSING IN, and this guard is the whole
  // difference between placement law and a room nobody can move in. The clause
  // is about ENTRY — "an entrant into a wheel-keeping ground" — and `entryT`
  // returns 0 for a start point already within the rect, so without this line a
  // hand crossing the vault floor would be placed back exactly where they were
  // standing, every time, and the room would look frozen while every test
  // passed. The founder asked for FINER movement inside the room; pinning it
  // would have been the opposite of the same night's other ruling.
  if (inRect({ x: Number(from.x), y: Number(from.y) }, g)) return null;
  const s = Number.isFinite(Number(step)) && Number(step) > 0 ? Number(step) : 0.1;
  const centre = { x: g.x, y: g.y };
  const legM = Math.hypot(centre.x - Number(from.x), centre.y - Number(from.y));
  if (!Number.isFinite(legM) || legM === 0) return null;
  const t = entryT({ x: Number(from.x), y: Number(from.y) }, centre, { x: g.x, y: g.y, w: g.w, h: g.h });
  const snapPt = (p) => ({ x: snapTo(p.x, s), y: snapTo(p.y, s) });
  const dir = { x: (centre.x - Number(from.x)) / legM, y: (centre.y - Number(from.y)) / legM };
  let p = snapPt({ x: Number(from.x) + (centre.x - Number(from.x)) * t,
                   y: Number(from.y) + (centre.y - Number(from.y)) * t });
  const a = rectOf(adversaryRow);
  let guard = 0;
  const cap = Math.ceil(legM / s) + 4;
  while (a && inRect(p, a) && guard++ < cap) p = snapPt({ x: p.x - dir.x * s, y: p.y - dir.y * s });
  return { x: p.x, y: p.y, backed_off: guard > 0, step: s };
}

/**
 * WHAT A GROUND DOES TO A WALK THAT ENDS ON IT — both of tonight's rulings, as
 * one pure decision over facts the caller has already read.
 *
 * Returns `null` when the ground has nothing to say, so a caller can write
 * `Object.assign(walk, arrivalOnGround(...) ?? {})` and a town with no portal
 * grounds in it behaves exactly as it did yesterday.
 *
 * ⚑ THIS IS A FUNCTION BECAUSE THE WALK DESK HAS NO TEST HARNESS. `walkViaOffice`
 * needs a world clone, a world store, a dynamic store and a resident before it
 * will run a line, which is why nothing in `test/` drives it — so twenty lines
 * of composition living inside it would be twenty lines no falsifier could ever
 * turn red. Pulled out here, the decision is a pure function of four numbers and
 * two rows, and the flip runner can break it. The desk keeps the pen; this keeps
 * the law.
 *
 * THE ORDER IS THE FOUNDER'S OWN: the room's stride first, because the placement
 * is snapped to it.
 */
export function arrivalOnGround({ from, toward, targetFrom = "" }, place, adversaryRow = null, { entryT } = {}) {
  if (!place || !from || !toward) return null;
  const step = Number.isFinite(place.walk_min_step) && place.walk_min_step > 0 ? place.walk_min_step : null;
  let out = null;

  // ── the stride ────────────────────────────────────────────────────────────
  // LOGOS § The portal ground: "within that ground a walk is validated and
  // snapped at that granularity instead of the town's whole-metre step."
  //
  // The DESTINATION is what a resident chose and what a page clicked, so the
  // destination is what the room's stride governs. Snapping the derived
  // position instead would leave the record and the answer disagreeing about
  // where somebody asked to go.
  if (step) {
    const snapped = { x: snapTo(toward.x, step), y: snapTo(toward.y, step) };
    if (snapped.x !== toward.x || snapped.y !== toward.y)
      out = { toward: snapped, targetFrom: `${targetFrom} — snapped to ${place.ground}'s own ${step} m step`, snapped: true };
  }

  // ── the placement ─────────────────────────────────────────────────────────
  // LOGOS § The arena: "An entrant into a wheel-keeping ground is placed where
  // the ground was entered from … and never within an adversary's own extent."
  //
  // POINT ARRIVAL, DELIBERATELY. The rim arrival a frozen extent performs is
  // "the first point on the ground", which is the same point this computes —
  // until an adversary is standing on it, and then they differ and the extent
  // has no way to say so. So the placement becomes the destination itself and
  // the rect comes off: a named point is MORE frozen than a rect, not less (a
  // later resize of the room cannot rewrite an arrival that is a coordinate),
  // and the target's id still rides the ledger line, so the record says where
  // the walker was headed either way.
  if (!place.keeps_wheel) return out;
  const entry = entryPointInto(from, place.row, adversaryRow, { entryT, step: step ?? 0.1 });
  if (!entry) return out;
  return {
    ...(out ?? {}),
    toward: { x: entry.x, y: entry.y },
    targetExtent: null,
    placed: true,
    backed_off: entry.backed_off === true,
    targetFrom: entry.backed_off
      ? `${place.ground} — its door-side edge, stepped clear of ${adversaryRow?.id ?? "what stands in it"}`
      : `${place.ground} — its door-side edge`,
  };
}

/**
 * WHERE A GROUND SETS AN ENTRANT DOWN — `spawn`, the ground's own dial.
 *
 * ⚑ WHY THIS EXISTS, and it is a cure rather than a decoration. The wheel seats
 * you off the GEOMETRIC containment spine (`containmentChain` in the world
 * clone: marks whose footprint contains your point). Entry writes an OCCUPANCY
 * edge and moves nothing. So a resident who enters a mark while their body
 * stands outside its fence is INSIDE BY THE RECORD AND OUTSIDE BY GEOMETRY —
 * the enter is adjudicated, and `joinOnCrossing` then asks the spine, finds no
 * arena, and returns null. No join, no initiative, no refusal. Reproduced live
 * 2026-08-29: a hand entered the candle-vault from 16 m away, was told they had
 * entered, and never appeared on the wheel. The cure they found was exit and
 * re-enter while standing inside, which no guest would ever discover.
 *
 * Placing the entrant makes the two answers agree, which is the honest fix
 * available before the freeze. The disagreement itself — two derivations of
 * "where are you" with only one of them consulted — is written up for Wright.
 *
 * THE DIAL IS THE GROUND'S, NEVER A ROOM'S NAME IN THE OFFICE: `walk_min_step`'s
 * precedent exactly. Absent, every ground behaves as it does today.
 *
 * ⚑ AND A SPAWN OUTSIDE ITS OWN GROUND IS REFUSED, not honoured. A mis-measured
 * point would teleport every entrant OUT of the room they just walked into, and
 * the failure would look exactly like the bug this fixes. So the point is
 * checked against the ground's own rect and a bad one is disclosed and ignored,
 * leaving today's behaviour. (The founder's own first estimate for the vault
 * was outside it, which is how this guard came to be written.)
 */
export function spawnPointFor(db, place, { who = "", crossing = null } = {}) {
  if (!place?.row) return null;
  const read = (d) => {
    const s = parseJson(d, null)?.spawn;
    const x = Number(s?.x), y = Number(s?.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  };
  let spawn = read(place.row.dials ?? place.dials);
  if (!spawn && db) {
    try {
      const row = db.prepare(CLASS_DIALS).all(JSON.stringify([String(place.class ?? place.row.class ?? "")]))[0];
      spawn = row ? read(row.dials) : null;
    } catch { spawn = null; }
  }
  if (!spawn) return null;

  const g = rectOf(place.row);
  if (!g) return null;
  if (!inRect(spawn, g))
    return { refused: `${place.ground} declares a spawn at ${spawn.x},${spawn.y}, which is outside its own extent — ignored`, at: null };

  // THE JITTER IS WITNESSED, NOT RANDOM, for the reason every roll in this
  // module is: `crypto.randomUUID` consults a source nobody can reproduce, and a
  // placement that differs on replay is a placement the record cannot defend.
  // Derived from the ground, the hand and the crossing, so two entrants land
  // apart and the same entrant lands consistently within one crossing.
  const step = Number.isFinite(place.walk_min_step) && place.walk_min_step > 0 ? place.walk_min_step : 0.1;
  const reach = (() => {
    const declared = Number(parseJson(place.row.dials ?? place.dials, null)?.spawn_jitter_m);
    return Number.isFinite(declared) && declared >= 0 ? declared : step;
  })();
  if (reach === 0) return { at: { x: snapTo(spawn.x, step), y: snapTo(spawn.y, step) }, jitter: 0 };

  const h = createHash("sha256").update(`${place.ground}|${who}|${crossing ?? ""}`).digest();
  // Two independent bytes → two axes; centred so the offset is as often
  // negative as positive, and scaled to `reach`.
  const off = (i) => ((h[i] / 255) * 2 - 1) * reach;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  return {
    at: {
      x: snapTo(clamp(spawn.x + off(0), g.x0, g.x1), step),
      y: snapTo(clamp(spawn.y + off(1), g.y0, g.y1), step),
    },
    jitter: reach,
    from: spawn,
  };
}

/**
 * The dials the fold reads, assembled from the record and from nowhere else.
 *
 * Each group comes off the mark that OWNS that number — the verb classes for
 * the verbs, the adversary INSTANCE for the adversary (two adversaries differ
 * by what the record says about each), the ground instance for the arena, with
 * the arena CLASS beneath it as the default. The fold's own FLOOR is the last
 * resort and it discloses every dial it had to stand on.
 */
export function dialsFromRecord(db, { groundRow = null, adversaryRow = null } = {}) {
  const out = { strike: {}, cast: {}, guard: {}, lift: {}, adversary: {}, arena: {} };
  if (!db) return out;
  let classRows = [];
  try { classRows = db.prepare(CLASS_DIALS).all(JSON.stringify([...ARENA_VERBS, "arena", "portal-ground"])); }
  catch { classRows = []; }
  for (const r of classRows) {
    const d = parseJson(r.dials, null);
    if (!d || typeof d !== "object") continue;
    if (ARENA_VERBS.includes(String(r.class))) Object.assign(out[String(r.class)] ??= {}, d);
    if (String(r.class) === "arena") Object.assign(out.arena, d);
  }
  // The INSTANCE's dials outrank its class's — that is what `dials:` on a sited
  // mark is for, and it is how this room's cake differs from the next room's.
  Object.assign(out.arena, parseJson(groundRow?.dials, null) ?? {});
  Object.assign(out.adversary, parseJson(adversaryRow?.dials, null) ?? {});
  // `lift.restores_to` and `arena.lift_to` are the same number wearing two
  // names — the verb's own dial and the ground's override. The ground wins,
  // because a room may say how far its own kindness reaches.
  if (out.arena.lift_to != null) out.lift.restores_to = out.arena.lift_to;
  return out;
}

// ── the rows ────────────────────────────────────────────────────────────────

/**
 * This ground's acts, in seq order, shaped for the fold.
 *
 * SCOPED BY `payload.ground` AND NOT BY ANYTHING ELSE. Two arenas in the town
 * share one journal and must not share one fight; the ground id on the row is
 * what separates them, and it is written by the door that appended it.
 */
export function arenaRows(db, ground) {
  if (!db || !ground) return [];
  const rows = readJournal(db, { cls: CLASS_ARENA_ACT }) ?? [];
  return rows
    .map((r) => ({ ...r, payload: parseJson(r.payload, {}) ?? {} }))
    .filter((r) => String(r.payload.ground ?? "") === String(ground))
    .sort((a, b) => Number(a.seq) - Number(b.seq))
    .map((r) => ({
      seq: Number(r.seq),
      actor: String(r.actor),
      action: String(r.action),
      object: r.object == null ? null : String(r.object),
      written_at: r.written_at,
      payload: r.payload,
    }));
}

/**
 * `weaponOf` for the fold — the stamped answer first, the live table second.
 *
 * A striker's own row carries `payload.with` (design call 3), so the bonus that
 * decided a past hit is read back exactly as it was applied. The fallback is
 * the live hold table and it exists for ONE case the stamp cannot cover: when a
 * hostile downs somebody, the fold asks what the VICTIM was holding so it can
 * drop it, and the hostile's row cannot carry another hand's inventory.
 *
 * ⚑ SO THE DROP IS NOT REPLAY-STABLE and this is where that is written down. A
 * replay months later drops whatever the victim holds THEN. Making it stable
 * needs holdings to be rows in this same log, which is a law about the hold
 * table and not a thing this door may decide. It is loud here rather than
 * silent in a diff.
 */
export function weaponReader(db, rows, { holdingsNow = () => [], thingRow = () => null } = {}) {
  const bySeq = new Map(rows.map((r) => [Number(r.seq), r]));
  return (actor, seq) => {
    const row = bySeq.get(Number(seq));
    if (row && String(row.actor) === String(actor) && row.payload?.with) return row.payload.with;
    for (const id of holdingsNow(actor)) {
      const t = thingRow(id);
      const grant = heldEntries(t, { parse: (v) => parseJson(v, null) }).find((e) => e.action === "strike");
      if (grant) return { thing: id, bonus: grant.bonus ?? 0, says: grant.says ?? null, augments: grant.action };
    }
    return null;
  };
}

/** The strike-granting thing in this hand's hands right now, or null. */
export function weaponInHand(db, handle) {
  if (!db || !handle) return null;
  let dyn = null;
  try {
    // Read-only: `weaponInHand` only asks what the record says is held.
    dyn = openDynamicReadOnly();
    const held = dyn ? holdingsOf(readAttachments(dyn), handle) : [];
    if (!held.length) return null;
    const rows = db.prepare(LOOSE_IN).all().filter((r) => held.includes(r.id));
    for (const r of rows) {
      const grant = heldEntries({ ...r, held_grant: parseJson(r.held_grant, null) }, { parse: (v) => v })
        .find((e) => e.action === "strike");
      // ⚑ `augments:` IS THE ACT THIS BONUS HELPS, AND IT IS NOT `for:`.
      //
      // The site lane asked for `for`, and `for` shipped for one commit before
      // Wright renamed it (2026-08-29). The reason is visible on this very line:
      // `heldEntries` sets `for: kindOf(a)` on the entry being read, and LOGOS
      // § The three channels says "`for:` is the actor kind (absent means
      // resident)". So the record's entry would have said `for: human` and the
      // answer derived from it `for: "strike"`, two paces apart and neither
      // wrong on its own.
      //
      // Taken as a RENAME rather than a lexicon entry by the register's own
      // rule: it "cures reader traps; it does not rename living vocabulary — a
      // rename is taken only when a word is young, cheap, and actively
      // harmful." One night old, one edit each side, and a homonym a reader
      // meets while holding the other sense. All three.
      if (grant) return { thing: r.id, bonus: Number(grant.bonus ?? 0), says: grant.says ?? null, augments: grant.action };
    }
    return null;
  } catch { return null; }
  finally { try { dyn?.close(); } catch { /* a reader that cannot close still read */ } }
}

// ── the fold, at a standpoint ───────────────────────────────────────────────

/**
 * The encounter on this ground, derived. READ-ONLY — nothing here writes.
 *
 * This is what both the standpoint and the gate ask, so that the phase a guard
 * is checked against and the phase a resident is shown are the same number.
 */
export function encounterOn(db, dyn, place) {
  if (!db || !dyn || !place) return null;
  const adversary = adversaryIn(db, place);
  const dials = dialsFromRecord(db, { groundRow: place.row, adversaryRow: adversary });
  const rows = arenaRows(dyn, place.ground);
  const thingRows = new Map();
  try { for (const r of db.prepare(LOOSE_IN).all()) thingRows.set(r.id, r); } catch { /* none readable */ }
  let attachments = [];
  try { attachments = readAttachments(dyn); } catch { attachments = []; }
  const weaponOf = weaponReader(db, rows, {
    holdingsNow: (who) => { try { return holdingsOf(attachments, who); } catch { return []; } },
    thingRow: (id) => { const r = thingRows.get(id); return r ? { ...r, held_grant: parseJson(r.held_grant, null) } : null; },
  });
  const state = foldEncounter(rows, { dials, weaponOf });
  return {
    ...state,
    ground: place.ground,
    space: place.space,
    keeps_wheel: place.keeps_wheel,
    adversary: adversary
      ? { id: adversary.id, hp: state.boss.hp, of: state.boss.of, body: String(adversary.body ?? "") }
      : null,
    // NO ADVERSARY IS A STATE, NOT AN ERROR — the antechamber is a real place
    // and this is what it honestly looks like from inside.
    ...(adversary ? {} : { no_adversary: `nothing stands in ${place.ground} to be fought — this is where you gather, read the terms, and go in when you are ready` }),
  };
}

// ── the write ───────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();

/** One arena act, appended with the ground on it so the fold can find it. */
function appendAct(dyn, { ground, actor, action, object = null, payload = {}, effect = null, household = null, crossing = null, at = null, witnesses = null, writtenAt = now() }) {
  return appendArenaRow(dyn, {
    crossing, actor, household, action, object,
    cls: CLASS_ARENA_ACT, at, witnesses,
    payload: { ...payload, ground },
    effect,
    writtenAt,
  });
}

/**
 * THE DOOR. One player act, with the wheel honoured and the creatures driven.
 *
 * The sequence is the law's own order and every step of it is a refusal the
 * resident can read:
 *
 *   0. the freeze, then the pen           — no pen, no act
 *   1. the ground                          — are you standing in one
 *   2. the adversary                       — is there anything here (call 2)
 *   3. the timeout                         — resolve an absent hand FIRST, so
 *                                            the wheel this act is judged
 *                                            against is the current one
 *   4. the open door                       — join if you have not
 *   5. the wheel's gate                    — refuse out of turn, BY NAME
 *   6. the act                             — append, with the weapon stamped
 *   7. the creatures                       — drive until a hand is up again
 *   8. the answer                          — the refolded state and the rolls
 */
export async function arenaActViaOffice(repo, args = {}, key = null, deps = {}) {
  { const fz = worldFreezeBounce(); if (fz) return fz; }
  const {
    db: borrowedDb = null, openStore, spineIds = [], handle: actingHandle = null,
    household = null, crossing = null, witnessStamp = null, nowMs = Date.now(),
  } = deps;

  const action = String(args.__action ?? args.action ?? "").trim();
  if (!ARENA_VERBS.includes(action))
    throw bounce(422, `"${action}" is not one of this ground's verbs`,
      `a portal ground lends: ${ARENA_VERBS.join(", ")}`);

  if (!singleLogEnabled())
    throw bounce(501, "this ground has no pen at this office",
      "an arena act is a row in the single log, and the log is switched off here — the operator runs it behind WORLD_SINGLE_LOG=1");

  // ── WHOSE HAND THIS ACT IS RECORDED UNDER ─────────────────────────────────
  //
  // `as_human` is the apex's word for "this act was taken by the household's
  // HUMAN, embodied by the ground that granted it" — and it arrives as the
  // human's own label (`human-of-<household>`), not a boolean, precisely so a
  // handler can record it. A flag would say a human acted and leave the door
  // with nothing to write down but the resident's name, which is the violation
  // wearing a disclosure.
  //
  // THE OWN HAND, honoured here rather than promised. The human class
  // `implements: ["the-town/the-own-hand"]`; LOGOS § The portal ground says why
  // this door in particular must: "The verbs carry `for: human` entries beside
  // the resident ones, so a guest's human plays inside the portal without any
  // claim outside it." A human who PLAYS and whose blows land under somebody
  // else's name is not playing, they are ghost-writing.
  //
  // AND THIS DOOR CAN, where the walk door cannot. An arena act needs no body
  // in the world: "its state is a fold, never a store" — the wheel, the hit
  // points and the turn are derived from this ground's own rows, and the ground
  // is wherever the caller already stands. So the hand is just a string in the
  // log, and the log ALREADY carries non-resident hands with real standing:
  // `openAgainst` writes the adversary's own mark id as an actor, and the
  // founder's ruling is that "hostiles hold real slots and take real turns."
  // A human on the wheel beside them is the same shape, not a new one.
  const who = String(args.as_human ?? actingHandle ?? args.handle ?? "").trim();
  if (!who) throw bounce(422, "which hand is acting?", "this key acts for no resident at this ground");

  // ⚑ CLOSE ONLY WHAT YOU OPENED. The first version took an `openStore`
  // factory and closed the handle in its `finally` — which is right when it
  // opened it and catastrophic when the caller handed one over: the caller's
  // store went dead under them at the end of the first act, and every read
  // after that returned null rather than throwing. Silent, and it looked like
  // an empty room. A BORROWED handle is used and left alone; only an owned one
  // is closed. The apex passes its own, which also spares a second store read
  // per act.
  const store = borrowedDb ? null : (typeof openStore === "function" ? openStore() : null);
  const db = borrowedDb ?? store?.db ?? null;
  if (!db) throw bounce(503, "the law that binds this act cannot be read",
    "the class layer lives in the world store and it could not be opened — no act dispatches without its terms");

  const dyn = openDynamic();
  try {
    // ── 1 · the ground ──────────────────────────────────────────────────────
    const place = arenaGroundAt(db, spineIds);
    if (!place)
      throw bounce(422, `"${action}" is only performed on a portal ground, and you are not standing on one`,
        "the verb is fenced to its ground by the residue class's own precondition — walk into the portal and it opens");

    // ── 2 · the adversary (design call 2) ───────────────────────────────────
    const adversary = adversaryIn(db, place);
    const needsFoe = action === "strike" || action === "cast";
    if (needsFoe && !adversary)
      throw bounce(422, `there is nothing in ${place.ground} to ${action}`,
        `${place.space === "antechamber"
          ? "this is the antechamber — you gather here, read the terms, and go in through the inner door when you are ready"
          : "this ground stands empty; nothing is standing in it to be fought"}. The verb is afforded because the ground's class lends it; what it would be aimed at is a question about the record, and the record says there is nobody here.`,
        { space: place.space, ground: place.ground });

    const refold = () => encounterOn(db, dyn, place);
    const stamp = witnessStamp ? await witnessStamp(who) : { at: null, witnesses: null };
    const write = (row) => appendAct(dyn, {
      ground: place.ground, household, crossing,
      at: stamp.at, witnesses: stamp.witnesses, ...row,
    });

    let state = refold();
    const drivenRows = [];

    // ── 3 · the timeout, resolved at THIS door touch, by anyone ─────────────
    //
    // "once it has expired, that hand's turn resolves as a pass at the next
    // door touch — by anyone." So a player arriving to act is exactly the
    // occasion, and it is settled BEFORE their own act is judged: otherwise
    // they would be refused for being out of turn by a wheel that has been
    // waiting on somebody who left.
    let timedOutPass = null;
    if (place.keeps_wheel) {
      const t = timedOut(state, nowMs);
      if (t.out && t.who !== who) {
        // ⚑ THE TIMEOUT SWINGS NOW (founder-called, 2026-08-29, mid-party):
        // "can we tweak the timeout to just have them STRIKE at the end of the
        // timer?" A timed-out turn resolves as an honest strike rather than a
        // pass, so the room's pace stops depending on who wandered off — the
        // fold rolls it from this row exactly as it rolls a chosen swing, and
        // the payload keeps `kind: "timeout"` so the record never pretends the
        // hand chose it. The cake answers auto-strikers by its own law (most
        // recent hand to strike it), which is the fight the wheel promised:
        // being on it IS being in it.
        const r = write({
          actor: t.who, action: "strike",
          payload: { kind: "timeout", waited_s: t.waited_s, limit_s: t.limit_s },
          effect: `${t.who} was ${t.waited_s}s into a ${t.limit_s}s turn — the timer swings for them, resolved at this door touch, by ${who}`,
        });
        timedOutPass = { who: t.who, waited_s: t.waited_s, limit_s: t.limit_s, seq: r.seq };
        state = refold();
      }
    }

    // ── 4 · the open door ───────────────────────────────────────────────────
    //
    // `the-town/crossing-is-joining`. Crossing the inner threshold is the
    // ordinary way in and `enter` writes that row; this is the other way — a
    // hand standing in the room who simply acts. Either way you are in the
    // wheel before you are judged by it, because "anyone can walk in whenever"
    // is the ruling and a door that refused an act for not having joined would
    // be a party-forming gate wearing a different hat.
    let joined = null;
    let opened = null;
    // ⚑ THE OPEN IS NOT THE JOINER'S ERRAND (found live 2026-08-28, in the
    // founder's own browser, three rounds into a fight that could not answer).
    //
    // The open used to live INSIDE the `!inWheel` branch below, so the
    // adversary could only take its slot in the same breath as some hand's
    // first join. That is the common case and it hid a whole class: a hand who
    // joins a wheel-keeping ground with nothing standing on it yet is joined
    // FOREVER, and `openAgainst` — the only thing that ever puts a creature on
    // the wheel — is never reachable again on that ground. When the adversary
    // is sited afterwards (which is exactly how the dungeon was staged: the
    // props were re-sited into their rooms after rei had already walked in),
    // the room folds to `live: false` for good.
    //
    // What that looks like from the outside is the thing `openAgainst`'s own
    // note warns about, and it is worth naming twice because the fix shipped
    // for one path and left the other: "a turn-based engine that never takes a
    // turn, reading exactly like a working one". rei stood in the candle vault
    // at round 4 with the cake at 51 of 60 — damage landing, because an
    // un-live encounter gates nothing — and no swing ever came back.
    //
    // So the open is asked on EVERY door touch into a ground that keeps a
    // wheel, whoever is acting and whether or not they are already in it. It
    // costs one fold read: `openAgainst` is idempotent by construction, asking
    // the fold whether a hostile is already in and writing nothing when one is.
    //
    // IT STILL RUNS FIRST. The creature must be in round 1's order beside the
    // hand rather than appended below it as a late arrival, which is why this
    // sits above the join rather than beside it.
    if (place.keeps_wheel) {
      opened = openAgainst(db, dyn, place, { household, crossing });
      if (opened) state = refold();
    }
    if (place.keeps_wheel && !inWheel(state, who)) {
      const r = write({
        actor: who, action: "join",
        payload: { kind: "player", how: "acted in" },
        effect: `${who} joins the wheel — initiative is rolled on the way in`,
      });
      state = refold();
      joined = { seq: r.seq, initiative: (state.wheel?.order ?? []).find((j) => j.who === who)?.initiative ?? null,
                 round: (state.wheel?.order ?? []).find((j) => j.who === who)?.joined_round ?? null };
    }

    // ── 4b · THE DUET NEEDS A FIRST BEAT ────────────────────────────────────
    //
    // ⚑ THE DEADLOCK THIS EXISTS TO PREVENT, and it is the bug that would have
    // made the room unplayable while every unit test stayed green.
    //
    // "Hostile turns are resolved by the act that ends a player's turn." Read
    // as the ONLY occasion, that clause has no first beat: the adversary has an
    // `initiative_bonus` and will often win the open, so the wheel comes to
    // rest on the creature before any player has acted. The gate below then
    // refuses every hand — correctly, it IS the creature's turn — and no act
    // ever succeeds, so nothing ever drives the creature. The room locks on
    // turn one and the refusal is honest the whole way down.
    //
    // The clause's own next sentence is the answer: "the duet is the event
    // loop". A door touch IS the beat. So creature turns due right now are
    // resolved BEFORE the caller's act is judged — the same rule the timeout
    // clause states out loud for an absent hand, applied to a creature that
    // never had a hand to wait for.
    const driveHostiles = () => {
      let guard = 0;
      const cap = ((state.wheel?.order ?? []).length + 2) * 2;
      while (state.encounter_live && guard++ < cap) {
        const due = pendingHostileTurns(state);
        if (!due.length) break;
        const a = hostileAct(state, due[0], { at: now() });
        const r = write({
          actor: a.actor, action: a.action, object: a.object,
          payload: a.payload,
          effect: `${a.actor} ${a.action}s ${a.object ?? "nobody"} — ${a.payload?.chose ?? "its own rule"}`,
        });
        drivenRows.push(Number(r.seq));
        state = refold();
      }
    };
    if (place.keeps_wheel) driveHostiles();

    // ── 5 · the wheel's gate, refusing BY NAME ──────────────────────────────
    //
    // ⚑ THE GATE IS ARENA-SCOPED, AND IT IS SCOPED FROM THE LIST RATHER THAN BY
    // AN EXCEPTION (founder-ruled 2026-08-29). LOGOS § The arena: "The wheel
    // gates this ground's ARENA verbs, and nothing else. … The ordinary verbs of
    // the town are not the wheel's business: walk, say, stake, unstake, give,
    // take and every other verb a resident holds anywhere flow UNGATED inside a
    // live encounter, exactly as they do outside one."
    //
    // This door only ever HANDLES arena verbs — anything else is refused 422 at
    // the top — so the narrowing changes nothing that reaches here today, and
    // that is exactly why it is written down rather than assumed. The gate that
    // actually held walk and say shut was never in this file: it is
    // `acting_blocked` on the standpoint (world-apex.mjs § actingBlocked), which
    // a reader treats as "you may not act" full stop. That one carries the
    // narrowing where a resident can feel it.
    //
    // `WHEEL_GATED` is the fold's own list, imported rather than restated, so
    // the door refuses exactly the acts the fold ignores. Two hand-kept lists of
    // gated verbs would be the drift this file keeps nailing shut.
    if (place.keeps_wheel && state.encounter_live && WHEEL_GATED.includes(action)) {
      if ((state.downed ?? []).includes(who))
        throw bounce(409, `${who} is down — someone has to lift you`,
          "at zero you are DOWN, not dead: your ARENA acts stop and any ally may spend their whole turn lifting you. The wheel skips you until one does, so waiting for your turn will not help. Down stops your arena acts, not your voice — you can still speak, still walk, still hand things over while you are on the floor.",
          { encounter: publicState(state), downed: true });
      // ⚑ OUT OF TURN IS NO LONGER A REFUSAL (founder-asked 2026-08-29): "let
      // agents QUEUE their actions (1 at a time, requeue just replaces) instead
      // of bouncing and saying it's not your turn."
      //
      // So the row is WRITTEN and the fold holds it. The door does not decide
      // whether it resolves now or waits — it appends the act and reads the
      // refold, which is the same division of labour every other verb here
      // keeps: the door owns the pen, the fold owns the law. A door that
      // branched on the turn would be a second wheel.
      //
      // The refusal that STAYS is the one above: down is not a wait, it is a
      // state somebody else has to end, and holding an act through it would fire
      // a stale intent after a lift.
    }

    // ── 6 · the act ─────────────────────────────────────────────────────────
    const object = String(args.object ?? args.target ?? args.at ?? "").trim() || null;
    if (action === "lift" && !object)
      throw bounce(422, "lift whom?", `name the hand you are lifting — object: "<handle>". Down right now: ${(state.downed ?? []).join(", ") || "(nobody)"}`);
    if (action === "loot" && state.phase !== "spent")
      throw bounce(409, "the loot is not open yet",
        `${adversary ? `${adversary.id} is still standing (${state.boss.hp} of ${state.boss.of})` : "nothing here has been put down yet"} — the loot verb's own precondition is that the encounter is spent.`,
        { encounter: publicState(state) });

    const withWeapon = action === "strike" ? weaponInHand(db, who) : null;
    const mine = write({
      actor: who, action, object,
      payload: { kind: "player", ...(withWeapon ? { with: withWeapon } : {}) },
      effect: null,
    });
    state = refold();
    const myBeat = (state.beats ?? []).find((b) => Number(b.seq) === Number(mine.seq)) ?? null;
    // DID IT LAND, OR IS IT WAITING? The fold decided; the door reports. An act
    // with no beat of its own that appears in the queue was taken and held —
    // which is a success, not a refusal, and the answer has to say which so a
    // page does not render a queued swing as a swing that missed.
    const held = (state.queued ?? []).find((q) => Number(q.seq) === Number(mine.seq)) ?? null;

    // ── 7 · the creatures — the duet IS the event loop ──────────────────────
    //
    // "Hostile turns are resolved by the act that ends a player's turn, in the
    // same handling, until the wheel reaches a player again. There is no daemon
    // and no ticker." The guard is the order's own length: a creature that
    // could drive itself forever would be the ticker this clause forbids.
    if (place.keeps_wheel && TURN_ENDING.includes(action)) driveHostiles();

    // ── 8 · the answer ──────────────────────────────────────────────────────
    const driven = (state.beats ?? []).filter((b) => drivenRows.includes(Number(b.seq)));
    const rolls = (state.rolls ?? []).filter((r) => Number(r.seq) === Number(mine.seq) || drivenRows.includes(Number(r.seq)));
    return {
      did: action,
      ground: place.ground,
      space: place.space,
      seq: mine.seq,
      ...(joined ? { joined } : {}),
      ...(opened ? { opened } : {}),
      ...(timedOutPass ? { timed_out: timedOutPass } : {}),
      ...(myBeat ? { beat: myBeat } : {}),
      // ⚑ QUEUED IS A SUCCESS, AND THE ANSWER MUST NOT LOOK LIKE A MISS. A held
      // act has no beat — no roll, no damage, nothing happened yet — so an
      // answer that only carried `beat` would read as a swing that did nothing.
      // `positionOf` earns its keep here: it used to tell a refused hand where
      // they stood in the order, and it tells a waiting one the same thing, for
      // the better reason.
      ...(held ? { queued: { ...held, whose_turn: state.wheel?.turn ?? null,
                             you_are: positionOf(state, who),
                             note: `held — it resolves when the wheel reaches you. Send another and it REPLACES this one; you hold one slot, not a plan.` } } : {}),
      ...(withWeapon ? { with: withWeapon } : {}),
      // The page's shape (`rollsFrom`) is what rides the answer; the fold's own
      // rows stay beside it under a name that does not collide, because a
      // debugging reader wants the raw throw and the cockpit wants the card.
      rolls: cockpitRolls(rolls, { modifier: withWeapon?.bonus ?? 0, against: object ?? adversary?.id ?? null }),
      rolls_raw: rolls,
      ...(driven.length ? { then: driven } : {}),
      encounter: publicState(state),
      log: "journal",
      derivation: state.derivation,
    };
  } finally {
    try { dyn?.close(); } catch { /* a writer that cannot close still wrote */ }
    try { store?.db?.close(); } catch { /* same */ }
  }
}

/** Is this hand in the wheel and not walked out? */
export function inWheel(state, who) {
  const j = (state?.wheel?.order ?? []).find((o) => o.who === who);
  if (!j) return false;
  return !(state?.hands?.[who]?.gone);
}

const positionOf = (state, who) => {
  const order = state?.wheel?.order ?? [];
  const i = order.findIndex((o) => o.who === who);
  return i < 0 ? "not in the order" : `${i + 1} of ${order.length}`;
};

/** How many beats ride the answer. The whole log is where the whole log lives;
 *  this is the tail a combat log needs to render the last exchange. Thirty is
 *  about four rounds of a five-hand fight — enough that a reader who blinked
 *  sees what they missed, small enough that the answer stays bounded however
 *  long the party runs. */
export const BEATS_TAIL = 30;

/**
 * The encounter as a resident reads it.
 *
 * `ignored` and `rolls` are the fold's full working and they are NOT carried
 * here: an answer that hands back every roll ever thrown in the room is an
 * answer nobody reads. The acting caller gets their own rolls beside this; the
 * whole log is where the whole log lives.
 *
 * ── `beats_tail` (2026-08-29, for the site's combat log) ─────────────────────
 *
 * `beats` used to be withheld with the rest, and the cost landed on the page:
 * with no beats, a combat log could only infer OTHER hands' lines from hit-point
 * deltas in the receiving voice — "rei takes 7" — and could never say WHO
 * struck. That is a reader re-deriving a fact the fold already knows, which is
 * the same shape as a second arithmetic beside the engine's.
 *
 * A CAPPED TAIL RATHER THAN THE ARRAY. The original objection was length, not
 * secrecy: LOGOS § Downed, not dead says "the journal keeps the failed attempt
 * as history", so a beat is the fight's own record and public by construction —
 * nothing here is anybody's private business. What was true is that all of them
 * is too many, and that stays true, so the tail is capped and the cap is a named
 * constant rather than a number in a slice.
 *
 * NO LATEST-SEQ FIELD, and that is a ruling rather than an omission (Wright,
 * 2026-08-29, with bday-rail). One was written and taken back out: the consumer
 * derives its watermark as the max seq in the window it received, so a separate
 * field would be a second way to learn one fact — and the only thing it could
 * add over the max is a GAP CONFESSION, telling a reader that rows exist above
 * every beat in the tail. Rows above the tail do exist (the fold ignores an
 * out-of-turn act and it earns no beat), so the confession is sayable; the rail
 * says it will never act on it and Wright agreed. `beats_cap` and `beats_total`
 * stay, because those answer a different question — how much was withheld —
 * which a reader cannot derive from the window at all.
 */
export function publicState(state) {
  if (!state) return null;
  const beats = state.beats ?? [];
  const tail = beats.slice(-BEATS_TAIL);
  return {
    ...(tail.length ? { beats_tail: tail, beats_cap: BEATS_TAIL, beats_total: beats.length } : {}),
    phase: state.phase,
    live: state.encounter_live,
    space: state.space,
    ground: state.ground,
    adversary: state.adversary,
    wheel: state.wheel,
    hands: state.hands,
    downed: state.downed,
    dropped: state.dropped,
    looted: state.looted,
    attempts: state.attempts,
    acts: state.acts,
    ...(state.no_adversary ? { no_adversary: state.no_adversary } : {}),
    ...(state.dials_missing ? { dials_missing: state.dials_missing, disclosed: state.disclosed } : {}),
  };
}

/**
 * THE OPEN — the adversary takes its slot on the wheel.
 *
 * ⚑ WITHOUT THIS THERE IS NO FIGHT, AND NOTHING SAYS SO. `foldEncounter` calls
 * an encounter live only when a HOSTILE has joined: `encounter_live` is
 * `bossHp > 0 && joins.some(kind === HOSTILE)`. The adversary is a MARK on the
 * record, not an act in the log, so nothing ever put it on the wheel — the room
 * folded to `live: false`, the turn gate never engaged, and every act sailed
 * straight through unrefused. A turn-based engine that never takes a turn,
 * reading exactly like a working one from the outside. Found by driving the
 * door rather than by reading it.
 *
 * LOGOS § The arena: "Hostiles hold real slots and take real turns", and
 * "Initiative is rolled at the open." The open is the moment the first hand
 * joins a ground with something standing on it, so the creature's join is
 * written in the same breath — its initiative rolled from its own row, exactly
 * as a player's is.
 *
 * Idempotent by construction: it asks the FOLD whether a hostile is already in,
 * and the fold reads the rows, so a second call writes nothing.
 */
export function openAgainst(db, dyn, place, { household = null, crossing = null } = {}) {
  if (!place?.keeps_wheel) return null;
  const adversary = adversaryIn(db, place);
  if (!adversary) return null;
  const state = encounterOn(db, dyn, place);
  const already = (state?.wheel?.order ?? []).some((j) => j.kind === "hostile");
  if (already) return null;
  const r = appendAct(dyn, {
    ground: place.ground, actor: adversary.id, action: "join", household, crossing,
    payload: { kind: "hostile" },
    effect: `${adversary.id} takes its slot on the wheel — initiative is rolled at the open, and hostiles hold real slots`,
  });
  return { who: adversary.id, seq: r.seq };
}

/**
 * The join a CROSSING writes — `the-town/crossing-is-joining`, at the door it
 * is actually named for.
 *
 * Returns null when the ground keeps no wheel, so `enter` into an ordinary
 * portal ground writes nothing. Called by the apex after a successful enter.
 */
export function joinOnCrossing(db, dyn, spineIds, who, { household = null, crossing = null } = {}) {
  const place = arenaGroundAt(db, spineIds);
  if (!place?.keeps_wheel || !who) return null;
  const state = encounterOn(db, dyn, place);
  if (inWheel(state, who)) return null;
  // The creature is rolled in BEFORE the hand, so round 1's order contains
  // both. Joining the player first would put the adversary in as a LATE
  // arrival — at the bottom, next round — which is a different fight.
  openAgainst(db, dyn, place, { household, crossing });
  const r = appendAct(dyn, {
    ground: place.ground, actor: who, action: "join", household, crossing,
    payload: { kind: "player", how: "crossed in" },
    effect: `${who} crosses into ${place.ground} — crossing this door is joining the fight, and initiative is rolled on the way in`,
  });
  const after = encounterOn(db, dyn, place);
  return { ground: place.ground, seq: r.seq,
           initiative: (after.wheel?.order ?? []).find((j) => j.who === who)?.initiative ?? null,
           encounter: publicState(after) };
}

/** The leave an EXIT writes. The wheel simply stops counting you — no jails. */
export function leaveOnCrossing(db, dyn, spineIds, who, { household = null, crossing = null } = {}) {
  const place = arenaGroundAt(db, spineIds);
  if (!place?.keeps_wheel || !who) return null;
  const state = encounterOn(db, dyn, place);
  if (!inWheel(state, who)) return null;
  const r = appendAct(dyn, {
    ground: place.ground, actor: who, action: "leave", household, crossing,
    payload: { kind: "player" },
    effect: `${who} walks out of ${place.ground} — the wheel stops counting them, and they keep the hit points they left with`,
  });
  return { ground: place.ground, seq: r.seq, encounter: publicState(encounterOn(db, dyn, place)) };
}

// ── the site's declared contracts, answered ─────────────────────────────────
//
// THE SITE LANE DEFINED SEVEN CONTRACTS AND BUILT TO THEM (2026-08-26), naming
// them as "for Wright to reconcile with the core lane". This is that
// reconciliation, and it runs in this direction on purpose: MCP-FIRST says the
// door is the source and the page is derived, so the door is what must end up
// speaking one vocabulary — but where the site had already written a shape down
// and documented it, ADOPTING that shape is cheaper than making it change, and
// nothing about it is wrong. What must not happen is two shapes.
//
// The mapping is here rather than in the apex because it is arena vocabulary:
// `player`/`hostile` are the fold's words and `resident`/`creature` are the
// page's, and the place that knows both is this one.

/** The wheel, in the shape `world-cockpit.mjs § encounterOf` declares. */
export function cockpitEncounter(state, me = null, { human = null } = {}) {
  if (!state?.wheel?.order?.length) return null;
  const hands = state.hands ?? {};
  return {
    id: state.ground,
    round: state.wheel.round ?? null,
    turn: state.wheel.turn ?? null,
    order: state.wheel.order.map((o) => {
      const hp = hands[o.who];
      return {
        id: o.who,
        // The page's three kinds. A hand is a `resident` unless it is the
        // caller's own human — the fold does not distinguish those and does not
        // need to; who is a human is a fact about the CALLER, not the wheel.
        //
        // ⚑ AND THE CALLER NOW SAYS SO (2026-08-29). The third kind was
        // described here from the day this shape was written and never once
        // emitted, because nothing passed the hand in — so a human's own row
        // came back as a resident like any other. The page uses the kind to
        // know which row is the reader's when they are acting as themselves,
        // and with every row a resident it could only ever find the RESIDENT's:
        // the wheel came round to the human, and the bar refused them with "it
        // is human-of-starforge's turn", which was their own name.
        //
        // The label is still the office's own (humanHandFor); the page matches
        // on the kind and never spells the hand a second way.
        // ⚑ EVERY HUMAN ON THE WHEEL IS A HUMAN, NOT ONLY THE READER'S OWN
        // (found 2026-08-29 answering "will party guests see each other?").
        //
        // This compared the row against the CALLER's own hand and nothing else,
        // so at a party with several humans fighting, each reader saw their own
        // human labelled `human` and EVERY OTHER GUEST'S HUMAN labelled
        // `resident` — a row bearing the id `human-of-<somebody>` and the kind
        // of a thing it is not. One reader, four right answers about themselves
        // and three wrong ones about everyone else.
        //
        // The hand's own SHAPE is what settles it. `humanHandFor` builds every
        // human label as `human-of-<household slug>` and has since 2026-08-08,
        // so the prefix is the office's one spelling for "this is a human" and
        // is available without knowing whose key is reading. `human` stays a
        // parameter because `you` below still needs to know which row is the
        // reader's — that is a different question with the same input, and
        // conflating them is how this got wrong in the first place.
        kind: o.kind === "hostile" ? "creature"
          : (String(o.who).startsWith("human-of-") || (human && o.who === human) ? "human" : "resident"),
        label: String(o.who).includes("/") ? String(o.who).split("/").pop().replace(/-/g, " ") : o.who,
        initiative: o.initiative ?? null,
        // `down`, not `downed` — the page's spelling. Getting this wrong shows
        // a downed hand as upright, which is the one state a player must see.
        down: o.downed === true,
        ...(hp && Number.isFinite(hp.hp) && Number.isFinite(hp.of) ? { hp: { now: hp.hp, max: hp.of } } : {}),
        ...(o.joined_round ? { joined_round: o.joined_round } : {}),
        ...(me && o.who === me ? { you: true } : {}),
      };
    }),
  };
}

/** Faces off a `dN` string — the page derives this too, and agreeing beats
 *  guessing. */
const facesOf = (of) => { const m = /^d(\d+)$/.exec(String(of ?? "")); return m ? Number(m[1]) : null; };

/**
 * The throws an act made, in the shape `world-cockpit.mjs § rollsFrom` declares.
 *
 * ⚑ `crit` IS SENT, NEVER LEFT TO THE PAGE. The site's own note says a client
 * that decided a crit by comparing value to faces "would be inventing law and
 * would be wrong the first time a class ruled otherwise". So the door says it,
 * and today's rule is the plain one: a natural maximum on the to-hit die. When
 * a class mark rules otherwise this is the one line that changes.
 */
export function cockpitRolls(rolls = [], { modifier = 0, against = null } = {}) {
  return rolls.map((r) => {
    const faces = facesOf(r.of);
    const mod = r.for === "damage" ? Number(modifier) || 0 : 0;
    return {
      die: r.of ?? null,
      faces,
      value: r.rolled,
      modifier: mod,
      total: r.rolled + mod,
      ...(r.for === "to-hit" && faces && r.rolled === faces ? { crit: true } : {}),
      for: r.for ?? r.act ?? null,
      ...(against ? { against } : {}),
    };
  });
}

/**
 * The portal block, in the shape `world-cockpit.mjs § portalOf` declares.
 *
 * ⚠ `id`, NOT `ground`. The page returns null for a portal with no `id`, so the
 * whole cockpit silently does not mount when this field is misspelled — no
 * error anywhere, just a page that never appears.
 */
export const cockpitPortal = (place) => (!place ? null : {
  id: place.ground,
  value: place.ground,
  by: String(place.ground).split("/")[0] || null,
  space: place.space,
  keeps_wheel: place.keeps_wheel,
  // ── THE GROUND'S STRIDE, SAID AT THE DOOR (founder-asked 2026-08-29) ───────
  //
  // LOGOS § The portal ground: the dial "rides the ground's answer at the door,
  // so a reader drawing that floor can draw the grid the door will actually
  // accept. A client left to guess the granularity would be inventing law, and
  // would be wrong the first time a ground ruled otherwise."
  //
  // ABSENT, NOT NULL, when the ground has not declared one — the same manner
  // `body` keeps two lines up, and the same reason `acting_blocked` is absent
  // rather than empty: a key that is always present teaches a reader to test its
  // VALUE, and `walk_min_step: null` reads as "this ground has a stride and it
  // is nothing". A ground that has said nothing should say nothing.
  ...(Number.isFinite(place.walk_min_step) && place.walk_min_step > 0
    ? { walk_min_step: place.walk_min_step } : {}),
  ...(place.body ? { body: place.body } : {}),
});

// ── the door's schema ───────────────────────────────────────────────────────
//
// ARENA_TOOLS ride the apex's SCHEMA lookup without joining the flat door's
// tool list — the CROSSING_TOOLS / STANCE_TOOLS precedent, for the same reason:
// seam 4 says the fields an act takes come from the act's own schema, so a
// second grammar beside the apex row would be exactly the drift that seam
// closes. The flat `tools/list` count is unchanged.

const FIELD_OBJECT = {
  type: "string",
  description: "who or what this act is aimed at — a handle for lift, a mark id for loot. strike and cast find the adversary standing on this ground themselves.",
};
const FIELD_HANDLE = {
  type: "string",
  description: "which of YOUR residents is acting (omit if your key holds one; a multi-resident key must name one)",
};

export const ARENA_TOOLS = [
  { name: "world_strike",
    description: "Swing at what stands on this ground. One honest swing, landing where you stand — what you carry is felt in it. Ends your turn. THE WHEEL GATES THIS: while an encounter is live you may act only when it is your turn, and an act out of turn is refused naming whose turn it is. To hit is a witnessed roll against the adversary's guard; the throw rides the answer so you can check it.",
    inputSchema: { type: "object", properties: { object: FIELD_OBJECT, handle: FIELD_HANDLE }, additionalProperties: false } },
  { name: "world_cast",
    description: "Spend something of yourself at range. Costlier to land than a swing and heavier when it does. Ends your turn. The wheel gates it exactly as it gates a strike.",
    inputSchema: { type: "object", properties: { object: FIELD_OBJECT, handle: FIELD_HANDLE }, additionalProperties: false } },
  { name: "world_guard",
    description: "Set yourself. The next blow that lands on you is halved. Ends your turn — guarding costs you the swing you did not take.",
    inputSchema: { type: "object", properties: { object: FIELD_OBJECT, handle: FIELD_HANDLE }, additionalProperties: false } },
  { name: "world_lift",
    description: "Spend your WHOLE turn getting an ally back on their feet. They come back at partial strength; the cost is the turn, and that is the entire economy of it. Name them with object.",
    inputSchema: { type: "object", properties: { object: FIELD_OBJECT, handle: FIELD_HANDLE }, additionalProperties: false } },
  { name: "world_loot",
    description: "Take what is left when the encounter is spent. Refused while anything is still standing — the loot verb's own precondition is the phase. Does NOT end your turn.",
    inputSchema: { type: "object", properties: { object: FIELD_OBJECT, handle: FIELD_HANDLE }, additionalProperties: false } },
];
