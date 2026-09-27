// guard-reads.mjs — the WRITE PATH's own validation inputs, ported to Postgres.
//
// WHY THIS EXISTS (DESIGN-pen-flip.md § 2, R3 — quoted verbatim):
//
//   "A pen flip without a read flip produces an office that writes to Postgres
//    and validates against sqlite — a split brain with a switch on it. Every
//    door guard below reads a 1.0 pen today"
//
//   | read | source today | who needs it |
//   |---|---|---|
//   | `liveMarks` / `liveChildrenOf` | `journal` | leave-mark slug collision, parcel cap, withdraw's stranding check |
//   | `draftsForKey`                 | `journal` + git sketchbook | the signed-in draft overlay |
//   | `liveHolder` / `readAttachments` | `attachments` | give/drop/take's holder check |
//
//   "Not yet ported: the mark door guards (row 1–2) … and the holder check
//    (row 6). Those are the write path's own validation inputs, so they gate
//    the write flip specifically."
//
// This file is those three rows. The sibling lane `postgres-world/live` did the
// LIVE read tier the same way (`live-reads.mjs`), and this is deliberately its
// twin in shape: a PORT of 1.0's own law as pure functions over DB-shaped rows,
// held to the original by a falsifier that runs BOTH over the same state
// (`falsifier-guard-equality.mjs`).
//
// ── PURE OVER ROWS AND A CLIENT. NOTHING FROM `src/` IS IMPORTED ─────────────
//
// live-reads.mjs's reason was that the read tier holds no world checkout. This
// file's reason is different and worth stating, because a reader who knows the
// first reason will ask why it applies here — the write path DOES run inside
// the office, and it CAN import.
//
// It does not import for two reasons:
//
//   1. `src/world-journal.mjs` imports `world2-acts.mjs`, `world2-claims.mjs`
//      and `world2-pen.mjs`; `src/world-hold.mjs` imports `dynamic-store.mjs`
//      (and with it `node:sqlite`). A guard read that pulled the whole 1.0 pen
//      in behind it would make "2.0 validates from 2.0" false at the import
//      line — the flip's own dependency, arriving through the back door.
//   2. This is the READ half of a flip whose write half is being built beside
//      it. A module with no office dependencies can be wired into the door, or
//      into `world2-serve.mjs`'s read tier, or driven by a falsifier holding
//      only a connection string, without any of the three pulling the others.
//
// So: where a predicate is SMALL AND EXACT it is VENDORED verbatim with its blob
// sha (live-reads.mjs's rule, unchanged). Where it is a whole module's judgment —
// `replayDrafts`, `pathFor` — it is REFUSED and taken as an INJECTED PARAMETER,
// so the office hands over its own function rather than this file growing a twin
// of it. `falsifier-guard-equality.mjs` injects 1.0's real ones, which is what
// makes the equality total rather than scoped around the hard part.
//
// ── WHAT ANSWERS EACH READ IN 2.0, AND WHY ──────────────────────────────────
//
// | 1.0 read | 1.0 store | 2.0 store | the mapping's own argument |
// |---|---|---|---|
// | `liveMarks` | `journal` rows, class `mark`, latest-wins | `claims` where status ∈ (draft, pending) | a claim IS a live declaration; it leaves the live layer exactly when the candle rules on it |
// | `liveChildrenOf` | the same, filtered on `parent_id` | the same, `data->>'parent_id'` | `parent_id` rides `claims.data` (the docket pen's `...rest` spill) |
// | `draftsForKey` (journal half) | `replayDrafts` over the log | `claims` + the withdraw acts | § THE DELETED ARM below — it is NOT in `claims`, and that is a finding |
// | `liveHolder` | `attachments` | `acts`, folded | § HOLDING, two eras |
//
// THE SUPERSESSION FOLD IS ALREADY APPLIED IN 2.0, and that is the single
// biggest structural difference. 1.0's `liveMarks` folds a LOG — "latest-wins,
// in seq order — the log's own order is the supersession order" — because the
// journal holds every declaration ever made about a slug. `claims` holds ONE ROW
// PER SLUG PER HOUSEHOLD: the docket pen rewrites the draft in place
// (world2-claims.mjs § the stake crossing the boundary, "the act does not create
// a second claim -- it rewrites the one they composed"). So the fold this file
// performs is not latest-wins; it is a SELECT, and the equality falsifier's job
// is to prove the pen's in-place rewrite reaches the same answer the log's fold
// does. Those are two different claims and only the second is testable here.
//
// ── WHAT IS **NOT** HERE, AND WHY (the honest list) ─────────────────────────
//
//  1. THE GIT SKETCHBOOK HALF of `draftsForKey`. 1.0 unions the journal replay
//     with `draftDeltaForKey` — the `draft/<household>` branch, "still holding
//     every draft written BEFORE the flag flipped". That branch has no 2.0
//     surface and never will: Phase 5.6 moved private drafts into `claims`
//     precisely because "a draft/<household> branch in a public repo was always
//     readable". `DISCLOSURES.sketchbook` is what the door says instead.
//  2. `path`. 1.0's filing comes from `pathFor` + the frozen filing manifest, and
//     2.0 has no filing at all — the notary exports acts, not a mark tree. `path`
//     is therefore an INJECTED resolver, `null` when the caller supplies none,
//     and never guessed. See `DISCLOSURES.filing`.
//  3. CANON. Every guard reads canon-plus-overlay (`journalLeaveMark`:
//     "It runs over canon-plus-overlay like every other guard in this function").
//     Canon in 2.0 is the `marks` table, and reading it is one plain SELECT that
//     needs no port. `publishedIdsFrom` is the one convenience here; the guards
//     take canon as an argument the way `canonForGuards()` hands it over today.
//  4. THE PARCEL CAP'S OWN ARITHMETIC and the sovereignty check. Both read canon
//     + the live layer and then do town-law math (`PARCEL_CLAIM_CAP`,
//     `marksContain`, the households registry). The law is `law_projection`'s and
//     the geometry is the fold's; neither belongs to a store read. This file
//     supplies the LIVE HALF of that guard's input and stops there.

// ═════════════════════════════════════════════════════════════════════════════
// VENDORED, verbatim, with provenance. Each block names its file, blob and sha.
// ═════════════════════════════════════════════════════════════════════════════

export const VENDOR = Object.freeze({
  journal: { repo: "keeminlee/postmark-office", path: "src/world-journal.mjs",
             blob: "70c5a1f8ee751062678c696aee40975fcf969cd7", at: "90d046b255873c57d1e8ec251be20c3f58bd3a7f" },
  hold: { repo: "keeminlee/postmark-office", path: "src/world-hold.mjs",
          blob: "7ad265ce8a22c3a2d6df1fae3569b283171bdcec", at: "90d046b255873c57d1e8ec251be20c3f58bd3a7f" },
  claims: { repo: "keeminlee/postmark-office", path: "src/world2-claims.mjs",
            blob: "63602cc76af6c68cbf68b8ca976f410ea1319387", at: "90d046b255873c57d1e8ec251be20c3f58bd3a7f" },
  rebuild: { repo: "keeminlee/postmark-office", path: "tools/dynamic-rebuild.mjs",
             blob: "a446df474c2110d502d57bcf7f117f7717ad119d", at: "90d046b255873c57d1e8ec251be20c3f58bd3a7f" },
  entities: { repo: "keeminlee/postmark-office", path: "src/dynamic-entities.mjs",
              blob: "dc2fa5109d4b7b6e7943cb7324863152429cb792", at: "90d046b255873c57d1e8ec251be20c3f58bd3a7f" },
  world: { repo: "keeminlee/postmark-office", path: "src/world.mjs",
           blob: "de7f4027b9c3c5057673cbe3203c5f800dd48f31", at: "90d046b255873c57d1e8ec251be20c3f58bd3a7f" },
});

// ── world-journal.mjs, verbatim ─────────────────────────────────────────────
export const CLASS_MARK = "mark";
export const ACTION_LEAVE = "leave-mark";
export const ACTION_AMEND = "amend";
export const ACTION_WITHDRAW = "withdraw";
export const MARK_ACTIONS = new Set([ACTION_LEAVE, ACTION_AMEND, ACTION_WITHDRAW]);

/**
 * world-journal.mjs `liveMarks`'s record shaper, verbatim — the four lines that
 * decide what a live mark IS in the door's vocabulary:
 *
 *   out.push({ id, ...p, by: p.by ?? String(id).split("/")[0],
 *              household: row.household ?? null, seq: row.seq });
 *
 * Vendored rather than injected because it is not a judgment: it is the SHAPE
 * every guard destructures, and a port that produced a different shape would
 * fail at `m.parent_id` rather than at a comparison.
 */
const liveMarkShape = (id, payload, { household = null, seq = null } = {}) => ({
  id, ...payload,
  by: payload.by ?? String(id).split("/")[0],
  household: household ?? null,
  seq,
});

// ── world-hold.mjs, verbatim ────────────────────────────────────────────────

