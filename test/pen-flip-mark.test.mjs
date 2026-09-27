// pen-flip-mark.test.mjs — LANE SIX OF THE PEN FLIP (W2_PEN=…,mark; runbook C6).
//
// The mark lane is the candle, and the only lane the flip refused for
// UNREADINESS rather than ruling. `FLIP_REFUSED.mark` said why, verbatim:
//
//   "its candle half must ride penWrite's own transaction"
//
// and the runbook's own NO-GO said what flipping it by flag alone would do:
// *"would write acts with no docket, which is F2 self-inflicted."* So this file
// asks the four questions the flip has to answer before the flag may name it.
//
// Every test quotes the law it asserts:
//
//   DESIGN-pen-flip.md §3 (2026-08-29)   "for a flipped lane Postgres commits
//                                         first and is awaited; sqlite receives
//                                         the row AFTER, as the reverse mirror"
//   D2, the ruled refusal                 "the office's record cannot be reached
//                                         — nothing was written, and nothing was
//                                         lost"
//   DESIGN §2 R1                          "ONE ACT, ONE TRANSACTION … an act and
//                                         its claim commit on one client inside
//                                         one BEGIN/COMMIT, whichever era wrote
//                                         them"
//   runbook §5 NO-GO                      "a sqlite row present after a refused
//                                         write … 1.0's pen holding a row the
//                                         resident was told did not happen"
//   Phase 5.6, the privacy law            a private draft never reaches `acts`,
//                                         because `acts` is the one table that
//                                         leaves the box
//
// ── HOW THE PEN IS STOOD IN FOR ──────────────────────────────────────────────
//
// `test/helpers/fake-pen.mjs` — a Postgres stand-in that holds real rows in a
// real transaction, resolved into `world2-pen.mjs`'s one `import("pg")` by
// `module.registerHooks`. Nothing in src/ knows. Its header says why a stub
// would not do: "one client, one transaction" cannot be asked of a fake that
// swallows statements.
//
//   node --test --test-reporter=tap test/pen-flip-mark.test.mjs

import { currentCrossing } from "../src/crossings.mjs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_PEN = new URL("./helpers/fake-pen.mjs", import.meta.url).href;

// Registered BEFORE any src/ module is imported, because `pool()` caches the
// module namespace on first use and a hook that arrives second never runs.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "pg") return { url: FAKE_PEN, shortCircuit: true };
    return next(spec, ctx);
  },
});

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const tmp = mkdtempSync(join(tmpdir(), "postmark-penflip-mark-"));
after(() => { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } });

const unflip = () => {
  delete process.env.W2_PEN; delete process.env.WORLD2_PG;
  delete process.env.WORLD2_PG_URL; delete process.env.WORLD2_CANDLE;
};
unflip();
after(unflip);

const candleOn = (lanes = null) => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://fake/pen";
  process.env.WORLD2_CANDLE = "1";
  if (lanes) process.env.W2_PEN = lanes; else delete process.env.W2_PEN;
};

const { resetStore, theStore } = await import("./helpers/fake-pen.mjs");
const { openDynamic } = await import("../src/dynamic-store.mjs");
const journal = await import("../src/world-journal.mjs");
const { appendJournal, appendActFlipped, penFor } = journal;
const { penSettled, penStatus } = await import("../src/world2-pen.mjs");
const { docketSettled, docketStatus } = await import("../src/world2-claims.mjs");

const count = (db, table) => Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);

let dbn = 0;
const freshDb = () => openDynamic(join(tmp, `mark-${++dbn}.db`));

// The two rows one slug's life is made of. `put_forward` is the DOOR's verdict
// (world.mjs § THE STAKE IS THE BOUNDARY); its absence is a private draft.
const composeRow = ({ by = "guards-alfa", slug = "the-doomed-sketch", stamps = null } = {}) => ({
  crossing: currentCrossing(), actor: by, household: by, action: "leave-mark",
  object: `${by}/${slug}`, cls: "mark",
  at: { anchor: "the-town/the-quay", dx: 1, dy: 2 },
  payload: {
    by, slug, kind: "sited", body: "a sentence nobody else has read",
    at: { x: 10, y: 10 }, extent: { w: 4, h: 4 },
    ...(stamps == null ? {} : { stamps, put_forward: true }),
  },
  effect: "a draft stands in the live layer",
});
const withdrawRow = ({ by = "guards-alfa", slug = "the-doomed-sketch" } = {}) => ({
  crossing: currentCrossing(), actor: by, household: by, action: "withdraw",
  object: `${by}/${slug}`, cls: "mark",
  at: { anchor: "the-town/the-quay", dx: 1, dy: 2 },
  payload: { by, slug, was_published: false },
  effect: "the draft is gone",
});

