// position-projection.mjs — WHERE EVERYONE STANDS, KEPT RATHER THAN RE-DERIVED
// (POS-264, "the office holds a crowd").
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// `positions.mjs` answers "where is everyone" from the whole departure record,
// and every door that asks it pays for the record first: `departuresAcrossEras`
// reads the frozen walk ledger at main (a `git show`, plus the engine's
// materialise at the blessed ref) and the store's every departure act, on every
// call. Hearing asks it once PER VOICE. Measured on this tree
// (`tools/bench-hearing.mjs`, a room of 40, a fixture store of 2,400 acts): one
// `hear` took 28–52 s, ~1 s per voice, and every millisecond of it was reading
// the same record again. The answer itself — who stands where — is a hundred
// and thirty rows.
//
// So the office KEEPS the one thing the whole record reduces to: each
// resident's GOVERNING departure. That reduction is exact and it is the
// engine's own rule, not a summary of it — `walk.mjs § currentDeparture` takes
// the last record for a handle and nothing else, and `where-is.mjs § whereIs`
// reads nothing but that one record (and the fold, for anyone who never
// walked). A list holding only the governing record per handle, in the order
// each handle first appeared, therefore answers `everyonePlaced` byte for byte
// the way the whole record does. `test/position-projection.test.mjs` holds that
// as the EQUALITY FALSIFIER over a replayed sequence of acts.
//
// ── WHAT IS NOT HERE ────────────────────────────────────────────────────────
//
// No fs, no git, no engine import, no store. The derivation stays where it is
// (`world.mjs § departuresAcrossEras`) and is handed in as `rebuild`; it is how
// this projection is born, how it is re-born when it ages out, and what the
// falsifier compares it against. Nothing in this file decides where anybody is.
//
// NO FRAME. The brief asked for one per entry, and the record cannot supply it:
// since POS-247 (2026-09-26) no walk record yields a frame, and
// `world-frames.mjs § foldFrames` answers the world frame for every fold. The one frame left is OCCUPANCY (the enter-exit record), written by the
// enter/exit and ride doors in `world-crossings.mjs` / `world-ride.mjs`, which
// this lane does not own. A frame field kept current by nothing would be a
// photograph, so it is absent until a writer there calls in.

/** The earshot this grid is sized for — `voices.mjs § EARSHOT_M`, which a pure module cannot import. */
export const GRID_CELL_M = 64;

/**
 * How long a projection may be trusted without a rebuild. The office's own
 * walk door records in the same step (`record` below), so this bounds only the
 * writers that do not call in: the enter door's set-down (`world-apex.mjs §
 * spawnOnEnter`) and any pen outside this process.
 */
export const PROJECTION_MAX_AGE_MS = 60_000;

/**
 * THE FOLD: the governing departure per handle, in first-appearance order.
 *
 * `Map.set` on an existing key keeps the key's original position, which is
 * exactly the roster order `positionRoster` + `publicResidents` produce from
 * the whole list (the roster keeps a handle's FIRST mention, the engine takes
 * its LAST record). Both halves of that sentence are the engine's; this map is
 * where they meet.
 */
export function governingOf(departures = []) {
  const out = new Map();
  for (const d of departures ?? []) if (d?.handle) out.set(d.handle, d);
  return out;
}

/**
 * THE WALK DOOR'S MOVEMENT, AS THE RECORD WILL HAND IT BACK.
 *
 * `movement` is `world.mjs § walkViaOffice`'s own object — the values it
 * writes, with the clock read once (POS-198). The shape is `storedDepartures`'
 * over `live-reads.mjs § departureRecordOf`'s movement-store arm: `acts.at` is
 * `movement.at`, `acts.crossing` is `movement.crossing`, and the payload's
 * `within`/`to` become `targetExtent`/`targetMarkId`. The falsifier builds the
 * act with the live `walkEntry`, reads it back through `storedDepartures`, and
 * holds the two equal.
 */
//
// THROUGH THE SAME SERIALISATION THE PEN USES. The act's payload is JSON and its
// crossing a numeric column, so what comes back is what JSON can say: a door
// that computed `y: -0` (round1 of a small negative) reads back `0`. Both
// answer the same position, and a record that is not byte-equal to the one the
// rebuild will read is not the record — the replay caught exactly this.
const asStored = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

export function recordOfMovement(movement) {
  return {
    iso: movement.at, handle: movement.actor,
    from: asStored(movement.from), toward: asStored(movement.toward), at: asStored(movement.crossing),
    targetExtent: asStored(movement.within), targetMarkId: movement.toMark ?? null, pace: asStored(movement.pace),
    source: "store",
  };
}

