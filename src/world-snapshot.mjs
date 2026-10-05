// world-snapshot.mjs — READING A SEALED WORLD BACK, AND CHECKING IT (POS-357;
// 054_world_snapshots.sql).
//
// The clearing writes a snapshot as a pure SQL copy (world2/tools/world-snapshot-seal.mjs).
// This module is the other side: it reads a snapshot's rows back into the
// records `marksFromRows` already turns into the fold's input, and it checks a
// snapshot two ways, both read-only:
//
//   · checkSnapshot      the digests, recomputed here in JS from the stored rows:
//                        each version's digest is sha256 of its row, the list's
//                        digest is sha256 of its "<slug> <digest>" lines, and the
//                        header's digest is sha256 of the list digest, the
//                        three shas and the register digest (064). A second computation, never a writer: a
//                        hashing bug in the seal reds here.
//   · compareToStore     the snapshot against the store's standing rows NOW, by
//                        slug: a mark the store holds that the snapshot lacks is
//                        DROPPED, the reverse is EXTRA, the same slug with other
//                        bytes is CHANGED. Exact only while the store has not
//                        moved since the clearing: the review lane, marks-ingest
//                        and retire-unpublished all write `marks` between
//                        clearings, and the newest snapshot is the one this is
//                        asked of.
//
// The fold of a snapshot is the world's own `fold`, over `marksFromRows` of the
// rows read back here. There is no second fold and no second record shape:
// a version's row is the store row with the parent's slug in place of its
// uuid, so handing `marksFromRows` rows whose `id` IS the slug resolves every
// parent exactly as the store's uuids do.

import { createHash } from "node:crypto";
import { STANDING_ROWS_SQL, REGISTER_ROWS_SQL } from "../world2/tools/world-snapshot-seal.mjs";

const sha256 = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // COLLATE "C" for these ASCII slugs

/** The list digest over (slug, digest) pairs, as the seal computes it in SQL. */
export function marksDigestOf(pairs) {
  return sha256([...pairs].sort((a, b) => byCodepoint(a.slug, b.slug)).map((r) => `${r.slug} ${r.digest}`).join("\n"));
}

/** The snapshot digest over the list digest and the fold's other inputs, as the seal computes it. */
export function snapshotDigestOf({ marks_digest, law_sha, town_sha, world_sha, register_digest = null }) {
  // A header sealed before 064 has no register and its digest has four parts.
  const base = `${marks_digest} ${law_sha ?? "-"} ${town_sha ?? "-"} ${world_sha ?? "-"}`;
  return sha256(register_digest ? `${base} ${register_digest}` : base);
}

/** A snapshot header: by window, by id, or the newest. Null when there is none. */
export async function snapshotHeader(p, { window = null, id = null } = {}) {
  // Every column, so a store at 054, 064 or 065 answers with what it has
  // (register_digest from 064; source and town_sha_from from 065).
  const cols = "*";
  const { rows: [h] } = window != null
    ? await p.query(`SELECT ${cols} FROM world_snapshots WHERE window_id = $1`, [window])
    : id != null
      ? await p.query(`SELECT ${cols} FROM world_snapshots WHERE id = $1`, [id])
      : await p.query(`SELECT ${cols} FROM world_snapshots ORDER BY window_id DESC NULLS LAST, id DESC LIMIT 1`);
  return h ?? null;
}

/** A snapshot's list with each version's row: [{ slug, digest, row }], slug order. `row` null = a listed version that is missing. */
export async function snapshotRows(p, marksDigest) {
  const { rows } = await p.query(
    `SELECT l.slug, l.digest, v.row
       FROM world_snapshot_marks l LEFT JOIN mark_versions v ON v.digest = l.digest
      WHERE l.marks_digest = $1 ORDER BY l.slug COLLATE "C"`, [marksDigest]);
  return rows;
}

/** The store's standing marks NOW, in the seal's own canonical form: [{ slug, digest, row }]. */
export async function standingRowsNow(p) {
  const { rows } = await p.query(`${STANDING_ROWS_SQL} ORDER BY r.slug COLLATE "C"`);
  return rows;
}

/**
 * A snapshot's versions → rows `marksFromRows` reads. PURE. `id` is the slug and
 * `parent` the parent's slug, so marksFromRows' uuid → slug map is slug → slug.
 */
