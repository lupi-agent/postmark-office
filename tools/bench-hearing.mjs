// bench-hearing.mjs — POS-264 step 1: what one say costs in a room of forty.
//
// Times the two per-say movement reads the recorded profile blamed:
//   heardBy  — voices.mjs walks every voice inside the fade window and asks
//              the injected `heardFrom` hook where it is heard from; world.mjs's
//              hook re-reads BOTH eras of the departure record per voice
//              (departuresNow → git show main:walk-ledger + the store's acts,
//              then storedRecordsFor → the store's acts again).
//   nearby   — `listeners`: presentNear over the whole position union.
//
// The hook below is world.mjs's `heardFrom` byte for byte in what it calls; it
// is restated rather than imported because world.mjs builds its voices at
// import with a live log and a pen, neither of which a bench may touch.
//
// THE STORE IS A FIXTURE, SIZED TO PROD: `useGuardReader` answers the one
// departure query with N synthetic walk acts (prod: 2,397 on 2026-09-21). So
// the numbers below EXCLUDE the Postgres round trip, which the box pays on top
// — they are a floor, not a ceiling.
//
// Run: WORLD_CLONE=<world clone> node tools/bench-hearing.mjs [room=40] [acts=2400]

process.env.WORLD_MOVEMENT_V2 = "1";
process.env.WORLD2_PG = "1";
process.env.WORLD2_PG_URL = "postgres://bench-hearing/none";   // never dialled: the reader is replaced below

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOM = Number(process.argv[2] ?? 40);
const ACTS = Number(process.argv[3] ?? 2400);

const { WORLD_CLONE } = await import("../src/world-store.mjs");
const { useGuardReader } = await import("../src/world2-guards.mjs");
const { departuresNow } = await import("../src/world.mjs");
const { heardFromV2, vesselServiceFrom } = await import("../src/world-movement.mjs");
const { createVoices } = await import("../src/voices.mjs");
const wb = await import("../src/world-branches.mjs");

// ── the world, folded the way world.mjs § world() folds it ──────────────────
const engine = wb.materializeAtRef(WORLD_CLONE, wb.blessedRef(WORLD_CLONE), "tools");
const build = await import(pathToFileURL(join(engine, "tools", "world-build.mjs")));
const sel = wb.publishedState(WORLD_CLONE);
const w = build.assembleWorld({ worldState: sel.state, skeleton: wb.publishedSkeleton(WORLD_CLONE).skeleton });
// THE CARRIER, SUPPLIED. The fold drops `mobility:` (world-frames.mjs §
// carriersFrom) and the box supplies it from world.db, which a bench does not
// have — without this line heardFromV2 returns on its first line and the bench
// times nothing. `derived` is what the box's store says of the timetable class.
for (const m of w.marks ?? []) if (m.mechanic === "timetable" && !m.mobility) m.mobility = "derived";
const svc = await vesselServiceFrom(w, { repo: WORLD_CLONE });

// ── the fixture store: ACTS walk acts over 100 handles, the room's 40 among them
const ROOM_AT = { x: 1000, y: -1000 };
const handles = Array.from({ length: 100 }, (_, i) => `bench-${String(i).padStart(3, "0")}`);
const t0 = Date.now() - 3 * 3600_000;
const rows = Array.from({ length: ACTS }, (_, i) => {
  const actor = handles[i % handles.length];
  const at = new Date(t0 + i * 1000);
  const inRoom = handles.indexOf(actor) < ROOM;
  const toward = inRoom ? { x: ROOM_AT.x + (i % 7), y: ROOM_AT.y + (i % 5) } : { x: 5000 + i, y: 5000 };
  return { id: 10_000 + i, at, crossing: "210.5", actor, action: "walk",
    payload: { from: { x: 0, y: 0 }, toward, within: null, to: null, pace: null, declared_by: actor } };
});
let queries = 0;
useGuardReader(async (fn) => fn({ query: async (sql, params) => {
  queries += 1;
  if (!/FROM acts/i.test(String(sql))) return { rows: [] };
  return { rows: rows.filter((r) => (params?.[0] ?? []).includes(r.action)) };
} }));

// ── the room: ROOM residents, each spoke once in the last four minutes ───────
const dir = mkdtempSync(join(tmpdir(), "bench-hearing-"));
const log = join(dir, "voices.jsonl");
const now = Date.now();
writeFileSync(log, handles.slice(0, ROOM).map((h, i) => JSON.stringify({
  at: new Date(now - 240_000 + i * 5000).toISOString(), handle: h, text: `line ${i}`,
  x: ROOM_AT.x + (i % 7), y: ROOM_AT.y + (i % 5), place: null, aboard: false })).join("\n") + "\n");

let hookCalls = 0;
const heardFrom = async (voice, t) => {
  hookCalls += 1;
  try {
    return await heardFromV2(voice, w, { repo: WORLD_CLONE, atMs: t,
      recordsOf: async (h) => {
        try { return (await departuresNow(WORLD_CLONE)).filter((d) => d.handle === h); } catch { return []; }
      } });
  } catch { return null; }
};
const voices = createVoices({ standpoint: async () => ({ placed: true, x: ROOM_AT.x, y: ROOM_AT.y }),
  heardFrom, structuralHearing: () => true, logPath: log, speakEveryMs: 0 });

const time = async (label, fn, n = 3) => {
  const ms = [];
  let out;
  for (let i = 0; i < n; i++) { const a = performance.now(); out = await fn(); ms.push(performance.now() - a); }
  console.log(`${label}: ${ms.map((m) => m.toFixed(0)).join(" / ")} ms`);
  return out;
};

console.log(`world ${sel.sha?.slice(0, 8)} · carriers ${svc.carriers?.length ?? 0} · service ${svc.service ? "yes" : "no"} · room ${ROOM} · store acts ${ACTS}`);
queries = 0; hookCalls = 0;
const r = await time("heardBy (one hear in the room, via voices.hear)", () => voices.hear(handles[0]));
console.log(`  voices heard ${r.voices?.length} · heardFrom calls ${hookCalls} · store queries ${queries} (3 runs)`);
await time("departuresAcrossEras x1", () => departuresNow(WORLD_CLONE), 5);

// ── AFTER: the same hear, the hook over the positions projection ─────────────
// `world.mjs § projectedHeardFrom` in what it calls, with this bench's fold
// (the carrier supplied above) in place of the office's own `world()`.
const { positionProjection } = await import("../src/world.mjs");
const built = performance.now();
await positionProjection.departures();
console.log(`projection built once: ${(performance.now() - built).toFixed(0)} ms`);
hookCalls = 0; queries = 0;
const projected = createVoices({ standpoint: async () => ({ placed: true, x: ROOM_AT.x, y: ROOM_AT.y }),
  heardFrom: async (voice, t) => {
    hookCalls += 1;
    const governing = await positionProjection.departures();
    try {
      return await heardFromV2(voice, w, { repo: WORLD_CLONE, atMs: t,
        recordsOf: async (h) => governing.filter((d) => d.handle === h), storeRecordsOf: async () => [] });
    } catch { return null; }
  },
  structuralHearing: () => true, logPath: log, speakEveryMs: 0 });
const r2 = await time("heardBy over the projection (same hear)", () => projected.hear(handles[0]), 5);
console.log(`  voices heard ${r2.voices?.length} · heardFrom calls ${hookCalls} · store queries ${queries} (5 runs)`);
rmSync(dir, { recursive: true, force: true });
process.exit(0);
