// the-bless-overrides-the-tick.test.mjs — the READ tier serves the newest
// blessing, never main's candidate (Keemin, 2026-09-18; postmark#2934).
//
// THE LAW, from the ruling: "the candle burns live in the store; the clearing
// at the close LOCKS standing; the sweep materialises the receipt; the bless is
// judgment on the receipt. The doors' standing should follow the last state a
// judgment accepted; the docket is untouched."
//
// THE INSTANCE: on 2026-09-18 the morning crossing committed Berthillon's shop
// at (167, 16) to world main (`094fa254`, unblessed) while `settlement/S71`
// (`1984062f`) still had it at (221, 95.5). The doors served main; the viewer,
// the site, the drain and live claims waited for the keeper. Two truths.
//
// THE FIXTURE is the falsifier the brief names: a clone with `settlement/S1`
// at C1 and main at C2. Every read-tier site must answer at C1 and the header
// must name S1 with C2 as the candidate ahead. Restoring `freshestMainRef` at
// any one site reds that site's test below.
//
// The one site that STAYS on main is named here so nobody "fixes" it:
// `dynamic-entities.mjs § worldToolModule` feeds the LIVE reads (presence,
// walkers-now) whose physics must match the pen writing on main this minute.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import {
  blessed, blessedRef, blessedSha, freshestMainRef, mainRef,
  publishedState, publishedSkeleton, draftDeltaForKey, materializeAtRef,
} from "../src/world-branches.mjs";
import { servedCanonSha, publishedMainSha, worldStoreHealth } from "../src/world-serve.mjs";
import { latestSettlement } from "../src/world-happened.mjs";
import {
  newestSettlementFromRefLines, NEWEST_SETTLEMENT_FORMAT, nextSettlementAttemptAt, SETTLEMENT_HOURS_UTC,
} from "../src/settlements.mjs";

const repo = mkdtempSync(join(tmpdir(), "postmark-blessed-"));
const cache = mkdtempSync(join(tmpdir(), "postmark-blessed-engine-"));
after(() => { rmSync(repo, { recursive: true, force: true }); rmSync(cache, { recursive: true, force: true }); });

const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const commit = (m) => git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", m);
const sha = (ref) => git("rev-parse", `${ref}^{commit}`).trim();
const stateWith = (marks) => JSON.stringify({ marks });

// ── C1: the blessed world — Berthillon's shop at home ───────────────────────
put("WORLD/world-state.json", stateWith([
  { id: "berthillon/le-petit-berthillon", by: "berthillon", kind: "sited", at: { x: 221, y: 95.5 }, tier: "home" },
]));
put("WORLD/skeleton.json", JSON.stringify({ regions: ["the-town-centre"] }));
put("tools/engine.mjs", 'export const WORLD = "C1";\n');
git("init", "-q", "-b", "main");
git("add", "-A");
commit("settlement: sweep 1 published, 0 unpublished");
const C1 = sha("refs/heads/main");

// ── C2: the crossing's candidate — the shop moved to market, not yet judged ──
put("WORLD/world-state.json", stateWith([
  { id: "berthillon/le-petit-berthillon", by: "berthillon", kind: "sited", at: { x: 167, y: 16 }, tier: "market" },
  { id: "someone/a-new-mark", by: "someone", kind: "sited", at: { x: 1, y: 1 }, tier: "market" },
]));
put("WORLD/skeleton.json", JSON.stringify({ regions: ["the-town-centre", "the-harbour"] }));
put("tools/engine.mjs", 'export const WORLD = "C2";\n');
git("add", "-A");
commit("crossing-save 2: the candidate");
const C2 = sha("refs/heads/main");
git("update-ref", "refs/remotes/origin/main", C2);

// the pen parks the checkout on a draft branch, as it does after every write
git("switch", "-q", "--detach", C2);
git("switch", "-q", "-c", "draft/somebody");
put("WORLD/world-state.json", stateWith([
  { id: "berthillon/le-petit-berthillon", by: "berthillon", kind: "sited", at: { x: 167, y: 16 }, tier: "market" },
  { id: "someone/a-new-mark", by: "someone", kind: "sited", at: { x: 1, y: 1 }, tier: "market" },
  { id: "somebody/a-sketch", by: "somebody", kind: "sited", at: { x: 2, y: 2 }, tier: "market" },
]));
// the delta diffs WORLD/marks records, not the fold — a sketch is a mark.md on the branch
put("WORLD/marks/the-town-centre/a-sketch/mark.md", ["---", "by: somebody", "kind: sited", "at: { x: 2, y: 2 }", "---", "a sketch", ""].join("\n"));
git("add", "-A");
commit("a household's sketchbook");
git("update-ref", "refs/remotes/origin/draft/somebody", sha("refs/heads/draft/somebody"));

