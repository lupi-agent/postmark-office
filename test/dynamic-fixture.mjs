// dynamic-fixture.mjs — a world in a bottle for the Stage 2 tests.
//
// Builds three things the dynamic layer needs and nothing else:
//
//   a world CLONE   a git repo with a `main`, carrying `tools/walk.mjs` — the
//                   town's physics, read at a ref exactly as the office reads it
//   a world.db      hand-filled with the same SCHEMA the hydrator writes: the
//                   sound class mark (with its dials) and a handful of departure
//                   events. Hand-filled deliberately — what is under test here
//                   is the dynamic layer over a store, never the hydrator's
//                   derivation, which has its own tests and takes ten seconds.
//   a dynamic.db    empty, at a throwaway path
//
// ON THE FIXTURE'S walk.mjs. It is a faithful miniature, not the world's own
// module, and that is sound for what these tests falsify: the crossing-save and
// the replay check import the SAME module, so the arithmetic cancels on both
// sides. What is under test is whether the saved bytes carry enough to
// reconstitute the world — falsified by a missing FIELD, not by a missing
// formula. (Strip `departure` from a snapshot and a mid-walk resident comes back
// frozen at the boundary under any correct physics at all.)

import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { SCHEMA } from "../src/world-store.mjs";
import { clearWorld, publishWorld } from "./helpers/world-rows.mjs";

export const EPOCH = Date.UTC(2026, 5, 12);
export const CROSSING_MS = 12 * 3600 * 1000;
export const crossingStart = (n) => EPOCH + n * CROSSING_MS;

// A faithful miniature of the world's walk arithmetic. See the header.
const WALK_MJS = `
export const CROSSING_EPOCH_UTC = Date.UTC(2026, 5, 12);
export const CROSSING_MS = 12 * 3600 * 1000;
export const DEFAULT_PACE_KM = 15;
export function fractionalCrossing(nowMs = Date.now()) {
  return Math.max(0, (nowMs - CROSSING_EPOCH_UTC) / CROSSING_MS);
}
export function currentDeparture(departures, handle) {
  let cur = null;
  for (const d of departures ?? []) if (d.handle === handle) cur = d;
  return cur;
}
// The ledger's own line grammar, in miniature — the world's DEPARTURE_RE with
// the optional clauses (within / to / pace) left off. Enough that the walkers
// door and the presence store can be seeded from ONE list of departures and
// then be checked against each other.
export const DEPARTURE_RE = /^- (\\S+) · (\\S+) · from (-?[\\d.]+),(-?[\\d.]+) · toward (-?[\\d.]+),(-?[\\d.]+) · at ([\\d.]+)$/;
export function parseWalkLedger(text) {
  const departures = [];
  const unrecognized = [];
  for (const raw of String(text ?? "").replace(/\\r\\n/g, "\\n").split("\\n")) {
    if (!raw.startsWith("- ")) continue;
    const m = raw.match(DEPARTURE_RE);
    if (!m) { unrecognized.push(raw); continue; }
    departures.push({
      iso: m[1], handle: m[2],
      from: { x: +m[3], y: +m[4] }, toward: { x: +m[5], y: +m[6] }, at: +m[7],
      targetExtent: null, targetMarkId: null, pace: null, line: raw,
    });
  }
  return { departures, unrecognized };
}
export function publicWalkers(departures, nowFractional = fractionalCrossing()) {
  return (departures ?? []).map((d) => {
    const p = positionAt(d, nowFractional);
    return { handle: d.handle, x: p.x, y: p.y, source: "walk", moving: !p.arrived, remaining_m: p.remainingM, eta_crossings: p.etaCrossings };
  });
}
export function positionAt(departure, nowFractional = fractionalCrossing()) {
  if (!departure) return null;
  const { from, toward, at } = departure;
  const paceM = (departure.pace ?? DEFAULT_PACE_KM) * 1000;
  const legM = Math.hypot(toward.x - from.x, toward.y - from.y);
  const travelled = Math.max(0, nowFractional - at) * paceM;
  const arrived = travelled >= legM;
  const f = legM === 0 ? 1 : Math.min(1, travelled / legM);
  return {
    x: from.x + (toward.x - from.x) * f,
    y: from.y + (toward.y - from.y) * f,
    arrived,
    standing: arrived && legM === 0,
    legM,
    travelledM: Math.min(travelled, legM),
    remainingM: Math.max(0, legM - travelled),
    etaCrossings: arrived ? 0 : (legM - travelled) / paceM,
  };
}
`;

export const DEFAULT_DIALS = { radius_m: 60, hearing_ttl_min: 5, flood_cap: 20, thread_close_min: 30 };