// QUIESCENCE, NOT A NAMED QUEUE. Awaiting `penSettled()`/`docketSettled()` is
// awaiting the queues this tree HAS — and the defect under test is a tree with
// one more queue than that. The first draft of this file did exactly that and
// (c) passed against a deliberately re-broken tree, because the write it was
// asserting the absence of simply had not landed yet: the probe could not fail,
// which is the one thing a falsifier must be able to do.
//
// So the settle drains real time as well as the known promises. 250 ms is four
// times the widest statement delay this file installs, and the flip proof is
// what sets it: with the second queue restored, the compose's INSERT lands
// inside this window and (c) goes red naming the row it found.
const settle = async () => {
  await docketSettled(); await penSettled(); await docketSettled();
  await new Promise((r) => setTimeout(r, 250));
  await docketSettled(); await penSettled();
};

// THE ADVERSARY, and it is the mechanism rather than a thumb on the scale. A
// compose writes a body, a geometry and a bbox; a withdrawal writes a
// predicate. The two halves of one slug's life are not equally fast, and on the
// box that inequality was 113 ms wide — wide enough for the DELETE to overtake
// its own INSERT (jetto-b1-guards-report § Finding 1).
//
// Under ONE queue no statement can be slow enough to reorder anything: the
// withdrawal's transaction cannot BEGIN until the compose's has COMMITted. Under
// two, any inequality at all is enough. So the slowness stays in permanently —
// it is the thing the single queue has to defeat, and a test that passed only
// because the microtask scheduler happened to be kind would falsify nothing.
const SLOW_COMPOSE = (t) => (/INSERT INTO claims/i.test(t) ? 60 : 0);

beforeEach(() => {
  resetStore({ identities: { "guards-alfa": "gh:9000001" }, queryDelay: SLOW_COMPOSE });
});

// ── (c) THE TWO-QUEUE MIS-ORDER — the reproduction, written first ────────────

test("(c) UNFLIPPED · a withdrawn private draft leaves NO docket row — its DELETE cannot overtake its own compose", async () => {
  // B1's finding 1, verbatim: "two queues, one claim row, no ordering between
  // them … a resident's withdrawn private draft keeps its docket row, so the
  // slug stays taken." The compose is an unstaked leave-mark (the private-draft
  // arm) and the withdraw is a public mark-class row; if those ride SEPARATE
  // promise queues the DELETE runs against a table the INSERT has not reached.
  candleOn(null); // shadow era — the flag names no lane; this is 1.0's own pen
  const db = freshDb();
  try {
    // ── THE ORDERING IS THE CALLER'S AWAIT NOW (G1 / POS-156, RULING 3) ──
    //
    // These two calls were UNAWAITED, and the ordering came from the shared
    // shadow queue underneath them. `appendJournal` awaits the record and
    // throws on failure since G1, so the compose is COMMITTED before the
    // withdrawal is issued -- a stronger guarantee than a shared queue, and one
    // no refactor that gives an arm its own pool can undo.
    //
    // The claim is unchanged and so is what would break it: a withdrawal whose
    // DELETE runs against a table its own INSERT has not reached leaves the
    // slug taken (B1 finding 1). `settle()` stays, because the docket's own
    // writes may still have a queue behind them.
    await appendJournal(db, composeRow());
    await appendJournal(db, withdrawRow());
    await settle();

    const left = theStore().claims;
    assert.deepEqual(left, [],
      `the withdrawn draft kept its docket row (${JSON.stringify(left)}) — the slug stays taken, `
      + "which is the two-queue disease: the DELETE ran before the INSERT it was meant to remove");
  } finally { db.close(); unflip(); }
});

