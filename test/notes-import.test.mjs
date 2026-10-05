// notes-import.test.mjs — THE ONE-TIME IMPORT OF GIT-ERA NOTES (POS-392 follow-up).
//
//   node --test test/notes-import.test.mjs
//
// world2/tools/notes-import.mjs reads each resident's newest NOTES/<handle>.md
// from the tips of a world clone's origin/draft/* and writes it through
// note-store.mjs's own writer, only where the resident has no note yet. These
// tests run it as the box runs it: a child process dialling a real Postgres
// (test/helpers/embedded-store.mjs, the whole schema) as `office_api`, so 063's
// row policy is live, over a fixture clone whose notes are invented.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { startStore } from "./helpers/embedded-store.mjs";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "..", "world2", "tools", "notes-import.mjs");
const store = await startStore({ db: "notes_import_test" });
after(() => store.stop?.());
const skip = store.skip ?? false;
const scratch = mkdtempSync(join(tmpdir(), "postmark-notes-import-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

// Three houses in the registry; "ghost" is housed nowhere.
async function seed() {
  const c = await store.connect("world2_owner");
  try {
    await c.query(
      `INSERT INTO households (slug, ord, name, residents, since, declared_by)
       VALUES ('hearth', 0, 'The Hearth', ARRAY['alpha','aleph'], '2026-08-01', 'alpha'),
              ('yonder', 1, 'Yonder', ARRAY['beta'], '2026-08-01', 'beta'),
              ('newhouse', 2, 'New House', ARRAY['gamma'], '2026-09-20', 'gamma')`);
    await c.query(
      `INSERT INTO household_pins (handle, login, gh_id, pinned)
       VALUES ('alpha','alpha',401,'2026-08-01'), ('aleph','aleph',402,'2026-08-01'),
              ('beta','beta',403,'2026-08-01'), ('gamma','gamma',404,'2026-09-20')`);
  } finally { await c.end(); }
}
const asOwner = async (sql, params = []) => {
  const c = await store.connect("world2_owner");
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
};

// The fixture: an origin whose household branches carry notes, and a clone of it.
// gamma's note stands on two branches (the house moved); the newer is on draft/new-house.
const seedRepo = join(scratch, "seed"), origin = join(scratch, "origin.git"), clone = join(scratch, "clone");
const NOTES = {
  alpha: "invented: the blue door",
  aleph: "invented: the kettle",
  beta: "invented: the brass key",
  ghost: "invented: nobody's",
  gammaOld: "invented: the old house",
  gammaNew: "invented: the new house",
};
if (!skip) {
  await seed();
  mkdirSync(seedRepo);
  const g = (...a) => execFileSync("git", ["-c", "core.autocrlf=false", "-C", seedRepo, ...a], { encoding: "utf8" });
  const at = (iso) => ({ ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso });
  const commit = (msg, iso) => execFileSync("git", ["-c", "core.autocrlf=false", "-C", seedRepo, "-c", "user.name=fx", "-c", "user.email=fx@test.invalid", "commit", "-q", "-m", msg], { env: at(iso) });
  const put = (path, text) => { mkdirSync(dirname(join(seedRepo, path)), { recursive: true }); writeFileSync(join(seedRepo, path), `${text}\n`); };
  g("init", "-q", "-b", "main"); put("README", "world"); g("add", "-A"); commit("main", "2026-08-01T00:00:00Z");
  const note = (branch, handle, body, iso) => { g("checkout", "-q", branch); put(`NOTES/${handle}.md`, body); g("add", "-A"); commit(`note: ${handle}`, iso); };
  g("checkout", "-q", "-b", "draft/house-a", "main");
  note("draft/house-a", "alpha", "invented: an older word", "2026-09-01T00:00:00Z");
  note("draft/house-a", "alpha", NOTES.alpha, "2026-09-10T00:00:00Z");
  note("draft/house-a", "aleph", NOTES.aleph, "2026-09-11T00:00:00Z");
  g("checkout", "-q", "-b", "draft/house-b", "main");
  note("draft/house-b", "beta", NOTES.beta, "2026-09-12T00:00:00Z");
  note("draft/house-b", "ghost", NOTES.ghost, "2026-09-13T00:00:00Z");
  g("checkout", "-q", "-b", "draft/old-house", "main");
  note("draft/old-house", "gamma", NOTES.gammaOld, "2026-09-14T00:00:00Z");
  g("checkout", "-q", "-b", "draft/new-house", "main");
  note("draft/new-house", "gamma", NOTES.gammaNew, "2026-09-21T00:00:00Z");
  g("checkout", "-q", "-b", "draft/no-notes", "main");
  put("WORLD/marks/x/mark.md", "a mark draft, not a note"); g("add", "-A"); commit("draft", "2026-09-15T00:00:00Z");
  g("checkout", "-q", "main");
  execFileSync("git", ["clone", "-q", "--bare", seedRepo, origin]);
  execFileSync("git", ["clone", "-q", origin, clone]);
}

const env = { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: store.url?.("office_api") };
const run = (...a) => spawnSync(process.execPath, [TOOL, "--world-repo", clone, ...a], { encoding: "utf8", env });
const lineOf = (out, handle) => out.split("\n").find((l) => l.startsWith(`${handle}\t`));
const rows = () => asOwner("SELECT handle, household, body, written_at FROM resident_notes ORDER BY handle");
const refsOf = (dir) => execFileSync("git", ["-C", dir, "for-each-ref", "--format=%(refname) %(objectname)"], { encoding: "utf8" });

test("--dry-run names handle, household, bytes and branch for each resident's newest note, writes nothing, and never prints a note", { skip }, async () => {
  const r = run("--dry-run");
  assert.equal(r.status, 3, `ghost is refused, so the run says so (${r.stderr})`);
  assert.match(r.stdout, /^# dry-run: 4 branches carry 6 notes for 5 residents · would write 4 · skipped 0 · refused 1$/m);
  assert.equal(lineOf(r.stdout, "alpha"), `alpha\thh:hearth\t${Buffer.byteLength(NOTES.alpha)} B\tdraft/house-a\twould write`);
  assert.equal(lineOf(r.stdout, "gamma"), `gamma\thh:newhouse\t${Buffer.byteLength(NOTES.gammaNew)} B\tdraft/new-house\twould write\t(also on draft/old-house)`,
    "the newest copy wins and the other branch is named");
  assert.match(lineOf(r.stdout, "ghost"), /^ghost\t-\t\d+ B\tdraft\/house-b\tREFUSED: the registry houses no resident by this handle/);
  assert.doesNotMatch(r.stdout + r.stderr, /invented/, "no note text on any line");
  assert.deepEqual(await rows(), [], "a dry run writes nothing");
});

test("--apply writes the newest note per resident through the door's writer, under the door's household, dated at the note's commit", { skip }, async () => {
  const before = refsOf(clone);
  const r = run("--apply");
  assert.equal(r.status, 3, "ghost is still refused, by name");
  assert.match(r.stdout, /· written 4 · skipped 0 · refused 1$/m);
  assert.doesNotMatch(r.stdout + r.stderr, /invented/);
  const got = (await rows()).map((x) => ({ ...x, written_at: new Date(x.written_at).toISOString() }));
  assert.deepEqual(got, [
    { handle: "aleph", household: "hh:hearth", body: NOTES.aleph, written_at: "2026-09-11T00:00:00.000Z" },
    { handle: "alpha", household: "hh:hearth", body: NOTES.alpha, written_at: "2026-09-10T00:00:00.000Z" },
    { handle: "beta", household: "hh:yonder", body: NOTES.beta, written_at: "2026-09-12T00:00:00.000Z" },
    { handle: "gamma", household: "hh:newhouse", body: NOTES.gammaNew, written_at: "2026-09-21T00:00:00.000Z" },
  ], "the tip's note (not alpha's older word), gamma's newer house, and no row for ghost");
  assert.equal(refsOf(clone), before, "the import moved no ref");
  assert.equal(refsOf(origin).includes("draft/house-a"), true, "and deleted no branch: that is the operator's act");
});

test("a note written through the door since the deploy is never replaced, and a second --apply writes nothing", { skip }, async () => {
  // beta writes a fresh note through the door's own writer after the import
  const c = await store.connect("office_api");
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.household', 'hh:yonder', true), set_config('app.household_keys', 'hh:yonder', true)");
    await c.query("UPDATE resident_notes SET body = 'written since the deploy', written_at = '2026-10-05T15:00:00Z' WHERE handle = 'beta'");
    await c.query("COMMIT");
  } finally { await c.end(); }
  await asOwner("DELETE FROM resident_notes WHERE handle = 'aleph'"); // aleph has no row: the run must restore it, and only it
  const r = run("--apply");
  assert.match(r.stdout, /· written 1 · skipped 3 · refused 1$/m);
  assert.match(lineOf(r.stdout, "beta"), /\tskip: already has a note in the store \(written 2026-10-05T15:00:00.000Z\)$/);
  assert.match(lineOf(r.stdout, "aleph"), /\twritten \(dated 2026-09-11T00:00:00.000Z\)$/);
  const beta = (await rows()).find((x) => x.handle === "beta");
  assert.equal(beta.body, "written since the deploy", "the newer door note stands");

  const again = run("--apply");
  assert.match(again.stdout, /· written 0 · skipped 4 · refused 1$/m, "idempotent");
});

test("the row it writes is the door's: the resident's house reads it through note-store, another house cannot", { skip }, async () => {
  const api = await store.connect("office_api");
  try {
    await api.query("BEGIN");
    await api.query("SELECT set_config('app.household', 'hh:yonder', true), set_config('app.household_keys', 'hh:yonder', true)");
    assert.deepEqual((await api.query("SELECT handle FROM resident_notes ORDER BY handle")).rows, [{ handle: "beta" }], "yonder sees only its own");
    await api.query("ROLLBACK");
  } finally { await api.end(); }
  const read = spawnSync(process.execPath, ["--input-type=module", "-e",
    `const { noteOf } = await import(${JSON.stringify(new URL("../src/note-store.mjs", import.meta.url).href)});
     const n = await noteOf("gamma"); console.log(JSON.stringify(n)); process.exit(0);`], { encoding: "utf8", env });
  assert.equal(JSON.parse(read.stdout.trim()).body, NOTES.gammaNew, "the door's own reader finds the imported note");
});

test("without a mode, a clone or a store it refuses before reading anything", { skip }, () => {
  const none = spawnSync(process.execPath, [TOOL], { encoding: "utf8", env });
  assert.equal(none.status, 2); assert.match(none.stderr, /pass exactly one of --dry-run or --apply/);
  const noRepo = spawnSync(process.execPath, [TOOL, "--dry-run"], { encoding: "utf8", env });
  assert.equal(noRepo.status, 2); assert.match(noRepo.stderr, /--world-repo <office world clone> is required/);
  const noStore = spawnSync(process.execPath, [TOOL, "--dry-run", "--world-repo", clone], { encoding: "utf8", env: { ...env, WORLD2_PG: "", WORLD2_PG_URL: "" } });
  assert.equal(noStore.status, 2); assert.match(noStore.stderr, /no store/);
});
