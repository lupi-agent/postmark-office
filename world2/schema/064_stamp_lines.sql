-- 064 — the stamp ledger's lines in the store (POS-341, Q1)
--
-- RULED (Darko, 2026-10-04, POS-341 Q1): the signed append-only chain lives in
-- the store. Each line of WHITE_PAGES/stamp-ledger.md is a row here, appended
-- by the pen IN THE SAME TRANSACTION as the act that writes it, and the town
-- repo's file becomes the chain's signed public export. The office's verifier
-- (world2/tools/stamp-lines.mjs --verify) holds the export to the store byte for
-- byte and checks the store's own seal chain and signatures; the town's
-- tools/stamp-verify.mjs keeps verifying the export it can see, in town CI.
--
-- ── ONE ROW PER LINE, IN LEDGER ORDER ───────────────────────────────────────
--
--   seq        the line's 1-based position among the ledger's entry lines (the
--              `- ` lines parseStampLedger returns)
--   canonical  the line without its ` · sig: ` tail, exactly as signed
--   sig        the base64url Ed25519 signature over `seal`
--   seal       sha256(previous seal + canonical) from the town's genesis
--              (stamp-mint.mjs § sealChain), kept so a continuation is checked
--              against one row, never a replay of the whole chain
--
-- Only lines whose signature verifies against tools/stamp-pubkey.pem are
-- written (src/stamp-lines.mjs § syncStampLinesVia): the store never holds a line
-- the verifier would call forged. A signature binds its seal and a seal binds
-- every line before it, so a new line is checked against the last row alone.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `office_api`, INSERT only. Every writer of the ledger is an office pen (the
-- stamp, gift, fund and world execs, the mint runner, the drain's registry
-- lines) or a box tool that runs as the office (the ferry chain, the keep tick).
-- No UPDATE and no DELETE: a signed line is never rewritten, by town law.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/064_stamp_lines.sql
--
-- ── HOW TO PROVE IT LANDED ───────────────────────────────────────────────────
--
--   SELECT count(*) FROM stamp_lines;   -- 0 until the first sync, then the ledger's entry count
--   node world2/tools/stamp-lines.mjs --verify   -- export = store, chain green
--
-- CONSUMERS, named: src/stamp-lines.mjs (the writer, the reader, the verifier),
-- world2/tools/stamp-mint-run.mjs (the mint decides from these rows) and
-- world2/tools/stamp-mint-parity.mjs.

BEGIN;

CREATE TABLE IF NOT EXISTS stamp_lines (
  seq        integer PRIMARY KEY CHECK (seq >= 1),
  canonical  text NOT NULL,
  sig        text NOT NULL,
  seal       text NOT NULL CHECK (seal ~ '^[0-9a-f]{64}$'),
  written_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON stamp_lines TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT ON stamp_lines TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('stamp_lines', 'source', 'office_api', '{clearing_job,law_ingester,snapshot_reader}',
   'Darko 2026-10-04 (POS-341 Q1): the stamp ledger''s signed chain lives in the store, appended by the pen in the same transaction as its act; the town file is its signed export, checked byte for byte')
ON CONFLICT (object) DO NOTHING;

COMMIT;
