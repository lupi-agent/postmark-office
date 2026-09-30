#!/usr/bin/env node
// world-lints.mjs — the eight standing invariants of the town, run as queries
// over the Graphology runtime at the end of every hydration and written into
// lint_findings, where the delta between runs is the alert surface.
//
// The questions are not this file's to invent, and §2.10 — which this header
// pointed at, for six of them — resolves to nothing: WORLD/ENGINE.md carries
// no numbered sections at all. They are constitutional marks now: the
// postmark-invariant family under
// WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/, one class
// per invariant, each carrying dials {"lint": "Lx"}, a one-claim body, and a
// mechanic child naming THIS module. The family's own words:
//
//   "The standing questions: each invariant is a class here, its mechanic
//    naming the code that asks it — a question no code asks is not being asked."
//
// and the abstraction they instantiate, logos/the-invariant:
//
//   "An invariant is a standing question the town asks of itself at every fold
//    — it reports, never repairs, and names its method and its limits."
//
// So every finding here CITES the law it enforces: `law` is the mark id,
// `law_text` is that mark's one claim VERBATIM. A finding that quotes its law
// can be held against the law; a finding that quotes a section number cannot.
// L0 keeps the citation honest — it reads the eight marks' own dials off the
// world tree and goes RED on a drifted pairing rather than skipping quietly.
// As of 2026-08-23 the last §2.10 pointers are gone from the store, the
// hydrator and this file: each is re-anchored to the invariant it was really
// reaching for. This header's own mention above is the record of what they said.
//
//   node src/world-lints.mjs            # human report, from the built store
//   node src/world-lints.mjs --json     # machine rows
//
// The rule that shapes this file, same as the hydrator's: a lint REPORTS, it
// never repairs, and it never launders a red into a green by narrowing its own
// question. Each states the METHOD that produced its verdict, the LIMITS of
// that method, and evidence a human can go check. A lint that hides its noise
// floor is a lint nobody can trust.
//
// L2 is the one that changed at Stage 1, and it is the reason geometry_versions
// exists: it judges each departure against the stop geometry OF THAT INSTANT,
// not against today's. The spike watched a re-siting turn a 22 m near-miss into
// a 1238 m gross error without anything about the departure changing — a lint
// that re-decides history every time the world is rearranged is a lint that
// will read more and more of the past as broken.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadWorldGraph, geometryIndex, geometryAsOf, rectOfVersion, reachable, out, inbound, nodesWhere, isClassMark, actionEntriesOf, DEFAULT_DB } from "./world-store.mjs";

const RED = "RED", GREEN = "GREEN", NA = "N/A";

// THE PARCEL CLASS'S REAL ID, named once here because L3 and L4 both key on it
// and both used to key on a node that no longer exists. The step-1 promotion
// (2026-08-18) retired the synthesized `the-town/parcel-class` — src/world-
// hydrate.mjs:866-873, which names the same id in its own `PARCEL_CLASS` — and
// the works' `the-town/parcel` mark has been the declaration ever since. Two
// lints silently keying on a headstone is precisely the failure L3 exists to
// name, so the name lives in one place here for the same reason
// STRIDE_CLASS_NAME does in world-classes.mjs: the next rename fails a test
// instead of failing the town.
const PARCEL_CLASS = "the-town/parcel";

// Where the parcel's extent actually lives. It is a DIAL on the class mark
// (`dials: {"extent_m": 25}`), not a geometry column: a class mark has no
// at/extent of its own, so `attr.w` on it is null and any `?? 25` beside it is
// a hardcoded answer wearing a lookup's clothes.
const PARCEL_EXTENT_SLOT = "extent_m";
const parcelExtent = (graph) => {
  if (!graph.hasNode(PARCEL_CLASS)) return { value: null, why: `${PARCEL_CLASS} is not in the graph` };
  const d = graph.getNodeAttributes(PARCEL_CLASS)?.props?.dials?.[PARCEL_EXTENT_SLOT];
  return Number.isFinite(Number(d))
    ? { value: Number(d), why: null }
    : { value: null, why: `${PARCEL_CLASS} declares no numeric ${PARCEL_EXTENT_SLOT} dial` };
};

// ── the law each question enforces ───────────────────────────────────────────
// The eight id↔Lx pairs, taken from the marks' own `dials: {"lint": "Lx"}`, and
// the eight bodies quoted verbatim. This table is a COPY of law that lives
// elsewhere, which is exactly the shape L3 exists to distrust — so it is not
// left on trust: `readLawPairing` below reads the marks back off the world tree
// and L0 goes red the moment this table and the marks disagree.
//
// `slug` is the mark's directory under LAW_ROOT and its class name; `id` is the
// mark id the store addresses it by (author `the-town` + slug).
export const LAW = {
  L0: {
    slug: "the-readable-inputs",
    id: "the-town/the-readable-inputs",
    text: "A reading that cannot read its own inputs says so, loud — a lint that hides its noise floor is a lint nobody can trust.",
  },
  L1: {
    slug: "the-reaching-mechanic",
    id: "the-town/the-reaching-mechanic",
    text: "Every mechanic names running code and the name resolves — a rule whose mechanic reaches nothing is ink.",
  },
  L2: {
    slug: "the-unmoved-past",
    id: "the-town/the-unmoved-past",
    text: "A departure is judged against the stop geometry of its own instant — rearranging the world never makes the past late.",
  },
  L3: {
    slug: "the-owned-constants",
    id: "the-town/the-owned-constants",
    text: "Every constant in the machinery is owned by a dial or a law — an orphan number is a rule nobody declared.",
  },
  L4: {
    slug: "the-conforming-instance",
    id: "the-town/the-conforming-instance",
    text: "Every instance conforms to its class — the contract is read against every record, never assumed.",
  },
  L5: {
    slug: "the-consulted-doctrine",
    id: "the-town/the-consulted-doctrine",
    text: "Every doctrine rule reaches an enforcing surface — a rule living only in prose no machine reads is a wish.",
  },
  L6: {
    slug: "the-live-handler",
    id: "the-town/the-live-handler",
    text: "Every exposed action has a live handler — a grant with no room is the town asking for one.",
  },
  L7: {
    slug: "the-classed-mark",
    id: "the-town/the-classed-mark",
    text: "Every mark is an instance of a class — an unclassed mark stands outside the law's address.",
  },
};

/** Where the family stands in a world clone. One path, eight directories. */
export const LAW_ROOT = "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/postmark-invariant";

/**
 * Hold the LAW table above against the marks themselves.
 *
 * For each entry: open the mark, read the `lint` dial out of its frontmatter and
 * the one-claim body out of the rest, and report any place where the code's
 * pairing or the code's quote no longer matches what the town wrote. It reports;
 * it never rewrites the table.
 *
 * A tree we cannot reach is `unavailable`, not drift — L0 already says loudly
 * when it cannot read its inputs, and a missing clone must not be dressed up as
 * a constitutional disagreement. A tree we CAN reach that is missing a mark, or
 * carries a different dial, or carries a different claim, is drift.
 */
