// world-graph.mjs — the window's read side (Stage E): world.db as one
// Cytoscape-ready payload, with the standing invariants' findings PAINTED ONTO
// the graph rather than listed beside it.
//
// The plan's line about what makes this debugging rather than decoration:
// "lint violations painted as red edges — the stale wheelhouse as a dangling red
// edge you see, hanging off the vessel." So the whole job of this module is the
// hop the lints do not make: a lint says "timetable declares world/tools/vessel.mjs
// and the office never loads it"; this resolves that sentence into the node and
// edge ids the sentence is ABOUT, so the picture can go red in the right place.
//
// Three rules govern that resolution, because a window that lies is worse than
// no window:
//
//   1. NOTHING IS INFERRED FROM PROSE. Every id painted comes from a structured
//      field the lint itself wrote (`carried_by`, `parcel`, `rule`, `hits[].file`),
//      never from parsing a headline. The lints own their findings; this module
//      only addresses them.
//   2. AN ID THAT IS NOT IN THE GRAPH IS REPORTED, NOT DROPPED. Each lint's
//      `implicates` block carries an `unmatched` list. A finding about something
//      the store has no node for is itself a finding, and silently swallowing it
//      would make the window agree with the graph by construction.
//   3. A LINT THAT CANNOT BE ADDRESSED SAYS SO. L6 is N/A today and names no
//      node; it lands with an empty implication and an explicit `paints: false`
//      rather than being quietly absent from the panel.
//
// Y IS NOT NEGATED HERE, and that is a deliberate difference from
// tools/world-gexf.mjs, which does negate. The world's y runs SOUTH
// (world-engine.mjs computes bearings as atan2(dx, -dy), 0=N); Cytoscape's y
// runs DOWN the screen. South down IS north up, so passing the coordinate
// through unchanged draws the map the right way round. GEXF/Gephi's y runs up,
// which is why the other exporter has to flip it. Same world, two viewers, two
// conventions — write the flip where the viewer is, never in the store.

import { statSync } from "node:fs";
import { join } from "node:path";

import { loadWorldGraph, OFFICE_ROOT } from "./world-store.mjs";
import { storeDbPath } from "./world-serve.mjs";
import { worldGraphSnapshot } from "./world-graph-snapshot.mjs";

// ── the zero-build lane ──────────────────────────────────────────────────────
//
// The two GEXF files tools/world-gexf.mjs regenerates at the end of every
// hydration, so an operator who wants Gephi Lite rather than the town's own page
// can have the same store in a browser tab with no build at all (§2.12: "Zero-build
// lane from day one"). Served, not rebuilt on request: the file on disk is the
// one the hydration wrote, and a route that regenerated it would be publishing a
// picture of a store nobody had hydrated.
//
// Resolved under OFFICE_ROOT because that is exactly where the writer puts them:
// src/world-hydrate.mjs calls exportGexf with `join(OFFICE, ...)` for both views,
// whatever --db it was pointed at. One spelling of the location, on the writer's
// side, read back here — never a second guess about where a file "probably" is.
export const GEXF_VIEWS = {
  full: "world-graph.gexf",
  static: "world-graph-static.gexf",
};

/** The path of a named GEXF view, and whether it is actually there. */
export function gexfPath(view = "full") {
  const file = GEXF_VIEWS[view];
  if (!file) return { error: `no such view "${view}"`, views: Object.keys(GEXF_VIEWS) };
  const path = join(OFFICE_ROOT, file);
  try {
    const st = statSync(path);
    return { path, file, bytes: st.size, mtime: new Date(st.mtimeMs).toISOString() };
  } catch {
    return { error: "not exported yet", detail: `${file} is written at the end of every hydration; this office has not run one`, path };
  }
}

// The four node kinds the store holds, plus `unknown` for the placeholder end of
// a dangling edge. Colour lives on the page, not here — a payload that shipped
// hex codes would make the office the owner of the town's palette.
export const NODE_KINDS = ["mark", "class", "code", "doctrine", "unknown"];

// The convergence layer of §2.11: class → affordance → implementing code must be
// traversable. These are the kinds that traversal runs over, and the page's
// convergence chip selects exactly this set. Named here so the office and the
// page cannot drift into two different ideas of what "convergence" means.
export const CONVERGENCE_KINDS = ["class", "code", "doctrine"];

