// materialize.mjs — HOW A CLAIM BECOMES A MARK, and how standing is re-walked
// after it does. Extracted from `clearing-job.mjs` (steps 6 and 7) the day a
// SECOND lawful writer of `marks` appeared: the REVIEW lane's ruling on a
// `held_review` contest (`review-rule.mjs`, census Decision 2's "a mind rules").
//
// IT IS AN EXTRACTION, NOT A SECOND COPY, and that is the whole reason this file
// exists. `mark-standing.mjs` states the rule one level up — "One definition,
// five consumers … a second copy of this walk is a future drift; import it" —
// and a candle and a ruling that materialized a claim two slightly different
// ways would be that drift with a schema. The clearing job calls these; the
// ruling calls these; there is one answer to "what does a locked claim become".
//
// THE PEN IS STILL ONE. Both callers connect as `clearing_job` — the only role
// holding INSERT/UPDATE on `marks` and UPDATE on `claims` (002_grants.sql) — so
// extracting the code adds no writer. What changed is that two TOOLS now hold
// that one pen, which is exactly why the law had to leave the tool it grew up
// in.
//
// Nothing here opens a connection or a transaction. Every function takes the
// caller's `q(text, args)` and runs inside the caller's transaction, because a
// materialization that could commit on its own would be a second candle.

import { computeStanding, admissionNotes, gistContainment } from "./standing.mjs";
import { houseKeyOfVia, houseRowsVia } from "../../src/household-deriver.mjs";
import { REFUSALS, refuse } from "../../src/ceremony.mjs";

/**
 * The identity a claim will materialize under.
 *
 * `claims.slug` since 006; the `geometry->>'slug'` fallback is for the lab rows
 * written before it, and dies with them (anti-rebake rule 5: every shim ships
 * with its own death — this one is over when
 * `SELECT count(*) FROM claims WHERE slug IS NULL AND geometry ? 'slug'` is
 * zero, which 006's own UPDATE already made true on dev).
 */
export const slugOf = (c) => c.slug ?? c.geometry?.slug ?? null;

/**
 * PARENTS BEFORE CHILDREN.
 *
 * `marks.parent` is a self-referencing foreign key and it is NOT deferrable
 * (004), so two marks locking in one window with one predicated on the other are
 * refused mid-transaction unless they go in order — and the whole window would
 * roll back on it, which is the right failure and a needless one. This is
 * seed-import's `orderByParent`, asked of a batch instead of a whole register: a
 * claim whose parent is not another claim in THIS batch is already satisfiable
 * (the parent stands from an earlier window, or there is none), so it goes
 * first.
 */
export function orderByParent(claims, { label = "this batch" } = {}) {
  const inBatch = new Set(claims.map((c) => String(c.id)));
  const ordered = [];
  const emitted = new Set();
  let waiting = claims.slice();
  while (waiting.length) {
    const ready = waiting.filter((c) => !c.parent || !inBatch.has(String(c.parent)) || emitted.has(String(c.parent)));
    if (!ready.length) {
      throw new Error(`the parent edges among ${waiting.length} claim(s) in ${label} form a cycle, e.g. ` +
        waiting.slice(0, 3).map((c) => slugOf(c)).join(", "));
    }
    for (const c of ready) { ordered.push(c); emitted.add(String(c.id)); }
    const readySet = new Set(ready);
    waiting = waiting.filter((c) => !readySet.has(c));
  }
  return ordered;
}

/**
 * Turn locked claims into standing marks.
 *
 * THE MARK CARRIES THE WHOLE RECORD, not the columns that existed before 004
 * (the replay gate's finding 3). `data` is where the record's remainder lives —
 * `date`, `image`, `pre`, `slot`, and the standing the fold answered — and
 * `parent` is the continuation edge a predicated mark IS. Materializing without
 * them made every mark that came through the candle strictly poorer than one the
 * seed imported.
 *
 * A CLAIM THAT NAMES A MARK MATERIALIZES, geometry or no geometry (finding 1).
 * The old gate was `c.geometry?.slug`, so a de-sited claim — 44% of 1.0's
 * register is predicated or naming — locked and then produced nothing, with no
 * refusal and nothing to notice.
 *
 * AN AMEND REWRITES THE MARK IT CONTINUES. Not a new row: the slug is unique,
 * the mark's id is its FIRST locking claim's id, and the register has one
 * standing mark per slug. `locked_window` moves to `windowId`, because that is
 * when this version of the record was ruled.
 *
 * `amends` maps a claim id (as a string) to the standing mark row it continues.
 */
