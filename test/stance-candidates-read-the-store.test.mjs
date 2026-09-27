// stance-candidates-read-the-store.test.mjs — the narrow 2.0 read, falsified.
//
// SIBLING, NOT DUPLICATE. `stance-read-from-store.test.mjs` moved the stance
// ACT read (`stanceRows` — what you have already said) onto the register. This
// file is the other half: the CANDIDATE read (`worldForStances` — what awaits
// your word), which moved onto `claims` through `stance_reader` on 2026-09-22.
//
// THE LAW, verbatim (G1 overnight, RULING 2, Wright on Keemin's delegation):
//
//   "a new Postgres role `stance_reader`, granted SELECT on `claims` through a
//    policy carve that admits draft rows to THAT role only; used by exactly one
//    reader, `worldForStances`' narrow 2.0 read (DEC-14's words: 'may see
//    overlapping drafts across households'), through its own pool/credential
//    (`WORLD2_STANCE_URL` …); the derivation's OUTPUT carries what the 1.0 read
//    carries today — a candidate's existence, standing and weight — never a
//    draft's body."
//
// and DEC-14 itself (runbook, ruled 2026-09-03), which RULING 2 unblocks:
//
//   "give the stance candidate list its own narrow 2.0 read that may see
//    overlapping drafts across households, built when G2's read deletions need
//    it."
//
// ── WHY THIS SUITE HAS NO JOURNAL ───────────────────────────────────────────
//
// `world-stance.test.mjs` still plants its sketches with `appendJournal` and
// reads them back through `stance-pool-stub.mjs`, which translates that journal
// into `claims` rows. That keeps twenty fixtures saying what they always said —
// and it CANNOT prove the read moved, because a journal is still what those
// tests write.
//
// So every fixture here seeds the STORE DIRECTLY and points `dbPath` at a file
// that does not exist. The journal table is absent, not merely empty. A read
// that had kept any 1.0 arm would answer nothing here, and the-late-welcome
// would go red on its own name.
//
//   node --test test/stance-candidates-read-the-store.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic } from "../src/dynamic-store.mjs";
import { CLASS_MARK, ACTION_LEAVE } from "../src/world-journal.mjs";
// ── THE SKETCHES ARE SEEDED, NOT WRITTEN BY A DOOR (G1 / POS-156) ──────────
//
// G1 deleted the general journal INSERT; the write path writes the RECORD now.
// These fixtures plant sketches in the sqlite journal and the stance pool stub
// (`test/stance-pool-stub.mjs`) shapes them as the `claims` rows the store
// read asks for -- so the rows are PUT THERE by this file, and the path under
// test is still the real one. Nothing here claims a door wrote them.
import { seedJournalRow } from "./journal-seed.mjs";
import {
  AMBIENT_CAP, resetStanceGeometry, stanceInbox, stanceShadow, stancesBlock, worldForStances,
} from "../src/world-stance.mjs";
import { __setStancePoolForTest } from "../src/world2-acts.mjs";
import { STANCE_ON, clearStancePool, stancePoolFromJournal } from "./stance-pool-stub.mjs";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "pos195-stance-store-"));
after(() => sweep(scratch));

// ── canon, in a bottle ───────────────────────────────────────────────────────
//
// alpha holds a parcel that stood on 08-01. Everything the store hands back is
// a live claim laid over it LATER, so alpha is the ground-holder in every case
// and precedent runs the one direction the door allows.

const repo = join(scratch, "world");
mkdirSync(repo, { recursive: true });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const CANON = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 }, date: "2026-07-01", body: "the world frame" },
  { id: "alpha/alphas-parcel", by: "alpha", kind: "parcel", at: { x: 100, y: 100 }, extent: { w: 25, h: 25 }, date: "2026-08-01", body: "alpha's ground" },
];

