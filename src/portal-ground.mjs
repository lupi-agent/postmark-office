// portal-ground.mjs — THE PORTAL GROUND'S OWN LAW, which outlived the arena.
//
// The arena closed on 2026-09-30 (Keemin: "the arena is not live"). The rooms
// it was played in did not: the candle vault's own entry now reads "The fight
// is over and the fight is won … this room keeps the proof", the cellar door
// still makes you "silverware-small … a stride is a quarter-metre", and the
// Lanternstep parlor asks nothing of you but your company. Residents walk them
// with no fight anywhere. So what LOGOS § The portal ground rules for a ground,
// fight or no fight, lives here, cut away from the arena module that used to
// carry it (office train/2026-w41 before the arena closed, src/arena.mjs):
//
//   the ground lookup   which portal ground a spine or a point stands in
//   the stride          `walk_min_step`: "within that ground a walk is validated
//                       and snapped at that granularity instead of the town's
//                       whole-metre step"
//   the spawn           `spawn`: a ground sets its entrants down at its own point
//   the door's answer   `standpoint.portal`: which room, its space, its stride,
//                       its body — "so a reader drawing that floor can draw the
//                       grid the door will actually accept"
//
// WHAT DID NOT COME BACK: everything that needs a fight — the wheel, the
// adversary, the placement clear of it, the loose floor, the loot shroud, the
// encounter on the read. No ground keeps a wheel now (`keeps_wheel` is false on
// every place), and no mark in the world is of class `arena` anyway.
//
// NOT THE TOWN'S OTHER PORTALS. The Snug Harbour, the Post Office boat and the
// rides are vehicles, moorings and rides (world-ride.mjs, the crossing exec),
// never `portal-ground`, and nothing here touches them.
//
// These still read world.db (the class-mark rows), like the rest of the class
// layer; moving them onto the store's graph snapshot is a part on POS-270.

import { createHash } from "node:crypto";
import { byId, jx, registerTwin } from "./world-graph-db.mjs";

/** The ground classes, innermost first. An arena IS a portal ground (`extends:
 *  portal-ground`); with the arena closed its floor keeps only the ground's law. */
export const GROUND_CLASSES = Object.freeze(["arena", "portal-ground"]);

const parseJson = (s, fallback = null) => {
  if (s == null) return fallback;
  if (typeof s === "object") return s;
  try { return JSON.parse(s); } catch { return fallback; }
};

const GROUND_ROWS = `SELECT id, by,
         json_extract(props, '$.class')  AS class,
         json_extract(props, '$.dials')  AS dials,
         json_extract(props, '$.body')   AS body,
         at_x, at_y, extent_w, extent_h
       FROM nodes WHERE id IN (SELECT value FROM json_each(?))`;

const GROUNDS_ALL = `SELECT id, by,
         json_extract(props, '$.class')  AS class,
         json_extract(props, '$.dials')  AS dials,
         json_extract(props, '$.body')   AS body,
         at_x, at_y, extent_w, extent_h
       FROM nodes
       WHERE json_extract(props, '$.class') IN ('arena', 'portal-ground')
         AND at_x IS NOT NULL AND at_y IS NOT NULL`;

// `subkind = 'class'` is a column: the hydrator stores a mark file's `kind:
// class` there, and asking props for it finds nothing, silently.
const CLASS_DIALS = `SELECT id,
         json_extract(props, '$.class') AS class,
         json_extract(props, '$.dials') AS dials
       FROM nodes WHERE json_extract(props, '$.class') IN (SELECT value FROM json_each(?))
         AND subkind = 'class'`;

// The store's snapshot answers these three too (world-graph-db.mjs), held equal
// to the SQL by test/world-graph-db.test.mjs.
const groundRow = (n) => ({ id: n.id, by: n.by, class: jx(n.p, "class"), dials: jx(n.p, "dials"), body: jx(n.p, "body"),
  at_x: n.at_x, at_y: n.at_y, extent_w: n.extent_w, extent_h: n.extent_h });
