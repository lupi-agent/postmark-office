// world-snapshot.test.mjs — THE CLEARING SEALS THE WORLD IT LEAVES, IN ITS OWN
// TRANSACTION (POS-357; 054_world_snapshots.sql; POS-337 R1).
//
//   EMBEDDED_PG_DIR=<dir holding embedded-postgres> node --test test/world-snapshot.test.mjs
//
// THE RULING (Darko, 2026-10-04): each 12-hour clearing writes a content-
// addressed snapshot of every standing mark in the same transaction that writes
// the marks, and the step is a PURE SQL COPY: no engine, no fold, no files.
//
// THE RIG. A real Postgres (test/helpers/embedded-store.mjs) with the whole
// schema, and the real `clearing-job.mjs` run as a child under the `clearing_job`
// pen, as the revive test runs it: the seal is SQL (sha256, jsonb text,
// COLLATE "C") and only Postgres can say what those bytes are.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import {
  snapshotHeader, snapshotRows, checkSnapshot, compareToStore, markRowsOfVersions,
  marksDigestOf, snapshotDigestOf, snapshotRegisterRows, registerDigestOf, registerOfVersions,
  householdsAt, snapshotFoldInputs, foldOfSnapshot, canonicalJson, foldComparison,
} from "../src/world-snapshot.mjs";
import { marksFromRows } from "../src/world2-fold.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const JOB = join(ROOT, "world2", "tools", "clearing-job.mjs");
const VERIFY = join(ROOT, "world2", "tools", "world-snapshot.mjs");
const SEAL = join(ROOT, "world2", "tools", "world-snapshot-seal.mjs");

const TOWN_SHA = "t".repeat(40);
const LAW_SHA = "l".repeat(40);
const WORLD_SHA = "w".repeat(40);
const HALL = "11111111-1111-4111-8111-111111111111";
const HALL_NAME = "22222222-2222-4222-8222-222222222222";
const OLD_SHED = "33333333-3333-4333-8333-333333333333";
const SHED_NOTE = "44444444-4444-4444-8444-444444444444";

const store = await startStore({ db: "world_snapshot_test" });
const skip = store.skip ?? false;

async function owner(fn) {
  const c = await store.connect("world2_owner");
  try { return await fn(c); } finally { await c.end(); }
}
const read = (sql, args = []) => owner(async (c) => (await c.query(sql, args)).rows);

/**
 * Windows 300–301 closed, 302 open. Standing: the hall (sited), its name (a
 * naming mark continuing it, parent by uuid), a note on a RETIRED shed (its
 * parent does not stand). Retired: the shed. Pending in 302: one new sited mark.
 */
