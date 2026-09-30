#!/usr/bin/env node
// world-hydrate.mjs — build world.db from the world clone at a sha.
//
//   node src/world-hydrate.mjs [--world <path>] [--ref <ref|sha>|blessed] [--office <path>]
//                              [--db <path>] [--no-db] [--to-store] [--no-lints] [--no-gexf] [--json]
//
// THE OUTPUTS (POS-270, lane W item 1). The hydration builds its rows in memory
// (src/world-graph-rows.mjs) and writes each output FROM them:
//   --to-store   the store's graph snapshot, 037/038, through graph-ingest's own
//                writer (PGHOST/PGDATABASE/PGUSER=law_ingester/PGPASSWORD);
//   the file     world.db, as before, for the readers that still open it,
//                unless --no-db. It goes when the last of them has moved.
// Nothing reads world.db to fill the store: graph-ingest --db is the manual
// path for a file that already exists.
//
// The pattern is src/hydrate.mjs's, extended from tables-per-thing to
// nodes+edges: rebuild from scratch every run, stamp the as-of shas in `meta`,
// hold the DB to being an INDEX. Everything here is recomputable from the two
// checkouts at the two shas named in `meta`, so world.db may be deleted at any
// moment without losing a fact the town owns.
//
// Three rules shape the whole file:
//
//   ANOMALIES ARE RECORDED, NEVER FIXED. Where the directory tree claims a
//   containment the geometry will not support, the edge lands with
//   geometry_ok:false. Where a timetable names a stop that is no mark, the edge
//   lands with its dst verbatim. A hydrator that quietly repaired either would
//   be deleting the findings the store exists to surface.
//
//   THE DERIVER'S GATE LAW (§5.2, decided). Every deriver refuses or discloses
//   its absent inputs. Missing world clone, unreadable marks, a git history
//   that cannot be walked: REFUSED, named, nonzero, and the previous world.db
//   is left untouched. Anything else absent is DISCLOSED — recorded in
//   meta.gates with the tables it leaves empty, printed loudly. And after the
//   build, any table a passing gate promised to fill is checked: an index that
//   silently served an empty table would be indistinguishable from an index
//   that had nothing to say.
//
//   EVERY EVENT IS JUDGED AT ITS OWN INSTANT. geometry_versions carries each
//   mark's geometry with a validity window derived from git history, so a lint
//   over historical events never re-decides history when a mark moves.

