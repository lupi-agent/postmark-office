// world2-snapshot-export.test.mjs — the notary pen's decisions, without a database.
//
// Everything `snapshot-export.mjs` DECIDES is pure with respect to Postgres: how
// an act becomes an archived line, how a mark becomes a file, which acts belong
// to which window, what the certification binds, and — the one that matters most
// — whether a re-derivation that disagrees with an existing archive is an
// overwrite or a refusal. Those are the tests here. The rows are shaped the way
// `pg` hands them over (bigint and numeric as TEXT, timestamptz as Date, jsonb as
// objects), because a test that fed the code prettier inputs than the driver does
// would prove something about a different program.
//
// The DB half is proved on the box instead, by `--verify` and its red-proof; see
// world2/tools/README.md § The notary.
//
// EVERY LAW ASSERTED BELOW IS QUOTED WHERE IT IS ASSERTED. The two that carry the
// file, both from the gold plan (postmark-world-2.md § 2):
//
//   "each closed window exported append-only into `archives/` — machine-written
//    but single-pen, frozen-on-write, an input never re-derived-into"
//
//   "the office cannot rewrite history without the repo catching it"

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  archiveLine, exactNumber, actsRangeFor, renderMark, safeSlug, markPath,
  contentDigest, certification, certificationSubstance, canonical,
  checkArchives, writeMarks, assertUsableTarget, sampleIndexes, Cannot,
  crossingSailsAt, completingFerryFor, ferryPartition, heldWindowLine,
  parseRefreeze, refreezeCommitMessage, refreezeManyCommitMessage, derive,
} from "../world2/tools/snapshot-export.mjs";

// ── fixtures, in the driver's own shapes ─────────────────────────────────────

const ACT = {
  id: "2400",                                   // bigint -> text
  at: new Date("2026-08-25T23:05:38.873Z"),     // timestamptz -> Date
  crossing: "149.9245083101852",                // numeric -> text
  actor: "lupi",
  action: "legacy:departure",
  object: null,
  at_anchor: null, at_dx: null, at_dy: null,
  witnesses: null,
  class: "legacy",
  payload: { type: "departure", to: { y: 5, x: 3 } },   // jsonb -> object
  effect: null,
  household: "gh:1",
  journal_seq: null,
  inserted_at: new Date("2026-08-28T12:00:00.000Z"),
};

const MARK = {
  id: "595c62fc-9f7c-5d90-b73e-2b7363504840",
  slug: "aion-solare/aelyria",
  kind: "sited",
  owner: "aion-solare",
  household: "gh:293432145",
  body: "The far seaward quarter where cobblestones give out.",
  geometry: { extent: { w: 1471, h: 1085 }, at: { y: 4938.5, x: 3637.5 } },
  status: "standing",
  locked_window: 150,
  retired_window: null,
  data: { tier: "market", date: "2026-07-23", _origin: { y: 0, x: 0 } },
  parent: null,
};

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "w2notary-test-"));
  execFileSync("git", ["-C", dir, "init", "-q", "-b", "main"]);
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t",
    "commit", "-q", "--allow-empty", "-m", "root"]);
  return dir;
}

// ── the archived line ────────────────────────────────────────────────────────

test("an archived act carries the WHOLE row, in one fixed field order", () => {
  const line = archiveLine(ACT);
  // Top-level keys only, in the order the line spells them — JSON.parse keeps
  // insertion order for non-numeric keys, so this reads the line's own order
  // rather than a regex's guess at it.
  assert.deepEqual(Object.keys(JSON.parse(line)), [
    "id", "at", "crossing", "actor", "action", "object",
    "at_anchor", "at_dx", "at_dy", "witnesses", "class", "payload",
    "effect", "household", "journal_seq", "inserted_at",
  ]);
  // The durability lane is "download-the-town" (gold § 2), so the archive is the
  // row and not a summary of it: nothing a reader would need to reconstruct the
  // log is left out.
  const parsed = JSON.parse(line);
  assert.equal(parsed.actor, "lupi");
  assert.equal(parsed.at, "2026-08-25T23:05:38.873Z");
  assert.equal(parsed.crossing, 149.9245083101852);
  assert.equal(parsed.journal_seq, null);
});

test("two spellings of the same jsonb value archive as ONE line", () => {
  // jsonb stores a value, not a document — it re-orders keys, and two honest
  // reads must still produce byte-identical archives or the append-only check
  // would refuse a file it had just written itself.
  const a = archiveLine(ACT);
  const b = archiveLine({ ...ACT, payload: { to: { x: 3, y: 5 }, type: "departure" } });
  assert.equal(a, b);
  assert.match(a, /"payload":\{"to":\{"x":3,"y":5\},"type":"departure"\}/);
});

test("a number that cannot survive the JSON round-trip is REFUSED, not rounded", () => {
  // An archive is frozen on write: a digit dropped here is dropped forever, and
  // silently. 2^53+1 is the first integer a JSON number cannot hold.
  assert.throws(() => archiveLine({ ...ACT, id: "9007199254740993" }), /losing precision/);
  // …and the guard does not fire on a spelling difference, only on a value one.
  assert.equal(exactNumber("150.00", "x"), 150);
  assert.equal(exactNumber("0150", "x"), 150);
  assert.equal(exactNumber(null, "x"), null);
});

