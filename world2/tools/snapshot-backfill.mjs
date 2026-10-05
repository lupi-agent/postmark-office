#!/usr/bin/env node
// snapshot-backfill.mjs — EVERY SETTLEMENT BEFORE THE SEAL GETS ITS SNAPSHOT,
// FROM ITS TAG (POS-358; 065_snapshot_backfill.sql).
//
//   node world2/tools/snapshot-backfill.mjs --world-repo <world clone> --town-repo <town clone>
//        [--from <n>] [--to <n>]   the settlement numbers (default: every settlement/S<n> tag)
//        [--apply]                 write (as world2_owner); the default is a dry run that writes nothing
//        [--pg-url <url>]          else WORLD2_PG_URL; the dry run reads `settlements` if it can
//        [--json <file>]           the per-tag receipt
//
//   EXIT: 0 every tag written (or, dry, derivable) · 1 a tag refused (each named) · 2 cannot run
//
// ── WHAT A BACK-FILLED SNAPSHOT IS (Darko 2026-10-05, POS-410; Wright, POS-358) ──
//
// The same SOURCES a clearing's seal keeps, built from the settlement tag's tree:
//
//   marks       every standing mark at the tag: the seed's own derivation
//               (seed-import.mjs § deriveSeed, the reader that built the store),
//               turned into the seal's canonical row, hashed BY POSTGRES with the
//               seal's expression, so a version means the same bytes either way
//   register    the town's two registry files at the ledger position (the files
//               the store's register is printed as), through the registry's own
//               fold (registry-rows.mjs § rowsFromRegistry). NULL where the town
//               at that sha has no tools/households.json: the history gives none.
//   law_sha,    the tag's commit: the class marks, the skeleton and the engine
//   world_sha   live in the world repo at that sha
//   town_sha    the LEDGER POSITION. No world tag records it, so it is FOUND and
//               the row says how (`town_sha_from`): the sha the tag's message names
//               ("Box Town <sha>"), else town main's last first-parent commit at or
//               before the tag commit's committer date.
//
// THE FOLD CACHE ONLY WHERE IT IS PROVED. For each tag the World is folded at the
// tag's own engine, over the tag's marks in the loader's order, the tag's own
// WORLD/households.json and skeleton, and the stakes replayed from the town at
// the found sha, then compared canonically with the tag's committed
// world-state.json (CRLF in the committed bodies forgiven: S1–S38 were folded
// from a Windows checkout). Only an equal fold is cached, and the cache is that
// fold. Measured 2026-10-04: 79 of 93 (S4–S17 differ on stake weight, so the
// found town sha is not the one their sweep read). A tag that does not match
// still gets its sources; it is named, never refused.
//
// AND WHAT IT DOES NOT TOUCH. A settlement whose row already names a snapshot is
// skipped. A settlement whose window the live seal already sealed is LINKED to
// that snapshot, not rebuilt. `settlements.snapshot_id` is only ever filled,
// never moved. The tag's tree is read from scratch clones this tool makes and
// removes; the clones it is handed are never checked out or written.
//
// THE PEN: world2_owner, once, as a migration (065's header: no pen holds UPDATE
// on `settlements`). One transaction per tag.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deriveSeed } from "./seed-import.mjs";
import { deriveEscrow } from "./escrow-ingest.mjs";
import { stakesFromStore } from "./fold-input.mjs";
import { rowsFromRegistry } from "../../src/registry-rows.mjs";
import { canonicalJson, foldDifference } from "../../src/world-snapshot.mjs";
import { materializeAtRef } from "../../src/world-branches.mjs";

const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }).trim();
const SHA40 = /^[0-9a-f]{40}$/;

/** The sha a tag's message names as the town ("Box Town <sha>", "Town <sha>"), or null. PURE. */
export function namedTownSha(tagMessage) {
  return /\bTown ([0-9a-f]{40})\b/.exec(String(tagMessage ?? ""))?.[1] ?? null;
}

/** The world's committed fold with the escaped CRLF of its bodies made LF (S1–S38's Windows fold). PURE. */
export const lfCommitted = (text) => String(text).replace(/\\r\\n/g, "\\n");

