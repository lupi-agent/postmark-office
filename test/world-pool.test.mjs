// world-pool.test.mjs — tier 1: two households write at once, one household
// never writes twice at once, and the lanes that share a file on main keep the
// single global lane they had.
//
// The receipts these tests read are `poolStats`: `maxInFlight` is the only proof
// that the pool actually OVERLAPPED (correct results alone are equally
// consistent with everything having quietly serialized), `maxPerHousehold` the
// only proof that it never overlapped a household with itself, and `leases` the
// proof that the shared-ledger lane never enters the pool at all.
//
//   node --test test/world-pool.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { lockArgv } from "../src/town-lock.mjs";

const repo = mkdtempSync(join(tmpdir(), "postmark-world-pool-"));
const pool = mkdtempSync(join(tmpdir(), "postmark-world-pool-wt-"));
after(() => rmSync(repo, { recursive: true, force: true }));
after(() => rmSync(pool, { recursive: true, force: true }));

const git = (...args) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const mark = (by, body) => `---\nkind: sited\nby: ${by}\ntier: market\ndate: 2026-08-05\nat: { x: 0, y: 0 }\nextent: { w: 4, h: 4 }\n---\n\n${body}\n`;

// ── the world in a bottle: enough tree for both write lanes and one read ──────
put("WORLD/marks/let-there-be-light/mark.md", mark("the-town", "the public frame"));
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, parcels: [], determined: {}, vague: [], rivalries: [],
  portfolios: {}, terrain_weight: {}, errors: [],
  marks: [{
    id: "the-town/let-there-be-light", by: "the-town", household: "the-town",
    kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 1000, h: 1000 },
    body: "the public frame",
  }, {
    // A parcel with something sited on it — the shape issue #7 §5 bounced on.
    id: "finn/the-still-reach-parcel", by: "finn", household: "finn",
    kind: "parcel", tier: "market", at: { x: 200, y: 300 }, extent: { w: 25, h: 25 },
    body: "the ground the Still Reach stands on",
  }, {
    id: "finn/the-porch", by: "finn", household: "finn",
    kind: "sited", tier: "market", at: { x: 204, y: 300 }, extent: { w: 3, h: 2 },
    body: "a porch faces east",
  }],
}));
put("seeding/manifest.json", JSON.stringify({ homes: [] }));
put("tools/mark-lint.mjs", "process.exit(0);\n");
put("tools/world-build.mjs", `
export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }
`);
put("tools/world-verbs.mjs", `
export function orient(_state, world) { return { seen: world.marks.map((m) => m.id) }; }
export function openYourEyes() { return { fov: { carried: [], far: [], counts: {} }, radial: { byBearing: {}, counts: {} }, tell: () => "" }; }
export function investigate(id, world) { return world.marks.find((m) => m.id === id) ?? null; }
`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function householdOf(handle) { return handle; }
export function parcelFor() { return null; }
export function homeOf() { return { ...NOWHERE }; }
export function whereIs() { return { ...NOWHERE }; }
`);
// the walk grammar, enough of it that a departure round-trips through the ledger
put("tools/walk.mjs", `
export function fractionalCrossing() { return 100.5; }
export function formatDeparture({ handle, from, toward, at }) {
  return \`- 2026-08-05T00:00:00.000Z · \${handle} · from \${from.x},\${from.y} · toward \${toward.x},\${toward.y} · at \${at}\`;
}
export function parseWalkLedger(text) {
  const departures = String(text ?? "").split(/\\r?\\n/).filter((l) => l.startsWith("- ")).map((line) => {
    const handle = line.split(" · ")[1];
    const m = line.match(/toward (-?[\\d.]+),(-?[\\d.]+)/);
    return { handle, line, toward: { x: Number(m?.[1] ?? 0), y: Number(m?.[2] ?? 0) } };
  });
  return { departures, unrecognized: [] };
}
export function currentDeparture(departures, handle) {
  return departures.filter((d) => d.handle === handle).pop() ?? null;
}
export function positionAt(departure) {
  const at = departure?.toward ?? { x: 0, y: 0 };
  return { x: at.x, y: at.y, legM: 0, etaCrossings: 0, standing: true, arrived: true, remainingM: 0 };
}
`);
put("tools/water.mjs", "export function crossingsOnSegment() { return []; }\n");
// Enough geometry for the walk door to ask "what is sited on this parcel's
// ground" — the same two predicates the world's own module exports.
put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function pointInRect(px, py, r) { return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2; }
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
export const contains = (outer, inner) => overlapArea(outer, inner) >= 0.99 * inner.w * inner.h;
export const marksContain = (outer, inner) => contains(rect(outer), rect(inner));
`);
put("tools/marks-fold.mjs", `
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
function parse(path) {
  const text = readFileSync(path, "utf8");
  const by = text.match(/^by:\\s*(.+)$/m)?.[1]?.trim();
  const kind = text.match(/^kind:\\s*(.+)$/m)?.[1]?.trim() ?? "sited";
  const tier = text.match(/^tier:\\s*(.+)$/m)?.[1]?.trim() ?? "market";
  return { by, household: by, kind, tier, body: text.split(/---\\r?\\n/).at(-1).trim() };
}
export function loadMarks(dir) {
  const out = [];
  function walk(at, parent = null) {
    if (!existsSync(at)) return;
    const entries = readdirSync(at);
    let here = parent;
    if (entries.includes("mark.md")) {
      const rec = parse(join(at, "mark.md"));
      rec.slug = basename(at); rec.id = rec.by + "/" + rec.slug; rec._dir = at; rec._parentMarkId = parent;
      out.push(rec); here = rec.id;
    }
    for (const entry of entries) {
      const next = join(at, entry);
      if (entry !== "mark.md" && statSync(next).isDirectory()) walk(next, here);
    }
  }
  walk(dir);
  return out;
}
export function placementParent() { return null; }
export function marksContain() { return false; }
if (process.argv[1]?.endsWith("marks-fold.mjs")) {
  const marks = loadMarks(opt("--marks-dir", "WORLD/marks")).map((m) => ({
    id: m.id, by: m.by, household: m.household, kind: m.kind, tier: m.tier,
    body: m.body, sovereign: false, stamps: 0, weight: 0,
  }));
  console.log(JSON.stringify({ tick: 0, dials: {}, marks, parcels: [], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [] }));
}
`);

git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "published main");

process.env.WORLD_CLONE = repo;
process.env.WORLD_POOL_DIR = pool;
process.env.WORLD_POOL_SIZE = "2"; // deliberately smaller than the households below
const { leaveMarkViaOffice, walkViaOffice } = await import("../src/world.mjs");
const { poolStats } = await import("../src/world-pool.mjs");

const key = (household, ...handles) => ({ household, handles: new Set(handles) });
const houseA = key("house-a", "alpha", "aleph");
const houseB = key("house-b", "beta");
const houseC = key("house-c", "gamma");
const houseD = key("house-d", "delta");

// `by` only where the key holds more than one resident (house-a); elsewhere the
// door resolves the single handle itself, as it does for a solo key.
const sited = (slug, body, at, by) => ({ slug, kind: "sited", at, extent: { w: 4, h: 4 }, body, ...(by ? { by } : {}) });
const shown = (ref, path) => git("show", `${ref}:${path}`);
const has = (ref, path) => {
  try { git("cat-file", "-e", `${ref}:${path}`); return true; } catch { return false; }
};
// Filed by identity since the freeze (2026-08-25): "New marks are filed by
// identity - WORLD/marks/<household>/<slug>/". The argument is the mark's ID,
// `<by>/<slug>`, because that IS the path.
const markPath = (id) => `WORLD/marks/${id}/mark.md`;

// ── the lock composition, on any platform ────────────────────────────────────

test("the draft lane takes town.lock SHARED plus a household lock; every other lane stays exclusive", () => {
  process.env.TOWN_LOCK = "/srv/postmark-office/town.lock";
  const [sharedFile, sharedArgs] = lockArgv("/o/src/leave-exec.mjs", "{}",
    { shared: true, alsoLock: "/srv/postmark-office/draft-locks/house-a.lock" }, true);
  assert.equal(sharedFile, "/usr/bin/flock");
  assert.deepEqual(sharedArgs, [
    "-s", "-w", "30", "/srv/postmark-office/town.lock",
    "/usr/bin/flock", "-w", "30", "/srv/postmark-office/draft-locks/house-a.lock",
    process.execPath, "/o/src/leave-exec.mjs", "{}",
  ]);

  // the shared-ledger lanes pass no options: byte-for-byte the tier-0 argv, so
  // they still exclude the tick, the crossing, AND every draft write
  const [walkFile, walkArgs] = lockArgv("/o/src/walk-exec.mjs", "{}", {}, true);
  assert.equal(walkFile, "/usr/bin/flock");
  assert.deepEqual(walkArgs, [
    "-w", "30", "/srv/postmark-office/town.lock",
    process.execPath, "/o/src/walk-exec.mjs", "{}",
  ]);

  // no flock (dev, Windows): the child is spawned bare, exactly as before
  assert.deepEqual(lockArgv("/o/src/leave-exec.mjs", "{}", { shared: true, alsoLock: "/x.lock" }, false),
    [process.execPath, ["/o/src/leave-exec.mjs", "{}"]]);
  delete process.env.TOWN_LOCK;
});

// ── (a) two households in flight at once ─────────────────────────────────────

test("two households' marks are in flight at the same time and land on their own draft refs", async () => {
  const before = poolStats(repo);
  assert.equal(before, null, "no pool exists until the first write leases one");

  const [a, b] = await Promise.all([
    leaveMarkViaOffice(repo, sited("mark-a", "house a was here", { x: 10, y: 10 }, "alpha"), houseA),
    leaveMarkViaOffice(repo, sited("mark-b", "house b was here", { x: 20, y: 20 }), houseB),
  ]);

  assert.equal(a.branch, "draft/house-a");
  assert.equal(b.branch, "draft/house-b");
  assert.match(shown("draft/house-a", markPath("alpha/mark-a")), /house a was here/);
  assert.match(shown("draft/house-b", markPath("beta/mark-b")), /house b was here/);
  // isolation: neither household's sketch bled into the other's branch or main
  assert.equal(has("draft/house-a", markPath("beta/mark-b")), false);
  assert.equal(has("draft/house-b", markPath("alpha/mark-a")), false);
  assert.equal(has("main", markPath("alpha/mark-a")), false);

  const stats = poolStats(repo);
  assert.equal(stats.maxInFlight, 2, "the two writes overlapped — the whole point of tier 1");
  assert.equal(stats.created, 2, "each got its own worktree");
  assert.equal(stats.inFlight, 0, "every lease was returned");
  // and the shared clone was never dragged onto a household branch to do it
  assert.equal(git("branch", "--show-current").trim(), "main");
});

test("the pool is a cap, not a promise: four households at once run two at a time and all four land", async () => {
  const before = poolStats(repo).leases;
  const results = await Promise.all([
    leaveMarkViaOffice(repo, sited("four-a", "a", { x: 30, y: 10 }, "alpha"), houseA),
    leaveMarkViaOffice(repo, sited("four-b", "b", { x: 30, y: 20 }), houseB),
    leaveMarkViaOffice(repo, sited("four-c", "c", { x: 30, y: 30 }), houseC),
    leaveMarkViaOffice(repo, sited("four-d", "d", { x: 30, y: 40 }), houseD),
  ]);
  assert.deepEqual(results.map((r) => r.branch),
    ["draft/house-a", "draft/house-b", "draft/house-c", "draft/house-d"]);
  for (const [i, household] of ["a", "b", "c", "d"].entries())
    assert.ok(has(`draft/house-${household}`, markPath(`${["alpha", "beta", "gamma", "delta"][i]}/four-${household}`)), `four-${household} missing on its branch (${results[i].commit})`);

  const stats = poolStats(repo);
  assert.equal(stats.leases, before + 4);
  assert.equal(stats.maxInFlight, 2, "WORLD_POOL_SIZE=2 held: two writers, never three");
  assert.equal(stats.created, 2, "a fifth household mints no fifth worktree");
});

// ── (b) one household never writes twice at once ─────────────────────────────

// The note left this lane for the store (POS-392), so the same-household case
// is three marks: two residents of one house, one of them twice.
test("same-household writes serialize and all of them land, in call order", async () => {
  const before = Number(git("rev-list", "--count", "draft/house-a").trim());
  const [first, second, third] = await Promise.all([
    leaveMarkViaOffice(repo, sited("serial-one", "the first word", { x: 70, y: 10 }, "alpha"), houseA),
    leaveMarkViaOffice(repo, sited("serial-two", "the sibling's word", { x: 70, y: 20 }, "aleph"), houseA),
    leaveMarkViaOffice(repo, sited("serial-three", "the last word", { x: 70, y: 30 }, "alpha"), houseA),
  ]);

  for (const r of [first, second, third]) assert.equal(r.branch, "draft/house-a");
  assert.equal(new Set([first.commit, second.commit, third.commit]).size, 3,
    "three writes, three commits — none was lost to a clobber");
  assert.equal(Number(git("rev-list", "--count", "draft/house-a").trim()), before + 3);
  for (const id of ["alpha/serial-one", "aleph/serial-two", "alpha/serial-three"])
    assert.ok(has("draft/house-a", markPath(id)), `${id} stands on the household's branch: the later writes saw the earlier ones`);
  assert.equal(poolStats(repo).maxPerHousehold, 1,
    "one household, one writer at a time — they target the same ref");
});