// ── which acts belong to which window ────────────────────────────────────────

test("the genesis window has no lower bound, so the legacy backfill rides with it", () => {
  // The brief's own instruction, and the only home those rows have: at seed the
  // legacy acts sit at crossings 118–149, below the genesis window's own id.
  assert.deepEqual(actsRangeFor(150, null), { after: null, upto: 150 });
});

test("a later window is bounded by the previous CLOSED window, half-open below", () => {
  // (previous, this]: every act is archived exactly once, and an act landing
  // exactly on a crossing boundary belongs to the window that closed there.
  assert.deepEqual(actsRangeFor(151, 150), { after: 150, upto: 151 });
});

// ── the mark render ──────────────────────────────────────────────────────────

test("a rendered mark says, in its own frontmatter, that it is a render", () => {
  // "Editing one of these files edits nothing" is only fair if the file says so
  // where the person editing it will be looking. census.md decision 1 makes the
  // DB the source; this file is the fork-and-read view of it.
  const out = renderMark(MARK);
  assert.match(out, /^---\n/);
  assert.match(out, /rendered_by: .*a RENDER of DB-source, re-derived in full on every export/);
  assert.match(out, /^slug: aion-solare\/aelyria$/m);
  assert.match(out, /^kind: sited$/m);
  assert.match(out, /^locked_window: 150$/m);
  assert.ok(out.endsWith("The far seaward quarter where cobblestones give out.\n"));
});

test("the render carries geometry and NOT bbox", () => {
  // 001_tables.sql: bbox is "writer-computed from geometry". Rendering a derived
  // column beside the thing it derives from invites a reader to believe the two
  // could disagree.
  const out = renderMark({ ...MARK, bbox: "(4373,5481),(2902,4396)" });
  assert.match(out, /^geometry: \{"at":\{"x":3637\.5,"y":4938\.5\},"extent":\{"h":1085,"w":1471\}\}$/m);
  assert.ok(!out.includes("bbox"));
});

test("a de-sited mark renders geometry: null — the null is the fact, not an omission", () => {
  // 004_marks_data.sql's CHECK, `sited_marks_have_a_where`: "what stands IN the
  // world has a where; what continues a parent does not."
  const out = renderMark({
    ...MARK, slug: "wren/the-glow", kind: "naming", geometry: null,
    parent: "97d0fb4e-e229-52c4-8067-0674d7002ebd",
  });
  assert.match(out, /^geometry: null$/m);
  assert.match(out, /^parent: 97d0fb4e-e229-52c4-8067-0674d7002ebd$/m);
});

test("a law-parent renders as its OWN field, never folded into parent", () => {
  // The merge ruling of 2026-08-28 (README § the 76 class-parented marks): a
  // law-parent is a different KIND of edge than a marks-parent, and folding both
  // into one field would be false uniformity.
  const out = renderMark({
    ...MARK, slug: "the-town/amend-engine", kind: "predicated", geometry: null,
    parent: null, data: { tier: "constitution", _parent_is_law: "the-town/amend" },
  });
  assert.match(out, /^parent: null$/m);
  assert.match(out, /^parent_law: the-town\/amend$/m);
  // and a mark with no law-parent grows no such field
  assert.ok(!renderMark(MARK).includes("parent_law:"));
});

test("`data` renders as itself, key-sorted — the record's remainder, not a second schema", () => {
  // seed-import's ruling, kept: `data` is the record's own residue. It is not
  // splatted back into the frontmatter shape a human once typed, because that
  // would be this pen inventing a schema for someone else's file.
  const out = renderMark(MARK);
  const block = out.slice(out.indexOf("data:")).split("\n").slice(0, 4);
  assert.deepEqual(block, [
    "data:",
    `  _origin: {"x":0,"y":0}`,
    `  date: "2026-07-23"`,
    "  tier: market",
  ]);
});

test("two spellings of the same mark render byte-identically", () => {
  const a = renderMark(MARK);
  const b = renderMark({ ...MARK,
    geometry: { at: { x: 3637.5, y: 4938.5 }, extent: { w: 1471, h: 1085 } },
    data: { _origin: { x: 0, y: 0 }, date: "2026-07-23", tier: "market" } });
  assert.equal(a, b);
});

// ── a slug becomes a path, so it is checked before it becomes one ────────────

test("a slug that would escape the marks tree is refused", () => {
  assert.equal(safeSlug("aion-solare/aelyria"), null);
  assert.match(safeSlug("../../etc/passwd"), /not <owner>\/<name>/);
  assert.match(safeSlug("wren/.."), /relative segment/);
  assert.match(safeSlug("/wren/x"), /absolute|not <owner>/);
  assert.match(safeSlug("wren\\x"), /backslash/);
  assert.match(safeSlug("solo"), /not <owner>\/<name>/);
  // A resident handle ending in '.' has already cost this town a directory
  // Win32 could not address.
  assert.match(safeSlug("wren./x"), /unaddressable on Win32/);
  assert.equal(markPath("wren/the-yard"), "WORLD2/marks/wren/the-yard/mark.md");
});

// ── the certification ────────────────────────────────────────────────────────

