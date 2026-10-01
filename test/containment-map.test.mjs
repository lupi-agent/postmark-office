// containment-map.test.mjs — THE FREEZE, over a real hydration.
//
//   node --test test/containment-map.test.mjs
//
// THE LAW, quoted verbatim (LOGOS/state-and-time.md § "The freeze — filing is
// static, and the tree is a fossil"; founder-ruled 2026-08-25, world 258af3d6):
//
//   "Filing is frozen as of 2026-08-25. A mark's directory is its historical
//    filing: it carries no claim, and it never moves again. New marks are filed
//    by identity — WORLD/marks/<household>/<slug>/ — and containment lives only
//    in the derived fold, emitted as an artifact each settlement."
//
//   "'The tree is the map' moves to where derived views live: the fold emits the
//    containment map beside `world-state.json` every settlement. The browsable
//    truth is generated; the source files rest."
//
// The unit falsifiers for the write door and the class gate are in
// static-filing.test.mjs. This file asserts the one thing they cannot: that the
// REAL hydrator, over a REAL git world, builds `contains` from the map — and
// that a clone without one falls back to the repealed law LOUDLY rather than
// quietly.
//
// The fixture is a synthetic world: a root, a town centre and the Keeping Works
// filed the pre-freeze way, plus two town-authored constitution-tier
// verb-minting marks FILED AT THEIR IDS — one standing in the works by geometry,
// one outside it. Neither of their paths contains the string "the-keeping-works",
// which is the whole point: under the repealed law the first would have declared
// nothing, silently.
//
// `WORLD/containment.json` is written by hand here. That is the right boundary:
// this is the office's half, and the office's contract is to believe the
// artifact the settlement emitted. The last test asserts the office is reading
// the REAL file's shape rather than a convenient fiction. Separately, measured
// over the freeze-day tree before any of this was written: chain-membership and
// the old path substring select the same 330 marks, zero either way.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { writeFixtureDb } from "./helpers/world-rows.mjs";

import { CLASS_MARK_GATE_SQL, WORLD_CLONE } from "../src/world-store.mjs";

const OFFICE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HAVE_WORLD = existsSync(join(WORLD_CLONE, "tools", "marks-fold.mjs"));

const gitq = (dir, args) => execFileSync("git", ["-C", dir, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
});

/** A world fixture, in two commits — the hydrator refuses a history it cannot walk. */
function buildFixtureWorld({ withMap }) {
  const dir = mkdtempSync(join(tmpdir(), "pm-freeze-"));
  // The hydrator imports the fold and the geometry FROM THE TREE IT INDEXES,
  // never a vendored copy, so the fixture needs the world's own tools.
  cpSync(join(WORLD_CLONE, "tools"), join(dir, "tools"), { recursive: true });

  const mark = (rel, front, body) => {
    mkdirSync(join(dir, "WORLD", "marks", rel), { recursive: true });
    writeFileSync(join(dir, "WORLD", "marks", rel, "mark.md"), `---\n${front}\n---\n\n${body}\n`);
  };

  mark("let-there-be-light",
    "kind: sited\nby: the-town\ntier: constitution\ndate: 2026-07-22\nat: { x: 0, y: 0 }\nextent: { w: 320000, h: 320000 }\ncoords: relative",
    "Let there be light.");
  mark("let-there-be-light/the-town-centre",
    "kind: sited\nby: the-town\ntier: constitution\ndate: 2026-07-23\nat: { x: 0, y: 0 }\nextent: { w: 4000, h: 4000 }",
    "The town centre.");
  mark("let-there-be-light/the-town-centre/the-keeping-works",
    "kind: sited\nby: the-town\ntier: constitution\ndate: 2026-08-01\nat: { x: 0, y: 0 }\nextent: { w: 800, h: 800 }",
    "The Keeping Works.");
  gitq(dir, ["init", "-q", "."]);
  gitq(dir, ["add", "-A"]);
  gitq(dir, ["commit", "-qm", "the tree as the freeze left it"]);

  // Filed by identity. `a-new-law` sits at (10,10) — inside the works' 800x800
  // square at the origin. `a-far-law` at (1500,1500) — inside the town centre,
  // well outside the works.
  mark("the-town/a-new-law",
    'kind: sited\nby: the-town\ntier: constitution\ndate: 2026-08-26\nat: { x: 10, y: 10 }\nextent: { w: 4, h: 4 }\nclass: bounty\nactions: [{"action": "post", "residue": "the-town/post"}]',
    "A law filed at its id, standing in the Keeping Works by containment.");
  mark("the-town/a-far-law",
    'kind: sited\nby: the-town\ntier: constitution\ndate: 2026-08-26\nat: { x: 1500, y: 1500 }\nextent: { w: 4, h: 4 }\nclass: errand\nactions: [{"action": "run", "residue": "the-town/run"}]',
    "A law filed at its id, standing outside the Keeping Works.");

  if (withMap) {
    const row = (id, parent, chain) => ({ id, parent, chain });
    const ROOT = "the-town/let-there-be-light", CENTRE = "the-town/the-town-centre", WORKS = "the-town/the-keeping-works";
    writeFileSync(join(dir, "WORLD", "containment.json"), JSON.stringify({
      law: "The tree is the map - derived, never stored. Filing froze 2026-08-25; a mark's directory claims nothing.",
      source: "LOGOS/state-and-time.md, the-town/the-frozen-filing",
      count: 5,
      marks: [
        row("the-town/a-far-law", CENTRE, [CENTRE, ROOT]),
        row("the-town/a-new-law", WORKS, [WORKS, CENTRE, ROOT]),
        row(ROOT, null, []),
        row(WORKS, CENTRE, [CENTRE, ROOT]),
        row(CENTRE, ROOT, [ROOT]),
      ],
    }, null, 2));
  }
  gitq(dir, ["add", "-A"]);
  gitq(dir, ["commit", "-qm", withMap ? "filed at their ids, and the fold's map" : "filed at their ids, and NO map"]);
  return dir;
}

