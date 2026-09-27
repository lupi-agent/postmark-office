// world-journal.test.mjs — THE SINGLE LOG's falsifiers (POS-5 slice 1).
//
// Every test below quotes the law it asserts, verbatim from the world record,
// because a brief is lossy and the gated doc is the law. The three marks:
//
//   the-witnessed-line  WORLD/marks/let-there-be-light/the-town-centre/
//                       the-keeping-works/postmark-rules/the-record-does-not-lie/
//                       the-witnessed-line  (tier: constitution, 2026-08-22)
//   the-anchor          .../logos/the-position/the-anchor  (constitution)
//   the-threshold       .../logos/the-entry/the-threshold  (constitution)
//   the-atomic-drain    .../logos/the-save/the-atomic-drain  (constitution)
//
// the-witnessed-line and the-threshold were planted as DELIBERATE REDS for this
// cutover. This slice flips the first and builds the corridor the second needs;
// what it does NOT do is named out loud in § the-threshold below, rather than
// left for a reader to discover by the absence of a test.
//
// EVERY ONE OF THESE WAS CAN-FAIL FLIPPED — the flip is recorded in the handback,
// not asserted here, because a test that tests itself proves nothing.
//
//   node --test test/world-journal.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { openDynamic } from "../src/dynamic-store.mjs";
import {
  ACTION_AMEND, ACTION_LEAVE, ACTION_WITHDRAW, CLASS_FRAME, CLASS_MARK, WORLD_ANCHOR,
  anchorAt, composeAnchor, draftsForKey, journalHead, liveChildrenOf,
  liveMarks, pathFor, pinWitnesses, readJournal, replayDrafts, resetPathIndex,
} from "../src/world-journal.mjs";
// ── THE ROWS ARE SEEDED, NOT WRITTEN BY A DOOR (G1 / POS-156) ───────────────
//
// G1 deleted the general journal INSERT; the write path writes the RECORD now.
// The tests below that plant a population are about READERS of the sqlite
// journal -- the row shape itself, `readJournal`, and 1.0's `liveMarks` /
// `draftsForKey`, whose own retirement is G2's -- so the rows are PUT THERE by
// this file, in the office's own row shape. Nothing here claims a door wrote
// them; the DOOR tests further down go through the door and reach the record.
import { seedJournalRow } from "./journal-seed.mjs";
import { draftDeltaForKey } from "../src/world-branches.mjs";

// ── the world in a bottle ────────────────────────────────────────────────────

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };

const repo = mkdtempSync(join(tmpdir(), "postmark-journal-repo-"));
const scratch = mkdtempSync(join(tmpdir(), "postmark-journal-db-"));
after(() => { sweep(repo); sweep(scratch); });

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (path, text) => {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
const record = (by, body) => `---\nkind: sited\nby: ${by}\ndate: 2026-08-01\nat: { x: 0, y: 0 }\nextent: { w: 4, h: 4 }\n---\n\n${body}\n`;

// Canon: two published marks belonging to alpha, and the world frame itself.
const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 1000, h: 1000 }, body: "the world frame" },
  { id: "the-town/town-square", by: "the-town", kind: "sited", tier: "constitution", at: { x: 100, y: 100 }, extent: { w: 40, h: 40 }, body: "the square" },
  { id: "alpha/published-note", by: "alpha", kind: "sited", tier: "market", at: { x: 20, y: 20 }, extent: { w: 4, h: 4 }, body: "alpha published this" },
  // postmark#3025's ground, far from every point the other tests stand on. A
  // painted house BIG enough (60x60) that a 25 m claim fits wholly inside it,
  // standing on no parcel, and an ordinary parcel of the same neighbour's.
  { id: "neighbour/the-big-house", by: "neighbour", kind: "sited", tier: "market", at: { x: 300, y: -300 }, extent: { w: 60, h: 60 }, body: "a painted house, standing on no parcel of anyone's" },
  { id: "neighbour/the-neighbour-parcel", by: "neighbour", kind: "parcel", tier: "home", at: { x: -300, y: 300 }, extent: { w: 25, h: 25 }, body: "the ground neighbour holds" },
];

