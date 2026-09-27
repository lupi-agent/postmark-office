// world-frames.mjs — THE FRAME LAW (ruled 2026-08-10, Keemin + Wright).
//
//   Everything has a reference frame. An entity's frame is the deepest CARRIER
//   it is within; the world is the default frame. Position is always an offset
//   in your frame.
//
// This file replaces Stage D's first answer — a declared attachment, validated
// by presence at a cast-off instant — and the replacement is smaller than what
// it replaces. The ceremony had three moving parts (a declaration act, a
// validation rule, a lapse rule) and one hard question it kept re-asking: was
// this person aboard AT THE MOMENT SHE SAILED. The frame law has one part and
// never asks that question, because there is no such moment: you are carried if
// your frame is the carrier when it moves, and it does not matter when that was.
//
// FOUR SENTENCES DO ALL THE WORK.
//
//   1. A CARRIER IS CLASS-DECLARED. `mobility: derived|free` on the class. A
//      district never carries; a vessel does. Nothing here knows the word
//      "boat" — see `carriersFrom`, which reads the Keeping Works.
//
//   2. A WALK NEVER BOARDS. Keemin, 2026-09-26: "simply 'walking aboard'
//      shouldn't put you on the boat anymore." You board a carrier only
//      through a stop's door (#2986, Keemin-ruled 2026-09-19: aboard is
//      occupancy, read off the enter-exit ledger). A walk that ends on her
//      deck leaves you on the quay beside her. What a walk still does is END
//      a frame: a step that lands outside her footprint is stepping off.
//
//   3. CARRIAGE IS NOTHING HAPPENING. She sails, your offset holds, you moved.
//      This is what relative coordinates were for — the keystone rides the
//      house and the passenger rides the boat by one arithmetic.
//
//   4. ENTITIES ARE POINTS. A point is in exactly one frame, so the straddler
//      question never arises and there is no straddle logic anywhere below.
//
// WHERE THE FRAME IS EVALUATED, and why it is the endpoint. A movement record
// is declared in the frame the entity is standing in, and the frame is re-decided
// AT ARRIVAL. Since 2026-09-26 the only frame change a walk can make is the
// ending of one: an endpoint outside her footprint steps you off, and an endpoint
// on her deck — from ashore — boards nobody (ruling 2 above). The arrival
// instant keeps the derivation total and replayable —
// no continuous crossing-solve, no sampling rate to argue about, same answer in
// every clone.
//
// NO NEW STORAGE. Frame edges are DERIVED by the one fold below, from the
// movement records that already exist. They are reported as events (the
// `happened` shelf) by filtering the fold's own transitions — never by a second
// table that could disagree with the records it was built from.

import { DatabaseSync } from "node:sqlite";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { OFFICE_ROOT, WORLD_CLONE } from "./world-store.mjs";

/** The world itself — the default frame, and the only one with no carrier. */
export const WORLD_FRAME = Object.freeze({ carrier: null, at: { x: 0, y: 0 } });

/** The mobilities that make a class a CARRIER. `settled` and `fade` never carry. */
export const CARRYING_MOBILITIES = new Set(["derived", "free"]);

// A mobility-declaring class either IS the moving body or NAMES it. The
// timetable class names it (`timetable.vessel` — the wheelhouse holds the
// schedule; the boat is the thing you stand on), and a future free-moving cart
// would simply be its own body. That indirection is the ONLY per-mechanic
// knowledge in this file, and it lives in a registry for the reason the edge-type
// registry exists: a new mechanic costs one line, and the taxonomy cannot
// sprawl silently because the line has to be written.
export const MECHANIC_BODY = Object.freeze({
  timetable: (mark) => mark?.timetable?.vessel ?? null,
});

// ── the class fields, from where they actually reach this office ─────────────
//
// Three rungs, `soundClass`'s exactly, because it is the same problem: a class
// mark stands in the world repo and the office needs a field off it.
//
//   fold carries `mobility`      the fold governs; this read never happens
//   store readable               the store governs, and says so
//   neither                      NO CARRIERS, and it is DISCLOSED BY NAME
//
// The third rung is the one worth writing down. Zero carriers is a perfectly
// well-formed answer — most worlds have none — and it is also exactly what a
// broken read looks like. So the absence is reported rather than returned as an
// empty list, and a caller that ignores the disclosure at least cannot say it
// was not told.

let _classSnap = null;

