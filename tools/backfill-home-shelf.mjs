#!/usr/bin/env node
// backfill-home-shelf — mint the town's legacy HOME art through the media door.
//
// The ruling this serves (Keemin, 2026-08-21): residents hung art on their HOME
// pages long before the world had a media door, and "simply mailing residents to
// reupload images to our media is not an option." So the office does the
// carrying. The world repo's tools/home-image-select.mjs reads the town's own
// record and names each household's lead image; this tool hands those bytes to
// the media door and brings back the URLs a parcel mark may carry.
//
// THE MEDIA DOOR IS THE ONLY MINT. This tool composes no URL of its own and skips no
// check of the door's. Every entry goes through the SAME `uploadMedia` the
// REST door and the MCP tool land in (src/media.mjs) — same decodeImage size
// gate, same magic-byte sniff, same content-addressed key, same
// same-bytes-same-URL dedup, same per-household quota wall, same row in odb's
// `media` table. The URL in the output file is the string that handler returned
// and nothing else. There is no second validation lane here, and nothing here
// is reachable over HTTP: this is a CLI an operator runs on the box, so the
// door's auth is neither used nor weakened — the credential it would have
// checked is replaced by the operator already being root on the machine that
// holds the R2 keys.
//
// THE HOUSEHOLD IS THE DOOR'S ANSWER, NOT OURS — and it is a DIFFERENT
// vocabulary from the economy's, which is the trap this tool exists to not fall
// into. The media door keys on `key.household`, and the only place that string is
// ever minted is oauth.mjs `householdFor`: `ghLogin ?? String(ghId)`, from the
// town's pins. The ECONOMY's household key for the same resident is
// `gh:<id>` / `login:<x>` / `hh:<slug>` (src/households.mjs, stamp-mint's
// currentHouseholds) — a different string for the same house, and one that
// carries a colon, which `mediaUrlOk` and tools/mark-lint.mjs both refuse. A
// backfill keyed on the economy's answer would mint 61 URLs that no mark door
// in the town will accept and no viewer will draw.
//
// So this calls the door's own resolver with the door's own arguments, and
// passes the object it returns straight through as the key: same media path,
// same quota ceiling (its `handles` set is what the per-resident ceiling
// multiplies), same ledger grain as that resident's own upload. A handle the
// pins do not know is NAMED and skipped, never guessed into a household.
//
// Run on the box (where /etc/postmark-office.env holds the R2 credentials):
//   node tools/backfill-home-shelf.mjs \
//     --manifest <staging>/home-image-manifest.json --staging <staging> \
//     --town ./town-clone --oauth-db ./oauth.db --office-db ./office.db \
//     --out home-image-urls.json
//
// `--dry` proves the whole leg without credentials or a bucket: the R2 PUT is a
// mock that records its arguments, and the ledger is a THROWAWAY COPY of odb —
// so the reads that matter (what this household already holds, how much of its
// quota is spent) are the real current state, while nothing is written to the
// office's own DB. It reports exactly what a real run would write.

