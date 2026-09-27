// town-apex.test.mjs — POS-46, the third apex: the commons' reads, the
// register's writes.
//
//   node --test test/town-apex.test.mjs
//
// THE LAW every falsifier here quotes — twice superseded, both states recorded
// (reasoning rides the artifact):
//
//   2026-08-24: "THE TOWN'S HANDS TOUCH ONLY THE REGISTER" — the one act was
//   declare-household. Superseded 2026-08-30 morning when founding moved home
//   to household { do: "declare" } and the town went read-pure.
//
//   2026-08-30 evening (the asks-matrix sitting): the town is the CIVIC apex
//   and its acts are the LANES' PEN — do: "post", target-typed by class,
//   opening with "idea" at the Think Tank. The read-pure state lasted part of
//   one day, exactly as the schema comment promised ("the stake gesture
//   re-adds do: when it lands" — post landed first).
//
// The current sentence rides in the door's own refusal as REGISTER_LAW, and
// this file reads it from there rather than retyping it — a law the test
// spells for itself is a law that can drift from the one the door speaks.

import test from "node:test";
import assert from "node:assert/strict";

import {
  townApex, townDispatchToolFor, townTools, TOWN_TOOL, TOWN_READABLE,
  TOWN_DISPATCHABLE, TOWN_READS, REGISTER_LAW, NAMED_NOT_BUILT,
} from "../src/town-apex.mjs";
import { actionFields } from "../src/world-apex.mjs";
import { TOOLS } from "../src/mcp.mjs";

const key = () => ({ household: "testers", handles: new Set(["tester"]), ghId: "1" });
const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
const schemaRequired = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.required ?? []]));
/** a dispatcher that records what the apex asked the flat layer for */
const spy = () => { const calls = []; return { calls, call: async (tool, fields) => { calls.push({ tool, fields }); return { ok: tool }; } }; };
const ctx = (extra = {}) => ({ schemas, schemaRequired, ...extra });

// ── THE REGISTER LAW ────────────────────────────────────────────────────────
test("THE REGISTER, 2026-08-31: the roster is the lanes' pen AND the stake gesture — post, stake, unstake", () => {
  assert.deepEqual([...TOWN_DISPATCHABLE], ["post", "stake", "unstake"],
    "the matrix's two directions, both built: put an ask on a lane, put stamps behind one — and take them back");
  assert.equal(townDispatchToolFor("post"), "town_post",
    "post charges as the flat verb town_post — an apex act is never a second, uncounted door");
  assert.equal(townDispatchToolFor("stake"), "town_stake");
  assert.equal(townDispatchToolFor("unstake"), "town_unstake",
    "…and so do the stake pair; charging them as `town` would put real escrow through an uncounted door");
  assert.equal(townDispatchToolFor("declare-household"), null,
    "the duplicate door stays closed — household's declare act dispatches the same flat verb it always did");
  assert.equal(townDispatchToolFor("home"), null);
});

// ── THE PAIR ────────────────────────────────────────────────────────────────
// The class blurb, VERBATIM from the record (postmark-world,
// WORLD/…/postmark-edge/stake/mark.md, `the-town/stake` v2):
//
//   "A stake is ✦ held in escrow behind a mark — belief with weight, standing
//    until taken back, and the record keeps both the placing and the withdrawal."
//
// "standing until taken back" and "both the placing and the withdrawal" are why
// this is a pair test and not two act tests. A door that shipped the placing
// alone would strand a caller's stamps behind a verb they cannot reach from
// where they learned to place them, and it would be quoting a class it had
// implemented half of.
test("THE CLASS BLURB IS THE PAIR: a door that places must let you take back", () => {
  const STAKE_BLURB = "A stake is ✦ held in escrow behind a mark — belief with weight, standing until taken back, and the record keeps both the placing and the withdrawal.";
  assert.match(STAKE_BLURB, /standing until taken back/);
  assert.match(STAKE_BLURB, /both the placing and the withdrawal/);
  assert.ok(TOWN_DISPATCHABLE.includes("stake"), "the placing");
  assert.ok(TOWN_DISPATCHABLE.includes("unstake"), "…and the withdrawal, at the same door, or the class is half-served");
});

