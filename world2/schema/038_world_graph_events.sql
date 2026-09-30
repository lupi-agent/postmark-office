-- 038 — the world graph's walk ledger, per snapshot (POS-270, lane retire-sqlite-world-graph)
--
-- world.db's fourth companion table beside 037's: `events`, the walk ledger the
-- hydration parses out of WORLD/walk-ledger.md (317 rows at S87 blessed). The
-- graph's loader returns it with the graph, and the tense-law lints read it,
-- so a snapshot without it would not equal the file. It sits in its own
-- migration because 037's ruling named four tables; this is the fifth, on
-- the lane's own second ordinal.
--
-- Same rules as 037: world.db's columns with their values unchanged, `payload`
-- as `text`, one writer (`law_ingester`, graph-ingest.mjs), read by the office.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, after 037 ───────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/038_world_graph_events.sql
--
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'world_graph_events' ORDER BY 1, 2;
--
-- CONSUMERS, named: world2/tools/graph-ingest.mjs (the writer),
-- src/world-graph-snapshot.mjs (the reader).

BEGIN;

CREATE TABLE IF NOT EXISTS world_graph_events (
  tag_sha text NOT NULL, office_sha text NOT NULL,
  seq integer NOT NULL,
  at text, actor text, type text, payload text,
  PRIMARY KEY (tag_sha, office_sha, seq),
  FOREIGN KEY (tag_sha, office_sha) REFERENCES world_graphs ON DELETE CASCADE
);

REVOKE ALL ON world_graph_events FROM office_api, clearing_job, law_ingester, snapshot_reader;
GRANT SELECT ON world_graph_events TO office_api, law_ingester, snapshot_reader;
GRANT INSERT, DELETE ON world_graph_events TO law_ingester;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('world_graph_events', 'projection', 'law_ingester', '{office_api}', 'Wright 2026-09-30 (POS-270, option A): world.db events (the walk ledger), per snapshot')
ON CONFLICT (object) DO NOTHING;

COMMIT;