// ── the snapshot ─────────────────────────────────────────────────────────────
// Same discipline as world-serve.mjs's: keyed on the FILE's mtime+size, because
// a rehydration at the same sha still rewrites the file and a cache keyed on
// as_of_world could not be invalidated by one. What is held is the built
// PAYLOAD, not the graphology instance — the payload is the only thing this
// route serves, and holding the graph as well would keep a second copy of the
// world alive beside the serving path's own snapshot.

let _cached = null;

/** Drop the cached payload — for tests that rewrite world.db in place. */
export function resetGraphCache() { _cached = null; _fromSnap = null; }

/**
 * The window's payload for a store file, or an honest error.
 *
 * Never throws: a missing, half-built or FAILED-stamped store is something the
 * route must be able to SAY, and an operator opening the window on a box that
 * has not hydrated yet is the most likely first visit there will ever be.
 */
export function worldGraphPayload(dbPath = null) {
  // THE STORE FIRST (POS-270, option A). With no file named, the window answers
  // from the world graph snapshot once it has loaded; a caller that names a
  // file (a test, a tool) gets that file, and before the snapshot lands the
  // office's own world.db is the floor.
  if (dbPath == null) {
    const snap = worldGraphSnapshot();
    if (snap) return payloadFromSnapshot(snap);
    dbPath = storeDbPath();
  }
  let st;
  try { st = statSync(dbPath); }
  catch { return { error: "no world store", detail: `nothing at ${dbPath}`, dbPath }; }
  if (_cached && _cached.dbPath === dbPath && _cached.mtimeMs === st.mtimeMs && _cached.size === st.size) return _cached.payload;
  let payload;
  try { payload = buildPayload(dbPath, st); }
  catch (e) { return { error: "the world store would not load", detail: String(e?.message ?? e).slice(0, 200), dbPath }; }
  _cached = { dbPath, mtimeMs: st.mtimeMs, size: st.size, payload };
  return payload;
}

const parse = (s, fallback = null) => { try { return JSON.parse(s ?? ""); } catch { return fallback; } };

function buildPayload(dbPath, st) {
  return worldGraphPayloadFrom(loadWorldGraph(dbPath), { bytes: st.size, mtime: new Date(st.mtimeMs).toISOString() });
}

let _fromSnap = null; // { snap, payload } — the snapshot object is the key: a new one is a new publish

function payloadFromSnapshot(snap) {
  if (_fromSnap?.snap === snap) return _fromSnap.payload;
  const payload = worldGraphPayloadFrom(snap);
  _fromSnap = { snap, payload };
  return payload;
}

/**
 * The window's payload from a loaded graph (`loadWorldGraph`'s shape, or the
 * store's snapshot of it). `store` describes where the graph came from: the
 * file's bytes and mtime, or the snapshot's settlement and key. It is the one
 * field that differs by source; nothing reads it but a person.
 */
