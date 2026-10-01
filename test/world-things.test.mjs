// world-things.test.mjs — the object primitive: things + inventory.
//
// The claims worth being able to break, in the order they matter:
//
//   1. the class roster is READ from the record, not held (and the probe is red
//      on main, where the door hardcodes "bounty")
//   2. an unreadable store FALLS BACK and SAYS SO — never silently either way
//   3. holding is latest-wins, and a hand-off keeps the whole history
//   4. ownership ≠ position: `by` never moves when the holding does
//   5. a held thing's position DERIVES from its holder — the record on disk is
//      byte-identical across any number of gives (the no-new-storage proof)
//   6. the take rule is exercised in BOTH dial positions, so whichever Wright
//      ratifies is already covered

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SCHEMA, CLASS_ROSTER_GATE_SQL, isClassDefinition, isClassMark } from "../src/world-store.mjs";
import { classRoster, classDials, classNames, resetClassRosterCache, ROSTER_FLOOR, departurePace, STRIDE_CLASS_NAME } from "../src/world-classes.mjs";
import { declareHolding, liveHolder, holdingsOf, heldPositionOf } from "../src/world-hold.mjs";
import { openDynamic } from "../src/dynamic-store.mjs";
import { readAttachments, declareAttachment } from "../src/dynamic-entities.mjs";
import { NO_WORLD_DB, clearWorld, publishWorld } from "./helpers/world-rows.mjs";

// The class layer reads the world graph snapshot (POS-270 lane W 3a): storeWith()
// publishes an OK store as one, and world.db's path points nowhere.
process.env.WORLD_STORE_DB = NO_WORLD_DB;

const TMP = mkdtempSync(join(tmpdir(), "office-things-"));

