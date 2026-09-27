// world-hold.mjs — WHO HOLDS WHAT. The object primitive's one verb.
//
// `give`, `drop` and `take` are three faces of one act: DECLARE THE HOLDING.
// The edit law has one primitive ("to act is to declare an edge; everything
// else is clothing"), so there is one executor here and three actions on the
// class mark, because the vocabulary a resident reads and the machinery that
// runs are allowed to differ in number.
//
// ── WHY THIS IS NOT CONTAINMENT, WHICH IS THE WHOLE DESIGN ───────────────────
//
// The obvious implementation is "the thing's containment edge points at the
// resident, and children ride their parent's frame." It cannot be built, and
// the reason is law rather than a gap:
//
//   AN ENTITY HAS NO GEOMETRIC PARENT, EVER (LOGOS/kinds.md, restated at
//   dynamic-store.mjs § entities and dynamic-entities.mjs law 2). The entities
//   table has no parent column and never will. A resident is not a mark, has no
//   directory in WORLD/marks/, and cannot be a carrier — carriers are marks
//   with `mobility: derived|free` AND a `mechanic:` (world-frames.mjs), and
//   that `mechanic` clause exists precisely so that standing in the building
//   that houses a class is not riding it.
//
// So carrying is the OTHER edge the LOGOS already named, and which has stood in
// the Keeping Works since 2026-08-09 without ever having a verb:
//
//   the-town/attachment — "An attachment is born saying what becomes of it if
//   what it holds to moves — carried along, or set down."
//
// Its table and its writer shipped in Stage 2 with a comment saying the verb
// that calls them "lands with the vessel work." It did not. This is that verb.
//
// ── POSITION IS DERIVED, NEVER STORED ───────────────────────────────────────
//
// A held thing's world position is `holder's position + offset`, computed on
// read — the same arithmetic world-frames.mjs already runs for passengers, and
// the same discipline the-north-star.md states ("derived things are stored by
// no one"). The alternative — rewriting the mark's `at:` on every hand-off —
// would be a git commit per transfer AND would store a derived quantity. The
// mark file of a thing is BYTE-IDENTICAL across any number of gives; a test
// asserts exactly that, because it is the claim most worth being able to break.
//
// ── HELD vs SET DOWN, and the one judgement call in this file ────────────────
//
// The attachments table is store-canon-DURABLE and replayed by the crossing
// save, so it is the wrong table to migrate on a first pass. It carries no
// `closed_at`, so "set down" needs a spelling in the columns that exist.
//
// The spelling: LATEST ROW PER TARGET WINS (`born_at`, then `seq` — the order
// readAttachments already returns and a replay already applies), and `policy`
// says whether that latest row is a holding:
//
//   policy: cascade   HELD. It comes along when the holder moves.
//   policy: detach    SET DOWN. The edge is in the log; the holding is not.
//
// This reads the column with its own declared meaning ("carried along, or set
// down") and needs no migration. It is nonetheless A CHOICE I MADE, not a
// ruling I was given, and it is the thing to overturn first if the store ever
// grows an explicit terminal column — at which point `liveHolder` below is the
// one function that changes.

import { worldFreezeBounce } from "./freeze.mjs";
import { readAttachments, declareAttachment } from "./dynamic-entities.mjs";
import { openDynamic, openDynamicReadOnly } from "./dynamic-store.mjs";
import { classDials } from "./world-classes.mjs";

/** The thing class's own params, read from the record every time (never cached here). */
export const thingDials = () => classDials("thing");

const bounce = (code, defect, hint) => {
  const e = new Error(defect);
  Object.assign(e, { code, defect, hint });
  return e;
};

/** Rows for one thing, oldest first — the order a replay applies them in. */
export const rowsFor = (rows, thingId) => rows.filter((r) => r.target === thingId);

/**
 * Who holds this thing right now, or null if it is standing on the ground.
 *
 * Latest wins. `readAttachments` already orders by (born_at, seq), so "latest"
 * is the last row and no comparator is restated here — the one ordering lives
 * in the reader, the way `governingAt` keeps the one latest-wins for departures.
 */
export function liveHolder(rows, thingId) {
  const mine = rowsFor(rows, thingId);
  if (!mine.length) return null;
  const last = mine[mine.length - 1];
  return last.policy === "cascade" ? last.entity : null;
}

/** Everything this resident is holding, in the order they took it. */
export function holdingsOf(rows, handle) {
  const targets = [...new Set(rows.map((r) => r.target))];
  return targets.filter((t) => liveHolder(rows, t) === handle);
}

/**
 * A held thing's position: its holder's, plus the offset it was taken at.
 *
 * v0 offset is zero — a carried thing is AT its holder, which is what "in your
 * hands" means and what every inventory read needs. The parameter exists
 * because the frame arithmetic is `carrier.at + offset` and writing it without
 * the term would make the next person re-derive why it is absent.
 */
export const heldPositionOf = (holderAt, offset = { x: 0, y: 0 }) =>
  holderAt ? { x: holderAt.x + offset.x, y: holderAt.y + offset.y } : null;

/**
 * WHICH OF THE THREE FACES THIS CALL IS — the ONE derivation.
 *
 * ⛔ IT IS A FUNCTION BECAUSE THE DOOR ALSO NEEDS IT, and for one lap it was a
 * second copy. `the-town/the-reach`'s clauses are per-face, so the door must
 * know the face before it can ask the right one — and it derived the face
 * itself, in three lines identical to this one, inside the file whose header
 * warns about second copies of exactly this. The reviewer caught it. One home,
 * two callers.
 *
 * Read off CURRENT STATE, never from the caller's word: a resident cannot
 * `give` a thing they are not holding by naming the act differently.
 */
export const faceOf = (holder, to) => (holder == null ? "take" : (to == null ? "drop" : "give"));

/**
 * THE ACT. Declare who holds `thing`.
 *
 * `to` given            hand it over (give) — or pick it up, when `to` is you
 * `to` omitted, held    set it down where you stand (drop)
 * `to` omitted, ground  pick it up (take)
 *
 * The three faces are read off the CURRENT STATE rather than taken from the
 * caller, so a resident cannot `give` a thing they are not holding by naming the
 * act differently. Current state before history — the guard ordering the
 * escalation lane already pays for.
 */
//
// `rows` IS INJECTABLE SINCE B1 (runbook §4 B1), and the injection is what keeps
// this function pure. Under `W2_GUARDS=1` the holder check reads `acts` — a
// Postgres round trip — and this adjudicator must stay synchronous and
// store-agnostic for the reason its own header already gives about the mirror:
// "it takes a db and no key, it is tested directly on hand-built stores, and
// giving it a mirror would give every one of those tests a Postgres dependency
// it has no business having." The DOOR reads the rows; this reads the rows it is
// given, and falls back to `readAttachments(db)` when nobody hands it any, so
// every existing caller and every hand-built-store test is byte for byte what it
// was.
export function declareHolding({ db, thing, to = null, actor, roster = null, groundOwner = null, dials = {}, rows: injected = null }) {
  if (!thing || !String(thing).includes("/"))
    throw bounce(422, "which thing?", "a thing's mark id, <by>/<slug> — the id as it appears in the telling");
  if (!actor) throw bounce(422, "which resident acts?", "a multi-resident key must name one with handle:");

  const rows = injected ?? readAttachments(db);
  const holder = liveHolder(rows, thing);

  // ── the three faces, derived ───────────────────────────────────────────────
  const act = faceOf(holder, to);

  if (act === "give" || act === "drop") {
    if (holder !== actor)
      throw bounce(403, `${holder === null ? "nobody" : holder} is holding ${thing}, not ${actor}`,
        holder === null
          ? "it is standing on the ground — take it first"
          : "you can only give or set down what you are holding");
  }

  if (act === "take") {
    // ✔ THE TAKE RULE — RATIFIED 2026-08-14 (Wright), as argued here rather than
    // as briefed (PLAN-things.md § 4 — the plan retired from the root 2026-09-01;
    // it lives in git history and the Starstory day docs). Neutral is the resting state everywhere, so
    // a take stands unless the ground has spoken against it; requiring an
    // affirmative welcome would invert the law's own default. Kept as a CLASS DIAL
    // so the town can contest it without touching code — flipping
    // `take_requires_welcome` to true makes welcome the requirement instead, and
    // both positions are covered by tests.
    //
    // The exposure this admits — a thing on the commons is takeable until its
    // owner opposes — is bounded by attribution: every take records its actor,
    // held things move only by the holder's own give, and grounds may oppose.
    const requiresWelcome = dials?.take_requires_welcome === true;
    if (groundOwner && groundOwner.owner && groundOwner.owner !== actor) {
      if (groundOwner.word === "opposed")
        throw bounce(403, `${groundOwner.owner} has opposed taking from this ground`,
          "their word on their own ground is absolute — ask them, by letter");
      if (requiresWelcome && groundOwner.word !== "welcomed")
        throw bounce(403, `${groundOwner.owner}'s ground has not welcomed taking`,
          "this world runs take_requires_welcome: true — a standing welcome is needed here; on your own ground and on the commons you may take freely");
    }
  }

  if (act === "give") {
    if (to === actor) throw bounce(422, "you are already holding it", "give names another resident; omit `to` to set it down");
    if (roster && roster.size && !roster.has(String(to)))
      throw bounce(422, `"${to}" is not a resident of this town`, "give names a resident handle, as it appears in the telling");
  }

  const entity = act === "drop" ? actor : (act === "take" ? actor : to);
  const policy = act === "drop" ? "detach" : "cascade";

  // ── THE SAME-MILLISECOND SWALLOW (found 2026-08-14, post-merge check) ───────
  //
  // `attachments_once` is UNIQUE (entity, target, born_at) and the writer is
  // `INSERT OR IGNORE`. So two declarations naming the SAME entity on the SAME
  // thing in the same millisecond collide — and the second is discarded in
  // silence. A give followed by the recipient's own drop is exactly that pair,
  // and it is not a rare race: it is what a resident does in one breath.
  //
  // The symptom was the worst kind. The door returned `{did: "drop", holder:
  // null}` while the store still said `beta` held it — a SUCCESSFUL ANSWER THAT
  // CONTRADICTS THE RECORD IT CLAIMS TO HAVE WRITTEN. Reproduced deterministically
  // by pinning the clock, not inferred from a flaky run.
  //
  // Two guards, because either alone leaves a hole:
  //
  //   1. the stamp is strictly LATER than this pair's newest row, so the
  //      collision cannot arise in the first place. Latest-wins needs a strict
  //      order anyway; borrowing the wall clock for it was the real mistake.
  //   2. the insert is CHECKED. If a row is still swallowed for any reason this
  //      throws instead of returning a false success — a declaration that did not
  //      land must never be reported as one that did.
  //
  // The unique index keeps doing its real job (replay idempotence) untouched.
  const priorSame = rowsFor(rows, thing).filter((r) => r.entity === entity);
  const newest = priorSame.length ? Date.parse(priorSame[priorSame.length - 1].born_at) : NaN;
  const now = Date.now();
  const bornAt = new Date(Number.isFinite(newest) && newest >= now ? newest + 1 : now).toISOString();

  const row = declareAttachment(db, { entity, target: thing, policy, declaredBy: actor, bornAt });
  if (row.inserted === false)
    throw bounce(409, "that declaration did not land", `an identical holding edge for ${entity} on ${thing} already exists at ${bornAt} — nothing was written, and this door will not report a write it did not make`);

  return {
    did: act,
    thing,
    holder: act === "drop" ? null : entity,
    previous_holder: holder,
    // The whole point of the design, said in the answer: the maker is not the
    // holder, and neither is the ground.
    made_by: String(thing).split("/")[0],
    policy: row.policy,
    declared_by: row.declared_by,
    at: row.born_at,
    reading_law: "Holding is an edge, not a field: who made this, who holds it, and where it stands are three different answers.",
  };
}