import { DatabaseSync } from "node:sqlite";
import { existsSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";

import {
  SCHEMA, EDGE_TYPES, WORLD_CLONE, OFFICE_ROOT, DEFAULT_DB,
  git, materializeWorldAtSha, geometryIndex, graphFromTables,
} from "./world-store.mjs";
import { createGraphRows, graphTablesOf, graphCounts } from "./world-graph-rows.mjs";
import { blessed } from "./world-branches.mjs";

const argOf = (name, fallback) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(name);

const WORLD = resolve(argOf("--world", WORLD_CLONE));
const OFFICE = resolve(argOf("--office", OFFICE_ROOT));
const DB_PATH = resolve(argOf("--db", DEFAULT_DB));
const REF_ARG = argOf("--ref", null);
const JSON_OUT = flag("--json");
const WRITE_DB = !flag("--no-db");
const TO_STORE = flag("--to-store");

// `--ref blessed` (postmark#2934): the newest `settlement/S<n>` tag, peeled to
// its commit — the same resolution the read tier's fold serves, so store and
// fold cannot disagree about which world this is. A clone with no settlement
// tag falls back to main and the store says so in `meta.canon_disclosed`.
// Resolved ONCE here and passed down as a sha, because `blessed` is a law that
// is deliberately not memoised and the gates below would otherwise ask twice.
let BLESSED = null;
const REF = (() => {
  if (REF_ARG !== "blessed") return REF_ARG;
  try { BLESSED = blessed(WORLD); }
  catch (e) { return "blessed"; }   // the world-git gate names the failure below
  return BLESSED.sha;
})();

// ── the gate law ─────────────────────────────────────────────────────────────

const GATES = [];
class GateRefusal extends Error { constructor(id, detail) { super(`${id}: ${detail}`); this.gate = id; this.detail = detail; } }

const gatePresent = (gate, input, detail) => { GATES.push({ gate, input, status: "PRESENT", detail }); };
const gateAbsent = (gate, input, detail, fills = []) => {
  GATES.push({ gate, input, status: "ABSENT", detail, tables_left_empty: fills });
  console.warn(`GATE ABSENT  ${gate} — ${detail}${fills.length ? ` (leaves empty: ${fills.join(", ")})` : ""}`);
};
const gateRefuse = (gate, input, detail) => { GATES.push({ gate, input, status: "REFUSED", detail }); throw new GateRefusal(gate, detail); };

// Gates that must hold BEFORE the old index is destroyed. A hydrator that
// deletes a good index and then discovers it cannot build a new one has turned
// a refusal into an outage.
const requiredGates = () => {
  if (!existsSync(join(WORLD, "WORLD", "marks")))
    gateRefuse("world-clone", WORLD, `not a world checkout — no WORLD/marks under ${WORLD}`);
  gatePresent("world-clone", WORLD, "WORLD/marks present");

  // `git -C <dir> rev-parse HEAD` happily answers from an ANCESTOR repo when
  // <dir> is not one itself, which would stamp the index with a sha that has
  // nothing to do with what it indexed. Insist the toplevel IS this directory.
  let head = null;
  try {
    const [top, resolved] = git(WORLD, ["rev-parse", "--show-toplevel", REF ?? "HEAD"]).trim().split("\n");
    if (resolve(top).toLowerCase() !== resolve(WORLD).toLowerCase())
      gateRefuse("world-git", WORLD, `not a git checkout of its own — toplevel is ${top}`);
    head = resolved;
  } catch (e) {
    if (e instanceof GateRefusal) throw e;
    gateRefuse("world-git", WORLD, `git cannot resolve ${REF ?? "HEAD"} (${String(e.message).split("\n")[0]})`);
  }
  gatePresent("world-git", WORLD, BLESSED
    ? `blessed ${BLESSED.tag ?? "(no settlement tag — main)"} = ${head.slice(0, 12)}${BLESSED.candidate_ahead ? ` · main ahead at ${BLESSED.candidate_ahead.slice(0, 12)}` : ""}`
    : `${REF ?? "HEAD"} = ${head.slice(0, 12)}`);

  // The history has to be WALKABLE, not merely present: geometry_versions is
  // derived from it, and a shallow or grafted clone would silently produce a
  // single version per mark — geometry with no tense, which is the exact
  // failure this table exists to end.
  let logLines = 0;
  try {
    logLines = git(WORLD, ["log", head, "--format=%H", "--max-count=2", "--", "WORLD/marks"]).trim().split("\n").filter(Boolean).length;
  } catch (e) {
    gateRefuse("world-history", WORLD, `git log over WORLD/marks failed (${String(e.message).split("\n")[0]})`);
  }
  if (logLines < 2) gateRefuse("world-history", WORLD, `git log over WORLD/marks returned ${logLines} commit(s) — a shallow or truncated history cannot version geometry`);
  if (existsSync(join(WORLD, ".git", "shallow"))) gateRefuse("world-history", WORLD, "the clone is SHALLOW (.git/shallow present) — geometry versions would be fabricated from a truncated past");
  gatePresent("world-history", WORLD, "WORLD/marks history walkable");

  return head;
};

// ── run ──────────────────────────────────────────────────────────────────────

const t0 = Date.now();
let worldSha;
try { worldSha = requiredGates(); }
catch (e) {
  if (!(e instanceof GateRefusal)) throw e;
  console.error(`\nGATE REFUSED ${e.gate} — ${e.detail}`);
  console.error(`world.db NOT rebuilt; any existing index at ${DB_PATH} is untouched.`);
  process.exit(1);
}

// The office's own sha, for the code half of the graph. Not a required gate:
// the world graph is still true about the world if the office is not a
// checkout, so this discloses rather than refuses.
let officeSha = null;
try {
  const [top, head] = git(OFFICE, ["rev-parse", "--show-toplevel", "HEAD"]).trim().split("\n");
  if (resolve(top).toLowerCase() === resolve(OFFICE).toLowerCase()) { officeSha = head; gatePresent("office-git", OFFICE, `HEAD = ${head.slice(0, 12)}`); }
  else gateAbsent("office-git", OFFICE, `not a git checkout of its own (toplevel ${top}) — as_of_office left null`);
} catch { gateAbsent("office-git", OFFICE, "no git sha — as_of_office left null"); }

// The tree is read AT THE SHA, never from the working directory: the world
// clone is fetch-never-pull and the write pen parks it on household draft
// branches, so the checkout and HEAD routinely disagree.
const TREE = materializeWorldAtSha(WORLD, worldSha, ["WORLD", "tools"]);
const MARKS_DIR = join(TREE, "WORLD", "marks");
const TOOLS_DIR = join(TREE, "tools");

// The world's OWN loader and the world's OWN geometry, imported live from the
// materialised tree — never vendored, never reimplemented. Same discipline
// hydrate.mjs uses for stamp-mint.mjs and quest-progress.mjs: the fold and the
// index read the tree by one set of rules or they are indexing different worlds.
let fold, geom;
try {
  fold = await import(pathToFileURL(join(TOOLS_DIR, "marks-fold.mjs")));
  geom = await import(pathToFileURL(join(TOOLS_DIR, "geometry.mjs")));
} catch (e) {
  console.error(`\nGATE REFUSED world-tools — cannot import the world's own fold at ${worldSha.slice(0, 12)} (${String(e.message).split("\n")[0]})`);
  process.exit(1);
}
gatePresent("world-tools", TOOLS_DIR, `marks-fold + geometry imported at ${worldSha.slice(0, 12)}`);

const { loadMarks, placementParent, parseRecord, worldRootOf, PARCEL_EXTENT_M, PARCEL_CLAIM_CAP, isValidMarkDate } = fold;
const { rect, contains, marksContain, isIrregular, pointInRect } = geom;

const marks = loadMarks(MARKS_DIR);
if (!marks.length) {
  GATES.push({ gate: "marks-readable", input: MARKS_DIR, status: "REFUSED", detail: "loadMarks returned 0 marks" });
  console.error(`\nGATE REFUSED marks-readable — the world's own loader returned 0 marks from ${MARKS_DIR}`);
  console.error(`world.db NOT rebuilt; any existing index at ${DB_PATH} is untouched.`);
  process.exit(1);
}
gatePresent("marks-readable", MARKS_DIR, `${marks.length} marks loaded by the world's own loadMarks`);

// ── the containment map · what contains what, after the freeze ───────────────
//
// THE LAW (founder-ruled 2026-08-25; LOGOS/state-and-time.md § "The freeze —
// filing is static, and the tree is a fossil"):
//
//   "Filing is frozen as of 2026-08-25. A mark's directory is its historical
//    filing: it carries no claim, and it never moves again."
//
//   "'The tree is the map' moves to where derived views live: the fold emits the
//    containment map beside `world-state.json` every settlement. The browsable
//    truth is generated; the source files rest."
//
// So the office may no longer ASK the directories what contains what. It reads
// the artifact the world's own fold emits — `WORLD/containment.json`, thrown
// away and rebuilt at every settlement, which is what keeps it from rotting the
// way a stored path does. Rows are `{ id, parent, chain }`; `parent: null`
// belongs to the world root alone, and `chain` is the spine outermost-LAST
// (nearest ancestor first).
//
// THE FALLBACK IS DELIBERATE AND LOUD. A clone from before the freeze carries no
// such file, and refusing to hydrate it would take the office down for an
// artifact that did not exist last week. So the absence falls back to the old
// directory derivation and SAYS SO — an ABSENT gate, a warning line, and
// `containment_source: "directory-nesting"` in the report. A silent fallback
// would be the freeze quietly not applying, which is the one failure this
// re-key exists to prevent.
const CONTAINMENT_PATH = join(TREE, "WORLD", "containment.json");
const containmentParent = new Map();   // id -> parent id, or null for the root
const containmentChain = new Map();    // id -> ancestor ids, nearest first
let containmentSource = "directory-nesting";
try {
  const cm = JSON.parse(readFileSync(CONTAINMENT_PATH, "utf8"));
  const rows = Array.isArray(cm?.marks) ? cm.marks : [];
  if (!rows.length) throw new Error("no marks[] rows");
  for (const r of rows) {
    if (!r?.id) continue;
    containmentParent.set(r.id, r.parent ?? null);
    containmentChain.set(r.id, Array.isArray(r.chain) ? r.chain : []);
  }
  containmentSource = "containment-map";
  gatePresent("containment-map", "WORLD/containment.json", `${containmentParent.size} marks, derived at the fold (the freeze, 2026-08-25)`);
} catch (e) {
  gateAbsent("containment-map", "WORLD/containment.json",
    `unreadable at this sha (${String(e.message).split("\n")[0]}) — containment falls back to directory nesting, which the freeze repealed. A clone from before 2026-08-25 has no map; a clone after it that lost one has a settlement that did not fold.`,
    []);
  console.error(`\n⚠ containment-map ABSENT at ${CONTAINMENT_PATH} — \`contains\` edges and the keeping-works gate fall back to directory nesting (pre-freeze behaviour).`);
}

// ── what the AUTHOR wrote, kept apart from what the loader supplied ──────────
//
// `loadMarks` composes: it defaults `tier` to "market", synthesizes `slug`,
// `id` and `household`, and back-fills `parent` for a nested predicate
// (marks-fold.mjs § walkMarks). By the time a record reaches the node writer
// above, "the author wrote this down" and "the loader supplied it" are the same
// string, and the questions the tier cutover is made of — how many records
// still ASSERT a standing the one walk is supposed to derive, which keys on
// disk the law places nowhere — cannot be asked of it at all.
//
// So the raw key list is read once, here, and carried on the node beside the
// composed fields. It is the KEYS ONLY: the values are already on the node
// where they belong, and a second copy of them would make the store the owner
// of two spellings of the same fact.
//
// Read through the world's OWN `parseRecord`, never a second frontmatter scan —
// the same rule the fold is imported under. A hand-rolled scanner written for
// exactly this job in the world repo dropped the last key of every CRLF file,
// which was nine records and all of them the town's constitution.
const rawKeys = (m) => {
  try {
    const rec = parseRecord(readFileSync(join(m._dir, "mark.md"), "utf8"), m.id);
    return Object.keys(rec).filter((k) => k !== "body");
  } catch {
    return null;   // a record the loader already flagged with _error; null says "not read", never "no keys"
  }
};

// ── the previous run, read before it is destroyed ────────────────────────────
// The store is rebuilt from scratch, so lint_findings holds exactly THIS run.
// The alert surface is the DELTA, and that is the invariant family's own word
// for it: every mechanic mark under
// WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-invariant/<slug>/<slug>-mechanic
// reads "the office runs this question over the rebuilt store at every
// hydration; the delta between runs is the alert surface." So the outgoing
// file's verdicts are read first and reported against the new ones. This is an
// observation about this machine's last hydration — named as such in meta,
// never town truth.
let previous = null;
if (WRITE_DB && existsSync(DB_PATH)) {
  try {
    const old = new DatabaseSync(DB_PATH, { readOnly: true });
    previous = {
      as_of_world: old.prepare("SELECT value FROM meta WHERE key='as_of_world'").get()?.value ?? null,
      hydrated_at: old.prepare("SELECT value FROM meta WHERE key='hydrated_at'").get()?.value ?? null,
      findings: old.prepare("SELECT lint, verdict, headline FROM lint_findings").all(),
    };
    old.close();
  } catch { previous = null; }   // an unreadable or older-shape file is simply no baseline
}
if (!previous && TO_STORE) {
  // No file to compare against: the store's newest snapshot is this machine's
  // previous hydration. A store that will not answer is simply no baseline.
  try {
    const { previousGraphLints } = await import("../world2/tools/graph-ingest.mjs");
    previous = await withStoreClient((client) => previousGraphLints(client));
  } catch { previous = null; }
}

// ── THE ROWS (src/world-graph-rows.mjs) ─────────────────────────────────────
// Built in memory, in the order world.db has always held them, and written to
// each output at the end. The statements keep their names and argument order,
// so the derivation below is unchanged line for line.
const T = createGraphRows();
const putMeta = { run: (key, value) => T.meta.put({ key, value }) };
const insNode = { run: (id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props) =>
  T.nodes.put({ id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props }) };
const insEdge = { run: (src, dst, type, props, born_at) => T.edges.push({ src, dst, type, props, born_at }) };
const insEvent = { run: (at, actor, type, payload) => T.events.push({ at, actor, type, payload }) };
const insType = { run: (type, note) => T.edgeTypes.put({ type, note }) };
const insGeom = { run: (mark_id, at_x, at_y, extent_w, extent_h, valid_from_iso, valid_to_iso, sha, path, subject, authored_iso, change) =>
  T.geometryVersions.push({ mark_id, at_x, at_y, extent_w, extent_h, valid_from_iso, valid_to_iso, sha, path, subject, authored_iso, change }) };

for (const [t, n] of EDGE_TYPES) insType.run(t, n);

const warn = [];
const note = (msg) => { warn.push(msg); };
const node = (id, kind, o = {}) => insNode.run(id, kind, o.subkind ?? null, o.tier ?? null, o.by ?? null,
  o.at_x ?? null, o.at_y ?? null, o.extent_w ?? null, o.extent_h ?? null, JSON.stringify(o.props ?? {}));
const edge = (src, dst, type, props = {}, born_at = null) => insEdge.run(src, dst, type, JSON.stringify(props), born_at);

// ── marks ────────────────────────────────────────────────────────────────────
const byId = new Map();
for (const m of marks) {
  if (byId.has(m.id)) note(`duplicate mark id ${m.id} (${m._dir})`);
  byId.set(m.id, m);
}

// ── the one walk (tier-B, 2026-08-13) ────────────────────────────────────────
// Standing is DERIVED, never read off the record: `tier:` is not a field, and
// the door bounces anyone who writes it — so the composed `tier` above says
// "market" for every silent record and the graph's standing colours went grey
// the day the residue was stripped. mark-standing.mjs is the ONE definition of
// the walk (its own header: "a second copy of this walk is a future drift;
// import it") — imported live from the materialised tree exactly like the
// fold. Soft: a world sha that predates the tool hydrates every mark with
// standing null, and the window says "not sent" rather than guessing.
let markStanding = null;
try { ({ markStanding } = await import(pathToFileURL(join(TOOLS_DIR, "mark-standing.mjs")))); }
catch (e) { note(`mark-standing.mjs not importable at this sha — standing not derived (${String(e.message).split("\n")[0]})`); }

// The grain the walk scopes to. The fold resolves handle → household onto each
// record as `_cred` (marks-fold.mjs § the household grain); this mirrors that
// from the tree's own WORLD/households.json so two handles of one human
// compose here exactly as they do in the fold. A missing or stale file
// degrades to the walk's own by-handle fallback, which standingHouseholdOf
// names safe by construction.
if (markStanding) {
  let hh = null;
  try { hh = JSON.parse(readFileSync(join(TREE, "WORLD", "households.json"), "utf8")).households ?? null; } catch {}
  for (const m of marks) {
    const h = m.household ?? m.by ?? null;
    if (h != null) m._cred = hh?.[h] ?? `solo:${h}`;
  }
}

const relPath = (d) => relative(TREE, d).replace(/\\/g, "/");
const GEOMETRIC = (m) => m?.kind === "sited" || m?.kind === "parcel";

// THE POSITION CLAUSE, asked of containment rather than of the path (the freeze).
//
// "Standing in the Keeping Works" (LOGOS/classes.md § Instantiation, ruled
// 2026-08-17) used to be the substring `/the-keeping-works/` in a mark's
// directory — a sound test only while the directory made a claim. Under the
// freeze it is not: a class mark filed at `WORLD/marks/<by>/<slug>/` would be
// standing in the works and silently declaring nothing, because the path test
// alone decides whether a mark may mint a VERB. Membership is now the
// containment CHAIN passing through the works.
//
// The works' own mark is NOT in the works, which matches the substring test it
// replaces: `%/the-keeping-works/%` never matched the works' own directory.
//
// Measured before it was written, over the freeze-day tree: chain-membership and
// path-membership select the SAME 330 marks, zero either way. The re-key changes
// nothing about the world as filed; it changes what happens to what is filed next.
const KEEPING_WORKS_ID = "the-town/the-keeping-works";
const standsInWorks = (m) => containmentSource === "containment-map"
  ? (containmentChain.get(m.id) ?? []).includes(KEEPING_WORKS_ID)
  : relPath(m._dir).includes("/the-keeping-works/");

const oddFrontmatter = [];
for (const m of marks) {
  const problems = [];
  if (m._error) problems.push(`unparseable frontmatter: ${m._error}`);
  if (!m.by) problems.push("no `by:`");
  if (!m.kind) problems.push("no `kind:`");
  else if (!["sited", "parcel", "predicated", "naming"].includes(m.kind)) problems.push(`unknown kind: ${m.kind}`);
  if (!m.date) problems.push("no `date:`");
  else if (!isValidMarkDate(m.date)) problems.push(`bad date: ${m.date}`);
  if (GEOMETRIC(m) && (m.at?.x == null || m.at?.y == null)) problems.push("geometric kind without `at:`");
  if (m.kind === "sited" && (m.extent?.w == null || m.extent?.h == null)) problems.push("sited without `extent:`");
  if (m.kind === "predicated" && (m.slot == null || m.value == null)) problems.push("predicated without slot/value");
  if (m.body != null && m.body.length > 150) problems.push(`body ${m.body.length} chars (schema says <=150)`);
  if (m.timetable != null && m.mechanic !== "timetable") problems.push("`timetable:` without `mechanic: timetable`");
  if (m.mechanic === "timetable" && m.timetable == null) problems.push("`mechanic: timetable` without `timetable:`");
  // `ambient:` widens a class's reach to the whole world, so the one spelling
  // that means it is the boolean. Anything else is REPORTED rather than
  // quietly honoured or quietly dropped — a class whose author believed they
  // had declared world-wide reach and has not is exactly the silent
  // disagreement `frontmatter_problems` exists to surface.
  if (m.ambient != null && m.ambient !== true && m.ambient !== "true") problems.push(`\`ambient:\` must be true to widen reach (got ${JSON.stringify(m.ambient)}) — this class reaches only where it stands`);
  // `loot:` marks a thing as what a fight is FOR, and the shroud hides it until
  // the room is spent. Same one-spelling rule as `ambient:`, and the same
  // reason: a prize whose author believed it was held back and is not is the
  // silent disagreement this list exists to surface — except here the failure
  // is visible in the world, as a cake's reward sitting in the room before
  // anyone has swung at it.
  if (m.loot != null && m.loot !== true && m.loot !== "true") problems.push(`\`loot:\` must be true to hold a thing back until the encounter is spent (got ${JSON.stringify(m.loot)}) — this thing is an ordinary thing and is visible from the start`);
  if (problems.length) oddFrontmatter.push({ id: m.id, path: relPath(m._dir), problems });

  node(m.id, "mark", {
    subkind: m.kind ?? null, tier: m.tier ?? null, by: m.by ?? null,
    at_x: m.at?.x ?? null, at_y: m.at?.y ?? null,
    extent_w: m.extent?.w ?? null, extent_h: m.extent?.h ?? null,
    props: {
      slug: m.slug, path: relPath(m._dir), date: m.date ?? null, body: m.body ?? "",
      // The position clause as DATA (the freeze — see § the position clause).
      // Stamped on every mark so the class gate can be one question asked of the
      // store, in SQL and in JS alike, instead of a substring test on a path the
      // freeze stripped of meaning. A store hydrated before this stamp existed
      // carries no key at all, and the gate falls back to the path there.
      in_works: standsInWorks(m),
      slot: m.slot ?? null, value: m.value ?? null,
      far: m.far === true || m.far === "true" || null,
      feature: m.feature ?? null, mechanic: m.mechanic ?? null, timetable: m.timetable ?? null,
      points: Array.isArray(m.points) ? m.points.length : null,
      pre: m.pre ?? null, derived_from: m.derived_from ?? null,
      // The one walk's verdict (§ the one walk, above), derived at hydration
      // and carried as data. The page's standing colours read THIS — never the
      // composed `tier`, which the loader defaults for every silent record.
      standing: markStanding ? markStanding(m, byId) : null,
      parent_dir_mark: m._parentMarkId ?? null, explicit_parent: m._explicitParent ?? null,
      // THE CLASS FIELDS (Stage 2). A class is a mark, so the nine class marks
      // arrive here like any other record — but the hydrator used to drop
      // exactly the fields that make them law, so `dials:` reached no reader and
      // the running office kept its own copy of every constant. Carrying them
      // is what turns "the class mark and the code both hold the number" into
      // "the class mark holds the number and the code edges to it".
      // `implements:`/`affordances:` ride along because they are the same
      // record's other promises and a class read that had to open the repo for
      // them would not be a store read at all.
      class: m.class ?? null,
      // THE DECLARATION FACT (step-1 promotion, 2026-08-18): a class-carrying
      // mark standing in the Keeping Works DECLARES its class; anywhere else
      // it is an INSTANCE (LOGOS/classes.md § Instantiation; the store's
      // WORKS_PATH gates read the same clause). Derived here once so every
      // reader downstream — the lints, the payload, the site lens — reads the
      // fact instead of re-deriving it. Emitted only when true.
      declares: (m.class !== undefined && standsInWorks(m)) || undefined,
      class_version: Number.isFinite(Number(m.version)) ? Number(m.version) : null,
      extends: m.extends ?? null,
      dials: (m.dials && typeof m.dials === "object" && !Array.isArray(m.dials)) ? m.dials : null,
      implements: Array.isArray(m.implements) ? m.implements : null,
      // `actions:` is the key (renamed from `affordances:` 2026-08-15 — the
      // category collapsed: everything a class grants IS an action); the old
      // key still rides so a pre-rename mark keeps its doors.
      actions: Array.isArray(m.actions) ? m.actions : null,
      affordances: Array.isArray(m.affordances) ? m.affordances : null,
      mobility: m.mobility ?? null,
      anchor: m.anchor ?? null,
      // `requires:` — a GUARD IN GATE POSITION on a class (2026-08-26).
      // LOGOS/classes.md § The derived: "a verb or slot may name a derived and
      // a required value as its precondition — that is the whole condition
      // grammar." Carried for the same reason `dials:` is: the apex asks the
      // store whether an act's precondition holds, and a precondition the store
      // cannot see is a precondition the door invents or ignores.
      requires: (m.requires && typeof m.requires === "object" && !Array.isArray(m.requires)) ? m.requires : null,
      // `held_grant:` — an INSTANCE filling the thing class's unsealed
      // `held-grant` slot. The field/slot name pair follows the `entry` /
      // `entry-law` precedent already on the record: the slot names the law,
      // the frontmatter field is what an instance writes. Custody is checked at
      // the read (`by: the-town`), never here — the hydrator carries what the
      // record says and the gate decides what it means.
      held_grant: Array.isArray(m.held_grant) ? m.held_grant : null,
      exempt: Array.isArray(m.exempt) ? m.exempt : null,
      // `ambient:` is class-declared REACH (2026-08-09): the class's affordances
      // gather everywhere rather than only where the mark stands — jurisdiction
      // travels the law, not the address.
      //
      // TWO SPELLINGS, AND ONLY TWO. The world's own frontmatter parser
      // (marks-fold.mjs `parseRecord`) coerces objects, arrays and numbers but
      // has NO boolean case, so `ambient: true` in a mark file arrives here as
      // the STRING "true". Both shapes are live in the town today for exactly
      // this reason — `pre` is stored as text, `far` as a real boolean, because
      // they reach the store by different pipelines.
      //
      // So the boundary normalizes, and normalizing is all it does: `true` and
      // `"true"` become the boolean, and EVERYTHING else becomes null. Not
      // truthiness — `ambient: 1`, `ambient: "yes"` and `ambient: "TRUE"` all
      // widen nothing, and the check below reports them rather than letting an
      // author believe they declared world-wide reach when they did not.
      //
      // Downstream of here the field is a real boolean and the store's gate
      // (`AMBIENT_REACH_SQL`, `json_type = 'true'`) is strict about it. The
      // accommodation lives at the one place that meets the parser.
      ambient: (m.ambient === true || m.ambient === "true") ? true : null,
      // `loot:` — an INSTANCE saying it is what a fight is for (2026-08-29).
      // LOGOS/classes.md § The portal ground: "A thing whose mark declares
      // `loot` is NEITHER VISIBLE NOR TAKEABLE while the encounter on its ground
      // is afoot ... At `spent` it appears."
      //
      // ⚑ THE FLAG DIED HERE, BETWEEN THE FILE AND THE STORE, and it is worth
      // naming rather than quietly adding. This props block is an EXPLICIT field
      // list, so a frontmatter key nobody adds to it reaches no reader at all —
      // and `loot` was never added. the-wick-end and a-slice-to-take-home have
      // carried `loot: true` in their mark.md since they were written; after a
      // fresh hydrate their store rows read `props.loot = NULL`, so `looseIn`
      // saw no loot anywhere and the shroud hid nothing. Found on the box, not
      // by the suite: every falsifier for the shroud writes props DIRECTLY, so
      // the pipe the flag actually travels was the one thing none of them
      // crossed. Exactly the defect `dials:` had here before it (see § THE CLASS
      // FIELDS above) — the second instance of one class in one file.
      //
      // Normalized on the `ambient:` precedent immediately above, for its exact
      // reason: the world's frontmatter parser has no boolean case, so a file's
      // `loot: true` arrives as the STRING "true", and the string is the live
      // shape on the dev stage today. `true` and `"true"` become the boolean,
      // everything else becomes null and is REPORTED.
      loot: (m.loot === true || m.loot === "true") ? true : null,
      frontmatter_problems: problems.length ? problems : null,
      keys: rawKeys(m),               // see § what the AUTHOR wrote, above
    },
  });
}

// ── containment: the fold's map, then geometry's verdict ─────────────────────
//
// TWO KINDS OF EDGE, and after the freeze they come from two different places.
//
//   `contains` — GROUND. "A mark's directory is its historical filing: it
//     carries no claim" (the freeze, 2026-08-25), so this edge can no longer be
//     read off directory nesting. It comes from `WORLD/containment.json`, the
//     artifact the world's own fold emits every settlement, whose sited/parcel
//     rows are `placementParent` over the ground — the same function the write
//     door places by.
//
//   `describes` — PREDICATION, and the freeze does not touch it. A predicated or
//     naming mark is its parent CONTINUED (SCHEMA.md's continuation law): it has
//     no footprint to be contained by anything and takes its subject from the
//     mark it is nested inside. That nesting is AUTHORSHIP, not a claim about
//     ground, so it stays directory-derived. (The world's mark-lint gate B draws
//     the same line and flags it at §6 as the gate's reading of a sentence the
//     law states without the qualification.)
const geomAncestor = (m) => {
  let p = m._parentMarkId ? byId.get(m._parentMarkId) : null;
  while (p && !(GEOMETRIC(p) && p.at)) p = p._parentMarkId ? byId.get(p._parentMarkId) : null;
  return p ?? null;
};

// The root, from the map when there is one. A tree-derived root is "the mark
// with no mark.md above it", and after the freeze that is TRUE OF EVERY MARK
// FILED AT ITS ID — `WORLD/marks/<by>/<slug>/` has no parent directory record —
// so the old derivation starts reporting a dozen roots the day the first
// id-filed mark lands. The map says it in one row: `parent: null` belongs to the
// world root alone.
// NAMED, NEVER INFERRED. The world root has a name — the fold exports
// `worldRootOf`, which finds it by slug — and that answer holds whether or not
// the containment map is present. "The mark with no mark.md above it" is kept
// only as the last resort for a tree whose fold is too old to export the
// finder, and it is the derivation that breaks: after the freeze it is true of
// every mark filed at its id, so alphabetical order could crown a RESIDENT'S
// mark as the world root — and ROOT_ID is the placement fallback below.
const namedRoot = typeof worldRootOf === "function" ? (worldRootOf(marks)?.id ?? null) : null;
const mapRoots = [...containmentParent.entries()].filter(([, p]) => p == null).map(([id]) => id);
const treeRoots = marks.filter((m) => !m._parentMarkId).map((m) => m.id);
const roots = namedRoot ? [namedRoot]
  : containmentSource === "containment-map" ? mapRoots : treeRoots;
if (roots.length !== 1) note(`expected one root mark, found ${roots.length}: ${roots.join(", ")} (containment source: ${containmentSource})`);
const ROOT_ID = roots[0] ?? null;

/** The mark that contains `m`, asked of the map, or of the tree on the fallback. */
const containerOf = (m) => containmentSource === "containment-map"
  ? (containmentParent.get(m.id) ?? null)
  : (m._parentMarkId ?? null);

const geometryDisagreements = [];
const placementDisagreements = [];
const sitedUnderPredicate = [];
const markNotInMap = [];
let containsEdges = 0, describesEdges = 0;
for (const m of marks) {
  const born = typeof m.date === "string" ? m.date : null;

  // ── predication: unchanged, and still the directory's to say ───────────────
  if (!GEOMETRIC(m)) {
    const parentId = m._parentMarkId;
    if (!parentId) continue;
    edge(parentId, m.id, "describes", { direction: "parent-is-described-by-child", child_kind: m.kind ?? null, nesting: "directory" }, born);
    describesEdges++;
    continue;
  }

  // ── containment: the map's answer ─────────────────────────────────────────
  //
  // A mark the map has never heard of is the one way this could lose an edge in
  // silence: the map is emitted at the fold, so a record committed to main
  // without one has a directory and no containment answer, and dropping it here
  // would take it off every spine with nothing to read. It is COUNTED, not
  // guessed at — a fabricated parent is worse than a disclosed hole.
  if (containmentSource === "containment-map" && !containmentParent.has(m.id)) {
    markNotInMap.push({ id: m.id, path: relPath(m._dir) });
    continue;
  }
  const parentId = containerOf(m);
  if (!parentId) continue;                       // the world root contains nothing above it
  const parent = byId.get(parentId) ?? null;

  const props = { nesting: containmentSource === "containment-map" ? "containment-map" : "directory", child_kind: m.kind };

  // A geometric mark whose FILING sits under a predicate. Read off the tree on
  // purpose even when the map is the source: it is an observation about the
  // fossil, and the fossil is the only thing that can still say it.
  const filedUnder = m._parentMarkId ? byId.get(m._parentMarkId) : null;
  if (filedUnder && !GEOMETRIC(filedUnder)) {
    props.parent_kind = filedUnder.kind ?? null;
    sitedUnderPredicate.push({ child: m.id, parent: m._parentMarkId, parent_kind: filedUnder.kind, path: relPath(m._dir) });
  }

  // Under the map the container IS a positioned sited/parcel mark by
  // construction (`placementParent` returns nothing else), so `geometry_via`
  // never fires and `geometry_ok`/`placement_ok` are true wherever they are
  // computable. They are computed anyway, and cheaply: they stop being a
  // reconciliation of a stored path against the ground — the freeze made that
  // question meaningless — and become a MACHINERY CHECK of the world's emitted
  // map against the office's own recompute of the same geometry. A `false` here
  // used to be a filing defect; it is now a finding about the fold.
  const g = containmentSource === "containment-map" ? (GEOMETRIC(parent) && parent?.at ? parent : null) : geomAncestor(m);
  if (g && g.id !== parentId) props.geometry_via = g.id;

  if (m.far === true || m.far === "true") {
    props.geometry_ok = null; props.exempt = "far";
  } else if (!m.at || !g) {
    props.geometry_ok = null; props.exempt = g ? "no-geometry" : "no-geometric-ancestor";
  } else {
    props.geometry_ok = contains(rect(g), rect(m));
    if (isIrregular(g) || isIrregular(m)) props.geometry_ok_coverage = marksContain(g, m);
    if (props.geometry_ok === false) {
      geometryDisagreements.push({ child: m.id, parent: parentId, checked_against: g.id, path: relPath(m._dir),
        child_rect: rect(m), parent_rect: rect(g), coverage_ok: props.geometry_ok_coverage ?? null });
    }
    // `contains` asks whether the named parent CAN hold the child. placementParent
    // — the repo's own placer, the function the write path calls to choose a
    // directory — asks the stronger question: is it the SMALLEST such mark?
    const placed = placementParent(m, marks.filter((x) => x.id !== m.id)) ?? ROOT_ID;
    props.placement_ok = placed === parentId;
    if (!props.placement_ok) {
      props.placement_parent = placed;
      placementDisagreements.push({ child: m.id, tree_parent: parentId, placement_parent: placed, path: relPath(m._dir) });
    }
  }
  edge(parentId, m.id, "contains", props, born);
  containsEdges++;
}

// ── geometry_versions: the tense law, derived from git ───────────────────────
//
// Follow semantics for every mark at once. `git log --follow` is a per-path
// walk; 578 of them is 578 spawns and a minute of Windows process startup, so
// this does the same job with ONE whole-history pass over WORLD/marks with
// rename detection (-M) and an alias map walked newest-to-oldest: when a commit
// renames a->b, every OLDER commit refers to the file as `a`.
//
// Content comes from the blobs, parsed with the world's OWN parseRecord, so a
// historical geometry is read exactly as the fold would have read it that day.
// A version row is emitted at a mark's birth and at every commit where at/extent
// actually changed — a commit that edited only prose creates no version.
//
// THE FRAME IS PART OF "AS THE FOLD WOULD HAVE READ IT" (SCHEMA v3, 2026-08-09).
// `loadMarks` composes a relative tree for us, which is why the nodes table
// needed no change at all when coordinates went relative. This walk does not go
// through `loadMarks`: it reads old blobs with `parseRecord`, which hands back
// the record exactly as it is SPELLED — and on a relative tree that spelling is
// an offset from the parent's centre. Uncomposed, a hearth room's version row
// would state its position as (-2, -1) and then correctly report that it
// disagrees with the tree.
//
// So the composition happens here too, per commit, against the ancestor chain AS
// IT STOOD AT THAT COMMIT — the tense law applied to the frame itself. The
// migration commit is the instant the numbers changed meaning; a version row on
// either side of it must be read in its own commit's frame, or the migration
// reads as 282 marks teleporting.
//
// The arithmetic is the world's OWN, imported from the fold at this sha and
// never reimplemented: plain `+` on doubles invents digits no record holds, and
// the rows would then disagree with the tree in the sixteenth decimal place. A
// fold that does not export `fileToWorld` cannot be reading a relative tree —
// that is the v2 spelling, which needs no composition — so its absence is the
// feature test, not a version string to keep in step by hand.
const composesFrames = typeof fold.fileToWorld === "function" && typeof fold.COORDS_FIELD === "string";
const geometryVersions = [];
const geometryAnomalies = [];   // things that would make the table WRONG
const identityDrift = [];       // things that make it INTERESTING: the id this mark wore then
{
  const currentPath = new Map();     // repo-relative mark.md path -> current mark id
  for (const m of marks) currentPath.set(`${relPath(m._dir)}/mark.md`, m.id);

  const alias = new Map(currentPath);          // path AS OF the commit being read -> current mark id
  const touches = new Map();                   // mark id -> [{sha, at, authored, subject, path}] newest first
  const log = git(WORLD, ["-c", "core.quotepath=false", "log", worldSha,
    "--format=~%H%x1f%cI%x1f%aI%x1f%s", "--name-status", "-M", "--diff-filter=AMR", "--", "WORLD/marks"]);

  let c = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("~")) {
      const [sha, cISO, aISO, subject] = line.slice(1).split("\x1f");
      c = { sha, at: new Date(cISO).toISOString(), authored: new Date(aISO).toISOString(), subject: subject ?? "" };
      continue;
    }
    if (!c || !/^[A-Z]/.test(line)) continue;
    const cols = line.split("\t");
    const op = cols[0][0];
    const from = cols[1], to = cols[2];
    const path = op === "R" ? to : from;
    const id = alias.get(path);
    if (id) {
      if (!touches.has(id)) touches.set(id, []);
      touches.get(id).push({ ...c, path });
      // A rename means the file lived at `from` in every older commit; an add
      // means this incarnation begins here and older commits at this path are a
      // different file's life, so the alias retires.
      if (op === "R") { alias.delete(path); alias.set(from, id); }
      else if (op === "A") alias.delete(path);
    }
  }

  // A mark's ancestors at a commit are the directory prefixes of its own path at
  // that commit — top-down, so composition can accumulate. No alias map is
  // needed here and using one would be wrong: the frame a record was written
  // against is the tree AS IT STOOD, and a rename that happened later has not
  // happened yet from this commit's point of view.
  const ancestorPathsOf = (path) => {
    const parts = path.split("/");            // WORLD/marks/<a>/<b>/…/mark.md
    const out = [];
    for (let n = 3; n < parts.length - 1; n++) out.push(`${parts.slice(0, n).join("/")}/mark.md`);
    return out;
  };

  // Every blob in one cat-file batch, same reason as the materialiser's. Specs
  // are DEDUPED and read into a spec-keyed map rather than matched positionally:
  // the ancestor chains overlap heavily (every mark under the root asks for the
  // root's blob at its own commit), and one shared parent asked for twice would
  // otherwise desynchronise the whole positional walk.
  const specs = new Set();
  const blobOwner = new Map();                // spec -> the mark id that wanted it, for anomaly attribution
  for (const [id, list] of touches) for (const t of list) {
    const spec = `${t.sha}:${t.path}`;
    specs.add(spec);
    if (!blobOwner.has(spec)) blobOwner.set(spec, id);
    if (composesFrames) for (const a of ancestorPathsOf(t.path)) specs.add(`${t.sha}:${a}`);
  }
  const blobs = new Map();
  if (specs.size) {
    const ordered = [...specs];
    const outBuf = git(WORLD, ["cat-file", "--batch"], { encoding: "buffer", input: ordered.join("\n") + "\n" });
    let off = 0;
    for (const spec of ordered) {
      const nl = outBuf.indexOf(0x0a, off);
      if (nl < 0) { note(`cat-file stream ended early at ${spec}`); break; }
      const header = outBuf.subarray(off, nl).toString("utf8");
      // A missing ANCESTOR blob is ordinary — an intermediate directory need not
      // hold a mark — so only a missing blob somebody's version row depends on
      // is an anomaly.
      if (/missing$/.test(header.trim())) {
        off = nl + 1;
        if (blobOwner.has(spec)) geometryAnomalies.push({ mark: blobOwner.get(spec), spec, problem: "blob missing" });
        continue;
      }
      const size = Number(header.split(" ")[2]);
      if (!Number.isFinite(size)) { note(`cat-file header unparseable: ${header}`); break; }
      blobs.set(spec, outBuf.subarray(nl + 1, nl + 1 + size).toString("utf8"));
      off = nl + 1 + size + 1;
    }
  }

  // The record at a spec, parsed once. Ancestor chains overlap, so without this
  // the root's blob is re-parsed several hundred times.
  const recCache = new Map();
  const recAt = (spec) => {
    if (recCache.has(spec)) return recCache.get(spec);
    const text = blobs.get(spec);
    let rec = null;
    if (text != null) { try { rec = parseRecord(text, spec); } catch { rec = null; } }
    recCache.set(spec, rec);
    return rec;
  };

  const isPointAt = (r) => r?.at && Number.isFinite(r.at.x) && Number.isFinite(r.at.y);

  // The world centre a record at `path` was written against, at commit `sha`,
  // and whether its tree declared the relative frame. This mirrors the loader's
  // own walk exactly: the declaration is inherited from wherever it appears
  // (the root, by law), a mark with no `at:` passes the frame through unchanged
  // — a predicated mark has no centre — and the frame a mark hands its children
  // is its own COMPOSED centre, not its file spelling.
  const frameFor = (sha, path) => {
    let origin = { ...fold.WORLD_ORIGIN };
    let relative = false;
    for (const a of ancestorPathsOf(path)) {
      const rec = recAt(`${sha}:${a}`);
      if (!rec) continue;
      if (rec[fold.COORDS_FIELD] !== undefined) relative = String(rec[fold.COORDS_FIELD]).trim() === fold.COORDS_RELATIVE;
      if (isPointAt(rec)) origin = relative ? fold.fileToWorld(rec.at, origin) : { x: rec.at.x, y: rec.at.y };
    }
    return { origin, relative };
  };

  // A historical record's WORLD position: composed where its own commit's tree
  // said the numbers were offsets, taken as written where it did not. The root
  // declares for itself as well as for everything beneath it, which is why the
  // record's own `coords:` is consulted after the chain.
  const worldShapeOf = (rec, t) => {
    if (!composesFrames || !isPointAt(rec)) return rec;
    const { origin, relative: inherited } = frameFor(t.sha, t.path);
    const relative = rec[fold.COORDS_FIELD] !== undefined
      ? String(rec[fold.COORDS_FIELD]).trim() === fold.COORDS_RELATIVE
      : inherited;
    return relative ? { ...rec, at: fold.fileToWorld(rec.at, origin) } : rec;
  };

  const shape = (r) => ({
    at_x: r?.at?.x ?? null, at_y: r?.at?.y ?? null,
    extent_w: r?.extent?.w ?? null, extent_h: r?.extent?.h ?? null,
  });
  const changed = (a, b) => a.at_x !== b.at_x || a.at_y !== b.at_y || a.extent_w !== b.extent_w || a.extent_h !== b.extent_h;
  const describe = (a, b) => {
    const moved = a.at_x !== b.at_x || a.at_y !== b.at_y;
    const resized = a.extent_w !== b.extent_w || a.extent_h !== b.extent_h;
    return moved && resized ? "moved+resized" : moved ? "moved" : "resized";
  };

  for (const [id, list] of touches) {
    const oldestFirst = [...list].reverse();
    const versions = [];
    for (const t of oldestFirst) {
      const text = blobs.get(`${t.sha}:${t.path}`);
      if (text == null) continue;
      let rec = null;
      try { rec = parseRecord(text, t.path); }
      catch (e) { geometryAnomalies.push({ mark: id, sha: t.sha, path: t.path, problem: `unparseable at that commit: ${e.message}` }); continue; }
      const s = shape(worldShapeOf(rec, t));
      if (s.at_x == null && s.at_y == null) continue;           // never had geometry at this commit
      const prev = versions[versions.length - 1];
      if (prev && !changed(prev.shape, s)) continue;             // prose-only edit: no new version
      versions.push({ shape: s, t, change: prev ? describe(prev.shape, s) : "birth", by: rec.by ?? null });
      // A mark's identity is `by` + leaf slug, so a change of either is a change
      // of id. The row still belongs to the id we are tracking and the
      // divergence is recorded rather than silently re-keyed — but it is drift,
      // not damage, and it is kept out of the anomaly count so a real problem
      // (an unparseable blob, a version that disagrees with the tree) cannot
      // hide inside it. Most of it is one migration: `by:` moved from the path
      // into the frontmatter, so every mark predating that reads as `?/slug`
      // under today's rules.
      const slug = t.path.split("/").slice(-2)[0];
      const idThen = rec.by != null ? `${rec.by}/${slug}` : `?/${slug}`;
      if (idThen !== id) identityDrift.push({ mark: id, sha: t.sha, id_then: idThen, reason: rec.by == null ? "no `by:` in the record at that commit (authorship was still the path)" : "renamed" });
    }
    versions.forEach((v, i) => {
      geometryVersions.push({
        mark_id: id, ...v.shape,
        valid_from_iso: v.t.at, valid_to_iso: versions[i + 1]?.t.at ?? null,
        sha: v.t.sha, path: v.t.path, subject: v.t.subject, authored_iso: v.t.authored, change: v.change,
      });
    });
  }
  for (const g of geometryVersions) insGeom.run(g.mark_id, g.at_x, g.at_y, g.extent_w, g.extent_h,
    g.valid_from_iso, g.valid_to_iso, g.sha, g.path, g.subject, g.authored_iso, g.change);

  // The store's own claim, checked against itself: the version standing at
  // as_of must equal the geometry the fold just read off the tree. If those
  // disagree, either the history walk or the tree read is lying.
  const idx = geometryIndex(geometryVersions);
  for (const m of marks) {
    if (!GEOMETRIC(m) || m.at?.x == null) continue;
    const current = (idx.get(m.id) ?? []).find((v) => v.valid_to_iso == null);
    if (!current) { geometryAnomalies.push({ mark: m.id, problem: "no open geometry version at as_of" }); continue; }
    if (current.at_x !== m.at.x || current.at_y !== m.at.y
      || (current.extent_w ?? null) !== (m.extent?.w ?? null) || (current.extent_h ?? null) !== (m.extent?.h ?? null)) {
      geometryAnomalies.push({ mark: m.id, problem: "open version disagrees with the tree at as_of",
        version: [current.at_x, current.at_y, current.extent_w, current.extent_h],
        tree: [m.at.x, m.at.y, m.extent?.w ?? null, m.extent?.h ?? null] });
    }
  }
}
gatePresent("geometry-history", "WORLD/marks", `${geometryVersions.length} versions over ${new Set(geometryVersions.map((g) => g.mark_id)).size} marks`);

