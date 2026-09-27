// world2-fold-equality.test.mjs — POS-142: THE WORLD PAGE'S FOLD, FROM ROWS,
// EQUALS THE FOLD FROM FILES.
//
// `/world/state` under `W2_FOLD=store` serves the world's own `fold()` run over
// records built from the store's rows (`src/world2-fold.mjs § marksFromRows`).
// The claim that makes that safe to serve is one equality, and this is it:
//
//     fold(marksFromRows(rows)) deep-equals fold(loadMarks(dir))
//
// at one settlement, key by key, mark by mark, in order.
//
// ── WHERE THE ROWS COME FROM, SAID PLAINLY ──────────────────────────────────
//
// No hydrated store is available in this tree, so the rows are built the way
// the store itself was built: `world2/tools/seed-import.mjs § deriveSeed` (the
// `marks` rows) and `world2/tools/law-ingest.mjs § deriveLaw` (the class marks
// in `law_projection`) over a checkout of the world at its newest settlement
// tag, each passed through a JSON round trip for `jsonb`'s sake. That makes
// this the REVERSE of the loader: rows -> records must undo files -> rows. It
// proves the loader against the store's row SHAPE. It does not prove that a
// given live store holds every mark the tree does — a mark the store never
// received is a data gap on the box, and that equality is the one the operator
// runs against dev's rows (POS-142's report names the seven prod lacks today).
//
// When the equality fails, the FIRST line of the red names the key and the mark.
//
//   node --test test/world2-fold-equality.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  marksFromRows, inPublishedOrder, worldStateServed, foldFromStoreEnabled, resetStoreFoldCache,
} from "../src/world2-fold.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// The world clone's newest settlement tag — the blessed ref the office serves.
function newestTag(repo) {
  try {
    return git(repo, ["tag", "-l", "settlement/S*", "--sort=-v:refname"]).split("\n").filter(Boolean)[0] ?? null;
  } catch { return null; }
}
const TAG = existsSync(WORLD_CLONE) ? newestTag(WORLD_CLONE) : null;
const WHY_SKIP = TAG ? false : `no world clone with a settlement tag at ${WORLD_CLONE} (set WORLD_CLONE)`;

let dir = null;
let fixture = null;

before(async () => {
  if (WHY_SKIP) return;
  // A throwaway checkout AT THE TAG. `--shared` borrows the clone's objects and
  // writes nothing into it; the office's clone is never checked out or moved.
  dir = mkdtempSync(join(tmpdir(), "pos142-fold-"));
  execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", WORLD_CLONE, join(dir, "w")], { stdio: "ignore" });
  const repo = join(dir, "w");
  git(repo, ["-c", "advice.detachedHead=false", "checkout", "-q", TAG]);
  const mf = await import(pathToFileURL(join(repo, "tools", "marks-fold.mjs")).href);
  const { deriveSeed } = await import("../world2/tools/seed-import.mjs");
  const { deriveLaw } = await import("../world2/tools/law-ingest.mjs");
  const jsonb = (v) => JSON.parse(JSON.stringify(v));   // the storage round trip
  const seed = await deriveSeed({ worldRepo: repo, lawSha: git(repo, ["rev-parse", "HEAD"]).trim() });
  const law = await deriveLaw({ lawRepo: repo });
  const terrain = JSON.parse(readFileSync(join(repo, "WORLD", "skeleton.json"), "utf8"));
  const hhPath = join(repo, "WORLD", "households.json");
  const households = existsSync(hhPath) ? (JSON.parse(readFileSync(hhPath, "utf8")).households ?? null) : null;
  fixture = {
    mf, repo, terrain, households,
    markRows: jsonb(seed.marks),
    lawRows: jsonb((law.rows ?? law).filter((r) => r.kind === "class")),
  };
});

after(() => { if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

/** Every difference between two folds, mark-keyed first, as `key @ mark: file … rows …` lines. */
function foldDiffs(file, rows) {
  const out = [];
  const byId = new Map(rows.marks.map((m) => [m.id, m]));
  const fileIds = new Set(file.marks.map((m) => m.id));
  for (const a of file.marks) {
    const b = byId.get(a.id);
    if (!b) { out.push(`marks @ ${a.id}: in the file's fold, absent from the rows fold`); continue; }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!isDeepStrictEqual(a[k], b[k])) out.push(`${k} @ ${a.id}: file ${JSON.stringify(a[k])?.slice(0, 120)} · rows ${JSON.stringify(b[k])?.slice(0, 120)}`);
    }
  }
  for (const b of rows.marks) if (!fileIds.has(b.id)) out.push(`marks @ ${b.id}: in the rows fold, absent from the file's fold`);
  for (const k of new Set([...Object.keys(file), ...Object.keys(rows)])) {
    if (k === "marks" || k === "meta") continue;
    if (!isDeepStrictEqual(file[k], rows[k])) out.push(`${k}: the top-level block differs`);
  }
  if (!out.length && file.marks.map((m) => m.id).join("\n") !== rows.marks.map((m) => m.id).join("\n")) {
    const i = file.marks.findIndex((m, n) => m.id !== rows.marks[n]?.id);
    out.push(`marks order @ ${i}: file ${file.marks[i]?.id} · rows ${rows.marks[i]?.id}`);
  }
  return out;
}