export function worldGraphPayloadFrom(loaded, store = null) {
  const { graph, meta, counts, edgeTypes, lintFindings, placeholders } = loaded;
  store ??= loaded.pin
    ? { source: "store", settlement: loaded.pin.settlement ?? null, tag_sha: loaded.pin.tag_sha, office_sha: loaded.pin.office_sha }
    : null;

  const nodes = [];
  const byKind = {};
  let positioned = 0;
  graph.forEachNode((id, a) => {
    const p = a.props ?? {};
    byKind[a.kind ?? "unknown"] = (byKind[a.kind ?? "unknown"] ?? 0) + 1;
    const data = {
      id,
      kind: a.kind ?? "unknown",
      subkind: a.subkind ?? null,
      tier: a.tier ?? null,
      by: a.by ?? null,
      deg: graph.degree(id),
      indeg: graph.inDegree(id),
      outdeg: graph.outDegree(id),
      unresolved: a.missing === true,
      lints: [],                       // filled by paintLints below
    };
    // The handful of props worth carrying. `props` is deliberately NOT shipped
    // whole: it is where mark frontmatter lands, it is unbounded, and a window
    // that shipped every field would be a mark reader wearing a graph's clothes.
    if (p.path) data.path = p.path;
    if (p.date) data.date = p.date;
    if (p.mechanic) data.mechanic = p.mechanic;
    if (p.class) data.class = p.class;
    // The declaration FACT (step-1, 2026-08-18), derived once by the hydrator
    // (a class-carrying mark standing in the Keeping Works) — the site lens
    // reads this instead of re-deriving position, so a class-carrying mark
    // without it renders as the INSTANCE it is.
    if (p.declares === true) data.declares = true;
    if (Array.isArray(p.actions ?? p.affordances)) data.actions = (p.actions ?? p.affordances).length;
    // THE CLAIM ITSELF. A mark's body is the sentence the author wrote about
    // the thing — SCHEMA.md caps it at 150 characters — and without it the
    // window can say a node's degree, its tier and its path but not what it
    // SAYS. Two of these ship for the cost of one of the id strings already
    // here, and a reader who has to open the repo to find out what
    // `the-town/the-fog` claims is not reading the world through this window.
    if (p.body) data.body = p.body;
    // The author's own key list (world-hydrate.mjs § what the AUTHOR wrote).
    // Every other field on this node is COMPOSED — the loader defaults `tier`
    // to "market" and synthesizes half the identity — so this is the only thing
    // in the payload that answers "what does the file actually say", which is
    // the question the tier cutover and the serialization map are both made of.
    if (Array.isArray(p.keys)) data.keys = p.keys;
    // The one walk's verdict (world-hydrate.mjs § the one walk): standing is
    // derived at hydration, never asserted, and the page's colours read this.
    // Absent on a store hydrated before the walk rode along — the page says
    // "not sent" for that rather than painting a guess.
    if (p.standing) data.standing = p.standing;
    const el = { data };
    if (a.x != null && a.y != null) { el.position = { x: a.x, y: a.y }; positioned++; }
    if (a.w != null) data.w = a.w;
    if (a.h != null) data.h = a.h;
    nodes.push(el);
  });

  const edges = [];
  const byType = {};
  graph.forEachEdge((key, a, src, dst) => {
    byType[a.type ?? "?"] = (byType[a.type ?? "?"] ?? 0) + 1;
    const data = { id: key, source: src, target: dst, type: a.type ?? null, lints: [] };
    // The two verdicts an edge can carry against itself: the hydrator writes
    // them onto `contains` edges and never repairs the disagreement, so a false
    // here is already a finding before any lint runs.
    if (a.props?.geometry_ok === false) data.geometry_ok = false;
    if (a.props?.placement_ok === false) data.placement_ok = false;
    if (a.props?.via) data.via = a.props.via;
    edges.push({ data });
  });

  const lints = paintLints(lintFindings, nodes, edges, graph);

  return {
    elements: { nodes, edges },     // the shape `cytoscape({ elements })` takes
    as_of: {
      world: meta.as_of_world ?? null,
      office: meta.as_of_office ?? null,
      world_ref: meta.world_ref ?? null,
      as_of_settlement: meta.as_of_settlement || null,     // the tag served (postmark#2934)
      candidate_ahead: meta.candidate_ahead || null,       // main's commit when the keeper has not accepted it
      hydrated_at: meta.hydrated_at ?? null,
      hydration_status: meta.hydration_status ?? null,
    },
    store,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      by_kind: byKind,
      by_edge_type: byType,
      positioned,
      unresolved: placeholders.length,
      // The hydrator's own tally, so a page can say "the store holds what the
      // hydration said it wrote" without a second request.
      hydrator_nodes: counts?.nodes_total ?? null,
    },
    kinds: NODE_KINDS,
    convergence_kinds: CONVERGENCE_KINDS,
    edge_types: edgeTypes ?? [],
    lints,
    lint_delta: parse(meta.lint_delta),
    // The coordinate contract, stated in the payload rather than in a comment
    // only the office can read: a viewer that gets this backwards draws a
    // mirrored town and has no way to know.
    coordinates: {
      units: "metres, absolute grid; origin = the Origin, {0,0}",
      x: "east positive",
      y: "SOUTH positive — pass through unchanged to any renderer whose y runs down the screen (Cytoscape, canvas); flip it for one whose y runs up (GEXF/Gephi)",
    },
  };
}

// ── painting the findings ────────────────────────────────────────────────────
//
// One extractor per lint, each reading only the structured rows its own lint
// wrote. They are written as separate functions rather than one clever loop
// because they are separate readings of separate evidence: L4 knows what a
// non-conforming parcel is, L5 knows what an unenforced section is, and a shared
// abstraction over the two would be a place for a wrong guess to hide.