/**
 * THE OWNERSHIP GRAIN IS THE CLAIMANT'S, RESOLVED — never the claim's scope
 * label (2026-09-02, the flip week's first catch; the standing falsifier's
 * symmetric attribution exposed it same morning it landed).
 *
 * `claims.household` answers a DIFFERENT question: whose eyes may see this
 * draft — the acting KEY's household name, and for a human-credentialed act
 * that is the human's GitHub login (world2-claims.mjs § THE ONE RESOLVER:
 * flipping it would break my-drafts parity). Copying it into `marks.household`
 * made the login the ownership grain on 26 standing rows across 12 households
 * (berthillon's cones as solo:devadavisson, sage-reeves' welcomes as
 * solo:kristinashoultz-wq, pando-peak-home as solo:FluffUPando …), and the
 * standing walk then refused sovereignty on the resident's own parcel —
 * fold says home, port says market, and the PORT was right about a store that
 * was wrong. Two questions, one column, exactly the words-for-one-fact class.
 *
 * So the mark's household resolves from the CLAIMANT (the resident who owns
 * the mark), never from the claim's scope label. The sibling resolver in
 * world2-claims.mjs stays untouched and keeps its lane.
 *
 * ── AND IT NO LONGER READS `identities` (POS-160 follow-up, RED 2) ──────────
 *
 * The 08-28 spelling was "the roster's household KEY, else solo:<handle>", and
 * the roster it meant was `identities` — a projection of the WORLD repo's copy
 * of the town's pins, four hops from the fact, answering in whatever spelling
 * that copy happened to carry. MEASURED 2026-09-22: `gh:<id>` on 173 handles,
 * `hh:<slug>` on 17, and one house wearing both at once.
 *
 * #165's lane flagged this function as THE SOURCE of the multi-spelling store:
 * `claims.household` is the acting key's and `marks.household` was copied from
 * `identities`, so between them the pen minted `gh:`, `hh:` and `solo:` rows
 * and then the read side had to reconcile them with a spelling set. Ruling 1
 * and the design note say every NEW line from the law date names `hh:<slug>`.
 * So this function now asks the ONE DERIVER, against the registry in the
 * caller's own store, and answers `hh:<slug>`.
 *
 * ── IT REFUSES A HOUSELESS CLAIMANT. IT DOES NOT FALL BACK ──────────────────
 *
 * `solo:<handle>` is gone from this pen (one named exception, the town's own
 * marks: `TOWN_HOUSEHOLD_BY_NAME` below), and that is the point rather than a
 * side effect: every `solo:` row the store holds was minted by a fallback
 * exactly here, and a fallback that keeps minting them makes the spelling set
 * a permanent fixture instead of a bridge over a closed history. After
 * POS-159's backfill the case does not arise — every resident on the roll
 * stands in exactly one house, 188 of 188 by account — so a claimant the
 * registry cannot name is a genuine defect in the roll and a person should see
 * it, at the crossing, rather than read it as a household six weeks later.
 *
 * TWO REFUSALS AND NOT ONE, because `NULL IS NOT EMPTY` (registry-store.mjs's
 * own rule) and the two failures want different hands:
 *
 *   NO_RECORD (503)      the registry holds no houses at all — this store is
 *                        not pointed at the record, or the tables are unseeded.
 *                        An operator problem, and refusing every claimant on
 *                        one reading is louder and truer than naming them one
 *                        at a time.
 *   NO_SUCH_HOUSE (404)  the roll is readable and does not name this claimant.
 *                        One person's row to fix, in the join ceremony.
 *
 * The vocabulary is `src/ceremony.mjs § REFUSALS` verbatim — the same sentences
 * the join door says, because "a refusal a resident meets at two doors in two
 * wordings is two laws wearing one name."
 *
 * ── THE MEMO MOVED INTO THE DERIVER, ON PURPOSE ────────────────────────────
 *
 * The `ownerKeys` Map this replaced was keyed on the HANDLE alone and lived for
 * the life of the process, so two stores in one process (a suite's stub and a
 * real pool; a replay and a live arm) shared one answer and `__clearHouseCache`
 * could not reach it. `houseOfVia` memoises per (queryable, x) in a WeakMap and
 * IS cleared by that seam, so the cache is now scoped to the store it came
 * from. `queryableFor` keeps ONE adapter object per `q` for the same reason —
 * a fresh `{ query }` per claim would defeat the WeakMap and put the whole
 * registry fold through `registryFromRows` on every line of a crossing.
 */

/** `q(text, args)` as the queryable `registryRowsVia` wants — one per `q`. */
const queryables = new WeakMap();
const queryableFor = (q) => {
  let via = queryables.get(q);
  if (!via) { via = { query: (text, args = []) => q(text, args) }; queryables.set(q, via); }
  return via;
};

