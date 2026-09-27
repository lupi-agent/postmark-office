// dynamic-entities.mjs — residents become ENTITIES: rows whose position is
// STATE, not identity.
//
// The derivation, end to end:
//
//   world.db `events` (the walk ledger, hydrated) -> the governing departure per
//   actor -> tools/walk.mjs `positionAt(departure, clock)` -> one entities row
//
// Three laws this module obeys, all of them from LOGOS/kinds.md:
//
//   1. LATEST WINS. A resident's current departure is their last recorded one.
//      Superseding is a new departure from the derived position, never a
//      mutation of an old one.
//   2. AN ENTITY HAS NO GEOMETRIC PARENT, EVER. Nothing here writes a
//      containment edge, and the entities table has no parent column to write
//      one into. "What am I within" is a query over position.
//   3. THE RECORD TRAVELS WITH THE POSITION. Every row carries the departure it
//      was derived from and the instant it was evaluated, because position is
//      derived — a row of bare coordinates cannot be carried forward to any
//      other clock, and the crossing-save's whole loss story depends on it
//      being able to.
//
// The physics is NOT reimplemented here. `positionAt` is imported from the
// world's own `tools/walk.mjs` — at a ref, never from the working tree, the
// same discipline world.mjs's `engineDir()` uses — so the office cannot quietly
// disagree with the world about where anyone is.

import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { OFFICE_ROOT, WORLD_CLONE } from "./world-store.mjs";
import { freshestMainRef, materializeAtRef } from "./world-branches.mjs";
import { servedCanonSha } from "./world-serve.mjs";
import { openDynamic, putMeta } from "./dynamic-store.mjs";

// The vessel appears in the walk ledger as an actor — she is a mark that moves,
// not a resident. She is never an entity; her position is `derived` mobility,
// computed from (timetable, clock), and Stage 2 does not crystallize her.
export const VESSEL_HANDLE = "the-post-office";
export const NON_ENTITY_ACTORS = new Set([VESSEL_HANDLE]);

/**
 * Is this departure the VESSEL'S departure — i.e. is its owner aboard?
 *
 * A passenger is a walker whose current departure IS the vessel's: same
 * instant, same destination, same paced stride, because the pen files them
 * together at sailing time. Telling them "the road" would be true and wrong;
 * they are on the water.
 *
 * This lives here rather than in world.mjs because two readers now need it —
 * the standpoint the doors have always used, and the presence layer — and two
 * copies of a rule this subtle would drift the first time the pen changed how
 * it files a sailing. Same test, byte for byte, as the one world.mjs shipped.
 */
export function ridesTheVessel(mine, vessel) {
  if (!mine || !vessel) return false;
  return mine.pace != null && mine.pace === vessel.pace
    && mine.iso === vessel.iso
    && mine.toward?.x === vessel.toward?.x && mine.toward?.y === vessel.toward?.y;
}

// ── THE MODULE MEMO, AND IT IS ALSO THE SINGLE-FLIGHT ────────────────────────
//
// This did a git ref read, a tree materialise and a module resolve ON EVERY
// CALL, and `readPresence` calls it three times per standpoint. Under the
// party's load that was the largest removable share of a saturated event loop.
//
// ⚑ THE PROMISE IS CACHED, NOT THE MODULE, and that is what makes this a
// single-flight rather than only a cache. Twenty guests arriving together used
// to start twenty materialisations of the same tree; now the first one starts
// it and the other nineteen await the same promise. Caching the resolved module
// would have left that thundering herd exactly as it was, because the herd
// arrives before the first one finishes.
//
// KEYED BY THE REF, so a tick that moves main is a new key and the next read
// materialises the new tree. Nothing is pinned to a stale world; the key IS the
// freshness.
//
// A REJECTED IMPORT IS EVICTED. Caching a failure forever would turn one bad
// materialise into a permanently broken door, which is worse than the cost this
// memo exists to save.
// ⚑ THE WINDOW IS ON THE CALLER, NOT ON THE REF READING. The first version
// memoised `freshestMainRef` itself and broke its law: that reading answers "is
// origin ahead of local", and a five-second-old answer to that is not the law,
// which its own test proved by moving the ref and asking again in the same
// breath. So the ref reading stays exact and THIS is where the cadence changes
// — asked once per window per file instead of once per read. Same subprocess
// storm removed, nothing about the answer's meaning touched.
//
// PAST THE WINDOW THE REF IS RE-READ, and only a ref that actually MOVED costs
// a re-materialise: a window that expires over an unchanged ref just refreshes
// its timestamp and keeps the module. So the steady state is one git read per
// file per window, and a tick that moves main is picked up within one window
// rather than never.
const TOOL_TTL_MS = 5000;
const _toolModules = new Map();   // `${repo}|${file}` -> { ref, at, mod }

