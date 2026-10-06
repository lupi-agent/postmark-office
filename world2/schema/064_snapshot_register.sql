-- 064 — the snapshot keeps the household register it was sealed against
-- (POS-410; follows 054_world_snapshots.sql, POS-357).
--
-- RULED (Darko, 2026-10-05, POS-410 and its ruling comment): "the snapshot
-- should just have the one source… just save whatever atomic upstream units are
-- necessary such that we could derive a world state from a snapshot at any later
-- time." Sources only, one per fact, never a derived view:
--
--   · marks       the standing marks' versions                 054, unchanged
--   · register    the register ROWS as they stood at the seal   THIS FILE
--                 (households + household_pins). The World's household grain
--                 and the mint's keys are both derived from them; no
--                 handle → key map is stored.
--   · stakes      the stamp ledger POSITION the window read: world_snapshots.town_sha
--                 (054), the town sha until POS-341's stamp lines land. Escrow
--                 and weight are replayed from it; no escrow rows are stored.
--   · law, terrain  world_snapshots.law_sha (054): the class marks AND the
--                 skeleton are law_projection rows at that sha (law-ingest
--                 writes `class` and `skeleton` kinds from one world commit),
--                 and the fold's engine is the world's code at that sha.
--
-- The whole inventory, input by input, is docs in the PR (POS-410's first part)
-- and the header of src/world-snapshot.mjs.
--
-- ── WHAT IS KEPT ─────────────────────────────────────────────────────────────
--
--   register_versions          each register row once, by content. `row` is
--                              to_jsonb(<the row>) || {"table": <its table>}
--                              as TEXT: every column the row has, so a column a
--                              later migration adds is kept without touching the
--                              seal. `digest` = sha256(row), hex.
--   world_snapshot_register    the register of a snapshot: (register_digest,
--                              key, digest), `key` = "households/<slug>" or
--                              "household_pins/<handle>". `register_digest` is
--                              sha256 of the "<key> <digest>" lines in key order
--                              (COLLATE "C"), "\n"-joined — the marks list's rule.
--                              An unchanged register shares one list.
--   world_snapshots.register_digest   the list a header names. NULL only on a
--                              snapshot sealed before this file.
--
-- THE SNAPSHOT DIGEST NOW COVERS THE REGISTER. world_snapshots.digest =
-- sha256("<marks_digest> <law_sha> <town_sha> <world_sha> <register_digest>"),
-- "-" for an absent value, so equal digests still mean an equal World. No
-- deployed store holds a 054 snapshot (054 rides the same w42 train), so no
-- sealed row carries the four-part digest.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `clearing_job`, in the window's transaction, beside 054's copy
-- (world2/tools/world-snapshot-seal.mjs): a pure SQL copy, INSERT only.
-- 003_falsifier_roles.sql's lawful list carries the matching rows.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, BEFORE THE CODE ──────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/064_snapshot_register.sql
--
-- 054 first (this file alters its table). A sealing clearing on a store without
-- this file rolls its window back, by design.
--
-- Proof it landed:
--   SELECT tablename, tableowner FROM pg_tables
--    WHERE tablename IN ('register_versions', 'world_snapshot_register');   -- world2_owner, twice
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'world_snapshots' AND column_name = 'register_digest';
--   SELECT * FROM registry WHERE object IN ('register_versions', 'world_snapshot_register');
--
-- CONSUMERS: world2/tools/world-snapshot-seal.mjs (the writer),
-- src/world-snapshot.mjs (registerOfSnapshot, foldHouseholdsOf, the checks),
-- world2/tools/world-snapshot.mjs (--verify).

BEGIN;

CREATE TABLE IF NOT EXISTS register_versions (
  digest  text PRIMARY KEY CHECK (digest ~ '^[0-9a-f]{64}$'),
  row     text NOT NULL
);

CREATE TABLE IF NOT EXISTS world_snapshot_register (
  register_digest  text NOT NULL CHECK (register_digest ~ '^[0-9a-f]{64}$'),
  key              text NOT NULL,
  digest           text NOT NULL REFERENCES register_versions(digest),
  PRIMARY KEY (register_digest, key)
);

ALTER TABLE world_snapshots ADD COLUMN IF NOT EXISTS register_digest text
  CHECK (register_digest ~ '^[0-9a-f]{64}$');

GRANT SELECT ON register_versions, world_snapshot_register
  TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT ON register_versions, world_snapshot_register TO clearing_job;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('register_versions', 'archive', 'clearing_job', '{office_api,snapshot_reader}',
   'Darko 2026-10-05 (POS-410): the snapshot stores the register rows as they stood, sources only; each row once, by content'),
  ('world_snapshot_register', 'archive', 'clearing_job', '{office_api,snapshot_reader}',
   'POS-410: a snapshot''s register list, keyed by the list''s digest')
ON CONFLICT (object) DO NOTHING;

COMMIT;