export function markRowsOfVersions(rows) {
  return rows.map(({ row }) => {
    const r = JSON.parse(row);
    return { id: r.slug, slug: r.slug, kind: r.kind, owner: r.owner, body: r.body, geometry: r.geometry, parent: r.parent, data: r.data };
  });
}

/**
 * Every way a snapshot can fail to be what its digests say. PURE. [] = sound.
 * @param {object} header a world_snapshots row
 * @param {{slug: string, digest: string, row: string|null}[]} rows its list, from snapshotRows
 * @param {{key: string, digest: string, row: string|null}[]|null} registerRows its register, from snapshotRegisterRows
 */
export function checkSnapshot(header, rows, registerRows = null) {
  const problems = [];
  if (rows.length !== header.marks) problems.push(`the header counts ${header.marks} mark(s), the list holds ${rows.length}`);
  for (const r of rows) {
    if (r.row == null) { problems.push(`${r.slug}: its version ${r.digest.slice(0, 12)} is not in mark_versions`); continue; }
    const d = sha256(r.row);
    if (d !== r.digest) problems.push(`${r.slug}: the version listed as ${r.digest.slice(0, 12)} hashes to ${d.slice(0, 12)}`);
    let slug = null;
    try { slug = JSON.parse(r.row).slug; } catch { problems.push(`${r.slug}: its version is not JSON`); continue; }
    if (slug !== r.slug) problems.push(`${r.slug}: its version is the row of ${slug}`);
  }
  if (header.register_digest) {
    if (!registerRows) problems.push("the header names a register and none was read");
    else {
      for (const r of registerRows) {
        if (r.row == null) { problems.push(`${r.key}: its register version ${r.digest.slice(0, 12)} is not in register_versions`); continue; }
        const d = sha256(r.row);
        if (d !== r.digest) problems.push(`${r.key}: the register version listed as ${r.digest.slice(0, 12)} hashes to ${d.slice(0, 12)}`);
      }
      const rd = registerDigestOf(registerRows);
      if (rd !== header.register_digest) problems.push(`the register list hashes to ${rd.slice(0, 12)}, the header says ${header.register_digest.slice(0, 12)}`);
    }
  }
  const md = marksDigestOf(rows);
  if (md !== header.marks_digest) problems.push(`the list hashes to ${md.slice(0, 12)}, the header says ${header.marks_digest.slice(0, 12)}`);
  const sd = snapshotDigestOf(header);
  if (sd !== header.digest) problems.push(`the header hashes to ${sd.slice(0, 12)}, it says ${header.digest.slice(0, 12)}`);
  return problems;
}

/**
 * The snapshot against the store's standing rows, by slug. PURE.
 * @returns {{ dropped: string[], extra: string[], changed: string[] }}
 *   dropped: standing in the store, absent from the snapshot · extra: the reverse ·
 *   changed: in both, different bytes
 */
export function compareToStore(snapRows, storeRows) {
  const snap = new Map(snapRows.map((r) => [r.slug, r.digest]));
  const store = new Map(storeRows.map((r) => [r.slug, r.digest]));
  const dropped = [], extra = [], changed = [];
  for (const [slug, d] of store) {
    if (!snap.has(slug)) dropped.push(slug);
    else if (snap.get(slug) !== d) changed.push(slug);
  }
  for (const slug of snap.keys()) if (!store.has(slug)) extra.push(slug);
  return { dropped: dropped.sort(byCodepoint), extra: extra.sort(byCodepoint), changed: changed.sort(byCodepoint) };
}

/**
 * The first difference between two folds, or null when they are equal. PURE.
 * Marks are compared by id (the first differing id and key is named); every
 * other top-level key whole. Values compare canonically (keys sorted, arrays in
 * order): jsonb keeps no key order, so a key order is never a difference.
 */
