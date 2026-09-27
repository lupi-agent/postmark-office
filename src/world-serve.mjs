// world-serve.mjs — Stage 1's serving layer: office world reads answered from
// `world.db`, behind two flags, with the fold diffing beside them.
//
//   WORLD_STORE_SHADOW=1   compute BOTH answers, serve the fold's, log every
//                          disagreement. Zero behaviour change for residents.
//                          This is the mode that runs on the box first.
//   WORLD_STORE_READS=1    serve the STORE's answer where it is eligible.
//   (neither)              the store is never opened. Not "opened and ignored" —
//                          never opened: `servedRead` returns the fold on its
//                          first line, before a stat, a git call or a counter.
//
// Both flags on is the transitional rung, and it is well defined: the store
// answers, the fold verifies. The box ladder is off → shadow → watch → serve.
//
// ── WHAT MAY BE SERVED, AND WHY THE GUARD IS IN CODE ────────────────────────
//
// world.db indexes PUBLISHED MAIN and nothing else — and since the world
// runtime ladder's §1c (2026-08-22) so does every read: the fold path serves
// canon to anonymous, visitor and author alike, and a household's drafts reach
// their own author as a delta instead. So the two paths index the same world by
// construction now, not by agreement.
//
// The keyed refusal below therefore no longer MIRRORS a branch choice the fold
// makes — the fold makes none. It stays as a belt: `servedRead` still takes a
// `key`, and if a future household-scoped read is ever wired into this lane, it
// falls through to the fold rather than quietly collecting main from the store.
// The one live caller (`place_words`) passes `key: null` by construction, so the
// arm fires for nobody today. Retire it when either the key parameter leaves
// `servedRead` or a keyed read is deliberately admitted here.
//
// The second half of eligibility is FRESHNESS, and it is exact rather than
// approximate: the store may answer only when `meta.as_of_world` is the very
// commit the fold would have served. Not "recent", not "within a crossing" —
// the same sha. A store one commit behind main is a store that cannot answer
// identically, and this file's whole discipline is that a read either matches
// the fold or falls through to it, loudly.
//
// ── WHAT THE STORE STILL CANNOT ANSWER ──────────────────────────────────────
//
// A query may return `CANNOT_ANSWER` for its own reasons — see
// `pointAnswerable`, where six water marks carrying polygon rings that the
// hydrator records only as a VERTEX COUNT make every point inside their
// bounding boxes unanswerable. That fall-through is not a wart to be tidied
// away: it is the mechanism working. A read that the store cannot answer
// identically goes to the fold, is counted, and says which reason.

import { appendFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { DEFAULT_DB, OFFICE_ROOT, loadWorldGraph, containmentSpine } from "./world-store.mjs";
import { blessed, draftRefForKey, refExists } from "./world-branches.mjs";
import { nextSettlementAttemptAt } from "./settlements.mjs";

// ── flags ────────────────────────────────────────────────────────────────────
// Read from the environment on every call rather than latched at import: a test
// flips them between cases, and an operator flipping one is restarting the
// office anyway. Nothing here caches a flag.

export const storeReadsEnabled = () => process.env.WORLD_STORE_READS === "1";
export const storeShadowEnabled = () => process.env.WORLD_STORE_SHADOW === "1";
export const storeEngaged = () => storeReadsEnabled() || storeShadowEnabled();
export const storeMode = () => (storeReadsEnabled()
  ? (storeShadowEnabled() ? "serve+shadow" : "serve")
  : (storeShadowEnabled() ? "shadow" : "off"));

export const storeDbPath = () => process.env.WORLD_STORE_DB ?? DEFAULT_DB;
const shadowLogPath = () => process.env.WORLD_STORE_SHADOW_LOG ?? join(OFFICE_ROOT, "world-shadow-diff.jsonl");

/** A query's own refusal: the store is present and fresh, and still cannot answer this. */
export const CANNOT_ANSWER = Symbol("world-store:cannot-answer");
export const cannotAnswer = (why) => ({ [CANNOT_ANSWER]: true, why: String(why) });
const refused = (v) => Boolean(v && typeof v === "object" && v[CANNOT_ANSWER]);

// ── the snapshot ─────────────────────────────────────────────────────────────
// world.db is small (686 nodes / 805 edges) and read-only by construction, so
// the whole graph is held in memory and rebuilt when the FILE changes. Keyed on
// mtime+size rather than on as_of_world: a rehydration at the same sha still
// rewrites the file, and a snapshot that outlived its file would be a cache
// nobody could invalidate.
//
// Nothing here throws. A missing, half-built or FAILED-stamped store is a
// fall-through reason, never an outage on a read path that has a working fold
// sitting right beside it.

let _snap = null;
let _generation = 0;

/**
 * How many times a snapshot has been loaded in this process. A caller that
 * caches derived answers watches this to know when its cache died.
 *
 * The fold's own place-word cache is cleared by `world()` rebuilding — but in
 * serve mode `world()` is never called, so a rehydration would otherwise leave
 * the office repeating place words from a store snapshot it no longer holds,
 * forever, with nothing to invalidate them. Zero until something loads, so an
 * office with the flags off never clears anything.
 */
export const storeGeneration = () => _generation;

/**
 * The generation a derived cache should key itself to — re-statting the store
 * first, because the caller is about to decide whether to answer from its cache
 * and a cache HIT never reaches the harness that would otherwise have noticed
 * the rehydration. Without the re-stat a hot cache cell serves the old world
 * forever, which is the one failure a rehydration must never be able to cause.
 *
 * Zero, and untouched, when the flags are off: nothing to invalidate, nothing
 * stat'd, no behaviour to change.
 */
export function storeEpoch() {
  if (!storeEngaged()) return 0;
  storeSnapshot();
  return _generation;
}

export function storeSnapshot() {
  const dbPath = storeDbPath();
  let st;
  try { st = statSync(dbPath); }
  catch { return { error: `no world store at ${dbPath}`, dbPath }; }
  if (_snap && _snap.dbPath === dbPath && _snap.mtimeMs === st.mtimeMs && _snap.size === st.size) return _snap;
  try {
    const loaded = loadWorldGraph(dbPath);
    _snap = {
      dbPath, mtimeMs: st.mtimeMs, size: st.size,
      graph: loaded.graph, meta: loaded.meta, counts: loaded.counts,
      asOfWorld: loaded.meta.as_of_world ?? null,
      marks: markRecords(loaded.graph),
      loadedAt: new Date().toISOString(),
    };
    // The rings the store does not carry (see pointAnswerable). Six marks today.
    _snap.irregular = _snap.marks.filter((m) => m._ring_vertices != null && m.at);
    _generation++;
    return _snap;
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 200), dbPath };
  }
}

/** Drop the cached snapshot — for tests that rewrite world.db in place. */
export function resetStoreSnapshot() { _snap = null; _generation++; }

// ── the projection: store rows → the shape the engine reads ──────────────────
//
// The office does not reimplement the world's geometry, here or anywhere. The
// store supplies the FACTS and the world's own engine supplies the MATHS, so a
// store-served read runs the identical `containmentChain` over an identical
// mark list — and parity becomes the one question worth asking: are the store's
// rows the same world the fold just assembled?
//
// `points` is deliberately absent rather than faked. The hydrator records a
// ring as its vertex count, so a mark that carries one is flagged
// (`_ring_vertices`) and the guard refuses any point it could touch. Handing
// the engine a mark with no `points` would make it answer by bounding box and
// call that agreement.

export function markRecords(graph) {
  const rows = [];
  graph.forEachNode((id, a) => {
    if (a.kind !== "mark") return;
    const p = a.props ?? {};
    const rec = {
      id, kind: a.subkind ?? null, by: a.by ?? null, tier: a.tier ?? null,
      body: p.body ?? "", slot: p.slot ?? null, value: p.value ?? null,
      // `parent` is a DESCRIBING mark's subject, and only that. The store also
      // knows every geometric mark's directory parent (`parent_dir_mark`) — the
      // fold does not, which is why mark ancestry is a store-only query — but
      // publishing it here under the fold's field name would put a `parent` on
      // 309 marks the fold leaves bare, and every record comparison would read
      // as a disagreement about a field neither side disputes.
      parent: p.explicit_parent ?? (a.subkind === "predicated" || a.subkind === "naming" ? p.parent_dir_mark ?? null : null),
      _ring_vertices: p.points ?? null,
    };
    if (a.x != null) rec.at = { x: a.x, y: a.y };
    if (a.w != null) rec.extent = { w: a.w, h: a.h };
    if (p.far) rec.far = true;
    rows.push(rec);
  });
  return rows;
}