/** `mark id -> { class, mobility }` for every mark the store knows, cached on the file. */
export function classFieldsFromStore({ worldDb = null } = {}) {
  const path = worldDb ?? process.env.WORLD_STORE_DB ?? join(OFFICE_ROOT, "world.db");
  let st;
  try { st = statSync(path); }
  catch { return { fields: null, gate: { status: "ABSENT", reason: "store-absent", detail: `no world store at ${path} — run: npm run hydrate:world` } }; }
  if (_classSnap && _classSnap.path === path && _classSnap.mtimeMs === st.mtimeMs && _classSnap.size === st.size) return _classSnap.out;

  let out;
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    const status = db.prepare("SELECT value FROM meta WHERE key='hydration_status'").get()?.value ?? null;
    if (String(status ?? "").startsWith("FAILED")) {
      db.close();
      out = { fields: null, gate: { status: "ABSENT", reason: "store-failed", detail: String(status) } };
    } else {
      const rows = db.prepare("SELECT id, props FROM nodes WHERE kind='mark'").all();
      db.close();
      const fields = new Map();
      for (const r of rows) {
        try {
          const p = JSON.parse(r.props ?? "{}");
          if (p.class || p.mobility) fields.set(r.id, { class: p.class ?? null, mobility: p.mobility ?? null });
        } catch { /* a bent props blob is one mark, not the whole read */ }
      }
      out = { fields, gate: { status: "PRESENT", reason: null, detail: `${fields.size} class-bearing marks from ${path}` } };
    }
  } catch (e) {
    out = { fields: null, gate: { status: "ABSENT", reason: "store-unreadable", detail: String(e?.message ?? e).slice(0, 200) } };
  }
  _classSnap = { path, mtimeMs: st.mtimeMs, size: st.size, out };
  return out;
}

/** Drop the cached class read — for tests that rewrite world.db in place. */
export function resetClassFieldsCache() { _classSnap = null; }

/**
 * Carriers, with the disclosure attached. This is what callers should use;
 * `carriersFrom` is the pure half beneath it.
 */
export function carriersWithDisclosure(worldState, { worldDb = null } = {}) {
  const foldDeclares = (worldState?.marks ?? []).some((m) => m.mobility);
  if (foldDeclares) {
    const carriers = carriersFrom(worldState);
    return { carriers, source: "fold", disclosed: [] };
  }
  const { fields, gate } = classFieldsFromStore({ worldDb });
  const carriers = carriersFrom(worldState, { classFields: fields });
  const disclosed = [];
  if (!fields)
    disclosed.push(`carrier-classes-unreadable: the fold carries no \`mobility:\` and the store could not supply it (${gate.reason} — ${gate.detail}). No mark can be a carrier, so nothing in this world carries anyone.`);
  else if (!carriers.length)
    disclosed.push("no-carriers: the class marks were read and none declares `mobility: derived` or `free` — this world moves nobody, which is a legitimate world and not an error");
  return { carriers, source: fields ? "store" : "none", gate, disclosed };
}

/**
 * Every carrier in this world, class-generic.
 *
 * Reads the Keeping Works the way the store does: a class mark declares
 * `class:` and `mobility:`, an instance implements it through `mechanic:`. A
 * mark governed by a carrying class is a carrier — or names the body that is.
 */
export function carriersFrom(worldState, { classFields = null } = {}) {
  const marks = worldState?.marks ?? [];
  // THE FOLD DROPS THE FIELDS THAT MAKE A CLASS LAW. `WORLD/world-state.json` —
  // the office's world — carries `mechanic:` and `timetable:` but not `class:`
  // or `mobility:`, so a carrier read from the fold alone finds nothing and a
  // world where nobody is ever carried looks exactly like a working one. That is
  // the same gap `dials:` had before the hydrator learned to carry the class
  // fields, and it is answered the same way: the store is where the class marks
  // reach this office, and `classFields` is that read, injected.
  //
  // The fold WINS when it has the field, so the day the world's generator emits
  // `mobility:` nothing here changes and the injection quietly stops mattering.
  const byId = new Map(marks.map((m) => [m.id, m]));
  const fieldsFor = (id) => classFields?.get?.(id) ?? null;
  const fieldOf = (m, name) => m[name] ?? fieldsFor(m.id)?.[name] ?? null;

  // class name -> mobility, from the class marks themselves.
  const mobilityOfClass = new Map();
  for (const m of marks) {
    const cls = fieldOf(m, "class"), mob = fieldOf(m, "mobility");
    if (cls && mob) mobilityOfClass.set(String(cls), String(mob));
  }

  const out = [];
  const seen = new Set();
  for (const m of marks) {
    // A mark's governing class: the one it declares, else the one its mechanic
    // names. (The wheelhouse is both — every class is itself a mark.)
    const declared = fieldOf(m, "class");
    const className = declared ? String(declared) : (m.mechanic ? String(m.mechanic) : null);
    if (!className) continue;
    const own = fieldOf(m, "mobility");
    const mobility = own ? String(own) : mobilityOfClass.get(className) ?? null;
    if (!mobility || !CARRYING_MOBILITIES.has(mobility)) continue;

    // A MECHANIC IS WHAT MAKES A MARK DO SOMETHING. Classes are law, instances
    // are the world — and a bare class mark declares what its instances do
    // without doing it itself. `the-town/entity` says `mobility: free`, meaning
    // *entities* move freely; it is also a 50×40 building in the Keeping Works,
    // and without this line everyone standing in that building would be read as
    // riding it. The wheelhouse passes because it carries `mechanic: timetable`
    // — it is the rare mark that is both a class and the one instance of itself.
    if (!m.mechanic) continue;

    const bodyOf = MECHANIC_BODY[m.mechanic ?? className];
    const bodyId = bodyOf ? bodyOf(m) : m.id;
    const body = bodyId ? byId.get(bodyId) : null;
    if (!body || seen.has(body.id)) continue;
    // A carrier must have a footprint — the boundary IS the law, and a body with
    // no extent has no inside to be in.
    if (!body.extent || !(body.extent.w > 0) || !(body.extent.h > 0)) continue;
    seen.add(body.id);
    out.push({
      id: body.id, mobility, mechanic: m.mechanic ?? null,
      declaredBy: m.id, className,
      extent: { w: body.extent.w, h: body.extent.h },
    });
  }
  return out;
}

