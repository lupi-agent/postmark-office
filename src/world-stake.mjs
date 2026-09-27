// world-stake.mjs — the world_stake / world_unstake doors (write-release P3 DRAFT).
//
// Append-shaped on purpose: a NEW module, so world.mjs only gains an import, a
// spread into WORLD_TOOLS, and two switch cases. (A parallel draft is adding walk
// to the same file; conflicts are the conductor's at review, so the surface each
// draft touches is kept as small as it can be.)
//
// THE LAW IS NOT HERE. Every rule — the balance clip, the no-cap ruling, the meep
// prohibition, ownership on unstake, the retirement gate — lives in the TOWN's own
// tools/world-stake.mjs, imported live from the town clone and never vendored. This
// is the same discipline votes.mjs follows for the ballot and hydrate.mjs for the
// balance fold, and it is the ops-desk lesson stated as code: shell the mint's own
// engine, never reimplement the mint's law in the door.
//
// What the DOOR adds, and only the door can:
//   1. Identity — a stake is signed by the office pen, so the door decides WHO the
//      caller may act as (handle-scoped, choose-or-bounce on a multi-resident key).
//   2. Mark existence — the ledger engine cannot see the world record; the door
//      holds the world clone, so it is the one place that can refuse a stake on a
//      mark that does not exist. Without this a resident could escrow real stamps
//      against an id nothing reads.
//   3. The lock — writes go through a subprocess under the ferry's flock, so a
//      stake append can never race a crossing's mint pass.

import { worldFreezeBounce } from "./freeze.mjs";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { publishedState } from "./world-branches.mjs";
import { guardedDraftsForKey } from "./world2-guards.mjs"; // the §1c delta, over the sketchbook and the journal both (POS-5 slice 1); B1 puts the journal half behind W2_GUARDS
import { forecastForMark } from "./world-forecast.mjs";
import { execUnderTownLock, lockTimedOut, LOCK_BUSY } from "./town-lock.mjs";
import { heldFor, clipTo, stampsBlock, toConfirm, RULE_MARK, NOTHING_MOVED } from "./stamps-preview.mjs"; // POS-83: the confirmation step for every act that moves stamps

const HERE = dirname(fileURLToPath(import.meta.url));
const TOWN_CLONE = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");
const WORLD_CLONE = process.env.WORLD_CLONE ?? resolve(HERE, "..", "world-clone");

const bounce = (code, defect, hint, extra = {}) => ({ error: "bounce", code, defect, hint, ...extra });

/**
 * Should this stake be refused BEFORE the ledger runs? Returns a bounce, or null.
 *
 * ── THE HOLE THIS CLOSES (found by the runbook reviewer, 2026-09-09) ─────────
 *
 * For `n === 0` the promotion result is consulted and a stake that put nothing
 * forward bounces 422. For `n >= 1` it was not: `runExec` ran first and the
 * promotion result was read only to DECORATE the answer, so a stake on a mark
 * the town no longer stands moved real stamps into escrow and came back as a
 * plain stake result — no `put_forward`, no sentence, no refusal. The resident
 * is charged and told nothing.
 *
 * The 2026-09-16 move makes that reachable rather than theoretical: it retires
 * the mark in the store and puts its files in the household's own sketchbook,
 * and `markExists` accepts a mark it finds in the caller's own sketchbook — so
 * the 404 gate waves through exactly the marks this move has just returned.
 *
 * PURE ON PURPOSE. The decision takes the three facts and returns the answer, so
 * the falsifiers can put a retired mark in front of it without a database, and
 * the door and the test cannot drift into two rules.
 */
export function stakeRefusalFor({ mark, n, promoted, status, refused = null, docket = null }) {
  if (!(n >= 1)) return null;                 // the zero path has its own ruling, below
  if (promoted) return null;                  // it went forward; nothing to refuse
  // ── THE PEN ANSWERED NO — DO NOT CHARGE FOR IT (postmark#2722) ────────────
  //
  // Ahead of the store reads below, because this is not a question about the
  // mark's standing at all: the promotion was attempted and REFUSED, so there
  // is no claim, and stamps taken now are the debt with no receipt this file
  // already refuses to create at the other end. `refused` is only ever set for
  // a lawful refusal, never for an unreachable store — that case still falls
  // through to the ledger, unchanged.
  if (refused) return bounce(409, `"${mark}" could not be put forward, so nothing was staked`,
    "your draft is safe and your stamps are untouched — the office could not file it on this crossing's docket, " +
    "and it will not take stamps for a claim it did not file. Try the stake again; if it refuses twice, tell the " +
    "postmaster, because a draft this office cannot put forward is the office's defect, not yours.",
    { held: 0, requested: n });
  if (!status?.known || !status?.found) return null;  // the store cannot say; the ledger still runs
  // ── ON THE OPEN DOCKET IS PUT FORWARD (postmark#3139, Marigold, 2026-09-25) ─
  //
  // `docket` is the open window a pending claim on this mark rides, or null.
  // A withdrawn mark that is put forward again (leave-mark with `amend` and
  // `stamps`) goes PENDING on the open window while its `marks` row stays
  // `retired` until a crossing publishes it, so the retired check below read
  // it as "returned to your drafts" — false, and its hint ("leave it again, or
  // stake the draft") was an act that would put it forward a second time.
  // The escrow is keyed on the mark, not the claim: a stake here adds to what
  // stands behind the one pending row and files nothing new. So it is an
  // ordinary stake, asked before the retired check and after the pen's refusal.
  if (docket != null) return null;
  if (!status.retired) return null;           // it stands; an ordinary stake on a public mark
  // Retired AND on no open docket: the case this bounce was written for.
  return bounce(422, `"${mark}" is not standing — it returned to your drafts`,
    "a mark that has come back to your sketchbook is not on the commons, so there is nothing for stamps to stand behind yet. " +
    "Put it forward first — leave it again with `stamps:`, or stake the draft — and the escrow rides that act, which is what a stake IS.");
}

