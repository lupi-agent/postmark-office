// position-snapshot.test.mjs — the positions projection's snapshot per clearing
// plus the delta equals the whole record, byte for byte (POS-302), on a REAL
// Postgres (053 applied by the suite's store).
//
// ── WHAT IS ON TRIAL ────────────────────────────────────────────────────────
//
//   EQUAL       governingOf(departuresAcrossEras(...)) and governingOf over the
//               snapshot path answer the same Map, handle order included, and
//               the snapshot path really stood on a snapshot.
//   THE CLOSE   a read at a window's exact close, where that window's snapshot
//               holds acts that landed after the close, takes the snapshot
//               before it plus the delta up to the instant (Wright 2026-10-02).
//   ONCE        the writer writes a window's snapshot once; a second tick
//               writes nothing.
//   INVERSION   a backfilled act with an early instant and a late id sorts
//               inside the snapshot: it is discarded, disclosed, and the whole
//               record answers (never an append).
//   LATE ID     an act committed under an id at or below the high-water after
//               the snapshot: the recount moves, discarded, disclosed.
//   VERIFY      the writer's --verify reads EQUAL over a kept snapshot.
//   OVERLAP     the record holds store records older than the frozen ledger's
//               newest line (prod held 12 on 2026-10-02): the snapshot keeps
//               their count, and the `disclosed` array equals the whole
//               record's, byte for byte, `era-order-overlap` included.
//   LEDGER      a snapshot measured against a different ledger instant is
//               discarded, disclosed.
//
// ── THE FLIPS (run after the commit; the red lines go in the report) ────────
//
//   1. composeSnapshot skips the sorts-inside check: INVERSION goes red.
//   2. composeSnapshot skips the recount check: LATE ID goes red.
//   3. storeDepartureSnapshot ignores max_iso <= at: THE CLOSE goes red.
//   4. the reader discards a snapshot holding a record older than the ledger's
//      newest line (#330's first shape): OVERLAP goes red.
//
// Run: WORLD_CLONE=<world clone> node --test test/position-snapshot.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { startStore } from "./helpers/embedded-store.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";
import { useGuardReader } from "../src/world2-guards.mjs";
import { normalizeRow } from "../src/world-journal.mjs";
import { governingOf } from "../src/position-projection.mjs";
import { writeSnapshot as write, verifySnapshot, ledgerNewestIso } from "../world2/tools/position-snapshot.mjs";

const FLAGS = ["WORLD_MOVEMENT_V2", "WORLD2_PG", "WORLD2_PG_URL", "POSITIONS_SNAPSHOT"];
const was = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));

const haveClone = existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"));
const store = await startStore({ db: "position_snapshot_test" });
const owner = await store.connect("world2_owner");
const api = await store.connect("office_api");
let restoreReader = null;

before(async () => {
  process.env.WORLD_MOVEMENT_V2 = "1";
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://position-snapshot/none";
  delete process.env.POSITIONS_SNAPSHOT;
  restoreReader = useGuardReader(async (fn) => fn(api));
});
after(async () => {
  restoreReader?.();
  for (const k of FLAGS) if (was[k] == null) delete process.env[k]; else process.env[k] = was[k];
  await api.end(); await owner.end(); await store.stop();
});

const needsClone = (t) => (haveClone ? false : (t.skip(`needs the world clone at ${WORLD_CLONE}`), true));

// ── the record ──────────────────────────────────────────────────────────────
const B = Date.parse("2026-09-26T12:00:00.000Z");
const WHO = ["wright", "rei", "new-a", "new-b", "new-c", "new-d"];
const iso = (t) => new Date(t).toISOString();

/** A walk act, built the way the walk endpoint builds it, inserted as office_api (or as the owner under an explicit id). */
async function walkAt(i, atMs, { id = null, actor = WHO[(i * 5) % WHO.length] } = {}) {
  const { walkEntry } = await import("../src/world.mjs");
  const from = { x: 100 * (i % 7), y: -80 * (i % 5) };
  const row = normalizeRow(walkEntry({
    crossing: 220 + i / 100, who: actor, targetMarkId: null, stampAt: null, witnesses: null,
    from, toward: { x: from.x + 40 + 37 * i, y: from.y - 25 * (i % 3) }, pace: null,
    targetExtent: null, household: null, writtenAt: iso(atMs), declaredBy: actor,
  }));
  const cols = [row.written_at, String(row.crossing), row.actor, row.action, row.class, row.payload];
  if (id == null) {
    await api.query("INSERT INTO acts (at, crossing, actor, action, class, payload) VALUES ($1, $2, $3, $4, $5, $6)", cols);
  } else {
    await owner.query("INSERT INTO acts (id, at, crossing, actor, action, class, payload) OVERRIDING SYSTEM VALUE VALUES ($7, $1, $2, $3, $4, $5, $6)", [...cols, id]);
  }
}