put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
`);
put("WORLD/world-state.json", JSON.stringify({ tick: 0, marks: CANON, parcels: [] }));
put("WORLD/skeleton.json", JSON.stringify({ features: [] }));
git("init", "-q", "-b", "main");
git("config", "user.email", "t@postmark.invalid");
git("config", "user.name", "pos195 falsifier");
git("add", "-A");
git("commit", "-qm", "canon");

const houseA = { household: "alpha", handles: new Set(["alpha"]) };

// ── the store, seeded directly ───────────────────────────────────────────────
//
// The rows `stance_reader` would hand back, held WHOLE — body included, because
// `claims.body` is a column and that role holds SELECT on the table. The stub
// projects whatever the query's own select list names, so what the derivation
// never sees is what the query never asked for.

/** A live claim row, in the store's own vocabulary. */
const claim = (slug, { by = null, x = 100, y = 100, w = 2, h = 2, date = "2026-08-20", body = "", status = "draft", kind = "sited" } = {}) => ({
  slug, claimant: by ?? String(slug).split("/")[0], declared_by: by ?? String(slug).split("/")[0],
  status, kind, date, at: { x, y }, extent: { w, h }, body,
});

const COLUMNS = ["slug", "claimant", "status", "at", "extent", "kind", "date", "declared_by", "body"];
const selects = (text, column) => {
  const list = String(text).slice(0, String(text).search(/\bFROM\b/i));
  return new RegExp(`(\\bAS\\s+${column}\\b)|(^|[\\s,])${column}\\s*(,|$)`, "im").test(list);
};

/** Point the read at exactly these rows. The journal is never consulted. */
function storeHolding(rows) {
  __setStancePoolForTest({
    async query(text, params = []) {
      const wanted = new Set(params[0] ?? ["draft", "pending"]);
      return { rows: rows.filter((r) => wanted.has(r.status))
        .sort((a, b) => String(a.slug).localeCompare(String(b.slug)))
        .map((r) => { const out = {}; for (const c of COLUMNS) if (selects(text, c)) out[c] = r[c]; return out; }) };
    },
    async end() { /* nothing to close */ },
  });
}

// THE JOURNAL IS ABSENT, not empty. `dbPath` names a file nothing creates, so
// `openDynamicReadOnly` answers null and any surviving 1.0 arm would read
// nothing at all — which is precisely what makes the greens below mean the
// store answered.
let dbPath, n = 0;
beforeEach(() => {
  dbPath = join(scratch, `absent-${++n}.db`);
  process.env.WORLD_SINGLE_LOG = "1";
  Object.assign(process.env, STANCE_ON);
  resetStanceGeometry();
});
after(() => {
  delete process.env.WORLD_SINGLE_LOG; delete process.env.WORLD2_STANCE_URL;
  clearStancePool();
});

const noJournal = () => assert.equal(existsSync(dbPath), false,
  "this suite proves the STORE answered — a journal file here would make every green below ambiguous");

// ── the three the 1.0 arm held, now held by the store ────────────────────────

test("the-late-welcome — an UNPUBLISHED sketch on your ground is a candidate, from the STORE, with no journal at all", async () => {
  // the-late-welcome, verbatim: "A stance may arrive after the sketch and before
  // the publish; the ledger keeps who was first."
  //
  // This is the falsifier the 2026-09-22 measurement priced: removing the live
  // arm reddened it by name, and G1 removes that arm's source. It is green here
  // on a tree where the journal does not exist, which is the whole claim of
  // RULING 2 — the disclosure moved records and did not stop.
  storeHolding([claim("zeta/a-sketch", { body: "not published yet" })]);
  noJournal();

  const inbox = await stanceInbox(repo, houseA, { dbPath });
  const sketch = inbox.candidates.find((c) => c.mark === "zeta/a-sketch");
  assert.ok(sketch, "the sketch is answerable before it publishes — otherwise the crossing has no stance to read");
  assert.equal(sketch.published, false, "and the reader is told which it is, rather than left to assume canon");
  assert.deepEqual(sketch.on_your_ground, ["alpha/alphas-parcel"],
    "and WHICH of your marks makes you a speaker — a resident told to judge needs to see why it is theirs to judge");
});

test("a sketch that touches nothing of yours stays invisible, and the STORE does not widen that", async () => {
  // The narrowing was never the read's: `candidatesFrom` only surfaces a mark
  // overlapping ground the caller holds. 023's policy is `USING (true)` — the
  // role may read the live layer — so this is the test that the carve did not
  // become a disclosure.
  storeHolding([
    claim("zeta/a-sketch", { body: "on alpha's ground" }),
    claim("zeta/elsewhere", { x: 8000, y: 8000, body: "far off" }),
  ]);
  noJournal();

  const inbox = await stanceInbox(repo, houseA, { dbPath });
  assert.equal(inbox.candidates.some((c) => c.mark === "zeta/a-sketch"), true);
  assert.equal(inbox.candidates.some((c) => c.mark === "zeta/elsewhere"), false,
    "nobody learns about a sketch anywhere else in town — the disclosure reaches exactly the ground it concerns");
});

test("TIER 2 — the ambient block is capped at ~3 and says how many more, off the store", async () => {
  storeHolding(Array.from({ length: 8 }, (_, i) =>
    claim(`zeta/crowd-${i}`, { by: "zeta", w: 1, h: 1, date: `2026-08-2${i}`, body: `one of many ${i}` })));
  noJournal();

  const home = await stancesBlock(repo, houseA, { spine: [{ id: "alpha/alphas-parcel" }], dbPath });
  assert.equal(home.stances_awaiting, 8, "every live claim overlapping alpha's ground, from the store");
  assert.equal(home.awaiting.length, AMBIENT_CAP, "a glance, not a list");
  assert.equal(home.more, 8 - AMBIENT_CAP, "and it says how much it is not showing");
});

test("TIER 3 — the shadow is the full inbox, PAGINATED, off the store", async () => {
  storeHolding(Array.from({ length: 25 }, (_, i) =>
    claim(`zeta/many-${String(i).padStart(2, "0")}`, { by: "zeta", w: 1, h: 1, body: `crowd ${i}` })));
  noJournal();

  const first = await stanceShadow(repo, houseA, { dbPath, limit: 10 });
  assert.equal(first.stances_awaiting, 25);
  assert.equal(first.awaiting.length, 10, "a cursor, not a feed");
  assert.equal(first.complete, false, "said out loud rather than inferred from a short page");

  const next = await stanceShadow(repo, houseA, { dbPath, limit: 10, cursor: first.cursor });
  assert.equal(next.awaiting.length, 10);
  assert.notDeepEqual(next.awaiting.map((c) => c.mark), first.awaiting.map((c) => c.mark),
    "the second page is a different page");
});

// ── THE SENTINEL — the ruling's own clause, as an assertion ──────────────────

test("THE SENTINEL — a draft's body reaches NO stance arm's output, while its existence, standing and weight do", async () => {
  // RULING 2, verbatim: "the derivation's OUTPUT carries what the 1.0 read
  // carries today — a candidate's existence, standing and weight — never a
  // draft's body."
  //
  // ⚠ AND IT IS A BEHAVIOUR CHANGE, NOT A PRESERVATION. Measured on the 1.0 arm
  // 2026-09-22: `candidatesFrom` copied `body` onto every candidate, tier 2
  // published a 120-character excerpt as `says`, and tier 3 carried the body
  // WHOLE. So this assertion is not "keep doing what you did" — it is the half
  // of the ruling that changes what a resident sees, and it is reported as this
  // lane's STOP.
  //
  // THE PROBE CAN FAIL. The sentinel IS in the store (see stance-pool-stub.mjs
  // § IT HOLDS THE BODY): `stance_reader` holds SELECT on `claims` and could
  // read it. What stands between the two is `STANCE_CLAIM_SELECT`'s column
  // list, and adding `body` to that list reds this test by name — the flip
  // recorded in this lane's PR.
  const SENTINEL = "moonlight-on-the-weir-a3f19c";
  storeHolding([claim("zeta/a-sketch", { by: "zeta", date: "2026-08-22", body: `a private sentence nobody but its author may read — ${SENTINEL}` })]);
  noJournal();

  const arms = {
    inbox: await stanceInbox(repo, houseA, { dbPath }),
    tier2: await stancesBlock(repo, houseA, { spine: [{ id: "alpha/alphas-parcel" }], dbPath }),
    tier3: await stanceShadow(repo, houseA, { dbPath }),
    raw: await worldForStances(repo, { dbPath }),
  };

  for (const [name, answer] of Object.entries(arms)) {
    const whole = JSON.stringify(answer);
    assert.equal(whole.includes(SENTINEL), false,
      `the draft's body reached the ${name} arm's output — a draft's text is its author's until submit, and this ` +
      `derivation is the ONE reader allowed past 007 (023_stance_reader.sql). What it may carry is the candidate's ` +
      `existence, standing and weight.\n  found in: ${whole.slice(Math.max(0, whole.indexOf(SENTINEL) - 120), whole.indexOf(SENTINEL) + 60)}`);
  }

  // ── THE OTHER HALF, and without it the assertions above are satisfied by a
  // read that returned nothing at all. Existence, standing and weight must be
  // there, or this test is green for the wrong reason.
  const c = arms.inbox.candidates.find((x) => x.mark === "zeta/a-sketch");
  assert.ok(c, "EXISTENCE — the candidate is in the list");
  assert.equal(c.published, false, "STANDING — it is a sketch, and the reader is told so");
  assert.deepEqual(c.extent, { w: 2, h: 2 }, "WEIGHT — the ground it covers, which is what groundFor weighs");
  assert.deepEqual(c.on_your_ground, ["alpha/alphas-parcel"], "and whose ground it landed on");
  assert.equal(c.by, "zeta", "and who laid it");

  // The empty sentence is OMITTED, not published. `says: ""` would be a
  // sentence the door invented about a sketch it declined to read.
  const line = arms.tier2.awaiting[0];
  assert.equal(Object.hasOwn(line, "says"), false,
    "tier 2 must omit `says` rather than answer an empty one — a resident cannot tell an invented blank from an author who wrote nothing");
  assert.equal(Object.hasOwn(arms.tier3.awaiting[0], "body"), false,
    "tier 3 carried the body WHOLE before this lane; it must now omit the key, not empty it");
});

