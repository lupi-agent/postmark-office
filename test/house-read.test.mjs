// house-read.test.mjs — POS-276: the house in one answer, and what waits on it.
//
// The household page read one doorstep per resident. These are the two reads
// that replace that, and the claims this file holds are the ones a reader
// moving over depends on:
//
//   1. A resident's blocks under residents[<h>] ARE the doorstep's, under the
//      doorstep's names — deep-equal, not lookalikes.
//   2. The town-wide blocks ride once, at the top, and on no resident.
//   3. The owner-only blocks ride a key that holds THAT resident and no other
//      (the doorstep's own gate, doorstep-bundle.mjs § ownerGate).
//   4. The world's three (stances, outcomes, stakes) and the walkers roll are
//      asked ONCE for the house.
//   5. An outcome's `at` is ISO, and the events are in instant order.
//   6. needs-you is the house's own, and every row names its cause.
//
//   node --test test/house-read.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { doorstep } from "../src/queries.mjs";
import { doorstepBundle } from "../src/doorstep-bundle.mjs";
import { appendTownJournal } from "../src/town-journal.mjs";
import { houseBundle, needsYou, isoAt, isoEvents, HOUSE_ONCE } from "../src/house-bundle.mjs";
import { householdApex, HOUSEHOLD_READS, HOUSEHOLD_READ_FIELDS } from "../src/household-apex.mjs";

const AS_OF = "housefixture0000000000000000000000000000";
const HOUSE = "fixture-house";
const MEMBERS = ["r000", "r001", "r002", "r-harbor"];

function houseDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const put = db.prepare("INSERT INTO meta VALUES (?, ?)");
  put.run("as_of", AS_OF);
  put.run("town_path", "fixture");
  put.run("hydrated_counts", JSON.stringify({}));
  const insR = db.prepare("INSERT INTO residents VALUES (?, ?)");
  for (const [i, h] of ["r000", "r001", "r002", "r-stranger"].entries()) {
    insR.run(h, JSON.stringify({ handle: h, is_office: false, last_active: `2026-09-2${i}T10:00:00.000Z`,
      address: { data: { since: "2026-01-01", joined: `2026-06-1${i}` } },
      window_state: { hand_set: "2026-08-24", sections: [{ title: "what I need", body: `pane of ${h}` }] } }));
  }
  const insL = db.prepare("INSERT INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < 4; i++) {
    const id = `r001-2026-07-0${i + 1}-to-r000-n${i}`;
    insL.run(id, "r001", "r000", `2026-07-0${i + 1}`, null, "inbox", "r000",
      `WHITE_PAGES/r000/inbox/${i}.md`, JSON.stringify({ id, from: "r001", to: "r000", body: `# letter ${i}` }), `2026-07-0${i + 1}T08:00:00.000Z`);
  }
  const insB = db.prepare("INSERT INTO bulletin VALUES (?, ?)");
  for (let i = 0; i < 4; i++) insB.run(`2026-07-0${i + 1}-n${i}`, JSON.stringify({ slug: `2026-07-0${i + 1}-n${i}`, data: { title: `notice ${i}` }, body: "# notice" }));
  db.prepare("INSERT INTO ledger (kind, date, id, from_h, to_h, json) VALUES (?,?,?,?,?,?)").run("delivery", "2026-07-04", "l0", "r001", "r000", null);
  db.prepare("INSERT INTO stamps VALUES (?,?,?,?)").run("r000", 12, 30, 3);
  db.prepare("INSERT INTO mail_state VALUES (?, ?)").run("r000", JSON.stringify({
    handle: "r000", language: "sequence, never debt", conversations: [],
    unplaced_bounces: [{ date: "2026-06-16", path: "WHITE_PAGES/r000/outbox/x.md", reason: "no resident \"nobody\"" }],
    summary: { they_spoke_last: 0, new_inbound: 0, they_spoke_again: 0, reply_queued: 0, last_word_yours: 0, bounced: 1 },
  }));
  return db;
}

