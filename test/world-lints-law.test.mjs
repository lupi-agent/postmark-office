// world-lints-law.test.mjs — every standing invariant cites the law it enforces.
//
// The eight questions in src/world-lints.mjs stopped being this office's own
// opinion on 2026-08-22 (world main 27d7bd9b): they are constitutional marks,
// the postmark-invariant family under the Keeping Works, each carrying
// dials {"lint": "Lx"} and one claim. Their abstraction, logos/the-invariant:
//
//   "An invariant is a standing question the town asks of itself at every fold
//    — it reports, never repairs, and names its method and its limits."
//
// So the findings must carry the mark id and quote the mark's claim, and the
// quote must be checkable rather than trusted. What is under test:
//
//   the citation   every lint runLints() emits carries `law` and `law_text`,
//                  and they equal the mark this file quotes independently.
//   the self-check a tree whose marks agree reports eight read and no drift;
//                  a tree whose dial or whose claim has moved is an L0 RED
//                  that NAMES which of the two moved.
//   the disclosure a tree with no invariant family is `unavailable`, and does
//                  NOT manufacture a red out of a missing clone.
//   the payload    `law`/`law_text` survive the trip through lint_findings into
//                  /world/graph, where a findings panel can show them.
//
//   node --test test/world-lints-law.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { SCHEMA } from "../src/world-store.mjs";
import { runLints, readLawPairing, LAW, LAW_ROOT } from "../src/world-lints.mjs";
import { worldGraphView, resetGraphCache } from "../src/world-graph.mjs";
import { worldStoreFixture } from "./world-graph-fixture.mjs";
// The lints read a loaded graph; a fixture is world.db's rows, built through the
// one construction (POS-270 lane W 3a), never opened as a file by the office.
import { graphOf, publishWorld } from "./helpers/world-rows.mjs";

// ── THE MARKS, AS THE TOWN WROTE THEM ────────────────────────────────────────
//
// Transcribed by hand from WORLD/marks/…/postmark-invariant/<slug>/mark.md at
// world main 27d7bd9b, NOT derived from the LAW table under test — a fixture
// generated from the thing it checks proves only that a copy equals itself.
// This block is the second, independent statement of the law, which is what
// lets the assertion below actually fail when someone edits the table.
const MARKS_AS_WRITTEN = [
  { lint: "L0", slug: "the-readable-inputs",
    claim: "A reading that cannot read its own inputs says so, loud — a lint that hides its noise floor is a lint nobody can trust." },
  { lint: "L1", slug: "the-reaching-mechanic",
    claim: "Every mechanic names running code and the name resolves — a rule whose mechanic reaches nothing is ink." },
  { lint: "L2", slug: "the-unmoved-past",
    claim: "A departure is judged against the stop geometry of its own instant — rearranging the world never makes the past late." },
  { lint: "L3", slug: "the-owned-constants",
    claim: "Every constant in the machinery is owned by a dial or a law — an orphan number is a rule nobody declared." },
  { lint: "L4", slug: "the-conforming-instance",
    claim: "Every instance conforms to its class — the contract is read against every record, never assumed." },
  { lint: "L5", slug: "the-consulted-doctrine",
    claim: "Every doctrine rule reaches an enforcing surface — a rule living only in prose no machine reads is a wish." },
  { lint: "L6", slug: "the-live-handler",
    claim: "Every exposed action has a live handler — a grant with no room is the town asking for one." },
  { lint: "L7", slug: "the-classed-mark",
    claim: "Every mark is an instance of a class — an unclassed mark stands outside the law's address." },
];
const markOf = (lint) => MARKS_AS_WRITTEN.find((m) => m.lint === lint);

