#!/usr/bin/env node
// world-shadow.mjs — the shadow parity harness. This is the gate: the office
// may not serve a world read from the store until this runs green.
//
//   node tools/world-shadow.mjs [--db world.db] [--json]
//
// §5.2 Stage 1: "office world reads behind a flag with the fold diffing beside
// it." The diff has to be computed by genuinely different means or the check is
// theatre, so each axis pits the STORE's derivation against the WORLD'S OWN
// ENGINE, imported live at the sha the store was hydrated from:
//
//   SPINE     store: walk up the `contains` edges the hydrator wrote from
//             DIRECTORY NESTING — what the tree CLAIMS.
//             engine: call the world's own `placementParent` for every geometric
//             mark and follow the resulting links — what the GEOMETRY SAYS,
//             computed by the very function the write path calls to choose a
//             directory. Imported, never reimplemented: a reimplementation
//             would drift from the placer and this would then be comparing the
//             store to itself.
//
//   FAN-UP    how much of the world hangs under each mark, computed from each
//             side's own parent links — so a spine that agrees but a weight that
//             does not is still caught.
//
//   GEOMETRY  every `contains` edge's stored geometry_ok recomputed with the
//             world's own `contains`. Catches a hydrator that wrote the right
//             edge with the wrong verdict on it.
//
// The engine is imported the way src/world.mjs imports it — from a subtree
// MATERIALISED AT A REF, never from the working tree, which is fetch-never-pull
// and routinely parked on a household's draft branch. The one difference is
// deliberate: world.mjs pins to freshest-main because it is serving now, and
// this pins to `meta.as_of_world` because it is auditing then. Same sha on both
// sides or the diff is measuring two worlds.
//
// `far:` marks are horizon objects, exempt from geometry by construction
// (decision 008). They are still checked; a difference is reported in its own
// section rather than counted, because the record claims no geometry for them.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { containmentSpine, materializeWorldAtSha } from "../src/world-store.mjs";
import { worldGraphForTool } from "../src/world-graph-snapshot.mjs";

const argOf = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
const JSON_OUT = process.argv.includes("--json");

if (process.argv.includes("--db")) { console.error("world.db is retired (POS-270 lane W 3b): the shadow reads --rows <file> (a hydration's --rows-out) or the store's snapshot; drop --db."); process.exit(2); }
// The store's snapshot (what the office reads), or a hydration's --rows.
const w = await worldGraphForTool({ rows: argOf("--rows", null) });
if (w.error) { console.error(`FATAL: no world graph: ${w.error}`); process.exit(2); }
const { graph, meta } = w.loaded;
const sha = meta.as_of_world;
if (!sha) { console.error("FATAL: the store carries no as_of_world — nothing to shadow against."); process.exit(2); }

const TREE = materializeWorldAtSha(meta.world_path, sha, ["WORLD", "tools"]);
const { loadMarks, placementParent, rect, contains, WORLD_ROOT_SLUG, worldRootOf } = await import(pathToFileURL(join(TREE, "tools", "marks-fold.mjs")));

// ── the engine side ──────────────────────────────────────────────────────────
const marks = loadMarks(join(TREE, "WORLD", "marks"));
const GEOMETRIC = (m) => m?.kind === "sited" || m?.kind === "parcel";
const isFar = (m) => m?.far === true || m?.far === "true";
// THE ROOT, BY NAME, NOT BY "HAS NO DIRECTORY PARENT" (the freeze, 2026-08-25).
// A mark filed at its id — `WORLD/marks/<by>/<slug>/` — has no mark.md above it
// either, so the old derivation picks whichever of them readdir reaches first
// and every spine below is measured against the wrong frame. The world root has
// a name; use it, and fall back to the old walk only if the fold stops
// exporting one.
const ROOT_ID = (typeof worldRootOf === "function" ? worldRootOf(marks)?.id : null)
  ?? (WORLD_ROOT_SLUG ? marks.find((m) => m.slug === WORLD_ROOT_SLUG)?.id : null)
  ?? marks.find((m) => !m._parentMarkId)?.id ?? null;
const byId = new Map(marks.map((m) => [m.id, m]));

const geometric = marks.filter((m) => GEOMETRIC(m) && m.at);
const engineParent = new Map();
for (const m of geometric) {
  if (m.id === ROOT_ID) { engineParent.set(m.id, null); continue; }
  engineParent.set(m.id, placementParent(m, marks.filter((x) => x.id !== m.id)) ?? ROOT_ID);
}
const engineSpine = (id) => {
  const spine = [];
  const seen = new Set([id]);
  for (let cur = id; ;) {
    const p = engineParent.has(cur) ? engineParent.get(cur) : null;
    if (p == null || seen.has(p)) break;
    spine.push(p); seen.add(p); cur = p;
  }
  return spine;
};

