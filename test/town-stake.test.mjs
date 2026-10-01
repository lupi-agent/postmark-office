// town-stake.test.mjs — the town door's stake gesture (2026-08-31).
//
//   node --test test/town-stake.test.mjs
//
// THE LAW every falsifier here quotes, VERBATIM from the world record rather
// than paraphrased — postmark-world, WORLD/marks/let-there-be-light/
// the-town-centre/the-keeping-works/postmark-edge/stake/mark.md, the class mark
// `the-town/stake` (v2, `subject: resident`, `object: mark`):
//
//   "A stake is ✦ held in escrow behind a mark — belief with weight, standing
//    until taken back, and the record keeps both the placing and the
//    withdrawal."
//
// and its child `the-town/stake-mark` (v1, `from-class: resident`,
// `to-class: mark`), .../postmark-edge/stake/stake-mark/mark.md:
//
//   "A mark stake is presence with weight — it raises the ✦ at the fold,
//    anchors the mark against retiring, and returns whole at the unstake."
//
// ── WHY NO NEW CONSTITUTIONAL ROW WAS PLANTED ───────────────────────────────
//
// The TDD-board method says: if the act needs a law row, plant it first and
// build to green. This act needs none, and the reason is readable in the two
// frontmatters above. The class types the act by its SUBJECT and its OBJECT — a
// resident, a mark — and says nothing whatever about which door the resident
// reaches through, because a door is office machinery and the record is the
// town's constitution. `world do: "stake"` already carries `blurb_from:
// "the-town/stake"` and `from: "the-town/resident"`; a town-door stake that
// dispatches to the same act is the SAME act granted by the same class, reached
// from a second doorway. Planting a `the-town/town-stake` row would have been
// writing the office's furniture into the constitution — the precise inversion
// classes.md forbids ("a door implementation is correct precisely insofar as it
// READS the class tree, and wrong wherever it hardcodes").
//
// What the record DID have to say was already said and already recorded: the
// 2026-08-30 ruling that the town door carries the stake gesture, target-typed.
// That was law when this build started; this build is its implementation.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { STAKE_LANES, ELSEWHERE, laneBounce, townStake, townUnstake, townStakeRead, TOWN_STAKE_TOOLS }
  from "../src/town-stake.mjs";
import { markClass } from "../src/world-classes.mjs";
import { NO_WORLD_DB, clearWorld, publishWorld } from "./helpers/world-rows.mjs";

// The guard reads the world graph snapshot (POS-270 lane W 3a): storeWith()
// publishes its rows as one, and world.db's path points nowhere.
process.env.WORLD_STORE_DB = NO_WORLD_DB;
import { WORLD_STAKE_TOOLS } from "../src/world-stake.mjs"; // POS-83: the one-owner check reads the world card rather than a typed copy of it

// THE CLASS BLURBS, verbatim, read by the falsifiers below rather than
// paraphrased into an assertion's message. A law a test spells in its own words
// is a law that can drift from the one the town keeps.
const STAKE_BLURB = "A stake is ✦ held in escrow behind a mark — belief with weight, standing until taken back, and the record keeps both the placing and the withdrawal.";
const STAKE_MARK_BLURB = "A mark stake is presence with weight — it raises the ✦ at the fold, anchors the mark against retiring, and returns whole at the unstake.";

