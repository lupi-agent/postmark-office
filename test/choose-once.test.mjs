// choose-once.test.mjs — A PROVISIONAL HOUSE CHOOSES ITS KEY ONCE (POS-159).
//
// RULED (Keemin, 2026-09-22): a house that never declared gets a PROVISIONAL key
// from its first resident's handle. At its human's FIRST co-sign — a declaration
// through `mintHousehold` naming a real slug — it chooses its key ONCE: the
// row's slug becomes the chosen one, the provisional key lands in `formerly`,
// `provisional` goes false, and from then on the key is immutable like everyone
// else's.
//
// ── WHY A RENAME AND NOT A SECOND MINT ──────────────────────────────────────
//
// Minting would leave the resident in TWO households — the provisional one
// nobody can now find, and the declared one — and no pen in this store holds
// DELETE (019), so nothing could clean it up afterwards. So the row moves in
// place, and the falsifiers below count rows rather than trust the call.
//
// ── "ITS PINS FOLLOW", AND WHAT THAT ACTUALLY MEANS HERE ────────────────────
//
// The ruling says the house's pins follow it. Measured against the schema:
// `household_pins` carries `handle`, `login`, `gh_id` and four legacy notes
// (019) and NO household reference of any kind. There is nothing in that table
// pointing at a slug, so a rename cannot leave anything pointing at the old one.
// The belonging lives in `households.residents`, which is a column OF the row
// being renamed and therefore travels with it. The falsifier below asserts the
// substance — every resident of the house still resolves to it under the new
// key, and not one pin row was written — rather than a re-pointing that the
// table has no column for.
//
// THE POOL IS STUBBED, NOT MOCKED AROUND, the way every suite in this lane's
// family does it. The stub answers the real UPDATE the rename sends and
// enforces the primary key, so "one row, renamed" is a measurement.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { __setPoolForTest } from "../src/world2-acts.mjs";
import { makePool } from "./registry-pool-stub.mjs";
import { rowsFromRegistry, registryFromRows, renderRegistry } from "../src/registry-rows.mjs";
import { houseForAccount } from "../src/residency.mjs";
import { mintHousehold, joinHousehold, REFUSALS, NO_DRAIN } from "../src/ceremony.mjs";
import { rowForHouse } from "../src/registry-backfill.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "registry-2026-09-22");
const HOUSEHOLDS_RAW = readFileSync(join(FIX, "households.json"), "utf8");
const PINS_RAW = readFileSync(join(FIX, "github-ids.json"), "utf8");

const ENV_ON = { WORLD2_PG: "1", WORLD2_PG_URL: "postgres://stub/none" };

// The human who never declared, and their agent.
const HUMAN = { ghId: 770000123, ghLogin: "a-quiet-human" };
const HANDLE = "fernwood";

/**
 * The town, plus ONE provisional house exactly as the backfill would write it.
 *
 * Built through `rowForHouse` rather than by hand, so this suite and
 * `registry-backfill.test.mjs` cannot drift about what a backfilled row is.
 */
function townWithAProvisionalHouse() {
  const seed = rowsFromRegistry(JSON.parse(HOUSEHOLDS_RAW), JSON.parse(PINS_RAW));
  const ord = Math.max(...seed.households.map((r) => Number(r.ord))) + 1;
  const row = rowForHouse({
    slug: HANDLE,
    name: "Fernwood's household",
    accounts: [{ login: HUMAN.ghLogin, id: HUMAN.ghId }],
    residents: [HANDLE, "fern-sibling"],
    since: "2026-08-14",
    declared_by: "the POS-159 backfill",
    pins: [],
  });
  seed.households.push({ ...row, ord });
  seed.pins.push(
    { handle: HANDLE, login: HUMAN.ghLogin, gh_id: String(HUMAN.ghId), pinned: "2026-08-14",
      renamed: null, note: null, retired: null, renamed_to: null },
    { handle: "fern-sibling", login: HUMAN.ghLogin, gh_id: String(HUMAN.ghId), pinned: "2026-08-20",
      renamed: null, note: null, retired: null, renamed_to: null },
  );
  return seed;
}

