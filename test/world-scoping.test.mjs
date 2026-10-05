// ruling 9 — same world call, two identities, two exposure-scoped answers.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const repo = mkdtempSync(join(tmpdir(), "postmark-world-scope-"));
after(() => rmSync(repo, { recursive: true, force: true }));
// the draft lanes lease worktrees out of a pool beside the clone (tier 1)
const pool = mkdtempSync(join(tmpdir(), "postmark-world-scope-pool-"));
process.env.WORLD_POOL_DIR = pool;
after(() => rmSync(pool, { recursive: true, force: true }));
const town = mkdtempSync(join(tmpdir(), "postmark-town-scope-"));
after(() => rmSync(town, { recursive: true, force: true }));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const putTown = (path, text) => {
  const full = join(town, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const mark = (by, body) => `---\nkind: sited\nby: ${by}\ntier: market\ndate: 2026-07-28\nat: { x: 0, y: 0 }\nextent: { w: 4, h: 4 }\n---\n\n${body}\n`;

put("WORLD/marks/let-there-be-light/mark.md", mark("the-town", "the public frame"));
put("WORLD/marks/let-there-be-light/town-square/mark.md", mark("the-town", "the public square"));
put("WORLD/marks/let-there-be-light/published-note/mark.md", mark("alpha", "house a published this"));
put("WORLD/marks/let-there-be-light/backed-note/mark.md", mark("alpha", "house a published and backed this"));
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: [
    { id: "the-town/let-there-be-light", by: "the-town", household: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 1000, h: 1000 }, body: "the public frame" },
    { id: "the-town/town-square", by: "the-town", household: "the-town", kind: "sited", tier: "constitution", at: { x: 10, y: 10 }, extent: { w: 20, h: 20 }, body: "the public square" },
    { id: "alpha/published-note", by: "alpha", household: "alpha", kind: "sited", tier: "market", at: { x: 20, y: 20 }, extent: { w: 4, h: 4 }, body: "house a published this" },
    { id: "alpha/backed-note", by: "alpha", household: "alpha", kind: "sited", tier: "market", at: { x: 30, y: 30 }, extent: { w: 4, h: 4 }, body: "house a published and backed this" },
  ], parcels: [], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}, null, 2));
