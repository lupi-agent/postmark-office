// set-down-files-the-amend.test.mjs — POS-138, the office half.
//
// THE LAW: `LOGOS/classes.md` § The reach of a hold — a set-down's "position
// is written on the act and is canon at the next fold like any move". A move is
// an AMEND through the office's pen (`LOGOS/state-and-time.md`: "the settlement
// writes a mark once; nothing moves it after").
//
// THE INSTANCE: Keith set his own stool down in the Waiting Room (postmark#2693,
// act 1636, 2026-09-10). The hold door told him "the record re-sites the mark at
// the next fold" and filed nothing, so canon kept the stool in his garage
// through nine folds while the read said it stood in the Waiting Room.
//
// THE RULING (Keemin, 2026-09-24): the author's pen moves the author's own
// thing without ceremony; a set-down by ANOTHER household moves nothing in
// canon until the author's house accepts it, and the read says so.
//
// WHAT THIS SUITE DRIVES: the real hold door (`callHoldTool`) on a temporary
// dynamic store, whose drop reaches the real leave-mark door
// (`leaveMarkViaOffice` → `journalLeaveMark` → `appendActFlipped` →
// `claimTxFromJournal`), against an in-memory record (`acts-pen-stub.mjs`) that
// keeps every act and claim it is handed. Nothing here is a copy of the amend
// shape: the rows asserted are the rows the door wrote.
//
// THE SECOND HALF (Keemin, 2026-09-24 ~10:1x, "I agree with you here", on
// PR #180's proposal) is at the foot of this file: the author's house answers a
// stranger's set-down through the real stance door — accept, refuse, silence,
// and the author-only speaker refusal.
//
//   node --test test/set-down-files-the-amend.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };

const repo = mkdtempSync(join(tmpdir(), "pos138-world-"));
const town = mkdtempSync(join(tmpdir(), "pos138-town-"));
const scratch = mkdtempSync(join(tmpdir(), "pos138-db-"));
after(() => { sweep(repo); sweep(town); sweep(scratch); });

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (root, path, text) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// ── the world in a bottle ────────────────────────────────────────────────────
//
// Keith's house (`gh:1`: keith, and his housemate kin) holds the garage and a
// yard parcel. Ana is another household (`gh:2`). The Waiting Room is the
// postmaster's. The stool is Keith's thing, folded in the garage — the live
// record's own fields, copied from world main `5509c996`.
const STOOL = "keith/waiting-room-stool-2026-09-10";
const GARAGE_AT = { x: 3978, y: -398 };
const WAITING_ROOM_AT = { x: 176, y: 425.5 };
const YARD_AT = { x: 4100, y: -300 };
const ANA_AT = { x: 4105, y: -305 };

const stoolRecord = {
  id: STOOL, kind: "sited", by: "keith", tier: "home", household: "keith", declared_household: "gh:1",
  date: "2026-09-10T15:37:58.221Z", at: GARAGE_AT, extent: { w: 1, h: 1 }, sovereign: true, stamps: 2, weight: 2,
  weight_parts: { own_escrow: 2 }, body: "Three-legged stool in pale ash: splayed legs, brass levelers, a seat sanded kind. Two names and a date under the seat. Built for whoever waits.",
  class: "thing", placementParent: "keith/the-garage", ledger_weight: 2,
};

const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 20000, h: 20000 }, body: "the world frame" },
  { id: "keith/the-garage", by: "keith", kind: "sited", tier: "home", at: GARAGE_AT, extent: { w: 20, h: 20 }, body: "one bay door up" },
  { id: "keith/the-yard", by: "keith", kind: "parcel", tier: "home", at: YARD_AT, extent: { w: 25, h: 25 }, body: "the yard behind the garage" },
  { id: "kin/the-shed", by: "kin", kind: "parcel", tier: "home", at: { x: 4130, y: -300 }, extent: { w: 25, h: 25 }, body: "the shed beside the yard" },
  // Ana stands INSIDE Keith's yard (this bottle's where-is puts a resident at
  // their own parcel's centre), so a set-down she makes lands on Keith's own
  // ground: the minimum there is zero, and a welcome goes forward. It is also
  // the plainest version of the question — a stranger's thing left on YOUR land.
  { id: "ana/the-orchard", by: "ana", kind: "parcel", tier: "home", at: ANA_AT, extent: { w: 5, h: 5 }, body: "an orchard" },
  { id: "postmaster/the-waiting-room", by: "postmaster", kind: "sited", tier: "market", at: WAITING_ROOM_AT, extent: { w: 30, h: 30 }, body: "the waiting room" },
  stoolRecord,
];