function hydrateFixture(worldDir) {
  const dbPath = join(worldDir, "world.db");
  // BOTH STREAMS. The gate ledger's ABSENT lines and the hydrator's warnings go
  // to stderr; reading stdout alone would let a fallback pass unnoticed here —
  // which is the exact failure the loud fallback exists to prevent.
  const r = spawnSync(process.execPath,
    [join(OFFICE, "src", "world-hydrate.mjs"), "--world", worldDir, "--no-db", "--rows-out", `${dbPath}.rows.json`, "--office", OFFICE, "--no-lints", "--no-gexf"],
    { encoding: "utf8" });
  if (r.status !== 0) assert.fail(`hydration exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  const out = `${r.stdout}\n${r.stderr}`;
  // The hydration emits ROWS (POS-270 lane W 3a); the file asked here is this
  // test's own, built from them, never one the office writes or opens.
  writeFixtureDb(`${dbPath}.rows.json`, dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const containsEdges = db.prepare("SELECT src, dst, props FROM edges WHERE type = 'contains' ORDER BY dst").all()
    .map((r) => ({ parent: r.src, child: r.dst, props: JSON.parse(r.props) }));
  const marks = Object.fromEntries(db.prepare(
    "SELECT id, json_extract(props,'$.path') p, json_extract(props,'$.in_works') w, json_extract(props,'$.declares') d FROM nodes WHERE kind='mark'")
    .all().map((r) => [r.id, { path: r.p, in_works: r.w, declares: r.d }]));
  const minting = db.prepare(`SELECT id FROM nodes WHERE ${CLASS_MARK_GATE_SQL}`).all().map((r) => r.id);
  db.close();
  return { out, containsEdges, marks, minting };
}

test("the fold's map is the office's containment: an id-filed mark's contains edge names its GEOMETRIC container",
  { timeout: 180_000 }, (t) => {
    if (!HAVE_WORLD) return t.skip(`no world clone at ${WORLD_CLONE}`);
    const dir = buildFixtureWorld({ withMap: true });
    try {
      const { out, containsEdges, marks, minting } = hydrateFixture(dir);

      assert.match(out, /contains from containment-map/,
        "the hydration must SAY which question it asked — a silent source is the freeze quietly not applying");

      // The root is the map's `parent: null` row, not "the mark with no mark.md
      // above it" — which after the freeze is true of every id-filed mark too.
      assert.doesNotMatch(out, /expected one root mark/,
        "two marks filed at their ids must not read as two extra world roots");

      // Its directory is WORLD/marks/the-town/a-new-law, nested inside nothing.
      // Directory nesting would have given it no parent at all.
      assert.equal(marks["the-town/a-new-law"].path, "WORLD/marks/the-town/a-new-law");
      const law = containsEdges.find((e) => e.child === "the-town/a-new-law");
      assert.ok(law, "an id-filed mark got NO contains edge — this is the orphaning the re-key exists to end");
      assert.equal(law.parent, "the-town/the-keeping-works");
      assert.equal(law.props.nesting, "containment-map");

      // The map's parent and the office's own recompute of the same geometry
      // agree. Under the map this stops being a reconciliation of a stored path
      // against the ground and becomes a machinery check of the emitted map.
      assert.equal(law.props.geometry_ok, true);
      assert.equal(law.props.placement_ok, true);

      const far = containsEdges.find((e) => e.child === "the-town/a-far-law");
      assert.equal(far.parent, "the-town/the-town-centre", "the map's answer — not the tree's, and not the root by default");

      // The gate: position by containment. Neither path names the works.
      assert.equal(marks["the-town/a-new-law"].in_works, 1);
      assert.equal(marks["the-town/a-new-law"].declares, 1);
      assert.equal(marks["the-town/a-far-law"].in_works, 0);
      assert.deepEqual(minting, ["the-town/a-new-law"],
        "a class-carrying mark filed at its id inside the works must mint its verb, and one outside must not");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

test("THE FLIP — a clone with NO map falls back to directory nesting, and says so out loud",
  { timeout: 180_000 }, (t) => {
    if (!HAVE_WORLD) return t.skip(`no world clone at ${WORLD_CLONE}`);
    const dir = buildFixtureWorld({ withMap: false });
    try {
      const { out, containsEdges, marks, minting } = hydrateFixture(dir);

      assert.match(out, /GATE ABSENT\s+containment-map/,
        "the fallback must be an ABSENT gate — a silent one is the repealed law running under the freeze's name");
      assert.match(out, /contains from directory-nesting/);

      // This is the BEFORE picture, and it is why the re-key was needed: the
      // id-filed marks are orphaned (no directory parent, so no edge at all),
      // and the law standing in the works mints nothing because its path does
      // not carry the substring.
      assert.equal(containsEdges.find((e) => e.child === "the-town/a-new-law"), undefined);
      assert.equal(marks["the-town/a-new-law"].in_works, 0);
      assert.deepEqual(minting, []);

      // THE ROOT IS NAMED, NOT INFERRED — and it holds even here, where there is
      // no map to read it from. "The mark with no mark.md above it" is true of
      // every id-filed mark, so the inferred derivation would report THREE roots
      // in this fixture and alphabetical order could crown `the-town/a-far-law`
      // as the world root — which is the placement fallback for every mark below
      // it. The fold exports `worldRootOf`; the hydrator asks it by name.
      assert.doesNotMatch(out, /expected one root mark/,
        "two marks filed at their ids must not read as two extra world roots, map or no map");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

test("a mark the map does not name is COUNTED, not silently dropped off every spine",
  { timeout: 180_000 }, (t) => {
    if (!HAVE_WORLD) return t.skip(`no world clone at ${WORLD_CLONE}`);
    // The one way the re-key could lose an edge in silence: the map is emitted
    // at the fold, so a record committed to main without one has a directory and
    // no containment answer. Guessing a parent for it would be worse than the
    // hole; the hole is disclosed instead. Built by DROPPING one row from an
    // otherwise-correct map, so the fallback never fires and this is the only
    // difference from the passing case above.
    const dir = buildFixtureWorld({ withMap: true });
    try {
      const mapPath = join(dir, "WORLD", "containment.json");
      const cm = JSON.parse(readFileSync(mapPath, "utf8"));
      cm.marks = cm.marks.filter((m) => m.id !== "the-town/a-new-law");
      writeFileSync(mapPath, JSON.stringify(cm, null, 2));
      gitq(dir, ["add", "-A"]);
      gitq(dir, ["commit", "-qm", "a mark the map has never heard of"]);

      const { out, containsEdges } = hydrateFixture(dir);
      assert.match(out, /contains from containment-map/, "the map is still the source — this is not the fallback in disguise");
      assert.match(out, /1 geometric mark\(s\) the map does not name/,
        "the hole must be reported where a reader is already looking");
      assert.equal(containsEdges.find((e) => e.child === "the-town/a-new-law"), undefined,
        "and no parent was invented for it");
      assert.ok(containsEdges.find((e) => e.child === "the-town/a-far-law"),
        "while every mark the map DOES name still gets its edge");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

test("the office's reader matches the SHAPE the world's fold actually emits", (t) => {
  // The hand-written map above proves the office's behaviour. This proves the
  // office is reading the REAL artifact's shape: `{ marks: [{ id, parent,
  // chain }] }`, `parent: null` for the world root alone, and every chain
  // ending at that root — "a chain that stops short of the frame is a chain
  // with a hole in it".
  const real = join(WORLD_CLONE, "WORLD", "containment.json");
  if (!existsSync(real)) return t.skip(`no containment.json in ${WORLD_CLONE} — the world half has not landed in this clone yet`);
  const cm = JSON.parse(readFileSync(real, "utf8"));
  assert.ok(Array.isArray(cm.marks) && cm.marks.length > 0, "marks[] must be a non-empty array");
  const roots = cm.marks.filter((m) => m.parent == null);
  assert.equal(roots.length, 1, `"parent: null belongs to the world root alone" — found ${roots.length}`);
  const rootId = roots[0].id;
  for (const m of cm.marks) {
    assert.equal(typeof m.id, "string");
    assert.ok(Array.isArray(m.chain), `${m.id} carries no chain`);
    if (m.id !== rootId) assert.equal(m.chain.at(-1), rootId, `${m.id}'s chain stops short of the frame`);
  }
});
