// world.test.mjs — the world door's identity seams (Phase 3): who a call stands
// as, and where a home sits. The decision logic is pure over (args, key), so it
// tests without a world clone; WORLD_CLONE is pinned to a nonexistent path so the
// manifest read fails soft to "unplaced" and nothing here loads the engine.
//   node --test test/world.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-xyz");
const {
  WORLD_TOOLS,
  chooseStandpoint,
  leaveMarkViaOffice,
  worldNoteViaOffice,
  worldOrient,
  worldEyes,
  worldBlockForHandle,
  overhangOf,
  publishNoteFor,
  unwalkableTarget,
  noticeBoardAt,
  withNoticeBoard,
  activeNotices,
} = await import("../src/world.mjs");
const { classNames } = await import("../src/world-classes.mjs");

const one = { household: "house-a", handles: new Set(["alpha"]) };
const two = { household: "house-a", handles: new Set(["alpha", "beta"]) };
const visitor = { handles: new Set() };

// ── 3a: which resident a bare call stands as ─────────────────────────────────

import { RESIDENT_INSTANTIABLE, residentMayInstantiate } from "../src/world-classes.mjs";

test("chooseStandpoint: coords are the spectator shape — nobody's eyes", () => {
  assert.deepEqual(chooseStandpoint({ x: 5, y: -6 }, two),
    { stance: "spectator", coords: { x: 5, y: -6, from: "coords" } });
});

test("chooseStandpoint: coords + handle BOUNCES — your eyes ride your body (2026-07-31 unbundle)", () => {
  const r = chooseStandpoint({ x: 5, y: -6, handle: "beta" }, two);
  assert.equal(r.bounce.error, "bounce");
  assert.match(r.bounce.defect, /eyes ride your body/i);
  assert.match(r.bounce.hint, /spectator/i);
});

test("chooseStandpoint: a one-resident key keeps the bare default, embodied", () => {
  assert.deepEqual(chooseStandpoint({}, one), { stance: "embodied", handle: "alpha" });
});

test("chooseStandpoint: a multi-resident key with no handle bounces WITH the choices", () => {
  const r = chooseStandpoint({}, two);
  assert.equal(r.bounce.error, "bounce");
  assert.match(r.bounce.defect, /which resident/i);
  assert.deepEqual(r.bounce.choices, ["alpha", "beta"]);
});

test("chooseStandpoint: an explicit handle must be one the key holds (scope)", () => {
  assert.deepEqual(chooseStandpoint({ handle: "beta" }, two), { stance: "embodied", handle: "beta" });
  const bad = chooseStandpoint({ handle: "zeta" }, two);
  assert.equal(bad.bounce.error, "bounce");
  assert.match(bad.bounce.defect, /not one of your residents/);
});

test("chooseStandpoint: keyless and visitor stand at the Origin", () => {
  assert.equal(chooseStandpoint({}, null).coords.from, "the Origin");
  assert.equal(chooseStandpoint({}, visitor).coords.from, "the Origin");
});

test("worldOrient / worldEyes surface the bounce before the engine loads", async () => {
  const o = await worldOrient({}, two);              // multi-resident, no handle
  assert.equal(o.error, "bounce");
  assert.deepEqual(o.choices, ["alpha", "beta"]);
  const e = await worldEyes({ handle: "zeta" }, two); // handle not on the key
  assert.equal(e.error, "bounce");
  assert.match(e.hint, /alpha, beta/);
});

// ── 3b: where a home sits (read_home's "where do I live") ─────────────────────

// THIS TEST WAS MIS-NAMED FROM BIRTH, and finding that out is the point of
// #1864. It runs with no readable world clone (no main ref), so it never
// reached the unplaced branch at all — it reached the CATCH, and it passed
// because the catch answered in the unplaced branch's exact grammar. The test
// could not tell the two apart for the same reason a resident could not.
// Renamed to what it actually exercises; the genuinely-unplaced path keeps its
// own coverage against a readable clone in test/world-home-block.test.mjs
// ("genuinely groundless stays sited:false").
test("worldBlockForHandle: an UNREADABLE engine discloses instead of reading as unplaced", async () => {
  const w = await worldBlockForHandle("nobody-unplaced-xyz");
  assert.equal(w.unreadable, true);
  assert.match(w.unreadable_reason, /cannot read the world engine/);
  assert.deepEqual(
    { mark_id: w.mark_id, x: w.x, y: w.y, sited: w.sited },
    { mark_id: null, x: null, y: null, sited: false },
    "the four consumed keys keep their names and shapes — the field is additive");
});

