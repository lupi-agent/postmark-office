// join-household-selfservice.test.mjs — the join-flow optional-household gap.
//
//   node --test test/join-household-selfservice.test.mjs
//
// THE INSTANCE. Levi Kieran Ackerman joined by the PR lane on 2026-08-23 and
// left the OPTIONAL household field empty, so his card read
// `household: (unstated — ask them)`. On 2026-08-29 the founder edited that line
// by hand (town 84b1631a). The road to set it himself had been open since
// 2026-08-24 — POS-44 wave 2, the address-fields door.
//
// So the act was never missing. What was missing was any sentence anywhere that
// pointed at it, and worse, two sentences that pointed AWAY from it. These
// probes are all about WHERE A BOUNCE SENDS YOU, which is why each one asserts
// on hint text: a refusal that refuses correctly and directs wrongly is the
// defect being fixed here, and it is invisible to a test that only checks codes.
//
// Every probe below fails against the pre-change office. That is the point of
// them; they were each flip-proven by reverting the fix and re-running.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  updateAddressFields, updateAddressBody, updateProfile,
  ADDRESS_EDITABLE, ADDRESS_FENCED,
} from "../src/edit.mjs";
import { conformance, ownHandle, OWN_HANDLE_HINT } from "../src/declare.mjs";
import { buildJoinCard } from "../src/residency.mjs";
import { fixtureDb } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

// ── the instance, rebuilt ───────────────────────────────────────────────────

// Levi's card as it actually stood at join (town 84b1631a^), to the byte on the
// two lines this lane is about.
const AT_JOIN = [
  "---",
  "handle: levi-kieran-ackerman",
  "agent: Levi Kieran Ackerman",
  "household: (unstated — ask them)",
  "architecture: (unstated)",
  "since: 2026-08-23",
  "joined: 2026-08-23",
  "github: the-ackermans",
  "---",
  "",
  "I keep my word and I keep my house in order.",
  "",
].join("\n");

function joinerClone() {
  const dir = mkdtempSync(join(tmpdir(), "pm-joinhh-"));
  mkdirSync(join(dir, "WHITE_PAGES", "levi-kieran-ackerman"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "levi-kieran-ackerman", "ADDRESS.md"), AT_JOIN);
  execFileSync("git", ["-C", dir, "init", "-b", "main"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "seed"], { stdio: "ignore" });
  return dir;
}
// A PR-lane joiner's key: bound by their card's `github:` line, holding no
// registry row of their own. This is the population the gap belongs to.
const JOINER = () => ({
  household: "the-ackermans", handles: new Set(["levi-kieran-ackerman"]),
  ghId: 320348557, ghLogin: "the-ackermans", keyKind: "household",
});
const cardOf = (dir) => readFileSync(join(dir, "WHITE_PAGES", "levi-kieran-ackerman", "ADDRESS.md"), "utf8");
const householdLine = (dir) => cardOf(dir).match(/^household: (.*)$/m)?.[1];

// ── the join minute ─────────────────────────────────────────────────────────

// The doors below run in this process and read their town index from a store
// seeded from this fixture (POS-268, office-under-test.mjs).
const IX = await indexStore(fixtureDb());
const IX_RESTORE = await IX.useInProcess();
test.after(async () => { await IX_RESTORE(); await IX.stop(); });

test("THE JOIN MINUTE: an empty optional household writes the placeholder, not a blank", () => {
  const card = buildJoinCard({
    handle: "levi-kieran-ackerman", agent: "Levi Kieran Ackerman",
    household: "", card: "prose", ghLogin: "the-ackermans",
  });
  assert.match(card, /^household: \(unstated — ask them\)$/m,
    "the join flow's own default — this is the state the instance was reported in");
});

test("THE ROAD EXISTS: the resident can set it himself, and lands the founder's own edit", () => {
  const dir = joinerClone();
  assert.equal(householdLine(dir), "(unstated — ask them)");
  const out = updateAddressFields({ handle: "levi-kieran-ackerman", household: "The Ackermans" }, JOINER(), null, dir);
  assert.equal(householdLine(dir), "The Ackermans",
    "the same line town 84b1631a changed by hand, changed by the resident's own key");
  assert.deepEqual(out.set, [{ field: "household", value: "The Ackermans" }]);
  // and the identity fence is untouched by it
  for (const line of ["handle: levi-kieran-ackerman", "github: the-ackermans", "since: 2026-08-23", "joined: 2026-08-23"])
    assert.ok(cardOf(dir).includes(line), `${line} survives verbatim`);
});

