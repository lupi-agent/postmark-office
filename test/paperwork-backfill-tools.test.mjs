// paperwork-backfill-tools.test.mjs — POS-271's owed part: the tools that read
// oauth.db and roles.db read the store when the office is switched.
//
// #265 moved the office onto the store (OFFICE_PAPERWORK_STORE=1) and left the
// tools reading the files. A switched office keeps the files only as the
// rollback's mirror, so a tool still reading them answers from the store's
// past. Each falsifier here runs one tool twice from ONE fixture: unswitched
// over the files, and switched over the store the import filled from those
// same files. The two answers must be equal, and the switched run is pointed
// at file paths that do not exist, so it cannot have read a file and passed.
//
//   T1  tools/roles.mjs list --login: the login -> gh_id resolution reads the
//       sign-ins (oauth_tokens), not oauth.db's tokens
//   T2  tools/media-thumbnails-backfill.mjs --ledger: the originals come from
//       office_media, not oauth.db's media
//   T3  tools/backfill-home-shelf.mjs § openLedger: a live run spends quota on
//       office_media, and a dry run on the store commits nothing
//
// It needs a DISPOSABLE Postgres that already carries the migrations, the same
// as test/paperwork-store.test.mjs (docs/2026-10-02/rail/pos-271/proof-tools.mjs
// builds one):
//
//   PAPERWORK_TEST_PG_OWNER_URL  world2_owner on that store (the import's pen)
//   PAPERWORK_TEST_PG_API_URL    office_api on that store (the office's pen)
//
// Without both it SKIPS, and says so in its title.
//
//   node --test test/paperwork-backfill-tools.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const OWNER_URL = process.env.PAPERWORK_TEST_PG_OWNER_URL;
const API_URL = process.env.PAPERWORK_TEST_PG_API_URL;
const SKIP = OWNER_URL && API_URL ? false
  : "SKIPPED: no disposable store — set PAPERWORK_TEST_PG_OWNER_URL and PAPERWORK_TEST_PG_API_URL (docs/2026-10-02/rail/pos-271/proof-tools.mjs does)";

// media.mjs reads these at load; the PUT is a stub in every run, so nothing
// here can reach a bucket.
process.env.R2_ACCOUNT_ID = "test-account";
process.env.R2_ACCESS_KEY_ID = "test-key";
process.env.R2_SECRET_ACCESS_KEY = "test-secret";

const SWITCHED = { OFFICE_PAPERWORK_STORE: "1", WORLD2_PG: "1", WORLD2_PG_URL: API_URL };
const UNSWITCHED = { OFFICE_PAPERWORK_STORE: "", WORLD2_PG: "", WORLD2_PG_URL: "" };
const plain = (x) => JSON.parse(JSON.stringify(x));
const quiet = (s) => String(s ?? "").split("\n").filter((l) => !/ExperimentalWarning|trace-warnings/.test(l)).join("\n");
const run = (args, env) => {
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status, out: quiet(r.stdout), err: quiet(r.stderr) };
};
// The same, without blocking this process: T2's media host is served from
// here, and a spawnSync would hold the very loop that has to answer its HEADs.
const runAsync = (args, env) => new Promise((resolve) => {
  const c = spawn(process.execPath, args, { env: { ...process.env, ...env } });
  let out = "", err = "";
  c.stdout.on("data", (d) => { out += d; });
  c.stderr.on("data", (d) => { err += d; });
  c.on("close", (code) => resolve({ code, out: quiet(out), err: quiet(err) }));
});

// the real 1×1 PNG and the real 2×2 JPEG test/backfill-home-shelf.test.mjs uses
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPG = Buffer.from("/9j/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAwb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCXACnH/9k=", "base64");
const door = (household, handles) => ({ household, handles: new Set(handles) });

