// unread.test.mjs — POS-286: mail gets UNREAD, the way email has it.
//
// The falsifiers the brief names, each on its own test:
//
//   1. a delivered letter is unread (and a letter with no delivery row is not);
//   2. a full read clears it;
//   3. a list read does NOT clear it;
//   4. mark-all-read clears all;
//   5. another household can never see your unread count;
//   6. `new_inbound` still answers, with its pointer.
//
// ⚑ THROUGH A JS STUB OF THE STORE (test/acts-pen-stub.mjs), with 029's row
// policy modelled: a transaction that declared no spelling set holding a row's
// household reads nothing and writes nothing. The stub proves the JS; the
// store half (the table, its grants, its policy) was rehearsed on an embedded
// Postgres, and test/registry-grants.test.mjs reads the migration's text.
//
//   node --test test/unread.test.mjs

import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { letterAnswer, mailAwaiting, NEW_INBOUND_NOTE } from "../src/queries.mjs";
import { doorstepBundle } from "../src/doorstep-bundle.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { unreadFor, UNREAD_LISTED } from "../src/unread-store.mjs";
import { installActsPen, uninstallActsPen, RECORD_ON } from "./acts-pen-stub.mjs";

const AS_OF = "unreadfixture000000000000000000000000000";
// Two households. House A keeps ann and amos; house B keeps bea. With an empty
// registry every handle resolves to `solo:<handle>` (the stub's honest default).
const A = { household: "house-a", handles: new Set(["ann", "amos"]) };
const B = { household: "house-b", handles: new Set(["bea"]) };

const L = (n, from, to, day) => ({ id: `${from}-2026-09-${day}-to-${to}-n${n}`, from, to, date: `2026-09-${day}` });
const TO_ANN = [L(1, "bea", "ann", "20"), L(2, "bea", "ann", "21"), L(3, "bea", "ann", "22")];
const TO_AMOS = [L(4, "bea", "amos", "22")];
const FROM_ANN = [L(5, "ann", "bea", "23")];
// In the index, but the ferry has not delivered it: no delivery row.
const UNDELIVERED = L(6, "bea", "ann", "24");

function fixtureDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const put = db.prepare("INSERT INTO meta VALUES (?, ?)");
  put.run("as_of", AS_OF);
  put.run("town_path", "fixture");
  put.run("hydrated_counts", JSON.stringify({}));
  const insR = db.prepare("INSERT INTO residents VALUES (?, ?)");
  for (const h of ["ann", "amos", "bea"])
    insR.run(h, JSON.stringify({ handle: h, is_office: false, address: { data: { since: "2026-01-01", joined: "2026-06-01" } } }));
  const insL = db.prepare("INSERT INTO letters VALUES (?,?,?,?,?,?,?,?,?,?)");
  const insD = db.prepare("INSERT INTO ledger (kind, date, id, from_h, to_h, json) VALUES ('delivery',?,?,?,?,NULL)");
  for (const l of [...TO_ANN, ...TO_AMOS, ...FROM_ANN, UNDELIVERED]) {
    const at = `${l.date}T12:00:00.000Z`;
    insL.run(l.id, l.from, l.to, l.date, null, "inbox", l.to, `WHITE_PAGES/${l.to}/inbox/${l.id}.md`,
      JSON.stringify({ ...l, body: `# ${l.id}`, delivered_at: at }), at);
    if (l !== UNDELIVERED) insD.run(l.date, l.id, l.from, l.to);
  }
  // The correspondence law's own row, as the town derives it: ann's newest
  // conversation is bea's, so the law calls it new_inbound.
  db.prepare("INSERT INTO mail_state VALUES (?, ?)").run("ann", JSON.stringify({
    handle: "ann", language: "sequence, never debt",
    conversations: [{ conversation: TO_ANN[2].id, attention_state: "new_inbound", next_actor: "you",
      latest_delivered_from: "bea", latest_delivered_id: TO_ANN[2].id, latest_event: { date: "2026-09-22" } }],
    summary: { they_spoke_last: 1, new_inbound: 1, they_spoke_again: 0, reply_queued: 0, last_word_yours: 0, bounced: 0 },
  }));
  return db;
}

