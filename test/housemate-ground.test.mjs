// housemate-ground.test.mjs — building on a housemate's parcel is building on your own ground.
//
// The Starling House (2026-09-30). kinofire previewed a home inside
// wayward-archivist/the-starling-house, the parcel of kinofire's own house
// (House of Many Doors), and was told the commons law: "it judges commons-class
// at the crossing … 1✦ is enough". The verdict itself was right (put_forward:
// true); three readers answered "which house" by comparing spellings instead
// of houses:
//
//   1. households.mjs § householdOf grouped residents by the town ledger's RAW
//      key. kinofire wears `hh:house-of-many-doors`, the three PR-joined
//      residents `gh:334016343`, so Lyra's residents left kinofire out and the
//      publish note fired (world.mjs § publishNoteFor). sameHousehold (give and
//      take between housemates) compared the same keys.
//   2. world-apex.mjs § worldHouseholdOf parsed the world's registry once per
//      process, so a settlement's re-derive waited for a restart.
//   3. standing.mjs § groundVerdict compared the parcel's STORED household with
//      the candidate's live key: 95 parcels on prod are stored under an older
//      spelling, and ✦0 marks inside them were refused escrow-absent
//      (errant/inside-glazed-ear, window 216; nfh/the-workshop, 203/204).

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "postmark-housemate-ground-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });

const ACCOUNT = { login: "commander-and-chief", id: 334016343 };
const HOUSE = "house-of-many-doors";
const LYRA = "wayward-archivist", KINO = "kinofire";

// ── the town: the ledger as live town main had it at 43ddb20 ────────────────
const town = join(scratch, "town");
mkdirSync(join(town, "tools"), { recursive: true });
const LEDGER = { [KINO]: `hh:${HOUSE}`, [LYRA]: "gh:334016343", seasiren: "gh:334016343", wildcat: "gh:334016343", stranger: "solo:stranger" };
writeFileSync(join(town, "tools", "stamp-mint.mjs"),
  `export function currentHouseholds() { return new Map(${JSON.stringify(Object.entries(LEDGER).map(([h, key]) => [h, { key, provisional: false }]))}); }\n`);
writeFileSync(join(town, "tools", "github-ids.json"), JSON.stringify(Object.fromEntries(
  [KINO, LYRA, "seasiren", "wildcat"].map((h) => [h, { ...ACCOUNT, pinned: "2026-09-26" }]))));
writeFileSync(join(town, "tools", "households.json"), JSON.stringify({ schema_version: 1, households: {
  [HOUSE]: { name: HOUSE, accounts: [ACCOUNT], residents: [KINO, "seasiren", LYRA, "wildcat"] } } }));

// ── the world, as far as the registry reader looks: HEAD, its ref, and the
// working tree's registry. A settlement's pull is the checkout moving.
const world = join(scratch, "world");
mkdirSync(join(world, ".git", "refs", "heads"), { recursive: true });
mkdirSync(join(world, "WORLD"), { recursive: true });
writeFileSync(join(world, ".git", "HEAD"), "ref: refs/heads/main\n");
function checkout(sha, households) {
  writeFileSync(join(world, ".git", "refs", "heads", "main"), `${sha.padEnd(40, "0")}\n`);
  writeFileSync(join(world, "WORLD", "households.json"), JSON.stringify({ households }, null, 2));
}
const SPLIT = { [KINO]: `hh:${HOUSE}`, [LYRA]: "gh:334016343", seasiren: "gh:334016343", wildcat: "gh:334016343" };
const JOINED = { [KINO]: `hh:${HOUSE}`, [LYRA]: `hh:${HOUSE}`, seasiren: `hh:${HOUSE}`, wildcat: `hh:${HOUSE}` };
checkout("a90dd0127", SPLIT); // the 06:00Z settlement, as the office booted with it

process.env.TOWN_CLONE = town;
process.env.WORLD_CLONE = world;
const { householdOf } = await import(pathToFileURL(join(OFFICE, "src", "households.mjs")).href);
const { sameHousehold } = await import(pathToFileURL(join(OFFICE, "src", "world-hold.mjs")).href);
const { publishNoteFor } = await import(pathToFileURL(join(OFFICE, "src", "world.mjs")).href);
const { worldHouseholdOf } = await import(pathToFileURL(join(OFFICE, "src", "world-apex.mjs")).href);
const { computeStanding } = await import(pathToFileURL(join(OFFICE, "world2", "tools", "standing.mjs")).href);
const { liveHouseOfVia, recomputeStanding } = await import(pathToFileURL(join(OFFICE, "world2", "tools", "materialize.mjs")).href);
const { reCheckGrant } = await import(pathToFileURL(join(OFFICE, "world2", "tools", "review-rule.mjs")).href);

const PARCEL = { id: `${LYRA}/the-starling-house`, kind: "parcel", by: LYRA, household: LYRA,
  at: { x: 900, y: 1250 }, extent: { w: 25, h: 25 } };

test("householdOf groups housemates by the HOUSE, whichever ledger key each wears", () => {
  const lyra = householdOf(LYRA), kino = householdOf(KINO);
  assert.deepEqual(lyra.residents, [KINO, "seasiren", LYRA, "wildcat"].sort());
  assert.deepEqual(kino.residents, lyra.residents);
  assert.equal(lyra.house, `hh:${HOUSE}`);
  assert.equal(lyra.key, "gh:334016343", "`key` is still the ledger's own spelling");
  assert.deepEqual(householdOf("stranger").residents, ["stranger"], "a handle no house lists is its own household");
});