// ── the credential's absence is a SENTENCE, never a fallback ─────────────────

test("WORLD2_STANCE_URL absent — the read answers `unreachable`, and does NOT fall back to the journal", async () => {
  // The sqlite arm was DELETED by ruling, not flagged. So an office without the
  // credential must SAY it cannot look. Answering `[]` would tell a resident
  // nothing awaits their word while a sketch sat on their ground — the-late-
  // welcome's own failure, arriving as a cheerful empty.
  //
  // THE JOURNAL IS DELIBERATELY FULL HERE. That is what makes this a test of
  // "no fallback" rather than a test of "no rows": a read that had kept the 1.0
  // arm would find this sketch and answer with it.
  const live = join(scratch, `fallback-${++n}.db`);
  const db = openDynamic(live);
  try {
    seedJournalRow(db, {
      crossing: 145, actor: "zeta", household: "zeta", action: ACTION_LEAVE,
      object: "zeta/a-sketch", cls: CLASS_MARK,
      at: { anchor: null, dx: null, dy: null }, witnesses: null,
      payload: { slug: "a-sketch", by: "zeta", kind: "sited", at: { x: 100, y: 100 }, extent: { w: 2, h: 2 }, body: "in the journal", date: "2026-08-22" },
    });
  } finally { db.close(); }

  // the journal IS readable, and the stance read still must not read it
  stancePoolFromJournal(live);
  const withCredential = await stanceInbox(repo, houseA, { dbPath: live });
  assert.equal(withCredential.candidates.length, 1,
    "control: with the credential, this fixture DOES produce a candidate — so the absence below is the credential's doing");

  delete process.env.WORLD2_STANCE_URL;
  clearStancePool();
  const answer = await worldForStances(repo, { dbPath: live });
  assert.ok(answer.unreachable, "the read says it could not look");
  assert.equal(answer.marks, undefined, "and hands back no marks at all — not an empty list, which is a different fact");
  assert.match(answer.unreachable, /WORLD2_STANCE_URL/,
    "and NAMES the key, so an operator is told what to set rather than left to grep");
  assert.match(answer.unreachable, /deleted by ruling, not flagged/,
    "and says why there is no fallback, so the next reader does not helpfully add one");

  const inbox = await stanceInbox(repo, houseA, { dbPath: live });
  assert.deepEqual(inbox.candidates, [], "no candidates are invented");
  assert.ok(inbox.unavailable, "and the door says it is unavailable rather than answering a confident zero");

  const tier2 = await stancesBlock(repo, houseA, { spine: [{ id: "alpha/alphas-parcel" }], dbPath: live });
  assert.equal(tier2.stances_awaiting, 0);
  assert.ok(tier2.unavailable, "tier 1/2's integer is qualified by the same sentence");

  const tier3 = await stanceShadow(repo, houseA, { dbPath: live });
  assert.ok(tier3.unavailable, "and the shadow says it too");

  Object.assign(process.env, STANCE_ON);
});