// THE ENGINE, in miniature, on main — the office materialises `tools/` at the
// published ref, so the door's own path can only be exercised if the fixture
// commits one. Faithful to the SHAPES the door reads, not to the world's
// arithmetic, which has its own suite.
put("tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function homeOf(handle, world) {
  const parcel = (world?.parcels ?? []).find((p) => p.household === handle);
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
export function publicResidents() { return []; }
`);
put("tools/world-verbs.mjs", `
export function containmentChain(pos, marks) {
  return (marks ?? [])
    .filter((m) => m.at && m.extent && Math.abs(pos.x - m.at.x) <= m.extent.w / 2 && Math.abs(pos.y - m.at.y) <= m.extent.h / 2)
    .sort((a, b) => (b.extent.w * b.extent.h) - (a.extent.w * a.extent.h))
    .map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body }));
}
export function orient() { return { seen: [] }; }
export function investigate() { return null; }
`);
put("tools/marks-fold.mjs", `
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
export function loadMarks(dir) {
  const out = [];
  (function walk(at) {
    if (!existsSync(at)) return;
    const entries = readdirSync(at);
    if (entries.includes("mark.md")) {
      const text = readFileSync(join(at, "mark.md"), "utf8");
      const by = text.match(/^by:\s*(.+)$/m)?.[1]?.trim();
      const kind = text.match(/^kind:\s*(.+)$/m)?.[1]?.trim() ?? "sited";
      // DOUBLE EVERY BACKSLASH IN THIS MODULE. It is written out through an
      // untagged TEMPLATE LITERAL, which eats one level of escaping: a
      // whitespace class typed with a single backslash arrives here as a bare
      // letter and the regex silently stops matching — no error, just a mark
      // that loads with no geometry. (The by:/kind: patterns above survive on
      // an accident: their mangled form still matches zero characters where a
      // space was optional. A numeric pattern gets no such luck.)
      const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
      const ax = num(/^at:\\s*\\{\\s*x:\\s*(-?[0-9.]+)/m), ay = num(/^at:.*?y:\\s*(-?[0-9.]+)/m);
      const ew = num(/^extent:\\s*\\{\\s*w:\\s*(-?[0-9.]+)/m), eh = num(/^extent:.*?h:\\s*(-?[0-9.]+)/m);
      out.push({ by, household: by, kind, slug: basename(at), id: by + "/" + basename(at), _dir: at,
        ...(ax !== null && ay !== null ? { at: { x: ax, y: ay } } : {}),
        ...(ew !== null && eh !== null ? { extent: { w: ew, h: eh } } : {}) });
    }
    for (const e of entries) {
      const next = join(at, e);
      if (e !== "mark.md" && statSync(next).isDirectory()) walk(next);
    }
  })(dir);
  return out;
}
export const PARCEL_EXTENT_M = 25;
export const PARCEL_CLAIM_CAP = 3;
export const PARCEL_CAP_LAW_DATE = "2026-07-30";
export function marksContain(outer, inner) {
  if (!outer?.at || !outer?.extent || !inner?.at) return false;
  return Math.abs(inner.at.x - outer.at.x) <= outer.extent.w / 2
      && Math.abs(inner.at.y - outer.at.y) <= outer.extent.h / 2;
}
export const WORLD_ROOT_SLUG = "let-there-be-light";
export const worldRootOf = (marks) => marks.find((m) => m.slug === WORLD_ROOT_SLUG) ?? null;
export function placementParent(claim, marks) {
  const area = (m) => (m?.extent?.w ?? 0) * (m?.extent?.h ?? 0);
  const mine = area(claim);
  let best = null;
  for (const m of marks) {
    if (m.id === claim.id || !m.at || !m.extent) continue;
    if (m.slug === WORLD_ROOT_SLUG) continue;
    if (area(m) <= mine) continue;
    if (marksContain(m, claim) && (!best || area(m) < area(best))) best = m;
  }
  return best ? best.id : null;
}
// The freeze's containment answer, in the shape the live fold exports:
// { parent: Map<id, parentId|null>, rootId }. The office's guards read this
// instead of directory nesting, so the stub has to speak it or the fixture
// silently exercises the pre-freeze fallback and proves nothing.
export function containmentParents(marks) {
  const root = worldRootOf(marks);
  const parent = new Map();
  for (const m of marks) {
    if (m === root) { parent.set(m.id, null); continue; }
    parent.set(m.id, placementParent(m, marks) ?? root?.id ?? null);
  }
  return { parent, rootId: root?.id ?? null };
}
`);
// THE PAINTING NAMES ONE HOME (postmark#3025). The office must stop CONSULTING
// it, not merely survive its absence: with the retired sovereignty guard
// restored, this line is what reds #3025 LEG 1 at the end of this file.
put("seeding/manifest.json", JSON.stringify({ homes: [{ household: "neighbour", home_id: "the-big-house", title: "the Big House" }] }));
put("WORLD/households.json", JSON.stringify({ households: { alpha: "gh:1", beta: "gh:2", neighbour: "gh:3" } }));
put("WORLD/marks/let-there-be-light/mark.md", record("the-town", "the world frame"));
put("WORLD/marks/let-there-be-light/town-square/mark.md", record("the-town", "the square"));
put("WORLD/marks/let-there-be-light/published-note/mark.md", record("alpha", "alpha published this"));
put("WORLD/marks/let-there-be-light/the-big-house/mark.md", ["---", "kind: sited", "by: neighbour", "date: 2026-08-01", "at: { x: 300, y: -300 }", "extent: { w: 60, h: 60 }", "---", "", "a painted house, standing on no parcel of anyone's", ""].join(String.fromCharCode(10)));
put("WORLD/marks/let-there-be-light/the-neighbour-parcel/mark.md", ["---", "kind: parcel", "by: neighbour", "date: 2026-08-01", "at: { x: -300, y: 300 }", "extent: { w: 25, h: 25 }", "---", "", "the ground neighbour holds", ""].join(String.fromCharCode(10)));
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: PUBLISHED, parcels: [{ id: "alpha/alpha-parcel", household: "alpha", at: { x: 110, y: 105 }, extent: { w: 25, h: 25 } }, { id: "neighbour/the-neighbour-parcel", household: "neighbour", at: { x: -300, y: 300 }, extent: { w: 25, h: 25 } }], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [] }));

// THE FROZEN FILING MANIFEST (the freeze, 2026-08-25) — seeded on MAIN, before
// any sketchbook branch exists, because that is where the real one lives and
// every draft branch has to inherit it. It names the two pre-freeze filings this
// fixture seeds; every other mark here is born after the freeze and files at its
// id, which is what makes the two rules distinguishable in one repo.
put("WORLD/filing-freeze.json", JSON.stringify({
  law: "Filing is frozen as of 2026-08-25. A mark's directory is its historical filing: it carries no claim, and it never moves again.",
  source: "LOGOS/state-and-time.md, the-town/the-frozen-filing",
  frozen_at: "2026-08-25",
  marks: {
    "alpha/sketchbook-draft": "WORLD/marks/let-there-be-light/sketchbook-draft",
    "alpha/published-note": "WORLD/marks/let-there-be-light/published-note",
  },
}));
git("init", "-q", "-b", "main");
git("config", "user.email", "test@postmark.town");
git("config", "user.name", "journal falsifier");
git("add", "-A");
git("commit", "-qm", "canon");

// A PRE-CUTOVER sketchbook: one draft written the old way, before the flag ever
// flipped. It exists so the union can be falsified — a cutover that dropped it
// would erase a resident's work on the day it shipped.
git("checkout", "-q", "-b", "draft/alpha");
put("WORLD/marks/let-there-be-light/sketchbook-draft/mark.md", record("alpha", "written the old way"));
// …and one the journal NEVER touches. Without it the union is unfalsifiable:
// every shared id is served by the journal half alone, so dropping the
// sketchbook entirely would still pass. (Found by the can-fail flip.)
put("WORLD/marks/let-there-be-light/only-in-the-sketchbook/mark.md", record("alpha", "the log has never heard of this"));
git("add", "-A");
git("commit", "-qm", "draft: alpha/sketchbook-draft");
git("checkout", "-q", "main");

const houseA = { household: "alpha", handles: new Set(["alpha"]) };
const houseB = { household: "beta", handles: new Set(["beta"]) };

let dbPath;
let dbSeq = 0;
beforeEach(() => {
  dbPath = join(scratch, `dynamic-${++dbSeq}.db`);
  process.env.WORLD_DYNAMIC_DB = dbPath;
  delete process.env.WORLD_SINGLE_LOG;
  resetPathIndex();
});
after(() => { delete process.env.WORLD_DYNAMIC_DB; delete process.env.WORLD_SINGLE_LOG; });

const withDb = (fn) => { const db = openDynamic(dbPath); try { return fn(db); } finally { db.close(); } };

/** A leave-mark row, as the door writes one. */
const leave = (db, { id, by = "alpha", household = "alpha", kind = "sited", at = { x: 5, y: 5 }, body = "a declaration", action = ACTION_LEAVE, parent_id = undefined, extent = { w: 2, h: 2 }, witnesses = { source: "presence", list: [] }, standing = { anchor: WORLD_ANCHOR, dx: 5, dy: 5 } }) =>
  seedJournalRow(db, {
    crossing: 140, actor: by, household, action, object: id, cls: CLASS_MARK,
    at: standing, witnesses,
    // A WITHDRAW ROW DESCRIBES NOTHING — the door writes {by, slug,
    // was_published} and no more, because a withdrawal is a declaration that
    // something ended, not a description of it. The helper has to be honest
    // about that or the deletion falsifier cannot fail.
    payload: action === ACTION_WITHDRAW
      ? { by, slug: id.split("/").slice(1).join("/"), was_published: false }
      : { slug: id.split("/").slice(1).join("/"), by, kind, at, extent, body, date: "2026-08-23T00:00:00.000Z", ...(parent_id ? { parent_id } : {}) },
    effect: "a draft stands in the live layer",
  });

const publishedIds = new Set(PUBLISHED.map((m) => m.id));
const centreOf = (id) => PUBLISHED.find((m) => m.id === id)?.at ?? null;
// The engine's containment spine, in miniature: outermost first, and only marks
// whose rect truly holds the point. The arithmetic under test is the ANCHORING,
// not the geometry, and the world's own `containmentChain` has its own suite.
const chainAt = (p) => PUBLISHED
  .filter((m) => m.at && Math.abs(p.x - m.at.x) <= m.extent.w / 2 && Math.abs(p.y - m.at.y) <= m.extent.h / 2)
  .sort((a, b) => (b.extent.w * b.extent.h) - (a.extent.w * a.extent.h))
  .map((m) => ({ id: m.id, by: m.by, tier: m.tier }));

// ── the-witnessed-line ───────────────────────────────────────────────────────

test("the-witnessed-line — every line carries an anchor and an offset: WHERE THE ACTOR STOOD, relative to what", () => {
  // WORLD/marks/…/the-record-does-not-lie/the-witnessed-line, verbatim:
  //
  //   "Every line of the log carries its witnesses at write time — an anchor and
  //    an offset: where the actor stood, relative to what, at that instant."
  //
  // The RED this slice flips: before it, no line of any log carried either.
  const inSquare = { x: 110, y: 105 };
  const standing = anchorAt(inSquare, { chain: chainAt(inSquare), centreOf });
  assert.equal(standing.anchor, "the-town/town-square",
    "the anchor is the innermost mark the actor is standing in — 'relative to what'");
  assert.deepEqual({ dx: standing.dx, dy: standing.dy }, { dx: 10, dy: 5 },
    "and the offset is measured from that anchor's centre, not from the origin");

  const row = withDb((db) => {
    leave(db, { id: "alpha/witnessed", standing });
    return readJournal(db)[0];
  });
  assert.equal(row.at.anchor, "the-town/town-square", "the stored line carries the anchor");
  assert.deepEqual({ dx: row.at.dx, dy: row.at.dy }, { dx: 10, dy: 5 }, "and the offset, on the line itself");
});

test("the-witnessed-line — the witnesses are PINNED at the write instant, and stay pinned when everyone walks away", () => {
  //   "Every line of the log carries its witnesses AT WRITE TIME — an anchor and
  //    an offset: where the actor stood, relative to what, AT THAT INSTANT."
  //
  // A handle is a pointer to wherever a resident is NOW, and now is the one
  // instant a log line is never read at. This is the difference.
  const bystanders = [{ handle: "gamma", at: { x: 108, y: 100 } }, { handle: "beta", at: { x: 300, y: 300 } }];
  const witnesses = pinWitnesses({ residents: bystanders, centreOf, chainAt });

  const row = withDb((db) => {
    leave(db, { id: "alpha/witnessed", witnesses });
    // everybody leaves — the world moves on, the line does not
    bystanders[0].at = { x: -900, y: -900 };
    bystanders[1].at = { x: -900, y: -900 };
    return readJournal(db)[0];
  });

  const pinned = Object.fromEntries(row.witnesses.list.map((w) => [w.handle, w]));
  assert.deepEqual(
    { anchor: pinned.gamma.anchor, dx: pinned.gamma.dx, dy: pinned.gamma.dy },
    { anchor: "the-town/town-square", dx: 8, dy: 0 },
    "gamma stood in the square, eight metres east of its centre — and still does, on this line, forever");
  assert.equal(pinned.beta.anchor, WORLD_ANCHOR,
    "beta stood in no mark at all, so the world is the anchor (the-anchor: 'a mark, an entity, or the world')");
  assert.deepEqual({ dx: pinned.beta.dx, dy: pinned.beta.dy }, { dx: 300, dy: 300 },
    "and an offset from the world frame IS a world coordinate — §8: 'world coords = the let-there-be-light reference frame, nothing more'");
});

test("the-witnessed-line — an unreadable presence layer DISCLOSES, it does not report an empty room", () => {
  // The law says every line carries its witnesses. "[]" for both "nobody was
  // there" and "this office could not see" would satisfy the letter and break
  // the sentence — the same class the office already refuses at
  // HOME_BLOCK_UNREADABLE ("this is not an answer about your ground").
  assert.deepEqual(pinWitnesses({ residents: [], centreOf, chainAt }),
    { source: "presence", list: [] },
    "nobody within earshot is a real answer, and it says who told us");

  const off = pinWitnesses({ unread: "presence-off" });
  assert.equal(off.source, "unread", "a layer that was not read never claims to have seen an empty room");
  assert.equal(off.reason, "presence-off");
  assert.deepEqual(off.list, []);
});

// ── the-anchor ───────────────────────────────────────────────────────────────

test("the-anchor — a mark, an entity, or the world; and the offset survives the anchor MOVING", () => {
  // WORLD/marks/…/logos/the-position/the-anchor, verbatim:
  //
  //   "An anchor is a mark, an entity, or the world — a held thing rides its
  //    holder as a rider rides the deck; what may anchor where is class contract."
  //
  // This is the whole reason the pair is stored instead of an x,y. §8 catalogues
  // the same absence four times (the rider, the held thing, the emission on the
  // deck, the stale occupancy): a raw coordinate is a photograph of a moving
  // thing and cannot be carried to any other instant.
  const p = { x: 110, y: 105 };
  const at = anchorAt(p, { chain: chainAt(p), centreOf });
  assert.deepEqual(composeAnchor(at, centreOf), p, "anchor + offset composes back to where they stood");

  // the square is picked up and set down 500 m away
  const moved = (id) => (id === "the-town/town-square" ? { x: 600, y: 600 } : centreOf(id));
  assert.deepEqual(composeAnchor(at, moved), { x: 610, y: 605 },
    "the actor rode the square — the offset did not change, and that is the invariant a bare x,y cannot hold");

  const nowhere = { x: 5000, y: 5000 };
  const world = anchorAt(nowhere, { chain: chainAt(nowhere), centreOf });
  assert.equal(world.anchor, WORLD_ANCHOR, "outside every mark, the world is the anchor");
  assert.deepEqual(composeAnchor(world, centreOf), nowhere);
});

test("the-anchor — an unplaced actor gets a NULL offset, never the Origin", () => {
  // {x:0,y:0} is a real place somebody could be standing. A deriver that
  // substitutes it for "we do not know" is the customs-house law broken:
  // REFUSE OR DISCLOSE, NEVER QUIETLY SUBSTITUTE.
  const unplaced = anchorAt(null, { chain: [], centreOf });
  assert.equal(unplaced.unplaced, true);
  assert.equal(unplaced.dx, null, "not zero — zero is the Origin");
  assert.equal(composeAnchor(unplaced, centreOf), null, "and nothing composes a position out of it");
});

test("the-witnessed-line — an UNPLACED actor's line keeps a null offset; the store never writes the Origin", () => {
  // The law says the line carries where the actor stood. It does not license
  // inventing one. Number(null) is 0 and 0 is finite, so the guard has to be
  // explicit at the WRITE too, not only at the read — a constitutional line
  // that says somebody stood at {0,0} when nobody knew where they stood is the
  // record lying, which is the very rule this mark hangs under
  // (the-record-does-not-lie).
  const nowhere = anchorAt(null, { chain: [], centreOf });
  const row = withDb((db) => {
    leave(db, { id: "alpha/from-nowhere", standing: nowhere });
    return readJournal(db)[0];
  });
  assert.equal(row.at.anchor, WORLD_ANCHOR, "the world is still the anchor — that much is always true");
  assert.equal(row.at.dx, null, "but the offset is null, not zero");
  assert.equal(row.at.dy, null);
});

// ── the-threshold (the corridor, honestly scoped) ────────────────────────────

test("the-threshold — a frame transition rides THIS log, with its anchor and its witnesses, on one schema", () => {
  // WORLD/marks/…/logos/the-entry/the-threshold, verbatim:
  //
  //   "A threshold crosses only from where you truly stand, and exit sets you
  //    down at the door — no verb moves the frame from afar."
  //
  // §8's storage ruling (b), Keemin 2026-08-22: "frame-transition events in the
  // single log — no frame column on dynamic.db entities. Reparentings enter the
  // one append-only log as SUBJECT · ACTION · OBJECT · EFFECT rows."
  //
  // WHAT THIS ASSERTS is the corridor: one schema carries a reparenting with the
  // anchor+offset that says where the actor truly stood, so the frame graph can
  // derive from replay. WHAT IT DOES NOT ASSERT — said out loud rather than left
  // to be inferred from a missing case — is the VERB half: enter/exit/walk are
  // not re-pointed at this log in slice 1, because that is the position-core
  // rewrite §8 defers ("NOT a land-it-today job"). Until they are, no falsifier
  // here can say a verb refused to move a frame from afar.
  const door = { x: 120, y: 100 };                       // the square's east edge
  const standing = anchorAt(door, { chain: chainAt(door), centreOf });

  const back = withDb((db) => {
    seedJournalRow(db, {
      crossing: 140, actor: "alpha", household: "alpha",
      action: "enter", object: "the-town/town-square", cls: CLASS_FRAME,
      at: standing, witnesses: pinWitnesses({ residents: [], centreOf, chainAt }),
      payload: { from: WORLD_ANCHOR, to: "the-town/town-square" },
      effect: "the actor's frame is now the square",
    });
    return readJournal(db, { cls: CLASS_FRAME });
  });

  assert.equal(back.length, 1, "a frame row needs no table of its own");
  assert.equal(back[0].class, CLASS_FRAME);
  assert.equal(back[0].at.anchor, "the-town/town-square",
    "the row records where they truly stood at the boundary — the law's 'from where you truly stand', on the line");
  assert.deepEqual(back[0].payload, { from: WORLD_ANCHOR, to: "the-town/town-square" }, "SUBJECT · ACTION · OBJECT · EFFECT, and the reparenting is the payload");

  // and it does not leak into the mark fold — one log, sorted by class
  assert.deepEqual(replayDrafts(back, { publishedIds }).marks, [],
    "a frame transition is not a draft mark; the drain sorts by class, not by table");
});

// ── the-atomic-drain (the replayable half this slice owes) ───────────────────

test("the-atomic-drain — the journal replays from a COLD read: nothing cached, nothing in memory", () => {
  // WORLD/marks/…/logos/the-save/the-atomic-drain, verbatim:
  //
  //   "The drain's write-down and the journal's truncate are one act — a crash
  //    between them eats no draft, and a lost save recomputes from the log."
  //
  // The drain itself is slice 2. What slice 1 owes is the second clause's
  // precondition: the log has to actually be replayable, from disk, by a reader
  // that shares no state with the writer. A write path whose reader does not
  // exist is a write path nobody has proven can be read back.
  withDb((db) => {
    leave(db, { id: "alpha/one" });
    leave(db, { id: "alpha/two" });
    leave(db, { id: "alpha/one", action: ACTION_AMEND, body: "said better" });
  });

  // a different handle, a different process's worth of state
  const cold = openDynamic(dbPath, { readOnly: true });
  try {
    const rows = readJournal(cold, { household: "alpha" });
    assert.equal(rows.length, 3, "every line survives the close — nothing was an in-memory convenience");
    assert.equal(journalHead(cold), 3, "and the head is the drain's cursor");
    const { marks } = replayDrafts(rows, { publishedIds });
    assert.deepEqual(marks.map((m) => m.id).sort(), ["alpha/one", "alpha/two"]);
    assert.equal(marks.find((m) => m.id === "alpha/one").body, "said better",
      "recomputed from the log, and the log's last word wins");
  } finally { cold.close(); }
});

test("append-only — amend and withdraw are LATER ENTRIES; no row is ever rewritten", () => {
  // §2: "leave_mark becomes one INSERT (amend/withdraw are later entries;
  // supersession-by-latest)." An append-only log that UPDATEs is not one, and
  // the-atomic-drain's replay clause is worthless the moment history mutates.
  const before = withDb((db) => { leave(db, { id: "alpha/one", body: "first word" }); return readJournal(db)[0]; });

  const rows = withDb((db) => {
    leave(db, { id: "alpha/one", action: ACTION_AMEND, body: "second word" });
    leave(db, { id: "alpha/one", action: ACTION_WITHDRAW });
    return readJournal(db);
  });

  assert.equal(rows.length, 3, "three declarations, three lines");
  assert.deepEqual(rows[0], before, "the first line is byte-for-byte what it was — its whole life stays in the log");
  assert.deepEqual(rows.map((r) => r.action), [ACTION_LEAVE, ACTION_AMEND, ACTION_WITHDRAW]);
  assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3], "and the seq is monotonic, which is what makes 'latest' a fact rather than a guess");
});

// ── supersession, folded to §1c's shape ──────────────────────────────────────

test("supersession-by-latest — a withdrawn draft that never crossed leaves NOTHING; a withdrawn published mark leaves a deletion", () => {
  // This mirrors the git path exactly, and it has to: a three-dot diff from the
  // merge-base shows an added-then-withdrawn draft as nothing at all, because
  // the file appeared and vanished on the same branch. Canon is the only thing
  // that can turn a withdrawal into something a reader must see.
  const rows = withDb((db) => {
    leave(db, { id: "alpha/never-crossed" });
    leave(db, { id: "alpha/never-crossed", action: ACTION_WITHDRAW });
    leave(db, { id: "alpha/published-note", action: ACTION_WITHDRAW });
    leave(db, { id: "alpha/fresh" });
    return readJournal(db);
  });

  const { marks, counts } = replayDrafts(rows, { publishedIds, publishedPathOf: () => "WORLD/marks/let-there-be-light/published-note/mark.md" });
  const byId = Object.fromEntries(marks.map((m) => [m.id, m]));
  assert.equal(byId["alpha/never-crossed"], undefined,
    "it never crossed, so there is nothing to unpublish — and nothing for the overlay to draw");
  assert.equal(byId["alpha/published-note"].status, "deleted",
    "canon still holds it, so the household IS proposing a deletion and the delta must say so");
  assert.equal(byId["alpha/fresh"].status, "added");
  assert.deepEqual(counts, { added: 1, modified: 0, deleted: 1 });
});

test("supersession-by-latest — a DELETION carries the mark being taken away, not an empty rectangle", () => {
  // A withdraw row's payload is a declaration that something ended, not a
  // description of it. The git path has no such gap — it reads the deleted
  // record at the merge-base — so the overlay has always had a real body, kind
  // and footprint for a mark being removed. The journal has to answer the same.
  const rows = withDb((db) => {
    leave(db, { id: "alpha/published-note", action: ACTION_WITHDRAW });
    return readJournal(db);
  });
  const [deleted] = replayDrafts(rows, {
    publishedIds,
    publishedPathOf: () => "WORLD/marks/let-there-be-light/published-note/mark.md",
    publishedMarkOf: (id) => PUBLISHED.find((m) => m.id === id) ?? null,
  }).marks;
  assert.equal(deleted.status, "deleted");
  assert.equal(deleted.body, "alpha published this", "canon's words, on a row canon is losing");
  assert.equal(deleted.kind, "sited");
  assert.deepEqual(deleted.at, { x: 20, y: 20 }, "and its ground, so the overlay can draw what is going away");
});

test("supersession-by-latest — an amend of a PUBLISHED mark reads 'modified', of a draft reads 'added'", () => {
  const rows = withDb((db) => {
    leave(db, { id: "alpha/published-note", action: ACTION_AMEND, body: "canon, said again" });
    leave(db, { id: "alpha/draft-only" });
    leave(db, { id: "alpha/draft-only", action: ACTION_AMEND, body: "still only mine" });
    return readJournal(db);
  });
  const byId = Object.fromEntries(replayDrafts(rows, { publishedIds }).marks.map((m) => [m.id, m]));
  assert.equal(byId["alpha/published-note"].status, "modified", "main holds it; this is a change to main");
  assert.equal(byId["alpha/draft-only"].status, "added", "main has never seen it; an amend of your own draft is still an addition");
  assert.equal(byId["alpha/draft-only"].body, "still only mine", "and the latest declaration is the one that shows");
});

test("the §1c contract — a journal mark carries the same keys the git delta carries", () => {
  // "Reads serve drafts from the journal + sketchbook overlay (the 1c contract
  // is ALREADY this shape — only the endpoint's backing store changes, the
  // viewer half is untouched)." A key the viewer reads and the journal omits is
  // that promise broken.
  const gitMark = draftDeltaForKey(repo, houseA).marks.find((m) => m.id === "alpha/sketchbook-draft");
  assert.ok(gitMark, "the fixture's pre-cutover sketchbook draft is the reference shape");

  const rows = withDb((db) => { leave(db, { id: "alpha/from-the-log" }); return readJournal(db); });
  const logMark = replayDrafts(rows, { publishedIds }).marks[0];

  for (const key of Object.keys(gitMark))
    assert.ok(key in logMark, `the journal's mark carries "${key}", as the git delta's does`);
  assert.equal(logMark.tier, "market",
    "tier is 'market' on both sides — the door refuses tier: as a field, so no record written since 2026-08-13 carries one");
  assert.equal(logMark.path, "WORLD/marks/alpha/from-the-log/mark.md",
    "and the path is where the drain will land it: at the mark's id — \"New marks are filed by identity\" (the freeze, 2026-08-25), and nothing moves it after");
});

test("the §1c contract — a nested declaration's path follows the mark it describes", () => {
  const rows = withDb((db) => {
    leave(db, { id: "alpha/the-lamp" });
    leave(db, { id: "alpha/lamp-colour", kind: "predicated", parent_id: "alpha/the-lamp" });
    return readJournal(db);
  });
  const byId = Object.fromEntries(replayDrafts(rows, { publishedIds }).marks.map((m) => [m.id, m]));
  assert.equal(byId["alpha/lamp-colour"].path,
    "WORLD/marks/alpha/the-lamp/lamp-colour/mark.md",
    "predicated/naming take the directory of the mark they describe, and follow it to the mark's NEW home at its id — the freeze moved the subject, not the rule");
  assert.equal(pathFor({ slug: "orphan", kind: "predicated", parent_id: "nobody/nothing" }),
    "WORLD/marks/let-there-be-light/orphan/mark.md",
    "and an unresolvable parent still falls back to the root — a predicate filed at its own id would describe nothing");
});

// ── the door guards, as store lookups ────────────────────────────────────────

test("the guards read the STORE — the live layer answers slug collision and holds-children with no checkout", () => {
  // §2: "Door guards that read the tree today (slug collision, parcel cap)
  // become DB lookups or move to the save, per draft-costs-nothing." Under the
  // flag there is no checked-out draft branch to loadMarks over — the checkout
  // is the thing being retired.
  withDb((db) => {
    leave(db, { id: "alpha/the-lamp" });
    leave(db, { id: "alpha/lamp-colour", kind: "predicated", parent_id: "alpha/the-lamp" });
    leave(db, { id: "beta/their-lamp", by: "beta", household: "beta" });

    const mine = liveMarks(db, { household: "alpha" }).map((m) => m.id).sort();
    assert.deepEqual(mine, ["alpha/lamp-colour", "alpha/the-lamp"],
      "your own sketchbook, and only yours — you cannot collide with a slug you cannot see");
    assert.deepEqual(liveChildrenOf(db, "alpha/the-lamp", { household: "alpha" }).map((m) => m.id), ["alpha/lamp-colour"],
      "and 'does this mark hold others' is a lookup, where it used to be a directory listing");

    leave(db, { id: "alpha/the-lamp", action: ACTION_WITHDRAW });
    assert.equal(liveMarks(db, { household: "alpha" }).some((m) => m.id === "alpha/the-lamp"), false,
      "a withdrawn mark leaves the live layer without leaving the log");
  });
});

// ── the flag ─────────────────────────────────────────────────────────────────

test("FLAG OFF — the §1c door is byte-identical to the git delta, and nothing reaches the log", () => {
  // The plan's own bar, and Stage D's before it: "FLAG OFF = byte-identical
  // behavior, provably: that is a falsifier, same as Stage D's."
  assert.equal(process.env.WORLD_SINGLE_LOG, undefined, "the switch is off — what follows is today's behaviour");

  // a journal that is not empty, so the test can only pass by ignoring it
  withDb((db) => { leave(db, { id: "alpha/in-the-log" }); });

  const viaJournalDoor = draftsForKey(repo, houseA);
  const viaGit = draftDeltaForKey(repo, houseA);
  assert.deepEqual(viaJournalDoor, viaGit,
    "same object, key for key — the composed door adds nothing at all when the flag is off");
  assert.equal("log" in viaJournalDoor, false, "not even the disclosure block, which would be a new key on an untouched contract");
  assert.equal(viaJournalDoor.marks.some((m) => m.id === "alpha/in-the-log"), false,
    "and the live layer is invisible: a store with rows in it changes nothing until the operator says so");
});

test("FLAG ON — the sketchbook and the journal BOTH answer, and the journal wins a shared id", () => {
  // §0's three sources, at the one door. Dropping the sketchbook half would
  // erase every draft written before the cutover on the day it shipped.
  process.env.WORLD_SINGLE_LOG = "1";
  withDb((db) => {
    leave(db, { id: "alpha/from-the-log", body: "written the new way" });
    leave(db, { id: "alpha/sketchbook-draft", action: ACTION_AMEND, body: "the log said it later" });
  });

  const delta = draftsForKey(repo, houseA);
  const byId = Object.fromEntries(delta.marks.map((m) => [m.id, m]));
  assert.ok(byId["alpha/from-the-log"], "the live layer is served");
  assert.equal(byId["alpha/only-in-the-sketchbook"]?.body, "the log has never heard of this",
    "and a draft written before the cutover, that the log has never seen, still reaches its author — dropping the sketchbook half would erase a resident's work on the day this shipped");
  assert.equal(byId["alpha/sketchbook-draft"].body, "the log said it later",
    "on a shared id the journal wins — it is later by construction");
  assert.equal(delta.log.readable, true);
  assert.equal(delta.log.head, 2, "and the head is disclosed in its own block, never smuggled into `draft`, which still means a commit");
  assert.equal(delta.draft, draftDeltaForKey(repo, houseA).draft, "`draft` is the sketchbook's sha under both flag positions");
});

test("FLAG ON — another household's live layer stays invisible", () => {
  process.env.WORLD_SINGLE_LOG = "1";
  withDb((db) => { leave(db, { id: "alpha/private", body: "alpha's alone" }); });
  const theirs = draftsForKey(repo, houseB);
  assert.equal(theirs.error, undefined);
  assert.equal((theirs.marks ?? []).some((m) => m.id === "alpha/private"), false,
    "you cannot see what you cannot back — the sketchbook's scoping is the journal's scoping, by the household column");
});

test("FLAG ON — an unreadable live layer discloses; it does not serve an empty overlay", () => {
  process.env.WORLD_SINGLE_LOG = "1";
  process.env.WORLD_DYNAMIC_DB = join(scratch, "nope", "not-a-store.db");
  try {
    const delta = draftsForKey(repo, houseA);
    assert.equal(delta.log.readable, false, "the door says the live layer could not be read");
    assert.ok(delta.marks.some((m) => m.id === "alpha/sketchbook-draft"),
      "and the sketchbook half still answers — half an answer that says which half");
  } finally { process.env.WORLD_DYNAMIC_DB = dbPath; }
});

// ── the door itself ──────────────────────────────────────────────────────────
//
// Everything above tests the log. These test the thing §2 actually rules: that
// `world_leave_mark` ENTERS it — "Every world mutation, no exceptions, enters
// via the dynamic DB's one append-only log … `leave_mark` becomes one INSERT."
// A module that can hold a row proves nothing about the door that used to spend
// a worktree lease, two locks and a commit to write one.

process.env.WORLD_CLONE = repo;

// ── THE DOOR TESTS RUN AGAINST THE RECORD NOW (G1 / POS-156) ───────────────
//
// These four used to run with no store at all: the pen wrote a sqlite journal
// row and the slug guard read `liveMarks` back out of the same table. G1
// deleted that INSERT (RULING 3 — the store is the write) and deleted the
// guards' sqlite fallback (RULING 3a — a guard reading a journal nobody fills
// "PERMITS EVERYTHING"), so BOTH halves of these tests now talk to the record.
//
// The same hand-built `guardStore` is both, which is the point: one record, one
// door. Every claim below is the claim it always was — the row the door wrote,
// the absent git ceremony, the collision refused, the preview writing nothing —
// read off `acts` and `claims` instead of off the journal.
test("THE DOOR, flag on — leave_mark is ONE INSERT: no lease, no lock, no checkout, no commit", async () => {
  process.env.WORLD_SINGLE_LOG = "1";
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  const store = guardStore();

  const before = git("rev-parse", "draft/alpha").trim();
  const result = await withGuardsFlipped(store, () => leaveMarkViaOffice(repo, {
    slug: "through-the-door", kind: "sited", at: { x: 110, y: 105 }, extent: { w: 2, h: 2 },
    body: "the door wrote this into the log",
  }, houseA));

  assert.equal(result.id, "alpha/through-the-door");
  assert.equal(result.log, "acts", "the answer names the pen that wrote it, and there is one record now");
  assert.equal(result.seq, 1, "and its receipt is the ACT's id, where it used to be a commit and then a journal seq");
  assert.equal(result.commit, undefined, "there is no commit, because nothing was committed — absent, not null, which would invite a reader to think one failed");
  assert.equal(result.dir, "alpha/through-the-door",
    "and the answer shape holds across the flag: `dir` still names where the record will sit — at its id, since the freeze");
  assert.equal(result.branch, "draft/alpha", "and `branch` still names the sketchbook the drain will write it to");

  // the git ceremony this slice retires, asserted as absent
  assert.equal(git("rev-parse", "draft/alpha").trim(), before, "the sketchbook branch did not move");
  assert.equal(git("branch", "--show-current").trim(), "main", "and no checkout was parked on a household branch");

  // THE ROW, read off the record the door actually wrote to.
  assert.equal(store.acts.length, 1, "ONE INSERT — the whole claim of this test's name");
  const row = store.acts[0];
  assert.equal(row.action, ACTION_LEAVE);
  assert.equal(row.object, "alpha/through-the-door");
  assert.equal(row.household, "hh:alpha-house",
    "filed under the RESOLVED key, which is what the store's column holds");
  assert.equal(row.class, CLASS_MARK);
  assert.equal(row.at_anchor, "the-town/town-square",
    "and the-witnessed-line holds at the real door: the actor's anchor is on the row, derived from the engine's own containment chain");
  assert.deepEqual({ dx: row.at_dx, dy: row.at_dy }, { dx: 10, dy: 5 });
  assert.ok(row.witnesses, "with a witnesses block, however it was read");
  assert.equal(JSON.parse(row.payload).body, "the door wrote this into the log");
  assert.equal("journal_seq" in row, false,
    "the pen still names `journal_seq` in its INSERT — migration 025 drops that column, and an office writing it fails every act the moment the migration lands");

  // THE DOCKET IS NOT REACHED HERE, and that is this office's real behaviour
  // rather than a gap in the fixture: `claimEligible` gates the candle half on
  // `WORLD2_CANDLE`, which this suite does not set, so a mark-class row writes
  // the deed and no claim. Asserted rather than left silent — a reader who
  // expected a docket row should learn why there is none.
  assert.equal(store.claims.length, 0,
    "no candle in this office, so the docket half does not run — the deed is the whole write");

  // The claim this test used to make here — "the overlay serves it back" — was
  // read from `draftsForKey` over the journal, which G1 emptied. ITS NEW HOME is
  // the B1 tests at the foot of this file, which read the live layer from
  // `claims` through the door's own guard, with a CAN-FAIL beside it.
});

test("THE DOOR, flag on — the slug guard is a STORE lookup, and amend/withdraw are later entries", async () => {
  process.env.WORLD_SINGLE_LOG = "1";
  const { leaveMarkViaOffice, withdrawMarkViaOffice } = await import("../src/world.mjs");
  // ONE STORE FOR THE WHOLE TEST — the guard reads the docket it just wrote to,
  // which is the collision this test exists to catch. Under G1 that is a
  // round trip through the record rather than through the sqlite journal.
  const store = guardStore();
  // ⚑ THE CANDLE IS ON FOR THIS ONE, and it has to be. The slug guard reads
  // `claims`, and `claims` is only written when the docket half runs
  // (`claimEligible` -> `candleEnabled`). With the candle off the first mark
  // leaves a deed and no docket row, so the guard would read an empty live
  // layer and PERMIT the duplicate -- which is the configuration this test
  // exists to refuse, and exactly what it caught when G1 took the sqlite
  // fallback away (RULING 3a). Prod runs both.
  const inStore = (fn) => withGuardsFlipped(store, async () => {
    const was = process.env.WORLD2_CANDLE;
    process.env.WORLD2_CANDLE = "1";
    try { return await fn(); }
    finally { if (was === undefined) delete process.env.WORLD2_CANDLE; else process.env.WORLD2_CANDLE = was; }
  });
  const leaveIt = (extra = {}) => inStore(() => leaveMarkViaOffice(repo, {
    slug: "twice", kind: "sited", at: { x: 110, y: 105 }, extent: { w: 2, h: 2 }, body: "said once", ...extra,
  }, houseA));

  await leaveIt();
  await assert.rejects(leaveIt(), (e) => {
    assert.equal(e.code, 409, "the collision bounces with the grammar the exec used, one process earlier");
    assert.match(e.defect, /you already have a mark "twice"/);
    return true;
  }, "the guard read the live layer — there is no checked-out tree to loadMarks over");

  // APPEND-ONLY, ASSERTED AS EACH DECLARATION LANDS. The first two are
  // UNSTAKED, so Phase 5.6 defers their deed and they live on the docket alone
  // -- their body must never reach `acts`, the table that leaves the box. That
  // is why the chain is read off `claims` here and the deed count off `acts`.
  assert.equal(store.claims.length, 1, "the first declaration is one docket row");
  assert.equal(store.acts.length, 0,
    "and NO deed: an unstaked draft's body never reaches the table that leaves the box (Phase 5.6)");

  const amended = await leaveIt({ amend: true, body: "said better" });
  assert.equal(amended.amended, true);
  assert.equal(store.claims.length, 2,
    "the amend is a LATER ENTRY -- a second row, not an edit of the first");
  assert.deepEqual(store.claims.map((c) => c.body), ["said once", "said better"],
    "and the first row still says what it said; nothing was rewritten");

  const withdrawn = await inStore(() => withdrawMarkViaOffice(repo, { mark: "alpha/twice" }, houseA));
  assert.equal(withdrawn.withdrawn, true);
  assert.equal(withdrawn.was_published, false);

  // THE WITHDRAW IS THE ONE DEED HERE, because it is not a draft: the drafts
  // are DELETED from the docket (007's one deletion -- nothing outside the
  // household ever saw them, so nothing outside is owed an account of their
  // ending) and the withdrawal itself is an act.
  assert.deepEqual(store.acts.map((r) => r.action), [ACTION_WITHDRAW],
    "one deed, and it is the ending");
  assert.equal(store.claims.length, 0, "and the drafts are gone from the docket");
  assert.equal(store.acts.every((r) => r.household === "hh:alpha-house"), true,
    "filed under the resolved key, so a guard scoped by it sees it");

  // "the withdrawn draft never crossed, so the overlay has nothing to draw" was
  // read from `draftsForKey` over the journal, which G1 emptied. ITS NEW HOME is
  // the B1 pair at the foot of this file: the live layer comes from `claims`
  // through the door's own guard, with a CAN-FAIL beside it.
});

// ── PREVIEW (founder-ruled 2026-09-14, postmark#2692): say it, write nothing ──
//
// Keith's third oddity: the ordinary path (walk to your parcel, leave the house
// where you stand) files a house that straddles the parcel line, nests one
// level out, and the remedy the door prints is one the door refuses on a
// published mark. Rather than refusing at the door, the door can SAY where a
// mark would nest before anything is written. These pin the preview on both
// pens: the journal (prod) and the git executor.
test("PREVIEW, flag on — says where the mark would nest and writes no row, no branch, no stake", async () => {
  process.env.WORLD_SINGLE_LOG = "1";
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  const before = git("rev-parse", "draft/alpha").trim();
  const shape = { kind: "sited", at: { x: 110, y: 105 }, extent: { w: 2, h: 2 }, body: "would this sit in the square?" };
  // A PREVIEW STILL RUNS THE GUARDS, which read the record since G1 (RULING
  // 3a), so it needs one even though it writes nothing. That it writes nothing
  // is exactly what the pen below is here to prove.
  const store = guardStore();
  const seen = await withGuardsFlipped(store,
    () => leaveMarkViaOffice(repo, { slug: "previewed", ...shape, preview: true, stamps: 1 }, houseA));
  assert.equal(seen.preview, true, "the answer says it is a preview");
  assert.equal(seen.id, "alpha/previewed");
  assert.equal(seen.parent, "the-town/town-square",
    "the one fact no door said before the write: where it would NEST, by the engine's own containment rule");
  assert.equal(seen.would, "leave");
  assert.ok(seen.nothing_written, "and it says in words that nothing was written");
  assert.ok(seen.publishing?.heads_up, "the publish note rides the preview: the square is the town's ground, so this would be commons-class");
  assert.equal(seen.overhang, undefined, "nested where alpha stands — no overhang to disclose");
  assert.equal(seen.staked, undefined, "stamps: 1 on a preview stakes nothing");
  assert.equal(seen.stake_bounce, undefined);
  // POS-83: …and it says WHAT the stake would do to the stamps, which is the one
  // thing this preview ran the verdict for and never told anyone. Gated on
  // `put_forward`, so the block rides exactly when the ledger move would.
  assert.equal(seen.put_forward, true, "the fixture's inline ✦1 clears the square's minimum");
  assert.ok(seen.stamps, "the stamps block rides the preview of an act that would move stamps");
  assert.deepEqual(Object.keys(seen.stamps), ["you_hold", "this_act", "after", "to_confirm"],
    "one grammar on every door — the same four keys the stake door answers with");
  assert.equal(seen.stamps.this_act.law, "the-town/stake-mark");
  assert.match(seen.stamps.to_confirm, /without preview: true/);
  assert.equal(store.acts.length, 0, "NO ROW IN THE RECORD — a preview is not a declaration");
  assert.equal(store.claims.length, 0, "and no docket row either");
  assert.equal(git("rev-parse", "draft/alpha").trim(), before, "and the sketchbook did not move");
  // ⚑ THE FLIP: drop the preview branch in journalLeaveMark and the row count reads 1.
  const real = await withGuardsFlipped(store,
    () => leaveMarkViaOffice(repo, { slug: "previewed", ...shape }, houseA));
  assert.equal(real.preview, undefined, "the same call without preview: true is the write");
  assert.equal(real.seq, 1, "…and it is the first act, because the preview left none");
  assert.equal(store.acts.length, 1, "one row in the record, and it arrived with the write and not the preview");
});

test("PREVIEW, flag on — a mark outside the ground you stand in nests at the root, and still no row", async () => {
  process.env.WORLD_SINGLE_LOG = "1";
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  // The guards read the record since G1 even on a preview — see the note above.
  const store = guardStore();
  const seen = await withGuardsFlipped(store, () => leaveMarkViaOffice(repo, {
    slug: "over-the-line", kind: "sited", at: { x: 130, y: 100 }, extent: { w: 2, h: 2 }, body: "past the square's edge", preview: true,
  }, houseA));
  assert.equal(seen.preview, true);
  assert.equal(seen.parent, "the-town/let-there-be-light", "outside the square, so it nests at the world's root");
  // No overhang here by the door's own rule: the disclosure fires only for a
  // mark left WHERE YOU STAND (overhangOf's first guard), and this one is placed
  // twenty metres from alpha's feet on purpose. The remedy's wording is pinned
  // in test/world.test.mjs on the pure function.
  assert.equal(seen.overhang, undefined);
  assert.equal(store.acts.length, 0, "still no row in the record");
});

test("PREVIEW, flag off — the git executor answers the same shape and commits nothing", async () => {
  assert.equal(process.env.WORLD_SINGLE_LOG, undefined);
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  const before = git("rev-parse", "draft/alpha").trim();
  const seen = await leaveMarkViaOffice(repo, {
    slug: "git-previewed", kind: "sited", at: { x: 12, y: 12 }, extent: { w: 2, h: 2 }, body: "on the old pen", preview: true,
  }, houseA);
  assert.equal(seen.preview, true);
  assert.equal(seen.id, "alpha/git-previewed");
  assert.equal(seen.parent, "the-town/let-there-be-light",
    "the fixture's files carry no geometry that contains (12,12), so the engine's own rule answers the root");
  assert.equal(seen.commit, undefined, "no commit");
  assert.ok(seen.nothing_written);
  assert.equal(git("rev-parse", "draft/alpha").trim(), before, "the sketchbook branch did not move");
  assert.equal(git("branch", "--show-current").trim(), "main");
});

test("THE DOOR, flag off — a mark named in the FROZEN MANIFEST amends in place, and a new one lands at its id", async () => {
  // THE RULE (the freeze, founder-ruled 2026-08-25): a mark's path is wherever
  // it was born, forever.
  //
  //   "A mark's directory is its historical filing: it carries no claim, and it
  //    NEVER MOVES AGAIN."
  //
  // `WORLD/marks/let-there-be-light/sketchbook-draft/` is a pre-freeze filing in
  // this fixture. Naming it in the manifest makes it a fossil, and an amend must
  // compute THAT path — not `WORLD/marks/alpha/sketchbook-draft/`. Computing the
  // id path would move it, and gate A refuses a move at the next lint.
  assert.equal(process.env.WORLD_SINGLE_LOG, undefined);
  const fossil = "WORLD/marks/let-there-be-light/sketchbook-draft";

  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  const amended = await leaveMarkViaOffice(repo, {
    slug: "sketchbook-draft", kind: "sited", at: { x: 12, y: 12 }, extent: { w: 2, h: 2 },
    body: "amended after the freeze", amend: true,
  }, houseA);
  assert.equal(amended.id, "alpha/sketchbook-draft");

  const files = git("ls-tree", "-r", "--name-only", "draft/alpha", "--", "WORLD/marks").trim().split("\n");
  assert.deepEqual(files.filter((f) => f.includes("/sketchbook-draft/")), [`${fossil}/mark.md`],
    "one file, at the filing it was born with — never a second copy at the id path");
  assert.match(git("show", `draft/alpha:${fossil}/mark.md`), /amended after the freeze/,
    "and it carries the new declaration, so the amend was not simply dropped");

  // THE FLIP, same door, same run: a mark the manifest does not name is a NEW
  // mark and files at its id.
  await leaveMarkViaOffice(repo, {
    slug: "born-after-the-freeze", kind: "sited", at: { x: 400, y: 400 }, extent: { w: 2, h: 2 },
    body: "the manifest never heard of me",
  }, houseA);
  assert.match(git("show", "draft/alpha:WORLD/marks/alpha/born-after-the-freeze/mark.md"),
    /the manifest never heard of me/);
});

test("THE DOOR, flag off — the withdraw guard reads CONTAINMENT, so an id-filed child still blocks it", async () => {
  // THE LAW (the freeze, 2026-08-25): "A mark's directory is its historical
  // filing: it carries no claim."
  //
  // `holdsChildren` used to read the mark's CHILD DIRECTORIES. Under filing by
  // identity a mark's children are not underneath it on disk, so that read
  // returns false forever and the guard — "a withdrawal may not strand what
  // stands on it" — silently stops protecting. Nothing errors; the stranding
  // just happens. The guard now asks the ground, through the world's own fold.
  //
  // THE CALL GRAPH, checked rather than assumed: `leave-exec.mjs` is spawned
  // only from world.mjs's two `else` branches of `if (singleLogEnabled())`. The
  // drain never replays through it. So this door is live exactly when the flag
  // is off, which is what this test runs under.
  assert.equal(process.env.WORLD_SINGLE_LOG, undefined);
  const { leaveMarkViaOffice, withdrawMarkViaOffice } = await import("../src/world.mjs");

  // A big mark, then a small one standing geometrically inside it. Both file at
  // their ids — neither is inside the other's DIRECTORY.
  await leaveMarkViaOffice(repo, {
    slug: "the-yard", kind: "sited", at: { x: 300, y: 300 }, extent: { w: 40, h: 40 }, body: "a yard",
  }, houseA);
  await leaveMarkViaOffice(repo, {
    slug: "the-shed", kind: "sited", at: { x: 300, y: 300 }, extent: { w: 2, h: 2 }, body: "a shed in the yard",
  }, houseA);

  const yard = git("show", "draft/alpha:WORLD/marks/alpha/the-yard/mark.md");
  assert.match(yard, /a yard/, "both marks filed at their ids…");
  assert.match(git("show", "draft/alpha:WORLD/marks/alpha/the-shed/mark.md"), /a shed in the yard/,
    "…so the shed is NOT inside the yard's directory, which is the whole point");

  await assert.rejects(
    withdrawMarkViaOffice(repo, { mark: "alpha/the-yard" }, houseA),
    (e) => {
      assert.equal(e.code, 409);
      assert.match(e.defect, /still holds marks inside it/);
      return true;
    },
    "the shed stands in the yard by CONTAINMENT — withdrawing the yard would strand it");
});

test("THE FLIP, flag off — a mark with nothing standing in it still withdraws", async () => {
  // Or the guard above would be a guard that refuses everything, which proves
  // nothing about containment.
  assert.equal(process.env.WORLD_SINGLE_LOG, undefined);
  const { leaveMarkViaOffice, withdrawMarkViaOffice } = await import("../src/world.mjs");
  await leaveMarkViaOffice(repo, {
    slug: "the-lone-post", kind: "sited", at: { x: 900, y: 900 }, extent: { w: 1, h: 1 }, body: "nothing stands on it",
  }, houseA);
  const gone = await withdrawMarkViaOffice(repo, { mark: "alpha/the-lone-post" }, houseA);
  assert.equal(gone.withdrawn, true);
});

test("THE DOOR, flag off — the same call still spends a commit on the sketchbook, and the log stays empty", async () => {
  assert.equal(process.env.WORLD_SINGLE_LOG, undefined);
  const { leaveMarkViaOffice } = await import("../src/world.mjs");

  const result = await leaveMarkViaOffice(repo, {
    slug: "the-old-way", kind: "sited", at: { x: 110, y: 105 }, extent: { w: 2, h: 2 },
    body: "written the way today writes",
  }, houseA);

  assert.equal(result.branch, "draft/alpha", "the git lane, untouched");
  assert.ok(result.commit, "with a commit for a receipt");
  assert.equal(result.log, undefined, "and no mention of a journal it never used");
  assert.match(git("show", "draft/alpha:WORLD/marks/alpha/the-old-way/mark.md"), /written the way today writes/);
  assert.equal(withDb((db) => journalHead(db)), 0,
    "not one row — flag off, the log is not merely ignored at the read, it is never written");
});

// ═════════════════════════════════════════════════════════════════════════════
// B1 · THE READ FLIP — `W2_GUARDS=1`, the door's guards over `claims`
// ═════════════════════════════════════════════════════════════════════════════
//
// Runbook §4 B1's third GO, verbatim: "a deliberate duplicate-slug submission is
// refused at the door with the reason named."
//
// The equality falsifier (`falsifier-guard-equality.mjs`) is the proof that the
// PORT and 1.0 agree, and it needs Postgres, a world checkout and a scratch
// database — so it runs on the box and only there. What it cannot reach is the
// DOOR: whether `journalLeaveMark`'s collision branch is actually fed by the
// port under the flag. That is what these three assert, over the same hand-built
// store the flag-off control above uses — same repo, same door, same payload,
// and the live layer coming from `claims` instead of the journal.
//
// The store is a hand-built CLIENT rather than a database, exactly as
// `world2-guard-reads.test.mjs` hand-builds rows rather than a store: what is
// under test is the WIRE, and a real Postgres would test the port a second time
// while proving nothing more about the door.
//
// CAN-FAIL: the third test IS the flip. It breaks the household spelling — the
// bare handle instead of the resolved key, which is
// `DISCLOSURES.two_household_spellings` and the falsifier's own second injected
// fault — and asserts that the duplicate is then PERMITTED. Both directions are
// asserted, so a wire that is not there cannot pass the pair.

/**
 * A `claims` row as `submitClaimFromJournal` writes one, plus the `identities`
 * line `householdKeyFor` resolves through. Nothing here is arranged to please
 * the port: the field names are the columns' own.
 */
// ── AND IT IS THE PEN NOW TOO (G1 / POS-156, RULING 3) ─────────────────────
//
// The door used to write a sqlite journal row and queue a Postgres copy behind
// it, so this store only had to answer the guards' READS. G1 deleted that
// INSERT and made the write AWAITED and REFUSABLE -- "the store is the write"
// -- so a door test that does not point the office at a record now gets the
// ruled 503 instead of exercising the door.
//
// So the same hand-built store answers the write too: `insertAct`'s one INSERT,
// and the two docket queries a mark-class row reaches (`claimTxFromJournal`
// needs the open window, and files the claim). It stays ONE store rather than
// gaining a second stub beside it, because the whole argument of this harness is
// that the door talks to one record.
//
// ⚑ IT STILL THROWS ON A QUERY IT DOES NOT KNOW. An empty answer to an
// unrecognised statement is indistinguishable from "the record holds none",
// which is the one confusion a guard may not have.
const guardStore = ({ claims = [], identities = { alpha: "hh:alpha-house", beta: "hh:beta-house" }, scopeAs = (h) => h } = {}) => {
  // TWO SESSION SETTINGS since POS-160 RULING 4 — the store never re-spells a
  // row, so a house declares EVERY spelling it has ever carried and 024's four
  // draft policies compare against that set. `app.household` is still the one
  // current spelling, and `guard-reads.mjs § assertHouseholdDeclared` refuses a
  // guard read on a connection that declared only one of the two. The
  // `_keys` arm must be matched FIRST: `app.household` is a prefix of
  // `app.household_keys`, so a looser pattern would let the set clobber the key.
  let declared = null;
  let declaredKeys = null;
  const calls = { claims: 0 };
  const acts = [];
  let nextActId = 1;
  const self = {
    calls,
    acts,
    // The docket, exposed: a test that files a mark reads back the row the
    // door put on it, which is where an unstaked declaration lives.
    claims,
    client: {
      async query(sql, args = []) {
        if (/set_config\(.app\.household_keys./.test(sql)) {
          declaredKeys = args[0] ? String(args[0]).split(",") : null; return { rows: [{}] };
        }
        if (/set_config\(.app\.household./.test(sql)) { declared = args[0]; return { rows: [{}] }; }
        if (/current_setting\(.app\.household./.test(sql)) return { rows: [{ declared, keys: declaredKeys }] };
        if (/FROM identities/.test(sql)) return { rows: identities[args[0]] ? [{ household: identities[args[0]] }] : [] };
        // THE REGISTRY, which is what `householdKeyFor` reads since POS-160.
        // Same statement as the `identities` line above — these handles live in
        // these houses — in the vocabulary the resolver now asks in. The keys
        // are `hh:` because that is what the resolver answers from the law
        // date, and what the rows' own `household` column therefore holds.
        if (/FROM households/.test(sql)) return { rows:
          [...new Set(Object.values(identities))].map((key, ord) => ({
            slug: String(key).replace(/^hh:/, ""), ord, name: null, human: null, accounts: [],
            residents: Object.keys(identities).filter((h) => identities[h] === key),
            since: null, member_of: null, declared_by: null, formerly: [], provisional: false,
          })) };
        if (/FROM household_pins/.test(sql)) return { rows: [] };
        if (/FROM registry_meta/.test(sql)) return { rows: [{ key: "schema_version", value: 1 }] };
        // THE AMEND'S SUPERSESSION LOOKUP, which is a different question with
        // different arguments: "is there a PENDING claim for this slug in this
        // window to chain from". Told apart by `window_id`, because answering
        // it with the guard's branch read `statuses.includes` off a window id.
        // Empty is the truthful answer here -- nothing in these fixtures is
        // pending -- so an amend files a fresh claim, which is what
        // `claimTxFromJournal` does when it finds no in-window chain.
        // ⚑ THE READ BRANCHES MUST REQUIRE `SELECT`. "DELETE FROM claims"
        // contains "FROM claims", so a bare match here swallowed the
        // withdrawal's deletion and answered it with a row list -- the drafts
        // stayed on the docket and nothing said so.
        if (/^SELECT/i.test(sql.trim()) && /FROM claims/.test(sql) && /window_id/.test(sql)) return { rows: [] };
        // "Is there a STANDING mark with this slug to amend?" -- the fall-back
        // the supersession chain asks when no in-window pending claim exists
        // (#2806). No fixture here has ever been published, so the truthful
        // answer is none, and the amend files a fresh claim.
        if (/FROM marks/.test(sql)) return { rows: [] };
        if (/^SELECT/i.test(sql.trim()) && /FROM claims/.test(sql)) {
          calls.claims += 1;
          // `asked` is the SPELLING SET now (`household = ANY($2)`), so the
          // filter is membership rather than equality — the predicate the
          // policy evaluates, in the shape it evaluates it. `scopeAs` still
          // rewrites what the guard asked for, which is what the CAN-FAIL test
          // below flips to make the duplicate slip through.
          const [statuses, asked] = args;
          const keys = asked == null ? null : [].concat(asked).map(scopeAs);
          return { rows: claims.filter((c) => statuses.includes(c.status) && (keys == null || keys.includes(c.household))) };
        }
        if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return { rows: [] };

        // THE WRITE. `insertAct`'s column list, in its order; the id is
        // assigned here because that is what the sequence does.
        if (/^INSERT INTO acts/i.test(sql.trim())) {
          const id = nextActId++;
          acts.push({ id, at: args[0], crossing: args[1], actor: args[2], action: args[3],
            object: args[4],
            // THE WITNESSED LINE IS THREE COLUMNS, on this side of the seam as
            // on the other -- it has never lived in `payload`, and a fixture
            // that put it there would agree with a reader nothing writes for.
            at_anchor: args[5], at_dx: args[6], at_dy: args[7],
            witnesses: args[8], class: args[9], payload: args[10],
            effect: args[11], household: args[12],
            // ⚑ ONLY PRESENT IF THE PEN SENT IT. G1 drops `acts.journal_seq`
            // (migration 025) and the pen stopped naming it; a row that carried
            // the key unconditionally would let a suite assert the column's
            // absence and pass while the pen still wrote it.
            ...(args.length > 13 ? { journal_seq: args[13] } : {}) });
          return { rows: [{ id }], rowCount: 1 };
        }
        // The docket half a mark-class row reaches on the same client.
        if (/FROM windows/i.test(sql)) return { rows: [{ id: 1 }] };
        // THE DOCKET RECEIVES THE ROW, it does not swallow it. A stub that
        // acknowledged the INSERT and kept nothing would let "the door filed a
        // duplicate slug" pass, because the guard's next read would find the
        // docket empty -- the permissive direction, which is the one direction a
        // guard may not fail in. The column list is `claimTxFromJournal`'s.
        if (/^INSERT INTO claims/i.test(sql.trim())) {
          const [, kind, claimant, household, body, geometry, bbox, stake, supersedes, data, slug, status] = args;
          claims.push({ id: `00000000-0000-0000-0000-0000000000${String(claims.length + 1).padStart(2, "0")}`,
            slug, class: kind, claimant, household, status, body,
            geometry: typeof geometry === "string" ? JSON.parse(geometry) : geometry,
            bbox, stake, supersedes, data, submitted_at: new Date() });
          return { rows: [{ id: claims.at(-1).id }], rowCount: 1 };
        }
        // Withdraw's two outcomes: a draft is DELETED, a pending claim retracted.
        // THE HOUSEHOLD IS A SPELLING SET NOW (POS-160 / #165). The withdraw's
        // DELETE went from `household = $3` to `household = ANY($3)`, and $3 is
        // `declaredKeys`' array -- a house may be spelled more than one way and
        // a draft filed under any of its spellings is still its draft. A stub
        // still comparing against a scalar matched none of them, so the drafts
        // stayed on the docket and the slug stayed taken.
        if (/^DELETE FROM claims/i.test(sql.trim())) {
          const [slug, claimant, households] = args;
          const keys = Array.isArray(households) ? households : [households];
          const before = claims.length;
          for (let i = claims.length - 1; i >= 0; i--) {
            const c = claims[i];
            if (c.status === "draft" && c.slug === slug && c.claimant === claimant && keys.includes(c.household)) claims.splice(i, 1);
          }
          return { rows: [], rowCount: before - claims.length };
        }
        // `declaredKeys` asks the session for the house's spellings; a client
        // that has none falls back to the one key it was given, which is this
        // fixture's case and the honest answer for a store with no session.
        if (/current_setting\('app\.household_keys'/i.test(sql)) return { rows: [{ keys: null }] };
        if (/^UPDATE claims/i.test(sql.trim())) return { rows: [], rowCount: 0 };

        throw new Error(`the hand-built store was asked something it does not know: ${sql.slice(0, 80)}`);
      },
      release() { /* pooled in name only */ },
    },
  };
  // The pools take a POOL, so the store is one: `connect()` hands back the same
  // client every read in this file already uses.
  self.connect = async () => self.client;
  self.query = (sql, args) => self.client.query(sql, args);
  self.end = async () => {};
  return self;
};

/** One live draft of alpha's, filed under the RESOLVED KEY, as the docket pen files it. */
const draftClaim = (slug, over = {}) => ({
  id: "00000000-0000-0000-0000-000000000001",
  // POS-160: the resolved key is the house's SLUG now, so the row wears what
  // `householdKeyFor` files it under. If these two ever drift apart again the
  // guard reads an empty `claims` and permits the duplicate, which is exactly
  // what the CAN-FAIL test below makes happen on purpose.
  slug: `alpha/${slug}`, class: "sited", claimant: "alpha", household: "hh:alpha-house", status: "draft",
  body: "the docket already holds this one",
  geometry: { slug: `alpha/${slug}`, at: { x: 110, y: 105 }, extent: { w: 2, h: 2 } },
  stake: 0, data: { by: "alpha", kind: "sited", date: "2026-09-03", _journal_seq: 1 },
  submitted_at: new Date("2026-09-03T00:00:00Z"),
  ...over,
});

const withGuardsFlipped = async (store, fn) => {
  const guards = await import("../src/world2-guards.mjs");
  const acts = await import("../src/world2-acts.mjs");
  const pen = await import("../src/world2-pen.mjs");
  const house = await import("../src/household-deriver.mjs");
  const prev = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL, flag: process.env.W2_GUARDS };
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://hand-built/none";   // never dialled — the reader is replaced
  process.env.W2_GUARDS = "1";
  const restore = guards.useGuardReader((run) => run(store.client));
  // THE WRITE GOES TO THE SAME STORE (G1). Both pools, because the office holds
  // two: `world2-acts.mjs` has the mirror's and `world2-pen.mjs` the awaited
  // pen's, and a test that set only one would write through the other and reach
  // a real socket.
  acts.__setPoolForTest(store);
  pen.__setPoolForTest(store);
  house.__clearHouseCache();
  try {
    assert.equal(guards.guardsFlipped(), true, "the flag is READ, not merely set — B1's gate 1");
    return await fn(guards);
  } finally {
    restore();
    acts.__setPoolForTest(null);
    pen.__setPoolForTest(null);
    house.__clearHouseCache();
    for (const [k, v] of [["WORLD2_PG", prev.pg], ["WORLD2_PG_URL", prev.url], ["W2_GUARDS", prev.flag]])
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
};

test("B1 — the duplicate slug is refused at the DOOR, from `claims`, with the reason named", async () => {
  process.env.WORLD_SINGLE_LOG = "1";
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  const store = guardStore({ claims: [draftClaim("the-docketed-one")] });

  await withGuardsFlipped(store, async () => {
    await assert.rejects(
      leaveMarkViaOffice(repo, {
        slug: "the-docketed-one", kind: "sited", at: { x: 110, y: 105 }, extent: { w: 2, h: 2 },
        body: "a second declaration of a slug the docket already holds",
      }, houseA),
      (e) => {
        assert.equal(e.code, 409, "the door's own collision bounce, unchanged across the flag");
        assert.match(e.defect, /you already have a mark "the-docketed-one"/,
          "and the REASON IS NAMED — the resident is told which slug, not that something went wrong");
        assert.match(e.hint, /a slug is unique per author/);
        return true;
      });
  });

  assert.ok(store.calls.claims > 0, "and the answer came from `claims` — the guard read really ran");
  assert.equal(withDb((db) => journalHead(db)), 0,
    "the journal never held this slug: the refusal is the port's, not the sqlite layer's");
});

test("B1 — the guard is the only thing that changed: the same door still admits a slug nobody holds", async () => {
  process.env.WORLD_SINGLE_LOG = "1";
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  const store = guardStore({ claims: [draftClaim("the-docketed-one")] });

  const result = await withGuardsFlipped(store, () => leaveMarkViaOffice(repo, {
    slug: "nobody-holds-this", kind: "sited", at: { x: 110, y: 105 }, extent: { w: 2, h: 2 },
    body: "a slug the docket has never seen",
  }, houseA));

  assert.equal(result.id, "alpha/nobody-holds-this");
  // THE SENTENCE THIS ASSERTED HAS BEEN OVERTAKEN BY G1. It read `log:
  // "journal"` and said "the READ flipped; the PEN did not — B1 and the
  // C-series are two flags". Both halves are the record now: RULING 3 made the
  // pen the store, RULING 3a took the guards' sqlite fallback away. So the
  // answer names `acts` on both sides, and what this test still proves — the
  // guard admits a slug nobody holds — is untouched.
  assert.equal(result.log, "acts", "one record, named on the answer");
  assert.equal(store.acts.length, 1, "and the door wrote it there, which is the pen half of the same fact");
});

