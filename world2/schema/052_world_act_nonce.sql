-- 052 — a world act's retry key is spent ONCE (POS-246, w41)
--
-- LAW-TIER, per 001's discipline note and anti-rebake rule 4 ("Schema DDL is
-- law-tier: it goes through REVIEW like a grant change, because it is one").
--
-- 027 gave `acts` its `nonce` column for the say (POS-265), and kept it NOT
-- UNIQUE on purpose: a say honours its key for one conversation lull, and the
-- same key from the same speaker after the lull is a new say. That ruling
-- stands, untouched — the say is outside this index by name.
--
-- Every other world act now takes a nonce at the world door (src/act-nonce.mjs,
-- the paper grammar of POS-70 §5 applied to world acts). The door stamps it on
-- the FIRST act row its call writes, spelled `<door action>:<nonce>`, so the
-- same word spent on a walk and then on a stake is two acts, and looks up a
-- spent one before it acts. The lookup and the door's in-flight map hold within
-- one office; this index is what holds BETWEEN two calls that race past both:
-- the second INSERT is refused (23505), its transaction rolls back, and the door
-- answers it with the first act's receipt.
--
-- `household` is COALESCEd because a NULL never equals a NULL: an act with no
-- household would otherwise be guarded by nothing. No row carries a non-say
-- nonce before this file (only the say writes one), so the index builds on
-- every store as it stands.
--
-- ⚑ IDEMPOTENT, because it is applied by hand (025's reason).

CREATE UNIQUE INDEX IF NOT EXISTS acts_world_nonce_once
  ON acts ((COALESCE(household, '')), actor, action, nonce)
  WHERE nonce IS NOT NULL AND action <> 'say';
