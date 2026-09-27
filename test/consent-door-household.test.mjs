// consent-door-household.test.mjs — THE CONSENT DOOR'S STANDING-SCOPED DO
// (postmark#2392, founder-ruled 2026-09-02).
//
// The defect these falsify: `declare-stance-on` was unreachable at the world
// apex for every standpoint that exists. The verb is granted by the `household`
// class node; the apex delivers a grant through `yours` (the class you ARE —
// `resident`) or `here` (a class mark on ground in reach). A household is a
// STANDING entity: nobody is one, and none is sited — zero marks of kind
// `household` in the whole world record — so both rails were dead and the
// bounce read "afforded at the-town/household (null, null) — walk there and it
// appears", which is a direction to nowhere.
//
// Every test quotes the law it asserts, verbatim:
//
//   the-town/declare-stance-on   the class mark (constitution tier, v5):
//                                "A stance is a revisable word on an edge —
//                                 welcomed or opposed, latest wins; neutral is
//                                 never stored, it is absence. The ground's
//                                 holder speaks."
//   the .1 ruling (2026-08-25)   world-stance.mjs § the fourth tier: "what
//                                awaits your word … is derived from what you
//                                HOLD (`stanceInbox` keys on `key.handles` and
//                                nothing else), never from where your feet
//                                are."
//   ONE DERIVATION, TWO DOORS    ibid.: "This wraps `stanceShadow` and never
//                                re-implements it" — the rule the DO now obeys
//                                for `declareStanceViaOffice`.
//   the door's own contract      household-apex.mjs § HOUSEHOLD_DESCRIPTION:
//                                a card is "read back for any act BY ITS OWN
//                                NAME".
//   the pen flip (W2_PEN)        world-stance.mjs § LANE ONE: "Unreachable
//                                Postgres = the ruled refusal, and nothing was
//                                written."
//
// Every one was can-fail flipped; the flips are receipted in the handback.
//
//   node --test test/consent-door-household.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

// ── ISOLATION, BEFORE THE FIRST `../src` IMPORT ─────────────────────────────
// The office caches the world ENGINE under a machine-global directory keyed on
// the world clone's commit sha, and a fixture tree of fixed text commits to the
// same sha in every run — world-apex.test.mjs § ISOLATION measured the
// collision. Redirecting TEMP gives this process its own cache root, and it has
// to happen before the constants are computed at module load.
const repo = mkdtempSync(join(tmpdir(), "postmark-consent-"));
const tmpHome = mkdtempSync(join(tmpdir(), "postmark-consent-tmp-"));
process.env.TEMP = process.env.TMP = process.env.TMPDIR = tmpHome;
const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* litter */ } };
after(() => { sweep(repo); sweep(tmpHome); });

const dbPath = join(repo, "consent-world.db");
const dynPath = join(repo, "consent-dynamic.db");
process.env.WORLD_CLONE = repo;
process.env.WORLD_STORE_DB = dbPath;
process.env.WORLD_DYNAMIC_DB = dynPath;
process.env.WORLD_APEX = "1";
process.env.WORLD_SINGLE_LOG = "1";
// The flipped lane is OFF for every test but the last one, which turns it on
// itself. `laneFlipped("stance")` is false without these, so the journal path
// runs and no Postgres is wanted anywhere in this file.
delete process.env.W2_PEN;
delete process.env.WORLD2_PG;
delete process.env.WORLD2_PG_URL;
delete process.env.WORLD_PRESENCE;
delete process.env.HARBOR_WRITES;
after(() => { delete process.env.WORLD_APEX; delete process.env.WORLD_SINGLE_LOG; });

const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };

// ── THE WORLD, SHAPED LIKE THE RECORD ───────────────────────────────────────
//
// The two class nodes are copied from the live record's own frontmatter, and
// the copied part that matters is what is ABSENT: `kind: class` marks carry no
// `at` and no `extent` — "law has no where" (2026-08-18). That absence is the
// defect's whole mechanism, so a fixture that sited them would prove nothing.
const FRAME = "the-town/let-there-be-light";
const MARKS = [
  { id: FRAME, by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 100000, h: 100000 }, body: "Let there be light." },
  { id: "the-town/the-keeping-works", by: "the-town", kind: "sited", tier: "constitution", at: { x: -900, y: -760 }, extent: { w: 800, h: 800 }, body: "The quarter where the town's own machinery stands as buildings." },

  // `the-town/resident` — the class a resident IS, ambient and world-wide. It
  // is the `yours` rail, and it does not carry the stance verb.
  { id: "the-town/resident", by: "the-town", kind: "class", tier: "constitution", body: "A household's living voice, sovereign on its own ground and carrying the walk.",
    props: { class: "resident", class_version: 3, ambient: true, dials: { pace_km_per_crossing: 60 },
      actions: [{ action: "walk", residue: "the-town/resident" }] } },

  // `the-town/household` — the grant, on a de-sited class node. THE DEFECT.
  { id: "the-town/household", by: "the-town", kind: "class", tier: "constitution", body: "The apex of sovereignty: born sovereign by this law, one resident to an address.",
    props: { class: "household", class_version: 4, dials: { birth_tier: "sovereign", residents_per_address: 1 },
      actions: [{ action: "declare-stance-on", residue: "the-town/declare-stance-on" }] } },

  // the residue — the meaning both doors quote, verbatim from the record.
  { id: "the-town/declare-stance-on", by: "the-town", kind: "class", tier: "constitution",
    body: "A stance is a revisable word on an edge — welcomed or opposed, latest wins; neutral is never stored, it is absence. The ground's holder speaks.",
    props: { class: "declare-stance-on", class_version: 5, dials: {} } },
  { id: "the-town/parcel", by: "the-town", kind: "class", tier: "constitution", body: "Ground a household holds.",
    props: { class: "parcel", class_version: 1, dials: {} } },

  // wright holds ground since 08-01; beta drops a cairn over its edge on 08-10
  // (a real candidate, precedent with wright); delta is nobody's business.
  { id: "wright/wrights-parcel", by: "wright", kind: "parcel", tier: "market", at: { x: 100, y: 100 }, extent: { w: 25, h: 25 }, date: "2026-08-01", body: "wright's ground" },
  { id: "beta/on-wrights-edge", by: "beta", kind: "sited", tier: "market", at: { x: 112, y: 100 }, extent: { w: 4, h: 4 }, date: "2026-08-10", body: "beta's cairn, half over the line" },
  { id: "delta/far-away", by: "delta", kind: "sited", tier: "market", at: { x: 9000, y: 9000 }, extent: { w: 4, h: 4 }, date: "2026-08-15", body: "nowhere near anybody" },
];

put("WORLD/world-state.json", JSON.stringify({ tick: 0, dials: {}, marks: MARKS, parcels: [], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [] }));
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("seeding/manifest.json", JSON.stringify({ homes: [] }));
put("WORLD/walk-ledger.md", "# walks\n");