/**
 * One projection. `rebuild(atMs)` answers `{ departures, disclosed, eras,
 * ledgerUnreadable, store_records? }` — `departuresAcrossEras`' own shape.
 */
export function createPositionProjection({ rebuild, maxAgeMs = PROJECTION_MAX_AGE_MS, now = () => Date.now() } = {}) {
  let governing = null;      // Map handle -> governing record
  let meta = null;           // the rebuild's disclosure, carried whole
  let builtAt = null;
  let recorded = 0;          // records applied in-step since the last rebuild
  let building = null;       // one rebuild in flight, shared by every caller that arrives during it
  let pending = [];          // records written while a rebuild was reading — it may have read before them
  let epoch = 0;             // bumps on every change, so a grid knows when it is stale

  async function ensure() {
    if (governing && now() - builtAt <= maxAgeMs) return;
    if (!building) {
      const startedAt = now();
      building = (async () => {
        const got = await rebuild(startedAt);
        governing = governingOf(got?.departures ?? []);
        // A walk recorded while the rebuild was reading may be missing from
        // what it read, and it is newer than anything it did read. Applied in
        // write order after it, so the last write still governs either way.
        for (const rec of pending) governing.set(rec.handle, rec);
        pending = [];
        meta = {
          disclosed: [...(got?.disclosed ?? [])],
          eras: got?.eras ?? [],
          ledgerUnreadable: got?.ledgerUnreadable ?? null,
          ...(got?.store_records != null ? { store_records: got.store_records } : {}),
          // POS-302: the clearing's snapshot this rebuild stood on, and how many acts past it.
          ...(got?.snapshot ? { snapshot: got.snapshot } : {}),
        };
        builtAt = startedAt;
        recorded = 0;
        epoch += 1;
      })().finally(() => { building = null; });
    }
    await building;
  }

  return {
    /** The governing records, one per handle, in the order the whole record would name them. */
    async departures() {
      await ensure();
      return [...governing.values()];
    },

    /** The rebuild's own disclosure plus the projection's age, for doors that carry `disclosed`. */
    async snapshot() {
      await ensure();
      return {
        departures: [...governing.values()],
        ...meta,
        disclosed: [...meta.disclosed],
        built_at: new Date(builtAt).toISOString(),
        recorded_since_build: recorded,
        epoch,
      };
    },

    /** One resident's entry: where (the governing record), since, and toward. Null for a handle with no record. */
    async entry(handle) {
      await ensure();
      const rec = governing.get(handle);
      if (!rec) return null;
      return { handle, where: rec, since: rec.iso ?? null, toward: rec.toward ?? null };
    },

    /**
     * IN THE SAME STEP AS THE WRITE. `rec` is the departure exactly as
     * `storedDepartures` will hand it back once the act is read — the walk door
     * builds it from the values it just wrote. A projection that has not been
     * built, with no rebuild in flight, ignores it: the next rebuild reads the
     * act itself.
     */
    record(rec) {
      if (!rec?.handle) return false;
      if (building) pending.push(rec);
      if (!governing) return Boolean(building);
      governing.set(rec.handle, rec);
      recorded += 1;
      epoch += 1;
      return true;
    },

    /** Forget everything; the next read rebuilds from the record. */
    invalidate() { governing = null; meta = null; builtAt = null; recorded = 0; pending = []; epoch += 1; },

    get epoch() { return epoch; },
  };
}

// ── THE GRID ─────────────────────────────────────────────────────────────────
//
// `near(point, radius)` without reading everyone. A cell is at least an earshot
// wide, so a hearing question touches at most nine cells.
//
// Positions change with the clock, so the grid holds only rows that CANNOT move
// until something is recorded: a resident whose walk has arrived, a resident
// on their ground, a resident at the Origin. Everyone else is DRIFTING — mid-
// leg, or carried by a frame — and is re-placed at the instant asked, through
// the same `rowsFor` the static rows came from. A drifting walker who has
// arrived by the time of the question is moved into the grid then.

const cellOf = (x, y, cellM) => `${Math.floor(x / cellM)},${Math.floor(y / cellM)}`;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * `rowsFor(handles | null, atMs)` answers `everyonePlaced`-shaped rows — all of
 * them when `handles` is null — and is the ONLY source of a position here.
 * `frames` (optional) names handles whose row is carried; they always drift.
 */
