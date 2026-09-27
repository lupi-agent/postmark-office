#!/usr/bin/env node
// backfill-departures.mjs — the four-day hole in `acts` is filled from the
// movement store's own rows, in the shape the walk mirror writes (POS-154).
//
//   node world2/tools/backfill-departures.mjs --sqlite <dynamic.db>
//        --from <iso> --to <iso>     the OPEN interval: at > from AND at < to
//        [--dry-run]                 the default: derive, compare, print the plan, write nothing
//        [--apply [--prod]]          INSERT the rows the table lacks, one transaction
//        [--verify]                  the window's sqlite rows against the store's, both ways; exit 1 on drift
//        [--json]                    machine-readable receipt on stdout
//        [--quiet]                   no plan table — the census line only
//        [--pg-url <url>]            else WORLD2_PG_URL, else PG*
//
//   EXIT: 0 · 1 a CONFLICT (a present row disagrees with its movement), DRIFT
//         under --verify, or the apply REFUSED by the ordering gate below ·
//         2 cannot run (no sqlite, no store, no table, bad bounds).
//
// ── THE HOLE, AND WHY THE STORE IS SHORT ────────────────────────────────────
//
// `acts` holds NO departure between 2026-08-27T09:57:00.374Z (the last seeded
// `legacy:departure`) and 2026-08-31T03:35:20.069Z (the first mirrored `walk`).
// The movement store holds those days. The walk lane's pen was
// `dynamic.db/movements` throughout, the journal those walks also reached was
// truncated by `world-drain.mjs` before the journal era was seeded, and the
// acts mirror did not begin carrying this pen until 08-31. So one pen's rows
// exist in exactly one place, and this tool is the only road from it.
//
// Measured on the 2026-09-21T18:36Z snapshot, and the three counts are three
// different questions — say which bound you asked:
//
//   440   at >= 09:57:00.374Z AND at <= 03:35:20.069Z   (both bounds INCLUSIVE)
//   439   at >  09:57:00.374Z AND at <  03:35:20.069Z   (the OPEN gap)
//   438   the rows `acts` actually lacks
//
// The two that fall away are not drift. The row AT the lower bound is
// `fabel-of-garrison` seq 773, and it IS act 2918, the last `legacy:departure`
// — one event, two stores. The last row of the open gap is `little-bird` seq
// 1212 at 03:35:19.161Z, and it IS act 2941, the first `walk` — the mirror
// stamped it 908 ms later, which is the whole difference. An inclusive bound
// counts a row that is already filed; this tool's interval is OPEN at both ends
// and its idempotence key catches the other one regardless.
//
// ── `movements.at` AND `acts.at` ARE DIFFERENT QUANTITIES ───────────────────
//
// `movements.at` is when the resident DECLARED. `acts.at` is when the mirror
// WROTE — measured +908 / +413 / +365 / +407 ms on four paired walks. A
// backfill has no write instant in its own past to record, and `live-reads.mjs
// § departureRecordOf` reports `iso: isoOf(row.at)` — the act row's instant is
// what a reader shows as the departure's. So these rows carry the DECLARED
// instant, which is the truer answer to the question the door asks, and is
// within a second of what the mirror would have written. Stated because it is a
// change of meaning that happens to be invisible.
//
// ── THREE COLUMNS A MOVEMENT ROW DOES NOT CARRY (the stop on shape) ─────────
//
// The mirror's walk act is `world.mjs § walkEntry`, and three of its columns
// are derived from a LIVE read at the instant of the walk, not from the
// movement:
//
//   at_anchor / at_dx / at_dy   `witnessStampAt` → `anchorAt(from, {chain,
//                               centreOf})`, a containment read over the marks
//                               AS THEY STOOD. The movement row carries
//                               `from_x/from_y`, so this is derivable in form —
//                               but only against today's marks, which would
//                               stamp a 2026-09-21 containment answer onto an
//                               08-29 act. That is inventing a value.
//   witnesses                   `presentNear` — who was within earshot then.
//                               Not reconstructible from any surviving record.
//   household                   `resolvedWorldHousehold(key)` — the CALLER'S
//                               api key, resolved through the docket pen's own
//                               resolver. A movement row has no key, only a
//                               handle, and a handle's household is itself a
//                               roster fact that moves.
//
// All three land NULL, and NULL is not invented here: it is this table's own
// shape for a walk act from the other pen — `walk-exec.mjs:131` writes
// `at: null, witnesses: null` with no household on every walk it files.
//
// WHAT IT COSTS, MEASURED: nothing any departure reader sees. Every one of them
// — `/world2/walks`, `/world2/present`, `/world2/orient`, the say door's
// earshot, and `storedDepartures` on the walker port — selects
// `id, at, crossing, actor, action, payload` and no other column. The three
// nulls are invisible to all of them. They are visible to the NOTARY, which
// exports acts whole, and a reader of that export will see three empty fields
// beside a `_backfill` stamp that says why.
//
// ── THE ORDERING GATE — RULED, AND NOW OPEN ─────────────────────────────────
//
// **Ruled 2026-09-21 (Wright): "a departure's order is its INSTANT, never its
// insertion id."** `DEPARTURE_ORDER_SQL` now carries the instant key, the same
// `at, id` the runbook's D6 replay already uses for the holding rows
// (POS-153/162) — one law, not a new one. The gate below therefore PASSES, and
// it stays in the tool as the standing falsifier: revert the clause and the
// apply refuses again, without anyone having to remember why.
//
// What follows is the state that forced the ruling, kept because it is the
// reason the gate exists at all.
//
// `DEPARTURE_ORDER_SQL` was `ORDER BY ((payload->>'_ledger') IS NULL), acts.id`
// and `governingDepartures` takes the LAST row per handle in that order. So the
// governing departure was the highest `acts.id` — APPEND order, not instant
// order.
//
// `acts.id` is `GENERATED ALWAYS AS IDENTITY`, and the ids across the hole's own
// four days are long since spent on the 729 other acts that DID land there. A
// backfilled row can therefore only be appended, with an id above every walk
// September filed. Under the clause as it stands that makes an 08-29 walk the
// governing record for anyone who has walked since: measured on the snapshot
// against prod's 2,397 departure acts, 52 actors have a movement in the gap and
// 41 of them have a departure at or after the upper bound. A plain apply would
// have moved 41 residents back to where they stood on 08-29, on the public
// doors, and no guard in the read path could see it — the old
// `assertDepartureOrder` passed, because the rows ARE id-ascending.
//
// So the apply is gated on the reader being able to place these rows, and the
// gate READS THE READER rather than a flag: it asks whether
// `DEPARTURE_ORDER_SQL` carries an instant key, and refuses while it does not
// and the plan would displace anybody. Nothing to remember and nothing to pass.
//
// THE CLAUSE AS SHIPPED (live-reads.mjs § DEPARTURE_ORDER_KEYS):
//
//   ORDER BY ((payload->>'_ledger') IS NULL),
//            (CASE WHEN payload->>'_ledger' IS NULL THEN acts.at END),
//            acts.id
//
// Over prod's 2,397 non-ledger departure acts that is a NO-OP: zero instant
// inversions among 2,396 adjacent id-ascending pairs, zero positions changed,
// zero handles whose governing departure moves. `world2/tools/README.md` § the
// append order measured the same question on `world2_dev` before the walk era
// existed and got the same answer — "era-then-id vs by-instant: 0 of 73",
// "journal era, id vs instant: 0 of 72 (786 of 786 rows monotone in `at`)". The
// two measurements together cover both eras and 2,397 rows.
//
// The CASE keeps the ledger era on `acts.id`, because that era's file order is
// the one place the two genuinely diverge: the 2026-08-08 sailing filed every
// passenger at 18:00:00.000Z and those lines were appended after walks stamped
// 18:16. `world2-live-reads.test.mjs § latest wins is LAST IN ARRAY ORDER` is
// that case and stays green because of it.
//
// AND THE BACKFILLED ROW'S INSTANT IS NOW LOAD-BEARING. It carries the
// DECLARED instant (§ above), which is what files it between the journal era
// and the walk era where it belongs. Under the old clause that choice was
// cosmetic; under this one it is the placement.
//
// ── IDEMPOTENCE ─────────────────────────────────────────────────────────────
//
// Every row this tool writes carries `payload._backfill` (this lane) and
// `payload._backfill_seq` (the movement's own `seq`). The underscore is the
// town's word for a key the store owns — 017_source_underscore.sql's ruling,
// and `mark-record.mjs:283` is its enforcer, so a key spelled this way can
// never reach a resident's file. A re-run recognises its own rows by that seq
// and skips them. It ALSO matches by the instant pair — an act by the same
// actor stamped 0 to 2,000 ms AFTER the declaration, nearest first, and each act
// claimable by only one movement — which is what catches the row the mirror
// already wrote under its own instant. The `little-bird` pair at +908 ms is
// exactly that case, and without it the open gap would file a duplicate of act
// 2941. The pairing is one-sided and one-to-one because the store refuted the
// loose version: 11 pairs of same-actor movements inside this window are closer
// together than 5 s, so a symmetric 5 s window let one act stand for two walks
// and dropped the second in silence.
//
// A present row that DISAGREES on any derived column is a CONFLICT: named with
// its seq, and the whole apply refuses. Nothing partial lands.
//
// The dry run, the apply and the verify all derive from `departureRowsFrom`.
// There is no second path that could disagree with the rehearsal
// (backfill-register.mjs's rule, kept).