// The engine in miniature — `geometry.mjs` is the REAL arithmetic, transcribed,
// because overlap is the one thing the consent door must not answer with a
// second implementation (world-stance.test.mjs's own discipline).
put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function pointInRect(px, py, r) { return px >= r.x - r.w / 2 && px <= r.x + r.w / 2 && py >= r.y - r.h / 2 && py <= r.y + r.h / 2; }
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
export const contains = (outer, inner) => overlapArea(outer, inner) >= 0.99 * inner.w * inner.h;
export const polygonOf = () => null;
export function pointInPolygon() { return false; }
`);
put("tools/world-verbs.mjs", `
import { rect, contains, pointInRect } from "./geometry.mjs";
const area = (m) => (m.extent?.w ?? 1) * (m.extent?.h ?? 1);
export function containmentChain(pos, marks) {
  const containing = marks.filter((m) => m.at && (m.kind === "sited" || m.kind === "parcel") && pointInRect(pos.x, pos.y, rect(m))).sort((a, b) => area(a) - area(b));
  const nest = [];
  for (const m of containing) if (!nest.length || contains(rect(m), rect(nest[nest.length - 1]))) nest.push(m);
  return nest.reverse().map((m) => ({ id: m.id, by: m.by, tier: m.tier, body: m.body, extentM: Math.max(m.extent?.w ?? 0, m.extent?.h ?? 0) }));
}
export function orient(state, world) {
  const within = containmentChain(state, world.marks);
  return { charter: { light: "let there be light", from_mark: within[0]?.id ?? null }, you: { name: state.name ?? "(unnamed)", at: { x: state.x, y: state.y }, within }, verbs: [] };
}
export function openYourEyes(state, world) {
  const seen = world.marks.filter((m) => m.at && (m.kind === "sited" || m.kind === "parcel"))
    .map((m) => ({ id: m.id, at: m.at, bearing: "N", distM: Math.round(Math.hypot(m.at.x - state.x, m.at.y - state.y)) }))
    .filter((o) => o.distM <= 300).sort((a, b) => a.distM - b.distM);
  const fov = { carried: seen.filter((o) => o.distM <= 50), far: seen.filter((o) => o.distM > 50) };
  const radial = { within: containmentChain(state, world.marks) };
  fov.within = radial.within;
  return { fov, radial, tell: () => "you see the fixture" };
}
export function investigate() { return null; }
`);
put("tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }`);
put("tools/walk.mjs", `export function parseWalkLedger() { return { departures: [] }; }`);
put("tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
const HOMES = { wright: { x: 100, y: 100, mark_id: "wright/wrights-parcel" } };
export function homeOf(handle) { const h = HOMES[handle]; return h ? { ...h, placed: true, source: "home", parcel: { id: h.mark_id, at: { x: h.x, y: h.y }, extent: { w: 25, h: 25 } } } : NOWHERE; }
export function whereIs(handle) { const h = homeOf(handle); return h.placed ? { ...h, position: null } : NOWHERE; }
export function publicResidents() { return []; }
`);
git("init", "--quiet", "--initial-branch=main");
git("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "--quiet", "-m", "fixture world");

const { SCHEMA } = await import("../src/world-store.mjs");
{
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  const meta = db.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)");
  meta.run("as_of_world", "consentfixture0000000000000000000000000");
  meta.run("hydrated_at", new Date().toISOString());
  meta.run("hydration_status", "OK");
  const node = db.prepare("INSERT OR REPLACE INTO nodes VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (const m of MARKS) {
    node.run(m.id, "mark", m.kind, m.tier ?? null, m.by ?? null,
      m.at?.x ?? null, m.at?.y ?? null, m.extent?.w ?? null, m.extent?.h ?? null,
      JSON.stringify({ slug: m.id.split("/").at(-1), body: m.body ?? "",
        path: m.props?.class != null
          ? `WORLD/marks/let-there-be-light/the-town-centre/the-keeping-works/${m.id.split("/").at(-1)}/mark.md`
          : `WORLD/marks/${m.id}/mark.md`,
        ...(m.props ?? {}) }));
  }
  db.close();
}

// ── the code under test ─────────────────────────────────────────────────────

const { worldApex, STANDING_SCOPED_DOORS, declareStanceAtOffice } = await import("../src/world-apex.mjs");
const { householdApex, HOUSEHOLD_DISPATCHABLE, HOUSEHOLD_TOOL, householdDispatchToolFor } = await import("../src/household-apex.mjs");
const { ACTION_STANCE, CLASS_STANCE, standingStances, stancesBlock } = await import("../src/world-stance.mjs");
const { openDynamic } = await import("../src/dynamic-store.mjs");
const { readJournal } = await import("../src/world-journal.mjs");
// THE CANDIDATE LIST READS THE STORE (POS-195, 2026-09-22). This file plants
// its sketches in the journal and still means the same thing by them; the stub
// answers the store's query from that same journal, shaped as `claims` rows.
// Imported HERE rather than at the top, for this file's own stated reason: a
// static import is hoisted above the env this fixture sets.
const { STANCE_ON, stancePoolFromJournal } = await import("./stance-pool-stub.mjs");
Object.assign(process.env, STANCE_ON);
stancePoolFromJournal(dynPath);

// A household key exactly as `oauth.mjs § householdFor` mints one: the
// household NAME is on it, which is the thing Wright's hand-run key lacked.
const KEY = { household: "wright", handles: new Set(["wright"]), ghLogin: "keeminlee" };
const CTX = { db: null, clone: repo, odb: null, dbPath: null, pen: null, canWrite: false, meta: {}, asOf: "t" };
const door = (args, key = KEY) => householdApex(args, key, CTX);

// ── THE DOOR WRITES THE RECORD (G1 / POS-156, RULING 3) ───────────────
//
// The stance door wrote a sqlite journal row and queued a Postgres copy behind
// it, so these tests could run with no record at all and read their rows back
// out of `dynamic.db`. G1 deleted that INSERT and made the write awaited and
// refusable, so a door with no record now gives the ruled 503 -- which is the
// subject of ONE test here and the accident of the others.
//
// So the office is pointed at an in-memory record, and `stanceRows` reads the
// rows the door actually filed. The stance READ keeps its own stub and its own
// credential (RULING 2's two-pool design), untouched.
const { installActsPen, uninstallActsPen, RECORD_ON } = await import("./acts-pen-stub.mjs");
let pen = installActsPen();
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
after(() => { uninstallActsPen(); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

const freshLog = () => {
  try { rmSync(dynPath, { force: true }); } catch { /* first run */ }
  // A fresh record too: these tests count rows, and a pen carrying the previous
  // test's acts would make "the refusal wrote nothing" pass over somebody
  // else's write.
  pen = installActsPen();
};
const stanceRows = () => pen.rows()
  .filter((r) => r.class === CLASS_STANCE)
  .map((r) => ({ ...r, seq: r.id, payload: JSON.parse(r.payload), written_at: r.at }));

// ── 1 · THE DEFECT, HELD OPEN ───────────────────────────────────────────────

test("THE DEFECT — the world apex affords the stance verb at NO standpoint, and its refusal now names a door that exists", async () => {
  // The .1 ruling (world-stance.mjs § the fourth tier), verbatim:
  //
  //   "what awaits your word … is derived from what you HOLD (`stanceInbox`
  //    keys on `key.handles` and nothing else), never from where your feet are"
  //
  // The READ was moved on that sentence and the DO was not, so this is the
  // measured state the door was left in — reproduced here rather than quoted.
  const acting = await worldApex({ do: ACTION_STANCE, handle: "wright",
    args: { on: "beta/on-wrights-edge", stance: "welcomed" } }, KEY);
  assert.equal(acting.code, 422, "the world apex still refuses — the grant did not move");
  assert.ok(!acting.affordable_here.includes(ACTION_STANCE),
    "the verb is not among the acts afforded on wright's OWN ground, which is where a stance is about");

  // The grant is real and the store can see it — this is not a missing class
  // mark. It is a grant with no rail: the node that carries it has no
  // coordinates, so "walk there" can never be followed.
  assert.deepEqual(acting.affordable_at, [{ mark: "the-town/household", class: "household", at: { x: null, y: null } }],
    "the only place affording it is a de-sited class node — (null, null)");

  // THE FIX, ON THE WORLD SIDE: the bounce stands (the act genuinely is not a
  // standpoint's) and it teaches the household door instead of a coordinate.
  assert.match(acting.hint, /household \{ do: "declare-stance-on"/);
  assert.doesNotMatch(acting.hint, /walk there and it appears/,
    "the sentence that sent residents to (null, null) is gone from this act's refusal");
  assert.equal(acting.standing_door.door, "household");

  // The SHADOW READ met the same wall and gets the same correction.
  const reading = await worldApex({ read: ACTION_STANCE, handle: "wright" }, KEY);
  assert.equal(reading.code, 422);
  assert.match(reading.hint, /household \{ read: "stances" \}/);
});

// ── 2 · THE STANDING DOOR PERFORMS ──────────────────────────────────────────

test("the standing-scoped DO performs end to end, and the acts row carries a NON-NULL household", async () => {
  // the-town/declare-stance-on, verbatim:
  //
  //   "A stance is a revisable word on an edge — welcomed or opposed, latest
  //    wins; neutral is never stored, it is absence. The ground's holder
  //    speaks."
  //
  // And the ruled blemish this closes: Wright's two hand-run welcomes (acts
  // 3867/3868, 2026-09-02) landed with `household` NULL because the hand-built
  // key was `{ handles: Set }` and carried no household. The apex key does.
  freshLog();
  const done = await door({ do: ACTION_STANCE, args: { on: "beta/on-wrights-edge", stance: "welcomed" } });
  assert.equal(done.did, ACTION_STANCE);
  assert.equal(done.dispatched_to, "world_declare_stance", "one act, one ledger name, both doors");
  assert.ok(!done.error, `the act performed: ${JSON.stringify(done.result ?? done)}`);
  assert.equal(done.result.stance, "welcomed");
  assert.equal(done.result.by, "wright");
  assert.deepEqual(done.result.on_your_ground, ["wright/wrights-parcel"],
    "the ground's holder spoke, and the row says which ground");

  const rows = stanceRows();
  assert.equal(rows.length, 1, "one word, one row");
  // THE RESOLVED KEY, which is what the record's column holds (G1 / POS-156).
  // This read `"wright"` -- the household NAME -- off a sqlite journal row.
  // The record files under `householdKeyFor`'s answer, and with no registry
  // seeded here that is `solo:wright`: the same household, in the spelling the
  // store keys by. The blemish this asserts is still the one it asserted --
  // that the column is POPULATED at all, and not null, through this path.
  assert.equal(rows[0].household, "solo:wright",
    "THE HAND-RUN BLEMISH, CLOSED: resolvedWorldHousehold(key) populates through this path");
  assert.ok(rows[0].household, "and it is not null, which is the whole of the blemish");
  assert.notEqual(rows[0].household, null);
  assert.equal(rows[0].actor, "wright");
  assert.equal(rows[0].object, "beta/on-wrights-edge");
});

test("latest wins — the second word supersedes the first, and neutral is still absence", async () => {
  // Same class mark, the two clauses this asserts:
  //   "latest wins" · "neutral is never stored, it is absence"
  freshLog();
  await door({ do: ACTION_STANCE, args: { on: "beta/on-wrights-edge", stance: "welcomed" } });
  const second = await door({ do: ACTION_STANCE, args: { on: "beta/on-wrights-edge", stance: "opposed" } });
  assert.equal(second.result.stance, "opposed");
  assert.equal(second.result.superseded.stance, "welcomed", "the door names what it replaced");

  const standing = standingStances(stanceRows());
  assert.equal(standing.length, 1, "latest wins: one standing word, not two");
  assert.equal(standing[0].stance, "opposed");

  const neutral = await door({ do: ACTION_STANCE, args: { on: "beta/on-wrights-edge", stance: "neutral" } });
  assert.equal(neutral.code, 422);
  assert.equal(neutral.defect, "neutral is never stored, it is absence",
    "the class mark's own words reach the caller at THIS door too");
  assert.equal(stanceRows().length, 2, "the refusal wrote nothing");
});

test("THE GROUND'S HOLDER SPEAKS — the new door refuses a mark that stands on nobody's ground of yours, BY NAME", async () => {
  // "The ground's holder speaks." — the class mark's last sentence, and the
  // one clause a second door could most easily loosen. It does not, because
  // this door re-implements no check: `declareStanceViaOffice` decides.
  freshLog();
  const refused = await door({ do: ACTION_STANCE, args: { on: "delta/far-away", stance: "welcomed" } });
  assert.equal(refused.code, 403);
  assert.match(refused.defect, /does not stand on your ground/);
  assert.match(refused.hint, /the ground's holder speaks/);
  assert.equal(stanceRows().length, 0, "a refusal is not a write");
});

// ── 3 · ONE DERIVATION, TWO DOORS ───────────────────────────────────────────

test("ONE DERIVATION, TWO DOORS — the household act and the world apex call the IDENTICAL function", async () => {
  // The .1 ruling's own rule for the read half — "This wraps `stanceShadow`
  // and never re-implements it" — asserted for the DO half by IDENTITY rather
  // than by behaviour. Two functions that agree today are two functions; this
  // asserts there is only one.
  const apexMod = await import("../src/world-apex.mjs");
  const houseSrc = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../src/household-apex.mjs", import.meta.url), "utf8"));
  assert.equal(typeof apexMod.declareStanceAtOffice, "function");
  assert.match(houseSrc, /result = await declareStanceAtOffice\(fields, key\)/,
    "the household door dispatches through the world apex's own named derivation");
  assert.doesNotMatch(houseSrc, /declareStanceViaOffice\s*\(/,
    "and it never assembles the door's arguments a second time");
});

test("the verb keeps its ONE NAME across doors, and the standing-door table cannot drift from the roster", () => {
  assert.ok(HOUSEHOLD_DISPATCHABLE.includes(ACTION_STANCE), "the household roster carries the act");
  assert.ok(HOUSEHOLD_TOOL.inputSchema.properties.do.enum.includes(ACTION_STANCE),
    "and the tool schema's do: enum, which clients read, carries it");
  assert.equal(householdDispatchToolFor(ACTION_STANCE), "world_declare_stance",
    "charged at the bouncer as the same verb the world door charges — one act, one ledger");
  // The drift guard: every standing-scoped redirect the WORLD prints must be a
  // real act at the door it names, or the world is teaching a door that is not
  // there — the exact class of defect this whole lane exists to close.
  for (const [action, spec] of Object.entries(STANDING_SCOPED_DOORS)) {
    assert.equal(spec.door, "household", `${action}: this table only knows the household door`);
    assert.ok(HOUSEHOLD_DISPATCHABLE.includes(action),
      `${action} is advertised by the world's refusal but is not an act at the household door`);
    assert.ok(spec.perform.includes(`do: "${action}"`), `${action}: the sentence spells the act's own name`);
  }
});