put(repo, "tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n`);
put(repo, "tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function homeOf(handle, world) {
  const parcel = (world?.parcels ?? []).find((p) => p.household === handle);
  if (!parcel) return { ...NOWHERE };
  return { x: parcel.at.x, y: parcel.at.y, placed: true, source: "parcel", mark_id: parcel.id, parcel };
}
export function whereIs(handle, { world = null } = {}) { return homeOf(handle, world); }
export function publicResidents() { return []; }
`);
put(repo, "tools/world-verbs.mjs", `
export function containmentChain(pos, marks) {
  return (marks ?? [])
    .filter((m) => m.at && m.extent && Math.abs(pos.x - m.at.x) <= m.extent.w / 2 && Math.abs(pos.y - m.at.y) <= m.extent.h / 2)
    .sort((a, b) => (b.extent.w * b.extent.h) - (a.extent.w * a.extent.h))
    .map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body }));
}
export function orient() { return { seen: [] }; }
export function investigate() { return null; }
`);
put(repo, "tools/marks-fold.mjs", `
export function loadMarks() { return []; }
export const PARCEL_EXTENT_M = 25;
export const PARCEL_CLAIM_CAP = 3;
export const PARCEL_CAP_LAW_DATE = "2026-07-30";
export function marksContain(outer, inner) {
  if (!outer?.at || !outer?.extent || !inner?.at) return false;
  return Math.abs(inner.at.x - outer.at.x) <= outer.extent.w / 2
      && Math.abs(inner.at.y - outer.at.y) <= outer.extent.h / 2;
}
`);
// The engine's geometry, which the stance door asks for overlap and will not
// substitute its own (`world-stance.mjs § stanceGeometry`).
put(repo, "tools/geometry.mjs", `
export const rect = (m) => ({ x0: m.at.x - m.extent.w / 2, x1: m.at.x + m.extent.w / 2, y0: m.at.y - m.extent.h / 2, y1: m.at.y + m.extent.h / 2 });
export function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}
`);
put(repo, "seeding/manifest.json", JSON.stringify({ homes: [] }));
put(repo, "WORLD/households.json", JSON.stringify({ households: { keith: "gh:1", kin: "gh:1", ana: "gh:2" } }));
put(repo, "WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put(repo, "WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: PUBLISHED,
  parcels: PUBLISHED.filter((m) => m.kind === "parcel").map((m) => ({ id: m.id, household: m.by, at: m.at, extent: m.extent })),
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));
put(repo, "WORLD/filing-freeze.json", JSON.stringify({ frozen_at: "2026-08-25", marks: {} }));
git("init", "-q", "-b", "main");
git("config", "user.email", "test@postmark.town");
git("config", "user.name", "pos138 falsifier");
git("add", "-A");
git("commit", "-qm", "canon: keith's stool, folded in his garage");
git("branch", "-q", "draft/keithhouse");

// THE TOWN'S HOUSEHOLD MAP, the one `households.mjs § householdOf` folds —
// the same reader the door's reach clause asks. Two houses.
put(town, "tools/stamp-mint.mjs", `
export function currentHouseholds() {
  return new Map([["keith", { key: "gh:1" }], ["kin", { key: "gh:1" }], ["ana", { key: "gh:2" }]]);
}
`);

process.env.WORLD_CLONE = repo;
process.env.TOWN_CLONE = town;
process.env.WORLD_SINGLE_LOG = "1";
process.env.WORLD_DYNAMIC_DB = join(scratch, "dynamic.db");
process.env.W2_GUARDS = "";
process.env.W2_PEN = "mark,hold";
process.env.WORLD2_CANDLE = "1";
process.env.TOWN_PUSH = "";

const { installActsPen, uninstallActsPen, RECORD_ON } = await import("./acts-pen-stub.mjs");
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
const STANDING_ID = "7f3a0c1e-0000-4000-8000-000000000636";
// THE DOCKET PEN HOLDS ITS OWN POOL (`world2-claims.mjs § __setPoolForTest`):
// the claim half resolves its household there before the transaction opens.
// `installActsPen` sets the acts and pen pools only, so without this the
// amend reaches a real socket and refuses as an unreachable record.
const claimsPen = await import("../src/world2-claims.mjs");
const install = () => { const p = installActsPen({ marks: [{ id: STANDING_ID, slug: STOOL }] }); claimsPen.__setPoolForTest(p); return p; };
let pen = install();
after(() => { uninstallActsPen(); claimsPen.__setPoolForTest(null); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

const hold = await import("../src/world-hold.mjs");
const { openDynamic } = await import("../src/dynamic-store.mjs");
const { declareAttachment } = await import("../src/dynamic-entities.mjs");

const KEITH = { household: "keithhouse", handles: new Set(["keith", "kin"]) };
const ANA = { household: "anahouse", handles: new Set(["ana"]) };
const HOUSES = (h) => ({ keith: { key: "gh:1", slug: "keith-house" }, kin: { key: "gh:1", slug: "keith-house" }, ana: { key: "gh:2", slug: "ana-house" } })[h] ?? null;

/** Put the stool in `who`'s hands on the dynamic store, as a take would have. */
// Stamped NOW, not on the instance's date: the drop the door makes next is
// stamped now too, and latest-wins must see this hand-off after every earlier
// test's drop or the door reads the stool as standing on the ground.
function hand(who) {
  const db = openDynamic();
  try { declareAttachment(db, { entity: who, target: STOOL, policy: "cascade", declaredBy: who, bornAt: new Date().toISOString() }); }
  finally { db.close(); }
}
const fresh = () => { uninstallActsPen(); pen = install(); return pen; };
const parse = (v) => (typeof v === "string" ? JSON.parse(v) : v);

// ── FALSIFIER 1 · the author's own set-down files the amend ──────────────────
//
// THE FLIP: delete the `fileSetDownAmend` call in `callHoldTool`'s flipped
// branch and this goes red on "no amend act" — the drop alone is what the
// office wrote before POS-138.

test("KEITH DROPS KEITH'S STOOL: the drop files an amend in the store's own shape — at = the standpoint, attributed to the drop act", async () => {
  const p = fresh();
  hand("keith");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH);
  assert.equal(r.did, "drop", `the door answered ${JSON.stringify(r)}`);

  const acts = p.rows();
  const drop = acts.find((a) => a.action === "drop");
  const amend = acts.find((a) => a.action === "amend");
  assert.ok(drop, "the drop act is on the record, as before");
  assert.ok(amend, `no amend act — the set-down filed nothing. Acts: ${acts.map((a) => a.action).join(", ")}`);
  assert.equal(amend.class, "mark", "the amend is a mark-class act, the lane every door-made amend rides");
  assert.equal(amend.actor, "keith", "the author's pen: the amend is Keith's own");
  assert.equal(amend.object, STOOL);

  const payload = parse(amend.payload);
  assert.deepEqual(payload.at, YARD_AT, "at = the standpoint Keith stood on when he set it down");
  assert.deepEqual(r.stands_at, YARD_AT, "…the same point the receipt says it stands at");
  assert.equal(payload._set_down.act_id, String(drop.id), "attributed to the drop act, by the act's own id");
  assert.equal(payload._set_down.by, "keith");
  assert.equal(payload.class, "thing", "every field Keith wrote is copied — the stool is still a thing");
  assert.equal(payload.body, stoolRecord.body);
  assert.deepEqual(payload.extent, stoolRecord.extent);

  // THE CANDLE HALF — the claim the crossing locks and the fold re-sites.
  const claims = p.claims();
  assert.equal(claims.length, 1, `one claim, got ${JSON.stringify(claims)}`);
  const c = claims[0];
  assert.equal(c.slug, STOOL);
  assert.equal(c.claimant, "keith", "claimant = owner, so materialize grains it to Keith's house");
  assert.equal(c.supersedes, STANDING_ID, "it supersedes the standing mark — the amend chain, not a fresh claim (#2806)");
  assert.deepEqual(c.geometry.at, YARD_AT, "the claim's own geometry carries the set-down point");
  assert.equal(c.status, "pending", "on Keith's own ground the minimum is zero, so it goes forward");
  assert.equal(parse(c.data)._set_down.act_id, String(drop.id), "the claim names the drop act too");
  assert.equal(parse(c.data)._act_id, String(amend.id), "and its own act, as every candle claim does");

  assert.equal(r.set_down.amend.filed, true);
  assert.equal(r.set_down.amend.put_forward, true);
  assert.match(r.stands_note, /the amend that re-sites the mark is filed \(act \d+\), and canon moves it here at the next crossing/);
  console.log(`    RECEIPT · ${r.stands_note}`);
});

test("the unflipped hold pen files the same amend, attributed by the drop's own stamp (its mirror returns no id)", async () => {
  const p = fresh();
  process.env.W2_PEN = "mark";
  try {
    hand("keith");
    const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH);
    assert.equal(r.did, "drop");
    const amend = p.rows().find((a) => a.action === "amend");
    assert.ok(amend, "the unflipped pen files the amend too — one law, both pens");
    const sd = parse(amend.payload)._set_down;
    assert.equal(sd.act_id, null, "no act id to name on this pen, and none is invented");
    assert.equal(sd.written_at, r.at, "the drop declaration's own stamp pairs the two acts");
  } finally { process.env.W2_PEN = "mark,hold"; }
});

test("a housemate's set-down is the author's household's: the door's own amend, in the author's name, filed through the housemate's key", async () => {
  const p = fresh();
  hand("kin");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "kin" }, KEITH);
  assert.equal(r.did, "drop");
  assert.equal(r.set_down.whose, "your household's");
  const amend = p.rows().find((a) => a.action === "amend");
  assert.ok(amend, "a housemate on the house's key moves the house's thing");
  assert.equal(amend.actor, "keith", "the amend stays in the author's name — the mark's `by` never moves");
  assert.equal(parse(amend.payload)._set_down.by, "kin", "and the set-down names who actually set it down");
});

// ── the private-draft outcome is the door's own verdict, said on the receipt ─

test("set down on ground that is not the author's, with no escrow readable: the amend is filed as a private draft, and the receipt says canon waits", async () => {
  const p = fresh();
  const out = await hold.fileSetDownAmend({
    did: { thing: STOOL, declared_by: "keith", at: "2026-09-10T15:37:58.221Z", did: "drop" },
    stood: WAITING_ROOM_AT, key: KEITH, actId: 1636, deps: { householdOf: HOUSES, mark: stoolRecord },
  });
  assert.equal(out.amend.filed, true, JSON.stringify(out));
  assert.equal(out.amend.put_forward, false, "the Waiting Room is not Keith's ground and this bottle has no escrow to read");
  const c = p.claims()[0];
  assert.equal(c.status, "draft", "the claim's status is the verdict the receipt reports — one verdict");
  assert.deepEqual(c.geometry.at, WAITING_ROOM_AT);
  assert.equal(parse(c.data)._set_down.act_id, "1636", "the hand-run shape: act 1636 named on the claim");
  assert.match(hold.setDownNote(out), /filed as keith's private draft/);
  assert.doesNotMatch(hold.setDownNote(out), /canon moves it here/, "no promise of a move the verdict did not make");
});

// ── FALSIFIER 2 · a stranger's set-down files nothing, and says so ──────────

test("ANA DROPS KEITH'S STOOL: no amend, no claim, canon unchanged — and the receipt says it is unaccepted", async () => {
  const p = fresh();
  hand("ana");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "ana" }, ANA);
  assert.equal(r.did, "drop", `the drop itself stands, as before: ${JSON.stringify(r)}`);
  assert.ok(p.rows().some((a) => a.action === "drop"), "the drop act is written");
  assert.equal(p.rows().filter((a) => a.action === "amend").length, 0, "no amend in Keith's name from Ana's hand");
  assert.equal(p.claims().length, 0, "no claim on the docket: canon keeps the stool where Keith put it");
  assert.equal(r.set_down.whose, "another household's");
  assert.equal(r.set_down.amend.filed, false);
  assert.match(r.stands_note, /keith made it, and a set-down by another household moves nothing in canon on its own: it reads as set down by you, unaccepted, and canon stays where keith put it/);
  assert.doesNotMatch(r.stands_note, /re-sites/, "the old promise is not made to a stranger");
  console.log(`    RECEIPT · ${r.stands_note}`);
});

test("THE READ: a stranger's set-down reads 'set down by ana at <place> — unaccepted; canon stays at <keith's place>'", async () => {
  const attachments = [{ target: STOOL, entity: "ana", policy: "detach", born_at: "2026-09-24T01:00:00Z" }];
  const journal = [{ object: STOOL, action: "drop", actor: "ana", seq: 9001, at: { anchor: null, dx: WAITING_ROOM_AT.x, dy: WAITING_ROOM_AT.y } }];
  const s = await hold.whereThingStands(STOOL, { attachments, journal, fold: GARAGE_AT, householdOf: HOUSES });
  assert.equal(s.source, "set-down", "it stands where Ana set it down — the reach's interim read");
  assert.deepEqual(s.where, WAITING_ROOM_AT);
  assert.equal(s.accepted, false);
  assert.deepEqual(s.canon_at, GARAGE_AT, "canon has not moved");
  assert.equal(s.says, "set down by ana at (176, 425.5) — unaccepted; canon stays at (3978, -398), where keith put it");

  const own = await hold.whereThingStands(STOOL, { attachments, journal: [{ ...journal[0], actor: "keith" }], fold: GARAGE_AT, householdOf: HOUSES });
  assert.equal(own.accepted, undefined, "the author's own set-down is not a stance question");
  assert.match(own.says, /the record re-sites the mark at the next fold/, "and its promise is kept now, so it stays word for word");
});

test("a household record that cannot be read decides neither way: nothing filed, and the read promises nothing", async () => {
  const p = fresh();
  const out = await hold.fileSetDownAmend({
    did: { thing: STOOL, declared_by: "kin", at: "2026-09-24T01:00:00Z", did: "drop" },
    stood: YARD_AT, key: KEITH, deps: { householdOf: null, mark: stoolRecord },
  });
  assert.equal(out.amend.filed, false);
  assert.equal(out.whose, "unread");
  assert.equal(p.rows().length + p.claims().length, 0, "the pen was never asked");
  const s = await hold.whereThingStands(STOOL, {
    attachments: [{ target: STOOL, entity: "kin", policy: "detach", born_at: "x" }],
    journal: [{ object: STOOL, action: "drop", actor: "kin", at: { anchor: null, dx: 1, dy: 2 } }],
    fold: GARAGE_AT,
  });
  assert.equal(s.accepted, null);
  assert.doesNotMatch(s.says, /re-sites/);
});

// ── an amend that would delete an authored line is not filed ─────────────────

test("a record carrying a line the door cannot re-declare (loot) is not amended — the receipt names the line", async () => {
  const built = hold.setDownAmend({ thing: "the-town/the-wick-end", mark: { ...stoolRecord, id: "the-town/the-wick-end", loot: true }, stood: YARD_AT, actor: "the-town" });
  assert.match(built.refused, /`loot`/);
  assert.equal(built.payload, undefined);
  const ok = hold.setDownAmend({ thing: STOOL, mark: { ...stoolRecord, signal: false }, stood: YARD_AT, actor: "keith" });
  assert.ok(ok.payload, "the assembly's derived `signal` is not an authored line");
});

// ── ACCEPTANCE (b) · the inventory agrees with the graph after the fold ──────
//
// THE INVENTORY'S READER is `groundWithinReach` (src/world-apex.mjs): what a
// resident standing somewhere is shown as standing there. It composes three
// pure parts — `whereThingStands` for the place, `standsWithin` for the reach,
// `groundRow` for the verdict — and this drives those three exactly as it does.
// The GRAPH's answer is the fold's `at` for the stool, which the published amend
// sets to the set-down point (the world lane measured `placementParent` →
// `postmaster/the-waiting-room` for that point, 2026-09-23).

test("AFTER THE FOLD: the Waiting Room inventory and the published graph give the same point for the stool", async () => {
  const { standsWithin } = await import("../src/reach.mjs");
  const attachments = [{ target: STOOL, entity: "keith", policy: "detach", born_at: "2026-09-10T15:37:58Z" }];
  const journal = [{ object: STOOL, action: "drop", actor: "keith", seq: 1636, at: { anchor: null, dx: WAITING_ROOM_AT.x, dy: WAITING_ROOM_AT.y } }];
  const foldedAt = { ...WAITING_ROOM_AT }; // the graph, after the amend publishes
  const s = await hold.whereThingStands(STOOL, { attachments, journal, fold: foldedAt, householdOf: HOUSES });
  assert.deepEqual(s.where, foldedAt, "the inventory's place and the graph's are one point");
  const inRoom = { x: WAITING_ROOM_AT.x + 3, y: WAITING_ROOM_AT.y - 2 };
  const room = PUBLISHED.find((m) => m.id === "postmaster/the-waiting-room");
  const rect = (m, p) => Math.abs(p.x - m.at.x) <= m.extent.w / 2 && Math.abs(p.y - m.at.y) <= m.extent.h / 2;
  assert.ok(rect(room, s.where), "and that point is inside the Waiting Room, as the graph's containment says");
  const reach = standsWithin(inRoom, { id: STOOL, at: s.where, extent: stoolRecord.extent }, { pointWithinMark: (p, m) => rect(m, p) });
  const row = hold.groundRow({ id: STOOL, made_by: "keith", body: stoolRecord.body, stands: s, reach });
  assert.deepEqual(row.stands_at, foldedAt, "the ground read lists it at the graph's point");
  assert.equal(row.holder, undefined, "nobody holds it");
});

// ── ACCEPTANCE (c) · nothing is inferred from a set-down edge alone ──────────

test("PINNED: a set-down never reads as accepted, and an amend copies a notice's status verbatim — no completion is inferred", async () => {
  for (const actor of ["keith", "kin", "ana", "someone"]) {
    const s = await hold.whereThingStands(STOOL, {
      attachments: [{ target: STOOL, entity: actor, policy: "detach", born_at: "x" }],
      journal: [{ object: STOOL, action: "drop", actor, at: { anchor: null, dx: 1, dy: 1 } }],
      fold: GARAGE_AT, householdOf: HOUSES,
    });
    assert.notEqual(s.accepted, true, `a set-down by ${actor} read as accepted — acceptance is the author's word, never the edge's`);
  }
  const notice = { ...stoolRecord, id: "keith/a-notice", class: "bounty", ask: "fix the latch", reward: 2, status: "open" };
  const built = hold.setDownAmend({ thing: "keith/a-notice", mark: notice, stood: YARD_AT, actor: "ana" });
  assert.equal(built.payload.status, "open", "a notice set down anywhere is still open — the amend carries the poster's word, not a verdict");
  assert.equal(built.payload.class, "bounty");
});

// ── the receipt's act id (found on the way) ──────────────────────────────────

test("the flipped hold receipt's `seq` is the act's id — it answered null on every act since G1", async () => {
  const p = fresh();
  hand("keith");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH);
  const drop = p.rows().find((a) => a.action === "drop");
  assert.equal(r.seq, drop.id);
});

// ═════════════════════════════════════════════════════════════════════════════
// THE SECOND HALF · the author's house answers a stranger's set-down
// ═════════════════════════════════════════════════════════════════════════════
//
// Keemin, 2026-09-24 ~10:1x EDT, on PR #180's proposal: "I agree with you here."
// The drop act IS the drafted amend. `declare-stance-on` gains the author's-
// house arm: welcomed files the author's amend through the same
// `leaveMarkViaOffice` call, in the author's name, with `_set_down` plus the
// stance act's id; opposed makes the read answer canon, with no store write;
// silence stays unaccepted.
//
// Driven end to end: Ana's drop through the real hold door, Keith's word
// through the real stance door (`declareStanceViaOffice`), the amend through the
// real leave-mark door, the read over the real stance rows (`stanceRows`).

const stance = await import("../src/world-stance.mjs");
// The stance door's candidate read rides its own credential (`stance_reader`,
// 023). Pointed at the same in-memory record: it asks `claims`, which the pen
// answers from the docket it keeps.
process.env.WORLD2_STANCE_URL = "postgres://acts-pen-stub/stance";
const acts2 = await import("../src/world2-acts.mjs");
const speakPool = { query: (t, p) => pen.query(t, p) };
acts2.__setStancePoolForTest(speakPool);
after(() => acts2.__setStancePoolForTest(null));

/** Ana sets Keith's stool down, through the real door. Returns her drop act. */
async function anaDrops(p) {
  hand("ana");
  const r = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "ana" }, ANA);
  assert.equal(r.did, "drop", `Ana's drop did not land: ${JSON.stringify(r)}`);
  const drops = p.rows().filter((a) => a.action === "drop" && a.actor === "ana");
  return drops[drops.length - 1];
}

