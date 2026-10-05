-- 065 — the mint's two other inputs, read from git into the store (POS-341, Q2/Q3)
--
-- RULED (Darko, 2026-10-04, POS-341): the stamp mint decides from the store.
-- Its inputs are the ledger (064, stamp_lines), the household key base and the
-- deliveries. These two tables carry the last two, written by the town-index
-- ingest (the `law_ingester` pen) beside 033's tables, so the mint reads what
-- the store read from git: git can be written to, the store reads git.
--
-- ── town_rooms: every WHITE_PAGES room, and the login its ADDRESS names ─────
--
-- The mint's key base (stamp-mint.mjs § householdKeys) is the pins, then each
-- room's ADDRESS `github:` login, then `solo:<room>`. 033's town_residents
-- keeps only rooms that are admissible handles (src/town-index.mjs § residentRows)
-- and its card is readTown's frontmatter parse, so neither is the mint's
-- reading. This table keeps EVERY room the mint walks (every directory but
-- TEMPLATE and `_` shelves) and the login exactly as the mint reads it: the first
-- `github:` line of ADDRESS.md, lowercased (src/mint-inputs.mjs § roomRows).
--
-- ── town_mail_lines: the mail ledger's lines, raw ────────────────────────────
--
-- 033's town_ledger is readTown's parse, which drops the `pays:` segment the
-- mint's settlements need (5 of 12,004 deliveries on 2026-10-04). This table
-- keeps each `- ` line of WHITE_PAGES/mail-ledger.md as written, so the mint
-- parses them with its own parseDeliveries. Append-only like town_ledger: the
-- ingest appends past the held count and REFUSES a changed prefix.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `law_ingester`, INSERT and DELETE and no UPDATE, like every projection here.
-- `office_api` reads (the mint runner and the parity instrument run as it).
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/065_town_mint_inputs.sql
--
-- The next town-index ingest fills both: a delta that finds them empty fills
-- them whole (src/mint-inputs.mjs § writeMintInputs).
--
-- CONSUMERS, named: world2/tools/town-index-ingest.mjs (the writer),
-- world2/tools/stamp-mint-run.mjs and world2/tools/stamp-mint-parity.mjs.

BEGIN;

CREATE TABLE IF NOT EXISTS town_rooms (
  handle text PRIMARY KEY,
  github text,
  digest text NOT NULL
);
CREATE TABLE IF NOT EXISTS town_mail_lines (
  seq    integer PRIMARY KEY CHECK (seq >= 1),
  line   text NOT NULL,
  digest text NOT NULL
);

GRANT SELECT ON town_rooms, town_mail_lines TO office_api, law_ingester;
GRANT INSERT, DELETE ON town_rooms, town_mail_lines TO law_ingester;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('town_rooms', 'projection', 'law_ingester', '{office_api}',
   'Darko 2026-10-04 (POS-341 Q3): the mint''s key base reads every WHITE_PAGES room and its ADDRESS login from the store, as the mint reads them'),
  ('town_mail_lines', 'projection', 'law_ingester', '{office_api}',
   'Darko 2026-10-04 (POS-341): the mint''s deliveries read from the store, the mail ledger''s lines raw so the town''s own parser reads them')
ON CONFLICT (object) DO NOTHING;

COMMIT;
