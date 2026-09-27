-- 024 — A HOUSE HAS A SPELLING SET, AND THE POLICY COMPARES AGAINST IT
--       (postmark POS-160, w40 · RULING 4, PROVISIONAL)
--
-- LAW-TIER, by 001's discipline note and anti-rebake rule 4: "Schema DDL is
-- law-tier: it goes through REVIEW like a grant change, because it is one."
-- This file changes four row policies and grants nothing.
--
-- PROVISIONAL. Keemin's veto before Sunday's deploy reverts it
-- (docs/2026-09-22/design-notes/g1-overnight-rulings.md § RULING 4).
--
-- ── THE DEFECT, WHICH IS REAL AND IS NOT THIS FILE'S INVENTION ──────────────
--
-- POS-160 made the household key the house's SLUG. `householdKeyFor` answered
-- `gh:<id>` out of `identities` before it and answers `hh:<slug>` after it, and
-- 007's draft row policy is a STRING EQUALITY:
--
--   CREATE POLICY claims_read ON claims FOR SELECT
--     USING (status <> 'draft' OR household = current_setting('app.household', true));
--
-- So a resident whose rows were written under `gh:<id>` stops seeing their own
-- drafts, stops being able to edit them, and stops being able to delete them —
-- all four of 007's policies compare the same string — while every mechanism in
-- 007 works exactly as written.
--
-- ── 022 TRIED TO FIX IT ON THE ROWS. THE STORE REFUSES THAT. ────────────────
--
-- MEASURED on the dev sandbox 2026-09-22 (Wright's hand, a real Postgres).
-- Three guards, each by its own law:
--
--   `acts_append_only`     002_grants.sql. "acts is append-only (World 2.0
--                          rule: an act is never edited)". It raised, and took
--                          022's whole transaction — `claims` and `marks`
--                          included — down with it.
--   `claims_update_guard`  007_private_drafts.sql. EVERY lawful transition it
--                          permits carries `NEW.household IS NOT DISTINCT FROM
--                          OLD.household`. A claim's household never changes.
--   `marks_id_is_fixed`    the same rule, one table over.
--
-- That is not three accidents. It is the store saying, in three places, that A
-- ROW'S HOUSEHOLD SPELLING IS FIXED FOR ITS LIFE — which is also what
-- `src/household-deriver.mjs` says from the other side and what 022's own third
-- paragraph said about itself: "earlier lines keep their spellings, because
-- history is not rewritten."
--
-- ── SO THE FIX IS ON THE READ SIDE (RULING 4) ───────────────────────────────
--
-- A house declares EVERY SPELLING IT HAS EVER CARRIED, and the policy compares
-- against the set. `src/household-deriver.mjs § houseKeysOf` is the one place
-- that set is built; `§ sessionKeysFor` is what a session declares; and
-- `src/world2-claims.mjs § withHousehold` is what puts it on the connection.
--
-- The set is `hh:<slug>` (first, always), each `formerly` entry as `hh:<old>`,
-- and each account's `gh:<id>`. `solo:<handle>`, bare strings and `login:<name>`
-- are REFUSED — the deriver's § THE SPELLING SET carries a paragraph on each,
-- and the short form of the middle one is that `= ANY(set)` has no order, so a
-- bare `mari` cannot be disambiguated from the handle `mari` the way the
-- ordered walk disambiguates it.
--
-- ── THE SESSION KEY IS COMMA-JOINED, AND WHY NOT JSON ───────────────────────
--
--   `string_to_array(current_setting('app.household_keys', true), ',')`
--
-- is TWO BUILT-INS and no function of this store's own. The JSON form needs
-- `jsonb_array_elements_text` inside a scalar subquery to become something
-- `= ANY` can take, which is a correlated subquery per row in a policy that
-- runs on every SELECT of `claims`. A policy is the hottest predicate in this
-- schema and it must also be READABLE BY THE PERSON AUDITING IT at 05:45.
--
-- A comma cannot appear in a key: `slugFromName` collapses `[^a-z0-9.]+` to a
-- dash and `gh:` is digits. `houseKeysOf` REFUSES to declare one anyway, by
-- name, because the failure mode if one ever arrived is a key splitting in two
-- and one half matching another house.
--
-- `NULLIF(…, '')` is not decoration either. `current_setting(…, true)` answers
-- NULL when nothing declared, and `string_to_array(NULL, ',')` is NULL, so
-- `household = ANY(NULL)` is NULL and no draft is visible — 007's "a public
-- read compares against NULL, which is never equal to anything", preserved
-- exactly. But a session that set the key to the EMPTY STRING would get
-- `string_to_array('', ',')` = `{""}`, a one-element array holding the empty
-- string, which would match a row whose household is `''`. NULLIF collapses
-- that case back onto the NULL road.
--
-- ── `app.household` STAYS SET, AND IS STILL THE ONE CURRENT SPELLING ────────
--
-- Nothing here unsets it. It is what a reader wanting THE house's current key
-- reads (`guard-reads.mjs § assertHouseholdDeclared` names it in its refusal,
-- and every INSERT the pen writes carries it), and it is the first element of
-- `app.household_keys` by `sessionKeysFor`'s own order. Two settings, one fact,
-- and the second is the first plus its history.
--
-- ── ALL FOUR POLICIES MOVE TOGETHER, INCLUDING INSERT ───────────────────────
--
-- 007 built four policies over ONE predicate on purpose, and the defect above
-- is phrased in its own words: "all four policies compare the same string". So
-- all four take the set, and `claims_insert`'s WITH CHECK is not the odd one
-- out even though the pen only ever writes the current spelling.
--
-- THE UPDATE'S WITH CHECK MAKES IT COMPULSORY rather than tidy. 007's
-- `claims_update_guard` refuses any transition where `NEW.household` differs
-- from `OLD.household`, so composing a draft that was written under `gh:<id>`
-- leaves the row AT `gh:<id>`. A narrow WITH CHECK would then refuse the write
-- the widened USING just admitted: the author could see their old draft and not
-- save it. A narrow INSERT beside a wide UPDATE would be two notions of what a
-- lawful `claims.household` is, on one table.
--
-- WHAT KEEPS NEW ROWS IN ONE SPELLING IS THE PEN, not the policy, and that is
-- the right place for it: `householdKeyFor` answers `hh:<slug>` and nothing
-- else, so every row written from the w40 ship carries the slug key whatever
-- the policy would have tolerated.
--
-- ── WHAT IS NOT TOUCHED ─────────────────────────────────────────────────────
--
--   `claims_update_clearing`  compares no household. `clearing_job` moves
--                             `pending` rows and is blind to drafts by design.
--   `claims_read_stance`      023's named carve, `USING (true)`, already on
--                             003's lawful list. Unchanged, and still the only
--                             entry on it.
--   003's lawful enumeration  NO GRANT CHANGES HERE, so 003's grant falsifier
--                             is untouched. Its DRAFT-CARVE falsifier looks for
--                             a SELECT policy on `claims` whose qual does NOT
--                             carry `app.household`, and `app.household_keys`
--                             contains that string — so `claims_read` stays off
--                             the carve list, which is the correct answer and
--                             not a near miss. `test/registry-grants.test.mjs`
--                             pins it.
--   every row in the store    nothing is written. Three guards say so.
--
-- ── APPLY AS `world2_owner` by the runbook's step-1 idiom ───────────────────
--
-- Secret-free: nothing sourced, no URL and no password anywhere on the line.
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/024_household_spellings.sql
--
-- Applied as `postgres` instead, the tables' owner diverges and nothing fails
-- (014's lesson; the divergence is silent and permanent).
--
-- ── IT RUNS WITH THE DEPLOY, NOT BETWEEN IT AND THE FIRST CROSSING ──────────
--
-- 022 was a BACKFILL and wright-ship-week § 4.3b ruled its window. This is a
-- POLICY, and the order it wants is the ordinary one:
--
--   1. THIS FILE                     <- widens the read; changes no row
--   2. deploy the office carrying `sessionKeysFor` and `app.household_keys`
--
-- Either order is survivable and this one has no gap at all. Run BEFORE the
-- deploy, the running office sets only `app.household`, `app.household_keys` is
-- undeclared, `string_to_array(NULL, ',')` is NULL and every policy answers
-- exactly what it answered yesterday — the old office keeps working against the
-- new policy, unchanged. Run AFTER, the new office declares a key nothing reads
-- for the length of the gap, and residents whose rows are `gh:`-spelled stay
-- locked out of their drafts until it lands. So: the policy first.

BEGIN;

-- ── ALTER, NOT DROP-AND-CREATE ──────────────────────────────────────────────
--
-- `ALTER POLICY` edits the predicate and leaves the policy's COMMAND and its
-- `TO` list exactly where 007 put them. DROP + CREATE would restate both, which
-- is two chances to widen a grant in a file that is supposed to change none —
-- and there is no `CREATE OR REPLACE POLICY`. It also makes this file RE-RUNNABLE
-- and makes it FAIL LOUDLY on a store where 007 never ran, which is the right
-- answer for both.
--
-- THE PREDICATE IS WRITTEN OUT SIX TIMES and not hidden behind a function of
-- this store's own. A policy predicate is read by whoever is auditing the store
-- at 05:45, out of `pg_policies.qual`, and a function name there would send them
-- to a second place to find out what the row policy actually says. 003's
-- draft-carve falsifier reads that same column for the same reason.

-- ── THE READ ────────────────────────────────────────────────────────────────
-- Every non-draft row stays public for everyone, unchanged. A draft is visible
-- to a transaction that has declared A SET OF SPELLINGS containing that row's.
ALTER POLICY claims_read ON claims
  USING (status <> 'draft'
         OR household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));