// ── (c) reset-on-lease heals whatever the last write left ────────────────────

test("a dirtied worktree heals at its next lease, not at the last one's exit", async () => {
  const slot = poolStats(repo).slots.find((s) => s.made);
  assert.ok(slot, "a lease has created at least one worktree by now");

  // what a crash leaves behind: an untracked file only `clean` removes, and a
  // tracked file only `reset --hard` restores. Both must be gone by the time the
  // next write's lint and fold run against this tree.
  const junk = join(slot.dir, "WORLD", "marks", "let-there-be-light", "half-written", "mark.md");
  mkdirSync(dirname(junk), { recursive: true });
  writeFileSync(junk, mark("ghost", "a write that never finished"));
  rmSync(join(slot.dir, "WORLD", "skeleton.json"), { force: true });

  const healed = await leaveMarkViaOffice(repo, sited("after-the-crash", "the tree came back clean", { x: 50, y: 50 }, "alpha"), houseA);
  assert.equal(healed.branch, "draft/house-a");
  assert.ok(has("draft/house-a", markPath("alpha/after-the-crash")));
  assert.equal(existsSync(junk), false, "the abandoned mark was cleaned, not committed");
  assert.ok(existsSync(join(slot.dir, "WORLD", "skeleton.json")), "the deleted tracked file was restored");
  // The path the GHOST was planted at, not an identity path — the ghost was
  // never written by the door, so asking after `ghost/half-written` would be
  // asking whether a file nobody ever created is absent.
  assert.equal(has("draft/house-a", "WORLD/marks/let-there-be-light/half-written/mark.md"), false,
    "and the ghost never reached the household's branch");
});