function paintLints(findings, nodes, edges, graph) {
  const nodeById = new Map(nodes.map((n) => [n.data.id, n.data]));
  // Indexed by (source, type) and NOT by both endpoints, deliberately. A lint
  // row names the NEAR end — the parcel, the stop, the mark that carries the
  // mechanic — and the far end is whatever the hydrator put there: a parcel’s
  // `instance-of` points at `the-town/parcel-class`, and a stop’s `stop-of`
  // points at the VESSEL rather than at the service whose timetable names it.
  // Asking for an edge by both ends would mean this module keeping a second
  // copy of ids the store owns, and drifting the day either is renamed.
  const bySource = new Map();
  for (const e of edges) {
    const k = [e.data.source, e.data.type].join("|");
    if (!bySource.has(k)) bySource.set(k, []);
    bySource.get(k).push(e);
  }
  const edgesFrom = (src, type) => bySource.get([src, type].join("|")) ?? [];
  const edgeTo = (src, dst, type) => edgesFrom(src, type).find((e) => e.data.target === dst) ?? null;

  const out = [];
  for (const f of findings ?? []) {
    const ev = f.evidence && typeof f.evidence === "object" && !Array.isArray(f.evidence) ? f.evidence : {};
    const rows = Array.isArray(ev.rows) ? ev.rows : [];
    const heads = Array.isArray(ev.evidence) ? ev.evidence : [];

    // An unknown lint id paints nothing rather than throwing: a new invariant
    // must be able to land in world-lints.mjs and appear in the panel unpainted,
    // without taking the window down until someone writes its extractor.
    const raw = EXTRACTORS[f.lint]?.(rows, { edgesFrom, edgeTo })
      ?? { paints: false, note: `no extractor for ${f.lint} — listed, not painted` };
    const claimed = { nodes: raw.nodes ?? [], edges: raw.edges ?? [], paints: raw.paints, note: raw.note ?? null };

    // Rule 2: an id the graph does not hold is REPORTED. Painting is the whole
    // point, so a finding that addresses nothing must be visibly addressing
    // nothing rather than looking like a clean bill of health.
    const okNodes = [];
    const unmatched = [];
    for (const n of claimed.nodes) (nodeById.has(n.id) ? okNodes : unmatched).push(n);
    for (const n of okNodes) if (!nodeById.get(n.id).lints.includes(f.lint)) nodeById.get(n.id).lints.push(f.lint);
    for (const e of claimed.edges) if (!e.data.lints.includes(f.lint)) e.data.lints.push(f.lint);

    out.push({
      lint: f.lint,
      verdict: f.verdict,
      headline: f.headline,
      // The mark this question enforces, and that mark's one claim verbatim, as
      // the lint cited them. A panel showing a red without the law it broke is
      // asking the reader to take the lint's word for what the law says.
      law: ev.law ?? null,
      law_text: ev.law_text ?? null,
      method: ev.method ?? null,
      limits: ev.limits ?? null,
      // Evidence HEADS — the lint's own one-line summaries, which is what a
      // findings panel can actually show.
      evidence: heads.slice(0, 8),
      evidence_total: heads.length,
      rows_total: rows.length,
      // The structured rows themselves, capped. The keeping-works lens reads
      // L6's rows by contract ("the asks are L6's own rows, never recomputed
      // here") — and a payload that shipped only rows_total left that lens
      // confidently reporting ZERO asks beside a red L6, which is the exact
      // shape of lie this window exists to prevent. Rows are structured facts,
      // not prose, so they ride as the lint wrote them; the cap bounds the
      // payload against a lint whose rows run to hundreds, and rows_total
      // still says when the cap bit.
      rows: rows.slice(0, 200),
      hydrated_at: f.hydrated_at ?? null,
      implicates: {
        paints: claimed.paints !== false,
        nodes: okNodes,
        edges: claimed.edges.map((e) => ({ id: e.data.id, why: e.why })),
        unmatched,
        note: claimed.note ?? null,
      },
    });
  }
  return out.sort((a, b) => String(a.lint).localeCompare(String(b.lint)));
}