// ── a world store carrying the Keeping Works in miniature ───────────────────
//
// Hand-filled with the hydrator's own SCHEMA, for the reason the other fixtures
// give: what is under test is never the hydration, which has its own tests.
function storeWith(classMarks, { status = "OK", file = "world.db" } = {}) {
  const path = join(TMP, file);
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT INTO meta VALUES (?, ?)");
  meta.run("hydration_status", status);
  meta.run("as_of_world", "f00dcafe");
  const node = db.prepare("INSERT INTO nodes (id, kind, subkind, tier, by, at_x, at_y, extent_w, extent_h, props) VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (const m of classMarks)
    // Class-carrying rows get a Keeping-Works path unless the fixture says
    // otherwise (m.props.path wins): the position clause (step-1, 2026-08-18)
    // is tested on its own; these tests turn on authorship and the class key.
    node.run(m.id, "mark", "sited", m.tier ?? "constitution", m.by ?? "the-town", 0, 0, 50, 40, JSON.stringify({
      ...(m.props?.class != null
        ? { path: `WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/${m.id.split("/").at(-1)}/mark.md` }
        : {}),
      ...m.props,
    }));
  db.close();
  // A FAILED hydration is never published (the store is never given one), so
  // what the office sees after one is NO world.
  if (status === "OK") publishWorld(path); else clearWorld();
  resetClassRosterCache();
  return path;
}

const THING_CLASS = {
  id: "the-town/thing",
  props: { class: "thing", class_version: 1, mobility: "settled", dials: { make_daily_cap: 12, carry_cap: 24, take_requires_welcome: false }, affordances: [{ action: "give", blurb: "Hand it over." }, { action: "drop", blurb: "Set it down." }, { action: "take", blurb: "Pick it up." }] },
};
const BOUNTY_CLASS = { id: "the-town/bounty", props: { class: "bounty", class_version: 1, dials: { ask_max_chars: 150 }, affordances: [] } };
// The class that proves the roster gate must be WIDER than the affordance gate:
// parcel is unquestionably law and declares no affordances at all.
const PARCEL_CLASS = { id: "the-town/parcel", props: { class: "parcel", class_version: 1, dials: { extent_m: 25 } } };

// ── 1 · the roster is read from the record ──────────────────────────────────

test("the class roster is READ from the record, not held", () => {
  const db = storeWith([THING_CLASS, BOUNTY_CLASS, PARCEL_CLASS]);
  const { roster, source, disclosed } = classRoster();
  assert.equal(source, "store");
  assert.equal(disclosed, null);
  assert.deepEqual([...roster].sort(), ["bounty", "parcel", "thing"]);
});

test("a class the record does not declare is not in the roster — the probe can fail", () => {
  const db = storeWith([BOUNTY_CLASS]);
  const { roster, source } = classRoster();
  assert.equal(source, "store");
  assert.ok(roster.has("bounty"));
  // THE DISCRIMINATING ASSERTION. If the roster were still the hardcoded list
  // this passes trivially; it is the pairing with the test above — same code,
  // two records, two answers — that proves the record is what is being read.
  assert.ok(!roster.has("thing"), "a class absent from the record must be absent from the roster");
});

test("the roster gate is WIDER than the affordance gate — a class need not mint a verb", () => {
  // parcel is law and affords nothing. The two gates must disagree about it, or
  // `class: parcel` becomes a lie on the record while the parcel class stands.
  // The path is the position clause's fact (step-1, 2026-08-18): a definition
  // stands in the Keeping Works, as the real parcel mark does.
  const attr = { kind: "mark", by: "the-town", tier: "constitution", props: {
    ...PARCEL_CLASS.props,
    path: "WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/parcel/mark.md",
  } };
  assert.ok(isClassDefinition(attr), "parcel is a class definition");
  assert.ok(!isClassMark(attr), "parcel mints no verb");
  // …and the SQL twin agrees with the predicate, the way the house checks every
  // gate that exists in both forms.
  const db = new DatabaseSync(storeWith([PARCEL_CLASS]), { readOnly: true });
  const rows = db.prepare(`SELECT id FROM nodes WHERE ${CLASS_ROSTER_GATE_SQL}`).all();
  db.close();
  assert.deepEqual(rows.map((r) => r.id), ["the-town/parcel"]);
});

test("resident prose can never enter the roster — authorship carries the weight", () => {
  const forged = { id: "someone/my-own-class", by: "someone", tier: "constitution", props: { class: "sovereign-everything" } };
  const marketed = { id: "the-town/draft-class", by: "the-town", tier: "market", props: { class: "not-yet-law" } };
  const db = storeWith([THING_CLASS, forged, marketed]);
  const { roster } = classRoster();
  assert.deepEqual([...roster].sort(), ["thing"]);
});

// ── 2 · the fallback is disclosed, never silent ─────────────────────────────

test("an absent store falls back to the floor AND says so", () => {
  resetClassRosterCache();
  const { roster, source, disclosed } = (clearWorld(), classRoster());
  assert.equal(source, "floor");
  assert.deepEqual([...roster].sort(), [...ROSTER_FLOOR].sort());
  assert.match(disclosed, /could not be read|no world store/);
});

test("a FAILED hydration falls back, and says there is no world to read", () => {
  storeWith([THING_CLASS], { status: "FAILED: mid-write", file: "failed.db" });
  const { source, disclosed } = classRoster();
  assert.equal(source, "floor");
  // The failure is the hydrator's to name (it exits 1 and publishes nothing);
  // the office is left with no world, and says that rather than nothing.
  assert.match(disclosed, /no world store|could not be read/);
});

test("a store that hydrated but holds no class marks is a BROKEN world, not an empty one", () => {
  const db = storeWith([], { file: "empty.db" });
  const { source, disclosed } = classRoster();
  assert.equal(source, "floor", "admitting nothing would take the board down as surely as an outage");
  assert.match(disclosed, /no class marks/);
});

// ── 3 · dials come off the record ───────────────────────────────────────────

test("a cap is a class dial read from the record, never a constant in this repo", () => {
  const db = storeWith([THING_CLASS]);
  assert.deepEqual(classDials("thing"), { make_daily_cap: 12, carry_cap: 24, take_requires_welcome: false });
  assert.deepEqual(classDials("no-such-class"), {}, "an absent dial is an absent boundary — neutrality, the law's default");
});

// ── the holding edge ────────────────────────────────────────────────────────

const freshDynamic = (name) => {
  const p = join(TMP, name);
  rmSync(p, { force: true });
  return openDynamic(p);
};

const KEY = "alpha/the-brass-key";

test("a thing with no attachment row is standing on the ground", () => {
  const db = freshDynamic("hold-0.db");
  assert.equal(liveHolder(readAttachments(db), KEY), null);
  db.close();
});

test("take, then give, then drop — latest wins and NOTHING is mutated", () => {
  const db = freshDynamic("hold-1.db");

  const took = declareHolding({ db, thing: KEY, actor: "alpha" });
  assert.equal(took.did, "take");
  assert.equal(liveHolder(readAttachments(db), KEY), "alpha");

  const gave = declareHolding({ db, thing: KEY, to: "beta", actor: "alpha" });
  assert.equal(gave.did, "give");
  assert.equal(gave.previous_holder, "alpha");
  assert.equal(liveHolder(readAttachments(db), KEY), "beta");

  const dropped = declareHolding({ db, thing: KEY, actor: "beta" });
  assert.equal(dropped.did, "drop");
  assert.equal(liveHolder(readAttachments(db), KEY), null, "set down — the edge is in the log, the holding is not");

  // THE HISTORY IS KEPT. Three declarations, three rows: a hand-off supersedes,
  // it never edits. This is the append-only law of the log, checked where it
  // would actually be broken (an UPDATE instead of an INSERT).
  assert.equal(readAttachments(db).filter((r) => r.target === KEY).length, 3);
  db.close();
});

test("THE SAME-MILLISECOND SWALLOW: a give and the recipient's own drop both land", () => {
  // REGRESSION (found 2026-08-14 by running this branch against a moved main).
  // `attachments_once` is UNIQUE (entity, target, born_at) and the writer is
  // INSERT OR IGNORE, so two declarations naming the same entity on the same
  // thing in one millisecond collided and the second was discarded IN SILENCE —
  // the door answered `{did:"drop", holder:null}` while the store still said
  // `beta` held it. A successful answer contradicting the record it claims to
  // have written.
  //
  // A give followed by the recipient's own drop is that exact pair, and it is
  // not a rare race: measured 87 in 200 rounds before the fix. Loop, because one
  // pass of a timing bug proves nothing — the pre-fix code passes this suite
  // roughly half the time.
  for (let i = 0; i < 50; i++) {
    const db = freshDynamic(`swallow-${i}.db`);
    const t = `alpha/thing-${i}`;
    declareHolding({ db, thing: t, actor: "alpha" });
    declareHolding({ db, thing: t, to: "beta", actor: "alpha" });
    const dropped = declareHolding({ db, thing: t, actor: "beta" });
    const rows = readAttachments(db).filter((r) => r.target === t);
    assert.equal(rows.length, 3, `round ${i}: every declaration must land`);
    // THE ASSERTION THAT MATTERS: the door's answer and the store must agree.
    assert.equal(dropped.holder, null, `round ${i}: the door says it is on the ground`);
    assert.equal(liveHolder(readAttachments(db), t), null, `round ${i}: and the store agrees`);
    db.close();
  }
});

test("a swallowed insert REPORTS itself — `inserted: false`, never a silent no-op", () => {
  // The second guard, tested at its own level and not through the door.
  //
  // Worth saying plainly: I first wrote this as a `declareHolding` test and it
  // FAILED — because guard 1 (the strictly-later stamp) defends the very case I
  // was trying to force, so the 409 never fired. That is the good outcome, and it
  // means guard 2 is not the primary fix: it is belt-and-braces against a writer
  // this process cannot see (another hand inserting between our read and our
  // write). Unreachable-from-here is exactly why it belongs at this level, where
  // it CAN be exercised honestly, rather than being asserted through a path that
  // structurally cannot reach it.
  const db = freshDynamic("swallow-guard.db");
  const born = "2026-08-14T20:00:00.000Z";
  const first = declareAttachment(db, { entity: "alpha", target: KEY, policy: "cascade", declaredBy: "alpha", bornAt: born });
  assert.equal(first.inserted, true, "the first declaration lands");
  const second = declareAttachment(db, { entity: "alpha", target: KEY, policy: "detach", declaredBy: "alpha", bornAt: born });
  assert.equal(second.inserted, false, "the colliding one is swallowed AND SAYS SO — differing policy does not save it");
  assert.equal(readAttachments(db).filter((r) => r.target === KEY).length, 1);
  db.close();
});

test("you cannot give away what you are not holding", () => {
  const db = freshDynamic("hold-2.db");
  declareHolding({ db, thing: KEY, actor: "alpha" });
  assert.throws(() => declareHolding({ db, thing: KEY, to: "gamma", actor: "beta" }), (e) => e.code === 403);
  db.close();
});

test("the act is read off CURRENT STATE, not off what the caller calls it", () => {
  const db = freshDynamic("hold-3.db");
  // Same call shape twice — `to` omitted — and it means opposite things
  // depending only on whether the thing is in your hands.
  assert.equal(declareHolding({ db, thing: KEY, actor: "alpha" }).did, "take");
  assert.equal(declareHolding({ db, thing: KEY, actor: "alpha" }).did, "drop");
  db.close();
});

// ── 4 · ownership ≠ position ────────────────────────────────────────────────

test("OWNERSHIP IS NOT HOLDING: `by` never moves when the thing changes hands", () => {
  const db = freshDynamic("hold-4.db");
  declareHolding({ db, thing: KEY, actor: "alpha" });
  const gave = declareHolding({ db, thing: KEY, to: "beta", actor: "alpha" });
  assert.equal(gave.made_by, "alpha", "the create-edge is the author and it is not for sale");
  assert.equal(gave.holder, "beta");
  assert.notEqual(gave.made_by, gave.holder, "three edges, three answers");
  db.close();
});

test("holdings list what you hold, whoever made it — and drop what you gave away", () => {
  const db = freshDynamic("hold-5.db");
  declareHolding({ db, thing: "alpha/lamp", actor: "alpha" });
  declareHolding({ db, thing: "beta/stone", actor: "beta" });
  declareHolding({ db, thing: "beta/stone", to: "alpha", actor: "beta" });
  const rows = readAttachments(db);
  assert.deepEqual(holdingsOf(rows, "alpha").sort(), ["alpha/lamp", "beta/stone"]);
  assert.deepEqual(holdingsOf(rows, "beta"), [], "a thing you made and gave away is not yours to carry");
  db.close();
});

// ── 5 · position derives, and the record does not move ──────────────────────

test("a held thing's position DERIVES from its holder", () => {
  assert.deepEqual(heldPositionOf({ x: 120, y: -40 }), { x: 120, y: -40 });
  assert.deepEqual(heldPositionOf(null), null, "a holder with no position yields no derived position");
});

test("NO NEW STORAGE: the thing's record on disk is byte-identical across a hand-off", () => {
  // The claim most worth being able to break. If a give ever rewrote the mark's
  // `at:`, this file's bytes would change and a git commit would be owed per
  // transfer — which would also store a derived quantity, refused by the world's
  // own placement discipline.
  const record = join(TMP, "mark.md");
  const bytes = "---\nkind: sited\nby: alpha\ndate: 2026-08-14\nat: { x: 3, y: 4 }\nextent: { w: 0.4, h: 0.4 }\nclass: thing\n---\n\nA brass key, cold.\n";
  writeFileSync(record, bytes);
  // Read as a STRING, not a Buffer: assert.equal on two Buffers compares
  // references and can never pass, so this probe failed on its first run for a
  // reason that had nothing to do with what it tests. Noted rather than quietly
  // fixed, because a probe that fails for its own reasons is the failure mode
  // that makes people distrust a real red.
  const before = readFileSync(record, "utf8");

  const db = freshDynamic("hold-6.db");
  declareHolding({ db, thing: KEY, actor: "alpha" });
  declareHolding({ db, thing: KEY, to: "beta", actor: "alpha" });
  declareHolding({ db, thing: KEY, to: "gamma", actor: "beta" });
  db.close();

  assert.equal(readFileSync(record, "utf8"), before, "three hand-offs, zero bytes written to the record");
});

// ── 6 · the take rule, in BOTH dial positions ───────────────────────────────

test("TAKE RULE (default, law's reading): neutral ground admits the take", () => {
  const db = freshDynamic("take-1.db");
  const r = declareHolding({ db, thing: KEY, actor: "alpha", groundOwner: { owner: "beta", word: null }, dials: { take_requires_welcome: false } });
  assert.equal(r.did, "take", "neutral is the resting state everywhere — a take stands unless the ground has spoken");
  db.close();
});

test("TAKE RULE (either position): an OPPOSED ground refuses, absolutely", () => {
  const db = freshDynamic("take-2.db");
  for (const requires of [false, true])
    assert.throws(
      () => declareHolding({ db, thing: KEY, actor: "alpha", groundOwner: { owner: "beta", word: "opposed" }, dials: { take_requires_welcome: requires } }),
      (e) => e.code === 403 && /opposed/.test(e.defect));
  db.close();
});

test("TAKE RULE (dial flipped): welcome becomes the requirement", () => {
  const db = freshDynamic("take-3.db");
  assert.throws(
    () => declareHolding({ db, thing: KEY, actor: "alpha", groundOwner: { owner: "beta", word: null }, dials: { take_requires_welcome: true } }),
    (e) => e.code === 403 && /has not welcomed/.test(e.defect));
  // …and a welcome satisfies it, so the flipped position is not merely a refusal.
  const ok = declareHolding({ db, thing: KEY, actor: "alpha", groundOwner: { owner: "beta", word: "welcomed" }, dials: { take_requires_welcome: true } });
  assert.equal(ok.did, "take");
  db.close();
});

test("TAKE RULE: your own ground is always yours to take from", () => {
  const db = freshDynamic("take-4.db");
  const r = declareHolding({ db, thing: KEY, actor: "alpha", groundOwner: { owner: "alpha", word: null }, dials: { take_requires_welcome: true } });
  assert.equal(r.did, "take");
  db.close();
});

// ── the door's own contract ─────────────────────────────────────────────────

test("give, drop and take all dispatch, so L6 cannot go red on them", async () => {
  const { DISPATCHABLE } = await import("../src/world-apex.mjs");
  for (const v of ["give", "drop", "take"]) assert.ok(DISPATCHABLE.includes(v), `${v} has a live handler`);
  assert.ok(!DISPATCHABLE.includes("make"), "make is world_leave_mark with class: thing — it mints no verb");
});

test("world_hold and world_holdings are on the flat tool list", async () => {
  const { WORLD_TOOLS } = await import("../src/world.mjs");
  const names = WORLD_TOOLS.map((t) => t.name);
  assert.ok(names.includes("world_hold"));
  assert.ok(names.includes("world_holdings"));
  const hold = WORLD_TOOLS.find((t) => t.name === "world_hold");
  assert.deepEqual(hold.inputSchema.required, ["thing"]);
  assert.equal(hold.inputSchema.additionalProperties, false);
  // The door must SAY the decoupling, not merely implement it.
  assert.match(hold.description, /WHO MADE IT IS NOT WHO HOLDS IT/);
  // …and it must not promise enforcement it does not perform. `groundOwner` is
  // never wired at this door (PLAN-things.md §8), so the description discloses that the
  // law binds while the door does not yet check it, and names attribution as the
  // interim guard. This assertion exists so the sentence cannot quietly drift
  // back into a promise the wire does not carry — the defect this branch flagged
  // on `leave_mark`'s tier: field and then committed in its own file once.
  assert.match(hold.description, /does not yet resolve which ground/);
  assert.match(hold.description, /RECORD every take with the resident who made it/);
});

test("the leave-mark schema advertises whatever the roster says, and nothing else", () => {
  assert.deepEqual(classNames(), [...classRoster().roster].sort());
});

// ── the walker's stride comes off the record (the 2026-08-21 slow-walk bug) ──
//
// THE STRIDE RIDES THE MOVER, NOT THE VERB (Keemin, 2026-08-22): the dial
// lives on `the-town/resident`, since ANYTHING can depart at its own pace.
// The office asked classDials("departure") — a class that has never existed —
// so the dial read {} and every walker derived at the 15 km legacy constant:
// the founder clocked 650 m taking 30 minutes, 4x slower than the law's 60.
// This fixture holds ONLY the class the record actually names, so pointing the
// reader at any other name fails here instead of slowing the town again.
const STRIDE_CLASS = { id: "the-town/resident", props: { class: "resident", class_version: 8, dials: { pace_km_per_crossing: 60 } } };

test("the walker's pace is the RESIDENT class's own dial, read by the record's own name", () => {
  const db = storeWith([STRIDE_CLASS], { file: "stride-pace.db" });
  assert.equal(STRIDE_CLASS_NAME, "resident", "the name the reader asks for is the record's");
  assert.equal(departurePace(), 60, "650 m should take ~7.5 min at the law's 60 km/crossing, not 30");
});

test("an unreadable or unlawful pace dial derives null — the legacy constant's visible sign", () => {
  const empty = storeWith([THING_CLASS], { file: "no-depart.db" });
  assert.equal(departurePace(), null, "absent class -> null, never NaN");
  const bad = storeWith([{ id: "the-town/resident", props: { class: "resident", class_version: 8, dials: { pace_km_per_crossing: 0 } } }], { file: "bad-pace.db" });
  assert.equal(departurePace(), null, "a zero stride is unlawful, not slow");
});

// ── the holdings bound (2026-08-25) ─────────────────────────────────────────

test("world_holdings: `count` is what you hold, `shown` is what was listed", async () => {
  // Small today — the audit measured this whole answer at 52 bytes, because
  // wright holds nothing. That is exactly when to land the shape: nothing caps
  // how many things one resident can pick up, and this read is the shadow of
  // give, drop AND take, so it rides three of the world's actions.
  //
  // `count` was already here and already the true number; what it lacked was a
  // bound to be a count AGAINST.
  // The holdings are the hold acts (POS-269): sixty takes, filed through the
  // real pen onto the in-memory record, and read back by the door.
  const { installHoldRecord } = await import("./acts-pen-stub.mjs");
  const rec = await installHoldRecord();
  try {
    const { callHoldTool, declareHoldingFlipped } = await import("../src/world-hold.mjs");
    // THE TEST OWNS ITS CLOCK. The takes file through the real pen, whose
    // window guard reads the town's open window off the real clock
    // (world2-pen.mjs § LateCrossingError). A crossing pinned here (it was 221)
    // decays the moment the town crosses twice: on 2026-10-01 the open window
    // was 223, the guard refused every take as certified history, and this
    // test went red with nothing in the office changed. So the takes are
    // stamped with the window open NOW, read through the guard's own
    // `currentCrossing`. The guard is untouched; the subject here is holdings.
    const { currentCrossing } = await import("../src/crossings.mjs");
    const deps = {
      witnessStamp: async () => ({ at: { anchor: "the-town/the-quay", dx: 0, dy: 0 }, witnesses: null }),
      resolvedWorldHousehold: () => null,
      currentCrossing: () => currentCrossing(),
    };
    for (let i = 0; i < 60; i++) {
      await declareHoldingFlipped({ db: null, thing: `alpha/thing-${String(i).padStart(3, "0")}`, actor: "alpha", deps });
    }
    assert.equal(rec.pen.rows().length, 60, "sixty takes in the record");
    const key = { handles: new Set(["alpha"]) };

    const page = await callHoldTool("world_holdings", {}, key);
    assert.equal(page.count, 60, "everything in your hands");
    assert.equal(page.shown, 50, "everything this read listed");
    assert.equal(page.holding.length, 50);
    assert.notEqual(page.count, page.shown,
      "THE FALSIFIER: bound < count, and the count still true");
    assert.equal(page.complete, false);
    assert.equal(page.next_offset, 50);

    const rest = await callHoldTool("world_holdings", { offset: 50 }, key);
    assert.equal(rest.holding.length, 10);
    assert.equal(rest.complete, true);
    assert.equal(rest.count, 60, "the total does not shrink as you walk");
    assert.equal(rest.next_offset, undefined, "no cursor pointing past the end");

    // the pages tile what you hold
    const seen = [...page.holding, ...rest.holding].map((h) => h.thing);
    assert.equal(new Set(seen).size, 60);
  } finally { rec.restore(); }
});

test("world_holdings: empty hands are complete, not capped", async () => {
  const { installHoldRecord } = await import("./acts-pen-stub.mjs");
  const rec = await installHoldRecord();
  try {
    const { callHoldTool } = await import("../src/world-hold.mjs");
    const r = await callHoldTool("world_holdings", {}, { handles: new Set(["alpha"]) });
    assert.equal(r.count, 0);
    assert.equal(r.complete, true);
    assert.equal(r.more_note, undefined, "empty hands and cut hands must not look alike");
  } finally { rec.restore(); }
});
