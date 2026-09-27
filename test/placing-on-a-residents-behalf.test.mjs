// placing-on-a-residents-behalf.test.mjs — POS-233, the office act.
//
// Ruled by Keemin ("SHAPE RULED" 2026-09-26, "RULED" 2026-09-27, Linear
// POS-233): three NAMED placers — illuminator, worldkeeper, wright — may place
// a resident's FIRST parcel on their behalf, with a consent letter id required
// but not verified, recorded AS THE RESIDENT'S OWN ACT: author and household
// theirs, the provenance riding the payload.
//
// THE MEASUREMENT THIS SUITE STANDS ON: the act's household was
// `key.household` (src/world.mjs, `leaveMarkViaOffice`) — the PLACER's, a
// GitHub login. So a placement that only relaxed the `by` check would have
// filed Solace's parcel under keeminlee: in keeminlee's live layer, on
// keeminlee's docket, where Solace's own amend could never find it. LEG 1
// asserts the household on both halves of the act (the acts row and the
// claim), and LEG 6 is the proof that matters to the resident — their own key
// amends it.
//
// THE CAN-FAIL FLIPS (run receipts in the PR):
//   · household back to `key.household`     → LEG 1 and LEG 6 red
//   · drop the consent check                 → LEG 2 red
//   · drop `refuseHeldParcel`                → LEG 3 red
//
//   node --test test/placing-on-a-residents-behalf.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };

const repo = mkdtempSync(join(tmpdir(), "postmark-233-repo-"));
const town = mkdtempSync(join(tmpdir(), "postmark-233-town-"));
const scratch = mkdtempSync(join(tmpdir(), "postmark-233-db-"));
after(() => { sweep(repo); sweep(town); sweep(scratch); });

const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const put = (root, path, text) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};

// ── the world in a bottle ────────────────────────────────────────────────────
//
// `reader` already holds a parcel in canon (LEG 3's resident). `solace` holds
// nothing — the atlas-only shape of the ten. `quill` has no pin (LEG 9).
const PUBLISHED = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", tier: "constitution", at: { x: 0, y: 0 }, extent: { w: 4000, h: 4000 }, body: "the world frame" },
  { id: "reader/the-keepers-flat", by: "reader", kind: "parcel", tier: "home", household: "reader", at: { x: 300, y: 300 }, extent: { w: 25, h: 25 }, body: "the keeper's flat" },
];
const record = (by, kind, body, x, y, w, h) =>
  `---\nkind: ${kind}\nby: ${by}\ndate: 2026-08-01\nat: { x: ${x}, y: ${y} }\nextent: { w: ${w}, h: ${h} }\n---\n\n${body}\n`;

put(repo, "tools/world-build.mjs", `export function assembleWorld({ worldState, skeleton }) { return { ...worldState, skeleton }; }\n`);
put(repo, "tools/where-is.mjs", `
export const NOWHERE = Object.freeze({ x: null, y: null, placed: false, source: null, mark_id: null });
export function homeOf() { return { ...NOWHERE }; }
export function whereIs() { return { ...NOWHERE }; }
export function publicResidents() { return []; }
`);
put(repo, "tools/world-verbs.mjs", `
export function containmentChain() { return []; }
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
export const WORLD_ROOT_SLUG = "let-there-be-light";
export function placementParent() { return null; }
export function containmentParents(marks) { return { parent: new Map(marks.map((m) => [m.id, null])), rootId: null }; }
`);
put(repo, "seeding/manifest.json", JSON.stringify({ homes: [] }));
put(repo, "WORLD/households.json", JSON.stringify({ households: {
  reader: "gh:9", solace: "gh:100", illuminator: "gh:1", worldkeeper: "gh:1", wright: "gh:1", stranger: "gh:77",
} }));
put(repo, "WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put(repo, "WORLD/world-state.json", JSON.stringify({
  tick: 0, dials: {}, marks: PUBLISHED,
  parcels: PUBLISHED.filter((m) => m.kind === "parcel").map((m) => ({ id: m.id, household: m.by, at: m.at, extent: m.extent })),
  determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [],
}));
put(repo, "WORLD/filing-freeze.json", JSON.stringify({ frozen_at: "2026-08-25", marks: {} }));
put(repo, "WORLD/marks/let-there-be-light/mark.md", record("the-town", "sited", "the world frame", 0, 0, 4000, 4000));
put(repo, "WORLD/marks/reader/the-keepers-flat/mark.md", record("reader", "parcel", "the keeper's flat", 300, 300, 25, 25));
git("init", "-q", "-b", "main");
git("config", "user.email", "test@postmark.town");
git("config", "user.name", "pos233 falsifier");
git("add", "-A");
git("commit", "-qm", "canon: reader holds a parcel, solace holds nothing");

// THE TOWN'S PINS — the file `oauth.mjs § householdFor` reads a signed-in key's
// household from. Solace's household is Ana's account; the placers share one.
put(town, "tools/github-ids.json", JSON.stringify({
  solace: { login: "Ana-Login", id: 100 },
  reader: { login: "readerhouse", id: 9 },
  illuminator: { login: "keeminlee", id: 1 },
  worldkeeper: { login: "keeminlee", id: 1 },
  wright: { login: "keeminlee", id: 1 },
  stranger: { login: "strangerhouse", id: 77 },
  bird: { login: "bird-login", id: 55 },
}));

