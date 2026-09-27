// doorstep-stances.test.mjs — THE SEVENTH SEGMENT (the founder's .1 ruling).
//
// The ruling and the reason, 2026-08-25: the consent inbox is served today by
// `world { read: "declare-stance-on" }`, which is STANDPOINT-DISCOVERED — the
// grant comes from the household class node, so the apex answers only where
// that grant is in your spine or reach. Measured against the live world store
// before any of this was written:
//
//   world { read: "declare-stance-on", handle: "wright" }
//     -> 422 "declare-stance-on is not an action anywhere in your view —
//             nothing to read"
//   stanceInbox for that same resident -> 19 candidates awaiting their word
//
// Nineteen decisions waiting, and the door that serves them refuses to open
// unless you happen to be standing in the right place. So the inbox gets a
// STANDING-scoped door — `household read: "stances"` — and the doorstep carries
// it as a segment, which is what tells a resident at all.
//
// This file proves the segment is real against a world with real geometry: the
// same world-in-a-bottle the consent door's own falsifiers use, with the REAL
// overlap arithmetic transcribed rather than a second implementation of it.
//
// Every test was can-fail flipped; the flips are in the handback.
//
//   node --test test/doorstep-stances.test.mjs

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-doorstep-stances-"));
after(() => sweep(scratch));

// ── the world in a bottle ────────────────────────────────────────────────────
//
// alpha holds a parcel that stood on 08-01. beta and gamma each drop a mark
// overlapping it later — those are alpha's candidates, the marks awaiting
// alpha's word. delta's is far away and is nobody's business.
const repo = join(scratch, "world");
mkdirSync(repo, { recursive: true });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const MARKS = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 }, date: "2026-07-01", body: "the world frame" },
  { id: "alpha/alphas-parcel", by: "alpha", kind: "parcel", at: { x: 100, y: 100 }, extent: { w: 25, h: 25 }, date: "2026-08-01", body: "alpha's ground" },
  { id: "beta/on-alphas-edge", by: "beta", kind: "sited", at: { x: 112, y: 100 }, extent: { w: 4, h: 4 }, date: "2026-08-10", body: "beta's cairn, half over the line" },
  { id: "gamma/well-inside", by: "gamma", kind: "sited", at: { x: 100, y: 100 }, extent: { w: 2, h: 2 }, date: "2026-08-12", body: "gamma left this in the middle of alpha's parcel" },
  { id: "delta/far-away", by: "delta", kind: "sited", at: { x: 9000, y: 9000 }, extent: { w: 4, h: 4 }, date: "2026-08-15", body: "nowhere near anybody" },
];

