// docket-settled-covers-the-pen.test.mjs — `docketSettled()` must be true about
// the queue the docket's writes actually ride.
//
// ── THE LIVE DEFECT THIS PINS (found on the box, 2026-09-04 night) ──────────
//
// `falsifier-guard-equality.mjs` writes its population through `appendJournal`
// and then waits, with this comment above the wait:
//
//   "THE AWAITED WRITE. `submitClaimFromJournal` is fire-and-forget on a serial
//    queue; reading `claims` before it settles would compare 1.0's finished
//    journal against a docket still being written, and the diff would be timing."
//
//   await docketSettled();
//
// `submitClaimFromJournal` was deleted when the mark lane's private-draft arm
// joined the pen's one queue (C6). The docket's writes ride `world2-pen`'s
// queue now — but `docketSettled()` still handed back `world2-claims`' own
// queue, which nothing enqueues onto and which therefore resolves instantly.
//
// So the falsifier read `claims` before ANY of its population had landed, and
// reported what the comment had promised it would prevent:
//
//   G1_a/G2_a/G4_a compared 0, findings 4/4/5 — "1.0's live layer holds
//   guards-alfa/the-quiet-shed and the port does not — a slug-collision guard
//   reading the port would PERMIT a duplicate"
//
// Nothing was wrong with the port. The diff was timing, exactly as written.
//
// THE CLASS, not the instance: a function named for the docket that knows only
// about a queue the docket abandoned is a false receipt, and every caller of it
// inherits the falsehood. `settleShadowPens` happened to be safe because it
// awaits all three queues by hand; the falsifier was not, and nothing marked
// the difference. So the fix is in `docketSettled()`, not at its call sites.
//
//   node --test --test-reporter=tap test/docket-settled-covers-the-pen.test.mjs

import { registerHooks } from "node:module";
import { join } from "node:path";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "pg") return { url: new URL("./helpers/fake-pen.mjs", import.meta.url).href, shortCircuit: true };
    return next(spec, ctx);
  },
});

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const tmp = mkdtempSync(join(tmpdir(), "postmark-docket-settled-"));
after(() => { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } });

const unflip = () => {
  delete process.env.W2_PEN; delete process.env.WORLD2_PG;
  delete process.env.WORLD2_PG_URL; delete process.env.WORLD2_CANDLE;
};
unflip();
after(unflip);

const { resetStore, theStore } = await import("./helpers/fake-pen.mjs");
const { openDynamic } = await import("../src/dynamic-store.mjs");
const { appendJournal } = await import("../src/world-journal.mjs");
const { docketSettled } = await import("../src/world2-claims.mjs");

let dbn = 0;
const freshDb = () => openDynamic(join(tmp, `docket-${++dbn}.db`));

// The falsifier's own population shape: unstaked declarations (no
// `put_forward`), which is the private-draft arm — the one that moved queues.
const declare = (slug) => ({
  crossing: 999999.5, actor: "guards-alfa", household: "guards-alfa",
  action: "leave-mark", object: `guards-alfa/${slug}`, cls: "mark",
  at: { anchor: "the-town/let-there-be-light", dx: 0, dy: 0 },
  witnesses: { source: "test", list: [] },
  payload: { by: "guards-alfa", slug, kind: "sited", body: "written by the population script", at: { x: 1, y: 1 }, extent: { w: 2, h: 2 } },
  effect: "written by falsifier-guard-equality's population script",
});

beforeEach(() => {
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://fake/pen";
  process.env.WORLD2_CANDLE = "1";
  // The docket write is made slow on purpose. A settle that covers the right
  // queue does not care how slow; one that covers the wrong queue returns
  // before this has finished, which is the whole defect.
  resetStore({
    identities: { "guards-alfa": "gh:9000001" },
    queryDelay: (t) => (/INSERT INTO claims/i.test(t) ? 60 : 0),
  });
});

test("`docketSettled()` does not resolve until the population is ON THE DOCKET", async () => {
  const db = freshDb();
  try {
    // ── AWAITED, BECAUSE THE WRITE IS (G1 / POS-156, RULING 3) ───────────
    //
    // These were fire-and-forget: `appendJournal` queued the docket write and
    // returned, and `docketSettled()` existed to tell a caller when that queue
    // had drained. The write is awaited and refusable now, so the await here is
    // the same discipline one level up -- and `docketSettled()` keeps its job,
    // because the docket's own writes may still have a queue behind them.
    //
    // The claim is untouched: a `docketSettled()` that returns early lets a
    // guard-equality run compare a finished journal against a half-written
    // docket and report the port as holding nothing.
    for (const slug of ["the-quiet-shed", "the-long-fence", "the-lit-window", "the-open-gate"]) {
      await appendJournal(db, declare(slug));
    }
    await docketSettled();

    const landed = theStore().claims.map((c) => c.slug).sort();
    assert.deepEqual(landed, [
      "guards-alfa/the-lit-window", "guards-alfa/the-long-fence",
      "guards-alfa/the-open-gate", "guards-alfa/the-quiet-shed",
    ], "docketSettled() returned before the docket held the population — a guard-equality run here compares "
      + "1.0's finished journal against a docket still being written, and reports the port as holding nothing");
  } finally { db.close(); unflip(); }
});

test("it is awaitable more than once and stays true", async () => {
  const db = freshDb();
  try {
    await appendJournal(db, declare("the-second-look"));
    await docketSettled();
    const first = theStore().claims.length;
    await docketSettled();
    assert.equal(theStore().claims.length, first, "a settled docket does not un-settle");
    assert.equal(first, 1);
  } finally { db.close(); unflip(); }
});