/**
 * A STAKE THAT HOLDS NOTHING IS NEVER FILED. Returns a bounce, or null.
 *
 * ── THE HOLE THIS CLOSES (postmark-town/postmark #2686, sophia, 2026-09-12) ──
 *
 * A stake on a draft is two writes in one act, and their order is chosen (§ THE
 * BOUNDARY, ARRIVING ON ITS OWN, below): the promotion first, the ledger move
 * second, so the failure that CAN happen is the recoverable one. What was never
 * written was the recovery.
 *
 * Sophia held 0 and staked ✦1 on a commons mark. The promotion succeeded and
 * recorded `stake: 1` — the number ASKED. The ledger moved 0 and said so in its
 * own receipt ("your balance has no stamps free to stake", the town engine's
 * words). Nothing read that receipt, so the docket carried `stake: 1` behind a
 * mark holding nothing for nine hours, indistinguishable from a backed claim,
 * until the candle refused it at the close as nothing staked (window 184).
 * Correct judgment, wrong display, for nine hours.
 *
 * So the door closes its own loop: the act that made the promotion takes it
 * back, in the same act, and answers with the law rather than a receipt nobody
 * reads.
 *
 * ── ITS TWIN AT THE OTHER END ───────────────────────────────────────────────
 *
 * `world2/tools/escrow-presence.mjs § escrowAbsentAmong` is the CANDLE's
 * version of this same rule — "a commons mark needs somebody's stamps behind
 * it" — applied at the close instead of at submit, and printing
 * `⚑ escrow: refused … nothing staked`. Two gates, one rule. They are pinned
 * against one fixture in `test/stake-held.test.mjs`, which is what
 * `test/forecast-sweep-parity.test.mjs` exists to do for the other twinned pair
 * in this office.
 *
 * PURE ON PURPOSE, for `stakeRefusalFor`'s reason one function up: the decision
 * takes the facts and returns the answer, so a falsifier can put an empty
 * balance in front of it with no store, no clone and no crossing.
 *
 * ── THE THREE CASES IT MUST NOT TOUCH ───────────────────────────────────────
 *
 * · `promoted: false` — an ordinary stake on an already-public mark, which
 *   `promoteDraftOnStake` calls "the ordinary answer … and never an error".
 *   This door retracts the promotion IT JUST MADE and nothing else; a pending
 *   row some other act filed is not this act's to take off the docket.
 * · `applied >= 1` — a PARTIAL stake (holds 1, asks 3) leaves something real
 *   behind the mark, and a partially backed claim is the candle's to judge at
 *   the close, not the door's to refuse at submit.
 * · `ownGround` anything but `false` — the 2026-08-28 ruling makes an own-ground
 *   mark publishable with nothing behind it, and `null` means the office could
 *   not tell. Refusing on "could not tell" would retract a lawful publication
 *   over a geometry engine that failed to load.
 */
export function unbackedRefusalFor({ mark, n, promoted, applied, ownGround }) {
  if (!(n >= 1)) return null;              // ✦0 has its own ruling, below
  if (!promoted) return null;              // this act promoted nothing; nothing to take back
  if (Number(applied) !== 0) return null;  // something is held; the candle judges how much
  if (ownGround !== false) return null;    // own ground, or the office could not say
  return bounce(422, `nothing held — the claim on "${mark}" was not filed`,
    "you hold 0 stamps, and a claim on the commons is backed or it is not made — so the mark stays " +
    "your private draft rather than standing on the docket with nothing behind it. Stamps are earned by " +
    "corresponding: the quest board (`read_quests`) pays one per unit toward the daily pair, reaching out " +
    "and being reached. The claim files itself the moment it is backed — stake it again with a stamp behind " +
    "you and that same act puts it forward.",
    { held: 0, requested: n });
}

// Which resident is acting. Mirrors world.mjs's stand-as decision: one handle needs
// no argument, several must name one, and naming a handle the key does not hold is a
// 403 rather than a silent substitution.
function actingAs(named, key) {
  const handles = [...(key?.handles ?? [])];
  if (named) {
    if (!key?.handles?.has(named))
      return { bounce: bounce(403, `"${named}" is not one of your residents`,
        handles.length ? `this key acts for: ${handles.join(", ")}` : "no residents on this key — sign in, or use a household key") };
    return { handle: named };
  }
  if (handles.length > 1)
    return { bounce: bounce(422, "which resident is staking?",
      `this key acts for ${handles.length} residents — pass handle: one of ${handles.join(", ")}`, { choices: handles }) };
  if (handles.length === 1) return { handle: handles[0] };
  return { bounce: bounce(403, "this key acts for no resident", "sign in, or use a household key") };
}

// Does the mark exist in the world the CALLER can see? The one gate the ledger
// cannot keep, and it is answered in TWO LOOKS because the world has two layers:
// published canon, then the caller's own sketchbook (Keemin's ruling 2026-07-30:
// stamps may back a draft mark before Settlement publishes it — escrow is
// exactly what publishes an off-parcel mark, so gating stakes on publication was
// a deadlock). Another household's unpublished drafts stay invisible here on
// purpose: you cannot back what you cannot see. Canon is read at the REF, never
// from the checkout's working-tree file (the checkout sits on whatever branch
// the pen last wrote — its file is nobody's truth).
// ASYNC since B1 (runbook §4 B1): the second look reads the draft overlay, and
// under `W2_GUARDS=1` that overlay's journal half is a Postgres round trip. The
// one caller (`worldStakeAct` below) was already async.
export async function markExists(mark, key = null) {
  if (!existsSync(join(WORLD_CLONE, ".git")))
    return { known: false, reason: "the office has no world clone to check against" };
  try {
    const { state } = publishedState(WORLD_CLONE);
    // `record` rides back with the answer since 2026-09-12, additively: the
    // unbacked-stake refusal below has to ask whose GROUND this mark stands on,
    // and the record it needs is the one this function has just found. Looking
    // it up a second time would be a second reading of the same two layers,
    // with the drift that implies — and this half of the door already pays for
    // the canon read.
    const canonRow = (state?.marks ?? []).find((m) => m.id === mark);
    if (canonRow) return { known: true, exists: true, record: canonRow };
    // THE SECOND LOOK — your own drafts count (2026-08-22). The world read is
    // canon for everyone, so a resident staking the draft they just left would
    // bounce 404 on a mark sitting on their own branch; that is exactly what
    // happened the morning of the party. This is not a workaround for the read
    // serving canon — it is the permanent shape of the pair: canon at the ref,
    // then the delta (a git diff plus a few file reads, O(k), no fold), which
    // only ever shows the caller their OWN sketchbook.
    if (key) {
      const delta = await guardedDraftsForKey(WORLD_CLONE, key);
      const draftRow = delta?.error ? null
        : (delta?.marks ?? []).find((m) => m.id === mark && m.status !== "deleted");
      if (draftRow) return { known: true, exists: true, record: draftRow };
    }
    return { known: true, exists: false };
  } catch { return { known: false, reason: "the world record could not be read" }; }
}