// ── the door ────────────────────────────────────────────────────────────────

export const HOLD_TOOLS = [
  { name: "world_hold",
    description: "Declare who holds a thing — the one act behind give, drop and take. Name a thing and, to hand it over, the resident who takes it; omit `to` and you either SET IT DOWN where you stand (if you are holding it) or PICK IT UP (if it is standing on the ground). Which of the three happens is read off the thing's current holder, not from what you call it — and a `to:` on a thing you are NOT holding is refused by name rather than performed as something else. THE REACH OF A HOLD (the-town/the-reach): a take is a threshold act — you stand within the thing's extent to take it, exactly as an entry stands at a threshold you truly stand before, and a take from further off is refused naming the distance and the walk that closes it. A set-down stands where you stood: the act carries your standpoint and the thing stands there, not where it was last folded. A give is a take at arm's length — giver and receiver within earshot of each other. And only what stands on the world changes hands: a private draft is on no docket and in no public answer, so nobody outside its author's household can take it or be given it until it publishes. WHO MADE IT IS NOT WHO HOLDS IT: authorship is the mark's `by` and never moves; holding is this edge and moves freely; where it stands is a third answer again, derived from the holder, then from the set-down, then from canon's fold. BY LAW, taking from another household's ground also answers to that ground's word; the door does not yet resolve which ground you are standing on, so today it does not enforce that — what it does instead is RECORD every take with the resident who made it, so a ground-holder who objects has the record to point at. The enforcement lands with ground resolution.",
    inputSchema: { type: "object", properties: {
      thing: { type: "string", description: "the thing's mark id, <by>/<slug> — as ids appear in the telling" },
      to: { type: "string", description: "the resident who takes it (a give). Omit to set it down where you stand, or to pick up a thing standing on the ground" },
      handle: { type: "string", description: "which of YOUR residents acts (omit if your key holds one; a multi-resident key must name one)" },
    }, required: ["thing"], additionalProperties: false } },
  { name: "world_holdings",
    description: "What you are carrying. Every thing whose live holding edge names one of your residents, with what each one is and who made it. A thing you made and gave away is not here; a thing someone gave you is, whoever authored it.",
    inputSchema: { type: "object", properties: {
      handle: { type: "string", description: "which of YOUR residents (omit if your key holds one)" },
      limit: { type: "number", description: "things to return (default 50, max 200)" },
      offset: { type: "number", description: "how many to skip — walk your hands with the next_offset the previous read returned" },
    }, additionalProperties: false } },
];

// Things rendered per read. ✎ A proposal; nobody has held enough to rule on it.
const HOLDINGS_PAGE = 50;

/** Which of the caller's residents is acting. One handle keys default to it. */
function actingHandle(args, key) {
  const handles = [...(key?.handles ?? [])];
  const who = args.handle ?? (handles.length === 1 ? handles[0] : undefined);
  if (!who) throw bounce(422, "which of your residents acts?", handles.length ? `pass handle: one of ${handles.join(", ")}` : "this key acts for no resident");
  if (!key?.handles?.has(who)) throw bounce(403, `"${who}" is not one of your residents`, `this key acts for: ${handles.join(", ") || "(none)"}`);
  return who;
}

/**
 * Refuses a take/give aimed at loot the room has not opened yet, or returns.
 *
 * ⚑ THE IMPORTS ARE LAZY AND THAT IS THE POINT, not a shortcut — the same
 * reason `mirrorHoldingAct` reaches for `world.mjs` this way, one screen down.
 * `arena.mjs` imports THIS file (for `holdingsOf`), so a static import back
 * would close a cycle; and a store with no arena anywhere in it never loads
 * either module.
 *
 * ⚑ IT REFUSES ONLY WHAT IT CAN PROVE. Every failure to read — no world store,
 * a store that will not open, a dynamic store that throws — falls through to
 * the ordinary door. A shroud that turned an unreadable room into a refusal
 * would make an unrelated outage look like the cake was still standing, and a
 * resident would have no way to tell those two apart.
 */
async function refuseShroudedLoot(thingId) {
  if (!thingId) return;
  let store = null, dyn = null;
  try {
    const [{ openStore }, { lootHiddenReason }] = await Promise.all([
      import("./world-apex.mjs"), import("./arena.mjs"),
    ]);
    store = openStore();
    if (!store?.db) return;
    // Read-only: this guard only READS to decide whether to refuse. It sits on
    // a write path, which is why it is not a worker breach, but a reader that
    // holds a writable handle is the class this lane is closing everywhere.
    dyn = openDynamicReadOnly();
    if (!dyn) return; // nothing journalled means nothing is shrouded
    const hidden = lootHiddenReason(store.db, dyn, String(thingId));
    if (!hidden) return;
    throw bounce(409, `${thingId} is not in this room yet`,
      `it is the loot of ${hidden.ground}, and the loot is not in the room until the room is spent${
        hidden.adversary ? ` — ${hidden.adversary} is still standing${hidden.standing ? ` (${hidden.standing})` : ""}` : ""
      }. Put down what stands here and it will be lying where you can reach it; until then it is not something anyone can take or hand over.`);
  } catch (e) {
    // Our own refusal travels; anything else is a reader's trouble and is not
    // the resident's to be punished for.
    if (e?.code === 409 && /is not in this room yet/.test(String(e.defect ?? ""))) throw e;
  } finally {
    try { dyn?.close(); } catch { /* a reader that cannot close still read */ }
    try { store?.db?.close(); } catch { /* same */ }
  }
}

// ── THE REACH OF A HOLD (the-town/the-reach, founder-ruled 2026-09-07) ───────
//
// world PR #21, LOGOS/classes.md § The reach of a hold, verbatim in four
// clauses: a take is a threshold act; a set-down stands where you stood; a give
// is a take at arm's length; only what stands on the world changes hands.
//
// ⚑ AT THE DOOR, NOT IN `declareHolding`, for the third time in this file and
// the same reason both times before: `declareHolding` is the pure adjudicator,
// tested on hand-built stores with no world db anywhere near it, and a reach
// check inside it would hand every one of those tests a world engine, a clone
// and a walk ledger it has no business having. The door is where the world
// already is. What `declareHolding` keeps is the part that needs no geometry:
// who holds what, and which of the three faces this act is.
//
// ⚑ IT REFUSES ONLY WHAT IT CAN PROVE — `refuseShroudedLoot`'s discipline, one
// screen up, and for the same reason. Every failure to READ (no world engine,
// a clone that will not answer, a standpoint derivation that throws) falls
// through to the ordinary door. A door that turned an unreadable world into
// "you are not standing there" would make an outage look like a refusal, and a
// resident would have no way to tell those two apart. What it refuses is what
// it measured: a distance it computed, or a canon it read and did not find.

/**
 * ARE THESE TWO OF ONE HOUSEHOLD — the law's own unit, not the handle.
 *
 * `the-town/the-reach` clause 4 says an unpublished thing "can be held by
 * nobody but its author's HOUSEHOLD". The first lap tested `madeBy !== actor`,
 * which is the author's HANDLE — narrower than the law (a housemate of the
 * author was refused) and, far worse, it was the only test there was: the
 * branch returned early and never asked who RECEIVES. So an author could hand
 * their own private draft to another household from any distance, which is
 * walk #10's exact end state recreated by the branch that refuses it.
 *
 * THE RECORD'S ANSWER, NOT THE KEY'S. `householdOf` reads the town's own
 * household map for a handle; the caller's key `handles` set is the GIVER's
 * key, which says nothing about the AUTHOR's household and would let a
 * multi-resident key vouch for a house it does not belong to.
 *
 * ⛔ IT DEGRADES HONESTLY AND SAYS SO. `householdOf` answers null at a
 * checkout with no engine, or when the map cannot be built. That is "could not
 * be read", not "different households", so the ladder falls back to the one
 * thing still provable — handle identity — and reports `how` so a refusal can
 * say which test actually answered. Refusing on an unread household would be
 * the same defect as refusing on an unread canon, one clause over.
 */