export function readLawPairing(treePath, law = LAW) {
  const root = treePath ? join(treePath, ...LAW_ROOT.split("/")) : null;
  if (!root || !existsSync(root)) return { status: "unavailable", root, checked: 0, drift: [] };
  const drift = [];
  let checked = 0;
  for (const [lint, entry] of Object.entries(law)) {
    const file = join(root, entry.slug, "mark.md");
    if (!existsSync(file)) { drift.push({ lint, slug: entry.slug, why: "no mark", expected: lint, found: null, at: `${LAW_ROOT}/${entry.slug}/mark.md` }); continue; }
    const text = readFileSync(file, "utf8");
    checked++;
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    // Line endings are the checkout's business, never the law's: a clone with
    // autocrlf on must not read as a rewritten claim.
    const body = text.slice(front ? front[0].length : 0).replace(/\r\n/g, "\n").trim();
    const dials = front ? /^dials:\s*(.*)$/m.exec(front[1]) : null;
    const found = dials ? (/"lint"\s*:\s*"([^"]*)"/.exec(dials[1])?.[1] ?? null) : null;
    if (found !== lint) drift.push({ lint, slug: entry.slug, why: "dial mismatch", expected: lint, found, at: `${LAW_ROOT}/${entry.slug}/mark.md` });
    if (body !== entry.text) drift.push({ lint, slug: entry.slug, why: "claim mismatch", expected: entry.text, found: body || null, at: `${LAW_ROOT}/${entry.slug}/mark.md` });
  }
  return { status: "read", root, checked, drift };
}

/**
 * Run every standing invariant over a built store.
 *
 * `sources` (nodeId -> text) and `engineText` are passed in by the hydrator,
 * which has already read them; standalone runs re-read from the paths in meta
 * and DISCLOSE if a path has gone (the materialised tree lives in a temp cache
 * and a machine may have swept it).
 */
