// crossing-receipts.test.mjs — every decided crossing's receipt is a store row
// beside `settlements`, and the office serves it from there (POS-352, 061).
//
//   node --test test/crossing-receipts.test.mjs
//
//   RECORD    the recorder writes the receipt's exact bytes and its lifted
//             fields; the same receipt twice is one row (its digest).
//   DECISION  a lost race inside the retry is not recorded (the history's
//             isDecision rule); the wrapper's raced-out receipt is.
//   APPEND    061's trigger refuses UPDATE and DELETE.
//   THE DOOR  GET /crossings/receipts answers the newest receipt whole, and
//             ?limit=N the newest N rows' fields; a bad limit is refused.
//
// THE FLIP (after the commit): recordReceipt without ON CONFLICT (digest) DO
// NOTHING — RECORD's second call throws on the unique digest.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { recordReceipt, receiptsRead, receiptDigest } from "../src/crossing-receipts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const store = await startStore({ db: "crossing_receipts_test" });
process.env.WORLD2_PG = "1";
process.env.WORLD2_PG_URL = store.url("office_api");
const dir = mkdtempSync(join(tmpdir(), "pm-receipts-"));
after(async () => { __setPoolForTest(null); await store.stop(); rmSync(dir, { recursive: true, force: true }); });

const receipt = (over = {}) => JSON.stringify({
  at: "2026-10-04T22:00:43Z", status: "published", class: null, by_hand: false,
  world_from: "aaaa", world_to: "bbbb", channels: { published: 9 }, ...over }, null, 1) + "\n";

async function rows() {
  const c = await store.connect("office_api");
  try { return (await c.query("SELECT * FROM crossing_receipts ORDER BY id")).rows; } finally { await c.end(); }
}

test("RECORD: the exact bytes and the lifted fields; the same receipt twice is one row", async () => {
  const text = receipt();
  const a = await recordReceipt(text);
  assert.equal(a.recorded, true);
  const b = await recordReceipt(text);
  assert.equal(b.recorded, false, "the digest is UNIQUE: a re-run records nothing");
  const [row] = await rows();
  assert.equal(row.receipt, text, "byte for byte, as the crossing wrote the file");
  assert.equal(row.digest, receiptDigest(text));
  assert.deepEqual([row.status, row.by_hand, row.world_from, row.world_to], ["published", false, "aaaa", "bbbb"]);
});

test("DECISION: a lost race inside the retry is not recorded; the raced-out receipt is", () => {
  const tool = join(ROOT, "world2", "tools", "crossing-receipt.mjs");
  const run = (text, attempt) => {
    const p = join(dir, `r-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(p, text);
    return execFileSync(process.execPath, [tool, "--receipt", p, "--attempt", attempt], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: process.env });
  };
  const before = rows();
  return before.then(async (b) => {
    run(receipt({ status: "race", at: "2026-10-04T22:01:00Z" }), "2");
    assert.equal((await rows()).length, b.length, "an attempt inside the retry wrapper is not a decision");
    run(receipt({ status: "race", at: "2026-10-04T22:02:00Z", detail: "raced on all 3 attempts" }), "");
    assert.equal((await rows()).length, b.length + 1, "the wrapper's final word is");
  });
});

test("APPEND: 061's trigger refuses UPDATE and DELETE, the owner included", async () => {
  for (const role of ["office_api", "world2_owner"]) {
    const c = await store.connect(role);
    try {
      await assert.rejects(c.query("UPDATE crossing_receipts SET status = 'rewritten'"), /./);
      await assert.rejects(c.query("DELETE FROM crossing_receipts"), /./);
    } finally { await c.end(); }
  }
});

test("THE DOOR: the newest receipt whole, the newest N rows' fields, and a refused limit", async () => {
  await recordReceipt(receipt({ at: "2026-10-05T10:00:41Z", status: "refused", class: "canon-bad" }));
  const newest = await receiptsRead(new URLSearchParams());
  assert.equal(newest.receipt.status, "refused");
  assert.equal(newest.receipt.class, "canon-bad");
  const list = await receiptsRead(new URLSearchParams("limit=2"));
  assert.equal(list.receipts.length, 2);
  assert.equal(list.receipts[0].status, "refused", "newest first");
  assert.equal(list.receipts[0].receipt, undefined, "the list carries the fields, not the bodies");
  await assert.rejects(receiptsRead(new URLSearchParams("limit=0")), (e) => e.code === 422);
  await assert.rejects(receiptsRead(new URLSearchParams("limit=61")), (e) => e.code === 422);
  await assert.rejects(receiptsRead(new URLSearchParams(), {}), (e) => e.code === 409, "not pointed at the record is not-yet-open, never 'no crossings'");
});
