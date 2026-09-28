// positions.mjs — WHERE IS EVERYONE. One question, one derivation, every reader.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// The world knows two ways where a resident is: the walk ledger (they declared
// a departure and the clock carried them) and their parcel (they have never
// walked, so their ground IS their position — ruling 7). `world_walkers` has
// always answered from the UNION of those two; the presence layer, built later
// from the walk ledger alone, answered from half of it.
//
// So `present` could not see twenty-one placed residents. Issue #7 §1: a
// resident walked 473 m to visit finn, stood on finn's porch, read `count: 0`,
// and wrote them a letter opening "You aren't home." finn was fourteen feet
// away, drawn at home on the town's own map the whole time.
//
// That is the split-brain world.mjs already names at its `worldBlockForHandle`:
// "One question must not have two derivations that disagree." This is that rule
// applied to the plural form of the same question. Both consumers now call
// `everyonePlaced` and neither derives a position of its own.
//
// ── WHAT IS HERE AND WHAT IS NOT ────────────────────────────────────────────
//
// The JOIN is not here either. `tools/where-is.mjs` in the world clone owns
// walk-first-then-ground (`whereIs`) and the one public shape (`publicResidents`
// — "arrived and standing are the same state, learned differently"). This file
// owns exactly one thing the engine cannot know: WHO TO ASK ABOUT. A roster is
// a fact about this office's inputs — which ledger it read, which fold it holds
// — so the engine takes it as an argument, and this is the single place that
// builds it.
//
// Pure: no fs, no git, no engine import. The caller supplies the fold, the
// departures and the clone's own where-is module, exactly as `where-is.mjs`
// itself takes a world and a ledger. That is what lets the walkers door (ledger
// departures, read at main) and the presence layer (governing departures, read
// from the dynamic store) share one answer without sharing a source.
//
// The one import below is a pure sibling and holds that law: `groundless.mjs`
// is constants and two shape functions, no fs, no git, no engine.

import { isGroundlessDefault, atOrigin } from "./groundless.mjs"; // the Origin is where the groundless stand (#2900)

/**
 * WHO TO ASK ABOUT: everyone with a walk on record, plus every household
 * holding ground. The union is the whole fix — either half alone is a class of
 * resident the answer cannot see.
 *
 * Duplicates are fine; `publicResidents` dedupes by handle and the walk wins,
 * which is why a resident with both a parcel and a walk record appears once, at
 * the walk-derived position.
 */
export function positionRoster({ departures = [], world = null, roll = [] } = {}) {
  return [
    ...(departures ?? []).map((d) => d?.handle),
    ...((world?.parcels ?? []).map((p) => p?.household)),
    // THE TOWN ROLL — the third term, and the one that made the union honest.
    //
    // The two above are records of DOING: you walked, or you claimed ground. A
    // resident who has done neither cannot appear in either, so for as long as
    // the roster was their union it could not contain them — 28 of 103 residents
    // were not answered wrongly, they were never asked about. The engine has
    // placed them since world fd965b7c (`the-town/the-standing-porch`: the quay,
    // when the record places them nowhere else); this is the office finally
    // putting the question.
    //
    // Empty by default so a caller that cannot hold a roll behaves exactly as
    // before rather than differently-and-silently. The doors that CAN hold one
    // pass it, and the walkers door discloses when it was given none.
    ...(roll ?? []),
  ].filter(Boolean);
}

/**
 * EVERY PLACED RESIDENT, at one instant, in the engine's own vocabulary:
 * `{ handle, x, y, source, moving, toward, remaining_m, eta_crossings, mark_id }`.
 *
 * `where` is the clone's `where-is.mjs`. A clone whose engine cannot be read
 * answers with nobody rather than with a second implementation — the caller
 * discloses the gap (the deriver's law: refuse or disclose absent inputs, never
 * quietly substitute).
 *
 * `world` may be null: then the roster is the walk ledger alone, which is
 * exactly the state this file exists to stop happening silently. Callers that
 * can hold a fold must pass one, and say so when they cannot.
 *
 * `only` (POS-284), a Set of handles, asks about some of them: the same roster,
 * in the same order, cut to those handles. `publicResidents` places each handle
 * on its own, so a row asked for alone is the row the whole answer holds. It is
 * how a kept placement re-places the few who are walking without re-placing the
 * town.
 */
export function everyonePlaced({ world = null, departures = [], at, where = null, roll = [], only = null } = {}) {
  if (typeof where?.publicResidents !== "function") return [];
  const roster = positionRoster({ departures, world, roll });
  const rows = where.publicResidents(only ? roster.filter((h) => only.has(h)) : roster, { world, departures, at });
  // ── ONE STANDPOINT FOR THE GROUNDLESS (#2900, ruled 2026-09-17) ───────────
  //
  // The roll is what finally put the question — and the engine answered it with
  // the porch, so the third term the union gained placed all 28 of them at the
  // quay. The founder ruled the Origin: "a groundless resident stands at the
  // Origin everywhere the office answers the question."
  //
  // THE CORRECTION BELONGS HERE, in the file whose whole subject is that one
  // question must not have two derivations that disagree. `presence` and
  // `world_walkers` are both downstream of this line, so they move together; a
  // fix in `dynamic-presence.mjs` would have moved presence alone and left the
  // walkers door answering the quay — manufacturing, one layer down, the exact
  // split-brain this file was written to end.
  //
  // It is a MAP over the engine's rows, not a second derivation: `whereIs` still
  // decides who is placed and who is moving and where a walker is, and only the
  // rows it labelled with its own groundless default are rewritten. A resident
  // with ground reads `parcel` and passes through untouched.
  return rows.map((r) => (isGroundlessDefault(r) ? atOrigin(r) : r));
}

/**
 * THE FRAME OVERLAY (Stage D). Everyone whose frame is a carrier reads at the
 * carrier's position, not at the last place they walked to.
 *
 * This lives HERE, beside the union it corrects, for the reason this whole file
 * exists. A resident aboard the Post Office is a resident whose walk record is
 * true and whose position is elsewhere — exactly the shape of the split issue #7
 * was about, one layer up. If the walkers door applied this and the presence
 * layer did not, `present` would put a passenger back on the quay they left and
 * somebody would write them a letter opening "you aren't home" all over again.
 *
 * PURE, like everything else in this file: `framesByHandle` is a precomputed map
 * of `{ frame, world, provenance }`, because deriving a frame needs the engine
 * and the clock and this file takes neither. The caller derives; this composes.
 *
 * `aboard` and `provenance` are ADDED rather than folded into `moving`, for the
 * reason `publicResidents` gives about its own two states: how we know must
 * never decide what someone looks like. A rider is moving because the water is
 * moving them, and the answer says which.
 */
export function withFrames(rows, framesByHandle = null) {
  if (!framesByHandle?.size) return rows;
  return rows.map((r) => {
    const f = framesByHandle.get(r.handle);
    if (!f?.frame || !f.world) return r;
    return {
      ...r,
      x: f.world.x, y: f.world.y,
      aboard: true, frame: f.frame,
      provenance: f.provenance,
      // A carried resident is not walking a leg: there is no remainder and no
      // ETA, because nothing they declared is still in progress.
      remaining_m: 0, eta_crossings: 0,
    };
  });
}