async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE world_snapshot_folds, world_snapshots, world_snapshot_marks, mark_versions, world_snapshot_register, register_versions, law_projection, escrow_projection, claims, marks, windows, projection_heads, households, household_pins CASCADE");
    for (const id of [300, 301, 302]) {
      const opens = new Date(Date.UTC(2026, 9, 1, 6) + (id - 300) * 12 * 3600e3).toISOString();
      await c.query(
        `INSERT INTO windows (id, opens_at, closes_at, status, cleared_at)
         VALUES ($1, $2, $2::timestamptz + interval '12 hours', $3, $4)`,
        [id, opens, id === 302 ? "open" : "closed", id === 302 ? null : opens]);
    }
    await c.query(
      "INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('world-law', $1, now()), ('town', $2, now()), ('world-marks', $3, now() - interval '1 day')",
      [LAW_SHA, TOWN_SHA, WORLD_SHA]);
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by)
       VALUES ('mari', 0, 'Mari', ARRAY['mari'], '2026-08-01', 'mari')`);
    await c.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned) VALUES ('mari', 'mari', 101, '2026-08-01')`);
    // The law and terrain at LAW_SHA, as law-ingest writes them (POS-410: the fold reads both from here).
    await c.query(
      `INSERT INTO law_projection (law_sha, kind, path, key, data) VALUES
         ($1, 'class', 'LOGOS/classes/hall/mark.md', 'hall', '{"id":"the-town/hall","kind":"class","class":"hall"}'),
         ($1, 'skeleton', 'WORLD/skeleton.json', 'features', '[{"id":"the-sea","kind":"water"}]')`, [LAW_SHA]);
    const geo = (slug, x, y) => JSON.stringify({ slug, at: { x, y }, extent: { w: 2, h: 2 } });
    await c.query(
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, retired_window, data, parent) VALUES
        ($1, 'mari/hall', 'sited', 'mari', 'hh:mari', 'A hall.', $5, box(point(10,10), point(12,12)), 'standing', 300, NULL, '{"tier":"commons","date":"2026-10-01"}', NULL),
        ($2, 'mari/hall-name', 'naming', 'mari', 'hh:mari', 'The Long Hall.', NULL, NULL, 'standing', 300, NULL, '{"tier":"commons","name":"The Long Hall"}', $1),
        ($3, 'mari/old-shed', 'sited', 'mari', 'hh:mari', 'A shed.', $6, box(point(30,30), point(32,32)), 'retired', 300, 301, '{"tier":"commons"}', NULL),
        ($4, 'mari/shed-note', 'predicated', 'mari', 'hh:mari', 'It leaned.', NULL, NULL, 'standing', 300, NULL, '{"tier":"commons","_parentMarkId":"mari/old-shed"}', $3)`,
      [HALL, HALL_NAME, OLD_SHED, SHED_NOTE, geo("mari/hall", 10, 10), geo("mari/old-shed", 30, 30)]);
    await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
       VALUES (302, 'sited', 'mari', 'mari', 'pending', 'A well.', $1, box(point(50,50), point(52,52)), 0, '{"date":"2026-10-02"}', 'mari/well')`,
      [geo("mari/well", 50, 50)]);
    // Somebody's stamps behind the well, so step 5.5's commons gate passes it.
    await c.query(
      `INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
       VALUES ($1, 'mari/well', 'mari', 'hh:mari', 'hh:mari', 1, 1)`, [TOWN_SHA]);
  });
}

