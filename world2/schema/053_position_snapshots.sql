-- 053 — position_snapshots: each resident's governing departure, kept once per
-- clearing (POS-302, the first instance of POS-277).
--
-- RULED (Keemin, 2026-09-27, POS-277): "let's aim to have essentially
-- everything snapshotted per settlement/clearing, and only live compute the
-- delta between settlement snapshots." And on 2026-10-02 (the design note's
-- four questions): the clearing is the fixed point, every snapshot is kept, the
-- full derivation wins on a disagreement and the read discloses it, and there
-- is no new public surface. The shape (writer, key, delta order) is Wright's
-- ruling of 2026-10-02 on POS-302.
--
-- ── WHAT IS KEPT ─────────────────────────────────────────────────────────────
--
-- The positions projection (src/position-projection.mjs) and the 2.0
-- endpoints (`/world2/positions`, `/world2/present`) reduce the whole departure
-- record to one record per handle, in the order each handle first appeared
-- (`governingOf`). Before this file the office rebuilt that from every
-- departure act at boot, every 60 s and per request. A snapshot keeps the
-- reduction of EVERY departure act, both eras, as of a high-water, and a read
-- replays only the acts after it.
--
-- ERA ONE IS THE STORE'S `_ledger` ROWS (Wright, 2026-10-02, POS-302 PR 3):
-- the git walk ledger is no longer read where a snapshot stands. The writer
-- refuses to write over a store whose `_ledger` rows do not answer what the git
-- ledger answers (world2/tools/position-snapshot.mjs § compareEraOne).
--
--   position_snapshots      one row per snapshot, keyed by the window it was
--                           taken after:
--     hw_id, hw_count       max(acts.id) and count(*) over the departure acts
--                           the snapshot read. A read recounts id <= hw_id; a
--                           different count means a row committed late under
--                           a lower id, and the snapshot is not used.
--     last_key              the last row's key in DEPARTURE_ORDER, as JSON
--                           text: [era, instant ms, id]. Every delta row must
--                           sort after it, or the snapshot is not used: a
--                           backfilled act with an early instant and a late id
--                           can govern from inside the record, and appending it
--                           would be wrong.
--     max_iso               the latest STORE-era record instant held (era one
--                           is never cut by an instant). A past read at `at`
--                           uses a snapshot only if max_iso <= at.
--     eras                  the per-era census (`departureCensus`) over every
--                           act the snapshot read, as JSON text so its key
--                           order survives: the endpoints report it.
--     ledger_newest_iso,    the frozen walk ledger's newest instant the writer
--     overlap_count         measured against, and how many of the snapshot's
--                           records are older than it. The whole record
--                           discloses that count as `era-order-overlap` (prod:
--                           12 on 2026-10-02), so the snapshot keeps it and a
--                           read says the same number. If the ledger's newest
--                           line has moved since (it is frozen), the snapshot
--                           is not used.
--   position_snapshot_rows  one row per handle: its first-appearance ordinal in
--                           the record's order, and its governing record as
--                           the JSON text `departureRecords` hands over (era,
--                           act_id and line included). TEXT, not jsonb: jsonb
--                           sorts keys, and the equality is byte for byte.
--
-- ── THE WRITER ───────────────────────────────────────────────────────────────
--
-- `world2/tools/position-snapshot.mjs --apply`, on the keep tick
-- (deploy/office-keep.sh), after window N has closed: it writes window N's
-- snapshot if there is none. Non-fatal, outside the clearing: a failed
-- snapshot never rolls back or blocks a clearing, and the office reads the
-- whole record until one exists.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `office_api`, the 049 mark_carried precedent: the keep tick already holds
-- that connection. INSERT only. A snapshot is written once and never moves;
-- 003_falsifier_roles.sql's lawful list carries the matching rows.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` ──────────────────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/053_position_snapshots.sql
--
-- Proof it landed:
--   SELECT tablename, tableowner FROM pg_tables
--    WHERE tablename IN ('position_snapshots', 'position_snapshot_rows');  -- world2_owner, twice
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name LIKE 'position_snapshot%' ORDER BY 1, 2, 3;
--     -- office_api INSERT + SELECT · clearing_job, law_ingester, snapshot_reader SELECT
--
-- CONSUMERS: `src/world2-guards.mjs § storeDepartureSnapshot` (the read),
-- `src/world-movement.mjs § storedGoverningDepartures` (snapshot + delta),
-- `src/world.mjs § departuresForProjection` (the projection's rebuild), and
-- `world2/tools/position-snapshot.mjs` (the writer and its --verify).

BEGIN;

CREATE TABLE IF NOT EXISTS position_snapshots (
  window_id  integer PRIMARY KEY REFERENCES windows(id),
  hw_id      bigint NOT NULL,
  hw_count   integer NOT NULL CHECK (hw_count >= 0),
  last_key   text,
  eras       text NOT NULL,
  max_iso    text,
  ledger_newest_iso text,
  overlap_count     integer NOT NULL DEFAULT 0 CHECK (overlap_count >= 0),
  built_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS position_snapshot_rows (
  window_id      integer NOT NULL REFERENCES position_snapshots(window_id),
  handle         text NOT NULL,
  first_ordinal  integer NOT NULL CHECK (first_ordinal >= 0),
  record         text NOT NULL,
  PRIMARY KEY (window_id, handle),
  UNIQUE (window_id, first_ordinal)
);

GRANT SELECT ON position_snapshots, position_snapshot_rows TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT ON position_snapshots, position_snapshot_rows TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('position_snapshots', 'projection', 'office_api', '{snapshot_reader}',
   'Keemin 2026-09-27 (POS-277, snapshot per clearing, delta live); shape Wright 2026-10-02 (POS-302): each resident''s governing departure per clearing, written on the keep tick'),
  ('position_snapshot_rows', 'projection', 'office_api', '{snapshot_reader}',
   'POS-302: the rows of position_snapshots, one per handle with its first-appearance ordinal')
ON CONFLICT (object) DO NOTHING;

COMMIT;