/** Speak on the stool, through the real stance door; a bounce comes back as `{ refused }`. */
//
// THE HOLDING READ IS THE PORT'S OWN (`standsRowsFromStore`), answered by
// `stands-store-fixture.mjs § actsClient` — the investigate suite's client,
// which filters and orders the way the real SQL does — over the acts the real
// doors wrote into this suite's pen a moment earlier. Nothing is hand-seeded:
// the drop the stance answers is the one Ana's call to the hold door made.
const guards = await import("../src/world2-guards.mjs");
const { actsClient } = await import("./stands-store-fixture.mjs");
const written = (p) => p.rows().map((r) => ({ ...r, at: new Date(r.at), payload: parse(r.payload) }));
// The fixture reader is installed for the HOLDING READ ALONE — the real
// `standsRowsFromStore`, called through the arm's `readRows` seam — and taken
// down before the stance and the amend write, so the pen's own reads on the
// write path reach the pen and not the fixture.
const readRows = async (thing) => {
  const restore = guards.useGuardReader((run) => run(actsClient(written(pen))));
  try { return await guards.standsRowsFromStore(thing); } finally { restore(); }
};
async function speak(word, handle, key, extraDeps = {}) {
  try {
    return await stance.declareStanceViaOffice(repo, { on: STOOL, stance: word, handle }, key, { setDownDeps: { householdOf: HOUSES, readRows, ...extraDeps } });
  } catch (e) {
    return { refused: true, code: e?.code, defect: e?.defect ?? e?.message, hint: e?.hint };
  }
}