/**
 * THE TOWN'S MARKS, BY NAME — AN INTERIM (POS-142).
 *
 * Keemin, 2026-09-24 ~19:3x EDT: "the town should be some kind of entity, idk
 * if household is correct, but yes the long-term shape is that the meeps should
 * belong to the town." Wright proposed an interim (the town's marks keep
 * `solo:the-town` by name, pinned by a test, committing to nothing about what
 * the town is) and Keemin approved it: "I agree. good to have a lane build it
 * tonight".
 *
 * `the-town` authors the constitution marks and is not a household on the
 * roll, so under the refusal below every ingest carrying a new town mark
 * refused whole at NO_SUCH_HOUSE (the dev sandbox run, 2026-09-24: six of 21
 * adds). The store already holds the town's rows as `solo:the-town`, and
 * `store-writedown.mjs § isTheTown` already reads that spelling as the town.
 *
 * ONE claimant, matched exactly, answered BEFORE the roll is asked. No other
 * handle is exempt: every other claimant the roll does not name still refuses.
 * INTERIM until the town-as-entity sitting decides what the town is.
 */
export const TOWN_CLAIMANT = "the-town";
export const TOWN_HOUSEHOLD_BY_NAME = "solo:the-town";

export async function ownerHouseholdFor(q, owner) {
  const handle = String(owner ?? "").trim();
  if (handle === TOWN_CLAIMANT) return TOWN_HOUSEHOLD_BY_NAME;   // the one named exception, above
  const via = queryableFor(q);

  const rows = await houseRowsVia(via);
  if (!Object.keys(rows?.registry?.households ?? {}).length)
    throw refuse(REFUSALS.NO_RECORD,
      `materialize: the registry names no households in this store, so no mark may be filed under one` +
      (handle ? ` (asked for ${JSON.stringify(handle)})` : ""));

  if (!handle)
    throw refuse(REFUSALS.NO_SUCH_HOUSE,
      "materialize: a claim arrived with no claimant, and `marks.household` is never NULL");

  const key = await houseKeyOfVia(via, handle);
  if (!key)
    throw refuse(REFUSALS.NO_SUCH_HOUSE,
      `materialize: the town's roll does not name ${JSON.stringify(handle)}, so this mark has no household ` +
      `to stand in. The pen no longer mints \`solo:${handle}\` — every solo row in the store came from that ` +
      `fallback, and Ruling 1 says every new line from the law date carries hh:<slug>. Fix the roll.`);

  return key;
}

export async function materializeClaims(q, { claims, amends = new Map(), windowId, label }) {
  const named = claims.filter((c) => slugOf(c));   // a stake or escrow claim names no mark
  const ordered = orderByParent(named, { label: label ?? `window ${windowId}` });
  for (const c of ordered) {
    const slug = slugOf(c);
    const amended = amends.get(String(c.id));
    const grain = await ownerHouseholdFor(q, c.claimant); // NOT c.household — § the ownership grain above
    if (amended) {
      await q(
        `UPDATE marks SET kind = $2, owner = $3, household = $4, body = $5, geometry = $6,
                          bbox = $7, data = $8, parent = $9, locked_window = $10
           WHERE id = $1`,
        [amended.id, c.class, c.claimant, grain, c.body, c.geometry, c.bbox,
         c.data, c.parent, windowId]);
      continue;
    }
    await q(
      `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status,
                          locked_window, data, parent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'standing',$9,$10,$11)`,
      [c.id, slug, c.class, c.claimant, grain,
       c.body, c.geometry, c.bbox, windowId, c.data, c.parent]);
  }
  return ordered.length;
}

/**
 * THE STANDING RECOMPUTE — the last act of anything that added ground.
 *
 * RULING (Wright, 2026-08-28 eve, on the replay gate's finding 4): "tier is
 * recomputed for ALL standing marks inside the clearing transaction, which is
 * settlement-equivalent staleness, zero new class."
 *
 * ALL STANDING MARKS, not the batch's. That is the whole point: standing is a
 * fact about the ground a mark stands on, so a NEIGHBOUR's parcel landing moves
 * marks nobody claimed — `berthillon/le-petit-berthillon` went `market → home`
 * with every authored byte identical, because `berthillon/chez-antoine` gave the
 * walk sovereign ground to stop at.
 *
 * INSIDE THE CALLER'S TRANSACTION, because a recompute that could land after the
 * writer committed would be a second pen writing the register.
 *
 * ONLY THE ROWS THAT MOVED are written, and the count is a receipt: a recompute
 * that touched every row every time would tell a reader nothing about whether
 * the world moved.
 *
 * A REVIEW RULING NEEDS THIS EXACTLY AS A CLEARING DOES — a granted parcel is
 * ground arriving, and ground arriving is what moves a neighbour's standing.
 * A ruling that skipped it would re-open finding 4 through the side door.
 */
