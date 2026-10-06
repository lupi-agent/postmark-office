// snapshot-backfill.test.mjs — EVERY SETTLEMENT BEFORE THE SEAL GETS ITS
// SNAPSHOT, FROM ITS TAG (POS-358; 065_snapshot_backfill.sql).
//
//   EMBEDDED_PG_DIR=<dir holding embedded-postgres> node --test test/snapshot-backfill.test.mjs
//
// A back-filled snapshot holds the same sources a clearing's seal keeps (Darko,
// 2026-10-05, POS-410), so the first thing held here is that the two writers make
// the SAME bytes: the back-fill's canonical rows, hashed by Postgres from JSON,
// equal the seal's, hashed from the tables, over the same marks and the same
// register. Then the write itself, on a real store; then one real tag end to end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import {
  namedTownSha, lfCommitted, canonicalInputsOf, MARK_ROWS_FROM_JSON_SQL, REGISTER_ROWS_FROM_JSON_SQL,
  writeTagSnapshot, deriveTag,
} from "../world2/tools/snapshot-backfill.mjs";
import { STANDING_ROWS_SQL, REGISTER_ROWS_SQL } from "../world2/tools/world-snapshot-seal.mjs";
import { snapshotHeader, snapshotRows, snapshotRegisterRows, checkSnapshot } from "../src/world-snapshot.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = await startStore({ db: "snapshot_backfill_test" });
const skip = store.skip ?? false;

const HALL = "11111111-1111-4111-8111-111111111111";
const NAME = "22222222-2222-4222-8222-222222222222";
const SHA = (c) => c.repeat(40);

async function owner(fn) {
  const c = await store.connect("world2_owner");
  try { return await fn(c); } finally { await c.end(); }
}

async function seed(c) {
  await c.query("TRUNCATE world_snapshot_folds, world_snapshots, world_snapshot_marks, mark_versions, world_snapshot_register, register_versions, settlements, claims, marks, windows, households, household_pins CASCADE");
  await c.query("INSERT INTO windows (id, opens_at, closes_at, status, cleared_at) VALUES (300, '2026-10-01T06:00Z', '2026-10-01T18:00Z', 'closed', '2026-10-01T18:00Z')");
  await c.query(
    `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data, parent) VALUES
      ($1, 'mari/hall', 'sited', 'mari', 'hh:mari', 'A hall — "long".', '{"at":{"x":10,"y":10},"extent":{"w":2,"h":2}}', box(point(10,10), point(12,12)), 'standing', 300, '{"tier":"commons","date":"2026-10-01"}', NULL),
      ($2, 'mari/hall-name', 'naming', 'mari', 'hh:mari', NULL, NULL, NULL, 'standing', 300, '{"tier":"commons","name":"The Long Hall"}', $1)`,
    [HALL, NAME]);
  await c.query(
    `INSERT INTO households (slug, ord, name, accounts, residents, since, declared_by, formerly)
     VALUES ('mari', 0, 'Mari', '[{"login":"mari","id":101}]', ARRAY['mari'], '2026-08-01', 'mari', ARRAY['old-mari'])`);
  await c.query(`INSERT INTO household_pins (handle, login, gh_id, pinned, note) VALUES ('mari', 'mari', 101, '2026-08-01', 'a note')`);
}

test("namedTownSha reads the town sha a tag's message names, and nothing else", () => {
  const sha = "8124b1dc8ce33174320dfa86808fa3348fb13f49";
  assert.equal(namedTownSha(`S93: … by-hand settlement blessed by the Worldkeeper. Box Town ${sha}; zero new rows`), sha);
  assert.equal(namedTownSha("settlement: sweep 0 published"), null);
  assert.equal(namedTownSha(`Town ${sha.slice(0, 12)} only`), null, "an abbreviated sha names nothing");
});

test("lfCommitted reads the committed fold's escaped CRLF as LF, and touches nothing else", () => {
  assert.equal(lfCommitted('{"body":"a\\r\\nb"}'), '{"body":"a\\nb"}');
  assert.equal(JSON.parse(lfCommitted('{"body":"a\\r\\nb"}')).body, "a\nb");
});