/**
 * Where a carrier's body is, and its footprint, at an instant.
 *
 * `derived` mobility means position = f(timetable, clock), which is the world's
 * own `tools/vessel.mjs`. `free` mobility would read the store; nothing in the
 * town has it yet, and inventing a reader for it now would be a guess with no
 * instance to check against — so it answers null and says so rather than
 * pretending.
 */
export async function carrierStateAt(carrier, worldState, atMs, { repo = WORLD_CLONE, service = null, mod = null } = {}) {
  if (carrier.mobility === "derived") {
    if (!service || !mod) return null;
    const v = mod.vesselPositionAt(service, mod.fractionalCrossing(atMs));
    if (!v || !Number.isFinite(v.x)) return null;
    return {
      at: { x: v.x, y: v.y },
      footprint: { x: v.x, y: v.y, w: carrier.extent.w, h: carrier.extent.h },
      moving: !v.berthed, atStop: v.atStop ?? null, sailing: v.sailing ?? null,
    };
  }
  return null;
}

/**
 * THE FOLD. One entity's frame history, from its own movement records.
 *
 * This is the single derivation the design invariant demands — "one question,
 * one derivation, every surface calls it" (learned twice: Hal's
 * one-town-three-answers, and issue #7's present-vs-walkers). Every surface that
 * wants a position, a frame, or a frame event calls THIS and reads a different
 * field of the same answer.
 *
 * `records` are the entity's departures in order, oldest first, each in
 * walk.mjs's shape. `carrierAt(carrier, ms)` yields the carrier's state at an
 * instant — injected so this stays pure over its inputs and a test can drive a
 * carrier along any path it likes.
 *
 * Returns `{ frame, local, world, transitions, provenance }`:
 *   frame        the carrier id you are in, or null for the world
 *   local        your offset IN that frame
 *   world        your composed world position
 *   transitions  every frame edge born or died, with the record that did it
 *   provenance   "walked" | "carried" | "never-moved"
 */
