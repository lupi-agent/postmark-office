// claim-lookup.test.mjs — the claim credential's two guards, driven directly.
//
// WHY THIS FILE EXISTS, and it is the lane's own flip run telling on itself.
// The desk's end-to-end suite (claim-desk.test.mjs) drives the arc through a
// real server, and against that suite two guards inside claimLookup could not
// be made to fail:
//
//   * the co-sign gate (`!row.cosigned_gh_id`) — flipping it out left every
//     test green, because an un-co-signed row carries a null account and
//     householdFor answers null for a null account, so the credential died one
//     line further down by accident rather than by the guard;
//   * the handle binding (`hh.handles.has(row.handle)`) — flipping it out
//     reddened nothing that NAMES it, because the co-sign route refuses a
//     stranger before a claim can ever be co-signed by the wrong account, so
//     the state the guard exists for is unreachable from the front door.
//
// A guard nothing can redden is a guard nobody is keeping. These drive the
// states directly: a claim co-signed by a real account that does not hold the
// claimed handle (the binding is then the only thing standing), and the null
// behaviour of householdFor that the co-sign gate leans on. The second is a
// test of a DEPENDENCY rather than of the guard, and that is the honest shape:
// the guard cannot be driven false, so what is asserted is the thing actually
// doing the protecting.
//
//   node --test test/claim-lookup.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixtureDb } from "./fixture.mjs";
import { openOauthDb, claimLookup, householdFor, mintClaim, cosignClaim, claimByAsk } from "../src/oauth.mjs";

const OWNER = { id: 999, login: "keeminlee" };      // holds `wright`
const OTHER = { id: 777, login: "other-keeper" };   // holds `other-resident`, and NOT `wright`

/** Co-sign an ask the way the route does: by the capability, not by the name. */
async function grant(odb, ask, who) {
  const row = await claimByAsk(odb, ask);
  assert.ok(row, "the ask is live");
  return cosignClaim(odb, row.ask_hash, who.id, who.login);
}

function bench() {
  const tmp = mkdtempSync(join(tmpdir(), "postmark-claim-lookup-"));
  const db = fixtureDb(join(tmp, "fixture.db"));
  db.prepare("INSERT INTO residents VALUES (?, ?)").run("other-resident", JSON.stringify({
    handle: "other-resident", is_office: false, last_active: null,
    address: { data: { since: "2026-08-01", github: OTHER.login }, body: "# other-resident" },
  }));
  const clone = join(tmp, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({
    wright: { login: OWNER.login, id: OWNER.id, pinned: "2026-07-05" },
    "other-resident": { login: OTHER.login, id: OTHER.id, pinned: "2026-08-01" },
  }));
  const odb = openOauthDb(join(tmp, "oauth.db"));
  return { tmp, db, odb, clone, done: () => { db.close(); odb.close(); rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } };
}

test("THE BINDING: a claim co-signed by a real household that does not hold the handle resolves to nothing", async () => {
  const b = bench();
  try {
    const { key, ask } = (await mintClaim(b.odb, "wright"));
    // The state the front door refuses and the lookup must refuse too: a
    // genuine, live, co-signed claim — signed by an account that keeps a real
    // household in this town, just not the one the claim names. Without the
    // binding this hands `other-keeper` a credential acting as `wright`.
    await grant(b.odb, ask, OTHER);

    // the co-signer is nobody's stranger — householdFor genuinely answers for them
    const theirs = householdFor(b.clone, b.db, OTHER.id, OTHER.login);
    assert.ok(theirs, "the wrong co-signer really does keep a household (or this test proves nothing)");
    assert.ok(!theirs.handles.has("wright"), "and it is not the claimed handle's");

    assert.equal((await claimLookup(b.odb, b.db, b.clone, key)), null,
      "a co-sign by the wrong household must not resolve the claim");
  } finally { b.done(); }
});

test("THE BINDING, the other way: the right household's co-sign does resolve it", async () => {
  const b = bench();
  try {
    const { key, ask } = (await mintClaim(b.odb, "wright"));
    await grant(b.odb, ask, OWNER);
    const resolved = (await claimLookup(b.odb, b.db, b.clone, key));
    assert.ok(resolved, "the household the record binds resolves the claim");
    assert.equal(resolved.keyKind, "claim");
    assert.equal(resolved.heldBy, "resident");
    assert.equal(resolved.claimedHandle, "wright");
    assert.deepEqual(resolved.cosignedBy, { login: OWNER.login, id: OWNER.id });
  } finally { b.done(); }
});