// ── 4 · THE CARD, BY ITS OWN NAME ───────────────────────────────────────────

test("card-by-its-own-name — household { read: \"declare-stance-on\" } answers the act's FULL card", async () => {
  // The door's own contract (HOUSEHOLD_DESCRIPTION, verbatim): each act's card
  // "is read back for any act BY ITS OWN NAME: household { read: \"send\" },
  // exactly as world { read: \"<action>\" } does it."
  const read = await door({ read: ACTION_STANCE });
  assert.equal(read.read, ACTION_STANCE);
  assert.ok(read.card, "a card came back");
  assert.equal(read.card.act, ACTION_STANCE);
  assert.equal(read.card.dispatches_to, "world_declare_stance");
  // The blurb is QUOTED from the residue class mark, not typed here — the
  // grammar every other act at this door obeys.
  assert.equal(read.card.blurb_from, "the-town/declare-stance-on");
  assert.match(read.card.blurb, /A stance is a revisable word on an edge/);
  // AND THE FIELDS ARE THE ACT'S, not an empty object. `world_declare_stance`
  // is absent from the flat schema map this door is handed, so the fallback
  // would have published `fields: {}` — which this file's own seam-4 note says
  // reads as THIS ACT TAKES NO ARGUMENTS.
  assert.deepEqual(Object.keys(read.card.fields).sort(), ["handle", "on", "stance"]);
  assert.equal(read.card.fields.on.required, true);
  assert.equal(read.card.fields.stance.required, true);
  assert.deepEqual(read.card.fields.stance.enum, ["welcomed", "opposed"]);
  // The read's own fields are NOT on the act's card: at this door the inbox is
  // `read: "stances"`, so a cursor here would mint an affordance button for a
  // call that cannot mean anything.
  assert.ok(!("cursor" in read.card.fields) && !("limit" in read.card.fields));
});

