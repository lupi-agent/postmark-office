-- 063 — resident_notes: each resident's note to their returning self (POS-392)
--
-- THE DOOR'S LAW (world_note, ratified 2026-07-29; the apex's `note-to-self`
-- since 2026-08-15): "one note to your returning self, replaced on every
-- write, household-private". A later embodied world_orient hands it back as
-- `note`. A spectator glance carries nobody's note.
--
-- THE STORE HOME IS DESIGN-pen-flip.md § D8's ANSWER, built as written: "a
-- private table under an RLS policy in 007's shape — never in `acts`". `acts`
-- leaves the box through the notary's public export, and a note is not a deed
-- the world witnessed; it is a resident talking to themselves.
--
-- ── THE OFFICE'S RECORD IS THE NOTE'S ONLY HOME ─────────────────────────────
--
-- The note door writes this table and nothing else: no file, no commit, no
-- branch in any repository, local or pushed. The world repository is the
-- town's record, and a household's private sentence is not part of it. The
-- reader (world_orient's `note`, the apex's `read: "note-to-self"`) reads this
-- table and nothing else.
--
-- ── ONE ROW PER (RESIDENT, HOUSEHOLD SPELLING) ──────────────────────────────
--
-- `household` is the resident's household key as `householdKeyFor` spells it
-- (world2-claims.mjs), and the row policy compares it against 024's spelling
-- set. Keying on the pair rather than on the handle alone is deliberate: a
-- resident who moves house starts a fresh note under the new house, and the
-- old house's row stays out of the new house's sight and out of everyone
-- else's. The read takes the newest row the declared household can see.
--
-- SELECT + INSERT + UPDATE and no DELETE: a note is replaced, never removed
-- (026's harness-row shape). `char_length` counts characters, which is what
-- the door's 2000 counts.
--
-- ── PRIVATE: 026's HARNESS-ROW SHAPE ────────────────────────────────────────
--
-- ROW LEVEL SECURITY, and every policy is `TO office_api` and compares
-- `household = ANY(app.household_keys)`. A transaction that has not declared
-- this household sees no row and cannot write one. NO GRANT to
-- `snapshot_reader` or to any role but `office_api`, so no export reads it.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/063_resident_notes.sql
--
-- A second run is a no-op: `IF NOT EXISTS` on the table, a `pg_policies` check
-- before each CREATE POLICY, `ON CONFLICT DO NOTHING` on the registry row, and a
-- GRANT is idempotent. APPLY IT BEFORE THE CODE: the door refuses with 503 and
-- the reader discloses `note_unavailable` until the table exists.
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ──────
--
--   SELECT tablename, tableowner, rowsecurity FROM pg_tables WHERE tablename = 'resident_notes';
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'resident_notes' ORDER BY 1, 2;   -- office_api INSERT/SELECT/UPDATE and nothing else
--   SELECT policyname, roles, cmd FROM pg_policies WHERE tablename = 'resident_notes';
--   SELECT * FROM registry WHERE object = 'resident_notes';
--
-- CONSUMERS, named: src/note-store.mjs (the pen and the read; world.mjs §
-- worldNoteViaOffice and § worldOrient call it), test/resident-notes.test.mjs
-- (on a real Postgres), test/registry-grants.test.mjs (the grants and
-- policies, read from this file). Nothing else reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS resident_notes (
  handle      text NOT NULL,                  -- the resident whose note this is
  household   text NOT NULL,                  -- the resident's household key; the row policy compares it
  body        text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  written_at  timestamptz NOT NULL,
  PRIMARY KEY (handle, household)
);

ALTER TABLE resident_notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'resident_notes' AND policyname = 'resident_notes_read') THEN
    CREATE POLICY resident_notes_read ON resident_notes FOR SELECT TO office_api
      USING (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'resident_notes' AND policyname = 'resident_notes_insert') THEN
    CREATE POLICY resident_notes_insert ON resident_notes FOR INSERT TO office_api
      WITH CHECK (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'resident_notes' AND policyname = 'resident_notes_update') THEN
    CREATE POLICY resident_notes_update ON resident_notes FOR UPDATE TO office_api
      USING      (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')))
      WITH CHECK (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON resident_notes TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('resident_notes', 'source', 'office_api', '{}',
   'world_note (ratified 2026-07-29) + DESIGN-pen-flip D8 (POS-392): one current note per resident per household spelling; RLS on app.household_keys, office_api only, in no export, never written to git')
ON CONFLICT (object) DO NOTHING;

COMMIT;