const db = houseDb();
const scratch = mkdtempSync(join(tmpdir(), "postmark-house-"));
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
mkdirSync(join(scratch, "tools"), { recursive: true });
writeFileSync(join(scratch, "tools", "households.json"), JSON.stringify({ households: {
  [HOUSE]: { name: "Fixture", human: "FIX", accounts: [{ login: "fixture", id: 1 }], residents: MEMBERS },
  other: { name: "Other", human: "OTH", accounts: [{ login: "other", id: 2 }], residents: ["r-stranger"] },
} }));
const meta = { as_of: AS_OF, quest_registry: JSON.stringify({ quests: [] }) };
const NOW = Date.parse("2026-09-27T06:00:00Z");

/** Every world reader, counted, so "asked once" is a number and not a hope. */
function worldReaders() {
  const calls = { stances: [], stakesFor: [], walkers: 0, claimEffects: [] };
  return {
    calls,
    readers: {
      stances: async (handles, opts) => { calls.stances.push([...handles]);
        return { stances_awaiting: 1, awaiting: [{ mark: "r-stranger/fence", by: "r-stranger", on_your_ground: ["r000/garden"] }],
          standing: [], cursor: null, complete: true, set_downs_awaiting: [], teach: { same: "for everyone" }, limit: opts.limit }; },
      stakesFor: async (handles) => { calls.stakesFor.push([...handles]);
        return { next_settlement: { at: "2026-09-28T00:00:00.000Z" }, count: 2, at_risk: 1,
          rows: [{ mark: "r001/shed", class: "commons", escrow: 0, at_risk: true, act: 'world { do: "stake" }' },
                 { mark: "r000/garden", class: "commons", escrow: 3, at_risk: false }] }; },
      walkers: async () => { calls.walkers += 1;
        return { at: 190.5, walkers: [{ handle: "r000", x: 10, y: -4, mark_id: "the-town/quay", moving: false, toward: null }] }; },
      // The store's own shape on prod: `decided_at` comes back a Date, and
      // claim-effects String()ed it until 2026-09-27; the Date is kept here so isoAt still proves it takes one.
      claimEffects: async (args) => { calls.claimEffects.push(args);
        return { readable: true, store: "docket", events: [
          { kind: "claim-locked", mark: "r000/garden", at: String(new Date("2026-09-26T12:05:00Z")), crossing: 190 },
          { kind: "claim-refused", mark: "r001/shed", at: String(new Date("2026-09-25T23:00:00Z")), crossing: 189, cause: "unbacked" },
        ] }; },
    },
  };
}

const ctx = (over = {}) => ({ db, key: null, meta, asOf: AS_OF, clone: scratch, odb: null, nowMs: NOW, ...over });

test("THE HOUSE: residents ashore, one answer, the harbor named rather than dropped", async () => {
  const { readers } = worldReaders();
  const h = await houseBundle({ household: HOUSE }, ctx({ readers }));
  assert.equal(h.read, "house");
  assert.equal(h.household, HOUSE);
  assert.deepEqual(h.ashore, ["r000", "r001", "r002"]);
  assert.deepEqual(h.not_ashore, ["r-harbor"]);
  assert.deepEqual(Object.keys(h.residents), ["r000", "r001", "r002"]);
  assert.match(h.members_from, /tools\/households\.json/);
});

test("THE DOORSTEP'S NAMES: each resident's segments deep-equal the doorstep's, key for key", async () => {
  const { readers } = worldReaders();
  const h = await houseBundle({ household: HOUSE }, ctx({ readers }));
  for (const who of h.ashore) {
    const d = doorstep(db, who, AS_OF, { fresh: { odb: null, clone: scratch, asOf: AS_OF }, nowMs: NOW });
    for (const k of ["mail", "awaiting", "stamps", "window", "pending_outbox", "counts"])
      assert.deepEqual(h.residents[who][k], d[k], `${who}.${k} is the doorstep's own ${k}`);
    assert.equal(h.residents[who].window.handle ?? who, who);
  }
});

