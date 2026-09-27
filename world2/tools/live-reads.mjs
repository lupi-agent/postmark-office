// live-reads.mjs — 1.0's LIVE-lane read derivations, ported to `acts` rows.
//
// WHY THIS EXISTS (the A/B report's gaps list, § No door, data present):
//
//   "GET /world/walkers (133 walkers) | P-092 | a positions view over
//    legacy:departure — needs AB-P3 fixed for full history"
//   "GET /world/present (132 residents) | P-093 | presence view over acts"
//   "GET /world/dynamic | P-098 | views over acts"
//   "world_occupancy | P-036 | ... an occupancy/crossings view"
//
// AB-P3 is fixed (§ The ledger backfill), so the full history is there. What was
// missing was the DERIVATION: every apex read shadow still answers from sqlite,
// and the store holds the events with nothing able to ask them a question.
//
// This is the standing lane's shape, one lane over: a PORT of 1.0's own law as
// pure functions over DB-shaped rows, held to the original by a falsifier that
// runs BOTH over the same state (`falsifier-live-equality.mjs`). The reason it
// is a port and not an import is world2-serve.mjs's: the read tier answers from
// Postgres and holds no world checkout, which is the whole direction of gold §2
// ("freshness as a QUERY, not a pipeline"). Where a predicate is small and
// exact it is VENDORED verbatim with its blob sha; where it is a whole module's
// judgment it is refused rather than approximated.
//
// ── WHAT IS PORTED, AND FROM WHERE ───────────────────────────────────────────
//
// world `c701988f9ff937661297a8acc87a48925ba3b37f`:
//
//   tools/walk.mjs       606b47f0577d35addde2df6b9398e7679f371ea1
//     the ledger grammar, `fractionalCrossing`, `currentDeparture`,
//     `targetEntryT`, `positionAt`, `positionsAt`, `publicWalker` — VENDORED
//     verbatim (it is arithmetic, and a re-expression would be a twin).
//   tools/geometry.mjs   6539c129f430fa53f071b380ed9447c6dcee0417
//     `pointInRect` — one line, vendored; positionAt's arrival predicate.
//   tools/where-is.mjs   83e6a766e16bea763c6a118c44d634093c99742a
//     `householdOf` / `parcelsFor` / `homeOf` / `porchOf` / `whereIs` /
//     `publicResidents` — ported over `marks` + `identities` rows.
//   tools/enter-exit.mjs c3817c10a6d3ee3e1fe7b37365a0cc8ae64692a4
//     `occupancyAt` / `withinOf` / `occupantsOf` — a pure fold, vendored.
//
// office `5aaee01c05b3c028efaaa7f6131fc1cb51c86173`:
//
//   src/world.mjs             466130cc38c03991ebf9deb1d6966a08390c6d65
//     `walkersAround` — the apex render bound, vendored.
//   src/dynamic-emissions.mjs 826e6c30779a764dcd048233affc0ba6c9255287
//     `presentEmissions` — the TTL query, ported to the emission acts.
//   src/world-movement.mjs    be594f42ac42846175e7a043d9db361069a21635
//     `storedDepartures`'s converter — the journal payload → walk record
//     mapping, quoted at `departureRecordOf`. It is 1.0's own single
//     converter for exactly this payload shape and no second one is written.
//   src/positions.mjs / src/dynamic-presence.mjs — the union and its roster
//     rule, ported; the FRAME half is refused, see § What is NOT here.
//
// ── THE FIVE ERAS OF A MOVEMENT ACT, WHICH IS WHERE A PORT GOES WRONG ────────
//
// `acts` holds movement rows written by five different pens, in five payload
// shapes. A derivation that reads one of them and silently drops the others is
// the AB-P3 defect all over again — a world wrong by exactly the amount nobody
// looks for. All five are read, and a shape none of them explains REFUSES.
//
// | era | how identified | payload | source of the mapping |
// |---|---|---|---|
// | `ledger` | `payload._ledger` present | already the checkout reader's own output: `{iso,handle,from,toward,at,targetExtent,targetMarkId,pace,line}` | ledger-backfill.mjs § the shape of a backfilled row |
// | `journal` | `payload.payload.from` | the whole jsonl row: `{at,type,actor,seq,payload:{from,toward,crossing,within,to,pace,line_no}}` | seed-import.mjs `deriveActs` |
// | `journal-line` | `payload.payload.lines` | a live-pen act crystallized into a crossing log: `{…,payload:{ledger,lines:[<the verbatim line>],…}}` | walk-exec / crossing-exec § SETTLE AT THE SAVE, seen through the journal envelope |
// | `live` | `payload.lines` | the live pen's own act, mirrored straight into `acts` | the same, post-cutover |
// | `movement-store` | `payload.from` with no line and no envelope | the movements row's own columns: `{from,toward,pace,within,to}`, the crossing on the ACT row | world.mjs § THE WALK GAP; the mapping is `storedDepartures`' again, one level up |
//
// **THE FIFTH ERA WAS FOUND THE SAME WAY THE FOURTH WAS** — by the refusal
// firing (2026-08-28, the write-path closure). `WORLD_MOVEMENT_V2` has been on
// since movement-v2 shipped, so EVERY walk on dev goes to `dynamic.db/movements`
// and its pen writes no ledger line at all. Those acts did not exist to be
// refused until the write-path lane mirrored them; the hour they did, this
// derivation refused every one, exactly as the last line of `departureRecordOf`
// says it should. The era was then learned deliberately rather than guessed,
// which is what that refusal is for.
//
// **THE FOURTH ERA WAS FOUND BY THE FALSIFIER, NOT BY READING.** The first cut
// of this file knew three and refused three `legacy:enter`/`legacy:exit` rows
// the replay had ingested from crossings 151–153 — vermillion entering Pando
// Peak. Those rows are the live pen's line inside the journal's envelope, and
// the refusal named them rather than dropping them, which is the whole argument
// for refusing: an era nobody knew about announced itself.
//
// The last two eras carry their LINE rather than a parse — "carried VERBATIM,
// so the save appends exactly what this pen formatted rather than re-deriving
// it" — so both are read with the vendored grammar, the same one that wrote
// them. There are ZERO bare `live` DEPARTURES on `world2_dev` today: nothing
// has walked since the mirror was switched on. That path is implemented anyway
// because cutover is the point of this lane, and a NOT-YET-EXERCISED path is
// stated as such by `departureCensus` rather than left to be discovered.
//
// ── THE ORDER, AND THE 44-HANDLE TRAP UNDER IT ──────────────────────────────
//
// "latest wins" is 1.0's whole supersession rule (`currentDeparture`: "a
// resident's CURRENT departure is their last recorded one"), and `last` means
// LAST IN ARRAY ORDER, not latest by instant. world-movement.mjs says why, and
// the sentence is law here too:
//
//   "APPENDED, NOT SORTED, and the reason is era one's own law: the walk ledger
//    is append-only and 'latest wins' means latest APPENDED — which the engine
//    implements as the last match in array order. File order and instant order
//    disagree in the real ledger (the 08-08 sailing filed every passenger at
//    18:00:00.000Z and those lines were appended after walks stamped 18:16), so
//    re-sorting here would silently re-decide which leg governs a resident."
//
// In `acts` the append order of the ROWS is not the append order of the RECORD,
// because the backfill inserted the 304 pre-journal ledger departures AFTER the
// 786 journal ones (it had to: `journalBegins` needs the journal there first).
// So `ORDER BY id` puts the oldest era last and hands a resident a walk from
// July as their governing leg.
//
// This is measured, not feared. On `world2_dev`, 2026-08-28:
//
//   plain `id` order            44 of 73 handles get a DIFFERENT governing departure
//   era-then-id vs by-instant    0 of 73
//   journal era, id vs instant   0 of 72 (786 of 786 rows monotone in `at`)
//
// So the order is ERA FIRST — and inside the non-ledger era, THE INSTANT, then
// row id. `DEPARTURE_ORDER_SQL` is that clause and the endpoints use it;
// `departureRecords` asserts it was applied rather than trusting the caller.
//
// ── THE INSTANT KEY (ruled 2026-09-21, POS-154) ─────────────────────────────
//
// "A departure's order is its INSTANT, never its insertion id." The same order
// the runbook's D6 replay already uses for the holding rows (`at, id`,
// POS-153/162) — one law, not a new one.
//
// WHAT FORCED IT. `acts` held no departure between 2026-08-27T09:57:00.374Z and
// 2026-08-31T03:35:20.069Z; 438 walks lived only in `dynamic.db/movements`, and
// `acts.id` is `GENERATED ALWAYS AS IDENTITY` with that window's ids long spent
// on the 729 other acts that DID land there. A backfilled row can therefore
// only be APPENDED, above every walk September filed — and under `id` alone
// that made an 08-29 walk the governing record for the 41 of 52 actors in the
// gap who have walked since. No guard could see it: the rows ARE id-ascending.
//
// WHY IT IS SAFE. A no-op on the record as it stands, measured twice, in two
// eras: the `world2_dev` table above (era-then-id vs by-instant, 0 of 73), and
// POS-154 over prod's 2,397 non-ledger departure acts — zero instant inversions
// among 2,396 adjacent id-ascending pairs, zero governing departures moved.
//
// WHY THE `CASE`. The ledger era keeps `acts.id` alone, because it is the one
// era whose file order is genuinely not its instants: the 08-08 sailing filed
// every passenger at 18:00:00.000Z and those lines were appended after walks
// stamped 18:16. Sorting that era by instant would silently re-decide which leg
// governs a resident — the exact harm this whole section exists to prevent, in
// the other direction. `world2-live-reads.test.mjs § latest wins is LAST IN
// ARRAY ORDER` is that case, and it stays green because of the `CASE`.
//
// ONE OWNER. The keys below are the single description of this order: the SQL
// clause is built from their `sql`, and `assertDepartureOrder` is driven by
// their `of`. A second copy of an ordering is how a guard comes to bless an
// order the query never asked for.
//
// ── WHAT IS **NOT** HERE, AND WHY (the honest list) ─────────────────────────
//
//  1. THE FRAME / CARRIER OVERLAY (Stage D). `positions.mjs § withFrames` moves
//     a resident aboard a carrier to the carrier's position, and
//     `dynamic-presence.mjs` warns what its absence costs: "`present` would put
//     a passenger back on the quay they left". It cannot be ported: the fold
//     needs `world-frames.mjs foldFrames` + the vessel timetable + the
//     `movements` table, and NONE of those has a 2.0 surface. `aboard` is
//     therefore absent from every answer here rather than present-and-false —
//     a field that is always false is a lie with a schema. `DISCLOSURES.frames`
//     is what the doors say instead.
//  2. `standing` / `era` / `ledger_moved`. All three are facts about the sqlite
//     `entities` table and its refresh cadence. 2.0 has no crystallization to be
//     stale against — `positionsAt` derives at the instant asked, always — so
//     the staleness vocabulary has nothing to describe and is not invented.
//  3. THE LIVE SOUND LANE. `presentEmissionsAt` reads `legacy:emission` acts,
//     which are the crossing-save's crystallized emissions. The LIVE say path
//     writes no journal row at all (`world.mjs` calls `appendJournal` for
//     leave-mark, amend and withdraw only), so it is not mirrored, so `acts`
//     receives nothing said since the seed. This is a WRITE-path gap, named
//     here because a read tier that answered "silence" would be indistinguishable
//     from a quiet town.

