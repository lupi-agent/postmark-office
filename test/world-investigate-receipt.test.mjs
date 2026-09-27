// world-investigate-receipt.test.mjs — the receipt AT THE DOOR.
//
// `test/mark-receipt.test.mjs` proves the derivation on hand-built records.
// This proves the DOOR: that `world_investigate` — and through it the apex's
// `mark:` focus, which calls the same function — actually carries the receipt,
// and that a mark the record has seen is no longer answered with the sentence a
// typo gets.
//
// THE SENTENCE THIS ENDS, from the 2026-09-06 05:53 EDT walk:
//
//   Focus on the mark: `"error": "no mark or terrain feature
//   'wright/the-flip-day-plumb-line'"`. `world_investigate`: the same sentence.
//   … The escrow shadow: `escrow: 1` … The stake is real and the door can name
//   the mark when it is talking about stamps.
//
// The world here is a REAL git fixture clone, built the way
// `world-investigate-image.test.mjs` builds one and for the same reason: the
// door reads published state out of git and materialises the ENGINE out of the
// clone at main, so a plain directory would not do and a stand-in engine would
// be testing the stand-in.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { NO_WORLD, worldClone } from "./fixture-paths.mjs";

const SOURCE_WORLD = worldClone();
const HAVE_SOURCE = !!SOURCE_WORLD && existsSync(join(SOURCE_WORLD, "WORLD", "world-state.json"));

const repo = mkdtempSync(join(tmpdir(), "pm-receipt-fixture-"));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

const HOUSEHOLD = "fixturehouse";
const KEY = { household: HOUSEHOLD, handles: new Set(["fixture"]) };
const STANDING = "fixture/a-standing-thing";
const SKETCH = "fixture/a-sketch-nobody-has-seen";
const NEVER = "nobody/never-was";

let S1 = null;

if (HAVE_SOURCE) {
  mkdirSync(join(repo, "WORLD"), { recursive: true });
  cpSync(join(SOURCE_WORLD, "WORLD", "skeleton.json"), join(repo, "WORLD", "skeleton.json"));
  cpSync(join(SOURCE_WORLD, "tools"), join(repo, "tools"), { recursive: true });

  const state = JSON.parse(readFileSync(join(SOURCE_WORLD, "WORLD", "world-state.json"), "utf8"));
  const template = (state.marks ?? [])[0];
  state.marks = [...(state.marks ?? []),
    { ...template, id: STANDING, by: "fixture", slug: "a-standing-thing", kind: "thing" }];
  writeFileSync(join(repo, "WORLD", "world-state.json"), JSON.stringify(state));
  mkdirSync(join(repo, "WORLD", "marks", "fixture", "a-standing-thing"), { recursive: true });
  writeFileSync(join(repo, "WORLD", "marks", "fixture", "a-standing-thing", "mark.md"),
    "---\nby: fixture\nkind: thing\n---\na standing thing\n");

  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@postmark.test");
  git("config", "user.name", "fixture");
  git("add", "-A");
  git("commit", "-qm", "settlement: sweep 1 published");
  git("tag", "settlement/S1");
  S1 = git("rev-parse", "settlement/S1^{commit}").trim();

  // The household's own compose space: a mark that exists NOWHERE in canon and
  // rides no docket — the private half of "a mark the record has seen".
  git("switch", "-q", "-c", `draft/${HOUSEHOLD}`);
  mkdirSync(join(repo, "WORLD", "marks", "fixture", "a-sketch-nobody-has-seen"), { recursive: true });
  writeFileSync(join(repo, "WORLD", "marks", "fixture", "a-sketch-nobody-has-seen", "mark.md"),
    "---\nby: fixture\nkind: thing\ndate: 2026-09-06T19:13:13Z\n---\na sketch\n");
  git("add", "-A");
  git("commit", "-qm", "mark: fixture/a-sketch-nobody-has-seen — by fixture (via world_leave_mark)");
  git("switch", "-q", "main");

  process.env.WORLD_CLONE = repo;
}

const skip = HAVE_SOURCE ? false : (SOURCE_WORLD ? `the world clone at ${SOURCE_WORLD} carries no WORLD/world-state.json — this fixture needs the town's real engine and skeleton` : NO_WORLD);
const door = async () => (await import("../src/world.mjs")).worldInvestigate;

test("RED CONTROL: the fixture is the shape — canon holds one mark, the sketchbook holds the other, neither knows the third", { skip }, () => {
  const state = JSON.parse(git("show", "main:WORLD/world-state.json"));
  const ids = new Set((state.marks ?? []).map((m) => m.id));
  assert.ok(ids.has(STANDING), "canon must hold the standing mark");
  assert.ok(!ids.has(SKETCH), "canon must NOT hold the sketch — that is the whole case");
  assert.ok(!ids.has(NEVER));
  assert.match(git("diff", "--name-only", `main...refs/heads/draft/${HOUSEHOLD}`), /a-sketch-nobody-has-seen/);
});

test("a PUBLISHED mark carries its receipt, naming the settlement that carried it", { skip }, async () => {
  const r = await (await door())({ mark: STANDING }, KEY);
  assert.ok(!r.error, `the door bounced: ${JSON.stringify(r).slice(0, 200)}`);
  assert.equal(r.receipt.status, "published");
  assert.equal(r.receipt.crossing.s, 1);
  assert.equal(r.receipt.settlement_sha, S1);
  assert.match(r.receipt.says, /published at S1/);
  assert.equal(r.id ?? r.mark ?? STANDING, STANDING, "the engine's own answer is unchanged beside it");
});

