// parcel-over-a-painted-house.test.mjs — the sovereignty guard's retirement,
// on BOTH doors (postmark#3025, hotfix w39.4).
//
// WHAT WENT. Both leave-mark executors read the world's `seeding/manifest.json`
// — the July atlas painting, 88 households — and refused a parcel claim whose
// whole footprint lay inside another household's PAINTED house: 403 "that spot
// is inside <household>'s home". Kept on purpose when the sovereign-interior
// rule was repealed for sited marks (2026-08-17), on the reasoning that
// claiming ground inside another's walls is a land claim, not a gift.
//
// WHY IT GOES, MEASURED BEFORE IT WAS DELETED (live fold, `settlement/S74`).
// The guard's test is CONTAINMENT and a claim is a full 25 m town dial, so it
// can only fire on a house at least 25 m on both sides. Of the 74 painted
// houses still standing in the record, exactly FOUR are — and all four are the
// household's own PARCEL wearing a house's name (kai/the-working-window,
// milo/the-purple-door, rowan-archive/the-violet-archive, vellix/casa-nera).
// Every genuinely sited painted house is smaller than the dial; the largest is
// 30x22. So over the live record this guard refuses NOTHING that
// `tools/marks-fold.mjs § admissibility` does not already refuse by the wider
// test: "parcel overlaps <id> — inadmissible (MARKS.md § Parcels)".
//
// The ground it was imagined to protect is empty too: zero of the 74 overlap no
// parcel at all. The Snug harbour — the mark that opened #3025 — is 30x22 on
// spar's coast and reads MARKET in the fold; the guard never refused a claim
// over it (22 < 25, no containment), and the fold refuses one anyway, because
// current-the-reader's own parcel `the-keepers-flat` overlaps that ground.
//
// THE ONE REAL CHANGE is WHEN a claimant hears no, and only over those four
// parcels: a door 403 becomes a crossing inadmissibility. LEG 3 is why that is
// not a new hole — this door has never carried an overlap check of its own, so
// a claim over a neighbour's parcel has always been admitted here and refused
// at the crossing. The office now tells one story about overlapping ground.
//
// THE CAN-FAIL FLIP: restore either guard and LEG 1 (journal door) or LEG 2
// (git-era door) reds with the 403. LEG 3 is green on both sides and is
// labelled a non-regression, not a discriminator. Flip receipt in the PR.
//
// LEGS 1 AND 3 MOVED to the end of `test/world-journal.test.mjs` on the w40
// train, where the journal door's store harness lives. LEG 2 stays here.
//
//   node --test test/parcel-over-a-painted-house.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXEC = join(ROOT, "src", "leave-exec.mjs");
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };

const repo = mkdtempSync(join(tmpdir(), "postmark-3025-repo-"));
const scratch = mkdtempSync(join(tmpdir(), "postmark-3025-db-"));
after(() => { sweep(repo); sweep(scratch); });

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// ── the world in a bottle ────────────────────────────────────────────────────
//
// `neighbour` is painted into the manifest with a house that is BIG (60x60, so
// a 25 m claim genuinely fits inside it — the guard's own precondition, which
// no real house in the record meets) and stands OFF any parcel, out on the
// town's frame. That is exactly the ground the brief called common by the
// standing law, and the only shape where the guard could ever have been the
// sole refusal. `neighbour` also holds an ordinary parcel elsewhere, for LEG 3.
const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", household: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 8000, h: 8000 }, body: "the world frame" },
  { id: "neighbour/the-big-house", by: "neighbour", household: "neighbour", kind: "sited", tier: "market", at: { x: 2000, y: 2000 }, extent: { w: 60, h: 60 }, body: "a painted house, standing on no parcel of anyone's" },
  { id: "neighbour/the-neighbour-parcel", by: "neighbour", household: "neighbour", kind: "parcel", tier: "home", at: { x: 100, y: 100 }, extent: { w: 25, h: 25 }, body: "the ground neighbour holds" },
];