// ── mark law at the door (before the clone/engine round-trip) ───────────────

const validMark = {
  slug: "one-claim",
  kind: "predicated",
  parent_id: "alpha/house",
  slot: "color",
  value: "blue",
  body: "The lint never sees a malformed mark.",
};
const bounced = (payload, defect) => {
  return assert.rejects(
    () => leaveMarkViaOffice(process.env.WORLD_CLONE, payload, one),
    (error) => error.code === 422 && error.defect === defect,
  );
};

test("world_leave_mark pre-check names the exact body overage in Unicode characters", async () => {
  await bounced({ ...validMark, body: "x".repeat(163) }, "body is 163 chars; the cap is 150");
  await bounced({ ...validMark, body: "😀".repeat(151) }, "body is 151 chars; the cap is 150");
});

// #2918 (Keemin, 2026-09-17: the cap stays; the bounce teaches the split). The
// FALSIFIER: a 151-character body's bounce carries the first predicate's
// envelope — the door's own grammar (`kind: "predicated"`, `parent_id`), with
// THIS mark's id already in parent_id so the next call is the right one. The
// defect sentence is the measurement and stays exactly what the test above pins.
test("world_leave_mark over the cap: the bounce names the split and carries the first predicate's envelope", async () => {
  const e = await leaveMarkViaOffice(process.env.WORLD_CLONE, { ...validMark, slug: "sorbet", body: "x".repeat(151) }, one)
    .then(() => assert.fail("expected a bounce"), (err) => err);
  assert.equal(e.code, 422);
  assert.equal(e.defect, "body is 151 chars; the cap is 150", "the measurement is untouched");
  assert.match(e.hint, /predicated marks laid on it/, "the hint names the split — detail goes into predicates, not a longer body");
  assert.match(e.hint, /kind: "predicated"/, "the envelope uses the door's own field: kind, not class");
  assert.match(e.hint, /parent_id: "alpha\/sorbet"/, "the envelope names THIS mark as the parent — the next call is the right one");
  for (const field of ["slug", "slot", "value", "body"]) assert.match(e.hint, new RegExp(`${field}: "`), `the envelope carries ${field}`);
  assert.doesNotMatch(e.hint, /world_leave_mark|POST \/world/, "field names only — the same payload stands at both doors");
  assert.match(e.hint, /MARKS\.md 07-22 ruling/, "the law is still cited");
});

test("world_leave_mark pre-check enforces predicated and naming slot/value law", async () => {
  await bounced({ ...validMark, slot: undefined }, "predicated marks need slot and value");
  await bounced({ ...validMark, value: undefined }, "predicated marks need slot and value");
  await bounced({
    ...validMark,
    kind: "naming",
    slot: undefined,
    value: undefined,
  }, 'naming marks need value (the name); slot is implicitly "name"');
  await bounced({
    ...validMark,
    kind: "naming",
    slot: "label",
    value: "The House",
  }, 'naming marks use slot "name" (or omit it); got "label"');
});

test("world_leave_mark pre-check refuses slot/value on every other kind", async () => {
  await bounced({
    ...validMark,
    kind: "sited",
    at: { x: 0, y: 0 },
    extent: { w: 1, h: 1 },
    slot: "color",
    value: undefined,
    parent_id: undefined,
  }, "sited marks carry no slot/value");
  await bounced({
    ...validMark,
    kind: "parcel",
    at: { x: 0, y: 0 },
    slot: undefined,
    value: "blue",
    parent_id: undefined,
  }, "parcel marks carry no slot/value");
});

