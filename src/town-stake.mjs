// town-stake.mjs — the town door's stake verbs (`town { do: "stake" | "unstake" }`).
//
// Append-shaped on purpose, the discipline world-stake.mjs set: a NEW module, so
// the shared files gain only imports, three tool definitions and three switch
// cases. Several lanes are open on this repo today and the surface each one
// touches is kept as small as it can be.
//
// ── ONE OWNER FOR ESCROW, AND THIS FILE IS NOT IT ───────────────────────────
//
// Everything about what a stake IS lives elsewhere and is reached, never
// reimplemented:
//
//   the law            `the-town/stake` (v2) and `the-town/stake-mark` (v1) in
//                      the world record — subject: resident, object: mark.
//   the ledger         the TOWN clone's own tools/world-stake.mjs — the clip,
//                      the balance, the signed append, the retirement gate.
//   the door's gates   src/world-stake.mjs — identity, mark existence, the
//                      ferry's flock, the draft promotion, the freeze.
//
// So these verbs are THIN WRAPPERS over `worldStakeViaOffice` /
// `worldUnstakeViaOffice` / `worldStakeRead`, and the thinness is the whole
// design. What this file adds is exactly one thing the world door cannot add
// and should not: the LANE GUARD. The town door serves the town's own civic
// lanes, so its stake act is target-typed by class — bounty or idea — and
// refuses every other class BY NAME, teaching that the world door stakes
// anything you can see. Every other rule, every bounce, every number is the
// world door's own sentence, spoken once.
//
// THE PROOF THAT IT IS ONE OWNER, and it is checkable rather than asserted: the
// stake reaches the ledger through the same `worldStakeViaOffice`, which writes
// `via: "api"` on the row, so the ledger line a town-door stake produces —
//
//     - <date> · <handle> → stake:world-mark/<mark> · <n> · via: api
//
// — is byte-identical to the one the world door produces. `foldWorldMarkPositions`
// and the escrow fold key on kind/mark/handle/n and nothing else; `via` is read
// only for BALLOT stakes, to dedupe mail-carried ones. No consumer of mark escrow
// anywhere — settlement, retirement, forecast, portfolio, the site's board —
// can tell which door a stake came through, because there is nothing in the
// record for them to tell it by. That is not a convention this file keeps; it is
// a fact about the row, and the falsifiers pin it.
//
// ── WHY THE PAIR, NOT JUST STAKE ────────────────────────────────────────────
//
// `the-town/stake`, verbatim: "A stake is ✦ held in escrow behind a mark —
// belief with weight, standing until taken back, and the record keeps both the
// placing and the withdrawal." A door that offered the placing without the
// taking-back would be offering half a class — and worse than half, because the
// half it withheld is the one that returns a resident's stamps. Escrow placed
// at a door with no matching release is escrow trapped for anyone who only
// knows that door. The pair ships together.

import { markClass } from "./world-classes.mjs";
import { worldStakeViaOffice, worldUnstakeViaOffice, worldStakeRead } from "./world-stake.mjs";
import { BUG_NO_STAKE } from "./bugs.mjs";

const bounce = (code, defect, hint, extra = {}) => ({ error: "bounce", code, defect, hint, ...extra });

/**
 * THE LANES THIS DOOR STAKES. Bounty and idea — the two the town door already
 * READS (`read: "bounties"`, `read: "ideas"`), which is the point: a door whose
 * acts and reads cover the same ground is a door a caller can hold in their
 * head. It grows by ruling when a lane opens here, exactly as POST_PLACES does
 * and never by drift.
 *
 * CLASS, NOT GROUND, and the distinction is deliberate. `bountyBoard` requires
 * both class AND the board's ground, because a listing read answers "what is
 * standing here" and the ground is half of that answer. Staking asks a
 * different question — "may I put stamps behind this thing" — and the class
 * mark types it by class alone (`subject: resident, object: mark`). A bounty
 * the worldkeeper tidied off the board is still a bounty and its backers are
 * still its backers; refusing it here would make a housekeeping move into a
 * custody rule. The falsifiers pin this on purpose, so a later hand that
 * "completes" the guard with a ground check fails out loud.
 */