const withTown = async (fn, seed = townWithAProvisionalHouse()) => {
  const pool = makePool(seed);
  __setPoolForTest(pool);
  try { return await fn(pool); } finally { __setPoolForTest(null); }
};

const houseIn = (pool, slug) => pool.state.households.find((h) => h.slug === slug);

test("the fixture this suite reasons about is the shape the backfill writes", async () => {
  await withTown(async (pool) => {
    const row = houseIn(pool, HANDLE);
    assert.equal(row.provisional, true);
    assert.deepEqual(row.formerly, []);
    assert.equal(pool.state.households.length, 119);
  });
});

// ── THE CHOICE ──────────────────────────────────────────────────────────────

test("the first co-sign RENAMES the provisional house instead of founding a second", async () => {
  await withTown(async (pool) => {
    const before = houseIn(pool, HANDLE).ord;

    const r = await mintHousehold({
      slug: "fernwood-hollow", name: "Fernwood Hollow", coSign: HUMAN,
      since: "2026-09-22", declaredBy: "the first co-sign", env: ENV_ON, drain: NO_DRAIN,
    });

    assert.equal(r.slug, "fernwood-hollow");
    assert.deepEqual(r.chose, { from: HANDLE, confirmed: false }, "the answer SAYS it was a choice, not a founding");

    // ONE ROW. This is the whole falsifier: a mint would have made 120.
    assert.equal(pool.state.households.length, 119, "still 119 houses — nothing was founded");
    assert.equal(houseIn(pool, HANDLE), undefined, "the provisional key is gone from the record");

    const row = houseIn(pool, "fernwood-hollow");
    assert.ok(row, "and the house stands under the chosen key");
    assert.deepEqual(row.formerly, [HANDLE], "the old key is KEPT, not dropped");
    assert.equal(row.provisional, false);
    assert.equal(row.name, "Fernwood Hollow", "a declaration that states a name states it");
    assert.equal(row.ord, before, "and the house keeps its standing place in the file");
    assert.deepEqual(row.residents, [HANDLE, "fern-sibling"], "its residents came with it");
    assert.deepEqual(row.accounts, [{ login: HUMAN.ghLogin, id: HUMAN.ghId }]);
    assert.equal(row.since, "2026-08-14", "and its own since, not the declaration's");
  });
});

test("the pins follow, which here means not one of them had to move", async () => {
  await withTown(async (pool) => {
    const pinsBefore = JSON.parse(JSON.stringify(pool.state.pins));
    await mintHousehold({
      slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN,
    });

    assert.equal(pool.state.writes.pins, 0, "no pin row was written — the table has no household column");
    assert.deepEqual(pool.state.pins, pinsBefore);

    // and the substance: every resident still reaches the house, under the new key
    const registry = registryFromRows({
      meta: pool.state.meta,
      households: pool.state.households,
      pins: pool.state.pins,
    });
    assert.equal(houseForAccount(registry, HUMAN.ghId, HUMAN.ghLogin), "fernwood-hollow");
    assert.deepEqual(registry.households["fernwood-hollow"].residents, [HANDLE, "fern-sibling"]);
  });
});

test("a house confirming the key it already carries keeps it, and appends nothing", async () => {
  // A resident declaring the very slug the backfill lent them is not a
  // collision — it is "this borrowed name is the one". The answer is to stop
  // calling it borrowed, not to refuse them with TAKEN.
  await withTown(async (pool) => {
    const r = await mintHousehold({
      slug: HANDLE, coSign: HUMAN, since: "2026-09-22", declaredBy: "x",
      env: ENV_ON, drain: NO_DRAIN,
    });
    assert.equal(r.slug, HANDLE);
    assert.deepEqual(r.chose, { from: HANDLE, confirmed: true });

    const row = houseIn(pool, HANDLE);
    assert.equal(row.provisional, false, "it is no longer borrowed");
    assert.deepEqual(row.formerly, [], "and it never had a different key to remember");
    assert.equal(pool.state.households.length, 119);
  });
});

test("a declaration that states NO name leaves the borrowed nameplate standing", async () => {
  await withTown(async (pool) => {
    await mintHousehold({
      slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN,
    });
    assert.equal(houseIn(pool, "fernwood-hollow").name, "Fernwood's household",
      "silence is not an instruction to clear the house's name");
  });
});

