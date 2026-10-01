// world2-twins-equality.test.mjs — the pure half of
// `world2/tools/falsifier-twins-equality.mjs` (POS-142), held to what the tool
// claims about itself: exclusions come ONLY from the twin's own `tree_only`,
// everything else is total, and a skew refuses.
//
// The tool's HTTP half runs against a live office (dev's, by hand; prod's on
// Sunday) and is not under test here. Its in-memory --prove-can-fail runs on the
// real answers each time it is invoked; this file is the fixture proof that the
// comparison itself can fail, so a green there is not a comparator asleep.
//
// Run: node --test test/world2-twins-equality.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDeclarations, twinFindings, skewFor, additionsAcross, agreeingLeaf, declarationOf }
  from "../world2/tools/falsifier-twins-equality.mjs";

const stakeOne = () => ({
  mark: "wright/a-bench", escrow: 6, stamps: 6, ledger_weight: 11,
  breadth: { k: 5, external_households: 1, households: 2, bonus: 5 },
  holders: [{ handle: "sol", stamps: 5 }, { handle: "ann", stamps: 1 }, { handle: "bea", stamps: 1 }],
  retirement: { blocked: true, escrow: 6 },
});
const stakeTwo = () => ({
  what: "a sentence about the answer",
  mark: "wright/a-bench", escrow: 6, stamps: 6, ledger_weight: 11,
  breadth: { k: 5, external_households: 1, households: 2, bonus: 5 },
  // ties broken by handle, as the twin declares
  holders: [{ handle: "sol", stamps: 5 }, { handle: "bea", stamps: 1 }, { handle: "ann", stamps: 1 }],
  escrow_at_town_sha: "a5e23f20",
  tree_only: { retirement: "a whole-ledger read", "holders[] tie order": "a set, ties by handle" },
});

test("the declaration grammar: a path, a [] path, a ' · ' list, a tie order — and a sentence is BAD, never an exclusion", () => {
  const d = parseDeclarations({
    "branch · main · draft": "x",
    "published[].weight · published[].weight_parts": "x",
    "holders[] tie order": "x",
    "the receipt cannot be read here": "x",
  });
  assert.deepEqual(d.paths, [["branch"], ["main"], ["draft"], ["published", "[]", "weight"], ["published", "[]", "weight_parts"]]);
  assert.deepEqual(d.multisets, [["holders"]]);
  assert.deepEqual(d.bad, ["the receipt cannot be read here"]);
});

test("two equal answers: zero findings, and the comparison COUNTED what it compared", () => {
  const r = twinFindings(stakeOne(), stakeTwo());
  assert.deepEqual(r.findings, []);
  assert.ok(r.compared >= 9, `compared ${r.compared}`);
  assert.deepEqual(r.additions.sort(), ["escrow_at_town_sha", "tree_only", "what"]);
  assert.deepEqual(r.excluded.map((x) => x.path), ["retirement"]);
});

test("a moved leaf is a finding, named by path with both values", () => {
  const two = stakeTwo(); two.breadth.bonus = 4;
  const r = twinFindings(stakeOne(), two);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /breadth\.bonus: 1\.0 5 · twin 4/);
});

test("the exclusion is READ OFF THE ANSWER: the same missing field with no declaration is red", () => {
  const two = stakeTwo(); delete two.tree_only.retirement;
  const r = twinFindings(stakeOne(), two);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /retirement is on 1\.0 and absent from the twin/);
});

test("a tie order declared is a MULTISET compare: order may move, members may not", () => {
  const two = stakeTwo(); two.holders[1] = { handle: "bea", stamps: 2 };
  const r = twinFindings(stakeOne(), two);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /holders differs as a multiset/);
  // and with no declaration the reordering alone is red
  const three = stakeTwo(); delete three.tree_only["holders[] tie order"];
  assert.ok(twinFindings(stakeOne(), three).findings.length > 0);
});

test("a twin field below the top that 1.0 does not carry is red — only the top level may add", () => {
  const two = stakeTwo(); two.breadth.planted = 1;
  const r = twinFindings(stakeOne(), two);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /breadth\.planted is on the twin and not on 1\.0/);
});

test("a declaration that names no path is a finding, and excludes nothing", () => {
  const two = stakeTwo(); two.tree_only["the escrow is approximate here"] = "planted";
  const r = twinFindings(stakeOne(), two);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0], /names no path/);
});

test("a dropped parent with declared children: the declared fields exclude, every other one is named", () => {
  const one = { id: "a/b", receipt: { crossing: { s: 1 }, settlement_sha: "f0bf", claims: [], status: "published" } };
  const two = { id: "a/b", tree_only: { "receipt.crossing · receipt.settlement_sha": "no tags in the store" } };
  const r = twinFindings(one, two);
  assert.deepEqual(r.excluded.map((x) => x.path).sort(), ["receipt.crossing", "receipt.settlement_sha"]);
  assert.equal(r.findings.length, 2);
  assert.ok(r.findings.some((f) => /receipt\.claims is on 1\.0 and absent/.test(f)));
  assert.ok(r.findings.some((f) => /receipt\.status is on 1\.0 and absent/.test(f)));
});

test("a [] declaration excludes that field in every element and nothing else", () => {
  const one = { published: [{ id: "a", weight: 3, stamps: 1 }, { id: "b", weight: 9, stamps: 2 }] };
  const two = { published: [{ id: "a", stamps: 1 }, { id: "b", stamps: 2 }], tree_only: { "published[].weight": "the fold's figure" } };
  assert.deepEqual(twinFindings(one, two).findings, []);
  two.published[1].stamps = 3;
  assert.equal(twinFindings(one, two).findings.length, 1);
});

test("a declaration no 1.0 field matched is reported unseen — a stale exemption is visible", () => {
  const two = stakeTwo(); two.tree_only.proposed = "the next crossing's fold";
  const r = twinFindings(stakeOne(), two);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.unseen, ["proposed"]);
});

test("an addition is a key the twin adds to EVERY answer of the door; on some only, it is a finding", () => {
  const all = additionsAcross({ tree_only: 12, what: 12 }, 12, "investigate");
  assert.deepEqual(all, { additions: ["tree_only", "what"], findings: [] });
  const some = additionsAcross({ tree_only: 12, id: 1 }, 12, "investigate");
  assert.deepEqual(some.additions, ["tree_only"]);
  assert.equal(some.findings.length, 1);
  assert.match(some.findings[0], /"id" where 1\.0 does not on 1 of 12/);
});

test("a skew refuses per side the door needs, and agreement does not", () => {
  const states = { world: { one: "bb5a0ff3", two: "63ba44ca" }, town: { one: "047e44b1", two: "047e44b1" } };
  assert.equal(skewFor("investigate", states).length, 1);
  assert.equal(skewFor("stake", states).length, 0);
  assert.equal(skewFor("my-marks", states).length, 1);
  assert.equal(skewFor("stake", { town: { one: null, two: "x" } }).length, 1, "an unreadable sha is a skew, never a pass");
});

test("the proof's leaf is one both sides AGREE on, at any depth, and outside every declaration", () => {
  const one = { household: "darko", labels: { drafts: "yours" }, branch: "draft/darko" };
  const two = { household: "solo:darko", labels: { drafts: "yours" }, tree_only: { branch: "x" } };
  const leaf = agreeingLeaf(one, two);
  assert.deepEqual(leaf, ["labels", "drafts"]);
  assert.equal(declarationOf(["published", 3, "weight"]), "published[].weight");
});
