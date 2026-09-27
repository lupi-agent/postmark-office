-- 023 — `stance_reader`, the one credential that may see another household's
-- draft, and only to answer "a sketch stands on your ground".
--
-- LAW-TIER, per 001's discipline note and anti-rebake rule 4 ("Schema DDL is
-- law-tier: it goes through REVIEW like a grant change, because it is one").
-- 007's header says the same of itself, and this migration edits 007's policy
-- surface, so it inherits the tier twice over.
--
-- ── THE RULING THIS IMPLEMENTS (Wright, 2026-09-22, G1 overnight, RULING 2) ──
--
-- Quoted whole, because a migration should carry the sentence it is:
--
--   "a new Postgres role `stance_reader`, granted SELECT on `claims` through a
--    policy carve that admits draft rows to THAT role only; used by exactly one
--    reader, `worldForStances`' narrow 2.0 read (DEC-14's words: 'may see
--    overlapping drafts across households'), through its own pool/credential
--    (`WORLD2_STANCE_URL`, on the box's env by Wright's hand); the derivation's
--    OUTPUT carries what the 1.0 read carries today — a candidate's existence,
--    standing and weight — never a draft's body, and the leak falsifier
--    (Phase 5.6) gains one NAMED carve that asserts exactly that on the
--    derivation's output."
--
-- It is reversible by one word from Keemin, and the ruling says so: "Keemin
-- says no → `worldForStances` keeps the 1.0 read and G1 keeps the journal
-- INSERT for the stance class only."
--
-- ── WHAT WAS BLOCKED, MEASURED AND NOT INFERRED ─────────────────────────────
--
-- DEC-14 (runbook, ruled 2026-09-03) gave the stance candidate list "its own
-- narrow 2.0 read that may see overlapping drafts across households", and noted
-- it "blocks nothing today". G1 removes the journal INSERT that is the 1.0
-- arm's source, and G1 comes BEFORE G2, so that note stopped being true. The
-- 2026-09-22 measurement (docs/2026-09-22/rail/pos-195, Starstory) found the
-- road right and the PERMISSION absent:
--
--   · a private draft's ONLY row in this store is `claims` at status 'draft',
--     and 007's `claims_read` carries no `TO` clause, so it binds PUBLIC.
--   · RLS is ENABLE, not FORCE, so only `world2_owner` escapes — and 002 bars
--     that role from runtime ("world2_owner runs migrations only").
--   · no `SECURITY DEFINER` function and no `BYPASSRLS` role exists anywhere in
--     `world2/`. Grepped, zero hits each.
--   · `acts` cannot answer instead, deliberately: an unstaked draft's act is
--     deferred into `claims.data._deferred_act` and never reaches `acts` —
--     "the whole of Phase 5.6's promise", one file over.
--
-- So the store had no road, and the one the-late-welcome needs is a GRANT, not
-- a query shape. This is that grant, cut as narrowly as the ruling allows.
--
-- ── WHY A ROLE AND NOT A `SECURITY DEFINER` FUNCTION ────────────────────────
--
-- The measurement offered both. A definer function owned by `world2_owner` runs
-- with the OWNER's privileges, which is every privilege on this store — so the
-- blast radius of a bug in its body is the whole database, and 003's enumeration
-- cannot see inside it. A role is the thing 002 already reasons in ("the pens as
-- Postgres reality"), its privileges are enumerable by `information_schema`, and
-- 003 below can assert the list is exactly one. A carve whose extent a falsifier
-- can read beats a carve whose extent lives inside a function body.
--
-- ── WHY `USING (true)` AND NOT AN OVERLAP PREDICATE ─────────────────────────
--
-- Named, because the narrower predicate is the one a reader will reach for and
-- it is the wrong one HERE.
--
-- "Overlapping ground the caller holds" is not a fact this table can state. The
-- overlap is the WORLD ENGINE's answer, computed in JS over `overlapArea`
-- against the caller's own marks (world-stance.mjs § candidatesFrom, and its
-- header: "overlap is the engine's answer, never this door's"). A SQL predicate
-- over `bbox` would be a SECOND notion of overlap, in a second language, and the
-- two would disagree at the edges — a mark visible to the policy and invisible
-- to the derivation, or the reverse, with nothing anywhere saying which is the
-- law. 016's GiST index makes the query cheap; it does not make the semantics
-- agree.
--
-- So the policy is honest about what it is: this role may read the live claim
-- layer, and the NARROWING IS THE READER'S, asserted where the narrowing
-- actually happens. Three things hold the line instead of a predicate:
--
--   1. exactly one reader holds this credential, through one pool, read from
--      one env key (`WORLD2_STANCE_URL`, src/world2-acts.mjs § stanceQuery);
--   2. that reader SELECTs a named column list which does not include `body` —
--      the draft's text is not withheld downstream, it is never fetched;
--   3. `falsifier-draft-privacy.mjs` § the stance carve plants a sentinel body
--      and asserts it reaches no stance arm's output, and the unit sentinel
--      (test/stance-candidates-read-the-store.test.mjs) asserts the same without a box.
--
-- The role is SELECT-ONLY on ONE table. It cannot write, it cannot read `acts`,
-- `marks`, `windows` or any projection, and 003's second query below reds if a
-- second role is ever admitted to drafts.
--
-- ── THE ROLE IS MADE BY HAND, LIKE THE OTHER FIVE ───────────────────────────
--
-- No file in this repo `CREATE ROLE`s anything — 002 GRANTs to five names the
-- box made by hand (README § The roles are created nowhere else). This is the
-- sixth name and it follows that convention rather than breaking it for one
-- migration: a password in a migration is a password in git.
--
-- The guard below REFUSES if the role is absent, by name, instead of letting
-- the GRANT fail with Postgres' own wording. A half-applied law-tier migration
-- that says "role does not exist" and nothing about which hand was skipped is
-- the states-with-no-receipt class.
--
--   -- on the box, ONCE, before this file (as postgres):
--   CREATE ROLE stance_reader LOGIN PASSWORD '<minted>';
--
-- and the office env gains `WORLD2_STANCE_URL` carrying that credential. The
-- PR's INSTALL block is the ordered version of this; CI's role list is in
-- .github/workflows/guard-falsifier.yml.
--
-- ── IDEMPOTENT ──────────────────────────────────────────────────────────────
--
-- The GRANT is idempotent in Postgres by nature; the policy is guarded by a
-- `pg_policies` lookup, so a second run matches nothing and changes nothing.
--
-- ── APPLY AS `world2_owner` by the runbook's step-1 idiom ───────────────────
--
-- Secret-free: nothing sourced, no URL and no password anywhere on the line.
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/023_stance_reader.sql
--
-- Applied as `postgres` instead, the tables' owner diverges and nothing fails
-- (014's lesson; the divergence is silent and permanent).

BEGIN;

-- ── the role must already exist, and the refusal says whose hand is missing ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'stance_reader') THEN
    RAISE EXCEPTION 'world2 023: the role "stance_reader" does not exist. This repo creates no roles (README § The roles are created nowhere else) — the box makes them by hand. Run, as postgres, ONCE:  CREATE ROLE stance_reader LOGIN PASSWORD ''<minted>'';  then re-run this migration, then put that credential in the office env as WORLD2_STANCE_URL.';
  END IF;
