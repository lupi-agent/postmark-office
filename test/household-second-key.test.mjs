// household-second-key.test.mjs — THE SECOND KEY, falsified.
//
//   node --test test/household-second-key.test.mjs
//
// WHAT IS BEING FALSIFIED. `WORLD/households.json`'s `logins` map is what the
// Settlement sweep's authorship wall and the PR lane's lane-wall resolve a
// sketchbook's NAME through. Until 2026-09-09 it bound exactly two things — a
// pin's GitHub login, and a `login:`-keyed household's own name — so a household
// of any other shape was invisible to the wall.
//
// AND INVISIBLE IS THE DANGEROUS WORD. The sweep's own rule is that a branch it
// cannot bind is LEFT ALONE rather than refused: "unverifiable is the status
// quo, never a new refusal (registry lag must not strand the pen's own writes)"
// (`settlement-sweep.mjs:905-919`). So an unbindable household is not a refusal
// anybody sees. It is every mark in that household publishing with its
// authorship unchecked while every test stays green. That is the same silence
// `store-writedown.mjs` exists to keep a RENAME from causing, arriving from the
// registry's own side instead.
//
// Measured against the live town, 2026-09-09: 108 distinct household keys, of
// which SEVEN — every `hh:<house>` key the town has minted — were bound by
// nothing. Three of them own standing marks.
//
// THE TESTS THAT MATTER MOST ARE H4 AND H5, and neither has a live instance
// today. Both are the ways this projection could bind a sketchbook to the WRONG
// household, which is strictly worse than leaving it unbound: an unbound branch
// makes the wall stand down, a mis-bound one makes it wall the wrong marks. Zero
// occurrences is exactly when a guard is cheap to write and impossible to test
// later.
//
// The write-down side of the same change is F10 in test/store-writedown.test.mjs,
// where F6b and F6e stand as its unchanged control.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  handsByKey, loginHands, loginKeys, sketchbookKeys, sketchbookNameForKey,
} from "../src/household-logins.mjs";
import { sketchbookNameFor } from "../src/store-writedown.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OFFICE = resolve(HERE, "..");

