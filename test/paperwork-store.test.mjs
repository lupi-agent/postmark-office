// paperwork-store.test.mjs — THE SWITCH, on a real Postgres (POS-271).
//
// The lane's gate, each assertion red without the change it guards:
//
//   G1  a signed-in agent's credential still answers after the import and the
//       switch — every shape: an MCP session, a human's household key, a
//       resident-held key (custody disclosure intact), a co-signed claim, a berth
//   G2  a credential issued AFTER the switch still answers after the ROLLBACK
//       (the flag off: the file), and so do a role granted and a town-log row
//       written after the switch — the mirror is what makes the rollback lossless
//   G3  the media ledger and the town log read identically from the store and
//       the file: rows, quota, cursor, pending
//   G4  roles unchanged: the standing, the trail, the gate's answer
//   G5  and after all of it, paperwork-import --check finds the file and the
//       store still equal, row for row
//
// It needs a store it may create tables in, so it runs only when pointed at a
// DISPOSABLE Postgres that already carries the migrations (the proof's
// harness builds one: docs/2026-09-29/rail/pos-271/proof-switch.mjs):
//
//   PAPERWORK_TEST_PG_OWNER_URL  world2_owner on that store (the import's pen)
//   PAPERWORK_TEST_PG_API_URL    office_api on that store (the office's pen)
//
// Without both it SKIPS, and says why in its own title — a suite that cannot
// reach a real store must not pass as though it had (a stub pool would keep
// what Postgres destroys: int8 comes back as a string, which is the first thing
// G1 catches).
//
//   node --test test/paperwork-store.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { fixtureDb } from "./fixture.mjs";
import { openOauthDb, oauthSchema, oauthLookup, keyLookup, claimLookup, berthLookup, mintHouseholdKey, mintClaim, claimByAsk, cosignClaim, mintBerth } from "../src/oauth.mjs";
import { openRolesDb, rolesSchema, grantRole, revokeRole, listRoles, auditTrail, roleCheck } from "../src/roles.mjs";
import { ensureMediaTable, mediaLedgerRows, mediaQuota } from "../src/media.mjs";
import { appendTownJournal, readTownJournal, townDrainCursor, pendingRows } from "../src/town-journal.mjs";
import { advanceTownCursor } from "../src/town-drain.mjs";
import { openPaper, asPaper, paperStatus, closePaperworkPools } from "../src/paperwork.mjs";
import { importPaperwork } from "../world2/tools/paperwork-import.mjs";

const OWNER_URL = process.env.PAPERWORK_TEST_PG_OWNER_URL;
const API_URL = process.env.PAPERWORK_TEST_PG_API_URL;
const REACHABLE = Boolean(OWNER_URL && API_URL);
const SKIP = REACHABLE ? false
  : "SKIPPED: no disposable store — set PAPERWORK_TEST_PG_OWNER_URL and PAPERWORK_TEST_PG_API_URL (docs/2026-09-29/rail/pos-271/proof-switch.mjs does)";

const sha = (s) => createHash("sha256").update(s).digest("base64url");
const now = () => Math.floor(Date.now() / 1000);
const OWNER = { id: 999, login: "keeminlee" };   // pinned to `wright` and `rei`
const SWITCHED = { OFFICE_PAPERWORK_STORE: "1", WORLD2_PG: "1", WORLD2_PG_URL: API_URL };

// What the lookups answer, reduced to what a door acts on. Sets become sorted
// arrays so deep-equality compares their members.
const view = (k) => k && JSON.parse(JSON.stringify({ ...k, handles: [...(k.handles ?? [])].sort() }));
// node:sqlite hands rows back with a null prototype and node-postgres with Object's;
// no reader looks at a row's prototype, so the comparison is of what JSON sees.
const plain = (x) => JSON.parse(JSON.stringify(x));