// ── classes (embryonic) ──────────────────────────────────────────────────────
// Two honest class sources exist in the repo today: skeleton.json's physics
// registry, and the parcel (class-owned by law, but with no mark of its own —
// so the class node is synthesized and flagged as such).
let physics = {};
const skeletonPath = join(TREE, "WORLD", "skeleton.json");
try {
  physics = JSON.parse(readFileSync(skeletonPath, "utf8")).physics_registry ?? {};
  gatePresent("physics-registry", "WORLD/skeleton.json", `${Object.keys(physics).length} mechanics`);
} catch (e) {
  gateAbsent("physics-registry", "WORLD/skeleton.json", `unreadable (${e.message.split("\n")[0]}) — every implements edge will dangle`, ["nodes(kind=class,subkind=mechanic)"]);
}

for (const [id, r] of Object.entries(physics)) {
  node(`mechanic:${id}`, "class", {
    subkind: "mechanic", by: "the-town",
    props: { mechanic: id, honored: r.honored === true, receipt: r.receipt ?? null, source: "WORLD/skeleton.json#physics_registry" },
  });
}

// THE PARCEL-CLASS CUTOVER (step-1 promotion, 2026-08-18). The synthesized
// `the-town/parcel-class` node retired exactly as its own note promised —
// "if the class ever earns a constitution mark of its own, this node is what
// it replaces" — the works' `the-town/parcel` mark stands, so kind:parcel
// instances point at the real declaration now. The extent dial itself still
// lives in code (PARCEL_EXTENT_M) until the params explosion seats it on the
// mark; L4 says so in its limits.
const PARCEL_CLASS = "the-town/parcel";