const scratch = mkdtempSync(join(tmpdir(), "postmark-second-key-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true }); } catch { /* litter */ } });

const PINS = { "aion-solare": { login: "aionsolare", id: 293432145 } };
// EVERY SHAPE, AND ONE OF THEM CARRIES A DOT ON PURPOSE. `hh:cadaeic.space` is a
// live key in the town today, and a dot is the one character in a legal branch
// component that a re-implementation is most likely to "clean up". Without a
// dotted key in this fixture, H7's flip — a second resolver in the projection —
// runs green, because every other key spells the same both ways. Found by
// running that flip: the check could not fail on the drift it names.
const HOUSEHOLDS = {
  "aion-solare": "gh:293432145",       // pinned: a login already binds it
  "ev-attractor": "solo:ev-attractor", // a WHITE_PAGES room with no ADDRESS github
  argos: "hh:argos-and-prometheus",    // a house key from the stamp ledger
  vertas: "hh:argos-and-prometheus",   // ... which two handles share
  arky: "hh:cadaeic.space",            // ... and a live house key with a DOT in it
};

const project = (households = HOUSEHOLDS, pins = PINS) => {
  const { logins } = loginKeys(pins, households);
  return { logins, ...sketchbookKeys(households, logins) };
};

// ── H1 · END TO END, THROUGH THE TOOL THAT ACTUALLY WRITES THE FILE ──────────
//
// The projection is only worth anything if the EMITTED file carries it, and the
// merge order in the tool is the load-bearing half: additions go UNDER the real
// logins, so a second key can never answer a question the town's pins already
// answered. Asserting the projection alone would leave that line untested.
//
// The town is a stub `stamp-mint.mjs` exporting `currentHouseholds`, which is
// the injection the module's own header blesses: "an engine is injected — so a
// falsifier hands in a fixture engine rather than a real town".

function fixtureTown(label, { households = HOUSEHOLDS, pins = PINS } = {}) {
  const repo = join(scratch, label);
  mkdirSync(join(repo, "tools"), { recursive: true });
  const entries = Object.entries(households).map(([h, key]) => `["${h}", { key: ${JSON.stringify(key)} }]`);
  writeFileSync(join(repo, "tools", "stamp-mint.mjs"),
    `export function currentHouseholds() { return new Map([${entries.join(", ")}]); }\n`);
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify(pins));
  return repo;
}

function runExport(label, opts) {
  const town = fixtureTown(`${label}-town`, opts);
  const world = join(scratch, `${label}-world`);
  mkdirSync(join(world, "WORLD"), { recursive: true });
  const out = execFileSync(process.execPath,
    [join(OFFICE, "tools", "world-households-export.mjs"), "--town", town, "--world", world],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { out, emitted: JSON.parse(readFileSync(join(world, "WORLD", "households.json"), "utf8")) };
}

test("H1 · the emitted registry binds a household of EVERY shape the town can mint", () => {
  const { emitted } = runExport("h1");

  assert.equal(emitted.logins.aionsolare, "gh:293432145",
    "the pin's own binding is untouched — this projection adds to the map, it never answers over it");
  assert.equal(emitted.logins["ev-attractor"], "solo:ev-attractor",
    "draft/ev-attractor now resolves to the household it belongs to; before this it resolved to nothing");
  assert.equal(emitted.logins["argos-and-prometheus"], "hh:argos-and-prometheus",
    "and a house key is bound once, under the house's name, not once per handle in it");
  assert.equal(emitted.logins["cadaeic.space"], "hh:cadaeic.space",
    "a dot is legal in a branch component and the name is taken as it stands — nothing is cleaned up");

  // THE CONJUNCTION. The sweep walls a mark only when the branch AND the author
  // both resolve (settlement-sweep.mjs:1123-1128), so an emitted map that binds
  // a branch whose author side is null has fixed nothing.
  for (const [name, key] of Object.entries(emitted.logins)) {
    const carried = Object.values(emitted.households).includes(key);
    assert.ok(carried, `logins["${name}"] binds ${key}, which no handle in the same file carries`);
  }

  assert.match(emitted.logins_note, /NOT only GitHub logins/,
    "the file says why a non-login string is a key in a map called logins — the next reader is not this lane");
});

test("H2 · THE MONEY MAP DOES NOT MOVE — loginKeys and the card rail gain nothing", () => {
  // `loginKeys` is also the Stripe attribution map (tools/stripe-watch.mjs
  // resolveHand, through loginHands), where a new key is a new way for a typed
  // string to become somebody's hand. The second keys are composed onto the
  // EXPORTED map in tools/world-households-export.mjs and nowhere else, so this
  // change must be invisible to that surface.
  const { logins, additions } = project();
  assert.deepEqual(Object.keys(logins).sort(), ["aionsolare"],
    "loginKeys still binds exactly the pins' logins and the login: households");
  for (const name of Object.keys(additions))
    assert.ok(!Object.prototype.hasOwnProperty.call(logins, name),
      `${name} leaked into loginKeys' own output, which is a money surface`);

  const rail = loginHands(new Map(Object.entries(HOUSEHOLDS).map(([h, key]) => [h, { key }])), PINS);
  assert.deepEqual([...rail.keys()].sort(), ["aionsolare"],
    "the card rail resolves exactly the logins it resolved yesterday");
  assert.deepEqual(handsByKey(HOUSEHOLDS).get("hh:argos-and-prometheus"), ["argos", "vertas"],
    "and the hands projection is unchanged, which is what the rail asks about a house");
});

test("H3 · idempotent — a second pass over the merged map plants nothing", () => {
  // The export re-runs on pin churn. A projection that grows every run is a
  // projection nobody can diff, and the diff is how a person reviews this file.
  const first = project();
  const merged = { ...first.additions, ...first.logins };
  const second = sketchbookKeys(HOUSEHOLDS, merged);
  assert.deepEqual(second.additions, {}, "every key it would bind is already bound");
  assert.deepEqual(second.collisions, [], "and it does not report its own first pass as a collision");

  const a = runExport("h3a").emitted.logins;
  const b = runExport("h3b").emitted.logins;
  assert.deepEqual(a, b, "two runs of the tool over the same town emit the same map");
});

// ── H4 and H5 · THE TWO WAYS THIS COULD BIND THE WRONG HOUSEHOLD ─────────────
//
// Both refuse rather than pick a winner, which is the same principle as the
// write-down's `household-key-ambiguous` refusal (F6d): naming a sketchbook
// after one of two candidates would tell the wall that one household's marks
// belong to the other, and the wall would then act on it.

test("H4 · a name a real login already holds is LEFT ALONE and said out loud", () => {
  const households = { ...HOUSEHOLDS, someone: "hh:aionsolare" };
  const { logins, additions, collisions } = project(households);
  assert.equal(logins.aionsolare, "gh:293432145", "the pin still owns the name");
  assert.ok(!Object.prototype.hasOwnProperty.call(additions, "aionsolare"),
    "the house key did NOT take a name the town pinned to a different household");
  const c = collisions.find((x) => x.name === "aionsolare");
  assert.ok(c, "and it is reported rather than silently dropped");
  assert.deepEqual(c.keys, ["hh:aionsolare"]);
  assert.equal(c.holds, "gh:293432145", "the report names what already holds the name");

  const { out } = runExport("h4", { households });
  assert.equal(JSON.parse(readFileSync(join(scratch, "h4-world", "WORLD", "households.json"), "utf8"))
    .logins.aionsolare, "gh:293432145", "and the emitted file keeps the pin's answer");
  assert.match(out, /1 key\(s\) LEFT UNBINDABLE/, "the run says a key was left unbindable");
});

test("H5 · a name TWO unbound keys want is planted for NEITHER", () => {
  const households = { a: "solo:zeno", b: "hh:zeno" };
  const { additions, collisions } = project(households, {});
  assert.deepEqual(additions, {}, "picking either would put one household's sketchbook under the other's wall");
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].name, "zeno");
  assert.deepEqual(collisions[0].keys, ["hh:zeno", "solo:zeno"], "both are named, so a person can fix the town");
  assert.equal(collisions[0].holds, null, "nothing held the name — this is two claimants, not a takeover");
});

