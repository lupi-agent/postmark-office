// world-movement.mjs — STAGE D, the movement cutover. All of it behind
// `WORLD_MOVEMENT_V2=1`; with the flag off nothing in this file runs and every
// door answers byte-for-byte what it answered before.
//
// Three sentences from the proposal become code here, and each one replaces a
// derivation the office had been doing for itself:
//
//   1. A CARRIER'S POSITION IS f(TIMETABLE, CLOCK). Not a walk-ledger line that
//      the pen files on her behalf at cast-off. `tools/vessel.mjs` has held this
//      arithmetic since 2026-08-07 and the office never consumed it — it read
//      her sailing line out of the ledger like a resident's and compared
//      passengers against it field by field (`ridesTheVessel`). That comparison
//      is the line-mirroring being retired: true only for as long as the pen
//      keeps filing passengers with byte-identical records, which is a
//      coincidence of the writer, not a fact about the world.
//
//   2. RIDING IS A FRAME, NOT A DECLARATION (ruled 2026-08-10, and it REPLACES
//      this file's first answer). An earlier build asked residents to say "I am
//      aboard" and validated the claim against where they stood at the cast-off
//      instant. The frame law deletes all of it: your frame is the deepest
//      carrier you are within, crossing the boundary is the consent, and there
//      is no cast-off instant to be present at — you are carried if your frame
//      is the carrier when it moves. The machinery lives in `world-frames.mjs`;
//      this file is where the doors reach it.
//
//   3. AN EMISSION RIDES ITS SOURCE. A voice's frame is its speaker; a speaker's
//      frame may be a carrier; FRAMES COMPOSE. A shared deck is one room by
//      construction — see `heardFromV2`, and the INTERIM block in voices.mjs it
//      supersedes. This generalized for free when attachments became frames,
//      which is the sign the law was the right size.
//
// THE ENGINE COMES FROM A REF, NOT THE WORKING TREE. Same discipline (and the
// same helper) as `dynamic-entities.mjs`: the world clone's checkout belongs to
// the write pen and routinely sits on a household draft branch, so importing
// movement arithmetic from the tree would mean the office computed where the
// boat is from whatever the last writer left behind.

// NOTHING FROM `node:fs` OR `dynamic-store` IS IMPORTED HERE ANY MORE, and the
// absence is the receipt: `existsSync`, `openDynamic`, `dynamicDbPath` and
// `readMovements` existed in this module for `storedDepartures` alone, which
// reads `acts` now (POS-154). A module that keeps the handle to a store it no
// longer reads is one edit away from reading it again.
import { WORLD_CLONE } from "./world-store.mjs";
import { movementV2Enabled } from "./dynamic-store.mjs";
import { VESSEL_HANDLE, worldToolModule } from "./dynamic-entities.mjs";
import { boundariesOnRoad, carriersFrom, carriersWithDisclosure, carrierStateAt, foldFrames, gunwaleWarning, inRect } from "./world-frames.mjs";

// The flag is read from the environment on every call and never latched at
// import — the discipline `world-serve.mjs` and `dynamic-store.mjs` already use,
// for the same reason: a test flips it between cases, and an operator flipping
// it is restarting the office anyway. It is DEFINED in `dynamic-store.mjs`
// (beside the store it governs, so the entity deriver can read it without a
// cycle) and re-exported here, where callers look for it.
export { movementV2Enabled };
export { carriersFrom, carriersWithDisclosure, inRect };

// ── the service, from the world's own tools ──────────────────────────────────

// Keyed on the marks ARRAY, not on a ref string: `world.mjs` already caches the
// assembled world per ref+sha and hands us the same array object until it
// rebuilds, so this is exactly as fresh as the world it was derived from and
// costs nothing to invalidate. A WeakMap because a retired world should be
// collectable with the service that was folded out of it.
const _services = new WeakMap();

/**
 * The vessel service the world currently runs, derived from the FOLD, plus the
 * carriers this world declares.
 *
 * `servicesFromFold` collects errors rather than throwing, so one malformed
 * schedule cannot blind the office to a good one — and a world with no timetable
 * mark at all is a legitimate world (every fixture in the test suite is one), so
 * the answer is `null` with the reason attached, never an exception.
 */
