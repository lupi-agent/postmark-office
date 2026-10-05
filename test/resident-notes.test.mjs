// resident-notes.test.mjs — THE NOTE'S ONE HOME IS THE STORE (POS-392).
//
//   node --test test/resident-notes.test.mjs
//
// world_note is "one note to your returning self, replaced on every write,
// household-private". Its home is `resident_notes` (063_resident_notes.sql)
// behind a household row policy, read and written by src/note-store.mjs. The
// door writes no file, no commit and no branch in any repository, local or
// pushed, and the embodied orient reads the store and nothing else.
//
// THE RIG. A real Postgres with the whole schema (test/helpers/embedded-store.mjs);
// the office dials it as `office_api`, so 063's row policy is live. A fixture
// world clone with a bare origin and TOWN_PUSH=1, so a push, if anything made
// one, would land somewhere this file can look.
//
// THE FLIP (the PR body quotes the red line): run this file against
// origin/main's src/ (before the fix the door committed the note to the
// household's draft branch and pushed it); the first test goes red naming the
// ref that carries the note.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { startStore } from "./helpers/embedded-store.mjs";

const store = await startStore({ db: "resident_notes_test" });
after(() => store.stop?.());
const skip = store.skip ?? false;

const scratch = mkdtempSync(join(tmpdir(), "postmark-resident-notes-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const repo = join(scratch, "world");
const origin = join(scratch, "origin.git");
const town = join(scratch, "town");
for (const d of [repo, town]) mkdirSync(d, { recursive: true });

const gitIn = (dir) => (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const git = gitIn(repo);
const gitOrigin = gitIn(origin);
const put = (root, path, text) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// The smallest world an embodied orient stands in (world-scoping.test.mjs's shape).
put(repo, "WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put(repo, "WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: [
    { id: "the-town/let-there-be-light", by: "the-town", household: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 1000, h: 1000 }, body: "the public frame" },
  ], parcels: [], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}, null, 2));