export function sameHousehold(a, b, householdOf = null) {
  const A = String(a), B = String(b);
  if (A === B) return { same: true, how: "handle", slug: null }; // you are always of your own house
  if (typeof householdOf !== "function") return { same: false, how: "handle-only", slug: null };
  let ha = null, hb = null;
  try { ha = householdOf(A); hb = householdOf(B); } catch { return { same: false, how: "handle-only", slug: null }; }
  if (!ha?.key || !hb?.key) return { same: false, how: "handle-only", slug: null };
  return { same: ha.key === hb.key, how: "household", slug: ha.slug ?? null };
}

/** How a refusal names the test that actually answered — never a test it did not run. */
const byWhat = (h) => (h.how === "household"
  ? `by the town's household record${h.slug ? ` (${h.slug})` : ""}`
  : "by handle — the household record could not be read here, so this door fell back to the narrower test it can still prove");

/** The distance sentence a refusal opens with, in the enter refusal's grammar. */
const standsOff = (id, reach) =>
  `${id} stands ${reach.distance_round} m${reach.bearing ? ` ${reach.bearing}` : ""} of you`;

/**
 * The world's answer about one thing and one resident, or `null` when the world
 * could not be read at all. Never throws.
 */
export async function reachContext(thing, actor) {
  try {
    const [{ worldMarkById, pointWithinMarkFn, residentStandpoint }, { standsWithin }] = await Promise.all([
      import("./world.mjs"), import("./reach.mjs"),
    ]);
    const { mark, canon_marks } = await worldMarkById(thing);
    const within = await pointWithinMarkFn();
    const standing = await residentStandpoint(actor).catch(() => null);
    // The town's own household map, for clause 4's unit. Lazily imported like
    // everything else this door reaches for, and ABSENT rather than wrong when
    // the module cannot answer — `sameHousehold` degrades to handle identity
    // and says which test answered.
    let householdOf = null;
    try { ({ householdOf } = await import("./households.mjs")); } catch { householdOf = null; }
    return { mark, canon_readable: canon_marks > 0, within, standing, standsWithin, householdOf };
  } catch { return null; }
}

/**
 * THE FOUR CLAUSES, adjudicated. Throws the door's own bounce, or returns the
 * reach facts the receipt carries.
 *
 * `act` is the face this call is, from `faceOf` — the ONE derivation, which
 * `declareHolding` reads too. The door asks it BEFORE the adjudicator runs,
 * because the law's clauses are per-face and a refusal must land before
 * anything is written. This comment said "AFTER the adjudicator" for one lap
 * while the door called it before, against a face the door derived itself: a
 * false comment above a second copy. The reviewer caught both; the copy is
 * gone and the sentence now describes what happens.
 */
export async function refuseOutOfReach({ thing, to, actor, act, holder, ctx: given = null, standpointOfOther = null }) {
  // A DROP IS ALWAYS IN REACH. You set a thing down where you stand; there is
  // no distance to be wrong about, and no canon gate either — letting go of an
  // unpublished thing is the repair for a hold that should never have been
  // granted, not a second offence. (Walk #10's try-square is exactly that row.)
  if (act === "drop") return { drop: true };

  // `ctx` is INJECTABLE, exactly as `declareHolding`'s `rows` are and for the
  // same reason: the four clauses are adjudication, and a falsifier must be
  // able to put a resident 379 m from a try-square without a world engine, a
  // clone and a walk ledger. The door hands over the real one.
  const ctx = given ?? await reachContext(thing, actor);
  if (!ctx) return null; // the world could not be read — the ordinary door stands

  const { mark, within, standing, standsWithin, householdOf = null } = ctx;
  // `canon_readable: undefined` in a hand-built ctx means the fixture is
  // asserting about canon it supplied — absent is absent there. Only the real
  // reader can report an unread canon, and it does, explicitly.
  const canonReadable = ctx.canon_readable !== false;
  const here = standing?.placed ? { x: standing.x, y: standing.y } : null;

  // ── CLAUSE 4 · ONLY WHAT STANDS ON THE WORLD CHANGES HANDS ────────────────
  //
  // "A private draft is on no docket and in no public answer, so it can be held
  // by nobody but its author's household until it publishes; a hold edge on an
  // unpublished thing is refused."
  //
  // ⛔ THE FIRST LAP RETURNED EARLY HERE AND BROKE TWO CLAUSES WITH ONE LINE.
  // `return { unpublished_own_draft: true }` sat above clause 1 and clause 3,
  // so for the whole class of unpublished things the reach was never asked and
  // the RECIPIENT was never asked at all — an author could hand their own
  // private draft to another household from any distance. That is walk #10's
  // exact end state, recreated by the branch that refuses it, and the door's
  // own blurb promised the opposite in as many words. Found by the reviewer;
  // the shape is this lane's own headline defect one level down.
  //
  // THE RULE, as ruled: an unpublished thing may be TAKEN and DROPPED inside
  // its author's household, and GIVEN only to that same household and only at
  // arm's length. Nothing about it leaves the house until it publishes.
  if (!mark && !canonReadable) return null; // canon did not answer — nothing measured, nothing refused
  if (!mark) {
    const madeBy = String(thing).split("/")[0];
    const mine = sameHousehold(madeBy, actor, householdOf);
    if (!mine.same)
      throw bounce(409, `${thing} does not stand on the world`,
        `it is a private draft — on no docket, in no export, in no public answer — so nobody outside ${madeBy}'s household can take it or be given it, and you are not of that household (${byWhat(mine)}). ${madeBy} puts it forward by staking it (world { do: "stake", args: { mark: "${thing}", stamps: 1 } }); it changes hands after the crossing that carries it.`);

    // A GIVE OF AN UNPUBLISHED THING IS STILL A GIVE. Both halves of clause 3
    // apply — who receives, and how far away they are.
    if (act === "give") {
      const theirs = sameHousehold(madeBy, String(to), householdOf);
      if (!theirs.same)
        throw bounce(409, `${to} is not of ${madeBy}'s household, and ${thing} does not stand on the world`,
          `a private draft stays inside the house that made it until it publishes (${byWhat(theirs)}) — it is on no docket and in no public answer, so a resident outside ${madeBy}'s household would be handed a thing the record does not carry. Stake it first (world { do: "stake", args: { mark: "${thing}", stamps: 1 } }) and give it after the crossing that carries it. Nothing was recorded.`);
      const reach = await armsLengthOrThrow({ thing, to, here, actor, standpointOfOther });
      return { unpublished_own_draft: true, in_household: mine.how, reach };
    }

    // A take, inside the author's own house. There is nothing to stand within:
    // an unpublished mark has no place on the map, so clause 1's threshold test
    // has no footprint to ask about and its absence is stated rather than
    // silently skipped.
    return { unpublished_own_draft: true, in_household: mine.how,
             reach: { stands: true, how: "unpublished", distance_m: null, distance_round: null, bearing: null } };
  }

  if (!here) {
    throw bounce(409, "the record does not place you anywhere",
      `a hold is good only where you truly stand (the-town/attach), and the walk ledger has no position for ${actor} — walk somewhere first: world { do: "walk", args: { mark_id: "${thing}", mode: "center" } }`);
  }

  // ── CLAUSE 1 · A TAKE IS A THRESHOLD ACT ──────────────────────────────────
  if (act === "take") {
    const reach = standsWithin(here, mark, { pointWithinMark: within });
    if (!reach.stands)
      throw bounce(409, `you are not standing where ${thing} stands — ${standsOff(thing, reach)}`,
        `a take is a threshold act (the-town/the-reach): you stand within a thing's extent to take it, exactly as an entry stands at a threshold you truly stand before. Walk to it and take it there — world { do: "walk", args: { mark_id: "${thing}", mode: "center" } } — then world { do: "take", args: { thing: "${thing}" } }. Nothing was recorded.`);
    return { reach };
  }

  // ── CLAUSE 3 · A GIVE IS A TAKE AT ARM'S LENGTH ───────────────────────
  if (act === "give") return { reach: await armsLengthOrThrow({ thing, to, here, actor, standpointOfOther }) };

  return null;
}

/**
 * CLAUSE 3's MEASURE, in ONE place — the published give and the unpublished one.
 *
 * It is a function because clause 4 needs it too: an unpublished give is still
 * a give, and the first lap skipped this test for that whole class. Two copies
 * of an arm's-length rule would be two answers to "how far is beside", which is
 * the split this lane exists to close.
 */
async function armsLengthOrThrow({ thing, to, here, actor, standpointOfOther = null }) {
  const { withinArmsLength } = await import("./reach.mjs");
  if (!here)
    throw bounce(409, "the record does not place you anywhere",
      `a give is a take at arm's length (the-town/the-reach), and the walk ledger has no position for ${actor} — there is no length to measure. Walk somewhere first.`);
  const theirs = typeof standpointOfOther === "function"
    ? await standpointOfOther(String(to)).catch(() => null)
    : await (await import("./world.mjs")).residentStandpoint(String(to)).catch(() => null);
  if (!theirs?.placed)
    throw bounce(409, `the record does not place ${to} anywhere`,
      `a give is a take at arm's length (the-town/the-reach) and the town cannot measure the length: ${to} has no position in the walk ledger. Set it down where you both can reach it instead — world { do: "drop", args: { thing: "${thing}" } }.`);
  const reach = withinArmsLength(here, { x: theirs.x, y: theirs.y });
  if (!reach.stands)
    throw bounce(409, `${to} is not within arm's length — they stand ${reach.distance_round} m${reach.bearing ? ` ${reach.bearing}` : ""} of you`,
      `a give is a take at arm's length (the-town/the-reach): giver and receiver stand within earshot of each other, ${reach.earshot_m} m, the town's one measure of beside. Walk to them and hand it over there — world { do: "walk", args: { mark_id: "<their ground>", mode: "center" } } — or set it down where they will find it: world { do: "drop", args: { thing: "${thing}" } }. Nothing was recorded.`);
  return reach;
}