function run(file, args, env = {}) {
  const r = spawnSync(process.execPath, [file, ...args], {
    cwd: ROOT, encoding: "utf8",
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
const clear = (windowId, extra = []) => run(JOB, ["--window", String(windowId), ...extra], { WORLD2_CLEARING_URL: store.url("clearing_job") });
const verify = (extra = []) => run(VERIFY, ["--verify", ...extra], { WORLD2_PG_URL: store.url("snapshot_reader") });

async function withPen(role, fn) {
  const c = await store.connect(role);
  try { return await fn(c); } finally { await c.end(); }
}

test("the clearing seals every standing mark, in its own window's transaction, and says so on the window", { skip }, async () => {
  await seed();
  const r = clear(302);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /snapshot: 4 standing mark\(s\), 4 new version\(s\)/);

  const [w] = await read("SELECT status, receipts FROM windows WHERE id = 302");
  assert.equal(w.status, "closed");
  const [h] = await read("SELECT * FROM world_snapshots WHERE window_id = 302");
  assert.ok(h, "window 302 has its snapshot");
  assert.equal(h.marks, 4, "hall, hall-name, shed-note and the new well; the retired shed is not standing");
  assert.deepEqual([h.law_sha, h.town_sha, h.world_sha], [LAW_SHA, TOWN_SHA, WORLD_SHA], "the shas come from the store's own projection_heads");
  assert.deepEqual(w.receipts.snapshot, { id: h.id, digest: h.digest, marks_digest: h.marks_digest, marks: 4, new_versions: 4, register_digest: h.register_digest, register_rows: 2 });

  const rows = await withPen("snapshot_reader", (c) => snapshotRows(c, h.marks_digest));
  assert.deepEqual(rows.map((x) => x.slug), ["mari/hall", "mari/hall-name", "mari/shed-note", "mari/well"]);
  const name = JSON.parse(rows[1].row);
  assert.equal(name.parent, "mari/hall", "a standing parent is kept by its SLUG, never its uuid");
  assert.equal(JSON.parse(rows[2].row).parent, null, "a parent that does not stand is null, as marksFromRows resolves it");
  const well = JSON.parse(rows[3].row);
  assert.equal(well.data.tier !== undefined, true, "the copy is taken AFTER step 7, so the tier the walk wrote is in it");
});

test("the digests the seal wrote in SQL are the digests JS recomputes from the stored bytes", { skip }, async () => {
  const h = await withPen("snapshot_reader", (c) => snapshotHeader(c, { window: 302 }));
  const rows = await withPen("snapshot_reader", (c) => snapshotRows(c, h.marks_digest));
  const reg = await withPen("snapshot_reader", (c) => snapshotRegisterRows(c, h.register_digest));
  assert.deepEqual(checkSnapshot(h, rows, reg), []);
  assert.equal(registerDigestOf(reg), h.register_digest);
  assert.equal(marksDigestOf(rows), h.marks_digest);
  assert.equal(snapshotDigestOf(h), h.digest);
  // and the check can fail: one byte of one version changed reds by slug
  const bent = rows.map((x, i) => (i === 0 ? { ...x, row: x.row.replace("A hall.", "A hall!") } : x));
  assert.match(checkSnapshot(h, bent).join("\n"), /^mari\/hall: the version listed as/);
});

test("the snapshot's records are the store rows' records: marksFromRows reads a version exactly as it reads the row", { skip }, async () => {
  const h = await withPen("snapshot_reader", (c) => snapshotHeader(c, { window: 302 }));
  const rows = await withPen("snapshot_reader", (c) => snapshotRows(c, h.marks_digest));
  const storeRows = await read(
    "SELECT id, slug, kind, owner, household, body, geometry, status, locked_window, parent, data FROM marks WHERE status = 'standing' ORDER BY slug");
  assert.deepEqual(marksFromRows(markRowsOfVersions(rows)), marksFromRows(storeRows),
    "the fold's input from the snapshot equals the fold's input from the store's rows, parents included");
});

test("a second clearing over an unchanged World shares the list and writes no new version, under its own header", { skip }, async () => {
  const r = clear(303);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /snapshot: 4 standing mark\(s\), 0 new version\(s\)/);
  const hs = await read("SELECT window_id, digest, marks_digest FROM world_snapshots ORDER BY window_id");
  assert.deepEqual(hs.map((x) => x.window_id), [302, 303]);
  assert.equal(hs[0].marks_digest, hs[1].marks_digest);
  assert.equal(hs[0].digest, hs[1].digest, "same marks, same shas: the same World, the same digest");
  const [{ n }] = await read("SELECT count(*)::int AS n FROM world_snapshot_marks");
  assert.equal(n, 4, "one list, kept once");
});

test("--verify is SOUND on what the clearing sealed", { skip }, async () => {
  const r = verify();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /VERIFY: SOUND/);
  assert.match(r.out, /store: the 4 standing mark\(s\) are the snapshot's, byte for byte/);
});

// ── POS-410: THE SOURCES — the register at the seal, the law and terrain at law_sha ──

test("the seal copies the household register as it stood: every households and household_pins row, all columns", { skip }, async () => {
  const h = await withPen("snapshot_reader", (c) => snapshotHeader(c, { window: 303 }));
  const reg = await withPen("snapshot_reader", (c) => snapshotRegisterRows(c, h.register_digest));
  assert.deepEqual(reg.map((r) => r.key), ["household_pins/mari", "households/mari"]);
  const house = JSON.parse(reg[1].row);
  assert.equal(house.table, "households");
  assert.deepEqual(house.residents, ["mari"]);
  assert.equal(house.declared_by, "mari", "every column, not the ones a reader happens to want today");
  const { registry, pins } = await registerOfVersions(reg);
  const { registryFromRows } = await import("../src/registry-rows.mjs");
  const live = await read("SELECT * FROM households ORDER BY ord");
  assert.deepEqual(registry, registryFromRows({ households: live }), "the registry's own unfold reads a version exactly as it reads the live row");
  assert.deepEqual(pins, { mari: { login: "mari", id: 101, pinned: "2026-08-01" } });
});

test("a household change after the seal leaves that settlement's sources unchanged, and --verify names the moved row", { skip }, async () => {
  const h = await withPen("snapshot_reader", (c) => snapshotHeader(c, { window: 303 }));
  // After the settlement, a new resident joins mari's house.
  await owner((c) => c.query("UPDATE households SET residents = ARRAY['mari', 'newbie'] WHERE slug = 'mari'"));
  const reg = await withPen("snapshot_reader", (c) => snapshotRegisterRows(c, h.register_digest));
  const { registry } = await registerOfVersions(reg);
  assert.deepEqual(registry.households.mari.residents, ["mari"], "the past keeps the past's houses (POS-410)");
  // The whole fold, through a stand-in engine that hands back what it was given:
  // the law and the terrain come from the store at law_sha.
  const echo = (input) => ({ marks: input.marks.map((m) => m.id), households: input.households, terrain: input.terrain, stakes: input.stakes });
  const { state, householdsSource } = await withPen("snapshot_reader", (c) => foldOfSnapshot(c, h, { fold: echo }));
  assert.deepEqual(state.terrain, { features: [{ id: "the-sea", kind: "water" }] }, "the terrain is the skeleton at law_sha, from the store");
  assert.ok(state.marks.includes("the-town/hall"), "the class marks at law_sha ride in with the marks");
  assert.equal(state.households, null);
  assert.match(householdsSource, /^nothing/, "no town checkout and no printed roster: said, not guessed");
  const r = verify();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /register: CHANGED households\/mari/);
  await owner((c) => c.query("UPDATE households SET residents = ARRAY['mari'] WHERE slug = 'mari'"));
});

