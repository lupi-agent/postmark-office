// world-journal.mjs — THE SINGLE LOG. Every world mutation, one append-only row.
//
// ── WHAT THIS IS ─────────────────────────────────────────────────────────────
//
// POS-5 slice 1 of the world-runtime ladder (§2, and §8's storage ruling (b)).
// Today a `world_leave_mark` is a git ceremony: lease a worktree out of the
// pool, take the town lock plus a household lock, check out `draft/<household>`,
// write a file, commit, push. The ceremony's only job was ever to let git absorb
// writes it does not need before the save. Behind `WORLD_SINGLE_LOG=1` a mark is
// ONE INSERT into the table below, and the drain (slice 2) is what git hears
// about.
//
// The plan's own words for the thing this file is: "Source 3 — the live journal.
// The dynamic DB's single append-only log: everything declared since the last
// save. SUBJECT · ACTION · optional OBJECT · EFFECT. Truncated at the save after
// write-down. The ONLY thing that moves between saves."
//
// ── THE TWO LAWS THIS FILE ANSWERS ───────────────────────────────────────────
//
// `the-witnessed-line` (world main, tier constitution) — a deliberate RED
// planted 2026-08-22 for this slice to flip:
//
//   "Every line of the log carries its witnesses at write time — an anchor and
//    an offset: where the actor stood, relative to what, at that instant."
//
// `the-anchor` (same planting) says what an anchor may be:
//
//   "An anchor is a mark, an entity, or the world — a held thing rides its
//    holder as a rider rides the deck; what may anchor where is class contract."
//
// So `at_anchor/at_dx/at_dy` is not a coordinate pair with extra steps. A raw
// world x,y is a photograph: it cannot survive the thing it was measured against
// moving, which is the whole failure §8 catalogues four times over (the rider,
// the held thing, the emission on the deck, the stale occupancy). An anchor plus
// an offset survives it, because the anchor moves and the offset does not.
//
// ── WHY ONE SCHEMA FOR BOTH LAWS ─────────────────────────────────────────────
//
// Keemin ruled §8 storage as (b): frame-transition events ride THIS log, not a
// frame column on dynamic.db entities. That is why `class` exists as a column
// and why a row's `at` is already anchor-relative — a reparenting is a row whose
// EFFECT is "the anchor changed", and it needs no shape this file does not
// already have. Slice 1 builds the corridor and proves a frame row replays; it
// does NOT re-point walk/enter/exit, because that is the position-core rewrite
// §8 explicitly defers ("NOT a land-it-today job").
//
// ── THE COLUMNS, AND WHICH ARE RULED ─────────────────────────────────────────
//
// Ruled (the row schema, 2026-08-23): seq · crossing · actor · at (anchor +
// offset) · witnesses · class · payload.
//
// Three more come straight from §2's own grammar — the log is SUBJECT · ACTION ·
// OBJECT? · EFFECT?, and `actor` is only the SUBJECT of it: `action`, `object`,
// `effect`. Two more are operational and named here rather than smuggled:
// `household` (the drain's scoping key — §3 writes drafts down to
// `draft/<household>`, and the read's exposure scope is the same word) and
// `written_at` (the wall clock, beside `crossing`'s town clock, because a
// replay that cannot say when is a replay that cannot be checked).
//
// ── REPLAYABLE IN PRINCIPLE, TODAY ───────────────────────────────────────────
//
// `readJournal` + `replayDrafts` are written in this slice even though the drain
// that will consume them is slice 2's. A write path whose reader does not exist
// yet is a write path nobody has proven can be read back, and the whole point of
// an append-only log is that the log is the truth. `replayDrafts` is pure: rows
// in, the §1c delta shape out, no store and no git.
//
// Env: WORLD_SINGLE_LOG=1 — the write path becomes the journal. OFF is
// byte-identical to today, which is a falsifier, not a hope.

import { execFileSync } from "node:child_process";

import { openDynamic, dynamicDbPath, singleLogEnabled } from "./dynamic-store.mjs";
import { mirrorAct, mirrorSettled, world2Enabled } from "./world2-acts.mjs";
import { candleEnabled, claimEligible, claimHouseholdFor, claimTxFromJournal, docketSettled } from "./world2-claims.mjs";
import { PenUnreachableError, laneFlipped, laneOf, penSettled, penWrite, shadowWrite } from "./world2-pen.mjs";

/**
 * Is this row a PRIVATE compose, whose act must not reach the public `acts`
 * log until a stake puts it forward? (Phase 5.6 — see the deferral note in
 * appendJournal.)
 *
 * Narrow on purpose, and every clause earns its place:
 *   · mark class + leave-mark/amend — the only declarations that carry a body.
 *   · put_forward !== true — the DOOR's verdict that this act stakes the mark;
 *     an unstaked declaration is the resident composing, not the town acting.
 *   · candleEnabled — WITHOUT THE DOCKET THERE IS NOTHING TO CARRY THE ROW.
 *     Deferring with the candle off would not make an act private, it would
 *     drop it on the floor, and the parity falsifier would be right to red.
 *     A store that cannot hold a draft gets the old behaviour, unchanged.
 *
 * KNOWN GAP, named rather than hidden: a `withdraw` of a private draft still
 * mirrors, so `acts` records that this author discarded this slug — the FACT
 * and the NAME leak, though never the body. Closing it needs the door to know
 * synchronously that the target is a draft, which it cannot today (the docket
 * pen is async and the 1.0 published/unpublished split does not answer it).
 * Carried as a finding, not papered over.
 */
function privateDraftAct(row) {
  return String(row.class) === CLASS_MARK
    && (row.action === ACTION_LEAVE || row.action === ACTION_AMEND)
    && candleEnabled()
    && (() => { try { return JSON.parse(row.payload ?? "{}")?.put_forward !== true; } catch { return false; } })();
}
import { draftDeltaForKey, mainRef, publishedState, resolvedWorldHousehold } from "./world-branches.mjs";

export { singleLogEnabled };

// The world frame. §8: "the frame chain to `the-town/let-there-be-light` (which
// IS the world frame; 'world coords' = the let-there-be-light reference frame,
// nothing more)". Its own centre is the origin, so an offset from it IS a world
// coordinate — which is why this is a named anchor and not a null.
export const WORLD_ANCHOR = "the-town/let-there-be-light";

// The row classes. `mark` is a declaration about the world's static record;
// `frame` is a reparenting (§8's ruling (b)). Both ride one table, and the drain
// sorts them by this column: marks to the sketchbook, frames to STATE/log.
import { TOWN_CLASSES } from "./town-journal.mjs";

export const CLASS_MARK = "mark";
export const CLASS_FRAME = "frame";
// ── THE LANE CLASSES (2026-08-28, the write-path closure) ───────────────────
//
// Two more kinds of act, and NEITHER RIDES THIS TABLE. They are declared here
// beside their siblings because `class` is one vocabulary and a word invented
// at its own call site is a word the next reader has to go find — the same
// reason CLASS_STANCE living in world-stance.mjs cost this file eight tests
// (the tripwire's allowlist, above).
//
// `voice` is a say: written to the voices log (voices.mjs § append), which is
// the ruled durable operator record and stays exactly that. `holding` is a
// give/drop/take: an edge in `attachments` (world-hold.mjs § the act). Both
// reach World 2.0's `acts` through `mirrorLaneAct` rather than through this
// table — see its header for why a lane with its own pen does not grow one
// here.
export const CLASS_VOICE = "voice";
export const CLASS_HOLDING = "holding";
// `move` is a walk — an entity's own declared departure. It is not a `frame`
// row: a walk moves you WITHIN a frame, and §8 is explicit that a frame changes
// only at a boundary you stand on. enter/exit are the reparentings and keep
// `frame`; walk gets its own word so the log does not have to be read twice to
// tell them apart.
export const CLASS_MOVE = "move";
// `ride` is naming a destination from inside a vehicle (Keemin, 2026-09-19:
// "have the journal write the act as 'ride' not 'board'", and "the log should
// differentiate between walking and taking a vehicle"). It is deliberately NOT
// `move`: a walk is a line with a pace and a clock that a position reader
// interpolates along, and a ride has no line and no intermediate points — the
// rider sits still while a hull follows its own timetable somewhere else. It is
// not `frame` either: the reparenting already happened at the `enter`, and a
// ride changes only where the rider may step off. Its own word, so the log does
// not have to be read twice to tell the two apart. Machinery: world-ride.mjs.
export const CLASS_RIDE = "ride";

