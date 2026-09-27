// world2-fold.mjs — THE WORLD PAGE'S FOLD, BUILT FROM THE STORE'S ROWS (POS-142).
//
// The fold is a derivation. The settlement runs the world's own
// `tools/marks-fold.mjs`: `loadMarks(dir)` reads `WORLD/marks/**/mark.md` into
// mark records, and `fold({ marks, terrain, stakes, … })` derives everything the
// World page reads from them. `/world/state` serves the file that fold wrote.
//
// This module is the other half of that sentence. `marksFromRows` turns the
// store's rows into the records `loadMarks` yields, so the SAME `fold()` — the
// world's module, imported at the blessed ref exactly as the rest of the office
// imports its engine — runs over them unchanged. There is no second fold here,
// and nothing below re-derives a fact the fold derives.
//
// ── WHERE EACH FIELD OF A `loadMarks` RECORD COMES FROM ──────────────────────
//
// `world2/tools/seed-import.mjs § recordData` is the reverse of this function:
// it kept every field of the loader's record in `data` except the ones a column
// holds (`HELD_BY_A_COLUMN`) and `_dir`. So:
//
//   id            marks.slug                (`<by>/<leaf>`, the loader's id)
//   slug          the leaf of marks.slug    (the mark's directory name)
//   kind          marks.kind
//   by            marks.owner
//   household     marks.owner               (the LOADER sets household = by; the
//                                            column holds the fold's household
//                                            KEY, which the fold re-derives)
//   body          marks.body
//   at / extent   marks.geometry            (world coordinates — the loader has
//   points        marks.geometry.points      already composed the frame; see
//                                            seed-import § the frame note)
//   parent        marks.parent → that row's slug, or `data._parent_is_law`
//                 (a parent that is a class mark lives in law_projection)
//   _parentMarkId data._parentMarkId, or the continuation parent for a
//                 predicated/naming row the live pen wrote (it carries none)
//   everything else  data                   (the record's own remainder)
//
// Class marks are LAW and are not in `marks` at all: `law_projection` holds
// them, `data` being the loader's record minus `_dir` (law-ingest § recordData).
//
// ── WHAT THE STORE CANNOT SAY, NAMED RATHER THAN GUESSED ─────────────────────
//
//   · ORDER. The loader walks the directory tree, and the fold's `marks` array
//     keeps that order. A mark's directory is its historical filing
//     (`WORLD/filing-freeze.json`) and no row records it, so the rows fold's
//     `marks` come out in slug order. `foldEquality` compares marks by id and
//     names the order as the one difference it forgives.
//   · `tier`. The seed stored the fold's DERIVED tier in `data.tier`, not the
//     line the file carries. The fold reads a record's tier for one question
//     only — is this the town's constitution (tools/mark-standing.mjs) — and the
//     derived value answers it the same way. The falsifier is what says so.
//
// A fact the fold needs that no row carries is a STOP for the reader to see,
// never a value filled in here.

/** The leaf of `<by>/<leaf>`. */
const leafOf = (slug) => String(slug ?? "").split("/").pop();

const CONTINUED = new Set(["predicated", "naming"]);

/**
 * The store's rows → the records `loadMarks(dir)` yields. PURE: no store, no fs.
 *
 * @param {object[]} markRows standing `marks` rows (id, slug, kind, owner, body, geometry, parent, data)
 * @param {object[]} lawRows  `law_projection` rows of kind `class` (their `data` is the record)
 * @returns {object[]} mark records, ordered by id
 */