test("RED CONTROL: the fixture is the box — main at the candidate, the tree on a draft, no tag yet", () => {
  assert.notEqual(C1, C2);
  assert.equal(sha("refs/heads/main"), C2);
  assert.equal(sha("refs/remotes/origin/main"), C2);
  assert.equal(git("rev-parse", "--abbrev-ref", "HEAD").trim(), "draft/somebody");
  assert.equal(git("tag", "--list", "settlement/S*").trim(), "", "no settlement tag yet — the fallback is tested first");
});

// ── the fallback: no tag at all serves main and SAYS so ─────────────────────

test("FALLBACK: a clone with no settlement tag serves freshestMainRef and discloses it", () => {
  const b = blessed(repo);
  assert.equal(b.source, "main");
  assert.equal(b.ref, freshestMainRef(repo));
  assert.equal(b.sha, C2);
  assert.equal(b.n, null);
  assert.equal(b.candidate_ahead, null, "with no blessing there is no candidate to be ahead of");
  assert.match(String(b.disclosed), /no settlement tag/);
  assert.equal(publishedState(repo).sha, C2, "the old law holds exactly where there is nothing to bless");
});

// ── the bless: an ANNOTATED tag at C1, main still at C2 ─────────────────────

test("the keeper blesses C1 (annotated tag, as all 71 real ones are)", () => {
  git("-c", "user.name=keeper", "-c", "user.email=k@t.invalid", "tag", "-a", "-m", "S1", "settlement/S1", C1);
  assert.equal(git("cat-file", "-t", "settlement/S1").trim(), "tag", "the fixture must carry a tag OBJECT, not a lightweight ref");
  assert.notEqual(git("rev-parse", "settlement/S1").trim(), C1, "the tag object's own sha is not the commit — that is the peel this lane tests");
});

test("blessed(): the newest settlement, peeled to its commit, with main named as the candidate ahead", () => {
  const b = blessed(repo);
  assert.equal(b.source, "settlement");
  assert.equal(b.n, 1);
  assert.equal(b.tag, "settlement/S1");
  assert.equal(b.ref, "refs/tags/settlement/S1");
  assert.equal(b.sha, C1, "peeled: the commit the tag blesses, never the tag object");
  assert.equal(b.main_sha, C2);
  assert.equal(b.candidate_ahead, C2, "main holds a candidate the keeper has not accepted — the header must say so");
  assert.equal(b.disclosed, null);
  assert.equal(blessedRef(repo), b.ref);
  assert.equal(blessedSha(repo), C1);
});

test("mainRef and freshestMainRef are UNCHANGED — the pen still forks from main", () => {
  assert.equal(mainRef(repo), "refs/heads/main");
  assert.equal(sha(freshestMainRef(repo)), C2);
  assert.equal(publishedMainSha(repo), C2, "publishedMainSha still names main's line; it is what `candidate_ahead` reports");
});

// ── the seven sites, one by one ─────────────────────────────────────────────

test("SITE publishedState: the marks a door serves are the blessed world's — Berthillon's shop at (221, 95.5)", () => {
  const ps = publishedState(repo);
  assert.equal(ps.ref, "refs/tags/settlement/S1");
  assert.equal(ps.sha, C1);
  const shop = ps.state.marks.find((m) => m.id === "berthillon/le-petit-berthillon");
  assert.deepEqual(shop.at, { x: 221, y: 95.5 }, "the doors stand on the last state a judgment accepted");
  assert.equal(shop.tier, "home");
  assert.ok(!ps.state.marks.some((m) => m.id === "someone/a-new-mark"), "a mark the crossing committed but nobody blessed is not on the doors");
  assert.equal(ps.blessed.candidate_ahead, C2, "and the answer carries the record the header is built from");
});

test("SITE publishedSkeleton: terrain follows the same blessing — one world, not two", () => {
  const sk = publishedSkeleton(repo);
  assert.equal(sk.ref, "refs/tags/settlement/S1");
  assert.deepEqual(sk.skeleton.regions, ["the-town-centre"]);
});

