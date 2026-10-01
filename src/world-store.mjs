// world-store.mjs — the world graph's DDL and read-side runtime.
//
// world.db is a SIBLING of office.db, never a part of it. Same constitution
// ("The DB is an INDEX, never the truth", rebuilt from scratch every hydration,
// as-of shas stamped in `meta`, served read-only), but a separate file for a
// separate reason: office.db indexes the TOWN repo, world.db indexes the WORLD
// repo, and the two advance on different clocks. Mixing them would mean one
// rehydration could not be truthful about both shas at once.
//
// Everything in world.db is recomputable from the two checkouts named in `meta`
// at the shas named in `meta`, so the file may be deleted at any moment without
// losing a fact the town owns.
//
// Node kinds today: mark | class | code | doctrine — and that is the whole list.
// `entity` and `emission` were expected here at Stage 2 and landed in a separate
// file instead (`dynamic.db`, see DYNAMIC-STORE.md): this store is deleted and
// rebuilt whole on every hydration, and the dynamic layer is exactly the state
// that must survive that. The columns below would have fitted them; the covenant
// would not.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { MultiDirectedGraph } from "graphology";

// ── the DDL ──────────────────────────────────────────────────────────────────

export const SCHEMA = `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

  -- at_x/at_y are ABSOLUTE grid metres (origin = the Origin, {0,0}, x east,
  -- y south) — the coordinate the mark record itself carries. Relative
  -- coordinates and the transform chain are Stage D; this table stores what the
  -- repo says, at the sha named in meta.
  CREATE TABLE nodes (
    id TEXT PRIMARY KEY,
    kind TEXT, subkind TEXT, tier TEXT, by TEXT,
    at_x REAL, at_y REAL, extent_w REAL, extent_h REAL,
    props TEXT
  );
  CREATE INDEX nodes_kind ON nodes (kind, subkind);
  CREATE INDEX nodes_by ON nodes (by);

  -- Edges are DATA, not schema: the taxonomy grows by use, and a dst that
  -- resolves to no node is kept verbatim rather than dropped — a dangling edge
  -- is the finding, and deleting it would delete the finding.
  CREATE TABLE edges (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    src TEXT, dst TEXT, type TEXT, props TEXT, born_at TEXT
  );
  CREATE INDEX edges_src ON edges (src, type);
  CREATE INDEX edges_dst ON edges (dst, type);
  CREATE INDEX edges_type ON edges (type);

  CREATE TABLE events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT, actor TEXT, type TEXT, payload TEXT
  );
  CREATE INDEX events_at ON events (at);
  CREATE INDEX events_actor ON events (actor, at);

  CREATE TABLE edge_type_registry (type TEXT PRIMARY KEY, note TEXT);

  -- THE TENSE LAW (Stage 1's addition). A mark's geometry is not a fact, it is
  -- a fact WITH A VALIDITY WINDOW, and an event must be judgeable against the
  -- geometry of its own instant. Without this table every lint over historical
  -- events re-decides history each time a mark moves: the spike watched the
  -- Pando landing move 1216 m and turn a 22 m near-miss into a 1238 m gross
  -- error that never happened.
  --
  -- Derived mechanically from git history — one row per (mark, geometry) pair
  -- the record has ever held, never hand-authored. valid_from is the COMMITTER
  -- instant of the commit that wrote that geometry (the settled clock, the same
  -- one office.db's repo_log uses); valid_to is the next version's valid_from,
  -- NULL for the version standing at as_of. The town already enforces this rule
  -- one level down — walk.mjs's "within w,h" freezes the target's extent at
  -- departure "so a mark that later moves, resizes, or retires cannot rewrite
  -- where someone walked." This is that rule, lifted to the store.
  CREATE TABLE geometry_versions (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    mark_id TEXT,
    at_x REAL, at_y REAL, extent_w REAL, extent_h REAL,
    valid_from_iso TEXT, valid_to_iso TEXT,
    sha TEXT, path TEXT, subject TEXT, authored_iso TEXT,
    change TEXT                       -- 'birth' | 'moved' | 'resized' | 'moved+resized'
  );
  CREATE INDEX geometry_versions_mark ON geometry_versions (mark_id, valid_from_iso);
  CREATE INDEX geometry_versions_from ON geometry_versions (valid_from_iso);

  -- The standing invariants' verdicts, written at the end of every hydration.
  -- One row per lint per hydration; the graph is rebuilt from scratch, so this
  -- table holds exactly THIS run. The delta against the previous run is read
  -- off the store's newest snapshot and reported in meta.lint_delta.
  CREATE TABLE lint_findings (
    lint TEXT PRIMARY KEY,
    verdict TEXT, headline TEXT, evidence TEXT,
    hydrated_at TEXT, as_of_world TEXT
  );
`;

