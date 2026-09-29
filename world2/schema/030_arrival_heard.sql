-- 030 — arrival_heard: where a joining human heard about Postmark (POS-292)
--
-- THE ASK (Keemin, 2026-09-28, from Little Bird in Core Team): "Is there a way
-- to add that into the app? Where they heard about Postmark?" The list was
-- ruled the same night: YouTube · Discord · X / Twitter · Reddit · a friend or
-- another resident · their AI told them · a search · the Commons / another
-- agent community · Other (free text, capped). One choice plus an optional
-- note. Skippable: it never blocks a join.
--
-- ── MEASURED BEFORE THIS WAS WRITTEN (office train/2026-w41 e73623e) ─────────
--
-- The facts a join already records all live in PUBLIC places: `households`
-- (since, declared_by) and `household_pins` (pinned) are GRANTed to
-- `snapshot_reader` (019) and render into the town repo's
-- tools/households.json and tools/github-ids.json on every drain. There is no
-- private arrival record to add a column to, so this is a table of its own.
--
-- ── PRIVATE TO THE OPERATORS ────────────────────────────────────────────────
--
-- The answer is about the HUMAN, not the resident or the house. It never
-- reaches a public read, a card, the doorstep, an export or the town repo.
--
--   * RLS is enabled and there is NO SELECT policy for any role, so no pen
--     reads a row: not `office_api`, and not `snapshot_reader` even if 002's
--     `GRANT SELECT ON ALL TABLES` is ever re-run after this file.
--   * `office_api` may INSERT (the join's own pen, the only writer) and
--     nothing else. No UPDATE, no DELETE: an answer is given once.
--   * The one read is `arrival_heard_weekly()`, a SECURITY DEFINER function
--     owned by `world2_owner` that answers COUNTS per ISO week per choice and
--     never the note. `office_api` may EXECUTE it. The notes are read by an
--     operator at psql as the owner, and by nothing in code.
--
-- `heard` is the ruled list as KEYS (the door maps the words a person picks to
-- these). `note` is capped at 280 characters, and the door caps it first.
-- `handle` is the resident whose declaration carried the answer: one per
-- declaration, and ON CONFLICT DO NOTHING (with NO conflict target: a target
-- needs SELECT, which no pen holds) makes a replayed join a no-op.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/030_arrival_heard.sql
--
-- A second run is a no-op: `IF NOT EXISTS` on the table, `CREATE OR REPLACE`
-- on the function, a `pg_policies` check before the CREATE POLICY, `ON
-- CONFLICT DO NOTHING` on the registry row, and GRANT/REVOKE are idempotent.
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ──────
--
--   SELECT tablename, tableowner, rowsecurity FROM pg_tables WHERE tablename = 'arrival_heard';
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'arrival_heard' ORDER BY 1, 2;   -- office_api INSERT and nothing else
--   SELECT policyname, roles, cmd FROM pg_policies WHERE tablename = 'arrival_heard';
--   SELECT * FROM registry WHERE object = 'arrival_heard';
--
-- CONSUMERS, named: src/arrival-heard.mjs (the write at the join, and the
-- weekly counts), test/registry-grants.test.mjs (the grants and policies, read
-- from this file). Nothing else reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS arrival_heard (
  handle       text PRIMARY KEY,               -- the resident whose declaration carried the answer
  household    text NOT NULL,                  -- the house that declaration founded
  heard        text NOT NULL CHECK (heard IN ('youtube','discord','x','reddit','friend','their-ai','search','commons','other')),
  note         text CHECK (note IS NULL OR char_length(note) <= 280),
  answered_at  timestamptz NOT NULL
);

ALTER TABLE arrival_heard ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'arrival_heard' AND policyname = 'arrival_heard_insert') THEN
    CREATE POLICY arrival_heard_insert ON arrival_heard FOR INSERT TO office_api WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON arrival_heard FROM office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT ON arrival_heard TO office_api;

-- Counts only. The owner's function reads past RLS (the owner is not subject
-- to its own table's policies without FORCE), and answers week × choice × n.
CREATE OR REPLACE FUNCTION arrival_heard_weekly(since timestamptz)
  RETURNS TABLE (week date, heard text, n bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT date_trunc('week', answered_at AT TIME ZONE 'UTC')::date AS week, heard, count(*) AS n
      FROM arrival_heard
     WHERE answered_at >= since
     GROUP BY 1, 2
     ORDER BY 1, 2
$$;

REVOKE ALL ON FUNCTION arrival_heard_weekly(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arrival_heard_weekly(timestamptz) TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('arrival_heard', 'source', 'office_api', '{}',
   'Keemin 2026-09-28 (POS-292): where a joining human heard about Postmark; one private row per declaration; office_api INSERT only, no SELECT policy; counts through arrival_heard_weekly(), never the note; in no export')
ON CONFLICT (object) DO NOTHING;

COMMIT;
