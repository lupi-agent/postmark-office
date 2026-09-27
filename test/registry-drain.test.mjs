// registry-drain.test.mjs — the drain's decision path, with no database (POS-187).
//
// `tools/registry-drain.mjs --check` is the gate the whole flip hangs on, and
// `--apply` is the writer that makes the town's two files a rendering of the
// store. Neither may first be exercised on the box at 05:45.
//
// THE POOL IS STUBBED, NOT MOCKED AROUND. `world2-acts.mjs` exports
// `__setPoolForTest` for exactly this, and the stub answers the drain's three
// real queries with rows shaped the way `node-postgres` shapes them — `gh_id`
// as a STRING (bigint), `accounts` as parsed jsonb, `ord` as a number. So the
// path under test is the real `loadRegistryRows` -> `renderRegistry` -> the
// pen, not a rehearsal of it.
//
// THE PEN IS INJECTED, exactly as `declareHousehold` injects its `commit` and
// for the same reason: the decision — write, or write nothing — is what is
// being proven, and a real `penCommit` would need a clone, a bot identity and a
// remote to prove a branch that has nothing to do with any of them.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { __setPoolForTest } from "../src/world2-acts.mjs";
import { rowsFromRegistry, renderRegistry } from "../src/registry-rows.mjs";
import { loadRegistryRows } from "../src/registry-store.mjs";
import { checkRegistry, drainRegistry } from "../tools/registry-drain.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "registry-2026-09-22");
const HOUSEHOLDS_RAW = readFileSync(join(FIX, "households.json"), "utf8");
const PINS_RAW = readFileSync(join(FIX, "github-ids.json"), "utf8");
const ROWS = rowsFromRegistry(JSON.parse(HOUSEHOLDS_RAW), JSON.parse(PINS_RAW));

const ENV_ON = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://stub/none" };
const ENV_OFF = {};

/** A pool that answers the drain's three queries from the fixtures, as pg would. */
function stubPool(rows = ROWS) {
  return {
    async query(text) {
      if (/FROM households/.test(text))
        return { rows: [...rows.households].sort((a, b) => a.ord - b.ord).map((r) => ({ ...r, ord: Number(r.ord) })) };
      if (/FROM household_pins/.test(text))
        return { rows: [...rows.pins].sort((a, b) => (a.handle < b.handle ? -1 : 1)).map((r) => ({ ...r, gh_id: String(r.gh_id) })) };
      if (/FROM registry_meta/.test(text))
        // Deliberately the WRONG way round — primary-key order puts `note`
        // before `schema_version` — so the reader's own ordering is what is
        // under test and not the stub's kindness.
        return { rows: [{ key: "note", value: rows.meta.note }, { key: "schema_version", value: rows.meta.schema_version }] };
      throw new Error(`the stub pool was asked something the drain should not ask: ${text}`);
    },
  };
}

