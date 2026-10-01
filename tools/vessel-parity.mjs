#!/usr/bin/env node
// vessel-parity.mjs — does the timetable agree with what the boat actually did?
//
//   node tools/vessel-parity.mjs [--world <clone>] [--db <world.db>] [--json]
//
// Stage D moves the vessel's position from a ledger line to `f(timetable,
// clock)`. That is only a safe move if the timetable AGREES with the record it
// replaces — so this reads every departure the Post Office ever filed and asks,
// for each, where the schedule says she was at that instant.
//
// AND IT ASKS TWICE, because there is no single honest answer.
//
//   NOW  — the stops as they stand today. This is what the running office
//          computes, and it is the number a resident gets when they ask where
//          the boat is.
//   AS-OF — the stops as the record placed them AT THAT INSTANT, read out of
//          world.db's `geometry_versions`. This is the tense law: "an event is
//          judged against the geometry of its own instant", and without it the
//          more the world is rearranged the more of its past reads as broken.
//
// The two disagree for exactly the reason the doctrine already names, and the
// residuals are not noise — each one is a fact about the town's history:
//
//   · a residual under ~25 m is a BERTH OFFSET. She lies alongside, not on the
//     pin; her own footprint is 9×26 m. This is agreement.
//   · a residual of ~1.2 km on the 2026-08-08 22:24Z line is the hand-run
//     re-mooring from the Pando landing to Porch Hill on party night — an
//     off-timetable sailing, which a timetable is not supposed to reproduce.
//   · a residual of ~1.2 km on the 2026-08-09 12:00Z line AS-OF is the
//     `effective_from` gap, red-penned in LOGOS/state-and-time.md: the landing
//     had FACTUALLY been at Porch Hill since 08-08, and the commit legalizing
//     that landed 08-09T21:32Z. Judged as-of, the past reads as it was
//     RECORDED, which is the true history and precisely the drift that prompted
//     the ruling. A deriver may not back-date geometry from commit prose.
//
// So this tool does not have a pass mark of zero. It has EXPECTED residuals with
// named causes, and its job is to notice when a residual appears that has none.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { WORLD_CLONE } from "../src/world-store.mjs";

const argOf = (name, fallback = null) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : fallback; };
const flag = (name) => process.argv.includes(name);

/** A berth is not a pin: she lies alongside, and her own footprint is 9x26 m. */
export const BERTH_TOLERANCE_M = 30;

/**
 * Every mark's geometry AS IT STOOD at an instant, from world.db's own tense
 * table. Marks with no version covering the instant keep today's geometry and
 * are named in `unversioned` — a silent fallback here would let a mark that
 * moved before the store existed masquerade as one that never moved.
 */
export function marksAsOf(marks, iso, versions) {
  const t = Date.parse(iso);
  const byMark = new Map();
  for (const v of versions) {
    if (!byMark.has(v.mark_id)) byMark.set(v.mark_id, []);
    byMark.get(v.mark_id).push(v);
  }
  const unversioned = [];
  const out = marks.map((m) => {
    const list = byMark.get(m.id);
    if (!list) { if (m.at) unversioned.push(m.id); return m; }
    const v = list.find((r) => Date.parse(r.valid_from_iso) <= t && (r.valid_to_iso == null || Date.parse(r.valid_to_iso) > t));
    if (!v) { unversioned.push(m.id); return m; }
    return {
      ...m,
      at: (v.at_x == null && v.at_y == null) ? m.at : { x: v.at_x, y: v.at_y },
      extent: (v.extent_w == null && v.extent_h == null) ? m.extent : { w: v.extent_w, h: v.extent_h },
    };
  });
  return { marks: out, unversioned };
}

/** Every geometry version in a world graph's rows, oldest first per mark. */
export function geometryVersionsOf(tables) {
  const versions = (tables?.geometryVersions ?? [])
    .map(({ mark_id, at_x, at_y, extent_w, extent_h, valid_from_iso, valid_to_iso }) => ({ mark_id, at_x, at_y, extent_w, extent_h, valid_from_iso, valid_to_iso }))
    .sort((a, b) => (a.mark_id < b.mark_id ? -1 : a.mark_id > b.mark_id ? 1 : String(a.valid_from_iso) < String(b.valid_from_iso) ? -1 : String(a.valid_from_iso) > String(b.valid_from_iso) ? 1 : 0));
  return { versions, absent: null };
}

/**
 * The parity rows. Pure over its inputs so a test can hand it fixtures and a
 * falsifier can bend one number and watch it fail.
 */
