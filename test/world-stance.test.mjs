// world-stance.test.mjs — THE CONSENT DOOR's falsifiers (POS-5).
//
// Every test quotes the law it asserts, verbatim:
//
//   the-town/declare-stance-on   the class mark, world record under
//                                postmark-edge (tier constitution, v5)
//   the-deferred-gate            .../the-publish-law/the-deferred-gate
//   the-late-welcome             .../the-publish-law/the-late-welcome
//   the response function        LOGOS/the-response-function.md
//   the exposure model           office dev/door-plan/DESIGN.md
//                                § World: the two additions ruled 08-23
//
// Every one was can-fail flipped; the flips are in the handback.
//
//   node --test test/world-stance.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic } from "../src/dynamic-store.mjs";
import { CLASS_MARK, ACTION_LEAVE, readJournal } from "../src/world-journal.mjs";
// ── THE SKETCHES ARE SEEDED, NOT WRITTEN BY A DOOR (G1 / POS-156) ──────────
//
// G1 deleted the general journal INSERT; the write path writes the RECORD now.
// These fixtures plant sketches in the sqlite journal and the stance pool stub
// (`test/stance-pool-stub.mjs`) shapes them as the `claims` rows the store
// read asks for -- so the rows are PUT THERE by this file, and the path under
// test is still the real one. Nothing here claims a door wrote them.
import { seedJournalRow } from "./journal-seed.mjs";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";
import {
  ACTION_STANCE, AMBIENT_CAP, CLASS_STANCE, PAGE_SIZE, STANCES,
  candidatesFrom, declareStanceViaOffice, groundFor, resetStanceGeometry,
  readNeverPerforms, stanceInbox, stanceShadow, stanceTeach, standingStances, standsBefore, stancesBlock,
} from "../src/world-stance.mjs";
import { STANCE_ON, clearStancePool, stancePoolFromJournal } from "./stance-pool-stub.mjs";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-stance-"));
after(() => sweep(scratch));

// ── the world in a bottle ────────────────────────────────────────────────────
//
// alpha holds a parcel that stood on 08-01. beta and gamma each drop a mark
// overlapping it later — those are alpha's candidates. delta's mark is far away
// and is nobody's business.

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
  // PRECEDENT'S OTHER DIRECTION: this one stood BEFORE alpha's parcel, so alpha
  // is the newcomer and has no word about it.
  { id: "epsilon/was-here-first", by: "epsilon", kind: "sited", at: { x: 90, y: 100 }, extent: { w: 6, h: 6 }, date: "2026-07-15", body: "standing here since before alpha arrived" },
  // THE LAW THE TEACHING BLOCK QUOTES, in the record where the door reads it
  // from. Body VERBATIM from the live world checkout's WORLD/world-state.json
  // (`the-town/the-late-welcome`, kind predicated, tier constitution). Far away
  // and dated before every parcel here, so it is nobody's candidate and changes
  // no count above it.
  { id: "the-town/the-late-welcome", by: "the-town", kind: "predicated", at: { x: 9500, y: 9500 }, extent: { w: 1, h: 1 }, date: "2026-07-01",
    body: "A stance may arrive after the sketch and before the publish; the ledger keeps who was first." },
];

// The engine, in miniature — but `geometry.mjs` is the REAL arithmetic,
// transcribed, because overlap is the one thing this door must not answer with
// a second implementation.
put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
`);
// ── THE RESPONSE FUNCTION, IN THE CHECKOUT ──────────────────────────────────
//
// The two paragraphs the teaching block slices, copied VERBATIM out of the live
// world checkout's LOGOS/the-response-function.md (§ The tri-state and
// § Residents: words, at their own pace) — line breaks and emphasis included,
// because the slicer has to survive the real file's shape and not a tidied one.
// A test that fed the door a hand-smoothed paragraph would be testing the
// smoothing.
const RESPONSE_FUNCTION_MD = `# The response function — the one axis

## The tri-state

Every edge, once formed, stands under exactly one of three responses from
whatever ground it touches: **welcomed · neutral · opposed**.

- **welcomed** — conferral: the child stands as the ground's own
  ([tiers.md](tiers.md));
- **neutral** — the resting state: the child stands, uncoupled;
- **opposed** — the veto: on sovereign ground it is absolute and
  intersection-keyed (a claim cannot dodge the law by being slightly too big
  to be a child); from the constitutional layer it is absolute simply.

## Residents: words, at their own pace

