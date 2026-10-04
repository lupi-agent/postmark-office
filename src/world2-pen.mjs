// world2-pen.mjs — THE PEN, FLIPPED (World 2.0 phase-3 write path, dev era).
//
// Born 2026-08-29, the night Keemin ruled the flip's shape (all four teed
// decisions, DESIGN-pen-flip.md §5): D1 PER LANE · D2 REFUSE, HONESTLY ·
// D3 REVERSE MIRROR with the existing death date · prod = box + shipped
// backups. This module is R1 and R2 of that design made real:
//
//   R1 — ONE ACT, ONE TRANSACTION. An act and its claim commit on one client
//        inside one BEGIN/COMMIT, whichever era wrote them. The two-queue
//        disease (mirrorAct and submitClaimFromJournal on independent pools
//        with nothing joining them — DESIGN §2 R1's two named instances) ends
//        here: both eras' Postgres writes route through `officeWrite`.
//
//   R2 — THE WRITE CAN REFUSE, BECAUSE IT COMES FIRST. For a FLIPPED lane the
//        Postgres commit precedes the sqlite write and is awaited; failure is
//        a typed refusal the door turns into the ruled bounce, and NOTHING has
//        been written anywhere. For a SHADOW lane nothing changes: sqlite
//        first, Postgres queued, loud on failure, parity-falsified.
//
// ── THE LANE FLAG (D1, per lane) ────────────────────────────────────────────
// W2_PEN names the lanes whose pen is Postgres, comma-separated, or "all":
//
//     W2_PEN=stance            (lane one — DESIGN §7: "the natural first
//                               candidate ... the one door that has never had
//                               a second pen to disagree with")
//     W2_PEN=stance,say,hold
//     W2_PEN=all
//
// Lane names are the lane-closure falsifier's own census vocabulary: an act
// class maps to exactly one lane (`laneOf`), and a lane not named here keeps
// the shadow-era path bit for bit.
//
// ── THE REVERSE MIRROR (D3) ─────────────────────────────────────────────────
// After a flipped lane's COMMIT, the sqlite journal still receives its row —
// best-effort, AFTER the record, never with a vote (DESIGN §3 step 7: "a
// rollback convenience, not a record"). It rides the mirror expiry exactly as
// the forward mirror does and dies at the replay-parity gate — and since DEC-2
// was ruled (2026-08-29 evening) that expiry is PER LANE: this lane's reverse
// mirror dies when THIS lane's read ports land and its deletion is ruled, not on
// a store-wide date (src/world2-acts.mjs § LANE_MIRROR). While it holds,
// every 1.0 read — guards included — stays valid, which is what lets a lane
// flip before the R3 read ports land: the ports gate the DELETION (rule 6),
// not the flag.
//
// ── THE REFUSAL (D2, verbatim from the ruling) ──────────────────────────────
// "the office's record cannot be reached — nothing was written, and nothing
// was lost." A door catching PenUnreachable owes the resident that sentence
// and a 503, never a degrade: a fallback pen is "a second pen wearing a
// fallback's coat" (DESIGN §5 D2). The cost is chosen knowingly: after the
// flip a Postgres outage is a visible town outage (DESIGN §4 F1).

import { world2Enabled } from "./world2-acts.mjs";
import { currentCrossing } from "./crossings.mjs";
import { sessionKeysVia, sessionKeyString } from "./household-deriver.mjs";
import { nonceForActRow } from "./act-nonce.mjs";
import { storePoolOptions, watchPoolErrors, onPenClient, refuseNested } from "./store-pool.mjs"; // POS-370: the acquire timeout, the server's idle-transaction limit, one pen connection per call chain

