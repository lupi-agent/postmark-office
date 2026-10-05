// world-snapshot-seal.mjs — THE CLEARING SEALS THE WORLD IT JUST CLEARED
// (POS-357; 054_world_snapshots.sql).
//
// RULED (Darko, 2026-10-04, POS-337 R1 and "Agreed on 2"): the snapshot step
// inside the clearing's transaction is a PURE SQL COPY of rows the clearing just
// wrote: hash each standing mark's row, insert into mark_versions (on conflict do
// nothing), one world_snapshots header (shas read from the store's own tables),
// the world_snapshot_marks list. NO engine, no fold, no law evaluation, no
// network, no file reads.
//
// SO THIS FILE IMPORTS NOTHING. Every byte that is hashed is made by Postgres
// (`jsonb_build_object(...)::text`, `sha256`, `string_agg ... COLLATE "C"`), and
// this module only hands it three statements under the caller's connection,
// inside the caller's transaction. `test/world-snapshot.test.mjs` reads this
// file's import list and reds on any import at all: a fold, a world module or a
// file read here would bring the engine's failure modes into the clearing, and
// with this split the seal can only fail the clearing's own ways (a grant, a
// hashing bug), which the tests and the rehearsal catch.
//
// THE DIGESTS, defined once, here (054's header says the same in prose):
//   version digest   sha256(row), row = the mark's canonical row as jsonb text,
//                    parent as the parent's slug
//   marks_digest     sha256 of "<slug> <digest>" lines, slug order (COLLATE "C"), "\n"-joined
//   snapshot digest  sha256 of "<marks_digest> <law_sha> <town_sha> <world_sha>", "-" for an absent sha
// `src/world-snapshot.mjs § checkSnapshot` recomputes all three in JS from the
// stored rows; that second computation is a check, never a writer.

/**
 * The standing marks as their canonical rows: one (slug, row, digest) per mark.
 * `parent` is the parent's slug when the parent STANDS, which is exactly what
 * `marksFromRows` resolves (it maps a parent uuid through the standing rows only);
 * a retired or missing parent is null, and the record's own `data` carries the
 * fallbacks the fold reads.
 */
export const STANDING_ROWS_SQL = `
  SELECT r.slug, r.row, encode(sha256(convert_to(r.row, 'UTF8')), 'hex') AS digest
    FROM (
      SELECT m.slug,
             jsonb_build_object(
               'slug', m.slug, 'kind', m.kind, 'owner', m.owner, 'body', m.body,
               'geometry', m.geometry, 'parent', p.slug, 'data', m.data)::text AS row
        FROM marks m
        LEFT JOIN marks p ON p.id = m.parent AND p.status = 'standing'
       WHERE m.status = 'standing'
    ) r`;

/** The standing rows (`cur`), and their list digest and count (`list`), as CTEs. */
const LIST_CTES = `
  cur AS (${STANDING_ROWS_SQL}),
  list AS (
    SELECT encode(sha256(convert_to(
             coalesce(string_agg(slug || ' ' || digest, E'\n' ORDER BY slug COLLATE "C"), ''),
             'UTF8')), 'hex') AS marks_digest,
           count(*)::int AS marks
      FROM cur)`;

const VERSIONS_SQL = `
  WITH cur AS (${STANDING_ROWS_SQL})
  INSERT INTO mark_versions (digest, row)
  SELECT digest, row FROM cur
  ON CONFLICT (digest) DO NOTHING`;

const LIST_SQL = `
  WITH ${LIST_CTES}
  INSERT INTO world_snapshot_marks (marks_digest, slug, digest)
  SELECT list.marks_digest, cur.slug, cur.digest FROM cur, list
  ON CONFLICT (marks_digest, slug) DO NOTHING`;

const HEADER_SQL = `
  WITH ${LIST_CTES},
  heads AS (
    SELECT (SELECT sha FROM projection_heads WHERE repo = 'world-law')   AS law_sha,
           (SELECT sha FROM projection_heads WHERE repo = 'town')        AS town_sha,
           (SELECT sha FROM projection_heads WHERE repo = 'world-marks') AS world_sha)
  INSERT INTO world_snapshots (window_id, digest, marks_digest, marks, law_sha, town_sha, world_sha)
  SELECT $1, encode(sha256(convert_to(
           list.marks_digest || ' ' || coalesce(heads.law_sha, '-') || ' ' ||
           coalesce(heads.town_sha, '-') || ' ' || coalesce(heads.world_sha, '-'), 'UTF8')), 'hex'),
         list.marks_digest, list.marks, heads.law_sha, heads.town_sha, heads.world_sha
    FROM list, heads
  RETURNING id, digest, marks_digest, marks, law_sha, town_sha, world_sha`;

/**
 * Seal window `windowId`'s World. Runs on the caller's connection, inside the
 * caller's open transaction; it never begins, commits or rolls back. A failure
 * throws, and the clearing rolls the whole window back with it: the snapshot
 * and the marks it copies can never disagree.
 *
 * @param {(text: string, args?: any[]) => Promise<{rows: object[], rowCount: number}>} q
 * @param {{ windowId: number }} o
 * @returns {Promise<{ id: number, digest: string, marks_digest: string, marks: number,
 *   new_versions: number, law_sha: string|null, town_sha: string|null, world_sha: string|null }>}
 */
export async function sealSnapshot(q, { windowId }) {
  const versions = await q(VERSIONS_SQL);
  await q(LIST_SQL);
  const { rows: [h] } = await q(HEADER_SQL, [windowId]);
  return { ...h, new_versions: versions.rowCount };
}
