// standing.mjs — the 1.0 standing walk, ported to DB-shaped rows.
//
// WHY THIS EXISTS (the replay gate's finding 4, and Wright's ruling on it,
// world2/tools/README.md § Merge rulings — the replay lane's 4 teed decisions):
//
//   "Finding 4 (stale standing) RULED: recompute-at-close, not a live view. The
//    lawful cadence is 1.0's own: 'derived weight moves at the next Settlement'
//    (ECONOMY-DIALS read_side note) — tier is recomputed for ALL standing marks
//    inside the clearing transaction, which is settlement-equivalent staleness,
//    zero new class. The standing walk ports as a spatial query over the store
//    (the gold's own words: 'the milo overlay-blind case becomes a real spatial
//    query'); the replay gate is its judge (recompute vs the fold at every tag)."
//
// The finding it closes, verbatim from the gate's own report:
//
//   "Standing goes stale, and that one is not fixed. `data.tier` is not a field
//    of the record — it is what the fold says after resolving the whole world,
//    and 1.0 recomputes it for all 960 records at every settlement. 2.0 writes it
//    once, at materialization, and never revisits it."
//
// ── WHAT IS PORTED, AND FROM WHERE ───────────────────────────────────────────
//
// Three files of 1.0 law, at world `c701988f`:
//
//   tools/mark-standing.mjs   1c39c2196f861d2c4b18b5af9acc4a310a2de007
//     `markStanding` + `groundVerdict` — the walk itself, whole.
//   tools/marks-fold.mjs      (the preamble the walk reads: `_cred`,
//     `_sovereign`, `_containedBy` — fold() lines 594-697, containmentParentOf,
//     placementParent)
//   tools/geometry.mjs        6539c129f430fa53f071b380ed9447c6dcee0417
//     `rect` / `contains` / `marksContain` and the coverage rasterizer they
//     stand on — VENDORED below, verbatim, because this module runs inside the
//     clearing transaction and there is no world checkout there to import from.
//     `falsifier-standing-equality.mjs --world-repo` re-checks that blob sha and
//     says so when the source moves.
//
// mark-standing.mjs's own header forbids a second copy of the walk — "One
// definition, five consumers … a second copy of this walk is a future drift;
// import it." There is no import across the repo boundary here: 2.0's clearing
// job holds no checkout (the stateless contract is the ingesters', and the
// candle is not an ingester). So this is a PORT, and it is held to the original
// by a falsifier that runs both and compares every slug — which is the strongest
// form the instruction can take across a process boundary.
//
// ── THE ROW → RECORD MAPPING, WHICH IS WHERE A PORT GOES WRONG ───────────────
//
// | 1.0 record        | `marks` row                | note |
// |---|---|---|
// | `id`              | `slug`                     | the 1.0 path identity, `<by>/<name>` |
// | `by` / `household`| `owner`                    | the resident HANDLE |
// | `_cred`           | `household`                | the RESOLVED household key — 2.0's `household` column already carries `gh:<id>` or `solo:<handle>` (Wright's household-spelling ruling, 2026-08-28). It is NOT the handle; reading it as one is the port's sharpest edge |
// | `at` / `extent` / `points` | `geometry`        | `{at:{x,y},extent:{w,h},points?}` |
// | `tier`            | `data.tier`                | see § the constitution shortcut |
// | `consent`         | `data.consent`             | the authored word map |
// | `parent`          | `parent` (uuid → slug), else `data.parent_id` | the CONTINUATION edge — see § the docket pen's spelling |
// | `_parentMarkId`   | `data._parentMarkId`, else `data.parent_id` | the loader's directory edge — historical filing since the 2026-08-25 freeze, and the last thing the walk believes; a docket-born predicate is filed under the mark it describes, so its filing IS its `parent_id` |
// | `_sovereign`      | derived here               | § sovereignty |
// | `_containedBy`    | derived here               | § the containment answer |
//
// ── THE DOCKET PEN'S SPELLING OF THE PARENT EDGE (postmark#2895, 2026-09-17) ──
//
// The standing falsifier ran RED on prod on ten marks — "the fold says home,
// the port says market, and it still disagrees with the store-only ground
// removed AND the checkout-only ground added — this is the walk". Six of the
// ten were predicated or naming marks born through the CANDLE, and every one
// of them walked to the world root and stopped: `marks.parent` NULL, no
// `data._parentMarkId`, so the chain the walk climbs had no first link.
//
// The rows were not edgeless. The door's grammar names the mark a predicate
// describes `parent_id` (world.mjs § leaveMark: "predicated/naming: the mark
// this describes"); the docket pen spills it into `claims.data` with the
// `...rest` of the payload (world2-claims.mjs § the stake crossing the
// boundary — its INSERT names no `parent` column); `materializeClaims` copies
// `c.data` whole and `c.parent` NULL. So a candle-born predicate carries its
// authored edge under exactly one key, `data.parent_id`, and this port read
// two others. Measured on prod 2026-09-17: 16 standing rows carry the edge
// this way and no other (13 predicated, 3 naming); the seed and the backfill
// lift the same line into the uuid column, so their rows never showed it.
// guard-reads.mjs § liveChildrenOf has read `data.parent_id` since the guards
// lane ("`parent_id` rides `claims.data`") — one edge, and this was the
// reader that spelled it one way fewer.
//
// So `recordOf` reads the edge in the order the store writes it: the uuid
// column, then `data.parent_id`. It is the same line 1.0's `parent` carries,
// and the directory edge falls back to it too, because the office files a
// predicate under the mark it describes (world-drain.mjs § toFileFrame) —
// which is what `_parentMarkId` would say once the drain has written the
// file. The COLUMN staying NULL on those rows is the pen's, reported with
// the lane, not repaired here: a row rewrite is a prod write.
//
// ── THE CONSTITUTION SHORTCUT READS THE COLUMN IT WRITES ─────────────────────
//
// `markStanding`'s first line is the town's own exception:
//
//   "The one exception is the town's own law, read BELOW BEFORE the walk. The
//    constitution is the town speaking about the town's ground, and it has to be
//    answered before any ancestor is looked at."
//
//   `if ((mark.by ?? mark.household) === TOWN && mark.tier === "constitution")`
//
// In 1.0 `mark.tier` there is the AUTHORED frontmatter line. In 2.0 it is
// `data.tier`, and `data.tier` is the value this module writes back —
// seed-import.mjs overwrites the authored word at seed time ("The DERIVED tier
// overrides the raw frontmatter (A/B finding AB-R.tier)").
//
// That is self-referential, and it is a FIXPOINT rather than a feedback loop,
// which is a two-line proof worth writing down:
//
//   · a `the-town` mark that AUTHORED `tier: constitution` → the shortcut fires
//     → "constitution" is stored → the shortcut fires again. Stable.
//   · a `the-town` mark that did not → the shortcut cannot have fired, so the
//     stored value is the walk's own verdict, and the walk gives it again.
//     Stable.
//   · a non-`the-town` mark can never reach the shortcut at all.
//
// So the recompute is IDEMPOTENT by construction, and the falsifier asserts it
// (`--idempotence`) rather than leaving the argument on paper. The durable fix —
// preserving the authored word as its own key so the shortcut never reads a
// derived column — is a seed/materializer change and is TEED, not taken here.
//
// ── THE ONE EDGE THE STORE CANNOT WALK ───────────────────────────────────────
//
// 76 rows are predicated on a CLASS mark, which is law and lives in
// `law_projection`, not in `marks` (the seed's ruling, README § Merge ruling —
// the 76 class-parented marks). Their `parent` is NULL and the edge is verbatim
// in `data._parent_is_law`. The walk cannot climb it, because there is no row at
// the other end.
//
// It never has to: every one of the 76 is `the-town` + `tier: constitution`, so
// the shortcut answers before any ancestor is looked at. That is an EMPIRICAL
// fact about today's register, not a law, so it gets a tripwire instead of a
// comment — `admissionNotes` reports any `_parent_is_law` row the shortcut does
// not catch, and the falsifier prints it.