// The engine's direction and distance vocabulary. The rose and the bands are the
// world's own values rather than invented ones, because the presence tests assert
// that a resident is described in the SAME words a hill is — "E", "close by" —
// and a fixture with different words would prove nothing about that.
const ENGINE_MJS = `
export const ROSE16 = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
export const DIALS = { bearing_points: 16, distance_bands: [
  { max: 8, name: "underfoot" }, { max: 40, name: "close by" }, { max: 150, name: "a stone's throw" },
  { max: 600, name: "across the way" }, { max: 2500, name: "a fair way off" },
  { max: 8000, name: "far off" }, { max: Infinity, name: "on the horizon" } ] };
export function bearingDeg(dx, dy) { return (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360; }
export function quantizeBearing(deg, points = DIALS.bearing_points) {
  const idx = Math.round(deg / (360 / points)) % points;
  return points === 16 ? ROSE16[idx] : \`\${Math.round(idx * (360 / points))}°\`;
}
export function distanceBand(m, bands = DIALS.distance_bands) {
  for (const b of bands) if (m <= b.max) return b.name;
  return bands[bands.length - 1].name;
}
`;

// The rest of the engine, in miniature — the same shapes tools/ exports, because
// the office imports these from the clone and the presence tests are about the
// PRESENCE layer, not about geometry. Mirrors test/world-serve.test.mjs's stubs.
const GEOMETRY_MJS = `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function pointInRect(px, py, r) { return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2; }
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
export const contains = (outer, inner) => overlapArea(outer, inner) >= 0.99 * inner.w * inner.h;
export const polygonOf = () => null;
export function pointInPolygon() { return false; }
export const isIrregular = () => false;
export const marksContain = (a, b) => contains(rect(a), rect(b));
`;

const VERBS_MJS = `
import { rect, contains, pointInRect } from "./geometry.mjs";
const area = (m) => (m.extent?.w ?? 1) * (m.extent?.h ?? 1);
export function containmentChain(pos, marks) {
  const containing = marks
    .filter((m) => m.at && (m.kind === "sited" || m.kind === "parcel") && pointInRect(pos.x, pos.y, rect(m)))
    .sort((a, b) => area(a) - area(b));
  const nest = [];
  for (const m of containing) if (!nest.length || contains(rect(m), rect(nest[nest.length - 1]))) nest.push(m);
  return nest.reverse().map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body, extentM: Math.max(m.extent?.w ?? 0, m.extent?.h ?? 0) }));
}
export function orient(state, world) { return { self: { x: state.x, y: state.y }, within: containmentChain(state, world.marks ?? []) }; }
export function openYourEyes(state, world) {
  return { fov: { carried: [], far: [] }, radial: {}, tell: () => "You are standing in the fixture." };
}
export function investigate() { return null; }
`;

// THE TOWN'S OWN POSITION JOIN, carried into the fixture rather than stubbed.
//
// It used to be a stub returning NOWHERE and an empty list, which was fine while
// presence read the walk ledger alone. It is not fine now: `present` answers
// over the WHOLE position union — walk records ∪ parcel households — through
// exactly this module (issue #7 §1), so a stub would have the tests proving the
// office calls something rather than proving what the answer is.
//
// This is `tools/where-is.mjs` from the world repo, trimmed to the four
// functions the office calls and with its long history comments left there.
// Same rules, same order: a declared walk wins, ground stands underneath it,
// unplaced is honestly unplaced and never the origin.
const WHERE_IS_MJS = `
import { currentDeparture, positionAt, fractionalCrossing } from "./walk.mjs";
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function householdOf(handle, world) {
  const own = (world?.marks ?? []).find((m) => m.by === handle && m.household);
  return own?.household ?? handle;
}
export function parcelFor(handle, world) {
  const hh = householdOf(handle, world);
  if (!hh) return null;
  return (world?.parcels ?? []).find((p) => p.household === hh) ?? null;
}
export function homeOf(handle, world) {
  const parcel = parcelFor(handle, world);
  if (!parcel || !Number.isFinite(parcel.at?.x) || !Number.isFinite(parcel.at?.y)) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id ?? null, parcel };
}
export function whereIs(handle, { world = null, departures = [], at = fractionalCrossing() } = {}) {
  const departure = currentDeparture(departures ?? [], handle);
  if (departure) {
    const p = positionAt(departure, at);
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y))
      return { x: p.x, y: p.y, placed: true, source: "walk", mark_id: departure.targetMarkId ?? null, position: p, departure };
  }
  return homeOf(handle, world);
}
export function publicResidents(handles, { world = null, departures = [], at = fractionalCrossing() } = {}) {
  const seen = new Set();
  const out = [];
  for (const handle of handles ?? []) {
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    const here = whereIs(handle, { world, departures, at });
    if (!here.placed) continue;
    const p = here.position ?? null;
    const moving = Boolean(p && p.arrived === false);
    out.push({
      handle, x: here.x, y: here.y, source: here.source, moving,
      toward: moving ? (here.departure?.toward ?? null) : null,
      remaining_m: moving ? p.remainingM : 0,
      eta_crossings: moving ? p.etaCrossings : 0,
      mark_id: here.mark_id ?? null,
    });
  }
  return out;
}
`;

/**
 * One departure, as a line of the public ledger. The world.db events and the
 * ledger file are seeded from the SAME array through this, so a test that
 * checks the walkers door against the presence layer is comparing two
 * derivations of one record rather than two different records.
 */