test("THE REGISTER FALSIFIER: a non-register act bounces TEACHING where hands live", async () => {
  const { call } = spy();
  // `stake` LEFT this list 2026-08-31 — it is an act here now, and a falsifier
  // that still expected it to bounce would be asserting the door is broken.
  for (const reach of ["home", "window", "profile", "walk", "leave-mark", "say"]) {
    const r = await townApex({ do: reach }, key(), ctx({ call }));
    assert.equal(r.error, "bounce", `${reach} must not be a town act`);
    assert.equal(r.code, 422);
    // The refusal quotes the law rather than listing valid strings: a caller
    // reaching for their pen at this door has understood that there are apexes
    // and misjudged which one owns what, and a list of names would not fix that.
    assert.ok(r.hint.includes(REGISTER_LAW), `${reach}: the bounce must carry the register law`);
    assert.equal(r.the_register_law, REGISTER_LAW);
  }
  // and the law says the two other homes by name
  assert.match(REGISTER_LAW, /your pen lives at household/);
  assert.match(REGISTER_LAW, /your feet in the world/);
});

test("NAMED, NOT BUILT: deregistration is named, does not dispatch, and says why", async () => {
  assert.equal(TOWN_DISPATCHABLE.includes("deregister-household"), false,
    "a door that advertised it would be promising a thing nobody has ruled on");
  assert.ok(NAMED_NOT_BUILT["deregister-household"], "…and a town that can be joined and not left has made a statement, so the absence is deliberate");
  assert.match(NAMED_NOT_BUILT["deregister-household"], /require the standing it removes/);

  const r = await townApex({ do: "deregister-household" }, key(), ctx({ call: spy().call }));
  assert.equal(r.code, 422);
  assert.ok(r.hint.includes("named, not built"), "the bounce distinguishes 'not a thing here' from 'not built yet'");
  assert.ok(r.hint.includes(REGISTER_LAW));
});

test("MOVED still teaches: declare-household points home and dispatches nothing", async () => {
  const { calls, call } = spy();
  const moved = await townApex({ do: "declare-household", args: { household: "H", handle: "h" } }, null, ctx({ call }));
  assert.equal(moved.error, "bounce");
  assert.equal(calls.length, 0, "a moved act dispatches NOTHING — the bounce is the whole answer");
  assert.ok(moved.hint.includes('household { do: "declare" }'), "the bounce walks the caller to the door that holds the pen");
});

// THE REPEAL, ASSERTED AS A REPEAL. The predecessor of this test asserted the
// opposite — that `do: "stake"` bounced naming its interim doors — and it was
// right for one day. What replaces it is not "stake works now" (that is the
// dispatch test below); it is that the LAW SENTENCE stopped promising a future
// it has already delivered, and that the ledger of unbuilt things no longer
// carries a built one. Both are the shapes a repeal actually fails in: a stale
// promise in the door's own mouth, and a row nobody remembered to delete.
test("THE REPEAL: the register law no longer promises stake, and named_not_built no longer holds it", async () => {
  assert.doesNotMatch(REGISTER_LAW, /ruled and next/,
    "the law sentence promised the stake gesture was coming; it came, so the promise is false and must be gone");
  assert.match(REGISTER_LAW, /do: "stake"/, "…and the law names the act that landed");
  assert.equal(NAMED_NOT_BUILT.stake, undefined,
    "a built act sitting in the named-not-built ledger would send a caller away from the door they are standing at");
  const answer = await townApex({}, key(), ctx({ call: spy().call }));
  assert.equal(answer.named_not_built.stake, undefined, "…and the bare read carries the corrected ledger, not a cached one");
  // the CAN-FAIL FLIP, run and recorded: with the old sentence restored, this
  // falsifier fails. Asserted here as the shape rather than by mutating the
  // module, so the flip is legible without a second import of a doctored copy.
  assert.match("…and the stake gesture (stamps behind intent, target-typed) is ruled and next", /ruled and next/,
    "the flip: this is the superseded sentence, and it is exactly what the assertion above rejects");
});

test("THE STAKE GESTURE DISPATCHES: stake and unstake reach their flat verbs, fields untouched", async () => {
  const { calls, call } = spy();
  const staked = await townApex({ do: "stake", args: { mark: "wright/an-idea", stamps: 3 } }, key(), ctx({ call }));
  assert.equal(calls.length, 1, "the act dispatches — it is built now");
  assert.equal(calls[0].tool, "town_stake");
  assert.deepEqual(calls[0].fields, { mark: "wright/an-idea", stamps: 3 },
    "the world stake card's own field names ride through UNRENAMED — a translation layer is a place for the two doors to drift");
  assert.equal(staked.did, "stake");
  assert.equal(staked.dispatched_to, "town_stake");

  const back = await townApex({ do: "unstake", args: { mark: "wright/an-idea", stamps: 3 } }, key(), ctx({ call }));
  assert.equal(calls[1].tool, "town_unstake");
  assert.equal(back.did, "unstake");
});