// ── ONCE ────────────────────────────────────────────────────────────────────

test("a SECOND choice is refused — the key is immutable from the first one", async () => {
  await withTown(async (pool) => {
    await mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });

    await assert.rejects(
      () => mintHousehold({ slug: "a-better-name", coSign: HUMAN, since: "2026-09-22",
        declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
      (e) => e.refusal === REFUSALS.CHOSEN && e.code === 409);

    assert.equal(pool.state.households.length, 119, "and nothing was founded on the way out");
    assert.ok(houseIn(pool, "fernwood-hollow"), "the house still stands under the key it chose");
    assert.equal(houseIn(pool, "a-better-name"), undefined);
  });
});

test("re-declaring the very key it just chose is refused too", async () => {
  await withTown(async (pool) => {
    await mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });
    await assert.rejects(
      () => mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
        declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
      (e) => e.refusal === REFUSALS.CHOSEN || e.refusal === REFUSALS.TAKEN);
    assert.equal(pool.state.households.length, 119);
  });
});

test("the CHOSEN refusal is frozen, exported, and says what a person should do", () => {
  assert.ok(Object.isFrozen(REFUSALS.CHOSEN));
  assert.equal(REFUSALS.CHOSEN.code, 409);
  assert.equal(REFUSALS.CHOSEN.field, "household");
  assert.ok(REFUSALS.CHOSEN.defect.length && REFUSALS.CHOSEN.hint.length);
  assert.notEqual(REFUSALS.CHOSEN, REFUSALS.TAKEN, "it is its own sentence, not an alias");
});

// ── WHO MAY CHOOSE ──────────────────────────────────────────────────────────