// `geometry.mjs` is the REAL arithmetic, transcribed, because overlap is the
// one thing this lane must never answer with a second implementation.
put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
`);
put("WORLD/world-state.json", JSON.stringify({ tick: 0, marks: MARKS, parcels: [] }));
put("WORLD/skeleton.json", JSON.stringify({ features: [] }));
for (const m of MARKS) put(`WORLD/marks/let-there-be-light/${m.id.split("/")[1]}/mark.md`,
  `---\nkind: ${m.kind}\nby: ${m.by}\ndate: ${m.date}\n---\n\n${m.body}\n`);
git("init", "-q", "-b", "main");
git("config", "user.email", "t@postmark.invalid");
git("config", "user.name", "doorstep stance falsifier");
git("add", "-A");
git("commit", "-qm", "canon");

// THE ENVIRONMENT IS SET BEFORE THE OFFICE IS IMPORTED, and that is why every
// import below is dynamic. `WORLD_CLONE` is resolved once, as a module
// constant, when world-store.mjs is first evaluated — and ESM hoists static
// imports above the module body, so a plain `process.env.X = …` at the top of
// this file would run AFTER the constant had already been fixed. The office is
// not bent to suit the test; the test is loaded in the right order.
// A FRESH JOURNAL PER TEST. The stance write below is durable by design, so a
// shared store would let one test's spoken word set the next test's starting
// count — and the two tests that caught it were asserting numbers, which is
// exactly where cross-test leakage hides. (The consent door's own falsifiers
// rotate the same way; this is their idiom, not a new one.)
let dbPath = join(scratch, "dynamic-0.db");
let runs = 0;
process.env.WORLD_CLONE = repo;
process.env.WORLD_DYNAMIC_DB = dbPath;
process.env.WORLD_SINGLE_LOG = "1";
process.env.WORLD_APEX = "1";
after(() => { delete process.env.WORLD_DYNAMIC_DB; delete process.env.WORLD_SINGLE_LOG; });

beforeEach(() => {
  dbPath = join(scratch, `dynamic-${++runs}.db`);
  process.env.WORLD_DYNAMIC_DB = dbPath;
  process.env.WORLD_SINGLE_LOG = "1";
  // THE CANDIDATE LIST READS THE STORE (POS-195, 2026-09-22). These fixtures
  // still plant their sketches in the journal and mean the same thing by it; the
  // stub answers the store's query from that journal, shaped as `claims` rows.
  Object.assign(process.env, STANCE_ON);
  stancePoolFromJournal(dbPath);
  // ── AND THE DOOR WRITES THE RECORD (G1 / POS-156, RULING 3) ─────────
  //
  // `declareStanceViaOffice` wrote a sqlite journal row and queued a Postgres
  // copy behind it; G1 deleted that INSERT and made the write awaited and
  // refusable, so a stance door with no record gives the ruled 503. The pen is
  // separate from the stance READ above — two pools, two credentials, by
  // RULING 2's own design — so this leaves `stance_reader`'s stub where it is.
  //
  // The late-arrival reason is the guard's own remedy: these fixtures declare
  // at a historical crossing, and the pen refuses a row into certified history
  // by name unless the caller says why.
  process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
  process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
  process.env.W2_LATE_ARRIVAL = "doorstep-stances.test.mjs fixtures declare at a historical crossing on purpose";
  pen = installActsPen();
  resetStanceGeometry?.();
});

// ── the office side: one resident, alpha ────────────────────────────────────

const AS_OF = "stancefixture0000000000000000000000000";
const HANDLE = "alpha";
const key = { household: "alpha", handles: new Set([HANDLE]) };

let doorstepBundle, callTool, declareStanceViaOffice, resetStanceGeometry, stancesForHandles, SEGMENT_META;
let STANCE_ON, clearStancePool, stancePoolFromJournal;
let db, ctx, pen;
const { installActsPen, uninstallActsPen, RECORD_ON } = await import("./acts-pen-stub.mjs");
after(() => {
  uninstallActsPen();
  delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; delete process.env.W2_LATE_ARRIVAL;
});
// ONE hook, because the second half depends on the first: the office fixture is
// built from a SCHEMA that only exists once the dynamic imports have run.
before(async () => {
  ({ doorstepBundle } = await import("../src/doorstep-bundle.mjs"));
  ({ callTool } = await import("../src/mcp.mjs"));
  ({ declareStanceViaOffice, resetStanceGeometry, stancesForHandles } = await import("../src/world-stance.mjs"));
  // THE CANDIDATE LIST READS THE STORE (POS-195, 2026-09-22). This file plants
  // its sketches in the journal and still means the same thing by them; the stub
  // answers the store's query from that same journal, shaped as `claims` rows.
  // Imported HERE rather than at the top, for this file's own stated reason: a
  // static import is hoisted above the env this fixture sets.
  ({ STANCE_ON, clearStancePool, stancePoolFromJournal } = await import("./stance-pool-stub.mjs"));
  Object.assign(process.env, STANCE_ON);
  stancePoolFromJournal(dbPath);
  ({ SEGMENT_META } = await import("../src/queries.mjs"));
  const { SCHEMA } = await import("../src/schema.mjs");

  db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const put2 = db.prepare("INSERT INTO meta VALUES (?, ?)");
  put2.run("as_of", AS_OF);
  put2.run("town_path", "fixture");
  put2.run("hydrated_counts", JSON.stringify({}));
  db.prepare("INSERT INTO residents VALUES (?, ?)").run(HANDLE, JSON.stringify({
    handle: HANDLE, is_office: false, last_active: null,
    address: { data: { since: "2026-01-01", joined: "2026-06-10" } },
  }));
  ctx = { db, key, meta: { as_of: AS_OF, quest_registry: '{"quests":[]}' }, asOf: AS_OF,
    canWrite: false, clone: null, pen: null, odb: null, dbPath: null };
});
after(() => { try { db?.close(); } catch { /* already gone */ } });
const stamp = async () => ({ at: { anchor: "alpha/alphas-parcel", dx: 1, dy: 2 },
  witnesses: { source: "presence", list: [{ handle: "gamma", anchor: "alpha/alphas-parcel", dx: 0, dy: 0 }] } });
const speak = (args) => declareStanceViaOffice(repo, args, key, { dbPath, witnessStamp: stamp, crossing: 145 });
// (dbPath is read at call time — beforeEach rotates it.)
const answerOf = (seg) => Object.fromEntries(Object.entries(seg).filter(([k]) => !SEGMENT_META.includes(k)));
const segmentFor = async (h = HANDLE) => (await doorstepBundle(h, ctx)).stances;

// ── the segment is real ─────────────────────────────────────────────────────

test("PRE-WORD: the doorstep carries the marks standing on your ground, unasked", async () => {
  const seg = await segmentFor();
  assert.equal(seg.unavailable, undefined, "the world in a bottle is readable — if this fires, the fixture broke, not the door");
  assert.equal(seg.stances_awaiting, 2, "beta's cairn and gamma's stone both overlap alpha's parcel");
  const waiting = seg.awaiting.map((c) => c.mark).sort();
  assert.deepEqual(waiting, ["beta/on-alphas-edge", "gamma/well-inside"]);
  assert.ok(!waiting.includes("delta/far-away"), "delta is nowhere near alpha — a segment that swept it in would be inventing decisions");
  // THE WHOLE POINT OF THE RULING: alpha was told without going to look, and
  // without standing anywhere in particular.
  assert.equal(seg.serves, "household.stances");
  assert.deepEqual(seg.args, { handle: HANDLE, limit: 5 });
});

test("AFTER THE WORD: the mark leaves `awaiting` and appears in `standing`", async () => {
  const before2 = await segmentFor();
  assert.ok(before2.awaiting.some((c) => c.mark === "gamma/well-inside"), "it is waiting first");
  assert.deepEqual(before2.standing, [], "and nothing is spoken yet");

  await speak({ on: "gamma/well-inside", stance: "welcomed" });
  resetStanceGeometry();

  const after2 = await segmentFor();
  assert.equal(after2.stances_awaiting, 1, "one decision left, not two");
  assert.ok(!after2.awaiting.some((c) => c.mark === "gamma/well-inside"),
    "a mark you have spoken about leaves your inbox — recorded, not enforced");
  assert.ok(after2.awaiting.some((c) => c.mark === "beta/on-alphas-edge"), "the one you have not answered is still there");
  assert.deepEqual(after2.standing.map((s) => [s.on, s.stance]), [["gamma/well-inside", "welcomed"]],
    "and exactly one word stands");
});

// ── the bundle's own law, on this segment ───────────────────────────────────

test("THE BUNDLE LAW HOLDS HERE TOO: the segment IS `household read: \"stances\"`", async () => {
  const d = await doorstepBundle(HANDLE, ctx);
  const seg = d.stances;
  const asked = await callTool("household", { read: "stances", ...seg.args }, ctx);
  assert.deepEqual(answerOf(seg), asked,
    "ask the named read yourself and you get the same object back — or this is a restatement, not a segment");
  assert.ok(d.segments.includes("stances"), "and the manifest names it");
});

