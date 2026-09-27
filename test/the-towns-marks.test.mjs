// the-towns-marks.test.mjs — POS-142: the town's marks keep `solo:the-town`
// BY NAME, as an interim, so the marks ingest can carry a town mark.
//
// Keemin, 2026-09-24 ~19:3x EDT: "the town should be some kind of entity, idk
// if household is correct, but yes the long-term shape is that the meeps should
// belong to the town." Wright proposed an interim (the town's marks keep
// `solo:the-town` by name, pinned by a test, committing to nothing about what
// the town is) and Keemin approved it: "I agree. good to have a lane build it
// tonight".
//
// The finding it answers: the dev sandbox's ingest run refused whole at
// `NO_SUCH_HOUSE`, because six of its adds are authored by `the-town` and the
// town is not a household on the roll. Since POS-160's Ruling 1 the pen mints
// no `solo:` at all (`materialize.mjs § ownerHouseholdFor`), so every ingest
// carrying a new town mark would refuse whole.
//
// These legs pin the ONE exception and its edges:
//   · a town claim materializes as `solo:the-town`, before the roll is asked;
//   · an unknown claimant who is not the town still refuses `NO_SUCH_HOUSE`;
//   · `solo:` is minted for no other handle — near-misses of the town's name
//     included;
//   · a claimant the roll names still gets `hh:<slug>`.
//
// The flip (the exception removed) reds the first legs: see the PR body.
//
// The stub is not Postgres. It answers the registry's three SELECTs and the
// marks INSERT `materializeClaims` makes, and refuses anything else.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ownerHouseholdFor, materializeClaims, TOWN_CLAIMANT, TOWN_HOUSEHOLD_BY_NAME,
} from "../world2/tools/materialize.mjs";
import { __clearHouseCache, houseRowsVia } from "../src/household-deriver.mjs";
import { REFUSALS } from "../src/ceremony.mjs";
import { planAdoption } from "../src/solo-adoption.mjs";
import { conformance, DECLARE_BOUNCES } from "../src/declare.mjs";
import { validateResidencyRequest } from "../src/residency.mjs";
import { fixtureDb } from "./fixture.mjs";

/** A roll that does NOT name the town: the real roll's shape (121 houses, none holds `the-town`). */
const ROLL = { berthillon: { accounts: [{ login: "devadavisson", id: 12345 }], residents: ["berthillon"] } };

function stubQ(roll = ROLL) {
  const households = Object.entries(roll).map(([slug, rec], i) => ({
    slug, ord: i, name: null, human: null, accounts: rec.accounts ?? [], residents: rec.residents ?? [],
    since: null, member_of: null, declared_by: null, formerly: [], provisional: false,
  }));
  const q = async (text, params = []) => {
    q.calls.push(text.trim().split(/\s+/).slice(0, 4).join(" "));
    if (/FROM households/i.test(text)) { q.rollReads++; return { rows: households, rowCount: households.length }; }
    if (/FROM household_pins/i.test(text)) return { rows: [], rowCount: 0 };
    if (/FROM registry_meta/i.test(text)) return { rows: [{ key: "schema_version", value: "1" }], rowCount: 1 };
    if (/^\s*INSERT INTO marks/i.test(text)) {
      const [id, slug, kind, owner, household] = params;
      q.marks.push({ id, slug, kind, owner, household });
      return { rows: [], rowCount: 1 };
    }
    assert.fail(`the stub does not answer this statement:\n${text}`);
  };
  q.calls = [];
  q.rollReads = 0;
  q.marks = [];
  __clearHouseCache();
  return q;
}

const refusedAsNoSuchHouse = (who) => (e) => {
  assert.equal(e.refusal, REFUSALS.NO_SUCH_HOUSE, `${JSON.stringify(who)} was refused with the wrong refusal: ${e.message}`);
  assert.equal(e.code, 404);
  return true;
};

test("the exception is one named constant, spelled the way the store already holds the town's 378 rows", () => {
  assert.equal(TOWN_CLAIMANT, "the-town");
  assert.equal(TOWN_HOUSEHOLD_BY_NAME, "solo:the-town");
});

test("a town claim answers `solo:the-town`, BEFORE the roll is asked", async () => {
  const q = stubQ();
  assert.equal(await ownerHouseholdFor(q, "the-town"), "solo:the-town");
  assert.equal(q.rollReads, 0, "the town's answer asked the roll — the interim puts it before the roll");
  assert.deepEqual(q.calls, [], "the town's answer touched the store at all");
});

test("a town claim materializes as `solo:the-town` through `materializeClaims`", async () => {
  const q = stubQ();
  const n = await materializeClaims(q, {
    windowId: 7,
    claims: [{ id: "c-town", slug: "the-town/zz-fixture-law", class: "predicated", claimant: "the-town",
               household: "solo:the-town", body: "b", geometry: null, bbox: null, data: { tier: "constitution" }, parent: null }],
  });
  assert.equal(n, 1);
  assert.deepEqual(q.marks.map((m) => [m.slug, m.owner, m.household]),
    [["the-town/zz-fixture-law", "the-town", "solo:the-town"]]);
});