// ═════════════════════════════════════════════════════════════════════════════
// VENDORED, verbatim, with provenance. Each block names its file, blob and sha.
// ═════════════════════════════════════════════════════════════════════════════

export const VENDOR = Object.freeze({
  walk: { repo: "keeminlee/postmark-world", path: "tools/walk.mjs",
          blob: "606b47f0577d35addde2df6b9398e7679f371ea1", at: "c701988f9ff937661297a8acc87a48925ba3b37f" },
  geometry: { repo: "keeminlee/postmark-world", path: "tools/geometry.mjs",
          blob: "6539c129f430fa53f071b380ed9447c6dcee0417", at: "c701988f9ff937661297a8acc87a48925ba3b37f" },
  whereIs: { repo: "keeminlee/postmark-world", path: "tools/where-is.mjs",
          blob: "83e6a766e16bea763c6a118c44d634093c99742a", at: "c701988f9ff937661297a8acc87a48925ba3b37f" },
  enterExit: { repo: "keeminlee/postmark-world", path: "tools/enter-exit.mjs",
          blob: "c3817c10a6d3ee3e1fe7b37365a0cc8ae64692a4", at: "c701988f9ff937661297a8acc87a48925ba3b37f" },
  world: { repo: "keeminlee/postmark-office", path: "src/world.mjs",
          blob: "466130cc38c03991ebf9deb1d6966a08390c6d65", at: "5aaee01c05b3c028efaaa7f6131fc1cb51c86173" },
  emissions: { repo: "keeminlee/postmark-office", path: "src/dynamic-emissions.mjs",
          blob: "826e6c30779a764dcd048233affc0ba6c9255287", at: "5aaee01c05b3c028efaaa7f6131fc1cb51c86173" },
  movement: { repo: "keeminlee/postmark-office", path: "src/world-movement.mjs",
          blob: "be594f42ac42846175e7a043d9db361069a21635", at: "5aaee01c05b3c028efaaa7f6131fc1cb51c86173" },
});

// ── geometry.mjs `pointInRect`, verbatim ────────────────────────────────────
export function pointInRect(px, py, r) {
  return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2;
}

// ── walk.mjs, verbatim ──────────────────────────────────────────────────────
//
// "This constant now derives ONLY unstamped legs — every departure declared
//  before 008b — and must stay 15 forever so their history never rewrites."
export const WALK_KM_PER_CROSSING = 15;
export const WALK_M_PER_CROSSING = WALK_KM_PER_CROSSING * 1000;

// "The same epoch and cadence the engine's currentCrossing() uses."
export const CROSSING_EPOCH_UTC = Date.UTC(2026, 5, 12); // 2026-06-12T00:00Z
export const CROSSING_MS = 12 * 3600 * 1000;

/** "Whole crossings plus the fraction through the current one." */
export function fractionalCrossing(nowMs = Date.now()) {
  return Math.max(0, (nowMs - CROSSING_EPOCH_UTC) / CROSSING_MS);
}

export const DEPARTURE_RE =
  /^- (\S+) · (\S+) · from (-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?) · toward (-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?) · at (\d+(?:\.\d+)?)(?: · within (\d+(?:\.\d+)?),(\d+(?:\.\d+)?))?(?: · to (\S+))?(?: · pace (\d+(?:\.\d+)?))?$/;

const round1 = (n) => Math.round(n * 10) / 10;
// "Two decimals in ONE division. round1(n * 10) / 10 divides twice, and
//  107/10/10 is not 1.07 in binary floating point."
const round2 = (n) => Math.round(n * 100) / 100;