// The candle tiles time: each window opens where the one before it closed.
let lastClose = null;
async function windowClosed(id, closesAt) {
  await owner.query(
    "INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES ($1, $2, $3, 'closed', $3) ON CONFLICT (id) DO NOTHING",
    [id, iso(lastClose ?? closesAt - 12 * 3600_000), iso(closesAt)]);
  lastClose = closesAt;
}

/** Both answers at `atMs`, reduced. */
async function both(atMs) {
  const { departuresAcrossEras } = await import("../src/world.mjs");
  const whole = await departuresAcrossEras(WORLD_CLONE, { atMs });
  const kept = await departuresAcrossEras(WORLD_CLONE, { atMs, fromSnapshot: true });
  return {
    whole, kept,
    same: JSON.stringify([...governingOf(whole.departures)]) === JSON.stringify([...governingOf(kept.departures)]),
    wholeMap: JSON.stringify([...governingOf(whole.departures)]),
    keptMap: JSON.stringify([...governingOf(kept.departures)]),
  };
}

const at = (i) => B + i * 90_000;
// The snapshot is measured against the clone's own frozen ledger, as the keep tick measures it.
let LEDGER = null;
const writeSnapshot = async (client, windowId, opts = {}) =>
  write(client, windowId, { ledgerNewestIso: (LEDGER ??= await ledgerNewestIso(WORLD_CLONE)), ...opts });
// Two store records OLDER than the ledger's newest line (2026-08-10T20:20Z on the
// clone), as prod has twelve: the era-order overlap the whole record discloses.
const EARLY = [Date.parse("2026-08-05T09:00:00.000Z"), Date.parse("2026-08-06T09:00:00.000Z")];
const C1 = at(5) + 30_000;    // window 1 closes after walk 5
const C2 = at(9) + 30_000;    // window 2 closes after walk 9

test("EQUAL and THE CLOSE: snapshot + delta answers the whole record, and a read at a close takes the snapshot before it", async (t) => {
  if (needsClone(t)) return;
  await walkAt(50, EARLY[0], { actor: "new-c" });
  await walkAt(51, EARLY[1], { actor: "early-only" });
  for (let i = 0; i <= 5; i++) await walkAt(i, at(i));
  await windowClosed(1, C1);
  const w1 = await writeSnapshot(api, 1);
  assert.equal(w1.wrote, true);
  for (let i = 6; i <= 9; i++) await walkAt(i, at(i));
  await windowClosed(2, C2);
  // Acts land after window 2 closed and BEFORE its snapshot is taken.
  for (let i = 10; i <= 11; i++) await walkAt(i, at(i));
  const w2 = await writeSnapshot(api, 2);
  assert.equal(w2.wrote, true);
  assert.ok(Date.parse(w2.header.max_iso) > C2, "the fixture must put acts after the close inside window 2's snapshot");

  // At window 2's exact close: window 2's snapshot holds later acts, so window 1's serves, plus walks 6..9.
  const close = await both(C2);
  assert.deepEqual(close.kept.snapshot, { window: 1, delta: 4 }, "the read at the close did not stand on the snapshot before it");
  assert.equal(close.keptMap, close.wholeMap, "at window 2's close the snapshot path moved someone");
  assert.equal(close.kept.store_records, close.whole.store_records);

  // Now, with more acts: window 2's snapshot plus four.
  for (let i = 12; i <= 15; i++) await walkAt(i, at(i));
  const now = await both(at(16));
  assert.deepEqual(now.kept.snapshot, { window: 2, delta: 4 });
  assert.equal(now.keptMap, now.wholeMap, "snapshot + delta is not the whole record");
  assert.deepEqual(now.kept.disclosed, now.whole.disclosed);
  assert.equal(now.kept.store_records, now.whole.store_records);
  // OVERLAP: the whole record says it, and the snapshot path says the same words.
  assert.ok(now.whole.disclosed.some((d) => d.startsWith("era-order-overlap: 2 store record(s)")),
    `the fixture's overlap did not reach the whole record: ${JSON.stringify(now.whole.disclosed)}`);
  assert.equal(JSON.stringify(now.kept.disclosed), JSON.stringify(now.whole.disclosed));
  assert.equal(JSON.stringify(close.kept.disclosed), JSON.stringify(close.whole.disclosed));
  assert.ok(governingOf(now.whole.departures).size >= WHO.length, "the record did not reach every walker");
});

test("ONCE: a second tick writes nothing, and VERIFY reads EQUAL", async (t) => {
  if (needsClone(t)) return;
  const again = await writeSnapshot(api, 2);
  assert.equal(again.wrote, false);
  const { rows: [{ n }] } = await api.query("SELECT count(*)::int AS n FROM position_snapshots");
  assert.equal(n, 2);
  const v = await verifySnapshot(api, { atMs: at(16) });
  assert.equal(v.verdict, "EQUAL", JSON.stringify(v));
  assert.equal(v.window, 2);
});

