// registry-backfill.test.mjs — EVERY HOUSEHOLD IN THE ROLL GETS ONE ROW (POS-159).
//
// RULED (Keemin, 2026-09-22): a house that never declared gets a PROVISIONAL key
// from its FIRST resident's HANDLE, and chooses its real one ONCE at its human's
// first co-sign — the old key kept in `formerly`, `provisional` false, immutable
// from then on like everyone else's.
//
// ── THE PROBE THAT CANNOT FAIL, NAMED FIRST ─────────────────────────────────
//
// Measured on the town's roll today (origin/main 1cd13ff57): 188 residents, and
// EVERY ONE of them already holds a row. So the plan on the real roll is EMPTY,
// and an assertion that the plan matches the finding is an assertion a planner
// which does nothing at all would also pass. It is kept — pinned to the measured
// count AND to the measured roads, so a roll that grows a provisional house reds
// rather than drifts — but it proves nothing about the RULE.
//
// The rule is proven on SYNTHETIC rolls, below: the slug, the name, the first
// resident, the collision fallback, the grouping, the refusals, and the
// idempotence. Each of those probes is shown to be able to fail, by being run
// once in the shape that makes it fail.
//
// ── WHAT IS REAL HERE AND WHAT IS SYNTHETIC ─────────────────────────────────
//
// The REGISTRY is always the town's real 118 houses and 190 pins
// (test/fixtures/registry-2026-09-22/, byte-identical to the town's own two
// files at that tip — `cmp`, this lane, 2026-09-22). The ROLL is real where the
// question is "what does today's town look like" and synthetic where the
// question is "what does the rule do". A synthetic registry would prove the
// planner composes with itself.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  planBackfill, rowForHouse, byJoined, provisionalSlugs, provisionalName,
  BACKFILL_DECLARED_BY,
} from "../src/registry-backfill.mjs";
import { readRoll, frontmatter } from "../tools/registry-backfill.mjs";
import { rowsFromRegistry, renderRegistry, registryFromRows, HOUSEHOLD_KEYS } from "../src/registry-rows.mjs";
import { slugIsWellFormed } from "../src/ceremony.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "fixtures", "registry-2026-09-22");
const HOUSEHOLDS_RAW = readFileSync(join(FIX, "households.json"), "utf8");
const PINS_RAW = readFileSync(join(FIX, "github-ids.json"), "utf8");
const HOUSEHOLDS = JSON.parse(HOUSEHOLDS_RAW);
const PINS = JSON.parse(PINS_RAW);

const ROWS = () => rowsFromRegistry(JSON.parse(HOUSEHOLDS_RAW), JSON.parse(PINS_RAW));

// ── THE REAL ROLL, REBUILT FROM THE REGISTRY ITSELF ─────────────────────────
//
// The town checkout is not on this suite's roster and must not be: a test that
// needs a clone is a test that reds on a box where the clone is stale. So the
// real roll is rebuilt from the registry's own residents and pins — every
// handle the 118 houses list, with the pin that handle holds. That is a roll
// which, by construction, every resident of already has a house, and it is the
// shape today's town measured as.
const rollFromRegistry = () => {
  const out = [];
  for (const [, rec] of Object.entries(HOUSEHOLDS.households)) {
    for (const h of rec.residents ?? []) {
      const pin = PINS[h] ?? null;
      out.push({
        handle: h, agent: h, household: rec.name ?? null, joined: rec.since ?? null,
        pin: pin ? { login: pin.login, id: pin.id } : null,
      });
    }
  }
  return out;
};

// THE MEASUREMENT, ASSERTED RATHER THAN COMPUTED, so a fixture swapped for a
// smaller one cannot quietly make every count below trivially true.
const LIVE = { households: 118, pins: 190, residentsListed: 189 };

test("the fixture is still the town's registry, at the size this lane measured", () => {
  const rows = ROWS();
  assert.equal(rows.households.length, LIVE.households);
  assert.equal(rows.pins.length, LIVE.pins);
  assert.equal(rollFromRegistry().length, LIVE.residentsListed);
});

// ── THE REAL ROLL: THE PLAN IS EMPTY, AND WHY THAT IS THE ANSWER ────────────