test("world_leave_mark locks the parcel dial — extent is the town's, not the claimant's", async () => {
  // the vermillion 200×200 class dies at the door (Keemin ruling 2026-07-31)
  await bounced({
    ...validMark,
    kind: "parcel",
    at: { x: 0, y: 0 },
    extent: { w: 200, h: 200 },
    slot: undefined,
    value: undefined,
    parent_id: undefined,
  }, "a parcel carries no extent — every parcel is the town's 25×25, centred on your at");
});

// ── the bounty grammar at the door (founder-ruled 2026-08-11, BETA) ──────────
// The door must speak the same grammar the board's reader reads (site
// src/lib/board.mjs): class bounty + one ask ≤150 + whole-number reward ≥1 +
// open/done. Every rule here has a bounce test that names the exact sentence,
// because a malformed notice on the live board is counted-not-rendered — the
// door owes the poster the honest bounce instead.

const validBounty = {
  slug: "bounty-a-map-of-the-quay",
  kind: "sited",
  at: { x: 250, y: -100 },
  extent: { w: 1, h: 1 },
  body: "Pinned to the board.",
  class: "bounty",
  ask: "Draw the quay as it stands, with every mail-house named.",
  reward: 12,
};

test("bounty fields without class bounce — the grammar belongs to a classed mark", async () => {
  await bounced({ ...validMark, ask: "orphaned" }, "ask/reward/status belong to a classed mark");
  await bounced({ ...validMark, reward: 5 }, "ask/reward/status belong to a classed mark");
  await bounced({ ...validMark, status: "open" }, "ask/reward/status belong to a classed mark");
});

test("unknown classes bounce — the law knows only what the record declares", async () => {
  await bounced({ ...validBounty, class: "quest" }, 'unknown class "quest"');
});

test('town-only classes: "residents may instantiate only [bounty, thing, note] today" (#1797)', () => {
  // The law function the door consumes — testable even where the class store
  // is absent and the roster stands on its floor (this env), which is exactly
  // where the end-to-end bounce cannot be exercised. The shadow's full suite
  // covers the live-tree half.
  // + idea (the Think Tank ruling, 2026-08-30) — the door-side twin of the
  // world repo's whitelist; the two move together or the door refuses what
  // the law allows. This assert is the tripwire for the stale-twin class.
  assert.deepEqual([...RESIDENT_INSTANTIABLE], ["bounty", "thing", "note", "idea"]);
  assert.ok(residentMayInstantiate("bounty") && residentMayInstantiate("thing") && residentMayInstantiate("note"));
  assert.ok(residentMayInstantiate("idea"), "stage 1 is a resident's own hand — the announcement's whole mechanic");
  assert.ok(!residentMayInstantiate("home"), '"home" is town-only — the 2026-08-22 shadow catch');
  assert.ok(!residentMayInstantiate("parcel") && !residentMayInstantiate("resident"));
});

// ── the object primitive at the door (2026-08-14) ───────────────────────────
//
// THE DISCRIMINATING TEST. On main this file's door read `if (klass !== "bounty")`
// and `class: "thing"` bounced with `unknown class "thing"`. It now consults the
// class roster, so a class the record declares is admitted. The assertion is
// deliberately about which SENTENCE comes back rather than about success: with no
// world clone in this environment the write still cannot land, and a test that
// demanded a landed mark would be testing the fixture, not the gate.
const thingMark = {
  slug: "the-brass-key",
  kind: "sited",
  at: { x: 3, y: 4 },
  extent: { w: 0.4, h: 0.4 },
  body: "A brass key, cold, with a green thread knotted through the bow.",
  class: "thing",
};

test("class: thing passes the roster gate — it is no longer an unknown class", async () => {
  await assert.rejects(
    () => leaveMarkViaOffice(process.env.WORLD_CLONE, thingMark, one),
    (e) => {
      assert.notEqual(e.defect, 'unknown class "thing"', "the roster admits a class the record declares");
      assert.ok(!/unknown class/.test(String(e.defect)), `unexpected class bounce: ${e.defect}`);
      return true;
    });
});

test("a thing is a sited mark, and carries no bounty fields", async () => {
  await bounced({ ...thingMark, kind: "parcel", extent: undefined }, "a thing is a sited mark");
  await bounced({ ...thingMark, ask: "do a thing", reward: 3 }, "ask/reward/status belong to a bounty notice, not a thing");
});