// ── the reads ───────────────────────────────────────────────────────────────
// NINE → THIRTEEN (POS-54, the founder's round-2 ruling, 2026-08-25). The four
// added are the roster's siblings — resident, home, votes, stamps — and the
// property this test asserts is unchanged by the growth: the apex reimplements
// nothing, it names a flat verb and hands the call back. That is what keeps the
// slim honest, so it is asserted over the WHOLE table rather than a fixed nine.
// SIXTEEN → SEVENTEEN (2026-09-01, the clarity round): `asks` — the Civic
// Quarter itself. The three lane reads say what is STANDING on a lane; this one
// says what each lane is FOR, in the five buildings' own plaques. The count is
// the closed-union guard, so it is deliberately updated with the read rather
// than loosened to a `>=`.
test("THE COMMONS' READS: nineteen (thirteen + the three lanes + the quarter + marks + calendar), and each one SERVES a flat verb rather than reimplementing it", async () => {
  // The number is the guard, and the parenthesis is its derivation — a read born
  // unadvertised is exactly what this catches, so the count is updated by hand
  // and the sentence says which addition moved it. `marks` joined 2026-09-07
  // (lane E item 2, the walk's "what has Errant put in the world?"). `calendar`
  // joined 2026-09-24 (POS-207): what is on, what is coming, what just ended.
  assert.equal(TOWN_READABLE.length, 19);
  for (const r of TOWN_READABLE) {
    const { calls, call } = spy();
    const out = await townApex({ read: r }, key(), ctx({ call }));
    assert.equal(calls.length, 1, `${r} dispatched exactly once`);
    assert.equal(calls[0].tool, TOWN_READS[r].tool, `${r} serves ${TOWN_READS[r].tool}`);
    assert.deepEqual(out, { ok: TOWN_READS[r].tool }, "…and returns what the flat verb returned, untouched");
  }
});

test("…and a read's own fields ride through, from args: or from the top level", async () => {
  const a = spy();
  await townApex({ read: "letter", args: { id: "abc" } }, key(), ctx({ call: a.call }));
  assert.deepEqual(a.calls[0].fields, { id: "abc" });
  const b = spy();
  await townApex({ read: "search", q: "lanterns" }, key(), ctx({ call: b.call }));
  assert.deepEqual(b.calls[0].fields, { q: "lanterns" });
});

test("an unknown read bounces naming every read the door serves", async () => {
  const r = await townApex({ read: "everything" }, key(), ctx({ call: spy().call }));
  assert.equal(r.code, 422);
  for (const name of TOWN_READABLE) assert.ok(r.hint.includes(name), `the hint names ${name}`);
});

// ── the grammar, for the third time ─────────────────────────────────────────
//
// The prototype's affordance is gated on a SHAPE (ops/mcp-prototype § collect-
// Actions): an array named `acts` whose entries carry `act` and `fields`, on
// a tool whose schema declares the do:/args: envelope. The town door should
// pass it without anything downstream learning the word "town". (`actions`
// stays the WORLD's spelling — class-granted where you stand; a door's own
// fixed verbs are `acts`. Keemin-ruled 2026-08-25.)
test("THE GRAMMAR: the bare call speaks the acts shape the household apex speaks", async () => {
  const answer = await townApex({}, key(), ctx({ call: spy().call }));
  assert.ok(Array.isArray(answer.acts), "an array named acts");
  for (const e of answer.acts) {
    assert.equal(typeof e.act, "string");
    assert.ok(e.act.length > 0);
    assert.equal(typeof e.fields, "object");
    assert.equal(Array.isArray(e.fields), false);
  }
  // the envelope, on the tool's own schema — do: returned with the roster,
  // enum'd, exactly as the read-pure commit's comment promised
  assert.deepEqual(TOWN_TOOL.inputSchema.properties.do?.enum, [...TOWN_DISPATCHABLE]);
  assert.equal(TOWN_TOOL.inputSchema.properties.args?.type, "object");
  // the alias era is over: one key, and the duplicate stays dead
  assert.equal("actions" in answer, false, "the `actions` duplicate must not ride the town answer");
});

test("the bare read carries every act's card and the named-not-built ledger", async () => {
  const answer = await townApex({}, key(), ctx({ call: spy().call }));
  assert.equal(answer.acts.length, 3, "three cards — post, and the stake pair");
  const byAct = Object.fromEntries(answer.acts.map((a) => [a.act, a]));
  assert.equal(byAct.post.dispatches_to, "town_post");
  for (const f of ["class", "slug", "body"])
    assert.ok(byAct.post.fields[f], `the card names ${f} — the fields ride from town_post's own schema, never retyped`);
  assert.equal(byAct.post.fields.class.required, true, "and class is marked required, from the schema's own required list");

  // The stake pair's fields ride from town_stake's schema the same way, and
  // they are the WORLD stake card's own words (mark, stamps, handle) because
  // the act is the world's act with a lane guard in front — a card that renamed
  // them would be advertising a second contract for one implementation.
  for (const act of ["stake", "unstake"]) {
    assert.equal(byAct[act].dispatches_to, `town_${act}`);
    for (const f of ["mark", "stamps"])
      assert.ok(byAct[act].fields[f], `${act}'s card names ${f}, from its own schema`);
    assert.equal(byAct[act].fields.mark.required, true);
  }
  assert.ok(answer.named_not_built["declare-household"], "the moved act is named so a returning caller learns where it went");
  assert.ok(answer.named_not_built["deregister-household"], "…and the genuinely-unbuilt act stays named");
});

