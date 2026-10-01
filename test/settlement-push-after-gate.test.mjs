// settlement-push-after-gate.test.mjs — NOTHING LEAVES A CROSSING BEFORE THE HARM GATE.
//
//   node --test test/settlement-push-after-gate.test.mjs
//
// ── WHAT IS UNDER TEST ──────────────────────────────────────────────────────
//
// On the box the unit's env carries TOWN_PUSH=1, and under STATE_LOG_SOURCE=store
// the photograph's penCommit honoured it: STATE/log was pushed to world main
// BEFORE the harm gate, and that push carried the registry refresh's commit
// with it. A crossing the gate refused had still moved origin, though the
// script's header says main is pushed "only on no harm". Found by POS-242's
// dry leg; confirmed on prod by count.
//
// The photograph and the registry commit now stay local in the sweep clone and
// ride publish_main's one push. A refusal leaves them behind, the next crossing
// checks main out from origin again, and the photograph is taken afresh: the
// drain's writeJournalWindow merges by seq, so nothing is written twice.
//
// The bottle runs the REAL writer and the REAL penCommit over a stub register,
// with TOWN_PUSH=1 as on the box, and origin's post-receive hook logs every ref
// it is pushed, so "one push" is counted rather than inferred.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SH_OK, g, bottle, cross } from "./helpers/settlement-bottle.mjs";

const skip = !SH_OK && "no POSIX sh";
const why = (run) => `exit ${run.res.status}\n${run.res.stderr}`;
const subjects = (repo, ref = "main") => g(repo, "log", "--format=%s", ref).split("\n");
/** The refs origin was pushed, one line per ref per push. */
const mainPushes = (b) => {
  let s = "";
  try { s = readFileSync(b.pushes, "utf8"); } catch { /* none yet */ }
  return s.split("\n").filter((l) => l.endsWith(" refs/heads/main"));
};

test("G1 · a crossing refused at the harm gate leaves origin's main where it found it", { skip }, () => {
  const b = bottle({ harm: true });
  const run = cross(b);
  assert.equal(run.res.status, 1, why(run));
  assert.equal(run.receipt.status, "refused");
  assert.match(run.receipt.detail, /HARM NAMED/);
  // The writers were live in this very run: both commits stand in the sweep clone.
  const local = subjects(run.sweep);
  assert.ok(local.some((s) => s.startsWith("photograph: windows 213")), local.join(" | "));
  assert.ok(local.includes("registry: refreshed (fixture)"), local.join(" | "));
  // And none of it left.
  assert.equal(run.after, run.before, "origin's refs are unchanged");
  assert.deepEqual(mainPushes(b), [], "origin was pushed nothing");
});

test("G2 · a passing crossing pushes main once, and that push carries the photograph and the registry", { skip }, () => {
  const b = bottle();
  const run = cross(b);
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.receipt.status, "published");
  assert.equal(mainPushes(b).length, 1, `one push of main: ${mainPushes(b).join(" | ")}`);
  const landed = subjects(b.origin);
  for (const s of ["settlement: sweep 1 published", "registry: refreshed (fixture)"]) assert.ok(landed.includes(s), `${s}: ${landed.join(" | ")}`);
  assert.ok(landed.some((s) => s.startsWith("photograph: windows 213")), landed.join(" | "));
  assert.equal(g(b.origin, "rev-parse", "main"), g(run.sweep, "rev-parse", "main"), "origin holds exactly what the sweep clone built");
});

test("G2b · a registry-only quiet crossing pushes main once, photograph aboard", { skip }, () => {
  const b = bottle({ quiet: true, suiteRed: false });
  const run = cross(b);
  assert.equal(run.res.status, 0, why(run));
  assert.equal(run.receipt.status, "quiet");
  assert.equal(mainPushes(b).length, 1, `one push of main: ${mainPushes(b).join(" | ")}`);
  const landed = subjects(b.origin);
  assert.ok(landed.includes("registry: refreshed (fixture)"), landed.join(" | "));
  assert.ok(landed.some((s) => s.startsWith("photograph: windows 213")), landed.join(" | "));
});

test("G3 · refused, then passing: the photograph lands once, every act once", { skip }, () => {
  const b = bottle({ harm: "env" });
  const refused = cross(b, { BOTTLE_HARM: "1", STATE_LOG_ACTS: "[1]" });
  assert.equal(refused.res.status, 1, why(refused));
  assert.equal(refused.receipt.status, "refused");
  assert.equal(refused.after, refused.before, "the refusal left origin alone");
  const passed = cross(b, { STATE_LOG_ACTS: "[1,2]" });
  assert.equal(passed.res.status, 0, why(passed));
  assert.equal(passed.receipt.status, "published");
  const landed = subjects(b.origin);
  assert.equal(landed.filter((s) => s.startsWith("photograph: ")).length, 1, landed.join(" | "));
  assert.equal(landed.filter((s) => s === "registry: refreshed (fixture)").length, 1, landed.join(" | "));
  const seqs = g(b.origin, "show", "main:STATE/log/213.journal.jsonl").split("\n").filter(Boolean).map((l) => JSON.parse(l).seq);
  assert.deepEqual(seqs, [1, 2], "the journal holds each act once, in seq order");
});

test("G4 · the dry leg withholds the same list, and pushes nothing", { skip }, () => {
  const b = bottle();
  const run = cross(b, { SETTLEMENT_DRY: "1" });
  assert.equal(run.res.status, 0, why(run));
  // The list as the train's dry leg wrote it before this change, item for item.
  assert.deepEqual(run.receipt.withheld.map((l) => l.replace(/[:(].*$/, "").trim()), [
    "the photograph's commit and push",
    "world main's push",
    "the store's retirement",
    "escalation",
  ], JSON.stringify(run.receipt.withheld));
  assert.equal(run.after, run.before);
  assert.deepEqual(mainPushes(b), []);
});