/** world-hold.mjs `rowsFor`, verbatim — "Rows for one thing, oldest first". */
export const rowsFor = (rows, thingId) => rows.filter((r) => r.target === thingId);

/**
 * world-hold.mjs `liveHolder`, verbatim.
 *
 * "Who holds this thing right now, or null if it is standing on the ground.
 *
 *  Latest wins. `readAttachments` already orders by (born_at, seq), so 'latest'
 *  is the last row and no comparator is restated here — the one ordering lives
 *  in the reader, the way `governingAt` keeps the one latest-wins for
 *  departures."
 *
 * THE ORDERING LIVING IN THE READER IS EXACTLY WHY THE PORT IS RISKY, and it is
 * why `ATTACHMENT_ORDER_SQL` below is a constant with an assertion behind it
 * rather than a clause each caller writes. This function is five lines and
 * cannot be wrong; the order it is handed can be, silently, and it would hand a
 * thing to the wrong resident with nothing to see.
 */
export function pgHolderOf(rows, thingId) {
  const mine = rowsFor(rows, thingId);
  if (!mine.length) return null;
  const last = mine[mine.length - 1];
  return last.policy === "cascade" ? last.entity : null;
}

/** world-hold.mjs `holdingsOf`, verbatim — "Everything this resident is holding, in the order they took it." */
export function pgHoldingsOf(rows, handle) {
  const targets = [...new Set(rows.map((r) => r.target))];
  return targets.filter((t) => pgHolderOf(rows, t) === handle);
}

// ═════════════════════════════════════════════════════════════════════════════
// THE LIVE LAYER — `claims` as 1.0's live marks
// ═════════════════════════════════════════════════════════════════════════════
//
// ── WHICH STATUSES ARE "LIVE", AND THE ONE THAT IS UNRULED ──────────────────
//
// 1.0's live layer is "everything it has declared since the last save that has
// not been withdrawn". Its boundary is THE DRAIN: the journal truncates at the
// crossing-save, so a declaration leaves the live layer when the settlement
// takes it. 2.0's boundary is the CANDLE, and the two agree on four of the six
// statuses without argument:
//
//   draft        live   — composed, unstaked, private. 1.0's unsaved sketch.
//   pending      live   — on the docket, not yet ruled on. 1.0's unsaved sketch
//                         with a stake behind it.
//   locked       gone   — it is a row in `marks` now, which is canon. 1.0's
//                         drain moved it to the sketchbook/main the same way.
//   refused      gone   — the candle ruled against it.
//   retracted    gone   — the author let it go (2.0's withdraw-of-a-pending).
//   held_review  ⚠ UNRULED — see below.
//
// `held_review` is census decision 2 ("colliding claims -> held_review, a mind
// rules"). It has NO 1.0 counterpart: in 1.0 a colliding declaration sits in the
// journal until the settlement adjudicates it, so it IS live. In 2.0 it has left
// `pending`, so by the rule above it is not.
//
// EXCLUDED, and tripwired rather than assumed. The reasoning both ways is real —
// including it is safer for the slug-collision guard (a guard that misses a live
// mark lets a duplicate through) and wrong for the parcel cap (it would count a
// claim the town has not granted) — and picking between them is a ruling, not a
// port. There are ZERO held_review rows on `world2_dev` today (measured
// 2026-08-28), so the choice costs nothing yet; `admissionNotes` fires the day
// it does, which is the day somebody has to rule.
export const LIVE_STATUSES = Object.freeze(["draft", "pending"]);

/**
 * The columns every live-mark read needs. A constant because the mapping below
 * reads six of them and a caller that selected five would get `undefined` where
 * the guard expects a coordinate — and `undefined` compares equal to an absent
 * field, so nothing would say so.
 */
export const LIVE_CLAIM_SELECT =
  `SELECT id, slug, class, claimant, household, status, body, geometry, stake, data, submitted_at
     FROM claims`;

/**
 * One `claims` row → one `liveMarks` record.
 *
 * Returns `{ mark }` or `{ refused, reason }`. A row this cannot read is REFUSED
 * BY NAME and never skipped — ledger-backfill's rule, which live-reads.mjs
 * quotes and which is if anything sharper on a GUARD: a guard read that silently
 * drops a row does not answer wrongly, it PERMITS wrongly, and the symptom is a
 * duplicate slug or a fourth parcel rather than a bad number on a page.
 *
 * ── THE FIELD MAP, AND ITS THREE SEAMS ─────────────────────────────────────
 *
 * `submitClaimFromJournal` takes the journal payload apart like this:
 *
 *   const { slug: _s, at, extent, points, body, stamps, put_forward, ...rest } = payload;
 *   const geometry = placed ? { slug, at, extent, ...(points ? { points } : {}) } : { slug };
 *   const data = JSON.stringify({ ...rest, _journal_seq: seq, … });
 *
 * so the record is reassembled from four columns and a spill. Three fields do
 * NOT come back the way they went in, and each is handled by NAME here rather
 * than by widening a comparison later:
 *
 *   `stamps`      → `claims.stake`. The door's `stamps:` is the claim's stake.
 *                   Reconstructed only when the column is non-zero, because 1.0
 *                   carries no `stamps` key at all on an unstaked declaration
 *                   and inventing `stamps: 0` would make every draft differ.
 *   `put_forward` → `status`. It is "the DOOR's verdict, not the caller's word",
 *                   and the status IS that verdict recorded. Reconstructed as
 *                   `true` on a pending row; NOT reconstructed as `false` on a
 *                   draft, for the same absent-vs-false reason, and because a
 *                   draft promoted later by `world_stake` never had the field.
 *   `household`   → the RESOLVED KEY (`gh:…` / `solo:…`), not the journal's own
 *                   `household` field. THIS IS live-reads.mjs's `_cred` EDGE, one
 *                   table over, and it bites harder here: 1.0's guards compare
 *                   `m.household` against a household NAME. The journal's
 *                   spelling is kept under `_journal_household` when the row
 *                   carries one, and `household` holds what the column holds,
 *                   under its own name, so nothing can confuse the two silently.
 */
export function liveMarkOf(row) {
  const id = row?.slug;
  if (!id) {
    return { refused: true, reason:
      `claim ${row?.id} carries no slug — 006 made identity a column ("identity is a column, not a key inside ` +
      `geometry"), and a live-mark read has nothing to be a mark ABOUT without one. A pre-006 row that never ` +
      `got its backfill would land here, and it must be repaired rather than skipped.` };
  }
  const data = row.data && typeof row.data === "object" ? row.data : {};
  const geometry = row.geometry && typeof row.geometry === "object" ? row.geometry : {};
  // `_journal_seq`, `_act_id` and `_deferred_act` are the docket pen's own
  // plumbing, not anything the resident declared. `_deferred_act` especially:
  // it is a whole copy of the journal row, and spreading it into a mark record
  // would put a second `payload` inside the mark.
  //
  // `_act_id` joined them 2026-09-04 with the mark lane's flip (world2-claims §
  // `_act_id`), and it is named here rather than filtered by prefix on purpose:
  // an underscore convention is a rule nothing enforces, and the field that
  // slips through it is the one nobody thought to name. Every field the pen
  // adds to `data` gets a line in this destructure, or it reaches the doors as
  // something the resident wrote.
  const { _journal_seq, _act_id, _deferred_act, ...declared } = data;

  const payload = {
    ...declared,
    // ── THE BARE SLUG, WHICH THE DOCKET PEN THROWS AWAY ───────────────────
    //
    // FOUND BY THE FALSIFIER, run 2: `submitClaimFromJournal` opens with
    // `const { slug: _s, … } = payload` and never stores it — the column holds
    // the FULL id (`<by>/<slug>`, 006's "the 1.0 path identity") and the bare
    // one is discarded. 1.0's live mark carries both, and the collision guard
    // speaks the bare one back to the resident: `you already have a mark
    // "${clean.slug}"`. A port without it would refuse with `undefined` in the
    // sentence.
    //
    // Derived, not stored, and the derivation is 1.0's own — `idPartsOf`:
    //
    //   slug: record?.slug ?? (idRest.length ? idRest.join("/") : null)
    //
    // and it is unambiguous for the reason world-journal.mjs states at
    // MARKS_PREFIX: "The office's slug grammar is `^[a-z0-9][a-z0-9-]*$`
    // (world.mjs), so an id is exactly two segments and this join is
    // unambiguous."
    slug: declared.slug ?? String(id).split("/").slice(1).join("/") ?? null,
    ...(geometry.at ? { at: geometry.at } : {}),
    ...(geometry.extent ? { extent: geometry.extent } : {}),
    ...(geometry.points ? { points: geometry.points } : {}),
    ...(row.body == null ? {} : { body: row.body }),
    kind: declared.kind ?? row.class,
    ...(row.stake ? { stamps: row.stake } : {}),
    ...(row.status === "pending" ? { put_forward: true } : {}),
  };

  return {
    mark: {
      ...liveMarkShape(id, payload, {
        household: row.household ?? null,
        seq: _journal_seq == null ? null : Number(_journal_seq),
      }),
      // 2.0's own identity for the row, which 1.0 has no field for. Named with
      // the store it comes from so nothing reads it as a mark's own id.
      claim_id: row.id,
      claim_status: row.status,
    },
  };
}