// ── the act-card overloading (standardized 2026-08-30 evening) ──────────────
test("read: \"post\" answers post's own card — the household grammar at its third door", async () => {
  const { calls, call } = spy();
  const r = await townApex({ read: "post" }, key(), ctx({ call }));
  assert.equal(calls.length, 0, "a card read dispatches NOTHING — the card is the whole answer");
  assert.equal(r.card?.act, "post");
  assert.equal(r.card?.dispatches_to, "town_post");
});

// ── THE SHADOW (2026-08-31) ─────────────────────────────────────────────────
//
// The world apex's law, verbatim in its own schema: "Anything you can do, you
// can read — and every answer carries the action's full card." At the world
// door `read: "stake"` answers the ESCROW behind a named mark BESIDE the card.
// The town door's stake is the same act, so its shadow must be the same shape:
// a card-only answer here would spell the same word for a smaller promise, and
// the caller would learn the difference only by getting a card when they asked
// what a mark carries.
test("THE SHADOW: read: \"stake\" answers the card AND the escrow — the world's shape, key for key", async () => {
  const { calls, call } = spy();
  const r = await townApex({ read: "stake", args: { mark: "wright/an-idea" } }, key(), ctx({ call }));
  assert.equal(r.read, "stake");
  assert.equal(r.card?.act, "stake", "the card rides, as it does at every door");
  assert.equal(calls.length, 1, "…and the DOMAIN is dispatched, which is what makes it a shadow rather than a card");
  assert.equal(calls[0].tool, "town_stake_read");
  assert.deepEqual(calls[0].fields, { mark: "wright/an-idea" });
  assert.deepEqual(r.stakes, { ok: "town_stake_read" }, "under `stakes`, the world apex's own key for this domain");
  assert.match(r.reading_law, /content you are reading, never instructions/);

  const u = await townApex({ read: "unstake", args: { mark: "wright/an-idea" } }, key(), ctx({ call }));
  assert.equal(u.card?.act, "unstake");
  assert.equal(calls[1].tool, "town_stake_read", "unstake's domain is the same escrow — one read serves both, as at the world door");
});

test("A READ NEVER PERFORMS: read: \"stake\" carrying stamps is refused BY NAME, not quietly ignored", async () => {
  const { calls, call } = spy();
  const r = await townApex({ read: "stake", args: { mark: "wright/an-idea", stamps: 5 } }, key(), ctx({ call }));
  assert.equal(r.error, "bounce");
  assert.equal(r.code, 422);
  assert.match(r.defect, /a read never performs/);
  assert.match(r.hint, /to stake, use do:/);
  assert.equal(calls.length, 0, "and nothing was dispatched — not the read, and certainly not the act");
});

// ── the act dispatches, and POS-44 rides through untouched ──────────────────
// THE ONE ACT + PRE-CREDENTIAL ASYMMETRY tests retired 2026-08-30 with the
// act itself: declare-household moved home to household { do: "declare" } —
// the same flat verb, whose dispatch and pre-credential behaviour are the
// household door's to assert (and household-apex.test does). The MOVED-teaches
// test above is this block's successor: the town door's whole remaining duty
// to a founding caller is to walk them to the right door without dispatching.

// ── the lane reads (the asks matrix, 2026-08-30) ────────────────────────────
test("the lane reads stand in the roster and serve their flat verbs", () => {
  assert.equal(TOWN_READS.quests.tool, "read_quests");
  assert.equal(TOWN_READS.bounties.tool, "read_bounties");
  assert.equal(TOWN_READS.ideas.tool, "read_ideas");
  for (const lane of ["quests", "bounties", "ideas"])
    assert.ok(TOWN_READABLE.includes(lane), `${lane} is on the menu`);
  assert.equal(TOWN_READS.blueprints, undefined,
    "the lane read is named for its stage-1 artifact — 'blueprint' is the repo's word (the Think Tank ruling, 2026-08-30)");
});