/** One ledger line → the departure record. `parseWalkLedger`'s per-line half. */
export function parseDepartureLine(raw) {
  const m = String(raw ?? "").match(DEPARTURE_RE);
  if (!m) return null;
  return {
    iso: m[1], handle: m[2],
    from: { x: +m[3], y: +m[4] },
    toward: { x: +m[5], y: +m[6] },
    at: +m[7],
    targetExtent: m[8] === undefined ? null : { w: +m[8], h: +m[9] },
    targetMarkId: m[10] ?? null,
    pace: m[11] === undefined ? null : +m[11],
    line: raw,
  };
}

/** walk.mjs `formatDeparture`, verbatim — the ledger-shaped read's writer. */
export function formatDeparture({ handle, from, toward, at, targetExtent = null, targetMarkId = null, iso = null, pace = null }) {
  const stamp = iso ?? new Date().toISOString();
  const within = targetExtent ? ` · within ${round1(targetExtent.w)},${round1(targetExtent.h)}` : "";
  const intent = targetMarkId ? ` · to ${targetMarkId}` : "";
  const stride = pace > 0 ? ` · pace ${round1(pace)}` : "";
  return `- ${stamp} · ${handle} · from ${round1(from.x)},${round1(from.y)}`
       + ` · toward ${round1(toward.x)},${round1(toward.y)} · at ${at.toFixed(4)}${within}${intent}${stride}`;
}

function targetRect(departure) {
  const { toward, targetExtent } = departure;
  if (!targetExtent || !Number.isFinite(targetExtent.w) || !Number.isFinite(targetExtent.h)) return null;
  return { x: toward.x, y: toward.y, w: Math.abs(targetExtent.w), h: Math.abs(targetExtent.h) };
}

/** walk.mjs `targetEntryT`, verbatim. */
export function targetEntryT(from, toward, r) {
  if (pointInRect(from.x, from.y, r)) return 0;
  let enter = 0, exit = 1;
  for (const axis of ["x", "y"]) {
    const start = from[axis], delta = toward[axis] - start;
    const half = (axis === "x" ? r.w : r.h) / 2;
    const lo = r[axis] - half, hi = r[axis] + half;
    if (delta === 0) {
      if (start < lo || start > hi) return 1;
      continue;
    }
    const a = (lo - start) / delta, b = (hi - start) / delta;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
  }
  return Math.max(0, Math.min(1, enter <= exit ? enter : 1));
}

/**
 * walk.mjs `positionAt`, verbatim.
 *
 * "positionAt(departure, nowFractional) → where the walker is, and whether the
 *  leg is finished. For a mark/home target, arrival is the containment
 *  predicate: the derived coordinates have entered the target's recorded
 *  extent. Raw coordinates — and centre-bound walks, which record no extent —
 *  retain point arrival."
 */
export function positionAt(departure, nowFractional = fractionalCrossing()) {
  if (!departure) return null;
  const { from, toward, at } = departure;
  const centreM = Math.hypot(toward.x - from.x, toward.y - from.y);

  // "A zero-distance departure is 'stand here' — the stop. Always arrived."
  if (centreM === 0) {
    return { x: from.x, y: from.y, arrived: true, standing: true,
             legM: 0, travelledM: 0, remainingM: 0, etaCrossings: 0 };
  }

  // "A departure may carry its own pace (km/crossing) — the vessel's stride.
  //  Absent or non-positive, the town dial governs, as it always has."
  const paceM = departure.pace > 0 ? departure.pace * 1000 : WALK_M_PER_CROSSING;
  const elapsed = Math.max(0, nowFractional - at);
  const travelledM = elapsed * paceM;
  const r = targetRect(departure);
  const entryT = r ? targetEntryT(from, toward, r) : 1;
  const arrivalM = centreM * entryT;
  const candidateT = Math.min(1, travelledM / centreM);
  const candidate = {
    x: from.x + (toward.x - from.x) * candidateT,
    y: from.y + (toward.y - from.y) * candidateT,
  };
  const arrived = r ? pointInRect(candidate.x, candidate.y, r) : travelledM >= centreM;
  const t = arrived ? entryT : candidateT;
  const remainingM = Math.max(0, arrivalM - travelledM);

  return {
    x: round1(from.x + (toward.x - from.x) * t),
    y: round1(from.y + (toward.y - from.y) * t),
    arrived, standing: arrivalM === 0,
    legM: Math.round(arrivalM),
    travelledM: Math.round(Math.min(travelledM, arrivalM)),
    remainingM: Math.round(remainingM),
    etaCrossings: arrived ? 0 : round2(remainingM / paceM),
  };
}

/**
 * walk.mjs `currentDeparture`, verbatim.
 *
 * "The one that governs: a resident's CURRENT departure is their last recorded
 *  one. Supersede is not a mutation — it is a new departure from the derived
 *  position, so 'latest wins' is the whole rule."
 */
export function currentDeparture(departures, handle) {
  let cur = null;
  for (const d of departures) if (d.handle === handle) cur = d;
  return cur;
}