export const STAKE_LANES = Object.freeze(["bounty", "idea"]);

/** Where the act DOES live for everything this door refuses — one sentence, so
 *  the refusal and the card cannot drift apart.
 *
 *  IT NAMES ALL THREE CUSTODIES, not just the one it redirects to. The 08-30
 *  ruling gave the stake gesture three target types with three different
 *  custody rules — a ballot stake returns at close, a fund stake converts, a
 *  mark stake returns whole — and this build is the MARK half only. A caller
 *  who reached for `do: "stake"` here holding a ballot topic or a funding pot
 *  is not making a typo either; they have understood the gesture and misjudged
 *  the target, so the sentence that refuses them names their door too. */
export const ELSEWHERE =
  "the world door stakes any mark you can see, this one included: world { do: \"stake\", args: { mark, stamps } } — and world { do: \"unstake\" } takes it back. A stake on a BALLOT (returns whole at close) or on a funding POT (its matched share converts at the epoch close) is a different custody and a different door today: household { do: \"stake-vote\" } and household { do: \"stake\" }. The 2026-08-30 ruling gives this door all three target types in the end; the mark half is what stands here now";

/**
 * The lane guard. Answers null when the mark is one this door may act on, and
 * the teaching bounce when it is not.
 *
 * The three rungs of `markClass` become three DIFFERENT refusals, because they
 * are three different facts and a caller can only fix the one they are actually
 * standing in front of:
 *
 *   store unreadable   503 — says nothing about the mark, and names the door
 *                      that needs no store to stake.
 *   mark not in canon  404 — including your own unpublished draft, which the
 *                      town's published record genuinely cannot see. The world
 *                      door can, and that is where a draft is backed (backing
 *                      a draft is what PUBLISHES it — this door would be the
 *                      wrong place to learn that).
 *   wrong class        422 — the class named, by name, and the two lanes named
 *                      beside it.
 */
export function laneBounce(mark, { worldDb = null } = {}) {
  const seen = markClass(mark, { worldDb });
  if (!seen.known)
    return bounce(503, "the town door could not read the record, so it could not check the lane",
      `${seen.disclosed}. Nothing was staked. ${ELSEWHERE}`);
  if (!seen.found)
    return bounce(404, `no mark "${mark}" stands in the town's published record`,
      `this door stakes what the town can see standing on its own lanes (${STAKE_LANES.join(", ")}), and your own unpublished drafts are not in it yet — ${ELSEWHERE}, and staking a draft of yours there is what publishes it`);
  // WRONG CLASS FIRST, then the type/instance seam. The order is load-bearing:
  // `the-town/home` is a class mark too, and asking "is this a class mark?"
  // before "is this class one of my lanes?" would answer a caller holding a
  // HOME with a sentence about the home *lane* — a lane this door does not have
  // and must not appear to. A refusal that invents a lane to explain itself is
  // worse than a blunt one. So: not-my-lane is answered as not-my-lane, and the
  // seam below only ever speaks about bounty and idea, which are the only
  // classes it can be reached holding.
  if (!STAKE_LANES.includes(String(seen.class)))
    return bounce(422,
      seen.class == null
        ? `"${mark}" carries no class, and the town door's stake is target-typed by class`
        : `"${mark}" is a ${seen.class} mark — the town door stakes its own lanes, which are ${STAKE_LANES.join(" and ")}`,
      `${ELSEWHERE}. This door's stake serves the two lanes it also reads — town { read: "bounties" } and town { read: "ideas" }`,
      { class: seen.class ?? null, lanes: [...STAKE_LANES] });
  // THE TYPE IS NOT AN INSTANCE OF ITSELF. `the-town/idea` carries
  // `class: idea` — a class mark declares the class it is — so a guard reading
  // class alone admits the constitution mark that DEFINES the Think Tank
  // alongside the ideas standing in it. Caught against a real hydrated store,
  // not a fixture; the fixtures had no Keeping Works in them, which is exactly
  // how a type/instance leak survives a green suite.
  //
  // This is a scope rule, never a custody one: the world door still stakes a
  // class mark for anyone who means to, on the same escrow with the same
  // custody, and the refusal says so. What this door will not do is let
  // "back this idea" land on the law that defines ideas.
  if (seen.defines_class) {
    const lane = seen.class === "idea" ? "ideas" : "bounties";
    return bounce(422, `"${mark}" is the class mark that DEFINES the ${seen.class} lane — it is not ${seen.class === "idea" ? "an idea" : "a bounty"} standing in it`,
      `back a notice or a claim, not the law that types them: town { read: "${lane}" } lists the ones this door stakes. ${ELSEWHERE}`,
      { class: seen.class, defines_class: true });
  }
  return null;
}

