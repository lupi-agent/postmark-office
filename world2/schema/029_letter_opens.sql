-- 029 — letter_opens: which delivered letters a household has opened (POS-286)
--
-- THE RULING (Keemin, 2026-09-27, POS-286): mail gets UNREAD, the way email has
-- it. "Unread = delivered letters this household has not opened. Private to
-- the household: the office keeps it, it never enters the public ledger."
-- Opening a letter in full clears it, and a `mark-all-read` act clears a
-- backlog. The correspondence law's sequence states (`new_inbound` and its
-- siblings, the town's tools/mail-state.mjs) are untouched: they say whose
-- turn it is, never what is new.
--
-- ── UNREAD IS DERIVED, SO THIS TABLE HOLDS ONLY THE OPENINGS ────────────────
--
-- Unread = the ferry's delivery rows to a resident (the town's mail-ledger,
-- `ledger` kind 'delivery' in the office index) MINUS the rows here. The pen
-- therefore writes at OPENING, never at delivery, and that is the simpler of
-- the two shapes the brief offered, for a reason in the record: the office
-- does not deliver. The ferry does, in the town repo, and the office learns of
-- a delivery only when it hydrates its index. A pen that marked unread "at
-- delivery" would have to watch hydrations for new ledger rows and write the
-- store from a read path, and it would need a backfill for every delivery
-- before today. Derived, a letter is unread from the moment the index holds
-- its delivery row, which is exactly "unread starts at delivery, never at
-- send": a letter standing ahead of the crossing has no delivery row.
--
-- `mark-all-read` writes one row per letter it clears (how = 'mark-all-read'),
-- not a watermark. A watermark would need an order on deliveries that the
-- store could compare, and the only exact one is the ledger's line order,
-- which lives in the index, not here. Rows cost one per delivered letter at
-- most: the whole town has 10,420 deliveries on 2026-09-28.
--
-- ONE ROW PER (RECIPIENT, LETTER). The recipient, not the household, keys it,
-- because a letter is delivered to a resident and a house can hold several.
-- Any key that holds the recipient opens it for the house. `household` is the
-- recipient's household key as `householdKeyFor` spells it; the row policy
-- compares it.
--
-- ── PRIVATE: 026's HARNESS-ROW SHAPE ────────────────────────────────────────
--
-- ROW LEVEL SECURITY, and every policy is `TO office_api` and compares
-- `household = ANY(app.household_keys)` (024's spelling set). A transaction
-- that has not declared this household sees no row and cannot write one. NO
-- GRANT to `snapshot_reader` or to any role but `office_api`, so no export
-- reads it: the notary reads `acts`, `windows` and `marks`
-- (world2/tools/snapshot-export.mjs). Opening a letter is NOT an act: `acts`
-- leaves the box through the notary's public export, and what a household has
-- read is its own business.
--
-- SELECT + INSERT and no UPDATE or DELETE: a letter is opened once, and
-- nothing un-reads it (a second opening is `ON CONFLICT DO NOTHING`, which
-- needs only the INSERT policy).
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/029_letter_opens.sql
--
-- A second run is a no-op: `IF NOT EXISTS` on the table, a `pg_policies` check
-- before each CREATE POLICY, `ON CONFLICT DO NOTHING` on the registry row, and a
-- GRANT is idempotent.
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ──────
--
--   SELECT tablename, tableowner, rowsecurity FROM pg_tables WHERE tablename = 'letter_opens';
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'letter_opens' ORDER BY 1, 2;   -- office_api INSERT/SELECT and nothing else
--   SELECT policyname, roles, cmd FROM pg_policies WHERE tablename = 'letter_opens';
--   SELECT * FROM registry WHERE object = 'letter_opens';
--
-- CONSUMERS, named: src/unread-store.mjs (the opening, mark-all-read, and the
-- unread count the doorstep and the house read carry), test/unread.test.mjs
-- (through a JS stub; the stub proves the JS, not the store),
-- test/registry-grants.test.mjs (the grants and policies, read from this file).
-- Nothing else reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS letter_opens (
  handle     text NOT NULL,                  -- the recipient resident
  letter     text NOT NULL,                  -- the letter's id, as its delivery row names it
  household  text NOT NULL,                  -- the recipient's household key; the row policy compares it
  opened_at  timestamptz NOT NULL,
  how        text NOT NULL CHECK (how IN ('read','mark-all-read')),
  PRIMARY KEY (handle, letter)
);

ALTER TABLE letter_opens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'letter_opens' AND policyname = 'letter_opens_read') THEN
    CREATE POLICY letter_opens_read ON letter_opens FOR SELECT TO office_api
      USING (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'letter_opens' AND policyname = 'letter_opens_insert') THEN
    CREATE POLICY letter_opens_insert ON letter_opens FOR INSERT TO office_api
      WITH CHECK (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
END $$;

GRANT SELECT, INSERT ON letter_opens TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('letter_opens', 'source', 'office_api', '{}',
   'Keemin 2026-09-27 (POS-286): unread = delivered minus opened; one private row per opened letter per recipient; RLS on app.household_keys, office_api only, in no export')
ON CONFLICT (object) DO NOTHING;

COMMIT;