put("seeding/manifest.json", JSON.stringify({ homes: [] }));
put("tools/world-build.mjs", `
export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }
`);
put("tools/world-verbs.mjs", `
export function orient(_state, world) { return { seen: world.marks.map((m) => m.id) }; }
export function openYourEyes(_state, world) {
  const carried = world.marks.filter((m) => m.at).map((m, i) => ({
    ...m, bearing: i % 2 ? "NE" : "N", distM: 10 + i, score: 99 - i,
    extentM: m.extent?.w, dim: 0.5, occluded: false,
  }));
  return {
    fov: { carried, far: [], counts: { visible: carried.length } },
    radial: { byBearing: { N: { nearby: carried } }, counts: { visible: carried.length } },
    tell: () => world.marks.map((m) => m.id).join(", "),
  };
}
export function investigate(id, world) { return world.marks.find((m) => m.id === id) ?? null; }
`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function householdOf(handle, world) {
  const own = (world?.marks ?? []).find((m) => m.by === handle && m.household);
  return own?.household ?? handle;
}
export function parcelFor(handle, world) {
  const hh = householdOf(handle, world);
  return (world?.parcels ?? []).find((p) => p.household === hh) ?? null;
}
export function homeOf(handle, world) {
  const parcel = parcelFor(handle, world);
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
`);
put("tools/mark-lint.mjs", "process.exit(0);\n");
put("tools/marks-fold.mjs", `
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
function parse(path) {
  const text = readFileSync(path, "utf8");
  const by = text.match(/^by:\\s*(.+)$/m)?.[1]?.trim();
  const kind = text.match(/^kind:\\s*(.+)$/m)?.[1]?.trim() ?? "sited";
  const tier = text.match(/^tier:\\s*(.+)$/m)?.[1]?.trim() ?? "market";
  return { by, household: by, kind, tier, body: text.split(/---\\r?\\n/).at(-1).trim() };
}
export function loadMarks(dir) {
  const out = [];
  function walk(at, parent = null) {
    if (!existsSync(at)) return;
    const entries = readdirSync(at);
    let here = parent;
    if (entries.includes("mark.md")) {
      const rec = parse(join(at, "mark.md"));
      rec.slug = basename(at); rec.id = rec.by + "/" + rec.slug; rec._dir = at; rec._parentMarkId = parent;
      out.push(rec); here = rec.id;
    }
    for (const entry of entries) {
      const next = join(at, entry);
      if (entry !== "mark.md" && statSync(next).isDirectory()) walk(next, here);
    }
  }
  walk(dir);
  return out;
}
export function placementParent() { return null; }
export function marksContain() { return false; }
if (process.argv[1]?.endsWith("marks-fold.mjs")) {
  // THE FOLD WITNESS. Every whole-world fold this fixture performs appends one
  // line here, so a test can assert that a read did NOT fold — the claim §1c
  // makes about the request path, stated as a file that stays empty.
  if (process.env.FOLD_WITNESS) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.FOLD_WITNESS, opt("--marks-dir", "?") + "\\n");
  }
  const marks = loadMarks(opt("--marks-dir", "WORLD/marks")).map((m) => ({
    id: m.id, by: m.by, household: m.household, kind: m.kind, tier: m.tier,
    body: m.body, sovereign: false, stamps: 0, weight: 0,
  }));
  console.log(JSON.stringify({ tick: 0, dials: {}, marks, parcels: [], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [] }));
}
`);
putTown("tools/world-stake.mjs", `
export function worldStakeState() {
  return { currentHouseholdOf: (handle) => handle === "alpha" ? "house-a" : handle === "beta" ? "house-b" : "solo:" + handle };
}
export function deriveWorldMarkWeights() {
  return { rows: [{ holder: "alpha", mark: "alpha/backed-note", n: 3, weight: 8 }] };
}
`);

git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main");
git("switch", "-q", "-c", "draft/house-a");
put("WORLD/marks/let-there-be-light/private-note/mark.md", mark("alpha", "only house a sees this"));
git("add", "WORLD/marks/let-there-be-light/private-note/mark.md");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "house a draft");
git("switch", "-q", "main");

process.env.WORLD_CLONE = repo;
process.env.TOWN_CLONE = town;
const {
  leaveMarkViaOffice,
  worldEyes,
  worldMyDrafts,
  worldMyMarks,
  worldNoteViaOffice,
  worldOrient,
  worldSkeletonRaw,
  worldStateRaw,
} = await import("../src/world.mjs");

const houseA = { household: "house-a", handles: new Set(["alpha"]) };
const houseB = { household: "house-b", handles: new Set(["beta"]) };

test("ruling 9 scopes reads by household and every write lands off main", async () => {
  // §1c: "the signed-in fold-on-read path (`stateForKey`'s draft arm) has no
  // remaining caller and can be DELETED". The read is canon for everyone; the
  // household's own work comes back through the delta, asserted just below.
  const owner = await worldStateRaw(houseA);
  const other = await worldStateRaw(houseB);
  const anonymous = await worldStateRaw(null);
  assert.equal(owner.marks.some((m) => m.id === "alpha/private-note"), false,
    "the author's own world read is published main — the draft reaches them as a delta, not a fold");
  assert.equal(other.marks.some((m) => m.id === "alpha/private-note"), false);
  assert.deepEqual(other, anonymous, "unresolved household and anonymous both read published main");
  assert.deepEqual(owner, anonymous, "and so does the author: one world, one payload, cacheable");

  const delta = await worldMyDrafts(houseA);
  assert.equal(delta.household, "house-a");
  assert.deepEqual(delta.counts, { added: 1, modified: 0, deleted: 0 });
  assert.equal(delta.marks[0].id, "alpha/private-note");
  assert.equal((await worldMyDrafts(null)).error, "bounce");

  const portfolio = await worldMyMarks(houseA);
  assert.equal(portfolio.household, "house-a");
  // `docket` joined the shape 2026-09-07 (lane-a / R3): a claim standing
  // PUBLICLY on the town's docket is not a private compose space, and it used
  // to arrive under the word `drafts`. This fixture's one live mark is a
  // sketchbook row with no claim status, so it stays private and the docket is
  // empty — which is the assertion, not an accident of the fixture.
  assert.deepEqual(portfolio.counts, { drafts: 1, docket: 0, published: 1, backed: 1 });
  assert.deepEqual(portfolio.drafts.map((mark) => mark.id), ["alpha/private-note"]);
  assert.deepEqual(portfolio.docket, [], "nothing here has been staked onto the public docket");
  assert.deepEqual(portfolio.published.map((mark) => mark.id), ["alpha/published-note"]);
  assert.deepEqual(portfolio.backed.map((position) => ({
    id: position.id,
    holder: position.holder,
    stamps: position.stamps,
    yours: position.yours,
  })), [{ id: "alpha/backed-note", holder: "alpha", stamps: 3, yours: true }]);
  const categoryIds = [
    ...portfolio.drafts.map((mark) => mark.id),
    ...portfolio.published.map((mark) => mark.id),
    ...portfolio.backed.map((position) => position.id),
  ];
  assert.equal(new Set(categoryIds).size, categoryIds.length, "portfolio categories are mutually exclusive");

  const result = await leaveMarkViaOffice(repo, {
    slug: "new-sketch",
    kind: "sited",
    at: { x: 20, y: 20 },
    extent: { w: 4, h: 4 },
    body: "a second household sketch",
  }, houseB);
  assert.equal(result.branch, "draft/house-b");
  // Tier 1: the write lands on the household's REF, and the shared clone is no
  // longer dragged onto that household's branch to do it — the pen's checkout is
  // a leased worktree now. The shared clone stays on main, which is what the read
  // path (seeding/manifest.json, the engine fallback) has always wanted from it.
  assert.equal(git("branch", "--show-current").trim(), "main");
  assert.equal(git("rev-parse", "draft/house-b").trim(), result.commit);
  assert.equal(git("ls-tree", "--name-only", "main", "--", "WORLD/marks/beta/new-sketch/mark.md").trim(), "");
  assert.match(git("show", "draft/house-b:WORLD/marks/beta/new-sketch/mark.md"), /a second household sketch/);
  assert.equal(git("diff-tree", "--no-commit-id", "--name-only", "-r", result.commit).trim(),
    "WORLD/marks/beta/new-sketch/mark.md",
    "draft write commits only the mark record, never main's derived canon files");
});

test("world_leave_mark defaults by on a solo key without changing its author contract", async () => {
  const result = await leaveMarkViaOffice(repo, {
    slug: "solo-default",
    kind: "sited",
    at: { x: 40, y: 40 },
    extent: { w: 4, h: 4 },
    body: "the solo key chose its only resident",
  }, houseA);
  assert.equal(result.id, "alpha/solo-default");
  assert.match(git("show", "draft/house-a:WORLD/marks/alpha/solo-default/mark.md"), /^by: alpha$/m);
});

test("world_open_your_eyes defaults to telling + compact objects and preserves diagnostics", async () => {
  const narrative = await worldEyes({ x: 100, y: 100 }, null);
  // `records` JOINED THIS LOCK ON 2026-09-10, and the lock is why the addition
  // had to be deliberate: this list is the door's shape, and a field that could
  // slip into it unnoticed is a field nobody decided to publish. The radial
  // names ids; this is those ids' records, plus the town's ground set (see
  // world.mjs § `records`). THIS FIXTURE'S WORLD HAS NO REGIONS, so the ground
  // is empty here — which is the arm worth having under the lock: the field is
  // exactly what the answer named, and a world with no floor still answers.
  assert.deepEqual(Object.keys(narrative), ["stance", "telling", "objects", "records"]);
  assert.equal(narrative.stance, "spectator", "a coords glance says what it is");
  assert.equal(typeof narrative.telling, "string");
  assert.ok(narrative.objects.length > 0);
  for (const object of narrative.objects) {
    assert.deepEqual(Object.keys(object), ["id", "at", "bearing", "distance_m", "kind", "tier"]);
    assert.deepEqual(Object.keys(object.at), ["x", "y"]);
  }
  assert.deepEqual(Object.keys(narrative.records).sort(), narrative.objects.map((o) => o.id).sort(),
    "in a world with no region rings, `records` is exactly the ids the answer named — no more, no fewer");
  for (const object of narrative.objects)
    assert.equal(narrative.records[object.id].id, object.id, `${object.id}'s record is its own`);

  const diagnostic = await worldEyes({ x: 100, y: 100, diagnostic: true }, null);
  // NO `records` HERE, and the lock is what keeps it that way. It rode this
  // branch for one commit while the resident page was going to boot on the
  // diagnostic shape; Keemin ruled the page boots on the compact read instead
  // (2026-09-10 22:4x), so the field went back where it came from. `diagnostic`
  // is a DIAGNOSTIC — nothing the town's pages run may depend on it, or it
  // stops being one, and this list is where that stays true.
  assert.deepEqual(Object.keys(diagnostic), ["standpoint", "crossing", "telling", "fov", "radial"]);
  assert.equal(diagnostic.telling, narrative.telling, "narrative mode does not rewrite the telling");
  assert.equal(diagnostic.fov.carried[0].score, 99, "the existing detailed FOV stays intact");
  assert.ok(diagnostic.radial.byBearing, "the existing radial organization stays intact");
});