test("SITE householdDelta (draftDeltaForKey): a draft is diffed against the BLESSED canon", () => {
  const key = { household: "somebody", handles: new Set(["somebody"]) };
  const d = draftDeltaForKey(repo, key);
  assert.equal(d.main, C1, "the base a household's delta is measured from is the blessed sha");
  const ids = d.marks.map((m) => m.id).sort();
  assert.ok(ids.includes("somebody/a-sketch"), "the household's own sketch is in its delta");
});

test("SITE materializeAtRef: a tag ref materialises the COMMIT it blesses (the peel), cached by that sha", () => {
  const dir = materializeAtRef(repo, "refs/tags/settlement/S1", "tools", cache);
  assert.ok(basename(dir).startsWith(C1), `cache dir must be keyed on the commit ${C1.slice(0, 8)}, got ${basename(dir)}`);
  assert.equal(readFileSync(join(dir, "tools", "engine.mjs"), "utf8").trim(), 'export const WORLD = "C1";');
  const stamp = readFileSync(join(dir, ".materialized"), "utf8").split("\n");
  assert.equal(stamp[0], C1);
});

test("SITE engineDir / world2-serve engine: materialising at blessedRef hands back the blessed engine, not main's", () => {
  // Both call `materializeAtRef(WORLD_CLONE, blessedRef(WORLD_CLONE), "tools")`;
  // this is that call with the fixture as WORLD_CLONE.
  const dir = materializeAtRef(repo, blessedRef(repo), "tools", cache);
  assert.equal(readFileSync(join(dir, "tools", "engine.mjs"), "utf8").trim(), 'export const WORLD = "C1";');
  const mainDir = materializeAtRef(repo, freshestMainRef(repo), "tools", cache);
  assert.equal(readFileSync(join(mainDir, "tools", "engine.mjs"), "utf8").trim(), 'export const WORLD = "C2";',
    "the flip's shape: main's engine is C2's — a site restored to freshestMainRef would serve this");
});

test("SITE world-happened latestSettlement: names the blessed ref and its number", () => {
  const s = latestSettlement(repo);
  assert.ok(s, "a settlement commit exists at C1");
  assert.equal(s.ref, "refs/tags/settlement/S1");
  assert.equal(s.sha, C1.slice(0, s.sha.length));
  assert.equal(s.s, 1);
});

// ── the gates: the store is fresh at the BLESSED sha, stale at main's ────────

test("GATE servedCanonSha: every freshness gate compares to the blessed sha", () => {
  assert.equal(servedCanonSha(repo), C1);
  assert.notEqual(servedCanonSha(repo), publishedMainSha(repo), "and it is not main's — that is the whole change");
});

test("GATE worldStoreHealth: the panel names the blessing, the candidate ahead, and the next attempt", () => {
  const h = worldStoreHealth({ repo });
  assert.equal(h.blessed.as_of_settlement, "S1");
  assert.equal(h.blessed.sha, C1);
  assert.equal(h.blessed.candidate_ahead, C2);
  assert.equal(h.main.sha, C2);
  assert.equal(h.main.ahead_of_blessed, true);
  assert.match(h.blessed.next_attempt_at, /^\d{4}-\d{2}-\d{2}T(06|18):00:00\.000Z$/, "the chip's clock: 06:00 or 18:00 UTC");
  assert.match(h.eligibility, /blessed reads only/);
});

// ── the hydrate stamps what it served ───────────────────────────────────────

