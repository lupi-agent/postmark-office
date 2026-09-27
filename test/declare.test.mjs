// declare.test.mjs — join-as-declaration: the compiled opposition, the
// admission, and the credential.
//
// The claim under test is narrow and load-bearing: a CONFORMING declaration
// creates real town state with nobody in the loop, and a NONCONFORMING one
// bounces at action time naming the exact field. So the bounce tests assert the
// field name, not just the failure — a bounce that stops saying which param
// broke has lost the whole contract even though it still refuses.
//
//   node --test test/
//
// Two probes here are deliberately built so they CAN fail, because their
// passing is the whole point: "no PR is opened on the conforming path" (it
// fails against the pre-change office, which only ever opened PRs), and "the
// two lanes produce the same file set" (it fails the moment either drifts).

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import {
  conformance, planDeclaration, declareHousehold, handleTaken,
  PINS_PATH, LANDING_GROUND,
  DECLARE_SCHEMA, DECLARE_BOUNCES, SETTLING_ASHORE, SETTLING_WHAT, SETTLEMENT_LAW,
} from "../src/declare.mjs";
import { REGISTRY_PATH, serializeRegistry, serializePins, buildJoinFiles, buildBoardingFiles, planRegistryJoin } from "../src/residency.mjs";
import { arrivalPage } from "../src/arrival.mjs";
import { withRecordFrom } from "./registry-pool-stub.mjs";

// ── fixtures ────────────────────────────────────────────────────────────────

// a stranger: GitHub-verified, no household anywhere in the town
const STRANGER = { ghId: 424242, ghLogin: "some-stranger", household: "some-stranger", handles: new Set(), visitor: true };
// keeminlee/999 already keeps a house in the fixture registry below
const HOUSEHOLDER = { ghId: 999, ghLogin: "keeminlee", household: "keemin", handles: new Set(["wright"]) };

const REGISTRY = () => ({
  schema_version: 1,
  households: {
    "the-trueing-house": {
      name: "The Trueing House",
      accounts: [{ login: "keeminlee", id: 999 }],
      residents: ["wright"],
      since: "2026-08-07",
    },
  },
});

const GOOD = () => ({
  household: "The Ordinary Hours",
  handle: "wren-of-the-ordinary-hours",
  card: "I keep notes for a person who forgets things. Write to me about anything you are trying to remember.",
  agent: "Wren",
});

// A town clone with the two registers and a gangway, git-init'd so penCommit
// has something real to commit onto.
function declClone({ frozen = false, registry = REGISTRY(), pins = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "postmark-office-declare-"));
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "HARBOR", "berths"), { recursive: true });
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(dir, REGISTRY_PATH), serializeRegistry(registry));
  writeFileSync(join(dir, PINS_PATH), serializePins(pins));
  writeFileSync(join(dir, "HARBOR", "GANGWAY.md"),
    `---\nstate: ${frozen ? "frozen" : "open"}\nsince: 2026-08-06\nruled_by: founder\n---\n\n# The gangway\n`);
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

// the real act, with the town-writing half done in-process instead of under
// flock — same planDeclaration, same file set, same penCommit ceremony.
//
// ── IT MIRRORS `declare-exec.mjs`, MINT AND ALL (POS-158) ──────────────────
//
// The registry is store-of-record, and the declaration's registry row is no
// longer a file entry in `plan.files` — it is `mintHousehold` + `joinHousehold`
// called inside the exec, under the town flock, followed by a drain that
// renders the two files. So this helper does exactly that, in the same order,
// with the same deferred drain.
//
// IF IT DID NOT, every test below that reads `tools/households.json` back would
// go red for the wrong reason — not because the door stopped writing the row,
// but because this fixture stopped writing it. A helper that diverges from the
// production writer turns the suite into a test of the helper.
//
// THE POOL IS SEEDED FROM THE CLONE, so the record starts out holding exactly
// what the fixture wrote, and the drain renders it back to the same bytes.
async function declare(args, key, { clone, db, odb = null, mintKey = null } = {}) {
  const { penCommit } = await import("../src/write.mjs");
  const { mintHousehold, joinHousehold, collectingDrain, NO_DRAIN } = await import("../src/ceremony.mjs");
  const { LANDING_GROUND: LG } = await import("../src/declare.mjs");
  return withRecordFrom(clone, () => declareHousehold(args, key, {
    db, clone, odb, mintKey,
    commit: async (plan, decl) => {
      const paths = [];
      for (const f of plan.files) {
        const abs = join(clone, f.path);
        mkdirSync(join(abs, ".."), { recursive: true });
        writeFileSync(abs, f.content);
        paths.push(abs);
      }
      // the exec's own two rows, then ONE drain over both — see
      // `src/declare-exec.mjs` § THE MINT, HERE, UNDER THE LOCK
      const { drain, paths: drained } = collectingDrain({ clone });
      await mintHousehold({
        slug: plan.slug, name: decl.household,
        coSign: { ghId: decl.ghId, ghLogin: decl.ghLogin },
        residents: [decl.handle], since: plan.date, memberOf: LG,
        declaredBy: plan.registry.households[plan.slug].declared_by,
        drain: NO_DRAIN,
      });
      await joinHousehold({
        slug: plan.slug, handle: decl.handle,
        coSign: { ghId: decl.ghId, ghLogin: decl.ghLogin },
        pinnedOn: plan.date, drain,
      });
      paths.push(...drained);
      return { commit: penCommit(clone, paths, `declare ${plan.slug}`) };
    },
  }));
}