// The note's home is the store (POS-392, note-store.mjs); its store behaviour is
// test/resident-notes.test.mjs, on a real Postgres. This office is pointed at no
// record, so the door refuses and writes nothing anywhere, git included, and an
// embodied orient reads a null note without claiming the record failed.
test("world_note on an office with no record refuses, writes nothing to git, and orient reads a null note", async () => {
  const refsBefore = git("for-each-ref", "--format=%(refname) %(objectname)");
  const statusBefore = git("status", "--porcelain");
  await assert.rejects(worldNoteViaOffice(repo, { body: "Remember the blue door." }, houseA),
    (e) => e.code === 503 && /not pointed at a record/.test(e.defect));
  assert.equal(git("for-each-ref", "--format=%(refname) %(objectname)"), refsBefore, "no ref moved: the note touched no branch");
  assert.equal(git("status", "--porcelain"), statusBefore, "and left no file in the clone");
  const embodied = await worldOrient({}, houseA);
  assert.equal(embodied.note, null);
  assert.equal("note_unavailable" in embodied, false, "no record is not a failed record");
  assert.equal(embodied.standpoint.stance, "embodied");
  assert.equal((await worldOrient({ x: 0, y: 0 }, houseA)).note, null,
    "a spectator glance reads nobody's note — even your own (the 2026-07-31 unbundle)");
  assert.equal((await worldOrient({ x: 0, y: 0 }, houseA)).standpoint.stance, "spectator");
});

