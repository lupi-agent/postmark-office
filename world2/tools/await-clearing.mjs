#!/usr/bin/env node
// await-clearing.mjs — THE ORDER INVERTS AT THE SWAP (G1 lane 3, ruled 2026-09-08).
//
//   node world2/tools/await-clearing.mjs --since <iso8601> [--timeout-s 240] [--poll-s 5]
//   node world2/tools/await-clearing.mjs --since <iso8601> --by-hand
//   node world2/tools/await-clearing.mjs --since <iso8601> --rehearse
//
//   env: WORLD2_PG=1 and WORLD2_PG_URL — consumed at `src/world2-acts.mjs:255`
//        (`env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL`).
//
// EXIT: 0 a docket is locked and named on stdout · 1 REFUSED with the reason as
//       a JSON body · 2 a bad argument.
//
// ── WHY THE ORDER INVERTS ───────────────────────────────────────────────────
//
// In the git era the settlement and the candle were independent. The sweep
// committed at :45:32 and the clearing locked window 177's docket at :45:44 —
// the fold ran BEFORE the clearing and did not care, because its input came from
// sketchbook branches the drain had already written.
//
// After G1 the fold's input IS the clearing's output. The candle locks the
// closing window's docket; the fold then reads that docket as the crossing's
// delta. A crossing that folds before the clearing has locked is folding the
// previous window a second time, and it would look exactly like a quiet
// crossing: same marks, nothing new to publish, green.
//
// ── WHAT IT WAITS FOR, AND WHY THAT CONDITION AND NOT ANOTHER ───────────────
//
// A window whose `cleared_at` is at or after THIS CROSSING'S OWN START. Nothing
// timing-based, no grace window, no "recent enough".
//
// The tempting condition is "the most recently closed window", and it is wrong:
// on a crossing where the clearing has not run yet, that answers with the
// PREVIOUS crossing's docket and the wait returns instantly having waited for
// nothing. The second tempting condition is "the currently open window has
// closed", and it is wrong the other way: if the clearing already ran before
// this tool was reached, the open window is the NEXT one, and waiting for it to
// close waits for the next crossing — twelve hours.
//
// The crossing's own start instant separates them with no ambiguity, because the
// clearing for this crossing necessarily clears after the crossing began. That
// is the observed shape on the box (receipt `at: 17:45:00Z`, window 177
// `cleared_at 17:45:44Z`) and it is also the definition: a docket cleared before
// this crossing started belongs to an earlier one.
//
// ── AND IT REFUSES RATHER THAN PROCEEDING ───────────────────────────────────
//
// A timeout is a clearing that did not run, which is a candle that has stopped.
// Publishing the previous window's fold under a fresh receipt would be the
// 2026-08-26 starving crossing with better paperwork, so the refusal names the
// window it was waiting past and how long it waited.
//
// ── `--by-hand`: THE OPERATOR DOOR (postmark#2786, ruled 2026-09-14) ─────────
//
// The guard above is right for the timer and wrong for the operator whose
// PREVIOUS crossing published nothing. Measured: on 2026-09-14 window 188 closed
// at 05:45Z holding 29 locked claims that its refused crossing never folded; the
// world test that refused it was fixed and merged by 09:1x; two reruns at 13:21Z
// and 13:26Z then refused `clearing-did-not-run`, because no window had cleared
// at or after 13:21Z and none would until 17:45Z. A correct tree and an unfolded
// docket sat side by side for eight hours, and 29 residents' marks stayed
// locked-but-unpublished for a day. The paired recovery the record prescribed —
// the sweep first, the candle while it waits — answered "no window past its
// close, nothing due", because the open window 189 was not due until 17:45Z.
//
// So a rerun by hand is a SECOND DOOR, never a loosening of the first:
//
//   the timer asks   "which window closed for THIS crossing"        (an instant)
//   the operator asks "which closed window is still UNFOLDED"       (a state)
//
// The second question has no timing in it at all, so it cannot be answered by
// relaxing the first — a grace window, a "recent enough", a longer timeout would
// each have let the timer take a stale docket on the night the candle died,
// which is the whole class the wait exists to prevent. The by-hand read is
// instead the NOTARY'S OWN: a closed window holding at least one locked claim
// with no materialized mark (`canon-locks.mjs § UNMATERIALIZED_SELECT`, the read
// `falsifier-canon-locks.mjs` runs nightly). "Unfolded" is a fact about the
// store, true or false without reference to any clock, which is what makes it
// safe to hand an operator.
//
// It never takes the OPEN window: closing a window early is a different act with
// a different owner (`clearing-job.mjs --window N`, the candle's pen), and the
// issue's second path was ruled out of this door's scope.
//
// It never waits, because there is nothing to wait for — the question is already
// answered by the store's current state, and a poll loop would only re-ask it.
//
// And it is never the unit's own default. `deploy/postmark-settlement.service`
// does not set it; `deploy/postmark-settlement-by-hand.service` does, carries no
// timer, and is started by a person — so the journal names the act by its unit
// and the receipt carries `by_hand: true` beside it. A by-hand publication that
// could be mistaken for a scheduled one would be a worse record than no rerun.
//
// ── `--rehearse`: THE SHADOW'S QUESTION (2026-09-25) ─────────────────────────
//
// The settlement shadow runs at 10:23Z and 22:23Z, between crossings, so neither
// question above has an answer it can use: no window clears after its start, and
// on a healthy day nothing is unfolded. It asks a third one — "which window is
// the newest CLOSED one" — which is the only window `foldDelta` will fold at all
// (`not-newest-closed-window`). The shadow publishes nothing, so re-folding a
// published docket is its point: the write-down skips every mark canon already
// holds byte-for-byte, and what is left is what the next crossing would carry.
// Never a publishing crossing's door: `settlement-auto.sh` passes it only under
// SETTLEMENT_DRY=1, the dry leg, which publishes nothing either (POS-242).