export async function runLints({ dbPath = DEFAULT_DB, store: loaded = null, sources = null, engineText = null, treePath = null } = {}) {
  // `store`: a graph already loaded, from world.db or from the store's snapshot
  // of it (src/world-graph-snapshot.mjs, POS-270); the lints read it the same way.
  const store = loaded ?? loadWorldGraph(dbPath);
  const { graph, meta, events, geometryVersions } = store;
  // The world's OWN pointInRect, imported live from the tree the store was
  // hydrated from, so "inside a stop" can never drift from how the world itself
  // measures containment.
  const { pointInRect } = await import(pathToFileURL(join(treePath ?? meta.world_tree_path, "tools", "geometry.mjs")));

  // ── source access ──────────────────────────────────────────────────────────
  const OFFICE = meta.office_path || "";
  const TREE = treePath ?? meta.world_tree_path ?? "";
  const absOf = (attr) => {
    const p = attr.props?.path ?? "";
    if (p.startsWith("office/")) return join(OFFICE, p.slice("office/".length));
    if (p.startsWith("world/")) return join(TREE, p.slice("world/".length));
    return null;
  };
  const unreadable = [];
  const sourceOf = (() => {
    const cache = new Map();
    return (id) => {
      if (sources?.has(id)) return sources.get(id);
      if (cache.has(id)) return cache.get(id);
      const attr = graph.hasNode(id) ? graph.getNodeAttributes(id) : null;
      const abs = attr && attr.kind === "code" && attr.subkind !== "world-surface" ? absOf(attr) : null;
      const text = abs && existsSync(abs) ? readFileSync(abs, "utf8") : null;
      if (abs && text == null) unreadable.push(abs);
      cache.set(id, text);
      return text;
    };
  })();
  const engine = engineText ?? (TREE && existsSync(join(TREE, "WORLD", "ENGINE.md")) ? readFileSync(join(TREE, "WORLD", "ENGINE.md"), "utf8") : null);
  const codeNodes = nodesWhere(graph, (a) => a.kind === "code" && a.subkind !== "world-surface" && !a.missing);

  // The running surface: what the live office actually loads. `imports` is
  // static linkage; `reads` carries the office's DYNAMIC imports into the world
  // clone's tools (engineImport / import(join(dir,"tools",…))), which is the
  // only way world code ever runs in production. Both, or the traversal would
  // declare every world tool dead.
  const SERVER = "code:office/src/server.mjs";
  const RUNNING = reachable(graph, SERVER, ["imports", "reads"]);
  const isRunning = (id) => RUNNING.has(id);

  const lints = [];
  // Every finding leaves this door carrying the mark it enforces and that mark's
  // claim, verbatim. No lint states its own law inline: the citation is attached
  // here, from the one table, so a lint and its law cannot drift apart file by
  // file.
  const add = (l) => { const cited = { ...l, law: LAW[l.id]?.id ?? null, law_text: LAW[l.id]?.text ?? null }; lints.push(cited); return cited; };

  // ── L1 · every `mechanic:` reaches running code ───────────────────────────
  // The chain: a mark carries `mechanic: x` -> implements -> the class node for
  // x -> the module that keeps x true -> that module is loaded by the running
  // office. The store has no mechanic->code edge because nothing in the repo
  // declares one (skeleton.json carries an honored flag and a receipt, not a
  // path), so the last hop is DERIVED by two signals of very different strength:
  //   (a) DECLARATION — the ENGINE.md section whose heading names the mechanic,
  //       read for the tools/*.mjs or src/*.mjs path literals inside it. Where
  //       it exists it is the answer.
  //   (b) NAME — modules merely mentioning the mechanic id at a word boundary.
  //       NOT evidence: the spike's first pass let one comment about
  //       off-timetable ferry catch-up runs turn the known-red timetable GREEN.
  //       Name hits are context only and can never produce a green.
  //
  // TIGHTENED 2026-08-23 (Keemin): the verdict is PER NAME. It used to go red
  // only when a mechanic declared a module the office never loads, or when
  // EVERY mark-carried mechanic was underivable — so one derivable-and-running
  // mechanic among six that reach nothing read as GREEN. The mark does not
  // grade on a curve: "Every mechanic names running code and the name resolves
  // — a rule whose mechanic reaches nothing is ink." Each name that reaches
  // nothing is its own piece of ink, and one that reaches is no defence for the
  // rest.
  {
    const engineLines = engine ? engine.split(/\r?\n/) : [];
    const sectionText = (startLine) => {
      const i = startLine - 1;
      let end = engineLines.length;
      for (let j = i + 1; j < engineLines.length; j++) if (/^##\s+/.test(engineLines[j])) { end = j; break; }
      return engineLines.slice(i, end).join("\n");
    };
    const MODULE_RE = /`?\b((?:tools|src)\/[A-Za-z0-9._-]+\.mjs)\b`?/g;
    const toNode = (p) => (p.startsWith("tools/") ? `code:world/${p}` : `code:office/${p}`);

    const mechanics = nodesWhere(graph, (a) => a.kind === "class" && a.subkind === "mechanic");
    const rows = [];
    for (const { id, attr } of mechanics) {
      const carriers = inbound(graph, id, "implements").map((e) => e.src);
      if (!carriers.length) { rows.push({ mechanic: attr.props.mechanic, carried_by: [], verdict: "unclaimed", declared_modules: [], declared_running: [] }); continue; }

      const doctrineClaims = new Set();
      for (const { src } of inbound(graph, id, "describes")) {
        const d = graph.getNodeAttributes(src);
        if (d.kind !== "doctrine") continue;
        const body = sectionText(d.props.line);
        MODULE_RE.lastIndex = 0;
        let m;
        while ((m = MODULE_RE.exec(body))) doctrineClaims.add(toNode(m[1]));
      }
      const word = new RegExp(`\\b${attr.props.mechanic}\\b`, "i");
      const nameHits = codeNodes.filter((c) => c.attr.subkind !== "test").filter((c) => word.test(sourceOf(c.id) ?? "")).map((c) => c.id);

      const declared = [...doctrineClaims].filter((c) => graph.hasNode(c));
      const declaredRunning = declared.filter(isRunning);
      rows.push({
        mechanic: attr.props.mechanic, honored: attr.props.honored, carried_by: carriers,
        declared_modules: declared, declared_running: declaredRunning,
        name_hit_modules: nameHits, name_hits_running: nameHits.filter(isRunning),
        verdict: declared.length ? (declaredRunning.length ? GREEN : RED) : "UNDERIVABLE",
      });
    }
    const claimed = rows.filter((r) => r.carried_by.length);
    const broken = claimed.filter((r) => r.verdict === RED);
    const underivable = claimed.filter((r) => r.verdict === "UNDERIVABLE");
    // Per name: a mechanic reaches running declared code, or it does not. Both
    // ways of not reaching — declaring a module nobody loads, and declaring no
    // module at all — leave the same hole where running code was promised.
    const unreached = claimed.filter((r) => r.verdict !== GREEN);
    add({
      id: "L1", name: "every `mechanic:` reaches running code",
      verdict: unreached.length ? RED : GREEN,
      headline: unreached.length
        ? `${unreached.length} of ${claimed.length} mark-carried mechanics reach no running declared code — ` + [
            broken.length ? `${broken.length} declare an implementing module the running office never loads (${broken.map((b) => b.mechanic).join(", ")})` : null,
            underivable.length ? `${underivable.length} declare no implementing module at all (${underivable.map((u) => u.mechanic).join(", ")})` : null,
          ].filter(Boolean).join("; ")
        : `all ${claimed.length} mark-carried mechanics reach a running declared module`,
      method: "mark -> implements -> mechanic class -> implementing module -> reachable from office/src/server.mjs over imports+reads (reads carries the office's dynamic imports into the world clone's tools). The implementing module is taken from the ENGINE.md section that names the mechanic — the town's own declaration. Word-boundary name hits in source are reported as context and cannot produce a green. The verdict is PER NAME: every mechanic that reaches no running declared module is red on its own, and a sibling that reaches does not cover for it.",
      limits: "The mechanic->code hop is DERIVED because nothing declares it: skeleton.json's physics_registry carries an honored flag and a receipt, no path. Exactly one mechanic (timetable) has an ENGINE.md section naming its module, so most rows are UNDERIVABLE — and since 2026-08-23 that is a RED per name rather than a reported aside, which is why the red count here reads high: the town is asking for the declarations, not reporting a new breakage. The right fix is an implementing-module field on the registry, at which point this becomes a pure edge query and the underivable rows resolve one way or the other. Mechanics no mark carries are listed as `unclaimed` and are not ruled on: this question is about rules whose mechanic reaches nothing, and an unclaimed mechanic is no rule's.",
      rows,
      evidence: [
        ...broken.map((b) => {
          const importers = b.declared_modules.flatMap((m) => inbound(graph, m, "imports").concat(inbound(graph, m, "reads")).map((e) => e.src.replace("code:", "")));
          return `${b.mechanic}: declared by ENGINE.md as ${b.declared_modules.map((m) => m.replace("code:", "")).join(", ")}; carried by ${b.carried_by.join(", ")}; NOT reachable from server.mjs — everything that imports it: ${[...new Set(importers)].join(", ") || "(nothing)"}`;
        }),
        ...underivable.map((u) =>
          `${u.mechanic}: carried by ${u.carried_by.join(", ")}; no ENGINE.md section names an implementing module for it, so nothing declares where it runs${u.name_hits_running?.length ? ` — modules merely NAMING it that are running: ${u.name_hits_running.map((m) => m.replace("code:", "")).join(", ")} (context, never a green)` : ""}`),
      ],
    });
  }

  // ── L2 · timetable stops vs observed departures, AT EACH DEPARTURE'S INSTANT ─
  // The wheelhouse declares stops BY MARK ID and never copies coordinates
  // (SCHEMA.md), so the schedule's truth is the stop marks' own geometry — and
  // "the stop marks' own geometry" is a question with a tense. A departure is
  // judged against the version of each stop that stood when the vessel cast off,
  // read from geometry_versions. The same test against today's geometry is run
  // alongside and reported, because the DIFFERENCE between the two is the
  // clearest statement of what a re-siting did to the past.
  {
    const gIndex = geometryIndex(geometryVersions);
    const services = nodesWhere(graph, (a) => a.kind === "mark" && a.props?.timetable);
    const rows = [];
    for (const { id, attr } of services) {
      const declared = [];
      graph.forEachEdge((_k, e, src, dst) => {
        if (e.type === "stop-of" && e.props.declared_by === id) {
          const a = graph.hasNode(src) ? graph.getNodeAttributes(src) : null;
          declared.push({
            stop: src, vessel: dst, order: e.props.order, departs: e.props.departs, resolves: e.props.src_resolves,
            current_rect: a && a.x != null ? { x: a.x, y: a.y, w: a.w ?? 1, h: a.h ?? 1 } : null,
            versions: (gIndex.get(src) ?? []).length,
          });
        }
      });
      declared.sort((a, b) => a.order - b.order);

      const vessel = attr.props.timetable.vessel;
      const actor = String(vessel ?? "").split("/").pop();   // the ledger names walkers by handle; a vessel's handle is its leaf slug
      const obs = events.filter((e) => e.actor === actor && e.type === "departure").sort((a, b) => (a.at < b.at ? 1 : -1));

      // A vessel departs from a BERTH, not a point: the test is whether the
      // recorded `from` lies inside a stop's own footprint, using the repo's own
      // pointInRect so this cannot drift from how the world measures
      // containment. Centre distance rides along because "22 m outside the
      // landing" and "1216 m up the hill" are different findings and a bare
      // boolean hides it.
      const judge = (from, rectOf) => {
        let inside = null, nearest = null;
        for (const s of declared) {
          const r = rectOf(s);
          if (!r) continue;
          const d = Math.hypot(from.x - r.x, from.y - r.y);
          if (!nearest || d < nearest.d) nearest = { d, stop: s.stop, rect: r };
          if (!inside && pointInRect(from.x, from.y, r)) inside = s.stop;
        }
        return { departed_from: inside, nearest: nearest?.stop ?? null, centre_off_by_m: nearest ? Math.round(nearest.d) : null, on_schedule: inside != null };
      };

      const checked = obs.map((e) => {
        const asOfRects = new Map();
        const geometryRead = [];
        for (const s of declared) {
          const g = geometryAsOf(gIndex, s.stop, e.at);
          asOfRects.set(s.stop, rectOfVersion(g.version));
          geometryRead.push({ stop: s.stop, status: g.status, sha: g.version?.sha?.slice(0, 12) ?? null,
            valid_from: g.version?.valid_from_iso ?? null, change: g.version?.change ?? null,
            at: g.version ? [g.version.at_x, g.version.at_y] : null });
        }
        const asOf = judge(e.payload.from, (s) => asOfRects.get(s.stop));
        const current = judge(e.payload.from, (s) => s.current_rect);
        return {
          at: e.at, from: e.payload.from, to: e.payload.to, line: e.payload.line_no,
          ...asOf, stop_geometry_as_of: geometryRead, current,
          tense_changed: asOf.on_schedule !== current.on_schedule || asOf.centre_off_by_m !== current.centre_off_by_m,
        };
      });
      rows.push({
        service: id, vessel, actor, stops: declared, departures: checked,
        off_schedule: checked.filter((c) => !c.on_schedule).length,
        off_schedule_by_current_geometry: checked.filter((c) => !c.current.on_schedule).length,
        verdict: checked.some((c) => !c.on_schedule) ? RED : GREEN,
      });
    }
    const all = rows.flatMap((r) => r.departures);
    const bad = all.filter((d) => !d.on_schedule);
    const moved = all.filter((d) => d.tense_changed);
    const unresolvedStops = rows.flatMap((r) => r.stops.filter((s) => !s.resolves).map((s) => s.stop));
    add({
      id: "L2", name: "every timetable stop resolves and matches observed departures (judged at each departure's own instant)",
      verdict: bad.length || unresolvedStops.length ? RED : GREEN,
      headline: bad.length
        ? `${bad.length} of ${all.length} recorded departures left from outside every stop's footprint AS IT STOOD AT THAT INSTANT` +
          (moved.length ? ` — and ${moved.length} would read differently against today's geometry (the tense the versioned table removes)` : "")
        : `every recorded departure left from inside a stop as that stop stood at the time` + (moved.length ? ` — ${moved.length} of them would read as off-schedule against today's geometry` : ""),
      method: "timetable-carrying mark -> stop-of edges -> each stop's geometry AS OF the departure instant, read from geometry_versions (coordinates are never copied into a schedule, so the stop marks ARE the schedule's geometry, and their geometry has a tense). A departure is on-schedule if its `from` point lies inside a stop's footprint of that instant, tested with the world's own tools/geometry.mjs pointInRect. The same test against today's geometry is computed alongside and reported as `current`.",
      limits: "Departure ORIGIN only: it does not check the CLOCK (whether a departure happened at a scheduled time) nor whether the destination is the next stop in order. Actor matching assumes the vessel's handle is its mark's leaf slug, which is how the ledger writes it today. geometry_versions carries the SETTLED clock — a version begins when its commit landed — so a ruling that means to legalise something retroactively still shows the past as it was recorded at the time; an effective-from field on the record is the only thing that could change that.",
      rows,
      evidence: [
        ...bad.map((d) => `${d.at}: from ${d.from.x},${d.from.y} toward ${d.to ?? "?"} (walk-ledger line ${d.line}) — outside every stop as it stood then; nearest ${d.nearest} centre ${d.centre_off_by_m} m away`),
        ...moved.map((d) => `TENSE: ${d.at} reads ${d.on_schedule ? "on schedule" : `${d.centre_off_by_m} m off`} against the geometry of its own instant, and ${d.current.on_schedule ? "on schedule" : `${d.current.centre_off_by_m} m off`} against today's — the departure never moved; the yardstick did`),
        ...rows.flatMap((r) => r.stops.map((s) => `declared stop ${s.order}: ${s.stop} departing ${(s.departs ?? []).join("/")} · ${s.versions} geometry version(s) on record`)),
      ],
    });
  }

  // ── L3 · no orphan constants ──────────────────────────────────────────────
  // A class constant lives in exactly one place by law. A literal equal to it in
  // a file with no link to the owner is a copy waiting to drift — the proposal
  // names the pace-405 triplication as the wound. This is a TEXT SCAN, not a
  // graph query, and its noise floor is printed with its result.
  {
    const SELF = "code:office/src/world-lints.mjs";
    const CONSTS = [
      { key: "pace 405 (the vessel's dial)", value: 405, owner: "the-town/the-wheelhouse", export: null, definer: null, context: /\b(pace|km|crossing|vessel|timetable|stops?)\b/i },
      // THE OWNER IS `the-town/parcel`, NOT `the-town/parcel-class`. The latter
      // was the synthesized node the step-1 promotion retired on 2026-08-18 —
      // src/world-hydrate.mjs:866-873 says so and repoints every parcel
      // instance at the real declaration — and it has not existed in the graph
      // since. `ownerDir` therefore returned null here, `readsOwner` could
      // never fire, and this row's absolution-by-owner was dead code pointing
      // at a headstone. Verified rather than assumed: `the-town/parcel-class`
      // has zero occurrences anywhere in the world repo.
      { key: "parcel dial 25 (25x25)", value: 25, owner: PARCEL_CLASS, export: "PARCEL_EXTENT_M", definer: "code:world/tools/marks-fold.mjs", context: /\b(parcel|extent|dial|w|h)\b/i },
      { key: "walking pace 15 (km per crossing)", value: 15, owner: "the-town/the-walking-pace", export: null, definer: null, context: /\b(pace|km|crossing|walk)\b/i },
    ];
    const ownerDir = (id) => (graph.hasNode(id) ? (graph.getNodeAttributes(id).props?.path ?? null) : null);
    const rows = [];
    for (const c of CONSTS) {
      const dir = ownerDir(c.owner);
      const hits = [];
      for (const { id } of codeNodes) {
        const text = sourceOf(id);
        if (!text) continue;
        const re = new RegExp(`(?<![\\w.])${c.value}(?![\\w.])`, "g");
        const found = [];
        text.split(/\r?\n/).forEach((ln, i) => { re.lastIndex = 0; if (re.test(ln)) found.push({ line: i + 1, text: ln.trim().slice(0, 140) }); });
        if (!found.length) continue;
        const defines = c.definer === id;
        const importsDefiner = c.definer ? out(graph, id, "imports").some((e) => e.dst === c.definer) : false;
        const namesExport = c.export ? new RegExp(`\\b${c.export}\\b`).test(text) : false;
        const readsOwner = dir ? out(graph, id, "reads").some((e) => String(e.attr.props?.path ?? "").startsWith(dir)) : false;
        const absolved = defines || (importsDefiner && namesExport) || readsOwner;
        hits.push({ file: id, occurrences: found.length, absolved, plausible: found.some((f) => c.context.test(f.text)),
          // This module's own watch list carries every literal it watches for.
          // That is a true hit by the lint's own definition — the table IS a
          // copy of the constant — so it is marked rather than excluded. A lint
          // that exempted itself would be laundering the one file it can see.
          is_watchlist: id === SELF,
          why: defines ? "defines it" : importsDefiner && namesExport ? `imports ${c.export}` : readsOwner ? "reads the owning mark" : null, lines: found });
      }
      const orphans = hits.filter((h) => !h.absolved);
      rows.push({ ...c, context: String(c.context), owner_path: dir, files_with_literal: hits.length,
        orphan_files: orphans.length, orphan_files_in_context: orphans.filter((h) => h.plausible).length,
        orphan_occurrences: orphans.reduce((n, h) => n + h.occurrences, 0), hits });
    }
    const totalOrphans = rows.reduce((n, r) => n + r.orphan_files, 0);
    const inContext = rows.reduce((n, r) => n + r.orphan_files_in_context, 0);

    // ── THE OTHER DIRECTION: a dial that owns nothing ──────────────────────
    //
    // Everything above asks CODE -> DIAL: is this literal in the machinery
    // owned by a declaration? The mark's own words are wider than that —
    //
    //   "Every constant in the machinery is owned by a dial or a law — an
    //    orphan number is a rule nobody declared."
    //
    // — and the inverse failure is the one the 2026-08-29 audit actually kept
    // finding: a number DECLARED in the constitution that no engine reads. The
    // walk pace stood in three nodes and was read from one; `ends_turn` stood
    // on five marks and was read by none; `declare-stance-on` ran on two live
    // constants no dial declared at all. None of those could be seen from
    // here, because the watch list was three constants long and hand-written —
    // a falsifier whose question was smaller than its law.
    //
    // So this half iterates the RECORD instead of a list: every value-carrying
    // constitutional node in the Works, asking of each dial whether the engine
    // names it, or whether the mark says out loud that nothing does yet. A
    // dial that is neither read nor flagged is the finding — the town
    // declaring a number it does not use and not saying so.
    //
    // It rules on names, not values, and that is deliberate: a dial is reached
    // by name (`dialNumber(CLASS, "earshot_m", …)`), so the name is the join
    // between a declaration and its reader. The limits of that are stated
    // below rather than discovered later.
    const nameVariants = (slot) => {
      const s = String(slot);
      return [...new Set([s, s.replace(/-/g, "_"), s.replace(/_/g, "-")])];
    };
    // A declared value the engine could read. Strings are excluded on purpose:
    // `unsealed` and the pointer form (`"the-town/resident"`) are the record's
    // two ways of saying "the value is not here", and asking whether the engine
    // reads a signpost would report every correctly-delegated dial as an orphan.
    const isValue = (v) => typeof v === "number" || typeof v === "boolean";
    const FLAG = /aspirational|unbuilt|no reader|nothing reads|not yet read|awaits|ahead of (its |the )?wiring/i;

    // STANDING IS READ FROM THE FILING, NOT FROM THE FOLD. `props.in_works` is
    // stamped from `WORLD/containment.json` — a DERIVED record, regenerated at
    // a crossing — so a mark planted since the last fold carries `in_works:
    // false` and is invisible to every gate that trusts it. Verified, not
    // assumed: the two dials planted on `declare-stance-on` this same day come
    // back `in_works=false` while their sibling `the-town/earshot-m` comes back
    // true, on identical filing. A question about whether the constitution's
    // numbers are read must not go blind to the newest ones — that is the shape
    // of the bug this whole lint exists to name — so the mark's own directory
    // is the authority here, and it cannot be stale.
    //
    // ⚠ WORTH A SEPARATE RULING: `standsInTheWorks` (world-store.mjs:190)
    // forgives `in_works == null` but not `in_works === false`, so the same
    // staleness reaches isClassMark and every lint keyed on it. Named here
    // rather than fixed here.
    const inTheWorks = (a) => a.props?.in_works === true
      || String(a.props?.path ?? "").includes("/the-keeping-works/");

    const declared = [];
    for (const { id, attr } of nodesWhere(graph, (a) =>
      a.kind === "mark" && a.by === "the-town" && a.tier === "constitution" && inTheWorks(a))) {
      const p = attr.props ?? {};
      const pairs = [];
      if (p.dials && typeof p.dials === "object" && !Array.isArray(p.dials))
        for (const [k, v] of Object.entries(p.dials)) if (isValue(v)) pairs.push([k, v]);
      if (p.slot != null && isValue(p.value)) pairs.push([p.slot, p.value]);
      if (!pairs.length) continue;

      // The mark's own disclosure — the `voices.mjs` standard the Works holds
      // up: keep the unread thing if you must, and SAY SO.
      const says = `${Array.isArray(p.implements) ? p.implements.join(" ") : String(p.implements ?? "")} ${p.body ?? ""}`;
      for (const [slot, value] of pairs) {
        const names = nameVariants(slot);
        const readers = [];
        for (const { id: cid } of codeNodes) {
          // A FALSIFIER IS NOT A READER, and this exclusion is the difference
          // between this half working and this half lying. The world's own
          // suite quotes dials constantly — tools/reached-grants.test.mjs and
          // tools/reached-grants-flips.mjs both name `ends_turn` — so counting
          // them made all five `ends_turn` declarations read as READ while the
          // audit's `grep -rn ends_turn src/` returned zero. A dial whose only
          // mention is in the test asserting it exists is the exact orphan this
          // question is asking after, and it would have been laundered green by
          // the very test written to catch it.
          if (/\.test\.mjs$|-flips\.mjs$|fixture/i.test(cid)) continue;
          // AND NEITHER IS THIS LINT. Asking the question puts every dial name
          // it discusses into its own source, so without this the module reads
          // as the reader of everything it reports on — `ends_turn` came back
          // READ off nothing but the comment above. Note the asymmetry with the
          // code->dial half, which deliberately does NOT exempt itself: there,
          // this file genuinely holds copies of the constants it watches and
          // says so (`is_watchlist`). Here it holds only their names, and a
          // name in a lint is not a reading in an engine — L4 reads
          // `dials.extent_m` one screen up, and that is a lint checking a
          // contract, not the town running on it.
          if (cid === SELF) continue;
          const text = sourceOf(cid);
          if (!text) continue;
          if (names.some((n) => new RegExp(`(?<![\\w])${n}(?![\\w])`, "i").test(text))) readers.push(cid);
        }
        // Flagged only if the disclosure names THIS dial: a blanket
        // "aspirational" somewhere on a mark must not launder its other dials.
        const flagged = names.some((n) => new RegExp(`(?<![\\w])${n}(?![\\w])`, "i").test(says)) && FLAG.test(says);
        declared.push({
          mark: id, slot, value, path: p.path ?? null,
          readers: readers.length, read_by: readers.slice(0, 4).map((c) => c.replace("code:", "")),
          flagged_aspirational: flagged,
          verdict: readers.length ? "read" : flagged ? "flagged" : "orphan",
        });
      }
    }
    const undeclaredReaders = declared.filter((d) => d.verdict === "orphan");
    add({
      id: "L3", name: "no orphan constants",
      verdict: totalOrphans || undeclaredReaders.length ? RED : GREEN,
      headline: `${totalOrphans} source files carry a watched class constant as a bare literal with no link to its owner — ${inContext} of them on a line that also names the constant's own domain (${rows.map((r) => `${r.value}: ${r.orphan_files_in_context}/${r.orphan_files}`).join(", ")}); and of ${declared.length} values declared across the constitution, ${undeclaredReaders.length} are read by no engine and say nothing about it`,
      method: `Two directions, because the law names both. CODE -> DIAL: word-boundary numeric scan over the scanned source set (${codeNodes.length} .mjs across office/src and world/tools), absolved by defining the constant, importing the defining module and naming its export, or a \`reads\` edge into the owning mark's directory. DIAL -> CODE: every constitutional mark standing in the Keeping Works is walked for the values it declares (\`dials:\` entries and a predicate's own \`slot\`/\`value\`; numbers and booleans, never strings), and each is looked for BY NAME in the same source set — a dial is reached by name, so the name is the join. A dial no module names is reported unless the mark itself discloses that nothing reads it yet.`,
      limits: "THE WATCH LIST IS CLOSED on the code->dial half, and it is three constants long: pace 405, the parcel dial 25, and walking pace 15. The mark says every constant in the machinery; that half asks after those three, so a green there is a green about three numbers and silence about every other number in the corpus. The narrowing is named rather than hidden, and the list grows by being edited — the CONSTS table above is the whole of it. THE DIAL->CODE HALF IS NOT CLOSED (added 2026-08-30, after an audit found four separate instances the closed list could not see): it walks every value-carrying constitutional node in the Works, so it is open by construction and grows with the record. Its own limits are the ones that matter now, and they are three. It matches on NAMES, so a module constant that merely shares a dial's name reads as a reader — `the-town/sound`'s four dials are derived from `say`'s in src/dynamic-store.mjs rather than read off the mark, and this half cannot tell those apart. It cannot see WHERE a name is read, so 'read by the engine' here means 'named somewhere in the running source', not 'read at its declared home' — a dial reached through `dialNumber` and one hardcoded beside a comment mentioning it look identical. And it rules only on numbers and booleans: `unsealed` and the pointer form (`\"the-town/resident\"`) are the record's two ways of saying the value is not here, and asking whether the engine reads a signpost would report every correctly-delegated dial as an orphan. A flagged dial is taken at its word — the mark saying nothing reads it is accepted as true, which makes the flag a promise a human has to keep, not a fact this lint verified. Within the three watched constants: a text scan with no context, so HTTP status 405 is matched by the pace-405 watch and the parcel dial 25 matches every unrelated 25. Every row carries its source line for adjudication. Structurally: the store has NO code->mark edge type, so absolution by 'reads the owning mark' can only fire on a file that quotes a mark's path literally — which no file does today. And since Stage 1 moved the lints into office/src, this module's own watch list is inside the scanned corpus and counts as an orphan of every constant it watches (rows marked is_watchlist) — true by the lint's own definition, and left in rather than exempted. This lint points; it does not rule.",
      rows,
      declared,
      evidence: rows.flatMap((r) => r.hits.filter((h) => !h.absolved && h.plausible).slice(0, 5).map((h) =>
        `${r.value} in ${h.file.replace("code:", "")} x${h.occurrences} (owner ${r.owner})${h.is_watchlist ? " [this lint's own watch list]" : ""} — L${h.lines[0].line}: ${h.lines[0].text}`))
        .concat([`out-of-context noise this method cannot tell from a real hit: HTTP status 405, and every unrelated 25 and 15 in the corpus — see --json for all ${totalOrphans} files`])
        .concat(undeclaredReaders.slice(0, 12).map((d) =>
          `declared and unread: ${d.mark} ${d.slot} = ${JSON.stringify(d.value)} — no module names it, and the mark does not say so${d.path ? ` (${d.path})` : ""}`))
        .concat(undeclaredReaders.length > 12 ? [`…and ${undeclaredReaders.length - 12} more declared-and-unread dials — see --json`] : []),
    });
  }

  // ── L4 · every instance conforms to its class ─────────────────────────────
  // One class has instances today: the parcel. Its law is a fixed 25x25 and "the
  // door sets the dial" — a parcel that declares no extent INHERITS the dial and
  // conforms by construction, so absence is conformity, not a violation.
  {
    // THE DIAL IS READ FROM THE DECLARATION, AND ITS ABSENCE IS A FINDING.
    // This read `graph.hasNode("the-town/parcel-class") ? … : null` and then
    // `cls?.w ?? 25`, and BOTH halves were broken in the same direction: the
    // node had been retired 12 days earlier (src/world-hydrate.mjs:866-873), so
    // `cls` was always null and every parcel was judged against a hardcoded 25
    // that no longer answered to the record — a falsifier that could not fail,
    // reporting GREEN about a conformity it was no longer measuring.
    //
    // Repointing alone would NOT have fixed it: `the-town/parcel` is a class
    // mark with no geometry, so `attr.w` is null there too and the `?? 25`
    // would have swallowed it exactly the same way. The value lives on the
    // class's `dials.extent_m`, so that is what is read — and when it cannot be
    // read the lint says so and rules N/A rather than inventing a number to
    // measure against.
    const { value: dial, why: dialWhy } = parcelExtent(graph);
    const parcels = nodesWhere(graph, (a) => a.kind === "mark" && a.subkind === "parcel");
    const rows = parcels.map(({ id, attr }) => {
      const absent = attr.w == null && attr.h == null;
      // `pre:` arrives as a boolean or the string "true" depending on how the
      // loader read the line. Testing `=== true` alone silently calls seeded
      // prior estate door-written, which inverts this lint's whole reading.
      const pre = attr.props?.pre === true || attr.props?.pre === "true";
      return { parcel: id, by: attr.by, w: attr.w, h: attr.h, extent_absent: absent,
        // With no dial to measure against there is no verdict to give. `null`
        // rather than `false`: an unmeasured parcel is not a failing one.
        conforms: dial == null ? null : (absent || (attr.w === dial && attr.h === dial)),
        pre, date: attr.props?.date ?? null, path: attr.props?.path ?? null };
    });
    const bad = dial == null ? [] : rows.filter((r) => !r.conforms);
    const doorWritten = rows.filter((r) => !r.pre);
    const badDoorWritten = bad.filter((r) => !r.pre);
    add({
      id: "L4", name: "every instance conforms to its class",
      // The unreadable-dial case is N/A and LOUD, never a quiet green: a lint
      // that cannot reach the contract it checks has not checked it.
      verdict: dial == null ? NA : bad.length ? RED : GREEN,
      headline: dial == null
        ? `no verdict: the parcel contract could not be read — ${dialWhy}. ${rows.length} parcels went unjudged rather than being measured against a number this lint invented`
        : bad.length
        ? `${bad.length} of ${rows.length} parcels are not ${dial}x${dial}` + (badDoorWritten.length
          ? `, and ${badDoorWritten.length} of those were written by the door (no \`pre:\`): ${badDoorWritten.map((b) => b.parcel).join(", ")}`
          : `; every one carries \`pre: true\` — seeded prior estate, which the class law explicitly grandfathers, so the door has never written an off-dial parcel`)
        : `all ${rows.length} parcels are ${dial}x${dial} or extent-absent (dial inherited)`,
      method: `nodes kind=mark subkind=parcel, extent read from the node's own extent_w/extent_h, compared against the contract read off the parcel class mark itself — \`${PARCEL_CLASS}\`'s \`dials.${PARCEL_EXTENT_SLOT}\` (${dial ?? "unreadable"}). Extent-absent counts as conforming: the door fills the dial in. The \`pre:\` flag is reported per row, not applied as a filter. A dial that cannot be read is N/A, never a green.`,
      limits: "THE CHECKED SET IS CLOSED, and it is one class: the parcel. The mark says every instance conforms to its class; this reads one class's contract against its records, because the parcel's extent is the only class param that lives anywhere a machine can reach — so a green here is a green about parcels and silence about every other class's instances. The narrowing is named rather than hidden, and the set grows as the params explosion seats each class's dials on its mark. Within the parcel: the class law asks for conformance to the CURRENT contract, and the prior-estate clause that grandfathers seeded estate lives in a code comment in tools/marks-fold.mjs rather than on the mark — so this lint answers the strict question and hands a human the `pre:` column instead of applying a filter it cannot cite. The instances stand on real instance-of rails to the works' own parcel mark (the synthesized class node retired at the step-1 promotion, 2026-08-18). CORRECTED 2026-08-30: this lint keyed on that retired `the-town/parcel-class` for twelve days after it stopped existing, and fell back to a hardcoded 25 without saying so — it was reporting a conformity it had stopped measuring. It now reads the contract off `the-town/parcel`'s own `dials.extent_m`, and rules N/A rather than green when it cannot. The world's write door still carries its own `PARCEL_EXTENT_M` constant for the same number, which is a code-side copy this lint does not read and L3's watch list is what watches.",
      rows,
      evidence: [
        ...bad.map((b) => `${b.parcel} ${b.w}x${b.h} · pre:${b.pre} · dated ${b.date} (${b.path})`),
        `${doorWritten.length} of ${rows.length} parcels were written by the door (no \`pre:\`); ${doorWritten.filter((r) => r.conforms).length} of those conform`,
        `${rows.filter((r) => r.extent_absent).length} parcels inherit the dial by carrying no extent at all`,
      ],
    });
  }

  // ── L5 · every doctrine rule reaches an enforcing surface ─────────────────
  {
    const l1 = lints.find((l) => l.id === "L1");
    const mechRunning = new Map(l1.rows.map((r) => [`mechanic:${r.mechanic}`, r.declared_running ?? []]));
    const doctrine = nodesWhere(graph, (a) => a.kind === "doctrine");
    const readsEngine = nodesWhere(graph, (a) => a.kind === "code")
      .flatMap(({ id }) => out(graph, id, "reads").filter((e) => String(e.attr.props?.path ?? "").endsWith("ENGINE.md")).map(() => id));

    const rows = doctrine.map(({ id, attr }) => {
      const codeIn = inbound(graph, id, "reads").concat(inbound(graph, id, "implements")).map((e) => e.src);
      const viaMech = out(graph, id, "describes").flatMap((e) => (mechRunning.get(e.dst) ?? []).map((m) => ({ mechanic: e.dst, module: m })));
      return { rule: id, heading: attr.props.heading, line: attr.props.line, has_rule_id: false, code_edges_in: codeIn, via_mechanic: viaMech, enforced: codeIn.length > 0 || viaMech.length > 0 };
    });
    const enforced = rows.filter((r) => r.enforced);
    add({
      id: "L5", name: "every doctrine rule reaches an enforcing surface",
      verdict: rows.length && enforced.length === rows.length ? GREEN : RED,
      headline: `${enforced.length} of ${rows.length} ENGINE.md sections reach an enforcing surface — ${rows.length - enforced.length} are unenforced prose`,
      method: "doctrine nodes (one per `##` heading), enforced if (a) a code node has a reads/implements edge INTO them, (b) they `describes` a mechanic whose implementing module L1 found running, or (c) a scanned file reads WORLD/ENGINE.md as a surface.",
      limits: "ENGINE.md carries no rule-ids, so a `##` heading is the coarsest honest unit — a section can be half-enforced and this cannot see it. Path (a) is structurally impossible today: the store has no code->doctrine edge type, because nothing in the source points at a doctrine section.",
      rows,
      evidence: [
        `code->doctrine edges in the whole store: 0 (no edge type for it exists; nothing in source names a section)`,
        `files reading WORLD/ENGINE.md as a surface: ${readsEngine.length}`,
        ...rows.filter((r) => !r.enforced).map((r) => `unenforced: "${r.heading}" (ENGINE.md:${r.line})`),
      ],
    });
  }

  // ── L6 · every exposed action has a live handler ──────────────────────────
  //
  // WRITTEN 2026-08-09, the day the apex verb shipped (Stage 3). Until then this
  // reported N/A over an empty action set, on the ground that a conformance
  // check with nothing to check is not green, it is unrun. There is now
  // something to check.
  //
  // The question: a class mark that passes the gate ADVERTISES its actions to
  // every resident standing near it. If the office has no handler for one, law
  // has opened a door with no room behind it — and the resident finds out by
  // reaching for it. So the exposed set comes from the STORE (the marks, which
  // are what residents actually see) and the handled set comes from the apex's
  // own dispatch table (the code that actually runs), and they must agree.
  //
  // Both sides read their single source: `isClassMark` is the same gate the
  // apex queries with, and `DISPATCHABLE` is the key set of the table the door
  // dispatches on. Nothing here restates either.
  {
    // GROWN 2026-08-17 (the act-as-human packet): a grant is per (action, FOR
    // actor-kind), so the comparison runs per pair. The action side needs a
    // handler in DISPATCH; the actor side needs a resolution at the door
    // (RESOLVED_ACTOR_KINDS — the seam's own list). Either absence is law with
    // no room behind it, and under the TDD-board method a red here is the town
    // ASKING, on purpose — the ask's representation IS the gap.
    const exposed = new Map(); // "action␟for" -> { action, for, ids }
    for (const { id, attr } of nodesWhere(graph, isClassMark))
      for (const e of actionEntriesOf(attr)) {
        const k = `${e.action}${e.for}`;
        if (!exposed.has(k)) exposed.set(k, { action: e.action, for: e.for, ids: [] });
        exposed.get(k).ids.push(id);
      }
    // The door is loaded only when there is a question to ask of it: a world
    // whose classes expose nothing needs no dispatch table to compare against,
    // and the hydrator should not pull the whole office in to learn that.
    let handled = null;
    let kinds = null;
    let handlerReadFailure = null;
    if (exposed.size) {
      try { ({ DISPATCHABLE: handled, RESOLVED_ACTOR_KINDS: kinds } = await import("./world-apex.mjs")); }
      catch (e) { handlerReadFailure = String(e?.message ?? e).slice(0, 160); }
    }
    const roomed = (e) => Boolean(handled?.includes(e.action)) && Boolean(kinds?.includes(e.for));
    const orphans = handled ? [...exposed.values()].filter((e) => !roomed(e)) : [];
    // A resident-kind row keeps its plain name; any other kind names itself —
    // "say for human" is a different ask than "say", and the headline is where
    // the asking is read.
    const label = (e) => (e.for === "resident" ? `${e.action} (${e.ids.join(", ")})` : `${e.action} for ${e.for} (${e.ids.join(", ")})`);
    // A lint that cannot read one of its two sides reports that, rather than
    // comparing against an empty set and calling the silence green.
    const verdict = handlerReadFailure ? RED : orphans.length ? RED : exposed.size ? GREEN : NA;
    add({
      id: "L6", name: "every exposed action has a live handler",
      verdict,
      headline: handlerReadFailure
        ? `the dispatch table could not be read (${handlerReadFailure}) — the exposed set cannot be checked against anything`
        : orphans.length
          ? `${orphans.length} action(s) advertised by law with no handler in the office: ${orphans.map(label).join("; ")}`
          : exposed.size
            ? `${exposed.size} action grant(s) exposed by ${new Set([...exposed.values()].flatMap((e) => e.ids)).size} class mark(s); every one of them dispatches`
            : "not applicable: no class mark in the world exposes an affordance yet, so there is nothing to conform.",
      method: "the exposed set is every (action, for-actor-kind) grant on every mark passing the class-mark gate (world-store.mjs `isClassMark`; entries via `actionEntriesOf`, `for:` absent = resident) — the same gate the apex verb queries with. The handled side is `DISPATCHABLE` × `RESOLVED_ACTOR_KINDS` from src/world-apex.mjs — the table the door dispatches on and the actor kinds it can resolve. Neither side is restated here.",
      limits: "This checks that a handler and an actor-kind resolution EXIST, not that they are correct, and it says nothing about actions the office could dispatch but no class exposes (an unused handler is dead code, not a broken promise). A class mark on a household draft branch is invisible to the store and so to this lint. Under the TDD-board method a red row may be a DECLARED ask rather than a defect — the distinction lives in the declaring commit, not here.",
      rows: [...exposed.values()].map((e) => ({ action: e.action, for: e.for, from: e.ids, handled: handled ? roomed(e) : false })),
      evidence: [
        `exposed: ${[...exposed.values()].map((e) => (e.for === "resident" ? e.action : `${e.action}·for·${e.for}`)).sort().join(", ") || "(none)"}`,
        `dispatchable: ${handled ? handled.join(", ") : exposed.size ? "(unreadable)" : "(not consulted — nothing is exposed)"}`,
        `resolved actor kinds: ${kinds ? kinds.join(", ") : exposed.size ? "(unreadable)" : "(not consulted)"}`,
      ],
    });
  }

  // ── L7 · every mark is an instance of a class ─────────────────────────────
  //
  // WRITTEN 2026-08-18 (the step-1 promotion; gold plan
  // postmark-world-view-system, R6 — Keemin: instance-of "should slowly but
  // surely be ALL marks — should have an L7 for this"). Class membership's
  // source of truth is the instance-of EDGE, drawn by the hydrator from the
  // binding-rule grammar (`class:`) and the legacy kind-vocabulary
  // (kind: parcel); a mark carrying neither is addressable by no class the
  // law can reach. This lint is the census of that gap, grouped by the
  // kind-word each uncovered mark still speaks.
  {
    const marksAll = nodesWhere(graph, (a) => a.kind === "mark");
    const uncovered = marksAll.filter(({ id, attr }) =>
      attr.props?.declares !== true && out(graph, id, "instance-of").length === 0);
    const census = new Map();
    for (const { attr } of uncovered) {
      const k = String(attr.subkind ?? "(no kind)");
      census.set(k, (census.get(k) ?? 0) + 1);
    }
    const rows = [...census.entries()].sort((a, b) => b[1] - a[1]).map(([kind, count]) => ({ kind, count }));
    add({
      id: "L7", name: "every mark is an instance of a class",
      verdict: uncovered.length ? RED : marksAll.length ? GREEN : NA,
      headline: uncovered.length
        ? `${uncovered.length} of ${marksAll.length} marks are instances of no class — the kind-vocabulary census: ${rows.map((r) => `${r.kind} ×${r.count}`).join(", ")}`
        : `every one of ${marksAll.length} marks declares a class or stands on an instance-of edge`,
      method: "marks minus declarations (the hydrator's `declares:` fact — a class-carrying mark standing in the Keeping Works) minus marks with an outbound instance-of edge (drawn from `class:` under the binding rule, and from the legacy kind: parcel vocabulary). Census grouped by subkind.",
      limits: "Under the TDD-board method this red is the STRANGLER'S ODOMETER, not a defect: a program-sized ask (the kind-vocabulary → classes ladder, its own sittings) whose number should fall as kind-words earn class marks and instances migrate. It says nothing about whether covered instances CONFORM — that is L4's question, growing as the params explode onto the class marks.",
      rows,
      evidence: [
        `covered: ${marksAll.length - uncovered.length} of ${marksAll.length} (declarations + instance-of carriers)`,
        ...rows.slice(0, 6).map((r) => `${r.kind}: ${r.count} mark(s) speaking the older vocabulary`),
      ],
    });
  }

  // ── L0 · the lints could read their own inputs, and cite the law truly ─────
  //
  // Two readings, one question, because they fail the same way: a lint that
  // cannot see the corpus it scans and a lint that quotes a law nobody wrote are
  // both a reading whose noise floor is hidden. The second reading arrived with
  // the citation pass (the invariant family, world main 27d7bd9b) — a stale LAW
  // table would let all eight findings go on quoting a claim the town has since
  // rewritten, and every one of them would still look clean.
  //
  // A tree we cannot reach is DISCLOSED, never counted as drift: the unreadable
  // list is already the loud part, and calling a swept cache a constitutional
  // disagreement would be this lint laundering its own noise floor.
  //
  // GIVEN A VOICE 2026-08-23 (Keemin): L0 used to speak only when it had a
  // complaint, which left a clean run and a run where L0 never happened looking
  // exactly alike — an absence nobody can read is the noise floor hidden in the
  // one place the lint that exists to expose noise floors cannot see. Its own
  // mechanic mark says `src/world-lints.mjs — L0 at every hydration`, so it now
  // emits at every hydration: the verdict set is eight rows, always, and a
  // MISSING L0 row is itself the finding. The red conditions are unchanged, and
  // a tree it could not reach is still never dressed up as drift — but it is
  // not dressed up as a green either. A clone-less run checked no citations, so
  // it says N/A and asserts nothing, exactly as its limits always claimed.
  const lawCheck = readLawPairing(TREE);
  const lawRead = lawCheck.status === "read";
  add({
    id: "L0", name: "the lints could read their own inputs, and their law citations match the marks",
    verdict: unreadable.length || lawCheck.drift.length ? RED : lawRead ? GREEN : NA,
    headline: unreadable.length || lawCheck.drift.length
      ? [
          unreadable.length ? `${unreadable.length} source files named by the store could not be read — every text-scanning lint above is running on a partial corpus` : null,
          lawCheck.drift.length ? `${lawCheck.drift.length} law citation(s) no longer match the invariant marks — the findings above are quoting law the town did not write` : null,
        ].filter(Boolean).join("; ")
      : lawRead
        ? `every source file the scans above reached for was read, and all ${lawCheck.checked} of ${Object.keys(LAW).length} law citations match the invariant marks verbatim`
        : `every source file the scans above reached for was read, but the invariant family was not reachable in the world tree (${lawCheck.status}) — the citations went unchecked this run, so this asserts nothing about them`,
    method: `each code node's path resolved against meta.office_path / meta.world_tree_path and read. Separately, the eight id↔Lx pairs and the eight quoted claims in this module's LAW table are read back off the marks themselves — ${LAW_ROOT}/<slug>/mark.md, the \`lint\` dial from the frontmatter and the one-claim body from the rest — and any dial or claim that disagrees is drift. GREEN needs both halves: nothing unread and the family read clean.`,
    limits: `This sees only the files the lints above actually reached for — a node no scan touched is neither read nor unread here. The materialised world tree lives in a temp cache keyed by sha; a swept cache produces an unreadable corpus. The citation check needs that same tree: with no tree it reports \`unavailable\` (this run: ${lawCheck.status}${lawRead ? `, ${lawCheck.checked} of ${Object.keys(LAW).length} marks read` : ""}) and the verdict is N/A rather than green, because a clone-less run proves nothing about the citations either way. When it does read, it compares this file's table to the marks; it cannot tell which of the two is the one that moved. Rehydrate to restore the tree.`,
    rows: unreadable.slice(0, 40),
    law_check: lawCheck,
    evidence: [
      ...unreadable.slice(0, 10),
      ...lawCheck.drift.map((d) => `${d.lint} · ${d.why} at ${d.at} — this module says ${JSON.stringify(d.expected)}, the mark says ${JSON.stringify(d.found)}`),
      ...(unreadable.length ? [] : ["no source file the scans above reached for failed to read"]),
      lawRead
        ? `law citations: ${lawCheck.checked} of ${Object.keys(LAW).length} marks read at ${lawCheck.root}, ${lawCheck.drift.length} drifted`
        : `law citations: not checked — no invariant family at ${lawCheck.root ?? "(no tree path)"}`,
    ],
  });

  return { lints, meta, store };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1]?.endsWith("world-lints.mjs")) {
  const argOf = (n, d) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };
  const { lints, meta, store } = await runLints({ dbPath: argOf("--db", DEFAULT_DB) });
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ meta, counts: store.counts, anomalies: store.anomalies, lints }, null, 2));
  } else {
    const byKind = {};
    store.graph.forEachNode((_id, a) => { byKind[a.kind] = (byKind[a.kind] ?? 0) + 1; });
    console.log(`world lints · store ${store.graph.order} nodes / ${store.graph.size} edges ${JSON.stringify(byKind)} · world ${(meta.as_of_world ?? "?").slice(0, 12)} · office ${(meta.as_of_office ?? "?").slice(0, 12)}`);
    console.log(`geometry: ${store.geometryVersions.length} versions over ${new Set(store.geometryVersions.map((g) => g.mark_id)).size} marks\n`);
    for (const t of lints) {
      console.log(`${t.verdict.padEnd(5)} ${t.id}  ${t.name}`);
      // The law before the finding: a reader who cannot see what was promised
      // has to take the verdict's word for what was broken.
      if (t.law) console.log(`      law ${t.law} — "${t.law_text}"`);
      console.log(`      ${t.headline}`);
      for (const e of t.evidence.slice(0, 8)) console.log(`      · ${e}`);
      if (t.evidence.length > 8) console.log(`      · … ${t.evidence.length - 8} more (--json for all)`);
      console.log();
    }
    const v = (k) => lints.filter((t) => t.verdict === k).map((t) => t.id).join(",") || "-";
    console.log(`GREEN ${v(GREEN)} · RED ${v(RED)} · N/A ${v(NA)}`);
  }
}
