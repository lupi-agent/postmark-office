-- Falsifier: the three-pens law, enumerated (gold §3 rule 2).
-- LAW (verbatim, gold plan §3 rule 2): "Writers are roles, and there are exactly
-- three DB pens ... Enforced by Postgres roles/RLS, not convention. A falsifier
-- enumerates roles with write grants and reds if a fourth appears."
--
-- Run: psql -d world2_dev -f 003_falsifier_roles.sql
-- GREEN = zero rows. Any row printed is a pen that exists outside the law.
-- This query CAN FAIL: grant INSERT on any table to snapshot_reader (or any
-- new role) and a row appears. (Verification probes must be able to fail.)

WITH writers AS (
  SELECT grantee, table_name, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
    AND grantee NOT IN ('postgres', 'world2_owner')   -- owner = migrations only, not a runtime pen
),
lawful AS (
  SELECT * FROM (VALUES
    ('office_api',   'acts',             'INSERT'),
    ('office_api',   'claims',           'INSERT'),
    ('office_api',   'claims',           'UPDATE'),
    -- 007_private_drafts.sql, and it is the ONLY grant on this list that a row
    -- policy rather than a trigger keeps narrow: `claims_delete_own_draft`
    -- restricts it to `status = 'draft'` rows of the acting household, and
    -- `claims_delete_guard` refuses a non-draft deletion for every role
    -- including the owner. Lawful because a draft is the one claims state with
    -- no public receipt obligation — nobody outside the household has seen it,
    -- so nobody outside the household is owed an account of its ending. Every
    -- other state here is a public fact, and a public fact is retracted, never
    -- deleted. 007's header carries the full argument.
    ('office_api',   'claims',           'DELETE'),
    -- 018_settlements.sql. One row per settlement/S<n> tag, INSERT only — a
    -- blessing is canon and is never rewritten, so no pen holds UPDATE or DELETE.
    -- office_api because the row is written from the office's own world clone,
    -- under the office's own connection, after the keeper's tag lands there;
    -- the pen is named in 018's header and is one word to move if ruled otherwise.
    ('office_api',   'settlements',      'INSERT'),
    -- 049_mark_carried.sql (POS-142 Proposal B). Which settlement first carried
    -- each mark, written once from the same clone and connection as the
    -- settlement row above; INSERT only, because that fact never moves.
    ('office_api',   'mark_carried',     'INSERT'),
    -- 053_position_snapshots.sql (POS-302). Each resident's governing departure,
    -- kept once per clearing from the keep tick's own connection; INSERT only,
    -- because a snapshot is written once and never moves.
    ('office_api',   'position_snapshots',     'INSERT'),
    ('office_api',   'position_snapshot_rows', 'INSERT'),
    -- 019_households.sql. The household registry as store-of-record: the two
    -- town JSON files become a rendering of these tables. `office_api` because
    -- it is the role the door that DECLARES a household already connects as
    -- (src/world2-acts.mjs:28) — `clearing_job` runs at a window's close and
    -- `law_ingester` runs the ingest, and neither stands where a house is
    -- declared. INSERT + UPDATE and no DELETE: a household row is edited in
    -- place (a house gains a resident, states its name, appends an account),
    -- which is what makes it a SOURCE rather than a projection, and a house is
    -- never removed — the file has never removed a row and the town's witness
    -- refuses a PR that does ("nothing removed", town tools/witness.mjs:31).
    ('office_api',   'households',       'INSERT'),
    ('office_api',   'households',       'UPDATE'),
    ('office_api',   'household_pins',   'INSERT'),
    ('office_api',   'household_pins',   'UPDATE'),
    ('office_api',   'registry_meta',    'INSERT'),
    ('office_api',   'registry_meta',    'UPDATE'),
    -- 026_events.sql. The calendar's current state, projected from the event
    -- acts in the same transaction as each act. INSERT + UPDATE and no DELETE:
    -- an amendment, a cancellation or a second RSVP updates the current row,
    -- and the history is the act log. office_api, because the household door
    -- that performs the acts connects as it.
    ('office_api',   'events',           'INSERT'),
    ('office_api',   'events',           'UPDATE'),
    ('office_api',   'event_rsvps',      'INSERT'),
    ('office_api',   'event_rsvps',      'UPDATE'),
    -- 028_posts.sql (POS-288). The rename carried the two grants above to
    -- `posts` and `responses`, which are the same tables under their general
    -- names; 028 revokes writes on the compat VIEWS that now hold the old names.
    -- The old rows stay because 026's own text still grants them.
    ('office_api',   'posts',            'INSERT'),
    ('office_api',   'posts',            'UPDATE'),
    ('office_api',   'responses',        'INSERT'),
    ('office_api',   'responses',        'UPDATE'),
    -- 026_events.sql, the resident's private harness row (POS-208, ruled
    -- 2026-09-25). Narrowed by its row policy to the acting household's own
    -- rows; no DELETE, because a registration is replaced, never removed.
    ('office_api',   'household_harnesses', 'INSERT'),
    ('office_api',   'household_harnesses', 'UPDATE'),
    -- 026_events.sql, the earpiece's log (POS-209). One row per attempted
    -- wake, narrowed by its row policy to the resident's own household; INSERT
    -- only, because a log line is never edited or removed.
    ('office_api',   'earpiece_wakes',   'INSERT'),
    -- 029_letter_opens.sql, which delivered letters a household has opened
    -- (POS-286). Narrowed by its row policy to the recipient's own household;
    -- INSERT only, because a letter is opened once and nothing un-reads it.
    ('office_api',   'letter_opens',     'INSERT'),
    -- 030_arrival_heard.sql, where a joining human heard about Postmark
    -- (POS-292). INSERT only and no SELECT policy for any role: the answer is
    -- given once, and read only as counts through arrival_heard_weekly().
    ('office_api',   'arrival_heard',    'INSERT'),
    -- 031_office_paperwork.sql, oauth.db and roles.db moved into the store
    -- (POS-271). Each grant is a statement oauth.mjs or roles.mjs runs today.
    -- The DELETEs are lawful because none of this is the record: an expired or
    -- rotated credential has to stop resolving, and deletion is how it stops.
    -- The audit table is INSERT only. Row level security keeps every other
    -- role out.
    ('office_api',   'oauth_clients',    'INSERT'),
    ('office_api',   'oauth_pending',    'INSERT'),
    ('office_api',   'oauth_pending',    'UPDATE'),
    ('office_api',   'oauth_pending',    'DELETE'),
    ('office_api',   'oauth_codes',      'INSERT'),
    ('office_api',   'oauth_codes',      'DELETE'),
    ('office_api',   'oauth_tokens',     'INSERT'),
    ('office_api',   'oauth_tokens',     'DELETE'),
    ('office_api',   'oauth_berths',     'INSERT'),
    ('office_api',   'oauth_berths',     'UPDATE'),
    ('office_api',   'oauth_key_claims', 'INSERT'),
    ('office_api',   'oauth_key_claims', 'UPDATE'),
    ('office_api',   'oauth_key_claims', 'DELETE'),
    ('office_api',   'office_roles',     'INSERT'),
    ('office_api',   'office_roles',     'UPDATE'),
    ('office_api',   'office_roles',     'DELETE'),
    ('office_api',   'office_role_audit', 'INSERT'),
    -- 032_office_ledgers.sql, the rest of oauth.db (POS-271): the media quota
    -- ledger and the town log are append-only, and the drain cursor is the one
    -- row that is upserted.
    ('office_api',   'office_media',     'INSERT'),
    ('office_api',   'office_town_journal', 'INSERT'),
    ('office_api',   'office_meta',      'INSERT'),
    ('office_api',   'office_meta',      'UPDATE'),
    ('clearing_job', 'claims',           'UPDATE'),
    ('clearing_job', 'windows',          'INSERT'),
    ('clearing_job', 'windows',          'UPDATE'),
    ('clearing_job', 'marks',            'INSERT'),
    ('clearing_job', 'marks',            'UPDATE'),
    ('law_ingester', 'law_projection',   'INSERT'),
    ('law_ingester', 'law_projection',   'DELETE'),
    ('law_ingester', 'stamp_projection', 'INSERT'),
    ('law_ingester', 'stamp_projection', 'DELETE'),
    -- 010_town_roll.sql. The town's SECOND projection, written by the same pen
    -- in the same transaction against the same `projection_heads` row — so it
    -- is the stamp lane's grants, not a fourth writer. INSERT + DELETE and no
    -- UPDATE, like every projection here: replaced, never edited.
    ('law_ingester', 'town_roll',        'INSERT'),
    ('law_ingester', 'town_roll',        'DELETE'),
    -- 033_town_index.sql (POS-268). office.db's tables as the town index, the
    -- same pen's third town projection. INSERT + DELETE and no UPDATE, like every
    -- projection here: a changed row is replaced. The snapshot ledger is INSERT
    -- only, because a recorded snapshot is never rewritten.
    ('law_ingester', 'town_meta',                  'INSERT'),
    ('law_ingester', 'town_meta',                  'DELETE'),
    ('law_ingester', 'town_residents',             'INSERT'),
    ('law_ingester', 'town_residents',             'DELETE'),
    ('law_ingester', 'town_letters',               'INSERT'),
    ('law_ingester', 'town_letters',               'DELETE'),
    ('law_ingester', 'town_threads',               'INSERT'),
    ('law_ingester', 'town_threads',               'DELETE'),
    ('law_ingester', 'town_bulletin',              'INSERT'),
    ('law_ingester', 'town_bulletin',              'DELETE'),
    ('law_ingester', 'town_ledger',                'INSERT'),
    ('law_ingester', 'town_ledger',                'DELETE'),
    ('law_ingester', 'town_stamps',                'INSERT'),
    ('law_ingester', 'town_stamps',                'DELETE'),
    ('law_ingester', 'town_mail_state',            'INSERT'),
    ('law_ingester', 'town_mail_state',            'DELETE'),
    ('law_ingester', 'town_quest_progress',        'INSERT'),
    ('law_ingester', 'town_quest_progress',        'DELETE'),
    ('law_ingester', 'town_quest_standing',        'INSERT'),
    ('law_ingester', 'town_quest_standing',        'DELETE'),
    ('law_ingester', 'town_repo_log',              'INSERT'),
    ('law_ingester', 'town_repo_log',              'DELETE'),
    ('law_ingester', 'town_regions',               'INSERT'),
    ('law_ingester', 'town_regions',               'DELETE'),
    ('law_ingester', 'town_homes',                 'INSERT'),
    ('law_ingester', 'town_homes',                 'DELETE'),
    ('law_ingester', 'town_pots',                  'INSERT'),
    ('law_ingester', 'town_pots',                  'DELETE'),
    ('law_ingester', 'town_funding_roll',          'INSERT'),
    ('law_ingester', 'town_funding_roll',          'DELETE'),
    ('law_ingester', 'town_funding_holo',          'INSERT'),
    ('law_ingester', 'town_funding_holo',          'DELETE'),
    ('law_ingester', 'town_funding_keeping_mint',  'INSERT'),
    ('law_ingester', 'town_funding_keeping_mint',  'DELETE'),
    ('law_ingester', 'town_pot_receipts',          'INSERT'),
    ('law_ingester', 'town_pot_receipts',          'DELETE'),
    ('law_ingester', 'town_pot_escrow',            'INSERT'),
    ('law_ingester', 'town_pot_escrow',            'DELETE'),
    ('law_ingester', 'town_pot_stakers',           'INSERT'),
    ('law_ingester', 'town_pot_stakers',           'DELETE'),
    ('law_ingester', 'town_funding_invalid',       'INSERT'),
    ('law_ingester', 'town_funding_invalid',       'DELETE'),
    ('law_ingester', 'town_index_snapshots',       'INSERT'),
    ('law_ingester', 'projection_heads', 'INSERT'),
    ('law_ingester', 'projection_heads', 'UPDATE'),
    ('law_ingester', 'projection_heads', 'DELETE'),
    ('law_ingester', 'identities',       'INSERT'),
    ('law_ingester', 'identities',       'UPDATE'),
    ('law_ingester', 'identities',       'DELETE'),
    -- 037_world_graph.sql + 038_world_graph_events.sql (POS-270): the world
    -- graph's snapshot per settlement. The law pen copies it from the blessed
    -- hydration; INSERT + DELETE and no UPDATE, replaced, never edited.
    ('law_ingester', 'world_graphs', 'INSERT'),
    ('law_ingester', 'world_graphs', 'DELETE'),
    ('law_ingester', 'world_graph_meta', 'INSERT'),
    ('law_ingester', 'world_graph_meta', 'DELETE'),
    ('law_ingester', 'world_graph_nodes', 'INSERT'),
    ('law_ingester', 'world_graph_nodes', 'DELETE'),
    ('law_ingester', 'world_graph_edges', 'INSERT'),
    ('law_ingester', 'world_graph_edges', 'DELETE'),
    ('law_ingester', 'world_graph_geometry', 'INSERT'),
    ('law_ingester', 'world_graph_geometry', 'DELETE'),
    ('law_ingester', 'world_graph_lints', 'INSERT'),
    ('law_ingester', 'world_graph_lints', 'DELETE'),
    ('law_ingester', 'world_graph_events', 'INSERT'),
    ('law_ingester', 'world_graph_events', 'DELETE')
  ) AS t(grantee, table_name, privilege_type)
)
SELECT w.* FROM writers w
LEFT JOIN lawful l USING (grantee, table_name, privilege_type)
WHERE l.grantee IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- THE SECOND QUERY — WHO MAY SEE A DRAFT (023_stance_reader.sql, 2026-09-22)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 023 grants `stance_reader` SELECT on `claims` and adds `claims_read_stance`,
-- a policy admitting draft rows to that role. It adds NO WRITE, so the query
-- above cannot see it: `writers` filters on INSERT/UPDATE/DELETE/TRUNCATE by
-- design, and a read-only role is invisible to the three-pens law — which is
-- correct, because `stance_reader` is not a fourth pen. It writes nothing.
--
-- But "who may WRITE" was the only question this file asked, and 023 makes a
-- second one load-bearing: WHO MAY SEE A DRAFT. Before 023 the answer was
-- "nobody but the owner, and 002 bars the owner from runtime" and it was a
-- fact about the shape of 007 rather than a list anyone maintained. After 023
-- it is a list of exactly one, and a list of one is a thing that grows quietly.
--
-- So it gets its own enumeration, in this file, for 007's own stated reason:
-- "Enforced structurally, not by vigilance." A second role admitted to drafts
-- by a future migration prints a row here instead of being noticed by whoever
-- next reads 007.
--
-- WHAT IT LOOKS AT: every permissive SELECT policy on `claims` whose USING
-- clause does not carry 007's household test. `claims_read` narrows itself with
-- `household = current_setting('app.household', true)`, so it admits a draft
-- only to a transaction that has declared that draft's own household — that is
-- the general rule and it is lawful for everyone. Any OTHER select policy is a
-- carve, and every carve must be on the list below.
--
-- GREEN = zero rows. This query CAN FAIL, which is the standard 003 holds
-- itself to: `CREATE POLICY anything ON claims FOR SELECT TO snapshot_reader
-- USING (true)` prints a row immediately. It is the same hole
-- `falsifier-draft-privacy.mjs --self-test` injects, caught statically.