/** The read, over the record's own stance rows. */
async function readStool(drop, fold = GARAGE_AT) {
  const stances = await stance.stanceRows({ worldClone: repo });
  return hold.whereThingStands(STOOL, {
    attachments: [{ target: STOOL, entity: "ana", policy: "detach", born_at: "2026-09-24T01:00:00Z" }],
    journal: [{ object: STOOL, action: "drop", actor: "ana", seq: drop.id, at: { anchor: null, dx: ANA_AT.x, dy: ANA_AT.y } }],
    fold, householdOf: HOUSES, stances,
  });
}

// ── ACCEPT ───────────────────────────────────────────────────────────────────
//
// THE FLIP: make `answerSetDown` skip `fileAuthorsAmend` and this reds on "no
// amend act" — a welcome that is only a word moves nothing.

test("ACCEPT: Keith's house welcomes Ana's set-down — the author's amend is filed in Keith's name, attributed to the drop act AND the stance act", async () => {
  const p = fresh();
  const drop = await anaDrops(p);
  assert.equal(p.claims().length, 0, "before the answer, canon has not moved");

  const r = await speak("welcomed", "keith", KEITH);
  assert.ok(!r.refused, `the welcome was refused: ${JSON.stringify(r)}`);

  const said = p.rows().find((a) => a.class === "stance");
  assert.ok(said, "the stance act is on the record");
  const sp = parse(said.payload);
  assert.equal(sp.answers, "set-down", "the stance says which question it answers");
  assert.equal(sp.set_down.act_id, String(drop.id), "and names the ONE drop it answers");
  assert.equal(sp.set_down.by, "ana");

  const amend = p.rows().find((a) => a.action === "amend");
  assert.ok(amend, `no amend act — the welcome moved nothing: ${JSON.stringify(r.amend)}`);
  assert.equal(amend.actor, "keith", "filed in the author's name, never the dropper's");
  const ap = parse(amend.payload);
  assert.deepEqual(ap.at, ANA_AT, "at = where Ana set it down");
  assert.equal(ap._set_down.act_id, String(drop.id), "attributed to the drop act");
  assert.equal(ap._set_down.by, "ana", "…and to who set it down");
  assert.equal(ap._set_down.stance_act_id, String(said.id), "…and to the stance act that accepted it");
  assert.equal(ap.class, "thing", "every field Keith wrote is copied");

  const c = p.claims()[0];
  assert.equal(c.claimant, "keith");
  assert.equal(c.supersedes, STANDING_ID, "the amend chain, superseding the standing mark");
  assert.equal(c.status, "pending", "set down on Keith's own ground, so it goes forward");

  assert.equal(r.effect, `your house accepts ana's set-down: the amend that re-sites ${STOOL} at (4105, -305) is filed in keith's name, and canon moves it at the next crossing.`);
  console.log(`    RECEIPT · ${r.effect}`);

  const s = await readStool(drop);
  assert.equal(s.accepted, true, "the read says accepted once the author's house has welcomed it");
  assert.deepEqual(s.where, ANA_AT, "and it stands where Ana set it down");
});