/** One of the world's own tool modules, read at a ref — never from the working tree. */
export async function worldToolModule(file, { repo = WORLD_CLONE } = {}) {
  const key = `${repo}|${file}`;
  const hit = _toolModules.get(key);
  if (hit && Date.now() - hit.at < TOOL_TTL_MS) return hit.mod;

  // DELIBERATELY NOT `blessedRef` (postmark#2934's carve-out): this module
  // feeds the LIVE reads — `dynamic-presence` (/world/present) and
  // `world-movement` (walkers now) — whose physics must match the pen that is
  // writing departures on main this minute, not the engine of the last bless.
  const ref = freshestMainRef(repo);
  if (hit && hit.ref === ref) { hit.at = Date.now(); return hit.mod; }

  // THE PROMISE IS CACHED, NOT THE MODULE, which makes this a single-flight as
  // well as a memo: twenty guests arriving together used to start twenty
  // materialisations of the same tree, and now the first starts it and the rest
  // await it. Caching the resolved module would leave that herd exactly as it
  // was, because the herd arrives before the first one finishes.
  const mod = (async () => {
    const dir = materializeAtRef(repo, ref, "tools");
    return import(pathToFileURL(join(dir, "tools", file)).href);
  })();
  const entry = { ref, at: Date.now(), mod };
  _toolModules.set(key, entry);
  // A rejected import is evicted rather than cached forever — one bad
  // materialise must not become a permanently broken door.
  mod.catch(() => { if (_toolModules.get(key) === entry) _toolModules.delete(key); });
  return mod;
}

/** The world's own walk arithmetic, read at a ref. */
export const walkModule = ({ repo = WORLD_CLONE } = {}) => worldToolModule("walk.mjs", { repo });

// world.db's `events.payload` keys (`crossing`, `within`, `to`) are not
// walk.mjs's (`at`, `targetExtent`, `targetMarkId`). ONE writer of that mapping,
// here, or the save and the replay each translate it and the replay proves only
// that two translations happened to match.
export function departureFromEvent(ev) {
  const p = typeof ev.payload === "string" ? JSON.parse(ev.payload) : (ev.payload ?? {});
  return {
    iso: ev.at,
    handle: ev.actor,
    from: p.from,
    toward: p.toward,
    at: p.crossing,
    // `within` is the target's arrival rect FROZEN at departure — the tense
    // law's ancestor. Never re-resolved from the mark, ever.
    within: p.within ?? null,
    to: p.to ?? null,
    // walk.mjs reads `pace` as KM per crossing and multiplies by 1000 itself.
    // Converting here would double the stride.
    pace: p.pace ?? null,
    line_no: p.line_no ?? null,
  };
}

/** A saved/stored departure record in the shape `positionAt` wants. One conversion, one direction. */
export const toWalkRecord = (d) => ({
  from: d.from, toward: d.toward, at: d.at,
  targetExtent: d.within ?? null, targetMarkId: d.to ?? null, pace: d.pace ?? null,
});

/**
 * One entity row, from its governing departure, evaluated at one instant.
 * `walk` is the world's module; `atMs` the clock. Nothing else.
 */
export function entityFromDeparture(handle, dep, atMs, walk) {
  const p = walk.positionAt(toWalkRecord(dep), walk.fractionalCrossing(atMs));
  return {
    handle,
    x: p.x,
    y: p.y,
    derived_at: new Date(atMs).toISOString(),
    provenance: {
      derived_by: "src/dynamic-entities.mjs via the world's tools/walk.mjs positionAt",
      status: p.arrived ? (p.standing ? "standing" : "arrived") : "mid-walk",
      arrived: p.arrived,
      standing: p.standing,
      leg_m: p.legM,
      travelled_m: p.travelledM,
      remaining_m: p.remainingM,
      eta_crossings: p.etaCrossings,
      departure: dep,
    },
  };
}

/** Deterministic ordering everywhere entities are written, saved or compared. */
export const byHandle = (a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0);