// The arena's beats. The arena closed on 2026-09-30 (Keemin) and writes none;
// its old rows stay in dynamic.db's journal until they are archived
// (tools/arena-archive.mjs reads them by this class). `appendArenaRow`, the
// one sqlite INSERT G1 had left standing, closed with it.
export const CLASS_ARENA_ACT = "arena-act";

// ── THE LEDGER CONTRACT (POS-5 §3's finisher) ───────────────────────────────
//
// The two PUBLIC ledgers — `WORLD/walk-ledger.md` and the passage record (then
// `WORLD/threshold-ledger.md`, since 2026-08-26 `WORLD/enter-exit-ledger.md`) —
// took one git commit on main PER ACT. Ruled 2026-08-22: "walks + enter-exit
// should settle at the save, not per-act to git main."
//
// ONLY THE WALK LEDGER STILL SETTLES INTO A FILE (2026-08-28, #2152). The
// passage record became DERIVED — regenerated at read time from a frozen era
// plus these very rows — and the copy committed in the world repo is the frozen
// era by that repo's own law. Passage rows still carry their lines here, and
// they are still read: the derivation is what reads them. What changed is that
// nothing appends them to a file any more, because a derived record with a pen
// is two answers to one question. See `src/enter-exit-ledger.mjs`.
//
// A row that owes lines to a public ledger carries them VERBATIM:
//
//   payload.ledger   the repo-relative path the lines belong in
//   payload.lines    the exact lines, already formatted by the act's own pen
//
// THE LINE ITSELF, not the ingredients to rebuild it. That is the whole
// equivalence argument: the save appends what the act already wrote rather than
// re-deriving it, so "the record carries the same lines the per-act commits
// would have" is true by construction instead of by a second formatter agreeing
// with the first. Slice 2 learned this the expensive way — one home for a
// serialization, or two eras disagree in a way that still parses.
export const LEDGER_PAYLOAD = "payload.ledger + payload.lines — the act's own formatted lines, carried verbatim";

// The mark verbs, as the door speaks them. `amend` and `withdraw` are LATER
// ENTRIES, never edits — supersession-by-latest is the whole revision family
// (edit-law), and it costs this table nothing because nothing is ever updated.
export const ACTION_LEAVE = "leave-mark";
export const ACTION_AMEND = "amend";
export const ACTION_WITHDRAW = "withdraw";

const MARK_ACTIONS = new Set([ACTION_LEAVE, ACTION_AMEND, ACTION_WITHDRAW]);

// Exported for the store write-down, whose nested-path test is `planDrain`'s
// verbatim and must spell the root the same way.
export const ROOT_PREFIX = "WORLD/marks/let-there-be-light";

// THE FREEZE (founder-ruled 2026-08-25; LOGOS/state-and-time.md § "The freeze —
// filing is static, and the tree is a fossil"):
//
//   "New marks are filed by identity — WORLD/marks/<household>/<slug>/ — and
//    containment lives only in the derived fold, emitted as an artifact each
//    settlement."
//
// The id IS `<household>/<slug>`, so the path is the id and nothing has to be
// looked up to know it. The office's slug grammar is `^[a-z0-9][a-z0-9-]*$`
// (world.mjs), so an id is exactly two segments and this join is unambiguous.
const MARKS_PREFIX = "WORLD/marks";

/** `<by>/<slug>` for a record, whichever half it carries. */
const idPartsOf = (record) => {
  const id = String(record?.id ?? "");
  const [idBy, ...idRest] = id.split("/");
  return {
    by: record?.by ?? (idBy || null),
    slug: record?.slug ?? (idRest.length ? idRest.join("/") : null),
  };
};

// ── the anchor ───────────────────────────────────────────────────────────────

/**
 * Where the actor stood, RELATIVE TO WHAT — the-witnessed-line's "an anchor and
 * an offset".
 *
 * `chain` is the containment spine at the point, outermost first, exactly as the
 * engine's `containmentChain` yields it; `centreOf` resolves a mark id to its
 * composed world centre. The innermost containing mark is the anchor, because it
 * is the frame the actor is actually standing in; when nothing contains the
 * point, the anchor is the world and the offset is the world coordinate itself.
 *
 * PURE — no store, no engine, no clone. The caller derives the spine (which
 * needs both) and hands it over, the way `positions.mjs` takes its frames.
 *
 * A point that cannot be read at all returns the world anchor with a null
 * offset rather than a zero one: `{x:0,y:0}` is the Origin, a real place
 * somebody could be standing, and a deriver that substitutes it for "unknown" is
 * the exact quiet substitution the customs-house law forbids.
 */
export function anchorAt(point, { chain = [], centreOf = null } = {}) {
  const x = Number(point?.x), y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y))
    return { anchor: WORLD_ANCHOR, dx: null, dy: null, unplaced: true };

  const inner = Array.isArray(chain) && chain.length ? chain[chain.length - 1] : null;
  const id = inner?.id ?? null;
  const centre = id && typeof centreOf === "function" ? centreOf(id) : null;
  if (!id || !centre || !Number.isFinite(Number(centre.x)) || !Number.isFinite(Number(centre.y)))
    return { anchor: WORLD_ANCHOR, dx: x, dy: y };

  return { anchor: id, dx: x - Number(centre.x), dy: y - Number(centre.y) };
}

/** The inverse: an anchor+offset back to world coordinates. What every reader of a row needs, and the reason the pair is stored rather than the point. */
export function composeAnchor({ anchor, dx, dy }, centreOf = null) {
  // `dx == null` FIRST, and not folded into the isFinite check: Number(null) is
  // 0, not NaN, so an unplaced actor's null offset would compose to {0,0} —
  // the Origin, a real place somebody could be standing. That is the
  // quiet substitution the whole anchor pair exists to prevent, and it is the
  // defect the-anchor's own falsifier caught here.
  if (dx == null || dy == null) return null;
  if (!Number.isFinite(Number(dx)) || !Number.isFinite(Number(dy))) return null;
  if (!anchor || anchor === WORLD_ANCHOR) return { x: Number(dx), y: Number(dy) };
  const centre = typeof centreOf === "function" ? centreOf(anchor) : null;
  if (!centre || !Number.isFinite(Number(centre.x)) || !Number.isFinite(Number(centre.y))) return null;
  return { x: Number(centre.x) + Number(dx), y: Number(centre.y) + Number(dy) };
}

// ── the witnesses ────────────────────────────────────────────────────────────

/**
 * Who was there, EACH PINNED at the write instant — the-witnessed-line's plural.
 *
 * A witness is not a handle. A handle is a pointer to wherever that resident is
 * NOW, and "now" is the one instant a log line is never read at. So each witness
 * carries their own anchor and offset, frozen: the line says where everyone
 * stood when it was written, and stays true when they all walk away.
 *
 * DISCLOSURE, NOT AN EMPTY LIST. Presence is its own flag (`WORLD_PRESENCE`) and
 * its own read that can fail. "Nobody was within earshot" and "this office could
 * not see who was within earshot" are different facts, and a bare `[]` for both
 * is the deriver's law broken in the quietest possible way — the same class as
 * the homeless-vs-unreadable bug `HOME_BLOCK_UNREADABLE` exists to end. So the
 * column holds `{ source, list }`, and `source` is `presence` or a named reason.
 */