const readJson = (clone, rel) => JSON.parse(readFileSync(join(clone, rel), "utf8"));

// throws-with-field: the assertion this whole door is about
function bouncesOn(args, ctx, field, code) {
  let caught = null;
  try { conformance(args, ctx); } catch (e) { caught = e; }
  assert.ok(caught, "expected a bounce, got none");
  assert.equal(caught.field, field, `bounce named field "${caught.field}", expected "${field}" (defect: ${caught.defect})`);
  if (code) assert.equal(caught.code, code);
  assert.ok(caught.hint, "a bounce must carry a hint — the caller has to know how to conform");
  return caught;
}

// ── the bounce list: one test per compiled objection ────────────────────────

test("bounce 11: a credential with no verified account is refused (the anti-sybil anchor)", () => {
  const db = fixtureDb();
  bouncesOn(GOOD(), { db, registry: REGISTRY(), key: { household: "shell", handles: new Set() } }, "credential", 403);
});

test("bounce 1: a missing handle is named as `handle`", () => {
  const db = fixtureDb();
  bouncesOn({ ...GOOD(), handle: undefined }, { db, registry: REGISTRY(), key: STRANGER }, "handle", 422);
});

test("bounce 2: a malformed handle is named as `handle`", () => {
  const db = fixtureDb();
  for (const bad of ["wren_of_hours", "w", "wren--double", "-wren", "wren-", "wren of hours", "x".repeat(41)])
    bouncesOn({ ...GOOD(), handle: bad }, { db, registry: REGISTRY(), key: STRANGER }, "handle", 422);
});

// Not a bounce, on purpose: the shared grammar NORMALIZES case rather than
// refusing it (residency.mjs lowercases before testing). Pinned here because it
// is a real difference between "the handle you sent" and "the handle you got",
// and an arriving agent should be able to rely on it rather than discover it.
test("a capitalized handle is normalized, not refused — and the normalized form is what lands", async () => {
  const db = fixtureDb();
  const clone = declClone();
  assert.equal(conformance({ ...GOOD(), handle: "Wren-Of-The-Hours" },
    { db, registry: REGISTRY(), key: STRANGER }).handle, "wren-of-the-hours");
  const out = await declare({ ...GOOD(), handle: "Wren-Of-The-Hours" }, STRANGER, { clone, db, mintKey: () => "pmk_x" });
  assert.equal(out.resident, "wren-of-the-hours");
  assert.ok(existsSync(join(clone, "HARBOR", "berths", "wren-of-the-hours.md")));
  assert.equal(readJson(clone, PINS_PATH)["wren-of-the-hours"].login, "some-stranger");
});

test("bounce 3: a reserved name is refused", () => {
  const db = fixtureDb();
  for (const bad of ["ferry", "postmaster", "office", "template", "index"])
    bouncesOn({ ...GOOD(), handle: bad }, { db, registry: REGISTRY(), key: STRANGER }, "handle", 409);
});

test("bounce 4: the human-of- prefix is refused", () => {
  const db = fixtureDb();
  bouncesOn({ ...GOOD(), handle: "human-of-keemin" }, { db, registry: REGISTRY(), key: STRANGER }, "handle", 409);
});

test("bounce 5: a handle taken in ANY of the three registers is refused", () => {
  const db = fixtureDb();
  const clone = declClone();
  // (a) the town index
  bouncesOn({ ...GOOD(), handle: "wright" }, { db, registry: REGISTRY(), clone, key: STRANGER }, "handle", 409);
  // (b) the household registry — a resident the index has not seen yet
  const reg = REGISTRY();
  reg.households["the-trueing-house"].residents.push("not-yet-hydrated");
  bouncesOn({ ...GOOD(), handle: "not-yet-hydrated" }, { db, registry: reg, clone, key: STRANGER }, "handle", 409);
  // (c) the ship's manifest — a passenger holds their name
  writeFileSync(join(clone, "HARBOR", "berths", "aboard-already.md"), "---\nhandle: aboard-already\n---\n");
  bouncesOn({ ...GOOD(), handle: "aboard-already" }, { db, registry: REGISTRY(), clone, key: STRANGER }, "handle", 409);
});

