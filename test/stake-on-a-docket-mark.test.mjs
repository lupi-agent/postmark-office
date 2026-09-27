// A STAKE ON A MARK ALREADY ON THE OPEN DOCKET IS AN ORDINARY STAKE
// (postmark-town/postmark#3139, Marigold, 2026-09-25).
//
// Marigold re-hung a withdrawn mark with `leave-mark` + `amend` + `stamps`. It
// went PENDING on window 211's docket, and its `marks` row stayed `retired`,
// because only a crossing publishes it again. Then `world_stake` on it bounced
// 422 "is not standing — it returned to your drafts", with a hint to leave it
// again or stake the draft: an act that would have put it forward twice.
//
// The docket was the fact the door never read. `markStandingStatus` now carries
// the open window a pending claim rides (`docket_window`, same statement), and
// `stakeRefusalFor` takes it as its own input and lets the stake through. The
// town ledger keys escrow on the MARK (tools/world-stake.mjs § worldStakeApply,
// `markEscrow` = state.escrow.get(mark)), and the promotion only ever promotes a
// DRAFT row, so the stake adds to what stands behind the one pending claim and
// files no second one. These cases drive the real promotion and the real
// standing reader through the fake pen; the ledger is a spy.
//
// NOT PROVEN HERE: the widened SQL against real Postgres. The fake pen models
// the statement; it does not run it.

import { registerHooks } from "node:module";

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

const unflip = () => {
  delete process.env.W2_PEN; delete process.env.WORLD2_PG;
  delete process.env.WORLD2_PG_URL; delete process.env.WORLD2_CANDLE;
};
const candleOn = () => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://fake/pen";
  process.env.WORLD2_CANDLE = "1";
};
unflip();
after(unflip);

const { resetStore } = await import("./helpers/fake-pen.mjs");
const { stakeRefusalFor, worldStakeViaOffice } = await import("../src/world-stake.mjs");

const W = 211;
const MARK = "mari/first-night-garland";
const KEY = { handles: new Set(["mari"]), household: "mari" };
const RETIRED = { known: true, found: true, status: "retired", retired: true, retired_window: 205 };
const NOT_STANDING = `"${MARK}" is not standing — it returned to your drafts`;

// Marigold's store: the marks row says retired; the docket, when asked, has one
// pending claim on window `window` (open unless `closed`).
function marigold({ docket = true, closed = false } = {}) {
  const s = resetStore({ identities: { mari: "gh:9000009" } });
  s.windows = [{ id: W, status: closed ? "closed" : "open" }];
  if (closed) s.windows.push({ id: W + 1, status: "open" });
  s.marks = [{ slug: MARK, status: "retired", retired_window: 205 }];
  if (docket) {
    s.claims.push({ id: 1, window_id: W, class: "mark", claimant: "mari", household: "gh:9000009",
                    slug: MARK, status: "pending", stake: 1, data: {}, submitted_at: "now" });
    s.nextClaimId = 2;
  }
  return s;
}

function door() {
  const charges = [];
  const deps = {
    exists: async () => ({ known: true, exists: true, record: null }),
    ledger: async (p) => { charges.push(p); return { applied: p.n, requested: p.n, clipped: false, balance_before: 48 }; },
    held: async () => ({ liquid: 48, staked: 5 }),
  };
  return { deps, charges };
}

beforeEach(() => { candleOn(); });

// ── 1 · THE DECISION, PURE ─────────────────────────────────────────────────

test("RETIRED + ON THE OPEN DOCKET · no refusal: it is put forward, not returned to your drafts", () => {
  assert.equal(stakeRefusalFor({ mark: MARK, n: 1, promoted: false, status: RETIRED, refused: null, docket: W }), null,
    "postmark#3139: a mark pending on the open docket was told it returned to the drafts");
});

test("RETIRED + ON NO DOCKET · today's 422, word for word", () => {
  const r = stakeRefusalFor({ mark: MARK, n: 1, promoted: false, status: RETIRED, refused: null, docket: null });
  assert.ok(r, "the case the bounce was written for (the 09-16 move) no longer bounces");
  assert.equal(r.code, 422);
  assert.equal(r.defect, NOT_STANDING);
  // and a caller that never passes the fourth input keeps the old answer
  assert.deepEqual(stakeRefusalFor({ mark: MARK, n: 1, promoted: false, status: RETIRED, refused: null }), r);
});