/**
 * CLAUSE 3, THE OTHER HALF — a `to:` on a thing you are not holding BOUNCES.
 *
 * "a `to:` on a thing the giver does not hold is refused, never silently
 * rewritten as a take."
 *
 * This runs BEFORE `declareHolding`, and it must: the adjudicator's three faces
 * are read off the live holder, so by the time it has answered, the `to:` has
 * already been discarded (`entity = act === "take" ? actor : to`). The old
 * behaviour was not a rewrite branch — it was `to` never being consulted. So
 * the fix is not to change the faces; it is to refuse the call the faces cannot
 * express, one step earlier, where the caller's own words are still in hand.
 */
export function refuseGiveOfUnheld({ thing, to, actor, holder }) {
  if (to == null) return;
  if (holder === actor) return;               // an ordinary give
  if (String(to) === actor) return;           // "give it to me" on a thing you hold is declareHolding's own 422
  throw bounce(409, holder === null
    ? `you are not holding ${thing} — nobody is`
    : `you are not holding ${thing} — ${holder} is`,
    holder === null
      ? `a give hands over what is in your hands. Take it first (you must be standing within its extent to do that: world { do: "walk", args: { mark_id: "${thing}", mode: "center" } }, then world { do: "take", args: { thing: "${thing}" } }), then give it. Nothing was recorded, and no take was made in your name.`
      : `a give hands over what is in your hands, and ${holder} is holding this one. Nothing was recorded.`);
}

// ── WHERE A THING STANDS — CLAUSE 2's READ HALF, AND THE-ANCHOR'S FIRST ──────
//
// `the-town/the-anchor`: "a held thing rides its holder as a rider rides the
// deck". That sentence has been law since 2026-08-09 and had NO IMPLEMENTATION
// on either side of the seam: `heldPositionOf` above is exported, asserted on
// in one test, and called by nothing; the world fold's `attaches` is predicated
// children by `parent` and has never read the holding edge; and every surface a
// resident can read a thing's place from — `world_investigate` above all —
// answers the folded canon mark's `at`, held or not.
//
// So walk #12's "I carried a toy three kilometres and the town put it back
// where I started" was not a fall-back. It was the only answer the town has
// ever had. The try-square in Ethan's hands still reads at Wright's terrace.
//
// THREE SOURCES, IN THE LAW'S OWN ORDER, each naming itself:
//
//   holder    somebody holds it — it is where they are (the-anchor)
//   set-down  nobody holds it, and a drop act says where it was set down
//             (the-town/the-reach: "that position is written on the act and is
//             canon at the next fold like any move, never a fall-back to the
//             last place the thing was folded")
//   fold      nobody holds it and no drop is on the record — canon's own `at`
//
// and a fourth answer that is not a source: `unreadable`, when a store would
// not open. A position guessed from a store that did not answer is the quiet
// substitution the anchor pair exists to prevent.

/** The latest drop act for this thing, out of the journal, or null. */
export function latestDrop(rows, thingId) {
  const mine = rows.filter((r) => r.object === String(thingId) && r.action === "drop");
  return mine.length ? mine[mine.length - 1] : null;
}

/**
 * Where a thing stands, derived — never stored, and it says which of the three.
 *
 * `deps` carries the readers so this is testable on hand-built rows with no
 * world engine, no journal file and no walk ledger: the same injection
 * `declareHolding` takes for `rows`, and for the same reason.
 */
export async function whereThingStands(thingId, {
  attachments = null, journal = null, fold = null, standpointOf = null, centreOf = null, householdOf = null, stances = [],
} = {}) {
  const id = String(thingId);
  if (attachments == null) return { where: null, source: "unreadable", says: "the office could not read the holding record — this is not an answer about where it stands" };

  const holder = liveHolder(attachments, id);
  if (holder) {
    const at = typeof standpointOf === "function" ? await standpointOf(holder) : null;
    return at
      ? { where: at, source: "holder", holder, says: `${holder} is holding it, and a held thing rides its holder (the-town/the-anchor)` }
      : { where: null, source: "holder", holder, says: `${holder} is holding it, and the record does not place ${holder} anywhere — so where it stands cannot be derived` };
  }

  const drop = journal == null ? null : latestDrop(journal, id);
  if (drop) {
    const { composeAnchor } = await import("./world-journal.mjs");
    const at = composeAnchor(drop.at ?? {}, centreOf);
    if (at) {
      const base = { where: at, source: "set-down", set_down_by: drop.actor ?? null, act_seq: drop.seq ?? null };
      // ── WHOSE SET-DOWN IS IT (POS-138, Keemin's ruling 2026-09-24) ──────────
      //
      // "The author's pen moves the author's own thing without ceremony. A
      // set-down by ANOTHER household becomes a drafted amend that the author's
      // house accepts or refuses … until accepted, canon stays where the author
      // put it and the read says 'set down by <handle> at <place>, unaccepted'."
      //
      // The author's own set-down files the amend at the door, so this read's
      // old sentence is true for it and stays word for word. A stranger's does
      // NOT move canon, so the promise is not made to them: the thing stands
      // where it was set down (the-reach clause 2's interim read, unchanged) and
      // the read says, in the ruling's words, that the move is unaccepted and
      // where canon keeps it. A household record that cannot be read decides
      // neither way, and the read says so rather than promising either.
      const madeBy = id.split("/")[0];
      const setter = drop.actor == null ? null : String(drop.actor);
      const house = setter == null ? { same: false, how: "handle-only" } : sameHousehold(madeBy, setter, householdOf);
      if (house.same)
        return { ...base, says: `${setter} set it down here; it stands where they stood, and the record re-sites the mark at the next fold` };
      const foldAt = fold && Number.isFinite(Number(fold.x)) && Number.isFinite(Number(fold.y)) ? { x: Number(fold.x), y: Number(fold.y) } : null;
      const canonText = foldAt ? placeText(foldAt) : "the place it was last folded";
      if (house.how === "household") {
        // THE AUTHOR'S HOUSE'S ANSWER, if it has spoken about THIS drop.
        const answer = setDownAnswer({ stances, thing: id, dropSeq: drop.seq ?? null, madeBy, householdOf });
        if (answer?.stance === "opposed")
          return { where: foldAt, source: "fold", set_down_by: setter, act_seq: drop.seq ?? null,
            accepted: false, refused_by: answer.by,
            says: `set down by ${setter} at ${placeText(at)} — refused by ${madeBy}'s house; canon stands at ${canonText}, where ${madeBy} put it` };
        if (answer?.stance === "welcomed")
          // WHAT THE STANCE PROVES, AND NOTHING MORE. The row is written before
          // the amend is filed, and the amend door can still refuse; this read
          // sees the word, never the filing, so it must not claim one (Wright's
          // review, #184). The receipt is where the filing's outcome is said.
          return { ...base, accepted: true, accepted_by: answer.by, canon_at: foldAt,
            says: `set down by ${setter} at ${placeText(at)} — accepted by ${madeBy}'s house; canon follows when ${madeBy}'s amend publishes at a crossing` };
        return { ...base, accepted: false, canon_at: foldAt,
          says: `set down by ${setter} at ${placeText(at)} — unaccepted; canon stays at ${canonText}, where ${madeBy} put it` };
      }
      return { ...base, accepted: null,
        says: `${setter ?? "somebody"} set it down here and it stands where they stood; whether canon follows depends on whose household set it down, and the household record could not be read here` };
    }
  }

  if (fold && Number.isFinite(Number(fold.x)) && Number.isFinite(Number(fold.y)))
    return { where: { x: Number(fold.x), y: Number(fold.y) }, source: "fold",
      says: "nobody is holding it and no set-down stands on the record — this is where the world last folded it" };

  return { where: null, source: "unplaced", says: "nobody holds it, nothing set it down, and canon gives it no place" };
}