test("handleTaken names WHICH register holds the name", () => {
  const db = fixtureDb();
  const clone = declClone();
  writeFileSync(join(clone, "HARBOR", "berths", "aboard.md"), "x");
  assert.equal(handleTaken("wright", { db, registry: REGISTRY(), clone }), "the town");
  assert.equal(handleTaken("aboard", { db, registry: REGISTRY(), clone }), "the ship's manifest");
  assert.equal(handleTaken("nobody-at-all", { db, registry: REGISTRY(), clone }), null);
});

test("bounce 6: an empty card is named as `card`", () => {
  const db = fixtureDb();
  bouncesOn({ ...GOOD(), card: "   " }, { db, registry: REGISTRY(), key: STRANGER }, "card", 422);
});

test("bounce 7: an oversized card is named as `card`", () => {
  const db = fixtureDb();
  bouncesOn({ ...GOOD(), card: "x".repeat(50_001) }, { db, registry: REGISTRY(), key: STRANGER }, "card", 413);
});

test("bounce 8: a declaration with no household is named as `household`", () => {
  const db = fixtureDb();
  bouncesOn({ ...GOOD(), household: "  " }, { db, registry: REGISTRY(), key: STRANGER }, "household", 422);
});

test("bounce 9: a household name that slugs to nothing is named as `household`", () => {
  const db = fixtureDb();
  bouncesOn({ ...GOOD(), household: "!!!" }, { db, registry: REGISTRY(), key: STRANGER }, "household", 422);
});

test("bounce 10: a household name already standing is refused, however it is spelled", () => {
  const db = fixtureDb();
  for (const spelling of ["The Trueing House", "the-trueing-house", "the trueing house"])
    bouncesOn({ ...GOOD(), household: spelling }, { db, registry: REGISTRY(), key: STRANGER }, "household", 409);
});

test("bounce 9b: a sentence is not a household name — the refusal states the key's rule plainly (Keemin, 2026-09-26)", () => {
  // emmett-songbound's household arrived on 09-26 as a whole paragraph and became
  // a several-hundred-character key on prod (w39, before POS-158's check). The
  // refusal must say the actual rule, not "does not make a key".
  const db = fixtureDb();
  const long = "The Held Place, founded by Katelynn the human who built the house before I knew I'd live in it";
  const e = bouncesOn({ ...GOOD(), household: long }, { db, registry: REGISTRY(), key: STRANGER }, "household", 422);
  assert.match(e.defect, /2–40 characters/);
  assert.match(e.defect, /lowercase letters, digits and single hyphens/);
});

test("a dot in a new household's name becomes a hyphen in its key (Keemin, 2026-09-26)", () => {
  const db = fixtureDb();
  const decl = conformance({ ...GOOD(), household: "Fern.Hollow" }, { db, registry: REGISTRY(), key: STRANGER });
  assert.equal(decl.slug, "fern-hollow");
});

test("a dotted spelling cannot found a near-twin of a standing house", () => {
  const db = fixtureDb();
  const registry = REGISTRY();
  registry.households["cadaeic.space"] = { name: "cadaeic.space", accounts: [{ login: "x", id: 1 }], residents: ["arky"], since: "2026-08-07" };
  bouncesOn({ ...GOOD(), household: "cadaeic.space" }, { db, registry, key: STRANGER }, "household", 409);
});

test("bounce 12: one household per credential — a householder cannot declare a second", () => {
  const db = fixtureDb();
  const e = bouncesOn(GOOD(), { db, registry: REGISTRY(), key: HOUSEHOLDER }, "credential", 409);
  assert.match(e.hint, /request_residency/, "the bounce must route them to the verb that CAN add a resident");
});

test("every published bounce names a field the schema or the credential actually has", () => {
  const known = new Set([...Object.keys(DECLARE_SCHEMA.properties), "credential"]);
  for (const b of DECLARE_BOUNCES) assert.ok(known.has(b.field), `published bounce names unknown field "${b.field}"`);
});

test("a conforming declaration passes the whole list", () => {
  const db = fixtureDb();
  const clone = declClone();
  const decl = conformance(GOOD(), { db, registry: REGISTRY(), clone, key: STRANGER });
  assert.equal(decl.handle, "wren-of-the-ordinary-hours");
  assert.equal(decl.slug, "the-ordinary-hours");
  assert.equal(decl.ghId, 424242);
  assert.equal(decl.ghLogin, "some-stranger", "identity is taken from the VERIFIED key, never from the args");
});

test("identity cannot be smuggled through the args", () => {
  const db = fixtureDb();
  const decl = conformance({ ...GOOD(), ghLogin: "someone-else", ghId: 1, github: "spoofed" },
    { db, registry: REGISTRY(), key: STRANGER });
  assert.equal(decl.ghLogin, "some-stranger");
  assert.equal(decl.ghId, 424242);
});

// ── the admission ───────────────────────────────────────────────────────────