// The seven decided types (§2.6 / dial 5), plus every type this hydrator
// actually emits. A type earns its row by being emitted or by being decided;
// the note says which and why, so the taxonomy can be read without reading the
// hydrator.
export const EDGE_TYPES = [
  ["contains", "spatial containment. Read from WORLD/containment.json — the map the world's own fold emits every settlement — since the freeze (2026-08-25) made a mark's directory historical filing that claims nothing. A clone with no map falls back to directory nesting and says so (report.containment_source). geometry_ok/placement_ok are still recomputed against tools/geometry.mjs, now as a check of the emitted map against the office's own arithmetic; disagreements are recorded on the edge, never repaired."],
  ["attached-to", "a thing riding another thing (a passenger aboard a vessel, a lamp on a post). DECIDED, and NOT emitted here: Stage 2 put attachments in dynamic.db's own table, because an edge in this store is deleted and rebuilt every hydration and a declared attachment must not be."],
  ["emitted-by", "an emission and its source (a voice and the resident who spoke it). DECIDED, and NOT emitted here: Stage 2 put emissions in dynamic.db, where `source` is a column rather than an edge. Kept in the taxonomy because the relation is real and a later reader will look for it."],
  ["instance-of", "a token and its type. Emitted for parcels -> the synthesized parcel class."],
  ["implements", "a mark and the machinery that keeps its truth true — a `mechanic:` pointer, resolved against skeleton.json's physics_registry."],
  ["reads", "code and a world surface it demonstrably reads: a quoted WORLD/... path literal in the source, or a dynamic import reaching into the world clone's tools."],
  ["stop-of", "a stop mark and the vessel whose timetable names it. Dst is kept verbatim when it resolves to no mark — the dangling stop IS the finding."],
  ["imports", "ADDED: static `import ... from` between code files. Extracted from source, never hand-maintained, because L1 rules on it: the-reaching-mechanic says \"Every mechanic names running code and the name resolves — a rule whose mechanic reaches nothing is ink\", and `resolves` means reachable from src/server.mjs over imports+reads. A hand-kept list would let that verdict agree with whoever last edited the list. Distinct from `reads`, which crosses from code into world DATA rather than into another module."],
  ["describes", "ADDED: a predicated/naming mark and the mark it predicates. SCHEMA.md's continuation law makes this NOT containment — a predicate inherits its parent's extent whole rather than sitting inside it — so folding it into `contains` would assert geometry the record never claims. Also carries ENGINE.md headings to the mechanics they document (heading text names the mechanic id)."],
];

