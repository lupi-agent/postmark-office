// doorstep-rulings-ground.test.mjs — the second axis, through the DOOR.
//
// THE PROMISE, verbatim, from `src/household-apex.mjs § HOUSEHOLD_READS.rulings`
// — a sentence this lane wrote and this lane did not keep:
//
//   "what the last crossings RULED on your things — every mark of yours, AND
//    EVERY MARK LAID OVER GROUND YOU HOLD, that went forward onto the docket or
//    was ruled on."
//
// and the commit that added the door, arguing its own scoping on the same axis:
//
//   "a narrower default hides a housemate's refusal from the house that shares
//    the ground"
//
// ── WHAT WAS WRONG, AND WHY THE PURE TEST COULD NOT SEE IT ────────────────
//
// `test/since-claim-effects.test.mjs` proves `claimEffectsFrom` handles the
// ground axis, by handing it `onMyGround` directly. It passes, and it always
// would have: the PURE function was never the broken half. `doorstepRulings`
// called `readClaimEffects` with no `onMyGround` at all, so the axis died two
// layers above the function that was tested — structurally, in two places:
//
//   `claimRowsSince(since, { claimants, slugs: [] })`  — the rows never left
//                                                        the store
//   `if (!isMine && !onGround) continue`               — and any that did were
//                                                        dropped
//
// So this file tests the DOOR, not the derivation. The first assertion is about
// the ARGUMENTS that reach the store, because that is the half a pure test can
// never reach and the half that was empty.
//
// THE STORE IS A RECORDING STUB, and that is not a shortcut. There is no lab
// store — the box's `world2_dev` is prod — so "which slugs did the door ask
// for" is a question about this office that no database can answer better.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-rulings-ground-"));
after(() => sweep(scratch));

// ── the world in a bottle ───────────────────────────────────────────────────
//
// alpha holds a parcel. beta drops a mark over it — that is alpha's candidate,
// the mark awaiting alpha's word and the one whose refusal alpha is owed.
// delta's is far away and is nobody's business. The geometry module is the
// town's own arithmetic transcribed, the idiom `doorstep-stances.test.mjs`
// established, because overlap is the one thing a falsifier must never answer
// with a second implementation.
const repo = join(scratch, "world");
mkdirSync(repo, { recursive: true });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const OURS = "alpha/the-cairn";                 // alpha's own mark
const THEIRS = "beta/on-alphas-edge";           // beta's, standing on alpha's ground
const ELSEWHERE = "delta/far-away";             // nobody's business

const MARKS = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 }, date: "2026-07-01", body: "the world frame" },
  { id: "alpha/alphas-parcel", by: "alpha", kind: "parcel", at: { x: 100, y: 100 }, extent: { w: 25, h: 25 }, date: "2026-08-01", body: "alpha's ground" },
  { id: OURS, by: "alpha", kind: "sited", at: { x: 104, y: 100 }, extent: { w: 2, h: 2 }, date: "2026-08-05", body: "alpha's own cairn" },
  { id: THEIRS, by: "beta", kind: "sited", at: { x: 112, y: 100 }, extent: { w: 4, h: 4 }, date: "2026-08-10", body: "beta's cairn, half over the line" },
  { id: ELSEWHERE, by: "delta", kind: "sited", at: { x: 9000, y: 9000 }, extent: { w: 4, h: 4 }, date: "2026-08-15", body: "nowhere near anybody" },
];

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
git("config", "user.name", "rulings ground falsifier");
git("add", "-A");
git("commit", "-qm", "canon");