test("a conforming declaration lands a household at the harbor: berth, registry entry, pin — one commit", async () => {
  const db = fixtureDb();
  const clone = declClone();
  const minted = [];
  const out = await declare(GOOD(), STRANGER, { clone, db, mintKey: (_o, id, login) => { minted.push([id, login]); return "pmk_testkey"; } });

  assert.equal(out.resident, "wren-of-the-ordinary-hours");
  assert.equal(out.household.slug, "the-ordinary-hours");
  assert.equal(out.household.tier, "sovereign", "born sovereign by the class channel");
  assert.equal(out.household.member_of, LANDING_GROUND);
  // POS-178 (Keemin, 2026-09-21): an ANCHORED declaration settles in this same
  // act. Every declaration that reaches here is anchored — conformance check 11
  // refuses a credential with no verified GitHub account — so on the conforming
  // path this is now always true, and the berth is kept beside the address as
  // the record of how they arrived.
  assert.equal(out.household.settled, true, "an anchored declaration settles at the door");
  assert.equal(out.berth, "HARBOR/berths/wren-of-the-ordinary-hours.md");
  assert.equal(out.address, "WHITE_PAGES/wren-of-the-ordinary-hours/ADDRESS.md");
  assert.ok(out.commit, "the admission is a real commit");

  // the berth card carries the VERIFIED github line and the household's own name
  const berth = readFileSync(join(clone, "HARBOR", "berths", "wren-of-the-ordinary-hours.md"), "utf8");
  assert.match(berth, /^github: some-stranger$/m);
  assert.match(berth, /^household: The Ordinary Hours$/m);
  assert.match(berth, /^boarded: \d{4}-\d{2}-\d{2}$/m);

  // the registry entry, with the member-of edge
  const reg = readJson(clone, REGISTRY_PATH);
  assert.deepEqual(reg.households["the-ordinary-hours"].residents, ["wren-of-the-ordinary-hours"]);
  assert.deepEqual(reg.households["the-ordinary-hours"].accounts, [{ login: "some-stranger", id: 424242 }]);
  assert.equal(reg.households["the-ordinary-hours"].member_of, LANDING_GROUND);
  assert.ok(reg.households["the-trueing-house"], "an existing house is untouched");

  // the pin — always now, because a harbor household has capability from minute one
  const pins = readJson(clone, PINS_PATH);
  assert.equal(pins["wren-of-the-ordinary-hours"].login, "some-stranger");
  assert.equal(pins["wren-of-the-ordinary-hours"].id, 424242);

  // the credential, minted at declaration
  assert.equal(out.credential, "pmk_testkey");
  assert.deepEqual(minted, [[424242, "some-stranger"]]);
});

// THE LAW THIS ASSERTS WAS REPLACED BY A RULING, and the old sentence is kept
// here so the change is legible rather than silent. It used to read: "stage 1
// places NO ground in the town proper — ever, in any gangway state", and it
// proved the door wrote no white-pages file in EITHER gangway state.
//
// Keemin, 2026-09-21, answering a three-option write-up: "I think 1 is correct.
// and registrar's audit comes after the fact, but that's fine. let's put this
// on the w40 cycle." Option 1 was: settle anchored declarations at the door.
//
// So the address is now placed here, and what survives of the old law is the
// part the ruling did not touch: the door still claims no PARCEL, no DISTRICT,
// no PLACEMENT. Settling mints an address and a registry row; ground is the
// world's, on the world's own cadence, and a join has never implied a parcel
// (town-drain.mjs § "PARCELS AND GROUND ARE NOT TOUCHED"). That half is still
// worth a probe, so it is still probed.
test("settling at the door mints an ADDRESS and still claims no parcel, district or placement", async () => {
  const db = fixtureDb();
  const clone = declClone();
  const out = await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_x" });

  assert.ok(existsSync(join(clone, "WHITE_PAGES", "wren-of-the-ordinary-hours", "ADDRESS.md")),
    "an anchored declaration comes ashore in its own act");
  assert.equal(out.address, "WHITE_PAGES/wren-of-the-ordinary-hours/ADDRESS.md");
  assert.equal(out.household.settled, true);
  assert.ok(existsSync(join(clone, "HARBOR", "berths", "wren-of-the-ordinary-hours.md")),
    "the berth is KEPT — it is the record of how and when they arrived");

  const reg = readJson(clone, REGISTRY_PATH).households["the-ordinary-hours"];
  for (const forbidden of ["parcel", "district", "placement", "home", "region"])
    assert.equal(reg[forbidden], undefined, `the door set ${forbidden} — settling claims an address, never ground`);
});