// THE INSTANCE-OF RAILS (Stratum A made real; the edge is SoT for class
// membership, R6). A class-carrying mark that does not DECLARE (see the
// `declares:` fact stamped at node creation) is an INSTANCE and edges to its
// class's declaration. A class value with no declaration dangles VISIBLY at
// `class:<value>` — the dangle is the finding, never dropped.
const declOfClass = new Map();
for (const m of marks)
  // Position by containment, not by path — the same clause `declares:` is
  // stamped from (§ the position clause). A declaration filed at its id after
  // the freeze must still be the one this rail points every instance at.
  if (m.class !== undefined && standsInWorks(m) && !declOfClass.has(String(m.class)))
    declOfClass.set(String(m.class), m.id);

const danglingMechanics = [];
let instanceOf = 0, implementsEdges = 0;
for (const m of marks) {
  if (m.kind === "parcel") { edge(m.id, PARCEL_CLASS, "instance-of", { via: "kind: parcel" }, typeof m.date === "string" ? m.date : null); instanceOf++; }
  if (m.class !== undefined && declOfClass.get(String(m.class)) !== m.id) {
    const decl = declOfClass.get(String(m.class)) ?? `class:${m.class}`;
    edge(m.id, decl, "instance-of", { via: "class:", declared: declOfClass.has(String(m.class)) }, typeof m.date === "string" ? m.date : null);
    instanceOf++;
  }
  if (m.mechanic) {
    const dst = `mechanic:${m.mechanic}`;
    const resolves = Object.hasOwn(physics, m.mechanic);
    if (!resolves) danglingMechanics.push({ mark: m.id, mechanic: m.mechanic, path: relPath(m._dir) });
    edge(m.id, dst, "implements", { via: "mechanic:", dst_resolves: resolves, honored: physics[m.mechanic]?.honored ?? null },
      typeof m.date === "string" ? m.date : null);
    implementsEdges++;
  }
}

