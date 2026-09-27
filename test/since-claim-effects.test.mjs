// since-claim-effects.test.mjs — the backlog's own clause, made true.
//
// THE LAW, verbatim, from `LOGOS/the-response-function § Residents: words, at
// their own pace` — the clause the w38 plan of record names as the one the town
// is breaking:
//
//   the resident's loop is "a replayable, cursor-ordered read of every effect
//   on your own node since you last looked"
//
// THE ANSWER THAT BROKE IT, from the 2026-09-06 05:53 EDT walk, after a staked
// mark had lived through two crossings:
//
//   happened.to_you: { complete: true, note: "complete by construction — frame
//   events are rare, so yours are never truncated", count: 0, events: [] }
//   happened.town.headlines: []
//
// Two promises in one object, both empty, both wrong: a completeness guarantee
// over a backlog missing its subject, and a town with no news the crossing
// after five marks published.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { claimEffectsFrom, headlinesFrom } from "../src/claim-effects.mjs";
import { toYou, townShelf, happenedBlock, latestSettlement } from "../src/world-happened.mjs";
import { CROSSING_EPOCH_UTC, CROSSING_MS, currentCrossing } from "../src/crossings.mjs";

// Crossing 172 opened at this instant; 173 at the next. The walk's own numbers.
const isoAt = (crossing) => new Date(CROSSING_EPOCH_UTC + crossing * CROSSING_MS + 60_000).toISOString();
const MINE = new Set(["wright", "rei"]);
const mine = (id, row) => MINE.has(row?.claimant) || MINE.has(String(id).split("/")[0]);

const claim = (over = {}) => ({
  slug: "wright/the-flip-day-plumb-line", claimant: "wright", household: "gh:67605380",
  status: "pending", window_id: 174, submitted_at: isoAt(172), decided_at: null,
  refusal_check: null, ...over,
});

// ── to_you: the three events ───────────────────────────────────────────────

test("a stake going forward is an effect on your node — claim-pending", () => {
  const [e] = claimEffectsFrom({ rows: [claim()], sinceCrossing: 170, nowCrossing: 174, mine });
  assert.equal(e.kind, "claim-pending");
  assert.equal(e.mark, "wright/the-flip-day-plumb-line");
  assert.equal(e.yours, true);
  assert.equal(e.window, 174, "the candle's window, beside the ferry's crossing — never one wearing the other's name");
  assert.equal(e.crossing, 172, "and the cursor's clock, so the caller can page from it");
});

test("THE REFUSAL REACHES THE BACKLOG, with the cause in the bulletin's five words", () => {
  const rows = [claim({ status: "refused", refusal_check: "escrow", decided_at: isoAt(173) })];
  const events = claimEffectsFrom({ rows, sinceCrossing: 170, nowCrossing: 174, mine });
  const refused = events.find((e) => e.kind === "claim-refused");
  assert.ok(refused, "this is the event whose absence made `complete: true` a lie");
  assert.equal(refused.cause, "unbacked");
  assert.equal(refused.cause_row, 'claims.refusal_check = "escrow"');
  assert.match(refused.summary, /refused at window 174 — unbacked/,
    "a resident who reads only their delta still learns the reason");
});

test("a lock is an event too, and it does not claim the mark is on the world yet", () => {
  const rows = [claim({ status: "locked", decided_at: isoAt(173) })];
  const e = claimEffectsFrom({ rows, sinceCrossing: 170, nowCrossing: 174, mine }).find((x) => x.kind === "claim-locked");
  assert.ok(e);
  assert.match(e.summary, /the candle ruled for it/);
});

test("A DRAFT WRITES NO EVENT — it is private, and it has happened to nobody", () => {
  const rows = [claim({ status: "draft", window_id: 174 })];
  assert.deepEqual(claimEffectsFrom({ rows, sinceCrossing: 170, nowCrossing: 174, mine }), [],
    "an event for a resident's own compose space is the town narrating it back at them");
});

