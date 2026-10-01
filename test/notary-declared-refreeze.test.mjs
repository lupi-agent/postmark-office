// notary-declared-refreeze.test.mjs — HISTORY CHANGES ONLY AS DECLARED (POS-242 item 3).
//
//   node --test test/notary-declared-refreeze.test.mjs
//
// The notary refuses any closed window whose archive re-derives differently,
// and on 2026-09-28 that held the whole notary red: migration 025 dropped
// acts.journal_seq and the w40.3 backfill (office #220) added acts to closed
// windows, so 26 archives differed and a hand re-froze them (notary repo
// 85da0af17). Shape A (Wright, 2026-10-01): the change declares itself in
// world2/schema/REFREEZES.json, and the pen re-freezes only differences that
// VERIFY as a declared class. Held here:
//
//   · the 09-28 case REPLAYED — 025's drop and #220's rows declared → re-frozen;
//   · the same diff undeclared → refused, as it was;
//   · a declared class whose diff does not match → refused (a row's payload
//     moving under a drop-field; journal_seq moving to a NUMBER under drop-field;
//     an act removed under rows-added; rows added under only a drop-field);
//   · a consumed declaration excuses nothing again;
//   · a manifest the pen cannot read in full is Cannot, never a silent excuse;
//   · the receipt names the ids, their reasons, and both sha256s per window.
//
// The lines are the pen's own (archiveLine) over acts shaped like window 201's
// real ones, and the drop-field's NULL is the pen's real rendering of a dropped
// column — measured: ACT_FIELDS is fixed, so a row without journal_seq archives
// as "journal_seq":null, and 85da0af17's window 201 diff is `3720 -> null`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveLine, checkArchives, Cannot,
  loadDeclarations, verifyDeclared, consumeDeclarations, declaredRefreezeSection,
  REFREEZES_MANIFEST,
} from "../world2/tools/snapshot-export.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");

// Window 201's acts, as the frozen archive held them before 025: journal_seq set.
const act = (id, seq, extra = {}) => ({
  id: String(id), at: new Date(`2026-09-20T14:36:${String(id % 60).padStart(2, "0")}Z`), crossing: "201",
  actor: "dom-pidgey", action: "ride", object: "the-town/the-post-office",
  at_anchor: null, at_dx: null, at_dy: null, witnesses: null, class: "frame",
  payload: { via: "ferry" }, effect: null, household: "gh:1", journal_seq: seq === null ? null : String(seq),
  inserted_at: new Date("2026-09-20T14:37:00Z"), ...extra,
});
const file = (rows) => rows.map(archiveLine).join("\n") + "\n";

const FROZEN = [act(7049, 3720), act(7050, 3721), act(7052, 3723)];
// After 025 the column is gone (archiveLine renders null); after #220 two acts appear.
const AFTER_025 = FROZEN.map(({ journal_seq, ...r }) => r);
const BACKFILLED = [act(7051, null), act(7053, null)].map(({ journal_seq, ...r }) => r);
const DERIVED_0928 = file([...AFTER_025, ...BACKFILLED].sort((a, b) => Number(a.id) - Number(b.id)));

const D025 = { id: "025-drop-journal-seq", class: "drop-field", field: "journal_seq",
  reason: "migration 025 dropped acts.journal_seq", go: "Keemin, 2026-09-28" };
const D220 = { id: "w40.3-backfill-220", class: "rows-added",
  reason: "the w40.3 backfill (office #220) added acts to closed windows", go: "Keemin, 2026-09-28" };

function notary(bytes = file(FROZEN)) {
  const dir = mkdtempSync(join(tmpdir(), "w2notary-declared-"));
  execFileSync("git", ["-C", dir, "init", "-q", "-b", "main"]);
  mkdirSync(join(dir, "archives", "acts"), { recursive: true });
  writeFileSync(join(dir, "archives/acts/201.jsonl"), bytes);
  return dir;
}
const derived = (bytes) => [{ window: 201, lines: bytes.replace(/\n$/, "").split("\n").length, bytes, path: "archives/acts/201.jsonl" }];

