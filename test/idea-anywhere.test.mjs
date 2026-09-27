// idea-anywhere.test.mjs — AN IDEA MAY STAND ANYWHERE, and the Tank reads by
// instance rather than by geometry.   node --test test/idea-anywhere.test.mjs
//
// ── THE LAW, quoted, not paraphrased ────────────────────────────────────────
//
// The founder, 2026-09-01 morning, ruling on an idea planted in the Garrison —
// feature, not bug:
//
//   "class says what a mark is; the Think Tank is where ideas are READ, not a
//    container that makes them ideas."
//
// and, ten minutes later, the half that makes the row shape matter:
//
//   "Ideas can be predicates."
//
// ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
//
// The repealed reading joined `contains` from the tank's ground, so an idea its
// author stood anywhere else was not merely filed oddly — it was invisible to
// `town read: "ideas"`, to the doorstep's first-idea row, and to the crossing
// sweep that MINTS 5✦ for it. Reproduced on a store hydrated from world main
// fdca66cc, before anything was changed: an idea standing in the Protected
// Grove came back in 0 of 6 tank rows and drew 0 of 1 planned mints. That is
// the whole reason the join moved, so the money is falsified here rather than
// only in a report.
//
// ── WHY THE FIXTURE LOOKS LIKE THIS ─────────────────────────────────────────
//
// The store keys a class mark as `subkind: 'class'` and a predicated mark as
// `subkind: 'predicated'`, with `kind` reading 'mark' for both — the mark FILE's
// frontmatter says otherwise, so a fixture written from the record's text
// falsifies nothing. And the declaration must stand IN THE KEEPING WORKS
// (`props.in_works`), because that is half of CLASS_ROSTER_GATE_SQL. Every
// shape below was read off a store hydrated from world main before it was
// typed; `civic-asks.test.mjs § tankWith` carries the same note for the same
// reason.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { NO_TOWN, townClone } from "./fixture-paths.mjs";

const { ideasTank } = await import("../src/world-classes.mjs");
const { injectedComplete } = await import("../src/queries.mjs");
const { firstClauseOf } = await import("../src/world.mjs");

const FOUNDER_LAW =
  "class says what a mark is; the Think Tank is where ideas are READ, not a container that makes them ideas";
const PREDICATE_LAW = "Ideas can be predicates.";

const TANK = "the-town/the-think-tank";
const GARRISON = "sol-of-garrison/the-protected-grove";