export function pinWitnesses({ residents = null, unread = null, centreOf = null, chainAt = null } = {}) {
  if (unread || !Array.isArray(residents)) return { source: "unread", reason: String(unread ?? "presence-not-read"), list: [] };
  const list = [];
  for (const r of residents) {
    const handle = r?.handle;
    if (!handle) continue;
    const point = { x: Number(r?.at?.x ?? r?.x), y: Number(r?.at?.y ?? r?.y) };
    const chain = typeof chainAt === "function" ? chainAt(point) : [];
    const { anchor, dx, dy } = anchorAt(point, { chain, centreOf });
    list.push({ handle, anchor, dx, dy });
  }
  list.sort((a, b) => (a.handle < b.handle ? -1 : a.handle > b.handle ? 1 : 0));
  return { source: "presence", list };
}

// ── the write ────────────────────────────────────────────────────────────────

const ROW_COLUMNS = "crossing, actor, action, object, at_anchor, at_dx, at_dy, witnesses, class, payload, effect, household, written_at";

/**
 * ONE ROW, INTO THE RECORD — the whole write path, for every verb but the arena.
 *
 * Nothing here validates the world — a draft costs nothing (Keemin, 2026-08-22),
 * and the door above has already spoken every refusal a resident is owed. This
 * is the pen, not the gate.
 *
 * ── THE STORE IS THE WRITE (G1 / POS-156, RULING 3, 2026-09-22) ─────────────
 *
 * This function used to INSERT a sqlite `journal` row and then hand the row to
 * a fire-and-forget Postgres queue. The INSERT is gone, and with it the only
 * thing that made the fire-and-forget defensible. Two sentences in this repo
 * said so before the deletion existed, and they are the whole argument:
 *
 *   world2-pen.mjs § shadowWrite — the queue is "fire-and-forget for the
 *   caller … acceptable ONLY because the sqlite journal is still the SoT on an
 *   unflipped lane"
 *
 *   world2-acts.mjs § WRITE DISCIPLINE — "the cutover rewrite awaits the
 *   insert and refuses at the door instead"
 *
 * So the write is AWAITED and a failure THROWS. A door whose act cannot reach
 * the record refuses; it never answers 200 over an act no store holds. That is
 * the cost of a store-of-record town and it was ruled with the cost named: when
 * Postgres is down these doors answer 503 where they used to answer 200 on the
 * strength of a sqlite row nobody was going to read.
 *
 * ⚑ ASYNC NOW, AND THE UN-AWAITED FORM IS SILENT — a caller that forgets the
 * `await` gets a Promise whose `.seq` is `undefined` and whose rejection is
 * unhandled, which reads downstream as a successful write of nothing. Every
 * call site awaits, and the deletion's own falsifier pins that.
 *
 * ⚑ `db` IS STILL TAKEN AND STILL UNUSED HERE. The doors pass `null` since
 * POS-269: each used to open the dynamic store in write mode only to hand the
 * handle over, and that open was a WAL pragma, the whole DDL and a lock on every
 * say, walk, crossing, ride, stance and mark, taken for nothing. The parameter
 * stays because some forty test and tool call sites pass a store positionally.
 * The arena is the one caller that still WRITES sqlite, through its own named
 * function below.
 *
 * Returns the row as recorded. `seq` is `null` — there is no sqlite rowid any
 * more — and `actId` is the record's own id, which is the receipt a caller
 * names its write by.
 */
export async function appendJournal(db, entry = {}) {
  const row = normalizeRow(entry);

  // World 2.0 is the record. A mark-class declaration also takes its place on
  // the public docket (`claims`) on the SAME client in the SAME transaction —
  // R1's one queue, unchanged by the deletion.
  //
  // ── THE DEFERRAL, and why the act is conditional (Phase 5.6) ─────────────
  //
  // A PRIVATE DRAFT MUST NOT REACH `acts`, because `acts` is the one table that
  // leaves the box: the notary exports `archives/acts/<window>.jsonl` into a
  // public git repo, frozen on write. A leave-mark's payload carries the mark's
  // BODY — so writing an unstaked declaration there would publish a resident's
  // private sentence permanently, and no row policy on `claims` could reach it.
  // That is the whole privacy promise of Phase 5.6.
  //
  // So an unstaked mark-class row takes `act: false`: the claim is written, the
  // deed is not, and the row rides on the draft (`data._deferred_act`) until a
  // stake makes the mark public — dated at the putting-forward, which is when
  // the world actually witnessed anything. The predicate is deliberately
  // narrow: ONLY an unstaked mark-class declaration defers.
  //
  // ⚑ THE PRIVATE ARM RIDES THIS QUEUE, not a second one, and the reason is
  // measured rather than argued: it used to be its own pen on its own pool, and
  // an unstaked compose and its own withdrawal rode different queues with
  // nothing ordering them — the withdrawal's DELETE ran 113 ms ahead of the
  // INSERT it was meant to remove, five fresh stores, five times, leaving the
  // resident's withdrawn draft on the docket with its slug still taken
  // (jetto-b1-guards-report 2026-09-03 § Finding 1).
  const draft = claimEligible(row) && privateDraftAct(row);
  const { actId } = await penWrite(row, claimEligible(row)
    ? {
      act: !draft,
      household: () => claimHouseholdFor(row),
      // `seq` is NULL, and that is the point: there is no sqlite row to pair
      // with. 001's own words — `journal_seq` is "the shadow-era pairing key,
      // dying at cutover". The closure falsifier pairs an act to its claim by
      // the claim's own slug and claimant, never by that column.
      claimFn: (client, actId, household) => claimTxFromJournal(client, row, null, { household, actId }),
    }
    : {});   // throws PenUnreachableError — the door bounces, nothing was written

  // `record` is what the door's `log:` field says, decided HERE because this is
  // the line that knows which table received the row. A private draft has no
  // deed by law, so answering "acts" for one would name a record that does not
  // hold it.
  return { seq: null, actId, record: draft ? "claims" : "acts", ...row };
}


/**
 * THE FLIPPED WRITE — the pen-flip design's §3 ordering, per lane (D1).
 *
 * Postgres commits FIRST and is awaited; on failure this THROWS
 * PenUnreachableError and NOTHING has been written anywhere — the door owes
 * the resident the ruled refusal (D2): "the office's record cannot be
 * reached — nothing was written, and nothing was lost."
 *
 * After the commit, the sqlite journal receives the same row as the REVERSE
 * mirror (D3) — best-effort, after the record, never with a vote. While it
 * holds, every 1.0 read (the door guards included) stays valid, which is what
 * lets a lane flip before the R3 read ports land: the ports gate rule 6's
 * DELETION, not this flag. A reverse write that fails is loud and the parity
 * falsifier's reverse arm reds at the next check.
 *
 * THE MARK LANE IS NO LONGER REFUSED HERE (wired 2026-09-04, runbook C6). It
 * was refused by name for UNREADINESS — "its candle half must ride penWrite's
 * own transaction" — and that is now what happens: a mark-class row carries a
 * `claimFn` and a household resolver into `penWrite`, so the act and its claim
 * commit on one client in one transaction, and an unstaked declaration rides
 * the same client with `act: false` so its body never reaches the table that
 * leaves the box. The refusal is removed in the same change that wires the
 * path, because a refusal left standing over a wired path is a lie in the other
 * direction.
 *
 * The ARENA lane is refused BY RULING, not by unreadiness (founder, 2026-08-29,
 * the birthday party's own night: "we can just keep the arena on sqlite for
 * now"). The combat machinery is scheduled to be rebuilt hardened and
 * 2.0-native rather than ported, so its lane stays sqlite-first deliberately —
 * no read port exists, no reverse-mirror deadline applies to it, and a
 * `W2_PEN=all` sweep must not carry it along by accident. Lifting this refusal
 * is a founder ruling plus the arena read ports, together.
 *
 * "No reverse-mirror deadline applies to it" was a sentence this file asserted
 * and no mechanism kept: `MIRROR_EXPIRES` was one date for the whole store, so
 * the parity falsifier would have reded the arena on 2026-10-01 with everything
 * else (the cutover runbook §8 named it; DEC-2 ruled it 2026-08-29 evening). It
 * is now true where it is checked: `LANE_MIRROR.arena.expires` is null in
 * src/world2-acts.mjs, carrying this same ruling in its own words.
 *
 * THE TWO REFUSALS WERE NOT THE SAME KIND, and the expiry is where the
 * difference bit. `mark` was refused for UNREADINESS, so it was governed by its
 * backstop exactly like the wired lanes — DEC-2, verbatim: "a lane in
 * `FLIP_REFUSED` by ruling is exempt; a lane refused by unreadiness is not."
 * Being un-wired must never be the thing that buys a lane immortality. With the
 * mark lane wired only the ruled refusal is left, which is the state DEC-2
 * describes: this table now holds exactly the lanes that are exempt BY RULING,
 * and `LANE_MIRROR.arena.expires` is null for the same reason and in its own
 * words (src/world2-acts.mjs). `mark` keeps its ordinary expiry.
 */
