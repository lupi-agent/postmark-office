// world2-claims.mjs — THE DOCKET PEN (office_api's claims writer, dev era).
//
// Phase 3b of the World 2.0 gold plan: the CANDLE lane made honest. When a
// journal row is a MARK-CLASS declaration (leave-mark / amend), this pen also
// inserts a PENDING claim into the public docket — "here is everything that
// locks at 17:45" (gold §1). clearing_job alone transitions it at the close;
// retraction stays free until then (claims_update_guard, 002_grants.sql).
//
// SHADOW-ERA SHIM like world2-acts.mjs, dying with the same lane it serves —
// the mark lane's row in `LANE_MIRROR` (world2-acts.mjs), per-lane since DEC-2
// was ruled 2026-08-29 rather than one date for the whole store: during
// the shadow era the sketchbook drain is still 1.0's truth; the docket is the
// lane being proven. Same serialized fire-and-forget queue, loud on failure.
//
// Geometry identity: bbox comes from seed-import's own boxOf (centre + extent),
// imported so the door and the seed CANNOT disagree about where a claim is.
// Slug identity is the 1.0 path identity: <by>/<slug>.
//
// Env: WORLD2_CANDLE=1 (+ the same WORLD2_PG_URL as the acts mirror).
//
// v0 scope, stated: leave-mark + amend submit; withdraw-as-retraction and
// supersedes-chain wiring are the next slice (the clearing already handles
// both when present).

import { boxOf } from "../world2/tools/seed-import.mjs";
import { houseOfVia, sessionKeysVia, sessionKeyString } from "./household-deriver.mjs";
// Phase 5.6's deferred act is released through world2-pen's insertAct, INSIDE
// the promotion's own transaction (imported lazily there — R1, 2026-08-29).

const state = { queue: Promise.resolve(), written: 0, failed: 0, submitted: 0, lastError: null, pool: null };

const MARK_CLASSES = new Set(["mark"]); // journal CLASS_MARK; stance/frame rows are LIVE, not candle

export function candleEnabled(env = process.env) {
  return env.WORLD2_CANDLE === "1" && env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL;
}

async function pool(env = process.env) {
  if (state.pool) return state.pool;
  const { default: pg } = await import("pg");
  state.pool = new pg.Pool({ connectionString: env.WORLD2_PG_URL, max: 2 });
  return state.pool;
}

/**
 * Test seam: hand the module a pool. Never used by the office.
 *
 * The same seam `world2-acts.mjs` has carried since the pen lane, and here for
 * the same reason: there is no lab store — the box's `world2_dev` IS prod — so
 * a falsifier that must prove the DOOR's wiring (which arguments reach the
 * query, not what Postgres does with them) has no other way in. A stub that
 * records its SQL and its parameters is exactly the right instrument for
 * "`claimRowsSince` was called with `slugs: []`", which is a fact about this
 * office and not about any database.
 *
 * Pass `null` to restore the real pool.
 */
export function __setPoolForTest(p) { state.pool = p; }

// ── the household KEY, not the handle (A/B finding AB-R.household) ───────────
//
// 001_tables.sql says what this column holds: "denormalized at submit from
// identities". This pen was writing the journal's own `household` field, which is
// a bare resident handle (`darko`) — so one column carried three spellings of one
// fact: `gh:<id>` from the seed, NULL where the seed found no roster line, and a
// bare handle from here.
//
// Wright's ruling, 2026-08-28: adopt 1.0's spelling. A roster owner keeps the
// household KEY; a non-roster owner is `solo:<handle>`, never NULL. That is the
// fold's `declared_household` rule verbatim — `households[handle] ?? solo:<handle>`
// (marks-fold.mjs § the household grain) — and `identities` is the projection of
// the very file the fold reads, so asking it here gives the register and the
// docket one answer.
//
// ONLY POSITIVE ANSWERS ARE CACHED, deliberately. A handle that has a household
// key does not lose it, so caching that is safe. A MISS is the registry-lag case
// the fold's own comment describes — "registry lag never blocks a new resident, it
// only leaves them ungrouped until the town knows them" — and it resolves the
// moment law_ingester projects the new roster line. Caching the miss would keep
// writing `solo:` for a resident the town had already learned, for as long as the
// office stayed up.
const householdKeys = new Map();

/**
 * THE ONE RESOLVER, called by BOTH halves of the private-draft lane.
 *
 * The write path resolves the household from the journal row's `household`
 * (which is the office key's household name); `/world2/my-drafts` resolves it
 * from the same key. If those two ever spelled the household differently, a
 * resident would save a draft and then be told they have none — the row policy
 * would be working perfectly and the answer would still be wrong. Routing both
 * through this function is what makes that unrepresentable, so do not inline
 * either half.
 *
 * ── "THE TWO NETS ARE ONE NET" — ASKED AND ANSWERED (2026-09-07) ───────────
 *
 * Lane A observed that the WHERE clause in `pgLiveMarks` and 007's row policy
 * both key off this function's output, so a wrong row in `identities` defeats
 * both at once and there is no independent check. That observation is true and
 * it is ACCEPTED DESIGN, not a defect to file — written down here rather than
 * opened as an issue, on the reviewer's reading, which is the better one:
 *
 *   the IDENTITY is one fact, and the two mechanisms enforce two different
 *   things over it. The WHERE clause bounds the result set; the row policy
 *   bounds what the credential may return AT ALL — and only the second survives
 *   a new reading surface written by somebody who did not know it was needed.
 *   That is exactly 007's own argument for the policy ("enforced structurally,
 *   not by vigilance"), and it is why the two are not redundant.
 *
 * A wrong row in `identities` does defeat both. It also defeats every other
 * notion of who you are in this town, which is what makes this function's
 * single-resolver discipline the right shape rather than a shared weakness:
 * one fact, one place to be wrong, one place to fix.
 */
export async function householdKeyForKey(p, key) {
  const named = String(key?.household ?? "").trim();
  const handles = [...(key?.handles ?? [])];
  return householdKeyFor(p, named || handles[0] || null);
}