export async function recomputeStanding(q) {
  const { rows: standing } = await q(
    `SELECT id::text, slug, kind, owner, household, geometry, parent::text, data
       FROM marks WHERE status = 'standing'`);
  // THE CONTAINMENT CANDIDATES, ASKED OF THE STORE (standing.mjs § the spatial
  // index, 016_marks_bbox_gist.sql). Read INSIDE this transaction, off `q`, so
  // the index answers about exactly the rows the SELECT above returned. Null
  // when migration 016 is not applied, and then the walk scans as it always has
  // — the reader refuses to run its pair query unindexed precisely because
  // unindexed it is slower than the walk it would replace.
  const containment = await gistContainment(q);
  const tiers = computeStanding(standing, { containment });
  const moved = [];
  for (const m of standing) {
    const next = tiers.get(m.slug);
    // A standing mark the walk did not answer for is not a mark with an unknown
    // standing; it is a register the recompute could not resolve, and writing
    // the stale value would be the finding-4 bug wearing a receipt.
    if (next == null) throw new Error(`the standing walk returned no verdict for ${m.slug}`);
    if ((m.data?.tier ?? null) === next) continue;
    await q(
      `UPDATE marks SET data = jsonb_set(coalesce(data, '{}'::jsonb), '{tier}', to_jsonb($2::text)) WHERE id = $1`,
      [m.id, next]);
    moved.push({ slug: m.slug, from: m.data?.tier ?? null, to: next });
  }
  // The premises the port stands on that are FACTS about today's register rather
  // than law (standing.mjs § the tripwires). Recorded in the receipts, not
  // thrown: a write must not fail because the town outgrew a premise, but nobody
  // should have to go looking for the day it did.
  // WHAT THE PREFILTER COULD SPEAK FOR, on the record. Without this the
  // containment index is a thing that either helped or did not and left nothing
  // behind to say which — and its two failure modes are both quiet: migration
  // 016 absent (`indexed: false`, the walk silently pays the old price) and the
  // loose set growing (rows whose `bbox` does not bound them, which the walk
  // must keep scanning). Both are counts a reader can watch move.
  return {
    standing, moved, notes: admissionNotes(standing),
    containment: containment
      ? { indexed: true, covered: containment.covered.size, loose: containment.loose.length,
          ...(containment.loose.length ? { loose_marks: containment.loose.slice(0, 10) } : {}) }
      : { indexed: false },
  };
}