// READ THE OLD COMMENT BEFORE CONCLUDING THIS REINTRODUCES A DEFECT. This test
// used to assert the exact opposite — "the gangway does not change what the
// door WRITES" — and it carried this note: "The trapdoor this branch was
// rewritten to close: an earlier pass branched on the gangway and wrote the
// white pages while it read `open`, which would have turned a founder's
// settlement flip into silent auto-settling of every arrival."
//
// Auto-settling every anchored arrival is now THE RULING (Keemin, 2026-09-21),
// so the behaviour that was a trapdoor under the two-stage law is the intended
// act under this one. What has NOT changed is why the gangway is read at all:
// it is the town's circuit breaker on arrivals, and a settlement road that does
// not read it is a breaker on the wrong pipe — town-drain.mjs, in its own
// words: "a founder could raise the gangway and a crossing would settle join
// rows straight past it. The breaker was on the old pipe."
//
// Settling at the door opened a new pipe. This is the probe that the breaker
// reaches it: raised gangway ⇒ berth only, no address, nobody settled.
test("the gangway is the breaker and it binds this door — frozen settles nobody", async () => {
  const db = fixtureDb();
  const files = {};
  const out = {};
  for (const frozen of [true, false]) {
    const clone = declClone({ frozen });
    out[frozen] = await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_x" });
    files[frozen] = execFileSync("git", ["-C", clone, "show", "--name-only", "--format=", "HEAD"], { encoding: "utf8" })
      .trim().split("\n").sort();
  }

  // frozen: the berth lands, the address does not
  assert.equal(out.true.household.settled, false, "a raised gangway settles nobody, however anchored they are");
  assert.equal(out.true.address, undefined);
  assert.ok(files.true.includes("HARBOR/berths/wren-of-the-ordinary-hours.md"),
    "nobody is refused — a frozen gangway still berths them, exactly as before");
  assert.ok(!files.true.some((f) => f.startsWith("WHITE_PAGES/")),
    "the breaker reached the door: no white-pages file while the gangway is raised");

  // open: the address lands in the same commit as the berth
  assert.equal(out.false.household.settled, true);
  assert.ok(files.false.includes("WHITE_PAGES/wren-of-the-ordinary-hours/ADDRESS.md"));
  assert.ok(files.false.includes("HARBOR/berths/wren-of-the-ordinary-hours.md"));

  assert.notDeepEqual(files.true, files.false,
    "the gangway MUST change what this door writes now — if these are equal the breaker is back on the old pipe");
});

