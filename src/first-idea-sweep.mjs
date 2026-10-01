// first-idea-sweep.mjs — the first-idea quest's WRITER (the Think Tank,
// founder-ruled 2026-08-30; terms: 5 stamps, once per household, receipt = the
// household's first published idea mark, window through 2026-09-30).
//
// Runs at the crossing, beside the town drain. The shape is the drain's own:
//
//   · ONE AUTHORITY for town law. Every law question — who shares a household,
//     who is a meep, who has a room, which households are already paid, and
//     the canonical line itself — is answered by the town clone's OWN
//     tools/stamp-mint.mjs in a subprocess (the signedRegistryLines pattern).
//     This file duplicates none of the grammar; if the clone's engine predates
//     the first-idea rule, the sweep REFUSES with a name instead of inventing
//     the law locally — dev sandboxes on the seed tag no-op cleanly until the
//     town train walks.
//   · IDEMPOTENT BY LEDGER, not memory (the F3 discipline): the already-paid
//     set is re-read from the ledger every crossing, so a re-run, a crash
//     between write and cursor, or a hand-minted line all cost nothing.
//   · THE WRITER HOLDS THE WINDOW: after FIRST_IDEA_WINDOW_END the sweep
//     plans nothing and says so. The verifier deliberately does not check the
//     window — a line lawfully minted inside it stays lawful forever.
//   · REFUSE, NEVER DEGRADE: no pen key, no signing, no half-writes — same
//     gate as the registry lines (#2040).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ideasTank } from "./world-classes.mjs";
import { signedRegistryLines } from "./town-drain.mjs";

export const FIRST_IDEA_WINDOW_END = "2026-09-30";

/**
 * Plan the crossing's first-idea mints. `ideas` defaults to the world store's
 * Think Tank read; tests inject their own list. Returns
 * { mints: [{handle, mark, line}], skipped: [{mark, why}], refused? }.
 */
export function planFirstIdeaSweep(clone, { date, ideas = null, windowEnd = FIRST_IDEA_WINDOW_END } = {}) {
  if (date > windowEnd)
    return { mints: [], skipped: [], note: `the first-idea window closed ${windowEnd} — the sweep plans nothing (lines already minted stay lawful)` };

  const tank = ideas ?? ideasTank().ideas;
  if (!tank.length) return { mints: [], skipped: [] };

  const engineDir = process.env.STAMP_ENGINE_DIR ?? join(clone, "tools");
  // The whole town-law half of the plan runs INSIDE the clone's own engine —
  // candidates in, lawful first-per-household lines out. Everything quoted
  // from stamp-mint: classifyEntry (already-paid), householdKeys + registry
  // revisions (who shares a roof, resolved the way the verifier resolves it),
  // parseLaws + meepChecker (the meep law), firstIdeaLine (the canonical).
  const script = [
    "const [clone, engineDir, date] = process.argv.slice(1);",
    "const { readFileSync, existsSync } = await import('node:fs');",
    "const { pathToFileURL } = await import('node:url');",
    "const engine = await import(pathToFileURL(engineDir + '/stamp-mint.mjs'));",
    "if (typeof engine.firstIdeaLine !== 'function') { process.stdout.write(JSON.stringify({ refused: 'engine-predates-first-idea' })); process.exit(0); }",
    "const { parseStampLedger, classifyEntry, parseLaws, meepChecker, householdKeys, firstIdeaLine } = engine;",
    "const ledgerPath = clone + '/WHITE_PAGES/stamp-ledger.md';",
    "if (!existsSync(ledgerPath)) { process.stdout.write(JSON.stringify({ refused: 'no-ledger' })); process.exit(0); }",
    "const existing = parseStampLedger(readFileSync(ledgerPath, 'utf8'));",
    "const { laws, revisions } = parseLaws(existing);",
    "const isMeep = meepChecker(laws);",
    "const rooms = householdKeys(clone);",
    "const keyOf = (h, d) => {",
    "  let k = null;",
    "  for (const r of revisions) if (r.handle === h && r.date <= d) k = r.key;",
    "  if (k) return k;",
    "  const base = rooms.get(h);",
    "  return base ? base.key : 'solo:' + h;",
    "};",
    "const paid = new Set();",
    "for (const e of existing) { const c = classifyEntry(e.canonical); if (c.kind === 'first-idea') paid.add(keyOf(c.handle, c.date)); }",
    "const candidates = JSON.parse(readFileSync(0, 'utf8'));",
    "const mints = [], skipped = [];",
    "for (const idea of candidates) {",
    "  const handle = idea.by;",
    "  if (!rooms.has(handle)) { skipped.push({ mark: idea.id, why: 'no room for ' + handle }); continue; }",
    "  if (isMeep(handle, date)) { skipped.push({ mark: idea.id, why: handle + ' is a meep — meeps stay outside the currency' }); continue; }",
    "  const house = keyOf(handle, date);",
    "  if (paid.has(house)) { skipped.push({ mark: idea.id, why: 'household of ' + handle + ' already paid' }); continue; }",
    "  paid.add(house);",
    "  mints.push({ handle, mark: idea.id, line: firstIdeaLine({ date, handle, mark: idea.id }) });",
    "}",
    "process.stdout.write(JSON.stringify({ mints, skipped }));",
  ].join("\n");
  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script, clone, engineDir, date],
    { input: JSON.stringify(tank), encoding: "utf8" });
  const out = JSON.parse(stdout);
  if (out.refused) return { mints: [], skipped: [], refused: out.refused };
  return out;
}

/**
 * Sign and append the planned lines. Same append idiom as writeTownDrain's
 * ledger half; returns the relative paths touched (for the pen commit).
 */
export function writeFirstIdeaSweep(clone, plan) {
  if (!plan.mints.length) return [];
  const ledgerRel = "WHITE_PAGES/stamp-ledger.md";
  const ledgerAbs = join(clone, ledgerRel);
  if (!existsSync(ledgerAbs)) return [];
  const signed = signedRegistryLines(clone, plan.mints.map((m) => m.line));
  const prior = readFileSync(ledgerAbs, "utf8");
  writeFileSync(ledgerAbs, prior.replace(/\s*$/, "\n") + signed.join("\n") + "\n");
  return [ledgerRel];
}