export function foldDifference(a, b) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort();
  for (const k of keys) {
    if (k === "meta") continue;                       // who built it, not what it holds
    if (k === "marks") {
      const am = new Map((a.marks ?? []).map((m) => [m.id, m]));
      const bm = new Map((b.marks ?? []).map((m) => [m.id, m]));
      for (const id of [...new Set([...am.keys(), ...bm.keys()])].sort(byCodepoint)) {
        if (!am.has(id)) return `marks: ${id} is only in the second`;
        if (!bm.has(id)) return `marks: ${id} is only in the first`;
        const x = am.get(id), y = bm.get(id);
        for (const f of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
          if (canonicalJson(x[f]) !== canonicalJson(y[f])) return `marks: ${id}.${f} differs`;
        }
      }
      continue;
    }
    if (canonicalJson(a?.[k]) !== canonicalJson(b?.[k])) return `${k} differs`;
  }
  return null;
}

// ── THE SOURCES (POS-410) ────────────────────────────────────────────────────
//
// RULED (Darko, 2026-10-05): a snapshot stores the atomic upstream sources and
// every World is derived from them on demand. The fold's inputs, each named:
//
//   marks          SOURCE   the snapshot's mark versions (054)
//   mark ORDER     DERIVED  the fold is first-in-order-wins, and its order is the
//                           loader's walk over the filings: the freeze manifest
//                           and the tree at law_sha, else the write-down's rule
//                           (src/world-filing-order.mjs § inFilingOrder; Wright,
//                           2026-10-05: derived, never stored)
//   class marks    SHA REF  law_projection kind `class` at law_sha
//   terrain        SHA REF  law_projection kind `skeleton` at law_sha (one row per
//                           top-level key of WORLD/skeleton.json, law-ingest)
//   stakes         SOURCE   the ledger position, town_sha: replayed from the town
//                           at that sha (escrow-ingest § deriveEscrow, then the
//                           town's own walk order, fold-input § stakesFromStore)
//   households     SOURCE   the register rows at the seal (064) with the town at the
//                           ledger position (its resolver, ADDRESS logins and dated
//                           registry: lines), the crossing's own derivation
//                           (tools/world-households-export.mjs § worldHouseholdsAt)
//   the engine     SHA REF  the world's tools/marks-fold.mjs at law_sha
//   dials, fanup,  CONST    the engine's own defaults; the office passes none
//   prev, tick
//
// Nothing derived is stored: escrow, weights, the handle → household map and the
// World itself are computed here, and world_snapshot_folds caches the last.

/** The register list digest over (key, digest) pairs, as the seal computes it in SQL. */
export function registerDigestOf(pairs) {
  return sha256([...pairs].sort((a, b) => byCodepoint(a.key, b.key)).map((r) => `${r.key} ${r.digest}`).join("\n"));
}

/** A snapshot's register list with each version's row: [{ key, digest, row }], key order. */
export async function snapshotRegisterRows(p, registerDigest) {
  const { rows } = await p.query(
    `SELECT l.key, l.digest, v.row
       FROM world_snapshot_register l LEFT JOIN register_versions v ON v.digest = l.digest
      WHERE l.register_digest = $1 ORDER BY l.key COLLATE "C"`, [registerDigest]);
  return rows;
}

/** The register as it stands NOW, in the seal's own canonical form: [{ key, digest, row }]. */
export async function registerRowsNow(p) {
  const { rows } = await p.query(`${REGISTER_ROWS_SQL} ORDER BY r.key COLLATE "C"`);
  return rows;
}

/**
 * Register versions → the registry object (`registryFromRows`) and the pins.
 * PURE. A version is `to_jsonb(row) || {table}`, the same columns node-pg hands
 * the registry's readers, so the registry's own unfold reads it unchanged.
 */
export async function registerOfVersions(rows) {
  const { registryFromRows, pinsFromRows } = await import("./registry-rows.mjs");
  const households = [], pins = [];
  for (const { row } of rows) {
    const { table, ...r } = JSON.parse(row);
    if (table === "households") households.push(r);
    else if (table === "household_pins") pins.push(r);
    else throw new Error(`a register version names table "${table}", which the register does not hold`);
  }
  return { registry: registryFromRows({ households }), pins: pinsFromRows({ pins }) };
}