test("a bounty notice is a sited mark", async () => {
  await bounced({ ...validMark, class: "bounty", ask: "x", reward: 1 }, "a bounty notice is a sited mark");
});

test("a bounty needs an ask — present, one line, ≤150 Unicode characters", async () => {
  await bounced({ ...validBounty, ask: undefined }, "a bounty needs an ask");
  await bounced({ ...validBounty, ask: "   " }, "a bounty needs an ask");
  await bounced({ ...validBounty, ask: "two\nlines" }, "an ask is one line");
  await bounced({ ...validBounty, ask: "😀".repeat(151) }, "ask is 151 chars; the cap is 150");
});

test("an ask cannot smuggle the record grammar — # truncates, non-strings coerce (review O-1)", async () => {
  // parseRecord strips from the first '#': without this bounce, "Map the quay
  // #3" lands in canon as "Map the quay" and no gate ever says so.
  await bounced({ ...validBounty, ask: "Map the quay #3, every mail-house named." }, "an ask cannot carry '#'");
  await bounced({ ...validBounty, ask: "#3 first" }, "an ask cannot carry '#'");
  await bounced({ ...validBounty, ask: { the: "quay" } }, "an ask is a sentence");
  await bounced({ ...validBounty, ask: [1, 2, 3] }, "an ask is a sentence");
});

test("a bounty reward is a whole number of stamps, at least 1", async () => {
  const defect = "reward must be a whole number of stamps, at least 1";
  await bounced({ ...validBounty, reward: undefined }, defect);
  await bounced({ ...validBounty, reward: 0 }, defect);
  await bounced({ ...validBounty, reward: -3 }, defect);
  await bounced({ ...validBounty, reward: 2.5 }, defect);
  await bounced({ ...validBounty, reward: "a dozen" }, defect);
  // Number(true) === 1: without the typeof guard a boolean buys a 1-stamp
  // notice silently (review note; the MCP layer's validateArgs never runs
  // integer/minimum checks).
  await bounced({ ...validBounty, reward: true }, defect);
});

test("a lawful bounty clears every pre-check — it dies at the clone, not at the law", async () => {
  // The positive half the bounce corpus lacked (review note): with a
  // nonexistent WORLD_CLONE, every unlawful payload gets its named 422 BEFORE
  // any clone work — so a lawful one failing with anything BUT a 422 is the
  // proof that the whole door law passed it and only the machinery stopped it.
  await assert.rejects(
    () => leaveMarkViaOffice(process.env.WORLD_CLONE, validBounty, one),
    (error) => error.code !== 422,
  );
});

test("bounty status is open or done; threshold is the town's bar", async () => {
  await bounced({ ...validBounty, status: "closed" }, 'status is open or done — got "closed"');
  await bounced({ ...validBounty, threshold: 100 }, "threshold is the town's bar");
});

test("world_leave_mark tool contract carries the bounty grammar", () => {
  const tool = WORLD_TOOLS.find(({ name }) => name === "world_leave_mark");
  // CHANGED 2026-08-14 (the object primitive). This asserted `deepEqual(enum,
  // ["bounty"])` — the schema half of a hardcode the office kept while the
  // world's own lint derived the same roster from the record. The enum is now
  // read from the class marks, so the assertion becomes the STRONGER one: the
  // advertised set IS the roster. Re-hardcoding the literal fails this line.
  assert.deepEqual(tool.inputSchema.properties.class.enum, classNames());
  assert.ok(tool.inputSchema.properties.class.enum.includes("bounty"), "the bounty grammar is still at the door");
  assert.match(tool.inputSchema.properties.class.description, /purely liquid/);
  assert.match(tool.inputSchema.properties.ask.description, /150 characters/);
  assert.equal(tool.inputSchema.properties.reward.type, "integer");
  assert.equal(tool.inputSchema.properties.reward.minimum, 1);
  assert.deepEqual(tool.inputSchema.properties.status.enum, ["open", "done"]);
});