// ── doctrine: ENGINE.md's sections ───────────────────────────────────────────
// Doctrine has to be addressable before anything can ask whether it is obeyed:
// the-consulted-doctrine (the L5 invariant) says "Every doctrine rule reaches an
// enforcing surface — a rule living only in prose no machine reads is a wish",
// and a rule with no stable id is prose no machine can point at. ENGINE.md has
// no rule-ids (a finding in itself, and L5's coarsest-honest-unit limit), so the
// honest v0 is one node per `##` heading, and a `describes` edge only where the
// heading text literally names a registered mechanic. Nothing is inferred from
// prose.
const enginePath = join(TREE, "WORLD", "ENGINE.md");
let doctrineNodes = 0, doctrineEdges = 0;
if (existsSync(enginePath)) {
  const lines = readFileSync(enginePath, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const h = /^##\s+(.*)$/.exec(line);
    if (!h) return;
    const heading = h[1].trim();
    const slug = heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const id = `engine/${slug}`;
    node(id, "doctrine", { subkind: "section", by: "the-town", props: { heading, file: "WORLD/ENGINE.md", line: i + 1, has_rule_id: false } });
    doctrineNodes++;
    for (const mech of Object.keys(physics)) {
      if (new RegExp(`\\b${mech}\\b`, "i").test(heading)) { edge(id, `mechanic:${mech}`, "describes", { via: "heading names the mechanic" }); doctrineEdges++; }
    }
  });
  gatePresent("engine-doctrine", "WORLD/ENGINE.md", `${doctrineNodes} sections`);
} else gateAbsent("engine-doctrine", "WORLD/ENGINE.md", "absent at this sha", ["nodes(kind=doctrine)"]);