/**
 * Rows → live-mark records, with the refusals named.
 *
 * `strict` throws on any refusal, which is the default and the whole point: a
 * guard that ran over a store it could not fully read and permitted the write
 * anyway is the states-with-no-receipt class aimed directly at the record.
 */
export function liveMarkRecords(rows, { strict = true } = {}) {
  const marks = [];
  const refusals = [];
  for (const row of rows) {
    const r = liveMarkOf(row);
    if (r.refused) { refusals.push(r.reason); continue; }
    marks.push(r.mark);
  }
  if (strict && refusals.length) {
    throw new Error(
      `${refusals.length} live claim(s) cannot be read as marks, e.g.\n  ${refusals[0]}\n` +
      `A guard that skipped them would PERMIT wrongly — a duplicate slug or a parcel past the cap, ` +
      `with nothing on any page to show for it.`);
  }
  return { marks, refusals };
}

/**
 * world-journal.mjs `liveMarks`, over `claims`.
 *
 * `client` MUST be a pg client, not a pool, and MUST already be inside a
 * transaction that declared `app.household` when `household` is named — see
 * § THE RLS CONTRACT below. `assertHouseholdDeclared` enforces it rather than
 * documenting it.
 *
 * ── THE RLS CONTRACT, AND WHY THIS REFUSES INSTEAD OF ASKING ────────────────
 *
 * 007's row policy is the reason:
 *
 *   "a public read compares against NULL, which is never equal to anything, and
 *    sees none."
 *
 * That is exactly right for the notary and exactly LETHAL for a guard. A slug
 * collision check that ran outside `withHousehold` would see the household's
 * pending claims and none of its drafts, find no collision, and permit a second
 * `the-lamp` — with every policy in 007 working as written and nothing anywhere
 * saying the answer was partial. The row policy converts a leak into a silent
 * PERMIT the moment the reader is a guard rather than an exporter.
 *
 * So this function will not run a household-scoped read on a connection that has
 * not said whose household is asking. It is one round trip and it turns 007's
 * quietest failure into a refusal with a name — the founder's refuse-not-degrade
 * ruling, applied to a read.
 *
 * `household: null` is the CROSS-HOUSEHOLD read (1.0's `liveMarks(db, {household:
 * undefined})`, what `worldForStances` and the drain want). It does NOT assert,
 * because there is no single household to declare — and it comes back
 * STRUCTURALLY NARROWER than 1.0's answer by exactly the drafts of every other
 * household. That is a finding, not a bug in this function, and
 * `DISCLOSURES.cross_household` is what the door has to say about it.
 */
export async function pgLiveMarks(client, { household = null, statuses = LIVE_STATUSES, strict = true, keys: given = null } = {}) {
  // `given` is the set a CALLER already asserted on this same connection — one
  // round trip instead of two, and never a way to supply a set that was not
  // checked: `pgDraftsForKey` is the only caller that passes it and it passes
  // `assertHouseholdDeclared`'s own return value.
  const keys = household == null ? null : (given ?? await assertHouseholdDeclared(client, household));
  const where = ["status = ANY($1)"];
  const args = [statuses];
  // `= ANY(keys)`, and the keys are the connection's own declared set — the
  // array `024_household_spellings.sql`'s policy is comparing against, handed
  // back by the assertion above. A house's rows keep the spelling they were
  // written under forever, so a guard that asked for one spelling would see
  // part of a house and PERMIT on the rest of it.
  if (household != null) { where.push(`household = ANY($${args.length + 1})`); args.push(keys); }
  // ORDER BY slug, and it is not decoration: 1.0's `liveMarks` returns Map
  // insertion order, which is journal order, which nothing downstream depends on
  // — but a comparison does, and an unordered read makes a diff report row moves
  // as differences. Sorting by the identity is the one order both sides can hold.
  const { rows } = await client.query(`${LIVE_CLAIM_SELECT} WHERE ${where.join(" AND ")} ORDER BY slug`, args);
  return liveMarkRecords(rows, { strict });
}

/**
 * world-journal.mjs `liveChildrenOf`, over `claims`, verbatim in its own words:
 *
 *   "Whether the household's live layer holds a mark that names `id` as its
 *    parent — the store's answer to `holdsChildren`, which used to be a
 *    directory listing."
 *
 * 1.0 filters the whole live layer in JS. This does the same rather than pushing
 * `data->>'parent_id' = $n` into SQL, deliberately: the predicate must be the
 * SAME predicate, and `parent_id` in `data` may be absent, null, or a string,
 * which `=` in SQL and `===` in JS do not agree about. One filter, in the
 * language 1.0 wrote it in.
 */
export async function pgLiveChildrenOf(client, id, opts = {}) {
  const { marks, refusals } = await pgLiveMarks(client, opts);
  return { children: marks.filter((m) => m.parent_id === id), refusals };
}

/**
 * THE RLS ASSERTION. Refuses when the connection has not declared the household
 * this read is scoped to.
 *
 * `current_setting(…, true)` returns NULL rather than raising when unset, which
 * is the same call 007's policy makes — so this asks the policy's own question
 * and gets the policy's own answer, instead of a second notion of "declared".
 */
/**
 * ── IT ASSERTS BOTH SETTINGS NOW, AND RETURNS THE SET ───────────────────────
 *
 * `024_household_spellings.sql` made the draft policies compare against
 * `app.household_keys` — every spelling this house has ever carried — because
 * the store never re-spells a row (three guards refuse it; see 022's retirement
 * header). So a connection that declared only `app.household` would now be read
 * by a policy that looks at NOTHING, and this file's whole argument applies with
 * more force than it did at one key: the guard sees no drafts at all, finds no
 * collision, and PERMITS A DUPLICATE.
 *
 * The set must also CONTAIN the household the read is scoped to. A set that did
 * not would be a session declaring one house and reading under another's names.
 *
 * It RETURNS the array so `pgLiveMarks` filters on exactly the value the policy
 * is comparing against, in the same round trip. Two notions of "this house"
 * inside one function is the drift `household-deriver.mjs` exists to have ended.
 */
export async function assertHouseholdDeclared(client, household) {
  const { rows: [r] } = await client.query(
    `SELECT current_setting('app.household', true) AS declared,
            string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',') AS keys`);
  const declared = r?.declared ?? null;
  const keys = Array.isArray(r?.keys) ? r.keys : null;
  const said = (v) => (v === null ? "(nothing)" : JSON.stringify(v));

  if (declared !== household)
    throw new Error(
      `guard-reads: this connection has declared app.household = ${said(declared)}, ` +
      `and the read is scoped to ${JSON.stringify(household)}. 007's row policy would answer WITHOUT this household's ` +
      `drafts and say nothing about it — a slug-collision guard would then permit a duplicate, and a parcel cap would ` +
      `undercount. Run this inside world2-claims.mjs's withHousehold(pool, household, …).`);

  if (!keys?.length)
    throw new Error(
      `guard-reads: this connection declared app.household = ${said(declared)} and app.household_keys = ${said(keys)}. ` +
      `024_household_spellings.sql's policies compare against the SECOND one, so a draft row is unreadable here and a ` +
      `guard would permit a duplicate slug or a parcel past the cap. withHousehold and officeWrite declare both; ` +
      `a connection that declared only the first is running against the pre-024 office.`);

  if (!keys.includes(household))
    throw new Error(
      `guard-reads: this connection declared app.household = ${said(declared)}, which is not in its own ` +
      `app.household_keys ${said(keys)}. The set is every spelling of ONE house and must contain the house it is ` +
      `scoped to (src/household-deriver.mjs § sessionKeysFor puts it first) — these two settings are describing ` +
      `two different households.`);

  return keys;
}