test("canonicalJson forgives key order and nothing else", () => {
  assert.equal(canonicalJson({ w: 1, h: 2 }), canonicalJson({ h: 2, w: 1 }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]), "array order is a value: the fold is first-in-order-wins");
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: "1" }));
  assert.equal(canonicalJson({ a: 1, gone: undefined, list: [undefined] }), canonicalJson(JSON.parse(JSON.stringify({ a: 1, gone: undefined, list: [undefined] }))), "an in-memory fold compares as its file would");
});

test("foldComparison sorts each differing key into ORDER-only or VALUES", () => {
  const a = { marks: [{ id: "x" }, { id: "y" }], rivalries: [1, 2], tick: 0, meta: { source: "store" } };
  const b = { marks: [{ id: "y" }, { id: "x" }], rivalries: [1, 3], tick: 0, meta: { source: "file" } };
  assert.deepEqual(foldComparison(a, b), { equal: ["tick"], orderOnly: ["marks"], values: ["rivalries"] });
});

test("--verify reds on a DROPPED mark and names its slug", { skip }, async () => {
  // A mark standing in the store that the newest snapshot does not hold: the
  // shape of a seal that missed one row.
  await owner((c) => c.query("DELETE FROM world_snapshot_marks WHERE slug = 'mari/hall-name'"));
  const r = verify();
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /store: DROPPED mari\/hall-name/);
  assert.match(r.out, /digest: the header counts 4 mark\(s\), the list holds 3/);
  assert.match(r.out, /VERIFY: DIFFERENCE/);
});

test("--dry-run seals inside the transaction and rolls the seal back with it", { skip }, async () => {
  await seed();
  const r = clear(302, ["--dry-run"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /snapshot: 4 standing mark\(s\)/);
  const [{ n }] = await read("SELECT count(*)::int AS n FROM world_snapshots");
  assert.equal(n, 0, "nothing committed");
  const [{ v }] = await read("SELECT count(*)::int AS v FROM mark_versions");
  assert.equal(v, 0);
});

test("a seal that cannot write takes the whole window back with it: the snapshot and the marks never disagree", { skip }, async () => {
  await seed();
  await owner((c) => c.query("REVOKE INSERT ON world_snapshots FROM clearing_job"));
  try {
    const r = clear(302);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /CLEARING FAILED window 302: permission denied for table world_snapshots/);
    const [w] = await read("SELECT status FROM windows WHERE id = 302");
    assert.equal(w.status, "open", "the window did not close");
    const [m] = await read("SELECT count(*)::int AS n FROM marks WHERE slug = 'mari/well'");
    assert.equal(m.n, 0, "the well did not materialize without its snapshot");
    const [{ v }] = await read("SELECT count(*)::int AS v FROM mark_versions");
    assert.equal(v, 0, "and the versions written before the failure rolled back too");
  } finally {
    await owner((c) => c.query("GRANT INSERT ON world_snapshots TO clearing_job"));
  }
});