// ── timetable: stop-of ───────────────────────────────────────────────────────
// Coordinates are never copied into a schedule (SCHEMA.md), so a stop is a mark
// id and nothing else. An id that resolves to no mark stays verbatim in the
// edge: the dangling stop IS the finding.
const danglingStops = [];
let stopEdges = 0, services = 0;
for (const m of marks) {
  const tt = m.timetable;
  if (!tt || typeof tt !== "object" || !Array.isArray(tt.stops)) continue;
  services++;
  const born = typeof m.date === "string" ? m.date : null;
  const vessel = tt.vessel ?? null;
  if (vessel && !byId.has(vessel)) danglingStops.push({ kind: "vessel", id: vessel, declared_by: m.id });
  tt.stops.forEach((s, i) => {
    const stopId = s?.mark ?? null;
    if (stopId == null) { note(`timetable on ${m.id}: stop ${i} has no mark id`); return; }
    const srcResolves = byId.has(stopId);
    if (!srcResolves) danglingStops.push({ kind: "stop", id: stopId, declared_by: m.id, order: i });
    edge(stopId, vessel, "stop-of", {
      order: i, departs: s.departs ?? null, pace_km_per_crossing: tt.pace ?? null,
      declared_by: m.id, src_resolves: srcResolves, dst_resolves: vessel ? byId.has(vessel) : false,
      stop_at: srcResolves ? { x: byId.get(stopId).at?.x ?? null, y: byId.get(stopId).at?.y ?? null } : null,
    }, born);
    stopEdges++;
  });
}

// ── walk ledger -> events ────────────────────────────────────────────────────
// Grammar (WORLD/walk-ledger.md's own header):
//   - <iso> · <handle> · from <x>,<y> · toward <x>,<y> · at <crossing>
//     [· within <w>,<h>] [· to <mark-id>] [· pace <n>]
// Parsed field-wise rather than by one regex, so a line carrying a field the
// header never documented still lands (under payload.extra) instead of being
// thrown away as unparseable.
const ledgerPath = join(TREE, "WORLD", "walk-ledger.md");
const badLedgerLines = [];
let departures = 0;
const pair = (s, ka = "x", kb = "y") => {
  const [a, b] = String(s).split(",").map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? { [ka]: a, [kb]: b } : null;
};
if (existsSync(ledgerPath)) {
  readFileSync(ledgerPath, "utf8").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line.startsWith("- ")) return;
    const parts = line.slice(2).split("·").map((s) => s.trim());
    const [iso, handle, ...rest] = parts;
    const f = {}; const extra = [];
    for (const seg of rest) {
      const kv = /^(from|toward|at|within|to|pace)\s+(.*)$/.exec(seg);
      if (kv) f[kv[1]] = kv[2].trim(); else if (seg) extra.push(seg);
    }
    const from = pair(f.from), toward = pair(f.toward), crossing = Number(f.at);
    const isoOk = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(iso ?? "");
    if (!isoOk || !handle || !from || !toward || !Number.isFinite(crossing)) { badLedgerLines.push({ line_no: i + 1, text: line.slice(0, 160) }); return; }
    insEvent.run(iso, handle, "departure", JSON.stringify({
      from, toward, crossing,
      within: f.within ? pair(f.within, "w", "h") : null,   // the target's FROZEN arrival rect, not a point
      to: f.to ?? null, pace: f.pace != null ? Number(f.pace) : null,
      line_no: i + 1, extra: extra.length ? extra : undefined,
    }));
    departures++;
  });
  gatePresent("walk-ledger", "WORLD/walk-ledger.md", `${departures} departures (${badLedgerLines.length} lines unparseable)`);
} else gateAbsent("walk-ledger", "WORLD/walk-ledger.md", "absent at this sha", ["events"]);

