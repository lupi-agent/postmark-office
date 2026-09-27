// hold-wirings.test.mjs — THE THREE CALL SITES NOBODY WAS WATCHING.
//
// Repair 4, and it is this lane's own lesson finished rather than learned
// again. On its first flip run the lane found F6: deleting the one line that
// puts hold events on the `since:` shelf reddened NOTHING, because five tests
// watched the deriver and none watched the wiring. It fixed that one site and
// did not carry the method to the other three. The reviewer ran the deletions
// and all three were silent:
//
//   · `groundWithinReach`            — no test names it at all
//   · apex `readHoldEffects` → `happenedBlock` — every reference in the suite
//                                      is the pure deriver or hand-injected events
//   · `thingStandsBlock` on `world_investigate` — never driven
//
// Each probe below drives the REAL function against a temp store, in the shape
// of this lane's two door probes and `test/arena.test.mjs`'s hold-door leg.
// Delete the call site each names and one of these reds.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const TMP = mkdtempSync(join(tmpdir(), "hold-wirings-"));
test.after(() => { try { rmSync(TMP, { recursive: true, force: true }); } catch { /* windows holds it a beat */ } });

const NEAR = "wright/a-thing-underfoot";
const FAR = "wright/a-thing-across-town";

/** A world store with two things: one at the caller's feet, one 900 m off. */
async function storeWithThings(file) {
  const { SCHEMA } = await import("../src/world-store.mjs");
  const path = join(TMP, file);
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT INTO meta VALUES (?, ?)");
  meta.run("hydration_status", "OK");
  meta.run("as_of_world", "f00dcafe");
  const node = db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props) VALUES (?,?,?,?,?,?,?,?,?,?)");
  node.run(NEAR, "mark", "sited", "market", "wright", 0, 0, 1, 1, JSON.stringify({ class: "thing", body: "A trued try-square." }));
  node.run(FAR, "mark", "sited", "market", "wright", 900, 0, 1, 1, JSON.stringify({ class: "thing", body: "A thing across town." }));
  db.close();
  return path;
}

