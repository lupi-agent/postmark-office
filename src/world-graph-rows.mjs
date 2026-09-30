// world-graph-rows.mjs — the world graph's rows as the hydrator builds them,
// in memory, before they go anywhere (POS-270, lane W item 1).
//
// The hydrator used to build world.db and nothing else; the store's snapshot
// (037/038) was then COPIED OUT OF THE FILE by graph-ingest. Now the hydrator
// builds these tables, and each output is written FROM them: the store's
// snapshot (graph-ingest's writer) and, until the last world.db reader has
// moved, the file. Nothing reads the file to fill the store.
//
// ⚑ THE ROWS KEEP THE FILE'S OWN ORDER, because the graph's iteration order
// (and so the window's node list, and even the lints) follows the order the
// rows were built in. world.db's order is sqlite's, and it is mimicked here
// exactly:
//   - a keyed table (`INSERT OR REPLACE`) keeps the row's place on first insert,
//     and a REPLACE deletes the row and appends the new one at the end — which
//     is what a rowid table does, and why `hydration_status` ends up last in meta;
//   - an append table (`INSERT` into `seq INTEGER PRIMARY KEY AUTOINCREMENT`)
//     numbers its rows 1, 2, 3 in insert order.
// `toTables()` hands them back in `readWorldDbTables`' shape and ORDER BYs, so
// the store's snapshot, the file, and the graph built from either are one set
// of rows. The parity proof is docs/2026-09-30/rail/hydrator-emits-rows/.

/** A table keyed by one column, with sqlite's INSERT OR REPLACE order. */
function keyedTable(key) {
  const rows = new Map();
  return {
    put(row) {
      const k = row[key];
      if (rows.has(k)) rows.delete(k);   // REPLACE: the old row goes, the new one is appended
      rows.set(k, row);
    },
    get: (k) => rows.get(k),
    all: () => [...rows.values()],
    get size() { return rows.size; },
  };
}

/** A table with an AUTOINCREMENT seq, numbered in insert order. */
function appendTable() {
  const rows = [];
  return {
    push(row) { const seq = rows.length + 1; rows.push({ seq, ...row }); return seq; },
    all: () => rows.slice(),
    get size() { return rows.length; },
  };
}

/** The empty tables of one hydration. */
export function createGraphRows() {
  return {
    meta: keyedTable("key"),
    nodes: keyedTable("id"),
    edges: appendTable(),
    events: appendTable(),
    geometryVersions: appendTable(),
    edgeTypes: keyedTable("type"),
    lintFindings: keyedTable("lint"),
  };
}

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The rows in `readWorldDbTables`' shape, and in its ORDER BYs: nodes, meta,
 * edge types and lints in table order; edges by seq; events by `at` (then seq);
 * geometry by mark, then valid-from (then seq).
 */
export function graphTablesOf(t) {
  return {
    meta: t.meta.all().map((r) => ({ key: r.key, value: r.value })),
    nodes: t.nodes.all().map((r) => ({ ...r })),
    edges: t.edges.all().map((r) => ({ ...r })),
    events: t.events.all().slice().sort((a, b) => byText(a.at, b.at) || a.seq - b.seq).map((r) => ({ ...r })),
    geometryVersions: t.geometryVersions.all().slice()
      .sort((a, b) => byText(a.mark_id, b.mark_id) || byText(a.valid_from_iso, b.valid_from_iso) || a.seq - b.seq).map((r) => ({ ...r })),
    edgeTypes: t.edgeTypes.all().map((r) => ({ ...r })),
    lintFindings: t.lintFindings.all().map((r) => ({ ...r })),
  };
}

// ── the counts the hydrator stamps in meta, computed over the rows ─────────
//
// These were SQL over the file (`SELECT kind, COUNT(*) … GROUP BY kind ORDER BY c
// DESC`). The groups and every count are the same here; the groups come in
// count order, and among TIED counts in key order (BINARY, nulls first).
// sqlite's own order among ties is its sorter's business, measured to differ
// from key order on a small table, so a group map's key order may differ from
// the old file's where two counts tie. Nothing reads that order, and the file
// and the store are both written from these rows, so they always agree. At S87
// the stamped counts were identical bytes (the parity proof).

const cmpKey = (a, b) => (a === b ? 0 : a === null ? -1 : b === null ? 1 : byText(String(a), String(b)));
function groupCount(rows, keyOf) {
  const groups = new Map();
  for (const r of rows) { const k = keyOf(r); groups.set(k, (groups.get(k) ?? 0) + 1); }
  const entries = [...groups.entries()].sort((a, b) => cmpKey(a[0], b[0]));
  entries.sort((a, b) => b[1] - a[1]);   // stable: ties keep key order
  return Object.fromEntries(entries);
}

const inWorks = (props) => {
  try { const v = JSON.parse(props ?? "")?.in_works; return v === 1 || v === true; } catch { return false; }
};

export function graphCounts(t) {
  const nodes = t.nodes.all(), marks = nodes.filter((n) => n.kind === "mark"), edges = t.edges.all();
  return {
    nodes_total: nodes.length,
    nodes_by_kind: groupCount(nodes, (n) => n.kind ?? null),
    marks_by_subkind: groupCount(marks, (n) => n.subkind ?? null),
    marks_by_tier: groupCount(marks, (n) => n.tier ?? "(none)"),
    edges_total: edges.length,
    edges_by_type: groupCount(edges, (e) => e.type ?? null),
    events_total: t.events.size,
    edge_types_registered: t.edgeTypes.size,
    marks_in_the_keeping_works: marks.filter((n) => inWorks(n.props)).length,
  };
}