test("the content digest is a fact about the SET of files, not the read order", () => {
  // "Anyone can clone and verify what was certified when" (gold § 2) is a promise
  // about a computation a stranger can run — so it must not depend on the order
  // this pen happened to read rows in.
  const files = [{ key: "b", bytes: "two" }, { key: "a", bytes: "one" }];
  assert.equal(contentDigest(files), contentDigest([...files].reverse()));
  assert.notEqual(contentDigest(files), contentDigest([{ key: "b", bytes: "two" }, { key: "a", bytes: "ONE" }]));
  assert.match(contentDigest(files), /^sha256:[0-9a-f]{64}$/);
});

test("`exported_at` is the ONLY field a re-run may differ by", () => {
  // Otherwise "already certified, nothing to do" could never be true and the
  // notary would tag a new certification every time it merely looked.
  const base = {
    cursors: { acts_cursor: 2401, marks_count: 831 }, windowCursor: 150,
    pins: { law_sha: "aa", town_sha: "bb" }, marksDigest: "sha256:cc",
    archives: [{ window: 150, lines: 2, bytes: "x\ny\n" }],
  };
  const one = certification({ ...base, exportedAt: "2026-08-28T00:00:00.000Z" });
  const two = certification({ ...base, exportedAt: "2026-08-29T09:99:00.000Z" });
  assert.notDeepEqual(one, two);
  assert.equal(certificationSubstance(one), certificationSubstance(two));
  // and a real change is NOT invisible to that comparison
  const moved = certification({ ...base, cursors: { acts_cursor: 2402, marks_count: 831 }, exportedAt: one.exported_at });
  assert.notEqual(certificationSubstance(one), certificationSubstance(moved));
});

test("the certification binds the archives' CONTENT, not only the log's length", () => {
  // The acts cursor alone would notice an act appended and miss an act
  // rewritten — and the sentence this pen exists to make true is "the office
  // cannot rewrite history without the repo catching it".
  const base = {
    cursors: { acts_cursor: 2401, marks_count: 831 }, windowCursor: 150,
    pins: { law_sha: "aa", town_sha: "bb" }, marksDigest: "sha256:cc",
    exportedAt: "2026-08-28T00:00:00.000Z",
  };
  const honest = certification({ ...base, archives: [{ window: 150, lines: 2, bytes: "x\ny\n" }] });
  const rewritten = certification({ ...base, archives: [{ window: 150, lines: 2, bytes: "x\nZ\n" }] });
  assert.equal(honest.acts_cursor, rewritten.acts_cursor);
  assert.notEqual(honest.archives_sha, rewritten.archives_sha);
  assert.notEqual(certificationSubstance(honest), certificationSubstance(rewritten));
});

// ── THE APPEND-ONLY REFUSAL — the file's reason to exist ────────────────────

const archive = (bytes) => [{ window: 150, lines: bytes.split("\n").length - 1, bytes, path: "archives/acts/150.jsonl" }];

