-- rehearsal-falsifier-212.sql — WINDOW 212's REFUSAL, PUT BACK ON A COPY (POS-242 part 4).
--
-- A runner that cannot fail proves nothing. This puts the one store state that
-- made a real clearing refuse back onto a REHEARSAL COPY, so the runner's receipt
-- can be read against a refusal we already know the words of.
--
-- THE INSTANCE (docs/2026-09-26/design-notes/pos-241-one-id-for-life.md). At
-- 06:00Z 2026-09-26 window 212 held claim ddf6fe23 re-leaving
-- `mari/first-night-garland`, a slug still carried by the RETIRED row d09fb94d
-- (locked 209, retired since). Step 1 of the clearing asks only about STANDING
-- rows with the slug, so the claim was not refused as a duplicate; step 6's
-- materialization INSERTed a new row with that slug, and `marks.slug` is UNIQUE
-- across every status (001: `slug text NOT NULL UNIQUE`) — `marks_slug_key` —
-- so the whole clearing rolled back. The hand fix renamed the retired row to
-- `mari/first-night-garland~retired@211`, and 212 cleared at 12:43Z.
--
-- ON THE COPY, three writes restore that shape against the copy's open window:
--   1. the garland that 212 locked after the hand fix steps aside — at 06:00Z it
--      did not exist (its slug moves to `…~rehearsal-aside`, its id is kept:
--      012's trigger forbids an id change and nothing here needs one);
--   2. the retired row is given back its old slug;
--   3. a pending claim under that slug — ddf6fe23's own class, claimant,
--      household, geometry, bbox, stake and data — joins the open window.
-- The runner is then expected to report `clearing-did-not-run` / `marks_slug_key`.
--
-- It refuses to run anywhere whose name does not say `rehearsal`, and it checks
-- each write touched exactly one row, so a copy that has drifted from the
-- instance fails loudly here rather than proving nothing downstream.
--
--   psql -X -v ON_ERROR_STOP=1 -f world2/tools/rehearsal-falsifier-212.sql   (as rehearsal_runner, on the copy)

BEGIN;

DO $$
DECLARE n int; w int;
BEGIN
  IF current_database() NOT LIKE '%rehearsal%' OR current_database() LIKE '%world2_dev%' THEN
    RAISE EXCEPTION 'refused: % is not a rehearsal copy — this file writes marks and claims', current_database();
  END IF;

  UPDATE marks SET slug = 'mari/first-night-garland~rehearsal-aside'
   WHERE id = 'ddf6fe23-55fb-4c97-9c3e-4656ed9a495d' AND slug = 'mari/first-night-garland' AND status = 'standing';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'falsifier 212: the standing garland ddf6fe23 is not where the instance left it (% rows)', n; END IF;

  UPDATE marks SET slug = 'mari/first-night-garland'
   WHERE id = 'd09fb94d-035f-4ef9-9204-368bc0c1c96c' AND slug = 'mari/first-night-garland~retired@211' AND status = 'retired';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'falsifier 212: the retired garland d09fb94d is not where the hand fix left it (% rows)', n; END IF;

  SELECT id INTO w FROM windows WHERE status = 'open' ORDER BY id LIMIT 1;
  IF w IS NULL THEN RAISE EXCEPTION 'falsifier 212: no open window on the copy'; END IF;

  INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, parent, slug)
  SELECT w, class, claimant, household, 'pending', body, geometry, bbox, stake, data, parent, slug
    FROM claims WHERE id = 'ddf6fe23-55fb-4c97-9c3e-4656ed9a495d';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'falsifier 212: claim ddf6fe23 is missing (% rows)', n; END IF;

  RAISE NOTICE 'falsifier 212 armed: window % holds a pending mari/first-night-garland; the retired row d09fb94d carries the slug', w;
END $$;

COMMIT;
