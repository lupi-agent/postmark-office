// hearing-window.test.mjs — where the ear's window opens (POS-226).
//
// A throwaway world repo with crossings dated by hand: the window is the newest
// `settlement: sweep` commit on main (the box's publish), never the tag, never
// the heartbeat; a refused crossing publishes nothing and so resets nothing.
//   node --test test/hearing-window.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHearingWindow, publishedSettlementAt, blessedSettlementAt } from "../src/hearing-window.mjs";

function world() {
  const repo = mkdtempSync(join(tmpdir(), "postmark-hearing-"));
  const git = (args, date = null) => execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
  });
  git(["init", "-q", "-b", "main"]);
  let n = 0;
  const commit = (subject, date) => { writeFileSync(join(repo, "f"), String(++n)); git(["add", "f"]); git(["commit", "-q", "-m", subject], date); };
  return { repo, git, commit };
}

test("the window opens at world main's newest sweep commit — not the tag, and not a later non-sweep commit", async () => {
  const w = world();
  w.commit("settlement: sweep 3 published", "2026-09-27T18:00:34Z");
  w.git(["tag", "-a", "settlement/S85", "-m", "bless"], "2026-09-27T19:10:08Z");
  w.commit("settlement: household registry re-derived", "2026-09-28T06:00:09Z");
  w.commit("settlement: sweep 12 published", "2026-09-28T06:00:51Z");   // published, not yet blessed
  w.commit("crossing-save 217", "2026-09-28T12:02:47Z");
  assert.equal(new Date(await publishedSettlementAt(w.repo)).toISOString(), "2026-09-28T06:00:51.000Z");
  assert.equal(new Date(await blessedSettlementAt(w.repo)).toISOString(), "2026-09-27T18:00:34.000Z", "the tag lags the publish");
  const h = createHearingWindow({ repo: w.repo });
  const got = await h.refresh();
  assert.equal(new Date(got.since).toISOString(), "2026-09-28T06:00:51.000Z");
  assert.equal(got.disclosure, null);
});

test("a refused crossing resets nothing: with no new sweep commit the window stays where it was", async () => {
  const w = world();
  w.commit("settlement: sweep 3 published", "2026-09-27T18:00:34Z");
  // the 06:00Z heartbeat refused: nothing published, only the ferry's save
  w.commit("crossing-save 216", "2026-09-28T06:30:00Z");
  assert.equal(new Date(await publishedSettlementAt(w.repo)).toISOString(), "2026-09-27T18:00:34.000Z");
});

test("origin/main counts: a box whose local main lags reads the published truth", async () => {
  const w = world();
  w.commit("settlement: sweep 1 published", "2026-09-27T06:00:00Z");
  w.git(["branch", "-m", "main", "old"]);
  w.commit("settlement: sweep 2 published", "2026-09-27T18:00:00Z");
  w.git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  w.git(["branch", "-f", "main", "old"]);
  w.git(["checkout", "-q", "main"]);
  assert.equal(new Date(await publishedSettlementAt(w.repo)).toISOString(), "2026-09-27T18:00:00.000Z");
});

test("main unreadable: the newest tag stands in, and the answer says so", async () => {
  const w = world();
  w.commit("settlement: sweep 3 published", "2026-09-27T18:00:34Z");
  w.git(["tag", "-a", "settlement/S85", "-m", "bless"], "2026-09-27T19:10:08Z");
  const h = createHearingWindow({ repo: w.repo, published: async () => { throw new Error("git is stuck"); } });
  const got = await h.refresh();
  assert.equal(new Date(got.since).toISOString(), "2026-09-27T18:00:34.000Z");
  assert.match(got.disclosure, /newest BLESSED settlement/);
});

test("the say path never waits: read() answers from memory, and a failed refresh leaves the last answer standing", async () => {
  let clock = 0;
  let calls = 0;
  let answer = Date.UTC(2026, 8, 28, 6, 0, 51);
  const h = createHearingWindow({ repo: "unused", clock: () => clock, refreshMs: 60_000,
    published: async () => { calls += 1; if (answer === "throw") throw new Error("down"); return answer; },
    blessed: async () => { throw new Error("down"); } });
  assert.equal(h.read(), null, "nothing known before the first answer — and no wait for it");
  await h.refresh();
  assert.equal(h.read().since, answer);
  const before = calls;
  h.read();
  assert.equal(calls, before, "inside the refresh interval nothing is re-asked");
  clock += 60_000;
  const kept = answer;
  answer = "throw";
  h.read();
  await h.refresh();
  assert.equal(h.read().since, kept, "a reader that trips leaves the last answer standing");
});
