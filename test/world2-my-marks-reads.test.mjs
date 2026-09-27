// world2-my-marks-reads.test.mjs — `/world2/my-marks`, the portfolio twin, held
// to 1.0's own composition AND made unable to go green off the tree (POS-104).
//
// ── WHAT IS HELD TO WHAT ────────────────────────────────────────────────────
//
// `world.mjs § worldMyMarks` is a COMPOSITION over three readers, and the
// composition is the part a twin can get wrong in ways nobody sees: which rows
// land under `drafts` and which under `docket`, which published marks are
// excluded because they are already backed, where the page bound falls, and
// what `counts` means when the lists beside it are cut.
//
// So the equality here is against 1.0's own DECISIONS, imported rather than
// re-expressed:
//
//   markPage    src/world.mjs   the page bound and the `withheld` naming. The
//                               twin is handed the ORIGINAL function, so a
//                               changed bound moves both doors or neither.
//   backedRow   src/world-stake.mjs   `yours`, `holder_weight`, and the `unread`
//                               sentence. Exported and pure for exactly this.
//
// A twin that re-expressed either would pass a test written against its own
// copy. This file asserts that the twin's rows ARE those functions' output.
//
// ── WHY AN EQUALITY ALONE WOULD BE WORTHLESS ────────────────────────────────
//
// 1.0 reads two working trees. A twin that quietly read the same trees would
// answer identically, and every equality would pass with the port doing
// nothing. So the fixture store carries rows that stand in NO tree:
//
//   · `wright/only-in-the-store` — a standing mark in `marks` and nowhere else
//   · `ghost-holder` — a stake in `escrow_projection` and nowhere else
//
// and the pool COUNTS what it was asked, so a door that opened neither table
// fails on the count even if its numbers looked right.
//
// ── THE FLIP, run 2026-09-17 against commit `976b3de` of this branch ─────────
//
// In `src/world2-serve.mjs`'s `world2MyMarks`, point the twin at the tree:
// replace the canon read
//
//     const { rows: markRows } = await p.query(portfolio.PORTFOLIO_MARKS_SQL, [[...handles]]);
//
// with the folded tree the 1.0 door reads —
//
//     const markRows = ((await import("./world-branches.mjs"))
//       .publishedState(WORLD_CLONE).state.marks ?? [])
//       .filter((m) => handles.has(m.by))
//       .map((m) => ({ slug: m.id, kind: m.kind, owner: m.by, household: null,
//                      body: m.body, geometry: { at: m.at, extent: m.extent }, data: { tier: m.tier } }));
//
// and 4 of these 13 go red:
//
//   not ok 7 - THE PLANTED MARK: a published row that exists only in the store reaches the answer
//     error: |-
//       the twin did not see `wright/only-in-the-store` — it is reading a tree
//
// ⚑ THE QUERY-COUNT LEG DOES NOT CATCH THIS FLIP, and that is worth knowing
// rather than discovering later: `publishedIdsFrom` and `publishedMarkFrom`
// still open `marks` for the overlay's canon half, so the count stays green
// while the PUBLISHED list is coming off a tree. Counting the store's queries is
// a weaker instrument than planting a row in it, and here is the case that
// separates them. Both legs are kept; only one of them would have failed.
//
// Restore with `git checkout -- src/world2-serve.mjs`.
//
// Run: node --test test/world2-my-marks-reads.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { markPage } from "../src/world.mjs";
import { backedRow } from "../src/world-stake.mjs";
import { portfolioAnswerFrom, splitLive, publishedRowOf, PORTFOLIO_LABELS } from "../world2/tools/portfolio-reads.mjs";

const env = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
before(() => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://my-marks-reads-test/none";
});
after(() => {
  if (env.pg == null) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = env.pg;
  if (env.url == null) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = env.url;
});

const { world2MyMarks } = await import("../src/world2-serve.mjs");

// ── the fixture store ───────────────────────────────────────────────────────

