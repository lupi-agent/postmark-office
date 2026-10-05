// world-households-one-key.test.mjs — the world's registry gives each declared house ONE key.
//
// The Starling House (wayward-archivist's home parcel, House of Many Doors) was
// left drafted at every settlement from 09-29 18:00Z. The world's
// WORLD/households.json keyed kinofire (declared through the office door, with a
// sealed hh: ledger line) as `hh:house-of-many-doors` and the three residents
// who joined by PR under the same account as `gh:334016343`. The mark sat in
// the `draft/house-of-many-doors` sketchbook, and the sweep's authorship wall
// read its author as another household's resident. Eight of 134 declared houses
// were split the same way on the live town (2026-09-30).
//
// The export now keys every handle a declared house lists by that house
// (`hh:<slug>`), resolves every spelling of the house (each account's gh:, the
// current key, each former key) to it, and binds each house's own sketchbook
// name. The stub town below is the one the export's other suites use: a
// `stamp-mint.mjs` whose `currentHouseholds` answers the ledger's keys.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { loginKeys, householdsOf, oneKeyPerHouse } from "../src/household-logins.mjs";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "postmark-one-key-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });
// THE STORE the export renders (POS-350): it reads the registry from the store,
// never the fixture town's printouts, so each run re-states the store from them.
import { registryStoreForTowns } from "./helpers/office-under-test.mjs";
const REG = await registryStoreForTowns({ db: "one_key_test" });
after(() => REG.stop());


const ACCOUNT = { login: "commander-and-chief", id: 334016343 };

// The ledger's keys, as the live town has them: one office-declared resident,
// three PR-joined residents under the same account, a re-keyed house whose
// resident still wears its old key, and a handle no house lists.
const LEDGER = {
  kinofire: "hh:house-of-many-doors",
  "wayward-archivist": "gh:334016343",
  seasiren: "gh:334016343",
  wildcat: "gh:334016343",
  "emmett-songbound": "hh:the-held-place.-a-long-old-key",
  wanderer: "solo:wanderer",
};
const PINS = {
  kinofire: { ...ACCOUNT, pinned: "2026-09-25" },
  "wayward-archivist": { ...ACCOUNT, pinned: "2026-09-26" },
  seasiren: { ...ACCOUNT, pinned: "2026-09-26" },
  wildcat: { ...ACCOUNT, pinned: "2026-09-28" },
  "emmett-songbound": { login: "sunflower-vertigo", id: 240802882, pinned: "2026-09-25" },
};
const DECLARED = {
  schema_version: 1,
  households: {
    "house-of-many-doors": { name: "house-of-many-doors", accounts: [ACCOUNT], residents: ["kinofire", "seasiren", "wayward-archivist", "wildcat"] },
    "the-held-place-at-fern-hollow": { name: "The Held Place at Fern Hollow", accounts: [{ login: "sunflower-vertigo", id: 240802882 }],
      residents: ["emmett-songbound"], formerly: ["the-held-place.-a-long-old-key"] },
  },
};

async function run(label, { declared = DECLARED } = {}) {
  const town = join(scratch, `${label}-town`);
  mkdirSync(join(town, "tools"), { recursive: true });
  const entries = Object.entries(LEDGER).map(([h, key]) => `["${h}", { key: ${JSON.stringify(key)} }]`);
  writeFileSync(join(town, "tools", "stamp-mint.mjs"), `export function currentHouseholds() { return new Map([${entries.join(", ")}]); }\n`);
  writeFileSync(join(town, "tools", "github-ids.json"), JSON.stringify(PINS));
  if (declared) writeFileSync(join(town, "tools", "households.json"), JSON.stringify(declared));
  const world = join(scratch, `${label}-world`);
  mkdirSync(join(world, "WORLD"), { recursive: true });
  await REG.seedFrom(town);
  const out = execFileSync(process.execPath, [join(OFFICE, "tools", "world-households-export.mjs"), "--town", town, "--world", world],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...REG.env } });
  return { out, emitted: JSON.parse(readFileSync(join(world, "WORLD", "households.json"), "utf8")) };
}

test("House of Many Doors: an office-declared resident and three PR-joined residents under one account get ONE key", async () => {
  const { emitted } = (await run("hmd"));
  for (const h of ["kinofire", "seasiren", "wayward-archivist", "wildcat"])
    assert.equal(emitted.households[h], "hh:house-of-many-doors", `${h} is the house's`);
  assert.equal(emitted.logins["commander-and-chief"], "hh:house-of-many-doors", "the account's login points at the house");
  assert.equal(emitted.logins["house-of-many-doors"], "hh:house-of-many-doors",
    "and the house's own sketchbook name binds it, though a login already binds the key");

  // What the sweep's wall does (settlement-sweep.mjs ~1255): the branch's
  // household against the author's. The Starling House: draft/house-of-many-doors, by wayward-archivist.
  const branch = emitted.logins["house-of-many-doors"];
  const author = emitted.households["wayward-archivist"];
  assert.equal(author, branch, "the wall reads one household on both sides");
});

test("a re-keyed house: its resident and its former sketchbook name resolve to the current key", async () => {
  const { emitted } = (await run("rekeyed"));
  assert.equal(emitted.households["emmett-songbound"], "hh:the-held-place-at-fern-hollow");
  assert.equal(emitted.logins["the-held-place-at-fern-hollow"], "hh:the-held-place-at-fern-hollow");
  assert.equal(emitted.logins["the-held-place.-a-long-old-key"], "hh:the-held-place-at-fern-hollow",
    "a sketchbook opened under the old key still belongs to the house");
  assert.equal(emitted.logins["sunflower-vertigo"], "hh:the-held-place-at-fern-hollow");
});

test("a handle no declared house lists keeps its ledger key; every login binds a key some handle carries", async () => {
  const { emitted } = (await run("undeclared"));
  assert.equal(emitted.households.wanderer, "solo:wanderer");
  for (const [name, key] of Object.entries(emitted.logins))
    assert.ok(Object.values(emitted.households).includes(key), `logins["${name}"] binds ${key}, which no handle carries`);
});

test("a town with no households.json keeps the ledger's keys exactly (nothing to resolve to)", async () => {
  const { emitted } = (await run("none", { declared: null }));
  assert.deepEqual(emitted.households, Object.fromEntries(Object.entries(LEDGER).sort(([a], [b]) => a.localeCompare(b))));
});

test("the money surfaces' projections do not move: loginKeys and householdsOf answer the ledger's keys", () => {
  // oneKeyPerHouse composes onto the EXPORT only; the card rail and the Stripe
  // attribution read loginKeys / householdsOf, which still answer the ledger.
  const ledger = new Map(Object.entries(LEDGER).map(([h, key]) => [h, { key }]));
  const households = householdsOf(ledger);
  const { logins } = loginKeys(PINS, households);
  assert.equal(logins["commander-and-chief"], "gh:334016343");
  assert.equal(households["wayward-archivist"], "gh:334016343");
  const one = oneKeyPerHouse(households, logins, DECLARED);
  assert.equal(one.logins["commander-and-chief"], "hh:house-of-many-doors");
  assert.equal(households["wayward-archivist"], "gh:334016343", "the input map is not mutated");
});