test("THE RELATION · given n ≥ 1, no promotion, no pen refusal and a retired mark, the bounce appears exactly when no docket carries it", () => {
  let bounced = 0, through = 0;
  for (const docket of [null, W, W + 7]) {
    const out = stakeRefusalFor({ mark: MARK, n: 1, promoted: false, status: RETIRED, refused: null, docket });
    assert.equal(out !== null, docket === null, `docket ${docket}: bounce and docket disagree`);
    out ? bounced++ : through++;
  }
  assert.ok(bounced > 0 && through > 0, `one-sided matrix: ${bounced} bounced / ${through} through`);
});

test("THE DOCKET DOES NOT OUTRANK THE PEN · a refused promotion still bounces 409 with a docket present", () => {
  const e = Object.assign(new Error("late"), { name: "LateCrossingError" });
  const r = stakeRefusalFor({ mark: MARK, n: 1, promoted: false, status: RETIRED, refused: e, docket: W });
  assert.equal(r?.code, 409);
});

// ── 2 · THE DOOR, DRIVEN — the real promotion and the real standing read ────

test("MARIGOLD · retired + pending on window 211 + stake 1 → the ledger runs once, one docket row, the answer names 211", async () => {
  const s = marigold();
  const { deps, charges } = door();
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.ok(!out.error, `the stake bounced: ${JSON.stringify(out)}`);
  assert.equal(charges.length, 1, "the ledger did not run exactly once");
  assert.deepEqual({ verb: charges[0].verb, mark: charges[0].mark, n: charges[0].n }, { verb: "stake", mark: MARK, n: 1 },
    "the escrow is keyed on the mark, so +1 on this mark is +1 behind its one claim");
  const rows = s.claims.filter((c) => c.slug === MARK);
  assert.equal(rows.length, 1, "a second claim was filed — the double claim the old hint pointed at");
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].window_id, W, "the claim moved windows");
  assert.equal(rows[0].stake, 1, "the claim row was rewritten; `stake` is the ask and stays the ask");
  assert.equal(out.window, W);
  assert.match(out.effect, /✦1 more stands behind it on window 211's docket/);
  assert.ok(!("put_forward" in out), "this act put nothing forward; it must not say it did");
});

test("MARIGOLD, PREVIEW · the preview agrees with the act and moves nothing", async () => {
  marigold();
  const { deps, charges } = door();
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1, preview: true }, KEY, deps);
  assert.ok(!out.error, `the preview bounced: ${JSON.stringify(out)}`);
  assert.equal(out.preview, true);
  assert.equal(charges.length, 0, "a preview charged the resident");
});

test("RETIRED + NO DOCKET ROW · today's 422 unchanged, and the ledger never runs", async () => {
  marigold({ docket: false });
  const { deps, charges } = door();
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.equal(out.code, 422);
  assert.equal(out.defect, NOT_STANDING);
  assert.equal(charges.length, 0, "the resident was charged for a mark the town no longer stands");
});

test("RETIRED + PENDING ONLY ON A CLOSED WINDOW · the docket means the OPEN one; today's 422", async () => {
  marigold({ closed: true });
  const { deps, charges } = door();
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.equal(out.code, 422);
  assert.equal(charges.length, 0);
});

test("AN ORDINARY STAKE ON A STANDING MARK WITH NO DOCKET ROW · unchanged: no window in the answer", async () => {
  const s = marigold({ docket: false });
  s.marks = [{ slug: MARK, status: "standing", retired_window: null }];
  const { deps, charges } = door();
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1 }, KEY, deps);
  assert.ok(!out.error);
  assert.equal(charges.length, 1);
  assert.ok(!("window" in out) && !("effect" in out), `an ordinary stake grew a docket sentence: ${JSON.stringify(out)}`);
});

test("THE STANDING READ ITSELF · docket_window is the open window's id, or null", async () => {
  const { markStandingStatus } = await import("../src/world2-claims.mjs");
  marigold();
  assert.equal((await markStandingStatus({ slug: MARK })).docket_window, W);
  marigold({ docket: false });
  assert.equal((await markStandingStatus({ slug: MARK })).docket_window, null);
  marigold({ closed: true });
  assert.equal((await markStandingStatus({ slug: MARK })).docket_window, null);
});