/** walk.mjs `publicWalker`, verbatim — "the single writer of that shape". */
export function publicWalker(handle, p) {
  return {
    handle,
    x: p.x, y: p.y,
    arrived: p.arrived, standing: p.standing,
    remaining_m: p.remainingM,
    eta_crossings: p.etaCrossings,
    toward: p.departure?.toward ?? null,
    mark_id: p.departure?.targetMarkId ?? null,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE ERA NORMALIZER — `acts` rows → walk.mjs departure records
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The ORDER clause every departure read must carry. Era first (ledger-sourced
 * before journal-sourced), then row id inside each era — see § THE ORDER above.
 *
 * It is a constant rather than a comment because the trap is silent: `ORDER BY
 * id` returns rows, in an order, with no symptom, and hands 44 of 73 residents
 * somebody else's leg.
 */
// `acts.id` is QUALIFIED, and that is not decoration. Postgres resolves a bare
// `ORDER BY id` against the OUTPUT column list first, so a caller that selected
// `id::text` would sort the ids as TEXT — "1019" before "102" — and get an order
// that is wrong inside an era with nothing to show for it. That is exactly what
// happened on this falsifier's first run against `world2_dev`, and the guard
// below is what said so. A qualified name is always an expression against the
// table, so it cannot be captured by an alias.
/** `acts.at` as a number, whichever face the driver hands it in (pg gives a Date). */
const instantOf = (row) => {
  const t = row?.at instanceof Date ? row.at.getTime() : Date.parse(String(row?.at));
  return Number.isFinite(t) ? t : null;
};

/**
 * THE ONE DESCRIPTION OF THE DEPARTURE ORDER — read by the SQL and by the guard.
 *
 * `of` answers `null` where the SQL answers NULL, and a NULL on both sides of a
 * comparison is a TIE that falls through to the next key, which is what
 * Postgres does. The mixed case (one NULL, one not) cannot arise past the era
 * key, because that key is what separates the rows the `CASE` blanks.
 */
export const DEPARTURE_ORDER_KEYS = Object.freeze([
  Object.freeze({
    name: "era",
    sql: "((payload->>'_ledger') IS NULL)",
    // FALSE sorts before TRUE, so ledger-sourced rows come first — as they must.
    of: (row) => (row?.payload?._ledger ? 0 : 1),
  }),
  Object.freeze({
    name: "instant",
    sql: "(CASE WHEN payload->>'_ledger' IS NULL THEN acts.at END)",
    of: (row) => (row?.payload?._ledger ? null : instantOf(row)),
  }),
  Object.freeze({
    name: "id",
    sql: "acts.id",
    of: (row) => { const n = Number(row?.id); return Number.isFinite(n) ? n : null; },
  }),
]);

const orderSqlOf = (keys) => `ORDER BY ${keys.map((k) => k.sql).join(", ")}`;

export const DEPARTURE_ORDER_SQL = orderSqlOf(DEPARTURE_ORDER_KEYS);

export const DEPARTURE_ACTIONS = Object.freeze(["legacy:departure", "walk"]);

/**
 * One `acts` row → one walk.mjs departure record, whichever pen wrote it.
 *
 * Returns `{ record, era }` or `{ refused, reason }`. A row this cannot read is
 * REFUSED BY NAME and never skipped — ledger-backfill's rule, verbatim: "A
 * backfill never skips a line it cannot read — the world would then be wrong by
 * exactly the amount nobody looks for."
 *
 * `row` is shaped the way `pg` hands it over: `at` a Date, `crossing` a string
 * (numeric arrives as TEXT), `payload` an object.
 */
export function departureRecordOf(row) {
  const p = row?.payload;
  if (!p || typeof p !== "object") {
    return { refused: true, reason: `act ${row?.id} carries no payload object` };
  }

  // ERA 1 — the frozen walk ledger. The backfill wrote `parseWalkLedger`'s own
  // output whole ("the parsed row, field for field, plus the raw `line`"), so
  // the record is already in walk.mjs's vocabulary and needs no mapping at all.
  if (p._ledger) {
    if (!p.from || !p.toward || !Number.isFinite(p.at)) {
      return { refused: true, reason: `act ${row.id} claims ${p._ledger} but carries no from/toward/at` };
    }
    return {
      era: "ledger",
      record: {
        iso: p.iso, handle: p.handle,
        from: p.from, toward: p.toward, at: p.at,
        targetExtent: p.targetExtent ?? null,
        targetMarkId: p.targetMarkId ?? null,
        pace: p.pace ?? null,
        line: p.line ?? null,
      },
    };
  }

  // ERA 3 / 4 — the live pen, bare or inside the journal's envelope.
  // walk-exec.mjs § SETTLE AT THE SAVE puts the line into the journal "carried
  // VERBATIM, so the save appends exactly what this pen formatted rather than
  // re-deriving it". So the line IS the record, read with the grammar that wrote
  // it — and it reads the same whether the row arrived through the mirror
  // directly or was crystallized into a crossing log first.
  const lines = Array.isArray(p.lines) ? p.lines : (Array.isArray(p.payload?.lines) ? p.payload.lines : null);
  if (lines) {
    const rec = parseDepartureLine(lines[0]);
    if (!rec) {
      return { refused: true, reason:
        `act ${row.id} is a walk whose line does not parse under the ledger grammar: ${JSON.stringify(lines[0])?.slice(0, 160)}` };
    }
    return { era: Array.isArray(p.lines) ? "live" : "journal-line", record: rec };
  }

  // ERA 2 — the world journal's own departure row. The payload is the whole
  // jsonl row and the departure's fields sit one level down. The mapping is
  // world-movement's `storedDepartures`, verbatim, because that is 1.0's ONE
  // converter for this exact payload shape:
  //
  //   "THE LEDGER'S OWN SHAPE, so a merged list is one vocabulary. `within` and
  //    `to` are the store's column names; `targetExtent` and `targetMarkId` are
  //    what walk.mjs reads. One converter, here."
  //
  //     iso: r.at, handle: r.actor,
  //     from: p.from, toward: p.toward, at: p.crossing,
  //     targetExtent: p.within ?? null, targetMarkId: p.to ?? null, pace: p.pace ?? null,
  const inner = p.payload;
  if (inner && typeof inner === "object" && inner.from && inner.toward) {
    if (!Number.isFinite(inner.crossing)) {
      return { refused: true, reason: `act ${row.id} is a journal departure with no crossing` };
    }
    return {
      era: "journal",
      record: {
        iso: p.at ?? isoOf(row.at), handle: p.actor ?? row.actor,
        from: inner.from, toward: inner.toward, at: inner.crossing,
        targetExtent: inner.within ?? null,
        targetMarkId: inner.to ?? null,
        pace: inner.pace ?? null,
        line: null,
      },
    };
  }

  // ERA 5 — THE MOVEMENT-STORE PEN, learned deliberately (2026-08-28, the
  // write-path closure) because the refusal below asked for exactly that.
  //
  // `WORLD_MOVEMENT_V2` moved the departure's pen to `dynamic.db/movements`,
  // and that pen writes NO ledger line — "no commit is made on the resident's
  // turn" is the whole point of it (world.mjs § WHERE THE DEPARTURE IS
  // WRITTEN). So its act carries neither `_ledger`, nor `lines`, nor a journal
  // envelope, and matched none of the four shapes above: every walk on a
  // movement-v2 office would have been refused by name here.
  //
  // The payload is the MOVEMENTS ROW'S OWN COLUMNS — `within` and `to`, which
  // is `storedDepartures`' vocabulary, the same one era 2 maps from. So this
  // arm is that mapping with the fields one level up, and no new spelling of a
  // departure enters the world.
  //
  // The crossing rides the ACT ROW (`acts.crossing`), not the payload, because
  // that column is where a mirrored act puts the town clock. `pg` hands numeric
  // back as TEXT, hence the Number().
  if (p.from && p.toward && !p.lines && !p._ledger) {
    // `== null` FIRST, and this file is the fourth place that trap has been
    // written down: `Number(null)` is 0 and 0 is finite, so a null crossing
    // would read as crossing ZERO — the founding instant — and hand this walk a
    // governing position from the beginning of the world. Caught by this arm's
    // own first probe, which is the only reason it is not in the branch.
    const at = row.crossing == null ? NaN : Number(row.crossing);
    if (!Number.isFinite(at)) {
      return { refused: true, reason: `act ${row.id} is a movement-store departure with no crossing on the act row` };
    }
    return {
      era: "movement-store",
      record: {
        iso: isoOf(row.at), handle: row.actor,
        from: p.from, toward: p.toward, at,
        targetExtent: p.within ?? null,
        targetMarkId: p.to ?? null,
        pace: p.pace ?? null,
        line: null,
      },
    };
  }

  return { refused: true, reason:
    `act ${row.id} (${row.action}) matches no departure era — keys: ${Object.keys(p).join(",")}. ` +
    `Four shapes are known (ledger / journal / live / movement-store); a fifth pen has written here and this ` +
    `derivation must learn it deliberately rather than guess.` };
}

const isoOf = (v) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

/**
 * Every departure the store holds, in the record's own append order.
 *
 * `rows` MUST already be ordered by `DEPARTURE_ORDER_SQL`. That is asserted
 * rather than assumed: an unordered read is the 44-handle trap and it has no
 * symptom a caller could see.
 */
export function departureRecords(rows, { strict = true } = {}) {
  assertDepartureOrder(rows);
  const records = [];
  const refusals = [];
  const eras = { ledger: 0, journal: 0, "journal-line": 0, live: 0, "movement-store": 0 };
  for (const row of rows) {
    const r = departureRecordOf(row);
    if (r.refused) { refusals.push(r.reason); continue; }
    eras[r.era] += 1;
    records.push({ ...r.record, era: r.era, act_id: String(row.id) });
  }
  if (strict && refusals.length) {
    throw new Error(
      `${refusals.length} departure act(s) match no known era, e.g.\n  ${refusals[0]}\n` +
      `A read that skipped them would answer with a world short by exactly the rows nobody looks for.`);
  }
  return { records, refusals, eras };
}

/** What a break in each key means, in that key's own words. */
function orderViolation(name, row, prev) {
  if (name === "era") {
    return `departure rows are not in the record's append order: a ledger-sourced act (${row?.id}) follows a `
      + `journal-sourced one. Query with live-reads.DEPARTURE_ORDER_SQL — ORDER BY id alone puts the `
      + `oldest era last and hands 44 of 73 residents a governing leg from July.`;
  }
  if (name === "instant") {
    return `departure rows are not instant-ascending within the non-ledger era `
      + `(act ${row?.id} at ${row?.at instanceof Date ? row.at.toISOString() : row?.at} after act ${prev?.id}). `
      + `Query with live-reads.DEPARTURE_ORDER_SQL — a backfilled act carries an early instant and a late id, `
      + `so ORDER BY acts.id alone files it last and hands its actor a governing leg from inside the hole (POS-154).`;
  }
  return `departure rows are not id-ascending within their era (${row?.id} after ${prev?.id})`;
}

/**
 * The order guard — driven by `DEPARTURE_ORDER_KEYS`, so it can only ever
 * assert the order the query actually asked for.
 *
 * Asserted rather than assumed, because the trap is silent: an unordered read
 * returns rows, in an order, with no symptom a caller could see.
 */
export function assertDepartureOrder(rows, keys = DEPARTURE_ORDER_KEYS) {
  let prev = null;
  for (const row of rows) {
    const tuple = keys.map((k) => k.of(row));
    if (prev) {
      for (let i = 0; i < keys.length; i++) {
        const a = prev.tuple[i], b = tuple[i];
        if (a == null || b == null) continue;   // NULL on both sides is a tie in SQL too
        if (b > a) break;                       // this key ascends: the row is in order
        if (b < a) throw new Error(orderViolation(keys[i].name, row, prev.row));
        // equal — fall through to the next key, exactly as the clause does
      }
    }
    prev = { tuple, row };
  }
}

/** The governing departure per handle — `currentDeparture` over every handle at once. */
export function governingDepartures(records) {
  const out = new Map();
  for (const d of records) out.set(d.handle, d);
  return out;
}

/**
 * walk.mjs `positionsAt`, over acts records.
 *
 * "Every resident with a record, at one instant — the presence layer's input
 *  (ruling 1). Placed residents with no departure are not here: they have no
 *  record, so their position is their home, which only the office can resolve."
 */
export function positionsAt(records, nowFractional = fractionalCrossing()) {
  const byHandle = governingDepartures(records);
  const out = {};
  for (const [handle, d] of byHandle) out[handle] = { ...positionAt(d, nowFractional), departure: d };
  return out;
}

/** walk.mjs `publicWalkers`, over acts records. */
export function publicWalkers(records, nowFractional = fractionalCrossing()) {
  return Object.entries(positionsAt(records, nowFractional)).map(([h, p]) => publicWalker(h, p));
}

/** Which era answered for how many rows — the doors disclose it. */
export function departureCensus(records) {
  const eras = { ledger: 0, journal: 0, "journal-line": 0, live: 0, "movement-store": 0 };
  for (const r of records) eras[r.era] = (eras[r.era] ?? 0) + 1;
  return eras;
}

// ═════════════════════════════════════════════════════════════════════════════
// THE GROUND HALF — where-is.mjs over `marks` + `identities` rows
// ═════════════════════════════════════════════════════════════════════════════
//
// ── THE ROW → RECORD MAPPING, and its sharpest edge ─────────────────────────
//
// | 1.0 | `marks` row | note |
// |---|---|---|
// | `id`               | `slug`   | the `<by>/<name>` path identity |
// | `by`               | `owner`  | the resident HANDLE |
// | `household`        | `owner`  | **see below** |
// | `at` / `extent`    | `geometry` | `{at:{x,y},extent:{w,h}}` |
// | `world.households` | `identities` rows | handle → `gh:<id>` / `solo:<h>` / `login:<h>` |
//
// **1.0's `mark.household` is a HANDLE, and 2.0's `marks.household` COLUMN is
// not it.** The column carries the RESOLVED key (`gh:…`/`solo:…`) — it is 1.0's
// `_cred`, the standing lane's sharpest edge, and reading it as the handle here
// would make `parcelsFor`'s `p.household === handle` false for every parcel in
// the town. The handle lives in `owner`.
//
// That `owner === household` on 1.0's side is a FACT OF TODAY'S REGISTER (977
// of 977 marks, measured at c701988f), not a law — the seed drops the authored
// `household:` field because a column held it. `admissionNotes` reports it if a
// consumer ever needs the two to differ, and a 005-class column is the fix.

export const QUAY_MARK_ID = "the-town/the-quay";

/**
 * dynamic-entities.mjs `VESSEL_HANDLE` / `NON_ENTITY_ACTORS`, verbatim.
 *
 * SHE IS NOT A RESIDENT. `dynamic-presence.mjs` deletes her from the departures
 * before the union is built — "she is a mark that moves, not a resident, and the
 * entities table she is excluded from is what feeds the departures below" — and
 * `worldWalkers` publishes her separately, from the TIMETABLE, with
 * `source: "timetable"`, because "her position is f(timetable, clock)".
 *
 * `acts` does not make that distinction: she declares departures like anyone
 * else, and the first cut of `/world2/present` duly listed her among the
 * residents. The A/B against the lab's 1.0 door is what found it — she was one
 * of three handles 2.0 placed and 1.0 did not.
 *
 * She is excluded from the RESIDENT union and kept in `/world2/positions`, which
 * is `positionsAt`'s answer over the record and has no such exclusion in 1.0
 * either. Two doors, two questions.
 */
export const NON_ENTITY_ACTORS = Object.freeze(["the-post-office"]);

/** where-is.mjs `NOWHERE`, verbatim — "The honest nowhere." */
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });

/**
 * The fold-shaped world 1.0's readers expect, built from DB rows.
 *
 * `marks` are `marks` table rows; `identities` are `identities` rows. Nothing
 * is invented: every field is a column, renamed into the vocabulary the ported
 * law reads.
 */
export function worldFromRows({ marks = [], identities = [] } = {}) {
  const asMark = (m) => ({
    id: m.slug,
    by: m.owner,
    // The declared household, which in 1.0 is a handle (§ the sharpest edge).
    household: m.owner,
    kind: m.kind,
    at: m.geometry?.at ?? null,
    extent: m.geometry?.extent ?? null,
    ...(m.geometry?.points ? { points: m.geometry.points } : {}),
    // The RESOLVED key, kept under its 1.0 name so nothing confuses it with the
    // handle above.
    _cred: m.household ?? null,
    tier: m.data?.tier ?? null,
    status: m.status,
  });
  const standing = marks.filter((m) => m.status === "standing").map(asMark);
  return {
    marks: standing,
    parcels: standing.filter((m) => m.kind === "parcel" && Number.isFinite(m.at?.x)),
    households: Object.fromEntries(identities.map((i) => [i.handle, i.household])),
  };
}

/**
 * where-is.mjs `householdOf`, verbatim.
 *
 * "A handle the registry does not know falls back to what it always did — the
 *  household its own marks carry, else the handle. Registry lag must never
 *  unplace anyone; it may only leave them ungrouped."
 */
export function householdOf(handle, world) {
  const declared = world?.households?.[handle];
  if (declared) return declared;
  const own = (world?.marks ?? []).find((m) => m.by === handle && m.household);
  return own?.household ?? handle;
}

const parcelKey = (parcel, world) => householdOf(parcel?.household, world);

/**
 * where-is.mjs `parcelsFor`, verbatim.
 *
 * "Plural because a household may hold several (the claim cap is 3, and the
 *  Reeves' four stand by exception) — and because the reading defect this fixes
 *  was exactly the assumption that a resident's ground is a resident's own."
 */