test("ANOTHER account naming the provisional house's key is refused exactly as today", async () => {
  // The choice belongs to the house's own human. A stranger naming the
  // provisional slug meets the ordinary collision, and nothing renames.
  const STRANGER = { ghId: 880000999, ghLogin: "not-their-human" };
  await withTown(async (pool) => {
    await assert.rejects(
      () => mintHousehold({ slug: HANDLE, coSign: STRANGER, since: "2026-09-22",
        declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
      (e) => e.refusal === REFUSALS.TAKEN);
    assert.equal(houseIn(pool, HANDLE).provisional, true, "the house is still provisional");
    assert.deepEqual(houseIn(pool, HANDLE).formerly, []);
  });
});

test("a stranger founding a DIFFERENT house is untouched by any of this", async () => {
  const STRANGER = { ghId: 880000999, ghLogin: "not-their-human" };
  await withTown(async (pool) => {
    const r = await mintHousehold({ slug: "a-stranger-house", coSign: STRANGER,
      since: "2026-09-22", declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });
    assert.equal(r.slug, "a-stranger-house");
    assert.ok(!("chose" in r), "an ordinary mint does not claim to have chosen anything");
    assert.equal(pool.state.households.length, 120, "THIS one really is a new house");
    assert.equal(houseIn(pool, "a-stranger-house").provisional, false);
    assert.equal(houseIn(pool, HANDLE).provisional, true, "and the provisional house is untouched");
  });
});

test("the house's human choosing a key SOMEBODY ELSE holds is refused", async () => {
  // One choice is not a claim on the roll. The ordinary collision sentence
  // applies, and the house stays provisional so they can choose again.
  await withTown(async (pool) => {
    await assert.rejects(
      () => mintHousehold({ slug: "fox-hearth", coSign: HUMAN, since: "2026-09-22",
        declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
      (e) => e.refusal === REFUSALS.TAKEN);
    assert.equal(houseIn(pool, HANDLE).provisional, true, "still theirs to choose");
    assert.equal(pool.state.households.length, 119);
  });
});

test("an unlawful key is refused BEFORE the record is read, provisional house or not", async () => {
  await withTown(async (pool) => {
    await assert.rejects(
      () => mintHousehold({ slug: "Not A Slug", coSign: HUMAN, since: "2026-09-22",
        declaredBy: "x", env: ENV_ON, drain: NO_DRAIN }),
      (e) => e.refusal === REFUSALS.BAD_SLUG);
    assert.equal(houseIn(pool, HANDLE).provisional, true);
  });
});

// ── A RESIDENT JOINING DOES NOT CHOOSE ──────────────────────────────────────

test("a resident joining a provisional house leaves it provisional", async () => {
  // The choice is the HUMAN's co-sign at the mint, not an admission. And this
  // is the probe for the other half: `joinHousehold` writes the whole row back
  // through `upsertHousehold`, so a `provisional` it failed to carry would be
  // silently cleared by an ordinary join.
  await withTown(async (pool) => {
    const r = await joinHousehold({ slug: HANDLE, handle: "a-new-fern", coSign: HUMAN,
      pinnedOn: "2026-09-22", env: ENV_ON, drain: NO_DRAIN });
    assert.deepEqual(r.residents, [HANDLE, "fern-sibling", "a-new-fern"]);
    assert.equal(houseIn(pool, HANDLE).provisional, true, "still provisional after an admission");
    assert.deepEqual(houseIn(pool, HANDLE).formerly, []);
  });
});

test("a resident joining an ORDINARY house does not make it provisional either", async () => {
  await withTown(async (pool) => {
    await joinHousehold({ slug: "fox-hearth", handle: "a-new-sibling", coSign: HUMAN,
      env: ENV_ON, drain: NO_DRAIN });
    assert.equal(houseIn(pool, "fox-hearth").provisional, false);
  });
});

// ── THE STOP, AND THE DOOR THAT CLOSED IT (POS-159 → POS-197) ──────────────
//
// POS-159 MEASURED that no door reached this path: for an account whose house
// is PROVISIONAL, `houseForAccount` found that house and the planner answered
// `appended` whatever the resident typed, so the mint was never called and the
// house never chose. These two tests asserted that gap on purpose, so the day
// the route was wired they would red and hand the wirer this paragraph.
//
// POS-197 WIRED IT: `planRegistryJoin` answers `chosen` for a provisional
// house's own human naming a real house, and its callers route that to the
// ceremony's rename. So the "Fernwood Hollow" arm below now asserts the ROUTE
// where it asserted the gap. The two arms that are NOT a choice — the borrowed
// key, and nothing at all — keep their original assertions exactly, and so
// does the control. `test/join-pr-at-the-cosign.test.mjs` and the crossing's
// test at the bottom of this file drive the route through the real callers.

test("THE STOP, CLOSED: a provisional house's human naming a real house is routed to the choice", async () => {
  const { planRegistryJoin } = await import("../src/residency.mjs");
  const seed = townWithAProvisionalHouse();
  const registry = registryFromRows(seed);
  assert.equal(registry.households[HANDLE].provisional, true);

  const chose = planRegistryJoin(registry, {
    handle: "fernwood-two", household: "Fernwood Hollow", ghId: HUMAN.ghId, ghLogin: HUMAN.ghLogin, date: "2026-09-22",
  });
  assert.equal(chose?.action, "chosen", "naming a real house routes to the choice");
  assert.equal(chose?.from, HANDLE, "from the borrowed key");
  assert.equal(chose?.to, "fernwood-hollow", "to the key the typed name slugs to");
  assert.equal(chose?.slug, "fernwood-hollow");
  assert.deepEqual(chose?.formerly, [HANDLE], "the borrowed key is kept");
  assert.equal(chose?.already, false);
  assert.notEqual(chose?.action, "created", "a choice is never a second house");

  for (const household of [HANDLE, ""]) {
    const plan = planRegistryJoin(registry, {
      handle: "fernwood-two", household, ghId: HUMAN.ghId, ghLogin: HUMAN.ghLogin, date: "2026-09-22",
    });
    assert.equal(plan?.action, "appended",
      `naming ${JSON.stringify(household)} appends to the provisional house rather than founding`);
    assert.equal(plan?.slug, HANDLE, "and the borrowed key stands");
    assert.notEqual(plan?.action, "created", "so no caller of mintHousehold fires");
  }

  // AND THE CONTROL, so the probe is measuring reachability and not just
  // agreeing with itself: a human with NO house does reach the mint.
  const control = planRegistryJoin(registry, {
    handle: "somebody-new", household: "A Brand New House",
    ghId: 880000999, ghLogin: "a-total-stranger", date: "2026-09-22",
  });
  assert.equal(control?.action, "created", "a houseless human still founds");
});

test("THE STOP's second half, CLOSED: the name they declare is the name on the card", async () => {
  // The resident types "Fernwood Hollow" on the household line. Before POS-197
  // the plan appended them to `fernwood` and the card read the borrowed
  // nameplate. Now the card reads the name they chose.
  const { planRegistryJoin } = await import("../src/residency.mjs");
  const registry = registryFromRows(townWithAProvisionalHouse());
  const plan = planRegistryJoin(registry, {
    handle: "fernwood-two", household: "Fernwood Hollow",
    ghId: HUMAN.ghId, ghLogin: HUMAN.ghLogin, date: "2026-09-22",
  });
  assert.equal(plan.houseLine, "Fernwood Hollow", "the chosen name is what the card will read");
  assert.notEqual(plan.houseLine, "Fernwood's household");
});

// ── THE ROUTE'S EDGES (POS-197) ─────────────────────────────────────────────

test("typing the borrowed NAMEPLATE is naming the house they are in — appended, not chosen", async () => {
  const { planRegistryJoin } = await import("../src/residency.mjs");
  const registry = registryFromRows(townWithAProvisionalHouse());
  const plan = planRegistryJoin(registry, {
    handle: "fernwood-two", household: "Fernwood's household",
    ghId: HUMAN.ghId, ghLogin: HUMAN.ghLogin, date: "2026-09-22",
  });
  assert.equal(plan.action, "appended");
  assert.equal(plan.slug, HANDLE);
});

test("a STRANGER typing a new name while a provisional house stands founds their own — never a rename", async () => {
  // The account decides. Nothing about the provisional house is reachable by a
  // human whose account it does not list.
  const { planRegistryJoin } = await import("../src/residency.mjs");
  const registry = registryFromRows(townWithAProvisionalHouse());
  const plan = planRegistryJoin(registry, {
    handle: "someone-else", household: "Fernwood Hollow",
    ghId: 880000999, ghLogin: "a-total-stranger", date: "2026-09-22",
  });
  assert.equal(plan.action, "created");
  assert.equal(plan.registry.households[HANDLE].provisional, true, "the provisional house is untouched");
});

test("the plan's fold mirrors the rename — same place, `formerly`, no `provisional`, residents joined", async () => {
  const { planRegistryJoin } = await import("../src/residency.mjs");
  const registry = registryFromRows(townWithAProvisionalHouse());
  const plan = planRegistryJoin(registry, {
    handle: "fernwood-two", household: "Fernwood Hollow",
    ghId: HUMAN.ghId, ghLogin: HUMAN.ghLogin, date: "2026-09-22",
  });
  const keys = Object.keys(plan.registry.households);
  assert.equal(keys.indexOf("fernwood-hollow"), Object.keys(registry.households).indexOf(HANDLE), "same place");
  assert.ok(!keys.includes(HANDLE), "the borrowed key is no longer a house key in the fold");
  const rec = plan.registry.households["fernwood-hollow"];
  assert.ok(!("provisional" in rec));
  assert.deepEqual(rec.formerly, [HANDLE]);
  assert.equal(rec.name, "Fernwood Hollow");
  assert.deepEqual(rec.residents, [HANDLE, "fern-sibling", "fernwood-two"]);
  assert.equal(registry.households[HANDLE].provisional, true, "and the input registry was not mutated");
});

test("a house that ALREADY chose answers `chosen`, marked `already` — and naming its old key does not", async () => {
  await withTown(async (pool) => {
    await mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });
    const { planRegistryJoin } = await import("../src/residency.mjs");
    const registry = registryFromRows({ meta: pool.state.meta, households: pool.state.households, pins: pool.state.pins });

    const again = planRegistryJoin(registry, {
      handle: "fernwood-two", household: "Somewhere Else Entirely",
      ghId: HUMAN.ghId, ghLogin: HUMAN.ghLogin, date: "2026-09-22",
    });
    assert.equal(again.action, "chosen");
    assert.equal(again.already, true);
    assert.equal(again.slug, "fernwood-hollow", "an `already` plan stands on the key the house chose");

    for (const household of ["Fernwood Hollow", HANDLE, ""]) {
      const plan = planRegistryJoin(registry, {
        handle: "fernwood-two", household, ghId: HUMAN.ghId, ghLogin: HUMAN.ghLogin, date: "2026-09-22",
      });
      assert.equal(plan.action, "appended", `${JSON.stringify(household)} names the house they are in`);
      assert.equal(plan.slug, "fernwood-hollow");
    }
  });
});

test("THE CROSSING routes `chosen` to the rename — the flicker road, the real `writeTownDrain`", async () => {
  // A join opened while the door could not read the record reaches the
  // crossing unplanned. The crossing's plan is `chosen`; the house must be
  // renamed through the ceremony and the resident admitted under the new key.
  const { writeTownDrain } = await import("../src/town-drain.mjs");
  const { planRegistryJoin, REGISTRY_PATH, PINS_PATH } = await import("../src/residency.mjs");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const seed = townWithAProvisionalHouse();
  const clone = mkdtempSync(join(tmpdir(), "pos197-"));
  mkdirSync(join(clone, "tools"), { recursive: true });
  const rendered = renderRegistry(seed);
  writeFileSync(join(clone, REGISTRY_PATH), rendered.households);
  writeFileSync(join(clone, PINS_PATH), rendered.pins);

  const row = {
    seq: 11, cls: "join", act: "request-residency", handle: "fernwood-two",
    ghId: HUMAN.ghId, ghLogin: HUMAN.ghLogin,
    payload: { household: "Fernwood Hollow", card: "hello" },
  };
  const registry = registryFromRows(seed);
  const p = planRegistryJoin(registry, {
    handle: row.handle, household: row.payload.household, ghId: row.ghId, ghLogin: row.ghLogin, date: "2026-09-23",
  });
  assert.equal(p.action, "chosen");

  const pool = makePool(seed);
  __setPoolForTest(pool);
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  Object.assign(process.env, ENV_ON);
  let touched;
  try {
    touched = await writeTownDrain(clone, { plans: [{ row, plan: p }], registry: p.registry }, { date: "2026-09-23" });
  } finally {
    __setPoolForTest(null);
    if (was.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
    if (was.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
  }

  assert.equal(touched.stalled?.length ?? 0, 0, "the row landed");
  assert.equal(houseIn(pool, HANDLE), undefined, "no row under the borrowed key");
  const house = houseIn(pool, "fernwood-hollow");
  assert.ok(house, "the house stands under the chosen key");
  assert.deepEqual(house.formerly, [HANDLE], "`formerly` carries the borrowed key");
  assert.equal(house.provisional, false);
  assert.equal(house.name, "Fernwood Hollow");
  assert.ok(house.residents.includes("fernwood-two"), "and the resident is admitted to it");
  assert.equal(pool.state.households.length, 119, "one house, renamed — never a second");
  assert.ok(pool.state.pins.some((x) => x.handle === "fernwood-two" && String(x.gh_id) === String(HUMAN.ghId)),
    "the pin names the resident; the belonging travels with the renamed row");
});

test("THE CROSSING admits an `already` plan to the chosen house — never a stalled row", async () => {
  // At the door a second choice is refused. At the crossing the Registrar has
  // already admitted the resident, so refusing would stall the row, and hold
  // the cursor, on every crossing forever. The house is joined, not renamed.
  const { writeTownDrain } = await import("../src/town-drain.mjs");
  const { planRegistryJoin, REGISTRY_PATH, PINS_PATH } = await import("../src/residency.mjs");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  await withTown(async (pool) => {
    await mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });
    const state = { meta: pool.state.meta, households: pool.state.households, pins: pool.state.pins };
    const clone = mkdtempSync(join(tmpdir(), "pos197-"));
    mkdirSync(join(clone, "tools"), { recursive: true });
    const rendered = renderRegistry(state);
    writeFileSync(join(clone, REGISTRY_PATH), rendered.households);
    writeFileSync(join(clone, PINS_PATH), rendered.pins);

    const row = {
      seq: 12, cls: "join", act: "request-residency", handle: "fernwood-three",
      ghId: HUMAN.ghId, ghLogin: HUMAN.ghLogin,
      payload: { household: "Somewhere Else Entirely", card: "hello" },
    };
    const p = planRegistryJoin(registryFromRows(state), {
      handle: row.handle, household: row.payload.household, ghId: row.ghId, ghLogin: row.ghLogin, date: "2026-09-23",
    });
    assert.equal(p.action, "chosen");
    assert.equal(p.already, true);

    const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
    Object.assign(process.env, ENV_ON);
    let touched;
    try {
      touched = await writeTownDrain(clone, { plans: [{ row, plan: p }], registry: p.registry }, { date: "2026-09-23" });
    } finally {
      if (was.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
      if (was.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
    }
    assert.equal(touched.stalled?.length ?? 0, 0, "the row landed rather than stalling");
    const house = houseIn(pool, "fernwood-hollow");
    assert.ok(house.residents.includes("fernwood-three"), "admitted to the house under the key it chose");
    assert.deepEqual(house.formerly, [HANDLE], "and the key did not move a second time");
    assert.equal(pool.state.households.length, 119);
  });
});

// ── THE FILE THE TOWN SEES ──────────────────────────────────────────────────

test("a provisional house renders its key, and a chosen one renders `formerly` instead", async () => {
  await withTown(async (pool) => {
    const render = () => registryFromRows({
      meta: pool.state.meta, households: pool.state.households, pins: pool.state.pins,
    }).households;

    const before = render()[HANDLE];
    assert.equal(before.provisional, true, "the town's file SAYS the key is borrowed");
    assert.ok(!("formerly" in before));

    await mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });

    const after = render()["fernwood-hollow"];
    assert.ok(!("provisional" in after), "and stops saying it once the key is chosen");
    assert.deepEqual(after.formerly, [HANDLE], "the old key is readable in the town's own file");
    assert.equal(Object.keys(after).at(-1), "formerly");
  });
});

test("the other 118 houses are untouched, and the renamed one keeps its PLACE", async () => {
  // The rename names no `ord`, so the house does not move. A rename that
  // re-derived one would push the house to the end of the file and rewrite
  // every row after it — 118 blocks of diff for one house stating its name.
  await withTown(async (pool) => {
    const fold = () => registryFromRows({
      meta: pool.state.meta, households: pool.state.households, pins: pool.state.pins,
    }).households;

    const before = fold();
    const wasAt = Object.keys(before).indexOf(HANDLE);
    assert.ok(wasAt >= 0);

    await mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });

    const after = fold();
    assert.equal(Object.keys(after).indexOf("fernwood-hollow"), wasAt, "same place in the file");
    assert.equal(Object.keys(after).length, Object.keys(before).length, "same number of houses");

    // every OTHER house, byte for byte, in the same order
    const others = (o) => Object.entries(o).filter(([s]) => s !== HANDLE && s !== "fernwood-hollow");
    assert.deepEqual(others(after), others(before), "118 houses, not one key moved");

    // and the renamed one really did change — the probe can fail
    assert.notDeepEqual(after["fernwood-hollow"], before[HANDLE]);
  });
});

test("the rendered file changes by exactly the renamed house's own lines", async () => {
  await withTown(async (pool) => {
    const render = () => renderRegistry({
      meta: pool.state.meta, households: pool.state.households, pins: pool.state.pins,
    }).households;

    const before = render();
    await mintHousehold({ slug: "fernwood-hollow", coSign: HUMAN, since: "2026-09-22",
      declaredBy: "x", env: ENV_ON, drain: NO_DRAIN });
    const after = render();

    assert.notEqual(before, after, "the file DID change");
    // The house sheds one line (`"provisional": true`) and gains three
    // (`"formerly": [`, the old key, `]`), so the file is two lines longer.
    assert.equal(after.split("\n").length, before.split("\n").length + 2);
    assert.ok(!after.includes(`"${HANDLE}": {`), "the old key is no longer a household key");
    assert.ok(after.includes(`"fernwood-hollow": {`));
    assert.ok(after.includes(`"${HANDLE}"`), "but it is still readable, in `formerly`");
    assert.ok(!after.includes('"provisional"'), "and nothing in the file is provisional any more");
  });
});
