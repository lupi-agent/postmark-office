// dynamic-presence.mjs — residents revealed to one another.
//
// Until now a resident could learn who was near them in exactly two ways: read
// the walk ledger and do the arithmetic themselves, or shout into `world_say`
// and hope. Both work. Neither is what standing somewhere is like.
//
// This makes it legible at the point of standing: `near(x, y, r)` — who is
// within r metres, nearest first — and `everyone()` — the world-wide list.
//
// ── WHERE THE POSITIONS COME FROM, AND WHY NOT FROM THE ROWS ────────────────
//
// dynamic.db's `entities` table is the source, but NOT its `x`/`y` columns.
// Those were derived at `entities_as_of`, which is whenever the last refresh
// ran — up to a crossing ago. Serving them would answer "who is near you" with
// a picture of the town as it stood this morning, which for a town where people
// walk is worse than no answer.
//
// What the table actually gives us is the GOVERNING DEPARTURE per resident:
// store-canon, the record latest-wins already settled. Position is derived, so
// the honest read evaluates that record at the instant it is asked, through the
// world's own `positionAt`. Same derivation, same physics, a fresher clock —
// which is the whole reason the save carries the departure beside the
// coordinates in the first place.
//
// The one thing this cannot fix: a resident who walked AFTER the last refresh
// has an old departure in the store, and will be shown walking their previous
// leg. That is a real staleness, it is bounded by the refresh cadence, and it
// is DISCLOSED by name (`ledger_moved`) rather than smoothed over. The fix is
// operational — `npm run dynamic:rebuild` on the office tick — not a second
// derivation here.
//
// ── AND WHERE THE OTHER HALF COMES FROM (issue #7 §1) ───────────────────────
//
// Departures are half the world. The other half is GROUND: a resident who has
// never walked stands on their parcel, and the town's map has always drawn them
// there. This layer read only the walk half, so twenty-one placed residents were
// invisible to `present` — one of them from three metres away, on their own
// porch, while the visitor concluded they were out and wrote it into a letter.
//
// The union is not assembled here. `positions.mjs` owns the roster and the
// world's own `where-is.mjs` owns the join, and `world_walkers` calls the same
// function — which is the whole point: one question, one derivation, and the
// two doors cannot disagree again.
//
// Env: WORLD_PRESENCE=1

import { WORLD_CLONE } from "./world-store.mjs";
import {
  walkModule, worldToolModule, ridesTheVessel, VESSEL_HANDLE,
} from "./dynamic-entities.mjs";
import { everyonePlaced, withFrames } from "./positions.mjs";

export const presenceEnabled = () => process.env.WORLD_PRESENCE === "1";

// ✎ PROPOSALS, NOT LAW. These two numbers have no prior life in shipped code —
// nothing has ever answered "who is near me" before — so they land as proposals
// rather than as receipts, and they are marked ✎ the way `classes.md` marks any
// number with no history behind it.
//
// They do NOT belong here permanently. When presence earns a class mark (the
// obvious home is `the-town/entity`, or a `presence` class beside it), these
// move into its `dials:` and this file edges to them exactly as
// `dynamic-store.mjs` edges to `the-town/sound`. Until then they are the
// office's own numbers and this comment is the honest interim.
export const PRESENCE_DIALS = Object.freeze({
  near_radius_m: 500,   // ✎ far enough to cover a district, short of "the whole valley"
  near_cap: 10,         // ✎ a crowd you can read, not a census
});

/**
 * Every resident's position AT AN INSTANT: the store's departures for whoever
 * has walked, their ground for everyone who has not.
 *
 * WHERE comes from `everyonePlaced` — the same function `world_walkers` calls,
 * over the same roster rule, through the world's own `where-is.mjs`. Nothing in
 * this file decides where anybody is; what it adds is presence's own vocabulary,
 * `standing` and `aboard`, which the shared shape does not carry.
 *
 * `aboard` uses the same test the standpoint has always used — a passenger's
 * departure IS the vessel's — asked of the same records. The vessel herself is
 * never in this list: she is a mark that moves, not a resident, and the entities
 * table she is excluded from is what feeds the departures below.
 */
