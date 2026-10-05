#!/usr/bin/env node
// crossing-receipt.mjs — record a crossing's receipt in the store (POS-352).
//
//   node world2/tools/crossing-receipt.mjs --receipt <settlement-auto.json> [--attempt <n>]
//
// Run by deploy/settlement-auto.sh § report, right after the receipt file is
// written, for every DECIDED crossing (the same rule the history log keeps:
// deploy/settlement-history.mjs § isDecision — a lost race inside the retry
// wrapper is not a decision yet). Idempotent on the receipt's digest.
//
// Exit 0 on a recorded or already-recorded receipt and on a skipped attempt;
// 1 when it could not record (the crossing swallows it: a bookkeeper must never
// fail a crossing). Prints one line saying which.
//
// Env: WORLD2_PG=1 + WORLD2_PG_URL (office_api). Nothing is sourced and no
// secret is printed.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

import { recordReceipt } from "../../src/crossing-receipts.mjs";
import { isDecision } from "../../deploy/settlement-history.mjs";

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] ?? null : null; };

async function main() {
  const path = opt("--receipt");
  if (!path) { console.error("crossing-receipt: --receipt <settlement-auto.json> is required"); process.exit(2); }
  let text;
  try { text = readFileSync(path, "utf8"); }
  catch { console.error(`crossing-receipt: no receipt at ${path}`); process.exit(1); }
  let receipt;
  try { receipt = JSON.parse(text); }
  catch { console.error(`crossing-receipt: ${path} is not JSON — nothing recorded`); process.exit(1); }
  if (!isDecision(receipt, opt("--attempt") ?? "")) {
    console.error("crossing-receipt: a lost race inside the retry is not a decision yet — nothing recorded");
    return;
  }
  const r = await recordReceipt(text);
  if (r === null) { console.error("crossing-receipt: this office is not pointed at the record (WORLD2_PG=1 and WORLD2_PG_URL) — nothing recorded"); process.exit(1); }
  console.error(r.recorded ? `crossing-receipt: recorded as row ${r.id}` : "crossing-receipt: already recorded (same digest)");
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();

if (isMain) main().then(() => process.exit(0), (e) => { console.error(`crossing-receipt: ${String(e?.message ?? e).slice(0, 300)}`); process.exit(1); });