test("(c2) UNFLIPPED · both halves of one slug's life ride ONE queue — the ordering guarantee, named", async () => {
  // The mechanism behind (c), asserted directly so a future refactor that
  // re-splits the queues reddens here with the reason rather than reddening
  // (c) as a puzzle. `state.queue = state.queue.then(...)` is strict FIFO, so
  // ONE queue IS the ordering; two is the absence of one.
  candleOn(null);
  const db = freshDb();
  try {
    // `world2-pen`'s `written` counts ONE PER QUEUED TRANSACTION, and on an
    // unflipped lane `shadowWrite` is the only thing that increments it. So a
    // delta of exactly 2 says both the compose and the withdrawal were
    // serialized by that one queue — which IS the ordering guarantee, since
    // `state.queue = state.queue.then(…)` is strict FIFO. A tree that gives the
    // private arm its own queue reaches 1 here.
    //
    // An earlier draft asked this by the identity of the promise `docketSettled()`
    // hands back. That probe is gone, and its removal is itself a finding:
    // `docketSettled()` no longer returns a bare queue at all (it awaits the
    // pen's queue too, because that is where the docket's writes ride —
    // src/world2-claims.mjs). A test that reaches into a function's return
    // identity is a test coupled to plumbing rather than to the claim, and this
    // one broke the moment the plumbing told the truth.
    const penWrittenBefore = penStatus().written;

    // ── THE ORDERING IS THE CALLER'S AWAIT NOW (G1 / POS-156, RULING 3) ──
    //
    // These two calls were UNAWAITED, and the ordering came from the shared
    // shadow queue underneath them. `appendJournal` awaits the record and
    // throws on failure since G1, so the compose is COMMITTED before the
    // withdrawal is issued -- a stronger guarantee than a shared queue, and one
    // no refactor that gives an arm its own pool can undo.
    //
    // The claim is unchanged and so is what would break it: a withdrawal whose
    // DELETE runs against a table its own INSERT has not reached leaves the
    // slug taken (B1 finding 1). `settle()` stays, because the docket's own
    // writes may still have a queue behind them.
    await appendJournal(db, composeRow());
    await appendJournal(db, withdrawRow());
    await settle();

    assert.equal(penStatus().written - penWrittenBefore, 2,
      "both the compose and the withdrawal must be counted by the ONE queue that serializes them — "
      + "a delta of 1 means the private-draft arm rode a SECOND queue, with nothing ordering it against "
      + "world2-pen's (DESIGN §2 R1: two independent pools with nothing joining them)");
    assert.ok(docketStatus().written >= 1,
      "and the docket still counts its own rows — the count belongs to the table, not to the queue that reached it");
  } finally { db.close(); unflip(); }
});

// ── (a) THE FLIPPED WRITE ────────────────────────────────────────────────────

test("(a) FLIPPED · a staked leave-mark writes the act AND its claim on ONE client in ONE transaction, and sqlite receives the row after", async () => {
  candleOn("mark");
  const db = freshDb();
  try {
    assert.equal(penFor({ actor: "x", action: "leave-mark", cls: "mark" }), "postgres",
      "gate 1: the flag is READ, not merely set");

    const row = await appendActFlipped(db, composeRow({ stamps: 3 }));
    assert.equal(row.flipped, true);
    assert.ok(row.actId, "the flipped write answers with the record's own id");

    const s = theStore();
    assert.equal(s.acts.length, 1, "the act is in the record");
    assert.equal(s.claims.length, 1, "and its claim is on the docket — an act with no docket is F2 self-inflicted");
    assert.equal(s.claims[0].status, "pending", "staked past the ground minimum, so it is put forward");

    // R1, asked of the log rather than assumed: one client, and no COMMIT
    // between the act and its claim.
    const tx = s.log.filter((e) => e.committed);
    const clients = new Set(tx.map((e) => e.client));
    assert.equal(clients.size, 1, `the act and its claim used ${clients.size} clients — R1 says one`);
    const iAct = tx.findIndex((e) => /INSERT INTO acts/i.test(e.text));
    const iClaim = tx.findIndex((e) => /INSERT INTO claims|UPDATE claims SET status = \$12/i.test(e.text));
    const iCommit = tx.findIndex((e) => /^COMMIT/i.test(e.text));
    assert.ok(iAct >= 0 && iClaim >= 0, "both halves must have been issued");
    assert.ok(iCommit > iAct && iCommit > iClaim,
      "the act and its claim must commit TOGETHER — a COMMIT between them is the atomicity hole F3");

    // ── D3'S REVERSE MIRROR IS GONE (G1 / POS-156) ──────────────────────
    //
    // This asserted that a journal row rode after the awaited pen. That copy
    // existed so "every 1.0 read stays valid" while the read ports landed --
    // and they all have (POS-152/153/154/162/194/195), so rule 6's deletion
    // took it. What is asserted instead is its ABSENCE, which is the whole
    // claim of G1: one record, and no second copy anybody could read.
    assert.equal(count(db, "journal"), 0,
      "a journal row rode after the pen -- G1 deleted the reverse mirror, and a copy that came back would be the split brain returning");
    assert.equal(row.seq, null, "there is no sqlite line left to name");
    assert.ok(row.actId, "and the caller names the ACT it wrote -- the record's own id is the receipt now");
  } finally { db.close(); unflip(); }
});

