#!/usr/bin/env node
// prod-flip-falsifiers.mjs — the store's equality falsifiers, run READ ONLY
// against prod's store before the prod flip (POS-142, lane S3, item 3).
//
//   WORLD2_PG_URL=<a reader URL> node world2/tools/prod-flip-falsifiers.mjs \
//     --world-repo <a world checkout at the store's world-marks head> [--only apex,standing,live,guard-g5] [--law-sha <sha>]
//
// DESIGN-standing-flip.md § 5.6 moves no read until its falsifier is green on
// prod. Three of the four store falsifiers read and only read: apex, standing
// and live. The fourth, the guard, reads the real store in ONE of its six
// equalities, G5, and that one runs here as `guard-g5` (falsifier-guard-g5.mjs).
// Its other five write a population into an empty scratch and are CI's
// `guard-falsifier` workflow's, on every PR (Wright's G-c, 2026-10-01). This
// runs them as children, one after another, and every session any of them
// opens is READ ONLY. A write would be refused by Postgres instead of landing.
//
// ── READ ONLY, TWO LAYERS, AND THE SECOND DOES NOT TRUST THE FIRST ──────────
//
//   1. THE ROLE. On the box the URL names `snapshot_reader`, which 002_grants
//      gives SELECT on every table and nothing else.
//   2. THE SESSION. `-c default_transaction_read_only=on` rides the URL as the
//      startup `options` AND the children's PGOPTIONS, so every client a
//      falsifier builds (its own Pool, and every office module it imports) opens
//      read-only sessions, and an INSERT, an UPDATE inside BEGIN … ROLLBACK, or a
//      CREATE is refused with "cannot execute … in a read-only transaction".
//      Layer 2 holds even for a role that could write. A wrong URL handed to
//      this tool still cannot write.
//   The preflight READS both layers before anything runs: `SHOW
//   default_transaction_read_only` must answer `on`, and the role's INSERT
//   privilege on `marks` is printed. Nothing is written to find out.
//
// ── THE CHILDREN'S ENVIRONMENT IS MINIMAL ON PURPOSE ────────────────────────
//
// A shell on the box carries the office's flags (WORLD_POSITIONS, W2_PEN, …),
// and under those `openDynamic` refuses by design (POS-269); the live
// falsifier's E3 builds its oracle in a temp sqlite through it. So the children
// get PATH, HOME, the read-only URL and PGOPTIONS, WORLD_CLONE (the checkout),
// and only the pass-throughs named below. Nothing else is inherited.
//
// ── SAME STATE ──────────────────────────────────────────────────────────────
//
// A checkout at a different state from the store compares two states, not the
// port. The preflight reads `projection_heads['world-marks']` and the
// checkout's HEAD and refuses (exit 2) when they differ. `--allow-skew` runs
// anyway and can never exit 0.
//
// ── PROOFS ──────────────────────────────────────────────────────────────────
//
// apex and live take their in-memory `--prove-can-fail` (`--can-fail-proof`):
// each breaks its equalities in memory and requires every break to turn red.
// standing's `--can-fail-proof` mangles the store inside a rolled-back
// transaction, which is a WRITE, so it is not passed here. Under layer 2 it
// would be refused anyway; that refusal is this tool's own test.
//
// Exit: 0 every falsifier green · 1 any RED · 2 any CANNOT RUN, a refused
// preflight, or a skew. The worst wins.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const READ_ONLY_OPTION = "-c default_transaction_read_only=on";

/** The URL with the read-only startup option added, any existing `options` kept. */
export function readOnlyUrl(url) {
  const u = new URL(url);
  const had = u.searchParams.get("options");
  u.searchParams.set("options", had ? `${had} ${READ_ONLY_OPTION}` : READ_ONLY_OPTION);
  return u.toString();
}

/** Each falsifier, its file, and the in-memory proof flag it takes (null: none passed). */
export const FALSIFIERS = Object.freeze([
  { id: "apex", file: "falsifier-apex-equality.mjs", proof: "--prove-can-fail" },
  { id: "standing", file: "falsifier-standing-equality.mjs", proof: null },
  { id: "live", file: "falsifier-live-equality.mjs", proof: "--can-fail-proof" },
  // The guard falsifier's G5, the one equality of six that reads the real store
  // (falsifier-guard-g5.mjs, which imports the guard module's own functions).
  // G1–G4 and G6 write a scratch population and stay CI's (Wright's G-c).
  { id: "guard-g5", file: "falsifier-guard-g5.mjs", proof: "--prove-can-fail" },
]);

export const PASS_THROUGH = Object.freeze(["TOWN_CLONE", "WORLD2_PGHOST", "WORLD2_PGPORT"]);

/** The children's whole environment. */
export function childEnv(parent, { url, repo }) {
  const env = {
    PATH: parent.PATH ?? "", HOME: parent.HOME ?? "/tmp",
    WORLD2_PG_URL: readOnlyUrl(url), PGOPTIONS: READ_ONLY_OPTION, WORLD_CLONE: repo,
  };
  if (parent.SystemRoot) env.SystemRoot = parent.SystemRoot; // Windows needs it to spawn anything
  for (const k of PASS_THROUGH) if (parent[k] != null) env[k] = parent[k];
  return env;
}