export async function vesselServiceFrom(worldState, { repo = WORLD_CLONE, vesselHandle = VESSEL_HANDLE } = {}) {
  const marks = worldState?.marks ?? null;
  if (!Array.isArray(marks)) return { service: null, carriers: [], errors: [], reason: "no folded marks to read a timetable from" };
  const cached = _services.get(marks);
  if (cached) return cached;

  let out;
  try {
    // `vessel.mjs` is pure and takes the instant in; the CLOCK it converts with
    // lives in `walk.mjs` and vessel does not re-export it. One motion law in
    // the world, so one place the wall clock becomes a fractional crossing —
    // this module borrows it rather than restating the epoch or the period.
    const [vesselMod, walkMod] = await Promise.all([
      worldToolModule("vessel.mjs", { repo }),
      worldToolModule("walk.mjs", { repo }),
    ]);
    const mod = Object.assign(Object.create(vesselMod), { fractionalCrossing: walkMod.fractionalCrossing });
    const { services, errors } = vesselMod.servicesFromFold({ marks });
    const service = services.find((s) => s.vessel.handle === vesselHandle) ?? services[0] ?? null;
    const { carriers, source: carrierSource, disclosed } = carriersWithDisclosure(worldState);
    out = { service, carriers, carrierSource, disclosed, errors, mod, walk: walkMod, reason: service ? null : "no mark in this world carries `mechanic: timetable`" };
  } catch (e) {
    // A world clone that cannot hand over `vessel.mjs` is an office that must
    // still answer. The flag-on path falls back to the flag-off derivation and
    // says why, rather than refusing to tell anyone where they are.
    out = { service: null, carriers: [], carrierSource: "none", disclosed: [], errors: [{ mark: "(engine)", error: String(e?.message ?? e).slice(0, 200) }], mod: null, walk: null, reason: "the world's tools/vessel.mjs could not be read at a ref" };
  }
  _services.set(marks, out);
  return out;
}

/** Drop the memoized services — for tests that rebuild a world in place. */
export function resetServiceCache() { /* WeakMap: entries die with their marks array */ }

// ── the stop answers ─────────────────────────────────────────────────────────
//
// The law (the-stop-answers, child of the timetable class, planted 2026-08-23):
// "A stop answers the published word: a read at a landing carries the vessel's
// next departures, derived at the read's instant, never stored." This is the
// shore side of the frame block — aboard, `frame.moves_next` already says when
// she moves; this answers the same derivation to feet still on the quay, so an
// agent at Pando Landing no longer needs to know which mark hides the schedule.
export const STOP_EARSHOT_M = 25; // beside the wharf still hears the bell — within a stride of a landing counts as standing at it