registerTwin(GROUND_ROWS, (g, idsJson) => [...new Set(JSON.parse(idsJson ?? "[]"))]
  .map((id) => g.byId.get(id)).filter(Boolean).sort(byId).map(groundRow));
registerTwin(GROUNDS_ALL, (g) => g.nodes
  .filter((n) => ["arena", "portal-ground"].includes(jx(n.p, "class")) && n.at_x != null && n.at_y != null).map(groundRow));
registerTwin(CLASS_DIALS, (g, namesJson) => {
  const names = new Set(JSON.parse(namesJson ?? "[]"));
  return g.nodes.filter((n) => names.has(jx(n.p, "class")) && n.subkind === "class")
    .map((n) => ({ id: n.id, class: jx(n.p, "class"), dials: jx(n.p, "dials") }));
});

const within = (row, g) => {
  const x = Number(row?.at_x), y = Number(row?.at_y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !g) return false;
  const gx = Number(g.at_x), gy = Number(g.at_y);
  const gw = Number(g.extent_w), gh = Number(g.extent_h);
  if (![gx, gy, gw, gh].every(Number.isFinite)) return false;
  return x >= gx - gw / 2 && x <= gx + gw / 2 && y >= gy - gh / 2 && y <= gy + gh / 2;
};

const placeOf = (row) => ({
  ground: row.id, row, class: String(row.class),
  // THE SITE'S OWN WORD for the two rooms: "an antechamber (gather, read the
  // rules of the place, form up) and the arena proper".
  space: String(row.class) === "arena" ? "arena" : "antechamber",
  keeps_wheel: false,   // the arena is closed: no ground keeps a wheel
  body: String(row.body ?? ""),
});

/** The portal ground a caller's containment spine stands in, innermost class first, or null. */
export function groundAt(db, spineIds = []) {
  if (!db || !spineIds.length) return null;
  let rows = [];
  try { rows = db.prepare(GROUND_ROWS).all(JSON.stringify([...new Set(spineIds.filter(Boolean))])); }
  catch { return null; }
  // INNERMOST FIRST (Keemin, 2026-09-30). The spine arrives outermost first,
  // and the ground a hand stands in is the DEEPEST portal ground on it. The
  // rule this replaces separated grounds by class only and kept the last row
  // the query returned, so with the parlor, the cellar door and the vault all
  // `portal-ground`, a hand in the vault was told it stood in the Lanternstep
  // parlor, with no stride (measured on S87,
  // docs/2026-09-30/rail/retire-the-arena/live-grounds.txt).
  const depth = new Map(spineIds.map((id, i) => [id, i]));
  const row = rows
    .filter((r) => GROUND_CLASSES.includes(String(r.class ?? "")))
    .sort((a, b) => (depth.get(b.id) ?? -1) - (depth.get(a.id) ?? -1))[0];
  if (row) {
    const place = placeOf(row);
    place.walk_min_step = walkMinStepOf(db, place);
    return place;
  }
  return null;
}

