// identities-from-the-registry.test.mjs — POS-350: `identities` and the store fold's households
// are the store's registry, not the world repo's WORLD/households.json.
//
// `identities` is a VIEW over `households` and `household_pins` (055). Its
// household column must be the answer the office's one deriver gives
// (src/household-deriver.mjs § resolveHouse) for every handle the registry
// knows: a house that lists the handle, else the house holding its pin's
// account, else `solo:<handle>`. The store fold's households are the same
// registry, keyed by declared slug as the world's own projector keys them.
//
// THE FLIPS: 055 as a plain table (law_ingester's, unfilled) answers no rows;
// a fold that reads WORLD/households.json again answers the file's keys.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedRegistry } from "./helpers/office-under-test.mjs";
import { rowsFromRegistry, registryFromRows, pinsFromRows } from "../src/registry-rows.mjs";
import { resolveHouse } from "../src/household-deriver.mjs";
import { householdsFromRegistry } from "../src/world2-fold.mjs";

const REGISTRY = { schema_version: 1, households: {
  hearth: { name: "The Hearth", human: "Fern", since: "2026-08-01", declared_by: "fern",
    accounts: [{ login: "fern-gh", id: 201 }, { login: "kit-gh", id: 203 }], residents: ["fern"] },
  yonder: { name: "Yonder", since: "2026-08-02", declared_by: "yan", accounts: [{ login: "yan-gh", id: 202 }], residents: ["yan"] },
} };
const PINS = {
  fern: { login: "fern-gh", id: 201, pinned: "2026-08-01" },
  kit: { login: "kit-gh", id: 203, pinned: "2026-10-04" },          // in hearth by its pin's account only
  yan: { login: "yan-gh", id: 202 },
  stray: { login: "stray-gh", id: 299 },                             // no house holds the account
  gone: { login: "gone-gh", id: 298, retired: "2026-09-09", renamed_to: "back" },
};

let s = null, skip = false;
before(async () => {
  s = await startStore({ db: "identities_view_test" });
  if (s.skip) { skip = s.skip; return; }
  await seedRegistry(s, REGISTRY, PINS);
});
after(async () => { if (s?.stop) await s.stop(); });

test("identities answers every handle the registry knows, as the deriver resolves it", async (t) => {
  if (skip) return t.skip(skip);
  const c = await s.connect("office_api");
  try {
    const rows = (await c.query("SELECT handle, household, human, gh_login, gh_id, status, data FROM identities ORDER BY handle")).rows;
    const rowsObj = rowsFromRegistry(REGISTRY, PINS);
    const registry = registryFromRows(rowsObj), pins = pinsFromRows(rowsObj);
    assert.deepEqual(rows.map((r) => r.handle), ["fern", "gone", "kit", "stray", "yan"]);
    for (const r of rows) {
      const { slug } = resolveHouse(r.handle, registry, pins);
      assert.equal(r.household, slug ? `hh:${slug}` : `solo:${r.handle}`, `${r.handle}: the deriver's house`);
    }
    const by = Object.fromEntries(rows.map((r) => [r.handle, r]));
    assert.equal(by.kit.household, "hh:hearth", "a pinned account the house holds files the handle in it");
    assert.equal(by.fern.human, "Fern");
    assert.equal(Number(by.fern.gh_id), 201);
    assert.equal(by.fern.gh_login, "fern-gh");
    assert.equal(by.stray.household, "solo:stray");
    assert.equal(by.gone.status, "retired");
    assert.deepEqual(by.fern.data, { source: "the registry (019)", slug: "hearth" });
  } finally { await c.end(); }
});

test("nobody writes identities: it is a view, and the law pen holds no grant on it", async (t) => {
  if (skip) return t.skip(skip);
  const c = await s.connect("law_ingester");
  try {
    await assert.rejects(c.query("DELETE FROM identities"), /permission denied|cannot delete from view/);
  } finally { await c.end(); }
  const owner = await s.connect("world2_owner");
  try {
    const kind = (await owner.query("SELECT c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'identities'")).rows[0]?.relkind;
    assert.equal(kind, "v");
    const reg = (await owner.query("SELECT kind, owner_pen FROM registry WHERE object = 'identities'")).rows[0];
    assert.deepEqual(reg, { kind: "derived", owner_pen: "office_api" });
  } finally { await owner.end(); }
});

test("the store fold's households: handle -> declared slug, from the registry", () => {
  const registry = registryFromRows(rowsFromRegistry(REGISTRY, PINS));
  assert.deepEqual(householdsFromRegistry(registry), { fern: "hearth", yan: "yonder" },
    "the houses' own residents, as the world's households-project keys them; everyone else folds solo");
  assert.throws(() => householdsFromRegistry({ households: { a: { residents: ["x"] }, b: { residents: ["x"] } } }),
    /lists a resident in two houses: x \(a and b\)/);
  assert.deepEqual(householdsFromRegistry({ households: {} }), {});
});