/**
 * The fold's household map at a snapshot: handle → household key, derived the
 * way the crossing derives the WORLD/households.json the fold reads
 * (tools/world-households-export.mjs, through src/household-logins.mjs §
 * worldHouseholdsAt): the town's own resolver over the pins and the ADDRESS
 * logins, the ledger's dated `registry:` lines, then one key per declared house.
 *
 * Two of those inputs are the town's files at the ledger position, and two are
 * the register, which the store holds and the town's files are printed from
 * (tools/registry-drain.mjs). So the derivation runs the town's own code at
 * `townRepo` (a checkout AT the snapshot's town_sha) with its two register files,
 * tools/github-ids.json and tools/households.json, replaced by the snapshot's
 * register rows, rendered by the registry's own unfold. Nothing about today's
 * register is read: a household change after the seal cannot move this map.
 *
 * The overlay is a scratch directory: `tools/` copied (the two files are written
 * there), every other top-level entry linked. `townRepo` is never written.
 */
export async function householdsAt(registerRows, townRepo) {
  const { mkdtempSync, readdirSync, cpSync, symlinkSync, writeFileSync, rmSync, unlinkSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const { registry, pins } = await registerOfVersions(registerRows);
  const dir = mkdtempSync(join(tmpdir(), "snapshot-town-"));
  try {
    for (const name of readdirSync(townRepo)) {
      if (name === ".git") continue;
      if (name === "tools") cpSync(join(townRepo, "tools"), join(dir, "tools"), { recursive: true });
      else symlinkSync(join(townRepo, name), join(dir, name), process.platform === "win32" ? "junction" : undefined);
    }
    writeFileSync(join(dir, "tools", "households.json"), JSON.stringify(registry, null, 2) + "\n");
    writeFileSync(join(dir, "tools", "github-ids.json"), JSON.stringify(pins, null, 2) + "\n");
    const engine = await import(pathToFileURL(join(dir, "tools", "stamp-mint.mjs")).href);
    const { worldHouseholdsAt } = await import("./household-logins.mjs");
    return worldHouseholdsAt(dir, engine).households;
  } finally {
    // The links first, one by one, so the removal below can never reach through
    // a link into the town checkout; then the scratch directory, which holds
    // only the copied tools/ by then.
    for (const name of readdirSync(dir)) if (name !== "tools") unlinkSync(join(dir, name));
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The printed copy of the household map at a law sha: law-ingest's `roster`
 * rows, WORLD/households.json as the world commit carried it. A DERIVED
 * printout, used only when no town checkout is given, and said so.
 */
export async function rosterAt(p, lawSha) {
  const { rows } = await p.query(
    "SELECT key, data FROM law_projection WHERE law_sha = $1 AND kind = 'roster' ORDER BY key", [lawSha]);
  if (!rows.length) return null;
  return Object.fromEntries(rows.map((r) => [r.key, r.data?.household]).sort(([a], [b]) => a.localeCompare(b)));
}

/** The skeleton reassembled from its law_projection rows at a law sha (law-ingest § kind: skeleton). */
export async function terrainAt(p, lawSha) {
  const { rows } = await p.query(
    "SELECT key, data FROM law_projection WHERE law_sha = $1 AND kind = 'skeleton' ORDER BY key", [lawSha]);
  if (!rows.length) throw new Error(`law_projection holds no skeleton at ${String(lawSha).slice(0, 12)}, the terrain the snapshot names`);
  return Object.fromEntries(rows.map((r) => [r.key, r.data]));
}

/**
 * The stakes at a ledger position, replayed. With `townRepo` (a checkout AT the
 * snapshot's town_sha; anything else refuses, the seed's stateless contract):
 * the town's own escrow walk, then the fold's stake shape. Without it: the
 * store's escrow_projection at that sha, which stamp-ingest derived from the
 * same ledger. That is a derived projection, and `source` says so.
 */
export async function stakesAt(p, townSha, { townRepo = null } = {}) {
  if (!townSha) throw new Error("the snapshot names no town sha, so its stakes are as-of nothing");
  const { stakesFromStore } = await import("../world2/tools/fold-input.mjs");
  if (townRepo) {
    const { execFileSync } = await import("node:child_process");
    const head = execFileSync("git", ["-C", townRepo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (head !== townSha) throw new Error(`the town checkout is at ${head.slice(0, 12)}, the snapshot's ledger position is ${townSha.slice(0, 12)}: check out that sha`);
    const { deriveEscrow } = await import("../world2/tools/escrow-ingest.mjs");
    const { rows } = await deriveEscrow({ townRepo });
    const stakes = rows.length ? await stakesFromStore({ query: async () => ({ rows }) }, { townSha }) : [];
    return { stakes, source: `replayed from the town ledger at ${townSha.slice(0, 12)}` };
  }
  return { stakes: await stakesFromStore(p, { townSha }), source: `the store's escrow_projection at ${townSha.slice(0, 12)} (stamp-ingest's derivation of that ledger)` };
}

/** Every input of a snapshot's fold, from its sources. */
export async function snapshotFoldInputs(p, header, { townRepo = null } = {}) {
  if (!header.law_sha) throw new Error(`snapshot ${header.id} names no law sha; a fold without the town's law is not the town's fold`);
  const { rows: lawRows } = await p.query(
    "SELECT kind, key, path, data FROM law_projection WHERE law_sha = $1 AND kind = 'class' ORDER BY key", [header.law_sha]);
  if (!lawRows.length) throw new Error(`law_projection holds no class marks at ${header.law_sha.slice(0, 12)}, the law snapshot ${header.id} names`);
  const terrain = await terrainAt(p, header.law_sha);
  const { stakes, source: stakesSource } = await stakesAt(p, header.town_sha, { townRepo });
  let households = null, householdsSource = "nothing: every handle folds solo";
  if (header.register_digest && townRepo) {
    households = await householdsAt(await snapshotRegisterRows(p, header.register_digest), townRepo);
    householdsSource = "the register at the seal, through the town's resolver at the ledger position";
  } else if ((households = await rosterAt(p, header.law_sha))) {
    householdsSource = `the printed WORLD/households.json at law ${header.law_sha.slice(0, 12)} (law_projection roster; a derived printout${header.register_digest ? ": pass the town checkout to derive it from the register" : ", and the snapshot predates 064"})`;
  }
  return { lawRows, terrain, stakes, stakesSource, households, householdsSource };
}

/**
 * A snapshot's World, derived from its sources alone. `fold` is the world's own
 * engine at the snapshot's law_sha; the caller materialises it. `filing` is
 * `filingAt(worldRepo, header.law_sha)` (world-filing-order.mjs), the filings
 * the marks' order derives from; null derives every filing by the rule alone.
 */
export async function foldOfSnapshot(p, header, { fold, townRepo = null, filing = null }) {
  const { marksFromRows } = await import("./world2-fold.mjs");
  const { inFilingOrder } = await import("./world-filing-order.mjs");
  const rows = await snapshotRows(p, header.marks_digest);
  const inputs = await snapshotFoldInputs(p, header, { townRepo });
  const marks = inFilingOrder(marksFromRows(markRowsOfVersions(rows), inputs.lawRows), filing);
  const state = fold({ marks, terrain: inputs.terrain, stakes: inputs.stakes, households: inputs.households });
  return { state, stakesSource: inputs.stakesSource, householdsSource: inputs.householdsSource };
}

/**
 * Canonical JSON: object keys sorted, arrays kept in order. Two folds with equal
 * canonical text hold the same values in the same array order; only jsonb's lost
 * key order is forgiven (POS-410's measurement: the store returns `extent` as
 * {w,h} where a file wrote {h,w}). JSON's own rules for what a file can hold: a
 * key whose value is undefined is absent, and an undefined array member is null,
 * so an in-memory fold compares with a published file the way its bytes would. PURE.
 */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonicalJson(x))).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** canonicalJson with every array's members sorted too: equal here and not there = only an ORDER differs. PURE. */
export function unorderedJson(v) {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : unorderedJson(x))).sort().join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${unorderedJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/**
 * Two folds, key by top-level key: `{ equal: [], orderOnly: [], values: [] }`.
 * `orderOnly` holds the keys whose values are the same once array order is set
 * aside; `values` the keys that differ in what they hold. `meta` is skipped. PURE.
 */
export function foldComparison(a, b) {
  const out = { equal: [], orderOnly: [], values: [] };
  for (const k of [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort()) {
    if (k === "meta") continue;
    if (canonicalJson(a?.[k]) === canonicalJson(b?.[k])) out.equal.push(k);
    else if (unorderedJson(a?.[k]) === unorderedJson(b?.[k])) out.orderOnly.push(k);
    else out.values.push(k);
  }
  return out;
}