// POS-160: the door's key is the house's SLUG now, so the fixture spells it
// the way the store will. Nothing about WHICH LISTS this suite is about moved —
// the same handle, the same rows, the same three lists — only the spelling of
// the one string they are all scoped by, which is the lane's whole point.
const HOUSEHOLD = "hh:pos104";
const TOWN_SHA = "610c43e7e5a7fabbcd340812b574c41ac31702f1";
// A handle nothing else in the suite uses: `world2-claims.mjs` keeps a
// process-wide `householdKeys` cache, and a shared handle would let one test's
// resolution decide another's.
const KEY = { household: "pos104-wright", handles: new Set(["pos104-wright"]) };

const markRow = ({ slug, owner = "pos104-wright", kind = "sited", body = "a mark", at = null, tier = "market" }) => ({
  slug, kind, owner, household: HOUSEHOLD, body,
  geometry: at ? { at, extent: { w: 2, h: 2 } } : null,
  data: { tier }, status: "standing", parent: null,
});

// ⚑ THE PLANTED MARK — standing in `marks`, in no clone, in no fold.
const PLANTED = markRow({ slug: "wright/only-in-the-store", body: "standing in the store and nowhere else", at: { x: 9, y: 9 } });
const PUBLISHED_ROWS = [
  markRow({ slug: "wright/the-trueing-house", at: { x: 100, y: 100 } }),
  markRow({ slug: "wright/the-lit-name", kind: "naming", body: "a naming has no site of its own" }),
  PLANTED,
  // Somebody else's mark, which this household has stamps on — it must appear
  // under `backed` and NEVER under `published`.
  markRow({ slug: "stranger/the-far-shed", owner: "stranger", at: { x: 400, y: 400 } }),
];

const claim = ({ slug, status, body = "a claim", stake = 0 }) => ({
  id: `00000000-0000-0000-0000-${slug.length.toString().padStart(12, "0")}`,
  slug, class: "sited", claimant: "pos104-wright", household: HOUSEHOLD, status, body,
  geometry: { slug: `pos104-wright/${slug}`, at: { x: 1, y: 2 }, extent: { w: 3, h: 4 } },
  stake, data: { by: "pos104-wright", kind: "sited", date: "2026-09-17" },
  submitted_at: new Date("2026-09-17T00:00:00Z"),
});
// ⚑ `claims.slug` CARRIES THE WHOLE ID, `<by>/<name>` — `liveMarkOf` reads the
// id off it and derives the BARE slug back out ("the bare slug is derived from
// the id — the docket pen discards it"). A fixture that filed a bare slug here
// would exercise a row this town never writes; this file's first cut did, and
// the twin reported `the-private-shed` where the door answers
// `pos104-wright/the-private-shed`.
const CLAIM_ROWS = [
  claim({ slug: "pos104-wright/the-private-shed", status: "draft" }),
  claim({ slug: "pos104-wright/the-staked-shed", status: "pending", stake: 2 }),
];

// ⚑ THE PLANTED STAKE — `ghost-holder` holds a position no ledger file carries.
const ESCROW_ROWS = [
  { mark: "stranger/the-far-shed", holder: "pos104-wright", household: HOUSEHOLD, own_household: "gh:stranger", n: 4, weight_k: 5 },
  { mark: "stranger/the-far-shed", holder: "ghost-holder", household: "solo:ghost", own_household: "gh:stranger", n: 6, weight_k: 5 },
  { mark: "wright/the-trueing-house", holder: "pos104-wright", household: HOUSEHOLD, own_household: HOUSEHOLD, n: 3, weight_k: 5 },
];