test("the seal is a pure SQL copy: its module imports nothing (Darko, 2026-10-04, POS-357)", () => {
  const src = readFileSync(SEAL, "utf8");
  const imports = [...src.matchAll(/^\s*import\b.*$/gm), ...src.matchAll(/\bimport\s*\(/g), ...src.matchAll(/\brequire\s*\(/g)].map((m) => m[0]);
  assert.deepEqual(imports, [], "no engine, no fold, no fs, no network: the seal's failure modes stay the clearing's own");
});

test("compareToStore names every kind of difference by slug", () => {
  const snap = [{ slug: "a", digest: "1" }, { slug: "b", digest: "2" }, { slug: "c", digest: "3" }];
  const now = [{ slug: "a", digest: "1" }, { slug: "b", digest: "9" }, { slug: "d", digest: "4" }];
  assert.deepEqual(compareToStore(snap, now), { dropped: ["d"], extra: ["c"], changed: ["b"] });
});

// THE DERIVATION IS THE CROSSING'S. The fold reads WORLD/households.json, which
// the crossing writes with tools/world-households-export.mjs: the town's own
// resolver at the ledger position, over the pins and the declared registry. The
// store holds those two registry files as rows (019; the drain prints the files
// from them). So, on the tree's own town clone: register rows seeded from the
// clone's two files, sealed, then derived through `householdsAt`, must equal the
// export's map over the clone itself. And after a house changes in the store,
// the sealed register still derives the old map, while the register as it now
// stands derives the new one.
const TOWN_CLONE = join(ROOT, "town-clone");
const NO_TOWN = existsSync(join(TOWN_CLONE, "tools", "stamp-mint.mjs")) && existsSync(join(TOWN_CLONE, "tools", "households.json"))
  ? false : `needs the tree's town clone with tools/stamp-mint.mjs and tools/households.json (${TOWN_CLONE})`;

test("the households a snapshot derives from its register are the crossing's export over the town; a later change moves only the present", { skip: skip || NO_TOWN }, async () => {
  await seed();
  const { rowsFromRegistry } = await import("../src/registry-rows.mjs");
  const { worldHouseholdsAt } = await import("../src/household-logins.mjs");
  const files = rowsFromRegistry(
    JSON.parse(readFileSync(join(TOWN_CLONE, "tools", "households.json"), "utf8")),
    JSON.parse(readFileSync(join(TOWN_CLONE, "tools", "github-ids.json"), "utf8")));
  await owner(async (c) => {
    await c.query("TRUNCATE households, household_pins CASCADE");
    for (const h of files.households) {
      const cols = Object.keys(h);
      await c.query(`INSERT INTO households (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
        cols.map((k) => (k === "accounts" || k === "home_images" ? JSON.stringify(h[k]) : h[k])));
    }
    for (const p of files.pins) {
      const cols = Object.keys(p);
      await c.query(`INSERT INTO household_pins (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`, cols.map((k) => p[k]));
    }
  });
  const sealed = await withPen("snapshot_reader", async (c) => (await import("../src/world-snapshot.mjs")).registerRowsNow(c));
  const engine = await import(pathToFileURL(join(TOWN_CLONE, "tools", "stamp-mint.mjs")).href);
  const theirs = worldHouseholdsAt(TOWN_CLONE, engine).households;
  const ours = await householdsAt(sealed, TOWN_CLONE);
  assert.ok(Object.keys(theirs).length > 100, "a real registry");
  assert.deepEqual(ours, theirs, "the register rows, through the town's resolver, are the crossing's own map");
  // After the seal, a resident the town knows moves to another declared house in the store.
  const [from, to] = files.households.filter((h) => (h.residents ?? []).some((r) => theirs[r] === `hh:${h.slug}`));
  const mover = from.residents.find((r) => theirs[r] === `hh:${from.slug}`);
  await owner(async (c) => {
    await c.query("UPDATE households SET residents = array_remove(residents, $2) WHERE slug = $1", [from.slug, mover]);
    await c.query("UPDATE households SET residents = residents || ARRAY[$2] WHERE slug = $1", [to.slug, mover]);
  });
  assert.deepEqual(await householdsAt(sealed, TOWN_CLONE), theirs, "the sealed register derives the map of its own day");
  const now = await withPen("snapshot_reader", async (c) => (await import("../src/world-snapshot.mjs")).registerRowsNow(c));
  assert.equal((await householdsAt(now, TOWN_CLONE))[mover], `hh:${to.slug}`, "the register as it stands now derives the move");
});

test.after(async () => { if (!skip) await store.stop(); });