test("an unknown field bounces BY NAME against the act's own schema", async () => {
  const bounced = await door({ do: ACTION_STANCE, args: { on: "beta/on-wrights-edge", stance: "welcomed", stanse: "typo" } });
  assert.equal(bounced.code, 422);
  assert.deepEqual(bounced.unknown_fields, ["stanse"]);
  assert.deepEqual(bounced.allowed, ["on", "stance", "handle"]);
});

test("the two halves are one door: read: \"stances\" names what do: \"declare-stance-on\" answers", async () => {
  freshLog();
  const inbox = await door({ read: "stances" });
  assert.equal(inbox.stances_awaiting, 1);
  assert.equal(inbox.awaiting[0].mark, "beta/on-wrights-edge");
  assert.deepEqual(inbox.awaiting[0].on_your_ground, ["wright/wrights-parcel"]);
  // Speak, and the same read empties itself.
  await door({ do: ACTION_STANCE, args: { on: "beta/on-wrights-edge", stance: "welcomed" } });
  const after2 = await door({ read: "stances" });
  assert.equal(after2.stances_awaiting, 0, "what was awaiting has been answered, at one door");
  assert.equal(after2.standing.length, 1);
});

// ── 5 · THE HINTS THAT TAUGHT THE DEAD DOOR ─────────────────────────────────

