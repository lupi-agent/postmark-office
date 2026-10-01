// world-graph-db.mjs — the world graph's rows, answering the questions the office
// used to ask world.db, from the store's snapshot (POS-270, lane W item 2).
//
// The readers of world.db hold a handle and ask it SQL: `db.prepare(SQL).get(…)`.
// Rewriting each of them to walk a graph would be a second implementation of
// every question beside the first. So the snapshot answers through a handle of
// the same shape instead, and each question it can answer has a TWIN: a
// function over the snapshot's rows, registered beside the SQL it stands for,
// in the module that owns that SQL (`registerTwin(SQL, twin)`).
//
//   graphDb(tables).prepare(SQL)   → the twin registered for that exact text
//                                    → an UNKNOWN statement throws, by name
//
// The throw is the whole safety: a reader that asks a question with no twin
// fails loudly in its own tests, and is never answered by a guess.
//
// ⚑ EACH TWIN IS HELD EQUAL TO ITS SQL, row for row and in order, against a
// world.db hydrated from the same world (test/world-graph-db.test.mjs, at the
// checkout's newest blessing), so the handle answers what the file answered.
//
// No sqlite is involved: the SQL text is the question's NAME here, nothing
// runs it.

import { worldGraphSnapshot } from "./world-graph-snapshot.mjs";

const TWINS = new Map();
const norm = (sql) => String(sql).replace(/\s+/g, " ").trim();

/** Register the snapshot's answer to one statement, beside the statement. */
export function registerTwin(sql, twin) {
  TWINS.set(norm(sql), twin);
  return sql;
}

/** The statements the handle can answer (for the tests' census). */
export const twinnedStatements = () => [...TWINS.keys()];

// ── sqlite's JSON and comparison semantics, for the twins to share ──────────

/**
 * `json_extract(props, '$.<key>')` over a parsed props object: a missing key
 * or JSON null is NULL, true/false are 1/0, numbers and strings are themselves,
 * and an object or array is its minified JSON text (the props were written by
 * JSON.stringify, so re-stringifying a subtree gives back its own text).
 */
export function jx(p, key) {
  const v = p?.[key];
  if (v === undefined || v === null) return null;
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

/** `json_type(props, '$.<key>') = 'true'`. */
export const jtypeTrue = (p, key) => p?.[key] === true;

/**
 * sqlite's ORDER BY comparison: NULL first, then numbers, then text (BINARY).
 * For the twins whose statements sort, so a tie-break or a mixed column sorts
 * the way the file did.
 */
export function sqlCompare(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  const na = typeof a === "number", nb = typeof b === "number";
  if (na && nb) return a - b;
  if (na) return -1;
  if (nb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** sqlite's BINARY text order, for the questions answered off the id index. */
export const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * `worksClause()`, in sqlite's three-valued logic (1, 0 or NULL), because one
 * statement SELECTs it as a column:
 *   (in_works = 1 OR (in_works IS NULL AND path LIKE '%/the-keeping-works/%'))
 * LIKE is case-insensitive for ASCII, as sqlite's is by default.
 */
export function worksValue(p) {
  const w = jx(p, "in_works");
  const a = w === null ? null : (w === 1 ? 1 : 0);          // in_works = 1
  let b;                                                     // in_works IS NULL AND path LIKE …
  if (w !== null) b = 0;
  else {
    const path = jx(p, "path");
    b = path === null ? null : (String(path).toLowerCase().includes("/the-keeping-works/") ? 1 : 0);
  }
  if (a === 1 || b === 1) return 1;
  if (a === null || b === null) return null;
  return 0;
}
export const inWorks = (p) => worksValue(p) === 1;

/** `CLASS_MARK_GATE_SQL`: the verb-minting gate, over a snapshot row. */
export const classMarkGate = (n) => n.kind === "mark" && n.by === "the-town" && n.tier === "constitution"
  && jx(n.p, "class") !== null && inWorks(n.p) && (jx(n.p, "actions") !== null || jx(n.p, "affordances") !== null);

/** `CLASS_ROSTER_GATE_SQL`: the wider roster gate. */
export const classRosterGate = (n) => n.kind === "mark" && n.by === "the-town" && n.tier === "constitution"
  && jx(n.p, "class") !== null && inWorks(n.p);

/**
 * `CLASS_ROSTER_GATE_SQL` SELECTed as a column: sqlite's three-valued AND over
 * its terms (a NULL column makes its comparison NULL; any false term makes 0).
 */
export function classRosterGateValue(n) {
  const eq = (v, want) => (v === null || v === undefined ? null : (v === want ? 1 : 0));
  const terms = [eq(n.kind, "mark"), eq(n.by, "the-town"), eq(n.tier, "constitution"),
    jx(n.p, "class") !== null ? 1 : 0, worksValue(n.p)];
  if (terms.includes(0)) return 0;
  if (terms.includes(null)) return null;
  return 1;
}

// ── the handle ──────────────────────────────────────────────────────────────

/** The rows the twins read, indexed once per snapshot. */
function indexOf(tables) {
  const parse = (s) => { try { return JSON.parse(s ?? "") ?? {}; } catch { return {}; } };
  const nodes = tables.nodes.map((r) => ({ ...r, p: parse(r.props) }));
  return {
    nodes,
    byId: new Map(nodes.map((n) => [n.id, n])),
    edges: tables.edges,
    events: tables.events,
    meta: tables.meta,
  };
}

const cache = new WeakMap();

/**
 * A read-only handle over one snapshot's tables (`graphTablesAt`, or a test's
 * rows). `prepare(sql)` answers with the twin
 * registered for that exact statement, or throws.
 */
export function graphDb(tables) {
  let g = cache.get(tables);
  if (!g) { g = indexOf(tables); cache.set(tables, g); }
  return {
    source: "store",
    prepare(sql) {
      const twin = TWINS.get(norm(sql));
      if (!twin) throw new Error(`the world graph snapshot has no twin for this statement, and will not guess one: ${norm(sql).slice(0, 160)}`);
      return {
        all: (...args) => twin(g, ...args),
        get: (...args) => twin(g, ...args)[0],
      };
    },
    close() { /* nothing is held open */ },
  };
}

// The statements every opener asks, registered here once.
registerTwin("SELECT key, value FROM meta", (g) => g.meta.map((r) => ({ key: r.key, value: r.value })));
export const HYDRATION_STATUS = registerTwin("SELECT value FROM meta WHERE key='hydration_status'",
  (g) => g.meta.filter((r) => r.key === "hydration_status").map((r) => ({ value: r.value })));

/** `meta WHERE key IN (…)` is answered off meta's key index: key order. */
export const metaIn = (g, keys) => g.meta.filter((r) => keys.includes(r.key))
  .map((r) => ({ key: r.key, value: r.value })).sort((a, b) => sqlCompare(a.key, b.key));

/**
 * THE ONE OPENER (POS-270 lane W 3b): the world graph snapshot's handle, or
 * null before one has loaded. There is no file behind it: world.db is retired,
 * and a reader with no snapshot stands on its own floor and says so.
 */
export function openWorldStore() {
  const snap = worldGraphSnapshot();
  return snap?.tables ? { db: graphDb(snap.tables), source: "store", snap } : null;
}

/** What a reader says when there is no world to read: no file is named, because there is none. */
export const NO_WORLD = "no world store: the world graph snapshot has not loaded";
