// world2-marks-ingest.test.mjs — POS-142, the class: after `marks-ingest --ref B`
// the World page's fold FROM ROWS equals the fold FROM FILES at B.
//
// This extends PR #173's falsifier (test/world2-fold-equality.test.mjs) by one
// move. #173 proved `marksFromRows` is the loader's inverse over rows the SEED
// derived at one tag. This proves the ingest keeps it true across a bless:
//
//     store := deriveSeed(world @ A)                  (#173's construction)
//     world @ B := A + an AMENDED mark
//                    + an ADDED predicated child of a class mark
//                    + a RETIRED (deleted) mark          (three commits)
//     marks-ingest --ref B
//     fold(marksFromRows(rows)) deep-equals fold(loadMarks(world @ B))
//
// key by key, mark by mark, in the published order. And: before the ingest the
// same equality is RED on exactly those three marks (the falsifier can fail);
// `--dry-run` names exactly the three changes and writes nothing; a second run
// is a no-op (the head is at B).
//
// ── THE STORE IS IN MEMORY, AND WHAT THAT DOES NOT PROVE ────────────────────
//
// No Postgres is available to this suite. `fakeStore` answers the statements
// the ingest makes and nothing else (an unknown statement throws — answering []
// would be a lie), and it holds the store's own rules where this path leans on
// them: jsonb returns keys in (length, bytes) order; `marks.slug` is unique;
// `marks.parent` is a non-deferrable foreign key; `claims.id` is a primary key
// and `claims.supersedes` a foreign key; a `BEGIN READ ONLY` transaction refuses
// every write; ROLLBACK restores. It is not Postgres. The real round trip is the
// dev sandbox run — `--dry-run`, the run, then #173's equality on dev's rows —
// which is the operator's, before prod.
//
//   WORLD_CLONE=<a world clone with settlement tags> node --test test/world2-marks-ingest.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  ingest, planIngest, applyIngest, recordDiff, isRecordField, pathsAt, HEAD_KEY, amendClaimId,
} from "../world2/tools/marks-ingest.mjs";
import { REFUSED_BY_NAME } from "../world2/tools/backfill-register.mjs";
import { marksFromRows, inPublishedOrder } from "../src/world2-fold.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";
import { __clearHouseCache } from "../src/household-deriver.mjs";

const git = (repo, args, env = {}) => execFileSync("git", ["-C", repo, ...args],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });

function newestTag(repo) {
  try { return git(repo, ["tag", "-l", "settlement/S*", "--sort=-v:refname"]).split("\n").filter(Boolean)[0] ?? null; }
  catch { return null; }
}
const TAG = existsSync(WORLD_CLONE) ? newestTag(WORLD_CLONE) : null;
const WHY_SKIP = TAG ? false : `no world clone with a settlement tag at ${WORLD_CLONE} (set WORLD_CLONE)`;
const B_TAG = "pos142-fixture-B";

// ── jsonb, as far as this path leans on it ──────────────────────────────────
// Postgres normalises object keys to (length, then bytes) order. #173's loader
// restores the file's order where the fold cares (`{w, h}`); a fake that kept
// JS insertion order would hide a regression there.
function jsonb(v) {
  if (v === null || v === undefined) return v ?? null;
  if (Array.isArray(v)) return v.map(jsonb);
  if (typeof v === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined)
      .sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0));
    const out = {};
    for (const k of keys) out[k] = jsonb(v[k]);
    return out;
  }
  return v;
}
const parseJ = (v) => (typeof v === "string" ? JSON.parse(v) : v);

/**
 * A store holding `marks`, `claims`, `windows`, `projection_heads` and the
 * registry, answering exactly the ingest's statements.
 */