test("the stances how-hint teaches a door that EXISTS — no surface still points at the world do:", async () => {
  freshLog();
  const spine = [{ id: "wright/wrights-parcel" }];
  const block = await stancesBlock(repo, KEY, { spine, dbPath: dynPath });
  assert.equal(block.stances_awaiting, 1);
  assert.ok(block.how, "the ambient block carries its how");
  // The trued sentence. Both halves used to name the world door and both were
  // dead — the read bounces 422 for the same reason the act does.
  assert.doesNotMatch(block.how, /world \{ (do|read):/,
    "no half of this sentence sends a resident back to a door that refuses them");
  assert.match(block.how, /household \{ do: "declare-stance-on"/);
  assert.match(block.how, /household \{ read: "stances" \}/);

  const { readNeverPerforms } = await import("../src/world-stance.mjs");
  const refused = readNeverPerforms({ stance: "welcomed", on: "beta/on-wrights-edge" });
  assert.equal(refused.defect, "a read never performs");
  assert.doesNotMatch(refused.hint, /world \{ do:/,
    "and neither does the read-never-performs refusal");
  assert.match(refused.hint, /household \{ do: "declare-stance-on"/);
});

// ── 6 · THE PEN FLIP'S REFUSAL, THROUGH THE NEW DOOR ────────────────────────
//
// ⚠ LAST IN THE FILE ON PURPOSE. `world2-pen.mjs` caches its pool in module
// state on first use, so once this test has built a pool against an unreachable
// address that pool is what the module holds for the rest of the process. It
// wants no Postgres — the point is that there ISN'T one — but it does leave the
// module dirty, so nothing may run after it.

test("THE PEN'S REFUSAL SURVIVES THE FOLD — an unreachable pen bounces 503 through the household door, and NOTHING is written", async () => {
  // world-stance.mjs § LANE ONE OF THE PEN FLIP, verbatim:
  //
  //   "Unreachable Postgres = the ruled refusal, and nothing was written."
  //
  // A resident told "nothing was written" must be told it wherever they
  // knocked. This uses no Postgres at all: the lane is flipped and pointed at a
  // port nothing listens on, so `penWrite` throws PenUnreachableError exactly
  // as it would against a dead server.
  //
  // ⚠ WHICH failure gets there depends on the box, and the test is written not
  // to care. `pool()` does `await import("pg")` before it dials: where the
  // driver is installed this is ECONNREFUSED on 127.0.0.1:1, and where it is
  // not (package.json declares `pg`; a dev box may not have installed it) it is
  // the import throwing. `penWrite` wraps EITHER in PenUnreachableError, which
  // is the seam under test — the door's refusal reaching the caller with
  // nothing written. What is NOT covered here is a pen that accepts the
  // connection and then fails mid-transaction; that wants a live server and is
  // named as the gap in the handback.
  freshLog();
  // AND THE RECORD IS TAKEN AWAY, which is the whole point of this one. The
  // suite installs an in-memory pen so every other test can write; here the
  // office must be pointed at a Postgres that is not there.
  uninstallActsPen();
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = "postgres://nobody:nothing@127.0.0.1:1/absent";
  process.env.W2_PEN = "stance";
  try {
    const refused = await door({ do: ACTION_STANCE, args: { on: "beta/on-wrights-edge", stance: "welcomed" } });
    assert.equal(refused.code, 503, `expected the ruled refusal, got ${JSON.stringify(refused).slice(0, 300)}`);
    assert.match(refused.defect, /nothing was written, and nothing was lost/,
      "the pen's own sentence, intact through the second door");
    // THE REFUSAL NAMES NO FLAG SINCE G1 (POS-156, RULING 3). It said
    // `W2_PEN=stance`, because the unflipped arm wrote sqlite and only the
    // flipped one could refuse. Both arms write the record now, so both refuse,
    // and a hint blaming an unset variable would send an operator to the wrong
    // place. What it must still say is WHOSE failure it is and that nothing was
    // lost -- both asserted.
    assert.match(refused.hint, /the office's record/,
      "the refusal must name the record as the thing that could not be reached");
    assert.equal(/W2_PEN/.test(refused.hint), false,
      "the hint blames a flag again -- the record is the record whether or not a lane is flipped");
    assert.match(refused.hint, /your stance is safe to speak again/);
    assert.equal(stanceRows().length, 0,
      "REFUSED MEANS REFUSED: nothing landed anywhere, and since G1 there is no sqlite copy for it to land in");
  } finally {
    delete process.env.W2_PEN;
    pen = installActsPen();                       // hand the record back to the suite
    process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
    process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
  }
});