const townDay = () => new Date().toLocaleDateString("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" });

// Read-side: what a mark carries, and who put it there. No key needed — escrow is
// public, the way a mark's ✦weight already is in every telling.
export async function worldStakeRead(args = {}) {
  const mark = args.mark;
  if (!mark) return bounce(422, "which mark?", "pass mark: '<by>/<slug>'");
  if (!existsSync(join(TOWN_CLONE, "tools", "world-stake.mjs")))
    return bounce(503, "not-yet-open", "the office has no town clone carrying the world-stake engine");
  const mod = await import(pathToFileURL(join(TOWN_CLONE, "tools", "world-stake.mjs")));
  const state = mod.worldStakeState(TOWN_CLONE);
  const holders = [];
  for (const [k, n] of state.positions) {
    const i = k.lastIndexOf("|");
    if (k.slice(0, i) === mark) holders.push({ handle: k.slice(i + 1), stamps: n });
  }
  // WHY THE BREADTH TERM IS SHOWN, not just the total (2026-08-10). This door
  // used to answer "what does this mark carry" with raw escrow and a holder
  // list, while every telling printed a LARGER ✦ figure — the same mark, two
  // numbers, and nothing at either surface explaining the gap. The gap is the
  // unique-external-household bonus, so the door now names it: `stamps` is what
  // residents put in, `weight` is what the mark carries because of it, and
  // `breadth` is the difference with its reason attached.
  //
  // The town's derive is the ONLY place k is known or applied — this reads its
  // answer and never recomputes it. `fanned` is deliberately absent: fan-up is
  // the world's tree, not the ledger's, and this door only sees money.
  // `ledger_weight`, NOT `weight` — the third meaning this branch exists to stop
  // (founder's ruling, 2026-08-10). What this door can compute is own escrow plus
  // the breadth bonus: 18 on pando-peak. The ✦ the telling prints for that same
  // mark is 108, because it also carries everything sitting inside it fanning up,
  // which is the WORLD's tree and invisible from the ledger. Two different
  // quantities under one word is how `stamps` came to mean weight; naming it
  // while it still has zero readers is the cheapest this fix will ever be.
  const derived = mod.deriveWorldMarkWeights(TOWN_CLONE, state);
  const row = derived.marks.find((m) => m.mark === mark) ?? null;
  const escrow = mod.markEscrow(TOWN_CLONE, mark, state);
  // THE FUTURE TENSE, beside the present one (the-town/the-tenses). Everything
  // above is the ledger as it stands; `proposed` is what the next crossing will
  // make of it, folded by the crossing's own judgment. Absent when the next save
  // would say what the last one already did — a door that announced "no change"
  // would be adding a sentence to every mark in the world to say nothing.
  const proposed = await forecastForMark(mark, { worldClone: WORLD_CLONE, townClone: TOWN_CLONE });
  return {
    mark,
    escrow,
    stamps: escrow,
    ledger_weight: row?.weight ?? escrow,
    breadth: {
      k: derived.k ?? null,
      external_households: row?.households_external ?? 0,
      households: row?.households ?? 0,
      bonus: (row?.weight ?? escrow) - escrow,
    },
    // Said plainly in the payload, because a field name can only carry so much
    // and this one is a genuine trap for anything comparing the two doors.
    _note: "ledger_weight is own escrow + breadth bonus. The ✦weight in the telling also includes marks inside this one fanning up — see world_investigate.weight_parts.",
    holders: holders.sort((a, b) => b.stamps - a.stamps),
    retirement: mod.retirementBlocked(TOWN_CLONE, mark, state),
    ...(proposed ? { proposed } : {}),
  };
}

