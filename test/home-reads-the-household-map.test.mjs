// home-reads-the-household-map.test.mjs — A PARCEL-LESS HOUSEMATE IS AT HOME ON
// THE HOUSEHOLD'S PARCEL, AT THE OFFICE'S DOOR (POS-368; town #3450, 2026-10-05).
//
// The law (Darko, 2026-10-04): a resident with no parcel of their own is at home
// on their household's parcel. The engine's homeOf finds that parcel through
// `world.households`. The office builds its world with the engine's
// assembleWorld from the published world-state.json, and that assembly picks
// fields: the household map the fold published in the same file was dropped,
// so Gabo of La Casa Rodante (no parcel; Migue holds the household's) read "no
// home" at every door.
//
// The fixture's assembly picks fields the way the blessed engine does (marks,
// parcels, terrain; no households), and its where-is reads the registry first,
// as the engine's does. So this holds the OFFICE to attaching the published map,
// whatever the engine's assembly carries.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const repo = mkdtempSync(join(tmpdir(), "postmark-household-map-"));
after(() => rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

put("tools/world-build.mjs", `
export function assembleWorld({ worldState, skeleton }) {
  return { marks: worldState.marks ?? [], parcels: worldState.parcels ?? [], terrain: skeleton };
}
`);
put("tools/world-verbs.mjs", `
export function orient() { return { seen: [] }; }
export function openYourEyes() { return { fov: { carried: [], far: [], counts: {} }, radial: { byBearing: {}, counts: {} }, tell: () => "" }; }
export function investigate() { return null; }
`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function householdOf(handle, world) {
  const declared = world?.households?.[handle];
  if (declared) return declared;
  const own = (world?.marks ?? []).find((m) => m.by === handle && m.household);
  return own?.household ?? handle;
}
export function parcelsFor(handle, world) {
  const key = householdOf(handle, world);
  const parcels = world?.parcels ?? [];
  return [...parcels.filter((p) => p.household === handle),
    ...parcels.filter((p) => p.household !== handle && householdOf(p.household, world) === key)];
}
export function homeOf(handle, world) {
  const parcel = parcelsFor(handle, world)[0];
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel,
    parcel_id: parcel.id, via: parcel.household === handle ? "own" : "household" };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
`);
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({
  tick: 0,
  dials: {},
  marks: [],
  parcels: [
    { id: "migue-flint/la-casa-rodante", household: "migue-flint", at: { x: -450, y: 5480 }, extent: { w: 25, h: 25 } },
  ],
  households: { gabo: "hh:la-casa-rodante", "migue-flint": "hh:la-casa-rodante" },
  household_key_grain: "declared-slug",
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main");

process.env.WORLD_CLONE = repo;
const { worldBlockForHandle } = await import("../src/world.mjs");

test("FALSIFIER — Gabo, with no parcel of his own, is at home on La Casa Rodante's parcel, via household", async () => {
  const home = await worldBlockForHandle("gabo");
  assert.equal(home.sited, true, "a housemate whose household holds ground is not left without a home");
  assert.equal(home.parcel_id, "migue-flint/la-casa-rodante");
  assert.equal(home.via, "household");
  assert.deepEqual([home.x, home.y], [-450, 5480]);
});

test("CONTROL — the holder is at home on their own parcel, and a stranger still has none", async () => {
  const migue = await worldBlockForHandle("migue-flint");
  assert.equal(migue.via, "own");
  assert.equal(migue.parcel_id, "migue-flint/la-casa-rodante");
  const stranger = await worldBlockForHandle("nobody-lives-here-xyz");
  assert.equal(stranger.sited, false, "the map groups housemates; it never hands ground to someone outside the household");
});
