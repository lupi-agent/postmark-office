// stake-held.test.mjs — A STAKE THAT HOLDS NOTHING IS NEVER FILED, and the
// docket shows what is held.
//
// ── THE BUG, AS THE TOWN LIVED IT (postmark-town/postmark #2686) ────────────
//
// A stake on a draft is two writes in one act, in this order on purpose
// (src/world-stake.mjs § THE BOUNDARY, ARRIVING ON ITS OWN):
//
//   1. `promoteDraftOnStake` flips the claim draft -> pending and records
//      `stake: n` — the number ASKED.
//   2. the stamp ledger moves liquid stamps into escrow — the only record of
//      what is HELD.
//
// The order is chosen so the recoverable failure is the one that can happen:
// "if the escrow write fails, a mark that is merely public-too-early can be
// retracted before the close, whereas stamps taken for a mark that never
// reached the docket are a debt with no receipt."
//
// Sophia held 0 and staked 1 on a commons mark. (1) succeeded. (2) moved 0 and
// said so in its own receipt ("your balance has no stamps free to stake", the
// town engine's words). The docket then showed `stake: 1` for nine hours,
// indistinguishable from a backed claim, and the candle refused it at the close
// as nothing staked (window 184, 2026-09-12 05:52Z). Correct judgment, wrong
// display, for nine hours.
//
// ── WHAT THIS FILE HOLDS TO ────────────────────────────────────────────────
//
// The DECISION is pure and is falsified directly, the way `stakeRefusalFor`'s
// own header says a decision in this file must be: "PURE ON PURPOSE. The
// decision takes the three facts and returns the answer, so the falsifiers can
// put a retired mark in front of it without a database, and the door and the
// test cannot drift into two rules."
//
// The WIRING is falsified against `test/helpers/fake-pen.mjs` — a store that
// holds real rows in a real transaction — because "did the promotion actually
// come back off the docket" cannot be asked of a stub that swallows statements.
//
// The DISPLAY half is DERIVED, never stored (Keemin, 2026-09-12): the claim row
// says nothing about what is held, and `/world2/docket` reads the figure from
// `escrow_projection` through the candle's own `escrowPresenceAt`. So the two
// gates read one number, no claim is ever rewritten, and an unstake before the
// close shows up on the next read instead of leaving a stale snapshot.
//
// And the PARITY is asked of both predicates against ONE fixture, which is why
// `test/forecast-sweep-parity.test.mjs` exists: two filters, one rule, and they
// must not drift.

import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_PEN = new URL("./helpers/fake-pen.mjs", import.meta.url).href;

// Registered BEFORE any src/ module is imported — `pool()` caches the module
// namespace on first use and a hook that arrives second never runs.
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

const tmp = mkdtempSync(join(tmpdir(), "postmark-stake-held-"));
after(() => { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } });

const unflip = () => {
  delete process.env.W2_PEN; delete process.env.WORLD2_PG;
  delete process.env.WORLD2_PG_URL; delete process.env.WORLD2_CANDLE;
};
unflip();
after(unflip);

const candleOn = (lanes = "mark") => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://fake/pen";
  process.env.WORLD2_CANDLE = "1";
  if (lanes) process.env.W2_PEN = lanes; else delete process.env.W2_PEN;
};

const { currentCrossing } = await import("../src/crossings.mjs");
const { resetStore, theStore } = await import("./helpers/fake-pen.mjs");
const { openDynamic } = await import("../src/dynamic-store.mjs");
const { appendActFlipped } = await import("../src/world-journal.mjs");
const { promoteDraftOnStake, retractPendingClaim } = await import("../src/world2-claims.mjs");
const { unbackedRefusalFor, emptyPurseRefusalFor } = await import("../src/world-stake.mjs");
const { claimEffectsFrom } = await import("../src/claim-effects.mjs");
const { escrowAbsentAmong } = await import("../world2/tools/escrow-presence.mjs");
const { docketRow, docketEscrow, DOCKET_SELECT } = await import("../src/world2-serve.mjs");

