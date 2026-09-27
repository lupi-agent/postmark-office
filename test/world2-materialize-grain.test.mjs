// world2-materialize-grain.test.mjs — the mark's household is the CLAIMANT's,
// resolved, never the claim's scope label — and from the w40 law date it is
// spelled `hh:<slug>` or it is REFUSED.
//
// The 09-02 catch (the flip week's first): `claims.household` is the acting
// KEY's household name — for a human-credentialed act, the human's GitHub
// login — and materialize copied it into `marks.household`, making the login
// the ownership grain on 26 standing rows across 12 households. The standing
// walk then refused sovereignty on residents' own parcels (fold says home,
// port says market, the port right about a store that was wrong). Two
// questions, one column: scope stays the claim's; ownership resolves from the
// claimant.
//
// ── WHAT POS-160's FOLLOW-UP CHANGED (RED 2) ────────────────────────────────
//
// The 08-28 spelling was "the roster's household KEY, else solo:<handle>", and
// that roster was `identities` — the WORLD repo's copy of the pins, projected,
// answering in whatever spelling it happened to hold (measured 2026-09-22:
// `gh:` ×173, `hh:` ×17, one house wearing both). #165's lane named this
// function as THE SOURCE of the multi-spelling store. Ruling 1 says every new
// line from the law date carries `hh:<slug>`, so:
//
//   it asks the ONE DERIVER against the registry in the caller's own store;
//   it answers `hh:<slug>`, always;
//   a claimant the roll cannot name is a REFUSAL, not a `solo:` fallback —
//   every `solo:` row in the store was minted by that fallback, right here.
//
// THE STUB ANSWERS THE REGISTRY'S THREE TABLES **AND** `identities`, the second
// on purpose: it is what makes FLIP 2 a measurement. A stub that refused the
// old statement would red under the flip because the STUB refused it, not
// because the pen wrote the wrong key. Answered, the flip hands the pen back
// `gh:12345` and the assertions red on the value. It is not Postgres:
// `registryRowsVia` is handed a queryable and these are its statements.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ownerHouseholdFor } from "../world2/tools/materialize.mjs";
import { __clearHouseCache, houseKeysOf } from "../src/household-deriver.mjs";
import { REFUSALS } from "../src/ceremony.mjs";

/**
 * A `q(text, args)` answering the three registry SELECTs from a roll — AND the
 * `identities` SELECT the pen used to make, from the spelling that table still
 * holds.
 *
 * THE `identities` ROW IS ANSWERED ON PURPOSE, and it is what makes FLIP 2 a
 * measurement rather than an act. A stub that refused the old statement would
 * red under the flip because the STUB refused it, not because the pen wrote the
 * wrong key — "a probe that relies on a refusal is an act." Answered, the flip
 * gets `gh:12345` back and every `hh:` assertion below reds on the VALUE, which
 * is the brief's own falsifier: a house whose `identities` row still says `gh:`
 * must have its new marks written `hh:<slug>`.
 *
 * `roll` is `{ <slug>: { accounts: [{ login, id }], residents: [handle…] } }`,
 * and `pins` is `{ <handle>: { login, gh_id } }` — the row shapes
 * `registry-store.mjs` selects, not the file's.
 */
function stubQ(roll = {}, pins = {}, identities = {}) {
  const households = Object.entries(roll).map(([slug, rec], i) => ({
    slug, ord: i, name: rec.name ?? null, human: rec.human ?? null,
    accounts: rec.accounts ?? [], residents: rec.residents ?? [],
    since: null, member_of: null, declared_by: null, formerly: [], provisional: false,
  }));
  const pinRows = Object.entries(pins).map(([handle, p]) => ({
    handle, login: p.login ?? null, gh_id: p.id == null ? null : String(p.id),
    pinned: null, renamed: null, note: null, retired: null, renamed_to: null,
  }));

  const q = async (text, params = []) => {
    q.calls++;
    if (/FROM households/i.test(text)) return { rows: households, rowCount: households.length };
    if (/FROM household_pins/i.test(text)) return { rows: pinRows, rowCount: pinRows.length };
    if (/FROM registry_meta/i.test(text)) return { rows: [{ key: "schema_version", value: "1" }], rowCount: 1 };
    if (/FROM identities/i.test(text)) {
      q.identityReads++;
      const household = identities[params[0]];
      return { rows: household ? [{ household }] : [], rowCount: household ? 1 : 0 };
    }
    assert.fail(`ownerHouseholdFor asked a statement this stub does not answer:\n${text}`);
  };
  q.calls = 0;
  q.identityReads = 0;
  // The cache is per-queryable and lives in a WeakMap, so each stub starts
  // clean — but `__clearHouseCache` is the seam that makes that a promise
  // rather than a hope, and a suite that shared a `q` would need it.
  __clearHouseCache();
  return q;
}

/**
 * The house the live defect was about: berthillon, acting through his human.
 *
 * Its `identities` row STILL SAYS `gh:12345` — the store never re-spells a row,
 * and that table is the world repo's copy in whatever spelling it holds. The
 * pen must write `hh:berthillon` anyway. That gap is RED 2.
 */
const BERTHILLON = {
  roll: { berthillon: { accounts: [{ login: "devadavisson", id: 12345 }], residents: ["berthillon"] } },
  pins: { berthillon: { login: "devadavisson", id: 12345 } },
  identities: { berthillon: "gh:12345" },
};
const berthillonQ = () => stubQ(BERTHILLON.roll, BERTHILLON.pins, BERTHILLON.identities);

