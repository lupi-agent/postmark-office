-- 028 — posts + responses: the calendar's tables become the general post, and
--       events its first class (POS-288, step 1 of the Posts project)
--
-- THE SHAPE, ruled 2026-09-27 late (Keemin; the Linear "Posts" project, § The
-- shape): one record with a life; every change an act in the existing `acts`
-- log; one projection table for current state; one responses table; money
-- stays in the stamp ledger; one door. Wright's go on the design
-- (G:/Starstory/docs/2026-09-28/rail/pos-288/DESIGN.md), 2026-09-28.
--
-- ── GENERALIZED IN PLACE, NOT COPIED ────────────────────────────────────────
--
-- `events` is RENAMED to `posts` and `event_rsvps` to `responses`, and their
-- columns take the general names. A rename keeps every row, every id and every
-- foreign key: `earpiece_wakes.event` and the responses' own key follow it to
-- `posts(id)` with no copy that could come to disagree with the original.
--
--   posts       events, with: host → author, invitation → body,
--               hosted_act → posted_act, `cancelled` → `state` ('announced' |
--               'cancelled'), `doors_open` → `fields.doors_open` (the fields a
--               class declares), and a `class` ('event' for every row today).
--               The place and the time span become optional (a post may have
--               neither); an event must still have both, by its own CHECK.
--   responses   event_rsvps, with: event → post, and a `kind` ('rsvp'), a
--               `state` ('standing') and `fields` (harness, budget, fell_back).
--               The key is (post, handle, kind): one response of each kind per
--               resident per post.
--
-- ── THE COMPAT VIEWS (one release at least) ─────────────────────────────────
--
-- `events` and `event_rsvps` come back as VIEWS with exactly 026's columns, so
-- every reader of the old names answers unchanged: the earpiece
-- (src/earpiece-store.mjs) and the pinned board (src/event-pins.mjs) are not
-- touched in this release, and that is the proof the views hold. They are
-- read-only: 028 revokes the write grants 026 gave on the old names, which the
-- rename carried to the tables. They are dropped when their last reader moves.
--
-- A second run of 026 after 028 is safe: `CREATE TABLE IF NOT EXISTS events`
-- and `CREATE INDEX IF NOT EXISTS events_ends_idx` see the names taken (the
-- index keeps its 026 name for that reason) and skip. Its `GRANT INSERT,
-- UPDATE ON events, event_rsvps` would land on the views; the next run of 028
-- revokes it again.
--
-- ── THE PEN ─────────────────────────────────────────────────────────────────
--
-- Unchanged: `office_api`, INSERT + UPDATE and no DELETE, in the same
-- transaction as the act (src/events-store.mjs). `posts` is public like the
-- calendar read; `responses` stays office_api's (it names who RSVPed with
-- which kind and budget, and the public read carries only who). 003's lawful
-- list carries posts' and responses' four rows in the same commit.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/028_posts.sql
--
-- The whole reshape runs once, inside a DO block that fires only while
-- `events` is still a TABLE and `posts` does not exist. The views are CREATE
-- OR REPLACE, the grants and revokes are idempotent, the registry rows are ON
-- CONFLICT.
--
-- ── HOW TO PROVE IT LANDED ───────────────────────────────────────────────────
--
--   SELECT relname, relkind FROM pg_class
--    WHERE relname IN ('posts','responses','events','event_rsvps');   -- r r v v
--   SELECT class, state, count(*) FROM posts GROUP BY 1, 2;
--   SELECT count(*) FROM events;  SELECT count(*) FROM event_rsvps;   -- as before
--   node world2/tools/events-rebuild.mjs --dry-run                    -- "equal"
--
-- CONSUMERS, named: src/events-store.mjs (the pen and the calendar read, now
-- on posts/responses), world2/tools/events-rebuild.mjs (folds into
-- posts/responses), src/earpiece-store.mjs and src/event-pins.mjs (on the
-- views, unchanged), world2/tools/migrations-landed.mjs (the probe),
-- test/registry-grants.test.mjs (003's list against these grants).

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.posts') IS NULL
     AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'events' AND c.relkind = 'r') THEN

    -- ── events → posts ──────────────────────────────────────────────────────
    ALTER TABLE events RENAME TO posts;
    ALTER TABLE posts RENAME COLUMN host TO author;
    ALTER TABLE posts RENAME COLUMN invitation TO body;
    ALTER TABLE posts RENAME COLUMN hosted_act TO posted_act;
    ALTER INDEX events_pkey RENAME TO posts_pkey;

    ALTER TABLE posts ADD COLUMN class text;
    UPDATE posts SET class = 'event';
    ALTER TABLE posts ALTER COLUMN class SET NOT NULL;

    ALTER TABLE posts ADD COLUMN state text;
    UPDATE posts SET state = CASE WHEN cancelled THEN 'cancelled' ELSE 'announced' END;
    ALTER TABLE posts ALTER COLUMN state SET NOT NULL;
    ALTER TABLE posts DROP COLUMN cancelled;

    -- doors_open is the event class's own field. Written as the ISO string the
    -- pen writes (JavaScript's toISOString), so a rebuild compares equal.
    ALTER TABLE posts ADD COLUMN fields jsonb NOT NULL DEFAULT '{}'::jsonb;
    UPDATE posts SET fields = jsonb_build_object('doors_open',
      to_char(doors_open AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    ALTER TABLE posts DROP CONSTRAINT events_interval;
    ALTER TABLE posts DROP COLUMN doors_open;

    ALTER TABLE posts ALTER COLUMN place_x DROP NOT NULL;
    ALTER TABLE posts ALTER COLUMN place_y DROP NOT NULL;
    ALTER TABLE posts ALTER COLUMN starts DROP NOT NULL;
    ALTER TABLE posts ALTER COLUMN ends DROP NOT NULL;
    ALTER TABLE posts ADD CONSTRAINT posts_span CHECK (starts IS NULL OR ends IS NULL OR ends > starts);
    ALTER TABLE posts ADD CONSTRAINT posts_event_shape CHECK (class <> 'event' OR (
      starts IS NOT NULL AND ends IS NOT NULL AND place_x IS NOT NULL AND place_y IS NOT NULL
      AND fields ? 'doors_open' AND state IN ('announced', 'cancelled')));

    -- ── event_rsvps → responses ─────────────────────────────────────────────
    ALTER TABLE event_rsvps RENAME TO responses;
    ALTER TABLE responses RENAME COLUMN event TO post;
    ALTER TABLE responses ADD COLUMN kind text NOT NULL DEFAULT 'rsvp';
    ALTER TABLE responses ALTER COLUMN kind DROP DEFAULT;
    ALTER TABLE responses ADD COLUMN state text NOT NULL DEFAULT 'standing';
    ALTER TABLE responses ALTER COLUMN state DROP DEFAULT;
    ALTER TABLE responses ADD COLUMN fields jsonb NOT NULL DEFAULT '{}'::jsonb;
    UPDATE responses SET fields = jsonb_strip_nulls(jsonb_build_object(
      'harness', harness, 'budget', budget, 'fell_back', fell_back));
    ALTER TABLE responses DROP COLUMN harness;
    ALTER TABLE responses DROP COLUMN budget;
    ALTER TABLE responses DROP COLUMN fell_back;
    ALTER TABLE responses DROP CONSTRAINT event_rsvps_pkey;
    ALTER TABLE responses ADD CONSTRAINT responses_pkey PRIMARY KEY (post, handle, kind);
    ALTER TABLE responses RENAME CONSTRAINT event_rsvps_event_fkey TO responses_post_fkey;
  END IF;
END $$;

-- ── an RSVP's invariants, kept (Wright's review of #238) ─────────────────────
-- 026 held `harness NOT NULL CHECK (harness IN ('letta','webhook','mail'))` and
-- `budget NOT NULL CHECK (budget BETWEEN 1 AND 60)` as columns; the reshape
-- moved both into `fields`, so the same law is restated here, scoped to the
-- rsvp kind the way posts_event_shape is scoped to the event class. Its own
-- guarded block, so a store that took the reshape without it still gets it.
DO $$
BEGIN
  IF to_regclass('public.responses') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'responses_rsvp_shape') THEN
    ALTER TABLE responses ADD CONSTRAINT responses_rsvp_shape CHECK (kind <> 'rsvp' OR (
      fields ? 'harness' AND fields->>'harness' IN ('letta', 'webhook', 'mail')
      AND fields ? 'budget' AND jsonb_typeof(fields->'budget') = 'number'
      AND (fields->>'budget')::numeric = floor((fields->>'budget')::numeric)
      AND (fields->>'budget')::numeric BETWEEN 1 AND 60));
  END IF;
END $$;

-- ── the compat views: 026's columns, exactly ─────────────────────────────────

CREATE OR REPLACE VIEW events AS
  SELECT id, title, body AS invitation, author AS host, household, place_mark, place_x, place_y,
         (fields->>'doors_open')::timestamptz AS doors_open, starts, ends, revised,
         (state = 'cancelled') AS cancelled, posted_act AS hosted_act, last_act
    FROM posts WHERE class = 'event';

CREATE OR REPLACE VIEW event_rsvps AS
  SELECT post AS event, handle, household, fields->>'harness' AS harness,
         (fields->>'budget')::integer AS budget, fields->>'fell_back' AS fell_back, act
    FROM responses WHERE kind = 'rsvp';

-- ── the grants ───────────────────────────────────────────────────────────────
-- The rename carried 026's table grants to posts/responses; they are restated
-- so a store that reaches 028 any other way ends the same. The views read only.

GRANT SELECT ON posts TO office_api, clearing_job, snapshot_reader;
GRANT SELECT ON responses TO office_api;
GRANT INSERT, UPDATE ON posts, responses TO office_api;
GRANT SELECT ON events TO office_api, clearing_job, snapshot_reader;
GRANT SELECT ON event_rsvps TO office_api;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON events, event_rsvps FROM office_api, clearing_job, snapshot_reader;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('posts', 'projection', 'office_api', '{clearing_job,snapshot_reader}',
   'Keemin 2026-09-27 (the Posts project) through Wright (POS-288): one record with a life; the act log is the record, this its current-state projection, rebuildable by world2/tools/events-rebuild.mjs'),
  ('responses', 'projection', 'office_api', '{}',
   'Keemin 2026-09-27 (the Posts project) through Wright (POS-288): one row per resident per post per kind (an RSVP today), the projection of those acts')
ON CONFLICT (object) DO NOTHING;

UPDATE registry SET kind = 'derived',
       ruling = 'POS-288 (028): a compat VIEW over ' || CASE object WHEN 'events' THEN 'posts' ELSE 'responses' END
                || ' with 026''s columns, read-only, for one release at least'
 WHERE object IN ('events', 'event_rsvps') AND kind <> 'derived';

COMMIT;
