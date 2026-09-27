// era-seam.test.mjs — THE READERS MUST SEE BOTH ERAS.
//
//   node --test test/era-seam.test.mjs
//
// The walk ledger is frozen with honor and `dynamic.db/movements` is era two.
// The write path landed working and every LIVE READ still assembled departures
// from `parseWalkLedger` alone — so on the day of the freeze, twenty-seven
// residents had an ashore record in the store that no reader consulted:
//
//   world_walkers   served them at the berth they had left (-34.5, 35.5)
//   /world/present  could not find them at all — the frame fold, reading only
//                   era one, re-derived them onto a boat that had since sailed,
//                   so they did not read as misplaced, they read as GONE
//
// One question, four derivations, live. Issue #7's disease one layer down and
// across a seam. The cure is the same: ONE function
// (`world.mjs § departuresAcrossEras`) and every site calls it.
//
// The fixture is the exact shape that broke: an era-1 line walking a resident
// onto the vessel's own footprint, and a NEWER era-2 movement setting them
// ashore. Every reader must answer ashore, and with the flag off every reader
// must answer exactly what it answered before era two existed.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic } from "../src/dynamic-store.mjs";
import { dedupeRecords, recordsAcrossEras, storedDepartures, storedRecordsFor } from "../src/world-movement.mjs";
import { useGuardReader } from "../src/world2-guards.mjs";
import { positionsAt } from "../src/dynamic-presence.mjs";

const dir = mkdtempSync(join(tmpdir(), "era-seam-"));
const DB = join(dir, "dynamic.db");
after(() => rmSync(dir, { recursive: true, force: true }));

// The two records, as the town actually holds them.
const DECK = { x: -34.5, y: 35.5 };     // era 1: the ceremony line's arrival, on her footprint
const ASHORE = { x: -24.8, y: 45.2 };   // era 2: the freeze's filing repair, beside the berth
const ERA1_ISO = "2026-08-09T12:00:00.000Z";
const ERA2_ISO = "2026-08-10T20:22:00.000Z";

const era1 = (handle) => ({
  iso: ERA1_ISO, handle,
  from: { x: -94570, y: -94570 }, toward: DECK,
  at: 117.0, targetExtent: { w: 9, h: 26 }, targetMarkId: "the-town/the-post-office", pace: 405,
});

// ── ERA TWO IS THE RECORD NOW, NOT A FILE ───────────────────────────────────
//
// POS-154: `storedDepartures` folded `dynamic.db/movements` and reads `acts`
// through the read worker's road. The fixture below is the same five departures
// this file always seeded — four residents set down ashore at the freeze, and
// wright's zero-metre record — written as the acts the movement-store pen files,
// so every assertion here is unchanged and only the pen that wrote them moved.
//
// The sqlite file survives for ONE reason: `positionsAt` reads the `entities`
// table out of it, which is a different reader on a different row of the
// inventory and not this lane's. It is created EMPTY and is never the source of
// a departure again.
openDynamic(DB).close();

const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
process.env.WORLD2_PG = "1";
process.env.WORLD2_PG_URL = "postgres://era-seam-test/none";
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

/** One movement-store act, shaped as `pg` hands it over. */
const act = ({ id, actor, at, from, toward, crossing = 118.5 }) => ({
  id, at: new Date(at), crossing: String(crossing), actor, action: "walk",
  payload: { from, toward, within: null, to: null, pace: null, declared_by: actor, source: "dynamic.db/movements" },
});

const FREEZE_ACTS = [
  ...["hal", "limen", "aion-solare", "caelum-reeves"].map((h, i) =>
    act({ id: 100 + i, actor: h, at: ERA2_ISO, from: ASHORE, toward: ASHORE })),
  // wright's zero-metre record: he is standing where he stood, and the seam
  // must not move him. (The acceptance check names him.)
  act({ id: 200, actor: "wright", at: ERA2_ISO, from: { x: 575, y: -2600 }, toward: { x: 575, y: -2600 } }),
];

/** A record that answers the departure query, and one that will not be reached. */
function recording(rows = FREEZE_ACTS, { throws = null } = {}) {
  return useGuardReader(async (fn) => fn({
    query: async (sql, params) => {
      if (throws) throw throws;
      if (!/FROM acts/i.test(String(sql))) return { rows: [] };
      const actions = params?.[0] ?? [];
      return { rows: rows.filter((r) => actions.includes(r.action)) };
    },
  }));
}