/**
 * Run `fn` inside a transaction that has declared whose household is acting.
 *
 * `SET LOCAL` (here in its parameterized spelling, `set_config(..., true)`)
 * is scoped to the transaction and unset when it ends. THAT IS THE WHOLE POINT
 * AND IT IS ALSO THE TRAP: this runs on a POOL, so a setting that outlived its
 * transaction would still be set for whatever unrelated request borrowed the
 * connection next — one resident reading another household's drafts, with every
 * policy in 007 working exactly as written. Hence: a dedicated client, an
 * explicit BEGIN/COMMIT, rollback on the way out, and the connection released
 * in `finally`. Nothing in this file may reach `app.household` any other way.
 *
 * ── TWO SETTINGS NOW, AND THE SECOND IS THE HOUSE'S WHOLE HISTORY ───────────
 *
 * `app.household` is the ONE CURRENT spelling, unchanged: it is what the pen
 * writes on every new row and what `guard-reads.mjs § assertHouseholdDeclared`
 * names in its refusal.
 *
 * `app.household_keys` is the SPELLING SET — every name this house has ever
 * carried, comma-joined, the current one first — and it is what
 * `024_household_spellings.sql`'s four policies compare against. The store
 * never re-spells a row (three guards refuse it; see 022's retirement header),
 * so a house whose rows were written under `gh:<id>` reaches them by declaring
 * that spelling rather than by moving the rows to this one.
 *
 * RESOLVED ON THE POOL, BEFORE `connect()`. `sessionKeysVia` reads the registry
 * through the queryable it is handed, and running it on the dedicated client
 * after BEGIN would put the registry fold inside every household transaction in
 * the office. On the pool it is folded once per process (`houseRowsVia`'s
 * WeakMap) and the transaction opens holding an array.
 */