export async function stopDepartures(worldState, standpoint, { repo = WORLD_CLONE, now = Date.now(), count = 2 } = {}) {
  if (!movementV2Enabled()) return null;
  const x = Number(standpoint?.x), y = Number(standpoint?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const { service, mod } = await vesselServiceFrom(worldState, { repo });
  if (!service || !mod) return null;
  const atStop = (s) =>
    (s.extent && inRect({ x, y }, { x: s.at.x, y: s.at.y, w: s.extent.w, h: s.extent.h })) ||
    Math.hypot(x - s.at.x, y - s.at.y) <= STOP_EARSHOT_M;
  const stop = service.stops.find(atStop);
  if (!stop) return null;
  const next = mod.nextDepartures(service, mod.fractionalCrossing(now), count, { from: stop.markId });
  return {
    at_stop: stop.markId,
    vessel: service.vessel.markId,
    next: next.map((s) => ({ at: new Date(mod.instantOf(s.departFc)).toISOString(), toward: s.to.markId, crossing: s.departFc })),
    terms: "the published word, derived at the read's instant, never stored — the timetable class's the-stop-answers",
  };
}

/**
 * A carrier-state reader bound to one world and one clock source, memoized.
 *
 * The fold asks for a carrier's position many times over one derivation (once
 * per record, plus the provenance comparison), and every ask is the same pure
 * arithmetic over the same schedule. Memoizing on (carrier, instant) makes a
 * fold over forty records cost a handful of evaluations instead of hundreds.
 */
export function carrierReader(worldState, { repo = WORLD_CLONE, service, mod }) {
  const seen = new Map();
  return async (carrier, atMs) => {
    const k = `${carrier.id}|${atMs}`;
    if (seen.has(k)) return seen.get(k);
    const st = await carrierStateAt(carrier, worldState, atMs, { repo, service, mod });
    seen.set(k, st);
    return st;
  };
}

// ── where a carrier is ───────────────────────────────────────────────────────

/**
 * The vessel's position at an instant: position = f(timetable, clock).
 *
 * Returns the shape the standpoint speaks — `{ x, y, placed, moving, berthed,
 * atStop, sailing }` — or null when this world runs no service. Nothing about
 * her position is stored, read from a ledger, or written; two clones asked the
 * same instant answer the same coordinates.
 */
export async function vesselPositionAt(worldState, atMs = Date.now(), { repo = WORLD_CLONE } = {}) {
  const { service, mod } = await vesselServiceFrom(worldState, { repo });
  if (!service || !mod) return null;
  const v = mod.vesselPositionAt(service, mod.fractionalCrossing(atMs));
  if (!v || !Number.isFinite(v.x)) return null;
  return {
    x: v.x, y: v.y, placed: true,
    source: "timetable",
    moving: !v.berthed,
    berthed: Boolean(v.berthed),
    atStop: v.atStop ?? null,
    sailing: v.sailing ?? null,
    service,
  };
}

// ── ABOARD BY OCCUPANCY, NOT BY GEOMETRY (#2986, Keemin-ruled 2026-09-19) ────
//
// THIS IS WHAT § 7 RETIRES, and it is worth being exact about what survives.
// The frame law above still decides where you stand when you LEAVE a thing that
// carries things — a keystone riding a house, a held lantern riding its holder,
// an attachment riding the hull. What it stops deciding is THE PASSENGER CASE.
//
// The frame law's answer to "is this resident aboard" is `foldFrames`: your
// endpoint at arrival landed inside her footprint. Keemin's ruling 1 —
// "decouple the geometric movement of the Post Office from the residents'
// ability to ride it" — makes that answer unreachable for a rider by
// construction: you enter through a wharf a hundred kilometres from her hull,
// your walk record ends at that wharf, and no fold over your departures will
// ever put you inside her. So the question moves to the record that actually
// knows: the enter-exit ledger, which is the office's one answer to "what are
// you inside" and has been since the pair shipped.
//
//   "wherever a resident boards … they can take it to their destination at Post
//    Office speed as if it was going directly there"
//   "we need the residents sitting still in a Post Office interior"
//
// So: your standpoint IS the hull's, you are not moving (nothing you declared is
// in progress — the timer is not a leg), and THERE IS NO INTERPOLATION TOWARD
// THE DESTINATION. That last one is not an omission; it is ruling 6 falling out
// of one branch. A lobby has no intermediate points.

/** Does this world hold a mark of the vehicle class? The cheap gate, off the
 *  fold, asked before anything reads a ledger — so an office in a world with no
 *  vehicle pays nothing for this seam at all. */
export const VEHICLE_CLASS = "vehicle";
// Memoized on the MARKS ARRAY, the same key `_services` above uses and for the
// same reason: `world.mjs` hands out the same array object until it rebuilds the
// fold, so the answer is exactly as fresh as the world it was derived from and
// costs nothing to invalidate. It matters because this gate sits in front of
// every standpoint read and every telling — a 1,200-mark scan per call would be
// a tax on a question whose answer changes once a settlement.
const _hasVehicle = new WeakMap();
export const worldHasVehicle = (worldState) => {
  const marks = worldState?.marks;
  if (!Array.isArray(marks)) return false;
  const cached = _hasVehicle.get(marks);
  if (cached !== undefined) return cached;
  const has = marks.some((m) => String(m?.class ?? "") === VEHICLE_CLASS && m?.kind !== "class" && m?.subkind !== "class");
  _hasVehicle.set(marks, has);
  return has;
};

/** The vehicle a stack of occupancy puts this entity inside, or null. Pure. */
export function vehicleWithin(stack = [], worldState = null) {
  const byId = new Map((worldState?.marks ?? []).map((m) => [m.id, m]));
  for (const id of [...(stack ?? [])].reverse()) {
    const m = byId.get(id);
    if (m && String(m.class ?? "") === VEHICLE_CLASS) return id;
  }
  return null;
}

/**
 * The standpoint of a resident whose occupancy says they are inside a vehicle —
 * the hull's position, or null when they are not.
 *
 * `stack` is the occupancy chain, outermost first (enter-exit.mjs §
 * occupancyAt's own order). The caller reads it; this composes, which is the
 * same split `positions.mjs` keeps between deriving a frame and applying one.
 */
export async function vehicleStandpoint(handle, worldState, { repo = WORLD_CLONE, atMs = Date.now(), stack = [] } = {}) {
  const vessel = vehicleWithin(stack, worldState);
  if (!vessel) return null;
  const { service, mod } = await vesselServiceFrom(worldState, { repo });
  // A vehicle whose body this world's timetable does not move has no derived
  // position, and answering one from her static anchor would be a photograph of
  // a boat — the exact failure the frame law's own header catalogues.
  if (!service || !mod || service.vessel?.markId !== vessel) return null;
  const v = await vesselPositionAt(worldState, atMs, { repo });
  if (!v) return null;
  return {
    handle, x: v.x, y: v.y, placed: true,
    source: "vehicle",
    // SITTING STILL. `moving` means "a leg you declared is still in progress",
    // and a rider has declared no leg — the ride is a timer, not a road. The
    // HULL may be under way, and `provenance` is where that is said.
    moving: false, remaining_m: 0,
    aboard: true, frame: vessel, frame_offset: { x: 0, y: 0 },
    provenance: v.moving ? "carried" : "aboard",
    narration: `aboard ${vessel}${v.moving ? ", under way on her timetable" : `, alongside${v.atStop ? ` at ${v.atStop}` : ""}`}`,
    mark_id: vessel, vehicle: vessel,
  };
}

// ── the store's own movement record ──────────────────────────────────────────

/**
 * Every movement this entity has declared into the RECORD, oldest first, in the
 * shape `walk.mjs` and `vessel.mjs` read.
 *
 * POS-154, Everything Reads the Store: this folded the sqlite `movements` table
 * and it reads `acts` now, through the read worker's one road
 * (`world2-guards § storeDepartureRows`). There is no sqlite open left under it
 * and no flag over it — a switch would be the office keeping two answers to one
 * question.
 *
 * Never throws, for the reason the sqlite read did not: an unreachable record
 * must not be able to unplace a resident whose ledger line is sitting right
 * there in the world repo. The caller DISCLOSES `absent` instead, and it is
 * never a silent `[]` — an office pointed at no record and a pool that will not
 * answer both come back with a reason attached.
 *
 * ⚑ ASYNC NOW, and the un-awaited form is silent: `read.records` on a Promise is
 * `undefined`, which reads downstream as "this town has never walked". The four
 * callers await it and a source pin in `test/walkers-read-the-store.test.mjs`
 * holds the sqlite open out.
 */
export async function storedDepartures({ atMs = Date.now(), withActId = false } = {}) {
  try {
    const { storeDepartureRows } = await import("./world2-guards.mjs");
    const { records } = await storeDepartureRows();
    const cut = [];
    for (const r of records) {
      // THE CUT IS ON THE RECORD'S OWN INSTANT, never on `acts.at`. They are not
      // the same quantity — a journal-era payload carries its own `at`, one level
      // down — which is the reason `/world2/walks` also cuts its window on the
      // DERIVED rows rather than in SQL.
      const ms = Date.parse(r.iso);
      // REFUSED BY NAME, NEVER SKIPPED. A record whose instant will not parse
      // cannot be placed inside or outside the cut, and dropping it silently
      // would answer with a history short by exactly the rows nobody looks for.
      // Measured 0 of prod's 2,397 on 2026-09-21; if that ever stops being true
      // the doors say so rather than quietly shrinking.
      if (!Number.isFinite(ms)) {
        return { records: [], absent: `a departure record carries an unreadable instant: ${String(r.iso).slice(0, 60)}` };
      }
      if (ms > atMs) continue;
      cut.push({
        // THE LEDGER'S OWN SHAPE, so a merged list is one vocabulary — and the
        // port's own bookkeeping (`line`, `era`, `act_id`) is dropped here rather
        // than passed on. `era` is the trap: the name collides with the era
        // `recordsAcrossEras` stamps and carries a different vocabulary
        // (`journal`/`movement-store` against `store`/`ledger`), so a
        // pass-through would re-key `dedupeRecords` in silence.
        iso: r.iso, handle: r.handle,
        from: r.from, toward: r.toward, at: r.at,
        targetExtent: r.targetExtent ?? null, targetMarkId: r.targetMarkId ?? null, pace: r.pace ?? null,
        // LOAD-BEARING, not decoration. `recordsAcrossEras` maps era one with
        // `era: r.source === "store" ? "store" : "ledger"`, `dedupeRecords` keys
        // on that era, and `dynamic-presence.mjs` puts `era: "store"` in front of
        // a resident off this exact value.
        source: "store",
        // OPT-IN, AND OFF BY DEFAULT, so not one of the four standing callers
        // sees a key it did not see yesterday. `act_id` is the register's own
        // row id and the only monotone sequence this record carries — POS-196's
        // `storedDepartureEvents` needs it for the `<N>.jsonl` line's `seq`, and
        // it is asked for by name rather than leaked to everybody, because the
        // block above is a deliberate list of what this road does NOT pass on
        // and a silent addition would make that list a lie.
        ...(withActId ? { act_id: r.act_id ?? null } : {}),
      });
    }
    return { records: cut, absent: null };
  } catch (e) {
    // THE CAUSE IS CARRIED, NOT SWALLOWED. `GuardsUnreachableError` says the same
    // ruled sentence to every resident whatever went wrong ("the office's record
    // cannot be reached"), and it puts the real reason on `cause`. A disclosure
    // that printed only the outer sentence would send an operator looking at the
    // pool when the office is simply pointed at no record.
    const why = e?.cause?.message ? `${e.message} (${e.cause.message})` : String(e?.message ?? e);
    return { records: [], absent: why.slice(0, 200) };
  }
}

/** One entity's stored records, oldest first. The per-handle slice of the above. */
export async function storedRecordsFor(handle, opts = {}) {
  return (await storedDepartures(opts)).records.filter((r) => r.handle === handle);
}

/** The single governing record — the last one. Kept for surfaces that want only that. */
export async function storedDepartureFor(handle, opts = {}) {
  return (await storedRecordsFor(handle, opts)).at(-1) ?? null;
}

// ── POS-196 · THE WORLD REPO'S DEPARTURE RECORD, RENDERED FROM THE STORE ─────
//
// `STATE/log/<N>.jsonl` is the world repo's departure record and the only live
// source the three world-repo readers have (`tools/movement-records.mjs §
// storeRecords`, and `boarding-flip-disclosure.mjs` /
// `position-seed-manifest.mjs` through it). It was written from
// `dynamic.db/movements` — the REVERSE-MIRROR copy, stamped
// `"source":"dynamic.db/movements"` on all 2,857 of its lines — so when G1
// removed that mirror the record would have stopped and the readers fallen back
// to the frozen ledger era.
//
// This is the same record rendered from `acts`, through POS-154's one road, so
// the swap is a change of WRITER and not of meaning. It emits world.db's
// `events` row shape — exactly what `dynamic-entities.mjs § readMovements`
// emitted — so `mergedDepartureEvents`, `governingAt`, `buildSave` and every
// replay read the two eras through one vocabulary and the seam stays invisible.
//
// ⚑ THE SWAP IS WIRED (POS-156 part 0, 2026-09-22). Both write paths that
// rendered the live era from the mirror now render it from here:
// `tools/crossing-save.mjs`'s `<N>.jsonl` half and `src/dynamic-entities.mjs §
// refreshEntities`. `crossing-save --check` diffs the rendered window against
// the file on `RECORD_READ_FIELDS`; `test/pos-156-the-record-is-written-from-
// the-store.test.mjs` pins which table each write path reads.
//
// IT WAS HELD FOR TWO LANES, and the reason is worth keeping: POS-196 built
// this renderer and could not wire it because the register held no departure
// INSTANT — `acts.at` was the MIRROR's clock, taken after the resident
// declared, and `acts.crossing` is a different read that reconstructs the true
// instant exactly ZERO times across the record's own 2,808 live door-written
// lines. `at` is the first field every world reader reads. POS-198 closed it:
// `world.mjs § walkViaOffice` reads the declaration clock ONCE and hands the
// same string to both pens, so `acts.at` is the departure's own instant. Rows
// written before that carry the mirror's clock; `world2/tools/
// backfill-departures.mjs` was always correct on this point (`at: m.at`).

/**
 * What the register cannot give back, named once so a `--check` line and a PR
 * table say the same words. The shape is POS-155's (`world2/tools/
 * state-log-write.mjs § GAP_CLASSES`) because it is the same problem one file
 * over, and a second vocabulary for it would be the third copy of a merge rule.
 */
export const DEPARTURE_GAPS = Object.freeze({
  at: "STOP:at — the recorded instant and the register's disagree, and `at` is the field `storeRecords` reads first and the key `mergedRecords` orders and cuts on, so this outranks every other gap in the one line a reader gets. CLOSED FOR ROWS WRITTEN SINCE POS-198 (2026-09-22): `world.mjs § walkViaOffice` reads the declaration clock ONCE and hands the same string to both pens, so `acts.at` is the departure's own instant. IT REMAINS THE CLASS FOR OLDER ROWS: before that, `walkEntry` passed no `writtenAt` and `world-journal.mjs § normalizeRow` stamped `acts.at` with the MIRROR's clock, taken after the resident declared — and `acts.crossing` is a different read of the same door call, which reconstructs the instant exactly ZERO times across the record's own 2,808 live door-written lines (windows 120–204: median −203 ms, 235 missing by more than a second, the worst by 10.6 hours). `world2/tools/backfill-departures.mjs` is the one older path whose acts DO carry it (`at: m.at`).",
  seq: "gap:seq — no store source for the `movements` rowid; this is the register's own act id, which is the same monotone quantity the old `seq` was (dynamic-entities.mjs § readMovements: \"here it is the store's own sequence\").",
  declared_by: "gap:declared_by — the departure act carries no declarer. `walkEntry`'s payload has five keys and none is it, and `world2/tools/backfill-departures.mjs § departureRowFrom` SELECTs the column and drops it. The act's own actor stands for it, which is what the live write path puts in that column (2,829 of 2,829 door-written lines); the 28 that differ are the 2026-08-10 `ledger-freeze` one-off, in windows 119/120.",
  note: "gap:note — the departure act carries no note. The record's grammar already makes the key conditional, and the only 28 lines that carry one are the same freeze backfill.",
  source: "gap:source — the allowed stamp diff: `\"acts\"` where the mirror wrote `\"dynamic.db/movements\"`. No world reader reads it; it is the line's own provenance.",
  unexplained: "UNEXPLAINED — not one of the named gaps.",
});

/**
 * THE FIELDS THE WORLD ACTUALLY READS, measured read-only in the world clone at
 * `origin/main` @ `17fa4195` (POS-196 finding 4). `tools/movement-records.mjs §
 * storeRecords` keeps `ev.type === "departure"` and takes these and nothing
 * else; `boarding-flip-disclosure.mjs` and `position-seed-manifest.mjs` inherit
 * it through `storeRecords` rather than opening the directory themselves.
 *
 * Byte-equality is judged HERE and not on the whole line, because a record is
 * equal when every reader of it cannot tell — and `seq`, `declared_by`, `note`
 * and `source` have no reader in that repo.
 */
export const RECORD_READ_FIELDS = Object.freeze([
  "at", "type", "actor",
  "payload.from", "payload.toward", "payload.crossing",
  "payload.within", "payload.to", "payload.pace",
]);

/**
 * The store's departures in world.db's `events` row shape, oldest first.
 *
 * Returns `{ events, absent }` and NEVER throws, for `storedDepartures`' own
 * reason: an unreachable register must not be able to write an empty window
 * over a good one. `absent` is a sentence; the caller decides whether it is a
 * disclosure or a refusal, and `crossing-save` treats it as a refusal because
 * the thing it would otherwise commit is a public file.
 *
 * ⚑ ERA ONE IS NOT HERE, and it must not be. `storeDepartureRows` filters
 * `payload->>'_ledger'`, and the caller already holds the founding era from
 * `readDepartureEvents` (world.db's hydrated ledger). Returning it here would
 * hand `mergedDepartureEvents` the same departure twice under two era tags,
 * where latest-wins would pick whichever sorted last.
 *
 * ⚑ NOT POINTED AT A REGISTER IS NOT AN EMPTY RECORD. `world2Enabled()` false
 * is this office having no register at all — the same condition `movementV2Enabled()`
 * false named on the old road, and the same answer `world2-guards §
 * standsRowsFromStore` gives it ("null is 'I could not look', never 'the answer
 * is none'"). It comes back as `absent`, never as `[]`, so no caller can read
 * "no register" as "nobody has walked".
 */
export async function storedDepartureEvents({ atMs = Date.now() } = {}) {
  const { world2Enabled } = await import("./world2-acts.mjs");
  if (!world2Enabled()) {
    return { events: [], absent: "WORLD2_PG/WORLD2_PG_URL are unset — this office is not pointed at the record, which is not the same as a record with no departures in it" };
  }
  const { records, absent } = await storedDepartures({ atMs, withActId: true });
  if (absent) return { events: [], absent };
  return { events: records.map(departureEventOf), absent: null };
}

/**
 * ONE RECORD → ONE `<N>.jsonl` DEPARTURE LINE, in the record's own grammar.
 *
 * The grammar is finding 1's, measured on all 2,870 departure lines in the
 * world clone: top keys `at,type,actor,seq,payload` and payload keys
 * `from,toward,crossing,within,to,pace,declared_by,source`, in that order on
 * every one of them. Key ORDER is part of the bytes, so the object literal's
 * order is the record's order and neither may be sorted.
 *
 * `payload` is a STRING here because that is what `readMovements` handed back
 * and what `departureFromEvent` and `buildSave` both already parse — one
 * vocabulary, and the seam stays a change of pen.
 */
export function departureEventOf(r) {
  return {
    seq: r.act_id == null ? null : Number(r.act_id),   // DEPARTURE_GAPS.seq
    at: r.iso,                                          // DEPARTURE_GAPS.at — the STOP
    actor: r.handle,
    type: "departure",
    payload: JSON.stringify({
      from: r.from,
      toward: r.toward,
      crossing: r.at,
      within: r.targetExtent ?? null,
      to: r.targetMarkId ?? null,
      pace: r.pace ?? null,
      declared_by: r.handle,                            // DEPARTURE_GAPS.declared_by
      source: "acts",                                   // DEPARTURE_GAPS.source
    }),
  };
}

/**
 * One entity's records across BOTH eras, oldest first.
 *
 * The frozen ledger is the founding era and the store is era two; ordering by
 * instant with the store winning a tie is what lets the seam be a change of pen
 * rather than a change of meaning. `ledgerRecords` is injected because the
 * office already owns three ways to read the walk record and this module must
 * not become a fourth.
 */
export function recordsAcrossEras(ledgerRecords = [], storeRecords = []) {
  // APPENDED, NOT SORTED, and the reason is era one's own law: the walk ledger
  // is append-only and "latest wins" means latest APPENDED — which the engine
  // implements as the last match in array order. File order and instant order
  // disagree in the real ledger (the 08-08 sailing filed every passenger at
  // 18:00:00.000Z and those lines were appended after walks stamped 18:16), so
  // re-sorting here would silently re-decide which leg governs a resident. A
  // reader may not do that. Era one keeps its order; era two follows, which is
  // correct because every store record postdates the freeze.
  return dedupeRecords([
    ...ledgerRecords.map((r) => ({ ...r, era: r.source === "store" ? "store" : "ledger" })),
    ...storeRecords.map((r) => ({ ...r, era: "store" })),
  ]);
}

/**
 * THE SAME EVENT, ARRIVING TWICE, IS ONE EVENT.
 *
 * The caller of `recordsAcrossEras` takes an injected `recordsOf` and then adds
 * the store's records itself — and since the doors began passing ERA-SPANNING
 * records in (`world.mjs § departuresAcrossEras`, the fix for reads that could
 * not see era two), the store half can arrive twice. The fold reads only the
 * last record, so that is harmless today, the way a duplicated line in a ledger
 * is harmless right up until something counts the lines.
 *
 * So the duplicate dies here rather than being reasoned about at each call site.
 * The key is the whole record, not just the instant: the ceremony lines all
 * share one ISO across different handles, and a resident may legitimately
 * declare two legs in one millisecond even if nobody ever has. Two records that
 * agree on era, handle, instant, origin and destination are one record that was
 * read twice.
 */
export function dedupeRecords(records) {
  const seen = new Set();
  const out = [];
  for (const r of records) {
    const k = [r.era, r.handle, r.iso, r.from?.x, r.from?.y, r.toward?.x, r.toward?.y, r.at].join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

// ── the standpoint, under the frame law ──────────────────────────────────────

/**
 * Where an entity stands, with carriers running and frames composing.
 *
 *   1. A CARRIER answers from its own mechanic — the timetable, never a ledger.
 *   2. EVERYONE ELSE is the fold over their own movement records, which since
 *      POS-247 is always the world frame: the road's end, or the road mid-leg.
 *      A rider's hull position is occupancy's, asked before this is.
 *
 * There is no third case and no floor beneath it, which is the shape of the
 * change: the ceremony needed a fallback because a declaration could be absent,
 * and a frame cannot be — the world is the default.
 *
 * `recordsOf(handle)` is injected. `storeRecordsOf(handle, atMs)` replaces the
 * store read: `residentStandpoint` over the positions projection (POS-272)
 * already holds era two and passes `async () => []`. Returns null when the flag's machinery cannot
 * answer (no carrier in this world, no engine), which is the caller's signal to
 * use the derivation it has always used.
 */
export async function movementStandpoint(handle, worldState, {
  repo = WORLD_CLONE, atMs = Date.now(), recordsOf = null, storeRecordsOf = null,
} = {}) {
  const { service, mod } = await vesselServiceFrom(worldState, { repo });
  if (!service || !mod) return null;

  if (handle === service.vessel.handle) {
    const v = mod.vesselPositionAt(service, mod.fractionalCrossing(atMs));
    if (!v) return null;
    return {
      handle, x: v.x, y: v.y, placed: true, source: "timetable",
      moving: !v.berthed, remaining_m: 0,
      aboard: false, frame: null, provenance: "timetable",
      narration: v.berthed ? `berthed at ${v.atStop}` : "under way on her timetable",
      mark_id: v.atStop ?? null, vessel: true,
    };
  }

  const ledgerRecords = recordsOf ? (await recordsOf(handle)) ?? [] : [];
  const storeRecords = storeRecordsOf
    ? (await storeRecordsOf(handle, atMs)) ?? []
    : await storedRecordsFor(handle, { atMs });
  const records = recordsAcrossEras(ledgerRecords, storeRecords);
  if (!records.length) return null;

  const walk = (await vesselServiceFrom(worldState, { repo })).walk;
  const fold = foldFrames(records);

  // A leg still under way is still under way — the frame law governs WHERE you
  // are, not whether you have got there. The world's own `positionAt` owns that,
  // and asking it here keeps one arithmetic for the road.
  const last = records.at(-1);
  const own = walk.positionAt(last, walk.fractionalCrossing(atMs));
  const moving = own?.arrived === false;

  // ── AN ARRIVED WALKER STANDS WHERE THE ROAD ENDED ─────────────────────────
  //
  // Founder-ruled 2026-09-11, beside "ring wins everywhere". This line used to
  // read `moving ? own : fold.world` — mid-leg the road owns the position,
  // arrived, the frame does — and for anyone ASHORE that handed the answer to
  // `foldFrames`, whose answer is the record's `toward`: for a rim walk, the
  // MARK'S ANCHOR. So two functions answered "where is wright" with two
  // different points. `positionAt` put him at his rim arrival, (1022.3, -1669);
  // the standpoint put him at the terrace's anchor, (967, -2450.5), 783 m away —
  // and the enter door, which measures from the standpoint, let him through a
  // door he was nowhere near, because `enterExitPlan` saw him already inside and
  // never set `walk`, so the doorstep check had nothing to run on.
  //
  // So the road's end is the answer. A walk never boards (POS-247), so there is
  // no carrier frame to compose through here; a rider's hull position comes from
  // occupancy, which `residentStandpoint` asks before it reaches this function.
  // `own` is null only when the clone's `positionAt` could not read the last
  // record at all, and a standpoint that threw over that would be worse than a
  // coarse one — the fold still has an answer, so it is still given.
  const stand = own ?? fold.world;

  return {
    handle,
    x: stand.x,
    y: stand.y,
    placed: true,
    source: "walk",
    moving,
    remaining_m: moving ? own.remainingM : 0,
    aboard: false,
    frame: null,
    frame_offset: null,
    provenance: "walked",
    transitions: [],
    narration: moving ? "the road — your walk in progress" : null,
    mark_id: last.targetMarkId ?? null,
  };
}

// ── hearing, through the frame chain ─────────────────────────────────────────

/**
 * Where a voice is heard FROM.
 *
 * An emission's frame is its source; frames compose (voice → speaker → carrier).
 * The interim rule in `voices.mjs` reads a boolean the speaker's standpoint set
 * (`v.aboard`) and relocates that voice to the vessel; this finds the carrier
 * the voice was spoken ON (a moving carrier's footprint at the instant it was
 * spoken) and relocates through her frame.
 *
 * The difference shows the day a second thing moves. `v.aboard` can only ever
 * mean "the Post Office"; a frame names its carrier, so a voice spoken on a cart
 * rides the cart with no code at all. That is why this supersedes rather than
 * wraps.
 *
 * Returns `{ x, y, frame }` — the point to hear it from — or null, meaning
 * "heard where it was spoken", the ordinary case for everyone ashore.
 *
 * NO WALK RECORD IS READ (POS-261). This used to fold the speaker's records at
 * the instant they spoke and relocate through the frame it found, but a walk
 * never boards (POS-247): the fold answered the world frame for every speaker,
 * so the position floor below was the whole answer, and the record reads per
 * voice bought nothing.
 */
export async function heardFromV2(voice, worldState, { repo = WORLD_CLONE, atMs = Date.now() } = {}) {
  const { service, mod, carriers } = await vesselServiceFrom(worldState, { repo });
  if (!service || !mod || !carriers.length) return null;
  const spokenMs = Number(voice?.at);
  if (!Number.isFinite(spokenMs)) return null;
  const carrierAt = carrierReader(worldState, { repo, service, mod });

  let frame = null, local = null;
  // THE POSITION FLOOR. A voice spoken from inside a carrier's footprint while
  // she was under way was spoken ON HER, whatever the records say — the
  // coordinates in the log are the fact, and a record the office cannot read
  // must not silently move a conversation off the deck it happened on.
  for (const c of carriers) {
    const st = await carrierAt(c, spokenMs);
    if (st && st.moving && inRect({ x: voice.x, y: voice.y }, st.footprint)) {
      frame = c;
      local = { x: voice.x - st.at.x, y: voice.y - st.at.y };
      break;
    }
  }
  if (!frame) return null;

  const now = await carrierAt(frame, atMs);
  if (!now) return null;
  return { x: now.at.x + (local?.x ?? 0), y: now.at.y + (local?.y ?? 0), frame: frame.id };
}

// ── the walk answer's boundary terms ─────────────────────────────────────────

/**
 * What a proposed leg crosses, and what binds there — for the walk answer,
 * before the step. Plus the gunwale warning when the step leaves a moving
 * carrier. Both are DISCLOSURE, never refusal: v0 water does not block.
 */
export async function roadTerms({ handle, from, toward, worldState, repo = WORLD_CLONE, atMs = Date.now(), recordsOf = null }) {
  const { service, mod, carriers } = await vesselServiceFrom(worldState, { repo });
  if (!service || !mod || !carriers.length) return null;
  const carrierAt = carrierReader(worldState, { repo, service, mod });

  const here = await movementStandpoint(handle, worldState, { repo, atMs, recordsOf });
  const frameCarrier = here?.frame ? carriers.find((c) => c.id === here.frame) ?? null : null;

  const crossings = await boundariesOnRoad(from, toward, carriers, atMs, { carrierAt, mod, service });
  const warning = await gunwaleWarning(frameCarrier, toward, atMs, { carrierAt });
  if (!crossings.length && !warning) return null;
  return { crosses: crossings, ...(warning ? { leaving: warning } : {}) };
}

// ── the operator's surface ───────────────────────────────────────────────────

export async function movementHealth(worldState, { repo = WORLD_CLONE, atMs = Date.now() } = {}) {
  const { service, carriers, errors, reason } = await vesselServiceFrom(worldState, { repo });
  const v = service ? await vesselPositionAt(worldState, atMs, { repo }) : null;
  return {
    enabled: movementV2Enabled(),
    flags: { WORLD_MOVEMENT_V2: process.env.WORLD_MOVEMENT_V2 ?? null },
    carriers: (carriers ?? []).map((c) => ({ id: c.id, mobility: c.mobility, class: c.className, declared_by: c.declaredBy })),
    carrier_source: (await vesselServiceFrom(worldState, { repo })).carrierSource ?? null,
    disclosed: (await vesselServiceFrom(worldState, { repo })).disclosed ?? [],
    service: service
      ? { mark: service.markId, vessel: service.vessel.markId, pace_km_per_crossing: service.pace, stops: service.stops.map((s) => s.markId) }
      : null,
    service_absent_reason: reason ?? null,
    schedule_errors: errors ?? [],
    vessel_now: v ? { x: v.x, y: v.y, berthed: v.berthed, at_stop: v.atStop } : null,
    evaluated_at: new Date(atMs).toISOString(),
  };
}

// ── DEC-5, THE WALK GUARD (founder-ruled 2026-09-03) ──────────────────────────
//
// The law, planted first as the-town/the-occupancy-invariant (a clause of the
// enter class): "You occupy a mark only by entering, and only while your feet
// stand inside it; a walk that would carry you out is refused until you exit."
// Occupancy implies geometry, never the reverse. The founder's words: "prevent
// walking out of the geometry of a mark without exiting … and make enter
// voluntary even if you're technically standing in a geometric region."
//
// Pure: given the resident's occupancy stack (outermost first, innermost last —
// enter-exit.mjs § occupancyAt's own order), the destination point, and the
// clone's own point-in-mark test, answer the marks the walk would carry the
// occupant OUT of, innermost first. Empty = the walk is lawful as it stands.
// A walk INTO a footprint never enters (R15: "walk … NEVER implies entry") — so
// only the leaving direction is guarded, which is exactly the asymmetry ruled.
export function leavingWhileOccupying(stack, toward, pointWithinMark) {
  const out = [];
  for (const markId of [...(stack ?? [])].reverse()) {
    if (!markId) continue;
    let inside = null;
    try { inside = pointWithinMark(toward, markId); } catch { inside = null; }
    if (inside === null || inside === undefined) continue; // the clone cannot answer for this mark — nothing to refuse on
    if (!inside) out.push(markId);
  }
  return out;
}