/** What the preflight asks, as reads. `q` is a pg client's query. */
export async function preflight(q, { repoHead = null } = {}) {
  const ro = (await q("SHOW default_transaction_read_only")).rows[0]?.default_transaction_read_only;
  const who = (await q("SELECT current_user AS u, current_database() AS d")).rows[0];
  const ins = (await q("SELECT has_table_privilege(current_user, 'marks', 'INSERT') AS i")).rows[0]?.i;
  const head = (await q("SELECT sha FROM projection_heads WHERE repo = 'world-marks'")).rows[0]?.sha ?? null;
  const refusals = [];
  if (ro !== "on") refusals.push(`the session is not read-only (default_transaction_read_only = ${ro ?? "unanswered"}), so a write would land: refused before any falsifier runs`);
  return {
    read_only: ro, role: who?.u ?? null, database: who?.d ?? null, role_can_insert_marks: ins === true,
    store_head: head, repo_head: repoHead, same_state: head != null && head === repoHead, refusals,
  };
}

/** The worst exit wins: 2 over 1 over 0. */
export const worst = (codes) => (codes.some((c) => c === 2 || c == null || c > 2) ? 2 : codes.some((c) => c === 1) ? 1 : 0);

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
  const has = (n) => argv.includes(n);
  const die = (m) => { console.error(`CANNOT RUN · ${m}`); process.exit(2); };

  const worldRepo = arg("--world-repo");
  if (!worldRepo) die("usage: prod-flip-falsifiers.mjs --world-repo <checkout> [--only apex,standing,live,guard-g5] [--law-sha <sha>] [--allow-skew]  (WORLD2_PG_URL = a reader URL)");
  const REPO = resolve(worldRepo);
  if (!existsSync(REPO)) die(`no checkout at ${REPO}`);
  const URL0 = process.env.WORLD2_PG_URL;
  if (!URL0) die("WORLD2_PG_URL missing — the reader URL (on the box: w2_url snapshot_reader PG_SNAPSHOT_READER_PASSWORD)");
  const only = (arg("--only") ?? FALSIFIERS.map((f) => f.id).join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  for (const id of only) if (!FALSIFIERS.some((f) => f.id === id)) die(`no falsifier "${id}" (${FALSIFIERS.map((f) => f.id).join(", ")})`);

  let repoHead = null;
  try { repoHead = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); }
  catch { die(`${REPO} is not a git checkout`); }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: readOnlyUrl(URL0) });
  try { await client.connect(); } catch (e) { die(`cannot connect: ${String(e?.message ?? e).slice(0, 160)}`); }
  let pre;
  try { pre = await preflight((sql) => client.query(sql), { repoHead }); }
  catch (e) { await client.end().catch(() => {}); die(`the preflight could not read: ${String(e?.message ?? e).slice(0, 200)}`); }
  await client.end().catch(() => {});

  console.log(`prod-flip-falsifiers · ${new Date().toISOString()}`);
  console.log(`  session: default_transaction_read_only = ${pre.read_only} · role ${pre.role} on ${pre.database} · that role may INSERT into marks: ${pre.role_can_insert_marks}`);
  console.log(`  state:   store world-marks ${pre.store_head?.slice(0, 12) ?? "(none)"} · checkout ${pre.repo_head?.slice(0, 12)} · ${pre.same_state ? "SAME" : "DIFFERENT"}`);
  if (pre.refusals.length) die(pre.refusals.join("; "));
  if (!pre.same_state && !has("--allow-skew")) die("the checkout is not at the store's world-marks head — check it out at that sha (or pass --allow-skew to measure anyway; it cannot exit 0)");

  const env = childEnv(process.env, { url: URL0, repo: REPO });
  const codes = [];
  for (const f of FALSIFIERS.filter((x) => only.includes(x.id))) {
    const lawSha = f.id === "apex" ? arg("--law-sha") : null; // apex pins one law; the open window's is the default
    const args = [join(HERE, f.file), "--world-repo", REPO, ...(lawSha ? ["--law-sha", lawSha] : []), ...(f.proof ? [f.proof] : [])];
    console.log(`\n══ ${f.id}: node ${f.file} --world-repo ${REPO}${f.proof ? ` ${f.proof}` : ""}`);
    const r = spawnSync(process.execPath, args, { env, stdio: "inherit" });
    codes.push(r.status);
    console.log(`══ ${f.id}: exit ${r.status}`);
  }
  const verdict = Math.max(worst(codes), pre.same_state ? 0 : 2);
  console.log(`\nverdict: ${["GREEN", "RED", "CANNOT RUN"][verdict]} (${FALSIFIERS.filter((x) => only.includes(x.id)).map((f, i) => `${f.id} ${codes[i]}`).join(" · ")}${pre.same_state ? "" : " · skewed"})`);
  process.exit(verdict);
}

const isMain = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) main().catch((e) => { console.error(`CANNOT RUN · ${String(e?.stack ?? e).slice(0, 400)}`); process.exit(2); });