export async function foldFrames(records, { carriers, carrierAt, walk, atMs }) {
  let frame = null;                     // null = the world frame
  let local = null;                     // offset in `frame` (or world position when frame is null)
  const transitions = [];
  let lastRecordMs = null;
  let lastArrivedMs = null;

  const composed = async (fr, off, ms) => {
    if (!fr) return off;
    const st = await carrierAt(fr, ms);
    return st ? { x: st.at.x + off.x, y: st.at.y + off.y } : off;
  };

  for (const rec of records) {
    const recMs = Date.parse(rec.iso);
    lastRecordMs = recMs;

    // A record is declared in the frame the entity is standing in, and its
    // `from`/`toward` are world coordinates as the door wrote them. Inside a
    // carrier the walk is movement WITHIN the frame, so the endpoint is taken
    // into the frame before it is judged.
    const endWorld = { x: rec.toward.x, y: rec.toward.y };
    const arriveMs = arrivalMs(rec, walk);
    lastArrivedMs = Math.min(arriveMs, atMs);

    // Only the frame you are ALREADY in is asked about. Another carrier's
    // footprint under your endpoint is the quay beside her, never her deck —
    // a walk never boards (ruling 2, Keemin 2026-09-26; dom-pidgey walked to
    // her hull at the Town Centre that morning and read aboard mid-crossing
    // while every ride door, reading the ledger, said ashore).
    // ⚑ The frame branches below (within the frame, stepped off) are unreachable since POS-247 (2026-09-26): no walk creates a frame; the ledger is the only way aboard. Removed with the fold's frame machinery in w41.
    const st = frame ? await carrierAt(frame, arriveMs) : null;
    if (st && inRect(endWorld, st.footprint)) {
      // Still aboard — a walk within the frame. The offset moves.
      local = { x: endWorld.x - st.at.x, y: endWorld.y - st.at.y };
    } else {
      // Ashore, or stepped off.
      if (frame) transitions.push({ kind: "died", carrier: frame.id, at: new Date(arriveMs).toISOString(), by: rec.iso, reason: "crossed out over her gunwale" });
      frame = null;
      local = endWorld;
    }
  }

  if (!records.length) return { frame: null, local: null, world: null, transitions, provenance: "never-moved" };

  const world = await composed(frame, local, atMs);
  // WHAT MOVED YOU LAST. Carried beats walked only when the carrier has actually
  // moved since you last arrived — otherwise a berthed boat would report every
  // passenger as "carried" while nothing had happened at all.
  let provenance = "walked";
  // ⚑ unreachable since POS-247 (2026-09-26): no walk creates a frame; the ledger is the only way aboard. Removed with the fold's frame machinery in w41.
  if (frame) {
    const then = await carrierAt(frame, lastArrivedMs ?? atMs);
    const now = await carrierAt(frame, atMs);
    if (then && now && (then.at.x !== now.at.x || then.at.y !== now.at.y)) provenance = "carried";
  }
  return { frame: frame?.id ?? null, frameCarrier: frame, local, world, transitions, provenance, lastRecordMs };
}

/** When a declared leg arrives — the world's own arithmetic, never restated here. */
function arrivalMs(rec, walk) {
  const p = walk.positionAt(rec, rec.at);           // at its own departure instant
  const legM = p?.legM ?? 0;
  const paceKm = rec.pace > 0 ? rec.pace : (walk.WALK_KM_PER_CROSSING ?? 15);
  const crossings = legM / (paceKm * 1000);
  return walk.CROSSING_EPOCH_UTC + (rec.at + crossings) * walk.CROSSING_MS;
}

/** A point in a rect, boundary inclusive — arrival lands you ON the edge, and on the edge is inside. */
export const inRect = (p, r) =>
  p.x >= r.x - r.w / 2 && p.x <= r.x + r.w / 2 && p.y >= r.y - r.h / 2 && p.y <= r.y + r.h / 2;

/**
 * Would this step leave a carrier while it is under way?
 *
 * THE GUNWALE RULE (Wright's call under delegation, v2.2 §A): physics with a
 * warning, not a constraint. The walk answer discloses the step before it is
 * taken; v0 water does not block, so the resident may take it. Tightening this
 * to a refusal is one rule later and this function is where it would go.
 */
export async function gunwaleWarning(frameCarrier, endWorld, atMs, { carrierAt }) {
  if (!frameCarrier) return null;
  const st = await carrierAt(frameCarrier, atMs);
  if (!st || inRect(endWorld, st.footprint)) return null;
  return st.moving
    ? `this step leaves ${frameCarrier.id} mid-channel — she is under way, and you will be in the water where she left you`
    : `this step takes you off ${frameCarrier.id} onto the ground beside her`;
}

/**
 * The carriers a straight road passes over, with the terms that bind there.
 *
 * "Nobody is bound by law they were not shown at the door, extended from `do:`
 * acts to feet" — so the walk answer names them before the step, not after.
 */
export async function boundariesOnRoad(from, toward, carriers, atMs, { carrierAt, mod = null, service = null }) {
  const out = [];
  for (const c of carriers) {
    const st = await carrierAt(c, atMs);
    if (!st) continue;
    const ends = inRect(toward, st.footprint);
    const starts = inRect(from, st.footprint);
    if (!ends && !starts) continue;
    const terms = [];
    if (c.mobility === "derived" && service && mod) {
      const next = mod.nextDepartures(service, mod.fractionalCrossing(atMs), 1);
      // "her timetable binds — she departs …" was said here until 2026-09-26: a
      // rider is not carried by her schedule (#2986), so her departure time is
      // nothing a walker needs; the sentence below is the whole truth.
      void next;
      terms.push("a walk that ends on her deck leaves you on the quay beside her, not aboard — you board through a stop's door: enter a stop she calls at, then ride");
    }
    out.push({
      carrier: c.id, class: c.className, mobility: c.mobility,
      ends_inside: ends, starts_inside: starts,
      terms,
    });
  }
  return out;
}