// ── code graph ───────────────────────────────────────────────────────────────
// Modules from two roots: the office's src/ and the world's tools/ AT THE SHA.
// Ids carry the root so a name collision across repos can never merge two files.
const CODE_ROOTS = [
  { key: "office", dir: join(OFFICE, "src"), prefix: "office/src" },
  { key: "world", dir: TOOLS_DIR, prefix: "world/tools" },
];
const codeFiles = [];
for (const r of CODE_ROOTS) {
  if (!existsSync(r.dir)) { gateAbsent(`code-root-${r.key}`, r.dir, "missing — its modules and edges are absent from the graph", ["nodes(kind=code)", "edges(imports/reads)"]); continue; }
  for (const f of readdirSync(r.dir)) {
    if (!f.endsWith(".mjs")) continue;
    const abs = join(r.dir, f);
    codeFiles.push({ id: `code:${r.prefix}/${f}`, abs, rel: `${r.prefix}/${f}`, root: r.key, file: f, text: readFileSync(abs, "utf8") });
  }
  gatePresent(`code-root-${r.key}`, r.dir, `${codeFiles.filter((c) => c.root === r.key).length} modules`);
}
const codeById = new Map(codeFiles.map((c) => [c.id, c]));
const worldToolNames = new Set(codeFiles.filter((c) => c.root === "world").map((c) => c.file));

for (const c of codeFiles) {
  node(c.id, "code", {
    subkind: c.file.endsWith(".test.mjs") ? "test" : "module",
    props: { root: c.root, path: c.rel, file: c.file, bytes: c.text.length, lines: c.text.split("\n").length },
  });
}