const STAKE_SOURCE = readFileSync(join(HERE, "..", "src", "world-stake.mjs"), "utf8");
const CLAIMS_SOURCE = readFileSync(join(HERE, "..", "src", "world2-claims.mjs"), "utf8");
const CLEARING_SOURCE = readFileSync(join(HERE, "..", "world2", "tools", "clearing-job.mjs"), "utf8");

let dbn = 0;
const freshDb = () => openDynamic(join(tmp, `stake-held-${++dbn}.db`));

// The crossing is the LIVE one, never a literal: the notary refuses a row for a
// crossing older than the open window ("that window is certified history"), so
// a hard-coded 1 makes this file rot on the next ferry rather than fail on its
// own subject.
const composeRow = ({ by = "sophia", slug = "a-mark-on-the-commons" } = {}) => ({
  crossing: currentCrossing(), actor: by, household: by, action: "leave-mark",
  object: `${by}/${slug}`, cls: "mark",
  at: { anchor: "the-town/the-quay", dx: 1, dy: 2 },
  payload: { by, slug, kind: "sited", body: "a sentence nobody else has read",
             at: { x: 10, y: 10 }, extent: { w: 4, h: 4 } },
  effect: "a draft stands in the live layer",
});

beforeEach(() => { resetStore({ identities: { sophia: "gh:9000002", neth: "gh:9000003" } }); });

// ── 1 · THE DECISION, PURE — the falsifier board ────────────────────────────

test("NETH · 1 liquid, stakes 1 on a commons draft — the ledger moved it, so nothing is refused", () => {
  assert.equal(
    unbackedRefusalFor({ mark: "neth/a-thing", n: 1, promoted: true, applied: 1, ownGround: false }),
    null, "a backed claim is an ordinary stake and this door has nothing to say about it");
});

test("SOPHIA · 0 liquid, stakes 1 on a commons draft — 422, and the sentence names what is held", () => {
  const r = unbackedRefusalFor({ mark: "sophia/a-mark-on-the-commons", n: 1, promoted: true, applied: 0, ownGround: false });
  assert.ok(r, "the whole bug: the ledger moved 0 and the docket showed a backed claim for nine hours");
  assert.equal(r.code, 422);
  assert.match(r.defect, /nothing held/, "the defect says what is wrong with the CLAIM, not with the resident");
  assert.match(r.defect, /not filed/, "and that the claim is not on the docket — the display the bug got wrong");
  assert.match(r.hint, /backed or it is not made/, "the law, named");
  // THE RECEIPT TEACHES. A refusal that does not say how to get past it is a
  // wall (the-town/the-disclosure). Both halves of the remedy must be there.
  assert.match(r.hint, /quest/i, "how a stamp is earned — the remedy, not just the rule");
  assert.match(r.hint, /the moment it is backed/, "and that the claim files itself the moment there is a stamp behind it");
  assert.equal(r.held, 0, "the answer carries the number, so a caller does not have to parse the sentence");
  assert.equal(r.requested, 1);
});

test("OWN GROUND · a zero stake is a lawful putting-forward and is NEVER refused here", () => {
  // Keemin's ruling, 2026-08-28, quoted in world-stake.mjs § ✦0 IS NOW A LAWFUL
  // STAKE: "Staking is what puts a mark forward, and on ground your household
  // already holds there is nothing to buy — so a zero stake is a deliberate
  // putting-forward rather than a no-op, and refusing it here would make your
  // own ground the one place you could not publish."
  assert.equal(
    unbackedRefusalFor({ mark: "wright/on-my-own-parcel", n: 0, promoted: true, applied: 0, ownGround: true }),
    null, "n is 0, so this door never reaches its own question");
  // And the case that DOES reach it: an own-ground resident with an empty
  // balance who asked for a stamp. Their mark stands with nothing behind it,
  // lawfully, because the ground is theirs.
  assert.equal(
    unbackedRefusalFor({ mark: "wright/on-my-own-parcel", n: 1, promoted: true, applied: 0, ownGround: true }),
    null, "refusing here would widen the commons rule onto ground the rule does not govern");
});

