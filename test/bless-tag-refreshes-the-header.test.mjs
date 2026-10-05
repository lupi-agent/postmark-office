// bless-tag-refreshes-the-header.test.mjs — a settlement tag that lands on
// main's unchanged sha moves the World header (POS-402, postmark#3445).
//
// THE INSTANCE: S94 published at 06:00Z, so its commit 573e35ce was main's tip
// before the keeper's tag existed; `settlement/S94` was created at 06:36:37Z.
// The store and world.db stood at S94 from 06:39Z, but every World header
// (`worldCanon` → `_raw.blessed`) named S93 until the office restarted at
// 12:01Z.
//
// THE CAUSE, measured: not world()'s cache, which is keyed by the blessed ref
// (a new tag is a new key). It is the ref memo under `blessed()`. It files its
// answer under the refs' stamp read before computing, but in the office the
// compute's git questions are answered by the world refresher, which serves the
// refs as they stood before a move until it publishes. The S93 answer was kept
// under the after-tag stamp, and nothing computed it again. A young office hid
// it: its refresher had not yet learned these questions and sent them to git.
//
// THE FIXTURE is the box at 06:36Z: `settlement/S93` at C1, main at C2 (the
// published candidate), and a refresher that has LEARNED the blessing's
// questions, as an office that has been up a while has.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const repo = mkdtempSync(join(tmpdir(), "postmark-bless-header-"));
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const commit = (m) => git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", m);
const bless = (n, rev) => git("-c", "user.name=keeper", "-c", "user.email=k@t.invalid", "tag", "-a", "-m", `S${n}`, `settlement/S${n}`, rev);
const sha = (ref) => git("rev-parse", `${ref}^{commit}`).trim();

// The engine world() imports, at the blessed ref: the smallest fold there is.
put("tools/world-build.mjs", "export function assembleWorld({ worldState }) { return { marks: worldState.marks }; }\n");
put("tools/world-verbs.mjs", "export {};\n");
put("WORLD/skeleton.json", "{}");
put("WORLD/world-state.json", JSON.stringify({ marks: [{ id: "a/one", at: { x: 1, y: 1 } }] }));
git("init", "-q", "-b", "main");
git("add", "-A");
commit("settlement: S93");
const C1 = sha("refs/heads/main");
bless(93, C1);
put("WORLD/world-state.json", JSON.stringify({ marks: [{ id: "a/one", at: { x: 1, y: 1 } }, { id: "b/two", at: { x: 2, y: 2 } }] }));
git("add", "-A");
commit("settlement: S94, published 06:00Z");
const C2 = sha("refs/heads/main");

process.env.WORLD_CLONE = repo;
const { worldCanon } = await import("../src/world.mjs");
const { blessed } = await import("../src/world-branches.mjs");
const { startWorldRefresher, worldRefresher } = await import("../src/world-refresher.mjs");

after(() => {
  worldRefresher(repo)?.stop();
  rmSync(repo, { recursive: true, force: true });
});

test("RED CONTROL: before the tag, the header names S93 and main's C2 as the candidate ahead", async () => {
  const r = startWorldRefresher(repo, { intervalMs: 0 });
  assert.ok(r, "the fixture is a git clone");
  await r.refreshNow();
  await worldCanon();
  // Teach the refresher the blessing's questions the way a running office
  // does: a ref moves, the memo computes again through the refresher, and the
  // refresher's next pass publishes those questions' answers.
  git("update-ref", "refs/remotes/origin/main", C2);
  await worldCanon();
  await r.refreshNow();
  await worldCanon();
  await r.refreshNow();
  const canon = await worldCanon();
  assert.equal(canon.as_of_settlement, "S93");
  assert.equal(canon.canon_sha, C1);
  assert.equal(canon.candidate_ahead, C2);
  assert.ok(r.stats().counts.served > 0, "the refresher is answering, so the case below is the box's");
});

test("FALSIFIER, #3445: the keeper's tag on main's unchanged sha moves the header at once, never from behind", async () => {
  bless(94, C2);
  const canon = await worldCanon();
  assert.equal(canon.as_of_settlement, "S94", `the header still names ${canon.as_of_settlement}`);
  assert.equal(canon.canon_sha, C2);
  assert.equal(canon.candidate_ahead, null);
  assert.equal(blessed(repo).tag, "settlement/S94");
});

test("and it stays moved once the refresher catches up (the box's header stayed on S93 for 5.5 hours)", async () => {
  await worldRefresher(repo).refreshNow();
  const canon = await worldCanon();
  assert.equal(canon.as_of_settlement, "S94");
  assert.equal(canon.canon_ref, "refs/tags/settlement/S94");
});