test("TODAY: every resident the registry lists already has a row, so the plan is empty", () => {
  const roll = rollFromRegistry();
  const plan = planBackfill(roll, ROWS());

  assert.equal(plan.counts.planned, 0, "0 rows planned — measured 2026-09-22 on town origin/main 1cd13ff57");
  assert.deepEqual(plan.houses, []);
  assert.deepEqual(plan.refusals, []);
  assert.equal(plan.counts.resolved, roll.length, "every one of them resolved");

  // AND THE ROADS, pinned. "0 planned" is the same number whether everybody was
  // found or nobody was looked for, so the count alone is not the measurement.
  const roads = plan.resolved.reduce((a, r) => ({ ...a, [r.road]: (a[r.road] ?? 0) + 1 }), {});
  assert.equal(roads.account + (roads.name ?? 0) + (roads.residents ?? 0), roll.length);
  assert.ok(roads.account > 100, `the account road carries the roll (${roads.account} of ${roll.length})`);
});

test("the real roll's own handles are all lawful keys, so no house would be refused one", () => {
  // The brief's STOP condition, measured: a handle that failed the alphabet
  // could not lend its house a provisional key, and the plan would refuse that
  // house rather than invent one. 0 of 188 fail today (and 0 of the 189 the
  // registry lists), so the guard has nothing to catch.
  const unlawful = rollFromRegistry().map((r) => r.handle).filter((h) => !slugIsWellFormed(h));
  assert.deepEqual(unlawful, [], "no handle on the roll fails the household alphabet");
});

test("THE PROBE CAN FAIL: one resident dropped from the registry and the plan is no longer empty", () => {
  // The falsifier for the falsifier. If this does not red the assertion above,
  // "0 planned" was never a measurement of anything.
  const rows = ROWS();
  const victimSlug = rows.households.find((r) => (r.residents ?? []).length === 1)?.slug;
  assert.ok(victimSlug, "the fixture holds a house of one");
  const victim = rows.households.find((r) => r.slug === victimSlug);
  const handle = victim.residents[0];

  const without = { ...rows, households: rows.households.filter((r) => r.slug !== victimSlug) };
  const roll = rollFromRegistry();
  const plan = planBackfill(roll, without);

  assert.equal(plan.counts.planned, 1, `dropping ${victimSlug} leaves exactly one house unhoused`);
  assert.equal(plan.houses[0].residents.length, 1);
  assert.deepEqual(plan.houses[0].residents, [handle]);
});

// ── THE RULE, ON A SYNTHETIC ROLL ───────────────────────────────────────────

const R = (handle, over = {}) => ({
  handle, agent: handle.replace(/-/g, " "), household: null, joined: "2026-09-01",
  pin: { login: handle + "-gh", id: 900000000 + handle.length }, ...over,
});

test("a house that never declared is keyed by its FIRST resident's handle", () => {
  const roll = [
    R("zebra", { household: "The Quiet House", joined: "2026-09-05" }),
    R("aardvark", { household: "The Quiet House", joined: "2026-08-01" }),
    R("moose", { household: "The Quiet House", joined: "2026-09-09" }),
  ];
  const plan = planBackfill(roll, ROWS());

  assert.equal(plan.counts.planned, 1, "three residents of one house, one row");
  const h = plan.houses[0];
  assert.equal(h.slug, "aardvark", "the EARLIEST joined lends the key, not the first in the list");
  assert.equal(h.firstResident, "aardvark");
  assert.equal(h.name, "aardvark's household");
  assert.equal(h.since, "2026-08-01", "the house's `since` is its first resident's joined date");
  assert.deepEqual(h.residents, ["aardvark", "zebra", "moose"], "residents in joined order");
  assert.equal(h.claimed, "The Quiet House", "the label the cards claimed is carried for the reader");
  assert.equal(h.fallback, false);
});