test("PARTIAL · holds 1, stakes 3 — the ledger applied 1, so the row stays pending", () => {
  // Measured, not invented: `worldStakeApply` (the TOWN's engine, imported live)
  // is `applied = Math.min(n, balance)`, so a resident holding 1 who stakes 3
  // moves 1 and the answer carries `clipped: true`. A partially backed claim is
  // the candle's to judge at the close, not this door's to refuse at submit.
  assert.equal(
    unbackedRefusalFor({ mark: "neth/a-thing", n: 3, promoted: true, applied: 1, ownGround: false }),
    null, "something IS held; the door refuses only the claim with nothing behind it");
});

test("NOT THIS ACT'S PROMOTION · an ordinary stake on an already-public mark is untouched", () => {
  // `promoteDraftOnStake` answers `{ promoted: false }` for EVERY stake on an
  // already-public mark — "the ordinary answer ... and never an error". This
  // door retracts the promotion IT JUST MADE and nothing else; a pending row
  // some other act filed is not this act's to take off the docket.
  assert.equal(
    unbackedRefusalFor({ mark: "neth/already-public", n: 1, promoted: false, applied: 0, ownGround: false }),
    null, "nothing was promoted here, so there is nothing to retract and no 422 to answer");
});

test("THE GROUND COULD NOT BE READ · an unreadable ground never refuses", () => {
  // `escrow-presence.mjs § escrowAbsentAmong`, verbatim: "a store that cannot
  // answer and a town where nobody staked are different facts, and spelling
  // them the same way is how a gate refuses the whole town on a missing
  // migration." Same discipline, same direction: refuse only on a KNOWN commons.
  assert.equal(
    unbackedRefusalFor({ mark: "x/y", n: 1, promoted: true, applied: 0, ownGround: null }),
    null, "an office that cannot tell whose ground this is must not take a mark off the docket");
});

// ── 2 · PARITY — the door's predicate and the candle's, one fixture ─────────

test("PARITY · the door at submit and the candle at the close agree, mark for mark", () => {
  // Two gates, one rule. The door refuses a commons claim with nothing held at
  // SUBMIT; the candle refuses a commons claim with no escrow position at the
  // CLOSE (`escrowAbsentAmong` -> `⚑ escrow: refused … nothing staked`). They
  // must not drift, which is the reason forecast-sweep-parity.test.mjs exists.
  const fixture = [
    { slug: "sophia/nothing-behind-it", cls: "market", escrow: 0, n: 1, applied: 0 },
    { slug: "neth/one-behind-it",       cls: "market", escrow: 1, n: 1, applied: 1 },
    { slug: "neth/partly-behind-it",    cls: "market", escrow: 1, n: 3, applied: 1 },
    { slug: "wright/my-own-parcel",     cls: "home",   escrow: 0, n: 1, applied: 0 },
  ];

  const verdict = escrowAbsentAmong(
    fixture.map((f, i) => ({ id: i, slug: f.slug })),
    { tiers: new Map(fixture.map((f) => [f.slug, f.cls])),
      escrowByMark: new Map(fixture.map((f) => [f.slug, f.escrow])),
      townSha: "deadbeefcafe" });
  const candleRefuses = new Set(verdict.refused.map((r) => r.slug));

  for (const f of fixture) {
    const doorRefuses = Boolean(unbackedRefusalFor({
      mark: f.slug, n: f.n, promoted: true, applied: f.applied,
      // The door's own word for the candle's class mapping: `rowClassOf` maps
      // `market` -> `commons`, and only `commons` needs escrow, so `home` IS
      // own ground. One mapping, asked of both sides.
      ownGround: f.cls === "home",
    }));
    assert.equal(doorRefuses, candleRefuses.has(f.slug),
      `${f.slug}: the door says ${doorRefuses ? "refuse" : "allow"} and the candle says `
      + `${candleRefuses.has(f.slug) ? "refuse" : "allow"} — two gates, one rule, and they have drifted`);
  }
  assert.deepEqual([...candleRefuses], ["sophia/nothing-behind-it"],
    "and the fixture actually exercises a refusal — a parity test where neither side refuses proves nothing");
});