// ── REFUSE ───────────────────────────────────────────────────────────────────

test("REFUSE: Keith's house opposes Ana's set-down — nothing is filed, and the read answers canon from now on", async () => {
  const p = fresh();
  const drop = await anaDrops(p);
  const before = p.rows().length;
  const r = await speak("opposed", "keith", KEITH);
  assert.ok(!r.refused, `the refusal was refused: ${JSON.stringify(r)}`);
  assert.equal(p.rows().length, before + 1, "one row: the stance itself");
  assert.equal(p.rows().filter((a) => a.action === "amend").length, 0, "no amend");
  assert.equal(p.claims().length, 0, "no claim — no store write moves canon");
  assert.equal(r.effect, `your house refuses ana's set-down: canon keeps ${STOOL} at (3978, -398), and the read answers canon from now on.`);
  console.log(`    RECEIPT · ${r.effect}`);

  const s = await readStool(drop);
  assert.equal(s.source, "fold", "the read answers canon");
  assert.deepEqual(s.where, GARAGE_AT, "at the garage, where Keith put it");
  assert.equal(s.refused_by, "keith");
  assert.equal(s.says, "set down by ana at (4105, -305) — refused by keith's house; canon stands at (3978, -398), where keith put it");
});

// ── SILENCE ──────────────────────────────────────────────────────────────────

