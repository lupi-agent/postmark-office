// world2-claims-household.test.mjs — the docket pen's household SPELLING.
//
// A/B finding AB-R.household: `marks.household` carried three spellings of one
// fact — `gh:<id>` from the seed, NULL where the seed found no roster line, and a
// bare handle (`darko`) from this pen. Wright's ruling, 2026-08-28: adopt 1.0's
// spelling — a roster owner keeps the household KEY, a non-roster owner is
// `solo:<handle>`, never NULL.
//
// ── AND THE KEY IS THE SLUG NOW (POS-160, the w40 ship) ─────────────────────
//
// The pen used to read `identities.household`, a projection of the WORLD repo's
// copy of the town's pins, and adopt whatever spelling that copy carried. So
// "one fact, one spelling" held only as far as that copy did: 173 of 190
// handles wore `gh:<id>` and 17 wore `hh:<slug>` on the day this changed, and
// the two halves of one house could wear one each.
//
// It now asks `household-deriver.mjs` over the registry that IS the record, and
// answers `hh:<slug>`. This file is that claim's falsifier: the four spellings
// a caller can hold — the slug, the `hh:` key, the `gh:<id>`, the handle —
// resolve to ONE key, and a former slug resolves to the house that used to
// wear it.
//
// `householdKeyFor` takes the pool as an argument, so the resolution is testable
// without a database and without the door: the stub answers the registry's own
// three SELECTs, and what is under test is the decision made from the answer.
// THE HANDLES ARE DISTINCT PER TEST on purpose — the pen's positive memo is
// module-level and outlives a test, which is itself asserted below.

import { test } from "node:test";
import assert from "node:assert/strict";

import { householdKeyFor } from "../src/world2-claims.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";
import { makePool } from "./registry-pool-stub.mjs";
import { __clearHouseCache } from "../src/household-deriver.mjs";

/** A registry store holding exactly the houses a test names. */
function registry(households, pins = {}) {
  __clearHouseCache();
  const pool = makePool(rowsFromRegistry({ schema_version: 1, households }, pins));
  let calls = 0;
  const q = pool.query.bind(pool);
  pool.query = (...a) => { calls++; return q(...a); };
  Object.defineProperty(pool, "calls", { get: () => calls });
  return pool;
}

const ROOKERY = {
  "the-rookery": {
    name: "The Rookery",
    accounts: [{ login: "CrowAndClock", id: 265401358 }],
    residents: ["darko", "rei"],
    formerly: ["the-old-rookery"],
  },
};
const ROOKERY_PINS = {
  darko: { login: "CrowAndClock", id: 265401358, pinned: "2026-07-01" },
  rei: { login: "CrowAndClock", id: 265401358, pinned: "2026-07-01" },
};

test("FOUR SPELLINGS, ONE KEY — the slug, the hh: key, the gh:<id> and the handle", async () => {
  const p = registry(ROOKERY, ROOKERY_PINS);
  for (const spelling of ["the-rookery", "hh:the-rookery", "gh:265401358", "darko"]) {
    assert.equal(await householdKeyFor(p, spelling), "hh:the-rookery", `spelling: ${spelling}`);
  }
  // two handles, one household — which is the whole reason the column holds a key
  assert.equal(await householdKeyFor(p, "rei"), "hh:the-rookery");
});

test("a FORMER slug resolves to the house that wears its new one", async () => {
  const p = registry(ROOKERY, ROOKERY_PINS);
  // `formerly` is the one alias mechanism (POS-158's choose-once path writes
  // it), and this resolver is the one place it is read. A row written under the
  // old slug therefore still names a house, rather than reading as a stranger.
  assert.equal(await householdKeyFor(p, "the-old-rookery"), "hh:the-rookery");
});

test("a handle the registry does not name is solo:<handle>, never NULL", async () => {
  const p = registry(ROOKERY, ROOKERY_PINS);
  assert.equal(await householdKeyFor(p, "wren-winter"), "solo:wren-winter");
});

test("a MISS is not cached, so registry lag resolves itself", async () => {
  // marks-fold.mjs § the household grain: "registry lag never blocks a new
  // resident, it only leaves them ungrouped until the town knows them." Caching
  // the miss would keep writing solo: for a resident the town had since learned,
  // for as long as the office stayed up.
  const p = registry({ ...ROOKERY }, ROOKERY_PINS);
  assert.equal(await householdKeyFor(p, "newcomer"), "solo:newcomer");
  // the join lands: the house lists them, and the deriver's fold is dropped the
  // way every registry writer drops it
  p.state.households[0].residents = ["darko", "rei", "newcomer"];
  __clearHouseCache();
  assert.equal(await householdKeyFor(p, "newcomer"), "hh:the-rookery");
});

test("a HIT is cached — a household key is not a fact that gets taken away", async () => {
  const p = registry({ "hals-place": { residents: ["hal"], accounts: [] } });
  assert.equal(await householdKeyFor(p, "hal"), "hh:hals-place");
  const after = p.calls;
  assert.equal(await householdKeyFor(p, "hal"), "hh:hals-place");
  assert.equal(p.calls, after, "the second resolution asked the database again");
});

test("no handle at all is NULL — there is nothing to spell", async () => {
  const p = registry(ROOKERY, ROOKERY_PINS);
  assert.equal(await householdKeyFor(p, null), null);
  assert.equal(p.calls, 0);
});

test("a PINNED account is not reachable by its login string alone", async () => {
  // The recycled-login law (`household-deriver.mjs § accountMatches`): GitHub
  // releases abandoned logins for re-registration, so a row that carries an id
  // may be matched by an id and by nothing else. `CrowAndClock` names a pinned
  // account here, and naming it must not walk anyone into that house.
  const p = registry(ROOKERY, ROOKERY_PINS);
  assert.equal(await householdKeyFor(p, "CrowAndClock"), "solo:CrowAndClock");
});