// ─────────────────────────────────────────────────────────────────────────────
// VENDORED from world `c701988f` tools/geometry.mjs, blob
// 6539c129f430fa53f071b380ed9447c6dcee0417 — verbatim, the containment half.
// Vendored, not re-expressed: `marksContain` is coverage-honest when a `points:`
// ring is present, and 21 marks carry one (the five inland waters among them).
// Re-deriving it "close enough" would silently widen those to their bounding box.
export const GEOMETRY_SOURCE = {
  repo: "keeminlee/postmark-world",
  path: "tools/geometry.mjs",
  blob: "6539c129f430fa53f071b380ed9447c6dcee0417",
  at: "c701988f9ff937661297a8acc87a48925ba3b37f",
};

export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
export const contains = (outer, inner) => overlapArea(outer, inner) >= 0.99 * inner.w * inner.h;

export const COVERAGE_CELL_M = 5;
const MAX_COVERAGE_CELLS = 1_000_000;
const cellKey = (cx, cy) => cx + "," + cy;
const cellIndex = (v, cell) => Math.floor(v / cell);
const cellCenter = (i, cell) => (i + 0.5) * cell;

export function polygonOf(mark) {
  const pts = mark?.points;
  if (!Array.isArray(pts) || pts.length < 3) return null;
  return pts.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }));
}
// `isIrregular(mark, feature)` with the feature half dropped: the fold never
// passes feature geometry into the containment question ("feature geometry is
// NEVER passed, so feature marks stay claim-based (bbox) per the 07-23 ruling"),
// and `containmentParentOf` — the only caller here — passes none either.
export const isIrregular = (mark) => !!polygonOf(mark);