END $$;

-- ── SELECT on `claims`, and on nothing else ─────────────────────────────────
-- 002 opens with `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC`, so a
-- role holds exactly what it is granted. This one holds one verb on one table.
-- The narrow read joins NOTHING: every field it needs is a column of `claims`
-- or a key of that row's own `geometry`/`data` jsonb (see § the column list in
-- src/world2-acts.mjs § stanceQuery), so there is no second table to name here.
GRANT SELECT ON claims TO stance_reader;

-- ── the carve ───────────────────────────────────────────────────────────────
-- 007's `claims_read` is UNTOUCHED and stays general: it carries no `TO` clause,
-- binds PUBLIC, and every other role — `office_api`, `clearing_job`,
-- `law_ingester`, `snapshot_reader` — still sees a draft only inside a
-- transaction that has declared that draft's own household.
--
-- Postgres ORs permissive SELECT policies together, so this adds a second way to
-- be admitted WITHOUT widening the first. `TO stance_reader` is the whole
-- narrowing: no other role is named by any policy on this table that admits a
-- draft, which is the fact 003's second query below asserts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'claims' AND policyname = 'claims_read_stance'
  ) THEN
    CREATE POLICY claims_read_stance ON claims FOR SELECT TO stance_reader USING (true);
  END IF;
END $$;

UPDATE registry SET ruling = ruling ||
  ' + 023: stance_reader may SELECT claims through claims_read_stance (drafts included, that role only) for worldForStances'' narrow 2.0 read — DEC-14 via RULING 2 (2026-09-22); its output carries existence/standing/weight and never a draft body, asserted by falsifier-draft-privacy.mjs § the stance carve'
  WHERE object = 'claims';

COMMIT;