// ── HOLD EFFECTS ON YOUR NODE (walk #11 item 1) ──────────────────────────────
//
// `the-response-function § Residents: words, at their own pace`: the resident's
// loop is "a replayable, cursor-ordered read of EVERY effect on your own node
// since you last looked". Lane A put claim effects on that shelf and named the
// hole it was leaving: "the operator knows Lane A adds claim effects on dev; a
// hold is not a claim, so this family is still nobody's."
//
// It is this lane's. Walk #11 read `since: 175` after making a thing and handing
// it to a neighbour inside that very crossing, and got a CERTIFIED ZERO —
// `complete: true, count: 0`. A thing of yours changing hands is an effect on
// your node by any reading of that sentence.
//
// FOUR WAYS AN ACT TOUCHES YOU, and the event says which rather than making a
// reader infer it from the ids:
//   yours        you made the thing (its `by`) — it is your work moving
//   by_you       you performed the act
//   to_you       it came into your hands
//   from_you     it left them
//
// POINTERS, NEVER COPIES — the shelf's own standing rule (claim-effects.mjs
// § R2). Each event is an id, a word, and the read that opens it; the thing's
// body, its place and its history are all one `world { mark: … }` away.
//
// PURE over rows, for the reason every derivation on this shelf is: a falsifier
// must be able to hand it a give without a journal, a world or a clock.
export function holdEffectsFrom({ rows = [], handles = [], sinceCrossing, nowCrossing } = {}) {
  const mine = new Set([...handles].filter(Boolean).map(String));
  if (!mine.size) return [];
  const out = [];
  for (const r of rows) {
    if (r?.class !== "holding") continue;
    const thing = r.object;
    if (!thing) continue;                       // an act naming no thing names nothing
    const c = r.crossing == null ? null : Number(r.crossing);
    if (c == null || c < sinceCrossing || c > nowCrossing) continue;
    const p = r.payload ?? {};
    const madeBy = p.made_by ?? String(thing).split("/")[0];
    const whose = {
      yours: mine.has(String(madeBy)),
      by_you: mine.has(String(r.actor)),
      to_you: p.holder != null && mine.has(String(p.holder)),
      from_you: p.previous_holder != null && mine.has(String(p.previous_holder)),
    };
    if (!whose.yours && !whose.by_you && !whose.to_you && !whose.from_you) continue;
    const action = String(r.action ?? "");
    out.push({
      kind: `hold-${action || "act"}`,
      thing, made_by: madeBy,
      holder: p.holder ?? null, previous_holder: p.previous_holder ?? null,
      at: r.written_at ?? null, crossing: c,
      ...whose,
      summary: action === "drop"
        ? `${r.actor} set ${thing} down`
        : action === "take"
          ? `${r.actor} took up ${thing}`
          : `${r.actor} handed ${thing} to ${p.holder ?? "somebody"}`,
      read_it: `world { mark: "${thing}" }`,
    });
  }
  return out;
}

/**
 * The hold events for one resident, out of the record. Never throws.
 *
 * ── IT READS `acts`, AND THE SQLITE READ IS DELETED (POS-153) ───────────────
 *
 * This shelf used to open the sqlite journal, and the journal was never the
 * record for a holding — it was a window onto one, and a narrow one twice over.
 * Before the hold lane's pen flipped (2026-09-03T18:58:05Z) a holding act took
 * NO journal row at all: `mirrorHoldingAct` wrote `acts` and nothing else, by
 * world-journal.mjs's own § THE LANE HOOK. After the flip the journal row is
 * the reverse mirror's best-effort copy, and `world-drain.mjs` truncates it at
 * every drain. So walk #11's certified zero had a second way to happen that
 * fixing the wiring never touched: the give was real, the shelf was reading a
 * window the drain had already closed.
 *
 * The store read is the whole read. No flag, no fallback underneath — one
 * question, one owner.
 *
 * The bounds are pushed because this shelf narrows by crossing anyway
 * (`holdEffectsFrom` skips a row outside them), and `holdEffectsFrom` still
 * runs afterwards and is still the one that decides: the port pushes a bound
 * only when it is finite, which is what makes the narrowed read and the
 * unnarrowed one the same answer on a call with no cursor.
 *
 * ⚑ `readable` IS A CLAIM ABOUT WHETHER THE RECORD WAS READ, not about whether
 * this function threw (reviewer's repair 2, lap 4). An unreachable record gets
 * the catch's shape with its own reason, exactly as an absent sqlite file did:
 * "I read the holding record and it is empty" is a different sentence from "I
 * could not read it", and a caller must be able to tell them apart.
 */
export async function readHoldEffects({ handles = [], sinceCrossing, nowCrossing } = {}) {
  try {
    const { storeHoldingRows } = await import("./world2-guards.mjs");
    const rows = await storeHoldingRows({ since: sinceCrossing, until: nowCrossing });
    return { readable: true, events: holdEffectsFrom({ rows, handles, sinceCrossing, nowCrossing }) };
  } catch (e) {
    return { readable: false, events: [], reason: `the holding record could not be read (${String(e?.message ?? e).slice(0, 160)})` };
  }
}

/**
 * ONE ROW OF THE GROUND READ — is this thing takeable from where I stand, and
 * if not, in what words?
 *
 * PURE, and lifted out of `groundWithinReach` for the reason every adjudication
 * in this file is pure: the verdict a resident reads is decided here, and a
 * falsifier must be able to put a thing 90 m away, or in somebody's hands,
 * without a world store, a dynamic store and a walk ledger.
 *
 * THE VERDICT USES THE DOOR'S OWN WORDS ON PURPOSE. A read that listed things
 * the door would then refuse would be a second opinion about the reach, and the
 * door's is the one that binds. A thing somebody else is holding is LISTED with
 * its holder rather than dropped: "she is holding it" is an answer; an absence
 * is not.
 */
export function groundRow({ id, made_by = null, body = null, stands, reach }) {
  return {
    thing: id, made_by,
    body: body ? String(body).slice(0, 160) : null,
    stands_at: stands.where, place_from: stands.source,
    distance_m: reach.distance_round, bearing: reach.bearing,
    within_its_extent: reach.how === "extent",
    ...(stands.holder
      ? { holder: stands.holder, takeable: false,
          why: `${stands.holder} is holding it — a held thing moves by its holder's own give` }
      // ⛔ `takeable` IS THE DOOR'S VERDICT, NOT A STRICTER ONE. The first lap
      // read `reach.how === "extent"` and threw the margin arm away, so a
      // resident standing 10 m from a thing was told to walk to it — and
      // walking changed nothing, because the take was already admitted where
      // they stood. That is the second opinion `groundWithinReach`'s own
      // comment forbids twenty lines above it, and it undid half the
      // conductor's decision 1: the margin arm was KEPT so the town's small
      // things stay takeable, and this read told every resident it did not
      // exist. The filter obeyed the door; the verdict did not.
      //
      // The word for that arm is REACH, not "doorstep" (founder, 2026-09-11:
      // "doorstep means something else" — it is the resident's front step and
      // their morning read, and it was doing double duty as a geometric margin;
      // reach.mjs § THE WORD THAT LEFT carries the whole ruling).
      : reach.stands
        ? { takeable: true,
            why: reach.how === "extent"
              ? "you are standing within it — a take is admitted here"
              : `you are within reach of it, ${reach.distance_round} m off — a take is admitted here` }
        : { takeable: false,
            why: `you are ${reach.distance_round} m off; a take stands within a thing's extent or within reach of it — world { do: "walk", args: { mark_id: "${id}", mode: "center" } }` }),
  };
}

/** Where the actor stands, in world coordinates, or null when it cannot be read. */
async function standpointOfActor(actor) {
  try {
    const { residentStandpoint } = await import("./world.mjs");
    const s = await residentStandpoint(String(actor));
    return s?.placed ? { x: s.x, y: s.y } : null;
  } catch { return null; }
}

// ── CLAUSE 5 · THE RECEIPT SPEAKS THE CARD'S WORDS ───────────────────────────
//
// "`carried along` / `set down` are the two propagations the attach class
// names; a receipt says which, in those words."
//
// `policy` STAYS. It is the column's name, it is what a replay applies, and
// three surfaces already read it — renaming a stored word to fix a printed one
// is how a store and its readers come apart. What the receipt gains is the
// card's own sentence beside it, and the mapping said out loud, so a resident
// who met `detach` on walk #12 and `carried along` on the card can see they are
// one law. (Walk #12 item 4: "two vocabularies for one law, and the one on the
// receipt is the one nobody defined for me.")
export const PROPAGATION = Object.freeze({ cascade: "carried along", detach: "set down" });

/**
 * CLAUSE 2's HALF THE ACT ALREADY KEPT — said on the receipt at last.
 *
 * The drop's standpoint has been written to `acts.at` since the holding gap
 * closed (holdingEntry, below), in the-witnessed-line's anchor+offset. What no
 * answer ever carried was the plain fact: WHERE IT NOW STANDS. A resident who
 * set a thing down was told `holder: null` and left to find out from a focus
 * that reads the last fold — walk #12's 536 m.
 */
function dressReceipt(did, { reached = null, stood = null, setDown = null } = {}) {
  const propagation = PROPAGATION[did.policy] ?? null;
  return {
    ...did,
    ...(propagation
      ? { propagation, propagation_note: `"${propagation}" is the attach class's own word for policy: "${did.policy}" — one law, and this is the sentence on the card.` }
      : {}),
    ...(did.did === "drop" && stood
      ? { stands_at: stood, stands_note: setDownNote(setDown) }
      : {}),
    ...(did.did === "drop" && setDown ? { set_down: setDown } : {}),
    ...(reached?.reach
      ? { reach: { how: reached.reach.how, distance_m: reached.reach.distance_round, earshot_m: reached.reach.earshot_m } }
      : {}),
  };
}