// `_db` is kept in the signature for its callers' sake and never read: the
// entities table it used to be is gone with dynamic.db (POS-269), and the
// departures are the projection's (or, for a caller that has them, `stored`).
export function positionsAt(_db, atMs, walk, vessel = null, { world = null, where = null, frames = null, stored = null, roll = [], projected = null, placed = null } = {}) {
  const at = walk.fractionalCrossing(atMs);

  // ── ERA TWO, READ DIRECTLY ────────────────────────────────────────────────
  //
  // The entities table is a CRYSTALLIZATION, refreshed on a tick: it merges both
  // eras, but only as of the last refresh. Presence derives at the instant it is
  // asked, so between the freeze and the next refresh it was answering from a
  // table that predated the record — twenty-seven residents with an ashore
  // movement in the store, and a presence layer still folding them onto a boat
  // that had since sailed. They did not read as misplaced; they read as GONE,
  // because the fold followed her out to sea.
  //
  // So the store's own movements are merged here, at read time, beside the
  // crystallized ones. Latest wins per handle — `publicResidents` takes the last
  // match — and the sort makes that true by instant rather than by luck.
  // APPENDED, NOT SORTED — the same law world.mjs follows. Latest wins means
  // latest in array order (the engine's `currentDeparture`), and re-sorting by
  // instant would override the order era one was written in.
  //
  // THE PROJECTION, WHEN THE OFFICE KEEPS ONE (POS-264, `WORLD_POSITIONS`).
  // `projected` is the governing departure per handle across BOTH eras, kept
  // current by the walk door (`position-projection.mjs`). It replaces the two
  // halves above rather than joining them: it is already their union, one
  // record per resident, and it does not wait for a refresh.
  const departures = (projected ?? stored ?? [])
    .filter((d) => d.handle !== VESSEL_HANDLE);

  // THE GOVERNING RECORD MUST COME FROM THE SAME LIST THE POSITION DID.
  //
  // `deps` above is the entities table — era one, as of the last refresh — and
  // reading `standing` off it while the POSITION came from era two is how the
  // twenty-seven ended up neither moving nor at rest: `standing:false` computed
  // from a leg they had superseded, beside `moving:false` computed from the leg
  // that superseded it. Two fields of one answer, derived from two different
  // records. So the governing record is taken from the merged list, latest wins,
  // exactly as `publicResidents` takes the position.
  const governing = new Map();
  for (const d of departures) governing.set(d.handle, d);

  // THE FRAME OVERLAY, applied to the SAME rows the walkers door composes
  // (positions.mjs § withFrames). Without it `present` would put a passenger
  // back on the quay they left while `world_walkers` had them mid-channel —
  // issue #7's split-brain, one layer up and with a boat in it. The map is
  // precomputed by the async caller because a frame needs the engine and this
  // function is deliberately synchronous.
  // THE ROLL RIDES HERE TOO, and it is not optional in spirit. The invariant
  // one file over — "world_walkers and present name the same residents, one
  // derivation, two doors" — is not about WHERE the two doors put people, it is
  // about WHO they can see at all. Giving the walkers door a town roll and not
  // this one would have made the two doors disagree about the population of the
  // world in production, which is precisely the split-brain both were
  // consolidated to end (issue #7 §1).
  //
  // `placed` (POS-284) is `everyonePlaced` kept per change by the office
  // (position-projection.mjs § createPlacement), keyed on the projection's
  // epoch. It is taken only beside `projected`: the key names the projection,
  // so the departures above must be the projection's too.
  const place = projected && placed ? placed : everyonePlaced;
  return withFrames(place({ world, departures, at, where, roll }), frames).map((r) => {
    const dep = governing.get(r.handle) ?? null;
    return {
      handle: r.handle,
      x: r.x, y: r.y,
      // How the position was learned — "walk" or "parcel" — carried through
      // from the engine. It is honest and it belongs in a tooltip; it never
      // decides what someone looks like (the three-colour lesson, publicResidents).
      source: r.source,
      // AT REST WITH NO LEG: a zero-distance departure ("I am stopping here"),
      // or ground, which is the same state with no record at all. Asked of the
      // same `positionAt` the union used, for the one field it does not return.
      // `dep` is already in walk shape (both eras are converted before they are
      // merged), so it is asked directly — running it through `toWalkRecord` a
      // second time would flatten the fields that conversion already produced.
      standing: r.source === "walk" && dep
        ? Boolean(walk.positionAt(dep, at)?.standing)
        : !r.moving,
      moving: r.moving,
      // ABOARD. With the frame law running, `withFrames` has already said so
      // and named the carrier; the old test — a passenger's departure IS the
      // vessel's — is the line-mirroring Stage D retires, kept only for the
      // flag-off path where nothing derives frames at all.
      aboard: r.aboard ?? (r.moving && ridesTheVessel(dep, vessel)),
      // Which era's record is answering for this resident, said out loud: the
      // seam is invisible to the arithmetic and should not be invisible to an
      // operator debugging a position.
      ...(dep?.source === "store" ? { era: "store" } : {}),
      ...(r.frame ? { frame: r.frame, provenance: r.provenance } : {}),
      remaining_m: r.remaining_m,
      eta_crossings: r.eta_crossings,
    };
  }).sort((a, b) => (a.handle < b.handle ? -1 : 1));
}