test("B1 CAN-FAIL — scope the guard by the bare handle and the duplicate is PERMITTED", async () => {
  // `DISCLOSURES.two_household_spellings`: `claims.household` holds the RESOLVED
  // KEY, and 1.0's guards are scoped by the household NAME. A guard scoped by
  // the wrong spelling reads an EMPTY live layer and permits everything, with
  // nothing on any page to show for it.
  //
  // The break is injected IN MEMORY, the way `--prove-can-fail` injects its
  // seven: the scoping of the `claims` read is bent to the bare handle while the
  // rows keep the key the docket pen actually files them under. It is the
  // equality falsifier's own second fault ("claims.household read as the bare
  // handle (the resolved-key edge) — 4"), made at the door instead of at the
  // port.
  //
  // NOT by dropping the `identities` line, which was the first attempt and read
  // INERT: `householdKeyFor` memoises positive answers for the life of the
  // process, so the earlier test's resolution answered this one too. An inert
  // break proves nothing (the standing lane's finding), so it is named here
  // rather than left as a green.
  process.env.WORLD_SINGLE_LOG = "1";
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  const store = guardStore({ claims: [draftClaim("the-docketed-one")], scopeAs: () => "alpha" });

  const permitted = await withGuardsFlipped(store, () => leaveMarkViaOffice(repo, {
    slug: "the-docketed-one", kind: "sited", at: { x: 110, y: 105 }, extent: { w: 2, h: 2 },
    body: "the same duplicate, past a guard reading the wrong spelling",
  }, houseA));

  assert.equal(permitted.id, "alpha/the-docketed-one",
    "RED, deliberately: the wrong household spelling lets the duplicate through. The first test is this one, flipped back.");
});