// ── the store read ───────────────────────────────────────────────────────────

test("the store yields era-two departures in the LEDGER'S own shape", async () => {
  const restore = recording();
  try {
    const { records, absent } = await storedDepartures({});
    assert.equal(absent, null);
    assert.equal(records.length, 5);
    const hal = records.find((r) => r.handle === "hal");
    // The shape is what walk.mjs reads — `targetExtent`/`targetMarkId`, not the
    // store's own `within`/`to`. One converter, or the two eras are two languages.
    assert.deepEqual(Object.keys(hal).sort(),
      ["at", "from", "handle", "iso", "pace", "source", "targetExtent", "targetMarkId", "toward"]);
    assert.deepEqual(hal.toward, ASHORE);
    assert.equal(hal.source, "store");
  } finally { restore(); }
});

test("a record that cannot be reached is era-one-only, DISCLOSED, never a throw", async () => {
  const restore = recording(FREEZE_ACTS, { throws: new Error("the record is not reachable from here") });
  try {
    const { records, absent } = await storedDepartures({});
    assert.deepEqual(records, []);
    assert.match(absent, /not reachable/);
  } finally { restore(); }
});

test("the per-handle slice is the same records, filtered", async () => {
  const restore = recording();
  try {
    assert.deepEqual((await storedRecordsFor("hal", {})).map((r) => r.toward), [ASHORE]);
    assert.deepEqual(await storedRecordsFor("nobody", {}), []);
  } finally { restore(); }
});

// ── the merge ────────────────────────────────────────────────────────────────
//
// `departuresAcrossEras` lives in world.mjs and reaches for a world clone, so
// the ORDERING RULE it implements is proved here directly on the same inputs.
// What must hold: newer wins, and `currentDeparture` (last match in array
// order) therefore answers with era two.

// THE SHIPPED LAW, NOT A COPY OF IT. An earlier draft of this file re-implemented
// the merge locally, which is a test that passes while the thing it names is
// broken — the one failure mode a falsifier may not have. `departuresAcrossEras`
// reads a world clone for era one, so the ledger half is injected and the STORE
// half and the ORDERING RULE are the real ones.
const mergeEras = (ledger, stored) => recordsAcrossEras(ledger, stored);

test("era two lands AFTER era one, so latest-wins answers ashore", async () => {
  const restore = recording();
  try {
    const merged = mergeEras([era1("hal")], await storedRecordsFor("hal", {}));
    assert.equal(merged.length, 2);
    assert.deepEqual(merged.at(-1).toward, ASHORE, "the last match is the one the engine takes");
    assert.deepEqual(merged[0].toward, DECK);
  } finally { restore(); }
});

test("a tie goes to the store — the ledger cannot gain a line after the freeze", async () => {
  const restore = recording();
  try {
    const sameInstant = { ...era1("hal"), iso: ERA2_ISO };
    const merged = mergeEras([sameInstant], await storedRecordsFor("hal", {}));
    assert.equal(merged.at(-1).source, "store");
  } finally { restore(); }
});

test("APPENDED, not sorted — era one keeps the order it was written in", () => {
  // The first draft of this reader sorted the merged list by instant, which
  // looks safer and is not: the ledger is append-only and "latest wins" means
  // latest APPENDED. Those orders disagree in the real ledger (the 08-08 sailing
  // filed every passenger at 18:00:00.000Z, appended after walks stamped 18:16),
  // so sorting silently changed which leg governed. Era one keeps its own order.
  const outOfOrder = [
    { ...era1("hal"), iso: "2026-08-09T18:16:00.000Z", toward: { x: 9, y: 9 } },
    { ...era1("hal"), iso: "2026-08-09T18:00:00.000Z", toward: { x: 1, y: 1 } },
  ];
  const merged = recordsAcrossEras(outOfOrder, []);
  assert.deepEqual(merged.map((r) => r.toward), [{ x: 9, y: 9 }, { x: 1, y: 1 }],
    "the file's order survives the merge — a reader may not re-decide which record governs");
});

// ── the presence fold ────────────────────────────────────────────────────────