const GEOMETRIC = (m) => m?.kind === "sited" || m?.kind === "parcel";

/**
 * May the store answer a question asked AT A POINT?
 *
 * Three ways it may not, each one a place where the store's answer could differ
 * from the fold's for a reason that has nothing to do with the store being
 * wrong — and a difference nobody can explain is worse than a fall-through
 * everybody can count.
 *
 *   irregular-shape-in-play  Six water marks carry `points:` rings. The engine
 *     tests a point against the RING; the store holds only the vertex count, so
 *     it would answer by bounding box. Refused whenever the point lies in any
 *     ring-carrying mark's bbox — sound (a ring never reaches outside its own
 *     bbox, so no answer changes outside one) and complete (both the point test
 *     and the nest's `marksContain` go analytic once no irregular mark is in
 *     range). This is the fall-through that actually fires; the honest fix is a
 *     hydrator that stores the ring, and that is Stage 1's next commit, not this
 *     one's.
 *
 *   equal-extent-tie  `containmentChain` sorts the containing marks by extent
 *     AREA and V8's sort is stable, so two containing marks of equal area leave
 *     the innermost decided by ITERATION ORDER. The fold's order is its loader's
 *     and the store's is SQLite's, and neither promises the other anything.
 *
 *   nearest-tie  The place-word FALLBACK — the branch that runs only when
 *     nothing contains the point — picks the nearest sited mark with a strict
 *     `<`, so an exact distance tie keeps whichever came first: the same
 *     iteration-order coin toss, on a grid town where equidistant 25×25 parcels
 *     are an ordinary arrangement rather than a freak one. `checkNearest` is the
 *     caller saying whether that branch is actually in play. It was briefly
 *     checked unconditionally, on the theory that reasoning about when the
 *     fallback fires invites a subtle bug; the spike answered that: exact ties
 *     are common enough away from any containing mark that the unconditional
 *     check refused a third of all points, most of them points where the
 *     fallback would never have run. A guard that vetoes what it was not
 *     guarding is not caution, it is a store that never serves.
 */
export function pointAnswerable(snap, { x, y }, geom, { checkNearest = true } = {}) {
  const { rect, pointInRect } = geom;
  for (const m of snap.irregular) if (pointInRect(x, y, rect(m))) return "irregular-shape-in-play";

  const areas = [];
  for (const m of snap.marks) {
    if (!m.at || !GEOMETRIC(m) || !pointInRect(x, y, rect(m))) continue;
    areas.push((m.extent?.w ?? 1) * (m.extent?.h ?? 1));
  }
  if (new Set(areas).size !== areas.length) return "equal-extent-tie";
  if (!checkNearest) return null;

  let best = Infinity, ties = 0;
  for (const m of snap.marks) {
    if (!m.at || !GEOMETRIC(m)) continue;
    const d = Math.hypot(m.at.x - x, m.at.y - y);
    if (d < best) { best = d; ties = 1; } else if (d === best) ties++;
  }
  return ties > 1 ? "nearest-tie" : null;
}

// ── graph queries ────────────────────────────────────────────────────────────
// Three shapes the store answers. The first has a live consumer (place words);
// the other two are the graph answering questions THE FOLD CANNOT — a folded
// mark carries no parent link for geometric kinds at all, so mark ancestry and
// fan-up weight exist in the store and nowhere else. They are therefore not
// live-shadowed: there is nothing on the read path to diff them against.
// `npm run world:shadow` is their parity gate, offline, against the engine's own
// `placementParent`.

/** One published mark's RECORD fields. Never the fold's `stamps`/`weight`: those are settled-stake outputs, not repo facts. */
export function markRecord(snap, id) {
  const m = snap.marks.find((r) => r.id === id);
  if (!m) return null;
  const { _ring_vertices, ...rec } = m;
  return { ...rec, ring_vertices: _ring_vertices };
}

/** A mark's containment ancestry, nearest first — walked up the store's `contains` edges. */
export function markSpine(snap, id) { return containmentSpine(snap.graph, id); }

/** How many geometric marks hang under this one, at any depth. The structural canary: a spine can agree pointwise while the tree above it is wrong. */
export function fanUp(snap, id) {
  let n = 0;
  for (const m of snap.marks) {
    if (!GEOMETRIC(m) || !m.at || m.id === id) continue;
    if (containmentSpine(snap.graph, m.id).includes(id)) n++;
  }
  return n;
}