test("PARITY · the door names the candle's gate it is twinned with", () => {
  assert.match(STAKE_SOURCE, /escrow-presence\.mjs/,
    "a twin predicate with no pointer to its twin is how two copies drift apart");
});

// ── 3 · THE WIRING — the promotion actually comes back off the docket ───────

test("THE SAME ACT RETRACTS THE PROMOTION IT JUST MADE — no pending row survives", async () => {
  candleOn();
  const db = freshDb();
  try {
    await appendActFlipped(db, composeRow());
    assert.equal(theStore().claims[0].status, "draft", "a private draft, with its act deferred onto it");

    const out = await promoteDraftOnStake({
      actor: "sophia", householdName: "sophia",
      slug: "sophia/a-mark-on-the-commons", stamps: 1,
    });
    assert.equal(out.promoted, true);
    assert.ok(out.window, "the promotion says WHICH candle it joined — the retraction is keyed on it");
    assert.equal(theStore().claims[0].status, "pending", "it is on the public docket, for as long as this act takes");

    const undone = await retractPendingClaim(null, {
      windowId: out.window, slug: "sophia/a-mark-on-the-commons", claimant: "sophia" });
    assert.equal(undone, 1, "exactly one row came back off the docket");

    const row = theStore().claims[0];
    assert.equal(row.status, "retracted", "gold §1: retraction is free until the close");
    assert.equal(theStore().claims.filter((c) => c.status === "pending").length, 0,
      "a pending row survived the refusal — the docket is showing a claim the door said was never filed");
  } finally { db.close(); unflip(); }
});

test("THE RELEASED ACT IS NOT ORPHANED — the retracted row still names the deed it made", async () => {
  // The promotion releases the `_deferred_act` into `acts` INSIDE its own
  // transaction and stamps `_act_id` on the claim in the same statement
  // (world2-claims § the identity `_journal_seq` never was). `acts` is
  // append-only for every role — 002_grants.sql's `forbid_mutation` — so the
  // released act cannot be taken back, and it must not be left with no claim
  // naming it. It is not: the retracted row keeps `_act_id`, so the closure
  // falsifier's pairing survives and the deed reads as what it was, an act that
  // was made and then retracted before the close.
  candleOn();
  const db = freshDb();
  try {
    await appendActFlipped(db, composeRow());
    const out = await promoteDraftOnStake({
      actor: "sophia", householdName: "sophia",
      slug: "sophia/a-mark-on-the-commons", stamps: 1 });
    await retractPendingClaim(null, {
      windowId: out.window, slug: "sophia/a-mark-on-the-commons", claimant: "sophia" });

    const s = theStore();
    assert.equal(s.acts.length, 1, "the deferred act was released at the putting-forward and stays released");
    const data = JSON.parse(s.claims[0].data);
    assert.equal(data._act_id, String(s.acts[0].id),
      "the retracted claim still names its act — an act with no claim naming it is the orphan this checks for");
    assert.equal(data._deferred_act, undefined,
      "and it is not re-deferred: it would be mirrored a second time at the next stake");
  } finally { db.close(); unflip(); }
});

