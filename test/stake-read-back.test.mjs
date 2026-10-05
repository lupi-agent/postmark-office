// stake-read-back.test.mjs — a stake's receipt says where it reads back and
// when, and the stakes read says how old its escrow is (POS-412).
//
// Reported by mari, 2026-10-05 (the town bug post
// mari/stake-commit-receipt-claims-success-while-read-backs-show-no): a ✦1
// stake on mari/marigold-house returned applied 1, escrow 2 → 3, and a minute
// later the stakes read said 2 and the doorstep said 122. The stake had landed
// (town 31efde4, on main before the answer). The reads were behind: the stakes
// read's escrow is the store's copy of the ledger, which only the clearing
// takes (06:00/18:00Z), and the doorstep reads the office's index. So the
// receipt read as false, and mari rightly held back from staking again.
//
// The fix is disclosure: the receipt names the read that shows it now and when
// the others catch up, and the stakes read carries when its copy was taken.
// Reading back within one read is POS-341 (the ledger's lines in the store).
//
// The lag itself is reproduced on the suite's real store: a head ingested at
// 06:00Z, a stake on the ledger at 17:17Z, and the stakes read at 17:18Z.

import { registerHooks } from "node:module";

const FAKE_PEN = new URL("./helpers/fake-pen.mjs", import.meta.url).href;
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === "pg" && ctx.parentURL?.includes("/src/")) return { url: FAKE_PEN, shortCircuit: true };
    return next(spec, ctx);
  },
});

import test, { after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { startStore, NO_STORE } from "./helpers/embedded-store.mjs";

delete process.env.TOWN_PUSH;
const { stakeReadBack, worldStakeViaOffice } = await import("../src/world-stake.mjs");
const { stakesFor, LATER_STAKES } = await import("../src/doorstep-stakes.mjs");
const { docketEscrow } = await import("../src/world2-serve.mjs");

const MARK = "mari/marigold-house";
const COMMIT = "31efde414d0a1dac24e82e219bc816a9ca8e5cba";
const STAKED_AT = new Date("2026-10-05T17:17:31Z");
const READ_AT = new Date("2026-10-05T17:18:08Z");
const MORNING_HEAD = "a95ffe06ab306e0e335ecd87ff4fec5d3a200135";
const MORNING_INGEST = "2026-10-05T06:00:19.305Z";
const KEY = { handles: new Set(["mari"]), household: "gh:67605380" };

// ── the receipt ─────────────────────────────────────────────────────────────

test("THE RECEIPT'S read_back · names the commit, the read that shows it now, and when the stakes read catches up", () => {
  const rb = stakeReadBack({ mark: MARK, commit: COMMIT, pushed: true, now: STAKED_AT });
  assert.match(rb.landed, new RegExp(`commit ${COMMIT} is on town main`));
  assert.equal(rb.now.read, `world { read: "stake", args: { mark: "${MARK}" } }`);
  assert.equal(rb.stakes.shows_it_after, "2026-10-05T18:00:00.000Z",
    "a stake at 17:17Z reaches the store's copy at the 18:00Z clearing");
  assert.match(rb.stakes.read, /household \{ read: "stakes" \}/);
  assert.match(rb.stamps.read, /the doorstep/);
  assert.match(rb.until_then, /Staking again would stake twice/);
});

test("THE RECEIPT'S read_back · says 'on town main' only when the commit was checked against it (TOWN_PUSH)", () => {
  const local = stakeReadBack({ mark: MARK, commit: COMMIT, pushed: false, now: STAKED_AT });
  assert.doesNotMatch(local.landed, /on town main/);
  assert.match(local.landed, /does not push/);
  assert.equal(stakeReadBack({ mark: MARK, commit: null }), null, "nothing moved, nothing to read back");
});

const door = (applied) => ({
  exists: async () => ({ known: true, exists: true, record: null }),
  promote: async () => ({ promoted: false }),
  standing: async () => ({ known: false }),
  held: async () => ({ liquid: 122, staked: 13 }),
  ledger: async (p) => ({ verb: "stake", handle: p.handle, mark: p.mark, applied, requested: p.n, clipped: applied < p.n,
    balance_before: 122, balance_after: 122 - applied, mark_escrow_before: 2, mark_escrow_after: 2 + applied,
    ...(applied > 0 ? { commit: COMMIT } : {}) }),
});

test("MARI'S STAKE · the act's answer carries read_back beside the numbers mari read", async () => {
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1, handle: "mari" }, KEY, door(1));
  assert.ok(!out.error, JSON.stringify(out).slice(0, 300));
  assert.equal(out.applied, 1);
  assert.equal(out.mark_escrow_after, 3);
  assert.ok(out.read_back, "the receipt says nothing about where it reads back — the gap mari fell into");
  assert.match(out.read_back.landed, new RegExp(COMMIT));
  assert.equal(out.read_back.now.read, `world { read: "stake", args: { mark: "${MARK}" } }`);
});

