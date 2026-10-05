-- 055 — `identities` IS DERIVED FROM THE REGISTRY (019): a VIEW, not the law pen's table
-- (postmark POS-350, w42 "Everything Reads the Store")
--
-- THE RULING (Darko, 2026-10-04, applied 10-05 on Wright's recommendation): git
-- can be written to, the store reads git, the store is the record, and every
-- reader reads the store. `identities` was a TABLE that law_ingester refilled on
-- every law run from the WORLD repo's WORLD/households.json — which the box's
-- sweep exports from the TOWN's ledger resolver over the town's printouts: a
-- printout of a printout, four hops from the fact. The household registry is
-- already the store's (019–021, one writer: the ceremony, through office_api).
-- So `identities` becomes a VIEW over `households` and `household_pins`, and the
-- law pen stops writing it (world2/tools/law-ingest.mjs).
--
-- ── THE COLUMNS, AND WHERE EACH NOW COMES FROM ─────────────────────────────
--
--   handle     every handle the registry knows: a house's `residents`, and every
--              pinned handle
--   household  `hh:<slug>` for the house the handle stands in, else
--              `solo:<handle>`. The house is found the way the office's one
--              deriver finds it (src/household-deriver.mjs § resolveHouse): a
--              house that LISTS the handle first, then a house holding the
--              handle's PIN's account id (`accounts[].id`), lowest `ord` on a
--              tie. It was the economy's key (`gh:<id>` ×173 measured 09-22);
--              it is now the house key — "which house now", the same answer
--              POS-160 gave `householdKeyFor`. Rows written under the old
--              spellings are still read: every household filter compares
--              against the session's spelling set (024).
--   human      the house's `human`
--   gh_login   the pin's `login`
--   gh_id      the pin's `gh_id`
--   since      NULL, as the table always held (WORLD/households.json stated no date)
--   status     'retired' for a pin with `retired` set, else 'resident'
--   data       { source: "the registry (019)", slug }
--
-- ── THE READERS (each reads `handle, household`) ───────────────────────────
--
--   src/world2-serve.mjs § the parcels read      whose ground counts as yours
--   world2/tools/guard-reads.mjs § WITHDRAW_ACT_SELECT   `household = ANY($1)`
--   world2/tools/portfolio-reads.mjs § the my-marks household   `= ANY($1)`
--   the falsifiers (guard-equality, live-equality, projection-equality)
--
-- `= ANY($1)` is the session's spelling set (024), whose first member is the
-- house's own `hh:<slug>`, so a housed resident's rows match as before.
--
-- ── IDEMPOTENT ──────────────────────────────────────────────────────────────
--
-- The table is dropped only while it IS a table (relkind 'r'); CREATE OR
-- REPLACE VIEW and the grants are safe to re-run; the manifest update is guarded.
-- Probe (world2/tools/migrations-landed.mjs): `identities` is a view.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'identities' AND c.relkind = 'r') THEN
    DROP TABLE identities;
  END IF;
END $$;

CREATE OR REPLACE VIEW identities AS
WITH listed AS (
  SELECT r.handle, h.slug, 1 AS road, h.ord
    FROM households h CROSS JOIN LATERAL unnest(h.residents) AS r(handle)
),
pinned AS (
  SELECT p.handle, h.slug, 2 AS road, h.ord
    FROM household_pins p
    JOIN households h
      ON EXISTS (SELECT 1 FROM jsonb_array_elements(h.accounts) a
                  WHERE (a->>'id') ~ '^[0-9]+$' AND (a->>'id')::bigint = p.gh_id)
),
house AS (
  SELECT DISTINCT ON (handle) handle, slug
    FROM (SELECT * FROM listed UNION ALL SELECT * FROM pinned) x
   ORDER BY handle, road, ord
),
handles AS (
  SELECT handle FROM listed
  UNION
  SELECT handle FROM household_pins
)
SELECT k.handle,
       COALESCE('hh:' || hs.slug, 'solo:' || k.handle) AS household,
       h.human,
       p.login AS gh_login,
       p.gh_id,
       NULL::date AS since,
       CASE WHEN p.retired IS NOT NULL THEN 'retired' ELSE 'resident' END AS status,
       jsonb_build_object('source', 'the registry (019)', 'slug', hs.slug) AS data
  FROM handles k
  LEFT JOIN house hs ON hs.handle = k.handle
  LEFT JOIN households h ON h.slug = hs.slug
  LEFT JOIN household_pins p ON p.handle = k.handle;

-- Read by every pen that read the table (002 granted SELECT on all tables to
-- these four); written by none — a view over the registry has the registry's writer.
GRANT SELECT ON identities TO office_api, clearing_job, law_ingester, snapshot_reader;

UPDATE registry
   SET kind = 'derived', owner_pen = 'office_api',
       ruling = ruling || ' + 055 (POS-350, Darko 10-05): a VIEW over households + household_pins; the registry''s writer is its writer, and law_ingester no longer writes it'
 WHERE object = 'identities' AND kind <> 'derived';

COMMIT;