// ── THE CLASS-MARK GATE (Stage 3, seam 1) ───────────────────────────────────
//
// An affordance is a VERB, and the only thing allowed to mint one is settled
// law: a mark authored by the town, at constitution tier, carrying a `class:`
// field. Resident prose can never mint a verb, however well-formed the
// frontmatter someone writes.
//
// The gate lives HERE, in the module that owns how the store is read, because
// it has two readers who must never disagree: the apex verb, which surfaces
// affordances at a standpoint (SQL, for the query planner), and lint L6, which
// checks that every exposed action has a handler (a predicate, over the loaded
// graph). Two copies of a security boundary is one copy too many; a test asserts
// the SQL and the predicate select the same nodes.
//
// `by = 'the-town'` is the clause that carries the weight. Tier is a word in
// somebody's frontmatter until authorship makes it a fact, and the write doors
// stamp `by` from the caller's own resident handles — the town is not a
// resident, so no credential at any door can author as it.
// THE POSITION CLAUSE (step-1 promotion, 2026-08-18; LOGOS/classes.md
// § Instantiation, ruled 2026-08-17: classes are declared "constitution-tier,
// standing in the Keeping Works"). Position is what tells a DECLARATION from
// an INSTANCE that happens to be town-authored — the three harbor charters
// carry `class: town` and declare nothing.
//
// ── RE-KEYED BY THE FREEZE, 2026-08-25 ──────────────────────────────────────
//
// This used to be the substring `/the-keeping-works/` in a mark's stored path,
// on the reasoning that "the marks tree nests a mark's directory under its
// parent's, so `/the-keeping-works/` in the path IS standing in the works". The
// freeze repealed the premise:
//
//   "Filing is frozen as of 2026-08-25. A mark's directory is its historical
//    filing: it carries no claim, and it never moves again. New marks are filed
//    by identity — WORLD/marks/<household>/<slug>/ — and containment lives only
//    in the derived fold, emitted as an artifact each settlement."
//                    (LOGOS/state-and-time.md § "The freeze", founder-ruled)
//
// A path test under that law is a QUIET failure, not a loud one: a class mark
// filed at `WORLD/marks/<by>/<slug>/` stands in the works by containment, fails
// the substring, and mints no verb — the door it declares simply is not there,
// with nothing refused and nothing logged.
//
// So position is now asked of containment. `world-hydrate.mjs` stamps
// `props.in_works` on every mark from the fold's own `WORLD/containment.json`
// chain, and this clause reads that stamp. The path arm survives as the FALLBACK
// for a store hydrated before the stamp existed — where the key is absent, and
// only there, the old substring answers. An explicit `false` refuses.
//
// One definition, taken by an alias so a joined query can spell it against its
// own table without a hand-copy. (The copy in world-classes.mjs was written out
// by hand precisely because this string carried a bare `props`; parameterising
// the alias is what lets that copy die.)
//
// ── AND IT CLOSES A DIVERGENCE THAT WAS NEVER ONLY A COPY ────────────────────
//
// The comment this replaces claimed the office "mirrors the world's own
// mark-lint CLASS_ROSTER, same clause, same commit". That was false at the
// level that matters: the world's lint walked `_parentMarkId` ANCESTRY, while
// the office matched a PATH SUBSTRING. On the pre-freeze tree the two agreed
// because nesting and path were the same fact — so the divergence was invisible
// and would have surfaced only as a class mark that mints on one side of the
// town and not the other. Both now ask CONTAINMENT, which is one mechanism
// rather than two that happen to coincide.
export const worksClause = (alias = "") => {
  const p = alias ? `${alias}.props` : "props";
  return `(json_extract(${p}, '$.in_works') = 1
      OR (json_extract(${p}, '$.in_works') IS NULL
          AND json_extract(${p}, '$.path') LIKE '%/the-keeping-works/%'))`;
};
export const WORKS_PATH_SQL = worksClause();
export const standsInTheWorks = (attr) => attr?.props?.in_works === true
  || (attr?.props?.in_works == null && String(attr?.props?.path ?? "").includes("/the-keeping-works/"));

export const CLASS_MARK_GATE_SQL = `
     kind = 'mark'
     AND by   = 'the-town'
     AND tier = 'constitution'
     AND json_extract(props, '$.class') IS NOT NULL
     AND ${WORKS_PATH_SQL}
     AND (json_extract(props, '$.actions')     IS NOT NULL
      OR  json_extract(props, '$.affordances') IS NOT NULL)`;