test("an absent archive is written; an identical one is left alone", () => {
  const dir = repo();
  try {
    const a = archive("one\ntwo\n");
    assert.deepEqual(checkArchives(dir, a).plan.map((p) => p.action), ["write"]);
    assert.equal(checkArchives(dir, a).findings.length, 0);

    mkdirSync(join(dir, "archives", "acts"), { recursive: true });
    writeFileSync(join(dir, "archives/acts/150.jsonl"), "one\ntwo\n");
    const again = checkArchives(dir, a);
    assert.deepEqual(again.plan.map((p) => p.action), ["unchanged"]);
    assert.equal(again.findings.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("an archive that re-derives DIFFERENTLY is a finding, naming the line — never an overwrite", () => {
  // LAW (gold § 2, verbatim): "each closed window exported append-only into
  // `archives/` — machine-written but single-pen, FROZEN-ON-WRITE, an input
  // never re-derived-into."
  const dir = repo();
  try {
    mkdirSync(join(dir, "archives", "acts"), { recursive: true });
    writeFileSync(join(dir, "archives/acts/150.jsonl"), `{"id":1,"actor":"lupi"}\n{"id":2,"actor":"wren"}\n`);
    const { findings } = checkArchives(dir, archive(`{"id":1,"actor":"lupi"}\n{"id":2,"actor":"FORGED"}\n`));

    assert.equal(findings.length, 1);
    assert.match(findings[0], /archives\/acts\/150\.jsonl is an ARCHIVE and already exists/);
    assert.match(findings[0], /line 2 differs at char/);
    assert.match(findings[0], /on disk: .*wren/);
    assert.match(findings[0], /derived: .*FORGED/);
    assert.match(findings[0], /the notary will not overwrite it/);

    // and the file on disk is untouched — a refusal that had already written
    // would be a refusal in name only
    assert.equal(readFileSync(join(dir, "archives/acts/150.jsonl"), "utf8"),
      `{"id":1,"actor":"lupi"}\n{"id":2,"actor":"wren"}\n`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a line the database no longer derives is a finding too, said in those words", () => {
  // History shrinking is the same crime as history changing, and the harder one
  // to notice: the file is a superset, so every line the DB still derives agrees.
  const dir = repo();
  try {
    mkdirSync(join(dir, "archives", "acts"), { recursive: true });
    writeFileSync(join(dir, "archives/acts/150.jsonl"), `{"id":1}\n{"id":2}\n`);
    const { findings } = checkArchives(dir, archive(`{"id":1}\n`));
    assert.equal(findings.length, 1);
    assert.match(findings[0], /line count 2 on disk, 1 re-derived/);
    assert.match(findings[0], /line 2: on disk but the database no longer derives it/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the render tree is re-derived IN FULL ───────────────────────────────────

test("a mark file no row derives is removed — a full re-render, not an accumulation", () => {
  const dir = repo();
  try {
    const rendered = [{ slug: MARK.slug, path: markPath(MARK.slug), bytes: renderMark(MARK) }];
    writeMarks(dir, rendered, { dryRun: false });
    assert.ok(existsSync(join(dir, markPath(MARK.slug))));

    const stale = join(dir, "WORLD2/marks/ghost/gone/mark.md");
    mkdirSync(join(dir, "WORLD2/marks/ghost/gone"), { recursive: true });
    writeFileSync(stale, "a mark that no longer exists\n");

    const r = writeMarks(dir, rendered, { dryRun: false });
    assert.deepEqual(r.removed, ["WORLD2/marks/ghost/gone/mark.md"]);
    assert.equal(r.unchanged, 1);
    assert.ok(!existsSync(stale));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a missing archive is planned for writing even where its siblings are unchanged", () => {
  // FOUND LIVE, 2026-08-28: with the tag in place the exporter used to answer
  // "nothing new to certify" and return BEFORE looking at the files, so deleting
  // an archive from a certified target left the hole and reported green. A tag
  // proves this state was certified once; only the files prove the checkout
  // still holds it. `checkArchives` reads the target, which is what makes the
  // repair path decidable at all.
  const dir = repo();
  try {
    mkdirSync(join(dir, "archives", "acts"), { recursive: true });
    writeFileSync(join(dir, "archives/acts/150.jsonl"), "one\n");
    const two = [
      { window: 150, lines: 1, bytes: "one\n", path: "archives/acts/150.jsonl" },
      { window: 151, lines: 1, bytes: "two\n", path: "archives/acts/151.jsonl" },
    ];
    const { plan, findings } = checkArchives(dir, two);
    assert.equal(findings.length, 0);
    assert.deepEqual(plan.map((p) => [p.window, p.action]), [[150, "unchanged"], [151, "write"]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--dry-run writes nothing at all", () => {
  const dir = repo();
  try {
    const rendered = [{ slug: MARK.slug, path: markPath(MARK.slug), bytes: renderMark(MARK) }];
    const r = writeMarks(dir, rendered, { dryRun: true });
    assert.equal(r.written, 1);
    assert.ok(!existsSync(join(dir, markPath(MARK.slug))));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the target the caller supplies ──────────────────────────────────────────

test("the pen refuses a target it would have to CREATE", () => {
  // The stateless contract (gold § 3): the caller supplies the checkout. A pen
  // that made one would be the long-lived clone the whole migration deletes.
  const dir = mkdtempSync(join(tmpdir(), "w2notary-bare-"));
  try {
    assert.throws(() => assertUsableTarget(dir, { allowDetached: true }), Cannot);
    assert.throws(() => assertUsableTarget(join(dir, "nope"), { allowDetached: true }), /not a directory/);
    assert.throws(() => assertUsableTarget(null, { allowDetached: true }), /never creates a checkout/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a detached HEAD is refused by name, because a push of it ships nothing", () => {
  const dir = repo();
  try {
    execFileSync("git", ["-C", dir, "checkout", "-q", "--detach", "HEAD"]);
    assert.throws(() => assertUsableTarget(dir, { allowDetached: false }), /DETACHED HEAD/);
    assert.equal(assertUsableTarget(dir, { allowDetached: true }).length > 0, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the verifier's sampling, and the gap that made the whole-file check ─────

test("a sampler alone cannot be the detector — which is why --verify hashes whole files", () => {
  // FOUND LIVE, 2026-08-28: the first --verify red-proof mangled line 97 of a
  // 2,400-line archive and went red, which looked like proof. It was not. Line
  // 97 is one of the 25 lines `sampleIndexes` picks; line 98 is not, and the
  // certification comparison never opens an archive — so an edit one line lower
  // would have passed. The fix is in `runVerify`: every archive is compared
  // whole, against the DB derivation AND against the sha the certification
  // records. This test holds the sampler to the honest claim about itself.
  const sampled = new Set(sampleIndexes(2400, 25));
  assert.ok(sampled.has(96), "line 97 (index 96) is sampled — the line the live proof mangled");
  assert.ok(!sampled.has(97), "line 98 (index 97) is NOT — a sampler is not a detector");
  assert.equal(sampled.size, 25);
});

// ── the verifier's sampling ─────────────────────────────────────────────────

test("spot-check sampling is deterministic and covers everything when it can", () => {
  // Random sampling would make a green mean "some lines, once" — and two
  // verifications of the same target must be able to disagree only about the
  // target, never about which lines they looked at.
  assert.deepEqual(sampleIndexes(3, 25), [0, 1, 2]);
  assert.deepEqual(sampleIndexes(10, 5), sampleIndexes(10, 5));
  assert.deepEqual(sampleIndexes(10, 5), [0, 2, 4, 6, 8]);
  assert.equal(sampleIndexes(2400, 25).length, 25);
  assert.ok(sampleIndexes(2400, 25).every((i) => i >= 0 && i < 2400));
});

test("canonical() is total — it does not throw on the shapes pg returns", () => {
  assert.equal(canonical(undefined), "null");
  assert.equal(canonical(new Date("2026-08-28T00:00:00Z")), `"2026-08-28T00:00:00.000Z"`);
  assert.equal(canonical([{ b: 1, a: 2 }]), `[{"a":2,"b":1}]`);
});

// ── THE FERRY CLOCK (POS-189) ───────────────────────────────────────────────
//
// The pen chose its windows on the SETTLEMENT clock (windows close at the
// 06:00Z / 18:00Z clearings) and its acts on the FERRY clock (00:00Z / 12:00Z).
// The two disagree about the newest window, and because an archive is frozen on
// write, a window frozen early is a file every later run must refuse.
//
// THE INSTANCE, measured on the box (2026-09-21/22): ferry 202 sailed
// 2026-09-21T00:00Z; at 07:22Z the pen froze window 202 with 84 acts; acts
// numbered 202 kept arriving (id 7181 at 07:47Z, id 7182 at 09:13Z) until the
// 12:00Z ferry, which is ferry 203; the next night re-derived 94 and REFUSED.
//
// Every fixture below is that instance's own clock.

const WINDOW_202_FROZEN_EARLY = "2026-09-21T07:22:00.000Z";  // the run that did it
const FERRY_203_SAILS         = "2026-09-21T12:00:00.000Z";  // when window 202 stops growing
const AFTER_FERRY_203         = "2026-09-21T13:00:00.000Z";

test("crossing N sails at epoch + N x 12h — the ratified derivation's own anchor", () => {
  // crossings.mjs, quoting Keemin 2026-07-29 verbatim: "crossings run 00:00 /
  // 12:00 UTC (the ferry's clock), counted from the mail-ledger's first delivery
  // day (2026-06-12) ... Crossing 100 lands 2026-08-01 00:00 UTC."
  assert.equal(crossingSailsAt(100), "2026-08-01T00:00:00.000Z");
  assert.equal(crossingSailsAt(0), "2026-06-12T00:00:00.000Z");
  // and the instance's own two boats
  assert.equal(crossingSailsAt(202), "2026-09-21T00:00:00.000Z");
  assert.equal(crossingSailsAt(203), FERRY_203_SAILS);
});

test("an act's number names the ferry that LAST sailed — so window N waits for ferry N+1", () => {
  // FINDING 1, and the direction the whole rule turns on. Every writer stamps
  // `crossing: currentCrossing()` (world-apex.mjs, world-hold.mjs, world.mjs),
  // and world2-pen.mjs § lateCrossingGuard calls that same number `open` and
  // throws on anything larger: "the future is not a place a row can file into".
  // So an act numbered N arrived in [ferry N sails, ferry N+1 sails).
  assert.equal(completingFerryFor(202), 203);
  // The instance is the check: acts numbered 202 arrived at 07:47Z and 09:13Z
  // on 09-21, which is AFTER ferry 202 sailed at 00:00Z. Had the number named
  // the boat an act WILL sail on, those rows could not have existed.
  assert.ok(Date.parse("2026-09-21T09:13:00Z") > Date.parse(crossingSailsAt(202)));
  assert.ok(Date.parse("2026-09-21T09:13:00Z") < Date.parse(crossingSailsAt(203)));
});

test("FALSIFIER (a) — a settlement-closed window whose ferry has not sailed is HELD BACK", () => {
  const windows = [{ id: 201 }, { id: 202 }];
  const { archivable, held } = ferryPartition(windows, Date.parse(WINDOW_202_FROZEN_EARLY));
  assert.deepEqual(archivable.map((w) => w.id), [201]);
  assert.deepEqual(held.map((h) => h.id), [202]);
  assert.equal(held[0].ferry, 203);
  assert.equal(held[0].sailsAt, FERRY_203_SAILS);
  // and it SAYS itself, the way heldBack acts already do
  assert.match(heldWindowLine(held[0]), /window 202 closed on the settlement clock/);
  assert.match(heldWindowLine(held[0]), /ferry 203 sails at 2026-09-21T12:00:00\.000Z/);
});

test("the boundary is the sailing instant itself, not a moment either side of it", () => {
  const windows = [{ id: 202 }];
  // one millisecond before ferry 203: still growing
  assert.equal(ferryPartition(windows, Date.parse(FERRY_203_SAILS) - 1).held.length, 1);
  // at the instant it sails: complete
  assert.equal(ferryPartition(windows, Date.parse(FERRY_203_SAILS)).archivable.length, 1);
  assert.equal(ferryPartition(windows, Date.parse(FERRY_203_SAILS)).held.length, 0);
});

// ── the gate, where it is WIRED ─────────────────────────────────────────────
//
// `derive` is the only place the two clocks meet, so the falsifier reads it and
// not just the arithmetic beside it: a test that asserted `ferryPartition`
// alone would survive a revert of the gate, and a probe that cannot fail is not
// a probe. The client below answers the four SELECTs `derive` makes, in the
// shapes `pg` hands them over (bigint and numeric as TEXT), and nothing else —
// an unexpected statement throws rather than returning an obliging empty set.

function fakeClient({ windows, acts, marks = [] }) {
  return {
    async query(sql, params = []) {
      if (sql.includes("acts_cursor")) {
        const ids = acts.map((a) => Number(a.id));
        return { rows: [{
          acts_cursor: ids.length ? String(Math.max(...ids)) : null,
          acts_total: String(acts.length),
          marks_count: String(marks.length),
        }] };
      }
      if (sql.includes("FROM windows")) return { rows: windows };
      if (sql.includes("FROM acts")) {
        const upto = Number(params[0]);
        const after = params.length > 1 ? Number(params[1]) : null;
        return { rows: acts.filter((a) => a.crossing !== null
          && Number(a.crossing) <= upto && (after === null || Number(a.crossing) > after)) };
      }
      if (sql.includes("FROM marks")) return { rows: marks };
      throw new Error(`the notary asked something this stub does not answer: ${sql}`);
    },
  };
}

const act = (id, crossing, at) => ({
  ...ACT, id: String(id), crossing: String(crossing), at: new Date(at), inserted_at: new Date(at),
});

// Window 201 is settled and still. Window 202 holds the two rows that were on
// disk at 07:22Z and the two the box measured arriving after it — id 7181 at
// 07:47Z and id 7182 at 09:13Z, the acts the frozen file did not contain.
const INSTANCE = {
  windows: [
    { id: "201", opens_at: new Date("2026-09-20T12:00:00Z"), closes_at: new Date("2026-09-21T00:00:00Z"),
      status: "closed", law_sha: "law201", town_sha: "town201", cleared_at: new Date("2026-09-20T18:00:00Z") },
    { id: "202", opens_at: new Date("2026-09-21T00:00:00Z"), closes_at: new Date("2026-09-21T12:00:00Z"),
      status: "closed", law_sha: "law202", town_sha: "town202", cleared_at: new Date("2026-09-21T06:00:00Z") },
  ],
  acts: [
    act(7100, 201, "2026-09-20T13:00:00Z"),
    act(7101, 201, "2026-09-20T23:00:00Z"),
    act(7179, 202, "2026-09-21T01:00:00Z"),
    act(7180, 202, "2026-09-21T05:00:00Z"),
    act(7181, 202, "2026-09-21T07:47:00Z"),   // arrived AFTER the pen froze 202
    act(7182, 202, "2026-09-21T09:13:00Z"),   // and again
  ],
};

test("FALSIFIER (a), wired — at 07:22Z the pen does NOT archive window 202, and names why", async () => {
  const d = await derive(fakeClient(INSTANCE), { now: Date.parse(WINDOW_202_FROZEN_EARLY) });

  assert.deepEqual(d.archives.map((a) => a.window), [201],
    "window 202 is closed on the settlement clock and STILL GROWING on the ferry clock");
  assert.equal(d.windowCursor, 201);
  assert.deepEqual(d.pins, { law_sha: "law201", town_sha: "town201" },
    "the certification pins what it archives, not a window it held back");

  assert.deepEqual(d.held.map((h) => h.id), [202]);
  assert.match(heldWindowLine(d.held[0]), /ferry 203 sails at 2026-09-21T12:00:00\.000Z/);

  // the four acts numbered 202 are counted, never silently dropped
  assert.equal(d.heldBack, 4);
});

test("FALSIFIER (b) — past its sailing, window 202 archives ONCE and a second run is byte-stable", async () => {
  const d = await derive(fakeClient(INSTANCE), { now: Date.parse(AFTER_FERRY_203) });

  assert.deepEqual(d.archives.map((a) => a.window), [201, 202]);
  assert.equal(d.held.length, 0);
  assert.equal(d.heldBack, 0);
  // and it is the COMPLETE window — all four rows, including the two that
  // arrived after the early freeze. This is the count that went 84 then 94.
  assert.equal(d.archives.find((a) => a.window === 202).lines, 4);

  const dir = repo();
  try {
    const first = checkArchives(dir, d.archives);
    assert.deepEqual(first.plan.map((p) => p.action), ["write", "write"]);
    assert.equal(first.findings.length, 0);
    mkdirSync(join(dir, "archives", "acts"), { recursive: true });
    for (const a of first.plan) writeFileSync(join(dir, a.path), a.bytes);

    // SECOND RUN, a full re-derivation at a later hour: byte-stable, nothing to
    // write, no finding. (Exit 0 is what "no finding and nothing to write" is.)
    const again = await derive(fakeClient(INSTANCE), { now: Date.parse("2026-09-22T07:22:00Z") });
    const second = checkArchives(dir, again.archives);
    assert.deepEqual(second.plan.map((p) => p.action), ["unchanged", "unchanged"]);
    assert.equal(second.findings.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the early freeze is EXACTLY what the pen refuses the next night — the bug, held still", async () => {
  // Why POS-189 is a defect and not a nuisance: the 07:22Z file is short, and
  // the refusal it earns the next night is correct. The pen was right to refuse
  // and wrong to have written that file at all.
  const early = await derive(fakeClient(INSTANCE), { now: Date.parse(WINDOW_202_FROZEN_EARLY) });
  assert.equal(early.archives.some((a) => a.window === 202), false);

  // what 07:22Z would have written: the two rows that had arrived by then
  const shortBytes = (await derive(fakeClient({
    ...INSTANCE, acts: INSTANCE.acts.filter((a) => Number(a.id) < 7181),
  }), { now: Date.parse(AFTER_FERRY_203) })).archives.find((a) => a.window === 202).bytes;

  const dir = repo();
  try {
    mkdirSync(join(dir, "archives", "acts"), { recursive: true });
    writeFileSync(join(dir, "archives/acts/202.jsonl"), shortBytes);
    const full = await derive(fakeClient(INSTANCE), { now: Date.parse(AFTER_FERRY_203) });
    const { findings } = checkArchives(dir, full.archives.filter((a) => a.window === 202));
    assert.equal(findings.length, 1);
    assert.match(findings[0], /line count 2 on disk, 4 re-derived/);
    assert.match(findings[0], /the notary will not overwrite it/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── THE OPERATOR DOOR: --refreeze <n> --reason "<text>" ─────────────────────
//
// The 2026-09-14 rule: every guard gets an operator door with a receipt, and a
// rule with no door is a defect. When this pen froze window 202 early, the only
// way past its own refusal was a hand removing the file from the notary repo —
// a write with no receipt the pen could enforce. The door is that write, made
// nameable: ONE window, both sha256s and the operator's reason on the commit's
// first line.

const differing = (window, bytes) => [{
  window, lines: bytes.replace(/\n$/, "").split("\n").length, bytes,
  path: `archives/acts/${window}.jsonl`,
}];

test("FALSIFIER (c) — a differing archive with NO door still refuses, exactly as before", () => {
  const dir = repo();
  try {
    mkdirSync(join(dir, "archives", "acts"), { recursive: true });
    writeFileSync(join(dir, "archives/acts/202.jsonl"), `{"id":1}\n`);
    for (const opts of [undefined, { refreeze: null }, { refreeze: 999 }]) {
      const { plan, findings } = checkArchives(dir, differing(202, `{"id":1}\n{"id":2}\n`), opts);
      assert.equal(findings.length, 1, `refreeze ${JSON.stringify(opts)} must not excuse window 202`);
      assert.match(findings[0], /archives\/acts\/202\.jsonl is an ARCHIVE and already exists/);
      assert.equal(plan.length, 0);
      // and the file is untouched
      assert.equal(readFileSync(join(dir, "archives/acts/202.jsonl"), "utf8"), `{"id":1}\n`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("FALSIFIER (d) — --refreeze N plans a REPLACEMENT, carrying the old sha and the new", () => {
  const dir = repo();
  try {
    mkdirSync(join(dir, "archives", "acts"), { recursive: true });
    writeFileSync(join(dir, "archives/acts/202.jsonl"), `{"id":1}\n`);
    const { plan, findings } = checkArchives(dir, differing(202, `{"id":1}\n{"id":2}\n`), { refreeze: 202 });

    assert.equal(findings.length, 0, "the named window refuses no longer");
    assert.deepEqual(plan.map((p) => p.action), ["refreeze"]);
    assert.equal(plan[0].oldSha, createHash("sha256").update(`{"id":1}\n`).digest("hex"));
    assert.equal(plan[0].newSha, createHash("sha256").update(`{"id":1}\n{"id":2}\n`).digest("hex"));
    assert.notEqual(plan[0].oldSha, plan[0].newSha);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the door is ONE window wide — every other differing archive still refuses", () => {
  const dir = repo();
  try {
    mkdirSync(join(dir, "archives", "acts"), { recursive: true });
    writeFileSync(join(dir, "archives/acts/201.jsonl"), `{"id":0}\n`);
    writeFileSync(join(dir, "archives/acts/202.jsonl"), `{"id":1}\n`);
    const archives = [
      ...differing(201, `{"id":0}\n{"id":9}\n`),
      ...differing(202, `{"id":1}\n{"id":2}\n`),
    ];
    const { plan, findings } = checkArchives(dir, archives, { refreeze: 202 });

    assert.deepEqual(plan.map((p) => p.action), ["refreeze"]);
    assert.equal(plan[0].window, 202);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /archives\/acts\/201\.jsonl is an ARCHIVE and already exists/);
    // 201 is untouched on disk, and the run that produced this will throw Red
    assert.equal(readFileSync(join(dir, "archives/acts/201.jsonl"), "utf8"), `{"id":0}\n`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("--refreeze N WITHOUT --reason is exit 2, and says why a reason is the point", () => {
  assert.throws(
    () => parseRefreeze(["node", "snapshot-export.mjs", "--target", "/t", "--refreeze", "202"]),
    (e) => e instanceof Cannot && /needs --reason/.test(e.message)
      && /a human must own/.test(e.message));
  // an empty or flag-shaped reason is no reason
  assert.throws(() => parseRefreeze(["--refreeze", "202", "--reason", "   "]), Cannot);
  assert.throws(() => parseRefreeze(["--refreeze", "202", "--reason", "--json"]), Cannot);
  // and a window that is not a number is refused before anything else happens
  assert.throws(() => parseRefreeze(["--refreeze", "--reason", "x"]), Cannot);
  assert.throws(() => parseRefreeze(["--refreeze", "202.5", "--reason", "x"]), Cannot);
});

test("no --refreeze at all is the ordinary run — the door is shut unless it is opened", () => {
  assert.deepEqual(parseRefreeze(["node", "snapshot-export.mjs", "--target", "/t"]),
    { refreeze: null, reason: null });
  assert.deepEqual(parseRefreeze(["--refreeze", "202", "--reason", "POS-189: frozen before ferry 203 sailed"]),
    { refreeze: 202, reason: "POS-189: frozen before ferry 203 sailed" });
});

test("the RECEIPT: both sha256s and the reason ride the commit's FIRST line", () => {
  // `git log --oneline` is what a reader scanning the notary repo sees, so a
  // replacement of a frozen archive must not be able to look ordinary there.
  const a = { window: 202, lines: 94, was: `{"id":1}\n`, oldSha: "a".repeat(64), newSha: "b".repeat(64) };
  const msg = refreezeCommitMessage(a, "POS-189: frozen before ferry 203 sailed",
    { windowCursor: 204, cursors: { acts_cursor: 7260 } });
  const first = msg.split("\n")[0];

  assert.match(first, /^notary: refreeze archives\/acts\/202\.jsonl/);
  assert.ok(first.includes("a".repeat(64)), "the old sha256 is on the first line");
  assert.ok(first.includes("b".repeat(64)), "the new sha256 is on the first line");
  assert.ok(first.includes("POS-189: frozen before ferry 203 sailed"), "so is the reason");
  assert.match(msg, /No other window was touched/);
  assert.match(msg, /1 line\(s\)/);
  assert.match(msg, /94 line\(s\)/);
});

test("the door's refusal is reached BEFORE the database is — exit 2, naming --reason", () => {
  // An exit code that depended on which error the program happened to reach
  // first would not be a rule. WORLD2_PG_URL is deliberately absent here: if the
  // argument check ran after `connect()`, this would fail on the connection
  // string instead, and the falsifier would be measuring the wrong refusal.
  const dir = repo();
  const env = { ...process.env };
  delete env.WORLD2_PG_URL;
  try {
    let code = 0, err = "";
    try {
      execFileSync(process.execPath, ["world2/tools/snapshot-export.mjs", "--target", dir, "--refreeze", "202"],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) { code = e.status; err = String(e.stderr ?? ""); }

    assert.equal(code, 2);
    assert.match(err, /needs --reason/);
    assert.ok(!/WORLD2_PG_URL/.test(err),
      "the argument check runs first — this refusal is about the door, not the environment");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── THE DOOR TAKES A LIST (2026-09-28, the w40 ship: 26 archives differed at once) ──
test("--refreeze takes a list or a range, and still needs a reason", () => {
  assert.deepEqual(parseRefreeze(["--refreeze", "154-156,201", "--reason", "w40"]), { refreeze: [154, 155, 156, 201], reason: "w40" });
  assert.deepEqual(parseRefreeze(["--refreeze", "202", "--reason", "x"]), { refreeze: 202, reason: "x" }, "a single window is unchanged");
  assert.throws(() => parseRefreeze(["--refreeze", "156-154", "--reason", "x"]), Cannot);
  assert.throws(() => parseRefreeze(["--refreeze", "154,abc", "--reason", "x"]), Cannot);
  assert.throws(() => parseRefreeze(["--refreeze", "154,155"]), Cannot);
});

test("a LIST refreezes exactly the named windows; a differing archive it does not name still refuses", () => {
  const dir = repo();
  try {
    mkdirSync(join(dir, "archives", "acts"), { recursive: true });
    writeFileSync(join(dir, "archives/acts/154.jsonl"), `{"id":0}
`);
    writeFileSync(join(dir, "archives/acts/155.jsonl"), `{"id":0}
`);
    const archives = [...differing(154, `{"id":1}
`), ...differing(155, `{"id":2}
`)];
    const named = checkArchives(dir, archives, { refreeze: [154, 155] });
    assert.equal(named.findings.length, 0);
    assert.deepEqual(named.plan.map((p) => p.action), ["refreeze", "refreeze"]);
    const partial = checkArchives(dir, archives, { refreeze: [154] });
    assert.equal(partial.findings.length, 1, "155 is not named, so it refuses exactly as before");
    assert.equal(readFileSync(join(dir, "archives/acts/155.jsonl"), "utf8"), `{"id":0}
`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the many-window receipt carries every window's two sha256s and the reason", () => {
  const a = (w) => ({ window: w, oldSha: `old${w}`, newSha: `new${w}`, was: "x\n", lines: 2 });
  const msg = refreezeManyCommitMessage([a(154), a(155)], "the w40 ship", { windowCursor: 216, cursors: { acts_cursor: 1 } });
  assert.match(msg.split("\n")[0], /refreeze 2 archives \(154, 155\) — the w40 ship/);
  for (const w of [154, 155]) assert.match(msg, new RegExp(`${w}\\.jsonl · old sha256 old${w} .* new sha256 new${w}`));
});
