// household-deriver.test.mjs — ONE DERIVER ANSWERS "WHICH HOUSE" (POS-160).
//
// Three implementations answered this question before `src/household-deriver.mjs`
// existed, and the drift was measurable on the live town: on 2026-09-22 the
// world's copy of the registry spelled 173 of 190 handles `gh:<id>` and 17
// `hh:<slug>`, and ONE HOUSE — umbraliminalis — wore both at once, because a
// ledger re-key had reached its first resident and not its other seven. Two
// halves of one family, filed as strangers.
//
// THE CLAIM UNDER TEST: every spelling a caller can be holding — the slug, the
// `hh:` key, the `gh:<id>`, a resident's handle, a former slug — resolves to
// the SAME house, and an unknown one resolves to nothing rather than to a guess.
//
// THE FIXTURE IS THE TOWN'S OWN, byte-exact at 2026-09-22 (118 households, 190
// pins — the same `test/fixtures/registry-2026-09-22/` the round-trip law is
// proven on). Three invented houses would prove the walk composes with itself;
// these are the shapes the registry actually wears, including the two houses
// that hold TWO GitHub accounts each. `formerly` is the one thing the fixture
// cannot supply — POS-158 shipped the column and the choose-once path, and no
// door has reached it yet, so 0 of 118 houses carry an alias — so those rows
// are synthetic and say so.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveHouse, VIA, keyOfSlug, slugFromName } from "../src/household-deriver.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "registry-2026-09-22");
const REGISTRY = JSON.parse(readFileSync(join(FIX, "households.json"), "utf8"));
const PINS = JSON.parse(readFileSync(join(FIX, "github-ids.json"), "utf8"));

// Asserted rather than computed, so a fixture swapped for a smaller one cannot
// quietly make every count below trivially true.
const LIVE = { households: 118, pins: 190 };

const house = (x, opts) => resolveHouse(x, REGISTRY, PINS, opts);

test("the fixture is the live registry, not a toy", () => {
  assert.equal(Object.keys(REGISTRY.households).length, LIVE.households);
  assert.equal(Object.keys(PINS).length, LIVE.pins);
});

// ── FALSIFIER 1 · FOUR SPELLINGS, ONE SLUG ──────────────────────────────────
//
// Three houses with a `gh:` history, each chosen for a different shape:
//
//   starforge          nine residents on ONE account — the common case, and
//                      the one the credential key gets right by luck
//   the-carried-weight TWO accounts, two residents, so the world's copy files
//                      liv and noe under two different keys today
//   umbraliminalis     eight residents on one account, and the house the live
//                      copy already spells two ways
//
// Every spelling of each must land on the one slug. A test that only asked
// `slug -> slug` would pass against a function that did nothing.
const THREE = [
  { slug: "starforge", gh: 67605380, handles: ["wright", "mari", "rei"] },
  { slug: "the-carried-weight", gh: 295879730, handles: ["liv", "noe"] },
  { slug: "umbraliminalis", gh: 329054166, handles: ["caelum-of-the-umbra", "fiery-nomi"] },
];

test("FALSIFIER 1 · every spelling of one house resolves to one slug", () => {
  for (const h of THREE) {
    const rec = REGISTRY.households[h.slug];
    assert.ok(rec, `${h.slug} is in the fixture`);

    assert.deepEqual(house(h.slug), { slug: h.slug, via: VIA.SLUG }, `${h.slug}: the slug itself`);
    assert.deepEqual(house(`hh:${h.slug}`), { slug: h.slug, via: VIA.SLUG }, `${h.slug}: the hh: key`);
    assert.deepEqual(house(`gh:${h.gh}`), { slug: h.slug, via: VIA.ACCOUNT }, `${h.slug}: the gh: key`);
    for (const handle of h.handles) {
      assert.equal(house(handle).slug, h.slug, `${h.slug}: the handle ${handle}`);
    }
    // and the key the ship writes is the same one whichever road got there
    for (const x of [h.slug, `hh:${h.slug}`, `gh:${h.gh}`, ...h.handles]) {
      assert.equal(keyOfSlug(house(x).slug), `hh:${h.slug}`, `${h.slug}: key from ${x}`);
    }
  }
});

test("FALSIFIER 1b · the house with TWO accounts answers to both of them", () => {
  // The credential key's whole defect, in one assertion: `the-carried-weight`
  // holds two GitHub accounts, so the world's copy files liv and noe under two
  // keys and the parcel cap counts one family twice. Both ids, one slug.
  const rec = REGISTRY.households["the-carried-weight"];
  const ids = (rec.accounts ?? []).map((a) => a.id);
  assert.equal(ids.length, 2, "the fixture still has the two-account house");
  for (const id of ids) {
    assert.deepEqual(house(`gh:${id}`), { slug: "the-carried-weight", via: VIA.ACCOUNT });
  }
});