test("SILENCE: with no answer, nothing is filed and the read stays unaccepted, canon where Keith put it", async () => {
  const p = fresh();
  const drop = await anaDrops(p);
  assert.equal(p.rows().filter((a) => a.class === "stance" || a.action === "amend").length, 0);
  const s = await readStool(drop);
  assert.equal(s.accepted, false);
  assert.equal(s.source, "set-down");
  assert.match(s.says, /— unaccepted; canon stays at \(3978, -398\), where keith put it$/);
});

// ── THE AUTHOR'S HOUSE ALONE ─────────────────────────────────────────────────

test("AUTHOR-ONLY: Ana cannot welcome her own set-down of Keith's thing — refused by name, nothing written", async () => {
  const p = fresh();
  await anaDrops(p);
  const before = p.rows().length;
  const r = await speak("welcomed", "ana", ANA);
  assert.equal(r.refused, true, `Ana accepted her own move of Keith's stool: ${JSON.stringify(r)}`);
  assert.equal(r.code, 403);
  assert.match(r.hint, /a set-down of keith's thing is accepted or refused by keith's house alone/);
  assert.equal(p.rows().length, before, "no stance row, no amend");
  assert.equal(p.claims().length, 0);
});

test("a welcome needs a key that acts for the author — the amend is filed in their name; a housemate's key without them is refused before anything is written", async () => {
  const p = fresh();
  await anaDrops(p);
  const before = p.rows().length;
  const r = await speak("welcomed", "kin", { household: "keithhouse", handles: new Set(["kin"]) });
  assert.equal(r.refused, true, JSON.stringify(r));
  assert.equal(r.code, 403);
  assert.match(r.defect, /this key does not act for keith/);
  assert.equal(p.rows().length, before, "refused before the stance row, not after it");
});

test("a housemate on a key without the author may still REFUSE — opposed writes nothing but the word", async () => {
  const p = fresh();
  await anaDrops(p);
  const r = await speak("opposed", "kin", { household: "keithhouse", handles: new Set(["kin"]) });
  assert.ok(!r.refused, JSON.stringify(r));
  assert.equal(p.claims().length, 0);
});

test("once accepted, a later 'opposed' is refused — the amend is filed in the author's name, and moving it back is an amend", async () => {
  const p = fresh();
  await anaDrops(p);
  const ok = await speak("welcomed", "keith", KEITH);
  assert.ok(!ok.refused, JSON.stringify(ok));
  const before = p.rows().length;
  const r = await speak("opposed", "keith", KEITH);
  assert.equal(r.refused, true, JSON.stringify(r));
  assert.equal(r.code, 409);
  assert.equal(p.rows().length, before, "nothing written");
});

test("an answer belongs to ONE drop: a welcome of Ana's first set-down does not accept a later one", () => {
  const stances = [{ class: "stance", actor: "keith", object: STOOL, written_at: "2026-09-24T10:00:00Z", seq: 5,
    payload: { stance: "welcomed", answers: "set-down", set_down: { act_id: "3" } } }];
  assert.equal(hold.setDownAnswer({ stances, thing: STOOL, dropSeq: 3, madeBy: "keith", householdOf: HOUSES })?.stance, "welcomed");
  assert.equal(hold.setDownAnswer({ stances, thing: STOOL, dropSeq: 9, madeBy: "keith", householdOf: HOUSES }), null, "drop 9 is unanswered");
  const byAna = [{ ...stances[0], actor: "ana" }];
  assert.equal(hold.setDownAnswer({ stances: byAna, thing: STOOL, dropSeq: 3, madeBy: "keith", householdOf: HOUSES }), null,
    "a stance by anyone outside the author's house answers nothing, even if a writer other than the door put it there");
  const groundWord = [{ ...stances[0], payload: { stance: "opposed" } }];
  assert.equal(hold.setDownAnswer({ stances: groundWord, thing: STOOL, dropSeq: 3, madeBy: "keith", householdOf: HOUSES }), null,
    "a ground-holder's ordinary stance on the thing is not an answer to a set-down");
});

// ── THE READ CLAIMS ONLY WHAT THE STANCE PROVES (Wright's review, #184) ──────
//
// The stance row is written before the amend is filed, and the amend door can
// still refuse (the move guard, an error). The read sees the word and never
// the filing, so it must not say the amend "is filed".
//
// THE FLIP: restore the old sentence ("…; the amend that re-sites it is filed
// in keith's name") and this reds.

