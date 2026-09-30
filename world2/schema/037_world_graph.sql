-- 037 — the world graph, a snapshot per settlement (POS-270, lane retire-sqlite-world-graph)
--
-- THE RULING (Wright, 2026-09-30, option A, on Keemin's "stop using sqlite and
-- maintaining two versions of something"): world.db's graph moves into the
-- store as a snapshot per settlement, keyed by the settlement's tag sha AND
-- the office sha whose source the code nodes were parsed from. world.db is
-- hydrated at the newest blessing already, so the graph has no live delta to
-- compute: one settlement, one snapshot.
--
-- ── WHAT IS IN IT, MEASURED (S87 blessed, world 1a22bbd8, 2026-09-30) ───────
--
--   nodes    1683  mark 1287 · code 363 · class 11 · doctrine 8
--   edges    2436  imports 683 · contains 659 · describes 628 · reads 250
--                  · instance-of 203 · implements 9 · stop-of 4
--   geometry  899  the tense law (a mark's geometry with its validity window)
--   lints       8  the standing invariants' verdicts at the hydration
--
-- The code nodes and the imports/reads edges are the OFFICE's own source,
-- parsed at hydration. That is why the office sha is in the key, and why
-- marks + law_projection alone could not carry the graph. The walk ledger's
-- `events` table is 038.
--
-- ── BYTES, NOT A RE-READING ─────────────────────────────────────────────────
--
-- Every column is world.db's column with its value unchanged. The JSON columns
-- (props, evidence, meta values) are `text`, not jsonb: jsonb sorts keys, and
-- a reader that serialises props (the window's payload) must answer the same
-- bytes from either source. `ord` is the row's place in the file's own scan
-- order, because the graph's iteration order (and so the window's node list)
-- follows the order the rows were built in.
--
-- ── PENS ────────────────────────────────────────────────────────────────────
--
-- One writer: `law_ingester`, which already copies the repo-derived rulebook
-- (law_projection) and is the pen for "repo in, projection out". It runs
-- world2/tools/graph-ingest.mjs after the blessed hydration. It INSERTs a
-- whole snapshot and DELETEs the ones past the kept few, and never UPDATEs.
-- The office reads (office_api SELECT) through src/world-graph-snapshot.mjs.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/037_world_graph.sql
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ──────
--
--   SELECT tablename FROM pg_tables WHERE tablename LIKE 'world_graph%' ORDER BY 1;
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name LIKE 'world_graph%' ORDER BY 1, 2, 3;
--   SELECT object FROM registry WHERE object LIKE 'world_graph%' ORDER BY 1;
--
-- CONSUMERS, named: world2/tools/graph-ingest.mjs (the writer),
-- src/world-graph-snapshot.mjs (the office's one reader), and through it
-- src/world-graph.mjs (the window), src/world-serve.mjs (the store snapshot
-- and its health line), src/world-lints.mjs (runLints over a loaded store).
-- test/world-graph-parity.test.mjs holds the snapshot equal to world.db.

BEGIN;

CREATE TABLE IF NOT EXISTS world_graphs (
  tag_sha     text NOT NULL,                  -- meta.as_of_world: the blessing the graph was hydrated at
  office_sha  text NOT NULL,                  -- meta.as_of_office: the office source the code nodes came from
  settlement  integer,                        -- meta.as_of_settlement's number (NULL when hydrated off-tag)
  built_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tag_sha, office_sha)
);

CREATE TABLE IF NOT EXISTS world_graph_meta (
  tag_sha text NOT NULL, office_sha text NOT NULL, ord integer NOT NULL,
  key text NOT NULL, value text,
  PRIMARY KEY (tag_sha, office_sha, key),
  FOREIGN KEY (tag_sha, office_sha) REFERENCES world_graphs ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_graph_nodes (
  tag_sha text NOT NULL, office_sha text NOT NULL, ord integer NOT NULL,
  id text NOT NULL,
  kind text, subkind text, tier text, by text,
  at_x double precision, at_y double precision, extent_w double precision, extent_h double precision,
  props text,
  PRIMARY KEY (tag_sha, office_sha, id),
  FOREIGN KEY (tag_sha, office_sha) REFERENCES world_graphs ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_graph_edges (
  tag_sha text NOT NULL, office_sha text NOT NULL,
  seq integer NOT NULL,                       -- world.db's edges.seq, which the graph keys each edge by (e<seq>)
  src text, dst text, type text, props text, born_at text,
  PRIMARY KEY (tag_sha, office_sha, seq),
  FOREIGN KEY (tag_sha, office_sha) REFERENCES world_graphs ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_graph_geometry (
  tag_sha text NOT NULL, office_sha text NOT NULL,
  seq integer NOT NULL,
  mark_id text,
  at_x double precision, at_y double precision, extent_w double precision, extent_h double precision,
  valid_from_iso text, valid_to_iso text,
  sha text, path text, subject text, authored_iso text,
  change text,
  PRIMARY KEY (tag_sha, office_sha, seq),
  FOREIGN KEY (tag_sha, office_sha) REFERENCES world_graphs ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_graph_lints (
  tag_sha text NOT NULL, office_sha text NOT NULL, ord integer NOT NULL,
  lint text NOT NULL,
  verdict text, headline text, evidence text, hydrated_at text, as_of_world text,
  PRIMARY KEY (tag_sha, office_sha, lint),
  FOREIGN KEY (tag_sha, office_sha) REFERENCES world_graphs ON DELETE CASCADE
);

REVOKE ALL ON world_graphs, world_graph_meta, world_graph_nodes, world_graph_edges, world_graph_geometry, world_graph_lints
  FROM office_api, clearing_job, law_ingester, snapshot_reader;
GRANT SELECT ON world_graphs, world_graph_meta, world_graph_nodes, world_graph_edges, world_graph_geometry, world_graph_lints
  TO office_api, law_ingester, snapshot_reader;
GRANT INSERT, DELETE ON world_graphs, world_graph_meta, world_graph_nodes, world_graph_edges, world_graph_geometry, world_graph_lints
  TO law_ingester;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('world_graphs',         'projection', 'law_ingester', '{office_api}', 'Wright 2026-09-30 (POS-270, option A): the world graph as a snapshot per settlement, keyed (tag_sha, office_sha); a copy of world.db''s rows, never re-read'),
  ('world_graph_meta',     'projection', 'law_ingester', '{office_api}', 'Wright 2026-09-30 (POS-270, option A): world.db meta, per snapshot'),
  ('world_graph_nodes',    'projection', 'law_ingester', '{office_api}', 'Wright 2026-09-30 (POS-270, option A): world.db nodes (mark, code, class, doctrine), per snapshot'),
  ('world_graph_edges',    'projection', 'law_ingester', '{office_api}', 'Wright 2026-09-30 (POS-270, option A): world.db edges, per snapshot'),
  ('world_graph_geometry', 'projection', 'law_ingester', '{office_api}', 'Wright 2026-09-30 (POS-270, option A): world.db geometry_versions (the tense law), per snapshot'),
  ('world_graph_lints',    'projection', 'law_ingester', '{office_api}', 'Wright 2026-09-30 (POS-270, option A): world.db lint_findings, per snapshot')
ON CONFLICT (object) DO NOTHING;

COMMIT;
