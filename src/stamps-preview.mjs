// stamps-preview.mjs — ONE GRAMMAR FOR EVERY ACT THAT MOVES STAMPS.
//
// THE FOUNDER'S WORD (2026-09-14 20:0x EDT, postmark-town/postmark#2814):
// "in lieu of the confirmation step we will build for mark creation, we should
// have a confirmation step for things involving stamps just so agents know
// right then and there what they are doing (like n stamps still owned, and what
// will happen to their stamps, with a y/n)." And the shape, ruled the same
// evening: "yeah I like the opt-in."
//
// So: `preview: true` on every stamp-moving door — every check the real act
// runs, nothing written — and the SAME block on the real act's receipt, so an
// agent that skipped the preview still reads, right then, what it did. One
// grammar on every door, so an agent learns it once.
//
// ── WHERE THE NUMBERS COME FROM, AND WHY IT IS THIS FOLD ────────────────────
//
// `heldFor` reads the TOWN's own sealed ledger with the TOWN's own folds
// (`parseStampLedger` + `foldBalances` + `foldStaked`, imported live from the
// clone, never vendored). That is the same fold `tools/world-stake.mjs
// § worldStakeState` performs for balances — the fold the CLIP itself reads —
// and the same one `src/hydrate.mjs` performs to fill the index's `stamps`
// table.
//
// ⚑ AND IT IS DELIBERATELY NOT THE INDEX. The lane brief says "from the same
// fold the estate read uses", and the estate read (`household-stamps.mjs
// § estateRead`) goes through `queries.stampsDetail`, which reads the SQLite
// index — a SNAPSHOT of this fold, refreshed at rehydrate. A preview exists to
// say what THIS act will do to your stamps; taken from a snapshot, its `after`
// arithmetic would be wrong by exactly whatever the ledger has done since the
// last rehydrate, in the one case the preview is for. The clip's own source is
// the live ledger, so the preview reads the live ledger. The index stays the
// estate read's, which is a different question ("what do my books say") asked at
// a different door.
//
// ── THE CLIP, AND THE ONE COPY THIS FILE ADMITS TO ──────────────────────────
//
// `src/world-stake.mjs`'s header is law for this office: "shell the mint's own
// engine, never reimplement the mint's law in the door." The clip lives inside
// `worldStakeApply`, which APPENDS — there is no way to ask the town engine what
// it would move without it moving it, and no pure `plan` beside `apply` in
// `tools/world-stake.mjs` or `tools/ballot.mjs` to ask instead.
//
// So `clipTo` below is the office computing one line the town owns:
//
//     tools/world-stake.mjs:220   const applied = Math.min(n, balance);
//     tools/world-stake.mjs:250   const applied = Math.min(n, open);
//
// It is ONE function, exported and pure, and its warrant is a BEHAVIOURAL
// parity falsifier — `test/stamps-preview.test.mjs` drives the town's real
// `worldStakeApply` / `worldUnstakeApply` against a throwaway signed repo and
// asserts this function returns the engine's own `applied` across the
// boundaries (under, exact, over, empty). A grep over the engine's source would
// be a check on its TEXT; this one reads its BEHAVIOUR. If the town changes how
// it clips, the parity test reds and this file is the thing that is wrong.
//
// The pot door needs no copy at all: `pot-stake-exec.mjs § clipPotStake` is
// already the office's own pure clip (its header says why), so the pot preview
// calls it rather than anything here.

const asInt = (n) => Number(n);

// ── THE LAW, QUOTED ─────────────────────────────────────────────────────────
//
// The quote law: "every new act plants its residue class mark first and the
// door quotes it, never its own prose." These are the planted bodies VERBATIM
// from the world record, and the falsifier reads the mark files themselves
// rather than trusting this copy (the shape `test/household-stamps.test.mjs`
// already keeps for the pot's two).
//
// ONE SENTENCE SERVES BOTH DIRECTIONS on a mark, and that is the record's doing
// rather than a shortcut: `the-town/stake-mark` says what a stake does AND what
// the unstake gives back ("returns whole at the unstake"), so quoting it on an
// unstake is quoting the clause that governs the unstake. Inventing a shorter
// "returns now" would be the door writing prose where the law already speaks.
export const STAKE_MARK_MARK = "the-town/stake-mark";
export const STAKE_MARK_BODY =
  "A mark stake is presence with weight — it raises the ✦ at the fold, anchors the mark against retiring, and returns whole at the unstake.";

/** The rule a mark stake or unstake is consenting to — mark id beside the words,
 *  so a reader can go and check the door against the record. */
export const RULE_MARK = Object.freeze({ mark: STAKE_MARK_MARK, says: STAKE_MARK_BODY });

/**
 * The town engine's own clip, as a pure function. See § THE CLIP above for why
 * this copy exists and what holds it honest.
 *
 * `applied` is the engine's line verbatim (`Math.min(n, ceiling)`) so the parity
 * falsifier can compare like with like. `moves` is what the ledger ACTUALLY
 * shifts, which is `applied` only when it is positive — the engine returns early
 * with a `reason` and appends nothing at `applied <= 0`, so a block reporting a
 * non-positive `applied` as a movement would be describing a write that never
 * happens.
 */