/** The same gate, as a predicate over a loaded node's attributes.
 *  `actions:` is the key (2026-08-15); `affordances:` is its pre-rename
 *  spelling, still admitted so a store hydrated from older law keeps its
 *  doors. */
export const isClassMark = (attr) => attr?.kind === "mark"
  && attr?.by === "the-town"
  && attr?.tier === "constitution"
  && attr?.props?.class != null
  && standsInTheWorks(attr)
  && (attr?.props?.actions != null || attr?.props?.affordances != null);

// ── THE CLASS ROSTER — a WIDER gate than the one above, deliberately ─────────
//
// Which class NAMES exist in law. This is not the affordance gate minus a
// clause by accident: `affordances:` is what lets a class mint a VERB, and most
// classes mint none. `the-town/parcel` and `the-town/attachment` carry no
// `affordances:` field at all and are unquestionably law; requiring one here
// would make `class: parcel` a lie on the record while the parcel class stands
// in the Keeping Works.
//
// The world's own lint already draws exactly this line (`tools/mark-lint.mjs`
// § CLASS_ROSTER — "a class NAME is lawful exactly when the town's own
// constitution mark declares it (the class VALUE, never the slug)"), and it
// derives the roster from the record rather than holding a list. The office
// held a list — one entry, `"bounty"` — so the two doors disagreed the moment
// law grew a second resident-declarable class. This is the office's half of
// that one definition, gated identically: authorship carries the weight, and no
// credential at any door can author as the town.
export const CLASS_ROSTER_GATE_SQL = `
     kind = 'mark'
     AND by   = 'the-town'
     AND tier = 'constitution'
     AND json_extract(props, '$.class') IS NOT NULL
     AND ${WORKS_PATH_SQL}`;

/** The same roster gate, as a predicate over a loaded node's attributes.
 *  Position-claused since the step-1 promotion (see WORKS_PATH_SQL above):
 *  a class-carrying mark OUTSIDE the works is an INSTANCE of that class. */
export const isClassDefinition = (attr) => attr?.kind === "mark"
  && attr?.by === "the-town"
  && attr?.tier === "constitution"
  && attr?.props?.class != null
  && standsInTheWorks(attr);

// ── AMBIENT REACH — a second, separate rule ─────────────────────────────────
//
// `ambient: true` on a class mark means its affordances gather EVERYWHERE
// rather than only where the mark stands: jurisdiction travels the law, not the
// address (LOGOS/classes.md, 2026-08-09). The sound class stands in the physics
// quarter and `say` is affordable at the quay, because speech is governed by
// the law of speech and not by proximity to the building that records it.
//
// THIS WIDENS REACH, NEVER TRUST, and the separation is structural rather than
// a promise in a comment: a row must pass `CLASS_MARK_GATE_SQL` *first*, and
// ambient only decides whether a row that already passed is visible from where
// the caller stands. An ambient mark that is not the town's constitutional law
// is gathered by nobody, from nowhere.
//
// It is also why this is NOT folded into `isClassMark`. That predicate answers
// "is this a class mark", and lint L6 asks it of every mark in the world to
// find actions law exposes — narrowing it to the ambient ones would blind L6
// to exactly the sited affordances (`board`) it exists to catch. Two rules,
// two names, each with a SQL/predicate twin the agreement test checks.
//
// `json_type(...) = 'true'` rather than `json_extract(...) = 1`: the strict
// test admits the boolean and nothing that merely looks like it.
export const AMBIENT_REACH_SQL = `json_type(props, '$.ambient') = 'true'`;

/** The same ambient rule, as a predicate over a loaded node's attributes. */
export const isAmbient = (attr) => attr?.props?.ambient === true;

