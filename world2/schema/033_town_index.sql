-- 033 — the town index: office.db's tables in the store (POS-268)
--
-- office.db is the office's read index of the TOWN repo (src/hydrate.mjs,
-- rebuilt by the rehydrate unit every fifteen minutes). This file gives each of
-- its 21 tables a twin here, with the same columns under a `town_` prefix, so
-- its readers can move to the store one door at a time and office.db can then
-- be retired. The shape, the law it follows and what it measured are in
-- docs/town-index-store.md (for Keemin's read before this merges).
--
-- ── ONE DERIVATION, TWO WRITERS ──────────────────────────────────────────────
--
-- Every row comes from `deriveTownIndex` (src/town-index.mjs), which hydrate.mjs
-- also writes from. The writer here is `world2/tools/town-index-ingest.mjs`.
--
-- ── THE LAW (Keemin 2026-09-27, POS-277): A SNAPSHOT PER CLEARING, THE DELTA LIVE ─
--
-- The town's clearing is the CROSSING: the Postmark Pen's `seal: re-seal at the
-- crossing` commit closes it at 00:0x and 12:0x UTC. The town has no tag;
-- `settlements` holds the WORLD's. The ingest seeds these tables once, from a
-- whole derivation. After that it applies only the commits since its head
-- (`projection_heads['town-index']`), stops at each seal it passes to record a
-- snapshot in `town_index_snapshots`, and writes only the rows whose content
-- changed. A reader always reads one table. A restart reads these tables, never
-- the history.
--
-- ── JSON IS KEPT AS TEXT ─────────────────────────────────────────────────────
--
-- `jsonb` reorders an object's keys (by length, then bytewise), and the doors
-- serialise these objects whole. As text, a door's answer from here is
-- byte-equal to its answer from office.db, which is the gate every moved reader
-- is held to. Nothing here queries inside the JSON; the readers did not either.
--
-- ── THE DIGEST COLUMN ────────────────────────────────────────────────────────
--
-- Every twin but town_repo_log carries one column office.db does not: `digest`,
-- the md5 of the row's other columns as the ingest wrote them. It is how a
-- delta writes only what changed: the ingest reads (key, digest), never the
-- rows, and replaces a row only when its digest moved. Readers never select it.
-- town_repo_log is append-only and needs none.
--
-- ── ORDER ────────────────────────────────────────────────────────────────────
--
-- sqlite sorts text bytewise and Postgres' default collation does not, so a
-- reader ported here orders with `COLLATE "C"`. That is the reader's clause, not
-- a column property, and it is not set here.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `law_ingester`, the repo-to-store projection pen, which already reads the
-- town for `stamp_projection` and `town_roll`. It gets INSERT and DELETE and no
-- UPDATE, like every projection in this store: a changed row is replaced, never
-- edited. Every row here can be rebuilt from the town repo by the seed. The
-- matching rows are on 003's lawful list in this same commit. `office_api`
-- reads (read workers connect as it too). PROPOSED FOR A RULING: `office_api`
-- as the pen instead, since the keep tick already writes `settlements` as it.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/033_town_index.sql
--
-- A second run is a no-op: `IF NOT EXISTS` everywhere, `ON CONFLICT DO NOTHING`
-- on the registry rows, and GRANT is idempotent.
--
-- ── HOW TO PROVE IT LANDED ───────────────────────────────────────────────────
--
--   SELECT count(*) FROM pg_tables WHERE tablename LIKE 'town\_%' AND tableowner = 'world2_owner';
--     -- 23: the 21 twins, town_index_snapshots, and 010's town_roll
--   psql -f world2/schema/003_falsifier_roles.sql   -- no town_* row
--
-- CONSUMERS, named: world2/tools/town-index-ingest.mjs (the writer),
-- src/town-index-store.mjs (the readers that have moved), and
-- test/town-index-ingest.test.mjs, which holds both to office.db.

BEGIN;

CREATE TABLE IF NOT EXISTS town_meta (key text PRIMARY KEY, value text, digest text NOT NULL);
CREATE TABLE IF NOT EXISTS town_residents (handle text PRIMARY KEY, json text NOT NULL, digest text NOT NULL);
CREATE TABLE IF NOT EXISTS town_letters (
  id text PRIMARY KEY, from_h text, to_h text, date text,
  thread text, box text, owner text, path text, json text NOT NULL,
  delivered_at text,
  digest text NOT NULL
);
CREATE INDEX IF NOT EXISTS town_letters_to ON town_letters (to_h, date);
CREATE INDEX IF NOT EXISTS town_letters_from ON town_letters (from_h, date);
CREATE INDEX IF NOT EXISTS town_letters_path ON town_letters (path);
CREATE TABLE IF NOT EXISTS town_threads (root text PRIMARY KEY, json text NOT NULL, digest text NOT NULL);
CREATE TABLE IF NOT EXISTS town_bulletin (slug text PRIMARY KEY, json text NOT NULL, digest text NOT NULL);
-- The mail ledger, one row per line in ledger order. Append-only by town law:
-- the ingest appends past the stored count and REFUSES a changed prefix.
CREATE TABLE IF NOT EXISTS town_ledger (
  seq integer PRIMARY KEY, kind text, date text, id text, from_h text, to_h text, json text NOT NULL,
  digest text NOT NULL
);
CREATE TABLE IF NOT EXISTS town_stamps (handle text PRIMARY KEY, balance integer, mint_count integer, staked integer, digest text NOT NULL);
CREATE TABLE IF NOT EXISTS town_mail_state (handle text PRIMARY KEY, json text NOT NULL, digest text NOT NULL);
CREATE TABLE IF NOT EXISTS town_quest_progress (
  handle text PRIMARY KEY, send integer, receive integer, house_size integer,
  house_send integer, house_receive integer, sent_to text, heard_from text,
  digest text NOT NULL
);
CREATE TABLE IF NOT EXISTS town_quest_standing (handle text PRIMARY KEY, json text NOT NULL, digest text NOT NULL);
-- One row per commit x file, append-only: a delta appends `git log head..sha`.
CREATE TABLE IF NOT EXISTS town_repo_log (
  sha text NOT NULL, committed_at text, author text, subject text, op text, path text
);
CREATE INDEX IF NOT EXISTS town_repo_log_sha ON town_repo_log (sha);
CREATE INDEX IF NOT EXISTS town_repo_log_path ON town_repo_log (path);
CREATE INDEX IF NOT EXISTS town_repo_log_time ON town_repo_log (committed_at);
CREATE TABLE IF NOT EXISTS town_regions (id text PRIMARY KEY, name text, json text NOT NULL, digest text NOT NULL);
CREATE TABLE IF NOT EXISTS town_homes (handle text PRIMARY KEY, region text, json text NOT NULL, digest text NOT NULL);
CREATE TABLE IF NOT EXISTS town_pots (id text PRIMARY KEY, json text NOT NULL, digest text NOT NULL);
CREATE TABLE IF NOT EXISTS town_funding_roll (seq integer PRIMARY KEY, patron text, pot text, usd double precision, date text, receipt text, holo integer, digest text NOT NULL);
CREATE INDEX IF NOT EXISTS town_funding_roll_patron ON town_funding_roll (patron);
CREATE INDEX IF NOT EXISTS town_funding_roll_pot ON town_funding_roll (pot);
CREATE TABLE IF NOT EXISTS town_funding_holo (seq integer PRIMARY KEY, party text, pot text, holo integer, epoch text, date text, receipt text, digest text NOT NULL);
CREATE INDEX IF NOT EXISTS town_funding_holo_party ON town_funding_holo (party);
CREATE TABLE IF NOT EXISTS town_funding_keeping_mint (seq integer PRIMARY KEY, party text, pot text, n integer, epoch text, date text, digest text NOT NULL);
CREATE INDEX IF NOT EXISTS town_funding_keeping_mint_party ON town_funding_keeping_mint (party);
CREATE TABLE IF NOT EXISTS town_pot_receipts (seq integer PRIMARY KEY, pot text, rail text, usd double precision, date text, receipt text, payer text, digest text NOT NULL);
CREATE INDEX IF NOT EXISTS town_pot_receipts_pot ON town_pot_receipts (pot);
CREATE TABLE IF NOT EXISTS town_pot_escrow (pot text PRIMARY KEY, staked integer, digest text NOT NULL);
CREATE TABLE IF NOT EXISTS town_pot_stakers (pot text, handle text, staked integer, digest text NOT NULL, PRIMARY KEY (pot, handle));
CREATE TABLE IF NOT EXISTS town_funding_invalid (seq integer PRIMARY KEY, row_kind text, line text, reason text, digest text NOT NULL);

-- One row per snapshot the ingest recorded: the seed, and every crossing's seal
-- it stopped at. `counts` and `digests` are per table (row count, and an md5 over
-- the table's rows in key order), so a later reseed or a falsifier can say
-- whether the store still equals what it snapshotted.
CREATE TABLE IF NOT EXISTS town_index_snapshots (
  sha         text PRIMARY KEY CHECK (sha ~ '^[0-9a-f]{40}$'),
  kind        text NOT NULL CHECK (kind IN ('seed', 'crossing')),
  crossed_at  timestamptz,              -- the seal commit's committer date; NULL for a seed
  ingested_at timestamptz NOT NULL DEFAULT now(),
  counts      jsonb NOT NULL,
  digests     jsonb NOT NULL
);

GRANT SELECT ON town_meta, town_residents, town_letters, town_threads, town_bulletin, town_ledger,
  town_stamps, town_mail_state, town_quest_progress, town_quest_standing, town_repo_log, town_regions,
  town_homes, town_pots, town_funding_roll, town_funding_holo, town_funding_keeping_mint,
  town_pot_receipts, town_pot_escrow, town_pot_stakers, town_funding_invalid, town_index_snapshots
  TO office_api, law_ingester;
GRANT INSERT, DELETE ON town_meta, town_residents, town_letters, town_threads, town_bulletin, town_ledger,
  town_stamps, town_mail_state, town_quest_progress, town_quest_standing, town_repo_log, town_regions,
  town_homes, town_pots, town_funding_roll, town_funding_holo, town_funding_keeping_mint,
  town_pot_receipts, town_pot_escrow, town_pot_stakers, town_funding_invalid
  TO law_ingester;
GRANT INSERT ON town_index_snapshots TO law_ingester;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling)
SELECT t, 'projection', 'law_ingester', '{office_api}',
       'POS-268 (Keemin 2026-09-27 "we need to retire sqlite"; POS-277 snapshot per clearing, delta live): office.db''s ' || t ||
       ', one derivation (src/town-index.mjs), seeded once, a snapshot at each crossing''s seal and the commits since as the delta'
  FROM unnest(ARRAY['town_meta','town_residents','town_letters','town_threads','town_bulletin','town_ledger',
    'town_stamps','town_mail_state','town_quest_progress','town_quest_standing','town_repo_log','town_regions',
    'town_homes','town_pots','town_funding_roll','town_funding_holo','town_funding_keeping_mint',
    'town_pot_receipts','town_pot_escrow','town_pot_stakers','town_funding_invalid','town_index_snapshots']) AS t
ON CONFLICT (object) DO NOTHING;

COMMIT;
