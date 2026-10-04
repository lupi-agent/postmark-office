// ring-box.mjs — A MARK'S BOX IS DERIVED FROM ITS RING (POS-322).
//
// Keemin, 2026-10-02 ~19:3x EDT: "the deeper fix is that extent should just be
// derived from the ring." A resident sends the `points:` ring; the town
// computes `at` (the ring's bounding-box centre) and `extent` (its w × h). The
// two can then never disagree, which is the world lint's SCHEMA v2 rule
// ("the claim IS the ring's bbox", world `tools/mark-lint.mjs` § 4b).
//
// THE INSTANCE. kinofire's 16:36Z amend of kinofire/the-gloaming (journal 225,
// seq 12129) sent a 16-point ring spanning x -2300..-1100, y -1000..0 and kept
// `at: {-2300,-1000}`, reading `at` as the top-left corner. The world reads it
// as the centre. The office stored it unchecked, and the 18:00Z crossing
// refused the whole town's settlement as canon-bad (postmark#3363).
//
// ONE FUNCTION, TWO READERS. `ringBox` is what the door stores
// (`world.mjs § leaveMarkViaOffice`) and what the docket pen boxes
// (`world2-claims.mjs`, whose `bbox` column is `boxOf(at, extent)`), so the
// stored geometry and the store's bbox are the same arithmetic.
//
// THE ARITHMETIC IS THE WORLD'S. `ringOf`, the bbox in `ringBox` and
// `ringAgrees` restate world `tools/geometry.mjs` § polygonOf / polygonBBox /
// ringMatchesClaim (≥3 vertices; `[[x,y],…]` or `[{x,y},…]`; tolerance 0.5 m;
// the rect centred on `at`). `test/ring-box.test.mjs` holds them equal to the
// clone's own functions. The door asks the clone's `ringMatchesClaim` first and
// uses `ringAgrees` only when the clone's module cannot be loaded.
//
// Pure: no imports, no I/O.

/** The world lint's tolerance for ring = bbox (world `ringMatchesClaim(mark, tol = 0.5)`). */
export const RING_TOL_M = 0.5;

/** The lint's own sentences (world `tools/mark-lint.mjs` § 4b), quoted so a door refusal reads as the settlement would. */
export const RING_SHAPE_SENTENCE = 'points: must be a ring of ≥3 vertices ([[x,y],…] or "x1,y1 x2,y2 …")';
export const RING_CLAIM_SENTENCE = "the points: ring's bounding box must equal the mark's at/extent claim — the claim IS the ring's bbox (SCHEMA v2)";

const vx = (p) => (Array.isArray(p) ? p[0] : p?.x);
const vy = (p) => (Array.isArray(p) ? p[1] : p?.y);

/**
 * The ring as `{x,y}` vertices, or null when it is not one the world would
 * honour: not an array, fewer than 3 vertices, or a vertex that is not a pair
 * of finite numbers (the world's polygonBBox would answer NaN for it, and the
 * lint would refuse it).
 */
export function ringOf(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const out = [];
  for (const p of points) {
    const x = vx(p), y = vy(p);
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push({ x, y });
  }
  return out;
}

/** The ring's box as `{ at, extent }`, or null when `points` is not a ring. */
export function ringBox(points) {
  const ring = ringOf(points);
  if (!ring) return null;
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const { x, y } of ring) {
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  return { at: { x: (minx + maxx) / 2, y: (miny + maxy) / 2 }, extent: { w: maxx - minx, h: maxy - miny } };
}

/**
 * Whether a sent `{at, extent}` already IS the ring's box, within the lint's
 * tolerance. True means the door keeps the sender's numbers byte for byte.
 */
export function ringAgrees({ at, extent } = {}, points, tol = RING_TOL_M) {
  const box = ringBox(points);
  if (!box || !at || !extent) return false;
  const [x, y, w, h] = [Number(at.x), Number(at.y), Number(extent.w), Number(extent.h)];
  if (![x, y, w, h].every(Number.isFinite)) return false;
  const b = { minx: box.at.x - box.extent.w / 2, maxx: box.at.x + box.extent.w / 2, miny: box.at.y - box.extent.h / 2, maxy: box.at.y + box.extent.h / 2 };
  return Math.abs(b.minx - (x - w / 2)) <= tol && Math.abs(b.maxx - (x + w / 2)) <= tol
    && Math.abs(b.miny - (y - h / 2)) <= tol && Math.abs(b.maxy - (y + h / 2)) <= tol;
}

/**
 * The ring moved so its box centre lands on `to`, in the shape it was sent in
 * (pairs stay pairs, objects stay objects). A set-down moves the whole thing:
 * Wright's ruling (a) on POS-322, 2026-10-02 — "picking something up and
 * setting it down moves it, and the ring stays the truth of its shape".
 */
export function ringMovedTo(points, to) {
  const box = ringBox(points);
  if (!box) return null;
  const dx = Number(to.x) - box.at.x, dy = Number(to.y) - box.at.y;
  return points.map((p) => (Array.isArray(p) ? [p[0] + dx, p[1] + dy] : { ...p, x: p.x + dx, y: p.y + dy }));
}