/** The actions a node exposes. Callers must gate first; this only reads.
 *  `actions:`/`action` are the keys (renamed from `affordances:`/`subverb`
 *  2026-08-15 — one taxonomy: LOGOS calls them actions, so the door does
 *  too); the old spellings are still read so a store hydrated from
 *  pre-rename law keeps its doors. */
export const actionsOf = (attr) => {
  const list = attr?.props?.actions ?? attr?.props?.affordances;
  return (Array.isArray(list) ? list : [])
    .map((a) => String(a?.action ?? a?.subverb ?? "").trim())
    .filter(Boolean);
};

// The full entries, with the actor kind each grant is FOR (2026-08-17, the
// act-as-human packet): `for:` absent means resident — today's intent made
// explicit, never a guess. L6 reads these so an action minted for an actor
// kind the door cannot resolve is a named red, not an invisible one.
export const actionEntriesOf = (attr) => {
  const list = attr?.props?.actions ?? attr?.props?.affordances;
  return (Array.isArray(list) ? list : [])
    .map((a) => ({
      action: String(a?.action ?? a?.subverb ?? "").trim(),
      for: String(a?.for ?? "resident").trim() || "resident",
    }))
    .filter((e) => e.action);
};

// ── the world clone, and reading it AT A SHA ─────────────────────────────────

export const OFFICE_ROOT = resolve(import.meta.dirname, "..");

// Same resolution order src/world.mjs uses, so the hydrator and the live office
// can never be pointed at two different clones by accident.
export const WORLD_CLONE = process.env.WORLD_CLONE
  ?? [join(OFFICE_ROOT, "world-clone"), join(OFFICE_ROOT, "..", "postmark-world")].find(existsSync)
  ?? join(OFFICE_ROOT, "world-clone");

// `encoding` governs stdin as well as stdout in execFileSync, and "buffer" is
// only a legal OUTPUT encoding — a string `input` alongside it throws. Handing
// stdin over as bytes keeps the one helper usable for both the text calls and
// the cat-file batch.
export const git = (repo, args, opts = {}) => execFileSync("git", ["-C", repo, ...args], {
  encoding: opts.encoding ?? "utf8",
  maxBuffer: opts.maxBuffer ?? 512 * 1024 * 1024,
  stdio: opts.stdio ?? [opts.input == null ? "ignore" : "pipe", "pipe", "pipe"],
  input: typeof opts.input === "string" ? Buffer.from(opts.input, "utf8") : opts.input,
});

const WORLD_CACHE = join(tmpdir(), "postmark-world-store");

/**
 * Materialise world subtrees AT A SHA into a sha-keyed cache, and hand back a
 * path safe to read and import from.
 *
 * This is src/world-branches.mjs's materializeAtRef discipline — "what is
 * checked out cannot change what the office executes" — with two deliberate
 * differences, both of which the hydrator needs:
 *
 *   1. It pins to the sha BEING HYDRATED rather than to freshest-main, so the
 *      marks folded, the tools that fold them, and the as_of stamped on every
 *      row are one commit. "Rebuildable at any commit" is only true if the
 *      hydrator can be pointed at a commit.
 *   2. It copies with one `ls-tree` and one `cat-file --batch` instead of one
 *      `git show` per file. The world subtree is 637 blobs; per-file spawns
 *      cost about a minute on Windows and this costs about a second.
 *
 * The working tree is never read. The world clone is fetch-never-pull and is
 * routinely parked on a household's draft branch by the write pen — reading
 * marks off it would mean the index described whatever the last writer left
 * behind while claiming the sha of something else.
 */
