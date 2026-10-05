-- 068 — household_rekeys: the ledger of the one re-key (Darko, 2026-10-05)
--
-- RULED (Darko, 2026-10-05): one key per household in the store. POS-160's
-- RULING 4 (022, 024) kept every row in the spelling it was written in and
-- had the readers declare a house's whole spelling set. Readers that compare
-- one spelling exactly then said two things about one house: a resident's parcel
-- was stored under a `gh:<id>` spelling and their shrines under the house's `hh:`
-- key, so the store read the shrines `market` and refused an amend `escrow-absent`
-- (POS-406). `world2/tools/household-rekey.mjs --apply` re-keys every row to its
-- house's live `hh:` key. This table is what it writes about itself.
--
-- ── WHAT IS KEPT ─────────────────────────────────────────────────────────────
--
-- One row per (table, column, old key) the apply re-keyed:
--   table_name, column_name   where the rows were
--   from_key, to_key          the spelling they carried and the key they carry now
--   rows                      how many
--   ids                       their ids, where the table has an `id` column, so the
--                             old spelling of any one row stays recoverable (the
--                             acts it touched included)
--   applied_at, applied_by    when, and as whom
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `world2_owner`, through the tool, and nobody else: the re-key needs the guard
-- triggers' owner (household-rekey.mjs § THE GUARDS). Append-only by 002's
-- `forbid_mutation`, the owner included. No role is granted a write.
--
-- ── ORDER ON A STORE ─────────────────────────────────────────────────────────
--
--   1. this file
--   2. node world2/tools/household-rekey.mjs --pg-url <owner url>             (the dry run)
--   3. node world2/tools/household-rekey.mjs --pg-url <owner url> --apply --prod
--   4. 069_household_one_key.sql, which refuses to land while any row is left
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` ──────────────────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/068_household_rekeys.sql
--
-- Proof it landed (world2/tools/migrations-landed.mjs):
--   SELECT to_regclass('public.household_rekeys') IS NOT NULL
--      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'household_rekeys_append_only');
--
-- CONSUMERS: world2/tools/household-rekey.mjs (writes), snapshot_reader (reads).

BEGIN;

CREATE TABLE IF NOT EXISTS household_rekeys (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name   text NOT NULL,
  column_name  text NOT NULL,
  from_key     text NOT NULL,
  to_key       text NOT NULL CHECK (to_key LIKE 'hh:%'),
  rows         integer NOT NULL CHECK (rows >= 0),
  ids          text[],
  applied_at   timestamptz NOT NULL DEFAULT now(),
  applied_by   text NOT NULL DEFAULT current_user
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'household_rekeys_append_only') THEN
    CREATE TRIGGER household_rekeys_append_only
      BEFORE UPDATE OR DELETE ON household_rekeys
      FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
  END IF;
END $$;

GRANT SELECT ON household_rekeys TO snapshot_reader;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('household_rekeys', 'archive', 'world2_owner', '{snapshot_reader}',
   'Darko 2026-10-05: one key per household in the store; world2/tools/household-rekey.mjs writes one row per (table, column, old key) it re-keyed')
ON CONFLICT (object) DO NOTHING;

COMMIT;
