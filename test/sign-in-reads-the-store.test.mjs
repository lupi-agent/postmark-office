// sign-in-reads-the-store.test.mjs — POS-343: an account's handles come from household_pins.
//
// `oauth.mjs § householdFor` used to read the clone's tools/github-ids.json and
// fall through to the ADDRESS logins when the file could not be read. The pins
// are the store's (019), and the file is their printout. So: a pin present only
// in the store signs in, a pin present only in the file does not, and a store
// that cannot be asked is a refusal, never a fallback.
//
// THE FLIP: put back 48e7678's householdFor (it reads the clone's file) and the
// first two tests go red: the store-only pin finds nothing, and the file-only
// pin signs in.
//
//   node --test test/sign-in-reads-the-store.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { indexStore, seedRegistry, recordInProcess } from "./helpers/office-under-test.mjs";
import * as oauth from "../src/oauth.mjs";

const STORE_ONLY = { login: "store-only-gh", id: 4101 };   // bound by the ceremony; the drain has not printed it
const FILE_ONLY = { login: "file-only-gh", id: 4102 };     // a hand edit to the printout; the record never held it

let tmp, db, clone, ix, restore, unrecord;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "pos343-"));
  db = fixtureDb(join(tmp, "fixture.db"));
  clone = join(tmp, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({ "file-resident": { ...FILE_ONLY, pinned: "2026-10-01" } }));
  ix = await indexStore(db);
  restore = await ix.useInProcess();
  await seedRegistry(ix.store, null, { "store-resident": { ...STORE_ONLY, pinned: "2026-10-04" } });
  unrecord = await recordInProcess(ix.store);
});
after(async () => {
  await unrecord?.(); await restore?.(); await ix?.stop(); db?.close();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// 48e7678's signature was (clone, db, ghId, ghLogin); the store's is (db, ghId, ghLogin).
const lookup = (ghId, ghLogin) => (oauth.householdFor.length >= 4 && !oauth.SignInUnreadable
  ? oauth.householdFor(clone, db, ghId, ghLogin)
  : oauth.householdFor(db, ghId, ghLogin));

test("a pin present only in the STORE signs in as its resident", async () => {
  const hh = await lookup(STORE_ONLY.id, STORE_ONLY.login);
  assert.ok(hh, "the account the store pins resolves to a household");
  assert.deepEqual([...hh.handles], ["store-resident"]);
});

test("a pin present only in the PRINTOUT does not", async () => {
  assert.equal(await lookup(FILE_ONLY.id, FILE_ONLY.login), null,
    "the file is the store's printout, and a pin the record never held binds nobody");
});

test("a store the office cannot ask is a refusal by name, never the file, never anonymous", async () => {
  const keep = process.env.WORLD2_PG;
  delete process.env.WORLD2_PG;
  try {
    await assert.rejects(lookup(STORE_ONLY.id, STORE_ONLY.login),
      (e) => e instanceof oauth.SignInUnreadable && e.code === 503 && /cannot read the town's record/.test(e.defect),
      "sign-in refuses rather than answer from the printout or as nobody");
  } finally { process.env.WORLD2_PG = keep; }
});
