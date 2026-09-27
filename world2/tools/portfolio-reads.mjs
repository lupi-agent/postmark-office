// portfolio-reads.mjs — THE PORTFOLIO DOOR'S PORT. `/world2/my-marks` answers
// `GET /world/my-marks` out of `claims`, `marks`, `identities` and
// `escrow_projection` instead of out of two working trees.
//
// ── WHAT 1.0 DOES, AND OUT OF WHAT ──────────────────────────────────────────
//
// `src/world.mjs § worldMyMarks` composes four lists from three readers:
//
//   drafts/docket  `guardedDraftsForKey(WORLD_CLONE, key)` — the overlay. Its
//                  live half is ALREADY ported (`guard-reads.mjs §
//                  pgDraftsForKey`); its git half is a draft BRANCH in the
//                  world clone.
//   published      `publishedState(WORLD_CLONE).state.marks` — the folded
//                  `WORLD/world-state.json` at the clone's main ref.
//   backed         `worldPortfolioStakeSlice` → the town clone's
//                  `deriveWorldMarkWeights`, whose rows `escrow_projection`
//                  already stores (see `stake-reads.mjs` for the arithmetic).
//
// THE DECISIONS ARE NOT RE-EXPRESSED HERE. `backedRow` (src/world-stake.mjs) is
// exported and pure precisely so one definition serves both doors — "`yours` is
// a sentence the town says to a resident about their own work, and it was wrong
// for as long as it was computed off a record that had not been written yet." A
// second copy of that sentence in this file would be a copy of a law, and copies
// drift. Same for `markPage`: the page bound and its `withheld` naming are
// 1.0's, imported, so a bound and its count stay one change and never two.
//
// ── WHAT THE STORE CANNOT ANSWER, NAMED ─────────────────────────────────────
//
//   branch · main · draft
//       `world-branches.mjs § draftDeltaForKey` — a branch NAME and two git
//       SHAs (the clone's main ref, and the head of this household's
//       `draft/<household>` branch). They are facts about a checkout. The store
//       holds `projection_heads` for the LAW and the TOWN, and nothing at all
//       for a per-household draft branch.
//   published[].weight · published[].weight_parts
//       The fold's ✦ figure and `marks-fold.mjs § partsOf`'s receipt for it.
//       This is the THIRD quantity `world-stake.mjs` warns about in place: the
//       telling's weight "also includes everything sitting inside it fanning
//       up, which is the WORLD's tree and invisible from the ledger". The store
//       holds the ledger's positions, so it can answer `stamps` (raw own
//       escrow) exactly and cannot answer `weight` at all. Emitting the ledger
//       weight under the word `weight` would be the two-quantities-one-word
//       defect the 1.0 door exists to have stopped — so the fields are ABSENT
//       and named, never approximated.
//
// Everything else is byte-equal by construction: the same splitter, the same
// filters, the same sort, the same labels, the same pager.

/** The published rows one household's residents authored, standing in canon. */
export const PORTFOLIO_MARKS_SQL = `
  SELECT slug, kind, owner, household, body, geometry, data
    FROM marks WHERE status = 'standing' AND owner = ANY($1) ORDER BY slug`;

/**
 * Every handle the store's roster puts in one household.
 *
 * `= ANY($1)` — THE SPELLING SET, not the one current key (POS-160 RULING 4).
 * `identities.household` is a projection of the world repo's copy of the town's
 * pins and carries whatever spelling that copy held when each row landed:
 * measured 2026-09-22, 173 of 190 handles wore `gh:<id>` and 17 wore
 * `hh:<slug>`, and umbraliminalis wore BOTH — a ledger re-key had reached its
 * first resident and not its other seven.
 *
 * So against a `hh:`-keyed session this used to return two of that house's
 * eight residents. The portfolio's `belongs()` then read the other six's
 * standing marks as somebody else's and dropped them from `published`, and the
 * same six's stakes out of `backed` — a resident's own page, missing their own
 * work, with no refusal and nothing to notice. The store does not re-spell
 * `identities` (its rows are `law_ingester`'s), so the reader takes the set.
 */
export const HOUSEHOLD_HANDLES_SQL =
  "SELECT handle FROM identities WHERE household = ANY($1) ORDER BY handle";

/**
 * 1.0's four labels, VERBATIM. They are the answer to the 2026-09-06 walk's
 * "either the town leaks, or the word 'draft' means something I was not told",
 * so a twin that paraphrased them would answer that question differently at the
 * two doors — which is the whole failure the labels were added to end.
 */
export const PORTFOLIO_LABELS = Object.freeze({
  drafts: "YOURS AND PRIVATE — your household's compose space. On no docket, in no export, in no archive, in no public answer. Staking one is what puts it forward, and that crosses once.",
  docket: "PUBLIC — staked and standing on the town's docket, where anyone may read it, waiting for a candle. `world { read: \"leave-mark\", args: { mark: \"<by>/<slug>\" } }` carries its receipt.",
  published: "ON THE WORLD — carried by a settlement; the record holds it.",
  backed: "YOUR STAMPS ON SOMEBODY'S MARK — `yours` says whether the mark itself is one of your residents'.",
});