test("THE FLIP: that comparison can fail — a tampered segment is caught", async () => {
  const d = await doorstepBundle(HANDLE, ctx);
  d.stances.stances_awaiting = 999;
  const asked = await callTool("household", { read: "stances", ...d.stances.args }, ctx);
  assert.throws(() => assert.deepEqual(answerOf(d.stances), asked),
    "the bundle comparison must be able to reject a segment that stopped being its read");
});

// ── scope, and the thing it must never do ───────────────────────────────────

test("bare, the read is your WHOLE HOUSE; the doorstep narrows to one resident by naming them", async () => {
  // I WROTE THIS TEST ASSERTING `whole >= narrowed` AND THE FIXTURE REFUSED IT,
  // correctly. Widening to the house does not simply add: a mark BY a housemate
  // stops being a candidate, because `stanceInbox` excludes your own house's
  // marks — a house does not consent to itself. So alpha alone must answer
  // beta's cairn AND gamma's stone, while the house of alpha+beta answers only
  // gamma's, beta's cairn now being the house's own. Both numbers are correct
  // and neither is a bound; the monotonic law I assumed does not exist.
  const house = { household: "alpha", handles: new Set([HANDLE, "beta"]) };
  const whole = await callTool("household", { read: "stances" }, { ...ctx, key: house });
  const narrowed = await callTool("household", { read: "stances", handle: HANDLE }, { ...ctx, key: house });

  assert.equal(narrowed.stances_awaiting, 2, "alpha alone: beta's cairn and gamma's stone both lie over alpha's parcel");
  assert.deepEqual(whole.awaiting.map((c) => c.mark), ["gamma/well-inside"],
    "the house: gamma's stone only — a housemate's own mark is not a decision the house owes itself");
  // The thing a default MUST NOT do is hide an outsider's mark. That is the
  // property worth pinning, and it is not the same as being monotonic.
  assert.ok(whole.awaiting.some((c) => c.mark === "gamma/well-inside"),
    "the outsider's mark survives every widening — hiding one is the failure this scope choice exists to avoid");
});