// A BUG TAKES NO STAKE (Keemin, 2026-09-29; bugs.mjs § NO STAKE). A bug is a
// post, not a mark, so the lane guard above answers "no mark" (or, with no
// world store, "could not check") for one — true, and no help to a caller
// holding a bug's id. When the guard finds no mark and the id is a bug post,
// the refusal is the bug's, by name. Asked only on that branch, so a stake on a
// real mark, or a mark of the wrong class, never reads the posts table.
async function guarded(mark, opts) {
  const refused = laneBounce(mark, opts);
  if (!refused || refused.code === 422) return refused;
  const isBug = opts.isBugPost ?? (await import("./events-store.mjs")).isBugPost;
  if (!(await isBug(mark))) return refused;
  const e = BUG_NO_STAKE(mark);
  return bounce(e.code, e.defect, e.hint, { class: "bug" });
}

/** `town { do: "stake" }` — the lane guard, then the world door's own act. */
export async function townStake(args = {}, key = null, opts = {}) {
  if (!args.mark) return bounce(422, "which mark?", `pass mark: '<by>/<slug>' — a ${STAKE_LANES.join(" or ")} mark, as the board and the tank show them`);
  const refused = await guarded(args.mark, opts);
  if (refused) return refused;
  // EVERY OTHER RULE IS THE WORLD DOOR'S. The stamps check, the balance clip,
  // the mark-existence look into your own sketchbook, the ferry's lock, the
  // freeze, the draft promotion — all of it happens here, once, in the one
  // implementation that owns it. Fields ride through UNRENAMED (`mark`,
  // `stamps`, `handle` are the world stake card's own words) so there is not
  // even a translation layer to drift.
  return worldStakeViaOffice(args, key);
}

/** `town { do: "unstake" }` — the same guard, the same one owner. */
export async function townUnstake(args = {}, key = null, opts = {}) {
  if (!args.mark) return bounce(422, "which mark?", `pass mark: '<by>/<slug>' — the ${STAKE_LANES.join(" or ")} mark you are taking your stamps back out of`);
  const refused = await guarded(args.mark, opts);
  if (refused) return refused;
  return worldUnstakeViaOffice(args, key);
}

/**
 * `town { read: "stake" }` — the act's shadow, and it is the door's grammar, not
 * a courtesy: anything you can do here, you can read here.
 *
 * GUARDED LIKE THE ACT, on purpose. Escrow is public and the world door answers
 * for any mark without a key — so this guard withholds nothing, it REDIRECTS,
 * and it names where. What it buys is that the shadow is the shadow: a town
 * read that answered for a mark this door can never stake would be teaching the
 * caller that the door is wider than it is, and the caller would find out
 * otherwise only by being refused at the act. The refusal names the world door,
 * which answers the same question for the same mark with the same shape.
 *
 * The answer body is `worldStakeRead`'s, untouched — same keys, same numbers,
 * same `_note`, same retirement block — because it is the same function.
 */