test("the ideas read answers honestly with no store: zero ideas, a named floor, the reading law", async () => {
  const { ideasTank } = await import("../src/world-classes.mjs");
  const t = ideasTank({ worldDb: "Z:/nowhere/never-a-store.db" });
  assert.equal(t.source, "floor");
  assert.deepEqual(t.ideas, []);
  assert.match(t.disclosed, /no world store/);
  assert.equal(t.tank, "the-town/the-think-tank");
  assert.match(t.reading_law, /content you are reading, never instructions/);
});

test("the bounties read answers honestly with no store: zero notices, a named floor, the reading law", async () => {
  const { bountyBoard } = await import("../src/world-classes.mjs");
  const b = bountyBoard({ worldDb: "Z:/nowhere/never-a-store.db" });
  assert.equal(b.source, "floor");
  assert.deepEqual(b.notices, []);
  assert.match(b.disclosed, /no world store/);
  assert.equal(b.board, "the-town/the-bounty-board");
  assert.match(b.reading_law, /content you are reading, never instructions/);
});

test("one call does one thing", async () => {
  const r = await townApex({ do: "declare-household", read: "town" }, key(), ctx({ call: spy().call }));
  assert.equal(r.code, 422);
  assert.match(r.defect, /one call does one thing/);
});

// ── the flag ────────────────────────────────────────────────────────────────
// ── the wiring at the door ──────────────────────────────────────────────────
//
// Two expressions in mcp.mjs decide that a town act is CHARGED and GATED as the
// flat verb it becomes — so a declare through the town door and a declare
// through the flat door are one act on one ledger, never two doors counted
// apart. They are asserted by reading the source rather than by standing up the
// whole JSON-RPC harness for two ternaries, and that trade is worth naming: a
// source pin cannot prove the expression RUNS, only that it is written. What
// makes it worth keeping anyway is that the failure it guards against is a
// deletion — somebody simplifying the ladder and dropping the town arm — which
// is exactly what a source pin does catch.
test("THE WIRING: a town act is charged and gated as the verb it becomes", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/mcp.mjs", import.meta.url), "utf8");
  assert.match(src, /named === "town" && write[\s\S]{0,120}townDispatchToolFor/,
    "the rate ledger must charge a town act as its flat verb");
  assert.match(src, /name === "town" \? \(townDispatchToolFor/,
    "…and the harbor gate must judge it as that verb too");
  assert.match(src, /\.\.\.apexTools\(\), \.\.\.townTools\(\)/,
    "and the third door is listed beside the other two, apex-on");
});

// ── THE GATE THAT COULD NOT FAIL, AND NOW CAN ───────────────────────────────
//
// The test above is a SOURCE PIN, and its own comment admits the trade: "a
// source pin cannot prove the expression RUNS, only that it is written." For
// four days it pinned two expressions that never ran, because `writeShaped`
// deliberately did not resolve `town { do: }` — so `write` was false at both
// call sites and both ternaries fell through to their else arms. The rate
// ledger charged every town act as a READ; the harbor gate never consulted
// townDispatchToolFor at all. This is the falsifier the pin needed beside it:
// it asks the predicate itself, so it fails if the resolution is removed again.
test("THE PREDICATE RUNS: `town { do: }` is write-shaped, so the ladder's town arms actually fire", async () => {
  const { WRITE_TOOLS } = await import("../src/mcp.mjs");
  // writeShaped is module-private; the property it must have is observable
  // through the two things that depend on it, so they are asserted directly.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/mcp.mjs", import.meta.url), "utf8");
  assert.match(src, /name === "town" && args != null && typeof args === "object" && args\.do != null/,
    "without this arm the town arms two gates below are unreachable code wearing a passing test");
  // and the acts it resolves to are credentialed writes, which is what makes
  // the gates meaningful rather than decorative
  for (const flat of ["town_post", "town_stake", "town_unstake"])
    assert.ok(WRITE_TOOLS.has(flat), `${flat} is a durable act and must be gated as one`);
  assert.equal(WRITE_TOOLS.has("town_stake_read"), false, "the shadow stays a public read");
});