// Ruling 9 portfolio seam. Household is the exposure grain, so the town's own
// identity pins decide which resident positions and authored marks belong in
// this view; the office never reimplements that mapping.
// `also` is a SECOND source of mark bodies — the caller's own live layer (their
// drafts and docket claims). It exists because of the row the 2026-09-06 walk
// read on their own staked mark:
//
//     { id: "wright/the-flip-day-plumb-line", by: null, kind: null, tier: null,
//       body: null, holder: "wright", stamps: 1, yours: false }
//
// Every field null and `yours: false`, on a mark whose stake the very same
// answer had just named. The cause is one line below: `byId` was built from
// PUBLISHED canon alone, so a mark that has not crossed yet has no row to draw
// from — and `yours` was computed off that missing row. A mark not yet on the
// world is exactly the case a resident is asking about.
export async function worldPortfolioStakeSlice(key, marks = [], { also = [] } = {}) {
  const household = String(key?.household ?? "").trim();
  if (!household || key?.visitor || !(key?.handles instanceof Set) || key.handles.size === 0)
    return bounce(403, "no resident household at this door", "sign in as a resident household to read your marks");
  if (!existsSync(join(TOWN_CLONE, "tools", "world-stake.mjs")))
    return bounce(503, "not-yet-open", "the office has no town clone carrying the world-stake derive");

  const mod = await import(pathToFileURL(join(TOWN_CLONE, "tools", "world-stake.mjs")));
  const stakeState = mod.worldStakeState(TOWN_CLONE);
  const derived = mod.deriveWorldMarkWeights(TOWN_CLONE, stakeState);
  // The pins are the ONE household registry. The key's own household string is a
  // different vocabulary (gh login via OAuth, keys-file slug via pen — e.g.
  // "keeminlee") than the pins' ids (e.g. "gh:67605380"), so comparing them
  // directly can never match on real data — the misattribution Rei found the
  // night ruling 9 went live. Resolve the CALLER through the pins too: the
  // household a caller belongs to is the pins-household of their own handles.
  const pinsHousehold = [...key.handles]
    .map((h) => stakeState.currentHouseholdOf(h))
    .find(Boolean) ?? household;
  const belongs = (handle) => stakeState.currentHouseholdOf(handle) === pinsHousehold;
  // Canon first, the caller's own live layer second — canon wins on a shared
  // id, because a published mark's fields are the town's answer and a draft
  // copy of one is the author's proposal.
  const byId = new Map([...also, ...marks].map((mark) => [mark.id, mark]));
  const residents = [...new Set(marks.map((mark) => mark.by).filter(belongs))].sort();
  const backed = derived.rows
    .filter((row) => belongs(row.holder))
    .map((row) => backedRow(row, { mark: byId.get(row.mark), belongs }))
    .sort((a, b) => a.id.localeCompare(b.id) || a.holder.localeCompare(b.holder));
  return { household, residents, backed };
}

/**
 * ONE ROW OF THE BACKED LIST — a stake of yours, and the mark it stands behind.
 *
 * Exported and PURE because it is the decision, not the plumbing: `yours` is a
 * sentence the town says to a resident about their own work, and it was wrong
 * for as long as it was computed off a record that had not been written yet.
 * A falsifier that could only reach it through a town clone and a stake state
 * would be asserting the fixture.
 *
 * ⚑ THE OWNER IS IN THE ID (2026-09-07). A mark id IS `<by>/<slug>` — "the 1.0
 * path identity", 006's own words — so the author is readable from the identity
 * alone, with no record to look up. The old line read `yours: Boolean(mark &&
 * belongs(mark.by))`, and `mark` came from PUBLISHED canon only, so a mark that
 * had not crossed yet produced `{ by: null, kind: null, tier: null, body: null,
 * holder: "wright", stamps: 1, yours: false }` — a resident's own staked mark,
 * every field empty, declared not theirs, in the same answer that named the
 * stake behind it (walk of 2026-09-06).
 */
export function backedRow(row, { mark = null, belongs = () => false } = {}) {
  const by = mark?.by ?? String(row.mark ?? "").split("/")[0] ?? null;
  return {
    id: row.mark,
    by: by || null,
    kind: mark?.kind ?? null,
    tier: mark?.tier ?? null,
    body: mark?.body ?? null,
    // WHERE IT STANDS (2026-09-10) — see world.mjs § published rows for the
    // ruling and the reason. Absent rather than null when the mark carries
    // neither, and absent again when there is no mark at all: the `unread`
    // arm below already says the record is elsewhere, and a null `at` beside
    // that sentence would be a second, weaker way of saying the same thing —
    // one that reads as "somewhere unknown" instead of "not in hand here".
    ...(mark?.at ? { at: mark.at } : {}),
    ...(mark?.extent ? { extent: mark.extent } : {}),
    // Absent from canon AND from the caller's live layer: say so, rather than
    // letting four nulls read as "a mark with no kind and no body".
    ...(mark ? {} : { unread: "this mark's fields are in neither published canon nor your own live layer — the stake is real and its record is elsewhere" }),
    holder: row.holder,
    stamps: Number(row.n ?? 0),
    // `holder_weight`, not `weight` — a FOURTH quantity, and the narrowest:
    // this one holder's row, their own escrow plus the breadth bonus if theirs
    // was the row that earned it. It is not the mark's ✦weight and not even the
    // mark's ledger_weight. Sitting beside published[].weight (fully effective)
    // under the same word made the portfolio read as though a resident's stake
    // and a mark's standing were one scale. Audited before renaming: no
    // consumer read it — the viewer's backedPosition reads `stamps` only, the
    // site reads none of it.
    holder_weight: Number(row.weight ?? row.n ?? 0),
    yours: Boolean(by && belongs(by)),
  };
}

async function runExec(payload) {
  const exec = join(HERE, "world-stake-exec.mjs");
  const env = { ...process.env, TOWN_CLONE };
  let out;
  try {
    out = await execUnderTownLock(exec, JSON.stringify(payload), env);
  } catch (e) {
    if (lockTimedOut(e)) return bounce(LOCK_BUSY.code, LOCK_BUSY.defect, LOCK_BUSY.hint);
    return bounce(500, "the stake could not be recorded", String(e.stderr ?? e.message ?? e).slice(0, 300));
  }
  let parsed;
  try { parsed = JSON.parse(String(out).trim().split("\n").pop()); }
  catch { return bounce(500, "the stake exec returned nothing readable", String(out).slice(0, 200)); }
  if (parsed?.error) return { error: "bounce", ...parsed.error };
  return parsed;
}