test(`THE SWITCH on a real store: G1–G5 ${SKIP ? `(${SKIP})` : ""}`, { skip: SKIP }, async (t) => {
  const pg = (await import("pg")).default;
  const owner = new pg.Client({ connectionString: OWNER_URL });
  await owner.connect();
  const tmp = mkdtempSync(join(tmpdir(), "paperwork-store-"));
  const oauthPath = join(tmp, "oauth.db"), rolesPath = join(tmp, "roles.db");
  const db = fixtureDb(join(tmp, "fixture.db"));
  const clone = join(tmp, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({
    wright: { login: OWNER.login, id: OWNER.id, pinned: "2026-07-05" },
    rei: { login: OWNER.login, id: OWNER.id, pinned: "2026-07-05" },
  }));
  process.env.TOWN_SINGLE_LOG = "1";
  const papers = [];
  try {
    // ── BEFORE: the office's own writers, on the files ─────────────────────
    const ofile = openOauthDb(oauthPath);
    const t0 = now();
    const access = "acc_" + sha("fixture-access");
    // an MCP session, in the exact statement issueTokens runs
    await asPaper(ofile).run("INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES (?, 'access', ?, ?, ?, ?, ?)",
      sha(access), OWNER.id, OWNER.login, "cl_abc", t0 + 30 * 86400, t0);
    const humanKey = await mintHouseholdKey(ofile, OWNER.id, OWNER.login);
    // The claim and the resident-held key name DIFFERENT residents: a handle holds
    // one resident credential, and each of these retires the other on its own handle.
    const claim = await mintClaim(ofile, "rei");
    await cosignClaim(ofile, (await claimByAsk(ofile, claim.ask)).ask_hash, OWNER.id, OWNER.login);
    const residentKey = await mintHouseholdKey(ofile, OWNER.id, OWNER.login,
      { heldBy: "resident", claimedHandle: "wright", cosignedBy: { id: OWNER.id, login: OWNER.login } });
    const berth = await mintBerth(ofile, "a-visiting-ship", "1f3d9");
    ensureMediaTable(ofile);
    await asPaper(ofile).run("INSERT INTO media (household, sha, ext, bytes, by_handle, created) VALUES (?, ?, ?, ?, ?, ?)",
      "keeminlee", "a".repeat(64), "png", 123456, "wright", Date.now());
    const seq1 = await appendTownJournal(ofile, { cls: "letter", act: "send", household: "keeminlee", handle: "wright", ghId: OWNER.id, payload: { args: { to: "limen" } } });
    await appendTownJournal(ofile, { cls: "update", act: "home", household: "keeminlee", handle: "wright", payload: { args: { title: "Ünïcode ✦" } } });
    await advanceTownCursor(ofile, seq1);
    const rfile = openRolesDb(rolesPath);
    await grantRole(rfile, { subject: OWNER.id, actor: "keemin", note: "founder", login: OWNER.login });
    await grantRole(rfile, { subject: 424242, actor: "keemin" });
    await revokeRole(rfile, { subject: 424242, actor: "wright", note: "lapsed" });

    const lookups = async (o) => ({
      access: view(await oauthLookup(o, db, clone, access)),
      human: view(await keyLookup(o, db, clone, humanKey)),
      resident: view(await keyLookup(o, db, clone, residentKey)),
      claim: view(await claimLookup(o, db, clone, claim.key)),
      berth: view(await berthLookup(o, db, clone, berth.key)),
    });
    const ledgers = async (o) => plain({
      media: await mediaLedgerRows(o, "keeminlee"),
      quota: await mediaQuota(o, "keeminlee", 2),
      log: await readTownJournal(o),
      cursor: await townDrainCursor(o),
      pending: await pendingRows(o),
    });
    const book = async (r) => plain({
      standing: await listRoles(r),
      trail: await auditTrail(r),
      gate: await roleCheck(r, OWNER.id),
    });
    const before = { lookups: await lookups(ofile), ledgers: await ledgers(ofile), roles: await book(rfile) };
    assert.equal(before.lookups.access.household, OWNER.login, "the fixture's session resolves to its household before anything moves");
    assert.equal(before.lookups.claim.keyKind, "claim");
    ofile.close(); rfile.close();

    // ── THE IMPORT ──────────────────────────────────────────────────────────
    const copied = await importPaperwork(owner, { oauth: oauthPath, roles: rolesPath });
    assert.ok(copied.equal && copied.committed, `the copy is equal and committed: ${JSON.stringify(copied.tables.filter((x) => x.differ.length))}`);

    // ── THE SWITCH: the office's own opener, with the switch's env ──────────
    const o = await openPaper(oauthPath, { env: SWITCHED, schema: oauthSchema });
    const r = await openPaper(rolesPath, { env: SWITCHED, schema: rolesSchema });
    papers.push(o, r);
    assert.ok(o.onStore && r.onStore, "switched, the papers read the store");

    await t.test("G1 · every credential shape still answers after the import and the switch", async () => {
      assert.deepEqual(await lookups(o), before.lookups);
    });
    await t.test("G3 · the media ledger and the town log read identically from the store", async () => {
      assert.deepEqual(await ledgers(o), before.ledgers);
    });
    await t.test("G4 · roles unchanged: standing, trail and the gate's answer", async () => {
      assert.deepEqual(await book(r), before.roles);
    });

    // ── AFTER THE SWITCH: new paperwork, written through the store ──────────
    const mirroredBefore = paperStatus().mirrored;
    const lateKey = await mintHouseholdKey(o, OWNER.id, OWNER.login); // rotates the human's key
    await grantRole(r, { subject: 777, actor: "keemin", note: "after the switch" });
    const lateSeq = await appendTownJournal(o, { cls: "join", act: "declare-household", household: "newcomers", handle: "newcomer", ghId: "777" });
    await advanceTownCursor(o, lateSeq);
    assert.ok(paperStatus().mirrored > mirroredBefore, "the switched writes reached the file's mirror");
    assert.equal(paperStatus().mirrorFailed, 0, `no mirror write failed: ${paperStatus().lastMirrorError}`);
    const switched = { lookups: await lookups(o), late: view(await keyLookup(o, db, clone, lateKey)), ledgers: await ledgers(o), roles: await book(r) };
    assert.equal(switched.lookups.human, null, "the rotation on the store retired the human's old key");

    // ── THE ROLLBACK: the flag off, the files as the switched office left them
    const ofileBack = openOauthDb(oauthPath);
    const rfileBack = openRolesDb(rolesPath);
    try {
      await t.test("G2 · a key issued after the switch answers after the rollback, and the rotation it made holds", async () => {
        assert.deepEqual(view(await keyLookup(ofileBack, db, clone, lateKey)), switched.late);
        assert.ok(switched.late?.ghId === OWNER.id, "…as the same account, the id a number, not a string");
        assert.deepEqual(await lookups(ofileBack), switched.lookups);
      });
      await t.test("G2b · a role granted and a town-log row written after the switch survive the rollback, under the same seq", async () => {
        assert.deepEqual(await book(rfileBack), switched.roles);
        assert.deepEqual(await ledgers(ofileBack), switched.ledgers);
        assert.ok((await readTownJournal(ofileBack)).some((row) => row.seq === lateSeq && row.handle === "newcomer"));
      });
    } finally { ofileBack.close(); rfileBack.close(); }

    await t.test("G5 · paperwork-import --check: file and store still equal, row for row, after the switched writes", async () => {
      const checked = await importPaperwork(owner, { oauth: oauthPath, roles: rolesPath }, { check: true });
      assert.ok(checked.equal, JSON.stringify(checked.tables.filter((x) => x.differ.length).map((x) => x.differ.slice(0, 3))));
    });
  } finally {
    delete process.env.TOWN_SINGLE_LOG;
    for (const p of papers) p.close();
    await closePaperworkPools();
    await owner.end();
    db.close();
    // Never let the sweep mask the verdict: a handle still open on Windows makes
    // rmSync throw, and a throw here would replace the assertion that failed.
    try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* left in tmp */ }
  }
});
