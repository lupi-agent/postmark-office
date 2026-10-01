#!/usr/bin/env node
// mark-carried-backfill.mjs — the store records which settlement first carried
// each published mark (POS-142 follow-up, "Proposal B"; migration 049).
//
//   node world2/tools/mark-carried-backfill.mjs --world-repo <checkout>
//        [--dry-run]            the default: derive, compare, print the plan, write nothing
//        [--apply [--prod]]     INSERT the rows the table lacks, checked against 1.0's
//                               receipt inside the transaction; one disagreement rolls back
//        [--verify]             every row in the table re-derived and re-checked; exit 1 on drift
//        [--json]               machine-readable receipt on stdout
//
//   env: WORLD2_PG_URL (the office's own connection — `office_api`, the pen 049
//        grants INSERT to), or PG* as `w2_pgenv` exports them, or --pg-url.
//
//   EXIT: 0 · 1 a DISAGREEMENT with 1.0's receipt (nothing written), or under
//         --verify, DRIFT · 2 cannot run (no checkout, no store, no table).
//
// ── ONE DERIVATION, 1.0's ────────────────────────────────────────────────────
//
// The answer for every mark is `settlementThatCarried` (src/mark-receipt.mjs),
// called the way /world/investigate calls it: the mark's filed path at the
// newest blessing (`filedPathOfAt`), `ref` = that blessing's commit. There is no
// second copy of the rule. A mark it cannot answer — no path in the tree, or no
// settlement tag holds its oldest add — gets NO row, and its receipt stays
// declared. Never a guess.
//
// WHY NOT THE TREE DIFF BETWEEN TWO TAGS. "Which marks did S<n> newly carry" has
// a cheap instrument: the mark ids in S<n>'s world-state.json that S<n-1>'s
// lacks (70 ms a tag). Measured 2026-10-01 on the office's world clone (S87,
// 1,287 published marks, 1,254 of which 1.0 answers), it agrees with 1.0 on
// 1,241 and differs on 13: the-town's class marks (the-three-balances is S12 to
// 1.0 and S43 to the diff), the moved parlor (S51 vs S65), and one the diff puts
// EARLIER (vermillions-sunbathing-spot, S43 vs S45). An id that was renamed or
// moved is "new" to the diff and old to git's followed history. So the tick
// asks the store which published marks have no row, and asks 1.0 about each.
//
// The other 33 published marks have no filed path 1.0 can find (mostly
// `<by>/home`), and one (the-town/funding-quest) has a path but no tag holding
// its oldest add. Those 34 get no row and stay declared.
//
// ── CHECKED AGAINST 1.0's RECEIPT, FIELD FOR FIELD ──────────────────────────
//
// Inside the write's transaction, every written row is read back through the
// join the twin reads (`mark_carried` ⋈ `settlements`) and compared with the
// receipt 1.0's door builds (`readMarkReceipt`, the /world/investigate reader):
//   S-number  receipt.crossing.s
//   sha       receipt.crossing.sha (the whole commit) against settlements.tag_sha
//   date      receipt.crossing.at against settlements.published_at. 1.0 names a
//             date only for the 20 newest settlements (settlements.mjs
//             RECENT_MAX); for an older one the date is compared against 1.0's
//             own tag reader with no limit, so every row's date is checked.
// One disagreement rolls the whole write back. The --verify mode runs the same
// check over every row the table holds.
//
// ── WHAT IT REFUSES ─────────────────────────────────────────────────────────
//
//   · a written row that disagrees with 1.0's receipt: DISAGREE, and the whole
//     write rolls back. Nothing partial lands.
//   · a row is never rewritten. The apply derives only the marks with NO row, so
//     a re-bless or a re-run cannot move one; a present row that 1.0 now answers
//     differently is CONFLICT under --verify, a person's finding.
//   · --apply on a database whose name says neither `lab` nor `scratch` without
//     --prod beside it (settlements-backfill's guard, the same reason).
//   · a checkout that is not the top of a work tree.
//
// A mark whose answer names a settlement the `settlements` table does not hold
// yet is `unsettled`: skipped, and the next run (after settlements-backfill)
// writes it. The row's foreign key would refuse it anyway.
//
// INSERT is the only write, and the only write any runtime pen holds on the table.

import pg from "pg";
import { resolve } from "node:path";

import { settlementThatCarried, readMarkReceipt } from "../../src/mark-receipt.mjs";
import { publishedState } from "../../src/world-branches.mjs";
import { filedPathOfAt } from "../../src/world-journal.mjs";
import { settlements as readSettlements, isRepoRoot } from "../../src/settlements.mjs";

const NL = String.fromCharCode(10);