// ── `deps` — SO THE ONE LINE THAT STOPS THE CHARGE CAN BE FALSIFIED ─────────
//
// The shape `arenaActViaOffice` and `enterViaOffice` already use, and here for
// a reason worth writing down: the #2722 repair is a `catch` that tells a
// lawful refusal from an outage, and a unit test of `stakeRefusalFor` cannot
// reach it. The reviewer proved that by flipping the catch's class name to one
// that never arrives — the debit came back and the suite stayed green, because
// nothing drove this door with a pen that refuses. Three collaborators are
// injectable now, and the falsifier watches whether `ledger` is called AT ALL:
// "the resident was not charged" is an absence, and an absence needs a witness.
//
// Defaults are the real ones, so no caller changes and the office is untouched.
export async function worldStakeViaOffice(args = {}, key = null, deps = {}) {
  const {
    exists = markExists,
    ledger = runExec,
    promote = async (p) => (await import("./world2-claims.mjs")).promoteDraftOnStake(p),
    standing = async (p) => (await import("./world2-claims.mjs")).markStandingStatus(p),
    // THE FOURTH COLLABORATOR (POS-83), injectable for the same reason as the
    // other three: `TOWN_CLONE` is fixed at MODULE LOAD, so a falsifier that
    // could not pass its own clone in would be asserting whichever ledger
    // happened to be on the box — and the clip case, which is the founder's
    // whole reason for asking, is only reachable against a balance you control.
    held = (handle) => heldFor(TOWN_CLONE, handle),
  } = deps;
  const who = actingAs(args.handle, key);
  if (who.bounce) return who.bounce;
  if (!args.mark) return bounce(422, "which mark?", "pass mark: '<by>/<slug>' — ids as they appear in the telling");
  const n = Number(args.stamps);
  // ✦0 IS NOW A LAWFUL STAKE, on your own ground only (Keemin's ruling,
  // 2026-08-28). Staking is what puts a mark forward, and on ground your
  // household already holds there is nothing to buy — so a zero stake is a
  // deliberate putting-forward rather than a no-op, and refusing it here would
  // make your own ground the one place you could not publish. The GROUND check
  // is not this door's: `promoteDraftOnStake` reaches a claim only through the
  // row policy, and a zero that the ground refuses simply promotes nothing and
  // is answered as such below.
  if (!Number.isInteger(n) || n < 0) return bounce(422, "how many stamps?", "pass stamps: a whole number — at least 1 on the commons, or 0 on your own household's ground, where a zero stake still puts the mark forward");

  // the door's own gate: the ledger cannot see the world record
  const ex = await exists(args.mark, key);
  if (ex.known && !ex.exists)
    return bounce(404, `no mark "${args.mark}" in the world you can see`,
      "ids are <by>/<slug> as the telling shows them — you can back published marks and your own household's drafts; another household's draft becomes stakeable when Settlement publishes it");

  // ── PREVIEW (POS-83; the founder's word 2026-09-14, postmark#2814) ────────
  //
  // SAY IT, MOVE NOTHING — the same grammar the mark preview keeps (#2692,
  // world.mjs § PREVIEW): every gate above has run, and what a real stake does
  // from here is promote the draft and move the escrow. A preview does neither,
  // so it stops here and answers with the thing no door said before the write:
  // what you hold, what this act moves, the rule you are consenting to, and what
  // you hold after.
  //
  // THE ONE REFUSAL IT CAN STILL RUN is the retirement gate, because
  // `stakeRefusalFor` is pure and the standing read is a read. It is asked with
  // `promoted: false` — the answer for every stake on an already-public mark,
  // which `promoteDraftOnStake` itself calls "the ordinary answer … and never an
  // error". On a retired mark whose promotion WOULD carry it forward that makes
  // the preview stricter than the act, which is the safe direction this file
  // argues for everywhere else: the cost is a resident who calls anyway and
  // succeeds, never a resident charged for a claim that was never filed.
  //
  // NOT RUN, and named here rather than faked: the promotion's own refusal (it
  // requires MAKING the promotion) and the unbacked-claim refusal (it reads what
  // the ledger actually moved). A preview whose `this_act` shows ✦0 is the same
  // fact from the other side, and it shows it without charging anyone.
  if (args.preview === true) {
    let status = { known: false };
    try { status = await standing({ slug: args.mark }); }
    catch (e) { console.error(`[world-stake] preview could not read the store's standing for "${args.mark}": ${String(e?.message ?? e)}`); }
    const refusal = stakeRefusalFor({ mark: args.mark, n, promoted: false, status, refused: null, docket: status?.docket_window ?? null });
    if (refusal) return { ...refusal, preview: true };
    const now = await held(who.handle);
    const { moves } = clipTo(n, now.liquid);
    return {
      preview: true, mark: args.mark, handle: who.handle,
      stamps: stampsBlock({
        held: now, moves, requested: n, direction: "stake", rule: RULE_MARK,
        // ✦0 IS LAWFUL ON YOUR OWN GROUND and moves nothing either way, so the
        // block says so in the door's own two-case sentence rather than showing
        // a bare zero. Which case you are in is the promotion's ruling, and the
        // promotion is exactly what a preview does not make.
        ...(n === 0 ? { reason: "a zero stake moves no stamps — on your own household's ground it still puts the mark forward, and on the commons it is refused with your draft left standing" } : {}),
        to_confirm: toConfirm(`world { do: "stake", args: { mark: "${args.mark}", stamps: ${n} } }`),
      }),
      nothing_written: NOTHING_MOVED,
    };
  }

  // ── THE BOUNDARY, ARRIVING ON ITS OWN ───────────────────────────────────
  //
  // You composed something, slept on it, and now you back it. The promotion
  // runs FIRST and the ledger move second, in that order deliberately: if the
  // escrow write fails, a mark that is merely public-too-early can be retracted
  // before the close (retraction is free until then, gold §1), whereas stamps
  // taken for a mark that never reached the docket are a debt with no receipt.
  // Of the two failure shapes, this is the recoverable one.
  const by = String(args.mark).slice(0, String(args.mark).indexOf("/"));
  let putForward = null;
  let promotionRefused = null;
  try {
    // NOTHING IS WRITTEN ONTO THE CLAIM ABOUT WHAT IS HELD, deliberately
    // (ruled 2026-09-12). `stake` here is the number ASKED and it stays that;
    // what is actually behind the mark is DERIVED on the docket read from
    // `escrow_projection`, through the candle's own reader. See
    // world2-claims.mjs § WHY THE ROW DOES NOT SAY WHAT IT HOLDS.
    putForward = await promote({
      actor: by, householdName: key?.household, slug: args.mark, stamps: n });
  } catch (e) {
    // The docket is a shadow-era pen; a store that is down must not swallow a
    // resident's stake. Loud, and the ledger still runs.
    console.error(`[world-stake] the docket could not be reached for "${args.mark}": ${String(e?.message ?? e)}`);
    // ── AN OUTAGE AND A REFUSAL ARE DIFFERENT FACTS (postmark#2722) ────────
    //
    // The posture above is right for a store that is DOWN and wrong for a
    // store that ANSWERED NO. On 2026-09-12 the pen refused Sophia's promotion
    // by law — a certified window may not be rewritten — this catch logged it,
    // and the ledger below debited ✦1 for a claim that was never filed. That
    // is the thing this file calls "a debt with no receipt" eleven lines down,
    // arriving through the one door that was not watching for it.
    //
    // So a refusal is remembered and refuses the stake before the ledger runs;
    // an unreachable store keeps the old posture exactly. Named by class rather
    // than by message, because the message is the notary's to reword.
    if (e?.name === "LateCrossingError") promotionRefused = e;
  }

  if (n === 0) {
    return putForward?.promoted
      ? { mark: args.mark, staked: 0, put_forward: true, claim: putForward.claim,
          effect: "put forward with no escrow — it stands on your own household's ground, where nothing needs buying. It is on the public docket now and locks, or is refused by name, at the next crossing." }
      : bounce(422, "a zero stake puts forward only your own ground's marks",
          `"${args.mark}" is not a private draft of yours standing on your household's own ground — a commons mark publishes only with escrow behind it, so stake at least ✦1 to put it forward`);
  }

  // BEFORE THE LEDGER, NOT AFTER. Stamps taken for a mark that never reached the
  // docket are "a debt with no receipt" in this function's own words a few lines
  // up; a retired mark is that case, and the promotion above already told us it
  // did not go forward.
  //
  // AND THAT IS NOT A RARE PATH — an earlier draft of this comment said it was,
  // and the reviewer was right to call it. `promoteDraftOnStake` answers
  // `{ promoted: false }` for EVERY stake on an already-public mark, which its
  // own doc-comment calls "the ordinary answer ... and never an error". So this
  // read runs on essentially every ordinary stake. It is one indexed lookup on
  // `marks.slug` against a store the door already holds a pool to, which is why
  // it is affordable; it is not an exceptional case, and the comment should not
  // have claimed it was.
  let status = { known: false };
  try {
    status = await standing({ slug: args.mark });
  } catch (e) {
    // Same posture as the promotion above: a store that is down must not swallow
    // a resident's stake. Loud, and the ledger still runs.
    console.error(`[world-stake] could not read the store's standing for "${args.mark}": ${String(e?.message ?? e)}`);
  }
  // THE DOCKET FACT rides the standing read (postmark#3139): one statement,
  // no second query, and only when this act did not itself put the mark forward.
  const docket = putForward?.promoted ? null : (status?.docket_window ?? null);
  const refusal = stakeRefusalFor({ mark: args.mark, n, promoted: !!putForward?.promoted, status, refused: promotionRefused, docket });
  if (refusal) return refusal;

  // THE RECEIPT'S OWN BLOCK, READ BEFORE THE MOVE (POS-83). The staked tense is
  // not on the engine's answer — `worldStakeApply` returns balances, not the
  // open-stake total — so it has to be read here, and reading it AFTER would be
  // reading the world this act has just changed. The liquid half is taken from
  // the engine's own `balance_before` below where it gives one, because those
  // numbers are folded under the ferry's flock and an answer carrying two
  // different "before" figures for one resident would be contradicting itself.
  const heldBefore = await held(who.handle);

  const staked = await ledger({ verb: "stake", handle: who.handle, mark: args.mark, n, via: "api", date: townDay() });
  if (staked?.error) return staked;

  // ── THE DOOR CLOSES ITS OWN LOOP (#2686) ─────────────────────────────────
  //
  // The ledger has answered. `applied` is what it actually moved — the town
  // engine clips to the liquid balance (`worldStakeApply`: `applied =
  // Math.min(n, balance)`) — and it is the only number that says what stands
  // behind this mark. If it is zero on the commons, the promotion above put a
  // claim on the public docket that nothing backs, and THIS ACT takes it back
  // rather than leaving the candle to say so nine hours later.
  //
  // The ground read runs only here, on the path where the balance came up
  // empty, and only through `world.mjs § markStandsOnOwnGround` — the leave-
  // mark door's own rule, asked rather than copied. It is imported lazily
  // because world.mjs imports this file.
  const applied = Number(staked?.applied ?? 0);
  // THE SAME BLOCK THE PREVIEW SHOWS (POS-83) — this is the half that reaches
  // every existing caller without changing their flow, so an agent that skipped
  // the preview still reads, right then, what it just did to its stamps.
  const stampsAt = stampsBlock({
    held: { ...heldBefore, liquid: Number(staked?.balance_before ?? heldBefore.liquid) },
    moves: applied, requested: n, direction: "stake", rule: RULE_MARK,
    // The engine's own sentence when it moved nothing, carried rather than
    // paraphrased — it is the reason the numbers below look the way they do.
    ...(staked?.reason ? { reason: staked.reason } : {}),
  });
  if (putForward?.promoted && n >= 1 && applied === 0) {
    let ownGround = null;
    try {
      const { markStandsOnOwnGround } = await import("./world.mjs");
      const rec = ex?.record ?? null;
      if (rec) ownGround = await markStandsOnOwnGround({
        by, at: rec.at, extent: rec.extent, points: rec.points, parent_id: rec.parent_id ?? rec.parent ?? null });
    } catch (e) {
      console.error(`[world-stake] the ground under "${args.mark}" could not be read: ${String(e?.message ?? e)}`);
    }
    const unbacked = unbackedRefusalFor({ mark: args.mark, n, promoted: true, applied, ownGround });
    if (unbacked) {
      // THE PROMOTION THIS ACT MADE, TAKEN BACK BY THIS ACT. `retractPendingClaim`
      // is the one retraction the withdraw arm also uses, so the row lands in
      // the crossing's own `retracted_before_close` account rather than
      // vanishing — 007's delete guard forbids removing a row the docket has
      // carried, and the tally is the reason not to want to.
      //
      // A retraction that FAILS must not turn into a silent success: the
      // resident would be told the claim was never filed while it sat pending.
      // So the refusal only goes out when the row is actually off the docket.
      try {
        const { retractPendingClaim } = await import("./world2-claims.mjs");
        const undone = await retractPendingClaim(null,
          { windowId: putForward.window, slug: args.mark, claimant: by });
        if (!undone) throw new Error("no pending row came back off the docket");
        return unbacked;
      } catch (e) {
        console.error(`[world-stake] the unbacked promotion of "${args.mark}" could not be retracted: ${String(e?.message ?? e)}`);
        return bounce(500, `nothing was held behind "${args.mark}" and the claim could not be taken back`,
          "the stamp ledger moved nothing, so this claim stands on the docket with nothing behind it and the " +
          "candle will refuse it by name at the next crossing. Withdraw it (`world { do: \"withdraw-mark\" }`) " +
          "or back it before the close — and tell the postmaster, because a promotion this office could not " +
          "retract is the office's defect, not yours.", { held: 0, requested: n });
      }
    }
  }

  // WHAT ACTUALLY MOVED, in the sentence too. This read `✦${n} stands behind
  // it` — the number ASKED — so a clipped stake told a resident holding 1 that
  // three stamps stood behind their mark. The receipt beside it has always
  // carried `applied` and `clipped`; the prose was the half that had not been
  // told.
  return putForward?.promoted
    ? { ...staked, stamps: stampsAt, put_forward: true, claim: putForward.claim,
        // A DRAFT THAT SLEPT THROUGH A CROSSING SAYS SO (postmark#2722). The
        // deed files into the window the resident put it forward in, keeping
        // the crossing it was composed in on its payload — so the answer names
        // both windows rather than quietly moving one.
        ...(putForward.late_from ? { late_from_crossing: putForward.late_from } : {}),
        effect: (putForward.late_from
          ? `your draft from crossing ${putForward.late_from} is put forward in window ${putForward.window} with ✦${applied} behind it — it is on the public docket now, and locks or is refused by name at the next crossing.`
          : `✦${applied} stands behind it and that is what put it forward — it is on the public docket now, and locks or is refused by name at the next crossing.`)
          + (applied < n ? ` You asked for ✦${n}; your balance carried ✦${applied}, and ✦${applied} is what the ledger moved.` : "") }
    : docket != null
      // ALREADY PUT FORWARD (postmark#3139): the escrow joined the one pending
      // claim on this window's docket, and the answer says which window.
      ? { ...staked, stamps: stampsAt, window: docket,
          effect: (applied > 0
            ? `✦${applied} more stands behind it on window ${docket}'s docket — the same claim, not a second one; it locks or is refused by name at that crossing.`
            : `nothing more stands behind it — it is on window ${docket}'s docket as it was, and locks or is refused by name at that crossing.`)
            + (applied > 0 && applied < n ? ` You asked for ✦${n}; your balance carried ✦${applied}, and ✦${applied} is what the ledger moved.` : "") }
      : { ...staked, stamps: stampsAt };
}

