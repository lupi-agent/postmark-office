#!/usr/bin/env node
// stamp-lines.mjs — the stamp ledger's chain in the store: record and verify (POS-341, Q1).
//
//   node world2/tools/stamp-lines.mjs --sync   [--clone <town clone>]
//   node world2/tools/stamp-lines.mjs --verify [--clone <town clone>] [--json]
//
// --sync records every line the clone's ledger holds past the store's last row,
// each one's seal recomputed and its signature verified, in one transaction
// (src/stamp-lines.mjs § syncStampLinesVia). The pens record their own lines in
// their act's transaction; this is for the writers that still commit the file
// straight from a shell (the ferry's ballot pass, the keep tick's welcome pass,
// an epoch close by hand): git can be written to, and the store reads git. The
// first run on a box fills the table from the whole ledger.
//
// --verify is the chain's check: the store's own seal chain and signatures, and
// the export byte for byte against the store. Read-only. Exit 0 green, 1 red,
// 2 could not run.

import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { engineOf, syncStampLinesVia, verifyStampLinesVia } from "../../src/stamp-lines.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
function arg(name, fallback = null) { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fallback : process.argv[i + 1]; }

async function main() {
  const clone = resolve(arg("clone", process.env.TOWN_CLONE ?? resolve(HERE, "..", "..", "town-clone")));
  if (!existsSync(join(clone, "tools", "stamp-mint.mjs"))) { console.error(`no town clone with tools/stamp-mint.mjs at ${clone}`); return 2; }
  const engine = await engineOf(clone);
  const { officeRead, officeWrite } = await import("../../src/world2-pen.mjs");
  if (process.argv.includes("--sync")) {
    try {
      const out = await officeWrite((c) => syncStampLinesVia(c, clone, { engine }));
      console.log(`stamp_lines: ${out.inserted} line(s) recorded past the ${out.held} held`);
      return 0;
    } catch (e) { console.error(`stamp_lines: nothing recorded: ${e.message}`); return 1; }
  }
  if (process.argv.includes("--verify")) {
    let v;
    try { v = await officeRead((q) => verifyStampLinesVia(q, clone, { engine })); }
    catch (e) { console.error(`the store could not be read: ${e.message}`); return 2; }
    if (process.argv.includes("--json")) console.log(JSON.stringify(v, null, 2));
    else {
      console.log(`stamp_lines: store ${v.held} line(s), export ${v.exported}: ${v.ok ? "green" : "RED"}`);
      for (const p of v.problems) console.log(`  ${p}`);
    }
    return v.ok ? 0 : 1;
  }
  console.error("say --sync or --verify");
  return 2;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await main();