// ── THE HARBOR GATE, HELD AT THIS DOOR ──────────────────────────────────────
//
// HARBOR_BOUNCE names its own scope, verbatim: "durable acts (mail, marks,
// media, papers, stakes) come ashore with settlement". `stakes` is in that
// sentence. An unsettled household reaching a stake through this door would be
// performing exactly the act the ruling withheld — and `do: "post"` stakes 1✦
// escrow, so the hole was already open before the gesture landed.
//
// The gate lives in the apex's act branch (the household apex's precedent, its
// own line 856) so that it holds for every caller, including the in-process
// ones that never pass through mcp.mjs's ladder at all.
test("THE HARBOR: an unsettled household reads and posts nothing durable — stakes included", async () => {
  const { HARBOR_BOUNCE } = await import("../src/harbor-gate.mjs");
  const harborKey = { household: "arriving", handles: new Set(["newcomer"]), harbor: true };
  const before = process.env.HARBOR_WRITES;
  delete process.env.HARBOR_WRITES;
  try {
    for (const act of ["stake", "unstake", "post"]) {
      const { calls, call } = spy();
      const r = await townApex({ do: act, args: { mark: "wright/an-idea", stamps: 1 } }, harborKey, ctx({ call }));
      assert.equal(r.error, "bounce", `${act} must not reach the ledger from the harbor`);
      assert.equal(r.code, HARBOR_BOUNCE.code);
      assert.equal(r.defect, HARBOR_BOUNCE.defect);
      assert.match(r.hint, /stakes\) come ashore with settlement/,
        "the bounce quotes the ruling's own scope, which is where `stakes` is named");
      assert.deepEqual(calls, [], "and NOTHING was dispatched — a gate that dispatched first would be a receipt, not a gate");
    }
    // READS ARE NEVER GATED. The harbor tier reads everything, and the stake
    // shadow is a read: a household waiting for settlement can still see what
    // the town is backing while it waits.
    const { calls, call } = spy();
    await townApex({ read: "stake", args: { mark: "wright/an-idea" } }, harborKey, ctx({ call }));
    assert.equal(calls.length, 1, "the shadow answers at the harbor — read everything is the other half of the ruling");
    // DEACTIVATION, NOT DELETION: the flag reopens it without a deploy.
    process.env.HARBOR_WRITES = "1";
    const open = spy();
    const r = await townApex({ do: "stake", args: { mark: "wright/an-idea", stamps: 1 } }, harborKey, ctx({ call: open.call }));
    assert.equal(r.did, "stake", "HARBOR_WRITES=1 reopens the door, as harbor-gate.mjs promises for every gated verb");
    assert.equal(open.calls[0].tool, "town_stake");
  } finally { if (before === undefined) delete process.env.HARBOR_WRITES; else process.env.HARBOR_WRITES = before; }
});

test("THE FLAG: the town tool appears only apex-on, and costs one frozen array off", () => {
  const before = process.env.WORLD_APEX;
  try {
    delete process.env.WORLD_APEX;
    assert.deepEqual(townTools(), [], "flag-off, no third door");
    process.env.WORLD_APEX = "1";
    assert.deepEqual(townTools().map((t) => t.name), ["town"]);
  } finally { if (before === undefined) delete process.env.WORLD_APEX; else process.env.WORLD_APEX = before; }
});

// ── the option sets: declared where closed, suggested where open ────────────
//
// THE LAW these quote (the schema comments carry it, 2026-08-30): a closed,
// context-free roster is an honest `enum`; a field that accepts names beyond
// its roster (household read: takes any act name as a card read) or whose
// lawful values depend on who asks and where they stand (world do:) carries
// `examples` — a suggestion, never a constraint. An enum on those fields
// would bounce lawful calls, so its ABSENCE is asserted here on purpose: a
// later hand "completing" the enum is the regression this block exists to
// catch. The values derive from the serving tables, so the menu cannot drift
// from the door.

test("town's enums ARE the serving tables — read is READS ∪ ACTS (the card overloading makes act names lawful reads), do: is the roster", () => {
  const p = TOWN_TOOL.inputSchema.properties;
  assert.deepEqual(p.read.enum, [...TOWN_READABLE, ...TOWN_DISPATCHABLE],
    "a read enum without the act names would bounce the lawful read: \"post\" card read — the union is still closed and derived, so it stays an honest enum");
  assert.deepEqual(p.do.enum, [...TOWN_DISPATCHABLE], "do: returned with the roster, enum'd, as the read-pure commit promised");
});

test("household: BOTH do and read are enum'd from the tables — the same union the town door advertises", async () => {
  // ⚠ THIS TEST USED TO ASSERT THE OPPOSITE: `p.read.enum === undefined`, with
  // the reason "an enum here would bounce lawful act-card reads like read:
  // \"send\"". The premise was true and the conclusion did not follow — an enum
  // of the READS alone would bounce them, but the accepted set is reads ∪ acts,
  // both known and both closed. The town door directly above advertises exactly
  // that union, so the same grammar was being advertised two ways at two doors:
  // one handing connectors a real enum, the other non-constraining `examples`.
  // Founder-ruled 2026-08-31: one grammar, advertised once.
  const { HOUSEHOLD_TOOL, HOUSEHOLD_DISPATCHABLE, HOUSEHOLD_READ_ENUM } = await import("../src/household-apex.mjs");
  const p = HOUSEHOLD_TOOL.inputSchema.properties;
  assert.deepEqual(p.do.enum, HOUSEHOLD_DISPATCHABLE);
  assert.deepEqual(p.read.enum, [...HOUSEHOLD_READ_ENUM], "the reads AND the act names — the roster the door actually accepts");
  assert.equal(p.read.examples, undefined, "`examples` was the weaker advertisement; it does not ride beside the enum that replaced it");
});

