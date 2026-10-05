// escrow-presence.mjs — A COMMONS MARK NEEDS SOMEBODY'S STAMPS BEHIND IT.
//
// THE GAP, found 2026-09-08 by lane 2's reviewer and ruled a G1 blocker the same
// evening. The clearing's ONLY escrow step is an AFFORDABILITY test:
//
//     clearing-job.mjs § 3 (:147-158), verbatim
//     "3 · escrow sufficiency at town_sha (the pinned candle read).
//          LIQUID balance (merge ruling 2 in world2/tools/README.md)."
//     …
//     for (const c of pending) if (!outcomes.has(c.id)) staked.set(…)
//     for (const [claimant, total] of staked) { if (total === 0) continue; …
//
// `if (total === 0) continue` — **a claim staking zero passes untouched.** The
// store's candle has an escrow SUFFICIENCY gate and no escrow PRESENCE gate.
//
// THE 1.0 SWEEP HAS THE PRESENCE GATE, and G1 deletes the sketchbook path that
// carries it (`tools/settlement-sweep.mjs:1146-1152` in the world, verbatim):
//
//     const cls = classifyMark(view ?? record, folded);
//     const rowClass = cls === "market" ? "commons" : cls;
//     const n = escrow.get(record.id) ?? 0;
//     const eligible = rowClass !== "commons" || n > 0;
//     if (!eligible) {
//       leftDrafted.push({ …, reason: "commons needs escrow > 0" });
//
// So after G1 the rule would simply stop being enforced anywhere. This is that
// rule, ported to the candle — the same mapping, the same threshold, the same
// word.
//
// ── THE LIVE INSTANCE, MEASURED ON THE TOWN ITSELF ──────────────────────────
//
// `lupi/the-drift-room`: claim 32c20578 locked at window 177 with `stake` 0; the
// mark's tier is `market`, so its row class is `commons`; and the town at that
// window's own pinned `town_sha` (723005e5) names the mark NOWHERE — `git grep`
// over the whole town at that sha returns nothing, so no stamp is staked on it.
// The 1.0 sweep left it drafted for exactly this reason; the 2.0 candle locked
// it. One resident act, two gates, and only one of them was looking.
//
// ── OWN GROUND IS EXEMPT, AND NOT BECAUSE A CLAUSE HERE SAYS SO ─────────────
//
// The exemption falls out of the CLASS, which is why there is no own-ground
// clause in this file. `mark-standing.mjs § groundVerdict` (the world's ONE
// standing rule, ported into `standing.mjs`), verbatim:
//
//     const holder = standingHouseholdOf(ground);
//     if (holder == null || house == null) return "market";
//     if (holder === house) return "home";
//     return mark.id != null && consentMap(ground)?.[mark.id] === "welcomed" ? "home" : "market";
//
// A mark standing on ground its own household holds is `home`, and only
// `commons` needs escrow — so an own-ground mark at stamps:0 publishes, and it
// publishes because of the class rule and not because of a second sentence here.
// A second sentence would be a copy of a law, and copies drift. The falsifier
// still drives the case; it passes because the class says `home`.
//
// ── THE CLASS MUST BE COMPUTED, NOT READ ────────────────────────────────────
//
// `marks.data.tier` is written by `recomputeStanding` at step 7, AFTER
// materialization. At the lock step the mark does not exist and the column is
// null, so a gate reading `data.tier` would read null for every claim it is
// judging and refuse nothing, forever — green, silent and useless. The class is
// therefore computed PROSPECTIVELY: the port's own `computeStanding` over the
// standing rows PLUS the candidate rows, which is the same walk step 7 runs, so
// there is one definition of standing and not two.

/** The sweep's own mapping, at `settlement-sweep.mjs:1147`. One line, cited. */
export const rowClassOf = (cls) => (cls === "market" ? "commons" : cls);

/** The check name this writes into `claims.refusal_check` — the prefix `causeOf` splits on. */
export const ESCROW_ABSENT_CHECK = "escrow-absent";

/**
 * The `<name>: <detail>` string a refused claim carries.
 *
 * The TOWN sha, not the world's: escrow is a fact about the town's ledger
 * as-of a town commit, and naming the world sha here would be the
 * freshness-stamp-from-the-wrong-source defect this lane already has one of.
 */
export const escrowAbsentCheck = (slug, townSha) =>
  `${ESCROW_ABSENT_CHECK}: ${slug} @ ${String(townSha ?? "?").slice(0, 8)}`;

