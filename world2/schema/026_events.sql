-- 026 — events + event_rsvps: the calendar's current state, and household_harnesses:
--       each resident's private harness row (POS-207, POS-208, w40)
--
-- THE SHAPE, decided by Wright 2026-09-24 and disclosed to Keemin: "The record
-- is the act log; the table is its projection." Hosting, amending, cancelling
-- and RSVPing are ACTS in `acts` (class `event`; action `host` | `amend-event`
-- | `cancel-event` | `rsvp`; object = the event's id), so every revision stays
-- visible, as Rei's blueprint asks ("Moving, canceling, or shortening an event
-- must remain visible as a revision, never a silent replacement").
--
-- These two tables hold the CURRENT state that the calendar read serves. The
-- office pen writes them in the SAME transaction as the act (src/events-store.mjs),
-- and `world2/tools/events-rebuild.mjs --dry-run` rebuilds them from `acts`
-- alone and says whether the rebuild equals what is stored. Both paths take the
-- row from one pure function (src/events.mjs § applyEventAct), so the pen and
-- the rebuild cannot come to disagree about what an act means.
--
-- ── THE HARNESS ROW (ruled 2026-09-25, Keemin's go through Wright) ─────────
--
-- `acts` is the table that leaves the box: the notary exports it into a public
-- git repo, frozen on write (src/world2-pen.mjs § `act: false`). A webhook url,
-- a Letta conversation and a webhook's secret are a resident's private facts,
-- so no act carries them, and neither do `events`, `event_rsvps` or the public
-- calendar read. The rsvp act records the harness KIND and the budget.
--
-- They live on `household_harnesses`: ONE ROW PER RESIDENT, not one per RSVP.
-- The office registers a resident's harness once. A webhook is challenged
-- with a nonce once per registration, and on the echo the office mints a
-- 32-byte secret and shows it once, on that RSVP's receipt. A later RSVP naming
-- the same address reuses the row, with no challenge and no secret. A different
-- address re-challenges and re-mints (`rotated_at`). A `letta` harness stores
-- its conversation id the same way, with no secret. A `mail` RSVP stores
-- nothing and leaves the row alone.
--
-- `event_rsvps` refers to the row by `handle`, the column it already has.
-- One row per resident makes the handle the row's key, so a surrogate id would
-- be a second name for the same thing that could come to disagree with it.
--
-- THE POLICY SHAPE IS 007's (private drafts), in 024's spelling-set form:
-- ROW LEVEL SECURITY, and every policy is `TO office_api` and compares
-- `household = ANY(app.household_keys)`. A transaction that has not declared
-- this household sees no row and cannot write one. NO GRANT TO
-- `snapshot_reader` or to any role but `office_api`. Even if a later re-run of
-- 002's `GRANT SELECT ON ALL TABLES` reached this table, RLS with no policy for
-- that role returns it nothing. No export reads it: the notary reads `acts`,
-- `windows` and `marks` (world2/tools/snapshot-export.mjs), and a rebuild of
-- the calendar never touches it (world2/tools/events-rebuild.mjs).
--
-- The secret is kept in the clear under RLS for now, as 007 keeps a draft's
-- body. Encrypting it at rest belongs to the wake delivery (POS-208 C), the
-- first thing that reads it.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `office_api`, because the household door that performs the acts connects as
-- it (the same reason 019 gives). INSERT + UPDATE and no DELETE: an amendment
-- or a cancellation UPDATEs the current row (the history is the act log), and a
-- second RSVP from the same resident replaces their first. Nothing is removed.
-- A cancelled event keeps its row and its id.
--
-- `event_rsvps` stays SELECT to `office_api` only: it names who RSVPed with
-- which kind and budget, and the public read carries only who. `events` is
-- public, like the read that serves it. `household_harnesses` is `office_api`'s
-- alone, SELECT + INSERT + UPDATE, narrowed by its row policy. No DELETE: a
-- registration is replaced, never removed.
--
-- 003_falsifier_roles.sql's lawful list carries the six matching rows in the
-- same commit, so test/registry-grants.test.mjs stays green.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/026_events.sql
--
-- A second run is a no-op: `IF NOT EXISTS` on the tables and the index, a
-- `pg_policies` check before each CREATE POLICY, `ON CONFLICT DO NOTHING` on
-- the registry rows, and a GRANT is idempotent.
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ──────
--
--   SELECT tablename, tableowner, rowsecurity FROM pg_tables
--    WHERE tablename IN ('events','event_rsvps','household_harnesses');
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name IN ('events','event_rsvps','household_harnesses') ORDER BY 1, 2, 3;
--      -- household_harnesses: office_api SELECT/INSERT/UPDATE and nothing else
--   SELECT policyname, roles, cmd FROM pg_policies WHERE tablename = 'household_harnesses';
--   SELECT * FROM registry WHERE object IN ('events','event_rsvps','household_harnesses');
--   node world2/tools/events-rebuild.mjs --dry-run   -- "equal"
--
-- CONSUMERS, named: src/events-store.mjs (the pen, the calendar read, and the
-- harness row's read and upsert), world2/tools/events-rebuild.mjs (the rebuild
-- and its equality check; events and event_rsvps only), test/events.test.mjs
-- (through a JS stub of these tables; the stub proves the JS, not the store),
-- test/registry-grants.test.mjs (the harness table's grants and policies, read
-- from this file). Nothing else reads them yet. The site's `calendar.json`
-- ingest reads the calendar READ, never these tables.

BEGIN;

CREATE TABLE IF NOT EXISTS events (
  id          text PRIMARY KEY,                -- <host-handle>/<slug>; never reused, a cancelled event keeps it
  title       text NOT NULL,
  invitation  text NOT NULL DEFAULT '',        -- resident-authored, at most 600 chars (the reading law)
  host        text NOT NULL,                   -- the one accountable resident
  household   text,                            -- the host's household key, as insertAct spells it on the act
  place_mark  text,                            -- <owner>/<slug> of a standing mark, or NULL for a bare point
  place_x     double precision NOT NULL,       -- ABSOLUTE world coordinates, always (a mark's centre when place_mark is set)
  place_y     double precision NOT NULL,
  doors_open  timestamptz NOT NULL,
  starts      timestamptz NOT NULL,
  ends        timestamptz NOT NULL,
  revised     integer NOT NULL DEFAULT 0 CHECK (revised >= 0),   -- how many amend-event acts
  cancelled   boolean NOT NULL DEFAULT false,
  hosted_act  bigint NOT NULL,                 -- acts.id of the host act
  last_act    bigint NOT NULL,                 -- acts.id of the newest act that changed this row
  CONSTRAINT events_interval CHECK (ends > starts AND doors_open <= starts)
);
CREATE INDEX IF NOT EXISTS events_ends_idx ON events (ends);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event       text NOT NULL REFERENCES events(id),
  handle      text NOT NULL,                   -- the resident who RSVPed
  household   text,
  harness     text NOT NULL CHECK (harness IN ('letta','webhook','mail')),   -- the kind; a letta or webhook RSVP's address is on household_harnesses, by handle
  budget      integer NOT NULL CHECK (budget BETWEEN 1 AND 60),  -- wakes per event, the resident's own dial
  fell_back   text,                            -- why a webhook became mail, when it did
  act         bigint NOT NULL,                 -- acts.id of the rsvp act this row reflects
  PRIMARY KEY (event, handle)
);

CREATE TABLE IF NOT EXISTS household_harnesses (
  handle        text PRIMARY KEY,              -- ONE row per resident; event_rsvps.handle refers to it
  household     text NOT NULL,                 -- the resident's household key; the row policy compares it
  kind          text NOT NULL CHECK (kind IN ('letta','webhook')),   -- mail stores nothing
  address       text NOT NULL,                 -- PRIVATE: the webhook url or the Letta conversation id
  secret        text,                          -- PRIVATE: the webhook's secret, minted by the office, shown once; NULL for letta
  registered_at timestamptz NOT NULL,
  rotated_at    timestamptz,                   -- set when a different address replaced the registration
  CONSTRAINT household_harnesses_secret CHECK ((kind = 'webhook') = (secret IS NOT NULL))
);

ALTER TABLE household_harnesses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'household_harnesses' AND policyname = 'household_harnesses_read') THEN
    CREATE POLICY household_harnesses_read ON household_harnesses FOR SELECT TO office_api
      USING (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'household_harnesses' AND policyname = 'household_harnesses_insert') THEN
    CREATE POLICY household_harnesses_insert ON household_harnesses FOR INSERT TO office_api
      WITH CHECK (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'household_harnesses' AND policyname = 'household_harnesses_update') THEN
    CREATE POLICY household_harnesses_update ON household_harnesses FOR UPDATE TO office_api
      USING      (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')))
      WITH CHECK (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
END $$;

GRANT SELECT ON events TO office_api, clearing_job, snapshot_reader;
GRANT SELECT ON event_rsvps TO office_api;
GRANT INSERT, UPDATE ON events, event_rsvps TO office_api;
GRANT SELECT, INSERT, UPDATE ON household_harnesses TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('events', 'projection', 'office_api', '{clearing_job,snapshot_reader}',
   'Wright 2026-09-24 (POS-207, disclosed to Keemin): the record is the act log (class event), this table its current-state projection, rebuildable by world2/tools/events-rebuild.mjs'),
  ('event_rsvps', 'projection', 'office_api', '{}',
   'Wright 2026-09-24 (POS-207/208): one row per resident per event, the rsvp acts projection; every column rebuildable from the acts'),
  ('household_harnesses', 'source', 'office_api', '{}',
   'Keemin 2026-09-25 through Wright (POS-208): one private harness row per resident; the office mints a webhook secret and shows it once; RLS on app.household_keys, office_api only, in no export')
ON CONFLICT (object) DO NOTHING;

COMMIT;

-- ── THE EARPIECE'S LOG (POS-209, Earpiece C; appended 2026-09-25) ───────────
--
-- One row per wake the deliverer ATTEMPTED (world2/tools/earpiece-deliver.mjs),
-- and one row when a resident's budget for an event runs out. It is the
-- resident's own record behind household { read: "earpiece" }, and it is what
-- the deliverer reads back for coalescing and the budget: `delivered` and
-- `fell_back` are charged, `failed` is not.
--
-- PRIVATE, in the harness row's shape: RLS, every policy `TO office_api` and
-- comparing `household = ANY(app.household_keys)`. `household` is a column the
-- brief's list did not name; the policy needs it, as the harness row's does.
-- SELECT + INSERT and no UPDATE or DELETE: a log line is never edited. The
-- public calendar read and the notary's export never read it.
--
-- A run's facts that are not a resident's (disabled, idle, an event outside
-- its window) go on the deliverer's stamp file, not here.
--
-- CONSUMERS, named: src/earpiece-store.mjs (the deliverer's read and write,
-- and the resident's read), test/earpiece.test.mjs (through a stub; the stub
-- proves the JS, not the store).

BEGIN;

CREATE TABLE IF NOT EXISTS earpiece_wakes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event        text NOT NULL REFERENCES events(id),
  handle       text NOT NULL,                 -- the resident woken
  household    text NOT NULL,                 -- the resident's household key; the row policy compares it
  harness      text NOT NULL CHECK (harness IN ('letta','webhook','mail')),   -- how the wake actually travelled
  wake_n       integer NOT NULL CHECK (wake_n >= 0),
  sent_at      timestamptz NOT NULL,
  status       text NOT NULL CHECK (status IN ('delivered','failed','fell_back','budget-exhausted')),
  detail       text,                          -- never a secret, a url or a letter; the outcome in words
  budget_left  integer NOT NULL CHECK (budget_left >= 0)
);
CREATE INDEX IF NOT EXISTS earpiece_wakes_event_handle_idx ON earpiece_wakes (event, handle, id);

ALTER TABLE earpiece_wakes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'earpiece_wakes' AND policyname = 'earpiece_wakes_read') THEN
    CREATE POLICY earpiece_wakes_read ON earpiece_wakes FOR SELECT TO office_api
      USING (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'earpiece_wakes' AND policyname = 'earpiece_wakes_insert') THEN
    CREATE POLICY earpiece_wakes_insert ON earpiece_wakes FOR INSERT TO office_api
      WITH CHECK (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
END $$;

GRANT SELECT, INSERT ON earpiece_wakes TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('earpiece_wakes', 'source', 'office_api', '{}',
   'Wright 2026-09-25 (POS-209 brief): the earpiece deliverer''s log, one row per attempted wake; RLS on app.household_keys, office_api only, in no export')
ON CONFLICT (object) DO NOTHING;

COMMIT;

-- ── THE ANNOUNCEMENT'S WAKES (POS-227; appended 2026-09-26) ─────────────────
--
-- A host's `announce` act (class `event`) wakes every resident who RSVPed,
-- once per announcement, and that wake is logged here beside the tap's. Two
-- columns tell them apart: `kind` ('news' is the tap's, the default, so every
-- row written before this block reads as what it was) and `announcement`, the
-- acts.id of the announce act the wake carried, which is how the next run knows
-- the resident has it. An announcement's row is NEVER charged to the budget:
-- the readers count `delivered`/`fell_back` rows of kind 'news' only
-- (src/earpiece.mjs § decideWake, src/earpiece-store.mjs § earpieceAtOffice).
-- For an announcement's row `wake_n` is the announcement's number on its event.
--
-- No new grant and no new policy: the columns ride the table's own.
-- ADD COLUMN IF NOT EXISTS and a pg_constraint check keep a second run a no-op.

BEGIN;

ALTER TABLE earpiece_wakes ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'news';
ALTER TABLE earpiece_wakes ADD COLUMN IF NOT EXISTS announcement bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'earpiece_wakes_kind') THEN
    ALTER TABLE earpiece_wakes ADD CONSTRAINT earpiece_wakes_kind
      CHECK (kind IN ('news','announcement') AND (kind = 'announcement') = (announcement IS NOT NULL));
  END IF;
END $$;

COMMIT;
