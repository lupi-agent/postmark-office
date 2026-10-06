#!/usr/bin/env node
// settlements-backfill.mjs — the store learns which settlements have landed,
// one row per `settlement/S<n>` tag, from a world checkout (postmark#2897).
//
//   node world2/tools/settlements-backfill.mjs --world-repo <checkout>
//        [--dry-run]            the default: derive, compare, print the plan, write nothing
//        [--apply [--prod]]     INSERT the rows the table lacks, one transaction
//        [--verify]             the table against the checkout's tags, both ways; exit 1 on drift
//        [--json]               machine-readable receipt on stdout
//        [--quiet]              no plan table — the one receipt line only (the tick's mode)
//
//   env: WORLD2_PG_URL (the office's own connection — `office_api`, the pen
//        018_settlements.sql grants INSERT to), or PG* as `w2_pgenv` exports
//        them, or --pg-url. The dry run and the verify need only SELECT.
//
//   EXIT: 0 · 1 a CONFLICT (a row already present disagrees with its tag) or,
//         under --verify, DRIFT · 2 cannot run (no checkout, no store, no table).
//
// ── THE WRITER, WITHOUT ITS CALLER ──────────────────────────────────────────
//
// The brief placed the row's writer "in the same script that pushes the tag,
// after the push succeeds". Measured: no office script pushes the tag.
// `deploy/settlement-auto.sh` publishes world main and says "NO TAGS from
// here"; the tag is an ANNOTATED object the Worldkeeper mints from his own
// clone at his heartbeat, ~20 minutes after the crossing, and only on a clean
// judgment — three publishes sit between S70 and S71. So the row can follow the
// tag only by READING the tag, and this tool is that reader: run it after any
// bless and it writes exactly the tags the table lacks; run it at the ship and
// it writes S1 through S71. WHO RUNS IT (Wright-ruled 2026-09-17, on the lane's
// stop on shape): `deploy/office-tick.sh`, every 15 minutes, right after the
// world fetch that carries the tag in — `--apply --prod --quiet`, non-fatal,
// its one receipt line in the tick's journal. So the table is as current as
// the office's tick, at most ~15 minutes behind a bless, and the twin says so.
//
// THE DRY RUN AND THE WRITE DERIVE THEIR ROWS FROM THE SAME FUNCTION. There is
// no second path that could disagree with the rehearsal (backfill-register.mjs's
// rule, kept). The verify compares the SAME derivation against the table.
//
// ── EVERY COLUMN FROM THE TAG, AND ONE FROM THE STORE ───────────────────────
//
//   number        <n> of `settlement/S<n>`. 1.0's own regex (SETTLEMENT_TAG).
//   tag_sha       the COMMIT the tag blesses — `%(*objectname)` for an annotated
//                 tag, the ref itself for a lightweight one. NEVER the tag
//                 object's sha (replay-ingest.mjs:236 names that trap).
//   published_at  that commit's committer date: when the crossing pushed. This
//                 is the instant 1.0 prints as `date`.
//   blessed_at    the tag object's tagger date: the keeper's bless. NULL for a
//                 lightweight tag, which has no date of its own.
//   window_id     the ONE field that needs the store: the newest `windows` row
//                 whose `closes_at` is at or before `published_at` — the window
//                 that crossing closed. Checked against the crossing's own
//                 journal line for S71 ("docket: window 194 locked at
//                 2026-09-17T05:45:45.550Z"; the sweep committed at 05:46:08Z;
//                 window 194 closes_at 05:45:40Z → 194). NULL when no window
//                 has closed by then — every tag before the store's first
//                 window (150, opened 2026-08-26): S1–S46. S47 closed 150 to
//                 the second; the rehearsal over the real clone and prod's 47
//                 rows is in the lane's day doc.
//
// ── WHAT IT REFUSES ─────────────────────────────────────────────────────────
//
//   · a present row whose `tag_sha` is not the tag's — a MOVED TAG. "A bad
//     blessing is canon" (the keeper's standing rule); a tag that moved is a
//     finding for a person, and this tool will not paper over it. The whole
//     apply refuses, nothing partial lands.
//   · --apply on a database whose name says neither `lab` nor `scratch`
//     without --prod beside it. On the box there is no separate lab store
//     (/srv/world2-lab/lab.env and /etc/postmark-office.env both name
//     `world2_dev`), so the name trips the guard there, which is correct: the
//     prod apply is a person's hand, typed twice.
//   · a checkout that is not the TOP of a work tree. `git -C` ascends, and a
//     directory standing inside somebody else's repo would answer with that
//     repo's tags (settlements.mjs measured it: a temp dir under a home
//     directory that is a repo returned forty real settlement tags).
//
// Nothing here updates or deletes a row. INSERT is the only write, and it is
// the only write any runtime pen holds on this table.
//
// ── AND THEN THE MARKS EACH SETTLEMENT CARRIED (049, POS-142 Proposal B) ────
//
// --apply goes on to record, in `mark_carried`, which settlement first carried
// each published mark the store has no row for yet: mark-carried-backfill.mjs §
// recordCarried, the same function as the one-time backfill, capped at its
// TICK_CAP so the tick never runs the whole backfill. Its line follows the
// settlements line. A refusal there (a row disagreeing with 1.0's receipt) rolls
// back only the carried rows and exits 1; the settlement rows are committed
// first and stand.

