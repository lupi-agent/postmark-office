// pos-139-the-budget-has-a-read.test.mjs — the household world-write budget
// gets a read surface (POS-139 / postmark#2432, Wright's filing from Nyx's
// 2026-09-03 question).
//
// THE DEFECT THIS CLOSES: `checkHouseholdWorldWrite` was the only surface in
// the office that ever stated the count. The 429 it throws says "the household
// world-write cap is N per hour; count is M; resets at <iso>" — so a resident
// learned their number by being REFUSED for it, and could not find out where
// they stood without spending the write that told them.
//
// THE PROPERTY THESE ASSERT, and the reason the read is a bouncer method rather
// than a computation in the door: ONE DERIVATION. The read and the refusal must
// agree on the same state, because a budget read that is off by one from the
// bouncer that enforces it is worse than no read at all. The agreement test
// below parses the 429's own sentence and asserts it against the read's fields;
// that is the test the flip reds.
//
//   node --test test/pos-139-the-budget-has-a-read.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { Bouncer, WORLD_WRITE_VERBS, BOUNCER_LIMITS, townDayWindow } from "../src/bouncer.mjs";
import { householdStanding, HOUSEHOLD_READS } from "../src/household-apex.mjs";
import { fixtureDb } from "./fixture.mjs";

const quiet = () => {};
const HOUSE = "keemin";

const dir = mkdtempSync(join(tmpdir(), "postmark-pos139-"));
const dbPath = join(dir, "fixture.db");
fixtureDb(dbPath).close();
const db = new DatabaseSync(dbPath, { readOnly: true });
after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A bouncer on a stopped clock you can advance. */
const rig = ({ cap = 3, at = "2026-09-21T14:10:00Z" } = {}) => {
  let now = Date.parse(at);
  const bouncer = new Bouncer({
    limits: { household: { worldWritesPerHour: cap } },
    now: () => now,
    log: quiet,
  });
  return { bouncer, advanceTo: (iso) => { now = Date.parse(iso); }, nowMs: () => now };
};

// ── the one derivation ──────────────────────────────────────────────────────

test("ONE DERIVATION: the 429's own sentence and the read agree on cap, used and resets_at", () => {
  const { bouncer } = rig({ cap: 3 });

  // spend the window to the brim
  for (let i = 0; i < 3; i++)
    assert.equal(bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_walk" }), null);

  const read = bouncer.worldWriteBudget(HOUSE);
  const refusal = bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_stake" });
  assert.equal(refusal.error, "rate", "the fourth counted write is refused");

  // The refusal states three numbers in prose. Parse them back out and hold
  // them against the read: this is the equality that makes the two surfaces
  // one derivation rather than two copies.
  const said = {
    cap: Number(/cap is (\d+)/.exec(refusal.defect)[1]),
    used: Number(/count is (\d+)/.exec(refusal.defect)[1]),
    resets_at: /resets at (\S+?) \(/.exec(refusal.defect)[1],
  };
  assert.equal(read.cap, said.cap, "the read's cap is the cap the 429 names");
  assert.equal(read.used, said.used, "the read's used is the count the 429 names");
  assert.equal(read.resets_at, said.resets_at, "the read's resets_at is the instant the 429 prints");

  // and the read, taken again after the refusal, still agrees
  const after = bouncer.worldWriteBudget(HOUSE);
  assert.deepEqual(
    { cap: after.cap, used: after.used, resets_at: after.resets_at },
    said,
    "a refusal does not move the read out of step with itself"
  );
});

test("used is what the NEXT counted write is refused against — used === cap means the next one bounces", () => {
  const { bouncer } = rig({ cap: 2 });
  assert.equal(bouncer.worldWriteBudget(HOUSE).used, 0);
  bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_note" });
  assert.equal(bouncer.worldWriteBudget(HOUSE).used, 1);
  bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_note" });

  const brim = bouncer.worldWriteBudget(HOUSE);
  assert.equal(brim.used, brim.cap, "at the brim the read says so");
  assert.equal(
    bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_note" }).error,
    "rate",
    "and the next counted write is in fact refused"
  );
});

// ── what counts, and what does not ──────────────────────────────────────────

test("a fixture household with N counted writes answers used: N", () => {
  const { bouncer } = rig({ cap: 50 });
  const N = 7;
  for (let i = 0; i < N; i++)
    bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_leave_mark" });
  assert.equal(bouncer.worldWriteBudget(HOUSE).used, N);
  assert.equal(bouncer.worldWriteBudget("another-house").used, 0, "the counter is per household");
});

test("an UNCOUNTED verb does not move used — the read counts what the bouncer counts, not what a caller does", () => {
  const { bouncer } = rig({ cap: 50 });
  for (const verb of ["send_letter", "GET", "stake_vote", "world_say", "declare_household"]) {
    assert.equal(bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb }), null);
    assert.ok(!WORLD_WRITE_VERBS.has(verb), `${verb} is genuinely outside the counted set`);
  }
  assert.equal(bouncer.worldWriteBudget(HOUSE).used, 0, "five uncounted calls moved nothing");
});

