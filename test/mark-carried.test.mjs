// mark-carried.test.mjs — the store records which settlement first carried each
// mark (POS-142 follow-up, "Proposal B"; migration 049).
//
//   EMBEDDED_PG_DIR=<dir holding embedded-postgres> node --test test/mark-carried.test.mjs
//
// THE RIG. A real Postgres (test/helpers/embedded-store.mjs) with the whole
// schema, and a tagged world repo built here: marks filed at their ids, a
// world-state.json listing them, one ANNOTATED `settlement/S<n>` tag per
// crossing, as the keeper makes them. The writer is the real tool's functions;
// the oracle is 1.0's own `readMarkReceipt` (the /world/investigate reader) on
// the same repo.
//
// The commits are dated in UTC on purpose. 1.0's receipt `at` is git's
// iso-strict spelling in the committer's zone; the box commits in UTC (every tag
// from S38 on reads `Z`, measured 2026-10-01), and the twin spells the stored
// instant in `Z`. A fixture committed in a local zone would test the spelling,
// not the record.
//
// Without EMBEDDED_PG_DIR the store cases SKIP and say why; the pure cases run.
// The world and the store are built before any test is declared: a top-level
// await between tests lets the root's `after` hooks run early.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { startStore } from "./helpers/embedded-store.mjs";
import { planCarried, receiptDisagreement, recordCarried, verifyCarried, receiptLine, TICK_CAP } from "../world2/tools/mark-carried-backfill.mjs";
import { readTagLines, settlementRowsFrom } from "../world2/tools/settlements-backfill.mjs";
import { readMarkReceipt } from "../src/mark-receipt.mjs";
import { twinReceipt, receiptTreeOnly } from "../src/world2-serve.mjs";

// ── the world ────────────────────────────────────────────────────────────────

