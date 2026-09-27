-- 027 — the office's paperwork: sign-in sessions, household keys, berths, key
--       claims and the subscription roles, moved out of oauth.db and roles.db
--       (POS-271, w41, "we need to retire sqlite", Keemin 2026-09-27)
--
-- ── WHAT MOVES, AND WHAT DOES NOT ───────────────────────────────────────────
--
-- Eight tables, one per SQLite table, column for column:
--
--   oauth.db  clients, pending, codes, tokens, berths, key_claims
--             -> oauth_clients, oauth_pending, oauth_codes, oauth_tokens,
--                oauth_berths, oauth_key_claims
--   roles.db  roles, role_audit -> office_roles, office_role_audit
--
-- The `oauth_` and `office_` prefixes are there because `roles` and `tokens`
-- are words this store and Postgres itself already use for other things.
--
-- oauth.db also holds the media quota ledger (`media`) and the town log
-- (`town_journal` + `meta`, behind TOWN_SINGLE_LOG). Neither is sign-in and
-- neither moves here: the brief names roles and OAuth sessions.
--
-- ── THE SHAPE IS SQLITE'S, ON PURPOSE ───────────────────────────────────────
--
-- The import (world2/tools/paperwork-import.mjs) copies rows and then compares
-- every row with its source, column by column. That comparison is what makes
-- "nobody was signed out" a checked fact. So nothing is reshaped on the way:
--
--   · `json` columns stay `text`. jsonb re-sorts keys and would make a copied
--     row unequal to its source (and `pending.json` is read back whole).
--   · times stay what the office writes: integer epoch SECONDS on the oauth
--     tables (`expires < now()` in oauth.mjs is seconds) and ISO text on the
--     role tables.
--   · epoch seconds are `bigint`, not `integer`. A household key expires 100
--     years out (KEY_TTL_S), about 4.9e9, which is past int4.
--   · gh ids are `bigint` too. node-postgres hands int8 back as a STRING, so
--     the readers wired later must parse it (or cast in SQL) where node:sqlite
--     handed them a number. That is the readers' change, named here.
--
-- ── WHO HOLDS WHAT ──────────────────────────────────────────────────────────
--
-- `office_api`, the only runtime pen: the doors that mint, rotate and sweep
-- these rows connect as it, and so will the operator CLI (tools/roles.mjs).
-- The grants are the statements the office actually runs, read off oauth.mjs
-- and roles.mjs, and nothing wider:
--
--   oauth_clients      SELECT INSERT                  (a registration is never edited)
--   oauth_pending      SELECT INSERT UPDATE DELETE    (the authorize round trip; swept at 10 min)
--   oauth_codes        SELECT INSERT DELETE           (spent on exchange; swept at 120 s)
--   oauth_tokens       SELECT INSERT DELETE           (rotation and the sweep delete; nothing updates a token)
--   oauth_berths       SELECT INSERT UPDATE           (the card and the co-sign update; a berth is never deleted)
--   oauth_key_claims   SELECT INSERT UPDATE DELETE    (co-sign updates; spent and swept claims are deleted)
--   office_roles       SELECT INSERT UPDATE DELETE    (grant upserts, the login label updates, revoke deletes)
--   office_role_audit  SELECT INSERT                  (append-only: who granted what, and when)
--
-- Deleting is lawful here where it is not on the record, because none of this
-- is the record. A session is a credential. An expired or rotated one has to
-- STOP resolving, and deletion is how the office has always made it stop.
-- office_role_audit keeps the history of the one table whose history matters.
--
-- NO OTHER ROLE READS THESE, and row level security holds that. Every table has
-- RLS on and one policy, `TO office_api`, that admits everything. snapshot_reader
-- (the notary's export credential) was granted `SELECT ON ALL TABLES` by 002.
-- A re-run of 002 would reach these tables too, and RLS with no policy for that
-- role still shows it no row. A token is stored as its hash, but key_claims'
-- `ask_hash` is a capability, and none of it belongs in a public export.
-- (026's household_harnesses takes the same precaution for the same reason.)
--
-- 003_falsifier_roles.sql's lawful list carries the matching rows in this same
-- commit, and world2/tools/migrations-landed.mjs carries the probe.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` ─────────────────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/028_office_paperwork.sql
--
-- A second run is a no-op: IF NOT EXISTS on every table and index, a
-- pg_policies check before each CREATE POLICY, ON CONFLICT DO NOTHING on the
-- registry rows, and a GRANT is idempotent. The tables are EMPTY when this
-- lands. The rows arrive by the import, which is a separate, checked step.
--
-- CONSUMERS, named: none yet. The readers and writers (oauth.mjs, roles.mjs,
-- household-apex.mjs's berth card, tools/roles.mjs) move in the switch, after
-- this shape is reviewed. world2/tools/paperwork-import.mjs writes and compares.

BEGIN;

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id   text PRIMARY KEY,
  json        text,
  created     bigint
);

CREATE TABLE IF NOT EXISTS oauth_pending (
  id          text PRIMARY KEY,
  json        text,
  expires     bigint
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code        text PRIMARY KEY,
  json        text,
  expires     bigint
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash        text PRIMARY KEY,      -- sha256(token), base64url; the token itself is never stored
  kind              text,                  -- access | refresh | household
  gh_id             bigint,
  gh_login          text,
  client_id         text,
  expires           bigint,
  created           bigint,
  held_by           text,                  -- 'resident' when the key is in a resident's hand, else NULL
  claimed_handle    text,
  cosigned_gh_id    bigint,
  cosigned_gh_login text
);

CREATE TABLE IF NOT EXISTS oauth_berths (
  slug              text PRIMARY KEY,
  token_hash        text UNIQUE,
  created           bigint,
  expires           bigint,
  card              text,
  cosigned_gh_id    bigint,
  cosigned_gh_login text,
  cosigned_at       bigint,
  from_town         text
);

CREATE TABLE IF NOT EXISTS oauth_key_claims (
  ask_hash          text PRIMARY KEY,      -- the capability: sha256 of the link's secret
  handle            text,
  token_hash        text UNIQUE,
  created           bigint,
  expires           bigint,
  cosigned_gh_id    bigint,
  cosigned_gh_login text,
  cosigned_at       bigint
);
CREATE INDEX IF NOT EXISTS oauth_key_claims_handle ON oauth_key_claims (handle);

CREATE TABLE IF NOT EXISTS office_roles (
  subject     text NOT NULL,               -- the household's gh_id, as digits
  role        text NOT NULL,
  login       text,                        -- display only
  granted_at  text NOT NULL,
  granted_by  text NOT NULL,
  note        text,
  PRIMARY KEY (subject, role)
);

CREATE TABLE IF NOT EXISTS office_role_audit (
  id          bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,   -- the import keeps roles.db's ids, then moves the sequence past them
  at          text NOT NULL,
  action      text NOT NULL,
  subject     text NOT NULL,
  role        text NOT NULL,
  login       text,
  actor       text NOT NULL,
  note        text
);
CREATE INDEX IF NOT EXISTS office_role_audit_subject ON office_role_audit (subject, id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['oauth_clients','oauth_pending','oauth_codes','oauth_tokens',
                           'oauth_berths','oauth_key_claims','office_roles','office_role_audit'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_office') THEN
      EXECUTE format('CREATE POLICY %I ON %I TO office_api USING (true) WITH CHECK (true)', t || '_office', t);
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT                 ON oauth_clients     TO office_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_pending     TO office_api;
GRANT SELECT, INSERT, DELETE         ON oauth_codes       TO office_api;
GRANT SELECT, INSERT, DELETE         ON oauth_tokens      TO office_api;
GRANT SELECT, INSERT, UPDATE         ON oauth_berths      TO office_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_key_claims  TO office_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON office_roles      TO office_api;
GRANT SELECT, INSERT                 ON office_role_audit TO office_api;
GRANT USAGE ON SEQUENCE office_role_audit_id_seq TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('oauth_clients',     'source', 'office_api', '{}', 'Keemin 2026-09-27 (POS-271): oauth.db moves into the store; dynamic client registrations'),
  ('oauth_pending',     'source', 'office_api', '{}', 'Keemin 2026-09-27 (POS-271): the authorize round trip, ten minutes long'),
  ('oauth_codes',       'source', 'office_api', '{}', 'Keemin 2026-09-27 (POS-271): authorization codes, 120 s'),
  ('oauth_tokens',      'source', 'office_api', '{}', 'Keemin 2026-09-27 (POS-271): every sign-in session and household key, by hash; moved without signing anyone out'),
  ('oauth_berths',      'source', 'office_api', '{}', 'Keemin 2026-09-27 (POS-271): the harbor''s berth keys and cards'),
  ('oauth_key_claims',  'source', 'office_api', '{}', 'Keemin 2026-09-27 (POS-271): the claim desk''s asks'),
  ('office_roles',      'source', 'office_api', '{}', 'Keemin 2026-09-27 (POS-271): roles.db moves into the store; the subscription registry'),
  ('office_role_audit', 'source', 'office_api', '{}', 'Keemin 2026-09-27 (POS-271): the registry''s append-only audit')
ON CONFLICT (object) DO NOTHING;

COMMIT;
