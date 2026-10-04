// era-one-from-the-store.test.mjs — the store's `_ledger` rows can stand for the
// git walk ledger (POS-302 PR 3), proven on a REAL Postgres built from the world
// clone the way prod's store was: the journal's departures (seed-import's
// `deriveActs`), then the frozen ledgers (`ledger-backfill`).
//
// Wright, 2026-10-02: era one has two owners today, the git ledger (the
// projection) and the store's `_ledger` rows (the 2.0 endpoints); git reads are
// what we are retiring, so the store's rows become the one source, proven equal
// before the git read goes.
//
// ── WHAT IS ON TRIAL ────────────────────────────────────────────────────────
//
//   THE CONVERTER  every `_ledger` row, through `ledgerRecordOf`, equals its git
//                  line field for field and key for key.
//   THE PARTITION  the store carries exactly the lines older than the journal's
//                  first row; the rest are journal rows already (measured on
//                  59c77d2b: 304 + 13 of 317).
//   THE RECORD     governingOf(git ledger ++ store non-ledger) equals
//                  governingOf(store _ledger ++ store non-ledger), handle order
//                  included. The literal "_ledger's governing equals the git
//                  ledger's" is false by design (the 13 overlap lines govern
//                  from the journal), so the record is what is held equal.
//
// ── THE FLIP (run after the commit; the red line goes in the report) ────────
//
//   `ledgerRecordOf` passes `targetExtent` through as stored: THE CONVERTER goes
//   red (jsonb's `{ h, w }` against the parse's `{ w, h }`).
//
// Run: WORLD_CLONE=<world clone> node --test test/era-one-from-the-store.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";
import { mainRef, readAtRef } from "../src/world-branches.mjs";
import { useGuardReader, storeLedgerDepartures } from "../src/world2-guards.mjs";
import { storedDepartures } from "../src/world-movement.mjs";
import { governingOf } from "../src/position-projection.mjs";
import { deriveActs } from "../world2/tools/seed-import.mjs";
import { deriveLedgerActs, backfill } from "../world2/tools/ledger-backfill.mjs";

const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL"];
const was = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
const haveClone = existsSync(join(WORLD_CLONE, "STATE", "log")) && existsSync(join(WORLD_CLONE, "WORLD", "walk-ledger.md"));

const store = await startStore({ db: "era_one_test" });
const owner = await store.connect("world2_owner");
const api = await store.connect("office_api");
let restoreReader = null;
let git = null;          // parseWalkLedger over the ledger at main
let fill = null;         // the backfill's receipt

const CHUNK = 400;
async function insertActs(rows) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = [], params = [];
    slice.forEach((a, n) => {
      const b = n * 6;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
      params.push(a.at, a.crossing, a.actor, a.action, a.class, JSON.stringify(a.payload));
    });
    await owner.query(`INSERT INTO acts (at, crossing, actor, action, class, payload) VALUES ${values.join(", ")}`, params);
  }
}

before(async () => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://era-one/none";
  restoreReader = useGuardReader(async (fn) => fn(api));
  if (!haveClone) return;
  // The journal's departures, as seed-import derived them. The boundary the
  // backfill partitions on is the earliest journal row of ANY type; the
  // departures alone are inserted, so the test asserts they start it.
  const { rows } = deriveActs({ worldRepo: WORLD_CLONE });
  const deps = rows.filter((r) => r.action === "legacy:departure");
  assert.equal(deps[0].at, rows[0].at, "the journal's first row is not a departure, so a departures-only fixture would move the boundary");
  await insertActs(deps);
  fill = await backfill(owner, await deriveLedgerActs({ worldRepo: WORLD_CLONE }));
  const { parseWalkLedger } = await import(pathToFileURL(join(WORLD_CLONE, "tools", "walk.mjs")).href);
  // The git side at the office's own ref, as --compare-era-one reads it (152309c): a
  // clone holding only origin/main has no `main` for `git show main:` to name.
  git = parseWalkLedger(readAtRef(WORLD_CLONE, mainRef(WORLD_CLONE), "WORLD/walk-ledger.md")).departures;
});
after(async () => {
  restoreReader?.();
  for (const k of FLAGS) if (was[k] == null) delete process.env[k]; else process.env[k] = was[k];
  await api.end(); await owner.end(); await store.stop();
});