/**
 * The seed's mark rows → the seal's canonical row inputs: { slug, kind, owner,
 * body, geometry, parent (the parent's SLUG), data }. PURE. Every seed row
 * stands, so a parent uuid resolves through the same rows (a missing one is the
 * seed's own refusal, upstream).
 */
export function canonicalInputsOf(seedMarks) {
  const slugById = new Map(seedMarks.map((m) => [String(m.id), m.slug]));
  return seedMarks.map((m) => ({
    slug: m.slug, kind: m.kind, owner: m.owner, body: m.body ?? null, geometry: m.geometry ?? null,
    parent: m.parent != null ? (slugById.get(String(m.parent)) ?? null) : null, data: m.data ?? null,
  }));
}

// THE SEAL'S EXPRESSION, over JSON instead of the `marks` table: the same keys,
// the same jsonb text, the same sha256. test/snapshot-backfill.test.mjs holds the
// two to the same digests over the same marks.
export const MARK_ROWS_FROM_JSON_SQL = `
  SELECT r.slug, r.row, encode(sha256(convert_to(r.row, 'UTF8')), 'hex') AS digest
    FROM (
      SELECT x->>'slug' AS slug,
             jsonb_build_object(
               'slug', x->'slug', 'kind', x->'kind', 'owner', x->'owner', 'body', x->'body',
               'geometry', x->'geometry', 'parent', x->'parent', 'data', x->'data')::text AS row
        FROM jsonb_array_elements($1::jsonb) x
    ) r`;

// And the register's: each row through its own table's type, so `to_jsonb` sees
// exactly the columns a live row has.
export const REGISTER_ROWS_FROM_JSON_SQL = `
  SELECT r.key, r.row, encode(sha256(convert_to(r.row, 'UTF8')), 'hex') AS digest
    FROM (
      SELECT 'households/' || (x->>'slug') AS key,
             (to_jsonb(jsonb_populate_record(NULL::households, x)) || jsonb_build_object('table', 'households'))::text AS row
        FROM jsonb_array_elements($1::jsonb) x
      UNION ALL
      SELECT 'household_pins/' || (x->>'handle'),
             (to_jsonb(jsonb_populate_record(NULL::household_pins, x)) || jsonb_build_object('table', 'household_pins'))::text
        FROM jsonb_array_elements($2::jsonb) x
    ) r`;

const listDigestSql = (rel, keyCol) => `
  SELECT encode(sha256(convert_to(coalesce(string_agg(${keyCol} || ' ' || digest, E'\\n' ORDER BY ${keyCol} COLLATE "C"), ''), 'UTF8')), 'hex') AS d,
         count(*)::int AS n FROM ${rel}`;

/**
 * Write one tag's snapshot inside the caller's transaction. Returns the header.
 * `q` is the owner's connection; `t` the derived tag (see deriveTag).
 */
export async function writeTagSnapshot(q, t) {
  const marksJson = JSON.stringify(t.marks);
  await q(`WITH cur AS (${MARK_ROWS_FROM_JSON_SQL}) INSERT INTO mark_versions (digest, row) SELECT digest, row FROM cur ON CONFLICT (digest) DO NOTHING`, [marksJson]);
  const { rows: [ml] } = await q(`WITH cur AS (${MARK_ROWS_FROM_JSON_SQL}) ${listDigestSql("cur", "slug")}`, [marksJson]);
  await q(`WITH cur AS (${MARK_ROWS_FROM_JSON_SQL}) INSERT INTO world_snapshot_marks (marks_digest, slug, digest) SELECT $2, slug, digest FROM cur ON CONFLICT (marks_digest, slug) DO NOTHING`, [marksJson, ml.d]);
  let registerDigest = null;
  if (t.register) {
    const args = [JSON.stringify(t.register.households), JSON.stringify(t.register.pins)];
    await q(`WITH reg AS (${REGISTER_ROWS_FROM_JSON_SQL}) INSERT INTO register_versions (digest, row) SELECT digest, row FROM reg ON CONFLICT (digest) DO NOTHING`, args);
    const { rows: [rl] } = await q(`WITH reg AS (${REGISTER_ROWS_FROM_JSON_SQL}) ${listDigestSql("reg", "key")}`, args);
    await q(`WITH reg AS (${REGISTER_ROWS_FROM_JSON_SQL}) INSERT INTO world_snapshot_register (register_digest, key, digest) SELECT $3, key, digest FROM reg ON CONFLICT (register_digest, key) DO NOTHING`, [...args, rl.d]);
    registerDigest = rl.d;
  }
  const { rows: [h] } = await q(
    `INSERT INTO world_snapshots (window_id, digest, marks_digest, marks, law_sha, town_sha, world_sha, register_digest, taken_at, source, town_sha_from)
     SELECT $1, encode(sha256(convert_to($2 || ' ' || $3 || ' ' || $4 || ' ' || $5 || coalesce(' ' || $6, ''), 'UTF8')), 'hex'),
            $2, $7, $3, $4, $5, $6, $8, 'backfill', $9
     RETURNING id, digest, marks_digest, marks, register_digest`,
    [t.window_id, ml.d, t.tag_sha, t.town_sha, t.tag_sha, registerDigest, ml.n, t.published_at, t.town_sha_from]);
  if (t.fold_state) await q("INSERT INTO world_snapshot_folds (digest, state) VALUES ($1, $2) ON CONFLICT (digest) DO NOTHING", [h.digest, t.fold_state]);
  await q("UPDATE settlements SET snapshot_id = $2 WHERE number = $1 AND snapshot_id IS NULL", [t.number, h.id]);
  return h;
}