// ── (d) the shared-ledger lane is untouched ──────────────────────────────────

test("the walk lane takes no lease and still appends the public ledger on main", async () => {
  const before = poolStats(repo);
  const walk = await walkViaOffice(repo, { handle: "alpha", x: 12, y: 34 }, houseA);

  assert.equal(walk.handle, "alpha");
  assert.ok(walk.ledger.commit, "the departure committed");
  assert.match(shown("main", "WORLD/walk-ledger.md"), /alpha · from 0,0 · toward 12,34/);
  assert.equal(git("branch", "--show-current").trim(), "main",
    "the ledger lane writes the shared clone's own checkout, exactly as before");

  const after = poolStats(repo);
  assert.equal(after.leases, before.leases, "a shared-ledger write never enters the pool");
  assert.equal(after.created, before.created);
});

// ── issue #7 §5: the parcel refusal, on the real walk path ──────────────────

test("walking to a parcel bounces with a parcel's own hint, naming what stands on it", async () => {
  await assert.rejects(
    () => walkViaOffice(repo, { handle: "alpha", mark_id: "finn/the-still-reach-parcel" }, houseA),
    (e) => {
      assert.equal(e.code, 422);
      assert.match(e.defect, /is a parcel — ground held on the record/);
      assert.match(e.hint, /finn\/the-porch/, "the recovery is a sited mark inside, and the door names it");
      assert.doesNotMatch(e.hint, /predicated and naming/,
        "the hint explained a different kind of mark than the one that bounced");
      return true;
    });
});

// ── the rollback switch ──────────────────────────────────────────────────────

test("WORLD_POOL=0 falls back to the shared checkout and still answers the same shape", async () => {
  const before = poolStats(repo).leases;
  process.env.WORLD_POOL = "0";
  try {
    const result = await leaveMarkViaOffice(repo, sited("no-pool", "the tier-0 lane still works", { x: 60, y: 60 }), houseB);
    assert.equal(result.branch, "draft/house-b");
    assert.equal(result.pushed, false);
    assert.ok(has("draft/house-b", markPath("beta/no-pool")));
    assert.equal(poolStats(repo).leases, before, "no lease was taken");
    // the tier-0 pen owns the shared clone's checkout, and leaves it where it wrote
    assert.equal(git("branch", "--show-current").trim(), "draft/house-b");
  } finally {
    delete process.env.WORLD_POOL;
    git("switch", "-q", "main"); // put it back for anything after this
  }
});