const needsClone = (t) => (haveClone ? false : (t.skip(`needs the world clone's STATE/log and walk ledger at ${WORLD_CLONE}`), true));

test("THE CONVERTER and THE PARTITION: each _ledger row is its git line, key for key; the rest are journal rows", async (t) => {
  if (needsClone(t)) return;
  const stored = await storeLedgerDepartures();
  assert.equal(stored.length, fill.departures_inserted);
  assert.equal(stored.length + fill.departures_already_in_journal, git.length, "the backfill's two halves do not make the ledger");
  // The carried lines are the ledger's head, in its own order.
  for (let i = 0; i < stored.length; i++) {
    assert.equal(JSON.stringify(stored[i]), JSON.stringify(git[i]), `ledger line ${i + 1} (${git[i].handle}) differs through the store`);
  }
  const boundary = Date.parse(fill.journal_begins);
  assert.ok(git.slice(stored.length).every((d) => Date.parse(d.iso) >= boundary), "a line the store left out is older than the journal");
});

test("THE OVERLAP, NAMED: 13 lines over 8 handles, none of them ONLY in the overlap, and 12 of them are the walkers door's era-order-overlap", async (t) => {
  if (needsClone(t)) return;
  const stored = await storeLedgerDepartures();
  const overlap = git.slice(stored.length);
  const handles = [...new Set(overlap.map((d) => d.handle))];
  assert.equal(overlap.length, 13, "the backfill left a different number of lines to the journal; re-measure before trusting the merge");
  assert.deepEqual(handles, ["postmaster", "jetto-of-starforge", "wright", "sol-am-lichterfenster", "vermillion", "rei", "spark-the-builder", "dylan"]);
  // The load-bearing half: a handle that appeared ONLY in the overlap would take
  // a different first-appearance place when era one comes from the store.
  const head = new Set(stored.map((d) => d.handle));
  assert.deepEqual(handles.filter((h) => !head.has(h)), [], "a handle appears only in the overlap: the store's era one would move its place");
  // #330's `era-order-overlap: 12`: the store records older than the ledger's newest line.
  const newest = git.reduce((m, d) => Math.max(m, Date.parse(d.iso) || 0), 0);
  const { records } = await storedDepartures({ atMs: Date.now() });
  const older = records.filter((r) => (Date.parse(r.iso) || 0) < newest);
  assert.equal(older.length, 12);
  const key = (d) => `${d.iso}|${d.handle}`;
  const overlapKeys = new Set(overlap.map(key));
  assert.ok(older.every((r) => overlapKeys.has(key(r))), "an older store record is not one of the overlap's lines");
});

test("THE RECORD: the store's era one, with the store's other eras, governs every handle as the git ledger does", async (t) => {
  if (needsClone(t)) return;
  const stored = await storeLedgerDepartures();
  const { records, absent } = await storedDepartures({ atMs: Date.now() });
  assert.equal(absent, null, absent);
  assert.ok(records.length > 1000, `only ${records.length} journal records; the fixture is not the record`);
  const fromGit = governingOf([...git, ...records]);
  const fromStore = governingOf([...stored, ...records]);
  assert.equal(JSON.stringify([...fromStore]), JSON.stringify([...fromGit]), "the store's era one moves a governing leg or a handle's place");
  // And the literal form, for the record: era one alone differs exactly on the overlap's handles.
  const alone = (list) => governingOf(list);
  const differ = [...alone(git)].filter(([h, d]) => JSON.stringify(alone(stored).get(h)) !== JSON.stringify(d)).map(([h]) => h);
  const overlapHandles = [...new Set(git.slice(stored.length).map((d) => d.handle))];
  assert.ok(differ.every((h) => overlapHandles.includes(h)), `era one alone differs outside the overlap: ${differ}`);
});