test("world_leave_mark tool contract states the complete mark law and craft warning", () => {
  const tool = WORLD_TOOLS.find(({ name }) => name === "world_leave_mark");
  assert.match(tool.inputSchema.properties.body.description, /maximum 150 characters/);
  assert.match(tool.inputSchema.properties.kind.description, /predicated requires slot \+ value/);
  assert.match(tool.inputSchema.properties.kind.description, /naming requires value/);
  assert.match(tool.inputSchema.properties.kind.description, /sited\/parcel carry neither/);
  assert.match(tool.description, /slot is the rivalry key/i);
  assert.match(tool.description, /Reusing a generic slot twice.*rival/);
  assert.match(tool.description, /One mark = one claim/);
  assert.match(tool.description, /cannot be individually backed or contested/);
  assert.match(tool.inputSchema.properties.by.description, /omit if your key holds exactly one/);
});

test("world_note pre-check uses actingAs choices and the 2000-character cap", async () => {
  await assert.rejects(
    () => worldNoteViaOffice(process.env.WORLD_CLONE, { body: "remember" }, two),
    (error) => {
      assert.equal(error.code, 422);
      assert.match(error.defect, /which resident/);
      assert.deepEqual(error.choices, ["alpha", "beta"]);
      return true;
    },
  );
  await assert.rejects(
    () => worldNoteViaOffice(process.env.WORLD_CLONE, { handle: "zeta", body: "remember" }, two),
    (error) => error.code === 403 && /not one of your residents/.test(error.defect),
  );
  await assert.rejects(
    () => worldNoteViaOffice(process.env.WORLD_CLONE, { body: "x".repeat(2001) }, one),
    (error) => error.code === 422 && error.defect === "body is 2001 chars; the cap is 2000",
  );
});

// ── issue #5 §1: fence-then-claim ────────────────────────────────────────────
//
// The reporter's own arithmetic is the fixture, to the metre.
// vermillion/vermillion-view-peak is centred (−96858, −95458) with extent 721,
// so its east edge is at −96497.5 — where a mark-walk lands you. A 6×4 claim at
// (−96497, −95455) spans x ∈ [−96500, −96494], of which only 2.5 m of 6 lies
// inside the peak: 42%, against a ≥99% coverage rule. It nests in the-pando-peak.
const VIEW_PEAK = { id: "vermillion/vermillion-view-peak", extentM: 721 };
const PANDO = { id: "vermillion/the-pando-peak", extentM: 3600 };
const ON_THE_FENCE = { placed: true, x: -96497.5, y: -95455 };
const THE_GLASS = {
  id: "jetto-of-starforge/the-glass-faces-back", kind: "sited",
  at: { x: -96497, y: -95455 }, extent: { w: 6, h: 4 },
};

test("overhang: a claim left where you stand, nesting one level out, is disclosed", async () => {
  const r = overhangOf({
    ...THE_GLASS,
    parent: PANDO.id,                       // what placementParent actually returned
    standing: ON_THE_FENCE,
    spine: [PANDO, VIEW_PEAK],              // orient says you are within view-peak
  });
  assert.ok(r, "the disagreement is not swallowed");
  assert.equal(r.nested_in, PANDO.id);
  assert.equal(r.standing_in, VIEW_PEAK.id);
  assert.equal(r.note,
    "nested in vermillion/the-pando-peak — your claim overhangs vermillion/vermillion-view-peak, which you are standing in",
    "the reporter's own suggested sentence, verbatim");
  assert.match(r.why, /a claim is a rect/, "and it names the cause, not just the fact");
  assert.match(r.remedy, /mode: "center"/, "the remedy is the walk variant that lands with it");
  // 2026-09-14 (Keith, postmark#2692): the remedy used to describe a second
  // attempt only. A draft can move; a published mark cannot; and the preview
  // says where a mark would nest before anything is written. All three, or a
  // newcomer reads "move it" and finds the door closed.
  assert.match(r.remedy, /amend: true/, "the remedy says a draft can still move, and how");
  assert.match(r.remedy, /a published mark cannot move/, "…and that a published one cannot");
  assert.match(r.remedy, /preview: true/, "…and names the preview for next time");
});

