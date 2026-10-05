-- 061 — crossing_receipts: every crossing's receipt, in the store (POS-352)
--
-- RULED (Darko, 2026-10-04): the store is the record and every reader reads
-- it. Until this file a crossing's receipt lived in one box file,
-- `/srv/postmark-harbor/settlement-auto.json`, overwritten twice a day, served
-- by nginx to the site's harbor page and read by Wright's runbooks; the
-- bounded history beside it (`settlement-auto-history.jsonl`) kept one summary
-- line per crossing. Neither is in the nightly backup, and the box is the only
-- place either exists.
--
-- ── WHAT IS KEPT ─────────────────────────────────────────────────────────────
--
-- One row per DECIDED crossing (deploy/settlement-history.mjs § isDecision: a
-- lost race inside the retry wrapper is not a decision yet), beside
-- `settlements` (018):
--
--   at, status, class, by_hand, world_from, world_to   the receipt's own
--                 fields, lifted so a reader can ask "the last N refusals"
--                 without parsing every receipt.
--   receipt       the receipt JSON, as TEXT, byte for byte what the crossing
--                 wrote to the file (jsonb would reorder its keys).
--   digest        sha256 of `receipt`. UNIQUE, so recording the same receipt
--                 twice (a re-run of the recorder) records it once.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `office_api`, INSERT only: the settlement unit already holds that connection
-- (EnvironmentFile=/etc/postmark-office.env) and the 018 `settlements` row is
-- written under the same one. A receipt is what a crossing said; it is never
-- edited, so 002's `forbid_mutation` refuses UPDATE and DELETE for every role.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` ──────────────────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/061_crossing_receipts.sql
--
-- Proof it landed (world2/tools/migrations-landed.mjs):
--   SELECT to_regclass('public.crossing_receipts') IS NOT NULL
--      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'crossing_receipts_append_only');
--
-- CONSUMERS: world2/tools/crossing-receipt.mjs (the writer, from
-- deploy/settlement-auto.sh § report), src/crossing-receipts.mjs (the office's
-- read, `GET /crossings/receipts`).

BEGIN;

CREATE TABLE IF NOT EXISTS crossing_receipts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           text,
  status       text,
  class        text,
  by_hand      boolean NOT NULL DEFAULT false,
  world_from   text,
  world_to     text,
  receipt      text NOT NULL,
  digest       text NOT NULL UNIQUE CHECK (digest ~ '^[0-9a-f]{64}$'),
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS crossing_receipts_append_only ON crossing_receipts;
CREATE TRIGGER crossing_receipts_append_only
  BEFORE UPDATE OR DELETE ON crossing_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

GRANT SELECT ON crossing_receipts TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT ON crossing_receipts TO office_api;
GRANT USAGE ON SEQUENCE crossing_receipts_id_seq TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('crossing_receipts', 'source', 'office_api', '{snapshot_reader}',
   'Darko 2026-10-04 (POS-352, the store is the record): each decided crossing''s receipt, beside settlements; /srv/postmark-harbor/settlement-auto.json stays the box''s copy of the newest one')
ON CONFLICT (object) DO NOTHING;

COMMIT;