test("A STAKE THAT MOVED NOTHING · no read_back, because there is nothing to read back", async () => {
  const out = await worldStakeViaOffice({ mark: MARK, stamps: 1, handle: "mari" }, KEY, door(0));
  assert.ok(!out.error, JSON.stringify(out).slice(0, 300));
  assert.equal(out.read_back, undefined);
});

// ── the stakes read, on the real store ──────────────────────────────────────

let store = null, skip = false; // false, not null: node:test reads a null skip as a skip
try { store = await startStore({ db: "stake_read_back_test" }); }
catch (e) { if (String(e?.message ?? e).startsWith(NO_STORE)) skip = String(e.message); else throw e; }
after(async () => { if (store) await store.stop(); });

test("THE LAG, REPRODUCED · a stake on the ledger after the morning ingest reads 2 here until the next clearing, and the read says so", { skip }, async () => {
  const su = await store.connect("postgres");
  try {
    // The store as it stood at 17:18Z: the town head ingested at 06:00Z, with
    // mari's two stamps on the mark. The 17:17Z stake is on the ledger only.
    await su.query("DELETE FROM projection_heads WHERE repo = 'town'");
    await su.query("INSERT INTO projection_heads (repo, sha, ingested_at) VALUES ('town', $1, $2)", [MORNING_HEAD, MORNING_INGEST]);
    await su.query(`INSERT INTO escrow_projection (town_sha, mark, holder, household, own_household, n, weight_k)
                    VALUES ($1, $2, 'mari', 'gh:67605380', 'gh:67605380', 2, 0)`, [MORNING_HEAD, MARK]);
  } finally { await su.end(); }

  const p = new pg.Pool({ connectionString: store.url("office_api"), max: 1 });
  try {
    const esc = await docketEscrow(p);
    assert.equal(esc.townSha, MORNING_HEAD);
    assert.equal(esc.ingestedAt, MORNING_INGEST, "the escrow reader does not say when its copy was taken");

    const seg = await stakesFor(["mari"], {
      world: async () => ({ state: { marks: [{ id: MARK, by: "mari", kind: "sited" }] }, ref: "main" }),
      registry: async () => ({ [MARK]: { class: "commons" } }),
      escrow: async () => esc,
      now: READ_AT,
    });
    assert.equal(seg.rows[0].escrow, 2, "the lag itself: the store's copy predates the stake");
    assert.equal(seg.escrow_ingested_at, MORNING_INGEST);
    assert.equal(seg.catches_up_at, "2026-10-05T18:00:00.000Z");
    assert.equal(seg.later_stakes, LATER_STAKES);
    assert.match(seg.later_stakes, /world \{ read: "stake"/, "it points at the read that shows the stake now");
  } finally { await p.end(); }
});

test("THE STAKES READ WITH NO WORLD · still says how old its escrow is and when it catches up", async () => {
  const seg = await stakesFor(["mari"], { world: async () => { throw new Error("down"); }, now: READ_AT });
  assert.equal(seg.escrow_ingested_at, null);
  assert.equal(seg.catches_up_at, "2026-10-05T18:00:00.000Z");
  assert.equal(seg.later_stakes, LATER_STAKES);
});
