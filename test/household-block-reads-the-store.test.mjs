// household-block-reads-the-store.test.mjs — POS-342: "which house now" is the store's answer.
//
// The office's household block (src/households.mjs) used to answer from the
// town clone: the ledger's resolver plus the printed tools/households.json. A
// housemate the ceremony had bound in the store, and the drain had not yet
// printed, was "not of this household" at the hold door. These drive the real
// module over a stub store and a clone whose printout says the opposite, so the
// only way to pass is to read the store.
//
// THE FLIP: put back the clone-reading households.mjs (48e7678's) and the
// housemate tests go red, because the printout files kin in a house of their own.
//
//   node --test test/household-block-reads-the-store.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// A town clone whose PRINTOUT disagrees with the store: kin stands in a house
// of their own there, and the ledger engine (the old resolver's source) agrees
// with the printout. Set before the module loads, because the old module bound
// its clone at load.
const town = mkdtempSync(join(tmpdir(), "pos342-town-"));
mkdirSync(join(town, "tools"), { recursive: true });
writeFileSync(join(town, "tools", "households.json"), JSON.stringify({ schema_version: 1, households: {
  "ana-house": { residents: ["ana"], accounts: [{ login: "ana-gh", id: 1 }] },
  "kin-alone": { residents: ["kin"], accounts: [{ login: "kin-gh", id: 2 }] },
} }));
writeFileSync(join(town, "tools", "github-ids.json"), JSON.stringify({ ana: { login: "ana-gh", id: 1 }, kin: { login: "kin-gh", id: 2 } }));
writeFileSync(join(town, "tools", "stamp-mint.mjs"), `
export function currentHouseholds() {
  return new Map([["ana", { key: "gh:1" }], ["kin", { key: "gh:2" }], ["zed", { key: "gh:3" }]]);
}
`);
process.env.TOWN_CLONE = town;

// THE STORE: the ceremony has moved kin into ana's house (the printout has not caught up).
const { installActsPen, uninstallActsPen, RECORD_ON } = await import("./acts-pen-stub.mjs");
const { rowsFromRegistry } = await import("../src/registry-rows.mjs");
const STORE = rowsFromRegistry({ schema_version: 1, households: {
  "ana-house": { human: "Ana", residents: ["ana", "kin"], accounts: [{ login: "ana-gh", id: 1 }, { login: "kin-gh", id: 2 }] },
} }, { ana: { login: "ana-gh", id: 1 }, kin: { login: "kin-gh", id: 2 } });
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
installActsPen({ households: STORE.households, pins: STORE.pins, meta: [] });
after(() => {
  uninstallActsPen();
  delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL;
  rmSync(town, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const households = await import("../src/households.mjs");
const { sameHousehold, refuseOutOfReach } = await import("../src/world-hold.mjs");

// `householdLookup` is the new read; the old module only had the synchronous `householdOf`.
const lookupNow = async () => (households.householdLookup ? households.householdLookup() : households.householdOf);

test("a housemate bound only in the store is of the author's household", async () => {
  const of = await lookupNow();
  const kin = of("kin");
  assert.equal(kin?.slug, "ana-house", "the store files kin in ana's house; the printout's kin-alone is not the record");
  assert.deepEqual(kin?.residents, ["ana", "kin"]);
  const same = sameHousehold("ana", "kin", of);
  assert.deepEqual(same, { same: true, how: "household", slug: "ana-house" });
});

test("AT THE HOLD DOOR: the housemate may take the author's private draft", async () => {
  // Clause 4: an unpublished thing changes hands only inside its author's
  // household. The adjudicator is driven with the door's own lookup.
  const ctx = { mark: null, canon_readable: true, within: () => false, standing: { placed: true, x: 0, y: 0 },
    standsWithin: () => false, householdOf: await lookupNow() };
  const ok = await refuseOutOfReach({ thing: "ana/the-loom", actor: "kin", act: "take", ctx });
  assert.equal(ok?.unpublished_own_draft, true, "kin is ana's housemate in the record, so the take is in-house");
  await assert.rejects(
    refuseOutOfReach({ thing: "ana/the-loom", actor: "zed", act: "take", ctx }),
    (e) => e.code === 409 && /you are not of that household \(by the town's household record/.test(e.hint),
    "a stranger is still refused, by the record");
});

test("the block a door shows is the store's house", async () => {
  const hh = await households.householdOf("kin");
  assert.deepEqual(hh, { key: "hh:ana-house", slug: "ana-house", human: "Ana", residents: ["ana", "kin"] });
  assert.deepEqual(await households.householdOf("zed"), { key: "solo:zed", slug: null, human: null, residents: ["zed"] },
    "a handle no house in the record holds is a household of one, said as a fact");
});

test("a store the office cannot ask leaves the block absent, never the printout's", async () => {
  const keep = process.env.WORLD2_PG;
  delete process.env.WORLD2_PG;
  try {
    assert.equal(await households.householdLookup(), null);
    assert.equal(await households.householdOf("kin"), null);
    assert.deepEqual(sameHousehold("ana", "kin", null), { same: false, how: "handle-only", slug: null },
      "the ladder degrades to the narrower test it can prove, and says so");
  } finally { process.env.WORLD2_PG = keep; }
});