function fakeStore({ marks, claims, windows, roll }) {
  let state = {
    marks: marks.map((m) => ({ ...m, geometry: jsonb(m.geometry), data: jsonb(m.data) })),
    claims: new Map(claims.map((c) => [String(c.id), { ...c }])),
    windows: windows.map((w) => ({ ...w })),
    heads: new Map(),
  };
  const households = Object.entries(roll).map(([slug, residents], i) => ({
    slug, ord: i, name: null, human: null, accounts: [], residents,
    since: null, member_of: null, declared_by: null, formerly: [], provisional: false,
  }));
  const writes = [];
  let snapshot = null, readOnly = false;
  const clone = (s) => ({ marks: structuredClone(s.marks), claims: new Map(structuredClone([...s.claims])), windows: structuredClone(s.windows), heads: new Map(s.heads) });
  const closesAt = (id) => state.windows.find((w) => w.id === id)?.closes_at ?? null;
  const fkParent = (parent, slug) => {
    if (parent != null && !state.marks.some((m) => String(m.id) === String(parent)))
      throw new Error(`insert or update on table "marks" violates foreign key constraint "marks_parent_fkey" (${slug} -> ${parent})`);
  };

  const query = async (text, params = []) => {
    const t = text.trim();
    const isWrite = /^(INSERT|UPDATE|DELETE)\b/i.test(t);
    if (isWrite) {
      if (readOnly) throw new Error(`cannot execute ${t.split(/\s+/)[0]} in a read-only transaction`);
      writes.push(t.split("\n")[0].slice(0, 80));
    }
    if (/^BEGIN READ ONLY$/i.test(t)) { snapshot = clone(state); readOnly = true; return { rows: [] }; }
    if (/^BEGIN$/i.test(t)) { snapshot = clone(state); readOnly = false; return { rows: [] }; }
    if (/^COMMIT$/i.test(t)) { snapshot = null; readOnly = false; return { rows: [] }; }
    if (/^ROLLBACK$/i.test(t)) { if (snapshot) state = snapshot; snapshot = null; readOnly = false; return { rows: [] }; }

    if (/FROM projection_heads WHERE repo/i.test(t)) {
      const sha = state.heads.get(params[0]);
      return { rows: sha ? [{ sha }] : [] };
    }
    if (/INSERT INTO projection_heads/i.test(t)) { state.heads.set(params[0], params[1]); return { rows: [], rowCount: 1 }; }
    if (/receipts->>'note' = 'genesis seed'/i.test(t)) {
      const g = state.windows.find((w) => w.receipts?.note === "genesis seed");
      return { rows: g ? [{ sha: g.receipts.seeded_from.world_sha }] : [] };
    }
    if (/FROM windows WHERE status = 'open'/i.test(t)) {
      const o = state.windows.filter((w) => w.status === "open").sort((a, b) => b.id - a.id)[0];
      return { rows: o ? [{ id: o.id }] : [] };
    }
    if (/FROM marks m LEFT JOIN windows/i.test(t)) {
      return { rows: [...state.marks].sort((a, b) => (a.slug < b.slug ? -1 : 1)).map((m) => ({
        id: String(m.id), slug: m.slug, kind: m.kind, owner: m.owner, household: m.household, body: m.body,
        geometry: structuredClone(m.geometry), status: m.status, locked_window: m.locked_window,
        retired_window: m.retired_window ?? null, parent: m.parent == null ? null : String(m.parent),
        data: structuredClone(m.data), locked_at: closesAt(m.locked_window),
      })) };
    }
    if (/has_table_privilege/i.test(t)) {
      const n = (t.match(/has_table_privilege/g) ?? []).length;
      const r = { whoami: "world2_owner" };
      for (let i = 0; i < n; i++) r[`p${i}`] = true;
      return { rows: [r] };
    }
    if (/^INSERT INTO claims/i.test(t)) {
      const [id, , slug, , , , , , , , , , , , , supersedes] = params;
      if (state.claims.has(String(id))) throw new Error(`duplicate key value violates unique constraint "claims_pkey" (${id})`);
      if (supersedes != null && !state.claims.has(String(supersedes))) throw new Error(`claims.supersedes ${supersedes} names no claim`);
      state.claims.set(String(id), { id, slug, supersedes, data: jsonb(parseJ(params[13])) });
      return { rows: [], rowCount: 1 };
    }
    if (/^INSERT INTO marks/i.test(t)) {
      const [id, slug, kind, owner, household, body, geometry, bbox, locked_window, data, parent] = params;
      if (state.marks.some((m) => m.slug === slug)) throw new Error(`duplicate key value violates unique constraint "marks_slug_key" (${slug})`);
      if (state.marks.some((m) => String(m.id) === String(id))) throw new Error(`duplicate key value violates unique constraint "marks_pkey" (${id})`);
      fkParent(parent, slug);
      state.marks.push({ id, slug, kind, owner, household, body, geometry: jsonb(parseJ(geometry)), bbox, status: "standing",
        locked_window, retired_window: null, data: jsonb(parseJ(data)), parent });
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE marks SET kind = \$2/i.test(t)) {
      const [id, kind, owner, household, body, geometry, bbox, data, parent, locked_window] = params;
      const m = state.marks.find((r) => String(r.id) === String(id));
      if (!m) return { rows: [], rowCount: 0 };
      fkParent(parent, m.slug);
      Object.assign(m, { kind, owner, household, body, geometry: jsonb(parseJ(geometry)), bbox, data: jsonb(parseJ(data)), parent, locked_window });
      return { rows: [], rowCount: 1 };
    }
    if (/^UPDATE marks SET status = 'retired'/i.test(t)) {
      const m = state.marks.find((r) => r.slug === params[0] && r.status === "standing");
      if (!m) return { rows: [], rowCount: 0 };
      m.status = "retired"; m.retired_window = params[1];
      return { rows: [{ slug: m.slug, locked_window: m.locked_window }], rowCount: 1 };
    }
    if (/^SELECT status, retired_window FROM marks WHERE slug/i.test(t)) {
      const m = state.marks.find((r) => r.slug === params[0]);
      return { rows: m ? [{ status: m.status, retired_window: m.retired_window }] : [] };
    }
    if (/^UPDATE marks SET data = COALESCE/i.test(t)) {
      const m = state.marks.find((r) => r.slug === params[0] && r.status === "retired" && r.retired_window === params[2]);
      if (m) m.data = jsonb({ ...(m.data ?? {}), ...parseJ(params[1]) });
      return { rows: [], rowCount: m ? 1 : 0 };
    }
    if (/FROM households/i.test(t)) return { rows: households, rowCount: households.length };
    if (/FROM household_pins/i.test(t)) return { rows: [], rowCount: 0 };
    if (/FROM registry_meta/i.test(t)) return { rows: [{ key: "schema_version", value: 1 }], rowCount: 1 };
    throw new Error(`fakeStore was asked a statement it does not implement, and answering [] would be a lie:\n${t.slice(0, 200)}`);
  };
  return {
    client: { query },
    writes,
    get state() { return state; },
    standingRows: () => state.marks.filter((m) => m.status === "standing").map((m) => structuredClone(m)),
    bySlug: (slug) => state.marks.find((m) => m.slug === slug),
    claim: (id) => state.claims.get(String(id)),
    head: () => state.heads.get(HEAD_KEY) ?? null,
  };
}