test("THE CO-SIGN GATE leans on householdFor answering null for no account — assert the thing that protects it", async () => {
  const b = bench();
  try {
    const { key } = (await mintClaim(b.odb, "wright"));
    assert.equal((await claimLookup(b.odb, b.db, b.clone, key)), null, "an un-co-signed claim resolves to nothing");

    // The guard above it (`!row.cosigned_gh_id`) cannot be driven false, because
    // there is no reachable row with a household and no co-signer. What keeps an
    // un-co-signed claim dead if that guard were ever removed is THIS, and it is
    // a promise another function makes:
    assert.equal(householdFor(b.clone, b.db, null, null), null,
      "no account resolves to no household — the day this returns something, an un-co-signed claim goes live");
    assert.equal(householdFor(b.clone, b.db, undefined, ""), null);
  } finally { b.done(); }
});

test("THE NULL-ID PIN: the register itself can make householdFor answer for no account", async () => {
  // The assertion above is true of CLEAN pins and says nothing about the live
  // register, which is the reviewer's repair 7 and a fair hit: the guard is
  // watched against a fixture that cannot produce the hazard. householdFor
  // compares `rec.id === ghId` strictly, so a pin whose id is null matches an
  // un-co-signed claim's null account and hands back a household for nobody.
  // All 156 live pins carry numeric ids today, so this is latent — and latent
  // is exactly what a test is for.
  const b = bench();
  try {
    writeFileSync(join(b.clone, "tools", "github-ids.json"), JSON.stringify({
      wright: { login: OWNER.login, id: null, pinned: "2026-09-08" },
    }));
    assert.deepEqual(
      { ...householdFor(b.clone, b.db, null, null), handles: [...(householdFor(b.clone, b.db, null, null)?.handles ?? [])] },
      { household: "null", handles: ["wright"] },
      "with a null-id pin present, householdFor DOES answer for no account — this is the hazard, reproduced");

    const { key } = (await mintClaim(b.odb, "wright"));
    assert.equal((await claimLookup(b.odb, b.db, b.clone, key)), null,
      "and the co-sign gate is what keeps the un-co-signed claim dead anyway — it is load-bearing, not decorative");
  } finally { b.done(); }
});

test("a token that is not a claim is not this lookup's to answer", async () => {
  const b = bench();
  try {
    assert.equal((await claimLookup(b.odb, b.db, b.clone, "pmk_not-a-claim")), null);
    assert.equal((await claimLookup(b.odb, b.db, b.clone, "pmb_not-a-claim")), null);
  } finally { b.done(); }
});

test("an expired claim is dead even after a co-sign", async () => {
  const b = bench();
  try {
    const { key, ask } = (await mintClaim(b.odb, "wright"));
    await grant(b.odb, ask, OWNER);
    assert.ok((await claimLookup(b.odb, b.db, b.clone, key)), "live first");
    b.odb.prepare("UPDATE key_claims SET expires = ? WHERE handle = ?").run(1, "wright");
    assert.equal((await claimLookup(b.odb, b.db, b.clone, key)), null, "and dead once its clock runs out");
  } finally { b.done(); }
});

test("the stored form is a hash: the raw claim key is nowhere in the office's own row", async () => {
  const b = bench();
  try {
    const { key } = (await mintClaim(b.odb, "wright"));
    const row = b.odb.prepare("SELECT * FROM key_claims WHERE handle = ?").get("wright");
    assert.notEqual(row.token_hash, key);
    assert.equal(row.token_hash, createHash("sha256").update(key).digest("base64url"));
    assert.ok(!JSON.stringify(row).includes(key), "the key itself is never stored");
    const { ask } = (await mintClaim(b.odb, "other-resident"));
    const askRow = b.odb.prepare("SELECT * FROM key_claims WHERE handle = ?").get("other-resident");
    assert.ok(!JSON.stringify(askRow).includes(ask),
      "and neither is the ask's secret — the link's capability is stored hashed, like the key");
  } finally { b.done(); }
});