test("THE CANDLE'S TALLY ACCOUNTS FOR IT — `retracted_before_close`, not a row that vanished", async () => {
  candleOn();
  const db = freshDb();
  try {
    await appendActFlipped(db, composeRow());
    const out = await promoteDraftOnStake({
      actor: "sophia", householdName: "sophia",
      slug: "sophia/a-mark-on-the-commons", stamps: 1 });
    await retractPendingClaim(null, {
      windowId: out.window, slug: "sophia/a-mark-on-the-commons", claimant: "sophia" });

    // The candle's own count, as `clearing-job.mjs` writes it. Pinned by source
    // so a change to the tally's predicate reddens here rather than silently
    // dropping this lane's rows out of the crossing's own account.
    assert.match(CLEARING_SOURCE,
      /SELECT COUNT\(\*\)::int AS count FROM claims WHERE window_id = \$1 AND status = 'retracted'/,
      "the candle's tally moved — this lane's rows may no longer be in the crossing's account");
    const counted = theStore().claims.filter((c) => c.window_id === out.window && c.status === "retracted");
    assert.equal(counted.length, 1,
      "the refused stake must be COUNTED by the crossing, not deleted out of its account — "
      + "007's delete guard forbids removing a row the docket has carried anyway");
  } finally { db.close(); unflip(); }
});