test("the row it writes is provisional, and provisional is the ONLY thing unusual about it", () => {
  const plan = planBackfill([R("solo", { household: "Solo House" })], ROWS());
  const row = rowForHouse(plan.houses[0]);

  assert.equal(row.provisional, true);
  assert.equal(row.slug, "solo");
  assert.deepEqual(row.formerly, [], "a house that has never been renamed has an empty history");
  assert.deepEqual(row.accounts, [{ login: "solo-gh", id: 900000004 }]);
  assert.deepEqual(row.residents, ["solo"]);
  assert.equal(row.declared_by, BACKFILL_DECLARED_BY);
  assert.equal(row.human, null, "a backfill does not guess a human's name onto a public file");
  assert.equal(row.member_of, null);
  assert.ok(!("ord" in row), "the DATABASE assigns the place; a caller that could choose one is the caller that raced");

  // and every key it carries is one the renderer has a column for
  for (const k of Object.keys(row)) {
    if (k === "slug") continue;
    assert.ok(HOUSEHOLD_KEYS.includes(k), `${k} is in the file's grammar`);
  }
});

test("a card that states NO household is a house of one, and two such cards are TWO houses", () => {
  // Measured on the real roll: two cards state no household line
  // (`elias-returning`, `mojo-dojo-casa-house`). Guessing that two silent
  // residents live together is how a backfill invents a household nobody asked
  // for, so the rule is one house each.
  const plan = planBackfill([R("quiet-one"), R("quiet-two")], ROWS());
  assert.equal(plan.counts.planned, 2);
  assert.deepEqual(plan.houses.map((h) => h.slug).sort(), ["quiet-one", "quiet-two"]);
  for (const h of plan.houses) assert.equal(h.claimed, null);
});

test("one house, spelled two ways on two cards, is still ONE house", () => {
  // The grouping runs the claimed label through the office's OWN slugger, the
  // one `houseForName` uses, so the planner and the reader cannot disagree
  // about what counts as the same house.
  const plan = planBackfill([
    R("first-in", { household: "Sydney Kitts", joined: "2026-08-01" }),
    R("second-in", { household: "sydney-kitts", joined: "2026-08-02" }),
  ], ROWS());
  assert.equal(plan.counts.planned, 1);
  assert.deepEqual(plan.houses[0].residents, ["first-in", "second-in"]);
});

// ── THE COLLISION RULE ──────────────────────────────────────────────────────

// A HANDLE THAT COLLIDES WITH A STANDING SLUG, chosen from the real registry.
//
// It must be a slug that is NOT already a resident handle, or the collision is
// never reached: a resident the registry already lists is resolved by the
// residents road and never planned at all. Measured on the fixture: 115 of the
// 118 slugs are not resident handles, and `fox-hearth` is one of them.
//
// (On today's ACTUAL roll the three handles that hold a slug — `elias-returning`,
// `mari`, `moth` — are all standing residents, so the fallback fires for none of
// them. That is why this probe is built from a real slug and a synthetic
// resident rather than found on the roll.)
const COLLIDING = "fox-hearth";

test("the collision probe's premise is real: that slug stands, and nobody lives under it as a handle", () => {
  assert.ok(HOUSEHOLDS.households[COLLIDING], `${COLLIDING} is a standing slug`);
  const residents = new Set(Object.values(HOUSEHOLDS.households).flatMap((r) => r.residents ?? []));
  assert.ok(!residents.has(COLLIDING), `and ${COLLIDING} is not itself a resident handle`);
  assert.ok(!HOUSEHOLDS.households[COLLIDING + "-household"], "and the fallback is free");
});

test("a handle that already holds a registry slug takes <handle>-household", () => {
  const plan = planBackfill([R(COLLIDING, { household: "A House Named Later" })], ROWS());

  assert.equal(plan.counts.planned, 1);
  assert.equal(plan.houses[0].slug, COLLIDING + "-household");
  assert.equal(plan.houses[0].fallback, true);
  assert.equal(plan.houses[0].provisionalFrom, COLLIDING, "the fallback still records whose handle it came from");
  assert.deepEqual(plan.refusals, []);
});

test("two houses contending for one fallback key do not both take it", () => {
  // A planned slug is not free just because the REGISTRY does not hold it —
  // another house planned in the same breath may have claimed it. The planner
  // walks in a stated order so the answer does not depend on the roll's.
  const roll = [
    R(COLLIDING, { household: "House One" }),
    R(COLLIDING + "-household", { household: "House Two" }),
  ];
  const plan = planBackfill(roll, ROWS());
  const slugs = plan.houses.map((h) => h.slug);
  assert.equal(new Set(slugs).size, slugs.length, "no key is planned twice");
  assert.equal(plan.houses.length + plan.refusals.length, 2, "both houses are accounted for");

  // and the answer does not depend on the order the roll arrived in
  const reversed = planBackfill([...roll].reverse(), ROWS());
  assert.deepEqual(reversed.houses.map((h) => h.slug), slugs);
  assert.deepEqual(reversed.refusals, plan.refusals);
});