test("the measured premise: a row without journal_seq archives as journal_seq:null — 025's diff is a value going to null", () => {
  const before = archiveLine(act(7049, 3720));
  const { journal_seq, ...gone } = act(7049, 3720);
  const after = archiveLine(gone);
  assert.match(before, /"journal_seq":3720/);
  assert.match(after, /"journal_seq":null/);
  assert.equal(after, before.replace('"journal_seq":3720', '"journal_seq":null'));
});

test("REPLAY 09-28 · 025's drop-field and #220's rows-added, declared → window 201 is re-frozen, both ids named", () => {
  const dir = notary();
  try {
    const { plan, findings } = checkArchives(dir, derived(DERIVED_0928), { declared: [D025, D220] });
    assert.deepEqual(findings, []);
    assert.deepEqual(plan.map((a) => a.action), ["refreeze-declared"]);
    assert.deepEqual([...plan[0].declarations].sort(), [D025.id, D220.id].sort());
    assert.equal(plan[0].oldSha, sha(file(FROZEN)));
    assert.equal(plan[0].newSha, sha(DERIVED_0928));
    assert.equal(readFileSync(join(dir, "archives/acts/201.jsonl"), "utf8"), file(FROZEN), "checkArchives plans; it never writes");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("REPLAY 09-28 · the same diff UNDECLARED still refuses, exactly as it did that morning", () => {
  const dir = notary();
  try {
    for (const opts of [undefined, { declared: [] }]) {
      const { plan, findings } = checkArchives(dir, derived(DERIVED_0928), opts);
      assert.equal(plan.length, 0);
      assert.equal(findings.length, 1);
      assert.match(findings[0], /archives\/acts\/201\.jsonl is an ARCHIVE and already exists/);
      assert.doesNotMatch(findings[0], /declared re-freeze/, "with nothing declared there is nothing to have failed to verify");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("half the declaration is no declaration: the drop alone does not excuse the added rows", () => {
  const dir = notary();
  try {
    const { plan, findings } = checkArchives(dir, derived(DERIVED_0928), { declared: [D025] });
    assert.equal(plan.length, 0);
    assert.match(findings[0], /does not verify as a declared re-freeze \(025-drop-journal-seq\): 2 act\(s\) appear \(ids 7051, 7053\) and no rows-added is declared/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("MISMATCH · a row's payload moving under a drop-field declaration refuses, naming the act and the field", () => {
  const dir = notary();
  try {
    const moved = AFTER_025.map((r) => (r.id === "7050" ? { ...r, payload: { via: "on foot" } } : r));
    const { plan, findings } = checkArchives(dir, derived(file(moved)), { declared: [D025, D220] });
    assert.equal(plan.length, 0);
    assert.match(findings[0], /act 7050: payload \{"via":"ferry"\} -> \{"via":"on foot"\}, which no declared class excuses/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("MISMATCH · drop-field covers a value becoming null, never one becoming another number", () => {
  const renumbered = FROZEN.map((r) => ({ ...r, journal_seq: String(Number(r.journal_seq) + 1) }));
  const v = verifyDeclared(file(FROZEN), file(renumbered), [D025]);
  assert.equal(v.ok, false);
  assert.match(v.why, /act 7049: journal_seq 3720 -> 3721, which no declared class excuses \(drop-field journal_seq covers only a value that becomes null or absent\)/);
  // and field-change is the class that does excuse it
  const fc = { ...D025, id: "renumber", class: "field-change" };
  assert.deepEqual(verifyDeclared(file(FROZEN), file(renumbered), [fc]), { ok: true, used: ["renumber"] });
});

test("MISMATCH · no class removes an act, rows-added included", () => {
  const v = verifyDeclared(file(FROZEN), file(AFTER_025.filter((r) => r.id !== "7050")), [D025, D220]);
  assert.equal(v.ok, false);
  assert.match(v.why, /act 7050 is frozen but no longer derived — no class removes an act/);
});

test("a consumed declaration excuses nothing again — the ledger is the notary repo's own", () => {
  const ledger = consumeDeclarations([], [{ action: "refreeze-declared", window: 201, declarations: [D025.id, D220.id] }], "2026-10-01T07:20:00Z");
  assert.deepEqual(JSON.parse(ledger), { consumed: [
    { id: D025.id, windows: [201], at: "2026-10-01T07:20:00Z" },
    { id: D220.id, windows: [201], at: "2026-10-01T07:20:00Z" },
  ] });
  const manifest = JSON.stringify({ declarations: [D025, D220] });
  assert.equal(loadDeclarations(manifest, null).declarations.length, 2);
  const { declarations } = loadDeclarations(manifest, ledger);
  assert.deepEqual(declarations, [], "both ids are spent");
  const dir = notary();
  try {
    const { plan, findings } = checkArchives(dir, derived(DERIVED_0928), { declared: declarations });
    assert.equal(plan.length, 0);
    assert.equal(findings.length, 1, "spent declarations leave the diff refused");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a manifest the pen cannot read in full is Cannot — a half-understood declaration excuses nothing", () => {
  const bad = (d, re) => assert.throws(() => loadDeclarations(JSON.stringify({ declarations: [d] })), (e) => e instanceof Cannot && re.test(e.message), JSON.stringify(d));
  bad({ ...D025, class: "rewrite" }, /class must be one of/);
  bad({ ...D025, field: undefined }, /drop-field must name its field/);
  bad({ ...D220, field: "x" }, /rows-added names no field/);
  bad({ ...D025, go: " " }, /go is required/);
  bad({ ...D025, reason: undefined }, /reason is required/);
  bad({ ...D025, id: "Has Spaces" }, /id must be a lowercase slug/);
  assert.throws(() => loadDeclarations(JSON.stringify({ declarations: [D025, D025] })), /declared twice/);
  assert.throws(() => loadDeclarations("{not json"), Cannot);
  assert.throws(() => loadDeclarations("{}"), /no `declarations` list/);
  assert.throws(() => loadDeclarations(JSON.stringify({ declarations: [] }), "{oops"), Cannot);
});

test("the receipt: ids and reasons on the first line; each window's two sha256s and its classes in the body", () => {
  const plan = [{ action: "refreeze-declared", window: 201, lines: 5, was: file(FROZEN), oldSha: sha(file(FROZEN)), newSha: sha(DERIVED_0928), declarations: [D025.id, D220.id] }];
  const { head, body } = declaredRefreezeSection(plan, [D025, D220]);
  assert.equal(head, "notary: refreeze 1 archive(s) (201) as declared — 025-drop-journal-seq: migration 025 dropped acts.journal_seq; w40.3-backfill-220: the w40.3 backfill (office #220) added acts to closed windows");
  assert.match(body, new RegExp(`archives/acts/201\\.jsonl · 025-drop-journal-seq \\+ w40\\.3-backfill-220 · old sha256 ${sha(file(FROZEN))} · 3 line\\(s\\) → new sha256 ${sha(DERIVED_0928)} · 5 line\\(s\\)`));
  assert.match(body, /025-drop-journal-seq \(drop-field journal_seq\) — go: Keemin, 2026-09-28/);
  assert.match(body, /Consumed once: recorded in REFREEZES-CONSUMED\.json/);
});

test("the door and the declarations are separate: a named window re-freezes by the door, a declared one by its class, any other still refuses", () => {
  const dir = notary();
  try {
    writeFileSync(join(dir, "archives/acts/202.jsonl"), `{"id":1}\n`);
    writeFileSync(join(dir, "archives/acts/203.jsonl"), `{"id":2}\n`);
    const archives = [
      ...derived(DERIVED_0928),
      { window: 202, lines: 2, bytes: `{"id":1}\n{"id":9}\n`, path: "archives/acts/202.jsonl" },
      { window: 203, lines: 1, bytes: `{"id":3}\n`, path: "archives/acts/203.jsonl" },
    ];
    const { plan, findings } = checkArchives(dir, archives, { refreeze: 202, declared: [D025, D220] });
    assert.deepEqual(plan.map((a) => [a.window, a.action]), [[201, "refreeze-declared"], [202, "refreeze"]]);
    assert.equal(findings.length, 1);
    assert.match(findings[0], /archives\/acts\/203\.jsonl is an ARCHIVE[\s\S]*act 2 is frozen but no longer derived/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the shipped manifest is readable whole, and declares nothing until a migration's PR does", () => {
  const { declarations } = loadDeclarations(readFileSync(REFREEZES_MANIFEST, "utf8"));
  assert.deepEqual(declarations, []);
});

// ── END TO END: the pen itself, over a fake store and a real git target ──────
// derive's four SELECTs answered in pg's shapes (the stub in
// world2-snapshot-export.test.mjs, narrowed); an unexpected statement throws.
function store({ acts }) {
  const windows = [{ id: "201", opens_at: new Date("2026-09-20T12:00:00Z"), closes_at: new Date("2026-09-21T00:00:00Z"),
    status: "closed", law_sha: "law201", town_sha: "town201", cleared_at: new Date("2026-09-20T18:00:00Z") }];
  return { async query(sql, params = []) {
    if (sql.includes("acts_cursor")) return { rows: [{ acts_cursor: String(Math.max(...acts.map((a) => Number(a.id)))), acts_total: String(acts.length), marks_count: "0" }] };
    if (sql.includes("FROM windows")) return { rows: windows };
    if (sql.includes("FROM acts")) return { rows: acts.filter((a) => Number(a.crossing) <= Number(params[0])) };
    if (sql.includes("FROM marks")) return { rows: [] };
    throw new Error(`unexpected: ${sql}`);
  } };
}
const NOW = Date.parse("2026-10-01T07:20:00Z");
const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();

test("END TO END · the 09-28 night replayed through runExport: certified, then re-frozen AS DECLARED, the ledger committed, and spent", async () => {
  const { runExport, Red } = await import("../world2/tools/snapshot-export.mjs");
  const dir = mkdtempSync(join(tmpdir(), "w2notary-e2e-"));
  try {
    git(dir, "init", "-q", "-b", "main");
    // A notary checkout always holds mark renders; this store has none, so the
    // directory the pen stages is seeded rather than left for git add to miss.
    mkdirSync(join(dir, "WORLD2", "marks"), { recursive: true });
    writeFileSync(join(dir, "WORLD2", "marks", "README"), "renders\n");
    git(dir, "add", "-A");
    git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "root");
    const manifest = JSON.stringify({ declarations: [D025, D220] });

    // the archive as frozen before the w40 ship
    const first = await runExport(store({ acts: FROZEN }), { target: dir, now: NOW, manifestText: manifest });
    assert.equal(first.status, "certified");
    assert.equal(readFileSync(join(dir, "archives/acts/201.jsonl"), "utf8"), file(FROZEN));

    // 025 and #220 land; the same window now re-derives differently
    const after = [...AFTER_025, ...BACKFILLED].sort((a, b) => Number(a.id) - Number(b.id));
    await assert.rejects(runExport(store({ acts: after }), { target: dir, now: NOW, manifestText: JSON.stringify({ declarations: [] }) }),
      (e) => e instanceof Red, "undeclared, the pen refuses as it did on 09-28");
    const second = await runExport(store({ acts: after }), { target: dir, now: NOW, manifestText: manifest });
    assert.equal(second.status, "certified");
    assert.equal(readFileSync(join(dir, "archives/acts/201.jsonl"), "utf8"), DERIVED_0928, "the archive now holds the re-derivation");
    const subject = git(dir, "log", "-1", "--format=%s");
    assert.match(subject, /^notary: refreeze 1 archive\(s\) \(201\) as declared — 025-drop-journal-seq: .*; w40\.3-backfill-220: /);
    assert.deepEqual(git(dir, "show", "--name-only", "--format=", "HEAD").split("\n").sort(),
      ["CERTIFICATION.json", "REFREEZES-CONSUMED.json", "archives/acts/201.jsonl"], "one commit carries the archive, the certification and the ledger");
    const ledger = JSON.parse(readFileSync(join(dir, "REFREEZES-CONSUMED.json"), "utf8"));
    assert.deepEqual(ledger.consumed.map((c) => [c.id, c.windows]).sort(), [[D025.id, [201]], [D220.id, [201]]].sort());

    // spent: the same declarations do not excuse a later change of the same kind
    const again = after.map((r) => (r.id === "7051" ? { ...r, payload: { via: "boat" } } : r)).concat([{ ...act(7054, null) }].map(({ journal_seq, ...r }) => r));
    await assert.rejects(runExport(store({ acts: again }), { target: dir, now: NOW, manifestText: manifest }),
      (e) => e instanceof Red, "consumed ids excuse nothing again");
    assert.equal(readFileSync(join(dir, "archives/acts/201.jsonl"), "utf8"), DERIVED_0928, "and the archive is untouched");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