export function createPositionGrid({ rowsFor, cellM = GRID_CELL_M, frames = null } = {}) {
  const cells = new Map();       // cell key -> Map handle -> row
  const drifting = new Set();    // handles re-placed at every question
  const carried = new Set(frames ? [...frames.keys()] : []);

  const place = (row) => {
    const k = cellOf(row.x, row.y, cellM);
    if (!cells.has(k)) cells.set(k, new Map());
    cells.get(k).set(row.handle, row);
  };

  return {
    async build(atMs) {
      cells.clear(); drifting.clear();
      for (const row of await rowsFor(null, atMs)) {
        if (row.moving || carried.has(row.handle)) drifting.add(row.handle);
        else place(row);
      }
      return this;
    },

    /**
     * Everyone within `radiusM` of `point` at `atMs`, nearest first (ties by
     * handle — `dynamic-presence.mjs § near`'s own order), each with
     * `distance_m` as presence rounds it.
     */
    async near(point, radiusM, atMs) {
      const reach = Math.ceil(radiusM / cellM);
      const cx = Math.floor(point.x / cellM), cy = Math.floor(point.y / cellM);
      const hits = [];
      for (let i = cx - reach; i <= cx + reach; i++) {
        for (let j = cy - reach; j <= cy + reach; j++) {
          const cell = cells.get(`${i},${j}`);
          if (!cell) continue;
          for (const row of cell.values()) if (dist(row, point) <= radiusM) hits.push(row);
        }
      }
      if (drifting.size) {
        for (const row of await rowsFor([...drifting], atMs)) {
          if (!row.moving && !carried.has(row.handle)) { drifting.delete(row.handle); place(row); }
          if (dist(row, point) <= radiusM) hits.push(row);
        }
      }
      return hits
        .map((r) => ({ ...r, distance_m: Math.round(dist(r, point)) }))
        .sort((a, b) => a.distance_m - b.distance_m || (a.handle < b.handle ? -1 : 1));
    },

    /** For the falsifier and the operator: how the grid is holding the town. */
    census() {
      let placed = 0;
      for (const c of cells.values()) placed += c.size;
      return { cells: cells.size, placed, drifting: drifting.size, cell_m: cellM };
    },
  };
}

// ── THE PLACEMENT, ONCE PER CHANGE (POS-284) ─────────────────────────────────
//
// The grid above answers `near`; the doors that ask "where is EVERYONE" still
// placed the whole town per request. On dev at 80 agents (2026-09-27, and again
// 2026-09-28 on train/2026-w41 @ ac2fdb9) `everyonePlaced` held about a quarter
// of the office's thread: a say asks orient and open-your-eyes before it acts
// and the witness after, each of them placed every resident, and each viewer's
// walkers poll placed them again, all at the same instant of the same town.
//
// So the answer is KEPT, per what it was placed from, and re-placed only for the
// residents who are walking. The premise is the grid's: a row that is not
// moving cannot move until something is recorded, and a recorded walk moves the
// projection's epoch, which is part of the key. A walker who has arrived by the
// time of a question is kept from then on.
//
// `key` names everything the rows were placed from (the projection's epoch, the
// fold, the roll, and which departures). A caller whose inputs have no stable
// name, the office with WORLD_POSITIONS off, never comes here: it calls
// `everyonePlaced` itself, exactly as before.

/** How many placements are kept at once: orient's, the witness's and the walkers' answers differ by roster, not by instant. */
export const PLACEMENTS_KEPT = 8;

/**
 * `rows({ key, at, place })` answers `place(null, at)` — `everyonePlaced`'s rows
 * for everyone — from what it kept under `key`, calling `place(only, at)` for
 * the walking handles alone. Synchronous, because `everyonePlaced` is and so is
 * its caller in the presence layer.
 */
export function createPlacement({ kept: max = PLACEMENTS_KEPT } = {}) {
  const kept = new Map();   // key -> { rows, index: Map handle -> i, drifting: Set }

  return {
    rows({ key, at, place }) {
      let k = kept.get(key);
      if (!k) {
        const rows = place(null, at);
        k = { rows, index: new Map(rows.map((r, i) => [r.handle, i])), drifting: new Set(rows.filter((r) => r.moving).map((r) => r.handle)) };
        kept.set(key, k);
        while (kept.size > max) kept.delete(kept.keys().next().value);
        return rows.slice();
      }
      const out = k.rows.slice();
      if (!k.drifting.size) return out;
      for (const row of place(k.drifting, at)) {
        const i = k.index.get(row.handle);
        if (i == null) continue;
        out[i] = row;
        if (!row.moving) { k.rows[i] = row; k.drifting.delete(row.handle); }
      }
      return out;
    },

    /** For the falsifier and the operator: what is kept. */
    census() {
      return [...kept.values()].map((k) => ({ rows: k.rows.length, drifting: k.drifting.size }));
    },
  };
}