test("CROSS-DOOR: town and household advertise read: the same way, and the world door's difference is principled", async () => {
  // The standing review rule, made a test: two doors naming one question two
  // ways is the class being removed. Town and household are both
  // STANDING-scoped — what you may read is a property of your key, so the
  // roster is knowable and is closed. The WORLD door is STANDPOINT-scoped and
  // keeps no enum on purpose: "which acts are afforded depends on where you
  // stand — an enum would promise acts the ground refuses". That is a
  // different question, so a different answer is not drift.
  const { TOWN_TOOL, TOWN_READABLE, TOWN_DISPATCHABLE } = await import("../src/town-apex.mjs");
  const { HOUSEHOLD_TOOL, HOUSEHOLD_READ_ENUM } = await import("../src/household-apex.mjs");
  for (const [name, tool] of [["town", TOWN_TOOL], ["household", HOUSEHOLD_TOOL]])
    assert.ok(Array.isArray(tool.inputSchema.properties.read?.enum), `the ${name} door advertises read: as a closed roster`);
  assert.deepEqual(TOWN_TOOL.inputSchema.properties.read.enum, [...TOWN_READABLE, ...TOWN_DISPATCHABLE]);
  // ...and the household's is DEDUPED, because at that door three names are
  // both an act and a read. Same rule, one door's own arithmetic.
  assert.equal(HOUSEHOLD_READ_ENUM.length, new Set(HOUSEHOLD_READ_ENUM).size);
});

test("world: do/read carry NO enum (standpoint decides) and suggest the dispatch roster; as: is the closed pair", async () => {
  const { apexTools, DISPATCHABLE } = await import("../src/world-apex.mjs");
  const prev = process.env.WORLD_APEX; process.env.WORLD_APEX = "1";
  try {
    const p = apexTools()[0].inputSchema.properties;
    assert.equal(p.do.enum, undefined, "which acts are afforded depends on where you stand — an enum would promise acts the ground refuses");
    assert.equal(p.read.enum, undefined);
    assert.deepEqual(p.do.examples, DISPATCHABLE);
    assert.deepEqual(p.read.examples, DISPATCHABLE);
    assert.deepEqual(p.as.enum, ["resident", "human"]);
  } finally { if (prev === undefined) delete process.env.WORLD_APEX; else process.env.WORLD_APEX = prev; }
});

// ── THE READ BRANCH VALIDATES (founder-ruled 2026-09-11: "yes on parity shape") ──
//
// THE DEFECT, measured live on dev 2026-09-11 before this landed:
//   town { read: "letters", args: { from: "glitch" } }  →  200, total 6126
// the whole sandbox corpus, labelled as matching — while the flat `list_letters`
// refused `from` by name with the office's own `validateArgs`. The validator
// was live and unreachable from the only door a connecting agent holds: the
// apex handed `args:` straight to the implementation, and `validateArgs` only
// ever saw the word "town".
//
// CAN-FAIL FLIP for this whole block: delete the `validateReadArgs` call in
// town-apex.mjs § the read branch and every test below reddens by ANSWERING —
// `{ ok: "list_letters" }` comes back with `from` in the dispatched fields,
// which is the live defect's exact shape.

test("PARITY · an unknown arg on a town read bounces BY NAME, and nothing is dispatched", async () => {
  const a = spy();
  const r = await townApex({ read: "letters", args: { from: "glitch" } }, key(), ctx({ call: a.call }));
  assert.equal(r.error, "bounce");
  assert.equal(r.code, 422);
  assert.equal(r.defect, 'unknown argument "from" for list_letters',
    "the sentence the FLAT tool speaks — one grammar across both doors");
  assert.deepEqual(a.calls, [], "and the implementation was never reached, so no corpus came back labelled as matching");
});

test("PARITY · the hint lists the names that WOULD have worked — the cold-read half", async () => {
  const r = await townApex({ read: "letters", args: { from: "glitch" } }, key(), ctx({ call: spy().call }));
  assert.equal(r.hint, "this read takes: resident, region, since, until, exclude_office, full, limit, offset");
  assert.deepEqual(r.accepted, ["resident", "region", "since", "until", "exclude_office", "full", "limit", "offset"]);
  assert.equal(r.dispatched_to, "list_letters", "and it names which tool's field list answered");
});