const FLIP_REFUSED = Object.freeze({
  arena: "the arena is closed (Keemin, 2026-09-30) and writes nothing; unset it from W2_PEN",
});

export async function appendActFlipped(db, entry = {}) {
  const row = normalizeRow(entry);
  const lane = laneOf(row);
  if (FLIP_REFUSED[lane]) {
    throw new Error(`the "${lane}" lane's flip is not wired — ${FLIP_REFUSED[lane]}`);
  }
  // ── THE CANDLE HALF, ON THE PEN'S OWN CLIENT (runbook C6) ─────────────────
  //
  // A mark-class row is two facts, not one: the deed and its place on the
  // public docket. `claimFn` carries the second into `penWrite`'s transaction
  // so they commit together or not at all — the runbook's whole reason this
  // lane could not flip by flag: doing so "would write acts with no docket,
  // which is F2 self-inflicted."
  //
  // `seq` IS NULL HERE, AND THAT IS THE POINT. The reverse mirror runs after
  // the awaited pen, so at this line the sqlite row does not exist and has no
  // seq to carry. 001's own words: `journal_seq` is "the shadow-era pairing
  // key, dying at cutover" — and "journal_seq is not an identity" is a lesson
  // this store has now learned three times. The closure falsifier pairs an act
  // to its claim by the claim's own slug and claimant, never by this column.
  //
  // An unstaked declaration takes `act: false`: the claim is written, the deed
  // is not, and the row rides on the draft (`data._deferred_act`) until a stake
  // makes it public. Phase 5.6, unchanged by the flip — the privacy promise is
  // not something a flag may quietly spend.
  const draft = privateDraftAct(row);
  const { actId } = await penWrite(row, claimEligible(row)
    ? {
      act: !draft,
      household: () => claimHouseholdFor(row),
      claimFn: (client, actId, household) => claimTxFromJournal(client, row, null, { household, actId }),
    }
    : {}); // throws PenUnreachableError — the door bounces, nothing was written

  // ── THE REVERSE MIRROR IS GONE (G1 / POS-156, 2026-09-22) ─────────────────
  //
  // A sqlite `journal` row was written HERE, after the awaited pen, as D3's
  // reverse mirror: "while it holds, every 1.0 read (the door guards included)
  // stays valid, which is what lets a lane flip before the R3 read ports land."
  // Every one of those ports has landed — POS-152 (the ride's entry stop),
  // POS-153 and POS-162 (the hold shelf), POS-154 (walkers), POS-194
  // (occupancy), POS-195 (the stance candidates) — so the copy has no reader
  // left, and rule 6's deletion is what ends a shim rather than a date.
  //
  // `seq` IS NULL FROM HERE ON, and it is null in `appendJournal` too. There is
  // no sqlite rowid to answer with; the receipt is `actId`, the record's own.
  // The doors that used to answer `seq:` with the mirror's rowid answer it with
  // the act's id now — one sequence, the one the record keeps.
  //
  // `record` is what the door's `log:` field should say, decided HERE because
  // this is the line that knows which table actually received the row. A
  // private draft has no deed by law, so answering "acts" for one would name a
  // record that does not hold it — the same small dishonesty `composed_at`
  // exists to avoid on the drafts read. Every other row is an act.
  return { seq: null, actId, flipped: true, record: draft ? "claims" : "acts", ...row };
}

/** Which pen a lane's call site should use — the one switch the doors read. */
export function penFor(entry) {
  const lane = laneOf(normalizeRow(entry));
  return laneFlipped(lane) ? "postgres" : "journal";
}

export { PenUnreachableError, laneFlipped };

/**
 * WHICH ACT LOG THIS OFFICE READS, named for a disclosure — one sentence, one
 * place, so two doors cannot name two different stores for the same fact.
 *
 * Exists because of a borrowed sentence (the office-halves review, repair 11):
 * the gathering and handoff shadows copied the subscription door's "the act
 * log this reads is Postgres, and this office is not pointed at it" — CORRECT
 * there, because that door has no journal arm and being un-pointed at Postgres
 * really is its only cause — and then grew a journal arm, after which the one
 * configuration the sentence blamed was the one that could not produce it. A
 * resident with a torn `dynamic.db` was sent to check a Postgres setting. The
 * after-a-repeal-grep-its-citations class: the journal arm repealed the
 * premise and the disclosure still cited it.
 */
export function actLogNameFor(env = process.env) {
  return world2Enabled(env)
    ? "Postgres (this office is pointed at it: WORLD2_PG=1 with WORLD2_PG_URL)"
    : "the sqlite journal (WORLD_DYNAMIC_DB, or dynamic.db beside world.db — this office is not pointed at Postgres, which is the ordinary working configuration)";
}

/**
 * ONE ROW, NORMALIZED — the whole of what a journal line IS, with no store in
 * sight.
 *
 * Split out of `appendJournal` on 2026-08-28 for the write-path closure, and
 * the split is the point rather than tidiness. `acts` receives rows from TWO
 * kinds of lane now — the ones that write a sqlite journal row first, and the
 * ones that keep their own pen (a voice, a holding) — and if each built its own
 * row shape, the two would drift field by field until a `say` and a
 * `leave-mark` disagreed about what `at_dx: null` means. This file already
 * learned that lesson once, in the LEDGER_PAYLOAD note above: one home for a
 * serialization, or two eras disagree in a way that still parses.
 *
 * Every trap the insert path knew is in here, unchanged and still commented at
 * its line — most of all the `== null` FIRST ordering, which is the difference
 * between "the world, position unknown" and the Origin.
 */