function cloneWith(households, pins) {
  const dir = mkdtempSync(join(tmpdir(), "pos187-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  if (households !== null) writeFileSync(join(dir, REGISTRY_PATH), households);
  if (pins !== null) writeFileSync(join(dir, PINS_PATH), pins);
  return dir;
}

// ── THE METADATA BLOCK'S ORDER ──────────────────────────────────────────────
//
// `registryFromRows` emits the meta keys in the order it receives them, so
// whatever hands them over decides the file's first bytes. `foldRegistryRows`
// puts `schema_version` and `note` back under its own list — the stub above
// hands them over backwards on purpose, and every test in this file already
// leans on that. What the list did NOT cover is a meta key BEYOND those two:
// the fold appends it in the order the rows ARRIVED, and `META_SQL` used to
// carry no `ORDER BY` at all, so that order was the planner's.
//
// MEASURED before the fix: the same two extra keys arriving two ways rendered
// `…,note,zeta,alpha,households` and `…,note,alpha,zeta,households` — two
// different files out of one store, on a query whose two siblings both order
// deliberately.

/** A pool that answers meta with EXTRA keys, in whatever order is handed in, and records the SQL. */
function metaPool(metaOrder, seen = []) {
  return {
    seen,
    async query(text) {
      if (/FROM households/.test(text)) return { rows: [] };
      if (/FROM household_pins/.test(text)) return { rows: [] };
      if (/FROM registry_meta/.test(text)) {
        seen.push(text);
        return { rows: metaOrder.map((key) => ({ key, value: key === "schema_version" ? 1 : key })) };
      }
      throw new Error(`the stub pool was asked something the drain should not ask: ${text}`);
    },
  };
}

test("the metadata block renders in ONE order however the rows arrive", async () => {
  // THE FALSIFIER. The head reversed (`note` before `schema_version`, which is
  // primary-key order) AND the tail shuffled, two ways. One rendering.
  const read = async (order) => {
    __setPoolForTest(metaPool(order));
    try { return renderRegistry(await loadRegistryRows(ENV_ON)).households; }
    finally { __setPoolForTest(null); }
  };

  const a = await read(["note", "schema_version", "zeta", "alpha"]);
  const b = await read(["alpha", "zeta", "note", "schema_version"]);
  assert.equal(a, b, "two arrival orders, one file, byte for byte");

  // …and it is the FILE's order, not merely a stable one: a rendering that
  // agreed with itself while spelling `note` first would pass the line above
  // and still rewrite the town's first two lines on the next crossing.
  assert.deepEqual(Object.keys(JSON.parse(a)), ["schema_version", "note", "alpha", "zeta", "households"],
    "the two stated keys lead, in the file's order; the rest follow by key");

  // And with no extra keys it is still byte-equal to the town's real file,
  // which is the law the rest of this suite holds.
  __setPoolForTest(stubPool());
  try {
    const clone = cloneWith(HOUSEHOLDS_RAW, PINS_RAW);
    assert.equal((await checkRegistry({ clone, env: ENV_ON })).ok, true);
  } finally { __setPoolForTest(null); }
});

test("the meta query the reader SENDS orders explicitly, and not by key text", async () => {
  // The SQL half cannot be falsified without a real Postgres — a stub returns
  // rows in the order it chose, `ORDER BY` or not. So the assertion is on the
  // statement the real reader actually sends, captured off the pool it sends it
  // to. Drop the ORDER BY and this reds.
  const seen = [];
  __setPoolForTest(metaPool(["schema_version", "note"], seen));
  try { await loadRegistryRows(ENV_ON); } finally { __setPoolForTest(null); }

  assert.equal(seen.length, 1, "one meta read, and it is the one asserted below");
  const sql = seen[0].replace(/\s+/g, " ").trim();
  assert.match(sql, /ORDER BY/i, "the meta read orders, like its two siblings");
  assert.match(sql, /WHEN 'schema_version' THEN 0/, "`schema_version` first, stated");
  assert.match(sql, /WHEN 'note' THEN 1/, "`note` second, stated");
  assert.match(sql, /ELSE 2 END, key$/, "and every other key after them, by key");

  // NOT a bare `ORDER BY key`: `note` sorts before `schema_version`, so that
  // spelling would order the file's first two lines backwards — deterministic
  // and wrong, which is worse than undetermined because nothing would red.
  assert.doesNotMatch(sql, /ORDER BY key\b/i, "alphabetical would put `note` first");
});

test("--check is GREEN when the store renders the clone's files byte for byte", async () => {
  __setPoolForTest(stubPool());
  try {
    const clone = cloneWith(HOUSEHOLDS_RAW, PINS_RAW);
    const r = await checkRegistry({ clone, env: ENV_ON });
    assert.equal(r.ok, true);
    assert.deepEqual(r.diffs, []);
    assert.equal(r.rows.households.length, 118);
    assert.equal(r.rows.pins.length, 190);
  } finally { __setPoolForTest(null); }
});

test("--check is RED, and names the line, when one byte moves", async () => {
  // THE PROBE MUST BE ABLE TO FAIL. One character in one house's name, and the
  // gate must find it and say where.
  __setPoolForTest(stubPool());
  try {
    const tampered = HOUSEHOLDS_RAW.replace('"name": "Fox Hearth"', '"name": "Fox Hearths"');
    assert.notEqual(tampered, HOUSEHOLDS_RAW, "the tamper must actually change the file");
    const clone = cloneWith(tampered, PINS_RAW);
    const r = await checkRegistry({ clone, env: ENV_ON });
    assert.equal(r.ok, false);
    assert.equal(r.diffs.length, 1);
    assert.equal(r.diffs[0].path, REGISTRY_PATH);
    assert.match(r.diffs[0].rendered, /Fox Hearth"/);
    assert.match(r.diffs[0].actual, /Fox Hearths"/);
    assert.ok(r.diffs[0].line > 0, "and it names a line number a person can open the file at");
  } finally { __setPoolForTest(null); }
});

test("--check on an office not pointed at the record is UNREACHABLE, never a pass", async () => {
  // An un-run gate is not a green gate. `actsQuery` answers null for "I could
  // not look", and this must survive all the way to the exit code.
  const clone = cloneWith(HOUSEHOLDS_RAW, PINS_RAW);
  const r = await checkRegistry({ clone, env: ENV_OFF });
  assert.equal(r.ok, false);
  assert.equal(r.unreachable, true);
});

test("--apply writes both files and commits ONCE, through the injected pen", async () => {
  __setPoolForTest(stubPool());
  try {
    const clone = cloneWith("{}\n", "{}\n");
    const calls = [];
    const commit = (c, paths, message) => { calls.push({ c, paths, message }); return "deadbeef"; };

    const r = await drainRegistry({ clone, env: ENV_ON, commit });
    assert.equal(r.ran, true);
    assert.deepEqual(r.changed.sort(), [PINS_PATH, REGISTRY_PATH].sort());
    assert.equal(r.commit, "deadbeef");
    assert.equal(calls.length, 1, "one commit over both files, never two");
    assert.equal(calls[0].paths.length, 2);
    assert.match(calls[0].message, /118 households, 190 pins/);

    assert.equal(readFileSync(join(clone, REGISTRY_PATH), "utf8"), HOUSEHOLDS_RAW);
    assert.equal(readFileSync(join(clone, PINS_PATH), "utf8"), PINS_RAW);
  } finally { __setPoolForTest(null); }
});

test("--apply on files that already match writes nothing and commits nothing", async () => {
  __setPoolForTest(stubPool());
  try {
    const clone = cloneWith(HOUSEHOLDS_RAW, PINS_RAW);
    const calls = [];
    const r = await drainRegistry({ clone, env: ENV_ON, commit: (...a) => { calls.push(a); return "x"; } });
    assert.equal(r.ran, true);
    assert.deepEqual(r.changed, []);
    assert.equal(r.commit, null);
    assert.equal(calls.length, 0, "idempotent: the pen is not even asked");
  } finally { __setPoolForTest(null); }
});

test("--apply on an office not pointed at the record writes nothing and says so", async () => {
  const clone = cloneWith("{}\n", "{}\n");
  const calls = [];
  const r = await drainRegistry({ clone, env: ENV_OFF, commit: (...a) => { calls.push(a); return "x"; } });
  assert.equal(r.ran, false);
  assert.equal(calls.length, 0);
  assert.equal(readFileSync(join(clone, REGISTRY_PATH), "utf8"), "{}\n", "the clone is untouched");
  assert.match(r.skipped, /not pointed at the record/);
});

test("the meta pair renders in the FILE's order, not the table's", async () => {
  // The stub returns `note` before `schema_version` on purpose. If the reader
  // took the table's order, the file's first two keys would swap and every
  // drain would rewrite the whole registry.
  __setPoolForTest(stubPool());
  try {
    const clone = cloneWith(HOUSEHOLDS_RAW, PINS_RAW);
    const r = await checkRegistry({ clone, env: ENV_ON });
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.rows.meta), ["schema_version", "note"]);
    assert.equal(renderRegistry(r.rows).households, HOUSEHOLDS_RAW);
  } finally { __setPoolForTest(null); }
});
