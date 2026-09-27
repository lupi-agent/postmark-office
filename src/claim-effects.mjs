// claim-effects.mjs — a crossing publishing or refusing your mark is an EFFECT
// ON YOUR NODE, and `since:` now says so.
//
// THE CLAUSE THIS REPAIRS, verbatim, from `LOGOS/the-response-function §
// Residents: words, at their own pace`:
//
//   the resident's loop is "a replayable, cursor-ordered read of every effect
//   on your own node since you last looked"
//
// The 2026-09-06 walk asked `world { since: 170 }` after staking a mark and
// living through two crossings, and got:
//
//   happened.to_you: { complete: true, note: "complete by construction — frame
//   events are rare, so yours are never truncated", count: 0, events: [] }
//
// A completeness guarantee, over an empty list, about a resident whose stake
// had just been ruled on. The guarantee was TRUE about the shelf it was written
// for — frame edges and carried legs — and FALSE about the shelf a resident
// reads it as. The repair is both halves: the events, and a `complete` that
// stops being unconditional.
//
// ── THREE EVENTS, AND WHY NOT MORE ─────────────────────────────────────────
//
//   claim-pending    you (or somebody standing on your ground) put a mark
//                    forward; it is on the public docket and rides a candle
//   claim-locked     the candle ruled FOR it
//   claim-refused    the candle ruled AGAINST it, with the cause in the
//                    bulletin's own five words
//
// A `draft` writes no event: it is private, it has happened to nobody, and an
// event for it would be the town narrating a resident's own compose space back
// at them. `retracted` writes none either — the resident did it, and the
// backlog is for what happened TO you.
//
// ── THE CURSOR IS THE FERRY'S CROSSING, AND IT IS SAID SO ──────────────────
//
// `since:` is the world's 00:00/12:00Z crossing (`crossings.mjs §
// CROSSING_DERIVATION`), not the settlement epoch and not the candle's window.
// Every event here therefore carries BOTH: `crossing` (the cursor's clock, so
// the caller can page) and `window` (the candle's, so the receipt beside it
// lines up). Naming one and printing the other is the R4 finding.

import { currentCrossing } from "./crossings.mjs";
import { causeOf } from "./mark-receipt.mjs";

/**
 * The events a set of `claims` rows implies for one resident, in cursor order.
 *
 * PURE over rows, for the reason every derivation in this lane is: the sentence
 * a resident reads is decided here, and a falsifier must be able to hand it a
 * refusal without a candle, a store, or a settlement.
 *
 * @param rows          `claims` rows (claimRowsSince's shape)
 * @param sinceCrossing the caller's cursor — the ferry's crossing number
 * @param nowCrossing   the crossing this read is taken at
 * @param mine          a predicate: is this mark one of my residents'?
 * @param onMyGround    a Set of mark ids standing on ground the caller holds
 */