/**
 * The tick's ceiling. A bless carries a few dozen marks (37 was the most since
 * S70); more than this many published marks with no row means the one-time
 * backfill has not run, and a 15-minute tick is not where ~1,300 git walks belong.
 */
export const TICK_CAP = 200;

// ── the pure half ────────────────────────────────────────────────────────────

const sameInstant = (a, b) => a != null && b != null && new Date(a).getTime() === new Date(b).getTime();

/**
 * The plan: every derived answer classified against what the table holds and
 * which settlements it has rows for.
 *   new          no row; 1.0 answered; its settlement has a row — --apply writes it
 *   present      a row equal to 1.0's answer
 *   CONFLICT     a row naming another settlement — the verify reds on it (the
 *                apply derives only marks with no row, so it never meets one)
 *   DRIFT        a row 1.0 can no longer answer at all — the verify reds on it
 *   unsettled    1.0 answered a settlement the table has no row for yet — skipped
 *   nopath       1.0 finds no filed path for the mark — no row, never guessed
 *   underivable  1.0 finds no settlement tag holding the oldest add — no row
 */
export function planCarried(derived, existing, settlementNumbers) {
  const have = new Map(existing.map((r) => [String(r.mark), r]));
  const settled = new Set([...settlementNumbers].map(Number));
  return derived.map((d) => {
    const row = have.get(d.mark);
    if (d.state === "nopath" || d.state === "underivable") return row ? { ...d, state: "DRIFT", have: Number(row.settlement) } : d;
    if (row) return Number(row.settlement) === d.settlement ? { ...d, state: "present" } : { ...d, state: "CONFLICT", have: Number(row.settlement) };
    return settled.has(d.settlement) ? { ...d, state: "new" } : { ...d, state: "unsettled" };
  });
}

/**
 * One row read back through the twin's join, against 1.0's receipt for the same
 * mark. Returns the list of fields that disagree (empty = agrees).
 */
export function receiptDisagreement(row, receipt, tagDate) {
  const c = receipt?.crossing;
  if (receipt?.status !== "published" || c?.s == null)
    return [`1.0's receipt names no carrying settlement (${receipt?.status ?? "no receipt"}: ${String(receipt?.says ?? "").slice(0, 80)})`];
  const out = [];
  if (Number(c.s) !== Number(row.settlement)) out.push(`S-number: 1.0 S${c.s}, row S${row.settlement}`);
  if (c.sha !== row.tag_sha) out.push(`sha: 1.0 ${String(c.sha).slice(0, 8)}, row ${String(row.tag_sha).slice(0, 8)}`);
  const date = c.at ?? tagDate ?? null;
  if (!sameInstant(date, row.published_at)) out.push(`date: 1.0 ${date ?? "none"}, row ${new Date(row.published_at).toISOString()}`);
  return out;
}

// ── the git half ─────────────────────────────────────────────────────────────

/** The newest blessing's commit and the ids of the marks it publishes, as 1.0's read tier sees them. */
export function publishedMarks(repo) {
  if (!isRepoRoot(repo)) throw new Error(`${repo} is not the top of a git work tree — refusing to read another repo's history`);
  const ps = publishedState(repo);
  if (ps.blessed?.source !== "settlement") throw new Error(`${repo} carries no settlement/S<n> tag — a shallow or unfetched clone answers nothing, not zero`);
  const ids = (ps.state?.marks ?? []).map((m) => m?.id).filter(Boolean).map(String);
  return { sha: ps.sha, n: ps.blessed.n, ids };
}

/** 1.0's answer for each id: `settlementThatCarried` on the mark's filed path, at the blessing's commit. */
export function deriveCarried(repo, ids, sha) {
  const pathOf = filedPathOfAt(repo, sha);
  return ids.map((mark) => {
    const path = pathOf(mark);
    if (!path) return { mark, state: "nopath" };
    const c = settlementThatCarried(repo, path, { ref: sha });
    if (!c || !c.sha || !c.added_at) return { mark, state: "underivable", path };
    return { mark, settlement: c.s, added_sha: c.added_at, path };
  });
}

/** 1.0's tag dates for every settlement, without the door's 20-row limit. */
export function tagDates(repo) {
  return new Map(readSettlements(repo, { limit: Number.MAX_SAFE_INTEGER }).recent.map((t) => [t.n, t.date]));
}

// ── the store half ───────────────────────────────────────────────────────────

const JOIN = `SELECT c.mark, c.settlement, s.tag_sha, s.published_at
                FROM mark_carried c JOIN settlements s ON s.number = c.settlement
               WHERE c.mark = ANY($1::text[]) ORDER BY c.mark`;

