// parcels-publish-free.test.mjs — a parcel's lawful minimum stake is 0.
//
// RULED by Keemin 2026-09-27 (Linear POS-233): "PARCELS PUBLISH FREE — a
// parcel's lawful minimum stake is 0, for EVERYONE ('otherwise they just cost
// 1 nominal stamp (due to being sovereign, they'd never be contested
// anyway)'). The door charged 1 by omission (groundMinimumStake has no parcel
// case)."
//
// THE MEASUREMENT: the settlement already agreed. The standing walk answers
// `home` for a parcel at its first hop (world tools/mark-standing.mjs §
// markStanding; office world2/tools/standing.mjs), so neither the 1.0 sweep's
// nor the candle's "commons needs escrow > 0" reaches one. The door was the
// only holder of the nominal stamp.
//
// THE CAN-FAIL FLIPS: remove the parcel line from `groundMinimumStake` → the
// ✦0 leg and the own-ground leg go red; remove `publishNoteFor`'s parcel line
// → the note leg goes red. The controls stay green under both.
//
// NOT DRIVEN HERE: the stake door passing `kind` into its own-ground read
// (world-stake.mjs). The own-ground leg holds the function it calls.
//
//   node --test test/parcels-publish-free.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };

const repo = mkdtempSync(join(tmpdir(), "postmark-233f-repo-"));
const town = mkdtempSync(join(tmpdir(), "postmark-233f-town-"));
const scratch = mkdtempSync(join(tmpdir(), "postmark-233f-db-"));
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
git("config", "user.name", "pos233 parcels-free falsifier");
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
const SOLACE = keyFor("Ana-Login", "solace");

async function leave(payload, key) {
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  try {
    return { ok: true, ...(await leaveMarkViaOffice(repo, payload, key)) };
  } catch (e) {
    return { ok: false, code: e?.code, defect: e?.defect ?? e?.message, hint: e?.hint };
  }
}

test("a first parcel on open ground with stamps: 0 is put forward — no stamp bought, nothing refused", async () => {
  const out = await leave({ slug: "the-far-bank-porch", kind: "parcel", by: "solace",
    at: { x: -725, y: 800 }, body: "a porch on the far bank", stamps: 0 }, SOLACE);
  const claim = pen.state.claims.find((c) => c.slug === "solace/the-far-bank-porch");
  console.log(`    RECEIPT · parcel ✦0 → put_forward=${out.put_forward} refused_the_stake=${out.refused_the_stake ?? false} claim.status=${claim?.status} stake=${claim?.stake}`);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.put_forward, true, "a parcel's lawful minimum is 0, so ✦0 puts it forward");
  assert.equal(out.refused_the_stake, undefined, "and the ground refused nothing");
  assert.equal(out.publishing, undefined, "no escrow heads-up: a parcel is its own ground");
  assert.equal(out.stake_bounce, undefined, "no ledger was asked — nothing moves on a zero");
  assert.equal(claim?.status, "pending", "on the docket, where the crossing will publish it");
});

test("the publish note is silent for a parcel, and still speaks for a sited mark on open ground", async () => {
  const { publishNoteFor } = await import("../src/world.mjs");
  const residentsOf = () => null;
  assert.equal(publishNoteFor({ id: "solace/p", parent: null, by: "solace", kind: "parcel", marks: [], residentsOf }), null);
  const sited = publishNoteFor({ id: "solace/s", parent: null, by: "solace", kind: "sited", marks: [], residentsOf });
  assert.match(sited?.heads_up ?? "", /PUBLISHES ONLY WITH ESCROW/);
});

test("the stake door's own-ground read calls a parcel own ground (so an unbacked parcel promotion is not taken back)", async () => {
  const { markStandsOnOwnGround } = await import("../src/world.mjs");
  assert.equal(await markStandsOnOwnGround({ by: "solace", kind: "parcel", at: { x: 5000, y: 5000 } }), true);
  assert.equal(await markStandsOnOwnGround({ by: "solace", kind: "sited", at: { x: 5000, y: 5000 }, extent: { w: 2, h: 2 } }), false,
    "a sited mark on open ground is still the commons");
});

// ── CONTROL · the commons law is untouched ──────────────────────────────────

test("CONTROL: a sited mark on the commons still needs ✦1 — a zero is refused with the law named and the draft kept", async () => {
  const out = await leave({ slug: "a-bench-on-the-commons", kind: "sited", by: "solace",
    at: { x: 3000, y: 3000 }, extent: { w: 2, h: 1 }, body: "a bench", stamps: 0 }, SOLACE);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.put_forward, false);
  assert.equal(out.refused_the_stake, true);
  assert.match(out.to_publish, /stake at least ✦1/);
});

test("CONTROL: a parcel left with NO stamps field is still a private draft — omitting is not putting forward", async () => {
  const out = await leave({ slug: "a-quiet-plot", kind: "parcel", by: "solace",
    at: { x: 4000, y: 4000 }, body: "a quiet plot" }, SOLACE);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.put_forward, false);
  assert.ok(out.privacy, "the private-draft answer, as for any unstaked mark");
});