test("a resident with nothing awaiting gets an HONEST EMPTY, never an absent segment", async () => {
  const r = await stancesForHandles(["nobody-holds-ground"], { limit: 5 });
  assert.equal(r.stances_awaiting, 0);
  assert.match(r.note, /nothing awaits your word/);
  assert.match(r.note, /ordinary state, not a quiet failure/,
    "zero-awaiting and the-world-could-not-be-read must not look alike");
});

test("THE SEGMENT IS ALWAYS PRESENT — a world that cannot be read says so, and does not vanish", async () => {
  // The silence this segment exists to end must not come back as a missing key
  // the first time the engine is mid-write. Point the door at a directory with
  // no world in it and the segment still stands, carrying `unavailable`.
  const saved = process.env.WORLD_CLONE;
  const empty = join(scratch, "no-world");
  mkdirSync(empty, { recursive: true });
  try {
    const r = await stancesForHandles([HANDLE], { limit: 5, repo: empty });
    assert.ok(r.unavailable, "an unreadable world is disclosed");
    assert.deepEqual(r.awaiting, [], "and it answers with an empty page rather than a throw");
    assert.equal(r.note, undefined, "it must NOT claim nothing awaits you — it does not know that");
  } finally { process.env.WORLD_CLONE = saved; }
});

test("the teaser is bounded and says how much it is a cut of", async () => {
  // Two candidates against a limit of 1: the total must be a DIFFERENT number
  // from the page, or it is the counts trap wearing a friendlier costume.
  const r = await stancesForHandles([HANDLE], { limit: 1 });
  assert.equal(r.stances_awaiting, 2);
  assert.equal(r.awaiting.length, 1);
  assert.notEqual(r.stances_awaiting, r.awaiting.length);
  assert.equal(r.complete, false);
  assert.equal(r.cursor, "1", "and the cursor walks to the rest");
  const rest = await stancesForHandles([HANDLE], { limit: 1, cursor: r.cursor });
  assert.equal(rest.complete, true);
  assert.equal(rest.cursor, null, "a cursor is null exactly when there is nothing more");
  assert.equal(rest.stances_awaiting, 2, "the total does not shrink as you walk");
});