export function materializeWorldAtSha(repo, sha, subdirs, cacheRoot = WORLD_CACHE) {
  const dir = join(cacheRoot, sha);
  const stamp = join(dir, ".materialized");
  if (existsSync(stamp)) return dir;

  const listing = git(repo, ["ls-tree", "-r", "-z", sha, "--", ...subdirs]);
  const entries = [];
  for (const rec of listing.split("\0")) {
    if (!rec) continue;
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/.exec(rec);
    if (!m) continue;
    if (m[2] !== "blob") continue;                  // submodules/trees have no content to copy
    entries.push({ oid: m[3], path: m[4] });
  }
  if (!entries.length) throw new Error(`no files under ${subdirs.join(", ")} at ${sha.slice(0, 12)}`);

  // One cat-file process for every blob. The protocol is line-oriented on the
  // way in and length-prefixed on the way out: "<oid> blob <size>\n" then size
  // bytes then "\n". Parsed as a buffer because mark bodies are UTF-8 and the
  // byte counts are what the header promises.
  const out = git(repo, ["cat-file", "--batch"], { encoding: "buffer", input: entries.map((e) => e.oid).join("\n") + "\n" });
  let off = 0;
  for (const e of entries) {
    const nl = out.indexOf(0x0a, off);
    if (nl < 0) throw new Error(`cat-file stream ended early at ${e.path}`);
    const header = out.subarray(off, nl).toString("utf8");
    const size = Number(header.split(" ")[2]);
    if (!Number.isFinite(size)) throw new Error(`cat-file header unparseable for ${e.path}: ${header}`);
    const body = out.subarray(nl + 1, nl + 1 + size);
    off = nl + 1 + size + 1;
    const file = join(dir, e.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  writeFileSync(stamp, `${sha}\n${new Date().toISOString()}\n${entries.length} blobs\n`);
  pruneWorldCache(cacheRoot, dir);
  return dir;
}

// THE CACHE HAS A CEILING (founder-ruled 2026-09-01, the day the box filled).
// This cache is keyed by sha and was never pruned: every hydration — each
// settlement, each shadow, each hand-run — left its ~12 MB copy of the marks
// tree behind, correct forever and growing forever. On 2026-09-01 it held 227
// shas, 2.2 GB, beside a /tmp already full of the suite's own residue. A cache
// is only a cache if something forgets: keep the newest few (by their stamp),
// drop the rest on every entry. The one just materialised is never a
// candidate. Pruning never fails a hydration — a cache that refuses to hydrate
// because it could not tidy has inverted its own purpose.
export const WORLD_CACHE_KEEP = Number(process.env.WORLD_CACHE_KEEP ?? 5);
export function pruneWorldCache(cacheRoot = WORLD_CACHE, keepDir = null, keep = WORLD_CACHE_KEEP) {
  let dropped = [];
  try {
    const rows = readdirSync(cacheRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const p = join(cacheRoot, d.name);
        let t = 0;
        try { t = statSync(join(p, ".materialized")).mtimeMs; } catch { try { t = statSync(p).mtimeMs; } catch {} }
        return { p, t };
      })
      .sort((a, b) => b.t - a.t);
    const survivors = new Set(rows.slice(0, keep).map((r) => r.p));
    if (keepDir) survivors.add(resolve(keepDir));
    for (const r of rows) {
      if (survivors.has(r.p) || survivors.has(resolve(r.p))) continue;
      try { rmSync(r.p, { recursive: true, force: true }); dropped.push(r.p); } catch { /* the next entry tries again */ }
    }
  } catch { /* no cache dir yet, or unreadable — nothing to prune */ }
  return dropped;
}

// ── the runtime: world.db -> a Graphology multigraph ─────────────────────────
//
// §2.6 decided node:sqlite for persistence and Graphology for the in-memory
// graph precisely so the lints, the parity harness and the visualiser traverse
// ONE object. If each wrote its own recursive CTE they would drift and the
// lints would be checking three different graphs.
//
// Nothing here writes and nothing here repairs. Where the store holds a
// dangling edge, this materialises a PLACEHOLDER node marked `missing: true`
// rather than dropping it — Graphology needs both endpoints, and the dangling
// edge is the finding the hydrator went out of its way to keep.

const parse = (s, fallback = {}) => { try { return JSON.parse(s ?? "") ?? fallback; } catch { return fallback; } };

/**
 * THE ONE CONSTRUCTION: the graph's rows (the store's snapshot, or a test's) into
 * the graph and its companions. Every source comes through here, so "the
 * snapshot equals the hydration" is a claim about rows, and the parity test
 * checks it row for row.
 *
 * `source` names where the rows came from, for the errors and the `dbPath`
 * field the file's readers have always carried.
 */
export function graphFromTables(tables, { allowFailed = false, source = null } = {}) {
  const meta = Object.fromEntries(tables.meta.map((r) => [r.key, r.value]));
  // A hydration that failed its own emptiness check stamped itself, and the
  // whole point of stamping was that nothing should be able to read it by
  // accident and mistake missing rows for an empty world.
  if (!allowFailed && String(meta.hydration_status ?? "").startsWith("FAILED")) {
    throw new Error(`world store at ${source} is stamped ${meta.hydration_status} — rehydrate before reading it`);
  }
  const graph = new MultiDirectedGraph();

  for (const r of tables.nodes) {
    graph.addNode(r.id, {
      kind: r.kind, subkind: r.subkind, tier: r.tier, by: r.by,
      x: r.at_x, y: r.at_y, w: r.extent_w, h: r.extent_h,
      props: parse(r.props), label: r.id, missing: false,
    });
  }

  const placeholders = [];
  for (const r of tables.edges) {
    for (const end of [r.src, r.dst]) {
      if (end != null && !graph.hasNode(end)) {
        graph.addNode(end, {
          kind: end.startsWith("code:") ? "code" : "unknown",
          subkind: "unresolved", tier: null, by: null,
          x: null, y: null, w: null, h: null,
          props: { unresolved: true }, label: end, missing: true,
        });
        placeholders.push(end);
      }
    }
    if (r.src == null || r.dst == null) continue;   // an edge with no endpoint is not an edge
    graph.addDirectedEdgeWithKey(`e${r.seq}`, r.src, r.dst, {
      type: r.type, props: parse(r.props), bornAt: r.born_at, seq: r.seq,
    });
  }

  const events = tables.events.map((e) => ({ ...e, payload: parse(e.payload) }));
  const geometryVersions = tables.geometryVersions;
  const edgeTypes = tables.edgeTypes;
  const lintFindings = tables.lintFindings.map((r) => ({ ...r, evidence: parse(r.evidence, []) }));

  return {
    graph, meta, events, geometryVersions, edgeTypes, lintFindings, placeholders, dbPath: source,
    counts: parse(meta.counts), anomalies: parse(meta.anomalies),
    anomalyDetail: parse(meta.anomaly_detail), gates: parse(meta.gates, []),
  };
}

// ── the as-of lookup ─────────────────────────────────────────────────────────

/**
 * Index geometry_versions rows for as-of reads: markId -> versions, oldest first.
 */
export function geometryIndex(rows) {
  const byMark = new Map();
  for (const r of rows) {
    if (!byMark.has(r.mark_id)) byMark.set(r.mark_id, []);
    byMark.get(r.mark_id).push(r);
  }
  for (const v of byMark.values()) v.sort((a, b) => (a.valid_from_iso < b.valid_from_iso ? -1 : 1));
  return byMark;
}

/**
 * The geometry a mark HAD at an instant.
 *
 * Returns null in two distinguishable ways, and the caller must not conflate
 * them: `{ status: "unknown-mark" }` (nothing in the store versions this id —
 * a non-geometric mark, or one whose history the deriver could not walk) and
 * `{ status: "not-yet" }` (the mark's first version postdates the instant: at
 * that moment the record did not place this thing anywhere). Answering either
 * with current geometry is exactly the tense error this table exists to end.
 */
export function geometryAsOf(index, markId, iso) {
  const versions = index.get(markId);
  if (!versions?.length) return { status: "unknown-mark", version: null };
  if (iso < versions[0].valid_from_iso) return { status: "not-yet", version: null, first: versions[0] };
  let hit = versions[0];
  for (const v of versions) if (v.valid_from_iso <= iso) hit = v; else break;
  return { status: "ok", version: hit, versions: versions.length };
}

/** A geometry_versions row as the rect the repo's own pointInRect/contains want. */
export const rectOfVersion = (v) => (v && v.at_x != null
  ? { x: v.at_x, y: v.at_y, w: v.extent_w ?? 1, h: v.extent_h ?? 1 }
  : null);

// ── traversal ────────────────────────────────────────────────────────────────

/** Every node reachable from `start` following only edges of `types` (outbound). Includes `start`. */
export function reachable(graph, start, types) {
  const want = new Set(types);
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !graph.hasNode(id)) continue;
    seen.add(id);
    graph.forEachOutEdge(id, (_k, attr, _s, dst) => { if (want.has(attr.type)) queue.push(dst); });
  }
  return seen;
}

