// quest-standing-fold.test.mjs — the hydrate fold's six rules, watched at last.
//
// WHY THIS FILE EXISTS. The reviewer's repair 1: the fold that builds
// `quest_standing` shipped inside `src/hydrate.mjs`, a script nothing can
// import and nothing in the office suite executes. The one test that touches
// hydrate reads it as TEXT. So the shared ledger parse, the first-each-way
// maps, the self-mail treatment, the `qualifies` filter, `since` as the
// EARLIEST crossing rather than the deepest, and the `depth: null` that tells
// an unsealed ladder from an unearned one were watched by nothing, and every
// one of them could be inverted without a red.
//
// The rules now live in `src/quest-standing.mjs` as pure functions, and these
// drive the real exports. Each assertion below names the flip that reds it.

import test from "node:test";
import assert from "node:assert/strict";
import { firstEachWay, depthByHandle, standingRow, standingRowsFor, standingRowsFromTown } from "../src/quest-standing.mjs";

const D = (date, from, to, id) => ({ date, from, to, id: id ?? `${from}-${date}-to-${to}` });

// ── firstEachWay: the two mail dates ─────────────────────────────────────────

test("the first delivery each way is the EARLIEST, not the latest", () => {
  const { sent, received } = firstEachWay([
    D("2026-06-12", "wright", "limen"),
    D("2026-07-01", "wright", "iris"),
    D("2026-06-20", "nyx", "wright"),
    D("2026-08-01", "cipher", "wright"),
  ]);
  assert.equal(sent.get("wright").date, "2026-06-12",
    "the ledger is in delivery order, so the FIRST row seen is the earliest — a flip to `set` unconditionally makes this the last");
  assert.equal(received.get("wright").date, "2026-06-20");
  assert.equal(sent.get("wright").id, "wright-2026-06-12-to-limen", "and the row's own id rides along");
});

test("SELF-MAIL COUNTS, because the town's own fact counts it", () => {
  // The rule this asserts, and the reason it is the assertion rather than its
  // opposite: `onboardingFactsFor` answers `sent: rows.some(d => d.from ===
  // handle)` with no self-check, and the registry's derivation for
  // `first-letter-out` says "at least one delivery whose sender is you". The
  // first cut skipped self-mail here, borrowing the MINT's rule for a CHECKLIST
  // fact — so the town said done and this office said undated, and the row wore
  // a note claiming the record does not date a letter the ledger dates exactly.
  const { sent, received } = firstEachWay([D("2026-09-01", "solo", "solo")]);
  assert.equal(sent.get("solo").date, "2026-09-01",
    "restore `if (d.from === d.to) continue;` and this is undefined — the divergence the reviewer found");
  assert.equal(received.get("solo").date, "2026-09-01");
});

test("a handle with no mail at all is simply absent, never a fabricated date", () => {
  const { sent, received } = firstEachWay([D("2026-09-01", "a", "b")]);
  assert.equal(sent.get("b"), undefined);
  assert.equal(received.get("a"), undefined);
});

// ── depthByHandle: the milestone reduction ───────────────────────────────────

const pair = (a, b, over = {}) => ({
  a, b, eachWay: 5, qualifies: true,
  rungs: [{ threshold: 5, achieved: true, date: "2026-08-04" }, { threshold: 10, achieved: false, date: null }],
  ...over,
});

test("`since` is the EARLIEST rung this resident crossed, never the deepest", () => {
  const d = depthByHandle({
    active: true,
    pairs: [
      pair("wright", "little-bird", { eachWay: 8, rungs: [{ threshold: 5, achieved: true, date: "2026-08-04" }] }),
      pair("cipher", "wright", { eachWay: 12, rungs: [{ threshold: 5, achieved: true, date: "2026-08-12" }, { threshold: 10, achieved: true, date: "2026-09-01" }] }),
    ],
  });
  const w = d.get("wright");
  assert.equal(w.since, "2026-08-04",
    "the day the milestone became theirs. Flip `r.date < st.since` to `>` and this reads 2026-09-01 — the day of the deepest rung, which is a different fact");
  assert.equal(w.best, 10, "and `best` IS the deepest rung");
  assert.equal(w.eachWay, 12, "and `eachWay` is the deepest reach with any ONE correspondent");
});

