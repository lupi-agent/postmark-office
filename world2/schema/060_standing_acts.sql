-- 060 — standing_acts: the Registrar's standing ledger, in the store (POS-347)
--
-- RULED (Darko, 2026-10-04): git can be written to, the store reads git, the
-- store is the record, and every reader reads the store. Until this file the
-- town's `tools/standing-ledger.md` WAS the record of who is quarantined or
-- revoked: the office's write doors read it live from the clone on every call
-- (src/standing.mjs before POS-347), and the Registrar wrote it by committing a
-- line (town tools/registrar-audit.mjs § appendAct).
--
-- ── WHAT IS KEPT ─────────────────────────────────────────────────────────────
--
-- One row per act, in the order the acts were written. That order IS the
-- truth, exactly as the file's line order was: the current standing of a
-- handle is its newest row (src/standing.mjs § foldStanding over these rows).
--
--   id            the append order. The file renders these in id order.
--   date          the town date the act carries (YYYY-MM-DD), as written.
--   act           quarantine · lift · revoke — the ledger's three words.
--   handle        the resident the act is about.
--   by_who        whose hand: `registrar`, `wright`, or the name a git line
--                 carried. (`by` is a reserved word.)
--   founder_word  the founder's own sentence, verbatim. A revoke without it is
--                 refused here as well as at the door.
--   reason        the reason in the words that were chosen.
--   line          the ledger line this row renders as, byte for byte. UNIQUE,
--                 so adopting the file twice adopts nothing the second time,
--                 and a door retry after a lost push resumes rather than
--                 doubling the act.
--   source        `door` (the office's Registrar act) or `git` (a line the
--                 town file held that the store did not — the backfill, and
--                 any line committed by hand afterwards: the store reads git).
--   actor         the key that called the door (its household), null for git.
--   recorded_at   when the store took the row.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `office_api`, INSERT only. A standing act is never edited or removed: to
-- undo a quarantine the Registrar writes a `lift`, and both rows stay. The
-- 002 `forbid_mutation` trigger holds that for every role, the owner included.
--
-- ── THE FILE ─────────────────────────────────────────────────────────────────
--
-- `tools/standing-ledger.md` becomes an export, rendered from these rows by
-- `tools/standing-drain.mjs` (the registry drain's shape). The town's PR
-- witness still reads the file until POS-348 moves it to the store.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` ──────────────────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/060_standing_acts.sql
--
-- then adopt the file once (it is also what every keep tick does):
--   node tools/standing-drain.mjs --apply
--
-- Proof it landed (world2/tools/migrations-landed.mjs):
--   SELECT to_regclass('public.standing_acts') IS NOT NULL
--      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'standing_acts_append_only');
--
-- CONSUMERS: src/standing.mjs (every write door's gate, the key desk, the
-- freshness ladder), src/standing-store.mjs, tools/standing-drain.mjs.

BEGIN;

CREATE TABLE IF NOT EXISTS standing_acts (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date          text NOT NULL CHECK (date ~ '^\d{4}-\d{2}-\d{2}$'),
  act           text NOT NULL CHECK (act IN ('quarantine', 'lift', 'revoke')),
  handle        text NOT NULL CHECK (handle ~ '^[a-z0-9][a-z0-9-]*$'),
  by_who        text NOT NULL CHECK (by_who <> '' AND position('·' in by_who) = 0),
  founder_word  text CHECK (founder_word IS NULL OR (founder_word <> '' AND position('·' in founder_word) = 0)),
  reason        text NOT NULL CHECK (reason <> '' AND position('·' in reason) = 0),
  line          text NOT NULL UNIQUE,
  source        text NOT NULL CHECK (source IN ('door', 'git')),
  actor         text,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT standing_revoke_needs_founder_word CHECK (act <> 'revoke' OR founder_word IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS standing_acts_handle_idx ON standing_acts (handle, id DESC);

DROP TRIGGER IF EXISTS standing_acts_append_only ON standing_acts;
CREATE TRIGGER standing_acts_append_only
  BEFORE UPDATE OR DELETE ON standing_acts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

GRANT SELECT ON standing_acts TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT ON standing_acts TO office_api;
GRANT USAGE ON SEQUENCE standing_acts_id_seq TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('standing_acts', 'source', 'office_api', '{snapshot_reader}',
   'Darko 2026-10-04 (POS-347, the store is the record): the Registrar''s standing ledger; tools/standing-ledger.md becomes a rendering of this table (tools/standing-drain.mjs --check)')
ON CONFLICT (object) DO NOTHING;

COMMIT;