test("A WELCOME WHOSE AMEND THE DOOR REFUSES: the receipt says it was not filed, and the read does not claim a filing", async () => {
  const p = fresh();
  const drop = await anaDrops(p);
  const refusingDoor = async () => { const e = new Error("3 marks stand on it"); Object.assign(e, { code: 409, defect: "3 marks stand on it" }); throw e; };
  const r = await speak("welcomed", "keith", KEITH, { leave: refusingDoor });
  assert.ok(!r.refused, `the welcome itself stands: ${JSON.stringify(r)}`);
  assert.equal(r.amend.filed, false, "the amend door refused");
  assert.match(r.effect, /was not filed \(the amend door refused: 3 marks stand on it\)/, "the receipt tells the truth");
  assert.equal(p.rows().filter((a) => a.action === "amend").length, 0, "no amend act");
  assert.equal(p.claims().length, 0, "no claim");

  const s = await readStool(drop);
  assert.equal(s.accepted, true, "the word was spoken, and the read says so");
  assert.doesNotMatch(s.says, /is filed/, `the read claims a filing that did not happen: ${s.says}`);
  assert.equal(s.says, "set down by ana at (4105, -305) — accepted by keith's house; canon follows when keith's amend publishes at a crossing");
});

// ═════════════════════════════════════════════════════════════════════════════
// THE THIRD HALF · the set-down waits in the author's stances read
// ═════════════════════════════════════════════════════════════════════════════
//
// Keemin, 2026-09-24 17:2x: an author's house must be told when another
// household has set down a thing it made, "in the same stances read". The
// group is `set_downs_awaiting`, beside the ground group, built from
// `setDownFor` + `setDownAnswer` over the holding record's drops of things the
// house made (`world2-guards.mjs § setDownRowsForMakers`).
//
// Driven over the acts the real doors wrote into this suite's pen: Ana's drop
// through the hold door, Keith's word through the stance door. The holding read
// is the real `setDownRowsForMakers`, answered by `actsClient` through the
// guards' own reader seam; the household map is the town's own reader
// (`households.mjs`, off this suite's town clone), never HOUSES, so the doorstep
// leg and the read legs ask the same question the same way.
//
// THE FLIPS (each reds its own leg):
//   · drop `setDowns: true` from the household door → KEITH SEES IT reds;
//   · make `setDownsAwaiting` skip the `setDownAnswer` check → ANSWERED reds;
//   · make it keep a set-down whose `setDownFor` found no stranger → OWN DROP reds;
//   · drop `setDowns: true` from the doorstep → THE DOORSTEP reds.

const underRecord = async (fn) => {
  const restore = guards.useGuardReader((run) => run(actsClient(written(pen))));
  try { return await fn(); } finally { restore(); }
};
const apex = await import("../src/household-apex.mjs");
/** The household door's own stances read, as `key` asks it. */
const stancesRead = (key, extra = {}) => underRecord(() => apex.householdApex({ read: "stances", ...extra }, key));

test("KEITH SEES IT: Ana sets down Keith's stool, and Keith's stances read lists it with the call that answers it", async () => {
  const p = fresh();
  const drop = await anaDrops(p);
  const r = await stancesRead(KEITH);
  assert.equal(r.unavailable, undefined, `the read could not see the world: ${r.unavailable}`);
  assert.equal(r.set_downs_unavailable, undefined, `the holding record could not be read: ${r.set_downs_unavailable}`);
  assert.equal(r.set_downs_awaiting?.length, 1, `one set-down waits: ${JSON.stringify(r.set_downs_awaiting)}`);
  const w = r.set_downs_awaiting[0];
  assert.equal(w.thing, STOOL);
  assert.equal(w.made_by, "keith");
  assert.equal(w.set_down_by, "ana", "who set it down");
  assert.deepEqual(w.at, ANA_AT, "where");
  assert.ok(w.when && !Number.isNaN(Date.parse(w.when)), `when: ${w.when}`);
  assert.equal(w.act_id, String(drop.id), "the drop's act id — the one the answer binds to");
  assert.deepEqual(w.canon_at, GARAGE_AT, "where canon keeps it");
  assert.match(w.answer, /^household \{ do: "declare-stance-on", args: \{ on: "keith\/waiting-room-stool-2026-09-10", stance: "welcomed" \| "opposed" \} \}/);
  assert.equal(r.note, undefined, "the read does not say nothing awaits while a set-down does");
  console.log(`    WAITING · ${JSON.stringify(w)}`);

  const kin = await stancesRead({ household: "keithhouse", handles: new Set(["kin"]) });
  assert.deepEqual(kin.set_downs_awaiting, [], "narrowed to kin, who did not make the stool, the group is empty");
});

test("PRIVACY: Ana's own stances read does not list her set-down of Keith's thing", async () => {
  const p = fresh();
  await anaDrops(p);
  const r = await stancesRead(ANA);
  assert.deepEqual(r.set_downs_awaiting, [], "a house sees set-downs of its own residents' things and nobody else's");
});

test("ANSWERED: once Keith's house welcomes or opposes it, the set-down leaves the waiting group and reads with the stances spoken", async () => {
  for (const word of ["welcomed", "opposed"]) {
    const p = fresh();
    await anaDrops(p);
    assert.equal((await stancesRead(KEITH)).set_downs_awaiting.length, 1, `${word}: it waits first`);
    const said = await speak(word, "keith", KEITH);
    assert.ok(!said.refused, `${word}: the answer was refused: ${JSON.stringify(said)}`);
    const r = await stancesRead(KEITH);
    assert.deepEqual(r.set_downs_awaiting, [], `${word}: an answered set-down no longer waits`);
    assert.ok(r.standing.some((s) => s.on === STOOL && s.stance === word && s.by === "keith"),
      `${word}: and the word reads in standing: ${JSON.stringify(r.standing)}`);
  }
});

test("PICKED UP: once the stool is in somebody's hands again, nothing waits", async () => {
  const p = fresh();
  await anaDrops(p);
  // The record's own rows for Ana's drop, then the same rows with a live holder
  // in the attachment half (`pgAttachmentsFor`'s answer once somebody takes it
  // up). `hand()` writes the dynamic store, which the holding record does not
  // read, so the holder is put where the record would carry it.
  const rows = await underRecord(() => guards.setDownRowsForMakers(["keith"]));
  const rec = rows.get(STOOL);
  const heldRec = { ...rec, attachments: [{ target: STOOL, entity: "keith", policy: "cascade", born_at: new Date(Date.now() + 1000).toISOString() }] };
  const got = await stance.setDownsAwaiting(["keith"], {
    marks: PUBLISHED, stances: [], deps: { rowsForMakers: async () => new Map([[STOOL, heldRec]]) } });
  assert.deepEqual(got.rows, [], "a held thing is not set down");
  const free = await stance.setDownsAwaiting(["keith"], {
    marks: PUBLISHED, stances: [], deps: { rowsForMakers: async () => new Map([[STOOL, rec]]) } });
  assert.equal(free.rows.length, 1, "the same record with no live holder still waits — the control");
});