export function clipTo(requested, ceiling) {
  const applied = Math.min(asInt(requested), asInt(ceiling));
  return { applied, moves: applied > 0 ? applied : 0, clipped: applied < asInt(requested) };
}

/**
 * What this resident holds, from the town's own ledger and the town's own folds.
 *
 * Returns `{ liquid, staked }`. `liquid` is the spendable balance the clip reads;
 * `staked` is the open-stake total across ballots, world marks and pots — the
 * same fold the index's `staked` column is filled from, so `assets = liquid +
 * staked` means here exactly what it means on the estate read.
 *
 * The CLONE IS A PARAMETER, never a module-load constant, so a falsifier can put
 * a three-line ledger in front of this without an environment variable — the
 * lesson of a door whose branch was fixed at module load and could only be
 * checked by reading its source.
 *
 * Never throws: a clone with no ledger, or a tools directory without the mint,
 * answers `{ liquid: 0, staked: 0, unread: <why> }`. A door that refused to
 * preview because the ledger was unreadable would be refusing the act's
 * rehearsal for a condition the act itself survives.
 */
export async function heldFor(clone, handle, { env = process.env } = {}) {
  const { readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const ledgerPath = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  const mintPath = join(clone, "tools", "stamp-mint.mjs");
  if (!existsSync(ledgerPath) || !existsSync(mintPath))
    return { liquid: 0, staked: 0, unread: "the office has no town clone carrying the stamp ledger, so what you hold could not be read here" };
  try {
    const mint = await import(pathToFileURL(mintPath));
    // SNAPSHOT 7 (POS-314): with the town index on the store, town_stamps plus
    // the ledger's tail. Null (no tip, a tip this clone lacks, no store) folds
    // the whole file below, as before: the full derivation wins.
    const { townIndexReads, readTownIndex } = await import("./town-index-store.mjs");
    if (townIndexReads(env)) {
      const { heldFromIndex } = await import("./stamp-tail.mjs");
      const fast = await readTownIndex((q) => heldFromIndex(q, clone, handle, { engine: mint }), { env })
        .then((r) => r.out, () => null);
      if (fast) return fast;
    }
    const entries = mint.parseStampLedger(readFileSync(ledgerPath, "utf8"));
    return {
      liquid: mint.foldBalances(entries).get(handle) ?? 0,
      staked: mint.foldStaked(entries).get(handle) ?? 0,
    };
  } catch (e) {
    return { liquid: 0, staked: 0, unread: `the stamp ledger could not be folded here: ${String(e?.message ?? e).slice(0, 120)}` };
  }
}

/**
 * THE BLOCK. The same four fields on a preview and the first three on a receipt.
 *
 *   you_hold   what you hold now — liquid and staked
 *   this_act   the stamps this act moves, the rule quoted from the law that
 *              governs it, and — when the ceiling bit — the clip, stated as a clip
 *   after      what you hold once it has moved
 *   to_confirm the same call without `preview` (PREVIEW ONLY — see below)
 *
 * ⚑ `to_confirm` IS PREVIEW-ONLY, and that is a declared deviation from the lane
 * comment's "the real act's receipt carries the SAME stamps block". The act is
 * done by the time a receipt is read; a line telling its reader how to confirm
 * it would be inviting a second one. The three fields that carry NUMBERS and the
 * quoted rule are byte-identical across the pair, which is what the
 * identical-block falsifier asks, and `test/stamps-preview.test.mjs` asserts the
 * absence on the receipt rather than leaving it unstated.
 *
 * PURE ON PURPOSE. Every number arrives as an argument, so the falsifiers can put
 * a clip, an empty balance or an unstake in front of it with no clone, no ledger
 * and no subprocess — and the door and the test cannot drift into two rules.
 */
export function stampsBlock({ held, moves, requested, direction, rule, to_confirm = null, reason = null }) {
  const out = direction === "unstake" ? -1 : 1;   // a stake leaves liquid; an unstake comes home to it
  const n = asInt(requested);
  const m = asInt(moves);
  return {
    you_hold: {
      liquid: held.liquid, staked: held.staked,
      ...(held.unread ? { unread: held.unread } : {}),
    },
    this_act: {
      stamps: m,
      ...(m < n
        ? { requested: n, clipped: true,
            clip: direction === "unstake"
              ? `you asked for ✦${n}; your open position on it is ✦${m}, and ✦${m} is what comes home`
              : `you asked for ✦${n}; your balance carries ✦${m}, and ✦${m} is what the ledger moves` }
        : {}),
      ...(reason ? { reason } : {}),
      rule: rule.says,
      law: rule.mark,
    },
    after: { liquid: held.liquid - out * m, staked: held.staked + out * m },
    ...(to_confirm ? { to_confirm } : {}),
  };
}

/** The `to_confirm` sentence — the y of the y/n, and the n said out loud, because
 *  "not calling" is the one instruction a caller can misread as "do nothing yet". */
export const toConfirm = (call) =>
  `${call} — the same call without preview: true. Not calling is the no; nothing is written either way until you make it.`;

/** The line a preview answer carries so no reader has to infer it from an absence.
 *  The mark preview's own words (world.mjs § PREVIEW), pointed at the ledger. */
export const NOTHING_MOVED =
  "a preview: no escrow moved, no ledger row, no commit — make the same call without preview: true to move the stamps";