/**
 * Which candidates are commons marks with nothing staked on them.
 *
 * PURE. Takes the classes the walk answered and the escrow the store holds, and
 * returns the refusals — so the whole judgement is provable on two Maps with no
 * Postgres, no checkout and no crossing.
 *
 * @param candidates  `[{ id, slug }]` — the claims still undecided that name a mark.
 * @param tiers       Map slug → the port's verdict (`home` | `market` | `constitution` | …).
 * @param escrowByMark Map slug → open stamp count, or NULL for "could not be read".
 * @param townSha     the window's own pinned town sha, for the check string.
 *
 * `escrowByMark === null` is NOT zero and must never be treated as zero: a store
 * that cannot answer and a town where nobody staked are different facts, and
 * spelling them the same way is how a gate refuses the whole town on a missing
 * migration. It returns `unchecked` instead, and the caller says so out loud.
 */
export function escrowAbsentAmong(candidates, { tiers, escrowByMark, townSha } = {}) {
  const commons = [];
  for (const c of candidates) {
    if (!c.slug) continue;
    const cls = tiers?.get?.(c.slug) ?? null;
    // A class the walk did not answer for is not a commons mark by default. The
    // walk answers for every row it is given, so this is the shape-error case,
    // and guessing `commons` here would refuse a claim on a bug in the caller.
    if (cls == null) continue;
    if (rowClassOf(cls) !== "commons") continue;
    commons.push(c);
  }
  if (!commons.length) return { refused: [], unchecked: [], commons: [] };
  if (escrowByMark == null) {
    return { refused: [], unchecked: commons, commons };
  }
  const refused = [];
  for (const c of commons) {
    const n = Number(escrowByMark.get(c.slug) ?? 0);
    if (n > 0) continue;
    refused.push({ id: c.id, slug: c.slug, check: escrowAbsentCheck(c.slug, townSha) });
  }
  return { refused, unchecked: [], commons };
}

/**
 * The two operator lines a crossing prints about this gate.
 *
 * ── WHY THE COMPOSITION LIVES HERE AND NOT AT THE CALL SITE ─────────────────
 *
 * Because the call site is `clearing-job.mjs`, which is a SCRIPT, so a line
 * composed there is watched by nothing — and the first cut of the `unchecked`
 * line proved exactly what that costs. It read
 *
 *     ${verdict.unchecked.join(", ")}
 *
 * over an array of `{ id, slug }` OBJECTS, and printed `[object Object]`. Its
 * sibling one line above mapped to `.slug` correctly, and so did the receipt, and
 * so did `test/escrow-presence.test.mjs`, which does the mapping ITSELF in its
 * own assertion — **the test performed the very mapping the production line
 * forgot.** A green suite could never have shown it.
 *
 * And it was the worst of the two to get wrong: `escrow_projection` is not on
 * prod until migration 014 lands with lane 2, so the `unchecked` branch is the
 * ONLY one that can run between merge and that migration. Every crossing would
 * have printed an operator line naming nothing.
 *
 * So the strings are built by a pure function and the falsifiers read the
 * STRINGS. A line nobody can assert on is a line that will say `[object Object]`
 * eventually.
 */
export function escrowLines({ refused = [], unchecked = [] } = {}, townSha) {
  const at = `town ${String(townSha ?? "?").slice(0, 8)}`;
  const lines = [];
  if (refused.length)
    lines.push(`escrow: refused ${refused.length} commons claim(s) with nothing staked at ${at}: ` +
      refused.map((r) => r.slug).join(", "));
  if (unchecked.length)
    lines.push(`escrow: ${unchecked.length} commons claim(s) LOCKED UNCHECKED — escrow_projection cannot answer at ${at} ` +
      `(migration 014 not applied, or this sha not ingested): ` +
      unchecked.map((c) => c.slug).join(", "));
  return lines;
}

/**
 * The open stamps per mark at one town sha, from `escrow_projection` (migration
 * 014, lane 2's `jetto/g1-render-stakes`).
 *
 * ── WHY THIS AND NOT `stakesFromStore` ──────────────────────────────────────
 *
 * `fold-input.mjs § stakesFromStore` answers the WEIGHT question: it carries the
 * `weight_k` dial, refuses a sha whose rows disagree about k, and reproduces the
 * town's own walk order because the fold consumes an ordered array. The gates
 * here ask for RAW open stamps per mark (5.5 whether any; step 3, POS-411, how
 * many), and importing the weight derivation for that would drag k's torn-ingest
 * rules into checks that never price weight. One question, one reader.
 *
 * What IS taken from it, verbatim in spirit, is the empty-set discipline: no
 * rows for a sha is a REFUSAL to answer, never "nobody stakes". Its own words —
 * "an empty stake set is indistinguishable from a town where nobody stakes".
 *
 * Returns a Map, or NULL when the projection cannot answer — the table absent
 * (migration 014 not yet applied) or no rows at this sha. NULL is the caller's
 * cue to say so out loud, never to treat the town as unstaked.
 */