test("(a2) FLIPPED · a PRIVATE draft writes its claim and NOTHING to acts — the privacy law survives the flip", async () => {
  // Phase 5.6: `acts` is the one table that leaves the box (the notary exports
  // archives/acts/<window>.jsonl into a public git repo, frozen on write), and
  // a leave-mark's payload carries the mark's BODY. Flipping the lane must not
  // be the thing that publishes a resident's private sentence.
  candleOn("mark");
  const db = freshDb();
  try {
    await appendActFlipped(db, composeRow());
    const s = theStore();
    assert.equal(s.acts.length, 0,
      `a private draft reached acts (${JSON.stringify(s.acts).slice(0, 200)}) — that body is now bound for a public archive`);
    assert.equal(s.claims.length, 1, "the docket still holds it, privately");
    assert.equal(s.claims[0].status, "draft");
    const data = JSON.parse(s.claims[0].data);
    assert.ok(data._deferred_act, "the deferred act rides the draft, to be released at the stake");
    assert.equal(count(db, "journal"), 0,
      "and there is no 1.0 live layer left to hold a copy -- G1 deleted the reverse mirror (the read ports it was covering for have all landed)");
  } finally { db.close(); unflip(); }
});

// ── (b) THE REFUSAL ──────────────────────────────────────────────────────────

test("(b) FLIPPED · an unreachable pen refuses with the ruled sentence and NOTHING is written — not in sqlite, not on the docket", async () => {
  candleOn("mark");
  resetStore({ identities: { "guards-alfa": "gh:9000001" }, queryDelay: SLOW_COMPOSE, failOn: (t) => /INSERT INTO claims/i.test(t) });
  const db = freshDb();
  try {
    let refused = null;
    try { await appendActFlipped(db, composeRow({ stamps: 3 })); } catch (err) { refused = err; }
    assert.ok(refused, "an unreachable pen must refuse");
    assert.equal(refused.name, "PenUnreachableError");
    assert.equal(refused.code, 503);
    assert.match(refused.message, /nothing was written, and nothing was lost/);

    // R2's forbidden state, asked of both stores:
    assert.equal(count(db, "journal"), 0,
      "a refused write left a journal row — 1.0's pen holding a row the resident was told did not happen");
    assert.equal(theStore().acts.length, 0, "the act rolled back with its claim");
    assert.equal(theStore().claims.length, 0, "and the docket holds nothing");
  } finally { db.close(); unflip(); }
});

test("(b2) FLIPPED · the CLAIM half failing takes the act down with it — one transaction, not two writes that happen to be near each other", async () => {
  // The half that used to be a second queue is the half most likely to fail
  // alone. If the act survives its claim's failure, R1 is decoration.
  candleOn("mark");
  resetStore({ identities: { "guards-alfa": "gh:9000001" }, queryDelay: SLOW_COMPOSE, failOn: (t) => /FROM windows WHERE status = 'open'/i.test(t) });
  const db = freshDb();
  try {
    let refused = null;
    try { await appendActFlipped(db, composeRow({ stamps: 3 })); } catch (err) { refused = err; }
    assert.equal(refused?.name, "PenUnreachableError");
    assert.equal(theStore().acts.length, 0, "the act committed without its claim — F2 self-inflicted, by the flip's own hand");
    assert.equal(count(db, "journal"), 0);
  } finally { db.close(); unflip(); }
});

// ── (d) THE WITHDRAW, FLIPPED ────────────────────────────────────────────────