/**
 * THE RIDERS, ADDED TO THE SAME FRAME MAP (#2986, Keemin-ruled 2026-09-19).
 *
 * A rider's frame cannot be folded out of their departures — they entered
 * through a wharf the hull is nowhere near, which is ruling 1 — so it is read
 * off the enter-exit ledger, ONCE for the whole town rather than per resident,
 * and merged into the map `withFrames` already applies.
 *
 * It lands HERE, beside presence's own read, for the reason positions.mjs gives
 * about itself: if the walkers door placed a rider at the hull and presence
 * placed them back on the quay they entered from, somebody would write them a
 * letter opening "you aren't home" all over again. One map, both doors: the
 * walkers door applies it too (`world.mjs § walkersInFrames`, POS-261). Until
 * then that door folded walks for a frame instead, which a walk never yields,
 * so its riders stood on the quay.
 *
 * ⚑ RIDERS OVERWRITE, and they must. Occupancy is the record the law now
 * reads, so where the walk fold and the ledger disagree about a rider, the
 * ledger wins. Since 2026-09-26 a walk never folds anyone aboard (Keemin:
 * "simply 'walking aboard' shouldn't put you on the boat anymore"), so the
 * fold can no longer disagree by boarding. The overwrite is still the one
 * thing that puts a rider at the hull.
 *
 * `occupancy` is the ledger's answer, handed in by a test (POS-247) so the
 * overwrite can be proved without a served ledger. The door never passes it.
 */
