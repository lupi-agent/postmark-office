// housemate-ground.test.mjs — building on a housemate's parcel is building on your own ground.
//
// The Starling House (2026-09-30). kinofire previewed a home inside
// wayward-archivist/the-starling-house, the parcel of kinofire's own house
// (House of Many Doors), and was told the commons law: "it judges commons-class
// at the crossing … 1✦ is enough". Four readers answered "which house" by
// comparing spellings instead of houses:
//
//   1. households.mjs § householdOf grouped residents by the town ledger's RAW
//      key. kinofire wears `hh:house-of-many-doors`, the three PR-joined
//      residents `gh:334016343`, so Lyra's residents left kinofire out and the
//      publish note fired (world.mjs § publishNoteFor). sameHousehold (give and
//      take between housemates) compared the same keys.
//   2. world.mjs § groundMinimumStake read WORLD/households.json at `mainRef`,
//      the pen's local branch, which on the box only the 00:02/12:02Z pull
//      advances — twelve hours behind the settlement that joined the house.
//   3. world-apex.mjs § worldHouseholdOf parsed the file once per process.
//   4. standing.mjs § groundVerdict compared the parcel's STORED household with
//      the candidate's live key: 95 parcels on prod are stored under an older
//      spelling, and ✦0 marks inside them were refused escrow-absent
//      (errant/inside-glazed-ear, window 216; nfh/the-workshop, 203/204).

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_WORLD = process.env.WORLD_CLONE ?? join(OFFICE, "world-clone");
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

// ── the world: a clone whose LOCAL main lags origin/main, as on the box ─────
// local main = the 06:00Z registry (the house split); origin/main = the 18:00Z
// one (joined). No checkout: nothing reads a working tree any more.
const world = join(scratch, "world");
const git = (...args) => execFileSync("git", ["-C", world, ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", SOURCE_WORLD, world], { stdio: "ignore" });
const base = git("rev-parse", "HEAD");
function commitRegistry(parent, households, message) {
  const blob = execFileSync("git", ["-C", world, "hash-object", "-w", "--stdin"],
    { input: JSON.stringify({ households }, null, 2), encoding: "utf8" }).trim();
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, `index-${message}`),
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const g = (...a) => execFileSync("git", ["-C", world, ...a], { env, encoding: "utf8" }).trim();
  g("read-tree", parent);
  g("update-index", "--add", "--cacheinfo", `100644,${blob},WORLD/households.json`);
  return g("commit-tree", g("write-tree"), "-p", parent, "-m", message);
}
const SPLIT = { [KINO]: `hh:${HOUSE}`, [LYRA]: "gh:334016343", seasiren: "gh:334016343", wildcat: "gh:334016343" };
const JOINED = { [KINO]: `hh:${HOUSE}`, [LYRA]: `hh:${HOUSE}`, seasiren: `hh:${HOUSE}`, wildcat: `hh:${HOUSE}` };
const atSix = commitRegistry(base, SPLIT, "six");
const atEighteen = commitRegistry(atSix, JOINED, "eighteen");
git("update-ref", "refs/heads/main", atSix);
git("update-ref", "refs/remotes/origin/main", atEighteen);

process.env.TOWN_CLONE = town;
process.env.WORLD_CLONE = world;
const { householdOf } = await import(pathToFileURL(join(OFFICE, "src", "households.mjs")).href);
const { sameHousehold } = await import(pathToFileURL(join(OFFICE, "src", "world-hold.mjs")).href);
const { publishNoteFor, markStandsOnOwnGround } = await import(pathToFileURL(join(OFFICE, "src", "world.mjs")).href);
const { worldHouseholdOf } = await import(pathToFileURL(join(OFFICE, "src", "world-apex.mjs")).href);
const { computeStanding } = await import(pathToFileURL(join(OFFICE, "world2", "tools", "standing.mjs")).href);
const { liveHouseOfVia, recomputeStanding } = await import(pathToFileURL(join(OFFICE, "world2", "tools", "materialize.mjs")).href);

const PARCEL = { id: `${LYRA}/the-starling-house`, kind: "parcel", by: LYRA, household: LYRA,
  at: { x: 900, y: 1250 }, extent: { w: 25, h: 25 } };
const KINOS_HOUSE = { kind: "sited", by: KINO, slug: "kinos-house", at: { x: 894, y: 1245 }, extent: { w: 11, h: 12 } };

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

test("groundMinimumStake reads the registry at PUBLISHED main, not the lagging local branch", async () => {
  const board = { marks: [PARCEL], byId: new Map([[PARCEL.id, PARCEL]]), ids: new Set([PARCEL.id]) };
  assert.equal(await markStandsOnOwnGround(KINOS_HOUSE, board), true,
    "origin/main (18:00Z) joined the house; local main (06:00Z) had it split");
  assert.equal(await markStandsOnOwnGround({ ...KINOS_HOUSE, by: "stranger" }, board), false);
});

test("worldHouseholdOf follows published main, and re-reads when it moves (no process-lifetime cache)", () => {
  assert.equal(worldHouseholdOf(LYRA), `hh:${HOUSE}`, "published main, not the lagging local branch");
  const later = commitRegistry(atEighteen, { ...JOINED, newcomer: `hh:${HOUSE}` }, "later");
  git("update-ref", "refs/remotes/origin/main", later);
  assert.equal(worldHouseholdOf("newcomer"), `hh:${HOUSE}`, "a settlement after boot reaches this reader");
  git("update-ref", "refs/remotes/origin/main", atEighteen);
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