test("ONE STAMP FOR ONE ANSWER: the receipt names the ref and sha the answer was folded from", { skip }, async () => {
  const r = await (await door())({ mark: STANDING }, KEY);
  // the READ tier's ref is the newest BLESSING (postmark#2934, the bless
  // overrides the tick): this fixture's S1 tag stands where main stands
  assert.equal(r.receipt.read_at.ref, "refs/tags/settlement/S1");
  assert.equal(r.receipt.read_at.sha, S1);
  assert.equal(r.receipt.read_at.sha, git("rev-parse", "refs/heads/main^{commit}").trim(), "and main has not moved past it here");
});

test("THE STOPPER, ended: a mark the record has seen is NOT answered 'no mark'", { skip }, async () => {
  const r = await (await door())({ mark: SKETCH }, KEY);
  assert.equal(r.error, undefined,
    'this is the walk\'s sentence — "no mark or terrain feature" about a mark the record plainly holds');
  assert.equal(r.standing, false, "it is not on the world, and the answer says so in a word, not by absence");
  assert.equal(r.receipt.status, "draft");
  assert.match(r.note, /on no docket and in no public answer/);
  assert.match(r.note, /Staking it is what puts it forward/,
    "a resident is told what would move it, not merely that it has not moved");
});

test("a mark the record NEVER SAW still bounces — the only case that may", { skip }, async () => {
  const r = await (await door())({ mark: NEVER }, KEY);
  assert.equal(r.error, "bounce");
  assert.match(r.defect, /no mark/);
  assert.equal(r.receipt.status, "never-was",
    "and even the bounce carries the receipt, so the reader can tell a never-was from an unreadable store");
});

// ── TERRAIN IS NOT A MARK, AND IT WAS NEVER MISSING ────────────────────────
//
// Repaired 2026-09-07 on the reviewer's finding. `investigate` answers a
// TERRAIN feature with `{ id, kind: "terrain", body, attaches }` and no `error`
// — a perfectly good answer about a real thing in the world. Commit 2's
// unconditional `return { ...r, receipt }` hung a receipt on it, and the
// receipt is derived from `claims` + canon MARKS, neither of which has ever
// held a terrain feature. So the town's own river came back beside
// `status: "never-was"`, "the record holds no mark of this id" — the exact
// mislabel class commit 4 fixed one door over, newly introduced by commit 2.
//
// THE ID IS READ OUT OF `WORLD/skeleton.json § features`, never typed here, so
// this leg cannot go vacuous the day the terrain is renamed: a hardcoded id
// that stopped resolving would answer `never-was` and the assertion would pass
// for the wrong reason. The red control below is what makes that safe.
const TERRAIN = HAVE_SOURCE
  ? (JSON.parse(readFileSync(join(SOURCE_WORLD, "WORLD", "skeleton.json"), "utf8")).features ?? [])[0]?.id ?? null
  : null;

test("RED CONTROL: the fixture's skeleton really carries a terrain feature, and canon does not", { skip }, () => {
  assert.ok(TERRAIN, "no terrain feature in the skeleton — every assertion below would be about nothing");
  const state = JSON.parse(git("show", "main:WORLD/world-state.json"));
  assert.ok(!(state.marks ?? []).some((m) => m.id === TERRAIN),
    "canon must NOT hold it — that is why the receipt called it never-was");
});

test("a TERRAIN feature answers as terrain, and carries no 'the record never saw it' receipt", { skip }, async () => {
  const r = await (await door())({ mark: TERRAIN }, KEY);
  assert.equal(r.error, undefined, "a terrain focus is a real answer about a real thing");
  assert.equal(r.kind, "terrain");
  assert.notEqual(r.receipt?.status, "never-was",
    "the town's own river was being told the record holds nothing of its id");
  assert.equal(r.receipt?.status, "terrain",
    "terrain gets its OWN sentence — absence of a receipt would be a third silence, and this lane is about ending those");
  assert.match(r.receipt.says, /terrain/);
  assert.ok(!/never saw|holds no mark/.test(r.receipt.says));
});

test("the `terrain:`-prefixed spelling answers the same — one thing, not two", { skip }, async () => {
  const r = await (await door())({ mark: `terrain:${TERRAIN}` }, KEY);
  assert.equal(r.error, undefined);
  assert.equal(r.kind, "terrain");
  assert.equal(r.receipt?.status, "terrain");
});

test("a SPECTATOR (no key) sees the published mark and NOT another household's compose space", { skip }, async () => {
  const pub = await (await door())({ mark: STANDING }, null);
  assert.equal(pub.receipt.status, "published", "canon is public — ruling 9, one world for everyone");

  const priv = await (await door())({ mark: SKETCH }, null);
  assert.equal(priv.error, "bounce", "a keyless caller has no compose space to be shown");
  assert.equal(priv.receipt.status, "never-was");
  assert.ok(!JSON.stringify(priv).includes("a sketch"),
    "the draft's BODY must not reach a caller who is not its household — 007's law, at this door");
});
