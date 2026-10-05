-- 054 — world_snapshots: the clearing seals the World it just cleared, in its
-- own transaction (POS-357, the first lane of POS-337).
--
-- RULED (Darko, 2026-10-04, docs/2026-10-04/design-notes/world-reads-the-store-rulings.md
-- § R1): "Each 12-hour clearing writes a content-addressed snapshot of every
-- standing mark in the same transaction that writes the marks, so the two can
-- never disagree (a deliberate exception to 053's 'never inside the clearing')."
-- And the constraint on the step, ruled the same day ("Agreed on 2"): the step
-- inside the clearing's transaction is a PURE SQL COPY of rows the clearing just
-- wrote: no engine, no fold, no law evaluation, no network, no file reads. The
-- computed World is built outside it, by the office on first read, and can
-- always be rebuilt from the copy.
--
-- ── WHAT IS KEPT ─────────────────────────────────────────────────────────────
--
--   mark_versions         each version of a standing mark, stored ONCE by its
--                         content. `row` is the mark's canonical row as TEXT:
--                         jsonb_build_object(slug, kind, owner, body, geometry,
--                         parent, data)::text, where `parent` is the parent's
--                         SLUG (standing parents only, which is what
--                         `marksFromRows` resolves), never its uuid, so a version
--                         means the same thing in any store and in a back-fill
--                         from a settlement tag that never had a uuid. These are
--                         exactly the columns `src/world2-fold.mjs § marksFromRows`
--                         reads. `digest` is sha256 of `row`'s UTF-8 bytes, in
--                         hex. TEXT, not jsonb: the digest is of these bytes, and
--                         jsonb's own text form is what made them (Postgres
--                         writes jsonb keys in one fixed order), so the bytes are
--                         the same in every store.
--   world_snapshot_marks  the mark list of a snapshot: (marks_digest, slug,
--                         digest). `marks_digest` is sha256 of the lines
--                         "<slug> <digest>" in slug order (COLLATE "C"), joined
--                         by "\n". Keyed by the LIST's digest, not by the
--                         window: two clearings that leave the World unchanged
--                         share one list and cost nothing.
--   world_snapshots       one header per clearing: the window, the list's
--                         digest, the mark count, and the shas of the fold's
--                         other inputs, each read from the store's own
--                         `projection_heads` (never a file): law_sha
--                         ('world-law': the class marks in law_projection),
--                         town_sha ('town': the stakes in escrow_projection),
--                         world_sha ('world-marks': the world main the store
--                         last ingested, whose engine, skeleton and households
--                         the fold also reads; NULL on a store that never
--                         ingested one). `digest` is sha256 of
--                         "<marks_digest> <law_sha> <town_sha> <world_sha>"
--                         (an absent sha written as "-"): the whole of what the
--                         fold reads, so equal digests mean an equal World.
--   world_snapshot_folds  the computed World of a snapshot digest, as the
--                         `/world/state` JSON text. A CACHE: built OUTSIDE the
--                         clearing by the office on first read (POS-359),
--                         rebuildable from the copy at any time, newest few
--                         kept. Nothing in this lane writes it.
--
-- `world_snapshots.window_id` is UNIQUE: a window is cleared once. It is
-- nullable for the back-fill (POS-358), whose oldest settlements closed no
-- window this store holds (018's S1–S46). The settlement NUMBER is not here:
-- which snapshot is S<n> is the settlements side's (POS-358, POS-362).
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `clearing_job`, inside the window's transaction, after step 7 (the standing
-- recompute, the window's last write to `marks`): world2/tools/world-snapshot-seal.mjs,
-- three SQL statements and nothing else. INSERT only: a version, a list and a
-- header are written once and never move. `office_api` may INSERT and DELETE
-- the fold cache and nothing else here. 003_falsifier_roles.sql's lawful list
-- carries the matching rows.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` ──────────────────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/054_world_snapshots.sql
--
-- APPLY IT BEFORE THE CODE THAT WRITES IT. A clearing-job.mjs that seals runs
-- against a store without these tables and its window rolls back whole, by
-- design (the seal is in the transaction). The order is: this file, then the
-- office code.
--
-- Proof it landed:
--   SELECT tablename, tableowner FROM pg_tables
--    WHERE tablename IN ('mark_versions', 'world_snapshots', 'world_snapshot_marks', 'world_snapshot_folds');
--     -- world2_owner, four times
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name IN ('mark_versions', 'world_snapshots', 'world_snapshot_marks', 'world_snapshot_folds')
--    ORDER BY 1, 2, 3;
--     -- clearing_job INSERT + SELECT on the first three · office_api INSERT, DELETE, SELECT on
--     -- the folds · office_api, law_ingester, snapshot_reader SELECT on all four
--   SELECT sha256(convert_to('', 'UTF8'));   -- the digest function the seal uses (Postgres 11+)
--
-- CONSUMERS: `world2/tools/world-snapshot-seal.mjs` (the writer, from
-- `clearing-job.mjs`), `src/world-snapshot.mjs` (the reader and the checks),
-- `world2/tools/world-snapshot.mjs` (--verify). Nothing serves a snapshot yet:
-- that is POS-359.

BEGIN;

CREATE TABLE IF NOT EXISTS mark_versions (
  digest  text PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
  row     text NOT NULL
);

CREATE TABLE IF NOT EXISTS world_snapshot_marks (
  marks_digest  text NOT NULL CHECK (marks_digest ~ '^[0-9a-f]{64}$'),
  slug          text NOT NULL,
  digest        text NOT NULL REFERENCES mark_versions(digest),
  PRIMARY KEY (marks_digest, slug)
);

CREATE TABLE IF NOT EXISTS world_snapshots (
  id            serial PRIMARY KEY,
  window_id     integer UNIQUE REFERENCES windows(id),
  digest        text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  marks_digest  text NOT NULL CHECK (marks_digest ~ '^[0-9a-f]{64}$'),
  marks         integer NOT NULL CHECK (marks >= 0),
  law_sha       text,
  town_sha      text,
  world_sha     text,
  taken_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS world_snapshots_digest ON world_snapshots (digest);

CREATE TABLE IF NOT EXISTS world_snapshot_folds (
  digest    text PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
  state     text NOT NULL,
  built_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON mark_versions, world_snapshot_marks, world_snapshots, world_snapshot_folds
  TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT ON mark_versions, world_snapshot_marks, world_snapshots TO clearing_job;
GRANT USAGE ON SEQUENCE world_snapshots_id_seq TO clearing_job;
GRANT INSERT, DELETE ON world_snapshot_folds TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('mark_versions', 'archive', 'clearing_job', '{office_api,snapshot_reader}',
   'Darko 2026-10-04 (POS-337 R1, POS-357): each standing mark version once, by content; written by the clearing in its own transaction, a pure SQL copy'),
  ('world_snapshot_marks', 'archive', 'clearing_job', '{office_api,snapshot_reader}',
   'POS-357: a snapshot''s mark list, keyed by the list''s digest'),
  ('world_snapshots', 'archive', 'clearing_job', '{office_api,snapshot_reader}',
   'POS-357: one header per clearing, the World it sealed and the shas of the fold''s other inputs'),
  ('world_snapshot_folds', 'derived', 'office_api', '{snapshot_reader}',
   'POS-337 R1: the computed World of a snapshot, a cache built outside the clearing, rebuildable from the copy')
ON CONFLICT (object) DO NOTHING;

COMMIT;