// ═════════════════════════════════════════════════════════════════════════════
// THE DRAFT OVERLAY — `draftsForKey`'s journal half, over `claims` + `acts`
// ═════════════════════════════════════════════════════════════════════════════
//
// ── THE DELETED ARM IS NOT IN `claims`, AND THAT IS THE FINDING ─────────────
//
// `replayDrafts` produces three statuses, and only two of them have a `claims`
// source:
//
//   added      a live declaration canon does not hold      → a live claim
//   modified   a live declaration canon DOES hold          → a live claim
//   deleted    a WITHDRAWAL of a mark canon holds          → nothing at all
//
// The third one is worth reading twice. `submitClaimFromJournal`'s withdraw arm
// has two outcomes — DELETE a draft, UPDATE a pending row to `retracted` — and
// its own comment rules on the third case:
//
//   "rowCount 0 is lawful: withdrawing a PUBLISHED 1.0 mark has no pending
//    claim to retract — that lane is the settlement unpublish, not the docket."
//
// Lawful for the DOCKET and fatal for this read. 1.0's overlay draws the mark
// the household is proposing to remove ("Without these two the journal would
// hand the viewer an empty grey rectangle where the git path hands it the mark
// the resident is removing"), and after a published-mark withdrawal `claims`
// holds no row of any status to draw it from.
//
// It is not lost — the withdraw ACT mirrors (world-journal.mjs's deferral is
// narrow: "ONLY an unstaked mark-class declaration defers … withdrawals of
// public marks … mirror exactly as before"). So the deleted arm's source is
// `acts`, and this port reads it there.
//
// ── AND ITS SCOPE, WHICH `acts` DOES NOT SUPPLY ────────────────────────────
//
// The journal TRUNCATES at every drain; `acts` is append-only and truncates
// never. So "every withdraw act" is every withdrawal since the seed, and an
// overlay built from it would keep showing a mark deleted three settlements ago.
//
// The scope is the mark's own life, not the log's: a withdrawal is live exactly
// while the mark it withdraws still STANDS in `marks`. Once the settlement
// retires it, canon agrees with the household and there is nothing left to
// propose. That is self-limiting, needs no cursor, and matches 1.0's `if
// (!published) continue` on the other side of the same branch.
//
// ── AND THE HOUSEHOLD IT IS SCOPED BY, WHICH IS NOT `acts.household` ────────
//
// FOUND BY THIS LANE'S FALSIFIER, 2026-08-28, and it is a defect in the store
// rather than in this read: `acts.household` and `claims.household` carry the
// SAME FACT IN TWO SPELLINGS.
//
//   acts.household     'darko'  ×12  — every live-written act; NULL on all 2925
//                                      seeded ones (STATE/log states none)
//   claims.household   'gh:67605380', 'solo:the-town', … — the RESOLVED KEY,
//                                      per Wright's 2026-08-28 ruling
//
// The docket pen was corrected to the key ("adopt 1.0's spelling … a roster
// owner keeps the household KEY") and the acts mirror was not — `mirrorAct`
// writes `row.household` verbatim, and `row.household` is
// `resolvedWorldHousehold(key)`, which is the office key's NAME. So an overlay
// that filtered `claims` by the key and `acts` by the same string would return
// the added/modified marks and NONE of the deleted ones, silently, for every
// household in town.
//
// This read goes through `identities` instead, which is the projection that
// DEFINES the handle → key mapping and the one `householdKeyFor` reads to write
// the claim. Asking it here is asking the same question the write asked, so the
// two cannot come apart the way the two columns have. `journalHousehold`
// optionally widens it for the registry-lag case the fold names — "registry lag
// never blocks a new resident, it only leaves them ungrouped" — where a handle
// has acts but no roster line yet.
//
// ── AND `identities.household` IS ITSELF SPELLED TWO WAYS ───────────────────
//
// The paragraph above is now true one hop further in. `identities.household` is
// a projection of the WORLD repo's copy of the town's pins, and it carries
// whatever spelling that copy happened to hold when each row landed: measured
// 2026-09-22 on the live registry, 173 of 190 handles wore `gh:<id>` and 17
// wore `hh:<slug>`, and umbraliminalis wore BOTH AT ONCE because a ledger re-key
// had reached its first resident and not its other seven. So `household = $1`
// against a `hh:`-keyed session returned two of that house's eight residents,
// and the overlay lost the other six's withdrawals with nothing to say so.
//
// `= ANY($1)` is the spelling set — the same one 024's policy compares against.
// The store does not re-spell `identities` either: `law_ingester` owns every row
// of it, which is POS-160's second STOP and not this ship's.
export const WITHDRAW_ACT_SELECT =
  `SELECT a.id, a.at, a.actor, a.object, a.household, a.payload
     FROM acts a
    WHERE a.class = 'mark' AND a.action = 'withdraw'
      AND (a.actor IN (SELECT handle FROM identities WHERE household = ANY($1))
           OR (COALESCE(array_length($2::text[], 1), 0) > 0 AND a.household = ANY($2)))`;

/**
 * `draftsForKey`'s JOURNAL HALF, over 2.0's stores.
 *
 * Returns the `{ marks, counts }` shape `replayDrafts` returns, so a caller can
 * union it with whatever else it holds exactly as `draftsForKey` does today.
 *
 * ── THE INJECTED THREE, AND WHY THEY ARE NOT WRITTEN HERE ──────────────────
 *
 *   `pathFor`            world-journal.mjs's filing rule — gates A and B, the
 *                        parent chain, the root fallback. Sixty lines of a
 *                        decision this file has no business re-deciding.
 *   `publishedPathOf`    the frozen filing manifest + the tree index. It reads
 *                        GIT, at a sha. There is no 2.0 surface for it and there
 *                        will not be one.
 *   `publishedMarkOf`    canon's copy of a mark, for a withdrawal to draw.
 *                        `marks` answers this one — `publishedMarkFrom` below
 *                        builds it — but it is still injected, so a caller
 *                        holding a richer canon can pass its own.
 *
 * With none of them supplied, `path` is `null` on every row and
 * `DISCLOSURES.filing` says so. A guessed path would be worse than a null one:
 * gate A refuses a mark filed at the wrong place at the next lint, so a guess
 * would turn a missing field into a refused settlement.
 */
export async function pgDraftsForKey(client, {
  household,
  journalHousehold = null,
  publishedIds = new Set(),
  publishedPathOf = null,
  publishedMarkOf = null,
  pathFor = null,
  strict = true,
} = {}) {
  if (household == null) throw new Error("pgDraftsForKey: a draft overlay is one household's own — pass household");
  // The connection's own declared spelling set, asserted before anything reads
  // a row (`assertHouseholdDeclared` returns it). Both arms below take it, so
  // the live half and the deleted half are scoped to the SAME house by the same
  // array, which is what they came apart over the first time.
  const keys = await assertHouseholdDeclared(client, household);
  const { marks: live, refusals } = await pgLiveMarks(client, { household, strict, keys });

  const pathOf = (record) => {
    if (typeof pathFor !== "function") return null;
    try { return pathFor(record, { publishedPathOf, parentPathOf: parentPathOfFrom(live, publishedPathOf) }); }
    catch { return null; }
  };

  const out = [];
  for (const m of live) {
    const published = publishedIds.has(m.id);
    out.push({
      status: published ? "modified" : "added",
      path: pathOf({ ...m, id: m.id }),
      ...overlayShape(m.id, m, null),
    });
  }

  // THE DELETED ARM. Scoped to withdrawals whose mark still stands in canon —
  // see § THE DELETED ARM above for why the scope is canon's and not the log's.
  //
  // $1 is the SPELLING SET (the roster is keyed in whichever spelling the world
  // repo's copy carried — see WITHDRAW_ACT_SELECT § AND `identities.household`).
  // $2 stays the ONE 1.0 household NAME, wrapped, and is deliberately NOT
  // widened: `acts.household` carries the office key's name, a different
  // namespace from the roster's keys, and the deriver has no spelling set for
  // it. `[]` is the old `$2::text IS NOT NULL` false arm, exactly.
  const { rows: withdrawn } = await client.query(
    `${WITHDRAW_ACT_SELECT} ORDER BY a.id`,
    [keys, journalHousehold == null ? [] : [journalHousehold]]);
  const seen = new Set(out.map((m) => m.id));
  for (const act of withdrawn) {
    const id = act.object ?? (act.payload?.by && act.payload?.slug ? `${act.payload.by}/${act.payload.slug}` : null);
    if (!id || seen.has(id)) continue;
    if (!publishedIds.has(id)) continue;   // never crossed → 1.0's `if (!published) continue`, verbatim
    seen.add(id);
    const canon = typeof publishedMarkOf === "function" ? publishedMarkOf(id) : null;
    const path = typeof publishedPathOf === "function" ? publishedPathOf(id) : null;
    out.push({
      status: "deleted",
      path: path ?? pathOf({ ...(canon ?? {}), id }),
      ...overlayShape(id, canon ?? {}, canon),
    });
  }

  out.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  return {
    marks: out,
    counts: {
      added: out.filter((m) => m.status === "added").length,
      modified: out.filter((m) => m.status === "modified").length,
      deleted: out.filter((m) => m.status === "deleted").length,
    },
    refusals,
  };
}

/**
 * world-journal.mjs `markShape`, ported — "One journal row as §1c's viewer reads
 * a mark."
 *
 * `tier: "market"` is carried because 1.0 carries it, and 1.0's reason applies
 * unchanged: it "is not a default invented here — it is what the git path yields
 * for every mark written since 2026-08-13, because the door refuses `tier:` as a
 * field". 2.0 holds no tier on a claim for the same reason, so the same word is
 * reported and the overlay renders identically across the flag.
 *
 * `date` falls back to the CLAIM's own composition stamp where the journal used
 * `row.written_at`. Both are "when this declaration was made"; the claim's is
 * rewritten on every compose, which is what latest-wins means on a row.
 *
 * ── `claim_status` AND `household` RIDE THROUGH (2026-09-07, lane-a / R3) ───
 *
 * `liveMarkOf` above puts both on every record it builds, and this shape threw
 * them away — so a PRIVATE draft and a claim standing PUBLICLY on the docket
 * with a stamp behind it arrived at `read: "leave-mark"` under one word,
 * `drafts`, and one delta status, `added`. The 2026-09-06 resident walk read
 * eighteen rows under that one word and could not tell which of them anyone
 * else could see: *"either the town leaks, or the word 'draft' means something
 * I was not told."*
 *
 * The store knew the whole time. Two fields, already selected, already on the
 * record, dropped one function before the door. They are ADDITIVE — every
 * existing key keeps its meaning and its value — and `world.mjs § worldMyMarks`
 * is what splits the list on them.
 */