export const ledgerLine = (d) =>
  `- ${d.at} · ${d.actor} · from ${d.from.x},${d.from.y} · toward ${d.toward.x},${d.toward.y} · at ${d.crossing}`;

/** A world clone carrying the whole miniature engine — enough for orient, eyes and place words. */
export function fixtureWorldCloneWithEngine({ label = "presence", marks = [], parcels = [], departures = [] } = {}) {
  const repo = mkdtempSync(join(tmpdir(), `postmark-${label}-world-`));
  const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
  put("tools/walk.mjs", WALK_MJS);
  put("tools/world-engine.mjs", ENGINE_MJS);
  put("tools/geometry.mjs", GEOMETRY_MJS);
  put("tools/world-verbs.mjs", VERBS_MJS);
  put("tools/world-build.mjs", 'export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }');
  put("tools/where-is.mjs", WHERE_IS_MJS);
  put("WORLD/walk-ledger.md", ["# Walk ledger", "", ...departures.map(ledgerLine), ""].join("\n"));
  put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks, parcels, determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [] }));
  put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
  put("seeding/manifest.json", JSON.stringify({ homes: [] }));
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "fixture world with engine");
  return repo;
}

/** A world clone with the physics on `main`. Returns its path. */
export function fixtureWorldClone({ label = "dyn" } = {}) {
  const repo = mkdtempSync(join(tmpdir(), `postmark-${label}-world-`));
  const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
  put("tools/walk.mjs", WALK_MJS);
  put("WORLD/walk-ledger.md", "# Walk ledger\n");
  put("WORLD/marks/.keep", "");
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "fixture world");
  return repo;
}

export const mainShaOf = (repo) =>
  execFileSync("git", ["-C", repo, "rev-parse", "refs/heads/main"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/**
 * A world.db carrying the sound class and some departures.
 *
 * @param departures  [{ at, actor, from:{x,y}, toward:{x,y}, crossing, pace?, to?, within? }]
 * @param dials       what `the-town/sound` declares — pass a changed dial and the
 *                    dynamic layer must follow it. That is the falsifier.
 */
export function fixtureWorldDb(path, {
  sha = "0".repeat(40),
  dials = DEFAULT_DIALS,
  classVersion = 1,
  withSoundClass = true,
  departures = [],
  status = "OK",
  ledgerGate = "PRESENT",
} = {}) {
  // Always a fresh file: world.db is an index and the hydrator rebuilds it whole
  // every run, so a fixture that appended to a previous one would be modelling a
  // store the office can never actually be handed.
  for (const p of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(p)) rmSync(p, { force: true });
  const db = new DatabaseSync(path);
  try {
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  meta.run("as_of_world", sha);
  meta.run("as_of_office", "");
  meta.run("hydrated_at", new Date(crossingStart(0)).toISOString());
  meta.run("hydration_status", status);
  meta.run("counts", JSON.stringify({ nodes_total: withSoundClass ? 1 : 0 }));
  meta.run("gates", JSON.stringify([
    { gate: "world-clone", status: "PRESENT" },
    { gate: "walk-ledger", input: "WORLD/walk-ledger.md", status: ledgerGate, detail: `${departures.length} departures` },
  ]));

  if (withSoundClass) {
    db.prepare("INSERT OR REPLACE INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      "the-town/sound", "mark", "sited", "constitution", "the-town",
      -930, -780, 50, 40,
      JSON.stringify({
        slug: "sound", body: "A voice carries sixty metres and is heard for five minutes.",
        class: "sound", class_version: classVersion, extends: "emission",
        dials: dials === null ? null : dials,
        // `subverb` is the PRE-RENAME key (action, 2026-08-15), kept here on
        // purpose: a store hydrated from older law must keep its doors, and
        // this fixture is one of the two witnesses that it does (the other is
        // the explicit transition test in world-apex.test.mjs).
        implements: [], affordances: [{ subverb: "say", blurb: "Speak aloud where you stand." }],
      }));
  }

  const ins = db.prepare("INSERT INTO events (at, actor, type, payload) VALUES (?,?,?,?)");
  for (const d of departures) {
    ins.run(d.at, d.actor, "departure", JSON.stringify({
      from: d.from, toward: d.toward, crossing: d.crossing,
      within: d.within ?? null, to: d.to ?? null, pace: d.pace ?? null,
      line_no: d.line_no ?? null,
    }));
  }
  } finally { db.close(); }   // an unclosed handle would lock the file on Windows and turn one bad fixture into a whole failing suite
  // The office stands on the world graph snapshot, never the file (POS-270 lane
  // W 3a): an OK world is published as one; a failed hydration leaves none,
  // since the store is never given a failed snapshot.
  if (status === "OK") publishWorld(path); else clearWorld();
  return path;
}

/** A throwaway directory, for a dynamic.db / STATE tree that nothing else shares. */
export const scratchDir = (label = "dyn") => mkdtempSync(join(tmpdir(), `postmark-${label}-`));