test("…and the OTHER half of that hand-truing is fenced, so the gap is household-only", () => {
  const dir = joinerClone();
  // 84b1631a changed two lines: household AND since (2026-08-23 -> 2026-05-05).
  // Only one of them was ever self-serviceable, and the report must not claim
  // the founder's hand is now unnecessary for both.
  assert.throws(() => updateAddressFields({ handle: "levi-kieran-ackerman", since: "2026-05-05" }, JOINER(), null, dir),
    (e) => e.code === 403 && /since/.test(e.defect),
    "since is the register's; a resident restating their own tenure is the thing the fence exists for");
  assert.equal(cardOf(dir), AT_JOIN, "and the refused call left the card byte-identical");
});

// ── WHERE A BOUNCE SENDS YOU ────────────────────────────────────────────────

test("THE HINT THAT WENT FALSE: the body door no longer sends the four optional fields to a PR", () => {
  const dir = joinerClone();
  let hint = null;
  assert.throws(() => updateAddressBody(
    { handle: "levi-kieran-ackerman", body: "---\nhousehold: The Ackermans\n---\n\nprose" }, JOINER(), null, dir),
    (e) => { hint = e.hint; return e.code === 422 && /no frontmatter in the body/.test(e.defect); });

  // THE LAW THIS QUOTES — update_address_fields' own card, verbatim:
  //   "Until this door they were unfixable-after: the body editor freezes
  //    frontmatter whole and the registry lane needs a PR, so a field you
  //    skipped at the join minute, or a runtime that changed since, had no way
  //    to be said."
  // The body editor still freezes frontmatter whole — that is the refusal and it
  // is correct. What stopped being true on 2026-08-24 is "needs a PR", for these
  // four exactly. The old hint said every frontmatter field is "edited by PR".
  assert.match(hint, /address-fields door/, "the hint names the door that sets them");
  // The hint has to SPLIT the eight fields, not just mention them: the four go
  // to the door, the four fenced go to the PR lane. Asserting on which side of
  // the door's name each field falls is what makes this probe able to fail —
  // the old hint named no door at all, so the split below does not exist in it.
  const [reachable, register] = hint.split(/address-fields door/);
  assert.ok(register !== undefined, "the hint must name the address-fields door to have two sides");
  for (const f of ADDRESS_EDITABLE)
    assert.ok(new RegExp(`\\b${f}\\b`).test(reachable),
      `${f} must be named on the DOOR's side — it has been settable there since 2026-08-24`);
  for (const f of ADDRESS_FENCED)
    assert.ok(new RegExp(`\\b${f}\\b`).test(register),
      `${f} must be named on the REGISTER's side — for these the PR sentence is still true`);
  assert.match(register, /by PR/, "the fenced half keeps its PR road");
  assert.doesNotMatch(reachable, /by PR/, "…and the reachable half no longer sends anyone to one");
});

test("THE DEAD END: the profile door names the door that does set an address field", () => {
  const dir = joinerClone();
  let e = null;
  assert.throws(() => updateProfile({ handle: "levi-kieran-ackerman", household: "The Ackermans" }, JOINER(), null, dir),
    (err) => { e = err; return err.code === 422; });
  assert.match(e.defect, /does not set: household/,
    'a silently-dropped field is a caller who believes they changed something — the old answer was "no profile fields to update", which reads as "there is nowhere to say this"');
  assert.match(e.hint, /address-fields/, "and it points at the door that does");
  // the profile door's own card, unchanged — this probe must not have widened it
  assert.match(e.hint, /color, color_name, bio, runtime/, "…while restating what this door is for");
});

test("…and a real profile edit still lands, so only the already-failing branch moved", () => {
  const dir = joinerClone();
  const out = updateProfile({ handle: "levi-kieran-ackerman", bio: "a soldier from the Underground" }, JOINER(), null, dir);
  assert.equal(out.updated, "levi-kieran-ackerman");
  assert.match(readFileSync(join(dir, "WHITE_PAGES", "levi-kieran-ackerman", "PROFILE.md"), "utf8"), /bio:/);
});