// ── eligibility ──────────────────────────────────────────────────────────────

// WHICH main refs exist does not change between deploys, so the ref LIST is
// cached; the shas they point at are re-read every call, in ONE spawn for the
// common case. TWO refs now, because two pens move published main: the box's
// settlements advance refs/heads/main (ahead of their own push for a few
// seconds), and the keeper's PC pushes straight to GitHub — so
// refs/remotes/origin/main (freshened by the tick's fetch every ~15 min) can
// be AHEAD of a local branch nothing box-side moves. mainRef()'s
// local-preference is right for the WRITE paths (a draft forks from the
// freshest local line mid-settlement) and was wrong here: on 2026-08-17 the
// as-of bar read the lag backwards and reported the store BEHIND a "main"
// that was itself two commits stale. The published sha is the DESCENDANT when
// the two disagree; a truly diverged pair falls to origin, because published
// truth is what the world can clone.
const _mainRefsByRepo = new Map();
export function publishedMainSha(repo) {
  let refs = _mainRefsByRepo.get(repo);
  if (!refs) {
    refs = ["refs/heads/main", "refs/remotes/origin/main"].filter((r) => refExists(repo, r));
    if (!refs.length) throw new Error("world clone has no main ref");
    _mainRefsByRepo.set(repo, refs);
  }
  let shas;
  try {
    shas = execFileSync("git", ["-C", repo, "rev-parse", ...refs.map((r) => `${r}^{commit}`)], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim().split("\n");
  } catch {
    _mainRefsByRepo.delete(repo);         // a ref moved or vanished; re-resolve next call
    throw new Error("published main sha unreadable");
  }
  const [local, origin] = shas;
  if (shas.length === 1 || local === origin) return local;
  const isAncestor = (a, b) => {
    try { execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", a, b], { stdio: "ignore" }); return true; }
    catch { return false; }
  };
  if (isAncestor(local, origin)) return origin;   // the box lagged; published truth moved ahead
  if (isAncestor(origin, local)) return local;    // a settlement's push is in flight
  return origin;                                  // diverged: what the world can clone wins
}

// The sha the READ tier serves — the newest blessing's commit, or main's when
// the clone carries no settlement tag (`world-branches.mjs § blessed`). Every
// freshness gate in the office compares the store to THIS, because this is what
// the fold beside the store is reading (postmark#2934). `publishedMainSha` above
// stays what it is — main's published line — and names the candidate.
export function servedCanonSha(repo) { return blessed(repo).sha; }

/**
 * May this read be answered from the store? Returns `{ ok, reason, snap, sha }`.
 *
 * RULING 9 FIRST. `draftRefForKey` returning a ref means the caller passed a
 * household key; world.db does not index sketchbooks, so the store is not
 * consulted — not even in shadow. Since §1c no read tier folds a sketchbook, so
 * this is a belt rather than a mirror (see the header): no live caller reaches
 * it, and it exists so that a keyed read added to this lane fails safe.
 */
export function eligibility({ key = null, repo }) {
  const draftRef = draftRefForKey(repo, key);
  if (draftRef) return { ok: false, reason: "draft-branch", draft_ref: draftRef };

  const snap = storeSnapshot();
  if (snap.error) return { ok: false, reason: "store-unavailable", detail: snap.error };

  // THE BLESS OVERRIDES THE TICK (postmark#2934): "the very commit the fold
  // would have served" is now the newest settlement's, not main's — the fold
  // reads at `blessedRef`, and the tick hydrates `--ref blessed`, so this gate
  // compares the store to the same resolution. `main` stays in the fall-through
  // record as `candidate_ahead` so an operator can see WHY the two differ.
  let sha;
  try { sha = servedCanonSha(repo); }
  catch (e) { return { ok: false, reason: "no-main-sha", detail: String(e?.message ?? e) }; }
  if (!snap.asOfWorld) return { ok: false, reason: "store-unstamped" };
  if (snap.asOfWorld !== sha) return { ok: false, reason: "store-stale", store: snap.asOfWorld, main: sha };

  return { ok: true, snap, sha };
}

// ── counters + the diff log ──────────────────────────────────────────────────

const zeroCounters = () => ({
  reads: 0, served_from_store: 0, served_from_fold: 0,
  compared: 0, agreed: 0, diffs: 0,
  fall_through: {
    "draft-branch": 0, "store-unavailable": 0, "store-stale": 0, "store-unstamped": 0,
    "no-main-sha": 0, "store-threw": 0, "cannot-answer": 0,
  },
  cannot_answer: {},          // the query's own reason -> count
  by_read: {},                // read name -> { store, fold, compared, diffs }
});
let COUNT = zeroCounters();
export const storeCounters = () => COUNT;
export function resetStoreCounters() { COUNT = zeroCounters(); LOGGED.clear(); LOG_STATE.lines = 0; LOG_STATE.suppressed = 0; RECENT.length = 0; }

const perRead = (name) => (COUNT.by_read[name] ??= { store: 0, fold: 0, compared: 0, diffs: 0 });

// A diff log that can fill a disk is a diff log an operator turns off, so two
// bounds: identical disagreements are written ONCE (the same wrong mark asked
// about a thousand times is one finding, and the counter still counts all
// thousand), and the file stops growing at a cap. Both are reported on the
// health surface so a suppressed log can never look like a quiet one.
const LOG_CAP_BYTES = 4 * 1024 * 1024;
const RECENT_MAX = 20;
const LOGGED = new Set();
const LOG_STATE = { lines: 0, suppressed: 0 };
const RECENT = [];

const fingerprintOf = (v) => createHash("sha256").update(stable(v)).digest("hex").slice(0, 16);
function stable(v) {
  if (v === undefined) return " undefined";
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
}
const short = (v) => { const s = stable(v); return s.length > 300 ? `${s.slice(0, 300)}…` : s; };

function logDiff(entry) {
  RECENT.push({ at: entry.at, read: entry.read, fold_hash: entry.fold_hash, store_hash: entry.store_hash });
  if (RECENT.length > RECENT_MAX) RECENT.shift();
  const dedupe = `${entry.read}|${entry.fold_hash}|${entry.store_hash}`;
  if (LOGGED.has(dedupe)) return;
  LOGGED.add(dedupe);
  const path = shadowLogPath();
  try {
    let size = 0;
    try { size = statSync(path).size; } catch { /* first line */ }
    if (size >= LOG_CAP_BYTES) { LOG_STATE.suppressed++; return; }
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
    LOG_STATE.lines++;
  } catch (e) {
    LOG_STATE.suppressed++;
    console.error(`[world-store] shadow diff could not be written to ${path}: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}

let warnedUnavailable = null;

// ── the harness ──────────────────────────────────────────────────────────────

/**
 * Answer one world read, from the store or from the fold, per the flags.
 *
 * @param {string} name        the read's name, as it appears in the log and the counters
 * @param {object} o
 * @param {Function} o.fold    the existing path. THE DEFAULT, and the only thing that runs with the flags off.
 * @param {Function} o.store   given the snapshot, the store's answer — or `cannotAnswer(why)`
 * @param {*}        o.key     the caller's credential (ruling 9's branch decision)
 * @param {string}   o.repo    the world clone
 * @param {object}   o.detail  `{ route, query }`, for the diff log
 */
export async function servedRead(name, { fold, store, key = null, repo, detail = null }) {
  // THE FLAG-OFF PATH IS THIS LINE. Nothing below it runs — no stat of the db,
  // no git spawn, no counter, no allocation. "Both flags off is byte-identical
  // to today" is a claim a reviewer can check by reading one comparison.
  if (!storeEngaged()) return fold();

  const shadow = storeShadowEnabled();
  const serve = storeReadsEnabled();
  COUNT.reads++;
  const stats = perRead(name);

  const fellBack = (reason, extra) => {
    COUNT.served_from_fold++; stats.fold++;
    COUNT.fall_through[reason] = (COUNT.fall_through[reason] ?? 0) + 1;
    if (reason === "store-unavailable" && warnedUnavailable !== extra) {
      warnedUnavailable = extra;
      console.error(`[world-store] reads requested but the store is unavailable (${extra}) — serving the fold`);
    }
    return fold();
  };

  const gate = eligibility({ key, repo });
  if (!gate.ok) return fellBack(gate.reason, gate.detail ?? gate.draft_ref ?? gate.store);

  let answer;
  try { answer = await store(gate.snap); }
  catch (e) {
    console.error(`[world-store] ${name} threw against the store — serving the fold (${String(e?.message ?? e).slice(0, 160)})`);
    return fellBack("store-threw", null);
  }
  if (refused(answer)) {
    COUNT.cannot_answer[answer.why] = (COUNT.cannot_answer[answer.why] ?? 0) + 1;
    return fellBack("cannot-answer", answer.why);
  }

  if (!shadow) {
    COUNT.served_from_store++; stats.store++;
    return answer;
  }

  // Shadow: both answers, every eligible read. The fold is computed AFTER the
  // store's so a store that hangs or throws cannot hide behind a warm fold.
  const foldAnswer = await fold();
  const a = fingerprintOf(foldAnswer), b = fingerprintOf(answer);
  COUNT.compared++; stats.compared++;
  if (a === b) COUNT.agreed++;
  else {
    COUNT.diffs++; stats.diffs++;
    logDiff({
      at: new Date().toISOString(), read: name,
      route: detail?.route ?? null, query: detail?.query ?? null,
      as_of_world: gate.snap.asOfWorld, main_sha: gate.sha,
      fold_hash: a, store_hash: b,
      diff: { fold: short(foldAnswer), store: short(answer) },
    });
  }
  if (serve) { COUNT.served_from_store++; stats.store++; return answer; }
  COUNT.served_from_fold++; stats.fold++;
  return foldAnswer;
}

// ── the operator's surface ───────────────────────────────────────────────────

export function worldStoreHealth({ repo = null } = {}) {
  const mode = storeMode();
  const snap = storeSnapshot();
  const db = snap.error
    ? { path: snap.dbPath, present: false, error: snap.error }
    : {
      path: snap.dbPath, present: true,
      as_of_world: snap.meta.as_of_world ?? null,
      as_of_office: snap.meta.as_of_office || null,
      hydrated_at: snap.meta.hydrated_at ?? null,
      hydration_status: snap.meta.hydration_status ?? null,
      nodes: snap.graph.order, edges: snap.graph.size,
      marks: snap.marks.length, ring_carrying_marks: snap.irregular.length,
      loaded_at: snap.loadedAt,
    };

  // Two blocks, two questions (postmark#2934). `blessed` is what the read tier
  // serves and what the store must be hydrated at to be fresh; `main` is the
  // crossing's candidate line, kept so an operator can see the gap between
  // the tick and the bless — `fresh` moved to the blessed block because that is
  // the comparison the eligibility gate actually makes now.
  let main = null, canon = null;
  if (repo) {
    try {
      const b = blessed(repo);
      canon = {
        as_of_settlement: b.n == null ? null : `S${b.n}`, ref: b.ref, sha: b.sha, source: b.source,
        candidate_ahead: b.candidate_ahead, next_attempt_at: nextSettlementAttemptAt(),
        fresh: !snap.error && snap.asOfWorld === b.sha,
        ...(b.disclosed ? { disclosed: b.disclosed } : {}),
      };
      main = { repo, sha: b.main_sha, ref: b.main_ref, ahead_of_blessed: b.candidate_ahead != null };
    } catch (e) { main = { repo, error: String(e?.message ?? e) }; }
  }

  return {
    mode,
    // W2_FOLD (POS-142): "store" = /world/state is the world fold over the store's rows (src/world2-fold.mjs)
    flags: { WORLD_STORE_READS: process.env.WORLD_STORE_READS ?? null, WORLD_STORE_SHADOW: process.env.WORLD_STORE_SHADOW ?? null, W2_FOLD: process.env.W2_FOLD ?? null },
    eligibility: "blessed reads only — a resolved household folds its draft branch and is never served from the store (ruling 9); the store must also be hydrated at the exact sha the newest settlement tag blesses (main, when the clone has no settlement tag)",
    db, blessed: canon, main,
    counters: COUNT,
    shadow_log: { path: shadowLogPath(), lines_written: LOG_STATE.lines, suppressed: LOG_STATE.suppressed, distinct_diffs: LOGGED.size },
    recent_diffs: RECENT.slice(-RECENT_MAX),
  };
}

if (process.argv[1]?.endsWith("world-serve.mjs")) {
  const { WORLD_CLONE } = await import("./world-store.mjs");
  console.log(JSON.stringify(worldStoreHealth({ repo: WORLD_CLONE }), null, 2));
}