test("H6 · a key with no legal branch component is reported, never invented around", () => {
  const households = { crook: "hh:../escape", ok: "solo:fine" };
  const { additions, unnameable } = project(households, {});
  assert.deepEqual(Object.keys(additions), ["fine"], "the nameable one is still bound");
  assert.equal(unnameable.length, 1);
  assert.equal(unnameable[0].key, "hh:../escape");
  assert.equal(unnameable[0].reason, "unnameable");
});

test("H7 · ONE RESOLVER — the name the map binds IS the branch the write-down opens", () => {
  // The way this change fails silently is two spellings: the map binds a branch
  // nobody opens while the branch that IS opened stays unbindable, and the fix
  // reads as done while changing nothing. There is one function, and this reads
  // it from BOTH sides — the projection's planted key, and the write-down's own
  // refusing wrapper — for every shape the town can mint.
  const { logins, additions } = project();
  const merged = { ...additions, ...logins };
  for (const [name, key] of Object.entries(merged)) {
    assert.equal(sketchbookNameFor(key, { logins: merged }).toLowerCase(), name,
      `the write-down opens draft/${sketchbookNameFor(key, { logins: merged })} for ${key}, `
      + `but the map binds "${name}" — the wall would read a branch nobody wrote`);
  }
  assert.equal(sketchbookNameForKey("gh:999999", merged).name, "gh-999999",
    "and a gh: key no login binds still gets the id, never a name belonging to someone else");
});

test("H8 · EVERY SKETCHBOOK NAME IS ONE GIT ACCEPTS (the 2026-10-06 06:00Z refusal)", async () => {
  // The settlement was refused at `git branch -qf draft/victor-b.-rose-e.`: a
  // household slug with a trailing dot passed the old pattern, and git refused
  // the branch. The resolver now hands back a name git takes, the same every time.
  const { execFileSync } = await import("node:child_process");
  const gitAccepts = (n) => { try { execFileSync("git", ["check-ref-format", "--branch", `draft/${n}`], { stdio: "ignore" }); return true; } catch { return false; } };
  const cases = {
    "hh:victor-b.-rose-e.": "victor-b.-rose-e",
    "hh:house-nessova.": "house-nessova",
    "hh:cadaeic.space": "cadaeic.space",
    "hh:two..dots": "two.dots",
    "hh:a-house.lock": "a-house-lock",
    "solo:ev-attractor": "ev-attractor",
  };
  for (const [key, want] of Object.entries(cases)) {
    const { name, reason } = sketchbookNameForKey(key, {});
    assert.equal(reason, null, `${key} must be nameable`);
    assert.equal(name, want, `${key} → ${name}`);
    assert.ok(gitAccepts(name), `git refuses draft/${name} (from ${key})`);
  }
  assert.equal(sketchbookNameForKey("hh:victor-b.-rose-e.", {}).name, sketchbookNameForKey("hh:victor-b.-rose-e.", {}).name,
    "the same key always names the same sketchbook");
});