// 029's table, in memory, with its row policy. `set_config(..., true)` is
// transaction-local, so the policy reads the spelling set declared after the
// last BEGIN (events.test.mjs § txKeys, the same model).
function opensTable() {
  const rows = new Map();   // "handle\nletter" -> row
  const txKeys = (st) => {
    const begin = st.asked.findLastIndex((q) => /^BEGIN/i.test(q));
    const declared = st.asked.slice(begin + 1).some((q) => /set_config\('app\.household_keys'/i.test(q));
    return declared ? st.householdKeys : [];
  };
  const also = [
    [/^SELECT handle, letter FROM letter_opens WHERE handle = ANY\(\$1\)$/i, (q, p, st) => {
      const keys = txKeys(st);
      const out = [...rows.values()].filter((r) => p[0].includes(r.handle) && keys.includes(r.household))
        .map((r) => ({ handle: r.handle, letter: r.letter }));
      return { rows: out, rowCount: out.length };
    }],
    [/^INSERT INTO letter_opens/i, (q, p, st) => {
      const [handles, letters, household, opened_at, how] = p;
      if (!txKeys(st).includes(household))
        throw new Error('new row violates row-level security policy for table "letter_opens"');
      let n = 0;
      handles.forEach((h, i) => {
        const k = `${h}\n${letters[i]}`;
        if (rows.has(k)) return;   // ON CONFLICT (handle, letter) DO NOTHING
        rows.set(k, { handle: h, letter: letters[i], household, opened_at, how });
        n += 1;
      });
      return { rows: [], rowCount: n };
    }],
  ];
  return { rows, also };
}

let db, opens, pen;
beforeEach(() => {
  process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
  process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
  db = fixtureDb();
  opens = opensTable();
  pen = installActsPen({ also: opens.also });
});
after(() => { uninstallActsPen(); delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

const countOf = async (h) => (await unreadFor(db, [h])).get(h).length;
const ctx = () => ({ db, meta: {}, asOf: AS_OF });

test("1 · a delivered letter is unread, newest first; a letter with no delivery row is not", async () => {
  const rows = (await unreadFor(db, ["ann"])).get("ann");
  assert.deepEqual(rows.map((r) => r.id), [TO_ANN[2].id, TO_ANN[1].id, TO_ANN[0].id]);
  assert.equal(rows.some((r) => r.id === UNDELIVERED.id), false, "unread starts at delivery, never at send");
  assert.equal(await countOf("bea"), 1, "bea's one delivered letter (from ann) is unread to bea");
  assert.equal(rows[0].delivered_at, `${TO_ANN[2].date}T12:00:00.000Z`);
});

test("2 · a full read clears it, for the recipient, and answers the town's bytes", async () => {
  const id = TO_ANN[1].id;
  const got = await householdApex({ read: "letter", args: { id } }, A, ctx());
  assert.deepEqual(got, letterAnswer(db, id), "the household read is still the town's answer");
  assert.equal(await countOf("ann"), 2);
  const row = opens.rows.get(`ann\n${id}`);
  assert.equal(row.how, "read");
  assert.equal(row.household, "solo:ann", "the recipient's household key, as householdKeyFor spells it");
});

test("2b · the sender's full read opens nothing: a letter you wrote was never unread to you", async () => {
  const got = await householdApex({ read: "letter", args: { id: FROM_ANN[0].id } }, A, ctx());
  assert.equal(got.id, FROM_ANN[0].id);
  assert.equal(opens.rows.size, 0);
  assert.equal(await countOf("bea"), 1, "bea has not opened it");
});

test("3 · a list read does NOT clear it: inbox, awaiting, and the doorstep itself", async () => {
  const inbox = await householdApex({ read: "mail", args: { view: "inbox", handle: "ann" } }, A, ctx());
  assert.ok(inbox.letters?.length >= 3, JSON.stringify(inbox).slice(0, 200));
  await householdApex({ read: "mail", args: { view: "awaiting", handle: "ann" } }, A, ctx());
  const d = await doorstepBundle("ann", { db, key: A, meta: {}, asOf: AS_OF });
  assert.equal(d.unread.count, 3);
  assert.equal(opens.rows.size, 0, "no read but a full fetch writes an opening");
  assert.equal(await countOf("ann"), 3);
});

test("4 · mark-all-read clears all, for every resident the key holds; the second is a no-op", async () => {
  await householdApex({ read: "letter", args: { id: TO_ANN[0].id } }, A, ctx());
  const r = await householdApex({ do: "mark-all-read" }, A, ctx());
  assert.equal(r.did, "mark-all-read");
  assert.deepEqual(r.result.marked, { ann: 2, amos: 1 }, JSON.stringify(r).slice(0, 300));
  assert.deepEqual(r.result.unread, { ann: 0, amos: 0 });
  assert.equal(await countOf("ann"), 0);
  assert.equal(await countOf("amos"), 0);
  assert.equal(opens.rows.get(`ann\n${TO_ANN[2].id}`).how, "mark-all-read");
  assert.equal(opens.rows.get(`ann\n${TO_ANN[0].id}`).how, "read", "an opening already made is kept, not overwritten");
  const again = await householdApex({ do: "mark-all-read" }, A, ctx());
  assert.equal(again.result.receipt, "nothing was unread");
  const d = await doorstepBundle("ann", { db, key: A, meta: {}, asOf: AS_OF });
  assert.equal(d.unread.count, 0);
  assert.deepEqual(d.unread.letters, []);
});

test("4b · mark-all-read with handle: narrows to one resident", async () => {
  const r = await householdApex({ do: "mark-all-read", args: { handle: "amos" } }, A, ctx());
  assert.deepEqual(r.result.marked, { amos: 1 });
  assert.equal(await countOf("amos"), 0);
  assert.equal(await countOf("ann"), 3);
});

test("5 · another household never sees your unread count, and cannot clear it", async () => {
  const mine = await doorstepBundle("ann", { db, key: A, meta: {}, asOf: AS_OF });
  assert.equal(mine.unread.count, 3);
  for (const key of [B, null]) {
    const theirs = await doorstepBundle("ann", { db, key, meta: {}, asOf: AS_OF });
    assert.equal("unread" in theirs, false, `a ${key ? "stranger's key" : "keyless read"} was shown ann's unread block`);
    assert.doesNotMatch(JSON.stringify(theirs), /"unread"/);
  }
  // bea SENT these letters; her key reads them in full, and that opens nothing of ann's.
  const bs = await householdApex({ read: "letter", args: { id: TO_ANN[0].id } }, B, ctx());
  assert.equal(bs.id, TO_ANN[0].id);
  assert.equal(await countOf("ann"), 3);
  const refused = await householdApex({ do: "mark-all-read", args: { handle: "ann" } }, B, ctx());
  assert.equal(refused.code, 403, JSON.stringify(refused).slice(0, 200));
  assert.equal(await countOf("ann"), 3);
  // The store half: ann's openings are invisible inside bea's household transaction.
  await householdApex({ read: "letter", args: { id: TO_ANN[0].id } }, A, ctx());
  const { officeWrite } = await import("../src/world2-pen.mjs");
  const seen = await officeWrite(async (c) => (await c.query("SELECT handle, letter FROM letter_opens WHERE handle = ANY($1)", [["ann"]])).rows,
    { household: "solo:bea" });
  assert.deepEqual(seen, [], "the row policy showed another household's openings");
});

test("5b · the house read carries each held resident's unread, asked once per household, and no stranger's", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { houseBundle } = await import("../src/house-bundle.mjs");
  const clone = mkdtempSync(join(tmpdir(), "postmark-unread-"));
  try {
    mkdirSync(join(clone, "tools"), { recursive: true });
    writeFileSync(join(clone, "tools", "households.json"), JSON.stringify({ households: {
      "house-a": { name: "A", human: "A", accounts: [{ login: "a", id: 1 }], residents: ["ann", "amos"] } } }));
    const readers = {
      // The registry is injected: the pen stub answers the registry store with
      // an empty town, which would name no house at all.
      registry: { registry: { households: { "house-a": { name: "A", human: "A", accounts: [{ login: "a", id: 1 }], residents: ["ann", "amos"] } } }, pins: {} },
      stances: async () => ({ stances_awaiting: 0, awaiting: [], standing: [], cursor: null, complete: true }),
      stakesFor: async () => ({ count: 0, at_risk: 0, rows: [] }),
      walkers: async () => ({ at: 1, walkers: [] }),
      claimEffects: async () => ({ readable: true, store: "docket", events: [] }),
    };
    const asked = () => pen.asked().filter((q) => /FROM letter_opens/.test(q)).length;
    for (const [key, shown] of [[A, true], [B, false], [null, false]]) {
      const before = asked();
      const house = await houseBundle({ household: "house-a" }, { db, key, meta: { as_of: AS_OF }, asOf: AS_OF, clone, readers });
      assert.equal(house.refused, undefined, JSON.stringify(house.refused));
      if (shown) {
        assert.equal(house.residents.ann.unread.count, 3);
        assert.equal(house.residents.amos.unread.count, 1);
        assert.equal(asked() - before, 2, "one read per household (solo:ann, solo:amos), however many pages");
      } else {
        assert.doesNotMatch(JSON.stringify(house), /"unread"/, "a key that holds none of the house was shown its unread");
        assert.equal(asked() - before, 0);
      }
    }
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("5c · an unreadable record is said on the doorstep, never a zero", async () => {
  uninstallActsPen();
  installActsPen({ also: opens.also, failOn: (q) => /letter_opens/.test(q) });
  const d = await doorstepBundle("ann", { db, key: A, meta: {}, asOf: AS_OF });
  assert.equal(d.unread.count, null);
  assert.match(d.unread.unavailable, /unknown, not zero/);
});

test("6 · new_inbound still answers, with its pointer to where the count moved", async () => {
  const a = mailAwaiting(db, "ann");
  assert.equal(a.summary.new_inbound, 1, "the law's sequence state is untouched");
  assert.equal(a.new_inbound_moved, NEW_INBOUND_NOTE);
  assert.match(NEW_INBOUND_NOTE, /`unread`/);
  const d = await doorstepBundle("ann", { db, key: null, meta: {}, asOf: AS_OF });
  assert.equal(d.awaiting.summary.new_inbound, 1, "keyless readers (glitch's window) still read it");
  assert.equal(d.awaiting.new_inbound_moved, NEW_INBOUND_NOTE);
  assert.equal(UNREAD_LISTED, 20);
});