const root = mkdtempSync(join(tmpdir(), "postmark-lints-law-"));
after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const put = (base, path, text) => {
  const full = join(base, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

/** The world's own containment test, in miniature — runLints imports it live
 *  from the tree so "inside a stop" can never drift from the world's answer. */
const GEOMETRY = `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function pointInRect(px, py, r) { return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2; }
`;

/** One invariant mark on disk, in the shape the family carries on main. */
const markFile = (slug, lint, claim) => `---
kind: class
by: the-town
tier: constitution
date: 2026-08-22
class: ${slug}
version: 1
extends: postmark-invariant
dials: {"lint": "${lint}"}
implements: []
source: LOGOS/classes.md
---

${claim}
`;

/**
 * A miniature world clone carrying the invariant family.
 *
 * `bend` rewrites one mark on the way out — the whole point of the can-fail
 * flip: the tree is right in every respect except the one under test.
 */
function worldTree(name, { family = true, bend = () => ({}) } = {}) {
  const base = join(root, name);
  put(base, "tools/geometry.mjs", GEOMETRY);
  if (family) {
    for (const m of MARKS_AS_WRITTEN) {
      const { lint = m.lint, claim = m.claim } = bend(m);
      put(base, `${LAW_ROOT}/${m.slug}/mark.md`, markFile(m.slug, lint, claim));
    }
  }
  return base;
}

/** A store with nothing in it but its own As-Of: the lints under test here are
 *  the CITATIONS, not the verdicts, and an empty world lets every question
 *  answer without a fixture pretending to be a world. */
function emptyStore(name) {
  const path = join(root, name);
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  meta.run("as_of_world", "1a44eface0000000000000000000000000000000");
  meta.run("hydrated_at", new Date().toISOString());
  meta.run("hydration_status", "OK");
  db.close();
  return path;
}

// ── the citation ─────────────────────────────────────────────────────────────

test("every lint carries the mark it enforces and that mark's claim, verbatim", async () => {
  const { lints } = await runLints({ store: graphOf(emptyStore("cited.db")), treePath: worldTree("cited") });

  // "The standing questions: each invariant is a class here, its mechanic
  //  naming the code that asks it — a question no code asks is not being asked."
  // (postmark-invariant/mark.md). The converse is what this asserts: a question
  // the code asks must name the class it is asking for.
  assert.ok(lints.length, "runLints emitted nothing to check");
  for (const l of lints) {
    const mark = markOf(l.id);
    assert.ok(mark, `${l.id} is not one of the eight invariants`);
    assert.equal(l.law, `the-town/${mark.slug}`, `${l.id} cites the wrong mark`);
    assert.equal(l.law_text, mark.claim, `${l.id} does not quote its mark verbatim`);
  }
  // All eight, every run. L0 stopped being conditional on 2026-08-23 — see
  // "the presence" below for why an absent row is the failure it exists to name.
  assert.deepEqual(lints.map((l) => l.id).sort(), ["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7"]);
});

test("the LAW table's eight pairs are the marks' own eight pairs", () => {
  assert.deepEqual(
    Object.entries(LAW).map(([lint, e]) => ({ lint, slug: e.slug, id: e.id, text: e.text })).sort((a, b) => (a.lint < b.lint ? -1 : 1)),
    MARKS_AS_WRITTEN.map((m) => ({ lint: m.lint, slug: m.slug, id: `the-town/${m.slug}`, text: m.claim })),
  );
});

// ── the self-check ───────────────────────────────────────────────────────────

test("a tree whose marks agree: eight read, no drift", () => {
  const check = readLawPairing(worldTree("agrees"));
  assert.equal(check.status, "read");
  assert.equal(check.checked, 8);
  assert.deepEqual(check.drift, []);
});

test("CAN-FAIL — a moved dial is an L0 RED that names which lint moved", async () => {
  // "A reading that cannot read its own inputs says so, loud — a lint that
  //  hides its noise floor is a lint nobody can trust." (the-readable-inputs).
  // A citation table that has drifted from the marks IS a hidden noise floor:
  // all eight findings go on quoting law the town no longer holds, and every
  // one of them still reads clean.
  const bent = worldTree("bent-dial", { bend: (m) => (m.slug === "the-reaching-mechanic" ? { lint: "L9" } : {}) });
  const { lints } = await runLints({ store: graphOf(emptyStore("bent-dial.db")), treePath: bent });

  const l0 = lints.find((l) => l.id === "L0");
  assert.ok(l0, "a drifted pairing must SPEAK — a silent skip is the failure this lint exists to prevent");
  assert.equal(l0.verdict, "RED");
  assert.match(l0.headline, /law citation\(s\) no longer match the invariant marks/);
  assert.deepEqual(l0.law_check.drift, [
    { lint: "L1", slug: "the-reaching-mechanic", why: "dial mismatch", expected: "L1", found: "L9",
      at: `${LAW_ROOT}/the-reaching-mechanic/mark.md` },
  ]);
  assert.ok(l0.evidence.some((e) => e.includes("L1 · dial mismatch")), "the evidence must name the drifted pair");
  // and L0 cites its own law like every other finding
  assert.equal(l0.law, "the-town/the-readable-inputs");
  assert.equal(l0.law_text, markOf("L0").claim);
});

test("CAN-FAIL — a rewritten claim is an L0 RED: the quote must stay verbatim", async () => {
  const bent = worldTree("bent-claim", { bend: (m) => (m.slug === "the-conforming-instance" ? { claim: "Every instance conforms to its class, more or less." } : {}) });
  const { lints } = await runLints({ store: graphOf(emptyStore("bent-claim.db")), treePath: bent });

  const l0 = lints.find((l) => l.id === "L0");
  assert.ok(l0, "a rewritten claim must speak");
  assert.equal(l0.verdict, "RED");
  const drift = l0.law_check.drift;
  assert.equal(drift.length, 1);
  assert.equal(drift[0].lint, "L4");
  assert.equal(drift[0].why, "claim mismatch");
  assert.equal(drift[0].expected, markOf("L4").claim);
  assert.equal(drift[0].found, "Every instance conforms to its class, more or less.");
});

test("a mark that has left the tree is drift, not silence", () => {
  const base = worldTree("missing-mark");
  rmSync(join(base, LAW_ROOT, "the-classed-mark"), { recursive: true, force: true });
  const check = readLawPairing(base);
  assert.equal(check.status, "read");
  assert.equal(check.checked, 7);
  assert.deepEqual(check.drift.map((d) => [d.lint, d.why]), [["L7", "no mark"]]);
});

// ── the disclosure ───────────────────────────────────────────────────────────

test("no invariant family in the tree is `unavailable`, never a manufactured red", async () => {
  const bare = worldTree("no-family", { family: false });
  const check = readLawPairing(bare);
  assert.equal(check.status, "unavailable");
  assert.equal(check.checked, 0);
  assert.deepEqual(check.drift, []);

  // and a run over that tree emits an L0 that says N/A: the citations were
  // never checked, so it asserts nothing about them. A red would be this lint
  // dressing a missing clone up as a constitutional disagreement; a green would
  // be it claiming a check it never ran. Both are the laundering it exists to
  // refuse, and since 2026-08-23 silence is too — the row is always there.
  const { lints } = await runLints({ store: graphOf(emptyStore("no-family.db")), treePath: bare });
  const l0 = lints.find((l) => l.id === "L0");
  assert.ok(l0, "L0 speaks at every hydration, including one that checked nothing");
  assert.equal(l0.verdict, "N/A");
  assert.deepEqual(l0.law_check.drift, []);
  assert.match(l0.headline, /went unchecked this run, so this asserts nothing about them/);
});

test("no tree at all is `unavailable`", () => {
  assert.equal(readLawPairing(null).status, "unavailable");
  assert.equal(readLawPairing("").status, "unavailable");
  assert.equal(readLawPairing(join(root, "nowhere-at-all")).status, "unavailable");
});

// ── the payload ──────────────────────────────────────────────────────────────

test("law and law_text survive lint_findings into the /world/graph payload", () => {
  resetGraphCache();
  const path = join(root, "payload.db");
  worldStoreFixture(path);
  // The hydrator's own detail shape (world-hydrate.mjs), with the citation on
  // it: what a panel reads hours later is this row, not the process that
  // computed it.
  const db = new DatabaseSync(path);
  db.prepare("UPDATE lint_findings SET evidence = ? WHERE lint = 'L1'").run(JSON.stringify({
    law: LAW.L1.id, law_text: LAW.L1.text,
    method: "mark -> implements -> mechanic -> module",
    limits: "the mechanic->code hop is DERIVED",
    evidence: ["timetable: declared by ENGINE.md as world/tools/vessel.mjs; NOT reachable from server.mjs"],
    rows: [{ mechanic: "timetable", carried_by: ["the-town/the-wheelhouse"], declared_modules: ["code:world/tools/vessel.mjs"], verdict: "RED" }],
  }));
  db.close();

  publishWorld(path);
  resetGraphCache();
  const view = worldGraphView({});
  const l1 = view.lints.find((l) => l.lint === "L1");
  assert.equal(l1.law, "the-town/the-reaching-mechanic");
  assert.equal(l1.law_text, markOf("L1").claim);
  // a finding written before the citation pass still renders; the fields are
  // ADDITIONS, and an older row simply has nothing to show under them
  const l2 = view.lints.find((l) => l.lint === "L2");
  assert.equal(l2.law, null);
  assert.equal(l2.law_text, null);
  // and the fields the keeping-works lens reads are untouched
  const l6 = view.lints.find((l) => l.lint === "L6");
  assert.ok(Array.isArray(l6.rows), "L6 rows must still ride the payload");
  resetGraphCache();
});

// ── the verdicts the marks ask for (2026-08-23) ──────────────────────────────
//
// Three tweaks Keemin approved, each read straight off the mark it serves:
// L1 rules PER NAME, L3 and L4 name their watch lists CLOSED, and L0 speaks at
// every hydration instead of only when it has a complaint.

/**
 * A world tree and an office that between them carry two mechanics: one whose
 * ENGINE.md section names a module the office really loads, and one that,
 * unless `resolved`, no section names at all.
 *
 * This is the shape the old rule let through. Under `underivable.length ===
 * claimed.length ? RED : GREEN`, one resolved sibling was enough to carry the
 * whole set to green — so a store exactly like this one, with half its
 * mechanics reaching nothing, read clean.
 */
function mechanicWorld(name, { resolved = false } = {}) {
  const tree = worldTree(name);                       // geometry + the invariant family
  const office = join(root, `${name}-office`);
  put(office, "src/server.mjs", `import "../../${name}/tools/the-bell.mjs";\n`);
  put(tree, "tools/the-bell.mjs", "export const ring = () => {};\n");
  if (resolved) put(tree, "tools/the-tide.mjs", "export const turn = () => {};\n");

  // The town's own declaration of where each mechanic runs. Line numbers matter:
  // L1 slices the section out of ENGINE.md by the doctrine node's `line`.
  const engine = [
    "## bell-ringing",                                             // line 1
    "The rope is pulled by `tools/the-bell.mjs`, at every crossing.",
    "",
    "## tide-turning",                                             // line 4
    resolved
      ? "The water is turned by `tools/the-tide.mjs`."
      : "The water turns. Nothing here says what turns it.",
    "",
  ].join("\n");
  put(tree, "WORLD/ENGINE.md", engine);

  const path = join(root, `${name}.db`);
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  meta.run("as_of_world", "b311c10c0000000000000000000000000000000e");
  meta.run("hydrated_at", new Date().toISOString());
  meta.run("hydration_status", "OK");
  meta.run("office_path", office);
  meta.run("world_tree_path", tree);

  const node = db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const code = (id, p) => node.run(id, "code", "module", null, null, null, null, null, null, JSON.stringify({ path: p }));
  code("code:office/src/server.mjs", "office/src/server.mjs");
  code("code:world/tools/the-bell.mjs", "world/tools/the-bell.mjs");
  if (resolved) code("code:world/tools/the-tide.mjs", "world/tools/the-tide.mjs");
  for (const m of ["bell-ringing", "tide-turning"])
    node.run(`mechanic:${m}`, "class", "mechanic", "constitution", "the-town", null, null, null, null, JSON.stringify({ mechanic: m, honored: true }));
  node.run("the-town/the-bell-rope", "mark", "predicated", "constitution", "the-town", null, null, null, null, JSON.stringify({ mechanic: "bell-ringing" }));
  node.run("the-town/the-tide-table", "mark", "predicated", "constitution", "the-town", null, null, null, null, JSON.stringify({ mechanic: "tide-turning" }));
  node.run("engine/bell-ringing", "doctrine", "section", null, null, null, null, null, null, JSON.stringify({ heading: "bell-ringing", line: 1, path: "WORLD/ENGINE.md" }));
  node.run("engine/tide-turning", "doctrine", "section", null, null, null, null, null, null, JSON.stringify({ heading: "tide-turning", line: 4, path: "WORLD/ENGINE.md" }));

  const edge = db.prepare("INSERT INTO edges (src, dst, type, props, born_at) VALUES (?,?,?,?,?)");
  edge.run("the-town/the-bell-rope", "mechanic:bell-ringing", "implements", JSON.stringify({ via: "mechanic:" }), null);
  edge.run("the-town/the-tide-table", "mechanic:tide-turning", "implements", JSON.stringify({ via: "mechanic:" }), null);
  edge.run("engine/bell-ringing", "mechanic:bell-ringing", "describes", "{}", null);
  edge.run("engine/tide-turning", "mechanic:tide-turning", "describes", "{}", null);
  edge.run("code:office/src/server.mjs", "code:world/tools/the-bell.mjs", "imports", "{}", null);
  if (resolved) edge.run("code:office/src/server.mjs", "code:world/tools/the-tide.mjs", "imports", "{}", null);
  db.close();
  return { dbPath: path, treePath: tree };
}

const l1Of = (lints) => lints.find((l) => l.id === "L1");

test("CAN-FAIL — one mechanic reaching nothing is L1 RED, however many siblings reach", async () => {
  // "Every mechanic names running code and the name resolves — a rule whose
  //  mechanic reaches nothing is ink." (the-reaching-mechanic). Every. The mark
  //  does not grade on a curve, so one resolved sibling cannot absolve the rest.
  const { dbPath, treePath } = mechanicWorld("one-unreached");
  const l1 = l1Of((await runLints({ store: graphOf(dbPath), treePath })).lints);

  assert.equal(l1.verdict, "RED", "a mechanic that reaches nothing is ink, and ink is red");
  const byName = Object.fromEntries(l1.rows.map((r) => [r.mechanic, r]));
  assert.equal(byName["bell-ringing"].verdict, "GREEN");
  assert.equal(byName["tide-turning"].verdict, "UNDERIVABLE");
  assert.match(l1.headline, /1 of 2 mark-carried mechanics reach no running declared code/);
  assert.match(l1.headline, /declare no implementing module at all \(tide-turning\)/);
  // the red name is enumerated in evidence, with what carries it — a human has
  // to be able to walk from the verdict to the mark that made the promise
  assert.ok(l1.evidence.some((e) => e.startsWith("tide-turning:") && e.includes("the-town/the-tide-table")),
    `no evidence line names the unreached mechanic and its carrier: ${JSON.stringify(l1.evidence)}`);
});

test("THE FLIP — declare the missing mechanic's module and the same store goes GREEN", async () => {
  // Same two mechanics, same marks, same office. The only change is that
  // ENGINE.md now says where tide-turning runs, and the office loads it.
  const { dbPath, treePath } = mechanicWorld("both-reached", { resolved: true });
  const l1 = l1Of((await runLints({ store: graphOf(dbPath), treePath })).lints);

  assert.equal(l1.verdict, "GREEN", "both mechanics reach running declared code; nothing is left to be red about");
  assert.deepEqual(l1.rows.map((r) => r.verdict).sort(), ["GREEN", "GREEN"]);
  assert.equal(l1.headline, "all 2 mark-carried mechanics reach a running declared module");
});

test("the leniency is gone: a set that is only PART underivable no longer passes", async () => {
  // The precise shape of the retired rule, stated as an assertion so it cannot
  // creep back: `underivable.length === claimed.length ? RED : GREEN` would
  // have returned GREEN here, because 1 !== 2.
  const { dbPath, treePath } = mechanicWorld("part-underivable");
  const l1 = l1Of((await runLints({ store: graphOf(dbPath), treePath })).lints);
  const claimed = l1.rows.filter((r) => r.carried_by.length);
  const underivable = claimed.filter((r) => r.verdict === "UNDERIVABLE");

  assert.equal(underivable.length, 1);
  assert.equal(claimed.length, 2);
  assert.notEqual(underivable.length, claimed.length, "the old rule's escape hatch is open in this store");
  assert.equal(l1.verdict, "RED", "and the new rule closes it");
});

// ── the disclosure: a narrowing that says it is narrow ───────────────────────

test("L3 and L4 disclose that their watch lists are CLOSED", async () => {
  // Their marks both say "Every" — "Every constant in the machinery…",
  // "Every instance conforms to its class…" — and the code asks after three
  // constants and one class. logos/the-invariant requires an invariant to name
  // "its method and its limits", so the gap between the mark's every and the
  // code's few has to be stated, not left for a reader to discover.
  const { lints } = await runLints({ store: graphOf(emptyStore("closed.db")), treePath: worldTree("closed") });

  for (const id of ["L3", "L4"]) {
    const l = lints.find((x) => x.id === id);
    assert.match(l.limits, /\bCLOSED\b/, `${id} must say out loud that its watch list is closed`);
    assert.match(l.limits, /\bgrows\b/, `${id} must say the closed list has room to grow`);
  }
  // and each names what it is closed AROUND, so "closed" is a fact and not a mood
  const l3 = lints.find((x) => x.id === "L3");
  assert.match(l3.limits, /three constants long/);
  for (const c of ["405", "25", "15"]) assert.ok(l3.limits.includes(c), `L3 must name the constant ${c} it watches`);
  assert.match(lints.find((x) => x.id === "L4").limits, /CLOSED, and it is one class: the parcel/);
});

// ── the presence: eight rows, always ─────────────────────────────────────────

test("a clean run emits exactly eight verdict rows, and L0 is GREEN among them", async () => {
  // "src/world-lints.mjs — L0 at every hydration" (the-readable-inputs-mechanic).
  // At EVERY hydration: a lint that only speaks when it is unhappy makes a clean
  // run and a run that never happened indistinguishable, which is the noise
  // floor hidden in the one place this lint cannot see it.
  const { dbPath, treePath } = mechanicWorld("eight-rows", { resolved: true });
  const { lints } = await runLints({ store: graphOf(dbPath), treePath });

  assert.equal(lints.length, 8, `the verdict set is eight rows: ${lints.map((l) => l.id).join(",")}`);
  assert.deepEqual(lints.map((l) => l.id).sort(), ["L0", "L1", "L2", "L3", "L4", "L5", "L6", "L7"]);

  const l0 = lints.find((l) => l.id === "L0");
  assert.equal(l0.verdict, "GREEN");
  assert.deepEqual(l0.law_check.drift, []);
  assert.equal(l0.law_check.checked, 8);
  assert.equal(l0.rows.length, 0, "a green L0 has no unreadable file to list");
  assert.match(l0.headline, /all 8 of 8 law citations match the invariant marks verbatim/);
  assert.ok(l0.evidence.some((e) => e.includes("no source file")), "a green still shows its noise floor");
});

test("CAN-FAIL — an unreadable source file turns that same clean run RED", async () => {
  // The green above has to be a green that could have been red: delete a module
  // the store still names, and L0 must say so rather than scanning a short
  // corpus quietly.
  const { dbPath, treePath } = mechanicWorld("swept-file", { resolved: true });
  rmSync(join(treePath, "tools", "the-tide.mjs"), { force: true });
  const { lints } = await runLints({ store: graphOf(dbPath), treePath });

  const l0 = lints.find((l) => l.id === "L0");
  assert.equal(l0.verdict, "RED");
  assert.match(l0.headline, /source files named by the store could not be read/);
  assert.ok(l0.rows.some((p) => p.endsWith("the-tide.mjs")), "the swept file must be named");
  assert.equal(lints.length, 8, "still eight rows — the count does not depend on the verdict");
});

// ── the sweep: no lint points at a section that does not exist ───────────────

test("no finding cites §2.10 — the pointers are re-anchored to the invariants", async () => {
  // WORLD/ENGINE.md carries no numbered sections at all, so a limits string
  // citing §2.10 sent every reader of that finding to nothing. L4's was the last
  // one inside a finding; the rest lived in world-hydrate.mjs and world-store.mjs.
  const { lints } = await runLints({ store: graphOf(emptyStore("swept.db")), treePath: worldTree("swept") });
  for (const l of lints)
    for (const field of ["headline", "method", "limits"])
      assert.ok(!/§\s*2\.10/.test(l[field] ?? ""), `${l.id}.${field} still points at §2.10`);
});

// ── L3/L4 · the two falsifiers that could not fail (the 2026-08-29 audit) ────
//
// Both lints keyed on `the-town/parcel-class`, a node the step-1 promotion
// retired on 2026-08-18 (src/world-hydrate.mjs § THE PARCEL-CLASS CUTOVER).
// L4 then read `cls?.w ?? 25` and judged every parcel against a hardcoded 25,
// reporting GREEN about a conformity it had stopped measuring; L3's parcel row
// resolved its owner directory to null, so absolution-by-owner was dead code.
// Twelve days, two invariants, no way for either to go red.
//
// These fixtures build the store directly rather than through a fold: the
// question is what the lints do when the declaration is present, moved, or
// unreadable, and a hydrator in the loop would only obscure that.

const FIXTURE_WORKS = "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works";

/** A store carrying a parcel class declaration and one instance of it. */
function parcelStore(name, { classId = "the-town/parcel", dials = { extent_m: 25 }, w = 25, h = 25, extra = [] } = {}) {
  const path = join(root, name);
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  meta.run("as_of_world", "1a44eface0000000000000000000000000000000");
  meta.run("hydrated_at", new Date().toISOString());
  meta.run("hydration_status", "OK");
  const node = db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props) VALUES (?,?,?,?,?,?,?,?,?,?)");
  if (classId)
    // A CLASS MARK HAS NO GEOMETRY — extent_w/h are null, exactly as the live
    // `the-town/parcel` node is. This is the half a naive repoint misses.
    node.run(classId, "mark", "class", "constitution", "the-town", null, null, null, null,
      JSON.stringify({ class: "parcel", path: FIXTURE_WORKS + "/postmark-node/mark/parcel", dials }));
  node.run("someone/their-parcel", "mark", "parcel", "market", "someone", 100, 100, w, h,
    JSON.stringify({ date: "2026-08-30" }));
  for (const [id, props] of extra)
    node.run(id, "mark", props.subkind ?? "class", "constitution", "the-town", null, null, null, null, JSON.stringify(props));
  db.close();
  return path;
}

const l3of = (lints) => lints.find((l) => l.id === "L3");
const l4of = (lints) => lints.find((l) => l.id === "L4");

test("L4 reads the parcel contract off the class mark's DIAL, not off a geometry column", async () => {
  // The dial is the only place the number lives on a class mark. A lint that
  // reads `attr.w` here reads null and falls through to whatever it was going
  // to guess — which is how the retired-node bug stayed invisible.
  const { lints } = await runLints({ store: graphOf(parcelStore("l4-dial.db", { dials: { extent_m: 25 } })), treePath: worldTree("l4-dial") });
  const l4 = l4of(lints);
  assert.equal(l4.verdict, "GREEN", "a 25x25 parcel conforms to a 25 dial");
  assert.match(l4.method, /dials\.extent_m/, "L4 must say it reads the dial, since that is what it now does");

  // AND IT MOVES WITH THE RECORD, which `?? 25` never could: same parcel, a
  // class that declares 40, and the verdict has to change.
  const moved = await runLints({ store: graphOf(parcelStore("l4-moved.db", { dials: { extent_m: 40 } })), treePath: worldTree("l4-moved") });
  assert.equal(l4of(moved.lints).verdict, "RED",
    "with the contract at 40 and the parcel at 25, a lint actually reading the contract goes red — the hardcoded 25 could not");
  assert.match(l4of(moved.lints).headline, /not 40x40/);
});

test("L4 rules N/A, never GREEN, when the parcel contract cannot be read", async () => {
  // THE CONTROL FOR THE WHOLE BUG. Under the old code this store — no class
  // declaration at all — produced a confident GREEN off the hardcoded 25.
  // Silence about a contract is not evidence of conformity to it.
  const { lints } = await runLints({ store: graphOf(parcelStore("l4-gone.db", { classId: null })), treePath: worldTree("l4-gone") });
  const l4 = l4of(lints);
  assert.equal(l4.verdict, "N/A", "with no declaration to read, there is no verdict to give");
  assert.match(l4.headline, /no verdict/);
  assert.match(l4.headline, /is not in the graph/);
  assert.ok(l4.rows.every((r) => r.conforms === null), "an unmeasured parcel is not a failing one");

  // and the same when the node stands but declares no numeric dial
  const noDial = await runLints({ store: graphOf(parcelStore("l4-nodial.db", { dials: {} })), treePath: worldTree("l4-nodial") });
  assert.equal(l4of(noDial.lints).verdict, "N/A");
  assert.match(l4of(noDial.lints).headline, /declares no numeric extent_m dial/);
});

test("neither L3 nor L4 keys on the retired the-town/parcel-class", async () => {
  // The rename-orphans check, done where it can fail rather than by eye: a
  // store whose declaration stands ONLY at the retired id must not satisfy
  // either lint. If some later hand repoints one of them back, this reds.
  const { lints } = await runLints({
    store: graphOf(parcelStore("l4-retired.db", { classId: "the-town/parcel-class" })),
    treePath: worldTree("l4-retired"),
  });
  assert.equal(l4of(lints).verdict, "N/A",
    "the retired id must not answer for the live declaration — that equivalence is the bug");
  assert.ok(!l3of(lints).rows.some((r) => r.owner === "the-town/parcel-class"),
    "L3's parcel row must own itself to the live mark");
  assert.ok(l3of(lints).rows.some((r) => r.owner === "the-town/parcel"),
    "…which is the-town/parcel");
});

// ── L3 · the other direction: a dial that owns nothing ──────────────────────

test("L3 reports a constitutional number no engine reads, and takes a flagged one at its word", async () => {
  // The audit found four instances of this in one pass (the walk pace in three
  // nodes read from one; `ends_turn` on five marks read by none;
  // `declare-stance-on` running on two constants no dial declared). The closed
  // three-constant watch list could not see any of them, because it was asking
  // the opposite question.
  const dbPath = parcelStore("l3-dials.db", {
    extra: [
      ["the-town/quiet", { class: "quiet", path: FIXTURE_WORKS + "/postmark-edge/quiet", dials: { unread_cap: 7 } }],
      ["the-town/honest", { class: "honest", path: FIXTURE_WORKS + "/postmark-edge/honest", dials: { flagged_cap: 9 },
        implements: ["flagged_cap is ASPIRATIONAL — declared ahead of its wiring; nothing reads it yet"] }],
    ],
  });
  const { lints } = await runLints({ store: graphOf(dbPath), treePath: worldTree("l3-dials") });
  const l3 = l3of(lints);

  const quiet = l3.declared.find((d) => d.slot === "unread_cap");
  assert.ok(quiet, "a declared number must be walked at all");
  assert.equal(quiet.verdict, "orphan", "no engine names it and the mark does not admit that — that is the finding");
  assert.equal(l3.verdict, "RED", "and an undeclared-reader dial reds the lint");
  assert.ok(l3.evidence.some((e) => /declared and unread: the-town\/quiet unread_cap/.test(e)),
    "the finding must be evidence a human can go check, not just a count");

  const honest = l3.declared.find((d) => d.slot === "flagged_cap");
  assert.equal(honest.verdict, "flagged",
    "a mark that says out loud that nothing reads its dial is doing what the town asked — the voices.mjs standard");

  // THE FLAG IS NOT A BLANKET. A disclosure that does not name THIS dial must
  // not launder it, or one aspirational sentence excuses every number on a mark.
  const laundered = parcelStore("l3-launder.db", {
    extra: [["the-town/sneak", { class: "sneak", path: FIXTURE_WORKS + "/postmark-edge/sneak", dials: { other_cap: 11 },
      implements: ["something_else is ASPIRATIONAL — declared ahead of its wiring"] }]],
  });
  const l3b = l3of((await runLints({ store: graphOf(laundered), treePath: worldTree("l3-launder") })).lints);
  assert.equal(l3b.declared.find((d) => d.slot === "other_cap").verdict, "orphan",
    "the flag must name the dial it excuses");
});

test("L3 walks a mark planted since the last fold — standing is read from the filing, not the fold", async () => {
  // `props.in_works` is stamped from the derived containment map, so a mark
  // planted after the last crossing carries `in_works: false`. Verified live:
  // the two dials planted on `declare-stance-on` on 2026-08-30 came back false
  // while their sibling `the-town/earshot-m` came back true, on identical
  // filing. A question about the constitution's numbers that cannot see the
  // newest ones is the bug it exists to name.
  const dbPath = parcelStore("l3-fresh.db", {
    extra: [["the-town/fresh", { class: "fresh", in_works: false,
      path: FIXTURE_WORKS + "/postmark-edge/fresh", dials: { fresh_cap: 13 } }]],
  });
  const l3 = l3of((await runLints({ store: graphOf(dbPath), treePath: worldTree("l3-fresh") })).lints);
  assert.ok(l3.declared.some((d) => d.slot === "fresh_cap"),
    "a just-planted dial must be walked — in_works: false is the fold being stale, not the mark being outside the works");
});

test("L3 discloses that its dial->code half is OPEN, beside the closed one", async () => {
  // logos/the-invariant: an invariant "names its method and its limits". The
  // two halves have different limits and both have to be stated — the closed
  // watch list above, and the name-matching this half rules on.
  const l3 = l3of((await runLints({ store: graphOf(emptyStore("l3-open.db")), treePath: worldTree("l3-open") })).lints);
  assert.match(l3.limits, /DIAL->CODE HALF IS NOT CLOSED/, "the open half must say it is open");
  assert.match(l3.method, /DIAL -> CODE/, "and the method must describe both directions");
  // the three limits that actually bite, each named rather than discovered later
  assert.match(l3.limits, /matches on NAMES/i);
  assert.match(l3.limits, /numbers and booleans/i);
  assert.match(l3.limits, /taken at its word/i);
});