export function normalizeRow(entry = {}) {
  const {
    crossing = null, actor, action, object = null,
    at = null, witnesses = null, cls = CLASS_MARK,
    payload = null, effect = null, household = null,
    // A say's retry key (POS-265, migration 027). Kept only when given, so
    // every other row is the object it always was and names no such column.
    nonce = null,
    // ── `written_at` IS `acts.at`, AND THE DECLARED INSTANT OUTRANKS IT ──────
    //
    // The fallback below is this process's clock at NORMALIZE time — the
    // mirror's, taken after the resident declared. It stays, because it is the
    // only honest answer for an act class that has no instant of its own:
    // `mark` (world.mjs, the declare and the withdraw), `ride`
    // (world-apex.mjs), `stance` (world-stance.mjs) and the crossing's own
    // rows (crossing-exec.mjs) all reach here with no `writtenAt` and nothing
    // better to offer.
    //
    // An act class that DOES know when it happened passes `writtenAt` and this
    // default never fires: `voice` (world.mjs § voiceEntry, the spoken
    // instant), `holding` (world-hold.mjs, "the declaration's own stamp,
    // strictly ordered by the door") and, since POS-198, `move` — the walk act
    // carries the same string `dynamic.db/movements` is stamped with, from one
    // `Date` read in `walkViaOffice`. That is what lets `acts` render the
    // world's `STATE/log/` departure record: `live-reads § departureRecordOf`
    // reads era 5's instant as `isoOf(row.at)`, and row.at is this column.
    //
    // ⚑ A DESTRUCTURING DEFAULT FIRES ON `undefined` AND NOT ON `null`. A
    // caller that means "I have no instant" must omit the key or pass
    // undefined; passing null would store the string "null" in the first field
    // every reader of a departure reads. `walkEntry` coalesces for exactly
    // this reason.
    writtenAt = new Date().toISOString(),
  } = entry;

  if (!actor) throw new Error("a journal line needs an actor — every mutation has a SUBJECT");
  // ── THE TRIPWIRE: no row that belongs to ANOTHER log may land here ─────
  //
  // Added with the town log (town-journal.mjs, 2026-08-24). The two logs live
  // in separate tables precisely so a join row cannot be deleted undrained by
  // the world drain's class-blind truncate — but separate tables only help if
  // rows land in the right one, and nothing about `appendJournal(db, { cls })`
  // stops a caller aiming a join here. So it bounces at WRITE time: a stack
  // trace on the line that wrote it, instead of somebody's household vanishing
  // twelve hours later with nothing left to read.
  //
  // STATED AS A DENYLIST OF THE TOWN'S CLASSES, NOT AN ALLOWLIST OF THE
  // WORLD'S, and the first draft got that backwards. An allowlist has to be a
  // complete census of every class this log will ever hold — and those
  // constants do not all live here: CLASS_STANCE is declared in
  // world-stance.mjs, so the allowlist silently refused every stance row and
  // took eight live tests down with it. A guard that must be updated from
  // another file each time the world grows is a guard that will be wrong
  // again. This one only has to know what the OTHER log owns, which is a
  // closed set by construction, imported from the file that defines it.
  if (TOWN_CLASSES.has(String(cls)))
    throw new Error(
      `"${cls}" is the town log's class, not the world's — `
      + `a town act belongs in town_journal via appendTownJournal; writing it here would put it under a drain that does not read it`);
  if (!action) throw new Error("a journal line needs an action — every mutation has an ACTION");

  const row = {
    crossing: crossing == null ? null : Number(crossing),
    actor: String(actor),
    action: String(action),
    object: object == null ? null : String(object),
    at_anchor: at?.anchor ?? null,
    // `== null` FIRST, the third instance of the same trap in this file:
    // Number(null) is 0 and 0 is finite, so an UNPLACED actor's null offset
    // would be stored as {0,0} — the Origin, a real place, written onto a
    // constitutional line as where somebody stood. A null offset beside a real
    // anchor says "the world, position unknown", which is the truth.
    at_dx: at?.dx == null || !Number.isFinite(Number(at.dx)) ? null : Number(at.dx),
    at_dy: at?.dy == null || !Number.isFinite(Number(at.dy)) ? null : Number(at.dy),
    witnesses: witnesses == null ? null : JSON.stringify(witnesses),
    class: String(cls),
    payload: payload == null ? null : JSON.stringify(payload),
    effect: effect == null ? null : String(effect),
    household: household == null ? null : String(household),
    written_at: String(writtenAt),
    ...(nonce == null ? {} : { nonce: String(nonce) }),
  };

  return row;
}

// ── THE LANE HOOK · an act the sqlite journal never held ────────────────────
//
// THE GAP THIS CLOSES, stated as the class rather than the instance. The live
// lane's law is that `acts` is the town's event log — "every act in the town
// belongs to exactly one lane" (gold §1) — and the mirror above delivers on
// that for every act that takes a journal row. It is silent about the acts that
// do not, and there are three of them: a SAY (its pen is the voices log), a
// HOLDING (its pen is `attachments`), and a WALK under WORLD_MOVEMENT_V2 (its
// pen is `movements`; the journal arm in walk-exec.mjs is the flag-OFF lane and
// has not run on dev since movement-v2 shipped). Nothing said, carried or
// walked since the seed reached World 2.0, and `/world2/say` answered over the
// crossing-save's crystallized record alone.
//
// ── WHY THESE DO NOT SIMPLY GROW A JOURNAL ROW ─────────────────────────────
//
// It was the first thing tried and it is the wrong shape, for two reasons that
// point the same way:
//
//   · THE JOURNAL IS BEING DELETED. It is 1.0's live layer, and rule 6 removes
//     it at cutover. Adding three lanes to the thing we are retiring is
//     lift-and-shift wearing a migration's coat (rule 1) — and `journal_seq`
//     is documented in 001_tables.sql as the SHADOW-ERA pairing key that "DIES
//     AT CUTOVER". A lane mirrored with no seq is already in its final shape;
//     a lane given a seq would have to be un-given one later.
//   · IT WOULD CHANGE 1.0. The drain crystallizes every non-mark row into
//     `STATE/log/<N>.journal.jsonl` in the world repo (world-drain.mjs §
//     logLine, which filters only for CLASS_MARK). So a journal row for every
//     say would put a new public git artifact on a live shared world, today,
//     to buy World 2.0 nothing it cannot have without it.
//
// So these lanes keep their own pens — untouched, still 1.0's truth — and this
// is the SECOND consumer of the same fact, exactly as `emissionFromVoice` is
// the second consumer of a voice. Same fire-and-forget contract as `mirrorAct`,
// same loudness on failure, same death date.
//
// ── AND THE ROW SHAPE IS NOT REINVENTED ────────────────────────────────────
//
// `normalizeRow` is the one that `appendJournal` uses, which is what makes "a
// say and a leave-mark are the same kind of row in `acts`" true by construction
// rather than by two normalizers agreeing.
/**
 * Mirror an act whose pen is not this table. `entry` is `appendJournal`'s own
 * vocabulary, so a lane describes its act exactly as a journalled lane would.
 *
 * Returns the mirror's promise (the caller may await it — an exec that is about
 * to `process.exit` MUST) or undefined when the mirror is off.
 */
export function mirrorLaneAct(entry = {}) {
  return mirrorAct(normalizeRow(entry), null);
}

// ── THE ESCAPE, AND WHY IT IS WORSE THAN THE GAP ────────────────────────────
//
// The say gap is a lane that never calls `appendJournal`. This is its twin, and
// the twin is the dangerous one BECAUSE THE LANE LOOKS CLOSED: `crossing-exec`
// and `walk-exec` both call `appendJournal` — every enter, every exit, every
// flag-off walk — and both are SUBPROCESSES whose last line is
//
//     const answer = (obj) => { console.log(JSON.stringify(obj)); process.exit(0); };
//
// `mirrorAct` is fire-and-forget by contract (world2-acts.mjs § WRITE
// DISCIPLINE): it queues the INSERT and returns before a connection is even
// opened. `process.exit(0)` is immediate and unconditional — it does not drain
// the event loop — so the act died in the child with the pg socket, and the
// console.error that the module promises on failure died with it too. A lost
// act, silently, from a lane whose code reads as mirrored.
//
// LATENT RATHER THAN LIVE, and the difference is only luck: `/etc/postmark-
// office-dev.env` carries no WORLD2_* variable (verified 2026-08-28), so the
// mirror has never been on in a process that spawns these execs. It would have
// begun losing enter/exit acts the hour the flag was set.
//
// THE FIX IS THE CONTRACT MADE EXPLICIT rather than the contract changed: the
// mirror stays fire-and-forget for the request path (an in-process caller has
// an event loop that outlives it, which is the whole reason the queue is
// allowed to be async), and any caller ABOUT TO END ITS PROCESS awaits this
// first. That is the one place the difference matters.
//
// BOUNDED, and the bound is not a detail. These execs run under the town flock;
// an unbounded wait on an unreachable Postgres would hold the lock for the
// TCP timeout and stall the crossing behind it — trading a lost act for a
// wedged town, which is the worse of the two. So the wait is capped and a cap
// that is REACHED is loud: the operator learns the mirror is behind, and the
// parity falsifier reds at the next check, which is exactly the alarm the
// missing console.error should have raised in the first place.
/**
 * Await the World 2.0 shadow pens. Call before `process.exit` in any pen that
 * writes acts and then ends its own process.
 *
 * Returns `{ settled, waited_ms }` — `settled: false` means the cap was hit and
 * a write may be in flight, which is a fact the caller should report rather
 * than swallow.
 */