// ── the store, built the way world-hydrate.mjs builds one ───────────────────
//
// `declaration` names the id the class mark stands at. It is a PARAMETER
// because the reader must FIND the declaration through the roster gate rather
// than hold `the-town/idea` as a literal — a store that re-files its own
// constitution must not empty the Think Tank.
function storeWith(ideas, { declaration = "the-town/idea", declare = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "idea-anywhere-"));
  const path = join(dir, "world.db");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
           CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, subkind TEXT, tier TEXT, by TEXT,
                               at_x REAL, at_y REAL, extent_w REAL, extent_h REAL, props TEXT);
           CREATE TABLE edges (seq INTEGER PRIMARY KEY AUTOINCREMENT,
                               src TEXT, dst TEXT, type TEXT, props TEXT, born_at TEXT)`);
  db.prepare("INSERT INTO meta (key, value) VALUES ('hydration_status','OK')").run();
  if (declare)
    db.prepare(`INSERT INTO nodes (id, kind, subkind, tier, by, props) VALUES (?, 'mark', 'class', 'constitution', 'the-town', ?)`)
      .run(declaration, JSON.stringify({ class: "idea", in_works: 1, body: "an idea is a resident's ask of the town" }));
  for (const place of [TANK, GARRISON])
    db.prepare("INSERT INTO nodes (id, kind, tier, by, props) VALUES (?, 'mark', 'constitution', 'the-town', '{}')").run(place);
  const n = db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, props) VALUES (?, 'mark', ?, 'market', ?, ?)");
  const inst = db.prepare("INSERT INTO edges (src, dst, type) VALUES (?, ?, 'instance-of')");
  const place = db.prepare("INSERT INTO edges (src, dst, type) VALUES (?, ?, ?)");
  for (const i of ideas) {
    const predicated = i.about !== undefined;
    n.run(i.id, predicated ? "predicated" : "sited", i.by,
      JSON.stringify({ class: "idea", body: i.body ?? "a thought", date: i.date ?? "2026-09-01" }));
    if (i.instance !== false) inst.run(i.id, declaration);
    if (predicated) place.run(i.about, i.id, "describes");
    else if (i.ground !== null) place.run(i.ground ?? TANK, i.id, "contains");
  }
  db.close();
  return { path, cleanup: () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows keeps the handle; the OS gets it */ } } };
}

const ids = (t) => t.ideas.map((i) => i.id);
const row = (t, id) => t.ideas.find((i) => i.id === id) ?? null;

// ═══════════════════════════════════════════════════════════════════════════
// PART A — the read
// ═══════════════════════════════════════════════════════════════════════════

test(`AN IDEA STANDING OFF THE TANK IS AN IDEA — "${FOUNDER_LAW}"`, () => {
  const { path, cleanup } = storeWith([
    { id: "wright/a-newcomers-first-hour", by: "wright" },
    { id: "alden/a-bench-at-the-garrison-gate", by: "alden", ground: GARRISON },
  ]);
  try {
    const t = ideasTank({ worldDb: path });
    assert.equal(t.source, "store");
    assert.equal(t.ideas.length, 2, `read ${t.ideas.length} rows: ${ids(t).join(", ")}`);
    assert.ok(ids(t).includes("alden/a-bench-at-the-garrison-gate"),
      "the Garrison idea is on the lane — the ground it stands on is not what makes it an idea");
    assert.equal(row(t, "alden/a-bench-at-the-garrison-gate").standing_at, GARRISON,
      "…and the row says WHERE it stands, so nothing downstream has to guess");
    assert.equal(row(t, "wright/a-newcomers-first-hour").standing_at, TANK,
      "an idea in the Tank reads exactly the same way — one field, one meaning");
  } finally { cleanup(); }
});

test(`AN IDEA MAY BE A PREDICATE — "${PREDICATE_LAW}" — and standing_at is the mark it is an idea OF`, () => {
  const { path, cleanup } = storeWith([
    { id: "alta-of-garrison/a-second-mooring", by: "alta-of-garrison", about: "alta-of-garrison/the-brass-otter-mooring" },
  ]);
  try {
    const t = ideasTank({ worldDb: path });
    assert.equal(t.ideas.length, 1, `read ${t.ideas.length} rows: ${ids(t).join(", ")}`);
    // The join carries NO kind clause on purpose: instance-of does not care what
    // kind a mark is, so a predicated idea needed nothing loosened to arrive.
    assert.equal(row(t, "alta-of-garrison/a-second-mooring").standing_at, "alta-of-garrison/the-brass-otter-mooring",
      "a predicated idea stands UNDER the mark it describes, and that is the same question standing_at answers for ground");
  } finally { cleanup(); }
});

test("THE READER ASKS NOTHING ABOUT GEOMETRY — a predicated idea has no `at` AT ALL, not a null one", () => {
  // From the world lane, measured, 2026-09-01: in the fold and in the store a
  // predicated mark's `at` is ABSENT, not null. So the geometryless case reads
  // as "no at key / at_x IS NULL", and any row filter phrased `row.at === null`
  // — or worse, `row.at` truthiness — would silently drop every predicated idea
  // while the suite stayed green. This reader selects no geometry column; this
  // falsifier is what makes adding one break something.
  const { path, cleanup } = storeWith([
    { id: "alta-of-garrison/a-second-mooring", by: "alta-of-garrison", about: "alta-of-garrison/the-brass-otter-mooring" },
  ]);
  try {
    const r = row(ideasTank({ worldDb: path }), "alta-of-garrison/a-second-mooring");
    assert.ok(r, "a geometryless idea is on the lane");
    assert.ok(!("at" in r), `the row carries no geometry to be tempted by: ${Object.keys(r).join(", ")}`);
  } finally { cleanup(); }
});

test("THE LAW SENTENCE IS THE STORE'S BYTES — never a copy typed into the office", () => {
  // The 08-31 lesson, kept: a value that exists in two places with no comparator
  // between them has already drifted. The founder rewrote this class's body on
  // 2026-09-01; nothing here had to change, because nothing here holds it.
  const { path, cleanup } = storeWith([]);
  try {
    assert.equal(ideasTank({ worldDb: path }).law, "an idea is a resident's ask of the town",
      "whatever the record says is what the door says — the fixture's sentence is arbitrary on purpose");
  } finally { cleanup(); }
});

test("THE DECLARATION IS NOT ONE OF ITS OWN INSTANCES — a class mark carries the class it defines", () => {
  const { path, cleanup } = storeWith([{ id: "wright/a-newcomers-first-hour", by: "wright" }]);
  try {
    const t = ideasTank({ worldDb: path });
    assert.ok(!ids(t).includes("the-town/idea"),
      "the-town/idea carries class: idea and DEFINES it — a filter on the class value alone sweeps the constitution in beside the ideas");
    assert.equal(t.law, "an idea is a resident's ask of the town",
      "…and the same node is still where the lane's law sentence is quoted from");
  } finally { cleanup(); }
});

test("THE CLASS NODE IS FOUND, NEVER ASSUMED — a re-filed declaration still opens the lane", () => {
  const { path, cleanup } = storeWith(
    [{ id: "wright/a-newcomers-first-hour", by: "wright" }],
    { declaration: "the-town/the-idea-class" });
  try {
    const t = ideasTank({ worldDb: path });
    assert.equal(t.ideas.length, 1,
      "the reader resolved the declaration through the roster gate — an id written into the query would have emptied the tank here");
  } finally { cleanup(); }
});

test("NO DECLARATION IN THE RECORD is an EMPTY tank, not a floor read", () => {
  const { path, cleanup } = storeWith([{ id: "wright/a-newcomers-first-hour", by: "wright" }], { declare: false });
  try {
    const t = ideasTank({ worldDb: path });
    assert.deepEqual(t.ideas, []);
    // The distinction the whole file family exists to keep: "I read the record
    // and the class is not declared" is not "I could not read the record".
    assert.equal(t.source, "store", "the store answered; a floor read here would blame an outage for a record's silence");
    assert.equal(t.disclosed, undefined);
  } finally { cleanup(); }
});

test("standing_at is NULL for an idea the fold has not placed yet — and null is not 'nowhere'", () => {
  // Containment is emitted at the settlement (WORLD/containment.json), so a
  // freshly published idea genuinely has no placement edge until the crossing.
  const { path, cleanup } = storeWith([{ id: "rei/posted-five-minutes-ago", by: "rei", ground: null }]);
  try {
    const t = ideasTank({ worldDb: path });
    assert.equal(t.ideas.length, 1, "an unplaced idea is still an idea — it is on the lane the moment the store carries it");
    assert.equal(row(t, "rei/posted-five-minutes-ago").standing_at, null);
  } finally { cleanup(); }
});

test("THE ORDER IS THE RECORD'S — by date then id, unchanged by where anything stands", () => {
  const { path, cleanup } = storeWith([
    { id: "b/second", by: "b", date: "2026-09-01", ground: GARRISON },
    { id: "a/first", by: "a", date: "2026-08-30" },
  ]);
  try {
    assert.deepEqual(ids(ideasTank({ worldDb: path })), ["a/first", "b/second"]);
  } finally { cleanup(); }
});

// ═══════════════════════════════════════════════════════════════════════════
// PART A's consumers — the two that decide what a resident is told and paid
// ═══════════════════════════════════════════════════════════════════════════

test("THE DOORSTEP ROW: an idea standing off the Tank settles first-idea — the row that PAYS", () => {
  const { path, cleanup } = storeWith([{ id: "alden/a-bench-at-the-garrison-gate", by: "alden", ground: GARRISON }]);
  try {
    assert.deepEqual(injectedComplete("alden", { worldDb: path, house: ["alden"] }), { "first-idea": true },
      "alden published an idea; telling him to go publish one would be the door disbelieving the record");
    assert.deepEqual(injectedComplete("rei", { worldDb: path, house: ["rei"] }), { "first-idea": false },
      "…and a household that has not published is still told so — the two answers differ, which is what makes the true one worth anything");
  } finally { cleanup(); }
});

// THE ONE THAT PAYS MONEY. The sweep is given no `ideas` override: it must
// reach the tank through `ideasTank` itself, or this test cannot see the seam.
// The engine is the town train's own stamp-mint (real law, no fake), the same
// rail first-idea-sweep.test.mjs runs on.
// It was pinned to `G:/Postmark/worktrees/town-w36/tools` — a week-36 worktree
// on one operator's disk, gone now and never on anyone else's.
const TOWN = townClone();
const TRAIN_ENGINE = TOWN && join(TOWN, "tools");
const SKIP = !TOWN && NO_TOWN;
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const penDir = mkdtempSync(join(tmpdir(), "idea-anywhere-pen-"));
const KEY = join(penDir, "stamp-key.pem");
writeFileSync(KEY, privateKey.export({ type: "pkcs8", format: "pem" }));
process.env.STAMP_KEY = KEY;
if (TRAIN_ENGINE) process.env.STAMP_ENGINE_DIR = TRAIN_ENGINE;

function foundedClone() {
  const clone = mkdtempSync(join(tmpdir(), "idea-anywhere-town-"));
  mkdirSync(join(clone, "tools"), { recursive: true });
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({ alden: 1, rei: 2 }));
  for (const [handle, login] of [["alden", "alogin"], ["rei", "rlogin"]]) {
    mkdirSync(join(clone, "WHITE_PAGES", handle), { recursive: true });
    writeFileSync(join(clone, "WHITE_PAGES", handle, "ADDRESS.md"), `---\nhandle: ${handle}\ngithub: ${login}\n---\n`);
  }
  writeFileSync(join(clone, "WHITE_PAGES", "mail-ledger.md"),
    "# ledger\n\n- 2026-06-12 · seed-1 · alden → rei · thread: new\n- 2026-06-13 · seed-2 · rei → alden · thread: new\n");
  writeFileSync(join(clone, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  execFileSync(process.execPath, [join(TRAIN_ENGINE, "stamp-mint.mjs"), "--append", "--key", KEY, "--repo", clone], { encoding: "utf8" });
  return clone;
}

test("THE CROSSING MINTS FOR AN IDEA IN THE GARRISON — the consumer that pays, read through ideasTank", { skip: SKIP }, async () => {
  const { planFirstIdeaSweep } = await import("../src/first-idea-sweep.mjs");
  const clone = foundedClone();
  const { path, cleanup } = storeWith([
    { id: "alden/a-bench-at-the-garrison-gate", by: "alden", ground: GARRISON },
    { id: "rei/a-thought-about-a-mooring", by: "rei", about: "alta-of-garrison/the-brass-otter-mooring" },
  ]);
  try {
    const plan = planFirstIdeaSweep(clone, { date: "2026-09-01", worldDb: path });
    assert.equal(plan.refused, undefined, `the plan refused: ${plan.refused}`);
    const minted = plan.mints.map((m) => m.mark).sort();
    assert.deepEqual(minted, ["alden/a-bench-at-the-garrison-gate", "rei/a-thought-about-a-mooring"],
      `planned ${plan.mints.length} mint(s) from ${plan.mints.length + plan.skipped.length} candidate(s): ${minted.join(", ")}`);
  } finally { cleanup(); rmSync(clone, { recursive: true, force: true }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// PART B — the write's derivation (the door itself is exercised live; see the
// report's refusal-parity receipt, which needs a credential and a world clone)
// ═══════════════════════════════════════════════════════════════════════════

const { townPost, leaveMarkViaOffice } = await import("../src/world.mjs");
const { resetClassRosterCache } = await import("../src/world-classes.mjs");
const POSTER = { household: "aldenhouse", handles: new Set(["alden"]) };
const caught = async (fn) => { try { await fn(); return null; } catch (e) { return { code: e.code, defect: e.defect, hint: e.hint }; } };

test("at: and on: are EXCLUSIVE — two answers to one question is not a placement", async () => {
  const b = await caught(() => townPost(
    { class: "idea", slug: "s", body: "b", at: { x: 1, y: 1 }, on: "wright/the-trueing-house" }, POSTER));
  assert.equal(b?.code, 422, `expected a 422, got ${JSON.stringify(b)}`);
  assert.match(b.hint, /an idea OF that place/);
  assert.match(b.hint, /an idea ABOUT that mark/);
});

test("extent: is REFUSED BY NAME at this door, never dropped in silence", async () => {
  const b = await caught(() => townPost({ class: "idea", slug: "s", body: "b", extent: { w: 4, h: 4 } }, POSTER));
  assert.equal(b?.code, 422, `expected a 422, got ${JSON.stringify(b)}`);
  assert.match(b.hint, /world_leave_mark/, "…and the refusal names the door that DOES take a footprint");
});

// ── REFUSAL PARITY (seam rule 4) ────────────────────────────────────────────
//
// `at` on `town do: "post"` must mean exactly what `at` means on
// `world do: "leave-mark"`, and `on` must mean exactly what `parent_id` means —
// SAME FRAME, SAME VALIDATION, SAME REFUSAL TEXT. The wrapper holds no copy of
// either rule, so the way to prove it is to put one bad input through both
// doors and compare the whole bounce. Every case below refuses inside
// leaveMarkViaOffice's validator, which runs before any clone is touched.
test("A BAD at: / on: EARNS THE WORLD DOOR'S OWN SENTENCE, byte for byte", async () => {
  const { path, cleanup } = storeWith([]);          // gives classRoster the `idea` declaration
  const prior = process.env.WORLD_STORE_DB;
  process.env.WORLD_STORE_DB = path;
  resetClassRosterCache();
  try {
    const cases = [
      ["at: is not a point",
        { class: "idea", slug: "s", body: "b", at: { x: "east", y: 3 } },
        { by: "alden", slug: "s", kind: "sited", at: { x: "east", y: 3 }, extent: { w: 1, h: 1 }, body: "b", class: "idea", stamps: 1 }],
      ["on: names no mark",
        { class: "idea", slug: "s", body: "b", on: "" },
        { by: "alden", slug: "s", kind: "predicated", parent_id: "", slot: "idea", value: "b", body: "b", class: "idea", stamps: 1 }],
      ["the claim is over the cap",
        { class: "idea", slug: "s", body: "x".repeat(151), at: { x: 1, y: 1 } },
        { by: "alden", slug: "s", kind: "sited", at: { x: 1, y: 1 }, extent: { w: 1, h: 1 }, body: "x".repeat(151), class: "idea", stamps: 1 }],
    ];
    for (const [name, postArgs, leaveArgs] of cases) {
      const viaPost = await caught(() => townPost(postArgs, POSTER));
      const viaWorld = await caught(() => leaveMarkViaOffice("Z:/nowhere/no-clone", leaveArgs, POSTER));
      assert.ok(viaPost, `${name}: the post door did not refuse at all`);
      assert.deepEqual(viaPost, viaWorld, `${name}: the two doors gave different refusals`);
    }
  } finally { process.env.WORLD_STORE_DB = prior; delete process.env.WORLD_STORE_DB_NOOP; resetClassRosterCache(); cleanup(); }
});

test("on: derives the predicate VALUE from the claim's first clause, and falls back to the slug", () => {
  assert.equal(firstClauseOf("Parcel post: let the ferry carry a thing, not just a word.", "parcel-post"), "Parcel post");
  assert.equal(firstClauseOf("A weekly market — a recurring bench where residents sell", "weekly-market"), "A weekly market");
  // No clause break and too long to be a value: the id the mark already carries
  // beats a value derived from nothing.
  assert.equal(
    firstClauseOf("a long unbroken claim that runs past sixty characters without any punctuation at all", "long-claim"),
    "long-claim");
  assert.equal(firstClauseOf("", "empty-body"), "empty-body");
});