// ── reading the ledger out of world.db ───────────────────────────────────────
//
// The deriver's gate law, applied to this input. An entity table built from an
// absent ledger would be an empty world indistinguishable from a still one, so
// the absent cases REFUSE by name; a store that is merely behind main
// DISCLOSES, because departures it has not seen yet are missing movement, not
// wrong movement, and the save stamps which sha it read.

export function worldDbPath() {
  return process.env.WORLD_STORE_DB ?? join(OFFICE_ROOT, "world.db");
}

export function readDepartureEvents({ worldDb = null, repo = WORLD_CLONE } = {}) {
  const path = worldDb ?? worldDbPath();
  if (!existsSync(path))
    return { refused: { gate: "world-store", detail: `no world store at ${path} — run: npm run hydrate:world` } };
  let db;
  try { db = new DatabaseSync(path, { readOnly: true }); }
  catch (e) { return { refused: { gate: "world-store", detail: `unreadable (${String(e?.message ?? e).slice(0, 160)})` } }; }
  let meta, rows;
  try {
    meta = Object.fromEntries(
      db.prepare("SELECT key, value FROM meta WHERE key IN ('as_of_world','hydrated_at','hydration_status','gates')").all()
        .map((r) => [r.key, r.value]));
    if (String(meta.hydration_status ?? "").startsWith("FAILED"))
      { db.close(); return { refused: { gate: "world-store", detail: `stamped ${meta.hydration_status}` } }; }
    rows = db.prepare("SELECT seq, at, actor, type, payload FROM events WHERE type = 'departure' ORDER BY seq").all();
  } catch (e) {
    db.close();
    return { refused: { gate: "world-store", detail: `events unreadable (${String(e?.message ?? e).slice(0, 160)})` } };
  }
  db.close();

  // A hydration whose walk-ledger gate was ABSENT built an events table that is
  // legitimately empty. That is not "nobody has ever walked" and must not be
  // read as it — refuse rather than crystallize an empty town.
  let gates = [];
  try { gates = JSON.parse(meta.gates ?? "[]"); } catch { gates = []; }
  const ledgerGate = gates.find((g) => g.gate === "walk-ledger") ?? null;
  if (ledgerGate && ledgerGate.status !== "PRESENT")
    return { refused: { gate: "walk-ledger", detail: `the world store's own walk-ledger gate is ${ledgerGate.status} — its events table is empty by absence, not by stillness` } };

  // FRESHNESS IS ABOUT THE LEDGER, NOT ABOUT MAIN.
  //
  // The obvious check — does `as_of_world` equal the sha main points at — is
  // wrong here, and wrong in a way that would cry wolf twice a day forever: the
  // crossing-save's OWN commit advances main, so every save would report the
  // store stale the moment it finished writing, and then rewrite its own output
  // on the next run to say so. Nothing about the town's movement changed.
  //
  // What actually governs this derivation is whether the walk ledger has moved,
  // so that is what is compared: the ledger's blob at the hydrated sha against
  // its blob at published main. A commit that touched STATE/, a mark, or a law
  // leaves this equal, correctly.
  // …and "published main" is now the SERVED canon — the newest blessing, the
  // sha the tick hydrates at (postmark#2934). The ledger comparison is kept:
  // a bless that touched no walk leaves this equal, correctly.
  let fresh = null, mainSha = null;
  try {
    mainSha = servedCanonSha(repo);
    if (meta.as_of_world === mainSha) fresh = true;
    else fresh = ledgerBlob(repo, meta.as_of_world) === ledgerBlob(repo, mainSha);
  } catch { fresh = null; }

  return {
    events: rows,
    as_of_world: meta.as_of_world ?? null,
    hydrated_at: meta.hydrated_at ?? null,
    main_sha: mainSha,
    fresh,
    disclosed: fresh === false
      ? [`walk-ledger-moved: entities derive from the ledger at ${String(meta.as_of_world).slice(0, 12)}, and main is at ${String(mainSha).slice(0, 12)} with a different ledger — departures committed since are not yet in the store`]
      : (fresh === null ? ["world-store-freshness-unknown: the world clone's main could not be read"] : []),
    path,
  };
}

