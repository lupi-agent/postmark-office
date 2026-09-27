-- 020 — households.formerly: THE ONE ALIAS MECHANISM (postmark POS-158, w40)
--
-- RULED (Keemin, 2026-09-22): the household key is the DECLARED SLUG, minted
-- once at the human's co-sign, on every path into town. `name` is the free
-- display field from then on and the slug is never derived from it again.
--
-- A slug never changes at a door. `formerly` is the one place an old key is
-- kept, and it is written only by a FOUNDER CEREMONY — no door writes it. It
-- exists now because the ceremony that mints a slug is the same commit that
-- must be able to say what that slug used to be:
--
--   · a never-declared house gets a PROVISIONAL slug from the backfill
--     (POS-159, not this lane) and chooses its real one once, at the join
--     ceremony — and the provisional one lands here rather than vanishing;
--   · a rename ceremony, when one is ruled, appends rather than rewrites.
--
-- 019's header refused this column, and the refusal was right at the time:
-- "an empty column the drain must never render is a field that will one day be
-- written and silently dropped. When a rename ceremony needs `formerly`, it
-- arrives with its renderer in the same commit." THIS IS THAT COMMIT. The
-- renderer arrives with it: `HOUSEHOLD_KEYS` in `src/registry-rows.mjs` gains
-- `formerly` in its template position, and `registryFromRows` emits the key
-- ONLY when the array is non-empty.
--
-- ── WHY AN EMPTY ARRAY RENDERS AS NO KEY AT ALL ─────────────────────────────
--
-- 0/118 live rows carry `formerly` and the drain's whole law is byte-equality
-- against today's file (`tools/registry-drain.mjs --check`). A column that
-- rendered `"formerly": []` on every house would rewrite all 118 rows on the
-- first crossing and turn every lane red. So the default is `'{}'` and the
-- renderer treats an empty array exactly as it treats a NULL `name`: an absent
-- key, not a present empty one. `registry-rows.mjs` already keeps that
-- distinction for every other nullable column; this column joins that rule
-- rather than inventing a second one.
--
-- NOT NULL with a default rather than NULLable, because "this house has no
-- former key" and "nobody has looked" are not two different facts here — a
-- house that has never been renamed has an empty history, and an empty history
-- is a fact. The renderer's `isEmpty` check is therefore about LENGTH, and a
-- NULL arriving from an older row is treated as empty by the same check.
--
-- ── NO DOOR WRITES IT ───────────────────────────────────────────────────────
--
-- `src/ceremony.mjs § mintHousehold` takes `formerly` and defaults it to `[]`;
-- every door calls the mint WITHOUT that argument, so the only way a value
-- reaches this column is a founder's hand calling the mint directly. That is
-- the mechanism, and it is deliberately not a verb: a slug that changed at a
-- door would invalidate every reference the town has ever made to that house.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's own idiom, AFTER 019 ─────────
--
-- Secret-free: nothing sourced, no URL and no password anywhere on the line.
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/020_households_formerly.sql
--
-- Applied as `postgres` instead, the column's owner diverges from the table's
-- and nothing fails (014's lesson; the divergence is silent and permanent).
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ─────
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'households' AND column_name = 'formerly';
--       -- formerly | ARRAY | NO | '{}'::text[]
--   SELECT count(*) FROM households WHERE cardinality(formerly) > 0;   -- 0 today
--   node tools/registry-drain.mjs --check                              -- still byte-equal
--
-- No new grants: `office_api` already holds INSERT/UPDATE on `households`
-- (019), and a column is not a separate grantable object. No pen gains DELETE,
-- here or anywhere — a house is not deleted.

BEGIN;

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS formerly text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN households.formerly IS
  'Keys this house used to be addressed by, oldest first. Written ONLY by a founder ceremony (src/ceremony.mjs § mintHousehold takes it; no door passes it). Rendered into tools/households.json only when non-empty, so today''s 118 rows stay byte-equal. POS-158, Keemin 2026-09-22.';

COMMIT;