/**
 * The containment spine of a mark: its ancestors, nearest first, walked up the
 * inbound `contains` edges. Guarded against a cycle (a cycle would be a
 * finding, not a reason to hang).
 */
export function containmentSpine(graph, id) {
  const spine = [];
  const seen = new Set([id]);
  let cur = id;
  for (;;) {
    let parent = null;
    graph.forEachInEdge(cur, (_k, attr, src) => { if (attr.type === "contains" && parent == null) parent = src; });
    if (parent == null || seen.has(parent)) break;
    spine.push(parent);
    seen.add(parent);
    cur = parent;
  }
  return spine;
}

/** All out-edges of `id` with the given type, as [{key, attr, dst}]. */
export function out(graph, id, type) {
  const rows = [];
  if (graph.hasNode(id)) graph.forEachOutEdge(id, (key, attr, _s, dst) => { if (attr.type === type) rows.push({ key, attr, dst }); });
  return rows;
}

/** All in-edges of `id` with the given type, as [{key, attr, src}]. */
export function inbound(graph, id, type) {
  const rows = [];
  if (graph.hasNode(id)) graph.forEachInEdge(id, (key, attr, src) => { if (attr.type === type) rows.push({ key, attr, src }); });
  return rows;
}

/** Nodes filtered by attribute predicate. */
export function nodesWhere(graph, pred) {
  const rows = [];
  graph.forEachNode((id, attr) => { if (pred(attr, id)) rows.push({ id, attr }); });
  return rows;
}

