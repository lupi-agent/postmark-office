// settlements.test.mjs — the number counts BLESSINGS, not beats.
//
// The rule this file exists to defend: a settlement number may only come from a
// tag that actually landed. Cadence arithmetic was proposed and killed by
// today's own receipts — S22 was refused at the 06:00Z heartbeat — so the tests
// that matter are the ones about refusals, gaps, and ordering.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import {
  parseSettlementTags, settlementsFrom, readSettlementTags, settlements, SETTLEMENT_TAG,
} from "../src/settlements.mjs";

const row = (n, date, sha = `sha${n}`) => ({ tag: `settlement/S${n}`, date, sha });

test("settlements are ordered by NUMBER, not by the order git hands them over", () => {
  // `git tag -l` sorts lexically: S9 lands after S10. Trusting that order would
  // have made the newest settlement wrong the moment the town passed nine.
  const parsed = parseSettlementTags([row(10, "2026-08-01T00:00:00Z"), row(9, "2026-07-31T00:00:00Z"), row(2, "2026-07-01T00:00:00Z")]);
  assert.deepEqual(parsed.map((s) => s.n), [10, 9, 2], "newest first, numerically");
});

test("a REFUSED gate leaves a gap, and the gap is the record — not something to repair", () => {
  // S22 refused: the tags jump 21 → 23 when the next one lands. Current is the
  // highest that LANDED, and nothing here interpolates the missing one.
  const { current, recent } = settlementsFrom([row(21, "2026-08-07T18:07:00Z"), row(23, "2026-08-09T06:04:00Z")]);
  assert.equal(current.n, 23);
  assert.deepEqual(recent.map((s) => s.n), [23, 21], "the gap stands; no S22 is invented");
});

test("the current settlement is the highest that landed, even when a later date is lower-numbered", () => {
  // a re-tag or a repaired run can date out of order; the NUMBER governs
  const { current } = settlementsFrom([row(21, "2026-08-08T14:54:00Z"), row(20, "2026-08-08T20:00:00Z")]);
  assert.equal(current.n, 21, "the number is the settlement, the date is only when it happened");
});

test("nothing that is not a settlement tag becomes one", () => {
  const parsed = parseSettlementTags([
    { tag: "v1.0.0", date: "2026-01-01T00:00:00Z" },
    { tag: "settlement/S", date: "2026-01-01T00:00:00Z" },
    { tag: "settlement/Sx", date: "2026-01-01T00:00:00Z" },
    { tag: "settlement/S07extra", date: "2026-01-01T00:00:00Z" },
    { tag: "release/settlement/S3", date: "2026-01-01T00:00:00Z" },
    row(7, "2026-01-01T00:00:00Z"),
  ]);
  assert.deepEqual(parsed.map((s) => s.n), [7], "only settlement/S<digits>, anchored at both ends");
  assert.equal(SETTLEMENT_TAG.test("settlement/S21"), true);
  assert.equal(SETTLEMENT_TAG.test("settlement/S21-rc"), false);
});

test("an empty world is an honest empty — the chip loses its number, never invents one", () => {
  const empty = settlementsFrom([]);
  assert.equal(empty.current, null);
  assert.deepEqual(empty.recent, []);
  assert.deepEqual(settlementsFrom(null), { current: null, recent: [] }, "no rows at all is not a throw");
  assert.equal(settlementsFrom([{ tag: "settlement/S1" }]).current.date, null, "a dateless tag still counts, undated");
});

test("recent is capped, newest kept", () => {
  const many = Array.from({ length: 40 }, (_, i) => row(i + 1, `2026-01-01T00:00:0${i % 10}Z`));
  const { recent, current } = settlementsFrom(many, { limit: 20 });
  assert.equal(recent.length, 20);
  assert.equal(current.n, 40);
  assert.equal(recent[0].n, 40, "the cap counts down from the newest");
  assert.equal(recent.at(-1).n, 21);
});

// ── against a real repository, including an ANNOTATED tag ───────────────────