function overlayShape(id, m, canon = null) {
  const points = m.points ?? canon?.points ?? null;
  return {
    id,
    by: m.by ?? canon?.by ?? String(id).split("/")[0] ?? null,
    kind: m.kind ?? canon?.kind ?? null,
    tier: "market",
    body: String(m.body ?? canon?.body ?? "").trim(),
    date: m.date ?? canon?.date ?? null,
    at: m.at ?? canon?.at ?? null,
    extent: m.extent ?? canon?.extent ?? null,
    ...(points ? { points } : {}),
    ...(m.claim_status ? { claim_status: m.claim_status } : {}),
    ...(m.household ? { household: m.household } : {}),
  };
}

/**
 * `replayDrafts`'s `parentPathOf`, ported — the parent's directory, from the
 * live layer first and canon second:
 *
 *   "parentPathOf: (pid) => { const p = latest.get(pid); const ppath = p && …
 *      ? pathFor(…) : (publishedPathOf ? publishedPathOf(pid) : null);
 *      return ppath ? ppath.replace(/\/mark\.md$/, "") : null; }"
 */
function parentPathOfFrom(live, publishedPathOf) {
  const byId = new Map(live.map((m) => [m.id, m]));
  return (pid) => {
    const p = byId.get(pid);
    const ppath = p ? null : (typeof publishedPathOf === "function" ? publishedPathOf(pid) : null);
    return ppath ? ppath.replace(/\/mark\.md$/, "") : (p ? `WORLD/marks/${p.by}/${String(pid).split("/").slice(1).join("/")}` : null);
  };
}

/** Canon's ids, as the overlay's added-vs-modified gate wants them. One plain SELECT; no port. */
export async function publishedIdsFrom(client) {
  const { rows } = await client.query("SELECT slug FROM marks WHERE status = 'standing'");
  return new Set(rows.map((r) => r.slug));
}

/** Canon's copy of a mark, for a withdrawal to draw. `publishedMarkOf`'s 2.0 source. */
export async function publishedMarkFrom(client) {
  const { rows } = await client.query(
    "SELECT slug, kind, owner, body, geometry FROM marks WHERE status = 'standing'");
  const byId = new Map(rows.map((r) => [r.slug, {
    id: r.slug, by: r.owner, kind: r.kind, body: r.body,
    at: r.geometry?.at ?? null, extent: r.geometry?.extent ?? null,
    ...(r.geometry?.points ? { points: r.geometry.points } : {}),
  }]));
  return (id) => byId.get(id) ?? null;
}

// ═════════════════════════════════════════════════════════════════════════════
// HOLDING — `attachments` over `acts`, in two eras
// ═════════════════════════════════════════════════════════════════════════════
//
// ── THE TWO ERAS, WHICH IS WHERE THIS PORT GOES WRONG ───────────────────────
//
// | era | how identified | payload | source of the mapping |
// |---|---|---|---|
// | `legacy` | `action = 'legacy:attachment'` | the STATE/log event: `{at, seq, type:"attachment", actor, payload:{policy, target, declared_by}}` | dynamic-rebuild.mjs `attachmentsFromState`, and crossing-save.mjs's own writer of that line |
// | `live`   | `action ∈ (give, drop, take)`, class `holding` | mirrorLaneAct's own: `{thing, holder, previous_holder, made_by, policy}` | world-hold.mjs § mirrorHoldingAct |
//
// **THE `actor` COLUMN MEANS DIFFERENT THINGS IN THE TWO ERAS, and that is the
// trap this whole section exists to not fall into.** In the legacy era the log
// event's `actor` is the ENTITY — crossing-save writes `actor: a.entity` — so
// the holder rides the actor column. In the live era `mirrorLaneAct` is called
// with `actor: did.declared_by`, so the actor is the DECLARER and the entity is
// in the payload. A port that read `acts.actor` as the entity in both would hand
// every given thing back to the giver.
//
// The live era's entity is `payload.holder ?? acts.actor`, and that is exact for
// all three faces rather than a fallback that happens to work. `declareHolding`:
//
//   const entity = act === "drop" ? actor : (act === "take" ? actor : to);
//   …
//   holder: act === "drop" ? null : entity,
//
// so `holder` IS the entity for give and take, and `null` for drop — whose
// entity is the actor. One expression covers the three because the record was
// written by one expression.
//
// ── COVERAGE, MEASURED (2026-08-28) ────────────────────────────────────────
//
// The brief asked for this honestly, so it is measured rather than assumed:
//
//   43   `legacy:attachment` acts on `world2_dev`
//   43   attachment events in the world repo's STATE/log at `settlement/S47`
//        (= `sandbox/seed`, what the seed read) AND at `settlement/S50`
//   43   attachments in STATE/snapshot/150's boundary — the whole table, saved
//    0   rows in `/srv/world2-lab/office/dynamic.db` `attachments`
//    0   rows in `/srv/postmark-office-dev/dynamic.db` `attachments`
//    0   `give`/`drop`/`take` acts (the live mirror shipped 2026-08-28; nothing
//        has been picked up since)
//
// So `acts` holds the COMPLETE holdings record and the 1.0 stores on this box
// hold none of it. That inverts the usual disclosure: the coverage gap is not in
// `acts`, it is in the sqlite side, and the equality falsifier therefore cannot
// use a live `attachments` table as its oracle. It rebuilds one with 1.0's own
// `attachmentsFromState` + `declareAttachment` instead — the same chain
// `dynamic-rebuild.mjs` runs — which is 1.0's own recovery covenant, and the
// covenant is exactly the claim under test. `DISCLOSURES.holdings_source` says
// this on every answer.

export const ATTACHMENT_ACTIONS = Object.freeze(["legacy:attachment", "give", "drop", "take"]);

/**
 * The ORDER clause every holder read must carry.
 *
 * `readAttachments` is `ORDER BY born_at, seq`, and `liveHolder` is "the last
 * row" over it. So the order IS the answer — get it wrong and a thing goes to
 * the wrong resident with no symptom anywhere, which is why this is a constant
 * with `assertAttachmentOrder` behind it rather than a clause each caller types.
 *
 * `born_at` is `payload->>'at'` in the legacy era and `acts.at` in the live one.
 * Both are ISO-8601 UTC to the millisecond, so a text comparison of the legacy
 * stamp and a timestamptz comparison of the live one order the same way — but
 * only if they are compared as ONE expression, which is why the COALESCE is in
 * the ORDER BY and not left to two clauses.
 *
 * THE TIEBREAK IS TWO-PART, and the second part is not decoration. `seq` is
 * sqlite's autoincrement and only the legacy era has one; `acts.id` is Postgres's
 * and only orders the live era's rows against each other. Ordering by era first
 * makes each tiebreak apply where it means something. Measured on `world2_dev`
 * 2026-08-28: 43 rows, 43 DISTINCT `born_at`, seq 1…43 contiguous — so there is
 * no tie to break today, which is exactly when a tiebreak is cheapest to get
 * right and impossible to notice getting wrong.
 */
export const ATTACHMENT_ORDER_SQL =
  `ORDER BY COALESCE((payload->>'at')::timestamptz, acts.at),
            (action <> 'legacy:attachment'),
            COALESCE((payload->>'seq')::bigint, acts.id)`;

/**
 * One `acts` row → one `attachments` row, whichever pen wrote it.
 *
 * Returns `{ row, era }` or `{ refused, reason }`.
 */