// ── THE SET-DOWN FILES THE AMEND (POS-138, Keemin's ruling 2026-09-24) ──────
//
// `LOGOS/classes.md` § The reach of a hold: a set-down's "position is written
// on the act and is canon at the next fold like any move". `LOGOS/
// state-and-time.md`: "The settlement writes a mark once; nothing moves it
// after" — so a move is an AMEND through the office's pen, which the crossing
// publishes. This door promised the re-site twice (the read, and the receipt's
// `stands_note`) and filed nothing: Keith's stool read `source: set-down` in
// the Waiting Room while canon kept it in the garage through nine folds.
//
// THE RULING, whose pen moves a thing somebody set down: "the author's pen
// moves the author's own thing without ceremony. A set-down by ANOTHER
// household becomes a drafted amend that the author's house accepts or
// refuses through declare-stance-on … until accepted, canon stays where the
// author put it."
//
// ── THE AUTHOR'S OWN SET-DOWN: THE DOOR'S OWN AMEND, NEVER A FOURTH WAY ─────
//
// The amend is filed through `leaveMarkViaOffice` with `amend: true` — the
// exact call a resident makes to re-site their own mark, so every guard that
// door runs (the key holds the author, the move guard, the put-forward verdict
// on the mark's escrow and the ground it now stands on) runs here unchanged,
// and the store receives the one amend shape it already has: a mark-class
// `amend` act whose candle half files a claim superseding the standing mark
// (`world2-claims.mjs § claimTxFromJournal`, #2806). The crossing locks it and
// the fold re-sites the mark (measured by the world lane, 2026-09-23).
//
// `at` is the dropper's standpoint, the same point `stands_at` answers. Every
// other field is the canon record's own, copied: an amend that changes nothing
// the author wrote but the place. A canon record carrying an authored key this
// door cannot re-declare (`loot`, `dials`, …) is NOT amended — filing it would
// silently delete that line at the next crossing — and the receipt says so.
//
// The drop act rides the declaration as `_set_down` (`world.mjs §
// leaveMarkViaOffice`): who set it down, where, when, and the act's id where
// the pen returns one.
//
// ── A STRANGER'S SET-DOWN FILES NOTHING HERE ────────────────────────────────
//
// The drop, its act and its edge are written exactly as before. No amend is
// filed and canon does not move. THE DROP ACT IS THE DRAFTED AMEND (ruled
// 2026-09-24, the proposal in PR #180): the store cannot hold a draft claim
// written by one household for another (`007_private_drafts.sql`
// claims_insert: a draft's household must be the writing transaction's), so
// nothing is drafted at drop time. The author's house answers it through
// `declare-stance-on` — § THE AUTHOR'S HOUSE ANSWERS, below, and
// `world-stance.mjs § THE SET-DOWN ARM`. Until it does, the read and the
// receipt say: set down by <handle>, unaccepted, canon where the author put it.

/** A world point as a sentence reads it. */
const placeText = (p) => `(${Number(p.x)}, ${Number(p.y)})`;

/**
 * THE FIELDS AN AMEND COPIES, and the fields it leaves to the store.
 *
 * `AMEND_CARRIES` is exactly what `leaveMarkViaOffice` can re-declare (its
 * `clean`, less `at`, which the set-down replaces). `AMEND_LEAVES` is every key
 * `WORLD/world-state.json` carries on a mark that no author writes — measured
 * on world main `5509c996`, 1,264 marks: identity (`id`, `by`), the fold's and
 * the walk's derivations (`tier`, `sovereign`, `placementParent`, `household`,
 * `declared_household`), the ledger's (`stamps`, `weight`, `weight_parts`,
 * `ledger_weight`), the world assembly's (`signal`, added to every mark by
 * the engine's `tools/world-build.mjs`, which `worldMarkById` reads through)
 * and the declaration's own stamp (`date`, which the door re-stamps on every
 * amend). Any key in neither list is an authored line the door cannot carry,
 * and the amend is refused rather than made to drop it.
 */
export const AMEND_CARRIES = Object.freeze(["kind", "extent", "points", "body", "slot", "value", "class", "ask", "reward", "status", "image"]);
export const AMEND_LEAVES = Object.freeze([
  "id", "by", "at", "tier", "sovereign", "placementParent", "household", "declared_household",
  "stamps", "weight", "weight_parts", "ledger_weight", "date", "signal",
]);
const LEAVES = new Set(AMEND_LEAVES), CARRIES = new Set(AMEND_CARRIES);

/**
 * The amend a set-down files, from the canon record — or why none can be. PURE.
 *
 * @returns {{ payload, setDown } | { refused: string }}
 */
export function setDownAmend({ thing, mark, stood, actor, actId = null, writtenAt = null }) {
  const id = String(thing);
  const cut = id.indexOf("/");
  const madeBy = id.slice(0, cut), slug = id.slice(cut + 1);
  if (!mark) return { refused: `${id} has no canon record to amend — a private draft has no place on the map until it publishes` };
  if (!stood || !Number.isFinite(Number(stood.x)) || !Number.isFinite(Number(stood.y)))
    return { refused: "the record does not place you anywhere, so there is no standpoint to re-site it to" };
  const kept = Object.keys(mark).filter((k) => !LEAVES.has(k) && !CARRIES.has(k) && !k.startsWith("_"));
  if (kept.length)
    return { refused: `its record carries ${kept.map((k) => `\`${k}\``).join(", ")}, which an amend at this door cannot re-declare — filing one would delete ${kept.length === 1 ? "that line" : "those lines"} at the next crossing` };
  const at = { x: Number(stood.x), y: Number(stood.y) };
  const setDown = { act_id: actId == null ? null : String(actId), by: String(actor), at, written_at: writtenAt ?? null };
  const payload = { by: madeBy, slug, amend: true, at };
  for (const k of AMEND_CARRIES) if (mark[k] !== undefined && mark[k] !== null) payload[k] = mark[k];
  return { payload, setDown };
}

/**
 * File the amend a drop owes, or say why none was filed. Never throws: the drop
 * has already stood, and a failure here is an answer on its receipt.
 *
 * `deps` are the readers and the door, injectable so a falsifier drives the
 * real door with a canon record and a household map it supplies.
 */
export async function fileSetDownAmend({ did, stood, key, actId = null, deps = {} }) {
  const thing = String(did.thing);
  const madeBy = thing.split("/")[0];
  const actor = String(did.declared_by);
  const base = { by: actor, made_by: madeBy, at: stood ?? null };
  try {
    let householdOf = deps.householdOf;
    if (householdOf === undefined) {
      try { ({ householdOf } = await import("./households.mjs")); } catch { householdOf = null; }
    }
    const house = sameHousehold(madeBy, actor, householdOf);
    if (!house.same) {
      return house.how === "household"
        ? { ...base, whose: "another household's", amend: { filed: false, why: `${madeBy} made it and you are not of ${madeBy}'s household (by the town's household record) — a set-down by another household moves nothing in canon on its own` } }
        : { ...base, whose: "unread", amend: { filed: false, why: "the household record could not be read here, so this door cannot tell whether you set down your own household's thing — nothing was filed" } };
    }
    const amend = await fileAuthorsAmend({ thing, stood, key, actor, actId, writtenAt: did.at ?? null, deps });
    return { ...base, whose: "your household's", amend };
  } catch (e) {
    return { ...base, whose: "your household's", amend: { filed: false, why: `the amend door refused: ${String(e?.defect ?? e?.message ?? e).slice(0, 200)}` } };
  }
}

/**
 * THE AUTHOR'S AMEND, filed — the one call both callers make: a drop by the
 * author's own household (above) and the author's house welcoming another
 * household's set-down (`world-stance.mjs`, POS-138's second half). One call,
 * so the two can never file two shapes of the same move.
 *
 * `extra` rides `_set_down` beside the drop's own fields — the stance act's id,
 * when a welcome is what filed it. Never throws; the outcome says what happened.
 */
export async function fileAuthorsAmend({ thing, stood, key, actor, actId = null, writtenAt = null, extra = {}, deps = {} }) {
  try {
    const mark = deps.mark !== undefined ? deps.mark
      : await (async () => { const { worldMarkById } = await import("./world.mjs"); return (await worldMarkById(String(thing))).mark; })();
    const built = setDownAmend({ thing, mark, stood, actor, actId, writtenAt });
    if (built.refused) return { filed: false, why: built.refused };
    const leave = deps.leave ?? (async (payload, k, opts) => {
      const [{ leaveMarkViaOffice }, { WORLD_CLONE }] = await Promise.all([import("./world.mjs"), import("./world-store.mjs")]);
      return leaveMarkViaOffice(WORLD_CLONE, payload, k, opts);
    });
    const res = await leave(built.payload, key, { setDown: { ...built.setDown, ...extra } });
    if (res?.error) return { filed: false, why: `the amend door answered: ${res.defect ?? res.error}` };
    return {
      filed: true, mark: res?.id ?? String(thing), seq: res?.seq ?? null, put_forward: res?.put_forward === true,
      ...(res?.put_forward === true ? {} : { to_publish: res?.to_publish ?? null }),
    };
  } catch (e) {
    return { filed: false, why: `the amend door refused: ${String(e?.defect ?? e?.message ?? e).slice(0, 200)}` };
  }
}

// ── THE AUTHOR'S HOUSE ANSWERS A STRANGER'S SET-DOWN (POS-138, ruled 10:1x) ──
//
// Keemin, 2026-09-24, on the proposal in PR #180: "I agree with you here." The
// drop act IS the drafted amend; the author's house answers it through
// `declare-stance-on` (`world-stance.mjs § THE SET-DOWN ARM`): welcomed files
// the author's amend (`fileAuthorsAmend`), opposed makes this read answer canon
// with nothing written, and silence leaves it unaccepted.
//
// A stance answers ONE set-down, named by the drop act's id on its payload
// (`set_down.act_id`), so a word spoken about Ana's drop never answers a later
// drop by somebody else. Only a speaker of the author's household counts: the
// door refuses anybody else, and this read ignores anybody else too — a read is
// not allowed to trust that the door was the only writer.

/** The stance payload's own word for which question it answers. */
export const ANSWERS_SET_DOWN = "set-down";

/**
 * The author's house's latest answer to one set-down, or null (silence). PURE.
 *
 * `stances` are stance rows as `world-stance.mjs § stanceRows` returns them
 * (`class`, `actor`, `object`, `payload`, `written_at`, `seq`).
 */
export function setDownAnswer({ stances = [], thing, dropSeq, madeBy, householdOf = null }) {
  if (dropSeq == null) return null;
  let latest = null;
  for (const r of stances ?? []) {
    if (r?.class !== "stance" || String(r.object) !== String(thing)) continue;
    const p = r.payload ?? {};
    if (p.answers !== ANSWERS_SET_DOWN || String(p.set_down?.act_id) !== String(dropSeq)) continue;
    if (p.stance !== "welcomed" && p.stance !== "opposed") continue;
    if (!sameHousehold(madeBy, String(r.actor), householdOf).same) continue;
    const later = !latest || String(r.written_at) > String(latest.written_at)
      || (String(r.written_at) === String(latest.written_at) && Number(r.seq) > Number(latest.seq));
    if (later) latest = r;
  }
  return latest ? { stance: latest.payload.stance, by: String(latest.actor), at: latest.written_at ?? null, seq: latest.seq ?? null } : null;
}

/**
 * THE RECEIPT'S SENTENCE, one per outcome — which of the two branches happened,
 * and whether canon will follow. The first clause is the one the receipt has
 * always carried; what follows it is now true of this drop.
 */
export function setDownNote(setDown) {
  const lead = "it stands where you stood when you set it down, and the act carries that place";
  const a = setDown?.amend;
  if (!a) return `${lead}.`;
  if (a.filed && a.put_forward)
    return `${lead}; the amend that re-sites the mark is filed${a.seq != null ? ` (act ${a.seq})` : ""}, and canon moves it here at the next crossing.`;
  if (a.filed)
    return `${lead}; the amend that re-sites the mark is filed as ${setDown.made_by}'s private draft — no escrow behind it clears the ground it now stands on, so canon keeps it where it was folded until it is put forward.`;
  if (setDown.whose === "another household's")
    return `${lead} — but ${setDown.made_by} made it, and a set-down by another household moves nothing in canon on its own: it reads as set down by you, unaccepted, and canon stays where ${setDown.made_by} put it.`;
  return `${lead}; no amend was filed (${a.why}), so canon keeps it where it was folded and the set-down is the read's answer until one is.`;
}