// ── THE EQUALITY FALSIFIER ───────────────────────────────────────────────────

test("EQUALITY — the same live marks in both records answer byte-identically from either source", async () => {
  // The falsifier the port owes: given one town's live layer, the arms must not
  // care which record it was read out of. The 1.0 side is the journal, read
  // through the translating stub; the 2.0 side is `claims` rows seeded
  // directly. Byte-equality over JSON, because a field that differs by null vs
  // absent is exactly the kind of drift a `deepEqual` on one arm would miss.
  const MARKS = [
    { slug: "beta/on-alphas-edge", by: "beta", x: 112, y: 100, w: 4, h: 4, date: "2026-08-10", body: "beta's cairn, half over the line" },
    { slug: "gamma/well-inside", by: "gamma", x: 100, y: 100, w: 2, h: 2, date: "2026-08-12", body: "gamma left this in the middle" },
    { slug: "delta/far-away", by: "delta", x: 9000, y: 9000, w: 4, h: 4, date: "2026-08-15", body: "nowhere near anybody" },
  ];

  // ── the 1.0 record ──
  const live = join(scratch, `equality-${++n}.db`);
  const db = openDynamic(live);
  try {
    for (const m of MARKS) seedJournalRow(db, {
      crossing: 145, actor: m.by, household: m.by, action: ACTION_LEAVE,
      object: m.slug, cls: CLASS_MARK,
      at: { anchor: null, dx: null, dy: null }, witnesses: null,
      payload: { slug: m.slug.split("/")[1], by: m.by, kind: "sited", at: { x: m.x, y: m.y }, extent: { w: m.w, h: m.h }, body: m.body, date: m.date },
    });
  } finally { db.close(); }

  const arms = async (path) => JSON.stringify({
    inbox: await stanceInbox(repo, houseA, { dbPath: path }),
    tier2: await stancesBlock(repo, houseA, { spine: [{ id: "alpha/alphas-parcel" }], dbPath: path }),
    tier3: await stanceShadow(repo, houseA, { dbPath: path }),
  });

  stancePoolFromJournal(live);
  const fromJournal = await arms(live);

  // ── the 2.0 record, the same town ──
  storeHolding(MARKS.map((m) => claim(m.slug, { by: m.by, x: m.x, y: m.y, w: m.w, h: m.h, date: m.date, body: m.body })));
  const fromStore = await arms(dbPath);

  assert.equal(fromStore, fromJournal,
    "the arms must not be able to tell which record the live layer came out of");

  // AND THE COMPARISON IS NOT OF TWO EMPTIES. A falsifier that compared nothing
  // to nothing would stand green through the whole port.
  const inbox = JSON.parse(fromStore).inbox;
  assert.equal(inbox.candidates.length, 2,
    "beta's cairn and gamma's mark overlap alpha's parcel; delta's does not — so both sides carried a real answer");
});