test(`THE BACKFILL TOOLS READ THE STORE WHEN SWITCHED, and answer as the files did: T1–T3 ${SKIP ? `(${SKIP})` : ""}`, { skip: SKIP }, async (t) => {
  const pg = (await import("pg")).default;
  const { openOauthDb } = await import("../src/oauth.mjs");
  const { openRolesDb, grantRole } = await import("../src/roles.mjs");
  const { uploadMedia } = await import("../src/media.mjs");
  const { importPaperwork } = await import("../world2/tools/paperwork-import.mjs");
  const { backfillHomeShelf, openLedger } = await import("../tools/backfill-home-shelf.mjs");

  const dir = mkdtempSync(join(tmpdir(), "pos271-tools-"));
  const owner = new pg.Client({ connectionString: OWNER_URL });
  await owner.connect();
  const api = new pg.Client({ connectionString: API_URL });
  await api.connect();
  const nowhere = join(dir, "nowhere");   // a path no switched run may read
  try {
    // ── ONE FIXTURE, the files, then the store filled from them ─────────────
    const oauthPath = join(dir, "oauth.db");
    const rolesPath = join(dir, "roles.db");
    const odb = openOauthDb(oauthPath);
    // a sign-in for a login no pin binds, so the token is the ONLY way to resolve it
    odb.prepare("INSERT INTO tokens (token_hash, kind, gh_id, gh_login, client_id, expires, created) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run("t-hearth", "access", 777, "Hearth", "c", 4_000_000_000, 1_700_000_000);
    // a household that already holds the PNG: the backfill must find it on the ledger
    await uploadMedia({ by: "resident" }, door("gh-user", ["resident"]), odb, { put: async () => {}, bytes: PNG });
    odb.close();
    const rdb = openRolesDb(rolesPath);
    await grantRole(rdb, { subject: "777", actor: "pos271-test", login: "hearth", note: "fixture" });
    rdb.close();
    const copied = await importPaperwork(owner, { oauth: oauthPath, roles: rolesPath });
    assert.ok(copied, "the import must commit the fixture into the store");
    const storeMedia = async () => Number((await api.query("SELECT count(*) AS n FROM office_media")).rows[0].n);
    assert.equal(await storeMedia(), 1, "the store holds the fixture's one ledger row");

    await t.test("T1 tools/roles.mjs list --login resolves through the sign-ins: the same standing and trail both ways", () => {
      const pins = join(dir, "no-pins");
      mkdirSync(pins, { recursive: true });
      const args = (db, oauthDb) => ["tools/roles.mjs", "list", "--login", "hearth", "--json", "--db", db, "--oauth-db", oauthDb, "--clone", pins];
      const files = run(args(rolesPath, oauthPath), UNSWITCHED);
      const store = run(args(join(nowhere, "roles.db"), join(nowhere, "oauth.db")), SWITCHED);
      assert.equal(files.code, 0, files.err);
      assert.equal(store.code, 0, `the switched run must resolve "hearth" from the store's sign-ins: ${store.err}`);
      const a = JSON.parse(files.out), b = JSON.parse(store.out);
      assert.equal(a.standing.length, 1, "the fixture's grant stands, found through the login");
      assert.deepEqual(plain(b.standing), plain(a.standing));
      assert.deepEqual(plain(b.audit), plain(a.audit));
      assert.deepEqual(plain(b.stale), plain(a.stale));
    });

    await t.test("T2 tools/media-thumbnails-backfill.mjs --ledger lists the same originals both ways", async () => {
      // a media host that holds every small copy: HEAD answers 200, nothing is minted
      const host = createServer((req, res) => { res.statusCode = req.method === "HEAD" ? 200 : 404; res.end(); });
      await new Promise((r) => host.listen(0, "127.0.0.1", r));
      const base = `http://127.0.0.1:${host.address().port}`;
      try {
        const env = (sw) => ({ ...sw, MEDIA_BASE: base });
        const files = await runAsync(["tools/media-thumbnails-backfill.mjs", "--ledger", oauthPath], env(UNSWITCHED));
        const store = await runAsync(["tools/media-thumbnails-backfill.mjs", "--ledger", join(nowhere, "oauth.db")], env(SWITCHED));
        assert.equal(files.code, 0, files.err);
        assert.equal(store.code, 0, `the switched run must read office_media: ${store.err}`);
        // the first line names the source, and that is the one difference by design
        const [headA, ...a] = files.out.trim().split("\n");
        const [headB, ...b] = store.out.trim().split("\n");
        assert.match(headA, /the media ledger \(.*oauth\.db\)/);
        assert.match(headB, /the media ledger \(the store's office_media\)/);
        assert.ok(a.some((l) => /originals 1\b/.test(l)), `the fixture's one original is listed: ${files.out}`);
        assert.deepEqual(b, a);
      } finally { host.close(); }
    });

    await t.test("T3 tools/backfill-home-shelf.mjs § openLedger: the same answer both ways; a dry run on the store commits nothing, a live one spends office_media", async () => {
      const staging = join(dir, "staging");
      mkdirSync(join(staging, "files"), { recursive: true });
      writeFileSync(join(staging, "files", "resident.png"), PNG);
      writeFileSync(join(staging, "files", "other.jpg"), JPG);
      const images = {
        resident: { file: "WHITE_PAGES/resident/HOME/art.png", format: "png" },   // already on the ledger
        other: { file: "WHITE_PAGES/other/HOME/art.jpg", format: "jpg" },         // a new object
      };
      const houses = { resident: door("gh-user", ["resident"]), other: door("gh-other", ["other"]) };
      const backfill = async (odb) => {
        const r = await backfillHomeShelf({ images, stagingDir: staging, householdFor: (h) => houses[h] ?? null, upload: uploadMedia, odb, put: async () => {} });
        return plain(r);
      };

      // the files: a working copy, so the fixture stays what the store was filled from
      const copy = join(dir, "oauth-copy.db");
      copyFileSync(oauthPath, copy);
      const onFile = await openLedger({ path: copy, dry: false, env: UNSWITCHED });
      const fromFile = await backfill(onFile.odb);
      await onFile.done();
      assert.deepEqual(fromFile.dedup, ["resident"], "the PNG is already on the ledger");
      assert.deepEqual(fromFile.minted, ["other"]);

      const dry = await openLedger({ path: join(nowhere, "oauth.db"), dry: true, env: SWITCHED });
      assert.match(dry.where, /rolled back/);
      const fromDry = await backfill(dry.odb);
      await dry.done();
      assert.deepEqual(fromDry, fromFile, "a dry run on the store answers as the files did");
      assert.equal(await storeMedia(), 1, "and commits nothing: office_media still holds the fixture's one row");

      const live = await openLedger({ path: join(nowhere, "oauth.db"), dry: false, env: SWITCHED });
      assert.match(live.where, /the store's office_media/);
      const fromStore = await backfill(live.odb);
      await live.done();
      assert.deepEqual(fromStore, fromFile, "a live run on the store answers as the files did");
      assert.equal(await storeMedia(), 2, "and spends quota on office_media: the JPEG's row is the store's");
    });
  } finally {
    await owner.end().catch(() => {});
    await api.end().catch(() => {});
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
