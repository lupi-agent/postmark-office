// settle-pass.mjs — the office tick settles merged joins before the join bundle.
//
// RULED (Keemin, 2026-09-29, Household Primary Key reopened; this overturns the
// "no timer" clause of #3231): a join that merged is bound by the office on its
// next tick, not by somebody remembering to call settle-join. The pass lists
// the town's PRs merged since its cursor, keeps the ones that are joins — the
// office pen's `residency/<handle>`, and hand-written single-address joins —
// whose handle has no pin, and settles each through the one critical section
// the Registrar's door runs (`src/settle-join.mjs § settleUnderLock`).
//
// IT RUNS INSIDE THE TICK'S FLOCK, right after the pulls and BEFORE the mint
// catch-up and the welcome pass (deploy/office-tick.sh). So it calls the
// critical section directly: the lock is already held, and a nested
// `flock town.lock` would wait on its own parent. The order is the point — a
// handle bound before the welcome runs is paid under its GitHub id, and one
// bound after it is Wildcat (two welcome lines in one house, verifier red).
//
// IDEMPOTENT: a pinned handle is skipped without a GitHub call past the
// listing, and settle-join answers "already settled" for one that slips
// through. A refusal is logged and not retried (it is a person's call); a
// transient failure (the record, GitHub, the push) holds the cursor so the next
// tick asks again.
//
//   node deploy/settle-pass.mjs --town <town-clone> --cursor <file>
//
// Env (from /etc/postmark-office.env via the tick's unit, the same file the
// office writer reads): POSTMARK_PEN_TOKEN (the pen's token, which lists the
// town's PRs), POSTMARK_TOWN_REPO, POSTMARK_TOWN_BRANCH, GITHUB_API_URL, the
// store's WORLD2_PG / WORLD2_PG_URL, TOWN_PUSH / BOT_NAME / BOT_EMAIL (penCommit).

import { existsSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { penTransaction } from "../src/write.mjs";
import { loadRegistryRows } from "../src/registry-store.mjs";
import { pinsFromRows } from "../src/registry-rows.mjs";
import { joinOfMergedPR, settleUnderLock, PEN_GH_ID, SETTLE_REFUSALS } from "../src/settle-join.mjs";
import { ghFetch } from "../src/residency.mjs";

const DAY = 24 * 60 * 60 * 1000;
const PAGES = 5;

export function townDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.TOWN_TZ ?? "America/New_York" }).format(now);
}

/** The pen, built from the env exactly as the office builds its own (src/server.mjs § PEN). */
export function penFromEnv(env = process.env) {
  const [owner, repo] = (env.POSTMARK_TOWN_REPO ?? "postmark-town/postmark").split("/");
  return {
    apiBase: (env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/+$/, ""),
    token: env.POSTMARK_PEN_TOKEN ?? "",
    owner, repo,
    baseBranch: env.POSTMARK_TOWN_BRANCH ?? "main",
  };
}

const readCursor = (path) => {
  try { const t = readFileSync(path, "utf8").trim(); return Number.isNaN(Date.parse(t)) ? null : t; } catch { return null; }
};

// A refusal that asking again cannot change is the join's answer; anything
// else (the record, GitHub, a push that did not land, the lock) is the weather.
const TRANSIENT = new Set([SETTLE_REFUSALS.NO_RECORD.defect, SETTLE_REFUSALS.GITHUB.defect]);
const transient = (e) => typeof e?.code !== "number" || e.code >= 500 || TRANSIENT.has(e.defect);

/** The merged PRs since `since`, oldest merge first. Null when GitHub did not answer. */
async function mergedSince(pen, since) {
  const out = [];
  for (let page = 1; page <= PAGES; page++) {
    const r = await ghFetch(pen, "GET",
      `/repos/${pen.owner}/${pen.repo}/pulls?state=closed&base=${encodeURIComponent(pen.baseBranch)}&sort=updated&direction=desc&per_page=100&page=${page}`);
    if (!r.ok) return null;
    const prs = Array.isArray(r.json) ? r.json : [];
    for (const p of prs) if (p?.merged_at && p.merged_at >= since) out.push(p);
    if (prs.length < 100 || String(prs.at(-1)?.updated_at ?? "") < since) break;
  }
  return out.sort((a, b) => String(a.merged_at).localeCompare(String(b.merged_at)));
}

/**
 * One pass. Answers `{ ran, settled, refused, skipped, cursor }` and writes the
 * cursor file when it moved. `settle` is the critical section, injected in test.
 */