export function parityRows({ vesselDepartures, marks, versions, vessel, vesselHandle }) {
  const serviceOver = (list) => vessel.servicesFromFold({ marks: list }).services
    .find((s) => s.vessel.handle === vesselHandle) ?? null;
  const now = serviceOver(marks);

  return vesselDepartures.map((d) => {
    const asOfMarks = versions.length ? marksAsOf(marks, d.iso, versions) : { marks, unversioned: [] };
    const asOf = serviceOver(asOfMarks.marks);
    const reading = (service) => {
      if (!service) return null;
      const p = vessel.vesselPositionAt(service, d.at);
      if (!p) return null;
      return {
        x: p.x, y: p.y, berthed: Boolean(p.berthed), at_stop: p.atStop ?? null,
        metres: Math.round(Math.hypot(p.x - d.from.x, p.y - d.from.y) * 10) / 10,
      };
    };
    const nowR = reading(now), asOfR = reading(asOf);
    return {
      iso: d.iso, crossing: d.at,
      ledger: { from: d.from, toward: d.toward, to: d.targetMarkId ?? null, pace: d.pace ?? null },
      now: nowR,
      as_of: asOfR,
      // Which reading is the one to judge by, said rather than left implied.
      verdict: asOfR
        ? (asOfR.metres <= BERTH_TOLERANCE_M ? "agrees (within a berth)" : `differs by ${asOfR.metres} m as-of its own instant`)
        : "no service could be built at that instant",
      scheduled: Boolean(asOf && vessel.sailingsBetween(asOf, d.at - 1e-9, d.at + 1e-9).length),
    };
  });
}

async function main() {
  const CLONE = resolve(argOf("--world", process.env.WORLD_CLONE ?? WORLD_CLONE));
  if (process.argv.includes("--db")) { console.error("world.db is retired (POS-270 lane W 3b): vessel-parity reads --rows <file> (a hydration's --rows-out) or the store's snapshot; drop --db."); process.exit(2); }
  const T = (f) => import(pathToFileURL(join(CLONE, "tools", f)).href);
  const [walk, vessel, fold] = await Promise.all([T("walk.mjs"), T("vessel.mjs"), T("marks-fold.mjs")]);

  const marks = fold.loadMarks(join(CLONE, "WORLD", "marks"));
  const service = vessel.servicesFromFold({ marks }).services[0] ?? null;
  if (!service) { console.error("no timetable-carrying mark in this world — nothing to check parity against"); process.exit(1); }
  const vesselHandle = service.vessel.handle;

  const { departures } = walk.parseWalkLedger(readFileSync(join(CLONE, "WORLD", "walk-ledger.md"), "utf8"));
  const vesselDepartures = departures.filter((d) => d.handle === vesselHandle);

  // The store's snapshot (what the office reads), or a hydration's --rows.
  const { worldGraphForTool } = await import("../src/world-graph-snapshot.mjs");
  const w = await worldGraphForTool({ rows: argOf("--rows", null) });
  const { versions, absent } = w.error ? { versions: [], absent: w.error } : geometryVersionsOf(w.loaded.tables);
  const rows = parityRows({ vesselDepartures, marks, versions, vessel, vesselHandle });

  const report = {
    world: CLONE, store: w.source ?? null, store_absent: absent,
    service: { mark: service.markId, vessel: service.vessel.markId, pace: service.pace, stops: service.stops.map((s) => ({ mark: s.markId, at: s.at, departs: s.departs })) },
    departures: rows.length,
    scheduled: rows.filter((r) => r.scheduled).length,
    agreeing: rows.filter((r) => r.as_of && r.as_of.metres <= BERTH_TOLERANCE_M).length,
    rows,
  };
  if (flag("--json")) { console.log(JSON.stringify(report, null, 2)); return report; }

  console.log(`vessel-parity · ${service.vessel.markId} on ${service.markId}`);
  console.log(`  ${rows.length} filed departure(s) · ${report.scheduled} land on a scheduled cast-off · ${report.agreeing} agree within ${BERTH_TOLERANCE_M} m as-of`);
  if (absent) console.log(`  NOTE ${absent} — the as-of column falls back to today's geometry`);
  for (const r of rows) {
    console.log(`\n  ${r.iso}  (crossing ${r.crossing})  ${r.scheduled ? "scheduled" : "OFF-TIMETABLE"}`);
    console.log(`    ledger says she left ${r.ledger.from.x},${r.ledger.from.y} for ${r.ledger.to ?? `${r.ledger.toward.x},${r.ledger.toward.y}`}`);
    if (r.now) console.log(`    timetable NOW    ${r.now.x},${r.now.y}  (${r.now.metres} m)`);
    if (r.as_of) console.log(`    timetable AS-OF  ${r.as_of.x},${r.as_of.y}  (${r.as_of.metres} m)  ← judge by this one`);
    console.log(`    ${r.verdict}`);
  }
  return report;
}

if (process.argv[1]?.endsWith("vessel-parity.mjs")) {
  main().catch((e) => { console.error(`vessel-parity tripped: ${String(e?.stack ?? e)}`); process.exit(9); });
}