test("THE BOX COMMAND: --compare-era-one runs as snapshot_reader, read-only, on a store without 053, and refuses any other role", async (t) => {
  if (needsClone(t)) return;
  const { spawnSync } = await import("node:child_process");
  const tool = join(WORLD_CLONE, "..", "world2", "tools", "position-snapshot.mjs");
  const run = (role) => spawnSync(process.execPath, [tool, "--compare-era-one", "--world-repo", WORLD_CLONE, "--pg-url", store.url(role)],
    { encoding: "utf8", env: { ...process.env, WORLD2_PG_URL: "", PGUSER: "", PGDATABASE: "" } });
  // WITHOUT 053, as prod stands until Sunday: the compare reads only `acts` and git.
  await owner.query("ALTER TABLE position_snapshot_rows RENAME TO pos302_hidden_rows");
  await owner.query("ALTER TABLE position_snapshots RENAME TO pos302_hidden");
  let ok;
  try {
    const { rows: [{ gone }] } = await owner.query("SELECT to_regclass('position_snapshots') IS NULL AS gone");
    assert.equal(gone, true, "the fixture still has 053");
    ok = run("snapshot_reader");
  } finally {
    await owner.query("ALTER TABLE pos302_hidden RENAME TO position_snapshots");
    await owner.query("ALTER TABLE pos302_hidden_rows RENAME TO position_snapshot_rows");
  }
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  assert.match(ok.stdout, /^era one · EQUAL · \d+ _ledger row\(s\) against \d+ git line\(s\)/);
  const refused = run("office_api");
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /connects as snapshot_reader only; this connection is office_api/);
});

test("THE COMMAND: --compare-era-one reads EQUAL on this record, and DIFFERENT once the store carries a line git does not", async (t) => {
  if (needsClone(t)) return;
  const { compareEraOne } = await import("../world2/tools/position-snapshot.mjs");
  const ok = await compareEraOne(api, { worldRepo: WORLD_CLONE });
  assert.equal(ok.verdict, "EQUAL", JSON.stringify({ lines: ok.lines.slice(0, 2), governing: ok.governing.slice(0, 2) }));
  assert.equal(ok.carried + fill.departures_already_in_journal, ok.git);
  // The positive control: a `_ledger` line the git ledger never had.
  const last = git[0];
  await owner.query(
    "INSERT INTO acts (at, crossing, actor, action, class, payload) VALUES ($1, $2, $3, 'legacy:departure', 'legacy', $4)",
    ["2026-07-01T00:00:00.000Z", last.at, "not-in-git", JSON.stringify({ ...last, handle: "not-in-git", iso: "2026-07-01T00:00:00.000Z", _ledger: "WORLD/walk-ledger.md" })]);
  const bad = await compareEraOne(api, { worldRepo: WORLD_CLONE });
  assert.equal(bad.verdict, "DIFFERENT");
  assert.ok(bad.governing.length > 0, "a handle git never had did not move the governing places");

  // THE WRITER REFUSES over a store whose era one is not the git ledger's: no snapshot, so the office reads the whole record.
  await owner.query("INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES (1, $1, $2, 'closed', $2)",
    ["2026-10-01T00:00:00.000Z", "2026-10-01T12:00:00.000Z"]);
  const { spawnSync } = await import("node:child_process");
  const tool = join(WORLD_CLONE, "..", "world2", "tools", "position-snapshot.mjs");
  const w = spawnSync(process.execPath, [tool, "--apply", "--prod", "--world-repo", WORLD_CLONE, "--pg-url", store.url("office_api")],
    { encoding: "utf8", env: { ...process.env, WORLD2_PG_URL: "", PGUSER: "", PGDATABASE: "" } });
  assert.equal(w.status, 1, w.stderr || w.stdout);
  assert.match(w.stderr, /positions snapshot · REFUSED · the store's era one/);
  const { rows: [{ n }] } = await owner.query("SELECT count(*)::int AS n FROM position_snapshots");
  assert.equal(n, 0, "the writer wrote over an era one that is not the git ledger's");
});
