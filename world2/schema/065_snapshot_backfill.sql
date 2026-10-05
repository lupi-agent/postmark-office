-- 065 — settlements point at their snapshot, and a back-filled snapshot says
-- where its sources came from (POS-358; follows 054 and 064).
--
-- RULED: POS-358's parts ("`settlements` rows point at their snapshot"), recast
-- under Darko's 2026-10-05 sources ruling (POS-410): a back-filled snapshot
-- writes SOURCES, the same three a clearing's snapshot holds (mark versions, the
-- register, the law/terrain and ledger shas), and the fold cache only for the
-- tags whose fold reproduces their committed world-state.json. Wright's word on
-- the three proposals, 2026-10-05: they stand.
--
-- ── WHAT IS ADDED ────────────────────────────────────────────────────────────
--
--   world_snapshots.source        'clearing' (the seal, every window from 054 on)
--                                 or 'backfill' (world2/tools/snapshot-backfill.mjs,
--                                 one per settlement tag S1–S93, built from the tag's
--                                 tree). Default 'clearing', so the seal needs no change.
--   world_snapshots.town_sha_from how a back-filled snapshot's ledger position was
--                                 found, because no world tag records the town sha
--                                 its stakes came from (POS-358's finding):
--                                   'named'           the tag's own message names it
--                                                     ("Box Town <sha>"; S35, S66, S81–S84, S87–S93)
--                                   'main-at-commit'  town main's last first-parent
--                                                     commit at or before the tag
--                                                     commit's committer date
--                                 NULL on a clearing's snapshot, whose town_sha is the
--                                 store's own projection head.
--   settlements.snapshot_id       the snapshot that IS that settlement's World.
--                                 Written by the back-fill for S1–S93, and by the
--                                 office tick's settlements-backfill.mjs at INSERT for
--                                 every later tag (the snapshot of the row's window).
--
-- ── THE PEN, AND WHY THE BACK-FILL IS THE OWNER ──────────────────────────────
--
-- `settlements` is INSERT-only for every pen (018: "a blessing is canon and is
-- never rewritten"), and this file grants no UPDATE. Filling `snapshot_id` on the
-- 93 rows that predate it is a MIGRATION's act, so the back-fill runs once as
-- `world2_owner`, seed-import's precedent ("this is a migration, not a runtime
-- path"), and only ever fills a NULL. `office_api` writes the column on the
-- rows it inserts, under its existing INSERT grant.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, AFTER 054 AND 064 ────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/065_snapshot_backfill.sql
--
-- Proof it landed:
--   SELECT column_name FROM information_schema.columns
--    WHERE (table_name = 'world_snapshots' AND column_name IN ('source', 'town_sha_from'))
--       OR (table_name = 'settlements' AND column_name = 'snapshot_id');      -- three rows
--
-- CONSUMERS: world2/tools/snapshot-backfill.mjs (the writer for S1–S93),
-- world2/tools/settlements-backfill.mjs (snapshot_id at INSERT), src/world-snapshot.mjs
-- (the header read), world2/tools/world-snapshot.mjs (--verify).

BEGIN;

ALTER TABLE world_snapshots ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'clearing'
  CHECK (source IN ('clearing', 'backfill'));
ALTER TABLE world_snapshots ADD COLUMN IF NOT EXISTS town_sha_from text
  CHECK (town_sha_from IN ('named', 'main-at-commit'));
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS snapshot_id integer REFERENCES world_snapshots(id);

COMMIT;