const world = mkdtempSync(join(tmpdir(), "postmark-mark-carried-"));
after(() => rmSync(world, { recursive: true, force: true }));
let clock = Date.parse("2026-09-20T06:00:00Z");
const git = (...a) => execFileSync("git", ["-C", world, ...a], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_COMMITTER_DATE: new Date(clock).toISOString(), GIT_AUTHOR_DATE: new Date(clock).toISOString(), TZ: "UTC" },
});
const put = (p, t) => { const f = join(world, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const markPath = (id) => `WORLD/marks/${id}/mark.md`;
// Each body unlike every other: `--follow` pairs a new file with a similar old
// one as a rename, so three-line twins would follow into each other's history.
const body = (id, note) => `---\nby: ${id.split("/")[0]}\n---\n${id}: ${note}\n`
  + [...id].map((ch, i) => `${i} ${ch.charCodeAt(0) * (i + 7)} ${id.split("").reverse().join("")}`).join("\n") + "\n";
const ids = new Set();
function settle(n, { add = [], amend = [], listOnly = [], letGo = [] } = {}) {
  for (const id of letGo) { rmSync(join(world, markPath(id))); ids.delete(id); }
  for (const id of add) { put(markPath(id), body(id, "declared")); ids.add(id); }
  for (const id of amend) put(markPath(id), body(id, `amended at S${n}`));
  for (const id of listOnly) ids.add(id);
  put("WORLD/world-state.json", JSON.stringify({ marks: [...ids].sort().map((id) => ({ id })) }, null, 1));
  git("add", "-A");
  git("-c", "user.name=crossing", "-c", "user.email=c@t.invalid", "commit", "-q", "-m", `settlement: S${n}`);
  git("-c", "user.name=the Worldkeeper", "-c", "user.email=k@t.invalid", "tag", "-a", "-m", `S${n}`, `settlement/S${n}`);
  clock += 12 * 3600e3;
}
git("init", "-q", "-b", "main");
put("WORLD/README.md", "the world\n");
settle(1, { add: ["wright/the-lamp"] });
settle(2, { add: ["wright/the-gate"], amend: ["wright/the-lamp"], listOnly: ["wright/no-file-at-all"] });

// ── the store ────────────────────────────────────────────────────────────────

const store = await startStore({ db: "mark_carried_test" });
const skip = store.skip ?? false;
after(async () => { if (!skip) await store.stop(); });

// ── the pure half ────────────────────────────────────────────────────────────

test("plan: no row + an answer whose settlement has a row is `new`; one whose settlement has none is `unsettled`", () => {
  const plan = planCarried(
    [{ mark: "a/x", settlement: 3, added_sha: "1".repeat(40) }, { mark: "a/y", settlement: 9, added_sha: "2".repeat(40) }],
    [], [1, 2, 3]);
  assert.deepEqual(plan.map((p) => p.state), ["new", "unsettled"]);
});

test("plan: a row equal to 1.0's answer is `present`; a row naming another settlement is CONFLICT, never rewritten", () => {
  const plan = planCarried(
    [{ mark: "a/x", settlement: 3 }, { mark: "a/y", settlement: 4 }],
    [{ mark: "a/x", settlement: 3 }, { mark: "a/y", settlement: 2 }], [2, 3, 4]);
  assert.deepEqual(plan.map((p) => [p.state, p.have ?? null]), [["present", null], ["CONFLICT", 2]]);
});

test("plan: a mark 1.0 cannot answer gets no row, and a row 1.0 can no longer answer is DRIFT", () => {
  const plan = planCarried([{ mark: "a/x", state: "nopath" }, { mark: "a/y", state: "underivable" }, { mark: "a/z", state: "nopath" }],
    [{ mark: "a/z", settlement: 1 }], [1]);
  assert.deepEqual(plan.map((p) => p.state), ["nopath", "underivable", "DRIFT"]);
});

test("the receipt check compares S-number, the whole sha, and the date, and names each that differs", () => {
  const row = { settlement: 5, tag_sha: "a".repeat(40), published_at: new Date("2026-09-29T18:00:43Z") };
  const ok = { status: "published", crossing: { s: 5, sha: "a".repeat(40), at: "2026-09-29T18:00:43Z" } };
  assert.deepEqual(receiptDisagreement(row, ok, null), []);
  const bad = { status: "published", crossing: { s: 4, sha: "b".repeat(40), at: "2026-09-29T18:00:44Z" } };
  assert.equal(receiptDisagreement(row, bad, null).length, 3);
  // 1.0 names no date beyond its 20 newest tags: the tag's own date stands in.
  const old = { status: "published", crossing: { s: 5, sha: "a".repeat(40), at: null } };
  assert.deepEqual(receiptDisagreement(row, old, "2026-09-29T14:00:43-04:00"), []);
  assert.equal(receiptDisagreement(row, old, null).length, 1, "no date anywhere is a disagreement, never a pass");
  assert.match(receiptDisagreement(row, { status: "published", crossing: { n: 5, sha: "a" } }, null)[0], /names no carrying settlement/);
});

/** The settlements rows from the repo's tags, as settlements-backfill derives them. */
async function settleRows(c) {
  for (const r of settlementRowsFrom(readTagLines(world)))
    await c.query("INSERT INTO settlements (number, tag_sha, published_at, blessed_at) VALUES ($1, $2, $3, $4) ON CONFLICT (number) DO NOTHING",
      [r.number, r.tag_sha, r.published_at, r.blessed_at]);
}
async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }
async function asApi(fn) { const c = await store.connect("office_api"); try { return await fn(c); } finally { await c.end(); } }
const carriedRows = () => owner(async (c) => (await c.query("SELECT mark, settlement FROM mark_carried ORDER BY mark")).rows.map((r) => `${r.mark}@S${r.settlement}`));

test("the backfill refuses on a planted disagreement — a settlements row whose sha is not the tag's — and writes nothing", { skip }, async () => {
  await owner(async (c) => {
    await c.query("TRUNCATE mark_carried, settlements");
    await settleRows(c);
    await c.query("UPDATE settlements SET tag_sha = $1 WHERE number = 2", ["f".repeat(40)]);
  });
  const r = await asApi((c) => recordCarried(c, world, { apply: true }));
  assert.equal(r.verdict, "DISAGREE");
  assert.deepEqual(r.disagree.map((d) => d.mark), ["wright/the-gate"], "the row riding S2 is the one whose sha disagrees with 1.0's receipt");
  assert.match(r.disagree[0].why.join(" "), /^sha: 1\.0 [0-9a-f]{8}, row ffffffff/);
  assert.deepEqual(await carriedRows(), [], "one disagreement rolls back the whole write, the agreeing row included");
  assert.match(receiptLine(r), /^carried: REFUSED, nothing written/);
});

test("the backfill fills every answerable mark from 1.0's answer, and the one with no file stays without a row", { skip }, async () => {
  await owner(async (c) => { await c.query("TRUNCATE mark_carried, settlements"); await settleRows(c); });
  const r = await asApi((c) => recordCarried(c, world, { apply: true }));
  assert.equal(r.verdict, "ok");
  assert.deepEqual(await carriedRows(), ["wright/the-gate@S2", "wright/the-lamp@S1"], "the amended lamp is S1's, not the amend's");
  assert.equal(r.nopath, 1, "wright/no-file-at-all has no filed path: no row, never a guess");
  const v = await asApi((c) => verifyCarried(c, world));
  assert.equal(v.verdict, "ok", JSON.stringify(v.disagree));
});

test("a newly blessed settlement records exactly the marks it newly carried, on the tick's capped call", { skip }, async () => {
  settle(3, { add: ["wright/the-well", "keemin/the-bench"] });
  await owner((c) => settleRows(c));
  const r = await asApi((c) => recordCarried(c, world, { apply: true, cap: TICK_CAP }));
  assert.equal(r.verdict, "ok");
  assert.deepEqual(r.by_settlement, { 3: 2 });
  assert.deepEqual(await carriedRows(), ["keemin/the-bench@S3", "wright/the-gate@S2", "wright/the-lamp@S1", "wright/the-well@S3"]);
});

test("a re-bless never overwrites: S4 amends a recorded mark and its row stays S1; the pen holds no UPDATE", { skip }, async () => {
  settle(4, { amend: ["wright/the-lamp", "wright/the-well"] });
  await owner((c) => settleRows(c));
  const r = await asApi((c) => recordCarried(c, world, { apply: true, cap: TICK_CAP }));
  assert.equal(r.wrote, 0);
  assert.deepEqual(await carriedRows(), ["keemin/the-bench@S3", "wright/the-gate@S2", "wright/the-lamp@S1", "wright/the-well@S3"]);
  await asApi(async (c) => {
    await assert.rejects(c.query("UPDATE mark_carried SET settlement = 4 WHERE mark = 'wright/the-lamp'"), (e) => e.code === "42501");
    await assert.rejects(c.query("DELETE FROM mark_carried WHERE mark = 'wright/the-lamp'"), (e) => e.code === "42501");
  });
});

test("the tick's cap skips a store the backfill has not reached, and says which tool to run", { skip }, async () => {
  await owner((c) => c.query("TRUNCATE mark_carried"));
  const r = await asApi((c) => recordCarried(c, world, { apply: true, cap: 2 }));
  assert.equal(r.verdict, "skipped");
  assert.match(receiptLine(r), /4 published marks with a path have no row.*mark-carried-backfill\.mjs --apply/);
  assert.deepEqual(await carriedRows(), []);
  await asApi((c) => recordCarried(c, world, { apply: true }));     // restore for the twin cases
});

test("the twin equals 1.0 on a published mark: crossing, settlement_sha and says, with nothing declared", { skip }, async () => {
  const { default: pg } = await import("pg");
  const p = new pg.Pool({ connectionString: store.url("office_api"), max: 2 });
  try {
    const sha = git("rev-parse", "settlement/S4^{commit}").trim();
    for (const id of ["wright/the-lamp", "wright/the-gate", "keemin/the-bench"]) {
      const one = await readMarkReceipt(id, { repo: world, canon: { id }, publishedSha: sha });
      const two = await twinReceipt(p, id, { standing: true });
      assert.equal(two.status, "published");
      assert.deepEqual(two.crossing, one.crossing, `${id}: crossing`);
      assert.equal(two.settlement_sha, one.settlement_sha, `${id}: settlement_sha`);
      assert.equal(two.says, one.says, `${id}: says`);
      assert.ok(!Object.keys(receiptTreeOnly(two)).some((k) => k.includes("receipt.crossing")), `${id}: no crossing field is declared once the row answers it`);
    }
    assert.match((await twinReceipt(p, "wright/the-lamp", { standing: true })).says, /^published at S1 \([0-9a-f]{8}\) on 2026-09-20T06:00:00Z$/);
    // A published mark with no row keeps the declaration.
    const none = await twinReceipt(p, "wright/no-file-at-all", { standing: true });
    assert.equal(none.crossing, null);
    assert.match(none.says, /not recorded in the store/);
    assert.ok(Object.keys(receiptTreeOnly(none)).includes("receipt.crossing · receipt.settlement_sha · receipt.says"));
  } finally { await p.end(); }
});

test("a mark let go keeps its row: the verify counts it kept and compares only what is still published", { skip }, async () => {
  settle(5, { letGo: ["wright/the-gate"] });
  await owner((c) => settleRows(c));
  const r = await asApi((c) => recordCarried(c, world, { apply: true, cap: TICK_CAP }));
  assert.equal(r.wrote, 0);
  assert.ok((await carriedRows()).includes("wright/the-gate@S2"), "the fact that S2 carried it does not end");
  const v = await asApi((c) => verifyCarried(c, world));
  assert.equal(v.verdict, "ok", JSON.stringify(v.disagree));
  assert.equal(v.kept, 1);
  assert.equal(v.compared, 3);
});