export function attachmentRowOf(act) {
  const p = act?.payload;
  if (!p || typeof p !== "object") {
    return { refused: true, reason: `act ${act?.id} carries no payload object` };
  }

  // ERA 1 — the frozen record. dynamic-rebuild.mjs `attachmentsFromState`, the
  // event → row line, verbatim:
  //
  //   const a = { entity: ev.actor, target: ev.payload.target,
  //               policy: ev.payload.policy, declared_by: ev.payload.declared_by,
  //               born_at: ev.at };
  //
  // The act's payload IS `ev` (seed-import stores the whole jsonl row), so this
  // is that line with `ev` spelled `p`, and `seq` — which the log carries and
  // `attachmentsFromState` drops — kept, because `readAttachments` orders by it.
  if (act.action === "legacy:attachment" || p.type === "attachment") {
    const inner = p.payload;
    if (!inner || typeof inner !== "object" || !inner.target) {
      return { refused: true, reason: `act ${act.id} is a legacy attachment with no inner target — nothing to hold` };
    }
    if (!p.at) {
      return { refused: true, reason: `act ${act.id} is a legacy attachment with no born_at — latest-wins has nothing to order it by` };
    }
    return {
      era: "legacy",
      row: {
        seq: p.seq == null ? null : Number(p.seq),
        entity: p.actor ?? act.actor,
        target: inner.target,
        policy: inner.policy,
        declared_by: inner.declared_by ?? p.actor ?? act.actor,
        born_at: p.at,
      },
    };
  }

  // ERA 2 — the live pen. world-hold.mjs `mirrorHoldingAct`'s payload, read with
  // `declareHolding`'s own expression for the entity (§ THE TWO ERAS above).
  if (["give", "drop", "take"].includes(act.action)) {
    if (!p.thing) {
      return { refused: true, reason: `act ${act.id} is a ${act.action} naming no thing` };
    }
    const bornAt = isoOf(act.at);
    if (!bornAt) {
      return { refused: true, reason: `act ${act.id} is a ${act.action} with no stamp — "latest wins" has nothing to order it by` };
    }
    return {
      era: "live",
      row: {
        // No sqlite seq exists for a live act and none is invented. `acts.id` is
        // the row's order within its era and `ATTACHMENT_ORDER_SQL` uses it
        // there; putting it in `seq` would make it comparable to a sqlite
        // autoincrement, which it is not.
        seq: null,
        act_id: String(act.id),
        entity: p.holder ?? act.actor,
        target: p.thing,
        policy: p.policy,
        declared_by: act.actor,
        born_at: bornAt,
      },
    };
  }

  return { refused: true, reason:
    `act ${act.id} (${act.action}) matches no holding era — keys: ${Object.keys(p).join(",")}. ` +
    `Two pens are known (the frozen STATE/log record, and mirrorLaneAct's give/drop/take); a third has ` +
    `written here and this derivation must learn it deliberately rather than guess.` };
}

const isoOf = (v) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

/**
 * Rows → `readAttachments`' output, in `readAttachments`' order.
 *
 * `rows` MUST already be ordered by `ATTACHMENT_ORDER_SQL`; that is asserted
 * rather than assumed, for the reason at the constant.
 */
export function attachmentRecords(rows, { strict = true } = {}) {
  assertAttachmentOrder(rows);
  const out = [];
  const refusals = [];
  const eras = { legacy: 0, live: 0 };
  for (const row of rows) {
    const r = attachmentRowOf(row);
    if (r.refused) { refusals.push(r.reason); continue; }
    eras[r.era] += 1;
    out.push({ ...r.row, era: r.era });
  }
  if (strict && refusals.length) {
    throw new Error(
      `${refusals.length} holding act(s) match no known era, e.g.\n  ${refusals[0]}\n` +
      `A holder check that skipped them would answer with the WRONG RESIDENT holding a thing, which is the ` +
      `one answer this door exists to get right.`);
  }
  return { rows: out, refusals, eras };
}

/**
 * The order guard. `born_at` must ascend, and the legacy era must not follow the
 * live one — which is what keeps each era's own tiebreak meaningful.
 */
export function assertAttachmentOrder(rows) {
  let last = null;
  let sawLive = false;
  for (const row of rows) {
    const legacy = row?.action === "legacy:attachment" || row?.payload?.type === "attachment";
    if (legacy && sawLive) {
      throw new Error(
        `holding rows are not in the record's order: a frozen-era act (${row.id}) follows a live one. ` +
        `Query with guard-reads.ATTACHMENT_ORDER_SQL — "latest wins" is the whole rule and an ORDER BY id ` +
        `would hand a thing to whoever the seed happened to insert last.`);
    }
    if (!legacy) sawLive = true;
    const born = legacy ? row?.payload?.at : isoOf(row?.at);
    const t = born == null ? NaN : Date.parse(born);
    if (Number.isFinite(t)) {
      if (last != null && t < last) {
        throw new Error(`holding rows are not born_at-ascending (${born} after ${new Date(last).toISOString()}) — see ATTACHMENT_ORDER_SQL`);
      }
      last = t;
    }
  }
}

/**
 * `readAttachments`, over `acts`.
 *
 * The whole record by default, because that is what `readAttachments(db)` hands
 * `liveHolder` — and narrowing it to one target would change the answer, not
 * just the cost: `liveHolder` reads the last row FOR THAT TARGET, so a filtered
 * read is safe, while a filtered read that also dropped the order would not be.
 * `target` is offered and pushed into SQL for that reason and no other.
 */
export async function pgAttachmentsFor(client, { target = null, until = null, strict = true } = {}) {
  const args = [ATTACHMENT_ACTIONS];
  let sql = `SELECT id, at, actor, action, payload FROM acts WHERE action = ANY($1)`;
  if (target != null) {
    args.push(target);
    sql += ` AND COALESCE(payload->'payload'->>'target', payload->>'thing') = $${args.length}`;
  }
  const { rows } = await client.query(`${sql} ${ATTACHMENT_ORDER_SQL}`, args);
  const read = attachmentRecords(rows, { strict });
  // `readAttachments`' own `until`, verbatim: `rows.filter((a) => Date.parse(a.born_at) <= until)`.
  return until == null ? read : { ...read, rows: read.rows.filter((a) => Date.parse(a.born_at) <= until) };
}

// ── THE HOLDING JOURNAL, over `acts` (POS-162) ──────────────────────────────
//
// `readJournal(db, { cls: "holding" })` is the OTHER half of what a holder
// question needs, and the two are not the same read. The attachments half above
// answers WHO HOLDS IT; this one answers WHERE IT WAS SET DOWN — world-hold.mjs
// § latestDrop reads a `drop` act's witnessed line, and the-town/the-reach makes
// that position canon at the next fold rather than a fall-back to the last place
// the thing was folded.
//
// ⚑ THE ANCHOR IS THREE COLUMNS, NOT A PAYLOAD KEY, and this is the fact the
// port has to carry. A journal row's witnessed line is stored as
// `at_anchor / at_dx / at_dy` (world-journal.mjs § ROW_COLUMNS) and `hydrateRow`
// reassembles it into the one `at` field the ruling named. `holdingEntry`'s
// payload is `{thing, holder, previous_holder, made_by, policy}` and has never
// carried the line at all. `acts` holds the SAME three columns
// (001_tables.sql § acts), written by both pens — `mirrorAct` and `insertAct`
// name them in their INSERT lists — so the composition here is `hydrateRow`'s
// own expression and not a second reading of a payload.
//
// ⚑ THE ORDER IS `(at, id)` AND NOT `journal_seq`. 001's own words call
// `journal_seq` the shadow-era pairing key that dies at cutover, and a flipped
// lane writes Postgres FIRST — so at insert there is no sqlite rowid to carry
// and the column is null on exactly the rows a flipped town writes. D6 ruled
// replay order is `(at, id)`; ordering a holding read by a pairing key would put
// a town's own set-downs last, or nowhere.
//
// ⚑ THE PREDICATE IS `class`, BECAUSE THAT IS THE PREDICATE. `readJournal`'s
// `cls` filter is `class = ?` and nothing narrower; an `action IN (…)` filter
// here would be a DIFFERENT predicate wearing this one's name, and it would
// silently drop the first holding verb somebody adds.
//
// SECOND READER OF THIS CLASS, said out loud so POS-153 can share it:
// `world-hold.mjs § readHoldEffects` reads the same `class = 'holding'` rows out
// of sqlite for a different question (the effects shelf, scoped by handle rather
// than by thing). When that one ports, it wants this function with the `thing`
// narrowing dropped and a handle filter in its place — not a second query.

/**
 * `readJournal(db, { cls: "holding" })` for ONE thing, oldest first, over `acts`.
 *
 * One line over `pgHoldingRows` (POS-153 folded the two into one reader). It
 * keeps the `{ rows }` envelope its own caller and suite were written against;
 * the shared reader answers a bare array, because that is the shape
 * `readJournal` itself answers.
 */
export async function pgHoldingRowsFor(client, thingId) {
  return { rows: await pgHoldingRows(client, { thing: thingId }) };
}

/** The class name `readJournal` is asked for — 1.0's own constant, restated here because the port imports nothing from `src/`. */
export const CLASS_HOLDING = "holding";