// ── the fixture ─────────────────────────────────────────────────────────────
//
// The REAL columns, copied from the hydration's DDL and not invented — the
// lesson world-classes.mjs § freeCellIn already paid for once, in its own
// words: "a schema a test invents is a schema a test cannot falsify."
const tmp = () => mkdtempSync(join(tmpdir(), "town-stake-"));
function storeWith(rows) {
  const dir = tmp();
  const path = join(dir, "world.db");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT, by TEXT, tier TEXT, props TEXT,
             at_x REAL, at_y REAL, extent_w REAL, extent_h REAL)`);
  const ins = db.prepare("INSERT INTO nodes (id, kind, by, tier, props) VALUES (?, ?, ?, ?, ?)");
  for (const r of rows) ins.run(r.id, r.kind ?? "mark", r.by ?? "wright", r.tier ?? "market",
    JSON.stringify({ ...(r.class === undefined ? {} : { class: r.class }), ...(r.props ?? {}) }));
  db.close();
  publishWorld(path);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** A CLASS MARK as the record actually writes one — the constitution tier, the
 *  town's own hand, standing in the Keeping Works. Spelled out here because
 *  the first draft of this fixture had no Keeping Works in it at all, and that
 *  omission is precisely what let the type/instance leak below pass a green
 *  suite until a real hydrated store was pointed at the guard. */
const classMark = (klass) => ({
  id: `the-town/${klass}`, by: "the-town", tier: "constitution", class: klass,
  props: { in_works: 1, path: `WORLD/marks/…/the-keeping-works/postmark-edge/${klass}/mark.md` },
});

const IDEA = "wright/a-newcomers-first-hour";
const BOUNTY = "rei/paint-the-quay";
const HOME = "rei/the-lanternstep-house";
const PLAIN = "wright/a-sited-mark";

// ── THE LANES ───────────────────────────────────────────────────────────────
test("THE LANES ARE THE DOOR'S OWN TWO, and they grow by ruling", () => {
  assert.deepEqual([...STAKE_LANES], ["bounty", "idea"],
    "the two lanes this door also READS — town { read: \"bounties\" } and town { read: \"ideas\" }; a door whose acts and reads cover the same ground is a door a caller can hold in their head");
});

test("A BOUNTY AND AN IDEA PASS THE GUARD — the two lanes, by class", () => {
  const { path, cleanup } = storeWith([{ id: IDEA, class: "idea" }, { id: BOUNTY, class: "bounty", by: "rei" }]);
  try {
    assert.equal(laneBounce(IDEA), null, "an idea in the tank is this door's own lane");
    assert.equal(laneBounce(BOUNTY), null, "…and so is a bounty on the board");
  } finally { cleanup(); }
});

// CLASS, NOT GROUND — the design decision, pinned so a later hand that
// "completes" the guard with a ground check fails out loud instead of quietly
// refusing a bounty somebody tidied off the board. `bountyBoard` requires both
// because a LISTING read answers "what is standing here"; staking asks "may I
// put stamps behind this thing", and the class mark types that by class alone
// (`subject: resident, object: mark` — no ground in it).
test("CLASS, NOT GROUND: a bounty standing nowhere near the board still stakes here", () => {
  const { path, cleanup } = storeWith([{ id: BOUNTY, class: "bounty", by: "rei" }]);
  try {
    // The fixture holds no `contains` edge from the-town/the-bounty-board at
    // all — this mark is on no lane's ground — and the guard passes it anyway.
    assert.equal(laneBounce(BOUNTY), null,
      "a housekeeping move must not become a custody rule: its backers are still its backers");
  } finally { cleanup(); }
});

// ── THE REFUSALS, EACH TEACHING ITS OWN FACT ────────────────────────────────
test("REFUSED BY NAME: another class is named, and the door that does stake it is named beside it", () => {
  const { path, cleanup } = storeWith([{ id: HOME, class: "home", by: "rei" }]);
  try {
    const r = laneBounce(HOME);
    assert.equal(r.error, "bounce");
    assert.equal(r.code, 422);
    assert.match(r.defect, /is a home mark/, "the class is named BY NAME — not 'unsupported class'");
    assert.equal(r.class, "home");
    assert.deepEqual(r.lanes, ["bounty", "idea"]);
    assert.match(r.hint, /world \{ do: "stake"/, "…and the refusal teaches where the act DOES live");
    assert.ok(r.hint.includes(ELSEWHERE), "one sentence, so the refusal and the card cannot drift");
  } finally { cleanup(); }
});

// ── THE TYPE IS NOT AN INSTANCE OF ITSELF ───────────────────────────────────
//
// FOUND LIVE, not by review. Pointed at a store hydrated from postmark-world
// main (47e0c9b8) the guard admitted `the-town/idea` and `the-town/bounty` —
// the constitution marks that DEFINE the two lanes — because a class mark
// declares the class it is, and a guard typing by class alone cannot tell the
// law from an instance of it. The fixtures above had no Keeping Works in them,
// which is exactly how this survived a green suite: the invented schema could
// not represent the thing that breaks the rule.
//
// It is a SCOPE rule, not a custody one. The world door still stakes a class
// mark for anyone who means to, on the same escrow with the same custody. What
// this door refuses is letting "back this idea" land on the law that types
// ideas.
test("THE TYPE/INSTANCE SEAM: the class mark that defines a lane is not a mark standing in it", () => {
  const { path, cleanup } = storeWith([
    classMark("idea"), classMark("bounty"), classMark("home"),
    { id: IDEA, class: "idea" }, { id: BOUNTY, class: "bounty", by: "rei" },
  ]);
  try {
    for (const [id, klass, lane] of [["the-town/idea", "idea", "ideas"], ["the-town/bounty", "bounty", "bounties"]]) {
      const r = laneBounce(id);
      assert.equal(r?.code, 422, `${id} carries class:${klass} and must STILL be refused — it is the law, not a notice`);
      assert.match(r.defect, /is the class mark that DEFINES/);
      assert.equal(r.defines_class, true);
      assert.match(r.hint, new RegExp(`town \\{ read: "${lane}" \\}`), "…and the refusal names the read that lists what this door DOES stake");
    }
    // and the instances beside them are untouched — the seam narrows nothing else
    assert.equal(laneBounce(IDEA), null);
    assert.equal(laneBounce(BOUNTY), null);
    // ORDER MATTERS, and this is the falsifier for it. `the-town/home` is a
    // class mark too. Asking "is this a class mark?" before "is this class one
    // of my lanes?" would answer a caller holding a HOME with a sentence about
    // the home *lane* — a lane this door does not have and must not appear to.
    // Not-my-lane is answered as not-my-lane; the seam only ever speaks about
    // the two classes it can be reached holding.
    const home = laneBounce("the-town/home");
    assert.equal(home.code, 422);
    assert.match(home.defect, /is a home mark — the town door stakes its own lanes/,
      "a refusal that invents a lane to explain itself is worse than a blunt one");
    assert.doesNotMatch(home.defect, /DEFINES/);
    assert.equal(home.defines_class, undefined);
    // markClass names the seam itself, from the roster gate rather than a
    // retyped tier check, so one definition moves both readers
    assert.equal(markClass("the-town/idea").defines_class, true);
    assert.equal(markClass(IDEA).defines_class, false);
  } finally { cleanup(); }
});

test("A CLASSLESS MARK is refused for what it is, not for what it isn't", () => {
  const { path, cleanup } = storeWith([{ id: PLAIN }]);
  try {
    const r = laneBounce(PLAIN);
    assert.equal(r.code, 422);
    assert.match(r.defect, /carries no class/,
      "an ordinary sited mark has no class to name, so the refusal names the absence rather than inventing a class for it");
    assert.equal(r.class, null);
  } finally { cleanup(); }
});

// THE THREE RUNGS ARE THREE DIFFERENT ANSWERS. This is the falsifier that
// matters most, because collapsing the bottom two is the failure world-classes
// exists to refuse twice: "a silent fallback is indistinguishable from
// success." A mark the record does not hold is a 404 the caller can act on; a
// record that could not be read is a 503 that says nothing about the mark. A
// door answering both as "not a bounty" would refuse a lawful stake for a
// hydration blip and call it a lane rule.
test("THE THREE RUNGS: absent mark is 404, unreadable store is 503, and they never wear each other's sentence", () => {
  const { path, cleanup } = storeWith([{ id: IDEA, class: "idea" }]);
  try {
    const absent = laneBounce("nobody/never-was");
    assert.equal(absent.code, 404);
    assert.match(absent.defect, /stands in the town's published record/);
    assert.match(absent.hint, /your own unpublished drafts are not in it yet/,
      "…and it says WHY a draft is missing, because backing your own draft is what publishes it and that happens at the world door");

    const blind = (clearWorld(), laneBounce(IDEA));
    assert.equal(blind.code, 503);
    assert.match(blind.defect, /could not read the record/);
    assert.match(blind.hint, /Nothing was staked/, "a caller must never be left guessing whether escrow moved");
    assert.notEqual(blind.code, absent.code, "the two rungs are two answers — collapsing them is the whole defect");
  } finally { cleanup(); }
});

test("markClass keeps the rungs apart at the source", () => {
  const { path, cleanup } = storeWith([{ id: IDEA, class: "idea" }, { id: PLAIN }]);
  try {
    assert.deepEqual({ known: true, found: true, class: "idea" },
      { known: markClass(IDEA).known, found: markClass(IDEA).found, class: markClass(IDEA).class });
    const plain = markClass(PLAIN);
    assert.equal(plain.found, true, "the record ANSWERED — a mark with no class is found, not missing");
    assert.equal(plain.class, null);
    const gone = markClass("nobody/never-was");
    assert.equal(gone.known, true); assert.equal(gone.found, false);
    const blind = (clearWorld(), markClass(IDEA));
    assert.equal(blind.known, false, "…and an unreadable store knows nothing, rather than answering false");
    assert.match(blind.disclosed, /no world store/);
  } finally { cleanup(); }
});

// ── THE GUARD RUNS BEFORE THE LEDGER IS TOUCHED ─────────────────────────────
//
// The property that matters for custody: a refused stake must not have reached
// the escrow machinery at all. Proven by pointing the guard at a store where
// the mark is the wrong class and asserting the ANSWER is the lane bounce —
// which it can only be if the wrapper returned before `worldStakeViaOffice`,
// whose own bounces (identity, stamps, mark existence) read entirely
// differently.
test("NOTHING REACHES THE LEDGER through a refused lane — the guard is first, not a filter after", async () => {
  const { path, cleanup } = storeWith([{ id: HOME, class: "home", by: "rei" }]);
  try {
    const staked = await townStake({ mark: HOME, stamps: 2, handle: "wright" }, null);
    assert.equal(staked.code, 422);
    assert.match(staked.defect, /is a home mark/);
    assert.equal(staked.class, "home");
    const back = await townUnstake({ mark: HOME, stamps: 2, handle: "wright" }, null);
    assert.equal(back.code, 422, "unstake carries the SAME guard — a lane you cannot stake is a lane you have nothing in");
    assert.match(back.defect, /is a home mark/);
  } finally { cleanup(); }
});

test("no mark named at all bounces before the record is even consulted", async () => {
  const staked = await (clearWorld(), townStake({ stamps: 1 }, null));
  assert.equal(staked.code, 422);
  assert.match(staked.defect, /which mark\?/);
  assert.match(staked.hint, /bounty or idea/, "…and the ask names the lanes, so the next call can be right");
  const read = await (clearWorld(), townStakeRead({}));
  assert.equal(read.code, 422);
  assert.match(read.hint, /town \{ read: "stake"/);
});

// ── THE SHADOW IS THE ACT'S SHADOW ──────────────────────────────────────────
test("THE READ IS GUARDED LIKE THE ACT — and the refusal redirects rather than withholds", async () => {
  const { path, cleanup } = storeWith([{ id: HOME, class: "home", by: "rei" }]);
  try {
    const r = await townStakeRead({ mark: HOME });
    assert.equal(r.code, 422,
      "a town read that answered for a mark this door can never stake would teach the caller the door is wider than it is");
    assert.match(r.hint, /world \{ do: "stake"/,
      "…and nothing is withheld: escrow is public, and the door that answers it unscoped is named");
  } finally { cleanup(); }
});

// ── ONE OWNER, AND THE PROOF IS IN THE LEDGER ROW ───────────────────────────
//
// The town engine writes a world-mark stake as
//
//     - <date> · <handle> → stake:world-mark/<mark> · <n> · via: <api|mail:id>
//
// (postmark, tools/stamp-mint.mjs § worldStakeLine) and folds it in
// `foldWorldMarkPositions`, which keys on kind/mark/handle/n and reads `via`
// for BALLOT stakes only, to dedupe mail-carried ones. So a town-door stake and
// a world-door stake are the same row, and no consumer of mark escrow —
// settlement, the retirement gate, the forecast, the portfolio slice, the
// site's board — has anything to tell them apart BY. This test pins the reason
// that is true: there is exactly one function, and the town door calls it.
test("ONE OWNER: the town verbs are wrappers over the world door's own act, not a second escrow", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/town-stake.mjs", import.meta.url), "utf8"));
  assert.match(src, /import \{ worldStakeViaOffice, worldUnstakeViaOffice, worldStakeRead \} from "\.\/world-stake\.mjs"/,
    "the escrow machinery is IMPORTED, never restated");
  for (const forbidden of ["appendSigned", "worldStakeLine", "stamp-ledger", "execUnderTownLock", "world-stake-exec"]) {
    assert.ok(!src.includes(forbidden),
      `town-stake.mjs must not touch ${forbidden} — a second path to the ledger is a second custody rule, whatever its author intended`);
  }
  // and the fields ride through unrenamed, which is what leaves nothing to drift.
  //
  // ⚑ ASKED OF THE WORLD DOOR'S OWN CARD, not of a typed list (POS-83). This
  // read `["mark", "stamps", "handle"]` — a second hardcoded copy of the very
  // thing it exists to stop drifting, and it reddened the day the world card
  // grew `preview` even though both cards grew it together, which is the drift
  // NOT happening. A check that names the other door's fields cannot tell a
  // divergence from a matched addition; one that READS them can.
  const tool = TOWN_STAKE_TOOLS.find((t) => t.name === "town_stake");
  const worldTool = WORLD_STAKE_TOOLS.find((t) => t.name === "world_stake");
  assert.deepEqual(Object.keys(tool.inputSchema.properties), Object.keys(worldTool.inputSchema.properties),
    "the world stake card's own words — a translation layer would be a place for the two doors to disagree");
  assert.deepEqual(tool.inputSchema.required, worldTool.inputSchema.required);
  assert.deepEqual(tool.inputSchema.required, ["mark", "stamps"], "…and they are still these two");
  const untool = TOWN_STAKE_TOOLS.find((t) => t.name === "town_unstake");
  const worldUntool = WORLD_STAKE_TOOLS.find((t) => t.name === "world_unstake");
  assert.deepEqual(Object.keys(untool.inputSchema.properties), Object.keys(worldUntool.inputSchema.properties),
    "the withdrawal half rides through unrenamed too — it was never asked, and it is the half that returns a resident's stamps");
});

test("THE PAIR, quoting the class: placing and withdrawal both stand at this door", () => {
  assert.match(STAKE_BLURB, /standing until taken back/);
  assert.match(STAKE_BLURB, /the record keeps both the placing and the withdrawal/);
  assert.match(STAKE_MARK_BLURB, /returns whole at the unstake/);
  const names = TOWN_STAKE_TOOLS.map((t) => t.name);
  assert.ok(names.includes("town_stake"), "the placing");
  assert.ok(names.includes("town_unstake"),
    "…and the withdrawal. Escrow placed at a door with no matching release is escrow trapped for anyone who only knows that door");
  assert.ok(names.includes("town_stake_read"), "…and the shadow, because anything you can do here you can read here");
});

// THE READ IS A READ. `world_stake_read` is deliberately outside WRITE_TOOLS
// ("escrow is public — as open as the ✦weight it produces"); its town twin must
// be too, or the same public fact would need a credential at one door and not
// the other.
test("the read stays a read at both doors: town_stake_read is not a WRITE_TOOL", async () => {
  const { WRITE_TOOLS } = await import("../src/mcp.mjs");
  assert.equal(WRITE_TOOLS.has("town_stake_read"), false, "escrow is public at both doors or neither");
  assert.equal(WRITE_TOOLS.has("world_stake_read"), false, "…and this is the twin it matches");
  assert.ok(WRITE_TOOLS.has("town_stake"), "the ACTS are credentialed, exactly as world_stake is");
  assert.ok(WRITE_TOOLS.has("town_unstake"));
  assert.ok(WRITE_TOOLS.has("town_post"),
    "and town_post joined them — it publishes a mark and stakes 1✦, and had been reachable flat with no auth challenge");
});