test("presence reads era two at the instant it is asked, not at the last refresh", async () => {
  // The exact failure: the entities table is a crystallization refreshed on a
  // tick, so between the freeze and the next refresh it holds only era one.
  // `stored` is merged at read time, so presence answers ashore anyway.
  const db = openDynamic(DB, { readOnly: true });
  const walk = {
    fractionalCrossing: () => 119.0,
    positionAt: () => ({ x: ASHORE.x, y: ASHORE.y, arrived: true, standing: true, remainingM: 0, etaCrossings: 0 }),
  };
  const where = {
    // A faithful stand-in for the engine's join: walk-first, last record wins.
    publicResidents: (handles, { departures }) => [...new Set(handles)].map((h) => {
      const mine = departures.filter((d) => d.handle === h).at(-1);
      return mine && { handle: h, x: mine.toward.x, y: mine.toward.y, source: "walk", moving: false, remaining_m: 0, eta_crossings: 0 };
    }).filter(Boolean),
  };
  const restore = recording();
  let stored;
  try { stored = (await storedDepartures({ atMs: Date.parse("2026-08-11T00:00:00Z") })).records; }
  finally { restore(); }

  // The entities table is STALE — it holds era one only, which is what a
  // presence read between the freeze and the next refresh actually saw.
  const staleRows = positionsAt(db, Date.parse("2026-08-11T00:00:00Z"), walk, null, {
    world: { parcels: [] }, where, frames: null, stored: null,
  });
  db.close();
  // Without era two nothing here can answer ashore — the fixture has to be able
  // to fail, or the assertion below proves nothing.
  assert.equal(staleRows.length, 0, "the stale path sees no departures at all from an empty entities table");

  const db2 = openDynamic(DB, { readOnly: true });
  const fresh = positionsAt(db2, Date.parse("2026-08-11T00:00:00Z"), walk, null, {
    world: { parcels: [] }, where, frames: null, stored,
  });
  db2.close();
  const hal = fresh.find((r) => r.handle === "hal");
  assert.ok(hal, "era two alone is enough to place a resident the entities table has never seen");
  assert.deepEqual({ x: hal.x, y: hal.y }, ASHORE);
});

test("the acceptance set lands ashore, and wright's zero-metre record does not move him", async () => {
  const restore = recording();
  try {
    const stored = (await storedDepartures({})).records;
    for (const h of ["hal", "limen", "aion-solare", "caelum-reeves"]) {
      const merged = mergeEras([era1(h)], stored.filter((r) => r.handle === h));
      assert.deepEqual(merged.at(-1).toward, ASHORE, `${h} must read ashore`);
    }
    const w = stored.find((r) => r.handle === "wright");
    assert.deepEqual(w.from, w.toward, "a zero-distance departure is 'I am standing here'");
    assert.deepEqual(w.toward, { x: 575, y: -2600 });
  } finally { restore(); }
});

// ── the flag ─────────────────────────────────────────────────────────────────

test("FLAG OFF: era two is not read, and the answer is era one's alone", async () => {
  const was = process.env.WORLD_MOVEMENT_V2;
  delete process.env.WORLD_MOVEMENT_V2;
  const restore = recording();
  try {
    // The reader is gated by the flag at its call sites; what this pins is that
    // the store read itself is a pure function of the record and never of the
    // flag — so flipping the flag changes which records are CONSULTED, never
    // which records EXIST. Nobody's declaration is lost by switching off.
    const { records } = await storedDepartures({});
    assert.equal(records.length, 5, "the rows are still there; the flag decides who looks");
  } finally {
    restore();
    if (was === undefined) delete process.env.WORLD_MOVEMENT_V2; else process.env.WORLD_MOVEMENT_V2 = was;
  }
});

// ── the acceptance case, end to end, against a REAL carrier ──────────────────
//
// "Vanished aboard" was the live symptom, so a fixture that never builds a
// carrier cannot reproduce it. This one uses the timetabled vessel from
// `movement-fixture.mjs`: an era-1 arrival on her footprint, and a NEWER era-2
// ashore record. The frame fold must see BOTH — reading era one alone used to
// re-derive the resident onto a boat that has since sailed, which is not a wrong
// position, it is a disappearance. Since POS-247 (2026-09-26) a walk never
// boards, so era one alone leaves him on the quay.

import { carriersFrom, carrierReader, recordsAcrossEras as acrossEras, vesselServiceFrom } from "../src/world-movement.mjs";
import { foldFrames } from "../src/world-frames.mjs";
import { withFrames } from "../src/positions.mjs";
import { atCrossing, fixtureMarks, makeWorldClone } from "./movement-fixture.mjs";