test("OWN DROP: Keith setting down his own stool never waits on his house's word", async () => {
  const p = fresh();
  hand("keith");
  const r0 = await hold.callHoldTool("world_hold", { thing: STOOL, handle: "keith" }, KEITH);
  assert.equal(r0.did, "drop", `Keith's drop did not land: ${JSON.stringify(r0)}`);
  assert.ok(p.rows().some((a) => a.action === "drop" && a.actor === "keith"));
  const r = await stancesRead(KEITH);
  assert.deepEqual(r.set_downs_awaiting, [], "the author's own set-down files its amend; nothing waits");
});

test("THE DOORSTEP CARRIES IT: Keith's morning page lists the waiting set-down, and the segment IS the read", async () => {
  const p = fresh();
  const drop = await anaDrops(p);
  const { DatabaseSync } = await import("node:sqlite");
  const { SCHEMA } = await import("../src/schema.mjs");
  const { SEGMENT_META } = await import("../src/queries.mjs");
  const { doorstepBundle } = await import("../src/doorstep-bundle.mjs");
  const { callTool } = await import("../src/mcp.mjs");
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(SCHEMA);
    const m = db.prepare("INSERT INTO meta VALUES (?, ?)");
    m.run("as_of", "pos138fixture00000000000000000000000000"); m.run("town_path", "fixture"); m.run("hydrated_counts", "{}");
    db.prepare("INSERT INTO residents VALUES (?, ?)").run("keith", JSON.stringify({
      handle: "keith", is_office: false, last_active: null, address: { data: { since: "2026-01-01", joined: "2026-06-10" } } }));
    const ctx = { db, key: KEITH, meta: { as_of: "pos138fixture00000000000000000000000000", quest_registry: '{"quests":[]}' },
      asOf: "pos138fixture00000000000000000000000000", canWrite: false, clone: null, pen: null, odb: null, dbPath: null };
    const seg = await underRecord(async () => (await doorstepBundle("keith", ctx)).stances);
    assert.equal(seg.serves, "household.stances", "no new segment name");
    assert.equal(seg.set_downs_awaiting?.length, 1, `the doorstep carries it: ${JSON.stringify(seg).slice(0, 400)}`);
    assert.equal(seg.set_downs_awaiting[0].act_id, String(drop.id));
    const asked = await underRecord(() => callTool("household", { read: "stances", ...seg.args }, ctx));
    const answerOf = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => !SEGMENT_META.includes(k)));
    assert.deepEqual(answerOf(seg), asked, "ask the named read yourself and you get the same object back");
  } finally { db.close(); }
});

// ── THE PLACEHOLDER (1626f2f4) ───────────────────────────────────────────────
//
// `pgHoldingRows` wrote its thing clause as `= ${n}` — one dollar, eaten by a
// shell — so Postgres was sent `= 2`. This reads the text the port hands the
// client. THE FLIP: put the one dollar back and this reds.
test("THE PLACEHOLDER: a per-thing holding read names its parameter, and the maker narrowing names its own", async () => {
  const { pgHoldingRows } = await import("../world2/tools/guard-reads.mjs");
  const asked = [];
  const client = { query: async (sql, params) => { asked.push({ sql: String(sql).replace(/\s+/g, " "), params }); return { rows: [] }; } };
  await pgHoldingRows(client, { thing: STOOL });
  assert.match(asked[0].sql, /COALESCE\(object, payload->>'thing'\) = \$2(\s|$)/, asked[0].sql);
  assert.deepEqual(asked[0].params, ["holding", STOOL]);
  await pgHoldingRows(client, { thing: STOOL, madeBy: ["keith", "kin"] });
  assert.match(asked[1].sql, /= \$2 AND split_part\(COALESCE\(object, payload->>'thing'\), '\/', 1\) = ANY\(\$3\)/, asked[1].sql);
  assert.deepEqual(asked[1].params, ["holding", STOOL, ["keith", "kin"]]);
});

// ── THE NOTE (the read's "nothing awaits" line) ──────────────────────────────
//
// Zed holds no ground in this bottle (the world frame overlaps every parcel, so
// no parcel-holder has an empty ground group), so only a set-down can make the
// note false. THE FLIP: let the note
// ignore `set_downs_awaiting` and this reds.
test("THE NOTE: with the ground group empty and a set-down waiting, the read never says nothing awaits", async () => {
  const cup = "zed/a-cup";
  const houses = (h) => (h === "zed" ? { key: "gh:9", slug: "zed-house" } : HOUSES(h));
  const rec = { attachments: [], journal: [{ seq: 77, crossing: 1, actor: "ana", action: "drop", object: cup,
    at: { anchor: null, dx: ANA_AT.x, dy: ANA_AT.y }, class: "holding", payload: { thing: cup }, written_at: "2026-09-24T12:00:00.000Z" }] };
  const r = await stance.stancesForHandles(["zed"], { repo, setDowns: true,
    setDownDeps: { householdOf: houses, rowsForMakers: async () => new Map([[cup, rec]]) } });
  assert.equal(r.stances_awaiting, 0, `the control: zed holds no ground: ${JSON.stringify(r).slice(0, 300)}`);
  assert.deepEqual(r.set_downs_awaiting.map((w) => [w.thing, w.set_down_by, w.act_id]), [[cup, "ana", "77"]]);
  assert.equal(r.note, undefined, `the read said nothing awaits while a set-down did: ${r.note}`);
  const none = await stance.stancesForHandles(["zed"], { repo, setDowns: true, setDownDeps: { householdOf: houses, rowsForMakers: async () => new Map() } });
  assert.match(none.note ?? "", /nothing awaits your word/, "with both groups empty the note is said");
  assert.equal(none.stances_awaiting, 0);
});