const EXTRACTORS = {
  // L1 — mechanics reach running code. The finding lives on the hop from a mark
  // to the mechanic it declares: the mark is real, the mechanic class is real,
  // and the module that would make the mechanic true is either undeclared or
  // never loaded. So the `implements` EDGE is what goes red — the stale
  // wheelhouse hanging off the vessel, exactly as §2.12 describes it.
  L1: (rows, { edgesFrom }) => {
    const nodes = [];
    const edges = [];
    for (const r of rows) {
      const verdict = String(r.verdict ?? "");
      if (verdict === "unclaimed" || verdict === "green" || verdict === "OK") continue;  // nothing carries it; nothing to paint
      const why = verdict === "RED"
        ? `declares ${(r.declared_modules ?? []).join(", ") || "a module"}, not reachable from the running office`
        : "no implementing module is declared anywhere (UNDERIVABLE)";
      for (const mark of r.carried_by ?? []) {
        nodes.push({ id: mark, why: `carries the ${r.mechanic} mechanic, which ${why}` });
        // The mark's own `implements` edges — the mechanic class node comes off
        // the far end rather than being spelled here.
        for (const e of edgesFrom(mark, "implements")) {
          edges.push({ data: e.data, why });
          nodes.push({ id: e.data.target, why });
        }
      }
      // The declared-but-unreachable module itself (vessel.mjs). Only for RED:
      // an UNDERIVABLE row declares nothing, and painting a module it never
      // named would be inventing the accusation.
      if (verdict === "RED") for (const mod of r.declared_modules ?? []) nodes.push({ id: mod, why: `declared by ENGINE.md for ${r.mechanic}; the office never loads it` });
    }
    return { nodes, edges };
  },

  // L2 — stops vs observed departures. The row is one service; the finding is
  // per departure. What goes red is the STOP the departure missed (its nearest,
  // named by the lint) and the `stop-of` edge tying that stop to its service.
  L2: (rows, { edgesFrom }) => {
    const nodes = [];
    const edges = [];
    for (const r of rows) {
      for (const d of r.departures ?? []) {
        if (d.on_schedule !== false) continue;
        const stop = d.nearest ?? d.departed_from;
        const why = `a departure at ${d.at} left ${d.centre_off_by_m} m from this stop's centre AS IT STOOD THEN (walk-ledger line ${d.line})`;
        if (stop) {
          nodes.push({ id: stop, why });
          for (const e of edgesFrom(stop, "stop-of")) edges.push({ data: e.data, why });
        }
        if (r.service) nodes.push({ id: r.service, why: `this service carries the timetable, and ${why}` });
      }
    }
    return { nodes, edges };
  },

  // L3 — no orphan constants. The finding is a MISSING edge: a file carries a
  // class's number with no link back to the mark that owns it. There is nothing
  // to paint between them, so both ends go red and the panel says why — the red
  // is the absence, and a viewer looking for the edge will find none.
  L3: (rows) => {
    const nodes = [];
    for (const r of rows) {
      const orphans = (r.hits ?? []).filter((h) => h.absolved === false);
      if (!orphans.length) continue;
      if (r.owner) nodes.push({ id: r.owner, why: `owns ${r.key}; ${orphans.length} file(s) carry the literal with no link back` });
      for (const h of orphans) nodes.push({ id: h.file, why: `carries ${r.key} as a bare literal (${h.occurrences}×), owner ${r.owner}` });
    }
    return { nodes, note: "L3's finding is a MISSING edge — there is no link between these code files and the mark that owns the constant. Both ends are painted; the absence between them is the finding." };
  },

  // L4 — instances conform to their class. The parcel and its `instance-of`
  // edge to the class it fails to match.
  L4: (rows, { edgesFrom }) => {
    const nodes = [];
    const edges = [];
    for (const r of rows) {
      if (r.conforms !== false) continue;
      const why = `${r.w}×${r.h}, not the parcel class's extent${r.pre ? " — pre: true, seeded prior estate the class law grandfathers" : ""}`;
      nodes.push({ id: r.parcel, why });
      for (const e of edgesFrom(r.parcel, "instance-of")) edges.push({ data: e.data, why });
    }
    return { nodes, edges };
  },

  // L5 — doctrine reaches enforcement. The doctrine node's id IS the rule id the
  // lint reports, so this is the one extractor with nothing to resolve.
  L5: (rows) => ({
    nodes: rows.filter((r) => r.enforced === false).map((r) => ({ id: r.rule, why: `“${r.heading}” reaches no enforcing surface` })),
  }),

  // L6 — actions have live handlers. The finding, when there is one, is a class
  // mark exposing a verb that nothing dispatches, so the CLASS MARK is what goes
  // red: only settled law may mint an affordance, and law that mints one nobody
  // implements is the failure this invariant watches for.
  //
  // Three shapes, three different silences, and they must not be confused. With
  // no apex verb registered the lint reports N/A and names no action at all —
  // a check that has never run against anything. With every action dispatching
  // it reports GREEN and names them all, handled. Only the third — an action
  // with `handled: false` — has anything to paint.
  L6: (rows) => {
    const named = rows.filter((r) => r.action != null);
    if (!named.length) return { paints: false, note: "the lint names no action — with no apex verb registered there is nothing to place on the graph, which is why the verdict is N/A rather than a vacuous pass." };
    const unhandled = named.filter((r) => r.handled === false);
    if (!unhandled.length) return { paints: false, note: `all ${named.length} exposed action(s) dispatch — nothing to paint.` };
    const nodes = [];
    for (const r of unhandled) {
      for (const mark of r.from ?? []) nodes.push({ id: mark, why: `exposes the action "${r.action}", and nothing in the running office dispatches it` });
    }
    return { nodes };
  },
};

