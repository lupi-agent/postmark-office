// twin-household-through-handles.test.mjs — THE TWIN FINDS A HOUSE THROUGH ITS HANDLES (POS-142).
//
//   EMBEDDED_PG_DIR=<dir holding embedded-postgres> node --test test/twin-household-through-handles.test.mjs
//
// THE FINDING (S3, 2026-10-01). `world2-claims.mjs § householdKeyForKey` keyed
// the household on `key.household`, a LABEL: the GitHub login an OAuth key
// resolved to, or a keys-file slug. On the town's own registry "keeminlee" and
// "darko" reach no house while "wright" reaches hh:starforge. So an OAuth
// resident whose login is not a house handle got an empty /world2/my-marks, and
// the same resolver scoped /world2/my-drafts under the row policy: their own
// private drafts, filed under their house by the write path, were invisible.
//
// THE FIX (agreed 2026-10-01): resolve through the key's handles against the
// store's registry (households / household_pins), as 1.0 does; the label only
// when no handle resolves, and then the answer says so.
//
// THE RIG. A real Postgres (test/helpers/embedded-store.mjs) with the whole
// schema; the doors read as `office_api`, so 024's row policy is live.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startStore } from "./helpers/embedded-store.mjs";
import { twinFindings } from "../world2/tools/falsifier-twins-equality.mjs";

const store = await startStore({ db: "twin_household_test" });
const skip = store.skip ?? false;

// fern lives in the hearth; the key's own name is the human's GitHub login,
// which the registry does not pin (the "keeminlee" shape).
const OAUTH_KEY = { household: "fern-human", handles: new Set(["fern"]) };
// a key none of whose handles is housed, and whose name is no house either
const LOST_KEY = { household: "nobody-human", handles: new Set(["drifter"]) };