export function parcelsFor(handle, world) {
  if (!handle) return [];
  const parcels = world?.parcels ?? [];
  const key = householdOf(handle, world);
  const own = parcels.filter((p) => p.household === handle);
  const family = parcels.filter((p) => p.household !== handle && parcelKey(p, world) === key);
  return [...own, ...family];
}

/**
 * where-is.mjs `homeOf`, verbatim.
 *
 * "WHERE DO YOU LIVE. The parcel is an AREA and a standpoint is a POINT, so
 *  something must choose: this takes the centre (CALLS.md C2)."
 */
export function homeOf(handle, world) {
  const parcels = parcelsFor(handle, world);
  const parcel = parcels[0] ?? null;
  if (!parcel || !Number.isFinite(parcel.at?.x) || !Number.isFinite(parcel.at?.y)) return { ...NOWHERE };
  return {
    x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel",
    mark_id: parcel.id ?? null, parcel,
    household: householdOf(handle, world),
    via: parcel.household === handle ? "own" : "household",
    household_parcels: parcels.map((p) => p.id),
  };
}

/**
 * where-is.mjs `porchOf`, verbatim.
 *
 * "The coordinate is READ FROM THE RECORD, never held here. A world whose fold
 *  has no quay has no porch, and answers NOWHERE — refuse or disclose an absent
 *  input, never quietly substitute for it."
 */
export function porchOf(world) {
  const quay = (world?.marks ?? []).find((m) => m.id === QUAY_MARK_ID);
  if (!quay || !Number.isFinite(quay.at?.x) || !Number.isFinite(quay.at?.y)) return { ...NOWHERE };
  return { x: quay.at.x, y: quay.at.y, placed: true, source: "quay", mark_id: quay.id };
}

/**
 * where-is.mjs `whereIs`, verbatim.
 *
 * "WHERE ARE YOU. A declared walk wins — it is the resident's own most recent
 *  statement about themselves — then the ground you live on, then the porch.
 *  THREE TIERS, one derivation, and each says which it is."
 */
export function whereIs(handle, { world = null, departures = [], at = fractionalCrossing() } = {}) {
  const departure = currentDeparture(departures ?? [], handle);
  if (departure) {
    const p = positionAt(departure, at);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return { x: p.x, y: p.y, placed: true, source: "walk",
               mark_id: departure.targetMarkId ?? null, position: p, departure };
    }
  }
  const home = homeOf(handle, world);
  if (home.placed) return home;
  return porchOf(world);
}

/**
 * positions.mjs `positionRoster`, verbatim.
 *
 * "WHO TO ASK ABOUT: everyone with a walk on record, plus every household
 *  holding ground [plus] THE TOWN ROLL — the third term, and the one that made
 *  the union honest ... 28 of 103 residents were not answered wrongly, they
 *  were never asked about."
 *
 * The roll in 2.0 is `town_roll` — the TOWN repo's WHITE_PAGES at the pinned
 * `town_sha`, which is the same roster 1.0's `townRoll()` hands its own doors.
 * It was `identities` (the world repo's households.json) until Keemin ruled the
 * seam on 2026-08-29; that list was NARROWER than the town's by twelve handles,
 * and #1864's whole lesson is that a narrower roster does not answer wrongly —
 * it leaves people unasked-about.
 */
export function positionRoster({ departures = [], world = null, roll = [] } = {}) {
  return [
    ...(departures ?? []).map((d) => d?.handle),
    ...((world?.parcels ?? []).map((p) => p?.household)),
    ...(roll ?? []),
  ].filter(Boolean);
}

/**
 * where-is.mjs `publicResidents`, verbatim.
 *
 * "There are not three kinds of resident ... 'arrived' and 'standing' are THE
 *  SAME STATE. Both are a person at rest at a place. What differed was only
 *  PROVENANCE ... So: one list, and exactly two states — `moving` or still."
 *
 * `source` IS THE HONESTY: a resident on the porch reads `quay`, never `walk`.
 */
export function publicResidents(handles, { world = null, departures = [], at = fractionalCrossing() } = {}) {
  const seen = new Set();
  const out = [];
  for (const handle of handles ?? []) {
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    const here = whereIs(handle, { world, departures, at });
    if (!here.placed) continue;
    const p = here.position ?? null;
    const moving = Boolean(p && p.arrived === false);
    out.push({
      handle,
      x: here.x, y: here.y,
      source: here.source,
      moving,
      toward: moving ? (here.departure?.toward ?? null) : null,
      remaining_m: moving ? p.remainingM : 0,
      eta_crossings: moving ? p.etaCrossings : 0,
      mark_id: here.mark_id ?? null,
    });
  }
  return out;
}

/**
 * positions.mjs `everyonePlaced`, over rows — the union both doors read.
 *
 * The vessel is dropped from BOTH the roster and the departures, which is
 * `dynamic-presence.mjs`'s own two-step ("belt and braces: she is not in this
 * table to begin with"). Dropping her from the roster alone would leave her
 * departures able to place a passenger; dropping her from the departures alone
 * would leave the roll able to name her.
 */
export function everyonePlaced({ world = null, departures = [], at, roll = [] } = {}) {
  const notVessel = (h) => !NON_ENTITY_ACTORS.includes(h);
  const deps = (departures ?? []).filter((d) => notVessel(d.handle));
  const roster = positionRoster({ departures: deps, world, roll: (roll ?? []).filter(notVessel) })
    .filter(notVessel);
  return publicResidents(roster, { world, departures: deps, at });
}

/**
 * world.mjs `walkersAround`, verbatim.
 *
 * "THE BOUND HAS TO BE A RADIUS ... So the roll stays whole and the RENDER gets
 *  a radius: everyone is still derived, and what is said is what stands near
 *  you. ... a cap is a rendering decision and a reader must be able to tell it
 *  from an empty room."
 */
export const PRESENCE_DIALS = Object.freeze({ near_radius_m: 500, near_cap: 10 });