test("(d) FLIPPED · a withdraw of a private draft removes its claim IN ORDER after its own compose", async () => {
  candleOn("mark");
  const db = freshDb();
  try {
    await appendActFlipped(db, composeRow());
    assert.equal(theStore().claims.length, 1, "the draft stands");
    await appendActFlipped(db, withdrawRow());
    await settle();
    assert.deepEqual(theStore().claims, [],
      "the withdrawn draft kept its docket row — the slug stays taken (B1 finding 1, in the flipped era)");
    assert.equal(count(db, "journal"), 0,
      "neither act left a sqlite copy -- G1 deleted the reverse mirror, so the docket is the whole of what either one did");
  } finally { db.close(); unflip(); }
});

// ── the refusal that must be GONE ────────────────────────────────────────────

test("FLIP_REFUSED no longer names mark — a refusal left standing over a wired path is a lie in the other direction", async () => {
  candleOn("mark");
  const db = freshDb();
  try {
    let err = null;
    try { await appendActFlipped(db, composeRow({ stamps: 3 })); } catch (e) { err = e; }
    assert.equal(err, null, `the mark lane still refuses by name: ${err?.message}`);
  } finally { db.close(); unflip(); }
});

test("arena STILL refuses by name — the founder's ruling is not collateral of this flip", async () => {
  candleOn("mark,arena");
  const db = freshDb();
  try {
    let err = null;
    try { await appendActFlipped(db, { actor: "probe", action: "probe", object: "x/y", cls: "arena-act" }); } catch (e) { err = e; }
    assert.match(String(err?.message), /lane's flip is not wired/,
      "the arena stays sqlite-first by founder ruling (2026-08-29); a W2_PEN sweep must not carry it along");
    assert.equal(theStore().acts.length, 0);
  } finally { db.close(); unflip(); }
});

// ── the pairing key the closure falsifier will use ───────────────────────────

test("the claim carries the ACT'S OWN ID — `journal_seq is not an identity`, learned a fourth time and retired", async () => {
  // runbook §5 C6: "falsifier-acts-claims-closure.mjs green, and its pairing
  // key is not `journal_seq`". A flipped act carries journal_seq NULL by
  // design, so a check pairing on it reddens on every act the moment the flag
  // names this lane — the lane's own GO criterion failing for a reason that has
  // nothing to do with the lane.
  candleOn("mark");
  const db = freshDb();
  try {
    const row = await appendActFlipped(db, composeRow({ stamps: 2 }));
    const s = theStore();
    const data = JSON.parse(s.claims[0].data);
    assert.equal(data._act_id, String(row.actId),
      "the claim must name the act it belongs to, by the act's own primary key");
    // THE COLUMN IS GONE (G1 / POS-156, migration 025). This asserted it was
    // NULL on a flipped act, which was the evidence that pairing on it could
    // never have worked. The evidence is stronger now: the pen does not write
    // the column at all, so `_act_id` is not merely the better key, it is the
    // only one there is.
    assert.equal("journal_seq" in s.acts[0], false,
      "the pen still names `journal_seq` in its INSERT — migration 025 drops that column, and an office writing it fails every act the moment the migration lands");
  } finally { db.close(); unflip(); }
});

test("a STAKE on a private draft releases the held act and stamps its id in the SAME statement", async () => {
  // world2-claims § promoteDraftOnStake: the insert runs before the promotion
  // so the stamp rides the one UPDATE. A second write on a now-pending row is
  // not one of the four transitions 007 permits — this file has raised on that
  // once already.
  candleOn("mark");
  const db = freshDb();
  try {
    const { promoteDraftOnStake } = await import("../src/world2-claims.mjs");
    await appendActFlipped(db, composeRow());
    assert.equal(theStore().acts.length, 0, "a private draft has no deed yet");

    const out = await promoteDraftOnStake({
      actor: "guards-alfa", householdName: "guards-alfa",
      slug: "guards-alfa/the-doomed-sketch", stamps: 4,
    });
    assert.equal(out.promoted, true);

    const s = theStore();
    assert.equal(s.acts.length, 1, "the held act is released at the putting-forward");
    assert.equal(s.claims[0].status, "pending");
    const data = JSON.parse(s.claims[0].data);
    assert.equal(data._deferred_act, undefined, "and the claim stops carrying it");
    assert.equal(data._act_id, String(s.acts[0].id), "the released act's identity is stamped as it is released");
  } finally { db.close(); unflip(); }
});