/**
 * A checkout of `ref` in a directory of its own, from one of this tool's scratch
 * clones. A directory per ref, never one moved between refs: the readers import
 * the checkout's own engine (seed-import § readersOf, escrow-ingest's
 * world-stake), and Node keeps a module by its path, so a reused directory would
 * fold S93 with S1's engine. Removed by `dropCheckout`, through git.
 */
function checkout(base, dir, ref) {
  git(base, "worktree", "add", "-q", "--detach", "-f", dir, ref);
  return dir;
}
// THE TOWN, SPARSE. The town's tree is 15,000 files and the reads at a ledger
// position need four kinds of them: the resolver and its siblings (tools/, which
// holds the two registry files too), the weight dial, the stamp ledger, and each
// room's ADDRESS.md (stamp-mint § householdKeys: "ADDRESS.md github login"). The
// S93 test is what proves the list complete: a missing file moves the fold.
const TOWN_PATHS = ["/tools/", "/ECONOMY-DIALS.json", "/WHITE_PAGES/stamp-ledger.md", "/WHITE_PAGES/*/ADDRESS.md"];
function townCheckout(base, dir, sha) {
  git(base, "worktree", "add", "-q", "--detach", "--no-checkout", "-f", dir, sha);
  git(dir, "sparse-checkout", "set", "--no-cone", ...TOWN_PATHS);
  git(dir, "checkout", "-q", "--detach", sha);
  return dir;
}
function dropCheckout(base, dir) {
  try { git(base, "worktree", "remove", "--force", dir); } catch { /* the run's last cleanup removes the scratch root */ }
}

/**
 * Everything one tag's snapshot needs, from the tag's tree and the town at the
 * found ledger position. `W` and `T` are this tool's scratch clones (no
 * checkout of their own); each tag reads checkouts under `scratch`.
 */
export async function deriveTag({ W: base, T: townBase, townRepo, number, scratch }) {
  const tag = `settlement/S${number}`;
  const tag_sha = git(base, "rev-parse", `${tag}^{commit}`);
  const published_at = new Date(git(base, "log", "-1", "--format=%cI", tag_sha)).toISOString();
  let named = namedTownSha(git(base, "cat-file", "-p", tag));
  if (named) { try { git(townRepo, "cat-file", "-e", `${named}^{commit}`); } catch { named = null; } }
  const mainRef = (() => { try { git(townRepo, "rev-parse", "--verify", "-q", "refs/remotes/origin/main"); return "refs/remotes/origin/main"; } catch { return "main"; } })();
  const town_sha = named ?? git(townRepo, "rev-list", "-1", "--first-parent", `--before=${published_at}`, mainRef);
  if (!SHA40.test(town_sha)) throw new Error(`${tag}: no town commit at or before ${published_at}`);
  const W = checkout(base, join(scratch, `w${number}`), tag_sha);
  try {
    const T = townCheckout(townBase, join(scratch, `t${number}`), town_sha);
    try {
      const read = await readTag({ W, T, base, tag_sha, town_sha });
      return { number, tag, tag_sha, published_at, town_sha, town_sha_from: named ? "named" : "main-at-commit", ...read };
    } finally { dropCheckout(townBase, T); }
  } finally { dropCheckout(base, W); }
}