/** The fields of 1.0's answer this tier does not carry, and why. Served ON the answer. */
export const PORTFOLIO_TREE_ONLY = Object.freeze({
  "branch · main · draft": "a branch name and two git shas from the world clone (world-branches.mjs § draftDeltaForKey) — the store holds no per-household draft branch",
  "published[].weight · published[].weight_parts": "the fold's ✦ figure and marks-fold.mjs § partsOf. It includes marks INSIDE this one fanning up — the world's tree, invisible from the ledger — so the store can answer `stamps` exactly and `weight` not at all. Absent rather than approximated: see world-stake.mjs § worldStakeRead's own note about two quantities under one word.",
});

/**
 * ONE PUBLISHED ROW, from a `marks` row. PURE.
 *
 * The same projection `world.mjs § worldMyMarks` builds, field for field and in
 * the same order, MINUS the two fold quantities named above. `tier` rides
 * `data.tier` because the store keeps it there ("tier rides data" —
 * world2-serve.mjs § /world2/marks), and `at`/`extent` ride `geometry`.
 *
 * ⚑ ABSENT, NOT NULL, when a mark has no site — 1.0's own ruling, quoted: "a
 * predicated or naming mark HAS no site of its own … and `at: null` would say
 * 'this thing is somewhere unknown' about a thing that is nowhere by
 * construction. A consumer asks `if (row.at)`, which is the question it
 * actually has." The spread below is that ruling, not a convenience.
 */
export function publishedRowOf(row = {}, { stampsOf = () => 0 } = {}) {
  const at = row?.geometry?.at ?? null;
  const extent = row?.geometry?.extent ?? null;
  return {
    id: row.slug,
    by: row.owner,
    kind: row.kind,
    tier: row?.data?.tier ?? null,
    body: row.body,
    ...(at ? { at } : {}),
    ...(extent ? { extent } : {}),
    stamps: Number(stampsOf(row.slug) ?? 0),
  };
}

/**
 * THE TWO LISTS, TWO LABELS SPLIT — `world.mjs § R3`, ported.
 *
 * ⚑ THE NEGATIVE FILTER RIDES ACROSS, AND SO DOES ITS TRAP. 1.0's own warning,
 * carried because the condition it warns about is a constant in THIS tree:
 * "`drafts` IS A NEGATIVE FILTER, AND IT IS CORRECT ONLY BECAUSE
 * `LIVE_STATUSES` IS EXACTLY `['draft','pending']` … The day a `locked`,
 * `refused` or `held_review` row joins that constant, it lands HERE and is
 * labelled 'YOURS AND PRIVATE' about a row 007 makes public."
 *
 * `LIVE_STATUSES` is `guard-reads.mjs`'s, and `pgDraftsForKey` is what fills
 * `live` here — so widening it widens this filter too, at both doors, silently.
 * The 1.0 door says "make this filter positive first". The same repair applies
 * to this line on the same day.
 */
export function splitLive(live = []) {
  return {
    drafts: live.filter((m) => m.claim_status !== "pending"),
    docket: live.filter((m) => m.claim_status === "pending"),
  };
}

/**
 * THE ANSWER, composed. PURE — takes the four lists already read and returns
 * the body, so the counts/pager/labels decision is provable with no Postgres,
 * no clone and no key.
 *
 * `pager` is 1.0's `markPage`, handed in rather than imported, so this module
 * stays free of `src/` and the falsifier can hold the port to the ORIGINAL
 * function rather than to a copy of it.
 */
export function portfolioAnswerFrom({ household, residents = [], live = [], published = [], backed = [], offset = 0, pager }) {
  if (typeof pager !== "function") throw new Error("portfolioAnswerFrom: pass 1.0's markPage as `pager` — a second pager is a second page bound");
  const { drafts, docket } = splitLive(live);

  // COUNT FIRST, SLICE AFTER — 1.0's own ordering, and its reason: "a bound and
  // its count are one change, never two".
  const counts = {
    drafts: drafts.length,
    docket: docket.length,
    published: published.length,
    backed: backed.length,
  };
  const d = pager(drafts, offset);
  const k = pager(docket, offset);
  const p = pager(published, offset);
  const b = pager(backed, offset);
  const withheld = d.rest.length + k.rest.length + p.rest.length + b.rest.length;

  return {
    household,
    residents,
    drafts: d.page,
    docket: k.page,
    published: p.page,
    backed: b.page,
    labels: PORTFOLIO_LABELS,
    counts,
    shown: { drafts: d.page.length, docket: k.page.length, published: p.page.length, backed: b.page.length },
    complete: withheld === 0,
    ...(withheld === 0 ? {} : {
      offset: p.offset,
      withheld: { ...(d.rest.length ? { drafts: d.rest } : {}),
        ...(k.rest.length ? { docket: k.rest } : {}),
        ...(p.rest.length ? { published: p.rest } : {}),
        ...(b.rest.length ? { backed: b.rest } : {}) },
      withheld_note: `${withheld} of your marks are named above by id rather than shown in full — counts is the whole of what you own, and world { read: "leave-mark", args: { mark: "<by>/<slug>" } } opens any one of them`,
    }),
  };
}
