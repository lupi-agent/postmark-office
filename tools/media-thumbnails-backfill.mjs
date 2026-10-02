#!/usr/bin/env node
// media-thumbnails-backfill — cut the small copies for originals that predate
// them (postmark#2940, Keemin 2026-09-18).
//
// Since #2940 the media door puts two small copies beside every raster
// original it takes (`-96` for the map's faces, `-256` for its home cards —
// src/media.mjs § the small copies). Everything uploaded BEFORE that has an
// original and nothing beside it, and the viewer draws those from the
// original until a copy exists. This tool walks the originals, asks the media
// host which copies are already there, and mints exactly the ones that are
// not. One-time by intent; harmless to run again (a second run finds nothing
// lacking and writes nothing).
//
// THE DOOR'S OWN MINT, THE DOOR'S OWN PUT. The copies are cut by
// media.mjs's mintThumbnails — the same crop, the same format rule, the same
// quality — and written by the same r2Put the upload takes, at the same
// derivable names. Nothing here composes a key of its own. The ORIGINAL IS
// NEVER TOUCHED: not re-encoded, not renamed, not re-put. And the ledger is
// never written — a copy is the town's derivative, not a household's upload,
// and the wall does not see it (§ the small copies).
//
// WHICH ORIGINALS. Two enumerations, and the media host is asked either way:
//
//   --ledger <oauth.db>   (default: ./oauth.db)  every row of the office's own
//                         media table — the door's record of what it has put.
//                         This is the run on the box.
//   --from-record <world-state.json>  every media url a mark in the record
//                         carries — the originals the map actually draws.
//                         Needs no ledger, so a dry run can be made from any
//                         clone; on the box the ledger is the wider list.
//
// DRY BY DEFAULT. Without --apply the tool lists every original lacking a
// copy and which, reads nothing but HEADs, and writes nothing. --apply GETs
// each lacking original from the media host (public), cuts what is missing,
// and puts it — it needs the R2 credentials in the environment
// (/etc/postmark-office.env on the box) and refuses without them.
//
//   node tools/media-thumbnails-backfill.mjs                         # dry, from ./oauth.db
//   node tools/media-thumbnails-backfill.mjs --from-record ../world/WORLD/world-state.json
//   node tools/media-thumbnails-backfill.mjs --apply --out backfill-receipt.json
//   node tools/media-thumbnails-backfill.mjs --apply --limit 5        # a trial: the first five lacking
//
// An original the host does not hold (a 404 on the original itself) is NAMED
// and skipped, as is one libvips cannot read — the site learned twice that one
// corrupt upload must not kill the run for everyone else (postmark-site
// tools/lib/images.mjs). A host that answers something other than 200 or 404
// to a HEAD is "unknown", listed, and not minted: a copy is written only where
// the host has said it is absent.