const record = (by, kind, body, x, y, w, h) =>
  `---\nkind: ${kind}\nby: ${by}\ndate: 2026-08-01\nat: { x: ${x}, y: ${y} }\nextent: { w: ${w}, h: ${h} }\n---\n\n${body}\n`;

put("tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function parcelsFor(handle, world) { return (world?.parcels ?? []).filter((p) => p.household === handle); }
export function homeOf(handle, world) {
  const parcel = parcelsFor(handle, world)[0] ?? null;
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel,
           household_parcels: parcelsFor(handle, world).map((p) => p.id) };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
export function publicResidents() { return []; }
`);
put("tools/world-verbs.mjs", `
export function containmentChain(pos, marks) {
  return (marks ?? [])
    .filter((m) => m.at && m.extent && Math.abs(pos.x - m.at.x) <= m.extent.w / 2 && Math.abs(pos.y - m.at.y) <= m.extent.h / 2)
    .sort((a, b) => (b.extent.w * b.extent.h) - (a.extent.w * a.extent.h))
    .map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body }));
}
export function orient() { return { seen: [] }; }
export function investigate() { return null; }
`);
// THE ENGINE, in miniature — the names both executors import, and nothing more.
// DOUBLE EVERY BACKSLASH: this goes out through an untagged template literal.
put("tools/marks-fold.mjs", `
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
export function loadMarks(dir) {
  const out = [];
  (function walk(at) {
    if (!existsSync(at)) return;
    const entries = readdirSync(at);
    if (entries.includes("mark.md")) {
      const text = readFileSync(join(at, "mark.md"), "utf8");
      const by = text.match(/^by:\\s*(.+)$/m)?.[1]?.trim();
      const kind = text.match(/^kind:\\s*(.+)$/m)?.[1]?.trim() ?? "sited";
      const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
      const ax = num(/^at:\\s*\\{\\s*x:\\s*(-?[0-9.]+)/m), ay = num(/^at:.*?y:\\s*(-?[0-9.]+)/m);
      const ew = num(/^extent:\\s*\\{\\s*w:\\s*(-?[0-9.]+)/m), eh = num(/^extent:.*?h:\\s*(-?[0-9.]+)/m);
      out.push({ by, household: by, kind, slug: basename(at), id: by + "/" + basename(at), _dir: at,
        body: text.split(/---\\r?\\n/).at(-1).trim(),
        ...(ax !== null && ay !== null ? { at: { x: ax, y: ay } } : {}),
        ...(ew !== null && eh !== null ? { extent: { w: ew, h: eh } } : {}) });
    }
    for (const e of entries) {
      const next = join(at, e);
      if (e !== "mark.md" && statSync(next).isDirectory()) walk(next);
    }
  })(dir);
  return out;
}
export const PARCEL_EXTENT_M = 25;
export const PARCEL_CLAIM_CAP = 3;
export const PARCEL_CAP_LAW_DATE = "2026-07-30";
// The guard's own test, faithful to the real one: the CLAIM must sit wholly
// inside the house. A 25 m dial fits inside 60x60 and does not fit inside the
// 30x22 the real record's largest painted house actually is.
export function marksContain(outer, inner) {
  if (!outer?.at || !outer?.extent || !inner?.at) return false;
  const iw = (inner.extent?.w ?? 0) / 2, ih = (inner.extent?.h ?? 0) / 2;
  return Math.abs(inner.at.x - outer.at.x) + iw <= outer.extent.w / 2
      && Math.abs(inner.at.y - outer.at.y) + ih <= outer.extent.h / 2;
}
export const WORLD_ROOT_SLUG = "let-there-be-light";
export const worldRootOf = (marks) => marks.find((m) => m.slug === WORLD_ROOT_SLUG) ?? null;
export function placementParent(claim, marks) {
  const area = (m) => (m?.extent?.w ?? 0) * (m?.extent?.h ?? 0);
  const mine = area(claim);
  let best = null;
  for (const m of marks) {
    if (m.id === claim.id || !m.at || !m.extent) continue;
    if (m.slug === WORLD_ROOT_SLUG) continue;
    if (area(m) <= mine) continue;
    if (marksContain(m, claim) && (!best || area(m) < area(best))) best = m;
  }
  return best ? best.id : null;
}
export function containmentParentOf(id, marks) { return containmentParents(marks).parent.get(id) ?? null; }
export function containmentParents(marks) {
  const root = worldRootOf(marks);
  const parent = new Map();
  for (const m of marks) {
    if (m === root) { parent.set(m.id, null); continue; }
    parent.set(m.id, placementParent(m, marks) ?? root?.id ?? null);
  }
  return { parent, rootId: root?.id ?? null };
}
`);

// THE PAINTING IS PRESENT IN THE FIXTURE, and that is the point: the office
// must stop CONSULTING it, not merely survive its absence. On main this file is
// what reds LEG 1 and LEG 2.
put("seeding/manifest.json", JSON.stringify({
  homes: [{ household: "neighbour", home_id: "the-big-house", title: "the Big House" }],
}));
put("WORLD/households.json", JSON.stringify({ households: { neighbour: "gh:11", claimant: "gh:22" } }));
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: PUBLISHED,
  parcels: PUBLISHED.filter((m) => m.kind === "parcel").map((m) => ({ id: m.id, household: m.by, at: m.at, extent: m.extent })),
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));
put("WORLD/marks/let-there-be-light/mark.md", record("the-town", "sited", "the world frame", 0, 0, 8000, 8000));
put("WORLD/marks/neighbour/the-big-house/mark.md", record("neighbour", "sited", "a painted house on nobody's parcel", 2000, 2000, 60, 60));
put("WORLD/marks/neighbour/the-neighbour-parcel/mark.md", record("neighbour", "parcel", "the ground neighbour holds", 100, 100, 25, 25));

git("init", "-q", "-b", "main");
git("config", "user.email", "test@postmark.town");
git("config", "user.name", "3025 falsifier");
git("add", "-A");
git("commit", "-qm", "canon: one painted house off every parcel, one ordinary parcel beside it");
git("branch", "-q", "draft/claimanthouse");

process.env.WORLD_CLONE = repo;
process.env.WORLD_SINGLE_LOG = "1";
process.env.WORLD_DYNAMIC_DB = join(scratch, "dynamic.db");
process.env.W2_GUARDS = "";
process.env.W2_PEN = "";
process.env.TOWN_PUSH = "";

const CLAIMANT = { household: "claimanthouse", handles: new Set(["claimant"]) };

/** The git-era executor, spawned exactly as world.mjs spawns it. */
function execLeave(payload) {
  const r = spawnSync(process.execPath, [EXEC, JSON.stringify(payload)], {
    encoding: "utf8",
    env: { ...process.env, WORLD_CLONE: repo, TOWN_PUSH: "", WORLD_POOL_SLOT: "", WORLD_SHARED_CLONE: "",
           BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid" },
  });
  assert.equal(r.status, 0, `the executor tripped: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
}

// ── LEGS 1 AND 3 · the journal door ─────────────────────────────────────────
//
// They live in `test/world-journal.test.mjs`, at its end, since the w40 train
// (main-into-w40, 2026-09-25). On the train the journal door reads and writes
// the store (POS-156, G1) with no sqlite fallback, so they run on that file's
// hand-built store: the same claims and assertions, one more that the write
// reached the store, and the same can-fail flip.

// ── LEG 2 · the git-era twin, so the two holders cannot disagree (#2888) ─────

test("THE FIX, git-era door: the same claim, the same answer — one law, both holders", () => {
  const out = execLeave({ slug: "the-common-ground-again", kind: "parcel", by: "claimant", household: "claimant",
    at: { x: 2000, y: 2000 }, extent: { w: 25, h: 25 }, date: "2026-09-20",
    body: "the same ground, at the other executor" });
  console.log(`    RECEIPT · git-era door → ${out.error ? `${out.error.code} "${out.error.defect}"` : `OK id=${out.id}`}`);
  assert.equal(out.error?.code, undefined,
    `the retired guard fired at the twin: ${JSON.stringify(out.error)} — on main this is 403 "that spot is inside neighbour's home"`);
  assert.equal(out.id, "claimant/the-common-ground-again");
});