export async function settleShadowPens({ timeoutMs = 5000 } = {}) {
  if (!world2Enabled() && !candleEnabled()) return { settled: true, waited_ms: 0 };
  const started = Date.now();
  let timer = null;
  const capped = new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
  try {
    const done = await Promise.race([
      Promise.allSettled([mirrorSettled(), docketSettled(), penSettled()]).then(() => "settled"),
      capped,
    ]);
    const waited = Date.now() - started;
    if (done === "timeout") {
      console.error(
        `[world2] SHADOW PENS DID NOT SETTLE in ${timeoutMs}ms — this process is about to exit and a mirror write may be in flight. `
        + "The act is in the sqlite journal; `acts` may be missing its twin, and falsifier-acts-parity will say so.");
      return { settled: false, waited_ms: waited };
    }
    return { settled: true, waited_ms: waited };
  } finally { clearTimeout(timer); }
}

// ── the replay reader ────────────────────────────────────────────────────────

const parse = (text, fallback = null) => {
  if (text == null) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
};

/**
 * THE READER. Rows back out in write order, hydrated — the JSON columns parsed,
 * the `at` triple re-assembled into the one field the ruling named.
 *
 * `sinceSeq` is the replay cursor: the drain truncates at the save, so recovery
 * is "newest snapshot + everything after it" (logos/the-save), and that is this
 * argument. Nothing consumes it yet; it exists because a log you have never read
 * back is a log you have not proven is a log.
 */
export function readJournal(db, { household = null, cls = null, sinceSeq = 0, limit = null } = {}) {
  const where = ["seq > ?"];
  const args = [Number(sinceSeq) || 0];
  if (household) { where.push("household = ?"); args.push(String(household)); }
  if (cls) { where.push("class = ?"); args.push(String(cls)); }
  const sql = `SELECT seq, ${ROW_COLUMNS} FROM journal WHERE ${where.join(" AND ")} ORDER BY seq`
    // `limit != null` FIRST, for the same reason composeAnchor checks it: a
    // default of null becomes Number(null) === 0, which is finite, which silently
    // clamped every unlimited read to LIMIT 1. The replay falsifier caught it.
    + (limit != null && Number.isFinite(Number(limit)) ? ` LIMIT ${Math.max(1, Math.floor(Number(limit)))}` : "");
  return db.prepare(sql).all(...args).map(hydrateRow);
}

/**
 * A journal row in the `acts` row shape a projection reads — THE ONE PLACE THE
 * TWO STORES' COLUMN NAMES MEET.
 *
 * `emissionToVoice`'s discipline (src/dynamic-emissions.mjs), and it exists for
 * a defect a flip run found rather than for tidiness. A class-lane projection
 * is pure over rows whose instant is `at` and whose id is `id`, which is
 * Postgres' `acts`. A journal row's instant is `written_at` and its `at` is the
 * WITNESSED LINE, an anchor-and-offset object. Handing a journal row straight to
 * one of those projections yields `NaN` for every instant and an empty live set
 * — silently, because an empty projection is exactly what "nothing stands"
 * looks like.
 *
 * So an office not pointed at Postgres would accept a declaration at the door
 * and then answer that nothing was ever declared. This is the mapping that
 * stops it, and it is one function so the two shapes cannot come apart.
 *
 * ⚑ NO LIVE CALLER TODAY, and this note is here so the next reader does not
 * have to discover that with a grep. The three class-lane projections that
 * consumed it — `liveSubscriptions`, `liveHandoffs`, `gatheringsFrom` — were
 * parked on 2026-09-10 with the law they served (world#20, #16, #15; the
 * modules are held whole on office `wright/parked-proposals-office`, the shelf
 * is the world repo's LOGOS/PROPOSED.md). It is kept rather than deleted
 * because it is the STATEMENT OF THE DEFECT as much as the fix for it: the next
 * class lane to be journalled needs this mapping and would otherwise rediscover
 * the silent-NaN failure the flip run already paid for.
 */
export const journalRowAsAct = (r) => ({
  id: r.seq,
  at: r.written_at,
  actor: r.actor,
  action: r.action,
  object: r.object ?? null,
  class: r.class,
  payload: r.payload,
  household: r.household ?? null,
  at_anchor: r.at?.anchor ?? null,
  at_dx: r.at?.dx ?? null,
  at_dy: r.at?.dy ?? null,
  witnesses: r.witnesses ?? null,
});

/** One stored row, in the vocabulary the ruling used. Exported so a test can hydrate a row it built by hand. */
export function hydrateRow(r) {
  return {
    seq: Number(r.seq),
    crossing: r.crossing == null ? null : Number(r.crossing),
    actor: r.actor,
    action: r.action,
    object: r.object ?? null,
    at: { anchor: r.at_anchor ?? null, dx: r.at_dx ?? null, dy: r.at_dy ?? null },
    witnesses: parse(r.witnesses, null),
    class: r.class,
    payload: parse(r.payload, null),
    effect: r.effect ?? null,
    household: r.household ?? null,
    written_at: r.written_at,
  };
}

/** The highest seq written, or 0 — the drain's cursor, and the truncate's high-water mark. */
export function journalHead(db) {
  return Number(db.prepare("SELECT MAX(seq) s FROM journal").get()?.s ?? 0);
}

// ── the fold: rows → the §1c delta ───────────────────────────────────────────

/**
 * The path the drain WILL write this declaration to.
 *
 * §1c's contract carries `path`, and the viewer half is untouched by this slice
 * — so the journal must answer it.
 *
 * ── THE FREEZE, 2026-08-25 ───────────────────────────────────────────────────
 *
 * A sited/parcel record used to land on open ground at the root
 * (`ROOT_PREFIX/<slug>/`) on the reasoning that the settlement re-homed it by
 * geometry afterwards anyway. The freeze DELETED the re-home pass — "The
 * settlement writes a mark once; nothing moves it after" — so where this door
 * files is now where the mark lives forever, and the law says where that is:
 *
 *   "New marks are filed by identity — WORLD/marks/<household>/<slug>/"
 *
 * Predicated/naming still take the directory of the mark they describe. That
 * nesting is AUTHORSHIP — a predicate is its parent continued (the continuation
 * law) — never a claim about ground, so the freeze does not touch it. The
 * world's own gate B draws the same line and flags it at mark-lint §6 as its
 * reading of a sentence the law states without the qualification.
 *
 * The two frames agree by construction, which is what makes this a filing change
 * and not a geometry change: `WORLD/marks/<by>/<slug>/` has no mark.md above it,
 * so the loader frames it on the world origin; `ROOT_PREFIX/<slug>/` is framed on
 * the root mark's centre, and the root's centre IS the world origin
 * (`at: { x: 0, y: 0 }` in WORLD/marks/let-there-be-light/mark.md). Same digits.
 *
 * ── GATE A BEFORE GATE B, and this is the half that is easy to miss ─────────
 *
 *   "A mark's directory is its historical filing: it carries no claim, and it
 *    NEVER MOVES AGAIN."
 *
 * Filing by identity is the rule for a mark that does not have a filing yet. A
 * mark that HAS one keeps it, and an amend is a new declaration rather than a
 * move — so `publishedPathOf` is consulted first, and its answer wins. Without
 * that, amending any mark filed before the freeze would send the record to a new
 * directory while the old file stood: two files, one id, and the world's own
 * gate A refusing the result. That is the publish+re-home wedge (#1862) in a new
 * coat, and the freeze exists partly to kill it.
 *
 * The caller supplies the lookup because only the caller can see a tree. Where
 * one is not supplied — the resident-facing `dir`, whose door cannot cheaply
 * resolve a published mark's directory — the answer is the id path, and
 * `writeDownHousehold` is the backstop that keeps the file where it already is.
 *
 * A nested record whose parent is not itself in the journal takes the root-level
 * fallback, which is exactly what the git path does when the parent is a
 * published mark whose directory this door cannot cheaply resolve.
 */