test("the draft delta carries WORLD-framed geometry — the overlay's whole contract (2026-08-22)", async () => {
  // Root-level draft: file numbers ARE world numbers, verbatim.
  const rootDraft = (await worldMyDrafts(houseA)).marks.find((m) => m.id === "alpha/private-note");
  assert.deepEqual(rootDraft.at, { x: 0, y: 0 }, "a root-level record ships its at verbatim");
  assert.deepEqual(rootDraft.extent, { w: 4, h: 4 });

  // Nested draft: file numbers are offsets from the parent's centre (SCHEMA v3);
  // the delta borrows the parent's composed world at from published main's own
  // world-state and ships WORLD numbers — never the raw offset.
  git("switch", "-q", "--ignore-other-worktrees", "draft/house-a");
  put("WORLD/marks/let-there-be-light/town-square/nested-draft/mark.md",
    "---\nkind: sited\nby: alpha\ndate: 2026-08-22\nat: { x: 3, y: 4 }\nextent: { w: 2, h: 2 }\n---\n\na nested rehearsal\n");
  git("add", "WORLD/marks/let-there-be-light/town-square/nested-draft/mark.md");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "nested draft");
  git("switch", "-q", "--ignore-other-worktrees", "main");

  const nested = (await worldMyDrafts(houseA)).marks.find((m) => m.id === "alpha/nested-draft");
  assert.ok(nested, "the nested draft is in the delta");
  assert.deepEqual(nested.at, { x: 13, y: 14 },
    "town-square's composed world centre (10,10) + the file's offset (3,4) — world frame, not file frame");
});

// ── §1c · THE TOURNIQUET IS THE ARCHITECTURE (2026-08-22) ────────────────────
//
// Three falsifiers for one ruling. The law they assert, verbatim from the world
// runtime ladder, §0's certainty ruling:
//
//   "Demanding derived properties for a live draft is whole-world computation
//    re-entering through the display."
//
// and §1c's consequence:
//
//   "the signed-in fold-on-read path (`stateForKey`'s draft arm) has no
//    remaining caller and can be DELETED — the tourniquet (`WORLD_DRAFT_FOLD=0`)
//    stops being a tourniquet and becomes the architecture."