const carrierClone = makeWorldClone();
after(() => carrierClone.cleanup());
const CARRIER_MARKS = { marks: fixtureMarks() };
const CARRIER_REPO = { repo: carrierClone.dir };

// She is berthed at the quay from fc 9.6 to 10.5, sails 10.5, lands 10.6.
const ABOARD_ISO = new Date(atCrossing(10.0)).toISOString();
const STEPPED_OFF_ISO = new Date(atCrossing(10.2)).toISOString();
const DECK_POINT = { x: 2, y: 3 };        // inside her 10x26 footprint at the quay
const SHORE_POINT = { x: 60, y: 0 };      // clear of her

const era1Aboard = (handle) => ({
  iso: ABOARD_ISO, handle, from: SHORE_POINT, toward: DECK_POINT,
  at: 10.0, targetExtent: null, targetMarkId: null, pace: null,
});
const era2Ashore = (handle) => ({
  iso: STEPPED_OFF_ISO, handle, from: DECK_POINT, toward: SHORE_POINT,
  at: 10.2, targetExtent: null, targetMarkId: null, pace: null, source: "store",
});

async function foldFor(records, atMs) {
  const { service, mod, walk } = await vesselServiceFrom(CARRIER_MARKS, CARRIER_REPO);
  const carrierAt = carrierReader(CARRIER_MARKS, { repo: carrierClone.dir, service, mod });
  return foldFrames(records, { carriers: carriersFrom(CARRIER_MARKS), carrierAt, walk, atMs });
}

test("ERA ONE ALONE no longer sails anyone away — a walk onto her deck never boarded (POS-247)", async () => {
  const mid = atCrossing(10.55);          // she is under way
  const fold = await foldFor(acrossEras([era1Aboard("hal")], []), mid);
  assert.equal(fold.frame, null, "the walk ended on her deck and hal stayed on the quay");
  assert.deepEqual(fold.world, DECK_POINT, "he is where the walk ended, not out at sea with her");
});

test("BOTH ERAS: the same resident is ashore, and stays there while she sails", async () => {
  const mid = atCrossing(10.55);
  const records = acrossEras([era1Aboard("hal"), era2Ashore("hal")], []);
  const fold = await foldFor(records, mid);
  assert.equal(fold.frame, null, "he stepped off, so his frame is the world again");
  assert.deepEqual(fold.world, SHORE_POINT, "and he is where he walked to, not where she went");
});

test("the walkers overlay puts him ashore, not aboard", async () => {
  const mid = atCrossing(10.55);
  const fold = await foldFor(acrossEras([era1Aboard("hal"), era2Ashore("hal")], []), mid);
  const rows = withFrames(
    [{ handle: "hal", x: DECK_POINT.x, y: DECK_POINT.y, source: "walk", moving: false, remaining_m: 0, eta_crossings: 0 }],
    fold.frame ? new Map([["hal", fold]]) : new Map(),
  );
  assert.equal(rows[0].aboard, undefined, "no frame means no aboard flag and no relocation");
  assert.deepEqual({ x: rows[0].x, y: rows[0].y }, DECK_POINT);
});

test("a resident whose ONLY record is era two is still folded", async () => {
  // Someone who first moved after the freeze has no ledger line at all. Grouping
  // the roster by era-one departures would never reach them.
  const walked = { ...era2Ashore("newcomer"), toward: DECK_POINT, from: SHORE_POINT, iso: ABOARD_ISO, at: 10.0 };
  const fold = await foldFor(acrossEras([], [walked]), atCrossing(10.3));
  assert.notEqual(fold.provenance, "never-moved", "the era-two record was read");
  assert.equal(fold.frame, null, "and a walk onto her deck boards nobody (POS-247)");
  assert.deepEqual(fold.world, DECK_POINT);
});

// ── the de-dup (finding 4, made deliberate) ──────────────────────────────────

test("the same era-two record arriving twice is ONE record", async () => {
  // Both callers of `recordsAcrossEras` take injected records and then add the
  // store's themselves, so since the doors began passing era-spanning records in
  // the store half arrives twice. `foldFrames` is idempotent over repeated
  // arrivals — but `transitions` is a COUNT, and the `happened` shelf reads it.
  const stored = [era2Ashore("hal")];
  const doubled = acrossEras([era1Aboard("hal"), ...stored], stored);
  assert.equal(doubled.length, 2, "the duplicate is collapsed, not carried");
});