/**
 * One `acts` row in `hydrateRow`'s vocabulary.
 *
 * `seq` IS THE ACT'S OWN ID, AND IT IS A DIFFERENT REGISTRY'S COUNTER. 1.0 put
 * the sqlite journal rowid here and the door hands it on as `act_seq`. The
 * record that answers now is `acts`, so the honest line number is `acts.id`;
 * carrying null instead would dim a field that has an answer. Nothing in the
 * office reads `act_seq` — it is a receipt a resident reads — so this changes
 * which registry the number comes from and no derivation anywhere.
 *
 * NOT COMPARABLE TO A sqlite SEQ, which is why it is never used as an ORDER key
 * here (`attachmentRowOf` refuses it in `seq` for exactly that reason, and it is
 * right: there the field feeds `ATTACHMENT_ORDER_SQL`). The ordering above is
 * done in SQL; this field is carried into the answer and read by nobody else.
 *
 * ── THE FIELD SET IS `hydrateRow`'s WHOLE ONE (POS-153) ──────────────────────
 *
 * This mapper served one caller when it was written — the stands block, which
 * reads `object`, `action`, `at`, `actor` and `seq`. The effects shelf is the
 * second caller and it reads THREE MORE: `crossing` is the filter
 * `holdEffectsFrom` narrows by, and `written_at` is put straight into the event
 * a resident reads. So the columns below are `hydrateRow`'s complete set rather
 * than the first caller's, and the SELECT carries them; a mapper narrowed to its
 * first consumer is a mapper the second one has to widen, which is how a second
 * copy gets born.
 *
 * `witnesses` and `effect` are here for the same reason and are read by neither
 * caller today: they are columns `hydrateRow` returns, and a row that claims to
 * be a journal row and silently drops two of its fields is a shape that agrees
 * with nothing. A fixture that omits them (POS-162's `holdingAct` does) yields
 * null, which is what the journal answers for an unset column.
 *
 * `at` IS TEXT IN THE JOURNAL AND `timestamptz` IN `acts`, so the driver hands
 * back a Date where `holdEffectsFrom` puts `written_at` straight into its
 * answer. The one visible difference this port makes to any answer is precision:
 * the journal held the stamp exactly as the door wrote it (`…:16Z`), a Date
 * round-trips to milliseconds (`…:16.000Z`). Same instant, one more field of it.
 */
export const holdingRowOf = (r) => ({
  seq: r.id == null ? null : Number(r.id),
  crossing: r.crossing == null ? null : Number(r.crossing),
  actor: r.actor,
  action: r.action,
  object: r.object ?? null,
  at: { anchor: r.at_anchor ?? null, dx: r.at_dx ?? null, dy: r.at_dy ?? null },
  witnesses: jsonColumn(r.witnesses),
  class: r.class,
  // `acts.payload` is `jsonb`, so the driver hands back a PARSED OBJECT and
  // 1.0's `JSON.parse` line would throw on every row. The string arm is the
  // dead one here, kept only so a driver configured to hand over text does not
  // silently answer null; the null fallback is `hydrateRow`'s own (`parse(text,
  // null)`) and is parity, not a swallow — `whereThingStands` reads `object`,
  // `action`, `at`, `actor` and `seq`, and never this field.
  payload: jsonColumn(r.payload),
  effect: r.effect ?? null,
  household: r.household ?? null,
  written_at: r.at instanceof Date ? r.at.toISOString() : r.at == null ? null : String(r.at),
});

/**
 * A `jsonb` column as the derivations want it, whichever way the driver hands
 * it over — POS-162's expression, lifted out because two columns need it.
 *
 * The string arm is the dead one against today's driver and is kept so a store
 * migrated with a text column does not silently answer null; the null fallback
 * is `hydrateRow`'s own (`parse(text, null)`) and is parity, not a swallow.
 */
function jsonColumn(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(String(v)); } catch { return null; }
}

// ═════════════════════════════════════════════════════════════════════════════
// HOLDING, THE OTHER SHELF — `readJournal(db, { cls: "holding" })` over `acts`
// ═════════════════════════════════════════════════════════════════════════════
//
// The section above answers "who holds what" out of the ATTACHMENTS edge. This
// one answers a different question out of the same acts: what HAPPENED to a
// thing — the give/drop/take events themselves, in the journal's own row shape.
// Three 1.0 readers wanted it (POS-153): `groundWithinReach`'s set-down source,
// `whereThingStands`'s `latestDrop`, and the `since:` shelf's hold effects.
//
// ── WHY THIS IS NOT A LIKE-FOR-LIKE PORT — THE STORE HOLDS MORE ─────────────
//
// The sqlite journal's holding rows are a WINDOW, and a narrow one, for two
// independent reasons that compound:
//
//   1. UNFLIPPED, A HOLDING ACT TAKES NO JOURNAL ROW AT ALL. `declareHolding`
//      writes the `attachments` edge and `mirrorHoldingAct` calls
//      `mirrorLaneAct` → `mirrorAct` → INSERT INTO `acts`, and nothing else.
//      world-journal.mjs names this itself (§ THE LANE HOOK · "an act the
//      sqlite journal never held"): a SAY, a HOLDING and a movement-v2 WALK are
//      the three acts with no journal row. So every holding act written before
//      the hold lane's pen flipped is in `acts` and in no journal, ever.
//   2. FLIPPED, THE JOURNAL ROW IS A BEST-EFFORT COPY. `LANE_FLIPPED_AT.hold`
//      is 2026-09-03T18:58:05Z: since then `appendActFlipped` commits Postgres
//      FIRST and then writes the sqlite row, and a failure there is logged and
//      swallowed by design ("the record is already committed; the convenience
//      copy failed"). And `world-drain.mjs` truncates the journal at each drain.
//
// So reading `acts` is a widening, not a translation, and the readers that take
// it stop losing set-downs to the drain.
//
// ── THE ORDER IS `(at, id)`, AND `journal_seq` IS THE TRAP ──────────────────
//
// POS-152's finding, and it binds harder here: `hold` flipped BEFORE `frame`
// did, so every flipped-era holding row was written Postgres-first with no
// sqlite seq in hand — `journal_seq` is NULL for the whole live era by the
// write path's own design (world2-pen.mjs § `seq` IS NULL HERE, AND THAT IS THE
// POINT). Ordering by the column whose NAME says "the order" would sort the
// live era into one undefined heap. `(at, id)` is D6's ruled replay order.
//
// ── CLASS ONLY, NEVER AN ACTION LIST ────────────────────────────────────────
//
// `readJournal(db, { cls })` filters on the class column and nothing else, so
// this does too. An `action IN ('give','drop','take')` narrowing would read as
// harmless today and would silently DROP a fourth face the day the hold lane
// grows one — a narrowing the reader being replaced does not have. The frozen
// era cannot leak in through the class: `seed-import.mjs` files every imported
// event as `class = 'legacy'` ("one word that is in neither census keeps 2,400
// imported rows from voting in a vocabulary they predate"), so a
// `legacy:attachment` act is invisible here and reaches `liveHolder` through
// `pgAttachmentsFor` above, where its own era mapping is written.

/** `readJournal`'s order, in the store's terms. NEVER `journal_seq` (§ above).
 *  The class word itself is `CLASS_HOLDING` above — one constant, not two. */
export const HOLDING_ORDER_SQL = "ORDER BY acts.at, acts.id";

/**
 * `readJournal(db, { cls: "holding" })`, over `acts`. Oldest first.
 *
 * `since` / `until` are CROSSING bounds and both are optional. They exist
 * because the `since:` shelf already narrows by crossing in JS
 * (`holdEffectsFrom`: `c < sinceCrossing || c > nowCrossing` → skip), and
 * pushing a bound it is going to apply anyway costs one clause and saves the
 * whole frozen prefix.
 *
 * ⚑ A BOUND IS PUSHED ONLY WHEN IT IS A FINITE NUMBER, and that is not defensive
 * typing — it is the equality. `holdEffectsFrom` is called with `sinceCrossing`
 * UNDEFINED on every read that carries no cursor, and `c < undefined` is false,
 * so an undefined bound filters NOTHING there. `crossing >= NULL` in SQL matches
 * nothing at all. The two would disagree completely on the commonest call, so
 * the guard is what makes the narrowed read and the unnarrowed one the same
 * answer. The JS filter still runs afterwards and is still the one that decides.
 *
 * A row with a NULL crossing is dropped by a bound here and by
 * `holdEffectsFrom`'s own `c == null` line there — but only the unbounded read
 * reaches `latestDrop`, which wants every row whether or not it carries a
 * crossing. That is why the ground readers ask for no bounds.
 *
 * `madeBy` (POS-138, 2026-09-24) narrows to the things a set of handles MADE —
 * the author is the `<by>` half of the thing's id, which is the same reading
 * `world-hold.mjs § whereThingStands` and `world-stance.mjs § setDownFor` make
 * (`id.split("/")[0]`). It is how the author's stances read finds the
 * set-downs waiting on its word without asking about every thing in town: the
 * rows it returns are the holding acts on the house's own things and no others.
 * Pushed AFTER `thing`, for the reason the `thing` clause gives.
 */