test("FALSIFIER 1c · EVERY pinned handle in the registry resolves, and to one house each", () => {
  // The census, not a sample. A handle that resolved to two houses would be an
  // ambiguity this walk has no way to report, so the walk must be a function.
  let resolved = 0;
  const bySlug = new Map();
  for (const handle of Object.keys(PINS)) {
    const a = house(handle);
    if (!a.slug) continue;
    resolved++;
    // the same handle through its pin's id lands on the same house
    const id = PINS[handle]?.id;
    if (id != null) assert.equal(house(`gh:${id}`).slug, a.slug, `${handle} via gh:${id}`);
    if (!bySlug.has(a.slug)) bySlug.set(a.slug, []);
    bySlug.get(a.slug).push(handle);
  }
  assert.equal(resolved, LIVE.pins,
    "every pinned handle the town knows belongs to a house the registry names");
  assert.equal(bySlug.size, LIVE.households,
    "and the 190 handles land on the 118 houses, not on 121 credential groups");
});

// ── FALSIFIER 2 · `formerly` IS THE ONE ALIAS MECHANISM ─────────────────────
test("FALSIFIER 2 · a former slug resolves to the house that wears its new one", () => {
  // SYNTHETIC: 0 of 118 live houses carry `formerly` (POS-158 shipped the
  // column and the choose-once path; no door reaches it yet), so the rows are
  // built here rather than pretended into the fixture.
  const reg = {
    households: {
      "the-trueing-house": { formerly: ["house-of-keemin", "hh:trueing"], accounts: [] },
      "the-rookery": { accounts: [] },
    },
  };
  assert.deepEqual(resolveHouse("house-of-keemin", reg), { slug: "the-trueing-house", via: VIA.FORMERLY });
  assert.deepEqual(resolveHouse("hh:trueing", reg), { slug: "the-trueing-house", via: VIA.FORMERLY },
    "an alias written as a full key resolves like one written bare");
  assert.deepEqual(resolveHouse("trueing", reg), { slug: "the-trueing-house", via: VIA.FORMERLY });
});

test("FALSIFIER 2b · a LIVE slug outranks another house's alias", () => {
  // Two houses may legitimately name one string, one as its key and one as its
  // past. The live one is the one that exists; an alias that outranked it would
  // file a house's mail at a neighbour's door.
  const reg = {
    households: {
      "the-annex": { formerly: ["the-rookery"], accounts: [] },
      "the-rookery": { accounts: [] },
    },
  };
  assert.deepEqual(resolveHouse("the-rookery", reg), { slug: "the-rookery", via: VIA.SLUG });
});

// ── FALSIFIER 3 · IT REFUSES RATHER THAN GUESSES ────────────────────────────
test("FALSIFIER 3 · an unknown spelling is `unknown`, never a nearby house", () => {
  for (const x of ["nobody-at-all", "gh:999999999", "hh:no-such-house", "", null, undefined]) {
    assert.deepEqual(house(x), { slug: null, via: VIA.UNKNOWN }, `unknown: ${JSON.stringify(x)}`);
  }
  assert.equal(keyOfSlug(house("nobody-at-all").slug), null);
});

test("FALSIFIER 3b · `solo:` and `login:` keys name no house of their own", () => {
  // `solo:<handle>` IS the statement "this handle is its own house", so the
  // honest answer is the absence, not a walk that hunts for one anyway.
  assert.equal(house("solo:wren-winter").slug, null);
  // A `login:` key enters through the account walk under accountMatches' rule,
  // so a login naming a PINNED account reaches nothing.
  assert.equal(house("login:crowandclock").slug, null);
});

test("FALSIFIER 3c · a pinned account is unreachable by its login string", () => {
  // The recycled-login law: GitHub releases abandoned logins for
  // re-registration, so a row carrying an id is matchable by an id alone.
  // Measured on this fixture: 0 of 121 accounts are id-less, so NO login
  // string reaches any house today — and the one that could, a legacy row, is
  // held to the same rule below.
  const idless = Object.values(REGISTRY.households)
    .flatMap((r) => r.accounts ?? []).filter((a) => a?.id == null);
  assert.equal(idless.length, 0, "every live account is pinned");
  for (const rec of Object.values(REGISTRY.households)) {
    for (const a of rec.accounts ?? []) {
      if (a?.login) assert.equal(
        resolveHouse(a.login, REGISTRY, PINS, { via: VIA.ACCOUNT }).slug, null,
        `login ${a.login} reached a house through the account walk`);
    }
  }
  const legacy = { households: { "old-house": { accounts: [{ login: "unpinned-soul" }] } } };
  assert.deepEqual(resolveHouse("unpinned-soul", legacy), { slug: "old-house", via: VIA.ACCOUNT },
    "a row with no id on record keeps matching by login, so nothing unpinned regresses");
});