export function walkersAround(walkers, { x, y, radiusM = PRESENCE_DIALS.near_radius_m, limit = PRESENCE_DIALS.near_cap } = {}) {
  const d = (w) => Math.round(Math.hypot((w.x ?? 0) - x, (w.y ?? 0) - y));
  const hits = walkers
    .map((w) => ({ ...w, distance_m: d(w) }))
    .filter((w) => w.distance_m <= radiusM)
    .sort((a, b) => a.distance_m - b.distance_m || (a.handle < b.handle ? -1 : 1));
  const shown = hits.slice(0, limit);
  return {
    standing_at: { x, y },
    radius_m: radiusM,
    count: hits.length,
    shown: shown.length,
    capped: hits.length > shown.length,
    beyond_radius: walkers.length - hits.length,
    roll: walkers.length,
    walkers: shown,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// PRESENCE OF SOUND — dynamic-emissions.mjs over `legacy:emission` acts
// ═════════════════════════════════════════════════════════════════════════════
//
// The emission acts are the crossing-save's crystallized emissions, so their
// payload is the jsonl row and the emission's own fields sit one level down:
//
//   { at, id, type:"emission", actor, payload:{ class, x, y, text, spoken_by,
//     human, aboard, place, ttl_min, radius_m, class_version, ttl_expires_at } }
//
// `born_at` is the act's own `at`; `ttl_expires_at` is stamped ON THE ROW at
// birth, and that stamping is the law rather than a convenience:
//
//   "The law this instance was born under, and where it was read from. An
//    instance carries the version it conformed to; a dial changed tomorrow does
//    not retroactively re-govern what happened today."

export const SOUND = "sound";

/** One `acts` row → the emission record. `{emission}` or `{refused, reason}`. */
export function emissionOf(row) {
  const p = row?.payload;
  const e = p?.payload;
  if (!e || typeof e !== "object") {
    return { refused: true, reason: `act ${row?.id} is an emission with no inner payload` };
  }
  const born = isoOf(row.at) ?? p.at ?? null;
  if (!born || !e.ttl_expires_at) {
    return { refused: true, reason: `act ${row?.id} carries no born_at/ttl_expires_at — presence is a TTL query and has nothing to ask` };
  }
  return {
    emission: {
      id: p.id ?? `act:${row.id}`,
      class: e.class ?? SOUND,
      source: row.actor ?? p.actor,
      x: e.x, y: e.y,
      born_at: born,
      ttl_expires_at: e.ttl_expires_at,
      props: {
        spoken_by: e.spoken_by ?? row.actor,
        text: e.text ?? "",
        aboard: Boolean(e.aboard),
        place: e.place ?? null,
        human: Boolean(e.human),
        class_version: e.class_version ?? null,
        // The radius THIS instance was born under. Kept beside the row because
        // it is the only defensible earshot for a historical emission.
        radius_m: e.radius_m ?? null,
        ttl_min: e.ttl_min ?? null,
      },
      act_id: String(row.id),
    },
  };
}

/**
 * dynamic-emissions.mjs `presentEmissions`, ported.
 *
 * "PRESENCE at an instant — the emissions still hanging in the air. A query,
 *  never a delete. The row survives its own TTL because the occurrence has to
 *  reach a crossing log before it may be dropped; what expires is the ANSWER,
 *  which is what 'presence fades' actually means."
 *
 * The predicate is 1.0's own SQL, moved:
 *   WHERE class = ? AND born_at <= ? AND ttl_expires_at > ?  ORDER BY born_at, id
 */
export function presentEmissionsAt(rows, atMs = Date.now(), { cls = SOUND } = {}) {
  const now = new Date(atMs).toISOString();
  const out = [];
  for (const row of rows) {
    const r = emissionOf(row);
    if (r.refused) continue;
    const e = r.emission;
    if (e.class !== cls) continue;
    if (!(e.born_at <= now)) continue;
    if (!(e.ttl_expires_at > now)) continue;
    out.push(e);
  }
  return out.sort((a, b) => (a.born_at < b.born_at ? -1 : a.born_at > b.born_at ? 1 : (a.id < b.id ? -1 : 1)));
}

/**
 * WHICH OF THOSE REACH A POINT.
 *
 * **The radius is a PARAMETER and this is deliberate — the law has two readings
 * and the ruling is not this lane's to make.** Stated plainly rather than
 * picked:
 *
 *   PER-ACT   each emission's own stamped `props.radius_m`. Gold §3 rule 2's
 *             per-act determinism, and the reason `recordEmission` stamps it:
 *             "a dial changed tomorrow does not retroactively re-govern what
 *             happened today." Every historical emission then keeps the earshot
 *             it was actually heard at.
 *   CURRENT   one dial for the whole answer, which is what `voices.mjs
 *             heardBy` does today: `distM(point, ear) <= earshotM` with
 *             `earshotM = EARSHOT_M`, the class mark's live value.
 *
 * They differ the moment `the-town/sound`'s `radius_m` moves — and it HAS moved
 * (`class_version` runs 1 → 2 across the seeded rows). Neither reading is
 * obviously wrong: 1.0's live ear uses the current dial, 1.0's own emission row
 * argues for the stamped one. `mode` says which was applied, on every answer.
 */
export function earshotAt(emissions, { x, y }, { radiusM = null, mode = "per-act" } = {}) {
  const out = [];
  for (const e of emissions) {
    const r = mode === "current" ? radiusM : (e.props.radius_m ?? radiusM);
    if (!Number.isFinite(r)) continue;
    const d = Math.hypot((e.x ?? 0) - x, (e.y ?? 0) - y);
    if (d <= r) out.push({ ...e, distance_m: Math.round(d), heard_at_radius_m: r });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// CONTAINMENT — enter-exit.mjs over `legacy:enter` / `legacy:exit` acts
// ═════════════════════════════════════════════════════════════════════════════

export const PASSAGE_ACTIONS = Object.freeze(["legacy:enter", "legacy:exit", "enter", "exit"]);

/** One `acts` row → the passage record `occupancyAt` folds. */
export function passageOf(row) {
  const p = row?.payload;
  if (!p || typeof p !== "object") return { refused: true, reason: `act ${row?.id} carries no payload` };

  // The frozen ledger's rows: the backfill wrote `parseEnterExitLedger`'s own
  // output whole, so the record is already in the fold's vocabulary.
  if (p._ledger && p.act && p.mark) {
    return { era: "ledger", passage: { iso: p.iso, handle: p.handle, act: p.act, mark: p.mark, at: p.at, word: p.word ?? null, line: p.line ?? null } };
  }

  // The live pen: crossing-exec.mjs writes the lines VERBATIM, same as
  // walk-exec — bare when the mirror wrote the act, one level down when the
  // crossing-save crystallized it into a journal row first. Both are the same
  // pen's line and both are read with the grammar that wrote it.
  const lines = Array.isArray(p.lines) ? p.lines : (Array.isArray(p.payload?.lines) ? p.payload.lines : null);
  if (lines) {
    const line = lines[0];
    const m = String(line ?? "").match(ENTER_EXIT_RE);
    if (!m) return { refused: true, reason: `act ${row.id} is a crossing whose line does not parse: ${JSON.stringify(line)?.slice(0, 160)}` };
    return { era: Array.isArray(p.lines) ? "live" : "journal-line", passage: {
      iso: m[1], handle: m[2], act: m[3], mark: m[4], at: +m[5],
      word: m[6] ?? (m[3] === "enters" ? DEFAULT_ENTRY_WORD : null), line } };
  }

  return { refused: true, reason: `act ${row.id} (${row.action}) matches no passage era — keys: ${Object.keys(p).join(",")}` };
}

// enter-exit.mjs's grammar, vendored. "BOTH ERAS PARSE. Rows written before
// 2026-08-26 say `at` and are read exactly as they were written."
export const ENTER_EXIT_RE =
  /^- (\S+) · (\S+) · (enters|exits) (\S+) · (?:ferry|at) (\d+(?:\.\d+)?)(?: · word (welcomed|neutral|opposed))?$/;
export const DEFAULT_ENTRY_WORD = "neutral";

/**
 * enter-exit.mjs `occupancyAt`, verbatim.
 *
 * "Position in the tree is a stack: the containment chain of marks a walker has
 *  crossed INTO, root-first, innermost last ... Pure over (acts, clock), exactly
 *  like positionAt: any clone replays it and derives the same occupancy."
 *
 *   enters M, word ≠ opposed  → push M
 *   enters M, word = opposed  → nothing (refused at the threshold; the act is
 *                               still in the record)
 *   exits M                   → truncate to just before M
 */
export function occupancyAt(passages, at = Infinity) {
  const stacks = new Map();
  for (const a of passages) {
    if (!(a.at <= at)) continue;
    const stack = stacks.get(a.handle) ?? [];
    if (a.act === "enters") {
      if (a.word === "opposed") continue;
      if (!stack.includes(a.mark)) stack.push(a.mark);
    } else if (a.act === "exits") {
      const i = stack.indexOf(a.mark);
      if (i >= 0) stack.length = i;
    }
    stacks.set(a.handle, stack);
  }
  for (const [h, s] of stacks) if (!s.length) stacks.delete(h);
  return stacks;
}

/** enter-exit.mjs `withinOf`, verbatim. */
export function withinOf(occupancy, handle) {
  const s = occupancy.get(handle) ?? [];
  return s.length ? s[s.length - 1] : null;
}

/** enter-exit.mjs `occupantsOf`, verbatim. */
export function occupantsOf(occupancy) {
  const by = new Map();
  for (const [handle, stack] of occupancy)
    for (const mark of stack) {
      if (!by.has(mark)) by.set(mark, []);
      by.get(mark).push(handle);
    }
  for (const list of by.values()) list.sort();
  return by;
}

/**
 * Passage rows → the fold's input, in the record's own order.
 *
 * The same era-first ordering as departures, and for the same reason: the
 * backfill's ledger rows were inserted after the journal's. Today `acts` holds
 * ONLY ledger-sourced passages (AB-P2's 158), so the clause is a no-op — which
 * is exactly when it is cheapest to get right.
 *
 * IT NO LONGER TAKES THE INSTANT KEY, and the narrowing is deliberate (POS-154,
 * 2026-09-21). This constant used to BE `DEPARTURE_ORDER_SQL`, so the departure
 * ruling would have ridden into the passage read by alias — and nobody measured
 * passages. A crossing's enter/exit acts have a live era as well as a ledger
 * one, so the `CASE` would begin ordering real rows by instant on the strength
 * of a ruling that was about walks. It takes the same keys MINUS the instant,
 * which is byte-for-byte the clause this read has always carried; re-uniting
 * them is a measurement and a ruling of its own.
 */
export const PASSAGE_ORDER_KEYS = Object.freeze(DEPARTURE_ORDER_KEYS.filter((k) => k.name !== "instant"));
export const PASSAGE_ORDER_SQL = orderSqlOf(PASSAGE_ORDER_KEYS);

export function passageRecords(rows, { strict = true } = {}) {
  const passages = [];
  const refusals = [];
  for (const row of rows) {
    const r = passageOf(row);
    if (r.refused) { refusals.push(r.reason); continue; }
    passages.push({ ...r.passage, era: r.era, act_id: String(row.id) });
  }
  if (strict && refusals.length) {
    throw new Error(`${refusals.length} passage act(s) match no known era, e.g.\n  ${refusals[0]}`);
  }
  return { passages, refusals };
}

// ═════════════════════════════════════════════════════════════════════════════
// THE TRIPWIRES — premises that are FACTS OF TODAY'S REGISTER, not law
// ═════════════════════════════════════════════════════════════════════════════
//
// standing.mjs's `admissionNotes` shape: three things this port stands on are
// true of the store as it is rather than true by law, so each gets a check that
// fires when it stops being true instead of a comment nobody re-reads.

export function admissionNotes({ marks = [], identities = [], roll = null, departureRecords: recs = [], world = null } = {}) {
  const notes = [];
  const w = world ?? worldFromRows({ marks, identities });

  // 1. THE QUAY. `porchOf` reads the record; a world with no quay answers
  //    NOWHERE, and a third of the roll silently leaves the answer.
  if (!w.marks.some((m) => m.id === QUAY_MARK_ID)) {
    notes.push(`no ${QUAY_MARK_ID} stands in the register — the porch cannot be read, so every resident with ` +
               `neither a walk nor ground drops out of the answer instead of standing at the town's porch.`);
  }

  // 2. THE ROLL. `town_roll` is the roster this door asks about since Keemin's
  //    2026-08-29 ruling. An empty one silently narrows the question to "who has
  //    DONE something", which is issue #1864 exactly. The note is about the ROLL
  //    THE CALLER ACTUALLY USED, not about a table it might have read — an
  //    answer built from an empty roll is #1864 whatever the store holds.
  if (Array.isArray(roll) && !roll.length) {
    notes.push(`the town roll is empty — the roll is the third term of the roster union, and without it this ` +
               `answer can only contain residents with a walk record or ground (#1864: 28 of 103 went unasked-about). ` +
               `Run stamp-ingest.mjs against a town checkout at projection_heads['town'].`);
  }
  // `identities` is no longer the roll, but it is still the whole of what this
  // answer knows about HOUSEHOLDS — `householdOf` falls back to the handle
  // without it, and `parcelsFor` then groups nobody with their family.
  if (!identities.length) {
    notes.push(`identities is empty — the roll still names everyone, but no resident can be grouped into a ` +
               `household, so a resident standing on a housemate's parcel drops back to the porch.`);
  }

  // 3. THE HANDLE/HOUSEHOLD IDENTITY. 1.0's `mark.household` is a handle and
  //    2.0 has no column for it, so `owner` stands in. True on 977 of 977 marks
  //    at c701988f; it is not a law.
  const parcelsNotOwnedByTheirOwner = w.parcels.filter((p) => p.household !== String(p.id).split("/")[0]);
  if (parcelsNotOwnedByTheirOwner.length) {
    notes.push(`${parcelsNotOwnedByTheirOwner.length} parcel(s) have an owner that is not their slug's prefix ` +
               `(e.g. ${parcelsNotOwnedByTheirOwner[0].id}) — the port reads 1.0's mark.household as marks.owner, ` +
               `and that stand-in wants a real column the day the two can differ.`);
  }

  // 4. THE ERAS. A live walk act is a path nothing has exercised yet.
  const eras = departureCensus(recs);
  if (eras.live) {
    notes.push(`${eras.live} live 'walk' act(s) are being read through the vendored DEPARTURE_RE. This is the ` +
               `first traffic on that era; the falsifier's line round-trip is what stands behind it.`);
  }
  if (eras["movement-store"]) {
    notes.push(`${eras["movement-store"]} movement-store 'walk' act(s) are being read through the mapping rather ` +
               `than the line grammar — the WORLD_MOVEMENT_V2 pen writes no ledger line, so there is no line to ` +
               `round-trip and the falsifier's line proof does NOT stand behind these. What stands behind them ` +
               `is that the payload carries the movements row's own columns, so the mapping is storedDepartures' ` +
               `own. First traffic on that era began 2026-08-28 with the write-path closure.`);
  }
  return notes;
}

/** What every door in this tier says about what it could not do. */
export const DISCLOSURES = Object.freeze({
  frames: "no carrier frames: a resident aboard a moving mark reads at the place their own walk record " +
          "put them, not at the carrier's position. Stage D's frame fold has no 2.0 surface (it needs " +
          "world-frames.mjs, the vessel timetable and the movements table), so the overlay is absent " +
          "rather than wrong — and `aboard` is absent from these answers rather than always false.",
  live_sound: "no live sound: the say path writes no journal row, so nothing said since the seed is " +
              "mirrored into acts. Emission presence here is the crossing-save's crystallized record only.",
  no_staleness: "no staleness to disclose: 2.0 derives position at the instant asked, from the store's own " +
                "records. There is no crystallized entities table to be behind the ledger, so 1.0's " +
                "`ledger_moved` / `as_of` disclosures have nothing to describe.",
  // THE ROLL'S SOURCE WAS UNRULED AND IS NOW RULED (Keemin, 2026-08-29): the
  // TOWN's roll, for #1864's reason. `town_roll` is that roster as a projection
  // of the town repo at the pinned `town_sha`, derived by the town's own reader
  // under the door's own admission grammar (roll-ingest.mjs). `identities` keeps
  // its own job — the household KEY a resident's ground is grouped by — so this
  // answer reads two rosters for two questions and says so.
  roll_source: "the roll here is `town_roll` — the TOWN repo's WHITE_PAGES at the pinned town_sha, which is " +
               "the same roster 1.0's doors take (`ctx.roll`). Household grouping still comes from " +
               "`identities` (the world repo's households.json): the roll says who to ask about, the " +
               "identities say whose ground counts as yours. A resident in the roll with no identity row " +
               "is asked about and stands alone — registry lag never unplaces anyone.",
});