// ── A LATE ROW MAY NOT ENTER A CERTIFIED WINDOW (the act-4171 class, 2026-09-04) ─
//
// The notary freezes each window's archive on write and certifies it nightly
// (gold §2: "frozen-on-write, an input never re-derived-into"). On 2026-09-03 a
// replayed journal line (act 4171, seq 869) was written into window 164 a day
// after that window closed and was certified; the notary refused to rewrite
// the archive — correctly — and could certify nothing new until a human deleted
// the row (notary-history/164-act-4171-repair). Then a backfill the same night
// nearly did it again with "historically correct" crossings into windows 157/160.
//
// The rule, at the pen where every row enters: a row's `crossing` may be the
// open window or the one just closed (a live act written at the boundary), never
// older. Anything older is a late arrival, and a late arrival is stamped with
// the window it ARRIVED in — the caller says so by naming the reason in
// W2_LATE_ARRIVAL, and the pen then writes `currentCrossing()` with the row's
// original crossing kept on the payload (`late_from_crossing`). `at` always
// keeps the act's true time; the crossing is where the row files, and frozen
// history is not a place a row can file into.
export class LateCrossingError extends Error {
  constructor(crossing, open) {
    super(crossing > open
      ? `a row for crossing ${crossing} may not enter the record while the open window is ${open}: that window has not opened, and a crossing that large is almost always a raw clock (epoch ÷ 12h) rather than the town's count — the 2026-09-04 backfill class. Stamp the true crossing (crossings.mjs § currentCrossing(at)) and let the pen file it.`
      : `a row for crossing ${crossing} may not enter the record while the open window is ${open}: that window is certified history and the notary refuses to rewrite it (the act-4171 class). A late arrival files into the window it ARRIVES in — set W2_LATE_ARRIVAL="<reason>" and the pen stamps ${open}, keeping the original crossing on the payload.`);
    this.name = "LateCrossingError"; this.crossing = crossing; this.open = open;
  }
}
// The lateness test itself, named once so the guard and the callers that need
// to SAY a row arrived late cannot drift into two rules. `true` means the row's
// crossing is old enough that it may only file with a reason, and that the pen
// will restamp it with the open window.
export function crossingIsLate(crossing, { now = Date.now() } = {}) {
  const open = currentCrossing(now);
  const c = crossing == null ? null : Number(crossing);
  if (c == null || !Number.isFinite(c)) return false;
  return Math.floor(c) < open - 1;
}

// The one standing reason this office has for a late arrival. A constant rather
// than a string at the call site, because it is written into permanent rows
// (`late_arrival` on the payload) and a reader a year from now should find every
// one of them with a single grep.
export const LATE_ARRIVAL_PUT_FORWARD =
  "a stake put a draft forward after the window it was composed in had closed (postmark#2722)";

// `lateArrival` — THE REASON AS AN ARGUMENT, not only as an environment
// (postmark#2722, 2026-09-13). The env spelling was written for a human running
// a backfill, and it is process-wide: the only way a CALLER could take this
// path was to set a variable that then applied to every row the process wrote,
// which is why no caller ever did. So the one caller that has a standing,
// auditable reason — a stake putting forward a draft whose window has since
// closed — could not say it, and the pen refused a lawful act instead. Sophia's
// ✦1 was debited against a claim that never filed, twice, on 2026-09-12; Deva's
// hit the same line the next morning. An explicit reason WINS over the env, so
// a per-row remedy never depends on the ambient one and never widens it.
export function lateCrossingGuard(row, { now = Date.now(), env = process.env, lateArrival = null } = {}) {
  const open = currentCrossing(now);
  const c = row.crossing == null ? null : Number(row.crossing);
  if (c == null || !Number.isFinite(c)) return row;
  if (Math.floor(c) > open) throw new LateCrossingError(c, open); // the future is not a place a row can file into either (2026-09-04: a raw epoch count sailed through here) — and no reason excuses it
  if (!crossingIsLate(c, { now })) return row;          // the open window, or the one just closed at the boundary
  const reason = String(lateArrival ?? env.W2_LATE_ARRIVAL ?? "").trim();
  if (!reason) throw new LateCrossingError(c, open);
  const payload = { ...(typeof row.payload === "string" ? JSON.parse(row.payload) : (row.payload ?? {})), late_from_crossing: c, late_arrival: reason };
  return { ...row, crossing: open, payload: typeof row.payload === "string" ? JSON.stringify(payload) : payload };
}

const state = {
  pool: null,
  // ONE queue for the shadow era's unified writes — the two old queues
  // (world2-acts / world2-claims) collapse onto this one so an act and its
  // claim can share a transaction while keeping journal order.
  queue: Promise.resolve(),
  written: 0, failed: 0, refused: 0, lastError: null,
};