import { existsSync, writeFileSync, realpathSync } from "node:fs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// ── the core, injectable end to end so a test needs no host and no bucket ───
//
// `head(url)` answers a status; `get(url)` answers `{ status, bytes }`;
// `put(objectKey, bytes, mediaType)` is the door's r2Put; `mint(bytes, ext,
// { sizes })` is the door's mintThumbnails. Every default is the real thing.
export async function backfillThumbnails({
  originals, head, get, put, mint, apply = false, sizes, limit = Infinity,
  keyFor, formats, onEntry = () => {},
}) {
  const out = { lacking: [], complete: [], svg: [], unknown: [], missing: [], unprocessable: [], minted: [], failed: [] };
  const seen = new Set();
  for (const o of originals) {
    const id = `${o.household}/${o.sha}.${o.ext}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (!formats.includes(o.ext)) { out.svg.push({ ...o, id }); continue; }
    const lacks = [], unsure = [];
    for (const size of sizes) {
      const status = await head(o.urlFor(size));
      if (status === 200) continue;
      if (status === 404) lacks.push(size); else unsure.push({ size, status });
    }
    if (unsure.length) { out.unknown.push({ ...o, id, unsure }); onEntry({ id, verdict: "unknown", unsure }); continue; }
    if (!lacks.length) { out.complete.push({ ...o, id }); continue; }
    const entry = { ...o, id, lacks };
    out.lacking.push(entry);
    onEntry({ id, verdict: "lacking", lacks });
  }
  if (!apply) return out;

  let done = 0;
  for (const o of out.lacking) {
    if (done >= limit) break;
    done += 1;
    const src = await get(o.url);
    if (src.status === 404) { out.missing.push(o); onEntry({ id: o.id, verdict: "missing" }); continue; }
    if (src.status !== 200) { out.failed.push({ ...o, why: `the host answered ${src.status} for the original` }); onEntry({ id: o.id, verdict: "failed", why: `GET ${src.status}` }); continue; }
    let copies;
    try { copies = await mint(src.bytes, o.ext, { sizes: o.lacks }); }
    catch (e) { out.unprocessable.push({ ...o, why: e?.message ?? String(e) }); onEntry({ id: o.id, verdict: "unprocessable", why: e?.message }); continue; }
    const written = [];
    try {
      for (const c of copies) {
        await put(keyFor(o.household, o.sha, o.ext, c.size), c.bytes, c.mediaType);
        written.push(c.size);
      }
      out.minted.push({ ...o, sizes: written });
      onEntry({ id: o.id, verdict: "minted", sizes: written });
    } catch (e) {
      out.failed.push({ ...o, why: e?.defect ?? e?.message ?? String(e), written });
      onEntry({ id: o.id, verdict: "failed", why: e?.defect ?? e?.message, written });
    }
  }
  return out;
}

/** The originals a world record's marks carry, in the door's own grammar. */
export function originalsFromRecord(record, { base, sizes, thumbUrlFor }) {
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/media/([A-Za-z0-9][A-Za-z0-9._-]*)/([0-9a-f]{64})\\.([a-z0-9]+)$`);
  const out = [];
  for (const m of record?.marks ?? []) {
    const g = typeof m?.image === "string" ? re.exec(m.image.trim()) : null;
    if (!g) continue;
    const [, household, sha, ext] = g;
    out.push({ household, sha, ext, url: m.image.trim(), urlFor: (size) => thumbUrlFor(household, sha, ext, size), from: m.id });
  }
  return out;
}

/**
 * The originals the office's own ledger records, oldest first. `odb` is a
 * paper (src/paperwork.mjs) or a node:sqlite handle on oauth.db, which
 * `asPaper` makes one.
 */
export async function originalsFromLedger(odb, { mediaUrlFor, thumbUrlFor }) {
  const { asPaper } = await import("../src/paperwork.mjs");
  return (await asPaper(odb).all("SELECT household, sha, ext FROM media ORDER BY created ASC, sha ASC")).map((r) => ({
    household: r.household, sha: r.sha, ext: r.ext,
    url: mediaUrlFor(r.household, r.sha, r.ext),
    urlFor: (size) => thumbUrlFor(r.household, r.sha, r.ext, size),
  }));
}

