#!/usr/bin/env node
// events-rebuild.mjs — the calendar's tables, rebuilt from the act log alone,
// and compared with what is stored (POS-207).
//
//   node world2/tools/events-rebuild.mjs --dry-run
//        [--json]               machine-readable receipt on stdout
//
//   env: WORLD2_PG_URL (the office's own connection), or PG* as `w2_pgenv`
//        exports them, or --pg-url. It needs only SELECT; it writes nothing.
//
//   EXIT: 0 equal · 1 DRIFT (a stored row the acts do not derive, or the
//         reverse) · 2 cannot run (no store, no table).
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
//
// Wright's shape (2026-09-24): "The record is the act log; the table is its
// projection ... rebuildable from the acts alone (write that rebuild as a tool
// ... and make the equality between a rebuild and the tables a test)." The pen
// (src/events-store.mjs) and this tool take every row from ONE pure function,
// `applyEventAct` (src/events.mjs), so a drift here means something wrote the
// tables that was not the pen — or an act was written that the pen did not
// project — and never that the two disagree about what an act means.
//
// ── EVERY COLUMN, AND ONE TABLE IT NEVER TOUCHES ────────────────────────────
//
// A rebuild restores every column of `events` and `event_rsvps`, and compares
// every one. An RSVP's address and a webhook's secret are not on those tables:
// they live on the resident's private harness row, `household_harnesses`
// (026_events.sql § THE HARNESS ROW, ruled 2026-09-25). No act carries them, so
// no rebuild can derive them, and this tool NEVER READS OR TOUCHES that table.
// Its receipt says so in its own line, and test/events.test.mjs drives
// `dryRun` and reads back every query it asked.
//
// ── ONLY A DRY RUN ──────────────────────────────────────────────────────────
//
// There is no --apply. A drift is a finding for a person, and the repair is
// theirs. Until a drift has been seen once, no automatic repair is proposed.

import { foldEventActs, rsvpKey } from "../../src/events.mjs";

// The tables a rebuild restores, and the one it never touches.
export const REBUILT_TABLES = Object.freeze(["events", "event_rsvps"]);
export const NEVER_TOUCHED = Object.freeze(["household_harnesses"]);
export const NEVER_TOUCHED_LINE = "never read or touched: household_harnesses (each resident's private harness row; no act carries it)";

const EVENT_FIELDS = ["id", "title", "invitation", "host", "household", "place_mark", "place_x", "place_y",
  "doors_open", "starts", "ends", "revised", "cancelled", "hosted_act", "last_act"];
const RSVP_FIELDS = ["event", "handle", "household", "harness", "budget", "fell_back", "act"];

const iso = (v) => (v == null ? null : new Date(v).toISOString());
const normEvent = (r) => ({ ...Object.fromEntries(EVENT_FIELDS.map((k) => [k, r[k] ?? null])),
  place_x: Number(r.place_x), place_y: Number(r.place_y), revised: Number(r.revised),
  hosted_act: Number(r.hosted_act), last_act: Number(r.last_act), cancelled: r.cancelled === true,
  doors_open: iso(r.doors_open), starts: iso(r.starts), ends: iso(r.ends) });
const normRsvp = (r) => ({ ...Object.fromEntries(RSVP_FIELDS.map((k) => [k, r[k] ?? null])),
  budget: Number(r.budget), act: Number(r.act) });

/**
 * THE EQUALITY. `stored` is `{ events: [rows], rsvps: [rows] }` as the tables
 * hold them; `acts` is every class-`event` act, oldest first. Returns
 * `{ equal, drift: [sentences], counts }`.
 */
export function compareRebuild(stored, acts) {
  const rebuilt = foldEventActs(acts);
  const drift = [];
  const pairs = [
    ["events", new Map(stored.events.map((r) => [r.id, normEvent(r)])), new Map([...rebuilt.events].map(([k, r]) => [k, normEvent(r)]))],
    ["event_rsvps", new Map(stored.rsvps.map((r) => [rsvpKey(r.event, r.handle), normRsvp(r)])), new Map([...rebuilt.rsvps].map(([k, r]) => [k, normRsvp(r)]))],
  ];
  for (const [table, have, want] of pairs) {
    for (const [k, w] of want) {
      const h = have.get(k);
      if (!h) { drift.push(`${table} ${k}: the acts derive this row and the table does not hold it`); continue; }
      for (const f of Object.keys(w)) if (JSON.stringify(h[f]) !== JSON.stringify(w[f]))
        drift.push(`${table} ${k}.${f}: stored ${JSON.stringify(h[f])}, the acts derive ${JSON.stringify(w[f])}`);
    }
    for (const k of have.keys()) if (!want.has(k)) drift.push(`${table} ${k}: the table holds this row and no act derives it`);
  }
  return { equal: drift.length === 0, drift,
    counts: { acts: acts.length, events: rebuilt.events.size, event_rsvps: rebuilt.rsvps.size },
    never_touched: NEVER_TOUCHED };
}

/**
 * THE DRY RUN, on a client the caller connected: one READ ONLY transaction,
 * the event acts and the two tables, compared. It asks nothing else of the
 * store, and in particular nothing of `household_harnesses`.
 */
export async function dryRun(client) {
  await client.query("BEGIN READ ONLY");
  try {
    const { eventActs } = await import("../../src/events-store.mjs");
    const acts = await eventActs(client);
    const { rows: events } = await client.query("SELECT * FROM events ORDER BY id");
    const { rows: rsvps } = await client.query("SELECT * FROM event_rsvps ORDER BY event, handle");
    await client.query("COMMIT");
    return compareRebuild({ events, rsvps }, acts);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* connection already gone */ }
    throw e;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
  if (!argv.includes("--dry-run")) {
    console.error("events-rebuild: only --dry-run exists — it reads and compares, and writes nothing");
    process.exit(2);
  }
  const url = arg("pg-url") ?? (process.env.PGUSER ? null : process.env.WORLD2_PG_URL);
  if (!url && !process.env.PGDATABASE) { console.error("events-rebuild: no store (WORLD2_PG_URL, PG*, or --pg-url)"); process.exit(2); }
  const { default: pg } = await import("pg");
  const client = url ? new pg.Client({ connectionString: url }) : new pg.Client();
  await client.connect();
  try {
    const out = await dryRun(client);
    if (argv.includes("--json")) console.log(JSON.stringify(out, null, 2));
    else {
      console.log(`${out.equal ? "equal" : "DRIFT"} · ${out.counts.acts} event acts → ${out.counts.events} events, ${out.counts.event_rsvps} rsvps · every column of both restored and compared · ${NEVER_TOUCHED_LINE}`);
      for (const d of out.drift) console.log(`  ${d}`);
    }
    process.exit(out.equal ? 0 : 1);
  } catch (e) {
    console.error(`events-rebuild: cannot run — ${String(e?.message ?? e).slice(0, 200)}`);
    process.exit(2);
  } finally { await client.end().catch(() => {}); }
}

// Run as a script, never on import (the equality test imports compareRebuild).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("world2/tools/events-rebuild.mjs")) main();
