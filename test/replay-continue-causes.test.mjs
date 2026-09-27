// replay-continue-causes.test.mjs — WHY each parity finding is a finding (DEC-18).
//
// `replay-ingest --continue` on the live store put 158 substance findings on one
// wall with no statement of what caused any of them. The classifier under test
// answers that per finding, and its one dangerous power is that three causes can
// move a finding OUT of the red column. So the tests are built around that power:
// every cause has a fixture, the mangle proves a mislabelled row still reds, and
// the control proves the out-of-scope filter cannot hide an in-scope miss.
//
// The rules are pure — `record(slug)` and `claim(slug)` are injected — so nothing
// here needs git or a database, and what is proved is the RULES rather than that
// git works. The adapter that reads git and the store is exercised on the box.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CAUSES, isOutOfScope, parseFinding, classifyFinding, isSweepCommit, summarizeByCause, historyFor,
} from "../world2/tools/parity-causes.mjs";
import { stripSlug } from "../world2/tools/replay-ingest.mjs";
import { compareMarks } from "../world2/tools/seed-import.mjs";

// ── fixtures: one commit of each shape ───────────────────────────────────────

const SWEEP = {
  sha: "a16849d2", author: "Postmark Pen", at: "2026-08-30T23:02:10Z",
  subject: "settlement: sweep 21 published, 0 unpublished, 1052 left drafted, 0 withdrawn, 0 quarantined",
};
const HAND = {
  sha: "e3be4f5d", author: "Keemin Lee", at: "2026-09-01T18:12:00Z",
  subject: "parcel drain resumed: 17 households seated (founder's word, 2026-09-01)",
};
// The hand commit that QUOTES a sweep line in its message. `isSweepCommit` must
// not be fooled by the subject alone, or every founder commit that reports what a
// sweep did becomes a sweep and its marks land in the wrong class.
const HAND_QUOTING_A_SWEEP = {
  sha: "0b4616cc", author: "Keemin Lee", at: "2026-08-30T04:00:00Z",
  subject: "settlement: sweep 21 published — quoting the receipt this replaces",
};
// The pen commit that is not a sweep. Author alone is not enough either.
const PEN_NOT_SWEEP = {
  sha: "9c0ffee1", author: "Postmark Pen", at: "2026-08-30T04:00:00Z",
  subject: "ledger: rotate the daily journal",
};

const missing = (slug) => `marks MISSING in DB: ${slug}`;
const extra = (slug) => `marks EXTRA in DB (the checkout derives no such mark): ${slug}`;
const differs = (slug, field, repo, db) =>
  `marks DIFFERS at ${slug} · field ${field}\n    repo says: ${repo}\n    DB says:   ${db}`;

const world = (map) => (slug) => map[slug] ?? null;
const store = (map) => (slug) => map[slug] ?? null;

// ── the shapes compareMarks emits round-trip through the parser ──────────────

test("parseFinding reads back every shape compareMarks writes, from compareMarks itself", () => {
  const repo = [{
    slug: "a/one", kind: "sited", owner: "a", household: "solo:a", body: "b",
    geometry: { at: { x: 1, y: 2 } }, bbox: "((0,0),(1,1))", status: "standing",
  }];
  const cols = ["kind", "owner", "household", "body", "geometry", "bbox", "status"];

  // Not hand-written strings: the real comparator's output, so the parser cannot
  // drift away from the writer without this test noticing.
  const miss = compareMarks([], repo, { columns: cols })[0];
  assert.deepEqual(parseFinding(miss), { kind: "missing", slug: "a/one", field: null, repoSays: null, dbSays: null });

  const ext = compareMarks([...repo, { ...repo[0], slug: "forged/thing" }], repo, { columns: cols })[0];
  assert.deepEqual(parseFinding(ext), { kind: "extra", slug: "forged/thing", field: null, repoSays: null, dbSays: null });

  const diff = compareMarks([{ ...repo[0], body: "different" }], repo, { columns: cols })[0];
  const p = parseFinding(diff);
  assert.equal(p.kind, "differs");
  assert.equal(p.slug, "a/one");
  assert.equal(p.field, "body");

  // The geometry pair the oracle bug produced, straight out of the comparator.
  const geo = compareMarks([{ ...repo[0], geometry: {} }], [{ ...repo[0], geometry: null }], { columns: cols })[0];
  const g = parseFinding(geo);
  assert.equal(g.field, "geometry");
  assert.equal(g.repoSays, "null");
  assert.equal(g.dbSays, "{}");
});

// ── one fixture per cause ────────────────────────────────────────────────────

test("hand-planted-on-main: the file exists, the hand added it, no claim ever reached the pen", () => {
  const c = classifyFinding(missing("caelan-rhys/the-rain-stitch-cottage"), {
    record: world({ "caelan-rhys/the-rain-stitch-cottage": { atTag: true, atMain: false, addedBy: HAND, changedBy: HAND } }),
    claim: store({}),
  });
  assert.equal(c.cause, "hand-planted-on-main");
  assert.equal(c.scope, "in");
});

test("sweep-published-unmirrored: 1.0's sweep added it and the store holds no claim at all", () => {
  const c = classifyFinding(missing("neth/changeling"), {
    record: world({ "neth/changeling": { atTag: true, atMain: true, addedBy: SWEEP, changedBy: SWEEP } }),
    claim: store({}),
  });
  assert.equal(c.cause, "sweep-published-unmirrored");
  assert.equal(c.scope, "in");
});

test("sweep-published-draft-in-store: the same, except the store still holds the resident's draft", () => {
  const c = classifyFinding(missing("vermillion/pagani-huayra"), {
    record: world({ "vermillion/pagani-huayra": { atTag: true, atMain: true, addedBy: SWEEP, changedBy: SWEEP } }),
    claim: store({ "vermillion/pagani-huayra": { status: "draft" } }),
  });
  assert.equal(c.cause, "sweep-published-draft-in-store");
  assert.equal(c.scope, "in", "a private draft is a ruling, not a pass");
});