Every sub-constitutional edge into their ground awaits their individual word —
and this is safe at any latency, because the default is
**neutral-and-revisable**: the incoming thing stands uncoupled until the holder
speaks, and the word can always be changed by a newer word. Nothing blocks;
nothing is lost. The resident's loop is:
`;
put("LOGOS/the-response-function.md", RESPONSE_FUNCTION_MD);
put("WORLD/world-state.json", JSON.stringify({ tick: 0, marks: MARKS, parcels: [] }));
put("WORLD/skeleton.json", JSON.stringify({ features: [] }));
for (const m of MARKS) put(`WORLD/marks/let-there-be-light/${m.id.split("/")[1]}/mark.md`,
  `---\nkind: ${m.kind}\nby: ${m.by}\ndate: ${m.date}\n---\n\n${m.body}\n`);
git("init", "-q", "-b", "main");
git("config", "user.email", "t@postmark.invalid");
git("config", "user.name", "stance falsifier");
git("add", "-A");
git("commit", "-qm", "canon");

const houseA = { household: "alpha", handles: new Set(["alpha"]) };
const houseB = { household: "beta", handles: new Set(["beta"]) };
const stranger = { household: "delta", handles: new Set(["delta"]) };

let dbPath, pen, n = 0;
beforeEach(() => {
  dbPath = join(scratch, `dyn-${++n}.db`);
  process.env.WORLD_DYNAMIC_DB = dbPath;
  process.env.WORLD_SINGLE_LOG = "1";
  // THE CANDIDATE LIST READS THE STORE (POS-195, 2026-09-22). These fixtures
  // plant their sketches in the journal and that intent is unchanged — "a
  // sketch exists, unpublished, on this ground". The stub answers the store's
  // query from that same journal, shaped as `claims` rows, so the tests below
  // say what they always said while the path under them is the real one.
  Object.assign(process.env, STANCE_ON);
  stancePoolFromJournal(dbPath);
  // ── AND THE DOOR WRITES TO THE RECORD (G1 / POS-156, RULING 3) ───────────
  //
  // `declareStanceViaOffice` used to write a sqlite journal row and queue a
  // Postgres copy behind it. G1 deleted that INSERT and made the write AWAITED
  // and REFUSABLE, so a stance door with no record gives the ruled 503 instead
  // of declaring anything. The pen is separate from the stance READ above —
  // two pools, two credentials, by RULING 2's own design — so installing it
  // here leaves `stance_reader`'s stub exactly where it was.
  process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
  process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
  // ⚑ AND THE LATE-CROSSING GUARD HAS TO BE ANSWERED. These fixtures declare
  // at crossing 145, which is certified history by now, so the real pen refuses
  // them by name — correctly. The guard's own message says what to do, and this
  // is that: a named reason, so the row files into the window it ARRIVES in and
  // keeps 145 on its payload. It is set here rather than dodged by moving the
  // fixture to `currentCrossing()`, because a fixture pinned to the wall clock
  // is the class of test that starts failing on a date nobody chose.
  process.env.W2_LATE_ARRIVAL = "world-stance.test.mjs fixtures declare at crossing 145 on purpose";
  pen = installActsPen();
  resetStanceGeometry();
});
after(() => {
  delete process.env.WORLD_DYNAMIC_DB; delete process.env.WORLD_SINGLE_LOG;
  delete process.env.WORLD2_STANCE_URL; clearStancePool();
  delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL;
  delete process.env.W2_LATE_ARRIVAL;
  uninstallActsPen();
});

const withDb = (fn) => { const db = openDynamic(dbPath); try { return fn(db); } finally { db.close(); } };
const stamp = async () => ({ at: { anchor: "alpha/alphas-parcel", dx: 1, dy: 2 }, witnesses: { source: "presence", list: [{ handle: "gamma", anchor: "alpha/alphas-parcel", dx: 0, dy: 0 }] } });
const speak = (args, key = houseA) => declareStanceViaOffice(repo, args, key, { dbPath, witnessStamp: stamp, crossing: 145 });

// a plain rect overlap, for the PURE tests that take it as an argument
const overlaps = (a, b) => {
  const r = (m) => ({ x: m.at.x, y: m.at.y, w: m.extent.w, h: m.extent.h });
  const A = r(a), B = r(b);
  return Math.min(A.x + A.w / 2, B.x + B.w / 2) - Math.max(A.x - A.w / 2, B.x - B.w / 2) > 0
      && Math.min(A.y + A.h / 2, B.y + B.h / 2) - Math.max(A.y - A.h / 2, B.y - B.h / 2) > 0;
};
const mark = (id) => MARKS.find((m) => m.id === id);

// ── the ground's holder speaks ───────────────────────────────────────────────

test("the-ground's-holder-speaks — a holder whose ground the mark does not touch is REFUSED, by name", async () => {
  // the-town/declare-stance-on, verbatim:
  //
  //   "A stance is a revisable word on an edge — welcomed or opposed, latest
  //    wins; neutral is never stored, it is absence. The ground's holder speaks."
  //
  // and LOGOS/the-response-function.md on what "the ground" means:
  //
  //   "opposed — the veto: on sovereign ground it is absolute and
  //    INTERSECTION-KEYED (a claim cannot dodge the law by being slightly too
  //    big to be a child)"
  //
  // Intersection, not containment: beta's cairn straddles alpha's boundary and
  // is still alpha's business. That is the clause's whole point.
  const ok = await speak({ on: "beta/on-alphas-edge", stance: "welcomed" });
  assert.equal(ok.stance, "welcomed");
  assert.deepEqual(ok.on_your_ground, ["alpha/alphas-parcel"],
    "and the answer names WHICH of your marks makes you a speaker");

  await assert.rejects(() => speak({ on: "delta/far-away", stance: "opposed" }), (e) => {
    assert.equal(e.code, 403);
    assert.match(e.defect, /does not stand on your ground/);
    assert.match(e.hint, /the ground's holder speaks/);
    return true;
  }, "a mark touching nothing of yours is not yours to answer");

  await assert.rejects(() => speak({ on: "beta/on-alphas-edge", stance: "welcomed" }, stranger), (e) => {
    assert.equal(e.code, 403);
    return true;
  }, "and holding ground somewhere else in town buys no word here");
});

test("precedent weighs in on the NEWCOMER, never the reverse", async () => {
  // epsilon stood before alpha's parcel, so alpha is the newcomer on that edge
  // and has no word about it — while epsilon, whose ground alpha's parcel
  // overlaps, does.
  await assert.rejects(() => speak({ on: "epsilon/was-here-first", stance: "opposed" }), (e) => {
    assert.equal(e.code, 403);
    return true;
  }, "you do not get to veto what was already standing when you arrived");

  const epsilon = { household: "epsilon", handles: new Set(["epsilon"]) };
  const r = await declareStanceViaOffice(repo, { on: "alpha/alphas-parcel", stance: "opposed" }, epsilon,
    { dbPath, witnessStamp: stamp, crossing: 145 });
  assert.equal(r.stance, "opposed");
  assert.deepEqual(r.on_your_ground, ["epsilon/was-here-first"], "the same edge, read from the side that was there first");
});

test("a mark is never its own ground", async () => {
  await assert.rejects(() => speak({ on: "alpha/alphas-parcel", stance: "welcomed" }), (e) => {
    assert.equal(e.code, 422);
    assert.match(e.defect, /never its own ground/);
    return true;
  }, "an author does not consent to their own declaration");
});

test("groundFor is pure, and overlap is INTERSECTION not containment", () => {
  const g = groundFor(mark("beta/on-alphas-edge"), [mark("alpha/alphas-parcel")], overlaps);
  assert.deepEqual(g.map((m) => m.id), ["alpha/alphas-parcel"],
    "beta's cairn is only half inside and is still on alpha's ground — a claim cannot dodge the law by being slightly too big to be a child");
  assert.deepEqual(groundFor(mark("delta/far-away"), [mark("alpha/alphas-parcel")], overlaps), []);
  assert.deepEqual(groundFor(mark("epsilon/was-here-first"), [mark("alpha/alphas-parcel")], overlaps), [],
    "and precedent runs one way: alpha's parcel is not ground for a mark that predates it");
  assert.equal(standsBefore(mark("alpha/alphas-parcel"), mark("beta/on-alphas-edge")), true);
  assert.equal(standsBefore(mark("beta/on-alphas-edge"), mark("alpha/alphas-parcel")), false);
});

// ── latest wins · neutral is absence ─────────────────────────────────────────

test("latest wins — a re-declaration supersedes, and the whole life stays in the log", async () => {
  //   "A stance is a REVISABLE word on an edge — welcomed or opposed, LATEST
  //    WINS; neutral is never stored, it is absence."
  const first = await speak({ on: "gamma/well-inside", stance: "opposed" });
  assert.equal(first.superseded, undefined, "the first word supersedes nothing");
  const second = await speak({ on: "gamma/well-inside", stance: "welcomed" });
  assert.deepEqual(second.superseded, { stance: "opposed", at: second.superseded.at, seq: 1 },
    "and the second names what it replaced");

  // THE LOG IS `acts` SINCE G1 -- read off the record the door wrote to, in the
  // row shape the register's own reader hands back.
  const rows = pen.rows()
    .filter((r) => r.class === CLASS_STANCE)
    .map((r) => ({ ...r, seq: r.id, payload: JSON.parse(r.payload), written_at: r.at }));
  assert.equal(rows.length, 2, "two rows — a revision is a later word, never an edit");
  assert.equal(rows[0].payload.stance, "opposed", "the first line is untouched: its whole life stays in the log");

  const standing = standingStances(rows, { by: "alpha" });
  assert.deepEqual(standing.map((s) => [s.on, s.stance]), [["gamma/well-inside", "welcomed"]],
    "and exactly one word stands");
});

test("NEUTRAL IS NEVER STORED — there is no argument for it, and no zero row exists", async () => {
  // the class mark: "neutral is never stored, it is absence."
  // the response function: "neutral — the resting state … Neutral is the default
  // everywhere, and it is what makes gifts, strangers, and latency survivable."
  assert.deepEqual(STANCES, ["welcomed", "opposed"], "two words, and there is no third");

  await assert.rejects(() => speak({ on: "gamma/well-inside", stance: "neutral" }), (e) => {
    assert.equal(e.code, 422);
    assert.equal(e.defect, "neutral is never stored, it is absence");
    assert.match(e.hint, /nothing to declare/);
    return true;
  }, "the refusal quotes the law rather than saying 'invalid enum'");

  for (const bad of ["", "yes", "welcome", "OPPOSED", null, 1]) {
    await assert.rejects(() => speak({ on: "gamma/well-inside", stance: bad }), (e) => e.code === 422);
  }
  assert.equal(withDb((db) => readJournal(db, { cls: CLASS_STANCE })).length, 0,
    "not one row was written — a refused stance is absence, exactly like an unspoken one");
});

test("a mark with no word from you is simply absent from your standing stances", async () => {
  await speak({ on: "gamma/well-inside", stance: "welcomed" });
  const inbox = await stanceInbox(repo, houseA, { dbPath });
  assert.deepEqual(inbox.standing.map((s) => s.on), ["gamma/well-inside"]);
  assert.equal(inbox.standing.some((s) => s.on === "beta/on-alphas-edge"), false,
    "beta's cairn has no row of any kind — neutral is what it already is");
  assert.ok(inbox.candidates.some((c) => c.mark === "beta/on-alphas-edge"),
    "which is exactly why it is still waiting for a word");
});

// ── the write path is the RECORD (G1 / POS-156) ─────────────────────────────

test("the write path is THE RECORD — one row, its own class, the witnessed line like a mark row", async () => {
  // LOGOS/the-response-function.md: "Residents' words are edges from actions, in
  // the log, like everything they do." Ruled: stance rows are the single log's
  // first new verb.
  //
  // THE LOG IS `acts` NOW. This asserted `log: "journal"` and read the row back
  // out of sqlite; G1 deleted that INSERT and made the door write the record
  // (RULING 3). Every other claim here is the claim it always was -- the class,
  // the verb, the object, the witnessed line, the payload -- read off the row
  // the door actually filed.
  const r = await speak({ on: "gamma/well-inside", stance: "welcomed" });
  assert.equal(r.log, "acts");
  assert.equal(r.seq, 1, "its receipt is the act's own id");

  assert.equal(pen.rows().length, 1, "one row, for one word");
  const [row] = pen.rows();
  assert.equal(row.class, CLASS_STANCE, "its own class, beside mark and frame in the one table");
  assert.equal(row.action, ACTION_STANCE);
  assert.equal(row.object, "gamma/well-inside");
  assert.equal(row.actor, "alpha");
  assert.equal(row.household, "solo:alpha",
    "under the resolved key -- this fixture's registry is empty, so alpha keeps their own house");
  // THE LATE-ARRIVAL GUARD RE-STAMPS THE WINDOW AND KEEPS THE DECLARATION.
  // These fixtures declare at 145, which is certified history, so the pen files
  // the row into the window it ARRIVES in and carries 145 on the payload
  // (`lateCrossingGuard`). Both halves are asserted, because the half that
  // matters to a resident is that their declared crossing is not lost.
  const { currentCrossing } = await import("../src/crossings.mjs");
  assert.equal(Number(row.crossing), Math.floor(currentCrossing()),
    "filed into the open window, not into certified history");
  const payload = JSON.parse(row.payload);
  assert.equal(payload.late_from_crossing, 145, "and the declaration's own crossing rides the payload");
  assert.match(payload.late_arrival, /fixtures declare at crossing 145/, "with the reason that admitted it");

  assert.deepEqual({ anchor: row.at_anchor, dx: row.at_dx, dy: row.at_dy }, { anchor: "alpha/alphas-parcel", dx: 1, dy: 2 },
    "the-witnessed-line, exactly as a mark row carries it: where the actor stood, relative to what");
  assert.deepEqual(JSON.parse(row.witnesses).list, [{ handle: "gamma", anchor: "alpha/alphas-parcel", dx: 0, dy: 0 }]);
  const { late_from_crossing: _lc, late_arrival: _la, ...declared } = payload;
  assert.deepEqual(declared, { on: "gamma/well-inside", stance: "welcomed", by: "alpha", on_your_ground: ["alpha/alphas-parcel"] });
});

test("THE DOOR WRITES; THE CROSSING JUDGES — nothing is enforced, and the answer says so", async () => {
  // the-deferred-gate, verbatim: "The door writes every sketch wherever it
  // points and judges nothing; placement, stance, and refusal are the crossing's
  // work."
  const r = await speak({ on: "gamma/well-inside", stance: "opposed" });
  assert.match(r.note, /the door writes; the crossing judges/);
  assert.match(r.effect, /the crossing reads your veto when it judges/);

  // THE MARK IS STILL THERE, unchanged, for everybody. A veto is one resident's
  // word in a log, not an edit to the world — nothing has been removed, moved,
  // or hidden, and nobody else's read has changed shape.
  const world = await stanceInbox(repo, houseB, { dbPath });
  assert.equal(world.unavailable, undefined);
  assert.deepEqual(world.candidates, [],
    "beta's ground does not touch gamma's mark, and alpha's veto did not make it touch");
  assert.deepEqual(world.standing, [], "and a stance alpha spoke is not beta's word");
  const still = await stanceShadow(repo, houseA, { dbPath });
  assert.equal(still.standing[0].stance, "opposed");
  assert.equal(still.awaiting.some((c) => c.mark === "gamma/well-inside"), false,
    "a mark you have spoken about leaves your inbox — recorded, not enforced");
});

test("the flag gate — with WORLD_SINGLE_LOG off the write bounces by name, because a stance door with no journal has no pen", async () => {
  delete process.env.WORLD_SINGLE_LOG;
  try {
    await assert.rejects(() => speak({ on: "gamma/well-inside", stance: "welcomed" }), (e) => {
      assert.equal(e.code, 501);
      assert.match(e.hint, /WORLD_SINGLE_LOG=1/);
      return true;
    });
  } finally { process.env.WORLD_SINGLE_LOG = "1"; }
});

// ── the exposure model ───────────────────────────────────────────────────────

test("TIER 1 — the bare read carries ONE INTEGER, and a caller holding nothing sees no block at all", async () => {
  // dev/door-plan/DESIGN.md § the two additions, verbatim:
  //
  //   "the bare read carries one integer everywhere: `stances_awaiting: N`"
  //
  // Off your own ground it is the WHOLE block: zero payload, no list, no bodies.
  const away = await stancesBlock(repo, houseA, { spine: [{ id: "the-town/let-there-be-light" }], dbPath });
  assert.deepEqual(Object.keys(away), ["stances_awaiting"], "one key, and it is the integer");
  assert.equal(away.stances_awaiting, 2, "beta's cairn and gamma's mark, both on alpha's ground");

  assert.equal(await stancesBlock(repo, null, { spine: [], dbPath }), null,
    "an anonymous read grows no key at all — it is byte-identical to what it was");
  const nobody = await stancesBlock(repo, stranger, { spine: [{ id: "the-town/let-there-be-light" }], dbPath });
  assert.deepEqual(nobody, { stances_awaiting: 0 },
    "and a resident who holds no ground sees the integer at zero, never a block");
});

test("TIER 2 — your own parcel in your own spine expands the ambient block; a market read never does", async () => {
  //   "on your own parcel, it expands to a compact ambient block (first ~3
  //    candidates, newest first)"
  const home = await stancesBlock(repo, houseA, { spine: [{ id: "the-town/let-there-be-light" }, { id: "alpha/alphas-parcel" }], dbPath });
  assert.equal(home.stances_awaiting, 2);
  assert.ok(Array.isArray(home.awaiting), "standing on your own ground, the detail arrives");
  assert.deepEqual(home.awaiting.map((c) => c.mark), ["gamma/well-inside", "beta/on-alphas-edge"],
    "newest first");
  assert.ok(home.how.includes(ACTION_STANCE), "and it names both doors");

  const market = await stancesBlock(repo, houseA, { spine: [{ id: "the-town/town-square" }], dbPath });
  assert.deepEqual(Object.keys(market), ["stances_awaiting"],
    "somewhere that is not yours, the same two candidates are one number — ambient detail belongs where you live");
});

test("TIER 2 — the ambient block is capped at ~3 and says how many more", async () => {
  // eight newcomers on alpha's ground; the ambient block is a glance, not a list
  withDb((db) => {
    for (let i = 0; i < 8; i++) seedJournalRow(db, {
      crossing: 145, actor: "zeta", household: "zeta", action: ACTION_LEAVE,
      object: `zeta/crowd-${i}`, cls: CLASS_MARK,
      at: { anchor: null, dx: null, dy: null }, witnesses: null,
      payload: { slug: `crowd-${i}`, by: "zeta", kind: "sited", at: { x: 100, y: 100 }, extent: { w: 1, h: 1 }, body: `one of many ${i}`, date: `2026-08-2${i}` },
    });
  });
  const home = await stancesBlock(repo, houseA, { spine: [{ id: "alpha/alphas-parcel" }], dbPath });
  assert.equal(home.stances_awaiting, 10, "two from canon and eight from the live layer");
  assert.equal(home.awaiting.length, AMBIENT_CAP, "a glance, not a list");
  assert.equal(home.more, 10 - AMBIENT_CAP, "and it says how much it is not showing");
});

test("TIER 3 — the shadow is the full inbox, PAGINATED, plus your standing stances", async () => {
  //   "anywhere, `read: declare-stance-on` is the full cursor-paginated inbox —
  //    every candidate overlapping any mark you hold … plus your standing
  //    stances"
  withDb((db) => {
    for (let i = 0; i < 25; i++) seedJournalRow(db, {
      crossing: 145, actor: "zeta", household: "zeta", action: ACTION_LEAVE,
      object: `zeta/many-${String(i).padStart(2, "0")}`, cls: CLASS_MARK,
      at: { anchor: null, dx: null, dy: null }, witnesses: null,
      payload: { slug: `many-${String(i).padStart(2, "0")}`, by: "zeta", kind: "sited", at: { x: 100, y: 100 }, extent: { w: 1, h: 1 }, body: `crowd ${i}`, date: "2026-08-20" },
    });
  });
  await speak({ on: "beta/on-alphas-edge", stance: "welcomed" });

  const p1 = await stanceShadow(repo, houseA, { dbPath });
  assert.equal(p1.stances_awaiting, 26, "25 newcomers plus gamma; beta's is answered and gone");
  assert.equal(p1.awaiting.length, PAGE_SIZE);
  assert.equal(p1.complete, false, "a short page is said out loud, never left to be inferred");
  assert.equal(p1.cursor, "20");

  const p2 = await stanceShadow(repo, houseA, { cursor: p1.cursor, dbPath });
  assert.equal(p2.awaiting.length, 6);
  assert.equal(p2.cursor, null);
  assert.equal(p2.complete, true);

  const seen = new Set([...p1.awaiting, ...p2.awaiting].map((c) => c.mark));
  assert.equal(seen.size, 26, "the two pages are the whole inbox, once each");
  assert.deepEqual(p1.standing.map((s) => [s.on, s.stance]), [["beta/on-alphas-edge", "welcomed"]],
    "and your standing stances ride the same read");
  assert.match(p1.law, /neutral is never stored, it is absence/,
    "the shadow carries the law it is a shadow of");
});

test("TIER 3 — a read never performs: a stance in a read envelope is refused BY NAME, not ignored", () => {
  // "DOING IMPLIES READING, READING NEVER IMPLIES DOING" (the apex's read mode,
  // ruled 2026-08-15). Ignoring the field would be worse than bouncing: a
  // resident who typed a stance into a read and got a cheerful listing back has
  // been told their word was recorded when it was not.
  const refused = readNeverPerforms({ stance: "welcomed", on: "gamma/well-inside" });
  assert.equal(refused.code, 422);
  assert.equal(refused.defect, "a read never performs");
  assert.match(refused.hint, /to speak, use do:/);
  assert.ok(refused.hint.includes(ACTION_STANCE));

  assert.equal(readNeverPerforms({ cursor: "20" }), null, "a cursor is the read's own field and passes");
  assert.equal(readNeverPerforms({}), null);
  assert.equal(readNeverPerforms(null), null);
});

test("the candidate set is DERIVED — no rows are written by looking", async () => {
  const before = withDb((db) => readJournal(db).length);
  await stanceShadow(repo, houseA, { dbPath });
  await stancesBlock(repo, houseA, { spine: [{ id: "alpha/alphas-parcel" }], dbPath });
  await stanceInbox(repo, houseA, { dbPath });
  assert.equal(withDb((db) => readJournal(db).length), before,
    "no subscriptions, no inbox table, no fan-out — a candidate is computed, never stored");
});

test("candidatesFrom is pure, and a mark you already answered leaves the inbox", () => {
  const mine = [mark("alpha/alphas-parcel")];
  const all = MARKS;
  const open = candidatesFrom({ mine, all, spoken: new Set(), overlaps });
  assert.deepEqual(open.map((c) => c.mark), ["gamma/well-inside", "beta/on-alphas-edge"], "newest first");
  assert.deepEqual(open[0].on_your_ground, ["alpha/alphas-parcel"]);

  const answered = candidatesFrom({ mine, all, spoken: new Set(["gamma/well-inside"]), overlaps });
  assert.deepEqual(answered.map((c) => c.mark), ["beta/on-alphas-edge"]);

  assert.deepEqual(candidatesFrom({ mine: [], all, spoken: new Set(), overlaps }), [],
    "hold no ground, have no say");
});

// ── the-late-welcome ─────────────────────────────────────────────────────────

test("the-late-welcome — an UNPUBLISHED sketch on your ground is a candidate, and is marked as one", async () => {
  // the-late-welcome, verbatim: "A stance may arrive after the sketch and before
  // the publish; the ledger keeps who was first."
  //
  // If a stance could only be spoken after canonization there would be nothing
  // for the crossing to read, and the deferred gate would have deferred to
  // nobody. The disclosure is narrow by construction — only a sketch that
  // overlaps ground you already hold ever appears.
  withDb((db) => seedJournalRow(db, {
    crossing: 145, actor: "zeta", household: "zeta", action: ACTION_LEAVE,
    object: "zeta/a-sketch", cls: CLASS_MARK,
    at: { anchor: null, dx: null, dy: null }, witnesses: null,
    payload: { slug: "a-sketch", by: "zeta", kind: "sited", at: { x: 100, y: 100 }, extent: { w: 2, h: 2 }, body: "not published yet", date: "2026-08-22" },
  }));

  const inbox = await stanceInbox(repo, houseA, { dbPath });
  const sketch = inbox.candidates.find((c) => c.mark === "zeta/a-sketch");
  assert.ok(sketch, "the sketch is answerable before it publishes — otherwise the crossing has no stance to read");
  assert.equal(sketch.published, false, "and the reader is told which it is, rather than left to assume canon");

  const r = await speak({ on: "zeta/a-sketch", stance: "opposed" });
  assert.equal(r.stance, "opposed");
  assert.equal(pen.rows().filter((x) => x.class === CLASS_STANCE)[0].object, "zeta/a-sketch",
    "and the word reached the record, which is where G1 put the write");

  // and a sketch that touches nothing of yours stays invisible
  withDb((db) => seedJournalRow(db, {
    crossing: 145, actor: "zeta", household: "zeta", action: ACTION_LEAVE,
    object: "zeta/elsewhere", cls: CLASS_MARK,
    at: { anchor: null, dx: null, dy: null }, witnesses: null,
    payload: { slug: "elsewhere", by: "zeta", kind: "sited", at: { x: 8000, y: 8000 }, extent: { w: 2, h: 2 }, body: "far off", date: "2026-08-22" },
  }));
  const after = await stanceInbox(repo, houseA, { dbPath });
  assert.equal(after.candidates.some((c) => c.mark === "zeta/elsewhere"), false,
    "nobody learns about a sketch anywhere else in town — the disclosure reaches exactly the ground it concerns");
});

// ── the engine answers overlap, never this door ──────────────────────────────

test("an unreadable engine DISCLOSES rather than guessing at overlap", async () => {
  // A world whose `tools/` cannot be read at the ref. The door must not fall
  // back to a rectangle intersection of its own: that would be a second
  // geometry answering a constitutional question, and answering it silently.
  const blind = join(scratch, "blind");
  mkdirSync(join(blind, "WORLD"), { recursive: true });
  writeFileSync(join(blind, "README.md"), "a world with no tools/\n");
  writeFileSync(join(blind, "WORLD", "world-state.json"), JSON.stringify({ marks: MARKS, parcels: [] }));
  const bg = (...a) => execFileSync("git", ["-C", blind, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  bg("init", "-q", "-b", "main");
  bg("config", "user.email", "t@postmark.invalid");
  bg("config", "user.name", "t");
  bg("add", "-A");
  bg("commit", "-qm", "a world with no engine");
  resetStanceGeometry();

  const inbox = await stanceInbox(blind, houseA, { dbPath });
  assert.match(inbox.unavailable, /geometry could not be read/,
    "overlap is the engine's answer and this door will not substitute its own");
  assert.deepEqual(inbox.candidates, []);
  const block = await stancesBlock(blind, houseA, { spine: [{ id: "alpha/alphas-parcel" }], dbPath });
  assert.equal(block.stances_awaiting, 0);
  assert.ok(block.unavailable, "the integer says zero and the block says why — never a silent zero");
  resetStanceGeometry();
});

// ── postmark#2454: A STANCE OUTLIVES THE WINDOW IT WAS SPOKEN IN ─────────────
// The law, quoted (this module's own header): "absence is the third state and it
// is expressed by never appearing here." A drain is not absence. lupi declared
// seq 920 in crossing 167, read it back, and found it gone after the 05:45Z
// crossing-save — the act stood in the photograph and in the record; the read
// folded the live journal alone. CAN-FAIL: with the photograph union removed,
// the first assertion below goes red.
test("#2454 FALSIFIER: a stance drained into a photograph still STANDS — the read folds STATE/log ∪ the register", async () => {
  const dbPath = join(scratch, "drained.sqlite");
  const logDir = join(repo, "STATE", "log");
  mkdirSync(logDir, { recursive: true });
  const photo = join(logDir, "167.journal.jsonl");
  // the drain's own shape: the journal's vocabulary, one window per file
  writeFileSync(photo, JSON.stringify({
    at: "2026-09-03T19:04:47.702Z", type: ACTION_STANCE, actor: "alpha", seq: 920, class: CLASS_STANCE,
    object: "beta/on-alphas-edge", household: "alpha", crossing: 167,
    payload: { on: "beta/on-alphas-edge", stance: "welcomed", by: "alpha", on_your_ground: ["alpha/alphas-parcel"] },
  }) + "\n");
  try {
    const db = openDynamic(dbPath); db.close(); // a fresh, EMPTY live journal — the window has been drained
    const inbox = await stanceInbox(repo, houseA, { dbPath });
    assert.deepEqual(inbox.standing.map((s) => [s.on, s.stance, s.seq, s.crossing]), [["beta/on-alphas-edge", "welcomed", 920, 167]],
      "the drained stance stands — it was spoken, and a drain is not a withdrawal");
    assert.ok(!inbox.candidates.some((c) => c.id === "beta/on-alphas-edge"), "and the mark is no longer awaiting a word");

    // THE LIVE ARM IS THE REGISTER NOW (G1 / POS-156). This seeded the sqlite
    // journal, which `stanceRows` folded as its third source; that arm is
    // deleted -- the register already overwrote it wherever both held an act,
    // so removing it changed no answer -- and the live half of this fold is
    // `acts`. The photograph half is untouched and is the point of the test.
    pen.seedAct({ at: "2026-09-04T00:00:00.000Z", crossing: 168, actor: "alpha", action: ACTION_STANCE,
      object: "gamma/well-inside", class: CLASS_STANCE, household: "alpha",
      payload: JSON.stringify({ on: "gamma/well-inside", stance: "declined", by: "alpha" }) });
    const again = await stanceInbox(repo, houseA, { dbPath });
    assert.deepEqual(again.standing.map((s) => s.on).sort(), ["beta/on-alphas-edge", "gamma/well-inside"], "photograph + live, one fold");
  } finally {
    rmSync(photo, { force: true });
    rmSync(dbPath, { force: true });
  }
});

test("#2454 CONTROL: no photograph, no stance — the union adds nothing that was never spoken", async () => {
  const dbPath = join(scratch, "silent.sqlite");
  try {
    const db = openDynamic(dbPath); db.close();
    const inbox = await stanceInbox(repo, houseA, { dbPath });
    assert.deepEqual(inbox.standing, [], "an empty record stands nothing");
  } finally { rmSync(dbPath, { force: true }); }
});

// ── THE TEACHING LINE (walks #1 and #2, 2026-09-05/06) ───────────────────────
//
// THE COMPLAINT, in the resident's own words (docs/2026-09-05/resident-walk.md,
// 21:23 EDT, item 4):
//
//   "The law line says 'A stance is a revisable word on an edge — welcomed or
//    opposed, latest wins; neutral is never stored.' It does not say what my
//    'opposed' would DO to a mark the town has already published, nor why I was
//    not asked when it was laid. … 'welcomed or opposed' on a done thing feels
//    like a survey."
//
// THE LAW THESE ASSERT, verbatim, and both are SLICED FROM THE CHECKOUT rather
// than typed into the door:
//
//   LOGOS/the-response-function.md § The tri-state —
//     "opposed — the veto: on sovereign ground it is absolute and
//      intersection-keyed (a claim cannot dodge the law by being slightly too
//      big to be a child); from the constitutional layer it is absolute simply."
//
//   LOGOS/the-response-function.md § Residents: words, at their own pace —
//     "the default is neutral-and-revisable: the incoming thing stands
//      uncoupled until the holder speaks, and the word can always be changed by
//      a newer word. Nothing blocks; nothing is lost."
//
//   the-town/the-late-welcome (world record, tier constitution) —
//     "A stance may arrive after the sketch and before the publish; the ledger
//      keeps who was first."

const OPPOSED_SAYS =
  "opposed — the veto: on sovereign ground it is absolute and intersection-keyed (a claim cannot dodge the law by being slightly too big to be a child); from the constitutional layer it is absolute simply.";
const UNTIL_YOU_SPEAK_SAYS =
  "the default is neutral-and-revisable: the incoming thing stands uncoupled until the holder speaks, and the word can always be changed by a newer word. Nothing blocks; nothing is lost.";
const ANY_LATENCY_SAYS =
  "this is safe at any latency, because the default is neutral-and-revisable: the incoming thing stands uncoupled until the holder speaks, and the word can always be changed by a newer word. Nothing blocks; nothing is lost.";
const LATE_WELCOME_SAYS =
  "A stance may arrive after the sketch and before the publish; the ledger keeps who was first.";

test("the teach block quotes the response function VERBATIM — both sentences, sliced from the checkout", () => {
  const teach = stanceTeach(repo, { lateWelcome: LATE_WELCOME_SAYS });
  assert.equal(teach.what_opposed_does, OPPOSED_SAYS, "what `opposed` DOES, in the law's own words");
  assert.equal(teach.until_you_speak, UNTIL_YOU_SPEAK_SAYS, "and what standing under an unanswered word costs you");
  assert.equal(teach.from, "LOGOS/the-response-function.md", "and the file it came out of is named");
  // The bytes are in the file this repo carries — not merely equal to a
  // constant that happens to sit in two places in this suite.
  const src = readFileSync(join(repo, "LOGOS", "the-response-function.md"), "utf8").replace(/\*\*/g, "").replace(/\s+/g, " ");
  assert.ok(src.includes(OPPOSED_SAYS), "the opposed sentence is in the file, not only in the door");
  assert.ok(src.includes(UNTIL_YOU_SPEAK_SAYS), "and so is the neutral-and-revisable sentence");
});

test("the teach block says where the LAW STOPS rather than inventing an answer past it", () => {
  const teach = stanceTeach(repo, { lateWelcome: LATE_WELCOME_SAYS });
  assert.equal(teach.after_it_is_published.the_law_reaches, LATE_WELCOME_SAYS);
  assert.equal(teach.after_it_is_published.law_mark, "the-town/the-late-welcome");
  // ⚠ NOT A SILENCE — AN UNRULED PAIR. The reviewer read both LOGOS files
  // independently and sharpened this: the record does not fall quiet, it says
  // two things that pull against each other. So the field must name BOTH, and
  // both must be the FILES' words rather than the door's summary of them.
  const u = teach.after_it_is_published.unruled;
  assert.ok(u.includes(ANY_LATENCY_SAYS), "the response function's latency clause, verbatim");
  assert.ok(u.includes(LATE_WELCOME_SAYS), "and the late welcome's window, verbatim");
  assert.match(u, /UNRULED PAIR/, "and it is called by the law's own word");
  assert.match(u, /founders' desk/, "which conflict-matrix.md says is where such a pair goes");
  assert.match(u, /will not tell you it undoes anything/);
  // Both quoted sentences are IN the files this repo carries, not merely equal
  // to two constants that happen to sit twice in this suite.
  const src = readFileSync(join(repo, "LOGOS", "the-response-function.md"), "utf8").replace(/\*\*/g, "").replace(/\s+/g, " ");
  assert.ok(src.includes(ANY_LATENCY_SAYS), "the latency clause is in the file, not only in the door");
});

test("a rewritten law is REPORTED, never paraphrased — the quote cannot outlive its source", () => {
  // The slicer's whole purpose: a sentence typed into the door would still be
  // served, confidently, after the record changed under it.
  const gone = join(scratch, "world-without-logos");
  mkdirSync(join(gone, "LOGOS"), { recursive: true });
  writeFileSync(join(gone, "LOGOS", "the-response-function.md"), "# The response function\n\nRewritten, and the anchors are gone.\n");
  const teach = stanceTeach(gone, { lateWelcome: LATE_WELCOME_SAYS });
  assert.equal(teach.what_opposed_does, undefined, "no sentence is served that the file no longer carries");
  assert.match(teach.unresolved, /no longer carries the sentences this door quotes/);
  // And the mark half still stands: two sources, independently honest.
  assert.equal(teach.after_it_is_published.the_law_reaches, LATE_WELCOME_SAYS);
});

test("a mark the checkout cannot answer is DISCLOSED, not filled in from memory", () => {
  const teach = stanceTeach(repo, { lateWelcome: null });
  assert.equal(teach.after_it_is_published.the_law_reaches, null, "null, never a hard-coded twin");
  assert.match(teach.after_it_is_published.unresolved, /the-town\/the-late-welcome could not be read/);
});

test("the teach block rides the SHADOW — the doorstep's segment and the world's read get one teaching", async () => {
  const shadow = await stanceShadow(repo, houseA, { dbPath });
  assert.equal(shadow.teach.what_opposed_does, OPPOSED_SAYS);
  assert.equal(shadow.teach.after_it_is_published.the_law_reaches, LATE_WELCOME_SAYS,
    "and its mark body comes off the set the inbox already loaded, never a second read of the world");
  // The `law:` line is untouched: what a stance IS and what it DOES are two
  // sentences, and the second was the one missing.
  assert.match(shadow.law, /^A stance is a revisable word on an edge/);
});

// ── WHOSE GROUND THE INTEGER COUNTED (walk #1 item 3, 2026-09-05) ────────────
//
// THE COMPLAINT, verbatim: "`household { read: "doorstep" }` says
// `stances_awaiting: 23`; `world { since: … }` for the same handle says 45. The
// world door is counting my household's ground, the household door only mine —
// but both say *stances_awaiting* and neither says whose ground it counted. …
// which number is my job?"

test("stances_awaiting names its DENOMINATOR — one resident's ground reads differently from a house's", async () => {
  // One resident named: the count is that resident's ground.
  const solo = await stanceShadow(repo, { handles: new Set(["alpha"]) }, { dbPath });
  assert.equal(solo.stances_awaiting_ground, "resident:alpha");

  // The same call for a household holding two: the same field, a different
  // word, because it is a different denominator — which is the whole finding.
  const house = await stanceShadow(repo, { handles: new Set(["alpha", "beta"]) }, { dbPath });
  assert.equal(house.stances_awaiting_ground, "household");
  assert.notEqual(house.stances_awaiting_ground, solo.stances_awaiting_ground,
    "two scopes must not answer under one name — that WAS the defect");

  // And the numbers really do differ, so the label is load-bearing rather than
  // decorative: alpha alone holds one parcel; the house holds alpha's ground
  // and beta's cairn, so beta's own mark leaves alpha's inbox.
  assert.notEqual(house.stances_awaiting, solo.stances_awaiting,
    "the two counts differ — which is why the label had to");
});

test("the ambient block names its ground too, and TIER 1 stays one integer", async () => {
  // Tier 2 — standing on your own parcel — carries a block, so the scope rides
  // it. This is the read the walk's `45` came from.
  const own = await stancesBlock(repo, houseA, { spine: [{ id: "alpha/alphas-parcel" }], dbPath });
  assert.equal(own.stances_awaiting_ground, "resident:alpha");
  assert.ok(Array.isArray(own.awaiting), "tier 2 is the block, not the bare integer");

  // Tier 1 — off your own ground — is ONE INTEGER, and this lane does not get to
  // change that. dev/door-plan/DESIGN.md § the two additions, founder-blessed,
  // verbatim: "the bare read carries ONE INTEGER everywhere: `stances_awaiting: N`".
  const away = await stancesBlock(repo, houseA, { spine: [{ id: "the-town/let-there-be-light" }], dbPath });
  assert.deepEqual(Object.keys(away), ["stances_awaiting"],
    "a market read grows no second key — the exposure model is a ruling, not a default");
});

// ── the `superseded` courtesy reads the whole record (G1 lane 3b lap 3) ──────
//
// MY REVIEWER'S FINDING. The declare path computed `prior` from
// `readJournal(db)` alone — the live sqlite journal — while the read side had
// already moved to photographs ∪ journal (#2454) and now to the register beside
// them. Nothing asserted `superseded`, so the gap was invisible: the suite was
// green before the fix and green after it, which is why it took a reviewer.
//
// And the lane's own journal reaper ACCELERATES the decay: once a stance row's
// twin is confirmed in `acts` the reaper takes the sqlite row, so the window
// shrinks from "until the next drain" to "until the next reap". A courtesy
// field that rots faster because of a fix shipped in the same lane.

test("#2454's smallest type: a stance whose row has left sqlite is still SUPERSEDED, not forgotten", async () => {
  const first = await speak({ on: "beta/on-alphas-edge", stance: "welcomed" });
  assert.equal(first.error, undefined, "the first stance is spoken");
  // THE ROW IS IN THE RECORD (G1): the door's write is `acts` now, so the
  // photograph below is cut from the row the register holds rather than from a
  // sqlite copy that no longer exists.
  const act = pen.rows().find((r) => r.class === CLASS_STANCE && r.object === "beta/on-alphas-edge");
  assert.ok(act, "and it is in the record");
  const spoken = { seq: act.id, written_at: act.at, action: act.action, actor: act.actor,
    class: act.class, object: act.object, household: act.household, crossing: act.crossing,
    at: { anchor: act.at_anchor, dx: act.at_dx, dy: act.at_dy },
    witnesses: act.witnesses == null ? null : JSON.parse(act.witnesses),
    effect: act.effect, payload: JSON.parse(act.payload) };

  // The row is DRAINED: it moves to the photograph and leaves sqlite. This is
  // what the drain did every twelve hours, and what the reaper now does as soon
  // as the register confirms the twin.
  const logDir = join(repo, "STATE", "log");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, "145.journal.jsonl"), JSON.stringify({
    at: spoken.written_at, type: spoken.action, actor: spoken.actor, seq: spoken.seq,
    class: spoken.class, object: spoken.object, household: spoken.household, crossing: spoken.crossing,
    standing: spoken.at, witnesses: spoken.witnesses, effect: spoken.effect, payload: spoken.payload,
  }) + "\n");
  // AND THE ROW LEAVES THE LIVE LAYER. It used to be deleted from sqlite; the
  // equivalent now is that the register's copy is gone -- the archive holds it,
  // the live read does not -- which is the same shape the drain and the reaper
  // made and the same one this test is about.
  pen.state.acts.length = 0;
  assert.equal(pen.rows().filter((r) => r.class === CLASS_STANCE).length, 0, "the live layer no longer holds it");

  const second = await speak({ on: "beta/on-alphas-edge", stance: "opposed" });
  assert.equal(second.error, undefined);
  assert.ok(second.superseded, "the door must still know the resident already spoke — the record has not forgotten, and neither may the receipt");
  assert.equal(second.superseded.stance, "welcomed");
  assert.equal(second.superseded.seq, spoken.seq);
});

test("CONTROL · a FIRST stance on untouched ground reports no `superseded` at all", async () => {
  // Without this, the assertion above would pass on a door that attached a
  // `superseded` block to every answer.
  const r = await speak({ on: "gamma/well-inside", stance: "welcomed" });
  assert.equal(r.error, undefined);
  assert.equal(r.superseded, undefined, "nothing was said before, so nothing is superseded");
});
