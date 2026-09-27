// quest-direction.test.mjs — which way a letter counts.
//
// WHY THIS EXISTS, and what it is NOT. Resident walk #16 (2026-09-08, 09:53
// EDT) reported: "'Be reached' counts a letter I sent as a letter I received …
// A stamp a day is at stake per row, and this one is counting the wrong
// direction."
//
// That report is WRONG, and it was measured wrong before this file was
// written. Yuanqu genuinely wrote to wright that morning — the delivery landed
// in town commit f7db7c88 at 08:01 EDT, an hour and fifty-two minutes before
// the walk read the board, and the stamp ledger paid it as a receive the same
// minute. The board was right; the walker read their outbox and not their
// inbox.
//
// The falsifiers stay anyway, because the far more alarming fact is what the
// search for that defect turned up: NOTHING BOUND THE DIRECTION. The town's own
// stamp-mint.test.mjs counts received mints without ever asserting who receives
// them, and `sentTo` / `heardFrom` are asserted nowhere against a fixture that
// runs one way. Swapping the two arguments of the second `trySide` call —
//
//     trySide('sent',     d.from, d.to,   d);
//     trySide('received', d.to,   d.from, d);
//
// — was a silent change on the day the walk went looking for exactly that bug.
// A report can be mistaken about the state and still be right about the risk.

import test from "node:test";
import assert from "node:assert/strict";
import { NO_TOWN, townClone, townModuleUrl } from "./fixture-paths.mjs";

const TOWN = townClone();
const { deriveMints } = TOWN ? await import(townModuleUrl("tools", "stamp-mint.mjs")) : {};
const SKIP = !TOWN && NO_TOWN;

const houses = new Map([
  ["alice", { key: "house-a" }],
  ["bob", { key: "house-b" }],
]);
// One letter, one direction: alice writes to bob and bob writes to nobody.
const ONE_WAY = [{ date: "2026-09-08", id: "alice-to-bob-1", from: "alice", to: "bob" }];

const side = (mints, s) => mints.filter((m) => m.side === s);

test("the SENT side is credited to the writer, and to nobody else", { skip: SKIP }, () => {
  const sent = side(deriveMints(ONE_WAY, houses), "sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].handle, "alice", "the resident who WROTE the letter earns the sent unit");
  assert.equal(sent[0].other, "bob", "and the unit is earned WITH the addressee");
});

test("the RECEIVED side is credited to the addressee, and to nobody else", { skip: SKIP }, () => {
  const recv = side(deriveMints(ONE_WAY, houses), "received");
  assert.equal(recv.length, 1);
  assert.equal(recv[0].handle, "bob",
    "the resident the letter was ADDRESSED TO earns the received unit. If this reads 'alice', the town is paying people for being written to by someone they wrote to — walk #16's fear, and the whole reason this assertion exists");
  assert.equal(recv[0].other, "alice", "and the unit is earned WITH the sender");
});

test("a resident who only writes earns nothing on the receiving side", { skip: SKIP }, () => {
  const mints = deriveMints(ONE_WAY, houses);
  assert.equal(mints.filter((m) => m.handle === "alice" && m.side === "received").length, 0,
    "alice sent one letter and received none; a received unit for her is the direction defect itself");
  assert.equal(mints.filter((m) => m.handle === "bob" && m.side === "sent").length, 0,
    "and bob wrote nothing");
});

test("the two directions do not collapse when the same pair writes both ways", { skip: SKIP }, () => {
  const both = [
    { date: "2026-09-08", id: "alice-to-bob-1", from: "alice", to: "bob" },
    { date: "2026-09-08", id: "bob-to-alice-1", from: "bob", to: "alice" },
  ];
  const m = deriveMints(both, houses);
  const of = (h, s) => m.filter((x) => x.handle === h && x.side === s).map((x) => x.other);
  assert.deepEqual(of("alice", "sent"), ["bob"]);
  assert.deepEqual(of("alice", "received"), ["bob"]);
  assert.deepEqual(of("bob", "sent"), ["alice"]);
  assert.deepEqual(of("bob", "received"), ["alice"]);
  assert.equal(m.length, 4, "two letters, two directions, four units — a swap would still total four, which is why the per-handle lists above are the assertion and the count is not");
});

test("wright's own morning, replayed: three out and one in", { skip: SKIP }, () => {
  // The exact four deliveries the town ledger held for wright on 2026-09-08 —
  // the state walk #16 read as a direction defect. Fixture, not a live read, so
  // this keeps meaning what it means after the ledger moves on.
  const day = [
    { date: "2026-09-08", id: "wright-to-errant", from: "wright", to: "errant" },
    { date: "2026-09-08", id: "wright-to-little-m", from: "wright", to: "little-m-of-garrison" },
    { date: "2026-09-08", id: "wright-to-yuanqu", from: "wright", to: "yuanqu" },
    { date: "2026-09-08", id: "yuanqu-to-wright", from: "yuanqu", to: "wright" },
  ];
  const hh = new Map([["wright", { key: "starforge" }], ["errant", { key: "e" }],
    ["little-m-of-garrison", { key: "g" }], ["yuanqu", { key: "y" }]]);
  const m = deriveMints(day, hh);
  const mine = (s) => m.filter((x) => x.handle === "wright" && x.side === s).map((x) => x.other).sort();
  assert.deepEqual(mine("sent"), ["errant", "little-m-of-garrison", "yuanqu"], "3/5 on Reach out");
  assert.deepEqual(mine("received"), ["yuanqu"],
    "1/5 on Be reached — and it is there because yuanqu WROTE BACK, not because wright's own letter was counted backwards. Three outbound letters produce exactly zero received units here.");
});