test("§1c (a) — the author still sees their own draft, by DELTA, with no env switch in play", async () => {
  const { markExists } = await import("../src/world-stake.mjs");
  assert.equal(process.env.WORLD_DRAFT_FOLD, undefined,
    "no tourniquet is set: what follows is the architecture, not a switch position");

  // the stake gate — the door that bounced 404 on the morning of the party
  assert.equal((await markExists("alpha/published-note", houseA)).exists, true, "published marks unchanged");
  assert.equal((await markExists("alpha/private-note", houseA)).exists, true,
    "your own draft counts — the delta is the second look, no fold");
  assert.equal((await markExists("alpha/private-note", houseB)).exists, false,
    "another household's draft stays unstakeable: you cannot back what you cannot see");
  assert.equal((await markExists("alpha/private-note", null)).exists, false, "and no key sees no sketchbook");

  // the delta doors themselves — the author's whole sketchbook, declarations only
  const ids = (await worldMyDrafts(houseA)).marks.map((m) => m.id);
  for (const id of ["alpha/private-note", "alpha/nested-draft"])
    assert.ok(ids.includes(id), `world_my_drafts hands the author ${id}`);
  const mine = await worldMyMarks(houseA);
  assert.ok(mine.drafts.some((m) => m.id === "alpha/private-note"),
    "and world_my_marks files them under drafts, beside published and backed");
});

test("§1c (b) — anonymous and other households read published main; no draft leaks at the read", async () => {
  const anonymous = await worldStateRaw(null);
  const other = await worldStateRaw(houseB);
  const author = await worldStateRaw(houseA);
  const PUBLISHED = new Set([
    "the-town/let-there-be-light", "the-town/town-square", "alpha/published-note", "alpha/backed-note",
  ]);
  for (const [who, state] of [["anonymous", anonymous], ["another household", other], ["the author", author]])
    assert.deepEqual(state.marks.filter((m) => !PUBLISHED.has(m.id)), [],
      `${who} reads canon: nothing but published main's own marks appears in the world payload`);
  assert.deepEqual(author, anonymous, "one world, byte for byte, whoever asks");
  assert.equal((await worldMyDrafts(houseB)).marks.some((m) => m.by === "alpha"), false,
    "and the delta door is scoped to its own household — the leak has no second route");
});

test("§1c (c) — NO read folds a draft branch: the fold arm is gone and the witness stays empty", async () => {
  const branches = await import("../src/world-branches.mjs");
  // The arm cannot be called because it does not exist, and the read tier's
  // state function takes no key — there is no identity to select a world with.
  assert.equal(branches.stateForKey, undefined, "stateForKey's draft arm is deleted, not disabled");
  assert.equal(branches.skeletonForKey, undefined, "and so is the skeleton's");
  assert.equal(branches.publishedState.length, 1, "publishedState(repo) — no key parameter to pass a household in");
  assert.equal(branches.publishedSkeleton.length, 1, "publishedSkeleton(repo) — likewise");
  // The switch is gone rather than set: no module in the office reads it, so
  // there is no environment in which the old arm comes back.
  const src = new URL("../src/", import.meta.url);
  const readers = readdirSync(src)
    .filter((f) => f.endsWith(".mjs"))
    .filter((f) => /process\.env\.WORLD_DRAFT_FOLD|draftFoldEnabled/.test(readFileSync(new URL(f, src), "utf8")));
  assert.deepEqual(readers, [], "no office module reads WORLD_DRAFT_FOLD — both halves collapsed into the one path");

  // And behaviourally: a signed-in author drives every read door in this file,
  // and the fixture's own marks-fold — the only thing that can perform a
  // whole-world fold — is never spawned.
  const witness = join(repo, "..", `fold-witness-${process.pid}.log`);
  rmSync(witness, { force: true });
  process.env.FOLD_WITNESS = witness;
  try {
    await worldStateRaw(houseA);
    await worldSkeletonRaw(houseA);
    await worldOrient({}, houseA);
    await worldEyes({ x: 0, y: 0 }, houseA);
    await worldMyDrafts(houseA);
    await worldMyMarks(houseA);
    const { markExists } = await import("../src/world-stake.mjs");
    await markExists("alpha/private-note", houseA);
  } finally {
    delete process.env.FOLD_WITNESS;
  }
  assert.equal(existsSync(witness), false,
    "not one fold ran on the request path — 'whole-world computation re-entering through the display' has no entrance left");
  rmSync(witness, { force: true });
});
