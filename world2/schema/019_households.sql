-- 019 — households + household_pins + registry_meta:
-- THE HOUSEHOLD REGISTRY BECOMES STORE-OF-RECORD (postmark POS-187, w40)
--
-- RULED (Keemin, 2026-09-22): "store build first with 155", coupled, both in
-- w40. The town's registry is two JSON files in the town repo —
-- `tools/households.json` (118 houses) and `tools/github-ids.json` (190 pins).
-- This migration gives them a table each, so the FILES become a rendering of
-- the store rather than the store's only copy.
--
-- ── MEASURED BEFORE THIS WAS WRITTEN (2026-09-22, town origin/main df732534a) ─
--
-- `tools/households.json` is `{ schema_version, note, households }`:
--   schema_version  1 (number)
--   note            one 1.6 KB prose paragraph — the registry's own doctrine.
--                   The town's witness rule 2b requires it UNTOUCHED by a
--                   resident's PR (tools/witness.mjs:27-34), so a drain that
--                   re-rendered it differently would turn every lane red. It is
--                   file-level metadata, not a household, and it lives in
--                   `registry_meta` below for exactly that reason.
--   households      118 entries, an OBJECT keyed by slug, in DECLARATION order
--                   — not sorted (measured: `Object.keys(...)` is not equal to
--                   its own `.sort()`, and `since` is not monotonic either; 36
--                   entries go backwards in date). That order is a fact of the
--                   file and nothing derives it, so it is a COLUMN (`ord`).
--
-- Per household, every field the 118 rows carry, with its live count:
--   name         113/118  text     the nameplate. ABSENT on 5 (a house of one
--                                   minted with no stated name reads
--                                   "(unstated — ask them)" at the card;
--                                   src/residency.mjs § A HOUSE OF ONE). The
--                                   absence is meaningful, so the column is
--                                   NULLable and NULL renders as an omitted key.
--   human          7/118  text     the human's own name, when stated.
--   accounts     118/118  jsonb    [{ login, id }] — 121 accounts over 118
--                                   houses. Exactly two keys, always both
--                                   (measured: login 121, id 121). Kept as
--                                   jsonb in the FILE'S OWN SPELLING because
--                                   `accountMatches` reads `a.id`/`a.login`
--                                   positionally-by-name and the ORDER of the
--                                   array is part of the file's bytes.
--   residents    118/118  text[]   handles, in the file's own order.
--   since        118/118  text     a town DATE STRING ("2026-08-07"), kept as
--                                   text, NOT a date: the file's bytes are the
--                                   law here, and a timestamptz round-trip
--                                   through a timezone is how "2026-08-07"
--                                   becomes "2026-08-06" on one box and not
--                                   another. There is no clock in this column.
--   member_of     21/118  text     a sub-house's parent slug (all 21 point at
--                                   `the-harbor`). NOT a foreign key: the file
--                                   has no such constraint, and a FK would let
--                                   the store refuse a row the file holds.
--   declared_by  118/118  text     the provenance sentence.
--
-- THE BRIEF NAMED `formerly text[]` AND `provisional boolean`. NEITHER EXISTS
-- IN THE FILE — measured, 0/118 each. They are not columns here: an empty
-- column the drain must never render is a field that will one day be written
-- and silently dropped. `provisional` is a word the ECONOMY uses
-- (stamp-mint `currentHouseholds()` returns `{ key, provisional }`), derived
-- from the ledger, not declared in this file. When a rename ceremony needs
-- `formerly`, it arrives with its renderer in the same commit.
--
-- NO SLUG ALPHABET CHECK. Two live slugs are path-hostile —
-- `victor-b.-rose-e.` and `cadaeic.space` — and both are grandfathered by the
-- seed. The alphabet is enforced at the MINT (POS-158), where a new slug is
-- chosen, not here, where history is stored. A CHECK here would make the seed
-- of today's own town refuse.
--
-- `tools/github-ids.json` is a FLAT OBJECT keyed by handle, 190 entries,
-- SORTED by handle (measured; `residency.mjs:148 serializePins` sorts, and the
-- file agrees). Per pin, every key seen live:
--   login      190/190  text
--   id         190/190  bigint  GitHub's numeric id — it exceeds 2^31 already
--                                (332132909 fits, but the space does not; the
--                                column is bigint so the town never meets that
--                                wall at a door).
--   pinned     178/190  text    town date string; 12 legacy pins carry none.
--   renamed      2/190  text    free prose ("2026-07-31 (github login rename;
--                                id unchanged)").
--   note         5/190  text
--   retired      2/190  text
--   renamed_to   2/190  text
-- Each is NULLable and a NULL renders as an omitted key. The KEY ORDER within
-- a pin is a fixed template — login, id, pinned, renamed, note, retired,
-- renamed_to — and all 7 distinct live orderings are subsequences of it
-- (measured: 0 mismatches over 190). The same holds for households: name,
-- human, accounts, residents, since, member_of, declared_by, 0 mismatches over
-- 118. That is what makes a byte-exact render possible at all.
--
-- ── THE ROUND-TRIP LAW ───────────────────────────────────────────────────────
--
-- Both files are EXACTLY `JSON.stringify(obj, null, 2) + "\n"` (proven: the
-- re-stringify of each parsed file is byte-equal to the file). So byte-equality
-- reduces to producing the same object with the same key insertion order, and
-- `tools/registry-drain.mjs --check` is the gate:
--
--     renderRegistry(rowsFromRegistry(file)) === the file, both files, byte for byte
--
-- It exits 0 or it exits 1 naming the first differing line. Nothing flips onto
-- this store until it exits 0 against the live clone.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `office_api` — the role the office API already connects as
-- (`src/world2-acts.mjs:28`, `postgres://office_api:<pw>@localhost:5432/
-- world2_dev`, reached through the one pool behind `actsQuery`). It is the only
-- one of the three pens that stands at the door where a household is declared:
-- `clearing_job` runs at a window's close and `law_ingester` runs the ingest.
-- SELECT + INSERT + UPDATE: a household's row is EDITED in place (a house gains
-- a resident, states its name, appends an account), which is what makes this a
-- SOURCE and not a projection. No DELETE to any pen: a house is not deleted —
-- the file has never removed a row, and witness rule 2b refuses a PR that
-- removes one ("nothing removed", tools/witness.mjs:31). A row that must go is
-- a finding for a person and the owner's hand.
--
-- 003_falsifier_roles.sql's lawful list carries the matching rows in this same
-- commit, so the three-pens falsifier stays green on these grants. (That
-- falsifier is RED on prod today for 014's `escrow_projection` grants, which
-- 014 never added to the list — a pre-existing red, named, not touched here.)
--
-- ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
--
-- NOT `identities`. That table (190 rows, keyed by HANDLE, `household` spelled
-- `gh:<id>`/`hh:<slug>`, every row `data.source = "WORLD/households.json"`) is a
-- PROJECTION of the world's copy, rewritten whole by
-- `world2/tools/law-ingest.mjs:465-476` under `law_ingester`. It points the
-- other way and it is untouched by this lane.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
-- Secret-free: nothing sourced, no URL and no password anywhere on the line.
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/019_households.sql
--
-- Applied as `postgres` instead, the tables' owner diverges and nothing fails
-- (014's lesson; the divergence is silent and permanent).
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ──────
--
--   SELECT tableowner FROM pg_tables
--    WHERE tablename IN ('households','household_pins','registry_meta');  -- world2_owner ×3
--   SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name IN ('households','household_pins','registry_meta') ORDER BY 1,2,3;
--   SELECT * FROM registry WHERE object LIKE 'household%' OR object = 'registry_meta';
--   psql -f world2/schema/003_falsifier_roles.sql   -- no households/household_pins row
--
-- CONSUMERS, named: `tools/registry-seed.mjs` (the one-time fill),
-- `tools/registry-drain.mjs` (table -> the two files, through the town pen),
-- `src/registry-store.mjs` (the registry object, read from here).

BEGIN;

-- ── the houses ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS households (
  slug        text PRIMARY KEY,                    -- the file's own key; no alphabet CHECK (see header)
  ord         integer NOT NULL,                    -- the file's declaration order; nothing derives it
  name        text,                                -- 113/118; NULL renders as an omitted key
  human       text,                                --   7/118
  accounts    jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{ login, id }], the file's own spelling AND order
  residents   text[] NOT NULL DEFAULT '{}',        -- handles, the file's own order
  since       text NOT NULL,                       -- a town DATE STRING, deliberately not a date (see header)
  member_of   text,                                --  21/118, all `the-harbor`; deliberately not a FK
  declared_by text NOT NULL,
  CONSTRAINT households_accounts_is_array CHECK (jsonb_typeof(accounts) = 'array')
);