test("MARKS LAID OVER YOUR GROUND are your backlog too, and are labelled as not yours", () => {
  const rows = [claim({ slug: "glados-letta/the-new-house", claimant: "glados-letta", status: "refused",
    refusal_check: "collision", decided_at: isoAt(173) })];
  const onMyGround = new Set(["glados-letta/the-new-house"]);
  const events = claimEffectsFrom({ rows, sinceCrossing: 170, nowCrossing: 174, mine, onMyGround });
  // TWO events for one row, and that is the shape: a claim moves twice — once
  // when it goes forward and once when the candle rules — and a backlog that
  // reported only the ruling would tell a resident a mark had been refused
  // without ever telling them it had been laid.
  assert.deepEqual(events.map((x) => x.kind), ["claim-pending", "claim-refused"]);
  const e = events[1];
  assert.equal(e.yours, false, "somebody else's mark");
  assert.equal(e.on_your_ground, true, "on your terrace — which is why you are being told");
  assert.equal(e.cause, "contested");
});

test("somebody else's mark somewhere else is NOT in your backlog", () => {
  const rows = [claim({ slug: "ethan-thorne/the-joinery", claimant: "ethan-thorne", status: "refused", decided_at: isoAt(173) })];
  assert.deepEqual(claimEffectsFrom({ rows, sinceCrossing: 170, nowCrossing: 174, mine }), [],
    "the backlog is every effect on YOUR node, not the town's whole docket");
});

test("the cursor bounds it at both ends — nothing before `since`, nothing after `now`", () => {
  const rows = [
    claim({ slug: "wright/older", status: "refused", decided_at: isoAt(150) }),
    claim({ slug: "wright/inside", status: "refused", decided_at: isoAt(172) }),
    claim({ slug: "wright/later", status: "refused", decided_at: isoAt(200) }),
  ];
  const ids = claimEffectsFrom({ rows, sinceCrossing: 170, nowCrossing: 174, mine })
    .filter((e) => e.kind === "claim-refused").map((e) => e.mark);
  assert.deepEqual(ids, ["wright/inside"]);
});

// ── `complete` is now EARNED ───────────────────────────────────────────────

test("THE PROMISE, EARNED: complete stays true when every source answered", () => {
  const shelf = toYou({ sinceCrossing: 170, nowCrossing: 174,
    claimEffects: { readable: true, events: claimEffectsFrom({ rows: [claim()], sinceCrossing: 170, nowCrossing: 174, mine }) } });
  assert.equal(shelf.complete, true);
  assert.equal(shelf.count, 1);
  assert.match(shelf.note, /every claim effect on your marks and on your ground rides here too/);
});

test("THE PROMISE, WITHDRAWN: an unreadable docket makes complete FALSE and says why", () => {
  const shelf = toYou({ sinceCrossing: 170, nowCrossing: 174,
    claimEffects: { readable: false, events: [], reason: "the docket store could not be read (ECONNREFUSED)" } });
  assert.equal(shelf.complete, false,
    "reporting an empty list as complete is exactly what the walk was told");
  assert.match(shelf.note, /INCOMPLETE/);
  assert.match(shelf.note, /ECONNREFUSED/, "and it names the source, not just the doubt");
  assert.match(shelf.note, /so you do not read their absence as nothing having happened/);
});

test("a read that asked for no claim effects keeps the promise — there is no resident to be incomplete about", () => {
  const shelf = toYou({ sinceCrossing: 170, nowCrossing: 174, claimEffects: null });
  assert.equal(shelf.complete, true);
});

// ── the town shelf: news, not notices ──────────────────────────────────────

test("R2: the crossing's own published/refused list IS the news", () => {
  const rows = [
    { slug: "a/one", status: "locked" }, { slug: "b/two", status: "locked" },
    { slug: "c/three", status: "refused" },
  ];
  const heads = headlinesFrom({ rows });
  assert.equal(heads.length, 2, "one headline per OUTCOME — this shelf is fixed-size by construction");
  assert.match(heads[0].title, /2 marks published at the last crossing/);
  assert.match(heads[1].title, /1 mark refused at the last crossing/);
});