export function pathFor(record, { parentPathOf = null, publishedPathOf = null } = {}) {
  const { by, slug } = idPartsOf(record);
  if (!slug) return null;

  if (record?.kind === "sited" || record?.kind === "parcel") {
    // GATE A: an existing filing never moves.
    const filed = record?.id && typeof publishedPathOf === "function" ? publishedPathOf(record.id) : null;
    if (filed) return filed;
    // GATE B: a new mark files at its id. A record with no `by` and no id to
    // read one from cannot — it takes the root fallback rather than landing at
    // `WORLD/marks/undefined/`.
    if (by) return `${MARKS_PREFIX}/${by}/${slug}/mark.md`;
  }

  const parentDir = record?.parent_id && typeof parentPathOf === "function"
    ? parentPathOf(record.parent_id) : null;
  return `${parentDir ?? ROOT_PREFIX}/${slug}/mark.md`;
}

/**
 * SUPERSESSION-BY-LATEST, folded to the shape §1c already speaks.
 *
 * Pure: rows in, `{ marks, counts }` out. No store, no git, no clone — which is
 * what lets a falsifier assert the fold without building a repo.
 *
 * `publishedIds` is the set of ids canon already holds, and it decides the ONE
 * thing the rows cannot: whether a declaration is an addition to main or a
 * modification of it, and whether a withdrawal leaves a deletion behind or
 * simply never happened. That mirrors the git path exactly — a three-dot diff
 * from the merge-base shows an added-then-withdrawn draft as nothing at all,
 * because the file appeared and vanished on the same branch.
 *
 * `publishedPathOf` and `publishedMarkOf` answer where canon keeps a mark and
 * what it says, for the one row type that cannot know: a WITHDRAWAL. A withdraw
 * row's payload is `{by, slug, was_published}` and nothing more — it is a
 * declaration that something ended, not a description of it. The git path has
 * no such gap, because it reads the deleted record at the merge-base, so the
 * overlay gets a real body, kind and footprint for a mark being taken away.
 * Without these two the journal would hand the viewer an empty grey rectangle
 * where the git path hands it the mark the resident is removing.
 */
export function replayDrafts(rows, { publishedIds = new Set(), publishedPathOf = null, publishedMarkOf = null } = {}) {
  // latest-wins, in seq order — the log's own order is the supersession order.
  // `declared` keeps the last row that actually DESCRIBED the mark, which is
  // what a withdrawal's shape falls back to before canon does.
  const latest = new Map();
  const declared = new Map();
  for (const row of rows) {
    if (row.class !== CLASS_MARK || !MARK_ACTIONS.has(row.action) || !row.object) continue;
    if (row.action !== ACTION_WITHDRAW) declared.set(row.object, row);
    latest.set(row.object, row);
  }

  const pathOfDraft = new Map();
  for (const [id, row] of latest) {
    if (row.action === ACTION_WITHDRAW) continue;
    pathOfDraft.set(id, pathFor({ ...(row.payload ?? {}), id }, {
      publishedPathOf,   // gate A: a mark canon already holds keeps its filing
      parentPathOf: (pid) => {
        const p = latest.get(pid);
        const ppath = p && p.action !== ACTION_WITHDRAW
          ? pathFor({ ...(p.payload ?? {}), id: pid })
          : (typeof publishedPathOf === "function" ? publishedPathOf(pid) : null);
        return ppath ? ppath.replace(/\/mark\.md$/, "") : null;
      },
    }));
  }

  const marks = [];
  for (const [id, row] of latest) {
    const published = publishedIds.has(id);
    if (row.action === ACTION_WITHDRAW) {
      // Never crossed → the sketchbook and canon both end with nothing to show,
      // and the delta is silent. Published → main still holds it, so the
      // household IS proposing a deletion, and the delta must say so.
      if (!published) continue;
      const path = typeof publishedPathOf === "function" ? publishedPathOf(id) : null;
      // its own last declaration first, then canon's — a withdraw row can
      // describe nothing, and the overlay has a mark to draw either way.
      const canon = typeof publishedMarkOf === "function" ? publishedMarkOf(id) : null;
      // The last-resort guess when canon cannot say where the file sits. It is
      // handed the mark's own last declaration so `kind` reaches pathFor: after
      // the freeze a sited/parcel mark's path IS its id, and a guess that
      // ignored kind would name the pre-freeze root fallback for every one.
      const guessFrom = { ...(declared.get(id)?.payload ?? canon ?? {}), id };
      marks.push({
        status: "deleted", path: path ?? pathFor(guessFrom),
        ...markShape(id, declared.get(id) ?? row, canon),
      });
      continue;
    }
    marks.push({
      status: published ? "modified" : "added",
      path: pathOfDraft.get(id),
      ...markShape(id, row),
    });
  }

  marks.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  return {
    marks,
    counts: {
      added: marks.filter((m) => m.status === "added").length,
      modified: marks.filter((m) => m.status === "modified").length,
      deleted: marks.filter((m) => m.status === "deleted").length,
    },
  };
}

/**
 * One journal row as §1c's viewer reads a mark.
 *
 * `tier: "market"` is not a default invented here — it is what the git path
 * yields for every mark written since 2026-08-13, because the door refuses
 * `tier:` as a field ("standing is derived from the ground your mark stands on")
 * and `parseDeltaRecord` falls back to "market" when the frontmatter carries
 * none. The journal holds no tier for the same reason, and reports the same word,
 * so the overlay renders identically across the flag.
 */
function markShape(id, row, canon = null) {
  const p = row.payload ?? {};
  const points = p.points ?? canon?.points ?? null;
  return {
    id,
    by: p.by ?? canon?.by ?? String(id).split("/")[0] ?? null,
    kind: p.kind ?? canon?.kind ?? null,
    tier: "market",
    body: String(p.body ?? canon?.body ?? "").trim(),
    date: p.date ?? row.written_at ?? null,
    at: p.at ?? canon?.at ?? null,
    extent: p.extent ?? canon?.extent ?? null,
    ...(points ? { points } : {}),
  };
}

// ── the door guards, as store lookups ────────────────────────────────────────

/**
 * The household's LIVE marks — everything it has declared since the last save
 * that has not been withdrawn — in the record vocabulary the door's guards read.
 *
 * §2: "Door guards that read the tree today (slug collision, parcel cap) become
 * DB lookups." This is that lookup. Under the flag there is no checked-out draft
 * branch to `loadMarks` over, and there must not be one — the checkout is the
 * thing being retired.
 *
 * Scoped to the household by default because that is what a sketchbook is: your
 * own unpublished declarations, nobody else's. Pass `household: null` for the
 * whole live layer (what the drain wants).
 */
export function liveMarks(db, { household = undefined } = {}) {
  const rows = readJournal(db, { cls: CLASS_MARK, ...(household === undefined ? {} : { household }) });
  const latest = new Map();
  for (const row of rows) if (row.object && MARK_ACTIONS.has(row.action)) latest.set(row.object, row);
  const out = [];
  for (const [id, row] of latest) {
    if (row.action === ACTION_WITHDRAW) continue;
    const p = row.payload ?? {};
    out.push({ id, ...p, by: p.by ?? String(id).split("/")[0], household: row.household ?? null, seq: row.seq });
  }
  return out;
}

/** Whether the household's live layer holds a mark that names `id` as its parent — the store's answer to `holdsChildren`, which used to be a directory listing. */
export function liveChildrenOf(db, id, { household = undefined } = {}) {
  return liveMarks(db, { household }).filter((m) => m.parent_id === id);
}

// ── the §1c door ─────────────────────────────────────────────────────────────