test("PARITY · a read whose tool takes nothing refuses the field by name and says so", async () => {
  const a = spy();
  const r = await townApex({ read: "bounties", args: { bogus: 1 } }, key(), ctx({ call: a.call }));
  assert.equal(r.error, "bounce");
  assert.equal(r.defect, 'unknown argument "bogus" for read_bounties');
  assert.equal(r.hint, "this read takes no arguments");
  assert.deepEqual(a.calls, []);
});

test("PARITY · a DOCUMENTED argument answers exactly as before, top level or in the envelope", async () => {
  // The other half of the ruling: nothing a read declares may start bouncing.
  const a = spy();
  const good = await townApex({ read: "letters", args: { resident: "glitch", limit: 5 } }, key(), ctx({ call: a.call }));
  assert.deepEqual(good, { ok: "list_letters" }, "the flat verb's answer, untouched");
  assert.deepEqual(a.calls, [{ tool: "list_letters", fields: { resident: "glitch", limit: 5 } }]);
  // top-level fields have always merged at this door and still do
  const b = spy();
  await townApex({ read: "search", q: "lanterns" }, key(), ctx({ call: b.call }));
  assert.deepEqual(b.calls, [{ tool: "search_town", fields: { q: "lanterns" } }]);
});

test("PARITY · the numeric-string coercion rides through, so args: { limit: \"2\" } still pages", async () => {
  // The party-night fix (2026-08-08) lives in the same validator: clients and
  // models stringify numbers freely. A door that validated but did not carry
  // the coercion back would agree and then hand SQL a string — the half-fix.
  const a = spy();
  await townApex({ read: "letters", args: { limit: "2" } }, key(), ctx({ call: a.call }));
  assert.deepEqual(a.calls, [{ tool: "list_letters", fields: { limit: 2 } }]);
  assert.equal(typeof a.calls[0].fields.limit, "number", "coerced, not merely permitted");
});

test("PARITY · the stamps roster keeps its paging — the schema caught up to the code, it did not take a capability away", async () => {
  // `read_stamps` reads limit/offset (mcp.mjs § case "read_stamps") and the apex
  // has paged with them since the roster grew a page — measured on dev,
  // `shown 2, limit 2`. Only the SCHEMA did not know, so the flat tool refused
  // its own parameters by name. Validating the apex against a schema that still
  // did not know would have taken a working capability off residents.
  const a = spy();
  await townApex({ read: "stamps", args: { limit: 2, offset: 4 } }, key(), ctx({ call: a.call }));
  assert.deepEqual(a.calls, [{ tool: "read_stamps", fields: { limit: 2, offset: 4 } }]);
});

test("PARITY · the shadow read validates too, and `stamps` keeps its TEACHING bounce", async () => {
  const a = spy();
  const bad = await townApex({ read: "stake", args: { bogus: 1 } }, key(), ctx({ call: a.call }));
  assert.equal(bad.defect, 'unknown argument "bogus" for town_stake_read');
  assert.deepEqual(a.calls, []);
  // …while the one field a caller types here for a reason still gets the
  // sentence that tells them WHICH verb they wanted.
  const teaching = await townApex({ read: "stake", args: { mark: "wright/an-idea", stamps: 3 } }, key(), ctx({ call: spy().call }));
  assert.match(teaching.defect, /a read never performs/,
    "a sentence that says more than \"unknown argument\" must not be replaced by one that says less");
});

test("PARITY · every town read's tool is one the schema map can answer for", async () => {
  // The wiring this branch stands on: `schemas[spec.tool]` must resolve for all
  // eighteen reads, or the door answers 500 at a resident instead of here. This
  // is the falsifier for a read added tomorrow whose tool never joined TOOLS.
  const missing = Object.entries(TOWN_READS).filter(([, s]) => !(s.tool in schemas)).map(([r]) => r);
  assert.deepEqual(missing, [], "a read whose tool is absent from the flat list cannot be validated, and says so at runtime");
});

test("PARITY · an apex called WITHOUT its schema map says so — a validator that silently stops is the quiet failure", async () => {
  // CAN-FAIL: make the missing-schema branch fall through to `call(...)` and
  // this reddens by answering `{ ok: "read_town" }`.
  const a = spy();
  const r = await townApex({ read: "town" }, key(), { call: a.call });
  assert.equal(r.error, "bounce");
  assert.equal(r.code, 500, "a wiring defect is the office's, never the caller's");
  assert.match(r.hint, /ctx\.schemas/);
  assert.deepEqual(a.calls, []);
});