import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// ── the core, injectable end to end so a test needs no box ───────────────────
//
// `upload` is the office's own uploadMedia by default and is never replaced in
// a real run — a caller that passes its own is a test, and the test that proves
// the URLs come from the handler is the one that would catch a tool which
// started composing them itself.
export async function backfillHomeShelf({
  images, stagingDir, householdFor, upload, odb, put,
  onEntry = () => {},
}) {
  const urls = {};
  const skipped = { noHousehold: [], missingBytes: [], refused: [] };
  const dedup = [], minted = [];

  for (const handle of Object.keys(images).sort()) {
    const rec = images[handle];
    const block = await householdFor(handle);
    if (!block?.household) { skipped.noHousehold.push({ handle, why: "the door's resolver knows no household for this handle — the town's pins do not carry it" }); continue; }
    if (!block.handles?.has(handle)) { skipped.noHousehold.push({ handle, household: block.household, why: `the resolved household does not hold "${handle}" — the door would refuse this upload 403` }); continue; }

    const file = join(stagingDir, "files", `${handle}.${rec.format}`);
    if (!existsSync(file)) { skipped.missingBytes.push({ handle, file, why: "no staged bytes — re-run the selector" }); continue; }
    const bytes = readFileSync(file);

    // The key IS what the door's resolver returned — passed through, never
    // rebuilt. A hand-rolled `handles` set would quietly change the quota
    // ceiling, and a hand-rolled `household` would change the media door path.
    try {
      // POS-150: inline base64 is no longer one of the door's inputs. This tool
      // is not a caller at the door — it runs inside the office with the
      // originals already in hand on the box — so it hands the bytes to the
      // handler through the in-process seam (media.mjs § `bytes` IS NOT A DOOR)
      // rather than re-encoding them into a field that no longer exists.
      const r = await upload({ by: handle }, block, odb, { put, bytes });
      urls[handle] = r.url;
      // HOW MANY OBJECTS ACTUALLY REACHED STORAGE, counted where the answer is
      // knowable rather than where it was convenient. uploadMedia reaches its
      // ledger INSERT only after `await put(...)` has resolved, and it answers
      // `already: true` on the dedup branch WITHOUT calling put at all — so a
      // result that is neither a throw nor `already` is exactly one object
      // written, in a real run and a dry one alike.
      //
      // This used to be counted by pushing to an array from inside the DRY
      // mock, which made the count structurally zero on every real run: the box
      // wrote 57 objects and the run said "no new objects" (2026-08-21). A
      // counter that can only be right in the mode that does not matter is
      // worse than none.
      if (r.already) dedup.push(handle); else minted.push(handle);
      onEntry({ handle, ok: true, url: r.url, already: !!r.already, household: block.household, bytes: r.bytes, quota: r.quota });
    } catch (e) {
      const row = { handle, household: block.household, file: rec.file, code: e?.code ?? null, why: e?.defect ?? e?.message ?? String(e) };
      skipped.refused.push(row);
      onEntry({ handle, ok: false, ...row });
    }
  }
  return { urls, skipped, dedup, minted };
}

// ── the ledger ───────────────────────────────────────────────────────────────

/**
 * The media ledger this run spends quota on, and how to put it away (POS-271).
 * The office's own switch decides where it is:
 *
 *   unswitched   oauth.db, as always. A DRY run gets a throwaway COPY: every
 *                read (what this household already holds, what its quota has
 *                spent) is the real current state, and every write lands in a
 *                file deleted at the end.
 *   switched     the store's office_media (OFFICE_PAPERWORK_STORE=1), the paper
 *                the office itself writes, with oauth.db as its rollback mirror
 *                when the file is here. A DRY run is ONE store client inside a
 *                transaction that `done()` rolls back: the same real reads, and
 *                writes that are never committed. Copying the file instead
 *                would read the mirror, which is the store's past.
 *
 * `where` says which, for the run's own header. `done()` closes the file,
 * removes a dry copy, rolls a dry transaction back and closes the store pool.
 */
export async function openLedger({ path, dry = false, env = process.env }) {
  const { openOauthDb, oauthSchema } = await import("../src/oauth.mjs");
  const { openPaper, paperOnPool, paperworkStoreOn, closePaperworkPools } = await import("../src/paperwork.mjs");
  if (!paperworkStoreOn(env)) {
    if (!dry) {
      const odb = openOauthDb(path);
      return { odb, where: path, done: async () => { try { odb.close(); } catch { /* already closed */ } } };
    }
    const tmp = mkdtempSync(join(tmpdir(), "backfill-home-shelf-"));
    const copy = join(tmp, "oauth.db");
    const had = existsSync(path);
    if (had) copyFileSync(path, copy);
    const odb = openOauthDb(copy);
    return {
      odb, where: `${copy}  (throwaway copy of ${path}${had ? "" : " — which does not exist here, so the copy is empty"})`,
      // close before removing: an open sqlite handle holds the throwaway file
      // open on Windows, and the rm answers EPERM over a run that otherwise
      // succeeded
      done: async () => { try { odb.close(); } catch { /* already closed */ } rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); },
    };
  }
  if (!dry) {
    const odb = await openPaper(path, { schema: oauthSchema, env });
    return { odb, where: `the store's office_media${odb.file ? `, mirrored to ${path}` : ""}`, done: async () => { odb.close(); await closePaperworkPools(); } };
  }
  const reader = await openPaper(path, { readOnly: true, env });
  const client = await reader.pool.connect();
  await client.query("BEGIN");
  const odb = paperOnPool({ query: (sql, args) => client.query(sql, args) });
  return {
    odb, where: "the store's office_media, inside one transaction rolled back at the end — nothing is committed",
    done: async () => {
      try { await client.query("ROLLBACK"); } finally { client.release(); await closePaperworkPools(); }
    },
  };
}