// Static imports. `[^;]*?` bounds the match to one statement, so a multi-line
// `import { a, b } from "x"` is caught while the scan can never run past the
// semicolon into the next one. Re-exports are the same dependency wearing a
// different word, tagged in props.
const IMPORT_RES = [
  [/(?:^|\n)\s*import\b[^;]*?\bfrom\s*(['"])([^'"]+)\1/g, 2, "import"],
  [/(?:^|\n)\s*import\s*(['"])([^'"]+)\1/g, 2, "side-effect import"],
  [/(?:^|\n)\s*export\b[^;]*?\bfrom\s*(['"])([^'"]+)\1/g, 2, "re-export"],
];
const resolveRel = (from, spec) => {
  const parts = `${dirname(from.rel)}/${spec}`.split("/");
  const outParts = [];
  for (const p of parts) { if (p === "." || p === "") continue; if (p === "..") outParts.pop(); else outParts.push(p); }
  return `code:${outParts.join("/")}`;
};

let importEdges = 0, builtinImports = 0, bareImports = 0;
const outOfScanImports = [];
for (const c of codeFiles) {
  const seen = new Set();
  for (const [re, group, via] of IMPORT_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(c.text))) {
      const spec = m[group];
      if (spec.startsWith("node:")) { builtinImports++; continue; }
      if (!spec.startsWith(".")) { bareImports++; continue; }
      const dst = resolveRel(c, spec);
      const key = `${dst}|${via}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const resolves = codeById.has(dst);
      if (!resolves) outOfScanImports.push({ from: c.rel, spec, dst });
      edge(c.id, dst, "imports", { via, spec, dynamic: false, dst_in_scan: resolves });
      importEdges++;
    }
  }
}

// `reads` — code reaching a world SURFACE, two derivable shapes only: a quoted
// path literal naming a real file under WORLD/ at this sha, or a DYNAMIC import
// whose quoted basename is a real tool of this world (the engineImport wrapper
// and its join() cousins — the only way world code ever runs in the office).
const SURFACE_RE = /(['"`])(WORLD\/[A-Za-z0-9._\-/]+)\1/g;
const DYN_JOIN_RE = /import\s*\(\s*[\s\S]{0,200}?["']tools["']\s*,\s*["']([A-Za-z0-9._-]+\.mjs)["']/g;
const DYN_JOIN2_RE = /import\s*\(\s*[\s\S]{0,120}?["']([A-Za-z0-9._-]+\.mjs)["']\s*\)/g;
const ENGINE_IMPORT_RE = /engineImport\(\s*["']([A-Za-z0-9._-]+\.mjs)["']/g;

const surfaceNodes = new Set();
const missingSurfaces = [];
let readEdges = 0;
for (const c of codeFiles) {
  const seen = new Set();
  SURFACE_RE.lastIndex = 0;
  let m;
  while ((m = SURFACE_RE.exec(c.text))) {
    const p = m[2];
    if (seen.has(`s:${p}`)) continue;
    seen.add(`s:${p}`);
    if (!existsSync(join(TREE, p))) { missingSurfaces.push({ from: c.rel, path: p }); continue; }
    const id = `surface:${p}`;
    if (!surfaceNodes.has(id)) { surfaceNodes.add(id); node(id, "code", { subkind: "world-surface", props: { path: p, exists: true, repo: "postmark-world" } }); }
    edge(c.id, id, "reads", { via: "quoted path literal", path: p });
    readEdges++;
  }
  for (const [re, via] of [[DYN_JOIN_RE, "dynamic import of a world tool"], [DYN_JOIN2_RE, "dynamic import (bare basename)"], [ENGINE_IMPORT_RE, "engineImport() wrapper"]]) {
    re.lastIndex = 0;
    while ((m = re.exec(c.text))) {
      const file = m[1];
      if (!worldToolNames.has(file)) continue;
      const dst = `code:world/tools/${file}`;
      if (dst === c.id || seen.has(`d:${dst}`)) continue;
      seen.add(`d:${dst}`);
      edge(c.id, dst, "reads", { via, dynamic: true, file });
      readEdges++;
    }
  }
}

// ── meta + counts ────────────────────────────────────────────────────────────
const hydratedAt = new Date().toISOString();
putMeta.run("as_of_world", worldSha);
putMeta.run("as_of_office", officeSha ?? "");
putMeta.run("world_ref", BLESSED ? BLESSED.ref : (REF ?? "HEAD"));
// THE TAG SERVED (postmark#2934): `as_of_settlement` is the number the town
// uses; `candidate_ahead` is main's commit when the keeper has not accepted it.
// Both null when the store was hydrated at an explicit ref rather than blessed.
putMeta.run("as_of_settlement", BLESSED?.n == null ? "" : `S${BLESSED.n}`);
putMeta.run("candidate_ahead", BLESSED?.candidate_ahead ?? "");
putMeta.run("canon_disclosed", BLESSED?.disclosed ?? "");
putMeta.run("world_path", WORLD);
putMeta.run("world_tree_path", TREE);
putMeta.run("office_path", OFFICE);
putMeta.run("hydrated_at", hydratedAt);
putMeta.run("node_version", process.version);
putMeta.run("hydration_status", "BUILDING");

// Over the rows, with SQL's own group order (src/world-graph-rows.mjs § graphCounts).
const rowCounts = graphCounts(T);
const counts = {
  nodes_total: rowCounts.nodes_total,
  nodes_by_kind: rowCounts.nodes_by_kind,
  marks_by_subkind: rowCounts.marks_by_subkind,
  marks_by_tier: rowCounts.marks_by_tier,
  edges_total: rowCounts.edges_total,
  edges_by_type: rowCounts.edges_by_type,
  events_total: rowCounts.events_total,
  geometry_versions_total: geometryVersions.length,
  geometry_versioned_marks: new Set(geometryVersions.map((g) => g.mark_id)).size,
  geometry_marks_with_history: geometryVersions.filter((g) => g.change !== "birth").length,
  edge_types_registered: rowCounts.edge_types_registered,
  // Which question the `contains` edges and the keeping-works gate were asked of
  // (the freeze, 2026-08-25). "directory-nesting" means the map was absent and
  // this hydration ran pre-freeze law — it is a fallback, never a default.
  containment_source: containmentSource,
  marks_in_the_keeping_works: rowCounts.marks_in_the_keeping_works,
};
const anomalies = {
  geometry_disagreements: geometryDisagreements.length,
  placement_disagreements: placementDisagreements.length,
  sited_or_parcel_under_predicate: sitedUnderPredicate.length,
  // A geometric mark in the tree that the fold's containment map does not
  // name. Zero on a world whose last settlement folded what it committed.
  geometric_marks_absent_from_the_containment_map: markNotInMap.length,
  dangling_stop_or_vessel: danglingStops.length,
  dangling_mechanic_pointers: danglingMechanics.length,
  unparseable_ledger_lines: badLedgerLines.length,
  marks_with_frontmatter_problems: oddFrontmatter.length,
  imports_leaving_the_scanned_set: outOfScanImports.length,
  quoted_world_paths_that_do_not_exist: missingSurfaces.length,
  geometry_history_problems: geometryAnomalies.length,
  marks_whose_id_differed_earlier_in_history: identityDrift.length,
  hydrator_warnings: warn.length,
};
putMeta.run("counts", JSON.stringify(counts));
putMeta.run("anomalies", JSON.stringify(anomalies));
putMeta.run("anomaly_detail", JSON.stringify({
  geometry: geometryDisagreements, placement: placementDisagreements, sited_under_predicate: sitedUnderPredicate,
  absent_from_containment_map: markNotInMap,
  dangling_stops: danglingStops, dangling_mechanics: danglingMechanics, bad_ledger_lines: badLedgerLines,
  frontmatter: oddFrontmatter, imports_out_of_scan: outOfScanImports, missing_surfaces: missingSurfaces,
  geometry_history: geometryAnomalies, identity_drift: identityDrift, warnings: warn,
}));
putMeta.run("gates", JSON.stringify(GATES));

// ── the no-silent-empty-table check ──────────────────────────────────────────
// A gate that reported PRESENT promised a table. If the table is empty anyway,
// the deriver failed quietly between the input and the row, which is exactly the
// failure the gate law exists to make impossible.
const PROMISED = [
  ["nodes", "world-clone"], ["edges", "world-clone"], ["edge_type_registry", "world-clone"],
  ["geometry_versions", "geometry-history"],
  ...(GATES.find((g) => g.gate === "walk-ledger")?.status === "PRESENT" ? [["events", "walk-ledger"]] : []),
];
const SIZE = { nodes: T.nodes, edges: T.edges, edge_type_registry: T.edgeTypes, geometry_versions: T.geometryVersions, events: T.events };
const empties = PROMISED.filter(([t]) => SIZE[t].size === 0);
if (empties.length) {
  const detail = empties.map(([t, g]) => `${t} (promised by gate ${g})`).join(", ");
  putMeta.run("hydration_status", `FAILED: empty tables — ${detail}`);
  // The file is still written, stamped FAILED, exactly as before: a reader
  // refuses it by name. The store is never given a failed snapshot.
  if (WRITE_DB) writeWorldDb(DB_PATH, graphTablesOf(T));
  console.error(`\nGATE FAILED silent-empty-table — ${detail}`);
  console.error(`world.db is stamped FAILED and will not load; fix the input and rehydrate.`);
  process.exit(1);
}

// ── the standing invariants ──────────────────────────────────────────────────
let lintSummary = null;
if (!flag("--no-lints")) {
  const { runLints } = await import("./world-lints.mjs");
  const sources = new Map(codeFiles.map((c) => [c.id, c.text]));
  // Over the graph built from the rows, the same construction every reader uses.
  const store = graphFromTables(graphTablesOf(T), { source: "the hydration in progress" });
  lintSummary = await runLints({ store, sources, engineText: existsSync(enginePath) ? readFileSync(enginePath, "utf8") : null, treePath: TREE });

  const ins = { run: (lint, verdict, headline, evidence, hydrated_at, as_of_world) =>
    T.lintFindings.put({ lint, verdict, headline, evidence, hydrated_at, as_of_world }) };
  // `law`/`law_text` ride into the stored detail beside method and limits: a
  // finding read back out of the table hours later must still name the mark it
  // enforces and quote that mark's claim, or the citation only ever existed in
  // the process that computed it.
  for (const l of lintSummary.lints) ins.run(l.id, l.verdict, l.headline, JSON.stringify({ law: l.law, law_text: l.law_text, method: l.method, limits: l.limits, evidence: l.evidence, rows: l.rows }), hydratedAt, worldSha);

  // The delta against this machine's previous hydration — the alert surface.
  if (previous) {
    const was = new Map(previous.findings.map((f) => [f.lint, f]));
    const delta = lintSummary.lints
      .filter((l) => (was.get(l.id)?.verdict ?? "(absent)") !== l.verdict)
      .map((l) => ({ lint: l.id, from: was.get(l.id)?.verdict ?? "(absent)", to: l.verdict, headline: l.headline }));
    putMeta.run("lint_delta", JSON.stringify({
      note: "verdicts that changed since THIS MACHINE's previous hydration — an observation about local runs, not town truth. Rebuild at two shas to compare two commits.",
      previous_as_of: previous.as_of_world, previous_hydrated_at: previous.hydrated_at, changed: delta,
    }));
    if (delta.length) { console.log(); for (const d of delta) console.log(`LINT DELTA  ${d.lint}: ${d.from} -> ${d.to}`); }
  }
}

putMeta.run("hydration_status", "OK");

// ── THE OUTPUTS, each written from the rows ─────────────────────────────────
const tables = graphTablesOf(T);
if (WRITE_DB) writeWorldDb(DB_PATH, tables);
let stored = null;
if (TO_STORE) {
  const { graphSnapshotFromTables, writeGraphSnapshot } = await import("../world2/tools/graph-ingest.mjs");
  const snap = graphSnapshotFromTables(tables);
  try { stored = await withStoreClient((client) => writeGraphSnapshot(client, snap)); }
  catch (e) {
    console.error(`the graph snapshot was NOT written to the store: ${String(e?.message ?? e).slice(0, 200)}`);
    process.exit(1);
  }
}

// ── the window ───────────────────────────────────────────────────────────────
// Regenerated at the end of every hydration so the ad-hoc view can never drift
// behind the store it is a picture of.
let gexf = null;
if (!flag("--no-gexf")) {
  const { exportGexf } = await import("../tools/world-gexf.mjs");
  // From the rows, not the file: the picture is of what was hydrated.
  const loaded = () => graphFromTables(tables, { source: "the hydration" });
  gexf = [
    exportGexf({ loaded: loaded(), out: join(OFFICE, "world-graph.gexf") }),
    exportGexf({ loaded: loaded(), out: join(OFFICE, "world-graph-static.gexf"), kinds: ["mark", "class", "code", "doctrine"], dropUnresolved: true }),
  ];
}

// ── report ───────────────────────────────────────────────────────────────────
if (JSON_OUT) {
  console.log(JSON.stringify({ as_of_world: worldSha, as_of_office: officeSha, hydrated_at: hydratedAt, counts, anomalies, gates: GATES, lints: lintSummary?.lints.map((l) => ({ id: l.id, verdict: l.verdict, headline: l.headline })), gexf, db: WRITE_DB ? DB_PATH : null, store: stored }, null, 2));
} else {
  for (const w of warn) console.warn(`WARN: ${w}`);
  console.log(`hydrated ${[WRITE_DB ? DB_PATH : null, stored ? `the store (S${stored.settlement ?? "?"} ${stored.tag_sha.slice(0, 12)})` : null].filter(Boolean).join(" and ") || "nothing (--no-db, no --to-store)"} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  as_of world ${worldSha.slice(0, 12)} (${BLESSED ? `${BLESSED.tag ?? "main"}, blessed` : (REF ?? "HEAD")}) · office ${(officeSha ?? "?").slice(0, 12)}`);
  console.log(`  nodes ${counts.nodes_total} ${JSON.stringify(counts.nodes_by_kind)}`);
  console.log(`  edges ${counts.edges_total} ${JSON.stringify(counts.edges_by_type)}`);
  console.log(`  events ${counts.events_total} departures (${badLedgerLines.length} lines unparseable)`);
  console.log(`  geometry: ${counts.geometry_versions_total} versions over ${counts.geometry_versioned_marks} marks · ${counts.geometry_versions_total - counts.geometry_versioned_marks} later revisions`);
  console.log(`  containment: ${containsEdges} contains from ${containmentSource} · ${describesEdges} describes (predicate nesting) · ${counts.marks_in_the_keeping_works} in the Keeping Works${markNotInMap.length ? ` · ⚠ ${markNotInMap.length} geometric mark(s) the map does not name` : ""}`);
  console.log(`  services: ${services} timetable-carrying mark(s) · ${stopEdges} stop-of · ${implementsEdges} implements · ${instanceOf} instance-of · ${doctrineNodes} doctrine (${doctrineEdges} describes)`);
  console.log(`  code: ${codeFiles.length} modules · ${importEdges} imports · ${readEdges} reads · ${builtinImports} node: and ${bareImports} bare specifiers skipped`);
  console.log(`  anomalies ${JSON.stringify(anomalies)}`);
  console.log(`  gates ${GATES.filter((g) => g.status === "PRESENT").length} present · ${GATES.filter((g) => g.status === "ABSENT").length} absent (disclosed)`);
  if (lintSummary) console.log(`  lints  ${lintSummary.lints.map((l) => `${l.id}:${l.verdict}`).join(" · ")}`);
  if (gexf) for (const g of gexf) console.log(`  gexf ${g.out} — ${g.nodes} nodes / ${g.edges} edges, ${(g.bytes / 1024).toFixed(0)} KiB`);
}

// ── the writers ─────────────────────────────────────────────────────────────

/** world.db from the rows: every table, in the rows' order, in one transaction. */
function writeWorldDb(path, t) {
  if (existsSync(path)) rmSync(path);
  const db = new DatabaseSync(path);
  try {
    db.exec(SCHEMA);
    db.exec("BEGIN");
    const meta = db.prepare("INSERT INTO meta VALUES (?, ?)");
    for (const r of t.meta) meta.run(r.key, r.value);
    const node = db.prepare("INSERT INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?)");
    for (const r of t.nodes) node.run(r.id, r.kind, r.subkind, r.tier, r.by, r.at_x, r.at_y, r.extent_w, r.extent_h, r.props);
    const edge = db.prepare("INSERT INTO edges (seq, src, dst, type, props, born_at) VALUES (?,?,?,?,?,?)");
    for (const r of t.edges) edge.run(r.seq, r.src, r.dst, r.type, r.props, r.born_at);
    const ev = db.prepare("INSERT INTO events (seq, at, actor, type, payload) VALUES (?,?,?,?,?)");
    for (const r of [...t.events].sort((a, b) => a.seq - b.seq)) ev.run(r.seq, r.at, r.actor, r.type, r.payload);
    const type = db.prepare("INSERT INTO edge_type_registry VALUES (?, ?)");
    for (const r of t.edgeTypes) type.run(r.type, r.note);
    const geom = db.prepare("INSERT INTO geometry_versions (seq, mark_id, at_x, at_y, extent_w, extent_h, valid_from_iso, valid_to_iso, sha, path, subject, authored_iso, change) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const r of [...t.geometryVersions].sort((a, b) => a.seq - b.seq))
      geom.run(r.seq, r.mark_id, r.at_x, r.at_y, r.extent_w, r.extent_h, r.valid_from_iso, r.valid_to_iso, r.sha, r.path, r.subject, r.authored_iso, r.change);
    const lint = db.prepare("INSERT INTO lint_findings (lint, verdict, headline, evidence, hydrated_at, as_of_world) VALUES (?,?,?,?,?,?)");
    for (const r of t.lintFindings) lint.run(r.lint, r.verdict, r.headline, r.evidence, r.hydrated_at, r.as_of_world);
    db.exec("COMMIT");
  } finally { db.close(); }
}

/** One pg client for the store writes, from PGHOST/PGDATABASE/PGUSER/PGPASSWORD (as law-ingest's). */
async function withStoreClient(fn) {
  const { default: pg } = await import("pg");
  const client = new pg.Client();
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}