-- The render's ORDER BY. Unique so two rows can never claim one place and
-- leave the drain's output depending on the planner.
CREATE UNIQUE INDEX IF NOT EXISTS households_ord_key ON households (ord);

-- ── the pins ────────────────────────────────────────────────────────────────
-- No `ord`: the file is SORTED by handle (measured) and `serializeRegistry`'s
-- sibling `serializePins` sorts on every write, so the order is derived and a
-- column for it would be a second answer.
CREATE TABLE IF NOT EXISTS household_pins (
  handle     text PRIMARY KEY,
  login      text NOT NULL,
  gh_id      bigint NOT NULL,   -- rendered as `id`; bigint because GitHub's id space is not 2^31
  pinned     text,              -- 178/190, a town date string
  renamed    text,              --   2/190, free prose
  note       text,              --   5/190
  retired    text,              --   2/190
  renamed_to text               --   2/190
);

-- ── the file's own metadata ─────────────────────────────────────────────────
-- `schema_version` and `note` are properties of the FILE, not of any house, and
-- witness rule 2b requires both untouched by a resident's PR. Holding them here
-- rather than as constants in the renderer is what makes the store the record
-- for the WHOLE file: an amended note is a row, not a code change.
CREATE TABLE IF NOT EXISTS registry_meta (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

GRANT SELECT ON households, household_pins, registry_meta
  TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT, UPDATE ON households, household_pins, registry_meta TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('households', 'source', 'office_api', '{clearing_job,law_ingester,snapshot_reader}',
   'Keemin 2026-09-22 (POS-187): the household registry is store-of-record — tools/households.json becomes a rendering of this table, gated on byte-equality (tools/registry-drain.mjs --check)'),
  ('household_pins', 'source', 'office_api', '{clearing_job,law_ingester,snapshot_reader}',
   'Keemin 2026-09-22 (POS-187): the same ruling''s other half — tools/github-ids.json, 190 pins, keyed by handle'),
  ('registry_meta', 'source', 'office_api', '{clearing_job,law_ingester,snapshot_reader}',
   'POS-187: schema_version and the registry note are file-level facts witness rule 2b requires untouched (town tools/witness.mjs:31), so the store holds them rather than the renderer')
ON CONFLICT (object) DO NOTHING;

COMMIT;