test("THE DOOR ACTUALLY USES BOTH — an exported-but-unused rule is not a fix", () => {
  assert.match(STAKE_SOURCE, /unbackedRefusalFor\(\{/, "the decision is called, not merely exported");
  assert.match(STAKE_SOURCE, /retractPendingClaim\(/, "and the promotion is actually taken back off the docket");
  assert.match(CLAIMS_SOURCE, /export async function retractPendingClaim/,
    "one retraction, two callers — the withdraw branch and this door");
});

// ── 4 · THE ROW CARRIES WHAT IS HELD ───────────────────────────────────────

test("THE CLAIM ROW CARRIES NO `held` KEY AT ALL — the read is the only source", async () => {
  // Ruled 2026-09-12: nothing is written onto a pending row, so the guard needs
  // no fifth transition. A field written at submit would also go stale the
  // moment somebody unstaked before the close; a derived one cannot.
  candleOn();
  const db = freshDb();
  try {
    for (const [by, slug, stamps] of [["neth", "a-thing", 1], ["wright", "on-my-own-parcel", 0]]) {
      await appendActFlipped(db, composeRow({ by, slug }));
      const out = await promoteDraftOnStake({
        actor: by, householdName: by, slug: `${by}/${slug}`, stamps });
      assert.equal(out.promoted, true);
    }
    for (const c of theStore().claims)
      assert.equal("held" in JSON.parse(c.data), false,
        `${c.slug} carries a held key — the docket derives that figure and the row must not hold a `
        + "second copy of it to go stale");
  } finally { db.close(); unflip(); }
});

// A pool stand-in for the two statements `docketEscrow` issues. Narrow on
// purpose, and it THROWS on anything else — a stub that answers a statement it
// does not recognise is how a test starts asserting against a lie.
const escrowPool = ({ head = "deadbeefcafe1234", rows = null }) => ({
  async query(text, params) {
    const t = String(text).replace(/\s+/g, " ").trim();
    if (/FROM projection_heads WHERE repo = 'town'/.test(t))
      return { rows: head ? [{ sha: head }] : [] };
    if (/to_regclass\('public\.escrow_projection'\)/.test(t))
      return { rows: [{ ok: rows !== "no-table" }] };
    if (/FROM escrow_projection WHERE town_sha = \$1/.test(t)) {
      assert.equal(params[0], head, "the projection must be read AT the head this answer names");
      return { rows: rows === "no-table" ? [] : (rows ?? []) };
    }
    throw new Error(`escrowPool: unmodelled statement — "${t.slice(0, 90)}"`);
  },
});

test("THE DOCKET READ DERIVES `held` FROM THE CANDLE'S OWN PROJECTION", async () => {
  const escrow = await docketEscrow(escrowPool({ rows: [{ mark: "neth/one-behind-it", n: 1 }] }));
  assert.equal(escrow.reason, null, "the reader answered");
  assert.equal(escrow.townSha, "deadbeefcafe1234", "and the answer names the sha it is as-of");

  const shaped = docketRow({
    id: "c1", window_id: 184, closes_at: "2026-09-12T17:45:00Z", class: "sited",
    claimant: "neth", household: "gh:9000003", submitted_at: "2026-09-12T05:00:00Z",
    stake: 1, geometry: { slug: "neth/one-behind-it" }, counterclaim_of: null,
  }, escrow);
  assert.equal(shaped.stake, 1, "what was asked");
  assert.equal(shaped.held, 1, "and what the town actually holds on it — the whole point of this lane");
  // ADDITIVE. Every field a current reader reads must still arrive: the site's
  // docket page, the cockpit, and the MCP twin (src/town-marks.mjs § the
  // /world2/docket route) all read this row.
  for (const k of ["id", "window_id", "closes_at", "class", "claimant", "household",
                   "submitted_at", "stake", "geometry", "counterclaim_of"])
    assert.ok(k in shaped, `the docket row lost \`${k}\` — a current reader breaks on this`);
  assert.doesNotMatch(DOCKET_SELECT, /\bheld\b/,
    "and nothing is selected from the claim — a stored copy is the thing this shape exists to avoid");
});

test("A MARK THE PROJECTION ANSWERED ABOUT AND DID NOT NAME HOLDS ZERO, AND SAYS SO", () => {
  // `escrowAbsentAmong`'s own reading of the same Map, one line of it:
  //   const n = Number(escrowByMark.get(c.slug) ?? 0); if (n > 0) continue;
  // The claim the candle is about to refuse at the close is precisely the claim
  // this read must show as unbacked NOW. Answering `null` here would be the
  // docket saying "unknown" about the one fact the store holds exactly — #2686's
  // shape wearing a different word.
  const escrow = { townSha: "deadbeefcafe1234", byMark: new Map([["neth/one-behind-it", 1]]), reason: null };
  const shaped = docketRow({ id: "c2", stake: 1, geometry: { slug: "sophia/nothing-behind-it" } }, escrow);
  assert.equal(shaped.held, 0,
    "the reader answered and its answer about this mark is zero — that is a finding, not an absence");
});

test("A READER THAT CANNOT ANSWER SAYS NULL WITH ITS REASON, NEVER 0", async () => {
  // `escrowPresenceAt`'s own discipline, verbatim: "an empty stake set is
  // indistinguishable from a town where nobody stakes." Three ways to get there,
  // and each carries a sentence, because "unavailable" with no reason leaves a
  // reader unable to tell which.
  const noHead = await docketEscrow(escrowPool({ head: null }));
  assert.equal(noHead.byMark, null);
  assert.match(noHead.reason, /no town sha is ingested/);
  assert.match(noHead.reason, /not zero/, "and it says which of the two absences this is");

  const noRows = await docketEscrow(escrowPool({ rows: [] }));
  assert.equal(noRows.byMark, null, "no rows at this sha is a refusal to answer, not an unstaked town");
  assert.match(noRows.reason, /migration 014 not applied, or this sha not ingested/);

  for (const escrow of [noHead, noRows]) {
    const shaped = docketRow({ id: "c3", stake: 1, geometry: { slug: "neth/one-behind-it" } }, escrow);
    assert.equal(shaped.held, null, "unknown, and the body carries the reason beside it");
  }
});

test("FLIP · a projection row removed changes `held` on the next read, with no claim write", async () => {
  // The whole argument for deriving rather than storing, made as a falsifier: a
  // resident unstakes before the close, and the docket tells the truth on the
  // next read without anybody touching the claim — which the transition guard
  // would not have permitted anyway.
  const row = { id: "c4", stake: 1, geometry: { slug: "neth/one-behind-it" } };
  const before = docketRow(row, await docketEscrow(escrowPool({ rows: [{ mark: "neth/one-behind-it", n: 1 }] })));
  const after = docketRow(row, await docketEscrow(escrowPool({ rows: [{ mark: "someone/else", n: 2 }] })));
  assert.equal(before.held, 1);
  assert.equal(after.held, 0, "the stamps came out and the docket says so — no claim row was written either time");
  assert.deepEqual(
    { ...before, held: undefined }, { ...after, held: undefined },
    "and NOTHING else about the row moved — the claim is untouched, which is the point");
});

// ── 5 · NO CANDLE EVENT FOR A CLAIM THAT WAS NEVER FILED ────────────────────

test("CLAIM EFFECTS · a claim the door took back carries no ruling — the door's refusal IS the effect", () => {
  // `claim-effects.mjs` needs nothing new: the resident already has the 422 in
  // their hand. What must be true is that the candle never speaks about a claim
  // it never ruled on — no `claim-locked`, no `claim-refused`.
  const events = claimEffectsFrom({
    rows: [{ slug: "sophia/a-mark-on-the-commons", claimant: "sophia", status: "retracted",
             window_id: 184, submitted_at: "2026-09-12T05:52:00Z", decided_at: "2026-09-12T05:52:00Z",
             refusal_check: null }],
    sinceCrossing: 0, nowCrossing: 999999, mine: () => true,
  });
  assert.deepEqual(events.filter((e) => e.kind === "claim-locked" || e.kind === "claim-refused"), [],
    "the candle ruled on nothing here — a refusal event would be the town narrating a judgment it never made");
});

test("CLAIM EFFECTS · MEASURED — a retracted row still emits `claim-pending`, and that is a finding", () => {
  // NOT A FIX, A PIN. `claimEffectsFrom` writes `claim-pending` for any row
  // whose status is not `draft`, so a claim this door promoted and took back
  // inside one act still tells its author "went forward onto the docket".
  //
  // It is PRE-EXISTING and SHARED: an ordinary withdraw of a claim that really
  // did stand publicly produces the same row, and there the sentence is true —
  // it went forward, and then the resident took it back. Narrowing it would
  // change the withdraw lane, which this lane was not sent to touch, so the
  // behaviour is measured, pinned here, and carried to the sitting rather than
  // quietly altered. The module's own header already reads the other way ("A
  // draft writes no event … `retracted` writes none either"), so the code and
  // the comment disagree, and that disagreement is the thing to rule on.
  const events = claimEffectsFrom({
    rows: [{ slug: "sophia/a-mark-on-the-commons", claimant: "sophia", status: "retracted",
             window_id: 184, submitted_at: "2026-09-12T05:52:00Z", decided_at: "2026-09-12T05:52:00Z",
             refusal_check: null }],
    sinceCrossing: 0, nowCrossing: 999999, mine: () => true,
  });
  assert.deepEqual(events.map((e) => e.kind), ["claim-pending"]);
  assert.equal(events[0].summary, "sophia/a-mark-on-the-commons went forward onto the docket at window 184",
    "the exact sentence a resident reads about a claim the door told them was never filed");
});

// ── 6 · THE GUARD THAT IS WHY NOTHING IS WRITTEN ───────────────────────────

test("A SECOND WRITE ONTO A PENDING ROW RAISES — the four transitions, and no fifth", async () => {
  // The receipt for the shape this lane ended up with. Recording what the
  // ledger moved would need a write AFTER the ledger, onto a row that has
  // already gone pending, and 007's transition guard does not permit one:
  //
  //   "claims: % may compose a draft (draft -> draft), submit it (draft ->
  //    pending), or retract a pending claim (pending -> retracted, fields
  //    untouched) — nothing else, and never back to draft"
  //
  // Keemin ruled 2026-09-12 that the guard stays exactly as it is — no fifth
  // transition, no migration — so the docket DERIVES `held` from
  // `escrow_projection` instead and the claim row says nothing about it. This
  // test is the standing proof that the alternative really is closed: if a
  // future author reaches for a `held` column on a pending row, they meet this.
  //
  // ⚑ A PROBE THAT RELIES ON A REFUSAL MUST PROVE THE REFUSAL. This drives the
  // promotion twice against the fake pen's modelled guard: the first goes
  // through, the second raises exactly as the box would. Without this the
  // suite would go green on a write prod refuses — which is how a fake starts
  // lying (fake-pen.mjs § its own header).
  candleOn();
  const db = freshDb();
  try {
    await appendActFlipped(db, composeRow({ by: "neth", slug: "a-thing" }));
    const first = await promoteDraftOnStake({
      actor: "neth", householdName: "neth", slug: "neth/a-thing", stamps: 1 });
    assert.equal(first.promoted, true, "the lawful draft -> pending write");

    // The same statement again, now against a PENDING row — which is exactly
    // the shape any post-ledger `held` write would have.
    let raised = null;
    try {
      await promoteDraftOnStake({
        actor: "neth", householdName: "neth", slug: "neth/a-thing", stamps: 1, held: 1 });
    } catch (e) { raised = e; }
    // The promotion's own SELECT is scoped to `status = 'draft'`, so it finds
    // nothing and answers `promoted: false` rather than reaching the UPDATE —
    // which is itself the point: the ONLY lawful way to touch this row again is
    // not to. The guard is proven directly, below.
    const { Pool } = await import("./helpers/fake-pen.mjs");
    const pool = new Pool({});
    const claim = theStore().claims[0];
    assert.equal(claim.status, "pending");
    let guarded = null;
    try {
      await pool.query(
        `UPDATE claims SET status = 'pending', window_id = $1, submitted_at = now(),
                stake = GREATEST(stake, $2), data = (data - '_deferred_act')
           WHERE id = $3`, [claim.window_id, 1, claim.id, null, 1]);
    } catch (e) { guarded = e; }
    assert.ok(guarded, "a pending -> pending write went through — the guard is not being modelled, "
      + "and this suite would go green on a statement the box refuses");
    assert.match(String(guarded.message), /never back to draft|nothing else/,
      "and it raises with 007's own sentence, so a reader can grep the schema");
    assert.equal(raised, null, "the promotion itself does not raise — its WHERE keeps it lawful");
  } finally { db.close(); unflip(); }
});

// ── THE EMPTY PURSE, ASKED BEFORE THE WRITE (office #226, the commons half) ──
//
// Everything above catches the empty purse AFTER the claim is filed. A leave-mark
// with `stamps: n` writes its declaration first, so the pending claim at ✦n
// stood on the docket until the candle refused it. `emptyPurseRefusalFor` asks
// first, so the declaration is made at the ✦0 that will land.
//
// CAN-FAIL FLIP: make the liquid check `Number(held.liquid) > -99` (always
// true, so it returns null) → an empty purse is never asked about and the first
// test reddens. Run 2026-09-28: red, then green on restore.
test("THE EMPTY PURSE · 0 liquid, asks 1 — refused before the write, so the declaration is ✦0", () => {
  const b = emptyPurseRefusalFor({ n: 1, held: { liquid: 0, staked: 0 } });
  assert.ok(b, "a resident holding nothing must not be declared at ✦1");
  assert.equal(b.code, 422);
  assert.match(String(b.defect), /you hold 0 stamps/);
});

test("THE EMPTY PURSE · 1 liquid asks 3, a zero ask, and an UNREAD ledger are all left alone", () => {
  assert.equal(emptyPurseRefusalFor({ n: 3, held: { liquid: 1, staked: 0 } }), null, "partial: the candle judges it (09-12)");
  assert.equal(emptyPurseRefusalFor({ n: 0, held: { liquid: 0, staked: 0 } }), null, "✦0 has its own ruling");
  assert.equal(emptyPurseRefusalFor({ n: 1, held: { liquid: 0, staked: 0, unread: "no town clone" } }), null,
    "could not tell never demotes a mark");
  assert.equal(emptyPurseRefusalFor({ n: 1, held: null }), null);
});
