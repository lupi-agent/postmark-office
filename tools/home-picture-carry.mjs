#!/usr/bin/env node
// home-picture-carry — each resident's legacy HOME/ picture, carried ONCE onto
// their household's record (POS-219, part one).
//
// THE RULINGS (Keemin, 2026-09-27/28): a house's picture is kept on the
// household's record, one per resident (`households.home_images`, migration
// 050), and the map and the site read it there. HOME/ keeps what is there as
// history. This tool carries what is there today into the record, so no house
// loses the picture it wears now. Wright runs it at the ship: `--dry-run`
// first, then `--apply`. A lane never runs it against a real store or the box.
//
// ── WHICH PICTURE IS "THE HOUSE'S" ──────────────────────────────────────────
//
// The one the site's house card wears today (POS-190, the site's
// src/lib/home-face.mjs `homeFaceOf`): the first image HOME.md declares under
// `assets:` when it names an image in HOME/, otherwise the first image in HOME/
// by filename, never one the region names under REGION.md `assets:`. Carrying
// any other rule would change what a resident sees on the day of the ship.
//
// ── THE SAME WRITER, AND NOTHING OVERWRITTEN ────────────────────────────────
//
// The bytes are minted through `uploadMedia` with the key the door's own
// resolver answers (backfill-home-shelf.mjs § THE HOUSEHOLD IS THE DOOR'S
// ANSWER), and the URL is kept by `setHomePicture` — the one writer every door
// calls. A resident whose record already holds a picture is SKIPPED: that one
// was chosen, and a carry must not undo a choice. The drain runs once at the
// end, not once per house.
//
//   node tools/home-picture-carry.mjs --dry-run --town ./town-clone --oauth-db ./oauth.db --office-db ./office.db
//   node tools/home-picture-carry.mjs --apply   --town ./town-clone --oauth-db ./oauth.db --office-db ./office.db
//
// `--dry-run` mints nothing (the R2 PUT is a mock, the ledger a throwaway copy)
// and writes nothing to the store; it reads the store's current pictures when
// the office is pointed at it, and says so when it is not.

import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const RASTER = /\.(jpe?g|png|webp)$/i;