test("a house with no key left to borrow is REFUSED, not given a counter", () => {
  const rows = ROWS();
  // make both candidates taken
  const extra = [
    { ...rows.households[0], slug: "borrowed", ord: 900 },
    { ...rows.households[0], slug: "borrowed-household", ord: 901 },
  ];
  const stuffed = { ...rows, households: [...rows.households, ...extra] };
  const plan = planBackfill([R("borrowed", { household: "Nowhere To Go" })], stuffed);

  assert.equal(plan.counts.planned, 0, "nothing is written for it");
  assert.equal(plan.refusals.length, 1);
  assert.match(plan.refusals[0].why, /does not invent a counter/);
  assert.match(plan.refusals[0].house, /Nowhere To Go/);
});

test("a first resident whose handle is not a lawful key REFUSES the house", () => {
  // The STOP the brief asks about, run rather than described. 0 of today's 188
  // handles are in this shape, so the probe is built rather than found — and it
  // shows what would happen on the day one is.
  const plan = planBackfill([R("Not A Handle", { household: "Unkeyable" })], ROWS());
  assert.equal(plan.counts.planned, 0);
  assert.equal(plan.refusals.length, 1);
  assert.match(plan.refusals[0].why, /lawful household key/);
});

// ── IDEMPOTENCE ────────────────────────────────────────────────────────────

test("the plan applied once leaves NOTHING to plan the second time", () => {
  const roll = [
    R("alpha", { household: "New House", joined: "2026-08-01" }),
    R("beta", { household: "New House", joined: "2026-08-02" }),
    R("gamma"),
  ];
  const rows = ROWS();
  const first = planBackfill(roll, rows);
  assert.equal(first.counts.planned, 2);

  // apply it the way `--apply` does: insertHousehold assigns the place
  let ord = Math.max(...rows.households.map((r) => Number(r.ord)));
  const after = {
    ...rows,
    households: [...rows.households, ...first.houses.map((h) => ({ ...rowForHouse(h), ord: ++ord }))],
    pins: [...rows.pins, ...first.houses.flatMap((h) => h.pins.map((p) => ({
      handle: p.handle, login: p.login, gh_id: String(p.gh_id), pinned: p.pinned,
      renamed: null, note: null, retired: null, renamed_to: null,
    })))],
  };

  const second = planBackfill(roll, after);
  assert.equal(second.counts.planned, 0, "a second --apply plans zero");
  assert.deepEqual(second.refusals, []);
  assert.equal(second.counts.resolved, roll.length);
});

test("idempotence does NOT depend on anybody being pinned — the residents list carries it", () => {
  // The reason the planner reads a third road. An unpinned resident is invisible
  // to the account road and to the name road (the backfilled house is named
  // "<agent>'s household", which is not the label their card claims), so without
  // the residents array they would be planned into a new house on every run,
  // forever.
  const roll = [R("unpinned", { household: "Quiet Corner", pin: null })];
  const rows = ROWS();
  const first = planBackfill(roll, rows);
  assert.equal(first.counts.planned, 1);
  assert.deepEqual(first.houses[0].accounts, [], "no account to record");
  assert.deepEqual(first.houses[0].pins, [], "and no pin to add");

  let ord = Math.max(...rows.households.map((r) => Number(r.ord)));
  const after = { ...rows, households: [...rows.households, { ...rowForHouse(first.houses[0]), ord: ord + 1 }] };

  const second = planBackfill(roll, after);
  assert.equal(second.counts.planned, 0);
  assert.equal(second.resolved[0].road, "residents", "found by the house's own residents list");
});