// ── the CLI ──────────────────────────────────────────────────────────────────
function isMain() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const APPLY = argv.includes("--apply");
  const LIMIT = Number(opt("--limit", Infinity));
  const OUT = opt("--out", null);
  const RECORD = opt("--from-record", null);
  const LEDGER = resolve(opt("--ledger", "./oauth.db"));

  const media = await import("../src/media.mjs");
  const { MEDIA_BASE, THUMB_SIZES, THUMB_FORMATS, thumbUrlFor, thumbObjectKey, mediaUrlFor, mintThumbnails, r2Put, mediaConfigured } = media;

  let originals, source;
  if (RECORD) {
    if (!existsSync(RECORD)) { console.error(`no record at ${RECORD}`); process.exit(2); }
    originals = originalsFromRecord(JSON.parse(readFileSync(RECORD, "utf8")), { base: MEDIA_BASE, sizes: THUMB_SIZES, thumbUrlFor });
    source = `the record's marks (${RECORD})`;
  } else {
    // THE OFFICE'S OWN SWITCH (POS-271). With OFFICE_PAPERWORK_STORE=1 the
    // ledger is the store's office_media and oauth.db is only the rollback's
    // mirror, so the originals are read from the store; unswitched, from the
    // file, as before.
    const { openPaper, paperworkStoreOn, closePaperworkPools } = await import("../src/paperwork.mjs");
    const switched = paperworkStoreOn();
    if (!switched && !existsSync(LEDGER)) { console.error(`no ledger at ${LEDGER} — pass --ledger <oauth.db>, or --from-record <world-state.json> to walk the marks instead`); process.exit(2); }
    let odb;
    try { odb = await openPaper(LEDGER, { readOnly: true }); }
    catch (e) { console.error(`could not reach the store's media ledger (OFFICE_PAPERWORK_STORE=1): ${String(e?.message ?? e)}`); process.exit(2); }
    try { originals = await originalsFromLedger(odb, { mediaUrlFor, thumbUrlFor }); }
    finally { odb.close(); if (switched) await closePaperworkPools(); }
    source = switched ? "the media ledger (the store's office_media)" : `the media ledger (${LEDGER})`;
  }
  if (APPLY && !mediaConfigured()) {
    console.error("--apply needs the R2 credentials in the environment (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) — on the box, /etc/postmark-office.env");
    process.exit(2);
  }

  const head = async (url) => { try { return (await fetch(url, { method: "HEAD" })).status; } catch { return 0; } };
  const get = async (url) => {
    const r = await fetch(url);
    return { status: r.status, bytes: r.ok ? Buffer.from(await r.arrayBuffer()) : null };
  };

  console.log(`${APPLY ? "" : "[dry] "}small copies for the originals of ${source}`);
  console.log(`  host   ${MEDIA_BASE}`);
  console.log(`  sizes  ${THUMB_SIZES.join(", ")}  (formats ${THUMB_FORMATS.join(", ")}; svg mints none)`);
  console.log(`  originals ${originals.length}`);
  console.log("");
  const r = await backfillThumbnails({
    originals, head, get, put: r2Put, mint: mintThumbnails, apply: APPLY, sizes: THUMB_SIZES, limit: LIMIT,
    keyFor: thumbObjectKey, formats: THUMB_FORMATS,
    onEntry: (e) => {
      const tag = e.verdict === "lacking" ? `lacks ${e.lacks.map((s) => `-${s}`).join(" ")}`
        : e.verdict === "minted" ? `minted ${e.sizes.map((s) => `-${s}`).join(" ")}`
        : e.verdict === "unknown" ? `unknown: ${e.unsure.map((u) => `-${u.size} answered ${u.status}`).join(", ")}`
        : `${e.verdict}${e.why ? `: ${e.why}` : ""}`;
      console.log(`  ${e.verdict === "lacking" && APPLY ? "·" : e.verdict === "minted" ? "✓" : e.verdict === "lacking" ? "○" : "✗"} ${e.id.replace(/\/([0-9a-f]{12})[0-9a-f]{52}\./, "/$1….")}  ${tag}`);
    },
  });
  const n = (a) => a.length;
  console.log("");
  console.log(`${APPLY ? "" : "[dry] "}${n(r.lacking)} original${n(r.lacking) === 1 ? "" : "s"} lacking a copy · ${n(r.complete)} complete · ${n(r.svg)} svg (none by design) · ${n(r.unknown)} unknown`);
  if (APPLY) {
    console.log(`  ${n(r.minted)} minted${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ""} · ${n(r.missing)} not behind the door · ${n(r.unprocessable)} unprocessable · ${n(r.failed)} failed`);
    for (const row of [...r.missing, ...r.unprocessable, ...r.failed]) console.log(`    ✗ ${row.id}${row.why ? ` — ${row.why}` : ""}`);
  } else if (n(r.lacking)) {
    const bySize = Object.fromEntries(THUMB_SIZES.map((s) => [s, r.lacking.filter((o) => o.lacks.includes(s)).length]));
    console.log(`  by size: ${Object.entries(bySize).map(([s, c]) => `-${s} ×${c}`).join(", ")} — --apply mints exactly these`);
  }
  if (OUT) {
    const strip = (rows) => rows.map(({ urlFor, ...rest }) => rest);
    writeFileSync(OUT, JSON.stringify({
      _note: `${APPLY ? "applied" : "dry run"} ${new Date().toISOString()} over ${source}; every copy is cut by src/media.mjs mintThumbnails and put by its r2Put at thumbObjectKey — nothing here composes a key`,
      host: MEDIA_BASE, sizes: THUMB_SIZES, applied: APPLY, limit: Number.isFinite(LIMIT) ? LIMIT : null,
      counts: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.length])),
      ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, strip(v)])),
    }, null, 1) + "\n");
    console.log(`  receipt → ${OUT}`);
  }
  if (r.failed.length) process.exit(1);
}

if (isMain()) main().catch((e) => { console.error(e?.stack ?? e); process.exit(1); });
