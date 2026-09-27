// world-refresher.test.mjs — POS-263: a world read asks git nothing while the
// refs are still, and a refresher that has not caught up is still answered from.
//
// THE LAW, from the brief: "a background refresher owns the git refs and the
// reads they feed, and requests read its in-memory answer." The inventory
// (docs/request-path-inventory.md) counted 197 synchronous git children in one
// GET /world/present on this tree before w39.13's memo, and 54 after it.
//
// THE FIXTURE is the box in miniature: a blessed settlement at C1, main and
// origin/main at the candidate C2, a household's pen branch and its origin twin,
// and the walk ledger on main. Every reader the inventory names is asked once
// to teach the refresher, then asked again with every synchronous child
// counted. Those counts must be zero, and every answer must equal what git
// itself answers.
//
//   node --test test/world-refresher.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  blessed, draftDeltaForKey, draftRefForHousehold, freshestMainRef, mainRef,
  materializeAtRef, publishedState, readAtRef, refExists,
} from "../src/world-branches.mjs";
import { questionKind, startWorldRefresher, worldRefresher } from "../src/world-refresher.mjs";

const repo = mkdtempSync(join(tmpdir(), "postmark-refresher-"));
const cache = mkdtempSync(join(tmpdir(), "postmark-refresher-engine-"));
after(() => {
  worldRefresher(repo)?.stop();
  rmSync(repo, { recursive: true, force: true });
  rmSync(cache, { recursive: true, force: true });
});

const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const commit = (m) => git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", m);
const sha = (ref) => git("rev-parse", `${ref}^{commit}`).trim();

put("WORLD/world-state.json", JSON.stringify({ marks: [{ id: "a/one", by: "a", at: { x: 1, y: 1 } }] }));
put("WORLD/skeleton.json", JSON.stringify({ regions: ["the-town-centre"] }));
put("WORLD/walk-ledger.md", "# walk ledger\n");
put("tools/engine.mjs", 'export const WORLD = "C1";\n');
git("init", "-q", "-b", "main");
git("add", "-A");
commit("settlement: sweep 1");
const C1 = sha("refs/heads/main");
git("-c", "user.name=keeper", "-c", "user.email=k@t.invalid", "tag", "-a", "-m", "S1", "settlement/S1", C1);

put("WORLD/world-state.json", JSON.stringify({ marks: [{ id: "a/one", by: "a", at: { x: 2, y: 2 } }] }));
put("WORLD/walk-ledger.md", "# walk ledger\n- a walked\n");
git("add", "-A");
commit("crossing-save 2: the candidate");
const C2 = sha("refs/heads/main");
git("update-ref", "refs/remotes/origin/main", C2);

git("switch", "-q", "-c", "draft/somebody");
put("WORLD/marks/the-town-centre/a-sketch/mark.md", ["---", "by: somebody", "kind: sited", "at: { x: 2, y: 2 }", "---", "a sketch", ""].join("\n"));
git("add", "-A");
commit("a household's sketchbook");
git("update-ref", "refs/remotes/origin/draft/somebody", sha("refs/heads/draft/somebody"));
git("switch", "-q", "main");

const KEY = { household: "somebody", handles: new Set(["somebody"]) };

// Every reader the inventory names, asked the way the doors ask.
const readAll = () => ({
  blessed: blessed(repo),
  freshest: freshestMainRef(repo),
  main: mainRef(repo),
  missing: refExists(repo, "refs/heads/draft/nobody"),
  draft: draftRefForHousehold(repo, "somebody"),
  ledger: readAtRef(repo, mainRef(repo), "WORLD/walk-ledger.md"),
  state: publishedState(repo).state,
  engine: materializeAtRef(repo, blessed(repo).ref, "tools", cache),
  delta: draftDeltaForKey(repo, KEY),
});

// Count every synchronous child the readers start, by replacing the binding
// world-branches imported (syncBuiltinESMExports carries it to ESM importers).
const cp = createRequire(import.meta.url)("node:child_process");
function countingSpawns(fn) {
  const orig = cp.execFileSync;
  const seen = [];
  cp.execFileSync = function (file, args, ...rest) { seen.push([file, ...(args ?? [])].join(" ")); return orig.call(this, file, args, ...rest); };
  syncBuiltinESMExports();
  try { return { value: fn(), seen }; }
  finally { cp.execFileSync = orig; syncBuiltinESMExports(); }
}