export async function pgHoldingRows(client, { thing = null, since = null, until = null, madeBy = null } = {}) {
  const args = [CLASS_HOLDING];
  let sql = `SELECT id, at, crossing, actor, action, object,
                    at_anchor, at_dx, at_dy, witnesses, class, payload, effect, household
             FROM acts WHERE class = $1`;
  // `thing` IS PUSHED FIRST, and the position is load-bearing: POS-162's
  // `pgHoldingRowsFor` fixture reads `params[1]` as the thing, so a bound
  // squeezed in ahead of it would hand that suite a crossing where it expects an
  // id. POS-162's own narrowing, verbatim — `object` is the thing for a live
  // act and the payload key is the belt-and-braces for one written without it.
  if (thing != null) {
    args.push(String(thing));
    // ⚑ `$$`: the placeholder's own dollar, then the template's. One `$` here
    // (1626f2f4) sent `= 2` to Postgres — an integer against text, and a bind
    // of two parameters to a statement that names one — so every per-thing
    // holding read refused on the real store while the fixture, which reads
    // `params` and never the text, answered green.
    sql += ` AND COALESCE(object, payload->>'thing') = $${args.length}`;
  }
  if (madeBy != null) {
    args.push([...madeBy].map(String));
    sql += ` AND split_part(COALESCE(object, payload->>'thing'), '/', 1) = ANY($${args.length})`;
  }
  if (Number.isFinite(Number(since)) && since != null) {
    args.push(Number(since));
    sql += ` AND crossing >= $${args.length}`;
  }
  if (Number.isFinite(Number(until)) && until != null) {
    args.push(Number(until));
    sql += ` AND crossing <= $${args.length}`;
  }
  const { rows } = await client.query(`${sql} ${HOLDING_ORDER_SQL}`, args);
  return rows.map(holdingRowOf);
}

// ═════════════════════════════════════════════════════════════════════════════
// THE TRIPWIRES — premises that are FACTS OF TODAY'S STORE, not law
// ═════════════════════════════════════════════════════════════════════════════
//
// live-reads.mjs's `admissionNotes` shape. Four things this port stands on are
// true of the store as it is rather than true by law, so each gets a check that
// fires when it stops being true instead of a comment nobody re-reads.

export function admissionNotes({ claims = [], attachments = [], heldReview = 0, hiddenDrafts = null,
                                 actsHouseholds = [], claimHouseholds = [] } = {}) {
  const notes = [];

  // 1. `held_review` — the unruled status. Zero today; the day it is not, the
  //    exclusion above stops being free and somebody has to rule.
  if (heldReview) {
    notes.push(`${heldReview} claim(s) stand at held_review, which LIVE_STATUSES excludes. That exclusion was free ` +
               `while the count was zero and is not any more: a colliding claim is live in 1.0 (it sits in the ` +
               `journal until the settlement rules) and not live here. Slug collision wants it counted; the parcel ` +
               `cap wants it not. This is a ruling, not a port.`);
  }

  // 2. THE RESOLVED-KEY EDGE. `claims.household` is the key (`gh:…`/`solo:…`);
  //    1.0's guards compare against a household NAME. True of every row today
  //    (Wright's 2026-08-28 ruling made it so); a bare handle appearing here
  //    means the docket pen has regressed to its pre-ruling spelling.
  const bareHousehold = claims.filter((c) => c.household && !/^(gh|solo|login):/.test(c.household));
  if (bareHousehold.length) {
    notes.push(`${bareHousehold.length} live claim(s) carry a household that is neither gh:/solo:/login: ` +
               `(e.g. ${JSON.stringify(bareHousehold[0].household)}) — the docket pen's ruling is that a roster owner ` +
               `keeps the household KEY and a non-roster owner is solo:<handle>, never a bare handle. A guard ` +
               `comparing against 1.0's household NAME would match none of these.`);
  }

  // 3. THE LIVE HOLDING ERA. Nothing has been picked up since the mirror shipped,
  //    so era 2's mapping has never been exercised against a real row.
  const live = attachments.filter((a) => a.era === "live").length;
  if (!live && attachments.length) {
    notes.push(`no live give/drop/take acts exist yet — every holding answered here comes from the frozen ` +
               `STATE/log record. The live era's mapping (payload.holder ?? actor) is implemented and NOT ` +
               `exercised by any row; the unit suite is what stands behind it until something is picked up.`);
  } else if (live) {
    notes.push(`${live} live give/drop/take act(s) are being read through mirrorLaneAct's payload rather than the ` +
               `STATE/log event shape. This is first traffic on that era.`);
  }

  // 4. THE TWO SPELLINGS. `acts.household` is the office key's NAME and
  //    `claims.household` is the resolved KEY; the overlay reads both tables.
  //    This fires while the two disagree, and goes quiet when the acts mirror is
  //    corrected to the docket pen's spelling.
  if (actsHouseholds.length && claimHouseholds.length) {
    const actsKeyed = actsHouseholds.filter((h) => /^(gh|solo|login):/.test(h)).length;
    if (actsKeyed !== actsHouseholds.length) {
      notes.push(`${actsHouseholds.length - actsKeyed} of ${actsHouseholds.length} distinct acts.household value(s) are ` +
                 `NOT in the resolved-key spelling (e.g. ${JSON.stringify(actsHouseholds.find((h) => !/^(gh|solo|login):/.test(h)))}), ` +
                 `while claims.household is. Two tables, one fact, two spellings — the deleted arm is scoped through ` +
                 `identities for that reason, and this note goes quiet the day the acts mirror adopts the same ruling.`);
    }
  }

  // 5. WHAT THE CREDENTIAL CANNOT SEE. Only measurable with a credential that can
  //    see drafts, so it is passed in rather than asked for here.
  if (hiddenDrafts) {
    notes.push(`${hiddenDrafts} draft claim(s) exist that this connection's credential cannot see under 007's row ` +
               `policy. Every one is a live mark 1.0's cross-household read WOULD have returned.`);
  }
  return notes;
}

/** What every door reading this tier says about what it could not do. */
export const DISCLOSURES = Object.freeze({
  sketchbook:
    "no sketchbook half: 1.0's draftsForKey unions the journal with the `draft/<household>` git branch, which " +
    "still holds every draft written before the single-log flag. That branch has no 2.0 surface and will not " +
    "get one — Phase 5.6 moved private drafts into `claims` precisely because a draft branch in a public repo " +
    "was always readable. A resident with pre-flag sketches sees them in 1.0's answer and not in this one.",
  filing:
    "no filing: `path` is 1.0's git location for a mark, resolved from the frozen filing manifest and the tree " +
    "at a sha. 2.0 has no mark tree — the notary exports acts. `path` is null unless the caller injects " +
    "`pathFor`/`publishedPathOf`, and it is never guessed: gate A refuses a mark filed at the wrong place at " +
    "the next lint, so a plausible guess would turn a missing field into a refused settlement.",
  cross_household:
    "a cross-household live read (household: null) is NARROWER than 1.0's by exactly the other households' " +
    "DRAFTS. 007's row policy makes a draft visible only inside a transaction that named its household, and " +
    "there is no household to name here. 1.0's `worldForStances` deliberately surfaces another household's " +
    "sketch when it overlaps ground you hold — 'the ONE place a sketch becomes visible to somebody who did not " +
    "write it', which the-late-welcome asks for. Under 007 that is not narrowable, it is unrepresentable for " +
    "office_api. Which law gives way is a ruling, and it is not this port's to make. RULED 2026-09-22 " +
    "(POS-195, G1 overnight RULING 2): NEITHER gives way — a third credential, `stance_reader` " +
    "(world2/schema/023), reads that ONE list through a policy carve admitting drafts to that role alone. " +
    "This read is unchanged and office_api stays blind to other households' drafts, here and everywhere.",
  holdings_source:
    "holdings answer from `acts` alone. Measured 2026-08-28: `acts` holds all 43 attachment events the world " +
    "repo's STATE/log carries at settlement/S47 and S50, and the `attachments` tables in BOTH the lab office " +
    "and the dev office hold ZERO rows. The coverage gap here is on the sqlite side, not this one — there is " +
    "no live 1.0 holder state on this box to disagree with.",
  no_journal_row:
    "a declaration whose docket write failed is invisible here. `submitClaimFromJournal` is fire-and-forget " +
    "and needs an open window; the sqlite journal row lands either way. That is DESIGN-pen-flip.md's R1 " +
    "atomicity hole seen from the READ side, and it is why these reads gate the flip rather than follow it.",
  jsonb_key_order:
    "`geometry` and `data` come back through jsonb, which does not preserve an object's key order — Postgres " +
    "stores keys sorted by length then bytes, so a `{w,h}` extent returns as `{h,w}`. The VALUES are identical " +
    "and every reader that reads fields is unaffected; a reader that compares two marks by JSON.stringify is " +
    "not, and would see every mark as changed. Compare by field or canonicalize; do not assert key order, " +
    "because jsonb never promised it.",
  two_household_spellings:
    "`acts.household` and `claims.household` spell one fact two ways — the office key's NAME on the acts " +
    "mirror ('darko', 12 rows on world2_dev; NULL on all 2925 seeded ones), the resolved KEY on the docket " +
    "('gh:67605380', 'solo:the-town'). The draft overlay reads both tables, so it scopes the withdraw acts " +
    "through `identities` rather than through either column. A caller that filtered both by one string would " +
    "get every added and modified mark and no deleted ones, silently, for every household in town.",
});