// The frontmatter's `assets:` as a list, the way the site and the office read
// it: `assets: ["a.png", "b.png"]`, a bare scalar, or absent.
function assetsIn(file) {
  try {
    const text = readFileSync(file, "utf8").replace(/\r/g, "");
    if (!text.startsWith("---")) return [];
    const fm = text.slice(3, text.indexOf("\n---", 3));
    const m = /^assets:\s*(.*)$/m.exec(fm);
    if (!m) return [];
    const v = m[1].trim();
    if (v.startsWith("[")) return (v.match(/"[^"]*"|'[^']*'|[^,\s[\]]+/g) ?? []).map((s) => s.replace(/^["']|["']$/g, ""));
    return v ? [v.replace(/^["']|["']$/g, "")] : [];
  } catch { return []; }
}

/**
 * The picture the house card wears today, as a filename in HOME/, or null.
 * Pure over the clone.
 */
export function leadPicture(clone, handle) {
  const dir = join(clone, "WHITE_PAGES", handle, "HOME");
  if (!existsSync(dir)) return null;
  const region = new Set(assetsIn(join(dir, "REGION.md")));
  const images = readdirSync(dir).filter((f) => RASTER.test(f) && !region.has(f)).sort();
  const declared = assetsIn(join(dir, "HOME.md"))[0];
  if (declared && images.includes(declared)) return declared;
  return images[0] ?? null;
}

/**
 * The carry, injectable end to end so a test needs no box.
 *
 * `householdFor(handle)` is the door's resolver's answer (a key: household +
 * handles); `upload` is uploadMedia; `keep` is setHomePicture; `has(handle)`
 * says whether the record already holds a picture for the handle.
 */
export async function carryHomePictures({ clone, householdFor, upload, keep, has, odb = null, put, onEntry = () => {} }) {
  const kept = [], skipped = { none: [], chosen: [], noHousehold: [], refused: [] };
  const handles = readdirSync(join(clone, "WHITE_PAGES"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== "TEMPLATE" && !e.name.startsWith("_")).map((e) => e.name).sort();
  for (const handle of handles) {
    const file = leadPicture(clone, handle);
    if (!file) { skipped.none.push(handle); continue; }
    if (await has(handle)) { skipped.chosen.push(handle); onEntry({ handle, ok: true, chosen: true }); continue; }
    const key = householdFor(handle);
    if (!key?.household || !key.handles?.has(handle)) {
      skipped.noHousehold.push(handle);
      onEntry({ handle, ok: false, why: "the door's resolver knows no household holding this handle" });
      continue;
    }
    try {
      const bytes = readFileSync(join(clone, "WHITE_PAGES", handle, "HOME", file));
      const minted = await upload({ by: handle }, key, odb, { bytes, clone, ...(put ? { put } : {}) });
      const r = await keep({ handle, url: minted.url }, key, { clone, drain: async () => ({ ran: false }) });
      kept.push({ handle, file, url: minted.url, household: r.household, already: minted.already === true });
      onEntry({ handle, ok: true, file, url: minted.url, household: r.household });
    } catch (e) {
      const row = { handle, file, code: e?.code ?? null, why: e?.defect ?? e?.message ?? String(e) };
      skipped.refused.push(row);
      onEntry({ handle, ok: false, ...row });
    }
  }
  return { kept, skipped };
}

// ── entry guard (backfill-home-shelf.mjs § the junction lesson) ─────────────
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) {
  const argv = process.argv.slice(2);
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const DRY = argv.includes("--dry-run");
  const APPLY = argv.includes("--apply");
  if (DRY === APPLY) { console.error("home-picture-carry: pass exactly one of --dry-run or --apply"); process.exit(2); }
  const TOWN = resolve(opt("--town", process.env.TOWN_CLONE ?? "town-clone"));
  const OAUTH_DB = resolve(opt("--oauth-db", "oauth.db"));
  const OFFICE_DB = resolve(opt("--office-db", process.env.OFFICE_DB ?? "office.db"));
  if (!existsSync(join(TOWN, "WHITE_PAGES"))) { console.error(`--town must name a town clone holding WHITE_PAGES/ (got: ${TOWN})`); process.exit(2); }

  process.env.TOWN_CLONE = TOWN;
  if (DRY) for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) if (!process.env[k]) process.env[k] = "dry-run";
  const { uploadMedia, mediaConfigured } = await import("../src/media.mjs");
  const { openOauthDb, oauthSchema, householdFor } = await import("../src/oauth.mjs");
  const { openPaper } = await import("../src/paperwork.mjs");
  const { setHomePicture } = await import("../src/home-picture.mjs");
  const { loadRegistry } = await import("../src/registry-store.mjs");
  const { homePictureIn } = await import("../src/registry-rows.mjs");
  const { drainRegistry } = await import("./registry-drain.mjs");
  const { DatabaseSync } = await import("node:sqlite");

  if (!DRY && !mediaConfigured()) { console.error("the media door has no credentials here — run this on the box"); process.exit(2); }
  const registry = await loadRegistry();
  if (registry === null && !DRY) { console.error("this office is not pointed at the record (WORLD2_PG=1 + WORLD2_PG_URL) — nothing can be kept"); process.exit(2); }

  // The door's resolver, asked the way backfill-home-shelf.mjs asks it: the
  // town's pins first, the residents index's ADDRESS github binding second.
  const idx = existsSync(OFFICE_DB) ? new DatabaseSync(OFFICE_DB, { readOnly: true }) : (() => {
    const d = new DatabaseSync(":memory:"); d.exec("CREATE TABLE residents (handle TEXT PRIMARY KEY, json TEXT)"); return d;
  })();
  const pins = (() => { try { return JSON.parse(readFileSync(join(TOWN, "tools", "github-ids.json"), "utf8")); } catch { return {}; } })();
  const loginOf = (handle) => {
    try {
      const row = idx.prepare("SELECT json FROM residents WHERE handle = ?").get(handle);
      const d = row ? JSON.parse(row.json) : null;
      return (d?.github ?? d?.address?.data?.github ?? "") || null;
    } catch { return null; }
  };
  const doorHouseholdFor = (handle) => {
    const pin = pins[handle];
    const ghId = pin?.id ?? null, ghLogin = pin?.login ?? loginOf(handle);
    return ghId == null && !ghLogin ? null : householdFor(TOWN, idx, ghId, ghLogin);
  };

  let dbPath = OAUTH_DB, tmp = null;
  if (DRY) { tmp = mkdtempSync(join(tmpdir(), "home-picture-carry-")); dbPath = join(tmp, "oauth.db"); if (existsSync(OAUTH_DB)) copyFileSync(OAUTH_DB, dbPath); }
  // THE LEDGER THE DOOR WRITES (POS-271). --apply opens it the way the server
  // does, so a switched office (OFFICE_PAPERWORK_STORE=1) writes the media rows
  // into the store's office_media, not into a file it no longer reads.
  // --dry-run opens a throwaway COPY of the file and never the store: the file
  // is the store's mirror when switched, so its reads (what this household
  // holds, what its quota has spent) are the real state, and nothing is kept.
  const odb = DRY ? openOauthDb(dbPath) : await openPaper(OAUTH_DB, { schema: oauthSchema });
  const put = DRY ? async () => {} : undefined;
  const keep = DRY ? async ({ handle }) => ({ household: Object.entries(registry?.households ?? {}).find(([, r]) => (r.residents ?? []).includes(handle))?.[0] ?? "(no record here)" }) : setHomePicture;

  console.log(`${DRY ? "[dry-run] " : ""}carrying HOME/ pictures onto the household record — town ${TOWN}${registry === null ? " — the office is NOT pointed at the record, so no picture reads as already chosen" : ""}`);
  const { kept, skipped } = await carryHomePictures({
    clone: TOWN, householdFor: doorHouseholdFor, upload: uploadMedia, keep, odb, put,
    has: async (h) => Boolean(homePictureIn(registry, h)),
    onEntry: (e) => console.log(e.chosen ? `  = ${e.handle}  already holds a picture — left as chosen`
      : e.ok ? `  ✓ ${e.handle}  ${e.household}  ${e.file} → ${e.url}` : `  ✗ ${e.handle}  ${e.code ?? "-"}: ${e.why}`),
  });
  if (!DRY && kept.length) {
    const drained = await drainRegistry({ clone: TOWN, note: `${kept.length} house pictures carried from HOME/ onto the household record (POS-219, home-picture-carry)` });
    console.log(`  drain: ${drained.refused ? `REFUSED — ${drained.refused}` : drained.commit ? `committed ${drained.commit}` : "nothing changed"}`);
  }
  console.log(`\n${DRY ? "[dry-run] would keep" : "kept"} ${kept.length}; already chosen ${skipped.chosen.length}; no picture ${skipped.none.length}; no household ${skipped.noHousehold.length}; refused ${skipped.refused.length}`);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  process.exit(skipped.refused.length ? 1 : 0);
}