// ── entry guard ──────────────────────────────────────────────────────────────
// The junction lesson (2026-09-05, HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry path reaches this file through a Windows junction — the ESM loader
// realpaths the entry, argv[1] is not — so the tool exits 0 having done nothing.
// Compare real paths (world2/tools/await-clearing.mjs's idiom); the URL compare is
// only the fallback for an argv[1] that cannot be realpath'd. The office's
// test/cli-guard.test.mjs imports this file and spawns it through a junction.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const DRY = argv.includes("--dry");
  const STAGING = resolve(opt("--staging", ".home-image-staging"));
  const MANIFEST = resolve(opt("--manifest", join(STAGING, "home-image-manifest.json")));
  const TOWN = resolve(opt("--town", process.env.TOWN_CLONE ?? "town-clone"));
  const OAUTH_DB = resolve(opt("--oauth-db", "oauth.db"));
  const OFFICE_DB = resolve(opt("--office-db", process.env.OFFICE_DB ?? "office.db"));
  const OUT = resolve(opt("--out", "home-image-urls.json"));

  if (!existsSync(MANIFEST)) { console.error(`no manifest at ${MANIFEST} — run the world repo's tools/home-image-select.mjs first`); process.exit(2); }
  if (!existsSync(join(TOWN, "WHITE_PAGES"))) { console.error(`--town must name a town clone holding WHITE_PAGES/ (got: ${TOWN})`); process.exit(2); }

  // Credentials, then the modules that read them: media.mjs freezes MEDIA_BASE
  // and the bucket at module load, and households.mjs resolves TOWN_CLONE the
  // same way, so both must be settled before the imports below.
  process.env.TOWN_CLONE = TOWN;
  const stubbed = [];
  if (DRY) {
    // Placeholders ONLY on this branch, and this branch is also the one that
    // hands `put` a mock — so no configuration of this tool can reach a bucket
    // with a credential it did not truly have. mediaConfigured() is a HONESTY
    // gate about the box, not a security wall; the wall is `put`.
    for (const [k, v] of [["R2_ACCOUNT_ID", "dry-run"], ["R2_ACCESS_KEY_ID", "dry-run"], ["R2_SECRET_ACCESS_KEY", "dry-run"]])
      if (!process.env[k]) { process.env[k] = v; stubbed.push(k); }
  }
  const { uploadMedia, mediaConfigured, MEDIA_BASE } = await import("../src/media.mjs");
  const { householdFor } = await import("../src/oauth.mjs");
  const { loadPins } = await import("../src/registry-store.mjs");
  const { DatabaseSync } = await import("node:sqlite");

  // The door's resolver wants the arguments the door has: a verified GitHub id
  // and login. On the door those come from the token; here they come from the
  // town's pins, which is where the token's id is matched against handles
  // anyway. An unpinned handle falls back to the residents index's own ADDRESS
  // github binding — the same second source householdFor itself consults.
  // householdFor reads the residents index without a guard, so it always gets a
  // real handle: the office's own index where there is one, an empty in-memory
  // stand-in where there is not (the pins carry every handle that matters, and
  // an absent index must narrow the answer, never crash the run).
  const idx = existsSync(OFFICE_DB) ? new DatabaseSync(OFFICE_DB, { readOnly: true }) : (() => {
    const d = new DatabaseSync(":memory:");
    d.exec("CREATE TABLE residents (handle TEXT PRIMARY KEY, json TEXT)");
    return d;
  })();
  // The store's pins (POS-345): the record, never the printed tools/github-ids.json.
  const pins = await loadPins();
  if (pins === null) { console.error("backfill-home-shelf: this office is not pointed at the store (WORLD2_PG=1 and WORLD2_PG_URL), so it cannot read the pins — nothing uploaded"); process.exit(2); }
  const loginOf = (handle) => {
    try {
      const row = idx.prepare("SELECT json FROM residents WHERE handle = ?").get(handle);
      if (!row) return null;
      const d = JSON.parse(row.json);
      return (d.github ?? d.address?.data?.github ?? "") || null;
    } catch { return null; }
  };
  const doorHouseholdFor = (handle) => {
    const pin = pins[handle];
    const ghId = pin?.id ?? null;
    const ghLogin = pin?.login ?? loginOf(handle);
    if (ghId == null && !ghLogin) return null;
    return householdFor(idx, ghId, ghLogin);
  };

  if (!DRY && !mediaConfigured()) {
    console.error("the media door has no credentials in this environment — run this on the box, where /etc/postmark-office.env is loaded");
    process.exit(2);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const images = manifest.images ?? {};

  const ledger = await openLedger({ path: OAUTH_DB, dry: DRY });
  const { odb } = ledger;

  // The dry mock stands in for the R2 PUT and records what it was handed. Its
  // tally is a CROSS-CHECK, never the headline count — see the note in
  // backfillHomeShelf on why the objects-written number is derived from the
  // handler's own answers instead.
  const mockedPuts = [];
  const put = DRY ? async (objectKey, bytes, mediaType) => { mockedPuts.push({ objectKey, bytes: bytes.length, mediaType }); } : undefined;

  console.log(`${DRY ? "[dry] " : ""}backfilling ${Object.keys(images).length} home images through the media door`);
  console.log(`  manifest ${MANIFEST}`);
  console.log(`  staging  ${STAGING}`);
  console.log(`  town     ${TOWN}`);
  console.log(`  ledger   ${ledger.where}`);
  if (stubbed.length) console.log(`  note     R2 credentials absent; ${stubbed.join(", ")} stubbed for the dry run and the PUT is mocked`);
  console.log("");

  const { urls, skipped, dedup, minted } = await backfillHomeShelf({
    images, stagingDir: STAGING, householdFor: doorHouseholdFor, upload: uploadMedia, odb,
    ...(put ? { put } : {}),
    onEntry: (e) => console.log(e.ok
      ? `  ✓ ${e.handle}  ${e.household}  ${e.url}${e.already ? "  (already on the media door — no quota spent)" : ""}`
      : `  ✗ ${e.handle}  ${e.household}  ${e.code ?? "-"}: ${e.why}`),
  });

  const out = {
    _note: `DERIVED — every URL here was returned by the office's own uploadMedia (src/media.mjs), the same handler POST /media and the MCP upload_media land in. Consumed by the world repo's tools/home-image-backfill.mjs.${DRY ? " THIS IS A DRY RUN: no bytes reached storage and the office's own ledger was not written." : ""}`,
    generated_at: new Date().toISOString(),
    dry: DRY, media_base: MEDIA_BASE,
    // `urls` is how many handles got a URL; `objects` is how many of those had
    // to be written. They differ by exactly the dedup hits, and conflating them
    // is what made a real run report nothing.
    counts: { urls: Object.keys(urls).length, objects: minted.length, already: dedup.length, noHousehold: skipped.noHousehold.length, missingBytes: skipped.missingBytes.length, refused: skipped.refused.length },
    urls, skipped,
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);

  console.log(`\n${DRY ? "[dry] " : ""}${out.counts.urls} URLs → ${OUT}`);
  console.log(`  ${minted.length} object${minted.length === 1 ? "" : "s"} ${DRY ? "would have been written" : "written"}${dedup.length ? `; ${dedup.length} already behind the door, no bytes sent and no quota spent (${dedup.join(", ")})` : ""}`);
  // In dry mode the mock saw every call the real PUT would have taken, so the
  // two numbers must agree. If they ever do not, the count above is describing
  // something other than what reaches storage and should not be believed.
  // …counting ORIGINALS: since postmark#2940 the door also puts two small
  // copies (-96, -256) beside each raster original, and those are not objects
  // this tool counts.
  const mockedOriginals = mockedPuts.filter((p) => !/-(?:96|256)\.[a-z]+$/.test(p.objectKey));
  if (DRY && mockedOriginals.length !== minted.length)
    console.error(`  ⚠ the mocked PUT saw ${mockedOriginals.length} original(s) but ${minted.length} object(s) were counted — the counter and the storage call disagree`);
  for (const [name, rows] of Object.entries(skipped)) {
    if (!rows.length) continue;
    console.log(`  ${name} (${rows.length}):`);
    for (const r of rows) console.log(`    ✗ ${r.handle} — ${r.why}${r.file ? `  [${basename(r.file)}]` : ""}`);
  }

  await ledger.done();
  // A run that hands back no URL at all did not do its job, however it failed —
  // and the box's first real run is why this exits loudly: CR-tainted R2 env
  // made every PUT throw, and the honest answer is a non-zero exit with every
  // entry named in skipped.refused, not a quiet file full of nothing.
  if (!out.counts.urls) { console.error("no URLs minted — refusing to call that success"); process.exit(1); }
}