const argOf = (n, d = null) => { const i = process.argv.indexOf(n); return i !== -1 ? process.argv[i + 1] : d; };

const refuse = (reason, detail) => {
  process.stdout.write(`${JSON.stringify({ refused: reason, detail }, null, 1)}\n`);
  process.exit(1);
};

/**
 * AN INSTANT, FROM WHATEVER THE STORE HANDS BACK.
 *
 * DEFENSIVE, NOT A REPAIR, and the distinction is recorded because I got it
 * wrong first. Measured against this Node:
 *
 *   psql's text form  `2026-09-08 17:45:44.650035+00`  parses (V8's lenient
 *                                                      non-ISO path)
 *   the `pg` driver   a JS `Date` for a timestamptz    parses
 *   `2026-09-08T17:45:44.650035+00`                    NaN
 *
 * Only the third fails, and it is not a shape the store produces on either path
 * — I typed the `T` into my own fixture, watched the test redden, and briefly
 * wrote it up as the box's defect. It was mine.
 *
 * This stays anyway: a two-digit offset is a real ISO-8601 spelling that arrives
 * from JSON round trips and other tools, and normalizing three inputs to one
 * instant costs less than reasoning about a lenient parser at 05:45Z. What it
 * must not do is claim to have fixed something.
 */
export function toMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const s = v.trim()
    .replace(" ", "T")                       // postgres writes a space, ISO wants T
    .replace(/([+-]\d{2})$/, "$1:00");       // `+00` → `+00:00`
  return Date.parse(s);
}

/**
 * THE PREDICATE, PURE. Window rows in, the crossing's docket out — or null when
 * the clearing has not reached this crossing yet.
 *
 * Pure so the decision is falsifiable without a database, which matters more
 * here than usual: the impure half is a sleep loop, and a sleep loop is the one
 * thing a test cannot afford to exercise honestly.
 */