test("canonicalInputsOf names the parent by its slug", () => {
  const rows = canonicalInputsOf([
    { id: "u1", slug: "a/hall", kind: "sited", owner: "a", body: "x", geometry: {}, parent: null, data: {} },
    { id: "u2", slug: "a/name", kind: "naming", owner: "a", body: null, geometry: null, parent: "u1", data: {} },
  ]);
  assert.equal(rows[1].parent, "a/hall");
  assert.equal(rows[0].parent, null);
});

test("the back-fill hashes a mark and a register row to the SAME version the seal does", { skip }, async () => {
  await owner(async (c) => {
    await seed(c);
    const seal = (await c.query(`${STANDING_ROWS_SQL} ORDER BY r.slug`)).rows;
    const { rows: marks } = await c.query(
      `SELECT m.slug, m.kind, m.owner, m.body, m.geometry, p.slug AS parent, m.data
         FROM marks m LEFT JOIN marks p ON p.id = m.parent WHERE m.status = 'standing' ORDER BY m.slug`);
    const fromJson = (await c.query(`${MARK_ROWS_FROM_JSON_SQL} ORDER BY r.slug`, [JSON.stringify(marks)])).rows;
    assert.deepEqual(fromJson, seal, "same rows, same bytes, same digests");

    const sealReg = (await c.query(`${REGISTER_ROWS_SQL} ORDER BY r.key`)).rows;
    const { rows: hh } = await c.query("SELECT * FROM households");
    const { rows: pins } = await c.query("SELECT * FROM household_pins");
    const regJson = (await c.query(`${REGISTER_ROWS_FROM_JSON_SQL} ORDER BY r.key`, [JSON.stringify(hh), JSON.stringify(pins)])).rows;
    assert.deepEqual(regJson, sealReg);
  });
});

test("writeTagSnapshot writes the sources, the proved fold, and links the settlement once", { skip }, async () => {
  await owner(async (c) => {
    await seed(c);
    await c.query(`INSERT INTO settlements (number, tag_sha, published_at, window_id, blessed_at) VALUES (47, $1, '2026-10-01T18:04Z', 300, NULL)`, [SHA("a")]);
    const q = (s, a) => c.query(s, a);
    const t = {
      number: 47, tag_sha: SHA("a"), town_sha: SHA("b"), town_sha_from: "main-at-commit", published_at: "2026-10-01T18:04:00.000Z", window_id: 300,
      marks: [
        { slug: "mari/hall", kind: "sited", owner: "mari", body: "A hall.", geometry: { at: { x: 1, y: 1 }, extent: { w: 2, h: 2 } }, parent: null, data: { tier: "commons" } },
        { slug: "mari/hall-name", kind: "naming", owner: "mari", body: null, geometry: null, parent: "mari/hall", data: { name: "Hall" } },
      ],
      register: { households: (await c.query("SELECT * FROM households")).rows, pins: (await c.query("SELECT * FROM household_pins")).rows },
      fold_state: '{"marks":[]}\n',
    };
    const h = await writeTagSnapshot(q, t);
    const header = await snapshotHeader(c, { id: h.id });
    assert.equal(header.source, "backfill");
    assert.equal(header.town_sha_from, "main-at-commit");
    assert.equal(header.window_id, 300);
    assert.deepEqual([header.law_sha, header.world_sha, header.town_sha], [SHA("a"), SHA("a"), SHA("b")]);
    assert.equal(new Date(header.taken_at).toISOString(), "2026-10-01T18:04:00.000Z", "taken when the crossing published, not when the back-fill ran");
    const rows = await snapshotRows(c, header.marks_digest);
    const reg = await snapshotRegisterRows(c, header.register_digest);
    assert.deepEqual(checkSnapshot(header, rows, reg), [], "the same digest rules as the seal's");
    assert.equal(JSON.parse(rows[1].row).parent, "mari/hall");
    const [{ state }] = (await c.query("SELECT state FROM world_snapshot_folds WHERE digest = $1", [header.digest])).rows;
    assert.equal(state, t.fold_state);
    const [s] = (await c.query("SELECT snapshot_id FROM settlements WHERE number = 47")).rows;
    assert.equal(s.snapshot_id, h.id);
    // A second snapshot for the same settlement links nothing new: a settlement's
    // snapshot is only ever filled, never moved. (The run skips a linked settlement
    // before it gets here; this is the write's own floor.)
    const again = await writeTagSnapshot(q, { ...t, window_id: null, fold_state: null });
    const [s2] = (await c.query("SELECT snapshot_id FROM settlements WHERE number = 47")).rows;
    assert.equal(s2.snapshot_id, h.id);
    assert.equal(again.digest, h.digest, "the same sources, the same digest");
    assert.notEqual(again.id, h.id);
  });
});