// Where canon keeps a mark, for the one row that needs it: a withdrawal of a
// PUBLISHED mark, whose path lives on main and not in the log. Built from one
// `ls-tree` at the sha and cached on it — the tree is immutable at a commit, so
// a cache nobody can invalidate is impossible here.
//
// ── THE FOSSIL MANIFEST IS THE FIRST ANSWER (the freeze, 2026-08-25) ─────────
//
//   "A mark's directory is its historical filing: it carries no claim, and it
//    never moves again."
//
// `WORLD/filing-freeze.json` maps every mark alive on the freeze date to the
// path it was filed at, keyed by FULL ID. It is minted once and never
// regenerated, so it is the exact, static answer to "where does this mark
// already live" — one JSON read, no tree walk, and no ambiguity.
//
// WHY IT HAD TO COME FIRST, and it is not only about speed. The `ls-tree` index
// below is keyed by leaf SLUG, and a slug is unique per AUTHOR, not per tree:
// two households may both keep a `the-lamp`. That index resolved an ambiguous
// slug to NOTHING, on the reasoning — quoted from the comment this replaces —
// that "the row falls back to the root-level path … and the drain re-homes by
// geometry at the save regardless". The freeze DELETED that re-homer. A
// fossil mark whose slug another household shares would now fall back to a
// root-level path that nothing will ever move, and gate A would refuse it at the
// next lint. The manifest is keyed by id, so it cannot be ambiguous.
//
// The manifest carries directories; a caller wants the record, so `/mark.md` is
// appended here rather than at four call sites.
let _frozen = null;
export function frozenFilingAt(repo, sha) {
  if (_frozen?.repo === repo && _frozen.sha === sha) return _frozen.byId;
  const byId = new Map();
  try {
    const raw = execFileSync("git", ["-C", repo, "show", `${sha}:WORLD/filing-freeze.json`],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    for (const [id, dir] of Object.entries(JSON.parse(raw)?.marks ?? {}))
      if (id && typeof dir === "string") byId.set(id, `${dir.replace(/\/+$/, "")}/mark.md`);
  } catch { /* no manifest at this sha → a tree that declares no freeze; the index below answers alone */ }
  _frozen = { repo, sha, byId };
  return byId;
}

// The tree index, for marks born AFTER the freeze — the manifest names none of
// them, by design ("a mark born after the freeze needs no row here: its path is
// derivable from its id").
//
// Keyed BOTH ways. A path of the shape `WORLD/marks/<by>/<slug>/mark.md` carries
// the whole id, so those register under the id and are never ambiguous. The
// slug map stays for a fossil path the manifest somehow does not name, where the
// id genuinely is not derivable from the path — and there an ambiguous slug still
// resolves to nothing, because a wrong-but-plausible filing is worse than none.
let _pathIndex = null;
function publishedPathIndex(repo, sha) {
  if (_pathIndex?.repo === repo && _pathIndex.sha === sha) return _pathIndex;
  const bySlug = new Map();
  const byId = new Map();
  try {
    const out = execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", sha, "--", "WORLD/marks"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    for (const line of out.split("\n")) {
      const path = line.trim();
      if (!path.endsWith("/mark.md")) continue;
      const rel = path.slice("WORLD/marks/".length, -"/mark.md".length);
      const parts = rel.split("/");
      const slug = parts[parts.length - 1];
      if (!slug) continue;
      if (parts.length === 2) byId.set(`${parts[0]}/${parts[1]}`, path);  // filed at its id
      else bySlug.set(slug, bySlug.has(slug) ? null : path);              // legacy only; null = ambiguous
    }
  } catch { /* no tree at this sha → every published path is unknown, and says so by being absent */ }
  _pathIndex = { repo, sha, bySlug, byId };
  return _pathIndex;
}

/**
 * WHERE THIS MARK IS ALREADY FILED, or null if it is not filed anywhere yet.
 *
 * The gate-A lookup, in one place so every door asks it the same way: the fossil
 * manifest, then the id-shaped paths in the tree, then — only for a fossil the
 * manifest does not name — the slug index. `null` is the gate-B case, and it is
 * the ONLY case in which a mark is filed at its id.
 */
export function filedPathOfAt(repo, sha) {
  return (id) => {
    const key = String(id);
    const frozen = frozenFilingAt(repo, sha).get(key);
    if (frozen) return frozen;
    const idx = publishedPathIndex(repo, sha);
    return idx.byId.get(key) ?? idx.bySlug.get(key.split("/").slice(1).join("/")) ?? null;
  };
}

/** Drop the cached path indexes — for tests that rewrite a repo in place at the same sha. */
export function resetPathIndex() { _pathIndex = null; _frozen = null; }

/**
 * THE §1c CONTRACT, over whichever store holds the drafts.
 *
 * Flag OFF: `draftDeltaForKey` verbatim, byte for byte — this function adds
 * nothing to that path, which is what makes the flag-off falsifier meaningful.
 *
 * Flag ON: the git delta UNIONED with the journal's replay, journal winning on
 * a shared id. Both halves, not one — §0's model has three sources and the
 * cutover retires none of them:
 *
 *   canon        published main (the caller's own read; the ids come from here)
 *   sketchbook   `draft/<household>`, still holding every draft written BEFORE
 *                the flag flipped. Dropping it would make a resident's existing
 *                work vanish from their overlay on the day of the cutover.
 *   journal      everything declared since, which is the only thing that moves
 *                between saves once the drain lands.
 *
 * The journal wins a collision because it is later by construction: a
 * declaration in the log was made after the sketchbook was last written to.
 *
 * The shape is unchanged, key for key, because the viewer half is untouched.
 * `draft` is the sketchbook's commit sha and stays exactly that — it does not
 * quietly start meaning something else when the flag is on. What the journal
 * contributes is disclosed in its own `log` block rather than smuggled into a
 * field that already means a commit.
 */
export function draftsForKey(repo, key) {
  const gitDelta = draftDeltaForKey(repo, key);
  if (!singleLogEnabled() || gitDelta?.error) return gitDelta;

  const household = resolvedWorldHousehold(key);
  let head = 0, replayed = { marks: [], counts: { added: 0, modified: 0, deleted: 0 } };
  try {
    const state = publishedState(repo).state ?? {};
    const publishedIds = new Set((state.marks ?? []).map((m) => m.id));
    // LAZY, and that is the point of this whole ladder: the index costs an
    // `ls-tree` over ~900 mark paths, and it is consulted for a withdrawal of a
    // PUBLISHED mark and for gate A — both rare. Building it eagerly would put
    // whole-tree work back on the request path, which is the class §0 exists to
    // keep off it. The manifest arm inside `filedPathOfAt` is one JSON read and
    // answers first, so the common gate-A case never reaches the `ls-tree`.
    const sha = String(gitDelta.main ?? mainRef(repo));
    const publishedPathOf = filedPathOfAt(repo, sha);
    const canonById = new Map((state.marks ?? []).map((m) => [m.id, m]));
    const publishedMarkOf = (id) => canonById.get(id) ?? null;

    const db = openDynamic(dynamicDbPath(), { readOnly: true });
    try {
      head = journalHead(db);
      replayed = replayDrafts(readJournal(db, { household, cls: CLASS_MARK }), { publishedIds, publishedPathOf, publishedMarkOf });
    } finally { try { db.close(); } catch { /* already gone */ } }
  } catch (e) {
    // A live layer this door cannot read is a fact the caller must be told, not
    // an empty overlay. The sketchbook half still answers; the block says what
    // is missing from it.
    return { ...gitDelta, log: { readable: false, reason: String(e?.message ?? e).slice(0, 200) } };
  }

  const byId = new Map();
  for (const m of gitDelta.marks ?? []) if (m.id) byId.set(m.id, m);
  for (const m of replayed.marks) if (m.id) byId.set(m.id, m);
  const marks = [...byId.values()].sort((a, b) => String(a.path).localeCompare(String(b.path)));

  return {
    ...gitDelta,
    exists: gitDelta.exists || marks.length > 0,
    marks,
    counts: {
      added: marks.filter((m) => m.status === "added").length,
      modified: marks.filter((m) => m.status === "modified").length,
      deleted: marks.filter((m) => m.status === "deleted").length,
    },
    log: { readable: true, head, marks: replayed.marks.length },
  };
}