async function seed() {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE claims, marks, windows, identities, households, household_pins CASCADE");
    await c.query(
      `INSERT INTO windows (id, opens_at, closes_at, status)
       VALUES (300, now() - interval '1 hour', now() + interval '11 hours', 'open')`);
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by)
       VALUES ('hearth', 0, 'The Hearth', ARRAY['fern'], '2026-08-01', 'fern'),
              ('yonder', 1, 'Yonder', ARRAY['yan'], '2026-08-01', 'yan')`);
    await c.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned)
       VALUES ('fern', 'fern', 201, '2026-08-01'), ('yan', 'yan', 202, '2026-08-01')`);
    await c.query(
      `INSERT INTO identities (handle, household) VALUES ('fern', 'hh:hearth'), ('yan', 'hh:yonder')`);
    // fern's draft, filed under the house as the write path files it
    await c.query(
      `INSERT INTO claims (window_id, class, claimant, household, status, body, stake, slug)
       VALUES (300, 'sited', 'fern', 'hh:hearth', 'draft', 'A kettle by the hearth.', 0, 'fern/the-kettle'),
              (300, 'sited', 'yan', 'hh:yonder', 'draft', 'Not fern''s.', 0, 'yan/elsewhere')`);
    await c.query(
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, data, locked_window)
       VALUES (gen_random_uuid(), 'fern/the-hearthstone', 'sited', 'fern', 'hh:hearth', 'A warm stone.',
               '{"at":{"x":1,"y":1},"extent":{"w":1,"h":1}}', box(point(1,1), point(2,2)), 'standing', '{"tier":"commons"}', 300),
              (gen_random_uuid(), 'yan/the-gate', 'sited', 'yan', 'hh:yonder', 'A gate.',
               '{"at":{"x":5,"y":5},"extent":{"w":1,"h":1}}', box(point(5,5), point(6,6)), 'standing', '{"tier":"commons"}', 300)`);
  } finally { await c.end(); }
}

let claims, serve, pool;
if (!skip) {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = store.url("office_api");
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: store.url("office_api"), max: 2 });
  claims = await import("../src/world2-claims.mjs");
  claims.__setPoolForTest(pool);
  serve = await import("../src/world2-serve.mjs");
  await seed();
}

test("a key whose name is not a handle, holding a handle pinned to the hearth, resolves to the hearth through the handle", { skip }, async () => {
  const r = await claims.keyHouseholdOf(pool, OAUTH_KEY);
  assert.equal(r.household, "hh:hearth");
  assert.equal(r.via, "fern");
  assert.equal(r.disclosure, undefined);
});

test("that key reads the hearth's drafts at /world2/my-drafts, and nobody else's", { skip }, async () => {
  const r = await serve.world2MyDrafts(OAUTH_KEY);
  assert.equal(r.household, "hh:hearth");
  assert.deepEqual(r.drafts.map((d) => d.slug), ["fern/the-kettle"]);
  assert.equal(r.household_disclosure, undefined);
});

test("that key reads the hearth's marks at /world2/my-marks", { skip }, async () => {
  const r = await serve.world2MyMarks(OAUTH_KEY, { p: pool });
  assert.ok(!r.error, JSON.stringify(r).slice(0, 300));
  assert.deepEqual(r.residents, ["fern"]);
  assert.ok(JSON.stringify(r).includes("fern/the-hearthstone"), JSON.stringify(r).slice(0, 600));
  assert.ok(!JSON.stringify(r).includes("yan/the-gate"));
  // 1.0's `household` is the key's own name; the house read is `household_key`.
  assert.equal(r.household, "fern-human");
  assert.equal(r.household_key, "hh:hearth");
  assert.equal(r.household_disclosure, undefined);
});

test("a key with no resolving handle reads nothing, and the answer names why", { skip }, async () => {
  const r = await claims.keyHouseholdOf(pool, LOST_KEY);
  assert.equal(r.household, "solo:nobody-human");
  assert.equal(r.via, null);
  assert.match(r.disclosure, /none of this key's handles \(drifter\) is pinned to a house/);
  assert.match(r.disclosure, /names no house either/);
  const drafts = await serve.world2MyDrafts(LOST_KEY);
  assert.deepEqual(drafts.drafts, []);
  assert.match(drafts.household_disclosure, /drifter/);
  const marks = await serve.world2MyMarks(LOST_KEY, { p: pool });
  assert.deepEqual(marks.residents, []);
  assert.match(marks.household_disclosure, /drifter/);
});

test("a key whose NAME is a housed handle still resolves, through its handles first", { skip }, async () => {
  // the keys-file "wright" shape: the label and the handle agree
  const r = await claims.keyHouseholdOf(pool, { household: "fern", handles: new Set(["fern"]) });
  assert.equal(r.household, "hh:hearth");
});

// ── the twins-equality checker, unchanged, on a resolving key ───────────────

const { WORLD_CLONE, worldMyMarks } = await import("../src/world.mjs");
const TOWN_CLONE = process.env.TOWN_CLONE ?? join(WORLD_CLONE, "..", "town-clone");
const HAVE = existsSync(join(WORLD_CLONE, "WORLD", "world-state.json"))
  && existsSync(join(TOWN_CLONE, "tools", "stamp-mint.mjs"));
const skip10 = skip || (HAVE ? false : `needs a world clone at ${WORLD_CLONE} and a town clone at ${TOWN_CLONE}`);
// The S3 instance: an OAuth key named for the login, holding a housed handle.
const REAL_KEY = { household: "keeminlee", handles: new Set(["wright"]) };

test("1.0 on a resolving key: `household` is the key's name, and no new field appears", { skip: skip10 }, async () => {
  const one = await worldMyMarks(REAL_KEY);
  assert.ok(!one.error, JSON.stringify(one).slice(0, 200));
  assert.equal(one.household, "keeminlee");
  assert.ok(one.residents.includes("wright"));
  for (const k of ["household_key", "household_disclosure"]) assert.ok(!(k in one), `1.0 carries no ${k}`);
});

test("the checker, unchanged: `household` agrees and `household_key` is an addition; the train's shape is a finding", { skip: skip10 }, async () => {
  const one = await worldMyMarks(REAL_KEY);
  const twin = await serve.world2MyMarks(OAUTH_KEY, { p: pool });
  // The 1.0 answer with this twin's own additions put on it, the household
  // field spelled as the twin now spells it: the key's name.
  const now = { ...structuredClone(one), household: String(REAL_KEY.household), household_key: "hh:starforge",
    what: twin.what, tree_only: twin.tree_only };
  const r = twinFindings(one, now);
  assert.deepEqual(r.findings.filter((f) => /household/.test(f)), []);
  assert.ok(r.additions.includes("household_key"), JSON.stringify(r.additions));
  // The train spelled `household` as the resolved key, and the checker says so.
  const train = { ...now, household: "solo:keeminlee" };
  delete train.household_key;
  const red = twinFindings(one, train).findings;
  assert.ok(red.some((f) => /household: 1\.0 "keeminlee"/.test(f)), JSON.stringify(red));
});

test.after(async () => {
  if (skip) return;
  claims.__setPoolForTest(null);
  await pool.end();
  await store.stop();
});