/** Run `fn` with the store and dynamic env pointed at a fresh temp pair. */
async function withStore(file, fn) {
  const prev = { store: process.env.WORLD_STORE_DB, dyn: process.env.WORLD_DYNAMIC_DB };
  const dir = mkdtempSync(join(TMP, "run-"));
  process.env.WORLD_STORE_DB = await storeWithThings(file);
  process.env.WORLD_DYNAMIC_DB = join(dir, "dynamic.db");
  try { return await fn(); }
  finally {
    for (const [k, v] of [["WORLD_STORE_DB", prev.store], ["WORLD_DYNAMIC_DB", prev.dyn]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

// ── THE RECORD, AS A CLIENT (POS-153) ───────────────────────────────────────
//
// The three readers below read `acts` now, not the sqlite journal, so a probe
// that writes a journal row and asks for it back is asking the wrong store.
// `useGuardReader` is the seam world2-guards.mjs already exposes for exactly
// this ("test/world2-guard-doors.test.mjs hands in a hand-built client"), and
// it stands in for `officeRead` — so nothing here dials Postgres, and the road
// under test is the real one from `storeHoldingRows` down to the port's SQL.

/** An `acts` row as the pg driver hands it over: `at` a Date, `jsonb` parsed. */
const act = ({ id, at, crossing = null, actor, action, object = null, payload = null,
               cls = "holding", anchor = null, dx = null, dy = null }) => ({
  id, at: new Date(at), crossing, actor, action, object,
  at_anchor: anchor, at_dx: dx, at_dy: dy, witnesses: null,
  class: cls, payload, effect: null, household: null,
});

/**
 * A give/drop/take act, in `holdingEntry`'s own payload shape.
 *
 * `previous_holder` is DERIVED, not defaulted to null, because the door derives
 * it: `declareHolding` sets `previous_holder: holder` (whoever held it before),
 * and it refuses a give or a drop from anybody who is not already the holder —
 * so for those two the previous holder IS the actor. A take comes off the
 * ground and has none. A fixture that left it null would silently strip the
 * `from_you` face off every event, and the shelf's whole job is saying which
 * way a thing moved.
 */
const holdAct = (id, at, crossing, actor, did, thing, holder, previous = undefined) => act({
  id, at, crossing, actor, action: did, object: thing,
  payload: {
    thing, holder,
    previous_holder: previous !== undefined ? previous : (did === "take" ? null : actor),
    made_by: String(thing).split("/")[0],
    policy: did === "drop" ? "detach" : "cascade",
  },
});

/**
 * A stand-in client over a hand-built `acts` table.
 *
 * It answers the two queries the port issues and NOTHING else, so a third query
 * appearing under these readers shows up as an empty answer rather than as a
 * quietly-passing fixture. `asked` is the receipt: a probe that asserts about a
 * query must first assert the query HAPPENED (POS-152 — a spy read without the
 * call having been issued proves nothing either way).
 */
function recordOf(acts = []) {
  const asked = [];
  const byTime = (a, b) => (a.at - b.at) || (a.id - b.id);
  const client = {
    query: async (sql, params) => {
      const text = String(sql).replace(/\s+/g, " ").trim();
      asked.push({ sql: text, params });
      if (/FROM acts WHERE class = \$1/.test(text)) {
        let rows = acts.filter((a) => a.class === params[0]);
        // The bounds the port pushes, applied here so the fixture cannot make a
        // pushed clause look free.
        for (let i = 1; i < params.length; i += 1) {
          const clause = text.includes(`crossing >= $${i + 1}`) ? ">=" : text.includes(`crossing <= $${i + 1}`) ? "<=" : null;
          if (clause === ">=") rows = rows.filter((a) => a.crossing != null && a.crossing >= params[i]);
          if (clause === "<=") rows = rows.filter((a) => a.crossing != null && a.crossing <= params[i]);
        }
        return { rows: rows.sort(byTime) };
      }
      if (/FROM acts WHERE action = ANY\(\$1\)/.test(text)) {
        const rows = acts.filter((a) => params[0].includes(a.action)).sort(byTime);
        return { rows };
      }
      return { rows: [] };
    },
  };
  return { asked, client };
}

/** Run `fn` with the record standing in for the office's, and the env that says there IS one. */
async function withRecord(acts, fn) {
  const guards = await import("../src/world2-guards.mjs");
  const prev = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://the-reader-override-never-dials-this";
  const rec = recordOf(acts);
  const undo = guards.useGuardReader(async (run) => run(rec.client));
  try { return await fn(rec); }
  finally {
    undo();
    for (const [k, v] of [["WORLD2_PG", prev.pg], ["WORLD2_PG_URL", prev.url]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

/** Run `fn` with a record that REFUSES every read — finding 5's third condition. */
async function withRefusingRecord(fn) {
  const guards = await import("../src/world2-guards.mjs");
  const prev = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://the-reader-override-never-dials-this";
  const undo = guards.useGuardReader(async () => { throw new Error("the record refused the connection"); });
  try { return await fn(); }
  finally {
    undo();
    for (const [k, v] of [["WORLD2_PG", prev.pg], ["WORLD2_PG_URL", prev.url]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

// ── WIRING 1 · `read: "take"` reaches `groundWithinReach` ────────────────────

test("WIRING 1 — the ground read is REACHED, and answers about the ground under the caller", async () => {
  await withStore("ground.db", async () => {
    const { groundWithinReach } = await import("../src/world-apex.mjs");
    const answer = await groundWithinReach({ standpoint: { x: 0, y: 0, handle: "wright" } }, { handles: new Set(["wright"]) });
    assert.ok(!answer.unavailable, `the ground read was unavailable: ${answer.unavailable}`);
    const ids = (answer.things ?? []).map((t) => t.thing);
    assert.ok(ids.includes(NEAR), "a thing at the caller's feet is not in the ground read");
    assert.equal(ids.includes(FAR), false, "a thing 900 m off is underfoot to nobody");
    const row = answer.things.find((t) => t.thing === NEAR);
    assert.equal(row.takeable, true, "standing on it, the door admits — and Repair 2 says this read must agree");
    assert.equal(row.distance_m, 0);
    assert.ok(answer.reading_law, "the read must carry its own law, as every other read does");
  });
});

test("...and the take SHADOW carries the ground through — driven, so a discarded answer cannot hide", async () => {
  // ⛔ THIS REPLACED A SOURCE-TEXT DETECTOR, and the reviewer showed exactly
  // why. A grep for `groundWithinReach(` proves the call is WRITTEN; it cannot
  // tell "called" from "called and thrown away". The reviewer kept the call and
  // discarded its answer — `ground: ((await groundWithinReach(oriented, key)),
  // null)` — and all six probes stayed green while `read: "take"` answered
  // `ground: null`. The only check that sees that is one which reads what the
  // shadow RETURNS. So this drives `readDomainFor` itself.
  await withStore("shadow.db", async () => {
    const { readDomainFor } = await import("../src/world-apex.mjs");
    const oriented = { standpoint: { x: 0, y: 0, handle: "wright" } };
    const key = { handles: new Set(["wright"]) };
    const domain = await readDomainFor("take", {}, key, oriented, {});

    assert.ok(domain, "the take shadow answered nothing at all");
    assert.ok(domain.ground, "read: \"take\" answered no ground — walk #12 asked for the ground and this is the answer that carries it");
    assert.ok(!domain.ground.unavailable, `the ground read was unavailable: ${domain.ground.unavailable}`);
    const ids = (domain.ground.things ?? []).map((t) => t.thing);
    assert.ok(ids.includes(NEAR), "the thing at the caller's feet did not reach the shadow's answer");
    assert.equal(ids.includes(FAR), false, "and a thing 900 m off must not");
    // give/drop keep their holdings-only domain, so the shadow must still carry
    // the hands beside the ground rather than having swapped one for the other.
    assert.ok(domain.holdings, "the take shadow lost the caller's own hands");
  });
});

test("...and give/drop are UNCHANGED — their domain is your hands, and only take grew a ground", async () => {
  await withStore("shadow-give.db", async () => {
    const { readDomainFor } = await import("../src/world-apex.mjs");
    const oriented = { standpoint: { x: 0, y: 0, handle: "wright" } };
    const key = { handles: new Set(["wright"]) };
    for (const verb of ["give", "drop"]) {
      const domain = await readDomainFor(verb, {}, key, oriented, {});
      assert.ok(domain.holdings, `read: "${verb}" lost the caller's hands`);
      assert.equal(domain.ground, undefined,
        `read: "${verb}" grew a ground block — those two verbs act on what you hold, so your hands are their whole domain`);
    }
  });
});

// ── WIRING 2 · the apex joins hold effects onto the `since:` shelf ───────────

test("WIRING 2 — `readHoldEffects` reads the RECORD the office actually writes", async () => {
  // ⛔ THIS PROBE USED TO WRITE A JOURNAL ROW. POS-153 deleted the sqlite read,
  // and it deleted it because the journal was never the record for a holding:
  // before the hold lane's pen flipped a give took NO journal row at all
  // (world-journal.mjs § THE LANE HOOK), and after it the row is the reverse
  // mirror's best-effort copy that `world-drain.mjs` then truncates. So the
  // probe now plants the act where the office puts it.
  await withRecord(
    [holdAct(11, "2026-09-07T13:57:16Z", 175, "wright", "give", NEAR, "ethan-thorne")],
    async (rec) => {
      const { readHoldEffects } = await import("../src/world-hold.mjs");
      const out = await readHoldEffects({ handles: ["wright"], sinceCrossing: 175, nowCrossing: 175 });
      assert.equal(out.readable, true, `the holding record was unreadable: ${out.reason}`);
      assert.equal(out.events.length, 1, "a give written to the record did not come back out of it");
      assert.equal(out.events[0].kind, "hold-give");
      assert.equal(out.events[0].thing, NEAR);
      assert.equal(out.events[0].from_you, true, "it left wright's hands and the shelf must say which way");
      // The call happened, and it was the class-keyed query. Asserted BEFORE
      // anything about its result, so a fixture that answered nothing cannot
      // read as a fixture that answered correctly.
      const holding = rec.asked.filter((a) => /FROM acts WHERE class = \$1/.test(a.sql));
      assert.equal(holding.length, 1, `the holding shelf issued ${holding.length} class-keyed reads, not 1`);
      assert.equal(holding[0].params[0], "holding", "the read must be keyed on the journal's own class word");
      assert.match(holding[0].sql, /ORDER BY acts\.at, acts\.id/,
        "the order is D6's `(at, id)` — `journal_seq` is NULL for the whole flipped era and would heap it");
      assert.doesNotMatch(holding[0].sql, /journal_seq/, "the pairing key is not an order and must not appear here");
    });
});

test("...and the `since:` bound is PUSHED, and only when it is a number", async () => {
  // The equality the port's guard exists for: `holdEffectsFrom` is called with
  // `sinceCrossing` undefined on every read with no cursor, and `c < undefined`
  // filters nothing — while `crossing >= NULL` in SQL matches nothing at all.
  // A bound pushed unconditionally would empty the commonest read.
  const rows = [
    holdAct(1, "2026-09-01T00:00:00Z", 150, "wright", "give", NEAR, "ethan-thorne"),
    holdAct(2, "2026-09-07T13:57:16Z", 175, "ethan-thorne", "give", NEAR, "wright"),
  ];
  await withRecord(rows, async (rec) => {
    const { readHoldEffects } = await import("../src/world-hold.mjs?bounds");
    const scoped = await readHoldEffects({ handles: ["wright"], sinceCrossing: 170, nowCrossing: 180 });
    assert.deepEqual(scoped.events.map((e) => e.crossing), [175],
      "the earlier give is outside the cursor and must not come back");
    const sql = rec.asked.at(-1).sql;
    assert.match(sql, /crossing >= \$2/, "a finite `since` belongs in the query, not only in the JS filter");
    assert.match(sql, /crossing <= \$3/, "and so does a finite `until`");
  });
  await withRecord(rows, async (rec) => {
    const { readHoldEffects } = await import("../src/world-hold.mjs?unbounded");
    const open = await readHoldEffects({ handles: ["wright"] });
    assert.equal(open.readable, true, `the unbounded read was unreadable: ${open.reason}`);
    assert.equal(open.events.length, 2,
      "with no cursor every event stands — an unconditionally-pushed bound would have emptied this");
    assert.doesNotMatch(rec.asked.at(-1).sql, /crossing [<>]=/,
      "an undefined cursor must push NO clause; `crossing >= NULL` matches nothing");
  });
});

test("...and the `since:` shelf CARRIES the hold event — driven through happenedFor, not read off the source", async () => {
  // The same replacement, for the same reason: a grep proves `holdEffects` is
  // passed; it cannot prove the events arrive. This drives the whole join —
  // journal row in, `happened.to_you` out.
  const prev = { dyn: process.env.WORLD_DYNAMIC_DB, mv2: process.env.WORLD_MOVEMENT_V2 };
  const dir = mkdtempSync(join(TMP, "shelf-"));
  process.env.WORLD_DYNAMIC_DB = join(dir, "dynamic.db");
  // `happenedFor` answers null with the flag off, which is dev's own condition
  // for a store-written position (src/world.mjs § THE WALK GAP).
  process.env.WORLD_MOVEMENT_V2 = "1";
  // ⚑ THE DOCKET NEEDS A FIXTURE TOO, AND ONLY BECAUSE THIS PROBE TURNS THE
  // RECORD ON. `readClaimEffects` answers `readable: true` with no events when
  // `world2Enabled()` is false ("there is no docket, so there is nothing about
  // it to be incomplete") and reaches for Postgres the moment it is true. The
  // hold half's fixture flips that flag, so without this the OTHER source fails
  // and `complete` goes false for a reason that has nothing to do with the
  // thing under test. A stub that answers no rows keeps the docket's own
  // promise intact and leaves the hold half the only moving part.
  const claims = await import("../src/world2-claims.mjs");
  claims.__setPoolForTest({ query: async () => ({ rows: [] }), connect: async () => ({
    query: async () => ({ rows: [] }), release: () => {},
  }) });
  try {
    const { currentCrossing } = await import("../src/crossings.mjs");
    const now = currentCrossing();
    // The give is planted in the RECORD (POS-153), which is where the office
    // writes it and where this shelf now reads it.
    await withRecord(
      [holdAct(21, new Date().toISOString(), now, "wright", "give", NEAR, "ethan-thorne")],
      async () => {
        const { happenedFor } = await import("../src/world-apex.mjs");
        const oriented = { standpoint: { x: 0, y: 0, handle: "wright" }, crossing: { n: now } };
        const block = await happenedFor(oriented, { since: now }, { handles: new Set(["wright"]) });

        assert.ok(block, "the happened path answered nothing — the cursor read is off");
        assert.ok(!block.unavailable, `the delta could not be read: ${block.detail ?? block.unavailable}`);
        const kinds = (block.to_you?.events ?? []).map((e) => e.kind);
        assert.ok(kinds.includes("hold-give"),
          `a give of a thing of mine did not reach happened.to_you (${JSON.stringify(kinds)}) — walk #11's certified zero, back`);
        const ev = block.to_you.events.find((e) => e.kind === "hold-give");
        assert.equal(ev.thing, NEAR);
        assert.equal(ev.from_you, true, "it left wright's hands, and the shelf must say which way");
        assert.equal(block.to_you.complete, true, "every source answered, so the promise is kept");
      });
  } finally {
    claims.__setPoolForTest(null);
    for (const [k, v] of [["WORLD_DYNAMIC_DB", prev.dyn], ["WORLD_MOVEMENT_V2", prev.mv2]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

// ── WIRING 3 · `world_investigate` carries the `stands` block ────────────────

test("WIRING 3 — `world_investigate` itself carries the `stands` block, driven end to end", async () => {
  // THE REAL DOOR, on a REAL canon mark. The temp world store cannot serve this
  // one: `worldInvestigate` folds canon out of WORLD_CLONE, not `world.db`, so
  // a fixture id would answer "no mark" and never reach the block. So the probe
  // takes a thing that genuinely stands in canon, puts a holding edge for it in
  // front of the door, and asks the focus.
  //
  // ⚑ THE HOLDING EDGE MOVED STORES (POS-162). This probe wrote a
  // `declareAttachment` into a temp `dynamic.db` until 2026-09-21, and that is
  // the read the block no longer makes: both halves come from `acts` now, with
  // no flag and no sqlite under them. The CLAIM is unchanged — the wiring is
  // driven, not the deriver — and only the record the fixture writes to moved.
  // The store legs live in `test/investigate-stands-reads-the-store.test.mjs`.
  const { holdingAct, withActs } = await import("./stands-store-fixture.mjs");
  const { worldMarkById, worldInvestigate } = await import("../src/world.mjs");
  const CANON = "quill-stem/candle-for-the-trail";
  const { mark } = await worldMarkById(CANON);
  assert.ok(mark, `${CANON} must stand in canon for this probe to mean anything`);

  // Before: no holding edge anywhere, so the block is ABSENT and the focus is
  // exactly what it always was. This is the "additive, and absent is the
  // default" claim, driven rather than asserted.
  const before = await withActs([], () => worldInvestigate({ mark: CANON }));
  assert.ok(!before.error, `the focus bounced: ${before.defect}`);
  assert.equal(before.stands, undefined,
    "a mark nobody has ever held must answer byte-for-byte what it answered before this lane");

  // Now somebody holds it.
  const after = await withActs(
    [holdingAct({ id: 1, at: "2026-09-07T21:53:00Z", actor: "wright", action: "take", thing: CANON, holder: "wright" })],
    () => worldInvestigate({ mark: CANON }));
  assert.ok(after.stands, "the holding record knows this thing and the focus does not — walk #12's 536 m, back");
  assert.equal(after.stands.source, "holder");
  assert.equal(after.stands.holder, "wright");
  assert.match(String(after.stands.says), /rides its holder/);
  // AND `at` IS UNTOUCHED. The block sits BESIDE canon's own answer; quietly
  // substituting one for the other is the complaint, not the repair.
  assert.deepEqual(after.at, before.at, "canon's own `at` must not be rewritten by the derived read");
});

test("...and the three sources answer in the law's own order", async () => {
  // The deriver's contract, on hand-built rows: holder first, set-down second,
  // canon's fold only when neither speaks.
  const hold = await import("../src/world-hold.mjs");
  const held = await hold.whereThingStands(NEAR, {
    attachments: [{ target: NEAR, entity: "rei", policy: "cascade", born_at: "2026-09-07T01:00:00Z" }],
    journal: [{ seq: 1, object: NEAR, action: "drop", actor: "wright", class: "holding", at: { anchor: null, dx: 5, dy: 5 } }],
    fold: { x: 900, y: 0 },
    standpointOf: async () => ({ x: 1, y: 2 }),
  });
  assert.equal(held.source, "holder", "a holder outranks a drop act and the fold both");
  assert.deepEqual(held.where, { x: 1, y: 2 });

  const down = await hold.whereThingStands(NEAR, {
    attachments: [{ target: NEAR, entity: "wright", policy: "detach", born_at: "2026-09-07T02:00:00Z" }],
    journal: [{ seq: 1, object: NEAR, action: "drop", actor: "wright", class: "holding", at: { anchor: null, dx: 5, dy: 5 } }],
    fold: { x: 900, y: 0 },
  });
  assert.equal(down.source, "set-down", "a drop act outranks the fold");
  assert.deepEqual(down.where, { x: 5, y: 5 });
});

// ═════════════════════════════════════════════════════════════════════════════
// POS-153 · THE THREE READERS READ THE STORE
// ═════════════════════════════════════════════════════════════════════════════
//
// Four falsifiers, each able to express the failure it is about. The three
// readers no longer open sqlite at all, so every one of these reds if a reader
// is put back on the journal — and (d) is the one that holds the ANSWERS
// steady, because a port that changed what "I cannot read the record" sounds
// like would have moved a promise the doors above depend on.

test("POS-153 (a) — a thing held by ANOTHER resident is listed UNDER ITS HOLDER, from the record", async () => {
  await withStore("pos153-a.db", async () => {
    // ethan holds the thing at wright's feet. `whereThingStands` answers
    // `holder`, and the row carries the door's own refusal rather than dropping
    // the thing: "she is holding it" is an answer, an absence is not.
    await withRecord(
      [holdAct(31, "2026-09-07T10:00:00Z", 175, "wright", "give", NEAR, "ethan-thorne")],
      async (rec) => {
        const { groundWithinReach } = await import("../src/world-apex.mjs?pos153a");
        const answer = await groundWithinReach(
          { standpoint: { x: 0, y: 0, handle: "wright" } }, { handles: new Set(["wright"]) });
        assert.ok(!answer.unavailable, `the ground read was unavailable: ${answer.unavailable}`);
        // The edge query HAPPENED — asserted before anything about its answer.
        assert.ok(rec.asked.some((a) => /FROM acts WHERE action = ANY\(\$1\)/.test(a.sql)),
          "the ground read never asked the record for the holding edge");
        const row = (answer.things ?? []).find((t) => t.thing === NEAR);
        assert.ok(row, "a thing at the caller's feet is not in the ground read");
        assert.equal(row.holder, "ethan-thorne", "the record says ethan holds it and the read must say so too");
        assert.equal(row.takeable, false, "a held thing moves by its holder's own give");
        assert.match(String(row.why), /holding it/);
      });
  });
});

test("POS-153 (a2) — a DROP older than any drain still places the thing where it was set down", async () => {
  // The recovery this port is for. The journal is truncated at every drain, so
  // a set-down from before the last one was simply not there and the thing
  // answered from canon's fold — walk #12's three kilometres. `acts` is never
  // truncated, and the drop is still the answer.
  await withStore("pos153-a2.db", async () => {
    await withRecord(
      [act({ id: 41, at: "2026-08-01T09:00:00Z", crossing: 100, actor: "wright", action: "drop",
             object: FAR, dx: 3, dy: 4,
             payload: { thing: FAR, holder: null, previous_holder: "wright",
                        made_by: "wright", policy: "detach" } })],
      async () => {
        const { groundWithinReach } = await import("../src/world-apex.mjs?pos153a2");
        const answer = await groundWithinReach(
          { standpoint: { x: 0, y: 0, handle: "wright" } }, { handles: new Set(["wright"]) });
        assert.ok(!answer.unavailable, `the ground read was unavailable: ${answer.unavailable}`);
        const row = (answer.things ?? []).find((t) => t.thing === FAR);
        assert.ok(row, "a thing set down at the caller's feet is 900 m away only to the FOLD — the drop is the answer");
        assert.equal(row.place_from, "set-down", "the drop act is where it stands, not canon's last fold");
        assert.deepEqual(row.stands_at, { x: 3, y: 4 });
      });
  });
});

test("POS-153 (b) — `holdingsFor` lists a resident's things IN THE ORDER TAKEN, from the record", async () => {
  await withRecord(
    [
      holdAct(51, "2026-09-01T09:00:00Z", 150, "wright", "take", NEAR, "wright"),
      holdAct(52, "2026-09-02T09:00:00Z", 151, "wright", "take", FAR, "wright"),
    ],
    async (rec) => {
      const { holdingsFor } = await import("../src/world-apex.mjs?pos153b");
      const held = await holdingsFor({ handle: "wright" }, { handles: new Set(["wright"]) });
      assert.deepEqual(held, [NEAR, FAR],
        "the order is the order they were taken in — `holdingsOf` reads the reader's own order and the port must supply it");
      assert.ok(rec.asked.some((a) => /FROM acts WHERE action = ANY\(\$1\)/.test(a.sql)),
        "`holdingsFor` never asked the record");
    });

  // The other pole, without which the list above could be a constant: a
  // resident who gave one away is holding one thing, not two.
  await withRecord(
    [
      holdAct(61, "2026-09-01T09:00:00Z", 150, "wright", "take", NEAR, "wright"),
      holdAct(62, "2026-09-02T09:00:00Z", 151, "wright", "take", FAR, "wright"),
      holdAct(63, "2026-09-03T09:00:00Z", 152, "wright", "give", NEAR, "ethan-thorne"),
    ],
    async () => {
      const { holdingsFor } = await import("../src/world-apex.mjs?pos153b2");
      const held = await holdingsFor({ handle: "wright" }, { handles: new Set(["wright"]) });
      assert.deepEqual(held, [FAR], "latest wins — the thing wright gave away is ethan's now");
    });
});

test("POS-153 (b2) — the three call sites AWAIT it, pinned as source text", async () => {
  // ⛔ THE UN-AWAITED FORM IS SILENT AND THIS IS THE ONLY THING THAT SEES IT.
  // `holdingsFor` was synchronous until POS-153. `gatherHeldActions(db, <a
  // Promise>)` reads `!holding.length` as `!undefined`, returns `{entries: [],
  // rows: []}`, and the caller ships "you are holding nothing" with every
  // behavioural assertion in this file still green — because none of them go
  // through `apexRead`'s held channel. A defaulted-away argument is a defect no
  // assertion about the ANSWER can reach (POS-90, one shape over).
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/world-apex.mjs", import.meta.url), "utf8");
  const awaited = src.match(/gatherHeldActions\(store\.db, await holdingsFor\(/g) ?? [];
  assert.equal(awaited.length, 3,
    `the held channel has 3 call sites and ${awaited.length} await — the others ship "you are holding nothing"`);
  assert.ok(!/gatherHeldActions\(store\.db, holdingsFor\(/.test(src),
    "a `gatherHeldActions(store.db, holdingsFor(...))` with no `await` hands a Promise to a `.length` read and answers empty");
});

test("POS-153 (c) — `readHoldEffects` with `since:` returns what came AFTER that crossing and not before", async () => {
  await withRecord(
    [
      holdAct(71, "2026-09-01T09:00:00Z", 150, "wright", "give", NEAR, "ethan-thorne"),
      holdAct(72, "2026-09-07T13:57:16Z", 175, "ethan-thorne", "take", NEAR, "ethan-thorne"),
      holdAct(73, "2026-09-08T09:00:00Z", 176, "ethan-thorne", "give", NEAR, "wright"),
    ],
    async () => {
      const { readHoldEffects } = await import("../src/world-hold.mjs?pos153c");
      const out = await readHoldEffects({ handles: ["wright"], sinceCrossing: 175, nowCrossing: 176 });
      assert.equal(out.readable, true, `the holding record was unreadable: ${out.reason}`);
      assert.deepEqual(out.events.map((e) => e.crossing), [175, 176],
        "the cursor's own window, oldest first — and crossing 150 is behind it");
      assert.deepEqual(out.events.map((e) => e.kind), ["hold-take", "hold-give"]);
      // `written_at` survives the timestamptz round trip as a string, because
      // `holdEffectsFrom` puts it straight into the event it returns.
      assert.equal(typeof out.events[0].at, "string", "a Date here would reach the resident as an object");
      assert.equal(out.events[0].at, "2026-09-07T13:57:16.000Z");
    });
});

test("POS-153 (d) — a record that REFUSES gives the three readers their own three answers, unchanged", async () => {
  // Finding 5 of the brief, driven. The three answers differ deliberately and
  // an unreachable Postgres must give exactly what a missing sqlite file gave:
  //   groundWithinReach → empty lists ("nothing journalled"), NOT `unavailable`
  //   holdingsFor       → []
  //   readHoldEffects   → { readable: false, reason }
  await withStore("pos153-d.db", async () => {
    await withRefusingRecord(async () => {
      const { groundWithinReach, holdingsFor } = await import("../src/world-apex.mjs?pos153d");
      const ground = await groundWithinReach(
        { standpoint: { x: 0, y: 0, handle: "wright" } }, { handles: new Set(["wright"]) });
      assert.ok(!ground.unavailable,
        `a refusing record turned the ground read into a third answer it has never given: ${ground.unavailable}`);
      const near = (ground.things ?? []).find((t) => t.thing === NEAR);
      assert.ok(near, "the ground under the caller is still readable — only the holding record refused");
      assert.equal(near.place_from, "fold",
        "with no holding record the fold is the answer, which is 'nothing journalled' and not 'I cannot see'");
      assert.equal(near.takeable, true, "and the door still admits it");

      const held = await holdingsFor({ handle: "wright" }, { handles: new Set(["wright"]) });
      assert.deepEqual(held, [], "a capability channel that fails OPEN is not a channel");

      const { readHoldEffects } = await import("../src/world-hold.mjs?pos153d");
      const effects = await readHoldEffects({ handles: ["wright"], sinceCrossing: 0, nowCrossing: 999 });
      assert.equal(effects.readable, false, "an unreachable record is UNREADABLE, not empty");
      assert.deepEqual(effects.events, []);
      assert.match(String(effects.reason ?? ""), /could not be read/i,
        "and it must say why, in words a caller can act on");
    });
  });
});

test("POS-153 (d2) — an office pointed at NO record refuses the same way, without dialling anything", async () => {
  // `pool()` builds its pg.Pool from WORLD2_PG_URL, so an office with none set
  // would spend a socket timeout per read discovering that. The reachability
  // check is not a source switch — there is no second source — and every arm of
  // it has to land on the same refusal.
  const prev = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  delete process.env.WORLD2_PG;
  delete process.env.WORLD2_PG_URL;
  try {
    const started = Date.now();
    const { readHoldEffects } = await import("../src/world-hold.mjs?pos153d2");
    const out = await readHoldEffects({ handles: ["wright"] });
    assert.equal(out.readable, false, "an office with no record configured has not read one");
    assert.match(String(out.reason ?? ""), /could not be read/i);
    assert.ok(Date.now() - started < 5000,
      "the refusal must be immediate — a socket timeout per read is the thing this avoids");
  } finally {
    for (const [k, v] of [["WORLD2_PG", prev.pg], ["WORLD2_PG_URL", prev.url]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test("POS-153 (e) — the frozen era cannot leak into the holding shelf", async () => {
  // `seed-import.mjs` files every imported event as `class = 'legacy'`, so a
  // `legacy:attachment` act is invisible to a class-keyed read. It reaches
  // `liveHolder` through `pgAttachmentsFor`, which is action-keyed and carries
  // the legacy era's own payload mapping. A `class = 'holding'` read that swept
  // them in would hand `holdEffectsFrom` a foreign payload shape and invent
  // events out of the seed.
  await withRecord(
    [
      act({ id: 81, at: "2026-07-01T09:00:00Z", crossing: 90, actor: "wright",
            action: "legacy:attachment", cls: "legacy",
            payload: { at: "2026-07-01T09:00:00Z", seq: 7, type: "attachment", actor: "wright",
                       payload: { target: NEAR, policy: "cascade", declared_by: "wright" } } }),
      holdAct(82, "2026-09-07T13:57:16Z", 175, "wright", "give", NEAR, "ethan-thorne"),
    ],
    async () => {
      const { readHoldEffects } = await import("../src/world-hold.mjs?pos153e");
      const out = await readHoldEffects({ handles: ["wright"], sinceCrossing: 0, nowCrossing: 999 });
      assert.equal(out.readable, true, `the holding record was unreadable: ${out.reason}`);
      assert.deepEqual(out.events.map((e) => e.crossing), [175],
        "only the live era is a journal-shaped holding row; the seed's own era is `class = 'legacy'`");

      // And the edge read DOES see it — the two shelves are keyed differently
      // on purpose, and this is the control that proves the fixture holds both.
      const { holdingsFor } = await import("../src/world-apex.mjs?pos153e");
      const held = await holdingsFor({ handle: "ethan-thorne" }, { handles: new Set(["ethan-thorne"]) });
      assert.deepEqual(held, [NEAR], "the give is the latest row for that thing, across both eras");
    });
});