// `deps` here for the reason it exists on the stake door one function up: the
// POS-83 block is computed beside a subprocess and a pen, and a falsifier that
// could only reach it through both would be asserting the fixture. Defaults are
// the real ones, so no caller changes.
export async function worldUnstakeViaOffice(args = {}, key = null, deps = {}) {
  const {
    ledger = runExec,
    // The resident's OWN open position on this mark — the ceiling an unstake
    // clips to. The town's own exported read; the office never folds positions.
    position = async (mark, handle) => {
      const enginePath = join(TOWN_CLONE, "tools", "world-stake.mjs");
      if (!existsSync(enginePath)) return null;
      const mod = await import(pathToFileURL(enginePath));
      return mod.markPosition(TOWN_CLONE, mark, handle);
    },
    // Injectable for the same reason as on the stake door: `TOWN_CLONE` is fixed
    // at module load, so a falsifier could not otherwise put a known ledger in
    // front of the block it is asserting about.
    held = (handle) => heldFor(TOWN_CLONE, handle),
  } = deps;
  const who = actingAs(args.handle, key);
  if (who.bounce) return who.bounce;
  if (!args.mark) return bounce(422, "which mark?", "pass mark: '<by>/<slug>'");
  const n = Number(args.stamps);
  if (!Number.isInteger(n) || n < 1) return bounce(422, "how many stamps?", "pass stamps: a whole number of at least 1");
  // No mark-existence gate here on purpose: taking your stamps back out of a mark
  // must never be blocked by the state of the world record. If a mark somehow left
  // the record while your escrow stood, unstaking is precisely the repair.

  // ── PREVIEW (POS-83) ─────────────────────────────────────────────────────
  // The same shape as the stake's, one ceiling different: an unstake clips to
  // the position you HOLD on that mark, never to your balance ("you can never
  // take out more than you put in", the engine's own words). A position that
  // cannot be read is stated rather than guessed at — a preview claiming ✦3 come
  // home when the office could not see the escrow would be the precise lie this
  // door exists to stop.
  if (args.preview === true) {
    const now = await held(who.handle);
    let open = null;
    try { open = await position(args.mark, who.handle); }
    catch (e) { console.error(`[world-stake] preview could not read the position on "${args.mark}": ${String(e?.message ?? e)}`); }
    if (open == null)
      return { preview: true, mark: args.mark, handle: who.handle,
        you_hold: { liquid: now.liquid, staked: now.staked },
        unread: "the office has no town clone carrying the world-stake engine, so your open position on this mark could not be read — what an unstake would bring home cannot be previewed here",
        nothing_written: NOTHING_MOVED };
    const { moves } = clipTo(n, open);
    return {
      preview: true, mark: args.mark, handle: who.handle, position: open,
      stamps: stampsBlock({
        held: now, moves, requested: n, direction: "unstake", rule: RULE_MARK,
        to_confirm: toConfirm(`world { do: "unstake", args: { mark: "${args.mark}", stamps: ${n} } }`),
      }),
      nothing_written: NOTHING_MOVED,
    };
  }

  const heldBefore = await held(who.handle);
  const out = await ledger({ verb: "unstake", handle: who.handle, mark: args.mark, n, date: townDay() });
  if (out?.error) return out;
  // The engine answers an unstake with POSITIONS, never balances — so both halves
  // of the block are derived from the fold above, unlike the stake path where
  // `balance_before` arrives with the receipt. The arithmetic is the law's:
  // stamps that come out of escrow come home to liquid.
  return { ...out, stamps: stampsBlock({
    held: heldBefore, moves: Number(out?.applied ?? 0), requested: n, direction: "unstake", rule: RULE_MARK,
    ...(out?.reason ? { reason: out.reason } : {}),
  }) };
}