-- ── THE WRITES (the door) ───────────────────────────────────────────────────
ALTER POLICY claims_insert ON claims
  WITH CHECK (status <> 'draft'
              OR household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));

-- USING reaches the old-spelled draft; WITH CHECK lets it be SAVED at the
-- spelling `claims_update_guard` requires it keep. See § ALL FOUR POLICIES.
ALTER POLICY claims_update_office ON claims
  USING       (status <> 'draft'
               OR household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')))
  WITH CHECK  (status <> 'draft'
               OR household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));

-- The resident's own compose space, ended by its own author. Still narrow
-- twice: the row must be a draft AND it must be one of this house's spellings.
ALTER POLICY claims_delete_own_draft ON claims
  USING (status = 'draft'
         AND household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));

UPDATE registry SET ruling = ruling ||
  ' + 024: a household is a SET of spellings (hh:<slug>, hh:<formerly>, gh:<id>); the four draft policies compare household = ANY(app.household_keys); the store never respells a row'
  WHERE object = 'claims' AND ruling NOT LIKE '%+ 024:%';   -- re-runnable; see § ALTER, NOT DROP-AND-CREATE

COMMIT;

-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ─────
--
--   -- the four policies carry the set and not the single key
--   SELECT policyname, cmd, qual, with_check FROM pg_policies
--    WHERE tablename = 'claims' ORDER BY policyname;
--   -- claims_read / claims_insert / claims_update_office / claims_delete_own_draft
--   -- each mention `app.household_keys`; claims_update_clearing mentions no
--   -- household; claims_read_stance is still `true`.
--
--   -- 003's draft-carve falsifier is still green (zero rows), and `claims_read`
--   -- is NOT on the carve list, because `app.household_keys` LIKE '%app.household%'
--
--   -- AND THE REAL PROBE, as `office_api`, on a house whose rows wear two
--   -- spellings. Take the BEFORE count first; it is the number to beat.
--   BEGIN;
--     SET LOCAL ROLE office_api;
--     SELECT set_config('app.household',      'hh:<their-slug>', true);
--     SELECT set_config('app.household_keys', 'hh:<their-slug>', true);
--     SELECT count(*) FROM claims WHERE status = 'draft';   -- BEFORE: the slug alone
--     SELECT set_config('app.household_keys', 'hh:<their-slug>,gh:<their-id>', true);
--     SELECT count(*) FROM claims WHERE status = 'draft';   -- AFTER: >= BEFORE
--   ROLLBACK;
--
--   -- and a stranger declaring their own set still sees none of them
--   BEGIN;
--     SET LOCAL ROLE office_api;
--     SELECT set_config('app.household_keys', 'hh:<somebody-else>', true);
--     SELECT count(*) FROM claims WHERE status = 'draft' AND household LIKE 'gh:<their-id>';  -- 0
--   ROLLBACK;