export function docketFor(windows, sinceIso) {
  const since = toMs(sinceIso);
  if (!Number.isFinite(since)) throw new Error(`await-clearing: unparseable --since "${sinceIso}"`);
  const closed = (windows ?? [])
    .filter((w) => w.status === "closed" && w.cleared_at)
    .map((w) => ({ ...w, at: toMs(w.cleared_at) }))
    .filter((w) => Number.isFinite(w.at) && w.at >= since)
    .sort((a, b) => a.at - b.at || Number(a.id) - Number(b.id));
  // The EARLIEST qualifying docket, not the latest: if two windows closed while
  // this waited, the first is this crossing's and the second belongs to whatever
  // ran after. Taking the latest would silently skip a crossing's worth of
  // record — and it would do it on exactly the slow night when the wait mattered.
  return closed.length ? { window: Number(closed[0].id), cleared_at: closed[0].cleared_at, town_sha: closed[0].town_sha ?? null } : null;
}

/**
 * THE OPERATOR'S PREDICATE, PURE. Window rows and the notary's unmaterialized
 * claim rows in; the newest closed window that is STILL UNFOLDED out, or null.
 *
 * Pure for `docketFor`'s reason and one more: this one is reached by a person
 * typing a command at an hour when something has already gone wrong, so the
 * decision it makes has to be readable from a fixture rather than from a store
 * nobody can rewind.
 *
 * NEWEST, not earliest, and the asymmetry with `docketFor` is the point. The
 * timer takes the EARLIEST qualifying window because two closes while it waited
 * are two crossings' worth of record and it must not skip one. The operator
 * takes the NEWEST unfolded one because the fold's own carry
 * (`fold-input-cli.mjs --world-repo`, § "carried_absent") already sweeps up
 * standing marks canon does not hold from EARLIER windows — so the newest
 * unfolded docket is the largest one act can lawfully publish, and an older one
 * would publish less while claiming the same.
 *
 * `status === "closed"` AND a `cleared_at` is the same locked-docket test the
 * timer uses, for the same reason: a closed window with no `cleared_at` is a
 * window mid-transition, and the OPEN window is never any sweep's to take.
 */
export function unfoldedDocket(windows, unmaterializedRows) {
  const unfolded = new Set(
    (unmaterializedRows ?? [])
      .map((r) => Number(r?.window_id))
      .filter((n) => Number.isFinite(n)));
  const closed = (windows ?? [])
    .filter((w) => w.status === "closed" && w.cleared_at)
    .map((w) => ({ ...w, at: toMs(w.cleared_at) }))
    .filter((w) => Number.isFinite(w.at))
    .sort((a, b) => b.at - a.at || Number(b.id) - Number(a.id));
  const take = closed.find((w) => unfolded.has(Number(w.id)));
  return take
    ? { window: Number(take.id), cleared_at: take.cleared_at, town_sha: take.town_sha ?? null, by_hand: true }
    : null;
}

/**
 * THE OPERATOR'S PREDICATE SINCE THE STORE CUTOVER, PURE (Darko, 2026-10-04:
 * "We have ruled before that you need to be able to manually run settlements
 * when needed. What blocks that from being possible").
 *
 * `unfoldedDocket` above asks for a locked claim with no mark row. That was the
 * git era's meaning of "not yet folded": claims became marks at the fold. Since
 * the cutover the CLEARING materializes every claim it locks, in the same
 * transaction, so after any successful clearing no locked claim lacks a mark and
 * that predicate answers null forever. Measured 2026-10-04: window 228, cleared
 * by hand at 12:13Z with 10 locked, and the by-hand sweep refused
 * `nothing-unfolded` while the keeper held S93. The operator door had been dead
 * since the cutover and nothing exercised it.
 *
 * So the door asks the store's own record of what is DONE: the newest closed
 * window newer than the window the newest BLESSED settlement folded
 * (`settlements.window_id`). Blessed, not published: a window published but
 * refused by the keeper is exactly the one an operator re-runs. Re-folding a
 * window already published is harmless (the write-down finds canon's bytes and
 * writes nothing new), and the keeper judges whatever is published.
 *
 * `lastBlessedWindow` null (no settlement yet) takes the newest closed window.
 */
export function unblessedDocket(windows, lastBlessedWindow) {
  const floor = Number.isFinite(Number(lastBlessedWindow)) && lastBlessedWindow !== null ? Number(lastBlessedWindow) : -Infinity;
  const closed = (windows ?? [])
    .filter((w) => w && w.status === "closed" && w.cleared_at && Number(w.id) > floor)
    .sort((a, b) => Number(b.id) - Number(a.id));
  const take = closed[0];
  return take
    ? { window: Number(take.id), cleared_at: take.cleared_at, town_sha: take.town_sha ?? null, by_hand: true }
    : null;
}