export function marksFromRows(markRows = [], lawRows = []) {
  const slugByUuid = new Map(markRows.map((r) => [String(r.id), r.slug]));
  const out = [];
  for (const row of markRows) {
    const d = { ...(row.data ?? {}) };
    const parentIsLaw = d._parent_is_law ?? null;
    delete d._parent_is_law;                     // the seed's own receipt, not a record field
    const rec = { ...d };
    rec.kind = row.kind;
    rec.by = row.owner;
    rec.household = row.owner;                   // walkMarks: `rec.household = by`
    rec.tier = d.tier ?? "market";               // walkMarks: `rec.tier ?? "market"`
    rec.slug = leafOf(row.slug);
    rec.id = row.slug;
    rec.body = row.body ?? "";
    const g = row.geometry ?? null;
    delete rec.at; delete rec.extent; delete rec.points;
    if (g && g.at && g.extent) {
      // fresh objects in the file's key order — jsonb returns `{h, w}`
      rec.at = { x: g.at.x, y: g.at.y };
      rec.extent = { w: g.extent.w, h: g.extent.h };
      if (Array.isArray(g.points)) rec.points = g.points;
    }
    const parentSlug = row.parent != null ? (slugByUuid.get(String(row.parent)) ?? null) : null;
    if (CONTINUED.has(row.kind)) {
      rec.parent = parentSlug ?? parentIsLaw ?? d._explicitParent ?? d._parentMarkId ?? undefined;
      if (rec.parent === undefined) delete rec.parent;
    } else {
      delete rec.parent;                         // walkMarks: sited/parcel never carry an authored parent
    }
    if (!("_parentMarkId" in d)) rec._parentMarkId = CONTINUED.has(row.kind) ? (rec.parent ?? null) : null;
    out.push(rec);
  }
  for (const row of lawRows) {
    if (row.kind !== "class") continue;
    out.push({ ...(row.data ?? {}) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ── ORDER: the one thing the rows do not carry ──────────────────────────────
//
// The published fold's `marks` array is in the loader's directory order, and
// the World page paints in array order. The rows cannot say it (see the header),
// so when the published fold is in hand its order is kept: every id it holds
// keeps its place, and a mark the store holds that the file does not (placed
// since the blessing) follows, in slug order. The order is a presentation fact
// — no field of any mark is read from the file.
export function inPublishedOrder(marks, publishedIds = null) {
  if (!Array.isArray(publishedIds) || !publishedIds.length) return marks;
  const at = new Map(publishedIds.map((id, i) => [id, i]));
  const tail = Number.MAX_SAFE_INTEGER;
  return marks
    .map((m, i) => ({ m, i }))
    .sort((a, b) => ((at.get(a.m.id) ?? tail) - (at.get(b.m.id) ?? tail)) || (a.i - b.i))
    .map(({ m }) => m);
}

// ── THE FLAG ────────────────────────────────────────────────────────────────
//
// Read per call from the environment, like its siblings (world-serve.mjs §
// flags). `W2_FOLD=store` serves the rows fold at `/world/state`; anything else
// serves the file, exactly as before this module existed.
export const foldFromStoreEnabled = (env = process.env) => env.W2_FOLD === "store";

/**
 * Every input the settlement's fold takes, from the store — beside the ones the
 * store does not hold, which the caller passes from the blessed ref.
 *
 * THE SAME INPUTS THE SWEEP USES (world `tools/settlement-sweep.mjs` runs
 * `marks-fold.mjs --stakes <escrow>`): marks, terrain (`WORLD/skeleton.json`),
 * the escrow stakes, households (`WORLD/households.json`), prev = null, tick 0,
 * the default dials, fanup "legacy". Two of them are NOT the sweep's exact
 * bytes, and `as_of` names both so a reader can tell:
 *   · stakes are read at the store's ingested town head, which may be a town
 *     commit after the one the settlement pinned;
 *   · marks are the store's CURRENT standing rows — `marks` keeps no per-window
 *     history (mark-render.mjs § renderMarkFromStore) — so a mark placed since
 *     the blessing is in this fold and not in the file.
 */
export async function storeFoldInputs(p) {
  const { rows: markRows } = await p.query(
    `SELECT id, slug, kind, owner, household, body, geometry, status, locked_window, parent, data
       FROM marks WHERE status = 'standing' ORDER BY slug`);
  if (!markRows.length) throw new Error("no standing marks in the store — an empty world is a store that cannot answer, not a quiet one");
  const { rows: [lawHead] } = await p.query("SELECT sha FROM projection_heads WHERE repo = 'world-law'");
  if (!lawHead?.sha) throw new Error("projection_heads has no 'world-law' row — the store holds no class marks, and a fold without the town's law is not the town's fold");
  const { rows: lawRows } = await p.query(
    "SELECT kind, key, path, data FROM law_projection WHERE law_sha = $1 AND kind = 'class' ORDER BY key", [lawHead.sha]);
  const { rows: [townHead] } = await p.query("SELECT sha FROM projection_heads WHERE repo = 'town'");
  if (!townHead?.sha) throw new Error("projection_heads has no 'town' row — the store cannot name the sha its stakes are as-of");
  const { stakesFromStore } = await import("../world2/tools/fold-input.mjs");
  const stakes = await stakesFromStore(p, { townSha: townHead.sha });
  let settlement = null;
  try {
    const { rows: [s] } = await p.query("SELECT number, tag_sha FROM settlements ORDER BY number DESC LIMIT 1");
    if (s) settlement = { tag: `settlement/S${s.number}`, sha: s.tag_sha };
  } catch { settlement = null; }            // 018 not applied: the stamp says so by being null
  const marksWindow = markRows.reduce((n, r) => Math.max(n, Number(r.locked_window) || 0), 0);
  return {
    markRows, lawRows, stakes,
    as_of: {
      marks_window: marksWindow, marks: markRows.length, class_marks: lawRows.length,
      law_sha: lawHead.sha, town_sha: townHead.sha, settlement,
    },
  };
}

/**
 * The World page's fold, from the store's rows, through the world's own `fold`.
 *
 * @param {object} p        a pg client/pool (query)
 * @param {object} o
 * @param {Function} o.fold the world's `fold`, imported at the blessed ref
 * @param {object} o.terrain the blessed ref's `WORLD/skeleton.json`
 * @param {object|null} o.households the blessed ref's `WORLD/households.json` `.households`
 * @param {string[]|null} o.publishedIds the published fold's mark ids, in order
 * @param {object} o.world  `{ ref, sha }` of the blessed ref the terrain/households/engine came from
 */
export async function foldFromStore(p, { fold, terrain, households = null, publishedIds = null, world = null }) {
  const inputs = await storeFoldInputs(p);
  const state = fold({ marks: marksFromRows(inputs.markRows, inputs.lawRows), terrain, stakes: inputs.stakes, households });
  state.marks = inPublishedOrder(state.marks, publishedIds);
  state.meta = { source: "store", as_of: { ...inputs.as_of, world_ref: world?.ref ?? null, world_sha: world?.sha ?? null } };
  return state;
}

// ── SERVING, with the fall-through said out loud ─────────────────────────────
//
// Flag off: the file, the very object `worldStateRaw()` returns — nothing is
// added, so the bytes are today's. Flag on: the rows fold; and when the store
// cannot answer, the file, carrying `meta.source: "file"` and the reason, so a
// reader can tell which it got. A fold is ~1.5 s of synchronous work, so it is
// cached on a fingerprint of what it read and computed once per change.
const cache = { key: null, state: null, pending: null };

export async function storeFingerprint(p) {
  const { rows: [m] } = await p.query(
    "SELECT count(*)::int AS n, max(locked_window) AS lw, max(retired_window) AS rw FROM marks");
  const { rows: heads } = await p.query(
    "SELECT repo, sha FROM projection_heads WHERE repo IN ('world-law', 'town') ORDER BY repo");
  return JSON.stringify([m?.n, m?.lw, m?.rw, heads.map((h) => `${h.repo}:${h.sha}`)]);
}

/**
 * What `/world/state` serves.
 *
 * @param {object} o
 * @param {Function} o.fileState  () => Promise<object> — today's answer (`worldStateRaw`)
 * @param {Function} o.storeState () => Promise<object> — the rows fold (`foldFromStore` with its inputs)
 * @param {Function} [o.fingerprint] () => Promise<string> — the cache key; absent = no cache
 */
export async function worldStateServed({ env = process.env, fileState, storeState, fingerprint = null }) {
  if (!foldFromStoreEnabled(env)) return fileState();
  try {
    const key = fingerprint ? await fingerprint() : null;
    if (key != null && cache.key === key && cache.state) return cache.state;
    if (key != null && cache.pending?.key === key) return await cache.pending.promise;
    const promise = storeState();
    if (key != null) cache.pending = { key, promise };
    const state = await promise;
    if (!Array.isArray(state?.marks) || !state.marks.length) throw new Error("the rows fold came back with no marks");
    if (key != null) { cache.key = key; cache.state = state; }
    return state;
  } catch (e) {
    const reason = String(e?.message ?? e).slice(0, 300);
    console.error(`[world2-fold] W2_FOLD=store could not answer (${reason}) — serving the published file`);
    const file = await fileState();
    return { ...file, meta: { source: "file", fell_through: reason } };
  } finally {
    cache.pending = null;
  }
}

/** Test seam: forget the cached fold. */
export function resetStoreFoldCache() { cache.key = null; cache.state = null; cache.pending = null; }

/**
 * The office's own wiring: the store fold with its blessed-ref inputs, and the
 * cache key. The engine is materialised at the blessed ref exactly as
 * `world.mjs § engineDir` materialises it — the fold that blessed a settlement is
 * the fold that runs here.
 */
export async function officeStoreFold({ p, repo, fileState }) {
  const { blessed, materializeAtRef, readJsonAtRef } = await import("./world-branches.mjs");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const b = blessed(repo);
  const tools = materializeAtRef(repo, b.ref, "tools");
  const { fold } = await import(pathToFileURL(join(tools, "tools", "marks-fold.mjs")).href);
  const terrain = readJsonAtRef(repo, b.ref, "WORLD/skeleton.json");
  let households = null;
  try { households = readJsonAtRef(repo, b.ref, "WORLD/households.json")?.households ?? null; } catch { households = null; }
  const published = await fileState();
  return foldFromStore(p, {
    fold, terrain, households,
    publishedIds: (published?.marks ?? []).map((m) => m.id),
    world: { ref: b.ref, sha: b.sha },
  });
}