const LEDGER_PATH = "WORLD/walk-ledger.md";
/** The ledger's blob oid at a commit, or null where the file does not exist there. */
function ledgerBlob(repo, sha) {
  if (!sha) return null;
  try {
    return execFileSync("git", ["-C", repo, "rev-parse", `${sha}:${LEDGER_PATH}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch { return null; }
}

/**
 * The governing departure per actor at an instant — one pass, ordered by seq.
 * The ledger's own order is the tiebreak when two departures share an instant
 * (every sailing line reads 18:00:00.000Z).
 */
export function governingAt(events, atMs = Infinity) {
  const governing = new Map();
  for (const ev of events) {
    if (NON_ENTITY_ACTORS.has(ev.actor)) continue;
    if (Date.parse(ev.at) > atMs) continue;
    governing.set(ev.actor, departureFromEvent(ev));
  }
  return governing;
}

/**
 * The VESSEL's governing departure — the one record `governingAt` deliberately
 * throws away, because she is a mark that moves and never an entity.
 *
 * It has to be kept anyway, and here is why: `ridesTheVessel` answers "is this
 * walker aboard" by comparing their departure with HERS, and that comparison
 * has to happen at the instant someone asks rather than at refresh time —
 * aboard ends at the landing. So her sailing line is an INPUT to a derivation
 * whose output lives in the entities table, and the law is already written for
 * exactly this shape: save the derivation's input alongside its output. It goes
 * into `meta.vessel_departure`, beside the rows it governs, and nothing has to
 * reach back into the ledger to answer a question about a passenger.
 */
export function vesselDepartureAt(events, atMs = Infinity) {
  let latest = null;
  for (const ev of events) {
    if (ev.actor !== VESSEL_HANDLE) continue;
    if (Date.parse(ev.at) > atMs) continue;
    latest = departureFromEvent(ev);
  }
  return latest;
}

/** Every entity, derived at `atMs` from the ledger. The pure half — no db writes. */
export function deriveEntities(events, atMs, walk) {
  return [...governingAt(events, atMs).entries()]
    .map(([handle, dep]) => entityFromDeparture(handle, dep, atMs, walk))
    .sort(byHandle);
}

/**
 * Refresh the entities table from the ledger.
 *
 * NOT a rebuild-from-scratch of the database — dynamic.db is store-canon and
 * holds attachments and emissions that no ledger can regenerate. Only the
 * entities table is replaced, and only from a derivation that ran to completion:
 * a refused gate leaves every existing row exactly where it was, because a
 * hydrator that empties a good table and then discovers it cannot refill it has
 * turned a refusal into an outage.
 */
export async function refreshEntities({
  db = null, dbPath = null, worldDb = null, repo = WORLD_CLONE,
  at = Date.now(), walk = null,
} = {}) {
  const read = readDepartureEvents({ worldDb, repo });
  if (read.refused) return { ok: false, refused: read.refused, entities: 0 };

  const w = walk ?? await walkModule({ repo });

  const own = !db;
  const handle = db ?? openDynamic(dbPath ?? undefined);

  // STAGE D: the two eras, folded before the derivation rather than after it.
  // `governingAt` already implements latest-wins over one ordered list, so
  // handing it the merged list is the whole of the seam's cost here.
  //
  // ── THE LIVE ERA COMES FROM THE REGISTER (POS-196's held swap, POS-156) ────
  //
  // This read was `readMovements(handle)` — `dynamic.db/movements`, the
  // REVERSE-MIRROR copy G1 removes. It is `storedDepartureEvents` now: the same
  // departures rendered from `acts` in world.db's `events` row shape, through
  // POS-154's one road, so `mergedDepartureEvents`, `governingAt` and
  // `deriveEntities` read one vocabulary and the seam stays a change of PEN.
  //
  // POS-196 could not land this and said why: the register held no departure
  // INSTANT, and `at` is what `mergedDepartureEvents` orders on. POS-198 closed
  // it — `walkViaOffice` reads the declaration clock once and hands the same
  // string to both pens — so `acts.at` IS the departure's own instant now.
  //
  // ⚑ THE GATE IS `world2Enabled()`, AND IT IS THE OLD GATE'S TWIN. An office
  // pointed at no register reads `[]` here, exactly as an office with
  // `WORLD_MOVEMENT_V2` off read `[]` before: that is "this office has no live
  // era", not "nobody has walked". An office that IS pointed at one and cannot
  // read it REFUSES by name, because this function's own header rules it —
  // "a refused gate leaves every existing row exactly where it was" — and
  // deriving the entities table from the frozen era alone would replace every
  // resident's position with a July one while reporting success.
  //
  // ⚑ BOTH IMPORTS ARE DYNAMIC, and not by taste: `world-movement.mjs` imports
  // `VESSEL_HANDLE` and `worldToolModule` FROM THIS FILE (line 45 there), so a
  // static import back would close a cycle. `world2-guards.mjs` already reaches
  // this file the same way for the same reason.
  const { world2Enabled } = await import("./world2-acts.mjs");
  let storeEvents = [];
  if (world2Enabled()) {
    const { storedDepartureEvents } = await import("./world-movement.mjs");
    const stored = await storedDepartureEvents({ atMs: at });
    if (stored.absent) {
      if (own) handle.close();
      return { ok: false, refused: { gate: "register", detail: stored.absent }, entities: 0 };
    }
    storeEvents = stored.events;
  }
  const events = storeEvents.length ? mergedDepartureEvents(read.events, storeEvents) : read.events;
  const rows = deriveEntities(events, at, w);

  try {
    handle.exec("BEGIN");
    handle.exec("DELETE FROM entities");
    const ins = handle.prepare("INSERT INTO entities (handle, x, y, derived_at, provenance) VALUES (?,?,?,?,?)");
    for (const e of rows) ins.run(e.handle, e.x, e.y, e.derived_at, JSON.stringify(e.provenance));
    putMeta(handle, "entities_as_of", new Date(at).toISOString());
    putMeta(handle, "entities_source_sha", read.as_of_world);
    // The derivation's input, saved beside its output: without her sailing line
    // nothing downstream can tell a passenger from a walker who happens to be
    // headed the same way.
    putMeta(handle, "vessel_departure", JSON.stringify(vesselDepartureAt(events, at)));
    putMeta(handle, "entities_source_fresh", String(read.fresh));
    putMeta(handle, "entities_refreshed_at", new Date().toISOString());
    handle.exec("COMMIT");
  } catch (e) {
    try { handle.exec("ROLLBACK"); } catch { /* nothing open */ }
    if (own) handle.close();
    throw e;
  }
  if (own) handle.close();

  return {
    ok: true,
    entities: rows.length,
    rows,
    as_of: new Date(at).toISOString(),
    source: {
      as_of_world: read.as_of_world, hydrated_at: read.hydrated_at, fresh: read.fresh, path: read.path,
      ledger_events: read.events.length, store_movements: storeEvents.length,
    },
    disclosed: read.disclosed,
    mid_walk: rows.filter((r) => !r.provenance.arrived).length,
  };
}

/** Every entity row, as objects. Deterministic order. */
export function readEntities(db) {
  return db.prepare("SELECT handle, x, y, derived_at, provenance FROM entities ORDER BY handle").all()
    .map((r) => ({ handle: r.handle, x: r.x, y: r.y, derived_at: r.derived_at, provenance: JSON.parse(r.provenance ?? "{}") }));
}

/** Every attachment row. `born_at` order, then seq — the order a replay applies them in. */
export function readAttachments(db, { until = null } = {}) {
  const rows = db.prepare("SELECT seq, entity, target, policy, declared_by, born_at FROM attachments ORDER BY born_at, seq").all();
  return until == null ? rows : rows.filter((a) => Date.parse(a.born_at) <= until);
}

/**
 * Declare an attachment. Born by DECLARATION, validated by presence — never
 * inferred from geometry. Stage 2 ships the table and this writer; the boarding
 * verb that calls it lands with the vessel work, and the crossing-save carries
 * whatever is here either way.
 */
export function declareAttachment(db, { entity, target, policy = "cascade", declaredBy, bornAt }) {
  if (!entity || !target) throw new Error("an attachment needs both ends");
  if (!["cascade", "detach"].includes(policy)) throw new Error(`unknown attachment policy "${policy}" — cascade | detach`);
  const born = bornAt ?? new Date().toISOString();
  // `INSERT OR IGNORE` against `attachments_once (entity, target, born_at)` is
  // idempotence for a REPLAY — the same declaration applied twice must not become
  // two rows. But an ignore and a write are indistinguishable to the caller
  // unless this says so, and a caller that reports success for a swallowed
  // declaration is a door whose answer contradicts its own store. So the row
  // count comes back: `inserted: false` means THIS DECLARATION DID NOT LAND.
  const { changes } = db.prepare("INSERT OR IGNORE INTO attachments (entity, target, policy, declared_by, born_at) VALUES (?,?,?,?,?)")
    .run(entity, target, policy, declaredBy ?? entity, born);
  return { entity, target, policy, declared_by: declaredBy ?? entity, born_at: born, inserted: Number(changes) > 0 };
}

// ── movements: the record after the seam (Stage D) ───────────────────────────
//
// The walk ledger is frozen with honor at the cutover — append stops, the file
// stays forever as the founding era's record — and `STATE/log/` becomes the
// movement record (ruled, dial 4). Between a departure being declared and the
// next crossing-save crystallizing it, it lives here.
//
// ONE VOCABULARY, TWO ERAS. `readMovements` returns rows in world.db's `events`
// shape, so `governingAt`, `deriveEntities`, `buildSave` and every replay read
// the ledger's era and the store's era through the same function. That is what
// makes the seam a change of WRITER rather than a change of MEANING — and it is
// why the ledger can be frozen without any resident's position moving.

// ── THE MOVEMENTS PEN IS GONE (G1 / POS-156, 2026-09-22) ───────────────
//
// `declareMovement` and `declareMovementFlipped` wrote `dynamic.db/movements`:
// the walk lane's own sqlite pen and, under the flip, the REVERSE-MIRROR copy
// that committed in one sqlite transaction after the awaited Postgres pen. Both
// are deleted with the rest of the reverse mirror.
//
// NOTHING READS THE TABLE LIVE ANY MORE, which is what made the deletion a
// deletion rather than a port: `storedDepartures` moved to `acts` in POS-154,
// and `refreshEntities` and `crossing-save`'s `<N>.jsonl` half moved in
// POS-156's part 0. Every walk writes one act, awaited, through `appendJournal`
// -- `world.mjs § walkViaOffice` and `world-apex.mjs § spawnOnEnter`, which was
// a THIRD writer of this table that POS-156's own measurement had not listed.
//
// `readMovements` STAYS, below, and so does the table. It holds the frozen era
// and two historical readers still ask it for that history
// (`tools/ledger-freeze.mjs`, `tools/state-to-r2.mjs`). A reader of history is
// not a shim; what G1 removes is the WRITE, so nothing is added to it again.

/**
 * Every declared movement, in world.db's `events` row shape.
 *
 * `seq` is offset past the ledger's own event ids by the caller when the two are
 * merged — see `mergedDepartureEvents`. Here it is the store's own sequence.
 */
export function readMovements(db, { until = null } = {}) {
  const rows = db.prepare(`SELECT seq, actor, at, from_x, from_y, toward_x, toward_y, crossing,
      within_w, within_h, to_mark, pace, declared_by, note FROM movements ORDER BY at, seq`).all();
  return rows
    .filter((r) => until == null || Date.parse(r.at) <= until)
    .map((r) => ({
      seq: r.seq, at: r.at, actor: r.actor, type: "departure",
      payload: JSON.stringify({
        from: { x: r.from_x, y: r.from_y },
        toward: { x: r.toward_x, y: r.toward_y },
        crossing: r.crossing,
        within: (r.within_w != null && r.within_h != null) ? { w: r.within_w, h: r.within_h } : null,
        to: r.to_mark ?? null,
        pace: r.pace ?? null,
        declared_by: r.declared_by ?? r.actor,
        source: "dynamic.db/movements",
        ...(r.note ? { note: r.note } : {}),
      }),
    }));
}

/**
 * The ledger's era and the store's era, in one ordered list.
 *
 * Ordered by INSTANT first, and by era second where two records share one: the
 * ledger cannot gain a new line after the freeze, so a store row at the same
 * instant is by construction the later statement. `governingAt` walks this in
 * order and takes the last per actor, so latest-wins spans the seam without
 * knowing there is one.
 */
export function mergedDepartureEvents(ledgerEvents = [], storeEvents = []) {
  const tag = (rows, era) => rows.map((r) => ({ ...r, era }));
  return [...tag(ledgerEvents, "ledger"), ...tag(storeEvents, "store")]
    .sort((a, b) => {
      const ta = Date.parse(a.at), tb = Date.parse(b.at);
      if (ta !== tb) return ta - tb;
      if (a.era !== b.era) return a.era === "ledger" ? -1 : 1;
      return (a.seq ?? 0) - (b.seq ?? 0);
    });
}

/** Has the world store moved since the entities table was last derived from it? */
export function entitiesStale(db, { worldDb = null } = {}) {
  const path = worldDb ?? worldDbPath();
  if (!existsSync(path)) return null;
  try { statSync(path); } catch { return null; }
  const db2 = new DatabaseSync(path, { readOnly: true });
  const sha = db2.prepare("SELECT value FROM meta WHERE key = 'as_of_world'").get()?.value ?? null;
  db2.close();
  const seen = db.prepare("SELECT value FROM meta WHERE key = 'entities_source_sha'").get()?.value ?? null;
  return seen !== sha;
}