test("THE EQUALITY — fold(rows) deep-equals fold(files) at the newest settlement, in the published order", { skip: WHY_SKIP }, () => {
  const { mf, repo, terrain, households, markRows, lawRows } = fixture;
  const file = mf.fold({ marks: mf.loadMarks(join(repo, "WORLD", "marks")), terrain, stakes: [], households });
  const rows = mf.fold({ marks: marksFromRows(markRows, lawRows), terrain, stakes: [], households });
  rows.marks = inPublishedOrder(rows.marks, file.marks.map((m) => m.id));
  const diffs = foldDiffs(file, rows);
  assert.equal(diffs.length, 0, `${diffs[0]}\n  — ${diffs.length} difference(s) at ${TAG} over ${markRows.length} mark rows + ${lawRows.length} class rows:\n  ${diffs.slice(0, 20).join("\n  ")}`);
  assert.deepStrictEqual(rows, file);   // and the whole object, once the named diff is empty
});

test("ORDER is the one thing the rows do not carry — without the published order only the order differs", { skip: WHY_SKIP }, () => {
  const { mf, repo, terrain, households, markRows, lawRows } = fixture;
  const file = mf.fold({ marks: mf.loadMarks(join(repo, "WORLD", "marks")), terrain, stakes: [], households });
  const rows = mf.fold({ marks: marksFromRows(markRows, lawRows), terrain, stakes: [], households });
  const diffs = foldDiffs(file, rows);
  assert.ok(diffs.every((d) => d.startsWith("marks order")), `a difference other than order:\n  ${diffs.slice(0, 10).join("\n  ")}`);
});

test("a mark the store does not hold is ABSENT from the rows fold, and the diff names it", { skip: WHY_SKIP }, () => {
  const { mf, repo, terrain, households, markRows, lawRows } = fixture;
  const file = mf.fold({ marks: mf.loadMarks(join(repo, "WORLD", "marks")), terrain, stakes: [], households });
  const dropped = markRows.find((r) => r.kind === "predicated");
  const rows = mf.fold({ marks: marksFromRows(markRows.filter((r) => r !== dropped), lawRows), terrain, stakes: [], households });
  const diffs = foldDiffs(file, rows);
  assert.ok(diffs.length > 0, "the equality could not see a missing mark");
  assert.ok(diffs.includes(`marks @ ${dropped.slug}: in the file's fold, absent from the rows fold`), diffs.slice(0, 5).join("\n"));
});

// ── the loader, field by field ──────────────────────────────────────────────

test("marksFromRows: the loader's shape from a seeded row, a live-pen row, and a class row", () => {
  const recs = marksFromRows([
    { id: "u-parcel", slug: "wren/the-yard", kind: "parcel", owner: "wren", household: "gh:1", body: "A yard.",
      geometry: { at: { x: 10, y: 20 }, extent: { h: 6, w: 4 } }, parent: null,
      data: { date: "2026-07-01", tier: "market", _parentMarkId: null, _fileAt: { x: 10, y: 20 } } },
    { id: "u-light", slug: "wren/the-light", kind: "predicated", owner: "wren", household: "gh:1", body: "The light.",
      geometry: null, parent: "u-parcel", data: { slot: "light", tier: "home", _parentMarkId: "wren/the-yard" } },
    // written by the live pen: no `_parentMarkId`, a stray `geometry.slug`
    { id: "u-new", slug: "rook/the-bell", kind: "naming", owner: "rook", household: "solo:rook", body: "",
      geometry: { slug: "rook/the-bell" }, parent: "u-parcel", data: { value: "BELL", _act_id: "a1" } },
    { id: "u-law", slug: "the-town/resident-engine", kind: "predicated", owner: "the-town", household: "solo:the-town",
      body: "The corridor.", geometry: null, parent: null,
      data: { tier: "constitution", _parent_is_law: "the-town/resident", _parentMarkId: "the-town/resident" } },
  ], [
    { kind: "class", key: "resident", path: "WORLD/marks/x/resident/mark.md",
      data: { id: "the-town/resident", slug: "resident", by: "the-town", household: "the-town", kind: "class", tier: "constitution", body: "The class." } },
  ]);
  const by = new Map(recs.map((r) => [r.id, r]));
  const yard = by.get("wren/the-yard");
  assert.equal(yard.household, "wren", "the loader sets household = by; the column's household key is the fold's to derive");
  assert.equal(yard.slug, "the-yard");
  assert.deepEqual(Object.keys(yard.extent), ["w", "h"], "jsonb's {h, w} comes back in the file's order");
  assert.equal("parent" in yard, false, "sited/parcel never carry an authored parent");
  assert.equal(by.get("wren/the-light").parent, "wren/the-yard", "the continuation edge resolves through marks.parent");
  assert.equal(by.get("rook/the-bell")._parentMarkId, "wren/the-yard", "a live-pen continuation takes its parent as its directory edge");
  assert.equal("at" in by.get("rook/the-bell"), false, "a stray geometry.slug is not a placement");
  assert.equal(by.get("rook/the-bell").tier, "market", "no tier on the row reads as the loader's default");
  const eng = by.get("the-town/resident-engine");
  assert.equal(eng.parent, "the-town/resident", "a parent in law_projection is carried by _parent_is_law");
  assert.equal("_parent_is_law" in eng, false, "the seed's receipt is not a record field");
  assert.equal(by.get("the-town/resident").kind, "class", "class marks come from law_projection");
  assert.deepEqual(recs.map((r) => r.id), [...recs.map((r) => r.id)].sort(), "rows come back in id order");
});