export function claimEffectsFrom({ rows = [], sinceCrossing, nowCrossing, mine = () => false, onMyGround = new Set() }) {
  const events = [];
  const at = (t) => (t == null ? null : String(t));
  const crossingAt = (t) => {
    const ms = Date.parse(String(t ?? ""));
    return Number.isFinite(ms) ? currentCrossing(ms) : null;
  };
  const within = (c) => c != null && c >= sinceCrossing && c <= nowCrossing;

  for (const row of rows) {
    // ⚑ A SLUGLESS CLAIM NAMES NO MARK, and there are real ones on prod: six
    // `locked` rows for berthillon and current-the-reader carry no slug at all
    // (operator's SELECT, 2026-09-07 10:13Z). `006_claim_identity.sql` makes the
    // column NULLABLE on purpose, and my first reading of that — "so this is an
    // ordinary state" — was WRONG: the operator's `SELECT class` (10:40Z) says
    // `sited` ×5 and `parcel` ×1, all at window 150. Both classes NAME a mark,
    // so six mark claims locked with an empty slug is a DATA DEFECT, carried to
    // the sitting. It does not change this guard; it raises it. A slugless row
    // being a defect is a reason for the guard to hold, never a reason to
    // assume it will not be met.
    // `claimRowsSince` DOES return them (its `claimant = ANY($1)`
    // arm matches on the handle, not the slug), so this guard is load-bearing:
    // without it an event would be minted with `mark: null` and a summary
    // reading "null went forward onto the docket". Bound by
    // `test/slugless-claims.test.mjs`.
    const id = row.slug;
    if (!id) continue;
    // WHOSE EFFECT IS IT. `yours` is about the mark's author; `on_your_ground`
    // is about the holder of the ground it stands on. A row that is neither is
    // not this resident's backlog and must not be in it.
    const isMine = mine(id, row);
    const onGround = onMyGround.has(id);
    if (!isMine && !onGround) continue;
    const whose = { yours: isMine, on_your_ground: onGround };

    // SUBMISSION. A draft writes nothing — it is private, and nothing has
    // happened to anybody.
    if (row.status !== "draft") {
      const c = crossingAt(row.submitted_at);
      if (within(c)) events.push({
        kind: "claim-pending", mark: id, at: at(row.submitted_at), crossing: c,
        window: row.window_id ?? null, ...whose,
        summary: `${id} went forward onto the docket at window ${row.window_id ?? "?"}`,
      });
    }

    // THE RULING.
    const d = crossingAt(row.decided_at);
    if (within(d)) {
      if (row.status === "locked") events.push({
        kind: "claim-locked", mark: id, at: at(row.decided_at), crossing: d,
        window: row.window_id ?? null, ...whose,
        summary: `${id} was locked at window ${row.window_id ?? "?"} — the candle ruled for it`,
      });
      else if (row.status === "refused") {
        const { cause, cause_row } = causeOf(row.refusal_check);
        events.push({
          kind: "claim-refused", mark: id, at: at(row.decided_at), crossing: d,
          window: row.window_id ?? null, cause, cause_row, ...whose,
          // THE SENTENCE THE BULLETIN PROMISED, in the backlog as well as on the
          // focus — a resident who reads their delta and never opens a mark
          // still learns the reason.
          summary: `${id} was refused at window ${row.window_id ?? "?"}${cause ? ` — ${cause}` : ""}`
            + (cause ? "" : " (the check that refused it has no word in the bulletin's five yet — see cause_row)"),
        });
      }
    }
  }
  return events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * The reader. Returns `{ readable, events, reason? }` — NEVER a bare list.
 *
 * `readable: false` is the whole point of the shape. `to_you` promises
 * completeness, and a shelf that cannot see the docket cannot keep that
 * promise; reporting an empty list as complete is precisely what the walk was
 * told. `the-town/the-disclosure`: refuse or disclose absent inputs, never
 * quietly substitute.
 *
 * A store that is NOT CONFIGURED is a third state and reads as readable with no
 * events: there is no docket, so there is nothing about it to be incomplete.
 */
export async function readClaimEffects({ key, handles = [], sinceCrossing, nowCrossing, onMyGround = new Set(), sinceInstant = null }) {
  try {
    const { world2Enabled } = await import("./world2-acts.mjs");
    if (!world2Enabled()) return { readable: true, events: [], store: "none" };
  } catch {
    return { readable: false, events: [], reason: "the office could not decide whether a docket store is configured" };
  }

  const mineSet = new Set(handles.filter(Boolean));
  if (!mineSet.size && !onMyGround.size) return { readable: true, events: [], store: "docket" };

  // The cursor is a CROSSING; the query wants an instant. The window's opening
  // edge is the start of the cursor's crossing, so nothing that happened inside
  // it is cut off by rounding — the shelf may over-read by up to twelve hours
  // and `claimEffectsFrom` filters by crossing again, which is the safe
  // direction. Cutting short would drop a resident's own refusal.
  const { CROSSING_EPOCH_UTC, CROSSING_MS } = await import("./crossings.mjs");
  const since = sinceInstant ?? new Date(CROSSING_EPOCH_UTC + Math.max(0, sinceCrossing) * CROSSING_MS).toISOString();

  let rows;
  try {
    const { claimRowsSince } = await import("./world2-claims.mjs");
    rows = await claimRowsSince(since, { claimants: [...mineSet], slugs: [...onMyGround], key });
  } catch (e) {
    return { readable: false, events: [], reason: `the docket store could not be read (${String(e?.message ?? e).slice(0, 160)})` };
  }

  const mine = (id, row) => mineSet.has(row?.claimant) || mineSet.has(String(id).split("/")[0]);
  return {
    readable: true, store: "docket",
    events: claimEffectsFrom({ rows, sinceCrossing, nowCrossing, mine, onMyGround }),
  };
}

// ── R2: WHAT HAPPENED IN THE TOWN ──────────────────────────────────────────
//
// `happened.town.headlines` answered `[]` at crossing 172 — the crossing right
// after a settlement published five marks — because its only source was the
// standing PSA board. A standing notice is not news, and both weekend walks
// found the hole from opposite ends: *"the doorstep tells me everything about
// me and nothing about the town"* and *"the town has a heartbeat you can count
// and no news you can read."*
//
// The crossing's own published/refused list IS the news, and the store has held
// it all along. POINTERS, NEVER COPIES — the shelf's own standing rule — so
// each row is an id, a word, and the read that opens it.

/**
 * THE DOORSTEP'S `rulings` SEGMENT — what the last crossings ruled on my
 * things, one line each.
 *
 * SAME DERIVATION as `since:`'s claim effects: `readClaimEffects` is the one
 * place a claim row becomes an event, and this segment reads it rather than
 * asking the same question a second way. Two derivations of one question is how
 * `stances_awaiting` came to have two counts on two doors with no word saying
 * whose ground each counted (walk of 2026-09-05, item 3).
 *
 * THE WINDOW IS THE LAST TWO CROSSINGS, not a cursor: a doorstep is a morning
 * page, not a backlog. A resident who wants the whole delta has `since:`, and
 * this segment names it in `serves` so they can walk there.
 *
 * ── BOTH AXES, AND THE SECOND WAS PROMISED AND NOT WIRED ──────────────────
 *
 * Repaired 2026-09-07 on the reviewer's finding. This function called
 * `readClaimEffects` with no `onMyGround`, so it defaulted to an empty Set —
 * and that is not a cosmetic omission, it is structural in two places at once:
 * `claimRowsSince` was called with `slugs: []`, so the rows never left the
 * store, and `claimEffectsFrom`'s `if (!isMine && !onGround) continue` dropped
 * any that had. **A mark somebody else laid over your ground could never appear
 * here.**
 *
 * The door's own description promised exactly that axis — "every mark of yours,
 * AND every mark laid over ground you hold" — and the commit that added it
 * argued the bare-vs-named scoping on the same axis ("a narrower default hides
 * a housemate's refusal from the house that shares the ground"). A door saying
 * something true-sounding about itself that nobody asked the record to confirm
 * is the class this lane was chartered to fix, introduced by this lane.
 *
 * The ground set comes from the CONSENT INBOX, exactly as `world-apex.mjs §
 * happenedFor` builds it — `stancesForHandles` already answers "what has been
 * laid over ground you hold", and one question must not have two derivations
 * that disagree (#1044's lesson, and `stances_awaiting`'s two counts).
 */
export async function doorstepRulings(handle, { key = null, sinceCrossings = 2, repo = null, nowMs = Date.now() } = {}) {
  // `nowMs` is the INSTANT (POS-168); `now` below is the crossing NUMBER that
  // instant falls in. The doorstep hands one instant to every clock read on the
  // page so the whole page names one boat; a caller that passes nothing reads
  // the wall clock, exactly as this line did before it had a seam.
  const now = currentCrossing(nowMs);
  // ⚑ `?? 2` NOT `|| 2`: an explicit `crossings: 0` is a caller asking for the
  // window that is open right now, and `||` turned it into 2 after
  // `household-apex.mjs` had already let 0 through its `Number.isFinite` guard.
  // The floor stays at 0 — `Math.max(0, …)` below bounds the cursor anyway, and
  // a zero-width window is a lawful question with an honest empty answer.
  const asked = Number(sinceCrossings);
  const back = Number.isFinite(asked) && asked >= 0 ? Math.floor(asked) : 2;
  const since = Math.max(0, now - back);
  const handles = handle ? [handle] : [...(key?.handles ?? [])];

  // The ground half. Best-effort and never fatal: an unreadable consent inbox
  // costs this segment its second axis, and it is the SAME shape `happenedFor`
  // uses — if it ever grows a disclosure, both should get it together.
  const onMyGround = new Set();
  try {
    const { stancesForHandles } = await import("./world-stance.mjs");
    const scope = handles.filter(Boolean);
    if (scope.length) {
      const inbox = await stancesForHandles(scope, ...(repo ? [{ repo }] : []));
      for (const row of [...(inbox?.awaiting ?? []), ...(inbox?.standing ?? [])]) {
        const id = row?.mark ?? row?.id;
        if (id) onMyGround.add(String(id));
      }
    }
  } catch { /* one axis of two; its absence does not make the other one wrong */ }

  const effects = await readClaimEffects({ key, handles, sinceCrossing: since, nowCrossing: now, onMyGround });
  const events = effects.events ?? [];
  // ── THE PAGE'S BUDGET IS REAL (Hal's foyer, 2026-08-26) ──────────────────
  //
  // This segment rides EVERY doorstep, and the common answer is "nothing".
  // `F7c5 · THE MORNING PAGE DID NOT FATTEN` is the guard that ceiling lives
  // under, and the 09-01 civic pointer paid +150 bytes for two strings on the
  // argument that the five plaque BODIES stayed one read away. Same discipline
  // here: the teaching prose rides only when there is something to teach about.
  // A quiet morning costs four short fields and a pointer that is already in
  // `serves`.
  const quiet = events.length === 0 && effects.readable !== false;
  return {
    since_crossing: since, through_crossing: now,
    count: events.length,
    ...(effects.readable === false
      ? { unavailable: effects.reason ?? "the docket store could not be read — that is not the same as nothing having happened to you" }
      : {}),
    ...(quiet ? { note: "no crossing ruled on anything of yours here — an ordinary state, and a read one: the docket answered." } : {}),
    // R4, and only where a clock is actually being read: the doorstep's own
    // "today" is a UTC day (walk #2 item 5) and this window counts the FERRY's
    // crossings, which is a third clock again.
    ...(quiet ? {} : {
      clock: "the ferry's 00:00/12:00Z crossings — not the doorstep's UTC day, and not the keeper's settlement epoch",
      read_the_rest: 'world { since: <crossing> } is the whole backlog; world { mark: "<by>/<slug>" } is one mark\'s receipt',
    }),
    events,
  };
}

/** The published/refused rows a crossing produced, as headlines. Pure. */
export function headlinesFrom({ rows = [], cap = 3 } = {}) {
  const locked = [], refused = [];
  for (const row of rows) {
    // The same slugless-claim guard as `claimEffectsFrom`, and it is needed
    // HERE too rather than only there: `claimRowsDecidedSince` selects on
    // `status IN ('locked','refused')` and the six real slugless rows on prod
    // are all `locked`, so every one of them reaches this loop. Without this a
    // headline would read "7 marks published at the last crossing" counting
    // rows that name no mark, with `marks: [null, …]` under it.
    if (!row.slug) continue;
    if (row.status === "locked") locked.push(row.slug);
    else if (row.status === "refused") refused.push(row.slug);
  }
  const out = [];
  // ONE HEADLINE PER OUTCOME, not one per mark: this shelf is fixed-size by
  // construction ("nothing here grows with how long you were gone"), and a
  // published-five-marks crossing must not eat a resident's whole window.
  if (locked.length) out.push({
    id: "the-crossing/published", title: `${locked.length} mark${locked.length === 1 ? "" : "s"} published at the last crossing`,
    marks: locked.slice(0, 5), more: Math.max(0, locked.length - 5),
    read: 'world { mark: "<by>/<slug>" } opens any of them, with its receipt',
  });
  if (refused.length) out.push({
    id: "the-crossing/refused", title: `${refused.length} mark${refused.length === 1 ? "" : "s"} refused at the last crossing`,
    marks: refused.slice(0, 5), more: Math.max(0, refused.length - 5),
    read: 'world { mark: "<by>/<slug>" } says which of held · contested · unbacked · malformed · quarantined · unpublished',
  });
  return out.slice(0, cap);
}

/**
 * The reader. `{ readable, rows, reason? }` — an unreadable docket says so,
 * because an empty headline list is exactly what the walk read as "the town has
 * no news", and the two must not look alike.
 */
export async function readHeadlines({ sinceCrossing, cap = 3 } = {}) {
  try {
    const { world2Enabled } = await import("./world2-acts.mjs");
    if (!world2Enabled()) return { readable: true, rows: [], store: "none" };
  } catch {
    return { readable: false, rows: [], reason: "the office could not decide whether a docket store is configured" };
  }
  try {
    const { CROSSING_EPOCH_UTC, CROSSING_MS } = await import("./crossings.mjs");
    const since = new Date(CROSSING_EPOCH_UTC + Math.max(0, sinceCrossing) * CROSSING_MS).toISOString();
    const { claimRowsDecidedSince } = await import("./world2-claims.mjs");
    const rows = await claimRowsDecidedSince(since);
    return { readable: true, store: "docket", rows: headlinesFrom({ rows, cap }) };
  } catch (e) {
    return { readable: false, rows: [], reason: `the crossing's own published/refused list could not be read (${String(e?.message ?? e).slice(0, 160)})` };
  }
}