import pg from "pg";
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { DEPARTURE_ACTIONS, DEPARTURE_ORDER_SQL } from "./live-reads.mjs";

const NL = String.fromCharCode(10);
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const flag = (n) => process.argv.includes(`--${n}`);

/** The mirror's own words for a walk, so the act reads the same whichever pen filed it. */
export const WALK_ACTION = "walk";
export const WALK_CLASS = "move";
export const WALK_EFFECT = "the walk is declared; the record receives it at the save";
export const BACKFILL_LANE = "POS-154";
export const BACKFILL_SOURCE = "dynamic.db/movements";
/**
 * How long after a declaration the mirror's stamp may land and still be the
 * same event. ONE-SIDED, and that is the whole guard: the mirror writes AFTER
 * the resident declares, never before, so an act stamped EARLIER than a
 * movement is a different walk no matter how close it sits. Measured on four
 * paired walks: +908 / +413 / +407 / +365 ms.
 *
 * WHY IT IS NOT LOOSER. A symmetric 5 s window was the first draft and the
 * store refuted it: 11 pairs of same-actor movements inside this window sit
 * closer together than 5 s (nyx's closest two are 2,977 ms apart), and 681
 * pairs do store-wide, the closest at 462 ms. A tolerance wider than the gap
 * between one resident's own walks lets one act stand for two of them — which
 * marks a row present that the store does not hold, and drops it silently. The
 * one-to-one consumption in `planFrom` is the other half of that guard, and it
 * is the half that holds at ANY tolerance.
 */