const coverageCache = new WeakMap();
export function coverage(mark, { cell = COVERAGE_CELL_M } = {}) {
  const cached = coverageCache.get(mark)?.get(cell);
  if (cached !== undefined) return cached;
  const poly = polygonOf(mark);
  const set = poly ? rasterizePolygon(poly, cell) : rasterizeRect(rect(mark), cell);
  let per = coverageCache.get(mark);
  if (!per) coverageCache.set(mark, (per = new Map()));
  per.set(cell, set);
  return set;
}
function rasterizeRect(r, cell) {
  const x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, y0 = r.y - r.h / 2, y1 = r.y + r.h / 2;
  const cx0 = cellIndex(x0, cell), cx1 = cellIndex(x1, cell), cy0 = cellIndex(y0, cell), cy1 = cellIndex(y1, cell);
  if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_COVERAGE_CELLS) return null;
  const set = new Set();
  for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
    const px = cellCenter(cx, cell), py = cellCenter(cy, cell);
    if (px >= x0 && px <= x1 && py >= y0 && py <= y1) set.add(cellKey(cx, cy));
  }
  return set;
}
function rasterizePolygon(ring, cell) {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const p of ring) { if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y; }
  const cx0 = cellIndex(minx, cell), cx1 = cellIndex(maxx, cell), cy0 = cellIndex(miny, cell), cy1 = cellIndex(maxy, cell);
  if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_COVERAGE_CELLS) return null;
  const set = new Set();
  for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++)
    if (pointInPolygon(cellCenter(cx, cell), cellCenter(cy, cell), ring)) set.add(cellKey(cx, cy));
  return set;
}
export function pointInPolygon(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if (((yi > py) !== (yj > py)) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function pointInRect(px, py, r) { return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2; }

export function marksContain(outer, inner, { cell = COVERAGE_CELL_M, frac = 0.99 } = {}) {
  const oIrr = isIrregular(outer), iIrr = isIrregular(inner);
  if (!oIrr && !iIrr) return contains(rect(outer), rect(inner));
  const innerCells = coverage(inner, { cell });
  if (!innerCells) return contains(rect(outer), rect(inner));
  let inOuter;
  if (oIrr) {
    const outerCells = coverage(outer, { cell });
    if (outerCells) inOuter = (k) => outerCells.has(k);
    else {
      const ring = polygonOf(outer);
      if (!ring) return contains(rect(outer), rect(inner));
      inOuter = (k) => {
        const [cx, cy] = k.split(",").map(Number);
        return pointInPolygon(cellCenter(cx, cell), cellCenter(cy, cell), ring);
      };
    }
  } else {
    const ro = rect(outer);
    inOuter = (k) => { const [cx, cy] = k.split(",").map(Number); return pointInRect(cellCenter(cx, cell), cellCenter(cy, cell), ro); };
  }
  if (innerCells.size === 0) {
    const ri = rect(inner);
    const pts = [
      [ri.x, ri.y],
      [ri.x - ri.w / 2, ri.y - ri.h / 2], [ri.x + ri.w / 2, ri.y - ri.h / 2],
      [ri.x + ri.w / 2, ri.y + ri.h / 2], [ri.x - ri.w / 2, ri.y + ri.h / 2],
    ];
    const ring = oIrr ? polygonOf(outer) : null;
    if (ring) return pts.every(([x, y]) => pointInPolygon(x, y, ring));
    if (oIrr) return pts.every(([x, y]) => inOuter(cellKey(cellIndex(x, cell), cellIndex(y, cell))));
    const ro = rect(outer);
    return pts.every(([x, y]) => pointInRect(x, y, ro));
  }
  const allowedMisses = Math.floor(innerCells.size * (1 - frac));
  let covered = 0, missed = 0;
  for (const k of innerCells) {
    if (inOuter(k)) covered++;
    else if (++missed > allowedMisses) return false;
  }
  return covered / innerCells.size >= frac;
}
// ───────────────────────────────── end vendored geometry ─────────────────────

// The fold's own constants, at the same sha.
export const TOWN = "the-town";                        // mark-standing.mjs:57
export const WORLD_ROOT_SLUG = "let-there-be-light";   // marks-fold.mjs:180
export const WORLD_SCALE_M = 50000;                    // placementParent's default
export const PARCEL_DIAL = { w: 25, h: 25 };           // DIALS.parcel_w / parcel_h
export const PARCEL_CLAIM_CAP = 3;                     // marks-fold.mjs:529
export const PARCEL_CAP_LAW_DATE = "2026-07-30";       // marks-fold.mjs:530

/**
 * A `marks` row, read as the 1.0 record the walk was written against.
 *
 * `geometry` is unpacked rather than kept nested because every geometry
 * primitive above reads `mk.at` / `mk.extent` / `mk.points` at the top level —
 * a record that keeps them one level down is a record every containment test
 * silently answers `{x:0,y:0,w:1,h:1}` about.
 */
export function recordOf(row) {
  const g = row.geometry ?? null;
  const data = row.data ?? {};
  return {
    id: row.slug,                       // the 1.0 identity
    slug: row.slug,
    kind: row.kind,
    by: row.owner,
    handle: row.owner,
    _cred: row.household ?? `solo:${row.owner}`,
    tier: data.tier ?? null,
    consent: data.consent ?? undefined,
    at: g?.at ?? undefined,
    extent: g?.extent ?? undefined,
    ...(Array.isArray(g?.points) ? { points: g.points } : {}),
    // § the docket pen's spelling: a candle-born predicate's only edge.
    _parentMarkId: data._parentMarkId ?? data.parent_id ?? null,
    _parentId: data.parent_id ?? null,
    _parent_is_law: data._parent_is_law ?? null,
    _uuid: row.id ?? null,
    _parentUuid: row.parent ?? null,
    _date: data.date ?? null,
  };
}

// THE GRAIN, mark-standing.mjs:71 verbatim in effect:
//   "return mark?._cred ?? mark?.declared_household ?? mark?.household ?? mark?.by ?? null"
// `_cred` is always set by `recordOf` (the `household` column, or `solo:<owner>`
// when a row predates the household-spelling ruling), so the chain resolves at
// its first link and the fallbacks are the ones 1.0 keeps for un-folded callers.
export function standingHouseholdOf(mark) {
  return mark?._cred ?? mark?.declared_household ?? mark?.household ?? mark?.by ?? null;
}

/**
 * placementParent — marks-fold.mjs:412, verbatim.
 *
 *   "the DEEPEST existing mark that contains the new claim … Bbox area still
 *    ranks candidates (strictly larger; smallest containing wins). Returns the
 *    container id, or null when only the world-root contains it."
 */
export function placementParent(claim, marks, { worldScaleM = WORLD_SCALE_M, ranked = null } = {}) {
  const claimArea = rect(claim).w * rect(claim).h;
  // `ranked` is the same candidate set, ordered smallest-area-first, built once
  // per recompute by `rankCandidates`. THE ANSWER IS IDENTICAL and the argument
  // is one line: "smallest containing wins", so in ascending order the FIRST
  // container is the answer and everything after it is strictly larger. Ties keep
  // the original array's winner because the sort is stable, which is the same
  // tie-break `area < bestArea` makes on an unsorted pass.
  //
  // It is the difference between asking every mark in the town and asking until
  // the answer is found — 846 marks is O(n²) either way in the worst case, and in
  // practice this is where "a real spatial query" earns its name.
  if (ranked) {
    for (const { m, area } of ranked) {
      if (area <= claimArea) continue;
      if (marksContain(m, claim)) return m.id;
    }
    return null;
  }
  let best = null, bestArea = Infinity;
  for (const m of marks) {
    if ((m.kind !== "sited" && m.kind !== "parcel") || !m.at) continue;
    const mr = rect(m), area = mr.w * mr.h;
    if (Math.max(mr.w, mr.h) >= worldScaleM) continue; // the world-root is the frame, never a parent
    if (area <= claimArea) continue;                    // a parent is strictly larger than its child
    if (marksContain(m, claim) && area < bestArea) { best = m; bestArea = area; }
  }
  return best ? best.id : null;
}

/** The candidate parents, smallest first — `placementParent`'s `ranked` input. */
export function rankCandidates(marks, { worldScaleM = WORLD_SCALE_M } = {}) {
  const out = [];
  for (const m of marks) {
    if ((m.kind !== "sited" && m.kind !== "parcel") || !m.at) continue;
    const mr = rect(m);
    if (Math.max(mr.w, mr.h) >= worldScaleM) continue;
    out.push({ m, area: mr.w * mr.h });
  }
  return out.sort((a, b) => a.area - b.area);   // stable in V8, and the tie-break depends on it
}

const leafSlugOf = (m) => String(m?.slug ?? m?.id ?? "").split("/").pop();
export const worldRootOf = (marks) => marks.find((m) => leafSlugOf(m) === WORLD_ROOT_SLUG) ?? null;

/**
 * containmentParentOf — marks-fold.mjs:475, verbatim.
 *
 *   "TWO DERIVATIONS, because there are two kinds of edge in this world and only
 *    one of them is geographic: sited / parcel — GEOMETRY … predicated / naming /
 *    class — PREDICATION … `null` means the world root itself. A mark that
 *    nothing tighter holds returns the root's id, never null — a chain that stops
 *    short of the frame is a chain with a hole in it."
 */
export function containmentParentOf(mark, marks, root = worldRootOf(marks), ranked = null) {
  const rootId = root?.id ?? null;
  if (rootId != null && mark.id === rootId) return null;
  const geometric = (mark.kind === "sited" || mark.kind === "parcel") && mark.at;
  const up = geometric ? placementParent(mark, marks, { ranked }) : (mark._parentMarkId ?? null);
  return up ?? rootId;
}

/**
 * The verdict at the ground — mark-standing.mjs:130, verbatim.
 *
 *   "SAME HOUSEHOLD    home. … WELCOMED   home, under the ground-holder's name.
 *    … ABSENT / OPPOSED  market, exactly as before."
 *
 * The consent word is read off the record the walk STOPPED at, "which is the
 * nearest sovereign ground and therefore the most specific holder", and it is
 * the AUTHORED word (`consentMap`), never resolveConsent's output.
 */
export function groundVerdict(ground, mark, house) {
  const holder = standingHouseholdOf(ground);
  if (holder == null || house == null) return "market";
  if (holder === house) return "home";
  const map = ground?.consent;
  const word = map != null && typeof map === "object" && !Array.isArray(map) ? map[mark.id] : undefined;
  return mark.id != null && word === "welcomed" ? "home" : "market";
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SPATIAL INDEX — `containmentParentOf`'s candidate set, asked of Postgres
//
// `placementParent` above says what this replaces, in its own words: "846 marks
// is O(n^2) either way in the worst case, and in practice this is where 'a real
// spatial query' earns its name." This is the real spatial query, and the store
// is the only one of the walk's two homes that can ask it — 1.0's fold runs in a
// checkout with no database, which is why the JS grid is the world's answer and
// this is the store's (Keemin, 2026-09-10).
//
// WHAT IT RETURNS is a CANDIDATE set, never an answer. `marksContain` still
// decides every pair, in the same ranked order, so the walk's verdict cannot
// move — the index only decides which pairs are worth asking about.
//
// THE PREFILTER'S OWN LAW: `outer` can contain `inner` only if their EFFECTIVE
// extents touch. That is exact for every case `marksContain` can answer yes to —
//   * neither irregular: `contains()` needs `overlapArea >= 0.99 * innerArea`,
//     which for a positive-area inner needs a positive overlap;
//   * either irregular: at least 99 % of `inner`'s coverage cells must fall
//     inside `outer`, and a cell inside both is a point inside both.
// — and it has exactly two escapes, both of which are measured per row rather
// than assumed, because a prefilter whose premise is a comment is a prefilter
// that will silently change an answer:
//
//   1. `bbox` IS NOT THE EFFECTIVE EXTENT WHEN A RING LEAVES IT. `bbox` is
//      `at ± extent/2` (seed-import.mjs § boxOf) and says nothing about a
//      `points:` ring. ONE mark at 1x has a ring outside its own extent.
//   2. A DEGENERATE INNER makes `contains()` vacuously true — `overlapArea >= 0`
//      holds for every pair when `inner.w * inner.h` is zero — so the linear scan
//      returns the smallest candidate anywhere and no overlap test reproduces
//      that. (None exist today; the check is what says so.)
//
// Both are answered by the same query, and every row either escape touches goes
// on the LOOSE list: loose marks are scanned the old way as inners, and are
// offered to every other mark as candidates. So the index is an accelerator for
// the rows it can speak for and is simply absent for the rows it cannot.
//
// IT REFUSES TO RUN UNINDEXED. Without `016_marks_bbox_gist.sql` the pair query
// costs 16.5 s at 10x — slower than the walk it replaces — so the reader checks
// `pg_indexes` for the index by name and returns null instead, and the walk uses
// the scan it has always used. A missing migration costs the old price, never a
// worse one.

/** Every standing geometric mark, and whether `bbox` speaks for it. */
const COVERAGE_SQL = `
  WITH g AS (
    SELECT slug, bbox, geometry,
           (geometry->'at'->>'x')::float8      AS ax,
           (geometry->'at'->>'y')::float8      AS ay,
           (geometry->'extent'->>'w')::float8  AS w,
           (geometry->'extent'->>'h')::float8  AS h
      FROM marks
     WHERE status = 'standing' AND kind IN ('sited','parcel')
  )
  SELECT slug,
         ( bbox IS NULL OR ax IS NULL OR ay IS NULL OR w IS NULL OR h IS NULL
           OR w <= 0 OR h <= 0
           OR (bbox[1])[0] <> ax - w/2 OR (bbox[1])[1] <> ay - h/2
           OR (bbox[0])[0] <> ax + w/2 OR (bbox[0])[1] <> ay + h/2
           OR (geometry ? 'points' AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(geometry->'points') p
                 WHERE coalesce((p->>0)::float8, (p->>'x')::float8) IS NULL
                    OR coalesce((p->>1)::float8, (p->>'y')::float8) IS NULL
                    OR coalesce((p->>0)::float8, (p->>'x')::float8) < ax - w/2
                    OR coalesce((p->>0)::float8, (p->>'x')::float8) > ax + w/2
                    OR coalesce((p->>1)::float8, (p->>'y')::float8) < ay - h/2
                    OR coalesce((p->>1)::float8, (p->>'y')::float8) > ay + h/2))
         ) AS loose
    FROM g`;

/** The pairs whose extents touch — the GiST index's whole job. */
const PAIRS_SQL = `
  SELECT a.slug AS inner_slug, b.slug AS outer_slug
    FROM marks a JOIN marks b ON b.bbox && a.bbox
   WHERE a.status = 'standing' AND b.status = 'standing'
     AND a.kind IN ('sited','parcel') AND b.kind IN ('sited','parcel')
     AND a.slug <> b.slug`;

const INDEX_SQL =
  `SELECT 1 FROM pg_indexes WHERE tablename = 'marks' AND indexname = 'marks_bbox_gist'`;

/**
 * gistContainment(q) → { covered, pairs, loose, indexed } | null
 *
 * `q` is the caller's own query function, so this runs inside the caller's
 * transaction and sees exactly the rows the caller's SELECT saw. Null means "no
 * index, walk it the old way" and is not an error.
 */
export async function gistContainment(q) {
  const idx = await q(INDEX_SQL);
  if (!idx?.rows?.length) return null;

  const cov = await q(COVERAGE_SQL);
  const covered = new Set(), loose = [];
  for (const r of cov.rows) {
    if (r.loose) loose.push(r.slug);
    else covered.add(r.slug);
  }

  const pr = await q(PAIRS_SQL);
  const pairs = new Map();
  for (const s of covered) pairs.set(s, []);
  for (const r of pr.rows) {
    // A loose OUTER is not a candidate list entry — it is offered to every mark
    // by `computeStanding`, because the index cannot say where it really reaches.
    if (!covered.has(r.outer_slug)) continue;
    const list = pairs.get(r.inner_slug);
    if (list) list.push(r.outer_slug);
  }
  return { covered, pairs, loose, indexed: true };
}

/**
 * The effective extent a containment test can actually reach — the record's
 * rect widened to hold its ring, which is what `marksContain` rasterizes.
 */
function effBox(mk) {
  const r = rect(mk);
  let x0 = r.x - r.w / 2, x1 = r.x + r.w / 2, y0 = r.y - r.h / 2, y1 = r.y + r.h / 2;
  const ring = polygonOf(mk);
  if (ring) for (const p of ring) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}
// Touching counts, deliberately: `&&` in Postgres counts it too, and a prefilter
// that is looser than the test it guards can only cost a `marksContain` call.
const boxesTouch = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/**
 * markStanding — mark-standing.mjs:89, verbatim, with the up-chain widened by
 * exactly one link for the store (see § the one edge the store cannot walk).
 *
 *   "STANDING IS DERIVED HERE AND NOWHERE ELSE, AND NEVER DECLARED BY A RESIDENT."
 *
 *   "THE ORDER MATTERS, and it changed with the freeze. … That lint is repealed —
 *    'the tree's paths make no assertion' — so the directory is now historical
 *    filing and is the LAST thing this walk should believe."
 */
export function markStanding(mark, byId) {
  if (!mark) return "market";
  if ((mark.by ?? mark.household) === TOWN && mark.tier === "constitution") return "constitution";
  const house = standingHouseholdOf(mark);
  let m = mark;
  for (let hops = 0; m && hops < 32; hops++) {
    if (m.kind === "parcel" || m.sovereign || m._sovereign) return groundVerdict(m, mark, house);
    // 1.0: `m.parent ?? m._containedBy ?? m._parentMarkId ?? m.placementParent`.
    // `_parentSlug` is 1.0's `parent` resolved out of the `parent` uuid column;
    // `_parent_is_law` is the same authored edge for the 76 rows whose parent is
    // a class mark and therefore has no `marks` row — it is carried so the walk
    // reads the edge 1.0 reads, and it dead-ends at `byId.get` because the store
    // genuinely does not hold that mark. The shortcut answers all 76 first.
    const up = m._parentSlug ?? m._parent_is_law ?? m._containedBy ?? m._parentMarkId ?? null;
    m = up ? byId?.get?.(up) : null;
  }
  return "market";
}

/**
 * computeStanding(rows, { only }) → Map slug → tier.
 *
 * `rows` are `marks` rows: { id, slug, kind, owner, household, geometry, parent,
 * data }. Only STANDING rows should be handed in — a retired mark is not part of
 * the world the walk resolves, and the seed/clearing job both scope their select
 * that way.
 *
 * The three derived fields the walk reads are stamped first, in the fold's own
 * order, because that order is load-bearing: `_cred` before sovereignty (the
 * grain decides whose parcels count as "own"), sovereignty before the walk.
 *
 * ── `only`: THE ANSWER SET, AND WHY IT IS NOT AN OPTIMISATION FLAG ───────────
 *
 * A crossing walks this twice (the 10x store lane, § the ceiling): once at the
 * clearing's escrow-presence gate and once at `recomputeStanding`. The second
 * one has to answer for EVERY standing mark — that is finding 4's whole ruling,
 * "tier is recomputed for ALL standing marks inside the clearing transaction".
 * The first one does not: `escrowAbsentAmong` reads `tiers.get(c.slug)` for the
 * undecided named CLAIMS and for nothing else, so it was paying for 10,350
 * answers to use fifty.
 *
 * `only` is that difference made explicit. The set of records is unchanged — the
 * whole world is still resolved, because a candidate's standing depends on
 * ground it does not own — and what changes is how many marks get WALKED.
 * Containment is now resolved lazily, per record, the first time the walk climbs
 * to it, so the O(N^2) pass runs over the answered marks' ancestry instead of
 * over the register.
 *
 * THE TWO THINGS `only` MUST NOT CHANGE, and the second one is the one that got
 * away the first time this was written.
 *
 *   1 · THE VERDICT FOR A RECORD. `containmentParentOf` is a pure function of
 *       (mark, records, root, ranked), and all four are the same whether it is
 *       called eagerly for every record or lazily for some.
 *   2 · WHICH RECORD A SLUG RESOLVES TO. The base walk is last-wins, and at
 *       step 5.5 two records DO share a slug — see § last-wins at the bottom of
 *       this function. The first cut resolved first-wins, and a real amendment
 *       then answered as the standing mark instead of as the claim: a commons
 *       claim through the escrow gate unchecked, silently. That is the whole of
 *       the difference between "only removes entries" and "only is exact".
 *
 * NO FALSIFIER COVERS THIS PATH. `falsifier-standing-equality.mjs` runs the FULL
 * walk against 1.0's fold and never passes `only` at all, so it is green on both
 * readings and cannot see the difference. What holds this is
 * `test/world2-standing.test.mjs`'s duplicate-slug fixture, which was run red
 * against the first-wins version before the fix went in.
 *
 * IT REFUSES A SLUG IT WAS NOT GIVEN. `escrowAbsentAmong` reads a missing tier
 * as "not commons, skip" — which is right when the walk genuinely had no verdict
 * and would be a silently unchecked commons claim if the caller simply misspelled
 * the set. So an `only` naming a slug that is not among `rows` throws here, where
 * the mistake is, instead of passing quietly through a gate.
 */
export function computeStanding(rows, { only = null, containment = null, houseOf = null } = {}) {
  const records = rows.map(recordOf);
  // ── ONE HOUSE, WHICHEVER SPELLING ITS ROW WAS STORED UNDER (2026-09-30) ────
  //
  // `_cred` is the `household` column as it was written, and a house's rows
  // carry every spelling it has worn: 95 standing parcels on prod were stored
  // as `gh:<id>` or `solo:<handle>` while every new claim arrives as the
  // house's live `hh:<slug>` (materialize.mjs § ownerHouseholdFor). Compared
  // as strings, a ✦0 mark inside its own house's parcel read "market" and the
  // candle refused it escrow-absent — errant/inside-glazed-ear (window 216) and
  // nfh/the-workshop (203/204). `houseOf` maps a stored spelling to the
  // house's live key (materialize.mjs § liveHouseOfVia); absent, the walk is
  // the string walk it always was, which is what the checkout-side falsifier
  // compares against.
  if (typeof houseOf === "function") for (const r of records) r._cred = houseOf(r._cred) ?? r._cred;
  const byId = new Map();
  for (const r of records) if (!byId.has(r.id)) byId.set(r.id, r);

  // The continuation edge, resolved from the uuid column back to the slug the
  // walk speaks. `marks.parent` is 1.0's authored `parent:` and nothing else —
  // "`parent` is the CONTINUATION edge, never containment" (the seed's ruling).
  // When the column is NULL the same line may still be on the row under the
  // docket pen's spelling, `data.parent_id` — § the docket pen's spelling.
  const slugByUuid = new Map();
  for (const row of rows) if (row.id != null) slugByUuid.set(String(row.id), row.slug);
  for (const [i, row] of rows.entries())
    records[i]._parentSlug = row.parent != null ? (slugByUuid.get(String(row.parent)) ?? null) : (records[i]._parentId ?? null);

  // ── sovereignty (marks-fold.mjs:674) ────────────────────────────────────────
  //   "sited marks fully inside their OWN household's parcel are sovereign
  //    leaves — and 'own household' is the CREDENTIAL household, so a mark is
  //    sovereign inside ANY parcel the household holds, whichever of its handles
  //    authored either one."
  //
  // THE ADMITTED SET IS THE STORE'S STANDING PARCELS. 1.0 re-runs parcel
  // admissibility inside the fold (no overlap, one per handle, the 3-per-
  // household claim cap); 2.0 answers all three at the candle — the
  // `parcels_do_not_overlap` exclusion constraint, and the clearing job's step 4
  // — so a STANDING parcel is by construction an admitted one. `admissionNotes`
  // is the tripwire for the day that stops being true.
  const parcelRectsByCred = new Map();
  for (const mk of records) {
    if (mk.kind !== "parcel") continue;
    const r = rect(mk);
    r.w = r.w || PARCEL_DIAL.w; r.h = r.h || PARCEL_DIAL.h;   // marks-fold.mjs:608
    if (!parcelRectsByCred.has(mk._cred)) parcelRectsByCred.set(mk._cred, []);
    parcelRectsByCred.get(mk._cred).push(r);
  }
  for (const mk of records) {
    if (mk.kind === "sited") {
      const held = parcelRectsByCred.get(mk._cred) ?? [];
      mk._sovereign = held.some((pr) => contains(pr, rect(mk)));
    }
  }

  // ── the containment answer (marks-fold.mjs:687) ─────────────────────────────
  //   "THE CONTAINMENT ANSWER, once per fold, for everything downstream that
  //    used to read a directory. … 'containment lives only in the derived fold'
  //    (the freeze, 2026-08-25)."
  //
  // This is the "real spatial query" the ruling names: containment is asked of
  // the GROUND the store holds, not of the directory a record was filed in.
  const root = worldRootOf(records);
  const ranked = rankCandidates(records);

  // ── the candidate set, narrowed by the store's GiST when there is one ──────
  //
  // `containment` comes from `gistContainment` (§ the spatial index) and is a
  // PREFILTER, never an answer: `placementParent` still tests every candidate
  // with `marksContain`, in the same ascending-area order, so its verdict is the
  // one the full scan gives. What changes is the length of the list.
  //
  // THREE ROWS GET THE OLD SCAN, and between them they are every row the index
  // cannot speak for:
  //   * a mark that is not in the store at all — the clearing's step 5.5 walks
  //     the standing rows PLUS candidate claims, and no index over `marks` has
  //     ever seen a claim;
  //   * a LOOSE mark, whose `bbox` does not bound what `marksContain` reads
  //     (a ring outside its extent, a degenerate rect, geometry the column
  //     disagrees with) — measured per row by `gistContainment`, not assumed;
  //   * every mark, when there is no index.
  // The same rows, as OUTERS, are offered to every mark: `extras` below, gated
  // only by the effective-extent test the prefilter's law is stated in.
  const rankPos = new Map(), rankBySlug = new Map();
  const useIndex = containment != null && ranked.length > 0;
  if (useIndex) for (const [i, e] of ranked.entries()) {
    rankPos.set(e.m.slug, i);
    if (!rankBySlug.has(e.m.slug)) rankBySlug.set(e.m.slug, e);
  }
  const extras = useIndex ? ranked.filter((e) => !containment.covered.has(e.m.slug)) : [];
  const boxCache = new Map();
  const boxOfRecord = (mk) => {
    let b = boxCache.get(mk);
    if (b === undefined) boxCache.set(mk, (b = effBox(mk)));
    return b;
  };
  const rankedFor = !useIndex ? () => ranked : (mk) => {
    // ESCAPE 2, and it is the reason this is a branch and not a filter.
    // `contains()` reads `overlapArea >= 0.99 * inner.w * inner.h`, so a
    // zero-area inner is contained by EVERYTHING and `placementParent` returns
    // the smallest candidate in the world, wherever it is. No overlap test can
    // reproduce that, so a degenerate mark keeps the scan. (None exist in the
    // register today — `gistContainment`'s own query is what says so.)
    const r = rect(mk);
    if (!(r.w > 0) || !(r.h > 0)) return ranked;

    const eb = boxOfRecord(mk);
    const outers = containment.pairs.get(mk.slug);
    if (outers === undefined) {
      // A row the index does not speak for — a CLAIM at step 5.5, which no index
      // over `marks` has seen, or a mark whose `bbox` does not bound what
      // `marksContain` reads. The prefilter's law does not need a database: an
      // extent that cannot touch cannot contain, and asking that of the ranking
      // in JS costs one cheap comparison per candidate instead of one coverage
      // rasterization. `filter` keeps the ranking's own order, so no re-sort.
      //
      // THIS IS WHERE THE MEASUREMENT WENT, and it is worth the sentence: with
      // these rows left on the raw scan, FORTY-EIGHT loose marks out of 8,310
      // cost 10.6 s of a 13.4 s walk, because every one of them carries a
      // `points:` ring and each candidate test rasterizes it.
      return ranked.filter((e) => e.m !== mk && boxesTouch(eb, boxOfRecord(e.m)));
    }
    const sub = [];
    for (const s of outers) { const e = rankBySlug.get(s); if (e) sub.push(e); }
    if (extras.length) {
      for (const e of extras) if (e.m !== mk && boxesTouch(eb, boxOfRecord(e.m))) sub.push(e);
    }
    // `placementParent`'s contract is "smallest containing wins", which it reads
    // off ASCENDING AREA ORDER and a stable sort. The sub-list is put back into
    // the full ranking's own order so the tie-break is the same one.
    sub.sort((a, b) => rankPos.get(a.m.slug) - rankPos.get(b.m.slug));
    return sub;
  };

  // LAZILY, and `markStanding` must not be able to tell. The walk climbs
  // `m._parentSlug ?? m._parent_is_law ?? m._containedBy ?? …` and that chain is
  // 1.0's, ported verbatim under this file's own standing instruction ("a second
  // copy of this walk is a future drift"). So the field stays a field: a getter
  // that computes the containment answer on first read and then replaces itself
  // with the value, which is why a record is walked at most once no matter how
  // many descendants climb through it.
  //
  // With no `only`, every record is answered and every getter fires, so this is
  // the same total work as the eager pass it replaces.
  for (const mk of records) {
    Object.defineProperty(mk, "_containedBy", {
      configurable: true, enumerable: true,
      get() {
        const v = containmentParentOf(this, records, root, rankedFor(this)) ?? null;
        Object.defineProperty(this, "_containedBy",
          { value: v, writable: true, enumerable: true, configurable: true });
        return v;
      },
    });
  }

  const out = new Map();
  if (only == null) {
    for (const mk of records) out.set(mk.slug, markStanding(mk, byId));
    return out;
  }
  // LAST-WINS, and it is the whole of `only`'s exactness.
  //
  // The base walk is `for (const mk of records) out.set(mk.slug, …)`, so when two
  // records share a slug the LAST one is the answer. At step 5.5 `records` is
  // `[...standingRows, ...candidates]`, so the last one is the CANDIDATE — which
  // is what that gate is asking about in its own words, "in the shape
  // `materializeClaims` is about to insert".
  //
  // Two records DO share a slug there, on a path this office opened deliberately:
  // `clearing-job.mjs` step 1 refuses a claim whose slug already stands, except
  // an amendment, which continues undecided and reaches step 5.5 carrying the
  // standing mark's slug. A first-wins map answered with the standing MARK
  // instead, and the two differ exactly when the amendment moves the mark off its
  // own ground — which is what an amendment is for. Found by the reviewer on the
  // shipped tool: the amended claim dropped out of `escrow: 51 commons claim(s)
  // LOCKED UNCHECKED` and locked with nothing staked behind it, silently.
  const bySlug = new Map();
  for (const mk of records) bySlug.set(mk.slug, mk);
  for (const slug of only) {
    const mk = bySlug.get(slug);
    // See § `only` — a slug the caller asked about and did not hand in is a
    // caller bug, and the reader downstream cannot tell it from "no verdict".
    if (!mk) throw new Error(`computeStanding: \`only\` names ${slug}, which is not among the ${rows.length} row(s) given`);
    out.set(slug, markStanding(mk, byId));
  }
  return out;
}

/**
 * The tripwires — every premise this port stands on that is a FACT about
 * today's register rather than a law, stated as something that can fire.
 *
 * A premise nobody can watch break is a premise that breaks silently. Returns
 * [] when all three hold.
 *
 * `houseOf` is `computeStanding`'s: the cap is per HOUSE, and a house whose
 * parcels are stored under two spellings is one household holding all of them.
 */
export function admissionNotes(rows, { houseOf = null } = {}) {
  const notes = [];
  const records = rows.map(recordOf);
  if (typeof houseOf === "function") for (const r of records) r._cred = houseOf(r._cred) ?? r._cred;

  // 1 · the class-parent edge, and why the walk never needs it.
  const lawParented = records.filter((m) => m._parent_is_law);
  const uncovered = lawParented.filter((m) => !(m.by === TOWN && m.tier === "constitution"));
  if (uncovered.length)
    notes.push(`${uncovered.length} mark(s) are predicated on a CLASS mark (no \`marks\` row to climb to) and are ` +
      `NOT answered by the constitution shortcut, so the walk dead-ends on them: ` +
      `${uncovered.slice(0, 4).map((m) => m.slug).join(", ")}`);

  // 2 · the parcel claim cap (marks-fold.mjs:612), which 1.0's fold enforces and
  //     2.0's candle does not. Inert across the whole frozen register — every
  //     household holding more than 3 holds them all dated on or before the law
  //     date, as prior estate — so "standing parcels are the admitted set" is
  //     exact today. This fires the moment it stops being.
  const byCred = new Map();
  for (const m of records) {
    if (m.kind !== "parcel") continue;
    if (!byCred.has(m._cred)) byCred.set(m._cred, []);
    byCred.get(m._cred).push(m);
  }
  for (const [cred, ps] of byCred) {
    const gated = ps.filter((p) => String(p._date ?? "").slice(0, 10) > PARCEL_CAP_LAW_DATE);
    if (ps.length > PARCEL_CLAIM_CAP && gated.length)
      notes.push(`household ${cred} holds ${ps.length} standing parcels, ${gated.length} of them dated after ` +
        `${PARCEL_CAP_LAW_DATE} — 1.0's fold caps a household at ${PARCEL_CLAIM_CAP} claims and would refuse ` +
        `some of these sovereign ground; the candle does not enforce the cap, so the two now disagree ` +
        `(${gated.slice(0, 3).map((p) => p.slug).join(", ")})`);
  }

  // 3 · one parcel per HANDLE (marks-fold.mjs:609), same shape, same reason.
  const byHandle = new Map();
  for (const m of records) if (m.kind === "parcel") byHandle.set(m.by, (byHandle.get(m.by) ?? 0) + 1);
  for (const [handle, n] of byHandle)
    if (n > 1) notes.push(`handle ${handle} holds ${n} standing parcels — MARKS.md § Parcels says "every ` +
      `resident-handle may hold one parcel", and 1.0's fold admits only the first`);

  return notes;
}