export async function withVehicleRiders(frames, { world, repo, atMs, occupancy = null }) {
  const { vehicleWithin, vesselPositionAt } = await import("./world-movement.mjs");
  if (!occupancy) {
    const [{ crossingLaw }, { crossingDeps }] = await Promise.all([import("./world-crossings.mjs"), import("./world-apex.mjs")]);
    const law = await crossingLaw(repo).catch(() => null);
    if (!law?.thresholds) return frames;
    const deps = crossingDeps();
    const at = law.thresholds.stampAt(deps.now());
    const acts = law.thresholds.parseEnterExitLedger(await deps.ledger()).acts;
    occupancy = law.thresholds.occupancyAt(acts, at);
  }
  let hull = null;
  const out = frames ? new Map(frames) : new Map();
  for (const [handle, stack] of occupancy) {
    const vessel = vehicleWithin(stack, world);
    if (!vessel) continue;
    hull ??= await vesselPositionAt(world, atMs, { repo });
    if (!hull) break;
    out.set(handle, { frame: vessel, local: { x: 0, y: 0 }, world: { x: hull.x, y: hull.y },
                      provenance: hull.moving ? "carried" : "aboard" });
  }
  return out.size ? out : frames;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Open the store and read what presence needs, with the disclosure attached.
 * Never throws: a presence read that could take down `orient` would be a worse
 * bargain than not knowing who is nearby.
 */
/**
 * THE VESSEL'S SAILING LINE, FROM THE PROJECTION (POS-269). Her departures are
 * walk records like anyone's, so the projection keeps her governing one beside
 * everybody else's (`positionsAt` then drops her from the resident list, as it
 * always did). It is the line the entities table's `meta.vessel_departure`
 * held, read from the record instead of from a crystallization of it.
 */
export const vesselFromProjection = (departures) =>
  [...(departures ?? [])].reverse().find((d) => d?.handle === VESSEL_HANDLE) ?? null;

async function readPresence({ dbPath = null, repo = WORLD_CLONE, atMs = Date.now(), walk = null, engine = null, world = null, where = null, roll = [], projected = null, placed = null } = {}) {
  // ── A READ HANDED THE PROJECTION READS ONLY THE PROJECTION (POS-269) ───────
  // The doors hand one over exactly when this office keeps positions
  // (WORLD_POSITIONS=1, world.mjs § keptPresence and § worldPresent). Every
  // departure and the vessel's sailing line are in it, so dynamic.db is not
  // opened at all: no entities table, no meta. The answer's `as_of` is the
  // projection's build instant, and the entities table's staleness disclosures
  // do not apply to it.
  if (projected) return projectedPresence({ repo, atMs, walk, engine, world, where, roll, projected, placed });
  // NO PROJECTION, NO PRESENCE (POS-269). Without one this read used to open
  // dynamic.db's entities table; the store is retired, so an office that keeps
  // no positions has no presence to give, and says so rather than guessing.
  return { error: "presence-needs-projection", detail: "presence reads the position projection (WORLD_POSITIONS=1); dynamic.db, which it read without one, is retired (POS-269)" };
}

/** The projection-only read: `readPresence`'s own derivation with no store behind it. */
async function projectedPresence({ repo, atMs, walk, engine, world, where, roll, projected, placed }) {
  try {
    const w = walk ?? await walkModule({ repo });
    const eng = engine ?? await worldToolModule("world-engine.mjs", { repo });
    let whereMod = where;
    if (!whereMod) {
      try { whereMod = await worldToolModule("where-is.mjs", { repo }); } catch { whereMod = null; }
    }
    let frames = null;
    if (world && (await import("./world-movement.mjs")).worldHasVehicle(world)) {
      try { frames = await withVehicleRiders(frames, { world, repo, atMs }); }
      catch { /* the riders read as ashore for this call, and nobody loses presence */ }
    }
    const departures = projected.departures ?? [];
    const rows = positionsAt(null, atMs, w, vesselFromProjection(departures),
      { world, where: whereMod, frames, stored: null, roll, projected: departures, placed });
    return {
      rows, engine: eng,
      as_of: projected.built_at ?? null,
      evaluated_at: new Date(atMs).toISOString(),
      ledger_moved: false,
      disclosed: [
        ...(world && whereMod ? [] : [`ground-not-read: only residents with a walk on record are in this answer — ${world ? "the world's position join could not be read" : "no world fold was handed to the presence read"}, so anyone who has never walked is missing`]),
        ...(projected.disclosed ?? []),
      ],
    };
  } catch (e) {
    return { error: "presence-derivation-failed", detail: String(e?.message ?? e).slice(0, 200) };
  }
}

/**
 * Who is within `radiusM` of a point, nearest first.
 *
 * `place` is injected exactly as `voices.mjs` injects it — this module must
 * never grow a second answer to what a point is called. Omit it and the rows
 * carry no place words, which is the right default for a world-wide read where
 * the count is unbounded.
 */
export async function near({
  x, y, radiusM = PRESENCE_DIALS.near_radius_m, limit = PRESENCE_DIALS.near_cap,
  exclude = [], place = null, dbPath = null, repo = WORLD_CLONE, atMs = Date.now(),
  walk = null, engine = null, world = null, where = null, roll = [], projected = null, placed = null,
} = {}) {
  const read = await readPresence({ dbPath, repo, atMs, walk, engine, world, where, roll, projected, placed });
  if (read.error) return { error: read.error, detail: read.detail, residents: [], count: 0 };

  const skip = new Set(exclude);
  const here = { x, y };
  const { bearingDeg, quantizeBearing, distanceBand } = read.engine;

  const hits = read.rows
    .filter((r) => !skip.has(r.handle) && dist(r, here) <= radiusM)
    .map((r) => ({ ...r, distance_m: Math.round(dist(r, here)) }))
    .sort((a, b) => a.distance_m - b.distance_m || (a.handle < b.handle ? -1 : 1));

  const shown = hits.slice(0, limit);
  const residents = [];
  for (const r of shown) {
    residents.push({
      handle: r.handle,
      distance_m: r.distance_m,
      source: r.source,   // walk-derived or ground-derived — how we know, never how it renders
      // The town's OWN vocabulary for direction and distance, imported from the
      // world's engine: a resident and a hill are described the same way, in the
      // same words, because presence is a thing you see and not a new sense.
      bearing: quantizeBearing(bearingDeg(r.x - here.x, r.y - here.y)),
      band: distanceBand(r.distance_m),
      at: { x: Math.round(r.x), y: Math.round(r.y) },
      standing: r.standing, moving: r.moving, aboard: r.aboard,
      // ⚑ `available` STOOD HERE, beside standing and moving, and is parked
      // (2026-09-10, the founder's word; world#19 reverted, bytes on office
      // `wright/parked-proposals-office`). It was injected exactly as `place`
      // is, and its own guarantee was that with no resolver passed the row was
      // byte-identical to the one this module had always served — so removing
      // the injection returns the row to precisely that byte-identical shape,
      // which is why nothing downstream had to change with it.
      ...(r.moving ? { remaining_m: Math.round(r.remaining_m ?? 0) } : {}),
      ...(place ? { place: await place({ x: r.x, y: r.y, aboard: r.aboard, moving: r.moving }) } : {}),
    });
  }

  return {
    at: { x: Math.round(x), y: Math.round(y) },
    radius_m: radiusM,
    count: hits.length,
    shown: residents.length,
    // Said out loud rather than left to be inferred from a short list: a cap is
    // a rendering decision and a reader must be able to tell it from an empty
    // room. (The flood cap on hearing learned this the same way.)
    capped: hits.length > residents.length,
    residents,
    as_of: read.as_of,
    evaluated_at: read.evaluated_at,
    ledger_moved: read.ledger_moved,
    ...(read.disclosed.length ? { disclosed: read.disclosed } : {}),
  };
}

/**
 * Everyone in the world, with where they are. `world_walkers`' successor shape:
 * one list, because "arrived" and "standing" are the same state — a person at
 * rest — differing only in how the position was learned. That lesson is the
 * walkers door's, already paid for, and it is not re-learned here.
 */
export async function everyone({
  place = null, dbPath = null, repo = WORLD_CLONE, atMs = Date.now(), walk = null, engine = null,
  world = null, where = null, roll = [], projected = null, placed = null,
} = {}) {
  const read = await readPresence({ dbPath, repo, atMs, walk, engine, world, where, roll, projected, placed });
  if (read.error) return { error: read.error, detail: read.detail, residents: [], count: 0 };

  const residents = [];
  for (const r of read.rows) {
    residents.push({
      handle: r.handle,
      at: { x: Math.round(r.x), y: Math.round(r.y) },
      source: r.source,
      standing: r.standing, moving: r.moving, aboard: r.aboard,
      // ⚑ `available` stood here too — parked with near()'s; see the note there.
      ...(r.moving ? { remaining_m: Math.round(r.remaining_m ?? 0), eta_crossings: r.eta_crossings } : {}),
      ...(place ? { place: await place({ x: r.x, y: r.y, aboard: r.aboard, moving: r.moving }) } : {}),
    });
  }
  return {
    count: residents.length,
    residents,
    as_of: read.as_of,
    evaluated_at: read.evaluated_at,
    ledger_moved: read.ledger_moved,
    ...(read.disclosed.length ? { disclosed: read.disclosed } : {}),
  };
}

/**
 * The shape the doors hang off `orient` and `open-your-eyes`.
 *
 * THE FLAG-OFF PATH IS THE FIRST LINE, as `servedRead`'s and
 * `emissionFromVoice`'s are: nothing is opened, nothing derived, nothing
 * allocated, and the verb's answer is the one it has always given. Returns null
 * rather than an empty section, so a caller spreading it adds no key at all.
 *
 * It never throws and it never bounces. A presence layer that could break
 * `orient` would have bought legibility with the door itself.
 */
export async function presentNear(at, { place = null, exclude = [], repo = WORLD_CLONE, ...rest } = {}) {
  if (!presenceEnabled()) return null;
  try {
    const r = await near({ x: at.x, y: at.y, place, exclude, repo, ...rest });
    if (r.error) return { unavailable: r.error, detail: r.detail };
    return r;
  } catch (e) {
    console.error(`[presence] the presence read tripped (${String(e?.message ?? e).slice(0, 160)}) — the door answers without it`);
    return { unavailable: "presence-threw" };
  }
}

/** Residents grouped the way the telling groups everything else: by distance band, nearest band first. */
export function byBand(residents) {
  const bands = new Map();
  for (const r of residents) {
    if (!bands.has(r.band)) bands.set(r.band, []);
    bands.get(r.band).push(r);
  }
  return [...bands.entries()].map(([band, list]) => ({ band, residents: list }));
}