export class PenUnreachableError extends Error {
  constructor(cause) {
    super("the office's record cannot be reached — nothing was written, and nothing was lost");
    this.name = "PenUnreachableError";
    this.code = 503;
    this.cause = cause;
  }
}

/**
 * Test seam: hand the module a pool. Never used by the office.
 *
 * `world2-acts.mjs` has carried the same one export for one line since the
 * shadow era, and this file needed none because nothing awaited its pen — a
 * suite either injected a client straight into `insertAct` or let the
 * fire-and-forget queue fail into a console line nobody asserted on.
 *
 * G1 (POS-156, RULING 3) makes `penWrite` the office's ONE write and makes it
 * refusable, so "this suite writes an act" now means "this suite points the
 * office at a record". Without a seam here every act-writing suite would have
 * to reach a live Postgres, and the alternative — leaving them unable to write
 * at all — is a suite that proves the refusal and nothing else.
 */
export function __setPoolForTest(p) { state.pool = p; }

class NoRecordError extends Error {
  constructor() {
    super("this office is not pointed at a record (WORLD2_PG / WORLD2_PG_URL are unset)");
    this.name = "NoRecordError";
  }
}

async function pool(env = process.env) {
  if (state.pool) return state.pool;
  // ── AN OFFICE POINTED AT NO RECORD SAYS SO, AND DOES NOT DIAL (G1) ─────
  //
  // `new pg.Pool({ connectionString: undefined })` is not an error: it falls
  // back to libpq's defaults and tries localhost:5432 or a unix socket. Before
  // G1 that never happened on this path -- `mirrorAct` checked
  // `world2Enabled()` and returned, so an office with no store simply wrote its
  // sqlite row and moved on. G1 made this the ONE write, and without this guard
  // every act on an unconfigured office would wait out a connection attempt to
  // a database nobody configured, then refuse anyway.
  //
  // So it refuses IMMEDIATELY and by name. `penWrite` and `officeRead` wrap it
  // in the ruled sentence the resident is owed either way -- what changes is
  // that the cause now says "not pointed at a record" instead of ECONNREFUSED
  // against a port the operator never chose.
  if (!world2Enabled(env)) throw new NoRecordError();
  const { default: pg } = await import("pg");
  // POS-370: the acquire timeout and the server's idle-transaction limit ride
  // every connection (store-pool.mjs § storePoolOptions), and an idle
  // connection's failure is logged, never an unheard 'error' event.
  state.pool = watchPoolErrors(new pg.Pool(storePoolOptions(env, { name: "pen", max: 3 })), "pen");
  return state.pool;
}

// ── the lane census ─────────────────────────────────────────────────────────
// One act class → one lane. The vocabulary is falsifier-acts-lane-closure's
// own census; adding a class here without a census row reds check 0b, which is
// the guard working.
export function laneOf(row) {
  const cls = String(row?.class ?? "");
  const action = String(row?.action ?? "");
  if (cls === "stance") return "stance";
  if (cls === "voice") return "say";
  if (cls === "holding") return "hold";
  if (cls === "move") return "walk";
  if (cls === "frame") return "frame";
  if (cls === "mark") return "mark";
  if (action === "join" || action === "leave" || cls === "arena-act") return "arena";
  return cls || "unknown";
}