put(repo, "seeding/manifest.json", JSON.stringify({ homes: [] }));
put(repo, "tools/world-build.mjs", "export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n");
put(repo, "tools/world-verbs.mjs", `
export function orient(_state, world) { return { seen: world.marks.map((m) => m.id) }; }
export function openYourEyes() { return { fov: { carried: [], far: [], counts: { visible: 0 } }, radial: { byBearing: {}, counts: { visible: 0 } }, tell: () => "" }; }
export function investigate(id, world) { return world.marks.find((m) => m.id === id) ?? null; }
`);
put(repo, "tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function householdOf(handle) { return handle; }
export function parcelFor() { return null; }
export function homeOf() { return { ...NOWHERE }; }
export function whereIs() { return { ...NOWHERE }; }
`);
put(repo, "tools/mark-lint.mjs", "process.exit(0);\n");
put(repo, "tools/marks-fold.mjs", `
export function loadMarks() { return []; }
export function placementParent() { return null; }
export function marksContain() { return false; }
`);
put(town, "tools/world-stake.mjs", `
export function worldStakeState() { return { currentHouseholdOf: (handle) => "solo:" + handle }; }
export function deriveWorldMarkWeights() { return { rows: [] }; }
`);

git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main");
execFileSync("git", ["init", "-q", "--bare", origin]);
git("remote", "add", "origin", origin);
git("push", "-q", "origin", "main");

// Two houses in the store's registry: the hearth holds alpha and aleph, yonder holds beta.
async function seed() {
  const c = await store.connect("world2_owner");
  try {
    await c.query("TRUNCATE households, household_pins CASCADE");
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by)
       VALUES ('hearth', 0, 'The Hearth', ARRAY['alpha','aleph'], '2026-08-01', 'alpha'),
              ('yonder', 1, 'Yonder', ARRAY['beta'], '2026-08-01', 'beta')`);
    await c.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned)
       VALUES ('alpha', 'alpha', 301, '2026-08-01'), ('aleph', 'aleph', 302, '2026-08-01'), ('beta', 'beta', 303, '2026-08-01')`);
  } finally { await c.end(); }
}
const asOwner = async (sql, params = []) => {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
};

let worldNoteViaOffice, worldOrient;
if (!skip) {
  await seed();
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = store.url("office_api");
  process.env.WORLD_CLONE = repo;
  process.env.TOWN_CLONE = town;
  process.env.WORLD_POOL_DIR = join(scratch, "pool");
  process.env.TOWN_PUSH = "1";
  ({ worldNoteViaOffice, worldOrient } = await import("../src/world.mjs"));
}

const hearth = { household: "house-a", handles: new Set(["alpha", "aleph"]) };
const yonder = { household: "house-b", handles: new Set(["beta"]) };

/** Every ref in a repository that carries a NOTES/ path, as "ref: paths". */
function refsCarryingNotes(run) {
  const refs = run("for-each-ref", "--format=%(refname)").split("\n").filter(Boolean);
  return refs.flatMap((ref) => {
    const paths = run("ls-tree", "-r", "--name-only", ref, "--", "NOTES").split("\n").filter(Boolean);
    return paths.length ? [`${ref}: ${paths.join(", ")}`] : [];
  });
}

test("a note is kept in the store and nowhere in git: no ref carries it, no file holds it, nothing was pushed", { skip }, async () => {
  await worldNoteViaOffice(repo, { handle: "alpha", body: "Remember the blue door." }, hearth);
  await worldNoteViaOffice(repo, { handle: "aleph", body: "The kettle is on the left." }, hearth);

  assert.deepEqual(refsCarryingNotes(git), [], "no ref in the world clone carries a note");
  assert.deepEqual(refsCarryingNotes(gitOrigin), [], "no ref on the origin carries a note");
  assert.equal(gitOrigin("for-each-ref", "--format=%(refname)", "refs/heads/draft").trim(), "",
    "the note pushed no household branch to the origin");
  assert.equal(git("log", "--all", "--format=%s").split("\n").filter((s) => s.startsWith("note:")).length, 0,
    "no commit anywhere is a note");
  assert.equal(existsSync(join(repo, "NOTES")), false, "no note file in the clone's tree");

  const rows = await asOwner("SELECT handle, household, body FROM resident_notes ORDER BY handle");
  assert.deepEqual(rows, [
    { handle: "aleph", household: "hh:hearth", body: "The kettle is on the left." },
    { handle: "alpha", household: "hh:hearth", body: "Remember the blue door." },
  ], "the store holds both notes, under the residents' house");
});

test("the receipt says where the note is kept and echoes it; a rewrite replaces it, one row per resident", { skip }, async () => {
  const first = await worldNoteViaOffice(repo, { handle: "alpha", body: "Bring the brass key." }, hearth);
  assert.equal(first.handle, "alpha");
  assert.equal(first.note, "Bring the brass key.");
  assert.match(first.kept, /never written to any repository/);
  assert.ok(!Number.isNaN(Date.parse(first.written_at)), "the receipt carries when it was kept");
  for (const gone of ["path", "branch", "commit", "pushed"]) assert.equal(gone in first, false, `no git field (${gone}) on the receipt`);

  const second = await worldNoteViaOffice(repo, { handle: "alpha", body: "The key is under the mat." }, hearth);
  assert.equal(second.note, "The key is under the mat.");
  const rows = await asOwner("SELECT body FROM resident_notes WHERE handle = 'alpha'");
  assert.deepEqual(rows, [{ body: "The key is under the mat." }], "one current note, not a journal");
});

test("an embodied orient reads its own resident's note; another house and a spectator read none", { skip }, async () => {
  await worldNoteViaOffice(repo, { handle: "alpha", body: "Remember the blue door." }, hearth);
  const own = await worldOrient({ handle: "alpha" }, hearth);
  assert.equal(own.standpoint.stance, "embodied");
  assert.equal(own.note, "Remember the blue door.");
  assert.equal("note_unavailable" in own, false);
  assert.equal((await worldOrient({ handle: "aleph" }, hearth)).note, "The kettle is on the left.",
    "a housemate's note is their own: each resident reads the note they left");
  assert.equal((await worldOrient({}, yonder)).note, null, "another household reads no note");
  assert.equal((await worldOrient({ x: 0, y: 0 }, hearth)).note, null, "a spectator glance reads nobody's note");
});

test("the row policy: no declared house sees no note, a foreign house sees none and writes none, and no export role can read the table", { skip }, async () => {
  const api = await store.connect("office_api");
  try {
    assert.equal((await api.query("SELECT count(*)::int AS n FROM resident_notes")).rows[0].n, 0,
      "office_api with no household declared sees no row");
    await api.query("BEGIN");
    await api.query("SELECT set_config('app.household', 'hh:yonder', true), set_config('app.household_keys', 'hh:yonder', true)");
    assert.equal((await api.query("SELECT count(*)::int AS n FROM resident_notes")).rows[0].n, 0, "yonder sees none of the hearth's notes");
    await assert.rejects(
      api.query("INSERT INTO resident_notes (handle, household, body, written_at) VALUES ('alpha', 'hh:hearth', 'forged', now())"),
      /row-level security/, "yonder cannot write a note under the hearth");
    await api.query("ROLLBACK");
    await assert.rejects(api.query("DELETE FROM resident_notes"), /permission denied/, "a note is replaced, never deleted");
  } finally { await api.end(); }
  const exporter = await store.connect("snapshot_reader");
  try {
    await assert.rejects(exporter.query("SELECT body FROM resident_notes"), /permission denied/, "the notary's role cannot read a note");
  } finally { await exporter.end(); }
});

test("a record that cannot answer is disclosed: the door refuses and writes nothing anywhere, the orient says the note is unread, not absent", { skip }, async () => {
  const refsBefore = git("for-each-ref", "--format=%(refname) %(objectname)");
  await asOwner("ALTER TABLE resident_notes RENAME TO resident_notes_away");
  try {
    await assert.rejects(worldNoteViaOffice(repo, { handle: "alpha", body: "lost?" }, hearth),
      (e) => e.code === 503 && /could not be kept/.test(e.defect) && /nothing was written anywhere/.test(e.hint));
    const o = await worldOrient({ handle: "alpha" }, hearth);
    assert.equal(o.note, null);
    assert.match(o.note_unavailable, /not an answer that you have no note/);
  } finally {
    await asOwner("ALTER TABLE resident_notes_away RENAME TO resident_notes");
  }
  assert.equal(git("for-each-ref", "--format=%(refname) %(objectname)"), refsBefore, "the refused note moved no ref");
  assert.equal((await worldOrient({ handle: "alpha" }, hearth)).note, "Remember the blue door.", "and the kept note reads again");
});