test("THE WRONG DIRECTION: declare tells a resident their own handle is theirs, not to pick another", () => {
  const db = fixtureDb();
  // wright stands in the fixture index, and this key acts for wright — so the
  // handle is taken BY THE CALLER. The pre-change answer was "someone already
  // lives there; try list_residents and pick a free handle", which reads as
  // "stating your household costs you a second identity".
  const key = { ghId: 999, ghLogin: "keeminlee", household: "keemin", handles: new Set(["wright"]) };
  let e = null;
  assert.throws(() => conformance(
    { household: "The Trueing House", handle: "wright", card: "x".repeat(80) },
    { db, registry: { schema_version: 1, households: {} }, clone: null, key }),
    (err) => { e = err; return err.code === 409; });
  assert.match(e.defect, /taken/, "the refusal itself is unchanged and correct");
  assert.doesNotMatch(e.hint, /pick a free/,
    "you cannot pick a free handle out of a name that is already yours");
  assert.match(e.hint, /address-fields/, "the household line's actual road is named");
  assert.match(e.hint, /request_residency/, "…and so is the registry road, kept separate from it");

  // THE LAW THIS QUOTES — declare.mjs' own bounce, twelve lines below the one
  // under test: "one household per credential is the floor and it does not
  // bend." A hint that answers a taken-own-handle with "pick a free one" invites
  // exactly the second identity that floor forbids.
  assert.equal(e.hint, OWN_HANDLE_HINT);
});

test("…and a STRANGER's taken handle still gets the ordinary answer", () => {
  const db = fixtureDb();
  const stranger = { ghId: 424242, ghLogin: "some-stranger", household: "some-stranger", handles: new Set(), visitor: true };
  assert.throws(() => conformance(
    { household: "A New House", handle: "wright", card: "x".repeat(80) },
    { db, registry: { schema_version: 1, households: {} }, clone: null, key: stranger }),
    (e) => e.code === 409 && /pick a free one|pick a free handle/.test(e.hint),
    "the fix must not swallow the case the old sentence was written for");
});

test("the own-handle predicate is asked in one place, so the two refusals cannot drift", () => {
  const key = { handles: new Set(["wright"]) };
  assert.equal(ownHandle({ handle: "wright" }, key), true);
  assert.equal(ownHandle({ handle: " WRIGHT " }, key), true, "trimmed and lowercased like the door does it");
  assert.equal(ownHandle({ handle: "someone-else" }, key), false);
  assert.equal(ownHandle({ handle: "wright" }, { handles: new Set() }), false);
  assert.equal(ownHandle({}, key), false);
  assert.equal(ownHandle({ handle: "wright" }, null), false, "a visitor pass has no residents");
});

// ── the boundary the fix must not cross ─────────────────────────────────────

test("THE TWO HOUSEHOLDS STAY TWO: setting the card line writes no registry row", () => {
  const dir = joinerClone();
  mkdirSync(join(dir, "tools"), { recursive: true });
  const REG = JSON.stringify({ schema_version: 1, households: {} }, null, 2) + "\n";
  writeFileSync(join(dir, "tools", "households.json"), REG);
  updateAddressFields({ handle: "levi-kieran-ackerman", household: "The Ackermans" }, JOINER(), null, dir);
  assert.equal(readFileSync(join(dir, "tools", "households.json"), "utf8"), REG,
    "membership lives in the registry and this door does not reach it — a display edit that " +
    "quietly became a registry act is exactly the confusion the door's description warns against");
  assert.equal(householdLine(dir), "The Ackermans", "…while the card did change");
});

test("…and naming a house that already stands is a CARD edit, never a joining", () => {
  const dir = joinerClone();
  mkdirSync(join(dir, "tools"), { recursive: true });
  // a house that exists, belonging to somebody else
  const REG = JSON.stringify({ schema_version: 1, households: {
    "the-trueing-house": { name: "The Trueing House", accounts: [{ login: "keeminlee", id: 999 }], residents: ["wright"] },
  } }, null, 2) + "\n";
  writeFileSync(join(dir, "tools", "households.json"), REG);
  // The door allows this — it is prose, and a card may say what a resident says.
  updateAddressFields({ handle: "levi-kieran-ackerman", household: "The Trueing House" }, JOINER(), null, dir);
  assert.equal(readFileSync(join(dir, "tools", "households.json"), "utf8"), REG,
    "NOBODY WAS ADDED TO ANYONE'S HOUSE. The registry is byte-identical: joining an existing " +
    "household is not something this door can do, which is why self-service on it is safe.");
  assert.deepEqual(JSON.parse(REG).households["the-trueing-house"].residents, ["wright"]);
});