export function flippedLanes(env = process.env) {
  const raw = String(env.W2_PEN ?? "").trim();
  if (!raw) return new Set();
  if (raw === "all") return new Set(["all"]);
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

export function laneFlipped(lane, env = process.env) {
  if (!world2Enabled(env)) return false;
  const lanes = flippedLanes(env);
  return lanes.has("all") || lanes.has(lane);
}

// ── R1's one home: a single client, a single transaction ────────────────────
/**
 * Run `fn(client)` inside BEGIN/COMMIT on a dedicated client. When
 * `household` is given, `app.household` AND `app.household_keys` are declared
 * first with the transaction-scoped set_config — world2-claims.mjs §
 * withHousehold documents why the dedicated client and the explicit ROLLBACK
 * are not optional on a pooled connection, and why there are two settings
 * rather than one; this is that shape, generalized as DESIGN §2 R1 asked.
 *
 * THE SET IS RESOLVED ON THE POOL, BEFORE `connect()`, for this function's own
 * stated reason one paragraph down in `penWrite`: "a resolver running inside
 * would be a query on a second connection while this one holds the transaction
 * open." `sessionKeysVia` reads the registry, so it runs here.
 */
export async function officeWrite(fn, { household = null, env = process.env } = {}) {
  // Refused before the resolver too: it asks the same pool (POS-370).
  refuseNested("officeWrite");
  const p = await pool(env);
  const keys = household == null ? [] : await sessionKeysVia(p, household);
  return onPenClient(p, "officeWrite", async (client, discard) => {
    try {
      await client.query("BEGIN");
      if (household != null) {
        await client.query("SELECT set_config('app.household', $1, true)", [household]);
        await client.query("SELECT set_config('app.household_keys', $1, true)",
          [sessionKeyString(keys) ?? ""]);
      }
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      // A ROLLBACK that fails may leave the connection inside the transaction:
      // it is discarded, never handed back to the next caller (POS-370).
      try { await client.query("ROLLBACK"); } catch { discard(); }
      throw err;
    }
  });
}

/** The one acts INSERT, both eras. `seq` is null for a flipped or lane act —
 *  001's own words: the shadow-era pairing key, dying at cutover.
 *
 *  ── ONE SPELLING OF THE HOUSEHOLD (Wright-ruled 2026-08-28, ENFORCED here
 *  2026-08-29 after the guards lane measured the drift live: acts held the
 *  office key's NAME — 'darko' ×12 — while claims held the resolved KEY, and
 *  the draft overlay reading both tables lost every deleted mark silently).
 *  The row's `household` is resolved through `householdKeyFor` — the docket
 *  pen's own resolver — so the two columns cannot spell one fact two ways.
 *  NULL-PRESERVING, deliberately: a row that named no household stays NULL
 *  rather than being backfilled from the actor (the claims pen backfills
 *  because a claimant must have a household; an act need not, and inventing
 *  one here would break parity with every null-household journal row). The
 *  journal keeps 1.0's name spelling; the parity falsifier applies this
 *  mapping as its fourth lawful departure. A gh:<id> can no longer enter by this road either
 *  (the arena tee): whatever a caller passes, the identities projection
 *  answers, and a non-roster name resolves to solo:<name>, never verbatim. */
/**
 * R1's home, read side. Run `fn(client)` inside ONE `BEGIN READ ONLY` — the
 * shape B1's guard reads take (`src/world2-guards.mjs`).
 *
 * It lives here beside `officeWrite` rather than growing a third pool in the
 * guards module, and R1's reason is the reason: the two-queue disease was "two
 * independent pools with nothing joining them", and a guard read is the office
 * asking the same store the same question the pen is about to write to. One
 * pool, one place.
 *
 * `BEGIN READ ONLY` is not decoration. `app.household` is transaction-scoped
 * (`set_config(…, true)`), so a guard read NEEDS a transaction to declare it for
 * 007's row policy — and a transaction that can also write is a transaction that
 * could. The read-only marker makes "a guard never writes" a property Postgres
 * enforces rather than one this file asserts, which is the same standard
 * `003_falsifier_roles.sql` holds the pens to.
 *
 * The household is NOT declared here: the guards module resolves the NAME to the
 * KEY through world2-claims.mjs's one resolver and declares it inside `fn`, so
 * there is exactly one place the two spellings meet.
 */
export async function officeRead(fn, { env = process.env, pool: given = null, by = "officeRead" } = {}) {
  refuseNested(by);
  return onPenClient(given ?? await pool(env), by, async (client, discard) => {
    try {
      await client.query("BEGIN READ ONLY");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      // A ROLLBACK that fails may leave the connection inside the transaction:
      // it is discarded, never handed back to the next caller (POS-370).
      try { await client.query("ROLLBACK"); } catch { discard(); }
      throw err;
    }
  });
}
// `pool` is the town index's test seam (town-index-store.mjs § readTownIndex):
// its reads run in exactly this shape, the guard below included.
//
// ── ONE PEN CONNECTION PER CALL CHAIN (POS-370) ─────────────────────────────
// `fn` runs holding the connection, so `fn` must not ask the pen for another:
// the pool is three, and on 2026-10-04 three quest boards per worker each held
// one while the world read inside them waited on a fourth, and the office
// stalled for an hour. That ask is now refused at once by name
// (store-pool.mjs § NestedStoreError), and a connection that cannot be had in
// WORLD2_PG_ACQUIRE_MS is a refusal too, never a wait.

export async function insertAct(client, rowIn, seq = null, { lateArrival = null } = {}) {
  // `lateArrival` is the caller's standing reason for a row whose crossing has
  // fallen behind the open window (§ lateCrossingGuard). Absent it, this still
  // throws LateCrossingError — never a pen-unreachable, never silent.
  const row = lateCrossingGuard(rowIn, { lateArrival });
  const { householdKeyFor } = await import("./world2-claims.mjs");
  const household = row.household == null ? null : await householdKeyFor(client, row.household);
  // `acts.journal_seq` IS DROPPED (G1 / POS-156, migration 025). It held the
  // sqlite rowid an act was mirrored FROM, and there is no sqlite row any more
  // -- 001 called it "the shadow-era pairing key, dying at cutover", and this
  // is the cutover. `seq` is still TAKEN, because the arena's mirror still has
  // one to offer and a caller that passed it would otherwise think it landed;
  // it is ignored here, deliberately and in writing.
  const { text, values } = actsInsert(row, household);
  const { rows: [r] } = await client.query(`${text} RETURNING id`, values);
  return r.id;
}

/**
 * THE ACTS INSERT, ONE SPELLING FOR BOTH PENS (this one and world2-acts.mjs §
 * mirrorAct). `household` is the already-resolved key.
 *
 * `nonce` (migration 027, POS-265) is named ONLY for a row that carries one.
 * A row without it is the thirteen-column INSERT it has always been, so an
 * office on this code runs unchanged against a store that has not taken 027;
 * the say sets it on its own row, and it asks the store first
 * (world.mjs § actsHaveNonce).
 *
 * Every other world act's key arrives through the door's scope, not the row
 * (POS-246, act-nonce.mjs § nonceForActRow): the first act row a keyed call
 * writes carries it, and the door asked the store the same question first.
 */
export function actsInsert(row, household) {
  const cols = ["at", "crossing", "actor", "action", "object",
    "at_anchor", "at_dx", "at_dy", "witnesses", "class",
    "payload", "effect", "household"];
  const values = [row.written_at, row.crossing, row.actor, row.action, row.object,
    row.at_anchor, row.at_dx, row.at_dy, row.witnesses, row.class,
    row.payload, row.effect, household];
  const nonce = nonceForActRow(row);
  if (nonce != null) { cols.push("nonce"); values.push(nonce); }
  return {
    text: `INSERT INTO acts (${cols.join(", ")}) VALUES (${values.map((_, i) => `$${i + 1}`).join(",")})`,
    values,
  };
}

/**
 * THE FLIPPED WRITE — Postgres first, awaited, refusable.
 *
 * `claimFn(client, actId, household)` is the candle half when the act is
 * mark-class: same client, same transaction (R1). Throws PenUnreachableError on
 * any failure to reach or commit — by which point NOTHING is written: the
 * transaction rolled back, and the sqlite reverse mirror has not run because
 * the caller only runs it after this returns.
 *
 * ── THREE ARGUMENTS, NOT TWO (the mark lane, 2026-09-04) ────────────────────
 *
 * `claimFn` is handed the household as its third argument, which is the shape
 * `shadowWrite` has always used. Before the mark lane needed this path the two
 * spellings could differ unnoticed, because the only claimFn in the tree rode
 * the shadow arm; the flipped arm's two-argument call would have handed
 * `claimTxFromJournal` an `undefined` household and written a draft row scoped
 * to nobody — which 007's `claims_insert` WITH CHECK refuses outright, so the
 * first live private draft on a flipped lane would have bounced. One spelling,
 * both eras, and the falsifier's own lesson about one fact spelled two ways.
 *
 * ── `act: false` — A CLAIM WITH NO DEED, ON PURPOSE ─────────────────────────
 *
 * Phase 5.6's private draft is the one row this pen writes that must NOT reach
 * `acts`: `acts` is the table that leaves the box (the notary exports
 * archives/acts/<window>.jsonl into a public git repo, frozen on write) and a
 * leave-mark's payload carries the mark's BODY. The act is carried on the claim
 * instead (`data._deferred_act`) and released at the stake.
 *
 * That arm used to be a SECOND QUEUE on a second pool — `submitClaimFromJournal`
 * — and DESIGN §2 R1's own header claimed to have ended exactly that: "the
 * two-queue disease … ends here: both eras' Postgres writes route through
 * `officeWrite`." It did not end for this one, and the cost was measured rather
 * than theorised: a withdrawal's DELETE ran 113 ms ahead of the INSERT it was
 * meant to remove, five times out of five on fresh stores, leaving the
 * resident's withdrawn draft standing on the docket with its slug still taken
 * (jetto-b1-guards-report 2026-09-03 § Finding 1). `act: false` is what lets
 * the private arm ride THIS queue and THIS transaction, so a compose and its
 * own withdrawal cannot overtake each other in either era.
 */
export async function penWrite(row, { claimFn = null, household = null, act = true, env = process.env } = {}) {
  try {
    // A resolver, resolved BEFORE the transaction opens — same reason
    // `shadowWrite` does it there: officeWrite declares `app.household` at
    // BEGIN, and a resolver running inside would be a query on a second
    // connection while this one holds the transaction open.
    const hh = typeof household === "function" ? await household() : household;
    return await officeWrite(async (client) => {
      const actId = act ? await insertAct(client, row, null) : null;
      if (claimFn) await claimFn(client, actId, hh);
      state.written += 1;
      return { actId };
    }, { household: hh, env });
  } catch (err) {
    if (err?.name === "LateCrossingError") throw err; // the pen REFUSED, it was not unreachable — the door says which
    state.refused += 1;
    state.lastError = String(err?.message ?? err);
    console.error(`[world2-pen] FLIPPED WRITE REFUSED (${row.actor} ${row.action}): ${state.lastError}`);
    throw new PenUnreachableError(err);
  }
}

/**
 * THE SHADOW WRITE, UNIFIED — same queue discipline the two old pens had,
 * but one transaction per act (R1 for the shadow era). Fire-and-forget for
 * the caller, loud on failure, parity-falsified; acceptable ONLY because the
 * sqlite journal is still the SoT on an unflipped lane (world2-acts.mjs §
 * WRITE DISCIPLINE — that sentence keeps governing this path).
 */
export function shadowWrite(row, seq, { claimFn = null, household = null, act = true, env = process.env } = {}) {
  if (!world2Enabled(env)) return;
  state.queue = state.queue.then(async () => {
    try {
      // `household` may be a value or an async resolver — resolved HERE, inside
      // the queue but before the transaction opens, because officeWrite
      // declares it at BEGIN and a resolver that ran inside the transaction
      // would be a query on a second connection while this one holds BEGIN.
      const hh = typeof household === "function" ? await household() : household;
      await officeWrite(async (client) => {
        // `act: false` is the private draft (penWrite § the same option): its
        // claim rides this queue so it is ORDERED against its own withdrawal,
        // and its body never reaches the table that leaves the box.
        const actId = act ? await insertAct(client, row, seq) : null;
        if (claimFn) await claimFn(client, actId, hh);
      }, { household: hh, env });
      state.written += 1;
    } catch (err) {
      state.failed += 1;
      state.lastError = String(err?.message ?? err);
      console.error(`[world2-pen] SHADOW WRITE FAILED (seq ${seq}): ${state.lastError}`);
    }
  });
  return state.queue;
}

export function penStatus() {
  const { written, failed, refused, lastError } = state;
  return {
    flipped_lanes: [...flippedLanes()],
    written, failed, refused, lastError,
    // `expires` and `lane_expiry` are GONE with the map that fed them (G1 /
    // POS-156). They were the reverse mirror's backstop dates, and the reverse
    // mirror is deleted -- `appendActFlipped` writes no sqlite row. Same
    // removal, same reason, as `mirrorStatus()`.
  };
}

/** Await the unified shadow queue (tests, settleShadowPens). */
export function penSettled() { return state.queue; }