if (process.argv[1]?.endsWith("world-store.mjs")) (async () => {
  // The store's snapshot, or --rows (POS-270): world.db is retired, so this
  // summary reads what the office reads, and says so when there is none.
  // NOT a top-level await: world-graph-snapshot imports this module, and
  // awaiting it while this module is still evaluating is an import cycle that
  // never settles (node exits 13). The IIFE lets this module finish first.
  const { worldGraphForTool } = await import("./world-graph-snapshot.mjs");
  const argOf = (n) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : null; };
  const w = await worldGraphForTool({ rows: argOf("--rows") });
  if (w.error) { console.error(`no world graph: ${w.error}`); process.exit(1); }
  const { graph, meta, events, geometryVersions, counts } = w.loaded;
  console.log(`world store · ${graph.order} nodes · ${graph.size} edges · ${events.length} events · ${geometryVersions.length} geometry versions`);
  console.log(`  as_of world ${(meta.as_of_world ?? "?").slice(0, 12)} · office ${(meta.as_of_office ?? "?").slice(0, 12)} · hydrated ${meta.hydrated_at}`);
  console.log(`  ${JSON.stringify(counts.nodes_by_kind)}`);
  console.log(`  ${JSON.stringify(counts.edges_by_type)}`);
})().catch((e) => { console.error(`no world graph: ${String(e?.message ?? e)}`); process.exit(1); });