test("an unknown claimant who is not the town still refuses NO_SUCH_HOUSE", async () => {
  const q = stubQ();
  await assert.rejects(() => ownerHouseholdFor(q, "little-pica"), refusedAsNoSuchHouse("little-pica"));
});

test("`solo:` is minted for NO other handle — `vireo`, and every near-miss of the town's own name", async () => {
  for (const who of ["vireo", "The-Town", "the-towns", "town", "the_town", "solo:the-town", "hh:the-town", "the-town/constitution"]) {
    const q = stubQ();
    await assert.rejects(() => ownerHouseholdFor(q, who), refusedAsNoSuchHouse(who), `${who} was answered`);
  }
});

test("a town claim does not unlock the roll for anyone else in the same store", async () => {
  const q = stubQ();
  assert.equal(await ownerHouseholdFor(q, "the-town"), "solo:the-town");
  await assert.rejects(() => ownerHouseholdFor(q, "vireo"), refusedAsNoSuchHouse("vireo"));
  assert.equal(await ownerHouseholdFor(q, "berthillon"), "hh:berthillon", "a resident on the roll is still `hh:<slug>`");
});

test("a batch carrying a town mark and a houseless stranger still refuses on the stranger (the rollback is the caller's transaction, which this stub does not hold)", async () => {
  const q = stubQ();
  const base = { class: "predicated", body: "b", geometry: null, bbox: null, data: {}, parent: null };
  await assert.rejects(() => materializeClaims(q, {
    windowId: 7,
    claims: [
      { ...base, id: "c-town", slug: "the-town/zz-a", claimant: "the-town" },
      { ...base, id: "c-vireo", slug: "vireo/zz-b", claimant: "vireo" },
    ],
  }), refusedAsNoSuchHouse("vireo"));
});

test("CONSUMER — POS-212's adoption never adopts a town row: `solo:the-town` is ORPHANED on a roll no house of which holds it", async () => {
  const { registry, pins } = await houseRowsVia({ query: stubQ() });
  const plan = planAdoption({
    marks: [{ id: "m-town", slug: "the-town/zz-fixture-law", kind: "predicated", owner: "the-town", household: "solo:the-town", status: "standing" }],
    registry, pins,
  });
  assert.deepEqual(plan.houses, [], "a house adopted the town's mark");
  assert.deepEqual(plan.orphans.map((o) => [o.slug, o.from]), [["the-town/zz-fixture-law", "solo:the-town"]]);
  assert.deepEqual(plan.stops, []);
});

// ── THE HANDLE IS RESERVED — the impersonation door the interim would open ──
//
// The exception above answers the claimant `the-town` with the town's own
// spelling and never asks the roll. A resident HOLDING that handle would have
// their marks filed as the town's, and POS-212's adoption would then see
// `solo:the-town` held by their house and adopt every town mark into it. So
// the handle is reserved at the one set every minting door reads
// (`residency.mjs § RESERVED`, via `validateResidencyRequest`).

const CARD = "I keep notes for a person who forgets things. Write to me about anything you are trying to remember.";
const reservedInTheDoorsWords = (e) => {
  assert.equal(e.code, 409);
  assert.equal(e.defect, '"the-town" is reserved');
  assert.match(e.hint, /names the town/);
  return true;
};

test("DECLARE: declaring the handle `the-town` refuses 409 on the handle, in the door's words", () => {
  const db = fixtureDb();
  const key = { ghId: 424242, ghLogin: "some-stranger", household: "some-stranger", handles: new Set(), visitor: true };
  const registry = { schema_version: 1, households: {} };
  assert.throws(() => conformance({ household: "The Ordinary Hours", handle: "the-town", card: CARD }, { db, registry, key }),
    (e) => { assert.equal(e.field, "handle"); return reservedInTheDoorsWords(e); });
  // and the published bounce list says so, so a caller can read it before trying
  const rule = DECLARE_BOUNCES.find((b) => b.field === "handle" && b.code === 409 && /reserved name/.test(b.rule));
  assert.match(rule.rule, /the-town/);
});

// `requestResidency` (the add-resident door) calls this first, before the
// registry or the pen: `residency.mjs § requestResidency`. The leg asks the
// validator rather than the door so that a flipped run cannot walk on into the
// store read and the GitHub pen.
test("ADD-RESIDENT: requesting residency as `the-town` refuses 409 at the door's validator, in the door's words", () => {
  const db = fixtureDb();
  assert.throws(() => validateResidencyRequest({ handle: "the-town", card: CARD }, db), reservedInTheDoorsWords);
});

test("the reservation is the exact handle: `the-towns` and `town` stay free at the door", async () => {
  const db = fixtureDb();
  const key = { ghId: 424242, ghLogin: "some-stranger", household: "some-stranger", handles: new Set(), visitor: true };
  const registry = { schema_version: 1, households: {} };
  for (const handle of ["the-towns", "town"])
    assert.equal(conformance({ household: "The Ordinary Hours", handle, card: CARD }, { db, registry, key }).handle, handle);
});