/**
 * THE RETIREMENT — the inverse of `materializeClaims`, and the only path by
 * which a standing mark stops standing.
 *
 * ── WHY IT LIVES HERE AND NOT IN A NEW FILE ─────────────────────────────────
 *
 * `marks` has exactly one pen — `clearing_job` holds INSERT, UPDATE on it
 * (002_grants.sql:22) — and this file is where that pen's answers to "what
 * becomes of a mark" live. A retirement written anywhere else would be a second
 * place to read the register's law, which is the drift `mark-standing.mjs`'s
 * header forbids one level up. No new grant is needed and none is asked for.
 *
 * ── THE GAP THIS CLOSES, MEASURED BEFORE IT WAS BUILT ───────────────────────
 *
 * Until this function existed, NOTHING in the live write path ever set
 * `marks.status = 'retired'`. 001_tables.sql has carried the column and its
 * CHECK since the first migration; the only writers in the tree were
 * `replay-ingest.mjs`'s backfill and `falsifier-standing-equality.mjs`'s own
 * can-fail fixture. So a mark the world unpublished stayed `standing` in the
 * store forever, and on the pre-cutover dump that read 1,019 standing / 0
 * retired, ever.
 *
 * IT IS WORSE THAN A STALE ROW, and this is the reason the step is worth a
 * transaction rather than a nightly tidy. `recomputeStanding` above walks
 * `WHERE status = 'standing'`, and standing is a fact about the ground a mark
 * stands on — so a mark that should have been retired keeps holding ground
 * under its neighbours and hands them a tier the fold does not agree with.
 * That is the `berthillon/chez-antoine` mechanism in this file's own comment,
 * running backwards. Retiring correctly is what removes the phantom ground,
 * which is why the caller runs this BEFORE the recompute, never after.
 *
 * ── WHAT HAPPENS TO THE CLAIM, AND WHY NOTHING ─────────────────────────────
 *
 * The locking claim is left exactly as it stands. `retracted` is the docket's
 * word for a claim that never locked — `world2-claims.mjs:234-237` only ever
 * moves a `pending` row there — and the docket's own guard forbids deleting a
 * locked one. The claim is the historical fact that this mark WAS ruled in at
 * that window, and that fact did not stop being true when the world let the
 * mark go. The retirement is a fact about the mark's standing today; the claim
 * is a fact about a window that has closed. Writing the retirement onto the
 * claim would collapse two different times into one row.
 *
 * ── IDEMPOTENT BY THE GUARD, NOT BY A CHECK-THEN-WRITE ─────────────────────
 *
 * `AND status = 'standing'` is what makes a re-run a no-op, and it is in the
 * UPDATE rather than in a preceding SELECT on purpose: a check-then-write over
 * a connection two crossings could share is a race with a comfortable shape.
 * A slug already retired reports as `already_retired`, not as an error and not
 * as a silent success — a caller re-running after a half-finished crossing has
 * to be able to tell "I did this" from "this was already done".
 *
 * A slug the register does not carry at all is `absent`, and that is also not
 * an error: the world can unpublish a mark the store never materialized (a
 * founding-estate row, or one whose claim was never locked here), and refusing
 * the whole crossing over it would make the store's ignorance the town's
 * problem. It is REPORTED, because a step that quietly did nothing is the
 * failure mode this whole seam exists to end.
 *
 * ── THE CAN-FAIL FLIP, AS A DIFF RATHER THAN A DESCRIPTION ─────────────────
 *
 * My first write-up said "the UPDATE replaced by a SELECT that returns no
 * rows", and a reader cannot run that sentence: the fake register in
 * `test/retire-marks.test.mjs` THROWS on SQL it does not model, so most
 * spellings of that sentence produce an error rather than the split I reported.
 * The flip is therefore recorded as the exact four-line edit it was, applied to
 * the UPDATE below:
 *
 *     -    const { rows } = await q(
 *     -      `UPDATE marks SET status = 'retired', retired_window = $2
 *     -        WHERE slug = $1 AND status = 'standing'
 *     -        RETURNING slug, locked_window`,
 *     -      [slug, windowId]);
 *     +    const { rows } = await q(
 *     +      `SELECT status, retired_window FROM marks WHERE slug = $1 AND FALSE`,
 *     +      [slug, windowId]);
 *
 * It is the SELECT the register already models (the second branch of its `q`),
 * so it returns rows instead of throwing — which is what makes this flip
 * runnable at all, and is exactly the detail the prose lost.
 *
 * Run on the committed tree, the split it produces is recorded in
 * `test/retire-marks.test.mjs`'s header beside the tests it reds.
 *
 * @param q      the caller's query function — this runs INSIDE the caller's
 *               transaction, like every other function in this file.
 * @param slugs  the `<owner>/<name>` identities the world no longer carries.
 * @param windowId  the window this retirement is ruled at; lands in
 *               `retired_window`, which is the column 001 gave it — NOT
 *               `locked_window`, which records when the mark was ruled IN.
 * @param cause  a short word naming which door the mark left canon by, carried
 *               into the receipt so a keeper reading it knows what happened
 *               rather than only that something did.
 */
export async function retireMarks(q, { slugs, windowId, cause = "settlement-unpublish" }) {
  if (!Number.isInteger(windowId)) {
    throw new Error(`retireMarks needs the window it rules at; got ${JSON.stringify(windowId)}`);
  }
  const retired = [];
  const alreadyRetired = [];
  const absent = [];
  for (const slug of [...new Set(slugs.map((s) => String(s)))].sort()) {
    const { rows } = await q(
      `UPDATE marks SET status = 'retired', retired_window = $2
        WHERE slug = $1 AND status = 'standing'
        RETURNING slug, locked_window`,
      [slug, windowId]);
    if (rows.length) { retired.push({ slug, window: windowId, locked_window: rows[0].locked_window, cause }); continue; }
    // Tell the two zeroes apart. A zero meaning "already done" and a zero
    // meaning "never here" must not be spelled the same way — the RLS lesson,
    // one table over.
    const { rows: seen } = await q("SELECT status, retired_window FROM marks WHERE slug = $1", [slug]);
    if (seen.length) alreadyRetired.push({ slug, retired_window: seen[0].retired_window ?? null });
    else absent.push({ slug });
  }
  return { retired, already_retired: alreadyRetired, absent, window: windowId, cause };
}