test("sweep-amend-unmirrored and hand-amend-on-main split a DIFFERS by who last touched the file", () => {
  const rec = (commit) => world({ "x/y": { atTag: true, atMain: true, addedBy: commit, changedBy: commit } });
  assert.equal(classifyFinding(differs("x/y", "body", "new", "old"), { record: rec(SWEEP) }).cause,
    "sweep-amend-unmirrored");
  assert.equal(classifyFinding(differs("x/y", "body", "new", "old"), { record: rec(HAND) }).cause,
    "hand-amend-on-main");
});

test("stale-tier is its own cause and is gated (ruled 2026-08-28: the gate is the judge)", () => {
  const c = classifyFinding(differs("little-pica/the-nest-on-the-middle-terrace", "data.tier", "home", "market"), {
    record: world({}),
  });
  assert.equal(c.cause, "stale-tier");
  assert.equal(c.scope, "in");
});

test("pen-written-not-in-world: the store has it, 1.0 has no file at the tag OR at main", () => {
  const c = classifyFinding(extra("wright/final-unstaked"), {
    record: world({ "wright/final-unstaked": { atTag: false, atMain: false, addedBy: null, changedBy: null } }),
  });
  assert.equal(c.cause, "pen-written-not-in-world");
  assert.equal(c.scope, "in");
});

test("left-register-then-returned is the frozen-tag seam, and is the only EXTRA that goes INFO", () => {
  const c = classifyFinding(extra("the-town/pledges"), {
    record: world({ "the-town/pledges": { atTag: false, atMain: true, addedBy: null, changedBy: null } }),
  });
  assert.equal(c.cause, "left-register-then-returned");
  assert.equal(c.scope, "out");
  assert.match(CAUSES[c.cause].says, /frozen tag/);
});

test("oracle-geometry-empty-after-strip is recognised by its VALUES, never by a slug list", () => {
  // No record at all: the cause must be derivable from the finding's own shape,
  // because a de-sited mark's row is exactly the one git can say least about.
  const c = classifyFinding(differs("sage-reeves/welcome-town-light", "geometry", "null", "{}"), {
    record: world({}),
  });
  assert.equal(c.cause, "oracle-geometry-empty-after-strip");
  assert.equal(c.scope, "out");

  // And it must NOT swallow a real geometry disagreement that merely mentions null.
  const real = classifyFinding(differs("a/b", "geometry", "null", '{"at":{"x":1}}'), {
    record: world({ "a/b": { atTag: true, atMain: true, addedBy: SWEEP, changedBy: SWEEP } }),
  });
  assert.equal(real.scope, "in");
  const other = classifyFinding(differs("a/b", "geometry", '{"at":{"x":0}}', "{}"), {
    record: world({ "a/b": { atTag: true, atMain: true, addedBy: SWEEP, changedBy: SWEEP } }),
  });
  assert.equal(other.scope, "in");
});

test("unclassified is the honest bucket and it REDS — a cause we cannot derive is a question", () => {
  const c = classifyFinding(missing("who/knows"), { record: world({}), claim: store({}) });
  assert.equal(c.cause, "unclassified");
  assert.equal(c.scope, "in");
  assert.equal(isOutOfScope("unclassified"), false);
  // Nothing outside the fixed set can ever be minted.
  for (const [name, def] of Object.entries(CAUSES)) {
    assert.ok(def.scope === "in" || def.scope === "out", `${name} has a scope`);
    assert.ok(def.says.length > 20, `${name} says why`);
  }
  assert.equal(Object.values(CAUSES).filter((d) => d.scope === "out").length, 2,
    "exactly two causes may leave the red column; adding a third is a ruling, not an edit");
});

// ── isSweepCommit needs BOTH halves ──────────────────────────────────────────

test("a sweep is the pen's commit AND a sweep subject — neither half alone", () => {
  assert.equal(isSweepCommit(SWEEP), true);
  assert.equal(isSweepCommit(HAND), false);
  assert.equal(isSweepCommit(HAND_QUOTING_A_SWEEP), false,
    "a founder commit quoting a sweep receipt is not a sweep");
  assert.equal(isSweepCommit(PEN_NOT_SWEEP), false,
    "the pen authors more than sweeps");
  assert.equal(isSweepCommit(null), false);
});

// ── THE MANGLE: a hand-planted mark relabelled as a resident's must still red ──

test("MANGLE — relabelling a hand-planted mark as a sweep claim moves its cause and NOT its scope", () => {
  const line = missing("caelan-rhys/the-rain-stitch-cottage");
  const honest = classifyFinding(line, {
    record: world({ "caelan-rhys/the-rain-stitch-cottage": { atTag: true, atMain: false, addedBy: HAND, changedBy: HAND } }),
    claim: store({}),
  });
  // The mangle: the same finding, with the record forged to say a resident's
  // sweep published it and the store already holds the resident's draft — the
  // most benign-looking story available for a missing mark.
  const mangled = classifyFinding(line, {
    record: world({ "caelan-rhys/the-rain-stitch-cottage": { atTag: true, atMain: true, addedBy: SWEEP, changedBy: SWEEP } }),
    claim: store({ "caelan-rhys/the-rain-stitch-cottage": { status: "draft" } }),
  });
  assert.notEqual(mangled.cause, honest.cause, "the mangle did move the cause");
  assert.equal(mangled.scope, "in", "and it did NOT move the finding out of the red column");
  assert.equal(honest.scope, "in");
});

// ── THE CONTROL: out-of-scope must not hide an in-scope miss ─────────────────