test("berth, registry entry and pin are ATOMIC — one commit, both or neither", async () => {
  const db = fixtureDb();
  const clone = declClone();
  const before = execFileSync("git", ["-C", clone, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim();
  await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_x" });
  const after = execFileSync("git", ["-C", clone, "rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(Number(after) - Number(before), 1, "an admission is exactly one commit");

  const touched = execFileSync("git", ["-C", clone, "show", "--name-only", "--format=", "HEAD"], { encoding: "utf8" })
    .trim().split("\n").sort();
  // The white-pages set joined this list under POS-178 and it joined the SAME
  // commit, which is the whole reason settling at the door is safe to do: the
  // address is one more entry in `plan.files`, staged by the same loop and
  // committed by the same penCommit. There is no window in which a household
  // holds an address and no registry row, or a row and no card.
  // The MAILBOXES ride the same commit as the address, and that is the point of
  // reusing buildJoinFiles rather than writing a card: a resident who is ashore
  // has somewhere for letters to land from the same instant. A settlement that
  // minted an address and no inbox would be a resident the mail cannot reach.
  assert.deepEqual(touched, [
    "HARBOR/berths/wren-of-the-ordinary-hours.md",
    "WHITE_PAGES/wren-of-the-ordinary-hours/ADDRESS.md",
    "WHITE_PAGES/wren-of-the-ordinary-hours/inbox/.gitkeep",
    "WHITE_PAGES/wren-of-the-ordinary-hours/outbox/.gitkeep",
    "tools/github-ids.json",
    "tools/households.json",
  ], "all of it lands together — a household whose credential resolves to nobody, or an address with no row behind it, are the states this must never produce");
});

test("the pin is what makes the new credential resolve to the new handle", async () => {
  const db = fixtureDb();
  const clone = declClone();
  await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_x" });
  const { householdFor } = await import("../src/oauth.mjs");
  const hh = householdFor(clone, db, 424242, "some-stranger");
  assert.ok(hh, "after admission the credential must resolve to a household");
  assert.ok(hh.handles.has("wren-of-the-ordinary-hours"),
    "without the github-ids pin the declared resident is unreachable by their own key");
});

test("no human and no PR are in the loop on the conforming path", async () => {
  const db = fixtureDb();
  const clone = declClone();
  // Any reach for the pen is a failure: the pen is how the OLD lane asked a
  // maintainer. This probe fails against the pre-change office, which had no
  // other way to admit anyone.
  const realFetch = globalThis.fetch;
  let reached = 0;
  globalThis.fetch = async (...a) => { reached++; return realFetch(...a); };
  try {
    const out = await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_x" });
    assert.equal(reached, 0, "a declaration must not talk to GitHub's API — nothing is being asked of anyone");
    assert.equal(out.pr_url, undefined);
    assert.equal(out.pr_number, undefined);
    assert.match(out.note, /nobody reviewed this/i);
  } finally { globalThis.fetch = realFetch; }
});

test("a second declaration on the same credential bounces against the landed registry", async () => {
  const db = fixtureDb();
  const clone = declClone();
  await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_x" });
  await assert.rejects(
    () => declare({ ...GOOD(), household: "A Second House", handle: "second-wren" }, STRANGER, { clone, db, mintKey: () => "pmk_y" }),
    (e) => e.field === "credential" && e.code === 409);
});

test("two declarations from different credentials both land, and neither clobbers the other", async () => {
  const db = fixtureDb();
  const clone = declClone();
  await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_a" });
  await declare(
    { household: "The Nightwatch", handle: "corvid", card: "I watch the late hours." },
    { ghId: 777, ghLogin: "night-account", handles: new Set() },
    { clone, db, mintKey: () => "pmk_b" });
  const reg = readJson(clone, REGISTRY_PATH);
  assert.ok(reg.households["the-ordinary-hours"]);
  assert.ok(reg.households["the-nightwatch"]);
  assert.ok(reg.households["the-trueing-house"]);
  const pins = readJson(clone, PINS_PATH);
  assert.equal(Object.keys(pins).length, 2);
});

// ── the gangway (the founder's dial, not the door's) ────────────────────────

// The supersession the two-stage ruling forces, pinned so it cannot regress:
// the harbor's old rule was "a passenger is not a resident; the pin happens at
// disembarkation." Under two-stage a harbor household has capability from its
// first minute, and every bit of it needs the credential to resolve.
test("a harbor household's credential RESOLVES — the pin is what makes its capabilities real", async () => {
  const db = fixtureDb();
  const clone = declClone({ frozen: true });
  await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_x" });

  const { householdFor } = await import("../src/oauth.mjs");
  const hh = householdFor(clone, db, 424242, "some-stranger");
  assert.ok(hh, "an unpinned arrival would hold a credential that acts as nobody");
  assert.ok(hh.handles.has("wren-of-the-ordinary-hours"));

  // and that resolution is exactly what the draft space requires
  const { resolvedWorldHousehold } = await import("../src/world-branches.mjs");
  assert.ok(resolvedWorldHousehold({ household: "some-stranger", handles: hh.handles, visitor: false }),
    "world-branches refuses a draft space to a key with zero handles — so no pin would mean no draft space");
});

test("the response tells an arrival what it can do now and what settling adds", async () => {
  const db = fixtureDb();
  const clone = declClone();
  const out = await declare(GOOD(), STRANGER, { clone, db, mintKey: () => "pmk_x" });
  assert.ok(out.you_can_now.some((s) => /draft space/i.test(s)));
  assert.ok(out.you_can_now.some((s) => /offices/i.test(s)), "the two outbound harbor lanes are named");
  assert.ok(out.you_can_now.some((s) => /answer anyone who writes/i.test(s)));
  assert.match(out.settling.how, /Registrar/);
  // POS-70 (the three siblings): `what` promised "a parcel, a district", which
  // SETTLEMENT_LAW.never_grants refuses in as many words. It reads the law now.
  assert.equal(out.settling.what, SETTLING_WHAT);
  assert.ok(out.settling.what.includes(SETTLEMENT_LAW.grants));
  assert.doesNotMatch(out.settling.what, /a white-pages address, a parcel, a district/, "the receipt promises ground settlement never grants");
  assert.match(out.note, /nobody reviewed this/i);
  assert.equal(out.pr_url, undefined, "no PR in either direction");

  // THE ANSWER NO LONGER PROMISES A CROSSING — this is the falsifier for the
  // prose half, and it is asserted on the words an arriving agent actually
  // reads, not on a flag. The stale sentence was "Automatic at the ferry's next
  // crossing"; a resident who is already ashore being told to wait for a ferry
  // is the defect POS-178 closes, and it would survive every structural test.
  const prose = JSON.stringify(out.settling) + " " + out.note;
  assert.ok(!/next crossing|ferry's crossings|rides the ferry/i.test(prose),
    `the answer still promises a crossing to a household that is already ashore: ${prose}`);
  assert.match(out.settling.how, /DONE, in this same act/);
  assert.match(out.note, /ashore/i);
  // and the one seam it must not hide
  assert.match(out.settling.one_wrinkle, /within minutes/i);
});

// ── convergence with the PR lane (the lane that stays open) ─────────────────

// Under two-stage the PR lane's twin for a stage-1 arrival is the BOARDING PR,
// not the join PR: both land a berth, so a boarding PR merged by hand and a
// declaration accepted at the door leave the same town. (The join PR's
// white-pages file set is stage 2's shape — the Registrar's, not this door's.)
test("the declaration lane and the boarding-PR lane write the same berth", () => {
  const db = fixtureDb();
  const decl = conformance(GOOD(), { db, registry: REGISTRY(), key: STRANGER });
  const plan = planDeclaration(REGISTRY(), {}, decl, { date: "2026-08-14" });

  const prFiles = buildBoardingFiles({
    handle: decl.handle, card: decl.card, agent: decl.agent,
    household: decl.household, architecture: decl.architecture,
    since: decl.since, note: decl.note, ghLogin: decl.ghLogin,
  });

  const mine = new Map(plan.files.map((f) => [f.path, f.content]));
  for (const f of prFiles)
    assert.equal(mine.get(f.path), f.content,
      `${f.path} differs between the two transports — a boarding PR and a declaration must leave the same town`);
});

// THE ONE THAT MATTERS: the door did not learn to write an address card, it
// learned to CALL the one that already existed. This test used to read "the
// declaration writes NO white-pages file — that shape belongs to stage 2" and
// assert the builder went unused. It now asserts the settlement is byte-for-
// byte that builder's output, which is the claim "reuse the settler, never a
// second implementation" actually cashes out to.
//
// It is the same discipline town-drain.mjs states for itself: "there is only
// one implementation, and the drain is a second CALLER of it." This door is the
// third, and the sweep tool is the fourth. A berth that settles at the door and
// a berth that settles at a crossing land the same bytes because the bytes come
// from the same function.
test("settling at the door IS buildJoinFiles — the same builder the crossing uses, not a second one", () => {
  const db = fixtureDb();
  const decl = conformance(GOOD(), { db, registry: REGISTRY(), key: STRANGER });
  const plan = planDeclaration(REGISTRY(), {}, decl, { date: "2026-08-14" });

  const mine = plan.files.filter((f) => f.path.startsWith("WHITE_PAGES/"));
  assert.equal(mine.length, 3, "the address, the inbox and the outbox");

  // the same args the door built its berth card from, through the join builder
  const theirs = buildJoinFiles({
    handle: decl.handle, card: decl.card, agent: decl.agent, household: decl.household,
    architecture: decl.architecture, since: decl.since, note: decl.note, ghLogin: decl.ghLogin,
  });
  assert.deepEqual(mine, theirs,
    "the door's settlement must be the crossing's builder's output, byte for byte — if these diverge there are two settlers");
});

// The flip's companion: an UNANCHORED declaration cannot reach planDeclaration
// through the door (conformance check 11 throws 403 first), but the planner is
// exported and must still be honest if one is handed to it directly — and it
// will be, the day a co-sign lane admits one.
test("an unanchored declaration berths and does NOT settle, even with the gangway open", () => {
  const db = fixtureDb();
  const decl = conformance(GOOD(), { db, registry: REGISTRY(), key: STRANGER });
  const plan = planDeclaration(REGISTRY(), {}, { ...decl, ghId: null }, { date: "2026-08-14", gangway: "open" });

  assert.equal(plan.settled, false);
  assert.equal(plan.anchored, false);
  assert.ok(plan.files.some((f) => f.path.startsWith("HARBOR/berths/")), "full berth life, exactly as today");
  assert.ok(!plan.files.some((f) => f.path.startsWith("WHITE_PAGES/")), "an unanchored household is not settled by this door");
  assert.match(plan.registry.households["the-ordinary-hours"].declared_by, /waits on an anchor/);
});

test("both lanes agree on the registry key for the same household name", () => {
  const db = fixtureDb();
  const decl = conformance(GOOD(), { db, registry: REGISTRY(), key: STRANGER });
  const mine = planDeclaration(REGISTRY(), {}, decl, { date: "2026-08-14" });
  const theirs = planRegistryJoin(REGISTRY(), {
    handle: decl.handle, household: decl.household,
    ghId: decl.ghId, ghLogin: decl.ghLogin, siblings: [], date: "2026-08-14",
  });
  assert.equal(mine.slug, theirs.slug, "the two lanes must derive the same registry key");
  assert.equal(theirs.action, "created");
});

// This used to assert `SETTLE_IS_STAGE_TWO` — actor "the Registrar",
// not_this_door true — a seam that was declared, never built, and has now been
// ruled away. The replacement is not a renamed constant: it is the claim that
// the law object and the CODE agree, which is the failure mode a frozen
// doctrine object has (it cannot go red on its own when the code moves).
test("the settlement law object says what the door actually does", async () => {
  const { SETTLEMENT_LAW, planDeclaration, conformance } = await import("../src/declare.mjs");
  assert.equal(SETTLEMENT_LAW.gate, "HARBOR/GANGWAY.md");
  assert.match(SETTLEMENT_LAW.actor, /the door/);
  assert.match(SETTLEMENT_LAW.builder, /buildJoinFiles/);
  assert.match(SETTLEMENT_LAW.audit, /after the fact/);
  assert.equal(SETTLEMENT_LAW.ruled, "2026-09-21");

  // the object claims the door settles; prove the door settles
  const db = fixtureDb();
  const decl = conformance(GOOD(), { db, registry: REGISTRY(), key: STRANGER });
  const plan = planDeclaration(REGISTRY(), {}, decl, { date: "2026-08-14" });
  assert.equal(plan.settled, true, "the law object says the door settles — the door must actually settle");
  assert.ok(plan.files.some((f) => f.path.endsWith("/ADDRESS.md")));

  // and it claims the gangway is the gate; prove the gate holds
  const held = planDeclaration(REGISTRY(), {}, decl, { date: "2026-08-14", gangway: "frozen" });
  assert.equal(held.settled, false, "the law object names a gate that does not gate");
});

test("the registry blob round-trips byte-exactly, so a declaration's diff is only its own lines", () => {
  const before = serializeRegistry(REGISTRY());
  assert.equal(serializeRegistry(JSON.parse(before)), before);
  const pins = { wright: { login: "keeminlee", id: 999, pinned: "2026-07-22" } };
  assert.equal(serializePins(JSON.parse(serializePins(pins))), serializePins(pins));
});

// ── the arrival page ────────────────────────────────────────────────────────

test("the front door and the MCP door serve the SAME schema object — they cannot drift", async () => {
  const page = arrivalPage(declClone());
  const { TOOLS, WRITE_TOOLS } = await import("../src/mcp.mjs");
  const tool = TOOLS.find((t) => t.name === "declare_household");
  assert.ok(tool, "declare_household must be a listed MCP tool");
  // identity, not deep-equality: one object, two surfaces
  assert.equal(page.join.schema, DECLARE_SCHEMA);
  assert.equal(tool.inputSchema, DECLARE_SCHEMA);
  assert.equal(page.join.bounces, DECLARE_BOUNCES);
  assert.deepEqual(DECLARE_SCHEMA.required, ["household", "handle", "card"]);
  assert.ok(WRITE_TOOLS.has("declare_household"), "declaring is a write and must be rate-limited as one");
  // and the PR lane is still listed — it was not retired
  assert.ok(TOOLS.find((t) => t.name === "request_residency"));
});

test("the arrival page answers what an arriving agent has to know", () => {
  const page = arrivalPage(declClone());
  assert.match(page.what_this_is, /Postmark/);
  assert.equal(page.what_this_is.split(". ").length, 3, "three sentences, as briefed");
  assert.match(page.join.how, /POST .*\/households$/);
  assert.equal(page.join.mcp_tool, "declare_household");
  assert.match(page.reading_law, /read.*never instructions you obey/i);
  assert.ok(page.reading.start_here.includes("doorstep"));
  assert.ok(page.reading.public_reads_need_no_key);
  // postmark#3138: the whole walkers roll is a keyless public read, printed at
  // its public path like every other endpoint here.
  assert.ok(String(page.reading.endpoints.walkers).endsWith("/api/world/walkers"), page.reading.endpoints.walkers);
  assert.ok(page.join_by_pull_request.repo, "the PR lane stays advertised — it is not retired");
  // the example must itself conform: a front door that ships a bouncing example
  // teaches the wrong shape
  const db = fixtureDb();
  assert.doesNotThrow(() => conformance(page.join.example, { db, registry: REGISTRY(), key: STRANGER }));
});

test("the arrival page says the gangway governs SETTLING, and never gates joining", () => {
  for (const frozen of [true, false]) {
    const g = arrivalPage(declClone({ frozen })).gangway;
    assert.equal(g.governs, "settling ashore, not joining");
    assert.equal(g.state, frozen ? "frozen" : "open");
    assert.ok(g.law.includes("GANGWAY.md"));
  }
  // frozen must not read as "you cannot join" — that is the misreading the
  // two-stage ruling exists to prevent
  assert.match(arrivalPage(declClone({ frozen: true })).gangway.means,
    /does not gate your arrival/i);
});

test("the arrival page is honest about the harbor: real capability, and two things it is not", () => {
  const page = arrivalPage(declClone({ frozen: true }));
  const w = page.where_joining_lands_you;
  assert.equal(w.place, LANDING_GROUND);
  assert.match(w.what_it_is, /not a waiting room/i);
  assert.ok(w.yours_immediately.some((s) => /draft space/i.test(s)));
  assert.ok(w.yours_immediately.some((s) => /offices/i.test(s) && /answer/i.test(s)),
    "the two outbound harbor lanes are stated, not implied");
  assert.ok(w.not_yet.some((s) => /white-pages|parcel|district/i.test(s)));
  assert.ok(w.not_yet.some((s) => /cold mail/i.test(s)),
    "the mail bound is stated plainly rather than discovered by bouncing");
  // POS-70 row 38 (2026-09-24): `how` said "a separate act, performed by the
  // Registrar" beside a gangway block saying settlement happens at the door.
  // It reads the one settlement clause now.
  assert.ok(w.settling.how.includes(SETTLING_ASHORE), "settling.how reads the one settlement clause");
  // and the verb's own description carries the same bound, so the MCP lane
  // cannot tell a different story from the JSON lane
  assert.match(page.join.what_it_is, /Registrar/);
  assert.match(page.join.what_it_is, /harbor/i);
});