export async function escrowPresenceAt(q, { townSha } = {}) {
  if (!townSha) throw new Error("escrowPresenceAt: no townSha — escrow is as-of a town commit and there is no 'latest'");
  const { rows: present } = await q("SELECT to_regclass('public.escrow_projection') IS NOT NULL AS ok");
  if (!present[0]?.ok) return null;
  const { rows } = await q(
    "SELECT mark, sum(n)::int AS n FROM escrow_projection WHERE town_sha = $1 GROUP BY mark", [townSha]);
  if (!rows.length) return null;
  return new Map(rows.map((r) => [r.mark, Number(r.n)]));
}

/** The check name step 3 writes into `claims.refusal_check` (`mark-receipt.mjs` maps it to `unbacked`). */
export const INSUFFICIENT_CHECK = "insufficient-stamps";

/**
 * Which staked claims are not backed — the clearing's step 3 (POS-411).
 *
 * ── A STAKE IS JUDGED FROM ITS OWN RECORD ───────────────────────────────────
 *
 * THE INSTANCE: window 231 refused `special-delibry/the-starling-house-mailbox`
 * with `staked 1, liquid 0`. Lyra had staked 1 on it, the ledger had moved her
 * stamp, and escrow_projection held `wayward-archivist · 1` on the mark at the
 * window's own town sha. The old step summed `claims.stake` per CLAIMANT and
 * asked for the claimant's liquid, and both halves were wrong:
 *
 *   - `claims.stake` is the number the STAKER asked, written onto the AUTHOR's
 *     claim by the promotion (`promoteDraftOnStake`, `stake = GREATEST(stake,
 *     n)`; ruled 2026-09-12 to stay the number asked). Nothing on the row names
 *     who staked. A housemate's stake on the author's draft is charged to the
 *     author.
 *   - liquid excludes escrow (merge ruling 2, world2/tools/README.md), so a stake
 *     the ledger has already moved has LEFT the liquid the old step counted it
 *     against. lu-yu staked both of her two stamps and was refused on both.
 *
 * The record of a stake is the ledger line, and escrow_projection is its
 * projection: `(mark, holder, n)` at this sha. So the stamps open in escrow on a
 * claim's own mark back it, whoever holds them. Only the part of the ask with no
 * escrow behind it (a stake whose ledger line is not in the pinned town read, or
 * a stake the ledger clipped) still asks the liquid question. That remainder has
 * no staker on any record, so it is judged against the claimant, the only name
 * the claim carries, summed over the claimant's window as before. Ruling 2 is
 * kept: liquid stays liquid, and it is asked only of stamps still liquid.
 *
 * PURE: two Maps in, refusals out.
 *
 * @param claims       `[{ id, slug, claimant, stake }]` — the undecided claims.
 * @param escrowByMark `escrowPresenceAt`'s Map, or NULL when it could not answer.
 *                     NULL is not zero escrow: every stake then asks liquid, which
 *                     is the old rule exactly, and `escrowUnread` says so.
 * @param liquidOf     Map handle → stamp_projection balance at this sha.
 */
export function unbackedStakesAmong(claims, { escrowByMark, liquidOf, townSha } = {}) {
  const short = new Map(); // claimant -> { asked, held, ids: [{ id, slug }] }
  for (const c of claims) {
    const asked = Number(c.stake ?? 0);
    if (asked <= 0) continue;
    const held = Math.min(asked, escrowByMark == null ? 0 : Number(escrowByMark.get(c.slug) ?? 0));
    if (held >= asked) continue;
    const s = short.get(c.claimant) ?? { asked: 0, held: 0, ids: [] };
    s.asked += asked; s.held += held; s.ids.push({ id: c.id, slug: c.slug });
    short.set(c.claimant, s);
  }
  const at = String(townSha ?? "?").slice(0, 8);
  const refused = [];
  for (const [claimant, s] of short) {
    const liquid = Number(liquidOf?.get?.(claimant) ?? 0);
    if (liquid >= s.asked - s.held) continue;
    for (const { id, slug } of s.ids)
      refused.push({ id, slug, check: `${INSUFFICIENT_CHECK}: staked ${s.asked}, held ${s.held}, liquid ${liquid} at town ${at}` });
  }
  return { refused, escrowUnread: escrowByMark == null };
}