/** The portal ground a POINT falls in — the walk desk's question, for a click on a floor. */
export function groundAtPoint(db, point) {
  if (!db || !point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
  let rows = [];
  try { rows = db.prepare(GROUNDS_ALL).all(); } catch { return null; }
  const p = { at_x: Number(point.x), at_y: Number(point.y) };
  // Innermost for a point is the SMALLEST ground of the class that contains it:
  // the vault and the cellar door around it are both `portal-ground`, and the
  // first row out of the table would be whichever was hydrated first.
  const area = (r) => Math.abs(Number(r.extent_w) * Number(r.extent_h));
  for (const cls of GROUND_CLASSES) {
    const row = rows.filter((r) => String(r.class) === cls && within(p, r)).sort((a, b) => area(a) - area(b))[0];
    if (!row) continue;
    const place = placeOf(row);
    place.walk_min_step = walkMinStepOf(db, place);
    return place;
  }
  return null;
}

/**
 * The ground's stride, or null. NULL, NOT 1, for an undeclared ground: a floor
 * of 1 would re-cut every ground's walk to whole metres. The instance outranks
 * its class: a room may be finer than the class of rooms it belongs to.
 */
export function walkMinStepOf(db, place) {
  if (!place) return null;
  const read = (d) => {
    const n = Number(parseJson(d, null)?.walk_min_step);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const own = read(place.row?.dials ?? place.dials);
  if (own != null) return own;
  if (!db) return null;
  try {
    const row = db.prepare(CLASS_DIALS).all(JSON.stringify([String(place.class ?? place.row?.class ?? "")]))[0];
    return row ? read(row.dials) : null;
  } catch { return null; }
}

/** A metre snapped to a lattice of `step`, with the float dust taken off. */
export const snapTo = (v, step) => {
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(Number(v))) return Number(v);
  return Number((Math.round(Number(v) / s) * s).toFixed(6));
};

const rectOf = (r) => {
  const x = Number(r?.at_x), y = Number(r?.at_y);
  const w = Math.abs(Number(r?.extent_w)), h = Math.abs(Number(r?.extent_h));
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h, x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 };
};
const inRect = (p, r) => !!r && p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;

/**
 * WHAT A GROUND'S STRIDE DOES TO A WALK THAT ENDS ON IT. The DESTINATION is what
 * a resident chose, so the destination is what the room's stride governs.
 * Null when the ground has nothing to say, so a town with no stride dials walks
 * exactly as it did. (The arena's second ruling, the placement clear of an
 * adversary, closed with the arena.)
 */
export function strideOnGround({ toward, targetFrom = "" }, place) {
  if (!place || !toward) return null;
  const step = Number.isFinite(place.walk_min_step) && place.walk_min_step > 0 ? place.walk_min_step : null;
  if (!step) return null;
  const snapped = { x: snapTo(toward.x, step), y: snapTo(toward.y, step) };
  if (snapped.x === toward.x && snapped.y === toward.y) return null;
  return { toward: snapped, targetFrom: `${targetFrom} — snapped to ${place.ground}'s own ${step} m step`, snapped: true };
}

/**
 * WHERE A GROUND SETS AN ENTRANT DOWN — `spawn`, the ground's own dial. Entry
 * writes occupancy and moves nobody, so a hand entering from outside the fence
 * would be inside by the record and outside by geometry; the spawn makes the
 * two agree. The jitter is WITNESSED (ground, hand, crossing), never random, so
 * two entrants land apart and one entrant lands consistently. A spawn outside
 * the ground's own extent is refused and disclosed, never honoured. A ground
 * with no spawn places nobody.
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

  const step = Number.isFinite(place.walk_min_step) && place.walk_min_step > 0 ? place.walk_min_step : 0.1;
  const reach = (() => {
    const declared = Number(parseJson(place.row.dials ?? place.dials, null)?.spawn_jitter_m);
    return Number.isFinite(declared) && declared >= 0 ? declared : step;
  })();
  if (reach === 0) return { at: { x: snapTo(spawn.x, step), y: snapTo(spawn.y, step) }, jitter: 0 };

  const h = createHash("sha256").update(`${place.ground}|${who}|${crossing ?? ""}`).digest();
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
 * The ground as the door answers it, in the site's declared contract
 * (`standpoint.portal`, with `id`, never `ground`). The stride and the body are
 * ABSENT, not null, when the ground has not declared them.
 */
export const cockpitPortal = (place) => (!place ? null : {
  id: place.ground,
  value: place.ground,
  by: String(place.ground).split("/")[0] || null,
  space: place.space,
  keeps_wheel: place.keeps_wheel,
  ...(Number.isFinite(place.walk_min_step) && place.walk_min_step > 0
    ? { walk_min_step: place.walk_min_step } : {}),
  ...(place.body ? { body: place.body } : {}),
});