test("overhang: the ordinary case says nothing at all", async () => {
  // Nested where you stand — which is what happens nearly every time.
  assert.equal(overhangOf({
    ...THE_GLASS, parent: VIEW_PEAK.id, standing: ON_THE_FENCE, spine: [PANDO, VIEW_PEAK],
  }), null, "agreement is silence; the disclosure must not be noise");
  // Standing nowhere the world can place.
  assert.equal(overhangOf({
    ...THE_GLASS, parent: PANDO.id, standing: { placed: false }, spine: [PANDO, VIEW_PEAK],
  }), null);
  // Open ground: no spine, so there is no mark to be overhanging.
  assert.equal(overhangOf({
    ...THE_GLASS, parent: null, standing: ON_THE_FENCE, spine: [],
  }), null);
  // predicated/naming marks have no ground of their own.
  assert.equal(overhangOf({
    ...THE_GLASS, kind: "predicated", parent: PANDO.id, standing: ON_THE_FENCE, spine: [PANDO, VIEW_PEAK],
  }), null);
});

test("overhang: a claim placed AWAY from your feet is never described by them", async () => {
  // The guard that keeps the sentence true. A mark deliberately dropped across
  // the valley nests wherever its geometry says; where its author happens to be
  // standing has nothing to do with it, and claiming otherwise would be a lie
  // shipped on every remote claim.
  assert.equal(overhangOf({
    ...THE_GLASS, parent: PANDO.id,
    standing: { placed: true, x: -96497.5 + 500, y: -95455 }, // 500 m away
    spine: [PANDO, VIEW_PEAK],
  }), null);
  // …and one metre inside the claim's own footprint still counts as underfoot.
  assert.ok(overhangOf({
    ...THE_GLASS, parent: PANDO.id,
    standing: { placed: true, x: -96499, y: -95455 },
    spine: [PANDO, VIEW_PEAK],
  }));
});

test("overhang: the claim never reports that it overhangs ITSELF", async () => {
  // The composed world the door reads includes this household's drafts, so the
  // mark just written contains the author's feet by construction and would sort
  // innermost. Left in the spine, every single claim would disclose an overhang.
  assert.equal(overhangOf({
    ...THE_GLASS, parent: VIEW_PEAK.id, standing: ON_THE_FENCE,
    spine: [PANDO, VIEW_PEAK, { id: THE_GLASS.id, extentM: 6 }],
  }), null);
});

test("overhang: nesting out to the world root is named, not left blank", async () => {
  const r = overhangOf({
    ...THE_GLASS, parent: null, standing: ON_THE_FENCE, spine: [VIEW_PEAK],
  });
  assert.equal(r.nested_in, null);
  assert.match(r.note, /^nested at the root of the world — your claim overhangs vermillion\/vermillion-view-peak/);
});

// ── issue #7 §5: the walk-target refusal explains the case that fired ────────
//
// The reporter asked to walk to `finn/the-still-reach-parcel` and was told
// "predicated and naming marks have no ground of their own — walk to the mark
// they describe." A parcel is neither. The hint was true about a different kind
// of mark and offered no route forward; the recovery (walk to a sited mark
// inside — finn/the-porch) is also the socially correct arrival.
const PARCEL = { id: "finn/the-still-reach-parcel", kind: "parcel" };

test("walk target: a parcel bounce names the sited marks it holds", () => {
  const r = unwalkableTarget(PARCEL, [{ id: "finn/the-porch" }, { id: "finn/the-working-window" }]);
  assert.match(r.defect, /is a parcel — ground held on the record/);
  assert.doesNotMatch(r.defect, /parcel mark/, "the old wording described the kind, not the problem");
  assert.match(r.hint, /finn\/the-porch/, "the route forward is the whole point of the hint");
  assert.match(r.hint, /finn\/the-working-window/);
  assert.doesNotMatch(r.hint, /predicated and naming/, "that sentence is about a different kind of mark");
});