export async function callHoldTool(name, args = {}, key = null) {
  if (name === "world_hold") { const fz = worldFreezeBounce(); if (fz) return fz; }
  const actor = actingHandle(args, key);
  // ⚑ THE READ ASKS FOR A READ HANDLE, AND ONLY THE WRITE ASKS FOR A WRITE ONE
  // (#2599, carried in the same commit that woke `GET /world/holdings`).
  //
  // This function opened the dynamic store in WRITE mode before it branched, so
  // `world_holdings` — a pure read, and the shadow of the other three verbs —
  // held a write-mode handle for the whole call. DEC-4 forbids a read worker to
  // hold one, and the only reason nobody had met the contradiction is that the
  // REST route into here was dead: waking it would have made this the sixth
  // write-mode reader. So the mode follows the verb.
  //
  // ⚑ NULL IS THE ANSWER, NOT A FAULT. `openDynamicReadOnly` answers null on an
  // absent store, and its own docblock rules what that means: "an absent journal
  // means NOTHING HAS BEEN JOURNALLED, which is a fact a reader can state …
  // every caller treats null as EMPTY — which is byte-for-byte the answer the
  // write-mode default produced, minus the write." So the read's ANSWER is
  // unchanged on every store, present or absent; what changed is that it no
  // longer creates one to find out.
  const db = name === "world_holdings" ? openDynamicReadOnly() : openDynamic();
  try {
    if (name === "world_holdings") {
      // B1: give/drop/take's own holder fold, read from `acts` under W2_GUARDS=1.
      // This read is the SHADOW of those three verbs — one answer, one source.
      //
      // Under the guards the rows come from Postgres and the sqlite handle is
      // not consulted at all, so an absent sqlite store must NOT short-circuit
      // the flipped read — `guardStatus()` is what tells the two apart.
      const { guardedAttachments, guardStatus } = await import("./world2-guards.mjs");
      const rows = (db || guardStatus().flipped) ? await guardedAttachments(db) : [];
      const held = holdingsOf(rows, actor);
      // ── THE HOLDINGS BOUND (2026-08-25) ─────────────────────────────
      //
      // Small today — wright holds nothing, and the whole answer is 52 bytes —
      // and this read is the shadow of give/drop/take, so it rides three of the
      // world's actions. Things are the newest thing in the world and nothing
      // caps how many one resident can pick up, so the shape lands before it is
      // needed rather than after.
      //
      // `count` was already here and already the true number; what it lacked
      // was a bound to be a count AGAINST. Count first, slice after.
      const n = Math.min(Math.max(Number(args.limit) || HOLDINGS_PAGE, 1), 200);
      const start = Math.max(Number(args.offset) || 0, 0);
      const page = held.slice(start, start + n);
      const next = start + page.length;
      return {
        handle: actor,
        count: held.length,
        shown: page.length,
        limit: n, offset: start,
        complete: next >= held.length,
        ...(next < held.length
          ? { next_offset: next,
              more_note: `${held.length - next} more thing${held.length - next === 1 ? "" : "s"} in your hands — call again with offset: ${next}` }
          : {}),
        holding: page.map((id) => ({ thing: id, made_by: id.split("/")[0] })),
      };
    }
    // ── TWO INPUTS THIS DOOR DOES NOT YET COMPUTE ──────────────────────────
    //
    // Both are `null` on purpose, and both are named in PLAN-things.md §8 (retired
    // from the root 2026-09-01; git history + Starstory day docs) rather than
    // left to be discovered by whoever next reads `declareHolding`'s signature
    // and assumes the door fills it.
    //
    // `roster` — the RESIDENT roster (who may receive a give). Unchecked here, so
    // a give to a handle that is not a resident is currently recorded. It cannot
    // forge anything: `declared_by` is the actor, and the thing does not move
    // twice.
    //
    // `groundOwner` — WHOSE GROUND THE THING IS STANDING ON, which is what the
    // take rule answers to. `declareHolding` implements and tests that rule in
    // full; this door cannot supply its input yet, because resolving it means
    // taking the thing's position and walking `placementParent` to the owning
    // mark and its `consent:` word — and `placementParent` is the expensive call
    // the spatial-index work exists to fix (C4-coupled). That coupling is WHY
    // this defers rather than being a thing anyone forgot.
    //
    // ⚠ THE HONEST CONSEQUENCE, said here as well as at the door: with this null,
    // NO take is checked against any ground's word at runtime. Ratified law is
    // implemented and unreachable. The tool description says so in as many words
    // — a door that promised enforcement it does not perform would be the exact
    // schema-vs-runtime defect this branch flagged on `leave_mark`'s `tier:`, and
    // it is not better for being mine.
    // ── THE LOOT SHROUD, AT THE HOLD DOOR (founder-ruled 2026-08-29) ─────────
    //
    // LOGOS § The portal ground: "A thing whose mark declares `loot` is NEITHER
    // VISIBLE NOR TAKEABLE while the encounter on its ground is afoot: … a
    // `take` or a `give` aimed at it is refused with a sentence that explains
    // itself rather than a bounce that reads like a fault."
    //
    // HERE RATHER THAN IN `declareHolding`, for the reason the mirror is at this
    // door too: `declareHolding` is the pure adjudicator, tested on hand-built
    // stores with no world db and no journal anywhere near it, and a shroud
    // inside it would hand every one of those tests two dependencies it has no
    // business having. This door is where the stores already are.
    //
    // BOTH VERBS, ONE CHECK. give/drop/take are one primitive here, and the
    // shroud is a fact about the OBJECT, so a hand that somehow has the wick end
    // cannot pass it on either — which is the honest reading of "neither
    // visible nor takeable" and costs nothing to hold.
    await refuseShroudedLoot(args.thing);
    const dials = thingDials();
    // ── LANE TWO OF THE PEN FLIP (W2_PEN=hold; runbook C2, 2026-09-03) ────────
    // Flipped, the record is Postgres `acts`, committed and awaited BEFORE the
    // attachments edge is allowed to stand; sqlite gets the edge + the
    // reverse-mirror copy in ONE transaction that commits only after the pen
    // has. Unreachable Postgres = the ruled refusal, and nothing was written —
    // the thing is exactly where it was. Unflipped, the door is what it was.
    const { laneFlipped } = await import("./world-journal.mjs");
    // ── THE REACH, AT THE DOOR, FOR BOTH PENS ─────────────────────────
    //
    // ⛔ IT WAS INSIDE `declareHoldingFlipped` FOR ONE COMMIT, and the suite
    // caught it: that function is documented as provable "on a hand-built store
    // with no world db and no Postgres", its whole `deps` parameter exists for
    // that, and a reach check inside it handed all three pen-ordering tests a
    // world engine, a clone and a walk ledger they have no business having.
    // Exactly the mistake this file's header warns about twice, made a third
    // time by me. The law belongs at the door, where the world already is.
    //
    // ON THE ORDERING, and why hoisting it above the flip branch is safe. B1
    // requires the HOLDER check to sit inside the write transaction, and it
    // still does — `declareHoldingFlipped` re-reads the rows after
    // `BEGIN IMMEDIATE` and `declareHolding` adjudicates ownership there. What
    // is read here is GEOMETRY, and the only thing a stale face can do is send
    // the wrong clause to a call the transaction then refuses on ownership
    // anyway. The one crossing case — a `drop` at check time that is a `take`
    // by commit time — means the actor dropped it in between, so they are
    // standing exactly where it now lies, and the reach it skipped would have
    // passed.
    const { guardedAttachments: guardRows } = await import("./world2-guards.mjs");
    const preRows = await guardRows(db);
    const preHolder = liveHolder(preRows, String(args.thing));
    refuseGiveOfUnheld({ thing: args.thing, to: args.to ?? null, actor, holder: preHolder });
    const face = faceOf(preHolder, args.to ?? null);
    const reached = await refuseOutOfReach({ thing: args.thing, to: args.to ?? null, actor, act: face, holder: preHolder });

    if (laneFlipped("hold")) {
      const stood = await standpointOfActor(actor);
      const out = await declareHoldingFlipped({ db, thing: args.thing, to: args.to ?? null, actor, dials, key, reached, stood });
      if (out?.did !== "drop") return out;
      // AFTER the drop's COMMIT, never inside its transaction: the amend is the
      // mark lane's own act on the mark lane's own pen, and holding the hold
      // lane's sqlite lock across a second pen's round trip would be a lock
      // this door has no business taking. The drop stands whatever the amend
      // does; the receipt says which happened.
      const setDown = await fileSetDownAmend({ did: out, stood, key, actId: out.seq ?? null });
      return { ...out, stands_note: setDownNote(setDown), set_down: setDown };
    }
    // ── THE UNFLIPPED PEN ─────────────────────────────────────────────
    // Both legs run before anything is written, and both are read from the live
    // holder the adjudicator is about to read: the `to:`-on-an-unheld-thing
    // bounce needs the caller's own word (which the faces discard), and the
    // reach needs the face (which only the adjudicator can name). So the holder
    // is read once here, the words are refused first, the faces are derived,
    // and the geometry is asked last — each question at the only point where
    // its input still exists.
    // B1: the same guard read on the unflipped pen path — the read flip and the
    // write flip are independent flags (runbook §4: "the ports gate the
    // DELETION, not the flag"), so W2_GUARDS=1 with W2_PEN unset is a real and
    // supported state, and it is the one this lane is proven in.
    const did = declareHolding({ db, thing: args.thing, to: args.to ?? null, actor, roster: null, groundOwner: null, dials, rows: preRows });
    const stood = await standpointOfActor(actor);
    mirrorHoldingAct(did, key);
    // The mirror is fire-and-forget on this pen, so there is no act id to
    // attribute to; the declaration's own stamp pairs the two acts instead.
    const setDown = did.did === "drop" ? await fileSetDownAmend({ did, stood, key, actId: null }) : null;
    return dressReceipt(did, { reached, stood, setDown });
  } finally { try { db?.close(); } catch { /* a reader that cannot close is still a reader that read */ } }
}

