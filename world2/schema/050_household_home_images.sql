-- 050 — households.home_images: EACH RESIDENT'S HOME PICTURE, KEPT ON THE HOUSEHOLD'S ROW
-- (postmark POS-219 part one, w41)
--
-- THE RULINGS (Keemin):
--   2026-09-27  "the one home-picture field lives on the HOUSEHOLD RECORD (the
--               store-of-record unit since the household key); the house mark
--               points at it, never holds a copy."
--   2026-09-28  (22:3x EDT, on the lane's measurement below) "absolutely each
--               resident should be able to have their own house." So the
--               household record is WHERE the pictures are kept, and it keeps
--               one per resident's home, keyed by the resident's handle. There
--               is no household-level "face".
--
-- ── MEASURED BEFORE THIS WAS WRITTEN (2026-09-28 22:20 EDT, town main 2ebb25492,
--    world main 9b8ef03c) ─────────────────────────────────────────────────────
--
--   households in the registry                    132
--   residents with a picture under HOME/          114
--   households with >1 pictured resident           14  (starforge holds six:
--                                                  mari's Marigold House and
--                                                  rei's Lanternstep House among them)
--   households holding >1 parcel, each pictured     2  (fox-hearth: alden, corwin,
--                                                  ellery; shard-house: keith, kogane)
--
-- A scalar on this row would have painted one picture on all of those houses.
-- So the column is a MAP, handle → media URL.
--
-- ── THE SHAPE ───────────────────────────────────────────────────────────────
--
--   { "<handle>": "https://media.postmark.town/<household>/<sha>.<ext>", … }
--
-- · A key is a resident of THIS row (`residents`). The writer enforces that; the
--   store does not, because `residents` is a text[] on the same row and a CHECK
--   across it would refuse the ceremony that moves a resident between houses
--   before the writer has moved the picture with them.
-- · A value is a media-door URL (`src/media.mjs § isMediaUrl`), minted through
--   `uploadMedia` — the media door is the only mint. Never a repo path.
-- · One entry per resident. A new picture REPLACES the entry; the old object
--   stays on the media shelf and in the media ledger, which is its history.
--
-- NOT NULL DEFAULT '{}' rather than NULLable, for 020's reason: "this resident
-- has no picture" and "nobody has looked" are one fact.
--
-- ── WHY '{}' RENDERS AS NO KEY AT ALL ───────────────────────────────────────
--
-- 020 and 021's rule, in the same place. The drain's law is byte-equality
-- against the town's `tools/households.json` (`tools/registry-drain.mjs
-- --check`), and 132 rows rendering `"home_images": {}` would rewrite the whole
-- file on the first crossing. `registryFromRows` (`src/registry-rows.mjs`)
-- drops the key when the map is empty, and renders a non-empty one with its
-- handles SORTED, because Postgres `jsonb` hands object keys back ordered by
-- length and then bytes (the `accounts` lesson, registry-rows.mjs § THE THIRD
-- TEMPLATE) and a handle map has no fixed template to restore.
--
-- ── WHO WRITES IT ───────────────────────────────────────────────────────────
--
-- ONE writer, `src/home-picture.mjs § setHomePicture`, which every path calls:
--   · `PATCH /home/{h}/image` (the site's upload): mints the bytes through
--     `uploadMedia`, then writes the URL here. It no longer writes HOME/ (Wright,
--     2026-09-28: HOME/ keeps what is there as history).
--   · the MCP home act (`household { do: "home" }`), given a media URL.
--   · `tools/home-picture-carry.mjs`, once, at the ship: each resident's legacy
--     HOME/ lead picture, minted and written by the same function. `--dry-run`
--     first; Wright runs it.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's idiom, AFTER 019–024 ─────────
--
-- Secret-free: nothing sourced, no URL and no password anywhere on the line.
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/050_household_home_images.sql
--
-- Rehearsed on POS-242's copy before the ship. Never on a real store from a lane.
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ─────
--
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_name = 'households' AND column_name = 'home_images';
--       -- home_images | jsonb | NO | '{}'::jsonb
--   SELECT count(*) FROM households WHERE home_images <> '{}'::jsonb;   -- 0 before the carry
--   node tools/registry-drain.mjs --check                              -- still byte-equal
--
-- No new grants: `office_api` already holds UPDATE on `households` (019), and a
-- column is not a separate grantable object. No pen gains DELETE.

BEGIN;

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS home_images jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'households_home_images_is_object') THEN
    ALTER TABLE households
      ADD CONSTRAINT households_home_images_is_object CHECK (jsonb_typeof(home_images) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN households.home_images IS
  'Each resident''s home picture, handle -> media-door URL (https://media.postmark.town/...). One writer: src/home-picture.mjs setHomePicture. The house mark points at (household, handle) and never holds a copy. Rendered into tools/households.json only when non-empty, handles sorted. POS-219, Keemin 2026-09-27 + 2026-09-28.';

COMMIT;