test("the publish note stays silent for a home on a housemate's parcel (the sentence kinofire got)", () => {
  const note = publishNoteFor({ id: `${KINO}/kinos-house`, parent: PARCEL.id, by: KINO, kind: "sited",
    marks: [PARCEL], residentsOf: (h) => householdOf(h)?.residents ?? null });
  assert.equal(note, null, `expected no commons note, got: ${note?.heads_up?.slice(0, 90)}`);
  const stranger = publishNoteFor({ id: "stranger/a-shed", parent: PARCEL.id, by: "stranger", kind: "sited",
    marks: [PARCEL], residentsOf: (h) => householdOf(h)?.residents ?? null });
  assert.match(stranger.heads_up, /commons-class/, "another household's builder is still told the law");
});

test("sameHousehold: two housemates on two ledger keys are one household", () => {
  assert.deepEqual(sameHousehold(LYRA, KINO, householdOf), { same: true, how: "household", slug: HOUSE });
  assert.equal(sameHousehold(LYRA, "stranger", householdOf).same, false);
});

test("worldHouseholdOf re-reads when the clone's HEAD moves (no process-lifetime cache)", () => {
  assert.equal(worldHouseholdOf(LYRA), "gh:334016343");
  checkout("dc4518d30", JOINED); // the 18:00Z settlement, pulled
  assert.equal(worldHouseholdOf(LYRA), `hh:${HOUSE}`, "a settlement after boot reaches this reader without a restart");
  assert.equal(worldHouseholdOf(KINO), worldHouseholdOf(LYRA));
});

// ── the candle ───────────────────────────────────────────────────────────────
const REGISTRY = {
  households: [
    { slug: "the-misfiled-annex", ord: 0, name: "The Misfiled Annex", human: null, accounts: [{ id: 555, login: "annex-human" }],
      residents: ["errant"], since: "2026-09-01", member_of: null, declared_by: "t", formerly: null, provisional: null },
  ],
  pins: [], meta: [],
};
// errant/inside-glazed-ear as prod held it: the parcel stored `solo:errant`,
// the candidate arriving as the house's live key.
const parcelRow = (household) => ({ id: "p1", slug: "errant/the-misfiled-annex-parcel", kind: "parcel", owner: "errant", household,
  geometry: { at: { x: 1422, y: 5654 }, extent: { w: 25, h: 25 } }, parent: null, data: {} });
const earRow = { id: "c1", slug: "errant/inside-glazed-ear", kind: "sited", owner: "errant", household: "hh:the-misfiled-annex",
  geometry: { at: { x: 1424, y: 5652 }, extent: { w: 0.18, h: 0.11 } }, parent: null, data: { tier: "market" } };
function stubStore(rows) {
  const updates = [];
  const q = async (sql, args = []) => {
    if (/FROM households\b/.test(sql)) return { rows: REGISTRY.households };
    if (/FROM household_pins/.test(sql)) return { rows: REGISTRY.pins };
    if (/FROM registry_meta/.test(sql)) return { rows: REGISTRY.meta };
    if (/FROM marks WHERE status = 'standing'/.test(sql)) return { rows };
    if (/^\s*UPDATE marks/.test(sql)) { updates.push(args); return { rows: [], rowCount: 1 }; }
    if (/to_regclass\('public\.escrow_projection'\)/.test(sql)) return { rows: [{ ok: true }] };
    // the projection answers at this sha (someone else staked something), and nothing is behind the ear
    if (/FROM escrow_projection/.test(sql)) return { rows: [{ mark: "someone/else", n: 1 }] };
    return { rows: [] }; // the GiST probes: no index here, so the walk scans
  };
  return { q, updates };
}

test("the candle reads a house's old spelling as the house: a ✦0 mark in its own parcel is home", async () => {
  const { q } = stubStore([]);
  const houseOf = await liveHouseOfVia(q);
  assert.equal(houseOf("solo:errant"), "hh:the-misfiled-annex");
  assert.equal(houseOf("gh:555"), "hh:the-misfiled-annex");
  assert.equal(houseOf("solo:nobody"), "solo:nobody", "a spelling no house claims is itself");
  const tiers = computeStanding([parcelRow("solo:errant"), earRow], { only: new Set([earRow.slug]), houseOf });
  assert.equal(tiers.get(earRow.slug), "home");
});

test("recomputeStanding rules with the live house (the crossing's all-marks walk)", async () => {
  const { q, updates } = stubStore([parcelRow("solo:errant"), earRow]);
  const { moved } = await recomputeStanding(q);
  assert.deepEqual(moved.find((m) => m.slug === earRow.slug), { slug: earRow.slug, from: "market", to: "home" });
  assert.ok(updates.some(([id, tier]) => id === "c1" && tier === "home"));
});

test("the review door's escrow re-check rules with the live house too", async () => {
  const { q } = stubStore([parcelRow("solo:errant")]);
  const winner = { id: "c1", class: "sited", claimant: "errant", parent: null, data: {},
    geometry: { slug: earRow.slug, at: earRow.geometry.at, extent: earRow.geometry.extent } };
  const { blockers } = await reCheckGrant(q, winner, { townSha: "abcdef1234" });
  assert.deepEqual(blockers, [], "a ✦0 mark inside its own house's parcel is not a commons mark");
});