/** Read rows back through the twin's join and compare each with 1.0's receipt. */
async function checkAgainstReceipts(client, repo, sha, marks) {
  if (!marks.length) return [];
  const dates = tagDates(repo);
  const { rows } = await client.query(JOIN, [marks]);
  const found = new Set(rows.map((r) => r.mark));
  const bad = marks.filter((m) => !found.has(m)).map((mark) => ({ mark, why: ["no row through the join"] }));
  for (const r of rows) {
    let receipt = null;
    try { receipt = await readMarkReceipt(r.mark, { repo, canon: { id: r.mark }, publishedSha: sha }); } catch { receipt = null; }
    const why = receiptDisagreement(r, receipt, dates.get(Number(r.settlement)));
    if (why.length) bad.push({ mark: r.mark, why });
  }
  return bad;
}

/**
 * The write, shared by this tool's --apply and settlements-backfill's tick.
 * Derives for the published marks with no row, INSERTs the `new` ones, checks every inserted row against 1.0's receipt, and
 * commits only if all agree. Returns a receipt object; never throws on a
 * disagreement (it is a verdict), throws only when it cannot run.
 */
export async function recordCarried(client, repo, { apply = false, cap = Infinity } = {}) {
  const { sha, n, ids } = publishedMarks(repo);
  const { rows: existing } = await client.query("SELECT mark, settlement FROM mark_carried");
  const have = new Set(existing.map((r) => r.mark));
  const lacking = ids.filter((id) => !have.has(id));
  const receipt = { at: `S${n}`, published: ids.length, rows: existing.length, lacking: lacking.length, wrote: 0, verdict: "ok" };
  if (lacking.length > cap) {
    // A path is cheap to ask for (one ls-tree), so the count names only the
    // marks 1.0 could actually answer.
    const pathOf = filedPathOfAt(repo, sha);
    const answerable = lacking.filter((id) => pathOf(id)).length;
    if (answerable > cap) return { ...receipt, verdict: "skipped", why: `${answerable} published marks with a path have no row, more than one bless carries (cap ${cap}): the one-time backfill has not run — world2/tools/mark-carried-backfill.mjs --apply` };
  }
  const { rows: srows } = await client.query("SELECT number FROM settlements");
  const plan = planCarried(deriveCarried(repo, lacking, sha), existing, srows.map((r) => r.number));
  const count = (s) => plan.filter((p) => p.state === s).length;
  Object.assign(receipt, { new: count("new"), unsettled: count("unsettled"), nopath: count("nopath"), underivable: count("underivable"), plan });
  if (!apply) return receipt;
  const fresh = plan.filter((p) => p.state === "new");
  if (!fresh.length) return receipt;
  await client.query("BEGIN");
  try {
    for (const p of fresh)
      await client.query(
        "INSERT INTO mark_carried (mark, settlement, added_sha) VALUES ($1, $2, $3) ON CONFLICT (mark) DO NOTHING",
        [p.mark, p.settlement, p.added_sha]);
    const bad = await checkAgainstReceipts(client, repo, sha, fresh.map((p) => p.mark));
    if (bad.length) {
      await client.query("ROLLBACK");
      return { ...receipt, verdict: "DISAGREE", disagree: bad };
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  }
  const bySettlement = new Map();
  for (const p of fresh) bySettlement.set(p.settlement, (bySettlement.get(p.settlement) ?? 0) + 1);
  return { ...receipt, wrote: fresh.length, by_settlement: Object.fromEntries([...bySettlement].sort((a, b) => a[0] - b[0])) };
}

/**
 * Every row whose mark the newest blessing still publishes, re-derived by 1.0
 * and re-checked against its receipt. A row for a mark no longer published (let
 * go, retired) is KEPT and counted, not compared: the fact that a settlement
 * once carried it does not end, and 1.0 has no receipt for it to compare with.
 */
export async function verifyCarried(client, repo) {
  const { sha, n, ids } = publishedMarks(repo);
  const published = new Set(ids);
  const { rows: all } = await client.query("SELECT mark, settlement FROM mark_carried ORDER BY mark");
  const existing = all.filter((r) => published.has(r.mark));
  const { rows: srows } = await client.query("SELECT number FROM settlements");
  const plan = planCarried(deriveCarried(repo, existing.map((r) => r.mark), sha), existing, srows.map((r) => r.number));
  const drift = plan.filter((p) => p.state !== "present").map((p) => ({ mark: p.mark, why: [`${p.state}: row S${p.have ?? "?"}, 1.0 ${p.settlement != null ? `S${p.settlement}` : "no answer"}`] }));
  const bad = await checkAgainstReceipts(client, repo, sha, plan.filter((p) => p.state === "present").map((p) => p.mark));
  return { at: `S${n}`, rows: all.length, kept: all.length - existing.length, compared: plan.length, verdict: drift.length || bad.length ? "DRIFT" : "ok", disagree: [...drift, ...bad] };
}

/** The one line a tick journals. */
export function receiptLine(r) {
  if (r.verdict === "skipped") return `carried: SKIPPED — ${r.why}`;
  if (r.verdict === "DISAGREE") return `carried: REFUSED, nothing written — ${r.disagree.length} row(s) disagree with 1.0's receipt: ${r.disagree.slice(0, 5).map((d) => `${d.mark} (${d.why.join("; ")})`).join(", ")}`;
  const by = r.by_settlement ? ` (${Object.entries(r.by_settlement).map(([s, c]) => `S${s}: ${c}`).join(", ")})` : "";
  return `carried: wrote ${r.wrote}${by}; the table holds ${r.rows + r.wrote} of ${r.published} published at ${r.at}`
    + ` · no row: ${r.lacking - r.wrote}` + (r.plan ? ` (no path ${r.nopath}, underivable ${r.underivable}, unsettled ${r.unsettled})` : "");
}

// ── the arm ──────────────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i === -1 ? d : process.argv[i + 1]; };
  const flag = (k) => process.argv.includes(`--${k}`);
  const apply = flag("apply"), verify = flag("verify"), json = flag("json");
  if (apply && verify) { console.error("--apply and --verify are two different questions; ask one"); process.exit(2); }
  const mode = apply ? "APPLY" : verify ? "VERIFY" : "dry-run";

  const repoArg = arg("world-repo");
  if (!repoArg) { console.error("--world-repo <checkout> is required"); process.exit(2); }
  const repo = resolve(repoArg);

  const url = arg("pg-url") ?? (process.env.PGUSER ? null : process.env.WORLD2_PG_URL);
  if (!url && !process.env.PGDATABASE) {
    console.error("no --pg-url, no PG* environment, and no WORLD2_PG_URL (the office's own connection is the pen 049 grants)");
    process.exit(2);
  }
  const dbName = url ? decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) : process.env.PGDATABASE;
  if (apply && !/lab|scratch/i.test(dbName) && !flag("prod")) {
    console.error(`--apply refuses database "${dbName}": its name says neither "lab" nor "scratch". Pass --prod as WELL if this is the ship.`);
    process.exit(2);
  }

  const client = url ? new pg.Client({ connectionString: url }) : new pg.Client();
  try { await client.connect(); }
  catch (e) { console.error(`cannot reach ${dbName}: ${String(e?.message ?? e)}`); process.exit(2); }

  const t0 = Date.now();
  let out, code = 0;
  try {
    const { rows: [who] } = await client.query("SELECT current_user AS u, current_database() AS d");
    try { await client.query("SELECT 1 FROM mark_carried LIMIT 0"); }
    catch (e) {
      if (e?.code === "42P01") { console.error(`no \`mark_carried\` table in ${who.d} — apply world2/schema/049_mark_carried.sql first`); process.exit(2); }
      throw e;
    }
    if (!json) console.log(`mark-carried-backfill · ${mode} · ${repo} → ${who.d} as ${who.u}`);
    if (verify) {
      out = await verifyCarried(client, repo);
      if (!json) {
        if (out.verdict === "ok") console.log(`EQUAL: ${out.compared} row(s) for marks published at ${out.at}, every one 1.0's answer and its receipt's S-number, sha and date; ${out.kept} kept for marks no longer published (the table holds ${out.rows})`);
        else console.error(`DRIFT: ${out.disagree.length} row(s) — ${out.disagree.slice(0, 20).map((d) => `${d.mark} (${d.why.join("; ")})`).join(", ")}`);
      }
      code = out.verdict === "ok" ? 0 : 1;
    } else {
      out = await recordCarried(client, repo, { apply });
      if (!json) {
        console.log(`published ${out.published} at ${out.at} · rows ${out.rows} · no row ${out.lacking} → new ${out.new} · unsettled ${out.unsettled} · no path ${out.nopath} · underivable ${out.underivable}`);
        for (const p of (out.plan ?? []).filter((x) => x.state !== "new")) console.log(`  ${p.state.padEnd(11)} ${p.mark}${p.settlement != null ? ` S${p.settlement}` : ""}`);
        if (apply) console.log(receiptLine(out));
      }
      if (out.verdict === "DISAGREE") { code = 1; if (!json) console.error(receiptLine(out)); }
    }
  } finally {
    await client.end();
  }
  if (json) console.log(JSON.stringify({ mode, ...out, plan: undefined, ms: Date.now() - t0 }, null, 1));
  else console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(code);
}
