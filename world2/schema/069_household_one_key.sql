-- 069 — one key per household: every household column refuses any other spelling
--       (Darko, 2026-10-05)
--
-- After `world2/tools/household-rekey.mjs --apply` (068's header gives the
-- order), every household-bearing column in the store carries a house's live
-- `hh:<slug>` key. This file makes that the store's own rule, so no writer can
-- mint a second spelling again: a CHECK on every one of them,
--
--   household IS NULL OR household LIKE 'hh:%' OR household = 'solo:the-town'
--
-- `solo:the-town` is the town's own marks' key by name, the interim Keemin
-- approved on 2026-09-24 (materialize.mjs § TOWN_HOUSEHOLD_BY_NAME) until the
-- town-as-entity sitting decides what the town is. Nothing else is exempt.
--
-- ── THE WRITERS THE RULE STOPS ───────────────────────────────────────────────
--
-- Measured over the 994 gh:/solo: standing marks on 2026-10-05:
--   world2/tools/seed-import.mjs         window 150-153, the 1.0 import (`households[handle] ?? solo:<handle>`)
--   world2/tools/backfill-register.mjs   windows 172/177/183, the sweep-published-unmirrored backfill
--   world2/tools/materialize.mjs         windows 159-213, before POS-160 moved it to the deriver
--   world2/tools/marks-ingest.mjs        the town's own marks, `solo:the-town` (kept, above)
-- The other columns' writers are the office's pens (insertAct, claimTxFromJournal,
-- the paperwork and ledger pens), law-ingest's identities, and the projections'
-- ingests. All of them answer `hh:` today; this is what keeps it so.
--
-- ── IT REFUSES TO LAND EARLY, BY NAME ────────────────────────────────────────
--
-- A CHECK added NOT VALID still checks every UPDATE, so adding it before the
-- re-key would refuse the clearing's own tier writes on every legacy row. So
-- this file counts first, and if any row in any listed column is still spelled
-- another way it raises, naming each column and its count, and changes nothing.
--
-- ── EVERY COLUMN IS LISTED ───────────────────────────────────────────────────
--
-- `test/household-rekey.test.mjs` holds that every base-table text column
-- named `household` or `own_household` in the store carries this constraint,
-- so a table added later without it fails the suite.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` ──────────────────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/069_household_one_key.sql
--
-- Proof it landed (world2/tools/migrations-landed.mjs):
--   SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acts_household_one_key')

BEGIN;

DO $$
DECLARE
  cols text[][] := ARRAY[
    ['acts', 'household'],
    ['arrival_heard', 'household'],
    ['claims', 'household'],
    ['earpiece_wakes', 'household'],
    ['escrow_projection', 'household'],
    ['escrow_projection', 'own_household'],
    ['household_harnesses', 'household'],
    ['identities', 'household'],
    ['letter_opens', 'household'],
    ['marks', 'household'],
    ['office_media', 'household'],
    ['office_town_journal', 'household'],
    ['posts', 'household'],
    ['responses', 'household'],
    ['stamp_projection', 'household']
  ];
  i int;
  n bigint;
  left_over text := '';
BEGIN
  FOR i IN 1 .. array_length(cols, 1) LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE %I IS NOT NULL AND %I NOT LIKE ''hh:%%'' AND %I <> ''solo:the-town''',
      cols[i][1], cols[i][2], cols[i][2], cols[i][2]) INTO n;
    IF n > 0 THEN left_over := left_over || format(' %s.%s: %s;', cols[i][1], cols[i][2], n); END IF;
  END LOOP;
  IF left_over <> '' THEN
    RAISE EXCEPTION '069 refuses: rows still carry a household spelling that is not a live key —%  run world2/tools/household-rekey.mjs --apply first (068''s header)', left_over;
  END IF;

  FOR i IN 1 .. array_length(cols, 1) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = format('%s_%s_one_key', cols[i][1], cols[i][2])) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%I IS NULL OR %I LIKE ''hh:%%'' OR %I = ''solo:the-town'')',
        cols[i][1], format('%s_%s_one_key', cols[i][1], cols[i][2]), cols[i][2], cols[i][2], cols[i][2]);
    END IF;
  END LOOP;
END $$;

COMMIT;