/** The by-hand refusal since the cutover: every closed window is already blessed. */
export function nothingUnblessedDetail({ newest, lastBlessedWindow }) {
  return `every closed window is already folded into a blessed settlement (the newest blessed settlement folded window ${lastBlessedWindow ?? "none"}), `
    + "so there is nothing for a by-hand sweep to publish. "
    + `The newest window is ${newest ? `${newest.id} (${newest.status}, cleared_at ${newest.cleared_at ?? "null"})` : "unreadable"}. `
    + "Claims filed since the last close belong to the OPEN window; close it with the candle first "
    + "(postmark-world2-clearing.service), then run this again.";
}

/**
 * THE SHADOW'S PREDICATE, PURE. The newest closed window with a `cleared_at` —
 * the same locked-docket test the other two use — or null. Newest by id, as
 * `foldDelta`'s own `not-newest-closed-window` check orders it, so this can never
 * name a window the fold would refuse.
 */
export function newestClosedDocket(windows) {
  const closed = (windows ?? [])
    .filter((w) => w && w.status === "closed" && w.cleared_at)
    .sort((a, b) => Number(b.id) - Number(a.id));
  const take = closed[0];
  return take
    ? { window: Number(take.id), cleared_at: take.cleared_at, town_sha: take.town_sha ?? null, rehearsal: true }
    : null;
}

/**
 * The newest window the store holds, whatever its status — the one both
 * refusals name so the reader knows where the town actually is.
 */
export function newestWindow(windows) {
  const rows = (windows ?? []).filter((w) => w && w.id !== undefined && w.id !== null);
  if (!rows.length) return null;
  const top = rows.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
  return { id: Number(top.id), status: top.status ?? null, cleared_at: top.cleared_at ?? null };
}

/**
 * THE TIMER'S REFUSAL, IN WORDS, and it is a function rather than a template at
 * the exit site so that the text is falsifiable without a database. The whole
 * value of `--by-hand` depends on the timer's path being UNCHANGED, and "unchanged"
 * has to mean something a test can read: `test/await-clearing.test.mjs` holds
 * this sentence verbatim and reddens if the operator door ever edits it.
 */
export function clearingDidNotRunDetail({ waitedS, since, newest }) {
  return `waited ${waitedS}s and no window cleared at or after this crossing's start (${since}). `
    + `The newest window is ${newest ? `${newest.id} (${newest.status}, cleared_at ${newest.cleared_at ?? "null"})` : "unreadable"}. `
    + "The candle has not locked this crossing's docket, so there is no delta to fold. Folding the previous "
    + "window again would publish nothing and look like a quiet crossing, which is the 2026-08-26 starving "
    + "shape with better paperwork.";
}

/**
 * THE OPERATOR DOOR'S REFUSAL. A by-hand sweep with nothing unfolded is not an
 * error and not a success: it is the answer "the world already carries this",
 * and it says so rather than publishing a second copy of a published window
 * under a fresh receipt — which is the starving shape the timer's refusal names,
 * reached by the other door.
 */
export function nothingUnfoldedDetail({ newest }) {
  return "no closed window still holds a locked claim with no materialized mark, so there is nothing for a "
    + "by-hand sweep to publish. "
    + `The newest window is ${newest ? `${newest.id} (${newest.status}, cleared_at ${newest.cleared_at ?? "null"})` : "unreadable"}. `
    + "Every closed window's claims are already materialized: the record this run would publish is the record "
    + "the world already carries. Claims filed since the last close belong to the OPEN window, and closing that "
    + "window early is the candle's act, not this one's.";
}

const isMain = process.argv[1]
  && (await import("node:fs")).realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/await-clearing.mjs");