test("POINTERS, NEVER COPIES — a headline carries ids and the read that opens them, no bodies", () => {
  const heads = headlinesFrom({ rows: [{ slug: "a/one", status: "refused", refusal_check: "escrow" }] });
  assert.deepEqual(heads[0].marks, ["a/one"]);
  assert.match(heads[0].read, /world \{ mark:/);
  assert.ok(!JSON.stringify(heads).includes("escrow"),
    "the shelf's own rule: a headline is a place to go look, never the thing itself");
});

test("the town shelf puts the crossing's news FIRST and the notice board after it", () => {
  const shelf = townShelf({
    nowCrossing: 174,
    headlines: { readable: true, rows: headlinesFrom({ rows: [{ slug: "a/one", status: "locked" }] }) },
    notices: [{ id: "the-doors", title: "The doors", text: "a standing notice" }],
  });
  assert.equal(shelf.headlines[0].id, "the-crossing/published", "a standing notice is not news");
  assert.equal(shelf.headlines[1].id, "the-doors");
});

test("an unreadable docket is NOT an empty news list — the two must not look alike", () => {
  const shelf = townShelf({ nowCrossing: 174, notices: [],
    headlines: { readable: false, rows: [], reason: "the store said no" } });
  assert.match(shelf.headlines_incomplete, /the store said no/);
  const clean = townShelf({ nowCrossing: 174, notices: [], headlines: { readable: true, rows: [] } });
  assert.equal(clean.headlines_incomplete, undefined);
  assert.deepEqual(clean.headlines, []);
});

// ── R4: the cursor names its clock ─────────────────────────────────────────

test("`since:` says which crossing it counts, so three clocks stop wearing one word", () => {
  const b = happenedBlock({ transitions: [], carriedLegs: [], lines: [], at: { x: 0, y: 0 },
    sinceCrossing: 170, nowCrossing: 174, latestSettlement: null, notices: [] });
  assert.match(b.since.note, /the ferry's 00:00\/12:00Z crossings/);
  assert.match(b.since.note, /not the keeper's settlement epoch/);
});

// ── latestSettlement reads a REF, not the pen's HEAD ───────────────────────

const repo = mkdtempSync(join(tmpdir(), "pm-latest-settlement-"));
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const commit = (m) => git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", m);

put("WORLD/world-state.json", "{}");
git("init", "-q", "-b", "main");
git("add", "-A");
commit("settlement: sweep 5 published — S58");
git("tag", "settlement/S58");
put("WORLD/a.txt", "a");
git("add", "-A");
commit("settlement: sweep 1 published — S59");
git("tag", "settlement/S59");
const S59 = git("rev-parse", "--short", "HEAD").trim();
// the pen parks the checkout on a household branch, from BEFORE S59
git("switch", "-q", "--detach", "settlement/S58");
git("switch", "-q", "-c", "draft/somebody");
put("WORLD/sketch.md", "a sketch");
git("add", "-A");
commit("mark: somebody/a-sketch — by somebody (via world_leave_mark)");

test("RED CONTROL: HEAD is a draft branch that cannot see S59 — the box's shape", () => {
  assert.equal(git("rev-parse", "--abbrev-ref", "HEAD").trim(), "draft/somebody");
  const fromHead = git("log", "-1", "--format=%s", "--grep", "^settlement").trim();
  assert.match(fromHead, /S58/, "reading HEAD names the OLDER settlement — the walk's `latest_settlement`");
});

test("latestSettlement reads the READ tier's ref, and names the S-NUMBER", () => {
  const s = latestSettlement(repo);
  assert.equal(s.sha, S59, "the newest settlement on published main, not on the pen's branch");
  // the READ tier's ref is the newest BLESSING since postmark#2934 (the bless
  // overrides the tick) — here S59's tag, which is also where main stands
  assert.equal(s.ref, "refs/tags/settlement/S59");
  assert.equal(s.s, 59, "a resident was being handed a sha for a thing the town numbers");
});

test("a repo with no settlement tag gets a commit and no invented number", () => {
  const bare = mkdtempSync(join(tmpdir(), "pm-untagged-"));
  try {
    execFileSync("git", ["-C", bare, "init", "-q", "-b", "main"]);
    writeFileSync(join(bare, "x"), "x");
    execFileSync("git", ["-C", bare, "add", "-A"]);
    execFileSync("git", ["-C", bare, "-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-qm", "settlement: sweep"]);
    const s = latestSettlement(bare);
    assert.ok(s.sha);
    assert.equal(s.s, undefined, "no tag, no number — and never a guessed one");
  } finally { rmSync(bare, { recursive: true, force: true }); }
});

test("the fixture's crossing arithmetic is the town's, not this file's", () => {
  assert.equal(currentCrossing(CROSSING_EPOCH_UTC + 172 * CROSSING_MS + 60_000), 172);
});

// ── the doorstep's eighth segment ──────────────────────────────────────────

// RENAMED `outcomes` (POS-70; Keemin, 2026-09-17: "rulings" is what the
// founder decides, what a crossing decides about your things is an outcome).
// Still nine, and the segment that carries a refusal is still named — under
// its new name, with the old one a pointer on the page for one cycle.
test("the manifest names nine, and `outcomes` (which was `rulings`) is one of them", async () => {
  const { DOORSTEP_SEGMENTS } = await import("../src/queries.mjs");
  assert.equal(DOORSTEP_SEGMENTS.length, 9, "nine since 2026-09-18 — `stakes` joined (postmark#2919)");
  assert.ok(DOORSTEP_SEGMENTS.includes("outcomes"),
    "a manifest that did not name it would hide the segment that carries a refusal");
  assert.ok(!DOORSTEP_SEGMENTS.includes("rulings"), "renamed, not doubled — the old key is a pointer, not a segment");
});

test("`household read: \"outcomes\"` is a real door, advertised and accepted — and `rulings` still answers for one cycle", async () => {
  const { HOUSEHOLD_READS, HOUSEHOLD_READ_ENUM, HOUSEHOLD_READABLE } = await import("../src/household-apex.mjs");
  assert.ok(HOUSEHOLD_READABLE.includes("outcomes"),
    "the doorstep's segment points at this read by name — a segment whose `serves` names no door is a restatement, which the bundle law forbids");
  assert.ok(HOUSEHOLD_READ_ENUM.includes("outcomes"), "and the tool schema advertises it");
  assert.match(HOUSEHOLD_READS.outcomes, /bulletin's own words/,
    "the door's own blurb carries the promise it keeps");
  assert.ok(HOUSEHOLD_READABLE.includes("rulings") && HOUSEHOLD_READ_ENUM.includes("rulings"),
    "the old name answers one cycle (POS-70) — a cached caller is pointed, not refused");
  assert.match(HOUSEHOLD_READS.rulings, /renamed: outcomes/);
});

// ── the class: three prose surfaces enumerating one list ───────────────────
//
// TWO OF THE THREE HAD ALREADY DRIFTED when this lane arrived: `BUNDLE_LAW`
// (printed ON the page a resident reads) and `read_doorstep`'s tool description
// both said six segments while the page served seven — `stances` shipped
// 2026-08-15 and neither learned it. A door that lies about itself, for three
// weeks, on the surface it lies to a reader through. Both are derived now, and
// this is what keeps them derived.

test("THE PAGE'S OWN SENTENCE names every segment the manifest names — no hand-typed list", async () => {
  const { BUNDLE_LAW, DOORSTEP_SEGMENTS } = await import("../src/queries.mjs");
  for (const name of DOORSTEP_SEGMENTS)
    assert.ok(BUNDLE_LAW.includes(name), `the bundle law does not name "${name}" — the page is telling residents a wrong list`);
  assert.ok(BUNDLE_LAW.includes(DOORSTEP_SEGMENTS.join(", ")),
    "and it names them in the manifest's own order, because it is built from the manifest");
});

// ⚑ THE FIFTH SURFACE, added on the reviewer's finding. Commit 7 named this
// exact class — "three separate hand-written prose surfaces enumerate the
// doorstep's segments … nothing binds them to DOORSTEP_SEGMENTS" — and missed a
// fourth: `household-apex.mjs`'s `read:` schema description, which named seven
// segments for an eight-segment page and left the new read out of its own list
// of reads. On the schema an agent reads to decide what it may ask for.
test("the household door's `read:` schema names EVERY segment and EVERY read", async () => {
  const { HOUSEHOLD_TOOL, HOUSEHOLD_READS, HOUSEHOLD_READABLE } = await import("../src/household-apex.mjs");
  const { DOORSTEP_SEGMENTS } = await import("../src/queries.mjs");
  const d = HOUSEHOLD_TOOL.inputSchema.properties.read.description;

  // ⚑ THE SEGMENT LIST AND THE READ LIST ARE CHECKED APART, and the first
  // version of this leg did not do that: it asked `d.includes(name)` for both,
  // and every read that is also a segment was satisfied by the SEGMENT list. I
  // flipped the read list back to a hand-typed one that omits `rulings` and
  // this stayed GREEN — a control satisfied by something other than the thing
  // it is controlling for, which is the exact weakness the reviewer named in
  // the leak falsifier's cross-household leg. Each read is now matched WITH ITS
  // BLURB, `<name> (…`, a shape only the derived form produces.
  const segmentSentence = d.slice(d.indexOf("bundle of"), d.indexOf("The reads —"));
  for (const seg of DOORSTEP_SEGMENTS)
    assert.ok(segmentSentence.includes(seg), `the read: schema's doorstep gloss does not name the segment "${seg}"`);
  const readList = d.slice(d.indexOf("The reads —"));
  for (const r of HOUSEHOLD_READABLE)
    assert.ok(readList.includes(`${r} (`),
      `the read: schema advertises no read "${r}" — a door that accepts a name it does not mention`);
  assert.ok(d.includes(`${DOORSTEP_SEGMENTS.length} segments`),
    "and it counts what the page serves");
  assert.equal(Object.keys(HOUSEHOLD_READS).length, HOUSEHOLD_READABLE.length,
    "HOUSEHOLD_READABLE is the keys of HOUSEHOLD_READS — if that stops being true this leg is asserting the wrong set");
});

test("the MCP tool description counts the segments the manifest counts", async () => {
  const { TOOLS } = await import("../src/mcp.mjs");
  const { DOORSTEP_SEGMENTS } = await import("../src/queries.mjs");
  const tool = (TOOLS ?? []).find((t) => t.name === "read_doorstep");
  assert.ok(tool, "read_doorstep must be a listed tool for this assertion to mean anything");
  assert.ok(tool.description.includes(`${DOORSTEP_SEGMENTS.length} segments`),
    `the description advertises a different number than the page serves (${DOORSTEP_SEGMENTS.length})`);
  for (const name of DOORSTEP_SEGMENTS)
    assert.ok(tool.description.includes(name), `read_doorstep does not name "${name}"`);
  // AND THE GLOSS, which the first pass left hand-written beside a derived list
  // — so a ninth segment would have shipped a correct list and a stale sentence.
  assert.ok(!tool.description.includes("no gloss written for this segment yet"),
    "a segment reached the page with no sentence of its own; add it to SEGMENT_GLOSS");
});

test("A QUIET MORNING IS CHEAP: no events means no teaching prose", async () => {
  const { doorstepRulings } = await import("../src/claim-effects.mjs");
  // No store configured → readable, no events. The common case, on every
  // doorstep, every morning.
  const before = process.env.WORLD2_PG;
  delete process.env.WORLD2_PG;
  try {
    const seg = await doorstepRulings("wright", { key: { handles: new Set(["wright"]) } });
    assert.equal(seg.count, 0);
    assert.deepEqual(seg.events, []);
    assert.equal(seg.clock, undefined, "the page's budget is real — Hal's foyer bought 63% and it is not spent a field at a time");
    assert.equal(seg.read_the_rest, undefined);
    assert.match(seg.note, /an ordinary state, and a read one/,
      "and an honest empty is still SAID, so it cannot be read as a door that did not answer");
  } finally { if (before !== undefined) process.env.WORLD2_PG = before; }
});

test("an unreadable docket says so on the doorstep, and never as a quiet zero", () => {
  // The shape `doorstepRulings` returns when the store refuses, asserted on
  // the branch that builds it rather than through a store this suite has none of.
  const shelf = toYou({ sinceCrossing: 170, nowCrossing: 174,
    claimEffects: { readable: false, events: [], reason: "ECONNREFUSED" } });
  assert.equal(shelf.complete, false,
    "the doorstep segment and the delta shelf take the same answer from the same reader — one derivation, two doors");
});

process.on("exit", () => rmSync(repo, { recursive: true, force: true }));