test("the grain is the claimant's house, spelled `hh:<slug>`, whatever the claim's scope label said", async () => {
  // The live defect's shape: berthillon acting through his human's key — the
  // claim's household is solo:devadavisson; the MARK's is the house's slug.
  const q = berthillonQ();
  assert.equal(await ownerHouseholdFor(q, "berthillon"), "hh:berthillon");
});

test("and it is the SLUG now, not `identities`' spelling — RED 2's whole point", async () => {
  // THE FALSIFIER, in the brief's own words: a house whose `identities` row
  // still says `gh:` files its NEW marks under `hh:<slug>`. The stub answers
  // that row, so this reds on the VALUE if the pen goes back to reading it.
  const q = berthillonQ();
  assert.equal(BERTHILLON.identities.berthillon, "gh:12345", "the old spelling is still on record");
  const key = await ownerHouseholdFor(q, "berthillon");
  assert.equal(key, "hh:berthillon",
    "the pen wrote `identities`' spelling into `marks.household` — that is the SOURCE of the multi-spelling store");
  assert.equal(q.identityReads, 0, "and it did not read `identities` at all");
});

test("THE READ SIDE STILL FINDS THE OLD `gh:` MARKS OF THE SAME HOUSE", async () => {
  // The other half of RED 2's falsifier, and the reason the refusal above is
  // safe: nothing is orphaned by the pen changing its spelling, because the
  // house's SPELLING SET carries the old one. New rows `hh:`, old rows `gh:`,
  // one house, one set.
  const q = berthillonQ();
  const fresh = await ownerHouseholdFor(q, "berthillon");
  const set = houseKeysOf(fresh, { households: BERTHILLON.roll }, BERTHILLON.pins);
  assert.deepEqual(set, ["hh:berthillon", "gh:12345", "solo:berthillon", "solo:devadavisson"]);
  assert.ok(set.includes(fresh), "the house reads what its pen just wrote");
  assert.ok(set.includes(BERTHILLON.identities.berthillon),
    "and still reaches the rows written under the spelling `identities` holds");
});

test("every road to the house answers the same key — the handle, and the account the human signed with", async () => {
  const q = berthillonQ();
  for (const x of ["berthillon", "gh:12345", "hh:berthillon"])
    assert.equal(await ownerHouseholdFor(q, x), "hh:berthillon", `asked as ${x}`);
});

test("a claimant the roll does not name is REFUSED — never `solo:<handle>` again", async () => {
  // `little-pica` is on no roll AND has no `identities` row, so the pre-RED-2
  // pen answered `solo:little-pica` — the fallback that minted every `solo:`
  // row in the store. The stub answers the old statement, so this reds because
  // the pen FELL BACK, not because a statement went unanswered.
  const q = berthillonQ();
  await assert.rejects(() => ownerHouseholdFor(q, "little-pica"), (e) => {
    assert.equal(e.refusal, REFUSALS.NO_SUCH_HOUSE,
      "the refusal is the join ceremony's own, by identity — two wordings would be two laws wearing one name");
    assert.equal(e.code, 404);
    assert.match(e.detail, /little-pica/);
    assert.match(e.detail, /no longer mints/);
    return true;
  });
});

test("a claim with NO claimant is refused too — `marks.household` is never NULL", async () => {
  const q = berthillonQ();
  for (const nobody of ["", "   ", null, undefined])
    await assert.rejects(() => ownerHouseholdFor(q, nobody), (e) => {
      assert.equal(e.refusal, REFUSALS.NO_SUCH_HOUSE);
      assert.match(e.detail, /no claimant/);
      return true;
    });
});

test("AN UNREADABLE ROLL IS ITS OWN REFUSAL — NULL IS NOT EMPTY, one table over", async () => {
  // A store holding no households is an OPERATOR's problem, not one resident's,
  // and saying "the roll does not name berthillon" about it would send a person
  // to fix a row that is fine. 503, not 404.
  const q = stubQ({}, {});
  await assert.rejects(() => ownerHouseholdFor(q, "berthillon"), (e) => {
    assert.equal(e.refusal, REFUSALS.NO_RECORD);
    assert.equal(e.code, 503);
    assert.match(e.detail, /names no households/);
    return true;
  });
});

test("the registry is folded ONCE per store — a crossing does not re-read the roll per claim", async () => {
  const q = berthillonQ();
  assert.equal(await ownerHouseholdFor(q, "berthillon"), "hh:berthillon");
  const after = q.calls;
  assert.equal(after, 3, "one SELECT per registry table, and no more");
  for (let i = 0; i < 5; i++) await ownerHouseholdFor(q, "berthillon");
  assert.equal(q.calls, after,
    "the second resolution asked the database again — an unmemoised deriver puts the whole registry through " +
    "`registryFromRows` on every line of a crossing");
});

test("THE CACHE IS SCOPED TO THE STORE, not to the process", async () => {
  // The `ownerKeys` Map this replaced was keyed on the handle alone and outlived
  // any one store, so a suite's stub and a real pool in one process shared an
  // answer and `__clearHouseCache` could not reach it.
  const a = berthillonQ();
  assert.equal(await ownerHouseholdFor(a, "berthillon"), "hh:berthillon");

  const b = stubQ({ "the-annex": { accounts: [{ login: "devadavisson", id: 12345 }], residents: ["berthillon"] } },
                  { berthillon: { login: "devadavisson", id: 12345 } });
  assert.equal(await ownerHouseholdFor(b, "berthillon"), "hh:the-annex",
    "a second store's answer arrived from the first store's memo");
});
