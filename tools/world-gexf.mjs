#!/usr/bin/env node
// world-gexf.mjs — the ad-hoc window: the world store as a GEXF file that opens
// in Gephi Lite in a browser tab, zero build.
//
//   node tools/world-gexf.mjs                                   # everything
//   node tools/world-gexf.mjs --kinds mark,class,code,doctrine --out static.gexf
//
// Regenerated at the end of every hydration (src/world-hydrate.mjs calls
// exportGexf directly), so the picture can never drift behind the store it is a
// picture of. That is the whole reason this exports a function rather than only
// running as a script.
//
// Two decisions worth knowing before opening the file:
//
// POSITION. Marks carry real world coordinates, so they are written as viz
// positions and the file opens AS THE MAP — the town where the town is, Pando
// Peak 95 km down-left. Y is negated because the world's y runs SOUTH while
// GEXF/Gephi's runs up; without that the map opens mirrored. Nodes with no place
// in the world (code, doctrine, classes) get no position and Gephi Lite lays
// them out, which is honest: they are not anywhere.
//
// SIZE. Degree, sqrt-scaled. The degree spread is two orders of magnitude — the
// parcel class alone holds every parcel — and linear sizing turns the hubs into
// discs that cover the town.
//
// Every attribute written here is a scalar. `props` is a JSON object and is
// deliberately NOT written whole: GEXF has no object type, and a stringified
// blob per node would multiply the file for something no viewer can read. The
// fields worth filtering on are lifted out flat instead.

import { writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { write } from "graphology-gexf";
import { OFFICE_ROOT } from "../src/world-store.mjs";

const KIND_COLOR = {
  mark: "#4C6EF5", class: "#F59F00", code: "#12B886", doctrine: "#BE4BDB",
  entity: "#FA5252", emission: "#868E96", unknown: "#495057",
};

export function exportGexf({ loaded, out = join(OFFICE_ROOT, "world-graph.gexf"), kinds = null, dropUnresolved = false } = {}) {
  // `loaded`: a graph already built (the hydrator's rows, or the store's
  // snapshot). It is COPIED, because the filters below drop nodes and a caller's
  // graph must come back as it was handed over.
  if (!loaded?.graph) throw new Error("exportGexf needs a loaded graph: world.db is retired (POS-270 lane W 3b)");
  const { meta, counts } = loaded;
  const graph = loaded.graph.copy();

  // Filtering drops nodes, and an edge whose endpoint went with them has to go
  // too — Graphology's dropNode does that for us, which is exactly the wanted
  // behaviour and the reason to filter on the loaded graph rather than in SQL.
  if (kinds) {
    const keep = new Set(kinds);
    for (const id of graph.nodes()) if (!keep.has(graph.getNodeAttribute(id, "kind"))) graph.dropNode(id);
  }
  // The static view is the SETTLED surface: what the repo says, with the
  // placeholder ends of dangling edges taken out. The full view keeps them,
  // because a dangling edge is a finding and the window is where you go to see
  // findings. Until Stage 2 puts entities and emissions in the store these two
  // views differ only by those placeholders — that is the honest state of the
  // world today, not a bug in the filter.
  if (dropUnresolved) for (const id of graph.nodes()) if (graph.getNodeAttribute(id, "missing")) graph.dropNode(id);

  const xml = write(graph, {
    version: "1.2",
    formatNode: (key, attr) => {
      const degree = graph.degree(key);
      const viz = { size: 2 + Math.sqrt(degree) * 3, color: KIND_COLOR[attr.kind] ?? KIND_COLOR.unknown };
      if (attr.x != null && attr.y != null) { viz.x = attr.x; viz.y = -attr.y; }
      const p = attr.props ?? {};
      return {
        label: key, viz,
        attributes: {
          kind: attr.kind ?? "", subkind: attr.subkind ?? "", tier: attr.tier ?? "", by: attr.by ?? "",
          degree, in_degree: graph.inDegree(key), out_degree: graph.outDegree(key),
          at_x: attr.x ?? "", at_y: attr.y ?? "", extent_w: attr.w ?? "", extent_h: attr.h ?? "",
          path: p.path ?? "", date: p.date ?? "", mechanic: p.mechanic ?? "",
          unresolved: attr.missing === true,
        },
      };
    },
    formatEdge: (key, attr) => ({
      label: attr.type,
      attributes: {
        type: attr.type ?? "", born_at: attr.bornAt ?? "", via: attr.props?.via ?? "",
        geometry_ok: attr.props?.geometry_ok ?? "", placement_ok: attr.props?.placement_ok ?? "",
      },
      viz: { thickness: attr.type === "contains" ? 2 : 1 },
    }),
  });

  writeFileSync(out, xml);
  const byKind = {};
  graph.forEachNode((_id, a) => { byKind[a.kind] = (byKind[a.kind] ?? 0) + 1; });
  return {
    out, nodes: graph.order, edges: graph.size, bytes: statSync(out).size, by_kind: byKind,
    positioned: graph.filterNodes((_i, a) => a.x != null).length,
    as_of_world: meta.as_of_world ?? null, hydrator_nodes: counts.nodes_total ?? null,
  };
}

if (process.argv[1]?.endsWith("world-gexf.mjs")) {
  const argOf = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
  if (process.argv.includes("--db")) { console.error("world.db is retired (POS-270 lane W 3b): the gexf export reads --rows <file> (a hydration's --rows-out) or the store's snapshot; drop --db."); process.exit(2); }
  const { worldGraphForTool } = await import("../src/world-graph-snapshot.mjs");
  const w = await worldGraphForTool({ rows: argOf("--rows", null) });
  if (w.error) { console.error(`no world graph: ${w.error}`); process.exit(1); }
  const r = exportGexf({
    loaded: w.loaded,
    out: argOf("--out", join(OFFICE_ROOT, "world-graph.gexf")),
    kinds: argOf("--kinds", null)?.split(",").map((s) => s.trim()) ?? null,
    dropUnresolved: process.argv.includes("--drop-unresolved"),
  });
  console.log(`wrote ${r.out}`);
  console.log(`  ${r.nodes} nodes / ${r.edges} edges ${JSON.stringify(r.by_kind)}`);
  console.log(`  ${(r.bytes / 1024).toFixed(1)} KiB · GEXF 1.2 · as_of world ${(r.as_of_world ?? "?").slice(0, 12)}`);
  console.log(`  positioned by world coordinates: ${r.positioned} nodes (y negated — the world's y runs south)`);
}