test("ONCE: the town-wide blocks ride at the top and on no resident", async () => {
  const { readers } = worldReaders();
  const h = await houseBundle({ household: HOUSE }, ctx({ readers }));
  const d = doorstep(db, "r000", AS_OF, { fresh: { odb: null, clone: scratch, asOf: AS_OF }, nowMs: NOW });
  for (const k of HOUSE_ONCE) {
    assert.deepEqual(h[k], d[k], `${k} at the top is the doorstep's`);
    for (const who of h.ashore) assert.ok(!(k in h.residents[who]), `${k} is not repeated on ${who}`);
  }
  for (const who of h.ashore) for (const k of ["the_bundle", "segments", "moved", "doorstep_version", "as_of"])
    assert.ok(!(k in h.residents[who]), `${who} carries no page manifest (${k})`);
});

test("ASKED ONCE: stances, stakes and the walkers roll are one call each for the whole house", async () => {
  const { readers, calls } = worldReaders();
  const h = await houseBundle({ household: HOUSE }, ctx({ readers }));
  assert.deepEqual(calls.stances, [["r000", "r001", "r002"]]);
  assert.deepEqual(calls.stakesFor, [["r000", "r001", "r002"]]);
  assert.equal(calls.walkers, 1);
  assert.equal(calls.claimEffects.length, 1);
  // The outcomes' ground is the stances answer this read already held.
  assert.deepEqual([...calls.claimEffects[0].onMyGround], ["r-stranger/fence"]);
  assert.deepEqual(h.residents.r000.stands, { x: 10, y: -4, mark_id: "the-town/quay", moving: false, toward: null });
  assert.equal(h.residents.r001.stands, null);
  assert.equal(h.residents.r000.last_active, "2026-09-20T10:00:00.000Z");
});

test("ISO: an outcome's `at` is ISO whatever the store handed back, and the events run in instant order", async () => {
  assert.equal(isoAt(new Date("2026-09-26T12:05:00Z")), "2026-09-26T12:05:00.000Z");
  assert.equal(isoAt(String(new Date("2026-09-26T12:05:00Z"))), "2026-09-26T12:05:00.000Z");
  assert.equal(isoAt("2026-09-26T12:05:00.000Z"), "2026-09-26T12:05:00.000Z");
  assert.equal(isoAt(null), null);
  const { readers } = worldReaders();
  const h = await houseBundle({ household: HOUSE }, ctx({ readers }));
  assert.deepEqual(h.outcomes.events.map((e) => [e.mark, e.at]),
    [["r001/shed", "2026-09-25T23:00:00.000Z"], ["r000/garden", "2026-09-26T12:05:00.000Z"]]);
  // The fixture's pair sorts right by weekday name too ("Fri" < "Sat"), so the
  // trap is pinned on its own: a Monday after a Saturday.
  const trap = isoEvents([{ mark: "b", at: String(new Date("2026-09-28T00:00:00Z")) }, { mark: "a", at: String(new Date("2026-09-26T00:00:00Z")) }]);
  assert.deepEqual(trap.map((e) => e.mark), ["a", "b"], "Mon the 28th sorts after Sat the 26th");
});

// ── the ownership gate ──────────────────────────────────────────────────────

async function mailOdb() {
  const o = new DatabaseSync(":memory:");
  o.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  await appendTownJournal(o, { cls: "letter", act: "send-letter", household: "fixture", handle: "r000",
    payload: { args: { from: "r000", to: "r001", title: "standing", body: "not sailed" },
      id: "r000-2026-09-26-to-r001-standing", file: "WHITE_PAGES/r000/outbox/standing.md" } });
  return o;
}

