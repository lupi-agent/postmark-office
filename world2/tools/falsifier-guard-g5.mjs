#!/usr/bin/env node
// falsifier-guard-g5.mjs — the guard falsifier's G5 alone: the holder fold on the
// REAL store, read-only (POS-142 S3, 2026-10-01).
//
//   WORLD2_PG_URL=<a reader URL> node world2/tools/falsifier-guard-g5.mjs --world-repo <checkout> [--json] [--prove-can-fail]
//
// `falsifier-guard-equality.mjs` checks the write-path guards' port in six
// equalities. G1–G4 and G6 run over a population the tool WRITES into an empty
// scratch, which CI's `guard-falsifier` workflow runs on every PR (Wright's
// G-c, 2026-10-01). G5 is the one that reads the real store:
//
//   1.0's own recovery chain over the world repo's STATE (attachmentsFromState →
//   declareAttachment → readAttachments → liveHolder / holdingsOf), against the
//   port over `acts` (guard-reads.mjs § pgAttachmentsFor → pgHolderOf / pgHoldingsOf).
//
// This runs exactly that, by IMPORTING the guard module's own functions
// (loadOracles, buildOracleAttachments, g5Holdings, g5Breaks), not a copy, so
// prod-flip-falsifiers.mjs can run it on Sunday beside apex, standing and live,
// read-only. It writes nothing to any database. Its one file is 1.0's oracle,
// rebuilt in a temp sqlite and removed after.
//
// `--prove-can-fail` runs the guard's own two G5 breaks (proofs 5 and 6), judged
// as its `proof()` judges them: a break that altered no input is INERT, one that
// altered input and moved no finding is SILENT, and a SILENT break fails the run.
//
// Exit: 0 G5 agrees on every row · 1 RED (a divergence, or a SILENT break) · 2 CANNOT RUN.

import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import * as guards from "./guard-reads.mjs";
import { loadOracles, buildOracleAttachments, g5Holdings, g5Breaks } from "./falsifier-guard-equality.mjs";

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const has = (n) => argv.includes(n);
const die = (msg) => { console.error(`CANNOT RUN · ${msg}`); process.exit(2); };

async function main() {
  const worldRepo = arg("--world-repo");
  if (!worldRepo) die("usage: falsifier-guard-g5.mjs --world-repo <checkout> [--json] [--prove-can-fail]  (WORLD2_PG_URL = a reader URL)");
  const REPO = resolve(worldRepo);
  if (!existsSync(join(REPO, "STATE"))) die(`no STATE/ under ${REPO} — G5's oracle is 1.0's attachmentsFromState over it`);
  if (!process.env.WORLD2_PG_URL) die("WORLD2_PG_URL missing");

  await loadOracles();
  const { default: pg } = await import("pg");
  const tmp = mkdtempSync(join(tmpdir(), "guard-g5-"));
  const devPool = new pg.Pool({ connectionString: process.env.WORLD2_PG_URL, max: 2 });
  let out;
  try {
    const oracle = buildOracleAttachments(join(REPO, "STATE"), join(tmp, "oracle.db"));
    if (oracle.reason) die(`G5's oracle could not be built from ${REPO}/STATE: ${oracle.reason}`);
    const c = await devPool.connect();
    let portAttachments;
    try { portAttachments = await guards.pgAttachmentsFor(c); } finally { c.release(); }
    const g5 = g5Holdings(oracle.rows, portAttachments.rows);
    out = {
      equality: "G5",
      compared: g5.compared, findings: g5.findings,
      oracle_attachments: oracle.rows.length, port_attachments: portAttachments.rows.length,
      attachment_eras: portAttachments.eras, oracle_from_crossing: oracle.crossing,
    };
    if (has("--prove-can-fail")) {
      const results = [];
      for (const [label, run] of g5Breaks({ oracle, portAttachments, devPool })) {
        try {
          const r = await run();
          results.push({ mangle: label, findings: r.findings.length, bit: r.bit });
        } catch (err) { results.push({ mangle: label, findings: -1, bit: null, note: `threw: ${String(err.message).slice(0, 160)}` }); }
      }
      out.can_fail = { results, silent: results.filter((r) => r.findings === 0 && r.bit !== 0).map((r) => r.mangle) };
    }
  } finally {
    await devPool.end().catch(() => {});
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* windows handles */ }
  }

  if (has("--json")) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`G5 · holdings: oracle ${out.oracle_attachments} rows (recovered from crossing ${out.oracle_from_crossing}) · port ${out.port_attachments} ` +
                `(legacy ${out.attachment_eras?.legacy} · live ${out.attachment_eras?.live}) · compared ${out.compared} · findings ${out.findings.length}`);
    for (const f of out.findings) console.log(`  ✗ ${f}`);
    if (out.can_fail) for (const r of out.can_fail.results)
      console.log(r.bit === 0 ? `  INERT  ${r.mangle}` : `  ${r.findings > 0 ? "RED   " : r.findings === 0 ? "SILENT" : "THREW "} ${r.mangle}${r.note ? ` — ${r.note}` : ""}`);
  }
  if (!out.compared) die("G5 compared nothing — a green that checked nothing is not a receipt");
  if (out.can_fail?.silent.length) process.exit(1);
  process.exit(out.findings.length ? 1 : 0);
}

const isMain = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) main().catch((e) => { console.error(`CANNOT RUN · ${String(e?.stack ?? e).slice(0, 400)}`); process.exit(2); });
