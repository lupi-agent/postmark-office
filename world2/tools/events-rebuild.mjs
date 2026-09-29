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
// `applyPostAct` (src/events.mjs), so a drift here means something wrote the
// tables that was not the pen — or an act was written that the pen did not
// project — and never that the two disagree about what an act means.
//
// ── EVERY COLUMN, AND ONE TABLE IT NEVER TOUCHES ────────────────────────────
//
// A rebuild restores every column of `posts` and `responses` for the event
// class (the calendar's tables, generalized in place by 028, POS-288), and
// compares every one. It folds the 026 acts and the post machine's alike. An RSVP's address and a webhook's secret are not on those tables:
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

import { foldPostActs, responseKey, EVENT_CLASS, RESPONSE_RSVP } from "../../src/events.mjs";
import { QUEST_CLASS } from "../../src/quests.mjs";
import { BUG_CLASS } from "../../src/bugs.mjs";

// THE CLASSES A REBUILD FOLDS (POS-294): the event, and the town's quests, whose
// rows are the pen's `post` and `close` acts like any post's. A quest has no
// responses, so its fold compares the posts alone. The bug (Posts phase 2) is
// the same: `post`, `amend` and `advance` acts, and no responses.
export const REBUILT_CLASSES = Object.freeze([EVENT_CLASS, QUEST_CLASS, BUG_CLASS]);

// The tables a rebuild restores, and the one it never touches.
export const REBUILT_TABLES = Object.freeze(["posts", "responses"]);
export const NEVER_TOUCHED = Object.freeze(["household_harnesses"]);
export const NEVER_TOUCHED_LINE = "never read or touched: household_harnesses (each resident's private harness row; no act carries it)";

const POST_FIELDS = ["id", "class", "title", "body", "author", "household", "place_mark", "place_x", "place_y",
  "starts", "ends", "state", "fields", "revised", "posted_act", "last_act"];
const RESPONSE_FIELDS = ["post", "handle", "household", "kind", "state", "fields", "act"];

const iso = (v) => (v == null ? null : new Date(v).toISOString());
const num = (v) => (v == null ? null : Number(v));
// jsonb hands its keys back sorted, so both sides are compared with sorted keys.
const sorted = (o) => {
  const v = typeof o === "string" ? JSON.parse(o) : (o ?? {});
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]));
};
const normPost = (r) => ({ ...Object.fromEntries(POST_FIELDS.map((k) => [k, r[k] ?? null])),
  place_x: num(r.place_x), place_y: num(r.place_y), revised: Number(r.revised),
  posted_act: Number(r.posted_act), last_act: Number(r.last_act),
  starts: iso(r.starts), ends: iso(r.ends), fields: sorted(r.fields) });
const normResponse = (r) => ({ ...Object.fromEntries(RESPONSE_FIELDS.map((k) => [k, r[k] ?? null])),
  act: Number(r.act), fields: sorted(r.fields) });

/**
 * THE EQUALITY. `stored` is `{ posts: [rows], responses: [rows] }` as the tables
 * hold them; `acts` is every class-`event` act, oldest first. Returns
 * `{ equal, drift: [sentences], counts }`.
 */
export function compareRebuild(stored, acts) {
  const rebuilt = foldPostActs(acts);
  const drift = [];
  const pairs = [
    ["posts", new Map(stored.posts.map((r) => [r.id, normPost(r)])), new Map([...rebuilt.posts].map(([k, r]) => [k, normPost(r)]))],
    ["responses", new Map(stored.responses.map((r) => [responseKey(r.post, r.handle, r.kind), normResponse(r)])), new Map([...rebuilt.responses].map(([k, r]) => [k, normResponse(r)]))],
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
    counts: { acts: acts.length, posts: rebuilt.posts.size, responses: rebuilt.responses.size },
    never_touched: NEVER_TOUCHED };
}

/**
 * THE DRY RUN, on a client the caller connected: one READ ONLY transaction,
 * each class's acts and rows, compared class by class. It asks nothing else of
 * the store, and in particular nothing of `household_harnesses`.
 */
export async function dryRun(client) {
  await client.query("BEGIN READ ONLY");
  try {
    const { eventActs } = await import("../../src/events-store.mjs");
    const acts = await eventActs(client);
    const { rows: posts } = await client.query("SELECT * FROM posts WHERE class = $1 ORDER BY id", [EVENT_CLASS]);
    const { rows: responses } = await client.query("SELECT * FROM responses WHERE kind = $1 ORDER BY post, handle", [RESPONSE_RSVP]);
    const questActs = await eventActs(client, QUEST_CLASS);
    const { rows: quests } = await client.query("SELECT * FROM posts WHERE class = $1 ORDER BY id", [QUEST_CLASS]);
    const bugActs = await eventActs(client, BUG_CLASS);
    const { rows: bugs } = await client.query("SELECT * FROM posts WHERE class = $1 ORDER BY id", [BUG_CLASS]);
    await client.query("COMMIT");
    const ev = compareRebuild({ posts, responses }, acts);
    const qu = compareRebuild({ posts: quests, responses: [] }, questActs);
    const bu = compareRebuild({ posts: bugs, responses: [] }, bugActs);
    return { equal: ev.equal && qu.equal && bu.equal, drift: [...ev.drift, ...qu.drift, ...bu.drift],
      counts: { acts: ev.counts.acts, posts: ev.counts.posts, responses: ev.counts.responses,
        quest_acts: qu.counts.acts, quests: qu.counts.posts, bug_acts: bu.counts.acts, bugs: bu.counts.posts },
      never_touched: NEVER_TOUCHED };
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
      console.log(`${out.equal ? "equal" : "DRIFT"} · ${out.counts.acts} event acts → ${out.counts.posts} posts, ${out.counts.responses} responses · ${out.counts.quest_acts} quest acts → ${out.counts.quests} quest posts · ${out.counts.bug_acts} bug acts → ${out.counts.bugs} bug posts · every column of both restored and compared · ${NEVER_TOUCHED_LINE}`);
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