test("a NON-QUALIFYING pair contributes nothing at all — not its reach, not its rungs", () => {
  const d = depthByHandle({
    active: true,
    pairs: [pair("wright", "housemate", { eachWay: 40, qualifies: false })],
  });
  assert.equal(d.get("wright"), undefined,
    "same roof or a meep on one side: the pair can never mint, so it must never appear as progress toward an award it cannot earn. Delete the `if (!p.qualifies) continue` and this is a reach of 40");
});

test("a qualifying pair with no rung crossed is reach without a milestone", () => {
  const d = depthByHandle({
    active: true,
    pairs: [pair("a", "b", { eachWay: 3, rungs: [{ threshold: 5, achieved: false, date: null }] })],
  });
  assert.equal(d.get("a").eachWay, 3);
  assert.equal(d.get("a").best, 0);
  assert.equal(d.get("a").since, null);
  assert.deepEqual(d.get("a").friends, []);
});

test("both sides of a pair are credited, each with the OTHER named", () => {
  const d = depthByHandle({ active: true, pairs: [pair("aa", "bb")] });
  assert.equal(d.get("aa").friends[0].with, "bb");
  assert.equal(d.get("bb").friends[0].with, "aa");
});

test("an UNSEALED ladder yields nothing, and the caller turns that into `depth: null`", () => {
  assert.equal(depthByHandle({ active: false, pairs: [pair("a", "b")] }).size, 0);
  assert.equal(depthByHandle(null).size, 0);
});

test("friends are ordered deepest rung first, deterministically", () => {
  const d = depthByHandle({
    active: true,
    pairs: [
      pair("me", "zed", { rungs: [{ threshold: 5, achieved: true, date: "2026-08-01" }] }),
      pair("me", "abe", { rungs: [{ threshold: 10, achieved: true, date: "2026-09-01" }] }),
    ],
  });
  assert.deepEqual(d.get("me").friends.map((f) => f.with), ["abe", "zed"]);
});

// ── standingRow / standingRowsFor: what the index stores ─────────────────────

const FACTS = { card: true, home: true, window: false, sent: true, received: false };

test("an unsealed ladder stores depth:null, NOT a zeroed object", () => {
  const unsealed = standingRow("a", { facts: FACTS, first: firstEachWay([]), depth: new Map(), ladderActive: false });
  assert.equal(unsealed.depth, null,
    "a rule the town has not started and a resident who has earned nothing are different facts, and only the null carries the difference to the door");
  const sealed = standingRow("a", { facts: FACTS, first: firstEachWay([]), depth: new Map(), ladderActive: true });
  assert.deepEqual(sealed.depth, { eachWay: 0, best: 0, since: null, friends: [] },
    "a sealed ladder with no crossings IS a real zero");
});

test("the row carries the town's facts through unaltered, plus the four date fields", () => {
  const row = standingRow("wright", {
    facts: FACTS,
    first: firstEachWay([D("2026-06-12", "wright", "limen"), D("2026-06-20", "nyx", "wright")]),
    depth: new Map(), ladderActive: true,
  });
  for (const [k, v] of Object.entries(FACTS)) assert.equal(row[k], v, `fact ${k} must survive the fold`);
  assert.equal(row.sent_since, "2026-06-12");
  assert.equal(row.received_since, "2026-06-20");
  assert.equal(row.sent_via, "wright-2026-06-12-to-limen");
  assert.equal(row.received_via, "nyx-2026-06-20-to-wright");
});

test("standingRowsFor asks the town for each handle's facts and folds one row each", () => {
  const asked = [];
  const rows = standingRowsFor(["a", "b"], {
    deliveries: [D("2026-09-01", "a", "b")],
    friendships: { active: true, pairs: [pair("a", "b")] },
    factsFor: (h) => { asked.push(h); return { ...FACTS }; },
  });
  assert.deepEqual(asked, ["a", "b"], "every handle's facts come from the TOWN's fold, one call each");
  assert.equal(rows.size, 2);
  assert.equal(rows.get("a").sent_since, "2026-09-01");
  assert.equal(rows.get("a").received_since, null, "a wrote; a was not written to");
  assert.equal(rows.get("b").received_since, "2026-09-01");
  assert.equal(rows.get("a").depth.since, "2026-08-04");
});