/**
 * THE MARK-STAKE BLOCK, FOR A DOOR THAT IS NOT THIS ONE (POS-83).
 *
 * The inline `stamps: N` on `world_leave_mark` is a stake — it reaches the
 * ledger through `worldStakeViaOffice` above — so its preview owes the same
 * block, and `world.mjs` has no town clone of its own to read it from. One
 * owner, asked; never a second copy of the read and the clip beside it.
 */
export async function markStakeBlock({ handle, stamps, to_confirm = null, clone = TOWN_CLONE }) {
  const held = await heldFor(clone, handle);
  const { moves } = clipTo(stamps, held.liquid);
  return stampsBlock({ held, moves, requested: stamps, direction: "stake", rule: RULE_MARK, to_confirm });
}

export const WORLD_STAKE_TOOLS = [
  { name: "world_stake",
    description: "Put your stamps behind a mark in the told world — and if the mark is one of your own private drafts, THIS IS WHAT PUBLISHES IT. Staking is the private/public boundary: a commons mark publishes only with escrow behind it, so backing your draft is the same motion as putting it on the public docket, and it crosses once. On your OWN household's ground the lawful minimum is zero, so stamps: 0 there is a real putting-forward with nothing to buy; on the commons a zero is refused with the law named and your draft stays private. Staked stamps leave your spendable balance and sit in escrow on the mark, raising its ✦weight at the next Settlement — the presence every telling ranks by, with a breadth bonus for each unique staking household, and the weight fans up to whatever contains it. They are yours the whole time: world_unstake takes them back. A stake also anchors the mark's existence — a mark with stamps on it cannot be retired. There is no per-household cap; the door clips only to your liquid balance and tells you what it applied.",
    inputSchema: { type: "object", properties: {
      mark: { type: "string", description: "the mark id, <by>/<slug>, as the telling shows it" },
      stamps: { type: "number", description: "how many stamps to put behind it (whole stamps)" },
      handle: { type: "string", description: "which of YOUR residents stakes (omit if your key holds one; a multi-resident key must name one)" },
      preview: { type: "boolean", description: "true = say what this stake WOULD do to your stamps and MOVE NOTHING: what you hold now (liquid and staked), the stamps this act moves — clipped to your balance, and the clip stated as a clip — the rule you are consenting to quoted from the law, and what you hold after. No escrow, no ledger row, no promotion. Read it, then make the same call without preview." },
    }, required: ["mark", "stamps"], additionalProperties: false } },
  { name: "world_unstake",
    description: "Take your own stamps back out of a mark. Only ever your own — an unstake clips to the position you hold on that mark, never another resident's, and never more than you put in. The mark's ✦weight drops at the next Settlement, and if raw escrow reaches zero it is no longer anchored against retirement.",
    inputSchema: { type: "object", properties: {
      mark: { type: "string", description: "the mark id, <by>/<slug>" },
      stamps: { type: "number", description: "how many of YOUR staked stamps to take back" },
      handle: { type: "string", description: "which of YOUR residents unstakes (omit if your key holds one)" },
      preview: { type: "boolean", description: "true = say what this unstake WOULD bring home and MOVE NOTHING: what you hold now (liquid and staked), your open position on this mark, the stamps that come home — clipped to that position — the rule quoted from the law, and what you hold after. Read it, then make the same call without preview." },
    }, required: ["mark", "stamps"], additionalProperties: false } },
  { name: "world_stake_read",
    description: "What a mark carries on the LEDGER: its raw escrow (`stamps`/`escrow`), who staked it and how much each, `ledger_weight` (own escrow + breadth bonus), the `breadth` term that separates the two — k paid once per unique EXTERNAL household, never to the mark's own — and whether it is currently anchored against retirement. `ledger_weight` is NOT the ✦weight a telling prints: the effective ✦weight also includes marks sitting inside this one fanning up, which lives on world_investigate (`weight` and its `weight_parts` breakdown). Public — escrow is as open as the ✦weight it produces.",
    inputSchema: { type: "object", properties: {
      mark: { type: "string", description: "the mark id, <by>/<slug>" },
    }, required: ["mark"], additionalProperties: false } },
];

export async function callWorldStakeTool(name, args = {}, key = null) {
  if (name === "world_stake" || name === "world_unstake") { const fz = worldFreezeBounce(); if (fz) return fz; }
  switch (name) {
    case "world_stake": return worldStakeViaOffice(args, key);
    case "world_unstake": return worldUnstakeViaOffice(args, key);
    case "world_stake_read": return worldStakeRead(args);
    default: return null;
  }
}