/** The reads of one tag: its marks, the register at the ledger position, and the fold's proof. */
async function readTag({ W, T, base, tag_sha, town_sha }) {
  // The seed's window is not the snapshot's: S1–S26 predate STATE/log, so no
  // town clock exists to read, and no canonical row carries a window id.
  const seed = await deriveSeed({ worldRepo: W, lawSha: tag_sha, townSha: town_sha, window: { id: 0, receipts: null } });
  const marks = canonicalInputsOf(seed.marks);

  let register = null, register_note = null;
  const hhPath = join(T, "tools", "households.json");
  if (existsSync(hhPath)) {
    try {
      const pinsPath = join(T, "tools", "github-ids.json");
      const rows = rowsFromRegistry(JSON.parse(readFileSync(hhPath, "utf8")), existsSync(pinsPath) ? JSON.parse(readFileSync(pinsPath, "utf8")) : {});
      register = { households: rows.households, pins: rows.pins };
    } catch (e) { register_note = `the registry at ${town_sha.slice(0, 12)} has no row shape today: ${String(e.message).slice(0, 160)}`; }
  } else register_note = `the town at ${town_sha.slice(0, 12)} has no tools/households.json`;

  // The proof: the tag's own engine over the tag's own inputs, stakes replayed.
  const tools = materializeAtRef(base, tag_sha, "tools");
  const mf = await import(pathToFileURL(join(tools, "tools", "marks-fold.mjs")).href);
  const read = (p) => (existsSync(join(W, p)) ? JSON.parse(readFileSync(join(W, p), "utf8")) : null);
  let stakes = [], stakes_note = null;
  try {
    const { rows } = await deriveEscrow({ townRepo: T });
    stakes = rows.length ? await stakesFromStore({ query: async () => ({ rows }) }, { townSha: town_sha }) : [];
  } catch (e) { stakes_note = String(e.message).slice(0, 160); }
  const state = mf.fold({ marks: mf.loadMarks(join(W, "WORLD", "marks")), terrain: read("WORLD/skeleton.json"), stakes, households: read("WORLD/households.json")?.households ?? null });
  let fold = "no committed world-state.json", fold_state = null;
  const committedPath = join(W, "WORLD", "world-state.json");
  if (existsSync(committedPath)) {
    const text = readFileSync(committedPath, "utf8");
    const mine = canonicalJson(state);
    if (mine === canonicalJson(JSON.parse(text))) fold = "equal";
    else if (mine === canonicalJson(JSON.parse(lfCommitted(text)))) fold = "equal (committed CRLF bodies read as LF)";
    else fold = `differs: ${foldDifference(state, JSON.parse(lfCommitted(text))) ?? "array order"}`;
    if (fold.startsWith("equal")) fold_state = JSON.stringify(state, null, 2) + "\n";
  }
  return { marks, register, register_note, stakes: stakes.length, stakes_note, fold, fold_state };
}