// ════════════════════════════════════════════════════════════════════════════
// postmark#3025 · the sovereignty guard's retirement, at the JOURNAL door
// ════════════════════════════════════════════════════════════════════════════
//
// Legs 1 and 3 of `test/parcel-over-a-painted-house.test.mjs`, ported onto
// this file's store harness (main-into-w40, 2026-09-25). Main wrote them
// against a sqlite journal door. Since POS-156 (G1) that door reads and writes
// the store with no fallback, so they run here, where the one hand-built store
// answers the guards and the write. Leg 2, the git-era twin, stays in that file.
//
// THE CAN-FAIL FLIP: restore the guard in `src/world.mjs` (it read
// `seeding/manifest.json` and refused a parcel wholly inside another household's
// PAINTED house) and LEG 1 reds with the 403. LEG 3 is green on both sides and
// is a non-regression, not a discriminator.

test("#3025 LEG 1 · THE FIX, journal door: a parcel claim over a painted house standing on nobody's parcel is ADMITTED", async () => {
  process.env.WORLD_SINGLE_LOG = "1";
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  const store = guardStore();
  let out;
  try {
    out = { ok: true, ...(await withGuardsFlipped(store, () => leaveMarkViaOffice(repo, {
      slug: "the-common-ground", kind: "parcel", at: { x: 300, y: -300 },
      body: "common ground by the standing law — the painting said otherwise",
    }, houseA))) };
  } catch (e) { out = { ok: false, code: e?.code, defect: e?.defect ?? e?.message }; }
  assert.notEqual(out.code, 403,
    `the retired guard fired: ${JSON.stringify(out)} — before #3025 this is 403 "that spot is inside neighbour's home"`);
  assert.equal(out.ok, true, `the claim must go forward: ${JSON.stringify(out)}`);
  assert.equal(out.id, "alpha/the-common-ground");
  assert.equal(store.acts.length, 1, "and the door wrote it to the store — the claim really went through");
});

// This leg does not move when the guard is restored. It says, in a test, what
// this door does about a claim over a neighbour's PARCEL: it admits it, and
// always has. The refusal is `tools/marks-fold.mjs § admissibility`, at the
// crossing: "parcel overlaps <id> — inadmissible (MARKS.md § Parcels)".
test("#3025 LEG 3 · NON-REGRESSION: a parcel claim over a neighbour's PARCEL is admitted by this door and refused at the crossing", async () => {
  process.env.WORLD_SINGLE_LOG = "1";
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  const store = guardStore();
  let out;
  try {
    out = { ok: true, ...(await withGuardsFlipped(store, () => leaveMarkViaOffice(repo, {
      slug: "over-the-neighbour", kind: "parcel", at: { x: -300, y: 300 },
      body: "straight over the neighbour's ground",
    }, houseA))) };
  } catch (e) { out = { ok: false, code: e?.code, defect: e?.defect ?? e?.message }; }
  assert.equal(out.ok, true,
    `unchanged by #3025: this door carries no overlap check, before or after. Got ${JSON.stringify(out)}`);
  assert.equal(out.id, "alpha/over-the-neighbour");
});