export const PAIR_TOLERANCE_MS = 2000;

// ── the pure half ────────────────────────────────────────────────────────────

/**
 * The movement rows inside the OPEN interval, in the store's own order.
 *
 * Open at both ends deliberately: each bound instant names an event that is
 * already an act (the seeded era's last, the mirrored era's first), and a
 * closed bound would plan a duplicate of a row the table holds.
 */
export function readMovementRows(sqlitePath, { from, to }) {
  if (!existsSync(sqlitePath)) throw new Error(`no sqlite at ${sqlitePath}`);
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    return db.prepare(
      `SELECT seq, actor, at, from_x, from_y, toward_x, toward_y, crossing,
              within_w, within_h, to_mark, pace, declared_by, note
         FROM movements
        WHERE at > ? AND at < ?
        ORDER BY at, seq`).all(from, to);
  } finally { db.close(); }
}

/**
 * One movement row → one `acts` row, in `walkEntry`'s exact vocabulary.
 *
 * The payload's five keys are `world.mjs § walkEntry`'s, field for field and in
 * its order — `within` and `to` are the movement store's own column names, and
 * using them is what lets `live-reads.mjs § departureRecordOf` read this row
 * through the era-5 mapping it already has rather than a sixth spelling of one
 * departure. The two `_backfill` keys ride beside them; era 5 is detected by
 * `p.from && p.toward && !p.lines && !p._ledger`, which they do not disturb.
 */