// ── the run ──────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? null : process.argv[i + 1]; };
  const worldRepo = arg("world-repo"), townRepo = arg("town-repo");
  if (!worldRepo || !townRepo) { console.error("usage: snapshot-backfill.mjs --world-repo <clone> --town-repo <clone> [--from n] [--to n] [--apply] [--pg-url url] [--json file]"); process.exit(2); }
  const apply = process.argv.includes("--apply");
  const numbers = git(worldRepo, "tag", "-l", "settlement/S*").split("\n").map((t) => Number(t.replace("settlement/S", ""))).filter(Number.isInteger)
    .filter((n) => n >= Number(arg("from") ?? 0) && n <= Number(arg("to") ?? Infinity)).sort((a, b) => a - b);
  const url = arg("pg-url") ?? process.env.WORLD2_PG_URL ?? null;
  if (apply && !url) { console.error("--apply needs the store: --pg-url or WORLD2_PG_URL (as world2_owner)"); process.exit(2); }

  let client = null;
  const settlements = new Map(), sealed = new Map();
  if (url) {
    const { default: pg } = await import("pg");
    client = new pg.Client({ connectionString: url });
    await client.connect();
    if (apply) {
      const { rows: [u] } = await client.query("SELECT current_user AS u");
      if (u.u !== "world2_owner") { console.error(`--apply runs as world2_owner (065's header); this connection is ${u.u}`); process.exit(2); }
    }
    for (const r of (await client.query("SELECT number, window_id, snapshot_id FROM settlements")).rows) settlements.set(Number(r.number), r);
    for (const r of (await client.query("SELECT id, window_id FROM world_snapshots WHERE window_id IS NOT NULL")).rows) sealed.set(Number(r.window_id), Number(r.id));
  }

  const scratch = mkdtempSync(join(tmpdir(), "snapshot-backfill-"));
  const W = join(scratch, "w"), T = join(scratch, "t");
  const clone = (src, dst) => execFileSync("git", ["-c", "core.autocrlf=false", "-c", "core.longpaths=true", "clone", "-q", "--shared", "--no-checkout",
    "-c", "core.autocrlf=false", "-c", "core.longpaths=true", src, dst], { stdio: "ignore" });
  clone(resolve(worldRepo), W); clone(resolve(townRepo), T);

  const receipt = [];
  let exit = 0;
  try {
    for (const number of numbers) {
      const row = settlements.get(number);
      if (row?.snapshot_id != null) { console.log(`S${number}: skipped — settlements already names snapshot ${row.snapshot_id}`); receipt.push({ number, skipped: "already linked" }); continue; }
      if (row?.window_id != null && sealed.has(Number(row.window_id))) {
        const id = sealed.get(Number(row.window_id));
        if (apply) await client.query("UPDATE settlements SET snapshot_id = $2 WHERE number = $1 AND snapshot_id IS NULL", [number, id]);
        console.log(`S${number}: ${apply ? "LINKED" : "would link"} to snapshot ${id}, which the seal took at window ${row.window_id}`);
        receipt.push({ number, linked: id });
        continue;
      }
      try {
        const t = await deriveTag({ W, T, townRepo: resolve(townRepo), number, scratch });
        t.window_id = row?.window_id ?? null;
        const line = `S${number}: ${t.marks.length} marks · register ${t.register ? `${t.register.households.length}+${t.register.pins.length} rows` : `none (${t.register_note})`} · town ${t.town_sha.slice(0, 9)} (${t.town_sha_from}) · stakes ${t.stakes}${t.stakes_note ? ` (${t.stakes_note})` : ""} · fold ${t.fold}${row ? "" : " · NO settlements row"}`;
        let header = null;
        if (apply) {
          await client.query("BEGIN");
          try { header = await writeTagSnapshot((s, a) => client.query(s, a), t); await client.query("COMMIT"); }
          catch (e) { await client.query("ROLLBACK").catch(() => {}); throw e; }
        }
        console.log(`${line}${header ? ` · WROTE snapshot ${header.id} ${header.digest.slice(0, 12)}${t.fold_state ? " + fold cache" : ""}` : ""}`);
        const { marks, register, fold_state, ...rest } = t;
        receipt.push({ ...rest, marks: marks.length, register_rows: register ? register.households.length + register.pins.length : null, cached: !!fold_state, snapshot: header?.id ?? null });
      } catch (e) {
        exit = 1;
        console.log(`S${number}: REFUSED — ${e.message}`);
        receipt.push({ number, refused: e.message });
      }
    }
  } finally {
    // The scratch clones only: two directories this run made, by name.
    rmSync(W, { recursive: true, force: true });
    rmSync(T, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
    if (client) await client.end();
  }
  const cached = receipt.filter((r) => r.cached).length, built = receipt.filter((r) => r.tag).length;
  console.log(`${apply ? "WROTE" : "DRY RUN"}: ${built} snapshot(s) ${apply ? "" : "derivable "}from tags, ${cached} with a proved fold cache, ${receipt.filter((r) => r.linked).length} linked, ${receipt.filter((r) => r.skipped).length} skipped, ${receipt.filter((r) => r.refused).length} refused`);
  if (arg("json")) writeFileSync(arg("json"), JSON.stringify(receipt, null, 1) + "\n");
  process.exit(exit);
}