if (isMain) {
  const since = argOf("--since");
  const timeoutS = Number(argOf("--timeout-s", "240"));
  const pollS = Number(argOf("--poll-s", "5"));
  // `--since` stays REQUIRED on both doors even though the by-hand read never
  // consults it. It is the crossing's own start instant, the receipt's `at`, and
  // the one field that says WHEN a by-hand publication happened; a door that let
  // an operator omit it would produce the one receipt nobody can place in time.
  const byHand = process.argv.includes("--by-hand");
  const rehearse = process.argv.includes("--rehearse");
  if (byHand && rehearse) { console.error("--by-hand and --rehearse ask different questions; pass one"); process.exit(2); }
  if (!since) { console.error("--since <iso8601> is required — the crossing's own start instant"); process.exit(2); }
  if (!Number.isFinite(timeoutS) || !Number.isFinite(pollS)) { console.error("--timeout-s and --poll-s must be numbers"); process.exit(2); }

  if (process.env.WORLD2_PG !== "1" || !process.env.WORLD2_PG_URL) {
    refuse("no-store-credential",
      'WORLD2_PG is not "1" or WORLD2_PG_URL is unset — this crossing cannot see the candle. '
      + 'The consuming line is src/world2-acts.mjs:255 (`env.WORLD2_PG === "1" && !!env.WORLD2_PG_URL`).');
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: process.env.WORLD2_PG_URL });
  const started = Date.now();
  let last = null;
  try {
    await client.connect();

    if (rehearse) {
      const { rows } = await client.query(
        "SELECT id, status, cleared_at, town_sha FROM windows ORDER BY id DESC LIMIT 20");
      const found = newestClosedDocket(rows);
      if (!found) {
        const newest = newestWindow(rows);
        refuse("no-closed-window", "no closed window with a cleared_at among the newest twenty, so there is no docket to rehearse. "
          + `The newest window is ${newest ? `${newest.id} (${newest.status}, cleared_at ${newest.cleared_at ?? "null"})` : "unreadable"}.`);
      }
      process.stdout.write(`${JSON.stringify(found, null, 1)}\n`);
    } else if (byHand) {
      // NO `LIMIT` HERE, and the asymmetry with the timer's read is deliberate.
      // The timer asks "did a window clear in the last 240 seconds", and the
      // newest twenty answer that with room to spare. The operator asks "which
      // closed window is still unfolded", and the answer can be older than
      // twenty windows the moment a crossing has been dark for a week — a cap on
      // THAT question is a silent denominator that would refuse
      // `nothing-unfolded` over a docket sitting right there. The table grows
      // two rows a day.
      const { rows } = await client.query(
        "SELECT id, status, cleared_at, town_sha FROM windows ORDER BY id DESC");
      // SINCE THE CUTOVER the door asks what the newest BLESSED settlement
      // folded, not whether a claim lacks a mark (§ unblessedDocket).
      const { rows: [blessed] } = await client.query(
        "SELECT max(window_id) AS window_id FROM settlements");
      const lastBlessedWindow = blessed?.window_id ?? null;
      const found = unblessedDocket(rows, lastBlessedWindow);
      if (!found) refuse("nothing-unfolded", nothingUnblessedDetail({ newest: newestWindow(rows), lastBlessedWindow }));
      process.stdout.write(`${JSON.stringify(found, null, 1)}\n`);
    } else {
      for (;;) {
        const { rows } = await client.query(
          "SELECT id, status, cleared_at, town_sha FROM windows ORDER BY id DESC LIMIT 20");
        const found = docketFor(rows, since);
        if (found) {
          process.stdout.write(`${JSON.stringify({ ...found, waited_s: Math.round((Date.now() - started) / 1000) }, null, 1)}\n`);
          break;
        }
        last = newestWindow(rows);
        if ((Date.now() - started) / 1000 >= timeoutS) {
          refuse("clearing-did-not-run", clearingDidNotRunDetail({
            waitedS: Math.round((Date.now() - started) / 1000), since, newest: last,
          }));
        }
        await new Promise((r) => setTimeout(r, pollS * 1000));
      }
    }
  } catch (e) {
    if (!(e && e.__refused)) refuse("await-clearing-tripped", String(e?.message ?? e));
  } finally { try { await client.end(); } catch { /* already gone */ } }
}
