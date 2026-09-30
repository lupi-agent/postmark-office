// save-emissions.test.mjs — the save's emission lines from the acts record (POS-269).
//
// The gate is BYTE PARITY on STATE/: the same voices, recorded the old way
// (dynamic.db's `recordEmission`, then `emissionsBetween`) and the new way (as
// the say door writes them to `acts`, then `emissionRowsFromActs`), must make
// the save write the same bytes. Real town files were measured the same way
// (docs/2026-09-30/rail/pos-269/MEASURE-*.txt); this holds the rule in the suite.
//
//   node --test test/save-emissions.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic, soundMs } from "../src/dynamic-store.mjs";
import { recordEmission, emissionsBetween } from "../src/dynamic-emissions.mjs";
import { anchorAt, WORLD_ANCHOR } from "../src/world-journal.mjs";
import { emissionRowsFromActs, EmissionUnplacedError } from "../src/save-emissions.mjs";
import { buildSave, emissionsForSave } from "../tools/crossing-save.mjs";

const CLS = {
  version: 2,
  dials: { radius_m: 60, hearing_ttl_min: 5, flood_cap: 20, thread_close_min: 30 },
  gate: { status: "PRESENT" }, disclosed: [], store: { as_of_world: "abc", fresh: true },
};
const { ttlMs, earshotM } = soundMs(CLS);
const MARKS = { "neth/little-free-library": { x: 1329, y: 2083 }, "the-town/the-deck": { x: -412.5, y: 88.25 } };
const centreOf = (id) => MARKS[id] ?? null;
const T0 = Date.parse("2026-09-29T12:00:00.000Z");

// The voices a crossing might hold: a plain one, a human standing with a
// resident, one aboard, one on the world's own anchor (no mark contains it), a
// fractional position, and a second voice from one source in one millisecond.
const VOICES = [
  { handle: "neth", text: "the sixth book is in the box", at: T0 + 1000, x: 1329, y: 2083, place: "the Threshold District", within: "neth/little-free-library" },
  { handle: "human-of-keeminlee", standAs: "mari", text: "hello from a human", at: T0 + 2000, x: 1330.5, y: 2084, place: null, within: "neth/little-free-library" },
  { handle: "gloss", text: "on the deck", at: T0 + 3000, x: -410.75, y: 90.5, place: "the deck", aboard: true, within: "the-town/the-deck" },
  { handle: "wanderer", text: "out in the open", at: T0 + 4000, x: 5021.125, y: -377.3, place: null, within: null },
  { handle: "neth", text: "twice in one millisecond", at: T0 + 5000, x: 1329, y: 2083, place: "the Threshold District", within: "neth/little-free-library" },
  { handle: "neth", text: "the second of the two", at: T0 + 5000, x: 1329, y: 2083, place: "the Threshold District", within: "neth/little-free-library" },
];

/** A voice as the say door writes its act (world.mjs § voiceEntry, § witnessStampAt). */
const actOf = (v, id) => {
  const at = anchorAt({ x: v.x, y: v.y }, { chain: v.within ? [{ id: v.within }] : [], centreOf });
  return {
    id, at: new Date(v.at), actor: v.handle,
    at_anchor: at.anchor, at_dx: at.dx, at_dy: at.dy,
    payload: { text: v.text, place: v.place ?? null, ...(v.aboard ? { aboard: true } : {}), ...(v.standAs ? { stood_with: v.standAs } : {}) },
  };
};

/** The same voices the OLD way: recorded into dynamic.db exactly as emissionFromVoice does. */
function viaDynamic(voices) {
  const dir = mkdtempSync(join(tmpdir(), "save-emissions-"));
  const db = openDynamic(join(dir, "dynamic.db"));
  try {
    for (const v of voices) recordEmission(db, {
      class: "sound", source: v.standAs ?? v.handle, spoken_by: v.handle,
      text: v.text, at: v.at, x: v.x, y: v.y, place: v.place ?? null, aboard: Boolean(v.aboard),
    }, CLS);
    return emissionsBetween(db, new Date(T0).toISOString(), new Date(T0 + 3_600_000).toISOString());
  } finally { db.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
}

const lines = (emissions) => buildSave({
  crossing: 219, boundaryMs: T0, fromMs: T0, toMs: T0 + 3_600_000, crossingMs: 12 * 3_600_000,
  events: [], attachments: [], emissions, walk: { CROSSING_MS: 12 * 3_600_000 }, asOfWorld: "abc",
}).lines.map((l) => JSON.stringify(l)).join("\n");

test("BYTE PARITY: the save writes the same emission lines from the acts as from dynamic.db", () => {
  const old = viaDynamic(VOICES);
  const fromActs = emissionRowsFromActs(VOICES.map((v, i) => actOf(v, 100 + i)), { centreOf, cls: CLS, ttlMs, earshotM });
  assert.equal(old.length, VOICES.length);
  assert.equal(lines(fromActs), lines(old));
});

test("…and the parity is not vacuous: the fixture carries a human, the deck, the open world, a fraction and a same-millisecond pair", () => {
  const rows = emissionRowsFromActs(VOICES.map((v, i) => actOf(v, 100 + i)), { centreOf, cls: CLS, ttlMs, earshotM });
  const byText = Object.fromEntries(rows.map((r) => [r.props.text, r]));
  assert.equal(byText["hello from a human"].source, "mari", "a human's voice is emitted by the resident it stood with");
  assert.equal(byText["hello from a human"].props.human, true);
  assert.equal(byText["on the deck"].props.aboard, true);
  assert.equal(actOf(VOICES[3], 1).at_anchor, WORLD_ANCHOR, "the open-world voice anchors on the world itself");
  assert.deepEqual([byText["out in the open"].x, byText["out in the open"].y], [5021.125, -377.3]);
  assert.deepEqual([byText["twice in one millisecond"].id, byText["the second of the two"].id],
    [`sound:${T0 + 5000}:neth`, `sound:${T0 + 5000}:neth:2`], "the collision suffix follows record order, as recordEmission's does");
});

test("A VOICE THAT CANNOT BE PLACED REFUSES — no guessed x,y reaches a public file", () => {
  const lost = { ...actOf(VOICES[0], 7), at_anchor: "someone/a-mark-that-is-gone" };
  assert.throws(() => emissionRowsFromActs([lost], { centreOf, cls: CLS, ttlMs, earshotM }),
    (e) => e instanceof EmissionUnplacedError && /act 7, neth at someone\/a-mark-that-is-gone/.test(e.message));
});

test("THE SOURCE FOLLOWS THE SAY LANE: flipped, the acts; not flipped, dynamic.db; WORLD_EMISSIONS off, no speech", async () => {
  const dbRows = [{ id: "from-the-file" }];
  const fakeDb = { prepare: () => ({ all: () => dbRows.map((r) => ({ ...r, props: "{}" })) }) };
  const acts = VOICES.slice(0, 1).map((v, i) => actOf(v, i));
  const opts = { fromIso: new Date(T0).toISOString(), toIso: new Date(T0 + 3_600_000).toISOString(), cls: CLS, centres: async () => centreOf, readActs: async () => acts };
  assert.deepEqual((await emissionsForSave(fakeDb, { ...opts, onActs: false })).map((r) => r.id), ["from-the-file"]);
  assert.deepEqual(await emissionsForSave(fakeDb, { ...opts, onActs: true, enabled: false }), []);
  assert.deepEqual((await emissionsForSave(fakeDb, { ...opts, onActs: true, enabled: true })).map((r) => r.id), [`sound:${T0 + 1000}:neth`]);
});