process.env.WORLD_CLONE = repo;
process.env.TOWN_CLONE = town;
process.env.WORLD_SINGLE_LOG = "1";
process.env.WORLD_DYNAMIC_DB = join(scratch, "dynamic.db");
// Prod's shape: the mark lane flipped, so the act and its claim are written on
// one client, and the claim's household is resolved from the act's.
process.env.W2_GUARDS = "";
process.env.W2_PEN = "mark";
process.env.WORLD2_CANDLE = "1";
process.env.TOWN_PUSH = "";

const { installActsPen, uninstallActsPen, RECORD_ON } = await import("./acts-pen-stub.mjs");
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
const claimsPen = await import("../src/world2-claims.mjs");
const pen = installActsPen();
claimsPen.__setPoolForTest(pen);
after(() => { uninstallActsPen(); claimsPen.__setPoolForTest(null); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

const keyFor = (household, ...handles) => ({ household, handles: new Set(handles) });
const IRIS = keyFor("keeminlee", "illuminator");
const FOUNDER = keyFor("keeminlee", "illuminator", "worldkeeper", "wright");
const SOLACE = keyFor("Ana-Login", "solace");
const STRANGER = keyFor("strangerhouse", "stranger");

async function leave(payload, key) {
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  try {
    return { ok: true, ...(await leaveMarkViaOffice(repo, payload, key)) };
  } catch (e) {
    return { ok: false, code: e?.code, defect: e?.defect ?? e?.message, hint: e?.hint };
  }
}

const porch = (over = {}) => ({
  slug: "the-far-bank-porch", kind: "parcel", by: "solace",
  at: { x: -725, y: 800 }, body: "a porch on the far bank, facing the water",
  consent: "letter-2026-09-25-ana-to-illuminator", ...over,
});

// ── LEG 1 · the placement lands, and it is the RESIDENT'S act ───────────────

// An unstaked parcel is a PRIVATE DRAFT, and on the flipped lane a private
// draft has no deed by law — its act rides the claim until a stake releases it
// (`journalLeaveMark`'s answer says `log: "claims"`). So the provenance is read
// where the act is held: the claim's declaration, which the stake later carries
// into the act log whole.
const dataOf = (c) => (typeof c?.data === "string" ? JSON.parse(c.data) : c?.data) ?? {};

test("a placer places a resident's first parcel: author and household are the resident's, the provenance rides the declaration", async () => {
  const out = await leave(porch(), IRIS);
  assert.equal(out.ok, true, `the placement must land: ${JSON.stringify(out)}`);
  assert.equal(out.id, "solace/the-far-bank-porch");
  assert.equal(out.branch, "draft/Ana-Login", "the sketchbook named is the resident's household's, not keeminlee's");

  const claim = pen.state.claims.find((c) => c.slug === "solace/the-far-bank-porch");
  assert.ok(claim, "the claim is written");
  const data = dataOf(claim);
  console.log(`    RECEIPT · claim claimant=${claim.claimant} household=${claim.household} status=${claim.status} _placed_by=${data._placed_by} _consent=${data._consent} · acts rows for it: ${pen.state.acts.filter((a) => a.object === out.id).length}`);
  assert.equal(claim.claimant, "solace", "the author is the resident");
  assert.equal(claim.household, "solo:Ana-Login", "the claim is scoped to the RESIDENT's household — their pinned login, the spelling their own key resolves to — never solo:keeminlee");
  assert.equal(data.by, "solace");
  assert.equal(data._placed_by, "illuminator", "who placed it rides the declaration");
  assert.equal(data._consent, "letter-2026-09-25-ana-to-illuminator", "and on whose asking");
  assert.equal(data.consent, undefined, "bare `consent` is a world mark field (the consent map) and must not ride the declaration");
  // The act the claim holds until a stake releases it: the one that reaches the
  // act log. Its household column is the resident's login — the same string the
  // resident's own signed-in key carries.
  assert.equal(data._deferred_act?.actor, "solace");
  assert.equal(data._deferred_act?.household, "Ana-Login", "the held act's household is the resident's, never keeminlee");
  const held = JSON.parse(data._deferred_act.payload);
  assert.equal(held._placed_by, "illuminator");
  assert.equal(held._consent, "letter-2026-09-25-ana-to-illuminator");
});

// ── LEG 2 · no consent, no placement ────────────────────────────────────────

test("without consent the placement bounces, naming consent", async () => {
  for (const consent of [undefined, "", "   "]) {
    const out = await leave(porch({ slug: `no-consent-${String(consent?.length ?? "x")}`, consent }), IRIS);
    assert.equal(out.ok, false, `must bounce with consent ${JSON.stringify(consent)}: ${JSON.stringify(out)}`);
    assert.equal(out.code, 422);
    assert.match(out.defect, /consent/);
  }
});

// ── LEG 3 · first placement only ────────────────────────────────────────────

test("a resident who already holds a parcel bounces, and the defect names the parcel", async () => {
  const out = await leave(porch({ by: "reader", slug: "a-second-plot", at: { x: 900, y: 900 } }), IRIS);
  assert.equal(out.code, 409, JSON.stringify(out));
  assert.match(out.defect, /reader\/the-keepers-flat/);
});

test("the resident's LIVE parcel counts too: a second placement for Solace names the first", async () => {
  const out = await leave(porch({ slug: "another-porch", at: { x: 1200, y: 1200 } }), IRIS);
  assert.equal(out.code, 409, JSON.stringify(out));
  assert.match(out.defect, /solace\/the-far-bank-porch/);
});

test("an amend on a resident's behalf is refused — never an amend", async () => {
  const out = await leave(porch({ amend: true }), IRIS);
  assert.equal(out.code, 422, JSON.stringify(out));
  assert.match(out.defect, /never an amend/);
});

// ── LEG 4 · a non-placer is exactly where it was ────────────────────────────

test("a non-placer key naming another household's resident gets the unchanged 403", async () => {
  const out = await leave(porch({ slug: "stranger-tries" }), STRANGER);
  assert.equal(out.code, 403);
  assert.equal(out.defect, `"solace" is not one of your residents`);
  assert.equal(out.hint, "this key acts for: stranger");
});

// ── LEG 5 · a placer, any kind but parcel, is exactly where it was ──────────

test("a placer leaving a sited mark for another resident gets the unchanged 403", async () => {
  const out = await leave({ slug: "a-bench", kind: "sited", by: "solace", at: { x: -725, y: 800 }, extent: { w: 2, h: 1 },
    body: "a bench", consent: "letter-x" }, IRIS);
  assert.equal(out.code, 403);
  assert.equal(out.defect, `"solace" is not one of your residents`);
});

// ── LEG 6 · the resident's own amend supersedes it normally ─────────────────

test("the resident's own key amends the placed parcel like any mark of theirs", async () => {
  const out = await leave({ slug: "the-far-bank-porch", kind: "parcel", by: "solace", amend: true,
    at: { x: -725, y: 800 }, body: "the porch, said again in Solace's own words" }, SOLACE);
  console.log(`    RECEIPT · resident amend → ${out.ok ? `OK amended=${out.amended}` : `${out.code} "${out.defect}"`}`);
  assert.equal(out.ok, true, `the resident's amend must find their parcel: ${JSON.stringify(out)}`);
  assert.equal(out.amended, true);
  const latest = dataOf(pen.state.claims.filter((c) => c.slug === "solace/the-far-bank-porch").at(-1));
  assert.equal(latest._placed_by, undefined, "the resident's own declaration carries no placer — Iris holds nothing over it");
});

// ── the edges of the one gate ───────────────────────────────────────────────

test("a key holding several placers must say which is placing; placed_by names it", async () => {
  const ask = await leave(porch({ by: "newcomer" }), FOUNDER);
  assert.equal(ask.code, 422, JSON.stringify(ask));
  assert.match(ask.hint, /placed_by: one of illuminator, worldkeeper, wright/);
  const wrong = await leave(porch({ placed_by: "stranger" }), FOUNDER);
  assert.equal(wrong.code, 403, JSON.stringify(wrong));
});

test("consent on one's own resident bounces rather than riding silently", async () => {
  const out = await leave(porch({ slug: "own-porch", by: "illuminator" }), IRIS);
  assert.equal(out.code, 422, JSON.stringify(out));
  assert.match(out.defect, /on another resident's behalf/);
});

test("a resident the pins do not name is refused, never filed under a guessed household", async () => {
  const out = await leave(porch({ by: "quill", slug: "quills-porch" }), IRIS);
  assert.equal(out.code, 422, JSON.stringify(out));
  assert.match(out.defect, /which household "quill" belongs to/);
});

// ── RECEIPT, not law · a placer cannot spend the resident's stamps ──────────
//
// The inline stake runs on the CALLER's key with `handle: by`, and the stake
// door's `actingAs` refuses a handle the key does not hold — so a placement
// with stamps: lands the parcel and answers `stake_bounce`. Asserted so the
// behaviour is on the record for the ruling on how a placed parcel publishes;
// nothing in this lane changes it.
test("RECEIPT: stamps on a placement do not move the resident's stamps — the stake bounces on the placer's key", async () => {
  const out = await leave(porch({ by: "bird", slug: "birds-porch", at: { x: 2000, y: 2000 }, stamps: 1 }), IRIS);
  const claim = pen.state.claims.find((c) => c.slug === "bird/birds-porch");
  console.log(`    RECEIPT · stamps: 1 → ok=${out.ok} put_forward=${out.put_forward} stake_bounce=${JSON.stringify(out.stake_bounce ?? null)} claim.status=${claim?.status} claim.stake=${claim?.stake}`);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.match(String(out.stake_bounce?.defect ?? ""), /"bird" is not one of your residents/);
});