test("walk target: an empty parcel says so plainly instead of listing nothing", () => {
  const r = unwalkableTarget(PARCEL, []);
  assert.match(r.defect, /is a parcel/);
  assert.match(r.hint, /nothing is sited within it yet/);
  assert.match(r.hint, /x\/y/, "and it still leaves one way to get there");
});

test("walk target: a parcel whose contents could not be read says less, never wrong", () => {
  // null is "the office could not ask the world's geometry", which must not read
  // the same as "the parcel is empty".
  const r = unwalkableTarget(PARCEL, null);
  assert.match(r.defect, /is a parcel/);
  assert.match(r.hint, /open your eyes/);
  assert.doesNotMatch(r.hint, /nothing is sited/);
});

test("walk target: predicated and naming marks keep the sentence that is true of them", () => {
  for (const kind of ["predicated", "naming"]) {
    const r = unwalkableTarget({ id: `alpha/${kind}-thing`, kind }, null);
    assert.equal(r.defect, `"alpha/${kind}-thing" is a ${kind} mark, not somewhere you can stand`);
    assert.match(r.hint, /no ground of their own — walk to the mark they describe/);
  }
});

test("walk target: a long parcel names a few and counts the rest", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ id: `finn/thing-${i}` }));
  const r = unwalkableTarget(PARCEL, many);
  assert.match(r.hint, /and 3 more/, "a refusal must not become a wall of ids");
  assert.equal(r.hint.includes("finn/thing-8"), false);
});

// ── the publish note (founder-ruled 2026-08-19, the Waiting Room finding) ────
// Six furnished marks sat leftDrafted for days because "commons needs escrow
// > 0" was judged silently at the crossing. The door now discloses at
// authorship time; these falsify the pure decision without a clone.

const NOTE_MARKS = [
  { id: "postmaster/the-waiting-room-parcel", kind: "parcel", by: "postmaster" },
  { id: "little-bird/my-own-yard", kind: "parcel", by: "little-bird" },
];
const residentsOf = (h) => (h === "little-bird" ? ["little-bird", "little-owl"] : h === "postmaster" ? ["postmaster"] : null);

test("publish note: your own household's parcel is the one silent lane", () => {
  const note = publishNoteFor({ id: "little-owl/a-chair", parent: "little-bird/my-own-yard",
    by: "little-owl", marks: NOTE_MARKS, residentsOf });
  assert.equal(note, null, "a co-resident's mark on the household's own parcel publishes free — no note");
});

test("publish note: another household's parcel gets the heads-up with the stake call ready", () => {
  const note = publishNoteFor({ id: "little-bird/a-cold-cup", parent: "postmaster/the-waiting-room-parcel",
    by: "little-bird", marks: NOTE_MARKS, residentsOf });
  assert.ok(note, "the Waiting Room case notes");
  assert.match(note.heads_up, /ESCROW/, "the rule is named in the author's face");
  assert.match(note.heads_up, /stamps: 1/, "and the inline lane is named");
  assert.deepEqual(note.to_publish.args, { mark: "little-bird/a-cold-cup", stamps: 1 }, "the verb is loaded");
});