export function departureRowFrom(m) {
  if (m.crossing == null || !Number.isFinite(Number(m.crossing)))
    throw new Error(`movement seq ${m.seq} carries no crossing — a departure act with no town clock is refused by every reader of it`);
  if (!m.actor) throw new Error(`movement seq ${m.seq} carries no actor`);
  if (!m.at) throw new Error(`movement seq ${m.seq} carries no instant`);
  const within = (m.within_w != null && m.within_h != null) ? { w: m.within_w, h: m.within_h } : null;
  return {
    seq: m.seq,
    at: m.at,
    crossing: Number(m.crossing),
    actor: m.actor,
    action: WALK_ACTION,
    object: m.to_mark ?? null,
    at_anchor: null, at_dx: null, at_dy: null,   // the live stamp: not in a movement row
    witnesses: null,                             // the earshot read: not reconstructible
    class: WALK_CLASS,
    payload: {
      from: { x: m.from_x, y: m.from_y },
      toward: { x: m.toward_x, y: m.toward_y },
      pace: m.pace ?? null,
      within,
      to: m.to_mark ?? null,
      // THE TWO KEYS THIS SELECT ALREADY ASKED FOR (POS-198, 2026-09-22).
      // `readMovementRows` has SELECTed `declared_by, note` since POS-154 and
      // this builder dropped both on the floor — POS-196 found it by reading
      // the record rather than the code ("SELECTs the column and drops it").
      // `declared_by ?? actor` is `readMovements`' own coalesce, so a
      // backfilled act and a live one spell a self-declared walk the same way;
      // `note` is conditional, as it is on the record's own lines.
      declared_by: m.declared_by ?? m.actor,
      ...(m.note ? { note: m.note } : {}),
      _backfill: BACKFILL_LANE,
      _backfill_seq: m.seq,
      _backfill_source: BACKFILL_SOURCE,
    },
    effect: WALK_EFFECT,
    household: null,                             // the caller's resolved key: not in a movement row
    journal_seq: null,                           // the mirror's own value on this path
  };
}

export function departureRowsFrom(movements) {
  return movements.map(departureRowFrom);
}

const msOf = (v) => (v instanceof Date ? v.getTime() : Date.parse(String(v)));
const num = (v) => (v == null ? null : Number(v));

/**
 * Does a stored departure act stand for this movement?
 *
 * Its own `_backfill_seq` first — exact, and the only key that survives a
 * re-run. The instant pair second, and only among acts no other movement has
 * already claimed (`taken`), nearest first: one act can stand for one walk.
 */
export function matchOf(derived, existing, taken = new Set()) {
  const bySeq = existing.find((e) => num(e.payload?._backfill_seq) === Number(derived.seq));
  if (bySeq) return { have: bySeq, by: "seq" };
  const t = msOf(derived.at);
  const near = existing
    .filter((e) => !taken.has(e.id) && e.actor === derived.actor)
    .map((e) => ({ e, d: msOf(e.at) - t }))
    .filter((c) => c.d >= 0 && c.d <= PAIR_TOLERANCE_MS)
    .sort((a, b) => a.d - b.d);
  return near.length ? { have: near[0].e, by: "pair", lag_ms: near[0].d } : null;
}

/** Which derived fields a present row must agree on — the ones any reader of a departure reads. */
export function disagreementsOf(derived, have) {
  const out = [];
  const hp = have.payload ?? {};
  const dp = derived.payload;
  const near = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) < 1e-9);
  if (have.actor !== derived.actor) out.push("actor");
  if (!near(num(have.crossing), derived.crossing)) out.push("crossing");
  if (!near(hp.from?.x, dp.from.x) || !near(hp.from?.y, dp.from.y)) out.push("from");
  if (!near(hp.toward?.x, dp.toward.x) || !near(hp.toward?.y, dp.toward.y)) out.push("toward");
  if (!near(hp.pace ?? null, dp.pace)) out.push("pace");
  if ((hp.to ?? null) !== dp.to) out.push("to");
  const hw = hp.within ?? null, dw = dp.within;
  if ((hw == null) !== (dw == null) || (hw && dw && (!near(hw.w, dw.w) || !near(hw.h, dw.h)))) out.push("within");
  return out;
}

/**
 * The plan: every derived row classified against the departure acts the store
 * already holds in and around the window.
 *
 *   new       no act stands for it — --apply writes it
 *   present   an act stands for it and agrees on every read field
 *   CONFLICT  an act stands for it and disagrees — refuses the whole apply
 */