export async function withHousehold(p, household, fn) {
  const keys = await sessionKeysVia(p, household);
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.household', $1, true)", [household]);
    await client.query("SELECT set_config('app.household_keys', $1, true)",
      [sessionKeyString(keys) ?? ""]);
    // `fn(client, keys)` — the second argument is the SAME array the policy is
    // comparing against, handed over so a door's own WHERE clause is belt to
    // the policy's braces rather than a second, narrower notion of this house.
    const out = await fn(client, keys);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * ── THE DERIVER ANSWERS IT NOW (POS-160, the w40 ship) ──────────────────────
 *
 * This used to read `identities.household` — a projection of the WORLD repo's
 * copy of the town's pins, four hops from the fact, answering in whichever
 * spelling that copy happened to carry. So the store's rows recorded the same
 * house two ways depending on when the row was written: measured on the live
 * registry 2026-09-22, 173 of 190 handles wore `gh:<id>` and 17 wore
 * `hh:<slug>`, and two handles of ONE house could wear one of each.
 *
 * It now asks `household-deriver.mjs`, the office's one walk over the registry
 * that IS the record (`households` + `household_pins`, 019/020/021), and
 * answers `hh:<slug>` — the key the ship writes from its law date on.
 *
 * ── WHICH ROWS MOVE, AND WHICH DO NOT ───────────────────────────────────────
 *
 * Every NEW row this pen writes from the law date carries `hh:<slug>`. Rows
 * already in the store keep the spelling they were written with, and that is a
 * problem THIS FUNCTION CANNOT SOLVE, because 007's draft row policy was a
 * string equality (`household = current_setting('app.household', true)`): a
 * resident whose key re-spells stops seeing their own drafts.
 *
 * ── AND THE ROWS DO NOT MOVE. THE READ WIDENS. (RULING 4, PROVISIONAL) ──────
 *
 * `022_household_respell.sql` was going to re-spell them and is now RETIRED to
 * a header and `SELECT 1;`. The store refuses the rewrite by three separate
 * laws, each measured on the dev sandbox 2026-09-22: `acts_append_only`,
 * `claims_update_guard` (`NEW.household IS NOT DISTINCT FROM OLD.household` on
 * every lawful transition) and `marks_id_is_fixed`. A row's household spelling
 * is fixed for its life, which is what this module's own header has always said
 * about history.
 *
 * So a house declares EVERY SPELLING IT HAS EVER CARRIED and the policy
 * compares against the set: `household-deriver.mjs § houseKeysOf` builds it,
 * `§ sessionKeysFor` is what a session declares, `withHousehold` above puts it
 * on the connection as `app.household_keys`, and
 * `024_household_spellings.sql`'s four policies read it. There is no backfill
 * and no window to run one in — the INSTALL block is a policy migration that
 * changes no row.
 *
 * ── THE MEMO STILL ONLY REMEMBERS A YES ─────────────────────────────────────
 *
 * A `solo:` answer is NOT cached, exactly as before. It means "the registry has
 * never heard of this handle", which is a fact that changes the moment a join
 * lands — and a cached absence would keep a brand-new resident outside their
 * own house for the life of the process. A named house does not change under a
 * running request, so that one is remembered.
 */
export async function householdKeyFor(p, handle) {
  if (!handle) return null;
  const hit = householdKeys.get(handle);
  if (hit) return hit;
  const { slug } = await houseOfVia(p, handle);
  if (!slug) return `solo:${handle}`;
  const key = `hh:${slug}`;
  householdKeys.set(handle, key);
  return key;
}

/**
 * Called from appendJournal beside mirrorAct, with the same normalized row.
 *
 * -- THE STAKE IS THE BOUNDARY (Keemin's ruling, 2026-08-28) -----------------
 *
 * Submit is not a word. The town's own economy law already decided where the
 * private/public line falls -- "a commons mark PUBLISHES ONLY WITH ESCROW
 * BEHIND IT" (town#1990) -- so STAKING a mark IS submitting it, and this pen
 * reads the status straight off that law instead of off a flag:
 *
 *   leave-mark, unstaked            -> status 'draft'   (private compose space)
 *   leave-mark with stamps: n>0     -> status 'pending' (draft + stake, one act)
 *   a later world_stake on a draft  -> promoted to 'pending' (promoteDraftOnStake)
 *
 * `put_forward` is the DOOR's verdict, not the caller's word: the door owns the
 * ground check (commons needs >0; your own sovereign ground allows an explicit
 * 0) because the ground's lawful minimum is law, and law is readable
 * office-side and not from in here.
 *
 * THIS CHANGES WHAT THE DOCKET CONTAINS, deliberately and for every lane: an
 * unstaked commons mark never published in 1.0 either -- it sat invisible in a
 * household branch -- so a docket carrying it was 2.0 promising a hearing that
 * 1.0's economy would never have given it. Sibling lanes asserting on docket
 * counts (A/B parity, replay) will see the difference, and it is the fix rather
 * than drift.
 */
/** Whether this journal row is the candle's business at all. */
export function claimEligible(row, env = process.env) {
  return candleEnabled(env)
    && MARK_CLASSES.has(row.class)
    && ["leave-mark", "amend", "withdraw"].includes(row.action);
}

/** The household a claim row will be scoped to — resolved on the POOL, before
 *  any transaction opens, so `officeWrite` can declare it at BEGIN. */
export async function claimHouseholdFor(row, env = process.env) {
  const p = await pool(env);
  return householdKeyFor(p, row.household ?? row.actor);
}

/**
 * THE SPELLING SET THIS CONNECTION DECLARED — read back, never re-derived.
 *
 * `024_household_spellings.sql`'s four policies compare against
 * `app.household_keys`. A door's own WHERE clause must compare against THE SAME
 * ARRAY, so this asks the connection for the value the policy is reading rather
 * than resolving the house a second time: two resolvers is how the spellings
 * came apart in the first place (`world2-guards.mjs § scoped` says it in those
 * words), and here the two would be a draft the policy shows and the door hides.
 *
 * ── THE FALLBACK NARROWS, AND CANNOT WIDEN ──────────────────────────────────
 *
 * A client that does not answer `current_setting` — a scripted test client, or
 * a connection where nothing declared — falls back to `[household]`, which is
 * EXACTLY the single string these WHERE clauses compared before this ruling. So
 * the worst case of an unreadable session is yesterday's behaviour: a house
 * reaches only its current spelling. It can never reach a spelling that is not
 * its own, which is the only direction that would be a leak.
 */
export async function declaredKeys(client, household) {
  try {
    const { rows: [r] } = await client.query(
      "SELECT string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',') AS keys");
    if (Array.isArray(r?.keys) && r.keys.length) return r.keys;
  } catch { /* a client with no session settings — see § THE FALLBACK NARROWS */ }
  return household == null ? [] : [household];
}

/**
 * THE CANDLE HALF OF ONE ACT, ON ONE CLIENT — R1 of the pen-flip design
 * (2026-08-29): this used to be the body of a second queue on a second pool,
 * which is the two-pens disease reproduced inside Postgres (DESIGN §2 R1).
 * The caller (world2-pen's `shadowWrite`/`penWrite` via world-journal) holds
 * the transaction and has already declared `app.household`; every query here
 * rides that client, so the act and its claim commit or vanish TOGETHER.
 *
 * All the shadow-era semantics below are unchanged — only the plumbing moved.
 */
export async function claimTxFromJournal(client, row, seq, { household, actId = null, env = process.env } = {}) {
      const payload = row.payload == null ? {} : JSON.parse(row.payload);
      const { rows: [win] } = await client.query(
        "SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
      if (!win) throw new Error("no open window — the candle is dark; bootstrap the next window before the docket can take claims");

      // -- withdraw ---------------------------------------------------------
      //
      // TWO OUTCOMES, and which one happens is read off what the claim IS
      // rather than off a second verb. Withdrawing a PENDING claim is a
      // retraction: it has stood on the public docket, so the row stays and
      // says it ended. Withdrawing a DRAFT is a deletion, because nothing
      // outside the household ever saw it and nothing outside is owed an
      // account of its ending -- the one deletion this town performs, argued in
      // 007's header and enforced by claims_delete_own_draft + the delete guard.
      //
      // This is why the ruling needs no discard verb: withdraw already means
      // "let this go", and 1.0's own withdraw answer already branches the same
      // way ("the draft is gone — it never crossed, so there is nothing to
      // unpublish").
      if (row.action === "withdraw") {
        const slug = row.object; // the journal's object IS the <by>/<slug> id
        // `= ANY(keys)` — a draft composed under this house's OLD key is still
        // this house's draft, and a withdraw that missed it would fall through
        // to `retractPendingClaim`, find no pending row, and return rowCount 0
        // — which is a LAWFUL answer on this path, so the resident's draft
        // would simply not go away and nothing would say why.
        const dropped = await client.query(
          "DELETE FROM claims WHERE status = 'draft' AND slug = $1 AND claimant = $2 AND household = ANY($3)",
          [slug, row.actor, await declaredKeys(client, household)]);
        if (dropped.rowCount) { state.written += 1; return; }
        const rowCount = await retractPendingClaim(client,
          { windowId: win.id, slug, claimant: row.actor });
        // rowCount 0 is lawful: withdrawing a PUBLISHED 1.0 mark has no pending
        // claim to retract — that lane is the settlement unpublish, not the docket.
        if (rowCount) state.written += 1;
        return;
      }

      const kind = payload.kind ?? "sited";
      const placed = payload.at && payload.extent;
      const slug = `${payload.by ?? row.actor}/${payload.slug}`;
      const { slug: _s, at, extent, points, body, stamps, put_forward, ...rest } = payload;
      const geometry = placed ? { slug, at, extent, ...(points ? { points } : {}) } : { slug };
      const bbox = placed ? boxOf(at, extent) : null;
      const status = put_forward === true ? "pending" : "draft";

      // amend → the supersession chain: the clearing computes head-of-chain
      // (its transition 2), so the new claim names the pending one it amends.
      let supersedes = null;
      if (row.action === "amend") {
        const { rows: [prior] } = await client.query(
          `SELECT id FROM claims WHERE window_id = $1 AND status = 'pending'
           AND geometry->>'slug' = $2 AND claimant = $3 ORDER BY submitted_at DESC LIMIT 1`,
          [win.id, slug, row.actor]);
        // NO PENDING PRIOR IN THIS WINDOW → THE STANDING MARK IS WHAT IT AMENDS
        // (2026-09-14, #2806). This used to leave `supersedes` null with the note
        // "amending a published mark: no in-window chain, fresh claim", and the
        // clearing's step 1 read that null as a duplicate — "a standing mark
        // already carries this slug" — refusing every live amendment of a
        // published mark while 1.0 canon published it (keith/the-garage, journal
        // seq 1509, refused at the candle, published at the 09-11 05:45Z sweep).
        // 001_tables.sql says what was meant: "a slug amended at a later window
        // gets a new locked claim whose `supersedes` points back at this id" —
        // the same row the clearing reads (`FROM marks WHERE slug … standing`).
        // The replay path always set it; the live drain now does too.
        if (prior?.id) supersedes = prior.id;
        else {
          const { rows: [standing] } = await client.query(
            "SELECT id::text FROM marks WHERE slug = $1 AND status = 'standing' LIMIT 1", [slug]);
          supersedes = standing?.id ?? null; // a fresh slug amends nothing: null, as before
        }
      }

      // THE DEFERRED ACT rides on the draft it belongs to (world2-acts.mjs
      // § the deferral). A draft is not a public deed, so nothing was mirrored;
      // the row is carried here, in the claim's own `data`, and mirrored the
      // moment a stake makes it public. Carried in the DATABASE rather than in
      // process memory on purpose: a draft composed before a restart and staked
      // after it must still be able to become an act.
      // ── `_act_id` · THE IDENTITY `_journal_seq` NEVER WAS (2026-09-04) ────
      //
      // The closure falsifier pairs an act to its claim, and it paired on
      // `_journal_seq` — a column 001_tables.sql already warns about in its own
      // comment ("the journal truncates at each drain, so (journal_seq, at)
      // pairs a row only within its window") and which this store has now had
      // to un-learn three times. The mark lane's flip retires it outright: a
      // FLIPPED act carries `journal_seq` NULL by design, so a check pairing on
      // it would have gone red on every act the moment W2_PEN named this lane —
      // the lane's own GO criterion failing for a reason that has nothing to do
      // with the lane.
      //
      // `acts.id` is the identity that was always missing. It is the act's
      // primary key, it exists in both eras, and it is handed to this function
      // by whichever pen holds the transaction. `_journal_seq` stays beside it,
      // unused for pairing, because the shadow era's own tools still read it
      // and dropping a written field is a separate change from ceasing to
      // depend on it.
      //
      // NULL for a private draft, and lawfully so: a draft has no deed yet. The
      // act it is holding arrives at the stake, and `promoteDraftOnStake`
      // stamps this field in the same statement that releases it.
      const data = JSON.stringify({
        ...rest, _journal_seq: seq, ...(actId == null ? {} : { _act_id: String(actId) }),
        ...(status === "draft" ? { _deferred_act: { ...row, _seq: seq } } : {}),
      });

      // -- the stake crossing the boundary, in ONE act ------------------------
      //
      // If this act's author already holds a private draft of this slug, the act
      // does not create a second claim -- it rewrites the one they composed.
      // Composing again while unstaked keeps it a draft; composing WITH a stake
      // is the same motion as submitting, and the row goes pending.
      //
      // The row keeps its uuid either way, so a resident watching their draft's
      // id is looking at the same claim afterwards. window_id and submitted_at
      // move only when it goes pending: a draft rides no candle, and takes the
      // one burning at the moment it is put forward.
      // The rewritten `data` above simply does not carry `_deferred_act` when
      // the row goes pending, so the promotion DROPS it in the same statement.
      // Dropped rather than mirrored, and the difference matters: this act is
      // itself public (world-journal already mirrored it, because put_forward
      // made it so), and mirroring the earlier private compose as well would
      // put TWO acts behind one claim — which is exactly what the closure
      // falsifier exists to catch. The compose was superseded by this
      // declaration; only the declaration is a deed.
      const promoted = await client.query(
        `UPDATE claims SET status = $12, class = $2, body = $3, geometry = $4, bbox = $5,
                stake = $6, supersedes = $7, data = $8, slug = $9,
                window_id = CASE WHEN $12 = 'pending' THEN $1 ELSE window_id END,
                submitted_at = CASE WHEN $12 = 'pending' THEN now() ELSE submitted_at END
          WHERE status = 'draft' AND claimant = $10 AND slug = $9 AND household = ANY($11)
          RETURNING id`,
        // $11 is the SPELLING SET, not the one key — a draft composed under this
        // house's old key is the same draft, and this UPDATE is the SUBMIT. A
        // narrow filter here would show the author a draft through 024's policy
        // and then refuse to put it forward, with the fall-through below writing
        // a SECOND claim for the same slug instead.
        //
        // The row's own `household` is UNTOUCHED by this statement, which is not
        // an oversight: 007's `claims_update_guard` requires `NEW.household IS
        // NOT DISTINCT FROM OLD.household` on the draft -> pending transition,
        // so the submitted claim keeps the spelling it was composed under. That
        // is the whole of RULING 4 in one statement — the read widens, the row
        // never moves.
        [win.id, kind, body ?? null, JSON.stringify(geometry), bbox, stamps ?? 0,
         supersedes, data, slug, row.actor, await declaredKeys(client, household), status]);
      if (promoted.rowCount) {
        state.written += 1;
        if (status === "pending") state.submitted += 1;
        return;
      }

      // INSIDE the household transaction even for a plain pending insert, and
      // the policy is what taught this: `claims_insert`'s WITH CHECK refuses a
      // draft row whose household is not the one this transaction declared, so
      // an insert outside the declared transaction cannot plant a draft AT ALL.
      // It failed exactly that way on the first live run — which is 007
      // working, not 007 in the way: you may not create a private thing
      // without saying whose it is. Pending rows would pass either way; one
      // path is fewer.
      await client.query(
        `INSERT INTO claims (window_id, class, claimant, household, body, geometry, bbox, stake, supersedes, data, slug, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [win.id, kind, row.actor, household, body ?? null,
         JSON.stringify(geometry), bbox, stamps ?? 0, supersedes, data, slug, status]);
      state.written += 1;
}

// ── `submitClaimFromJournal` IS GONE (2026-09-04, the mark lane's flip) ──────
//
// It was the standalone shadow entry for a private draft: a claim with no acts
// row, on THIS module's own `state.queue` and its own pool. R1's header said
// the two-queue disease "ends here: both eras' Postgres writes route through
// `officeWrite`" — and it did not end for this one arm, because routing through
// the same FUNCTION is not the same as riding the same QUEUE. Two serialized
// queues with nothing between them are still two orderings.
//
// The cost was measured, not theorised: an unstaked compose and its own
// withdrawal rode different queues, so the withdrawal's DELETE ran 113 ms ahead
// of the INSERT it was meant to remove — five fresh stores, five times — and the
// resident's withdrawn draft kept its docket row with the slug still taken
// (jetto-b1-guards-report 2026-09-03 § Finding 1).
//
// The private arm now rides `shadowWrite(row, seq, { act: false, … })` in both
// eras (src/world-journal.mjs § THE PRIVATE ARM JOINS THE ONE QUEUE), which
// keeps the privacy law's shape — nothing about a private compose touches
// `acts` — while putting a compose and its withdrawal in one order.
//
// DELETED RATHER THAN LEFT UNCALLED, deliberately. A second queue standing
// beside a unified one, exported and callerless, is the next author's readiest
// mistake; this file's own history is the argument (one column, three
// spellings). `state.queue` survives it because `claimTxFromJournal` still
// counts through this module's `state`, so `docketStatus()`/`docketSettled()`
// keep answering about the docket exactly as before.

/**
 * A PENDING CLAIM, TAKEN BACK OFF THE DOCKET. One retraction, two callers.
 *
 * `pending -> retracted` is one of the four transitions `claims_update_guard`
 * permits an office pen (007_private_drafts.sql § the transition guard), and
 * gold §1's reason is in the guard's own comment: "retraction is free until
 * close". A retracted row STAYS — 007's delete guard forbids removing a row the
 * public docket has carried — so the crossing's own account keeps it, under
 * `sixCount.retracted_before_close` (clearing-job.mjs § 6).
 *
 * ── WHY THIS IS A FUNCTION AND NOT TWO STATEMENTS ──────────────────────────
 *
 * Its callers ask for the same thing from opposite ends. `claimTxFromJournal`
 * retracts because a resident withdrew a claim that had stood publicly; the
 * stake door (world-stake.mjs § A STAKE THAT HOLDS NOTHING IS NEVER FILED)
 * retracts a promotion it made moments earlier and is about to refuse. Two
 * statements would be two notions of what retraction writes, and the second one
 * written would be the one that forgot `decided_at` — which is the column the
 * candle's own tally reads nothing of but every receipt beside it does.
 *
 * KEYED ON (window, slug, claimant) rather than on the claim's id, because that
 * is the key the withdraw arm has in hand: it is holding a journal row, not a
 * row id. The stake door has both and passes these three.
 *
 * `q` is a CLIENT when the caller holds a transaction (the withdraw arm rides
 * the pen's own), and null when it does not (the stake door, which has already
 * committed its promotion). The row policy takes no household declaration for
 * this write — `claims_update_office` is `USING (status <> 'draft' OR …)` and a
 * pending row satisfies the first arm — so the pool is a lawful place to run it.
 */
export async function retractPendingClaim(q, { windowId, slug, claimant, env = process.env } = {}) {
  const client = q ?? await pool(env);
  const { rowCount } = await client.query(
    `UPDATE claims SET status = 'retracted', decided_at = now()
     WHERE window_id = $1 AND status = 'pending' AND geometry->>'slug' = $2 AND claimant = $3`,
    [windowId, slug, claimant]);
  return rowCount;
}

/**
 * A later `world_stake` on a draft: the boundary act, arriving on its own.
 *
 * The ruling's plainest case -- you composed something, slept on it, and now
 * you back it. Staking is submitting, so this is the whole of what the stake
 * door has to do about the docket.
 *
 * ONE STATEMENT DOES THE PROMOTION AND THE STRIP, and that shape was taught by
 * the transition guard rather than chosen: a second `UPDATE ... SET data = data
 * - '_deferred_act'` on the now-PENDING row is not one of the four transitions
 * 007 permits, so it raised — after the promotion had already committed and the
 * act had already been mirrored. The guard was right and the code was wrong.
 * Reading the held act BEFORE the update and stripping it IN the update leaves
 * nothing for a second write to do.
 *
 * THE MIRROR RUNS INSIDE THE TRANSACTION NOW (R1, ruled and rebuilt
 * 2026-08-29). The old shape — `mirrorAct` after the COMMIT, on its own pool
 * and queue — was correct for two independent pens and became the design's
 * named atomicity hole F3: a promotion that commits and then fails to mirror
 * leaves a PENDING CLAIM WITH NO DEED on the public docket. The old deadlock
 * argument dissolved with the plumbing: `insertAct` takes THIS transaction's
 * own client, so there is no second pool to wait on. The act and the
 * promotion now commit together or not at all.
 *
 * THE ACT IS DATED AT THE PUTTING-FORWARD, not at the composing. The world
 * witnessed a resident put this mark forward; it did not witness them thinking
 * about it. Back-dating would also aim the row at a window the notary may have
 * frozen already — an append-only archive refusing a late arrival, which is the
 * repo catching the office rewriting history, correctly, over something that
 * would have been our own doing.
 *
 * ── WHY THE ROW DOES NOT SAY WHAT IT HOLDS (ruled 2026-09-12) ─────────────
 *
 * `stake` is the number ASKED. It has to be: this statement runs BEFORE the
 * stamp ledger, by the order the stake door's own comment argues for. So a
 * claim whose escrow move applied less than it asked carries a `stake` figure
 * that reads exactly like a backed claim — which is #2686, nine hours of
 * `stake: 1` behind a mark holding zero.
 *
 * The obvious repair was a second number on this row. It is NOT taken, and the
 * reason is worth the paragraph. Writing what the ledger moved would need a
 * write AFTER the ledger, onto a row that has already gone pending, and
 * `claims_update_guard` permits an office pen four transitions of which
 * `pending -> pending` is not one. The guard stays as it is (Keemin, 09-12): no
 * fifth transition, no migration.
 *
 * So the docket DERIVES it instead. `escrow_projection` (014) already holds the
 * open position per (mark, holder) as-of a town sha, and the candle's own gate
 * already reads it — `escrowPresenceAt` in world2/tools/escrow-presence.mjs.
 * world2-serve.mjs § THE DOCKET ROW asks that same reader, so the docket and
 * the gate it forecasts cannot disagree, no claim is ever rewritten, and a later
 * unstake shows up on the next read rather than leaving a stale snapshot behind.
 *
 * Returns { promoted, claim, window }. `promoted: false` is the ordinary answer
 * for a stake on an already-public mark, and never an error. `window` is the
 * candle the claim joined, which is the key its retraction is written against.
 */
export async function promoteDraftOnStake({ actor, householdName, slug, stamps = 0 }, env = process.env) {
  if (!candleEnabled(env)) return { promoted: false, claim: null, window: null };
  const p = await pool(env);
  const household = await householdKeyFor(p, householdName ?? actor);
  const { rows: [win] } = await p.query(
    "SELECT id FROM windows WHERE status = 'open' ORDER BY id DESC LIMIT 1");
  if (!win) throw new Error("no open window — the candle is dark; the stake cannot put this mark forward");

  const out = await withHousehold(p, household, async (c, keys) => {
    // The spelling set, for `readDraftClaims`' reason: a stake on a draft the
    // house composed under its old key must find that draft, or the stake is
    // read as a stake on an already-public mark and the draft never goes
    // forward — `promoted: false`, which is a lawful answer on this path.
    const { rows: [draft] } = await c.query(
      `SELECT id, data->'_deferred_act' AS held FROM claims
        WHERE status = 'draft' AND claimant = $1 AND slug = $2 AND household = ANY($3)`,
      [actor, slug, keys]);
    if (!draft) return null;
    // The released deferred act, in the SAME transaction (F3 closed): dated at
    // the putting-forward exactly as before — the world witnessed the resident
    // put it forward, not think about it — and journal_seq carried from the
    // compose so the parity falsifier's released-late arm keeps its key.
    //
    // IT RUNS BEFORE THE PROMOTION NOW, and the reordering is the whole reason
    // it can be one statement. The claim must come out of this transaction
    // carrying `_act_id` (§ the identity `_journal_seq` never was), and the act
    // has no id until it is inserted — so a promotion that updated first would
    // need a SECOND write to stamp it. This file already paid for that once:
    // "a second `UPDATE ... SET data = data - '_deferred_act'` on the
    // now-PENDING row is not one of the four transitions 007 permits, so it
    // raised — after the promotion had already committed." Insert, then promote
    // and stamp in one statement, and there is nothing left for a second write
    // to do.
    // ── A DRAFT THAT OUTLIVED ITS WINDOW IS A LATE ARRIVAL, NOT A REFUSAL ──
    //
    // (postmark#2722, hotfix w38.) The act being released here carries the
    // crossing the draft was COMPOSED in, and a resident may sleep on a draft
    // for as long as they like. Once that window closes and is certified, the
    // pen's late-crossing guard refused the insert — correctly, on its own
    // terms — this whole transaction rolled back, and the stake door's catch
    // logged and let the LEDGER run anyway. The books said ✦1 staked and every
    // mark surface said a zero-backed draft. Sophia hit it twice at 18:24:29Z
    // and 18:25:24Z on 2026-09-12 (a draft from crossing 183 against open
    // window 185); Deva's 03:35Z 09-13 stake hit the same line at 184/186.
    //
    // The remedy is the one the guard's own message names: a late arrival files
    // into the window it ARRIVES in, keeping its original crossing on the
    // payload as `late_from_crossing`. Nothing is rewritten in certified
    // history, and the deed lands in the window the resident actually put the
    // mark forward in — which is the truthful place for it, because putting
    // forward is what this act IS.
    //
    // THE CLAIM ROW NEEDS NO SUCH REMEDY, and that is worth saying so nobody
    // adds one: 007's own `claims_update_guard` spells the SUBMIT transition
    // "draft -> pending ... window_id and submitted_at move with it: a draft
    // rides no candle, and it takes the one burning at the moment it is put
    // forward." The UPDATE below already moves the row into the open window in
    // place, keeping its uuid, which is exactly what that rule asks for. Only
    // the deed was ever stuck.
    let releasedActId = null;
    let lateFrom = null;
    if (draft.held) {
      const { insertAct, crossingIsLate, LATE_ARRIVAL_PUT_FORWARD } = await import("./world2-pen.mjs");
      const { _seq, ...actRow } = draft.held;
      // Asked BEFORE the insert and through the pen's own predicate, so what
      // the resident is told and what the pen did are one fact, not two.
      if (crossingIsLate(actRow.crossing)) lateFrom = Number(actRow.crossing);
      releasedActId = await insertAct(c, { ...actRow, written_at: new Date().toISOString() }, _seq ?? null,
        { lateArrival: LATE_ARRIVAL_PUT_FORWARD });
    }
    await c.query(
      `UPDATE claims SET status = 'pending', window_id = $1, submitted_at = now(),
              stake = GREATEST(stake, $2),
              data = (data - '_deferred_act')
                     || CASE WHEN $4::text IS NULL THEN '{}'::jsonb
                             ELSE jsonb_build_object('_act_id', $4::text) END
        WHERE id = $3`,
      [win.id, Number(stamps) || 0, draft.id, releasedActId == null ? null : String(releasedActId)]);
    return { ...draft, lateFrom };
  });
  if (!out) return { promoted: false, claim: null, window: win.id, late_from: null };
  state.submitted += 1;
  // `late_from` — the crossing the draft was composed in, present ONLY when the
  // pen restamped the released deed into this window. The door says it in
  // words; a null here means the ordinary same-window promotion.
  return { promoted: true, claim: out.id, window: win.id, late_from: out.lateFrom ?? null };
}

/**
 * Whether the store still stands this mark — the one question `world_stake`
 * cannot answer from the sketchbook.
 *
 * WHY IT EXISTS. `markExists` (world-stake.mjs § the door's own gate) accepts a
 * mark it finds in the CALLER'S OWN SKETCHBOOK, which is exactly where the
 * 2026-09-16 move puts a returned mark. So after the crossing the 404 gate waves
 * a retired mark through, and a stake of ✦1 or more would take the stamps into
 * escrow against something the town no longer sees.
 *
 * A slug can carry both a retired row and a standing one (a mark returned and
 * then re-claimed), and the STANDING row is the answer in that case — the mark
 * stands, whatever also happened to it once. Hence the ordering rather than a
 * LIMIT 1 over an arbitrary row.
 */
export async function markStandingStatus({ slug }, env = process.env) {
  if (!candleEnabled(env)) return { known: false };
  const p = await pool(env);
  // `docket_window` (postmark#3139): the OPEN window a pending claim on this
  // slug rides, or null. A mark put forward again sits pending there while its
  // `marks` row still says retired, and that pair means "put forward", not
  // "returned to your drafts". Asked in the SAME statement, so the stake door
  // gains no query. `claims_read` shows every non-draft row to any reader
  // (007/024), so the pool sees the public docket without a household.
  const { rows } = await p.query(
    `SELECT m.status, m.retired_window,
            (SELECT c.window_id FROM claims c JOIN windows w ON w.id = c.window_id
              WHERE c.slug = $1 AND c.status = 'pending' AND w.status = 'open'
              ORDER BY c.window_id DESC LIMIT 1) AS docket_window
       FROM marks m WHERE m.slug = $1
      ORDER BY (m.status = 'standing') DESC LIMIT 1`, [slug]);
  if (!rows.length) return { known: true, found: false };
  return { known: true, found: true, status: rows[0].status,
           retired: rows[0].status === "retired", retired_window: rows[0].retired_window,
           docket_window: rows[0].docket_window == null ? null : Number(rows[0].docket_window) };
}

/**
 * One household's own drafts — the whole of what `/world2/my-drafts` answers.
 *
 * `submitted_at` comes back as `composed_at`, and `window_id` does not come
 * back at all. Both are the same small honesty: a draft has not been submitted
 * and rides no candle, so a column named for the docket would be telling the
 * author something untrue about their own private thing. The row carries those
 * values because 001 declares them NOT NULL and a draft has to hold SOMETHING;
 * what it holds is not a fact about the draft, and the door does not present it
 * as one. Both become true, and are rewritten, when a stake puts it forward.
 *
 * `data` is deliberately not returned: it carries `_deferred_act`, which is
 * plumbing rather than anything the author wrote.
 */
export async function readDraftClaims(key, env = process.env) {
  const p = await pool(env);
  const household = await householdKeyForKey(p, key);
  // `= ANY(keys)` and not `= household`: the store never re-spells a row, so a
  // draft composed under this house's OLD key is still this house's draft and
  // the door must ask for it by every name the house has worn. The WHERE and
  // 024's policy now compare the SAME array — see `withHousehold`'s second
  // argument.
  const rows = await withHousehold(p, household, (c, keys) => c.query(
    `SELECT id, slug, class, claimant, body, geometry, stake, submitted_at AS composed_at
       FROM claims WHERE status = 'draft' AND household = ANY($1) ORDER BY slug`, [keys]));
  return { household, drafts: rows.rows };
}

export function docketStatus() {
  const { written, failed, submitted, lastError } = state;
  return { enabled: candleEnabled(), written, failed, submitted, lastError };
}

/**
 * Every docket write issued so far has landed — and it has to be true about the
 * queue those writes ACTUALLY RIDE, which is no longer this module's.
 *
 * ── THE LIVE DEFECT THAT TAUGHT THIS (2026-09-04 night, on the box) ─────────
 *
 * This returned `state.queue` alone. That was right while `submitClaimFromJournal`
 * owned a queue here; it stopped being right the moment the mark lane's
 * private-draft arm joined the pen's one queue (C6) and that function was
 * deleted. Nothing enqueues onto `state.queue` any more, so it resolves
 * instantly — and a caller that asked whether the docket was settled was told
 * yes before a single row had been written.
 *
 * `falsifier-guard-equality.mjs` is that caller, and it had written the reason
 * it waits directly above the wait: *"reading `claims` before it settles would
 * compare 1.0's finished journal against a docket still being written, and the
 * diff would be timing."* It then did exactly that — G1_a/G2_a/G4_a
 * `compared 0`, findings 4/4/5, every one of the form *"1.0's live layer holds
 * guards-alfa/the-quiet-shed and the port does not — a slug-collision guard
 * reading the port would PERMIT a duplicate."* Nothing was wrong with the port.
 *
 * FIXED HERE RATHER THAN AT THE CALL SITE, because the call site was not wrong:
 * it asked the honest question and got a false receipt. `settleShadowPens`
 * survived only by awaiting all three queues by hand, and nothing marked the
 * difference between the caller that happened to be safe and the one that was
 * not. A function named for the docket that knows only about a queue the docket
 * abandoned is the states-with-no-receipt class, wearing a receipt's coat.
 *
 * `state.queue` is still awaited beside the pen's. It is empty today, and
 * keeping it costs one already-resolved promise — where dropping it would mean
 * this answer silently stops covering anything that enqueues here again.
 */
export async function docketSettled() {
  const { penSettled } = await import("./world2-pen.mjs");
  await Promise.all([state.queue, penSettled()]);
}

/**
 * EVERY CLAIM THE STORE HOLDS FOR ONE SLUG, newest first — the receipt's half.
 *
 * The whole life of one mark on the docket: the draft it was composed as, the
 * pending row its stake put forward, and the candle's ruling. `mark-receipt.mjs`
 * reads the newest and reports the rest as history.
 *
 * ── WHY THIS IS NOT SCOPED TO ONE HOUSEHOLD, AND WHY THAT IS LAWFUL ────────
 *
 * The docket is PUBLIC — 007_private_drafts.sql's row policy says so in one
 * line, and says which row is the exception:
 *
 *   CREATE POLICY claims_read ON claims FOR SELECT
 *     USING (status <> 'draft' OR household = current_setting('app.household', true));
 *
 * So a receipt on somebody else's pending claim is a public fact this door is
 * allowed to answer, and a receipt on their DRAFT is unrepresentable — not by a
 * WHERE clause here, but structurally, because `current_setting(…, true)`
 * answers NULL when nothing declared and NULL is never equal to anything.
 *
 * `household` is therefore the CALLER's, and it buys exactly one thing: the
 * caller's own drafts. Handed null, the read runs with nothing declared and the
 * policy hides every draft in town, the caller's included — which is the right
 * answer for a spectator and the reason this takes the argument rather than
 * resolving a key it was not given.
 *
 * ⚑ THE SET-LOCAL TRAP is `withHousehold`'s, and it is documented there: this
 * runs on a POOL, so `app.household` must never outlive its transaction. Do not
 * inline the declaration here.
 */
 // `slug` is the FULL mark id, `<by>/<name>` — 006 made identity a column and
 // the column holds "the 1.0 path identity" (guard-reads.mjs § liveMarkOf).
 //
 // The household is resolved HERE, from the caller's key, through
 // `householdKeyForKey` — THE ONE RESOLVER both halves of the private-draft
 // lane already use. Resolving it at the call site would be a second notion of
 // whose drafts these are, which is the exact drift that function's own header
 // forbids ("do not inline either half").
export async function claimRowsForSlug(slug, { key = null, env = process.env } = {}) {
  const p = await pool(env);
  const sql = `SELECT id, slug, class, claimant, household, status, window_id,
                      submitted_at, decided_at, refusal_check, stake, supersedes
                 FROM claims WHERE slug = $1
                ORDER BY submitted_at DESC, id DESC`;
  if (!key) return (await p.query(sql, [slug])).rows;
  const household = await householdKeyForKey(p, key);
  if (!household) return (await p.query(sql, [slug])).rows;
  return (await withHousehold(p, household, (c) => c.query(sql, [slug]))).rows;
}

/**
 * EVERY CLAIM THAT MOVED SINCE AN INSTANT, for a named set of authors and slugs
 * — the backlog's half.
 *
 * `the-response-function § Residents: words, at their own pace` calls the
 * resident's loop "a replayable, cursor-ordered read of every effect on your own
 * node since you last looked", and a crossing publishing or refusing a mark IS
 * an effect on that node. This is the read that makes that clause answerable;
 * `claim-effects.mjs` turns the rows into events.
 *
 * TWO AXES, ONE QUERY, and the second is not decorative: a resident is owed the
 * claims laid over GROUND THEY HOLD as much as their own — that is what the
 * consent inbox is about, and the slug list is where those ids arrive.
 *
 * `since` bounds on `submitted_at` OR `decided_at` because a claim moves twice:
 * once when its author puts it forward and once when the candle rules. Bounding
 * on one would silently drop the other half of the resident's own history.
 *
 * Scoping is `claimRowsForSlug`'s, for its reasons: the household is resolved
 * through `householdKeyForKey`, drafts are the caller's own by 007's policy, and
 * every other status is a public fact.
 */
/**
 * EVERY CLAIM THE CANDLE RULED ON SINCE AN INSTANT — the town's news.
 *
 * Keyless and unscoped, and lawfully so: a `locked` or `refused` claim is a
 * public fact, and 007's row policy says which row is not
 * (`USING (status <> 'draft' OR household = …)`). No `withHousehold` here means
 * `app.household` is undeclared, so the policy compares against NULL and every
 * draft in town — including the caller's own — is invisible to this query. That
 * is the right answer for a shelf that describes what the TOWN did.
 */
export async function claimRowsDecidedSince(since, { env = process.env } = {}) {
  const p = await pool(env);
  const { rows } = await p.query(
    `SELECT slug, status, window_id, decided_at, refusal_check
       FROM claims
      WHERE status IN ('locked','refused') AND decided_at >= $1
      ORDER BY decided_at DESC, slug ASC
      LIMIT 500`, [since]);
  return rows;
}

export async function claimRowsSince(since, { claimants = [], slugs = [], key = null, env = process.env } = {}) {
  if (!(claimants.length || slugs.length)) return [];
  const p = await pool(env);
  const sql = `SELECT id, slug, class, claimant, household, status, window_id,
                      submitted_at, decided_at, refusal_check, stake, supersedes
                 FROM claims
                WHERE (claimant = ANY($1::text[]) OR slug = ANY($2::text[]))
                  AND (submitted_at >= $3 OR decided_at >= $3)
                ORDER BY COALESCE(decided_at, submitted_at) ASC, id ASC`;
  const args = [claimants, slugs, since];
  if (!key) return (await p.query(sql, args)).rows;
  const household = await householdKeyForKey(p, key);
  if (!household) return (await p.query(sql, args)).rows;
  return (await withHousehold(p, household, (c) => c.query(sql, args))).rows;
}

/**
 * The resident's newest PARCEL claim still in transit — `draft`, `pending` or
 * `locked` — or null (#2817, the settling-in line).
 *
 * A parcel claim is on the docket for a window, then `locked` in this store
 * until a settlement writes it to world main; through all of that the world's
 * own `homeOf` still answers unplaced, and the doorstep's checklist used to
 * read that as "go leave your home mark". This is the one question that line
 * needs answered — is the act already done and waiting — and it is asked
 * inside the household's own row policy exactly as `claimRowsSince` is, so a
 * private draft is visible to its own house and to nobody else.
 *
 * `class` is the mark's kind (the promotion writes `kind` into it), so the
 * predicate is the column, not a slug pattern.
 */
export async function parcelClaimFor(handle, { key = null, env = process.env } = {}) {
  if (!handle) return null;
  const p = await pool(env);
  const sql = `SELECT slug, status, window_id, submitted_at
                 FROM claims
                WHERE claimant = $1 AND class = 'parcel'
                  AND status IN ('draft','pending','locked')
                ORDER BY submitted_at DESC, id DESC
                LIMIT 1`;
  const args = [handle];
  const read = async (c) => (await c.query(sql, args)).rows[0] ?? null;
  if (!key) return read(p);
  const household = await householdKeyForKey(p, key);
  if (!household) return read(p);
  return withHousehold(p, household, read);
}