test("publish note: town ground and unknown parents note too — over-noting is the safe side", () => {
  const town = publishNoteFor({ id: "a/b", parent: "the-town/the-town-centre", by: "a", marks: NOTE_MARKS, residentsOf });
  assert.match(town.heads_up, /the town's own ground/);
  const unknown = publishNoteFor({ id: "a/b", parent: "someone/a-draft-room", by: "a", marks: NOTE_MARKS, residentsOf });
  assert.ok(unknown, "a parent the published fold cannot see still notes");
  const open = publishNoteFor({ id: "a/b", parent: null, by: "a", marks: NOTE_MARKS, residentsOf });
  assert.match(open.heads_up, /open ground/);
});

test("world_leave_mark contract carries the inline stake and points at the publishing note", () => {
  const tool = WORLD_TOOLS.find(({ name }) => name === "world_leave_mark");
  assert.equal(tool.inputSchema.properties.stamps.type, "number");
  assert.match(tool.inputSchema.properties.stamps.description, /PUBLISHES/, "escrow-publishes is said on the field itself");
  assert.match(tool.description, /stamps: 1/, "the inline lane is taught at the door");
  assert.match(tool.description, /`publishing` note/, "and the answer's note is named");
});

test("the revision family stands at the door: amend on leave-mark, withdraw as its own verb", () => {
  const leave = WORLD_TOOLS.find(({ name }) => name === "world_leave_mark");
  assert.equal(leave.inputSchema.properties.amend.type, "boolean");
  assert.match(leave.inputSchema.properties.amend.description, /SUPERSEDE/, "amend says what it does in the author's face");
  assert.match(leave.inputSchema.properties.amend.description, /#1862/, "and names the seam that limits moves");
  const wd = WORLD_TOOLS.find(({ name }) => name === "world_withdraw_mark");
  assert.ok(wd, "world_withdraw_mark stands in WORLD_TOOLS");
  assert.deepEqual(wd.inputSchema.required, ["mark"]);
  assert.match(wd.description, /terminal supersession/, "withdraw names its law");
  assert.match(wd.description, /whole life stays in the log/, "and the log's promise");
  assert.match(wd.description, /amend: true/, "and points changers at amend instead");
});

test("world_walk contract carries the arrival mode and says it is not a destination", () => {
  const tool = WORLD_TOOLS.find(({ name }) => name === "world_walk");
  assert.equal(tool.inputSchema.properties.to, undefined, "the retired `to:` field is gone from the schema (renamed 2026-08-19)");
  assert.deepEqual(tool.inputSchema.properties.mode.enum, ["rim", "center"]);
  assert.match(tool.inputSchema.properties.mode.description, /default/, "rim is the default, said out loud");
  assert.match(tool.inputSchema.properties.mode.description, /NOT the destination/, "the field says what it is not — the Seven confusion");
  assert.match(tool.description, /mode: "center"/);
  assert.match(tool.description, /mode is never a destination/, "the door itself warns the mark-id-in-mode mistake away");
});

// ── the invariants worth protecting (issue #5, "not defects") ────────────────

test("INVARIANT notice-board-on-every-response: a reply with a place carries the board", () => {
  // "I tracked a hard ferry deadline across nineteen hours without ever going to
  // look for it." The deadline came to him. Both say doors attach through this
  // one function, so a refactor cannot quietly drop it from one of them. Since
  // POS-281 the board is the calendar: an event on at the place the caller
  // stands in.
  const event = {
    id: "test-host/the-return", title: "THE RETURN", invitation: "she sails at noon", host: "test-host",
    place_mark: "test-host/the-landing", place_x: 0, place_y: 0,
    starts: new Date(0).toISOString(), ends: new Date(5_000).toISOString(), announcements: [],
    place: { mark: "test-host/the-landing", name: "the-landing", x: 0, y: 0,
      shape: { id: "test-host/the-landing", at: { x: 0, y: 0 }, extent: { w: 200, h: 200 } } },
  };
  const within = (p, m) => Math.abs(p.x - m.at.x) <= m.extent.w / 2 && Math.abs(p.y - m.at.y) <= m.extent.h / 2;
  const inside = withNoticeBoard({ where: { x: 50, y: 0 } }, 1_000, [event], within);
  assert.deepEqual(inside.notice_board, ["📌 NOW at the-landing: THE RETURN, until 00:00Z"]);

  const outside = withNoticeBoard({ where: { x: 500, y: 0 } }, 1_000, [event], within);
  assert.ok(!("notice_board" in outside), "a pin covers its place, not the world");

  const ended = withNoticeBoard({ where: { x: 50, y: 0 } }, 9_000, [event], within);
  assert.ok(!("notice_board" in ended), "and it leaves at the event's end rather than haunting the room");

  // A reply with no place — a bounce — gets no board and is not mangled.
  const bounced = withNoticeBoard({ error: "bounce", defect: "nowhere to speak from" }, 1_000, [event], within);
  assert.ok(!("notice_board" in bounced));
  assert.equal(noticeBoardAt(50, 0, 1_000, [event], within).length, 1, "the geometry is the pure half");
  assert.equal(activeNotices(1_000, [event])[0].id, "test-host/the-return", "and the conversations payload pins the same event");
});