export function planFrom(derived, existing) {
  const taken = new Set();
  return derived.map((d) => {
    const m = matchOf(d, existing, taken);
    if (!m) return { ...d, state: "new" };
    taken.add(m.have.id);
    const drift = disagreementsOf(d, m.have);
    return drift.length
      ? { ...d, state: "CONFLICT", matched_by: m.by, have_id: m.have.id, drift }
      : { ...d, state: "present", matched_by: m.by, have_id: m.have.id, lag_ms: m.lag_ms ?? null };
  });
}

/**
 * Whose governing departure an append WOULD displace, if the read ordered by
 * append — which is the question the gate below turns on, not a claim that it
 * does. With the instant key in the clause these actors are not displaced at
 * all; the number is what the refusal quotes when the key is missing.
 */
export function displacedActors(plan, existingAll) {
  const fresh = plan.filter((r) => r.state === "new");
  const out = new Map();
  for (const r of fresh) {
    const t = msOf(r.at);
    const later = existingAll.filter((e) => e.actor === r.actor && msOf(e.at) > t);
    if (later.length) {
      const prev = out.get(r.actor) ?? { actor: r.actor, rows: 0, later: later.length, latest: null };
      prev.rows += 1;
      prev.latest = later.map((e) => (e.at instanceof Date ? e.at.toISOString() : String(e.at))).sort().at(-1);
      out.set(r.actor, prev);
    }
  }
  return [...out.values()].sort((a, b) => (a.actor < b.actor ? -1 : 1));
}

/**
 * Can the read place a row by its instant?
 *
 * Reads the clause the doors actually use rather than a flag, so the gate below
 * opens the moment the clause learns the key and never because somebody
 * remembered to pass something. A standalone `at` / `acts.at` sort token is the
 * key; `payload->>'_ledger'` and `acts.id` carry no such token.
 */