test("the fold survives an empty town without inventing a row", () => {
  const rows = standingRowsFor([], { deliveries: [], friendships: { active: false, pairs: [] }, factsFor: () => ({}) });
  assert.equal(rows.size, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// standingRowsFromTown — the folds happen ONCE per rehydrate (POS-133)
//
// THE DEFECT THESE WATCH. `onboardingFactsFor(repo, handle, { deliveries })`
// answers its `welcome` fact from `households ?? currentHouseholds(repo)` and
// `welcomed ?? welcomedHouseholds(repo, roll)`. Omit those two and ONE
// resident's boolean costs THREE parses of the 13k-line stamp ledger, plus a
// re-walk of every WHITE_PAGES room. Measured on the live town clone at 182
// residents: 548 ledger parses / ~43 s, against 5 / ~0.9 s with the folds
// handed down, and all 182 rows byte-identical. The block's own comment already
// guarded the deliveries parse; the welcome row arrived on 2026-09-14 through
// the argument nobody passed.
//
// The claim is NOT "one parse per rehydrate" — `foldFriendships` parses the
// ledger twice on its own and `currentHouseholds` twice more, so the block's
// floor is five and always was. The claim is that the count does not GROW with
// the resident count, which is why every case below drives two handle-set sizes
// and compares, rather than asserting a constant it could satisfy by accident.
// ═══════════════════════════════════════════════════════════════════════════

/** A town module surface that counts how often each fold was asked for. */
function countingTools({ welcome = true } = {}) {
  const calls = { parseDeliveries: 0, foldFriendships: 0, currentHouseholds: 0, welcomedHouseholds: 0, facts: [] };
  const HOUSEHOLDS = new Map([["a", { key: "gh:1" }], ["b", { key: "gh:2" }]]);
  const WELCOMED = new Set(["gh:1"]);
  const tools = {
    parseDeliveries: () => { calls.parseDeliveries++; return [D("2026-09-01", "a", "b")]; },
    foldFriendships: () => { calls.foldFriendships++; return { active: true, pairs: [pair("a", "b")] }; },
    onboardingFactsFor: (repo, handle, opts) => {
      calls.facts.push({ handle, opts });
      // THE STUB ANSWERS THE TOWN'S REAL ENVELOPE, and that is the whole reason
      // the count case above can fail. `onboardingFactsFor`'s own body is
      // `households ?? currentHouseholds(repo)` / `welcomed ??
      // welcomedHouseholds(repo, roll)` — it RE-RESOLVES when the arguments are
      // absent, which is the defect. A stub that fell back to a captured
      // constant instead would leave the fold count at one under the flip too,
      // and the case would be a decorative assertion. Measured on the live
      // clone, this fallback is three ledger parses per head.
      const roll = opts?.households ?? (tools.currentHouseholds ? tools.currentHouseholds(repo) : HOUSEHOLDS);
      const paid = opts?.welcomed ?? (tools.welcomedHouseholds ? tools.welcomedHouseholds(repo, roll) : WELCOMED);
      return { ...FACTS, welcomed: paid.has(roll.get(handle)?.key ?? `solo:${handle}`) };
    },
  };
  if (welcome) {
    tools.currentHouseholds = () => { calls.currentHouseholds++; return HOUSEHOLDS; };
    tools.welcomedHouseholds = () => { calls.welcomedHouseholds++; return WELCOMED; };
  }
  return { tools, calls, HOUSEHOLDS, WELCOMED };
}

const HANDLES_MANY = Array.from({ length: 50 }, (_, i) => `h${i}`);

test("POS-133 · the town's folds are asked for ONCE, however many residents there are", () => {
  const one = countingTools();
  standingRowsFromTown(one.tools, "/town", ["a"]);
  const many = countingTools();
  standingRowsFromTown(many.tools, "/town", HANDLES_MANY);

  assert.equal(many.calls.facts.length, 50, "control: the facts really were asked for all fifty — a fold that asked for none would satisfy every count below");
  assert.deepEqual(
    { d: many.calls.parseDeliveries, f: many.calls.foldFriendships, c: many.calls.currentHouseholds, w: many.calls.welcomedHouseholds },
    { d: 1, f: 1, c: 1, w: 1 },
    "fifty residents, one of each fold");
  assert.deepEqual(
    { d: one.calls.parseDeliveries, f: one.calls.foldFriendships, c: one.calls.currentHouseholds, w: one.calls.welcomedHouseholds },
    { d: many.calls.parseDeliveries, f: many.calls.foldFriendships, c: many.calls.currentHouseholds, w: many.calls.welcomedHouseholds },
    "and one resident costs exactly what fifty do — the count is constant, not per-resident. Flip: drop `households`/`welcomed` from the object handed to onboardingFactsFor and this reads 51 against 2, because the stub re-resolves exactly as the town's own body does");
});

test("POS-133 · every resident's facts call carries the SAME folded roll and welcomed set", () => {
  const { tools, calls, HOUSEHOLDS, WELCOMED } = countingTools();
  standingRowsFromTown(tools, "/town", HANDLES_MANY);
  assert.equal(calls.facts.length, 50, "control: fifty calls to check");
  for (const c of calls.facts) {
    assert.ok(c.opts, `${c.handle}: the facts call must carry an options object at all`);
    assert.equal(c.opts.households, HOUSEHOLDS, `${c.handle}: the roll handed down must BE the folded one, not a re-resolution`);
    assert.equal(c.opts.welcomed, WELCOMED, `${c.handle}: the welcomed set handed down must BE the folded one`);
    assert.ok(Array.isArray(c.opts.deliveries), `${c.handle}: the deliveries parse the block already shared is still handed down`);
  }
});

test("POS-133 · the answers do not move: folded-down and town-resolved agree row for row", () => {
  // The two shapes over the SAME stub town: one where the fold hands the roll
  // down, one where the tools cannot supply it and `onboardingFactsFor` falls
  // back to its own — which is what an older checkout does. Byte-identical rows
  // is the whole permission for the change.
  const folded = countingTools({ welcome: true });
  const own = countingTools({ welcome: false });
  const a = standingRowsFromTown(folded.tools, "/town", ["a", "b"]).rows;
  const b = standingRowsFromTown(own.tools, "/town", ["a", "b"]).rows;
  assert.equal(a.size, 2, "control: rows were actually produced — an empty map compares equal to an empty map");
  assert.equal(JSON.stringify([...a]), JSON.stringify([...b]),
    "the welcome row reads the same whether the roll was folded once or resolved per resident");
  assert.equal(a.get("a").welcomed, true, "control: the fixture's welcome fact is not uniformly false");
  assert.equal(a.get("b").welcomed, false, "…nor uniformly true — so a roll handed down wrong would show");
});

test("POS-133 · a checkout too old to export the two folds still writes rows, with nothing under it", () => {
  const { tools, calls } = countingTools({ welcome: false });
  const { rows } = standingRowsFromTown(tools, "/town", ["a", "b"]);
  assert.equal(rows.size, 2, "the old checkout still gets its standing rows");
  assert.equal(calls.facts.length, 2);
  for (const c of calls.facts) {
    assert.equal(c.opts.households, undefined, "and `undefined` is exactly what onboardingFactsFor already treats as 'resolve your own' — the old behaviour, not a fallback added under a new road");
    assert.equal(c.opts.welcomed, undefined);
  }
});

test("POS-133 · the friendships fold is handed back, because the block's own log line reads it", () => {
  const { tools } = countingTools();
  const { friendships } = standingRowsFromTown(tools, "/town", ["a"]);
  assert.equal(friendships.active, true, "hydrate prints `N friendship pairs` or `ladder not sealed` off this object; returning only the rows would have made that line unwritable");
  assert.equal(friendships.pairs.length, 1);
});