// ── the fixture world: A (a real settlement tag) and B (A + three commits) ──

let dir = null;
let fx = null;

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
function setLine(text, key, value) {
  const m = text.match(FM);
  const lines = m[1].split(/\r?\n/).filter((l) => !l.startsWith(`${key}:`));
  lines.push(`${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n${text.slice(m[0].length)}`;
}
const isLeafDir = (d) => readdirSync(d).every((e) => e === "mark.md" || !statSync(join(d, e)).isDirectory());

before(async () => {
  if (WHY_SKIP) return;
  dir = mkdtempSync(join(tmpdir(), "pos142-ingest-"));
  const repo = join(dir, "w");
  execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", WORLD_CLONE, repo], { stdio: "ignore" });
  git(repo, ["-c", "advice.detachedHead=false", "checkout", "-q", TAG]);
  const shaA = git(repo, ["rev-parse", "HEAD"]).trim();

  const { deriveSeed } = await import("../world2/tools/seed-import.mjs");
  const seed = await deriveSeed({ worldRepo: repo, lawSha: shaA });
  const { paths } = await pathsAt(repo);
  const abs = (slug) => join(repo, ...paths.get(slug).split("/"));

  // AMEND — a resident's sited mark: a new image line and a changed body.
  const amended = seed.marks.find((m) => m.kind === "sited" && m.owner !== "the-town" && paths.has(m.slug));
  // ADD — a predicated child of a CLASS mark, filed the way its siblings are:
  // a copy of an existing class-parented child's record under a new leaf.
  const sibling = seed.marks.find((m) => m.data?._parent_is_law && isLeafDir(dirname(abs(m.slug))));
  const classDir = dirname(dirname(abs(sibling.slug)));
  const addedLeaf = "pos142-fixture-child";
  const added = `${sibling.owner}/${addedLeaf}`;
  // RETIRE — a leaf continuation (predicated/naming) on a resident's mark, with
  // nothing filed beneath it, and not the amended mark's own.
  const retired = seed.marks.find((m) => (m.kind === "predicated" || m.kind === "naming") && m.parent
    && !m.data?._parent_is_law && m.owner !== "the-town" && m.slug !== "wright/the-lit-name"
    && isLeafDir(dirname(abs(m.slug))) && !seed.marks.some((x) => String(x.parent) === String(m.id)));
  assert.ok(amended && sibling && retired, "the fixture could not find its three marks in the tag");

  const commit = (author, msg) => git(repo, ["-c", `user.name=${author}`, "-c", "user.email=fixture@postmark.town",
    "commit", "-q", "-m", msg]);

  const f1 = abs(amended.slug);
  writeFileSync(f1, setLine(readFileSync(f1, "utf8"), "image", "pos142-fixture.png").trimEnd() + "\n\nAmended at B by the fixture.\n");
  git(repo, ["add", "-A"]);
  commit("fixture-amender", `amend: ${amended.slug} (pos142 fixture)`);

  mkdirSync(join(classDir, addedLeaf), { recursive: true });
  writeFileSync(join(classDir, addedLeaf, "mark.md"),
    readFileSync(abs(sibling.slug), "utf8").replace(/(\r?\n---\r?\n)[\s\S]*$/, "$1A predicated child added at B by the fixture.\n"));
  git(repo, ["add", "-A"]);
  commit("fixture-founder", `law: ${added} (pos142 fixture)`);

  git(repo, ["rm", "-q", "-r", dirname(abs(retired.slug))]);
  commit("fixture-withdrawer", `retire: ${retired.slug} (pos142 fixture)`);
  git(repo, ["tag", B_TAG]);
  const commits = git(repo, ["log", "--format=%H", `${shaA}..${B_TAG}`]).trim().split("\n").reverse();

  const owners = new Set([...seed.marks.map((m) => m.owner), sibling.owner]);
  const roll = Object.fromEntries([...owners].map((o) => [`h-${o}`, [o]]));
  const genesis = { ...seed.window, status: "closed" };
  const open = { id: genesis.id + 1, status: "open", opens_at: genesis.closes_at, closes_at: new Date(Date.now() + 864e5).toISOString() };
  const makeStore = () => fakeStore({
    marks: seed.marks.map((m) => structuredClone(m)),
    claims: seed.claims.map((c) => ({ id: c.id })),
    windows: [genesis, open], roll,
  });

  const mf = await import(pathToFileURL(join(repo, "tools", "marks-fold.mjs")).href);
  const { deriveLaw } = await import("../world2/tools/law-ingest.mjs");
  const law = await deriveLaw({ lawRepo: repo });
  const terrain = JSON.parse(readFileSync(join(repo, "WORLD", "skeleton.json"), "utf8"));
  const hhPath = join(repo, "WORLD", "households.json");
  const households = existsSync(hhPath) ? (JSON.parse(readFileSync(hhPath, "utf8")).households ?? null) : null;
  fx = {
    repo, shaA, commits, amended: amended.slug, added, retired: retired.slug, makeStore, genesis, open,
    mf, terrain, households, lawRows: JSON.parse(JSON.stringify((law.rows ?? law).filter((r) => r.kind === "class"))),
    fileFold: null,
  };
  fx.fileFold = mf.fold({ marks: mf.loadMarks(join(repo, "WORLD", "marks")), terrain, stakes: [], households });
});

after(() => { if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

/** #173's diff, verbatim in shape: every difference between two folds, mark-keyed first. */
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
  return out;
}
const rowsFold = (store) => {
  const { mf, terrain, households, lawRows, fileFold } = fx;
  const rows = mf.fold({ marks: marksFromRows(store.standingRows(), lawRows), terrain, stakes: [], households });
  rows.marks = inPublishedOrder(rows.marks, fileFold.marks.map((m) => m.id));
  return rows;
};

// ── the falsifier ───────────────────────────────────────────────────────────

test("CAN FAIL — before the ingest, the equality is red on exactly the three marks B changed", { skip: WHY_SKIP }, () => {
  const diffs = foldDiffs(fx.fileFold, rowsFold(fx.makeStore()));
  const named = new Set(diffs.map((d) => d.match(/@ (\S+?):/)?.[1]).filter(Boolean));
  for (const slug of [fx.amended, fx.added, fx.retired]) assert.ok(named.has(slug), `the equality could not see ${slug}:\n  ${diffs.slice(0, 8).join("\n  ")}`);
  assert.ok(diffs.includes(`marks @ ${fx.added}: in the file's fold, absent from the rows fold`), "the added mark reads as absent");
  assert.ok(diffs.includes(`marks @ ${fx.retired}: in the rows fold, absent from the file's fold`), "the retired mark reads as extra");
});

test("--dry-run names exactly the three changes, each with its commit, and writes nothing", { skip: WHY_SKIP }, async (t) => {
  __clearHouseCache?.();
  const store = fx.makeStore();
  const before_ = structuredClone(store.state.marks);
  const r = await ingest(store.client, { worldRepo: fx.repo, ref: B_TAG, dryRun: true });
  assert.equal(r.status, "dry-run", r.receipt);
  t.diagnostic(r.receipt);
  assert.deepEqual(r.plan.adds.map((a) => a.slug), [fx.added]);
  assert.deepEqual(r.plan.amends.map((a) => a.slug), [fx.amended]);
  assert.deepEqual(r.plan.retires.map((a) => a.slug), [fx.retired]);
  assert.deepEqual(r.plan.stops, []);
  assert.ok(r.plan.amends[0].fields.includes("image") && r.plan.amends[0].fields.includes("body"), `amend fields: ${r.plan.amends[0].fields}`);
  // each change names the commit that carried it, not merely one in the range
  assert.equal(r.plan.amends[0].commit.sha, fx.commits[0]);
  assert.equal(r.plan.adds[0].commit.sha, fx.commits[1]);
  assert.equal(r.plan.retires[0].commit.sha, fx.commits[2]);
  for (const slug of [fx.added, fx.amended, fx.retired]) assert.match(r.receipt, new RegExp(slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(store.writes, [], "a dry run issued a write");
  assert.deepEqual(store.state.marks, before_, "a dry run moved the store");
  assert.equal(store.head(), null);
});

test("THE EQUALITY — after `marks-ingest --ref B`, fold(rows) deep-equals fold(files at B); a second run is a no-op", { skip: WHY_SKIP }, async () => {
  __clearHouseCache?.();
  const store = fx.makeStore();
  const r = await ingest(store.client, { worldRepo: fx.repo, ref: B_TAG });
  assert.equal(r.status, "ingested", r.receipt);

  const rows = rowsFold(store);
  const diffs = foldDiffs(fx.fileFold, rows);
  assert.equal(diffs.length, 0, `${diffs[0]}\n  — ${diffs.length} difference(s) after the ingest:\n  ${diffs.slice(0, 20).join("\n  ")}`);
  assert.deepStrictEqual(rows, fx.fileFold);

  // the stored shapes: add, amend (supersede), retire — each with its provenance
  const bSha = git(fx.repo, ["rev-parse", B_TAG]).trim();
  const add = store.bySlug(fx.added);
  assert.equal(add.status, "standing");
  assert.equal(add.locked_window, fx.open.id);
  assert.equal(add.data._ingested_from.sha, fx.commits[1]);
  assert.equal(add.data._ingested_from.ref_sha, bSha);
  const am = store.bySlug(fx.amended);
  assert.equal(am.locked_window, fx.open.id, "an amend is ruled at the ingest's window");
  assert.equal(am.data._ingested_from.sha, fx.commits[0]);
  const amClaim = store.claim(amendClaimId(fx.amended, bSha));
  assert.ok(amClaim, "the amend is its own claim — every version stays in the log");
  assert.equal(String(amClaim.supersedes), String(am.id), "the amend's claim supersedes the standing mark");
  assert.equal(store.state.marks.filter((m) => m.slug === fx.amended).length, 1, "one copy, ever");
  const gone = store.bySlug(fx.retired);
  assert.equal(gone.status, "retired");
  assert.equal(gone.retired_window, fx.open.id);
  assert.equal(gone.data._ingested_from.sha, fx.commits[2]);
  assert.equal(store.head(), bSha, "the head is at B");

  const writes = store.writes.length;
  const again = await ingest(store.client, { worldRepo: fx.repo, ref: B_TAG });
  assert.equal(again.status, "noop", again.receipt);
  assert.equal(store.writes.length, writes, "the second run wrote");
});

// ── the plan's gates, without a world ──────────────────────────────────────

const row = (slug, over = {}) => ({
  id: `id-${slug}`, slug, kind: "sited", owner: slug.split("/")[0], household: "h", body: "b",
  geometry: { at: { x: 0, y: 0 }, extent: { w: 1, h: 1 } }, bbox: "(1,1),(0,0)", parent: null,
  status: "standing", locked_window: 1, locked_at: "2026-08-28T00:00:00.000Z", data: { date: "2026-07-01", tier: "market" }, ...over,
});
const C = (sha, at = "2026-09-10T00:00:00.000Z") => ({ sha, author: "a", at, subject: "s" });

test("the range gate: a differing row with no commit since the head, or ruled after the file's change, is SKIPPED with its reason", () => {
  const derived = [row("a/x", { body: "file" }), row("a/y", { body: "file" })];
  const store = [row("a/x", { body: "store" }), row("a/y", { body: "door", locked_window: 205, locked_at: "2026-09-22T00:00:00.000Z" })];
  const plan = planIngest({
    derived, storeRows: store, pathAtRef: new Map([["a/x", "p/x"], ["a/y", "p/y"]]), pathAtBase: null,
    commitFor: ({ path, range }) => (path === "p/y" && range ? C("c-y") : null),
  });
  assert.deepEqual(plan.amends, []);
  assert.deepEqual(plan.skipped.map((s) => s.slug), ["a/x", "a/y"]);
  assert.match(plan.skipped[0].why, /no commit since the head/);
  assert.match(plan.skipped[1].why, /the door's later word stands/);
});

test("STOPs: a file-side mark the store holds retired, and a parent the store cannot point at", () => {
  const plan = planIngest({
    derived: [row("a/x"), row("a/child", { kind: "predicated", geometry: null, parent: "id-a/nowhere" })],
    storeRows: [row("a/x", { status: "retired", retired_window: 9 })],
    pathAtRef: new Map([["a/x", "p/x"], ["a/child", "p/c"]]), pathAtBase: null,
    commitFor: () => C("c1"),
  });
  assert.equal(plan.stops.length, 2, plan.stops.join("\n"));
  assert.match(plan.stops.join("\n"), /holds it RETIRED/);
  assert.match(plan.stops.join("\n"), /non-deferrable foreign key/);
});

test("a retire needs the mark in the file at the base: a store row the file never had is the door's, untouched", () => {
  const plan = planIngest({
    derived: [], storeRows: [row("a/door-made"), row("a/deleted")],
    pathAtRef: new Map(), pathAtBase: new Map([["a/deleted", "p/d"]]),
    commitFor: ({ deleted }) => (deleted ? C("c-del") : null),
  });
  assert.deepEqual(plan.retires.map((r) => r.slug), ["a/deleted"]);
});

// The hold is a MECHANISM, kept empty. These legs pin it with a synthetic name,
// never a real mark's, so a later hold or a later lift moves no assertion here.
test("HELD by name: a held slug is never written, in either arm, and says why", () => {
  const held = new Set(["zz-fixture/held-by-name"]);
  const plan = planIngest({
    derived: [row("zz-fixture/held-by-name")], storeRows: [row("zz-fixture/held-gone")],
    pathAtRef: new Map([["zz-fixture/held-by-name", "p"]]), pathAtBase: new Map([["zz-fixture/held-gone", "p/g"]]),
    commitFor: () => C("c1"), held: new Set([...held, "zz-fixture/held-gone"]),
  });
  assert.deepEqual(plan.adds, []);
  assert.deepEqual(plan.retires, []);
  assert.deepEqual(plan.held.map((h) => h.slug), ["zz-fixture/held-by-name", "zz-fixture/held-gone"]);
  assert.ok(plan.held.every((h) => /HELD by the founder's word/.test(h.why)));
});

test("HELD by name: the default is backfill-register's own set, imported — one place a hold is laid or lifted", () => {
  const slug = "zz-fixture/held-through-the-import";
  const args = () => ({ derived: [row(slug)], storeRows: [], pathAtRef: new Map([[slug, "p"]]), commitFor: () => C("c1") });
  assert.deepEqual(planIngest(args()).adds.map((a) => a.slug), [slug], "not held: it plans in");
  REFUSED_BY_NAME.add(slug);
  try {
    const plan = planIngest(args());
    assert.deepEqual(plan.adds, []);
    assert.deepEqual(plan.held.map((h) => h.slug), [slug]);
  } finally { REFUSED_BY_NAME.delete(slug); }
});

// RULED 2026-09-24 (Keemin: "meant keep it in!"): the lit-name is no longer held.
test("the lit-name comes in: planIngest plans wright/the-lit-name as an ADD, and the set holds nothing", () => {
  const slug = "wright/the-lit-name";
  const plan = planIngest({
    derived: [row(slug, { kind: "naming" })], storeRows: [], pathAtRef: new Map([[slug, "WORLD/marks/wright/the-unlit-cake/the-lit-name/mark.md"]]),
    commitFor: () => C("c-lit"),
  });
  assert.deepEqual(plan.held, [], "nothing is held");
  assert.deepEqual(plan.adds.map((a) => a.slug), [slug], "the lit-name plans in");
  assert.equal(plan.adds[0].commit.sha, "c-lit", "with the commit that carried its file");
  assert.equal(REFUSED_BY_NAME.size, 0, "the refused set is empty today");
});

// POS-142, 2026-09-24: Wright's interim, which Keemin approved ("I agree. good to
// have a lane build it tonight"): the town's marks keep `solo:the-town` by name.
// The dev sandbox run refused whole at NO_SUCH_HOUSE on six
// town adds; the fixture above never met it because its roll names every owner,
// the town included. This roll is the real one's shape: the town is not on it.
test("THE TOWN'S MARK comes in: a town add plans AND applies through the stub as `solo:the-town`, on a roll that does not name the town", async () => {
  __clearHouseCache?.();
  const slug = "the-town/zz-fixture-town-law";
  const derived = [row(slug, { kind: "predicated", geometry: null, bbox: null, owner: "the-town", household: "solo:the-town",
    data: { date: "2026-09-24", tier: "constitution" } })];
  const plan = planIngest({ derived, storeRows: [], pathAtRef: new Map([[slug, "p/town"]]), commitFor: () => C("c-town") });
  assert.deepEqual(plan.adds.map((a) => a.slug), [slug], "the town's add plans in");
  assert.deepEqual(plan.stops, []);

  const open = { id: 7, status: "open", opens_at: "2026-09-24T00:00:00.000Z", closes_at: "2026-09-25T00:00:00.000Z" };
  const store = fakeStore({ marks: [], claims: [], windows: [open], roll: { berthillon: ["berthillon"] } });
  const applied = await applyIngest(store.client.query, plan, { windowId: 7, target: { ref: "B", sha: "b".repeat(40) } });
  assert.equal(applied.materialized, 1);
  const m = store.bySlug(slug);
  assert.equal(m.owner, "the-town");
  assert.equal(m.household, "solo:the-town", "the town's mark is filed under the one spelling the pen still writes for it");
  assert.equal(m.status, "standing");
  assert.equal(m.locked_window, 7);

  // and the exception is the town's alone: a resident the roll does not name still refuses the whole apply
  __clearHouseCache?.();
  const stranger = "vireo/zz-fixture-stranger";
  const plan2 = planIngest({ derived: [row(stranger, { kind: "predicated", geometry: null, bbox: null })], storeRows: [],
    pathAtRef: new Map([[stranger, "p/s"]]), commitFor: () => C("c-s") });
  const store2 = fakeStore({ marks: [], claims: [], windows: [open], roll: { berthillon: ["berthillon"] } });
  await assert.rejects(() => applyIngest(store2.client.query, plan2, { windowId: 7, target: { ref: "B", sha: "b".repeat(40) } }),
    (e) => e.code === 404 && /vireo/.test(e.detail ?? e.message));
  assert.equal(store2.bySlug(stranger), undefined, "the stranger's mark was written");
});

test("recordDiff compares the record, not the store's stamps", () => {
  assert.deepEqual(recordDiff({ id: "a", image: "x", _fileAt: 1 }, { id: "a", image: "x", locked_by: "founder", _act_id: "9", _ingested_from: {} }), []);
  assert.deepEqual(recordDiff({ id: "a", image: "x" }, { id: "a" }), ["image"]);
  assert.deepEqual(recordDiff({ id: "a", _parentMarkId: "p" }, { id: "a", _parentMarkId: "q" }), ["_parentMarkId"]);
  assert.equal(isRecordField("source", "LOGOS/classes.md"), true, "a resident's source line counts");
  assert.equal(isRecordField("source", { sha: "x" }), false, "the old stamp does not");
});