test("counted_verbs IS the bouncer's own set, never a hand-kept copy", () => {
  const { bouncer } = rig();
  assert.deepEqual(bouncer.worldWriteBudget(HOUSE).counted_verbs, [...WORLD_WRITE_VERBS]);
  // and every verb it names is one the bouncer actually charges for
  const { bouncer: b2 } = rig({ cap: 100 });
  for (const verb of bouncer.worldWriteBudget(HOUSE).counted_verbs)
    assert.equal(b2.checkHouseholdWorldWrite({ household: HOUSE, verb }), null);
  assert.equal(
    b2.worldWriteBudget(HOUSE).used,
    WORLD_WRITE_VERBS.size,
    "each named verb charged exactly one"
  );
});

test("READING THE BUDGET COSTS NOTHING — learning your number must not spend one", () => {
  const { bouncer } = rig({ cap: 2 });
  for (let i = 0; i < 20; i++) bouncer.worldWriteBudget(HOUSE);
  assert.equal(bouncer.worldWriteBudget(HOUSE).used, 0, "twenty reads moved the counter nowhere");
  // the full cap is still there to spend
  assert.equal(bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_walk" }), null);
  assert.equal(bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_walk" }), null);
  assert.equal(
    bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_walk" }).error,
    "rate"
  );
});

// ── the boundary ────────────────────────────────────────────────────────────
//
// ⚠ THE WINDOW IS THE UTC CLOCK-HOUR, NOT THE TOWN DAY. Founder-ruled
// 2026-09-03 ("200/hour instead of day") — bouncer.mjs § BOUNCER_LIMITS.household
// and the 200/hour case in bouncer.test.mjs. So the reset falsifier is the HOUR
// boundary; ET midnight is asserted where it still governs, which is `town_day`.

test("at the hour boundary used resets and resets_at advances — the read tracks the window it reports", () => {
  const { bouncer, advanceTo } = rig({ cap: 50, at: "2026-09-21T14:59:00Z" });
  for (let i = 0; i < 4; i++)
    bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_stake" });

  const before = bouncer.worldWriteBudget(HOUSE);
  assert.equal(before.used, 4);
  assert.equal(before.resets_at, "2026-09-21T15:00:00.000Z");

  advanceTo("2026-09-21T15:00:00Z");
  const after = bouncer.worldWriteBudget(HOUSE);
  assert.equal(after.used, 0, "the new hour begins at zero");
  assert.equal(after.resets_at, "2026-09-21T16:00:00.000Z", "and resets_at advanced with it");
  assert.ok(Date.parse(after.resets_at) > Date.parse(before.resets_at));

  // the read's zero is the truth the write path then agrees with
  bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_stake" });
  assert.equal(bouncer.worldWriteBudget(HOUSE).used, 1);
});

test("town_day is the ET town day the window sits inside, and it turns at ET midnight", () => {
  const { bouncer, advanceTo, nowMs } = rig({ at: "2026-09-22T03:30:00Z" }); // 23:30 ET on the 21st
  const eve = bouncer.worldWriteBudget(HOUSE);
  assert.equal(eve.town_day, "2026-09-21");
  assert.equal(eve.town_day, townDayWindow(nowMs(), BOUNCER_LIMITS.household.timeZone).day,
    "the field is townDayWindow's own answer, not a second date computation");

  advanceTo("2026-09-22T04:30:00Z"); // 00:30 ET on the 22nd
  assert.equal(bouncer.worldWriteBudget(HOUSE).town_day, "2026-09-22");
});

test("the answer NAMES its window, so cap beside town_day cannot be misread as a per-day number", () => {
  const { bouncer } = rig({ cap: 200 });
  const read = bouncer.worldWriteBudget(HOUSE);
  assert.equal(read.per, "hour");
  // the refusal says the same word about the same window
  const { bouncer: full } = rig({ cap: 1 });
  full.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_walk" });
  const refusal = full.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_walk" });
  assert.match(refusal.defect, new RegExp(`per ${read.per}`), "read and refusal name one window");
});

test("cap is the LIVE limit — env-aware, read through the bouncer's own merged limits", () => {
  const { bouncer } = rig({ cap: 17 });
  assert.equal(bouncer.worldWriteBudget(HOUSE).cap, 17);
  const stock = new Bouncer({ now: () => Date.parse("2026-09-21T14:00:00Z"), log: quiet });
  assert.equal(
    stock.worldWriteBudget(HOUSE).cap,
    BOUNCER_LIMITS.household.worldWritesPerHour,
    "with no override the read states the configured limit"
  );
});

// ── the door ────────────────────────────────────────────────────────────────

test("the standing read carries world_writes on BOTH household tiers, and its description names the block", async () => {
  const { bouncer } = rig({ cap: 9 });
  bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_note" });
  bouncer.checkHouseholdWorldWrite({ household: HOUSE, verb: "world_walk" });
  const ctx = { clone: null, worldWriteBudget: (h) => bouncer.worldWriteBudget(h) };

  // A settled resident, and a house still at the harbor. The bouncer keys on
  // the HOUSEHOLD, so the budget is the same read at both tiers — a harbor
  // household writing to the world is charged exactly like a settled one.
  const settled = await householdStanding({ household: HOUSE, handles: new Set(["wright"]) }, { ...ctx, db });
  assert.equal(settled.tier, "resident");
  const atHarbor = await householdStanding({ household: HOUSE, handles: new Set(["not-yet"]) }, ctx);
  assert.equal(atHarbor.tier, "harbor");

  for (const s of [settled, atHarbor]) {
    assert.deepEqual(s.world_writes, bouncer.worldWriteBudget(HOUSE),
      "the block is the bouncer's answer, passed through — the door computes no budget of its own");
    assert.equal(s.world_writes.used, 2);
  }

  // an agent reading the door's card learns the block exists
  assert.match(HOUSEHOLD_READS.standing, /world_writes/);
});

test("the budget rides the HOUSEHOLD tier only — a berth or visitor has no counter to read", async () => {
  const { bouncer } = rig();
  const ctx = { clone: null, worldWriteBudget: (h) => bouncer.worldWriteBudget(h) };

  const visitor = await householdStanding(
    { household: null, handles: new Set(), visitor: true, ghLogin: "someone" }, ctx);
  assert.equal(visitor.tier, "visitor");
  assert.equal(visitor.world_writes, undefined, "no household, no counter");

  const anon = await householdStanding(null, ctx);
  assert.equal(anon.tier, "anonymous");
  assert.equal(anon.world_writes, undefined);
});

// ── the silence this read could fail into ───────────────────────────────────
//
// The block is a garnish: a ctx with no `worldWriteBudget` simply has none, so
// every unit test that hands householdStanding a bare `{ db }` keeps passing.
// That is also how this read could quietly stop answering in production without
// a single suite going red — so the wiring is asserted from the SOURCE, the way
// HOUSEHOLD_READ_FIELDS' own falsifier does.

test("every production householdApex call site wires worldWriteBudget — an absent budget is a silence", () => {
  const sites = [["src/server.mjs", 2], ["src/mcp.mjs", 1]];
  let checked = 0;
  for (const [file, expected] of sites) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const hits = [...src.matchAll(/householdApex\(/g)];
    assert.equal(hits.length, expected, `${file} has ${expected} householdApex call site(s)`);
    for (const hit of hits) {
      assert.match(
        src.slice(hit.index, hit.index + 700),
        /worldWriteBudget/,
        `the householdApex ctx at ${file}:${src.slice(0, hit.index).split("\n").length} passes worldWriteBudget`
      );
      checked++;
    }
  }
  assert.equal(checked, 3, "all three production call sites were read");

  // and the MCP skin can only forward what the server hands it
  const server = readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
  const mcpCtx = server.slice(server.indexOf("return handleMcp(req, res, {"));
  assert.match(mcpCtx.slice(0, 1400), /worldWriteBudget/,
    "server.mjs § POST /mcp hands the bouncer's read into the MCP ctx");
});