test("a tag whose town had no registry yet writes no register, and its digest has four parts", { skip }, async () => {
  await owner(async (c) => {
    await seed(c);
    const h = await writeTagSnapshot((s, a) => c.query(s, a), {
      number: 1, tag_sha: SHA("c"), town_sha: SHA("d"), town_sha_from: "named", published_at: "2026-07-01T00:00:00.000Z", window_id: null,
      marks: [{ slug: "the-town/the-sea", kind: "sited", owner: "the-town", body: "The sea.", geometry: { at: { x: 0, y: 0 }, extent: { w: 9, h: 9 } }, parent: null, data: {} }],
      register: null, fold_state: null,
    });
    const header = await snapshotHeader(c, { id: h.id });
    assert.equal(header.register_digest, null);
    assert.deepEqual(checkSnapshot(header, await snapshotRows(c, header.marks_digest), null), []);
  });
});

test("the settlements tick names the snapshot the seal took at its window, at INSERT", { skip }, async () => {
  await owner(async (c) => {
    await seed(c);
    const { rows: [snap] } = await c.query(
      `INSERT INTO world_snapshots (window_id, digest, marks_digest, marks) VALUES (300, $1, $1, 0) RETURNING id`, [SHA("e").slice(0, 40) + SHA("e").slice(0, 24)]);
    const office = await store.connect("office_api");
    try {
      const { rows: [linkable] } = await office.query(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'settlements' AND column_name = 'snapshot_id') AS ok");
      assert.equal(linkable.ok, true);
      await office.query(
        `INSERT INTO settlements (number, tag_sha, published_at, window_id, blessed_at, snapshot_id)
         VALUES ($1, $2, $3, $4, $5, (SELECT id FROM world_snapshots WHERE window_id = $4)) ON CONFLICT (number) DO NOTHING`,
        [94, SHA("f"), "2026-10-05T06:04Z", 300, null]);
    } finally { await office.end(); }
    const [s] = (await c.query("SELECT snapshot_id FROM settlements WHERE number = 94")).rows;
    assert.equal(s.snapshot_id, snap.id, "the office's own pen writes the link with the row");
  });
});

// ── ONE REAL TAG, END TO END: S93 and the town sha its message names ──────────
const WORLD_CLONE = process.env.WORLD_CLONE ?? join(ROOT, "world-clone");
const TOWN_CLONE = join(ROOT, "town-clone");
const has = (repo, ref) => { try { execFileSync("git", ["-C", repo, "rev-parse", "-q", "--verify", `${ref}^{commit}`], { stdio: "ignore" }); return true; } catch { return false; } };
const NO_S93 = existsSync(WORLD_CLONE) && has(WORLD_CLONE, "settlement/S93") && has(TOWN_CLONE, "8124b1dc8ce33174320dfa86808fa3348fb13f49")
  ? false : "needs the world clone with settlement/S93 and the town clone with 8124b1dc";

test("S93 back-fills from its tag: the town sha its message names, the register at that sha, and a fold equal to the committed one", { skip: NO_S93, timeout: 600000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "backfill-s93-"));
  const W = join(scratch, "w"), T = join(scratch, "t");
  const clone = (src, dst) => execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.longpaths=true", "clone", "-q", "--shared", "--no-checkout",
    "-c", "core.autocrlf=false", "-c", "core.longpaths=true", src, dst], { stdio: "ignore" });
  try {
    clone(WORLD_CLONE, W); clone(TOWN_CLONE, T);
    const t = await deriveTag({ W, T, townRepo: TOWN_CLONE, number: 93, scratch });
    assert.equal(t.town_sha, "8124b1dc8ce33174320dfa86808fa3348fb13f49");
    assert.equal(t.town_sha_from, "named");
    assert.equal(t.marks.length, 1191);
    assert.ok(t.register && t.register.households.length > 100, t.register_note ?? "a register");
    assert.equal(t.fold, "equal", "the tag's engine over its inputs, stakes replayed at the named town, is its committed world-state.json");
    assert.ok(t.fold_state?.length > 1e6);
  } finally {
    rmSync(W, { recursive: true, force: true });
    rmSync(T, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test.after(async () => { if (!skip) await store.stop(); });