test("a pin the registry already holds is NEVER re-bound by the backfill", () => {
  // `joinHousehold` keeps this rule at the door (§ THE PIN IS NEVER RE-BOUND
  // HERE); a bulk tool that quietly repointed a live resident's GitHub id would
  // be the same defect at 100x.
  //
  // `wesley-seeker` is the one handle in the real fixture that IS pinned and is
  // listed by NO house — measured — so it is the only real resident a plan can
  // reach at all. Every other pinned handle is already somebody's resident and
  // is resolved before the pin question is asked.
  assert.ok(PINS["wesley-seeker"], "wesley-seeker is pinned in the real registry");
  const residents = new Set(Object.values(HOUSEHOLDS.households).flatMap((r) => r.residents ?? []));
  assert.ok(!residents.has("wesley-seeker"), "and no house lists them");

  const plan = planBackfill([
    { handle: "wesley-seeker", agent: "Wesley", household: "A House With No Row", joined: "2026-07-01",
      pin: { login: "someone-else", id: 111222333 } },
  ], ROWS());

  assert.equal(plan.counts.planned, 1, "their claimed house has no row, so a house is planned");
  assert.deepEqual(plan.houses[0].pins, [], "but the standing pin is left exactly as it stands");
  assert.equal(plan.counts.pins, 0);

  // THE PROBE CAN FAIL: the same resident, unpinned in the registry, DOES get a
  // pin planned. Otherwise "no pins" would just mean "the planner writes none".
  const unpinned = { ...ROWS() };
  unpinned.pins = unpinned.pins.filter((p) => p.handle !== "wesley-seeker");
  const second = planBackfill([
    { handle: "wesley-seeker", agent: "Wesley", household: "A House With No Row", joined: "2026-07-01",
      pin: { login: "someone-else", id: 111222333 } },
  ], unpinned);
  assert.equal(second.counts.pins, 1);
  assert.equal(second.houses[0].pins[0].login, "someone-else");
});

// ── THE TOWN'S OWN TWO INVARIANTS ───────────────────────────────────────────
//
// The town's witness re-proves these on the head of any PR touching
// `tools/households.json` (town `tools/witness.mjs` rule 2b, the founder's word
// on PR #2000): ONE HOUSEHOLD PER RESIDENT and ONE PER ACCOUNT ID. The drain
// commits as the office pen rather than through a resident's PR, so the witness
// does not gate it — which is exactly why the planner has to hold the line
// itself rather than rely on being stopped.
//
// It holds by construction: a resident is planned only when NO road finds them
// a house, so neither they nor their account stands in one. This asserts the
// construction rather than trusting it.

const invariants = (rows, houses) => {
  const reg = registryFromRows(rows).households;
  const residents = new Map();
  const accounts = new Map();
  const bad = [];
  const note = (map, key, slug, what) => {
    if (map.has(key)) bad.push(`${what} ${key} is in ${map.get(key)} AND ${slug}`);
    else map.set(key, slug);
  };
  for (const [slug, rec] of Object.entries(reg)) {
    for (const h of rec.residents ?? []) note(residents, h, slug, "resident");
    for (const a of rec.accounts ?? []) note(accounts, String(a.id), slug, "account");
  }
  for (const h of houses) {
    for (const r of h.residents) note(residents, r, h.slug, "resident");
    for (const a of h.accounts) note(accounts, String(a.id), h.slug, "account");
  }
  return bad;
};

test("the real registry already holds both invariants — the check is real before it is used", () => {
  assert.deepEqual(invariants(ROWS(), []), []);
});

test("a plan never puts a resident, or an account, into a second household", () => {
  const roll = [
    R("one", { household: "New House", joined: "2026-08-01" }),
    R("two", { household: "New House", joined: "2026-08-02" }),
    R("three", { household: "Other House" }),
    R("four"),
  ];
  const plan = planBackfill(roll, ROWS());
  assert.equal(plan.counts.planned, 3);
  assert.deepEqual(invariants(ROWS(), plan.houses), [], "119+3 houses, still one per resident and one per account");
});

test("THE INVARIANT CHECK CAN FAIL: two houses holding one resident are named", () => {
  const bad = invariants(ROWS(), [
    { slug: "house-a", residents: ["shared"], accounts: [] },
    { slug: "house-b", residents: ["shared"], accounts: [] },
  ]);
  assert.equal(bad.length, 1);
  assert.match(bad[0], /resident shared is in house-a AND house-b/);
});

// ── THE PARTS, EACH ABLE TO FAIL ────────────────────────────────────────────