test("de-dup keeps genuinely distinct records — it keys on the whole record, not the instant", () => {
  // The ceremony lines all share one ISO across different handles, and two legs
  // in one millisecond is legal even if nobody has ever done it.
  const a = { era: "store", handle: "a", iso: ABOARD_ISO, from: { x: 0, y: 0 }, toward: { x: 1, y: 1 }, at: 10 };
  const b = { ...a, handle: "b" };
  const c = { ...a, toward: { x: 2, y: 2 } };
  assert.equal(dedupeRecords([a, b, c, { ...a }]).length, 3);
});

// ── flag-off, AT THE DOORS ───────────────────────────────────────────────────

import { existsSync } from "node:fs";
import { departuresAcrossEras, worldWalkers } from "../src/world.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";

const withFlag = async (on, fn) => {
  const was = process.env.WORLD_MOVEMENT_V2;
  if (on) process.env.WORLD_MOVEMENT_V2 = "1"; else delete process.env.WORLD_MOVEMENT_V2;
  try { return await fn(); }
  finally { if (was === undefined) delete process.env.WORLD_MOVEMENT_V2; else process.env.WORLD_MOVEMENT_V2 = was; }
};

test("FINDING 3: a clone with no ledger answers the SAME SHAPE it always did", async () => {
  // `worldWalkers` used to let `parseWalkLedger` throw and return
  // `{ at, walkers: [], standing: [] }` — `standing` included, empty. The
  // era-spanning reader catches that throw internally, because era two can
  // answer even when era one cannot; that silently made the branch unreachable
  // and dropped a key from the reply. Both flags must answer the old shape.
  const nowhere = join(dir, "not-a-world-clone");
  for (const on of [false, true]) {
    const r = await withFlag(on, () => worldWalkers(nowhere));
    assert.deepEqual(Object.keys(r).sort(), ["at", "standing", "walkers"],
      `flag ${on ? "on" : "off"}: the missing-ledger reply keeps its shape`);
    assert.deepEqual(r.walkers, []);
    assert.deepEqual(r.standing, []);
  }
});

test("FLAG OFF at the door: the record is never consulted, whatever it holds", async () => {
  // The record here has five departures. With the flag off the reader must
  // return era one alone and say so — not "era one because the record happened
  // to be empty", which is the same answer for the wrong reason.
  //
  // POS-154: this pointed `WORLD_DYNAMIC_DB` at the seeded file. Era two is the
  // store now, so the fixture reader is what makes era two non-empty, and the
  // claim is unchanged: flag off must not consult it.
  const restore = recording();
  try {
    if (!existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"))) return;   // no clone: the door test below covers the shape
    const off = await withFlag(false, () => departuresAcrossEras(WORLD_CLONE));
    const on = await withFlag(true, () => departuresAcrossEras(WORLD_CLONE));
    assert.deepEqual(off.eras, ["ledger"], "flag off names one era");
    assert.equal(off.store_records, undefined, "and never counted the record");
    assert.ok(on.departures.length > off.departures.length,
      `flag on must actually add the record's departures (${off.departures.length} -> ${on.departures.length})`);
    // NOT a prefix: the merge SORTS BY INSTANT, so era-two records interleave
    // with the ledger's later lines rather than landing in a block at the end.
    // (This assertion originally claimed prefix and the test caught it.) What
    // byte-identity actually means here is that era one survives untouched and
    // in order underneath — the flag adds records, it never edits them.
    assert.deepEqual(on.departures.filter((d) => d.source !== "store"), off.departures,
      "era one is carried through unchanged and in the same order");
  } finally { restore(); }
});

test("the disclosure REACHES the reply rather than being assembled and dropped", async () => {
  const was = process.env.WORLD_DYNAMIC_DB;
  process.env.WORLD_DYNAMIC_DB = join(dir, "no-store-at-all.db");
  try {
    const r = await withFlag(true, () => departuresAcrossEras(join(dir, "not-a-world-clone")));
    assert.ok(r.disclosed.some((d) => d.startsWith("walk-ledger-unreadable")),
      "an unreadable ledger is named, not swallowed");
    assert.ok(r.ledgerUnreadable, "and the caller can branch on it — that is what restores the old shape");
  } finally {
    if (was === undefined) delete process.env.WORLD_DYNAMIC_DB; else process.env.WORLD_DYNAMIC_DB = was;
  }
});