// ── THE TEACHING BLOCK IS NOT ON THE MORNING PAGE (conductor, 2026-09-07) ────
//
// It is the largest block this lane added to the doorstep by bytes, it is
// byte-identical for every resident every day, and it teaches rather than
// reports. The doorstep is the surface little-bird abandoned as too heavy, so a
// fix for one resident's confusion that fattens everyone's morning page has
// traded one complaint for another.
//
// THE CUT IS ON THE CONNECTOR SKIN ONLY, and that is the law rather than a
// hedge: the REST bundle's segment must stay deep-equal to the read its
// `serves` names (§ THE BUNDLE LAW HOLDS HERE TOO, above), so trimming it there
// would break a standing law to save bytes on the skin that is not the heavy
// one. slimAwaiting and slimPsa already cut this way, and every cut they make
// is named on the page.

test("slim: the teaching block is DROPPED and the door is named — the key is not retyped", async () => {
  const slim = await doorstepBundle(HANDLE, { ...ctx, slim: true });
  // ⚠ THE FIRST CUT KEPT `teach` AND CHANGED ITS TYPE, object -> string. That
  // is the one place it departed from this skin's idiom (every other slim cut
  // renames or drops; none retypes), and the cost is exact: a consumer reading
  // `stances.teach.after_it_is_published.unruled` gets undefined here with no
  // bounce — a silent wrong answer rather than a refusal.
  assert.equal(slim.stances.teach, undefined, "no `teach` on this skin at all");
  assert.equal(typeof slim.stances.teach_at, "string", "a pointer under its own name");
  assert.match(slim.stances.teach_at, /household \{ read: "stances" \}/, "and it names the door that answers whole");
  assert.doesNotMatch(slim.stances.teach_at, /UNRULED PAIR|neutral-and-revisable/,
    "the pointer is not a summary of the block — a paraphrase here is the copy the block exists to avoid");
  assert.match(slim.stances.abridged, /drops `teach` and names the door instead/,
    "and the cut is NAMED on the page, the way every other slim cut is");
});

test("no key on the slim stances segment holds a DIFFERENT TYPE from the same key on REST", async () => {
  // The general form of the defect above, and the reason it is worth a probe of
  // its own: a renamed key and a dropped key are both legible to a caller — one
  // is absent, one is somewhere else — but a key that survives with a different
  // type reads as present and answers wrong. This walks the whole segment, so
  // the next cut cannot reintroduce the shape under a different key.
  const fat = await doorstepBundle(HANDLE, ctx);
  const slim = await doorstepBundle(HANDLE, { ...ctx, slim: true });
  const wrong = [];
  for (const [k, v] of Object.entries(slim.stances)) {
    if (!(k in fat.stances)) continue;              // renamed or new: legible
    const a = Array.isArray(fat.stances[k]) ? "array" : typeof fat.stances[k];
    const b = Array.isArray(v) ? "array" : typeof v;
    if (a !== b) wrong.push(`stances.${k}: ${a} on REST, ${b} on the connector`);
  }
  assert.deepEqual(wrong, [],
    "a key that survives a cut with a new type answers wrong instead of being absent: " + wrong.join(" · "));
});

test("REST: the segment still carries the block whole — the bundle law is not traded for bytes", async () => {
  const fat = await doorstepBundle(HANDLE, ctx);
  assert.equal(typeof fat.stances.teach, "object", "the whole block, not a pointer");
  assert.ok(fat.stances.teach.after_it_is_published, "including the unruled pair");
  assert.equal(fat.stances.abridged, undefined, "and nothing was cut, so nothing claims to have been");
});