// ── filtering ────────────────────────────────────────────────────────────────
//
// Applied to the BUILT payload rather than in SQL, for the same reason
// tools/world-gexf.mjs filters the loaded graph: dropping a node has to drop the
// edges that hung off it, and doing that once here beats doing it twice in two
// query shapes. `?kinds=` mirrors the gexf tool's flag exactly, so the two
// windows onto the same store take the same argument.

/** The payload, narrowed. `kinds`/`types` null means everything. */
export function filterPayload(payload, { kinds = null, types = null, dropUnresolved = false } = {}) {
  if (!kinds && !types && !dropUnresolved) return payload;
  const keepKind = kinds ? new Set(kinds) : null;
  const keepType = types ? new Set(types) : null;

  const nodes = payload.elements
    ? payload.elements.nodes
    : payload.nodes;                                        // tolerated for callers building by hand
  const kept = new Map();
  for (const n of nodes) {
    if (keepKind && !keepKind.has(n.data.kind)) continue;
    if (dropUnresolved && n.data.unresolved) continue;
    kept.set(n.data.id, n);
  }
  const edges = (payload.elements ? payload.elements.edges : payload.edges)
    .filter((e) => (!keepType || keepType.has(e.data.type)) && kept.has(e.data.source) && kept.has(e.data.target));

  // Every count is recomputed over what SURVIVED, including `positioned` and
  // `unresolved`. Carrying the whole graph's tallies into a narrowed view would
  // make the header disagree with the picture under it, which is the one thing
  // a window may never do.
  const byKind = {};
  let positioned = 0;
  let unresolved = 0;
  for (const n of kept.values()) {
    byKind[n.data.kind] = (byKind[n.data.kind] ?? 0) + 1;
    if (n.position) positioned++;
    if (n.data.unresolved) unresolved++;
  }
  const byType = {};
  for (const e of edges) byType[e.data.type] = (byType[e.data.type] ?? 0) + 1;

  return {
    ...payload,
    counts: { ...payload.counts, nodes: kept.size, edges: edges.length, by_kind: byKind, by_edge_type: byType, positioned, unresolved },
    filter: { kinds, types, drop_unresolved: dropUnresolved || null },
    elements: { nodes: [...kept.values()], edges },
  };
}

/**
 * The route's whole answer: the payload, filtered, with `elements` in the shape
 * `cytoscape({ elements })` takes directly.
 */
export function worldGraphView({ dbPath = null, kinds = null, types = null, dropUnresolved = false } = {}) {
  const base = worldGraphPayload(dbPath);
  if (base.error) return base;
  // The filter's output SHARES the cached element objects rather than cloning
  // them: nothing downstream writes to a payload, and cloning 700 nodes per
  // request to protect against a write nobody makes is a cost with no buyer.
  return filterPayload(base, { kinds, types, dropUnresolved });
}