test("INVERSION: a backfilled act sorting inside the snapshot discards it, says so, and the whole record answers", async (t) => {
  if (needsClone(t)) return;
  // Walk 3's instant plus a second, under a late id: new-a's leg from INSIDE window 1's span.
  await walkAt(99, at(3) + 1000, { actor: "new-a" });
  const got = await both(at(16));
  assert.equal(got.kept.snapshot, undefined, "an inverted act was appended to the snapshot");
  assert.ok(got.kept.disclosed.some((d) => /^positions-snapshot-discarded: act \d+ sorts inside window 2's snapshot/.test(d)),
    `no discard was disclosed: ${JSON.stringify(got.kept.disclosed)}`);
  assert.equal(got.keptMap, got.wholeMap);
  const v = await verifySnapshot(api, { atMs: at(16) });
  assert.equal(v.verdict, "DISCARDED");

  // The next clearing's snapshot holds it, and the snapshot path stands again.
  await windowClosed(3, at(16));
  assert.equal((await writeSnapshot(api, 3)).wrote, true);
  const after3 = await both(at(16));
  assert.deepEqual(after3.kept.snapshot, { window: 3, delta: 0 });
  assert.equal(after3.keptMap, after3.wholeMap);
});

test("LATE ID: an act committed under an id at or below the high-water discards the snapshot", async (t) => {
  if (needsClone(t)) return;
  await walkAt(77, at(17), { id: -1, actor: "new-b" });
  const got = await both(at(18));
  assert.equal(got.kept.snapshot, undefined, "a late act under a low id was missed");
  assert.ok(got.kept.disclosed.some((d) => /^positions-snapshot-discarded: a departure act committed under an id at or below/.test(d)),
    `no discard was disclosed: ${JSON.stringify(got.kept.disclosed)}`);
  assert.equal(got.keptMap, got.wholeMap);
});

test("POSITIONS_SNAPSHOT=off reads the whole record and says nothing", async (t) => {
  if (needsClone(t)) return;
  await windowClosed(4, at(18));
  await writeSnapshot(api, 4);
  process.env.POSITIONS_SNAPSHOT = "off";
  try {
    const got = await both(at(19));
    assert.equal(got.kept.snapshot, undefined);
    assert.ok(!got.kept.disclosed.some((d) => d.startsWith("positions-snapshot")));
    assert.equal(got.keptMap, got.wholeMap);
  } finally { delete process.env.POSITIONS_SNAPSHOT; }
  const on = await both(at(19));
  assert.deepEqual(on.kept.snapshot, { window: 4, delta: 0 });
});

test("THE PROJECTION: its rebuild stands on the snapshot, and keeps the same governing records", async (t) => {
  if (needsClone(t)) return;
  const world = await import("../src/world.mjs");
  const { departuresAcrossEras } = world;
  world.positionProjection.invalidate();
  try {
    const kept = await world.positionProjection.snapshot();
    assert.deepEqual(kept.snapshot?.window, 4, `the projection's rebuild did not read window 4's snapshot: ${JSON.stringify(kept.snapshot)}`);
    const whole = await departuresAcrossEras(WORLD_CLONE);
    assert.equal(JSON.stringify(kept.departures), JSON.stringify([...governingOf(whole.departures).values()]),
      "the projection's governing records differ from the whole record's");
  } finally { world.positionProjection.invalidate(); }
});

test("LEDGER: a snapshot measured against another ledger instant is discarded, disclosed", async (t) => {
  if (needsClone(t)) return;
  await windowClosed(5, at(19));
  await writeSnapshot(api, 5, { ledgerNewestIso: "2026-08-11T00:00:00.000Z" });
  const got = await both(at(20));
  assert.equal(got.kept.snapshot, undefined, "a snapshot measured against another ledger was used");
  assert.ok(got.kept.disclosed.some((d) => /^positions-snapshot-discarded: the frozen ledger's newest line moved since window 5's snapshot/.test(d)),
    JSON.stringify(got.kept.disclosed));
  assert.equal(got.keptMap, got.wholeMap);
});

test("THE REF: the writer measures the ledger at mainRef, so a clone holding only origin/main still writes", async (t) => {
  if (needsClone(t)) return;
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { execFileSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "pos302-ref-"));
  try {
    const clone = join(dir, "w");
    execFileSync("git", ["clone", "--quiet", "--local", WORLD_CLONE, clone]);
    execFileSync("git", ["-C", clone, "checkout", "--quiet", "--detach"]);
    if (execFileSync("git", ["-C", clone, "branch", "--list", "main"], { encoding: "utf8" }).trim())
      execFileSync("git", ["-C", clone, "branch", "--quiet", "-D", "main"]);
    assert.ok(execFileSync("git", ["-C", clone, "rev-parse", "--verify", "--quiet", "refs/remotes/origin/main"], { encoding: "utf8" }).trim(),
      "the fixture has no origin/main to fall back to");
    assert.equal(execFileSync("git", ["-C", clone, "branch", "--list", "main"], { encoding: "utf8" }).trim(), "", "the fixture still has a local main");
    assert.equal(await ledgerNewestIso(clone), await ledgerNewestIso(WORLD_CLONE));
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