test("CONTROL — a real MISSING sitting among nine out-of-scope findings is still gated", () => {
  const oracleNine = Array.from({ length: 9 }, (_, i) =>
    differs(`sage-reeves/welcome-${i}`, "geometry", "null", "{}"));
  const realMiss = missing("caelan-rhys/the-rain-stitch-cottage");
  const record = world({
    "caelan-rhys/the-rain-stitch-cottage": { atTag: true, atMain: false, addedBy: HAND, changedBy: HAND },
  });
  const classified = [...oracleNine, realMiss].map((f) => classifyFinding(f, { record, claim: store({}) }));
  const { gated, informational, rows } = summarizeByCause(classified);

  assert.equal(informational.length, 9);
  assert.equal(gated.length, 1, "the one real miss survives the filter");
  assert.equal(gated[0].slug, "caelan-rhys/the-rain-stitch-cottage");
  assert.ok(rows.some((r) => r.cause === "hand-planted-on-main" && r.count === 1));

  // And the negative control: with the nine removed the answer is unchanged, so
  // the filter is not what is producing the gated finding.
  const alone = [classifyFinding(realMiss, { record, claim: store({}) })];
  assert.equal(summarizeByCause(alone).gated.length, 1);
});

// ── the oracle bug itself ────────────────────────────────────────────────────

test("stripSlug: an object emptied BY the strip becomes null; a genuinely empty one does not", () => {
  // The nine de-sited continuation marks: the smuggled slug is the only key.
  assert.equal(stripSlug({ slug: "sage-reeves/welcome-town-light" }), null);
  // A sited mark keeps everything else and stays an object.
  assert.deepEqual(stripSlug({ slug: "a/b", at: { x: 1, y: 2 } }), { at: { x: 1, y: 2 } });
  // A row whose geometry really IS `{}` never carried a slug, so it is untouched
  // and must still disagree with a register `null`. This is the line that keeps
  // the fix from becoming a blanket excuse.
  assert.deepEqual(stripSlug({}), {});
  assert.equal(stripSlug(null), null);

  const cols = ["geometry"];
  const repoRow = { slug: "a/b", geometry: null };
  assert.deepEqual(compareMarks([{ slug: "a/b", geometry: stripSlug({ slug: "a/b" }) }], [repoRow], { columns: cols }), [],
    "after the fix the de-sited mark agrees");
  assert.match(compareMarks([{ slug: "a/b", geometry: stripSlug({}) }], [repoRow], { columns: cols })[0], /field geometry/,
    "and a genuinely empty geometry still reds");
});


// ── the backfill PLAN, called for real ───────────────────────────────────────
//
// WHAT THESE REPLACE, AND WHY. The first two tests under this heading built a
// stub client, never called `planBackfill`, re-ran the gate's pipeline inline and
// closed on `assert.ok(typeof planBackfill === "function")`. Reverting the bbox
// comparison to a string left all sixteen green. They were a probe that could not
// fail, standing where the falsifier for the most dangerous bug in this lane was
// supposed to be — and the report claimed the bug was pinned. Returned in review.
//
// These CALL it, against a real fixture world repo (a git repo with real commits
// and a `tools/marks-fold.mjs` the deriver imports out of it — the same technique
// and the same reason as `world2-replay-ingest.test.mjs`) and a stub client
// standing in for the store. What they assert is the plan's exact add and amend
// counts, so re-introducing either original bug moves a number.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  planBackfill, refusalFor, HELD_AMEND_CLASSES, AMEND_FLAG,
} from "../world2/tools/backfill-register.mjs";

const READER = `
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
export function fold({ marks }) {
  return { marks: marks.map((m) => ({ id: m.id, tier: "market", declared_household: "solo:" + m.by })) };
}
export function loadMarks(marksDir) {
  const repo = dirname(dirname(marksDir));
  const recs = JSON.parse(readFileSync(join(repo, "WORLD", "register.json"), "utf8"));
  return recs.map((r) => ({ ...r, _dir: join(marksDir, r.by, r.slug) }));
}
`;

const rec = (by, slug, over = {}) => ({
  id: `${by}/${slug}`, by, slug, kind: "sited", body: "A thing.",
  at: { x: 0, y: 0 }, extent: { w: 2, h: 2 }, ...over,
});