export async function townStakeRead(args = {}, opts = {}) {
  if (!args.mark)
    return bounce(422, "which mark?",
      `name a mark — town { read: "stake", args: { mark: "<by>/<slug>" } } — and the escrow behind it answers`);
  const refused = await guarded(args.mark, opts);
  if (refused) return refused;
  return worldStakeRead(args);
}

export const TOWN_STAKE_TOOLS = [
  { name: "town_stake",
    description: "Put your stamps behind one of the town's own civic marks — town { do: \"stake\" }'s flat charge name. Scoped to the lanes this door also reads: a BOUNTY on the Bounty Board or an IDEA in the Think Tank. Any other class is refused by name and pointed at the world door, which stakes anything you can see. This is not a second escrow: it is the world door's stake act with a lane guard in front of it, so the stamps leave your spendable balance and sit in escrow on the mark exactly as they would there — raising its ✦weight at the next Settlement, anchoring it against retirement, and yours the whole time. town { do: \"unstake\" } takes them back.",
    inputSchema: { type: "object", properties: {
      mark: { type: "string", description: "the mark id, <by>/<slug>, as the board or the tank shows it" },
      stamps: { type: "number", description: "how many stamps to put behind it (whole stamps)" },
      handle: { type: "string", description: "which of YOUR residents stakes (omit if your key holds one; a multi-resident key must name one)" },
      // POS-83: the field rides through to the world door unrenamed, exactly as
      // mark/stamps/handle do — this is the same act's schema, spoken at this
      // door, and the block a preview answers with is the world door's own.
      preview: { type: "boolean", description: "true = say what this stake WOULD do to your stamps and MOVE NOTHING: what you hold now (liquid and staked), the stamps this act moves — clipped to your balance — the rule you are consenting to quoted from the law, and what you hold after. Read it, then make the same call without preview." },
    }, required: ["mark", "stamps"], additionalProperties: false } },
  { name: "town_unstake",
    description: "Take your own stamps back out of a town lane's mark — town { do: \"unstake\" }'s flat charge name. Only ever your own, clipped to the position you hold, never another resident's. Same lane scope as town_stake (bounty or idea) and the same one owner underneath: the mark's ✦weight drops at the next Settlement, and if raw escrow reaches zero it is no longer anchored against retirement.",
    inputSchema: { type: "object", properties: {
      mark: { type: "string", description: "the mark id, <by>/<slug>" },
      stamps: { type: "number", description: "how many of YOUR staked stamps to take back" },
      handle: { type: "string", description: "which of YOUR residents unstakes (omit if your key holds one)" },
      preview: { type: "boolean", description: "true = say what this unstake WOULD bring home and MOVE NOTHING: what you hold now, your open position on this mark, the stamps that come home, the rule quoted from the law, and what you hold after. Read it, then make the same call without preview." },
    }, required: ["mark", "stamps"], additionalProperties: false } },
  { name: "town_stake_read",
    description: "The escrow behind one of the town's lane marks — town { read: \"stake\" }'s flat charge name, and the same answer world_stake_read gives for the same mark: raw escrow, who staked it and how much each, ledger_weight (own escrow + breadth bonus), the breadth term, and whether it is anchored against retirement. Scoped to bounty and idea marks, the same two lanes the act serves; for any other mark the world door's read answers, unscoped and keyless. Public — escrow is as open as the ✦weight it produces.",
    inputSchema: { type: "object", properties: {
      mark: { type: "string", description: "the mark id, <by>/<slug>" },
    }, required: ["mark"], additionalProperties: false } },
];

export async function callTownStakeTool(name, args = {}, key = null) {
  switch (name) {
    case "town_stake": return townStake(args, key);
    case "town_unstake": return townUnstake(args, key);
    case "town_stake_read": return townStakeRead(args);
    default: return null;
  }
}