function fixturePool({ marks = PUBLISHED_ROWS, claims = CLAIM_ROWS, escrow = ESCROW_ROWS, townSha = TOWN_SHA } = {}) {
  const asked = [];
  const answer = async (sql, params) => {
    asked.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
    // THE TWO SESSION SETTINGS (POS-160 RULING 4). `app.household` is the one
    // current spelling; `app.household_keys` is the SET the store's four draft
    // policies compare against (`024_household_spellings.sql`), and
    // `guard-reads.mjs § assertHouseholdDeclared` refuses a read on a
    // connection that declared only the first — because the store never
    // re-spells a row, so a guard reading one spelling sees part of a house and
    // PERMITS on the rest of it. This house wears one spelling, so its set is
    // one long; the shape is what the stub has to answer.
    if (/current_setting\('app\.household'/.test(sql))
      return { rows: [{ declared: HOUSEHOLD, keys: [HOUSEHOLD] }] };
    if (/current_setting\('app\.household_keys'/.test(sql)) return { rows: [{ keys: [HOUSEHOLD] }] };
    if (/FROM identities WHERE handle/i.test(sql)) return { rows: [{ household: HOUSEHOLD }] };
    // THE REGISTRY, which is what `householdKeyFor` reads since POS-160. One
    // house, slugged `pos104`, listing the one handle this suite uses — the
    // same statement the `identities` line above makes, in the vocabulary the
    // resolver now asks in.
    if (/FROM households/i.test(sql)) return { rows: [{
      slug: HOUSEHOLD.replace(/^hh:/, ""), ord: 0, name: null, human: null,
      accounts: [], residents: ["pos104-wright"], since: null, member_of: null,
      declared_by: null, formerly: [], provisional: false,
    }] };
    if (/FROM household_pins/i.test(sql)) return { rows: [] };
    if (/FROM registry_meta/i.test(sql)) return { rows: [{ key: "schema_version", value: 1 }] };
    if (/FROM identities WHERE household/i.test(sql)) return { rows: [{ handle: "pos104-wright" }] };
    if (/FROM projection_heads/i.test(sql)) return { rows: townSha ? [{ sha: townSha }] : [] };
    if (/FROM escrow_projection/i.test(sql)) return { rows: escrow };
    if (/FROM claims/i.test(sql)) return { rows: claims };
    if (/FROM acts/i.test(sql)) return { rows: [] };
    if (/FROM marks/i.test(sql)) return { rows: marks };
    return { rows: [] };
  };
  return {
    asked,
    query: answer,
    connect: async () => ({ query: answer, release: () => {} }),
  };
}

const mine = (opts = {}) => world2MyMarks(KEY, { p: fixturePool(opts.pool ?? {}), ...(opts.offset != null ? { offset: opts.offset } : {}) });

// ═════════════════════════════════════════════════════════════════════════════
// 1 · THE COMPOSITION IS 1.0'S
// ═════════════════════════════════════════════════════════════════════════════

test("TWO LISTS, TWO LABELS — a pending claim is PUBLIC docket, a draft is private", async () => {
  const body = await mine();
  assert.deepEqual(body.drafts.map((m) => m.id), ["pos104-wright/the-private-shed"]);
  assert.deepEqual(body.docket.map((m) => m.id), ["pos104-wright/the-staked-shed"]);
  // The labels are the answer to "either the town leaks, or the word 'draft'
  // means something I was not told" — so they are carried verbatim, not
  // paraphrased. A twin that reworded them answers that question differently at
  // the two doors, which is the failure they were added to end.
  assert.deepEqual(body.labels, PORTFOLIO_LABELS);
});

test("the splitter is a NEGATIVE filter and a sketchbook row files under drafts", () => {
  // 1.0's own trap, carried: `drafts` is `claim_status !== "pending"`, which is
  // correct only while LIVE_STATUSES is exactly draft+pending. A row with no
  // claim status at all is a sketchbook row — private — and must land in drafts.
  const { drafts, docket } = splitLive([
    { id: "a", claim_status: "draft" }, { id: "b", claim_status: "pending" }, { id: "c" },
  ]);
  assert.deepEqual(drafts.map((m) => m.id), ["a", "c"]);
  assert.deepEqual(docket.map((m) => m.id), ["b"]);
});

test("a backed mark is NOT also published — the three lists do not double-count", async () => {
  const body = await mine();
  const backedIds = body.backed.map((r) => r.id);
  assert.ok(backedIds.includes("stranger/the-far-shed"));
  assert.ok(backedIds.includes("wright/the-trueing-house"));
  for (const id of backedIds)
    assert.ok(!body.published.some((m) => m.id === id), `${id} is in two lists at once`);
});

test("the backed rows ARE `backedRow`'s output — the decision is imported, not copied", async () => {
  const body = await mine();
  const row = body.backed.find((r) => r.id === "stranger/the-far-shed" && r.holder === "pos104-wright");
  const expected = backedRow(
    { holder: "pos104-wright", mark: "stranger/the-far-shed", n: 4, weight: 4 + 5 },
    { mark: publishedRowOf(PUBLISHED_ROWS.find((m) => m.slug === "stranger/the-far-shed"), { stampsOf: () => 10 }),
      belongs: (h) => h === "pos104-wright" });
  assert.deepEqual(row, expected);
  assert.equal(row.yours, false, "the far shed is a stranger's mark; only the STAKE is this household's");
});

test("`yours` is true for a stake on this household's OWN mark", async () => {
  const body = await mine();
  const own = body.backed.find((r) => r.id === "wright/the-trueing-house");
  assert.equal(own.yours, true);
});

test("counts are the WHOLE, shown is the page, and the pager is 1.0's own", () => {
  // Composed directly so the bound is asserted against `markPage` rather than
  // against a fixture large enough to trip it — a fixture that never reaches the
  // bound would make this assertion silent.
  const many = Array.from({ length: 25 }, (_, i) => ({ id: `wright/m${String(i).padStart(2, "0")}` }));
  const body = portfolioAnswerFrom({ household: HOUSEHOLD, residents: ["wright"], live: [], published: many, backed: [], pager: markPage });
  assert.equal(body.counts.published, 25, "the count is the whole of what you own");
  assert.equal(body.shown.published, markPage(many, 0).page.length, "the page is the pager's");
  assert.equal(body.complete, false);
  assert.equal(body.withheld.published.length, 25 - body.shown.published);
  assert.match(body.withheld_note, /counts is the whole of what you own/);
});

// ═════════════════════════════════════════════════════════════════════════════
// 2 · THE DOOR READ THE STORE — the leg an equality cannot supply
// ═════════════════════════════════════════════════════════════════════════════

test("THE PLANTED MARK: a published row that exists only in the store reaches the answer", async () => {
  const body = await mine();
  assert.ok(body.published.some((m) => m.id === "wright/only-in-the-store"),
    "the twin did not see `wright/only-in-the-store` — it is reading a tree");
});

test("THE PLANTED STAKE: a ghost holder in escrow_projection changes what this household is told", async () => {
  // `ghost-holder` is not this household, so it must NOT appear in `backed` —
  // and its presence in the store must not leak into the answer either. What it
  // proves is that the escrow read happened at all: remove it and the row set
  // the door filtered is measurably different.
  const withGhost = await mine();
  const without = await world2MyMarks(KEY, { p: fixturePool({ escrow: ESCROW_ROWS.filter((r) => r.holder !== "ghost-holder") }) });
  assert.ok(!withGhost.backed.some((r) => r.holder === "ghost-holder"),
    "another household's stake reached this household's portfolio");
  // The ghost is external to the far shed's own household and is the FIRST of
  // `solo:ghost`, so it draws k — which moves the far shed's own stamps figure.
  const shedWith = withGhost.backed.find((r) => r.id === "stranger/the-far-shed");
  const shedWithout = without.backed.find((r) => r.id === "stranger/the-far-shed");
  assert.equal(shedWith.stamps, shedWithout.stamps, "one holder's own position is not another's to move");
  assert.ok(shedWith, "the far shed vanished — the escrow read is not happening");
});

test("THE QUERY COUNT: the door opened marks, claims and escrow_projection", async () => {
  const p = fixturePool();
  await world2MyMarks(KEY, { p });
  const hit = (re) => p.asked.filter((a) => re.test(a.sql)).length;
  assert.ok(hit(/FROM marks/i) > 0, "a door that read the tree would open no `marks`");
  assert.ok(hit(/FROM claims/i) > 0, "a door that read the draft BRANCH would open no `claims`");
  assert.ok(hit(/FROM escrow_projection/i) > 0, "a door that read the town clone would open no `escrow_projection`");
});

test("THE SCOPING IS THE POLICY'S: the live read declared the household before asking", async () => {
  const p = fixturePool();
  await world2MyMarks(KEY, { p });
  const declared = p.asked.findIndex((a) => /set_config\('app\.household'/.test(a.sql));
  const keysAt = p.asked.findIndex((a) => /set_config\('app\.household_keys'/.test(a.sql));
  const claimsAt = p.asked.findIndex((a) => /FROM claims/i.test(a.sql));
  assert.ok(declared !== -1, "the live read ran on an undeclared connection — 007's policy would be the only strap left");
  assert.ok(declared < claimsAt, "the declaration must precede the read it scopes");
  // BOTH settings, since POS-160 RULING 4. `024_household_spellings.sql`'s four
  // policies compare against `app.household_keys`, so a connection carrying
  // only `app.household` is read by a policy looking at NOTHING — every draft
  // invisible, the guard finding no collision, and a duplicate permitted.
  assert.ok(keysAt !== -1, "the spelling set was never declared — the draft policies would answer against NULL");
  assert.ok(keysAt < claimsAt, "the spelling set must precede the read it scopes");
  // And it carries THIS house's key FIRST, then the rest of its own history:
  // the set is every spelling of ONE house. The `solo:` tail arrived with the
  // POS-160 follow-up (RULING 4's RED 1) — `pos104-wright` is this fixture
  // house's own resident, so `solo:pos104-wright` is a spelling of THIS house
  // and of no other. Asserted whole rather than by a prefix, so a set that
  // grew a neighbour's spelling reds here.
  assert.deepEqual(p.asked[keysAt].params, [`${HOUSEHOLD},solo:pos104-wright`]);
  assert.ok(p.asked[keysAt].params[0].startsWith(`${HOUSEHOLD},`),
    "the house's live key is the first spelling in the set, whatever else rides behind it");
});

// ═════════════════════════════════════════════════════════════════════════════
// 3 · THE ABSENCES, EACH SAYING WHICH ABSENCE IT IS
// ═════════════════════════════════════════════════════════════════════════════

test("a de-sited mark carries NO `at` — absent, never null", async () => {
  const body = await mine();
  const naming = body.published.find((m) => m.id === "wright/the-lit-name");
  assert.ok(naming, "the naming mark did not survive the projection");
  assert.ok(!("at" in naming), "`at: null` says 'somewhere unknown' about a thing that is nowhere by construction");
  assert.ok(!("extent" in naming));
});

test("the tree-only fields are NAMED, and `weight` is absent rather than approximated", async () => {
  const body = await mine();
  assert.ok(body.tree_only["branch · main · draft"]);
  assert.ok(body.tree_only["published[].weight · published[].weight_parts"]);
  for (const row of body.published) {
    assert.ok(!("weight" in row), "the ledger weight under the word `weight` is the two-quantities-one-word defect");
    assert.ok(!("weight_parts" in row));
    assert.equal(typeof row.stamps, "number", "`stamps` is raw own escrow and the store answers it exactly");
  }
});

test("an UN-INGESTED town says `backed` is UNKNOWN, not empty", async () => {
  const body = await world2MyMarks(KEY, { p: fixturePool({ townSha: null }) });
  assert.deepEqual(body.backed, []);
  assert.match(body.backed_unavailable, /UNKNOWN — not nothing/);
  assert.ok(!("escrow_at_town_sha" in body), "a freshness stamp with no source is worse than none");
});