/** A world repo whose commits carry the two authorships the classifier splits on. */
function fixtureWorld(steps) {
  const dir = mkdtempSync(join(tmpdir(), "dec18-bf-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WORLD", "marks"), { recursive: true });
  // `deriveSeed` reads the town's clock out of STATE/log before it reads a single
  // mark ("cannot read the town's clock"), so a world with no log is not a world.
  // One crossing is enough: nothing here asks the log a question, but the fixture
  // has to be a shape the shipped deriver accepts, not a shape it tolerates.
  mkdirSync(join(dir, "STATE", "log"), { recursive: true });
  writeFileSync(join(dir, "tools", "marks-fold.mjs"), READER);
  const g = (env, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env }).trim();
  const base = { ...process.env };
  g(base, "init", "-q");
  try { g(base, "checkout", "-q", "-b", "main"); } catch { /* already main */ }
  const shas = {};
  for (const s of steps) {
    writeFileSync(join(dir, "WORLD", "register.json"), JSON.stringify(s.register));
    writeFileSync(join(dir, "STATE", "log", "1.jsonl"),
      JSON.stringify({ at: s.at, type: "legacy:emission", actor: "nobody", payload: { crossing: 1 } }));
    writeFileSync(join(dir, "STATE", "log", "1.meta.json"),
      JSON.stringify({ crossing: 1, covers_from: "2026-08-26T00:00:00.000Z" }));
    rmSync(join(dir, "WORLD", "marks"), { recursive: true, force: true });
    mkdirSync(join(dir, "WORLD", "marks"), { recursive: true });
    writeFileSync(join(dir, "WORLD", "marks", ".keep"), "");
    for (const m of s.register) {
      const nodeDir = join(dir, "WORLD", "marks", m.by, m.slug);
      mkdirSync(nodeDir, { recursive: true });
      writeFileSync(join(nodeDir, "mark.md"), `---\nkind: ${m.kind}\nby: ${m.by}\n---\n\n${m.body}\n`);
    }
    const env = {
      ...base,
      GIT_AUTHOR_NAME: s.author, GIT_AUTHOR_EMAIL: "a@a",
      GIT_COMMITTER_NAME: s.author, GIT_COMMITTER_EMAIL: "a@a",
      GIT_AUTHOR_DATE: s.at, GIT_COMMITTER_DATE: s.at,
    };
    g(env, "add", "-A");
    g(env, "commit", "-qm", s.subject);
    shas[s.name] = g(base, "rev-parse", "HEAD");
  }
  return { dir, shas, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const SWEEP_SUBJ =
  "settlement: sweep 3 published, 0 unpublished, 41 left drafted, 0 withdrawn, 0 quarantined";

/**
 * The world every plan test below is derived from.
 *
 *   hand/only-in-repo    added by a HAND commit, absent from the store  -> an ADD
 *   swept/amended-later  added, then its body changed by a SWEEP commit -> an AMEND
 *   spelling/agrees      identical in substance; the STORE's row differs only in how
 *                        Postgres spells the box and by the pre-006 slug smuggled
 *                        into geometry. The gate calls this identical, so no plan
 *                        may propose it. THIS is the row the flips move.
 */
const theWorld = () => fixtureWorld([
  {
    name: "first", author: "Postmark Pen", subject: SWEEP_SUBJ, at: "2026-08-28T00:00:00Z",
    register: [rec("swept", "amended-later", { body: "OLD." }), rec("spelling", "agrees")],
  },
  {
    name: "sweepAmend", author: "Postmark Pen", subject: SWEEP_SUBJ, at: "2026-08-29T00:00:00Z",
    register: [
      rec("swept", "amended-later", { body: "NEW, published by the sweep." }),
      rec("spelling", "agrees"),
    ],
  },
  {
    name: "hand", author: "Keemin Lee", at: "2026-09-01T00:00:00Z",
    subject: "parcel drain resumed: 17 households seated (founder's word)",
    register: [
      rec("swept", "amended-later", { body: "NEW, published by the sweep." }),
      rec("spelling", "agrees"),
      rec("hand", "only-in-repo"),
    ],
  },
]);

/** The store: two of the three marks, one of them stale, one only spelled differently. */
const storeRows = () => [
  {
    id: "11111111-1111-5111-8111-111111111111", slug: "swept/amended-later", kind: "sited",
    owner: "swept", household: "solo:swept", body: "OLD.",
    geometry: { at: { x: 0, y: 0 }, extent: { w: 2, h: 2 } },
    bbox: "((-1,-1),(1,1))", status: "standing", data: {},
  },
  {
    id: "22222222-2222-5222-8222-222222222222", slug: "spelling/agrees", kind: "sited",
    owner: "spelling", household: "solo:spelling", body: "A thing.",
    // Postgres' own spelling of the same box, and the pre-006 slug the clearing
    // job smuggled into geometry because the column is NOT NULL.
    geometry: { at: { x: 0, y: 0 }, extent: { w: 2, h: 2 }, slug: "spelling/agrees" },
    bbox: "(1,1),(-1,-1)", status: "standing", data: {},
  },
];

const stubClient = (marks, claims = []) => ({
  query: async (sql) => {
    if (/FROM claims/.test(sql)) return { rows: claims };
    if (/FROM marks/.test(sql)) return { rows: marks };
    throw new Error(`the stub was asked something planBackfill should not ask: ${sql}`);
  },
});

const planFor = (w, cls, marks = storeRows(), claims = []) =>
  planBackfill(stubClient(marks, claims), {
    worldRepo: w.dir, sha: w.shas.hand, windowId: 172, cls,
    lawSha: "0".repeat(40), townSha: null,
  });

test("BACKFILL — the plan is CALLED, and each class proposes exactly its own rows", async () => {
  const w = theWorld();
  try {
    const add = await planFor(w, "hand-planted-on-main");
    assert.equal(add.adds.length, 1, "the hand-planted mark is the one add");
    assert.equal(add.adds[0].slug, "hand/only-in-repo");
    assert.equal(add.amends.length, 0, "an ADD class can never emit an amend");

    const amend = await planFor(w, "sweep-amend-unmirrored");
    assert.equal(amend.adds.length, 0);
    assert.equal(amend.amends.length, 1, "the sweep-published body change is the one amend");
    assert.equal(amend.amends[0].slug, "swept/amended-later");
    assert.deepEqual(amend.amends[0].fields, ["body"]);

    // THE ROW THE FLIPS MOVE. `spelling/agrees` differs from the store only in how
    // Postgres spells its box and by the smuggled pre-006 slug. The gate calls it
    // identical, so NO class may propose it — and both original bugs did.
    for (const cls of ["hand-planted-on-main", "sweep-published-unmirrored",
      "sweep-amend-unmirrored", "hand-amend-on-main"]) {
      const p = await planFor(w, cls);
      assert.equal([...p.adds, ...p.amends].filter((r) => r.slug === "spelling/agrees").length, 0,
        `${cls} must not propose a row the gate is silent about`);
    }
  } finally { w.cleanup(); }
});

test("BACKFILL — the oracle is bound to --sha, not to the clone's working tree", async () => {
  const w = theWorld();
  try {
    // The repo's HEAD is the LAST commit, which carries `hand/only-in-repo`.
    // Deriving at the SWEEP-AMEND sha must not see it. Before this binding the
    // register came from the working tree while the header printed the sha, so
    // this assertion could not have failed however wrong the answer was.
    const atSweep = await planBackfill(stubClient(storeRows()), {
      worldRepo: w.dir, sha: w.shas.sweepAmend, windowId: 172,
      cls: "hand-planted-on-main", lawSha: "0".repeat(40), townSha: null,
    });
    assert.equal(atSweep.adds.length, 0,
      "at the sweep-amend sha the hand's mark does not exist yet, so there is nothing to add");
    assert.equal(atSweep.registerSize, 2, "the register at that sha holds two marks, not three");

    const atHead = await planFor(w, "hand-planted-on-main");
    assert.equal(atHead.adds.length, 1);
    assert.equal(atHead.registerSize, 3, "and at HEAD it holds three — the two shas differ");
  } finally { w.cleanup(); }
});

test("BACKFILL — an unknown sha REFUSES rather than falling back to the working tree", async () => {
  const w = theWorld();
  try {
    await assert.rejects(
      () => planBackfill(stubClient(storeRows()), {
        worldRepo: w.dir, sha: "0".repeat(40), windowId: 172,
        cls: "hand-planted-on-main", lawSha: "0".repeat(40), townSha: null,
      }),
      /.+/,
      "a sha the repo does not have must throw, never quietly read whatever is checked out");
  } finally { w.cleanup(); }
});

test("BACKFILL — historyFor refuses to be handed the repo in place of the checkout", async () => {
  await assert.rejects(
    () => historyFor({ worldRepo: "/nonexistent", sha: "deadbeef" }),
    /checkoutDir/,
    "the argument exists to make the working-tree bug impossible, so its absence is an error");
});

// ── the amend guard ──────────────────────────────────────────────────────────
//
// An add is reversible by id list; an amend is an in-place rewrite whose prior
// value exists nowhere in the store. The founder's authorization was given for
// the first. Until this guard the hold on the amends was a discipline: an add
// class could never emit an amend, but nothing stopped someone typing an amend
// class with the same three flags.

test("GUARD — a plan carrying an amend refuses --write unless the flag names the risk", () => {
  const r = refusalFor({ amendCount: 8 });
  assert.ok(r, "eight amends under --write must refuse");
  assert.match(r, /NOT reversible/);
  assert.match(r, /dump restore/);
  for (const cls of HELD_AMEND_CLASSES) assert.ok(r.includes(cls), `the refusal names ${cls}`);
  assert.ok(r.includes(`--${AMEND_FLAG}`), "and names the flag that lifts it");
  assert.equal(refusalFor({ amendCount: 8, accepted: true }), null, "and the flag lifts it");
});

test("GUARD — --recompute-standing is behind the same flag, for the same reason", () => {
  const r = refusalFor({ recompute: true });
  assert.ok(r, "an in-place tier rewrite must refuse too");
  assert.match(r, /REWRITES/);
  assert.match(r, /closes itself at the next/, "and says what waiting costs: nothing");
  assert.equal(refusalFor({ recompute: true, accepted: true }), null);
});

test("GUARD — a pure ADD plan is never refused, which is what makes the refusal mean something", () => {
  assert.equal(refusalFor({ amendCount: 0, recompute: false }), null,
    "tonight's two classes must pass with the three flags they already have");
});

// ── the visibility preflight ─────────────────────────────────────────────────
//
// THE BUG THESE EXIST FOR, and it is the worst this lane produced because no line
// of code was wrong. `claims` carries RLS since 007, policy `claims_read` hides
// every `draft` row from a session that has not set `app.household`, and
// `WORLD2_PG_URL` connects as `office_api`, which never sets it. So the plain
// SELECT behind `draftSlugs` returns an EMPTY SET on prod, the skip that holds
// five residents' private drafts cannot fire, and `sweep-published-unmirrored`
// plans 32 adds with no SKIPPED block. The five would have been published.
//
// My rehearsal saw them only because the scratch clone was queried as `postgres`,
// the table owner, and 007 deliberately does not FORCE the policy. The clone was
// faithful and the CONNECTION was not — every number I measured about drafts was
// measured through eyes prod does not have.
//
// A zero meaning "there are none" and a zero meaning "you are not permitted to
// look" must not be spelled the same way.

import {
  visibilityRefusal, canSeeDrafts, privilegeRefusal, heldSlugsFrom,
  WRITE_PRIVILEGES, DRAFTS_FLAG,
} from "../world2/tools/backfill-register.mjs";

/** The four shapes the probe can report, named. */
const OFFICE_API = { whoami: "office_api", bypassrls: false, rlsEnabled: true, rlsForced: false, tableOwner: "world2_owner" };
const OWNER = { whoami: "world2_owner", bypassrls: false, rlsEnabled: true, rlsForced: false, tableOwner: "world2_owner" };
const OWNER_FORCED = { ...OWNER, rlsForced: true };
const SUPERUSER = { whoami: "postgres", bypassrls: true, rlsEnabled: true, rlsForced: false, tableOwner: "world2_owner" };
const RLS_OFF = { whoami: "office_api", bypassrls: false, rlsEnabled: false, rlsForced: false, tableOwner: "world2_owner" };

test("VISIBILITY — RLS on and no bypass: the plan is REFUSED, not run against an empty set", () => {
  assert.equal(canSeeDrafts(OFFICE_API), false);
  const r = visibilityRefusal(OFFICE_API);
  assert.ok(r, "office_api cannot see drafts, so it must not plan");
  assert.match(r, /office_api/);
  assert.match(r, /claims_read/);
  assert.match(r, /you are not permitted to look/,
    "the refusal states the class, not just the symptom");
  assert.ok(r.includes(`--${DRAFTS_FLAG}`), "and names the escape hatch");
});

test("VISIBILITY — a role that bypasses, or owns the table, may plan", () => {
  assert.equal(canSeeDrafts(SUPERUSER), true);
  assert.equal(visibilityRefusal(SUPERUSER), null);
  assert.equal(canSeeDrafts(OWNER), true, "an owner bypasses a policy that is not FORCEd");
  assert.equal(visibilityRefusal(OWNER), null);
  assert.equal(canSeeDrafts(RLS_OFF), true, "and with RLS off the question does not arise");
});

test("VISIBILITY — FORCE ROW LEVEL SECURITY takes the owner's exemption away", () => {
  // 007 says why it does not FORCE the policy today. The owner's exemption is the
  // ONLY reason my rehearsal saw anything, so it is stated rather than assumed:
  // the day someone adds FORCE, this must answer no rather than yesterday's yes.
  assert.equal(canSeeDrafts(OWNER_FORCED), false);
  const r = visibilityRefusal(OWNER_FORCED);
  assert.ok(r);
  assert.match(r, /FORCEd/);
});

test("VISIBILITY — the by-name file lets a blind connection plan, and those slugs are held", () => {
  const held = new Set(["vermillion/pagani-huayra"]);
  assert.equal(visibilityRefusal(OFFICE_API, { heldByName: held }), null,
    "a name survives a policy; a status does not");
});

test("VISIBILITY — the by-name file is parsed so an operator can say WHO these people are", () => {
  const parsed = heldSlugsFrom([
    "# the five the sweep published and the store still holds as private drafts",
    "rook-of-garrison/goldies-dog-bed",
    "",
    "vermillion/pagani-huayra   # two of vermillion's",
    "vermillion/pagani-zonda",
    "   ",
    "neth/bug-reports-welcome",
    "rei/garden-water-dish-keeping-custom",
  ].join("\n"));
  assert.deepEqual(parsed, [
    "rook-of-garrison/goldies-dog-bed",
    "vermillion/pagani-huayra",
    "vermillion/pagani-zonda",
    "neth/bug-reports-welcome",
    "rei/garden-water-dish-keeping-custom",
  ]);
  // The failure mode that matters: a mis-parse looks like an empty file, and an
  // empty file publishes a resident's draft while every flag was typed correctly.
  assert.deepEqual(heldSlugsFrom("# only a comment\n\n   \n"), []);
});

test("VISIBILITY — the plan HOLDS a by-name slug the connection cannot see", async () => {
  const w = theWorld();
  try {
    // The store answers with NO draft rows — exactly what office_api sees on prod —
    // and the hold has to come from the name instead.
    const blind = await planBackfill(stubClient(storeRows(), []), {
      worldRepo: w.dir, sha: w.shas.hand, windowId: 172, cls: "hand-planted-on-main",
      lawSha: "0".repeat(40), townSha: null,
      heldByName: new Set(["hand/only-in-repo"]),
    });
    assert.equal(blind.adds.length, 0, "the named slug is not added");
    assert.equal(blind.skipped.filter((s) => s.slug === "hand/only-in-repo").length, 1);
    assert.match(blind.skipped.find((s) => s.slug === "hand/only-in-repo").why, /held BY NAME/,
      "and the skip says the hold came from a name, not from a claim it could read");

    // Without the name, and with the same blind store, it is added — which is the
    // whole finding: the store's silence is not evidence of absence.
    const sighted = await planFor(w, "hand-planted-on-main");
    assert.equal(sighted.adds.length, 1);
  } finally { w.cleanup(); }
});

// ── the privilege preflight ──────────────────────────────────────────────────
//
// Measured from 002_grants.sql: office_api may write claims and NOT marks;
// clearing_job may write marks and NOT claims. A backfill does both, so NEITHER
// role an operator would reach for can do this job — it needs the owner. Without
// this check the failure lands mid-transaction, after two dumps and three flags,
// and reads as one permission error rather than as the wrong role for the task.

test("PRIVILEGE — a role missing a grant is refused BEFORE any dump or write", () => {
  const asOffice = { whoami: "office_api", missing: ["INSERT on marks", "UPDATE on marks"] };
  const r = privilegeRefusal(asOffice);
  assert.ok(r);
  assert.match(r, /office_api/);
  assert.match(r, /INSERT on marks/);
  assert.match(r, /world2_owner/, "and names the role that can");
  assert.match(r, /BEFORE any dump or write/);
});

test("PRIVILEGE — the checked set covers every table the write path touches", () => {
  const need = new Set(WRITE_PRIVILEGES.map(([t, p]) => `${p} ${t}`));
  // `applyBackfill` INSERTs claims; `materializeClaims` INSERTs and UPDATEs marks
  // and reads the REGISTRY through `ownerHouseholdFor` → the one deriver (POS-160
  // follow-up RED 2 — it used to SELECT `identities`); the arm reads `windows`.
  for (const x of ["INSERT claims", "INSERT marks", "UPDATE marks", "SELECT windows",
                   "SELECT households", "SELECT household_pins", "SELECT registry_meta"]) {
    assert.ok(need.has(x), `the preflight must check ${x}`);
  }
  assert.ok(!need.has("SELECT identities"),
    "the write path no longer reads `identities`; a preflight still demanding it asks a role for a grant " +
    "it does not need, and a lawful-enumeration falsifier would have to carry the dead row too");
  assert.equal(privilegeRefusal({ whoami: "world2_owner", missing: [] }), null,
    "and a role holding all of them is not refused — the case that makes the others mean something");
});

// ── the three interaction rules ──────────────────────────────────────────────
//
// From the reviewer, 2026-09-05, after the visibility preflight landed. Each is
// a rule about how the checks relate to each other rather than about any one of
// them, which is exactly the kind that goes untested and then goes wrong.

import {
  seesAllDrafts, visibilityLine, privilegesForShape, privilegeProbe,
  READ_PRIVILEGES, ADD_PRIVILEGES, AMEND_PRIVILEGES,
} from "../world2/tools/backfill-register.mjs";

const V = (over) => ({
  whoami: "office_api", db: "world2_dev", bypassrls: false,
  rlsEnabled: true, rlsForced: false, tableOwner: "world2_owner", visibleDrafts: 0, ...over,
});

test("RULE — the condition is the DRAFT COUNT, not the role: a filtered subset refuses even when non-zero", () => {
  // The sharp case. A session that HAS set `app.household` sees its own drafts —
  // a non-zero count — and is still not the true count. "I can see some drafts"
  // is not the question; "is what I see all of them" is.
  const partial = V({ visibleDrafts: 3 });
  assert.equal(seesAllDrafts(partial), false,
    "three drafts visible under a policy is still a subset");
  const r = visibilityRefusal(partial);
  assert.ok(r);
  assert.match(r, /3 draft/, "the refusal states the count it can see");
  assert.match(r, /FILTERED SUBSET/);

  // And zero drafts under a role that sees everything is a real zero — it must
  // NOT refuse, or the preflight would block a store that simply has no drafts.
  const trulyNone = V({ whoami: "world2_owner", visibleDrafts: 0 });
  assert.equal(seesAllDrafts(trulyNone), true);
  assert.equal(visibilityRefusal(trulyNone), null,
    "a true zero is a fact about the store; a filtered zero is a fact about the connection");
});

test("RULE — the receipt line carries current_user, the database and the visible count, in both arms", () => {
  const owner = visibilityLine(V({ whoami: "world2_owner", visibleDrafts: 11 }), null);
  assert.match(owner, /world2_owner@world2_dev/, "role AND database, so two receipts are comparable");
  assert.match(owner, /drafts visible to this connection: 11/);
  assert.match(owner, /the true count/);

  const blind = visibilityLine(V({ visibleDrafts: 0 }), null);
  assert.match(blind, /office_api@world2_dev/);
  assert.match(blind, /drafts visible to this connection: 0/);
  assert.match(blind, /A FILTERED SUBSET/,
    "the same line says which kind of zero this is — that is the whole point of printing it");

  // The two lines differ where it matters, which is what makes a dry-run receipt
  // and a write receipt checkable against each other rather than merely similar.
  assert.notEqual(owner, blind);
});

test("RULE — a plan's privileges are asked BY SHAPE, so a pure ADD is not refused for UPDATE it never uses", () => {
  const add = privilegesForShape({ hasAmends: false }).map(([t, p]) => `${p} ${t}`);
  const amend = privilegesForShape({ hasAmends: true }).map(([t, p]) => `${p} ${t}`);

  assert.ok(add.includes("INSERT claims") && add.includes("INSERT marks"),
    "an ADD needs the admission and the mark");
  assert.ok(!add.includes("UPDATE marks"),
    "and it does NOT need the in-place rewrite — asking for it is a false refusal");
  assert.ok(amend.includes("UPDATE marks"), "an AMEND does");

  // Neither shape edits a claims row. Worth pinning: 002's claims_update_guard
  // exempts only clearing_job, so a design that DID update claims would be
  // refused by the store whichever role ran it.
  assert.ok(!amend.includes("UPDATE claims"));
  assert.deepEqual(AMEND_PRIVILEGES, [["marks", "UPDATE"]]);
  for (const [t, p] of READ_PRIVILEGES) assert.ok(add.includes(`${p} ${t}`), `${p} ${t} is needed to read`);
  for (const [t, p] of ADD_PRIVILEGES) assert.ok(amend.includes(`${p} ${t}`), "an amend plan also adds");
});

test("RULE — the probe asks the database only for the privileges that shape needs", async () => {
  // A stub that records the SQL, so what is asked is provable rather than assumed.
  const asked = [];
  const stub = (shape) => ({
    query: async (sql) => {
      asked.push(sql);
      const n = (sql.match(/has_table_privilege/g) ?? []).length;
      const row = { whoami: "world2_owner" };
      for (let i = 0; i < n; i++) row[`p${i}`] = true;
      return { rows: [row] };
    },
    shape,
  });

  const addProbe = await privilegeProbe(stub("add"), { hasAmends: false });
  assert.equal(addProbe.shape, "ADD");
  assert.ok(!asked[0].includes("'marks', 'UPDATE'"),
    "the ADD probe does not even ASK about UPDATE marks");
  assert.deepEqual(addProbe.missing, []);

  asked.length = 0;
  const amendProbe = await privilegeProbe(stub("amend"), { hasAmends: true });
  assert.equal(amendProbe.shape, "ADD+AMEND");
  assert.ok(asked[0].includes("'marks', 'UPDATE'"), "the AMEND probe does");
});

// ── the layer the bug actually lived on ──────────────────────────────────────
//
// THE BUG: the CLI read `--drafts-held-by-name`, used the set to LIFT the
// visibility refusal, and then built `planBackfill`'s options WITHOUT it. So the
// flag looked like it worked — the refusal went away, the run proceeded — and it
// held nothing: as `office_api` with all five slugs in the file, prod planned
// ADD 32 and printed no SKIPPED block. The escape hatch for the worst bug in this
// lane was itself inert.
//
// AND MY EXISTING TEST COULD NOT HAVE CAUGHT IT. "the plan HOLDS a by-name slug"
// calls `planBackfill` directly with `heldByName` — which is precisely the call
// the CLI was failing to make. A test aimed one layer below the mistake passes
// while the mistake ships. That is the same shape as the falsifier that could not
// fail, one layer over: the assertion was real and it was pointed at the wrong
// seam.
//
// So these test `preflightAndPlan` — the function the CLI now calls, where the
// preflight and the plan are one step and `held` is its argument — and they
// assert on the RENDERED RECEIPT, because "the SKIPPED block names the slug" is
// what an operator actually reads.

import { preflightAndPlan, renderPlan, PUBLISH_OVER_DRAFT_FLAG } from "../world2/tools/backfill-register.mjs";

/** A store that reports no drafts at all — exactly what office_api sees on prod. */
const blindStore = (visRow) => ({
  query: async (sql) => {
    if (/pg_class/.test(sql)) return { rows: [visRow] };
    if (/FROM claims/.test(sql)) return { rows: [] };
    if (/FROM marks/.test(sql)) return { rows: storeRows() };
    throw new Error(`unexpected query: ${sql}`);
  },
});

const OFFICE_ROW = {
  whoami: "office_api", db: "world2_dev", bypassrls: false,
  rls_enabled: true, rls_forced: false, table_owner: "world2_owner", visible_drafts: 0,
};
const OWNER_ROW = { ...OFFICE_ROW, whoami: "world2_owner", visible_drafts: 11 };

test("SEAM — the by-name hold reaches the PLAN, and the receipt shows the SKIPPED block", async () => {
  const w = theWorld();
  try {
    const { refused, plan } = await preflightAndPlan(blindStore(OFFICE_ROW), {
      worldRepo: w.dir, sha: w.shas.hand, windowId: 172, cls: "hand-planted-on-main",
      lawSha: "0".repeat(40), townSha: null,
      heldByName: new Set(["hand/only-in-repo"]),
    });
    assert.equal(refused, null, "the file lifts the refusal");
    assert.equal(plan.adds.length, 0, "and the named slug is NOT planned as an add");

    // What the operator reads. The bug printed no SKIPPED block at all.
    const receipt = renderPlan(plan, { sha: w.shas.hand, dbName: "world2_dev", windowId: 172 });
    assert.match(receipt, /ADD 0:/);
    assert.match(receipt, /SKIPPED 1/, "the receipt states the hold");
    assert.match(receipt, /hand\/only-in-repo/);
    assert.match(receipt, /held BY NAME/);
  } finally { w.cleanup(); }
});

test("SEAM — without the file, the same blind store refuses and plans NOTHING", async () => {
  const w = theWorld();
  try {
    const { refused, plan } = await preflightAndPlan(blindStore(OFFICE_ROW), {
      worldRepo: w.dir, sha: w.shas.hand, windowId: 172, cls: "hand-planted-on-main",
      lawSha: "0".repeat(40), townSha: null, heldByName: null,
    });
    assert.ok(refused, "a connection that cannot see drafts and was given no names must refuse");
    assert.equal(plan, null,
      "and it must not derive a plan at all — a refusal that still hands back a plan invites a caller to use it");
  } finally { w.cleanup(); }
});

test("SEAM — a connection that sees the true count needs no file, and holds by what it can read", async () => {
  const w = theWorld();
  try {
    const seeing = {
      query: async (sql) => {
        if (/pg_class/.test(sql)) return { rows: [OWNER_ROW] };
        if (/FROM claims/.test(sql)) return { rows: [{ slug: "hand/only-in-repo", status: "draft" }] };
        if (/FROM marks/.test(sql)) return { rows: storeRows() };
        throw new Error(`unexpected query: ${sql}`);
      },
    };
    const { refused, plan } = await preflightAndPlan(seeing, {
      worldRepo: w.dir, sha: w.shas.hand, windowId: 172, cls: "hand-planted-on-main",
      lawSha: "0".repeat(40), townSha: null, heldByName: null,
    });
    assert.equal(refused, null);
    assert.equal(plan.adds.length, 0, "the draft it can actually read is held");
    const receipt = renderPlan(plan, { sha: w.shas.hand, dbName: "world2_dev", windowId: 172 });
    assert.match(receipt, /SKIPPED 1/);
    assert.doesNotMatch(receipt, /held BY NAME/,
      "and the skip does NOT claim a name did it — the store said so itself");
  } finally { w.cleanup(); }
});

// ── RULED 2026-09-08: A PRIVATE DRAFT NEVER BLOCKS THE PUBLISHED BODY ──────
//
// The G1 rehearsal found thirteen published marks the store held only as a
// household's later private draft (Current's re-sent Snug fixtures, neth's,
// rook's, vermillion's, rei's). The tool refused them as "a ruling, not a
// backfill" — and the founder ruled: the published body becomes the standing
// row, the draft stays a draft. Typed on purpose; off by default; named on the
// receipt. The flip that proves it: the same store, flag off, plans NOTHING.
test("RULING — with --published-body-over-draft, the draft it can read is written beside, and the receipt says so", async () => {
  const w = theWorld();
  try {
    const seeing = {
      query: async (sql) => {
        if (/pg_class/.test(sql)) return { rows: [OWNER_ROW] };
        if (/FROM claims/.test(sql)) return { rows: [{ slug: "hand/only-in-repo", status: "draft" }] };
        if (/FROM marks/.test(sql)) return { rows: storeRows() };
        throw new Error(`unexpected query: ${sql}`);
      },
    };
    const { refused, plan } = await preflightAndPlan(seeing, {
      worldRepo: w.dir, sha: w.shas.hand, windowId: 172, cls: "hand-planted-on-main",
      lawSha: "0".repeat(40), townSha: null, heldByName: null, publishOverDraft: true,
    });
    assert.equal(refused, null);
    assert.equal(plan.adds.length, 1, "the published body is planned despite the draft");
    assert.equal(plan.adds[0].draftBeside, true, "and the row knows a draft stays beside it");
    assert.equal(plan.skipped.filter((s) => s.slug === "hand/only-in-repo").length, 0);
    const receipt = renderPlan(plan, { sha: w.shas.hand, dbName: "world2_dev", windowId: 172 });
    assert.match(receipt, /a private DRAFT stays beside it — ruled 2026-09-08/, "the receipt names the ruling on the row");
    assert.equal(typeof PUBLISH_OVER_DRAFT_FLAG, "string");
  } finally { w.cleanup(); }
});

test("RULING — the flip: flag off (the default), the same store holds the draft and plans nothing", async () => {
  const w = theWorld();
  try {
    const seeing = {
      query: async (sql) => {
        if (/pg_class/.test(sql)) return { rows: [OWNER_ROW] };
        if (/FROM claims/.test(sql)) return { rows: [{ slug: "hand/only-in-repo", status: "draft" }] };
        if (/FROM marks/.test(sql)) return { rows: storeRows() };
        throw new Error(`unexpected query: ${sql}`);
      },
    };
    const { plan } = await preflightAndPlan(seeing, {
      worldRepo: w.dir, sha: w.shas.hand, windowId: 172, cls: "hand-planted-on-main",
      lawSha: "0".repeat(40), townSha: null, heldByName: null,
    });
    assert.equal(plan.adds.length, 0);
    assert.match(plan.skipped.find((s) => s.slug === "hand/only-in-repo").why, /a ruling, not a backfill/);
  } finally { w.cleanup(); }
});