test("reading a real clone: annotated and lightweight tags both resolve to their COMMIT", () => {
  const repo = mkdtempSync(join(tmpdir(), "settle-"));
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "T");
  g("commit", "-q", "--allow-empty", "-m", "one");
  g("tag", "settlement/S1");                                   // lightweight
  g("commit", "-q", "--allow-empty", "-m", "two");
  g("tag", "-a", "settlement/S2", "-m", "blessed");            // annotated
  g("commit", "-q", "--allow-empty", "-m", "three");
  g("tag", "v9.9.9");                                          // not a settlement

  const { current, recent } = settlements(repo);
  assert.equal(current.n, 2, "the annotated tag is the current settlement");
  assert.deepEqual(recent.map((s) => s.n), [2, 1]);
  assert.match(current.date, /^\d{4}-\d{2}-\d{2}T/, "a real ISO date came back");

  // the sha must be the COMMIT the tag blesses, not the annotated tag's own object
  const commitOfS2 = g("rev-parse", "--short", "settlement/S2^{commit}").trim();
  const tagObject = g("rev-parse", "--short", "settlement/S2").trim();
  assert.equal(current.sha, commitOfS2, "the sha a reader can look up in the log");
  assert.notEqual(tagObject, commitOfS2, "…and this repo really does distinguish the two");
});

test("a directory that is not a repo answers empty rather than throwing", () => {
  const notRepo = mkdtempSync(join(tmpdir(), "settle-bare-"));
  assert.deepEqual(readSettlementTags(notRepo), []);
  assert.deepEqual(settlements(notRepo), { current: null, recent: [] });
  assert.deepEqual(settlements("Z:/no/such/place"), { current: null, recent: [] });
});

// ── ONE for-each-ref, the SAME rows as the per-tag reading (POS-272) ────────
//
// The door used to spend two spawns per tag: `rev-parse --short <tag>^{commit}`
// and `log -1 --format=%cI <tag>`. It now spends one `for-each-ref` for the
// list. The per-tag reading is restated here as the falsifier: the two must
// hand back identical rows, lightweight and annotated, including a commit
// dated in a zone that is not UTC (`%cI` keeps the committer's own offset, and
// so must the one read).
const perTag = (repo) => {
  const g = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return g("tag", "--list", "settlement/S*").split("\n").map((s) => s.trim()).filter((t) => SETTLEMENT_TAG.test(t)).map((tag) => ({
    tag,
    sha: g("rev-parse", "--short", `${tag}^{commit}`).trim() || null,
    date: g("log", "-1", "--format=%cI", tag).trim() || null,
  }));
};
const byTag = (rows) => [...rows].sort((a, b) => a.tag.localeCompare(b.tag));

test("one for-each-ref reads the same rows the per-tag spawns read", () => {
  const repo = mkdtempSync(join(tmpdir(), "settle-one-"));
  const g = (env, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
  g({}, "init", "-q", "-b", "main");
  g({}, "config", "user.email", "t@example.com");
  g({}, "config", "user.name", "T");
  g({ GIT_COMMITTER_DATE: "2026-08-08T18:00:00+05:30" }, "commit", "-q", "--allow-empty", "-m", "one");
  g({}, "tag", "settlement/S9");                                        // lightweight, off-UTC commit
  g({ GIT_COMMITTER_DATE: "2026-08-09T06:00:00Z" }, "commit", "-q", "--allow-empty", "-m", "two");
  g({}, "tag", "-a", "settlement/S10", "-m", "blessed");               // annotated
  g({}, "tag", "settlement/Sx");                                        // under the prefix, not a settlement
  g({}, "tag", "v1");                                                   // not under it at all

  const rows = readSettlementTags(repo);
  assert.deepEqual(byTag(rows), byTag(perTag(repo)));
  assert.equal(rows.length, 2, "only settlement/S<n> tags are rows");
  assert.equal(rows.find((r) => r.tag === "settlement/S9").date, "2026-08-08T18:00:00+05:30", "the committer's own zone, as %cI gives it");
});

test("the world clone's own tags: one for-each-ref agrees with the per-tag reading", (t) => {
  const clone = process.env.WORLD_CLONE;
  if (!clone) return t.skip("WORLD_CLONE is not set — the fixture above still holds the rule");
  const rows = readSettlementTags(clone);
  if (!rows.length) return t.skip("this clone carries no settlement tags");
  assert.deepEqual(byTag(rows), byTag(perTag(clone)));
});