// ── the door: flag off is today, flag on says which it served ────────────────

test("flag OFF — /world/state is the file, the very object, and the store is never asked", async () => {
  resetStoreFoldCache();
  const file = { tick: 0, marks: [{ id: "a/b" }] };
  let asked = 0;
  const served = await worldStateServed({ env: {}, fileState: async () => file, storeState: async () => { asked += 1; return {}; } });
  assert.equal(served, file);
  assert.equal(JSON.stringify(served), JSON.stringify(file), "byte-for-byte: nothing is added to today's answer");
  assert.equal(asked, 0);
  assert.equal(foldFromStoreEnabled({ W2_FOLD: "1" }), false, "only the word `store` turns it on");
});

test("flag ON — the rows fold answers, and a store that cannot answer falls through to the file and says so", async () => {
  resetStoreFoldCache();
  const env = { W2_FOLD: "store" };
  const file = { tick: 0, marks: [{ id: "a/b" }] };
  const store = { tick: 0, marks: [{ id: "a/b" }], meta: { source: "store" } };
  assert.equal(await worldStateServed({ env, fileState: async () => file, storeState: async () => store }), store);
  resetStoreFoldCache();
  const fell = await worldStateServed({ env, fileState: async () => file, storeState: async () => { throw new Error("projection_heads has no 'town' row"); } });
  assert.equal(fell.meta.source, "file");
  assert.match(fell.meta.fell_through, /projection_heads has no 'town' row/);
  assert.deepEqual(fell.marks, file.marks);
  resetStoreFoldCache();
  const empty = await worldStateServed({ env, fileState: async () => file, storeState: async () => ({ marks: [] }) });
  assert.equal(empty.meta.source, "file", "a fold with no marks is not an answer");
});

test("flag ON — the fold is computed once per store fingerprint, not once per request", async () => {
  resetStoreFoldCache();
  const env = { W2_FOLD: "store" };
  let folds = 0, key = "k1";
  const args = { env, fileState: async () => ({ marks: [] }), storeState: async () => { folds += 1; return { marks: [{ id: "a/b" }] }; }, fingerprint: async () => key };
  await Promise.all([worldStateServed(args), worldStateServed(args), worldStateServed(args)]);
  assert.equal(folds, 1, "concurrent requests on one fingerprint share one fold");
  key = "k2";
  await worldStateServed(args);
  assert.equal(folds, 2, "a moved store re-folds");
});

test("GET /world/store advertises W2_FOLD beside its siblings — and only advertises", async () => {
  const { worldStoreHealth } = await import("../src/world-serve.mjs");
  const before = process.env.W2_FOLD;
  try {
    delete process.env.W2_FOLD;
    assert.equal(worldStoreHealth({ repo: null }).flags.W2_FOLD, null);
    process.env.W2_FOLD = "store";
    const h = worldStoreHealth({ repo: null });
    assert.equal(h.flags.W2_FOLD, "store");
    assert.ok("WORLD_STORE_READS" in h.flags && "WORLD_STORE_SHADOW" in h.flags, "the siblings stay");
  } finally {
    if (before === undefined) delete process.env.W2_FOLD; else process.env.W2_FOLD = before;
  }
});