test("THE GATE: a key holding r000 adds r000's owner-only blocks — the doorstep's own — and r001's page stays public", async () => {
  const odb = await mailOdb();
  process.env.TOWN_SINGLE_LOG = "1";
  try {
    const key = { household: "fixture", handles: new Set(["r000"]) };
    const { readers } = worldReaders();
    const h = await houseBundle({ household: HOUSE }, ctx({ readers, key, odb }));
    const d = await doorstepBundle("r000", { db, key, meta, asOf: AS_OF, clone: scratch, odb, nowMs: NOW });
    assert.ok(h.residents.r000.your_pending_letters, "the sender's own unsailed letter rides their own resident");
    assert.deepEqual(h.residents.r000.your_pending_letters, d.your_pending_letters);
    assert.equal(h.residents.r000.pending_outbox, d.pending_outbox);
    assert.deepEqual(h.residents.r000.pending_outbox_freshness, d.pending_outbox_freshness);
    assert.ok(!("your_pending_letters" in h.residents.r001), "a housemate the key does not hold reads public");
    const anon = await houseBundle({ household: HOUSE }, ctx({ readers, odb }));
    assert.ok(!("your_pending_letters" in anon.residents.r000), "no key, no owner-only block");
  } finally { delete process.env.TOWN_SINGLE_LOG; odb.close(); }
});

// ── needs-you ───────────────────────────────────────────────────────────────

test("NEEDS-YOU: the house's own — no key is 401, a stranger's key is 403", async () => {
  const { readers } = worldReaders();
  assert.equal((await needsYou({ household: HOUSE }, ctx({ readers }))).refused[0], 401);
  const stranger = { household: "other", handles: new Set(["r-stranger"]) };
  assert.equal((await needsYou({ household: HOUSE }, ctx({ readers, key: stranger }))).refused[0], 403);
});

test("NEEDS-YOU: every row names its cause, and a key ask never carries its co-sign link", async () => {
  const { readers } = worldReaders();
  readers.claimState = (_odb, h) => (h === "r001" ? { handle: h, cosigned: false, asks_standing: 1 } : null);
  const key = { household: "fixture", handles: new Set(["r000", "r001"]) };
  const n = await needsYou({}, ctx({ readers, key }));
  assert.equal(n.household, HOUSE, "the house the key holds, with no slug named");
  assert.deepEqual(n.residents, ["r000", "r001"]);
  assert.equal(n.stances_awaiting.rows.length, 1);
  assert.equal(n.unplaced_bounces.rows.length, 1);
  assert.equal(n.unplaced_bounces.rows[0].handle, "r000");
  assert.equal(n.key_asks.rows.length, 1);
  assert.equal(n.key_asks.rows[0].cosign_link, null);
  assert.equal(n.stakes_at_risk.rows.length, 1);
  assert.equal(n.stakes_at_risk.rows[0].mark, "r001/shed");
  assert.equal(n.count, 4);
  for (const group of ["stances_awaiting", "unplaced_bounces", "key_asks", "stakes_at_risk"])
    for (const row of n[group].rows) assert.ok(typeof row.cause === "string" && row.cause.length > 10, `${group} row names its cause`);
});

// ── the door ────────────────────────────────────────────────────────────────

test("THE DOOR: both reads are on the household door's list, declare their field, and refuse an unknown one", async () => {
  assert.ok(HOUSEHOLD_READS.house && HOUSEHOLD_READS["needs-you"]);
  assert.deepEqual(Object.keys(HOUSEHOLD_READ_FIELDS.house), ["household"]);
  const bad = await householdApex({ read: "house", args: { household: HOUSE, bogus: 1 } }, null,
    { db, clone: scratch, meta, asOf: AS_OF, strictFields: true });
  assert.equal(bad.code, 422);
  const none = await householdApex({ read: "house", household: "no-such-house" }, null, { db, clone: scratch, meta, asOf: AS_OF });
  assert.equal(none.code, 404);
  const anon = await householdApex({ read: "needs-you" }, null, { db, clone: scratch, meta, asOf: AS_OF });
  assert.equal(anon.code, 401);
});

test("NO DOCKET IS SAID: an office with no docket store does not pass off its zero as the docket's", async () => {
  const { readers } = worldReaders();
  readers.claimEffects = async () => ({ readable: true, events: [], store: "none" });
  const h = await houseBundle({ household: HOUSE }, ctx({ readers }));
  assert.equal(h.outcomes.count, 0);
  assert.equal(h.outcomes.store, "none");
  assert.match(h.outcomes.note, /no docket store/);
});
