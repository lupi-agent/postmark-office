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
//                        header's digest is sha256 of the list digest and the
//                        three shas. A second computation, never a writer: a
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
import { STANDING_ROWS_SQL } from "../world2/tools/world-snapshot-seal.mjs";

const sha256 = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const byCodepoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);   // COLLATE "C" for these ASCII slugs

/** The list digest over (slug, digest) pairs, as the seal computes it in SQL. */
export function marksDigestOf(pairs) {
  return sha256([...pairs].sort((a, b) => byCodepoint(a.slug, b.slug)).map((r) => `${r.slug} ${r.digest}`).join("\n"));
}

/** The snapshot digest over the list digest and the fold's other inputs, as the seal computes it. */
export function snapshotDigestOf({ marks_digest, law_sha, town_sha, world_sha }) {
  return sha256(`${marks_digest} ${law_sha ?? "-"} ${town_sha ?? "-"} ${world_sha ?? "-"}`);
}

/** A snapshot header: by window, by id, or the newest. Null when there is none. */
export async function snapshotHeader(p, { window = null, id = null } = {}) {
  const cols = "id, window_id, digest, marks_digest, marks, law_sha, town_sha, world_sha, taken_at";
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
 */
export function checkSnapshot(header, rows) {
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
 * other top-level key whole.
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
          if (JSON.stringify(x[f]) !== JSON.stringify(y[f])) return `marks: ${id}.${f} differs`;
        }
      }
      continue;
    }
    if (JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k])) return `${k} differs`;
  }
  return null;
}

/**
 * The fold's inputs a snapshot names, read from the store: the class marks at
 * its law_sha and the stakes at its town_sha. Refuses rather than folding a
 * World without its law or its stakes (storeFoldInputs' rule, the same words).
 */
export async function snapshotFoldInputs(p, header) {
  if (!header.law_sha) throw new Error(`snapshot ${header.id} names no law sha — a fold without the town's law is not the town's fold`);
  const { rows: lawRows } = await p.query(
    "SELECT kind, key, path, data FROM law_projection WHERE law_sha = $1 AND kind = 'class' ORDER BY key", [header.law_sha]);
  if (!lawRows.length) throw new Error(`law_projection holds no class marks at ${header.law_sha.slice(0, 12)}, the law snapshot ${header.id} names`);
  if (!header.town_sha) throw new Error(`snapshot ${header.id} names no town sha — its stakes are as-of nothing`);
  const { stakesFromStore } = await import("../world2/tools/fold-input.mjs");
  const stakes = await stakesFromStore(p, { townSha: header.town_sha });
  return { lawRows, stakes };
}

/**
 * A snapshot's World: the world's own `fold` over its versions, its law and its
 * stakes. The engine, terrain and households are the caller's, from the world
 * ref it names (header.world_sha), exactly as the office's store fold takes them.
 */
export async function foldOfSnapshot(p, header, { fold, terrain, households = null }) {
  const { marksFromRows } = await import("./world2-fold.mjs");
  const rows = await snapshotRows(p, header.marks_digest);
  const { lawRows, stakes } = await snapshotFoldInputs(p, header);
  return fold({ marks: marksFromRows(markRowsOfVersions(rows), lawRows), terrain, stakes, households });
}