import pg from "pg";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { SETTLEMENT_TAG, isRepoRoot } from "../../src/settlements.mjs";
import { recordCarried, receiptLine, TICK_CAP } from "./mark-carried-backfill.mjs";

const NL = String.fromCharCode(10);
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? d : process.argv[i + 1]; };
const flag = (n) => process.argv.includes(`--${n}`);

// ── the pure half ────────────────────────────────────────────────────────────

/**
 * The checkout's settlement tags, one line per ref, in the shape the rest of
 * this file derives from. `git for-each-ref` rather than `git tag --list` plus
 * per-tag lookups, because one call answers every field for every tag and
 * peels annotated tags itself (`%(*…)`).
 */
export function readTagLines(repo) {
  if (!isRepoRoot(repo)) throw new Error(`${repo} is not the top of a git work tree — refusing to read another repo's tags`);
  const out = execFileSync("git", ["-C", repo, "for-each-ref", "refs/tags/settlement/",
    "--format=%(refname:short)%09%(objecttype)%09%(objectname)%09%(*objectname)%09%(committerdate:iso-strict)%09%(*committerdate:iso-strict)%09%(taggerdate:iso-strict)"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return out.split(/\r?\n/).filter(Boolean).map((line) => {
    const [tag, type, sha, peeled, cdate, pcdate, tdate] = line.split("\t");
    return { tag, type, sha, peeled: peeled || null, cdate: cdate || null, pcdate: pcdate || null, tdate: tdate || null };
  });
}

/** One derived row per settlement tag; anything that is not a settlement tag contributes nothing. */
export function settlementRowsFrom(tagLines) {
  const rows = [];
  for (const l of tagLines) {
    const m = SETTLEMENT_TAG.exec(String(l.tag ?? "").trim());
    if (!m) continue;
    const number = Number(m[1]);
    if (!Number.isInteger(number) || number < 0) continue;
    const annotated = l.type === "tag";
    const tag_sha = annotated ? l.peeled : l.sha;
    const published_at = annotated ? l.pcdate : l.cdate;
    if (!tag_sha || !published_at) continue;              // a tag that peels to nothing is not a settlement
    rows.push({
      number, tag_sha,
      published_at: new Date(published_at),
      blessed_at: annotated && l.tdate ? new Date(l.tdate) : null,
      lightweight: !annotated,
    });
  }
  rows.sort((a, b) => a.number - b.number);
  return rows;
}

/** The window a crossing closed: the newest whose close is at or before the publish; null before the first. */
export function windowFor(publishedAt, windows) {
  const t = new Date(publishedAt).getTime();
  let best = null;
  for (const w of windows) {
    const c = new Date(w.closes_at).getTime();
    if (c <= t && (best == null || c > new Date(best.closes_at).getTime())) best = w;
  }
  return best ? Number(best.id) : null;
}

const sameInstant = (a, b) => (a == null && b == null) || (a != null && b != null && new Date(a).getTime() === new Date(b).getTime());

/**
 * The plan: every derived row classified against what the table holds.
 *   new       absent from the table — --apply writes it
 *   present   in the table and equal on every column
 *   CONFLICT  in the table with a different tag_sha — a moved tag; refuses the apply
 *   DRIFT     in the table, same sha, some other column differs — verify reds, apply skips
 * plus `extra`: table rows no tag stands behind (verify reds on them).
 */
export function planFrom(derived, existing, windows) {
  const byNumber = new Map(existing.map((r) => [Number(r.number), r]));
  const plan = derived.map((d) => {
    const window_id = windowFor(d.published_at, windows);
    const row = { ...d, window_id };
    const have = byNumber.get(d.number);
    if (!have) return { ...row, state: "new" };
    if (have.tag_sha !== d.tag_sha) return { ...row, state: "CONFLICT", have: { tag_sha: have.tag_sha } };
    const drift = [];
    if (!sameInstant(have.published_at, d.published_at)) drift.push("published_at");
    if (!sameInstant(have.blessed_at, d.blessed_at)) drift.push("blessed_at");
    if ((have.window_id == null ? null : Number(have.window_id)) !== window_id) drift.push("window_id");
    return drift.length ? { ...row, state: "DRIFT", drift } : { ...row, state: "present" };
  });
  const seen = new Set(derived.map((d) => d.number));
  const extra = existing.filter((r) => !seen.has(Number(r.number))).map((r) => Number(r.number));
  return { plan, extra };
}

/**
 * The carried step of an apply. Its own failures are named in its line and
 * never undo the settlement rows above, which are already committed: a store
 * without 049 says so, and a git or store error is one line, not a stack.
 */
export async function carriedOnTick(client, repo) {
  try {
    const r = await recordCarried(client, repo, { apply: true, cap: TICK_CAP });
    return { verdict: r.verdict, line: receiptLine(r) };
  } catch (e) {
    if (e?.code === "42P01") return { verdict: "absent", line: "carried: no `mark_carried` table yet (049 not applied) — nothing recorded" };
    return { verdict: "error", line: `carried: NOT recorded (non-fatal) — ${String(e?.message ?? e).slice(0, 200)}` };
  }
}

// ── the arm ──────────────────────────────────────────────────────────────────

const iso = (d) => (d == null ? "—" : new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z"));

function render(plan, extra, { dbName, user, repo, mode }) {
  const count = (s) => plan.filter((r) => r.state === s).length;
  const lines = [
    `settlements-backfill · ${mode} · ${repo} → ${dbName} as ${user}`,
    `tags ${plan.length} · new ${count("new")} · present ${count("present")} · DRIFT ${count("DRIFT")} · CONFLICT ${count("CONFLICT")} · extra rows ${extra.length}`,
    "",
    "  S     state     tag_sha   published_at          window  blessed_at",
  ];
  for (const r of plan) {
    lines.push(`  ${String(r.number).padStart(4)}  ${r.state.padEnd(8)}  ${r.tag_sha.slice(0, 8)}  ${iso(r.published_at)}  ${String(r.window_id ?? "—").padStart(6)}  ${iso(r.blessed_at)}`
      + (r.lightweight ? "  (lightweight tag: no bless date)" : "")
      + (r.state === "CONFLICT" ? `  ← table holds ${r.have.tag_sha.slice(0, 8)}` : "")
      + (r.state === "DRIFT" ? `  ← differs on ${r.drift.join(", ")}` : ""));
  }
  if (extra.length) lines.push("", `rows in the table with no tag behind them: ${extra.map((n) => `S${n}`).join(", ")}`);
  return lines.join(NL);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const apply = flag("apply"), verify = flag("verify"), json = flag("json"), quiet = flag("quiet");
  if (apply && verify) { console.error("--apply and --verify are two different questions; ask one"); process.exit(2); }
  const mode = apply ? "APPLY" : verify ? "VERIFY" : "dry-run";

  const repoArg = arg("world-repo");
  if (!repoArg) { console.error("--world-repo <checkout> is required"); process.exit(2); }
  const repo = resolve(repoArg);

  const url = arg("pg-url") ?? (process.env.PGUSER ? null : process.env.WORLD2_PG_URL);
  if (!url && !process.env.PGDATABASE) {
    console.error("no --pg-url, no PG* environment, and no WORLD2_PG_URL (the office's own connection is the pen 018 grants)");
    process.exit(2);
  }
  const dbName = url ? decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) : process.env.PGDATABASE;
  if (apply && !/lab|scratch/i.test(dbName) && !flag("prod")) {
    console.error(`--apply refuses database "${dbName}": its name says neither "lab" nor "scratch". Pass --prod as WELL if this is the ship. ` +
      "(On the box there is no separate lab store: /srv/world2-lab/lab.env and /etc/postmark-office.env both name world2_dev.)");
    process.exit(2);
  }

  let tagLines;
  try { tagLines = readTagLines(repo); }
  catch (e) { console.error(String(e?.message ?? e)); process.exit(2); }
  const derived = settlementRowsFrom(tagLines);
  if (!derived.length) { console.error(`${repo} carries no settlement/S<n> tag at all — a shallow or unfetched clone answers nothing, not zero`); process.exit(2); }

  const client = url ? new pg.Client({ connectionString: url }) : new pg.Client();
  try { await client.connect(); }
  catch (e) {
    // A wrong role, a wrong host, a store that is down: say so in one line and
    // exit 2 (cannot run). A stack trace here would name the driver, not the store.
    console.error(`cannot reach ${dbName}: ${String(e?.message ?? e)}`);
    process.exit(2);
  }
  let receipt;
  try {
    const { rows: [who] } = await client.query("SELECT current_user AS u, current_database() AS d");
    const { rows: windows } = await client.query("SELECT id, closes_at FROM windows ORDER BY id");
    let existing;
    try { ({ rows: existing } = await client.query("SELECT number, tag_sha, published_at, window_id, blessed_at FROM settlements ORDER BY number")); }
    catch (e) {
      if (e?.code === "42P01") { console.error(`no \`settlements\` table in ${who.d} — apply world2/schema/018_settlements.sql first`); process.exit(2); }
      throw e;
    }
    const { plan, extra } = planFrom(derived, existing, windows);
    const conflicts = plan.filter((r) => r.state === "CONFLICT");
    const drift = plan.filter((r) => r.state === "DRIFT");
    const fresh = plan.filter((r) => r.state === "new");

    const text = render(plan, extra, { dbName: who.d, user: who.u, repo, mode });
    if (!json && !quiet) console.log(text);

    let wrote = 0, verdict = "ok", carried = null;
    if (quiet && !apply && !verify) console.log(text.split(NL)[1]);   // the census line, nothing else
    if (conflicts.length) {
      verdict = "CONFLICT";
      console.error(`${NL}REFUSED: ${conflicts.length} tag(s) moved — ${conflicts.map((r) => `S${r.number}`).join(", ")}. A blessing is canon; a moved tag is a person's finding, not a row to rewrite.`);
    } else if (apply) {
      // THE SETTLEMENT NAMES ITS SNAPSHOT (POS-358, 065): the snapshot the seal
      // took at the window this crossing closed, written with the row, since no
      // pen may UPDATE a settlement. A store without 065 has no column, and the
      // row is written exactly as before.
      const { rows: [linkable] } = await client.query(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'settlements' AND column_name = 'snapshot_id') AS ok");
      await client.query("BEGIN");
      for (const r of fresh) {
        if (linkable.ok) {
          await client.query(
            `INSERT INTO settlements (number, tag_sha, published_at, window_id, blessed_at, snapshot_id)
             VALUES ($1, $2, $3, $4, $5, (SELECT id FROM world_snapshots WHERE window_id = $4)) ON CONFLICT (number) DO NOTHING`,
            [r.number, r.tag_sha, r.published_at, r.window_id, r.blessed_at]);
        } else {
          await client.query(
            "INSERT INTO settlements (number, tag_sha, published_at, window_id, blessed_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (number) DO NOTHING",
            [r.number, r.tag_sha, r.published_at, r.window_id, r.blessed_at]);
        }
        wrote++;
      }
      await client.query("COMMIT");
      const { rows: [{ n }] } = await client.query("SELECT count(*)::int AS n FROM settlements");
      // The receipt names what moved AND what stands, so a tick that wrote
      // nothing still says so with the number the table is at.
      console.log(`${quiet ? "" : NL}wrote ${wrote} row(s)${wrote ? ` — ${fresh.map((r) => `S${r.number}`).join(", ")}` : ""}; the table now holds ${n} (tags in the checkout: ${derived.length})`);
      if (drift.length) console.error(`${NL}${drift.length} present row(s) differ from their tag on a non-sha column and were LEFT ALONE (this tool never updates): ${drift.map((r) => `S${r.number}`).join(", ")}`);
      // WHICH SETTLEMENT CARRIED EACH MARK (049, POS-142 Proposal B): with the
      // settlement rows in, the published marks the store has no row for are
      // asked of 1.0 and recorded, checked against its receipt before commit.
      // After the one-time backfill that is a bless's own new marks plus the few
      // git cannot answer. Before it, the cap skips and says so.
      carried = await carriedOnTick(client, repo);
      if (!json) console.log(carried.line);
      if (carried.verdict === "DISAGREE") verdict = "CONFLICT";
    } else if (verify) {
      const missing = fresh.map((r) => r.number);
      if (missing.length || drift.length || extra.length) {
        verdict = "DRIFT";
        console.error(`${NL}DRIFT: ` + [
          missing.length ? `${missing.length} tag(s) with no row — ${missing.map((n) => `S${n}`).join(", ")}` : null,
          drift.length ? `${drift.length} row(s) differing from their tag — ${drift.map((r) => `S${r.number} (${r.drift.join(", ")})`).join(", ")}` : null,
          extra.length ? `${extra.length} row(s) with no tag — ${extra.map((n) => `S${n}`).join(", ")}` : null,
        ].filter(Boolean).join("; "));
      } else {
        console.log(`${NL}EQUAL: ${plan.length} tag(s), ${plan.length} row(s), every column agrees (compared ${plan.length})`);
      }
    }
    receipt = { mode, verdict, db: who.d, user: who.u, repo, tags: derived.length, new: fresh.length, present: plan.filter((r) => r.state === "present").length,
      drift: drift.map((r) => r.number), conflict: conflicts.map((r) => r.number), extra, wrote, compared: plan.length,
      rows: plan.map((r) => ({ number: r.number, state: r.state, tag_sha: r.tag_sha, published_at: iso(r.published_at), window_id: r.window_id, blessed_at: iso(r.blessed_at) })),
      ...(carried ? { carried: carried.line } : {}) };
  } finally {
    await client.end();
  }
  if (json) console.log(JSON.stringify(receipt, null, 1));
  process.exit(receipt.verdict === "ok" ? 0 : 1);
}