WITH draft_carves AS (
  SELECT policyname, unnest(roles)::text AS grantee, qual
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename  = 'claims'
     AND cmd IN ('SELECT', 'ALL')
     AND permissive = 'PERMISSIVE'
     -- 007's general rule narrows itself by the acting household; a policy that
     -- does NOT is admitting drafts on some other ground, and that is a carve.
     AND coalesce(qual, '') NOT LIKE '%app.household%'
),
lawful_carves AS (
  SELECT * FROM (VALUES
    -- 023_stance_reader.sql. `worldForStances`' narrow 2.0 read, DEC-14's
    -- "may see overlapping drafts across households", ruled 2026-09-22
    -- (RULING 2). Lawful because the-late-welcome requires that a ground-holder
    -- learn a sketch stands on their ground before it publishes, and 1.0's
    -- journal already told them — the information moves from one record to the
    -- other and the boundary (a draft's TEXT is its author's until submit) is
    -- unchanged. What makes it safe is not this policy, which is `USING (true)`:
    -- it is that one reader holds the credential, that reader never SELECTs
    -- `claims.body`, and two falsifiers assert the output carries no draft body
    -- (falsifier-draft-privacy.mjs § the stance carve;
    -- test/stance-candidates-read-the-store.test.mjs § the sentinel). 023's header carries
    -- the full argument.
    ('claims_read_stance', 'stance_reader')
  ) AS t(policyname, grantee)
)
SELECT c.policyname, c.grantee, c.qual
  FROM draft_carves c
  LEFT JOIN lawful_carves l USING (policyname, grantee)
 WHERE l.policyname IS NULL;
