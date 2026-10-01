-- 049 — mark_carried: the store records which settlement first carried each
-- mark (POS-142 follow-up, "Proposal B")
--
-- RULED (Keemin, 2026-10-01, via Wright): "why couldn't the new investigate
-- work it out from the moment new marks publish to the store?" and "yeah we can
-- fill from git for the old ones." Until this file the carrying settlement was
-- recorded nowhere in the store: 1.0 derives it from git on every read
-- (src/mark-receipt.mjs § settlementThatCarried: the oldest add of the mark's
-- file, followed across renames, then the lowest `settlement/S<n>` tag that
-- contains it), and /world2/investigate declared `receipt.crossing`,
-- `receipt.settlement_sha` and `says` as tree_only for every published mark.
--
-- ── A TABLE, NOT A COLUMN ON `marks` ─────────────────────────────────────────
--
-- The fact is written ONCE and never moves: a later amend, a retirement or a
-- revive does not change which settlement first carried the mark. A table with
-- the mark id as its primary key and INSERT as the only grant makes Postgres
-- hold that rule. A column on `marks` would need UPDATE on `marks` for the
-- writer's pen, and `marks` is the clearing's table, rewritten by amend and by
-- the marks-ingest (locked_window is the measured casualty: 725 seed rows at
-- window 150, aion-solare/aelyria moved to 209). Write-once on a column would
-- need a trigger; here it needs nothing.
--
--   mark         `<by>/<slug>`, the id 1.0's receipt is asked about. Not
--                `marks.id`: a row's id is the claim that made it, and the
--                fact belongs to the mark's name, which outlives its rows.
--   settlement   S<n>, 1.0's own answer. REFERENCES settlements: a mark is
--                recorded only after its settlement's row is, so the twin's
--                join always finds the sha and the date.
--   added_sha    the oldest add of the mark's file the answer stands on (the
--                commit `settlementThatCarried` found). Provenance for a
--                re-derivation that ever disagrees.
--   recorded_at  when the office wrote it.
--
-- ── THE WRITER ───────────────────────────────────────────────────────────────
--
-- `world2/tools/mark-carried-backfill.mjs`: run once at the ship for every
-- published mark, and called by `settlements-backfill.mjs --apply` on the keep
-- tick right after a settlement row lands, for the published marks with no row
-- yet. Every row it writes is checked against 1.0's own receipt
-- (readMarkReceipt, the /world/investigate reader) before the transaction
-- commits; one disagreement rolls the whole write back.
--
-- A mark 1.0 cannot answer (no path in the tree, or no settlement tag holds its
-- oldest add) gets NO row. Its receipt stays declared, never guessed.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `office_api`, for the reason 018 gave `settlements` that pen: the row is
-- derived from the office's own world clone, under the connection the keep tick
-- already holds. INSERT only, to every runtime pen. 003_falsifier_roles.sql's
-- lawful list carries the matching row in this commit.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` ──────────────────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/049_mark_carried.sql
--
-- Proof it landed:
--   SELECT tableowner FROM pg_tables WHERE tablename = 'mark_carried';  -- world2_owner
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'mark_carried' ORDER BY 1, 2;
--     -- clearing_job SELECT · law_ingester SELECT · office_api INSERT ·
--     -- office_api SELECT · snapshot_reader SELECT · world2_owner (all)
--
-- CONSUMERS: `src/world2-serve.mjs § twinReceipt` (/world2/investigate's
-- receipt), `world2/tools/mark-carried-backfill.mjs` (the writer and its
-- verify), `world2/tools/settlements-backfill.mjs` (calls the writer on the
-- tick). Nothing else reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS mark_carried (
  mark        text PRIMARY KEY CHECK (mark ~ '^[^/]+/.+$'),          -- <by>/<slug>
  settlement  integer NOT NULL REFERENCES settlements(number),        -- S<n> that first carried it
  added_sha   text NOT NULL CHECK (added_sha ~ '^[0-9a-f]{40}$'),   -- the oldest add of its file
  recorded_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON mark_carried TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT ON mark_carried TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('mark_carried', 'source', 'office_api', '{snapshot_reader}',
   'Keemin 2026-10-01 (POS-142 Proposal B): the store records which settlement first carried each mark, from the moment new marks publish; the old ones filled once from git')
ON CONFLICT (object) DO NOTHING;

COMMIT;