export function orderClauseCarriesInstant(sql = DEPARTURE_ORDER_SQL) {
  return /(^|[\s,(])(acts\.)?at(\s|,|\)|$)/i.test(String(sql).replace(/'[^']*'/g, "''"));
}

// ── the arm ──────────────────────────────────────────────────────────────────

const iso = (d) => (d == null ? "—" : new Date(d).toISOString());

function render(plan, { dbName, user, sqlitePath, mode, from, to, displaced, placeable }) {
  const count = (s) => plan.filter((r) => r.state === s).length;
  const lines = [
    `backfill-departures · ${mode} · ${sqlitePath} → ${dbName} as ${user}`,
    `window (open) ${from} < at < ${to}`,
    `movements ${plan.length} · new ${count("new")} · present ${count("present")} · CONFLICT ${count("CONFLICT")}`,
    "",
    "  seq   state     at                        crossing   actor                    to",
  ];
  for (const r of plan) {
    lines.push(`  ${String(r.seq).padStart(5)} ${r.state.padEnd(9)} ${iso(r.at)}  ${String(r.crossing.toFixed(4)).padStart(9)}  ${String(r.actor).padEnd(24)} ${r.payload.to ?? "—"}`
      + (r.state === "present" ? `  ← act ${r.have_id} (by ${r.matched_by})` : "")
      + (r.state === "CONFLICT" ? `  ← act ${r.have_id} differs on ${r.drift.join(", ")}` : ""));
  }
  if (displaced.length && !placeable) {
    lines.push("", `ORDERING: ${displaced.length} actor(s) already hold a departure LATER than a row this plan would append,`,
      "and the read's governing record is the highest acts.id, not the latest instant — so appending moves them BACK:");
    for (const d of displaced) lines.push(`  ${d.actor.padEnd(24)} ${String(d.rows).padStart(3)} row(s) planned · ${d.later} later act(s), newest ${d.latest}`);
  } else if (displaced.length) {
    lines.push("", `ORDERING: the read places these rows by their instant, so the ${displaced.length} actor(s) holding a later`,
      "departure keep it — an appended row with an early `at` files where it happened, not last.",
      `  ${DEPARTURE_ORDER_SQL}`);
  }
  return lines.join(NL);
}

// THE REALPATH COMPARE, not the basename one (`await-clearing.mjs` § isMain).
// A basename guard is FALSE when the entry reaches this file through a Windows
// junction — the ESM loader realpaths the entry and `process.argv[1]` does not
// — so the tool would exit 0 having done nothing. `cli-guard.test.mjs` drives
// both faces of this guard through a junction, which is the arm that matters,
// and its roster is what caught this file carrying the fragile form.
const isMain = process.argv[1]
  && (await import("node:fs")).realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/backfill-departures.mjs");

if (isMain) {
  const apply = flag("apply"), verify = flag("verify"), json = flag("json"), quiet = flag("quiet");
  if (apply && verify) { console.error("--apply and --verify are two different questions; ask one"); process.exit(2); }
  const mode = apply ? "APPLY" : verify ? "VERIFY" : "dry-run";

  const sqliteArg = arg("sqlite");
  const from = arg("from"), to = arg("to");
  if (!sqliteArg) { console.error("--sqlite <dynamic.db> is required"); process.exit(2); }
  if (!from || !to) { console.error("--from <iso> and --to <iso> are required (the interval is OPEN at both ends)"); process.exit(2); }
  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(to))) { console.error("--from / --to must be instants this runtime can parse"); process.exit(2); }
  if (Date.parse(from) >= Date.parse(to)) { console.error(`--from (${from}) is not before --to (${to})`); process.exit(2); }
  const sqlitePath = resolve(sqliteArg);

  const url = arg("pg-url") ?? (process.env.PGUSER ? null : process.env.WORLD2_PG_URL);
  if (!url && !process.env.PGDATABASE) {
    console.error("no --pg-url, no PG* environment, and no WORLD2_PG_URL (the office's own connection is the pen 002 grants)");
    process.exit(2);
  }
  const dbName = url ? decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) : process.env.PGDATABASE;
  if (apply && !/lab|scratch/i.test(dbName) && !flag("prod")) {
    console.error(`--apply refuses database "${dbName}": its name says neither "lab" nor "scratch". Pass --prod as WELL if this is the ship. `
      + "(On the box there is no separate lab store: /srv/world2-lab/lab.env and /etc/postmark-office.env both name world2_dev.)");
    process.exit(2);
  }

  let movements, derived;
  try {
    movements = readMovementRows(sqlitePath, { from, to });
    derived = departureRowsFrom(movements);
  } catch (e) { console.error(String(e?.message ?? e)); process.exit(2); }
  if (!derived.length) { console.error(`no movement rows strictly between ${from} and ${to} — an unfetched or wrong snapshot answers nothing, not zero`); process.exit(2); }

  const client = url ? new pg.Client({ connectionString: url }) : new pg.Client();
  try { await client.connect(); }
  catch (e) { console.error(`cannot reach ${dbName}: ${String(e?.message ?? e)}`); process.exit(2); }

  let receipt;
  try {
    const { rows: [who] } = await client.query("SELECT current_user AS u, current_database() AS d");
    // Around the window, not inside it: the pair match needs the acts on either
    // side of each bound, and `displacedActors` needs every later departure.
    let existingAll;
    try {
      ({ rows: existingAll } = await client.query(
        `SELECT id, at, crossing, actor, action, payload FROM acts WHERE action = ANY($1) ${DEPARTURE_ORDER_SQL}`,
        [DEPARTURE_ACTIONS]));
    } catch (e) {
      if (e?.code === "42P01") { console.error(`no \`acts\` table in ${who.d} — apply world2/schema/001_tables.sql first`); process.exit(2); }
      throw e;
    }
    const lo = msOf(from) - PAIR_TOLERANCE_MS, hi = msOf(to) + PAIR_TOLERANCE_MS;
    const nearWindow = existingAll.filter((e) => msOf(e.at) >= lo && msOf(e.at) <= hi);

    const plan = planFrom(derived, nearWindow);
    const conflicts = plan.filter((r) => r.state === "CONFLICT");
    const fresh = plan.filter((r) => r.state === "new");
    const present = plan.filter((r) => r.state === "present");
    const displaced = displacedActors(plan, existingAll);
    const placeable = orderClauseCarriesInstant();

    const text = render(plan, { dbName: who.d, user: who.u, sqlitePath, mode, from, to, displaced, placeable });
    if (!json && !quiet) console.log(text);
    if (quiet && !json) console.log(text.split(NL)[2]);

    let wrote = 0, verdict = "ok";
    if (conflicts.length) {
      verdict = "CONFLICT";
      console.error(`${NL}REFUSED: ${conflicts.length} present act(s) disagree with their movement — `
        + `${conflicts.map((r) => `seq ${r.seq} (act ${r.have_id}: ${r.drift.join(", ")})`).join("; ")}. `
        + "A row the store already holds is the record; a disagreement is a person's finding, not a row to rewrite. Nothing was written.");
    } else if (apply && displaced.length && !placeable) {
      verdict = "REFUSED-ORDERING";
      console.error(`${NL}REFUSED: the read cannot place these rows by their instant.${NL}`
        + `  DEPARTURE_ORDER_SQL is ${DEPARTURE_ORDER_SQL}${NL}`
        + `  and governingDepartures takes the LAST row per handle in that order — the highest acts.id, which an${NL}`
        + `  appended row always is. ${displaced.length} actor(s) hold a departure later than a row this plan appends,${NL}`
        + `  so the apply would move each of them back to their walk inside the window, on the public doors.${NL}`
        + `  acts.id is GENERATED ALWAYS AS IDENTITY and the window's own ids are spent, so there is no id to slot into.${NL}`
        + `  This gate reads the clause, not a flag: give the non-ledger era an instant key and it opens by itself.`);
    } else if (apply) {
      await client.query("BEGIN");
      try {
        for (const r of fresh) {
          await client.query(
            `INSERT INTO acts (at, crossing, actor, action, object,
                               at_anchor, at_dx, at_dy, witnesses, class,
                               payload, effect, household, journal_seq)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [r.at, r.crossing, r.actor, r.action, r.object,
              r.at_anchor, r.at_dx, r.at_dy, r.witnesses, r.class,
              JSON.stringify(r.payload), r.effect, r.household, r.journal_seq]);
          wrote++;
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      const { rows: [{ n }] } = await client.query(
        "SELECT count(*)::int AS n FROM acts WHERE action = ANY($1)", [DEPARTURE_ACTIONS]);
      console.log(`${quiet ? "" : NL}wrote ${wrote} row(s); the store now holds ${n} departure act(s) (movements in the window: ${derived.length}, already present: ${present.length})`);
    } else if (verify) {
      const missing = fresh.map((r) => r.seq);
      // Both ways: every movement wants an act, and every act inside the window
      // wants a movement. An act with no movement behind it is as much a drift
      // as a movement with no act.
      const winActs = existingAll.filter((e) => msOf(e.at) > msOf(from) && msOf(e.at) < msOf(to));
      const planned = new Set(plan.filter((r) => r.state === "present").map((r) => r.have_id));
      const orphan = winActs.filter((e) => !planned.has(e.id)).map((e) => e.id);
      if (missing.length || orphan.length) {
        verdict = "DRIFT";
        console.error(`${NL}DRIFT: ` + [
          missing.length ? `${missing.length} movement(s) with no act — seq ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? " …" : ""}` : null,
          orphan.length ? `${orphan.length} act(s) inside the window with no movement behind them — id ${orphan.slice(0, 12).join(", ")}${orphan.length > 12 ? " …" : ""}` : null,
        ].filter(Boolean).join("; "));
      } else {
        console.log(`${NL}EQUAL: ${plan.length} movement(s), ${present.length} act(s), every read field agrees (compared ${plan.length})`);
      }
    }
    receipt = {
      mode, verdict, db: who.d, user: who.u, sqlite: sqlitePath, from, to,
      movements: derived.length, new: fresh.length, present: present.length,
      conflict: conflicts.map((r) => r.seq), wrote,
      order_clause: DEPARTURE_ORDER_SQL, order_clause_places_by_instant: placeable,
      displaced_actors: displaced.length, displaced,
      rows: plan.map((r) => ({ seq: r.seq, state: r.state, at: iso(r.at), crossing: r.crossing, actor: r.actor, to: r.payload.to, have_id: r.have_id ?? null })),
    };
  } finally { await client.end(); }

  if (json) console.log(JSON.stringify(receipt, null, 1));
  process.exit(receipt.verdict === "ok" ? 0 : 1);
}