test("byJoined puts the earliest first, breaks a tie by handle, and sorts an undated card LAST", () => {
  const order = byJoined([
    { handle: "c", joined: "2026-08-02" },
    { handle: "undated", joined: null },
    { handle: "b", joined: "2026-08-01" },
    { handle: "a", joined: "2026-08-01" },
  ]).map((r) => r.handle);
  assert.deepEqual(order, ["a", "b", "c", "undated"]);
});

test("a house whose ONLY resident has no joined date still gets a key, from that resident", () => {
  const plan = planBackfill([R("dateless", { household: "No Date House", joined: null })], ROWS());
  assert.equal(plan.houses[0].slug, "dateless");
  assert.equal(plan.houses[0].since, null, "and its `since` says so rather than inventing a day");
});

test("the two small rules say what they are, out loud", () => {
  assert.deepEqual(provisionalSlugs("fern"), ["fern", "fern-household"]);
  assert.equal(provisionalName("Fern Hollow", "fern"), "Fern Hollow's household");
  assert.equal(provisionalName(null, "fern"), "fern's household", "a card with no agent name falls back to the handle");
  assert.equal(provisionalName("   ", "fern"), "fern's household", "and so does one with a blank");
});

// ── THE ROLL READER, WHICH IS WHERE THE REAL TRAP LIVED ─────────────────────

const townWith = (cards) => {
  const dir = mkdtempSync(join(tmpdir(), "pos159-"));
  for (const [handle, text] of Object.entries(cards)) {
    mkdirSync(join(dir, "WHITE_PAGES", handle), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", handle, "ADDRESS.md"), text);
  }
  return dir;
};

const CARD = (handle, household, joined) =>
  `---\nhandle: ${handle}\nagent: ${handle} the agent\nhousehold: ${household}\nsince: 2026-01-01\njoined: ${joined}\n---\n\nprose.\n`;

test("A CRLF CARD IS READ, and this is the trap that changed this lane's answer", () => {
  // MEASURED, and it is not hypothetical: `sable`'s blob in the town repo is
  // CRLF, and on Windows EVERY card is CRLF after a checkout, because git
  // applies the line-ending filter on the way out. A frontmatter reader whose
  // value pattern ends in `$` does not match a line carrying a carriage return,
  // so the card reads as stating no household — a silent hole in the roll, in
  // the exact shape this tool exists to count. The first run of this lane's own
  // measurement fell in it.
  const lf = CARD("lf-card", "The House", "2026-08-01");
  const crlf = lf.replace(/\n/g, "\r\n");
  const town = townWith({ "lf-card": lf, "crlf-card": crlf.replace("lf-card", "crlf-card") });

  const read = readRoll(town, {});
  assert.equal(read.crlf, 1, "the reader counts them, so a person can see it happened");
  assert.equal(read.roll.length, 2);
  for (const r of read.roll) {
    assert.equal(r.household, "The House", `${r.handle} states its household`);
    assert.equal(r.joined, "2026-08-01", `${r.handle} states when it joined`);
  }

  // THE PROBE CAN FAIL, and this is the exact shape it failed in. A reader that
  // splits the block on "\n" and matches each line with an unanchored-multiline
  // pattern loses every CRLF line: `.` does not match a carriage return and a
  // bare `$` is the end of the STRING, so the trailing "\r" has nowhere to go.
  const VALUE = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]?(.*)$/;
  const lfLines = lf.split("\n").filter((l) => VALUE.test(l));
  const crlfLines = crlf.split("\n").filter((l) => VALUE.test(l));
  assert.ok(lfLines.length >= 5, "the LF card's lines all match");
  assert.equal(crlfLines.length, 0, "and NOT ONE line of the CRLF card does");

  // the reader's own normalisation is what closes it, and it is one line
  assert.equal(frontmatter(crlf).household, "The House");
});

test("the TEMPLATE is excluded by its own handle line, not by its directory name", () => {
  const template = "---\nhandle: your-handle\nagent: Your Name\nhousehold: Your Human\njoined: 2026-01-01\n---\n";
  const town = townWith({ TEMPLATE: template, real: CARD("real", "A House", "2026-08-01") });
  const read = readRoll(town, {});

  assert.equal(read.carded, 2);
  assert.deepEqual(read.roll.map((r) => r.handle), ["real"]);
  assert.equal(read.skipped.length, 1);
  assert.match(read.skipped[0].why, /the form, not a resident/);
});