export async function settlePass({ town, cursorPath, pen, env = process.env, now = new Date(), log = console.log, settle = settleUnderLock }) {
  const since = readCursor(cursorPath) ?? new Date(now.getTime() - DAY).toISOString();
  if (!pen?.token) {
    log("[settle-pass] no pen token — nothing listed, nothing settled");
    return { ran: false, cursor: since };
  }
  const merged = await mergedSince(pen, since);
  if (merged === null) {
    log(`[settle-pass] GitHub did not list the merged PRs — nothing settled; the cursor stays at ${since}`);
    return { ran: false, cursor: since };
  }
  const rows = await loadRegistryRows(env);
  if (rows === null) {
    log(`[settle-pass] the town's record is unreachable — nothing settled; the cursor stays at ${since}`);
    return { ran: false, cursor: since };
  }
  const pins = pinsFromRows(rows);
  const date = townDate(now);

  const settled = [], refused = [], skipped = [];
  let hold = null;
  for (const pr of merged) {
    // The pen's own PR names its handle in its branch, so a pinned one costs no call.
    const penHandle = Number(pr?.user?.id) === PEN_GH_ID ? /^residency\/(.+)$/.exec(String(pr?.head?.ref ?? ""))?.[1] : null;
    if (Number(pr?.user?.id) === PEN_GH_ID && !penHandle) continue;           // boardings and the like
    if (penHandle && pins[penHandle]) { skipped.push(penHandle); continue; }

    let found;
    try { found = await joinOfMergedPR(pen, pr); }
    catch (e) {
      if (e?.defect === SETTLE_REFUSALS.NOT_A_JOIN.defect) continue;          // a letter, an edit: not a join
      if (transient(e)) { hold ??= pr.merged_at; log(`[settle-pass] #${pr.number}: ${e.defect ?? e} — held for the next tick`); continue; }
      refused.push(pr.number); log(`[settle-pass] #${pr.number} REFUSED — ${e.defect}${e.hint ? ` (${e.hint})` : ""}`);
      continue;
    }
    if (pins[found.handle]) { skipped.push(found.handle); continue; }

    let out;
    try {
      out = await penTransaction(town, async () => {
        try { return await settle({ ...found, clone: town, env, date }); }
        catch (e) {
          if (typeof e?.code !== "number") throw e;
          return { error: { code: e.code, defect: e.defect ?? String(e.message), hint: e.hint ?? null } };
        }
      });
    } catch (e) {
      out = { error: { code: 500, defect: `the settle tripped: ${String(e?.message ?? e).slice(0, 200)}` } };
    }
    if (out?.error) {
      if (transient(out.error)) { hold ??= pr.merged_at; log(`[settle-pass] #${pr.number} ${found.handle}: ${out.error.defect} — held for the next tick`); }
      else { refused.push(pr.number); log(`[settle-pass] #${pr.number} ${found.handle} REFUSED — ${out.error.defect}${out.error.hint ? ` (${out.error.hint})` : ""}`); }
      continue;
    }
    if (out.already_settled) { skipped.push(found.handle); continue; }
    settled.push(found.handle);
    log(`[settle-pass] #${pr.number} ${found.handle} settled (${found.road}) — ${out.note}`);
  }

  // The cursor moves past everything answered, and stops at the first merge
  // that met the weather, so the next tick asks from there.
  const last = merged.at(-1)?.merged_at;
  const cursor = hold ?? (last ? new Date(Date.parse(last) + 1000).toISOString() : since);
  if (cursor !== since) writeFileSync(cursorPath, cursor + "\n");
  log(`[settle-pass] ${merged.length} merged since ${since}: ${settled.length} settled, ${refused.length} refused, ${skipped.length} already settled; cursor ${cursor}`);
  return { ran: true, settled, refused, skipped, cursor };
}

const arg = (name, argv) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

export async function main(argv = process.argv.slice(2)) {
  const town = arg("--town", argv);
  const cursorPath = arg("--cursor", argv);
  if (!town || !existsSync(town)) {
    console.error("settle-pass: --town <town-clone> is required and must exist");
    return 1;
  }
  if (!cursorPath) {
    console.error("settle-pass: --cursor <file> is required (it holds the last merge this pass answered)");
    return 1;
  }
  await settlePass({ town, cursorPath, pen: penFromEnv() });
  return 0;
}

// ── entry guard ──────────────────────────────────────────────────────────────
// The realpath compare, welcome-pass.mjs's idiom (the junction lesson,
// 2026-09-05); test/cli-guard.test.mjs spawns it both ways.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exit(await main());