// The environment is set BEFORE the office is imported — `WORLD_CLONE` is a
// module constant fixed when `world-store.mjs` is first evaluated, and ESM
// hoists static imports above the module body. `doorstep-stances.test.mjs`
// carries the same note for the same reason.
process.env.WORLD_CLONE = repo;
process.env.WORLD_DYNAMIC_DB = join(scratch, "dynamic.db");
process.env.WORLD_SINGLE_LOG = "1";
process.env.WORLD_APEX = "1";
// The docket must LOOK configured, or `readClaimEffects` short-circuits at
// `world2Enabled()` and every leg below passes over an empty answer. The URL is
// never dialled: the recording stub is installed as the pool.
const HAD_PG = process.env.WORLD2_PG, HAD_URL = process.env.WORLD2_PG_URL;
process.env.WORLD2_PG = "1";
process.env.WORLD2_PG_URL = "postgres://falsifier@127.0.0.1:1/never-dialled";
after(() => {
  if (HAD_PG === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = HAD_PG;
  if (HAD_URL === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = HAD_URL;
  delete process.env.WORLD_DYNAMIC_DB; delete process.env.WORLD_SINGLE_LOG;
});

const HANDLE = "alpha";
const KEY = { household: "alpha", handles: new Set([HANDLE]) };

// ── the recording stub ──────────────────────────────────────────────────────
//
// It answers the two shapes `claimRowsSince` and `householdKeyForKey` issue and
// records every call, so the assertions can be about what the DOOR asked.
const asked = [];
let ROWS = [];
const stub = {
  async query(text, params) {
    asked.push({ text, params });
    if (/FROM identities/.test(text)) return { rows: [{ household: "gh:alpha" }] };
    if (/FROM claims/.test(text)) {
      const [claimants = [], slugs = []] = params ?? [];
      return { rows: ROWS.filter((r) => claimants.includes(r.claimant) || slugs.includes(r.slug)) };
    }
    return { rows: [] };
  },
  async connect() {
    return { query: stub.query, release() {} };
  },
};

let restorePool = null;
let doorstepRulings, stancesForHandles, HOUSEHOLD_READS, DOORSTEP_SEGMENTS, CROSSING_EPOCH_UTC, CROSSING_MS, currentCrossing;

before(async () => {
  ({ doorstepRulings } = await import("../src/claim-effects.mjs"));
  ({ stancesForHandles } = await import("../src/world-stance.mjs"));
  // THE CANDIDATE LIST READS THE STORE (POS-195, 2026-09-22). This file plants
  // its sketches in the journal and still means the same thing by them; the stub
  // answers the store's query from that same journal, shaped as `claims` rows.
  // Imported HERE rather than at the top, for this file's own stated reason: a
  // static import is hoisted above the env this fixture sets.
  const stanceStub = await import("./stance-pool-stub.mjs");
  Object.assign(process.env, stanceStub.STANCE_ON);
  stanceStub.stancePoolFromJournal(join(scratch, "dynamic.db"));
  ({ HOUSEHOLD_READS } = await import("../src/household-apex.mjs"));
  ({ DOORSTEP_SEGMENTS } = await import("../src/queries.mjs"));
  ({ CROSSING_EPOCH_UTC, CROSSING_MS, currentCrossing } = await import("../src/crossings.mjs"));
  const claims = await import("../src/world2-claims.mjs");
  claims.__setPoolForTest(stub);
  restorePool = () => claims.__setPoolForTest(null);
});

// ⚑ REGISTERED AT MODULE SCOPE, NOT INSIDE `before`. node:test runs an `after`
// hook registered inside a `before` as that hook's own teardown — so the pool
// was handed back the instant it was installed, every leg dialled the real
// (unreachable) URL, and the segment answered `unavailable` while the stub
// recorded nothing. The legs went red for a reason that had nothing to do with
// the defect under test, which is the worst kind of red: one that looks like
// the finding.
after(() => { try { restorePool?.(); } catch { /* module never loaded */ } });

/** A refusal decided inside the segment's own two-crossing window. */
const refusal = (slug, claimant) => {
  const now = currentCrossing();
  const inside = new Date(CROSSING_EPOCH_UTC + (now - 1) * CROSSING_MS + 60_000).toISOString();
  return {
    id: `c-${slug}`, slug, class: "mark", claimant, household: "gh:whoever",
    status: "refused", window_id: 174, submitted_at: inside, decided_at: inside,
    refusal_check: "parcel-overlap: standing parcel \"alpha/alphas-parcel\"",
    stake: 1, supersedes: null,
  };
};

// ── the red control: the fixture really is the shape ───────────────────────

test("RED CONTROL: beta's mark stands on alpha's ground, and delta's does not", async () => {
  const inbox = await stancesForHandles([HANDLE]);
  const ids = new Set([...(inbox?.awaiting ?? []), ...(inbox?.standing ?? [])]
    .map((r) => String(r?.mark ?? r?.id)));
  assert.ok(ids.has(THEIRS), `the consent inbox must hold ${THEIRS} — every assertion below is about that row`);
  assert.ok(!ids.has(ELSEWHERE), "and must not hold a mark nowhere near alpha");
  assert.ok(!ids.has(OURS), "alpha's own mark is not awaiting alpha's word");
});

// ── the half a pure test can never reach: WHAT THE DOOR ASKED FOR ──────────

test("THE DOOR ASKS THE STORE FOR THE GROUND MARKS — `slugs` is not empty", async () => {
  asked.length = 0;
  ROWS = [];
  await doorstepRulings(HANDLE, { key: KEY });

  const claimsCall = asked.find((c) => /FROM claims/.test(c.text));
  assert.ok(claimsCall, "the door must reach the docket at all");
  const [claimants, slugs] = claimsCall.params;
  assert.deepEqual(claimants, [HANDLE], "your own marks, by claimant");
  assert.ok(slugs.includes(THEIRS),
    `slugs was ${JSON.stringify(slugs)} — the rows for a mark on your ground never left the store`);
  assert.ok(!slugs.includes(ELSEWHERE), "and it asks only for ground you actually hold");
});

// ── and the answer a resident reads ────────────────────────────────────────

test("A MARK LAID OVER YOUR GROUND, REFUSED, REACHES THE SEGMENT with on_your_ground: true", async () => {
  ROWS = [refusal(THEIRS, "beta")];
  const seg = await doorstepRulings(HANDLE, { key: KEY });

  const e = (seg.events ?? []).find((x) => x.mark === THEIRS && x.kind === "claim-refused");
  assert.ok(e, `the segment carried ${seg.count} event(s) and none was beta's refusal on alpha's ground`);
  assert.equal(e.on_your_ground, true);
  assert.equal(e.yours, false, "somebody else's mark — the word still means what it means");
  assert.equal(e.cause, "contested", "and the cause arrives in the bulletin's own words");
  assert.match(e.summary, /refused at window 174/);
});

test("your OWN mark still arrives, and is labelled yours", async () => {
  ROWS = [refusal(OURS, HANDLE)];
  const seg = await doorstepRulings(HANDLE, { key: KEY });
  const e = (seg.events ?? []).find((x) => x.mark === OURS);
  assert.ok(e, "the first axis must not have been traded for the second");
  assert.equal(e.yours, true);
  assert.equal(e.on_your_ground, false);
});

test("a refusal on ground you do NOT hold stays out of your morning page", async () => {
  ROWS = [refusal(ELSEWHERE, "delta")];
  const seg = await doorstepRulings(HANDLE, { key: KEY });
  assert.equal(seg.count, 0, "the segment is your backlog, not the town's whole docket");
});

// ── the explicit-zero window ───────────────────────────────────────────────

test("an explicit `crossings: 0` is honoured, not silently turned into 2", async () => {
  const now = currentCrossing();
  const zero = await doorstepRulings(HANDLE, { key: KEY, sinceCrossings: 0 });
  assert.equal(zero.since_crossing, now,
    "`|| 2` turned a lawful zero-width window into a two-crossing one, after household-apex had already let 0 through its Number.isFinite guard");
  assert.equal(zero.through_crossing, now);

  const two = await doorstepRulings(HANDLE, { key: KEY });
  assert.equal(two.since_crossing, now - 2, "and the default is unchanged");
});

test("a nonsense window falls back to the default rather than throwing out of a morning page", async () => {
  const now = currentCrossing();
  for (const bad of ["nonsense", NaN, -5, undefined]) {
    const seg = await doorstepRulings(HANDLE, { key: KEY, sinceCrossings: bad });
    assert.equal(seg.since_crossing, now - 2, `\`${String(bad)}\` must not move the window`);
  }
});

// ── the door's own words, and the manifest ─────────────────────────────────

// The read and the segment are `outcomes` since POS-70 (Keemin, 2026-09-17);
// the promise moved with the name, and `rulings` is a one-cycle pointer.
test("the door still PROMISES the axis it now delivers, and the manifest names it", () => {
  assert.match(HOUSEHOLD_READS.outcomes, /every mark laid over ground you hold/,
    "if this promise is ever withdrawn, the wiring above should go with it");
  assert.ok(DOORSTEP_SEGMENTS.includes("outcomes"));
  assert.ok(!DOORSTEP_SEGMENTS.includes("crossings"),
    "renamed 2026-09-07: the segment answers a settlement question and must not spend the ferry's word");
});