test("RED CONTROL: with no refresher running, the same reads start synchronous git children", () => {
  const { seen } = countingSpawns(readAll);
  assert.ok(seen.length >= 10, `the readers must be asking git on this path, or the zero below proves nothing (saw ${seen.length})`);
});

const truth = readAll();

test("a still clone: every read answers from memory, and every answer is git's own", async () => {
  const r = startWorldRefresher(repo, { intervalMs: 0 });
  assert.ok(r, "the fixture is a git clone");
  await r.refreshNow();
  readAll();                              // teach it the questions
  await r.refreshNow();
  const { value, seen } = countingSpawns(readAll);
  assert.deepEqual(seen, [], "a read while the refs are still starts no child process");
  assert.deepEqual({ ...value, blessed: { ...value.blessed } }, { ...truth, blessed: { ...truth.blessed } });
  assert.equal(value.blessed.sha, C1, "the blessing, peeled");
  assert.equal(value.missing, false, "a ref that does not exist is an answer too, and memory keeps it");
  assert.ok(r.stats().counts.served > 0);
});

test("publishedState reads world-state.json only when state is asked for", () => {
  worldRefresher(repo)?.stop();           // git itself answers here, so every read shows
  const { value, seen } = countingSpawns(() => {
    const ps = publishedState(repo);
    return { sha: ps.sha, ref: ps.ref };
  });
  assert.equal(value.sha, C1);
  assert.ok(!seen.some((s) => s.includes("world-state.json")), `ref and sha must not read the world's state (saw: ${seen.join(" | ")})`);
});

test("after a ref moves, a read answers from the last refresh until the refresher publishes, then from the new refs", async () => {
  const r = startWorldRefresher(repo, { intervalMs: 0 });
  await r.refreshNow();
  readAll();
  await r.refreshNow();
  git("-c", "user.name=keeper", "-c", "user.email=k@t.invalid", "tag", "-a", "-m", "S2", "settlement/S2", C2);
  const before = countingSpawns(() => blessed(repo));
  assert.equal(before.value.tag, "settlement/S1", "the refresher has not caught up, and a read does not wait for it");
  assert.deepEqual(before.seen, [], "nor does it ask git itself");
  assert.ok(r.stats().counts.servedBehind > 0, "and the refresher counts every answer it gave from behind");
  await r.refreshNow();
  const after = countingSpawns(() => blessed(repo));
  assert.equal(after.value.tag, "settlement/S2");
  assert.equal(after.value.sha, C2);
  assert.deepEqual(after.seen, []);
  r.stop();
});

test("what the refresher will and will not answer", () => {
  const S = "a".repeat(40);
  assert.deepEqual(questionKind(["show", `${S}:WORLD/world-state.json`]), { immutable: true });
  assert.deepEqual(questionKind(["rev-parse", "--verify", "--quiet", "refs/heads/main^{commit}"]), { immutable: false });
  assert.deepEqual(questionKind(["for-each-ref", "--format=%(refname)", "refs/tags/settlement/"]), { immutable: false });
  assert.deepEqual(questionKind(["rev-list", "--count", "refs/remotes/origin/draft/a..refs/heads/draft/a"]), { immutable: false });
  for (const write of [["fetch", "origin"], ["push", "origin", "main"], ["rebase", "origin/main"], ["switch", "main"], ["reset", "--hard"], ["update-ref", "refs/heads/main", S], ["merge", "--ff-only", "x"]])
    assert.equal(questionKind(write), null, `${write[0]} is a write and is never answered from memory`);
  assert.equal(questionKind(["rev-list", "-g", "refs/remotes/origin/draft/a"]), null, "the reflog moves without a ref file changing");
  assert.equal(questionKind(["rev-parse", "HEAD"]), null, "HEAD may name any branch, and the stamp watches only some");
  assert.equal(questionKind(["rev-parse", "refs/heads/jetto/x^{commit}"]), null, "a branch outside the watched namespaces");
  assert.equal(questionKind(["rev-parse", "--git-common-dir"]), null);
});
