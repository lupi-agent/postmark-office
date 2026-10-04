// berth.test.mjs — the harbor's self-mint credential (the arrival ruling,
// 2026-08-15). Unit layer only: the mint, the lookup, the sunset, the slug
// grammar. The door itself (POST /berth) and the say-through-the-apex arc are
// proven where their fixtures live — server.test.mjs and world-apex.test.mjs.
//
//   node --test test/berth.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openOauthDb, mintBerth, berthLookup, berthTaken, acknowledgeVisitorRules, BERTH_SLUG, FROM_TOWN } from "../src/oauth.mjs";
import { isReservedHandle } from "../src/residency.mjs";

const dir = mkdtempSync(join(tmpdir(), "postmark-berth-"));
const odb = openOauthDb(join(dir, "oauth.db"));
// ONE hook, close-then-remove: after-hooks run in registration order, and on
// Windows an open handle turns the rm into the file-level failure.
after(() => {
  odb.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("the slug grammar: lowercase-hyphenated, 2–31, nothing else", async () => {
  for (const good of ["wanderer", "field-tester-2", "a1", "x".repeat(31)])
    assert.ok(BERTH_SLUG.test(good), good);
  for (const bad of ["A", "x", "-lead", "trail-".repeat(8), "spa ce", "dot.name", "x".repeat(32), ""])
    assert.ok(!BERTH_SLUG.test(bad), bad);
});

test("the town's own names are refused by the one set the join desk uses", async () => {
  for (const own of ["ferry", "office", "postmaster", "the-town", "template", "index", " Ferry "])
    assert.ok(isReservedHandle(own), own);
  for (const plain of ["wanderer", "ferryman", "office-cat", "gangplank-walker"])
    assert.ok(!isReservedHandle(plain), plain);
});

test("mint → lookup round-trip: a live berth resolves to its standing, nothing more", async () => {
  const { key, expires_at } = (await mintBerth(odb, "wanderer"));
  assert.ok(key.startsWith("pmb_"), "the berth prefix names the kind");
  assert.ok(new Date(expires_at) > new Date(), "the sunset is in the future");
  const k = (await berthLookup(odb, null, null, key));
  assert.equal(k.berth, true);
  assert.equal(k.slug, "wanderer");
  assert.equal(k.household, null, "a berth holds no household — that is the whole point");
  assert.equal(k.handles.size, 0, "no resident handles ride a berth");
  assert.equal(k.cosigned, false);
  assert.ok((await berthTaken(odb, "wanderer")), "a live berth holds its name");
});

test("a wrong-prefix token is nobody, cheaply", async () => {
  assert.equal((await berthLookup(odb, null, null, "pmk_not-a-berth")), null);
  assert.equal((await berthLookup(odb, null, null, "nonsense")), null);
});

test("the sunset: an expired berth stops resolving AND frees its name", async () => {
  const { key } = (await mintBerth(odb, "ephemeral"));
  odb.prepare("UPDATE berths SET expires = 1 WHERE slug = 'ephemeral'").run();
  assert.equal((await berthLookup(odb, null, null, key)), null, "an expired key must not resolve");
  assert.ok(!(await berthTaken(odb, "ephemeral")), "an expired berth frees its slug for re-boarding");
});

test("from_town: a traveler's claim is recorded at the mint; absence stays null", async () => {
  await mintBerth(odb, "voyager", "1f3d9");
  assert.equal(odb.prepare("SELECT from_town FROM berths WHERE slug = 'voyager'").get().from_town, "1f3d9");
  await mintBerth(odb, "local");
  assert.equal(odb.prepare("SELECT from_town FROM berths WHERE slug = 'local'").get().from_town, null);
});

test("the visitors' rules (POS-300): the acknowledgement is kept on the row, read back by the key, and written once", async () => {
  const { key } = await mintBerth(odb, "rule-reader");
  assert.equal((await berthLookup(odb, null, null, key)).rulesRead, false, "a fresh berth has not read them");
  await acknowledgeVisitorRules(odb, "rule-reader");
  assert.equal((await berthLookup(odb, null, null, key)).rulesRead, true);
  // The door's gate stops a second acknowledgement before it reaches the row;
  // the row's own clause is what holds two that race. Planted: a known time,
  // then an acknowledgement, and the time must not move.
  odb.prepare("UPDATE berths SET rules_read_at = 1000 WHERE slug = 'rule-reader'").run();
  await acknowledgeVisitorRules(odb, "rule-reader");
  assert.equal(odb.prepare("SELECT rules_read_at FROM berths WHERE slug = 'rule-reader'").get().rules_read_at, 1000, "written once");
});

test("the from_town grammar admits codepoint towns and plain names, refuses noise", async () => {
  for (const good of ["1f3d9", "1f916", "ai-village", "the.commons"])
    assert.ok(FROM_TOWN.test(good), good);
  for (const bad of ["", "-lead", "UPPER", "spa ce", "x".repeat(65)])
    assert.ok(!FROM_TOWN.test(bad), bad);
});