// ── THE HOLDING GAP, CLOSED (2026-08-28) ────────────────────────────────────
//
// Third instance of the say gap's class: a live write lane whose pen is not the
// journal, and so invisible to World 2.0. Here the pen is the `attachments`
// table (`declareAttachment`, dynamic-entities.mjs), and give/drop/take are
// three of the world's thirteen apex actions — nothing anyone has picked up,
// handed over or set down since the seed had a line in `acts`.
//
// HOOKED AT THE DOOR, NOT INSIDE `declareHolding`, and that is deliberate:
// `declareHolding` is the pure adjudicator — it takes a db and no key, it is
// tested directly on hand-built stores, and giving it a mirror would give every
// one of those tests a Postgres dependency it has no business having. The door
// is where a key exists (so the household resolves the way every other act's
// does) and where success is unambiguous: `declareHolding` THROWS on refusal,
// so a returned value is a declaration that landed.
//
// THE LAZY IMPORT IS THE POINT, not a shortcut. `world.mjs` imports this file,
// so a static import back would close a cycle; `await import(...)` inside the
// async body is the idiom this codebase already uses for exactly this
// (world-stake.mjs reaching world2-claims.mjs). It also means a store with the
// mirror off never loads world.mjs's world at all.
//
// Privacy: a holding is public by the door's own law — "what it does instead is
// RECORD every take with the resident who made it, so a ground-holder who
// objects has the record to point at" (world_hold's description). The thing is
// a public mark id and the actor is the resident who acted. Nothing new leaves
// the box.
function mirrorHoldingAct(did, key) {
  if (!did?.thing) return;
  void (async () => {
    try {
      const { world2Enabled } = await import("./world2-acts.mjs");
      if (!world2Enabled()) return;
      const { mirrorLaneAct, CLASS_HOLDING } = await import("./world-journal.mjs");
      const { witnessStamp } = await import("./world.mjs");
      const { resolvedWorldHousehold } = await import("./world-branches.mjs");
      const { currentCrossing } = await import("./crossings.mjs");

      // The actor's own standpoint, not the thing's: an act is witnessed where
      // the ACTOR stood (the-witnessed-line), and a held thing has no position
      // of its own — "it is wherever its holder is, derived on read".
      const { at, witnesses } = await witnessStamp(did.declared_by);
      await mirrorLaneAct(holdingEntry(did, { crossing: currentCrossing(), at, witnesses, cls: CLASS_HOLDING, household: resolvedWorldHousehold(key) }));
    } catch (e) {
      console.error(`[world2-acts] a holding did not reach acts (${String(e?.message ?? e).slice(0, 160)}) — the attachments edge is unaffected`);
    }
  })();
}

/** ONE ROW SHAPE for a holding act, whichever pen records it — the mirror
 * (unflipped) and the flipped pen must describe the same act the same way, or
 * the two eras of `acts` disagree about what a give looks like. */
export function holdingEntry(did, { crossing, at, witnesses, cls, household }) {
  return {
    crossing,
    actor: did.declared_by,
    action: did.did,                 // give | drop | take — the face, as the resident named it
    object: did.thing,
    at, witnesses, cls,
    household,
    payload: {
      thing: did.thing,
      holder: did.holder ?? null,
      previous_holder: did.previous_holder ?? null,
      made_by: did.made_by,
      policy: did.policy,
    },
    effect: did.did === "drop"
      ? "it stands on the ground where the holder set it down; the edge they authored is nullified"
      : `${did.holder} holds it now — authorship did not move, and where it stands is derived from whoever is holding it`,
    writtenAt: did.at,               // the declaration's own stamp, strictly ordered by the door
  };
}

// ── THE FLIPPED HOLD (W2_PEN=hold) ───────────────────────────────────────────
//
// R2's ordering, in sqlite's own terms. `declareHolding` adjudicates AND
// writes the attachments edge in one call, and the pen must commit before
// that edge may stand — so the edge is written inside a sqlite transaction
// that COMMITs only after `appendActFlipped` returns (Postgres committed; the
// reverse-mirror journal row is in the same sqlite transaction) and ROLLs BACK
// on any refusal. The three outcomes, each with one truth:
//
//   the door refuses (403/409/422)  → nothing in either store
//   the pen is unreachable          → 503, the ruled sentence, nothing in either store
//   the pen commits                 → acts holds the record; attachments + journal commit together
//
// A sqlite write transaction held across the pen's round-trip is deliberate
// and short (one INSERT-sized window); it is exactly the property that makes
// "nothing was written" true rather than asserted. `deps` exist so the ordering
// can be proven on a hand-built store with no world db and no Postgres — the
// door injects the real ones.
export async function declareHoldingFlipped({ db, thing, to = null, actor, dials = {}, key = null, deps = {}, reached = null, stood = null }) {
  const journal = await import("./world-journal.mjs");
  const appendActFlipped = deps.appendActFlipped ?? journal.appendActFlipped;
  const CLASS_HOLDING = journal.CLASS_HOLDING;
  const witnessStamp = deps.witnessStamp ?? (await import("./world.mjs")).witnessStamp;
  const resolvedWorldHousehold = deps.resolvedWorldHousehold ?? (await import("./world-branches.mjs")).resolvedWorldHousehold;
  const currentCrossing = deps.currentCrossing ?? (await import("./crossings.mjs")).currentCrossing;

  const { guardedAttachments } = await import("./world2-guards.mjs");

  db.exec("BEGIN IMMEDIATE");
  try {
    // ── B1: THE HOLDER CHECK, INSIDE THE TRANSACTION SHAPE ─────────────────
    // Read AFTER `BEGIN IMMEDIATE`, never before it. The sqlite write lock is
    // already held here, so the state this guard adjudicates against is the
    // state the edge commits against; a read taken before the BEGIN would open
    // exactly the window where another writer hands the thing on between the
    // check and the write, and "current state before history" (the three faces
    // above) would be answering about a past. Flipped, the rows come from
    // `acts`, both eras, latest-wins; unflipped, `readAttachments(db)`.
    const rows = await guardedAttachments(db);
    // The reach was already asked at the door, above the flip branch, and its
    // answer rides in as `reached`. It is NOT re-asked here: this function's
    // contract is that it can be driven on a hand-built store with no world db
    // and no Postgres, and a world read inside the transaction would take that
    // away from the three tests that exist to prove the pen's ordering.
    const did = declareHolding({ db, thing, to, actor, roster: null, groundOwner: null, dials, rows }); // throws the door's own bounce on refusal
    const { at, witnesses } = await witnessStamp(did.declared_by);
    const row = await appendActFlipped(db, holdingEntry(did, { crossing: currentCrossing(), at, witnesses, cls: CLASS_HOLDING, household: resolvedWorldHousehold(key) }));
    db.exec("COMMIT");
    // Which store is the RECORD for this act — said in the answer, as the stance
    // door says it (the journal row behind it is the reverse-mirror copy).
    // `seq` IS THE ACT'S ID (G1): `appendActFlipped` answers `seq: null` and
    // `actId`, and every other flipped door answers with the id. This one read
    // `row.seq` and so answered null on every act since G1 — found by POS-138,
    // which needs the drop act's id to attribute the amend to.
    return { ...dressReceipt(did, { reached, stood }), log: "acts", seq: row.actId ?? row.seq ?? null };
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* no transaction to roll back — the BEGIN itself failed */ }
    if (err?.name === "PenUnreachableError")
      throw bounce(503, err.message,
        "this lane's pen is the office's record (W2_PEN=hold); when it cannot be reached the door refuses rather than writing anywhere else — the thing is exactly where it was, and your act is safe to make again");
    throw err;
  }
}