// ── axis 1: containment spines ───────────────────────────────────────────────
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const spineRows = geometric.map((m) => {
  const store = containmentSpine(graph, m.id);
  const engine = engineSpine(m.id);
  return { mark: m.id, far: isFar(m), store, engine, agree: same(store, engine) };
});
const checked = spineRows.filter((r) => !r.far);
const far = spineRows.filter((r) => r.far);
const spineDiffs = checked.filter((r) => !r.agree);
const farDiffs = far.filter((r) => !r.agree);

// ── axis 2: fan-up weights ───────────────────────────────────────────────────
const weigh = (parentOf) => {
  const w = new Map();
  for (const m of geometric) {
    const seen = new Set([m.id]);
    for (let cur = m.id; ;) {
      const p = parentOf(cur);
      if (p == null || seen.has(p)) break;
      w.set(p, (w.get(p) ?? 0) + 1);
      seen.add(p); cur = p;
    }
  }
  return w;
};
const wStore = weigh((id) => containmentSpine(graph, id)[0] ?? null);
const wEngine = weigh((id) => (engineParent.has(id) ? engineParent.get(id) : null));
const weightDiffs = [];
for (const id of new Set([...wStore.keys(), ...wEngine.keys()])) {
  const a = wStore.get(id) ?? 0, b = wEngine.get(id) ?? 0;
  if (a !== b) weightDiffs.push({ mark: id, store: a, engine: b });
}

// ── axis 3: the geometry verdict written on each edge ────────────────────────
const geometryDiffs = [];
let geometryChecked = 0;
graph.forEachEdge((_k, e, src, dst) => {
  if (e.type !== "contains" || e.props?.geometry_ok == null) return;
  const child = byId.get(dst);
  const parent = byId.get(e.props.geometry_via ?? src);
  if (!child || !parent) return;
  geometryChecked++;
  const recomputed = contains(rect(parent), rect(child));
  if (recomputed !== e.props.geometry_ok) geometryDiffs.push({ child: dst, parent: parent.id, stored: e.props.geometry_ok, engine: recomputed });
});

// ── verdict ──────────────────────────────────────────────────────────────────
const result = {
  as_of_world: sha, world_path: meta.world_path, tree: TREE,
  geometric_marks: geometric.length, spines_checked: checked.length, far_exempt: far.length,
  spine_diffs: spineDiffs.length, far_spine_diffs: farDiffs.length,
  fan_up_weight_diffs: weightDiffs.length,
  geometry_verdicts_checked: geometryChecked, geometry_verdict_diffs: geometryDiffs.length,
  verdict: spineDiffs.length || weightDiffs.length || geometryDiffs.length ? "MISMATCH" : "EMPTY DIFF",
  diffs: spineDiffs, far_diffs: farDiffs, weight_diffs: weightDiffs, geometry_diffs: geometryDiffs,
};

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`shadow parity · store vs the world's own engine, both at ${sha.slice(0, 12)}`);
  console.log(`  ${geometric.length} geometric marks · ${checked.length} spines checked · ${far.length} far (exempt by construction)`);
  console.log(`  containment spine   store(contains edges) vs engine(placementParent) — ${spineDiffs.length} disagreements`);
  console.log(`  fan-up weight       marks hanging under each — ${weightDiffs.length} disagreements`);
  console.log(`  geometry verdict    ${geometryChecked} contains edges rechecked with the engine's own contains() — ${geometryDiffs.length} disagreements`);
  for (const d of spineDiffs.slice(0, 20)) console.log(`    MISMATCH ${d.mark}\n      store:  ${d.store.join(" < ") || "(root)"}\n      engine: ${d.engine.join(" < ") || "(root)"}`);
  for (const d of weightDiffs.slice(0, 20)) console.log(`    WEIGHT ${d.mark}: store ${d.store} vs engine ${d.engine}`);
  for (const d of geometryDiffs.slice(0, 20)) console.log(`    GEOMETRY ${d.child} in ${d.parent}: stored ${d.stored} vs engine ${d.engine}`);
  if (farDiffs.length) {
    console.log(`  far marks whose spines differ (reported, not counted — the record claims no geometry for them):`);
    for (const d of farDiffs.slice(0, 20)) console.log(`    ${d.mark}: store ${d.store[0] ?? "(root)"} vs engine ${d.engine[0] ?? "(root)"}`);
  }
  console.log(`\n${result.verdict}`);
}

process.exit(result.verdict === "EMPTY DIFF" ? 0 : 1);