test("the DIRECTORY is the address, and a card that disagrees is reported rather than trusted", () => {
  const town = townWith({ "on-disk": CARD("in-the-card", "A House", "2026-08-01") });
  const read = readRoll(town, {});
  assert.deepEqual(read.roll.map((r) => r.handle), ["on-disk"]);
  assert.deepEqual(read.mismatched, [{ handle: "on-disk", says: "in-the-card" }]);
});

test("a card with no frontmatter is skipped BY NAME rather than silently", () => {
  const town = townWith({ broken: "no frontmatter here at all\n", ok: CARD("ok", "A House", "2026-08-01") });
  const read = readRoll(town, {});
  assert.deepEqual(read.roll.map((r) => r.handle), ["ok"]);
  assert.deepEqual(read.skipped, [{ handle: "broken", why: "no frontmatter block" }]);
});

test("the reader carries the pin through, and answers null where there is none", () => {
  const town = townWith({ pinned: CARD("pinned", "A House", "2026-08-01"), bare: CARD("bare", "A House", "2026-08-02") });
  const read = readRoll(town, { pinned: { login: "pinned-gh", id: 4242 } });
  const by = Object.fromEntries(read.roll.map((r) => [r.handle, r]));
  assert.deepEqual(by.pinned.pin, { login: "pinned-gh", id: 4242 });
  assert.equal(by.bare.pin, null);
});

test("frontmatter reads a value containing a colon, which several real cards carry", () => {
  const fm = frontmatter("---\nhandle: x\narchitecture: GPT-5.6 Thinking in ChatGPT; continuity: carried\n---\n");
  assert.equal(fm.architecture, "GPT-5.6 Thinking in ChatGPT; continuity: carried");
});

// ── THE RENDERER: `provisional` IS INVISIBLE UNTIL IT IS TRUE ───────────────

test("today's 118 rows render byte-equal with `provisional` in the template", () => {
  const rows = ROWS();
  assert.ok(rows.households.every((r) => r.provisional === false), "0/118 carry it — measured");
  assert.equal(renderRegistry(rows).households, HOUSEHOLDS_RAW, "not one `provisional` key in the file");
});

test("a TRUE `provisional` DOES render, last, and changes the bytes — the probe can fail", () => {
  const rows = ROWS();
  rows.households[0].provisional = true;
  const out = registryFromRows(rows);
  const rec = out.households[rows.households[0].slug];
  assert.equal(rec.provisional, true);
  assert.equal(Object.keys(rec).at(-1), "provisional", "last, where the template puts it");
  assert.notEqual(renderRegistry(rows).households, HOUSEHOLDS_RAW);
});

test("a provisional house and a renamed one render both tail keys, in template order", () => {
  const rows = ROWS();
  rows.households[0].formerly = ["an-older-key"];
  rows.households[0].provisional = true;
  const keys = Object.keys(registryFromRows(rows).households[rows.households[0].slug]);
  assert.deepEqual(keys.slice(-2), ["formerly", "provisional"]);
});

test("the falsy rule binds ONE column — a false does not silence anything else", () => {
  // Widening it to "drop every falsy" would also drop `"since": ""` and a pin
  // id of 0, which are diffs somebody needs to see.
  const rows = ROWS();
  rows.households[0].since = "";
  const rec = registryFromRows(rows).households[rows.households[0].slug];
  assert.equal(rec.since, "", "an empty `since` still renders");
  assert.ok(!("provisional" in rec), "and a false `provisional` still does not");
});

test("a NULL `provisional` from an older row reads as false, not as a rendered key", () => {
  const rows = ROWS();
  rows.households[0].provisional = null;
  const rec = registryFromRows(rows).households[rows.households[0].slug];
  assert.ok(!("provisional" in rec));
});

test("the fold gives a file with no `provisional` key the column's own default", () => {
  // A NULL reaching `boolean NOT NULL` is a write that fails inside a seed.
  const rows = rowsFromRegistry(JSON.parse(HOUSEHOLDS_RAW), JSON.parse(PINS_RAW));
  assert.ok(rows.households.every((r) => r.provisional === false));
});