test("HYDRATE --ref blessed: the store stands on the blessed sha and stamps the tag + the candidate", { timeout: 180_000 }, (t) => {
  const WORLD = process.env.WORLD_CLONE;
  if (!WORLD || !existsSync(join(WORLD, "WORLD", "marks"))) return t.skip("no WORLD_CLONE with WORLD/marks — the hydrate needs a real world tree");
  const b = blessed(WORLD);
  if (b.source !== "settlement") return t.skip("WORLD_CLONE carries no settlement tag");
  // The hydration's rows (--rows-out): the meta the store's snapshot is keyed by.
  const db = join(mkdtempSync(join(tmpdir(), "postmark-blessed-db-")), "rows.json");
  execFileSync(process.execPath, ["src/world-hydrate.mjs", "--world", WORLD, "--ref", "blessed", "--no-db", "--rows-out", db, "--no-gexf", "--no-lints"],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  const meta = Object.fromEntries(JSON.parse(readFileSync(db, "utf8")).meta.map((r) => [r.key, r.value]));
  assert.equal(meta.as_of_world, b.sha, "hydrated at the blessed commit");
  assert.equal(meta.world_ref, b.ref);
  assert.equal(meta.as_of_settlement, `S${b.n}`);
  assert.equal(meta.candidate_ahead, b.candidate_ahead ?? "");
  if (b.candidate_ahead) assert.notEqual(meta.as_of_world, b.main_sha, "main is ahead and the store did NOT follow it — the tick no longer wins");
  rmSync(dirname(db), { recursive: true, force: true });
});

test("the tick asks for the blessing by name", () => {
  const tick = readFileSync(new URL("../deploy/office-rehydrate.sh", import.meta.url), "utf8");
  assert.match(tick, /world-hydrate\.mjs --world "\$WORLD_CLONE" --ref blessed /, "deploy/office-rehydrate.sh hydrates --ref blessed");
  assert.doesNotMatch(tick, /--ref origin\/main/, "the old ref is gone from the tick");
});

// ── a later bless moves the doors; a lightweight tag peels too ───────────────

test("a bless of C2 moves the doors to C2 and clears the candidate (lightweight tag: the object IS the commit)", () => {
  git("tag", "settlement/S2", C2);
  const b = blessed(repo);
  assert.equal(b.n, 2);
  assert.equal(b.sha, C2);
  assert.equal(b.candidate_ahead, null, "nothing is ahead once the candidate is blessed");
  assert.deepEqual(publishedState(repo).state.marks.find((m) => m.id === "berthillon/le-petit-berthillon").at, { x: 167, y: 16 });
  git("tag", "-d", "settlement/S2");
  assert.equal(blessed(repo).sha, C1, "fixture restored");
});

// ── the pure halves ─────────────────────────────────────────────────────────

test("newestSettlementFromRefLines: NUMERIC order (S10 over S9), peeled atom last, lightweight falls back to the object", () => {
  const lines = [
    "settlement/S9 tagobj9 commit9",
    "settlement/S10 commit10",            // lightweight: no peeled atom
    "settlement/S7 tagobj7 commit7",
    "not-a-settlement/S99 x y",
    "",
  ].join("\n");
  assert.deepEqual(newestSettlementFromRefLines(lines), { n: 10, tag: "settlement/S10", sha: "commit10" });
  assert.equal(newestSettlementFromRefLines(""), null);
  assert.equal(newestSettlementFromRefLines("settlement/S1"), null, "a tag with no object at all contributes nothing");
  assert.equal(NEWEST_SETTLEMENT_FORMAT.split(" ").at(-1), "%(*objectname)", "the optional atom is LAST — for-each-ref emits it empty for a lightweight tag");
});

test("the real clone's tag list, through one for-each-ref, agrees with settlements()' reading", (t) => {
  const WORLD = process.env.WORLD_CLONE;
  if (!WORLD || !existsSync(join(WORLD, ".git"))) return t.skip("no WORLD_CLONE");
  const b = blessed(WORLD);
  if (b.source !== "settlement") return t.skip("no settlement tag in WORLD_CLONE");
  const full = execFileSync("git", ["-C", WORLD, "rev-parse", `${b.tag}^{commit}`], { encoding: "utf8" }).trim();
  assert.equal(b.sha, full);
  const all = execFileSync("git", ["-C", WORLD, "tag", "--list", "settlement/S*"], { encoding: "utf8" })
    .split("\n").map((s) => Number(/^settlement\/S(\d+)$/.exec(s.trim())?.[1])).filter(Number.isInteger);
  assert.equal(b.n, Math.max(...all), "newest by NUMBER over every tag the clone holds");
});

test("nextSettlementAttemptAt: the chip's clock — 06:00 / 18:00 UTC, never 'now'", () => {
  assert.deepEqual(SETTLEMENT_HOURS_UTC, [6, 18]);
  assert.equal(nextSettlementAttemptAt(Date.parse("2026-09-18T13:10:00Z")), "2026-09-18T18:00:00.000Z");
  assert.equal(nextSettlementAttemptAt(Date.parse("2026-09-18T18:00:00Z")), "2026-09-19T06:00:00.000Z", "standing on the boundary means the NEXT one");
  assert.equal(nextSettlementAttemptAt(Date.parse("2026-09-18T02:00:00Z")), "2026-09-18T06:00:00.000Z");
});
