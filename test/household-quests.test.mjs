// household-quests.test.mjs — `household { read: "quests" }` answers for the
// resident who was NAMED.
//
// THE DEFECT THIS PINS, from a resident's seat (docs/2026-09-06/resident-walk.md,
// 17:53 EDT, item 1): a seven-resident household asked
//
//     household { read: "quests", handle: "wright" }
//
// and was answered `"of": "architect"` — Reach out 0/5, counted [] — while
// `town { read: "quests", args: { handle: "wright" } }` answered 1/5,
// counted ["errant"] for the same handle in the same minute. The board took the
// key's alphabetically first resident whatever it was asked. Every
// multi-resident household in town read someone else's progress under its own
// name, and no single-resident household could ever have seen it.
//
//   node --test test/household-quests.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "../src/schema.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { questsRead } from "../src/household-stamps.mjs";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";

// A real town checkout — the office imports the town's own board rule live,
// exactly as quests.test.mjs does, so "today" is the town's day and not ours.
const TOWN = townClone();
const { townDay } = TOWN ? await import(townModuleUrl("tools", "quest-progress.mjs")) : {};
const SKIP = !TOWN && NO_TOWN;

const REGISTRY = JSON.stringify({
  version: 1,
  quests: [
    { id: "correspond-send", title: "Reach out", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" },
    { id: "correspond-receive", title: "Be reached", cadence: "daily", validation: "automatic", target: 5, reward: "1 stamp per unit" },
  ],
});

const dir = mkdtempSync(join(tmpdir(), "pm-hh-quests-"));

// THE TWO-RESIDENT HOUSEHOLD, and the two must differ or the test proves
// nothing: `architect` sorts first and has done nothing today; `wright` is the
// one who wrote a letter and the one the caller names.
// `townDay` is the town's own, so with no checkout there is nobody to ask. The
// whole fixture below is built from it, and every case here is skipped in that
// state — so the fallback is a placeholder nothing reads, never a second
// opinion about what day it is.
const day = townDay ? townDay() : "1970-01-01";
const db = new DatabaseSync(join(dir, "quests.db"));
db.exec(SCHEMA);
const put = db.prepare("INSERT INTO meta VALUES (?, ?)");
put.run("quest_registry", REGISTRY);
put.run("quest_day", day);
const progress = db.prepare(`INSERT INTO quest_progress
  (handle, send, receive, house_size, house_send, house_receive, sent_to, heard_from)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
progress.run("architect", 0, 0, 2, 1, 0, "[]", "[]");
progress.run("wright", 1, 0, 2, 1, 0, JSON.stringify(["errant"]), "[]");
// One hook, in this order: on Windows the directory cannot be removed while the
// index is still open, and two hooks run in registration order.
after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const KEY = { household: "keeminlee", handles: new Set(["architect", "wright"]) };
const CTX = { db, meta: { quest_registry: REGISTRY, quest_day: day }, clone: TOWN, asOf: "test" };
const send = (board) => (board.quests ?? []).find((q) => q.id === "correspond-send");

test('the named resident gets THEIR board — handle at the top level', { skip: SKIP }, async () => {
  const answer = await householdApex({ read: "quests", handle: "wright" }, KEY, CTX);
  assert.equal(answer.of, "wright", "the board answers for the resident who was named");
  assert.equal(send(answer).progress, 1, "wright wrote one letter today");
  assert.deepEqual(send(answer).counted, ["errant"], "and the board names who — the town door's own answer");
});

test('the named resident gets THEIR board — handle inside the envelope', { skip: SKIP }, async () => {
  const answer = await householdApex({ read: "quests", args: { handle: "wright" } }, KEY, CTX);
  assert.equal(answer.of, "wright");
  assert.equal(send(answer).progress, 1);
});

test('the OTHER resident is still reachable by name — the fix is not a new hard-coding', { skip: SKIP }, async () => {
  const answer = await householdApex({ read: "quests", handle: "architect" }, KEY, CTX);
  assert.equal(answer.of, "architect");
  assert.equal(send(answer).progress, 0, "architect has written nobody today");
  assert.deepEqual(send(answer).counted, []);
});

test("a bare call on a several-resident key ASKS rather than picking — and says where the pots still are", { skip: SKIP }, async () => {
  const answer = await householdApex({ read: "quests" }, KEY, CTX);
  assert.equal(answer.error, "bounce");
  assert.equal(answer.code, 422);
  assert.match(answer.defect, /whose quest board/i);
  assert.deepEqual(answer.your_residents, ["architect", "wright"]);
  // The pots on this board belong to the town, not to any resident, so the
  // refusal must not read as though they were being withheld.
  assert.match(answer.hint, /town \{ read: "quests" \}/, "the public board is named");
  assert.match(answer.hint, /read: "fund"/, "and so is the money read");
});

test("a single-resident key still infers, exactly as the schema promises", { skip: SKIP }, async () => {
  const solo = { household: "solo", handles: new Set(["wright"]) };
  const answer = await householdApex({ read: "quests" }, solo, CTX);
  assert.equal(answer.of, "wright");
  assert.equal(send(answer).progress, 1);
});

test("questsRead takes a HANDLE, not a key — the guess has nowhere to grow back from", { skip: SKIP }, async () => {
  // The type change IS the guard. Handed the key it used to take, the read can
  // no longer find a resident in it at all: there is no `handles` to index [0]
  // of, so a regression that reverted the call site would fail loudly here
  // rather than quietly answering for somebody else.
  const answer = await questsRead(KEY, { db, meta: CTX.meta, clone: TOWN });
  assert.notEqual(answer.of, "architect", "a key is not a handle and must never resolve to one");
  assert.equal(answer.quests, null, "an object where a handle belongs buys no board");
});