// ── FALSIFIER 4 · THE WALK IS NARROWED, NOT SHARED WHOLE ────────────────────
test("FALSIFIER 4 · houseForName's question does not reach a resident handle", () => {
  // `declare.mjs` refuses a household name that is already taken by asking
  // `houseForName`. If that question walked `residents[]`, every resident's
  // handle would read as a taken house name and no one could ever declare one.
  assert.equal(resolveHouse("wright", REGISTRY, PINS, { via: [VIA.SLUG, VIA.NAME] }).slug, null);
  assert.equal(house("wright").slug, "starforge", "the unnarrowed walk still finds them");
});

test("FALSIFIER 4b · houseForAccount's question does not reach a slug", () => {
  assert.equal(resolveHouse("starforge", REGISTRY, PINS, { via: VIA.ACCOUNT }).slug, null);
});

test("a house's own name and human find it, but only when asked by name", () => {
  const named = Object.entries(REGISTRY.households).find(([, r]) => r.name);
  assert.ok(named, "the fixture has a house with a nameplate");
  const [slug, rec] = named;
  assert.equal(resolveHouse(rec.name, REGISTRY, PINS, { via: [VIA.SLUG, VIA.NAME] }).slug, slug);
  assert.equal(slugFromName("cadaeic.space"), "cadaeic.space", "a chosen domain is already a name");
});

// ── FALSIFIER 5 · A HANDLE THAT IS ALSO A HOUSE'S SLUG ──────────────────────
test("FALSIFIER 5 · a bare string is read as a HANDLE first, and the live collisions prove why", () => {
  // Measured on the fixture: three handles are also some house's slug. Two of
  // them belong to a DIFFERENT house than the one their string names, so a
  // slug-first walk files their drafts, stakes and acts inside a stranger's
  // walls — silently, because both answers are real houses.
  const slugs = REGISTRY.households;
  const alsoASlug = [];
  for (const [slug, rec] of Object.entries(slugs)) {
    for (const h of rec.residents ?? []) if (Object.hasOwn(slugs, h)) alsoASlug.push([h, slug]);
  }
  assert.deepEqual(alsoASlug.sort(), [
    ["elias-returning", "elias-returning"],
    ["mari", "starforge"],
    ["moth", "the-rookery"],
  ], "the live collisions this ordering exists for");

  // the handle wins: mari lives at starforge, not at the house called `mari`
  assert.deepEqual(house("mari"), { slug: "starforge", via: VIA.RESIDENT });
  assert.deepEqual(house("moth"), { slug: "the-rookery", via: VIA.RESIDENT });
  // and the house called `mari` is still reachable — by the key that says so
  assert.deepEqual(house("hh:mari"), { slug: "mari", via: VIA.SLUG });
  assert.deepEqual(house("gh:282963556"), { slug: "mari", via: VIA.ACCOUNT });
  // the harmless one answers the same either way
  assert.equal(house("elias-returning").slug, "elias-returning");
});

test("FALSIFIER 5b · this is what `identities` answered, so nobody's house moves", () => {
  // The claim that makes the ship safe: the deriver re-spells the key but does
  // not re-home anybody. `identities.household` was keyed by HANDLE, so its
  // answer for every one of the 190 pinned handles is the credential group of
  // the house the deriver now names — the same partition, a different spelling.
  // The three merges (two credential keys collapsing onto one declared house)
  // are the world export's business and are NOT taken here; see the PR's
  // finding 3. What is asserted here is the other direction: no handle lands
  // in a house that did not already hold it.
  for (const handle of Object.keys(PINS)) {
    const slug = house(handle).slug;
    assert.ok(slug, `${handle} resolves`);
    const rec = REGISTRY.households[slug];
    const listed = (rec.residents ?? []).includes(handle);
    const pinned = (rec.accounts ?? []).some((a) => a?.id != null && Number(a.id) === Number(PINS[handle]?.id));
    assert.ok(listed || pinned,
      `${handle} -> ${slug}: the house neither lists them nor pins their account`);
  }
});
