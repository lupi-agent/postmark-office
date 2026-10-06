-- 062 — gangway_acts: the town's arrivals breaker, in the store (POS-353)
--
-- RULED (Darko, 2026-10-04): the store is the record and every reader reads
-- it. Until this file the gangway was `HARBOR/GANGWAY.md` in the town repo —
-- `state: open` or `state: frozen`, founder-edited — and five office readers
-- (the join page, the declaration door and its writer, the residency door, the
-- town drain, the anchored-berth sweep) opened that file on every call.
--
-- ── WHAT IS KEPT ─────────────────────────────────────────────────────────────
--
-- One row per change of state, in the order made. The gangway's state is the
-- newest row; no rows is `open` (a town that has never raised it).
--
--   state       open · frozen.
--   since       the town date the state took effect (YYYY-MM-DD), as the
--               file's `since:` says it.
--   reason      why, in the words chosen (nullable for an adopted git line,
--               which carries none).
--   by_who      whose hand: the founder's door writes `founder`; a state read
--               from a commit to the file writes `git`.
--   actor_gh_id the verified GitHub id that called the door (null for git).
--   source      door · git. A founder commit to the file is still honoured:
--               the next drain adopts a state the store does not hold (the
--               store reads git), and the file is rendered from the store.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `office_api`, INSERT only; 002's `forbid_mutation` refuses UPDATE and DELETE.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` ──────────────────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/062_gangway_acts.sql
--
-- then adopt the file once (the keep tick does it every tick after):
--   node tools/gangway-drain.mjs --apply
--
-- Proof it landed (world2/tools/migrations-landed.mjs):
--   SELECT to_regclass('public.gangway_acts') IS NOT NULL
--      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'gangway_acts_append_only');
--
-- CONSUMERS: src/gangway.mjs (every reader's one read), src/gangway-door.mjs
-- (the founder's act), tools/gangway-drain.mjs (the export and the adoption).

BEGIN;

CREATE TABLE IF NOT EXISTS gangway_acts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  state        text NOT NULL CHECK (state IN ('open', 'frozen')),
  since        text NOT NULL CHECK (since ~ '^\d{4}-\d{2}-\d{2}$'),
  reason       text,
  by_who       text NOT NULL,
  actor_gh_id  bigint,
  source       text NOT NULL CHECK (source IN ('door', 'git')),
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS gangway_acts_append_only ON gangway_acts;
CREATE TRIGGER gangway_acts_append_only
  BEFORE UPDATE OR DELETE ON gangway_acts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

GRANT SELECT ON gangway_acts TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT ON gangway_acts TO office_api;
GRANT USAGE ON SEQUENCE gangway_acts_id_seq TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('gangway_acts', 'source', 'office_api', '{snapshot_reader}',
   'Darko 2026-10-04 (POS-353, the store is the record): the arrivals breaker; HARBOR/GANGWAY.md becomes a rendering of the newest row (tools/gangway-drain.mjs)')
ON CONFLICT (object) DO NOTHING;

COMMIT;
